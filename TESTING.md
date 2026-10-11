# Manual test checklist

This is a manual test script for someone developing the plugin: it checks by hand what the automated tests cannot (the real desktop pane, drag, the `/model` switch, Obsidian). If you only want to use the plugin, read `README.md` and then `WALKTHROUGH.md` instead.

It was written and run on Windows 11 with the Claude Code desktop app, the only setup it has been checked on. Commands are given for PowerShell; the git and Node commands are the same in bash or zsh. Do the steps in order. Every step opens with Do and ends with Expect. Open a NEW Code tab session each time a step says so: sessions opened before the plugin was installed or loaded do not have it. Anything that fails: see "If it does not work" at the bottom.

`<path-to-your-clone>` is your clone of this repo. `<you>` is the owner name on the board (your first name), `<date> <time>` is your local date and time, and `<ID>` is a card ID such as `KB-0004`.

## A. Terminal: validate and tests

1. Validate and test the plugin, and test the MCP server.
   - Do, in PowerShell (runs checks, changes no files; the env line lasts only for that window):
     ```powershell
     $env:CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = '1'
     claude plugin validate <path-to-your-clone>
     claude plugin test <path-to-your-clone>
     npm --prefix <path-to-your-clone>\mcp test
     ```
     In bash or zsh, put `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in front of the `claude plugin test` line instead, and use `/` in the path.
   - Expect: validate passes. The test summary line shows every test passing and `0 fail`. Do not look for a fixed count: it changes as tests are added. `npm test` passes with 0 failing (run `npm --prefix <path-to-your-clone>\mcp install` first if it says a tool is missing). The exit code is 0 after each command (`$LASTEXITCODE` in PowerShell, `$?` in bash).
   - If `claude` says "OAuth session expired", run `claude login` once in a terminal. It opens a browser to sign in and changes no files. The desktop app is not affected.

## B. The pane, in the demo project

Make a fresh demo project for this section. It is a small git repo with one commit, a ready board and three sample cards in Pending (`KB-0001` to `KB-0003`):

```
node <path-to-your-clone>/tools/make-demo.mjs <demo-folder>
```

`<demo-folder>` must be new or empty. Nothing else is touched. If you cannot run that script, follow `WALKTHROUGH.md` section 3 for the hand-made repo, then add three cards with `add a card: ...` (step 20 shows how). Steps 5 to 16 add and delete a card called `Fix footer`; it gets the next free number, `KB-0004` here, called the footer card below.

Pictures of what you should see are in `docs/design/real-pane-*.png`, for example `docs/design/real-pane-board-with-menu.png` (the board with a card's menu open) and `docs/design/real-pane-settings.png` (the Settings tab).

2. Load the plugin.
   - Do: in the desktop app, start a new Code tab session with the folder `<demo-folder>`. Type `/`.
   - Expect: `kanban:kanban` is in the menu. If not, quit and reopen the app, then start another new session.
3. Open the pane.
   - Do: type `/board`. (The pane may not open by itself at session start in a narrow docked pane. `/board` is the sure way.)
   - Expect: the header (`Claude is idle`, the `Board` and `Settings` tabs, a time like `changed 14:02` or `3 min ago`, and `◆ 1 need you` when a card waits on you), the toolbar (`New card`, `Find a card`, `Sort`, `Collapse all`, a line like `3 cards`) and the lanes, each a flat row. The three sample cards are in Pending. Within a few seconds the session may switch to opus (the `manager_model`), or a notice says `run /model opus yourself`.
4. The Board chip.
   - Do: close the pane with its `x`.
   - Expect: a `Board` chip above the chat box. Press it: the pane opens. With the pane open the chip is gone.
5. New card.
   - Do: press `New card`. A `What needs doing?` field appears with a `Lane` list, `Add` and `Cancel`. Type `Fix footer`, leave `Lane` on Pending, press Enter (or `Add`).
   - Expect: the card `Fix footer` is in Pending at once and no Claude turn starts. `kanban/<ID>-fix-footer.md` exists with `status: Pending`. `board.md` has `next_id` one higher. The `What needs doing?` field is empty and stays open after Enter. Press `Cancel`: the field closes and no further card is made.
6. Find a card.
   - Do: type `footer` in `Find a card`. Then `zzzz`. Then press `Clear`.
   - Expect: with `footer` only the footer card shows. With `zzzz` the pane says `No card matches "zzzz"` with a `Clear`, and every lane shows 0. `Clear` brings every card back.
7. Sort.
   - Do: open `Sort`. It lists `Your order`, `Newest first`, `Oldest first`, `Recently changed`, `Title A to Z`, `Label A to Z`, `Needs you first`. Pick `Title A to Z`, then `Your order`.
   - Expect: the cards reorder inside each lane and no card file changes (`git -C <demo-folder> status` shows the new footer card file and the changed `board.md` from step 5, nothing more).
8. Fold the lanes.
   - Do: press `Collapse all`, then `Expand all`. Then press one lane's bar (its name and count).
   - Expect: `Collapse all` folds every lane to one line and the button then reads `Expand all`. Pressing a lane's bar folds or opens just that lane.
9. The open card.
   - Do: press the footer card. Try each control: `Rename` (type a new title, `Save`; again with `Cancel`), `Copy ID`, `Lane`, `Model`, `Thinking`, `Next ▸` and `◂ Prev`, `◂ Board`.
   - Expect: `Rename` changes the title and the card still opens. `Copy ID` shows `Copied <ID>.` and Ctrl+V pastes the ID. `Lane` Backlog moves the card (set it back to Pending). `Model` and `Thinking` change that card only. `Next ▸` and `◂ Prev` step through the cards. `◂ Board` returns to the lanes.
   - Also: open a card that has a plan (this needs setup: none has one yet in a fresh demo. Plan one first by dragging a sample card to Plan and waiting for `PLAN READY` in Needs You, as in `WALKTHROUGH.md` section 5). Press `Show details` (every step in full; it then reads `Hide details`). Type a line in `Write a comment for Claude`, press `Comment`: `Comment added to <ID>.` and a Log line.
9a. The small menu under a card. NOT VERIFIED: nobody has looked at this menu on the real pane yet, so a failure here is a finding, not a mistake in your steps.
   - Do: press the `⋯` on the footer card. Then press the same `⋯` again. Press it once more, then press `Copy ID`. Press the `⋯` again, then `Delete card…`, then `Keep it`. Press `Open card`.
   - Expect: the `⋯` opens no card. A small menu with `Open card`, `Copy ID` and `Delete card…` appears directly under the footer card, inside the lane, and the cards below move down by its 3 rows. The same `⋯` again closes it. `Copy ID` shows `Copied <ID>.`, Ctrl+V pastes the ID, and the menu closes. `Delete card…` turns the menu into `Delete <ID>?`, `This removes the card and its log.`, `Delete it` and `Keep it`; `Keep it` goes back to the three rows and deletes nothing. `Open card` opens the footer card (the open card of step 9). Each row acts on the first click. Pressing anywhere else on the lanes closes the menu.
10. Delete a card.
    - Do: open the footer card, press `Delete card…`, press `Keep it`. Then `Delete card…` and `Delete it`.
    - Expect: the question `Delete <ID>? This removes the card and its log.` `Keep it` changes nothing. `Delete it` shows `Deleted <ID>.` and the file is gone. Add `Fix footer` again (step 5) for the steps below; it gets the next number, which is now the footer card.
11. Approve the gate by dragging. NEEDS SETUP: a card held at a gate, which a fresh demo does not have.
    - Setup: add a card that asks for a new dependency (or use the sample card that asks for one, if the demo has it), for example `add a card: Add a dependency. Add one small third-party package to this project's dependency file (requirements.txt for Python, package.json for Node) and use it in one place.` Drag it from Pending to Auto and approve the permission prompts. Wait until it sits in Needs You with the flag `GATE: merge touches <manifest file>` (`WALKTHROUGH.md` section 6). Start this step from there; call this the gate card.
    - Do: press on the gate card in Needs You, move to Auto, let go. While held, the Auto lane says `→ Drop to approve it. Claude carries on.` Approve the permission prompts (expect Edit, Write and Bash).
    - Expect: a ghost of the card follows the pointer. On release the card is in Auto at once.
    - Expect: the Log has `<you>: moved Needs You -> Auto` within a second, and its time matches your clock (local, not UTC). Open the card file in `<demo-folder>/kanban/` in an editor to see it.
    - Expect: chat shows `Kanban: <you> moved <ID> "<title>" from Needs You to Auto. Do the auto lane action from the kanban skill.` The card shows `● Working` or `○ Waiting to start` while the turn runs.
    - Expect: Claude adds `started: kb-<n>-<slug>`, `approved: GATE: merge touches <manifest file>`, `merged kb-<n>-<slug>`, `moved Auto -> Done`. The flag is empty. The card is in Done.
    - Check, in a terminal (reads only): `git -C <demo-folder> log --oneline --graph` shows a merge commit starting with the gate card's ID and, on top, `<ID> board: done`. The project's dependency file now lists the new package.
