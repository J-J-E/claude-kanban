# Kanban file format

The one source of truth. `hooks/lib/*.ts` (hand-rolled parser) and `skills/kanban/SKILL.md` (Claude editing by hand) both follow it exactly. Section 13 holds the worked examples that `tests/` reuse. Dates are local `YYYY-MM-DD`; times are local 24-hour `HH:MM`.

## 1. Folder and filenames

- `kanban/board.md`: settings and lanes.
- `kanban/DECISIONS.md`: decision log.
- `kanban/<ID>-<slug>.md`: one card, e.g. `kanban/BUG-0012-fix-the-morning-summary-date.md`. A card file is a top-level `kanban/*.md` whose name matches `^[A-Z]{1,10}-\d{4,}-.+\.md$`. A retype renames the file to the new ID and the same slug (`ENH-0007-fix-the-morning-summary-date.md`); nothing else renames a card file.
- `kanban/` sits at the repo root. Nothing else is read: other files and all subfolders are ignored. The board is found from the folder the session was opened in, or from a parent folder that holds `kanban/board.md`, not from the shell's current folder.

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
| `id` | `<TYPE LETTERS>-<n>` | none (required) | skill or pane, at creation | Section 7. Changes only on a retype, which Logs the old one. |
| `status` | lane label | none (required) | either | Spelled as in `board.md`; read case-insensitively, trimmed. Pane writes it on a drop. |
| `order` | integer `^\d+$` | lane max + 1000 | either | Section 9. Absent or empty reads as 0. Pane writes it on a drop. |
| `created` | date | today | skill or pane, at creation | Never changes. |
| `updated` | date | = `created` | either | Set to today by every edit. Pane writes it on a drop. |
| `flag` | free text | empty | skill | Shown as a badge: `PLAN READY`, `QUESTION: <question>`, `FAILED`, `GATE: <reason>`, `READY TO MERGE` (a checked pull request or branch waits for the owner to merge it; the pane draws it green). A flag holds only the short question; a command the owner must run goes in the Log line (section 5). Claude also clears it when the owner drops a card into a `done` or `scrapped` lane. |
| `branch` | free text | empty | skill | Branch name. |
| `pr` | free text | empty | skill | PR number or URL. |
| `parent` | card ID | empty | pane or skill | Parent card's ID on a child card. A retype of the parent repoints it. The pane's Parent list and the skill's `parent` verb set or remove it (section 11), refused for the card itself, a card not on the board and a loop. |
| `labels` | inline list | `[]` | skill | `claude` marks Claude's own suggestions; `tour` marks the onboarding tour card, and `tour-sample` its two sample tickets, which are ordinary cards (verbs.md, tour). Readers also accept a block list. |
| `model` | `haiku` `sonnet` `opus` `fable` | absent (Auto) | pane, or skill when asked | The card's own model. Absent, empty or any other word means Auto: the board's setting applies. Written only when set, removed on Auto, never written as `auto`. |
| `thinking` | `low` `medium` `high` `xhigh` `max` | absent (Auto) | pane, or skill when asked | The card's own thinking level, with the same rules as `model`. A card can pin one and leave the other on Auto. |

`model` and `thinking` stay with the card until the person resets them to Auto or the card is completed: moving it to another lane, or back, never touches them. When Claude moves a card to the lane with role `done`, it removes both lines in the same edit as the `status` change (with `updated`). A person sets them in the open card (its Model and Thinking dropdowns). They drive the planning agent and the step workers for that card in place of the board's `planner_*` and `worker_*` settings, read fresh at the start of every agent (an agent already running keeps what it started with). They never affect the manager, and a child card does not inherit them.

## 4. Card body

