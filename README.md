# kanban

A kanban board for Claude Code with no Jira and no server. Each card is a markdown file in your project's own `kanban/` folder, and a skill teaches Claude to run the board. A pane in the Claude Code desktop app lets you drag cards between lanes and starts a Claude turn on each drop.

## Start here

- [`WALKTHROUGH.md`](WALKTHROUGH.md) shows how to use it from a new folder to a merged card, with a real example.
- [`TESTING.md`](TESTING.md) is a manual checklist to run by hand.
- [`docs/obsidian.md`](docs/obsidian.md) says what Obsidian needs to show the board.

## Install

Two commands, in a terminal (the same two work inside a session as `/plugin marketplace add ...` and `/plugin install ...`). The first adds this repo as a marketplace named `kanban-board`; the second installs the plugin `kanban` from it:

```
claude plugin marketplace add J-J-E/claude-kanban
claude plugin install kanban@kanban-board
```

Or add it from a local clone; the source can be a folder path (here the plugin's own folder, `<path-to-your-clone>`):

```
claude plugin marketplace add <path-to-your-clone>
claude plugin install kanban@kanban-board
```

- Checked on Claude Code 2.1.296 (Windows 11), the only version it has been checked on.
- The MCP server needs `node` on PATH. The plugin declares it and starts it for you.
- To remove it: `claude plugin uninstall kanban@kanban-board`, then `claude plugin marketplace remove kanban-board`. Both only undo the install; no project files are touched, and your user settings are left as they were. The folder `C:\Users\<you>\.claude\plugins\cache\kanban-board` stays on disk (nothing loads it); delete it by hand if you want it gone.
- The dev loop (below) and an installed copy are the same plugin twice. Both can be installed together: `claude plugin list` then shows `kanban@kanban-board` and `kanban@inline`, and sessions run the dev copy while the `env` entry exists, so the installed copy is shadowed. To use the installed copy, remove the `env` entry from `C:\Users\<you>\.claude\settings.json` and restart the app.
- Overriding the `env` entry from a project's `.claude\settings.local.json` did not switch the dev copy off. To run one terminal command against the installed copy alone, clear the variable in that shell and pass `--settings` (PowerShell 5.1): `$env:CLAUDE_CODE_PLUGIN_DIRS=''` then `claude --settings '{\"env\":{\"CLAUDE_CODE_PLUGIN_DIRS\":\"\"}}' plugin list`. That showed only `kanban@kanban-board`, and `mcp list` showed the MCP server running from the installed copy.
- Not yet shown: the board pane, and a board setup, running from an installed copy. The pane has only been seen from the dev copy.

## What you get

- **The skill, with lane actions (now).** Say "set up the kanban board", "add a card: ...", "move KB-12 to Auto", "list the board", "what's next", "comment on KB-12: ..." or "decide: ...". Claude edits the card files and replies in a line or two. Moving a card onto a lane makes Claude act: Plan has a planning agent write a plan, Auto runs the card with workers and merges it unless a gate stops it. The lanes are Needs You, Pending, Plan, Auto, Backlog, Done and Discarded. The steps are in `skills/kanban/references/lanes.md`.
- **The pane.** Type `/board` in a session to open it. A header says what Claude is on and how many cards `need you`; a toolbar has `New card`, `Find a card`, `Sort`, and `Collapse all` / `Expand all`. Every lane is a flat row you can fold, and each card is one line with a bar of blocks for its plan. Press a card to open it: `Lane`, `Model`, `Thinking`, `Rename`, `Copy ID`, `◂ Prev` / `Next ▸`, `Show details` and `Delete card…`. The `Settings` tab has `Workers at once` and a `Model` and `Thinking` for the Manager, Planner, Worker and Advisor; they write to `kanban/board.md`, `Restore all defaults` undoes them, `Save as defaults` makes them this board's own defaults, and `Restore original defaults` removes those. A `Board` chip above the chat box opens the pane. Dragging a card onto Plan or Auto starts a Claude turn for that lane's action; a drop on Pending or Backlog starts nothing; a drop on Needs You is refused. To pause a running card, drag it out of Auto to Pending or Backlog.
- **Obsidian (optional).** Say "set up the Obsidian view" and Claude writes `kanban/Board.base`, which Obsidian 1.14 or later shows as a Kanban board; dragging a card there changes only its `status:`. See `docs/obsidian.md`, and `WALKTHROUGH.md` for linking a vault.

## File layout

```
.claude-plugin/   plugin.json and marketplace.json
skills/kanban/    SKILL.md, plus references/format.md (the file format) and references/lanes.md (lane rules)
mcp/              the MCP server: src/ (TypeScript), dist/server.js (the bundle that runs), test/
hooks/            register.tsx (the pane), board.tsx (the lanes and the drag region), hooks/ui/ (header, toolbar, open card, Settings), hooks/lib/ (the card parser and the layout)
types/            the pane's state contract
tests/            claude plugin test files
tools/            helper scripts (capture-pane.ps1 takes a screenshot of the real pane)
docs/             obsidian.md and docs/design/ (the spec, plans and screenshots)
kanban/           in your project, not this repo: board.md, DECISIONS.md and one card per KB-0001-<slug>.md
```

## Dev loop

Develop in this repo and load it into your own Claude Code sessions. Add an `env` key inside the existing top-level object of `C:\Users\<you>\.claude\settings.json` (replace the path with your clone's; in JSON a Windows path needs doubled backslashes):

```json
"env": {
  "CLAUDE_CODE_PLUGIN_DIRS": "C:\\path\\to\\claude-kanban",
  "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
}
```

Then start a new session, or quit and reopen the desktop app if the plugin does not show. It has loaded when `kanban:kanban` appears in the `/` menu. With the watch flag, edits reload at the end of the turn that made them. If they do not, type `/reload-plugins` after a build turn. A terminal `claude` may need `claude login` once (the desktop app signs in on its own).

This setting is machine-wide: the plugin loads in every session on that machine until you remove the entry.

## MCP server

The plugin also ships a stdio MCP server, so any agent can read and edit the board: tools `board_list`, `whats_next`, `card_get`, `lanes`, `card_add`, `card_move`, `card_comment`, `decision_add`; the skill files as resources (`kanban://skill`, `kanban://format`, `kanban://lanes`); and a prompt `kanban_rules`. It only edits the card files; it never starts any work. It finds `kanban/` from the folder it starts in (or `KANBAN_DIR`); with no board the tools say so and the server stays up.

- **Claude Code:** nothing to do. The plugin declares it in `.claude-plugin/plugin.json` (`mcpServers.kanban`: command `node`, args `${CLAUDE_PLUGIN_ROOT}/mcp/dist/server.js`). It shows in `claude mcp list` as `plugin:kanban:kanban`.
- **Gemini CLI** (`~/.gemini/settings.json`) and any other MCP client that takes the same block:

```json
{
  "mcpServers": {
    "kanban": {
      "command": "node",
      "args": ["C:/path/to/claude-kanban/mcp/dist/server.js"],
      "env": { "KANBAN_DIR": "C:/path/to/your/project/kanban" }
    }
  }
}
```

`args` is the absolute path to `mcp/dist/server.js` in your clone. `env` is optional. Rebuild the bundle after editing `mcp/src/`: `npm --prefix mcp run build`.

## Validate and test

In PowerShell, with absolute paths (both exit 0 on a pass). Run on Claude Code 2.1.296, where the tests pass with or without `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`; an older CLI (2.1.284) needed it set to run tests for a plugin with a hooks module, so setting it is harmless.

```powershell
$env:CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = '1'
claude plugin validate <path-to-your-clone>
claude plugin test <path-to-your-clone>
```

`claude plugin test` is not listed in `claude plugin --help` but runs. The summary shows all tests passing, 0 fail. The tests pass from any folder, including an installed copy's `...\kanban\<version>` path. The MCP server has its own tests: `npm --prefix <path-to-your-clone>\mcp test`.

## Licence

MIT, see `LICENSE`. The bundled MCP server includes third-party packages; their licences are in `THIRD-PARTY-NOTICES.md`.
