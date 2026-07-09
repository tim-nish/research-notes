'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const zf = require('../scripts/zotero-fetch.js');

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zotero-fetch-test-'));
  fs.mkdirSync(path.join(root, 'papers'));
  return root;
}

function writePaper(root, citekey, overrides = {}) {
  const fields = {
    citekey,
    title: 'Some Title',
    authors: '[Foo]',
    year: 2024,
    venue: '',
    url: '',
    zotero: '',
    depth: 'metadata',
    topics: '[]',
    added: '2026-01-01',
    updated: '2026-01-01',
    ...overrides,
  };
  const fm = Object.entries(fields)
    .map(([k, v]) => (typeof v === 'string' && /^(\[.*\]|".*")$/.test(v) ? `${k}: ${v}` : `${k}: "${v}"`))
    .join('\n');
  fs.writeFileSync(path.join(root, 'papers', `${citekey}.md`), `---\n${fm}\n---\n\n## Contribution\n\nBody.\n`);
}

function item(key, data = {}) {
  return { key, data: { itemType: 'journalArticle', title: 'T', creators: [], date: '2024', ...data } };
}

// ---------- classify() ----------

test('classify: no note -> create', () => {
  const joins = { byItemKey: new Map(), byCitekey: new Map() };
  const { discovered, skipped } = zf.classify([item('I1')], new Map([['I1', 'foo2024bar']]), joins);
  assert.equal(discovered.get('I1').action, 'create');
  assert.equal(skipped, 0);
});

test('classify: note exists but incomplete (zotero link missing) -> enrich', () => {
  const rec = { citekey: 'foo2024bar', itemKey: null, hasZotero: false, hasVenue: false, hasUrl: false, path: 'papers/foo2024bar.md' };
  const joins = { byItemKey: new Map(), byCitekey: new Map([['foo2024bar', rec]]) };
  const { discovered } = zf.classify([item('I1')], new Map([['I1', 'foo2024bar']]), joins);
  assert.equal(discovered.get('I1').action, 'enrich');
});

test('classify: item-key match wins over a freshly re-pinned BBT citekey (post-review fix)', () => {
  // Note already exists (found via its zotero: item-key link) under its OWN
  // citekey. BBT has since re-resolved this item to a *different* citekey.
  // The discovered entry must carry the note's real citekey, or `enrich`
  // would target a file that doesn't exist.
  const rec = { citekey: 'original2024bar', itemKey: 'I1', hasZotero: false, hasVenue: true, hasUrl: true, path: 'papers/original2024bar.md' };
  const joins = { byItemKey: new Map([['I1', rec]]), byCitekey: new Map([['original2024bar', rec]]) };
  const { discovered } = zf.classify([item('I1')], new Map([['I1', 'repinned2024baz']]), joins);
  assert.equal(discovered.get('I1').citekey, 'original2024bar');
  assert.equal(discovered.get('I1').action, 'enrich');
});

test('classify: note exists and complete -> skip (not queued)', () => {
  const rec = { citekey: 'foo2024bar', itemKey: 'I1', hasZotero: true, hasVenue: true, hasUrl: true, path: 'papers/foo2024bar.md' };
  const joins = { byItemKey: new Map([['I1', rec]]), byCitekey: new Map([['foo2024bar', rec]]) };
  const { discovered, skipped } = zf.classify([item('I1')], new Map([['I1', 'foo2024bar']]), joins);
  assert.equal(discovered.has('I1'), false);
  assert.equal(skipped, 1);
});

test('classify: no pinned citekey -> blocked, never invents one', () => {
  const joins = { byItemKey: new Map(), byCitekey: new Map() };
  const { discovered } = zf.classify([item('I1')], new Map([['I1', null]]), joins);
  const entry = discovered.get('I1');
  assert.equal(entry.action, 'blocked');
  assert.equal(entry.blockedReason, 'no-citekey');
  assert.equal(entry.citekey, null);
});

// ---------- Fix A: source-aware completeness (specs/sync-stage1-fixes.md §1) ----------

