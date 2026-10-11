# Manual test checklist

For a tester on Windows 11 with the Claude Code desktop app. Do the steps in order. Every step opens with Do and ends with Expect. Open a NEW Code tab session each time a step says so: sessions opened before the plugin was installed or loaded do not have it. Anything that fails: see "If it does not work" at the bottom.

## A. PowerShell: validate and tests

1. Validate and test the plugin, and test the MCP server.
   - Do, in PowerShell (runs checks, changes no files; the env line lasts only for that window):
     ```powershell
     $env:CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = '1'
     claude plugin validate <path-to-your-clone>
     claude plugin test <path-to-your-clone>
     npm --prefix <path-to-your-clone>\mcp test
     ```
   - Expect: validate passes. The test summary line shows every test passing and `0 fail`. Do not look for a fixed count: it changes as tests are added. `npm test` passes with 0 failing (run `npm --prefix <path-to-your-clone>\mcp install` first if it says a tool is missing). `$LASTEXITCODE` is 0 after each command.
   - If `claude` says "OAuth session expired", run `claude login` once in PowerShell. It opens a browser to sign in and changes no files. The desktop app is not affected.

## B. The pane, in the sandbox

Pictures of what you should see are in `docs\design\real-pane-*.png`.

2. Load the plugin.
   - Do: in the desktop app, start a new Code tab session with the folder `C:\work\kanban-sandbox`. Type `/`.
   - Expect: `kanban:kanban` is in the menu. If not, quit and reopen the app, then start another new session.
3. Open the pane.
   - Do: type `/board`. (The pane may not open by itself at session start in a narrow docked pane. `/board` is the sure way.)
   - Expect: the header (`Claude is idle`, the `Board` and `Settings` tabs, a time like `changed 14:02` or `3 min ago`, and `◆ 1 need you` when a card waits on you), the toolbar (`New card`, `Find a card`, `Sort`, `Collapse all`, a line like `2 cards`) and the lanes, each a flat row. KB-0001 `Hello world app` is in Done. KB-0002 `Add a dependency to show a gate` is in Needs You with the flag `GATE: merge touches requirements.txt`. Within a few seconds the session may switch to opus (the `manager_model`), or a notice says `run /model opus yourself`.
4. The Board chip.
   - Do: close the pane with its `x`.
   - Expect: a `Board` chip above the chat box. Press it: the pane opens. With the pane open the chip is gone.
5. New card.
   - Do: press `New card`. A `What needs doing?` field appears with a `Lane` list, `Add` and `Cancel`. Type `Fix footer`, leave `Lane` on Pending, press Enter (or `Add`).
   - Expect: the card `Fix footer` is in Pending at once and no Claude turn starts. `kanban\KB-0003-fix-footer.md` exists with `status: Pending`. `board.md` has `next_id: 4`. The `What needs doing?` field is empty and stays open after Enter. Press `Cancel`: the field closes and no further card is made.
6. Find a card.
   - Do: type `footer` in `Find a card`. Then `zzzz`. Then press `Clear`.
   - Expect: with `footer` only KB-0003 shows. With `zzzz` the pane says `No card matches "zzzz"` with a `Clear`, and every lane shows 0. `Clear` brings every card back.
7. Sort.
   - Do: open `Sort`. It lists `Your order`, `Newest first`, `Oldest first`, `Recently changed`, `Title A to Z`, `Label A to Z`, `Needs you first`. Pick `Title A to Z`, then `Your order`.
   - Expect: the cards reorder inside each lane and no card file changes (`git -C C:\work\kanban-sandbox status` shows nothing new).
8. Fold the lanes.
   - Do: press `Collapse all`, then `Expand all`. Then press one lane's bar (its name and count).
   - Expect: `Collapse all` folds every lane to one line and the button then reads `Expand all`. Pressing a lane's bar folds or opens just that lane.
9. The open card.
   - Do: press KB-0003. Try each control: `Rename` (type a new title, `Save`; again with `Cancel`), `Copy ID`, `Lane`, `Model`, `Thinking`, `Next ▸` and `◂ Prev`, `◂ Board`.
   - Expect: `Rename` changes the title and the card still opens. `Copy ID` shows `Copied KB-0003.` and Ctrl+V pastes `KB-0003`. `Lane` Backlog moves the card (set it back to Pending). `Model` and `Thinking` change that card only. `Next ▸` and `◂ Prev` step through the cards. `◂ Board` returns to the lanes.
   - Also: open a card that has a plan (KB-0002), press `Show details` (every step in full; it then reads `Hide details`). Type a line in `Write a comment for Claude`, press `Comment`: `Comment added to KB-0002.` and a Log line.
