# CQClaw bundled agent assets

Put release-ready mobile agent binaries in this directory before building a
Windows release package:

- `CQClawAgent.apk`
- `cqclaw-agent-server.jar`

When no user or enterprise path is configured, CQClaw uses these bundled files
as the default Agent APK and clipboard server JAR. The Windows source ZIP and
Inno Setup installer include this directory automatically.
