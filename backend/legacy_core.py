#!/usr/bin/env python3
import argparse
import ast
import base64
import json
import locale
import os
import posixpath
import platform
import re
import shutil
import shlex
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import uuid
import webbrowser
import xml.etree.ElementTree as ET
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from backend.app_assets import (
    aapt_label_from_apk,
    apk_label_from_zip,
    find_aapt_tool,
    icon_mime_type,
    normalize_locale,
    save_icon_from_apk,
)


ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"
DATA_DIR = ROOT / "data"
PROFILES_FILE = DATA_DIR / "profiles.json"
SETTINGS_FILE = DATA_DIR / "settings.json"
ENTERPRISE_FILE = DATA_DIR / "enterprise.json"
ENTERPRISE_SOURCE_FILE = DATA_DIR / "enterprise-source.json"
ENTERPRISE_SOURCE_TEXT_FILE = DATA_DIR / "enterprise-source.txt"
ADB_SNIPPETS_FILE = DATA_DIR / "adb_script_snippets.json"
LOGS_FILE = DATA_DIR / "runs.jsonl"
APP_LABEL_CACHE_FILE = DATA_DIR / "app_label_cache.json"
KNOWN_LABELS_FILE = DATA_DIR / "known_labels.json"
APP_INFO_CACHE_FILE = DATA_DIR / "app_info_cache.json"
APP_ICON_CACHE_DIR = DATA_DIR / "app_icons"
APP_ICON_CACHE_INDEX_FILE = DATA_DIR / "app_icon_cache.json"
APP_INFO_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
PROCESS_PACKAGE_CACHE_TTL_SECONDS = 20
DEFAULT_TMP_SCRIPTS_DIR = DATA_DIR / "tmp-scripts"
OCR_READER_CACHE = {}
CACHE_LOCK = threading.RLock()
APP_ICON_SEMAPHORE = threading.Semaphore(2)
LOGCAT_LOCK = threading.RLock()
LOGCAT_SESSIONS = {}
LOGCAT_MAX_LINES = 200000
PROCESS_PACKAGE_CACHE_LOCK = threading.RLock()
PROCESS_PACKAGE_CACHE = {}
CLIPBOARD_SERVER_LOCK = threading.RLock()
CLIPBOARD_SERVER_SESSIONS = {}
STORAGE_CATEGORY_META = {
    "screenshots": {"label": "截图缓存"},
    "dump": {"label": "Dump 缓存"},
    "logs": {"label": "日志缓存"},
    "apk": {"label": "APK 缓存"},
    "app_cache": {"label": "App 缓存"},
    "default_output": {"label": "默认输出目录"},
    "local_temp": {"label": "本机临时目录"},
    "tmp_scripts": {"label": "临时脚本"},
    "workflow_exports": {"label": "Workflow 导出"},
}


DEFAULT_ADB_SNIPPET_CONFIG = {
    "groups": [
        {
            "title": "按键",
            "items": [
                {"label": "电源键", "text": "adb shell input keyevent POWER", "title": "等同于按一下手机电源键"},
                {"label": "唤醒", "text": "adb shell input keyevent WAKEUP", "title": "点亮屏幕"},
                {"label": "熄屏", "text": "adb shell input keyevent SLEEP", "title": "关闭屏幕"},
                {"label": "Home", "text": "adb shell input keyevent HOME", "title": "回到桌面"},
                {"label": "返回", "text": "adb shell input keyevent BACK", "title": "执行返回键"},
                {"label": "最近任务", "text": "adb shell input keyevent APP_SWITCH", "title": "打开最近任务"},
            ],
        },
        {
            "title": "触控",
            "items": [
                {"label": "点击坐标", "text": "adb shell input tap 500 500", "title": "按屏幕坐标点击"},
                {"label": "滑动", "text": "adb shell input swipe 500 1800 500 400 300", "title": "按屏幕坐标滑动"},
                {"label": "输入文本", "text": "adb shell input text hello", "title": "输入一段文本，空格可写成 %s"},
                {
                    "label": "亮屏解锁",
                    "title": "适合无密码或测试机",
                    "text": "adb shell input keyevent WAKEUP\nadb shell wm dismiss-keyguard\nadb shell input keyevent HOME",
                },
            ],
        },
        {
            "title": "初始化",
            "items": [
                {
                    "label": "跳过开机向导",
                    "title": "不同 ROM 支持程度不同，失败行默认继续",
                    "patch": {"continueOnLineError": True},
                    "text": "# 跳过开机向导：不同 ROM 支持程度不同\nadb shell settings put global device_provisioned 1\nadb shell settings put secure user_setup_complete 1\nadb shell settings put secure tv_user_setup_complete 1\nadb shell pm disable-user --user 0 com.google.android.setupwizard || true\nadb shell pm disable-user --user 0 com.google.android.partnersetup || true\nadb shell pm disable-user --user 0 com.android.provision || true\nadb shell input keyevent HOME",
                },
                {"label": "开发者选项", "text": "adb shell am start -a android.settings.APPLICATION_DEVELOPMENT_SETTINGS", "title": "打开开发者选项页面"},
                {"label": "Wi-Fi 设置", "text": "adb shell am start -a android.settings.WIFI_SETTINGS", "title": "打开 Wi-Fi 设置页面"},
            ],
        },
        {
            "title": "查看",
            "items": [
                {"label": "顶部 Activity", "text": "adb shell dumpsys activity top", "title": "查看当前前台 Activity 相关信息"},
                {
                    "label": "设备信息",
                    "title": "查看型号、系统、分辨率、电池",
                    "text": "adb shell getprop ro.product.model\nadb shell getprop ro.build.version.release\nadb shell wm size\nadb shell wm density\nadb shell dumpsys battery",
                },
                {"label": "清空日志", "text": "adb logcat -c", "title": "清空设备 logcat 缓冲区"},
                {"label": "最近日志", "text": "adb logcat -d -t 200", "title": "输出最近 200 行 logcat"},
            ],
        },
        {
            "title": "DSL：点击 / 长按",
            "items": [
                {"label": "点文字", "text": "tapText(\"确定\")", "title": "按文字定位并点击，UIAutomator 优先"},
                {"label": "点文字+OCR", "text": "tapText(\"确定\", { fallbackOcr: true })", "title": "UIAutomator 找不到时截图 OCR 兜底"},
                {"label": "只用 OCR 点", "text": "tapText(\"图片按钮\", { onlyOcr: true })", "title": "跳过 UI 节点，直接用截图 OCR 定位"},
                {"label": "点 id", "text": "tapById(\"com.example:id/button\")", "title": "按 resource-id 定位并点击，优先用于稳定控件"},
                {"label": "长按文字", "text": "longPressText(\"微信\")", "title": "按文字或 content-desc 找到控件后长按，默认 1000ms"},
                {"label": "长按文字 1.2s", "text": "longPressText(\"微信\", 1200)", "title": "按文字定位后长按，并指定长按毫秒数"},
                {"label": "长按文字+OCR", "text": "longPressText(\"图片按钮\", 1200, { fallbackOcr: true })", "title": "UIAutomator 找不到时使用 OCR 兜底后长按"},
                {"label": "长按 id", "text": "longPressId(\"com.example:id/item\")", "title": "按 resource-id 精确定位后长按"},
                {"label": "长按坐标", "text": "longPress(500, 500, 1200)", "title": "按坐标长按；适合没有可识别节点的区域"},
                {"label": "点百分比", "text": "tapPercent(50.0, 50.0)", "title": "按屏幕百分比点击，适配不同分辨率"},
                {"label": "点右上角", "text": "tapTopRight()", "title": "点击屏幕右上角"},
                {"label": "点底部中间", "text": "tapBottomCenter()", "title": "点击屏幕底部中间"},
            ],
        },
        {
            "title": "DSL：等待 / 条件",
            "items": [
                {"label": "等文字再点", "text": "waitTextAndTap(\"登录\", 5000)", "title": "等待文字出现后点击"},
                {"label": "OCR 等文字", "text": "waitText(\"验证码\", 5000, { fallbackOcr: true })", "title": "等待文字时也可启用 OCR 兜底"},
                {"label": "二选一等待", "text": "waitAnyText([\"允许\", \"拒绝\"], 5000)", "title": "等待任意一个文字出现"},
                {"label": "全部出现", "text": "waitAllText([\"账号\", \"密码\"], 5000)", "title": "等待多个文字全部出现"},
                {"label": "等待 id", "text": "waitId(\"com.example:id/button\", 5000)", "title": "等待 resource-id 出现"},
                {
                    "label": "条件分支",
                    "title": "有更新弹窗就取消，否则继续",
                    "text": "ifTextExists(\"更新\") {\n  tapText(\"取消\")\n} else {\n  tapText(\"继续\")\n}",
                },
                {
                    "label": "重试块",
                    "title": "整段动作失败后重试",
                    "text": "retry(3) {\n  tapText(\"登录\")\n  waitText(\"首页\", 5000)\n}",
                },
                {
                    "label": "嵌套条件",
                    "title": "retry 里嵌套 if / else if",
                    "text": "retry(3) {\n  ifTextExists(\"登录\") {\n    tapText(\"登录\")\n  } else ifTextExists(\"拨号\") {\n    tapText(\"拨号\")\n  }\n}",
                },
            ],
        },
        {
            "title": "DSL：滚动 / 手势",
            "items": [
                {"label": "滚动找文字", "text": "scrollToText(\"隐私政策\", 6)", "title": "边滚动边查找文字"},
                {"label": "向上滑", "text": "swipeUp()", "title": "向上滑动页面"},
                {"label": "向下滑", "text": "swipeDown()", "title": "向下滑动页面"},
                {"label": "左滑", "text": "swipeLeft()", "title": "向左滑动"},
                {"label": "右滑", "text": "swipeRight()", "title": "向右滑动"},
                {"label": "自定义滑动", "text": "swipe(500, 1800, 500, 400, 300)", "title": "按坐标执行滑动"},
            ],
        },
        {
            "title": "DSL：输入 / 权限",
            "items": [
                {"label": "输入文本", "text": "inputText(\"hello123\")", "title": "输入英文、数字和常见符号"},
                {"label": "输入中文", "text": "inputChinese(\"测试内容\")", "title": "通过剪贴板/输入法方案输入中文"},
                {"label": "剪贴板粘贴", "text": "setClipboard(\"中文内容\")\npaste()", "title": "先写入剪贴板，再粘贴到当前输入框"},
                {"label": "清空后输入", "text": "clearAndInput(\"admin\")", "title": "清空当前输入框后输入内容"},
                {"label": "权限处理", "text": "handlePermission()", "title": "尝试处理常见 Android 权限弹窗"},
                {"label": "关闭弹窗", "text": "autoClosePopup()", "title": "尝试关闭常见系统弹窗"},
            ],
        },
        {
            "title": "DSL：断言 / 调试",
            "items": [
                {"label": "断言文字", "text": "assertText(\"首页\")", "title": "找不到会自动截图和保存 UI XML"},
                {"label": "断言 id", "text": "assertId(\"com.example:id/button\")", "title": "断言 resource-id 存在"},
                {"label": "当前 Activity", "text": "currentActivity()", "title": "输出当前顶部 Activity"},
                {"label": "断言 Activity", "text": "assertActivity(\".MainActivity\")", "title": "断言当前 Activity 包含指定名称"},
                {"label": "保存截图", "text": "screenshot(\"当前页面\")", "title": "保存当前屏幕截图"},
                {"label": "失败截图", "text": "screenshotOnFail(\"失败现场\")", "title": "失败时保存截图证据"},
                {"label": "Dump UI", "text": "dumpUI()", "title": "保存当前 UIAutomator XML"},
                {"label": "日志标记", "text": "log(\"进入登录页\")", "title": "在执行结果里输出一条自定义日志"},
            ],
        },
    ]
}


LEGACY_DSL_SNIPPET_GROUP_TITLE = "自动化 DSL"
LEGACY_DSL_SNIPPET_KEYS = {
    ("点文字", "tapText(\"确定\")"),
    ("点文字+OCR", "tapText(\"确定\", { fallbackOcr: true })"),
    ("只用 OCR 点", "tapText(\"图片按钮\", { onlyOcr: true })"),
    ("等文字再点", "waitTextAndTap(\"登录\", 5000)"),
    ("OCR 等文字", "waitText(\"验证码\", 5000, { fallbackOcr: true })"),
    ("二选一等待", "waitAnyText([\"允许\", \"拒绝\"], 5000)"),
    ("条件分支", "ifTextExists(\"更新\") {\n  tapText(\"取消\")\n} else {\n  tapText(\"继续\")\n}"),
    ("重试块", "retry(3) {\n  tapText(\"登录\")\n  waitText(\"首页\", 5000)\n}"),
    ("嵌套条件", "retry(3) {\n  ifTextExists(\"登录\") {\n    tapText(\"登录\")\n  } else ifTextExists(\"拨号\") {\n    tapText(\"拨号\")\n  }\n}"),
    ("滚动找文字", "scrollToText(\"隐私政策\", 6)"),
    ("权限处理", "handlePermission()"),
    ("断言文字", "assertText(\"首页\")"),
    ("点 resource-id", "tapText(\"com.example:id/button\", { matchFields: \"resource-id\", strict: true })"),
    ("tapById", "tapById(\"com.example:id/button\")"),
    ("等 id 再点", "waitTextAndTap(\"com.example:id/button\", 5000, { matchFields: \"resource-id\", strict: true })"),
    ("等待 id", "waitId(\"com.example:id/button\", 5000)"),
    ("断言 id", "assertId(\"com.example:id/button\")"),
    ("点百分比", "tapPercent(50.0, 50.0)"),
    ("点右上角", "tapTopRight()"),
    ("点底部中间", "tapBottomCenter()"),
    ("失败截图", "screenshotOnFail(\"失败现场\")"),
}


def default_quick_output_dir_path():
    downloads = Path.home() / "Downloads"
    root = downloads if downloads.exists() else DATA_DIR
    return root / "cqclaw-output"


def default_local_temp_dir_path():
    return DEFAULT_TMP_SCRIPTS_DIR


