import os
import platform
import re
import shutil
import struct
import subprocess
import uuid
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


IMAGE_SUFFIXES = {".png", ".webp", ".jpg", ".jpeg", ".gif"}
ANDROID_NS = "{http://schemas.android.com/apk/res/android}"


def first_regex_group(text, pattern):
    match = re.search(pattern, str(text or ""), re.M)
    return match.group(1).strip() if match else ""


def first_nonempty(value):
    for line in str(value or "").splitlines():
        cleaned = line.strip()
        if cleaned:
            return cleaned
    return ""


def decode_output(value):
    if isinstance(value, str):
        return value
    return (value or b"").decode("utf-8", errors="replace")


def hidden_subprocess_kwargs():
    """Hide aapt/aapt2 console windows on Windows."""
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


def bin_u16(data, offset):
    return struct.unpack_from("<H", data, offset)[0]


def bin_u32(data, offset):
    return struct.unpack_from("<I", data, offset)[0]


def read_android_length8(data, offset):
    first = data[offset]
    offset += 1
    if first & 0x80:
        value = ((first & 0x7F) << 8) | data[offset]
        offset += 1
        return value, offset
    return first, offset


def read_android_length16(data, offset):
    first = bin_u16(data, offset)
    offset += 2
    if first & 0x8000:
        second = bin_u16(data, offset)
        offset += 2
        return ((first & 0x7FFF) << 16) | second, offset
    return first, offset


def parse_android_string_pool(data, offset):
    if bin_u16(data, offset) != 0x0001:
        return [], 0
    header_size = bin_u16(data, offset + 2)
    chunk_size = bin_u32(data, offset + 4)
    string_count = bin_u32(data, offset + 8)
    flags = bin_u32(data, offset + 16)
    strings_start = bin_u32(data, offset + 20)
    offsets_start = offset + header_size
    strings_base = offset + strings_start
    is_utf8 = bool(flags & 0x00000100)
    values = []
    for index in range(string_count):
        try:
            item_offset = strings_base + bin_u32(data, offsets_start + index * 4)
            if is_utf8:
                _, item_offset = read_android_length8(data, item_offset)
                byte_len, item_offset = read_android_length8(data, item_offset)
                values.append(data[item_offset:item_offset + byte_len].decode("utf-8", errors="replace"))
            else:
                char_len, item_offset = read_android_length16(data, item_offset)
                values.append(data[item_offset:item_offset + char_len * 2].decode("utf-16le", errors="replace"))
        except (IndexError, struct.error, UnicodeDecodeError):
            values.append("")
    return values, chunk_size


def string_at(strings, index):
    if index == 0xFFFFFFFF or index < 0 or index >= len(strings):
        return ""
    return strings[index]


def parse_resource_ref(value):
    text = str(value or "").strip()
    if not text.startswith("@"):
        return None
    body = text[1:]
    if body.startswith("+"):
        body = body[1:]
    if body.startswith("0x"):
        try:
            return int(body, 16)
        except ValueError:
            return None
    if body.isdigit():
        return int(body, 10)
    return None


def xml_name(name):
    return str(name or "").split("}", 1)[-1]


def parse_text_xml_elements(data):
    try:
        root = ET.fromstring(data.decode("utf-8", errors="replace"))
    except ET.ParseError:
        return []
    elements = []
    for element in root.iter():
        attrs = {}
        for key, value in element.attrib.items():
            clean_key = xml_name(key)
            attrs[clean_key] = {"value": value, "raw": value, "type": "text", "data": parse_resource_ref(value)}
        elements.append({"name": xml_name(element.tag), "attrs": attrs})
    return elements


