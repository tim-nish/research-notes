# Spec: propose review ergonomics — bulk accept/reject and a classification-axis preference

Status: proposed — the two design decisions below (§1 marker vocabulary,
§2 config shape) need a human yes/no before implementation. Amends
[propose](propose.md); motivated by dogfooding findings #7 and #8. Both fixes fold
their amendments into specs/propose.md as part of implementation (this file
stays as the change record).

## 1. Fix A — bulk review: explicit reject marker + `--accept-all` (normative)

**Problem (finding #7).** The report grammar knows exactly two states:
`- [x]` (accept) and `- [ ]` (everything else). Reviewing a large report
means toggling every accepted line by hand — 18 of 23 items in the first
live run — even when only a handful genuinely need a decision. There is
also no way to say "no, and don't re-propose this": items left unchecked
for cause (the duplicate pairs) came back verbatim on the next scan.

**Rule — marker vocabulary.** The report grammar gains one marker:

- `- [x]` — accept (unchanged);
- `- [ ]` — undecided (unchanged: skipped by apply, eligible for
  re-proposal by the next scan);
- `- [r]` — **rejected**: apply skips it and records it as `rejected` in
  the apply report table; a subsequent scan must not re-propose the
  *identical action* (same action type, same topic/cluster target, same
  citekey set) — the candidate papers still count as candidates and may
  appear under a *different* proposed action.

Rejection memory: apply appends rejected action lines verbatim to
`scratch/propose-rejected.md` (create if absent; one line per rejection,
prefixed with the report date). Scan mode reads this file (if present) and
filters identical actions before writing its report. This file is scratch
state, reviewable and hand-editable — deleting a line makes the action
proposable again; deleting the file resets all rejection memory.

**Rule — bulk accept.** `propose apply <report> --accept-all` treats every
parseable actionable item (`place`, `cluster`, `topic`, `restructure`) as
checked **except** lines marked `- [r]`. `defer` items remain informational
in every mode. Without the flag, behavior is unchanged (only `- [x]`
applies). A malformed actionable line still hard-stops apply in both modes.

**Compatibility.** The GitHub-issue loop ([propose-issue](propose-issue.md))
renders checkboxes in the issue UI, which has no third state; `[r]` is a
local-report affordance only. propose-issue keeps the two-state grammar and
is out of scope here.

**Spec amendments to fold in:** specs/propose.md report-grammar rules
(add `- [r]`), apply mode step 1 (parse `[r]`), step 5 (report `rejected`
rows), scan mode step 3 (rejection-memory filter), plus the two command
files (`.claude/commands/propose.md`, `.codex/prompts/propose.md`).

## 2. Fix B — classification-axis preference (normative)

**Problem (finding #8).** Papers that transplant a mechanism into a domain
(ViT, VMamba, graph transformers) are placeable along at least two
defensible axes — mechanism (`transformers`, `state-space-models`) or
application domain (`computer-vision`, `graph-neural-networks`) — and
nothing tells the scan which one the repo owner wants. The first live run
defaulted to domain-axis silently; a different run could defensibly choose
the opposite and violate nothing.

**Rule.** `config.json` (already optionally read by `zotero-fetch.js`;
absent today) gains an optional block:

```json
{
  "propose": {
    "axis": "domain",
    "axisNotes": "Architecture-transplant papers go to the domain they are applied in, not the mechanism they borrow."
  }
}
```

- `axis` ∈ `{domain, mechanism, lineage, benchmark}` — the preferred
  primary grouping axis when a candidate is groupable more than one way.
- `axisNotes` — optional freeform guidance carried into the proposing
  agent's context verbatim.

Scan mode reads the block before proposing. The report header gains one
line stating the axis in effect:
`Axis: domain (from config.json)` or `Axis: unset — per-run judgment`.
When the block is absent, behavior is today's (per-run judgment), but the
header line is now mandatory so the choice is at least visible. The axis is
guidance for grouping judgment, not a validator — doctor has no opinion on
it.

**Spec amendments to fold in:** specs/propose.md scan-mode step 3 and the
report grammar header; both command files.

## 3. Out of scope

Persisting rejection memory anywhere but scratch (no dotfile state
directory, no frontmatter); axis enforcement in doctor; retroactively
re-grouping already-placed papers when the axis config changes (that is a
human-initiated `restructure` conversation); propose-issue changes.

## 4. Acceptance criteria

- [ ] A report with `- [x]`, `- [ ]`, and `- [r]` lines: default apply
      applies only `[x]`; `--accept-all` applies `[x]` and `[ ]`, never
      `[r]`; the apply table shows `rejected` rows.
- [ ] After rejecting an action, the next unscoped scan does not re-propose
      the identical action; the affected citekeys still appear (different
      action or defer).
- [ ] Deleting the rejection line from `scratch/propose-rejected.md` makes
      the action proposable again.
- [ ] With `config.json` axis set, the report header names it; with no
      config, the header says per-run judgment. Two scans over the same
      corpus with opposite `axis` values group the ambiguous papers
      (VMamba/Vim, graph transformers) differently.
- [ ] Malformed checked lines still hard-stop apply in `--accept-all` mode.