test('Fix A #1: note zotero+url set, venue empty, metadata.venue also empty (arXiv-style) -> skip', () => {
  const rec = { citekey: 'foo2024bar', itemKey: 'I1', hasZotero: true, hasVenue: false, hasUrl: true, path: 'papers/foo2024bar.md' };
  const joins = { byItemKey: new Map([['I1', rec]]), byCitekey: new Map([['foo2024bar', rec]]) };
  const { discovered, skipped } = zf.classify([item('I1')], new Map([['I1', 'foo2024bar']]), joins);
  assert.equal(discovered.has('I1'), false);
  assert.equal(skipped, 1);
});

test('Fix A #2: note venue empty, metadata.venue non-empty -> enrich', () => {
  const rec = { citekey: 'foo2024bar', itemKey: 'I1', hasZotero: true, hasVenue: false, hasUrl: true, path: 'papers/foo2024bar.md' };
  const joins = { byItemKey: new Map([['I1', rec]]), byCitekey: new Map([['foo2024bar', rec]]) };
  const { discovered } = zf.classify([item('I1', { publicationTitle: 'NeurIPS' })], new Map([['I1', 'foo2024bar']]), joins);
  assert.equal(discovered.get('I1').action, 'enrich');
});

test('Fix A #3: note url empty + metadata.url empty (zotero/venue satisfied) -> skip; metadata.url non-empty -> enrich', () => {
  const rec = { citekey: 'foo2024bar', itemKey: 'I1', hasZotero: true, hasVenue: true, hasUrl: false, path: 'papers/foo2024bar.md' };
  const joins = { byItemKey: new Map([['I1', rec]]), byCitekey: new Map([['foo2024bar', rec]]) };

  const skipResult = zf.classify([item('I1')], new Map([['I1', 'foo2024bar']]), joins);
  assert.equal(skipResult.discovered.has('I1'), false);
  assert.equal(skipResult.skipped, 1);

  const enrichResult = zf.classify([item('I1', { url: 'https://x' })], new Map([['I1', 'foo2024bar']]), joins);
  assert.equal(enrichResult.discovered.get('I1').action, 'enrich');
});

test('Fix A #4: note zotero empty -> enrich regardless of other fields', () => {
  const rec = { citekey: 'foo2024bar', itemKey: null, hasZotero: false, hasVenue: true, hasUrl: true, path: 'papers/foo2024bar.md' };
  const joins = { byItemKey: new Map(), byCitekey: new Map([['foo2024bar', rec]]) };
  const { discovered } = zf.classify([item('I1')], new Map([['I1', 'foo2024bar']]), joins);
  assert.equal(discovered.get('I1').action, 'enrich');
});

// ---------- Fix B: blocked: no-year (specs/sync-stage1-fixes.md §2) ----------

test('Fix B #7: classify(): citekey resolves, no note match, no year -> blocked no-year', () => {
  const joins = { byItemKey: new Map(), byCitekey: new Map() };
  const { discovered } = zf.classify([item('I1', { date: '' })], new Map([['I1', 'foo2024bar']]), joins);
  const entry = discovered.get('I1');
  assert.equal(entry.action, 'blocked');
  assert.equal(entry.blockedReason, 'no-year');
  assert.equal(entry.citekey, 'foo2024bar');
});

test('Fix B #8: mergeQueue(): no-year-blocked entry whose fresh classification unblocks -> pending, reason cleared', () => {
  const existing = [
    { itemKey: 'I1', citekey: 'foo2024bar', action: 'blocked', status: 'blocked', attempts: 0, blockedReason: 'no-year', metadata: {} },
  ];
  const discovered = new Map([
    ['I1', { itemKey: 'I1', citekey: 'foo2024bar', action: 'create', blockedReason: null, metadata: { year: 2024 } }],
  ]);
  const joins = { byItemKey: new Map(), byCitekey: new Map() };
  const merged = zf.mergeQueue(existing, discovered, joins, null);
  assert.equal(merged[0].status, 'pending');
  assert.equal(merged[0].blockedReason, null);
});

