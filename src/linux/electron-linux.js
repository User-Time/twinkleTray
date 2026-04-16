const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification } = require('electron')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

let tray = null
let win = null
let monitors = []
let activeDisplay = null

const iconPath = path.join(__dirname, '../assets/logo-square.png')

function parseDisplays(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^Display\s+\d+/i.test(line))
    .map((line) => {
      const idMatch = line.match(/^Display\s+(\d+)/i)
      return {
        id: Number.parseInt(idMatch?.[1] || '0', 10),
        name: line,
      }
    })
    .filter((item) => Number.isInteger(item.id) && item.id > 0)
}

function parseCurrentBrightness(output) {
  const match = output.match(/current value\s*=\s*(\d+)/i)
  if (!match) return null
  return Number.parseInt(match[1], 10)
}

async function runDdcutil(args) {
  const { stdout, stderr } = await execFileAsync('ddcutil', args)
  return (stdout || stderr || '').trim()
}

async function detectMonitors() {
  const output = await runDdcutil(['detect', '--brief'])
  const list = parseDisplays(output)
  monitors = list
  if (!activeDisplay || !monitors.find((m) => m.id === activeDisplay)) {
    activeDisplay = monitors[0]?.id || null
  }
  return list
}

async function getBrightness(displayId) {
  const output = await runDdcutil(['getvcp', '10', '--display', String(displayId), '--brief'])
  return parseCurrentBrightness(output)
}

async function setBrightness(displayId, value) {
  const normalized = Math.max(0, Math.min(100, Number.parseInt(String(value), 10)))
  await runDdcutil(['setvcp', '10', String(normalized), '--display', String(displayId)])
  return normalized
}

function createWindow() {
  win = new BrowserWindow({
    width: 340,
    height: 260,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  win.on('blur', () => {
    if (win && win.isVisible()) win.hide()
  })

  const html = `<!doctype html>
<html>
<head>
<meta charset="UTF-8" />
<title>Twinkle Tray Linux</title>
<style>
body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 14px; background: #1f1f1f; color: #f3f3f3; }
h3 { margin: 0 0 10px; font-size: 15px; }
.card { background: #2a2a2a; padding: 12px; border-radius: 10px; }
select, input[type=range], button { width: 100%; margin-top: 8px; }
.small { margin-top: 8px; font-size: 12px; color: #b9b9b9; }
.error { margin-top: 8px; font-size: 12px; color: #ff9b9b; white-space: pre-wrap; }
</style>
</head>
<body>
  <h3>Twinkle Tray (Linux)</h3>
  <div class="card">
    <label>Monitor</label>
    <select id="display"></select>
    <label style="display:block;margin-top:10px;">Brightness: <span id="value">--</span>%</label>
    <input id="slider" type="range" min="0" max="100" value="50" />
    <button id="refresh">Refresh monitors</button>
    <div class="small" id="hint">Requires ddcutil + enabled DDC/CI.</div>
    <div class="error" id="error"></div>
  </div>
<script>
const { ipcRenderer } = require('electron')
const displayEl = document.getElementById('display')
const sliderEl = document.getElementById('slider')
const valueEl = document.getElementById('value')
const errorEl = document.getElementById('error')
const refreshEl = document.getElementById('refresh')

let changing = false

function setError(msg='') { errorEl.textContent = msg || '' }

async function loadMonitors() {
  setError('')
  try {
    const state = await ipcRenderer.invoke('linux:get-state')
    displayEl.innerHTML = ''
    if (!state.monitors.length) {
      setError('No compatible displays found via ddcutil detect --brief')
      valueEl.textContent = '--'
      return
    }
    state.monitors.forEach(mon => {
      const opt = document.createElement('option')
      opt.value = String(mon.id)
      opt.textContent = mon.name
      if (mon.id === state.activeDisplay) opt.selected = true
      displayEl.appendChild(opt)
    })
    await loadBrightness()
  } catch (e) {
    setError(e.message || String(e))
  }
}

async function loadBrightness() {
  setError('')
  try {
    const displayId = Number(displayEl.value)
    const brightness = await ipcRenderer.invoke('linux:get-brightness', displayId)
    if (brightness === null || brightness === undefined || Number.isNaN(brightness)) {
      setError('Unable to read brightness (VCP 0x10).')
      return
    }
    sliderEl.value = String(brightness)
    valueEl.textContent = String(brightness)
  } catch (e) {
    setError(e.message || String(e))
  }
}

let debounce
sliderEl.addEventListener('input', () => {
  valueEl.textContent = sliderEl.value
  clearTimeout(debounce)
  debounce = setTimeout(async () => {
    if (changing) return
    changing = true
    try {
      const displayId = Number(displayEl.value)
      const value = Number(sliderEl.value)
      await ipcRenderer.invoke('linux:set-brightness', displayId, value)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      changing = false
    }
  }, 120)
})

displayEl.addEventListener('change', async () => {
  const displayId = Number(displayEl.value)
  await ipcRenderer.invoke('linux:set-active-display', displayId)
  await loadBrightness()
})

refreshEl.addEventListener('click', loadMonitors)
loadMonitors()
</script>
</body>
</html>`

  win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`)
}

function toggleWindow() {
  if (!win) return
  if (win.isVisible()) {
    win.hide()
    return
  }

  const trayBounds = tray.getBounds()
  const windowBounds = win.getBounds()
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2)
  const y = Math.round(trayBounds.y - windowBounds.height - 6)

  win.setPosition(Math.max(0, x), Math.max(0, y), false)
  win.show()
  win.focus()
}

function setupTray() {
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 })
  tray = new Tray(icon)
  tray.setToolTip('Twinkle Tray (Linux)')
  tray.on('click', toggleWindow)

  const menu = Menu.buildFromTemplate([
    { label: 'Open Brightness Panel', click: toggleWindow },
    { type: 'separator' },
    {
      label: 'Refresh Displays',
      click: async () => {
        try {
          await detectMonitors()
          if (win && win.isVisible()) {
            win.webContents.send('linux:refresh')
          }
        } catch (error) {
          new Notification({ title: 'Twinkle Tray (Linux)', body: error.message || String(error) }).show()
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ])

  tray.setContextMenu(menu)
}

ipcMain.handle('linux:get-state', async () => {
  await detectMonitors()
  return { monitors, activeDisplay }
})

ipcMain.handle('linux:set-active-display', async (_, displayId) => {
  activeDisplay = displayId
  return true
})

ipcMain.handle('linux:get-brightness', async (_, displayId) => {
  if (!displayId) return null
  return getBrightness(displayId)
})

ipcMain.handle('linux:set-brightness', async (_, displayId, value) => {
  if (!displayId) throw new Error('Missing display id')
  return setBrightness(displayId, value)
})

app.whenReady().then(async () => {
  createWindow()
  setupTray()
  try {
    await detectMonitors()
  } catch (error) {
    new Notification({
      title: 'Twinkle Tray (Linux)',
      body: `ddcutil error: ${error.message || String(error)}`,
    }).show()
  }
})

app.on('window-all-closed', (event) => {
  event.preventDefault()
})
