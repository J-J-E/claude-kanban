# Refusals

Moved out of SKILL.md word for word. Print exactly the text of the refusal that applies, with the placeholders filled, and nothing else. Change no file.

- Unknown lane (labels in board order, separated by `, `):
  `Unknown lane "<name>". Lanes on this board: <labels>. Nothing was changed.`
- Claude-only lane:
  `"<lane>" can only be entered by Claude (it holds a question, a plan to approve or a held action). Nothing was changed.`
- Missing card:
  `No card <ID> in kanban/. Nothing was changed.`
- Unknown type (the board's type names, separated by `, `):
  `Unknown type "<name>". Types on this board: <names>. Nothing was changed.`
- Ambiguous number:
  `More than one card is numbered <n>: <IDs>. Say which, for example "bug <n>". Nothing was changed.`
- Being worked (retype):
  `<ID> is being worked. Move it out of Auto or wait, then retype. Nothing was changed.`
- Merge into itself:
  `<ID> cannot be merged into itself. Nothing was changed.`
- Being worked (merge):
  `<ID> is being worked. Move it out of Auto or wait, then merge. Nothing was changed.`
- Parent and child (merge; the parent first):
  `<ID> is the parent of <ID>, so they cannot be merged. Nothing was changed.`
- Has work (merge; the branch, else the pull request):
  `<ID> has work on <branch or pr> and cannot be merged. Nothing was changed.`
- Has child cards (merge):
  `<ID> has child cards: <IDs>. Delete or re-parent them first. Nothing was changed.`
- Being worked (parent):
  `<ID> is being worked. Move it out of Auto or wait, then change its parent. Nothing was changed.`
- Own parent:
  `<ID> cannot be its own parent. Nothing was changed.`
- Parent not on the board (the missing card is the first the ID refusal covers; the pane prints this for a card gone from the board):
  `No card <ID> on the board. Nothing was changed.`
- Already the parent:
  `<ID> is already the parent of <ID>. Nothing was changed.`
- Loop (the child first, then the parent that is its descendant):
  `<ID> is above <ID>, so it cannot become its child (a loop). Nothing was changed.`
- No parent to remove:
  `<ID> has no parent. Nothing was changed.`
- No board:
  `No kanban/board.md here. Say "set up the kanban board" to create it.`
- Duplicate ID (the file names, separated by `, `):
  `More than one file has ID <ID>: <files>. Fix by hand; nothing was changed.`
