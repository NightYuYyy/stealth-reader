mod reader;
mod state;
mod tray;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

pub fn get_app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let app_data = get_app_data_dir(&app.handle());
            let app_state = state::load_state(&app_data);

            app.manage(tray::AppCtx {
                state: Mutex::new(app_state),
            });

            let handle = app.handle().clone();

            // System tray icon - toggle window visibility on left click
            let tray_handle = handle.clone();
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .tooltip("Stealth Reader")
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray_handle.get_webview_window("main") {
                            let visible = window.is_visible().unwrap_or(true);
                            if visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            reader::read_file,
            reader::get_file_info,
            reader::detect_chapters,
            tray::get_full_state,
            tray::save_tab_state,
            tray::update_book_position,
            tray::update_window_state,
            tray::persist_state,
            tray::update_reader_settings,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app_handle = window.app_handle();
                let app_data = get_app_data_dir(&app_handle);
                if let Some(ctx) = app_handle.try_state::<tray::AppCtx>() {
                    let state = ctx.state.lock().unwrap().clone();
                    let _ = state::save_state(&app_data, &state);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running stealth-reader");
}
