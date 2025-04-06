# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure
This is a monorepo with multiple packages. Each package has its own build commands.

## Build and Test Commands - Frontend
- Install: `npm install`
- Start: `cd packages/frontend && npm run dev`
- Build: `cd packages/frontend && npm run build`
- Lint: `cd packages/frontend && npm run lint`
- Test: `cd packages/frontend && npm test` (when configured)

## Build and Test Commands - Indexer (Rust)
- Build: `cd packages/indexer && cargo build`
- Build (optimized): `cd packages/indexer && cargo build --release`
- Run: `cd packages/indexer && cargo run`
- Test: `cd packages/indexer && cargo test`
- Run specific test: `cd packages/indexer && cargo test test_name`
- Format code: `cd packages/indexer && cargo fmt`
- Lint: `cd packages/indexer && cargo clippy`

## Frontend Code Style
- **Framework**: Next.js with App Router, TypeScript, Tailwind CSS
- **Naming**: camelCase for variables/functions, PascalCase for components/classes
- **Error Handling**: Use try/catch with specific error types

## Indexer Code Style (Rust)
- **Structure**: Modular organization with clean separation of concerns
- **Naming**: snake_case for variables/functions, PascalCase for types/structs
- **Error Handling**: Custom error types with thiserror, Result for fallible operations
- **Async**: Use async/await with tokio runtime
- **Comments**: Document public APIs with doc comments (///)