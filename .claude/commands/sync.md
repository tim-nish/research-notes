---
description: Discover papers saved to the watched Zotero collection and author notes for them
argument-hint: '[batch size, default 15]'
---

Follow the `sync` workflow defined in specs/sync.md and specs/sync-backlog.md for
batch size: $ARGUMENTS (default 15 if not given).

Steps:
1. Run `node scripts/zotero-fetch.js`.
   - Exit 2 (Zotero unreachable) or exit 3 (collection not found): stop here, show
     the printed remediation message, do nothing else.
   - Otherwise continue.
2. Read `.sync/queue.json`. Process up to the batch-size limit of `pending`
   entries, in queue order (oldest `dateAdded` first). For each entry:
   - Set its `status` to `in-progress` and **write the queue file immediately**
     (not batched to the end — this is what makes crash recovery work).
   - `action: create` — first check whether `papers/<citekey>.md` already exists
     (it shouldn't, but never overwrite a note that's already there — treat
     that as a metadata conflict and report it instead of authoring). Otherwise
     author it from `templates/paper.md` following the `add` workflow's
     conventions (CLAUDE.md): set `depth: metadata`, or `depth: abstract` (and
     fill **Contribution** + **Key claims** from `metadata.abstractNote`, facts
     only, no relevance judgments) when the queue entry's `metadata.abstractNote`
     is non-empty. **Must populate `zotero: zotero://select/library/items/<itemKey>`**
     — this is the idempotency join future `/sync` runs rely on. The note is
     born `topics: []` — `sync` never opens or edits `topics/*.md` (placement
     is `/propose`'s job, per specs/sync-placement.md).
   - `action: enrich` — fill only *empty* frontmatter fields (`zotero`, `venue`,
     `url`) on the existing note. Never touch the body or `depth`. Bump
     `updated` to today. If any of those three fields is already non-empty,
     never overwrite it — report the discrepancy instead (metadata conflict,
     per specs/sync.md §6) and leave it alone.
   - On success: set `status: done`, write the queue file.
   - On failure: always increment `attempts` first, then check the new value.
     If `attempts < 3`: set `status: pending`, write the queue file, continue
     with the next entry (this entry will be retried on a future `/sync` run).
     If `attempts >= 3`: set `status: blocked`,
     `blockedReason: repeated-failure` instead of `pending`, write the queue
     file, continue — and never retry a `blocked` entry automatically again.
3. Run `node scripts/build-catalog.js` once, after the whole batch (not per
   entry).
4. Run `node scripts/doctor.js` once.
5. If step 4 exited non-zero (error-severity findings present), the report
   must **open** with a STOP notice before anything else, e.g.:
   > **STOP — doctor reported N error(s). Resolve these before running
   > `/sync` again.**
   followed by the error lines. This is report prose, not a behavioral gate —
   `/sync` still completes its batch (the errors may predate it).
6. Report a table: citekey, action (created/enriched/blocked), depth — plus
   counts (processed / done / blocked) and the number of entries still
   `pending` in the queue (if non-zero, say to run `/sync` again). End the
   report with a final line: the number of unassigned papers in the repo
   (`topics: []`), with the hint "run `/propose`".

Never write to Zotero. Never invent a citekey for a `blocked: no-citekey` entry.
Never modify `catalog.json`/`INDEX.md` by hand — only via `build-catalog.js`.
Never open or edit `topics/*.md` — placement is `/propose`'s job.