def parse_binary_xml_elements(data):
    if data.lstrip().startswith(b"<"):
        return parse_text_xml_elements(data)
    elements = []
    strings = []
    try:
        offset = bin_u16(data, 2) if bin_u16(data, 0) == 0x0003 else 0
    except struct.error:
        return elements
    while offset + 8 <= len(data):
        try:
            chunk_type = bin_u16(data, offset)
            chunk_size = bin_u32(data, offset + 4)
        except struct.error:
            break
        if chunk_size <= 0:
            break
        if chunk_type == 0x0001:
            strings, _ = parse_android_string_pool(data, offset)
        elif chunk_type == 0x0102 and strings:
            try:
                tag_name = string_at(strings, bin_u32(data, offset + 20))
                attr_start = bin_u16(data, offset + 24)
                attr_size = bin_u16(data, offset + 26) or 20
                attr_count = bin_u16(data, offset + 28)
                attr_base = offset + 16 + attr_start
                attrs = {}
                for index in range(attr_count):
                    attr_offset = attr_base + index * attr_size
                    attr_name = string_at(strings, bin_u32(data, attr_offset + 4))
                    raw_value = string_at(strings, bin_u32(data, attr_offset + 8))
                    value_type = data[attr_offset + 15]
                    value_data = bin_u32(data, attr_offset + 16)
                    value = string_at(strings, value_data) if value_type == 0x03 else raw_value
                    attrs[attr_name] = {"value": value, "raw": raw_value, "type": value_type, "data": value_data}
                elements.append({"name": tag_name, "attrs": attrs})
            except (IndexError, struct.error):
                pass
        offset += chunk_size
    return elements


def application_attr(data, attr_name):
    for element in parse_binary_xml_elements(data):
        if element.get("name") != "application":
            continue
        attr = (element.get("attrs") or {}).get(attr_name)
        if not attr:
            return "", None
        if attr.get("type") == 0x01:
            return "", attr.get("data")
        value = attr.get("value") or attr.get("raw") or ""
        return value, parse_resource_ref(value)
    return "", None


def parse_binary_manifest_label(data):
    return application_attr(data, "label")


def decode_resource_locale_part(value):
    if not value or value == b"\x00\x00":
        return ""
    first, second = value[0], value[1]
    if first & 0x80:
        try:
            return "".join([
                chr((second & 0x1F) + ord("a")),
                chr((((second & 0xE0) >> 5) | ((first & 0x03) << 3)) + ord("a")),
                chr(((first & 0x7C) >> 2) + ord("a")),
            ])
        except ValueError:
            return ""
    return value.rstrip(b"\x00").decode("ascii", errors="ignore").lower()


def parse_resource_locale(data, config_offset):
    try:
        if bin_u32(data, config_offset) < 12:
            return "", ""
        language = decode_resource_locale_part(data[config_offset + 8:config_offset + 10])
        region = decode_resource_locale_part(data[config_offset + 10:config_offset + 12])
        return language.lower(), region.upper()
    except (IndexError, struct.error):
        return "", ""


def normalize_locale(value):
    text = str(value or "").strip().replace("_", "-")
    if not text or text.lower() in {"null", "undefined"}:
        return ""
    parts = [part for part in text.split("-") if part]
    if not parts:
        return ""
    language = parts[0].lower()
    region = ""
    for part in parts[1:]:
        if len(part) == 3 and part.lower().startswith("r") and part[1:].isalpha():
            region = part[1:].upper()
            break
        if len(part) in {2, 3} and part.isalpha():
            region = part.upper()
            break
    return f"{language}-{region}" if region else language


def locale_score(language, region, preferred_locales):
    language = (language or "").lower()
    region = (region or "").upper()
    if not language:
        return 30
    best = 0
    for index, locale_value in enumerate(preferred_locales or []):
        normalized = normalize_locale(locale_value)
        if not normalized:
            continue
        parts = normalized.split("-", 1)
        pref_language = parts[0]
        pref_region = parts[1].upper() if len(parts) > 1 else ""
        if language == pref_language and region and pref_region and region == pref_region:
            best = max(best, 1000 - index)
        elif language == pref_language:
            best = max(best, 850 - index)
    if language == "zh":
        best = max(best, 700)
    elif language == "en":
        best = max(best, 120)
    else:
        best = max(best, 10)
    return best


