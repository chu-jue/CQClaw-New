# CQClaw 路演简版介绍

## CQClaw 是什么

CQClaw 是一个本地优先的 Android Agent 自动化工作台。它让 Agent 不只是回答“应该怎么操作手机”，而是可以真正观察手机、执行操作、验证结果，并把成功经验保存成下一次可直接复用的工作流。

一句话概括：

> CQClaw 把真实 Android 设备变成 Agent 可以操作、验证和持续学习的执行环境。

## 为什么需要它

现在很多 Agent 能生成步骤，但真正落到手机操作时会遇到问题：

- 看不到手机当前页面。
- 不知道点击后是否真的成功。
- 每次任务都要重新分析，成功经验不能复用。

CQClaw 解决的就是这个断点：让 Agent 从“会回答”变成“会操作、会验证、会积累”。

## 核心能力

### 1. 真实设备操作

CQClaw 可以读取 Android 设备状态、截图、UI Dump、前台 Activity，并执行点击、输入、Shell、文件传输、截图、录屏等动作。

Agent 可以通过 CQClaw CLI 直接操作真实手机，而不是只给用户一段说明。

### 2. 自动化工作流

CQClaw 支持把一组操作编排成工作流：

- 执行前可以预览。
- 执行中记录每一步结果。
- 执行后保存截图、Dump、日志等证据。
- 成功后保存为 Profile，下次可以直接复用。

这让一次成功任务可以沉淀成长期能力。

### 3. Agent Skill

CQClaw 提供可安装的 Agent Skill。用户安装客户端和 Skill 后，Agent 就知道如何调用本机 CQClaw。

Skill 会引导 Agent：

- 检查本地 CQClaw CLI 是否可用。
- 观察当前设备状态。
- 生成并预览工作流。
- 执行真实操作。
- 验证结果并保存 Profile。

这是 CQClaw 最适合路演展示的亮点：Agent 通过 Skill 使用真实工具完成真实设备任务。

## 重点功能模块

### 自动化编排

支持安装 APK、智能点击、应用操作、输入文本、剪切板、截图、录屏、文件推送/提取、权限处理、Shell 命令和自动化脚本。

其中自动化脚本可以混写 ADB 和 CQClaw DSL，例如：

```text
adb shell getprop ro.product.model
tapText("确定")
waitTextAndTap("登录", 5000)
```

### 日志洞察

日志洞察用于日常 Android 日志排查：

- 实时抓取 Logcat。
- 导入 `.log` / `.txt` 日志文件。
- 按 Package、Tag、Message 过滤。
- 高亮 error、exception、timeout 等关键词。
- 自动根据关键 Android 日志生成 Timeline。
- 查看故障上下文和事件链。
- 定位 Crash / ANR 等问题。

即使没有连接手机，也可以导入日志文件，让 CQClaw 自动整理关键事件时间线，继续排查问题。

### 节点解析

节点解析把截图和 UI XML 结合起来，帮助用户和 Agent 找到稳定的操作目标：

- 查看截图上的节点边界。
- 搜索 text / id / desc / class。
- 查看 bounds、中心坐标和控件属性。
- 生成 `tapById`、`tapText`、`waitId`、`assertId` 等推荐命令。

它解决的是“到底应该点哪里”的问题。

### 资源中心

资源中心集中管理截图、Dump、日志、APK、临时脚本和工作流导出，方便用户预览、打开目录和清理运行产物。

## 产品亮点

| 亮点 | 说明 |
| --- | --- |
| 真实设备执行 | Agent 可以操作真实 Android 手机 |
| 证据驱动 | 每次执行都有截图、Dump、日志和 JSON 结果 |
| 可复用工作流 | 成功任务可保存为 Profile，下次直接运行 |
| Skill 能力入口 | Agent 安装 Skill 后即可调用 CQClaw |
| 日志时间线 | 自动从关键 Android 日志生成 Timeline，快速还原事件链 |
| 日志 + 节点联合排查 | 既能看失败原因，也能找到下一步操作目标 |
| 本地优先 | 数据、日志、截图和工作流保存在用户电脑 |

## 推荐路演演示

1. 打开 CQClaw 客户端，展示本地服务和在线设备。
2. 让 Agent 通过 Skill / CLI 观察当前手机页面。
3. 执行一次点击、输入或打开应用操作。
4. 展示返回的 JSON、截图和 Dump 证据。
5. 保存为工作流 Profile。
6. 下次按名称直接复用。
7. 再展示日志洞察导入日志、自动生成关键日志 Timeline、过滤问题，以及节点解析生成稳定点击命令。

## 结尾表达

CQClaw 的核心不是做一个普通 ADB 工具，而是给 Agent 一个真实 Android 执行环境。

它让 Agent 能够观察真实设备、完成真实操作、留下真实证据，并把成功经验沉淀成可复用工作流。

这就是 CQClaw 的价值：让 Agent 从“会回答”升级为“会执行”。 