def ensure_data():
    DATA_DIR.mkdir(exist_ok=True)
    DEFAULT_TMP_SCRIPTS_DIR.mkdir(exist_ok=True)
    if not PROFILES_FILE.exists():
        PROFILES_FILE.write_text("[]\n", encoding="utf-8")
    if not SETTINGS_FILE.exists():
        SETTINGS_FILE.write_text('{"adbPath":"adb","quickOutputDir":"","localTempDir":"","agentApkPath":"","agentServerJarPath":"","deviceAliases":{},"deviceGroups":{}}\n', encoding="utf-8")
    if not ADB_SNIPPETS_FILE.exists():
        ADB_SNIPPETS_FILE.write_text(json.dumps(DEFAULT_ADB_SNIPPET_CONFIG, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    tmp_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    tmp_path.write_text(data, encoding="utf-8")
    os.replace(tmp_path, path)


def settings():
    data = read_json(SETTINGS_FILE, {"adbPath": "adb", "quickOutputDir": "", "localTempDir": "", "agentApkPath": "", "agentServerJarPath": "", "deviceAliases": {}, "deviceGroups": {}})
    data["adbPath"] = str(data.get("adbPath") or "adb").strip() or "adb"
    data["quickOutputDir"] = str(data.get("quickOutputDir") or default_quick_output_dir_path()).strip()
    data["localTempDir"] = str(data.get("localTempDir") or default_local_temp_dir_path()).strip()
    data["agentApkPath"] = str(data.get("agentApkPath") or "").strip()
    data["agentServerJarPath"] = str(data.get("agentServerJarPath") or "").strip()
    data["deviceAliases"] = data.get("deviceAliases") if isinstance(data.get("deviceAliases"), dict) else {}
    data["deviceGroups"] = data.get("deviceGroups") if isinstance(data.get("deviceGroups"), dict) else {}
    return data


ENTERPRISE_POINTER_KEYS = (
    "enterpriseSource",
    "enterpriseConfigSource",
    "enterpriseJsonPath",
    "enterpriseJson",
    "configSource",
    "configPath",
    "defaults.enterpriseSource",
    "defaults.enterpriseConfigSource",
)


def dict_value(data, *keys):
    for key in keys:
        value = data
        for part in str(key).split("."):
            if not isinstance(value, dict):
                value = None
                break
            value = value.get(part)
        if value:
            return str(value).strip()
    return ""


def read_enterprise_json_payload(path):
    try:
        text = Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return {}, ""
    if not text:
        return {}, ""
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return {}, text
    if isinstance(data, dict):
        return data, dict_value(data, *ENTERPRISE_POINTER_KEYS)
    if isinstance(data, str):
        return {}, data.strip()
    return {}, ""


def enterprise_source_from_pointer_file():
    env_source = str(os.environ.get("QCLAW_ENTERPRISE_SOURCE") or "").strip()
    if env_source:
        return env_source
    data, source = read_enterprise_json_payload(ENTERPRISE_SOURCE_FILE)
    source = source or dict_value(data, "source", "path", *ENTERPRISE_POINTER_KEYS)
    if source:
        return source
    try:
        return ENTERPRISE_SOURCE_TEXT_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def write_enterprise_source_pointer(source):
    source = str(source or "").strip()
    ENTERPRISE_SOURCE_TEXT_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not source:
        try:
            ENTERPRISE_SOURCE_TEXT_FILE.unlink()
        except FileNotFoundError:
            pass
        return ""
    ENTERPRISE_SOURCE_TEXT_FILE.write_text(source + "\n", encoding="utf-8")
    return source


def read_enterprise_source_config(source):
    source = str(source or "").strip()
    if not source:
        return {}
    try:
        parsed = urllib.parse.urlparse(source)
        if parsed.scheme in {"http", "https"}:
            with urllib.request.urlopen(source, timeout=5) as response:
                data = json.loads(response.read().decode("utf-8"))
            return data if isinstance(data, dict) else {}
        path = Path(source).expanduser()
        if path.is_dir():
            path = path / "enterprise.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError, ValueError):
        return {}


def enterprise_config():
    local_data, embedded_source = read_enterprise_json_payload(ENTERPRISE_FILE)
    source = embedded_source or enterprise_source_from_pointer_file()
    source_data = read_enterprise_source_config(source)
    if source_data:
        merged = {**local_data, **source_data}
        merged["_enterpriseSource"] = source
        return merged
    return local_data if isinstance(local_data, dict) else {}


def enterprise_value(*keys):
    return dict_value(enterprise_config(), *keys)


def configured_agent_apk_path():
    return str(settings().get("agentApkPath") or enterprise_value("agentApkPath", "defaultAgentApkPath", "agentApk.path") or "").strip()


def configured_agent_server_jar_path():
    return str(settings().get("agentServerJarPath") or enterprise_value(
        "agentServerJarPath",
        "defaultAgentServerJarPath",
        "agentServerJar.path",
        "agent.serverJarPath",
        "agent.serverJar.path",
    ) or "").strip()


def default_adb_snippet_config():
    return json.loads(json.dumps(DEFAULT_ADB_SNIPPET_CONFIG, ensure_ascii=False))


def normalize_adb_snippet_config(value):
    if not isinstance(value, dict):
        return default_adb_snippet_config()
    normalized_groups = []
    for group in value.get("groups", []):
        if not isinstance(group, dict):
            continue
        title = str(group.get("title") or "未分组").strip() or "未分组"
        items = []
        for item in group.get("items", []):
            if not isinstance(item, dict):
                continue
            label = str(item.get("label") or "").strip()
            text = str(item.get("text") or "").strip()
            if not label or not text:
                continue
            normalized = {"label": label, "text": text}
            title_text = str(item.get("title") or "").strip()
            if title_text:
                normalized["title"] = title_text
            patch = item.get("patch")
            if isinstance(patch, dict):
                normalized["patch"] = {str(key): patch[key] for key in patch}
            items.append(normalized)
        if items:
            normalized_groups.append({"title": title, "items": items})
    return {"groups": normalized_groups} if normalized_groups else default_adb_snippet_config()


def migrate_legacy_dsl_snippet_group(config):
    """Replace the old catch-all DSL group with clearer built-in groups, preserving custom items."""
    groups = []
    custom_dsl_items = []
    changed = False
    for group in config.get("groups", []):
        title = str(group.get("title") or "")
        if title != LEGACY_DSL_SNIPPET_GROUP_TITLE:
            groups.append(group)
            continue
        changed = True
        for item in group.get("items", []):
            key = (str(item.get("label") or ""), str(item.get("text") or ""))
            if key not in LEGACY_DSL_SNIPPET_KEYS:
                custom_dsl_items.append(item)

    if not changed:
        return config

    if custom_dsl_items:
        custom_group = next((group for group in groups if str(group.get("title") or "") == "DSL：自定义"), None)
        if custom_group:
            custom_group.setdefault("items", []).extend(custom_dsl_items)
        else:
            groups.append({"title": "DSL：自定义", "items": custom_dsl_items})
    return {"groups": groups}


def merge_missing_default_snippets(config):
    """Append missing built-in snippet groups/items without overwriting user's custom snippets."""
    config = normalize_adb_snippet_config(config)
    config = migrate_legacy_dsl_snippet_group(config)
    default_config = default_adb_snippet_config()
    existing_groups = {str(group.get("title") or ""): group for group in config.get("groups", [])}
    for default_group in default_config.get("groups", []):
        title = str(default_group.get("title") or "未分组")
        if title not in existing_groups:
            config.setdefault("groups", []).append(default_group)
            existing_groups[title] = config["groups"][-1]
            continue
        group = existing_groups[title]
        existing_keys = {str(item.get("label")) + "\0" + str(item.get("text")) for item in group.get("items", [])}
        for item in default_group.get("items", []):
            key = str(item.get("label")) + "\0" + str(item.get("text"))
            if key not in existing_keys:
                group.setdefault("items", []).append(item)
                existing_keys.add(key)
    return config

def adb_snippets_response():
    ensure_data()
    try:
        raw = json.loads(ADB_SNIPPETS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return {
            "ok": False,
            "path": str(ADB_SNIPPETS_FILE),
            "config": default_adb_snippet_config(),
            "error": f"ADB 快捷命令配置 JSON 格式错误: {exc}",
        }
    merged = merge_missing_default_snippets(raw)
    if merged != raw:
        try:
            write_json(ADB_SNIPPETS_FILE, merged)
        except OSError:
            pass
    return {
        "ok": True,
        "path": str(ADB_SNIPPETS_FILE),
        "config": merged,
    }


def adb_bin():
    return settings()["adbPath"]


def configured_dir(value, fallback):
    path = str(value or "").strip()
    target = Path(path).expanduser() if path else fallback
    target.mkdir(parents=True, exist_ok=True)
    return target


def tmp_scripts_dir():
    return configured_dir(settings().get("localTempDir"), default_local_temp_dir_path())


def local_capture_dir(kind, serial=""):
    parts = [str(kind or "captures").strip() or "captures"]
    if serial:
        parts.append(safe_serial_dir(serial))
    target = tmp_scripts_dir().joinpath(*parts)
    target.mkdir(parents=True, exist_ok=True)
    return target


def preview_screenshot_dir(serial):
    return local_capture_dir("screenshots", serial)


def shell_quote_applescript(value):
    return str(value).replace("\\", "\\\\").replace('"', '\\"')


def shell_quote_powershell(value):
    return "'" + str(value).replace("'", "''") + "'"


def windows_pick_script(mode, title, start_dir, file_filter):
    title_value = shell_quote_powershell(title)
    start_value = shell_quote_powershell(start_dir)
    filter_value = shell_quote_powershell(file_filter)
    dialog_block = """
    if ($mode -eq 'directory') {
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description = $title
        $dialog.ShowNewFolderButton = $true
        if ([System.IO.Directory]::Exists($startDir)) {
            $dialog.SelectedPath = $startDir
        } elseif ([System.IO.File]::Exists($startDir)) {
            $dialog.SelectedPath = [System.IO.Path]::GetDirectoryName($startDir)
        }
        if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
            [Console]::WriteLine($dialog.SelectedPath)
        }
    } else {
        $dialog = New-Object System.Windows.Forms.OpenFileDialog
        $dialog.Title = $title
        $dialog.Filter = $filter
        $dialog.CheckFileExists = $true
        $dialog.Multiselect = $false
        if ([System.IO.Directory]::Exists($startDir)) {
            $dialog.InitialDirectory = $startDir
        } elseif ([System.IO.File]::Exists($startDir)) {
            $item = Get-Item -LiteralPath $startDir
            $dialog.InitialDirectory = $item.DirectoryName
            $dialog.FileName = $item.Name
        }
        if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
            [Console]::WriteLine($dialog.FileName)
        }
    }
"""
    return f"""
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding -ArgumentList $false
[System.Windows.Forms.Application]::EnableVisualStyles()
$mode = {shell_quote_powershell(mode)}
$title = {title_value}
$startDir = {start_value}
$filter = {filter_value}
$owner = New-Object System.Windows.Forms.Form
$owner.StartPosition = 'CenterScreen'
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.ShowInTaskbar = $false
$owner.TopMost = $true
$owner.Opacity = 0
$owner.Show()
$owner.Activate()
$dialog = $null
try {{
{dialog_block}
}} finally {{
    if ($dialog -ne $null) {{ $dialog.Dispose() }}
    $owner.Close()
    $owner.Dispose()
}}
"""


def pick_path(payload):
    mode = payload.get("mode") or "file"
    title = str(payload.get("title") or "选择路径")
    start_dir = str(payload.get("startDir") or "").strip()
    file_filter = str(payload.get("filter") or "所有文件 (*.*)|*.*")
    system = platform.system().lower()

    if system == "darwin":
        prompt = shell_quote_applescript(title)
        if mode == "directory":
            script = f'POSIX path of (choose folder with prompt "{prompt}")'
        else:
            script = f'POSIX path of (choose file with prompt "{prompt}")'
        result = run_process(["osascript", "-e", script], timeout=300)
        return {
            "ok": result["ok"],
            "path": result["stdout"].strip() if result["ok"] else "",
            "stderr": result["stderr"],
        }

    if system == "windows":
        script = windows_pick_script(mode, title, start_dir, file_filter)
        result = run_process(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-STA", "-Command", script], timeout=300)
        return {
            "ok": result["ok"],
            "path": result["stdout"].strip() if result["ok"] else "",
            "stderr": result["stderr"],
        }

    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        if mode == "directory":
            chosen = filedialog.askdirectory(title=title, initialdir=start_dir or None)
        else:
            chosen = filedialog.askopenfilename(title=title, initialdir=start_dir or None)
        root.destroy()
        return {"ok": bool(chosen), "path": chosen or "", "stderr": ""}
    except Exception as exc:
        return {"ok": False, "path": "", "stderr": str(exc)}


def open_local_path(path):
    target = Path(path).expanduser()
    system = platform.system().lower()
    if system == "darwin":
        return run_process(["open", str(target)], timeout=20)
    if system == "windows":
        try:
            os.startfile(str(target))
            return {
                "ok": True,
                "code": 0,
                "stdout": "",
                "stderr": "",
                "durationMs": 0,
                "command": ["startfile", str(target)],
            }
        except OSError as exc:
            return {
                "ok": False,
                "code": None,
                "stdout": "",
                "stderr": str(exc),
                "durationMs": 0,
                "command": ["startfile", str(target)],
            }
    return run_process(["xdg-open", str(target)], timeout=20)


def open_adb_snippets_config():
    ensure_data()
    result = open_local_path(ADB_SNIPPETS_FILE)
    return {
        "ok": result["ok"],
        "path": str(ADB_SNIPPETS_FILE),
        "stderr": result.get("stderr", ""),
        "result": result,
    }


def decode_process_output(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    encodings = ["utf-8", locale.getpreferredencoding(False), "gbk", "cp936", "big5"]
    tried = set()
    for encoding in encodings:
        if not encoding or encoding.lower() in tried:
            continue
        tried.add(encoding.lower())
        try:
            return value.decode(encoding)
        except UnicodeDecodeError:
            continue
        except LookupError:
            continue
    return value.decode("utf-8", errors="replace")


def hidden_subprocess_kwargs():
    """Hide adb/aapt console windows on Windows when launched from the server."""
    if os.name != "nt":
        return {}
    kwargs = {}
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    if creationflags:
        kwargs["creationflags"] = creationflags
    startupinfo_cls = getattr(subprocess, "STARTUPINFO", None)
    if startupinfo_cls:
        startupinfo = startupinfo_cls()
        startupinfo.dwFlags |= getattr(subprocess, "STARTF_USESHOWWINDOW", 1)
        startupinfo.wShowWindow = getattr(subprocess, "SW_HIDE", 0)
        kwargs["startupinfo"] = startupinfo
    return kwargs


def run_process(args, cwd=None, timeout=None, input_text=None):
    started = time.time()
    input_data = None if input_text is None else str(input_text).encode("utf-8")
    try:
        proc = subprocess.run(
            args,
            cwd=cwd or None,
            input=input_data,
            capture_output=True,
            timeout=timeout or None,
            **hidden_subprocess_kwargs(),
        )
        return {
            "ok": proc.returncode == 0,
            "code": proc.returncode,
            "stdout": decode_process_output(proc.stdout),
            "stderr": decode_process_output(proc.stderr),
            "durationMs": round((time.time() - started) * 1000),
            "command": args,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "code": None,
            "stdout": decode_process_output(exc.stdout),
            "stderr": f"Timeout after {timeout}s\n{decode_process_output(exc.stderr)}",
            "durationMs": round((time.time() - started) * 1000),
            "command": args,
        }
    except FileNotFoundError as exc:
        return {
            "ok": False,
            "code": None,
            "stdout": "",
            "stderr": str(exc),
            "durationMs": round((time.time() - started) * 1000),
            "command": args,
        }


def run_binary(args, timeout=None):
    started = time.time()
    try:
        proc = subprocess.run(args, capture_output=True, timeout=timeout or None, **hidden_subprocess_kwargs())
        return {
            "ok": proc.returncode == 0,
            "code": proc.returncode,
            "stdout": proc.stdout,
            "stderr": decode_process_output(proc.stderr),
            "durationMs": round((time.time() - started) * 1000),
            "command": args,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "code": None,
            "stdout": exc.stdout or b"",
            "stderr": f"Timeout after {timeout}s\n{decode_process_output(exc.stderr)}",
            "durationMs": round((time.time() - started) * 1000),
            "command": args,
        }
    except FileNotFoundError as exc:
        return {
            "ok": False,
            "code": None,
            "stdout": b"",
            "stderr": str(exc),
            "durationMs": round((time.time() - started) * 1000),
            "command": args,
        }


def desktop_clipboard_command(operation):
    system = platform.system().lower()
    if system == "darwin":
        return ["pbpaste"] if operation == "read" else ["pbcopy"]
    if system == "windows":
        powershell = shutil.which("powershell.exe") or shutil.which("powershell") or shutil.which("pwsh")
        if not powershell:
            return []
        if operation == "read":
            return [powershell, "-NoProfile", "-NonInteractive", "-Command", "[Console]::Out.Write((Get-Clipboard -Raw))"]
        return [powershell, "-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"]
    if operation == "read":
        for command in ("wl-paste", "xclip", "xsel"):
            found = shutil.which(command)
            if not found:
                continue
            if command == "wl-paste":
                return [found, "--no-newline"]
            if command == "xclip":
                return [found, "-selection", "clipboard", "-out"]
            return [found, "--clipboard", "--output"]
    else:
        for command in ("wl-copy", "xclip", "xsel"):
            found = shutil.which(command)
            if not found:
                continue
            if command == "wl-copy":
                return [found]
            if command == "xclip":
                return [found, "-selection", "clipboard", "-in"]
            return [found, "--clipboard", "--input"]
    return []


def desktop_clipboard(payload):
    operation = str(payload.get("operation") or "read").strip().lower()
    timeout = int(payload.get("timeout") or 5)
    if operation not in {"read", "write"}:
        raise ValueError(f"未知电脑剪切板操作: {operation}")
    command = desktop_clipboard_command(operation)
    if not command:
        return {
            "ok": False,
            "operation": operation,
            "text": "",
            "length": 0,
            "stderr": "当前系统没有可用的电脑剪切板命令",
        }
    if operation == "read":
        result = run_process(command, timeout=timeout)
        text = result.get("stdout") or ""
        return {
            "ok": result.get("ok"),
            "operation": operation,
            "text": text,
            "length": len(text),
            "result": result,
            "stdout": text,
            "stderr": result.get("stderr", ""),
        }
    text = str(payload.get("text") or "")
    result = run_process(command, timeout=timeout, input_text=text)
    return {
        "ok": result.get("ok"),
        "operation": operation,
        "text": text if result.get("ok") else "",
        "length": len(text),
        "result": result,
        "stdout": f"Desktop clipboard set: {len(text)} chars" if result.get("ok") else result.get("stdout", ""),
        "stderr": result.get("stderr", ""),
    }


def logcat_since_now_value(now=None):
    """Return a logcat -T timestamp matching the host start time.

    logcat -T keeps the process streaming while avoiding the historical
    device buffer that existed before the user clicked Start. It is safer
    than clearing the global device log buffer.
    """
    now = now or time.localtime()
    return time.strftime("%m-%d %H:%M:%S.000", now)


def logcat_command(serial="", since=None):
    command = [adb_bin()]
    serial = str(serial or "").strip()
    if serial:
        command.extend(["-s", serial])
    command.extend(["logcat", "-v", "threadtime"])
    if since:
        command.extend(["-T", str(since)])
    return command


def logcat_clear_command(serial=""):
    command = [adb_bin()]
    serial = str(serial or "").strip()
    if serial:
        command.extend(["-s", serial])
    command.extend(["logcat", "-c"])
    return command


def read_logcat_stdout(session_id):
    while True:
        with LOGCAT_LOCK:
            session = LOGCAT_SESSIONS.get(session_id)
            proc = session.get("proc") if session else None
        if not session or not proc or not proc.stdout:
            return
        try:
            line = proc.stdout.readline()
        except Exception as exc:
            with LOGCAT_LOCK:
                if session_id in LOGCAT_SESSIONS:
                    LOGCAT_SESSIONS[session_id].setdefault("stderr", []).append(str(exc))
                    LOGCAT_SESSIONS[session_id]["running"] = False
            return
        if line == "":
            with LOGCAT_LOCK:
                if session_id in LOGCAT_SESSIONS:
                    LOGCAT_SESSIONS[session_id]["running"] = False
                    LOGCAT_SESSIONS[session_id]["code"] = proc.poll()
            return
        with LOGCAT_LOCK:
            session = LOGCAT_SESSIONS.get(session_id)
            if not session:
                return
            session.setdefault("lines", []).append(line.rstrip("\n"))
            session["nextOffset"] = int(session.get("nextOffset", 0)) + 1
            overflow = len(session["lines"]) - LOGCAT_MAX_LINES
            if overflow > 0:
                del session["lines"][:overflow]
                session["baseOffset"] = int(session.get("baseOffset", 0)) + overflow


def read_logcat_stderr(session_id):
    while True:
        with LOGCAT_LOCK:
            session = LOGCAT_SESSIONS.get(session_id)
            proc = session.get("proc") if session else None
        if not session or not proc or not proc.stderr:
            return
        line = proc.stderr.readline()
        if line == "":
            return
        with LOGCAT_LOCK:
            session = LOGCAT_SESSIONS.get(session_id)
            if session:
                session.setdefault("stderr", []).append(line.rstrip("\n"))
                session["stderr"] = session["stderr"][-200:]


def stop_logcat_session(session_id):
    """Stop a logcat session quickly and idempotently.

    UI stop must not feel stuck. Older versions waited up to 3 seconds per
    adb logcat process, and repeated stop clicks could return 404 for a
    session that was already detached. Treat missing sessions as already
    stopped and use short waits so the HTTP request does not hold the UI.
    """
    session_id = str(session_id or "").strip()
    with LOGCAT_LOCK:
        session = LOGCAT_SESSIONS.get(session_id)
        proc = session.get("proc") if session else None
        if session:
            session["running"] = False
    if not session:
        return {"ok": True, "sessionId": session_id, "alreadyStopped": True}
    if proc and proc.poll() is None:
        try:
            proc.terminate()
            proc.wait(timeout=0.8)
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
                proc.wait(timeout=0.5)
            except Exception:
                pass
        except Exception:
            pass
    with LOGCAT_LOCK:
        if session_id in LOGCAT_SESSIONS:
            LOGCAT_SESSIONS[session_id]["running"] = False
            LOGCAT_SESSIONS[session_id]["code"] = proc.poll() if proc else None
    return {"ok": True, "sessionId": session_id}


def logcat_start(payload):
    serial = str(payload.get("serial") or "").strip()
    session_id = uuid.uuid4().hex
    # Default to logs generated after the user clicked Start.
    # Passing sinceNow=false keeps the legacy behavior for future debugging.
    since_now = payload.get("sinceNow", True) is not False
    since = str(payload.get("since") or "").strip() or (logcat_since_now_value() if since_now else "")
    command = logcat_command(serial, since=since)
    try:
        proc = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            **hidden_subprocess_kwargs(),
        )
    except FileNotFoundError as exc:
        return {"ok": False, "error": str(exc), "command": command}
    session = {
        "id": session_id,
        "serial": serial,
        "command": command,
        "proc": proc,
        "lines": [],
        "stderr": [],
        "baseOffset": 0,
        "nextOffset": 0,
        "running": True,
        "startedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "since": since,
    }
    with LOGCAT_LOCK:
        LOGCAT_SESSIONS[session_id] = session
    threading.Thread(target=read_logcat_stdout, args=(session_id,), daemon=True).start()
    threading.Thread(target=read_logcat_stderr, args=(session_id,), daemon=True).start()
    return {"ok": True, "sessionId": session_id, "serial": serial, "command": command, "offset": 0, "since": since}


def logcat_poll(query):
    session_id = (query.get("sessionId") or [""])[0]
    offset = int((query.get("offset") or ["0"])[0] or 0)
    limit = max(1, min(10000, int((query.get("limit") or ["2000"])[0] or 2000)))
    with LOGCAT_LOCK:
        session = LOGCAT_SESSIONS.get(session_id)
        if not session:
            return {"ok": False, "error": "logcat session 不存在", "lines": [], "nextOffset": offset, "running": False}
        base = int(session.get("baseOffset", 0))
        next_offset = int(session.get("nextOffset", base))
        safe_offset = max(offset, base)
        start = max(0, safe_offset - base)
        end = min(len(session.get("lines", [])), start + limit)
        lines = list(session.get("lines", [])[start:end])
        poll_offset = base + end
        return {
            "ok": True,
            "sessionId": session_id,
            "serial": session.get("serial", ""),
            "lines": lines,
            "baseOffset": base,
            "nextOffset": poll_offset,
            "latestOffset": next_offset,
            "hasMore": poll_offset < next_offset,
            "running": bool(session.get("running")),
            "stderr": "\n".join(session.get("stderr", [])[-20:]),
        }


def logcat_clear(payload):
    session_id = str(payload.get("sessionId") or "").strip()
    serial = str(payload.get("serial") or "").strip()
    display_only = bool(payload.get("displayOnly"))
    if session_id:
        with LOGCAT_LOCK:
            session = LOGCAT_SESSIONS.get(session_id)
            if session:
                session["lines"] = []
                session["baseOffset"] = 0
                session["nextOffset"] = 0
                serial = serial or session.get("serial", "")
    if display_only:
        return {"ok": True, "sessionId": session_id, "serial": serial, "displayOnly": True}
    result = run_process(logcat_clear_command(serial), timeout=10)
    return {"ok": result["ok"], "sessionId": session_id, "serial": serial, "result": result}


def format_file_size(size):
    value = float(size or 0)
    for unit in ["B", "KB", "MB", "GB"]:
        if value < 1024 or unit == "GB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{int(size or 0)} B"


def storage_categories(current_settings=None):
    current_settings = current_settings or settings()
    output_dir = Path(current_settings.get("quickOutputDir") or default_quick_output_dir_path()).expanduser()
    temp_dir = Path(current_settings.get("localTempDir") or default_local_temp_dir_path()).expanduser()
    return {
        "screenshots": [DATA_DIR / "screenshots", output_dir, temp_dir / "screenshots"],
        "dump": [DATA_DIR / "dump", DATA_DIR / "inspector", temp_dir / "dump", temp_dir / "inspector"],
        "logs": [DATA_DIR / "logs"],
        "apk": [DATA_DIR / "apk-cache"],
        "app_cache": [APP_ICON_CACHE_DIR, DATA_DIR],
        "default_output": [output_dir],
        "local_temp": [temp_dir, DEFAULT_TMP_SCRIPTS_DIR],
        "tmp_scripts": [temp_dir, DEFAULT_TMP_SCRIPTS_DIR],
        "workflow_exports": [DATA_DIR / "workflow-exports"],
    }


def is_safe_storage_root(path):
    try:
        resolved = Path(path).expanduser().resolve()
        data_root = DATA_DIR.resolve()
    except OSError:
        return False
    if resolved == data_root or data_root in resolved.parents:
        return True
    safe_names = {"cqclaw-output", "adb-command-box-output", "android-automation-studio-output"}
    return resolved.name in safe_names


def collect_path_strings(value):
    paths = []
    if isinstance(value, dict):
        for item in value.values():
            paths.extend(collect_path_strings(item))
    elif isinstance(value, list):
        for item in value:
            paths.extend(collect_path_strings(item))
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            return paths
        looks_like_path = text.startswith(("~", "/", "\\")) or re.match(r"^[A-Za-z]:[\\/]", text) or "/" in text or "\\" in text
        if looks_like_path:
            paths.append(text)
    return paths


def active_workflow_file_paths():
    protected = set()
    for text in collect_path_strings(read_json(PROFILES_FILE, [])):
        try:
            path = Path(text).expanduser()
            if path.exists() and path.is_file():
                protected.add(path.resolve())
        except OSError:
            continue
    return protected


def protected_storage_paths():
    protected = {
        PROFILES_FILE.resolve(),
        SETTINGS_FILE.resolve(),
        ADB_SNIPPETS_FILE.resolve(),
        LOGS_FILE.resolve(),
        APP_INFO_CACHE_FILE.resolve(),
        APP_ICON_CACHE_INDEX_FILE.resolve(),
        APP_LABEL_CACHE_FILE.resolve(),
        KNOWN_LABELS_FILE.resolve(),
    }
    protected.update(active_workflow_file_paths())
    return protected


def is_protected_storage_file(path, category, now=None, protected=None):
    now = now or time.time()
    protected = protected or protected_storage_paths()
    try:
        resolved = Path(path).resolve()
    except OSError:
        return True
    if category != "app_cache" and resolved in protected:
        return True
    if resolved.is_symlink():
        return True
    if category == "logs":
        try:
            if now - resolved.stat().st_mtime < 24 * 60 * 60:
                return True
        except OSError:
            return True
    return False


def matches_storage_category(path, category):
    name = path.name.lower()
    suffix = path.suffix.lower()
    parts = {part.lower() for part in path.parts}
    if category == "screenshots":
        return suffix in {".png", ".jpg", ".jpeg", ".webp"} and ("screenshot" in name or "screen" in name)
    if category == "dump":
        return "inspector" in parts or "dump" in parts or suffix in {".xml", ".uix"}
    if category == "logs":
        return suffix in {".log", ".txt"} or "logs" in parts
    if category == "apk":
        return suffix in {".apk", ".apks", ".aab"} or "apk-cache" in parts
    if category == "app_cache":
        app_cache_files = {
            APP_INFO_CACHE_FILE.name.lower(),
            APP_ICON_CACHE_INDEX_FILE.name.lower(),
            APP_LABEL_CACHE_FILE.name.lower(),
            KNOWN_LABELS_FILE.name.lower(),
        }
        return "app_icons" in parts or name in app_cache_files
    if category == "default_output":
        return True
    if category == "local_temp":
        return True
    if category == "tmp_scripts":
        script_suffixes = {".py", ".sh", ".cmd", ".bat", ".ps1"}
        return name.startswith("inline-") or suffix in script_suffixes
    if category == "workflow_exports":
        return suffix == ".json" and ("workflow" in name or "export" in name or "workflow-exports" in parts)
    return False


def iter_storage_files(category, older_than_days=None):
    categories = storage_categories()
    roots = categories.get(category, [])
    cutoff = time.time() - float(older_than_days) * 24 * 60 * 60 if older_than_days else None
    seen = set()
    protected = protected_storage_paths()
    for root in roots:
        root = Path(root).expanduser()
        if not root.exists() or not is_safe_storage_root(root):
            continue
        try:
            candidates = root.rglob("*")
        except OSError:
            continue
        for path in candidates:
            try:
                resolved = path.resolve()
                stat = path.stat()
            except OSError:
                continue
            if resolved in seen or not path.is_file():
                continue
            seen.add(resolved)
            if not matches_storage_category(path, category):
                continue
            if cutoff and stat.st_mtime >= cutoff:
                continue
            if is_protected_storage_file(path, category, protected=protected):
                continue
            yield path, stat


def storage_file_entry(path, stat):
    return {
        "path": str(path),
        "name": path.name,
        "size": stat.st_size,
        "sizeText": format_file_size(stat.st_size),
        "modified": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(stat.st_mtime)),
    }


def storage_root_entries(category):
    entries = []
    seen = set()
    for root in storage_categories().get(category, []):
        path = Path(root).expanduser()
        try:
            resolved = path.resolve()
        except OSError:
            resolved = path.absolute()
        path_text = str(resolved)
        if path_text in seen:
            continue
        seen.add(path_text)
        entries.append({
            "path": path_text,
            "exists": resolved.exists(),
            "safe": is_safe_storage_root(resolved),
        })
    return entries


def safe_storage_roots(category):
    return [Path(item["path"]) for item in storage_root_entries(category) if item.get("safe")]


def storage_stats():
    result = []
    for key, meta in STORAGE_CATEGORY_META.items():
        entries = [storage_file_entry(path, stat) for path, stat in iter_storage_files(key)]
        last_modified = max((item["modified"] for item in entries), default="-")
        total_size = sum(item["size"] for item in entries)
        result.append({
            "key": key,
            "label": meta["label"],
            "count": len(entries),
            "totalSize": total_size,
            "totalSizeText": format_file_size(total_size),
            "lastModified": last_modified,
            "roots": storage_root_entries(key),
        })
    return {"ok": True, "categories": result}


def storage_preview(payload):
    category = str(payload.get("category") or "").strip()
    older_than_days = payload.get("olderThanDays")
    limit = max(1, min(500, int(payload.get("limit") or 200)))
    keys = list(STORAGE_CATEGORY_META) if category in {"older_than_days", "all"} else [category]
    entries = []
    for key in keys:
        if key not in STORAGE_CATEGORY_META:
            continue
        for path, stat in iter_storage_files(key, older_than_days=older_than_days):
            item = storage_file_entry(path, stat)
            item["category"] = key
            item["label"] = STORAGE_CATEGORY_META[key]["label"]
            entries.append(item)
            if len(entries) >= limit:
                break
    total_size = sum(item["size"] for item in entries)
    return {
        "ok": True,
        "category": category,
        "olderThanDays": older_than_days,
        "items": entries,
        "count": len(entries),
        "totalSize": total_size,
        "totalSizeText": format_file_size(total_size),
        "truncated": len(entries) >= limit,
    }


def storage_open(payload):
    category = str(payload.get("category") or "").strip()
    if category not in STORAGE_CATEGORY_META:
        return {"ok": False, "error": "未知资源类型"}
    roots = safe_storage_roots(category)
    if not roots:
        return {"ok": False, "error": "没有可打开的安全目录"}

    requested = str(payload.get("path") or "").strip()
    if requested:
        try:
            target = Path(requested).expanduser().resolve()
        except OSError:
            return {"ok": False, "error": "路径不可访问"}
        allowed = False
        for root in roots:
            try:
                resolved_root = root.resolve()
            except OSError:
                resolved_root = root.absolute()
            if target == resolved_root or resolved_root in target.parents:
                allowed = True
                break
        if not allowed:
            return {"ok": False, "error": "路径不属于当前资源类型"}
    else:
        target = next((root for root in roots if root.exists()), roots[0])

    if target.is_file():
        target = target.parent
    try:
        target.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    result = open_local_path(target)
    return {
        "ok": bool(result.get("ok")),
        "path": str(target),
        "stderr": result.get("stderr", ""),
        "result": result,
    }


def storage_clean(payload):
    if not payload.get("confirm"):
        return {"ok": False, "error": "清理前需要确认"}
    category = str(payload.get("category") or "").strip()
    older_than_days = payload.get("olderThanDays")
    keys = list(STORAGE_CATEGORY_META) if category in {"older_than_days", "all"} else [category]
    deleted = []
    errors = []
    for key in keys:
        if key not in STORAGE_CATEGORY_META:
            continue
        for path, stat in iter_storage_files(key, older_than_days=older_than_days):
            entry = storage_file_entry(path, stat)
            entry["category"] = key
            try:
                path.unlink()
                deleted.append(entry)
            except OSError as exc:
                errors.append({"path": str(path), "error": str(exc)})
    return {
        "ok": not errors,
        "deleted": deleted,
        "deletedCount": len(deleted),
        "errors": errors,
        "freedSize": sum(item["size"] for item in deleted),
        "freedSizeText": format_file_size(sum(item["size"] for item in deleted)),
    }


def parse_devices(output):
    current_settings = settings()
    aliases = current_settings.get("deviceAliases", {})
    groups = current_settings.get("deviceGroups", {})
    devices = []
    for line in output.splitlines()[1:]:
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        serial = parts[0]
        state = parts[1] if len(parts) > 1 else "unknown"
        meta = {}
        for item in parts[2:]:
            if ":" in item:
                key, value = item.split(":", 1)
                meta[key] = value
        devices.append({
            "serial": serial,
            "state": state,
            "model": meta.get("model", ""),
            "product": meta.get("product", ""),
            "transport": meta.get("transport_id", ""),
            "alias": aliases.get(serial, ""),
            "groups": groups.get(serial, ""),
            "raw": line,
        })
    return devices


def adb_prefix(serial):
    return [adb_bin(), "-s", serial]


DEVICE_STEP_KINDS = {
    "install_apk",
    "pull_file",
    "push_file",
    "screenshot",
    "screen_record",
    "app_action",
    "permission_grant",
    "adb_shell",
    "adb_raw",
    "adb_script",
    "input_text",
    "set_clipboard",
    "agent_clipboard",
    "keyevent",
    "tap_text",
}


def step_scope(step):
    return "per_device" if step.get("kind") in DEVICE_STEP_KINDS else "once"


def active_steps(steps):
    return [step for step in steps if step.get("enabled", True) is not False]


def device_contexts():
    result = run_process([adb_bin(), "devices", "-l"], timeout=10)
    contexts = {}
    for device in parse_devices(result["stdout"]):
        contexts[device["serial"]] = {
            "serial": device["serial"],
            "alias": device.get("alias") or device["serial"],
            "model": device.get("model") or "",
            "product": device.get("product") or "",
            "groups": device.get("groups") or "",
        }
    return contexts


def variable_context(serial=None, contexts=None):
    now = time.localtime()
    context = {
        "serial": serial or "",
        "alias": serial or "",
        "model": "",
        "product": "",
        "groups": "",
        "date": time.strftime("%Y%m%d", now),
        "time": time.strftime("%H%M%S", now),
        "datetime": time.strftime("%Y%m%d-%H%M%S", now),
    }
    if serial and contexts and serial in contexts:
        context.update(contexts[serial])
    return context


def expand_text(value, context):
    text = str(value)
    for key, replacement in context.items():
        text = text.replace("{" + key + "}", str(replacement))
    return text


def expand_step(step, serial=None, contexts=None):
    context = variable_context(serial, contexts)
    expanded = {}
    for key, value in step.items():
        if key == "code":
            expanded[key] = value
        elif isinstance(value, str):
            expanded[key] = expand_text(value, context)
        else:
            expanded[key] = value
    return expanded


def split_args(value):
    if not value:
        return []
    if isinstance(value, list):
        return [str(x) for x in value if str(x).strip()]
    return shlex.split(str(value), posix=os.name != "nt")


def shell_quote_arg(value):
    text = str(value)
    if os.name == "nt":
        return subprocess.list2cmdline([text])
    return shlex.quote(text)


def command_text(args):
    return " ".join(shell_quote_arg(arg) for arg in args)


def shell_command_args(command_text):
    if os.name == "nt":
        return ["cmd.exe", "/c", command_text]
    return ["/bin/sh", "-lc", command_text]


def executable_name(path):
    cleaned = str(path or "").strip().strip("\"'")
    return cleaned.replace("\\", "/").rsplit("/", 1)[-1].lower()


def first_command_token(line):
    raw = str(line)
    length = len(raw)
    index = 0
    while index < length and raw[index].isspace():
        index += 1
    prefix = raw[:index]
    if index < length and raw[index] == "@":
        index += 1
        while index < length and raw[index].isspace():
            index += 1
    if index >= length:
        return None
    start = index
    quote = raw[index] if raw[index] in ("'", '"') else ""
    if quote:
        index += 1
        escaped = False
        while index < length:
            char = raw[index]
            if char == quote and not escaped:
                index += 1
                break
            escaped = char == "\\" and not escaped
            if char != "\\":
                escaped = False
            index += 1
        token_raw = raw[start:index]
        token_value = token_raw[1:-1] if len(token_raw) >= 2 and token_raw[-1] == quote else token_raw
    else:
        while index < length and not raw[index].isspace():
            index += 1
        token_raw = raw[start:index]
        token_value = token_raw
    return {
        "prefix": prefix,
        "tokenRaw": token_raw,
        "tokenValue": token_value,
        "rest": raw[index:],
    }


def is_adb_executable(token):
    return executable_name(token) in {"adb", "adb.exe"}


def split_script_line(line):
    text = str(line).strip()
    if text.startswith("@"):
        text = text[1:].lstrip()
    try:
        return shlex.split(text, posix=os.name != "nt")
    except ValueError:
        return text.split()


ADB_SELECTOR_NO_VALUE_FLAGS = {"-d", "-e"}
ADB_GLOBAL_VALUE_FLAGS = {"-H", "-P", "-L"}
ADB_GLOBAL_NO_VALUE_FLAGS = {"-a"}
ADB_HOST_COMMANDS = {
    "connect",
    "devices",
    "disconnect",
    "help",
    "keygen",
    "kill-server",
    "mdns",
    "pair",
    "server-status",
    "start-server",
    "track-devices",
    "version",
}


def adb_line_selector(tokens):
    index = 1
    while index < len(tokens):
        token = tokens[index]
        if token in {"-s", "--serial"}:
            return {
                "kind": "serial",
                "value": tokens[index + 1] if index + 1 < len(tokens) else "",
                "flag": token,
            }
        if token.startswith("--serial="):
            return {"kind": "serial", "value": token.split("=", 1)[1], "flag": "--serial"}
        if token in {"-t", "--transport-id", "--one-device"}:
            return {
                "kind": "selector",
                "value": tokens[index + 1] if index + 1 < len(tokens) else "",
                "flag": token,
            }
        if token.startswith("--transport-id=") or token.startswith("--one-device="):
            flag, value = token.split("=", 1)
            return {"kind": "selector", "value": value, "flag": flag}
        if token in ADB_SELECTOR_NO_VALUE_FLAGS:
            return {"kind": "selector", "value": "", "flag": token}
        if token in ADB_GLOBAL_VALUE_FLAGS:
            index += 2
            continue
        if any(token.startswith(prefix) and token != prefix for prefix in ADB_GLOBAL_VALUE_FLAGS):
            index += 1
            continue
        if token in ADB_GLOBAL_NO_VALUE_FLAGS:
            index += 1
            continue
        if token.startswith("-"):
            index += 1
            continue
        break
    return {"kind": "none", "value": "", "flag": ""}


def adb_subcommand(tokens):
    index = 1
    while index < len(tokens):
        token = tokens[index]
        if token in {"-s", "--serial", "-t", "--transport-id", "--one-device"}:
            index += 2
            continue
        if token.startswith("--serial=") or token.startswith("--transport-id=") or token.startswith("--one-device="):
            index += 1
            continue
        if token in ADB_SELECTOR_NO_VALUE_FLAGS:
            index += 1
            continue
        if token in ADB_GLOBAL_VALUE_FLAGS:
            index += 2
            continue
        if any(token.startswith(prefix) and token != prefix for prefix in ADB_GLOBAL_VALUE_FLAGS):
            index += 1
            continue
        if token in ADB_GLOBAL_NO_VALUE_FLAGS:
            index += 1
            continue
        if token.startswith("-"):
            index += 1
            continue
        return token.lower()
    return ""


def ignored_adb_script_line(line):
    text = str(line).strip()
    lower = text.lower()
    return (
        not text
        or text.startswith("#")
        or text.startswith("//")
        or text.startswith("::")
        or lower == "echo off"
        or lower == "@echo off"
        or lower.startswith("rem ")
    )


def replace_adb_executable(token_info, serial=None):
    adb_text = shell_quote_arg(adb_bin())
    if serial:
        return f"{token_info['prefix']}{adb_text} -s {shell_quote_arg(serial)}{token_info['rest']}"
    return f"{token_info['prefix']}{adb_text}{token_info['rest']}"


DSL_CALL_NAMES = {
    "tapText",
    "tapTextContains",
    "tapTextExact",
    "tapTextRegex",
    "tapById",
    "tapId",
    "longPressText",
    "longPressId",
    "tapTextAny",
    "textExists",
    "waitText",
    "waitId",
    "waitAnyText",
    "waitAllText",
    "waitTextAndTap",
    "waitToast",
    "assertText",
    "assertTextContains",
    "assertId",
    "assertExists",
    "assertToast",
    "assertActivity",
    "tap",
    "doubleTap",
    "longPress",
    "swipe",
    "tapPercent",
    "tapBottomCenter",
    "tapTopRight",
    "swipeUp",
    "swipeDown",
    "swipeLeft",
    "swipeRight",
    "scrollDown",
    "scrollUp",
    "scrollToText",
    "scrollUntil",
    "inputText",
    "inputChinese",
    "setClipboard",
    "paste",
    "clearText",
    "clearAndInput",
    "launchApp",
    "killApp",
    "restartApp",
    "clearAppData",
    "currentActivity",
    "currentPackage",
    "isAppInForeground",
    "installApk",
    "uninstall",
    "screenshot",
    "screenshotOnFail",
    "dumpUI",
    "log",
    "handlePermission",
    "autoClosePopup",
    "sleep",
    "wait",
}
DSL_BLOCK_NAMES = {"retry", "ifTextExists", "ifTextContains", "ifTextExact", "ifTextRegex"}


def normalize_script_lines(script_text):
    lines = []
    for line_no, raw in enumerate(script_text.replace("\r\n", "\n").split("\n"), 1):
        stripped = raw.strip()
        same_line_else = re.fullmatch(r"\}\s*else\s*(.*)", stripped)
        if same_line_else:
            else_tail = same_line_else.group(1).strip()
            lines.append((line_no, "}"))
            lines.append((line_no, f"else {else_tail}".strip()))
        else:
            lines.append((line_no, raw))
    return lines


def parse_dsl_call(text):
    cleaned = str(text or "").strip().rstrip(";").strip()
    match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)", cleaned)
    if not match:
        return None
    name = match.group(1)
    if name not in DSL_CALL_NAMES and name not in DSL_BLOCK_NAMES:
        return None
    return name, parse_dsl_args(match.group(2))


def parse_dsl_args(raw_args):
    text = str(raw_args or "").strip()
    if not text:
        return []
    text = re.sub(r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r"\1'\2':", text)
    text = re.sub(r"\btrue\b", "True", text)
    text = re.sub(r"\bfalse\b", "False", text)
    text = re.sub(r"\bnull\b", "None", text)
    try:
        value = ast.literal_eval(f"[{text}]")
    except (SyntaxError, ValueError) as exc:
        raise ValueError(f"DSL 参数解析失败: {raw_args}") from exc
    return value




DSL_SIGNATURES = {
    "tapText": {"min": 1, "max": 2, "args": "tapText(text, options?)"},
    "tapTextContains": {"min": 1, "max": 2, "args": "tapTextContains(text, options?)"},
    "tapTextExact": {"min": 1, "max": 2, "args": "tapTextExact(text, options?)"},
    "tapTextRegex": {"min": 1, "max": 2, "args": "tapTextRegex(pattern, options?)"},
    "tapById": {"min": 1, "max": 2, "args": "tapById(resourceId, options?)"},
    "tapId": {"min": 1, "max": 2, "args": "tapId(resourceId, options?)"},
    "longPressText": {"min": 1, "max": 3, "args": "longPressText(text, durationMs?, options?)"},
    "longPressId": {"min": 1, "max": 3, "args": "longPressId(resourceId, durationMs?, options?)"},
    "tapTextAny": {"min": 1, "max": 2, "args": "tapTextAny([text...], options?)"},
    "textExists": {"min": 1, "max": 2, "args": "textExists(text, options?)"},
    "waitText": {"min": 1, "max": 3, "args": "waitText(text, timeoutMs?, options?)"},
    "waitId": {"min": 1, "max": 3, "args": "waitId(resourceId, timeoutMs?, options?)"},
    "waitAnyText": {"min": 1, "max": 3, "args": "waitAnyText([text...], timeoutMs?, options?)"},
    "waitAllText": {"min": 1, "max": 3, "args": "waitAllText([text...], timeoutMs?, options?)"},
    "waitTextAndTap": {"min": 1, "max": 3, "args": "waitTextAndTap(text, timeoutMs?, options?)"},
    "waitToast": {"min": 1, "max": 2, "args": "waitToast(text, timeoutMs?)"},
    "assertText": {"min": 1, "max": 2, "args": "assertText(text, options?)"},
    "assertTextContains": {"min": 1, "max": 2, "args": "assertTextContains(text, options?)"},
    "assertId": {"min": 1, "max": 2, "args": "assertId(resourceId, options?)"},
    "assertExists": {"min": 1, "max": 2, "args": "assertExists(text, options?)"},
    "assertToast": {"min": 1, "max": 2, "args": "assertToast(text, timeoutMs?)"},
    "assertActivity": {"min": 1, "max": 1, "args": "assertActivity(activityName)"},
    "tap": {"min": 2, "max": 2, "args": "tap(x, y)"},
    "doubleTap": {"min": 2, "max": 2, "args": "doubleTap(x, y)"},
    "longPress": {"min": 2, "max": 3, "args": "longPress(x, y, durationMs?)"},
    "swipe": {"min": 4, "max": 5, "args": "swipe(x1, y1, x2, y2, durationMs?)"},
    "tapPercent": {"min": 2, "max": 2, "args": "tapPercent(xPercent, yPercent)"},
    "tapBottomCenter": {"min": 0, "max": 0, "args": "tapBottomCenter()"},
    "tapTopRight": {"min": 0, "max": 0, "args": "tapTopRight()"},
    "swipeUp": {"min": 0, "max": 0, "args": "swipeUp()"},
    "swipeDown": {"min": 0, "max": 0, "args": "swipeDown()"},
    "swipeLeft": {"min": 0, "max": 0, "args": "swipeLeft()"},
    "swipeRight": {"min": 0, "max": 0, "args": "swipeRight()"},
    "scrollDown": {"min": 0, "max": 0, "args": "scrollDown()"},
    "scrollUp": {"min": 0, "max": 0, "args": "scrollUp()"},
    "scrollToText": {"min": 1, "max": 3, "args": "scrollToText(text, maxSwipes?, options?)"},
    "scrollUntil": {"min": 1, "max": 3, "args": "scrollUntil(text, maxSwipes?, options?)"},
    "inputText": {"min": 1, "max": 1, "args": "inputText(text)"},
    "inputChinese": {"min": 1, "max": 1, "args": "inputChinese(text)"},
    "setClipboard": {"min": 1, "max": 1, "args": "setClipboard(text)"},
    "paste": {"min": 0, "max": 0, "args": "paste()"},
    "clearText": {"min": 0, "max": 0, "args": "clearText()"},
    "clearAndInput": {"min": 1, "max": 1, "args": "clearAndInput(text)"},
    "launchApp": {"min": 1, "max": 1, "args": "launchApp(packageName)"},
    "killApp": {"min": 1, "max": 1, "args": "killApp(packageName)"},
    "restartApp": {"min": 1, "max": 1, "args": "restartApp(packageName)"},
    "clearAppData": {"min": 1, "max": 1, "args": "clearAppData(packageName)"},
    "installApk": {"min": 1, "max": 2, "args": "installApk(path, options?)"},
    "uninstall": {"min": 1, "max": 1, "args": "uninstall(packageName)"},
    "currentActivity": {"min": 0, "max": 0, "args": "currentActivity()"},
    "currentPackage": {"min": 0, "max": 0, "args": "currentPackage()"},
    "isAppInForeground": {"min": 1, "max": 1, "args": "isAppInForeground(packageName)"},
    "screenshot": {"min": 0, "max": 1, "args": "screenshot(name?)"},
    "screenshotOnFail": {"min": 0, "max": 1, "args": "screenshotOnFail(name?)"},
    "dumpUI": {"min": 0, "max": 1, "args": "dumpUI(name?)"},
    "log": {"min": 1, "max": 1, "args": "log(message)"},
    "handlePermission": {"min": 0, "max": 0, "args": "handlePermission()"},
    "autoClosePopup": {"min": 0, "max": 0, "args": "autoClosePopup()"},
    "sleep": {"min": 1, "max": 1, "args": "sleep(ms)"},
    "wait": {"min": 1, "max": 1, "args": "wait(ms)"},
    "ifTextExists": {"min": 1, "max": 2, "args": "ifTextExists(text, options?) { ... }"},
    "ifTextContains": {"min": 1, "max": 2, "args": "ifTextContains(text, options?) { ... }"},
    "ifTextExact": {"min": 1, "max": 2, "args": "ifTextExact(text, options?) { ... }"},
    "ifTextRegex": {"min": 1, "max": 2, "args": "ifTextRegex(pattern, options?) { ... }"},
    "retry": {"min": 1, "max": 1, "args": "retry(count) { ... }"},
}


def validate_dsl_call_args(name, args, line_no=None):
    """Return human-friendly DSL signature issues without executing a device command."""
    spec = DSL_SIGNATURES.get(name)
    if not spec:
        return []
    prefix = f"第 {line_no} 行" if line_no else "DSL"
    count = len(args or [])
    issues = []
    if count < spec["min"] or count > spec["max"]:
        issues.append(f"{prefix} {name} 参数数量不正确，应写：{spec['args']}")
    if args:
        first = args[0]
        if name in {"tapText", "tapTextContains", "tapTextExact", "tapTextRegex", "tapById", "tapId", "longPressText", "longPressId", "textExists", "waitText", "waitId", "waitTextAndTap", "assertText", "assertTextContains", "assertId", "assertExists", "inputText", "inputChinese", "setClipboard"}:
            if not isinstance(first, str) or not first.strip():
                issues.append(f"{prefix} {name} 的第 1 个参数必须是非空字符串")
        if name in {"tapTextAny", "waitAnyText", "waitAllText"}:
            if not isinstance(first, (list, tuple)) or not first or not all(isinstance(item, str) and item.strip() for item in first):
                issues.append(f"{prefix} {name} 的第 1 个参数必须是非空字符串数组")
    if name in {"longPressText", "longPressId"} and len(args or []) >= 2 and not isinstance(args[1], dict):
        try:
            duration = int(args[1])
            if duration < 300 or duration > 10000:
                issues.append(f"{prefix} {name} 的长按时长建议在 300~10000ms 之间")
        except Exception:
            issues.append(f"{prefix} {name} 的第 2 个参数应为长按毫秒数或 options 对象")
    return issues


def walk_script_units(units):
    for unit in units or []:
        yield unit
        if unit.get("kind") == "block":
            yield from walk_script_units(unit.get("body") or [])
            yield from walk_script_units(unit.get("elseBody") or [])


def lint_adb_script_text(script_text, allow_local=False):
    """Parse DSL/ADB script and return structured issues with line numbers.

    This is intentionally side-effect free and can be used by tests, preview, and future editor hints.
    """
    warnings = []
    issues = []
    try:
        units, _ = parse_adb_script_block(normalize_script_lines(script_text), 0, serial="__SERIAL__", allow_local=allow_local, warnings=warnings, top_level=True)
    except ValueError as exc:
        return {"ok": False, "issues": [{"line": None, "message": str(exc)}], "warnings": warnings, "units": []}
    for unit in walk_script_units(units):
        if unit.get("kind") in {"dsl", "block"}:
            for message in validate_dsl_call_args(unit.get("name"), unit.get("args") or [], unit.get("line")):
                issues.append({"line": unit.get("line"), "message": message})
    return {"ok": not issues, "issues": issues, "warnings": warnings, "units": units}


def prepare_adb_or_local_line(line, line_no, serial, allow_local, warnings):
    token_info = first_command_token(line)
    if not token_info:
        return None
    line_label = f"第 {line_no} 行"
    if not is_adb_executable(token_info["tokenValue"]):
        if not allow_local:
            raise ValueError(f"{line_label} 不是 adb 命令，也不是支持的 DSL：{line.strip()}。如确实要执行本机命令，请开启“允许非 adb 行”。")
        return {
            "kind": "run",
            "line": line_no,
            "action": "run",
            "commandText": line.strip(),
            "display": line.strip(),
            "local": True,
        }

    tokens = split_script_line(line)
    selector = adb_line_selector(tokens)
    if selector["kind"] == "serial":
        if not selector["value"]:
            raise ValueError(f"{line_label} 的 {selector['flag']} 后面缺少设备序列号")
        if serial and selector["value"] != serial:
            message = f"{line_label} 跳过：脚本固定设备 {selector['value']}，当前设备 {serial}"
            warnings.append(message)
            return {
                "kind": "skip",
                "line": line_no,
                "action": "skip",
                "display": message,
                "stdout": message + "\n",
            }
        command_text_value = replace_adb_executable(token_info)
    elif selector["kind"] == "selector":
        command_text_value = replace_adb_executable(token_info)
        warnings.append(f"{line_label} 已包含 {selector['flag']}，不会自动补 -s")
    else:
        subcommand = adb_subcommand(tokens)
        if subcommand in ADB_HOST_COMMANDS:
            command_text_value = replace_adb_executable(token_info)
            warnings.append(f"{line_label} 是 adb {subcommand}，不会自动补 -s")
        elif not serial:
            raise ValueError("ADB 脚本需要选择设备")
        else:
            command_text_value = replace_adb_executable(token_info, serial)

    return {
        "kind": "run",
        "line": line_no,
        "action": "run",
        "commandText": command_text_value.strip(),
        "display": command_text_value.strip(),
        "local": False,
    }


def parse_optional_else_block(lines, index, serial, allow_local, warnings, parent_name):
    if not parent_name.startswith("if") or index >= len(lines):
        return [], index
    next_line_no, next_line = lines[index]
    next_text = next_line.strip()
    if next_text == "else {":
        return parse_adb_script_block(lines, index + 1, serial, allow_local, warnings)
    if next_text == "else":
        if index + 1 >= len(lines) or lines[index + 1][1].strip() != "{":
            raise ValueError(f"第 {next_line_no} 行 else 后面需要写 {{")
        return parse_adb_script_block(lines, index + 2, serial, allow_local, warnings)
    if next_text.startswith("else ") and next_text.endswith("{"):
        block, next_index = parse_dsl_block_unit(lines, index, serial, allow_local, warnings, allow_else_prefix=True)
        if not block or not block["name"].startswith("if"):
            raise ValueError(f"第 {next_line_no} 行 else 后面只能接 {{ 或 ifText... 块")
        return [block], next_index
    return [], index


def parse_dsl_block_unit(lines, index, serial, allow_local, warnings, allow_else_prefix=False):
    line_no, line = lines[index]
    stripped = line.strip()
    if allow_else_prefix and stripped.startswith("else "):
        stripped = stripped[5:].strip()
    if not stripped.endswith("{"):
        return None, index
    head = stripped[:-1].strip()
    call = parse_dsl_call(head)
    if not call or call[0] not in DSL_BLOCK_NAMES:
        return None, index
    name, args = call
    body, next_index = parse_adb_script_block(lines, index + 1, serial, allow_local, warnings)
    else_body, next_index = parse_optional_else_block(lines, next_index, serial, allow_local, warnings, name)
    return {
        "kind": "block",
        "line": line_no,
        "name": name,
        "args": args,
        "body": body,
        "elseBody": else_body,
        "display": stripped,
    }, next_index


def parse_adb_script_block(lines, index, serial, allow_local, warnings, top_level=False):
    units = []
    while index < len(lines):
        line_no, line = lines[index]
        stripped = line.strip()
        if ignored_adb_script_line(line):
            index += 1
            continue
        if stripped in {"}", "};"}:
            if top_level:
                raise ValueError(f"第 {line_no} 行出现多余的 }}")
            return units, index + 1
        if stripped.startswith("else"):
            if top_level:
                raise ValueError(f"第 {line_no} 行出现没有 if 的 else")
            return units, index

        if stripped.endswith("{"):
            block, next_index = parse_dsl_block_unit(lines, index, serial, allow_local, warnings)
            if block:
                units.append(block)
                index = next_index
                continue

        call = parse_dsl_call(stripped)
        if call and call[0] in DSL_CALL_NAMES:
            units.append({
                "kind": "dsl",
                "line": line_no,
                "name": call[0],
                "args": call[1],
                "display": stripped,
            })
            index += 1
            continue

        unit = prepare_adb_or_local_line(line, line_no, serial, allow_local, warnings)
        if unit:
            units.append(unit)
        index += 1
    if not top_level:
        raise ValueError("DSL 块缺少结束的 }")
    return units, index


def adb_script_commands(step, serial):
    script_text = str(step.get("commands") or "").replace("\r\n", "\n")
    if not script_text.strip():
        raise ValueError("ADB 脚本不能为空")
    allow_local = bool(step.get("allowLocalCommands", False))
    warnings = []
    prepared, _ = parse_adb_script_block(normalize_script_lines(script_text), 0, serial, allow_local, warnings, top_level=True)
    if not prepared:
        raise ValueError("ADB 脚本没有可执行命令")
    return prepared, warnings


def script_units_display(units, level=0):
    prefix = "  " * level
    lines = []
    for item in units:
        if item["kind"] in {"run", "skip", "dsl"}:
            lines.append(prefix + item.get("display", ""))
        elif item["kind"] == "block":
            lines.append(prefix + item.get("display", ""))
            lines.extend(script_units_display(item.get("body") or [], level + 1))
            if item.get("elseBody"):
                lines.append(prefix + "} else {")
                lines.extend(script_units_display(item.get("elseBody") or [], level + 1))
            lines.append(prefix + "}")
    return lines


def preview_adb_script(step, serial):
    prepared, warnings = adb_script_commands(step, serial)
    return {
        "command": ["adb-script"],
        "commandText": "\n".join(script_units_display(prepared)),
        "warnings": warnings,
    }


def combine_adb_script_results(line_results, command_text, warnings):
    ok = all(result.get("ok") for result in line_results)
    failed = next((result for result in line_results if not result.get("ok")), None)
    stdout_parts = []
    stderr_parts = []
    if warnings:
        stdout_parts.append("提示:\n" + "\n".join(warnings))
    for result in line_results:
        label = result.get("lineLabel") or "脚本行"
        if result.get("stdout"):
            stdout_parts.append(f"[{label}]\n{result['stdout'].rstrip()}")
        if result.get("stderr"):
            stderr_parts.append(f"[{label}]\n{result['stderr'].rstrip()}")
    return {
        "ok": ok,
        "code": 0 if ok else failed.get("code"),
        "stdout": "\n".join(stdout_parts).strip() + ("\n" if stdout_parts else ""),
        "stderr": "\n".join(stderr_parts).strip() + ("\n" if stderr_parts else ""),
        "durationMs": sum(result.get("durationMs", 0) for result in line_results),
        "command": ["adb-script"],
        "commandText": command_text,
    }


def script_result(ok, stdout="", stderr="", results=None, command_text_value="", command=None):
    results = results or []
    failed = next((result for result in results if not result.get("ok")), None)
    return {
        "ok": ok,
        "code": 0 if ok else (failed.get("code") if failed else None),
        "stdout": stdout.rstrip() + ("\n" if stdout else ""),
        "stderr": stderr.rstrip() + ("\n" if stderr else ""),
        "durationMs": sum(result.get("durationMs", 0) for result in results),
        "command": command or ["adb-dsl"],
        "commandText": command_text_value,
    }


def compact_log_text(value, limit=1400):
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n... trimmed {len(text) - limit} chars ..."


def child_result_logs(results):
    lines = []
    for result in results or []:
        label = result.get("lineLabel") or result.get("commandText") or ""
        stdout = compact_log_text(result.get("stdout", ""))
        stderr = compact_log_text(result.get("stderr", ""))
        if not label and not stdout and not stderr:
            continue
        header = f"- {label}" if label else "- 子步骤"
        header += f": {'OK' if result.get('ok') else 'FAIL'}"
        lines.append(header)
        if stdout:
            lines.append(indent_text(stdout, "  "))
        if stderr:
            lines.append(indent_text("ERROR/WARN:\n" + stderr, "  "))
    return "\n".join(lines)


def indent_text(text, prefix):
    return "\n".join(prefix + line for line in str(text or "").splitlines())


def dsl_split_options(args):
    values = list(args or [])
    options = {}
    if values and isinstance(values[-1], dict):
        options = values.pop()
    return values, options


def dsl_str_arg(args, index=0, label="参数"):
    if index >= len(args):
        raise ValueError(f"{label}不能为空")
    return str(args[index])


def dsl_int_arg(args, index, default, minimum=None, maximum=None):
    return bounded_int(args[index] if index < len(args) else default, default, minimum, maximum)


def dsl_list_arg(value):
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value]
    return [str(value)]


def dsl_tap_step(keyword, match_type="contains", options=None):
    options = options or {}
    return {
        "kind": "tap_text",
        "keyword": keyword,
        "matchType": match_type,
        "matchIndex": options.get("index", options.get("matchIndex", 0)),
        "retry": options.get("retry", 3),
        "retryIntervalMs": options.get("retryIntervalMs", options.get("interval", 700)),
        "area": options.get("area", ""),
        "fallbackOcr": bool(options.get("fallbackOcr", options.get("ocr", False))),
        "onlyOcr": bool(options.get("onlyOcr", False)),
        "ocrLanguages": options.get("ocrLanguages", "ch_sim,en"),
        "ocrMinConfidence": options.get("ocrMinConfidence", 0.3),
        "enabledOnly": options.get("enabledOnly", True),
        "clickableOnly": options.get("clickableOnly", False),
        "ignoreCase": bool(options.get("ignoreCase", False)),
        "matchFields": options.get("matchFields", "text,content-desc"),
        "timeout": options.get("timeout", 30),
    }



def dsl_long_press_step(keyword, match_type="contains", options=None):
    options = options or {}
    return {
        **dsl_tap_step(keyword, match_type, options),
        "kind": "long_press_text",
        "duration": bounded_int(options.get("duration", options.get("durationMs", 1000)), 1000, 1, 60000),
    }


def long_press_result_from_parts(ok, results, stdout, stderr="", code=0):
    failed = next((result for result in results if not result.get("ok")), None)
    return {
        "ok": ok,
        "code": code if ok else (failed.get("code") if failed else None),
        "stdout": stdout.rstrip() + ("\n" if stdout else ""),
        "stderr": stderr.rstrip() + ("\n" if stderr else ""),
        "durationMs": sum(result.get("durationMs", 0) for result in results),
        "command": ["long-press-text"],
        "commandText": command_text_from_results(results),
    }


def execute_ocr_long_press_text(step, serial, timeout):
    matches, results, error, screenshot_path, ocr_duration = read_ocr_text_matches(step, serial, timeout, "long-press-ocr")
    if error:
        return long_press_result_from_parts(False, results, "", error)
    index = tap_match_index(step)
    if index >= len(matches):
        summary = match_summary(matches)
        message = [
            f"OCR 已识别截图，但没有可长按的第 {index} 个命中。",
            f"关键字: {tap_text_keyword(step)}",
            f"匹配方式: {tap_text_match_type_label(step)}",
            f"OCR 耗时: {ocr_duration}ms",
            f"截图: {screenshot_path}",
        ]
        if matches:
            message.append("已有命中:\n" + summary)
        return long_press_result_from_parts(False, results, "\n".join(message), "")

    match = matches[index]
    bounds = match["bounds"]
    duration = bounded_int(step.get("duration"), 1000, 1, 60000)
    press_result = run_swipe(serial, bounds["centerX"], bounds["centerY"], bounds["centerX"], bounds["centerY"], duration, timeout or 15)
    results.append(press_result)
    stdout = "\n".join([
        f"OCR 命中 {len(matches)} 个，长按第 {index} 个。",
        f"坐标: {bounds['centerX']},{bounds['centerY']}，持续: {duration}ms",
        f"OCR 耗时: {ocr_duration}ms",
        f"截图: {screenshot_path}",
        match_summary(matches),
    ])
    return long_press_result_from_parts(press_result["ok"], results, stdout, press_result.get("stderr", ""), press_result.get("code"))


def execute_long_press_text(step, serial, timeout):
    if not serial:
        raise ValueError("智能长按需要选择设备")
    tap_text_keyword(step)
    attempts = bounded_int(step.get("retry"), 3, 1, 30)
    interval_ms = bounded_int(step.get("retryIntervalMs"), 700, 0, 60000)
    index = tap_match_index(step)
    duration = bounded_int(step.get("duration"), 1000, 1, 60000)
    all_results = []
    notes = []

    if step.get("onlyOcr"):
        last_result = None
        command_texts = []
        total_duration = 0
        for attempt in range(1, attempts + 1):
            result = execute_ocr_long_press_text(step, serial, timeout)
            last_result = result
            total_duration += result.get("durationMs", 0)
            if result.get("commandText"):
                command_texts.append(result["commandText"])
            if result.get("ok"):
                prefix = f"onlyOcr 第 {attempt}/{attempts} 次长按成功。"
                if notes:
                    prefix += "\n" + "\n".join(notes)
                result["stdout"] = (prefix + "\n" + result.get("stdout", "")).strip() + "\n"
                result["durationMs"] = total_duration
                result["commandText"] = "\n".join(command_texts)
                return result
            notes.append(f"onlyOcr 第 {attempt}/{attempts} 次未长按成功: {(result.get('stderr') or result.get('stdout') or '').strip()}")
            if attempt < attempts and interval_ms:
                time.sleep(interval_ms / 1000)
        if not last_result:
            return long_press_result_from_parts(False, [], "", "OCR 未执行")
        last_result["durationMs"] = total_duration
        last_result["commandText"] = "\n".join(command_texts)
        last_result["stderr"] = "\n".join(notes).strip() + ("\n" if notes else "")
        return last_result

    for attempt in range(1, attempts + 1):
        xml_text, results, dump_error = dump_uiautomator_xml(serial, timeout)
        all_results.extend(results)
        if dump_error:
            notes.append(f"第 {attempt}/{attempts} 次 UIAutomator dump 失败: {dump_error}")
        if xml_text:
            try:
                matches = collect_uiautomator_matches(xml_text, step)
            except ValueError as exc:
                return long_press_result_from_parts(False, all_results, "", str(exc))
            if index < len(matches):
                match = matches[index]
                bounds = match["bounds"]
                press_result = run_swipe(serial, bounds["centerX"], bounds["centerY"], bounds["centerX"], bounds["centerY"], duration, timeout or 15)
                all_results.append(press_result)
                stdout = "\n".join([
                    f"UIAutomator 第 {attempt}/{attempts} 次命中 {len(matches)} 个，长按第 {index} 个。",
                    f"坐标: {bounds['centerX']},{bounds['centerY']}，持续: {duration}ms",
                    match_summary(matches),
                ])
                return long_press_result_from_parts(press_result["ok"], all_results, stdout, press_result.get("stderr", ""), press_result.get("code"))
            notes.append(f"第 {attempt}/{attempts} 次 UIAutomator 命中 {len(matches)} 个，找不到第 {index} 个。")
            if matches:
                notes.append(match_summary(matches))
        if attempt < attempts and interval_ms:
            time.sleep(interval_ms / 1000)

    if step.get("fallbackOcr"):
        ocr_result = execute_ocr_long_press_text(step, serial, timeout)
        if all_results:
            ocr_result["durationMs"] += sum(result.get("durationMs", 0) for result in all_results)
            ocr_result["commandText"] = "\n".join(filter(None, [command_text_from_results(all_results), ocr_result.get("commandText", "")]))
        if notes:
            prefix = "UIAutomator 未完成长按，已尝试 OCR。\n" + "\n".join(notes)
            ocr_result["stdout"] = (prefix + "\n" + ocr_result.get("stdout", "")).strip() + "\n"
        return ocr_result

    stderr = "\n".join(notes) or "UIAutomator 未找到可长按目标"
    return long_press_result_from_parts(False, all_results, "", stderr)

def soften_click_result(result, label, options=None):
    options = options or {}
    if result.get("ok") or options.get("strict") or options.get("required"):
        return result
    detail = (result.get("stderr") or result.get("stdout") or "未找到可点击目标").strip()
    warning = f"WARNING: {label} 未点击成功，已按非致命处理，继续执行后续步骤。\n{detail}"
    return {
        **result,
        "ok": True,
        "code": 0,
        "stdout": warning + "\n",
        "stderr": "",
    }


def dsl_text_matches(serial, keyword, match_type="contains", options=None, timeout=None):
    options = options or {}
    step = {
        "keyword": keyword,
        "matchType": match_type,
        "area": options.get("area", ""),
        "enabledOnly": options.get("enabledOnly", False),
        "clickableOnly": options.get("clickableOnly", False),
        "ignoreCase": bool(options.get("ignoreCase", False)),
        "matchFields": options.get("matchFields", "text,content-desc"),
        "ocrLanguages": options.get("ocrLanguages", "ch_sim,en"),
        "ocrMinConfidence": options.get("ocrMinConfidence", 0.3),
    }
    all_results = []
    errors = []
    only_ocr = bool(options.get("onlyOcr", False))
    use_ocr = only_ocr or bool(options.get("fallbackOcr", options.get("ocr", False)))

    if not only_ocr:
        xml_text, results, dump_error = dump_uiautomator_xml(serial, timeout)
        all_results.extend(results)
        if dump_error:
            errors.append(dump_error)
        if xml_text:
            matches = collect_uiautomator_matches(xml_text, step)
            if matches:
                return True, matches, all_results, ""

    if use_ocr:
        matches, results, error, screenshot_path, ocr_duration = read_ocr_text_matches(step, serial, timeout)
        all_results.extend(results)
        if matches:
            return True, matches, all_results, ""
        detail = f"OCR 未找到文字: {keyword}"
        if screenshot_path:
            detail += f"；截图: {screenshot_path}"
        if ocr_duration:
            detail += f"；OCR 耗时: {ocr_duration}ms"
        errors.append(error or detail)

    return False, [], all_results, "\n".join(error for error in errors if error).strip()


def dsl_wait_text(serial, keywords, mode, match_type="contains", timeout_ms=5000, options=None, timeout=None):
    options = options or {}
    interval_ms = bounded_int(options.get("interval", options.get("retryIntervalMs", 500)), 500, 50, 10000)
    keywords = dsl_list_arg(keywords)
    deadline = time.monotonic() + max(0, timeout_ms) / 1000
    all_results = []
    last_matches = {}
    last_error = ""
    while True:
        found = {}
        for keyword in keywords:
            ok, matches, results, error = dsl_text_matches(serial, keyword, match_type, options, timeout)
            all_results.extend(results)
            if error:
                last_error = error
            if ok:
                found[keyword] = matches
        last_matches = found
        if mode == "any" and found:
            return True, found, all_results, ""
        if mode == "all" and len(found) == len(keywords):
            return True, found, all_results, ""
        if time.monotonic() >= deadline:
            break
        time.sleep(min(interval_ms / 1000, max(0, deadline - time.monotonic())))
    missing = [keyword for keyword in keywords if keyword not in last_matches]
    return False, last_matches, all_results, last_error or f"等待文字超时，未出现: {', '.join(missing)}"


def text_match_output(matches_by_keyword):
    lines = []
    for keyword, matches in matches_by_keyword.items():
        lines.append(f"{keyword}: {len(matches)} 个命中")
        summary = match_summary(matches, 3)
        if summary:
            lines.append(summary)
    return "\n".join(lines)


def run_adb_shell(serial, command, timeout=None):
    return run_process([*adb_prefix(serial), "shell", command], timeout=timeout)


CQCLAW_AGENT_PACKAGE = "com.chujue.cqclaw.agent"
CQCLAW_AGENT_CLIPBOARD_URI = "content://com.chujue.cqclaw.agent.clipboard"
CQCLAW_AGENT_INPUT_URI = f"{CQCLAW_AGENT_CLIPBOARD_URI}/input"
CQCLAW_AGENT_IME_ID = f"{CQCLAW_AGENT_PACKAGE}/.ime.CqClawInputMethodService"
CQCLAW_AGENT_SERVER_MAIN = "com.chujue.cqclaw.agent.server.ServerMain"
CQCLAW_AGENT_SERVER_SOCKET_PREFIX = "cqclaw_clipboard"


def clipboard_server_configured_path():
    path = configured_agent_server_jar_path()
    return str(Path(path).expanduser()) if path else ""


def clipboard_server_remote_path(serial):
    return f"/data/local/tmp/cqclaw-agent-server-{safe_serial_dir(serial)}.jar"


def clipboard_server_socket_name(serial):
    return f"{CQCLAW_AGENT_SERVER_SOCKET_PREFIX}_{safe_serial_dir(serial)}"


def allocate_local_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def clipboard_server_socket_request(port, method, text=None, timeout=2):
    request = {"id": uuid.uuid4().hex, "method": method}
    if text is not None:
        request["text"] = str(text)
    started = time.time()
    try:
        with socket.create_connection(("127.0.0.1", int(port)), timeout=timeout) as sock:
            sock.settimeout(timeout)
            payload = (json.dumps(request, ensure_ascii=False) + "\n").encode("utf-8")
            sock.sendall(payload)
            chunks = []
            while True:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                chunks.append(chunk)
                if b"\n" in chunk:
                    break
            raw = b"".join(chunks).split(b"\n", 1)[0].decode("utf-8", errors="replace")
            data = json.loads(raw or "{}")
            return {
                "ok": bool(data.get("ok")),
                "response": data,
                "stdout": raw,
                "stderr": "" if data.get("ok") else str(data.get("error") or "server request failed"),
                "durationMs": round((time.time() - started) * 1000),
            }
    except Exception as exc:
        return {
            "ok": False,
            "response": {},
            "stdout": "",
            "stderr": str(exc),
            "durationMs": round((time.time() - started) * 1000),
        }


def clipboard_server_ping_session(session):
    if not session or not session.get("port"):
        return {"ok": False, "stderr": "clipboard server session missing"}
    proc = session.get("proc")
    if proc is not None and proc.poll() is not None:
        return {"ok": False, "stderr": f"clipboard server exited: {proc.poll()}"}
    return clipboard_server_socket_request(session["port"], "ping", timeout=1)


def stop_clipboard_server_session(serial, send_stop=True):
    with CLIPBOARD_SERVER_LOCK:
        session = CLIPBOARD_SERVER_SESSIONS.pop(serial, None)
    if not session:
        return {"ok": True, "serial": serial, "stopped": False}
    results = []
    if send_stop and session.get("port"):
        results.append(clipboard_server_socket_request(session["port"], "stop", timeout=1))
    proc = session.get("proc")
    if proc and proc.poll() is None:
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
        except Exception:
            pass
    if session.get("port"):
        results.append(run_process([adb_bin(), "-s", serial, "forward", "--remove", f"tcp:{session['port']}"], timeout=5))
    return {
        "ok": True,
        "serial": serial,
        "stopped": True,
        "session": {key: value for key, value in session.items() if key != "proc"},
        "results": results,
        "stdout": "\n".join(item.get("stdout", "") for item in results if item.get("stdout")),
        "stderr": "\n".join(item.get("stderr", "") for item in results if item.get("stderr")),
    }


def start_clipboard_server_session(serial, timeout=8, force=False):
    if not serial:
        raise ValueError("启动剪切板同步服务需要选择设备")
    jar_path = clipboard_server_configured_path()
    if not jar_path:
        return {
            "ok": False,
            "serial": serial,
            "configured": False,
            "stderr": "未配置 CQClaw Agent server jar 路径。请在 data/enterprise.json 配置 agentServerJarPath。",
        }
    local_jar = Path(jar_path).expanduser()
    if not local_jar.exists() or not local_jar.is_file():
        return {
            "ok": False,
            "serial": serial,
            "configured": True,
            "jarPath": str(local_jar),
            "stderr": f"CQClaw Agent server jar 不存在: {local_jar}",
        }
    with CLIPBOARD_SERVER_LOCK:
        existing = CLIPBOARD_SERVER_SESSIONS.get(serial)
    if existing and not force:
        ping = clipboard_server_ping_session(existing)
        if ping.get("ok"):
            return {
                "ok": True,
                "serial": serial,
                "alreadyRunning": True,
                "transport": "app_process_server",
                "session": {key: value for key, value in existing.items() if key != "proc"},
                "ping": ping,
            }
        stop_clipboard_server_session(serial, send_stop=False)

    remote_path = clipboard_server_remote_path(serial)
    socket_name = clipboard_server_socket_name(serial)
    port = allocate_local_port()
    push_result = run_process([*adb_prefix(serial), "push", str(local_jar), remote_path], timeout=timeout)
    forward_result = run_process([*adb_prefix(serial), "forward", f"tcp:{port}", f"localabstract:{socket_name}"], timeout=timeout)
    if not push_result.get("ok") or not forward_result.get("ok"):
        run_process([adb_bin(), "-s", serial, "forward", "--remove", f"tcp:{port}"], timeout=5)
        return {
            "ok": False,
            "serial": serial,
            "configured": True,
            "jarPath": str(local_jar),
            "remotePath": remote_path,
            "port": port,
            "socketName": socket_name,
            "stderr": "\n".join(part for part in [push_result.get("stderr"), forward_result.get("stderr")] if part),
            "results": [push_result, forward_result],
        }

    command = [
        *adb_prefix(serial),
        "shell",
        f"CLASSPATH={shlex.quote(remote_path)} app_process / {CQCLAW_AGENT_SERVER_MAIN} --socket {shlex.quote(socket_name)}",
    ]
    try:
        proc = subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
            **hidden_subprocess_kwargs(),
        )
    except FileNotFoundError as exc:
        run_process([adb_bin(), "-s", serial, "forward", "--remove", f"tcp:{port}"], timeout=5)
        return {"ok": False, "serial": serial, "stderr": str(exc), "command": command}

    session = {
        "serial": serial,
        "jarPath": str(local_jar),
        "remotePath": remote_path,
        "socketName": socket_name,
        "port": port,
        "proc": proc,
        "command": command,
        "startedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    with CLIPBOARD_SERVER_LOCK:
        CLIPBOARD_SERVER_SESSIONS[serial] = session

    deadline = time.time() + max(2, timeout)
    ping = {"ok": False, "stderr": "server not ready"}
    while time.time() < deadline:
        ping = clipboard_server_ping_session(session)
        if ping.get("ok"):
            break
        if proc.poll() is not None:
            ping = {"ok": False, "stderr": f"clipboard server exited: {proc.poll()}"}
            break
        time.sleep(0.2)
    if not ping.get("ok"):
        stop_clipboard_server_session(serial, send_stop=False)
    return {
        "ok": bool(ping.get("ok")),
        "serial": serial,
        "configured": True,
        "transport": "app_process_server",
        "session": {key: value for key, value in session.items() if key != "proc"},
        "ping": ping,
        "stderr": "" if ping.get("ok") else ping.get("stderr", "server start failed"),
        "results": [push_result, forward_result],
        "commandText": command_text_from_results([push_result, forward_result]) + "\n" + command_text(command),
    }


def clipboard_server_status(serial):
    jar_path = clipboard_server_configured_path()
    with CLIPBOARD_SERVER_LOCK:
        session = CLIPBOARD_SERVER_SESSIONS.get(serial)
    ping = clipboard_server_ping_session(session) if session else {"ok": False, "stderr": "not running"}
    if session and not ping.get("ok"):
        stop_clipboard_server_session(serial, send_stop=False)
        session = None
    return {
        "ok": True,
        "serial": serial,
        "configured": bool(jar_path),
        "jarPath": jar_path,
        "jarExists": bool(jar_path and Path(jar_path).exists()),
        "running": bool(session and ping.get("ok")),
        "transport": "app_process_server" if session and ping.get("ok") else "",
        "session": {key: value for key, value in session.items() if key != "proc"} if session else {},
        "ping": ping,
    }


def device_clipboard_server(payload):
    serial = require_serial(payload)
    action = str(payload.get("action") or "status").strip().lower()
    timeout = int(payload.get("timeout") or 8)
    if action == "start":
        return start_clipboard_server_session(serial, timeout=timeout, force=bool(payload.get("force")))
    if action == "stop":
        return stop_clipboard_server_session(serial)
    if action == "restart":
        stop_clipboard_server_session(serial, send_stop=False)
        return start_clipboard_server_session(serial, timeout=timeout, force=True)
    if action == "status":
        return clipboard_server_status(serial)
    raise ValueError(f"未知剪切板服务操作: {action}")


def agent_server_clipboard(serial, operation, text="", timeout=8):
    started = start_clipboard_server_session(serial, timeout=timeout)
    if not started.get("ok"):
        return {
            "ok": False,
            "transport": "app_process_server",
            "stdout": "",
            "stderr": started.get("stderr") or started.get("error") or "启动剪切板 server 失败",
            "server": started,
            "commandText": started.get("commandText", ""),
        }
    session = started.get("session") or {}
    if operation == "read":
        response = clipboard_server_socket_request(session["port"], "getClipboard", timeout=timeout)
        clipboard_text = str((response.get("response") or {}).get("text") or "")
        return {
            "ok": response.get("ok"),
            "transport": "app_process_server",
            "clipboardText": clipboard_text,
            "stdout": clipboard_text,
            "stderr": response.get("stderr", ""),
            "server": started,
            "response": response,
        }
    if operation == "write":
        response = clipboard_server_socket_request(session["port"], "setClipboard", text=text, timeout=timeout)
        return {
            "ok": response.get("ok"),
            "transport": "app_process_server",
            "stdout": f"CQClaw Agent server clipboard set: {len(str(text or ''))} chars" if response.get("ok") else "",
            "stderr": response.get("stderr", ""),
            "server": started,
            "response": response,
        }
    raise ValueError(f"未知剪切板 server 操作: {operation}")


def agent_command_failed(result):
    text = "\n".join(str(result.get(key) or "") for key in ("stdout", "stderr")).lower()
    patterns = [
        "no content provider",
        "failed to find provider",
        "unknown url",
        "unknown uri",
        "permission denial",
        "not found",
    ]
    return any(pattern in text for pattern in patterns)


def mark_agent_result(result, action):
    if not result.get("ok") or agent_command_failed(result):
        result["ok"] = False
        result["stderr"] = "\n".join(
            part for part in [
                result.get("stderr", "").strip(),
                f"CQClaw Agent {action}失败。请确认手机已安装 CQClawAgent，并按需启用 CQClaw Clipboard IME。",
            ] if part
        )
    return result


def current_input_method(serial, timeout=None):
    if not serial:
        raise ValueError("读取当前输入法需要选择设备")
    result = run_process([*adb_prefix(serial), "shell", "settings", "get", "secure", "default_input_method"], timeout=timeout)
    if result.get("ok"):
        result["inputMethodId"] = (result.get("stdout") or "").strip()
    return result


def switch_to_agent_ime(serial, timeout=None):
    if not serial:
        raise ValueError("切换 CQClaw 输入法需要选择设备")
    enable_result = run_process([*adb_prefix(serial), "shell", "ime", "enable", CQCLAW_AGENT_IME_ID], timeout=timeout)
    set_result = run_process([*adb_prefix(serial), "shell", "ime", "set", CQCLAW_AGENT_IME_ID], timeout=timeout)
    ok = enable_result.get("ok") and set_result.get("ok")
    return {
        "ok": ok,
        "code": set_result.get("code") if enable_result.get("ok") else enable_result.get("code"),
        "stdout": "\n".join(part for part in [enable_result.get("stdout", ""), set_result.get("stdout", ""), "CQClaw Clipboard IME selected" if ok else ""] if part),
        "stderr": "\n".join(part for part in [enable_result.get("stderr", ""), set_result.get("stderr", "")] if part),
        "durationMs": int(enable_result.get("durationMs", 0) or 0) + int(set_result.get("durationMs", 0) or 0),
        "command": set_result.get("command", []),
        "commandText": command_text_from_results([enable_result, set_result]),
        "results": [enable_result, set_result],
    }


def restore_input_method(serial, input_method_id, timeout=None):
    previous = str(input_method_id or "").strip()
    if not previous or previous.lower() == "null" or previous == CQCLAW_AGENT_IME_ID:
        return {
            "ok": True,
            "code": 0,
            "stdout": "No input method restore needed",
            "stderr": "",
            "durationMs": 0,
            "command": [],
        }
    result = run_process([*adb_prefix(serial), "shell", "ime", "set", previous], timeout=timeout)
    result["stdout"] = "\n".join(part for part in [result.get("stdout", ""), f"Restored input method: {previous}" if result.get("ok") else ""] if part)
    return result


def combine_process_results(results, ok=None, stdout="", stderr="", code=None, command=None):
    failed = next((item for item in results if not item.get("ok")), None)
    return {
        "ok": all(item.get("ok") for item in results) if ok is None else ok,
        "code": code if code is not None else (failed.get("code") if failed else (results[-1].get("code") if results else 0)),
        "stdout": "\n".join(part for part in [stdout, *[item.get("stdout", "") for item in results if item.get("stdout")]] if part),
        "stderr": "\n".join(part for part in [stderr, *[item.get("stderr", "") for item in results if item.get("stderr")]] if part),
        "durationMs": sum(int(item.get("durationMs", 0) or 0) for item in results),
        "command": command if command is not None else (results[-1].get("command", []) if results else []),
        "commandText": command_text_from_results(results),
        "results": results,
    }


def with_temporary_agent_ime(serial, timeout, action):
    before = current_input_method(serial, timeout)
    previous_ime = before.get("inputMethodId", "")
    results = [before]
    if not before.get("ok") or not previous_ime:
        combined = combine_process_results(
            results,
            ok=False,
            code=before.get("code"),
            command=before.get("command", []),
        )
        combined["stderr"] = "\n".join(part for part in [
            before.get("stderr", ""),
            before.get("stdout", ""),
            "读取原输入法失败，已停止剪切板操作，避免切换后无法自动恢复。",
        ] if part)
        combined["previousInputMethod"] = previous_ime
        combined["restoredInputMethod"] = False
        return combined

    switch_result = None
    if previous_ime != CQCLAW_AGENT_IME_ID:
        switch_result = switch_to_agent_ime(serial, timeout)
        results.append(switch_result)
        if not switch_result.get("ok"):
            restore_result = restore_input_method(serial, previous_ime, timeout)
            if restore_result.get("command") or restore_result.get("stdout") != "No input method restore needed":
                results.append(restore_result)
            combined = combine_process_results(
                results,
                ok=False,
                code=switch_result.get("code"),
                command=switch_result.get("command", []),
            )
            combined["stderr"] = "\n".join(part for part in [
                switch_result.get("stderr", ""),
                switch_result.get("stdout", ""),
                "" if restore_result.get("ok") else f"恢复输入法失败: {restore_result.get('stderr') or restore_result.get('stdout')}",
                "切换 CQClaw Clipboard IME 失败，已停止剪切板操作。",
            ] if part)
            combined["previousInputMethod"] = previous_ime
            combined["restoredInputMethod"] = restore_result.get("ok")
            return combined

    action_result = action()
    results.append(action_result)
    restore_result = restore_input_method(serial, previous_ime, timeout)
    if restore_result.get("command") or restore_result.get("stdout") != "No input method restore needed":
        results.append(restore_result)

    ok = action_result.get("ok") and restore_result.get("ok") and (not switch_result or switch_result.get("ok"))
    combined = combine_process_results(results, ok=ok, code=action_result.get("code"), command=action_result.get("command", []))
    combined["stdout"] = "\n".join(part for part in [
        action_result.get("stdout", ""),
        f"Input method restored: {previous_ime}" if restore_result.get("ok") and previous_ime and previous_ime != CQCLAW_AGENT_IME_ID else "",
    ] if part)
    combined["stderr"] = "\n".join(part for part in [
        "" if not switch_result or switch_result.get("ok") else f"切换输入法失败: {switch_result.get('stderr') or switch_result.get('stdout')}",
        action_result.get("stderr", ""),
        "" if restore_result.get("ok") else f"恢复输入法失败: {restore_result.get('stderr') or restore_result.get('stdout')}",
    ] if part)
    if action_result.get("clipboardText") is not None:
        combined["clipboardText"] = action_result.get("clipboardText")
    combined["previousInputMethod"] = previous_ime
    combined["restoredInputMethod"] = restore_result.get("ok")
    return combined


def set_agent_clipboard(serial, text, timeout=None, manage_ime=True):
    payload = str(text or "")
    if not serial:
        raise ValueError("写入手机剪切板需要选择设备")
    if manage_ime:
        return with_temporary_agent_ime(serial, timeout, lambda: set_agent_clipboard(serial, payload, timeout, manage_ime=False))
    command = [*adb_prefix(serial), "shell", "content", "write", "--uri", CQCLAW_AGENT_CLIPBOARD_URI]
    result = mark_agent_result(run_process(command, timeout=timeout, input_text=payload), "写入剪切板")
    if result.get("ok"):
        write_result = dict(result)
        verify = read_agent_clipboard(serial, timeout, manage_ime=False)
        result["results"] = [write_result, verify]
        result["durationMs"] = int(result.get("durationMs", 0) or 0) + int(verify.get("durationMs", 0) or 0)
        result["commandText"] = command_text_from_results(result["results"])
        if not verify.get("ok") or (verify.get("clipboardText") or "") != payload:
            result["ok"] = False
            result["stderr"] = "\n".join(part for part in [
                result.get("stderr", ""),
                verify.get("stderr", ""),
                "CQClaw Agent 写入命令已返回，但读取校验未通过。当前 ROM 可能拦截了后台剪切板写入。",
            ] if part)
            return result
        result["stdout"] = (result.get("stdout") or "").strip() or f"CQClaw Agent clipboard set: {len(payload)} chars"
    return result


def read_agent_clipboard(serial, timeout=None, manage_ime=True):
    if not serial:
        raise ValueError("读取手机剪切板需要选择设备")
    if manage_ime:
        return with_temporary_agent_ime(serial, timeout, lambda: read_agent_clipboard(serial, timeout, manage_ime=False))
    command = [*adb_prefix(serial), "shell", "content", "read", "--uri", CQCLAW_AGENT_CLIPBOARD_URI]
    result = mark_agent_result(run_process(command, timeout=timeout), "读取剪切板")
    if result.get("ok"):
        text = result.get("stdout", "")
        result["stdout"] = text
        result["clipboardText"] = text
        result["commandText"] = command_text(command)
    return result


def agent_input_status(serial, timeout=None):
    if not serial:
        raise ValueError("检查 CQClaw Agent 输入状态需要选择设备")
    command = [*adb_prefix(serial), "shell", "content", "call", "--uri", CQCLAW_AGENT_CLIPBOARD_URI, "--method", "input_status"]
    return mark_agent_result(run_process(command, timeout=timeout), "输入状态检查")


def agent_status_is_false(result):
    text = "\n".join(str(result.get(key) or "") for key in ("stdout", "stderr")).lower()
    return "ok=false" in text or "ok=false" in text.replace(" ", "")


def commit_agent_text(serial, text, timeout=None, manage_ime=True):
    payload = str(text or "")
    if not serial:
        raise ValueError("输入文本需要选择设备")
    if manage_ime:
        return with_temporary_agent_ime(serial, timeout, lambda: commit_agent_text(serial, payload, timeout, manage_ime=False))

    command = [*adb_prefix(serial), "shell", "content", "write", "--uri", CQCLAW_AGENT_INPUT_URI]
    result = mark_agent_result(run_process(command, timeout=timeout, input_text=payload), "直接输入")
    if not result.get("ok"):
        return result

    write_result = dict(result)
    status = agent_input_status(serial, timeout)
    result["results"] = [write_result, status]
    result["durationMs"] = int(result.get("durationMs", 0) or 0) + int(status.get("durationMs", 0) or 0)
    result["commandText"] = command_text_from_results(result["results"])
    if not status.get("ok") or agent_status_is_false(status):
        result["ok"] = False
        result["stderr"] = "\n".join(part for part in [
            result.get("stderr", ""),
            status.get("stderr", ""),
            status.get("stdout", ""),
            "CQClaw Agent 没有拿到可输入的焦点，请先点进手机上的输入框再执行。",
        ] if part)
        return result

    result["stdout"] = (result.get("stdout") or "").strip() or f"CQClaw Agent direct input committed: {len(payload)} chars"
    return result


def agent_status(serial, timeout=None):
    if not serial:
        raise ValueError("检查 CQClaw Agent 需要选择设备")
    command = [*adb_prefix(serial), "shell", "content", "call", "--uri", CQCLAW_AGENT_CLIPBOARD_URI, "--method", "status"]
    return mark_agent_result(run_process(command, timeout=timeout), "状态检查")


def enable_agent_ime(serial, timeout=None):
    if not serial:
        raise ValueError("启用 CQClaw 输入法需要选择设备")
    result = switch_to_agent_ime(serial, timeout)
    result["stdout"] = "\n".join(part for part in [result.get("stdout", ""), "CQClaw Clipboard IME enabled and selected" if result.get("ok") else ""] if part)
    return result


def device_agent_install_state(serial, timeout=None):
    if not serial:
        raise ValueError("检查 CQClaw Agent 需要选择设备")
    result = run_process([*adb_prefix(serial), "shell", "pm", "path", CQCLAW_AGENT_PACKAGE], timeout=timeout or 10)
    installed = result.get("ok") and bool((result.get("stdout") or "").strip())
    apk_path = configured_agent_apk_path()
    apk_exists = bool(apk_path and Path(apk_path).expanduser().exists())
    server_jar_path = configured_agent_server_jar_path()
    server_jar_exists = bool(server_jar_path and Path(server_jar_path).expanduser().exists())
    return {
        "ok": True,
        "serial": serial,
        "packageName": CQCLAW_AGENT_PACKAGE,
        "installed": installed,
        "apkPath": apk_path,
        "apkConfigured": bool(apk_path),
        "apkExists": apk_exists,
        "serverJarPath": server_jar_path,
        "serverJarConfigured": bool(server_jar_path),
        "serverJarExists": server_jar_exists,
        "clipboardServer": clipboard_server_status(serial),
        "result": result,
        "stdout": result.get("stdout", ""),
        "stderr": result.get("stderr", ""),
    }


def install_agent_apk(serial, timeout=None):
    if not serial:
        raise ValueError("安装 CQClaw Agent 需要选择设备")
    apk_path = configured_agent_apk_path()
    if not apk_path:
        return {
            "ok": False,
            "serial": serial,
            "packageName": CQCLAW_AGENT_PACKAGE,
            "installed": False,
            "apkPath": "",
            "stderr": "未配置 CQClaw Agent APK 路径。请通过企业 manifest 或设置页配置 agentApkPath。",
        }
    path = Path(apk_path).expanduser()
    if not path.exists():
        return {
            "ok": False,
            "serial": serial,
            "packageName": CQCLAW_AGENT_PACKAGE,
            "installed": False,
            "apkPath": apk_path,
            "stderr": f"CQClaw Agent APK 不存在: {apk_path}",
        }
    if path.suffix.lower() != ".apk":
        return {
            "ok": False,
            "serial": serial,
            "packageName": CQCLAW_AGENT_PACKAGE,
            "installed": False,
            "apkPath": apk_path,
            "stderr": f"CQClaw Agent 路径不是 .apk 文件: {apk_path}",
        }
    result = run_process([*adb_prefix(serial), "install", "-r", "-d", str(path)], timeout=timeout or 120)
    state = device_agent_install_state(serial, timeout=10)
    return {
        "ok": result.get("ok") and state.get("installed"),
        "serial": serial,
        "packageName": CQCLAW_AGENT_PACKAGE,
        "installed": state.get("installed"),
        "apkPath": apk_path,
        "result": result,
        "stdout": result.get("stdout", ""),
        "stderr": result.get("stderr", "") if result.get("ok") else (result.get("stderr") or result.get("stdout") or "安装失败"),
        "commandText": command_text(result.get("command", [])),
    }


def clipboard_command_failed(result):
    text = "\n".join(str(result.get(key) or "") for key in ("stdout", "stderr")).lower()
    patterns = [
        "no shell command implementation",
        "unknown command: clipboard",
        "unknown command clipboard",
        "can't find service: clipboard",
        "cannot find service: clipboard",
        "service clipboard does not exist",
    ]
    return any(pattern in text for pattern in patterns)


def mark_clipboard_result(result):
    if clipboard_command_failed(result):
        result["ok"] = False
        result["stderr"] = "\n".join(
            part for part in [
                result.get("stderr", "").strip(),
                "当前设备 ROM 不支持 adb shell 的 clipboard 命令，无法通过该方式写入手机剪切板。",
            ] if part
        )
    return result


def set_device_clipboard(serial, text, timeout=None):
    payload = str(text or "")
    if not serial:
        raise ValueError("复制到手机剪切板需要选择设备")
    agent_result = set_agent_clipboard(serial, payload, timeout)
    if agent_result.get("ok"):
        return agent_result
    command = [*adb_prefix(serial), "shell", 'cmd clipboard set text "$(cat)"']
    result = mark_clipboard_result(run_process(command, timeout=timeout, input_text=payload))
    if result.get("ok"):
        result["stdout"] = (result.get("stdout") or "").strip() or f"Clipboard set: {len(payload)} chars"
        result["stderr"] = "\n".join(part for part in [agent_result.get("stderr", ""), result.get("stderr", "")] if part)
        return result

    fallback = mark_clipboard_result(run_adb_shell(serial, f"cmd clipboard set text {shlex.quote(payload)}", timeout))
    fallback["stderr"] = "\n".join(
        part for part in [
            agent_result.get("stderr", "").strip(),
            "stdin clipboard 写入失败，已尝试兼容模式。",
            result.get("stderr", "").strip(),
            fallback.get("stderr", "").strip(),
        ] if part
    )
    fallback["stdout"] = (fallback.get("stdout") or "").strip() or (f"Clipboard set: {len(payload)} chars" if fallback.get("ok") else "")
    fallback["commandText"] = "\n".join(command_text(item.get("command", [])) for item in [result, fallback] if item.get("command"))
    return fallback


def split_text_chunks(text, max_chars=180):
    raw = str(text or "")
    for line_index, line in enumerate(raw.split("\n")):
        start = 0
        while start < len(line):
            yield ("text", line[start:start + max_chars])
            start += max_chars
        if line_index < raw.count("\n"):
            yield ("enter", "")


def run_adb_input_text(serial, text, timeout=None):
    if not serial:
        raise ValueError("输入文本需要选择设备")
    payload = str(text or "")
    results = []
    for item_type, value in split_text_chunks(payload):
        if item_type == "enter":
            results.append(run_process([*adb_prefix(serial), "shell", "input", "keyevent", "ENTER"], timeout=timeout))
        elif value:
            escaped = adb_escape_input_text(value)
            results.append(run_adb_shell(serial, f"input text {shlex.quote(escaped)}", timeout=timeout))
        if results and not results[-1].get("ok"):
            break
    ok = all(item.get("ok") for item in results) if results else True
    return {
        "ok": ok,
        "code": 0 if ok else next((item.get("code") for item in results if not item.get("ok")), None),
        "stdout": f"ADB input text sent: {len(payload)} chars" if ok else "",
        "stderr": "\n".join(item.get("stderr", "") for item in results if item.get("stderr")),
        "durationMs": sum(int(item.get("durationMs", 0) or 0) for item in results),
        "command": results[-1].get("command", []) if results else [],
        "commandText": command_text_from_results(results),
        "results": results,
    }


def paste_device_clipboard(serial, timeout=None):
    if not serial:
        raise ValueError("粘贴剪切板需要选择设备")
    return run_process([*adb_prefix(serial), "shell", "input", "keyevent", "279"], timeout=timeout)


def input_text_via_clipboard(serial, text, timeout=None):
    agent_input = commit_agent_text(serial, text, timeout)
    if agent_input.get("ok"):
        return agent_input

    set_result = set_device_clipboard(serial, text, timeout)
    if not set_result.get("ok"):
        payload = str(text or "")
        if payload.isascii():
            fallback = run_adb_input_text(serial, payload, timeout)
            fallback["stderr"] = "\n".join(
                part for part in [
                    agent_input.get("stderr", ""),
                    set_result.get("stderr", ""),
                    "剪切板粘贴不可用，已退回到 ADB input text 分段输入。该兜底不适合中文和复杂 Unicode。",
                    fallback.get("stderr", ""),
                ] if part
            )
            fallback["stdout"] = "\n".join(part for part in [fallback.get("stdout", ""), "Clipboard paste fallback: adb input text"] if part)
            fallback["results"] = [set_result, *fallback.get("results", [])]
            fallback["commandText"] = "\n".join(part for part in [set_result.get("commandText") or command_text_from_results([set_result]), fallback.get("commandText", "")] if part)
            return fallback
        return {
            "ok": False,
            "code": set_result.get("code"),
            "stdout": set_result.get("stdout", ""),
            "stderr": "\n".join(
                part for part in [
                    agent_input.get("stderr", ""),
                    set_result.get("stderr", ""),
                    "文本包含中文或复杂 Unicode，无法安全退回到 adb input text。请确认手机当前焦点在输入框内，并安装最新版 CQClawAgent。",
                ] if part
            ),
            "durationMs": int(set_result.get("durationMs", 0) or 0),
            "command": set_result.get("command", []),
            "commandText": set_result.get("commandText") or command_text_from_results([set_result]),
            "results": [set_result],
        }
    paste_result = paste_device_clipboard(serial, timeout)
    stderr = "\n".join(part for part in [set_result.get("stderr", ""), paste_result.get("stderr", "")] if part)
    stdout = "\n".join(part for part in [set_result.get("stdout", ""), paste_result.get("stdout", ""), "Paste keyevent sent"] if part)
    return {
        "ok": paste_result.get("ok"),
        "code": paste_result.get("code"),
        "stdout": stdout,
        "stderr": stderr,
        "durationMs": int(set_result.get("durationMs", 0) or 0) + int(paste_result.get("durationMs", 0) or 0),
        "command": paste_result.get("command", []),
        "commandText": command_text_from_results([set_result, paste_result]),
        "results": [set_result, paste_result],
    }


def execute_agent_clipboard(step, serial, timeout=None):
    operation = str(step.get("operation") or "read").strip()
    if operation == "read":
        return read_agent_clipboard(serial, timeout)
    if operation == "set":
        return set_agent_clipboard(serial, step.get("text", ""), timeout)
    if operation == "set_and_paste":
        result = commit_agent_text(serial, step.get("text", ""), timeout)
        if result.get("ok"):
            result["stdout"] = "\n".join(part for part in [result.get("stdout", ""), "CQClaw Agent direct input committed"] if part)
        return result
    if operation == "enable_ime":
        return enable_agent_ime(serial, timeout)
    if operation == "status":
        return agent_status(serial, timeout)
    raise ValueError(f"未知 Agent 剪切板操作: {operation}")


def preview_temporary_agent_ime_commands(serial, action_commands):
    return [
        [*adb_prefix(serial), "shell", "settings", "get", "secure", "default_input_method"],
        [*adb_prefix(serial), "shell", "ime", "enable", CQCLAW_AGENT_IME_ID],
        [*adb_prefix(serial), "shell", "ime", "set", CQCLAW_AGENT_IME_ID],
        *action_commands,
        [*adb_prefix(serial), "shell", "ime", "set", "<原输入法>"],
    ]


def device_screen_size(serial, timeout=None):
    result = run_adb_shell(serial, "wm size", timeout=timeout or 10)
    match = re.search(r"(\d+)\s*x\s*(\d+)", result.get("stdout", ""))
    if not match:
        raise ValueError(f"无法读取屏幕尺寸: {result.get('stdout') or result.get('stderr')}")
    return int(match.group(1)), int(match.group(2)), result


def percent_point(serial, x_percent, y_percent, timeout=None):
    width, height, result = device_screen_size(serial, timeout)
    x = round(width * float(x_percent) / 100)
    y = round(height * float(y_percent) / 100)
    return x, y, result


def run_tap(serial, x, y, timeout=None):
    return run_process([*adb_prefix(serial), "shell", "input", "tap", str(round(float(x))), str(round(float(y)))], timeout=timeout)


def run_swipe(serial, x1, y1, x2, y2, duration=300, timeout=None):
    return run_process([*adb_prefix(serial), "shell", "input", "swipe", str(round(float(x1))), str(round(float(y1))), str(round(float(x2))), str(round(float(y2))), str(round(float(duration)))], timeout=timeout)


def run_percent_swipe(serial, x1, y1, x2, y2, duration=300, timeout=None):
    sx, sy, size_result = percent_point(serial, x1, y1, timeout)
    ex, ey, _ = percent_point(serial, x2, y2, timeout)
    swipe_result = run_swipe(serial, sx, sy, ex, ey, duration, timeout)
    return [size_result, swipe_result]


def save_debug_artifacts(serial, label, xml_text="", timeout=None):
    safe_label = safe_output_name(label or "debug", "debug")
    target_dir = default_screenshot_dir() / "debug" / safe_serial_dir(serial)
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    screenshot_path = target_dir / f"{safe_label}_{stamp}.png"
    xml_path = target_dir / f"{safe_label}_{stamp}.xml"
    results = []
    screenshot = capture_screenshot_png(serial, screenshot_path, timeout=timeout or 30)
    results.append(screenshot)
    if not xml_text:
        xml_text, dump_results, _ = dump_uiautomator_xml(serial, timeout)
        results.extend(dump_results)
    if xml_text:
        xml_path.write_text(xml_text, encoding="utf-8")
    return f"调试文件: {screenshot_path} / {xml_path}", results


def execute_dsl_call(name, args, serial, timeout):
    if not serial:
        raise ValueError("ADB DSL 需要选择设备")
    values, options = dsl_split_options(args)
    display = f"{name}({', '.join(repr(item) for item in args)})"

    if name in {"sleep", "wait"}:
        ms = dsl_int_arg(values, 0, 1000, 0, 3600000)
        started = time.time()
        time.sleep(ms / 1000)
        return {
            "ok": True,
            "code": 0,
            "stdout": f"Waited {ms}ms\n",
            "stderr": "",
            "durationMs": round((time.time() - started) * 1000),
            "command": ["wait", str(ms)],
            "commandText": display,
        }

    if name in {"tapText", "tapTextContains", "tapTextExact", "tapTextRegex", "tapById", "tapId"}:
        keyword = dsl_str_arg(values, 0, "文字")
        match_type = {"tapTextRegex": "regex", "tapTextExact": "exact"}.get(name, "contains")
        if name in {"tapById", "tapId"}:
            options = {**options, "matchFields": "resource-id", "strict": options.get("strict", True)}
        result = execute_tap_text(dsl_tap_step(keyword, match_type, options), serial, timeout)
        result["commandText"] = display + ("\n" + result.get("commandText", "") if result.get("commandText") else "")
        return soften_click_result(result, f"{name}({keyword})", options)

    if name in {"longPressText", "longPressId"}:
        keyword = dsl_str_arg(values, 0, "文字或 resource-id")
        duration = dsl_int_arg(values, 1, options.get("duration", options.get("durationMs", 1000)), 1, 60000)
        match_type = options.get("matchType", "contains")
        if name == "longPressId":
            options = {**options, "matchFields": "resource-id", "strict": options.get("strict", True)}
            match_type = options.get("matchType", "exact")
        step = dsl_long_press_step(keyword, match_type, {**options, "duration": duration})
        result = execute_long_press_text(step, serial, timeout)
        result["commandText"] = display + ("\n" + result.get("commandText", "") if result.get("commandText") else "")
        return soften_click_result(result, f"{name}({keyword})", options)

    if name == "tapTextAny":
        texts = dsl_list_arg(values[0] if values else [])
        results = []
        for text in texts:
            result = execute_tap_text(dsl_tap_step(text, options.get("matchType", "contains"), {**options, "retry": options.get("retry", 1)}), serial, timeout)
            results.append(result)
            if result["ok"]:
                return script_result(True, f"已点击: {text}", results=results, command_text_value=display)
        result = script_result(False, stderr=f"没有可点击的文字: {', '.join(texts)}", results=results, command_text_value=display)
        return soften_click_result(result, f"{name}({', '.join(texts)})", options)

    if name in {"textExists", "waitText", "waitToast", "waitId"}:
        keyword = dsl_str_arg(values, 0, "文字")
        if name == "waitId":
            options = {**options, "matchFields": "resource-id", "matchType": options.get("matchType", "exact")}
        wait_ms = dsl_int_arg(values, 1, 0 if name == "textExists" else 5000, 0, 3600000)
        ok, matches, results, error = dsl_wait_text(serial, [keyword], "any", options.get("matchType", "contains"), wait_ms, options, timeout)
        return script_result(ok, text_match_output(matches) if ok else "", error if not ok else "", results, display)

    if name in {"waitAnyText", "waitAllText"}:
        texts = dsl_list_arg(values[0] if values else [])
        wait_ms = dsl_int_arg(values, 1, 5000, 0, 3600000)
        ok, matches, results, error = dsl_wait_text(serial, texts, "any" if name == "waitAnyText" else "all", options.get("matchType", "contains"), wait_ms, options, timeout)
        return script_result(ok, text_match_output(matches) if ok else "", error if not ok else "", results, display)

    if name == "waitTextAndTap":
        keyword = dsl_str_arg(values, 0, "文字")
        wait_ms = dsl_int_arg(values, 1, 5000, 0, 3600000)
        ok, matches, wait_results, error = dsl_wait_text(serial, [keyword], "any", options.get("matchType", "contains"), wait_ms, options, timeout)
        if not ok:
            return script_result(False, stderr=error, results=wait_results, command_text_value=display)
        tap_result = execute_tap_text(dsl_tap_step(keyword, options.get("matchType", "contains"), options), serial, timeout)
        tap_result = soften_click_result(tap_result, f"waitTextAndTap({keyword})", options)
        return script_result(tap_result["ok"], text_match_output(matches) + "\n" + tap_result.get("stdout", ""), tap_result.get("stderr", ""), [*wait_results, tap_result], display)

    if name in {"assertText", "assertTextContains", "assertExists", "assertToast", "assertId"}:
        keyword = dsl_str_arg(values, 0, "文字")
        if name == "assertId":
            options = {**options, "matchFields": "resource-id", "matchType": options.get("matchType", "exact")}
        ok, matches, results, error = dsl_wait_text(serial, [keyword], "any", options.get("matchType", "contains"), dsl_int_arg(values, 1, 1000, 0, 3600000), options, timeout)
        if ok:
            return script_result(True, f"断言通过: {keyword}\n{text_match_output(matches)}", results=results, command_text_value=display)
        artifact_text, artifact_results = save_debug_artifacts(serial, f"assert_{keyword}", timeout=timeout)
        return script_result(False, stderr=f"断言失败: {keyword}\n{error}\n{artifact_text}", results=[*results, *artifact_results], command_text_value=display)

    if name == "assertActivity":
        expected = dsl_str_arg(values, 0, "Activity")
        data = device_top_activity({"serial": serial})
        ok = expected in (data.get("activity") or "") or expected in (data.get("component") or "")
        if ok:
            return script_result(True, f"断言通过: {data.get('component')}", command_text_value=display)
        artifact_text, artifact_results = save_debug_artifacts(serial, "assert_activity", timeout=timeout)
        return script_result(False, stderr=f"Activity 断言失败，期望包含 {expected}，实际 {data.get('component') or '-'}\n{artifact_text}", results=artifact_results, command_text_value=display)

    if name in {"tap", "doubleTap"}:
        x = dsl_str_arg(values, 0, "x")
        y = dsl_str_arg(values, 1, "y")
        first = run_tap(serial, x, y, timeout)
        results = [first]
        if name == "doubleTap" and first["ok"]:
            time.sleep(0.08)
            results.append(run_tap(serial, x, y, timeout))
        return script_result(all(result["ok"] for result in results), f"Tapped {x},{y}", results=results, command_text_value=display)

    if name == "longPress":
        x = dsl_str_arg(values, 0, "x")
        y = dsl_str_arg(values, 1, "y")
        duration = dsl_int_arg(values, 2, 1000, 1, 60000)
        result = run_swipe(serial, x, y, x, y, duration, timeout)
        return script_result(result["ok"], f"Long pressed {x},{y} {duration}ms", result.get("stderr", ""), [result], display)

    if name == "swipe":
        result = run_swipe(serial, dsl_str_arg(values, 0, "x1"), dsl_str_arg(values, 1, "y1"), dsl_str_arg(values, 2, "x2"), dsl_str_arg(values, 3, "y2"), dsl_int_arg(values, 4, 300, 0, 60000), timeout)
        return script_result(result["ok"], "Swiped", result.get("stderr", ""), [result], display)

    if name in {"tapPercent", "tapBottomCenter", "tapTopRight"}:
        if name == "tapPercent":
            px = dsl_str_arg(values, 0, "xPercent")
            py = dsl_str_arg(values, 1, "yPercent")
        elif name == "tapBottomCenter":
            px, py = 50, 92
        else:
            px, py = 92, 8
        x, y, size_result = percent_point(serial, px, py, timeout)
        tap_result = run_tap(serial, x, y, timeout)
        return script_result(tap_result["ok"], f"Tapped {px}%,{py}% -> {x},{y}", tap_result.get("stderr", ""), [size_result, tap_result], display)

    if name in {"swipeUp", "scrollDown"}:
        results = run_percent_swipe(serial, 50, 82, 50, 22, dsl_int_arg(values, 0, 300, 0, 60000), timeout)
        return script_result(all(result["ok"] for result in results), "Swiped up", results=results, command_text_value=display)
    if name in {"swipeDown", "scrollUp"}:
        results = run_percent_swipe(serial, 50, 22, 50, 82, dsl_int_arg(values, 0, 300, 0, 60000), timeout)
        return script_result(all(result["ok"] for result in results), "Swiped down", results=results, command_text_value=display)
    if name == "swipeLeft":
        results = run_percent_swipe(serial, 82, 50, 18, 50, dsl_int_arg(values, 0, 300, 0, 60000), timeout)
        return script_result(all(result["ok"] for result in results), "Swiped left", results=results, command_text_value=display)
    if name == "swipeRight":
        results = run_percent_swipe(serial, 18, 50, 82, 50, dsl_int_arg(values, 0, 300, 0, 60000), timeout)
        return script_result(all(result["ok"] for result in results), "Swiped right", results=results, command_text_value=display)

    if name in {"scrollToText", "scrollUntil"}:
        keyword = dsl_str_arg(values, 0, "文字")
        max_swipes = dsl_int_arg(values, 1, 5, 0, 100)
        results = []
        for attempt in range(max_swipes + 1):
            ok, matches, check_results, error = dsl_text_matches(serial, keyword, options.get("matchType", "contains"), options, timeout)
            results.extend(check_results)
            if ok:
                return script_result(True, f"第 {attempt + 1} 次找到: {keyword}\n{match_summary(matches)}", results=results, command_text_value=display)
            if attempt < max_swipes:
                results.extend(run_percent_swipe(serial, 50, 82, 50, 22, options.get("duration", 300), timeout))
                time.sleep(bounded_int(options.get("interval", 500), 500, 0, 10000) / 1000)
        return script_result(False, stderr=f"滚动 {max_swipes} 次后仍未找到: {keyword}", results=results, command_text_value=display)

    if name in {"inputText", "inputChinese"}:
        text = dsl_str_arg(values, 0, "文本")
        if name == "inputText" and text.isascii() and "\n" not in text and len(text) <= 200:
            result = run_adb_input_text(serial, text, timeout=timeout)
            return script_result(result["ok"], f"Input: {text}", result.get("stderr", ""), [result], display)
        result = input_text_via_clipboard(serial, text, timeout)
        return script_result(result["ok"], f"Clipboard pasted: {text}", result.get("stderr", ""), [result], display)

    if name == "setClipboard":
        text = dsl_str_arg(values, 0, "文本")
        result = set_device_clipboard(serial, text, timeout)
        return script_result(result["ok"], f"Clipboard set: {text}", result.get("stderr", ""), [result], display)

    if name == "paste":
        result = paste_device_clipboard(serial, timeout)
        return script_result(result["ok"], "Paste keyevent sent", result.get("stderr", ""), [result], display)

    if name in {"clearText", "clearAndInput"}:
        clear_result = run_adb_shell(serial, "input keyevent 123; for i in $(seq 1 80); do input keyevent 67; done", timeout)
        results = [clear_result]
        stdout = "Cleared current input"
        if name == "clearAndInput" and clear_result["ok"]:
            input_result = execute_dsl_call("inputChinese" if not dsl_str_arg(values, 0, "文本").isascii() else "inputText", [dsl_str_arg(values, 0, "文本")], serial, timeout)
            results.append(input_result)
            stdout += "\n" + input_result.get("stdout", "")
        return script_result(all(result.get("ok") for result in results), stdout, "\n".join(result.get("stderr", "").strip() for result in results if result.get("stderr")), results, display)

    if name in {"launchApp", "killApp", "restartApp", "clearAppData", "uninstall"}:
        package_name = dsl_str_arg(values, 0, "包名")
        commands = {
            "launchApp": [[*adb_prefix(serial), "shell", "monkey", "-p", package_name, "-c", "android.intent.category.LAUNCHER", "1"]],
            "killApp": [[*adb_prefix(serial), "shell", "am", "force-stop", package_name]],
            "clearAppData": [[*adb_prefix(serial), "shell", "pm", "clear", package_name]],
            "uninstall": [[*adb_prefix(serial), "uninstall", package_name]],
            "restartApp": [[*adb_prefix(serial), "shell", "am", "force-stop", package_name], [*adb_prefix(serial), "shell", "monkey", "-p", package_name, "-c", "android.intent.category.LAUNCHER", "1"]],
        }[name]
        results = [run_process(command, timeout=timeout) for command in commands]
        return script_result(all(result["ok"] for result in results), f"{name}: {package_name}", "\n".join(result.get("stderr", "").strip() for result in results if result.get("stderr")), results, display)

    if name == "installApk":
        apk = Path(os.path.expandvars(dsl_str_arg(values, 0, "APK 路径"))).expanduser()
        options_text = str(options.get("options", "-r -d"))
        result = run_process([*adb_prefix(serial), "install", *split_args(options_text), str(apk)], timeout=timeout)
        return script_result(result["ok"], result.get("stdout", ""), result.get("stderr", ""), [result], display)

    if name in {"currentActivity", "currentPackage", "isAppInForeground"}:
        data = device_top_activity({"serial": serial})
        package_name = data.get("package") or ""
        component = data.get("component") or ""
        if name == "isAppInForeground":
            expected = dsl_str_arg(values, 0, "包名")
            ok = package_name == expected
            return script_result(ok, f"当前包名: {package_name}", "" if ok else f"当前前台不是 {expected}: {component}", command_text_value=display)
        text = component if name == "currentActivity" else package_name
        return script_result(bool(text), text, data.get("error", "") if not text else "", command_text_value=display)

    if name == "screenshot":
        base = dsl_str_arg(values, 0, "截图名") if values else f"screenshot_{serial}_{int(time.time())}"
        path = output_path("", f"{base}_{safe_serial_dir(serial)}_{time.strftime('%Y%m%d-%H%M%S')}.png", f"screenshot_{serial}.png")
        result = capture_screenshot_png(serial, path, timeout=timeout or 30)
        return script_result(result["ok"], f"Saved to {path}", result.get("stderr", ""), [result], display)

    if name == "dumpUI":
        base = dsl_str_arg(values, 0, "ui") if values else "ui"
        xml_text, results, error = dump_uiautomator_xml(serial, timeout)
        path = output_path("", f"{base}_{safe_serial_dir(serial)}_{time.strftime('%Y%m%d-%H%M%S')}.xml", f"ui_{serial}.xml")
        if xml_text:
            path.write_text(xml_text, encoding="utf-8")
        return script_result(bool(xml_text), f"Saved to {path}" if xml_text else "", error, results, display)

    if name == "screenshotOnFail":
        return script_result(True, "断言失败时会自动截图并保存 UI XML", command_text_value=display)

    if name == "log":
        return script_result(True, dsl_str_arg(values, 0, "日志"), command_text_value=display)

    if name == "handlePermission":
        permission_texts = ["允许", "始终允许", "仅在使用中允许", "仅本次允许", "Allow", "ALLOW", "确定"]
        return execute_dsl_call("tapTextAny", [permission_texts, {"retry": 1}], serial, timeout)

    if name == "autoClosePopup":
        popup_texts = ["以后再说", "暂不", "取消", "关闭", "我知道了", "知道了", "Not now", "Cancel", "OK"]
        return execute_dsl_call("tapTextAny", [popup_texts, {"retry": 1}], serial, timeout)

    raise ValueError(f"暂不支持的 DSL 函数: {name}")


def if_match_type(name):
    return {
        "ifTextRegex": "regex",
        "ifTextExact": "exact",
        "ifTextContains": "contains",
        "ifTextExists": "contains",
    }[name]


def execute_script_units(units, serial, timeout, cwd=None, continue_on_line_error=False):
    line_results = []
    for item in units:
        line_label = f"第 {item['line']} 行"
        if item["kind"] == "skip":
            result = {
                "ok": True,
                "code": 0,
                "stdout": item.get("stdout", ""),
                "stderr": "",
                "durationMs": 0,
                "command": [],
                "commandText": item["display"],
                "lineLabel": line_label,
            }
        elif item["kind"] == "run":
            result = run_process(shell_command_args(item["commandText"]), cwd=cwd, timeout=timeout)
            result["commandText"] = item["commandText"]
            result["lineLabel"] = line_label
        elif item["kind"] == "dsl":
            result = execute_dsl_call(item["name"], item.get("args", []), serial, timeout)
            result["lineLabel"] = f"{line_label} {item['name']}"
        elif item["kind"] == "block" and item["name"] == "retry":
            count = dsl_int_arg(item.get("args", []), 0, 3, 1, 100)
            attempts = []
            ok = False
            attempt_logs = []
            for attempt in range(1, count + 1):
                body_results = execute_script_units(item.get("body") or [], serial, timeout, cwd=cwd, continue_on_line_error=False)
                attempts.extend(body_results)
                ok = all(result.get("ok") for result in body_results)
                attempt_detail = child_result_logs(body_results)
                attempt_logs.append(f"第 {attempt}/{count} 次: {'成功' if ok else '失败'}" + (f"\n{attempt_detail}" if attempt_detail else ""))
                if ok:
                    break
            result = script_result(
                ok,
                f"retry({count}) {'成功' if ok else '失败'}\n" + "\n".join(attempt_logs),
                "\n".join(result.get("stderr", "").strip() for result in attempts if result.get("stderr")),
                attempts,
                item["display"],
            )
            result["lineLabel"] = f"{line_label} retry"
        elif item["kind"] == "block" and item["name"].startswith("ifText"):
            values, options = dsl_split_options(item.get("args", []))
            keyword = dsl_str_arg(values, 0, "文字")
            exists, matches, check_results, error = dsl_text_matches(serial, keyword, if_match_type(item["name"]), options, timeout)
            branch = item.get("body") or [] if exists else item.get("elseBody") or []
            branch_results = execute_script_units(branch, serial, timeout, cwd=cwd, continue_on_line_error=continue_on_line_error) if branch else []
            stdout = f"{item['name']}({keyword}) => {'then' if exists else 'else'}"
            if exists:
                stdout += "\n" + match_summary(matches, 3)
            branch_log = child_result_logs(branch_results)
            if branch_log:
                stdout += "\n分支执行结果:\n" + branch_log
            if not branch and not exists:
                stdout += "\n没有 else 分支，条件不满足时跳过。"
            result = script_result(
                all(result.get("ok") for result in branch_results),
                stdout,
                "\n".join(result.get("stderr", "").strip() for result in branch_results if result.get("stderr")),
                [*check_results, *branch_results],
                item["display"],
            )
            result["lineLabel"] = f"{line_label} {item['name']}"
        else:
            result = script_result(False, stderr=f"未知脚本节点: {item.get('kind')}", command_text_value=item.get("display", ""))
            result["lineLabel"] = line_label

        line_results.append(result)
        if not result["ok"] and not continue_on_line_error:
            break
    return line_results


def execute_adb_script(step, serial, timeout, cwd=None):
    prepared, warnings = adb_script_commands(step, serial)
    continue_on_line_error = bool(step.get("continueOnLineError", False))
    line_results = execute_script_units(prepared, serial, timeout, cwd=cwd, continue_on_line_error=continue_on_line_error)
    return combine_adb_script_results(
        line_results,
        "\n".join(script_units_display(prepared)),
        warnings,
    )


def script_command(step):
    path = str(step.get("path", "")).strip()
    if not path:
        raise ValueError("脚本路径不能为空")
    script = Path(path).expanduser()
    args = split_args(step.get("args", ""))
    suffix = script.suffix.lower()
    if suffix == ".py":
        return [sys.executable, str(script), *args]
    if suffix in (".bat", ".cmd"):
        if os.name == "nt":
            return ["cmd.exe", "/c", str(script), *args]
        raise ValueError("当前系统不能直接运行 .bat/.cmd，请在 Windows 上运行或改成 .sh/.py")
    if suffix == ".sh":
        return ["bash", str(script), *args]
    return [str(script), *args]


def inline_script_command(step):
    language = str(step.get("language") or "python").strip().lower()
    code = str(step.get("code") or "")
    if not code.strip():
        raise ValueError("页面脚本代码不能为空")
    args = split_args(step.get("args", ""))
    specs = {
        "python": (".py", [sys.executable]),
        "bash": (".sh", ["bash"]),
        "powershell": (".ps1", ["powershell.exe" if os.name == "nt" else "pwsh", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]),
        "batch": (".cmd", ["cmd.exe", "/c"]),
    }
    if language not in specs:
        raise ValueError(f"不支持的页面脚本类型: {language}")
    if language == "batch" and os.name != "nt":
        raise ValueError("当前系统不能直接运行 Bat/Cmd 页面脚本，请在 Windows 上运行或改用 Python/Bash")
    suffix, command = specs[language]
    script_path = tmp_scripts_dir() / f"inline-{int(time.time() * 1000)}-{uuid.uuid4().hex}{suffix}"
    script_path.write_text(code.replace("\r\n", "\n") + "\n", encoding="utf-8")
    return [*command, str(script_path), *args], script_path


def apk_paths_from_step(step):
    raw = str(step.get("path", "")).strip()
    if not raw:
        raise ValueError("APK 文件或文件夹不能为空")
    source = Path(os.path.expandvars(raw)).expanduser()
    if not source.exists():
        raise ValueError(f"APK 文件或文件夹不存在: {source}")
    if source.is_file():
        if source.suffix.lower() != ".apk":
            raise ValueError(f"选择的文件不是 .apk: {source}")
        return [source]
    if source.is_dir():
        recursive = bool(step.get("recursiveApkSearch", False))
        candidates = source.rglob("*") if recursive else source.iterdir()
        apks = sorted(
            [path for path in candidates if path.is_file() and path.suffix.lower() == ".apk"],
            key=lambda path: str(path).lower(),
        )
        if not apks:
            scope = "及子文件夹里" if recursive else "里"
            raise ValueError(f"文件夹{scope}没有 APK: {source}")
        return apks
    raise ValueError(f"APK 路径不是文件或文件夹: {source}")


def install_apk_commands(step, serial):
    if not serial:
        raise ValueError("安装 APK 需要选择设备")
    options = split_args(step.get("options", "-r -d"))
    apks = apk_paths_from_step(step)
    return apks, [[*adb_prefix(serial), "install", *options, str(apk)] for apk in apks]


def preview_install_apk(step, serial):
    apks, commands = install_apk_commands(step, serial)
    warnings = []
    source = Path(os.path.expandvars(str(step.get("path", "")).strip())).expanduser()
    if source.is_dir():
        mode = "，包含子文件夹" if step.get("recursiveApkSearch", False) else ""
        warnings.append(f"将按文件名顺序安装 {len(apks)} 个 APK{mode}")
    return {
        "command": commands[0] if len(commands) == 1 else ["install-apk-folder"],
        "commandText": "\n".join(command_text(command) for command in commands),
        "warnings": warnings,
    }


def bounded_int(value, default, minimum=None, maximum=None):
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    if minimum is not None:
        number = max(minimum, number)
    if maximum is not None:
        number = min(maximum, number)
    return number


def bounded_float(value, default, minimum=None, maximum=None):
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    if minimum is not None:
        number = max(minimum, number)
    if maximum is not None:
        number = min(maximum, number)
    return number


def tap_text_keyword(step):
    keyword = str(step.get("keyword") or "").strip()
    if not keyword:
        raise ValueError("智能点击的文字不能为空")
    return keyword


def build_text_matcher(step):
    keyword = tap_text_keyword(step)
    match_type = str(step.get("matchType") or "contains").strip().lower()
    flags = re.IGNORECASE if step.get("ignoreCase") else 0
    if match_type == "exact":
        needle = keyword.lower() if flags else keyword
        return lambda value: (str(value).lower() if flags else str(value)) == needle
    if match_type == "regex":
        try:
            pattern = re.compile(keyword, flags)
        except re.error as exc:
            raise ValueError(f"正则表达式无效: {exc}") from exc
        return lambda value: bool(pattern.search(str(value)))
    needle = keyword.lower() if flags else keyword
    return lambda value: needle in (str(value).lower() if flags else str(value))


def levenshtein_distance(left, right):
    left = str(left or "")
    right = str(right or "")
    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)
    if len(left) > len(right):
        left, right = right, left
    previous = list(range(len(left) + 1))
    for r_index, r_char in enumerate(right, start=1):
        current = [r_index]
        for l_index, l_char in enumerate(left, start=1):
            current.append(min(
                previous[l_index] + 1,
                current[l_index - 1] + 1,
                previous[l_index - 1] + (0 if l_char == r_char else 1),
            ))
        previous = current
    return previous[-1]


