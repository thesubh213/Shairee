


pub mod rate_limit;

use crate::error::{AppError, AppResult};
use std::path::Path;



pub fn sanitize_filename(name: &str) -> AppResult<String> {
    
    if name.is_empty() {
        return Err(AppError::Security("Empty filename".into()));
    }

    
    let decoded =
        percent_encoding::percent_decode_str(name).decode_utf8_lossy().to_string();

    
    let path = Path::new(&decoded);
    let filename = path
        .file_name()
        .ok_or_else(|| AppError::PathTraversal(format!("Invalid filename: {name}")))?
        .to_string_lossy()
        .to_string();

    
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err(AppError::PathTraversal(format!(
            "Path traversal detected in: {name}"
        )));
    }

    
    if filename.contains('\0') {
        return Err(AppError::Security("Null byte in filename".into()));
    }

    
    let upper = filename.to_uppercase();
    let stem = upper.split('.').next().unwrap_or("");
    const RESERVED: &[&str] = &[
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.contains(&stem) {
        return Err(AppError::Security(format!(
            "Reserved Windows filename: {filename}"
        )));
    }

    Ok(filename)
}


pub fn validate_file_id(id: &str) -> AppResult<()> {
    
    if id.len() != 36 {
        return Err(AppError::Security(format!("Invalid file ID length: {id}")));
    }
    
    if !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err(AppError::Security(format!("Invalid file ID chars: {id}")));
    }
    Ok(())
}



pub fn validate_file_exists_and_readable(path: &Path) -> AppResult<()> {
    
    std::fs::metadata(path)
        .map_err(|e| AppError::File(format!("File not accessible: {e}")))?;
    Ok(())
}


pub fn validate_path_length(path: &str) -> AppResult<()> {
    if path.len() > 250 {
        return Err(AppError::Security(format!("Path too long (>{} chars): {}", 250, path)));
    }
    Ok(())
}


pub fn validate_pin(submitted: &str, expected: &str) -> bool {
    
    if submitted.is_empty() || expected.is_empty() {
        return false;
    }
    
    
    if submitted.len() < 4 || submitted.len() > 8 {
        return false;
    }
    if !submitted.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    
    
    if submitted.len() != expected.len() {
        return false;
    }
    submitted
        .bytes()
        .zip(expected.bytes())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_normal() {
        assert_eq!(sanitize_filename("hello.txt").unwrap(), "hello.txt");
    }

    #[test]
    fn test_sanitize_traversal() {
        assert!(sanitize_filename("../etc/passwd").is_err());
        assert!(sanitize_filename("..\\windows\\system32").is_err());
    }

    #[test]
    fn test_sanitize_strips_path() {
        assert_eq!(
            sanitize_filename("C:\\Users\\test\\file.txt").unwrap(),
            "file.txt"
        );
    }

    #[test]
    fn test_validate_pin() {
        assert!(validate_pin("1234", "1234"));
        assert!(!validate_pin("1234", "5678"));
        assert!(!validate_pin("123", "1234"));
    }
}
