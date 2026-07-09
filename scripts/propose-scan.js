#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseTopicFile } = require('./lib/topic-map.js');

const ROOT = path.resolve(__dirname, '..');

function listMdFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => path.join(dir, f));
}

function parseArgs(argv) {
  const args = { topic: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') {
      args.json = true;
    } else if (a === '--topic') {
      i++;
      if (i >= argv.length) throw new Error('--topic requires a value');
      args.topic = argv[i];
    } else {
      throw new Error(`unknown argument: ${a} (valid: --topic <name>, --json)`);
    }
  }
  return args;
}

// Current UTC date at midnight, formatted "YYYY-MM-DDT00:00:00Z" -- day-level
// (not wall-clock) so repeated runs within the same day are byte-identical,
// per the determinism requirement (propose-scan.md §6/§7).
function generatedTimestamp() {
  return `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
}

// Build the candidate list and topic summaries from parsed topic maps + the
// catalog. Pure function of its inputs so it's easy to unit test.
function computeScan(papers, topicMaps) {
  // Per-map cluster/queue citekey sets, keyed by map name.
  const clusterSetByMap = new Map();
  const queueSetByMap = new Map();
  for (const tm of topicMaps) {
    const clusterSet = new Set();
    for (const cluster of tm.clusters) {
      for (const ck of cluster.citekeys) clusterSet.add(ck);
    }
    clusterSetByMap.set(tm.name, clusterSet);
    queueSetByMap.set(tm.name, new Set(tm.readingQueue));
  }

  const candidates = [];
  for (const paper of papers) {
    const cOf = []; // map names whose Clusters list this paper
    const qOf = []; // map names whose Reading queue list this paper
    for (const tm of topicMaps) {
      if (clusterSetByMap.get(tm.name).has(paper.citekey)) cOf.push(tm.name);
      if (queueSetByMap.get(tm.name).has(paper.citekey)) qOf.push(tm.name);
    }

    const fEmpty = !paper.topics || paper.topics.length === 0;
    const cEmpty = cOf.length === 0;
    const qEmpty = qOf.length === 0;

    let cls = null;
    if (fEmpty && cEmpty && qEmpty) {
      cls = 'unassigned';
    } else if (cEmpty && !qEmpty) {
      cls = 'queue-only';
    }
    // Settled (non-empty C(p)) and drift (F(p) disagrees with map membership,
    // yet matches neither class above) are never candidates -- propose-scan.md §4.
    if (cls === null) continue;

    candidates.push({
      citekey: paper.citekey,
      class: cls,
      title: paper.title,
      year: paper.year,
      depth: paper.depth,
      topics: paper.topics,
      contribution: paper.contribution,
      queuedIn: qOf,
    });
  }
  candidates.sort((a, b) => (a.citekey < b.citekey ? -1 : a.citekey > b.citekey ? 1 : 0));

  const topics = topicMaps.map((tm) => ({
    name: tm.name,
    one_liner: tm.one_liner,
    clusters: tm.clusters.map((c) => ({ name: c.name, citekeys: c.citekeys })),
    readingQueue: tm.readingQueue,
  }));

  return { topics, candidates };
}

function scopeResult(scan, topicName) {
  const topics = scan.topics.filter((t) => t.name === topicName);
  const candidates = scan.candidates.filter(
    (c) => c.class === 'queue-only' && c.queuedIn.includes(topicName)
  );
  return { topics, candidates };
}

function formatHuman(scan, scope) {
  const lines = [];
  const unassigned = scan.candidates.filter((c) => c.class === 'unassigned').length;
  const queueOnly = scan.candidates.filter((c) => c.class === 'queue-only').length;
  lines.push(
    `propose-scan: ${scan.candidates.length} candidate(s) (${unassigned} unassigned, ${queueOnly} queue-only)` +
      (scope ? ` [scope: ${scope}]` : '')
  );
  if (scan.topics.length > 0) {
    lines.push('');
    lines.push('Topics:');
    for (const t of scan.topics) {
      const clusterCount = t.clusters.length;
      const memberCount = t.clusters.reduce((n, c) => n + c.citekeys.length, 0);
      const queueCount = t.readingQueue.length;
      lines.push(
        `- ${t.name}: ${clusterCount} cluster(s) (${memberCount} citekey(s)), ${queueCount} in reading queue`
      );
      const unnamed = t.clusters.filter((c) => c.name === null).length;
      if (unnamed > 0) {
        lines.push(`  warning: ${unnamed} cluster(s) with no determinable name`);
      }
    }
  }
  return lines.join('\n');
}

function run(root, argv) {
  try {
    return runUnsafe(root, argv);
  } catch (e) {
    process.stderr.write(`error: unexpected failure: ${e.message}\n`);
    return 2;
  }
}

function runUnsafe(root, argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    // A bad/missing CLI argument is a configuration problem (exit 3), not an
    // unexpected environment failure (exit 2) -- matches zotero-fetch.js's
    // established convention for the same error class.
    process.stderr.write(`error: ${e.message}\n`);
    return 3;
  }

  const catalogPath = path.join(root, 'catalog.json');
  if (!fs.existsSync(catalogPath)) {
    process.stderr.write('error: catalog.json not found; run node scripts/build-catalog.js\n');
    return 1;
  }
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  } catch (e) {
    process.stderr.write(`error: catalog.json is not valid JSON (${e.message}); run node scripts/build-catalog.js\n`);
    return 1;
  }
  if (catalog.schema !== 1 || !Array.isArray(catalog.papers)) {
    process.stderr.write('error: catalog.json has an unexpected shape; run node scripts/build-catalog.js\n');
    return 1;
  }

  // Resolve --topic against the actual on-disk filename (not the raw CLI
  // string) so a case mismatch on a case-insensitive filesystem (e.g.
  // Windows) can't silently disagree with the later name-equality filter and
  // produce an empty scoped result instead of the exit-3 error.
  let scopedTopicName = null;
  if (args.topic != null) {
    const topicsDir = path.join(root, 'topics');
    const entries = fs.existsSync(topicsDir) ? fs.readdirSync(topicsDir) : [];
    const match = entries.find(
      (f) => f.toLowerCase() === `${args.topic}.md`.toLowerCase()
    );
    if (!match) {
      process.stderr.write(`error: --topic "${args.topic}" names no file in topics/\n`);
      return 3;
    }
    scopedTopicName = path.basename(match, '.md');
  }

  const topicFiles = listMdFiles(path.join(root, 'topics')); // sorted by filename
  const findings = [];
  const topicMaps = [];
  for (const file of topicFiles) {
    const tm = parseTopicFile(root, file, findings);
    if (tm) topicMaps.push(tm);
  }
  if (findings.length > 0) {
    for (const f of findings) {
      process.stderr.write(`error: ${f.file}: ${f.message}\n`);
    }
    return 1;
  }

  const fullScan = computeScan(catalog.papers, topicMaps);
  const scan = scopedTopicName != null ? scopeResult(fullScan, scopedTopicName) : fullScan;

  if (args.json) {
    const out = {
      schema: 1,
      generated: generatedTimestamp(),
      scope: scopedTopicName,
      topics: scan.topics,
      candidates: scan.candidates,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } else {
    process.stdout.write(formatHuman(scan, scopedTopicName) + '\n');
  }

  return 0;
}

if (require.main === module) {
  process.exitCode = run(ROOT, process.argv.slice(2));
}

module.exports = { run, computeScan, scopeResult };