def text_match_score(step, value):
    text = str(value or "")
    if not text:
        return None
    keyword = tap_text_keyword(step)
    match_type = str(step.get("matchType") or "contains").strip().lower()
    flags = re.IGNORECASE if step.get("ignoreCase") else 0
    source_text = text.lower() if flags else text
    source_keyword = keyword.lower() if flags else keyword
    if match_type == "exact":
        if source_text != source_keyword:
            return None
        return 0
    if match_type == "regex":
        try:
            pattern = re.compile(keyword, flags)
        except re.error as exc:
            raise ValueError(f"正则表达式无效: {exc}") from exc
        match = pattern.search(text)
        if not match:
            return None
        matched_text = match.group(0) or text
        return min(
            levenshtein_distance(source_keyword, source_text),
            levenshtein_distance(source_keyword, matched_text.lower() if flags else matched_text),
        )
    if source_keyword not in source_text:
        return None
    return levenshtein_distance(source_keyword, source_text)


def sort_text_matches(matches):
    return sorted(matches, key=lambda item: (
        item.get("distance", 999999),
        0 if item.get("source") == "UIAutomator" else 1,
        -float(item.get("confidence", 1.0) or 0),
        item["bounds"]["y1"],
        item["bounds"]["x1"],
    ))


def tap_text_match_type_label(step):
    labels = {"contains": "包含", "exact": "完全一致", "regex": "正则"}
    return labels.get(str(step.get("matchType") or "contains").strip().lower(), "包含")


