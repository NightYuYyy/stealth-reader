use encoding_rs::Encoding;
use std::fs;
use std::io::Read;
use std::path::Path;

/// Read a text file with automatic encoding detection.
/// Tries UTF-8 BOM → UTF-8 → GB18030 → GBK.
/// Falls back to UTF-8 lossy decode as last resort.
#[tauri::command]
pub fn read_file(path: &str, encoding_hint: Option<&str>) -> Result<String, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("File not found: {}", path));
    }

    let mut file = fs::File::open(p).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;

    // If encoding hint is provided, use it
    if let Some(hint) = encoding_hint {
        return decode_with_name(&bytes, hint);
    }

    detect_and_decode(&bytes)
}

/// Detect encoding from BOM or content sniffing
fn detect_and_decode(bytes: &[u8]) -> Result<String, String> {
    // Check UTF-8 BOM
    if bytes.len() >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF {
        return decode_with_name(&bytes[3..], "utf-8");
    }

    // Check UTF-16 LE BOM
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        return decode_utf16le(&bytes[2..]);
    }

    // Check UTF-16 BE BOM
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        return decode_utf16be(&bytes[2..]);
    }

    // Try UTF-8 first (strict, then lossy if it looks like UTF-8)
    if looks_like_utf8(bytes) {
        match std::str::from_utf8(bytes) {
            Ok(s) => return Ok(s.to_string()),
            Err(_) => {
                return Ok(String::from_utf8_lossy(bytes).to_string());
            }
        }
    }

    // Try GB18030 (superset of GBK)
    if let Ok(s) = decode_with_name(bytes, "gb18030") {
        // Check if the result looks like valid Chinese text
        if has_chinese_chars(&s) {
            return Ok(s);
        }
    }

    // Fallback: GBK
    if let Ok(s) = decode_with_name(bytes, "gbk") {
        return Ok(s);
    }

    // Last resort: UTF-8 lossy
    Ok(String::from_utf8_lossy(bytes).to_string())
}

fn decode_with_name(bytes: &[u8], name: &str) -> Result<String, String> {
    let enc = Encoding::for_label_no_replacement(name.as_bytes())
        .or_else(|| Encoding::for_label(name.as_bytes()));
    match enc {
        Some(encoding) => {
            let (text, _, had_errors) = encoding.decode(bytes);
            if had_errors {
                Err(format!("Decoding with {} produced replacement characters", name))
            } else {
                Ok(text.into_owned())
            }
        }
        None => Err(format!("Unknown encoding: {}", name)),
    }
}

fn decode_utf16le(bytes: &[u8]) -> Result<String, String> {
    let u16s: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    String::from_utf16(&u16s).map_err(|e| e.to_string())
}

fn decode_utf16be(bytes: &[u8]) -> Result<String, String> {
    let u16s: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_be_bytes([c[0], c[1]]))
        .collect();
    String::from_utf16(&u16s).map_err(|e| e.to_string())
}

/// Quick heuristic: check the first 4KB for valid UTF-8
fn looks_like_utf8(bytes: &[u8]) -> bool {
    let sample = if bytes.len() > 4096 { &bytes[..4096] } else { bytes };
    match std::str::from_utf8(sample) {
        Ok(_) => true,
        Err(e) => {
            let valid_up_to = e.valid_up_to();
            valid_up_to as f64 / sample.len() as f64 > 0.90
        }
    }
}

fn has_chinese_chars(s: &str) -> bool {
    s.chars().any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c) || ('\u{3400}'..='\u{4DBF}').contains(&c))
}

/// Get file info (size, existence) for quick checks
#[tauri::command]
pub fn get_file_info(path: &str) -> Result<FileInfo, String> {
    let p = Path::new(path);
    let metadata = p.metadata().map_err(|e| e.to_string())?;
    Ok(FileInfo {
        exists: true,
        size: metadata.len(),
        name: p.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string(),
    })
}

/// Chapter detection result
#[derive(serde::Serialize, Clone)]
pub struct Chapter {
    pub title: String,
    pub position: usize,
}

/// Detect chapters in text using common Chinese/English patterns.
/// Returns character-index positions (not byte offsets), matching JS string indices.
#[tauri::command]
pub fn detect_chapters(text: &str) -> Vec<Chapter> {
    let mut chapters = Vec::new();
    let mut char_index = 0usize;

    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(title) = match_chapter_line(trimmed) {
            chapters.push(Chapter {
                title: truncate_str(title, 50),
                position: char_index,
            });
        }
        char_index += line.chars().count() + 1; // +1 for newline
    }
    chapters
}

/// Check if a line starts with a chapter marker pattern
fn match_chapter_line(line: &str) -> Option<&str> {
    let s = line;
    // "第X章" / "第X卷" / "第X节" / "第X回" / "第X部" / "第X篇"
    if s.starts_with('第') {
        if let Some(rest) = s.strip_prefix('第') {
            // Count digits or Chinese numerals
            let end = rest.find(|c: char| !c.is_ascii_digit() && !is_chinese_numeral(c));
            if let Some(end) = end {
                let after_num = &rest[end..];
                if after_num.starts_with('章') || after_num.starts_with('卷')
                    || after_num.starts_with('节') || after_num.starts_with('回')
                    || after_num.starts_with('部') || after_num.starts_with('篇')
                {
                    return Some(s);
                }
            }
        }
    }

    // "Chapter X" / "CHAPTER X" (case insensitive)
    let lower = s.to_lowercase();
    if lower.starts_with("chapter ") {
        let rest = &s[8..];
        if rest.chars().next().map_or(false, |c| c.is_ascii_digit()) {
            return Some(s);
        }
    }

    None
}

fn is_chinese_numeral(c: char) -> bool {
    matches!(c, '零' | '一' | '二' | '三' | '四' | '五' | '六' | '七' | '八' | '九' | '十' | '百' | '千' | '万')
}

#[derive(serde::Serialize)]
pub struct FileInfo {
    pub exists: bool,
    pub size: u64,
    pub name: String,
}

/// Truncate a string to max_len chars (not bytes), appending "..." if truncated
fn truncate_str(s: &str, max_len: usize) -> String {
    if s.chars().count() <= max_len {
        return s.to_string();
    }
    let truncated: String = s.chars().take(max_len - 3).collect();
    format!("{}...", truncated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_utf8() {
        let text = "Hello, 世界!";
        let bytes = text.as_bytes();
        let result = detect_and_decode(bytes).unwrap();
        assert_eq!(result, text);
    }

    #[test]
    fn test_detect_utf8_bom() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("测试".as_bytes());
        let result = detect_and_decode(&bytes).unwrap();
        assert_eq!(result, "测试");
    }

    #[test]
    fn test_detect_empty() {
        let result = detect_and_decode(&[]).unwrap();
        assert_eq!(result, "");
    }

    #[test]
    fn test_has_chinese() {
        assert!(has_chinese_chars("你好世界"));
        assert!(!has_chinese_chars("Hello World"));
    }
}
