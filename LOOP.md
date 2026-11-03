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

## Backlog

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
- [ ] **3b. GitHub sync.** Optional: the CEO connects a private data repo with a fine-grained token stored only on that device; the app saves and loads all data there, so laptop, phone and desktop app share projects. Clear status (last synced, conflicts: newest wins, with a warning).

### 4. Rulebooks inside the app
- [ ] **4a. Rulebooks and product brief saved in the repo** as Markdown (`rulebooks/`), exported from Claude Docs.
- [ ] **4b. Rulebook reader** inside the app: each department's "Rulebook" menu item opens it in the app, with a contents list and search.

### 5. Final check
- [ ] **5a. Full QA pass** across every page on desktop and phone, light and dark; fix what's found; update the README.

## Log

- 2026-11-03: Loop set up. App, desktop installers and website live.
