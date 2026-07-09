# Spec: `propose-issue` — the propose → review → apply loop on GitHub Issues

Status: specced ahead of need — implement only after local `propose` has been
boringly reliable through dogfooding (same sequencing guard as
[survey-issue](survey-issue.md), whose authorization and guard patterns this
spec reuses wholesale). Depends on: [propose](propose.md),
[propose-scan](propose-scan.md), [topic](topic.md), [doctor](doctor.md),
[survey-issue-workflow](survey-issue-workflow.md) (pattern donor).

## 1. Goal

Complete the no-CLI operating loop. With [sync-scheduled](sync-scheduled.md)
landing notes as PRs and [survey-issue](survey-issue.md) drafting surveys from
issues, placement is the remaining step that forces a terminal. Target
end-state, entirely on GitHub surfaces:

```
Zotero save ─▶ scheduled sync PR ─▶ merge
                                     │  propose run (issue-triggered; later auto)
                                     ▼
                    issue "Topic proposals <date>" — the §5 report as checkboxes
                                     │  human checks boxes, labels propose-approved
                                     ▼
                    apply run ─▶ PR (frontmatter + topic maps + generated files)
                                     │  human reviews diff, merges
                                     ▼
                    survey-request issue ─▶ survey PR
```

The propose report grammar (propose §5) is the contract that makes this work:
GitHub renders `- [ ]` lines as checkboxes that anyone with write access can
tick in place, so the issue *is* the decision record — no new UI.

## 2. Trigger A — run propose, post the report as an issue

- Issue form `propose-request.yml` (label `propose-request`, optional topic
  scope field) — mirroring [survey-issue-form](survey-issue-form.md).
- Workflow `propose-issue.yml`: authorization gate and doctor gate identical
  to survey-issue §4/§6; then headless Claude Code runs the repo's own
  `/propose [topic]`.
- The generated report body is posted as a **comment on the issue** (not a
  file, not a PR — a propose run changes nothing, so there is nothing to
  merge). Nothing-to-propose runs comment exactly that.
- Guard: the run must leave the working tree clean except `scratch/` —
  enforced mechanically before commenting, as in survey-issue §3.3.
- Re-triggering posts a fresh comment (state may have changed); the previous
  comment is collapsed via `<details>` edit to avoid two live checklists.

## 3. Trigger B — apply the checked items

- A user with write access ticks checkboxes in the latest report comment and
  adds the label `propose-approved` (labeling requires triage rights, so the
  labeler is the authorization — same argument as survey-issue §4).
- Workflow: fetch the latest report comment body → write it to
  `scratch/propose-issue-<N>.md` → headless Claude Code runs
  `/propose apply scratch/propose-issue-<N>.md` on branch
  `propose/issue-<N>` → PR "Apply topic proposals (#<N>)".
- **Write boundary, enforced before the PR opens**: the diff may touch only
  `papers/*.md` (frontmatter-level changes), `topics/*.md`, `catalog.json`,
  `INDEX.md`, and the scratch report copy. Anything else fails the workflow.
- Doctor must exit 0 on the branch or the workflow fails instead of opening
  the PR.
- Re-labeling force-updates the same branch/PR (survey-issue §3.5 semantics).
- Every terminal outcome — report posted, applied PR link, nothing checked,
  parse failure (propose §6.1), unauthorized, doctor gate — is an issue
  comment.

## 4. Failure behavior

| Failure | Behavior |
|---|---|
| Unauthorized author, no approval | comment explaining approval path; no run |
| Doctor errors on checkout | comment "repo drift, fix first"; no run |
| No checked items when `propose-approved` added | comment; no branch, no PR |
| Checked line fails the grammar | comment quoting the line; no writes (propose §6.1) |
| Diff escapes the write boundary | workflow fails before PR; comment with run link |
| Agent run fails/times out | comment with Actions run link; label `propose-failed` |

## 5. Acceptance criteria

- [ ] Owner opens a propose-request issue → report comment appears whose
      checkbox counts match a local `propose` run on the same commit; repo
      untouched.
- [ ] Ticking two boxes + `propose-approved` → PR whose diff is exactly those
      items' frontmatter edits plus derived map/generated-file changes; issue
      comment links it; CI green.
- [ ] Unchecked items' papers untouched in the PR diff.
- [ ] Re-label after merging → fresh run reports the applied items as
      "skipped (already satisfied)"; no duplicate PR stacking.
- [ ] Non-collaborator request → no run until maintainer approval, exactly as
      survey-issue.

## 6. Out of scope (deliberately, for now)

Auto-running propose after every scheduled-sync merge (add once the manual
trigger is proven — it is a one-line `workflow_run` addition); auto-merge of
apply PRs (review is the point); editing checkbox state from the PR side;
issue triggers for `deepen`/`add`.
