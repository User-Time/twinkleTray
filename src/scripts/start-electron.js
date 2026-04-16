#!/usr/bin/env node

const { spawn } = require('child_process')
const path = require('path')

const electronBinary = path.join(__dirname, '../../node_modules/.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron')
const args = ['.', ...process.argv.slice(2)]

if (process.platform === 'linux') {
  args.push('--no-sandbox')
}

const child = spawn(electronBinary, args, { stdio: 'inherit' })

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

child.on('error', (error) => {
  console.error(error.message || error)
  process.exit(1)
})
