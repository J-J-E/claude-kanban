// Bundles src/server.ts and the shared library (../hooks/lib) into dist/server.js, so an install needs no npm install.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  tsconfigRaw: '{}',
  logLevel: 'info',
})
