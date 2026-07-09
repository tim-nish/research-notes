# Spec: sync-scheduled — `.github/workflows/sync-scheduled.yml`

Status: ready for implementation after [zotero-web-fetch](zotero-web-fetch.md)
ships and its Story 0W passes. Depends on: [sync](sync.md),
[sync-backlog](sync-backlog.md), [doctor](doctor.md). This is the final-product
trigger for `/sync` (decision rationale in zotero-web-fetch §1); the manual
`/sync` command remains as the local/dev path.

## 1. File and triggers

`.github/workflows/sync-scheduled.yml`:

```yaml
on:
  schedule:
    - cron: "0 */6 * * *"    # every 6 hours; papers are not urgent
  workflow_dispatch:          # manual "sync now" button
concurrency:
  group: sync-scheduled
  cancel-in-progress: false
permissions:
  contents: write
  pull-requests: write
timeout-minutes: 30
```

Secrets/vars: `ZOTERO_API_KEY` (read-only), `ANTHROPIC_API_KEY` (secrets);
`ZOTERO_USER_ID` (repo variable). **If any is unset, exit 0 with a log notice,
not a failure** — the template ships this workflow, and users who haven't
configured scheduled sync must not get red runs. (GitHub also auto-disables
schedules on new template copies until enabled — document that in setup.)

## 2. The branch model (the one design point that isn't just plumbing)

Notes authored by a scheduled run sit in an unmerged PR; the next scheduled run
starts from the default branch and would re-discover the same items (the
frontmatter join only sees merged notes). Rule:

- The workflow uses one long-lived output branch, **`sync/zotero`**.
- On start: if `sync/zotero` exists on the remote, check it out (continue the
  backlog on top of prior unmerged batches); otherwise create it from the
  default branch. If it exists but has conflicts with the default branch,
  comment on the open PR and stop — human resolves.
- One PR from `sync/zotero` to the default branch, opened when the first batch
  lands and updated (body regenerated: items this run / total pending) on each
  subsequent run. Merging it resets the cycle; the branch is recreated fresh
  next time.

This keeps discovery correct without any CI-side state: the branch itself is
the "what's already authored" record, exactly as the repo is locally.

## 3. Steps

1. Checkout per §2; Node setup; `npm ci`.
2. `node scripts/zotero-fetch.js --web --dry-run` → if 0 pending, **exit 0
   before any agent step** (zero API cost on quiet days; this is the common
   case and must stay free).
3. `node scripts/zotero-fetch.js --web` to write the queue. (`.sync/` is
   gitignored and ephemeral in CI — fine: the queue rebuilds from the discovery
   diff, and repo state is the source of truth per sync-backlog §2.)
4. Run one batch of the repo's own `/sync` command headlessly (same runner
   choice as [survey-issue-workflow](survey-issue-workflow.md) §2 step 4:
   `anthropics/claude-code-action@v1`, fallback raw CLI; tools restricted to
   repo reads, writes under `papers/`, `topics/`, and the generated files, and
   `Bash(node scripts/*)`). Default batch size 15 — one batch per scheduled
   run; a 100-item import drains over ~7 scheduled runs by design (bounded cost
   per run beats one giant run).
5. Gate: `node scripts/doctor.js` must exit 0 on the result; on error-severity
   findings, push nothing, open/comment an issue labeled `sync-failed` with the
   doctor output, stop. (Automation without the doctor gate "manufactures drift
   faster than you can notice it" — a3 §2.)
6. Commit to `sync/zotero` (message: `sync: <n> notes from Zotero (<date>)`),
   push, open or update the PR. PR body: table of citekeys/actions/depths from
   the run report + remaining-pending count.

## 4. Failure behavior

| Failure | Behavior |
|---|---|
| Secrets unconfigured | exit 0 with notice (template default state) |
| Zotero Web API unreachable / rate-limited past retries | exit 2; scheduled runs report failure only after 2 consecutive failures (transient API blips shouldn't page anyone) |
| Agent run fails mid-batch | queue semantics already handle partial batches; push whatever passed doctor, note the failure in the PR body |
| Doctor errors on the result | no push; `sync-failed` issue with findings |
| `sync/zotero` conflicts with default | comment on PR; human resolves; runs no-op until then |

## 5. Acceptance criteria

- [ ] With secrets set and 2 new items in the collection: scheduled run opens a
      PR with 2 notes, populated `zotero:` links, regenerated catalog/INDEX,
      green CI, and a body table matching the notes.
- [ ] Next run with nothing new: no agent invocation (verified from the run
      log), no PR churn, exit 0.
- [ ] 40-item backlog: three consecutive runs stack batches on one PR, body
      shows declining pending count; merging the PR + one more run → 0 pending,
      no re-created notes.
- [ ] Fork/template copy without secrets: green no-op runs.
- [ ] Doctor-failing authored batch: nothing pushed, `sync-failed` issue
      contains the findings.

## 6. Out of scope

Deepen-request markers read during sync (a3 §2's "markers" layer — later);
auto-merge; per-user schedule configuration beyond editing the cron line;
Windows Task Scheduler / local timers (superseded by this spec; a local
`/sync` remains available manually).
