# Use Node.js 20 Alpine for smaller image size
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/ponder/package*.json ./packages/ponder/

# Install dependencies
RUN npm ci --only=production

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY package*.json ./
COPY packages/ponder/package*.json ./packages/ponder/
RUN npm ci

# Copy source code
COPY packages/ponder ./packages/ponder

# Generate types
WORKDIR /app/packages/ponder
RUN npm run codegen

# Production image
FROM base AS runner
WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 ponder

# Copy necessary files
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/ponder/node_modules ./packages/ponder/node_modules
COPY --from=builder /app/packages/ponder ./packages/ponder

# Set user
USER ponder

# Expose port for GraphQL API
EXPOSE 42069

# Set working directory
WORKDIR /app/packages/ponder

# Start Ponder in production mode
CMD ["npm", "run", "start"]