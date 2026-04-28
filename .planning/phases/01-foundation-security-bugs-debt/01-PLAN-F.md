---
phase: 01-foundation-security-bugs-debt
plan: F
type: execute
wave: 1
depends_on: []
files_modified:
  - CLAUDE.md
autonomous: false
requirements:
  - FOUN-15

must_haves:
  truths:
    - "A `next` branch exists on origin (remote)"
    - "CLAUDE.md contains a `## Git Workflow` section summarizing the branching strategy and referencing flow.md"
    - "The `next` branch was created from a clean tip of `main`"
  artifacts:
    - path: "CLAUDE.md"
      provides: "## Git Workflow section with branching rules and link to flow.md"
  key_links:
    - from: "CLAUDE.md ## Git Workflow"
      to: "flow.md"
      via: "See flow.md for the full workflow specification"
---

<objective>
Create the `next` integration branch and document the branching strategy in CLAUDE.md.

Purpose: Feature branches in all subsequent phases must be created from `next`, not `main`. Without the branch existing, the workflow documented in flow.md cannot be followed. Without CLAUDE.md documentation, future Claude instances will branch from the wrong base.

Output: `next` branch pushed to origin. CLAUDE.md has a Git Workflow section so all future sessions know to branch from `next`.
</objective>

<execution_context>
@C:/Users/lamonta/Code/grimoire/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/lamonta/Code/grimoire/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@C:/Users/lamonta/Code/grimoire/.planning/ROADMAP.md
@C:/Users/lamonta/Code/grimoire/flow.md

<interfaces>
<!-- flow.md branching strategy summary -->
// main   — production-ready; matched to current stable build
// next   — integration branch for upcoming release; beta/testing stability
// feature/*  — short-lived; always branched from next

// Starting a task:
//   git checkout next && git pull origin next
//   git checkout -b feature/your-feature-name

// Merging to next:
//   git checkout next && git merge --no-ff feature/your-feature-name
//   git branch -d feature/your-feature-name

// Releasing (next → main):
//   git checkout main && git merge --no-ff next
//   git tag -a vX.Y.Z && git push origin main --tags
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create next branch from main and push to origin</name>
  <files></files>
  <read_first>
    - No files to read — this is a git operation
  </read_first>
  <action>
Ensure the working tree is clean, then create `next` from the current tip of `main` and push:

```bash
# Verify working tree is clean
git status

# Ensure we are on main and it is up to date
git checkout main
git pull origin main

# Create next from main
git checkout -b next

# Push next to origin
git push -u origin next
```

If `git status` shows uncommitted changes, commit or stash them before creating the branch. The `next` branch must start from a clean, committed state of `main`.
  </action>
  <verify>
    <automated>git branch -a | grep "origin/next"</automated>
  </verify>
  <acceptance_criteria>
    - `git branch -a | grep "origin/next"` returns `remotes/origin/next`
    - `git log --oneline next..main` returns 0 commits (next is at the same commit as main)
  </acceptance_criteria>
  <done>next branch exists on origin and is at the same commit as main</done>
</task>

<task type="auto">
  <name>Task 2: Add ## Git Workflow section to CLAUDE.md</name>
  <files>
    CLAUDE.md
  </files>
  <read_first>
    - CLAUDE.md — read in full to understand the current sections and where to append the Git Workflow section (should go near the end, before or after the graphify section)
    - flow.md — read to ensure the summary is accurate
  </read_first>
  <action>
Append a `## Git Workflow` section to CLAUDE.md. Place it before the `## graphify` section (or at the end if graphify is last). The content must be accurate enough that a Claude instance reading CLAUDE.md knows the correct branching base without needing to read flow.md:

```markdown
## Git Workflow

Grimoire uses a `main` / `next` / `feature/*` branching strategy. Full specification: `flow.md`.

**Branches:**
- `main` — production-ready; matches the current stable build
- `next` — integration branch for the upcoming release; always ahead of or equal to main
- `feature/*` — short-lived; always branched from `next`, never from `main`

**Starting any new task:**
```bash
git checkout next
git pull origin next
git checkout -b feature/your-feature-name
```

**Merging a completed feature:**
```bash
git checkout next
git merge --no-ff feature/your-feature-name
git push origin next
git branch -d feature/your-feature-name
```

**Rule:** Never branch from `main` for feature work. Always branch from `next`.
```
  </action>
  <verify>
    <automated>grep -n "## Git Workflow" C:/Users/lamonta/Code/grimoire/CLAUDE.md</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "## Git Workflow" CLAUDE.md` returns 1 line
    - `grep -n "Always branch from" CLAUDE.md` returns 1 line
    - `grep -n "feature/\*" CLAUDE.md` returns at least 1 line
    - `grep -n "flow\.md" CLAUDE.md` returns at least 1 line (references the spec)
  </acceptance_criteria>
  <done>CLAUDE.md contains ## Git Workflow section with branching rules and reference to flow.md</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Task 1 created the `next` branch from main and pushed it to origin.
    Task 2 added a `## Git Workflow` section to CLAUDE.md.
  </what-built>
  <how-to-verify>
    1. Run: `git branch -a | grep next` — should show `remotes/origin/next`
    2. Run: `git log --oneline main..next` — should return empty (branches are in sync)
    3. Open CLAUDE.md and scroll to the `## Git Workflow` section — confirm it contains the branching rules and references flow.md
    4. Optionally: visit the repository on GitHub/GitLab and confirm the `next` branch is visible
  </how-to-verify>
  <resume-signal>Type "approved" to continue, or describe any issues</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Git remote | Push to origin requires valid authentication |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01F-01 | Tampering | next branch created from dirty working tree includes uncommitted changes | mitigate | git status checked before branch creation; only proceed from clean state |
</threat_model>

<verification>
After all tasks and checkpoint:

1. `git branch -a | grep "origin/next"` returns `remotes/origin/next`
2. `grep -n "## Git Workflow" CLAUDE.md` returns 1 match
3. `grep -n "Always branch from" CLAUDE.md` returns 1 match
</verification>

<success_criteria>
- `next` branch exists on origin at the same commit as `main`
- CLAUDE.md `## Git Workflow` section explains branching rules and references flow.md
- Future Claude instances will know to branch from `next`, not `main`
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation-security-bugs-debt/01-F-SUMMARY.md`
</output>
