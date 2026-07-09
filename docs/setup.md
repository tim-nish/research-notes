# Setup

Full reference for getting the system running. In a hurry? Start with
[quickstart.md](quickstart.md) — it covers the happy path in ~15 minutes; this
page adds the detail and the troubleshooting.

## 1. Prerequisites

- [Zotero 7](https://www.zotero.org/download/) (desktop) + the
  [Zotero Connector](https://www.zotero.org/download/connectors) browser
  extension
- [Better BibTeX for Zotero](https://retorque.re/zotero-better-bibtex/) (BBT)
- Node.js 18+ (used by `scripts/`)
- [Claude Code](https://claude.com/claude-code) (first-class) or Codex
  (best-effort mirror)

## 2. Configure Zotero

1. **Enable the local API:** Zotero → Settings → Advanced → check
   **"Allow other applications on this computer to communicate with Zotero"**.
   `/sync` reads Zotero through this API (read-only — nothing here ever writes
   to your library).
2. **Pin citekeys with BBT:** Settings → Better BibTeX → Citation keys. Set the
   formula to produce `authYYYYfirstword`-style keys, e.g.:

   ```
   auth.lower + year + shorttitle(1,1).lower
   ```

   Enable automatic pinning (BBT: "Pin citation key on import/change") or pin
   manually (right-click item → Better BibTeX → Pin citation key). **A note is
   only created for items with a pinned citekey** — the citekey is the universal
   join key across Zotero, this repo, `.bib` files, and project repos, so it must
   never drift.
3. **Create the watched collection:** a collection named `to-note` (the default;
   override with `--collection` or a `config.json` containing
   `{ "zotero": { "collection": "..." } }`). Saving a paper into this collection
   means "I want a note for this paper." Tip: make it your Connector's default
   save target — then a Connector click is the entire capture step.

## 3. Set up the repo

```bash
git clone <this-repo> research-notes   # or "Use this template" on GitHub
cd research-notes
npm install
```

Verify the Zotero connection before anything else:

```bash
node scripts/zotero-fetch.js --dry-run
```

A classification summary means everything works; an error names the setting to
fix.

### Claude Code

Open the repo in Claude Code — the commands in `.claude/commands/` are available
immediately as `/add`, `/deepen`, `/topic`, `/propose`, `/survey`, `/link`,
`/sync`, `/doctor`.

### Codex (optional)

Codex loads custom prompts from `~/.codex/prompts`:

```bash
mkdir -p ~/.codex/prompts
cp .codex/prompts/*.md ~/.codex/prompts/
```

Restart Codex, then invoke as `/prompts:add`, `/prompts:sync`, etc.

## 4. Daily workflow

1. Click the Zotero Connector on a paper page; save into `to-note`.
2. Any time later, run `/sync` — every un-noted item in the collection becomes a
   note at `depth: metadata`/`abstract`, batched ~15 per run for large backlogs.
3. Review the diff; commit.

Papers you can't capture via the Connector (or don't want in Zotero): `/add
<DOI or arXiv URL>` creates the note directly.

**Going deeper, on demand:**

- `/deepen <citekey> method evidence` — upgrade one rung, reading only the named
  sections. Record why in the note.
- `/topic <name>` to start a topic map (create-or-update, idempotent);
  `/propose` after a batch of adds to get a reviewable placement checklist for
  un-placed papers, then `/propose apply <report>` to accept it;
  `/survey <topic>` when you need prose.

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| `/sync`: "Zotero unreachable" | Start Zotero; check the local-API setting from §2.1 |
| `/sync`: "collection not found" | Create the `to-note` collection or pass/configure another name |
| Item reported `blocked: no-citekey` | Pin its citekey in Zotero (§2.2), run `/sync` again |
| INDEX.md looks stale or inconsistent | `node scripts/doctor.js` to diagnose, `node scripts/doctor.js --fix` to regenerate generated files |
| Tests or scripts behave oddly on Windows | Ensure the checkout uses LF (the repo ships `.gitattributes` enforcing it); re-clone if the repo predates it |
| A note's facts are wrong | Fix the note here, once — every project repo linking by citekey inherits the fix |