def parse_bounds(bounds):
    match = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", str(bounds or "").strip())
    if not match:
        return None
    x1, y1, x2, y2 = [int(item) for item in match.groups()]
    if x2 <= x1 or y2 <= y1:
        return None
    return {
        "x1": x1,
        "y1": y1,
        "x2": x2,
        "y2": y2,
        "centerX": round((x1 + x2) / 2),
        "centerY": round((y1 + y2) / 2),
        "raw": str(bounds),
    }


def parse_tap_area(step):
    text = str(step.get("area") or "").strip()
    if not text:
        return None
    numbers = re.findall(r"-?\d+(?:\.\d+)?", text)
    if len(numbers) != 4:
        raise ValueError("限定区域格式应为 x1,y1,x2,y2，例如 0,1000,1080,2400")
    x1, y1, x2, y2 = [round(float(item)) for item in numbers]
    return {
        "x1": min(x1, x2),
        "y1": min(y1, y2),
        "x2": max(x1, x2),
        "y2": max(y1, y2),
    }


def point_in_area(x, y, area):
    return not area or (area["x1"] <= x <= area["x2"] and area["y1"] <= y <= area["y2"])


def tap_match_index(step):
    return bounded_int(step.get("matchIndex"), 0, 0, 9999)


def tap_text_fields(step):
    raw = str(step.get("matchFields") or "text,content-desc").strip()
    fields = [field.strip() for field in raw.split(",") if field.strip()]
    supported = {"text", "content-desc", "resource-id"}
    return [field for field in fields if field in supported] or ["text", "content-desc"]