9a. The small menu under a card. NOT VERIFIED: nobody has looked at this menu on the real pane yet, so a failure here is a finding, not a mistake in your steps.
   - Do: press the `⋯` on KB-0003. Then press the same `⋯` again. Press it once more, then press `Copy ID`. Press the `⋯` again, then `Delete card…`, then `Keep it`. Press `Open card`.
   - Expect: the `⋯` opens no card. A small menu with `Open card`, `Copy ID` and `Delete card…` appears directly under KB-0003, inside the lane, and the cards below move down by its 3 rows. The same `⋯` again closes it. `Copy ID` shows `Copied KB-0003.`, Ctrl+V pastes `KB-0003`, and the menu closes. `Delete card…` turns the menu into `Delete KB-0003?`, `This removes the card and its log.`, `Delete it` and `Keep it`; `Keep it` goes back to the three rows and deletes nothing. `Open card` opens KB-0003 (the open card of step 9). Each row acts on the first click. Pressing anywhere else on the lanes closes the menu.
10. Delete a card.
    - Do: open KB-0003, press `Delete card…`, press `Keep it`. Then `Delete card…` and `Delete it`.
    - Expect: the question `Delete KB-0003? This removes the card and its log.` `Keep it` changes nothing. `Delete it` shows `Deleted KB-0003.` and the file is gone. Add `Fix footer` again (step 5) for the steps below.
11. Approve the gate by dragging.
    - Do: press on KB-0002 in Needs You, move to Auto, let go. While held, the Auto lane says `→ Drop to approve it. Claude carries on.` Approve the permission prompts (expect Edit, Write and Bash).
    - Expect: a ghost of the card follows the pointer. On release the card is in Auto at once.
    - Expect: the Log has `John: moved Needs You -> Auto` within a second, and its time matches your clock (local, not UTC). Open `C:\work\kanban-sandbox\kanban\KB-0002-add-a-dependency-to-show-a-gate.md` in VS Code to see it.
    - Expect: chat shows `Kanban: John moved KB-0002 "Add a dependency to show a gate" from Needs You to Auto. Do the auto lane action from the kanban skill.` The card shows `● Working` or `○ Waiting to start` while the turn runs.
    - Expect: Claude adds `started: kb-2-add-a-dependency-to-show-a-gate`, `approved: GATE: merge touches requirements.txt`, `merged kb-2-add-a-dependency-to-show-a-gate`, `moved Auto -> Done`. The flag is empty. The card is in Done.
    - Check, in PowerShell (reads only): `git -C C:\work\kanban-sandbox log --oneline --graph` shows a merge commit starting `KB-0002` and, on top, `KB-0002 board: done`. Then `C:\work\kanban-sandbox\.venv\Scripts\python.exe C:\work\kanban-sandbox\hello.py` prints `Hello, world` and today's date.
12. Bounce.
    - Do: drag KB-0003 from Pending onto Needs You.
    - Expect: while held, Needs You says `Claude's lane. You can't drop here.` On release the card stays in Pending. No Claude turn starts.
13. Place a card.
    - Do: with `Sort` on `Your order` and two or more cards in Pending, drag one card up or down inside Pending.
    - Expect: while held, Pending says `Drop to place it here.` and the lane says `Drop to put it between ... and ...`. On release the card sits where you dropped it. With any other sort, Pending says `Sorted by ... Change to Your order to place cards.`
14. The pane follows file edits.
    - Do: in VS Code open `kanban\KB-0003-fix-footer.md`, change `status: Pending` to `status: Backlog`, save. Then change it back and save.
    - Expect: the card moves to Backlog within about a second, then back to Pending. No Claude turn starts.
15. Settings.
    - Do: press the `Settings` tab. Set `Workers at once` to 2. Then set Manager `Model` to sonnet. Then press `Reset` on the Manager row. Then press `Restore all defaults` and `Keep`, then `Restore all defaults` and `Restore`.
    - Expect: `kanban\board.md` shows `workers: 2`, then `manager_model: sonnet` (and either `/model` runs for you and the session shows sonnet, or a notice says `run /model sonnet yourself`), then `Reset` removes the Manager lines. `Keep` changes nothing. `Restore` removes every settings line and shows `All settings are back to their defaults.`; the tab then says `Everything is at its default`. Each Thinking list marks one level `(recommended)`. Press `Board` to go back.
    - Do: still on the `Settings` tab, set `Workers at once` to 3. Press `Save as defaults`. Then set `Workers at once` to 4, and press `Reset` on that row.
    - Expect: after `Save as defaults` a toast says `Saved as your defaults.` and `kanban\board.md` shows `default_workers: 3`. After the change to 4 the row shows `Default: 3`; `Reset` puts it back to 3 and removes the `workers` line. Other boards keep the original defaults.
    - Do: press `Restore original defaults`, then `Keep`; then `Restore original defaults` and `Restore`.
    - Expect: the question reads `Remove your saved defaults and put every setting back to the original?`. `Keep` changes nothing. `Restore` removes every `default_` line from `kanban\board.md`, shows `All settings are back to the original defaults.`, `Workers at once` reads 2, and `Restore original defaults` is gone.
