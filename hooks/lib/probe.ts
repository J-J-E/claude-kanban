// Where the /board-probe diagnostic (see hooks/register.tsx) writes its log. Never inside the repo, and no machine path in the source:
// the log is KANBAN_PROBE_LOG when that is set, else <the OS temp folder>/kanban-board-probe/probe-results.log. The pane code has no
// environment or OS access of its own, so it runs this small script with node (which prints the resolved path and makes its folder).
export const PROBE_LOG_SCRIPT = [
  "const p=require('path'),o=require('os'),f=require('fs');",
  "const e=process.env.KANBAN_PROBE_LOG;",
  "const l=e&&e.trim()!==''?p.resolve(e):p.join(o.tmpdir(),'kanban-board-probe','probe-results.log');",
  "f.mkdirSync(p.dirname(l),{recursive:true});",
  "process.stdout.write(l);",
].join('')
