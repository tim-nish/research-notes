# Spec: `propose-scan` — deterministic candidate scanner for `propose`

Status: ready for implementation. Depends on: [build-catalog](build-catalog.md)
(reads `catalog.json`), [doctor](doctor.md) (shares its topic-map parser — see
§3). Consumer: the [propose](propose.md) command and the
[propose-issue](propose-issue.md) workflow.

## 1. Goal

Candidate detection for `propose` is deterministic work and therefore belongs
in a script (shared conventions, specs/README.md), not in agent judgment: the
long-term goal is unattended GitHub automation, and an unattended pipeline
needs a testable, reproducible answer to "which papers are unplaced?".

The draft `topic-propose` spec flagged (its §8.2) that candidate classes are
*not derivable from `catalog.json` alone* — "in no cluster" and "only in a
Reading queue" require parsing `topics/*.md`, which today only
`scripts/doctor.js` does. This spec resolves that by sharing doctor's parser.

## 2. CLI

```
node scripts/propose-scan.js [--topic <name>] [--json]
```

- Default: human-readable summary (candidate counts per class, per-topic
  membership counts).
- `--json`: full machine output (§5) — what `propose` consumes.
- `--topic <name>`: restrict candidates to those relevant to one topic
  (papers whose frontmatter names it, plus papers appearing only in that
  map's Reading queue). Unassigned papers with no topic affinity are excluded
  from scoped runs.
- Read-only, no network, no writes of any kind.

Exit codes (shared convention): 0 success; 1 content problem (missing or
unparseable `catalog.json` / topic map — message says to run
`node scripts/build-catalog.js` or fix the named file); 2 unexpected I/O
failure; 3 configuration failure (`--topic` names no file in `topics/`).

## 3. Story 1 — extract the shared topic-map parser

`scripts/doctor.js` already implements and exports `parseTopicFile` (returns
each `[[citekey]]` link tagged with whether it sits under `## Clusters` or
`## Reading queue`). Two independent parsers of the same human-edited format
would drift; requiring one CLI from another is also the wrong shape. So:

1. Move `parseTopicFile` (and only it) to `scripts/lib/topic-map.js`.
2. `doctor.js` and `propose-scan.js` both `require('./lib/topic-map')`.
3. Doctor's exports, behavior, and tests are unchanged (its test suite is the
   regression gate for the extraction).

## 4. Candidate classes (normative definitions)

Let `F(p)` = the paper's `topics:` frontmatter (from `catalog.json`), `C(p)` =
the set of maps whose **Clusters** list `[[p]]`, `Q(p)` = the set of maps whose
**Reading queue** lists `[[p]]`.

| Class | Definition |
|---|---|
| `unassigned` | `F(p)` empty **and** `C(p)` and `Q(p)` both empty |
| `queue-only` | `C(p)` empty **and** `Q(p)` non-empty |

Papers with non-empty `C(p)` are settled and are never candidates. Papers
where `F(p)` disagrees with map membership are **drift**, not candidates —
that is doctor D10/D11 territory; the scanner does not re-diagnose it (the
`propose` report surfaces doctor's own warnings in its appendix instead).

## 5. `--json` output schema

```json
{
  "schema": 1,
  "generated": "2026-07-08T00:00:00Z",
  "scope": null,
  "topics": [
    {
      "name": "time-series-generation",
      "one_liner": "…",
      "clusters": [{ "name": "Flow-based generators", "citekeys": ["…"] }],
      "readingQueue": ["…"]
    }
  ],
  "candidates": [
    {
      "citekey": "kim2024flow",
      "class": "unassigned",
      "title": "…",
      "year": 2024,
      "depth": "abstract",
      "topics": [],
      "contribution": "…",
      "queuedIn": []
    }
  ]
}
```

`topics` gives `propose` everything it may know about the maps (one_liner +
structure — deliberately *not* the prose bodies, enforcing the reading
budget). `candidates` carries the catalog record fields `propose` is allowed
to read, plus `queuedIn` (the maps whose Reading queue list the paper; empty
for `unassigned`). Cluster names are taken verbatim from the `### `/bold
heading or list-group label doctor's parser already recognizes; a cluster
whose label cannot be determined gets `"name": null` (reported in the human
summary as a warning, still valid JSON).

## 6. Safety rules

- Never writes any file. Never "repairs" an unparseable map — reports it and
  exits 1 (same discipline as doctor D01).
- Output ordering is deterministic: topics by filename, clusters in file
  order, candidates by citekey — so identical repo state yields byte-identical
  output (diffable in automation logs).

## 7. Tests and fixtures

Fixture repos under `test/fixtures/propose-scan/` (also referenced by
[propose](propose.md) §8 acceptance):

1. **orphan** — 3 papers, 1 topic map; one paper `topics: []`, absent from the
   map → exactly one `unassigned` candidate.
2. **queue-only** — paper listed in a Reading queue, `topics:` set → exactly
   one `queue-only` candidate with correct `queuedIn`.
3. **settled** — every paper clustered → `candidates: []`.
4. **drift** — paper with `topics: [x]` but not listed in map x → **zero**
   candidates (drift excluded), scanner exits 0.
5. **scoped** — `--topic` filters as defined in §2; unknown topic exits 3.
6. **broken-map** — malformed topic map → exit 1, file named, no output JSON.

`node --test` units: one per fixture, plus a determinism test (two runs,
byte-identical output) and the doctor-suite regression run after the Story 1
extraction.

## 8. Out of scope

Similarity scoring or any ranking between candidates and topics (judgment —
that is `propose`'s half); parsing report files (the apply grammar lives in
propose §5); writing membership back anywhere.
