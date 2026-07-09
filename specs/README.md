# Implementation specs (BMAD input)

One file per implementation unit, from the agreed designs
(tag-less, collection-scoped sync; no Zotero write path). Each spec is
self-contained and can be fed to BMAD independently, but they share the
conventions and build order below.

**[Implementation status](#implementation-status)** below is the single source
of truth for what is still unimplemented. The **[Build order](#build-order-dependencies-flow-downward)**
list is dependency ordering only — it does not track status.

## Implementation status

The table lists **only specs that are not yet fully implemented**. Every other
spec in the build order below is shipped (verify against `scripts/`,
`.claude/commands/`, `.codex/prompts/`, `test/`, `.github/`). **When a spec
becomes fully implemented, delete its row.** When a partially-implemented spec's
remaining work lands, delete the row (or narrow it to what is still open).

| Spec file | Status | Depends on | Release impact | Blocked by open design decision |
|-----------|--------|------------|----------------|---------------------------------|
| [zotero-web-fetch](zotero-web-fetch.md) | Not implemented — Story 0W spike must pass first (no Web API path in `zotero-fetch.js`) | `sync` | **Before** if v1 ships the automated no-terminal loop; else fast-follow † | Yes — the launch-trigger decision † |
| [sync-scheduled](sync-scheduled.md) | Not implemented (no workflow file) — the final-product `/sync` trigger | `zotero-web-fetch`, `sync`, `sync-backlog`, `doctor` | **Before** (with `zotero-web-fetch`) † | Tied to † |
| [dedup](dedup.md) — Unit B (`dedup apply`) | Partial: Unit A (report checklist) shipped; `dedup apply` unbuilt | `dedup` Unit A, `doctor-duplicates`, `topic`, `build-catalog` | After | No |
| [survey](survey.md) — §3–§4 | Partial: §2 shipped/normative; §3 (`--form`) + §4 (`--render`) unbuilt | `survey` | After | **Yes** — §3/§4 designs open (decide together) |
| [propose-review-ergonomics](propose-review-ergonomics.md) | Not implemented (no `reject`/`--accept-all` in command, scanner, or grammar) | `propose` | After | **Yes** — §1 marker vocabulary + §2 config shape |
| [survey-issue](survey-issue.md) (+ [form](survey-issue-form.md), [workflow](survey-issue-workflow.md)) | Not implemented (no `.github/ISSUE_TEMPLATE/`, no workflow) — implement the three together | `survey`, `doctor`, `build-catalog` | After (ahead-of-need) | No |
| [propose-issue](propose-issue.md) | Not implemented — ahead-of-need (after local `propose` is proven) | `propose`, `propose-scan`, `topic`, `doctor`, survey-issue pattern | After | No |

† **The one launch-shaping decision:** does v1 ship with the automated
no-terminal loop (requires `zotero-web-fetch` + `sync-scheduled`, gated on the
Story 0W spike — the long pole), or with the working **manual `/sync`** as the
supported v1 path (moving both to fast-follow)? Everything else in this table is
unambiguously post-release.

## Build order (dependencies flow downward)

1. **[build-catalog](build-catalog.md)** — generation pipeline for `catalog.json`
   and `INDEX.md`. Everything else reads or validates its output.
2. **[doctor](doctor.md)** — repo invariant checker. Prerequisite for safe
   automation; `sync` ends by running it.
3. **[sync](sync.md)** — Zotero → repo pipeline (discovery script + agent
   workflow).
4. **[sync-backlog](sync-backlog.md)** — queue file format and batch/resume
   semantics used by `sync`. Implement together with or immediately after `sync`;
   split out as its own spec because the queue contract is what makes bulk
   imports and crash recovery testable in isolation.
5. **[survey-issue](survey-issue.md)** — trigger `/survey` from a GitHub Issue;
   the first issue-triggered workflow (runs entirely from repo content, no
   Zotero needed). Its two new files are specced separately:
   [survey-issue-form](survey-issue-form.md) (issue template) and
   [survey-issue-workflow](survey-issue-workflow.md) (Actions workflow).
6. **[zotero-web-fetch](zotero-web-fetch.md)** — Zotero **Web API** mode for
   `zotero-fetch.js`; blocked on its own spike (Story 0W). Contains the
   decision rationale for how `/sync` is triggered in the final product.
7. **[sync-scheduled](sync-scheduled.md)** — scheduled `/sync` via GitHub
   Actions on the Web API mode; depends on 6.
8. **[topic](topic.md)** — redesigned `topic` command: one idempotent
   create-or-update verb, strict frontmatter-derived membership; retires the
   `update` command.
9. **[propose-scan](propose-scan.md)** — deterministic candidate scanner
   (`scripts/propose-scan.js`) plus extraction of doctor's topic-map parser
   into `scripts/lib/topic-map.js`.
10. **[propose](propose.md)** — the `propose` command and its
    `propose apply` path. Supersedes the retired `topic-propose` draft; the
    draft's open points are resolved in this spec.
11. **[sync-placement](sync-placement.md)** — amendment: `sync`/`add` stop
    making placement judgments; `propose` becomes the only placement path.
    Implement together with 8–10.
12. **[propose-issue](propose-issue.md)** — the propose → checkbox review →
    apply loop on GitHub Issues; implement only after local `propose` has
    survived dogfooding.
13. **[sync-stage1-fixes](sync-stage1-fixes.md)** — change record for
    dogfood findings #2/#6: source-aware completeness, `blocked: no-year`,
    doctor STOP notice.
14. **[doctor-duplicates](doctor-duplicates.md)** — D13 duplicate-paper
    warning + manual dedup playbook (dogfood finding #5).
15. **[survey](survey.md)** — `survey` had no spec; §2 corpus-fidelity
    guarantees are normative (finding #10), §3/§4 cover output-form and
    citation-rendering design (findings #11/#12).
16. **[propose-review-ergonomics](propose-review-ergonomics.md)** — reject
    marker + `--accept-all` + classification-axis preference (findings
    #7/#8).
17. **[dedup](dedup.md)** — turn a D13 duplicate group into a reviewable
    checkbox choice checklist. Unit A is report generation; `dedup apply` and
    issue automation are later increments. Depends on 14 (D13 detector) and
    reuses 9's topic-map scan.

## Shared engineering conventions (normative for all four specs)

- **Split of responsibilities:** deterministic work lives in small Node.js
  single-file CLIs under `scripts/`, run as `node scripts/<name>.js`. Judgment
  work (summarizing abstracts, topic placement, prose) lives in agent command
  prompts (`.claude/commands/*.md`, `.codex/prompts/*.md`) that call those
  scripts.
- **Dependencies:** `js-yaml` only. The repo currently has an empty
  `package-lock.json` and **no `package.json`** — creating
  `package.json` (private, `"type": "commonjs"`, js-yaml pinned) is Story 1 of
  the build-catalog spec.
- **Single source of truth:** frontmatter in `papers/*.md` is the only
  authoritative metadata store. `catalog.json` and `INDEX.md` are generated,
  never hand-edited. Topic maps contain human prose and are never written by
  scripts.
- **Write-if-changed:** every generated file is byte-compared before writing so
  no-op runs leave `git status` clean.
- **Exit codes:** 0 = success/clean, 1 = findings/errors in repo content,
  2 = environment failure (e.g. Zotero unreachable), 3 = configuration failure
  (e.g. collection not found).
- **Tests:** plain Node test runner (`node --test`), fixtures under
  `test/fixtures/`. No test may require Zotero or network; Zotero API responses
  are fixture JSON consumed via `--from-fixture`.
- **Safety:** scripts never delete or rewrite human-authored note bodies or
  topic-map prose. Unparseable files are reported, never "repaired".
