# research-notes

**An AI-operated literature-notes system on Zotero, git, and plain markdown.**

You save a paper in your browser. An agent turns it into a durable, factual note,
files it into a topic map, and keeps the index consistent. You review the diff —
and spend your own reading time only where it pays.

<!-- TODO(release): asciinema GIF here — Connector save → /sync → reviewed note -->

## Why this exists

Most LLM-assisted paper reading produces summaries that are thrown away, trusted
too much, or rot inside one project's notes. research-notes is built on three
design decisions that fix that:

1. **An explicit depth ladder.** Every note declares how deeply the paper has
   been engaged with — `metadata → abstract → sections → full` — so you always
   know how much to trust it, and you pay reading cost only when a paper earns
   it. Going deeper is a deliberate, recorded act, not a default.
2. **Facts and judgments live apart.** Paper notes contain only
   frame-independent facts: what the paper contributes, claims, and shows.
   "Is this relevant to *my* project?" lives in that project's repo, which links
   here by citekey. One correction here fixes every project at once, and notes
   stay reusable forever.
3. **Agent-operated, plain-markdown, git-native.** The workflows are agent
   commands (Claude Code and Codex), the storage is markdown files, the audit
   log is git history. No database, no app lock-in — grep, Obsidian, and GitHub
   all work on it natively.

Zotero (with Better BibTeX) stays the capture and PDF layer — its browser
Connector and pinned citekeys are the entry point, and the citekey is the join
key across Zotero, this repo, `.bib` files, and project repos. No PDFs are
stored here.

## How it works

```
browser ──Zotero Connector──▶ Zotero collection ("to-note")
                                    │  /sync  (discovery + note authoring)
                                    ▼
                        papers/<citekey>.md   ← one factual note per paper
                                    │  /propose (+ apply), /topic, /survey
                                    ▼
                        topics/<topic>.md     ← synthesis maps ([[citekey]] links)
                                    │
                                    ▼
                        INDEX.md + catalog.json  ← generated, never hand-edited
```

## Quickstart

**[docs/quickstart.md](docs/quickstart.md)** — from zero to your first note in
about 15 minutes. The short version:

1. Install Zotero 7 + Better BibTeX; use this template; `npm install`.
2. Click the Zotero Connector on a paper page; save into the `to-note`
   collection.
3. Run `/sync` in Claude Code — a factual note appears in `papers/`, the index
   regenerates.
4. Review the diff; commit.

Full setup detail (Zotero settings, citekey pinning, Codex mirror,
troubleshooting): **[docs/setup.md](docs/setup.md)**.

## Workflows

| Command | What it does |
|---|---|
| `/sync [batch]` | Discover un-noted papers in the watched Zotero collection and author notes for them, ~15 per run (born `topics: []`) |
| `/add <citekey/DOI/arXiv URL> [topic]` | Create one note by hand, regenerate the index; placement only if a topic is named explicitly |
| `/deepen <citekey> [sections...]` | Upgrade a note one depth rung, reading only the minimum sections needed |
| `/topic <name>` | Create or update a topic map (idempotent); membership derived strictly from `topics:` frontmatter |
| `/propose [topic]` | Write a reviewable placement proposal (`scratch/propose-<date>.md`) for un-placed papers; decides nothing |
| `/propose apply <report>` | Apply exactly the checked items from a `/propose` report |
| `/survey <topic>` | Draft a survey to a scratch file, flagging claims that rest on `metadata`-depth notes |
| `/link <citekey>` | Print the note's GitHub URL + one-line Contribution for pasting into a project repo |
| `/doctor` | Check repo invariants; explain and repair drift in generated files |

The same workflows exist as Codex prompts in `.codex/prompts/` (see
[docs/setup.md](docs/setup.md) for installation). Claude Code is the first-class
runtime; the Codex mirror is maintained best-effort.

## Status and roadmap

| Stage | State |
|---|---|
| Core workflows (`add`, `deepen`, `topic`, `survey`, `link`) | ✅ working, dogfooded |
| `/sync` (Zotero watched collection → notes), `doctor`, generated catalog/index | ✅ shipped, tested (`npm test`) |
| `propose` → apply loop (placement proposals; idempotent `topic`; `sync`/`add` never place) | ✅ shipped — `propose-scan`'s candidate detection is unit-tested (`npm test`); `topic` and `propose apply` are agent workflows, verified via manual dogfooding — [specs/propose.md](specs/propose.md), [specs/propose-scan.md](specs/propose-scan.md), [specs/topic.md](specs/topic.md), [specs/sync-placement.md](specs/sync-placement.md) |
| GitHub-issue survey trigger | 🗺 specced — [specs/survey-issue.md](specs/survey-issue.md) |
| Scheduled `/sync` (Zotero Web API + GitHub Actions) | 🗺 specced — [specs/sync-scheduled.md](specs/sync-scheduled.md) |
| Issue-triggered `propose` loop | 🗺 specced — [specs/propose-issue.md](specs/propose-issue.md) — gated on local `propose` surviving dogfooding |
| Embeddings/RAG | ❌ deliberately out of scope — grep + the catalog scale to ~1–2k notes |

## Documentation

- [docs/quickstart.md](docs/quickstart.md) — first note in ~15 minutes
- [docs/setup.md](docs/setup.md) — Zotero, Better BibTeX, and runtime setup in
  full
- [docs/obsidian.md](docs/obsidian.md) — using the repo as an Obsidian vault
  (graph view, Dataview queries) — optional, zero repo modifications
- [specs/](specs/) — implementation specs, shipped and planned
- [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md) — agent operating manuals

## Design rules (the short list)

- One markdown note per engaged-with paper, named by its pinned Better BibTeX
  citekey; frontmatter is the only authoritative metadata.
- Default engagement is `abstract`; `sections` requires a recorded reason;
  `full` should be rare enough to be an event.
- Paper notes: facts only. Judgments live in project repos that link here.
- `INDEX.md` and `catalog.json` are generated — never hand-edit; run
  `node scripts/build-catalog.js`.
- No PDFs in the repo, ever. Zotero owns capture, PDFs, and annotations.
- Sync never writes to Zotero; repo state is the source of truth.
- Obsidian is a lens, never a dependency: the repo must stay fully functional as
  plain markdown.
