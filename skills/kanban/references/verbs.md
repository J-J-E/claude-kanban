# Rare verbs

Moved out of SKILL.md word for word. Every verb starts with rule 1 of SKILL.md (read `kanban/board.md` first). "Refusal" means the verbatim text in `references/refusals.md`; change no file and print only that text.

### init

Trigger: "set up the kanban board", "set up a kanban board", `/kanban:setup`, `/kanban:kanban` when there is no `kanban/board.md`, or the prompt `Kanban: set up a board here with the kanban skill.` Init creates a board only when none is found at or above the current folder (step 1). Also run when `kanban/board.md` is missing and the person said `kanban` with no verb, or asked to set up, create, make, start, open or show a kanban board (rule 1).

1. Look for a board that already exists: `kanban/board.md` in the current folder, `kanban/board.md` in each parent folder up to the drive root, and `board.md` in the current folder when the current folder is itself named `kanban`. If one is found, count its card files (format.md section 1), reply `Board already set up at <path> (N cards). /board opens it.` with the path of that `board.md`, and create nothing. Stop. This is the one verb that does not require a board.
2. If the person has already said whose board it is, use that name and do not ask. Otherwise run `git config user.name`. When it prints a name, use its first word (it can be a handle like `J-J-E` rather than a name) and do not ask. Only when it prints nothing, ask `Whose board is this?` and wait for the answer. The owner is one first name with no colon.
3. Create `kanban/` if needed. Write `kanban/board.md` with the Write tool, never a shell command (the pane opens on that write), from the first board example in format.md section 13, with the owner. It holds only `owner` and `lanes:`: write no `types:`, counter or settings lines, because an absent line takes its default (format.md section 6): the types bug, enhancement and chore, each counting from 1. The body is `# Board notes` followed by one blank line; do not write the "Free text." placeholder from the example.
4. Write `kanban/DECISIONS.md` as the `# Decisions` heading and a blank line, with no decision lines (format.md section 10).
5. Reply `Board ready for <owner>: Needs You, Pending, Plan, Auto, Backlog, Done, Discarded. /board opens it. Say "the owner is <name>" if <owner> is wrong.` Do not commit.
6. `the owner is <name>` (after init) edits only the `owner:` line of `board.md` and replies `Owner is now <name>.`

### set up the Obsidian view

Trigger: "set up the Obsidian view", "make an Obsidian board".

Obsidian 1.14 or later shows the board as a Kanban view of a `.base` file. This verb writes that file and nothing else.

1. Read `board.md`. Get the vault-relative path of the `kanban/` folder: the folder name `kanban` when the vault is this project's own folder, otherwise ask once `What is the path of this kanban folder inside your Obsidian vault?` and wait. A path holds no `"` or `\`.
2. Write `kanban/Board.base` (replace it if it exists), LF line endings, ending with a newline. Write the lines below with every lane label of `board.md`, in board order, in `groupOrder`; the `file.folder` line is the path from step 1.

```
filters:
  and:
    - file.ext == "md"
    - file.hasProperty("id")
    - file.hasProperty("status")
    - file.folder == "<path>"
views:
  - type: kanban
    name: Board
    groupBy:
      property: note.status
      direction: ASC
    groupOrder:
      - "<lane label>"
    order:
      - file.name
      - note.id
      - note.flag
    sort:
      - property: note.order
        direction: ASC
```

3. Change no card and no other file. `Board.base` is not a `.md`, so the card reader ignores it. After a lane is added, renamed or moved, say "set up the Obsidian view" again.
4. Reply `Obsidian view written: kanban/Board.base. Open it in Obsidian 1.14 or later; a card dragged there changes only its status.` Do not commit.

### delete

Trigger: "delete bug 12", "BUG-12 is a duplicate, delete it", or `Kanban: <owner> asked to delete <ID> "<title>". Delete the card with the kanban skill.`

For duplicates and junk. Abandoned real work goes to the lane with role `scrapped`.

1. Resolve the card as in move step 1.
2. If `branch:` or `pr:` is set, change nothing and reply `BUG-0012 has work on <branch or pr>. Move it to Discarded, or say "delete bug 12 anyway".` When the person has said "delete bug 12 anyway", skip this step only.
3. If other cards have `parent: <ID>`, change nothing and reply `BUG-0012 has child cards: <IDs>. Delete or re-parent them first.`
4. Otherwise delete the card file (`git rm` when it is tracked, else remove it) and nothing else. Do not touch the type's counter line: the number is never reused.
5. Reply `BUG-0012 deleted.`

