# Domain derivation framework

This file teaches you HOW to think about domains, not what domains exist. There is no fixed list. You derive domains from the mission.

## The 4 questions

```
Q1. OUTPUTS — What does success require us to produce?
    Examples: code modules / reports / data sets / recommendations /
              infrastructure / documentation / decisions / experiments

Q2. INPUTS — For each output, what does it need as input?
    Examples: research / requirements / existing artifacts /
              user feedback / external data / approval

Q3. WORK — What kinds of work convert input to output?
    Examples: write / debug / analyze / synthesize / monitor /
              design / test / research / negotiate / format

Q4. CLUSTER — Group related work into domains. Each domain → one role.
              A role becomes one agent (initially); a role can later
              spawn multiple specializations as needed.
```

## Worked example — "Launch a small SaaS for X"

```
Q1 OUTPUTS:
  - working web app (code + infra)
  - landing page (design + copy)
  - usage analytics (data + dashboard)
  - customer feedback summary (research)

Q2 INPUTS for each:
  - web app:        product requirements, design specs
  - landing page:   product positioning, brand
  - analytics:      app instrumentation, query patterns
  - customer feedback: customer interactions

Q3 WORK:
  - write code, debug, deploy, monitor   → engineering
  - copywriting, visual design            → design + writing
  - SQL/log analysis, dashboard building  → data analysis
  - run customer interviews, summarize    → research

Q4 DOMAINS (clustered):
  - engineering   (build/run the app)
  - design        (visual + copy + UX)
  - data          (analytics + dashboards)
  - research      (customers + market)
```

That's 4 domains for THIS mission. Other missions yield different decompositions.

## Worked example — "Write a 10-chapter book on topic Y"

```
Q1 OUTPUTS:
  - chapter drafts
  - cited sources
  - illustrations / diagrams
  - polished final manuscript

Q2 INPUTS:
  - chapter drafts:   research notes, outline
  - sources:          search across literature
  - illustrations:    described concepts from drafts
  - manuscript:       chapter drafts + edits

Q3 WORK:
  - research literature, summarize         → research
  - draft prose                            → writing
  - illustration design                    → design (light)
  - editing, fact-checking, line-editing   → editing

Q4 DOMAINS:
  - research
  - writing
  - editing
  (illustrations might be: design domain OR a one-off external task)
```

3-4 domains, completely different from the SaaS example.

## Worked example — "Quarterly market analysis for finance team"

```
Q1 OUTPUTS:
  - sector overview report
  - top-performer recommendations
  - risk flags

Q2 INPUTS:
  - market data (prices, volumes, indices)
  - news / events
  - analyst reports

Q3 WORK:
  - data collection (scraping, API calls)
  - statistical analysis
  - news synthesis
  - report writing
  - critical review (devil's advocate)

Q4 DOMAINS:
  - data-collection
  - quantitative-analysis
  - news-synthesis
  - report-writing
  - review (peer critique)
```

5 domains, different specialization.

## Rules of thumb

- **Match domain count to actual work.** 2 or 7, whatever the mission needs — the number falls out of Q4, not out of a Fortune-500 org chart.
- **One line of work per domain.** If work spills across (e.g. "engineering" and "DevOps" bleed together on a small mission, or a data-collection task keeps needing news-synthesis judgment), re-cluster.
- **Derive domains from the work list.** Real companies have a fixed C-suite because they have to; your company doesn't. Build the org from Q1–Q3 outputs, not from analogy.
- **Distinguish role from agent.** A role is a function on the org chart. An agent is the thing that fills it. Swap agents inside a role without touching the org chart.
- **Add a domain only when a real piece of work needs it.** YAGNI — pre-created domains rot.
- **Start with 2–4 domains.** Easier to grow than to consolidate.
- **A domain that hasn't dispatched a task in 30 days is probably not real.** Consider folding it into another or retiring it.
- **Two roles in the same domain doing similar work** = one role with two agents (specialization), not two domains.
- **Exploratory work** (open-ended R&D, "figure out how to integrate X") often deserves its own domain even if the workload is bursty. The mindset is different from execution work.

## When to revisit your domain decomposition

- Quarterly review (`rituals/quarterly-org-rebalance.md`)
- After a mission revealed a missing capability ("we needed a $X agent and didn't have one")
- After a mission revealed a redundant capability ("agents A and B did the same work")
- After the user pivots the mission

Write your reasoning to `.pilot/decisions.log` and update `.pilot/org-chart.md` whenever the decomposition changes.
