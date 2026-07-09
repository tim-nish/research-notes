# Quickstart — first note in ~15 minutes

The goal: click the Zotero Connector on a paper page, run one command, review
one diff. Every step below is one-time setup except the last three.

Full detail and troubleshooting live in [setup.md](setup.md).

## 1. Install (≈5 min)

- [Zotero 7](https://www.zotero.org/download/) (desktop) + the
  [Zotero Connector](https://www.zotero.org/download/connectors) browser
  extension
- [Better BibTeX for Zotero](https://retorque.re/zotero-better-bibtex/) (BBT)
- Node.js 18+
- [Claude Code](https://claude.com/claude-code)

## 2. Configure Zotero (≈5 min, one-time)

1. **Local API:** Zotero → Settings → Advanced → check **"Allow other
   applications on this computer to communicate with Zotero"**.
2. **Citekeys:** Settings → Better BibTeX → Citation keys → set the formula to

   ```
   auth.lower + year + shorttitle(1,1).lower
   ```

   and enable automatic pinning ("Pin citation key on import/change"). A note
   is only created for items with a pinned citekey.
3. **Watched collection:** create a collection named `to-note`. Saving a paper
   into it means "I want a note for this." Tip: make it the Connector's default
   save target.

## 3. Get the repo (≈2 min)

Click **"Use this template"** on GitHub (or clone), then:

```bash
cd <your-repo>
npm install
```

Open the folder in Claude Code. Verify the Zotero connection:

```bash
node scripts/zotero-fetch.js --dry-run
```

You should see a classification summary (`0 create, ...` is fine). If it errors,
the message names the exact setting to fix.

## 4. Your first note (≈3 min)

1. In your browser, open a paper page (arXiv, publisher, anywhere the Connector
   works) and click the Connector → save into `to-note`.
2. In Claude Code, run `/sync`.
3. Read the diff: a new `papers/<citekey>.md` at `depth: abstract` (facts only),
   a topic placement, and a regenerated `INDEX.md`/`catalog.json`. Commit it.

That's the whole loop. From here:

- `/deepen <citekey> method` when a paper earns a closer read (the note records
  how deep you went and why).
- `/topic <name>` to start a topic map (or re-derive it later — the same
  command handles both); `/propose` to get a reviewable placement checklist
  for un-placed papers, then `/propose apply <report>` to accept it;
  `/survey <topic>` to draft prose from a topic map.
- `/doctor` any time the repo feels inconsistent.
