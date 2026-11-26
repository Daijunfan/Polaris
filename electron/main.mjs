import { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_NAME } from '../lib/brand.js'
import { startServer } from '../server/index.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const preloadPath = path.join(__dirname, 'preload.cjs')
const iconPath = path.resolve(__dirname, '../build/icon.png')

app.setName('Polaris')

let mainWindow = null
let serverHandle = null
let serverAddress = ''
let quittingCleanly = false
let downloadHookRegistered = false
const allowedDownloadPaths = new Set()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    } else if (serverAddress) {
      createMainWindow()
    }
  })
}

async function printHtmlToPdf(html) {
  await app.whenReady()
  const tmpFile = path.join(app.getPath('temp'), `polaris-pdf-${randomUUID()}.html`)
  let pdfWin = null
  try {
    await fsp.writeFile(tmpFile, String(html || ''), 'utf8')
    pdfWin = new BrowserWindow({
      width: 960,
      height: 1280,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    await pdfWin.loadFile(tmpFile)
    await pdfWin.webContents.executeJavaScript('document.fonts?.ready?.then(() => true) ?? true').catch(() => {})
    await new Promise(resolve => setTimeout(resolve, 60))
    const buffer = await pdfWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      preferCSSPageSize: true,
      margins: { marginType: 'none' },
    })
    return buffer
  } finally {
    if (pdfWin && !pdfWin.isDestroyed()) pdfWin.destroy()
    await fsp.rm(tmpFile, { force: true }).catch(() => {})
  }
}

globalThis.__polarisPrintHtmlToPdf = printHtmlToPdf

function setupMenu() {
  const isMac = process.platform === 'darwin'
  const openSettingsItem = {
    label: '模型与接口设置…',
    accelerator: 'CmdOrCtrl+,',
    click: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('polaris:open-settings')
      }
    },
  }
  const template = [
    ...(isMac
      ? [{
          label: 'Polaris',
          submenu: [
            { role: 'about', label: `关于 ${APP_NAME} Polaris` },
            { type: 'separator' },
            openSettingsItem,
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide', label: '隐藏 Polaris' },
            { role: 'hideOthers', label: '隐藏其他' },
            { role: 'unhide', label: '全部显示' },
            { type: 'separator' },
            { role: 'quit', label: '退出 Polaris' },
          ],
        }]
      : [{
          label: '文件',
          submenu: [
            openSettingsItem,
            { type: 'separator' },
            { role: 'quit', label: '退出' },
          ],
        }]),
    { role: 'editMenu', label: '编辑' },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'forceReload', label: '强制刷新' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    { role: 'windowMenu', label: '窗口' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function setupDownloads() {
  if (downloadHookRegistered) return
  downloadHookRegistered = true
  session.defaultSession.on('will-download', (_event, item) => {
    const filename = item.getFilename() || 'polaris-export'
    const defaultPath = path.join(app.getPath('downloads'), filename)
    item.setSaveDialogOptions({
      title: '保存导出文件',
      defaultPath,
    })
    item.once('done', (_doneEvent, state) => {
      if (state === 'completed') {
        const savedPath = item.getSavePath()
        if (savedPath) {
          allowedDownloadPaths.add(savedPath)
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('polaris:download-done', {
              filename: path.basename(savedPath),
              savedPath,
            })
          }
        }
      }
    })
  })
}

async function bootEmbeddedServer() {
  const preferredPort = Number(process.env.PORT || 3210)
  try {
    return await startServer({ port: preferredPort, registerSignals: false })
  } catch (error) {
    if (error?.code === 'EADDRINUSE' && preferredPort !== 0) {
      return startServer({ port: 0, registerSignals: false })
    }
    throw error
  }
}

function createMainWindow() {
  const win = new BrowserWindow({
    title: `${APP_NAME} Polaris`,
    width: 1360,
    height: 880,
    minWidth: 920,
    minHeight: 620,
    backgroundColor: '#f8fafc',
    show: false,
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  let shown = false
  const reveal = () => {
    if (!shown && !win.isDestroyed()) {
      shown = true
      win.show()
    }
  }
  win.once('ready-to-show', reveal)
  setTimeout(reveal, 3000)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !url.startsWith(serverAddress)) {
      shell.openExternal(url).catch(() => {})
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(serverAddress)) {
      event.preventDefault()
      if (/^https?:/i.test(url)) {
        shell.openExternal(url).catch(() => {})
      }
    }
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  mainWindow = win
  win.loadURL(serverAddress)
  return win
}

ipcMain.handle('polaris:show-in-folder', (_event, filePath) => {
  if (typeof filePath !== 'string' || !allowedDownloadPaths.has(filePath) || !fs.existsSync(filePath)) {
    return false
  }
  shell.showItemInFolder(filePath)
  return true
})

if (gotLock) {
  app.whenReady().then(async () => {
    try {
      setupMenu()
      setupDownloads()
      serverHandle = await bootEmbeddedServer()
      serverAddress = serverHandle.address
      createMainWindow()
    } catch (error) {
      dialog.showErrorBox('北极星 Polaris 启动失败', String(error?.message || error || '未知错误'))
      app.quit()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverAddress) {
      createMainWindow()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', event => {
    if (serverHandle && !quittingCleanly) {
      event.preventDefault()
      quittingCleanly = true
      Promise.resolve(serverHandle.close())
        .catch(() => {})
        .finally(() => {
          serverHandle = null
          app.quit()
        })
    }
  })
}
