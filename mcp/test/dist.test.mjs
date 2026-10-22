// The committed bundle (dist/server.js, what the plug-in runs) must be the source built with build.mjs's settings, and carry no machine path;
// the server and package versions must be the plug-in's. Build it with `npm run build` after any change under src/ or ../hooks/lib.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const MCP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(MCP, '..')
const BACK = String.fromCharCode(92)
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))

test('the server, the package and the lock report the plug-in version', () => {
  const plugin = json(resolve(REPO, '.claude-plugin', 'plugin.json')).version
  assert.match(plugin, /^\d+\.\d+\.\d+$/)
  assert.equal(json(resolve(MCP, 'package.json')).version, plugin)
  const lock = json(resolve(MCP, 'package-lock.json'))
  assert.equal(lock.version, plugin)
  assert.equal(lock.packages[''].version, plugin)
  assert.match(readFileSync(resolve(MCP, 'src', 'server.ts'), 'utf8'), new RegExp(`name: 'kanban', version: '${plugin.split('.').join(BACK + '.')}'`))
})

test('dist/server.js is exactly what build.mjs makes from the source, and holds no machine path', async () => {
  // The same settings as build.mjs, with the result in memory (nothing written into the repo).
  const built = await build({
    absWorkingDir: MCP,
    entryPoints: ['src/server.ts'],
    outfile: resolve(tmpdir(), 'kanban-dist-check', 'server.js'),
    write: false,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    tsconfigRaw: '{}',
    logLevel: 'silent',
  })
  const fresh = Buffer.from(built.outputFiles[0].contents)
  const committed = readFileSync(resolve(MCP, 'dist', 'server.js'))
  assert.ok(fresh.equals(committed), 'mcp/dist/server.js is out of date: run `npm --prefix mcp run build` and commit it')
  const text = committed.toString('utf8')
  for (const p of [REPO, MCP, tmpdir()]) {
    for (const form of [p, p.split(BACK).join('/'), p.split(BACK).join(BACK + BACK)]) assert.ok(!text.includes(form), `the bundle holds the path ${form}`)
  }
})
