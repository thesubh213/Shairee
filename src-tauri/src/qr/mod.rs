// src-tauri/src/qr/mod.rs
// QR code generation for server URL.

use base64::Engine;
use image::Luma;
use qrcode::QrCode;

/// Generate a QR code for the given URL and return it as a base64 data URI (PNG).
pub fn generate_qr_data_uri(url: &str) -> Result<String, String> {
    // Create QR code
    let code = QrCode::new(url.as_bytes()).map_err(|e| format!("QR generation failed: {e}"))?;

    // Render to an image buffer
    let image = code.render::<Luma<u8>>().quiet_zone(true).min_dimensions(256, 256).build();

    // Encode as PNG to a byte buffer
    let mut png_bytes: Vec<u8> = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png_bytes);
    image::DynamicImage::ImageLuma8(image)
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| format!("PNG encoding failed: {e}"))?;

    // Base64 encode
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    let data_uri = format!("data:image/png;base64,{b64}");

    log::info!("Generated QR code for URL: {url} ({} bytes PNG)", png_bytes.len());
    Ok(data_uri)
}
