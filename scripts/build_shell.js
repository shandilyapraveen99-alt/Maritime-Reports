#!/usr/bin/env node
// Emits a publish-ready page: starts at <title>, no doctype/html/head/body, trailing refreshed comment.
// Usage: node scripts/build_shell.js --data-url /_blob/<asset-id> [--date YYYY-MM-DD] [--in site/index.html] [--out dist/index.html]
const fs = require("fs");
const path = require("path");
const { ROOT, arg, todayISO, longDate, validISO } = require("./lib");

const dataUrl = arg("data-url"), iso = arg("date", todayISO());
if (!dataUrl) { console.error("--data-url is required"); process.exit(1); }
if (!validISO(iso)) { console.error("bad --date"); process.exit(1); }
const inPath = arg("in", path.join(ROOT, "site", "index.html")), outPath = arg("out", path.join(ROOT, "dist", "index.html"));
let html = fs.readFileSync(inPath, "utf8");

function setVar(name, value) {
  const re = new RegExp("^var " + name + " = \"[^\"]*\";$", "gm");
  if ((html.match(re) || []).length !== 1) { console.error("expected exactly one " + name); process.exit(1); }
  html = html.replace(re, () => "var " + name + " = " + JSON.stringify(value) + ";");
}
setVar("DATA_URL", dataUrl);
setVar("GENERATED_ON", longDate(iso));
setVar("GENERATED_ISO", iso);

html = html.slice(html.indexOf("<title>")).replace(/\s*<!-- refreshed [^>]*-->/g, "").trimEnd();
html += "\n<!-- refreshed " + iso + " -->\n";
if (/<!doctype|<\/?(html|head|body)[\s>]/i.test(html)) { console.error("page contains a document-level tag"); process.exit(1); }
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log("wrote " + path.relative(ROOT, outPath) + " (" + html.length + " chars), DATA_URL " + dataUrl + ", generated " + iso);
