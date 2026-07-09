#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const buildCatalog = require('./build-catalog.js');
const { parseTopicFile } = require('./lib/topic-map.js');

const ROOT = path.resolve(__dirname, '..');
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\r?\n?([\s\S]*)$/;
const REQUIRED_FIELDS = ['citekey', 'title', 'authors', 'year', 'url', 'depth', 'topics', 'added', 'updated'];
const DEPTH_ORDER = ['metadata', 'abstract', 'sections', 'full'];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INDEX_LINE_RE = /^- \[([^\]]+)\]\(papers\/[^)]+\) — (.+) \| (\S+) \| (\S+)\s*$/;
const DOI_RE = /10\.\d{4,9}\/\S+/;
const ARXIV_ID_RE = /(\d{4}\.\d{4,5})/;
const ARXIV_DOI_RE = /10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i;

function toRelPath(root, absPath) {
  return path.relative(root, absPath).split(path.sep).join('/');
}

function readNormalized(absPath) {
  let raw = fs.readFileSync(absPath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return raw.replace(/\r\n/g, '\n');
}

function listMdFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => path.join(dir, f));
}

function findFieldLine(rawLines, fieldName) {
  const re = new RegExp(`^${fieldName}:\\s`);
  for (let i = 0; i < rawLines.length; i++) {
    if (re.test(rawLines[i])) return i + 1; // 1-indexed
  }
  return null;
}

function addFinding(findings, severity, id, file, line, message) {
  findings.push({ id, severity, file, line: line != null ? line : null, message });
}

// D13 dedup key: title lowercased, NFKC-normalized, punctuation/whitespace
// collapsed. null (not "") for an empty title, so two blank titles never
// count as a match.
function normalizeTitleKey(title) {
  if (!title) return null;
  const normalized = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return normalized === '' ? null : normalized;
}

// D13 dedup key: a DOI (case-folded), or for arXiv links, the paper id with
// any version suffix stripped -- arXiv ids are DOI-equivalent keys per spec.
// arXiv's own DOI form (10.48550/arXiv.<id>) is normalized to the same
// "arXiv id" kind/value as a plain arxiv.org URL so both representations of
// one paper key-match, not just two URLs of the same shape.
function extractDoiKey(url) {
  if (!url) return null;
  const arxivDoiMatch = ARXIV_DOI_RE.exec(url);
  if (arxivDoiMatch) return { kind: 'arXiv id', value: arxivDoiMatch[1] };
  const doiMatch = DOI_RE.exec(url);
  if (doiMatch) return { kind: 'DOI', value: doiMatch[0].toLowerCase() };
  if (/arxiv\.org/i.test(url)) {
    const arxivMatch = ARXIV_ID_RE.exec(url);
    if (arxivMatch) return { kind: 'arXiv id', value: arxivMatch[1] };
  }
  return null;
}

// js-yaml parses an unquoted "added: 2026-01-01" as a Date, not a string;
// String(date) is locale/timezone-dependent. Format back to YYYY-MM-DD via UTC
// parts (js-yaml parses bare dates as UTC midnight) so D09 stays deterministic.
function dateFieldToString(v) {
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return v != null ? String(v) : '';
}

