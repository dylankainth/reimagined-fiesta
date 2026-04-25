const { app, BrowserWindow } = require('electron')
const path = require('path')

function createWindow() {
    // Create the browser window
    const mainWindow = new BrowserWindow({
        width: 960,
        height: 680,
        backgroundColor: '#0f0f0f',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    })

    // Load the provider UI
    mainWindow.loadFile(path.join(__dirname, 'index.html'))

    // Open DevTools for debugging (optional)
    // mainWindow.webContents.openDevTools()
}

// This method will be called when Electron has finished initialization
app.whenReady().then(createWindow)

// Quit when all windows are closed
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})