16. Narrow pane. NOT VERIFIED: nobody has checked drag or the toolbar in a narrow pane since the pane was rebuilt, so a failure here is a finding, not a mistake in your steps.
    - Do: drag the pane edge until it is narrow. Press `New card`, then `Cancel`. Drag KB-0003 down to the Backlog lane, then up to the Pending lane.
    - Expect: the toolbar controls stay readable and pressable and nothing is cut off. The first drag moves the card to Backlog and starts no turn. The second moves it back to Pending and starts no turn.
17. Seeing it (a screenshot, no clicking).
    - Do: in PowerShell run `powershell -NoProfile -File <path-to-your-clone>\tools\capture-pane.ps1 C:\path\to\out.png`. It writes one PNG and removes nothing. By default it saves the right-hand 660 px of the Claude window (the pane); `-PaneWidth N` changes that width.
    - Also: add `-Full` for the whole window; `-Left N` keeps only the left N px (the chat column); `-Bottom N` keeps only the bottom N px (the band above the chat box and the chat box). `-Left` and `-Bottom` imply `-Full` and can be used together.
    - Expect: with a board and the pane closed, the bottom of the chat column shows a `Board` chip above the chat box; with the pane open it shows nothing.

## C. Chat checks, in a fresh empty folder

18. Make the folder.
    - Do, in PowerShell (creates one folder and one commit; removes nothing):
      ```powershell
      New-Item -ItemType Directory -Path C:\work\kanban-fresh
      git -C C:\work\kanban-fresh init -b main
      Set-Content -Path C:\work\kanban-fresh\README.md -Value "# kanban-fresh"
      git -C C:\work\kanban-fresh add README.md
      git -C C:\work\kanban-fresh commit -m "Initial commit"
      ```
      Start a new Code tab session there and type `/board`.
    - Expect: the pane says `There is no kanban/board.md in this project.` and shows a `Set up a board` button.
19. Set up the board.
    - Do: type `set up the kanban board`. Claude asks `Whose board is this?` and offers your git name. Type `John`. Then type `set up the kanban board` again.
    - Expect: `Board ready for John: Needs You, Pending, Plan, Auto, Backlog, Done, Discarded.` Then `Board already set up (0 cards)`. `kanban\board.md` has 7 lanes, `next_id: 1`, `owner: John`, no settings lines (every setting takes its default: workers 2; manager opus, medium; planner opus, high; worker sonnet, medium; advisor fable, high). `kanban\DECISIONS.md` holds only `# Decisions`. The pane swaps to the board within about 10 seconds.
20. Add three cards.
    - Do: type `add a card: fix the morning summary date`, then `add a card: second card`, then `add a card: third card`.
    - Expect: `KB-0001 added to Pending: ...` (with the title), then KB-0002, KB-0003. `kanban\KB-0001-fix-the-morning-summary-date.md` has `status: Pending`, `order: 1000`, today's dates and one Log line `created in Pending`.
21. Two refusals.
    - Do: type `move KB-2 to Nowhere`. Then `move KB-2 to Needs You`.
    - Expect: `Unknown lane "Nowhere". Lanes on this board: Needs You, Pending, Plan, Auto, Backlog, Done, Discarded. Nothing was changed.` Then `"Needs You" can only be entered by Claude (it holds a question, a plan to approve or a held action). Nothing was changed.` Neither changes a file.
22. Comment.
    - Do: type `comment on KB-1: waiting on Sam`.
    - Expect: `Comment added to KB-0001.` One new Log line `John: waiting on Sam`. `status:` is still Pending.
23. List and what's next.
    - Do: type `list the board`, then `what's next`.
    - Expect: the list prints the seven lanes in order, Pending (3) with three cards and every other lane with (0), no `Fix needed:` line. What's next prints `Queued for Claude` and `Waiting on you` as `none`, and `Untriaged` with KB-0001, KB-0002, KB-0003.
24. Decide.
    - Do: type `decide: Pending is the inbox, because one place`. Then record a second decision.
    - Expect: `D1 recorded: Pending is the inbox`. `DECISIONS.md` has a line `- **D1 (<today>) Pending is the inbox:** ...` ending `Reason: one place.` The second one is D2.