def resource_table_values(data, resource_id, preferred_locales, depth=0):
    if not data or not resource_id or depth > 4:
        return []
    try:
        if bin_u16(data, 0) != 0x0002:
            return []
        table_size = bin_u32(data, 4)
        offset = bin_u16(data, 2)
        global_strings = []
        if offset + 8 <= len(data) and bin_u16(data, offset) == 0x0001:
            global_strings, string_pool_size = parse_android_string_pool(data, offset)
            offset += string_pool_size
        target_package = (resource_id >> 24) & 0xFF
        target_type = (resource_id >> 16) & 0xFF
        target_entry = resource_id & 0xFFFF
        candidates = []
        while offset + 8 <= min(table_size, len(data)):
            chunk_type = bin_u16(data, offset)
            header_size = bin_u16(data, offset + 2)
            chunk_size = bin_u32(data, offset + 4)
            if chunk_size <= 0:
                break
            if chunk_type == 0x0200:
                package_id = bin_u32(data, offset + 8)
                package_end = offset + chunk_size
                if package_id == target_package or target_package == 0:
                    inner = offset + header_size
                    while inner + 8 <= min(package_end, len(data)):
                        inner_type = bin_u16(data, inner)
                        inner_header_size = bin_u16(data, inner + 2)
                        inner_size = bin_u32(data, inner + 4)
                        if inner_size <= 0:
                            break
                        if inner_type == 0x0201 and data[inner + 8] == target_type:
                            entry_count = bin_u32(data, inner + 12)
                            entries_start = bin_u32(data, inner + 16)
                            if target_entry < entry_count:
                                entry_offset = bin_u32(data, inner + inner_header_size + target_entry * 4)
                                if entry_offset != 0xFFFFFFFF:
                                    entry_pos = inner + entries_start + entry_offset
                                    entry_size = bin_u16(data, entry_pos)
                                    entry_flags = bin_u16(data, entry_pos + 2)
                                    if not (entry_flags & 0x0001):
                                        value_pos = entry_pos + entry_size
                                        value_type = data[value_pos + 3]
                                        value_data = bin_u32(data, value_pos + 4)
                                        language, region = parse_resource_locale(data, inner + 20)
                                        score = locale_score(language, region, preferred_locales)
                                        if value_type == 0x03:
                                            value = string_at(global_strings, value_data)
                                            if value:
                                                candidates.append((score, value))
                                        elif value_type == 0x01:
                                            for value in resource_table_values(data, value_data, preferred_locales, depth + 1):
                                                candidates.append((score, value))
                        inner += inner_size
            offset += chunk_size
        candidates.sort(key=lambda item: item[0], reverse=True)
        values = []
        for _, value in candidates:
            if value and value not in values:
                values.append(value)
        return values
    except (IndexError, struct.error, zipfile.BadZipFile):
        return []


def resource_table_string(data, resource_id, preferred_locales, depth=0):
    values = resource_table_values(data, resource_id, preferred_locales, depth)
    return values[0] if values else ""


def apk_label_from_zip(apk_path, preferred_locales):
    try:
        with zipfile.ZipFile(apk_path) as apk:
            label_text, label_ref = parse_binary_manifest_label(apk.read("AndroidManifest.xml"))
            if label_ref:
                try:
                    resolved = resource_table_string(apk.read("resources.arsc"), label_ref, preferred_locales)
                    if resolved:
                        return resolved, "apk-resources", ""
                except KeyError:
                    pass
            if label_text and not label_text.startswith("@"):
                return label_text, "apk-manifest", ""
            return "", "", "APK 没有解析到应用名称"
    except (KeyError, zipfile.BadZipFile, OSError, struct.error) as exc:
        return "", "", str(exc)


def local_android_tools_roots():
    roots = []
    for name in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        value = os.environ.get(name)
        if value:
            roots.append(Path(value).expanduser())
    roots.append(Path.home() / "Library" / "Android" / "sdk")
    if platform.system().lower() == "windows":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            roots.append(Path(local_app_data) / "Android" / "Sdk")
    return roots


def find_aapt_tool():
    env_value = os.environ.get("ADB_BOX_AAPT") or os.environ.get("AAPT_PATH")
    suffixes = [".exe", ""] if platform.system().lower() == "windows" else [""]
    candidates = [Path(env_value).expanduser()] if env_value else []
    for name in ("aapt", "aapt2"):
        found = shutil.which(name)
        if found:
            candidates.append(Path(found))
    for root in local_android_tools_roots():
        build_tools = root / "build-tools"
        if not build_tools.exists():
            continue
        for version_dir in sorted(build_tools.iterdir(), reverse=True):
            for binary in ("aapt", "aapt2"):
                for suffix in suffixes:
                    candidates.append(version_dir / f"{binary}{suffix}")
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return str(candidate)
    return ""


