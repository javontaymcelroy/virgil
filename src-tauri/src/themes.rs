//! Themes added from Settings → Themes. Each is a single .css file copied into
//! `<app data>/themes/<slug>.css` and served to the page as `vtheme://localhost/<slug>.css`,
//! so `@import` web fonts work and the page never needs file-system access.
//! Changes made to a built-in theme (Default or a private one) are kept the same way, as
//! `_<theme>.css`, layered on top of it until reset.

use std::path::{Path, PathBuf};
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext};
use tauri_plugin_dialog::DialogExt;

pub const SCHEME: &str = "vtheme";
const MAX_BYTES: u64 = 2 * 1024 * 1024;

fn dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("themes");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Couldn't create the themes folder: {e}."))?;
    Ok(dir)
}

/// File-name stem to theme id: lowercase letters, digits and single hyphens.
pub fn slug(stem: &str) -> String {
    let mut out = String::new();
    for c in stem.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let out: String = out.trim_matches('-').chars().take(40).collect();
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() {
        "theme".into()
    } else {
        out
    }
}

/// Only names `slug` could have produced (or `_` plus one, for edits to a built-in theme) reach
/// the file system, so no path can escape the folder.
fn is_slug(name: &str) -> bool {
    let name = name.strip_prefix('_').unwrap_or(name);
    !name.is_empty()
        && name.len() <= 40
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

#[tauri::command]
pub fn list_themes(app: AppHandle) -> Result<Vec<String>, String> {
    let mut names: Vec<String> = std::fs::read_dir(dir(&app)?)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter_map(|n| n.strip_suffix(".css").map(str::to_string))
        .filter(|n| is_slug(n))
        .collect();
    names.sort();
    Ok(names)
}

/// Shows the Open panel for a .css file and copies it in. Returns the theme id, or `None` if
/// cancelled. Adding a file with the same name replaces the earlier copy.
#[tauri::command]
pub async fn add_theme(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Add a Theme")
            .add_filter("CSS theme", &["css"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
        if size > MAX_BYTES {
            return Err("That theme is larger than 2 MB.".into());
        }
        let css = std::fs::read(&path).map_err(|e| format!("Couldn't read that file: {e}."))?;
        let css =
            String::from_utf8(css).map_err(|_| "That file isn't a text stylesheet.".to_string())?;
        let name = slug(
            &path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default(),
        );
        add_in(&dir(&app)?, &name, &css)?;
        Ok(Some(name))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn write(dir: &Path, name: &str, css: &str) -> Result<(), String> {
    std::fs::write(dir.join(format!("{name}.css")), css)
        .map_err(|e| format!("Couldn't save the theme: {e}."))
}

fn add_in(dir: &Path, name: &str, css: &str) -> Result<(), String> {
    if dir.join(format!("{name}.css")).exists() {
        return Err(format!(
            "A theme called “{name}” is already here. Remove it first, or rename the file."
        ));
    }
    write(dir, name, css)
}

fn save_in(dir: &Path, name: &str, css: &str, replacing: Option<String>) -> Result<String, String> {
    if name.trim().is_empty() {
        return Err("Give the theme a name.".into());
    }
    if css.trim().is_empty() {
        return Err("Paste or write some CSS first.".into());
    }
    if css.len() as u64 > MAX_BYTES {
        return Err("That theme is larger than 2 MB.".into());
    }
    let id = slug(name);
    // Only a theme of the user's own can be replaced: never a built-in's `_` override.
    let replacing = replacing.filter(|r| is_slug(r) && !r.starts_with('_'));
    if replacing.as_deref() != Some(id.as_str()) && dir.join(format!("{id}.css")).exists() {
        return Err(format!(
            "A theme called “{}” already exists. Choose another name.",
            name.trim()
        ));
    }
    write(dir, &id, css)?;
    if let Some(old) = replacing.filter(|old| *old != id) {
        let _ = std::fs::remove_file(dir.join(format!("{old}.css")));
    }
    Ok(id)
}

/// Saves CSS typed or pasted in Settings under `name` and returns the theme id. When editing,
/// `replacing` is the theme's current id: saving under a new name renames it. A name already
/// taken by a different theme is refused rather than overwritten.
#[tauri::command]
pub fn save_theme(
    app: AppHandle,
    name: String,
    css: String,
    replacing: Option<String>,
) -> Result<String, String> {
    save_in(&dir(&app)?, &name, &css, replacing)
}

/// Saves changes to the built-in theme `id` as `_<id>.css`, replacing earlier changes.
#[tauri::command]
pub fn save_override(app: AppHandle, id: String, css: String) -> Result<(), String> {
    if css.len() as u64 > MAX_BYTES {
        return Err("That theme is larger than 2 MB.".into());
    }
    // Built-in ids are already slugs; anything else isn't a theme the page was shown.
    if slug(&id) != id {
        return Err("Unknown theme.".into());
    }
    write(&dir(&app)?, &format!("_{id}"), &css)
}

#[tauri::command]
pub fn read_theme(app: AppHandle, name: String) -> Result<String, String> {
    if !is_slug(&name) {
        return Err("Unknown theme.".into());
    }
    std::fs::read_to_string(dir(&app)?.join(format!("{name}.css")))
        .map_err(|e| format!("Couldn't open the theme: {e}."))
}

#[tauri::command]
pub fn remove_theme(app: AppHandle, name: String) -> Result<(), String> {
    if !is_slug(&name) {
        return Err("Unknown theme.".into());
    }
    std::fs::remove_file(dir(&app)?.join(format!("{name}.css")))
        .map_err(|e| format!("Couldn't remove the theme: {e}."))
}

/// Serves `vtheme://localhost/<slug>.css` from the themes folder.
pub fn serve<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let name = request
        .uri()
        .path()
        .trim_start_matches('/')
        .strip_suffix(".css")
        .unwrap_or("");
    let css = if is_slug(name) {
        dir(ctx.app_handle())
            .ok()
            .and_then(|d| std::fs::read(d.join(format!("{name}.css"))).ok())
    } else {
        None
    };
    match css {
        Some(body) => Response::builder()
            .header("Content-Type", "text/css; charset=utf-8")
            .header("Cache-Control", "no-store")
            .body(body),
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new()),
    }
    .expect("static response parts are valid")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("virgil-themes-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn saving_cannot_delete_a_builtin_override_or_overwrite_another_theme() {
        let d = folder("save");
        std::fs::write(d.join("_default.css"), "a").unwrap();
        std::fs::write(d.join("night.css"), "b").unwrap();
        assert_eq!(
            save_in(&d, "Dawn", ":root{}", Some("_default".into())).unwrap(),
            "dawn"
        );
        assert!(
            d.join("_default.css").exists(),
            "the built-in's override survived"
        );
        assert!(save_in(&d, "Night", ":root{}", None)
            .unwrap_err()
            .contains("already exists"));
        assert!(save_in(&d, "Night", ":root{}", Some("dawn".into()))
            .unwrap_err()
            .contains("already exists"));
        // Renaming a theme of the user's own moves it.
        assert_eq!(
            save_in(&d, "Dusk", ":root{}", Some("dawn".into())).unwrap(),
            "dusk"
        );
        assert!(!d.join("dawn.css").exists() && d.join("dusk.css").exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn adding_a_file_never_overwrites() {
        let d = folder("add");
        add_in(&d, "night", "a").unwrap();
        assert!(add_in(&d, "night", "b")
            .unwrap_err()
            .contains("already here"));
        assert_eq!(std::fs::read_to_string(d.join("night.css")).unwrap(), "a");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn slugs_are_safe_file_names() {
        assert_eq!(slug("Vespertine"), "vespertine");
        assert_eq!(slug("My Theme (dark) v2"), "my-theme-dark-v2");
        assert_eq!(slug("../../etc/passwd"), "etc-passwd");
        assert_eq!(slug("✠✠✠"), "theme");
        assert_eq!(slug(&"a".repeat(60)).len(), 40);
        for s in [
            "vespertine",
            "my-theme-dark-v2",
            "etc-passwd",
            "theme",
            "_default",
        ] {
            assert!(is_slug(s));
        }
    }

    #[test]
    fn rejects_names_that_could_leave_the_folder() {
        for bad in [
            "",
            "_",
            "__x",
            "_../x",
            "../x",
            "a/b",
            "A",
            "x.css",
            "a b",
            &"a".repeat(41),
        ] {
            assert!(!is_slug(bad), "{bad}");
        }
    }
}