def collect_uiautomator_matches(xml_text, step):
    area = parse_tap_area(step)
    fields = tap_text_fields(step)
    enabled_only = step.get("enabledOnly") is not False
    clickable_only = bool(step.get("clickableOnly", False))
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise ValueError(f"UIAutomator XML 解析失败: {exc}") from exc

    matches = []
    for node in root.iter("node"):
        attrs = node.attrib
        if enabled_only and attrs.get("enabled") == "false":
            continue
        if clickable_only and attrs.get("clickable") != "true":
            continue
        bounds = parse_bounds(attrs.get("bounds"))
        if not bounds or not point_in_area(bounds["centerX"], bounds["centerY"], area):
            continue
        best_match = None
        for field in fields:
            value = attrs.get(field, "")
            distance = text_match_score(step, value)
            if distance is not None and (best_match is None or distance < best_match["distance"]):
                best_match = {
                    "source": "UIAutomator",
                    "field": field,
                    "text": value,
                    "bounds": bounds,
                    "distance": distance,
                    "class": attrs.get("class", ""),
                    "resourceId": attrs.get("resource-id", ""),
                    "clickable": attrs.get("clickable", ""),
                    "enabled": attrs.get("enabled", ""),
                }
        if best_match:
            matches.append(best_match)
    return sort_text_matches(matches)


def match_summary(matches, limit=5):
    lines = []
    for index, item in enumerate(matches[:limit]):
        bounds = item["bounds"]
        confidence = item.get("confidence")
        confidence_text = f" confidence={confidence:.2f}" if isinstance(confidence, float) else ""
        distance = item.get("distance")
        distance_text = f" distance={distance}" if isinstance(distance, int) else ""
        lines.append(
            f"#{index} {item.get('source', '')} {item.get('field', 'text')}={item.get('text', '')!r} "
            f"bounds={bounds['raw']} center=({bounds['centerX']},{bounds['centerY']}){confidence_text}{distance_text}"
        )
    if len(matches) > limit:
        lines.append(f"... 还有 {len(matches) - limit} 个命中")
    return "\n".join(lines)


def dump_uiautomator_xml(serial, timeout):
    stamp = int(time.time() * 1000)
    paths = [
        f"/sdcard/adb-box-window-{stamp}.xml",
        f"/data/local/tmp/adb-box-window-{stamp}.xml",
    ]
    results = []
    errors = []
    for remote_path in paths:
        dump_result = run_process([*adb_prefix(serial), "shell", "uiautomator", "dump", remote_path], timeout=timeout or 20)
        results.append(dump_result)
        if not dump_result["ok"]:
            errors.append(f"{remote_path}: {dump_result.get('stderr') or dump_result.get('stdout') or 'dump failed'}".strip())
            continue
        cat_result = run_process([*adb_prefix(serial), "exec-out", "cat", remote_path], timeout=timeout or 20)
        results.append(cat_result)
        cleanup_result = run_process([*adb_prefix(serial), "shell", "rm", "-f", remote_path], timeout=10)
        results.append(cleanup_result)
        if cat_result["ok"] and cat_result["stdout"].strip():
            return cat_result["stdout"], results, ""
        errors.append(f"{remote_path}: {cat_result.get('stderr') or '读取 window.xml 失败'}".strip())
    return "", results, "\n".join(errors).strip()



# Dump inspector helpers.
def inspector_safe_serial(serial):
    value = str(serial or "device").strip() or "device"
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value)[:96]


def inspector_capture_dir(serial):
    target = local_capture_dir("inspector", inspector_safe_serial(serial))
    target.mkdir(parents=True, exist_ok=True)
    return target


def bool_attr(value):
    return str(value).lower() == "true"


def compact_node_label(attrs):
    for key in ("text", "content-desc", "resource-id", "class"):
        value = str(attrs.get(key) or "").strip()
        if value:
            return value
    return "node"


def inspect_node_commands(node, screen_width=0, screen_height=0):
    attrs = node.get("attrs") or {}
    bounds = node.get("bounds") or {}
    commands = []
    rid = str(node.get("resourceId") or "").strip()
    text = str(node.get("text") or "").strip()
    desc = str(node.get("contentDesc") or "").strip()
    x = bounds.get("centerX")
    y = bounds.get("centerY")
    if rid:
        commands.append({
            "label": "按 resource-id 点击（最稳定）",
            "command": f'tapText({rid!r}, {{ matchFields: "resource-id", strict: true }})'.replace("'", '"'),
            "reason": "resource-id 通常比坐标和文字更稳定",
        })
    if text:
        commands.append({
            "label": "按 text 点击",
            "command": f'tapText({text!r}, {{ strict: true }})'.replace("'", '"'),
            "reason": "可读性好，适合文案稳定的按钮",
        })
        commands.append({
            "label": "等待 text 再点击",
            "command": f'waitTextAndTap({text!r}, 5000)'.replace("'", '"'),
            "reason": "适合页面加载慢或动画较多的场景",
        })
    if desc:
        commands.append({
            "label": "按 content-desc 点击",
            "command": f'tapText({desc!r}, {{ matchFields: "content-desc", strict: true }})'.replace("'", '"'),
            "reason": "适合无文字但有无障碍描述的图标按钮",
        })
    if isinstance(x, int) and isinstance(y, int):
        commands.append({
            "label": "按中心坐标点击",
            "command": f"adb shell input tap {x} {y}",
            "reason": "兜底可用，但分辨率和布局变化时不稳定",
        })
        if screen_width and screen_height:
            px = round(x * 100 / screen_width, 2)
            py = round(y * 100 / screen_height, 2)
            commands.append({
                "label": "按百分比点击",
                "command": f"tapPercent({px}, {py})",
                "reason": "比固定坐标稍微适配不同分辨率",
            })
    return commands


def parse_uiautomator_inspector_tree(xml_text):
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise ValueError(f"UIAutomator XML 解析失败: {exc}") from exc

    counter = {"value": 0}
    flat = []
    max_right = 0
    max_bottom = 0

    def convert(element, depth=0, parent_id=""):
        nonlocal max_right, max_bottom
        children = []
        for child in list(element):
            converted = convert(child, depth + (1 if element.tag == "node" else 0), "")
            if converted:
                children.append(converted)
        if element.tag != "node":
            return {"id": "root", "label": "hierarchy", "depth": 0, "children": children}

        counter["value"] += 1
        attrs = dict(element.attrib)
        bounds = parse_bounds(attrs.get("bounds")) or {}
        if bounds:
            max_right = max(max_right, bounds.get("x2", 0))
            max_bottom = max(max_bottom, bounds.get("y2", 0))
        node_id = f"node_{counter['value']}"
        node = {
            "id": node_id,
            "label": compact_node_label(attrs),
            "depth": depth,
            "index": counter["value"],
            "text": attrs.get("text", ""),
            "resourceId": attrs.get("resource-id", ""),
            "className": attrs.get("class", ""),
            "packageName": attrs.get("package", ""),
            "contentDesc": attrs.get("content-desc", ""),
            "checkable": bool_attr(attrs.get("checkable")),
            "checked": bool_attr(attrs.get("checked")),
            "clickable": bool_attr(attrs.get("clickable")),
            "enabled": bool_attr(attrs.get("enabled")),
            "focusable": bool_attr(attrs.get("focusable")),
            "focused": bool_attr(attrs.get("focused")),
            "scrollable": bool_attr(attrs.get("scrollable")),
            "longClickable": bool_attr(attrs.get("long-clickable")),
            "selected": bool_attr(attrs.get("selected")),
            "bounds": bounds,
            "attrs": attrs,
            "children": children,
        }
        flat.append(node)
        return node

    tree = convert(root)
    if tree and tree.get("id") == "root" and len(tree.get("children") or []) == 1:
        tree = tree["children"][0]
    for node in flat:
        node["commands"] = inspect_node_commands(node, max_right, max_bottom)
    return {
        "tree": tree,
        "flat": flat,
        "count": len(flat),
        "screen": {"width": max_right, "height": max_bottom},
    }


def inspect_refresh(payload):
    serial = require_serial(payload)
    timeout = bounded_int(payload.get("timeout"), 20, 5, 120)
    stamp = time.strftime("%Y%m%d-%H%M%S") + f"-{int(time.time() * 1000) % 1000:03d}"
    out_dir = inspector_capture_dir(serial)
    screen_path = out_dir / f"screen-{stamp}.png"
    xml_path = out_dir / f"window-{stamp}.xml"

    screen_result = capture_screenshot_png(serial, screen_path, timeout=timeout)
    xml_text, dump_results, dump_error = dump_uiautomator_xml(serial, timeout)
    if xml_text:
        xml_path.write_text(xml_text, encoding="utf-8")
    results = [screen_result, *dump_results]

    if not screen_result.get("ok"):
        return {
            "ok": False,
            "serial": serial,
            "error": screen_result.get("stderr") or "截图失败",
            "results": results,
            "commandText": command_text_from_results(results),
        }
    if not xml_text:
        return {
            "ok": False,
            "serial": serial,
            "error": dump_error or "UIAutomator dump 失败",
            "screenshotDataUrl": "data:image/png;base64," + base64.b64encode(screen_path.read_bytes()).decode("ascii"),
            "results": results,
            "commandText": command_text_from_results(results),
        }

    parsed = parse_uiautomator_inspector_tree(xml_text)
    return {
        "ok": True,
        "serial": serial,
        "capturedAt": stamp,
        "screenshotDataUrl": "data:image/png;base64," + base64.b64encode(screen_path.read_bytes()).decode("ascii"),
        "xml": xml_text,
        "tree": parsed["tree"],
        "nodes": parsed["flat"],
        "nodeCount": parsed["count"],
        "screen": parsed["screen"],
        "screenshotPath": str(screen_path),
        "xmlPath": str(xml_path),
        "results": results,
        "commandText": command_text_from_results(results),
    }


def command_text_from_results(results):
    lines = []
    for result in results:
        command = result.get("command")
        if command:
            lines.append(command_text(command) if isinstance(command, list) else str(command))
    return "\n".join(lines)


def tap_result_from_parts(ok, results, stdout, stderr="", code=0):
    failed = next((result for result in results if not result.get("ok")), None)
    return {
        "ok": ok,
        "code": code if ok else (failed.get("code") if failed else None),
        "stdout": stdout.rstrip() + ("\n" if stdout else ""),
        "stderr": stderr.rstrip() + ("\n" if stderr else ""),
        "durationMs": sum(result.get("durationMs", 0) for result in results),
        "command": ["tap-text"],
        "commandText": command_text_from_results(results),
    }


def ocr_languages(step):
    raw = str(step.get("ocrLanguages") or "ch_sim,en").strip()
    languages = [item.strip() for item in raw.split(",") if item.strip()]
    return languages or ["ch_sim", "en"]


def easyocr_reader(languages):
    key = tuple(languages)
    if key not in OCR_READER_CACHE:
        import easyocr

        model_dir = DATA_DIR / "ocr-models"
        model_dir.mkdir(parents=True, exist_ok=True)
        OCR_READER_CACHE[key] = easyocr.Reader(list(key), model_storage_directory=str(model_dir))
    return OCR_READER_CACHE[key]


def collect_ocr_matches(items, step):
    area = parse_tap_area(step)
    min_confidence = bounded_float(step.get("ocrMinConfidence"), 0.3, 0.0, 1.0)
    matches = []
    for item in items:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        box = item[0]
        text = str(item[1] or "")
        confidence = float(item[2]) if len(item) > 2 else 1.0
        distance = text_match_score(step, text)
        if confidence < min_confidence or distance is None:
            continue
        try:
            xs = [float(point[0]) for point in box]
            ys = [float(point[1]) for point in box]
        except (TypeError, ValueError, IndexError):
            continue
        bounds = {
            "x1": round(min(xs)),
            "y1": round(min(ys)),
            "x2": round(max(xs)),
            "y2": round(max(ys)),
            "centerX": round((min(xs) + max(xs)) / 2),
            "centerY": round((min(ys) + max(ys)) / 2),
            "raw": f"[{round(min(xs))},{round(min(ys))}][{round(max(xs))},{round(max(ys))}]",
        }
        if not point_in_area(bounds["centerX"], bounds["centerY"], area):
            continue
        matches.append({
            "source": "OCR",
            "field": "text",
            "text": text,
            "bounds": bounds,
            "confidence": confidence,
            "distance": distance,
        })
    return sort_text_matches(matches)


def read_ocr_text_matches(step, serial, timeout, folder="text-ocr"):
    results = []
    try:
        reader = easyocr_reader(ocr_languages(step))
    except ImportError as exc:
        return [], results, "OCR 兜底需要安装 EasyOCR。默认安装不会下载 OCR 依赖，如需启用请执行：aas install-ocr", "", 0
    except Exception as exc:
        return [], results, f"OCR 初始化失败: {exc}", "", 0

    target_dir = tmp_scripts_dir() / folder / safe_serial_dir(serial)
    target_dir.mkdir(parents=True, exist_ok=True)
    screenshot_path = target_dir / f"screen-{int(time.time() * 1000)}.png"
    screenshot_result = capture_screenshot_png(serial, screenshot_path, timeout=timeout or 30)
    results.append(screenshot_result)
    if not screenshot_result["ok"]:
        return [], results, screenshot_result.get("stderr", "截图失败"), str(screenshot_path), 0

    started = time.time()
    try:
        ocr_items = reader.readtext(str(screenshot_path))
    except Exception as exc:
        return [], results, f"OCR 识别失败: {exc}", str(screenshot_path), 0
    ocr_duration = round((time.time() - started) * 1000)
    return collect_ocr_matches(ocr_items, step), results, "", str(screenshot_path), ocr_duration


def execute_ocr_tap_text(step, serial, timeout):
    matches, results, error, screenshot_path, ocr_duration = read_ocr_text_matches(step, serial, timeout, "tap-ocr")
    if error:
        return tap_result_from_parts(False, results, "", error)
    index = tap_match_index(step)
    if index >= len(matches):
        summary = match_summary(matches)
        message = [
            f"OCR 已识别截图，但没有可点击的第 {index} 个命中。",
            f"关键字: {tap_text_keyword(step)}",
            f"匹配方式: {tap_text_match_type_label(step)}",
            f"OCR 耗时: {ocr_duration}ms",
            f"截图: {screenshot_path}",
        ]
        if matches:
            message.append("已有命中:\n" + summary)
        return tap_result_from_parts(False, results, "\n".join(message), "")

    match = matches[index]
    bounds = match["bounds"]
    tap_result = run_process([*adb_prefix(serial), "shell", "input", "tap", str(bounds["centerX"]), str(bounds["centerY"])], timeout=timeout or 15)
    results.append(tap_result)
    stdout = "\n".join([
        f"OCR 命中 {len(matches)} 个，点击第 {index} 个。",
        f"OCR 耗时: {ocr_duration}ms",
        f"截图: {screenshot_path}",
        match_summary(matches),
    ])
    return tap_result_from_parts(tap_result["ok"], results, stdout, tap_result.get("stderr", ""), tap_result.get("code"))


def execute_tap_text(step, serial, timeout):
    if not serial:
        raise ValueError("智能点击需要选择设备")
    tap_text_keyword(step)
    attempts = bounded_int(step.get("retry"), 3, 1, 30)
    interval_ms = bounded_int(step.get("retryIntervalMs"), 700, 0, 60000)
    index = tap_match_index(step)
    all_results = []
    notes = []

    if step.get("onlyOcr"):
        last_result = None
        command_texts = []
        total_duration = 0
        for attempt in range(1, attempts + 1):
            result = execute_ocr_tap_text(step, serial, timeout)
            last_result = result
            total_duration += result.get("durationMs", 0)
            if result.get("commandText"):
                command_texts.append(result["commandText"])
            if result.get("ok"):
                prefix = f"onlyOcr 第 {attempt}/{attempts} 次成功。"
                if notes:
                    prefix += "\n" + "\n".join(notes)
                result["stdout"] = (prefix + "\n" + result.get("stdout", "")).strip() + "\n"
                result["durationMs"] = total_duration
                result["commandText"] = "\n".join(command_texts)
                return result
            notes.append(f"onlyOcr 第 {attempt}/{attempts} 次未点击成功: {(result.get('stderr') or result.get('stdout') or '').strip()}")
            if attempt < attempts and interval_ms:
                time.sleep(interval_ms / 1000)
        if not last_result:
            return tap_result_from_parts(False, [], "", "OCR 未执行")
        last_result["durationMs"] = total_duration
        last_result["commandText"] = "\n".join(command_texts)
        last_result["stderr"] = "\n".join(notes).strip() + ("\n" if notes else "")
        return last_result

    for attempt in range(1, attempts + 1):
        xml_text, results, dump_error = dump_uiautomator_xml(serial, timeout)
        all_results.extend(results)
        if dump_error:
            notes.append(f"第 {attempt}/{attempts} 次 UIAutomator dump 失败: {dump_error}")
        if xml_text:
            try:
                matches = collect_uiautomator_matches(xml_text, step)
            except ValueError as exc:
                return tap_result_from_parts(False, all_results, "", str(exc))
            if index < len(matches):
                match = matches[index]
                bounds = match["bounds"]
                tap_result = run_process([*adb_prefix(serial), "shell", "input", "tap", str(bounds["centerX"]), str(bounds["centerY"])], timeout=timeout or 15)
                all_results.append(tap_result)
                stdout = "\n".join([
                    f"UIAutomator 第 {attempt}/{attempts} 次命中 {len(matches)} 个，点击第 {index} 个。",
                    match_summary(matches),
                ])
                return tap_result_from_parts(tap_result["ok"], all_results, stdout, tap_result.get("stderr", ""), tap_result.get("code"))
            notes.append(f"第 {attempt}/{attempts} 次 UIAutomator 命中 {len(matches)} 个，找不到第 {index} 个。")
            if matches:
                notes.append(match_summary(matches))
        if attempt < attempts and interval_ms:
            time.sleep(interval_ms / 1000)

    if step.get("fallbackOcr"):
        ocr_result = execute_ocr_tap_text(step, serial, timeout)
        if all_results:
            ocr_result["durationMs"] += sum(result.get("durationMs", 0) for result in all_results)
            ocr_result["commandText"] = "\n".join(filter(None, [command_text_from_results(all_results), ocr_result.get("commandText", "")]))
        if notes:
            prefix = "UIAutomator 未完成点击，已尝试 OCR。\n" + "\n".join(notes)
            ocr_result["stdout"] = (prefix + "\n" + ocr_result.get("stdout", "")).strip() + "\n"
        return ocr_result

    stderr = "\n".join(notes) or "UIAutomator 未找到匹配文字"
    return tap_result_from_parts(False, all_results, "", stderr)


