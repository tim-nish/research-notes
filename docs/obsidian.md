# Using the repo as an Obsidian vault (optional)

The repo is Obsidian-compatible by design and needs **zero modifications** to be
used as a vault. Obsidian is a lens, never a dependency: everything below is
optional, and the repo stays fully functional as plain markdown without it.

## Open it

Obsidian → **Open folder as vault** → select the repo root. That's it.
`.gitignore` already excludes Obsidian's per-machine state
(`.obsidian/workspace*`, `.obsidian/cache`); don't commit the rest of
`.obsidian/` either — plugin choices are personal.

What you get with no configuration:

- **Wikilinks resolve:** topic maps link papers as `[[citekey]]`, which Obsidian
  resolves natively to `papers/<citekey>.md`.
- **Graph view and backlinks:** derived automatically from those links — the best
  cheap way to *see* cluster structure and spot papers that should be connected
  but aren't.
- **Zotero round-trip:** each note's `zotero:` frontmatter field holds a
  `zotero://select/...` link — clicking it opens the item (and its PDF and
  annotations) in Zotero.

## Recommended community plugins

- **[Dataview](https://blacksmithgu.github.io/obsidian-dataview/)** — live tables
  over the notes' frontmatter (snippets below). Obsidian's core **Bases** feature
  can express similar views if you prefer no plugin.
- **[Zotero Integration](https://github.com/mgmeyers/obsidian-zotero-integration)**
  — pull annotations/highlights from Zotero into markdown; useful raw material
  when running `deepen`.

## Copy-paste Dataview snippets

All papers by topic, newest first:

````
```dataview
TABLE year, depth, topics, updated
FROM "papers"
SORT year DESC
```
````

Shallow notes that may deserve enrichment (`depth: metadata`):

````
```dataview
TABLE title, year, added
FROM "papers"
WHERE depth = "metadata"
SORT added ASC
```
````

Recently updated notes (last 14 days):

````
```dataview
TABLE title, depth, updated
FROM "papers"
WHERE updated >= date(today) - dur(14 days)
SORT updated DESC
```
````

Papers not yet assigned to any topic:

````
```dataview
LIST title
FROM "papers"
WHERE !topics OR length(topics) = 0
```
````

## Division of labor

Obsidian is the **human** browse/read layer. `INDEX.md` and `catalog.json` are
the **agent**-facing views and stay grep-able generated markdown/JSON — agents
can't run Dataview. Editing note *content* in Obsidian is fine (notes are the
source of truth; bump `updated`); never hand-edit `INDEX.md` or `catalog.json`,
and run `doctor` if things look inconsistent.
