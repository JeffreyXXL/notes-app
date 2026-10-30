use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Manager};

/// 一个 .md 文件的原始内容
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawFile {
    pub rel_path: String,
    pub raw: String,
    pub mtime: u64,
}

/// 笔记库根目录。
/// 默认 `<app_data>/vault`，可用环境变量 `NOTES_APP_VAULT` 指向任意目录
/// （比如放在坚果云 / OneDrive 里同步）。
pub fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = match std::env::var("NOTES_APP_VAULT") {
        Ok(custom) if !custom.trim().is_empty() => PathBuf::from(custom),
        _ => app
            .path()
            .app_data_dir()
            .map_err(|e| format!("取应用数据目录失败: {e}"))?
            .join("vault"),
    };
    fs::create_dir_all(&dir).map_err(|e| format!("创建笔记库目录失败: {e}"))?;
    Ok(dir)
}

pub fn mtime_of(p: &Path) -> u64 {
    fs::metadata(p)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 把前端传来的相对路径拼到根目录下，同时挡掉 `..` 越权
pub fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let normalized = rel.replace('\\', "/");
    let mut out = root.to_path_buf();

    for seg in normalized.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." || seg.contains(':') {
            return Err(format!("非法路径: {rel}"));
        }
        out.push(seg);
    }

    if !out.starts_with(root) {
        return Err(format!("路径越界: {rel}"));
    }
    Ok(out)
}

/// 扫描整个笔记库，跳过隐藏目录与隐藏文件
pub fn list(root: &Path) -> Result<Vec<RawFile>, String> {
    let mut out = Vec::new();

    let walker = walkdir::WalkDir::new(root)
        .min_depth(1)
        .into_iter()
        .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'));

    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue, // 权限不足之类的，跳过就好
        };
        if !entry.file_type().is_file() {
            continue;
        }

        let p = entry.path();
        let is_md = p
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !is_md {
            continue;
        }

        let raw = match fs::read_to_string(p) {
            Ok(s) => s,
            Err(_) => continue, // 非 UTF-8 或读不了，先忽略
        };

        let rel = p
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("/");

        out.push(RawFile {
            rel_path: rel,
            raw,
            mtime: mtime_of(p),
        });
    }

    out.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    Ok(out)
}

pub fn read(root: &Path, rel: &str) -> Result<Option<RawFile>, String> {
    let p = safe_join(root, rel)?;
    if !p.is_file() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    Ok(Some(RawFile {
        rel_path: rel.to_string(),
        raw,
        mtime: mtime_of(&p),
    }))
}

/// 原子写入：先落临时文件再改名，避免写一半崩掉留下半个文件
pub fn write(root: &Path, rel: &str, raw: &str) -> Result<u64, String> {
    let p = safe_join(root, rel)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }

    let tmp = p.with_extension("md.tmp");
    fs::write(&tmp, raw.as_bytes()).map_err(|e| format!("写临时文件失败: {e}"))?;
    fs::rename(&tmp, &p).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("替换文件失败: {e}")
    })?;

    Ok(mtime_of(&p))
}

/// 二进制写入：图片这类资源由前端读成 base64 传过来。
/// 和 write() 一样先落临时文件再改名，避免大图写到一半留下半个文件。
pub fn write_binary(root: &Path, rel: &str, b64: &str) -> Result<u64, String> {
    let p = safe_join(root, rel)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("图片数据解码失败: {e}"))?;
    if bytes.is_empty() {
        return Err("空文件".into());
    }

    let tmp = p.with_extension("tmp");
    fs::write(&tmp, &bytes).map_err(|e| format!("写临时文件失败: {e}"))?;
    fs::rename(&tmp, &p).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("替换文件失败: {e}")
    })?;

    Ok(mtime_of(&p))
}

pub fn remove(root: &Path, rel: &str) -> Result<(), String> {
    let p = safe_join(root, rel)?;
    if p.is_file() {
        fs::remove_file(&p).map_err(|e| format!("删除失败: {e}"))?;
    }

    // 顺手把空掉的目录收走，别留一堆空文件夹
    let mut cur = p.parent().map(|d| d.to_path_buf());
    while let Some(d) = cur {
        if d.as_path() == root {
            break;
        }
        let empty = fs::read_dir(&d)
            .map(|mut it| it.next().is_none())
            .unwrap_or(false);
        if !empty {
            break;
        }
        let _ = fs::remove_dir(&d);
        cur = d.parent().map(|x| x.to_path_buf());
    }

    Ok(())
}

/// 收掉一个（多半已经空了的）目录：连里面剩下的空子目录一起删，
/// 再顺着往上把因此变空的父目录也收走。
///
/// 和 `remove()` 的区别：那个只往上收一层链，`prune()` 会先往下扫。
/// 因为 `fs::rename` 只搬文件不搬目录，改完名原来的目录里常留着一串空子目录，
/// 光看第一层「非空」就停手，旧目录会一直赖着不走。
///
/// 只删空目录 —— 里面只要还剩一个文件就整条链停手，绝不递归删文件。
pub fn prune(root: &Path, rel: &str) -> Result<(), String> {
    let top = safe_join(root, rel)?;
    if top.as_path() == root {
        return Ok(()); // 别把库根删了
    }

    // 递归往下收空目录，返回自己有没有被删掉
    fn sweep(dir: &Path) -> bool {
        let mut empty = true;
        if let Ok(rd) = fs::read_dir(dir) {
            for entry in rd.flatten() {
                let p = entry.path();
                if p.is_dir() && sweep(&p) {
                    continue; // 子目录收干净了，不算它还占着地方
                }
                empty = false;
            }
        }
        empty && fs::remove_dir(dir).is_ok()
    }

    sweep(&top);

    // 再往上收：父目录空了才删，一路收到库根为止
    let mut cur = top.parent().map(|d| d.to_path_buf());
    while let Some(d) = cur {
        if d.as_path() == root || !d.starts_with(root) {
            break;
        }
        let empty = fs::read_dir(&d)
            .map(|mut it| it.next().is_none())
            .unwrap_or(false);
        if !empty {
            break;
        }
        if fs::remove_dir(&d).is_err() {
            break;
        }
        cur = d.parent().map(|x| x.to_path_buf());
    }

    Ok(())
}

pub fn rename(root: &Path, from: &str, to: &str) -> Result<(), String> {
    let a = safe_join(root, from)?;
    let b = safe_join(root, to)?;

    if let Some(parent) = b.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    if b.exists() {
        return Err(format!("目标已存在: {to}"));
    }

    fs::rename(&a, &b).map_err(|e| format!("移动失败: {e}"))
}