def preview_tap_text(step, serial):
    keyword = tap_text_keyword(step)
    if step.get("onlyOcr"):
        warnings = ["执行时只使用 EasyOCR 识别截图并点击中心点，适合 UIAutomator 识别不到的界面"]
    else:
        warnings = ["执行时先用 UIAutomator 定位文字并点击中心点"]
    if step.get("fallbackOcr") and not step.get("onlyOcr"):
        warnings.append("UIAutomator 找不到时会尝试 EasyOCR 兜底，需要本机已安装 easyocr")
    if step.get("onlyOcr") or step.get("fallbackOcr"):
        warnings.append("多个命中会按编辑距离排序，最像关键字的结果排在前面")
    command_lines = [
        f"# 匹配方式: {tap_text_match_type_label(step)}，关键字: {keyword}，命中序号: {tap_match_index(step)}",
    ]
    if not step.get("onlyOcr"):
        command_lines.extend([
            command_text([*adb_prefix(serial), "shell", "uiautomator", "dump", "/sdcard/adb-box-window.xml"]),
            command_text([*adb_prefix(serial), "exec-out", "cat", "/sdcard/adb-box-window.xml"]),
        ])
    if step.get("onlyOcr") or step.get("fallbackOcr"):
        command_lines.append(command_text([*adb_prefix(serial), "exec-out", "screencap", "-p"]))
        command_lines.append("# EasyOCR 识别并按编辑距离排序")
    command_lines.append(command_text([*adb_prefix(serial), "shell", "input", "tap", "<x>", "<y>"]))
    return {
        "command": ["tap-text"],
        "commandText": "\n".join(command_lines),
        "warnings": warnings,
    }


def preview_command(step, serial=None):
    kind = step.get("kind")
    if kind == "install_apk":
        return preview_install_apk(step, serial)
    if kind == "tap_text":
        return preview_tap_text(step, serial)
    if kind == "permission_grant":
        return preview_permission_grant(step, serial)
    if kind == "pull_file":
        return [*adb_prefix(serial), "pull", str(step.get("remotePath", "")).strip(), str(pull_target_path(step, serial))]
    if kind == "push_file":
        return [*adb_prefix(serial), "push", str(Path(str(step.get("localPath", "")).strip()).expanduser()), str(step.get("remotePath", "")).strip()]
    if kind == "screenshot":
        path = output_path(step.get("destDir", ""), step.get("filename", ""), f"screenshot_{serial}.png")
        return [*adb_prefix(serial), "exec-out", "screencap", "-p", ">", str(path)]
    if kind == "screen_record":
        seconds = max(1, min(180, int(step.get("seconds") or 10)))
        path = output_path(step.get("destDir", ""), step.get("filename", ""), f"record_{serial}.mp4")
        remote_path = f"{screen_record_dirs(step)[0]}/adb-box-record-{safe_serial_dir(serial)}.mp4"
        return [*adb_prefix(serial), "shell", "screenrecord", "--time-limit", str(seconds), remote_path, "&&", *adb_prefix(serial), "pull", remote_path, str(path)]
    if kind == "app_action":
        operation = str(step.get("operation") or "force_stop")
        package_name = str(step.get("packageName") or "").strip()
        activity = str(step.get("activity") or "").strip()
        if operation == "force_stop":
            return [*adb_prefix(serial), "shell", "am", "force-stop", package_name]
        if operation == "clear_data":
            return [*adb_prefix(serial), "shell", "pm", "clear", package_name]
        if operation == "uninstall":
            return [*adb_prefix(serial), "uninstall", package_name]
        if operation == "start_app":
            return [*adb_prefix(serial), "shell", "monkey", "-p", package_name, "-c", "android.intent.category.LAUNCHER", "1"]
        if operation == "start_activity":
            return [*adb_prefix(serial), "shell", "am", "start", "-n", activity]
        return [*adb_prefix(serial), "shell", "(unknown app action)"]
    if kind == "adb_shell":
        return [*adb_prefix(serial), "shell", str(step.get("command", "")).strip()]
    if kind == "adb_raw":
        return [*adb_prefix(serial), *split_args(step.get("command", ""))]
    if kind == "adb_script":
        return preview_adb_script(step, serial)
    if kind == "input_text":
        input_mode = str(step.get("inputMode") or "auto").strip()
        if input_mode == "adb_input":
            return [*adb_prefix(serial), "shell", "input", "text", adb_escape_input_text(step.get("text", ""))]
        commands = preview_temporary_agent_ime_commands(serial, [
            [*adb_prefix(serial), "shell", "content", "write", "--uri", CQCLAW_AGENT_INPUT_URI],
            [*adb_prefix(serial), "shell", "content", "call", "--uri", CQCLAW_AGENT_CLIPBOARD_URI, "--method", "input_status"],
        ])
        return {
            "command": commands[-1],
            "commandText": "\n".join(
                command_text(command) + ("  < 输入文本" if "write" in command else "")
                for command in commands
            ),
        }
    if kind == "set_clipboard":
        commands = preview_temporary_agent_ime_commands(serial, [
            [*adb_prefix(serial), "shell", "content", "write", "--uri", CQCLAW_AGENT_CLIPBOARD_URI],
        ])
        return {
            "command": commands[-2],
            "commandText": "\n".join(
                command_text(command) + ("  < 剪切板文本" if "write" in command else "")
                for command in commands
            ),
        }
    if kind == "agent_clipboard":
        operation = str(step.get("operation") or "read").strip()
        if operation == "read":
            commands = preview_temporary_agent_ime_commands(serial, [
                [*adb_prefix(serial), "shell", "content", "read", "--uri", CQCLAW_AGENT_CLIPBOARD_URI],
            ])
            return {"command": commands[-2], "commandText": "\n".join(command_text(command) for command in commands)}
        if operation in {"set", "set_and_paste"}:
            action_commands = [[*adb_prefix(serial), "shell", "content", "write", "--uri", CQCLAW_AGENT_CLIPBOARD_URI]]
            commands = preview_temporary_agent_ime_commands(serial, action_commands)
            if operation == "set_and_paste":
                action_commands = [
                    [*adb_prefix(serial), "shell", "content", "write", "--uri", CQCLAW_AGENT_INPUT_URI],
                    [*adb_prefix(serial), "shell", "content", "call", "--uri", CQCLAW_AGENT_CLIPBOARD_URI, "--method", "input_status"],
                ]
                commands = preview_temporary_agent_ime_commands(serial, action_commands)
            return {
                "command": commands[-1] if operation == "set_and_paste" else action_commands[-1],
                "commandText": "\n".join(
                    command_text(command) + ("  < 剪切板文本" if "write" in command else "")
                    for command in commands
                ),
            }
        if operation == "enable_ime":
            commands = [
                [*adb_prefix(serial), "shell", "ime", "enable", CQCLAW_AGENT_IME_ID],
                [*adb_prefix(serial), "shell", "ime", "set", CQCLAW_AGENT_IME_ID],
            ]
            return {"command": commands[-1], "commandText": "\n".join(command_text(command) for command in commands)}
        if operation == "status":
            command = [*adb_prefix(serial), "shell", "content", "call", "--uri", CQCLAW_AGENT_CLIPBOARD_URI, "--method", "status"]
            return {"command": command, "commandText": command_text(command)}
        return [*adb_prefix(serial), "shell", "(unknown CQClaw Agent clipboard action)"]
    if kind == "keyevent":
        return [*adb_prefix(serial), "shell", "input", "keyevent", str(step.get("key", "")).strip()]
    if kind == "script":
        return script_command(step)
    if kind == "inline_script":
        language = str(step.get("language") or "python").strip().lower()
        return [language, "(页面脚本)", *split_args(step.get("args", ""))]
    raise ValueError(f"未知动作类型: {kind}")


def adb_escape_input_text(text):
    # ADB input text treats spaces specially; %s is the most portable replacement.
    return str(text).replace("\\", "\\\\").replace(" ", "%s")


def safe_serial_dir(serial):
    return "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "_" for ch in str(serial))


def safe_output_name(name, fallback):
    cleaned = str(name or fallback).strip() or fallback
    cleaned = cleaned.replace("\\", "_").replace("/", "_").replace(":", "_")
    return cleaned


def remote_pull_name(remote_path, serial):
    cleaned = str(remote_path or "").strip().rstrip("/")
    basename = posixpath.basename(cleaned)
    fallback = f"pull_{safe_serial_dir(serial)}_{time.strftime('%Y%m%d-%H%M%S')}"
    return safe_output_name(basename, fallback)


def pull_target_path(step, serial):
    remote_path = str(step.get("remotePath", "")).strip()
    dest_dir = str(step.get("destDir", "") or settings().get("quickOutputDir")).strip()
    target_dir = Path(dest_dir).expanduser()
    return target_dir / remote_pull_name(remote_path, serial)


def timestamped_output_name(name):
    path = Path(name)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    if path.suffix:
        return f"{path.stem}_{stamp}{path.suffix}"
    return f"{path.name}_{stamp}"


def remote_open_local_path(remote_path, serial):
    target_dir = tmp_scripts_dir() / "remote-open" / safe_serial_dir(serial)
    target_dir.mkdir(parents=True, exist_ok=True)
    return target_dir / timestamped_output_name(remote_pull_name(remote_path, serial))


def output_path(dest_dir, filename, fallback):
    target = str(dest_dir or "").strip() or settings().get("quickOutputDir")
    target_dir = Path(str(target).strip()).expanduser()
    target_dir.mkdir(parents=True, exist_ok=True)
    return target_dir / safe_output_name(filename, fallback)


def screen_record_dirs(step):
    custom_dir = str(step.get("remoteTempDir", "")).strip().rstrip("/")
    if custom_dir:
        return [custom_dir]
    return [
        "/sdcard/Download",
        "/sdcard/Movies",
        "/sdcard/DCIM",
        "/storage/emulated/0/Download",
        "/data/local/tmp",
    ]


def remote_record_path(directory, serial):
    return f"{directory.rstrip('/')}/adb-box-record-{safe_serial_dir(serial)}-{int(time.time() * 1000)}.mp4"


def run_binary_to_file(args, path, timeout=None):
    started = time.time()
    try:
        proc = subprocess.run(args, capture_output=True, timeout=timeout or None, **hidden_subprocess_kwargs())
        if proc.returncode == 0:
            Path(path).write_bytes(proc.stdout)
        return {
            "ok": proc.returncode == 0,
            "code": proc.returncode,
            "stdout": f"Saved to {path}\n" if proc.returncode == 0 else "",
            "stderr": decode_process_output(proc.stderr),
            "durationMs": round((time.time() - started) * 1000),
            "command": args,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "code": None,
            "stdout": "",
            "stderr": f"Timeout after {timeout}s\n{decode_process_output(exc.stderr)}",
            "durationMs": round((time.time() - started) * 1000),
            "command": args,
        }
    except FileNotFoundError as exc:
        return {
            "ok": False,
            "code": None,
            "stdout": "",
            "stderr": str(exc),
            "durationMs": round((time.time() - started) * 1000),
            "command": args,
        }


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def png_validation_error(data):
    if not isinstance(data, (bytes, bytearray)):
        return "截图数据不是二进制"
    payload = bytes(data)
    if len(payload) < 33:
        return f"PNG 数据过短: {len(payload)} bytes"
    if not payload.startswith(PNG_SIGNATURE):
        prefix = payload[:16].hex(" ")
        return f"PNG 签名无效: {prefix}"
    offset = len(PNG_SIGNATURE)
    first_chunk = True
    saw_idat = False
    while offset + 8 <= len(payload):
        length = int.from_bytes(payload[offset:offset + 4], "big")
        chunk_type = payload[offset + 4:offset + 8]
        chunk_end = offset + 8 + length + 4
        if chunk_end > len(payload):
            return f"PNG chunk {chunk_type.decode('latin1', 'replace')} 数据不完整"
        if first_chunk:
            if chunk_type != b"IHDR" or length != 13:
                return "PNG 首个 chunk 不是有效 IHDR"
            width = int.from_bytes(payload[offset + 8:offset + 12], "big")
            height = int.from_bytes(payload[offset + 12:offset + 16], "big")
            if width <= 0 or height <= 0:
                return f"PNG 尺寸异常: {width}x{height}"
            first_chunk = False
        if chunk_type == b"IDAT":
            saw_idat = True
        if chunk_type == b"IEND":
            return "" if saw_idat else "PNG 缺少 IDAT chunk"
        offset = chunk_end
    return "PNG 缺少 IEND chunk"


def normalize_screenshot_png_bytes(data):
    error = png_validation_error(data)
    if not error:
        return bytes(data), ""
    if not data:
        return b"", error
    repaired = bytes(data).replace(b"\r\n", b"\n")
    if repaired != data and not png_validation_error(repaired):
        return repaired, "已修复 ADB stdout 的 CRLF 换行污染"
    return bytes(data), error


def screenshot_remote_paths(serial):
    name = f"aas-screen-{safe_serial_dir(serial)}-{uuid.uuid4().hex}.png"
    return [
        f"/data/local/tmp/{name}",
        f"/sdcard/Download/{name}",
        f"/sdcard/{name}",
    ]


def summarize_binary_stdout(data):
    if not data:
        return "stdout 为空"
    preview = bytes(data[:80])
    try:
        text = preview.decode("utf-8", errors="replace").strip()
    except Exception:
        text = ""
    return f"{len(data)} bytes; prefix={preview.hex(' ')}" + (f"; text={text}" if text else "")


def capture_screenshot_png(serial, path, timeout=None):
    started = time.time()
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    diagnostics = []

    primary = run_binary([*adb_prefix(serial), "exec-out", "screencap", "-p"], timeout=timeout or 30)
    if primary.get("ok"):
        png_bytes, note_or_error = normalize_screenshot_png_bytes(primary.get("stdout") or b"")
        if not png_validation_error(png_bytes):
            path.write_bytes(png_bytes)
            stderr = primary.get("stderr", "")
            if note_or_error:
                stderr = (stderr.rstrip() + "\n" + note_or_error).strip()
            return {
                **primary,
                "ok": True,
                "stdout": f"Saved to {path}\n",
                "stderr": stderr,
                "durationMs": round((time.time() - started) * 1000),
                "path": str(path),
            }
        diagnostics.append(f"exec-out 返回的截图不是有效 PNG: {note_or_error}; {summarize_binary_stdout(primary.get('stdout') or b'')}")
    else:
        diagnostics.append(f"exec-out 截图失败: {primary.get('stderr') or primary.get('code')}")

    for remote_path in screenshot_remote_paths(serial):
        shell_result = run_process([*adb_prefix(serial), "shell", "screencap", "-p", remote_path], timeout=timeout or 30)
        if not shell_result.get("ok"):
            diagnostics.append(f"{remote_path}: 手机端截图失败: {shell_result.get('stderr') or shell_result.get('code')}")
            continue
        pull_result = run_process([*adb_prefix(serial), "pull", remote_path, str(path)], timeout=timeout or 30)
        run_process([*adb_prefix(serial), "shell", "rm", "-f", remote_path], timeout=10)
        if not pull_result.get("ok"):
            diagnostics.append(f"{remote_path}: pull 失败: {pull_result.get('stderr') or pull_result.get('code')}")
            continue
        try:
            pulled = path.read_bytes()
        except OSError as exc:
            diagnostics.append(f"{remote_path}: 读取本机截图失败: {exc}")
            continue
        png_bytes, note_or_error = normalize_screenshot_png_bytes(pulled)
        error = png_validation_error(png_bytes)
        if error:
            diagnostics.append(f"{remote_path}: pull 后仍不是有效 PNG: {error}; {summarize_binary_stdout(pulled)}")
            try:
                path.unlink()
            except OSError:
                pass
            continue
        if png_bytes != pulled:
            path.write_bytes(png_bytes)
        stderr = "\n".join(item for item in [pull_result.get("stderr", ""), note_or_error] if item).strip()
        return {
            **pull_result,
            "ok": True,
            "stdout": f"Saved to {path}\n",
            "stderr": stderr,
            "durationMs": round((time.time() - started) * 1000),
            "path": str(path),
        }

    return {
        "ok": False,
        "code": primary.get("code"),
        "stdout": "",
        "stderr": "\n".join(diagnostics).strip() or "截图失败",
        "durationMs": round((time.time() - started) * 1000),
        "command": primary.get("command") or [*adb_prefix(serial), "exec-out", "screencap", "-p"],
        "path": str(path),
    }


def combine_results(results, command):
    return {
        "ok": all(result.get("ok") for result in results),
        "code": 0 if all(result.get("ok") for result in results) else next((result.get("code") for result in results if not result.get("ok")), None),
        "stdout": "\n".join(result.get("stdout", "").rstrip() for result in results if result.get("stdout")).strip() + ("\n" if any(result.get("stdout") for result in results) else ""),
        "stderr": "\n".join(result.get("stderr", "").rstrip() for result in results if result.get("stderr")).strip() + ("\n" if any(result.get("stderr") for result in results) else ""),
        "durationMs": sum(result.get("durationMs", 0) for result in results),
        "command": command,
    }


def execute_install_apk(step, serial, timeout):
    apks, commands = install_apk_commands(step, serial)
    continue_on_apk_error = bool(step.get("continueOnApkError", False))
    results = []
    executed_commands = []
    total = len(apks)
    for index, (apk, command) in enumerate(zip(apks, commands), start=1):
        result = run_process(command, timeout=timeout)
        label = f"[{index}/{total}] {apk.name}"
        result["stdout"] = f"{label}\n{result.get('stdout', '')}"
        if not result["ok"]:
            result["stderr"] = f"{label}\n{result.get('stderr', '')}"
        results.append(result)
        executed_commands.append(command)
        if not result["ok"] and not continue_on_apk_error:
            break
    if len(results) == 1 and total == 1:
        results[0]["commandText"] = command_text(executed_commands[0])
        return results[0]
    combined = combine_results(results, ["install-apk-folder"])
    combined["commandText"] = "\n".join(command_text(command) for command in executed_commands)
    if len(results) < total:
        skipped = total - len(results)
        message = f"已停止，剩余 {skipped} 个 APK 未安装。"
        combined["stderr"] = (combined.get("stderr", "") + message + "\n").lstrip()
    return combined


def execute_screen_record(step, serial, timeout):
    seconds = max(1, min(180, int(step.get("seconds") or 10)))
    local_path = output_path(step.get("destDir", ""), step.get("filename", ""), f"record_{serial}_{int(time.time())}.mp4")
    failures = []
    last_results = []
    for directory in screen_record_dirs(step):
        remote_path = remote_record_path(directory, serial)
        record_cmd = [*adb_prefix(serial), "shell", "screenrecord", "--time-limit", str(seconds), remote_path]
        pull_cmd = [*adb_prefix(serial), "pull", remote_path, str(local_path)]
        cleanup_cmd = [*adb_prefix(serial), "shell", "rm", "-f", remote_path]
        record_result = run_process(record_cmd, timeout=(timeout or seconds + 30))
        last_results = [record_result]
        if not record_result["ok"]:
            failures.append(f"{directory}: {record_result.get('stderr', '').strip() or 'record failed'}")
            cleanup_result = run_process(cleanup_cmd, timeout=15)
            last_results.append(cleanup_result)
            continue
        pull_result = run_process(pull_cmd, timeout=timeout)
        cleanup_result = run_process(cleanup_cmd, timeout=15)
        last_results = [record_result, pull_result, cleanup_result]
        if pull_result["ok"]:
            pull_result["stdout"] += f"Saved to {local_path}\nRemote temp path: {remote_path}\n"
            result = combine_results(last_results, [*record_cmd, "&&", *pull_cmd])
            result["ok"] = True
            result["code"] = 0
            if failures:
                result["stderr"] = "Previous temp paths failed:\n" + "\n".join(failures) + ("\n" + result["stderr"] if result["stderr"] else "\n")
            return result
        failures.append(f"{directory}: {pull_result.get('stderr', '').strip() or 'pull failed'}")
    failed = combine_results(last_results, ["screenrecord", "(all temp paths failed)"])
    failed["ok"] = False
    failed["stderr"] = "All screenrecord temp paths failed:\n" + "\n".join(failures) + ("\n" + failed["stderr"] if failed.get("stderr") else "\n")
    return failed


def remote_parent(path):
    cleaned = str(path or "/sdcard/").strip() or "/sdcard/"
    if cleaned == "/":
        return "/"
    return posixpath.dirname(cleaned.rstrip("/")) or "/"


def remote_child(base, name):
    base = str(base or "/").strip() or "/"
    joined = posixpath.join(base.rstrip("/") or "/", name)
    return joined or "/"


def parse_remote_ls(path, output):
    entries = []
    for raw_line in output.splitlines():
        line = raw_line.rstrip("\r")
        if not line or line.startswith("total "):
            continue
        long_match = re.match(
            r"^([bcdlps-][rwxstST-]{9})\s+(?:\d+\s+)?(\S+)\s+(\S+)\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+)$",
            line,
        )
        if long_match:
            mode, owner, group, size, date, clock, name = long_match.groups()
            if name in {".", ".."}:
                continue
            link_target = ""
            if " -> " in name:
                name, link_target = name.split(" -> ", 1)
            if name.startswith("/"):
                entry_path = name
                name = posixpath.basename(name.rstrip("/")) or name
            else:
                entry_path = remote_child(path, name)
            entry_type = "directory" if mode.startswith("d") else "file"
            if mode.startswith("l"):
                entry_type = "symlink"
            entries.append({
                "name": name,
                "path": entry_path,
                "type": entry_type,
                "mode": mode,
                "size": size,
                "sizeBytes": int(size) if str(size).isdigit() else None,
                "modified": f"{date} {clock}",
                "owner": owner,
                "group": group,
                "linkTarget": link_target,
                "targetPath": remote_child(path, link_target) if link_target and not link_target.startswith("/") else link_target,
            })
            continue
        fallback_long_match = re.match(
            r"^([bcdlps-][rwxstST-]{9})\s+(?:\d+\s+)?(\S+)\s+(\S+)\s+(\d+)\s+([A-Za-z]{3}\s+\d{1,2}\s+(?:\d{2}:\d{2}|\d{4}))\s+(.+)$",
            line,
        )
        if fallback_long_match:
            mode, owner, group, size, modified, name = fallback_long_match.groups()
            if name in {".", ".."}:
                continue
            link_target = ""
            if " -> " in name:
                name, link_target = name.split(" -> ", 1)
            if name.startswith("/"):
                entry_path = name
                name = posixpath.basename(name.rstrip("/")) or name
            else:
                entry_path = remote_child(path, name)
            entry_type = "directory" if mode.startswith("d") else "file"
            if mode.startswith("l"):
                entry_type = "symlink"
            entries.append({
                "name": name,
                "path": entry_path,
                "type": entry_type,
                "mode": mode,
                "size": size,
                "sizeBytes": int(size) if str(size).isdigit() else None,
                "modified": modified,
                "owner": owner,
                "group": group,
                "linkTarget": link_target,
                "targetPath": remote_child(path, link_target) if link_target and not link_target.startswith("/") else link_target,
            })
            continue
        if line in {".", ".."}:
            continue
        is_directory = line.endswith("/")
        name = line.rstrip("/")
        if name.startswith("/"):
            entry_path = name
            name = posixpath.basename(name.rstrip("/")) or name
        else:
            entry_path = remote_child(path, name)
        entries.append({
            "name": name,
            "path": entry_path,
            "type": "directory" if is_directory else "file",
            "mode": "d" if is_directory else "-",
            "size": "",
            "sizeBytes": None,
            "modified": "",
            "owner": "",
            "group": "",
            "linkTarget": "",
            "targetPath": "",
        })
    entries.sort(key=lambda item: (item["type"] != "directory", item["name"].lower()))
    return entries


def list_remote_path(payload):
    serial = str(payload.get("serial") or "").strip()
    path = str(payload.get("path") or "/sdcard/").strip() or "/sdcard/"
    if not serial:
        return {"ok": False, "error": "请选择一台设备", "path": path, "entries": []}
    quoted_path = shlex.quote(path)
    command = f"p={quoted_path}; if [ -d \"$p\" ]; then ls -la --time-style=long-iso \"$p\"/; else ls -la --time-style=long-iso \"$p\"; fi"
    result = run_process([*adb_prefix(serial), "shell", command], timeout=20)
    fallback_result = None
    if not result["ok"] or "unrecognized option" in (result.get("stderr") or ""):
        fallback_result = run_process([*adb_prefix(serial), "shell", f"p={quoted_path}; if [ -d \"$p\" ]; then ls -la \"$p\"/; else ls -la \"$p\"; fi"], timeout=20)
        if fallback_result["ok"]:
            result = fallback_result
    if not result["ok"]:
        fallback_result = run_process([*adb_prefix(serial), "shell", f"p={quoted_path}; if [ -d \"$p\" ]; then ls -1Ap \"$p\"/; else ls -1Ap \"$p\"; fi"], timeout=20)
        if fallback_result["ok"]:
            result = fallback_result
    return {
        "ok": result["ok"],
        "path": path,
        "parent": remote_parent(path),
        "entries": parse_remote_ls(path, result["stdout"]) if result["ok"] else [],
        "stdout": result["stdout"],
        "stderr": result["stderr"],
        "commandText": command_text(result.get("command", [])),
    }


def open_remote_file(payload):
    serial = require_serial(payload)
    remote_path = str(payload.get("path") or "").strip()
    timeout = int(payload.get("timeout") or 180)
    if not remote_path:
        raise ValueError("手机文件路径不能为空")
    if remote_path.endswith("/"):
        raise ValueError("请选择具体文件，目录请直接进入浏览")
    local_path = remote_open_local_path(remote_path, serial)
    pull_result = run_process([*adb_prefix(serial), "pull", remote_path, str(local_path)], timeout=timeout)
    if not pull_result["ok"]:
        return {
            "ok": False,
            "serial": serial,
            "remotePath": remote_path,
            "localPath": str(local_path),
            "stderr": pull_result.get("stderr") or pull_result.get("stdout") or "拷贝手机文件失败",
            "pullResult": pull_result,
        }
    open_result = open_local_path(local_path)
    return {
        "ok": open_result["ok"],
        "serial": serial,
        "remotePath": remote_path,
        "localPath": str(local_path),
        "stderr": open_result.get("stderr", ""),
        "pullResult": pull_result,
        "openResult": open_result,
    }


def require_serial(payload):
    serial = str(payload.get("serial") or "").strip()
    if not serial:
        raise ValueError("请选择一台设备")
    return serial


def adb_shell_result(serial, command, timeout=15):
    return run_process([*adb_prefix(serial), "shell", command], timeout=timeout)


def first_nonempty(value):
    for line in str(value or "").splitlines():
        cleaned = line.strip()
        if cleaned:
            return cleaned
    return ""


def trim_text(text, limit=6000):
    value = str(text or "")
    if len(value) <= limit:
        return value
    return value[:limit] + f"\n... trimmed {len(value) - limit} chars ..."


def compact_result(result, stdout_limit=1200):
    return {
        "ok": result.get("ok"),
        "code": result.get("code"),
        "stdout": trim_text(result.get("stdout", ""), stdout_limit),
        "stderr": trim_text(result.get("stderr", ""), stdout_limit),
        "durationMs": result.get("durationMs", 0),
        "command": result.get("command", []),
    }


def parse_component(text):
    patterns = [
        r"([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)/([A-Za-z0-9_.$]+)",
        r"([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)/(\.[A-Za-z0-9_.$]+)",
    ]
    preferred_words = ("Resumed", "topResumed", "mCurrentFocus", "mFocusedApp", "mResumedActivity")
    lines = str(text or "").splitlines()
    ordered = [line for line in lines if any(word in line for word in preferred_words)] + lines
    for line in ordered:
        for pattern in patterns:
            match = re.search(pattern, line)
            if not match:
                continue
            package_name = match.group(1)
            activity_part = match.group(2)
            activity = package_name + activity_part if activity_part.startswith(".") else activity_part
            return {
                "package": package_name,
                "activity": activity,
                "component": f"{package_name}/{activity_part}",
                "sourceLine": line.strip(),
            }
    return {"package": "", "activity": "", "component": "", "sourceLine": ""}


def excerpt_around_line(text, needle, radius=7):
    lines = str(text or "").splitlines()
    if not lines:
        return ""
    index = next((i for i, line in enumerate(lines) if needle and needle in line), -1)
    if index < 0:
        return trim_text("\n".join(lines[:40]), 4000)
    start = max(0, index - radius)
    end = min(len(lines), index + radius + 1)
    return "\n".join(lines[start:end])


def device_top_activity(payload):
    serial = require_serial(payload)
    commands = [
        "dumpsys activity activities",
        "dumpsys window windows",
        "dumpsys activity top",
    ]
    results = []
    raw_parts = []
    for command in commands:
        result = adb_shell_result(serial, command, timeout=15)
        results.append(compact_result(result))
        parsed = parse_component(result["stdout"])
        if parsed["component"]:
            excerpt = excerpt_around_line(result["stdout"], parsed["sourceLine"])
            return {
                "ok": True,
                "serial": serial,
                **parsed,
                "raw": f"$ adb shell {command}\n{excerpt}",
                "results": results,
            }
        if result["stdout"] or result["stderr"]:
            raw_parts.append(f"$ adb shell {command}\n{trim_text(result['stdout'] or result['stderr'], 1800)}")
    return {
        "ok": False,
        "serial": serial,
        "package": "",
        "activity": "",
        "component": "",
        "sourceLine": "",
        "raw": trim_text("\n\n".join(raw_parts), 6000),
        "stderr": "\n".join(result.get("stderr", "").strip() for result in results if result.get("stderr")).strip(),
        "results": results,
        "error": "没有解析到顶部 Activity",
    }


def parse_key_value_lines(text):
    values = {}
    for line in str(text or "").splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        values[key.strip()] = value.strip()
    return values


def parse_ip_address(text):
    match = re.search(r"\binet\s+([0-9.]+/\d+)", str(text or ""))
    return match.group(1) if match else ""


def parse_storage_line(text):
    raw_lines = [line for line in str(text or "").splitlines() if line.strip()]
    if not raw_lines:
        return {}
    raw_lines[0] = raw_lines[0].replace("Mounted on", "Mounted")
    lines = [line.split() for line in raw_lines]
    if len(lines) < 2:
        return {}
    header = [item.lower() for item in lines[0]]
    values = lines[1]
    if len(values) < len(header):
        return {"raw": " ".join(values)}
    return dict(zip(header, values))


def device_details(payload):
    serial = require_serial(payload)
    prop_keys = [
        "ro.product.brand",
        "ro.product.manufacturer",
        "ro.product.model",
        "ro.product.name",
        "ro.product.device",
        "ro.build.version.release",
        "ro.build.version.sdk",
        "ro.build.version.security_patch",
        "ro.product.cpu.abi",
    ]
    props = {}
    results = []
    for key in prop_keys:
        result = adb_shell_result(serial, f"getprop {key}", timeout=8)
        results.append(result)
        props[key] = first_nonempty(result["stdout"])
    wm_size = adb_shell_result(serial, "wm size", timeout=8)
    wm_density = adb_shell_result(serial, "wm density", timeout=8)
    battery = adb_shell_result(serial, "dumpsys battery", timeout=10)
    ip_info = adb_shell_result(serial, "ip -f inet addr show wlan0", timeout=8)
    storage = adb_shell_result(serial, "df -h /sdcard", timeout=8)
    results.extend([wm_size, wm_density, battery, ip_info, storage])

    return {
        "ok": any(result["ok"] for result in results),
        "serial": serial,
        "props": props,
        "screen": {
            "size": first_nonempty(wm_size["stdout"]).replace("Physical size:", "").strip(),
            "density": first_nonempty(wm_density["stdout"]).replace("Physical density:", "").strip(),
            "rawSize": wm_size["stdout"],
            "rawDensity": wm_density["stdout"],
        },
        "battery": parse_key_value_lines(battery["stdout"]),
        "network": {
            "wlan0": parse_ip_address(ip_info["stdout"]),
            "raw": ip_info["stdout"],
        },
        "storage": parse_storage_line(storage["stdout"]),
        "raw": {
            "battery": battery["stdout"],
            "network": ip_info["stdout"],
            "storage": storage["stdout"],
        },
        "results": results,
    }


COMMON_DANGEROUS_PERMISSIONS = [
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.READ_CONTACTS",
    "android.permission.WRITE_CONTACTS",
    "android.permission.GET_ACCOUNTS",
    "android.permission.READ_CALENDAR",
    "android.permission.WRITE_CALENDAR",
    "android.permission.READ_PHONE_STATE",
    "android.permission.READ_PHONE_NUMBERS",
    "android.permission.ANSWER_PHONE_CALLS",
    "android.permission.CALL_PHONE",
    "android.permission.READ_CALL_LOG",
    "android.permission.WRITE_CALL_LOG",
    "android.permission.READ_SMS",
    "android.permission.SEND_SMS",
    "android.permission.RECEIVE_SMS",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.READ_MEDIA_AUDIO",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.BLUETOOTH_SCAN",
    "android.permission.BLUETOOTH_CONNECT",
    "android.permission.NEARBY_WIFI_DEVICES",
    "android.permission.ACTIVITY_RECOGNITION",
    "android.permission.BODY_SENSORS",
    "android.permission.UWB_RANGING",
]

SPECIAL_PERMISSIONS = {
    "android.permission.MANAGE_EXTERNAL_STORAGE": ("appops", "MANAGE_EXTERNAL_STORAGE"),
    "android.permission.SYSTEM_ALERT_WINDOW": ("appops", "SYSTEM_ALERT_WINDOW"),
    "android.permission.WRITE_SETTINGS": ("appops", "WRITE_SETTINGS"),
    "android.permission.REQUEST_INSTALL_PACKAGES": ("appops", "REQUEST_INSTALL_PACKAGES"),
    "android.permission.BATTERY_OPTIMIZATIONS": ("deviceidle", "BATTERY_OPTIMIZATIONS"),
}

