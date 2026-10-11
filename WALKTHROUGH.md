# Kanban walkthrough

Every quote is from a real run in `C:\work\kanban-sandbox`. Dates and times are from that run; yours will show your clock.

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
- The header says `Claude is on KB-0024` (or `Claude is idle`) and, when something waits on you, `◆ 3 need you`. Press it to open the first waiting card.

## 3. Start a new project

Install the plugin first (`README.md`, "Install"), or load it from a clone with the dev loop (`README.md`, "Dev loop"). Sessions that were open before that do not have it. Start a new one.

In PowerShell (makes one new folder and one git commit; removes nothing). The commit matters: Auto makes its branch from `main`, so `main` needs a commit.

```powershell
New-Item -ItemType Directory -Path C:\work\hello-board
git -C C:\work\hello-board init -b main
Set-Content -Path C:\work\hello-board\README.md -Value "# hello-board"
git -C C:\work\hello-board add README.md
git -C C:\work\hello-board commit -m "Initial commit"
```

In the Claude Code desktop app, start a new session in the Code tab with `C:\work\hello-board` as its folder. Then check:
- Type `/`. The menu lists `kanban:kanban`.
- Type `/board`. The pane opens and says `There is no kanban/board.md in this project.` with a `Set up a board` button. Once a project has a board, a `Board` chip also shows above the chat box while the pane is closed; pressing it opens the pane the same way.

If `kanban:kanban` is missing, quit the desktop app and reopen it, then start a new session. The skill also starts on its own when you say "set up the kanban board", "add a card", "move KB-1 to Auto", "what's next", "list the board" or "decide".

## 4. Set up the board

Type: `set up the kanban board`. Claude takes the owner from your git name (here `J-J-E`) and asks:
```
Whose board is this? I'll use J-J-E unless you say otherwise
```

Type: `John`. Claude replies:
```
Board ready for John: Needs You, Pending, Plan, Auto, Backlog, Done, Discarded.
```

(The `Set up a board` button in the pane sends the same request.) Two files appear in `kanban/`: `board.md` and `DECISIONS.md`. Nothing is committed yet. Say it again and Claude replies `Board already set up (0 cards)`.

`kanban/board.md` as the setup writes it:
```
---
prefix: KB
next_id: 3
owner: John
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

The pane now shows the header (`Claude is idle`, the `Board` and `Settings` tabs, when it last changed), the toolbar and the lanes (picture: `docs\design\real-pane-find-none.png`):
- `New card`: opens a `What needs doing?` field with a `Lane` list (pick where the card goes), `Add` and `Cancel`. Enter also adds. The pane writes the card file itself. If the lane is one Claude acts on (Plan or Auto), a Claude turn starts for it; in Pending nothing runs.
- `Find a card`: type to show only the cards that match; `Clear` empties it. If nothing matches the pane says `No card matches "zzzz"` with another `Clear` (picture: `docs\design\real-pane-find-none.png`). Enter opens the first match.
- `Sort`: `Your order`, `Newest first`, `Oldest first`, `Recently changed`, `Title A to Z`, `Label A to Z`, `Needs you first`. A sort changes no card file. You can only drop a card between two others while it is `Your order`.
- `Collapse all` / `Expand all`: folds or opens every lane. A line like `32 cards` counts what is shown.
- Each card is a flat row: its ID, its title and a `⋯` button. Press the row to open the card. Press the `⋯` to show a small menu under the card: `Open card`, `Copy ID` and `Delete card…` (which asks `Delete it` or `Keep it`).

The Settings tab (picture: `docs\design\real-pane-settings.png`) has `Workers at once`, and a `Model` and a `Thinking` list for each of four roles (Manager, Planner, Worker, Advisor), each with its default and a `Reset` button. Each Thinking list marks the level the app recommends for the role's model; changing a role's model does not change its thinking. `Restore all defaults` asks `Restore` or `Keep`. `Save as defaults` makes the current settings this board's own defaults at once (`Saved as your defaults.`): each row's default, its `Reset` and `Restore all defaults` then use them, and no other board changes. `Restore original defaults` (shown only when the board has saved defaults) asks `Remove your saved defaults and put every setting back to the original?` with `Restore` or `Keep`. The shipped defaults are Workers 2; Manager opus, medium; Planner opus, high; Worker sonnet, medium; Advisor fable, high. The controls write to `board.md`:
- `workers`: how many agents the manager runs at once, planning agents and step workers together. Default 2.
- `manager_model`: the session's own model. Default opus, medium. Changing it runs `/model` for you, or tells you to run it.
- `planner_model`: what the planning agents run on. They write the plans; the manager reviews each plan and writes it into the card. Default opus, high.
- `worker_model`: what each worker runs on. Default sonnet, medium.
- `advisor_model`: consulted when the same failure happens twice. Default fable, high.

## 5. The hello world card

**Add it.** In chat, type:
```
add a card: Hello world app. A tiny Python program, hello.py, that prints Hello, world and a test that checks it. Keep it to one file plus the test.
```

Claude replies `KB-0001 added to Pending: Hello world app`. Or press `New card` in the pane, type `Hello world app` in `What needs doing?` and press `Add`: the card shows in Pending at once. The pane way leaves the body empty. The file is `kanban/KB-0001-hello-world-app.md` with `status: Pending` and one Log line: `John: created in Pending`.

**Plan it.** Press on the card in the pane, move to the Plan lane, let go (while you drag, the lane under the pointer says what the drop will do, such as `→ Drop and Claude writes a plan.`). Or type `move KB-1 to Plan`, or open the card and pick Plan in its `Lane` list. The card jumps to Plan. Your chat gets a message that looks like you typed it:
```
Kanban: John moved KB-0001 "Hello world app" from Pending to Plan. Do the plan lane action from the kanban skill.
```

A planning agent writes the plan, Claude reviews it, puts it in the card and replies in one line, like `KB-0001 planned: 2 steps, waiting in Needs You.` The card is now in Needs You with the badge `PLAN READY`. Open the file. The plan is in it:
```
## Plan
1. Write hello.py with a main() that prints Hello, world and runs when the file is executed. Files: hello.py. Check: python hello.py prints Hello, world.
2. Write the test that runs main() and checks the printed text is Hello, world. Files: test_hello.py. Check: pytest test_hello.py.