def run_aapt_badging(apk_path, tool_path):
    if not tool_path:
        return {"ok": False, "stdout": "", "stderr": "未找到 aapt/aapt2"}
    try:
        proc = subprocess.run(
            [tool_path, "dump", "badging", str(apk_path)],
            capture_output=True,
            timeout=20,
            **hidden_subprocess_kwargs(),
        )
        return {
            "ok": proc.returncode == 0,
            "stdout": decode_output(proc.stdout),
            "stderr": decode_output(proc.stderr),
        }
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "stdout": "", "stderr": str(exc)}


def aapt_label_from_apk(apk_path, preferred_locales, tool_path):
    result = run_aapt_badging(apk_path, tool_path)
    if not result["ok"]:
        return "", "", first_nonempty(result.get("stderr") or result.get("stdout")) or "aapt 解析失败"
    labels = []
    for locale_name, label in re.findall(r"application-label(?:-([A-Za-z0-9_-]+))?:'([^']*)'", result["stdout"]):
        locale_parts = (normalize_locale(locale_name).split("-", 1) + [""])[:2]
        labels.append((locale_score(locale_parts[0], locale_parts[1], preferred_locales), label))
    app_label = first_regex_group(result["stdout"], r"application:\s+label='([^']*)'")
    if app_label:
        labels.append((35, app_label))
    labels = [(score, label) for score, label in labels if label]
    if not labels:
        return "", "", "aapt 没有输出应用名称"
    labels.sort(key=lambda item: item[0], reverse=True)
    return labels[0][1], "aapt", ""


def aapt_icon_candidates_from_apk(apk_path, tool_path):
    result = run_aapt_badging(apk_path, tool_path)
    if not result.get("ok"):
        return []
    candidates = []
    for density, icon_path in re.findall(r"application-icon(?:-(\d+))?:'([^']+)'", result.get("stdout") or ""):
        candidates.append((int(density or 0), icon_path))
    default_icon = first_regex_group(result.get("stdout") or "", r"application:\s+label='[^']*'\s+icon='([^']+)'")
    if default_icon:
        candidates.append((1, default_icon))
    return order_icon_candidates([item for _, item in sorted(candidates, key=lambda pair: pair[0], reverse=True)])


def density_score(path):
    text = str(path or "").lower()
    density_scores = {
        "xxxhdpi": 640,
        "xxhdpi": 480,
        "xhdpi": 320,
        "hdpi": 240,
        "mdpi": 160,
        "ldpi": 120,
    }
    for key, score in density_scores.items():
        if key in text:
            return score
    match = re.search(r"-(\d+)dpi", text)
    return int(match.group(1)) if match else 0


def icon_name_score(path):
    name = Path(str(path)).stem.lower()
    score = density_score(path)
    if "ic_launcher" in name:
        score += 1000
    elif "launcher" in name:
        score += 800
    elif "icon" in name:
        score += 600
    elif "logo" in name:
        score += 450
    if "foreground" in name:
        score -= 80
    if "round" in name:
        score += 80
    if "background" in name or "monochrome" in name:
        score -= 400
    if "/mipmap" in str(path):
        score += 100
    return score


def order_icon_candidates(paths):
    seen = set()
    ordered = []
    for path in sorted([item for item in paths if item], key=icon_name_score, reverse=True):
        if path not in seen:
            seen.add(path)
            ordered.append(path)
    return ordered


def sibling_icon_images(names, path):
    base = Path(path).stem
    siblings = [
        name for name in names
        if Path(name).suffix.lower() in IMAGE_SUFFIXES
        and Path(name).stem == base
        and (name.startswith("res/mipmap") or name.startswith("res/drawable"))
    ]
    return order_icon_candidates(siblings)


