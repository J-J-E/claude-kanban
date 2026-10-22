# Lanes: Auto cards

The Auto flow and what hangs on it: gate approval, gates, resuming, running/waiting/nobody and flag values. Moved word for word from lanes.md; read it for a card in an `auto` lane. The lane table, shared rules, Plan action, Needs You and Done/Pausing/Discarded are in lanes.md.

## Auto flow

Runs on a person's move into an `auto` lane, or a card created there from the pane or from a request in chat (the card file and its `created in` Log line are already written; step 0 is the first Claude Log line). If the card came from a `needs-you` lane and its `flag` starts with `GATE`, do the Gate approval first (below), which says where to continue; otherwise start at step 0.

0. Start. Re-read the card. If its `flag` is `READY TO MERGE`, run Ready to merge (below) instead of steps 1 to 7. Otherwise clear a `flag` of `PLAN READY`, `QUESTION: ...` or `FAILED`: the drag answered it (a question's answer is the person's newest comment). Make this the flow's first Log line: `started: <branch>`, the branch name step 3 uses, or `started: in place` when the project is not a git repo. "What's next" reads `Claude: started` to tell a started card from a queued one.

Stop check: before each dispatch, each commit and the merge, re-read the card. If its `status:` is no longer an `auto` lane (the person moved it out), stop at once: let running workers report, commit nothing more, and see Pausing (an `intake` or `backlog` lane) or Discarded (a `scrapped` lane) below.

