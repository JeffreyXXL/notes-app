use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

fn file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("取配置目录失败: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Option<String> {
    let p = file(app).ok()?;
    fs::read_to_string(p).ok()
}

pub fn save(app: &AppHandle, json: &str) -> Result<(), String> {
    let p = file(app)?;
    fs::write(p, json.as_bytes()).map_err(|e| format!("保存设置失败: {e}"))
}

/// 关闭按钮行为：true = 退出程序，false = 最小化到托盘
pub fn should_quit_on_close(app: &AppHandle) -> bool {
    let raw = match load(app) {
        Some(r) => r,
        None => return false, // 没设置过就走默认：最小化到托盘
    };
    let v: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return false,
    };
    v.get("closeAction").and_then(|x| x.as_str()) == Some("quit")
}
