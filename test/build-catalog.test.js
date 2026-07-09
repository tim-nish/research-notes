'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run, extractContribution } = require('../scripts/build-catalog.js');

const FIXTURES = path.join(__dirname, 'fixtures', 'papers');

function makeRoot(citekeys) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-catalog-test-'));
  fs.mkdirSync(path.join(root, 'papers'));
  for (const citekey of citekeys) {
    fs.copyFileSync(path.join(FIXTURES, `${citekey}.md`), path.join(root, 'papers', `${citekey}.md`));
  }
  return root;
}

function readCatalog(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'catalog.json'), 'utf8'));
}

function readIndex(root) {
  return fs.readFileSync(path.join(root, 'INDEX.md'), 'utf8');
}

function stripGenerated(s) {
  return s.replace(/"generated": ".*"/, '"generated": ""');
}

function captureStderr(fn) {
  const original = process.stderr.write;
  let output = '';
  process.stderr.write = (chunk) => {
    output += chunk;
    return true;
  };
  try {
    const result = fn();
    return { result, output };
  } finally {
    process.stderr.write = original;
  }
}

test('full scan: two papers, one clustered one unassigned', () => {
  const root = makeRoot(['foo2024bar', 'baz2020qux']);

  const exitCode = run(root, []);
  assert.equal(exitCode, 0);

  const catalog = readCatalog(root);
  assert.equal(catalog.schema, 1);
  assert.equal(catalog.papers.length, 2);
  assert.deepEqual(
    catalog.papers.map((p) => p.citekey),
    ['baz2020qux', 'foo2024bar']
  );
  assert.equal(
    catalog.papers.find((p) => p.citekey === 'foo2024bar').contribution,
    'Introduces Foo.'
  );

  const index = readIndex(root);
  assert.match(index, /## signature-transformers/);
  assert.match(index, /## Unassigned/);
  assert.match(index, /\[foo2024bar\]\(papers\/foo2024bar\.md\) — Foo Bar \| 2024 \| abstract/);
  assert.match(index, /\[baz2020qux\]\(papers\/baz2020qux\.md\) — Baz Qux \| 2020 \| abstract/);
  assert.doesNotMatch(index, / -- /); // em dash, never the ASCII fallback
});

test('idempotent: second run makes no changes and preserves mtime', () => {
  const root = makeRoot(['foo2024bar']);
  assert.equal(run(root, []), 0);
  const before = fs.statSync(path.join(root, 'catalog.json')).mtimeMs;
  const generatedBefore = readCatalog(root).generated;

  assert.equal(run(root, []), 0);
  const after = fs.statSync(path.join(root, 'catalog.json')).mtimeMs;
  assert.equal(before, after);
  assert.equal(readCatalog(root).generated, generatedBefore);
});

test('--changed produces byte-identical output to a full rebuild', () => {
  const fullRoot = makeRoot(['foo2024bar', 'baz2020qux']);
  run(fullRoot, []);
  const fullCatalog = fs.readFileSync(path.join(fullRoot, 'catalog.json'), 'utf8');
  const fullIndex = fs.readFileSync(path.join(fullRoot, 'INDEX.md'), 'utf8');

  const incRoot = makeRoot(['foo2024bar', 'baz2020qux']);
  run(incRoot, []); // seed baseline catalog
  fs.copyFileSync(path.join(FIXTURES, 'foo2024bar.md'), path.join(incRoot, 'papers', 'foo2024bar.md'));
  run(incRoot, ['--changed', 'papers/foo2024bar.md']);
  const incCatalog = fs.readFileSync(path.join(incRoot, 'catalog.json'), 'utf8');
  const incIndex = fs.readFileSync(path.join(incRoot, 'INDEX.md'), 'utf8');

  assert.equal(stripGenerated(incCatalog), stripGenerated(fullCatalog));
  assert.equal(incIndex, fullIndex);
});

test('--changed removes a record whose file was deleted', () => {
  const root = makeRoot(['foo2024bar', 'baz2020qux']);
  run(root, []);
  assert.equal(readCatalog(root).papers.length, 2);

  fs.unlinkSync(path.join(root, 'papers', 'baz2020qux.md'));
  run(root, ['--changed', 'papers/baz2020qux.md']);

  const catalog = readCatalog(root);
  assert.equal(catalog.papers.length, 1);
  assert.equal(catalog.papers[0].citekey, 'foo2024bar');
});

test('--check exits 0 on a clean repo and 1 after hand-corrupting INDEX.md', () => {
  const root = makeRoot(['foo2024bar']);
  run(root, []);
  assert.equal(run(root, ['--check']), 0);

  fs.appendFileSync(path.join(root, 'INDEX.md'), 'corrupt\n');
  assert.equal(run(root, ['--check']), 1);

  // --check never writes
  const before = fs.readFileSync(path.join(root, 'INDEX.md'), 'utf8');
  run(root, ['--check']);
  const after = fs.readFileSync(path.join(root, 'INDEX.md'), 'utf8');
  assert.equal(before, after);
});

test('corrupt frontmatter: reported by path, other records still emitted, exit 1', () => {
  const root = makeRoot(['foo2024bar', 'broken2024x']);
  const { result: exitCode, output } = captureStderr(() => run(root, []));
  assert.equal(exitCode, 1);
  assert.match(output, /papers\/broken2024x\.md/);

  const catalog = readCatalog(root);
  assert.equal(catalog.papers.length, 1);
  assert.equal(catalog.papers[0].citekey, 'foo2024bar');
});

test('duplicate citekey across two files: first (alphabetical) wins, other reported, exit 1', () => {
  const root = makeRoot(['dup2024a', 'dup2024b']);
  const { result: exitCode, output } = captureStderr(() => run(root, []));
  assert.equal(exitCode, 1);
  assert.match(output, /duplicate citekey/);
  assert.match(output, /papers\/dup2024b\.md/);

  const catalog = readCatalog(root);
  assert.equal(catalog.papers.length, 1);
  assert.equal(catalog.papers[0].title, 'Dup A');
});

test('duplicate citekey is also caught when introduced via --changed', () => {
  const root = makeRoot(['dup2024a']);
  run(root, []);
  fs.copyFileSync(path.join(FIXTURES, 'dup2024b.md'), path.join(root, 'papers', 'dup2024b.md'));
  const { result: exitCode, output } = captureStderr(() => run(root, ['--changed', 'papers/dup2024b.md']));
  assert.equal(exitCode, 1);
  assert.match(output, /duplicate citekey/);

  const catalog = readCatalog(root);
  assert.equal(catalog.papers.length, 1);
  assert.equal(catalog.papers[0].title, 'Dup A');
});

test('malformed authors/topics shape (scalar instead of list) is a reported error, not silently dropped', () => {
  const root = makeRoot(['foo2024bar', 'badshape2024']);
  const exitCode = run(root, []);
  assert.equal(exitCode, 1);
  const catalog = readCatalog(root);
  assert.equal(catalog.papers.length, 1);
  assert.equal(catalog.papers[0].citekey, 'foo2024bar');
});

test('non-numeric year is a reported error, not silently laundered into null', () => {
  const root = makeRoot(['foo2024bar', 'badyear2024']);
  const exitCode = run(root, []);
  assert.equal(exitCode, 1);
  const catalog = readCatalog(root);
  assert.equal(catalog.papers.length, 1);
});

test('frontmatter that parses to a YAML array (not a mapping) is a reported error', () => {
  const root = makeRoot(['foo2024bar', 'arrayfm2024']);
  const exitCode = run(root, []);
  assert.equal(exitCode, 1);
  const catalog = readCatalog(root);
  assert.equal(catalog.papers.length, 1);
});

test('missing year renders as "?" in INDEX.md rather than the literal string "null"', () => {
  const root = makeRoot(['foo2024bar']);
  // strip year from the frontmatter directly to simulate an absent (not malformed) year
  const p = path.join(root, 'papers', 'foo2024bar.md');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('year: 2024\n', ''));
  run(root, []);
  const index = readIndex(root);
  assert.match(index, /\| \? \| abstract/);
  assert.doesNotMatch(index, /\| null \|/);
});

test('CRLF line endings and a leading BOM are tolerated', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-catalog-test-'));
  fs.mkdirSync(path.join(root, 'papers'));
  const content = fs.readFileSync(path.join(FIXTURES, 'foo2024bar.md'), 'utf8');
  const crlfContent = '﻿' + content.replace(/\n/g, '\r\n');
  fs.writeFileSync(path.join(root, 'papers', 'foo2024bar.md'), crlfContent, 'utf8');

  const exitCode = run(root, []);
  assert.equal(exitCode, 0);
  const catalog = readCatalog(root);
  assert.equal(catalog.papers.length, 1);
  assert.equal(catalog.papers[0].contribution, 'Introduces Foo.');
});

