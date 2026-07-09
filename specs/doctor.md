# Spec: `doctor` — repo invariant checker

Status: ready for implementation. Depends on: [build-catalog](build-catalog.md)
(checks D05/D07/D11 and `--fix` regeneration are defined against its output).
Consumers: `sync` (final validation step), CI, pre-commit.

## 1. Goal

A deterministic script `scripts/doctor.js` that validates repo invariants,
read-only by default, plus a thin agent wrapper (`/doctor` command in
`.claude/commands/doctor.md` and `.codex/prompts/doctor.md`) that runs the script
and explains failures in plain language with suggested next actions.

Rationale for building this second: it is the safety gate for `sync` and any
later unattended automation, and for a public release it converts every class of
repo drift from a support issue into a self-served fix.

## 2. CLI

```
node scripts/doctor.js [--fix] [--json]
```

- Default: run all checks, write nothing.
- `--fix`: repair only mechanically derivable artifacts — regenerate
  `catalog.json` and `INDEX.md` via the build-catalog module (clears D05/D07/D11
  when the drift was in generated files). Never touches note bodies, note
  frontmatter, or topic-map prose.
- `--json`: machine-readable findings for CI.

Exit codes: 0 clean (warnings allowed), 1 one or more `error`-severity findings,
2 environment/I-O failure.

## 3. Checks

| ID | Sev | Invariant |
|---|---|---|
| D01 | error | Every `papers/*.md` has parseable frontmatter with all required fields (`citekey,title,authors,year,url,depth,topics,added,updated`) |
| D02 | error | `citekey` matches filename |
| D03 | error | `depth` ∈ {metadata, abstract, sections, full} |
| D04 | error | Every `topics:` value matches a file in `topics/` |
| D05 | error | Every paper appears in INDEX.md exactly once per topic, with matching title/year/depth |
| D06 | error | Every `[[citekey]]` in `topics/*.md` resolves to a paper note |
| D07 | error | `catalog.json` in exact sync with frontmatter (byte-identical to a fresh build; delegates to `build-catalog --check`) |
| D08 | warn | `depth` ≥ sections but "Sections read" empty (or the converse) |
| D09 | warn | `updated` < `added`, or either missing/not ISO dates |
| D10 | warn | Paper's `topics:` names a map that doesn't list it in Clusters or Reading queue (drift) |
| D11 | warn | INDEX group ≠ frontmatter `topics` (e.g. "Unassigned" but `topics:` set) |
| D12 | warn | Topic map `updated` older than the newest note `updated` in that topic |
| D13 | warn | No two `papers/*.md` share a normalized DOI/arXiv id or a normalized title (frontmatter only; see [doctor-duplicates](doctor-duplicates.md)) |

## 4. Output

Human report grouped by severity, one line per finding:

```
error D02 papers/foo2024bar.md:2  citekey "foo2024baz" does not match filename
warn  D10 topics/signature-transformers.md  lists [[x2023y]] but x2023y has topics: []
```

`--json` emits `{ "findings": [{ "id", "severity", "file", "line", "message" }],
"errors": n, "warnings": n }`.

## 5. Safety rules (normative)

- Default run writes nothing.
- `--fix` writes only generated files (`catalog.json`, `INDEX.md`,
  `indexes/*.md` if split mode is on).
- Never deletes notes; unparseable files are reported (D01), never "repaired".
- The agent wrapper never edits files itself; it may *propose* frontmatter fixes
  (e.g. for D04/D10/D11) as a diff for the user to apply.
- D13 is never auto-resolved by `--fix` or the agent wrapper: dedup deletes a
  note, and that stays a human call. See the manual dedup playbook (§6a).

## 6a. Manual dedup playbook (D13)

All steps below are human actions — nothing here is scripted:

1. In Zotero: merge the duplicate items (Zotero's native merge keeps one item
   key; BBT keeps that item's citekey pinned).
2. In this repo: pick the surviving note (the one whose citekey matches the
   merged Zotero item). If the doomed note's body contains anything the
   survivor lacks (deeper depth, filled Method/Evidence), fold it into the
   survivor by hand and bump the survivor's `updated`.
3. Delete the doomed note file; `git rm` it.
4. Run `node scripts/build-catalog.js`, then `node scripts/doctor.js` — D13
   clears; a D06 error now names any topic map still linking the deleted
   citekey; fix those links via the `topic <t>` workflow (the deleted paper's
   frontmatter is gone, so re-derivation drops it).
5. If the deleted citekey was referenced from a project repo (via `link`),
   update that link — the join key is gone everywhere.

`/sync` needs no changes for this: after the Zotero merge, the next fetch sees
the doomed item key gone from the collection and drops any queue entry for it
(merge rule: absent from discovery → removed). See
[doctor-duplicates](doctor-duplicates.md) for the full rationale.

## 6. Acceptance criteria

- [ ] On the current repo, flags the known drift: 4 papers with empty `topics:`
      while clustered in `topics/signature-transformers.md` (D10), and any
      catalog/INDEX mismatch (D07) until build-catalog has been run.
- [ ] After `--fix` plus manually setting the 4 papers' `topics:` frontmatter, a
      second run is clean, and `node scripts/doctor.js && echo ok` is usable as a
      CI gate / pre-commit hook.
- [ ] Corrupt-frontmatter fixture → D01 error, exit 1, file untouched.
- [ ] `--fix` on a hand-dirtied INDEX.md regenerates it byte-identically to
      `build-catalog`'s output (single source of truth).
- [ ] `--json` output parses and round-trips the same findings as the human
      report.
- [ ] Fixture with two notes sharing an arXiv id but different titles → one
      D13 warning naming both files; exit code stays 0 when no errors exist
      (warn severity).
- [ ] Fixture with two notes sharing a normalized title, no DOI → D13.
- [ ] Distinct papers, distinct keys → no D13.
- [ ] `--fix` leaves both notes of a D13 pair untouched.
- [ ] Live repo: exactly two D13 warnings (the vaswani and dosovitskiy pairs)
      until a human runs the playbook (§6a); zero after.

## 7. Tests

- One fixture repo per check ID (13 fixtures), each asserting the check fires
  exactly once and nothing else fires.
- Clean-repo fixture asserting zero findings.
- `--fix` idempotency: second `--fix` changes nothing.
- Exit-code matrix: clean→0, warn-only→0, any error→1.

## 8. Out of scope

Auto-fixing frontmatter or topic maps; watching mode; network access of any kind.
