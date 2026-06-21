---
name: cjk-pdf-report
scope: official
description: "Render a self-contained HTML report to a CJK-safe PDF — a Chromium print pipeline that strips the browser footer, a five-point pypdf self-check, and a white-background extra-light-callout design system"
version: 0.1.0
prereqs: |
  Requires Node (>=18) and an Edge or Chrome install for rendering, plus
  Python with `pypdf` for the self-check (`pip install pypdf`). Optional
  fallbacks: `wkhtmltopdf` or `pip install weasyprint`.
---

# CJK-safe PDF Report Skill

## Domain

Turn a self-contained HTML report into a PDF that survives two things most
HTML→PDF pipelines get wrong with Chinese / Japanese / Korean documents:

1. **CJK glyphs turning into tofu or mojibake** — fixed by driving a real
   Chromium-family browser (Edge/Chrome), which embeds the system CJK fonts
   and keeps the text layer selectable and extractable.
2. **A browser print footer polluting every page** — the
   `date | title | file:///… | page/total` band Chromium injects unless you
   pass `--no-pdf-header-footer`.

The skill ships three artifacts:

- `<SKILL_DIR>/scripts/render.mjs` — cross-platform render (Edge/Chrome →
  wkhtmltopdf → weasyprint fallback chain).
- `<SKILL_DIR>/scripts/verify.py` — a five-point pypdf self-check that fails
  loudly on a bad render.
- `<SKILL_DIR>/templates/report.css` + `report.html` — a white-background,
  extra-light-callout design system you inline into your report.

## Boundary

**In scope:** rendering one self-contained HTML file to a clean A4 PDF;
verifying the result; a reusable report stylesheet.

**Out of scope:** building the report content itself (data joins, KPI math,
prose) — that is the caller's job; this skill only renders and verifies what
the caller produced. No external assets: the input HTML must inline its CSS,
fonts-by-family, and images (data URIs) so the PDF is reproducible.

## Usage

```bash
# 1. Render HTML -> PDF (auto-detects Edge/Chrome; --no-pdf-header-footer baked in)
node <SKILL_DIR>/scripts/render.mjs report.html report.pdf
#    wide tables: add --landscape
#    pin a browser: --browser <path>  or  env CJK_PDF_BROWSER=<path>

# 2. Self-check (exit 0 only if all applicable checks pass)
python <SKILL_DIR>/scripts/verify.py report.pdf
#    non-CJK document: add --no-cjk
#    multi-page minimum: add --min-pages 2
```

`render.mjs` tries Edge first, then Chrome, then `wkhtmltopdf`, then a
`weasyprint` one-liner, and exits non-zero only if every backend fails.

## The five-point self-check

`verify.py` is the contract. Never ship a PDF that has not passed it:

1. **`%PDF-` header** — the output is a real PDF, not an error page.
2. **Parses, pages ≥ N** — pypdf opens it; page count meets `--min-pages`.
3. **CJK extractable on first + last page** — guards against an image-only
   render or missing fonts (skip with `--no-cjk` for Latin-only docs).
4. **No browser footer** — no `file:///` URL leaked into the text layer
   (the tell-tale sign `--no-pdf-header-footer` was forgotten).
5. **Non-blank** — real text content is present.

If a check fails, fix the cause and re-render — do not hand a failed PDF on.
Most common failure is #4: re-render with `render.mjs` (which always passes
`--no-pdf-header-footer`) rather than a raw browser invocation.

## Design system (templates/)

`report.css` (and the inlined `report.html` skeleton) encode a print-first,
boss-and-elder-readable house style:

- **Pure white page** (`#ffffff`). No parchment / warm tints.
- Saturated brand colour is an **accent only**: headings, table headers, 5px
  left bars, small badges/pills, KPI figures, links. Override with one line:
  `:root { --brand: #0b4a3a; }`.
- **Callouts = extra-light tinted background + a 5px left colour bar + dark
  text** — never a dark fill with reversed white text (illegible in print).
  Classes: `.callout` (ok/green), `.callout-warn` (orange), `.callout-amber`
  (amber), `.callout-info` (blue/devil's-advocate), `.conclude`.
- `.formula`, `tr.total`, `.pill/.badge/.tag`, and white-fill `.kpi` cards
  with a 5px left bar round out the kit.
- 2px corner radius, hairline `#e2e4dc` borders, no `opacity` tricks (opacity
  is unreliable in print).

The **table header row** is the one place a dark fill + white text is allowed
(it is a single line high).

Build your report by inlining `report.css` into a `<style>` block (a report
PDF must be self-contained), then write your content using these classes. The
shipped `report.html` is both a copy-paste starting point and the fixture the
skill is tested against.

## Notes

- Keep the input HTML **self-contained**: inline CSS, reference fonts by
  family (the renderer supplies the actual CJK fonts), embed images as data
  URIs. External `file:///` or `http(s)://` assets make the PDF
  non-reproducible and can leak paths into the output.
- For very wide tables (many columns), render `--landscape`.
- The render step prints progress to stderr and the PDF path to stderr on
  success; nothing goes to stdout, so it composes cleanly in pipelines.