12. Bounce.
    - Do: drag the footer card from Pending onto Needs You.
    - Expect: while held, Needs You says `Claude's lane. You can't drop here.` On release the card stays in Pending. No Claude turn starts.
13. Place a card.
    - Do: with `Sort` on `Your order` and two or more cards in Pending, drag one card up or down inside Pending.
    - Expect: while held, Pending says `Drop to place it here.` and the lane says `Drop to put it between ... and ...`. On release the card sits where you dropped it. With any other sort, Pending says `Sorted by ... Change to Your order to place cards.`
14. The pane follows file edits.
    - Do: in an editor open the footer card's file in `<demo-folder>/kanban/`, change `status: Pending` to `status: Backlog`, save. Then change it back and save.
    - Expect: the card moves to Backlog within about a second, then back to Pending. No Claude turn starts.
15. Settings.
    - Do: press the `Settings` tab. Set `Workers at once` to 2. Then set Manager `Model` to sonnet. Then press `Reset` on the Manager row. Then press `Restore all defaults` and `Keep`, then `Restore all defaults` and `Restore`.
    - Expect: `kanban/board.md` shows `workers: 2`, then `manager_model: sonnet` (and either `/model` runs for you and the session shows sonnet, or a notice says `run /model sonnet yourself`), then `Reset` removes the Manager lines. `Keep` changes nothing. `Restore` removes every settings line and shows `All settings are back to their defaults.`; the tab then says `Everything is at its default`. Each Thinking list marks one level `(recommended)`. Press `Board` to go back.
    - Do: still on the `Settings` tab, set `Workers at once` to 3. Press `Save as defaults`. Then set `Workers at once` to 4, and press `Reset` on that row.
    - Expect: after `Save as defaults` a toast says `Saved as your defaults.` and `kanban/board.md` shows `default_workers: 3`. After the change to 4 the row shows `Default: 3`; `Reset` puts it back to 3 and removes the `workers` line. Other boards keep the original defaults.
    - Do: press `Restore original defaults`, then `Keep`; then `Restore original defaults` and `Restore`.
    - Expect: the question reads `Remove your saved defaults and put every setting back to the original?`. `Keep` changes nothing. `Restore` removes every `default_` line from `kanban/board.md`, shows `All settings are back to the original defaults.`, `Workers at once` reads 2, and `Restore original defaults` is gone.