test('Fix B #9: mergeQueue(): repeated-failure-blocked entry never auto-unblocks even with a clean fresh classification', () => {
  const existing = [
    { itemKey: 'I1', citekey: 'foo2024bar', action: 'create', status: 'blocked', attempts: 3, blockedReason: 'repeated-failure', metadata: {} },
  ];
  const discovered = new Map([
    ['I1', { itemKey: 'I1', citekey: 'foo2024bar', action: 'create', blockedReason: null, metadata: {} }],
  ]);
  const joins = { byItemKey: new Map(), byCitekey: new Map() };
  const merged = zf.mergeQueue(existing, discovered, joins, null);
  assert.equal(merged[0].status, 'blocked');
  assert.equal(merged[0].blockedReason, 'repeated-failure');
});

// ---------- extractItemKeyFromZoteroLink / loadPaperJoins ----------

test('extractItemKeyFromZoteroLink parses the select-link item key', () => {
  assert.equal(zf.extractItemKeyFromZoteroLink('zotero://select/library/items/ABCD1234'), 'ABCD1234');
  assert.equal(zf.extractItemKeyFromZoteroLink(''), null);
  assert.equal(zf.extractItemKeyFromZoteroLink(undefined), null);
});

test('loadPaperJoins: per-field hasZotero/hasVenue/hasUrl reflect frontmatter non-emptiness', () => {
  const root = makeRoot();
  writePaper(root, 'complete2024a', {
    zotero: 'zotero://select/library/items/ITEMA',
    venue: 'arXiv',
    url: 'https://x',
  });
  writePaper(root, 'incomplete2024b', { zotero: '', venue: 'arXiv', url: 'https://x' });
  const { byItemKey, byCitekey } = zf.loadPaperJoins(root);
  assert.equal(byCitekey.get('complete2024a').hasZotero, true);
  assert.equal(byCitekey.get('complete2024a').hasVenue, true);
  assert.equal(byCitekey.get('complete2024a').hasUrl, true);
  assert.equal(byItemKey.get('ITEMA').hasZotero, true);
  assert.equal(byCitekey.get('incomplete2024b').hasZotero, false);
  assert.equal(byItemKey.has('incomplete2024b'), false); // no zotero link -> no item-key join
});

// ---------- pagination ----------

test('fetchAllTopItems aggregates multiple fixture pages and excludes attachments/notes', async () => {
  const source = zf.fixtureSource({
    pageSize: 2,
    items: [
      item('I1'),
      item('I2'),
      { key: 'I3', data: { itemType: 'attachment' } },
      item('I4'),
      { key: 'I5', data: { itemType: 'note' } },
    ],
  });
  const items = await zf.fetchAllTopItems(source, 'ANY');
  assert.deepEqual(
    items.map((i) => i.key),
    ['I1', 'I2', 'I4']
  );
});

// ---------- mergeQueue() rules (sync-backlog.md §2) ----------

test('rule 1: new discovered item is appended as pending', () => {
  const discovered = new Map([['I1', { itemKey: 'I1', citekey: 'foo2024bar', action: 'create', blockedReason: null, metadata: {} }]]);
  const joins = { byItemKey: new Map(), byCitekey: new Map() };
  const merged = zf.mergeQueue([], discovered, joins, null);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'pending');
});

test('rule 2: existing pending entry gets fresh metadata; no-citekey entry resolves to pending', () => {
  const existing = [
    { itemKey: 'I1', citekey: 'foo2024bar', action: 'create', status: 'pending', attempts: 0, blockedReason: null, metadata: { title: 'Old' } },
    { itemKey: 'I2', citekey: null, action: 'blocked', status: 'blocked', attempts: 0, blockedReason: 'no-citekey', metadata: {} },
  ];
  const discovered = new Map([
    ['I1', { itemKey: 'I1', citekey: 'foo2024bar', action: 'create', blockedReason: null, metadata: { title: 'New' } }],
    ['I2', { itemKey: 'I2', citekey: 'nowresolved2024', action: 'create', blockedReason: null, metadata: {} }],
  ]);
  const joins = { byItemKey: new Map(), byCitekey: new Map() };
  const merged = zf.mergeQueue(existing, discovered, joins, null);
  const byKey = new Map(merged.map((e) => [e.itemKey, e]));
  assert.equal(byKey.get('I1').metadata.title, 'New');
  assert.equal(byKey.get('I2').status, 'pending');
  assert.equal(byKey.get('I2').citekey, 'nowresolved2024');
  assert.equal(byKey.get('I2').blockedReason, null);
});

