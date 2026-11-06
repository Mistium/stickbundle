import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// The commit this bundle was built from, kept in dist/version.json so the
// client can tell when the host is serving a new build.
const git = args => { try { return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return '' } }
const commit = process.env.STICKBUNDLE_COMMIT || process.env.EMBER_COMMIT || git('rev-parse HEAD') || 'dev'
const dirty = !process.env.STICKBUNDLE_COMMIT && !process.env.EMBER_COMMIT && !!git('status --porcelain --untracked-files=no')
const builtAt = new Date().toISOString()

const versionFile = () => ({
  name: 'stickbundle-version-file',
  apply: 'build',
  writeBundle(opts) {
    mkdirSync(opts.dir, { recursive: true })
    writeFileSync(join(opts.dir, 'version.json'), JSON.stringify({ commit, dirty, builtAt }) + '\n')
  },
})

export default defineConfig({
  plugins: [react(), versionFile()],
  base: '/',
  define: {
    __ORIGINCHATS__: 'true',
    __ROTUR_APP_ID__: JSON.stringify(process.env.ROTUR_APP_ID || ''),
    __EMBER_COMMIT__: JSON.stringify(commit),
    __EMBER_REPO__: JSON.stringify(process.env.STICKBUNDLE_REPO || 'Mistium/stickbundle'),
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