16. Narrow pane. NOT VERIFIED: nobody has checked drag or the toolbar in a narrow pane since the pane was rebuilt, so a failure here is a finding, not a mistake in your steps.
    - Do: drag the pane edge until it is narrow. Press `New card`, then `Cancel`. Drag the footer card down to the Backlog lane, then up to the Pending lane.
    - Expect: the toolbar controls stay readable and pressable and nothing is cut off. The first drag moves the card to Backlog and starts no turn. The second moves it back to Pending and starts no turn.
17. Seeing it (a screenshot, no clicking). Windows only: the script uses PowerShell and Windows screen capture.
    - Do: in PowerShell run `powershell -NoProfile -File <path-to-your-clone>\tools\capture-pane.ps1 <output-folder>\out.png`. It writes one PNG and removes nothing. By default it saves the right-hand 660 px of the Claude window (the pane); `-PaneWidth N` changes that width.
    - Also: add `-Full` for the whole window; `-Left N` keeps only the left N px (the chat column); `-Bottom N` keeps only the bottom N px (the band above the chat box and the chat box). `-Left` and `-Bottom` imply `-Full` and can be used together.
    - Expect: with a board and the pane closed, the bottom of the chat column shows a `Board` chip above the chat box; with the pane open it shows nothing.

## C. Chat checks, in a fresh empty folder

