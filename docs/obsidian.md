# Obsidian as a viewer: what Obsidian needs

Facts marked (app code) were read from the installed Obsidian 1.14.4 (`C:\Users\<you>\AppData\Local\Programs\Obsidian\resources\obsidian.asar`, its bundled JavaScript), because the help pages do not say what a drag writes. Nothing here has yet been seen on a real drag; step 3 of the card tests that with saved card files.

## Answer

- **Version.** Obsidian 1.14 or later. Checked with 1.14.4.
- **View.** The Kanban layout is built into Obsidian's Bases core plugin since 1.14. No community plugin is needed, so the "is a community plugin acceptable" question does not arise.
- **The open question on the card** (is `status` plus a numeric `order` enough?): yes for columns, no for order inside a column. The board's `status` text is the column; `order` is read as a number and used as the view's sort. Obsidian never writes a card order, so a drag cannot place a card between two others.

## Sources

- Layouts and the version each arrived in (Table 1.9, Cards 1.9, List 1.10, Kanban 1.14): https://obsidian.md/help/bases/views
- 1.14.0, 2026-09-02, "Added a new kanban layout to display files in ordered columns. Use Group by to define the columns, then drag and drop to reorder them": https://obsidian.md/changelog/2026-09-02-desktop-v1.14.0/
- 1.14.4, 2026-10-01, "Hide column" in a column's right-click menu: https://obsidian.md/changelog/2026-10-01-desktop-v1.14.4/
- 1.14.4, 2026-10-05, drag cards between groups; a Group menu to reorder, hide or add groups: https://obsidian.md/changelog/2026-10-05-desktop-v1.14.4/
- `.base` file syntax (filters, properties, views, groupBy, groupOrder, order): https://obsidian.md/help/bases/syntax
- Filter functions (`file.hasProperty`, `file.inFolder`, `file.folder`): https://obsidian.md/help/bases/functions

## The `.base` format

A `.base` file is YAML. Obsidian writes a view's keys in the order `type`, `name`, `filters`, `groupBy`, `groupOrder`, `order`, `limit`... and `sort` (app code), and `buildBaseText` follows that order. For the board:

- `groupBy: {property: note.status, direction: ASC}` makes each distinct `status` value a column.
- `groupOrder` lists the column values in the order shown; this is how lane order survives (a plain sort would put the columns in alphabetical order). Obsidian rewrites it when a person reorders columns in the app.
- `order` is the list of properties a card shows (not a sort): `file.name`, `note.id`, `note.flag`. A card's title is the file name, `KB-0008-later-obsidian-as-a-viewer`; the `# Title` line is not a property, so Bases cannot show it.
- `sort: [{property: note.order, direction: ASC}]` orders the cards in every column. The sort key is `sort`, not `order`; the syntax page does not list it, but the app code serialises it.
- Filters: `file.ext == "md"`, `file.hasProperty("id")` and `file.hasProperty("status")` keep board.md and DECISIONS.md out; `file.folder == "<vault path of kanban/>"` is needed when the vault holds more than one project, because a Base searches the whole vault. The docs do not say whether `file.folder` is vault-relative; `file.path` is, so the generator assumes it is, to be confirmed in step 5.

The generated file is `kanban/Board.base`. It is not a `.md`, and `isCardFileName` requires `.md`, so the card reader ignores it (format.md section 1: other files are ignored).

## What a drag writes (app code)

Dragging a card to another column calls `moveCardToColumn`, which runs `app.fileManager.processFrontMatter` on the card and sets one property: the grouped one (`status`) to the column's value (or deletes the key when the column is "no value"). Nothing else is set: not `order`, not `updated`, no Log line.

`processFrontMatter` (function `vB` in the app code) does this to the file:

1. Finds the frontmatter between the opening `---` line and the closing `---` line, parses the text between them as YAML, runs the change, and **serialises the whole object again** with the YAML library (`nullStr: ""`, `lineWidth: 0`, no aliases).
2. Replaces only the text between the two fence lines. The fences, the body and everything after are kept byte for byte.
3. If the object ends up empty it removes the block.