25. A move that does nothing more.
    - Do: type `move KB-3 to Backlog`.
    - Expect: `KB-0003 moved Pending -> Backlog.` and nothing else: no lane action, no commit. `what's next` no longer lists KB-0003 under `Untriaged`.

## D. The MCP server

26. Run the end-to-end check.
   - Do, in PowerShell (the first time only, `npm --prefix <path-to-your-clone>\mcp install` fetches the test tools into mcp\node_modules, which git ignores; then this starts the bundled server against a temporary board in your temp folder, adds and moves one card there, touches nothing else):
     ```powershell
     node <path-to-your-clone>\mcp\test\e2e.mjs
     ```
   - Expect: one line, `e2e ok: add, move, list and the no-board refusal all behaved`, and `$LASTEXITCODE` 0. The unit tests are `npm --prefix <path-to-your-clone>\mcp test` (all pass, 0 fail).
27. See it in a session.
   - Do: start a new Code tab session in a project with a `kanban/` folder, then type `/mcp`.
   - Expect: `kanban` listed under the plugin's servers as connected. In the pane nothing changes; ask `add a card: try the server` and the new card appears in the pane within a few seconds.

## E. Obsidian

Obsidian 1.14 or later is needed (checked with 1.14.4). The steps to link the vault are in `WALKTHROUGH.md`, section 9. Steps 1 to 3 below can be done without Obsidian; 4 to 6 need it.

28. The view file.
   - Do: in a session in `C:\work\kanban-sandbox`, type `set up the Obsidian view`. If asked, answer with the path of the `kanban` folder inside your vault.
   - Expect: `Obsidian view written: kanban/Board.base. Open it in Obsidian 1.14 or later; a card dragged there changes only its status.` `kanban\Board.base` exists, lists every lane label of `board.md` in board order, and nothing else changed (`git status` shows only the new file). The pane still shows the same cards.
29. Link the vault.
   - Do: create the vault `C:\work\project-management-board` in Obsidian (it does not exist yet), then in cmd.exe run the `mklink /J` line from `WALKTHROUGH.md` section 9 (it makes one junction and removes nothing).
   - Expect: the project's cards appear in Obsidian's file list under `<project>`.
30. Read the board.
   - Do: in Obsidian open `Board.base`.
   - Expect: one column per lane, in the board's order, each card showing its file name, `id` and `flag`. `board.md` and `DECISIONS.md` are not cards.
31. Drag a card in Obsidian.
   - Do: drag one card to another column.
   - Expect: the card file's `status:` is the new lane and nothing else of the front matter changes by meaning. Within a few seconds the pane shows the card in the new lane and the card's Log gains `moved <old> -> <new> in Obsidian`. No Claude turn starts. This has not been confirmed on a real drag; if the card file is rewritten in an unexpected way, that is the finding.
32. Edit in Obsidian.
   - Do: change a card's `flag:` in Obsidian's properties panel.
   - Expect: the pane shows the new flag. A card flagged `GATE: ...` or `QUESTION: ...` may refuse to drag in Obsidian (see `docs\obsidian.md`).
33. Remove the link (optional).
   - Do, in cmd.exe: `rmdir "C:\work\project-management-board\<project>"`. It deletes only the junction.
   - Expect: the project's `kanban\` folder and its cards are untouched.

## If it does not work

Drag, the `/model` switch and hot reload are confirmed on the desktop. Only the narrow pane (step 16) is unchecked. If something fails, that is the finding, not a mistake in your steps.

- Dragging in the desktop pane. If the card does not follow the pointer or does not move on release, type `move KB-2 to Auto` in chat instead (same go-ahead as a drag) and tell Claude what you saw. The fallback is the `Lane` list in the open card, which moves a card the same way.
- The `/model` switch from the dropdown. If the session model does not change and no notice appears, type `/model sonnet` yourself. The `board.md` setting is still saved.
- Hot reload of plugin edits in a desktop session. If a change to the plugin does not show, type `/reload-plugins`. If it still does not, quit and reopen the app.
- Plugin missing: you are in an old session. Start a new Code tab session. If `kanban:kanban` is still missing, quit and reopen the desktop app.
- Permission prompts during an Auto run are the normal ones for Edit, Write and Bash. The `Kanban:` messages arrive as your own words, so nothing is pre-approved.
- Terminal: `claude` says "OAuth session expired" until you run `claude login` once. `claude plugin test` needs `$env:CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = '1'` first.
- A card sitting in Needs You with `QUESTION:` or `FAILED` is not stuck. Read the newest Log line, comment, drag it on.

Report what you saw as an issue on the repository, with the step number.

When done, you can delete the throwaway folder. PowerShell: `Remove-Item -Recurse -Force C:\work\kanban-fresh` deletes that folder and everything in it. Leave `kanban-sandbox` alone.
