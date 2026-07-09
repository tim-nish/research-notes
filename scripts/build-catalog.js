#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\r?\n?([\s\S]*)$/;
const HEADER =
  '# Index\n\n' +
  'One line per paper, grouped by topic, sorted by year desc:\n' +
  '`- [citekey](papers/<citekey>.md) — title | year | depth`\n';

function paperPath(root) {
  return path.join(root, 'papers');
}

function listPaperFiles(root) {
  const dir = paperPath(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => path.join(dir, f));
}

function toRelPath(root, absPath) {
  return path.relative(root, absPath).split(path.sep).join('/');
}

// js-yaml parses an unquoted "added: 2026-01-01" as a Date, not a string;
// String(date) is locale/timezone-dependent. Format back to YYYY-MM-DD via UTC
// parts (js-yaml parses bare dates as UTC midnight) so catalog.json stays
// deterministic regardless of the machine's TZ.
function dateFieldToString(v) {
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return v != null ? String(v) : '';
}

// First non-empty line under "## Contribution"; "" if the heading is missing,
// the section is empty, or another heading immediately follows.
function extractContribution(body) {
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() !== '## Contribution') i++;
  if (i === lines.length) return '';
  i++;
  while (i < lines.length) {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line)) return '';
    const trimmed = line.trim();
    if (trimmed !== '') return trimmed;
    i++;
  }
  return '';
}

function parsePaperFile(root, absPath) {
  let raw = fs.readFileSync(absPath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // strip BOM
  raw = raw.replace(/\r\n/g, '\n'); // normalize CRLF so the fence regex matches
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    throw new Error('no frontmatter block found (expected leading "---" fences)');
  }
  const [, frontmatterRaw, body] = match;
  let fm;
  try {
    fm = yaml.load(frontmatterRaw);
  } catch (e) {
    throw new Error(`invalid YAML frontmatter (${e.message})`);
  }
  if (fm === null || typeof fm !== 'object' || Array.isArray(fm)) {
    throw new Error('frontmatter did not parse to a mapping');
  }
  if (fm.authors != null && !Array.isArray(fm.authors)) {
    throw new Error(`"authors" must be a list, got ${typeof fm.authors}`);
  }
  if (fm.topics != null && !Array.isArray(fm.topics)) {
    throw new Error(`"topics" must be a list, got ${typeof fm.topics}`);
  }
  let year = null;
  if (fm.year != null && fm.year !== '') {
    year = Number(fm.year);
    if (Number.isNaN(year)) {
      throw new Error(`"year" is not a number: ${JSON.stringify(fm.year)}`);
    }
  }

  const relPath = toRelPath(root, absPath);
  const filenameCitekey = path.basename(absPath, '.md');
  const citekey = fm.citekey != null ? String(fm.citekey) : filenameCitekey;

  return {
    citekey,
    title: fm.title != null ? String(fm.title) : '',
    authors: Array.isArray(fm.authors) ? fm.authors.map(String) : [],
    year,
    venue: fm.venue != null ? String(fm.venue) : '',
    url: fm.url != null ? String(fm.url) : '',
    zotero: fm.zotero != null ? String(fm.zotero) : '',
    depth: fm.depth != null ? String(fm.depth) : '',
    topics: Array.isArray(fm.topics) ? fm.topics.map(String) : [],
    added: dateFieldToString(fm.added),
    updated: dateFieldToString(fm.updated),
    contribution: extractContribution(body),
    path: relPath,
  };
}

function sortByCitekey(papers) {
  return [...papers].sort((a, b) => (a.citekey < b.citekey ? -1 : a.citekey > b.citekey ? 1 : 0));
}

function buildFullScan(root, errors) {
  const files = listPaperFiles(root);
  const byCitekey = new Map();
  for (const file of files) {
    try {
      const record = parsePaperFile(root, file);
      const existing = byCitekey.get(record.citekey);
      if (existing) {
        errors.push(
          `${toRelPath(root, file)}: duplicate citekey "${record.citekey}" also used by ${existing.path}`
        );
        continue; // first-seen (alphabetical by filename) wins
      }
      byCitekey.set(record.citekey, record);
    } catch (e) {
      errors.push(`${toRelPath(root, file)}: ${e.message}`);
    }
  }
  return sortByCitekey([...byCitekey.values()]);
}

// Merge --changed paths into a baseline catalog's records. Falls back to a
// full scan (via the caller) when no baseline catalog.json exists yet.
function applyChanged(root, baselinePapers, changedRelPaths, errors) {
  const byCitekey = new Map(baselinePapers.map((p) => [p.citekey, p]));

  for (const relPath of changedRelPaths) {
    const absPath = path.resolve(root, relPath);
    const normRel = toRelPath(root, absPath);

    // Drop any existing record that pointed at this path (citekey may have changed).
    for (const [ck, rec] of byCitekey) {
      if (rec.path === normRel) byCitekey.delete(ck);
    }

    if (!fs.existsSync(absPath)) continue; // file removed: stays dropped

    try {
      const record = parsePaperFile(root, absPath);
      const existing = byCitekey.get(record.citekey);
      if (existing && existing.path !== normRel) {
        errors.push(
          `${normRel}: duplicate citekey "${record.citekey}" also used by ${existing.path}`
        );
        continue;
      }
      byCitekey.set(record.citekey, record);
    } catch (e) {
      errors.push(`${normRel}: ${e.message}`);
    }
  }

  return sortByCitekey([...byCitekey.values()]);
}

function catalogPapersEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function serializeCatalog(papers, generated) {
  const catalog = { schema: 1, generated, papers };
  return JSON.stringify(catalog, null, 2) + '\n';
}

function loadExistingCatalog(catalogPath) {
  if (!fs.existsSync(catalogPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function groupByTopic(papers) {
  const groups = new Map();
  for (const paper of papers) {
    const topics = paper.topics.length > 0 ? paper.topics : ['Unassigned'];
    for (const topic of topics) {
      if (!groups.has(topic)) groups.set(topic, []);
      groups.get(topic).push(paper);
    }
  }
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const ay = a.year == null ? -Infinity : a.year;
      const by = b.year == null ? -Infinity : b.year;
      if (by !== ay) return by - ay;
      return a.citekey < b.citekey ? -1 : a.citekey > b.citekey ? 1 : 0;
    });
  }
  return groups;
}

function sortedTopicNames(groups) {
  const names = [...groups.keys()].filter((n) => n !== 'Unassigned').sort();
  if (groups.has('Unassigned')) names.push('Unassigned');
  return names;
}

function formatLine(paper) {
  const year = paper.year != null ? paper.year : '?';
  return `- [${paper.citekey}](papers/${paper.citekey}.md) — ${paper.title} | ${year} | ${paper.depth}`;
}

function renderIndex(papers) {
  const groups = groupByTopic(papers);
  const names = sortedTopicNames(groups);
  let out = HEADER;
  for (const name of names) {
    out += `\n## ${name}\n\n`;
    out += groups.get(name).map(formatLine).join('\n') + '\n';
  }
  return out;
}

function topicSlug(name) {
  return name === 'Unassigned' ? 'unassigned' : name;
}

function renderTopicIndexFile(name, papers) {
  return `# ${name}\n\n` + papers.map(formatLine).join('\n') + '\n';
}

function renderIndexToc(groups, names) {
  let out =
    '# Index\n\n' +
    'Table of contents: one file per topic under `indexes/`.\n' +
    '`- [<topic>](indexes/<topic-slug>.md)`\n\n';
  out += names.map((name) => `- [${name}](indexes/${topicSlug(name)}.md)`).join('\n') + '\n';
  return out;
}

function writeIfChanged(filePath, content) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) {
    return false;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

function parseArgs(argv) {
  const args = { changed: [], check: false, splitTopics: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') {
      args.check = true;
    } else if (a === '--split-topics') {
      args.splitTopics = true;
    } else if (a === '--changed') {
      i++;
      while (i < argv.length && !argv[i].startsWith('--')) {
        args.changed.push(argv[i]);
        i++;
      }
      i--;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
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
  const catalogPath = path.join(root, 'catalog.json');
  const indexPath = path.join(root, 'INDEX.md');
  const indexesDir = path.join(root, 'indexes');

  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    return 2;
  }

  const errors = [];
  const existingCatalog = loadExistingCatalog(catalogPath);

  let papers;
  if (
    args.changed.length > 0 &&
    existingCatalog &&
    existingCatalog.schema === 1 &&
    Array.isArray(existingCatalog.papers)
  ) {
    papers = applyChanged(root, existingCatalog.papers, args.changed, errors);
  } else {
    papers = buildFullScan(root, errors);
  }

  const newIndex = renderIndex(papers);
  const groups = groupByTopic(papers);
  const topicNames = sortedTopicNames(groups);

  const catalogUnchanged =
    existingCatalog &&
    existingCatalog.schema === 1 &&
    Array.isArray(existingCatalog.papers) &&
    catalogPapersEqual(existingCatalog.papers, papers);

  const generated = catalogUnchanged ? existingCatalog.generated : new Date().toISOString();
  const newCatalogText = serializeCatalog(papers, generated);

  if (args.check) {
    // catalog.json compares ignoring `generated`: mismatch only if the papers
    // array differs from what's on disk, or the file is missing entirely.
    let mismatch = !fs.existsSync(catalogPath) || !catalogUnchanged;

    const onDiskIndexText = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : null;
    const expectedIndexText = args.splitTopics ? renderIndexToc(groups, topicNames) : newIndex;
    if (onDiskIndexText !== expectedIndexText) mismatch = true;

    if (args.splitTopics) {
      for (const name of topicNames) {
        const p = path.join(indexesDir, `${topicSlug(name)}.md`);
        const expected = renderTopicIndexFile(name, groups.get(name));
        const onDisk = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
        if (onDisk !== expected) mismatch = true;
      }
    }

    if (errors.length > 0) {
      for (const err of errors) process.stderr.write(`error ${err}\n`);
    }
    if (mismatch || errors.length > 0) return 1;
    return 0;
  }

  // Normal (writing) run.
  if (!catalogUnchanged) {
    writeIfChanged(catalogPath, newCatalogText);
  }
  writeIfChanged(indexPath, args.splitTopics ? renderIndexToc(groups, topicNames) : newIndex);

  if (args.splitTopics) {
    for (const name of topicNames) {
      const p = path.join(indexesDir, `${topicSlug(name)}.md`);
      writeIfChanged(p, renderTopicIndexFile(name, groups.get(name)));
    }
  }

  for (const err of errors) {
    process.stderr.write(`error ${err}\n`);
  }

  return errors.length > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = run(ROOT, process.argv.slice(2));
}

module.exports = {
  run,
  extractContribution,
  parsePaperFile,
  renderIndex,
  groupByTopic,
  buildFullScan,
};
