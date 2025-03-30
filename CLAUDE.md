# CLAUDE.md - Coding Guidelines for Shred Explorer

## Build and Test Commands
- Install: `npm install`
- Start: `cd packages/frontend && npm run dev`
- Build: `cd packages/frontend && npm run build`
- Lint: `cd packages/frontend && npm run lint`
- Test: `cd packages/frontend && npm test` (when configured)

## Code Style Guidelines
- **Structure**: Monorepo with packages directory
- **Frontend**: Next.js app in packages/frontend using TypeScript
- **Formatting**: ESLint + Prettier (configured with Next.js defaults)
- **Naming**: camelCase for variables/functions, PascalCase for components/classes
- **Imports**: Group imports (React/Next.js/external/internal/types)
- **Types**: Use TypeScript with strict type checking
- **Error Handling**: Use try/catch with specific error types
- **Functions**: Prefer pure functions, use arrow functions for components
- **Components**: One component per file, use functional components with hooks
- **Styling**: Use Tailwind CSS for styling components
- **Testing**: Write unit tests for utility functions and components

This project uses Next.js with the App Router, TypeScript, ESLint, and Tailwind CSS.