test('rule 3: entry removed once its item has a complete note (absent from discovered)', () => {
  const existing = [{ itemKey: 'I1', citekey: 'foo2024bar', action: 'create', status: 'pending', attempts: 0, blockedReason: null, metadata: {} }];
  const merged = zf.mergeQueue(existing, new Map(), { byItemKey: new Map(), byCitekey: new Map() }, null);
  assert.equal(merged.length, 0);
});

test('rule 4: a "done" entry is always removed', () => {
  const existing = [{ itemKey: 'I1', citekey: 'foo2024bar', action: 'create', status: 'done', attempts: 0, blockedReason: null, metadata: {} }];
  const discovered = new Map([['I1', { itemKey: 'I1', citekey: 'foo2024bar', action: 'create', blockedReason: null, metadata: {} }]]);
  const merged = zf.mergeQueue(existing, discovered, { byItemKey: new Map(), byCitekey: new Map() }, null);
  assert.equal(merged.length, 0);
});

test('rule 5: "in-progress" crash leftover resets to pending when no note file exists', () => {
  const existing = [{ itemKey: 'I1', citekey: 'foo2024bar', action: 'create', status: 'in-progress', attempts: 0, blockedReason: null, metadata: {} }];
  const discovered = new Map([['I1', { itemKey: 'I1', citekey: 'foo2024bar', action: 'create', blockedReason: null, metadata: {} }]]);
  const merged = zf.mergeQueue(existing, discovered, { byItemKey: new Map(), byCitekey: new Map() }, null);
  assert.equal(merged[0].status, 'pending');
});

test('rule 5: "in-progress" leftover is removed when the note now exists and is complete', () => {
  const existing = [{ itemKey: 'I1', citekey: 'foo2024bar', action: 'create', status: 'in-progress', attempts: 0, blockedReason: null, metadata: {} }];
  // note now complete -> classify() would put it in skip, so it's absent from `discovered`
  const merged = zf.mergeQueue(existing, new Map(), { byItemKey: new Map(), byCitekey: new Map() }, null);
  assert.equal(merged.length, 0);
});

test('rule 6: --limit caps only new items, never drops existing entries', () => {
  const existing = [{ itemKey: 'I1', citekey: 'foo2024bar', action: 'create', status: 'pending', attempts: 0, blockedReason: null, metadata: {} }];
  const discovered = new Map([
    ['I1', { itemKey: 'I1', citekey: 'foo2024bar', action: 'create', blockedReason: null, metadata: {} }],
    ['I2', { itemKey: 'I2', citekey: 'baz2024qux', action: 'create', blockedReason: null, metadata: {} }],
    ['I3', { itemKey: 'I3', citekey: 'zzz2024top', action: 'create', blockedReason: null, metadata: {} }],
  ]);
  const merged = zf.mergeQueue(existing, discovered, { byItemKey: new Map(), byCitekey: new Map() }, 1);
  // I1 (existing) + exactly 1 of the 2 brand-new items
  assert.equal(merged.length, 2);
  assert.ok(merged.some((e) => e.itemKey === 'I1'));
});