## Log
- 2026-10-08 02:21 John: created in Pending
- 2026-10-08 02:21 John: moved Pending -> Plan
- 2026-10-08 02:21 Claude: moved Plan -> Needs You
```

**Run it.** Not happy with the plan? Type `comment on KB-1: ...`, then drag the card back to Plan. Happy? Drag the card from Needs You to Auto. Claude does the Auto flow:
1. Clears `PLAN READY`, makes the branch `kb-1-hello-world-app` from `main`, writes it in `branch:`.
2. Starts one worker per plan step. The card shows `●` and the status line says `1 of 1 worker running`.
3. Reviews each worker's diff, then commits that step on the branch.
4. Checks the changed files for a gate. `hello.py` and `test_hello.py` hit none.
5. Merges. There is no GitHub remote, so it is a local merge into `main`.
6. Moves the card to Done and commits the board.

Expect the normal permission prompts for Edit, Write and Bash. The `Kanban:` message arrives as your own words, so nothing is pre-approved. Approve them.

The card's Log when it finished:
```
- 2026-10-08 02:21 John: created in Pending
- 2026-10-08 02:21 John: moved Pending -> Plan
- 2026-10-08 02:21 Claude: moved Plan -> Needs You
- 2026-10-08 02:22 John: moved Needs You -> Auto
- 2026-10-08 02:22 Claude: started: kb-1-hello-world-app
- 2026-10-08 02:23 Claude: step 1 done: hello.py prints Hello, world
- 2026-10-08 02:23 Claude: step 2 check: pytest is not installed here, using python -m unittest
- 2026-10-08 02:24 Claude: step 2 done: test_hello.py checks the printed text
- 2026-10-08 02:24 Claude: merged kb-1-hello-world-app
- 2026-10-08 02:24 Claude: moved Auto -> Done
```

The `step 2 check` line is a free comment: pytest was missing, so the worker used `python -m unittest`. The card file has `status: Done` and `branch: kb-1-hello-world-app`, and `python C:\work\hello-board\hello.py` prints `Hello, world`. The git history (`git log --oneline --graph`):
```
* b209495 KB-0001 board: done
*   27d7360 KB-0001 Hello world app
|\
| * 10d7db4 KB-0001 step 2: test that main prints Hello, world
| * 6718ac3 KB-0001 step 1: write hello.py
|/
* 723dd43 Initial commit
```

## 6. A gate

KB-0002 asked for a dependency: print today's date with python-dateutil, using a `requirements.txt`. One drag took it from Pending to Auto. Auto wrote its own 2-step plan and made the branch `kb-2-add-a-dependency-to-show-a-gate`. The workers added `requirements.txt` and the date line. Before the merge, Claude listed the changed files: `.gitignore`, `hello.py`, `requirements.txt`, `test_hello.py`. A requirements file is a dependency manifest. So Claude stopped and moved the card to Needs You with the flag `GATE: merge touches requirements.txt`. The Log:
```
- 2026-10-08 02:21 John: created in Pending
- 2026-10-08 02:25 John: moved Pending -> Auto
- 2026-10-08 02:25 Claude: started: kb-2-add-a-dependency-to-show-a-gate
- 2026-10-08 02:25 Claude: step 1 done: requirements.txt with python-dateutil, installed into .venv
- 2026-10-08 02:25 Claude: step 2 done: hello.py prints today's date on line two, test checks line one
- 2026-10-08 02:25 Claude: GATE: merge touches requirements.txt
- 2026-10-08 02:25 Claude: moved Auto -> Needs You
```

Other gates: auth, login, secret or deploy paths, `.env*`, workflows, a `Dockerfile`, more than 15 files, a deploy or a destructive step (full list: "Gates" in `skills\kanban\references\lanes.md`).

**What your drag does.** Drag KB-0002 from Needs You to Auto. That approves the one held action and nothing else. Claude Logs `started: kb-2-add-a-dependency-to-show-a-gate`, then `approved: GATE: merge touches requirements.txt`. It clears the flag and merges the branch into `main`. It Logs `merged kb-2-add-a-dependency-to-show-a-gate`, moves the card to Done and commits the board as `KB-0002 board: done`. Dropping a card into Needs You yourself does not work: that lane says `Claude's lane. You can't drop here.`

**The sandbox at this point**, if you followed along:
- Folder `C:\work\kanban-sandbox`, on `main`.
- KB-0001 is in Done and merged. KB-0002 is in Needs You with the flag above.
- Branch `kb-2-add-a-dependency-to-show-a-gate` has two commits (`KB-0002 step 1: add python-dateutil via requirements.txt`, `KB-0002 step 2: print today's date with dateutil`) and is not merged. On `main`, `hello.py` still prints one line.
- `git status` shows one change: the KB-0002 card file, not committed. That is expected.
- `.venv` holds python-dateutil. Leave it.

