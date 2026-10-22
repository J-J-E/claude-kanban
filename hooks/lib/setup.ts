// The first-run check (ENH-0065), once per board: does this machine have what Auto's merge needs? Pure: facts in, words out, no
// clock, no files, nothing throws. hooks/register.tsx gathers the facts with read-only commands (`git remote get-url origin`,
// `gh auth status`, and the small SETTINGS_SCRIPT below), calls setupLine, prints the one line and writes `setup_checked` to
// board.md. The check changes no setting of anyone's: it only says what is missing and the exact PowerShell command for each fix.

/** The board.md key that remembers the check ran, and its value: the date (YYYY-MM-DD). An unknown key to the board; nothing reads its value but this check. */
export const SETUP_KEY = 'setup_checked'

/** The merge setting's word for "the owner merges" (hooks/lib/settings.ts MERGE_OWNER; repeated so this file has no import). */
const OWNER = 'owner'

/** What the check found. `ghState` is `missing` when `gh` cannot run, `signed-out` when `gh auth status` fails, else `ok`. `mergeRule` is `unknown` when the settings could not be read. */
export type SetupFacts = {
  hasRemote: boolean
  ghState: 'missing' | 'signed-out' | 'ok'
  mergeRule: 'found' | 'missing' | 'unknown'
}

/** One thing missing: what it is, and the one PowerShell command (or the one step) that fixes it. */
export type SetupProblem = { what: string; fix: string }

/**
 * Prints (as JSON on stdout) only the `permissions.allow` rule strings of the user's `~/.claude/settings.json` and the project's
 * `.claude/settings.json` and `.claude/settings.local.json` (the project root is the one argument). It reads and prints nothing else
 * (no env block, no token) and writes nothing; a file that is missing or not JSON is skipped. Run with `node -e`.
 */
export const SETTINGS_SCRIPT = [
  "const p=require('path'),o=require('os'),f=require('fs');",
  "const r=process.argv[1]||'';",
  "const files=[p.join(o.homedir(),'.claude','settings.json')];",
  "if(r!==''){files.push(p.join(r,'.claude','settings.json'),p.join(r,'.claude','settings.local.json'))}",
  'const allow=[];',
  'for(const x of files){try{const j=JSON.parse(f.readFileSync(x,"utf8"));const a=j&&j.permissions&&j.permissions.allow;if(Array.isArray(a))for(const s of a)if(typeof s==="string")allow.push(s)}catch(e){}}',
  'process.stdout.write(JSON.stringify(allow));',
].join('')

/** Whether any allow rule lets `gh pr merge` run unasked: `Bash(gh pr merge *)`, `Bash(gh pr merge:*)`, `Bash(gh pr *)`, `Bash(gh *)`, `Bash(gh:*)`, `Bash(*)` or a bare `Bash`. */
export function hasMergeRule(allow: readonly unknown[]): boolean {
  for (const raw of allow) {
    if (typeof raw !== 'string') continue
    const rule = raw.trim()
    if (rule === 'Bash' || rule === 'Bash(*)' || rule === 'Bash(**)') return true
    const m = /^Bash\((.*)\)$/.exec(rule)
    if (m === null) continue
    const body = m[1].trim().replace(/:\*$/, ' *')
    if (/^gh pr merge( .*)?$/.test(body) || body === 'gh pr *' || body === 'gh *' || body === 'gh') return true
  }
  return false
}

/** The allow rules a settings script printed: its JSON array of strings, or null when the output is not that. */
export function parseAllowRules(stdout: string): string[] | null {
  try {
    const v: unknown = JSON.parse(String(stdout).trim())
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : null
  } catch {
    return null
  }
}

/** What is missing, in the order a person would fix it. `mergeBy` is the board's `merge_by`: with `owner` the permission rule is not needed, so it is not asked for. */
export function setupProblems(facts: SetupFacts, mergeBy: string): SetupProblem[] {
  const out: SetupProblem[] = []
  if (!facts.hasRemote) {
    out.push({
      what: 'no git remote named origin, so Auto merges on this PC only (no pull request)',
      fix: 'git remote add origin <the repo URL>',
    })
  }
  if (facts.ghState === 'missing') out.push({ what: 'the GitHub CLI (gh) is not installed', fix: 'winget install --id GitHub.cli' })
  else if (facts.ghState === 'signed-out') out.push({ what: 'gh is not signed in', fix: 'gh auth login' })
  if (facts.hasRemote && mergeBy !== OWNER && facts.mergeRule === 'missing') {
    out.push({
      what: 'your settings have no allow rule for Bash(gh pr merge *), so the app may refuse Claude\'s merge in auto mode: set Merge by to Owner in the Settings tab (recommended), or add that rule under permissions.allow yourself',
      fix: 'notepad $HOME\\.claude\\settings.json',
    })
  }
  return out
}

/** What in this plug-in is built for one machine and has to be looked at before others use it (each is a follow-up card, not fixed by this check). */
export const ASSUMPTIONS: readonly string[] = [
  "the advisor note in Settings (the app's own /advisor, which this board cannot see)",
  'the agents worktree folder paths in the skill text',
  'a single owner per board',
]

/**
 * The one line printed on a board's first run: what is missing with the fix for each, then the machine-specific assumptions. Nothing
 * missing: says so in a few words. It changes nothing; every command is for the person to run.
 */
export function setupLine(facts: SetupFacts, mergeBy: string): string {
  const problems = setupProblems(facts, mergeBy)
  const head =
    problems.length === 0
      ? 'Kanban setup check: git, gh and the merge permission look fine.'
      : 'Kanban setup check: ' + problems.map((p) => `${p.what}. Fix, in PowerShell: \`${p.fix}\``).join(' | ') + '.'
  return head + ' Machine-specific here (follow-up cards): ' + ASSUMPTIONS.join('; ') + '.'
}
