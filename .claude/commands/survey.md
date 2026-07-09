---
description: Draft a survey article from a topic map and its paper notes
argument-hint: <topic>
---

Follow the `survey` workflow defined in CLAUDE.md for topic: $ARGUMENTS

Steps:
1. Read `topics/<topic>.md` and every paper note it links to (via Clusters and
   Reading queue).
2. Draft a survey article synthesizing the topic, citing claims by `[[citekey]]`.
3. For every claim that rests on a note with `depth: metadata` (i.e. not yet backed
   by an abstract or deeper reading), flag it inline as needing verification — do not
   silently upgrade or assume beyond what the note supports.
4. Write the draft to a scratch file (e.g. `scratch/survey-<topic>-draft.md` or a path
   the user specifies) — never publish or overwrite a real output file directly.

Report the scratch file path and a summary of which claims were flagged as
unverified.
