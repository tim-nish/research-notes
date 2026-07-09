'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { run } = require('../scripts/propose-scan.js');

const FIXTURES = path.join(__dirname, 'fixtures', 'propose-scan');

function fixtureRoot(name) {
  return path.join(FIXTURES, name);
}

function capture(fn) {
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  let out = '';
  let err = '';
  process.stdout.write = (chunk) => {
    out += chunk;
    return true;
  };
  process.stderr.write = (chunk) => {
    err += chunk;
    return true;
  };
  let result;
  try {
    result = fn();
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
  return { result, out, err };
}

function runJson(root, argv) {
  const { result, out, err } = capture(() => run(root, argv));
  return { exitCode: result, out, err, json: out ? JSON.parse(out) : null };
}

test('orphan: exactly one unassigned candidate, no other classes', () => {
  const { exitCode, json } = runJson(fixtureRoot('orphan'), ['--json']);
  assert.equal(exitCode, 0);
  assert.equal(json.candidates.length, 1);
  assert.equal(json.candidates[0].citekey, 'orphan2022c');
  assert.equal(json.candidates[0].class, 'unassigned');
  assert.deepEqual(json.candidates[0].queuedIn, []);
});

test('queue-only: exactly one queue-only candidate with correct queuedIn', () => {
  const { exitCode, json } = runJson(fixtureRoot('queue-only'), ['--json']);
  assert.equal(exitCode, 0);
  assert.equal(json.candidates.length, 1);
  assert.equal(json.candidates[0].citekey, 'queued2021b');
  assert.equal(json.candidates[0].class, 'queue-only');
  assert.deepEqual(json.candidates[0].queuedIn, ['demo-topic']);
});

test('settled: every paper clustered -> candidates: []', () => {
  const { exitCode, json } = runJson(fixtureRoot('settled'), ['--json']);
  assert.equal(exitCode, 0);
  assert.deepEqual(json.candidates, []);
});

test('drift: frontmatter names a topic the map does not list it under -> zero candidates, exit 0', () => {
  const { exitCode, json } = runJson(fixtureRoot('drift'), ['--json']);
  assert.equal(exitCode, 0);
  assert.deepEqual(json.candidates, []);
});

test('scoped: --topic restricts candidates to that topic; unassigned excluded from scoped runs', () => {
  const unscoped = runJson(fixtureRoot('scoped'), ['--json']);
  assert.equal(unscoped.exitCode, 0);
  assert.equal(unscoped.json.candidates.length, 3);
  const classes = unscoped.json.candidates.map((c) => c.class).sort();
  assert.deepEqual(classes, ['queue-only', 'queue-only', 'unassigned']);

  const scopedA = runJson(fixtureRoot('scoped'), ['--topic', 'topic-a', '--json']);
  assert.equal(scopedA.exitCode, 0);
  assert.equal(scopedA.json.scope, 'topic-a');
  assert.equal(scopedA.json.topics.length, 1);
  assert.equal(scopedA.json.topics[0].name, 'topic-a');
  assert.deepEqual(
    scopedA.json.candidates.map((c) => c.citekey),
    ['queueda2021y']
  );

  const scopedB = runJson(fixtureRoot('scoped'), ['--topic', 'topic-b', '--json']);
  assert.deepEqual(
    scopedB.json.candidates.map((c) => c.citekey),
    ['queuedb2022z']
  );
});

test('scoped: unknown --topic exits 3', () => {
  const { exitCode, err } = runJson(fixtureRoot('scoped'), ['--topic', 'nonexistent-topic', '--json']);
  assert.equal(exitCode, 3);
  assert.match(err, /nonexistent-topic/);
});

test('broken-map: malformed topic map -> exit 1, file named, no JSON emitted', () => {
  const { result: exitCode, out, err } = capture(() => run(fixtureRoot('broken-map'), ['--json']));
  assert.equal(exitCode, 1);
  assert.equal(out, '');
  assert.match(err, /topics\/broken\.md/);
});

test('determinism: two runs on unchanged repo state produce byte-identical --json output', () => {
  for (const name of ['orphan', 'queue-only', 'settled', 'drift', 'scoped']) {
    const root = fixtureRoot(name);
    const first = capture(() => run(root, ['--json']));
    const second = capture(() => run(root, ['--json']));
    assert.equal(first.out, second.out, `fixture ${name} was not byte-identical across two runs`);
  }
});

test('human-readable output (no --json): summary line, per-topic counts, no crash', () => {
  const { result: exitCode, out } = capture(() => run(fixtureRoot('settled'), []));
  assert.equal(exitCode, 0);
  assert.match(out, /propose-scan: 0 candidate\(s\) \(0 unassigned, 0 queue-only\)/);
  assert.match(out, /demo-topic: 1 cluster\(s\) \(2 citekey\(s\)\), 0 in reading queue/);
  assert.doesNotMatch(out, /no determinable name/);
});

test('human-readable output: warns on a cluster with no determinable name', () => {
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'propose-scan-test-'));
  fs.mkdirSync(path.join(tmp, 'topics'));
  fs.writeFileSync(
    path.join(tmp, 'topics', 'unnamed-cluster.md'),
    [
      '---',
      'topic: "unnamed-cluster"',
      'one_liner: "fixture for the unnamed-cluster warning"',
      'updated: "2026-01-01"',
      '---',
      '',
      '## Clusters',
      '',
      '- [[loose2020x]]: no preceding ### heading.',
      '',
      '## Reading queue',
      '',
      '## Outputs',
      '',
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(tmp, 'catalog.json'),
    JSON.stringify({
      schema: 1,
      generated: '2026-01-01T00:00:00.000Z',
      papers: [
        {
          citekey: 'loose2020x',
          title: 'Loose',
          authors: ['X'],
          year: 2020,
          venue: 'arXiv',
          url: 'https://example.com/loose',
          zotero: '',
          depth: 'abstract',
          topics: ['unnamed-cluster'],
          added: '2026-01-01',
          updated: '2026-01-01',
          contribution: 'demo.',
          path: 'papers/loose2020x.md',
        },
      ],
    })
  );
  const { result: exitCode, out } = capture(() => run(tmp, []));
  assert.equal(exitCode, 0);
  assert.match(out, /warning: 1 cluster\(s\) with no determinable name/);
});

test('missing catalog.json -> exit 1, points at build-catalog', () => {
  const fs2 = fs;
  const tmp = fs2.mkdtempSync(path.join(require('os').tmpdir(), 'propose-scan-test-'));
  fs2.mkdirSync(path.join(tmp, 'topics'));
  const { result: exitCode, err } = capture(() => run(tmp, ['--json']));
  assert.equal(exitCode, 1);
  assert.match(err, /build-catalog/);
});
