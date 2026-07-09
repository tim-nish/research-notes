---
description: Propose topic placement and topic-map changes, without deciding
argument-hint: '[topic] | apply <report-file>'
---

Follow the `propose` workflow defined in CLAUDE.md and specs/propose.md for:
$ARGUMENTS

If the first token is `apply`, run the **apply mode** (below) against the
report file named by the second token. Otherwise run **scan mode**, scoped to
the topic named by `$ARGUMENTS` if one is given.

Reading budget (normative — never exceed it): `catalog.json` fields
`citekey`, `title`, `year`, `depth`, `topics`, `contribution`; and
`propose-scan.js --json`'s topic structure (`one_liner`, cluster names +
members, Reading-queue members). Never open paper-note bodies. Never open
topic-map prose beyond what the scanner extracts. Never touch the network.

## Scan mode: `propose [topic]`

1. **Gate.** Run `node scripts/doctor.js`. If any `error`-severity finding is
   present: stop, show the findings, propose nothing. Never propose over a
   drifted corpus. Warnings do not block — carry their D10/D11/D12 messages
   into the drift appendix (step 4).
2. **Scan.** Run `node scripts/propose-scan.js --json` (add `--topic <t>` if
   scoped). Non-zero exit: stop and show the scanner's stderr message; propose
   nothing (same discipline as the doctor gate — exit 1 means an unparseable
   or missing `catalog.json`/topic map, fix the named file; exit 3 means the
   `--topic` scope doesn't exist, check the name; either way, don't guess and
   don't retry with a different scope on your own). Candidate classes, exactly
   as the scanner defines them:
   - `unassigned` — `topics: []` in frontmatter and in no topic-map section;
   - `queue-only` — appears in one or more Reading queues but in no Clusters
     section.
3. **Propose exactly one action per candidate**, grounded in the catalog
   `contribution` line:
   - `place` into an existing cluster of an existing topic;
   - `cluster` — a new cluster in an existing topic (grouping ≥1 candidates);
   - `topic` — a new topic map (grouping candidates; propose a kebab name,
     `one_liner`, and initial clusters);
   - `defer` — leave unassigned, stating the reason nothing fits.
   Additionally, at the map level, propose `restructure` items (split an
   oversized cluster, merge near-duplicate clusters/topics) only when the scan
   output shows clear evidence — the only normative threshold is a cluster
   with more than 10 members. If you find yourself inventing another numeric
   threshold to justify a restructure, stop and ask instead of guessing.
4. **Write the report** to `scratch/propose-<YYYY-MM-DD>.md`, following the
   grammar below exactly (this is a machine-parsed contract — `propose apply`
   depends on it). A same-day re-run overwrites the file. If there are zero
   candidates and zero restructure items: print "nothing to propose" and write
   no file.
5. **Print a terminal summary**: counts per action class, plus the count of
   doctor D10/D11/D12 warnings carried into the drift appendix.

### Report grammar (normative)

```markdown
# Topic proposals — <YYYY-MM-DD>

Scope: <all | topic name> · Candidates: N (unassigned X, queue-only Y)
Check the items to accept, then run `/propose apply scratch/propose-<date>.md`.

## Place in existing clusters
- [ ] `place <citekey> → <topic> / "<cluster>"` — <justification>

## New clusters
- [ ] `cluster <topic> / "<cluster>" ← <citekey>, <citekey>` — <justification>

## New topics
- [ ] `topic <kebab-name> "<one_liner>" ← <citekey>, <citekey>` — <justification>

## Restructure
- [ ] `restructure <topic> — <instruction>` — <justification>

## Leave unassigned
- [ ] `defer <citekey>` — <why nothing fits>

## Pre-existing drift (informational — fix via doctor/topic, not checkboxes)
- D10 <file> <message>
```

Rules:
- One line per item: `- [ ] ` + a backtick-fenced action + ` — ` + a one-line
  factual justification quoting or closely paraphrasing the note's catalog
  `contribution`. No project-relevance reasoning, ever.
- Empty sections are omitted.
- The drift appendix mirrors doctor's D10/D11/D12 warnings verbatim. Drift
  items are never candidates and carry no checkboxes.
- Every candidate from the scan appears exactly once across the checkbox
  sections; the header counts must match.

Writes only that one scratch file. `git status` after a scan run shows at most
`scratch/propose-<date>.md`.

## Apply mode: `propose apply <report-file>`

1. **Parse** the checked (`- [x]`) items against the grammar above. Any
   checked line that does not parse: stop with an error naming the exact line;
   apply nothing. Never guess intent.
2. **Frontmatter edits.** For each citekey named by a checked `place`,
   `cluster`, or `topic` item: add the topic to that paper's `topics:`
   frontmatter and bump `updated`. If already satisfied (frontmatter already
   names the topic), skip it with a note — re-applying a report is idempotent.
   `defer` items are informational only: checked or not, they cause no writes.
3. **Map derivation.** Run the `/topic <t>` workflow once per affected topic
   (create path for checked `topic` items, update path otherwise), passing the
   accepted cluster names/memberships from the report as clustering guidance.
   Pass checked `restructure` items as guidance to the same run.
4. Run `node scripts/build-catalog.js`, then `node scripts/doctor.js`.
5. **Report** a table: item → applied / skipped (already satisfied) / failed,
   plus doctor's exit status. List unchecked items as "not accepted" and leave
   them untouched.

Writes only: `topics:` + `updated` frontmatter of papers named in checked
items; topic maps via the `/topic` workflow (which preserves human prose);
generated files via `build-catalog.js`. Never invents citekeys or paper facts,
never edits note bodies, never deletes files, never writes to Zotero.

## Out of scope (do not do these, even if it seems convenient)

Auto-apply of any kind; embedding/similarity-based clustering; proposals about
depth upgrades (that's `/deepen`'s territory); repairing drift (doctor's/
`/topic`'s territory); scheduled or issue-triggered runs.