test('a duplicate itemKey in the input queue is silently deduped (last-write-wins), not rejected with an error', () => {
  const existing = [
    { itemKey: 'I1', citekey: 'a', action: 'create', status: 'pending', attempts: 0, blockedReason: null, metadata: { v: 1 } },
    { itemKey: 'I1', citekey: 'a', action: 'create', status: 'pending', attempts: 0, blockedReason: null, metadata: { v: 2 } },
  ];
  const discovered = new Map([['I1', { itemKey: 'I1', citekey: 'a', action: 'create', blockedReason: null, metadata: { v: 3 } }]]);
  const merged = zf.mergeQueue(existing, discovered, { byItemKey: new Map(), byCitekey: new Map() }, null);
  assert.equal(merged.length, 1);
});

// ---------- full run() integration (--from-fixture) ----------

test('run(): collection not found -> exit 3, lists available names', async () => {
  const root = makeRoot();
  const fixturePath = path.join(root, 'fixture.json');
  fs.writeFileSync(
    fixturePath,
    JSON.stringify({ collections: [{ key: 'K1', data: { name: 'to-note' } }], items: [], citekeys: {} })
  );
  const code = await zf.run(root, ['--from-fixture', fixturePath, '--collection', 'nonexistent']);
  assert.equal(code, 3);
});

test('run(): --dry-run writes nothing', async () => {
  const root = makeRoot();
  const fixturePath = path.join(root, 'fixture.json');
  fs.writeFileSync(
    fixturePath,
    JSON.stringify({
      collections: [{ key: 'K1', data: { name: 'to-note' } }],
      items: [item('I1')],
      citekeys: { I1: 'foo2024bar' },
    })
  );
  const code = await zf.run(root, ['--from-fixture', fixturePath, '--dry-run']);
  assert.equal(code, 0);
  assert.equal(fs.existsSync(path.join(root, '.sync', 'queue.json')), false);
});

test('run(): two runs with no state change produce a byte-identical queue (idempotent)', async () => {
  const root = makeRoot();
  const fixturePath = path.join(root, 'fixture.json');
  fs.writeFileSync(
    fixturePath,
    JSON.stringify({
      collections: [{ key: 'K1', data: { name: 'to-note' } }],
      items: [item('I1')],
      citekeys: { I1: 'foo2024bar' },
    })
  );
  await zf.run(root, ['--from-fixture', fixturePath]);
  const first = JSON.parse(fs.readFileSync(path.join(root, '.sync', 'queue.json'), 'utf8'));
  await zf.run(root, ['--from-fixture', fixturePath]);
  const second = JSON.parse(fs.readFileSync(path.join(root, '.sync', 'queue.json'), 'utf8'));
  delete first.generated;
  delete second.generated;
  assert.deepEqual(first, second);
});

test('run(): only queue.json remains on disk, no leftover atomic-write temp files', async () => {
  const root = makeRoot();
  const fixturePath = path.join(root, 'fixture.json');
  fs.writeFileSync(
    fixturePath,
    JSON.stringify({
      collections: [{ key: 'K1', data: { name: 'to-note' } }],
      items: [item('I1')],
      citekeys: { I1: 'foo2024bar' },
    })
  );
  await zf.run(root, ['--from-fixture', fixturePath]);
  const files = fs.readdirSync(path.join(root, '.sync'));
  assert.deepEqual(files, ['queue.json']);
});

test('run(): config.json collection is used when --collection is not passed, flag overrides it', async () => {
  const root = makeRoot();
  const fixturePath = path.join(root, 'fixture.json');
  fs.writeFileSync(
    fixturePath,
    JSON.stringify({
      collections: [
        { key: 'K1', data: { name: 'to-note' } },
        { key: 'K2', data: { name: 'from-config' } },
      ],
      items: [],
      citekeys: {},
    })
  );
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ zotero: { collection: 'from-config' } }));

  const codeConfig = await zf.run(root, ['--from-fixture', fixturePath]);
  assert.equal(codeConfig, 0); // resolves via config.json, doesn't 3

  const codeFlagOverride = await zf.run(root, ['--from-fixture', fixturePath, '--collection', 'to-note']);
  assert.equal(codeFlagOverride, 0); // flag beats config.json, still resolves
});

