# Spec: survey-issue — trigger `/survey` from a GitHub Issue

Status: ready for implementation (after the core loop has been "boringly
reliable by hand" per the sequencing guard). Depends on: the
existing `survey` command, [doctor](doctor.md), [build-catalog](build-catalog.md).
Companion specs for the two new files this trigger requires:
[survey-issue-form](survey-issue-form.md) (issue template) and
[survey-issue-workflow](survey-issue-workflow.md) (GitHub Actions workflow).

## 1. Goal

Give `/survey` a browser- and phone-accessible trigger using GitHub's own
surfaces (a1 §2.2, a3 §2): the user opens an issue naming a topic; an Action runs
the repo's own `survey` command headlessly; the draft comes back as a pull
request linked to the issue. Intent in, diff out — the human appears only at
review. No new UI, no new runtime: the command prompt in `.claude/commands/`
stays the single definition of the workflow.

Survey is the right first issue-triggered workflow because it reads only repo
content (topic map + paper notes) — unlike `sync`, it needs no Zotero access, so
it can run entirely on a GitHub-hosted runner.

## 2. End-to-end flow

```
user ──"Survey request" issue form──▶ issue (label: survey-request, body: topic)
                                        │  GitHub Actions (survey-issue.yml)
                                        ▼
                       authorization gate (§4) → topic validation (§5)
                                        │
                                        ▼
                       headless Claude Code runs the repo's /survey <topic>
                                        │
                                        ▼
                       branch survey/issue-<N> + PR "Survey draft: <topic>"
                       (contains only scratch/survey-<topic>-draft.md)
                                        │
                                        ▼
                       comment on the issue linking the PR; human reviews/merges
```

## 3. Contract (normative)

1. The issue is the intent record; the PR is the output; the issue body's topic
   field is the only input read from the issue.
2. Unattended runs never commit to the default branch (a3 §2) — output is always
   a branch + PR.
3. The PR touches only `scratch/` (the `survey` command's own rule: never
   publish directly). If the run tries to modify anything else, the workflow
   fails rather than opening the PR.
4. Every terminal outcome (success, invalid topic, unauthorized, run failure) is
   reported as an issue comment, so the requester never has to open the Actions
   tab.
5. Re-running (re-adding the label) force-updates the same branch/PR rather than
   stacking new ones.

## 4. Authorization

Runs cost real API money, and issue forms auto-apply labels regardless of who
opens the issue, so the label alone must not authorize a run:

- Run immediately when the issue author's `author_association` is `OWNER`,
  `MEMBER`, or `COLLABORATOR`.
- Otherwise: comment that a maintainer must approve, and run only when a user
  with write access adds the `survey-approved` label (adding labels itself
  requires triage rights, so the *labeler* is the authorization).
- `ANTHROPIC_API_KEY` lives in repo secrets; secrets are not exposed to runs
  triggered from forks (issues are not fork PRs, so this is safe by
  construction, but the workflow must still never echo secrets).

## 5. Topic validation

Before invoking the agent: the topic named in the issue must match a file
`topics/<topic>.md`. On failure, comment with the list of available topic names
(from `topics/*.md`), apply label `survey-invalid`, and stop — no agent run, no
API cost. This is a plain shell step, not agent judgment.

## 6. Failure behavior

| Failure | Behavior |
|---|---|
| Unauthorized author, no approval label | comment explaining the approval path; no run |
| Topic doesn't match `topics/*.md` | comment listing topics; label `survey-invalid`; no run |
| Agent run fails / times out | comment with the Actions run link; label `survey-failed`; no PR |
| Run modified files outside `scratch/` | workflow fails before PR creation; comment as above |
| Doctor reports errors on checkout | comment "repo drift, fix first"; no run (don't draft from a broken corpus) |

## 7. Acceptance criteria

- [ ] Owner opens a survey-request issue for an existing topic → PR appears with
      exactly one new file under `scratch/`, issue gets a comment linking it,
      CI on the PR is green.
- [ ] Issue for a nonexistent topic → comment lists available topics; no agent
      run appears in the Actions log beyond the validation step.
- [ ] Issue from a non-collaborator → no run until a maintainer adds
      `survey-approved`; then it runs.
- [ ] Re-adding the trigger label on the same issue updates the existing PR
      branch instead of opening a second PR.
- [ ] The draft flags `depth: metadata`-based claims exactly as a local
      `/survey` run does (the same command prompt is executing).

## 8. Out of scope

Issue triggers for other workflows (`deepen`, `add`) — same pattern, add after
this one is proven; auto-merge of survey PRs (review is the point); scheduled
surveys.
