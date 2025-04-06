FROM rust:1.81-slim as builder

WORKDIR /usr/src/app

# Install dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    libpq-dev \
    gcc \
    g++ \
    libc6-dev \
    git \
    ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy Cargo files
COPY Cargo.toml Cargo.lock ./

# Create a dummy main.rs to build dependencies
RUN mkdir -p src && \
    echo "fn main() {}" > src/main.rs && \
    cargo build --release && \
    rm -f target/release/deps/indexer* src/main.rs

# Copy the actual source code
COPY src ./src

# Build the application (only indexer binary)
RUN cargo build --release --bin indexer

# Runtime stage
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libpq5 \
    ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the binary from the builder stage
COPY --from=builder /usr/src/app/target/release/indexer /app/indexer

# Set environment variables
ENV RUST_LOG=info

# Run the application
CMD ["./indexer"]