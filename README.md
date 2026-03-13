<p align="center">
    <img src=".github/costrict-manager.png" alt="CoStrict Manager" width="600" style="border: none" />
</p>

<p align="center">
    <strong>Mobile-first web interface for <a href="https://costrict.ai">CoStrict</a> AI agents</strong>
</p>

<p align="center">
  <img src="docs/images/ocmgr-demo.gif" alt="CoStrict Manager Demo" height="400" />
  <img src="https://github.com/user-attachments/assets/c8087451-8b97-4178-952b-b8149f5c258a" alt="Git Commit Demo" height="400" />
</p>

---

<p align="center">
  <strong>English</strong> | <a href="README_zh.md">中文</a>
</p>

---

## Overview

CoStrict Manager is a modern AI agent management platform with a mobile-first web interface. Manage, control, and code with AI agents from any device.

## Tech Stack

### Backend
- **Runtime**: [Bun](https://bun.sh/) - High-performance JavaScript runtime
- **Framework**: [Hono](https://hono.dev/) - Lightweight, ultrafast web framework
- **Database**: Better SQLite3
- **Validation**: Zod
- **Auth**: Better Auth

### Frontend
- **Framework**: React 19 + TypeScript
- **Build Tool**: Vite 7
- **UI Components**: Radix UI + Tailwind CSS
- **State Management**: React Query (@tanstack/react-query) + Zustand
- **Forms**: React Hook Form + Zod
- **Code Editor**: Monaco Editor
- **Markdown**: React Markdown + Mermaid

### Monorepo Architecture
- **Package Manager**: pnpm (Workspace)
- **Project Structure**:
  - `backend/` - Backend API service
  - `frontend/` - Frontend web application
  - `packages/` - Shared packages
  - `shared/` - Shared type definitions

## Quick Start

### Prerequisites

- Node.js >= 18
- pnpm >= 10.28.1
- Bun >= 1.0

### Docker Deployment (Recommended)

```bash
# Clone repository
git clone https://github.com/y574444354/costrict-manager.git
cd costrict-manager

# Copy environment config
cp .env.example .env

# Start services
docker-compose up -d

# Access the application
# Open http://localhost:5003
```

On first launch, you'll be prompted to create an admin account.

### Local Development

```bash
# Install dependencies
pnpm install

# Copy environment config
cp .env.example .env

# Start development servers (frontend + backend)
pnpm dev

# Or start separately
pnpm dev:backend   # Backend: http://localhost:5003
pnpm dev:frontend  # Frontend: http://localhost:5173
```

## Project Structure

```
costrict-manager/
├── backend/              # Backend service
│   ├── src/             # Source code
│   └── tests/           # Test files
├── frontend/            # Frontend application
│   ├── src/            # Source code
│   │   ├── components/ # React components
│   │   ├── pages/      # Pages
│   │   ├── hooks/      # Custom hooks
│   │   └── lib/        # Utilities
│   └── public/         # Static assets
├── packages/            # Monorepo packages
│   └── memory/         # Memory management module
├── shared/             # Shared type definitions
├── scripts/            # Build and deployment scripts
└── docs/               # Documentation
```

## Development Guide

### Common Commands

```bash
# Development
pnpm dev              # Start frontend & backend dev servers
pnpm dev:backend      # Start backend only
pnpm dev:frontend     # Start frontend only

# Build
pnpm build            # Build all modules
pnpm build:backend    # Build backend
pnpm build:frontend   # Build frontend

# Testing
pnpm test             # Run backend tests
cd backend && bun test <filename>  # Run single test file
cd backend && vitest --ui          # Test UI interface
cd backend && vitest --coverage    # Coverage report (80% threshold)

# Code Quality
pnpm lint             # Lint frontend & backend
pnpm lint:backend     # Lint backend only
pnpm lint:frontend    # Lint frontend only
pnpm typecheck        # TypeScript type checking

# Docker
pnpm docker:build     # Build Docker image
pnpm docker:up        # Start containers
pnpm docker:down      # Stop containers
pnpm docker:logs      # View logs
```

### Code Standards

- **No Comments**: Self-documenting code only
- **No console.log**: Use Bun's logger or proper error handling
- **Strict TypeScript**: Proper typing required everywhere
- **Named Imports**: Use named imports only, e.g., `import { Hono } from 'hono'`
- **DRY Principle**: Don't repeat yourself
- **SOLID Principles**: Follow object-oriented design principles
- **YAGNI Principle**: Don't keep code you don't need

### Backend Standards

- Use Hono framework with Zod validation and Better SQLite3
- Error handling with try/catch and structured logging
- Follow existing route/service/utility structure
- Use async/await consistently, avoid .then() chains
- Test coverage requirement: minimum 80%

### Frontend Standards

- Use `@/` alias for imports: `import { Button } from '@/components/ui/button'`
- UI Components: Radix UI + Tailwind CSS
- Form handling: React Hook Form + Zod
- State management: React Query
- Use React hooks properly, no direct state mutations

## Features

### Core Features

- **Git** — Multi-repo support, SSH authentication, worktrees, unified diffs with line numbers, PR creation
- **Files** — Directory browser with tree view, syntax highlighting, create/rename/delete, ZIP download
- **Chat** — Real-time streaming (SSE), slash commands, `@file` mentions, Plan/Build modes, Mermaid diagrams
- **Audio** — Text-to-speech (browser + OpenAI-compatible), speech-to-text
- **AI** — Model selection, provider config, OAuth for Anthropic/GitHub Copilot, custom agents with system prompts
- **MCP** — Local and remote MCP server support with pre-built templates
- **Memory** — Persistent project knowledge with semantic search and compaction awareness

### Mobile Optimization

- Responsive UI design
- PWA installable
- iOS optimized (keyboard handling, swipe navigation)
- Mobile-friendly interface

## Configuration

### Environment Variables

```bash
# Required for production
AUTH_SECRET=your-secure-random-secret  # Generate with: openssl rand -base64 32

# Pre-configured admin (optional)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-secure-password

# For LAN/remote access
AUTH_TRUSTED_ORIGINS=http://localhost:5003,https://yourdomain.com
AUTH_SECURE_COOKIES=false  # Set to true when using HTTPS

# Service ports (default config)
BACKEND_PORT=5003    # Backend API port
FRONTEND_PORT=5173   # Frontend dev server port
```

### Docker Configuration

The project includes complete Docker support:

- `Dockerfile` - Multi-stage build image
- `docker-compose.yml` - Container orchestration
- `.dockerignore` - Build exclusion config

## Screenshots

<table>
<tr>
<td align="center"><strong>Chat (Mobile)</strong><br/><img src="https://github.com/user-attachments/assets/a48cc728-e540-4247-879a-c5f36c3fd6de" alt="chat-mobile" width="200" /></td>
<td align="center"><strong>File Browser (Mobile)</strong><br/><img src="https://github.com/user-attachments/assets/24243e5e-ab02-44ff-a719-263f61c3178b" alt="files-mobile" width="200" /></td>
<td align="center"><strong>Inline Diff View</strong><br/><img src="https://github.com/user-attachments/assets/b94c0ca0-d960-4888-8a25-a31ed6d5068d" alt="inline-diff-view" width="300" /></td>
</tr>
</table>

## Contributing

Contributions are welcome! Please check [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

[MIT License](LICENSE)

---

## 🔗 Links

- **Documentation**: [https://chriswritescode-dev.github.io/costrict-manager/](https://chriswritescode-dev.github.io/costrict-manager/)
- **CoStrict Official**: [https://costrict.ai](https://costrict.ai)
- **Report Issues**: [GitHub Issues](https://github.com/y574444354/costrict-manager/issues)

---

<p align="center">
  Made with ❤️ by the CoStrict Team
</p>