test('run(): using the checked-in basic.json fixture end-to-end (1 create, 1 blocked, attachment excluded)', async () => {
  const root = makeRoot();
  const fixturePath = path.join(__dirname, 'fixtures', 'zotero', 'basic.json');

  const original = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => {
    out += chunk;
    return true;
  };
  let code;
  try {
    code = await zf.run(root, ['--from-fixture', fixturePath]);
  } finally {
    process.stdout.write = original;
  }

  assert.equal(code, 0);
  assert.match(out, /1 create, 0 enrich, 1 blocked, 0 skipped/);
  const queue = JSON.parse(fs.readFileSync(path.join(root, '.sync', 'queue.json'), 'utf8'));
  assert.equal(queue.items.length, 2); // attachment (ITEM0003) excluded entirely
  assert.ok(queue.items.some((e) => e.itemKey === 'ITEM0001' && e.action === 'create'));
  assert.ok(queue.items.some((e) => e.itemKey === 'ITEM0002' && e.blockedReason === 'no-citekey'));
});

test('run(): prints the documented "N create, M enrich, K blocked, J skipped" summary', async () => {
  const root = makeRoot();
  writePaper(root, 'complete2024a', { zotero: 'zotero://select/library/items/ISKIP', venue: 'v', url: 'https://x' });
  const fixturePath = path.join(root, 'fixture.json');
  fs.writeFileSync(
    fixturePath,
    JSON.stringify({
      collections: [{ key: 'K1', data: { name: 'to-note' } }],
      items: [item('ICREATE'), item('ISKIP')],
      citekeys: { ICREATE: 'foo2024bar', ISKIP: 'complete2024a' },
    })
  );
  const original = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => {
    out += chunk;
    return true;
  };
  try {
    await zf.run(root, ['--from-fixture', fixturePath]);
  } finally {
    process.stdout.write = original;
  }
  assert.match(out, /1 create, 0 enrich, 0 blocked, 1 skipped/);
});

test('Fix A #6: venue-less (arXiv-style) complete note classifies as skip, not perpetual enrich', async () => {
  const root = makeRoot();
  writePaper(root, 'arxiv2024a', {
    zotero: 'zotero://select/library/items/IARXIV',
    venue: '',
    url: 'https://arxiv.org/abs/1234',
  });
  const fixturePath = path.join(root, 'fixture.json');
  fs.writeFileSync(
    fixturePath,
    JSON.stringify({
      collections: [{ key: 'K1', data: { name: 'to-note' } }],
      items: [item('IARXIV')], // no publicationTitle -> metadata.venue === ''
      citekeys: { IARXIV: 'arxiv2024a' },
    })
  );
  const original = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => {
    out += chunk;
    return true;
  };
  let code;
  try {
    code = await zf.run(root, ['--from-fixture', fixturePath]);
  } finally {
    process.stdout.write = original;
  }
  assert.equal(code, 0);
  assert.match(out, /0 create, 0 enrich, 0 blocked, 1 skipped/);
  const queue = JSON.parse(fs.readFileSync(path.join(root, '.sync', 'queue.json'), 'utf8'));
  assert.equal(queue.items.length, 0);
});

test('Fix B: item with no date and no note -> blocked no-year, no note authored; gains a date next fetch -> pending', async () => {
  const root = makeRoot();
  const fixturePath = path.join(root, 'fixture.json');
  fs.writeFileSync(
    fixturePath,
    JSON.stringify({
      collections: [{ key: 'K1', data: { name: 'to-note' } }],
      items: [item('INOYR', { date: '' })],
      citekeys: { INOYR: 'noyear2024x' },
    })
  );
  await zf.run(root, ['--from-fixture', fixturePath]);
  let queue = JSON.parse(fs.readFileSync(path.join(root, '.sync', 'queue.json'), 'utf8'));
  assert.equal(queue.items[0].status, 'blocked');
  assert.equal(queue.items[0].blockedReason, 'no-year');
  assert.equal(fs.existsSync(path.join(root, 'papers', 'noyear2024x.md')), false);

  fs.writeFileSync(
    fixturePath,
    JSON.stringify({
      collections: [{ key: 'K1', data: { name: 'to-note' } }],
      items: [item('INOYR', { date: '2024' })],
      citekeys: { INOYR: 'noyear2024x' },
    })
  );
  await zf.run(root, ['--from-fixture', fixturePath]);
  queue = JSON.parse(fs.readFileSync(path.join(root, '.sync', 'queue.json'), 'utf8'));
  assert.equal(queue.items[0].status, 'pending');
  assert.equal(queue.items[0].blockedReason, null);
});

