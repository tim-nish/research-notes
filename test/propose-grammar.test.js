'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { parseReportLine } = require('../scripts/lib/propose-grammar.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'propose', 'sample-report.md');

function loadLines() {
  return fs.readFileSync(FIXTURE, 'utf8').split('\n');
}

test('sample-report.md: every checkbox line parses to the expected kind', () => {
  const parsed = loadLines()
    .map(parseReportLine)
    .filter((p) => p !== null);

  assert.equal(parsed.length, 5, 'expected exactly 5 checkbox items (drift appendix line excluded)');

  const byKind = Object.fromEntries(parsed.map((p) => [p.kind, p]));

  assert.equal(byKind.place.checked, true);
  assert.equal(byKind.place.citekey, 'kim2024flow');
  assert.equal(byKind.place.topic, 'time-series-generation');
  assert.equal(byKind.place.cluster, 'Flow-based generators');

  assert.equal(byKind.cluster.checked, false);
  assert.equal(byKind.cluster.topic, 'time-series-generation');
  assert.equal(byKind.cluster.cluster, 'Diffusion models');
  assert.deepEqual(byKind.cluster.citekeys, ['lee2024diff', 'park2023score']);

  assert.equal(byKind.topic.checked, true);
  assert.equal(byKind.topic.name, 'signature-methods');
  assert.equal(byKind.topic.oneLiner, 'Path-signature techniques for sequential data');
  assert.deepEqual(byKind.topic.citekeys, ['tong2023sig']);

  assert.equal(byKind.restructure.checked, false);
  assert.equal(byKind.restructure.topic, 'time-series-generation');

  assert.equal(byKind.defer.checked, false);
  assert.equal(byKind.defer.citekey, 'noor2024x');
});

test('the drift appendix line is not part of the checkbox grammar (returns null, not parsed/thrown)', () => {
  const driftLine = loadLines().find((l) => l.startsWith('- D10'));
  assert.ok(driftLine, 'fixture must contain a drift appendix line for this test to be meaningful');
  assert.equal(parseReportLine(driftLine), null);
});

test('non-checkbox lines (headings, prose, blank) return null', () => {
  assert.equal(parseReportLine('# Topic proposals — 2026-07-08'), null);
  assert.equal(parseReportLine('## Place in existing clusters'), null);
  assert.equal(parseReportLine(''), null);
  assert.equal(parseReportLine('Scope: all · Candidates: 4 (unassigned 3, queue-only 1)'), null);
});

test('a malformed checked line throws, naming the unparsed action', () => {
  assert.throws(
    () => parseReportLine('- [x] `place kim2024flow into time-series-generation` — missing the grammar arrows'),
    /malformed action grammar/
  );
});

test('an unchecked line with the same malformed action also throws (parse-time, not accept-time)', () => {
  assert.throws(
    () => parseReportLine('- [ ] `nonsense-action foo` — not a real action kind'),
    /malformed action grammar/
  );
});
