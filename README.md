# Astra Command Center

Astra Command Center is a Vite + React + TypeScript dashboard for simulating an AI-driven social intelligence agent. It showcases how to combine shadcn/ui primitives, Radix components, and TanStack Query to monitor creator accounts, surface anomalous posts, and propose next-step strategies in both English and Chinese.

## Features

- **Dual-language UI** with a lightweight `LangProvider` (English + Chinese) and context-driven translations for every on-screen label.
- **Command workflow** that accepts a pasted profile URL, triggers a faux agent pipeline (scraper → parser → analyzer → strategist), and visualizes progress via an animated NodeRunner timeline.
- **Live-like data table** that sorts and filters mocked posts, highlights anomalies, and opens a strategy drawer with AI-generated guidance and engagement sparkline.
- **Sidebar insights** enumerating monitored accounts and active growth alerts pulled from shared mock data.
- **Shadcn-ready UI kit**: Toaster, Sonner notifications, tooltip provider, custom buttons/inputs, and responsive hooks bundled for reuse.

## Project Structure

```
src/
├─ App.tsx              # Entry that wires React Query, LangProvider, tooltips, routers
├─ main.tsx             # Vite bootstrap
├─ pages/
│  ├─ Index.tsx         # Primary dashboard experience
│  └─ NotFound.tsx      # Catch-all route
├─ components/
│  ├─ AstraSidebar.tsx  # Monitored accounts + alerts
│  ├─ CommandBar.tsx    # Agent command input
│  ├─ NodeRunner.tsx    # Animated pipeline visualization
│  ├─ PostTable.tsx     # Sortable post list with status badges
│  ├─ StrategyDrawer.tsx# Engagement metrics + AI strategy copy
│  └─ ui/               # shadcn/ui primitives (buttons, inputs, toast, etc.)
├─ hooks/               # `useIsMobile`, `useToast`
├─ lib/
│  ├─ data.ts           # Mock posts/accounts/agent steps
│  └─ i18n.tsx          # Translation context/state
└─ img/                 # Astra brand assets
```

## Getting Started

1. Install dependencies: `npm install`
2. (Optional) Create a `.env.local` file and set `VITE_API_BASE_URL=http://localhost:8000/api` if your backend origin differs from the default. If unset, the frontend will auto-use `current_host:8000/api`.
3. Start the dev server: `npm run dev`
4. Visit `http://localhost:5173`

Run `npm run build` for production, `npm test` for unit tests, and `npm run lint` to check code quality.

## Backend API (Xiaohongshu Integration)

The dashboard now connects to a lightweight FastAPI service that normalizes scraped Xiaohongshu notes and persists them in Redis. To run it locally:

1. Ensure Redis is running (default: `redis://localhost:6379/0`).
2. Install backend dependencies (FastAPI, redis, langchain-openai, langchain-community, SQLAlchemy, passlib, python-jose, etc.) inside your Python environment (see `astramvp/backend/deps.py` imports).
3. Launch the API: `uvicorn astramvp.backend.main:app --reload --port 8000`
4. The default frontend base URL (`VITE_API_BASE_URL`) points to `http://localhost:8000/api`. Adjust via `.env.local` if needed.

Available routes:

- `GET /api/xhs/accounts` — list parsed Xiaohongshu creators (name + 小红书号) displayed on the left sidebar.
- `GET /api/xhs/accounts/{account_id}/notes` — fetch cached posts rendered on the right panel.
- `POST /api/xhs/notes/ingest` — submit a Xiaohongshu note/profile URL; the crawler parses metadata, stores it, and the UI auto-updates.
- `DELETE /api/xhs/accounts/{account_id}` — remove a creator and their cached posts.

## Multi-Agent Auto PR

This repo now includes a GitHub Action that auto-opens a PR when agent-tagged commits are detected on a non-main branch.

- Workflow file: `.github/workflows/agent-auto-pr.yml`
- PR automation script: `scripts/agent_auto_pr.py`

Commit rule (important):

- Put agent markers in commit messages using this format: `[agent:<id>]`
- Example:
  - `[agent:planner-agent] define API contract`
  - `[agent:coder-agent] implement parser`
  - `[agent:test-agent] add regression tests`

Auto-PR trigger rule:

- At least 1 `[agent:<id>]` marker is detected from commits on the branch (compared to `main`)
- If no PR exists for the head branch, the workflow creates one automatically

## Customizing the Simulation

- Tweak agent step timing constants or shared TypeScript interfaces in `src/lib/data.ts`.
- Expand `LangProvider` in `src/lib/i18n.tsx` to support more locales or tweak strategy copy.
- Wire additional data sources by extending the FastAPI router or swapping the ingest client in `src/lib/api.ts`.
- Adjust the UI theme via `tailwind.config.ts` or augment shadcn/ui tokens.

## Tooling

- **Vite 8** for dev server + bundling
- **React 18** + **TypeScript 5**
- **Tailwind CSS** with `tailwindcss-animate` and prose utilities
- **TanStack Query** for data orchestration
- **Framer Motion & Recharts** for motion/visualizations
- **Vitest + Testing Library + Playwright** for unit and e2e coverage

## License

MIT