18. Make the folder.
    - Do, in PowerShell or bash (creates one folder and one commit; removes nothing):
      ```
      mkdir kanban-fresh
      cd kanban-fresh
      git init -b main
      git commit --allow-empty -m "Initial commit"
      ```
      Start a new Code tab session in that folder and type `/board`.
    - Expect: the pane says `There is no kanban/board.md in this project.` and shows a `Set up a board` button.
19. Set up the board.
    - Do: type `set up the kanban board`. Claude asks `Whose board is this?` and offers your git name. Type your first name. Then type `set up the kanban board` again.
    - Expect: `Board ready for <you>: Needs You, Pending, Plan, Auto, Backlog, Done, Discarded.` Then `Board already set up (0 cards)`. `kanban/board.md` has 7 lanes, `next_id: 1`, `owner: <you>`, no settings lines (every setting takes its default: workers 2; manager opus, medium; planner opus, high; worker sonnet, medium; advisor fable, high). `kanban/DECISIONS.md` holds only `# Decisions`. The pane swaps to the board within about 10 seconds.
20. Add three cards.
    - Do: type `add a card: fix the morning summary date`, then `add a card: second card`, then `add a card: third card`.
    - Expect: `KB-0001 added to Pending: ...` (with the title), then KB-0002, KB-0003. `kanban/KB-0001-fix-the-morning-summary-date.md` has `status: Pending`, `order: 1000`, today's dates and one Log line `created in Pending`.
21. Two refusals.
    - Do: type `move KB-2 to Nowhere`. Then `move KB-2 to Needs You`.
    - Expect: `Unknown lane "Nowhere". Lanes on this board: Needs You, Pending, Plan, Auto, Backlog, Done, Discarded. Nothing was changed.` Then `"Needs You" can only be entered by Claude (it holds a question, a plan to approve or a held action). Nothing was changed.` Neither changes a file.
22. Comment.
    - Do: type `comment on KB-1: waiting on Sam`.
    - Expect: `Comment added to KB-0001.` One new Log line `<you>: waiting on Sam`. `status:` is still Pending.
23. List and what's next.
    - Do: type `list the board`, then `what's next`.
    - Expect: the list prints the seven lanes in order, Pending (3) with three cards and every other lane with (0), no `Fix needed:` line. What's next prints `Queued for Claude` and `Waiting on you` as `none`, and `Untriaged` with KB-0001, KB-0002, KB-0003.
24. Decide.
    - Do: type `decide: Pending is the inbox, because one place`. Then record a second decision.
    - Expect: `D1 recorded: Pending is the inbox`. `DECISIONS.md` has a line `- **D1 (<date>) Pending is the inbox:** ...` ending `Reason: one place.` The second one is D2.
25. A move that does nothing more.
    - Do: type `move KB-3 to Backlog`.
    - Expect: `KB-0003 moved Pending -> Backlog.` and nothing else: no lane action, no commit. `what's next` no longer lists KB-0003 under `Untriaged`.

## D. The MCP server

26. Run the end-to-end check.
   - Do, in a terminal (the first time only, `npm --prefix <path-to-your-clone>\mcp install` fetches the test tools into mcp\node_modules, which git ignores; then this starts the bundled server against a temporary board in your temp folder, adds and moves one card there, touches nothing else):
     ```
     node <path-to-your-clone>/mcp/test/e2e.mjs
     ```
   - Expect: one line, `e2e ok: add, move, list and the no-board refusal all behaved`, and exit code 0. The unit tests are `npm --prefix <path-to-your-clone>/mcp test` (all pass, 0 fail).
27. See it in a session.
   - Do: start a new Code tab session in a project with a `kanban/` folder (the demo or the fresh folder), then type `/mcp`.
   - Expect: `kanban` listed under the plugin's servers as connected. In the pane nothing changes; ask `add a card: try the server` and the new card appears in the pane within a few seconds.

## E. Obsidian

