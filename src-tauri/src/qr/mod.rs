


use base64::Engine;
use image::Luma;
use qrcode::QrCode;



pub fn generate_qr_data_uri(url: &str) -> Result<String, String> {
    
    
    const MAX_QR_URL_LENGTH: usize = 2900;
    const MAX_PNG_SIZE_BYTES: usize = 1024 * 1024; 
    
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

    
    let code = QrCode::new(url.as_bytes())
        .map_err(|e| format!("QR generation failed: {e}"))?;

    
    let image = code.render::<Luma<u8>>()
        .quiet_zone(true)
        .min_dimensions(256, 256)
        .build();

    
    let mut png_bytes: Vec<u8> = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png_bytes);
    image::DynamicImage::ImageLuma8(image)
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| format!("PNG encoding failed: {e}"))?;

    
    if png_bytes.len() > MAX_PNG_SIZE_BYTES {
        return Err(format!(
            "Generated QR code PNG too large: {} bytes (max: {})",
            png_bytes.len(),
            MAX_PNG_SIZE_BYTES
        ));
    }

    
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    let data_uri = format!("data:image/png;base64,{b64}");

    Ok(data_uri)
}
