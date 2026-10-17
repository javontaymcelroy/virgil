#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod import;
mod themes;
mod voice;

use import::Document;
use std::path::PathBuf;
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, WindowEvent};
use tauri_plugin_dialog::DialogExt;

/// Shows the system Open panel and returns the chosen file as text, or `None` if cancelled.
/// Files are read here, in Rust, so the webview never gets general file-system access.
#[tauri::command]
async fn open_document(app: AppHandle) -> Result<Option<Document>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Open a Text")
            .add_filter("Text, Markdown, PDF or EPUB", import::EXTENSIONS)
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        import::import_path(&path).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Files dropped on the window are imported here and the result is sent to the page as
/// `import:started`, then `import:done` or `import:failed`. `import:hover` drives the drop highlight.
fn handle_drop(app: &AppHandle, paths: &[PathBuf]) {
    let Some(path) = paths.iter().find(|p| import::is_supported(p)).cloned() else {
        let _ = app.emit(
            "import:failed",
            "Virgil can open .txt, .md, .pdf and .epub files.",
        );
        return;
    };
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let _ = app.emit("import:started", name);
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || match import::import_path(&path) {
        Ok(doc) => app.emit("import:done", doc),
        Err(message) => app.emit("import:failed", message),
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol(themes::SCHEME, themes::serve)
        .invoke_handler(tauri::generate_handler![
            open_document,
            themes::list_themes,
            themes::add_theme,
            themes::save_theme,
            themes::save_override,
            themes::read_theme,
            themes::remove_theme
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::DragDrop(drag) = event {
                let app = window.app_handle();
                match drag {
                    DragDropEvent::Enter { .. } => {
                        let _ = app.emit("import:hover", true);
                    }
                    DragDropEvent::Leave => {
                        let _ = app.emit("import:hover", false);
                    }
                    DragDropEvent::Drop { paths, .. } => {
                        let _ = app.emit("import:hover", false);
                        handle_drop(app, paths);
                    }
                    _ => {}
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Virgil");
}
