#!/usr/bin/env python3
"""Small desktop launcher for CQClaw.

This client intentionally uses only the Python standard library so it can be
packaged with the existing project without adding an Electron or GUI runtime.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, ttk


APP_NAME = "CQClaw Client"


def project_root() -> Path:
    env_home = os.environ.get("QCLAW_HOME") or os.environ.get("AAS_HOME")
    if env_home:
        return Path(env_home).expanduser().resolve()
    return Path(__file__).resolve().parents[1]


ROOT = project_root()
CLI = ROOT / "tools" / "aas_cli.py"


class CommandResult:
    def __init__(self, code: int, stdout: str, stderr: str) -> None:
        self.code = code
        self.stdout = stdout
        self.stderr = stderr


class CQClawClient(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title(APP_NAME)
        self.geometry("760x520")
        self.minsize(680, 460)
        self.configure(bg="#f6f7f9")

        self.status_var = tk.StringVar(value="Loading...")
        self.home_var = tk.StringVar(value=str(ROOT))
        self.python_var = tk.StringVar(value=sys.executable)
        self.server_var = tk.StringVar(value="Unknown")
        self.url_var = tk.StringVar(value="-")
        self.autostart_var = tk.StringVar(value="Unknown")
        self.devices_var = tk.StringVar(value="Unknown")

        self._build_ui()
        self.refresh_all()

    def _build_ui(self) -> None:
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("Title.TLabel", font=("TkDefaultFont", 18, "bold"), background="#f6f7f9")
        style.configure("Body.TFrame", background="#f6f7f9")
        style.configure("Card.TFrame", background="#ffffff", relief="solid", borderwidth=1)
        style.configure("Card.TLabel", background="#ffffff")
        style.configure("Muted.TLabel", background="#ffffff", foreground="#5b6573")
        style.configure("Primary.TButton", padding=(14, 8))
        style.configure("TButton", padding=(12, 7))

        shell = ttk.Frame(self, style="Body.TFrame", padding=18)
        shell.pack(fill="both", expand=True)

        ttk.Label(shell, text="CQClaw", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            shell,
            text="Local Android automation service and web console launcher.",
            background="#f6f7f9",
            foreground="#5b6573",
        ).pack(anchor="w", pady=(2, 14))

        card = ttk.Frame(shell, style="Card.TFrame", padding=16)
        card.pack(fill="x")
        self._row(card, "Home", self.home_var)
        self._row(card, "Python", self.python_var)
        self._row(card, "Server", self.server_var)
        self._row(card, "URL", self.url_var)
        self._row(card, "Autostart", self.autostart_var)
        self._row(card, "Online devices", self.devices_var)

        actions = ttk.Frame(shell, style="Body.TFrame")
        actions.pack(fill="x", pady=16)
        buttons = [
            ("Refresh", self.refresh_all),
            ("Start Service", lambda: self.run_async(["start", "--no-open"], self.refresh_all)),
            ("Stop Service", lambda: self.run_async(["stop"], self.refresh_all)),
            ("Open Web", lambda: self.run_async(["open"])),
            ("Enable Autostart", lambda: self.run_async(["autostart", "enable", "--no-open"], self.refresh_all)),
            ("Disable Autostart", lambda: self.run_async(["autostart", "disable"], self.refresh_all)),
        ]
        for text, command in buttons:
            ttk.Button(actions, text=text, command=command).pack(side="left", padx=(0, 8), pady=(0, 8))

        log_frame = ttk.Frame(shell, style="Card.TFrame", padding=12)
        log_frame.pack(fill="both", expand=True)
        ttk.Label(log_frame, text="Output", style="Card.TLabel").pack(anchor="w")
        self.output = tk.Text(log_frame, height=10, wrap="word", relief="flat", bg="#ffffff", fg="#1d2430")
        self.output.pack(fill="both", expand=True, pady=(8, 0))
        self.output.configure(state="disabled")

        status = ttk.Label(shell, textvariable=self.status_var, background="#f6f7f9", foreground="#5b6573")
        status.pack(anchor="w", pady=(10, 0))

    def _row(self, parent: ttk.Frame, label: str, variable: tk.StringVar) -> None:
        row = ttk.Frame(parent, style="Card.TFrame")
        row.pack(fill="x", pady=3)
        ttk.Label(row, text=label, style="Muted.TLabel", width=16).pack(side="left")
        ttk.Label(row, textvariable=variable, style="Card.TLabel").pack(side="left", fill="x", expand=True)

    def append_output(self, text: str) -> None:
        if not text:
            return
        self.output.configure(state="normal")
        self.output.insert("end", text.rstrip() + "\n")
        self.output.see("end")
        self.output.configure(state="disabled")

    def command(self, args: list[str], timeout: int = 30) -> CommandResult:
        env = os.environ.copy()
        env["QCLAW_HOME"] = str(ROOT)
        env["AAS_HOME"] = str(ROOT)
        process = subprocess.run(
            [sys.executable, str(CLI), *args],
            cwd=str(ROOT),
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return CommandResult(process.returncode, process.stdout or "", process.stderr or "")

    def run_async(self, args: list[str], after=None, timeout: int = 30) -> None:
        self.status_var.set("Running: cqclaw " + " ".join(args))

        def worker() -> None:
            try:
                result = self.command(args, timeout=timeout)
            except Exception as exc:
                self.after(0, lambda: self.command_failed(str(exc)))
                return

            def finish() -> None:
                self.append_output(f"$ cqclaw {' '.join(args)}")
                self.append_output(result.stdout)
                self.append_output(result.stderr)
                self.status_var.set("Ready" if result.code == 0 else f"Command failed: {result.code}")
                if result.code != 0:
                    messagebox.showerror(APP_NAME, result.stderr.strip() or result.stdout.strip() or f"Exit code {result.code}")
                if after:
                    after()

            self.after(0, finish)

        threading.Thread(target=worker, daemon=True).start()

    def command_failed(self, message: str) -> None:
        self.status_var.set("Command failed")
        self.append_output(message)
        messagebox.showerror(APP_NAME, message)

    def refresh_all(self) -> None:
        self.status_var.set("Refreshing...")

        def worker() -> None:
            status = self.command(["status"], timeout=8)
            auto = self.command(["autostart", "status"], timeout=8)
            devices = self.command(["agent", "devices", "--online", "--timeout", "5"], timeout=12)
            self.after(0, lambda: self.apply_refresh(status, auto, devices))

        threading.Thread(target=worker, daemon=True).start()

    def apply_refresh(self, status: CommandResult, auto: CommandResult, devices: CommandResult) -> None:
        self.append_output(status.stdout)
        server_text, url_text = self.parse_status(status.stdout)
        self.server_var.set(server_text)
        self.url_var.set(url_text or "-")
        self.autostart_var.set(self.parse_autostart(auto.stdout))
        self.devices_var.set(self.parse_devices(devices.stdout))
        self.status_var.set("Ready")

    def parse_status(self, text: str) -> tuple[str, str]:
        running = "running" if "CQClaw: running" in text else "stopped"
        url = ""
        for line in text.splitlines():
            if line.startswith("url:"):
                url = line.split(":", 1)[1].strip()
                break
        return running, url

    def parse_autostart(self, text: str) -> str:
        if "enabled" in text:
            return "enabled"
        if "disabled" in text:
            return "disabled"
        return "unknown"

    def parse_devices(self, text: str) -> str:
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            return "unknown"
        data = payload.get("data") or {}
        count = int(data.get("count") or 0)
        if count == 0:
            return "0"
        serials = [item.get("serial", "") for item in data.get("devices", []) if item.get("serial")]
        return f"{count}: {', '.join(serials)}"


def main() -> int:
    if not CLI.exists():
        messagebox.showerror(APP_NAME, f"CLI not found: {CLI}")
        return 2
    app = CQClawClient()
    app.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
