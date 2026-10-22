# Onboarding tour

The text of the tour card that `init` writes on a new board, the two sample tickets made when the owner accepts, the two checks, and what Claude says at each step. The `tour` verb in `references/verbs.md` is the rules; this file is the words. Values in braces are filled in when a file is written: `{ID}` the card's ID, `{OWNER}` the board owner, `{LANE}` the label of the first `intake` lane, `{DATE}` and `{TIME}` the stamp (rule 5 of SKILL.md), `{ORDER}` the lane's next `order` (format.md section 9), `{TOUR}` the tour card's ID, `{A}` and `{B}` the two ticket IDs, `{GREETING_A}` and `{GREETING_B}` the two lines (defaults below). Each card block is the whole file, frontmatter first, as format.md sections 3 and 4 write a card.

## The defaults

- `{GREETING_A}` is `Hello from the board.`
- `{GREETING_B}` is `Goodbye from the board.`
- Folder: `kanban-sample/`. The two files are `kanban-sample/hello.txt` and `kanban-sample/goodbye.txt`, one line each, nothing else in them.

## The tour card

Written by init into the first `intake` lane, only on a board that init just made. Type enhancement: on a new board it is `ENH-0001`. File name `kanban/{ID}-run-through-the-sample-workflow.md`.

```card tour
---
id: {ID}
status: {LANE}
order: {ORDER}
created: {DATE}
updated: {DATE}
flag:
branch:
pr:
parent:
labels: [tour]
---
# Run through the sample workflow

A short walk through the board, using two tiny tickets that write one line each into `kanban-sample/`. Nothing is made until you accept, and nothing outside `kanban-sample/` and this board is touched.

To accept: drag this card to Plan or Auto (or say `start the tour`).
To reject: drag this card to Discarded (or say `skip the tour`). Nothing else is created.

The two files hold `Hello from the board.` and `Goodbye from the board.` To change that wording, tell Claude before you drag the first ticket.

Steps (Claude ticks each one as you finish it). Everything is done on the board, by dragging:

- [ ] 1. Accept: drag this card to Plan or Auto. Claude makes two sample tickets in Pending, each with its test case.
- [ ] 2. Example 1, through Plan: in Pending, drag "Add kanban-sample/hello.txt" to Plan. Claude writes a plan and the ticket moves to Needs You. Open it there and read the plan.
- [ ] 3. Approve it: drag "Add kanban-sample/hello.txt" from Needs You to Auto. Claude makes the file and runs test case 1.
- [ ] 4. Example 2, straight through Auto: in Pending, drag "Add kanban-sample/goodbye.txt" to Auto. Claude makes a branch, the file, runs test case 2, commits and merges.
- [ ] 5. Finish: drag this card to Done. Claude notes that `kanban-sample/` can be deleted.

Plan is for when you want to read a plan first: Claude writes the steps, the card waits in Needs You, and you approve by dragging it to Auto. Auto is for when you trust the card: Claude does it end to end and only stops to ask or when something looks risky. Needs You holds everything that waits on you.

Test case 1: `kanban-sample/hello.txt` exists and its only line is `Hello from the board.`
Test case 2: `kanban-sample/goodbye.txt` exists and its only line is `Goodbye from the board.`

## Log
- {DATE} {TIME} {OWNER}: created in {LANE}
```

## Sample ticket A

Made on accept, together with ticket B, in the first `intake` lane. The two tickets are numbered together (format.md section 7, `k` = 2): `{ID}` is the first number here and the next one in ticket B.

```card ticket-a
---
id: {ID}
status: {LANE}
order: {ORDER}
created: {DATE}
updated: {DATE}
flag:
branch:
pr:
parent:
labels: [tour-sample]
---
# Add kanban-sample/hello.txt

Add the file `kanban-sample/hello.txt`. It holds exactly one line: `{GREETING_A}`

Test case 1: `kanban-sample/hello.txt` exists and its only line is `{GREETING_A}`

Part of the tour {TOUR}. Drag this ticket from Pending to Plan to see how a plan is written and approved.

## Log
- {DATE} {TIME} Claude: created in {LANE}
```

