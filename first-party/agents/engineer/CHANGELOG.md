# Changelog

## 0.2.0 (2026-06-12)

- Add **Comment hygiene** section: forbid transient PM labels (PR numbers, issue numbers, iter-N, version tags, mission IDs) in code comments; forbid speculative TODOs; forbid archaeological "this used to be Y" comments.
- Add **PowerShell encoding caveat** to the Git workflow section: always use `gh ... --body-file <utf8-file>` on Windows; argument-string encoding mangles em-dashes / arrows / section signs.
- Add **Private-package versioning is cosmetic** rule under Boundaries: `private: true` packages don't get version bumps or per-package CHANGELOGs; semver discipline applies to first-party agents / skills / MCPs only.

## 0.1.0 (2026-06-11)

- Initial release.
