#!/usr/bin/env node
/**
 * Dataset and page-consistency checks for the ZTA Visual Mindmap.
 *
 * Asserts the invariants this repo relies on but cannot see:
 *   1. the dataset embedded in index.html is byte-identical to zta-glossary-data.json
 *   2. the terms array stays sorted by id, and every term has an explicit FAMILY entry
 *      (FAMILY lookups fall back to 'transport' silently, so a miss is a wrong colour,
 *       not an error)
 *   3. every edge endpoint resolves, with no self-edges, duplicates, or unknown types
 *   4. every term / family / edge count printed on the page and in the README matches
 *      the dataset
 *
 * Usage: node verify.mjs      (exit 0 = all checks pass, 1 = at least one failed)
 * Also runs automatically via the PostToolUse hook in .claude/settings.json.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* resolve against the repo, not the caller's cwd, so hooks can run this from anywhere */
const repo = (f) => join(import.meta.dirname, f);

const html = readFileSync(repo('index.html'), 'utf8');
const jsonText = readFileSync(repo('zta-glossary-data.json'), 'utf8');

const results = [];
const check = (label, fn) => {
  try {
    const detail = fn();
    results.push({ ok: true, label, detail });
  } catch (err) {
    results.push({ ok: false, label, detail: err.message });
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/* ---- 1. dual-file byte identity ------------------------------------- */

const OPEN = '<script id="zta-data" type="application/json">';
const openAt = html.indexOf(OPEN);
if (openAt === -1) {
  console.error('FATAL: no <script id="zta-data"> block in index.html');
  process.exit(1);
}
const bodyAt = openAt + OPEN.length;
const closeAt = html.indexOf('</script>', bodyAt);
const embedded = html.slice(bodyAt, closeAt);

check('dual-file byte identity', () => {
  const a = Buffer.from(embedded, 'utf8');
  const b = Buffer.from(jsonText, 'utf8');
  if (Buffer.compare(a, b) !== 0) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const line = embedded.slice(0, i).split('\n').length;
    throw new Error(
      `embedded block and zta-glossary-data.json diverge at byte ${i} (line ~${line}); ` +
      `${a.length} vs ${b.length} bytes`
    );
  }
  assert(!jsonText.endsWith('\n'), 'zta-glossary-data.json must have no trailing newline');
  return `${a.length} bytes identical, no trailing newline`;
});

const data = JSON.parse(jsonText);
const terms = data.terms;
const edges = data.edges;
const ids = new Set(terms.map((t) => t.id));

/* ---- 2. term ordering and FAMILY coverage --------------------------- */

check('terms sorted by id', () => {
  for (let i = 1; i < terms.length; i++) {
    assert(
      terms[i - 1].id < terms[i].id,
      `out of order at index ${i}: "${terms[i - 1].id}" then "${terms[i].id}"`
    );
  }
  assert(ids.size === terms.length, 'duplicate term ids present');
  return `${terms.length} terms, ascending by id, no duplicates`;
});

const grab = (re, what) => {
  const m = html.match(re);
  assert(m, `could not locate ${what} in index.html`);
  return m[1];
};

const familyKeys = new Set(
  [...grab(/const FAMILIES = \[([\s\S]*?)\n\s*\];/, 'FAMILIES')
    .matchAll(/key:\s*'([^']+)'/g)].map((m) => m[1])
);
const familyMap = new Map(
  [...grab(/const FAMILY = \{([\s\S]*?)\n\s*\};/, 'FAMILY')
    .matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]])
);

check('every term has an explicit FAMILY entry', () => {
  const missing = terms.filter((t) => !familyMap.has(t.id)).map((t) => t.id);
  assert(!missing.length, `would silently fall back to 'transport': ${missing.join(', ')}`);
  const orphans = [...familyMap.keys()].filter((k) => !ids.has(k));
  assert(!orphans.length, `FAMILY entries for non-existent terms: ${orphans.join(', ')}`);
  const bad = [...familyMap].filter(([, v]) => !familyKeys.has(v));
  assert(!bad.length, `unknown family values: ${bad.map(([k, v]) => `${k}->${v}`).join(', ')}`);
  return `${familyMap.size} ids mapped across ${familyKeys.size} declared families`;
});

/* ---- 3. edge integrity ---------------------------------------------- */

