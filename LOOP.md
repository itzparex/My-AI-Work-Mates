# Build loop: My AI Work Mates

The loop works through this backlog one item per round, top to bottom, and stops when every box is ticked.

## Rules for every round

1. Take the **first unticked item**. Do only that item.
2. Build it in the existing style (same colors, fonts, light/dark, phone layout) and keep all existing features working.
3. Free only: no paid services, no API keys that cost money.
4. Respect the agency rules: the CEO is the only person; work mates never publish, send, spend or contact anyone; only the CEO overrides guardrails; the Project Director logs every issue.
5. Test before pushing: `node tests/smoke.js` must pass (every page loads on desktop and phone with no errors). Look at screenshots of the new screens.
6. Commit with a clear message, push to `main`, and confirm the "Build desktop app" run succeeds.
7. Tick the item, add one line to the log at the bottom, and tell the CEO what changed in two sentences.
8. If something needs the CEO (a decision, an account, a file), stop and ask instead of guessing.
9. Record every round, including rounds that stop early, skip or fail, before the last push: `node tools/record-run.js --agent "Build loop" --result success|failure|skipped --started <when the round began, UTC> --summary "<item and what changed>" --produced <item id> --commit <short hash>`. Add `--tokens-in`/`--tokens-out` (or `--tokens`) only when the session reports its token use; never guess. This updates `runs/runs.json`, which the CEO page reads.

## Backlog

### 0. CEO command center (do first: this is the CEO's main page)
- [x] **C1. CEO page becomes the home page and looks great.** Opening the app lands on the CEO command center (the current home merges into it). Use the frontend-design skill and aim for a polished, premium look in light and dark, on desktop and phone. Top to bottom: a greeting with today's date and one-line status ("3 decisions need you · 1 project at risk"); decisions waiting, with Allow / Disallow / Allow with a note; project health cards (progress, next step, due date, at-risk flag); a work mates strip (each work mate's status, current task, last run, Auto-work state once W1b exists); a "Claude" panel (see C2); open issues; this week's summary.
- **C2. Claude panel on the CEO page.** Everything about the CEO's Claude in one place, honestly labeled. Split into:
  - [x] **C2a. Plan usage and quick links.** The CEO notes the percentage used and reset time from Claude's usage page in one tap (with quick "resets in…" buttons); the panel shows a usage ring, the reset time, "last updated" (flagged when over a day old), a small history of readings, and quick links to the Claude usage page, scheduled tasks, every rulebook and the product brief, the GitHub repo, the build backlog and Releases. "Claude" added to the CEO submenu.
  - [x] **C2b. Run records.** Each scheduled run (the build loop now, every work mate later) records its own result in the repo (what ran, when, success or failure, what it produced, token use when known), so the panel shows the build loop's and each work mate's last and next run, and agent token use (feeds into W8).
  - [x] **C2c. Optional browser read of plan usage.** When the CEO's computer and Claude desktop app are on, an optional step reads the CEO's own usage page and saves the number with the time it was read (shown as "read automatically" vs "noted by CEO").

