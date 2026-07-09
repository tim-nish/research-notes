# Spec: survey-issue-form — `.github/ISSUE_TEMPLATE/survey-request.yml`

Status: ready for implementation. Part of the [survey-issue](survey-issue.md)
trigger; consumed by [survey-issue-workflow](survey-issue-workflow.md).

## 1. Goal

A GitHub issue form that captures a survey request as structured data — so the
workflow can read the topic without parsing free prose — and auto-applies the
`survey-request` label the workflow triggers on.

## 2. File

`.github/ISSUE_TEMPLATE/survey-request.yml` (GitHub issue-forms YAML).

Fields:

| Key | Value |
|---|---|
| `name` | `Survey request` |
| `description` | `Ask the agent to draft a survey from a topic map` |
| `title` | `Survey: ` (prefix the user completes) |
| `labels` | `[survey-request]` |

Body elements:

1. `input`, id `topic`, required — label: "Topic", description: "Must match a
   file in `topics/` (the filename without `.md`)." The workflow extracts this
   value; it is the only field it reads.
2. `textarea`, id `notes`, optional — label: "Notes for the reviewer".
   Explicitly *not* passed to the agent: the survey must derive only from the
   topic map and paper notes (facts-only rule), not from ad-hoc instructions
   smuggled through an issue body.
3. `markdown` note stating what will happen: a PR with a draft under `scratch/`,
   and that non-collaborator requests need maintainer approval
   (`survey-approved` label).

Also add `.github/ISSUE_TEMPLATE/config.yml` with `blank_issues_enabled: true`
(plain issues stay available; the form is a trigger, not a gate on reporting
bugs).

## 3. Parsing contract

The workflow parses the topic from the issue body's rendered form section
(`### Topic` heading followed by the value). The form's `topic` field id and
label must not be renamed without updating the workflow — note this in a comment
inside the YAML.

## 4. Acceptance criteria

- [ ] "New issue" on GitHub shows the form; submitting it applies
      `survey-request` and produces a body the workflow's extraction step parses
      to exactly the entered topic (including topics containing hyphens).
- [ ] Leaving the topic empty is impossible (required field).
- [ ] The notes field's content demonstrably does not appear in the agent
      prompt (checked in the workflow spec's tests).
