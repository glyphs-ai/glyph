# MODE: review — Playwright-driven PR review playbook

Step-by-step playbook for `MODE: review`. Load only when the brief selects review mode.

**Input**: a PR number against `glyphs-ai/glyph` whose changes touch `packages/dashboard/`.

**Output**: a GitHub PR review (verdict + inline comments) submitted via the GH API. Plus a parallel markdown report at `<workdir>/artifact/review.md` summarizing the evidence captured (screenshots + journey runs + a11y probes), and a machine-readable verdict at `<workdir>/artifact/verdict.json` per the universal schema (`workflow-coordination/SKILL.md` §C). Writing under `artifact/` is required so the substrate auto-harvests the files into the task's `success.artifacts` and they appear in the dashboard Artifacts tab.

## Step 1 — Mergeability + scope check

```bash
gh pr view <number> --repo glyphs-ai/glyph --json mergeable,files -q '{mergeable, files: [.files[] | .path]}'
```

- If `mergeable == "CONFLICTING"`, abort — do not submit a review. Report the rebase requirement.
- If NO files in the PR touch `packages/dashboard/`, abort with a "no dashboard changes — out of scope for this agent" report.
- If files touch BOTH dashboard and non-dashboard packages, review only the dashboard portion; explicitly note in the review summary that non-dashboard changes were not reviewed by this agent.

## Step 2 — Worktree the PR's branch

Use `git-pr` Mode B (resume existing branch / checkout PR head). Worktree path follows skill convention.

## Step 3 — Build + serve the mock-mode dashboard

In the worktree:

```bash
pnpm install --frozen-lockfile
pnpm --filter @glyphs-ai/dashboard build           # typecheck + bundle
pnpm --filter @glyphs-ai/dashboard dev:mock:e2e &  # mocked APIs, port 5180, --strictPort
SERVE_PID=$!

# Wait for dev server to bind on 5180 (retry up to 30s).
for i in {1..30}; do
  curl -fsS -o /dev/null http://127.0.0.1:5180/ && break
  sleep 1
done
```

On Windows the same flow uses `Start-Job` or `Start-Process` and `Test-NetConnection 127.0.0.1 -Port 5180`.

If the dev server fails to bind within 30s, abort the review with a "could not start mock dev server — likely a PR-introduced build break" verdict (REQUEST_CHANGES) and include the build log tail in the report.

ALWAYS register cleanup: at end-of-task, kill `$SERVE_PID` (or `Stop-Process -Id $SERVE_PID`) and `git worktree remove --force`. Use a `trap` (POSIX) or `try/finally` (PowerShell) so this runs even on error.

## Step 4 — Drive the changed routes / components with Playwright MCP

The Playwright MCP is already wired (see frontmatter `dependencies.mcps`). Use its tools to:

1. **Capture baseline screenshots** at three viewports for each route the PR affects:
   - desktop `1440x900`
   - tablet `768x1024`
   - mobile `375x812`
2. **Run targeted user journeys** for any user-visible behavior the PR adds or changes — e.g. open a modal, fill a form, toggle a control, click through a wizard. Capture before/after screenshots for each interaction step.
3. **Accessibility probes**:
   - Tab through the affected component(s) and capture the focus path — every focusable element must be reachable in a sensible order
   - For any new interactive element, verify accessible name (Playwright's `getByRole(...).getAttribute('aria-label')` or equivalent text)
   - Verify focus-visible outline is present (no `outline: none` without a replacement)
   - Run `axe-core` via the MCP's accessibility-scan tool against the affected route(s); collect violations
4. **Responsive sanity** — verify nothing is clipped, overflows horizontally, or becomes interactively unreachable at the mobile viewport

Persist all screenshots and journey artefacts under `<workdir>/artifact/playwright-evidence/`. Reference them in the report and the inline review comments.

## Step 5 — Cross-check against the PR's stated UX

Read the PR body for the author's UX claims ("adds a toggle X", "fixes blank rendering at Y"). For each claim, verify with the captured evidence:

- Claim matches evidence → reinforce in summary
- Claim partially matches → request changes with the specific gap as an inline comment
- Claim contradicts evidence → REQUEST_CHANGES with the evidence inline

If a design spec exists for this PR (in `<workspace>/specs/` or referenced in the PR body), cross-reference each spec acceptance criterion against the evidence. Each unmet criterion is a blocking inline comment.

## Step 6 — Compose the review

Inline-comment style:
- Comment on the SOURCE-FILE LINE where the issue originates (`path` + `line` in the review-comment JSON), not on screenshots
- Each comment explains: what's wrong, what the screenshot or journey shows, and a concrete fix suggestion
- Categorise each comment as **blocking** (request-changes-grade) or **suggestion** (nice-to-have)

Verdict rules:
- **APPROVE** only when ALL of: build succeeds, every PR claim is evidenced, every axe-core violation is justified or fixed, every viewport renders without clipping/overflow, every interactive element is keyboard-reachable with a visible focus outline.
- **REQUEST_CHANGES** when any blocking issue exists. The review body lists them in priority order.
- **COMMENT** (no verdict) when the PR is dashboard-touching but the touch is trivial (e.g. one-line copy change with no UI impact) AND nothing blocking found.

Submit the review with the `gh api` invocation + review-body JSON documented in the `git-pr` skill's **GitHub PR review submission** section. The `body` string should include evidence pointers (e.g. "See playwright-evidence/login-mobile.png for the clipping issue noted in HeaderActions.tsx:42"), each `comments[]` entry should point at the SOURCE-FILE LINE where the issue originates (`path` + `line`), and typical `path` values for this agent are under `packages/dashboard/src/components/`.

## Step 7 — File design follow-ups (optional)

If the review surfaces design issues that are out-of-scope-for-this-PR but worth tracking (e.g. a sibling component shows the same clipping at 640px), file a GitHub issue:

```bash
gh issue create --repo glyphs-ai/glyph \
  --title "design: <one-line>" \
  --body-file <body.md> \
  --label "design,area:dashboard"
```

Reference the issue number in the review summary so the orchestrator can pick it up.