// Parse one papers/*.md file for every per-note check (D01-D04, D08, D09).
// Returns a paper record (possibly partial) or null if frontmatter truly failed
// to parse (unrecoverable — D01 fires and no other per-note check runs on it).
function parsePaperForDoctor(root, absPath, findings) {
  const relPath = toRelPath(root, absPath);
  const raw = readNormalized(absPath);
  const rawLines = raw.split('\n');
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    addFinding(findings, 'error', 'D01', relPath, 1, 'no frontmatter block found (expected leading "---" fences)');
    return null;
  }
  const [, frontmatterRaw, body] = match;
  let fm;
  try {
    fm = yaml.load(frontmatterRaw);
  } catch (e) {
    addFinding(findings, 'error', 'D01', relPath, 1, `invalid YAML frontmatter (${e.message})`);
    return null;
  }
  if (fm === null || typeof fm !== 'object' || Array.isArray(fm)) {
    addFinding(findings, 'error', 'D01', relPath, 1, 'frontmatter did not parse to a mapping');
    return null;
  }

  const missing = REQUIRED_FIELDS.filter((f) => !(f in fm) || fm[f] == null);
  if (missing.length > 0) {
    addFinding(findings, 'error', 'D01', relPath, 1, `missing required field(s): ${missing.join(', ')}`);
  }
  if (fm.authors != null && !Array.isArray(fm.authors)) {
    addFinding(findings, 'error', 'D01', relPath, 1, `"authors" must be a list, got ${typeof fm.authors}`);
  }
  if (fm.topics != null && !Array.isArray(fm.topics)) {
    addFinding(findings, 'error', 'D01', relPath, 1, `"topics" must be a list, got ${typeof fm.topics}`);
  }
  if (fm.year != null && fm.year !== '' && Number.isNaN(Number(fm.year))) {
    addFinding(findings, 'error', 'D01', relPath, 1, `"year" is not a number: ${JSON.stringify(fm.year)}`);
  }

  const filenameCitekey = path.basename(absPath, '.md');
  const citekey = fm.citekey != null ? String(fm.citekey) : filenameCitekey;
  const topics = Array.isArray(fm.topics) ? fm.topics.map(String) : [];
  const year = fm.year != null && fm.year !== '' && !Number.isNaN(Number(fm.year)) ? Number(fm.year) : null;
  const depth = fm.depth != null ? String(fm.depth) : '';

  // D02: citekey matches filename.
  if (fm.citekey != null && String(fm.citekey) !== filenameCitekey) {
    const line = findFieldLine(rawLines, 'citekey') || 1;
    addFinding(
      findings,
      'error',
      'D02',
      relPath,
      line,
      `citekey "${fm.citekey}" does not match filename "${filenameCitekey}"`
    );
  }

  // D03: depth is a known rung.
  if (fm.depth != null && !DEPTH_ORDER.includes(depth)) {
    const line = findFieldLine(rawLines, 'depth') || 1;
    addFinding(findings, 'error', 'D03', relPath, line, `depth "${depth}" is not one of ${DEPTH_ORDER.join(', ')}`);
  }

  // D04: every topics: value matches a file in topics/.
  for (const t of topics) {
    if (!fs.existsSync(path.join(root, 'topics', `${t}.md`))) {
      const line = findFieldLine(rawLines, 'topics') || 1;
      addFinding(findings, 'error', 'D04', relPath, line, `topics: "${t}" has no matching topics/${t}.md`);
    }
  }

  // D08: depth >= sections but "Sections read" empty, or the converse.
  const sectionsReadMatch = /^## Sections read\s*\n([\s\S]*?)(?=\n## |\n?$)/m.exec(body);
  const sectionsReadContent = sectionsReadMatch ? sectionsReadMatch[1].trim() : '';
  const depthRank = DEPTH_ORDER.indexOf(depth);
  if (depthRank >= 0) {
    const atLeastSections = depthRank >= DEPTH_ORDER.indexOf('sections');
    if (atLeastSections && sectionsReadContent === '') {
      addFinding(findings, 'warn', 'D08', relPath, null, `depth "${depth}" but "Sections read" is empty`);
    } else if (!atLeastSections && sectionsReadContent !== '') {
      addFinding(
        findings,
        'warn',
        'D08',
        relPath,
        null,
        `depth "${depth}" (< sections) but "Sections read" is non-empty`
      );
    }
  }

  // D09: updated < added, or either missing/not ISO.
  const added = dateFieldToString(fm.added);
  const updated = dateFieldToString(fm.updated);
  const addedOk = ISO_DATE_RE.test(added);
  const updatedOk = ISO_DATE_RE.test(updated);
  if (!addedOk || !updatedOk) {
    addFinding(findings, 'warn', 'D09', relPath, null, `"added"/"updated" missing or not ISO (added="${added}", updated="${updated}")`);
  } else if (updated < added) {
    addFinding(findings, 'warn', 'D09', relPath, null, `"updated" (${updated}) is before "added" (${added})`);
  }

  return {
    citekey,
    filenameCitekey,
    title: fm.title != null ? String(fm.title) : '',
    year,
    depth,
    topics,
    added,
    updated,
    body,
    path: relPath,
    titleKey: normalizeTitleKey(fm.title != null ? String(fm.title) : ''),
    doiKey: extractDoiKey(fm.url != null ? String(fm.url) : ''),
  };
}

