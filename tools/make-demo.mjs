// Makes a demo project for the kanban plugin: a tiny Python project, a git repo with one commit, and a ready board
// with three sample cards in Pending. Usage: node tools/make-demo.mjs <folder> [--owner <name>]
// Plain Node, standard library only. The file texts are built in demo-files.mjs; tests/demo.test.ts checks them with
// the plugin's own parser.
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { argv, exit } from 'node:process'
import { fileURLToPath } from 'node:url'
import { demoFiles, ownerProblem } from './demo-files.mjs'

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' })
}

const NEXT_STEPS = `
Next steps:
  1. Open a new Claude session in that folder (desktop app, Code tab).
  2. Type /board.
  3. Drag ENH-0001 to Plan and read the plan.
  4. Drag ENH-0001 to Auto.
Auto will create a branch, edit the files, commit and merge on its own.`

function main(args) {
  let folder
  let owner = 'You'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--owner') owner = args[++i] ?? ''
    else if (folder === undefined) folder = args[i]
    else folder = null
  }
  if (!folder) {
    console.error('Usage: node tools/make-demo.mjs <folder> [--owner <name>]')
    return 1
  }
  const problem = ownerProblem(owner)
  if (problem !== undefined) {
    console.error(problem)
    return 1
  }
  const root = resolve(folder)
  if (existsSync(root) && (!statSync(root).isDirectory() || readdirSync(root).length > 0)) {
    console.error(`${root} already exists and is not empty. Pick a new folder name; nothing was changed.`)
    return 1
  }
  const files = demoFiles({ owner })
  for (const [rel, text] of Object.entries(files)) {
    const target = join(root, ...rel.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  console.log(`Demo project written to ${root}`)

  const init = git(['init', '-b', 'main'], root)
  if (init.error) {
    console.log('git was not found, so no repository was made. The files are in place and the board still works without git.')
    console.log(NEXT_STEPS)
    return 0
  }
  if (init.status !== 0) {
    console.error(`git init failed: ${(init.stderr || '').trim()}`)
    return 1
  }
  const add = git(['add', '-A'], root)
  const commit = add.status === 0 ? git(['commit', '-m', 'Demo project'], root) : add
  if (commit.status !== 0) {
    console.error('The demo files are in place, but the first commit failed. If git has no identity yet, run:')
    console.error('  git config user.name "Your Name"')
    console.error('  git config user.email "you@example.com"')
    console.error(`then, in ${root}, run: git add -A && git commit -m "Demo project"`)
    console.error((commit.stderr || '').trim())
    return 1
  }
  console.log('Made a git repository on branch main with one commit.')
  console.log(NEXT_STEPS)
  return 0
}

if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) exit(main(argv.slice(2)))
