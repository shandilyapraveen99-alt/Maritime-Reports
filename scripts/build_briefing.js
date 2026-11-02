#!/usr/bin/env node
// Builds the weekly briefing docx (US Letter, Arial): executive summary, global-coverage
// paragraph, escalation table, current-week high/medium items, low items as a list.
// "Current week" is the rolling 7 days ending on --as-of, matching the dashboard.
// Usage: node scripts/build_briefing.js [--as-of YYYY-MM-DD] [--summary file.txt] [--out dist/Maritime_Briefing.docx]
// --summary replaces the generated counts-only summary with the assembler's written text.
const fs = require("fs");
const path = require("path");
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, HeadingLevel,
  LevelFormat, AlignmentType, ExternalHyperlink, PageNumber, Footer } = require("docx");
const { ROOT, CATS, readJson, arg, shiftISO, longDate } = require("./lib");
const { latestISO } = require("./split");

const LABELS = { piracy: "Piracy & Armed Robbery", warrisk: "War Risk", greyzone: "Grey-Zone Coercion", navaldiplo: "Naval Diplomacy",
  ports: "Ports & Infrastructure", regulatory: "Regulatory & Legal", weather: "Weather & Environment", fisheries: "Fisheries",
  undersea: "Undersea & Hybrid", incidents: "Incidents & SAR", chokepoints: "Chokepoints & Trade", crime: "Transnational Crime", sanctions: "Sanctions Evasion" };
const LEVELS = ["high", "medium", "low"];
const items = readJson(arg("items", path.join(ROOT, "data", "items.json")));
const ledger = readJson(path.join(ROOT, "data", "coverage_ledger.json")).regions;
const asOf = arg("as-of", latestISO(items)), start = shiftISO(asOf, -6);
const outPath = arg("out", path.join(ROOT, "dist", "Maritime_Briefing.docx"));
const week = items.filter(i => i.dateISO >= start && i.dateISO <= asOf).sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
const by = lvl => week.filter(i => i.bearing.escalation === lvl);
const plural = (n, s) => n + " " + s + (n === 1 ? "" : "s");

const text = (t, o) => new TextRun(Object.assign({ text: t }, o));
const para = (t, o) => new Paragraph(Object.assign({ children: [text(t)], spacing: { after: 120 } }, o));
const h1 = t => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [text(t)] });
function link(s) { return new ExternalHyperlink({ link: s.url, children: [text(s.label, { style: "Hyperlink" })] }); }
function sourceLine(it) {
  const kids = [text("Sources: ", { bold: true })];
  it.sources.forEach((s, n) => { if (n) kids.push(text("; ")); kids.push(link(s)); });
  return new Paragraph({ children: kids, spacing: { after: 200 } });
}
function itemBlock(it) {
  return [
    new Paragraph({ heading: HeadingLevel.HEADING_3, keepNext: true, children: [text(it.title)] }),
    new Paragraph({ keepNext: true, spacing: { after: 60 }, children: [text(it.date + " | " + (LABELS[it.cat] || it.cat) + " | " + it.bearing.escalation + " escalation", { italics: true, color: "555555" })] }),
    para(it.brief),
    sourceLine(it)
  ];
}

