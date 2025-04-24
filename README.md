# RISE Chain Testnet: Shred Explorer

Blockchain explorer and analytics platform for tracking and visualizing RISE Testnet data.

## Project Structure

This is a monorepo project using pnpm with the following packages:

- `packages/etl`: Rust ETL process for ingesting blockchain data into PostgreSQL
- `packages/api`: Node.js API server with WebSocket for real-time updates
- `packages/frontend`: Next.js application with TypeScript and Tailwind CSS

## Getting Started

1. Clone the repository
2. Install pnpm if you don't have it already: `npm install -g pnpm`
3. Install dependencies: `pnpm install`
4. Setup your environment:
   - Create a `.env` file in the `packages/etl` directory
   - Create a `.env` file in the `packages/api` directory
5. Start the services:
   - ETL process: `pnpm dev:etl`
   - API server: `pnpm dev:api`
   - Frontend: `pnpm dev:frontend`
   - All services: `pnpm dev`

## Development Commands

### Root Commands

```bash
# Development
pnpm dev              # Run all services in development mode
pnpm dev:etl          # Run the ETL service
pnpm dev:api          # Run the API service
pnpm dev:frontend     # Run the frontend

# Building
pnpm build            # Build all packages
pnpm build:etl        # Build the ETL service
pnpm build:api        # Build the API service
pnpm build:frontend   # Build the frontend

# Running
pnpm start:etl        # Run the ETL service (production)
pnpm start:api        # Run the API service (production)
pnpm start:frontend   # Run the frontend (production)
```

### Working with Individual Packages

You can also run commands for specific packages directly:

```bash
# API package
pnpm --filter api dev
pnpm --filter api db:generate
pnpm --filter api db:studio

# Frontend package
pnpm --filter frontend dev
pnpm --filter frontend build
pnpm --filter frontend lint
```

## Technologies Used

- **ETL**: Rust, PostgreSQL, WebSockets
- **API**: Node.js, Express, Drizzle ORM, WebSockets
- **Frontend**: Next.js, TypeScript, Tailwind CSS