# pm grant 只能处理 Android runtime permission。部分 ROM/Android 版本会因为
# restricted permission、user-fixed、或厂商权限策略导致 pm grant 失败。
# 这些权限在系统设置页通常最终也是 AppOps 生效，所以在 pm grant 失败后做一次
# appops 兜底，让“能自动处理的尽量处理，不能处理的给用户明确原因”。
PERMISSION_APP_OPS = {
    "android.permission.ACCESS_COARSE_LOCATION": "COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION": "FINE_LOCATION",
    "android.permission.ACCESS_BACKGROUND_LOCATION": "ACCESS_BACKGROUND_LOCATION",
    "android.permission.ACTIVITY_RECOGNITION": "ACTIVITY_RECOGNITION",
    "android.permission.BLUETOOTH_ADVERTISE": "BLUETOOTH_ADVERTISE",
    "android.permission.BLUETOOTH_CONNECT": "BLUETOOTH_CONNECT",
    "android.permission.BLUETOOTH_SCAN": "BLUETOOTH_SCAN",
    "android.permission.CAMERA": "CAMERA",
    "android.permission.NEARBY_WIFI_DEVICES": "NEARBY_WIFI_DEVICES",
    "android.permission.POST_NOTIFICATIONS": "POST_NOTIFICATION",
    "android.permission.READ_CALENDAR": "READ_CALENDAR",
    "android.permission.WRITE_CALENDAR": "WRITE_CALENDAR",
    "android.permission.READ_CONTACTS": "READ_CONTACTS",
    "android.permission.WRITE_CONTACTS": "WRITE_CONTACTS",
    "android.permission.GET_ACCOUNTS": "GET_ACCOUNTS",
    "android.permission.RECORD_AUDIO": "RECORD_AUDIO",
    "android.permission.READ_EXTERNAL_STORAGE": "READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE": "WRITE_EXTERNAL_STORAGE",
    "android.permission.READ_MEDIA_AUDIO": "READ_MEDIA_AUDIO",
    "android.permission.READ_MEDIA_IMAGES": "READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO": "READ_MEDIA_VIDEO",
    "android.permission.READ_MEDIA_VISUAL_USER_SELECTED": "READ_MEDIA_VISUAL_USER_SELECTED",
    "android.permission.READ_PHONE_STATE": "READ_PHONE_STATE",
    "android.permission.READ_PHONE_NUMBERS": "READ_PHONE_NUMBERS",
    "android.permission.ANSWER_PHONE_CALLS": "ANSWER_PHONE_CALLS",
    "android.permission.CALL_PHONE": "CALL_PHONE",
    "android.permission.READ_CALL_LOG": "READ_CALL_LOG",
    "android.permission.WRITE_CALL_LOG": "WRITE_CALL_LOG",
    "android.permission.READ_SMS": "READ_SMS",
    "android.permission.SEND_SMS": "SEND_SMS",
    "android.permission.RECEIVE_SMS": "RECEIVE_SMS",
    "android.permission.BODY_SENSORS": "BODY_SENSORS",
    "android.permission.UWB_RANGING": "UWB_RANGING",
}

DANGEROUS_PERMISSION_SET = set(COMMON_DANGEROUS_PERMISSIONS) | set(SPECIAL_PERMISSIONS)


def normalize_permission_name(value):
    text = str(value or "").strip()
    if not text:
        return ""
    if "." not in text:
        return f"android.permission.{text}"
    return text



def device_preferred_locales(serial):
    result = adb_shell_result(serial, "settings get system system_locales; getprop persist.sys.locale; getprop ro.product.locale", timeout=8)
    values = []
    if result["ok"]:
        for raw in result["stdout"].splitlines():
            cleaned = normalize_locale(raw.split(",", 1)[0])
            if cleaned and cleaned not in values:
                values.append(cleaned)
    for fallback in ("zh-CN", "zh", "en-US", "en", ""):
        if fallback not in values:
            values.append(fallback)
    return values


def app_label_cache_key(serial, app):
    return "|".join([
        str(serial or ""),
        str(app.get("packageName") or ""),
        str(app.get("versionCode") or ""),
        str(app.get("apkPath") or app.get("installPath") or ""),
    ])


def load_known_labels():
    data = read_json(KNOWN_LABELS_FILE, {})
    return data if isinstance(data, dict) else {}


def save_known_labels(labels):
    with CACHE_LOCK:
        write_json(KNOWN_LABELS_FILE, labels)


def merge_known_label(package_name, known_labels):
    entry = known_labels.get(package_name) or known_labels.get(package_name.lower())
    if isinstance(entry, dict) and entry.get("label"):
        return entry["label"], entry.get("source") or "known"
    if isinstance(entry, str) and entry:
        return entry, "known"
    return None, None


def app_apk_path(serial, app, timeout=10):
    path = str(app.get("apkPath") or "").strip()
    if path.endswith(".apk"):
        return path
    package_name = str(app.get("packageName") or "").strip()
    if not package_name:
        return ""
    result = adb_shell_result(serial, f"pm path {shlex.quote(package_name)}", timeout=timeout)
    if not result["ok"]:
        return ""
    paths = [line.split(":", 1)[1].strip() for line in result["stdout"].splitlines() if line.strip().startswith("package:")]
    base = next((item for item in paths if item.endswith("/base.apk")), None)
    return base or (paths[0] if paths else "")




def safe_cache_part(value):
    text = str(value or "").strip() or "unknown"
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", text)[:120]


def app_icon_cache_key(serial, app):
    return "|".join([
        str(serial or ""),
        str(app.get("packageName") or ""),
        str(app.get("versionCode") or ""),
        str(app.get("apkPath") or app.get("installPath") or ""),
    ])



def resolve_app_icon(serial, package_name, include_system=True, force=False, timeout=60):
    package_name = str(package_name or "").strip()
    if not package_name:
        return {"ok": False, "error": "缺少包名"}
    apps, _ = load_cached_app_list(serial, bool(include_system))
    if not apps:
        result = quick_device_apps(serial, bool(include_system))
        apps = result.get("apps") or []
    app = next((item for item in apps if item.get("packageName") == package_name), None)
    if not app:
        fresh = quick_device_apps(serial, bool(include_system))
        app = next((item for item in (fresh.get("apps") or []) if item.get("packageName") == package_name), None)
    if not app:
        return {"ok": False, "error": f"未找到 App：{package_name}"}

    with CACHE_LOCK:
        index = read_json(APP_ICON_CACHE_INDEX_FILE, {})
    index = index if isinstance(index, dict) else {}
    key = app_icon_cache_key(serial, app)
    cached = index.get(key)
    if not force and isinstance(cached, dict) and cached.get("path"):
        cached_path = Path(cached["path"])
        if cached_path.exists() and cached_path.is_file():
            return {"ok": True, "path": str(cached_path), "mime": cached.get("mime") or icon_mime_type(cached_path), "source": "cache"}

    deadline = time.time() + max(10, int(timeout or 60))
    apk_path = app_apk_path(serial, app, timeout=10)
    app["apkPath"] = apk_path or app.get("apkPath") or ""
    if not apk_path:
        return {"ok": False, "error": "没有找到 APK 路径"}
    if time.time() > deadline:
        return {"ok": False, "error": "解析 icon 超时"}

    if not APP_ICON_SEMAPHORE.acquire(timeout=120):
        return {"ok": False, "error": "icon 队列繁忙，请稍后重试"}
    work_dir = tempfile.mkdtemp(prefix="app-icon-", dir=str(tmp_scripts_dir()))
    local_apk = Path(work_dir) / f"{safe_cache_part(package_name)}.apk"
    try:
        pull_result = run_process([*adb_prefix(serial), "pull", apk_path, str(local_apk)], timeout=max(15, min(45, int(deadline - time.time()) or 15)))
        if not pull_result.get("ok"):
            return {"ok": False, "error": first_nonempty(pull_result.get("stderr") or pull_result.get("stdout")) or "拉取 APK 失败"}
        icon_path, error = save_icon_from_apk(
            local_apk,
            package_name,
            serial,
            app,
            APP_ICON_CACHE_DIR,
            safe_cache_part,
            find_aapt_tool(),
            device_preferred_locales(serial),
        )
        if not icon_path:
            return {"ok": False, "error": error or "解析 icon 失败"}
        mime = icon_mime_type(icon_path)
        with CACHE_LOCK:
            index = read_json(APP_ICON_CACHE_INDEX_FILE, {})
            index = index if isinstance(index, dict) else {}
            # 清理同一设备/包名的旧版本索引，避免缓存文件无限增长。
            prefix = f"{serial}|{package_name}|"
            for old_key in list(index.keys()):
                if old_key.startswith(prefix) and old_key != key:
                    old_path = Path((index.get(old_key) or {}).get("path") or "")
                    try:
                        if old_path.exists():
                            old_path.unlink()
                    except Exception:
                        pass
                    index.pop(old_key, None)
            index[key] = {"path": icon_path, "mime": mime, "updatedAt": int(time.time()), "versionCode": app.get("versionCode") or ""}
            write_json(APP_ICON_CACHE_INDEX_FILE, index)
        return {"ok": True, "path": icon_path, "mime": mime, "source": "apk"}
    finally:
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
        except Exception:
            pass
        APP_ICON_SEMAPHORE.release()

def resolve_app_labels(serial, apps, timeout=90, refresh_mode="full", progress_callback=None):
    """Resolve app labels from APK and persist progress incrementally."""
    apps = list(apps)
    with CACHE_LOCK:
        cache = read_json(APP_LABEL_CACHE_FILE, {})
    cache = cache if isinstance(cache, dict) else {}
    known_labels = load_known_labels()
    changed = False
    resolved = 0
    failed = 0
    skipped = 0
    preferred_locales = device_preferred_locales(serial)
    aapt_tool = find_aapt_tool()
    deadline = time.time() + max(15, int(timeout or 90))

    if refresh_mode == "single":
        targets = [app for app in apps if app.get("refreshToken")]
    else:
        targets = sorted(apps, key=lambda app: (bool(app.get("system")), app.get("packageName", "")))

    work_dir = tempfile.mkdtemp(prefix="app-labels-", dir=str(tmp_scripts_dir()))
    work_dir_path = Path(work_dir)

    def flush_progress(app=None):
        nonlocal changed
        if changed:
            with CACHE_LOCK:
                write_json(APP_LABEL_CACHE_FILE, cache)
            changed = False
        if progress_callback:
            try:
                progress_callback(app)
            except Exception:
                pass

    try:
        for app in targets:
            package_name = str(app.get("packageName") or "")
            if not package_name:
                flush_progress(app)
                continue

            key = app_label_cache_key(serial, app)
            cached = cache.get(key)

            if refresh_mode == "light" and isinstance(cached, dict) and cached.get("label"):
                cached_ver = cached.get("versionCode") or ""
                current_ver = str(app.get("versionCode") or "")
                if cached_ver == current_ver:
                    app["appName"] = cached["label"]
                    app["labelSource"] = cached.get("source") or "cache"
                    app.pop("labelError", None)
                    app.pop("refreshToken", None)
                    resolved += 1
                    flush_progress(app)
                    continue

            if refresh_mode not in {"full", "single"} and isinstance(cached, dict) and cached.get("label"):
                app["appName"] = cached["label"]
                app["labelSource"] = cached.get("source") or "cache"
                app.pop("labelError", None)
                app.pop("refreshToken", None)
                resolved += 1
                flush_progress(app)
                continue

            if time.time() > deadline:
                skipped += 1
                app["labelSource"] = "package"
                app.pop("refreshToken", None)
                flush_progress(app)
                continue

            apk_path = app_apk_path(serial, app, timeout=10)
            app["apkPath"] = apk_path or app.get("apkPath") or ""
            if not apk_path:
                label, src = merge_known_label(package_name, known_labels)
                if label:
                    app["appName"] = label
                    app["labelSource"] = src
                    app.pop("labelError", None)
                    resolved += 1
                else:
                    failed += 1
                    app["labelSource"] = "package"
                    app["labelError"] = "没有找到 APK 路径"
                app.pop("refreshToken", None)
                flush_progress(app)
                continue

            local_apk = work_dir_path / f"{re.sub(r'[^A-Za-z0-9_.-]+', '_', package_name)}.apk"
            pull_result = run_process([*adb_prefix(serial), "pull", apk_path, str(local_apk)], timeout=30)
            if not pull_result["ok"]:
                label, src = merge_known_label(package_name, known_labels)
                if label:
                    app["appName"] = label
                    app["labelSource"] = src
                    app.pop("labelError", None)
                    resolved += 1
                else:
                    failed += 1
                    app["labelSource"] = "package"
                    app["labelError"] = first_nonempty(pull_result.get("stderr") or pull_result.get("stdout")) or "拉取 APK 失败"
                if local_apk.exists():
                    local_apk.unlink()
                app.pop("refreshToken", None)
                flush_progress(app)
                continue

            label, source, error = aapt_label_from_apk(local_apk, preferred_locales, aapt_tool)
            if not label:
                label, source, error = apk_label_from_zip(local_apk, preferred_locales)

            try:
                local_apk.unlink()
            except Exception:
                pass

            if label:
                app["appName"] = label
                app["labelSource"] = source
                app.pop("labelError", None)
                cache[key] = {
                    "label": label,
                    "source": source,
                    "versionCode": str(app.get("versionCode") or ""),
                    "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
                }
                changed = True
                resolved += 1
            else:
                fallback_label, fallback_src = merge_known_label(package_name, known_labels)
                if fallback_label:
                    app["appName"] = fallback_label
                    app["labelSource"] = fallback_src
                    app.pop("labelError", None)
                    resolved += 1
                else:
                    failed += 1
                    app["labelSource"] = "package"
                    app["labelError"] = error
            app.pop("refreshToken", None)
            flush_progress(app)
    finally:
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
        except Exception:
            pass
        flush_progress(None)

    return {
        "resolved": resolved,
        "failed": failed,
        "skipped": skipped,
        "tool": aapt_tool or "内置 APK 解析器",
        "locales": [item for item in preferred_locales if item],
    }

def parse_pm_package_lines(text):
    apps = {}
    for raw in str(text or "").splitlines():
        line = raw.strip()
        if not line.startswith("package:"):
            continue
        body = line[len("package:"):]
        if "=" in body:
            path, package_name = body.rsplit("=", 1)
        else:
            path, package_name = "", body
        package_name = package_name.strip()
        if not package_name:
            continue
        apps[package_name] = {
            "appName": package_name,
            "packageName": package_name,
            "installPath": path.strip(),
            "apkPath": path.strip() if path.strip().endswith(".apk") else "",
            "versionName": "",
            "versionCode": "",
            "targetSdk": "",
            "firstInstallTime": "",
            "lastUpdateTime": "",
            "system": path.startswith(("/system/", "/vendor/", "/product/", "/apex/")),
            "disabled": False,
            "declaredPermissions": [],
            "installPermissions": [],
            "runtimePermissions": [],
            "deniedRuntimePermissions": [],
            "grantablePermissions": [],
            "grantedPermissions": [],
            "permissionStates": [],
        }
    return apps


def collect_permission_block(lines, start_index):
    values = []
    for line in lines[start_index + 1:]:
        stripped = line.strip()
        if not stripped:
            continue
        if not line.startswith(" ") or stripped.endswith(":"):
            break
        if re.match(r"[A-Za-z0-9_.]+$", stripped):
            values.append(stripped)
    return values


def collect_permission_state_block(lines, start_index, kind):
    values = {}
    for line in lines[start_index + 1:]:
        stripped = line.strip()
        if not stripped:
            continue
        match = re.match(r"([A-Za-z0-9_.]+):\s*granted=(true|false)(?:,\s*flags=\[([^\]]*)\])?", stripped)
        if match:
            values[match.group(1)] = {
                "permission": match.group(1),
                "kind": kind,
                "granted": match.group(2) == "true",
                "flags": " ".join(str(match.group(3) or "").split()),
            }
            continue
        if not line.startswith(" ") or stripped.endswith(":"):
            break
    return values


def parse_package_permissions(section):
    lines = section.splitlines()
    declared = []
    install_states = {}
    runtime_states = {}
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped == "requested permissions:":
            declared.extend(collect_permission_block(lines, index))
        elif stripped == "install permissions:":
            install_states.update(collect_permission_state_block(lines, index, "install"))
        elif stripped == "runtime permissions:":
            runtime_states.update(collect_permission_state_block(lines, index, "runtime"))
    declared = sorted(set(declared))
    runtime_permissions = sorted(runtime_states)
    special_declared = [permission for permission in declared if permission in SPECIAL_PERMISSIONS]
    grantable = sorted(set(runtime_permissions + special_declared))
    granted = sorted(
        permission
        for permission, state in {**install_states, **runtime_states}.items()
        if state.get("granted")
    )
    denied_runtime = sorted(permission for permission, state in runtime_states.items() if not state.get("granted"))
    permission_states = sorted(
        list(install_states.values()) + list(runtime_states.values()),
        key=lambda item: (item.get("kind") != "runtime", item.get("permission", "")),
    )
    return {
        "declaredPermissions": declared,
        "installPermissions": sorted(install_states),
        "runtimePermissions": runtime_permissions,
        "deniedRuntimePermissions": denied_runtime,
        "grantablePermissions": grantable,
        "grantedPermissions": granted,
        "permissionStates": permission_states,
    }


def parse_dumpsys_package_sections(text):
    apps = {}
    sections = re.split(r"(?=^\s*Package \[[^\]]+\])", str(text or ""), flags=re.M)
    for section in sections:
        match = re.search(r"^\s*Package \[([^\]]+)\]", section, re.M)
        if not match:
            continue
        package_name = match.group(1).strip()
        code_path = first_regex_group(section, r"^\s*codePath=(.+)$")
        version_name = first_regex_group(section, r"^\s*versionName=(.+)$")
        version_code = first_regex_group(section, r"versionCode=(\d+)")
        target_sdk = first_regex_group(section, r"targetSdk=(\d+)")
        first_install = first_regex_group(section, r"firstInstallTime=(.+)")
        last_update = first_regex_group(section, r"lastUpdateTime=(.+)")
        flags = first_regex_group(section, r"pkgFlags=\[([^\]]*)\]") or first_regex_group(section, r"^\s*flags=\[([^\]]*)\]")
        enabled = first_regex_group(section, r"enabled=([0-9a-zA-Z_-]+)")
        permissions = parse_package_permissions(section)
        apps[package_name] = {
            "appName": package_name,
            "packageName": package_name,
            "installPath": code_path,
            "versionName": version_name,
            "versionCode": version_code,
            "targetSdk": target_sdk,
            "firstInstallTime": first_install,
            "lastUpdateTime": last_update,
            "system": "SYSTEM" in flags or code_path.startswith(("/system/", "/vendor/", "/product/", "/apex/")),
            "disabled": enabled not in {"", "0", "1", "true", "default"},
            **permissions,
        }
    return apps


def first_regex_group(text, pattern):
    match = re.search(pattern, str(text or ""), re.M)
    return match.group(1).strip() if match else ""


def app_info_cache_key(serial, include_system):
    return f"{serial}|{'all' if include_system else 'user'}"


def cache_timestamp():
    return int(time.time())


def cache_time_text(timestamp):
    try:
        return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(int(timestamp or 0)))
    except (OSError, OverflowError, ValueError):
        return ""


def empty_app_cache_status(source="none", hit=False, stale=False, updated_at=0, scope=""):
    age_seconds = max(0, cache_timestamp() - int(updated_at or 0)) if updated_at else None
    return {
        "source": source,
        "hit": hit,
        "stale": stale,
        "updatedAt": cache_time_text(updated_at),
        "updatedAtTs": int(updated_at or 0),
        "ageSeconds": age_seconds,
        "ttlSeconds": APP_INFO_CACHE_TTL_SECONDS,
        "ttlDays": 7,
        "scope": scope,
    }


def read_app_info_cache():
    data = read_json(APP_INFO_CACHE_FILE, {})
    return data if isinstance(data, dict) else {}


def write_app_info_cache(cache):
    write_json(APP_INFO_CACHE_FILE, cache if isinstance(cache, dict) else {})


def filter_cached_apps(apps, include_system):
    items = list(apps or [])
    if include_system:
        return items
    return [app for app in items if not app.get("system")]


def load_cached_app_list(serial, include_system):
    cache = read_app_info_cache()
    keys = [app_info_cache_key(serial, include_system)]
    if not include_system:
        keys.append(app_info_cache_key(serial, True))
    for key in keys:
        entry = cache.get(key)
        if not isinstance(entry, dict):
            continue
        apps = entry.get("apps")
        if not isinstance(apps, list):
            continue
        updated_at = int(entry.get("updatedAtTs") or 0)
        stale = not updated_at or (cache_timestamp() - updated_at) > APP_INFO_CACHE_TTL_SECONDS
        return filter_cached_apps(apps, include_system), empty_app_cache_status(
            source="cache",
            hit=True,
            stale=stale,
            updated_at=updated_at,
            scope=entry.get("scope") or ("all" if key.endswith("|all") else "user"),
        )
    return [], empty_app_cache_status(source="miss", scope="all" if include_system else "user")


def save_cached_app_list(serial, include_system, apps):
    cache = read_app_info_cache()
    key = app_info_cache_key(serial, include_system)
    now = cache_timestamp()
    cache[key] = {
        "serial": serial,
        "scope": "all" if include_system else "user",
        "includeSystem": include_system,
        "updatedAt": cache_time_text(now),
        "updatedAtTs": now,
        "apps": list(apps or []),
    }
    write_app_info_cache(cache)
    return empty_app_cache_status(source="fresh", hit=True, stale=False, updated_at=now, scope=cache[key]["scope"])


def empty_process_package_cache(serial="", source="none", hit=False, stale=False, updated_at=0, pid_map=None, command=None, error=""):
    age_seconds = max(0, cache_timestamp() - int(updated_at or 0)) if updated_at else None
    mapping = dict(pid_map or {})
    return {
        "serial": serial,
        "source": source,
        "hit": hit,
        "stale": stale,
        "updatedAt": cache_time_text(updated_at),
        "updatedAtTs": int(updated_at or 0),
        "ageSeconds": age_seconds,
        "ttlSeconds": PROCESS_PACKAGE_CACHE_TTL_SECONDS,
        "processCount": len(mapping),
        "pidMap": mapping,
        "command": command or [],
        "error": error or "",
    }


def package_process_name(text):
    candidate = str(text or "").strip()
    if not candidate:
        return ""
    match = re.search(r"\b([A-Za-z][\w$]*(?:\.[\w$]+)+(?::[\w.$-]+)?)\b", candidate)
    return match.group(1) if match else ""


def package_name_from_process(process_name):
    value = package_process_name(process_name)
    if not value:
        return ""
    return value.split(":", 1)[0]


def parse_ps_process_lines(output):
    lines = [line.rstrip() for line in str(output or "").splitlines() if line.strip()]
    if not lines:
        return []
    header_tokens = re.split(r"\s+", lines[0].strip())
    header_upper = [token.upper() for token in header_tokens]
    pid_index = header_upper.index("PID") if "PID" in header_upper else -1
    name_index = -1
    for key in ("NAME", "CMDLINE", "ARGS", "COMMAND", "CMD", "PROCESS"):
        if key in header_upper:
            name_index = header_upper.index(key)
            break
    start_index = 1 if pid_index >= 0 else 0
    processes = []
    for line in lines[start_index:]:
        columns = re.split(r"\s+", line.strip())
        if not columns:
            continue
        if pid_index >= 0 and pid_index < len(columns):
            pid = columns[pid_index]
        else:
            pid = next((column for column in columns if column.isdigit()), "")
        if not pid.isdigit():
            continue
        if name_index >= 0 and name_index < len(columns):
            column_name = header_tokens[name_index].upper()
            process_name = " ".join(columns[name_index:]) if column_name in {"CMDLINE", "ARGS", "COMMAND", "CMD"} else columns[name_index]
        else:
            process_name = columns[-1]
        candidate = package_process_name(process_name) or package_process_name(line)
        processes.append({
            "pid": pid,
            "processName": candidate or str(process_name or "").strip(),
            "packageName": package_name_from_process(candidate),
            "raw": line,
        })
    return processes


def load_process_package_cache(serial):
    with PROCESS_PACKAGE_CACHE_LOCK:
        entry = PROCESS_PACKAGE_CACHE.get(serial)
        if not isinstance(entry, dict):
            return empty_process_package_cache(serial=serial, source="miss")
        updated_at = int(entry.get("updatedAtTs") or 0)
        stale = not updated_at or (cache_timestamp() - updated_at) > PROCESS_PACKAGE_CACHE_TTL_SECONDS
        return empty_process_package_cache(
            serial=serial,
            source=entry.get("source") or "cache",
            hit=True,
            stale=stale,
            updated_at=updated_at,
            pid_map=entry.get("pidMap") or {},
            command=entry.get("command") or [],
            error=entry.get("error") or "",
        )


def refresh_process_package_cache(serial, force=False, timeout=12):
    cached = load_process_package_cache(serial)
    if cached.get("hit") and not cached.get("stale") and not force:
        return cached

    commands = [
        "ps -A -o PID,NAME,ARGS",
        "ps -A -o PID,NAME,CMDLINE",
        "ps -A",
        "ps",
    ]
    last_result = None
    processes = []
    for command in commands:
        result = adb_shell_result(serial, command, timeout=timeout)
        last_result = result
        parsed = parse_ps_process_lines(result.get("stdout", ""))
        if result.get("ok") and parsed:
            processes = parsed
            break
    pid_map = {}
    for process in processes:
        pid_map[process["pid"]] = {
            "pid": process["pid"],
            "packageName": process.get("packageName") or "",
            "processName": process.get("processName") or "",
        }
    now = cache_timestamp()
    entry = {
        "serial": serial,
        "source": "fresh" if processes else "fallback",
        "updatedAtTs": now,
        "pidMap": pid_map,
        "command": (last_result or {}).get("command") or [],
        "error": "" if processes else trim_text((last_result or {}).get("stderr", ""), 400),
    }
    with PROCESS_PACKAGE_CACHE_LOCK:
        PROCESS_PACKAGE_CACHE[serial] = entry
    return empty_process_package_cache(
        serial=serial,
        source=entry["source"],
        hit=bool(processes),
        stale=False,
        updated_at=now,
        pid_map=pid_map,
        command=entry["command"],
        error=entry["error"],
    )


def process_package_cache_response(serials, force=False):
    items = {}
    for serial in [str(item or "").strip() for item in (serials or []) if str(item or "").strip()]:
        items[serial] = refresh_process_package_cache(serial, force=force)
    return {"ok": True, "serials": items}




def make_app_list_progress_saver(serial, include_system, app_list):
    def save_progress(_app=None):
        try:
            save_cached_app_list(serial, include_system, app_list)
        except Exception:
            pass
    return save_progress

def quick_device_apps(serial, include_system):
    pm_result = adb_shell_result(serial, "pm list packages -f", timeout=15)
    apps = parse_pm_package_lines(pm_result["stdout"])
    app_list = list(apps.values())
    if not include_system:
        app_list = [app for app in app_list if not app.get("system")]
    app_list.sort(key=lambda item: (item.get("system", False), item.get("packageName", "")))
    return {
        "ok": pm_result["ok"],
        "serial": serial,
        "apps": app_list,
        "count": len(app_list),
        "labelStatus": {"resolved": 0, "failed": 0, "skipped": len(app_list), "cached": 0},
        "permissionStatus": {"updated": 0, "failed": 0, "skipped": len(app_list), "cached": 0},
        "cache": empty_app_cache_status(source="quick", hit=False, scope="all" if include_system else "user"),
        "results": [compact_result(pm_result)],
        "stderr": pm_result.get("stderr", ""),
    }


def device_apps(payload):
    serial = require_serial(payload)
    include_system = bool(payload.get("includeSystem", True))
    force_refresh = bool(payload.get("forceRefresh") or payload.get("refreshCache") or payload.get("deepRefresh"))
    refresh_mode = str(payload.get("refreshMode") or "full").lower()
    skip_permissions = bool(payload.get("skipPermissions"))

    if refresh_mode == "single":
        target_package = str(payload.get("targetPackage") or payload.get("packageName") or "").strip()
        if not target_package:
            return {
                "ok": False,
                "serial": serial,
                "apps": [],
                "count": 0,
                "labelStatus": {"resolved": 0, "failed": 0, "skipped": 0, "cached": 0},
                "permissionStatus": {"updated": 0, "failed": 0, "skipped": 0, "cached": 0},
                "cache": empty_app_cache_status(source="miss", scope="all" if include_system else "user"),
                "results": [],
                "stderr": "单个刷新缺少 targetPackage",
            }

        cached_apps, cache_status = load_cached_app_list(serial, include_system)
        if not cached_apps:
            result = quick_device_apps(serial, include_system)
            cached_apps = result.get("apps", [])
            cache_status = result.get("cache", {})

        target = next((app for app in cached_apps if app.get("packageName") == target_package), None)
        if not target:
            result = quick_device_apps(serial, include_system)
            target = next((app for app in result.get("apps", []) if app.get("packageName") == target_package), None)
            if target:
                cached_apps.append(target)

        if not target:
            return {
                "ok": False,
                "serial": serial,
                "apps": cached_apps,
                "count": len(cached_apps),
                "targetPackage": target_package,
                "labelStatus": {"resolved": 0, "failed": 1, "skipped": 0, "cached": len(cached_apps)},
                "permissionStatus": {"updated": 0, "failed": 0, "skipped": 0, "cached": len(cached_apps)},
                "cache": cache_status,
                "results": [],
                "stderr": f"未找到 App：{target_package}",
            }

        target["labelSource"] = "pending"
        target["refreshToken"] = True
        label_status = resolve_app_labels(
            serial,
            [target],
            timeout=int(payload.get("labelTimeout") or 90),
            refresh_mode="single",
            progress_callback=make_app_list_progress_saver(serial, include_system, cached_apps),
        )
        target.pop("refreshToken", None)

        for app in cached_apps:
            if app.get("packageName") == target_package:
                app.update(target)
                app.pop("refreshToken", None)
            else:
                app.pop("refreshToken", None)
        cached_apps.sort(key=lambda item: (item.get("system", False), item.get("packageName", "")))
        cache_status = save_cached_app_list(serial, include_system, cached_apps)
        return {
            "ok": label_status.get("resolved", 0) > 0 and label_status.get("failed", 0) == 0,
            "serial": serial,
            "targetPackage": target_package,
            "apps": cached_apps,
            "count": len(cached_apps),
            "labelStatus": label_status,
            "permissionStatus": {"updated": 0, "failed": 0, "skipped": len(cached_apps), "cached": len(cached_apps)},
            "cache": cache_status,
            "results": [],
            "stderr": target.get("labelError") or "",
        }

    if refresh_mode == "light":
        pm_result = adb_shell_result(serial, "pm list packages -f", timeout=25)
        apps = parse_pm_package_lines(pm_result["stdout"])
        dump_result = adb_shell_result(serial, "dumpsys package packages", timeout=int(payload.get("timeout") or 45))
        if dump_result["ok"] and dump_result["stdout"]:
            for package_name, detail in parse_dumpsys_package_sections(dump_result["stdout"]).items():
                existing = apps.setdefault(package_name, {"packageName": package_name, "appName": package_name})
                apk_path = existing.get("apkPath") or detail.get("apkPath") or ""
                existing.update(detail)
                if apk_path:
                    existing["apkPath"] = apk_path
        app_list = list(apps.values())
        if not include_system:
            app_list = [app for app in app_list if not app.get("system")]
        permission_status = (
            {"updated": 0, "failed": 0, "skipped": len(app_list), "cached": 0}
            if skip_permissions else enrich_app_permissions(serial, app_list, timeout=int(payload.get("permissionTimeout") or 30))
        )
        app_list.sort(key=lambda item: (bool(item.get("system")), item.get("packageName", "")))
        cache_status = save_cached_app_list(serial, include_system, app_list)
        label_status = resolve_app_labels(
            serial,
            app_list,
            timeout=int(payload.get("labelTimeout") or 90),
            refresh_mode="light",
            progress_callback=make_app_list_progress_saver(serial, include_system, app_list),
        )
        app_list.sort(key=lambda item: (bool(item.get("system")), item.get("packageName", "")))
        cache_status = save_cached_app_list(serial, include_system, app_list)
        return {
            "ok": pm_result["ok"] or dump_result["ok"],
            "serial": serial,
            "apps": app_list,
            "count": len(app_list),
            "labelStatus": label_status,
            "permissionStatus": permission_status,
            "cache": cache_status,
            "results": [compact_result(pm_result), compact_result(dump_result, 1200)],
            "stderr": "\n".join(item.get("stderr", "").strip() for item in (pm_result, dump_result) if item.get("stderr")).strip(),
        }

    if not force_refresh:
        cached_apps, cache_status = load_cached_app_list(serial, include_system)
        if cached_apps:
            cached_apps.sort(key=lambda item: (item.get("system", False), item.get("packageName", "")))
            return {
                "ok": True,
                "serial": serial,
                "apps": cached_apps,
                "count": len(cached_apps),
                "labelStatus": {"resolved": 0, "failed": 0, "skipped": 0, "cached": len(cached_apps)},
                "permissionStatus": {"updated": 0, "failed": 0, "skipped": 0, "cached": len(cached_apps)},
                "cache": cache_status,
                "results": [],
                "stderr": "",
            }
        return quick_device_apps(serial, include_system)
    resolve_labels = payload.get("resolveLabels") is not False
    pm_result = adb_shell_result(serial, "pm list packages -f", timeout=25)
    apps = parse_pm_package_lines(pm_result["stdout"])
    dump_result = adb_shell_result(serial, "dumpsys package packages", timeout=int(payload.get("timeout") or 45))
    if dump_result["ok"] and dump_result["stdout"]:
        for package_name, detail in parse_dumpsys_package_sections(dump_result["stdout"]).items():
            existing = apps.setdefault(package_name, {"packageName": package_name, "appName": package_name})
            apk_path = existing.get("apkPath") or detail.get("apkPath") or ""
            existing.update(detail)
            if apk_path:
                existing["apkPath"] = apk_path
    app_list = list(apps.values())
    if not include_system:
        app_list = [app for app in app_list if not app.get("system")]
    permission_status = (
        {"updated": 0, "failed": 0, "skipped": len(app_list), "cached": 0}
        if skip_permissions else enrich_app_permissions(serial, app_list, timeout=int(payload.get("permissionTimeout") or 30))
    )
    app_list.sort(key=lambda item: (bool(item.get("system")), item.get("packageName", "")))
    cache_status = save_cached_app_list(serial, include_system, app_list)
    label_status = resolve_app_labels(
        serial,
        app_list,
        timeout=int(payload.get("labelTimeout") or 90),
        refresh_mode="full",
        progress_callback=make_app_list_progress_saver(serial, include_system, app_list),
    ) if resolve_labels and app_list else {}
    app_list.sort(key=lambda item: (bool(item.get("system")), item.get("packageName", "")))
    cache_status = save_cached_app_list(serial, include_system, app_list)
    return {
        "ok": pm_result["ok"] or dump_result["ok"],
        "serial": serial,
        "apps": app_list,
        "count": len(app_list),
        "labelStatus": label_status,
        "permissionStatus": permission_status,
        "cache": cache_status,
        "results": [compact_result(pm_result), compact_result(dump_result, 1200)],
        "stderr": "\n".join(item.get("stderr", "").strip() for item in (pm_result, dump_result) if item.get("stderr")).strip(),
    }


