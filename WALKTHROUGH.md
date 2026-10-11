# Kanban walkthrough

A guided tour of the `kanban` plugin: set up a board in a scratch project, plan a card, let Claude build and merge it, meet a gate, and try the other chat verbs. Each step says what to do and what you should see. If you are an agent asked to run this tour for someone, do the steps in order and show them each "You should see" block next to what really happened.

What you need (versions, git, Node.js, what Auto does): `README.md`, section "Before you start". Install the plugin first (`README.md`, section "Install"), or load it from a clone (`README.md`, section "Dev loop").

Your output will differ from the examples in small ways. It shows your own name, your own dates and times (written `<date> <time>` below), your own commit hashes (`<hash>`) and whatever wording the planning agent picks for a plan. Card IDs below are `<ID>` (for example `KB-0004`) and `<n>` is the ID number without padding. Match the shape, not the exact text. Quoted messages in `backticks` that come from the skill or the pane are exact.

## 1. What you are looking at

- Each card is one markdown file in a `kanban/` folder inside your project.
- The lane a card sits in is one line of that file: `status:`.
- Dragging a card in the pane edits that line. A drop on a lane Claude acts on (Plan, Auto) also starts a Claude turn. Saying "move KB-1 to Auto" in chat does the same.
- Claude, in your session, is the manager. It reads the cards, sends planning and work to agents, reviews what they return and commits. It never writes a plan or project code itself.
- Workers are subagents the manager starts. They edit the code and run the checks.

## 2. The lanes

In board order. "Who" is who may move a card in.

| Lane | Who | What happens |
|---|---|---|
| Needs You | Claude only | Holds everything that waits on you: a plan to approve, a question, a failure, or one held action (flag `GATE: ...`). Drag a held action out to Auto to approve it. If you drop a card here it bounces back. |
| Pending | you or Claude | Nothing. New cards and Claude's own suggestions land here. No turn starts. Drag a card on to Auto or Backlog. |
| Plan | you | A planning agent writes a numbered plan and Claude puts it into the card, sets the flag `PLAN READY`, moves the card to Needs You, stops. |
| Auto | you | Claude runs the card start to finish: branch, workers, a commit per step, merge, Done. Drag a running card out to Pending or Backlog to pause it. |
| Backlog | you or Claude | Ideas that may or may not be done. Nothing happens to a card here. No turn starts. |
| Done | Claude or you | Finished. If you drop a card here, Claude Logs it and reports any unmerged work. |
| Discarded | you | Abandoned. Claude Logs it and names the branch for you to delete. It deletes nothing. |

Every lane is a full-width row you can fold: press its bar (the `▾` or `▸`, the name and the count) to fold or open it. A lane with no cards is one quiet line with its name. A board made earlier may still list Manual, Parked or Gated lanes. It loads and works, but the default board has none of them.

Flags show on a card as a badge:
- `PLAN READY`: the plan waits for your OK (in Needs You).
- `QUESTION: ...`: Claude needs an answer first (in Needs You). Comment, then drag the card on.
- `FAILED`: a step failed four times (in Needs You).
- `GATE: <reason>`: the held action (in Needs You).

What the pane shows about work in progress:
- A card with a plan has a bar of blocks and a count, like `5/7` (steps done of steps). A card a worker is on says `● Working`, and the line under the bar says which step.
- A card whose turn is queued says `○ Waiting to start`.
- A lane's bar says `● 1 working` or `2 need you` on its right.
- The header says `Claude is on <ID>` (or `Claude is idle`) and, when something waits on you, `◆ 3 need you`. Press it to open the first waiting card.

## 3. Start from the demo project

The tour starts from a small demo project: a git repo with one commit, a ready board and three sample cards. Make it with the script in this repo (you need a clone of it). `<path-to-your-clone>` is the folder you cloned, `<folder>` a new folder name:

```
node <path-to-your-clone>/tools/make-demo.mjs <folder>
```