Consequences for our subset (format.md section 2):

| What | Expected effect |
|---|---|
| Key order | Kept (object order); `status` stays in its place. No keys are added except the grouped one when it was absent. |
| `flag:` and other empty values | Read as null, written back empty (`flag:`), so the same as ours. Whether a space follows the colon is the one detail to confirm in step 3; our parser accepts both. |
| `labels: []` | Written back as `labels: []`. |
| `labels: [claude, ui]` | Rewritten as a block list (`labels:` then `  - claude`, `  - ui`). Our parser reads block lists, so it parses, but the bytes change. |
| Numbers, dates, plain words | Written plain, as now (`order: 29000`, `created: 2026-10-08`). |
| Line endings | The rewritten block uses LF. A CRLF card ends up with CRLF fences and an LF block, which breaks format.md's "edits keep the file's own EOL" until the pane next edits it. New cards are LF, so only hand-made CRLF cards are affected. |
| Quoting | The library adds quotes only where plain text would parse as something else. Our own quoting rule (section 2) is a subset of that. |
| `flag: GATE: deploy`, `flag: QUESTION: why?` | **Risk.** A plain YAML value cannot hold `: `. Obsidian cannot parse such a block (it marks it invalid), so a drag of a card flagged `GATE:` or `QUESTION:` is refused with an error on the card and the file is left untouched. Our grammar allows this value; YAML does not. These cards sit in Needs You, which Claude alone may enter, so it matters most for a drag out of Needs You. Not yet seen on a real drag. |
| `updated`, `order`, Log | Not touched. A card moved in Obsidian keeps its old `order` (it lands among the new lane's cards by that number, not last) and has no `moved A -> B` Log line. Step 4 of the card adds the Log line. |
| Lane rules | Obsidian does not know them: a card can be dragged into Needs You or out of a lane. |

Dragging within one column changes nothing on disk (the code calls `moveCardToColumn` only when the column differs), and the card position follows the `sort`.

## Other kanban views for Bases (not needed)

Search results (https://community.obsidian.md/plugins/kanban-bases-view and the listings for `kanban-base`, `bases-kanban`, `kanban-view`, `bases-kanban-view-ttvl`, `kanban-action-planner`) show several community plugins, for example xiwcx's Kanban Bases View (repo xiwcx/obsidian-bases-kanban, MIT; about 11k downloads on its stats page). Their versions, last release dates and what they write on a drag were not checked: the core view covers the need, and a plugin would only be considered if the core view proves wrong in step 3 or 5.

## Fixtures and the Log line (step 3 and 4)

- **Fixtures are derived, not saved from a real drag.** `tests/obsidian-compat.test.ts` holds card files built by hand from the app code: the installed Obsidian uses the `yaml` library v2 (not js-yaml): core schema, so a date like `2026-10-08` is read and written as plain text and stays unquoted; `nullStr: ""` so empty values stay `flag:`; block lists indented two spaces; a string is double-quoted only when plain text would read as something else (`flag: "GATE: deploy"`, `pr: "123"`), single-quoted when it holds a double quote; LF inside the block, so a CRLF card ends up mixed. They have not been compared with a file Obsidian really saved; replace them when John drags a card. Every one is read by our reader and a pane move on each changes only `status`, `order`, `updated` and one Log line (format.md section 11). No change to the reader was needed.
- **Not covered.** A single-quoted value holding an escaped quote (`'it''s'`) is read with its doubled quote, as the reader does not unescape; only `status`, `order` and `updated` are ever edited, so it is only displayed. A colon-space in a plain value stays unreadable by Obsidian (see the table above).
- **A move made in Obsidian.** The pane's refresh (`logOutsideMoves` in `hooks/register.tsx`) appends `- <stamp> <owner>: moved <old> -> <new> in Obsidian` when a card's `status` changed since the last refresh, its newest `moved ... -> <new>` Log line does not name the new lane, and the next refresh still sees the same state. No Claude turn starts, `order` is kept. Moves by the pane or by Claude already have their Log line, so they are skipped; the written line is what stops a repeat. Tested in `tests/obsidian-move.test.ts`.
