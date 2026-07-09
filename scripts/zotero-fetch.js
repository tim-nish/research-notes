#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
// 127.0.0.1, not localhost: Zotero's connector HTTP server is IPv4-only, but
// Node's fetch (undici) resolves "localhost" to ::1 first and gets
// ECONNREFUSED before ever trying the IPv4 address — curl doesn't hit this
// because it tries 127.0.0.1 directly. See Story 0W spike.
const LOCAL_API_BASE = process.env.ZOTERO_BASE_URL || 'http://127.0.0.1:23119';
const DEFAULT_COLLECTION = 'to-note';
const DEFAULT_OUT = '.sync/queue.json';
const HTTP_PAGE_SIZE = 100;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\r?\n?([\s\S]*)$/;
const ZOTERO_LINK_RE = /zotero:\/\/select\/library\/items\/([A-Za-z0-9]+)/;

class EnvError extends Error {}
// Exit 3 per specs/README.md's shared convention: "configuration failure" — a
// missing collection, but also any usage mistake (bad flag, unreadable fixture
// file). Kept distinct from EnvError (exit 2) so the /sync workflow's "Zotero
// unreachable" remediation branch never fires for a CLI typo.
class ConfigError extends Error {
  constructor(message, availableNames = []) {
    super(message);
    this.availableNames = availableNames;
  }
}

// ---------- Zotero/BBT sources (live HTTP or --from-fixture) ----------

