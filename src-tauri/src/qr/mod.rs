// src-tauri/src/qr/mod.rs
// QR code generation for server URL.

use base64::Engine;
use image::Luma;
use qrcode::QrCode;

/// Generate a QR code for the given URL and return it as a base64 data URI (PNG).
/// Validates URL length to prevent excessive QR code generation.
pub fn generate_qr_data_uri(url: &str) -> Result<String, String> {
    // Validate URL length - QR code has limits based on version
    // Version 40 (largest) can encode ~2953 alphanumeric characters
    const MAX_QR_URL_LENGTH: usize = 2900;
    const MAX_PNG_SIZE_BYTES: usize = 1024 * 1024; // 1 MB limit for PNG output
    
    if url.is_empty() {
        return Err("URL cannot be empty".into());
    }
    
    if url.len() > MAX_QR_URL_LENGTH {
        return Err(format!(
            "URL too long for QR code: {} chars (max: {})",
            url.len(),
            MAX_QR_URL_LENGTH
        ));
    }

    // Create QR code
    let code = QrCode::new(url.as_bytes())
        .map_err(|e| format!("QR generation failed: {e}"))?;

    // Render to an image buffer
    let image = code.render::<Luma<u8>>()
        .quiet_zone(true)
        .min_dimensions(256, 256)
        .build();

    // Encode as PNG to a byte buffer
    let mut png_bytes: Vec<u8> = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png_bytes);
    image::DynamicImage::ImageLuma8(image)
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| format!("PNG encoding failed: {e}"))?;

    // Validate PNG size to prevent memory exhaustion
    if png_bytes.len() > MAX_PNG_SIZE_BYTES {
        return Err(format!(
            "Generated QR code PNG too large: {} bytes (max: {})",
            png_bytes.len(),
            MAX_PNG_SIZE_BYTES
        ));
    }

    // Base64 encode
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    let data_uri = format!("data:image/png;base64,{b64}");

    Ok(data_uri)
}
