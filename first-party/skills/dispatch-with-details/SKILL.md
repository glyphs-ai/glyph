---
name: dispatch-with-details
scope: official
description: "Wrapper over `glyph task dispatch` and `glyph workflow create` that takes a brief-file path, auto-derives a ≤200-char summary for `--brief`, forwards the body via `--details-file`, and returns the parsed task / workflow id"
version: 0.3.2
dependencies:
  skills:
    - "https://github.com/glyphs-ai/glyph/tree/main/first-party/skills/dispatch-watchdog"
---

# Dispatch With Details Skill

## Domain

A thin, agent-agnostic wrapper over `glyph task dispatch` and
`glyph workflow create` that removes the recurring friction of
authoring the dispatch command by hand. Both verbs share an identical
`--brief` (hard 200-character limit) + `--details-file` shape;
callers that author natural-length briefs hit the cap every time and
waste a round-trip rewriting it. This skill standardises the "brief
in a file, summary auto-derived, dispatch id parsed out" workflow
across both kinds.

## Boundary

**In scope:**
- Accepting a brief-file path (Markdown) as the primary input.
- Extracting a ≤200-character summary from the file (first non-empty
  heading text or first paragraph), trimmed and ASCII-safe.
- Invoking either `glyph task dispatch --agent <agent> --brief
  "<summary>" --details-file <path>` (kind: task) or
  `glyph workflow create --coord-agent <agent> --brief "<summary>"
  --details-file <path>` (kind: workflow) — caller picks via a
  `Kind` / `--kind` argument — with all caller-provided extras
  forwarded.
- Parsing the returned JSON for the new dispatch id (both verbs
  expose it under the `id` key on `--json` output) and returning it
  to the caller.

**Out of scope:**
- Authoring brief content. The caller owns brief quality.
- Deciding which kind to use. The caller decides per the "Choosing
  between task and workflow" section below; the skill does not infer
  the kind.
- Waiting for the dispatch to complete — use
  `official/dispatch-watchdog` for the `task` kind. Workflow-kind
  watchdog support is a follow-up; callers polling a workflow today
  should invoke `glyph workflow show <workflow-id> --json` themselves
  until a kind-aware watchdog primitive lands.
- Mutating the brief file. It is read-only input.

## Why this skill exists

Both `glyph task dispatch --brief` and `glyph workflow create --brief` reject payloads > 200 chars with a hard error. Natural briefs are multi-paragraph Markdown, so callers must author the body in a file, pass it via `--details-file`, and derive a short summary for `--brief`. This skill packages that workaround as one primitive that works for either verb.

## Choosing between task and workflow

This is the first decision the caller makes — before authoring a
brief at all. Two primitives exist for dispatch and they are not
interchangeable:

- **`glyph task dispatch`** — single agent, one LLM run, open-ended
  brief. The agent does its work and exits; the caller reads the
  result and decides what's next. No automatic iteration, no
  multi-agent coordination.
- **`glyph workflow create`** — coordinator + worker agents running
  a structured DAG per a strategy skill. The coordinator decides
  what workers to dispatch based on the strategy's case bank,
  iterates automatically (e.g. reviewer rejects → coord re-dispatches
  engineer), terminates only when the strategy's stop condition
  fires. The first-party strategy today is
  `official/software-development-lifecycle` (engineer → reviewer +
  designer → coord-finish-on-clean-verdicts).

Decision rule:

- Work ends in a PR that should go through review → `workflow create`
  with `--coord-agent official/coordinator`.
- Work is one-shot exploration / audit / research / a single
  write-up → `task dispatch`.
- Unsure → start with `task dispatch`. If you find yourself manually
  re-dispatching the same agent with findings from another, you're
  hand-rolling a workflow — stop and re-dispatch as a workflow.

Brief authoring: the 200-char hard cap on `--brief` and the
`--details-file` body convention are identical across the two verbs.
The primitive below handles both — pick the kind via its `-Kind` /
`--kind` argument; the rest of the call shape stays the same.

Watchdog: `official/dispatch-watchdog` covers the `task` path
end-to-end today — it polls a returned task id and fires a
notification on terminal state. Workflow-kind watchdog support is
not yet shipped (the watchdog primitive hardcodes `glyph task show`
and does not accept a verb parameter); for now, callers polling a
workflow should invoke `glyph workflow show <workflow-id> --json`
directly until a kind-aware watchdog primitive lands.

