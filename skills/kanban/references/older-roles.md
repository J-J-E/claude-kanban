# Roles older boards may list

The one home of this text (lanes.md, format.md and SKILL.md only point here; the lane pattern stays in format.md section 6).

A board made earlier can still list these roles, and it loads and works. `, side` after a role (`Parked (parked, side)`) is accepted and ignored. The default board has none of them.

- `manual` (owner moves in): plan if none (a planning agent, no `PLAN READY`, the card stays), then one step at a time, only when the person names a step or says "next" (the lowest step with no `step n done` Log line). Say in one line what it changes, a worker does it, the manager Logs `step n done: <what>`. Never commit unless told. A drag to Auto finishes the remaining steps under the Auto flow. "What's next" lists its cards with no `## Plan` under Queued for Claude.
- `parked` (either): stop at a safe point, commit work in progress as `<ID> WIP: ...` (`git add` changed files outside `kanban/`), Log `parked at step <n>: <what is left>`, keep `flag`, commit `kanban/` as `<ID> board: parked` only when git tracks it (`git ls-files kanban` is non-empty; if not, skip silently). Moving a running card there stops it as Pausing does, but with that WIP commit.
- `gated` (Claude only): treated exactly like `needs-you` everywhere, including the gate approval and the Claude-only refusal. "What's next" lists it under Waiting on you; a drag out to Auto of a card flagged `GATE` is the gate approval.
