# Quest Forge

An AI-powered interactive visual novel generator built as a ChatGPT App with the [Skybridge](https://skybridge.dev) framework. Players describe a story concept, and Quest Forge creates a complete 6-scene narrative experience with AI-generated artwork, dynamic puzzles, trust mechanics, and multilingual support.

[https://quest-forge-39bdea4b.alpic.live](https://quest-forge-39bdea4b.alpic.live/)

## How It Works

```
User describes a story concept
        ↓
  LLM crafts narrative skeleton
  (characters, scenes, puzzles)
        ↓
  Server generates artwork & audio
  (Fal AI portraits + backgrounds,
   ElevenLabs music, Gradium TTS)
        ↓
  Interactive visual novel launches
  (6 scenes, dialogue, puzzles,
   trust system, multiple endings)
```

1. **Story Creation** — The LLM designs characters with personalities, secrets, and voice styles, then structures a 6-scene arc with puzzles and branching exits.
2. **Asset Generation** — Portraits (txt2img or img2img from reference photos), scene backgrounds, music tracks (3 mood variations), and TTS narration are generated in parallel.
3. **Gameplay** — Players navigate scenes, build trust with NPCs, solve puzzles, and unlock secrets. Trust level (0-10) affects NPC openness, available choices, and which of 3 ending types is reached.

## Features

- **AI-Generated Artwork** — Character portraits and scene backgrounds via Fal AI (Flux model)
- **Reference Image Support** — Upload photos to guide character portrait generation (img2img)
- **Dynamic Scene Generation** — Scenes built from pre-defined narrative data without extra LLM calls
- **Puzzle System** — Fill-in-the-blank, lock codes, and riddle dialogues with themed visuals
- **Trust Mechanics** — 0-10 trust scale affecting NPC behavior, secret reveals, and story endings
- **3 Ending Types** — True ending (trust >= 9), cold ending (trust <= 3), or normal conclusion
- **Multilingual** — Full support for English, French, German, Spanish, and Portuguese
- **Procedural Audio** — Web Audio API sound effects (clicks, success chimes, failure tones, transitions)
- **Optional TTS & Music** — Narration via Gradium, instrumental tracks via ElevenLabs, stored on Cloudflare R2

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Skybridge](https://skybridge.dev) v0.27.1 (MCP-based ChatGPT App framework) |
| Backend | Node.js, Express 5, TypeScript, MCP SDK |
| Frontend | React 19, Vite 7, Tailwind CSS 4 |
| Image Gen | Fal AI (flux/dev for txt2img, flux-2/edit for img2img) |
| Validation | Zod |
| Audio (optional) | Gradium (TTS), ElevenLabs (music), Cloudflare R2 (storage) |
| Package Manager | pnpm (workspaces) |

## Project Structure

```
quest-forge/
├── server/                         # Backend MCP server
│   └── src/
│       ├── index.ts                # Express entry point (port 3000)
│       ├── server.ts               # MCP tools, game store, schemas, system prompts
│       ├── env.ts                  # Environment validation (t3-env)
│       ├── middleware.ts           # MCP HTTP transport middleware
│       └── lib/
│           ├── fal.ts              # Fal AI image generation (portraits + backgrounds)
│           └── audio.ts            # TTS, music generation, R2 uploads
├── web/                            # Frontend widgets
│   └── src/
│       ├── widgets/
│       │   ├── quest-forge-upload.tsx   # Reference image upload widget
│       │   └── quest-forge-game.tsx     # Main visual novel game engine
│       ├── helpers.ts              # Type-safe Skybridge hooks
│       ├── utils.ts                # Tailwind class merge utility
│       └── index.css               # Dark fantasy theme + animations
├── package.json                    # Root workspace config
├── pnpm-workspace.yaml             # Workspace definition
└── CLAUDE.md                       # AI assistant instructions
```

## MCP Tools

| Tool | Purpose | Called By |
|------|---------|----------|
| `quest-forge-upload` | Show reference image upload widget | LLM (before story creation) |
| `quest-forge-game` | Create story, generate all assets, launch game | LLM |
| `quest-forge-generate-scene` | Build next scene from chosen exit | Game widget |
| `quest-forge-puzzle-check` | Validate puzzle answers (with Levenshtein tolerance) | Game widget |

## Getting Started

### Prerequisites

- Node.js v22.x (LTS/Jod)
- pnpm v10+

### Installation

```bash
pnpm install
```

### Environment Variables

Create `server/.env`:

```env
# Required
FAL_KEY=your_fal_ai_key

# Optional — Audio features (game works without these)
GRADIUM_API_KEY=your_gradium_key        # TTS narration
ELEVENLABS_API_KEY=your_elevenlabs_key  # Music generation

# Optional — Cloudflare R2 (audio file storage)
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=your_bucket
R2_PUBLIC_URL=https://your-r2-domain.com
```

### Development

```bash
pnpm dev          # Start dev server with hot reload (port 3000)
```

### Production

```bash
pnpm build        # Build frontend + compile server + bundle assets
pnpm start        # Start production server
```

### Debugging

```bash
pnpm inspector    # Launch MCP Inspector for tool testing
```

## Architecture Details

### Two-Phase Tool System

The game avoids expensive LLM round-trips during scene transitions by pre-defining scene connections:

1. **Phase 1 (LLM-driven)** — `quest-forge-game` receives the full story skeleton from the LLM, including `nextScene` data embedded in each exit choice.
2. **Phase 2 (Deterministic)** — `quest-forge-generate-scene` uses the pre-defined `nextScene` data to build scenes with heuristic exit generation, requiring no additional LLM calls.

### Game Store

Games are stored in-memory with a **1-hour TTL**. A cleanup timer runs every 10 minutes to remove expired sessions.

### Puzzle Validation

- Case-insensitive and accent-insensitive comparison (NFD decomposition)
- Levenshtein distance tolerance of 1 for short answers (<=10 chars)
- Configurable max attempts (1-5, default 3)
- Failure consequences: character death (retry) or trust loss

### Scene Progression

Scenes follow a structured 6-scene arc:
- **Scenes 1-3** — Mixed exploration with varied archetypes (investigate, confront, trust, explore)
- **Scene 2 & 4** — Puzzle injected automatically
- **Scene 4** — At least one conclusion exit appears
- **Scene 5** — All exits converge toward the final scene
- **Scene 6** — Ending (no exits, narrative closure)

## License

Private project.