function liveSource() {
  async function getJson(url) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new EnvError(
        `cannot reach Zotero local API at ${url} (${e.message}). Enable "Allow other applications ` +
          'on this computer to communicate with Zotero" in Zotero Settings -> Advanced.'
      );
    }
    if (!res.ok) throw new EnvError(`Zotero local API returned HTTP ${res.status} for ${url}`);
    return res.json();
  }

  return {
    async listCollections() {
      return getJson(`${LOCAL_API_BASE}/api/users/0/collections`);
    },
    async fetchItemsPage(collectionKey, start, limit) {
      // Explicit sort so queue append order matches the "oldest saves first"
      // guarantee specs/sync-backlog.md §3 relies on, rather than trusting
      // whatever the API's undocumented default ordering happens to be.
      return getJson(
        `${LOCAL_API_BASE}/api/users/0/collections/${collectionKey}/items/top?format=json&start=${start}&limit=${limit}&sort=dateAdded&direction=asc`
      );
    },
    async resolveCitekeys(itemKeys) {
      let res;
      try {
        res = await fetch(`${LOCAL_API_BASE}/better-bibtex/json-rpc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'item.citationkey', params: [itemKeys] }),
        });
      } catch (e) {
        throw new EnvError(`cannot reach Better BibTeX JSON-RPC (${e.message}). Is the Better BibTeX plugin installed?`);
      }
      if (!res.ok) throw new EnvError(`Better BibTeX JSON-RPC returned HTTP ${res.status}`);
      const body = await res.json();
      const mapping = (body && body.result) || {};
      return new Map(itemKeys.map((k) => [k, mapping[k] != null ? String(mapping[k]) : null]));
    },
  };
}

// Fixture shape: { collections: [{key, data:{name}}], items: [{key, data:{...}}],
// citekeys: {itemKey: citekey}, pageSize?: number }. Structurally close to the real
// API/RPC response shapes so fixtures double as documentation of them.
function fixtureSource(fixture) {
  const pageSize = fixture.pageSize || HTTP_PAGE_SIZE;
  const items = fixture.items || [];
  return {
    async listCollections() {
      return fixture.collections || [];
    },
    async fetchItemsPage(collectionKey, start) {
      return items.slice(start, start + pageSize);
    },
    async resolveCitekeys(itemKeys) {
      const citekeys = fixture.citekeys || {};
      return new Map(itemKeys.map((k) => [k, citekeys[k] != null ? String(citekeys[k]) : null]));
    },
  };
}

// ---------- Discovery ----------

async function resolveCollectionKey(source, collectionName) {
  const collections = await source.listCollections();
  const match = collections.find((c) => c.data && c.data.name === collectionName);
  if (!match) {
    throw new ConfigError(
      `collection "${collectionName}" not found`,
      collections.map((c) => (c.data ? c.data.name : undefined)).filter(Boolean)
    );
  }
  return match.key;
}

async function fetchAllTopItems(source, collectionKey) {
  const all = [];
  let start = 0;
  for (;;) {
    const page = await source.fetchItemsPage(collectionKey, start, HTTP_PAGE_SIZE);
    if (page.length === 0) break;
    all.push(...page);
    start += page.length; // not HTTP_PAGE_SIZE: a source may honor a different effective page size
  }
  return all.filter((item) => {
    const t = item.data && item.data.itemType;
    return t !== 'attachment' && t !== 'note';
  });
}

function extractYear(dateStr) {
  const m = /\d{4}/.exec(dateStr || '');
  return m ? Number(m[0]) : null;
}

function itemMetadata(item) {
  const d = item.data || {};
  return {
    title: d.title != null ? String(d.title) : '',
    creators: Array.isArray(d.creators) ? d.creators : [],
    year: extractYear(d.date),
    venue: d.publicationTitle || d.conferenceName || d.proceedingsTitle || '',
    doi: d.DOI != null ? String(d.DOI) : '',
    url: d.url != null ? String(d.url) : '',
    abstractNote: d.abstractNote != null ? String(d.abstractNote) : '',
  };
}

function extractItemKeyFromZoteroLink(link) {
  const m = ZOTERO_LINK_RE.exec(link || '');
  return m ? m[1] : null;
}

// Scan papers/*.md frontmatter for the two idempotency joins (item key, citekey).
function loadPaperJoins(root) {
  const dir = path.join(root, 'papers');
  const byItemKey = new Map();
  const byCitekey = new Map();
  if (!fs.existsSync(dir)) return { byItemKey, byCitekey };
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    let raw = fs.readFileSync(path.join(dir, f), 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    raw = raw.replace(/\r\n/g, '\n');
    const match = FRONTMATTER_RE.exec(raw);
    if (!match) continue;
    let fm;
    try {
      fm = yaml.load(match[1]);
    } catch (e) {
      continue; // corrupt frontmatter: not this script's job to report (doctor's D01 does)
    }
    if (!fm || typeof fm !== 'object' || Array.isArray(fm)) continue;
    const citekey = fm.citekey != null ? String(fm.citekey) : path.basename(f, '.md');
    const zoteroLink = fm.zotero != null ? String(fm.zotero) : '';
    const venue = fm.venue != null ? String(fm.venue) : '';
    const url = fm.url != null ? String(fm.url) : '';
    const hasZotero = zoteroLink !== '';
    const hasVenue = venue !== '';
    const hasUrl = url !== '';
    const itemKey = extractItemKeyFromZoteroLink(zoteroLink);
    const record = { citekey, itemKey, hasZotero, hasVenue, hasUrl, path: `papers/${f}` };
    byCitekey.set(citekey, record);
    if (itemKey) byItemKey.set(itemKey, record);
  }
  return { byItemKey, byCitekey };
}

// Resolvable blockedReason values: ones a later fetch can clear on its own once
// the underlying Zotero/BBT state improves (sync-stage1-fixes.md Fix B). Kept
// distinct from `repeated-failure`, which the /sync agent sets and which must
// never auto-unblock (sync-backlog.md §3).
const RESOLVABLE_BLOCKED_REASONS = new Set(['no-citekey', 'no-year']);

// Classify every currently-fetched top-level item. Returns a Map<itemKey, entry>
// containing only create/enrich/blocked items — a fully-noted item is "skip" and
// simply absent from the map (this doubles as the merge's removal signal).
function classify(items, citekeyMap, joins) {
  const discovered = new Map();
  let skipped = 0;
  for (const item of items) {
    const itemKey = item.key;
    const bbtCitekey = citekeyMap.get(itemKey) || null;
    const metadata = itemMetadata(item);

    if (!bbtCitekey) {
      discovered.set(itemKey, { itemKey, citekey: null, action: 'blocked', blockedReason: 'no-citekey', metadata });
      continue;
    }

    // Item-key is the primary join (spec §3): if a note's `zotero:` link
    // already points at this item, that note's own citekey wins over
    // whatever BBT currently has pinned — a re-pin in Zotero after note
    // creation must never make `enrich` target a file that doesn't exist.
    const match = joins.byItemKey.get(itemKey) || joins.byCitekey.get(bbtCitekey);
    if (match) {
      // Fix A (sync-stage1-fixes.md §1): a field is fillable when it is empty
      // in the note AND Zotero has a non-empty value for it; the zotero link
      // is always fillable when empty. Skip iff nothing is fillable — this is
      // what lets venue-less (e.g. arXiv) notes ever reach "skip" instead of
      // re-queuing as a no-op `enrich` forever.
      const skip = match.hasZotero && (match.hasVenue || metadata.venue === '') && (match.hasUrl || metadata.url === '');
      if (skip) {
        skipped++;
        continue;
      }
      discovered.set(itemKey, { itemKey, citekey: match.citekey, action: 'enrich', blockedReason: null, metadata });
      continue;
    }

    // Fix B (sync-stage1-fixes.md §2): create path only. A Zotero item with no
    // date can never satisfy doctor's required `year` field, and `enrich`
    // never fills `year` — block it up front instead of authoring a note that
    // can never self-heal.
    if (metadata.year == null) {
      discovered.set(itemKey, { itemKey, citekey: bbtCitekey, action: 'blocked', blockedReason: 'no-year', metadata });
      continue;
    }
    discovered.set(itemKey, { itemKey, citekey: bbtCitekey, action: 'create', blockedReason: null, metadata });
  }
  return { discovered, skipped };
}

// ---------- Queue merge (sync-backlog.md §2) ----------

function mergeQueue(existingItems, discoveredMap, joins, limitNew) {
  const result = new Map();
  // Every itemKey the queue already knew about, whether or not it survives into
  // `result` — the "brand-new items" pass below must never resurrect one of
  // these (e.g. a dropped `done` entry) as if it were newly discovered.
  const known = new Set(existingItems.map((e) => e.itemKey));

  // Rules 2-5: refresh/transition every existing entry still present this run.
  // An entry absent from `discoveredMap` means either its note is now complete
  // (rule 3) or its item left the collection — both cases: removed.
  for (const entry of existingItems) {
    const fresh = discoveredMap.get(entry.itemKey);
    if (!fresh) continue; // removed
    if (entry.status === 'done') continue; // rule 4 (rule 3 usually already caught this)

    let status = entry.status;
    let blockedReason = entry.blockedReason;
    let citekey = entry.citekey;

    if (status === 'in-progress') {
      // rule 5: crash leftover
      status = 'pending';
    }
    if (status === 'blocked' && RESOLVABLE_BLOCKED_REASONS.has(blockedReason)) {
      if (fresh.action === 'blocked' && RESOLVABLE_BLOCKED_REASONS.has(fresh.blockedReason)) {
        // still blocked, possibly for a different resolvable reason now
        blockedReason = fresh.blockedReason;
      } else {
        status = 'pending';
        blockedReason = null;
      }
    }
    if (status !== 'blocked' && fresh.action === 'blocked' && RESOLVABLE_BLOCKED_REASONS.has(fresh.blockedReason)) {
      // was resolvable before, Zotero/BBT state regressed — treat consistently with fresh classification
      status = 'blocked';
      blockedReason = fresh.blockedReason;
    }
    if (fresh.citekey) citekey = fresh.citekey;

    result.set(entry.itemKey, {
      itemKey: entry.itemKey,
      citekey,
      action: fresh.action,
      status,
      attempts: entry.attempts || 0,
      blockedReason: status === 'blocked' ? blockedReason || 'no-citekey' : null,
      metadata: fresh.metadata, // rule 2: refresh metadata from Zotero
    });
  }

  // Rules 1 + 6: brand-new discovered items, capped by --limit.
  let appended = 0;
  for (const [itemKey, fresh] of discoveredMap) {
    if (known.has(itemKey)) continue;
    if (limitNew != null && appended >= limitNew) continue;
    result.set(itemKey, {
      itemKey,
      citekey: fresh.citekey,
      action: fresh.action,
      status: fresh.action === 'blocked' ? 'blocked' : 'pending',
      attempts: 0,
      blockedReason: fresh.blockedReason,
      metadata: fresh.metadata,
    });
    appended++;
  }

  return [...result.values()];
}

// ---------- Config / CLI ----------

function loadConfig(root) {
  const p = path.join(root, 'config.json');
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    process.stderr.write(`warning: config.json exists but failed to parse (${e.message}); using defaults\n`);
    return {};
  }
}

function requireValue(argv, i, flag) {
  const v = argv[i];
  if (v === undefined || v.startsWith('--')) throw new ConfigError(`${flag} requires a value`);
  return v;
}

function parseArgs(argv) {
  const args = { collection: null, limit: null, dryRun: false, out: DEFAULT_OUT, fromFixture: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--collection') args.collection = requireValue(argv, ++i, '--collection');
    else if (a === '--limit') {
      const raw = requireValue(argv, ++i, '--limit');
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new ConfigError(`--limit requires a number, got "${raw}"`);
      args.limit = n;
    } else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--out') args.out = requireValue(argv, ++i, '--out');
    else if (a === '--from-fixture') args.fromFixture = requireValue(argv, ++i, '--from-fixture');
    else throw new ConfigError(`unknown argument: ${a}`);
  }
  return args;
}

function writeQueueAtomic(queuePath, data) {
  fs.mkdirSync(path.dirname(queuePath), { recursive: true });
  const tmp = `${queuePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, queuePath);
  } catch (e) {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    throw e;
  }
}

function loadExistingQueue(queuePath) {
  if (!fs.existsSync(queuePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch (e) {
    process.stderr.write(`warning: ${queuePath} exists but failed to parse (${e.message}); rebuilding from scratch\n`);
    return [];
  }
}

async function run(root, argv) {
  try {
    return await runUnsafe(root, argv);
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`error: ${e.message}\n`);
      if (e.availableNames.length > 0) {
        process.stderr.write(`available collections: ${e.availableNames.join(', ')}\n`);
      }
      return 3;
    }
    if (e instanceof EnvError) {
      process.stderr.write(`error: ${e.message}\n`);
      return 2;
    }
    process.stderr.write(`error: unexpected failure: ${e.message}\n`);
    return 2;
  }
}

async function runUnsafe(root, argv) {
  const args = parseArgs(argv);
  const config = loadConfig(root);
  const collectionName = args.collection || (config.zotero && config.zotero.collection) || DEFAULT_COLLECTION;

  let source;
  if (args.fromFixture) {
    let fixtureData;
    try {
      fixtureData = JSON.parse(fs.readFileSync(path.resolve(root, args.fromFixture), 'utf8'));
    } catch (e) {
      throw new ConfigError(`--from-fixture file "${args.fromFixture}" could not be read/parsed: ${e.message}`);
    }
    source = fixtureSource(fixtureData);
  } else {
    source = liveSource();
  }

  const collectionKey = await resolveCollectionKey(source, collectionName);
  const items = await fetchAllTopItems(source, collectionKey);
  const citekeyMap = await source.resolveCitekeys(items.map((i) => i.key));
  const joins = loadPaperJoins(root);
  const { discovered, skipped } = classify(items, citekeyMap, joins);

  const queuePath = path.resolve(root, args.out);
  const existing = loadExistingQueue(queuePath);
  const merged = mergeQueue(existing, discovered, joins, args.limit);

  const counts = merged.reduce(
    (acc, e) => {
      if (e.status === 'blocked') acc.blocked++;
      else if (e.action === 'create') acc.create++;
      else if (e.action === 'enrich') acc.enrich++;
      return acc;
    },
    { create: 0, enrich: 0, blocked: 0 }
  );
  process.stdout.write(
    `${counts.create} create, ${counts.enrich} enrich, ${counts.blocked} blocked, ${skipped} skipped\n`
  );

  if (!args.dryRun) {
    writeQueueAtomic(queuePath, {
      schema: 1,
      generated: new Date().toISOString(),
      source: { library: 'users/0', collection: collectionName },
      items: merged,
    });
  }

  return 0;
}

if (require.main === module) {
  run(ROOT, process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

module.exports = {
  run,
  classify,
  mergeQueue,
  loadPaperJoins,
  extractItemKeyFromZoteroLink,
  fixtureSource,
  itemMetadata,
  extractYear,
  resolveCollectionKey,
  fetchAllTopItems,
  loadConfig,
  loadExistingQueue,
  writeQueueAtomic,
  EnvError,
  ConfigError,
};
