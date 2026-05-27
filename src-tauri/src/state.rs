use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowState {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub always_on_top: bool,
    pub disguise_mode: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            width: 320.0,
            height: 400.0,
            always_on_top: true,
            disguise_mode: false,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReaderSettings {
    pub font_size: u32,
    pub line_height: f64,
    pub theme: String,
}

impl Default for ReaderSettings {
    fn default() -> Self {
        Self {
            font_size: 14,
            line_height: 1.8,
            theme: "dark".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BookState {
    pub position: usize,
    pub encoding: String,
    pub last_opened: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TabState {
    pub open_files: Vec<String>,
    pub active_index: usize,
}

impl Default for TabState {
    fn default() -> Self {
        Self {
            open_files: Vec::new(),
            active_index: 0,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppState {
    #[serde(default)]
    pub window: WindowState,
    #[serde(default)]
    pub reader: ReaderSettings,
    #[serde(default)]
    pub recent_files: Vec<String>,
    #[serde(default)]
    pub books: HashMap<String, BookState>,
    #[serde(default)]
    pub tabs: TabState,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            window: WindowState::default(),
            reader: ReaderSettings::default(),
            recent_files: Vec::new(),
            books: HashMap::new(),
            tabs: TabState::default(),
        }
    }
}

fn state_path(app_data: &PathBuf) -> PathBuf {
    app_data.join("state.json")
}

pub fn load_state(app_data: &PathBuf) -> AppState {
    let path = state_path(app_data);
    match fs::read_to_string(&path) {
        Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
        Err(_) => AppState::default(),
    }
}

pub fn save_state(app_data: &PathBuf, state: &AppState) -> Result<(), String> {
    let path = state_path(app_data);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn add_recent_file(state: &mut AppState, file_path: &str) {
    state.recent_files.retain(|f| f != file_path);
    state.recent_files.insert(0, file_path.to_string());
    if state.recent_files.len() > 20 {
        state.recent_files.truncate(20);
    }
}
