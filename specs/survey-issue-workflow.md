# Spec: survey-issue-workflow — `.github/workflows/survey-issue.yml`

Status: ready for implementation. Part of the [survey-issue](survey-issue.md)
trigger; reads issues created by [survey-issue-form](survey-issue-form.md).

## 1. File and triggers

`.github/workflows/survey-issue.yml`:

```yaml
on:
  issues:
    types: [opened, labeled]
```

Job-level guard: proceed only if the issue carries `survey-request` **and**
(author_association ∈ {OWNER, MEMBER, COLLABORATOR} **or** the event is a
`survey-approved` label being added). All other events exit without running any
paid step.

```yaml
concurrency:
  group: survey-issue-${{ github.event.issue.number }}
  cancel-in-progress: false
permissions:
  contents: write        # push the survey branch
  pull-requests: write   # open/update the PR
  issues: write          # comment + labels
timeout-minutes: 30
```

Secrets: `ANTHROPIC_API_KEY` (required; fail with a clear issue comment if
unset — template users will hit this first).

## 2. Steps

1. **Checkout + Node setup + `npm ci`.**
2. **Extract topic** from the issue body (`### Topic` section — contract in the
   form spec). Shell step; sanitize to `[A-Za-z0-9_-]+` before any further use
   (the value ends up in branch names and prompts — never interpolate raw issue
   text into a shell command).
3. **Validate**: `topics/<topic>.md` exists, and `node scripts/doctor.js` exits
   0. On failure: comment + label per the failure table in
   [survey-issue](survey-issue.md) §6; stop.
4. **Run the survey** headlessly with Claude Code so the repo's own
   `.claude/commands/survey.md` executes — one workflow definition, used
   identically by humans and CI. Recommended runner:
   `anthropics/claude-code-action@v1` with `prompt: "/survey <topic>"`
   (it manages CLI install and auth). Fallback if the action is unsuitable:
   `npm i -g @anthropic-ai/claude-code && claude -p "/survey <topic>"`.
   Restrict tools to what `survey` needs: read access to the repo, write access
   to `scratch/` only, and `Bash(node scripts/*)`.
5. **Enforce the write boundary**: `git status --porcelain` must show only new
   or modified files under `scratch/`; anything else fails the job before
   pushing.
6. **Publish**: commit to branch `survey/issue-<N>` (force-push on re-runs, so
   one issue maps to one PR), open or update a PR titled
   `Survey draft: <topic>` with `Closes #<N>` in the body.
7. **Report**: comment on the issue with the PR link (or the failure comment +
   label from §6 of the main spec).

## 3. Non-goals / guards

- Never runs on issue *comments* (comment-command triggers invite prompt
  injection from anyone who can comment; the label gate is the only escalation
  path).
- Never passes the issue's free-text "notes" field to the agent.
- No auto-merge; the PR is the review surface.
- Scheduled or bulk survey generation is out of scope.

## 4. Acceptance criteria

- [ ] Matrix of trigger events behaves per §1: owner-opened issue runs;
      stranger-opened issue waits; `survey-approved` added by a collaborator
      runs; unrelated labels never run.
- [ ] A run that (artificially) writes outside `scratch/` fails at step 5 and
      opens no PR.
- [ ] Branch naming: two requests for different topics produce two independent
      PRs; two runs for the same issue reuse one branch.
- [ ] With `ANTHROPIC_API_KEY` unset, the requester gets an actionable comment,
      not a silent red run.
- [ ] Topic containing `-` (e.g. `signature-transformers`) survives extraction,
      validation, branch naming, and the prompt.

## 5. Tests

Workflow logic that can be unit-tested lives in a small script
(`scripts/issue-topic.js`: body → topic, or null) with `node --test` coverage
for extraction and sanitization edge cases (hyphens, empty, injection attempts
like `foo; rm -rf`). The YAML itself is validated by `actionlint` in CI if
available, else by the live acceptance matrix above.