test('unexpected exception during a run is caught and mapped to exit 2', () => {
  const root = makeRoot(['foo2024bar']);
  // Make catalog.json a directory so writeFileSync throws EISDIR instead of writing a file.
  fs.mkdirSync(path.join(root, 'catalog.json'));
  const { result: exitCode, output } = captureStderr(() => run(root, []));
  assert.equal(exitCode, 2);
  assert.match(output, /unexpected failure/);
});

test('--split-topics emits per-topic files and a TOC-form INDEX.md', () => {
  const root = makeRoot(['foo2024bar', 'baz2020qux']);
  run(root, ['--split-topics']);

  const sigFile = fs.readFileSync(path.join(root, 'indexes', 'signature-transformers.md'), 'utf8');
  assert.match(sigFile, /# signature-transformers/);
  assert.match(sigFile, /foo2024bar/);

  const unassignedFile = fs.readFileSync(path.join(root, 'indexes', 'unassigned.md'), 'utf8');
  assert.match(unassignedFile, /baz2020qux/);

  const toc = readIndex(root);
  assert.match(toc, /\[signature-transformers\]\(indexes\/signature-transformers\.md\)/);
  assert.match(toc, /\[Unassigned\]\(indexes\/unassigned\.md\)/);
});

test('determinism: file creation order on disk does not affect output bytes', () => {
  const rootA = makeRoot(['aaa2020a', 'zzz2020z']);
  run(rootA, []);

  // Same fixture content, files created in the opposite order on disk.
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'build-catalog-test-'));
  fs.mkdirSync(path.join(rootB, 'papers'));
  fs.copyFileSync(path.join(FIXTURES, 'zzz2020z.md'), path.join(rootB, 'papers', 'zzz2020z.md'));
  fs.copyFileSync(path.join(FIXTURES, 'aaa2020a.md'), path.join(rootB, 'papers', 'aaa2020a.md'));
  run(rootB, []);

  assert.equal(
    stripGenerated(fs.readFileSync(path.join(rootA, 'catalog.json'), 'utf8')),
    stripGenerated(fs.readFileSync(path.join(rootB, 'catalog.json'), 'utf8'))
  );
  assert.equal(fs.readFileSync(path.join(rootA, 'INDEX.md'), 'utf8'), fs.readFileSync(path.join(rootB, 'INDEX.md'), 'utf8'));
});

