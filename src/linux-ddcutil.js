#!/usr/bin/env node

const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

function printHelp() {
  console.log(`Twinkle Tray Linux helper (ddcutil)

Usage:
  npm run linux:brightness -- --list
  npm run linux:brightness -- --display 1 --get
  npm run linux:brightness -- --display 1 --set 70
  npm run linux:brightness -- --display 1 --offset -10

Options:
  --list                List detected displays via ddcutil.
  --display <number>    ddcutil display number.
  --get                 Read current brightness (VCP 0x10).
  --set <0-100>         Set brightness directly.
  --offset <n>          Add/subtract brightness relative to current value.
  --help                Show this message.
`)
}

function readArg(name) {
  const idx = process.argv.indexOf(name)
  if (idx < 0) return undefined
  return process.argv[idx + 1]
}

function hasArg(name) {
  return process.argv.includes(name)
}

function toInt(value, fallback = NaN) {
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

async function runDdcutil(args) {
  try {
    const { stdout, stderr } = await execFileAsync('ddcutil', args)
    return (stdout || stderr || '').trim()
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('找不到 ddcutil。请先在 Ubuntu 24.04 安装：sudo apt install ddcutil')
    }
    throw new Error((error.stderr || error.stdout || error.message || '').trim())
  }
}

function parseCurrentBrightness(output) {
  const match = output.match(/current value\s*=\s*(\d+)/i)
  return match ? toInt(match[1]) : NaN
}

async function getBrightness(display) {
  const output = await runDdcutil(['getvcp', '10', '--display', String(display), '--brief'])
  const current = parseCurrentBrightness(output)
  if (Number.isNaN(current)) {
    throw new Error(`无法解析当前亮度：${output}`)
  }
  return current
}

async function main() {
  if (hasArg('--help') || process.argv.length <= 2) {
    printHelp()
    return
  }

  if (hasArg('--list')) {
    const output = await runDdcutil(['detect', '--brief'])
    console.log(output)
    return
  }

  const display = toInt(readArg('--display'))
  if (Number.isNaN(display) || display <= 0) {
    throw new Error('请通过 --display <number> 指定显示器编号，例如 --display 1')
  }

  if (hasArg('--get')) {
    const current = await getBrightness(display)
    console.log(`Display ${display} brightness: ${current}`)
    return
  }

  const setValue = readArg('--set')
  if (setValue !== undefined) {
    const target = clamp(toInt(setValue), 0, 100)
    if (Number.isNaN(target)) {
      throw new Error('--set 的值必须是整数')
    }
    await runDdcutil(['setvcp', '10', String(target), '--display', String(display)])
    console.log(`Display ${display} brightness set to ${target}`)
    return
  }

  const offsetValue = readArg('--offset')
  if (offsetValue !== undefined) {
    const offset = toInt(offsetValue)
    if (Number.isNaN(offset)) {
      throw new Error('--offset 的值必须是整数')
    }
    const current = await getBrightness(display)
    const target = clamp(current + offset, 0, 100)
    await runDdcutil(['setvcp', '10', String(target), '--display', String(display)])
    console.log(`Display ${display} brightness: ${current} -> ${target}`)
    return
  }

  throw new Error('无效参数。使用 --help 查看用法。')
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
