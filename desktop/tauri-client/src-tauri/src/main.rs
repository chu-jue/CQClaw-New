use serde::Serialize;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

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
    Command::new(command)
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
    let mut child = Command::new(&python)
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![client_info, run_cqclaw])
        .run(tauri::generate_context!())
        .expect("error while running CQClaw client");
}
