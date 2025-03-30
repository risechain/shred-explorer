# Build stage
FROM rust:1.75 as builder

WORKDIR /app

# Copy Cargo files
COPY Cargo.toml ./

# Create a dummy main.rs to build dependencies
RUN mkdir -p src && \
    echo "fn main() { println!(\"Hello, world!\"); }" > src/main.rs && \
    cargo build --release && \
    rm -rf src

# Copy the actual source code
COPY src ./src

# Force cargo to rebuild with the actual source code
RUN touch src/main.rs && cargo build --release

# Runtime stage
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libssl-dev \
    ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy the binary from the builder stage
COPY --from=builder /app/target/release/rise-etl .

# Create a directory for the .env file
RUN mkdir -p /app/config

# Copy .env.example to config directory
COPY .env.example /app/config/

# Set the entrypoint
ENTRYPOINT ["/app/rise-etl"]