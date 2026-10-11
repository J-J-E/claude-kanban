# Kanban pane: build spec, third pass

Replaces the second spec. Self-contained: everything an implementer needs without the mock. The drawings are in `mock.html`. Section 22 is the list of what changes from the built version. Widening is option B only (decided); thinking and the per-card override are section 18.

**Built as written.** The header, the toolbar, the Settings tab, the open card and the lane rows are built as written here (KB-0024, KB-0026, KB-0027). The lanes' own `+`, `↕`, column-heading sort controls, create field and menus are removed; the toolbar's `New card` and `Sort` replaced them. Lines below that still describe them are marked removed.

## 0. Read this first

**Units.** A cell is 8.25 px wide and 20 px tall (measured on the real pane). Every x, y, width and height is whole cells in the board region, origin top left. `W` is the pane width in cells, `H` its height. Designed for `W` from 60 to 150 and about 40 rows; it holds from 40 up. The pane scrolls vertically; the region grows to its content.

**Border rule.** A bordered box is drawn on the desktop as a thin line along its edge and takes no cell: its content starts at the box's edge. All sizes below are content sizes. In a terminal a border takes a cell on each side, so add `2b` to the height and the width of every bordered box, where `b` is 0 on the desktop and 1 in a terminal, and add `b` to the x and y of anything inside. Text is always inset by the padding given, never by the border.

**Fills and outlines.** `Box backgroundColor` paints. The surface fill is `userMessageBackground`. Every outline is `borderStyle: 'round'` (the engine has one corner). Solid lines only; no dashed, double or bold border styles are used (they are unverified). "Dim outline" is `borderDimColor: true` on the default outline colour; "bright outline" is `borderDimColor: false`.

**Never size a box from its text.** Widths and heights come from `W`, the lane count and the row counts below. Text that does not fit is cut at the box edge: single rows use `wrap="truncate-end"` in a flex row with a fixed or flexible width.

**Native controls** (`Button`, `Input`, `Select`, `Markdown`) are drawn and sized by the app. A `Select` reserves 2 rows and a `Button` 1, so a row that holds a `Select` is 2 rows tall and its other parts are centred on it. They are never recoloured. They are real controls only in the pane's own tree (the header, the toolbar, the Settings tab and the open card); inside the board region (a `Client`) they draw as text (`docs/design/desktop-paint-notes.md`).

**Which part draws what.** The header, the toolbar, the Settings tab and the open card are flex rows of native controls with no pixel positions. Only the lanes (names, card rows, the dragged card and the drop slot) are drawn in the board region, where the pointer can drag. A native control ignores the first click when the pane does not hold the keyboard; clicks in the board region act at once.

**Words.** Lane names are the board's own labels, never the English defaults. Strings that name another lane use `{inbox}` (the first `intake` lane), `{plan}`, `{auto}`, `{backlog}`, `{manual}`, `{parked}`, `{done}`, `{scrapped}` for the label of the first lane with that role. If the board has no lane with that role, leave out the sentence or button that needs it. A lane whose role has no entry in section 16 gets the generic row.

**The default lanes**, in board order (the seven that `defaultBoardText` writes): Needs You (`needs-you`), Pending (`intake`), Plan (`plan`), Auto (`auto`), Backlog (`backlog`), Done (`done`), Discarded (`scrapped`). Roles `manual`, `parked` and `gated` and the `, side` marker are no longer in the default board but stay valid, so an older board loads and works. Claude creates cards in Pending and moves cards only into Needs You, Auto, Done and Discarded; the owner moves cards anywhere else, and a drop into Needs You is refused.

**Lane facts.** Each lane has a label, a role, a side flag (no effect on behaviour), and a Claude-only flag (roles `needs-you` and `gated`; the default board has only Needs You, and a `gated` lane on an older board behaves exactly like it). One lane holds everything that waits on him: a plan to approve, a question, a failure, and a held action, told apart by the flag (a held card is a Needs You card with the reason `Held: ...`). A card is **waiting on him** only when its `flag` is not empty **and** it sits in a Claude-only lane (section 9). `M` is not used any more: every lane has the same layout.

## 1. Colour, fill and type

One font, one size. Hierarchy comes from fill, outline, weight, dimming and space.

| Role | Token | Dark (sampled) | Light (guess, check) | Used for |
|---|---|---|---|---|
| Ground | the pane's own | `#1a1a19` | `#faf9f5` | Between panels, between tiles, inside a lane panel |
| Surface | `backgroundColor: 'userMessageBackground'` | `#151515` | `#f0eee7` | The chosen tab's chip (and a tab under the pointer), the open card's title bar and status box |
| Card fill | `backgroundColor: 'composerSidebarBackground'` | | | Tiles, the Needs You title bar, the card menu block: a step darker than the surface in light (too faint otherwise, seen on the real pane, KB-0041). Fallback: `userMessageBackground` |
| Opaque cover | `composerSidebarBackground` | | | The card in hand, so it hides what is under it |
| Card states | outline keys | | | Resting: fill and outline are both the surface key. Under the pointer: outline `inactive` (the fill does not change, since a second fill would be a fixed colour). The open card: outline `subtle`. The card's own place while it is held or moving: no fill, outline `subtle`. Menu row under the pointer: fill `subtle`, text full strength |
| Plan bar | `inactive`, `subtle` | | | Done blocks `inactive` (the accent while a worker runs), empty blocks `subtle` |
| Refused-drop sentence | `warning` + `dimColor` | | | The lane only Claude fills, while dragging (dim amber, as before) |
| Lane outline | raw `#74746f` | | | Every lane panel and collapsed line (3.7 to 1 on dark, 4.4 to 1 on light). Use a theme key such as `subtle` instead if it paints and adapts |
| Resting outline | default, dim | about `#232323` | about `#dedcd4` | Tiles |
| Text | default | `#f0efec` | `#1f1e1d` | Titles, lane names (bold) |
| Quiet | `dimColor` | about `#a3a29a` | `#6b6a64` | IDs, counts, times, labels, sentences, finished cards |
| Waits on you | `warning` | `#db9300` | `#b87a00` | See below |
| Claude is on it | `claude` | `#c6613f` | `#c6613f` | See below |
| Refused, failed | `error` | `#ff6b80` | `#c4283c` | See below |
| Solid blocks | `inverse` | | | Used sparingly: the gray count chip and the gray pin chip (18.5). The header's "need you" button is the one filled native button (`variant="primary"`). Nothing Claude does is a solid block: working is shown by outline, text and bar |

**Orange (`warning`) means this waits on you, and nothing else:** the "need you" button in the header, a lane name and its count chip, the outline and reason line of a waiting card, the box in an open waiting card, `3 need you` on a collapsed lane's line. Always with a shape: `▲ ◆ ?` or a filled block or button.

**Accent (`claude`) means Claude is on it, will start it, or will act when you drop here:** the `● Working` label (accent text, no fill) and the outline of a card a worker is on; `○ Waiting to start`; `▰` step marks; `▶`; `● N working` and `○ N waiting to start` on a lane; a lane's outline and sentence while dragging when a drop makes Claude act; the `●` in the header.

**Red (`error`)** means refused or failed: Claude's lane while dragging, a failed card, Delete.

Weights: lane names, labels in boxes, the Working label, the card title in the open card: `bold`. IDs, counts, times, sentences, labels: `dimColor`. Finished cards (roles `done`, `parked`, `scrapped`): title `dimColor`.

**Spacing scale**

| Name | Size | Where |
|---|---|---|
| margin | 2 cells | Left of every panel; right the same (`B` below) |
| padding | 2 cells | Left and right inside a panel and inside a tile |
| gap | 1 row | Between header and first lane, between lanes, between cards, under a lane's title bar, after the last card |
| header, toolbar, Settings tab | 2 cells left and right, 1 row under | Flex rows of native controls; no fixed height |

## 2. Width rules, 60 to 150 cells

```
B     = min(W, 150) - 4            // board width: 2-cell margin each side; stops growing at 150
iw    = B - 4                      // inside a panel (2 cells of padding each side)
tile  = iw                         // outer tile width (one card per row at every width)
text  = tile - 4                   // text inside a tile
wide  = iw >= 100                  // the Label and Changed columns appear
idw   = clamp(longest ID on the board + 1, 8, 12)   // the ID column (`idWidth` in hooks/lib/lanes.ts)
```

**The ID column.** IDs are typed (`BUG-0012`, `ENH-0007`, `CHORE-0001`), so they differ in length. The ID column of a card row, its second row's indent and the dragged card's ID zone are `idw` cells: the longest ID of any card on the board (every lane, not only the cards drawn) plus one gap cell, never under 8 and never over 12. It is one width for the whole board, so the titles line up in every lane. A board of `BUG-` and `ENH-` IDs gets 9, one with `CHORE-0001` gets 11; an ID longer than 11 characters is cut like any over-long text. `text` and `tile` do not change; the title simply has `idw - 8` cells less.

The board is one column at every width. Cards never flow across. The board is left aligned; above 150 cells the rest is empty. These widths are for the lanes. The header, toolbar and Settings tab are flex rows and change their layout at the pane widths named in sections 3, 4 and 11.

| W | B | iw | text | wide |
|---|---|---|---|---|
| 60 | 56 | 52 | 48 | no |
| 70 | 66 | 62 | 58 | no |
| 80 | 76 | 72 | 68 | no |
| 90 | 86 | 82 | 78 | no |
| 100 | 96 | 92 | 88 | no |
| 108 | 104 | 100 | 96 | yes |
| 120 | 116 | 112 | 108 | yes |
| 146 | 142 | 138 | 134 | yes |
| 150 | 146 | 142 | 138 | yes |
| 160 | 146 | 142 | 138 | yes |

## 3. The header (on both tabs)

Built from the pane's own native controls (`hooks/ui/header.tsx`, words in `hooks/lib/header.ts`): a column with 2 cells of padding left and right and 1 row under it. No fill, no outline, no pixel positions; widths come from flex, and a part that may not fit is a truncating text in a box that may shrink. It is drawn on the Board tab and the Settings tab alike, so what waits on him is never hidden. Row 1 is **you**, the rows under it are **Claude**.

**Row 1.**

| Element | Where | Looks like | Text |
|---|---|---|---|
| Attention | left | N > 0: one filled `Button` (`variant="primary"`, the one filled button of the header). N = 0: quiet text | N > 0: `3 need you` (`1 needs you` for one). N = 0: `Nothing needs you` in `dimColor`. N counts cards waiting on him (section 9) |
| Kinds | beside the button from `W` 76, else on a row of its own under row 1 | `dimColor`, cut with `…` | `1 plan ready, 2 questions, 1 failed, 1 held` in that order, zero counts left out; a card with any other flag counts under `held`. Absent when nothing waits |
| Board tab, Settings tab | right end of the row | each a plain `Button` on a 1-cell-padded chip; the chosen tab's chip is filled (`userMessageBackground`), the other's label is `dimColor` and its chip fills under the pointer | `Board`, `Settings` |

