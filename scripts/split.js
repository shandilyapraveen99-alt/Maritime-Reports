#!/usr/bin/env node
// Regenerates items_recent.json (last 84 days by dateISO) and items_archive.json
// from items.json, which stays the source of truth.
// Usage: node scripts/split.js [--as-of YYYY-MM-DD] [--check]
const path = require("path");
const { ROOT, readJson, writeItems, arg, shiftISO } = require("./lib");

function split(items, asOf) {
  const cutoff = shiftISO(asOf, -84);
  return { cutoff, recent: items.filter(i => i.dateISO >= cutoff), archive: items.filter(i => i.dateISO < cutoff) };
}
function latestISO(items) { return items.reduce((m, i) => (i.dateISO > m ? i.dateISO : m), ""); }

if (require.main === module) {
  const dir = path.join(ROOT, "data");
  const items = readJson(path.join(dir, "items.json"));
  const asOf = arg("as-of", latestISO(items));
  if (process.argv.includes("--check")) {
    const recent = readJson(path.join(dir, "items_recent.json")), archive = readJson(path.join(dir, "items_archive.json"));
    const key = a => a.map(i => JSON.stringify(i)).sort().join("\n");
    const ok = recent.length + archive.length === items.length && key(recent.concat(archive)) === key(items);
    console.log("recent " + recent.length + " + archive " + archive.length + " vs items " + items.length + ": " + (ok ? "EQUAL" : "MISMATCH"));
    process.exit(ok ? 0 : 1);
  }
  const s = split(items, asOf);
  writeItems(path.join(dir, "items_recent.json"), s.recent);
  writeItems(path.join(dir, "items_archive.json"), s.archive);
  console.log("as-of " + asOf + ", cutoff " + s.cutoff + ": recent " + s.recent.length + ", archive " + s.archive.length);
}
module.exports = { split, latestISO };
