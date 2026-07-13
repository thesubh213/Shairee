


use thiserror::Error;


#[derive(Debug, Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Server error: {0}")]
    Server(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Network error: {0}")]
    Network(String),

    #[error("File error: {0}")]
    File(String),

    #[error("QR generation error: {0}")]
    Qr(String),

    #[error("Security error: {0}")]
    Security(String),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Path traversal attack detected: {0}")]
    PathTraversal(String),

    #[error("File not found: {0}")]
    NotFound(String),

    #[error("Server is already running")]
    ServerAlreadyRunning,

    #[error("Server is not running")]
    ServerNotRunning,

    #[error("Zip error: {0}")]
    Zip(String),

    #[error("{0}")]
    Other(String),
}

impl From<AppError> for String {
    fn from(err: AppError) -> String {
        err.to_string()
    }
}

impl From<zip::result::ZipError> for AppError {
    fn from(err: zip::result::ZipError) -> Self {
        AppError::Zip(err.to_string())
    }
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}


pub type AppResult<T> = Result<T, AppError>;
