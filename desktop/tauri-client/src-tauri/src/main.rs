#![cfg_attr(windows, windows_subsystem = "windows")]

use serde::Serialize;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};

static EXIT_STOP_REQUESTED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
struct CommandOutput {
    code: i32,
    stdout: String,
    stderr: String,
}

#[derive(Serialize)]
struct ClientInfo {
    home: String,
    python: String,
}

#[derive(Serialize)]
struct OpenUrlResult {
    url: String,
}

const TRAY_SHOW_ID: &str = "show";
const TRAY_EXIT_ID: &str = "exit";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(windows)]
fn hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    use std::os::windows::process::CommandExt;
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(windows))]
fn hidden_command(program: &str) -> Command {
    Command::new(program)
}

fn project_root() -> Result<PathBuf, String> {
    if let Ok(value) = env::var("QCLAW_HOME") {
        if !value.trim().is_empty() {
            return Ok(PathBuf::from(value));
        }
    }
    if let Ok(value) = env::var("AAS_HOME") {
        if !value.trim().is_empty() {
            return Ok(PathBuf::from(value));
        }
    }

    let exe = env::current_exe().map_err(|err| err.to_string())?;
    let mut current = exe.parent();
    while let Some(dir) = current {
        if dir.join("tools").join("aas_cli.py").exists() {
            return Ok(dir.to_path_buf());
        }
        current = dir.parent();
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .ok_or_else(|| "Could not resolve CQClaw project root".to_string())
}

fn command_exists(command: &str) -> bool {
    hidden_command(command)
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn python_executable() -> String {
    if let Ok(value) = env::var("QCLAW_PYTHON") {
        if !value.trim().is_empty() {
            return value;
        }
    }
    if let Ok(value) = env::var("AAS_PYTHON") {
        if !value.trim().is_empty() {
            return value;
        }
    }
    if cfg!(target_os = "macos") && Path::new("/usr/bin/python3").exists() {
        return "/usr/bin/python3".to_string();
    }
    if cfg!(target_os = "windows") && command_exists("py") {
        return "py".to_string();
    }
    if command_exists("python3") {
        return "python3".to_string();
    }
    "python".to_string()
}

fn python_args<'a>(python: &str, cli: &'a Path, args: &'a [String]) -> Vec<String> {
    let mut command_args = Vec::new();
    if cfg!(target_os = "windows") && python.eq_ignore_ascii_case("py") {
        command_args.push("-3".to_string());
    }
    command_args.push(cli.to_string_lossy().to_string());
    command_args.extend(args.iter().cloned());
    command_args
}

fn run_cli_for_exit(args: &[&str]) -> Result<CommandOutput, String> {
    let root = project_root()?;
    let cli = root.join("tools").join("aas_cli.py");
    if !cli.exists() {
        return Err(format!("CLI not found: {}", cli.display()));
    }

    let python = python_executable();
    let command_args = python_args(
        &python,
        &cli,
        &args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>(),
    );
    let output = hidden_command(&python)
        .args(command_args)
        .current_dir(&root)
        .env("QCLAW_HOME", &root)
        .env("AAS_HOME", &root)
        .env("TK_SILENCE_DEPRECATION", "1")
        .output()
        .map_err(|err| format!("Failed to run CQClaw CLI: {err}"))?;

    Ok(CommandOutput {
        code: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn stop_cqclaw_before_exit() {
    if EXIT_STOP_REQUESTED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        let _ = run_cli_for_exit(&["stop"]);
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show_item = MenuItemBuilder::with_id(TRAY_SHOW_ID, "Show CQClaw").build(app)?;
    let exit_item = MenuItemBuilder::with_id(TRAY_EXIT_ID, "Exit").build(app)?;
    let menu = Menu::with_items(app, &[&show_item, &exit_item])?;

    let mut tray = TrayIconBuilder::with_id("cqclaw")
        .tooltip("CQClaw")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().0.as_str() {
            TRAY_SHOW_ID => show_main_window(app),
            TRAY_EXIT_ID => {
                stop_cqclaw_before_exit();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => show_main_window(tray.app_handle()),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

#[tauri::command]
fn client_info() -> Result<ClientInfo, String> {
    Ok(ClientInfo {
        home: project_root()?.to_string_lossy().to_string(),
        python: python_executable(),
    })
}

#[tauri::command]
fn run_cqclaw(args: Vec<String>, timeout_secs: Option<u64>) -> Result<CommandOutput, String> {
    let root = project_root()?;
    let cli = root.join("tools").join("aas_cli.py");
    if !cli.exists() {
        return Err(format!("CLI not found: {}", cli.display()));
    }

    let python = python_executable();
    let command_args = python_args(&python, &cli, &args);
    let mut child = hidden_command(&python)
        .args(command_args)
        .current_dir(&root)
        .env("QCLAW_HOME", &root)
        .env("AAS_HOME", &root)
        .env("TK_SILENCE_DEPRECATION", "1")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to run CQClaw CLI: {err}"))?;

    let timeout = Duration::from_secs(timeout_secs.unwrap_or(30).max(1));
    let start = Instant::now();
    loop {
        if child.try_wait().map_err(|err| err.to_string())?.is_some() {
            break;
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let output = child.wait_with_output().map_err(|err| err.to_string())?;
            return Ok(CommandOutput {
                code: 124,
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: "Command timed out".to_string(),
            });
        }
        std::thread::sleep(Duration::from_millis(120));
    }

    let output = child.wait_with_output().map_err(|err| err.to_string())?;
    Ok(CommandOutput {
        code: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

#[tauri::command]
fn open_url(url: String) -> Result<OpenUrlResult, String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err(format!("Unsupported URL: {trimmed}"));
    }

    let status = if cfg!(target_os = "windows") {
        hidden_command("cmd")
            .args(["/C", "start", "", trimmed])
            .status()
    } else if cfg!(target_os = "macos") {
        hidden_command("open").arg(trimmed).status()
    } else {
        hidden_command("xdg-open").arg(trimmed).status()
    }
    .map_err(|err| format!("Failed to open URL: {err}"))?;

    if !status.success() {
        return Err(format!("Open URL command failed: {status}"));
    }
    Ok(OpenUrlResult {
        url: trimmed.to_string(),
    })
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![client_info, run_cqclaw, open_url])
        .build(tauri::generate_context!())
        .expect("error while building CQClaw client")
        .run(|_app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                stop_cqclaw_before_exit();
            }
        });
}