Open a new session in that folder, type `/board`, drag KB-0002 to Auto. After the merge, run this in PowerShell (runs the app, changes nothing):
```powershell
C:\work\kanban-sandbox\.venv\Scripts\python.exe C:\work\kanban-sandbox\hello.py
```

Expect two lines: `Hello, world`, then today's date.

## 7. The other verbs, in chat

You type the phrase. Claude edits the card files and replies in one or two lines.

- **List.** `list the board`. Each lane as `Lane (n)`, its cards under it as `ID title [flag]`. The sandbox now:
```
Needs You (1)
  KB-0002 Add a dependency to show a gate [GATE: merge touches requirements.txt]
Pending (0)
Plan (0)
Auto (0)
Backlog (0)
Done (1)
  KB-0001 Hello world app
Discarded (0)
```

- **What's next.** `what's next`. Three headings, each item as `ID title [flag]`; an empty one says `none`:
```
Queued for Claude
  none
Waiting on you
  KB-0002 Add a dependency to show a gate [GATE: merge touches requirements.txt]
Untriaged
  none
```

- **Move.** `move KB-1 to Auto`. Claude replies `KB-0001 moved Pending -> Auto.`, then runs the lane's action. It is the same go-ahead as a drag. `Needs You` is refused: `"Needs You" can only be entered by Claude (it holds a question, a plan to approve or a held action). Nothing was changed.` An unknown lane gets `Unknown lane "Nowhere". Lanes on this board: Needs You, Pending, Plan, Auto, Backlog, Done, Discarded. Nothing was changed.`
- **Comment.** `comment on KB-1: waiting on Sam`. Reply `Comment added to KB-0001.` It adds the Log line `John: waiting on Sam`. The lane does not change.
- **Decide.** `decide: Python for the sample app, because it needs no build step`. Reply `D1 recorded: Python for the sample app`. The line in `DECISIONS.md` (the sandbox has this one as D1):
```
- **D1 (2026-10-08) Python for the sample app:** The walkthrough's sample app is Python. Reason: it needs no build step and pytest is one command.
```

If you give no reason, Claude asks once. To change a decision, say so; a new line ends `Supersedes D1.` and the old line stays.

- **Backlog.** `move KB-3 to Backlog`. Claude replies `KB-0003 moved Pending -> Backlog.` and does nothing else. The card waits there, and `what's next` does not list it.
- **Pausing.** `move KB-3 to Pending` (or Backlog) while Auto is running it. Claude stops at the next safe point, commits no work in progress, Logs `stopped at step <n>`, keeps the flag and branch, and commits the board as `KB-0003 board: stopped`.
- **Discarded.** `move KB-3 to Discarded`. Claude stops, Logs `scrapped at step <n>; branch <branch>, PR <pr or none> left for you to close`, and replies with the branch and PR for you to delete. It deletes nothing.

## 8. The open card

