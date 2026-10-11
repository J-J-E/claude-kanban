# Kanban file format

The one source of truth. `hooks/lib/*.ts` (hand-rolled parser) and `skills/kanban/SKILL.md` (Claude editing by hand) both follow it exactly. Section 13 holds the worked examples that `tests/` reuse. Dates are local `YYYY-MM-DD`; times are local 24-hour `HH:MM`.

## 1. Folder and filenames

- `kanban/board.md`: settings and lanes.
- `kanban/DECISIONS.md`: decision log.
- `kanban/<ID>-<slug>.md`: one card, e.g. `kanban/KB-0012-fix-the-morning-summary-date.md`. A card file is a top-level `kanban/*.md` whose name matches `^[A-Z]{1,10}-\d{4,}-.+\.md$`.
- `kanban/` sits at the repo root. Nothing else is read: other files and all subfolders are ignored.

## 2. Frontmatter subset grammar

Line 1 is `---` (a UTF-8 BOM before it is allowed and preserved), then lines of exactly three forms, then a line `---` closes it. Everything after is the body.

| Form | Example | Reads as |
|---|---|---|
| scalar | `flag: GATE: deploy` | string |
| inline list | `labels: [claude, ui]` | list of strings; `[]` is empty |
| block list | `lanes:` then `  - Pending (intake)` | list of strings |

- Key: `[a-z_][a-z0-9_]*`, then `:`, then a space or end of line (`key:value` is `bad-line`).
- Scalar: the value runs to end of line, is trimmed, and may contain colons. If it starts and ends with the same quote (`'` or `"`, length 2 or more), that one pair is stripped; nothing is unescaped. An empty value is `''`. An unquoted value starting with `[` must be a valid inline list.
- Inline list: items split on `,` and trimmed. An empty item (`[a, , b]`) or a missing `]` is `bad-line`. Items hold no commas and are not unquoted.
- Block list: `key:` with an empty value, then one or more lines `  - item` (two spaces, hyphen, space; item trimmed and non-empty).
- `key:` with an empty value and no `  - ` lines below it is form-neutral: the empty scalar `''`, read as `[]` by list-typed fields. Setters may rewrite it either way.
- One level only: no nesting, no comments, no blank lines, no multi-line values; any other line is `bad-line`. A repeated key is `duplicate-key`. Unknown keys and key order are preserved untouched by every edit.
- Written values are one line. A value starting with `[`, `'` or `"`, or with edge spaces, is wrapped in double quotes; a value that cannot be written that way (newline, or it also contains `"`) is `bad-value`.
- Line endings: detected from the file's first line ending (`\r\n` is CRLF, else LF). Edits keep the file's own EOL, also on added lines. New files use LF and end with a newline.

## 3. Card fields

Written in this order. Required: `id`, `status`. Every other field is written on creation but may be empty, except `model` and `thinking`, which are written only when set.

| Field | Type | Default | Written by | Notes |
|---|---|---|---|---|
| `id` | `<PREFIX>-<n>` | none (required) | skill or pane, at creation | Section 7. Never changes. |
| `status` | lane label | none (required) | either | Spelled as in `board.md`; read case-insensitively, trimmed. Pane writes it on a drop. |
| `order` | integer `^\d+$` | lane max + 1000 | either | Section 9. Absent or empty reads as 0. Pane writes it on a drop. |
| `created` | date | today | skill or pane, at creation | Never changes. |
| `updated` | date | = `created` | either | Set to today by every edit. Pane writes it on a drop. |
| `flag` | free text | empty | skill | Shown as a badge: `PLAN READY`, `QUESTION: <question>`, `FAILED`, `GATE: <reason>`. |
| `branch` | free text | empty | skill | Branch name. |
| `pr` | free text | empty | skill | PR number or URL. |
| `parent` | card ID | empty | skill | Parent card's ID on a child card. |
| `labels` | inline list | `[]` | skill | `claude` marks Claude's own suggestions. Readers also accept a block list. |
| `model` | `haiku` `sonnet` `opus` `fable` | absent (Auto) | pane, or skill when asked | The card's own model. Absent, empty or any other word means Auto: the board's setting applies. Written only when set, removed on Auto, never written as `auto`. |
| `thinking` | `low` `medium` `high` `xhigh` `max` | absent (Auto) | pane, or skill when asked | The card's own thinking level, with the same rules as `model`. A card can pin one and leave the other on Auto. |