def drawable_refs_from_xml(data):
    refs = []
    for element in parse_binary_xml_elements(data):
        attrs = element.get("attrs") or {}
        for name in ("drawable", "foreground", "background", "src", "icon"):
            attr = attrs.get(name)
            if not attr:
                continue
            if attr.get("type") == 0x01 and attr.get("data"):
                refs.append(attr["data"])
                continue
            parsed = parse_resource_ref(attr.get("value") or attr.get("raw"))
            if parsed:
                refs.append(parsed)
    return refs


def expand_icon_path(apk, resources_data, path, preferred_locales, seen=None):
    seen = seen or set()
    if not path or path in seen:
        return []
    seen.add(path)
    names = set(apk.namelist())
    suffix = Path(path).suffix.lower()
    if suffix in IMAGE_SUFFIXES and path in names:
        return order_icon_candidates([path, *sibling_icon_images(names, path)])
    if suffix == ".xml" and path in names:
        expanded = []
        for ref in drawable_refs_from_xml(apk.read(path)):
            for value in resource_table_values(resources_data, ref, preferred_locales):
                expanded.extend(expand_icon_path(apk, resources_data, value, preferred_locales, seen))
        return order_icon_candidates(expanded)
    return sibling_icon_images(names, path)


def manifest_icon_candidates(apk, preferred_locales):
    try:
        manifest = apk.read("AndroidManifest.xml")
    except KeyError:
        return []
    try:
        resources_data = apk.read("resources.arsc")
    except KeyError:
        resources_data = b""
    candidates = []
    for attr_name in ("icon", "roundIcon", "logo"):
        value, ref = application_attr(manifest, attr_name)
        if ref and resources_data:
            for path in resource_table_values(resources_data, ref, preferred_locales):
                candidates.extend(expand_icon_path(apk, resources_data, path, preferred_locales))
        elif value:
            candidates.extend(expand_icon_path(apk, resources_data, value, preferred_locales))
    return order_icon_candidates(candidates)


def fallback_icon_candidates(apk):
    names = apk.namelist()
    images = [
        name for name in names
        if Path(name).suffix.lower() in IMAGE_SUFFIXES
        and (name.startswith("res/mipmap") or name.startswith("res/drawable"))
        and not name.lower().endswith(".9.png")
    ]
    return order_icon_candidates(images)


def apk_icon_candidates_from_zip(apk_path, preferred_locales):
    try:
        with zipfile.ZipFile(apk_path) as apk:
            return order_icon_candidates([*manifest_icon_candidates(apk, preferred_locales), *fallback_icon_candidates(apk)])
    except (KeyError, zipfile.BadZipFile, OSError, struct.error):
        return []


def icon_mime_type(path):
    suffix = Path(path).suffix.lower()
    if suffix == ".webp":
        return "image/webp"
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".gif":
        return "image/gif"
    return "image/png"


def save_icon_from_apk(apk_path, package_name, serial, app, cache_dir, safe_name, aapt_tool="", preferred_locales=None):
    preferred_locales = preferred_locales or ["zh-CN", "zh", "en-US", "en"]
    candidates = order_icon_candidates([
        *aapt_icon_candidates_from_apk(apk_path, aapt_tool),
        *apk_icon_candidates_from_zip(apk_path, preferred_locales),
    ])
    if not candidates:
        return "", "APK 中没有找到可直接展示的 icon"
    cache_dir = Path(cache_dir)
    device_dir = cache_dir / safe_name(serial)
    device_dir.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(apk_path) as zf:
            names = set(zf.namelist())
            for icon_path in candidates:
                if icon_path not in names:
                    continue
                suffix = Path(icon_path).suffix.lower()
                if suffix not in IMAGE_SUFFIXES:
                    continue
                data = zf.read(icon_path)
                if not data:
                    continue
                ext = ".jpg" if suffix == ".jpeg" else suffix
                out_path = device_dir / f"{safe_name(package_name)}-{safe_name(app.get('versionCode') or '0')}{ext}"
                tmp_path = out_path.with_name(f".{out_path.name}.{uuid.uuid4().hex}.tmp")
                tmp_path.write_bytes(data)
                os.replace(tmp_path, out_path)
                return str(out_path), ""
    except zipfile.BadZipFile:
        return "", "APK 文件损坏，无法读取 icon"
    return "", "APK 中没有可直接展示的 png/webp/jpg icon"