1. Plan. If the card has no `## Plan`, have one written as the Plan action does (steps 1 to 3: a planning agent, reviewed by the manager), but do not stop and do not set `PLAN READY`.
2. Children. If cards have `parent:` set to this ID, the card is a parent: Claude-move each child that is not Done to Auto and run this flow for it. All children share one working tree, which holds one branch at a time: in a git repo run them one at a time, in the order the manager schedules; otherwise run up to `workers` at once, and only when their plans name no file in common. Total agents stay within `workers`, planning agents included. If a child stops in Needs You, carry on with the others, then Log `waiting on <child IDs>` on the parent and stop; the parent stays in Auto. When every child is Done, Claude-move the parent to Done (step 8). Skip steps 3 to 7 for a parent.
3. Branch. In a git repo the branch is `<letters lowercase>-<n>-<slug>`: the card's type letters in lowercase, `n` the ID number without padding, `<slug>` the part of the card's filename after the ID (`bug-12-fix-the-morning-summary-date`). If `branch:` is set, always use it as it is, whatever the card's current ID (a retyped card keeps its branch; so does a card with an older `kb-...` branch): check that branch out. Otherwise find the default branch (`git symbolic-ref --short refs/remotes/origin/HEAD` without `origin/`, else `main`, else `master`), create the branch from it (or check it out if it already exists) and write `branch:`. Not a git repo: Log `no git repo, working in place` and continue; steps 4 to 7 then skip their git parts, and the gate check uses the files the workers report.
4. Workers. Dispatch the plan's steps in order, Logging `step N: dispatched` on the card as each starts, as SKILL.md "Manager and agents" describes (in a git repo only this card's step workers run, while planning agents for other cards use the other slots): `description` `BUG-0012 step 2: <what>`, `model: <worker_model>`, `effort: <worker_thinking>` (left out when it is `none`; the card's own `model` and `thinking` replace them when set), at most `workers` at once. One worker may be given several consecutive steps of the plan, in order, when they are small or build on each other, and reports each. Steps go to separate workers only when they can run at the same time on files that do not overlap and neither needs the other's result, or when one is large. A follow-up to a worker's own work (a review change, the next step in the same files) goes to the same worker, which already holds the context; a fresh worker is briefed with the files and facts it needs so it does not rediscover them. Each worker edits and runs the checks its step names, in the foreground with Bash timeout 600000, and reports. The manager reviews each diff, fixes it or re-dispatches, then commits the accepted step on the branch (`git add` that step's files, never `kanban/`; message `BUG-0012 step 2: <what>`, always the card's current ID) and Logs `step 2 done: <what>`. Skip steps already done: a branch commit starting with the card's current ID or one of its old IDs (the `retyped from` Log lines, format.md section 7) and `step n`, or a `step n done` Log line (commit its leftover changes as `BUG-0012 manual steps: <what>`). Do not dispatch a step that deploys or is destructive; step 6 gates it.
5. Failures. Count failures per step. Failures 1 to 3: Log `retry n of 3: <what failed>` (n is the failure number) and re-dispatch with the failure text in the brief. Failure 4, after `retry 3 of 3`: set `flag: FAILED`, Log what failed last, Claude-move to Needs You, stop.
6a. Verify, then review. "Verified" means the checks the plan names (at least `claude plugin validate`, `claude plugin test` and the MCP tests for this plugin; for another project, that project's own checks) pass on the branch with the default branch merged in. If the default branch moved, merge it into the branch, rerun every check and Log `after merging main: <results>`. When the project has a private-text check (for this plugin `node tools/private-check.mjs --diff <default>...<branch>`; another project may name its own), a worker runs it on the branch's changes with the other checks; a hit is not a failed check but a gate (step 6). Workers run the checks, never the manager (Manager and agents). A check that fails is a failure (step 5), not a question. Then read the whole diff (`git diff <default>...<branch>`) against the plan and the card: every changed file is named by the plan or needed by it; no secret, debug leftover, unrelated edit or disabled test; docs, TESTING.md and the changelog agree with the code. Fix or re-dispatch what is wrong. Log `reviewed: <n> files, <checks> pass, nothing outside the plan`. The manager decides alone anything a test, a check or the diff can settle. It asks the owner (a `QUESTION`) only for a choice about what the board should do, for publishing outside this PC, or for what only he can change (his settings, his subscription).
6. Gate check, before any merge. List the files changed on the branch against the default branch (`git diff --name-only <default>...<branch>`). If any condition under Gates holds, set `flag: GATE: <reason>`, Log it, Claude-move to the first `needs-you` lane (Needs You), stop. Name every cause in the reason, joined with `; `: `GATE: merge touches package.json, .env`, `GATE: deploy`, `GATE: private text`.
7. Merge, when not gated. Read `merge_by` in `board.md` first (`claude` or `owner`; an absent line is `claude`). Whoever merges, the work reaches the merge only after the checks and the gate check above.
   - GitHub remote (`git remote get-url origin` succeeds and `gh auth status` succeeds): `git push -u origin <branch>`, then `gh pr create` with a title starting with the card's current ID (`BUG-0012 <card title>`), write `pr:` with the PR URL. Then:
     - `merge_by: owner`: do not merge. Hand the PR to the owner (Ready to merge, below).
     - `merge_by: claude`: `gh pr merge <url> --squash --delete-branch`. If the merge is refused for any reason (the app's safety check in auto mode, required checks or review, a missing permission), do not retry and do not ask: hand the PR to the owner (Ready to merge, below) with the refusal's reason.
   - A remote exists but `gh` is missing or not signed in: run `git push -u origin <branch>` (if the push fails too, skip it and say so), then hand the branch to the owner (Ready to merge, below) with that reason; there is no pull request, so its command is the local merge.
   - No remote (not a GitHub project): `merge_by: claude`: `git switch <default>`, then `git merge --no-ff <branch>` with a message starting with the card ID. `merge_by: owner`: no merge; hand the branch to the owner (Ready to merge, below).
   - When Claude merged, Log `merged <branch>` and go on to step 8. When it handed over, stop: step 8 does not run. Without git there is nothing to merge: skip step 7.
7a. A check only a person can see in the real app (a look, colour, wrapping, a drag, typing in the live pane) never holds the merge or the card. Merge, then write or keep the step in TESTING.md marked NOT VERIFIED with why only the live app shows it (for a project with no TESTING.md, the card's Log alone). Log `not verified in the live app: <what> (TESTING <step>)` and name it in the reply. Do not set `QUESTION`, do not move the card to Needs You, do not ask the owner to look.
8. Finish. Claude-move the card to Done, clear `flag`, and remove the card's own `model:` and `thinking:` lines in the same edit. Commit the board, only when git tracks `kanban/` (`git ls-files kanban` is non-empty; if not, skip this commit silently): on the default branch, `git add kanban` and commit with the message `<ID> board: done`, so the card files the pane and the actions edited are not left uncommitted. Reply in one line, e.g. `BUG-0012 done: merged bug-12-fix-the-morning-summary-date.` With a live check left: `BUG-0012 done: merged bug-12-fix-the-date. Not verified live: <what> (TESTING 17a).` If the card has a `parent:` and every card with that parent is now Done, Claude-move the parent to Done and clear its `flag` too.

## Ready to merge

Where a checked change waits for the owner to merge it. Auto step 7 ends here when `merge_by` is `owner`, or when Claude's merge was refused or could not run. The pane has no merge button and runs no merge; the owner merges in his own terminal or on GitHub.

Hand-over (from step 7): set `flag: READY TO MERGE`, Log one line ``ready to merge: <PR url, or branch <branch>>; run in PowerShell: `<the one merge command>` (<what it does>)``, with the reason appended when Claude could not merge (`; not merged by Claude: <the refusal, or gh missing or not signed in>`). The command is `gh pr merge <url> --squash --delete-branch` with a PR, else `git switch <default>; git merge --no-ff <branch>` (format.md section 5 says how a command is written; the pane gives the line a `Copy command` button). Claude-move to the first `needs-you` lane and stop, with no step 8. The reply is one line plus the command in a code block. The flag is green in the pane (it is not a question); it holds no question, so nothing is asked in chat beyond the reply.

Back from the owner: runs on a person's move of a `READY TO MERGE` card from Needs You to Auto (also his chat reply that he merged it, SKILL.md, Requests in chat). Log `started: <the card's branch>` (the flow's first line, as in Auto step 0), clear `flag`, then check, never merge as a side effect of looking: with a PR, `gh pr view <pr> --json state` says `MERGED` or not; with no PR or no `gh`, `git branch --merged <default>` lists the branch or not.

- Merged: Log `merged <branch>` and go to Auto step 8.
- Not merged and `merge_by` is `claude`: his drag is the go-ahead, so try Auto step 7's merge once; a refusal hands over again.
- Not merged and `merge_by` is `owner`, or the check cannot be made: Log `still ready to merge: <url or branch>` (with the reason when the check could not be made), set `flag: READY TO MERGE` again, Claude-move to Needs You and stop.

A person's drop of the card straight into Done is the Done action (lanes.md): it reports the PR as not merged if it is not.

## Gate approval

Runs on a person's move of a card whose `flag` starts with `GATE` from a `needs-you` lane into an `auto` lane, or when he presses "Approve and continue" in the card view. It approves the one action the flag names and nothing else. A move of that card to any other lane approves nothing. A move of a card with any other flag (`PLAN READY`, `QUESTION`, `FAILED`) into Auto is not a gate approval: it answers that flag and the full Auto flow runs. A person's drop into Needs You is refused by the pane, with a message and nothing written; in chat it is the Claude-only refusal.

1. Read `flag`: the held action is what `GATE:` names. Log `started: <the card's branch>`, or `started: in place` with no git repo (the flow's first line, as in Auto step 0), then `approved: <the flag text>`, and clear `flag`.
2. Do that action. A merge reason (a path): nothing to do yet. `deploy` or a destructive step: dispatch the held step as in Auto step 4.
3. Continue the Auto flow at step 6 with the approved reasons waived, then 7 and 8. Step 8 commits the board (`<ID> board: done`), so the approval needs no commit of its own. Anything else that turns out gated later is a new gate.

## Running, waiting, nobody

A started card in an `auto` lane (it has `Claude: started`) is in one of three states, which look alike on the board:

- **Running**: a live agent or turn is on the card. The pane counts agents that are running, pending or waiting; any running turn counts as someone on every card. An agent that is idle or completed (it finished a step and may be resumed by message) leaves the card between steps: shown as `Worker finished ...; next step not started` (completed) or `Worker idle since ...; waiting for a message` (idle), not as working, and neutral for 2 minutes from when it finished (or from the card's newest Log line, if later); after that the card reads as nobody on it. Failed and killed agents never count.
- **Waiting on a named thing**: the newest `Claude:` Log line starts `waiting on <thing>`: a card ID, John, a lead, hardware. A hold (a card held back on purpose) is `waiting on <ID>: queued behind it, one card's workers at a time`; a wait on a person is `waiting on John`, which never ends by itself. A wait ends only when every card ID it names is Done; a `waiting on` line whose card IDs are all Done is not a wait. Always write `waiting on`: a line starting `queued behind <ID>` is read the same, but prose such as "workers wait for <ID>" is not recognised. Whenever Claude waits on something named and nothing runs for it, it Logs `waiting on <thing>` (Auto step 2 does this for a parent's children).
- **Nobody has it**: Auto lane, `Claude: started`, no live agent, no turn, not waiting. The chat or the PC restarted mid-work. "What's next" lists these under Left hanging with the age of the last Log line; it reports age only and never claims nobody has it, because it cannot see agents. The pane decides "nobody".

A parent that only waits for its children is waiting while any child runs or waits. If every child is hanging, resuming the children covers the parent. If every child is Done the parent finishes (Auto step 2).

## Resuming

Runs, without asking, as soon as the note lists hanging cards (`Hanging in Auto:`) or the prompt `Kanban: John asked to resume <IDs>.` names them, or when John types "resume" (or "pick these back up"). For each listed card that is still started in an `auto` lane and not running or waiting:

1. Guard first. Before dispatching, see whether the card has a live or resumable worker (an agent whose description starts with the card ID, running, waiting, idle or completed); if so, message it with SendMessage instead of starting a second one. Never start a worker on a tree that holds another worker's uncommitted edits. In a git repo run one card's workers at a time: for every other card of a multi-card resume that is held back, Log `waiting on <ID of the card running>: queued behind it, one card's workers at a time` at once, so it does not read as nobody on it while the first runs.
2. Re-read the card and run `git status` on its `branch:`. Leftover uncommitted files are kept, never discarded; list them in the brief of the re-dispatched step.
3. Re-enter Auto flow step 4. It skips finished steps (`step n done` or a branch commit for them) and dispatches the next one. Log `resumed at step <n>`. A parent whose children are all hanging: resume the children; all Done: finish the parent (Auto step 2).
4. In every brief give the branch head (`git rev-parse HEAD`) and the newest Log time at dispatch. A worker that reports after waking late is dropped when a `step N done` line for that step or a newer commit now exists; Log `dropped late report from step <n>` and do not apply it.

Resuming starts only the cards named; it creates no card and moves none. Cards in Needs You, `waiting on` cards and cards another chat is running are left alone.

## Gates

Auto step 6 holds the action, sets `flag: GATE: <reason>`, Claude-moves the card to the first `needs-you` lane and waits for the owner to drag it out to Auto. There it sits beside plans to approve, questions and failures, told apart by its flag. The action is gated when any of these holds:

- A changed path contains (ignoring case) `auth`, `login`, `session`, `token`, `secret`, `credential`, `password` or `deploy`; is a `.env*` file; is under `.github/workflows/`; or is a `Dockerfile`.
- A changed path is a dependency manifest or lockfile: `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `requirements*.txt`, `pyproject.toml`, `poetry.lock`, `Pipfile*`, `Cargo.toml`, `Cargo.lock`, `go.mod`, `go.sum`, `*.csproj`, `Gemfile*`, `composer.*`.
- The plan includes a deploy or anything destructive: deleting data, dropping tables, force-pushing, removing files outside the repo.
- The private-text check found a hit on the branch's changes (the project has one; Auto step 6a). Set `flag: GATE: private text` and Log `held the merge: private-check found <n> hits on <branch>: <hit lines>. Drag to Auto to merge anyway (you have looked), or tell me to fix it.` The hit lines are the check's own lines, already cut short, so the Log never holds a whole secret or path; join them with `; `. A hit that is plainly a leftover (a local path in a test string, a stray token in a debug line) is first fixed like any review finding (step 6a) and the check rerun; the card is held only for a hit that cannot be made neutral without the owner's say (a name or address that has to stay, a file that must stay tracked).

The number of files changed holds nothing. The manager reads the diff instead (Auto step 6a).

A drag out of Needs You approves the actions the flag names and nothing else.

## Flag values

`flag:` is free text shown as a badge (format.md section 3). Claude uses these:

| Flag | Lane | Meaning |
|---|---|---|
| `PLAN READY` | Needs You | The plan is in the card and waits for approval. |
| `QUESTION: <question>` | Needs You | Claude needs an answer before it can go on. A command the owner must run is in the `question:` Log line, not the flag (format.md section 5). |
| `FAILED` | Needs You | A step failed its fourth attempt (Auto step 5). |
| `READY TO MERGE` | Needs You | The change is checked and waits for the owner to merge it (Ready to merge, above): the PR link and the one merge command are in the newest `ready to merge:` Log line. The pane draws it green, not yellow like a question. |
| `GATE: <reason>` | Needs You | The named action is held: a sign-in, secrets or deploy path; a dependency file; a plan step that deploys or destroys something; or a hit from the project's private-text check. E.g. `GATE: deploy`, `GATE: merge touches package.json`, `GATE: private text`. |

A person's drop of a flagged card into Done or Discarded clears its flag, whatever it held (Done, Pausing and Discarded, above).

