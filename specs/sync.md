# Spec: `sync` — Zotero → repo pipeline (tag-less, collection-scoped)

Status: ready for implementation **after Story 0 (spike) passes**. Depends on:
[build-catalog](build-catalog.md), [doctor](doctor.md). The queue file contract
and batch/resume semantics are specified separately in
[sync-backlog](sync-backlog.md).

## 1. Goal

One browser click, one command, no identifier transport by hand: the user saves a
paper with the official Zotero Connector into a **watched collection** (default
name: `to-note`); `/sync` discovers everything in that collection that has no
note yet, authors notes for them, regenerates generated files, and validates.

**Design change vs. the earlier tag-based draft:**
there is no `to-note` *tag*, no tag clearing, no `zotero-mark.js`, no Zotero Web
API key, and **no write path to Zotero at all**. Discovery is a diff:

```
pending = top-level items in watched collection
        − items already joined to a note (by Zotero item key or by citekey)
```

Selection ("I want a note for this paper") is expressed by which collection the
item is saved into — the Connector's save popup already offers collection choice
and remembers the last target, so the marginal effort is zero clicks, including
for bulk imports.

## 2. Story 0 — spike (blocking)

Verify against the locally installed Zotero before implementing anything else,
and record findings at the bottom of this file:

- [ ] Local API reachable: `GET http://localhost:23119/api/users/0/collections`
      lists collections (requires "Allow other applications on this computer to
      communicate with Zotero" in Zotero Settings → Advanced).
- [ ] Collection items queryable:
      `GET /api/users/0/collections/<KEY>/items/top?format=json` returns item
      metadata including `title`, `creators`, `date`, `DOI`, `url`,
      `abstractNote`, `key`.
- [ ] Better BibTeX JSON-RPC works:
      `POST http://localhost:23119/better-bibtex/json-rpc` with method
      `item.citationkey` resolves item keys to pinned citekeys (confirm exact
      method name and batch form against the installed BBT version).
- [ ] Confirm pagination behavior (`limit`/`start` params) for collections with
      >100 items.

## 3. Architecture

```
Browser ──Zotero Connector──▶ Zotero (item + PDF, saved into "to-note" collection)
                                 │  local HTTP API (read-only)
                                 ▼
                  scripts/zotero-fetch.js  ──▶  .sync/queue.json   (discovery diff)
                                 │
                                 ▼
                  /sync agent workflow (author notes, assign topics, in batches)
                                 │
                                 ▼
        papers/<citekey>.md  ──▶  node scripts/build-catalog.js  (once per run)
                                 │
                                 ▼
                  node scripts/doctor.js  →  per-item report
```

State lives in the notes themselves: the `zotero:` frontmatter field stores the
`zotero://select/library/items/<ITEMKEY>` link, and the item key inside it is the
join used to detect already-synced items; the citekey/filename is the secondary
join. No separate state database. `.sync/` is transient and gitignored.

## 4. Discovery algorithm (`scripts/zotero-fetch.js`)

1. Resolve collection name → collection key via the local API (exit 3 with the
   list of available collection names if not found).
2. Fetch top-level items of the collection (exclude attachments/notes;
   paginate).
3. Batch-resolve citekeys via BBT JSON-RPC. Items without a pinned citekey are
   queued as `blocked: no-citekey` — **the script never invents citekeys**.
4. Scan `papers/*.md` frontmatter: collect the set of Zotero item keys (parsed
   from `zotero:` links) and the set of citekeys (filenames).
5. Classify each collection item. A field (`zotero`, `venue`, `url`) is
   *fillable* when it is empty in the note **and** the current fetch's
   Zotero metadata has a non-empty value for it (the `zotero` link is
   always fillable when empty, since it derives from the item key) — see
   [sync-stage1-fixes](sync-stage1-fixes.md) §1:
   - item key or citekey already has a note and nothing is fillable → skip
     (not queued);
   - citekey has a note but some fillable field is empty in the note →
     queue with `action: enrich`;
   - no note, and the item has no `date` in Zotero → queue with
     `action: blocked`, `blockedReason: no-year` (never invent a year; see
     [sync-stage1-fixes](sync-stage1-fixes.md) §2);
   - no note, item has a date → queue with `action: create`.
6. Merge into `.sync/queue.json` per the [sync-backlog](sync-backlog.md)
   contract; print a summary (`N create, M enrich, K blocked, J skipped`).

### CLI

```
node scripts/zotero-fetch.js [--collection to-note] [--limit N] [--dry-run]
                             [--out .sync/queue.json] [--from-fixture <file>]
```

`--dry-run` prints the classification summary without writing the queue.
`--from-fixture` substitutes fixture JSON for both Zotero endpoints (tests run
without Zotero). Collection default `to-note`, overridable by flag or by an
optional committed `config.json` (`{ "zotero": { "collection": "..." } }`);
flag > config > default.

## 5. `/sync` agent workflow

Files: `.claude/commands/sync.md`, `.codex/prompts/sync.md`.

1. Run `zotero-fetch.js`. On exit 2/3, stop and show the remediation message; do
   nothing else.
2. Process up to the batch limit of `pending` queue entries (see sync-backlog):
   - `create`: new note from `templates/paper.md` per the existing `add`
     workflow — `depth: metadata`, or `abstract` when the entry carries an
     `abstractNote` (author Contribution + Key claims from it, facts only).
     **Must populate the `zotero:` select link** (it is the idempotency join).
   - `enrich`: fill only *empty* frontmatter fields (`zotero`, `venue`, `url`);
     never touch body or `depth`; bump `updated`.
   - The note is born `topics: []`, always — `sync` never opens or edits
     `topics/*.md`. Placement is `/propose`'s job; see
     [sync-placement](sync-placement.md), which amends this step.
   - Mark the entry `done` in the queue (crash resumability).
3. Run `node scripts/build-catalog.js` once, after all entries in the batch.
4. Run `node scripts/doctor.js`. If it exits non-zero (error-severity findings
   present), the final report must **open** with a STOP notice naming the
   error count before anything else — see
   [sync-stage1-fixes](sync-stage1-fixes.md) §3. This is
   report prose, not a behavioral gate: `/sync` still completes its batch.
   Then report a table: citekey, action (created/enriched/blocked), depth —
   plus the count of entries remaining in the queue and, if non-zero, "run
   `/sync` again". End the report with the count of unassigned papers in the
   repo and the hint to run `/propose` (see [sync-placement](sync-placement.md)
   §2.1).

## 6. Failure recovery

| Failure | Behavior |
|---|---|
| Zotero not running / local API disabled | fetch exits 2 naming the setting to enable; queue untouched |
| Watched collection missing | fetch exits 3 listing available collections |
| BBT missing or item has no pinned citekey | entry `blocked: no-citekey`; other items proceed; never auto-generate a citekey |
| Zotero item has no date | entry `blocked: no-year`; other items proceed; resolves to `pending` once a date is set in Zotero; never invent a year |
| One item fails during authoring | entry stays `pending`; remaining items proceed; failures listed in the final report |
| Crash mid-run | re-run `/sync`: `done` entries skipped via queue; already-noted items skipped via the frontmatter joins |
| Metadata conflict (existing note differs from Zotero) | never overwrite non-empty fields; report the discrepancy for human resolution |
| Item removed from the collection after its note exists | nothing happens — repo state wins; sync never deletes notes |

## 7. Idempotency rules (normative)

1. Running `/sync` twice in a row (empty backlog): second run is a no-op,
   reporting "0 pending".
2. An item already noted is never re-created; its `depth` and body are never
   modified by sync.
3. Frontmatter enrichment fills empty fields only.
4. Generated files are regenerated, not patched; repeated runs converge to
   identical bytes.
5. Sync performs **no writes to Zotero**; correctness never depends on
   Zotero-side state changing.
6. Deleting `.sync/queue.json` is always safe; it is rebuilt from the discovery
   diff.

## 8. Acceptance criteria

- [ ] Story 0 findings recorded below.
- [ ] Save one new paper into the collection → `/sync` produces a valid note at
      `depth: abstract` with correct citekey filename, populated `zotero:`
      link, and `topics: []` (placement is `/propose`'s job, per
      [sync-placement](sync-placement.md)); regenerated catalog/INDEX, clean
      doctor.
- [ ] Second `/sync` immediately after: zero file changes (`git status` clean).
- [ ] Paper already noted (with empty `zotero:` field, like the current 4 notes):
      reported as "enriched" — `zotero`/`venue`/`url` filled, body and `depth`
      untouched.
- [ ] Kill the agent mid-batch of 3 → re-run completes the remaining items
      without duplicating the finished ones.
- [ ] With Zotero closed: single clear error, no repo changes.
- [ ] Item without a pinned citekey: reported blocked, not created.
- [ ] `.gitignore` covers `.sync/`.
- [ ] doctor errors present → report opens with the STOP notice (see
      [sync-stage1-fixes](sync-stage1-fixes.md) §3).

## 9. Tests (script layer, no Zotero required)

Fixture JSON of both Zotero endpoints → `--from-fixture` produces the expected
queue for each classification case (create/enrich/skip/blocked); item-key
extraction from `zotero:` links; collection-name resolution failure; pagination
across fixture pages; config/flag precedence.

## 10. Out of scope

Scheduled/unattended execution and GitHub-issue triggers (planned, phase 4 of the
project plan); Zotero Web API mode (future: enables sync from CI for libraries
synced to zotero.org); deepen-request markers.

---

## Story 0 findings

Verified 2026-07-07 by the user against their locally installed Zotero (dev
runs in a container; Zotero runs natively on the host, so the spike was run
from the host, not this environment).

- [x] Local API reachable: `GET http://localhost:23119/api/users/0/collections` — confirmed working.
- [x] Collection items queryable: `GET /api/users/0/collections/<KEY>/items/top?format=json` — confirmed working.
- [x] Better BibTeX JSON-RPC — confirmed working, **with a correction to the assumed shape**:
      - Endpoint: `POST http://localhost:23119/better-bibtex/json-rpc`
      - Method: `item.citationkey` (as assumed)
      - **Params shape differs from the draft assumption above**: `params: [[itemKey1, itemKey2, ...]]` —
        a single-element array whose element is the array of item keys (no separate `libraryID` second
        param). Batch form: pass multiple item keys in that one inner array.
      - Response: an object/mapping from item key → citation key (not an array).
      - `zotero-fetch.js`'s implementation and its `--from-fixture` test fixtures must match this exact
        shape, not the params shape drafted in spec §2.
- [ ] Pagination (`limit`/`start` on `/collections/<KEY>/items/top`) — **not verified**: the user's test
      collection has under 100 items. Implement pagination per the Zotero API's documented `limit`/`start`
      convention (standard across the local and Web APIs), but treat it as unverified until exercised
      against a real collection over 100 items — watch for this on the first large/bulk sync.