function summary() {
  const file = arg("summary");
  if (file) return fs.readFileSync(file, "utf8").split(/\n\s*\n/).filter(s => s.trim()).map(s => para(s.trim()));
  const cats = CATS.map(c => [c, week.filter(i => i.cat === c).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const standing = items.filter(i => i.standing).length;
  const lines = [
    "For the seven days from " + longDate(start) + " to " + longDate(asOf) + ", the tracker recorded " + plural(week.length, "new item") + ": " +
      by("high").length + " high, " + by("medium").length + " medium and " + by("low").length + " low escalation.",
    "The dataset holds " + plural(items.length, "item") + " in total, including " + standing + " standing."
  ];
  if (cats.length) lines.push("The busiest categories this week were " + cats.map(c => (LABELS[c[0]] || c[0]) + " (" + c[1] + ")").join(", ") + ".");
  return lines.map(l => para(l));
}
function coverage() {
  const names = Object.keys(ledger), gaps = names.filter(n => (ledger[n].gaps || []).length);
  const dates = names.map(n => ledger[n].last_searched).sort();
  let s = "This run covers " + names.length + " regions and theme lanes, last searched between " + longDate(dates[0]) + " and " + longDate(dates[dates.length - 1]) + ".";
  if (gaps.length) s += " No verifiable news was found for: " + gaps.map(n => ledger[n].gaps.join(", ") + " (" + n + ")").join("; ") + ". These are coverage gaps recorded in the ledger and should not be read as calm.";
  else s += " The ledger records no open coverage gaps.";
  return para(s);
}
function escalationTable() {
  const widths = [4360, 1250, 1250, 1250, 1250];
  const border = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" }, borders = { top: border, bottom: border, left: border, right: border };
  const cell = (t, i, head, right) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, borders, margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: head ? { type: ShadingType.CLEAR, fill: "1F3A5F", color: "auto" } : undefined,
    children: [new Paragraph({ alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [text(String(t), head ? { bold: true, color: "FFFFFF" } : {})] })] });
  const rows = [new TableRow({ tableHeader: true, children: ["Category", "High", "Medium", "Low", "Total"].map((t, i) => cell(t, i, true, i > 0)) })];
  CATS.forEach(c => {
    const sel = week.filter(i => i.cat === c);
    if (!sel.length) return;
    const n = LEVELS.map(l => sel.filter(i => i.bearing.escalation === l).length);
    rows.push(new TableRow({ children: [LABELS[c], ...n, sel.length].map((t, i) => cell(t, i, false, i > 0)) }));
  });
  rows.push(new TableRow({ children: ["All categories", ...LEVELS.map(l => by(l).length), week.length].map((t, i) => cell(t, i, false, i > 0)) }));
  return new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: widths, rows });
}

const children = [
  new Paragraph({ heading: HeadingLevel.TITLE, children: [text("Maritime Reports: Weekly Briefing")] }),
  para(longDate(start) + " to " + longDate(asOf), { spacing: { after: 240 } }),
  h1("Executive summary"), ...summary(),
  h1("Global coverage"), coverage(),
  h1("Escalation this week"), escalationTable(),
  h1("High escalation items"), ...(by("high").length ? by("high").flatMap(itemBlock) : [para("No high escalation items this week.")]),
  h1("Medium escalation items"), ...(by("medium").length ? by("medium").flatMap(itemBlock) : [para("No medium escalation items this week.")]),
  h1("Low escalation items"),
  ...(by("low").length ? by("low").map(i => {
    const s = i.sources.find(x => x.url.startsWith("https://")) || i.sources[0];
    return new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 60 }, children: [text(i.title + " (" + i.date + "). "), link(s)] });
  }) : [para("No low escalation items this week.")])
];
const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 21 } } },
    paragraphStyles: [
      { id: "Title", name: "Title", basedOn: "Normal", run: { font: "Arial", size: 40, bold: true, color: "1F3A5F" }, paragraph: { spacing: { after: 80 } } },
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Arial", size: 28, bold: true, color: "1F3A5F" }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 0 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Arial", size: 22, bold: true }, paragraph: { spacing: { before: 160, after: 40 }, outlineLevel: 2 } }
    ],
    characterStyles: [{ id: "Hyperlink", name: "Hyperlink", run: { color: "0563C1", underline: {} } }]
  },
  numbering: { config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 240 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: ["Page ", PageNumber.CURRENT], size: 16, color: "777777" })] })] }) },
    children
  }]
});
Packer.toBuffer(doc).then(buf => {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  console.log("wrote " + path.relative(ROOT, outPath) + ": week " + start + " to " + asOf + ", " + by("high").length + " high / " + by("medium").length + " medium / " + by("low").length + " low");
});