### 0½. Desktop app updates itself
- **D1. Automatic updates for the desktop app.** Split into:
  - [x] **D1a. App content from the live website.** The desktop app loads the live website (https://itzparex.github.io/My-AI-Work-Mates/), so every change the loop pushes appears in the desktop app at once, with the same refresh bar as the website. If the computer is offline, it falls back to the last saved copy, then the copy built into the app. Saved data keeps working (pages stay on the app:// origin, so nothing moves and nothing is lost).
  - [ ] **D1b. The app updates itself on Windows and Linux.** electron-updater against the GitHub Releases files: check at startup and every few hours, download in the background, then show "Restart to update" (never restart without asking). The build sets a rising version number on every build (for example 1.0.<run number>) and publishes the update files (latest.yml and others) with the installers. Needs a change to .github/workflows/desktop.yml.
  - [ ] **D1c. Mac update notice and README.** On Mac (no paid code signing), show "A new version is available" with a Download button that opens the Releases page. Update the README install section, and confirm the Actions run still builds all three installers.

### 1. Full department dashboards
- [ ] **1a. Research & Strategist.** Research brief with the question bank (new product: mine competitors; existing product: use our data). Each of the nine documents opens as a structured editor with its required sections. Evidence ledger IDs can be picked from inside the documents. A Marketer's Booklet builder assembles the Booklet from the documents.
- [ ] **1b. Copywriter.** Copy map editor: one block per page section (from the wireframe), in page order, with versions. Claims check flags any claim whose ledger entry is "Do not use" or grade C/D. Alt text and image words for the Graphic Designer.
- [ ] **1c. Graphic Designer.** Carousel planner with the nine standard slides (job, words from the copy map, proof IDs, alt text, auto file name). Image size and format guide. AI image approvals create a CEO decision and record the outcome.
- [ ] **1d. Shopify Developer.** Build tracker with preview links and theme copy names, the QA checklist per project, backup log, and a hand-over note generator for the CEO.

### 2. Hand-offs between departments
- [ ] **2a. One shared project data model** used by every page (projects, tasks, deliverables, decisions, issues, lessons), with a safe migration of existing saved data.
- [ ] **2b. Deliverables flow.** A department submits a deliverable → its task becomes "Waiting on approval" in the Project Director's review queue → approve moves the next task to "In progress" and shows the deliverable as an input on the next department's Overview; return sends it back with comments and logs an issue.
- [ ] **2c. Gates.** Design approval and Launch approval show everything that's being approved in one view; anything needing a guardrail override becomes a CEO decision.

### 3. Free sync across devices
- [ ] **3a. Export and import** of all data as one file (backup, and a manual way to move data between devices).
- [ ] **3b. GitHub sync.** Optional: the CEO connects a private data repo with a fine-grained token stored only on that device; the app saves and loads all data there, so laptop, phone and desktop app share projects. Clear status (last synced, conflicts: newest wins, with a warning). Open pages refresh the data by themselves every few minutes and when the tab comes back into view, so new agent work appears without reloading.

### 3½. Make the work mates work
Each work mate becomes a real AI agent: Claude, on the CEO's existing subscription (no paid API keys), runs the department's rulebook against the app's shared data in the GitHub data repo from 3b. The app shows what each agent did. Agents never publish, send, spend or contact anyone, and everything goes through the Project Director to the CEO.
- [ ] **W1. Agent playbooks in the repo.** One instruction file per work mate (`agents/<department>.md`): what it reads from the app data, the rulebook steps it follows, what it writes back (deliverable, task status, issues), and when it must stop and ask. Plus a Project Director playbook that reviews submitted work against the department checklist.
- [ ] **W1b. Auto-work switch (CEO only).** On the CEO dashboard, one main switch, "Auto-work: On / Paused", plus an On/Paused switch per work mate, also shown on each department page. Saved in the shared app data so every device and every agent sees it. Every playbook checks the switch first: when paused, scheduled runs do nothing and only log "Skipped: paused by CEO"; a "Run now" started by the CEO still works. The header shows a clear "Auto-work paused" badge while paused. Turning it back on resumes from where each agent stopped. Every change is recorded with date and time.
- [ ] **W2. Research work mate, end to end.** From a CEO brief in the app, it produces real research documents with free sources only, fills the evidence ledger with sources and grades, creates person tasks for anything it can't reach, and submits the Booklet for Project Director review. Proven on one real project.
- [ ] **W3. Project Director agent.** Reviews submitted deliverables, approves or returns them with comments, logs issues and lessons, and adds anything needing the CEO to the decisions list.
- [ ] **W4. Copywriter work mate:** a copy map from the approved Booklet, with the claims check.
- [ ] **W5. Graphic Designer work mate:** a carousel plan and image briefs from the approved copy. Image generation only with free tools; AI product images need CEO approval.
- [ ] **W6. Shopify Developer work mate:** section code built in the Design Studio format, the QA checklist and a hand-over note. It never touches the live store; the CEO publishes.
- [ ] **W7. "Run" buttons and schedules.** From each department page the CEO can copy a one-line command to run that work mate now, or set it on a schedule. The app shows each agent's last run, what it produced, and anything waiting on the CEO.
- [ ] **W8. Token usage dashboard (CEO).** Every agent run (and every build loop run) records its token use at the end (input, output, total, from the session's own usage report) into the shared data, with agent, project, task and date. A "Usage" page on the CEO dashboard shows:
  - A **budget meter** at the top: tokens used this week against a weekly budget the CEO sets, with the percentage, a projection ("at this pace you'll hit the budget on Friday") and the date of the next reset the CEO sets.
  - A **stacked bar chart by day**, one color per work mate, with a 7-day / 30-day toggle and hover details.
  - A **per-agent table**: runs, total tokens, average per run, tokens per approved deliverable (efficiency), a 7-day trend sparkline, and its own budget.
  - **Alerts and auto-pause:** a warning at 80% of a budget; at 100% that agent is paused through the Auto-work switch (W1b) and a CEO decision is created to raise the budget or keep it paused.
  - **Available allowance:** Claude doesn't share a remaining-tokens number with apps, so the page shows the CEO's own budget remaining, plus a link to the Claude usage page and a box to note the plan's current percentage used and reset time.

### 4. Rulebooks inside the app
- [ ] **4a. Rulebooks and product brief saved in the repo** as Markdown (`rulebooks/`), exported from Claude Docs.
- [ ] **4b. Rulebook reader** inside the app: each department's "Rulebook" menu item opens it in the app, with a contents list and search.

### 5. Final check
- [ ] **5a. Full QA pass** across every page on desktop and phone, light and dark; fix what's found; update the README.

## Log

- 2026-11-03: Loop set up. App, desktop installers and website live.
- 2026-11-04: Added section 3½ "Make the work mates work" (CEO approved).
- 2026-11-04: Added W1b, a CEO-only Auto-work switch to pause or resume the agents (CEO request).
- 2026-11-04: Added W8, a token usage dashboard with budgets and auto-pause (CEO request).
- 2026-11-04: Added section 0, the CEO command center as the main page with a Claude panel, to be done first (CEO request).
- 2026-11-04: Open pages now notice new versions (refresh bar, or automatic refresh when idle); 3b also refreshes data automatically.
- 2026-11-04: Added D1, automatic updates for the desktop app (CEO request).
- 2026-11-04: C1 done. The app now opens on the CEO command center (greeting and status, decisions, project health with at-risk flags, work mates, Claude panel with quick links, open issues, this week). Next: C2, the full Claude panel.
- 2026-11-04: C2 split into C2a/C2b/C2c. C2a done: the Claude panel now shows plan usage the CEO notes in one tap (ring, reset time, last updated, history) and quick links to usage, scheduled tasks, all rulebooks, repo, backlog and Releases. Next: C2b, run records.
- 2026-11-04: C2b done. Every build loop round now records itself in runs/runs.json (what ran, when, result, what it produced, tokens when reported), and the CEO page's Claude panel shows each agent's last and next run, recent runs and token use. Next: C2c, the optional browser read of plan usage. Note: the loop can't push changes to .github/workflows (GitHub refused it), so the desktop app reads run records from GitHub; D1 will need that file changed. CEO: please allow workflow edits for the Claude GitHub app, or D1's build changes will be prepared for you to apply.
- 2026-11-04: C2c done. The Claude panel can now show plan usage "read automatically" by an optional Usage reader scheduled task on the CEO's computer (setup in agents/usage-reader.md, one-tap "Copy task prompt" on the panel), next to readings "noted by CEO". Next: D1, automatic updates for the desktop app (still needs workflow edits allowed for the Claude GitHub app).
- 2026-11-04: D1 split into D1a/D1b/D1c. D1a done: the desktop app now loads every page from the live website (updates appear at once, with the refresh bar), falls back to its last saved copy and then the built-in copy when offline (with an "Offline" label), and keeps its saved data because pages stay on the app:// origin. Next: D1b, self-updating installers on Windows and Linux, which needs a change to .github/workflows/desktop.yml. CEO: please allow workflow edits for the Claude GitHub app (github.com/apps/claude, repository permissions: Workflows), or D1b will be prepared for you to apply by hand.
