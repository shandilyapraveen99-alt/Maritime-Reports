#!/usr/bin/env node
// Merges agent JSON files into data/items.json: validates each entry, skips duplicates,
// updates standing items in place, then regenerates the recent/archive split.
// Input: an array of items, or { items: [...], standing_updates: [{ match_title, dates, text, source: {label,url} }] }.
// Usage: node scripts/merge.js [--dry-run] [--as-of YYYY-MM-DD] incoming/a.json incoming/b.json
// Stdout has counts only; per-entry decisions go to build/merge_report.json.
const fs = require("fs");
const path = require("path");
const { ROOT, readJson, writeItems, arg, positional, todayISO, keyNouns, jaccard, distanceKm, daysApart, normTitle, loadExceptions, itemErrors } = require("./lib");
const { validate, historyErrors } = require("./validate");
const { split } = require("./split");

function updateText(dates, text, source) {
  return " UPDATE (" + dates + "): " + text.trim() + " Source: " + source.label + " " + source.url + ".";
}
function findMatch(it, items, keys) {
  const k = keyNouns(it.title);
  let standing = null, dup = null;
  items.forEach((cur, n) => {
    const score = jaccard(k, keys[n]), near = cur.cat === it.cat || distanceKm(cur.coords, it.coords) < 300;
    if (!near) return;
    if (cur.standing && score >= 0.5 && (!standing || score > standing.score)) standing = { n, score };
    if (!cur.standing && score >= 0.6 && daysApart(cur.dateISO, it.dateISO) <= 14 && (!dup || score > dup.score)) dup = { n, score };
  });
  return standing || dup;
}

const files = positional(), dry = process.argv.includes("--dry-run"), asOf = arg("as-of", todayISO());
const itemsPath = arg("items", path.join(ROOT, "data", "items.json"));
const before = readJson(itemsPath), items = JSON.parse(JSON.stringify(before));
const exceptions = loadExceptions(), titles = new Set(items.map(i => normTitle(i.title)));
const keys = items.map(i => keyNouns(i.title));
const report = { added: [], updated: [], duplicates: [], rejected: [] };

function applyUpdate(n, dates, text, source, via) {
  const add = updateText(dates, text, source);
  if (items[n].detail.includes(add.trim())) { report.duplicates.push({ title: items[n].title, reason: "update_already_applied" }); return; }
  items[n].detail += add;
  report.updated.push({ title: items[n].title, dates, via });
}

for (const file of files) {
  const raw = readJson(file), incoming = Array.isArray(raw) ? raw : raw.items || [];
  for (const u of (Array.isArray(raw) ? [] : raw.standing_updates || [])) {
    const n = items.findIndex(i => i.title === u.match_title);
    let bad = null;
    if (n < 0) bad = "no_exact_title_match";
    else if (!items[n].standing) bad = "target_not_standing";
    else if (!u.dates || !u.text || !u.source || !u.source.label || !/^https:\/\//.test(u.source.url || "")) bad = "incomplete_or_non_https";
    if (bad) report.rejected.push({ file, title: u.match_title, reason: bad });
    else applyUpdate(n, u.dates, u.text, u.source, "standing_updates");
  }
  for (const it of incoming) {
    const errs = itemErrors(it, { asOf, exceptions });
    if (errs.length) { report.rejected.push({ file, title: it && it.title, reason: errs.join(",") }); continue; }
    if (titles.has(normTitle(it.title))) { report.duplicates.push({ title: it.title, reason: "same_title" }); continue; }
    const m = findMatch(it, items, keys);
    if (m && items[m.n].standing) {
      const src = it.sources.find(s => s.url.startsWith("https://"));
      applyUpdate(m.n, it.date, it.brief, src, "matched_key_nouns");
    } else if (m) {
      report.duplicates.push({ title: it.title, reason: "key_nouns", existing: items[m.n].title, score: +m.score.toFixed(2) });
    } else {
      items.push(it);
      titles.add(normTitle(it.title));
      keys.push(keyNouns(it.title));
      report.added.push({ title: it.title, cat: it.cat, escalation: it.bearing.escalation });
    }
  }
}

const finalErrs = validate(items, { asOf, exceptions }), hist = historyErrors(before, items);
fs.mkdirSync(path.join(ROOT, "build"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "build", "merge_report.json"), JSON.stringify(report, null, 1));
console.log("files " + files.length + ": added " + report.added.length + ", standing updates " + report.updated.length + ", duplicates " + report.duplicates.length + ", rejected " + report.rejected.length + "; total " + items.length);
if (finalErrs.length || hist.length) {
  console.error("ABORT, nothing written: " + finalErrs.length + " validation errors, " + hist.length + " history violations");
  process.exit(1);
}
if (dry) { console.log("dry run, nothing written"); process.exit(0); }
writeItems(itemsPath, items);
if (itemsPath === path.join(ROOT, "data", "items.json")) {
  const s = split(items, asOf);
  writeItems(path.join(ROOT, "data", "items_recent.json"), s.recent);
  writeItems(path.join(ROOT, "data", "items_archive.json"), s.archive);
  console.log("split as-of " + asOf + ": recent " + s.recent.length + ", archive " + s.archive.length);
}