### retype

Trigger: "retype bug 12 as enhancement", "make BUG-12 a chore", or `Kanban: <owner> asked to retype <ID> "<title>" as <type>. Retype the card with the kanban skill.` Claude never retypes on its own: only when the person asks, or on that pane prompt.

1. Resolve the card as in move step 1. Match the new type against the board's type names and letters, case-insensitively. Refuse, changing nothing:
   - no such type: unknown-type refusal;
   - the card already has that type: `BUG-0012 is already a bug.`;
   - the card is in an `auto` lane, or an agent is on it: being-worked refusal.
2. Take the stamp. Reserve the new type's number as in add steps 3 and 4 (reserve-first, on the new type's counter line). Call it `<new ID>`.
3. Rename the file to `kanban/<new ID>-<same slug>.md` (`git mv` when it is tracked, else a plain move).
4. In the renamed card edit `id:` to `<new ID>` and `updated:` to today, and append `- <stamp> <who>: retyped from <old ID> to <new ID>`.
5. In every card whose `parent:` is the old ID, set `parent:` to the new ID. Touch no other line of those cards.
6. Change nothing else: not `branch:`, `pr:`, the branch itself, the body, or mentions of the old ID in other cards and DECISIONS.md.
7. Reply `BUG-0012 is now ENH-0007.`, adding ` Branch bug-12-fix-the-date is kept.` when `branch:` is set.

#### Cards with unknown ID letters

Follow this when the person asks to fix cards whose ID letters are no type on the board (problem `unknown-type`), or says yes after `list` shows it.

1. Say what was found and suggest a retype, in one line, and wait for a yes. Claude never retypes on its own.
2. For each offending card pick the type from what the card is: a defect is a bug, a new ability an enhancement, upkeep, docs or checks a chore. When the person wants to choose, ask once, in one question listing the cards.
3. Retype each card with the retype verb above, exactly as written. A card in an `auto` lane is refused as usual: say so and leave it.
4. Reply one line per card, `KB-0001 is now CHORE-0011.`
5. Leave any `prefix:` and `next_id:` lines in `board.md` alone (format.md says they are ignored).

### merge

Trigger: "merge bug 12 into bug 8", "BUG-12 is the same as BUG-8, merge them", or `Kanban: <owner> asked to merge <ID> "<title>" into <ID> "<title>". Merge the cards with the kanban skill.` The first card is merged into the second, which survives with its ID, lane and place (format.md section 7). Claude merges only when the person asks or on that pane prompt.

1. Resolve both cards as in move step 1 (an old ID is followed). Call the first card A (it goes away) and the second B (it stays). Refuse, changing nothing, in this order:
   - A and B are the same card: same-card refusal;
   - either is in an `auto` lane, or an agent is on it: being-worked refusal for the merge;
   - one is the parent of the other: parent refusal;
   - A has `branch:` or `pr:` set: has-work refusal;
   - other cards have `parent: <A's ID>`: has-children refusal.
2. Take the stamp. Edit B, and only B (format.md section 11): add the section `## Merged from <A's ID>: <A's title>` just before `## Plan` (else `## Log`, else at the end), holding A's body text, open questions and plan steps with A's `## ` headings written as `### ` and A's title and Log left out; set `labels:` to B's labels plus A's that B lacks; set `updated:` to today; append `- <stamp> <who>: merged <A's ID> "<A's title>" into <B's ID>`.
3. Delete A's file (`git rm` when it is tracked, else remove it) and nothing else. Do not touch any counter line.
4. Reply `BUG-0012 merged into BUG-0008.` (names as in Card IDs when an old ID was followed).

### parent

Trigger: "make ENH-0033 a child of ENH-0025", "ENH-0025 is the parent of ENH-0033", "remove ENH-0033's parent". Claude sets or removes a parent only when asked. The pane's Parent list does the same (format.md section 11) and the MCP tool `card_parent` too.