After the closing `---`: `# Title` as the first non-blank line; the requirement and open questions in the person's words (no design choices); an optional `## Plan` (numbered steps, written by Claude); `## Log` last. A merge (section 11) adds a `## Merged from <ID>: <title>` section just before `## Plan` (or before `## Log` when there is no plan).

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
- `question: <the question>`: Claude stopped to ask. When the question is about something Claude could not run and needs the owner to run, the line states, in order: what was attempted and why it could not run (the app's safety check, a denied permission, a missing sign-in, or the real cause); the exact command as one line in backticks (one command per pair of backticks, double backticks if the command holds one, absolute paths); the shell it is for; and what it does and removes and what the card needs it for. With no command to give, the line says what the owner must do. The pane gives a Log line with text in backticks a `Copy command` button. Example: ``question: PR <url> not merged: the app blocked the merge; run in PowerShell: `gh pr merge <url> --squash --delete-branch` (merges the pull request and deletes its branch); or say: merge it``
- `approved: <flag text>`: the owner dragged a card flagged `GATE` out of Needs You; the text is the flag that was held.
- `parent set to <ID>` / `parent removed (was <ID>)`: the card's `parent:` was set or removed, e.g. `parent set to ENH-0025`. Written with the `updated` bump by the pane or the skill.
- `retyped from <old ID> to <new ID>`: the card's type changed, e.g. `retyped from BUG-0012 to ENH-0007`. Exactly this text: the old IDs of a card are read from these lines (section 7).
- `merged <old ID> "<old title>" into <new ID>`: on the surviving card, the card with that ID and title was merged into it, e.g. `merged BUG-0012 "Fix date" into BUG-0008`. Exactly this text, the title in double quotes: the old IDs of a card are read from these lines too (section 7).
- `spawned from <ID>`: on a card made from another card; `<ID>` is the source.
- `spawned <ID>: <title>`: on the source card, for the card made from it.
- `suggests type <type>: <reason>`: Claude thinks the card has another type. It never retypes on its own.
- `merged <branch>`: the branch was merged.
- `waiting on <thing>`: Claude is waiting on a named thing and nothing is running for it: child card IDs (a parent stopped because those children are not Done), another card, John, a lead, hardware. The pane and "what's next" read the newest `Claude:` line; one that starts `waiting on` (or `queued behind <ID>`) marks the card as waiting. The one definition of a hold (`waiting on <ID>: queued behind it, one card's workers at a time`), of a wait on a person (`waiting on John`) and of when a wait ends is in `references/lanes-auto.md`, Running, waiting, nobody. Name only what is really being waited for; a line naming only Done cards no longer counts as a wait.
- `closed by <owner>: <outstanding or nothing outstanding>`: the owner dropped a card into Done. It may end with `; cleared flag <text>` when the card held a flag.
- `stopped at step <n>`: a person dragged a card being worked out of an `auto` lane into an `intake` or `backlog` lane, and the work stopped.
- `parked at step <n>: <what is left>`: the card was parked (older boards).
- `scrapped at step <n>; branch <branch>, PR <pr or none> left for <owner> to close`: the card was scrapped. It may end with `; cleared flag <text>` when the card held a flag.
- Anything else is a free comment.

Timestamps come from the shell, never guessed: bash `date "+%Y-%m-%d %H:%M"`, PowerShell `Get-Date -Format "yyyy-MM-dd HH:mm"`. Appending a Log line also sets `updated` to its date.

## 6. Board file

`kanban/board.md` is frontmatter (settings, then `lanes:`) followed by free notes, which no tool edits.

| Key | Type | Default | Notes |
|---|---|---|---|
| `types` | list of `name (LETTERS)` or `name` | `bug (BUG)`, `enhancement (ENH)`, `chore (CHORE)` | The card types; section 7. Written like `lanes:`. |
| `next_<letters>` | integer, 1 or more | `1` | One line per type, its letters in lowercase: `next_bug: 13`. The type's next number; section 7. |
| `owner` | text | none (required) | The person's first name; `<who>` for their Log lines. |
| `workers` | integer 1-5 | `2` | Max concurrent agents, planning agents included. |
| `manager_model` | `haiku` `sonnet` `opus` `fable` | `opus` | The model the board suggests for the chat, not a requirement. The pane shows the chat's own model and never switches it; the person changes the chat's model in the model picker or with /model, or makes it the board's Manager model with `Keep`. |
| `manager_thinking` | `low` `medium` `high` `xhigh` `max` `none` | `medium` | Saved and shown; the manager is the session itself, so it is told once, not set (SKILL.md). |
| `planner_model` | `haiku` `sonnet` `opus` `fable` | `opus` | The model of the planning agents that write plans. |
| `planner_thinking` | `low` `medium` `high` `xhigh` `max` `none` | `high` | The Agent tool's `effort` for a planning agent. |
| `worker_model` | `haiku` `sonnet` `opus` `fable` | `sonnet` | |
| `worker_thinking` | `low` `medium` `high` `xhigh` `max` `none` | `medium` | The Agent tool's `effort` for a step worker. |
| `needs_you_in_chat` | `on` `off` | `off` | When `on`, the manager note adds a line (after the Waiting line, only when cards wait in a Needs You lane) that has Claude put each waiting card to the owner in chat as a question with choices (SKILL.md, Requests in chat, point 7a). Set in the Settings tab as `Chat questions`. Any other word is `bad-setting`. |
| `merge_by` | `claude` `owner` | `claude` | Who merges a card's pull request at the end of the Auto flow (lanes-auto.md, step 7). `claude`: Claude merges once the checks pass, and when the merge is refused or `gh` cannot run, the card waits in Needs You as `READY TO MERGE`. `owner`: Claude pushes and opens the PR but never merges; the card waits in Needs You as `READY TO MERGE`. Set in the Settings tab as `Merge by`. Any other word is `bad-setting`. |
| `setup_checked` | a date `YYYY-MM-DD` | none | Not a setting: the pane's first-run check (README, Setup check) writes it once, after it ran on this board, so it does not run again. Nothing reads its value; delete the line to run the check again. |
| `default_workers`, `default_needs_you_in_chat`, `default_merge_by`, `default_manager_model`, `default_manager_thinking`, `default_planner_model`, `default_planner_thinking`, `default_worker_model`, `default_worker_thinking` | as the setting named after `default_` | none | The board's saved default for that setting. |

An absent key takes its `default_` key if the board has one, else its built-in default (the Default column), so a new board holds only `owner` and `lanes:` and a person's change adds one line. A `default_` line belongs to its board alone: another board, and a board made later, keep the built-in defaults. For a thinking key the word `none` means Not set: no `effort` is passed and the model uses its own default; any other word is the level. Every level is allowed with every model. The pane shows `xhigh` as "extra"; files and Agent calls keep `xhigh`. "Ultracode" is the app's own multi-agent mode, chosen in the app's effort control: it is never written to a thinking line and never passed as an agent's `effort`. The pane marks the level the app recommends for a role's model (opus medium, fable high, sonnet medium, haiku medium); changing a role's model does not change its thinking. The only usage figure is the app's own sentence: "Claude thinks longer with Max effort and can consume 3.5× or more usage than Medium." The pane's `Reset` removes the key's line, and `Restore all defaults` removes every settings line (`workers`, `needs_you_in_chat`, `merge_by` and the six model and thinking keys), so each lands on the board's saved default, else the built-in one; `types:`, the `next_<letters>` lines, `owner` and `lanes:` stay. `Save as defaults` writes, for each of the nine settings, its current value to its `default_` line when that differs from the built-in value (added just before the closing `---`, or replaced in place) and removes that `default_` line when it equals the built-in value, then removes the nine settings lines; the board reads the same values. `Restore original defaults` (the pane asks first) removes every `default_` line and every settings line, so each setting reads its built-in value. A line equal to its default is allowed and reads the same as no line. A `default_` line takes the same values as its setting; any other value, or a missing `owner`, is `bad-setting`. A `board.md` written by an older version may hold `advisor_model`, `advisor_thinking` or `default_advisor_*` lines; they are unknown keys, kept untouched by every edit and ignored (never `bad-setting`).

**Types.** `types:` is a list, written like `lanes:`; each item is `name (LETTERS)` or a bare `name`. A name fits `^[a-z][a-z0-9-]{0,19}$`; letters fit `^[A-Z]{2,5}$` and are not `ID`. A bare name's letters are the name in capitals when it has 5 letters or fewer, else its first 3. Names are unique, letters are unique; a type that breaks a rule, or an empty list, is `bad-setting`. No `types:` means the three defaults. Every type has one counter line `next_<letters lowercase>`; an absent line counts as 1, a value that is not a whole number of 1 or more is `bad-setting`. A leftover `prefix:` or `next_id:` line in an older `board.md` is ignored and kept as it is.

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

"John" is the board `owner`; "either" is the owner or Claude. Only `needs-you` is enforced (`claude-only`); the rest are convention. Lane actions are in `lanes.md` (the Auto flow in `lanes-auto.md`). Rules:
- A label is one or two words of letters or digits, no punctuation. Labels are unique, compared case-insensitively.
- At least one lane has role `intake`. New cards go to the first intake lane. Several lanes may share a role; behaviour hangs on the role, not the label.
- Renaming a label is a skill-driven bulk edit: the `lanes:` item, and the `status:` line of every card in that lane.

**Roles older boards may list.** A board made earlier can list `manual` (John directs Claude one step at a time; John moves in), `parked` (paused, not abandoned; either moves in) and `gated` (behaves exactly like `needs-you`, Claude only); they load and work as in `older-roles.md`. An item may also end `, side` (`Parked (parked, side)`), which is accepted and ignored. The full pattern (JS `u` flag):

```
^([\p{L}\p{N}]+( [\p{L}\p{N}]+)?) \(([a-z-]+)(, side)?\)$
```

## 7. IDs

`<LETTERS>-<n>`: the letters of the card's type (section 6) and a number, `n` zero-padded to 4 digits (more digits past 9999). Valid IDs match `^[A-Z]{1,10}-\d{4,}$`. Every card has exactly one type, read from its ID: there is no `type:` line. Each type counts from 1 on its own, so `BUG-0001`, `ENH-0001` and `CHORE-0001` can all exist. The branch for a card is `<letters lowercase>-<n>-<slug>` with `n` unpadded (`bug-12-fix-the-morning-summary-date`); see lanes-auto.md Auto step 3.

- Allocate `n = max(the type's counter, highest existing n + 1, highest retired n + 1)`. The counter is the line `next_<letters lowercase>` in `board.md` (absent is 1). Highest existing n: scan top-level `kanban/*.md` names matching `^<LETTERS>-(\d+)(-.*)?\.md$` for these letters, case-sensitive; other letters, `board.md` and `DECISIONS.md` are ignored. This scan is deliberately looser than section 1, so a hand-made file never causes reuse. Highest retired n: the same letters among the old IDs of every card (the `retyped from` and `merged ... into` Log lines, below). With neither, the highest is 0.
- Reserve first, write after. With `n` from the line above and `k` the number of cards about to be made (1 for a single add; all the child cards of a plan split together), replace the exact line `next_<letters>: <counter as you read it>` with `next_<letters>: <n + k>` in one edit of `board.md`. If the type has no counter line, add `next_<letters>: <n + k>` just before the closing `---` (section 11) instead. If that exact line is no longer in the file (someone else changed it meanwhile), or a line has appeared, re-read `board.md` and start again from the new value. Only after the reservation succeeded, write the card file(s), numbered `n` to `n + k - 1`. A counter never goes down.
- Before writing a card file, check that no file in `kanban/` already starts with `<ID>-`; if one does, reserve a new number. A reserved number is never given back, so a card that fails half-way leaves a gap, which is fine.
- An ID changes only on a retype, and goes away only when its card is merged into another; no ID is ever handed out twice; gaps stay. A card's filename starts with `<id>-`.
- **Retype.** A card gets another type: it takes the next number of the new type (allocated and reserved as above), and in this order: the file is renamed to `<new ID>-<same slug>.md` (section 8); `id:` is set to the new ID and `updated:` to today; one Log line `retyped from <old ID> to <new ID>` is appended (section 5); `parent:` is set to the new ID in every card whose `parent:` is the old ID (their other lines, `updated` included, stay). Nothing else changes: `branch:`, `pr:`, the branch itself, the body, mentions in other cards and DECISIONS.md keep the old ID. A retype is refused while the card is in an `auto` lane or an agent is on it (`being-worked`), and for a type the board does not have (`unknown-type`). Claude retypes only when asked.
- **Merge.** A card A is merged into a card B (A is the one dragged, B the one dropped on): B keeps its ID, lane, place, `flag`, `model`, `thinking`, `branch`, `pr` and `parent`; A's file is deleted and A's ID is retired. The edits are in section 11: B's file is written first, then A's is deleted, so a crash between them leaves both files and loses nothing. Types and lanes may differ; B's win. A merge is refused, changing nothing, when A and B are the same card, when either is in an `auto` lane or has an agent on it (`being-worked`), when one is the parent of the other, when A has a `branch:` or `pr:`, or when A has child cards. Claude merges only when asked, or on the pane prompt (the merge verb, references/verbs.md).
- **Old IDs.** The old IDs of a card are the `<old ID>` of its `retyped from` and `merged ... into` Log lines, so a card retyped twice has two, and a card that took in another has that one too. An old ID is retired for good and always resolves to the card that holds it now (chains included): asking for `BUG-0012` after the retype answers with `ENH-0007`, and the reply names both; asking for `BUG-0012` after it was merged into `BUG-0008`, which was then retyped to `ENH-0009`, answers with `ENH-0009`. A merged card's own Log is not copied to the survivor, so the old IDs that card had stop resolving when it is merged away.
- **Shorthand.** `BUG-0012`, `bug-12`, `bug 12` and `enhancement 7` all name a card: the type's name or letters in any case, then the number, padded or not. Letters that are no type on the board are still read (`KB-0034` finds the card that was `KB-0034`). A bare `12` names a card only when exactly one card has that number (its current ID first; when no card has it now, a retired ID); otherwise the candidates are listed (`ambiguous-number`) and nothing changes. Text that fits none of these is not an ID.
- A duplicate or junk card is deleted outright. Abandoned real work goes to the lane with role `scrapped`.

## 8. Slug

Computed from the title, fixed at creation (a title change never renames the file; a retype changes the ID in the file name and keeps the slug):
1. Lowercase; strip diacritics (decompose, drop combining marks).
2. Every run of characters outside `[a-z0-9]` becomes one `-`; trim leading and trailing `-`.
3. If longer than 40, keep 40 characters; unless the 41st is `-`, drop the cut word back to the last `-` (a lone word over 40 is hard-cut); trim trailing `-`.
4. Empty becomes `card`.

`Fix the morning summary date` becomes `fix-the-morning-summary-date`; `Café: état 3!` becomes `cafe-etat-3`.

## 9. Order within a lane

`order` is an integer; a lane is sorted by `order`, ties by ID (letters, then number).
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

- Edit only the named lines: a card's `status`, `order`, `updated`; the `# ` title line (a rename, with `updated` and one Log line; the file name never changes); a card's `model` and `thinking` (set, removed on Auto, or removed when Claude moves the card to the lane with role `done`, with `updated`); one appended Log line; the settings lines in `board.md`; a type's `next_<letters>` counter line; one appended DECISIONS line. A merge (section 7) edits the surviving card B only, and deletes the other card A's file (with `git rm` when it is tracked): at the end of B's body, just before `## Plan` (else before `## Log`, else at the end of the file), a section `## Merged from <A's ID>: <A's title>` holding A's body text, its open questions and its plan steps as plain text (A's `# Title` and `## Log` are left out, and every `## ` heading of A becomes `### `, so the section stays one and is not a second `## Plan`); B's `labels` become the union (B's own first, then A's that B lacks); `updated` is set; one Log line `merged <A's ID> "<A's title>" into <B's ID>` is appended. Nothing else in B changes, and no counter line does. A retype (section 7) edits, besides its counter line: the card's file name, its `id` and `updated` lines, one appended Log line, and the `parent` line alone of each child card. The skill also edits `flag`, `branch`, `pr`, `parent` (with `updated` and the Log line above), `labels`, the body and `## Plan`, only when asked to.
- Replace the line in place. If the key is absent, add the line just before the closing `---`. To remove a key (a settings Reset, or a `default_` line), take its whole line, and for a block list its item lines, and nothing else.
- Keep every other byte: unknown keys, key order, body, BOM, the file's EOL. A write that would change nothing is skipped.
- The pane's permitted writes are exactly: a card's `status:`, `order:` and `updated:` lines; the `order:` lines alone of the cards of one lane when it places a card (its own and, when no whole number fits, the lane's renumbering); a card's `model:` and `thinking:` lines (added when set, removed on Auto); a card's `parent:` line with `updated` and one Log line `parent set to <ID>` or `parent removed (was <ID>)` (the Parent list in the open card); the `# ` title line with `updated` and one Log line `renamed from "old title"` (a rename in the open card; the file name stays, section 8); one Log line (a move or a comment); the settings lines in `board.md` (set, or removed whole by Reset and Restore all defaults), the `default_` lines (written or removed whole by Save as defaults, all removed by Restore original defaults) and a type's `next_<letters>` counter line (added when absent); and creating one new card file per add, built by the rules of sections 3, 4, 7, 8 and 9 with an empty body. It never deletes or renames files, so it cannot retype or merge a card; it asks Claude.

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
| `unknown-type` | A card's ID letters are no type on the board, or a retype names a type the board does not have. The card is read and still shows, and the board is not read-only. Fix: retype the cards to a type on the board; declaring the letters as a type in `board.md` (the `types:` list, plus a `next_<letters>` line) is the other way, for a board that wants to keep the old IDs. `list` prints the line `To fix unknown-type: retype each card to a type on this board (<the board's type names> here), e.g. "retype <an offending ID> as <a type name>".` after `Fix needed:`, with the type names in board order, the last after "or", an offending card's ID, and the board's last type name. |
| `ambiguous-number` | A bare number names more than one card (section 7). Nothing changes; the candidates are listed. |
| `being-worked` | A retype or merge of a card that is in an `auto` lane or has an agent on it. Nothing changes. |
| `id-name-mismatch` | The filename does not start with `<id>-`. |
| `duplicate-id` | Two card files have the same `id`. Both are read but flagged. |
| `unknown-lane` | A card's `status`, or a move target, is not a label in `board.md`. The card is read but flagged. |
| `claude-only` | Anyone but Claude moves a card into a `needs-you` (or older `gated`) lane. |
| `same-lane` | A move targets the lane the card is already in. |
| `bad-lane` | A `lanes:` item does not fit `Label (role)`. |
| `bad-role` | A lane's role is not one of the ten. |
| `duplicate-lane` | Two lane labels are equal, ignoring case. |
| `no-intake` | `lanes:` is absent, empty, or has no `intake` lane. |
| `bad-setting` | A `board.md` setting or `default_` line is outside its allowed values, or `owner` is missing. |

## 13. Worked examples

Card `kanban/BUG-0012-fix-the-morning-summary-date.md`:

```
---
id: BUG-0012
status: Auto
order: 2000
created: 2026-10-08
updated: 2026-10-08
flag:
branch: bug-12-fix-the-morning-summary-date
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
- 2026-10-08 09:11 Claude: started: bug-12-fix-the-morning-summary-date
```

The same card after Claude retypes it to enhancement on 2026-10-09 at 14:05, which gave it `ENH-0007`: the file is now `kanban/ENH-0007-fix-the-morning-summary-date.md`, and `id`, `updated` and the last Log line are the only changes. The branch keeps its name:

```
---
id: ENH-0007
status: Auto
order: 2000
created: 2026-10-08
updated: 2026-10-09
flag:
branch: bug-12-fix-the-morning-summary-date
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
- 2026-10-08 09:11 Claude: started: bug-12-fix-the-morning-summary-date
- 2026-10-09 14:05 Claude: retyped from BUG-0012 to ENH-0007
```

The same card with its own model and thinking set from the pane; the two lines follow `labels`, and clearing both returns the file to the card above with a new `updated`:

```
labels: [claude]
model: opus
thinking: medium
---
```

The surviving card after `BUG-0012 "Fix date"` (labels `[docs]`, a requirement line, no plan) was merged into `BUG-0008` (labels `[claude]`) on 2026-10-09 at 14:05; the section sits before `## Plan`, `labels` is the union and `updated` and the last Log line are the only other changes:

```
labels: [claude, docs]
---
# Date bug

The date is wrong.

## Merged from BUG-0012: Fix date
Same date, other screen.

## Plan
1. ...

## Log
- 2026-10-08 09:10 John: created in Pending
- 2026-10-09 14:05 John: merged BUG-0012 "Fix date" into BUG-0008
```

Board `kanban/board.md`, as init writes it (`owner` and `lanes:` only: no settings lines, so every setting takes its default; the types are bug, enhancement and chore, and every counter starts at 1):

```
---
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

The same board after use, with a fourth type of its own and some changed settings (each settings line is one change; `planner_thinking: high` is also the default, so that line reads the same as none; removing it changes nothing). The counters say bug 13, enhancement 8 and chore 2 are next; `docs` has no counter line yet, so its first card is `DOCS-0001`:

```
---
owner: John
workers: 1
manager_model: opus
planner_model: opus
worker_model: sonnet
planner_thinking: high
types:
  - bug (BUG)
  - enhancement (ENH)
  - chore (CHORE)
  - docs (DOCS)
next_bug: 13
next_enh: 8
next_chore: 2
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
