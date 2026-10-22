# Changelog

## Unreleased

What changed:

- Merging works for everyone who installs the plug-in, whatever their permission mode (ENH-0065). New setting `Merge by` in the Settings tab (`merge_by: claude` or `owner` in board.md; `claude` for a new board): with `claude` Claude merges the pull request once the checks pass, with `owner` it opens the pull request and stops. Either way, when the merge is refused (for example by the app's safety check in auto mode), or `gh` is missing or not signed in, the card waits in Needs You with the new flag `READY TO MERGE`, drawn green in the pane instead of yellow like a question, with the pull request link and the one merge command in its Log. The pane has no merge button and runs no merge: you merge it yourself, then move the card to Auto (or say so in chat) and Claude checks the pull request and finishes the card. The header counts these cards (`1 ready to merge`). The first time the pane opens a board it also runs a read-only setup check (git remote, `gh` signed in, whether your Claude settings allow `Bash(gh pr merge *)`), says in one line what is missing with the PowerShell command for each fix, recommends `Merge by: Owner` when the rule is missing, changes none of your settings, and remembers itself with a `setup_checked` line in board.md. This replaces the idea of counting five merges by hand (ENH-0046).
- The skill commits `kanban/` (the `board: done`, `stopped`, `scrapped` and `parked` commits) only when git tracks that folder; when it is not tracked, for example in a public copy of this repo, the commit is skipped silently (CHORE-0015).
- New setting `Chat questions` in the Settings tab (ENH-0052), off for a new board: when on, each card waiting in Needs You is put to you in chat as a question with choices, each choice a reply plus the lane the card moves to (for example Approve -> Auto, Change the plan -> Plan, Drop it -> Discarded), together in the first reply after a prompt and once per card in a chat. It is the board.md line `needs_you_in_chat: on` or `off`; the pane only adds a line to the hidden note, the question is asked by Claude.
- A card's parent and children now show: the open card has a `Parent` line and a `Children (3): 2 of 3 done` list (each ID opens that card), and a card row has a short dim mark (`↑ENH-0025` on a child, `2/3` on a parent). The open card's `Parent` list sets or removes the link, and in chat "make ENH-0033 a child of ENH-0025" or "remove ENH-0033's parent" (new MCP tool `card_parent`) does the same; a loop, a card as its own parent and a card in an Auto lane are refused.
- The manager no longer drops its own Auto cards: its hidden note now also rides on the pane's own prompts, names a worker that finished or went idle with no step logged (agent and card IDs only) so the manager messages it for its report, and says once after a compaction to re-read the skill; the skill reconciles Auto cards at the start of every turn and resumes hanging cards without asking (the "Pick these back up" button stays as the fallback for a closed chat).
- The merge question is now an orange box above the lanes that says nothing has been merged yet, with Keep both as the main button; the two cards stay marked while it is open.
- In the open card the Lane group's outline is now a lighter line than the outlines of the other two groups.
- Plans use fewer, bigger steps: steps that belong together are one step, one worker can take several steps in a row, and the full checks run once at the end.
- New diagnostic command `/board-probe`: tries `git --version`, a test prompt, a sonnet-model step and a haiku call, and logs each result outside the project (in the OS temp folder, or in `KANBAN_PROBE_LOG` if set); one run costs about one tiny test turn and one tiny haiku call.
- `/board-probe` also logs the session's agents (id, the first 40 characters of the description, status, type) when it runs and at the next turn end, to learn the real agent statuses.
- A card whose worker the app lists as waiting no longer reads "Nobody on this", and no card does while any turn runs; a worker that is idle or completed leaves the card "Worker idle since ...; waiting for a message" or "Worker finished ...; next step not started" for 2 minutes, then it warns like nobody on it; `queued behind <ID>` is accepted as a named wait beside `waiting on`; Pick these back up keeps the other cards of a multi-card resume queued, and the resume steps check for a live worker first.
- The skill is smaller and its rules come first (ENH-0048): the manager rules, the lane-action table and the pane prompts open the file and survive `/compact`; rare verbs, refusal texts and older roles moved word for word to `references/` and are read as MCP resources.
- A nearly full chat now gets one toast asking for `/compact` (ENH-0049): "Your chat is about 72% full. Run /compact ...", once per chat, again after a `/compact` and a refill. Nothing is compacted or sent for you.
- The board's planner and worker helpers are plug-in agents with a short tool list and no MCP tools (ENH-0050), so a do-nothing helper starts at about 10.9K tokens instead of 53.6K; the skill falls back to a general-purpose helper when the plug-in agent is missing.
- Auto cards left hanging after a restart can be seen and picked up (ENH-0063): "what's next" has a "Left hanging" section, the pane says "Nobody on this since 14:05", the hidden note lists hanging cards, and a "Pick these back up" button resumes them with one prompt.
- Small plug-in fixes (CHORE-0018): the `/compact` toast also fires at 250,000 tokens, so it works on a 1M window; "what's next" no longer counts a card dragged in Obsidian as started; a `waiting on` line that names a retyped or merged-away ID is no longer a wait, in chat and in the pane; the MCP server reports version 0.2.3, and a test fails when the committed bundle or the version is out of date; `/board-probe` arms only on a prompt that starts with its marker and keeps its log under about 100 KB; the spec lists which agent statuses count.

## 0.2.3

What changed:

- Drop a card on another card to merge them: the pane asks first, the card you dropped on keeps its place, and the other card's text and ID are folded into it. The same merge is available in chat (`merge bug 12 into bug 8`) and to other agents as the MCP tool `card_merge`.
- The manager merges verified work itself: a file count no longer holds a merge, and a check only the live pane can show is recorded in TESTING.md and named in the reply instead of parking the card in Needs You.
- The board's own Advisor model setting is gone; it was never the Claude app's advisor. Settings now says that the app's advisor is separate, may be on, and how to turn it off.
- In the open card the lists now read Lane, Model, Thinking, Type, in three headed, outlined groups so each is easy to find.
- A private-text check (node tools/private-check.mjs) stops secrets, personal data, local paths and private names before a commit, a merge and a publish; a hit holds the card with GATE: private text.
- In chat, "delete bug 12" removes a duplicate or junk card; a card with a branch, a pull request or child cards is refused.

## 0.2.2

What changed:

- The lines above the lanes now say what is wrong per kind of problem, in full, in warning colour, with the next step and a `Show all` button, and for cards with ID letters that are no type the pane and `list` suggest a retype, with a skill procedure for Claude to retype them when you say yes.
- A card you drop into Done or Discarded no longer keeps its flag: Claude clears it and Logs `cleared flag <text>`.
- When Claude cannot run a command and needs you to, the card's Log line now shows the exact command in backticks with the shell, what it does and why, so `Copy command` copies it.
- The board stays found when a chat's shell command changes folder (a Bash `cd` into `kanban\` used to make the pane show `This project has no board yet.`). The pane also finds a board when the chat is opened inside `kanban\` or below a folder that has one, and `set up the kanban board` no longer creates a board inside an existing one: it replies `Board already set up at <path> (N cards). /board opens it.`.
- The board no longer switches your chat's model. The pane says which model the chat is on and, when it is not the one the board suggests, offers Change to opus and Keep sonnet; the model picker under the prompt box is yours.
- Fast typing in the `New card` box, the comment field, the card title edit and the find field no longer drops, reorders or flashes letters.
- The Kanban pane always draws the board or a visible error line, even when the app sends no usable width or a call fails.

## 0.2.1

What changed:

- The open card's Log can be copied: press a Log line's date to copy the whole line (date, time, name and words; the words stay plain text that wraps and are not pressable); a line that holds text between backticks has a `Copy command` button under it for each such stretch (it copies only that text, exactly as written); and `Copy entire log`, beside the `Log` heading, copies every line, also the hidden ones, oldest first. They show `Copied the Log line.`, `Copied the command.` or `Copied the entire log.`, and also work when the board cannot be read. Nothing is written and nothing is sent to Claude.
- Pressing `Approve and run`, `Approve and continue` or `Retry in Auto` in the open card now closes the card and shows the lanes, as `◂ Board` does. The move, the Log line, the toast and the message to Claude are the same as before. A refused press leaves the card open; the `Lane` list and `Comment` also keep it open.

## 0.2.0

What changed:

- New command `/kanban:setup`: sets up a kanban board in the project and opens it. `/kanban:kanban` and `set up the kanban board` do the same.
- The board pane opens when you type `/kanban:setup` or `/kanban:kanban`, and when the board file is written, so you no longer type `/board` after set-up.
- One-command install: `claude plugin install kanban --marketplace J-J-E/claude-kanban`.
- Every card has a type (`bug`, `enhancement`, `chore`, or the types in the board's `types:` list). The type's letters replace `KB` in the ID: `BUG-0012`, `ENH-0007`, `CHORE-0001`. The branch for a card is `<letters>-<n>-<slug>`, for example `bug-12-fix-the-date`.
- Each type counts from 1 on its own. The counter lines `next_<letters>` in `kanban/board.md` (`next_bug: 13`) replace `prefix:` and `next_id:`.
- New verb: retype. A card gets another type, takes the next number of that type, and its old ID keeps working. `bug 12`, `bug-12`, `BUG-0012` and `enhancement 7` all name a card; a bare number works only when one card has it.
- The pane: `New card` has a `Type` list, and the open card has a `Type` list that asks `Retype BUG-0012 as enhancement? Its ID will change.` before it asks Claude to retype.
- Chat: `add a bug: ...`, `add an enhancement from bug 12: ...`, `retype bug 12 as enhancement`.
- MCP server: `card_add` takes a required `type` and an optional `from`; new tools `card_retype` (`id`, `type`, `who`) and `types`.
- The demo project's cards are `ENH-0001`, `ENH-0002` and `CHORE-0001`.

### Upgrading a board made by an older copy

An older board has cards named `KB-…` and a `prefix:` or `next_id:` line in `kanban/board.md`. A Claude session that finds one does this, and never renumbers a card or renames a card file by hand:

1. Leave the `prefix:` and `next_id:` lines alone. They are ignored and kept as they are.
2. Either keep the cards under their old letters, or retype them. Both can be done for different cards.
3. To keep the old letters, edit `kanban/board.md` and add a `types:` list that holds the three default types and one for the old letters, for example:
   ```
   types:
     - bug (BUG)
     - enhancement (ENH)
     - chore (CHORE)
     - legacy (KB)
   ```
   A `types:` list replaces the defaults, so the three default types must be in it. Add the line `next_kb: <the old next_id value>` so the number of a card that was deleted is not handed out again. The `KB-…` cards then have a type and keep their IDs.
4. To change a card's type instead, ask for it: `retype KB-0034 as bug`. The card gets the next `BUG-` number and the Log line `retyped from KB-0034 to BUG-0013`, and `KB-0034` keeps working as its old ID. A card in an Auto lane, or one an agent is working on, is refused until it is moved out or finished.
5. A `KB-…` card whose letters are no type on the board still shows and the board stays editable; the open card's `Type` list shows `No type`, and `list the board` reports `unknown-type` until step 3 or 4 is done.

The rules behind these steps are in `skills/kanban/references/format.md`, sections 6 and 7.