`model` and `thinking` stay with the card until the person resets them to Auto or the card is completed: moving it to another lane, or back, never touches them. When Claude moves a card to the lane with role `done`, it removes both lines in the same edit as the `status` change (with `updated`). A person sets them in the open card (its Model and Thinking dropdowns). They drive the planning agent and the step workers for that card in place of the board's `planner_*` and `worker_*` settings, read fresh at the start of every agent (an agent already running keeps what it started with). They never affect the manager or the advisor, and a child card does not inherit them.

## 4. Card body

After the closing `---`: `# Title` as the first non-blank line; the requirement and open questions in the person's words (no design choices); an optional `## Plan` (numbered steps, written by Claude); `## Log` last.

- A section runs from its `## ` heading to the next `## ` heading or end of file. Headings match exactly (`## Plan`, `## Log`); any other section is preserved untouched.
- A missing `## Log` reads as no events; the first append creates it at the end of the file, after a blank line.

## 5. Log grammar

One line per event, appended after the last non-blank line of `## Log`, newest last. The line, then its regex (run on the line with its EOL removed):

```
- YYYY-MM-DD HH:MM <who>: <text>
^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) ([^:]+): (\S.*)$
```

`<who>` is the board `owner` or `Claude`. `<text>` is one line and may contain colons. Standard texts:

- `created in <lane>`: card created; `<lane>` is the lane it was created in (the first intake lane from chat, or the lane chosen in the pane).
- `moved <from> -> <to>`: status changed.
- `started: <branch>` or `started: in place`: the first line of an Auto run or a gate approval; "what's next" reads `Claude: started`.
- `step n done: <what>`: a step was reviewed and accepted.
- `retry n of 3: <what failed>`: an Auto retry failed, e.g. `retry 2 of 3: tests failed`.
- `question: <the question>`: Claude stopped to ask.
- `approved: <flag text>`: the owner dragged a card flagged `GATE` out of Needs You; the text is the flag that was held.
- `merged <branch>`: the branch was merged.
- `waiting on <child IDs>`: a parent stopped because those child cards are not Done.
- `closed by <owner>: <outstanding or nothing outstanding>`: the owner dropped a card into Done.
- `stopped at step <n>`: a person dragged a card being worked out of an `auto` lane into an `intake` or `backlog` lane, and the work stopped.
- `parked at step <n>: <what is left>`: the card was parked (older boards).
- `scrapped at step <n>; branch <branch>, PR <pr or none> left for <owner> to close`: the card was scrapped.
- Anything else is a free comment.

Timestamps come from the shell, never guessed: bash `date "+%Y-%m-%d %H:%M"`, PowerShell `Get-Date -Format "yyyy-MM-dd HH:mm"`. Appending a Log line also sets `updated` to its date.

## 6. Board file

`kanban/board.md` is frontmatter (settings, then `lanes:`) followed by free notes, which no tool edits.

| Key | Type | Default | Notes |
|---|---|---|---|
| `prefix` | `[A-Z]{1,10}` | `KB` | |
| `next_id` | integer, 1 or more | `1` | Section 7. |
| `owner` | text | none (required) | The person's first name; `<who>` for their Log lines. |
| `workers` | integer 1-5 | `2` | Max concurrent agents, planning agents included. |
| `manager_model` | `haiku` `sonnet` `opus` `fable` | `opus` | |
| `manager_thinking` | `low` `medium` `high` `xhigh` `max` `none` | `medium` | Saved and shown; the manager is the session itself, so it is told once, not set (SKILL.md). |
| `planner_model` | `haiku` `sonnet` `opus` `fable` | `opus` | The model of the planning agents that write plans. |
| `planner_thinking` | `low` `medium` `high` `xhigh` `max` `none` | `high` | The Agent tool's `effort` for a planning agent. |
| `worker_model` | `haiku` `sonnet` `opus` `fable` | `sonnet` | |
| `worker_thinking` | `low` `medium` `high` `xhigh` `max` `none` | `medium` | The Agent tool's `effort` for a step worker. |
| `advisor_model` | `haiku` `sonnet` `opus` `fable` `none` | `fable` | |
| `advisor_thinking` | `low` `medium` `high` `xhigh` `max` `none` | `high` | The Agent tool's `effort` for the advisor. |
| `default_workers`, `default_manager_model`, `default_manager_thinking`, `default_planner_model`, `default_planner_thinking`, `default_worker_model`, `default_worker_thinking`, `default_advisor_model`, `default_advisor_thinking` | as the setting named after `default_` | none | The board's saved default for that setting. |