It needs Node.js (see `README.md`, "Before you start"). It only creates files inside `<folder>`; the script lives in `tools/make-demo.mjs`.

No clone, or no Node.js? Make the project by hand instead: an empty git repo with one commit. These lines work in PowerShell and in bash or zsh, and make one new folder and one commit (they remove nothing). The commit matters: Auto makes its branch from your default branch, so that branch needs a commit.

```
mkdir hello-board
cd hello-board
git init -b main
git commit --allow-empty -m "Initial commit"
```

If the commit says it does not know who you are, run `git config user.name "<your git name>"` and `git config user.email "<you@example.com>"` in that folder, then repeat the commit.

Card numbers: on this hand-made repo your first card is `KB-0001`. With the demo, the three samples take `KB-0001` to `KB-0003`, so a card you add yourself is `KB-0004`.

Now start a new session in the project folder: in the Claude Code desktop app, the Code tab with that folder chosen. Sessions open before the plugin was installed do not have it. Then check:
- Type `/`. The menu lists `kanban:kanban`.
- Type `/board`. With the demo, the pane opens on the board. On the hand-made repo it says `There is no kanban/board.md in this project.` with a `Set up a board` button. Once a project has a board, a `Board` chip also shows above the chat box while the pane is closed; pressing it opens the pane the same way.

If `kanban:kanban` is missing, quit the desktop app and reopen it, then start a new session. The skill also starts on its own when you say "set up the kanban board", "add a card", "move KB-1 to Auto", "what's next", "list the board" or "decide".

## 4. Set up the board

Skip to the pane tour below if you made the demo: its board is already set up. Saying `set up the kanban board` there only answers `Board already set up (3 cards)`.

On the hand-made repo, type: `set up the kanban board`. Claude takes the first word of your git name as the owner and asks:
```
Whose board is this? I'll use <your git name> unless you say otherwise
```

Type your first name. Claude replies:
```
Board ready for <you>: Needs You, Pending, Plan, Auto, Backlog, Done, Discarded.
```

(The `Set up a board` button in the pane sends the same request.) Two files appear in `kanban/`: `board.md` and `DECISIONS.md`. Nothing is committed yet. Say it again and Claude replies `Board already set up (0 cards)`.

`kanban/board.md` as the setup writes it:
```
---
prefix: KB
next_id: 1
owner: <you>
lanes:
  - Needs You (needs-you)
  - Pending (intake)
  - Plan (plan)
  - Auto (auto)
  - Backlog (backlog)
  - Done (done)
  - Discarded (scrapped)
---
# Board notes

Free text.
```

`next_id` is the number the next card gets. `lanes:` is the board order; the word in brackets is the lane's role. A setting you change in the pane adds one line above `lanes:`.

The pane shows the header (`Claude is idle`, the `Board` and `Settings` tabs, when it last changed), the toolbar and the lanes (picture: `docs/design/real-pane-board-with-menu.png`):

