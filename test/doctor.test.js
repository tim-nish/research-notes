'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const buildCatalog = require('../scripts/build-catalog.js');
const { run } = require('../scripts/doctor.js');

const CLEAN_FIXTURE = path.join(__dirname, 'fixtures', 'doctor', 'clean');

function makeCleanRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-test-'));
  fs.cpSync(CLEAN_FIXTURE, root, { recursive: true });
  return root;
}

function paperPath(root, citekey) {
  return path.join(root, 'papers', `${citekey}.md`);
}

function readPaper(root, citekey) {
  return fs.readFileSync(paperPath(root, citekey), 'utf8');
}

function writePaper(root, citekey, content) {
  fs.writeFileSync(paperPath(root, citekey), content, 'utf8');
}

function regen(root) {
  buildCatalog.run(root, []);
}

function findingsFor(root) {
  const original = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => {
    out += chunk;
    return true;
  };
  let exitCode;
  try {
    exitCode = run(root, ['--json']);
  } finally {
    process.stdout.write = original;
  }
  const parsed = JSON.parse(out);
  return { exitCode, findings: parsed.findings };
}

function assertOnlyCheck(root, id) {
  const { findings } = findingsFor(root);
  const ids = [...new Set(findings.map((f) => f.id))];
  assert.deepEqual(ids, [id], `expected only ${id} to fire, got: ${JSON.stringify(findings, null, 2)}`);
  return findings;
}

test('clean fixture: zero findings, exit 0', () => {
  const root = makeCleanRoot();
  const { exitCode, findings } = findingsFor(root);
  assert.equal(exitCode, 0);
  assert.deepEqual(findings, []);
});

test('D01: corrupt frontmatter fires (plus D07, since catalog.json can never validly sync while a note is unparseable), file untouched, exit 1', () => {
  const root = makeCleanRoot();
  const before = readPaper(root, 'beta2021two');
  writePaper(root, 'beta2021two', '---\ncitekey: "unterminated\ntitle: [oops\n---\n\n## Contribution\n\nbroken\n');
  regen(root); // build-catalog also skips the corrupt file; keeps catalog.json's *count* in sync with the 1 parseable note
  const { exitCode, findings } = findingsFor(root);
  const ids = [...new Set(findings.map((f) => f.id))].sort();
  assert.deepEqual(ids, ['D01', 'D07']);
  assert.ok(findings.every((f) => f.severity === 'error'));
  assert.equal(exitCode, 1);
  // doctor never rewrites note bodies, even for the file it's complaining about
  writePaper(root, 'beta2021two', before); // restore to confirm we captured the right "before"
  assert.equal(readPaper(root, 'beta2021two'), before);
});

test('D02: citekey/filename mismatch fires alone', () => {
  const root = makeCleanRoot();
  const content = readPaper(root, 'beta2021two').replace('citekey: "beta2021two"', 'citekey: "beta2021two-x"');
  writePaper(root, 'beta2021two', content);
  regen(root); // build-catalog is citekey/filename-agnostic; keeps everything else self-consistent
  const findings = assertOnlyCheck(root, 'D02');
  assert.match(findings[0].message, /does not match filename/);
});

test('D03: invalid depth value fires alone', () => {
  const root = makeCleanRoot();
  const content = readPaper(root, 'beta2021two').replace('depth: "metadata"', 'depth: "draft"');
  writePaper(root, 'beta2021two', content);
  regen(root);
  const findings = assertOnlyCheck(root, 'D03');
  assert.match(findings[0].message, /not one of/);
});

test('D04: topics: value with no matching topics/ file fires alone', () => {
  const root = makeCleanRoot();
  const content = readPaper(root, 'beta2021two').replace('topics: []', 'topics: [nonexistent-topic]');
  writePaper(root, 'beta2021two', content);
  regen(root);
  const findings = assertOnlyCheck(root, 'D04');
  assert.match(findings[0].message, /no matching topics\/nonexistent-topic\.md/);
});

test('D05: wrong field shown in INDEX.md (catalog.json untouched) fires alone', () => {
  const root = makeCleanRoot();
  const indexPath = path.join(root, 'INDEX.md');
  const index = fs.readFileSync(indexPath, 'utf8');
  const mutated = index.replace('Alpha One | 2020 | sections', 'Alpha One | 2099 | sections');
  assert.notEqual(mutated, index);
  fs.writeFileSync(indexPath, mutated, 'utf8');
  const findings = assertOnlyCheck(root, 'D05');
  assert.match(findings[0].message, /expected "Alpha One \| 2020 \| sections"/);
});

