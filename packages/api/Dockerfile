# Build stage
FROM node:18-slim as builder

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN yarn build

# Production stage
FROM node:18-slim

WORKDIR /app

# Set environment variables
ENV NODE_ENV=production

# Install only production dependencies
COPY package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Add a healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Create an entrypoint script
RUN echo '#!/bin/sh\n\
# Start the server\n\
exec node dist/index.js\n\
' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Expose ports
EXPOSE 3001 3002

# Run the application
ENTRYPOINT ["/app/entrypoint.sh"]