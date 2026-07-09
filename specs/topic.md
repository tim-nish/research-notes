# Spec: `topic` — create or update a topic map (redesigned, subsumes `update`)

Status: ready for implementation. Depends on: [build-catalog](build-catalog.md)
(reads `catalog.json`), [doctor](doctor.md) (D04/D06/D10/D12 validate its
output). Consumers: [propose](propose.md) (`propose apply` invokes this
workflow per affected topic), [propose-issue](propose-issue.md).

## 1. Goal and rationale for the redesign

The intended semantics are: **`topic` explicitly creates or updates a topic;
`propose` recommends without deciding.** The current implementation splits
this across two commands (`topic` = create-only, refuses if the file exists;
`update` = re-derive) and, worse, the create path "populates Clusters from
existing paper notes that clearly belong" — a placement judgment that writes
`[[citekey]]` links into a map for papers whose `topics:` frontmatter is
empty. That *manufactures* doctor D10 drift by design (doctor's own spec uses
exactly this case as its D10 example) and duplicates the judgment `propose`
exists to make reviewable.

The redesign makes `topic <name>` one idempotent verb — "make this map true" —
where create is simply update on a file that doesn't exist yet, and membership
is derived strictly from frontmatter. All placement judgment moves to
`propose`. The `update` command is retired (§6).

## 2. Type and files

Agent workflow only, no new script. Files: `.claude/commands/topic.md`,
`.codex/prompts/topic.md` (rewritten); `.claude/commands/update.md` and
`.codex/prompts/update.md` deleted (§6).

## 3. Behavior

`topic <kebab-name or short description>` (argument required; with no
argument, list existing maps and stop):

1. Derive the kebab-case name. If `topics/<name>.md` does not exist, create it
   from `templates/topic.md` and fill `topic:` and `one_liner:` (create path);
   otherwise proceed with the existing file (update path). Never a refusal —
   the command is idempotent.
2. **Membership is exactly the frontmatter set**: the papers whose `topics:`
   frontmatter (via `catalog.json`) contains `<name>`. The command never adds
   a paper the frontmatter doesn't name and never edits `papers/` to change
   that set.
3. Re-derive the **derived sections**:
   - **Shape of the field** — short prose synthesis from the members' catalog
     `contribution` lines (open paper-note bodies only when a contribution
     line is insufficient, per the cost-ladder discipline).
   - **Clusters** — every member with a non-empty `contribution` appears in
     exactly one cluster (`[[citekey]]` links, factual one-line
     characterization per cluster). When invoked by `propose apply`, accepted
     cluster names/memberships and `restructure` instructions from the report
     are binding guidance.
   - **Reading queue** — reconciliation, removal-only: members with an empty
     `contribution` (typically `depth: metadata`) stay/land here; any citekey
     now placed in Clusters, or whose frontmatter no longer names this topic,
     is removed. The command never *adds* an untagged paper to the queue.
4. **Human sections are preserved**: **Open questions** verbatim (proposed
   additions go in the run report, never in-place); **Outputs** untouched.
5. Bump `updated` to today. If nothing changed, say so and do not bump.
6. Run `node scripts/build-catalog.js` (D12 coupling: map `updated` vs note
   `updated`), then report: created-or-updated, membership count, cluster
   changes, queue reconciliation, proposed Open-questions additions.

Creating a topic before any paper is tagged with it is legal and useful (the
dogfooding flow does exactly this): the result is a scaffold with the
frontmatter filled and empty derived sections, and the report points the user
at `propose` to populate it.

## 4. Safety rules (normative)

- Never writes `papers/`, `catalog.json`, or `INDEX.md` directly (generated
  files only via `build-catalog`).
- Never deletes a topic map, never overwrites Open questions/Outputs, never
  removes prose it cannot re-derive (unparseable map → report, don't repair).
- Membership strictly from frontmatter — a `[[citekey]]` may appear in the map
  only if that paper's `topics:` names the map (keeps doctor D06/D10 clean by
  construction).
- Facts only: cluster characterizations and Shape prose carry no
  project-relevance or priority judgments.

## 5. Acceptance criteria

- [ ] `topic new-name` with no tagged papers → scaffold created, frontmatter
      filled, derived sections empty, report points to `propose`; doctor 0.
- [ ] `topic existing` after frontmatter changes → Clusters/Shape re-derived,
      Open questions byte-identical, Outputs untouched, `updated` bumped.
- [ ] A paper moved into Clusters (or un-tagged) disappears from the Reading
      queue on the next run; the queue never gains an untagged paper.
- [ ] Running `topic <name>` twice in a row: second run reports "no changes"
      and leaves `git status` clean.
- [ ] Invoked from `propose apply` with accepted cluster names: the resulting
      Clusters use those names and memberships.
- [ ] After any run, doctor reports no D04/D06/D10 findings attributable to
      the map.

## 6. Migration (part of this implementation unit)

1. Delete `.claude/commands/update.md` and `.codex/prompts/update.md` — no
   alias period; the repo is pre-release and `update` appears only in docs we
   control.
2. Update the workflow tables/manuals: `README.md`, `CLAUDE.md`, `AGENTS.md`,
   `docs/quickstart.md`, `docs/setup.md` — `topic <name>` described as
   create-or-update; `update` row removed; `propose` row added.
3. Grep for remaining `update <topic>` / `/update` references in
   `.claude/`, `.codex/`, `specs/`, `docs/` and fix them (specs/sync.md and
   the survey command are known referrers of the old workflow set).

## 7. Out of scope

Placement judgment for untagged papers (that is [propose](propose.md));
renaming or merging topic files (manual git operations; `propose` may
*suggest* a merge via a `restructure` item, but executing a rename stays
human); multi-topic batch runs (`propose apply` iterates the command instead).