1. Resolve the card (the child) as in move step 1, and the new parent the same way (an old ID is followed). Refuse, changing nothing:
   - the child is in an `auto` lane, or an agent is on it: being-worked refusal for the parent verb;
   - to set: the child and the parent are the same card, the parent is not on the board, the card already has that parent, or the parent is the child's own descendant: the parent refusals;
   - to remove: the card has no `parent:`: `<ID> has no parent. Nothing was changed.`
2. Take the stamp. Edit the child, and only the child: set `parent:` to the parent's ID (empty to remove), `updated:` to today, and append `- <stamp> <who>: parent set to <parent ID>` or `- <stamp> <who>: parent removed (was <old parent ID>)`.
3. Reply `ENH-0033 is now a child of ENH-0025.` or `Removed the parent of ENH-0033.` (names as in Card IDs when an old ID was followed).

### decide

Trigger: "decide: Pending is the inbox, because one place", "record a decision".

1. Read `kanban/DECISIONS.md`. If it is missing, create it as in init step 4. Its grammar is format.md section 10.
2. Find a title, the decision and the reason in what the person said. If the reason is missing, ask once; do not invent it.
3. Take the stamp; the date is its first ten characters.
4. `n` is the highest `D<n>` in the file + 1, or 1 when there are none. Append at the end: `- **D<n> (<date>) <title>:** <decision>. Reason: <why>.` The title is a few words with no `*`. Add a trailing period to the decision and to the reason when the person's text has none.
5. To change an earlier decision, append a new line that ends `Supersedes D<k>.` and leave the old line alone.
6. Reply `D2 recorded: <title>`.

## The frequent verbs, step by step

The manual steps of add, move, comment, list and what's next, moved out of SKILL.md word for word. Use them only when the board's MCP tools (SKILL.md, Verbs) are missing; the tools do the same steps. The reply formats and the rules both paths share stay in SKILL.md.

### add

Trigger: "add a card: ...", "add a bug: ...", "add to Pending", "add an enhancement from bug 12: ...".