def enrich_app_permissions(serial, apps, timeout=30):
    deadline = time.time() + max(5, int(timeout or 30))
    updated = 0
    failed = 0
    skipped = 0
    for app in sorted(apps, key=lambda item: (bool(item.get("system")), item.get("packageName", ""))):
        if app.get("declaredPermissions"):
            continue
        if time.time() > deadline:
            skipped += 1
            continue
        package_name = str(app.get("packageName") or "").strip()
        if not package_name:
            continue
        profile = package_permission_profile(serial, package_name, timeout=8)
        detail = profile.get("detail") or {}
        if not profile.get("ok") or not detail:
            failed += 1
            continue
        for key in (
            "declaredPermissions",
            "installPermissions",
            "runtimePermissions",
            "deniedRuntimePermissions",
            "grantablePermissions",
            "grantedPermissions",
            "permissionStates",
        ):
            if detail.get(key):
                app[key] = detail[key]
        updated += 1
    return {"updated": updated, "failed": failed, "skipped": skipped}


def package_permission_profile(serial, package_name, timeout=45):
    result = adb_shell_result(serial, f"dumpsys package {shlex.quote(package_name)}", timeout=timeout or 45)
    detail = {}
    if result["ok"] and result["stdout"]:
        parsed = parse_dumpsys_package_sections(result["stdout"])
        detail = parsed.get(package_name)
        if not detail:
            detail = parse_package_permissions(result["stdout"])
    return {
        "ok": result["ok"],
        "packageName": package_name,
        "detail": detail or {},
        "result": result,
    }


def permissions_from_step(step, serial, package_name, timeout):
    mode = str(step.get("permissionMode") or "settings_page").strip()
    if mode == "custom":
        raw = str(step.get("permissions") or "")
        return [item for item in [normalize_permission_name(value) for value in re.split(r"[\s,;]+", raw)] if item]
    if mode in {"settings_page", "declared_dangerous"}:
        data = package_permission_profile(serial, package_name, timeout or 45)
        detail = data.get("detail") or {}
        if mode == "settings_page":
            grantable = detail.get("grantablePermissions") or []
            if grantable:
                return list(grantable)
        declared = detail.get("declaredPermissions") or []
        return [permission for permission in declared if permission in DANGEROUS_PERMISSION_SET]
    return list(COMMON_DANGEROUS_PERMISSIONS)


def adb_error_summary(result):
    text = "\n".join([str(result.get("stderr") or ""), str(result.get("stdout") or "")]).strip()
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return "无详细错误"
    # 第一行经常只有 Exception occurred...，真正原因在后面的 java.lang.* 行。
    for line in lines:
        if "java.lang." in line or "SecurityException" in line or "IllegalArgumentException" in line:
            return line
    return lines[-1] if len(lines) > 1 and lines[0].startswith("Exception occurred") else lines[0]


def permission_state_map(detail):
    states = {}
    for item in detail.get("permissionStates") or []:
        permission = item.get("permission")
        if permission:
            states[permission] = item
    return states


def permission_is_granted(detail, permission):
    state = permission_state_map(detail).get(permission) or {}
    return bool(state.get("granted")) or permission in set(detail.get("grantedPermissions") or [])


def permission_flags(detail, permission):
    state = permission_state_map(detail).get(permission) or {}
    return str(state.get("flags") or "")


def permission_skip_reason(detail, permission):
    declared = set(detail.get("declaredPermissions") or [])
    runtime = set(detail.get("runtimePermissions") or [])
    if permission in SPECIAL_PERMISSIONS:
        return "" if permission in declared else "应用未声明该特殊权限"
    if permission not in declared and permission not in runtime:
        return "应用未声明该权限"
    if permission not in runtime:
        return "不是运行时权限，pm grant 无法授权"
    flags = permission_flags(detail, permission)
    blocked_keywords = ["SYSTEM_FIXED", "POLICY_FIXED", "RESTRICTION_REVOKED"]
    for keyword in blocked_keywords:
        if keyword in flags:
            return f"系统标记 {keyword}，只能手动或由设备策略处理"
    return ""


def grant_special_permission(serial, package_name, permission, timeout):
    kind, op = SPECIAL_PERMISSIONS[permission]
    if kind == "appops":
        return run_process([*adb_prefix(serial), "shell", "appops", "set", package_name, op, "allow"], timeout=timeout or 20)
    return run_process([*adb_prefix(serial), "shell", "cmd", "deviceidle", "whitelist", f"+{package_name}"], timeout=timeout or 20)


def grant_runtime_permission(serial, package_name, permission, timeout):
    attempts = []
    first = run_process([*adb_prefix(serial), "shell", "pm", "grant", package_name, permission], timeout=timeout or 20)
    attempts.append(first)
    if first.get("ok"):
        return first, attempts, "pm grant"
    # 一些系统上 cmd package grant 的错误信息更完整，也可能比 pm 包装器更稳定。
    second = run_process([*adb_prefix(serial), "shell", "cmd", "package", "grant", package_name, permission], timeout=timeout or 20)
    attempts.append(second)
    if second.get("ok"):
        return second, attempts, "cmd package grant"
    op = PERMISSION_APP_OPS.get(permission)
    if op:
        third = run_process([*adb_prefix(serial), "shell", "appops", "set", package_name, op, "allow"], timeout=timeout or 20)
        attempts.append(third)
        if third.get("ok"):
            return third, attempts, "appops fallback"
    return attempts[-1], attempts, "failed"


def execute_permission_grant(step, serial, timeout):
    if not serial:
        raise ValueError("权限授权需要选择设备")
    package_name = str(step.get("packageName") or "").strip()
    if not package_name:
        raise ValueError("应用包名不能为空")

    before_profile = package_permission_profile(serial, package_name, timeout or 45)
    detail = before_profile.get("detail") or {}
    requested_permissions = permissions_from_step(step, serial, package_name, timeout)
    if not requested_permissions:
        raise ValueError("没有可授权的权限")

    # 去重并保持 UI 顺序，避免重复执行同一个权限。
    permissions = []
    seen = set()
    for permission in requested_permissions:
        permission = normalize_permission_name(permission)
        if permission and permission not in seen:
            permissions.append(permission)
            seen.add(permission)

    continue_on_error = bool(step.get("continueOnPermissionError", True))
    verify_after = step.get("verifyAfterGrant") is not False
    results = []
    if before_profile.get("result"):
        results.append(before_profile["result"])
    lines = []
    success_count = 0
    failed_count = 0
    skipped_count = 0

    for permission in permissions:
        if permission_is_granted(detail, permission):
            skipped_count += 1
            lines.append(f"[SKIP] {permission} 已授权")
            continue

        reason = permission_skip_reason(detail, permission)
        if reason:
            skipped_count += 1
            lines.append(f"[SKIP] {permission} 跳过：{reason}")
            continue

        if permission in SPECIAL_PERMISSIONS:
            result = grant_special_permission(serial, package_name, permission, timeout)
            results.append(result)
            if result.get("ok"):
                success_count += 1
                lines.append(f"[OK] {permission} 已通过特殊授权方式处理")
            else:
                failed_count += 1
                lines.append(f"[WARN] {permission} 需要手动确认或当前系统不支持：{adb_error_summary(result)}")
        else:
            result, attempts, method = grant_runtime_permission(serial, package_name, permission, timeout)
            results.extend(attempts)
            if result.get("ok"):
                success_count += 1
                lines.append(f"[OK] {permission} 已授权（{method}）")
            else:
                failed_count += 1
                lines.append(f"[FAIL] {permission} 授权失败：{adb_error_summary(result)}")

        if failed_count and not continue_on_error:
            break

    if verify_after:
        profile = package_permission_profile(serial, package_name, timeout or 45)
        if profile.get("result"):
            results.append(profile["result"])
        if profile.get("ok"):
            after_detail = profile.get("detail") or {}
            denied = []
            for permission in permissions:
                if permission in SPECIAL_PERMISSIONS:
                    continue
                if permission in set(after_detail.get("runtimePermissions") or []) and not permission_is_granted(after_detail, permission):
                    denied.append(permission)
            if denied:
                lines.append("[WARN] 权限页仍未授权：" + ", ".join(denied))
            runtime_targets = [permission for permission in permissions if permission in set(after_detail.get("runtimePermissions") or [])]
            granted_targets = [permission for permission in runtime_targets if permission_is_granted(after_detail, permission)]
            if runtime_targets:
                lines.append(f"[INFO] 复查结果：运行时权限已授权 {len(granted_targets)}/{len(runtime_targets)} 项")

    ok = failed_count == 0 or continue_on_error
    combined = combine_results(results, ["permission-grant"])
    combined["ok"] = ok
    combined["code"] = 0 if ok else combined.get("code")
    summary = f"[SUMMARY] 成功 {success_count}，跳过 {skipped_count}，失败/需手动 {failed_count}"
    combined["stdout"] = "\n".join([summary, *lines]).strip() + "\n"
    combined["stderr"] = "" if ok else "\n".join(line for line in lines if "[FAIL]" in line or "[WARN]" in line) + "\n"
    combined["commandText"] = command_text_from_results(results)
    return combined

def preview_permission_grant(step, serial):
    package_name = str(step.get("packageName") or "").strip() or "<package>"
    mode = str(step.get("permissionMode") or "settings_page")
    if mode == "custom":
        permissions = [item for item in [normalize_permission_name(value) for value in re.split(r"[\s,;]+", str(step.get("permissions") or ""))] if item] or ["<permission>"]
    elif mode == "settings_page":
        permissions = ["<设置里 App 权限页可见的运行时权限>"]
    elif mode == "declared_dangerous":
        permissions = ["<App 声明的可授权危险权限>"]
    else:
        permissions = COMMON_DANGEROUS_PERMISSIONS
    lines = []
    for permission in permissions:
        if permission in SPECIAL_PERMISSIONS:
            lines.append(command_text([*adb_prefix(serial), "shell", "appops/cmd", package_name, permission]))
        else:
            lines.append(command_text([*adb_prefix(serial), "shell", "pm", "grant", package_name, permission]))
    return {
        "command": ["permission-grant"],
        "commandText": "\n".join(lines),
        "warnings": ["默认会读取 dumpsys package 的 runtime permissions，目标是让系统设置 App 权限页里的可见权限尽量全部变成已授权。特殊权限会尝试 appops/cmd deviceidle；失败时需要到系统设置手动确认。"],
    }


def default_screenshot_dir():
    return configured_dir(settings().get("quickOutputDir"), default_quick_output_dir_path())


def device_screenshot(payload):
    serial = require_serial(payload)
    target_dir = preview_screenshot_dir(serial)
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"screenshot_{safe_serial_dir(serial)}_{time.strftime('%Y%m%d-%H%M%S')}.png"
    path = target_dir / filename
    result = capture_screenshot_png(serial, path, timeout=30)
    image_data = ""
    if result["ok"]:
        image_data = "data:image/png;base64," + base64.b64encode(Path(path).read_bytes()).decode("ascii")
    return {
        "ok": result["ok"],
        "serial": serial,
        "path": str(path) if result["ok"] else "",
        "imageData": image_data,
        "result": result,
        "stderr": result["stderr"],
    }



def device_dump_analyze(payload):
    serial = require_serial(payload)
    timeout = int(payload.get("timeout") or 30)
    stamp = time.strftime("%Y%m%d-%H%M%S") + f"-{int(time.time() * 1000) % 1000:03d}"
    target_dir = local_capture_dir("dump", serial)
    screenshot_path = target_dir / f"dump-screen-{stamp}.png"
    xml_path = target_dir / f"dump-window-{stamp}.xml"
    screenshot = capture_screenshot_png(serial, screenshot_path, timeout=timeout)
    xml_text, dump_results, dump_error = dump_uiautomator_xml(serial, timeout)
    if xml_text:
        xml_path.write_text(xml_text, encoding="utf-8")
    image_data = ""
    if screenshot["ok"]:
        image_data = "data:image/png;base64," + base64.b64encode(screenshot_path.read_bytes()).decode("ascii")
    screenshot_result = {**screenshot, "stdout": f"Saved to {screenshot_path}\n" if screenshot.get("ok") else ""}
    return {
        "ok": screenshot["ok"] and not dump_error and bool(xml_text),
        "serial": serial,
        "imageData": image_data,
        "xml": xml_text or "",
        "screenshotPath": str(screenshot_path) if screenshot.get("ok") else "",
        "xmlPath": str(xml_path) if xml_text else "",
        "error": dump_error or ("截图失败" if not screenshot["ok"] else ""),
        "results": [screenshot_result, *dump_results],
    }

def device_shell(payload):
    serial = require_serial(payload)
    command = str(payload.get("command") or "").strip()
    if not command:
        raise ValueError("Shell 命令不能为空")
    result = adb_shell_result(serial, command, timeout=int(payload.get("timeout") or 30))
    return {
        "ok": result["ok"],
        "serial": serial,
        "command": command,
        "result": result,
    }


def device_clipboard(payload):
    serial = require_serial(payload)
    operation = str(payload.get("operation") or "read").strip().lower()
    timeout = int(payload.get("timeout") or 30)
    manage_ime = payload.get("manageIme")
    manage_ime = True if manage_ime is None else bool(manage_ime)
    if operation == "read":
        result = agent_server_clipboard(serial, "read", timeout=timeout) if not manage_ime and configured_agent_server_jar_path() else read_agent_clipboard(serial, timeout=timeout, manage_ime=manage_ime)
        text = result.get("clipboardText") or ""
        return {
            "ok": result.get("ok"),
            "serial": serial,
            "operation": operation,
            "transport": result.get("transport") or "content_provider",
            "text": text,
            "length": len(text),
            "result": result,
            "stderr": result.get("stderr", ""),
            "stdout": result.get("stdout", ""),
        }
    if operation == "write":
        text = str(payload.get("text") or "")
        result = agent_server_clipboard(serial, "write", text=text, timeout=timeout) if not manage_ime and configured_agent_server_jar_path() else set_agent_clipboard(serial, text, timeout=timeout, manage_ime=manage_ime)
        return {
            "ok": result.get("ok"),
            "serial": serial,
            "operation": operation,
            "transport": result.get("transport") or "content_provider",
            "text": text if result.get("ok") else "",
            "length": len(text),
            "result": result,
            "stderr": result.get("stderr", ""),
            "stdout": result.get("stdout", ""),
        }
    raise ValueError(f"未知剪切板操作: {operation}")


def preview_run(payload):
    selected = payload.get("devices") or []
    steps = active_steps(payload.get("steps") or [])
    contexts = device_contexts()
    preview = {"ok": True, "items": [], "warnings": []}
    if not steps:
        preview["warnings"].append("没有启用的动作")
    for index, step in enumerate(steps):
        scope = step_scope(step)
        targets = selected if scope == "per_device" else [None]
        if not targets:
            preview["ok"] = False
            preview["items"].append({
                "index": index,
                "name": step.get("name") or step.get("kind"),
                "target": "",
                "ok": False,
                "error": "没有选择设备",
                "command": [],
            })
            continue
        for serial in targets:
            expanded = expand_step(step, serial, contexts)
            try:
                preview_value = preview_command(expanded, serial)
                item = {
                    "index": index,
                    "name": expanded.get("name") or expanded.get("kind"),
                    "target": serial or "本机",
                    "ok": True,
                    "command": [],
                }
                if isinstance(preview_value, dict):
                    item.update(preview_value)
                else:
                    item["command"] = preview_value
                preview["items"].append(item)
            except Exception as exc:
                preview["ok"] = False
                preview["items"].append({
                    "index": index,
                    "name": expanded.get("name") or expanded.get("kind"),
                    "target": serial or "本机",
                    "ok": False,
                    "error": str(exc),
                    "command": [],
                })
    return preview


def execute_step(step, serial=None):
    kind = step.get("kind")
    timeout = int(step.get("timeout") or 0) or None
    cwd = str(step.get("cwd") or "").strip() or None

    if kind == "install_apk":
        return execute_install_apk(step, serial, timeout)

    if kind == "pull_file":
        remote_path = str(step.get("remotePath", "")).strip()
        if not serial:
            raise ValueError("提取文件需要选择设备")
        if not remote_path:
            raise ValueError("手机路径不能为空")
        target_path = pull_target_path(step, serial)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        result = run_process([*adb_prefix(serial), "pull", remote_path, str(target_path)], timeout=timeout)
        if result["ok"]:
            result["stdout"] = f"{result.get('stdout', '')}Saved to {target_path}\n"
        return result

    if kind == "push_file":
        local_path = str(step.get("localPath", "")).strip()
        remote_path = str(step.get("remotePath", "")).strip()
        if not serial:
            raise ValueError("保存到手机需要选择设备")
        if not local_path:
            raise ValueError("电脑文件或目录不能为空")
        if not remote_path:
            raise ValueError("手机保存路径不能为空")
        source = Path(local_path).expanduser()
        if not source.exists():
            raise ValueError(f"电脑文件或目录不存在: {source}")
        return run_process([*adb_prefix(serial), "push", str(source), remote_path], timeout=timeout)

    if kind == "screenshot":
        if not serial:
            raise ValueError("截图需要选择设备")
        path = output_path(step.get("destDir", ""), step.get("filename", ""), f"screenshot_{serial}_{int(time.time())}.png")
        return capture_screenshot_png(serial, path, timeout=timeout or 30)

    if kind == "screen_record":
        if not serial:
            raise ValueError("录屏需要选择设备")
        return execute_screen_record(step, serial, timeout)

    if kind == "tap_text":
        return execute_tap_text(step, serial, timeout)

    if kind == "app_action":
        package_name = str(step.get("packageName", "")).strip()
        activity = str(step.get("activity", "")).strip()
        operation = str(step.get("operation", "force_stop")).strip()
        if not serial:
            raise ValueError("应用操作需要选择设备")
        if operation != "start_activity" and not package_name:
            raise ValueError("应用包名不能为空")
        if operation == "force_stop":
            return run_process([*adb_prefix(serial), "shell", "am", "force-stop", package_name], timeout=timeout)
        if operation == "clear_data":
            return run_process([*adb_prefix(serial), "shell", "pm", "clear", package_name], timeout=timeout)
        if operation == "uninstall":
            return run_process([*adb_prefix(serial), "uninstall", package_name], timeout=timeout)
        if operation == "start_app":
            return run_process([*adb_prefix(serial), "shell", "monkey", "-p", package_name, "-c", "android.intent.category.LAUNCHER", "1"], timeout=timeout)
        if operation == "start_activity":
            if not activity:
                raise ValueError("Activity 不能为空")
            return run_process([*adb_prefix(serial), "shell", "am", "start", "-n", activity], timeout=timeout)
        raise ValueError(f"未知应用操作: {operation}")

    if kind == "permission_grant":
        return execute_permission_grant(step, serial, timeout)

    if kind == "adb_shell":
        command = str(step.get("command", "")).strip()
        if not serial:
            raise ValueError("ADB Shell 需要选择设备")
        if not command:
            raise ValueError("Shell 命令不能为空")
        return run_process([*adb_prefix(serial), "shell", command], timeout=timeout)

    if kind == "adb_raw":
        command = str(step.get("command", "")).strip()
        if not serial:
            raise ValueError("ADB 命令不能为空")
        if not command:
            raise ValueError("ADB 参数不能为空")
        return run_process([*adb_prefix(serial), *split_args(command)], timeout=timeout)

    if kind == "adb_script":
        if not serial:
            raise ValueError("ADB 脚本需要选择设备")
        return execute_adb_script(step, serial, timeout, cwd=cwd)

    if kind == "input_text":
        if not serial:
            raise ValueError("输入文本需要选择设备")
        input_mode = str(step.get("inputMode") or "auto").strip()
        if input_mode == "adb_input":
            return run_adb_input_text(serial, step.get("text", ""), timeout=timeout)
        return input_text_via_clipboard(serial, step.get("text", ""), timeout=timeout)

    if kind == "set_clipboard":
        if not serial:
            raise ValueError("复制到手机剪切板需要选择设备")
        result = set_device_clipboard(serial, step.get("text", ""), timeout=timeout)
        result["commandText"] = result.get("commandText") or command_text(result.get("command", [])) + "  < 剪切板文本"
        return result

    if kind == "agent_clipboard":
        if not serial:
            raise ValueError("CQClaw Agent 剪切板需要选择设备")
        return execute_agent_clipboard(step, serial, timeout=timeout)

    if kind == "keyevent":
        key = str(step.get("key", "")).strip()
        if not serial:
            raise ValueError("按键事件需要选择设备")
        if not key:
            raise ValueError("KeyCode 不能为空")
        return run_process([*adb_prefix(serial), "shell", "input", "keyevent", key], timeout=timeout)

    if kind == "script":
        return run_process(script_command(step), cwd=cwd, timeout=timeout)

    if kind == "inline_script":
        command, script_path = inline_script_command(step)
        try:
            return run_process(command, cwd=cwd, timeout=timeout)
        finally:
            try:
                script_path.unlink()
            except FileNotFoundError:
                pass

    raise ValueError(f"未知动作类型: {kind}")


def append_run_log(run):
    with LOGS_FILE.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(run, ensure_ascii=False) + "\n")


def recent_runs(limit=40):
    if not LOGS_FILE.exists():
        return []
    lines = LOGS_FILE.read_text(encoding="utf-8").splitlines()[-limit:]
    runs = []
    for line in lines:
        try:
            runs.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return runs[::-1]


def json_safe(value):
    """Return a JSON-serializable copy of nested API response data.

    Some ADB helpers return raw bytes, especially screenshot stdout from
    `exec-out screencap -p`. Those bytes must not be passed directly to
    json.dumps; callers should expose screenshots as base64 data URLs and
    keep command results text-only.
    """
    if isinstance(value, bytes):
        return f"<binary {len(value)} bytes>"
    if isinstance(value, bytearray):
        return f"<binary {len(value)} bytes>"
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    return value


class ApiHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def send_json(self, value, status=200):
        body = json.dumps(json_safe(value), ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/dump":
            self.send_response(302)
            self.send_header("Location", "/dump.html")
            self.end_headers()
            return
        if parsed.path == "/api/devices":
            query = urllib.parse.parse_qs(parsed.query)
            result = run_process([adb_bin(), "devices", "-l"], timeout=10)
            devices = parse_devices(result["stdout"])
            include_process_packages = (query.get("includeProcessPackages") or ["false"])[0].lower() in {"1", "true", "yes"}
            refresh_process_packages = (query.get("refreshProcessPackages") or ["false"])[0].lower() in {"1", "true", "yes"}
            response = {"ok": result["ok"], "devices": devices, "result": result}
            if include_process_packages:
                serials = [device.get("serial") for device in devices if device.get("serial") and device.get("state") == "device"]
                response["processPackages"] = process_package_cache_response(serials, force=refresh_process_packages).get("serials", {})
            self.send_json(response)
            return
        if parsed.path == "/api/profiles":
            self.send_json({"profiles": read_json(PROFILES_FILE, [])})
            return
        if parsed.path == "/api/settings":
            enterprise = enterprise_config()
            current_settings = settings()
            current_settings["enterpriseSourcePath"] = enterprise_source_from_pointer_file()
            self.send_json({
                "settings": current_settings,
                "enterprise": enterprise,
                "effectiveAgentApkPath": configured_agent_apk_path(),
                "effectiveAgentServerJarPath": configured_agent_server_jar_path(),
            })
            return
        if parsed.path == "/api/adb-snippets":
            self.send_json(adb_snippets_response())
            return
        if parsed.path == "/api/runs":
            query = urllib.parse.parse_qs(parsed.query)
            limit = int(query.get("limit", ["40"])[0])
            self.send_json({"runs": recent_runs(limit)})
            return
        if parsed.path == "/api/logcat/poll":
            query = urllib.parse.parse_qs(parsed.query)
            result = logcat_poll(query)
            self.send_json(result, 200 if result.get("ok") else 404)
            return
        if parsed.path == "/api/logcat/process-packages":
            query = urllib.parse.parse_qs(parsed.query)
            serials = list(query.get("serial") or [])
            serials.extend([item for item in str((query.get("serials") or [""])[0]).split(",") if item.strip()])
            force = (query.get("force") or ["false"])[0].lower() in {"1", "true", "yes"}
            self.send_json(process_package_cache_response(serials, force=force))
            return
        if parsed.path == "/api/storage/stats":
            self.send_json(storage_stats())
            return
        if parsed.path == "/api/device/app-icon":
            query = urllib.parse.parse_qs(parsed.query)
            payload = {
                "serial": (query.get("serial") or [""])[0],
                "packageName": (query.get("package") or query.get("packageName") or [""])[0],
                "includeSystem": (query.get("includeSystem") or ["true"])[0].lower() not in {"0", "false", "no"},
                "force": (query.get("force") or ["false"])[0].lower() in {"1", "true", "yes"},
            }
            result = resolve_app_icon(payload["serial"], payload["packageName"], payload["includeSystem"], payload["force"])
            if not result.get("ok"):
                self.send_json({"ok": False, "error": result.get("error") or "icon 解析失败"}, 404)
                return
            icon_path = Path(result["path"])
            try:
                body = icon_path.read_bytes()
            except FileNotFoundError:
                self.send_json({"ok": False, "error": "icon 缓存文件不存在"}, 404)
                return
            stat = icon_path.stat()
            etag = f'W/"{int(stat.st_mtime)}-{stat.st_size}"'
            if self.headers.get("If-None-Match") == etag:
                self.send_response(304)
                self.send_header("ETag", etag)
                self.send_header("Cache-Control", "private, max-age=604800")
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", result.get("mime") or icon_mime_type(icon_path))
            self.send_header("Cache-Control", "private, max-age=604800")
            self.send_header("ETag", etag)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/api/health":
            self.send_json({"ok": True, "platform": platform.platform(), "python": sys.version.split()[0]})
            return
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        try:
            payload = self.read_body()
            if parsed.path == "/api/profiles":
                profiles = payload.get("profiles", [])
                write_json(PROFILES_FILE, profiles)
                self.send_json({"ok": True, "profiles": profiles})
                return
            if parsed.path == "/api/settings":
                next_settings = settings()
                allowed = {"adbPath", "quickOutputDir", "localTempDir", "agentApkPath", "agentServerJarPath", "deviceAliases", "deviceGroups"}
                incoming_settings = payload.get("settings", {})
                next_settings.update({key: value for key, value in incoming_settings.items() if key in allowed})
                if "enterpriseSourcePath" in incoming_settings:
                    write_enterprise_source_pointer(incoming_settings.get("enterpriseSourcePath"))
                write_json(SETTINGS_FILE, next_settings)
                current_settings = settings()
                current_settings["enterpriseSourcePath"] = enterprise_source_from_pointer_file()
                self.send_json({
                    "ok": True,
                    "settings": current_settings,
                    "enterprise": enterprise_config(),
                    "effectiveAgentApkPath": configured_agent_apk_path(),
                    "effectiveAgentServerJarPath": configured_agent_server_jar_path(),
                })
                return
            if parsed.path == "/api/adb-snippets/open":
                self.send_json(open_adb_snippets_config())
                return
            if parsed.path == "/api/pick-path":
                self.send_json(pick_path(payload))
                return
            if parsed.path == "/api/remote-list":
                self.send_json(list_remote_path(payload))
                return
            if parsed.path == "/api/remote-open":
                self.send_json(open_remote_file(payload))
                return
            if parsed.path == "/api/device/top-activity":
                self.send_json(device_top_activity(payload))
                return
            if parsed.path == "/api/device/details":
                self.send_json(device_details(payload))
                return
            if parsed.path == "/api/device/apps":
                self.send_json(device_apps(payload))
                return
            if parsed.path == "/api/logcat/start":
                result = logcat_start(payload)
                self.send_json(result, 200 if result.get("ok") else 500)
                return
            if parsed.path == "/api/logcat/stop":
                result = stop_logcat_session(str(payload.get("sessionId") or ""))
                self.send_json(result, 200 if result.get("ok") else 404)
                return
            if parsed.path == "/api/logcat/clear":
                self.send_json(logcat_clear(payload))
                return
            if parsed.path == "/api/server/shutdown":
                if self.client_address and self.client_address[0] not in {"127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"}:
                    self.send_json({"ok": False, "error": "shutdown only accepts localhost requests"}, 403)
                    return
                self.send_json({"ok": True, "message": "server shutting down"})
                def stop_server():
                    self.server.shutdown()
                    self.server.server_close()

                threading.Thread(target=stop_server, daemon=True).start()
                return
            if parsed.path == "/api/storage/preview":
                self.send_json(storage_preview(payload))
                return
            if parsed.path == "/api/storage/open":
                result = storage_open(payload)
                self.send_json(result, 200 if result.get("ok") else 400)
                return
            if parsed.path == "/api/storage/clean":
                result = storage_clean(payload)
                self.send_json(result, 200 if result.get("ok") else 400)
                return
            if parsed.path == "/api/device/screenshot":
                self.send_json(device_screenshot(payload))
                return
            if parsed.path == "/api/device/dump-analyze":
                self.send_json(device_dump_analyze(payload))
                return
            if parsed.path == "/api/device/shell":
                self.send_json(device_shell(payload))
                return
            if parsed.path == "/api/device/clipboard":
                self.send_json(device_clipboard(payload))
                return
            if parsed.path == "/api/desktop/clipboard":
                self.send_json(desktop_clipboard(payload))
                return
            if parsed.path == "/api/device/clipboard-server":
                self.send_json(device_clipboard_server(payload))
                return
            if parsed.path == "/api/device/agent-status":
                serial = require_serial(payload)
                self.send_json(device_agent_install_state(serial))
                return
            if parsed.path == "/api/device/agent-install":
                serial = require_serial(payload)
                result = install_agent_apk(serial)
                self.send_json(result)
                return
            if parsed.path == "/api/inspect/refresh":
                self.send_json(inspect_refresh(payload))
                return
            if parsed.path == "/api/preview":
                self.send_json(preview_run(payload))
                return
            if parsed.path == "/api/run":
                run = self.handle_run(payload)
                append_run_log(run)
                self.send_json(run)
                return
            self.send_json({"ok": False, "error": "Not found"}, 404)
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, 500)

    def handle_run(self, payload):
        selected = payload.get("devices") or []
        steps = active_steps(payload.get("steps") or [])
        stop_on_error = bool(payload.get("stopOnError", True))
        contexts = device_contexts()
        run = {
            "id": str(int(time.time() * 1000)),
            "version": 2,
            "startedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "devices": selected,
            "sourceSteps": steps,
            "steps": [],
            "ok": True,
        }

        for index, step in enumerate(steps):
            scope = step_scope(step)
            targets = selected if scope == "per_device" else [None]
            if not targets:
                run["ok"] = False
                run["steps"].append({
                    "index": index,
                    "name": step.get("name") or step.get("kind"),
                    "ok": False,
                    "error": "没有选择设备",
                    "results": [],
                })
                if stop_on_error:
                    break
                continue

            step_log = {
                "index": index,
                "name": step.get("name") or step.get("kind"),
                "kind": step.get("kind"),
                "scope": scope,
                "ok": True,
                "results": [],
                "traceId": f"{run['id']}-step-{index + 1}",
            }
            for serial in targets:
                expanded_step = expand_step(step, serial, contexts)
                try:
                    result = execute_step(expanded_step, serial)
                except Exception as exc:
                    result = {"ok": False, "stderr": str(exc), "stdout": "", "code": None, "command": []}
                result["serial"] = serial
                result["runId"] = run["id"]
                result["traceId"] = f"{run['id']}-step-{index + 1}-{serial or 'local'}"
                step_log["results"].append(result)
                if not result["ok"]:
                    step_log["ok"] = False
                    run["ok"] = False
                    if stop_on_error and not expanded_step.get("continueOnError"):
                        break
            run["steps"].append(step_log)
            if stop_on_error and not step_log["ok"] and not step.get("continueOnError"):
                break

        run["finishedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
        return run


def main():
    parser = argparse.ArgumentParser(description="CQClaw")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    parser.add_argument("--no-open", action="store_true", help="启动服务后不要自动打开浏览器")
    parser.add_argument("--open-path", default="/log-insight.html", help="启动服务后自动打开的页面路径")
    args = parser.parse_args()
    ensure_data()
    server = ThreadingHTTPServer((args.host, args.port), ApiHandler)
    server.daemon_threads = True
    server.block_on_close = False
    display_host = "127.0.0.1" if args.host in {"0.0.0.0", "::"} else args.host
    open_path = "/" + str(args.open_path or "/log-insight.html").lstrip("/")
    base_url = f"http://{display_host}:{args.port}"
    open_url = urllib.parse.urljoin(base_url, open_path)
    print(f"CQClaw: {base_url}", flush=True)
    if not args.no_open:
        print(f"Opening browser: {open_url}", flush=True)
        threading.Timer(0.35, webbrowser.open, args=(open_url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
