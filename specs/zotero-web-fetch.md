# Spec: zotero-web-fetch — Zotero Web API mode for `zotero-fetch.js`

Status: ready for implementation **after Story 0W (§6) passes**. Depends on:
[sync](sync.md) (extends its discovery script; classification, queue, and merge
semantics are unchanged). Consumer: [sync-scheduled](sync-scheduled.md).

## 1. Why this exists (the trigger decision)

The final product triggers `/sync` on a schedule via **Zotero Web API + GitHub
Actions**, decided against the alternatives:

- **GitHub Actions + local API** is impossible: `localhost:23119` exists only on
  the machine where desktop Zotero runs.
- **Windows Task Scheduler + headless Claude Code** works but ties sync to one
  machine being awake with Zotero open, adds a second automation substrate to
  maintain (Task Scheduler XML + local credentials + headless CLI on Windows),
  and is already awkward today: dev runs in a container while Zotero runs on the
  host (see the Story 0 findings in [sync](sync.md)). It also gives other users
  of the template nothing — it's a per-machine, per-OS recipe.
- **Zotero Web API + Actions** is machine-independent (`api.zotero.org` serves
  the same reads once the library syncs to zotero.org), reuses the exact
  automation substrate the issue-triggered survey already needs (Actions +
  headless Claude Code + PR review), and matches the a3 §2 interaction model:
  intent in (Connector save), diff out (sync PR).

The enabler that makes Web API mode possible without desktop Zotero: **Better
BibTeX writes pinned citekeys into the item's `Extra` field** (`Citation Key:
<key>`), and `Extra` syncs to zotero.org. So citekey resolution — the one thing
the local pipeline gets from BBT's JSON-RPC endpoint, which does not exist
remotely — is a field parse in Web mode. Unpinned items become
`blocked: no-citekey`, exactly as today.

Local mode is not removed: it stays the manual/dev path (`/sync` at the desk,
no zotero.org round-trip, works for never-synced libraries).

## 2. Scope

A third source inside `scripts/zotero-fetch.js` next to `liveSource` and
`fixtureSource`. Everything downstream of the source abstraction — pagination
loop, classification (create/enrich/skip/blocked), queue merge, exit codes — is
shared and unchanged. No new script.

## 3. CLI and configuration

```
node scripts/zotero-fetch.js --web [--collection to-note] [existing flags]
```

- `--web` (or `config.json`: `{ "zotero": { "mode": "web" } }`; flag wins).
- `ZOTERO_API_KEY` (env, required in web mode): a **read-only** key from
  zotero.org/settings/keys. The spec mandates read-only — sync never writes to
  Zotero (idempotency rule 5 of [sync](sync.md)), so the credential must not be
  able to either.
- `ZOTERO_USER_ID` (env) or `config.json` `{ "zotero": { "userId": ... } }`:
  the numeric userID shown on the same settings page.
- Missing key/userID in web mode → exit 3 (configuration failure) naming both
  variables.

## 4. Endpoint mapping

| Concern | Local mode | Web mode |
|---|---|---|
| Base | `http://localhost:23119/api/users/0` | `https://api.zotero.org/users/<userID>` |
| Auth | none | `Zotero-API-Key` header |
| Collections | `/collections` | same path |
| Items | `/collections/<KEY>/items/top?...` | same path + `itemType=-attachment` unchanged |
| Pagination | `limit`/`start` | same, plus honor the `Total-Results` header |
| Citekey | BBT JSON-RPC `item.citationkey` | parse `extra` field: first line matching `/^citation key:\s*(\S+)$/im` |
| Rate limits | n/a | honor `Backoff` and `Retry-After` response headers (sleep then retry, max 3; then exit 2) |
| Unreachable | exit 2 (Zotero not running) | exit 2 (network/API error; distinct message — "check zotero.org sync + API key") |

Staleness caveat (document in the fetch summary output): the Web API sees the
library as of its last sync to zotero.org, not the live desktop state. For a
scheduled pipeline this is harmless — un-synced saves are picked up next run.

## 5. Idempotency and safety

Unchanged from [sync](sync.md) §7 — the repo-side frontmatter join was designed
to be trigger-agnostic. One addition:

- Web mode must produce the same queue entries as local mode for the same
  library state (same `itemKey`s, same citekeys), so the two modes can be mixed
  freely: notes created from a scheduled web run are skipped by a later local
  run and vice versa. Test-enforced with paired fixtures.

## 6. Story 0W — spike (blocking)

Verify against the real zotero.org account before implementing; record findings
at the bottom of this file, as sync's Story 0 did:

- [ ] Read-only key + userID list collections and the `to-note` collection's
      top items.
- [ ] A BBT-pinned item's `extra` field, as returned by the Web API, contains
      the `Citation Key: <key>` line, and it matches the citekey BBT reports
      locally.
- [ ] An item pinned *after* first sync also shows the key (i.e. pinning marks
      the item dirty and re-syncs `extra`).
- [ ] `Total-Results` header and `limit`/`start` behave as documented on a
      collection with more items than one page.
- [ ] Note the account's sync settings required (file sync NOT required — only
      data sync).

## 7. Acceptance criteria

- [ ] `--web` with valid env produces a queue identical to local mode's on the
      same library (paired-fixture test plus one live comparison).
- [ ] Pinned citekey with unusual `extra` content (multiple lines, other
      `Key: value` pairs, `citation key` in lowercase) parses correctly;
      an `extra` without the line → `blocked: no-citekey`.
- [ ] Missing/invalid API key → exit 3/2 respectively, message names the fix,
      queue untouched.
- [ ] A `Backoff` header is honored (fixture-simulated) without failing the run.
- [ ] All existing local-mode tests still pass unmodified.

## 8. Tests

Web-response fixtures (same `--from-fixture` mechanism, new fixture shape keyed
by mode): pagination with `Total-Results`, extra-field citekey extraction edge
cases, rate-limit retry, auth failure, and the local/web queue-equivalence pair.

## 9. Out of scope

Group libraries (`/groups/<id>` — cheap to add later, not needed for a personal
library); `If-Modified-Since-Version` caching (an optimization, not
correctness); any Zotero write path (forbidden, as everywhere in this repo).