**Tabs.** Press the other tab: switch to it. Press the chosen Board tab while a card is open: close the card (same as `◂ Board`). Settings is not offered while the board cannot be read.

**Claude rows.** From `W` 100 they are one row: who, the step, the counts, `changed`. Below that, row A is who and `changed` (right), and row B, 2 cells in, is the step and the counts; below `W` 56 the counts take a third row.

| Part | Text | Colour |
|---|---|---|
| Who | `●` then `Claude is on ENH-0014` (`Claude is on 2 cards` when agents run on different cards; `Claude is idle` when none). The words are a plain `Button` that opens that card (the first when there are several); idle, plain text | dot `claude` (`dimColor` when idle) |
| Step | `step 3 of 5: lane panels and spacing`: the step in hand and what the agent is doing; only when Claude is active and the card has a plan. No bar. Cut with `…` | `dimColor` |
| Workers | `1 of 3 workers`, only when Claude is active and the limit is above 1 | `dimColor` |
| Waiting to start | `○ 1 waiting to start` (`○ 1 waiting` below `W` 60), only when above 0 | `claude`, bold |
| This turn | `▶ this turn: BUG-0016`, only when a turn is on a card and `W` >= 100 | `claude` |
| Changed | `changed 11:33` (hours and minutes, no seconds), at the right of the first Claude row | `dimColor` |

The count behind `Claude is on` is the agents whose description starts with a card ID (planning agents and step workers alike).

Behaviour:
- **Press** the attention button: opens the first card waiting on him in board order (the open card, section 10), on the Board tab. Press again: the next, wrapping.
- **Press** the Claude text: opens that card.
- Nothing else in the header does anything.

## 4. The Settings tab

The Settings tab takes the lanes' place under the header (header unchanged, section 3). Built in `hooks/ui/settings.tsx`; the values, choices and words are in `hooks/lib/settings.ts`. It is flex rows of native controls with **no outline and no filled bar**, 2 cells of padding left and right. There is no title bar and no `◂ Board`: the Board tab is the way back. The tab scrolls with the pane. Choosing applies at once.

Every `Select` sits in a `Box` whose width is a percent of the row, never a number of cells and never its content: a `Box` holding a `Select` sizes to the Select's value, so the columns would not line up from one row to the next (`docs/design/desktop-paint-notes.md`). A role's dropdowns take 30% (model) and 50% (thinking) of the row below `W` 90, and 17% and 28% from `W` 90. The gap between parts is 2 cells from `W` 56, else 1.

**Rows, from the top:**

| Row | What |
|---|---|
| 1 | Up to three plain buttons, wrapping at narrow widths. `Restore all defaults` when any setting differs from its default, else `Everything is at its default` in `dimColor`. Pressing it asks in place, as Delete does: the button is replaced by `Put every setting back to its default?` with a `Restore` and a `Keep` button. Nothing is written until `Restore`. `Save as defaults`, also when any setting differs, acts at once and toasts `Saved as your defaults.` `Restore original defaults`, only when the board has saved defaults, asks `Remove your saved defaults and put every setting back to the original?` with `Restore` and `Keep`; nothing is written until `Restore`. `Keep`, `Restore` and any change of tab close either question |
| 1 gap, then 2 | `Workers at once` and a `Select`: 1 to 5. When it differs: `Default: 2` (`dimColor`) and `Reset`, in the same Default column as every role |
| 1 gap, then 1 | Column captions in `dimColor`: `Model`, `Thinking` |
| 2 per role, 1 gap before each | `Manager`, `Planner`, `Worker`, `Advisor` (every name Box is as wide as `Workers at once`, so the dropdowns and the Default column start at the same place on every row; centred on the dropdowns); the model `Select`; the thinking `Select`. When the role differs from its default: `Default: opus, high thinking` (`dimColor`, in a Box of a fixed share of the room, 75% of the cell from 90 cells wide and 60% of the line under the dropdowns below, cut with `…` inside it, so every `Reset` starts at the same place) and `Reset` |
| 2 gaps, then 1 | `What each thinking level costs` |
| 3 | The usage lines (below), `dimColor`, wrapped |
| 1 gap, then 3 paragraphs | Three notes in `dimColor`, wrapped (strings below) |

**Where Default and Reset sit.** Only a row that differs from its default shows its default and its `Reset`. From `W` 90 they sit beside the dropdowns; below that, on a quiet line under them, lined up with the first dropdown. `Reset` puts the default back and removes the saved line or lines, so a later change to the shipped defaults applies to it again. `Restore all defaults` does that for every row. A saved value equal to the default does not count as different. After `Save as defaults`, every row's `Default: ...` text, its `Reset` and `Restore all defaults` use this board's saved defaults; `Restore original defaults` removes them and puts every row back to the original defaults below. Saved defaults are kept in that board's `kanban\board.md` as `default_` lines and apply to that one board only.

**The defaults** (section 18.1): Workers at once 2; Manager opus, medium; Planner opus, high; Worker sonnet, medium; Advisor fable, high.

Options:

| Select | Options |
|---|---|
| `Workers at once` | 1, 2, 3, 4, 5 |
| model, Manager, Planner, Worker | haiku, sonnet, opus, fable |
| model, Advisor | none, haiku, sonnet, opus, fable |
| thinking, every role | Not set, low, medium, high, extra, max |

**`extra` is `xhigh`.** The pane says `extra` everywhere it shows the level; the board file and the agent call keep `xhigh`. Ultracode is not offered: an agent cannot be started with it; it is chosen in the app's own effort control.

**`(recommended)`.** In a role's thinking list, the level the app recommends for that role's model carries the mark: `medium (recommended)`. The mark follows the role's model: opus `medium`, fable `high`, sonnet `medium`, haiku `medium`. Changing a role's model moves only the mark; the role's thinking does not change. `Not set` is the one word for "no thinking level is sent; the model uses its own default". It is used on this tab only (a card says `Auto`, section 18) and no role defaults to it. When the Advisor model is `none` the Advisor thinking Select is not drawn; the row says `Advisor thinking: not used` in `dimColor`.

**Usage.** There is no cost table and no percentage. Under `What each thinking level costs` the tab says the app's own sentence about Max word for word, then that the app gives no figure for the other levels, then what Ultracode is:

| Line | Text |
|---|---|
| 1 | `Claude thinks longer with Max effort and can consume 3.5× or more usage than Medium.` |
| 2 | `The app gives no usage figure for the other levels.` |
| 3 | `Ultracode is the app's own multi-agent mode, chosen in the app's effort control. It is not a level an agent can be given.` |

Strings:

| Where | Text |
|---|---|
| Note 1 | `Manager runs this conversation. Planner writes each card's plan. Worker does each step of a plan. Advisor gives a second opinion on risky steps.` |
| Note 2 | `One card can use its own model and thinking: open the card and choose Model and Thinking there. That replaces Planner and Worker for that card, and nothing else.` |
| Note 3 | `Changes apply from the next turn. A running agent keeps what it started with.` |
| Toasts | `Workers at once set to 3.` `Manager model set to opus.` `Worker thinking set to high.` `Planner thinking set to extra.` `Advisor model set to none.` Reset: `Workers at once is back to 2.` `Planner thinking is back to high.` `Planner model is back to opus.` `Planner is back to opus, high thinking.` (both lines differed). Restore: `All settings are back to their defaults.` Save: `Saved as your defaults.` Restore original: `All settings are back to the original defaults.` |

