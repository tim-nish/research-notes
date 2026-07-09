# Spec: `propose` — propose topic placement and topic changes, without deciding

Status: ready for implementation. **Supersedes the draft `topic-propose` spec**;
all six open points from that draft's §8 are resolved here. Depends on:
[propose-scan](propose-scan.md) (deterministic candidate scanner),
[topic](topic.md) (the apply path), [build-catalog](build-catalog.md),
[doctor](doctor.md), and the [sync-placement](sync-placement.md) amendment
(which makes `propose` the *only* placement path).

## 1. Goal and command boundary

Close the loop between capture (`sync`/`add`) and the topic maps. The normative
division of labor:

- **`topic <name>`** explicitly creates or updates one topic map. It executes a
  human decision that the topic exists and derives the map from current notes.
- **`propose`** analyzes the whole repo and writes a reviewable proposal —
  topic candidates, placements, restructurings. It never modifies `papers/`,
  `topics/`, or generated files. It decides nothing.
- **`propose apply <report>`** executes exactly the checklist items a human has
  checked in a proposal report. It applies decisions; it does not make them.

Every placement decision in the system therefore passes through a reviewable
artifact (the report locally; an issue in the GitHub-automated future — see
[propose-issue](propose-issue.md)).

## 2. Type and files

Judgment work → agent workflow; candidate detection is deterministic → script
(shared conventions, specs/README.md). Files:

- `.claude/commands/propose.md`, `.codex/prompts/propose.md`
- `scripts/propose-scan.js` — specced separately in
  [propose-scan](propose-scan.md)

## 3. Inputs and reading budget (normative)

`propose` may read only:

1. `catalog.json` records: `citekey`, `title`, `year`, `depth`, `topics`,
   `contribution`.
2. Topic-map structure via `propose-scan --json`: each map's `one_liner`,
   cluster names + members, Reading-queue members.

It never opens paper-note bodies, never opens topic-map prose beyond what the
scanner extracts, and never touches the network. The budget is enforced by
*what* may be read, not by a candidate cap: cost is one catalog line per
candidate plus one scan of `topics/*.md`, so a 100-paper import fits in one
run. Revisit batching only if the unassigned set exceeds ~300.

## 4. Behavior

`propose [topic]` (optional scope argument restricts candidates and proposals
to one topic):

1. **Gate.** Run `node scripts/doctor.js`. Any `error`-severity finding: stop,
   show the findings, propose nothing — never propose over a drifted corpus.
   Warnings do not block (they feed the drift appendix, step 4).
2. **Scan.** Run `node scripts/propose-scan.js --json` (with `--topic <t>` if
   scoped). Candidate classes (defined precisely in propose-scan §4):
   - `unassigned` — `topics: []` in frontmatter and in no topic-map section;
   - `queue-only` — appears in one or more Reading queues but in no Clusters
     section.
3. **Propose exactly one action per candidate**, grounded in the catalog
   `contribution` line:
   - place into an existing cluster of an existing topic;
   - new cluster in an existing topic (grouping ≥1 candidates);
   - new topic map (grouping candidates; with proposed kebab name, `one_liner`,
     and initial clusters);
   - defer (leave unassigned), with the reason nothing fits.
   Additionally, at the map level, it may propose **restructure** items (split
   an oversized cluster, merge near-duplicate clusters/topics) — only when the
   scanner output shows clear evidence (e.g. a cluster > 10 members).
4. **Write the report** to `scratch/propose-<YYYY-MM-DD>.md` (§5). A same-day
   re-run overwrites the file — the report is derived state and `scratch/` is
   disposable. If there are zero candidates and zero restructure items, print
   "nothing to propose" and write no file.
5. **Print a terminal summary**: counts per action class, plus the count of
   doctor D10/D11/D12 warnings listed in the drift appendix.

## 5. Report format (normative grammar — this is the automation contract)

The report is both human-reviewable and machine-appliable; `propose apply` and
the [propose-issue](propose-issue.md) workflow parse it, so the grammar is
strict. Structure:

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
  items are **never** candidates and carry no checkboxes — repairing drift is
  doctor/`topic` territory, not a proposal.
- Every candidate from the scan appears exactly once across the checkbox
  sections; the counts in the header must match.

## 6. `propose apply <report-file>`

1. **Parse** the checked (`- [x]`) items against the §5 grammar. Any checked
   line that does not parse: stop with an error naming the line; apply
   nothing. Never guess intent.
2. **Frontmatter edits.** For each citekey named by a checked `place`,
   `cluster`, or `topic` item: add the topic to the paper's `topics:`
   frontmatter and bump `updated`. Already-satisfied items are skipped with a
   note (re-applying a report is idempotent). `defer` items are informational
   — checked or not, they cause no writes.
3. **Map derivation.** Run the [`topic <t>`](topic.md) workflow once per
   affected topic (create path for checked `topic` items, update path
   otherwise), passing the accepted cluster names and memberships from the
   report as clustering guidance. Checked `restructure` items are passed as
   guidance to the same run.
4. Run `node scripts/build-catalog.js`, then `node scripts/doctor.js`.
5. **Report** a table: item → applied / skipped (already satisfied) / failed,
   plus doctor's exit status. Unchecked items are listed as "not accepted" and
   left untouched.

## 7. Safety rules (normative)

- `propose` writes only the scratch report. `git status` after a run shows at
  most that one file.
- `propose apply` writes only: `topics:` + `updated` frontmatter of papers
  named in checked items; topic maps via the `topic` workflow (which preserves
  human prose per its own spec); generated files via `build-catalog`.
- Neither mode invents citekeys or paper facts, edits note bodies, deletes
  files, or writes to Zotero.
- Justifications are facts-only (the paper's contribution), never "useful for
  project X".

## 8. Acceptance criteria

Fixture repos are defined in [propose-scan](propose-scan.md) §7 and shared with
its tests.

- [ ] Fixture (3 papers, 1 topic map, 1 orphan with `topics: []`): report
      contains exactly one proposal for the orphan referencing the existing
      map's clusters; `git status` shows only the scratch file.
- [ ] Fixture with a queue-only paper: proposed (`place`/`cluster`/`defer`),
      never silently skipped.
- [ ] Nothing unassigned: terminal message, no scratch file created.
- [ ] Scoped run `propose <topic>`: candidates and proposals restricted to
      that topic; header records the scope.
- [ ] Same-day second run overwrites `scratch/propose-<date>.md`; no second
      file appears.
- [ ] Doctor error-severity finding present: propose refuses to run past the
      gate; no scan, no report.
- [ ] Report with 2 of 4 items checked → `apply` edits exactly the frontmatter
      of the checked items' citekeys, runs `topic` only for affected maps,
      leaves the unchecked items' papers untouched, ends with doctor exit 0.
- [ ] Re-running `apply` on the same report: all items report "skipped
      (already satisfied)", `git status` clean apart from the report itself.
- [ ] A checked line with malformed grammar → apply stops before any write.

## 9. Tests

Agent-workflow behavior → golden-run review checks against the fixtures
(report exists, expected proposal classes present, no other file changed;
after apply: expected diffs only). The deterministic halves — candidate
detection and the report grammar — are unit-tested in `propose-scan`
(the scanner) and via a grammar fixture file checked into `test/fixtures/`
that the apply acceptance runs against.

## 10. Out of scope

Auto-apply of any kind; embedding/similarity-based clustering (grep + catalog
scale to ~1–2k notes per README); proposals about depth upgrades (that is
`deepen`'s territory); repairing drift (doctor's territory); scheduled or
issue-triggered runs (specced separately in [propose-issue](propose-issue.md)).
