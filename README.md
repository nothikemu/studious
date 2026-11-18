# Studious

Study from your own sources. Add PDFs, Markdown, text or HTML, ask questions that cite the exact passage, then turn the material into flashcards, quizzes, mind maps, slide decks, tables, glossaries and notes — and review them with FSRS spaced repetition.

Everything runs in the browser; notebooks live in IndexedDB. An optional model (Anthropic or any OpenAI-compatible endpoint, bring your own key) can write the answers and Studio items; without one, the app works offline by quoting and ranking passages from your sources.

See [`docs/research-report.md`](docs/research-report.md) for the competitor research, what was verified, and what was built.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + integration tests (vitest, fake-indexeddb)
npm run build      # typecheck + production build
```

## Deploy (GitHub Pages)

```bash
npm run deploy:pages    # builds and publishes dist/ to the gh-pages branch
```

Then, once, in the GitHub repo: **Settings → Pages → Build and deployment → Deploy from a branch → `gh-pages` / `(root)`**. The site is served at `https://<owner>.github.io/<repo>/`. The app uses hash routing and relative asset URLs, so it works from that sub-path.

## Using OpenRouter (recommended for the hosted site)

Settings → **OpenRouter**: paste your key. The model defaults to `nvidia/nemotron-3-ultra-550b-a55b:free` (Nemotron 3 Ultra, free tier); to use another, copy its ID from openrouter.ai/models (free models end in `:free`). Free models are limited to roughly 20 requests/minute and 50/day until the account has bought credits, and each chat answer or study-tool build is one request. OpenRouter allows direct browser calls, so no proxy is needed. Free models can be rate-limited or return malformed JSON — Studious falls back to offline generation with a notice when that happens.

## Using NVIDIA NIM (or another model)

Settings → **NVIDIA NIM**: paste your key and the exact model ID from build.nvidia.com (the field is intentionally empty — don't guess). The call goes straight from your browser. If NVIDIA doesn't allow browser calls (CORS), Settings will say so; use the small proxy in [`docs/nvidia-proxy.md`](docs/nvidia-proxy.md) and set it as the Base URL. Your key is stored only in this browser's localStorage.

## Layout

| Path | What it holds |
|---|---|
| `src/lib/` | text/chunking, retrieval, analysis (terms, definitions), FSRS wrapper, ingestion, export |
| `src/studio/` | offline generators for the eight modules, model-backed generation, orchestration |
| `src/ai/` | grounded answering (offline + model), LLM client |
| `src/components/` | UI: library, workspace panes, reader, viewers, review, progress, search |
| `src/db.ts` | Dexie schema, backup import/export |

## Grounding contract

Every generated claim carries chunk citations. In model mode, claims without a valid citation are discarded; if nothing usable remains the item falls back to offline generation with a visible note. When the sources don't cover a question, chat says so instead of guessing.
