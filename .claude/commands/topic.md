---
description: Create or update a topic map — idempotent, membership derived strictly from frontmatter
argument-hint: <kebab-name or short topic description>
---

Follow the `topic` workflow defined in CLAUDE.md and specs/topic.md for: $ARGUMENTS

With no argument: list the topic maps under `topics/` and stop.

Steps:
1. Derive a kebab-case name from `$ARGUMENTS`, unless it already provides one.
   - If `topics/<name>.md` does not exist: create it from `templates/topic.md`,
     filling `topic:` and `one_liner:` (create path).
   - If it exists: proceed with the existing file (update path).
   - Never refuse because the file already exists — `topic` is one idempotent
     verb, "make this map true," not create-only.
2. **Membership is exactly the frontmatter set.** Read `catalog.json` and take
   every paper whose `topics:` list contains `<name>` — that is the entire
   membership for this run. Never add a paper the frontmatter doesn't name.
   Never edit `papers/` to change that set.
3. Re-derive the derived sections from that membership set only:
   - **Shape of the field** — short factual prose synthesis from the members'
     catalog `contribution` lines. Open a paper note body only when a
     contribution line is insufficient to characterize it (cost-ladder
     discipline — don't read more than you need).
   - **Clusters** — every member with a non-empty `contribution` appears in
     exactly one cluster, as `[[citekey]]` links with a factual one-line
     characterization per cluster. If this run was invoked by `/propose apply`
     with accepted cluster names/memberships (and any checked `restructure`
     instructions), treat them as binding guidance for how to group this run's
     Clusters.
   - **Reading queue** — reconciliation is removal-only. Members with an empty
     `contribution` (typically `depth: metadata`) stay in, or land in, the
     queue. Remove any citekey that is now placed in Clusters, or whose
     frontmatter no longer names this topic. Never add an untagged paper to
     the queue — that placement judgment belongs to `/propose`.
4. **Human sections are preserved.** Leave **Open questions** byte-identical;
   propose any additions in your report only, never in-place. Leave
   **Outputs** untouched.
5. If nothing changed relative to the file on disk, say "no changes" and leave
   `updated` alone. Otherwise bump `updated` to today.
6. Run `node scripts/build-catalog.js`.

Never write `papers/`, `catalog.json`, or `INDEX.md` directly (generated files
only, via `build-catalog.js`). Never delete a topic map, never overwrite Open
questions/Outputs, never remove prose you cannot re-derive — if the map is
unparseable, report that and stop; don't repair it. Facts only: cluster
characterizations and Shape prose carry no project-relevance or priority
judgments.

Out of scope here: placement judgment for untagged papers (`/propose`'s job);
renaming or merging topic files (a manual git operation — `/propose` may
*suggest* a merge via a `restructure` item, but executing a rename stays
human); multi-topic batch runs (`/propose apply` iterates this workflow once
per affected map instead).

Report: created or updated, membership count, what changed in Clusters/Shape
of the field, Reading-queue reconciliation, and any proposed Open-questions
additions.
