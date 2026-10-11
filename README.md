# kanban

A kanban board for Claude Code. Each card is a markdown file in your project's own `kanban/` folder, and a skill teaches Claude to run the board. A pane in the Claude desktop app lets you drag cards between lanes. Dropping a card on a lane makes Claude act: plan it, build it, or stop.

![The board pane with a card's menu open](docs/design/real-pane-board-with-menu.png)

## Before you start

- **Claude Code:** checked on 2.1.296 on Windows 11, the only version and OS it has been checked on. macOS and Linux have not been tried. The commands in these docs are PowerShell; the equivalents are ordinary git commands.
- **The board pane** needs the Claude desktop app (Code tab). In the terminal CLI the skill still works by chat ("add a card", "move KB-1 to Plan", "list the board"); the pane is the desktop app's.
- **Node.js** (a current version) on PATH is needed only for the bundled MCP server, for other agents such as Gemini CLI. The board, the pane and the skill do not use it.
- **git:** the example below uses a git repo with one commit. Without git, Auto works in place: it makes no branch and no merge. With git it makes a branch and merges it. If the repo has a GitHub remote and `gh` is signed in, the merge is a pull request; otherwise it is a local merge.

## What Auto does on its own

Read this before you install. Dragging a card onto Auto (or saying "move KB-1 to Auto") is the go-ahead, and Claude then does all of this without asking again:

- plans the card first if it has no plan;
- creates a branch `kb-<n>-<slug>` and has worker agents edit your code, committing each step;
- **merges into your default branch**: a squash-merged pull request through `gh` when there is a GitHub remote and `gh` is signed in, else a local `--no-ff` merge, then commits the board;
- starts subagents on the models in Settings (defaults: planner opus, worker sonnet, advisor fable; manager opus), which uses your Claude usage;
- holds the merge and moves the card to Needs You when a gate trips: a changed path with words like `auth`, `token`, `secret` or `deploy`, a `.env*`, workflow or Dockerfile path, a dependency manifest or lockfile, more than 15 changed files, or a plan that deploys or deletes things (the full list is under Gates in `skills/kanban/references/lanes.md`);
- stops after four failures of one step and puts the card in Needs You.

To stop a running card, drag it out of Auto to Pending or Backlog. Plan is gentler: it only writes a plan into the card and waits for you. Try everything first in a scratch project (the demo below).

## Install

Two commands, in a terminal (inside a session they are `/plugin marketplace add ...` and `/plugin install ...`). The first adds this repo as a marketplace named `kanban-board`; the second installs the plugin `kanban` from it:

```
claude plugin marketplace add J-J-E/claude-kanban
claude plugin install kanban@kanban-board
```

Start a **new** session afterwards: sessions opened before the install do not have it. To confirm: `claude plugin list` shows `kanban@kanban-board`, `/board` opens the pane, and `kanban:kanban` appears among the skills.

What has been seen: installed from the marketplace, the plugin's MCP server and skill ran from the installed copy. The board pane itself has so far been used from a development checkout, so if `/board` does not open after an install, please open an issue at https://github.com/J-J-E/claude-kanban/issues.

To remove it: `claude plugin uninstall kanban@kanban-board`, then `claude plugin marketplace remove kanban-board`. Both only undo the install; no project files are touched and your user settings are left as they were. The folder `C:\Users\<you>\.claude\plugins\cache\kanban-board` stays on disk (nothing loads it); delete it by hand if you want it gone.

## First run

A scratch project, six steps:

1. Make the demo project: `node <path-to-your-clone>/tools/make-demo.mjs <folder>`. [`tools/make-demo.mjs`](tools/make-demo.mjs) creates a small git project with one commit, a ready board and three sample cards. (You need a clone of this repo for that script.) Or start from an empty git repo that has one commit and, in the session, say `set up the kanban board`.
2. Open a new Claude session in that folder (desktop app, Code tab).
3. Type `/board`.
4. Add a card: `New card` in the pane, or say `add a card: ...`.
5. Drag it to Plan and read the plan that comes back in Needs You.
6. Drag it to Auto and watch it run, or drag it back to Pending to stop.

[`WALKTHROUGH.md`](WALKTHROUGH.md) is the full tour, with the expected output at each step.

## What you get

- **The skill, with lane actions.** Say "set up the kanban board", "add a card: ...", "move KB-12 to Auto", "list the board", "what's next", "comment on KB-12: ..." or "decide: ...". Claude edits the card files and replies in a line or two. The lanes are Needs You, Pending, Plan, Auto, Backlog, Done and Discarded; the steps of each are in `skills/kanban/references/lanes.md`.
- **The pane.** `/board` opens it. A header says what Claude is on and how many cards `need you`; a toolbar has `New card`, `Find a card`, `Sort`, and `Collapse all` / `Expand all`. Every lane is a flat row you can fold, and each card is one line with a bar of blocks for its plan. Under `⋯` on a card: `Lane`, `Model`, `Thinking`, `Rename`, `Copy ID`, `◂ Prev` / `Next ▸`, `Show details` and `Delete card…`. A `Board` chip above the chat box also opens the pane.
- **Drops.** Plan or Auto starts a Claude turn for that lane's action. Pending and Backlog start nothing. Needs You refuses a drop: only Claude moves cards in, to ask a question, show a plan or hold a gated action.
- **Settings.** The `Settings` tab has `Workers at once` and a `Model` and `Thinking` for the Manager, Planner, Worker and Advisor. They write to `kanban/board.md`. `Restore all defaults` undoes your changes, `Save as defaults` makes the current values this board's own defaults, and `Restore original defaults` removes those.

  ![The Settings tab](docs/design/real-pane-settings.png)
- **Obsidian (optional).** Say "set up the Obsidian view" and Claude writes `kanban/Board.base`, which Obsidian 1.14 or later shows as a Kanban board; dragging a card there changes only its `status:`. See [`docs/obsidian.md`](docs/obsidian.md).

## MCP server (optional)

The plugin also ships a stdio MCP server so other agents can read and edit the board. Tools: `board_list`, `whats_next`, `card_get`, `lanes`, `card_add`, `card_move`, `card_comment`, `decision_add`; resources `kanban://skill`, `kanban://format`, `kanban://lanes`; a prompt `kanban_rules`. It only edits card files and never starts work. It finds `kanban/` from the folder it starts in (or `KANBAN_DIR`).

In Claude Code there is nothing to do: the plugin declares it, and it shows in `claude mcp list` as `plugin:kanban:kanban`. For Gemini CLI (`~/.gemini/settings.json`) or any MCP client that takes this block:

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

`args` is the absolute path to `mcp/dist/server.js` in your clone; `env` is optional.

## Contributing / developing the plugin

You do not need anything in this section to use the plugin.

**Dev loop.** Add an `env` key inside the existing top-level object of `C:\Users\<you>\.claude\settings.json` (use your clone's path; in JSON a Windows path needs doubled backslashes):

```json
"env": {
  "CLAUDE_CODE_PLUGIN_DIRS": "C:\\path\\to\\claude-kanban",
  "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
}
```

Start a new session, or quit and reopen the desktop app if the plugin does not show. It has loaded when `kanban:kanban` appears in the `/` menu. With the watch flag, edits reload at the end of the turn that made them; if they do not, type `/reload-plugins`. A terminal `claude` may need `claude login` once. This setting is machine-wide: the plugin loads in every session on the machine until you remove the entry.

**A dev copy and an installed copy together.** Both can be installed: `claude plugin list` then shows `kanban@kanban-board` and `kanban@inline`, and sessions run the dev copy while the `env` entry exists. To use the installed copy, remove the `env` entry and restart the app. Overriding the entry from a project's `.claude\settings.local.json` did not switch the dev copy off. To run one terminal command against the installed copy alone, clear the variable in that shell and pass `--settings` (PowerShell 5.1): `$env:CLAUDE_CODE_PLUGIN_DIRS=''` then `claude --settings '{\"env\":{\"CLAUDE_CODE_PLUGIN_DIRS\":\"\"}}' plugin list`. That showed only `kanban@kanban-board`, and `mcp list` showed the MCP server running from the installed copy.

**Validate and test** (PowerShell, absolute paths, exit 0 on a pass). Checked on Claude Code 2.1.296, where the tests pass with or without `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`; CLI 2.1.284 needed it set, so setting it is harmless:

```powershell
$env:CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = '1'
claude plugin validate <path-to-your-clone>
claude plugin test <path-to-your-clone>
```

`claude plugin test` is not listed in `claude plugin --help` but runs. The tests pass from any folder, including an installed copy's path. The MCP server has its own tests: `npm --prefix <path-to-your-clone>\mcp test`; rebuild its bundle after editing `mcp/src/` with `npm --prefix mcp run build`. [`TESTING.md`](TESTING.md) is a manual checklist.

**File layout.**

```
.claude-plugin/   plugin.json and marketplace.json
skills/kanban/    SKILL.md, plus references/format.md (the file format) and references/lanes.md (lane rules)
mcp/              the MCP server: src/ (TypeScript), dist/server.js (the bundle that runs), test/
hooks/            register.tsx (the pane), board.tsx (lanes and drag region), hooks/ui/, hooks/lib/
types/            the pane's state contract
tests/            claude plugin test files
tools/            helper scripts (make-demo.mjs, capture-pane.ps1)
docs/             obsidian.md and docs/design/ (the spec and screenshots)
kanban/           in your project, not this repo: board.md, DECISIONS.md and one card per KB-0001-<slug>.md
```

## Problems and questions

Open an issue: https://github.com/J-J-E/claude-kanban/issues

## Licence

MIT, see [`LICENSE`](LICENSE). The bundled MCP server includes third-party packages; their licences are in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
