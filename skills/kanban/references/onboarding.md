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

To accept: drag this card to Plan or Auto, or tell Claude `start the tour`.
To reject: drag this card to Discarded, or tell Claude `skip the tour`. Nothing else is created.

Steps (Claude ticks each one as you finish it):

- [ ] 1. Design a simple thing. The tour adds two files holding one greeting line each. Change the wording if you like, or say `go` to keep `Hello from the board.` and `Goodbye from the board.`
- [ ] 2. Claude makes the two sample tickets in Pending, each with its test case.
- [ ] 3. Example 1, through Plan: drag the first ticket to Plan. Claude writes a plan and the ticket moves to Needs You. Read the plan there.
- [ ] 4. Approve it by dragging the ticket from Needs You to Auto. Claude makes the file and runs test case 1.
- [ ] 5. Example 2, straight through Auto: drag the second ticket to Auto. Claude makes a branch, the file, runs test case 2, commits and merges.
- [ ] 6. Finish: drag this card to Done. Claude notes that `kanban-sample/` can be deleted.

Plan is for when you want to read a plan first: Claude writes the steps, the card waits in Needs You, and you approve by dragging it to Auto. Auto is for when you trust the card: Claude does it end to end and only stops to ask or when something looks risky. Needs You holds everything that waits on you.

Test case 1: `kanban-sample/hello.txt` exists and its only line is `Hello from the board.`
Test case 2: `kanban-sample/goodbye.txt` exists and its only line is `Goodbye from the board.`

## Log
- {DATE} {TIME} {OWNER}: created in {LANE}
```

## Sample ticket A

Made on accept, after step 1, in the first `intake` lane. The two tickets are numbered together (format.md section 7, `k` = 2): `{ID}` is the first number here and the next one in ticket B.

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

Part of the tour {TOUR}. Drag this ticket to Plan to see how a plan is written and approved.

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

Part of the tour {TOUR}. Drag this ticket straight to Auto to see a card run end to end.

## Log
- {DATE} {TIME} Claude: created in {LANE}
```

## The two checks

Plain checks, not tied to a shell. A worker runs each with whatever the machine has (read the file and compare) and reports pass or fail.

- Test case 1: the file `kanban-sample/hello.txt` exists, and reading it gives exactly one line, `{GREETING_A}`
- Test case 2: the file `kanban-sample/goodbye.txt` exists, and reading it gives exactly one line, `{GREETING_B}`

## The two examples

- Example 1 (through Plan): the owner drags ticket A to Plan. A planning agent writes a one-step plan (make the file, run test case 1); the ticket moves to Needs You as `PLAN READY`. The owner reads the plan there and drags the ticket to Auto. A worker makes the file and runs test case 1; Claude reviews, commits, merges and moves the ticket to Done.
- Example 2 (straight through Auto): the owner drags ticket B to Auto. Claude plans it without stopping, makes the branch, a worker makes the file and runs test case 2, Claude commits and merges, and the ticket goes to Done.

## What Claude says at each step

Short, in chat. Text in backticks is said as written with the real names filled in. Between steps the tour card's Log gets `waiting on {OWNER}: tour step <n>`, so the card reads as waiting on a person, not as left hanging.

1. Accepted (the card dragged to Plan or Auto, or `start the tour`). Say `Tour started. First, design a simple thing: the tour adds kanban-sample/hello.txt and kanban-sample/goodbye.txt, one line each. Change the wording if you like, or say "go" to keep "Hello from the board." and "Goodbye from the board."` Log `tour started`, then `waiting on {OWNER}: tour step 1`. Wait for the answer.
2. After the answer (`go` or new wording). Make the two tickets. Say `Made {A} and {B} in Pending, each with its test case. Drag {A} to Plan.` Tick steps 1 and 2. Log `tour: made {A} and {B}`, then `waiting on {OWNER}: tour step 3`.
3. When {A} reaches Needs You with `PLAN READY`. Say `{A} has a plan, waiting in Needs You. Read it there. Drag it to Auto to approve, or comment to change it.` Tick step 3. Log `waiting on {OWNER}: tour step 4`.
4. When {A} is Done. Say `{A} done: kanban-sample/hello.txt passed test case 1. Now drag {B} to Auto.` Tick step 4. Log `tour: {A} done`, then `waiting on {OWNER}: tour step 5`.
5. Watching the pane. While a card runs, say once `In the pane, {B} is in Auto: its tile shows the step running, its Log shows each step and the branch, and a flag in Needs You means it needs you.` Do not repeat it.
6. When {B} is Done. Say `{B} done: kanban-sample/goodbye.txt passed test case 2. Drag {TOUR} to Done to finish.` Tick step 5. Log `tour: {B} done`, then `waiting on {OWNER}: tour step 6`.
7. Finish (the tour card dragged to Done, or `finish the tour`). Say `Tour done. kanban-sample/ can be deleted.` Tick step 6. Log `tour finished: kanban-sample/ can be deleted`.
8. Rejected (the card dragged to Discarded, or `skip the tour`). Say `Tour skipped. Nothing was created.` Nothing else is written.
