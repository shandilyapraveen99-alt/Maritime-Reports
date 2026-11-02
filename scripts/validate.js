#!/usr/bin/env node
// Schema, range, source and duplicate checks. Exit 1 on any error; near-duplicates
// are warnings for review. Prints indexes and codes; --verbose adds titles.
// Usage: node scripts/validate.js data/items.json [--as-of YYYY-MM-DD] [--against old_items.json] [--verbose]
const { readJson, arg, positional, todayISO, keyNouns, jaccard, daysApart, normTitle, loadExceptions, itemErrors } = require("./lib");

function nearDuplicates(items) {
  const keys = items.map(i => keyNouns(i.title)), out = [];
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      if (items[a].cat === items[b].cat && daysApart(items[a].dateISO, items[b].dateISO) <= 14 && jaccard(keys[a], keys[b]) >= 0.7) out.push([a, b]);
    }
  }
  return out;
}
// Historical items may only change by appending "UPDATE (dates):" text to a standing item's detail.
function historyErrors(oldItems, items) {
  const byTitle = new Map(items.map(i => [i.title, i])), errs = [];
  oldItems.forEach((o, n) => {
    const cur = byTitle.get(o.title);
    if (!cur) { errs.push(n + ": deleted"); return; }
    if (JSON.stringify(cur) === JSON.stringify(o)) return;
    const added = cur.detail.startsWith(o.detail) ? cur.detail.slice(o.detail.length) : null;
    const rest = JSON.stringify(Object.assign({}, cur, { detail: o.detail })) === JSON.stringify(o);
    if (!o.standing || !rest || added === null || !/^ UPDATE \([^)]+\): /.test(added)) errs.push(n + ": altered");
  });
  return errs;
}
function validate(items, opts) {
  const errors = [], seen = new Map();
  items.forEach((it, n) => {
    itemErrors(it, opts).forEach(c => errors.push({ n, code: c }));
    const t = normTitle(it && it.title);
    if (seen.has(t)) errors.push({ n, code: "duplicate_title_of:" + seen.get(t) });
    else seen.set(t, n);
  });
  return errors;
}

if (require.main === module) {
  const file = positional()[0] || "data/items.json", verbose = process.argv.includes("--verbose");
  const items = readJson(file);
  if (!Array.isArray(items)) { console.error("not an array"); process.exit(1); }
  const errors = validate(items, { asOf: arg("as-of", todayISO()), exceptions: loadExceptions() });
  const cleanForDup = !errors.some(e => e.code === "bad_dateISO" || e.code === "empty_title");
  const near = cleanForDup ? nearDuplicates(items) : [];
  const esc = { high: 0, medium: 0, low: 0 };
  items.forEach(i => { if (i.bearing && i.bearing.escalation in esc) esc[i.bearing.escalation]++; });
  console.log(items.length + " items (" + esc.high + " high / " + esc.medium + " medium / " + esc.low + " low)");
  errors.slice(0, 50).forEach(e => console.log("ERROR item " + e.n + ": " + e.code + (verbose && items[e.n] ? " | " + items[e.n].title : "")));
  if (errors.length > 50) console.log("... " + (errors.length - 50) + " more errors");
  near.slice(0, 50).forEach(p => console.log("WARN near-duplicate: items " + p[0] + " and " + p[1] + (verbose ? " | " + items[p[0]].title + " | " + items[p[1]].title : "")));
  let hist = [];
  const against = arg("against");
  if (against) {
    hist = historyErrors(readJson(against), items);
    hist.slice(0, 50).forEach(h => console.log("ERROR history item " + h));
    console.log("history check against " + against + ": " + (hist.length ? hist.length + " violations" : "OK"));
  }
  console.log(errors.length + " errors, " + near.length + " near-duplicate warnings");
  process.exit(errors.length || hist.length ? 1 : 0);
}
module.exports = { validate, nearDuplicates, historyErrors };
