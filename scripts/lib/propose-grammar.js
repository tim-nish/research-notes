'use strict';

// Parses one line of a `/propose` report against the checkbox grammar defined
// normatively in specs/propose.md §5. Deterministic, agent-free: this is the
// mechanical half of the report contract (the judgment half -- deciding what
// to propose, and deciding what to check -- stays with the human/agent).
//
// Returns null for a line that isn't a checkbox item at all (heading, blank
// line, prose, or a "## Pre-existing drift" appendix bullet, which is
// intentionally NOT part of this grammar -- it carries no checkboxes per
// specs/propose.md §5).
//
// Throws for a line that starts like a checkbox item (`- [ ] ` or `- [x] `)
// but whose action does not match any of the five known shapes -- callers
// must treat that as "stop before any write, name the line" per
// specs/propose.md §6.1.

const CHECKBOX_RE = /^- \[( |x|X)\] `([^`]+)` — (.+)$/;

function splitCitekeys(raw) {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseReportLine(line) {
  const m = CHECKBOX_RE.exec(line.trimEnd());
  if (!m) return null;
  const [, box, action, justification] = m;
  const checked = box.toLowerCase() === 'x';

  let mm;
  if ((mm = /^place (\S+) → (\S+) \/ "([^"]+)"$/.exec(action))) {
    return { checked, justification, kind: 'place', citekey: mm[1], topic: mm[2], cluster: mm[3] };
  }
  if ((mm = /^cluster (\S+) \/ "([^"]+)" ← (.+)$/.exec(action))) {
    return {
      checked,
      justification,
      kind: 'cluster',
      topic: mm[1],
      cluster: mm[2],
      citekeys: splitCitekeys(mm[3]),
    };
  }
  if ((mm = /^topic (\S+) "([^"]+)" ← (.+)$/.exec(action))) {
    return {
      checked,
      justification,
      kind: 'topic',
      name: mm[1],
      oneLiner: mm[2],
      citekeys: splitCitekeys(mm[3]),
    };
  }
  if ((mm = /^restructure (\S+) — (.+)$/.exec(action))) {
    return { checked, justification, kind: 'restructure', topic: mm[1], instruction: mm[2] };
  }
  if ((mm = /^defer (\S+)$/.exec(action))) {
    return { checked, justification, kind: 'defer', citekey: mm[1] };
  }

  throw new Error(`malformed action grammar: \`${action}\``);
}

module.exports = { parseReportLine };
