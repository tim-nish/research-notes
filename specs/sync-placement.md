# Spec: `sync-placement` — amendment: capture never places

Status: proposed amendment to the shipped [sync](sync.md) behavior and the
`add` workflow. Small, but normative for the propose ecosystem — implement
together with [topic](topic.md)/[propose](propose.md). This file exists so the
change is reviewed as an explicit decision rather than smuggled into the
propose implementation.

## 1. The inconsistency being fixed

`/sync` (step: "Assign the citekey to a topic map's Clusters section, or its
Reading queue if unclustered, per the `add` rules") and `/add` both make topic
*placement judgments* silently, in bulk, while authoring — and they do it by
editing `topics/*.md` for papers whose `topics:` frontmatter they may not have
set, which manufactures doctor D10 drift (same defect as the old topic-create
path, see [topic](topic.md) §1). With `propose` in the system this is a
duplicated judgment path: the reviewable-proposal loop and the silent-author
loop would compete over the same decision.

## 2. Amended behavior (normative)

1. **`sync` authors notes with `topics: []`, always.** It no longer opens or
   edits `topics/*.md` at all. Its per-batch report gains a final line: the
   number of unassigned papers in the repo, with the hint "run `/propose`".
2. **`add`** likewise stops editing `topics/*.md`. If the user explicitly
   names a topic (`add <id> <topic>`), it may set that `topics:` frontmatter
   (an explicit human decision) and then run the `topic <t>` workflow;
   otherwise the note is born unassigned.
3. Pipeline reading (the system's stage boundaries):
   `sync`/`add` = capture facts → `propose` → human check → `propose apply` /
   `topic` = organize → `survey` = synthesize.

## 3. Why this is the right trade

- **One placement code path.** Every placement becomes a reviewable checklist
  item; in the scheduled-sync future the sync PR contains only new notes and
  generated files — a tighter, mechanically checkable write boundary
  (`papers/`, `catalog.json`, `INDEX.md`, `.sync/` and nothing else).
- **No manufactured drift.** Maps only ever reference frontmatter-tagged
  papers.
- Cost, honestly: an obvious placement now takes two steps (sync, then
  propose/apply) instead of zero. Acceptable because `propose` batches an
  entire import into one checklist, and "obvious" placements are exactly the
  ones that take one checkbox.

## 4. Changes required

| File | Change |
|---|---|
| `.claude/commands/sync.md` / `.codex/prompts/sync.md` | drop the topic-assignment sentence; add the unassigned-count report line |
| specs/sync.md | amend the authoring step accordingly (reference this file) |
| `.claude/commands/add.md` / `.codex/prompts/add.md` | placement only on explicit topic argument, via frontmatter + `topic <t>` |
| CLAUDE.md / AGENTS.md / README.md | workflow descriptions updated (bundled with [topic](topic.md) §6 migration) |

## 5. Acceptance criteria

- [ ] A `/sync` batch on a repo with topic maps: `git status` shows only new
      `papers/*.md`, `.sync/queue.json`, and regenerated `catalog.json` /
      `INDEX.md` — no `topics/*.md` modified.
- [ ] Batch report ends with the unassigned count and the `/propose` hint.
- [ ] `add <id>` without a topic → note has `topics: []`; with a topic → that
      frontmatter set and the map updated via the `topic` workflow; doctor 0
      either way.

## 6. Out of scope

Any change to discovery, the queue contract (sync-backlog), citekey handling,
or enrich semantics — this amendment touches only the placement step.
