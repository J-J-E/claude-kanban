# Changelog

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
