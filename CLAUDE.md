# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Quest Forge is a ChatGPT App built with the **Skybridge framework** (v0.27.1). It's a conversational visual novel game generator that creates interactive story experiences with AI-generated artwork using Fal AI.

## Architecture

### Two-Phase Tool System

The app uses a two-phase tool invocation pattern:

1. **`quest-forge`** (Tool 1) - Creates the narrative skeleton
   - Input: Story concept, character persona, scenes
   - Output: Game ID + AI-generated artwork (portraits + backgrounds)
   - Widget: Preview showing title, genre, synopsis, character portrait
   - Stores data in an in-memory game store with 1-hour TTL

2. **`quest-forge-game`** (Tool 2) - Adds gameplay mechanics
   - Input: Game ID + gameplay data (achievements, exit conditions per scene)
   - Output: Complete game with system prompt for the AI character
   - Widget: Interactive visual novel with dialogue choices

### Directory Structure

```
├── server/                    # Backend MCP server
│   └── src/
│       ├── index.ts           # Express server entry
│       ├── server.ts          # MCP server with tool definitions (769 lines)
│       ├── env.ts             # Environment validation (FAL_KEY required)
│       ├── middleware.ts      # MCP HTTP middleware
│       └── lib/
│           └── fal.ts         # Fal AI image generation
├── web/                       # Frontend widgets
│   └── src/
│       ├── widgets/
│       │   ├── quest-forge.tsx       # Preview widget
│       │   └── quest-forge-game.tsx  # Game widget (902 lines)
│       ├── helpers.ts         # Skybridge helper generation
│       └── index.css          # Tailwind styles
└── package.json               # Root workspace config
```

### Key Technologies

- **Backend**: Node.js, Express, TypeScript, MCP SDK, Zod, Fal AI
- **Frontend**: React 19, Vite, Tailwind CSS, Skybridge web SDK
- **Package Manager**: PNPM with workspaces
- **Node Version**: LTS/Jod (v22.x)

## Development Commands

```bash
# Install dependencies
pnpm install

# Development (starts server with hot reload on port 3000)
pnpm dev

# Build for production (builds web, deploys server deps, copies assets)
pnpm build

# Start production server
pnpm start

# Inspect MCP server with MCP Inspector
pnpm inspector

# Build individual packages
pnpm server:build    # Compile server TypeScript
pnpm web:build       # Build Vite frontend
```

## Environment Variables

Required in `server/.env`:
- `FAL_KEY` - Fal AI API key for image generation
- `NODE_ENV` - development/production (defaults to development)

## Code Patterns

### Widget Registration (server.ts)

Tools are registered using `McpServer.registerWidget()` with three arguments:
1. Widget name (matches widget file name)
2. Widget metadata (description, CSP settings)
3. Tool definition (description, Zod schema, handler)

### Widget Implementation (web/widgets/)

Widgets use Skybridge hooks:
- `useToolInfo()` - Access tool invocation results and metadata
- `useWidgetState()` - Persist state across re-renders
- `useSendFollowUpMessage()` - Send messages to the LLM
- `useDisplayMode()` - Control widget display mode

Widgets are mounted with `mountWidget(<Component />)`.

### Type Safety

The `AppType` exported from `server.ts` is used in `web/src/helpers.ts` to generate type-safe helpers:
```typescript
export const { useToolInfo } = generateHelpers<AppType>();
```

### Achievement System

11 achievement types: empathy, inquiry, confrontation, trust_build, persuasion, deduction, emotional_support, boundary_respect, creative_solution, secret_discovery.

Each achievement has:
- `triggerIntent` - Semantic description of what player must do
- `triggerEvaluation` - Precise evaluation instruction for the LLM
- `trustChange` - Impact on character trust level
- `informationRevealed` - New info unlocked

### Scene Structure

Scenes follow a 4-act structure: setup → development → escalation → resolution.
Each scene has tensionLevel (1-10), trustLevel (1-10), mood, and exit conditions.

## Important Notes

- Game store has 1-hour TTL; games expire if not completed
- Images are generated using Fal AI's Flux model
- The system prompt (built in `buildSystemPrompt()`) is the core gameplay logic
- Widgets communicate with the LLM via `sendFollowUpMessage()` for in-character responses
- CSS uses a dark fantasy theme with gold (#c4a747) accents