test('frontmatter edge cases: missing optional field, non-ISO date, empty topics, unknown key ignored', () => {
  const root = makeRoot(['edgecase2024y']);
  const exitCode = run(root, []);
  assert.equal(exitCode, 0);
  const catalog = readCatalog(root);
  assert.equal(catalog.papers[0].venue, ''); // missing optional field defaults empty
  assert.equal(catalog.papers[0].added, '07/06/2026'); // non-ISO date passed through, not validated here
  assert.deepEqual(catalog.papers[0].topics, []);
  assert.equal(catalog.papers[0].contribution, 'Edge case body.');
});

test('unquoted YAML dates (parsed as Date objects) format as YYYY-MM-DD, not a locale/TZ-dependent string', () => {
  const root = makeRoot(['unquoteddate2024']);
  const exitCode = run(root, []);
  assert.equal(exitCode, 0);
  const catalog = readCatalog(root);
  assert.equal(catalog.papers[0].added, '2024-03-05');
  assert.equal(catalog.papers[0].updated, '2024-03-06');
});

test('extractContribution edge cases', () => {
  assert.equal(extractContribution('## Key claims\n\ntext\n'), ''); // heading missing
  assert.equal(extractContribution('## Contribution\n\n## Key claims\n'), ''); // empty section
  assert.equal(extractContribution('## Contribution\n\nFirst line.\nSecond line.\n'), 'First line.'); // multi-line: first only
  assert.equal(extractContribution('## Contribution\nFirst line.\n'), 'First line.');
});
