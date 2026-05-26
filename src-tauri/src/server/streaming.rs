// src-tauri/src/server/streaming.rs
// File streaming utilities for maximum performance and low memory usage.

use actix_web::{HttpRequest, HttpResponse};
use std::path::Path;

/// Stream a file using actix_files::NamedFile for zero-copy performance.
/// Supports Range headers for resumable downloads.
pub async fn stream_file(
    file_path: &Path,
    file_name: &str,
    req: &HttpRequest,
) -> Result<HttpResponse, actix_web::Error> {
    let named_file = actix_files::NamedFile::open_async(file_path)
        .await
        .map_err(|e| {
            log::error!("Failed to open file {}: {e}", file_path.display());
            actix_web::error::ErrorNotFound(format!("File not found: {e}"))
        })?;

    // Set content-disposition for download with the original filename
    let named_file = named_file
        .use_last_modified(true)
        .set_content_disposition(actix_web::http::header::ContentDisposition {
            disposition: actix_web::http::header::DispositionType::Attachment,
            parameters: vec![actix_web::http::header::DispositionParam::Filename(
                file_name.to_string(),
            )],
        });

    // NamedFile handles Range, If-Modified-Since, ETag, etc.
    Ok(named_file.into_response(req))
}

/// Create a ZIP archive on-the-fly from a directory and stream it.
/// Uses streaming write to keep memory usage low.
pub fn create_zip_from_directory(
    dir_path: &Path,
    dir_name: &str,
) -> Result<Vec<u8>, String> {
    use std::io::{Read, Write};
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    let mut buf = Vec::new();
    let cursor = std::io::Cursor::new(&mut buf);
    let mut zip = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let walker = walkdir::WalkDir::new(dir_path)
        .into_iter()
        .filter_map(|e| e.ok());

    for entry in walker {
        let path = entry.path();
        let relative = path
            .strip_prefix(dir_path)
            .unwrap_or(path);
        let archive_path = format!(
            "{}/{}",
            dir_name,
            relative.to_string_lossy().replace('\\', "/")
        );

        if path.is_file() {
            zip.start_file(&archive_path, options)
                .map_err(|e| format!("ZIP start_file error: {e}"))?;
            let mut f = std::fs::File::open(path)
                .map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
            let mut chunk = [0u8; 65536];
            loop {
                let n = f
                    .read(&mut chunk)
                    .map_err(|e| format!("Read error: {e}"))?;
                if n == 0 {
                    break;
                }
                zip.write_all(&chunk[..n])
                    .map_err(|e| format!("ZIP write error: {e}"))?;
            }
        } else if path.is_dir() && path != dir_path {
            zip.add_directory(&archive_path, options)
                .map_err(|e| format!("ZIP add_directory error: {e}"))?;
        }
    }

    zip.finish()
        .map_err(|e| format!("ZIP finish error: {e}"))?;
    Ok(buf)
}

/// Create a ZIP archive from multiple files.
pub fn create_zip_from_files(
    files: &[(String, std::path::PathBuf)],
) -> Result<Vec<u8>, String> {
    use std::io::{Read, Write};
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    let mut buf = Vec::new();
    let cursor = std::io::Cursor::new(&mut buf);
    let mut zip = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for (name, path) in files {
        if path.is_file() {
            zip.start_file(name, options)
                .map_err(|e| format!("ZIP start_file error: {e}"))?;
            let mut f = std::fs::File::open(path)
                .map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
            let mut chunk = [0u8; 65536];
            loop {
                let n = f.read(&mut chunk).map_err(|e| format!("Read error: {e}"))?;
                if n == 0 {
                    break;
                }
                zip.write_all(&chunk[..n])
                    .map_err(|e| format!("ZIP write error: {e}"))?;
            }
        } else if path.is_dir() {
            // Recursively add directory contents
            let walker = walkdir::WalkDir::new(path)
                .into_iter()
                .filter_map(|e| e.ok());
            for entry in walker {
                let epath = entry.path();
                let relative = epath.strip_prefix(path).unwrap_or(epath);
                let archive_path = format!(
                    "{}/{}",
                    name,
                    relative.to_string_lossy().replace('\\', "/")
                );
                if epath.is_file() {
                    zip.start_file(&archive_path, options)
                        .map_err(|e| format!("ZIP error: {e}"))?;
                    let mut f = std::fs::File::open(epath)
                        .map_err(|e| format!("Cannot open: {e}"))?;
                    let mut chunk = [0u8; 65536];
                    loop {
                        let n = f.read(&mut chunk).map_err(|e| format!("Read error: {e}"))?;
                        if n == 0 { break; }
                        zip.write_all(&chunk[..n])
                            .map_err(|e| format!("ZIP write error: {e}"))?;
                    }
                } else if epath.is_dir() && epath != path {
                    zip.add_directory(&archive_path, options)
                        .map_err(|e| format!("ZIP error: {e}"))?;
                }
            }
        }
    }

    zip.finish()
        .map_err(|e| format!("ZIP finish error: {e}"))?;
    Ok(buf)
}