(The role sentences in note 1 are the designer's reading of what each role does; check them against the module.)

## 5. The lanes

**Every lane is drawn, in board order, full width** (`x = 2`, width `B`), with 2 gap rows after an open lane and after a one-line lane that is followed by an open lane, and 1 gap row between two one-line lanes in a row (a run of folded lanes stacks closer). A lane is one of two things: an open panel, or one collapsed line in the same place of the order. There is no strip of pills and no lane is moved out of its place. On the default board the order is Needs You, Pending, Plan, Auto, Backlog, Done, Discarded.

**Open or collapsed.**
- A lane with no cards is its **one collapsed line**: the name (`dimColor`) and, from `iw` 48, a quiet italic hint after it (`Nothing needs you.`, `Nothing waiting.`, `Drop a card to get a plan.`, `Drop a card to run it.`, `Ideas for later.`, `Nothing finished yet.`, `Nothing abandoned.`; an older board's lanes say `Drop a card to go step by step.`, `Nothing paused.`, `Nothing is held.`). Nothing opens: there is nothing to show. The exceptions are the lane being created in and the first `intake` lane of an empty board, which shows its 3-row hint body (section 16).
- A lane with cards is open, except a lane whose role is `done`, `backlog`, `parked` or `scrapped`, which **starts collapsed** (its line shows the count and `Open`).
- Click an open lane's chevron, name or count to collapse it; click a collapsed line to open it. A fold or open choice is kept while the pane is open. A collapsed lane reopens when a card waiting on him lands in it after he collapsed it, and a lane with a waiting card he has made no choice about is open. A lane being created in is open.
- **Collapse all and Expand all** (the toolbar's second row, section 11) set every lane's fold at once. `Collapse all` folds every lane, Needs You included (its waiting count at that moment is the baseline, so a card that newly waits on him still reopens it). `Expand all` opens every lane that has cards; it does not open their `+ N more` lists, and `Collapse all` leaves those lists as they are. Both are kept like a fold clicked by hand, and a lane's own fold still works after them. While Find is on, lanes with matches are open whatever the folds say; the buttons still save the folds for when Find is cleared. Done in the pane: the buttons write every lane's fold into the kept view and bump its `stamp`; the lanes' Client takes up the kept folds whenever the stamp differs from the one it last saw.
- A collapsed line takes drops (section 14).

**An open lane's rows.** `x = 2`, width `B`, outline: lane outline colour (section 1). Rows from the top:

| Row | What |
|---|---|
| 0 | Title bar: surface fill across the panel's full width, content from `x = 4` |
| 1 | gap |
| then | each card, followed by 1 gap row |

Height with cards: `2 + n + sum(card heights)` (a card is 1 or 2 rows; four plain cards: 10). With the lane's create field open add 4 (section 11). On an empty board the Pending panel is 6 rows: title bar, gap, 3 rows of text, gap.

**Title bar** (one row, `x` from 4, width `iw`), left to right:

| Part | Width | Text and colour |
|---|---|---|
| Chevron | 2 | `▾` open, `▸` collapsed (`dimColor`); blank when the lane has no cards |
| Name | the text | the lane label, bold; `warning` when the lane holds a card waiting on him |
| Count chip | 1 gap + the text | ` 4 ` as inverse text: `dimColor` for most; `warning` bold when it holds waiting cards |
| Activity (flex) | 2 gap before | `● 1 working` (`claude`, bold) when a worker is on a card here; `○ 1 waiting to start` (`claude`) when a card here is queued; each followed by 2 cells. While dragging this slot holds the lane's drop sentence instead (section 14) |
| Sort name | text + 1 | the sort's name (`Title A to Z`) in `dimColor`, only when the sort is not `Your order` |

(The Label and Changed column headings and the `↕` sort controls are removed (KB-0024).)

**Every card is reachable.** The props hold every card of every lane (Done newest first in `Your order`); there is no 30-card or Done-8 limit. More than 10 cards in a lane: draw the first 10, then a row `▸ 3 more` (`dimColor`, underlined on hover; click shows the rest and the row becomes `▾ fewer`). The row toggles whenever cards were cut by that rule, Done included. Only a size budget cuts a lane further (the serialized props stay under 90,000 characters: the cap starts at the longest lane and halves until they fit); the lane's last row then says `N more: use Find` (`dimColor`) and is not a control. While Find is on (section 13.1) there is no 10-card rule: every match is drawn.

**Hover reveals are not used** (`docs/design/desktop-paint-notes.md` rule 7): the lane's rule sentence (section 16, "Rule") is not drawn on hover.

## 6. A collapsed lane

A collapsed lane is one row: `x = 2`, width `B`, 1 row high, surface fill, lane outline, content from `x = 4`, left to right:

| Part | Text and colour |
|---|---|
| Chevron | `▸`, `dimColor`; blank when the lane has no cards |
| Name | the lane label; bold when it has cards, `dimColor` when empty |
| Count chip | as in section 5, only when the lane has cards |
| Activity | `● 1 working`, `○ 1 waiting to start`, and `3 need you` (`1 needs you`, `warning`, bold) when cards in it wait on him |
| Hint | an empty lane's hint (section 5), italic `dimColor` |
| `Open` | right, `dimColor`, bright under the pointer, only when the lane has cards |

- **Click** the line (everywhere left of the `+`): opens the lane (section 5).
- **While dragging** the line's text is the lane's short verdict (section 14.2): `Write a plan`, `Run it`, `Keep for later`, `Finish it`, `Pause it`, `Abandon it`, `File it`, `Approve it`, `Claude only`, `Place here`, `Already here`. The line's outline and text take the lane's drop colour, and the line under the pointer is drawn in that colour. The line is a drop zone.

## 7. Cards (tiles)

### 7.1 Two forms

A card is **plain** when it has nothing to say about where it stands (status kind `new`, section 8): 1 row. Otherwise 2 rows. Width `tile` (section 2), x from 4. Surface fill, outline as in 7.3. Left and right padding 2 cells.

Row 1, left to right, inside the padding: ID (`idw` cells, section 2; `dimColor`), title (flex, `truncate-end`), the marks (7.2), the pin chip when the card has its own model or thinking (18.5), then either the plain card's labels or the wide columns, then the menu zone.

| Part | Width | When |
|---|---|---|
| Labels | 2 + text, `dimColor` | plain card, not `wide`, `text` >= 56, and no pin chip |
| Label column | 20, `dimColor`, 1 cell inset | `wide` (all cards) |
| Changed column | 14, right aligned, `dimColor`: `today`, `yesterday`, `Oct 6` | `wide` (all cards) |
| Menu zone | 3, right aligned | `⋯`, always drawn (dim, bright under the pointer). A press on it opens the small menu under the card (section 12) |

Row 2 (2-row cards), at an `idw`-cell indent under the title, width `text - idw`: the status line (section 8), then the time it last moved, right aligned, `dimColor`. The time is dropped first when the row is too narrow.

### 7.2 The marks (on row 1)

| Mark | When | Looks like |
|---|---|---|
| Working | a worker agent is running on the card | `● Working`, `claude`, bold, **no fill** (a solid block reads as a warning sticker; the accent outline and the step bar carry the weight); 9 cells |
| Waiting to start | a turn is queued for the card and no worker is on it | `○ Waiting to start`, `claude`, bold; 17 cells (`○ Waiting` below `text` 40) |
| Turn | the running turn is about this card | `▶`, `claude`, bold, 1 cell after the others |
| Pin chip | the card has `model` or `thinking` (section 18) | ` opus, medium `, ` fable ` or ` thinking high `: `dimColor` inverse, 1 cell of padding each side, 1 cell before it. Never orange or accent |

### 7.3 Outline

First match wins: dragging > selected > waiting on him > working > under the pointer > resting.

| State | Outline |
|---|---|
| Being dragged (source) | dim; every text `dimColor`; the ghost is drawn instead (14.3) |
| Another card while dragging | the lane's drop colour (14.2), solid |
| Open card | bright, default colour (keeps orange or accent when it has one) |
| Waiting on him | `warning` (`error` for Failed) |
| Working | `claude` |
| Under the pointer | `bmid` (the lane outline colour) |
| Resting | dim |
| Just moved, not yet confirmed (up to 2 s) | dim; title `dimColor`; `Moving…` in place of the marks |

### 7.4 Full title on hover

Not drawn. A hidden child Box with `display: 'none'` and `hover: { display: 'flex' }` would show the ID and the whole title over a cut card, but hover reveals are not used (`docs/design/desktop-paint-notes.md` rule 7). The open card shows the whole title.

### 7.5 How hover is built

No code runs on hover. The card Box has a `key` and `hover: { borderColor, borderDimColor: false, backgroundColor }`, so its outline brightens and it lights under the pointer. The `⋯` is always drawn (dim). Drag feedback is not hover: it is a re-render on every pointer move from the region's own events.

## 8. What a card says about where it stands

The card's second line (and its progress) is derived on every refresh from the card file and the session. Facts available, all from the card file or the session:

| Fact | Source |
|---|---|
| `total` steps | number of numbered steps under `## Plan` (none: no bar) |
| `done` steps | the highest `N` in a Log line `step N done: <what>` |
| `retry r of 3` | the latest Log line `retry r of 3: <what failed>` that comes after the latest `step N done` line; otherwise none |
| `agent` text | the running agent's description with the card ID and `step N:` removed (`BUG-0012 step 2: fix date format` gives `fix date format`); if there is none, the plan's text for step `done + 1` |
| Last event, time | the last Log line (its text and its `YYYY-MM-DD HH:MM`) |
| Time shown | under 1 minute `just now`; under 60 minutes `4 min ago`; under 24 hours `3 h ago`; the day before `yesterday`; older `Oct 6` |
| Branch, PR | `branch:` and `pr:` on the card |
| Children | the parent's `waiting on <IDs>` Log line and those cards' lanes |
| Worker, queued, turn | the session: an agent whose description starts with the ID; a queued prompt for the card; the running turn's card |

Bar: `total` glyphs, `▰` for each done step in `claude`, `▱` for the rest in `dimColor`; one cell between the bar and the text. Over 12 steps: 12 glyphs, scaled.

The text, by first match (kind, then colour, then text):

| # | Kind | When | Row 2 text | Colour | Bar |
|---|---|---|---|---|---|
| 1 | queued | a turn is queued for the card and no worker is on it | `Waiting for Claude to start. It is busy with another turn.` (when no turn is running: `Claude is starting this.`) | `claude` | the done steps, if any |
| 2 | working | a worker is on the card | `Step 3 of 5: lane panels and spacing`; with a retry `Step 3 of 5, retry 2 of 3: tests failed`; no plan: `Working: fix date format` | default | yes |
| 3 | waiting | flag set and card in a Claude-only lane | the reason line (7 below) | flag colour | on a held card only |
| 4 | children | the card has a `waiting on` line | `Waiting on BUG-0017 and BUG-0018: 1 of 2 done` | default | no |
| 5 | parked | lane role `parked` | `Parked at step 3: finish the tests` | `dimColor` | no |
| 6 | done | lane role `done` | `Merged bug-3-fix-date` (and `, PR 14` when it has one) | `dimColor` | no |
| 7 | idle | role `auto` or `manual`, a plan, no worker | `3 of 5 steps done. No worker running.` (manual: `3 of 5 steps done. Say which step is next.`) | `dimColor` | yes |
| 8 | plan | a plan, any other lane | `Plan: 4 steps` | `dimColor` | no |
| 9 | new | none of the above | (no row 2: the card is 1 row; its labels go on row 1) | | |

Reason lines (kind 3):

| `flag` starts with | Shown | Colour |
|---|---|---|
| `PLAN READY` | `◆ Plan ready: 3 steps. Open it to approve or change it` (without `3 steps. ` when there is no plan) | `warning` |
| `QUESTION: text` | `? Text` (first letter capitalised) | `warning` |
| `FAILED` | `✕ A step failed 4 times. Open it to see why` | `error` |
| `GATE: reason` | `▲ Held: reason` | `warning` |
| anything else | `▲ ` and the flag as written | `warning` |

## 9. Waiting on him, and waiting to start

**Waiting on him** = `flag` is not empty **and** the card is in a lane with the Claude-only flag. Nothing else is shown as a request. When he moves a card out of such a lane, its flag stays in the file until Claude clears it, and the pane ignores it: no orange outline, no reason line, no flag box in the open card, and the header's count and kinds drop it at once.

**Waiting to start** = a prompt for the card is queued in the session and no worker is on it and it is not the running turn. It is shown in all of these places, with these exact words:

| Where | Words |
|---|---|
| Header, Claude row | `○ 1 waiting to start` (accent, bold) |
| Lane title bar and collapsed line | `○ 1 waiting to start` (accent) beside `● 1 working` |
| Card row 1 | `○ Waiting to start` (accent, bold) |
| Card row 2 | `Waiting for Claude to start. It is busy with another turn.` (idle Claude: `Claude is starting this.`), time `just now` |
| Open card | no flag box and no buttons; an accent box: `○ Waiting for Claude to start`, `You approved this just now. Claude is busy with another turn and starts this one next. There is nothing more for you to do.`, `You can still change your mind with the Lane menu.` |
| Toast on the move | `BUG-0015 moved to Auto. Claude will start when it finishes what it is doing.` |
| Open card, `Lane` | the `Lane` Select reads `Auto`; no error on a repeat |

When a worker starts on it, the card becomes Working: the `● Working` label, the bar, the accent outline; the header's `○ 1 waiting to start` goes and the worker count changes.

## 10. The open card

Click a card (its `⋯` opens a small menu with `Open card`, section 12), press the attention button or the Claude text in the header. It takes the lanes' place under the header (header stays), on the Board tab, and the toolbar is not drawn while a card is open; `◂ Board` (or the Board tab) returns to the same lanes, scroll and folds. Built in `hooks/ui/card.tsx` from native controls. Flat like the Settings tab (desktop-paint-notes.md rules 1, 3 and 5): a 2-cell margin and no outline anywhere; the status box is a borderless row on the surface fill; the title bar has no fill; the title bar and the body both have 1 cell of padding, so they line up. Sections (Plan, Description, Log) stand 2 rows apart. Every action on a card is here (section 12). Rows:

| Rows | What |
|---|---|
| 1 | Title bar, no fill: `◂ Board` (a plain button), `BUG-0015  in Needs You` (`dimColor`, cut at the end when narrow; a card that was retyped reads `ENH-0007 (was BUG-0012)  in Pending`, its newest old ID), then a flexible gap, then `◂ Prev`, the count (`3 of 32`, dim) and `Next ▸`. Prev and Next open the neighbour in the order the board draws the cards: lanes top to bottom, each lane by the board sort (Done newest first), only Find's matches while Find has words, folded lanes counted. No wrap: at the first or last card that control is dim text, not a button. A card Find hides shows no Prev, count or Next. The bar may wrap to a second row when narrow |
| 1 gap, then the title, then 1 | Title, bold, wrapped: the boldest text on the card (the section headings `Plan`, `Description` and `Log` are bold and dim). Under it one row of two quiet plain buttons, `Rename` and `Copy ID` (`dimColor`; Rename is not drawn when the board cannot be read, nor while the Rename field is open). `Rename` swaps the title for one row: a native `Input` holding the title, placeholder `Card title`, with its own submit labelled `Save` (Enter does the same), and a plain `Cancel` button beside it. (The app draws the Input at its own width; a plugin cannot widen it.) Save writes the card's `# ` title line, `updated` and one Log line `renamed from "old title"`, cleaned as the toolbar's Add cleans a title (one line, quotes removed); a title over 120 characters is refused, not cut, with the toast `A title can be at most 120 characters; this one is 131. Nothing was written.`, the field keeps what was typed; refused with a toast while Claude is editing the file or the file changed meanwhile (as a comment is); the file name never changes on a rename (only a retype, 12.5, changes the ID in it). Toast `Renamed BUG-0015 to "New title".`. An empty title toasts `Type a card title first.` and keeps the field; the same title writes nothing and closes the field; `Cancel`, another card and `◂ Board` close it unsaved |
| 1 gap, then the box | Status box, only when there is something to say (below): surface fill, no outline (the heading carries the colour), 2 cells of padding, 1 row above and below |
| 1 gap, then 2 | Four native `Select`s, each taking an equal share, 2 cells apart: in one row from 90 cells, in two rows of two (`Type` and `Lane`, then `Model` and `Thinking`) from 60 to 89, one under the other below 60. **`Type`** (12.5), the first of the four, whose value is the card's type name, read from its ID's letters (`bug`), or `No type` for a card whose letters are no type on the board (shown as the value only, never offered); **`Lane`**, whose value is the lane the card is in now (`Needs You` for a card in Needs You, never the first lane in the list; options: every lane that accepts his drops, plus the current lane, which is shown as the value and not selectable when it is Claude-only; choosing another lane moves the card as a drop would, 14.4); **`Model`**, options `Auto (sonnet)`, `haiku`, `sonnet`, `opus`, `fable`; **`Thinking`**, options `Auto (medium)`, `low`, `medium`, `high`, `extra`, `max`, with `(recommended)` on the level the app recommends for the card's model (the card's own model, else the one Auto gives it; opus `medium`, fable `high`, sonnet `medium`, haiku `medium`) and no `Not set`. `Auto` carries in brackets what Settings give this card: the Planner's model and thinking in the Plan lane, the Worker's anywhere else. The value is the card's own, `Auto` when it has none. Choosing writes the card at once (18.4) with the toasts of 12.2. Not drawn when the board cannot be read |
| 0 gap, then 1 | Only while Claude's newest Log line `suggests type <type>: <reason>` is newer than the newest `retyped from … to …` line: a dim wrapped line under the selects, `Claude suggests enhancement: <reason>`. It is only a line; nothing is offered by it, and the person picks the type in `Type`. Not drawn when the board cannot be read |
| 1 gap, then 1 | Only while a type other than the card's own is picked in `Type` (12.5): the question row `Retype BUG-0012 as enhancement? Its ID will change.` with a `Retype` and a `Cancel` button after it, wrapping when narrow |
| 0 gap, then 1 | The line under the selects, hugging them (under the suggestion and the question when they show; `truncate-end`): with an override, `Set on this card: opus, medium.` in bold default followed by `  It stays with the card until you choose Auto or the card is done.` in `dimColor`; with none, `Auto: Settings decide. Planner opus, high; worker sonnet, medium.` in `dimColor` (the board's current values; a Not set thinking is left out) |
| 2 gap, then 1 + step rows | `Plan` (bold) with `2 of 5 done` right in `dimColor`, then one row per step, with no step numbers (the mark is the only marker). The mark stands in a Box 2 cells wide at the top of the row, on the step's first line: `✓` and `○` (dim), `▶` (accent) on the step in hand. On the step in hand its first sentence is bold and the rest of its text (up to `Files:` or `Check:`) is dim, wrapped; `Files:` and `Check:` are shown only under `Show details`. Every other step shows its first sentence only, `dimColor`, on one line (`truncate-end`). A plain `Show details` button under the steps (only when some step has more than its first sentence, or the step in hand has Files or Check) shows every step whole, dim, wrapped; it then reads `Hide details`. Reset when the card changes. Only if the card has a plan |
| 2 gap, then 1 + text | `Description` (bold) and the card text as `Markdown`, which flows. Only if the card has text |
| 2 gap, then 1 + 1 + lines | `Log` (bold) with a quiet plain button `Copy entire log` beside it (drawn only when the card has Log lines; it never shrinks or is cut), then straight under it **one** native `Input`, placeholder `Write a comment for Claude` (`Type your answer` on a question), with its own submit labelled `Comment` (`submitLabel`). No separate Comment button: the app draws the submit beside the field, and a second one is a bug. Enter or the submit adds the comment to the log as his. Toast `Comment added to BUG-0015.`. A comment is one Log line (line breaks become spaces) with no length limit: any length is written whole, never cut and never refused for length. Then the lines, **newest first, every line shown whole, wrapped over as many rows as it needs: nothing in the open card is cut with an ellipsis.** Every line is one tone, whoever wrote it: the time stamp (`2026-10-09 06:35`, in a Box of fixed width so the words start at the same place on every line) is `dimColor` and the words (`Claude: step 2 done`) are the default colour; a long line wraps under its words. The newest 6 lines are shown; older ones behind a `Show the whole log` button, under the lines, that expands in place. The date of **every** line shown is a plain button (it stays `dimColor` and looks like text, not like a button): a press on it puts the whole line on the clipboard, as it stands in the card file but without the leading `- `: date, time, name and words, for example `2026-10-11 02:09 John: created in Auto`. The words are plain text again, not pressable: they wrap over as many rows as they need and are never cut, because a button's label is drawn on one row in the desktop app, so pressable words were cut. There is no separate `Copy` button under a line. Only under a line whose words hold text between backticks sits one quiet row of plain buttons (`dimColor`, wrapping when the pane is narrow, each button whole): a `Copy command` for each such stretch (`Copy command 1`, `Copy command 2` when the line holds several). `Copy command` puts only the text between the backticks, exactly as written (nothing trimmed, quotes, backslashes and double spaces kept). A span opened by two backticks closes at the next two, so a command that holds one backtick can be written; an unclosed backtick and an empty span give no button. `Copy entire log` puts every line of the card's Log on the clipboard, also the ones hidden behind `Show the whole log`, each with date, time and name, one per row, oldest first (the pane shows newest first), without the file's leading `- `; the words themselves are never changed. The controls are drawn also when the board cannot be read: copying writes nothing to any file and sends nothing to Claude. Toasts: `Copied the Log line.`, `Copied the command.`, `Copied the entire log.`, and on a failure `Could not copy the Log line: <reason>.`, `Could not copy the command: <reason>.` or `Could not copy the entire log: <reason>.`; a toast never repeats the copied text |
| 2 gap, then 1 | `Delete card…` (a plain, dim button), alone at the left, last on the card. Pressing it swaps the row for the question of 12.4 |

The status box:

| When | Colour | Content |
|---|---|---|
| Waiting on him | the flag's | bold: glyph and `Plan ready: 3 steps. Claude is waiting for you to approve it.` / the question / `A step failed 4 times. Open the log to see why.` / `Held: reason. Claude will not go on until you approve.`; then the buttons (below), or for a question `Type your answer in the comment box below.` |
| Waiting to start | `claude` | the three lines of section 9 |
| Working | `claude` | the `● Working` label (accent, bold, no fill) and `Step 3 of 5: lane panels and spacing` (bold); the bar and `2 of 5 steps done`; `Last: step 2 done: header, 4 min ago`; `Branch enh-14-board. No pull request yet.` (or `Pull request 14.`) |
| Has children | default | `Waiting on BUG-0017 and BUG-0018: 1 of 2 done` and a plain button per child that opens it |
| Otherwise | | no box |

Flag button (one per flag; it moves the card like a drop on that lane, with that lane's toast; it is left out when the board has no Auto lane):

| Flag | Button |
|---|---|
| Plan ready | `Approve and run` (to `{auto}`) |
| Held | `Approve and continue` (to `{auto}`) |
| Failed | `Retry in {auto}` (to `{auto}`) |

There is no `Do it step by step` and no `Park it`, on any board, older ones included (KB-0026, D13): a paused card is dragged out of Auto to Pending or Backlog, an abandoned one to Discarded.

A press on the flag button does the move as above and then, when the card was moved, closes the open card and shows the lanes as `◂ Board` does (same folds, same sort, no card highlighted). A refused press (for example the card is being edited by Claude) leaves the card open; the toast says why. Reopened, the card shows what it shows after any move to `{auto}`.

Otherwise the view follows the live card: a pick in the `Lane` list (also `{auto}`) and Claude's own moves leave it open, and when the card moves out of the lane it was waiting in, the flag box and its buttons disappear on the next refresh (9). `Comment` keeps it open. If the card is deleted the view closes. `◂ Board`, or the Board tab, closes it.

## 11. Creating a card

The toolbar (`hooks/ui/toolbar.tsx`) sits between the header and the lanes on the Board tab, and is not drawn while a card is open. Two rows of native controls. Row 1: the `New card` button at the left (not drawn when the board cannot be read), the `Find` field in the growing space (section 13.1), and the one `Sort` (section 13) at the right edge. Row 2, a quiet sub-row one blank row under row 1 with its count text lined up with the label of `New card`: the dim card count (`32 cards`, or `4 of 32 match` while Find is on) at the left, and at the right ONE quiet plain button that names what it will do: `Collapse all` while any lane with cards is open, else `Expand all` (section 5). While Find is on the button is not drawn (lanes with matches are open whatever the folds say). When Find matches nothing the count is replaced by the line `No card matches "zzzz"` with its own `Clear`, and Enter in the Find field says the same in a toast. Two blank rows stand between the toolbar and the first lane.

- **Press `New card`.** A second row opens under it: the title `Input` (placeholder `What needs doing?`), a `Type` `Select`, a `Lane` `Select`, `Cancel`; the one `Add` is the field's own submit (`submitLabel`), which the app draws beside the field, as in the comment field (section 11): no separate `Add` button, since a second one is a bug. Enter or that submit adds the card, the field clears and stays open. Three layouts: from `W` 92 the field, `Type`, `Lane` and `Cancel` share one row; from 60 to 91 the field has the row to itself and `Type`, `Lane` and `Cancel` share the row under it; below 60 the field has a row, `Type` has the next on its own, and `Lane` and `Cancel` share the last. The field takes all the free width of its row (its Box has `flexGrow` 1, is a column so the native field stretches across it, and from 92 cells keeps at least 35% of the row); the `Type` and `Lane` Boxes size to their values and do not grow; no Box in the row has a fixed width. Text longer than the field scrolls inside it as a native field does; there is no longest title. Nothing typed is lost: text that fits a title (one line, quotes removed, at most 120 characters) is the title and the card's body is empty; longer text becomes the card's body, word for word (its quotes and line breaks kept, control characters as spaces, a line starting `## ` given a leading backslash so it is not a section), and the title is its beginning, cut between words (a hard cut at 119 characters only when there is no space) and ended with `…`, 120 characters at most. The field takes the keyboard when the row opens, and **only then**.
- **The types offered** are the board's types (`board.md` `types:`; unless it lists others: `bug`, `enhancement`, `chore`), by name in board order. The list starts on the board's first type and keeps the last pick for as long as the pane is open and that type is still on the board; the card gets that type, so its ID is that type's letters and the next number of that type (`BUG-0012`, `ENH-0007`: each type counts from 1 on its own).
- **The lanes offered** are the lanes a person may create in, in board order: roles `intake`, `plan`, `auto`, `manual` and `backlog`, never a Claude-only lane. The lane shown is the one picked, else the first `intake` lane (Pending).
- **Enter** in the field, or `Add`: makes the card at the end of the lane, empties the field, keeps the row open and gives the field the keyboard again. `Cancel` closes the row and drops what was typed. With no lane that takes cards the toast is `No lane takes new cards.` A type the board does not have (the board changed meanwhile) is refused with `Unknown type "x". Nothing was added.`
- Toast: `Added BUG-0016 to Pending.` plus ` Claude is writing the plan.` (plan), ` Claude is starting.` (auto) or ` Claude is planning the first step.` (manual); when Claude is busy: ` Claude will start when it finishes what it is doing.` A card made in Pending or Backlog starts nothing. When the text was longer than a title the toast ends ` The full text is in the card.` The `created` prompt carries the short title.
- One field open at a time.

The lane's own `+` and its create field are removed (KB-0024); the toolbar's `New card` row replaced them.

## 12. Card actions: the small menu

A press on a card's `⋯` opens no card. It shows a small menu directly under that card, inside the lane: as wide as the card (`iw`), the card's fill, no outline, the text inset 1 cell. The cards below move down by its rows. Every row is drawn in the lanes (the Client), so a first click on a row acts. Rows, by level:

| Level | Rows | What a press does |
|---|---|---|
| First (3 rows) | `Open card` | opens the card (section 10) |
| | `Copy ID` | copies the ID, toast `Copied BUG-0015.` |
| | `Delete card…` | goes to the delete level |
| Delete (4 rows) | `Delete BUG-0015?` (`error`), `This removes the card and its log.` (`dimColor`) | nothing; the menu stays |
| | `Delete it` | asks Claude to delete the card (12.4 gives the toasts) |
| | `Keep it` | back to the three rows |

One menu at a time, and none on a board that cannot be read (no `⋯` is drawn then either). It closes when: the same `⋯` is pressed again; `Open card`, `Copy ID` or `Delete it` is chosen; anything else on the lanes is pressed (that press still does its own job: it opens the card pressed, folds the lane, starts the drag); another card's `⋯` is pressed (the menu moves there, at the first level); a card is opened; the Settings tab is chosen; `Collapse all` or `Expand all` is pressed; its lane is folded; a drag starts; or its card leaves view (behind `+ N more`, filtered out by Find, deleted). A refresh of the board keeps it open on its card. A right press does nothing: the app opens its own context menu (Copy, Select All) over the pane and that cannot be stopped. A click on the card itself opens the card; `Lane`, `Model`, `Thinking`, `Copy ID` and `Delete card…` are also in the open card (section 10).

### 12.2 Model and thinking

The open card's `Model` and `Thinking` `Select`s (section 10). Choosing writes the field at once; `Auto` removes it. Toasts: `BUG-0015 will use opus.` `BUG-0015 will think at medium.` `BUG-0015 model is back to Auto.` `BUG-0015 thinking is back to Auto.` When a worker is running add ` It takes effect from the next step.` (`thinking` reads with the pane's word, `extra` for `xhigh`.)

### 12.3 Lane

The open card's `Lane` `Select` (it was `Move to`, which read as an order beside the lane's own name) (section 10). A choice moves the card as a drop would (14.4) with the toast of 14.4. A Claude-only lane is not offered, except as the value when the card is in it.

### 12.4 Delete

`Delete card…` in the open card asks in place (the small menu asks the same in its delete level, section 12): `Delete BUG-0015? This removes the card and its log.` (`error`), then `Delete it` and `Keep it` buttons. Delete it asks Claude to delete the card (no file is touched) with the toast `Claude is deleting BUG-0015.`, or, when Claude has a turn running or a worker on a card, `Claude will delete BUG-0015 when it finishes what it is doing.` Keep it: the question goes.

### 12.5 Type and retype

The open card's `Type` `Select` (section 10) holds the board's type names in board order (`bug`, `enhancement`, `chore` unless `board.md` lists others); its value is the card's own type. A card whose ID letters are no type on the board shows `No type` as its value only. **Picking another type writes nothing.** The list shows the pick and the question row of section 10 appears: `Retype BUG-0012 as enhancement? Its ID will change.` with `Retype` and `Cancel`.
- `Cancel`, `Retype`, picking the card's own type again, opening another card, `◂ Board` and a new ID for the open card (Claude retyped it) put the pick away; the list goes back to the card's real type. Picking the card's own type, or a name that is no type on the board, does nothing else and shows no toast.
- `Retype` asks Claude; no file is touched, since the pane cannot rename a file. It sends the prompt `Kanban: <owner> asked to retype BUG-0012 "Fix the morning summary date" as enhancement. Retype the card with the kanban skill.` (queue kind `retype`) and toasts `Claude is retyping BUG-0012 as enhancement.`, or, when Claude has a turn running or a worker on a card, `Claude will retype BUG-0012 when it finishes what it is doing.`
- Claude then runs the skill's `retype` verb (`references/format.md` section 7): the card takes the next number of the new type, the file is renamed, `id:` changes, a Log line `retyped from BUG-0012 to ENH-0007` is added and the cards that name it as `parent:` follow. The open card, the card a worker or a turn is on, and prompts waiting in the queue follow the card to its new ID through its old ones, so the view stays open on the same card and its header reads `ENH-0007 (was BUG-0012)  in Pending`.
- **Refused**, nothing queued or sent, with a toast: a card in an `auto` lane, one with a worker on it or the one the running turn is about (`BUG-0012 is being worked. Move it out of Auto or wait, then retype.`); a card no longer on the board (`No card BUG-0012 on the board.`); more than one file with the ID (`More than one file has ID BUG-0012: <files>. Fix by hand; nothing was changed.`); and a board that cannot be read (`The board file can't be read. Nothing was asked.`; the lists are not drawn then).
- Claude never retypes on its own. When it thinks a card has another type it adds a Log line `suggests type enhancement: <reason>`, which the open card shows as the dim line of section 10 until a retype comes after it.

## 13. Sorting

**Control.** The toolbar's one `Sort` (a native `Select` with the label `Sort`, section 11) holds the seven options below and sets the sort of every lane at once. It shows the sort every lane has; when the lanes differ (an older saved view, or a lane's own control) it shows `Per lane`, as an extra first option. The default is `Your order`. The lane's own `↕` menu is removed (KB-0024).

| Option | Orders by | Ties |
|---|---|---|
| `Your order` | the card's `order` number, ascending | the ID |
| `Newest first` | creation time, newest first: the `created` date and the time of the card's first Log line. IDs no longer say which card is newer, since each type counts on its own | the ID, descending |
| `Oldest first` | creation time, oldest first. A card with no creation time (made before the pane read one) counts as the oldest | the ID, ascending |
| `Recently changed` | `updated` date, newest first | `order` |
| `Title A to Z` | title, case-insensitive | `order` |
| `Needs you first` | cards waiting on him first (section 9) | `order` |
| `Label` | the first label, A to Z; cards without a label last | `order` |

- **The sort applies to every lane** (the toolbar Sort). A lane keeps its own sort only while the lane's own `↕` is still there.
- **The title bar names a sort that is not `Your order`** (`Title A to Z`, section 5). With the wide columns the headings `Label ↕` and `Changed ↕` also set the sort (5).
- **The sort is a view.** It changes nothing in the card files and is not a card property. It is kept in the pane while the pane is open. Saving it between sessions is an open question (section 23).
- **Cards moved by Claude** into a lane are placed by that lane's sort.
- **Sort and placing (14.5):** only `Your order` lets a card be placed. In any other sort, dropping in the lane puts the card where the sort puts it and the toast says so.

### 13.1 Find

The toolbar's `Find` is a native `Input` (placeholder `Find a card`) in row 1 between `New card` and `Sort`; the app draws it at its own width. Below 60 cells it takes a row of its own under row 1. Its text is the `find` state value, empty when the session starts (it is not remembered).

- **What matches.** Every word typed (split on spaces, ignoring case) must be a substring of the card's ID, one of its old IDs (`BUG-0012` finds the card that is `ENH-0007` now), the name of its type (`enhancement`), its title or one of its labels (`hooks/lib/find.ts`). Not the card text.
- **Typing filters** at once (`onInput`). `Clear` (a plain button at the right of the field) shows while text is typed and empties it. **Enter** opens the first match in board order (lane by lane, each lane by card order); with no match nothing happens.
- **The board while filtering.** Props carry only the matches, each lane's count is its matches, and `isFiltered` is true. A lane with matches opens whatever its fold and shows every match; a lane with none stays its one line with `0`; the empty-board hint never shows. Row 2 reads `4 of 32 match`.

## 14. Dragging

### 14.1 The gesture

- **Press** the left button on a card (not on the `⋯` zone) and move at least 2 cells: the drag starts, and it closes an open card menu. A press and release without moving is a click (open the card).
- A drag **closes the create field** and blurs any native control. Nothing may take the keyboard back while the button is down.
- While dragging every pointer move re-draws: the source card dims, the ghost follows, every lane, open or collapsed, shows its drop state (14.2). A drag with no event for 30 seconds is cancelled.
- **Release** over a lane, open or collapsed: the drop is judged (14.4). Release anywhere else: nothing happens and nothing is said.
- No move is sent while the board is read-only.

### 14.2 What every lane shows while dragging

For each lane, judged from the card in hand and the lane it came from:

| Lane | Kind | Title bar sentence (replaces the activity slot; the sort and `+` are hidden) | Collapsed-line text | Colour |
|---|---|---|---|---|
| the card's own lane, `Your order`, not Claude-only | place | `↓ Drop to place it here.` | `Place here` | default bright |
| the card's own lane, Claude-only lane | same | `· It is already here.` | `Already here` | `dimColor` |
| the card's own lane, other sort | same | `· Sorted by Title A to Z. Change to Your order to place cards.` | `Already here` | `dimColor` |
| `intake` | plain | `→ Drop to file it. Nothing runs.` | `File it` | default bright |
| `plan` | acts | `→ Drop and Claude writes a plan.` | `Write a plan` | `claude` |
| `needs-you` | refuse | `✕ Claude's lane. You can't drop here.` | `Claude only` | `error` |
| `auto` | acts | `→ Drop and Claude runs it end to end.` | `Run it` | `claude` |
| `auto`, card flagged `GATE` from a `needs-you` (or `gated`) lane | acts | `→ Drop to approve it. Claude carries on.` | `Approve it` | `claude` |
| `manual` | acts | `→ Drop and Claude plans, then waits for you.` | `Step by step` | `claude` |
| `gated` | refuse | `✕ Claude's lane. You can't drop here.` | `Claude only` | `error` |
| `backlog` | plain | `→ Drop to keep it for later. Nothing runs.` | `Keep for later` | default bright |
| `done` | plain | `→ Drop to mark it finished.` | `Finish it` | default bright |
| `parked` | plain | `→ Drop to pause it.` | `Pause it` | default bright |
| `scrapped` (Discarded) | plain | `→ Drop to abandon it.` | `Abandon it` | default bright |

The sentence is bold in the lane's colour (default for plain, `dimColor` for same). The panel's outline and every card's outline in the lane take the lane's colour, solid (a refusing lane is a solid `error` outline, no dashes). The lane under the pointer (not a `same` or `refuse` lane's own...): its title bar, or its collapsed line, is drawn as inverse text in the lane's colour: every run, every gap and a trailing clipped run of spaces, so no `backgroundColor` is needed; a refusing lane under the pointer gets the same bar in `error`.

### 14.3 The card in hand (ghost)

A box of width `min(source card width, 44)` and height 2, `bmid` outline (colour of the lane under the pointer: `error` refuse, `claude` acts, default plain), opaque, drawn last. It sits so the pointer stays where he took hold, clamped inside the region. Row 1: ID zone `idw` cells (section 2; `dimColor`), title bold, one row. Row 2: the sentence from 14.2 for the lane under the pointer, in its colour (`Drop on a lane. Let go anywhere else to cancel.` over no lane).

### 14.4 What a release does

| Release over | Result | Toast |
|---|---|---|
| the card's own lane | nothing (a place drop is 14.5) | `BUG-0012 is already in {inbox}.` |
| a refusing lane | the card goes back; nothing is written | `Needs You is Claude's lane. BUG-0012 stays in Pending.` (error colour) |
| an accepting lane | the move is sent; the card shows pending (7.3) until the board confirms, 2 s at most | below |
| after the board changed under him | nothing moves | `The board changed while you were dragging. Try again.` |
| read-only board | nothing moves | `The board file can't be read. Nothing was moved.` |

Accepted moves (card ID first; lane labels as on the board). `idle` / `busy` is whether Claude has a turn running:

| Into | Toast |
|---|---|
| `intake` | `BUG-0012 moved to Pending.` |
| `backlog` | `BUG-0012 moved to Backlog.` Nothing runs. |
| `plan` | idle `BUG-0012 moved to Plan. Claude is writing the plan.` busy `BUG-0012 moved to Plan. Claude will start when it finishes what it is doing.` |
| `auto` | idle `BUG-0012 moved to Auto. Claude is starting.` busy `BUG-0012 moved to Auto. Claude will start when it finishes what it is doing.` |
| `auto`, flagged `GATE` from `needs-you` (or `gated`) | idle `BUG-0007 approved. Claude is carrying on in Auto.` busy `BUG-0007 approved. Claude will carry on in Auto when it finishes what it is doing.` |
| `manual` | idle `BUG-0012 moved to Manual. Claude is planning the first step.` busy as `plan` |
| `done` | `BUG-0012 marked finished.` |
| `parked` | `BUG-0012 parked.` |
| `scrapped` (Discarded) | `BUG-0012 scrapped.` |

Add ` It sits where Title A to Z puts it.` (the lane's sort) when the target lane is not in `Your order`. The same sentences are used for a move from the open card's `Lane` or a flag-box button.

**Pausing.** There is no Parked lane on the default board, so a card a worker is on is paused by dragging it out of Auto into Pending or Backlog. Claude stops at the next safe point and commits nothing more. A card dropped in Pending or Backlog that was not being worked starts nothing.

### 14.5 Placing a card between two others

When the lane under the pointer is in `Your order` and accepts the drop, a **slot** shows where the card will sit: a 1-row box in the gap row nearest the pointer (the gap under the card the pointer is in the bottom half of, or above the one it is in the top half of), full tile width, surface fill, `claude` outline, bold `claude` text centred: `Place between BUG-0008 and BUG-0009`, `Place first`, or `Place last`. It sits in the gap row that already exists, so nothing moves. In any other sort there is no slot.

On release the move carries `before`: the ID of the card the slot is above, or `null` for the end. The module writes `order` midway between the two neighbours (at the ends, 1000 beyond the first or last; when two neighbours have no number between them, renumber the lane in steps of 1000). Cards that are not placed (any other sort, creating, Claude's moves) go to the end of the lane's order.

### 14.6 Where a drop counts

| Target | Drop zone |
|---|---|
| Open lane panel | the whole panel, `(2, y, B, rows)`, including its title bar and gaps |
| Collapsed lane | its line, `(2, y, B, 1)` |
| Header, toolbar, the open card | not a drop zone |

## 15. Pointer behaviour, element by element

Left button. A right press does nothing in the board region (the app opens its own context menu over the pane and that cannot be stopped). Hover means the style change; no hook runs on it. A native control (rows marked native) ignores the first click when the pane does not hold the keyboard; clicks in the board region act at once.

| Element | Hover | Click | Drag |
|---|---|---|---|
| Card | outline brightens, the tile lights | open it | pick up |
| `⋯` zone | `⋯` bright | open the small menu under the card; pressed again, close it | none |
| Menu row `Open card`, `Copy ID`, `Delete card…` | the row lights | open the card / copy the ID / ask to delete (12) | none |
| Menu row `Delete it`, `Keep it` | the row lights | ask Claude to delete / back to the three rows | none |
| Menu row `Delete BUG-0015?`, the note | none | nothing (the menu stays) | none |
| Lane title bar: chevron, name, count | none | collapse the lane | drop zone |
| Collapsed lane line | `Open` bright | open the lane | drop zone |
| `+ 3 more` | underline | show the rest | none |
| Empty board space | none | closes the open card | nothing |
| Log line's date (native, plain; the words are not pressable) | native | copy the whole line (date, time, name, words), toast `Copied the Log line.` | none |
| `Copy command` under a Log line (native) | native | copy only the text between the backticks, toast `Copied the command.` | none |
| `Copy entire log` beside `Log` (native) | native | copy every Log line, oldest first, toast `Copied the entire log.` | none |
| Header attention button (native) | native | open the first waiting card | none |
| Header Claude text (native) | native | open the card Claude is on | none |
| Board and Settings tabs (native) | the other tab's chip fills | switch to that tab | none |
| `New card`, `Sort`, the new-card row (native) | native | native | none |
| Settings controls, `Reset`, `Restore all defaults`, `Save as defaults`, `Restore original defaults` (native) | native | native / put the default back / save the settings as this board's defaults / remove the saved defaults | none |
| Open-card controls (native) | native | native | none |

Keys: Enter in a text field submits it (the new-card title adds the card, the comment field comments). There are no other shortcuts.

## 16. Strings by lane role

| Role | Rule (hover; not shown, reveals are off) | Empty line (the hint on an empty lane's one line) | Verdict (collapsed line while dragging) | Create |
|---|---|---|---|---|
| `intake` | New cards. A drop here only files it. | Nothing waiting. | File it | yes |
| `plan` | Claude writes a plan, then asks you. | Drop a card to get a plan. | Write a plan | yes |
| `needs-you` | Claude puts what needs you here. | Nothing needs you. | Claude only | no |
| `auto` | Claude runs it end to end and merges. | Drop a card to run it. | Run it | yes |
| `backlog` | Ideas you may or may not do. Nothing happens to a card here. | Ideas for later. | Keep for later | yes |
| `manual` (older boards) | Claude plans, then does one step at a time. | Drop a card to go step by step. | Step by step | yes |
| `gated` (older boards; it reads as `needs-you` does except for these words) | A risky step is held. Drag to {auto} to approve. | Nothing is held. | Claude only | no |
| `done` | Finished cards. | Nothing finished yet. | Finish it | no |
| `parked` (older boards) | Paused. Nothing runs. | Nothing paused. | Pause it | no |
| `scrapped` (Discarded) | Abandoned. | Nothing abandoned. | Abandon it | no |
| any other role | Cards in this lane. | Empty. | Move it here | no |

The hint shows from `iw` 48. A card in hand puts `Place here`, `Already here` or `Claude only` in the same place (14.2).

Other strings:

| Where | Text |
|---|---|
| Empty board, Pending body, 3 rows | `The board is empty.` (bold) / `Click + to add a card, or tell Claude what to build.` / `Then drag a card to Plan, Auto or Manual to hand it to Claude.` (`dimColor`; use the board's own lane labels) |
| Delete question | `Delete BUG-0015? This removes the card and its log.` then `Delete it` and `Keep it` buttons (12.4) |
| Toasts | `Copied BUG-0012.` `Deleted BUG-0012.` `Comment added to BUG-0015.` `Could not delete BUG-0012: reason.` and the move, create and settings toasts above |
| Board unreadable | a row under the header and toolbar in `error`: `The board file can't be read. Showing the last good copy; moves are off.` |
| Unreadable card files | under the lanes, a `dimColor` row `2 cards in kanban/ can't be read.` |
| No board in the project | the whole region: `This project has no board yet.` and a `Set up a board` button. It also shows from the moment the person presses Enter on `/kanban:setup` or `/kanban:kanban`, until the lanes appear |

## 17. Hit rectangles, `W = 80` (`B = 76`, `iw = 72`)

Only the lanes are drawn in the board region and have rectangles; `y` counts from the region's own first row, under the header and toolbar. The header, the toolbar, the Settings tab and the open card are native controls placed by flex and have none.

| Target | Rect (x, y, w, h) |
|---|---|
| Lane title bar, or a collapsed lane's line (drop zone and fold zone) | (2, y, 76, 1) |
| Chevron, name, count | (4, y, text, 1) |
| Card | (4, y, 72, h) |
| Card `⋯` | (4 + 72 - 5, y, 3, 1) |
| Card menu block (right under the card, no gap row; the cards below sit lower by `h`) | (4, y, 72, h), `h` 3 (first level) or 4 (delete level) |
| Card menu row | (4, y, 72, 1), one per row |
| `+ 3 more` | (4, y, 72, 1) |
| Place slot | (4, gapRow, 72, 1) |

## 18. Model and thinking: defaults, the board, the card

Every agent the board starts has a model (`haiku`, `sonnet`, `opus`, `fable`) and may be given a thinking level (`low`, `medium`, `high`, `xhigh`, `max`, or none set). `xhigh` is written to the file and sent to the agent as it is; the pane shows it as `extra`. Ultracode is not a level an agent can be started with and is not offered. All names are the plain words; no version numbers are shown.

### 18.1 Defaults the plugin ships

The module holds one table of defaults; a saved setting overrides a default key by key, and a fresh install has nothing saved, so every control starts at its default. Nothing is written until he changes something.

| Setting | Default model | Default thinking |
|---|---|---|
| Workers at once | 2 | |
| Manager | opus | medium |
| Planner | opus | high |
| Worker | sonnet | medium |
| Advisor | fable | high |

These are the shipped default values; change them in the one table (`DEFAULTS` in `hooks/lib/settings.ts`). `Reset` on a row (section 4) deletes the saved key. The level each model recommends is in a second table (`RECOMMENDED`): opus `medium`, fable `high`, sonnet `medium`, haiku `medium`; it only marks a choice `(recommended)` and sets nothing. These are the original defaults. A board can save its own with `Save as defaults` (section 4); they are kept in that board's `kanban\board.md` as `default_` lines, replace these for that board only, and `Restore original defaults` removes them.

### 18.2 What each setting and the card's fields drive

| Agent | Model comes from | Thinking comes from |
|---|---|---|
| Manager (the conversation itself) | Settings, Manager | Settings, Manager |
| Planner agent on a card | the card's `model` if set, else Settings, Planner | the card's `thinking` if set, else Settings, Planner |
| Worker agent on a card | the card's `model` if set, else Settings, Worker | the card's `thinking` if set, else Settings, Worker |
| Advisor | Settings, Advisor | Settings, Advisor |

The card's two fields never touch the Manager or the Advisor. A thinking value of `Not set` means the agent is started without a thinking level. The model and the thinking of a card are independent: a card can pin only one.

### 18.3 Usage

The tab has no cost table and no figure per level, and none is made up. It carries the app's own sentence about Max and says that the app gives no figure for the other levels (section 4, Usage).

### 18.4 The card's override

The card file gets two lines, written the way `order` is:

```
model: opus
thinking: medium
```

`model` is one of `haiku`, `sonnet`, `opus`, `fable`; `thinking` one of `low`, `medium`, `high`, `xhigh`, `max` (the pane shows `xhigh` as `extra`). A missing or empty line means **Auto**: the board's setting applies. The pane never writes `auto`.

- **Set it** in the open card (section 10): its `Model` and `Thinking` selects, each time.
- **It stays** with the card while the card is on the board: moving it from lane to lane does not touch the fields. They change when he sets them, and Claude removes both lines in the same edit that moves the card to Done (the skill's finish step; `references/format.md`). A card that has reached Done carries no model or thinking of its own.
- **Undo it** by choosing `Auto` in the open card's `Model` or `Thinking` select (each clears its own line).
- **When it applies**: read at the start of every agent for that card. An agent already running keeps what it started with (the toast says so while a worker is on the card).
- **Children** (cards a plan creates and waits on) do not inherit the parent's fields. See open question 3.

### 18.5 How it shows on the board

A card with a `model` or `thinking` has a chip on its first row, after the title and the marks:

| The card has | Chip text |
|---|---|
| both | `opus, medium` |
| a model only | `fable` |
| thinking only | `thinking high` |

The chip is a solid block in the gray of the count chip (`dimColor` inverse, 1 cell of padding each side). It is never orange or accent: orange is "waits on you" and accent is "Claude is on it". A card with no override shows nothing. In a plain card the chip takes the labels' place (the labels return when the card has no chip); in the wide layout the chip stays before the Label and Changed columns.

In the open card the `Model` and `Thinking` selects show the values, and the line under them says `Set on this card: opus, medium.` followed by `It stays with the card until you choose Auto.`; with nothing set, `Auto: Settings decide. Planner opus, high; worker sonnet, medium.`

## 19. Light theme, and what to do if a token does not paint

| If | Do |
|---|---|
| `userMessageBackground` does not paint on the pane | Tiles, title bars, collapsed lane lines and the chosen tab's chip lose their fill; they keep their outlines. Add 1 row of padding to a title bar so the text clears its outline. Everything still reads. |
| `borderColor` raw `#74746f` does not paint | Use the default outline colour, not dim. |
| inverse of `dimColor` does not paint | The count chip is plain `dimColor` text. |
| `▰ ▱ ↕ ⋯ ▾ ▸ ◂ ✓` do not render | Bar: `#` and `-`; sort `v`; chevrons `v` and `>`; back `<`. |
| hover reveals fail | They are already off (7.4).

The board follows the app's theme (KB-0041): every colour it draws is a theme key (section 1), never a hex value, because the kit gives a Client no theme to choose a palette by. `tests/client.test.ts` fails if a drawn Box or Text carries a raw colour. In the dark theme the cards are the surface colour (a little darker than the pane) with outlines for hover, open and held, where the first build had lighter and darker fixed fills. The mock draws the light theme with the same layout; only the colours in section 1 change.

## 20. Terminal fallback

Cells are characters. Add `2b` to every bordered box (section 0). A one-row card becomes 3 rows (`h + 2b`); a lane panel's title bar gets a border row above it. The hover reveals do not exist: draw `⋯` always (dim) and skip 7.4. Native controls reserve 2 rows as on the desktop. The numbers in section 2 are the same.

## 21a. The chat as manager

The pane makes the main session the board's manager (`hooks/register.tsx` `prompt.submit` and `chatNote`; the text is `managerNote` in `hooks/lib/strings.ts`).

**The note.** A hidden context line attached to the prompt; the typed text is never changed.

| Part | Text |
|---|---|
| Always | `Kanban board: this project has kanban/board.md (owner <owner>). You are its manager. Before acting on a request that changes the project, or one that answers a waiting card, use the kanban skill ("Requests in chat").` |
| When cards wait in a Needs You lane | a second line `Waiting on <owner>: BUG-0036 PLAN READY; ENH-0041 QUESTION: which colour?`: at most 5 cards, each as ID and flag (the flag cut at 60 characters, the ID alone when the flag is empty), then `and N more` |

- **When.** Only for a prompt the person types in the composer or sends through Remote Control, in a project whose board can be read and written. Never for a `Kanban:` prompt, a slash command, an SDK or scheduled prompt, or a read-only board. The cost is about 45 tokens a prompt, more when cards wait.
- **Never carries** a card title, a card body or a Log line: the owner, IDs and flags only.

**Busy during any turn.** The pane is busy from the start of every turn (`inTurn`), not only a turn it started, and idle again when the main session's turn completes.

**Cards named in chat count as worked.** A typed prompt that contains a full card ID on the board (any letter case) marks that card as the one being worked, and so does a card file the main session writes in a turn not started by a `Kanban:` prompt. The header then reads `Claude is on ENH-0057`, as for a pane prompt, until the turn completes.

**Reserve-first Add.** The pane's `Add` (section 11) writes the chosen type's counter line (`next_bug`, `next_enh`, `next_chore`: one per type, its letters in lowercase) in `board.md` first and the card file second, so two writers never take one number of a type. The number is the larger of the counter, one more than the highest file of that type, and one more than any old ID of that type. If a file for the ID already exists the pane writes no card and shows the toast `BUG-0016 was just taken. Press Add again.` A `Write` that would create a second file for an ID that already has one is denied. A retype (12.5) is the one thing that changes a card's ID; it reserves the new type's counter the same way, and the old ID is never handed out again.

## 21. Live updates

The pane re-draws from the board about once a second and at once after Claude edits a card. Everything in section 8 is recomputed each time. The chosen tab, the open card menu, the open card, an open create field, fold choices, the sort of each lane and the scroll position are kept across redraws. A card Claude moves while he is dragging does not cancel the drag; the release is judged against the board as it is then (14.4, stale). The open card follows the card by ID, and through a retype (12.5) by its old IDs, so it stays open on the same card under its new ID.

A card moved outside the pane (in Obsidian's Bases board, which writes only `status`) is noticed by the same refresh: when a card's `status` differs from the last refresh and its newest `moved <old> -> <new>` Log line does not name the new lane, and the next refresh still sees it (Claude writes `status` and its Log line in two edits), the pane appends one Log line `moved <old> -> <new> in Obsidian` (by the board owner; `updated` is set with it). No prompt is sent, no toast shows, `order` is not changed, and the Log line it writes is what stops a second one.

## 22. What changes from the built version

The builders work from this list. Each line is a change to `hooks/board.tsx`, `hooks/lib/layout.ts`, `hooks/ui/` or `hooks/register.tsx` (and, for 21 to 26, the settings and card-file code).

**Layout and drawing**
1. Cell size is 8.25 by 20 px; fills paint (`userMessageBackground`); borders are zero-cell on the desktop (section 0, `b`).
2. Margins: 2 cells left and right of everything (was 0 and 1).
3. **Native header** (section 3): flex rows of native controls with no fill and no outline. Row 1 is what waits on him (one filled `3 need you` button, the kinds beside it) and the two tabs; the rows under it are what Claude is doing (`● Claude is on ENH-0014`, the step, `1 of 3 workers`, `○ 1 waiting to start`) and `changed 11:33` without seconds. `queued` is renamed `waiting to start` everywhere.
4. **Lane panels** (section 5): a lane with cards is an outlined panel with a surface-filled title bar and 1-row gaps. Replaces the bare header line directly over butted tiles.
5. **Every lane is a row** (sections 5 and 6): in board order, an empty lane or a collapsed lane is one line in its place, and `done`, `backlog`, `parked` and `scrapped` start collapsed. There is no strip of pills.
6. **No sentence on a lane with cards.** The rule sentence is not drawn on hover (reveals are off); an empty lane's line carries a short hint, and a lane being dragged over shows its drop sentence.
7. **`⋯` always drawn**, and a press opens the small menu under the card (section 12). The title bar's `+ Add`, `+` and `↕` controls are removed (KB-0024).
8. **Cards:** 1 row when plain, 2 rows when they have a status line (section 7). Gap row between cards. Labels shown on plain cards.
9. **The card's second line** is its status and progress (section 8), with the time it last moved.
10. **Working** card: unchanged label, now with a step bar and step text. **Waiting to start** is a new state (section 9).
11. **Waiting on him** is flag **and** Claude-only lane; stale flags are ignored (section 9).
12. **Open card:** the log, plan steps and description are shown in full, wrapped; one comment field with its own submit; `Lane` shows the card's real lane; status box; plan steps; the log's last 6 lines. New: four selects, `Type`, `Lane`, `Model`, `Thinking`, with a line under them (section 10); `Type` asks before it retypes (12.5).
13. **Creating a card** (section 11): from the toolbar's `New card` row (title, type, lane, `Add`, `Cancel`). The lane's own `+` field is removed (KB-0024).
14. **Widening is option B and nothing else** (decided): cards never flow across; at `iw >= 100` the Label and Changed columns appear and the title bar shows their headings; the board stops growing at 150 cells. Remove the `t = floor(W/49)` rule. Options A, C, D, E are gone from this spec and from the mock.
15. **Tabs** (section 3, 4): `Board` and `Settings`, drawn in the header's first row. **Settings is a tab** that replaces the lanes, not a box that opens under the header and pushes them down.
16. **Settings tab** (section 4): the five settings become Workers at once plus, for each of Manager, Planner, Worker, Advisor, a model Select and a thinking Select beside it, as flex rows with no outline; the default and a `Reset` show only on a row that differs; the app's own usage sentence in place of a cost table; `Restore all defaults`. The built Settings was five Selects in one flat row, with the label inside each, and had no thinking.
17. **Card actions** (section 12): a card's `⋯` opens a small menu under the card (`Open card`, `Copy ID`, `Delete card…`, which asks `Delete it` or `Keep it`); `Lane`, `Model`, `Thinking`, `Copy ID` and `Delete card…` are also in the open card. There is no right-click menu. In the open card a press on a Log line's date copies the whole line, `Copy command` under a line copies only the text between backticks, and `Copy entire log` beside `Log` copies every line (section 10): they write and send nothing.
18. **Pin chip** (18.5): a gray chip on the card's first row when the card has its own model or thinking.

**Behaviour**
19. **Sorting** (section 13): one `Sort` in the toolbar with seven options, set for every lane at once, held in the pane. (The per-lane `↕` menu is removed.)
20. **Placing** (14.5): drops in a `Your order` lane show a slot between two cards and send `before`; the module writes `order` midway. Today every drop goes to the end.
21. **Drag verdicts** keep the first design's words, with a new `place` kind and `same` sentences for sorted lanes; refusing lanes are a solid red outline; a collapsed line shows the short verdict.
22. **Toasts** for moves into acting lanes say whether Claude starts now or when it finishes what it is doing.
23. **Collapsed lines during a drag** are drop zones with verdicts.
24. **Thinking** (section 18): every agent the board starts is started with a model and, when set, a thinking level. The settings store gains a thinking value per role (Manager, Planner, Worker, Advisor) next to each model; where the agent is started, pass the level.
25. **Defaults** (18.1): one table of defaults in the module; saved settings override per key; a fresh install starts at the defaults; `Reset` removes the saved key.
26. **Per-card override** (18.4): two new lines in the card file, `model:` and `thinking:`; the card parser reads them (missing means Auto) and a writer sets and clears them; the planner and worker agents for the card take them before the board's settings.

## 23. Open questions

1. **Usage figures.** Settled for now: the Settings tab quotes the app's own sentence about Max and says the app gives no figure for the other levels; no figure is invented. It changes if the app publishes figures.
2. **Which agents the card's override drives.** Specified as planner and worker for that card; the Advisor and the Manager stay on Settings. If the Advisor should to follow too, 18.2 changes.
3. **Children.** Whether a card a plan creates inherits its parent's `model` and `thinking`. Specified: no.
4. **A card cannot say "Not set".** A card whose thinking is Auto follows the board even when the board is high; there is no card-level "no thinking". A fifth chip `Not set` would add it.
5. **Which model and level pairs exist.** If a model does not take every thinking level (for example `haiku` with `max`), the chip or Select option should be drawn dim and refuse a click; the pane has no list of them.
6. **Whether the Manager's model and thinking can be changed for a session that is already running.** Settings shows the choice; whether it takes effect on the open conversation is the module's call.
7. **Role sentences** in the Settings notes (what Manager, Planner, Worker, Advisor each do) are the designer's reading; check them.
8. **Defaults** (18.1) are the shipped default values.
9. Settled: the sort is one for the whole board, kept in pane state (`boardSort`), never in `board.md` or a card.
10. Whether `userMessageBackground` and raw `#74746f` paint as assumed in the light theme.
11. Whether the geometric glyphs (`▰ ▱ ▾ ▸ ◂ ↕ ⋯ ✓`) come from the app's font fallback as `● ○ ▶ ▲ ◆` do.
12. Settled on the real pane: native `Select`, `Button` and `Input` draw as real controls in the pane's own tree and as text inside the board region (`docs/design/desktop-paint-notes.md`), so the Settings tab, the open card, the header and the toolbar are in the pane's tree.
13. Whether hover reveals (`display: 'none'` with `hover: { display: 'flex' }`) work on the surface. Unproven; not used.
14. Settled: the tabs are two native buttons in the header's first row; the plugin opens one pane.

## 24. Check list

1. At `W` = 60, 70, 80, 90, 100, 108, 120, 146, 150, 160 the geometry of section 2's table; 107 has no Label and Changed columns, 108 has them.
2. No box's size depends on the length of its text; at 40 cells nothing overlaps (text is cut).
3. Busy day and quiet day at 80 cells: the lanes are as high as section 5 says (an empty or collapsed lane 1 row; 2 gap rows after an open lane, 1 between consecutive one-line lanes); the header and toolbar are flex rows with no fixed height.
4. Press Approve and run while Claude is busy: within one refresh the header's orange count drops, the Auto lane shows `○ 1 waiting to start`, the card shows `○ Waiting to start`, the open card closes and the lanes show; reopened, it shows the accent box and no buttons.
5. A flagged card in Auto, Pending or Done shows no orange anywhere.
6. Sorted by title, a lane shows the sort name and a place drop is refused with the sorted sentence; in `Your order` the slot appears and the dropped card sits where the slot was.
7. Starting a drag while the create field is open closes the field; no blue focus ring appears during a drag.
8. Orange appears only with a flag in a Claude-only lane; accent only with a worker, a queued turn, the turn, step marks, or an acting lane. The pin chip is neither.
9. With no fills and in the light theme, the board still reads.
10. Fresh install: the Settings tab says `Everything is at its default`; no `Reset` shows; Workers at once reads `2`; the models read `opus`, `opus`, `sonnet`, `fable` and the thinking Selects `medium (recommended)`, `high`, `medium (recommended)`, `high (recommended)`.
11. Change Planner thinking to `extra`: the row shows `Default: opus, high thinking` and `Reset`, and `Restore all defaults` appears (pressing it asks `Put every setting back to its default?`; `Keep` writes nothing); `Reset` puts `high` back and the saved key is gone.
11a. Change Planner thinking to `extra` and press `Save as defaults` (toast `Saved as your defaults.`): the row now reads as at its default and `Restore original defaults` appears; change it to `low` and the row shows `Default: opus, extra thinking` and `Reset` puts `extra` back; press `Restore original defaults` and `Restore` (toast `All settings are back to the original defaults.`): Planner thinking reads `high` and the saved defaults are gone; another board is unchanged throughout.
12. Open BUG-0015, choose Model `opus` and Thinking `medium`: the card shows `opus, medium` at once; move it to Auto and back: the chip stays; the next planner or worker agent for it starts on opus at medium; `Auto` in a select removes that line from the file; when Claude moves the card to Done both lines are removed.
13. A card on Auto uses Settings, Planner for its plan and Settings, Worker for its steps.
14. No `%` appears anywhere on the Settings tab.
15. The header at `W` = 60 shows both tabs and `changed`; no part of it overlaps.
16. The default board shows seven lanes in order: Needs You, Pending, Plan, Auto, Backlog, Done, Discarded. An empty Plan or Backlog is one line; Done and Backlog start collapsed; a collapsed line takes a drop.
17. A right press on a card opens nothing of ours; a click on a card opens it.
17a. At `W` = 45, 60, 80 and 108: a card's `⋯` opens no card but shows `Open card`, `Copy ID` and `Delete card…` whole, as wide as the card, directly under it, and the next card sits 3 rows lower; `Delete card…` turns it into `Delete BUG-0015?`, `This removes the card and its log.`, `Delete it`, `Keep it` over 4 rows, the next card 4 rows lower, and `Keep it` goes back to three; `Copy ID` toasts `Copied BUG-0015.` and closes it; `Open card` opens the card; `Delete it` toasts `Claude is deleting BUG-0015.`; pressing the same `⋯` again, another card, the lane title bar, or the Settings tab closes it; the one-second refresh keeps it open; on a board that cannot be read there is no `⋯`.
17b. In the open card, pressing the date of a Log line toasts `Copied the Log line.` and puts the whole line on the clipboard: date, time, name and words, without the file's leading `- `. The words are text: a long line wraps whole over as many rows as it needs and is never cut, and pressing the words does nothing. There is no `Copy` button under a line. A line with text between backticks has `Copy command` under it (`Copy command 1`, `Copy command 2` for two stretches); it toasts `Copied the command.` and puts only the text between the backticks, byte for byte. A line without backticks has no `Copy command`. After `Show the whole log` an older line copies the same way. `Copy entire log` beside the `Log` heading toasts `Copied the entire log.` and puts every line of the Log on the clipboard, also the hidden ones, one per row, oldest first, each with date, time and name; a card with no Log lines has no `Copy entire log`. The controls are drawn also on a board that cannot be read. No card file is written and nothing is sent to Claude. When the clipboard refuses, the toast reads `Could not copy the Log line: <reason>.`, `Could not copy the command: <reason>.` or `Could not copy the entire log: <reason>.`. At `W` = 40 the date, the wrapped words, `Copy command` and `Copy entire log` are still there and whole.
18. The ID column: a board whose longest ID is `BUG-0012` (8 characters) draws it 9 cells wide in every lane; one with `CHORE-0001` 11; the row-2 text and the dragged card's ID zone use the same width; a board of 11-character IDs or more stops at 12 and cuts the ID; the title column has `idw - 8` cells less than with an 8-cell column.
19. The `New card` row at `W` = 59, 60, 91 and 92: at 92 the field, `Type`, `Lane` and `Cancel` are one row; at 91 and 60 the field has a row and `Type`, `Lane`, `Cancel` share the next; at 59 `Type` has a row of its own and `Lane` and `Cancel` the last. `Type` starts on the board's first type; after adding an `enhancement` it still reads `enhancement`; the new card is `ENH-` and its number is that type's own next (a board with `BUG-0012` and no `ENH-` card gives `ENH-0001`); `board.md` holds `next_enh` before the card file exists.
20. Open `BUG-0012` in Pending, pick `enhancement` in `Type`: nothing is written and the question `Retype BUG-0012 as enhancement? Its ID will change.` shows with `Retype` and `Cancel`; `Cancel` puts `bug` back. `Retype` toasts `Claude is retyping BUG-0012 as enhancement.` and sends the retype prompt; when Claude has finished, the same card is open and the header reads `ENH-0001 (was BUG-0012)  in Pending`. In Auto, or with a worker on it, `Retype` toasts `BUG-0012 is being worked. Move it out of Auto or wait, then retype.` and sends nothing. A card whose letters are no type shows `No type`. A Log line `suggests type enhancement: ...` shows `Claude suggests enhancement: ...` until a `retyped` line follows it. The four lists are one row at `W` = 90, two rows of two at 89 and 60, stacked at 59.
21. `Find a card` with `bug` finds every `BUG-` card; with `BUG-0012` it finds the card that is `ENH-0001` now. `Newest first` puts the card made last first even when its number is lower than an older card of another type; a card with no creation time sorts as the oldest.