An absent key takes its `default_` key if the board has one, else its built-in default (the Default column), so a new board holds only `prefix`, `next_id`, `owner` and `lanes:` and a person's change adds one line. A `default_` line belongs to its board alone: another board, and a board made later, keep the built-in defaults. For a thinking key the word `none` means Not set: no `effort` is passed and the model uses its own default; any other word is the level. Every level is allowed with every model. The pane shows `xhigh` as "extra"; files and Agent calls keep `xhigh`. "Ultracode" is the app's own multi-agent mode, chosen in the app's effort control: it is never written to a thinking line and never passed as an agent's `effort`. The pane marks the level the app recommends for a role's model (opus medium, fable high, sonnet medium, haiku medium); changing a role's model does not change its thinking. The only usage figure is the app's own sentence: "Claude thinks longer with Max effort and can consume 3.5× or more usage than Medium." The pane's `Reset` removes the key's line, and `Restore all defaults` removes every settings line (`workers` and the eight model and thinking keys), so each lands on the board's saved default, else the built-in one; `prefix`, `next_id`, `owner` and `lanes:` stay. `Save as defaults` writes, for each of the nine settings, its current value to its `default_` line when that differs from the built-in value (added just before the closing `---`, or replaced in place) and removes that `default_` line when it equals the built-in value, then removes the nine settings lines; the board reads the same values. `Restore original defaults` (the pane asks first) removes every `default_` line and every settings line, so each setting reads its built-in value. A line equal to its default is allowed and reads the same as no line. A `default_` line takes the same values as its setting; any other value, or a missing `owner`, is `bad-setting`.

**Lanes.** `lanes:` is a block list; list order is board order. Each item is `Label (role)`; the exact pattern is under "Roles older boards may list" below.

| Role | Meaning | Who may move cards in |
|---|---|---|
| `intake` | New, untriaged cards; the first intake lane takes new cards and Claude's suggestions. | either |
| `plan` | Claude writes a plan into the card. | John |
| `needs-you` | Everything that waits on the owner: a question, a plan to approve, a failure, a held action (`GATE: <reason>`). | Claude only |
| `auto` | Claude runs the card end to end. | John, or Claude resuming |
| `backlog` | Ideas and notes kept for later. A drop starts nothing and it is not untriaged. | either |
| `done` | Finished. | Claude, or John |
| `scrapped` | Abandoned. | John, or Claude when asked |

"John" is the board `owner`; "either" is the owner or Claude. Only `needs-you` is enforced (`claude-only`); the rest are convention. Lane actions are in `lanes.md`. Rules:
- A label is one or two words of letters or digits, no punctuation. Labels are unique, compared case-insensitively.
- At least one lane has role `intake`. New cards go to the first intake lane. Several lanes may share a role; behaviour hangs on the role, not the label.
- Renaming a label is a skill-driven bulk edit: the `lanes:` item, and the `status:` line of every card in that lane.

**Roles older boards may list.** A board made earlier can list `manual` (John directs Claude one step at a time; John moves in), `parked` (paused, not abandoned; either moves in) and `gated` (behaves exactly like `needs-you`, Claude only); they load and work as in lanes.md. An item may also end `, side` (`Parked (parked, side)`), which is accepted and ignored. The full pattern (JS `u` flag):

```
^([\p{L}\p{N}]+( [\p{L}\p{N}]+)?) \(([a-z-]+)(, side)?\)$
```

## 7. IDs

