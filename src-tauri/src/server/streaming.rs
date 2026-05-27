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

/// Get a unique path for a temporary ZIP archive and clean up old ones.
pub fn get_temp_zip_path(prefix: &str) -> std::path::PathBuf {
    let temp_dir = std::env::temp_dir().join("shairee_temp_zips");
    let _ = std::fs::create_dir_all(&temp_dir);

    // Clean up old files (> 30 minutes)
    if let Ok(entries) = std::fs::read_dir(&temp_dir) {
        let now = std::time::SystemTime::now();
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if let Ok(modified) = metadata.modified() {
                    if let Ok(duration) = now.duration_since(modified) {
                        if duration.as_secs() > 1800 { // 30 minutes
                            let _ = std::fs::remove_file(entry.path());
                        }
                    }
                }
            }
        }
    }

    let uuid_str = uuid::Uuid::new_v4().to_string();
    temp_dir.join(format!("{}_{}.zip", prefix, uuid_str))
}

/// Create a ZIP archive on-the-fly from a directory and write directly to disk.
/// Uses streaming write to keep memory usage low.
/// Returns error if directory is empty.
pub fn create_zip_from_directory(
    dir_path: &Path,
    dir_name: &str,
    output_path: &Path,
) -> Result<(), String> {
    use std::io::{Read, Write};
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    // Check if directory is accessible and not empty
    let entries: Vec<_> = std::fs::read_dir(dir_path)
        .map_err(|e| format!("Cannot read directory {}: {e}", dir_path.display()))?
        .filter_map(|e| e.ok())
        .collect();
    
    if entries.is_empty() {
        return Err(format!("Cannot create ZIP from empty directory: {}", dir_path.display()));
    }

    let file = std::fs::File::create(output_path)
        .map_err(|e| format!("Cannot create temp zip file: {e}"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let walker = walkdir::WalkDir::new(dir_path)
        .into_iter()
        .filter_map(|e| {
            e.ok().or_else(|| {
                log::debug!("Skipping inaccessible entry during ZIP creation");
                None
            })
        });

    let mut file_count = 0;
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
            file_count += 1;
        } else if path.is_dir() && path != dir_path {
            zip.add_directory(&archive_path, options)
                .map_err(|e| format!("ZIP add_directory error: {e}"))?;
        }
    }

    // Final check: ensure we actually added some files
    if file_count == 0 {
        return Err("Directory contains no files to archive".into());
    }

    zip.finish()
        .map_err(|e| format!("ZIP finish error: {e}"))?;
    Ok(())
}

/// Create a ZIP archive from multiple files directly to disk, with deduplication and length limits.
pub fn create_zip_from_files(
    files: &[(String, std::path::PathBuf)],
    output_path: &Path,
) -> Result<(), String> {
    use std::io::{Read, Write};
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    let file = std::fs::File::create(output_path)
        .map_err(|e| format!("Cannot create temp zip file: {e}"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let mut added_names = std::collections::HashSet::new();
    const MAX_ZIP_FILENAME_LEN: usize = 200; // Leave room for deduplication suffix

    for (name, path) in files {
        let mut unique_name = name.clone();
        let mut count = 1;

        // Deduplicate name at the root of the ZIP
        while added_names.contains(&unique_name) {
            let path_obj = std::path::Path::new(name);
            let stem = path_obj.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
            let ext = path_obj.extension().and_then(|e| e.to_str()).map(|e| format!(".{}", e)).unwrap_or_default();
            unique_name = format!("{} ({}){}", stem, count, ext);
            count += 1;
            
            // Prevent infinite loops - stop if we exceed reasonable deduplication attempts
            if count > 1000 {
                return Err(format!("Cannot deduplicate filename (too many duplicates): {}", name));
            }
        }
        
        // Check if final name exceeds ZIP filename limits
        if unique_name.len() > MAX_ZIP_FILENAME_LEN {
            log::warn!("ZIP entry name too long ({} > {} bytes), truncating: {}", 
                       unique_name.len(), MAX_ZIP_FILENAME_LEN, unique_name);
            unique_name.truncate(MAX_ZIP_FILENAME_LEN);
        }
        
        added_names.insert(unique_name.clone());

        if path.is_file() {
            zip.start_file(&unique_name, options)
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
                .filter_map(|e| {
                    e.ok().or_else(|| {
                        log::debug!("Skipping inaccessible entry in ZIP");
                        None
                    })
                });
            
            for entry in walker {
                let epath = entry.path();
                let relative = epath.strip_prefix(path).unwrap_or(epath);
                let archive_path = format!(
                    "{}/{}",
                    unique_name,
                    relative.to_string_lossy().replace('\\', "/")
                );
                
                // Skip extremely long paths
                if archive_path.len() > MAX_ZIP_FILENAME_LEN {
                    log::warn!("Skipping ZIP entry with path too long: {}", archive_path);
                    continue;
                }
                
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
    Ok(())
}