// parseTopicFile now lives in ./lib/topic-map.js (shared with propose-scan.js);
// imported above. Signature and return shape used by the D01/D06/D10/D12 call
// sites below are unchanged (parseTopicFile gained extra fields — one_liner,
// clusters, readingQueue — that this file simply does not read).

function parseIndexFile(root) {
  const indexPath = path.join(root, 'INDEX.md');
  if (!fs.existsSync(indexPath)) return null;
  const raw = readNormalized(indexPath);
  const lines = raw.split('\n');
  let currentHeading = null;
  // heading -> citekey -> [{title, year, depth}] (array to allow duplicate detection)
  const sections = new Map();
  for (const line of lines) {
    const headingMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      currentHeading = headingMatch[1].trim();
      if (!sections.has(currentHeading)) sections.set(currentHeading, new Map());
      continue;
    }
    const entryMatch = INDEX_LINE_RE.exec(line);
    if (entryMatch && currentHeading) {
      const [, citekey, title, year, depth] = entryMatch;
      const perTopic = sections.get(currentHeading);
      if (!perTopic.has(citekey)) perTopic.set(citekey, []);
      perTopic.get(citekey).push({ title, year, depth });
    }
  }
  return sections;
}

function runChecks(root) {
  const findings = [];

  const paperFiles = listMdFiles(path.join(root, 'papers'));
  const papers = [];
  for (const file of paperFiles) {
    const record = parsePaperForDoctor(root, file, findings);
    if (record) papers.push(record);
  }

  const topicFiles = listMdFiles(path.join(root, 'topics'));
  const topicMaps = [];
  for (const file of topicFiles) {
    const record = parseTopicFile(root, file, findings);
    if (record) topicMaps.push(record);
  }

  const paperByCitekey = new Map(papers.map((p) => [p.citekey, p]));

  // D13: two notes sharing a normalized DOI/arXiv id or a normalized title
  // (frontmatter only). Exact-key equality only -- no fuzzy matching; a
  // same-title-different-paper false positive is the accepted cost of warn
  // severity (see spec Design Notes). --fix never touches this: dedup
  // deletes a note, which stays a human call via the manual playbook.
  // All-pairs O(n^2) over papers -- fine at this repo's expected scale
  // (a personal reading list, not a bibliography of thousands).
  for (let i = 0; i < papers.length; i++) {
    for (let j = i + 1; j < papers.length; j++) {
      const a = papers[i];
      const b = papers[j];
      const reasons = [];
      if (a.titleKey != null && a.titleKey === b.titleKey) reasons.push('same title');
      if (
        a.doiKey != null &&
        b.doiKey != null &&
        a.doiKey.kind === b.doiKey.kind &&
        a.doiKey.value === b.doiKey.value
      ) {
        reasons.push(`same ${a.doiKey.kind} ${a.doiKey.value}`);
      }
      if (reasons.length > 0) {
        addFinding(findings, 'warn', 'D13', b.path, null, `duplicates ${a.path} (${reasons.join('; ')})`);
      }
    }
  }

  // D06: every [[citekey]] in topics/*.md resolves to a paper note.
  for (const tm of topicMaps) {
    for (const citekey of tm.allCitekeys) {
      if (!paperByCitekey.has(citekey)) {
        addFinding(findings, 'error', 'D06', tm.path, null, `[[${citekey}]] does not resolve to a paper note`);
      }
    }
  }

  // D10: bidirectional consistency between a paper's topics: frontmatter and
  // every topic map's Clusters/Reading-queue membership (see spec Design Notes).
  for (const paper of papers) {
    for (const tm of topicMaps) {
      const paperClaimsTopic = paper.topics.includes(tm.name);
      const mapListsPaper = tm.clusterOrQueueCitekeys.has(paper.citekey);
      if (paperClaimsTopic && !mapListsPaper) {
        addFinding(
          findings,
          'warn',
          'D10',
          `papers/${paper.filenameCitekey}.md`,
          null,
          `topics: "${tm.name}" but ${tm.path} does not list it in Clusters or Reading queue`
        );
      } else if (!paperClaimsTopic && mapListsPaper) {
        addFinding(
          findings,
          'warn',
          'D10',
          tm.path,
          null,
          `lists [[${paper.citekey}]] but ${paper.citekey} has topics: [] (missing "${tm.name}")`
        );
      }
    }
  }

  // D12: topic map updated older than the newest note updated in that topic
  // (membership = the map's own Clusters/Reading-queue links, not frontmatter).
  for (const tm of topicMaps) {
    if (!ISO_DATE_RE.test(tm.updated)) continue;
    let newest = null;
    for (const citekey of tm.clusterOrQueueCitekeys) {
      const paper = paperByCitekey.get(citekey);
      if (paper && ISO_DATE_RE.test(paper.updated)) {
        if (newest === null || paper.updated > newest) newest = paper.updated;
      }
    }
    if (newest !== null && tm.updated < newest) {
      addFinding(
        findings,
        'warn',
        'D12',
        tm.path,
        null,
        `topic map updated (${tm.updated}) is older than its newest note (${newest})`
      );
    }
  }

  // D05 / D11: INDEX.md vs frontmatter, split per Design Notes.
  const indexSections = parseIndexFile(root);
  if (indexSections) {
    for (const paper of papers) {
      // Every heading (across the whole file) under which this citekey appears.
      const actualHeadings = [];
      for (const [heading, perTopic] of indexSections) {
        if (perTopic.has(paper.citekey)) actualHeadings.push(heading);
      }

      if (actualHeadings.length === 0) {
        addFinding(findings, 'error', 'D05', 'INDEX.md', null, `${paper.citekey} does not appear in INDEX.md`);
      } else {
        for (const heading of actualHeadings) {
          const entries = indexSections.get(heading).get(paper.citekey);
          if (entries.length > 1) {
            addFinding(
              findings,
              'error',
              'D05',
              'INDEX.md',
              null,
              `${paper.citekey} appears ${entries.length} times under "${heading}"`
            );
          }
          const entry = entries[0];
          const expectedYear = paper.year != null ? String(paper.year) : '?';
          if (entry.title !== paper.title || entry.year !== expectedYear || entry.depth !== paper.depth) {
            addFinding(
              findings,
              'error',
              'D05',
              'INDEX.md',
              null,
              `${paper.citekey} under "${heading}" shows "${entry.title} | ${entry.year} | ${entry.depth}", expected "${paper.title} | ${expectedYear} | ${paper.depth}"`
            );
          }
        }

        // D11: the full set of headings actually used doesn't match what
        // frontmatter implies (not just the Unassigned/named boundary — a
        // paper shown only under a *different* named topic than its own
        // topics: list is just as much a drift as landing in Unassigned).
        const expectedHeadings = paper.topics.length > 0 ? paper.topics : ['Unassigned'];
        const expectedSet = new Set(expectedHeadings);
        const actualSet = new Set(actualHeadings);
        const missingHeadings = expectedHeadings.filter((h) => !actualSet.has(h));
        const extraHeadings = actualHeadings.filter((h) => !expectedSet.has(h));
        if (missingHeadings.length > 0 || extraHeadings.length > 0) {
          const parts = [];
          if (missingHeadings.length > 0) parts.push(`missing from "${missingHeadings.join('", "')}"`);
          if (extraHeadings.length > 0) parts.push(`unexpectedly under "${extraHeadings.join('", "')}"`);
          addFinding(
            findings,
            'warn',
            'D11',
            'INDEX.md',
            null,
            `${paper.citekey} has topics: [${paper.topics.join(', ')}] — ${parts.join(', ')}`
          );
        }
      }
    }
  }

  // D07: catalog.json in exact sync with frontmatter (catalog.json only —
  // deliberately not INDEX.md, so this can be tested in isolation from D05/D11;
  // see spec Design Notes).
  const catalogPath = path.join(root, 'catalog.json');
  const scanErrors = [];
  const freshPapers = buildCatalog.buildFullScan(root, scanErrors);
  // build-catalog's parser is stricter in a few places (duplicate citekeys
  // across files, in particular, which doctor has no dedicated check for) —
  // surface anything it rejected instead of letting it silently shrink
  // freshPapers into a generic, unexplained D07 mismatch below.
  for (const err of scanErrors) {
    const sepIndex = err.indexOf(': ');
    const errFile = sepIndex >= 0 ? err.slice(0, sepIndex) : err;
    const errMessage = sepIndex >= 0 ? err.slice(sepIndex + 2) : err;
    addFinding(findings, 'error', 'D07', errFile, null, `build-catalog scan error: ${errMessage}`);
  }
  let onDiskCatalog = null;
  if (fs.existsSync(catalogPath)) {
    try {
      onDiskCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    } catch (e) {
      onDiskCatalog = null;
    }
  }
  const inSync =
    onDiskCatalog &&
    onDiskCatalog.schema === 1 &&
    Array.isArray(onDiskCatalog.papers) &&
    JSON.stringify(onDiskCatalog.papers) === JSON.stringify(freshPapers);
  if (!inSync) {
    addFinding(
      findings,
      'error',
      'D07',
      'catalog.json',
      null,
      'catalog.json is out of sync with papers/*.md frontmatter; run node scripts/build-catalog.js'
    );
  }

  return findings;
}

