# Changelog

## 0.1.1 (2026-07-07)

- Add **Platform notes → PowerShell encoding caveat**: use `--body-file <utf8-file>` (never `--body "<text>"`) with any `gh` command that accepts a body on Windows/PowerShell to avoid multi-byte mojibake in em-dashes, arrows, and section signs. Update the **Open PR** example to `--body-file <utf8-file>`.
- Add **GitHub PR review submission** section: single-source-of-truth `gh api .../pulls/<n>/reviews --method POST --input` invocation plus the universal review-body JSON shape (`body`, `event: APPROVE | REQUEST_CHANGES | COMMENT`, `comments[].path/line/body`) that reviewer and designer both consume.

## 0.1.0 (2026-06-11)

- Initial release.
