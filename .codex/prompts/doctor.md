---
description: Check repo invariants and explain any drift in plain language
argument-hint: [--fix] [--json]
---

Run `node scripts/doctor.js $ARGUMENTS` and explain the results.

Steps:
1. Run the command and read its output (or `--json` findings if that flag was
   passed through).
2. For each finding, explain in plain language what's wrong and why it matters,
   grouped by severity: errors first, then warnings.
3. For findings the script can't fix itself (anything except `catalog.json`/
   `INDEX.md` drift -- D04, D10, D11 in particular), propose a diff for the user
   to review. Never edit `papers/*.md` or `topics/*.md` yourself. For D04
   specifically, a missing `topics/<name>.md` file, propose *both* plausible
   fixes (create the missing topic map, or correct a frontmatter typo) and let
   the user pick -- don't assume it's always the frontmatter that's wrong.
   For D13 (possible duplicate notes), do not propose a frontmatter diff and
   never delete a note file yourself -- point the user at the manual dedup
   playbook in specs/doctor.md (section 6a).
4. If `--fix` was not passed and there is `catalog.json`/`INDEX.md` drift
   (D05/D07/D11), suggest running `node scripts/doctor.js --fix` and note that it
   only touches generated files.
5. Report the exit code's meaning: 0 clean (warnings allowed), 1 means at least
   one error-severity finding, 2 means an environment/I-O failure.

Never modify any file yourself -- this command explains and proposes only.