function formatHuman(findings) {
  const lines = [];
  const sevOrder = { error: 0, warn: 1 };
  const sorted = [...findings].sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity] || a.id.localeCompare(b.id));
  for (const f of sorted) {
    const loc = f.line != null ? `${f.file}:${f.line}` : f.file;
    lines.push(`${f.severity.padEnd(5)} ${f.id} ${loc}  ${f.message}`);
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const args = { fix: false, json: false };
  for (const a of argv) {
    if (a === '--fix') args.fix = true;
    else if (a === '--json') args.json = true;
    else throw new Error(`unknown argument: ${a} (valid: --fix, --json)`);
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
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    return 2;
  }

  if (args.fix) {
    const fixExitCode = buildCatalog.run(root, []);
    if (fixExitCode === 2) {
      process.stderr.write('error: --fix aborted: build-catalog reported an unexpected I/O failure\n');
      return 2;
    }
  }

  const findings = runChecks(root);
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warn').length;

  if (args.json) {
    process.stdout.write(JSON.stringify({ findings, errors, warnings }, null, 2) + '\n');
  } else if (findings.length > 0) {
    process.stdout.write(formatHuman(findings) + '\n');
  } else {
    process.stdout.write('clean: 0 findings\n');
  }

  return errors > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = run(ROOT, process.argv.slice(2));
}

module.exports = { run, runChecks, parsePaperForDoctor, parseTopicFile, parseIndexFile };