Status: experimental. None of this has yet been tried in a real Obsidian; the "Expect" lines say what should happen, and a difference is a finding. Known limits from the design: a card whose `flag:` holds a colon cannot be dragged there, a drag cannot place a card between two others, and whether empty lanes show as columns is unknown (`docs/obsidian.md`).

Obsidian 1.14 or later is needed (read from 1.14.4). The steps to open the vault are in `WALKTHROUGH.md`, section 9. Step 28 can be done without Obsidian; 29 to 33 need it. Use the demo project from section B.

28. The view file.
   - Do: in a session in `<demo-folder>`, type `set up the Obsidian view`. If asked, answer with the path of the `kanban` folder inside your vault (it asks nothing when the vault is the project folder).
   - Expect: `Obsidian view written: kanban/Board.base. Open it in Obsidian 1.14 or later; a card dragged there changes only its status.` `kanban/Board.base` exists, lists every lane label of `board.md` in board order, and nothing else changed (`git status` shows only the new file). The pane still shows the same cards.
29. Open the vault.
   - Do: in Obsidian choose "Open folder as vault" and pick `<demo-folder>` (`WALKTHROUGH.md` section 9). If your vault is elsewhere, link the project's `kanban/` folder into it as that section shows (it makes one link and removes nothing).
   - Expect: the project's cards should appear in Obsidian's file list (under `kanban/`, or under the link's name).
30. Read the board.
   - Do: in Obsidian open `Board.base`.
   - Expect: a column per lane, in the board's order (whether a lane with no cards shows is unknown; note what you see), each card showing its file name, `id` and `flag`. `board.md` and `DECISIONS.md` are not cards.
31. Drag a card in Obsidian.
   - Do: drag one card to another column.
   - Expect: the card file's `status:` should be the new lane and nothing else of the front matter should change by meaning. Within a few seconds the pane should show the card in the new lane and the card's Log should gain `moved <old> -> <new> in Obsidian`. No Claude turn should start. This has not been confirmed on a real drag; if the card file is rewritten in an unexpected way, that is the finding.
32. Edit in Obsidian.
   - Do: change a card's `flag:` in Obsidian's properties panel.
   - Expect: the pane should show the new flag. A card flagged `GATE: ...` or `QUESTION: ...` may refuse to drag in Obsidian (see `docs/obsidian.md`).
33. Remove the link (optional, only if you made one in step 29).
   - Do: remove only the link (`WALKTHROUGH.md` section 9 shows the command for your system). It deletes only the link.
   - Expect: the project's `kanban/` folder and its cards are untouched.

## If it does not work

Drag, the `/model` switch and hot reload are confirmed on the desktop. Only the narrow pane (step 16) is unchecked. If something fails, that is the finding, not a mistake in your steps.

- Dragging in the desktop pane. If the card does not follow the pointer or does not move on release, type `move <ID> to Auto` in chat instead (same go-ahead as a drag) and tell Claude what you saw. The fallback is the `Lane` list in the open card, which moves a card the same way.
- The `/model` switch from the dropdown. If the session model does not change and no notice appears, type `/model sonnet` yourself. The `board.md` setting is still saved.
- Hot reload of plugin edits in a desktop session. If a change to the plugin does not show, type `/reload-plugins`. If it still does not, quit and reopen the app.
- Plugin missing: you are in an old session. Start a new Code tab session. If `kanban:kanban` is still missing, quit and reopen the desktop app.
- Permission prompts during an Auto run are the normal ones for Edit, Write and Bash. The `Kanban:` messages arrive as your own words, so nothing is pre-approved.
- Terminal: `claude` says "OAuth session expired" until you run `claude login` once. `claude plugin test` needs `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` first (`$env:CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = '1'` in PowerShell).
- A card sitting in Needs You with `QUESTION:` or `FAILED` is not stuck. Read the newest Log line, comment, drag it on.

Report what you saw as an issue on the repository (https://github.com/J-J-E/claude-kanban/issues), with the step number.

When done, delete the throwaway folders (`<demo-folder>` and `kanban-fresh`). In PowerShell, `Remove-Item -Recurse -Force <folder>` deletes that folder and everything in it; in bash, `rm -rf <folder>` does the same. Check the path before you run it.
