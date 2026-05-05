This document outlines a streamlined Git workflow designed for a solo or small-team environment. It balances the need for stable production builds with the flexibility of batching features and handling emergency fixes.

## 1. Branching Strategy

| Branch      | Purpose                                                  | Stability          |
| :---------- | :------------------------------------------------------- | :----------------- |
| `main`      | Production-ready code. Matches the current stable build. | **Highly Stable**  |
| `next`      | Integration branch for the _upcoming_ release.           | **Beta / Testing** |
| `feature/*` | Short-lived branches for specific tasks or bugs.         | **Experimental**   |

---

## 2. The Development Lifecycle

### Step 1: Starting a Task

Always branch from `next` to ensure you are working on top of the most recent planned changes.

```bash
git checkout next
git pull origin next
git checkout -b feature/your-feature-name
```

### Step 2: Committing with Intent

Use issue-closing keywords in your commit messages to automate your workflow.

Example: `git commit -m "Implement Tiptap editor for vault notes (fixes #45)"`

### Step 3: Merging to "Next"

When a feature is complete and tested locally, merge it into the next branch. This acts as your staging area where you can batch multiple features together.

```bash
git checkout next
git merge --no-ff feature/your-feature-name
git branch -d feature/your-feature-name
```

### Step 4: Creating a Release

Once next contains a satisfactory batch of features and is stable, promote it to main.

```bash
git checkout main
git merge --no-ff next
git tag -a v0.22.3 -m "Release 0.22.3: Summary of changes"
git push origin main --tags
```

## 3. The Hotfix Protocol

Use this path when a critical bug is found in the current build (main) that cannot wait for the features currently in next.

1. Branch from main:
   `git checkout -b hotfix/critical-bug-name main`

2. Fix and Merge to main:
   Merge back to main, tag a new patch version (e.g., v0.22.4), and push.

3. The Back-Port (Crucial):
   Immediately merge main into next to ensure the fix is included in the next planned release and doesn't get overwritten.

```bash
git checkout next
git merge main
git push origin next
```

## 4. Integrated Issue Management

#### Milestones:

- Create a Milestone in your tracker (e.g., "v0.23.0") for every planned release.

- Assign issues to these milestones to track progress toward a build.

#### Status Indicators

- Issue Open: Work not yet started or in a feature/ branch.

- Issue Open + Link to Commit: Feature is merged into next (using fixes #ID keywords).

- Issue Closed: next has been merged into main. The fix is now in production.

**Rule:** Never branch from `main` for feature work. Always branch from `next`.
