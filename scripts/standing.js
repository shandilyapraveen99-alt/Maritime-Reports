#!/usr/bin/env node
// Lists standing items whose title matches a keyword, so a run can target updates
// without loading items.json. Usage: node scripts/standing.js hormuz "red sea" "black sea" baltic
const path = require("path");
const { ROOT, readJson, positional } = require("./lib");
const words = positional().map(w => w.toLowerCase());
readJson(path.join(ROOT, "data", "items.json")).forEach(i => {
  if (!i.standing || (words.length && !words.some(w => i.title.toLowerCase().includes(w)))) return;
  const ups = [...i.detail.matchAll(/UPDATE \(([^)]+)\):/g)].map(m => m[1]);
  console.log(JSON.stringify({ title: i.title, cat: i.cat, dateISO: i.dateISO, last_update: ups[ups.length - 1] || null }));
});