## Sample ticket B

```card ticket-b
---
id: {ID}
status: {LANE}
order: {ORDER}
created: {DATE}
updated: {DATE}
flag:
branch:
pr:
parent:
labels: [tour-sample]
---
# Add kanban-sample/goodbye.txt

Add the file `kanban-sample/goodbye.txt`. It holds exactly one line: `{GREETING_B}`

Test case 2: `kanban-sample/goodbye.txt` exists and its only line is `{GREETING_B}`

Part of the tour {TOUR}. Drag this ticket from Pending straight to Auto to see a card run end to end.

## Log
- {DATE} {TIME} Claude: created in {LANE}
```

## The two checks

Plain checks, not tied to a shell. A worker runs each with whatever the machine has (read the file and compare) and reports pass or fail.

- Test case 1: the file `kanban-sample/hello.txt` exists, and reading it gives exactly one line, `{GREETING_A}`
- Test case 2: the file `kanban-sample/goodbye.txt` exists, and reading it gives exactly one line, `{GREETING_B}`

## The two examples

- Example 1 (through Plan): the owner drags ticket A from Pending to Plan. A planning agent writes a one-step plan (make the file, run test case 1); the ticket moves to Needs You as `PLAN READY`. The owner reads the plan there and drags the ticket to Auto. A worker makes the file and runs test case 1; Claude reviews, commits, merges and moves the ticket to Done.
- Example 2 (straight through Auto): the owner drags ticket B to Auto. Claude plans it without stopping, makes the branch, a worker makes the file and runs test case 2, Claude commits and merges, and the ticket goes to Done.

## What Claude says at each step

Short, in chat. The board is where the owner acts: every line says which lane to look in and which ticket to drag, by its title, and none asks for an answer typed in chat. Text in backticks is said as written with the real names filled in. Between steps the tour card's Log gets a `waiting on {OWNER}: ...` line that names the action to do. It holds no card ID (an ID in a `waiting on` line is read as a card being waited on); the pane shows it as written.

1. Accepted (the card dragged to Plan or Auto, or `start the tour`). Make both sample tickets at once with the default lines (nothing to answer first). Say `Tour started. On the board, look in Pending: two tickets are there. Drag "Add kanban-sample/hello.txt" from Pending to Plan. To change the wording of the two lines, tell me before you drag it.` Tick step 1. Log `tour started`, `tour: made {A} and {B}`, then `waiting on {OWNER}: drag the hello.txt ticket from Pending to Plan`.
2. When "Add kanban-sample/hello.txt" reaches Needs You with `PLAN READY`. Say `On the board, look in Needs You: "Add kanban-sample/hello.txt" has a plan. Open it and read the plan, then drag it from Needs You to Auto.` Tick step 2. Log `waiting on {OWNER}: drag the hello.txt ticket from Needs You to Auto`.
3. When it is Done. Say `"Add kanban-sample/hello.txt" is in Done: kanban-sample/hello.txt passed test case 1. Now drag "Add kanban-sample/goodbye.txt" from Pending to Auto.` Tick step 3. Log `tour: {A} done`, then `waiting on {OWNER}: drag the goodbye.txt ticket from Pending to Auto`.
4. Watching the pane. While a card runs, say once `On the board, "Add kanban-sample/goodbye.txt" is in Auto: its tile shows the step running, its Log shows each step and the branch, and a flag in Needs You means it needs you.` Do not repeat it.
5. When the second ticket is Done. Say `"Add kanban-sample/goodbye.txt" is in Done: kanban-sample/goodbye.txt passed test case 2. Last step: drag "Run through the sample workflow" from <its lane> to Done.` Tick step 4. Log `tour: {B} done`, then `waiting on {OWNER}: drag the tour card from <its lane> to Done`.
6. Finish (the tour card dragged to Done, or `finish the tour`). Say `Tour done. kanban-sample/ can be deleted.` Tick step 5. Log `tour finished: kanban-sample/ can be deleted`.
7. Rejected (the card dragged to Discarded, or `skip the tour`). Say `Tour skipped. Nothing was created.` Nothing else is written.
