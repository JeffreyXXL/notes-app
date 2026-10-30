mod settings;
mod vault;

use std::path::Path;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

/* ============================================================
   命令：笔记库
   ============================================================ */

#[derive(Serialize)]
struct VaultInfo {
    root: String,
    label: String,
    kind: &'static str,
}

#[tauri::command]
fn vault_info(app: AppHandle) -> Result<VaultInfo, String> {
    let root = vault::root(&app)?;
    let full = root.to_string_lossy().to_string();
    Ok(VaultInfo {
        label: full.clone(),
        root: full,
        kind: "fs",
    })
}

#[tauri::command]
fn vault_list(app: AppHandle) -> Result<Vec<vault::RawFile>, String> {
    let root = vault::root(&app)?;
    vault::list(&root)
}

#[tauri::command]
fn note_read(app: AppHandle, rel_path: String) -> Result<Option<vault::RawFile>, String> {
    let root = vault::root(&app)?;
    vault::read(&root, &rel_path)
}

#[tauri::command]
fn note_write(app: AppHandle, rel_path: String, raw: String) -> Result<u64, String> {
    let root = vault::root(&app)?;
    vault::write(&root, &rel_path, &raw)
}

#[tauri::command]
fn note_remove(app: AppHandle, rel_path: String) -> Result<(), String> {
    let root = vault::root(&app)?;
    vault::remove(&root, &rel_path)
}

#[tauri::command]
fn note_move(app: AppHandle, from_rel: String, to_rel: String) -> Result<(), String> {
    let root = vault::root(&app)?;
    vault::rename(&root, &from_rel, &to_rel)
}

/// 图片落盘。前端传 base64，返回新的 mtime
#[tauri::command]
fn asset_write(app: AppHandle, rel_path: String, base64: String) -> Result<u64, String> {
    let root = vault::root(&app)?;
    vault::write_binary(&root, &rel_path, &base64)
}

/// 改完名/搬完之后，把腾空的旧目录收走（连里面的空子目录一起）。
/// 只删空目录，里面有东西就什么都不做 —— 前端 fire-and-forget 调，失败也不影响主流程。
#[tauri::command]
fn vault_prune(app: AppHandle, rel_path: String) -> Result<(), String> {
    let root = vault::root(&app)?;
    vault::prune(&root, &rel_path)
}

/* ============================================================
   命令：设置 / 系统
   ============================================================ */

#[tauri::command]
fn settings_load(app: AppHandle) -> Result<Option<String>, String> {
    Ok(settings::load(&app))
}

#[tauri::command]
fn settings_save(app: AppHandle, json: String) -> Result<(), String> {
    settings::save(&app, &json)
}

#[tauri::command]
fn vault_reveal(app: AppHandle) -> Result<(), String> {
    let root = vault::root(&app)?;
    reveal_in_file_manager(&root)
}

#[tauri::command]
fn set_autostart(app: AppHandle, on: bool) -> Result<(), String> {
    let al = app.autolaunch();
    let res = if on { al.enable() } else { al.disable() };
    res.map_err(|e| format!("设置开机自启失败: {e}"))
}

/// 用系统默认程序打开外链。
/// 只放行 http / https / mailto —— markdown 里写个 `file://` 或自定义协议
/// 就真去执行，那是给自己挖坑。返回 false 表示这个协议不给开。
#[tauri::command]
fn open_external(url: String) -> Result<bool, String> {
    let u = url.trim();
    let lower = u.to_ascii_lowercase();
    let allowed = ["http://", "https://", "mailto:"]
        .iter()
        .any(|p| lower.starts_with(p));
    if !allowed {
        return Ok(false);
    }
    open_url(u)?;
    Ok(true)
}

#[cfg(target_os = "windows")]
fn open_url(url: &str) -> Result<(), String> {
    // rundll32 直接调 ShellExecute，不经过 cmd.exe 解析，
    // 免得 URL 里的 & 之类被当成命令分隔符
    std::process::Command::new("rundll32.exe")
        .arg("url.dll,FileProtocolHandler")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn open_url(url: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_url(url: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/* ============================================================
   无边框窗口控制：命令名与 Electron 侧完全一致
   ============================================================ */

#[tauri::command]
fn win_minimize(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn win_toggle_max(window: tauri::WebviewWindow) -> Result<bool, String> {
    let maximized = window.is_maximized().map_err(|e| e.to_string())?;
    if maximized {
        window.unmaximize().map_err(|e| e.to_string())?;
    } else {
        window.maximize().map_err(|e| e.to_string())?;
    }
    window.is_maximized().map_err(|e| e.to_string())
}

#[tauri::command]
fn win_close(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn win_is_max(window: tauri::WebviewWindow) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn reveal_in_file_manager(p: &Path) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(p)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn reveal_in_file_manager(p: &Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(p)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_in_file_manager(p: &Path) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(p)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/* ============================================================
   窗口尺寸
   ============================================================ */

/// 默认尺寸和 Electron 侧保持一致：1570x960 是上限，小屏幕上按比例收，
/// 免得窗口比屏幕还大、右下角跑到屏幕外面去。
fn fit_main_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let Ok(Some(mon)) = app.primary_monitor() else {
        return;
    };

    let scale = mon.scale_factor();
    let size = mon.size();
    let sw = size.width as f64 / scale;
    let sh = size.height as f64 / scale;

    let w = 1570f64.min(sw * 0.86);
    let h = 960f64.min(sh * 0.90);

    let _ = win.set_size(tauri::LogicalSize::new(w, h));
    let _ = win.center();
}

/* ============================================================
   托盘
   ============================================================ */

fn focus_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("笔记")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => focus_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                focus_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

/* ============================================================
   入口
   ============================================================ */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            vault_info,
            vault_list,
            note_read,
            note_write,
            note_remove,
            note_move,
            asset_write,
            vault_prune,
            settings_load,
            settings_save,
            vault_reveal,
            set_autostart,
            open_external,
            win_minimize,
            win_toggle_max,
            win_close,
            win_is_max
        ])
        .setup(|app| {
            // 首次启动把笔记库目录建出来
            let _ = vault::root(app.handle());
            build_tray(app.handle())?;
            fit_main_window(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 按设置决定：关掉窗口 or 收进托盘
                if !settings::should_quit_on_close(window.app_handle()) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}