test('--limit 10 on a large collection then an unlimited re-run appends the rest without duplicating the first batch', async () => {
  const root = makeRoot();
  const items = Array.from({ length: 15 }, (_, i) => item(`I${i}`));
  const citekeys = Object.fromEntries(items.map((it, i) => [it.key, `foo2024key${i}`]));
  const fixturePath = path.join(root, 'fixture.json');
  fs.writeFileSync(
    fixturePath,
    JSON.stringify({ collections: [{ key: 'K1', data: { name: 'to-note' } }], items, citekeys })
  );

  await zf.run(root, ['--from-fixture', fixturePath, '--limit', '10']);
  const afterFirst = JSON.parse(fs.readFileSync(path.join(root, '.sync', 'queue.json'), 'utf8'));
  assert.equal(afterFirst.items.length, 10);

  await zf.run(root, ['--from-fixture', fixturePath]);
  const afterSecond = JSON.parse(fs.readFileSync(path.join(root, '.sync', 'queue.json'), 'utf8'));
  assert.equal(afterSecond.items.length, 15);
  const keys = new Set(afterSecond.items.map((e) => e.itemKey));
  assert.equal(keys.size, 15); // no duplicates
  for (const e of afterFirst.items) assert.ok(keys.has(e.itemKey)); // first 10 preserved
});

// ---------- usage/config error handling (post-review: distinct from exit 2) ----------

test('run(): unknown CLI argument is a configuration error (exit 3), not environment (exit 2)', async () => {
  const root = makeRoot();
  const code = await zf.run(root, ['--nope']);
  assert.equal(code, 3);
});

test('run(): non-numeric --limit is a configuration error (exit 3), not a silently-unbounded limit', async () => {
  const root = makeRoot();
  const fixturePath = path.join(root, 'fixture.json');
  fs.writeFileSync(fixturePath, JSON.stringify({ collections: [], items: [], citekeys: {} }));
  const code = await zf.run(root, ['--from-fixture', fixturePath, '--limit', 'not-a-number']);
  assert.equal(code, 3);
});

test('run(): --from-fixture with no path value errors (exit 3) instead of silently falling back to live Zotero', async () => {
  const root = makeRoot();
  const code = await zf.run(root, ['--from-fixture']);
  assert.equal(code, 3);
});

test('run(): unreadable --from-fixture path is a configuration error (exit 3)', async () => {
  const root = makeRoot();
  const code = await zf.run(root, ['--from-fixture', path.join(root, 'does-not-exist.json')]);
  assert.equal(code, 3);
});

test('loadPaperJoins tolerates CRLF line endings and a leading BOM (post-review fix)', () => {
  const root = makeRoot();
  const crlf =
    '﻿' +
    [
      '---',
      'citekey: "crlf2024test"',
      'title: "CRLF Test"',
      'authors: [Foo]',
      'year: 2024',
      'venue: "arXiv"',
      'url: "https://x"',
      'zotero: "zotero://select/library/items/ICRLF"',
      'depth: "metadata"',
      'topics: []',
      'added: "2026-01-01"',
      'updated: "2026-01-01"',
      '---',
      '',
      '## Contribution',
      '',
      'Body.',
      '',
    ]
      .join('\n')
      .replace(/\n/g, '\r\n');
  fs.writeFileSync(path.join(root, 'papers', 'crlf2024test.md'), crlf, 'utf8');
  const { byItemKey } = zf.loadPaperJoins(root);
  assert.equal(byItemKey.get('ICRLF').citekey, 'crlf2024test');
});
