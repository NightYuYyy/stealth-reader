use crate::state::{AppState, TabState};
use std::sync::Mutex;
use tauri::State as TauriState;

pub struct AppCtx {
    pub state: Mutex<AppState>,
}

#[tauri::command]
pub fn get_full_state(ctx: TauriState<'_, AppCtx>) -> AppState {
    ctx.state.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_tab_state(ctx: TauriState<'_, AppCtx>, tabs: TabState) -> Result<(), String> {
    let mut state = ctx.state.lock().unwrap();
    state.tabs = tabs;
    Ok(())
}

#[tauri::command]
pub fn update_book_position(
    ctx: TauriState<'_, AppCtx>,
    file_path: String,
    position: usize,
    encoding: String,
) -> Result<(), String> {
    let mut state = ctx.state.lock().unwrap();
    state.books.insert(
        file_path.clone(),
        crate::state::BookState {
            position,
            encoding,
            last_opened: chrono_now(),
        },
    );
    crate::state::add_recent_file(&mut state, &file_path);
    Ok(())
}

#[tauri::command]
pub fn update_window_state(
    ctx: TauriState<'_, AppCtx>,
    window_state: crate::state::WindowState,
) -> Result<(), String> {
    let mut state = ctx.state.lock().unwrap();
    state.window = window_state;
    Ok(())
}

#[tauri::command]
pub fn update_reader_settings(
    ctx: TauriState<'_, AppCtx>,
    settings: crate::state::ReaderSettings,
) -> Result<(), String> {
    let mut state = ctx.state.lock().unwrap();
    state.reader = settings;
    Ok(())
}

#[tauri::command]
pub fn persist_state(app_handle: tauri::AppHandle, ctx: TauriState<'_, AppCtx>) -> Result<(), String> {
    let app_data = crate::get_app_data_dir(&app_handle);
    let state = ctx.state.lock().unwrap().clone();
    crate::state::save_state(&app_data, &state)?;
    Ok(())
}

fn chrono_now() -> String {
    use std::time::SystemTime;
    let dur = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", dur.as_secs())
}
