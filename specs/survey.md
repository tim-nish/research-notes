# Spec: `survey` — corpus-fidelity guarantees (normative now) and output design (decisions open)

Status: split. §2 is normative immediately — it codifies behavior the first
live run already exhibits and finding #10 says must not regress. §3–§4 are
design considerations from findings #11 and #12 with decisions still open;
do not implement them until the marked choices are made. Motivated by
dogfooding findings #10, #11, #12. First live run:
`scratch/survey-transformers-draft.md` (2026-07-08).

## 1. Baseline

`survey <topic>` today is a one-paragraph workflow entry (CLAUDE.md) plus
command files (`.claude/commands/survey.md`, `.codex/prompts/survey.md`):
read the topic map and every linked note, draft a survey citing by
`[[citekey]]`, flag `depth: metadata`-backed claims, write to scratch. It
had no spec; this file becomes it.

## 2. Corpus-fidelity guarantees (normative)

These held in the first live run by prompt-following alone; they are now
contract, so a future prompt/model change is measured against them:

1. **Membership boundary.** The survey may assert claims only from notes
   the topic map links (Clusters + Reading queue). A paper that general
   model knowledge says belongs to the topic, but the map does not link,
   is a *gap*: name it as such in a dedicated place in the draft, assert
   nothing about it, cite nothing for it. (Live example: the Transformer
   paper itself was absent from `topics/transformers.md` pending dedup;
   the draft reported the hole instead of filling it.)
2. **Claim traceability.** Every factual claim resolves to at least one
   `[[citekey]]` the map links, and the note behind it must actually
   support the claim — no upgrading an abstract-level note's claims with
   knowledge of the paper's body.
3. **Depth honesty.** Claims resting on `depth: metadata` notes carry an
   inline needs-verification flag (existing rule). Additionally, when
   *every* cited note sits at one shallow depth, the draft must say so
   once, at the top, rather than flagging nothing (live run: a blanket
   "all notes are abstract-depth" caveat).
4. **Scratch only.** Output goes to a scratch file; the command never
   writes topic maps, notes, or anything under version-controlled docs.
5. **Map prose is not evidence.** The topic map's own Shape-of-the-field
   prose may be contradicted by the membership (it may reference papers
   the map doesn't link); the survey trusts membership, not prose, and
   reports the discrepancy.

Regression check (manual, per dogfood checklist): run `survey` on a topic
whose map is known to lack an obviously-canonical paper; the draft must
name the gap and must not cite the missing paper.

## 3. Output structure — design consideration, decision open (finding #11)

The default draft shape is a per-cluster summary — accurate but flat: an
annotated bibliography, not a synthesized account. Proposed direction: a
named-form argument,

    survey <topic> [--form <name>]

with an initial form set — `clusters` (today's default), `historical`
(development narrative ordered by lineage), `taxonomy` (grouped by
mechanism/approach), `comparison` (claims tabulated across papers),
`reading-guide` (ordered entry path with rationale). Each form is a prompt
framework, not code; forms live as short sections in the survey command
files so they version with the repo.

**Open decisions:** (a) whether forms are wanted at all vs. leaving
structure to per-run judgment; (b) the initial form set; (c) whether
`--form` unset means `clusters` or means agent's choice with the choice
stated in the draft header. Every form is bound by §2 — a form changes
arrangement, never evidentiary basis.

## 4. Citation rendering — design consideration, decision open (finding #12)

Inline `[[citekey]]` markers after nearly every sentence give traceability
at a heavy readability cost. Proposed direction: keep inline `[[citekey]]`
as the canonical, machine-checkable format of the *draft*, and add an
optional presentation pass —

    survey <topic> --render footnotes|endnotes|inline

— where `footnotes`/`endnotes` move markers out of the sentence flow into
numbered references resolved to citekeys, produced as a *second* scratch
file alongside (never instead of) the canonical draft, so §2's
traceability remains mechanically checkable against the canonical file.

**Open decisions:** (a) whether the extra file is worth it vs. accepting
inline markers; (b) footnotes vs. end-of-section source lists; (c) whether
render should be part of `survey` at all or a separate small formatting
command. Decide together with §3 — form and citation style compose.

## 5. Out of scope

Publishing anywhere (Outputs section updates stay human); any change to
what `deepen` records; auto-upgrading note depth to strengthen a survey;
implementing §3/§4 before their decisions are made.

## 6. Acceptance criteria (for §2 now; §3–§4 gain criteria when decided)

- [ ] Survey over a map with a known missing canonical paper → gap named,
      paper never cited.
- [ ] Every `[[citekey]]` in a draft resolves to a note the map links
      (spot-checkable with grep against the map).
- [ ] All-shallow corpus → one blanket depth caveat at the top.
- [ ] `git status` after a run: only the scratch draft(s).
- [ ] specs/README.md lists this spec; CLAUDE.md's survey entry points to
      it.