1. Read `types`, `owner` and the first `intake` lane from `board.md`. The type is the one the person names ("add a bug: ..."). If none is named, ask once `Bug, enhancement or chore?` (the board's own type names, in board order) and wait; a batch of adds gets one question. A name that is no type on the board: unknown-type refusal. A card Claude makes on its own is typed by Claude; a plan's child cards take the parent's type. Then read the type's counter line `next_<letters lowercase>` (absent is 1).
2. Take the stamp (rule 5).
3. ID: `n = max(counter, highest existing file for those letters + 1, highest retired n for those letters + 1)`, padded to 4 digits (format.md section 7).
4. Reserve the number before anything else: Edit `board.md`, old text the exact line `next_bug: <counter as read in step 1>`, new text `next_bug: <n + 1>` (the type's own letters; `next_bug: 13` becomes `next_bug: 14`). An absent line is added as `next_bug: <n + 1>` just before the closing `---`. If that exact line is no longer in the file (or a line has appeared), re-read `board.md` and redo step 3 with the new value. A reserved number is never given back (format.md section 7).
5. Slug from the title (format.md section 8). The filename is `kanban/<ID>-<slug>.md`. Before writing it, check that no file in `kanban/` already starts with `<ID>-`; if one does, go back to step 3 and reserve a new number.
6. `order`: read the `status:` and `order:` lines of the cards in that lane; use the highest `order` + 1000, or 1000 when the lane is empty (format.md section 9).
7. Write the card with every key from format.md section 3, in that order: `status` is the intake lane's label, `created` and `updated` are today, `flag`, `branch`, `pr` and `parent` are empty, and `labels` is `[]`. Use `labels: [claude]` only for Claude's own suggestions, and log those as `Claude`.
8. Body: `# <title>`, then the person's words verbatim. When the title is all they said, leave the body empty. Add `## Open questions` with a `- ` line for each question the request leaves open, phrased as a question where the person's words allow, never with a suggested answer; omit the section when there are none. Then `## Log` with `- <stamp> <who>: created in <lane>`. Leave one blank line after `# <title>` and one blank line before each `##` heading.
9. "From <card>" (resolve it as in Card IDs; no card: missing-card refusal, before step 2): also append `spawned from <source ID>` to the new card's Log and `spawned <new ID>: <title>` to the source card's Log, set the source's `updated:`, and set no `parent:`.
10. Reply `BUG-0013 added to Pending: <title>` with the real ID, lane label and title.

### move

Trigger: "move bug 12 to Auto", "BUG-0012 -> Plan", "put bug 12 in Backlog".

1. Resolve the ID as in Card IDs (an ambiguous bare number: its reply and stop). Find `kanban/<ID>-*.md`. No file: missing-card refusal. More than one: duplicate-ID refusal.
2. Match the target against the lane labels. No match: unknown-lane refusal.
3. In chat the person is the mover. If the target role is `needs-you`, give the Claude-only refusal and write nothing. The pane refuses such a drop too and writes nothing.
4. If the card's `status:` already equals the target (ignoring case), reply `BUG-0012 is already in <lane>.` and change nothing. A card whose `status:` is not a board lane may always be moved out.
5. Take the stamp. Edit three lines: `status:` to the label spelled as in `board.md`, `updated:` to today, and `order:` to the target lane's highest `order` + 1000 (1000 when empty; the moved card does not count). Append `- <stamp> <who>: moved <from> -> <to>`, where `<from>` is the old `status:` text.
6. Reply `BUG-0012 moved Pending -> Auto.` Then, unless the target role is `intake` or `backlog`, run the lane action for that role (Lane actions in SKILL.md); its one-line reply follows this one. A move of a card whose `flag` starts with `GATE` out of a `needs-you` lane into an `auto` lane is the gate approval.

When Claude itself moves a card into `needs-you` (a question, a plan to approve, a held action), that is allowed; write the Log line as `Claude`. Lane actions make those moves.

### comment

Trigger: "comment on bug 1: waiting on Sam".

1. Resolve the card as in move step 1.
2. Take the stamp. Append `- <stamp> <who>: <text>` after the last non-blank line of `## Log`, with the text collapsed to one line. If the card has no `## Log`, create it at the end after a blank line (format.md section 4). Set `updated:` to today. Never touch `status:`.
3. Reply `Comment added to BUG-0001.`

### list

Trigger: "list the board", "show the board".

1. Read `board.md` and the frontmatter and title of every card file in `kanban/`.
2. Print each lane in board order on its own line as `Lane (n)`, empty lanes included, and under it that lane's cards by `order` (a missing `order` reads as 0), ties by ID, indented two spaces, one per line as `ID title [flag]`. Leave out `[flag]` when the flag is empty.
3. If anything is wrong, end with one `Fix needed:` line naming each problem by its code from format.md section 12: a card whose `status:` is not a board lane (`unknown-lane`), two files with one ID (`duplicate-id`), a card whose ID letters are no type on the board (`unknown-type`), a file that will not parse. When the `Fix needed:` line names `unknown-type`, add one more line after it, built from the board as `To fix unknown-type: retype each card to a type on this board (<the board's type names, the last after "or"> here), e.g. "retype <an offending ID> as <the board's last type name>".` Print no `Fix needed:` line when nothing is wrong. Fix nothing yourself.

### what's next

Trigger: "what's next", "what should I look at", or bare `/kanban:kanban` when the board exists.

1. Read all cards as in list.
2. Print four sections. Each heading is a plain text line (`Queued for Claude`, `Waiting on you`, `Untriaged`, `Left hanging`) followed by its items as `ID title [flag]`, indented two spaces:
   - Queued for Claude: the cards waiting for Claude (the turn rule under Manager and agents): cards in a lane with role `auto` that nothing has started (the card's Log has no `Claude: started` line after its newest `moved ... -> <that lane>` line), then cards in a lane with role `plan`.
   - Waiting on you: cards in lanes with role `needs-you`.
   - Untriaged: cards in lanes with role `intake` only (a `backlog` lane is not untriaged), oldest first (by `created`, ties by ID).
   - Left hanging: cards in a lane with role `auto` that have a `Claude: started` line and are not waiting (the newest `Claude:` Log line does not start `waiting on`, or every card ID it names is Done), as `ID title - last Log <age> ago`, age of the newest Log line (`45m`, `7h`, `3d`). It reports age only and never claims nobody has it (`references/lanes-auto.md`, Running, waiting, nobody).
3. Show at most five per section, then `and N more`. An empty section prints `none`. Both are indented two spaces.
