# Changelog

## 0.2.0 (2026-06-14)

- Replace the duplicated PowerShell and bash watchdog loop bodies with a single cross-platform Node script (`watchdog.mjs`) shipped as a skill artifact. The script uses `JSON.parse` to extract the top-level `status` field, so it is robust against `"status": "..."` substrings embedded in nested JSON fields (e.g. a workflow's `details` brief) and against PowerShell's `ConvertFrom-Json` choking on long string values with backslash escapes. SKILL.md Pattern 4 sections now reduce to a one-line `node watchdog.mjs ...` spawn per OS. The `<kind>` argument switches between `task` and `workflow` polling. Drop the PowerShell `-match` array-footgun anti-pattern note (no longer applicable, the body is no longer PowerShell).

## 0.1.0 (2026-06-11)

- Initial release.
