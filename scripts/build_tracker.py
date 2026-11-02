#!/usr/bin/env python3
"""Builds the xlsx tracker: "Incident Log" plus "Weekly Summary" (COUNTIFS formulas),
recalculates it, stores the results as cached values, and fails on any formula error.

Usage: python3 scripts/build_tracker.py [--items data/items.json] [--out dist/Maritime_Tracker.xlsx]
                                        [--as-of YYYY-MM-DD] [--weeks 12]
Recalculates with LibreOffice when installed, otherwise with the `formulas` library.
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from datetime import date, timedelta
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter as col

ROOT = Path(__file__).resolve().parent.parent
CATS = ["piracy", "warrisk", "greyzone", "navaldiplo", "ports", "regulatory", "weather",
        "fisheries", "undersea", "incidents", "chokepoints", "crime", "sanctions"]
LOG_COLS = [("Date", 12), ("Title", 60), ("Category", 13), ("Escalation", 11), ("Type", 8), ("Standing", 9),
            ("Lat", 9), ("Lng", 9), ("Brief", 70), ("Primary source", 50)]
ERROR_RE = re.compile(r"#(REF!|DIV/0!|VALUE!|NAME\?|N/A|NUM!|NULL!)")
HEAD_FONT, HEAD_FILL = Font(name="Arial", bold=True, color="FFFFFF"), PatternFill("solid", fgColor="1F3A5F")
BODY_FONT = Font(name="Arial", size=10)


def header(ws, labels):
    for c, label in enumerate(labels, 1):
        cell = ws.cell(row=1, column=c, value=label)
        cell.font, cell.fill = HEAD_FONT, HEAD_FILL
        cell.alignment = Alignment(wrap_text=True, vertical="center")
    ws.freeze_panes = "A2"


def build(items, as_of, weeks, out):
    wb = Workbook()
    log = wb.active
    log.title = "Incident Log"
    header(log, [c[0] for c in LOG_COLS])
    for c, (_, width) in enumerate(LOG_COLS, 1):
        log.column_dimensions[col(c)].width = width
    rows = sorted(items, key=lambda i: i["dateISO"], reverse=True)
    for r, it in enumerate(rows, 2):
        src = next((s for s in it["sources"] if s["url"].startswith("https://")), it["sources"][0])
        values = [date.fromisoformat(it["dateISO"]), it["title"], it["cat"], it["bearing"]["escalation"], it["type"],
                  "Yes" if it["standing"] else "No", it["coords"][0], it["coords"][1], it["brief"], src["url"]]
        for c, v in enumerate(values, 1):
            log.cell(row=r, column=c, value=v).font = BODY_FONT
        log.cell(row=r, column=1).number_format = "yyyy-mm-dd"
    last = len(rows) + 1
    log.auto_filter.ref = f"A1:{col(len(LOG_COLS))}{last}"

    rng = lambda c: f"'Incident Log'!${c}$2:${c}${last}"
    ws = wb.create_sheet("Weekly Summary")
    labels = ["Week start", "Week end", "Total", "High", "Medium", "Low"] + CATS
    header(ws, labels)
    for c in range(1, len(labels) + 1):
        ws.column_dimensions[col(c)].width = 12
    # Rolling 7-day windows ending on the as-of date, matching the dashboard's weekly filter.
    for w in range(weeks):
        r = w + 2
        end = as_of - timedelta(days=7 * w)
        for c, v in ((1, end - timedelta(days=6)), (2, end)):
            cell = ws.cell(row=r, column=c, value=v)
            cell.number_format, cell.font = "yyyy-mm-dd", BODY_FONT
        window = f'{rng("A")},">="&$A{r},{rng("A")},"<="&$B{r}'
        ws.cell(row=r, column=3, value=f"=COUNTIFS({window})")
        for c, level in enumerate(("high", "medium", "low"), 4):
            ws.cell(row=r, column=c, value=f'=COUNTIFS({window},{rng("D")},"{level}")')
        for c, cat in enumerate(CATS, 7):
            ws.cell(row=r, column=c, value=f'=COUNTIFS({window},{rng("C")},"{cat}")')
    r = weeks + 2
    ws.cell(row=r, column=1, value="All time").font = Font(name="Arial", bold=True)
    ws.cell(row=r, column=3, value=f'=COUNTIFS({rng("A")},">=0")')
    for c, level in enumerate(("high", "medium", "low"), 4):
        ws.cell(row=r, column=c, value=f'=COUNTIFS({rng("D")},"{level}")')
    for c, cat in enumerate(CATS, 7):
        ws.cell(row=r, column=c, value=f'=COUNTIFS({rng("C")},"{cat}")')
    for row in ws.iter_rows(min_row=2, max_row=r, min_col=3):
        for cell in row:
            cell.font = Font(name="Arial", size=10, bold=cell.row == r)
    wb.calculation.fullCalcOnLoad = True
    wb.save(out)


def expected_values(items, as_of, weeks):
    """Independent count in Python, used to confirm the recalculated formulas."""
    def row(sel):
        return [len(sel)] + [sum(i["bearing"]["escalation"] == l for i in sel) for l in ("high", "medium", "low")] + \
               [sum(i["cat"] == c for i in sel) for c in CATS]
    out = {}
    for w in range(weeks):
        end = as_of - timedelta(days=7 * w)
        start = (end - timedelta(days=6)).isoformat()
        out[w + 2] = row([i for i in items if start <= i["dateISO"] <= end.isoformat()])
    out[weeks + 2] = row(items)
    return out


def recalc_soffice(path):
    binary = shutil.which("soffice") or shutil.which("libreoffice")
    if not binary:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run([binary, "--headless", "--convert-to", "xlsx", "--outdir", tmp, str(path)], check=True, capture_output=True)
        shutil.move(str(Path(tmp) / path.name), str(path))
    ws = load_workbook(path, data_only=True)["Weekly Summary"]
    return {(c.row, c.column): c.value for row in ws.iter_rows(min_row=2, min_col=3) for c in row}, "LibreOffice"


def recalc_formulas(path):
    import formulas
    model = formulas.ExcelModel().loads(str(path)).finish()
    solution = model.calculate()
    values = {}
    ref = re.compile(r"'\[" + re.escape(path.name) + r"\]WEEKLY SUMMARY'!([A-Z]+)(\d+)$", re.I)
    for key, rng in solution.items():
        m = ref.match(str(key))
        if m:
            cidx = 0
            for ch in m.group(1):
                cidx = cidx * 26 + ord(ch) - 64
            if cidx >= 3:
                values[(int(m.group(2)), cidx)] = rng.value[0, 0]
    return values, "formulas library"


def inject_cached(path, values):
    """Writes results into the <v> of each formula cell so every viewer shows them."""
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for entry in zin.infolist():
            data = zin.read(entry.filename)
            if entry.filename == "xl/worksheets/sheet2.xml":
                def fill(m):
                    letters, row = re.match(r"([A-Z]+)(\d+)", m.group(1)).groups()
                    cidx = 0
                    for ch in letters:
                        cidx = cidx * 26 + ord(ch) - 64
                    return f'<c r="{m.group(1)}"{m.group(2)}><f>{m.group(3)}</f><v>{int(values[(int(row), cidx)])}</v></c>'
                text = re.sub(r'<c r="([A-Z]+\d+)"([^>]*?)><f>(.*?)</f><v ?/?>(?:</v>)?</c>', fill, data.decode("utf8"))
                data = text.encode("utf8")
            zout.writestr(entry, data)
    tmp.replace(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--items", default=str(ROOT / "data" / "items.json"))
    ap.add_argument("--out", default=str(ROOT / "dist" / "Maritime_Tracker.xlsx"))
    ap.add_argument("--as-of")
    ap.add_argument("--weeks", type=int, default=12)
    a = ap.parse_args()
    items = json.load(open(a.items, encoding="utf8"))
    as_of = date.fromisoformat(a.as_of or max(i["dateISO"] for i in items))
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    build(items, as_of, a.weeks, out)

    result = recalc_soffice(out) or recalc_formulas(out)
    values, engine = result
    errors = [k for k, v in values.items() if v is None or ERROR_RE.search(str(v))]
    expected = expected_values(items, as_of, a.weeks)
    wrong = [(r, c + 3) for r, vals in expected.items() for c, v in enumerate(vals) if values.get((r, c + 3)) != v]
    if engine != "LibreOffice":
        inject_cached(out, values)
    print(f"{out.name}: {len(items)} log rows, {len(values)} formulas recalculated by {engine}, "
          f"{len(errors)} errors, {len(wrong)} differ from independent count")
    sys.exit(1 if errors or wrong else 0)


if __name__ == "__main__":
    main()