Concurrency: multiple workflows can run in parallel against the same
workspace. The coordinator agent is workflow-scoped, not
workspace-scoped (so running two workflows is fine; any
"one orchestrator per workspace" rule the caller adopts still holds).

## Pre-flight read (mandatory)

Before writing a brief or `--details-file`, READ the current contents
of every agent, skill, and MCP the brief will reference or prescribe
behavior for:

- The dispatched agent's `AGENTS.md` IN FULL (do not rely on grep
  snippets — agents are typically 100-300 lines and the prescriptions
  in the brief must complement, not duplicate or contradict, the
  agent's own constitution).
- **Every skill the dispatched agent depends on** (per
  `dependencies.skills` in the agent's frontmatter). If a skill
  already covers a topic (e.g. `git-pr` covers repo setup, branch
  naming, worktree management, PR creation; `karpathy-guidelines`
  covers code style), the brief MUST NOT restate those instructions.
  Restate only the PROJECT-SPECIFIC overrides.
- Adjacent agents whose work product the dispatched agent will read.

Failure modes pre-flight catches:

- **"Add X" when X already exists** — most common; brief asks for a
  convention that is already in the agent's constitution.
- **Restating what a depended-on skill covers** — wastes context
  tokens; a "helpful" restatement that drifts from the skill's
  wording becomes a contradiction.
- **Path / naming conflict** — brief prescribes a path that the
  agent's prompt or related skill puts elsewhere.
- **Version-bump misalignment** — brief tells engineer to bump to a
  version that already exists.
- **Contradicting an existing rule** — brief prescribes behavior that
  the agent's "Boundaries" section forbids.

The grep tool's `head_limit` default truncates results; rely on
`view` for any file the brief will prescribe changes to. When in
doubt, the brief should describe WHAT outcome is wanted, not HOW to
achieve it — the agent's skills already encode the HOW.

## Primitive

### PowerShell

```pwsh
function Invoke-GlyphDispatch {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Agent,
        [Parameter(Mandatory)] [string] $BriefFile,
        # 'task' invokes `glyph task dispatch --agent <Agent>`;
        # 'workflow' invokes `glyph workflow create --coord-agent <Agent>`.
        # Default is 'task' for backward compatibility with callers
        # written before the kind argument existed.
        [ValidateSet('task', 'workflow')] [string] $Kind = 'task',
        [string[]] $ExtraArgs = @()
    )

    if (-not (Test-Path -LiteralPath $BriefFile)) {
        throw "brief file not found: $BriefFile"
    }

    # Derive summary: first non-empty heading text, else first paragraph.
    $lines = Get-Content -LiteralPath $BriefFile -Encoding UTF8
    $heading = $lines | Where-Object { $_ -match '^\s*#{1,6}\s+(.+)$' } | Select-Object -First 1
    if ($heading) {
        $summary = ($heading -replace '^\s*#{1,6}\s+', '').Trim()
    } else {
        $paragraph = ($lines | Where-Object { $_.Trim() -ne '' } | Select-Object -First 1)
        $summary = if ($paragraph) { $paragraph.Trim() } else { (Split-Path -Leaf $BriefFile) }
    }

    # Hard-clip to 200 chars (with ellipsis if trimmed).
    if ($summary.Length -gt 200) {
        $summary = ($summary.Substring(0, 197)).TrimEnd() + '...'
    }

    # Use 2>$null to keep stderr noise out of the captured JSON. The
    # two CLI verbs share an identical --brief / --details-file /
    # --json shape; only the verb itself and the agent-flag name
    # differ (--agent vs --coord-agent).
    if ($Kind -eq 'workflow') {
        $raw = & glyph workflow create `
            --coord-agent  $Agent `
            --brief        $summary `
            --details-file $BriefFile `
            --json `
            @ExtraArgs 2>$null | Out-String
    } else {
        $raw = & glyph task dispatch `
            --agent        $Agent `
            --brief        $summary `
            --details-file $BriefFile `
            --json `
            @ExtraArgs 2>$null | Out-String
    }

    # Regex-extract the dispatch id rather than parsing JSON (host-shell
    # JSON parsers can choke on stderr/stdout interleavings). Both verbs
    # expose the id under "id"; the legacy "taskId" branch is retained
    # for older glyph builds that still emitted it.
    if ($raw -match '"(?:id|taskId)"\s*:\s*"([^"]+)"') {
        return $Matches[1]
    }
    throw "could not parse $Kind id from dispatch output:`n$raw"
}
```

Example invocations:

```pwsh
# Dispatch a one-shot task (kind defaults to 'task').
$tid  = Invoke-GlyphDispatch -Agent 'official/engineer'    -BriefFile './brief.md'