Press a card (or choose `Open card` in the menu under its `⋯`) and the pane shows that card alone:
- Top row: `◂ Board` goes back to the lanes. `◂ Prev`, a count like `4 of 32`, and `Next ▸` step through the cards in board order.
- The title, with `Rename` (opens a `Card title` field with `Save` and `Cancel`) and `Copy ID` (puts `KB-0024` on the clipboard and shows `Copied KB-0024.`).
- A status box when Claude is on the card: `Working`, the step, the bar of blocks and `5 of 7 steps done`, the last Log line, the branch and pull request.
- `Lane`, `Model` and `Thinking`. `Lane` moves the card, with the same effect as a drag. `Model` and `Thinking` set a model and thinking level for this card alone; they replace the Planner and Worker settings for that card and nothing else. `Auto` means the Settings values apply.
- `Plan`: one line per step, marked done, current or to do. `Show details` draws every step in full; `Hide details` puts it back.
- `Description`, then `Log`: a `Write a comment for Claude` field with a `Comment` button, and the Log lines, newest first.
- `Delete card…` at the bottom asks `Delete KB-0024? This removes the card and its log.` with `Delete it` and `Keep it`.

## 9. Watch the board in Obsidian

Obsidian 1.14 or later (checked with 1.14.4) can show the board as a Kanban view of one file, `kanban/Board.base`, with no plugin. A drag there changes only the card's `status:`; the pane then adds the Log line `moved A -> B in Obsidian`. A drag does not place a card between two others, and a card flagged `GATE:` or `QUESTION:` may refuse to drag (details in `docs\obsidian.md`).

The vault is `C:\work\project-management-board`; any vault folder works. To link a project's `kanban/` folder into it with a junction (a folder shortcut, so the files stay in the project):
1. Create the vault: in Obsidian choose "Create new vault", name it `project-management-board`, location `C:\work`.
2. In cmd.exe (not PowerShell). This makes one junction and removes nothing. Replace `<project>` with the project's folder name, for example `claude-kanban`:
   ```
   mklink /J "C:\work\project-management-board\<project>" "C:\work\<project>\kanban"
   ```
3. In a session in that project say `set up the Obsidian view`. Claude asks `What is the path of this kanban folder inside your Obsidian vault?` Answer `<project>`. It writes `kanban/Board.base` and replies `Obsidian view written: kanban/Board.base. ...`. Say it again after you add or rename a lane.
4. In Obsidian open `<project>/Board.base`. Drag a card to another column; its `status:` changes. Whether Obsidian rewrites the card file as `docs\obsidian.md` predicts has not been confirmed on a real drag.

To remove the link later, in cmd.exe: `rmdir "C:\work\project-management-board\<project>"`. It deletes only the junction, not the cards.

## 10. The MCP server

The plugin also starts an MCP server, so any agent (Claude, Gemini CLI) can list, add and move cards without the pane. It edits only the card files and starts no work. Tools, the Gemini setup block and the end-to-end check are in `README.md`, section "MCP server". In a session, `/mcp` shows `kanban` connected.

## 11. Where everything lives

In your project:
```
kanban/board.md                      settings and lanes
kanban/DECISIONS.md                  one line per decision
kanban/KB-0001-hello-world-app.md    one file per card
```

The plugin, `<path-to-your-clone>`:
```
.claude-plugin\   plugin.json, marketplace.json
skills\kanban\    SKILL.md; references\format.md (the file format); references\lanes.md (lane rules, gates)
hooks\            register.tsx (/board, settings, refresh), board.tsx (the lanes and the drag), ui\ (header, toolbar, open card, Settings), lib\ (card parser)
mcp\              the MCP server
docs\            obsidian.md, design\ (the pictures)
tests\            what `claude plugin test` runs
```

The settings.json entry, in `C:\Users\<you>\.claude\settings.json`: `"env": {"CLAUDE_CODE_PLUGIN_DIRS": "C:\\path\\to\\claude-kanban", "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"}`. Delete it and the plugin stops loading in new sessions.

Change the board by editing `kanban/board.md` in VS Code, or use the Settings tab. The full rules are in `skills\kanban\references\format.md`.
- Settings: `workers` is 1 to 5. Models are `haiku`, `sonnet`, `opus`, `fable`; `advisor_model` can also be `none`. `planner_model` is never `none`.
- Add a lane: a new line under `lanes:` as `Label (role)`. A label is one or two words, letters and digits only. The roles are `intake`, `plan`, `needs-you`, `auto`, `backlog`, `done`, `scrapped` (an older board may also have `manual`, `parked` or `gated`; see `skills\kanban\references\lanes.md`). Behaviour follows the role, not the label.
- Rename a lane: ask Claude. Do not change a label by hand, or the cards' `status:` lines no longer match. Claude edits every card in that lane.
