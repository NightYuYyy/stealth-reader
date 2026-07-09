mod reader;
mod state;
mod tray;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
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

            // System tray menu
            let show_item = MenuItemBuilder::with_id("show", "显示/隐藏").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;

            // System tray icon
            let tray_handle = handle.clone();
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .tooltip("Stealth Reader")
                .menu(&tray_menu)
                .on_menu_event(move |app_handle, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let visible = window.is_visible().unwrap_or(true);
                                if visible {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                        "quit" => {
                            // Save state before quit
                            let app_data = get_app_data_dir(app_handle);
                            if let Some(ctx) = app_handle.try_state::<tray::AppCtx>() {
                                let state = ctx.state.lock().unwrap().clone();
                                let _ = state::save_state(&app_data, &state);
                            }
                            app_handle.exit(0);
                        }
                        _ => {}
                    }
                })
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
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Save state
                    let app_handle = window.app_handle();
                    let app_data = get_app_data_dir(&app_handle);
                    if let Some(ctx) = app_handle.try_state::<tray::AppCtx>() {
                        let state = ctx.state.lock().unwrap().clone();
                        let _ = state::save_state(&app_data, &state);
                    }
                    // Hide window instead of closing, keep running in tray
                    api.prevent_close();
                    let _ = window.hide();
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running stealth-reader");
}