const edgeTypes = new Set(
  [...grab(/const ORDER = \[([^\]]*)\];/, 'ORDER')
    .matchAll(/'([^']+)'/g)].map((m) => m[1])
);

check('edge endpoints resolve, no self-edges or duplicates', () => {
  const seen = new Set();
  const dangling = [];
  const self = [];
  const dupes = [];
  const unknown = [];
  for (const e of edges) {
    if (!ids.has(e.source)) dangling.push(e.source);
    if (!ids.has(e.target)) dangling.push(e.target);
    if (e.source === e.target) self.push(e.source);
    if (!edgeTypes.has(e.type)) unknown.push(e.type);
    const key = `${e.source}|${e.target}|${e.type}`;
    if (seen.has(key)) dupes.push(key);
    seen.add(key);
  }
  const faults = [];
  if (dangling.length) faults.push(`endpoints with no term: ${[...new Set(dangling)].join(', ')}`);
  if (self.length) faults.push(`self-edges: ${self.join(', ')}`);
  if (dupes.length) faults.push(`duplicate edges: ${dupes.join(', ')}`);
  if (unknown.length) faults.push(`types outside ORDER: ${[...new Set(unknown)].join(', ')}`);
  assert(!faults.length, faults.join('\n      '));
  return `${edges.length} edges, ${edgeTypes.size} types, all endpoints resolve`;
});

/* ---- 4. counts printed on the page and in the README ---------------- */

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'eleven', 'twelve'];

const nTerms = String(terms.length);
const nEdges = String(edges.length);
const nFams = String(familyKeys.size);
const wFams = WORDS[familyKeys.size];
const wTypes = WORDS[edgeTypes.size];

const readme = readFileSync(repo('README.md'), 'utf8');
const files = { 'index.html': html, 'README.md': readme };

const sites = [
  ['index.html', 'meta description — terms', /mindmap of (\d+) zero-trust/g, nTerms],
  ['index.html', 'meta description — families', /into (\w+) functional families/g, wFams],
  ['index.html', 'search placeholder — terms', /placeholder="Search (\d+) terms/g, nTerms],
  ['index.html', 'footer — terms', /— (\d+) terms, \d+ typed relationships/g, nTerms],
  ['index.html', 'footer — edges', /— \d+ terms, (\d+) typed relationships/g, nEdges],
  ['index.html', 'About copy — terms', /<strong>(\d+) terms<\/strong> from the ZTA/g, nTerms],
  ['index.html', 'About copy — families', /<strong>(\w+) functional families<\/strong>/g, wFams],
  ['index.html', 'stat tile — terms', /<b>(\d+)<\/b><span>terms<\/span>/g, nTerms],
  ['index.html', 'stat tile — families', /<b>(\d+)<\/b><span>families<\/span>/g, nFams],
  ['index.html', 'stat tile — links', /<b>(\d+)<\/b><span>links<\/span>/g, nEdges],
  ['README.md', 'tagline — terms', /mindmap of (\d+) zero-trust/g, nTerms],
  ['README.md', 'hero alt text — terms', /Mindmap — (\d+) terms across/g, nTerms],
  ['README.md', 'hero alt text — families', /terms across (\w+) functional families/g, wFams],
  ['README.md', 'intro — terms', /Maps (\d+) IT, networking/g, nTerms],
  ['README.md', 'intro — families', /into (\w+) functional families/g, wFams],
  ['README.md', 'intro — edge types', /links them with (\w+) typed relationships/g, wTypes],
  ['README.md', 'dataset note — terms', /— (\d+) terms and \d+ typed edges/g, nTerms],
  ['README.md', 'dataset note — edges', /— \d+ terms and (\d+) typed edges/g, nEdges],
];

check('printed counts match the dataset', () => {
  const stale = [];
  for (const [file, label, re, expect] of sites) {
    const found = [...files[file].matchAll(re)].map((m) => m[1]);
    if (!found.length) { stale.push(`${file}: ${label} — pattern no longer matches`); continue; }
    for (const got of found) {
      if (got !== expect) stale.push(`${file}: ${label} — says "${got}", dataset says "${expect}"`);
    }
  }
  assert(!stale.length, stale.join('\n      '));
  return `${sites.length} sites agree: ${nTerms} terms, ${nFams} families, ${nEdges} edges`;
});

/* ---- report ---------------------------------------------------------- */

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}\n      ${r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