# Seed a workflow with the official coordinator.
$wfid = Invoke-GlyphDispatch -Agent 'official/coordinator' -BriefFile './brief.md' -Kind workflow
```

### Bash

```bash
glyph_dispatch() {
    local agent=$1 brief_file=$2
    shift 2

    # Optional --kind=task|workflow (default task). Sniffed out of
    # "$@" so the remainder is forwarded verbatim to the underlying
    # glyph verb.
    local kind=task
    local -a extras=()
    while (( $# )); do
        case "$1" in
            --kind=*)                     kind="${1#--kind=}" ;;
            --kind)                       kind="$2"; shift ;;
            *)                            extras+=("$1") ;;
        esac
        shift
    done

    [[ -f "$brief_file" ]] || { echo "brief file not found: $brief_file" >&2; return 1; }

    local summary
    summary=$(awk '
      /^[[:space:]]*#{1,6}[[:space:]]+/ {
        sub(/^[[:space:]]*#{1,6}[[:space:]]+/, "");
        print; exit
      }' "$brief_file")
    if [[ -z "$summary" ]]; then
      summary=$(awk 'NF { print; exit }' "$brief_file")
    fi
    [[ -n "$summary" ]] || summary=$(basename "$brief_file")

    # Clip to 200 chars.
    if (( ${#summary} > 200 )); then
        summary="${summary:0:197}..."
    fi

    # The two CLI verbs share an identical --brief / --details-file /
    # --json shape; only the verb itself and the agent-flag name
    # differ (--agent vs --coord-agent).
    local raw
    case "$kind" in
        workflow)
            raw=$(glyph workflow create \
                --coord-agent  "$agent" \
                --brief        "$summary" \
                --details-file "$brief_file" \
                --json "${extras[@]}" 2>/dev/null)
            ;;
        task)
            raw=$(glyph task dispatch \
                --agent        "$agent" \
                --brief        "$summary" \
                --details-file "$brief_file" \
                --json "${extras[@]}" 2>/dev/null)
            ;;
        *)
            echo "unknown --kind: $kind (expected task|workflow)" >&2
            return 1
            ;;
    esac

    # Regex out the dispatch id. Both verbs expose it under "id"; the
    # legacy "taskId" alternation is kept for older glyph builds.
    local id
    id=$(printf '%s' "$raw" | sed -n 's/.*"\(id\|taskId\)"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\2/p' | head -n1)
    [[ -n "$id" ]] || { echo "could not parse $kind id: $raw" >&2; return 1; }
    printf '%s\n' "$id"
}
```

Example invocations:

```bash
# Dispatch a one-shot task (kind defaults to 'task').
tid=$(glyph_dispatch  official/engineer    ./brief.md)

# Seed a workflow with the official coordinator.
wfid=$(glyph_dispatch official/coordinator ./brief.md --kind=workflow)
```

## Caller contract

The caller MUST:
1. Decide the dispatch kind (`task` vs `workflow`) per the
   "Choosing between task and workflow" section above. The kind is
   the caller's architectural choice; the skill does not infer it.
2. Author the full brief as a file (convention:
   `<workspace>/<orchestrator-state-dir>/active-missions/<mission-id>/dispatch-brief.md`).
3. Ensure the file's first heading or first paragraph reads as a
   useful one-line summary for `--brief`.
4. Persist the returned id (convention: `task-id.txt` in the mission
   folder for `Kind = task`, `workflow-id.txt` for `Kind = workflow`).
   For `Kind = task`, pair with `official/dispatch-watchdog` to get a
   completion notification on terminal state. Workflow-kind watchdog
   support is a follow-up; callers polling a workflow should invoke
   `glyph workflow show <workflow-id> --json` directly until a
   kind-aware watchdog primitive lands.

The skill does not log; logging the dispatch event is the caller's
responsibility (e.g. orchestrator writes to its own decisions log).

## Anti-patterns

- **Do not** call `glyph task dispatch --brief "<entire long brief>"`
  (or `glyph workflow create --brief "<entire long brief>"`) and
  re-try on rejection. Author the brief in a file from the start.
- **Do not** bypass the skill once you've decided a workflow is the
  right shape — the 200-char `--brief` cap applies to
  `glyph workflow create` identically and the same workaround is
  needed. Set the kind flag instead of hand-rolling a parallel
  invocation.

## CHANGELOG

See `CHANGELOG.md` next to this file.