`<PREFIX>-<n>`, `n` zero-padded to 4 digits (more digits past 9999). Valid IDs match `^[A-Z]{1,10}-\d{4,}$`. The branch for a card is `kb-<n>-<slug>` with `n` unpadded (`kb-12-fix-the-morning-summary-date`); see lanes.md Auto step 3.

- Allocate `n = max(next_id from board.md, highest existing n + 1)`. Highest existing n: scan top-level `kanban/*.md` names matching `^<PREFIX>-(\d+)(-.*)?\.md$` for this prefix, case-sensitive; other prefixes, `board.md` and `DECISIONS.md` are ignored. This scan is deliberately looser than section 1, so a hand-made file never causes reuse. With no cards, the highest existing n is 0.
- After creating the card, write `next_id: <n + 1>` to `board.md`.
- IDs are never renumbered and never reused; gaps stay. A card's filename starts with `<id>-`.
- A duplicate or junk card is deleted outright. Abandoned real work goes to the lane with role `scrapped`.

## 8. Slug

Computed from the title, fixed at creation (a title change never renames the file):
1. Lowercase; strip diacritics (decompose, drop combining marks).
2. Every run of characters outside `[a-z0-9]` becomes one `-`; trim leading and trailing `-`.
3. If longer than 40, keep 40 characters; unless the 41st is `-`, drop the cut word back to the last `-` (a lone word over 40 is hard-cut); trim trailing `-`.
4. Empty becomes `card`.

`Fix the morning summary date` becomes `fix-the-morning-summary-date`; `Café: état 3!` becomes `cafe-etat-3`.

## 9. Order within a lane