![The board pane with a card's menu open](docs/design/real-pane-board-with-menu.png)

- `New card`: opens a `What needs doing?` field with a `Lane` list (pick where the card goes), `Add` and `Cancel`. Enter also adds. The pane writes the card file itself. If the lane is one Claude acts on (Plan or Auto), a Claude turn starts for it; in Pending nothing runs.
- `Find a card`: type to show only the cards that match; `Clear` empties it. If nothing matches the pane says `No card matches "zzzz"` with another `Clear` (picture: `docs/design/real-pane-find-none.png`). Enter opens the first match.
- `Sort`: `Your order`, `Newest first`, `Oldest first`, `Recently changed`, `Title A to Z`, `Label A to Z`, `Needs you first`. A sort changes no card file. You can only drop a card between two others while it is `Your order`.
- `Collapse all` / `Expand all`: folds or opens every lane (picture: `docs/design/real-pane-all-folded.png`). A line like `3 cards` counts what is shown.
- Each card is a flat row: its ID, its title and a `⋯` button. Press the row to open the card. Press the `⋯` to show a small menu under the card: `Open card`, `Copy ID` and `Delete card…` (which asks `Delete it` or `Keep it`).

The Settings tab (picture: `docs/design/real-pane-settings.png`) has `Workers at once`, and a `Model` and a `Thinking` list for each of four roles (Manager, Planner, Worker, Advisor), each with its default and a `Reset` button.

![The Settings tab](docs/design/real-pane-settings.png)

Each Thinking list marks the level the app recommends for the role's model; changing a role's model does not change its thinking. `Restore all defaults` asks `Restore` or `Keep`. `Save as defaults` makes the current settings this board's own defaults at once (`Saved as your defaults.`): each row's default, its `Reset` and `Restore all defaults` then use them, and no other board changes. `Restore original defaults` (shown only when the board has saved defaults) asks `Remove your saved defaults and put every setting back to the original?` with `Restore` or `Keep`. The shipped defaults are Workers 2; Manager opus, medium; Planner opus, high; Worker sonnet, medium; Advisor fable, high. The controls write to `board.md`:
- `workers`: how many agents the manager runs at once, planning agents and step workers together. Default 2.
- `manager_model`: the session's own model. Default opus, medium. Changing it runs `/model` for you, or tells you to run it.
- `planner_model`: what the planning agents run on. They write the plans; the manager reviews each plan and writes it into the card. Default opus, high.
- `worker_model`: what each worker runs on. Default sonnet, medium.
- `advisor_model`: consulted when the same failure happens twice. Default fable, high.

## 5. Plan a card and let Claude run it

**Before the first drag to Auto, know what it does.** Auto is the go-ahead for Claude to make a branch, edit your files, commit each step and merge the branch into your default branch, with subagents on the models in Settings (this uses your Claude usage). That is why this tour uses a scratch project. The full list is `README.md`, section "What Auto does on its own". Plan is gentler: it only writes a plan into the card and waits.

**Pick a card.** With the demo, use one of the three sample cards in Pending (the first, `KB-0001`, is the simplest). On the hand-made repo, or if you would rather use your own, add one. In chat, type:
```
add a card: Hello world app. A tiny Python program, hello.py, that prints Hello, world and a test that checks it. Keep it to one file plus the test.
```

Claude replies `<ID> added to Pending: Hello world app`. Or press `New card` in the pane, type `Hello world app` in `What needs doing?` and press `Add`: the card shows in Pending at once. The pane way leaves the body empty for a short title; text longer than 120 characters becomes the body, with the title cut at a word and ended with `…`, and the toast says the full text is in the card. The file is `kanban/<ID>-hello-world-app.md` with `status: Pending` and one Log line: `<date> <time> <you>: created in Pending`.

**Plan it.** Press on the card in the pane, move to the Plan lane, let go (while you drag, the lane under the pointer says what the drop will do, such as `→ Drop and Claude writes a plan.`). Or type `move <ID> to Plan` (for example `move KB-1 to Plan`), or open the card and pick Plan in its `Lane` list. The card jumps to Plan. Your chat gets a message that looks like you typed it:
```
Kanban: <you> moved <ID> "<title>" from Pending to Plan. Do the plan lane action from the kanban skill.
```

A planning agent writes the plan, Claude reviews it, puts it in the card and replies in one line, like `<ID> planned: 2 steps, waiting in Needs You.` The card is now in Needs You with the badge `PLAN READY`. Open the file. The plan is in it, one numbered step per line, each naming the files it touches and how it is checked (the wording is the planning agent's, this is the shape):
```
## Plan
1. <what to build>. Files: <files>. Check: <command that proves it>.
2. <what to build>. Files: <files>. Check: <command that proves it>.

## Log
- <date> <time> <you>: created in Pending
- <date> <time> <you>: moved Pending -> Plan
- <date> <time> Claude: moved Plan -> Needs You
```

A plan can end with a "To settle when you approve" list: questions with the answer Claude will assume, in brackets. If one is wrong, say so with `comment on <ID>: ...` before you approve.

**Run it.** Not happy with the plan? Type `comment on <ID>: ...`, then drag the card back to Plan. Happy? Drag the card from Needs You to Auto. Claude does the Auto flow:
1. Clears `PLAN READY`, makes the branch `kb-<n>-<slug>` from your default branch (`main` if there is no `origin/HEAD`), writes it in `branch:`.
2. Starts one worker per plan step. The card shows `●` and the status line says `1 of 1 worker running`.
3. Reviews each worker's diff, then commits that step on the branch.
4. Checks the changed files for a gate (section 6). An ordinary source file and its test hit none.
5. Merges. With no GitHub remote it is a local merge into the default branch. With a GitHub remote and a signed-in `gh` it opens a pull request and squash-merges it.
6. Moves the card to Done and commits the board.

Expect the normal permission prompts for Edit, Write and Bash. The `Kanban:` message arrives as your own words, so nothing is pre-approved. Approve them.

The card's Log when it finished has this shape:
```
- <date> <time> <you>: created in Pending
- <date> <time> <you>: moved Pending -> Plan
- <date> <time> Claude: moved Plan -> Needs You
- <date> <time> <you>: moved Needs You -> Auto
- <date> <time> Claude: started: kb-<n>-<slug>
- <date> <time> Claude: step 1 done: <what>
- <date> <time> Claude: step 2 done: <what>
- <date> <time> Claude: merged kb-<n>-<slug>
- <date> <time> Claude: moved Auto -> Done
```

A worker may add a free comment between these, for example when a check tool is missing and it used another. The card file has `status: Done` and `branch: kb-<n>-<slug>`. Check the work itself: for the hello world card, `python hello.py` in the project folder prints `Hello, world`. The git history (`git log --oneline --graph`) has this shape, with your hashes and your default branch name:
```
* <hash> <ID> board: done
*   <hash> <ID> <card title>
|\
| * <hash> <ID> step 2: <what>
| * <hash> <ID> step 1: <what>
|/
* <hash> Initial commit
```

## 6. A gate

Some changes are held for your approval instead of being merged. Make one on purpose with a card that asks for a new dependency. If the board has a sample card that asks for one, use it. Otherwise add one in chat:
```
add a card: Add a dependency. Add one small third-party package to this project's dependency file (requirements.txt for Python, package.json for Node) and use it in one place.
```

Drag it from Pending straight to Auto. Auto writes its own plan first (a card with no plan is planned inside the Auto flow, without stopping at `PLAN READY`), makes the branch, and the workers add the dependency file and the code. Before the merge, Claude lists the changed files. A requirements file, `package.json` or a lockfile is a dependency manifest, so Claude stops and moves the card to Needs You with the flag `GATE: merge touches <that file>` (for example `GATE: merge touches requirements.txt`). The Log has this shape:
```
- <date> <time> <you>: created in Pending
- <date> <time> <you>: moved Pending -> Auto
- <date> <time> Claude: started: kb-<n>-<slug>
- <date> <time> Claude: step 1 done: <what>
- <date> <time> Claude: step 2 done: <what>
- <date> <time> Claude: GATE: merge touches <manifest file>
- <date> <time> Claude: moved Auto -> Needs You
```

If your card did not gate, its plan did not change a manifest file; read the Log and the branch's changed files (`git diff --name-only <default branch>...<branch>`) and see the list below.

Other gates: auth, login, secret or deploy paths, `.env*`, workflows, a `Dockerfile`, more than 15 files, a deploy or a destructive step (full list: "Gates" in `skills/kanban/references/lanes.md`).

**What your drag does.** Drag the card from Needs You to Auto. That approves the one held action and nothing else. Claude Logs `started: kb-<n>-<slug>`, then `approved: GATE: merge touches <manifest file>`. It clears the flag and merges the branch into your default branch. It Logs `merged kb-<n>-<slug>`, moves the card to Done and commits the board as `<ID> board: done`. Dropping a card into Needs You yourself does not work: that lane says `Claude's lane. You can't drop here.`

Until you approve, the branch has its commits and is not merged: on your default branch the project is unchanged, and `git status` shows one change, the card file, not committed. That is expected.

## 7. The other verbs, in chat

You type the phrase. Claude edits the card files and replies in one or two lines.

- **List.** `list the board`. Each lane as `Lane (n)`, its cards under it as `ID title [flag]`. With a gated card waiting and one card Done it looks like this:
```
Needs You (1)
  <ID> Add a dependency [GATE: merge touches <manifest file>]
Pending (n)
  <ID> <title>
Plan (0)
Auto (0)
Backlog (0)
Done (1)
  <ID> Hello world app
Discarded (0)
```

- **What's next.** `what's next`. Three headings, each item as `ID title [flag]`; an empty one says `none`:
```
Queued for Claude
  none
Waiting on you
  <ID> Add a dependency [GATE: merge touches <manifest file>]
Untriaged
  <ID> <title>
```

- **Move.** `move KB-1 to Auto`. Claude replies `KB-0001 moved Pending -> Auto.`, then runs the lane's action. It is the same go-ahead as a drag. `Needs You` is refused: `"Needs You" can only be entered by Claude (it holds a question, a plan to approve or a held action). Nothing was changed.` An unknown lane gets `Unknown lane "Nowhere". Lanes on this board: Needs You, Pending, Plan, Auto, Backlog, Done, Discarded. Nothing was changed.`
- **Comment.** `comment on KB-1: waiting on Sam`. Reply `Comment added to KB-0001.` It adds the Log line `<you>: waiting on Sam`. The lane does not change.
- **Decide.** `decide: Python for the sample app, because it needs no build step`. Reply `D1 recorded: Python for the sample app`. The line in `DECISIONS.md`:
```
- **D1 (<date>) Python for the sample app:** <the decision>. Reason: it needs no build step.
```

If you give no reason, Claude asks once. To change a decision, say so; a new line ends `Supersedes D1.` and the old line stays.

- **Backlog.** `move KB-3 to Backlog`. Claude replies `KB-0003 moved Pending -> Backlog.` and does nothing else. The card waits there, and `what's next` does not list it.
- **Pausing.** `move KB-3 to Pending` (or Backlog) while Auto is running it. Claude stops at the next safe point, commits no work in progress, Logs `stopped at step <n>`, keeps the flag and branch, and commits the board as `KB-0003 board: stopped`.
- **Discarded.** `move KB-3 to Discarded`. Claude stops, Logs `scrapped at step <n>; branch <branch>, PR <pr or none> left for you to close`, and replies with the branch and PR for you to delete. It deletes nothing.

## 8. The open card

Press a card (or choose `Open card` in the menu under its `⋯`) and the pane shows that card alone:
- Top row: `◂ Board` goes back to the lanes. `◂ Prev`, a count like `4 of 32`, and `Next ▸` step through the cards in board order.
- The title, with `Rename` (opens a `Card title` field with `Save` and `Cancel`) and `Copy ID` (puts the ID on the clipboard and shows `Copied <ID>.`).
- A status box when Claude is on the card: `Working`, the step, the bar of blocks and `5 of 7 steps done`, the last Log line, the branch and pull request.
- `Lane`, `Model` and `Thinking`. `Lane` moves the card, with the same effect as a drag. `Model` and `Thinking` set a model and thinking level for this card alone; they replace the Planner and Worker settings for that card and nothing else. `Auto` means the Settings values apply.
- `Plan`: one line per step, marked done, current or to do. `Show details` draws every step in full; `Hide details` puts it back.
- `Description`, then `Log`: a `Write a comment for Claude` field with a `Comment` button, and the Log lines, newest first.
- `Delete card…` at the bottom asks `Delete <ID>? This removes the card and its log.` with `Delete it` and `Keep it`.

## 9. Watch the board in Obsidian

Status: experimental. The `Board.base` file and the pane's handling of a move made in Obsidian are covered by tests, but this section has not yet been tried in a real Obsidian; what follows is what should happen, read from Obsidian's behaviour.

Obsidian 1.14 or later (read from 1.14.4) can show the board as a Kanban view of one file, `kanban/Board.base`, with no plugin. A drag there should change only the card's `status:`; the pane should then add the Log line `moved A -> B in Obsidian`. By design a drag cannot place a card between two others, a card whose `flag:` holds a colon (such as `GATE: ...` or `QUESTION: ...`) cannot be dragged there, and whether empty lanes show as columns is unknown (details in `docs/obsidian.md`).

The simplest setup is to make your project folder the vault:
1. In Obsidian choose "Open folder as vault" and pick the project folder (the one that holds `kanban/`). Obsidian adds a `.obsidian/` folder there; add `.obsidian/` to the project's `.gitignore`.
2. In a session in that project say `set up the Obsidian view`. Because the vault is the project, Claude writes the file without asking and replies `Obsidian view written: kanban/Board.base. Open it in Obsidian 1.14 or later; a card dragged there changes only its status.` It does not commit. Say it again after you add or rename a lane.
3. In Obsidian open `kanban/Board.base`. Drag a card to another column; its `status:` should change. Whether Obsidian rewrites the card file as `docs/obsidian.md` predicts has not been confirmed on a real drag.

If your vault is somewhere else, link the project's `kanban/` folder into it (a folder shortcut, so the files stay in the project): on Windows in cmd.exe, `mklink /J "<vault>\<project>" "<project folder>\kanban"`; on macOS or Linux, `ln -s "<project folder>/kanban" "<vault>/<project>"`. Each makes one link and removes nothing. Then `set up the Obsidian view` asks `What is the path of this kanban folder inside your Obsidian vault?`; answer `<project>`. To remove the link later, on Windows `rmdir "<vault>\<project>"` in cmd.exe, elsewhere `rm "<vault>/<project>"`. That deletes only the link, not the cards.

## 10. The MCP server

The plugin also starts an MCP server, so any agent (Claude, Gemini CLI) can list, add and move cards without the pane. It edits only the card files and starts no work. Tools, the Gemini setup block and the end-to-end check are in `README.md`, section "MCP server". In a session, `/mcp` shows `kanban` connected.

## 11. Where everything lives

In your project:
```
kanban/board.md                      settings and lanes
kanban/DECISIONS.md                  one line per decision
kanban/<ID>-<slug>.md                one file per card
```

The plugin, `<path-to-your-clone>`:
```
.claude-plugin/   plugin.json, marketplace.json
skills/kanban/    SKILL.md; references/format.md (the file format); references/lanes.md (lane rules, gates)
hooks/            register.tsx (/board, settings, refresh), board.tsx (the lanes and the drag), ui/ (header, toolbar, open card, Settings), lib/ (card parser)
mcp/              the MCP server
tools/            make-demo.mjs (the demo project), capture-pane.ps1 (a screenshot of the pane)
docs/             obsidian.md, design/ (the pictures)
tests/            what `claude plugin test` runs
```

Change the board by editing `kanban/board.md` in any editor, or use the Settings tab. The full rules are in `skills/kanban/references/format.md`.
- Settings: `workers` is 1 to 5. Models are `haiku`, `sonnet`, `opus`, `fable`; `advisor_model` can also be `none`. `planner_model` is never `none`.
- Add a lane: a new line under `lanes:` as `Label (role)`. A label is one or two words, letters and digits only. The roles are `intake`, `plan`, `needs-you`, `auto`, `backlog`, `done`, `scrapped` (an older board may also have `manual`, `parked` or `gated`; see `skills/kanban/references/lanes.md`). Behaviour follows the role, not the label.
- Rename a lane: ask Claude. Do not change a label by hand, or the cards' `status:` lines no longer match. Claude edits every card in that lane.

When you are done with the scratch project, delete its folder. That removes the card files, the branches stay inside it, and nothing else on your machine is touched.
