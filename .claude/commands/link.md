---
description: Print the GitHub URL and suggested link text for a paper note
argument-hint: <citekey>
---

Follow the `link` workflow defined in CLAUDE.md for: $ARGUMENTS

Steps:
1. Determine this repository's GitHub remote URL (`git remote get-url origin`) and
   current default branch.
2. Construct the full GitHub URL to `papers/<citekey>.md` (blob URL on the default
   branch).
3. Read the note's **Contribution** section (one line).

Print exactly:
- The full GitHub URL
- The Contribution line as suggested link text

Do not fetch or restate any other section of the note.
