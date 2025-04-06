use tracing_subscriber::{fmt, EnvFilter};

pub fn init_logger() {
    // Get log level from environment or default to info
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    fmt()
        .with_env_filter(env_filter)
        .with_file(true)
        .with_line_number(true)
        .with_target(true)
        .with_ansi(true)
        .init();
}
