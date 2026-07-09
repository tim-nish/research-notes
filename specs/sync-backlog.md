# Spec: sync backlog — queue file contract and batch/resume semantics

Status: ready for implementation, together with [sync](sync.md) (this spec is the
contract between `zotero-fetch.js` and the `/sync` agent workflow). Rationale:
a 100-paper bulk import must not be authored in a single agent run; the queue is
what makes bulk imports bounded, resumable, and safe to interrupt.

## 1. Queue file

Path: `.sync/queue.json` (transient, gitignored; deleting it is always safe —
it is rebuilt from the sync discovery diff).

```json
{
  "schema": 1,
  "generated": "2026-07-07T09:00:00Z",
  "source": { "library": "users/0", "collection": "to-note" },
  "items": [
    {
      "itemKey": "ABCD1234",
      "citekey": "tongSigFormerSignatureTransformers2023",
      "action": "create",
      "status": "pending",
      "attempts": 0,
      "blockedReason": null,
      "metadata": {
        "title": "",
        "creators": [],
        "year": 2023,
        "venue": "",
        "doi": "",
        "url": "",
        "abstractNote": ""
      }
    }
  ]
}
```

- `action`: `create` | `enrich` (see sync spec §4 for classification).
- `status`: `pending` | `in-progress` | `done` | `blocked`.
- `blockedReason`: `no-citekey` | `no-year` | `repeated-failure` | null. The
  first two are *resolvable* — a later fetch can clear them on its own once
  Zotero state improves (see [sync-stage1-fixes](sync-stage1-fixes.md) §2);
  `repeated-failure` never auto-unblocks.
- `metadata` carries everything the agent needs to author the note **without
  calling Zotero again** during the authoring phase.

## 2. Merge semantics (on every `zotero-fetch.js` run)

Fetch never blindly overwrites an existing queue; it merges, keyed by `itemKey`:

1. New collection items not in the queue → appended as `pending`.
2. Existing `pending`/`blocked` entries → `metadata` refreshed from Zotero;
   `no-citekey` entries whose citekey now resolves become `pending`.
3. Entries whose item now has a complete note in the repo (frontmatter join) →
   removed (regardless of prior status; the repo is the source of truth).
4. `done` entries → removed (their notes exist; rule 3 subsumes this).
5. `in-progress` entries (crash leftovers) → reset to `pending` if no note file
   exists for the citekey; removed if the note exists and is complete.
6. `--limit N` caps how many *new* items are appended per fetch; it never drops
   existing entries.

## 3. Batch semantics (agent side, `/sync`)

- Default batch size: **15** entries per run; overridable by the command argument
  (`/sync 30`). Rationale: bounds a single agent run's context; a 100-item
  backlog completes in ~7 runs.
- Processing order: queue order (fetch appends in Zotero `dateAdded` order, so
  oldest saves are noted first).
- Per entry: set `status: in-progress` → author the note (or enrich) → set
  `status: done`. The queue file is written after **every** status change, not
  once at the end.
- On a failed entry: increment `attempts`, reset to `pending`, continue with the
  next entry. At `attempts >= 3` → `status: blocked`,
  `blockedReason: repeated-failure` (surfaced in the report; never retried
  automatically).
- End-of-run report always includes: processed / done / blocked counts and
  **remaining pending count**, with "run `/sync` again" when it is non-zero.
- `build-catalog` and `doctor` run once per run (after the batch), not per entry.

## 4. Invariants (normative)

1. No entry is ever processed twice to completion: `done` requires the note file
   to exist, and merge rule 3 removes entries once the repo has the note.
2. Interrupting at any point (including mid-write of a note) is recoverable by
   re-running `/sync` with no manual cleanup.
3. The queue never contains two entries with the same `itemKey`.
4. Blocked entries never silently disappear: they persist across merges until
   either resolved (rule 2) or their item leaves the watched collection.
5. Queue state never overrides repo state.

## 5. Acceptance criteria

- [ ] 100-item fixture, batch 15 → exactly 7 `/sync` runs to drain; no duplicate
      notes; final report shows 0 pending.
- [ ] Kill the agent after entry 2 of a 5-entry batch → next run: fetch resets
      the `in-progress` leftover correctly (rule 5 of §2), and the batch
      completes the remaining entries only.
- [ ] Delete `.sync/queue.json` mid-backlog and re-run → same final repo state.
- [ ] Entry failing 3 times → blocked, reported, not retried on subsequent runs.
- [ ] An item that gains a pinned citekey between runs moves from
      `blocked: no-citekey` to `pending` automatically.
- [ ] `--limit 10` on a 50-item collection appends 10; a later unlimited fetch
      appends the rest without duplicating the first 10.

## 6. Tests

Merge-semantics unit tests for each rule in §2 (fixture queue × fixture Zotero
response → expected queue); atomic-write behavior (queue is written to a temp
file and renamed, so a crash never leaves invalid JSON); duplicate-itemKey
rejection; batch-order stability.