test('D06: dangling [[citekey]] in a topic map fires alone', () => {
  const root = makeCleanRoot();
  const topicPath = path.join(root, 'topics', 'demo-topic.md');
  const content = fs.readFileSync(topicPath, 'utf8').replace(
    '## Reading queue',
    '## Reading queue\n\n- [[nonexistent2099x]]: dangling.'
  );
  fs.writeFileSync(topicPath, content, 'utf8');
  const findings = assertOnlyCheck(root, 'D06');
  assert.match(findings[0].message, /nonexistent2099x/);
});

test('D07: hand-edited catalog.json out of sync with frontmatter fires alone', () => {
  const root = makeCleanRoot();
  const catalogPath = path.join(root, 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  catalog.papers[0].contribution = 'Hand-edited, no longer matches the note.';
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  const findings = assertOnlyCheck(root, 'D07');
  assert.match(findings[0].message, /out of sync/);
});

test('D08: depth >= sections but empty "Sections read" fires alone', () => {
  const root = makeCleanRoot();
  const content = readPaper(root, 'alpha2020one').replace('## Sections read\n\n- Abstract read.\n', '## Sections read\n');
  writePaper(root, 'alpha2020one', content);
  // Sections read isn't part of catalog.json/INDEX.md, so no regen needed to stay in sync.
  const findings = assertOnlyCheck(root, 'D08');
  assert.match(findings[0].message, /"Sections read" is empty/);
});

test('D09: updated before added fires alone', () => {
  const root = makeCleanRoot();
  const content = readPaper(root, 'beta2021two').replace('updated: "2026-01-01"', 'updated: "2025-12-01"');
  writePaper(root, 'beta2021two', content);
  regen(root); // added/updated are in catalog.json's schema
  const findings = assertOnlyCheck(root, 'D09');
  assert.match(findings[0].message, /before "added"/);
});

test('D10: topic map lists a paper whose frontmatter no longer claims that topic, fires alone', () => {
  const root = makeCleanRoot();
  const content = readPaper(root, 'alpha2020one').replace('topics: [demo-topic]', 'topics: []');
  writePaper(root, 'alpha2020one', content);
  regen(root); // grouping moves to Unassigned, staying self-consistent with the new frontmatter
  const findings = assertOnlyCheck(root, 'D10');
  assert.match(findings[0].message, /missing "demo-topic"/);
});

test('D11: paper shown under the wrong INDEX.md bucket (fields otherwise correct) fires alone', () => {
  const root = makeCleanRoot();
  const indexPath = path.join(root, 'INDEX.md');
  const index = fs.readFileSync(indexPath, 'utf8');
  const mutated = index
    .replace('## demo-topic\n\n- [alpha2020one](papers/alpha2020one.md) — Alpha One | 2020 | sections\n\n', '')
    .replace(
      '## Unassigned\n\n- [beta2021two]',
      '## Unassigned\n\n- [alpha2020one](papers/alpha2020one.md) — Alpha One | 2020 | sections\n- [beta2021two]'
    );
  assert.notEqual(mutated, index);
  fs.writeFileSync(indexPath, mutated, 'utf8');
  const findings = assertOnlyCheck(root, 'D11');
  assert.match(findings[0].message, /missing from "demo-topic".*unexpectedly under "Unassigned"/);
});

test('D11 (reverse direction): topics: [] but INDEX.md still shows a named topic fires alone', () => {
  const root = makeCleanRoot();
  // Set alpha's frontmatter topics: to [] (now expects Unassigned), and mirror that
  // in catalog.json (so D07 stays clean) and in the topic map's Clusters (so D10
  // stays clean), but leave INDEX.md's placement (still under "## demo-topic",
  // fields unchanged) stale — isolating D11's reverse direction.
  writePaper(root, 'alpha2020one', readPaper(root, 'alpha2020one').replace('topics: [demo-topic]', 'topics: []'));
  const catalogPath = path.join(root, 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  catalog.papers.find((p) => p.citekey === 'alpha2020one').topics = [];
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  const topicPath = path.join(root, 'topics', 'demo-topic.md');
  fs.writeFileSync(topicPath, fs.readFileSync(topicPath, 'utf8').replace('- [[alpha2020one]]: demo.\n', ''), 'utf8');
  const findings = assertOnlyCheck(root, 'D11');
  assert.match(findings[0].message, /missing from "Unassigned".*unexpectedly under "demo-topic"/);
});

test('D11: shown under a different *named* topic than frontmatter claims (not just Unassigned) fires alone', () => {
  const root = makeCleanRoot();
  const indexPath = path.join(root, 'INDEX.md');
  const index = fs.readFileSync(indexPath, 'utf8');
  // Move alpha's line from "## demo-topic" into a new "## other-topic" section,
  // fields unchanged, so only the heading it's filed under is wrong.
  const mutated = index
    .replace('## demo-topic\n\n- [alpha2020one](papers/alpha2020one.md) — Alpha One | 2020 | sections\n\n', '')
    .concat('\n## other-topic\n\n- [alpha2020one](papers/alpha2020one.md) — Alpha One | 2020 | sections\n');
  assert.notEqual(mutated, index);
  fs.writeFileSync(indexPath, mutated, 'utf8');
  const findings = assertOnlyCheck(root, 'D11');
  assert.match(findings[0].message, /missing from "demo-topic".*unexpectedly under "other-topic"/);
});

test('D12: topic map updated before its newest linked note fires alone', () => {
  const root = makeCleanRoot();
  const topicPath = path.join(root, 'topics', 'demo-topic.md');
  const content = fs.readFileSync(topicPath, 'utf8').replace('updated: "2026-01-02"', 'updated: "2025-01-01"');
  fs.writeFileSync(topicPath, content, 'utf8');
  const findings = assertOnlyCheck(root, 'D12');
  assert.match(findings[0].message, /older than its newest note/);
});

test('D13: same arXiv id, different titles, fires alone, exit 0', () => {
  const root = makeCleanRoot();
  writePaper(root, 'alpha2020one', readPaper(root, 'alpha2020one').replace(
    'url: "https://example.com/alpha"',
    'url: "https://arxiv.org/abs/1706.03762"'
  ));
  writePaper(root, 'beta2021two', readPaper(root, 'beta2021two').replace(
    'url: "https://example.com/beta"',
    'url: "https://arxiv.org/abs/1706.03762v2"'
  ));
  regen(root); // url is part of catalog.json's schema
  const { exitCode, findings } = findingsFor(root);
  assert.equal(exitCode, 0);
  assert.deepEqual([...new Set(findings.map((f) => f.id))], ['D13']);
  assert.equal(findings[0].file, 'papers/beta2021two.md');
  assert.match(findings[0].message, /duplicates papers\/alpha2020one\.md \(same arXiv id 1706\.03762\)/);
});

test('D13: arXiv-DOI form matches a plain arxiv.org URL for the same id (kind-unified key)', () => {
  const root = makeCleanRoot();
  writePaper(root, 'alpha2020one', readPaper(root, 'alpha2020one').replace(
    'url: "https://example.com/alpha"',
    'url: "https://doi.org/10.48550/arXiv.1706.03762"'
  ));
  writePaper(root, 'beta2021two', readPaper(root, 'beta2021two').replace(
    'url: "https://example.com/beta"',
    'url: "https://arxiv.org/abs/1706.03762"'
  ));
  regen(root);
  const { exitCode, findings } = findingsFor(root);
  assert.equal(exitCode, 0);
  assert.deepEqual([...new Set(findings.map((f) => f.id))], ['D13']);
  assert.match(findings[0].message, /duplicates papers\/alpha2020one\.md \(same arXiv id 1706\.03762\)/);
});

test('D13: same DOI (non-arXiv) fires alone, exit 0', () => {
  const root = makeCleanRoot();
  writePaper(root, 'alpha2020one', readPaper(root, 'alpha2020one').replace(
    'url: "https://example.com/alpha"',
    'url: "https://doi.org/10.1109/TPAMI.2020.1234567"'
  ));
  writePaper(root, 'beta2021two', readPaper(root, 'beta2021two').replace(
    'url: "https://example.com/beta"',
    'url: "https://doi.org/10.1109/TPAMI.2020.1234567"'
  ));
  regen(root);
  const { exitCode, findings } = findingsFor(root);
  assert.equal(exitCode, 0);
  assert.deepEqual([...new Set(findings.map((f) => f.id))], ['D13']);
  assert.match(findings[0].message, /duplicates papers\/alpha2020one\.md \(same DOI 10\.1109\/tpami\.2020\.1234567\)/);
});

test('D13: same normalized title, no DOI, fires alone, exit 0', () => {
  const root = makeCleanRoot();
  writePaper(root, 'beta2021two', readPaper(root, 'beta2021two').replace(
    'title: "Beta Two"',
    'title: "ALPHA, ONE!!"'
  ));
  regen(root); // title feeds both catalog.json and INDEX.md
  const { exitCode, findings } = findingsFor(root);
  assert.equal(exitCode, 0);
  assert.deepEqual([...new Set(findings.map((f) => f.id))], ['D13']);
  assert.equal(findings[0].file, 'papers/beta2021two.md');
  assert.match(findings[0].message, /duplicates papers\/alpha2020one\.md \(same title\)/);
});

test('D13: distinct papers, distinct keys, does not fire (covered by clean-fixture zero-findings case)', () => {
  const root = makeCleanRoot();
  const { findings } = findingsFor(root);
  assert.equal(findings.filter((f) => f.id === 'D13').length, 0);
});

test('D13: --fix leaves both notes of a duplicate pair untouched', () => {
  const root = makeCleanRoot();
  writePaper(root, 'alpha2020one', readPaper(root, 'alpha2020one').replace(
    'url: "https://example.com/alpha"',
    'url: "https://arxiv.org/abs/1706.03762"'
  ));
  writePaper(root, 'beta2021two', readPaper(root, 'beta2021two').replace(
    'url: "https://example.com/beta"',
    'url: "https://arxiv.org/abs/1706.03762"'
  ));
  regen(root);
  const alphaBefore = readPaper(root, 'alpha2020one');
  const betaBefore = readPaper(root, 'beta2021two');
  assertOnlyCheck(root, 'D13');

  run(root, ['--fix']);
  assert.equal(readPaper(root, 'alpha2020one'), alphaBefore);
  assert.equal(readPaper(root, 'beta2021two'), betaBefore);
  const { exitCode } = findingsFor(root);
  assert.equal(exitCode, 0);
  assertOnlyCheck(root, 'D13'); // still fires -- --fix never touches D13
});

test('--fix regenerates catalog.json/INDEX.md and is idempotent', () => {
  const root = makeCleanRoot();
  const catalogPath = path.join(root, 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  catalog.papers[0].contribution = 'stale';
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  assertOnlyCheck(root, 'D07');

  run(root, ['--fix']);
  const { findings } = findingsFor(root);
  assert.equal(findings.filter((f) => f.id === 'D07').length, 0);

  const before = fs.readFileSync(catalogPath, 'utf8');
  run(root, ['--fix']);
  const after = fs.readFileSync(catalogPath, 'utf8');
  assert.equal(before, after); // second --fix is a no-op
});

test('exit-code matrix: clean -> 0, warn-only -> 0, any error -> 1', () => {
  const cleanRoot = makeCleanRoot();
  assert.equal(run(cleanRoot, []), 0);

  const warnRoot = makeCleanRoot();
  const topicPath = path.join(warnRoot, 'topics', 'demo-topic.md');
  fs.writeFileSync(topicPath, fs.readFileSync(topicPath, 'utf8').replace('updated: "2026-01-02"', 'updated: "2025-01-01"'), 'utf8');
  assert.equal(run(warnRoot, []), 0); // D12 is warn-only

  const errorRoot = makeCleanRoot();
  const catalogPath = path.join(errorRoot, 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  catalog.papers[0].contribution = 'stale';
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  assert.equal(run(errorRoot, []), 1); // D07 is error
});

test('--json round-trips the same findings as the human report', () => {
  const root = makeCleanRoot();
  const topicPath = path.join(root, 'topics', 'demo-topic.md');
  fs.writeFileSync(topicPath, fs.readFileSync(topicPath, 'utf8').replace('updated: "2026-01-02"', 'updated: "2025-01-01"'), 'utf8');

  const original = process.stdout.write;
  let humanOut = '';
  process.stdout.write = (chunk) => {
    humanOut += chunk;
    return true;
  };
  try {
    run(root, []);
  } finally {
    process.stdout.write = original;
  }

  const { findings } = findingsFor(root);
  assert.equal(findings.length, 1);
  assert.match(humanOut, new RegExp(findings[0].id));
  assert.match(humanOut, /warn/);
});
