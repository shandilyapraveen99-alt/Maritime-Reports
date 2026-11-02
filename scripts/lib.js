// Shared helpers for the Maritime Reports scripts. Scripts print counts and
// indexes only, so item text stays out of agent context.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CATS = ["piracy", "warrisk", "greyzone", "navaldiplo", "ports", "regulatory", "weather",
  "fisheries", "undersea", "incidents", "chokepoints", "crime", "sanctions"];
const BEARING_KEYS = ["flag", "seaLane", "enforcement", "response", "insurance", "trade",
  "diplomatic", "regulatory", "escalation"];
const ITEM_KEYS = ["cat", "type", "coords", "radius", "title", "date", "dateISO", "standing",
  "brief", "detail", "sources", "bearing"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];
const STOP = new Set(("the a an and or of in on at to for from by with into over after amid near off as is are was were " +
  "be been new says said say report reports reported its their his her this that than but not has have had will " +
  "against about under between during more per via out up down").split(" "));
const DAY = 86400000;

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
// One item per line, so weekly git diffs stay small and reviewable.
function writeItems(p, items) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, items.length ? "[\n" + items.map(i => JSON.stringify(i)).join(",\n") + "\n]\n" : "[]\n");
}
function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i > -1 ? process.argv[i + 1] : fallback;
}
function positional() {
  const a = process.argv.slice(2), out = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith("--")) { if (!VALUELESS.has(a[i])) i++; } else out.push(a[i]);
  }
  return out;
}
const VALUELESS = new Set(["--dry-run", "--verbose", "--check"]);
function todayISO() { return new Date().toISOString().slice(0, 10); }
function isoToMs(iso) { return Date.parse(iso + "T00:00:00Z"); }
function shiftISO(iso, days) { return new Date(isoToMs(iso) + days * DAY).toISOString().slice(0, 10); }
function longDate(iso) {
  const d = new Date(isoToMs(iso));
  return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear();
}
function validISO(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(isoToMs(s)) && new Date(isoToMs(s)).toISOString().slice(0, 10) === s;
}
function keyNouns(title) {
  const words = String(title).toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/);
  return new Set(words.filter(w => w.length > 2 && !STOP.has(w)).map(w => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)));
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
}
function distanceKm(a, b) {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
function daysApart(a, b) { return Math.abs(isoToMs(a) - isoToMs(b)) / DAY; }
function normTitle(t) { return String(t).toLowerCase().replace(/\s+/g, " ").trim(); }
function loadExceptions() {
  const p = path.join(ROOT, "data", "known_exceptions.json");
  return fs.existsSync(p) ? readJson(p) : {};
}

// Returns error codes for one item; empty when valid.
function itemErrors(it, opts) {
  const e = [], as = opts && opts.asOf, known = (opts && opts.exceptions) || {};
  const exc = known.non_https_sources || [], legacyDates = known.legacy_date_titles || [];
  if (!it || typeof it !== "object" || Array.isArray(it)) return ["not_object"];
  for (const k of Object.keys(it)) if (!ITEM_KEYS.includes(k)) e.push("unknown_key:" + k);
  if (!CATS.includes(it.cat)) e.push("bad_cat");
  if (it.type !== "point" && it.type !== "zone") e.push("bad_type");
  const c = it.coords;
  if (!Array.isArray(c) || c.length !== 2 || !c.every(n => typeof n === "number" && isFinite(n))) e.push("bad_coords");
  else if (Math.abs(c[0]) > 90 || Math.abs(c[1]) > 180) e.push("coords_out_of_range");
  if (it.type === "zone" && !(typeof it.radius === "number" && it.radius > 0)) e.push("zone_needs_radius");
  if (it.type === "point" && it.radius !== undefined) e.push("point_has_radius");
  for (const k of ["title", "brief", "detail"]) if (typeof it[k] !== "string" || !it[k].trim()) e.push("empty_" + k);
  if (!validISO(it.dateISO)) e.push("bad_dateISO");
  else {
    if (it.date !== longDate(it.dateISO) && !(legacyDates.includes(it.title) && Date.parse(it.date + " UTC") === isoToMs(it.dateISO))) e.push("date_mismatch");
    if (as && it.dateISO > as) e.push("future_date");
  }
  if (typeof it.standing !== "boolean") e.push("standing_not_bool");
  if (!Array.isArray(it.sources) || !it.sources.length) e.push("no_sources");
  else {
    let https = 0;
    for (const s of it.sources) {
      if (!s || typeof s.label !== "string" || !s.label.trim() || typeof s.url !== "string") { e.push("bad_source"); continue; }
      let u = null;
      try { u = new URL(s.url); } catch (_) { /* reported below */ }
      if (u && u.protocol === "https:") https++;
      else if (!exc.some(x => x.title === it.title && x.url === s.url)) e.push("non_https_source");
    }
    if (!https && !exc.some(x => x.title === it.title)) e.push("no_https_source");
  }
  const b = it.bearing;
  if (!b || typeof b !== "object") e.push("no_bearing");
  else {
    for (const k of BEARING_KEYS) if (typeof b[k] !== "string" || !b[k].trim()) e.push("bearing_missing:" + k);
    for (const k of Object.keys(b)) if (!BEARING_KEYS.includes(k)) e.push("bearing_unknown:" + k);
    if (!["high", "medium", "low"].includes(b.escalation)) e.push("bad_escalation");
  }
  return e;
}

module.exports = { ROOT, CATS, BEARING_KEYS, MONTHS, readJson, writeItems, arg, positional, todayISO, isoToMs, shiftISO, longDate,
  validISO, keyNouns, jaccard, distanceKm, daysApart, normTitle, loadExceptions, itemErrors };
