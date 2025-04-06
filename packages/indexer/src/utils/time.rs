/// Utility functions for time-related operations

/// Format a duration in seconds to a human-readable string
/// For example, 65 seconds becomes "1m 5s"
pub fn format_duration(seconds: f64) -> String {
    let seconds = seconds as u64;
    
    if seconds < 60 {
        return format!("{}s", seconds);
    }
    
    let minutes = seconds / 60;
    let seconds = seconds % 60;
    
    if minutes < 60 {
        return format!("{}m {}s", minutes, seconds);
    }
    
    let hours = minutes / 60;
    let minutes = minutes % 60;
    
    if hours < 24 {
        return format!("{}h {}m {}s", hours, minutes, seconds);
    }
    
    let days = hours / 24;
    let hours = hours % 24;
    
    format!("{}d {}h {}m {}s", days, hours, minutes, seconds)
}

/// Format blocks per second rate with appropriate unit scaling
/// If rate is very high, converts to blocks per minute or hour
pub fn format_rate(blocks_per_second: f64) -> String {
    if blocks_per_second < 0.01 {
        // Less than 0.01 blocks per second, show as blocks per hour
        let blocks_per_hour = blocks_per_second * 3600.0;
        return format!("{:.2} blocks/hour", blocks_per_hour);
    } else if blocks_per_second < 1.0 {
        // Less than 1 block per second, show as blocks per minute
        let blocks_per_minute = blocks_per_second * 60.0;
        return format!("{:.2} blocks/min", blocks_per_minute);
    } else {
        // 1 or more blocks per second
        return format!("{:.2} blocks/sec", blocks_per_second);
    }
}