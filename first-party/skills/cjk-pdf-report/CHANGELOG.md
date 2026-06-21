# Changelog

## 0.1.0 (2026-06-21)

- Initial release. Ships `scripts/render.mjs` (cross-platform HTML→PDF via an
  Edge/Chrome headless print with `--no-pdf-header-footer`, falling back to
  `wkhtmltopdf` then `weasyprint`), `scripts/verify.py` (a five-point pypdf
  self-check: `%PDF-` header, page count, CJK extractable on first+last page,
  no leaked browser footer, non-blank), and a white-background
  extra-light-callout report design system in `templates/report.css` plus a
  self-contained `templates/report.html` skeleton/fixture.
