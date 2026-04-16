#!/usr/bin/env node

const { spawnSync } = require('child_process')

if (process.platform !== 'win32') {
  console.log('[postinstall] Skipping electron-builder install-app-deps on non-Windows platform.')
  process.exit(0)
}

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const result = spawnSync(command, ['electron-builder', 'install-app-deps'], {
  stdio: 'inherit',
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}

process.exit(result.status ?? 0)