`order` is an integer; a lane is sorted by `order`, ties by ID.
- A new or moved card takes the lane's highest `order` + 1000 (1000 when the lane is empty). A moved card is not counted in its target lane.
- Between two cards: the midpoint, `floor((a + b) / 2)`.
- No integer gap (`b - a < 2`): renumber that one lane 1000, 2000, ... in sorted order, editing only the `order:` lines. No other lane changes.
- Placing: the pane places a card (a drop on a gap between two cards, with the lane in Your order) by writing `order` midway between its two neighbours, 1000 beyond the first or last card (a lane's first card has no room below it when its `order` is under 1000: that renumbers too), 1000 for the only card. A place inside the card's own lane writes `order:` lines only: no `updated`, no Log line. A sort other than Your order is a view kept by the pane and is never written to a card.

## 10. DECISIONS.md grammar

A `# Decisions` heading, a blank line, then one line per decision. The line, then its regex:

```
- **D<n> (YYYY-MM-DD) <title>:** <decision>. Reason: <why>.
^- \*\*D(\d+) \((\d{4}-\d{2}-\d{2})\) ([^*]+):\*\* (.+)$
```

- `n` = highest existing + 1 (1 when none). Lines are never removed, so a number is never reused.
- A change is a new line ending `Supersedes D<k>.`; the old line is untouched.
- New lines are appended at the end of the file. Other lines are preserved.

## 11. Editing rules

- Edit only the named lines: a card's `status`, `order`, `updated`; the `# ` title line (a rename, with `updated` and one Log line; the file name never changes); a card's `model` and `thinking` (set, removed on Auto, or removed when Claude moves the card to the lane with role `done`, with `updated`); one appended Log line; the settings lines in `board.md`; `next_id`; one appended DECISIONS line. The skill also edits `flag`, `branch`, `pr`, `parent`, `labels`, the body and `## Plan`, only when asked to.
- Replace the line in place. If the key is absent, add the line just before the closing `---`. To remove a key (a settings Reset, or a `default_` line), take its whole line, and for a block list its item lines, and nothing else.
- Keep every other byte: unknown keys, key order, body, BOM, the file's EOL. A write that would change nothing is skipped.
- The pane's permitted writes are exactly: a card's `status:`, `order:` and `updated:` lines; the `order:` lines alone of the cards of one lane when it places a card (its own and, when no whole number fits, the lane's renumbering); a card's `model:` and `thinking:` lines (added when set, removed on Auto); the `# ` title line with `updated` and one Log line `renamed from "old title"` (a rename in the open card; the file name stays, section 8); one Log line (a move or a comment); the settings lines in `board.md` (set, or removed whole by Reset and Restore all defaults), the `default_` lines (written or removed whole by Save as defaults, all removed by Restore original defaults) and `next_id`; and creating one new card file per add, built by the rules of sections 3, 4, 7, 8 and 9 with an empty body. It never deletes or renames files.

## 12. Problem codes

Shared by the library and the skill's "Fix needed" line.

| Code | Raised when |
|---|---|
| `no-frontmatter` | The file is empty, or line 1 (after an optional BOM) is not `---`. |
| `unterminated` | Line 1 is `---` but no closing `---` follows. |
| `bad-line` | A frontmatter line fits none of the three forms (section 2). |
| `duplicate-key` | A key appears twice in one frontmatter. |
| `type-mismatch` | A scalar setter hits a list key, a list setter hits a scalar key, or a list-typed field holds a non-empty scalar. |
| `bad-value` | A non-empty card value does not fit its type (`order` not an integer, `created`/`updated` not a date), or a value cannot be written. |
| `missing-field` | `id` or `status` is absent, or the body has no `# Title`. |
| `bad-id` | `id` does not match `^[A-Z]{1,10}-\d{4,}$`. |
| `id-name-mismatch` | The filename does not start with `<id>-`. |
| `duplicate-id` | Two card files have the same `id`. |
| `unknown-lane` | A card's `status`, or a move target, is not a label in `board.md`. |
| `claude-only` | Anyone but Claude moves a card into a `needs-you` (or older `gated`) lane. |
| `same-lane` | A move targets the lane the card is already in. |
| `bad-lane` | A `lanes:` item does not fit `Label (role)`. |
| `bad-role` | A lane's role is not one of the ten. |
| `duplicate-lane` | Two lane labels are equal, ignoring case. |
| `no-intake` | `lanes:` is absent, empty, or has no `intake` lane. |
| `bad-setting` | A `board.md` setting or `default_` line is outside its allowed values, or `owner` is missing. |

## 13. Worked examples

Card `kanban/KB-0012-fix-the-morning-summary-date.md`:

```
---
id: KB-0012
status: Auto
order: 2000
created: 2026-10-08
updated: 2026-10-08
flag:
branch: kb-12-fix-the-morning-summary-date
pr:
parent:
labels: [claude]
---
# Fix the morning summary date

The requirement in John's words. Open questions stay here.

## Plan
1. ...

## Log
- 2026-10-08 09:10 John: moved Pending -> Auto
- 2026-10-08 09:11 Claude: started: kb-12-fix-the-morning-summary-date
```

The same card with its own model and thinking set from the pane; the two lines follow `labels`, and clearing both returns the file to the card above with a new `updated`:

```
labels: [claude]
model: opus
thinking: medium
---
```

Board `kanban/board.md`, as init writes it (`next_id: 1`, no settings lines: every setting takes its default):

```
---
prefix: KB
next_id: 1
owner: John
lanes:
  - Needs You (needs-you)
  - Pending (intake)
  - Plan (plan)
  - Auto (auto)
  - Backlog (backlog)
  - Done (done)
  - Discarded (scrapped)
---
# Board notes

Free text.
```

The same board after a person has changed some settings (each line is one change; `planner_thinking: high` is also the default, so that line reads the same as none; removing it changes nothing):

```
---
prefix: KB
next_id: 13
owner: John
workers: 1
manager_model: opus
planner_model: opus
worker_model: sonnet
advisor_model: fable
planner_thinking: high
lanes:
  - Needs You (needs-you)
  - Pending (intake)
  - Plan (plan)
  - Auto (auto)
  - Backlog (backlog)
  - Done (done)
  - Discarded (scrapped)
---
# Board notes

Free text.
```

Decisions `kanban/DECISIONS.md`:

```
# Decisions

- **D1 (2026-10-08) Ideas are cards:** There is no BACKLOG.md; every idea is a card in Pending. Reason: one place to look.
- **D2 (2026-10-09) Backlog is not untriaged:** Ideas moved to Backlog are no longer listed under untriaged. Reason: ideas we may never build should not nag. Supersedes D1.
```
