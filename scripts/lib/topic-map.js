'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\r?\n?([\s\S]*)$/;

function toRelPath(root, absPath) {
  return path.relative(root, absPath).split(path.sep).join('/');
}

function readNormalized(absPath) {
  let raw = fs.readFileSync(absPath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return raw.replace(/\r\n/g, '\n');
}

// js-yaml parses an unquoted "updated: 2026-01-01" as a Date, not a string;
// String(date) is locale/timezone-dependent. Format back to YYYY-MM-DD via UTC
// parts (js-yaml parses bare dates as UTC midnight) so downstream date
// comparisons stay deterministic.
function dateFieldToString(v) {
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return v != null ? String(v) : '';
}

function addFinding(findings, severity, id, file, line, message) {
  findings.push({ id, severity, file, line: line != null ? line : null, message });
}

// Parse a topics/*.md file: frontmatter (topic, one_liner, updated) plus every
// [[citekey]] link, tagged with whether it appears under "## Clusters" or
// "## Reading queue". Within "## Clusters", links are additionally grouped by
// the nearest preceding "### " sub-heading (the cluster's name); a cluster
// whose label cannot be determined (links appear before any "### " heading)
// gets name: null. Returns null (and pushes a finding) if the file is
// unparseable — callers must treat that as "report, don't repair" per the
// shared safety rules.
function parseTopicFile(root, absPath, findings) {
  const relPath = toRelPath(root, absPath);
  const raw = readNormalized(absPath);
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    addFinding(findings, 'error', 'D01', relPath, 1, 'topic map has no frontmatter block');
    return null;
  }
  const [, frontmatterRaw, body] = match;
  let fm;
  try {
    fm = yaml.load(frontmatterRaw) || {};
  } catch (e) {
    addFinding(findings, 'error', 'D01', relPath, 1, `invalid YAML frontmatter (${e.message})`);
    return null;
  }

  const lines = body.split('\n');
  let currentHeading = null; // current "## " heading
  const allCitekeys = new Set();
  const clusterOrQueueCitekeys = new Set();
  const clusters = []; // [{ name: string|null, citekeys: [citekey,...] }], file order
  const readingQueue = []; // citekeys, file order
  let clusterBucket = null; // the cluster the next Clusters-section link belongs to
  const linkRe = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g; // tolerate Obsidian alias syntax [[citekey|Alias]]

  for (const line of lines) {
    const h2Match = /^##\s+(.+?)\s*$/.exec(line);
    if (h2Match) {
      currentHeading = h2Match[1].trim();
      clusterBucket = null;
      continue;
    }
    if (currentHeading === 'Clusters') {
      const h3Match = /^###\s+(.+?)\s*$/.exec(line);
      if (h3Match) {
        clusterBucket = { name: h3Match[1].trim(), citekeys: [] };
        clusters.push(clusterBucket);
        continue;
      }
    }
    let m;
    while ((m = linkRe.exec(line))) {
      const citekey = m[1];
      allCitekeys.add(citekey);
      if (currentHeading === 'Clusters' || currentHeading === 'Reading queue') {
        clusterOrQueueCitekeys.add(citekey);
      }
      if (currentHeading === 'Clusters') {
        if (clusterBucket === null) {
          clusterBucket = { name: null, citekeys: [] };
          clusters.push(clusterBucket);
        }
        // A citekey accidentally linked twice in the same cluster shouldn't
        // inflate its member count.
        if (!clusterBucket.citekeys.includes(citekey)) {
          clusterBucket.citekeys.push(citekey);
        }
      } else if (currentHeading === 'Reading queue') {
        if (!readingQueue.includes(citekey)) readingQueue.push(citekey);
      }
    }
  }

  return {
    name: path.basename(absPath, '.md'),
    path: relPath,
    topic: fm.topic != null ? String(fm.topic) : '',
    one_liner: fm.one_liner != null ? String(fm.one_liner) : '',
    updated: dateFieldToString(fm.updated),
    allCitekeys,
    clusterOrQueueCitekeys,
    clusters,
    readingQueue,
  };
}

module.exports = {
  parseTopicFile,
  FRONTMATTER_RE,
  readNormalized,
  toRelPath,
  dateFieldToString,
  addFinding,
};
