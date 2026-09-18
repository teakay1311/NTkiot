const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const rendererRestartTimes = [];
const MAX_RENDERER_RESTARTS = 3;
const RENDERER_RESTART_WINDOW_MS = 60 * 1000;
const MAX_DATA_BYTES = 100 * 1024 * 1024;
let mainWindow = null;

function logMainEvent(type, payload = {}) {
    try {
        const logDir = path.join(app.getPath('userData'), 'logs');
        fs.mkdirSync(logDir, { recursive: true });
        fs.appendFileSync(path.join(logDir, 'app.log'), `${JSON.stringify({ time: new Date().toISOString(), type, payload })}\n`, 'utf8');
    } catch (e) { console.error('Log failed:', e); }
}

function dataPaths() {
    const userData = app.getPath('userData');
    const primary = path.join(userData, 'data.json');
    return { primary, backup: `${primary}.bak`, backupDir: path.join(userData, 'backups') };
}

function readRecord(filePath, id) {
    try {
        if (!fs.existsSync(filePath)) return { id, exists: false, text: null, mtimeMs: 0 };
        return { id, exists: true, text: fs.readFileSync(filePath, 'utf8'), mtimeMs: fs.statSync(filePath).mtimeMs };
    } catch (_) { return { id, exists: true, text: null, mtimeMs: 0, error: 'READ_FAILED' }; }
}

function listBackupRecords(includeText = false) {
    const { backupDir } = dataPaths();
    if (!fs.existsSync(backupDir)) return [];
    return fs.readdirSync(backupDir)
        .filter(name => /^backup_[A-Za-z0-9_-]+\.json$/i.test(name))
        .map(name => {
            const filePath = path.join(backupDir, name);
            try {
                const stat = fs.statSync(filePath);
                return { id: name, name, mtimeMs: stat.mtimeMs, text: includeText ? fs.readFileSync(filePath, 'utf8') : undefined };
            } catch (_) { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function isSafeBackupId(value) { return typeof value === 'string' && /^backup_[A-Za-z0-9_-]+\.json$/i.test(value); }

function writeTextFileDurably(filePath, text, { keepBak = true } = {}) {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_DATA_BYTES) throw new Error('INVALID_DATA');
    JSON.parse(text);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    let fd;
    try {
        fd = fs.openSync(tempFile, 'w');
        fs.writeFileSync(fd, text, 'utf8');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = null;
        const hadExistingFile = fs.existsSync(filePath);
        if (keepBak && hadExistingFile) fs.copyFileSync(filePath, `${filePath}.bak`);
        fs.renameSync(tempFile, filePath);
        if (keepBak && !hadExistingFile) fs.copyFileSync(filePath, `${filePath}.bak`);
    } catch (e) {
        if (fd !== undefined && fd !== null) try { fs.closeSync(fd); } catch (_) { }
        try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) { }
        throw e;
    }
}

function isTrustedSender(event) {
    return !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents && event.sender.getURL().startsWith('file:');
}

function registerSync(channel, callback) {
    ipcMain.on(channel, (event, payload) => {
        if (!isTrustedSender(event)) return void (event.returnValue = { ok: false, code: 'UNAUTHORIZED' });
        try { event.returnValue = callback(payload); }
        catch (e) {
            logMainEvent(`ipc:${channel}:failed`, { code: e.message || 'FAILED' });
            event.returnValue = { ok: false, code: e.message === 'INVALID_DATA' ? 'INVALID_DATA' : 'IO_FAILED' };
        }
    });
}

function installIpc() {
    registerSync('ntkiot:data-load', () => {
        const { primary, backup } = dataPaths();
        return { ok: true, primary: readRecord(primary, 'primary'), backup: readRecord(backup, 'backup'), backups: listBackupRecords(true) };
    });
    registerSync('ntkiot:data-save', payload => {
        writeTextFileDurably(dataPaths().primary, payload?.text, { keepBak: payload?.keepBak !== false });
        return { ok: true };
    });
    registerSync('ntkiot:backup-create', payload => {
        const { backupDir } = dataPaths();
        const limit = Math.min(1000, Math.max(3, Number(payload?.limit) || 60));
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.mkdirSync(backupDir, { recursive: true });
        let name = `backup_${stamp}.json`;
        let suffix = 1;
        while (fs.existsSync(path.join(backupDir, name))) name = `backup_${stamp}_${suffix++}.json`;
        writeTextFileDurably(path.join(backupDir, name), payload?.text, { keepBak: false });
        listBackupRecords(false).slice(limit).forEach(record => fs.unlinkSync(path.join(backupDir, record.name)));
        return { ok: true, id: name };
    });
    registerSync('ntkiot:backup-list', () => ({ ok: true, backups: listBackupRecords(false) }));
    registerSync('ntkiot:backup-read', payload => {
        if (!isSafeBackupId(payload?.id)) throw new Error('INVALID_BACKUP_ID');
        const record = readRecord(path.join(dataPaths().backupDir, payload.id), payload.id);
        return record.exists && !record.error ? { ok: true, text: record.text } : { ok: false, code: 'NOT_FOUND' };
    });
    registerSync('ntkiot:backup-cleanup', payload => {
        const { backupDir } = dataPaths();
        const limit = Math.min(1000, Math.max(3, Number(payload?.limit) || 60));
        const backups = listBackupRecords(false);
        backups.slice(limit).forEach(record => fs.unlinkSync(path.join(backupDir, record.name)));
        return { ok: true, removed: Math.max(0, backups.length - limit) };
    });
    registerSync('ntkiot:data-reset-all', () => {
        const { primary, backup, backupDir } = dataPaths();
        [primary, backup].forEach(filePath => { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); });
        if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
        return { ok: true };
    });
    ipcMain.handle('ntkiot:printers-list', async event => isTrustedSender(event) ? mainWindow.webContents.getPrintersAsync() : []);
    ipcMain.on('ntkiot:print', (event, options = {}) => {
        if (!isTrustedSender(event)) return;
        mainWindow.webContents.print({ silent: options.silent === true, printBackground: true, deviceName: typeof options.printer === 'string' ? options.printer.slice(0, 256) : '' }, (success, errorType) => { if (!success) logMainEvent('print-failed', { errorType }); });
    });
    ipcMain.on('ntkiot:renderer-log', (event, entry = {}) => {
        if (!isTrustedSender(event)) return;
        const type = typeof entry.type === 'string' ? entry.type.slice(0, 128) : 'log';
        logMainEvent(`renderer:${type}`, entry.payload && typeof entry.payload === 'object' ? entry.payload : {});
    });
}

function scheduleRendererRecovery(win, details) {
    const reason = details?.reason || '';
    if (!win || win.isDestroyed() || reason === 'clean-exit') return;
    const now = Date.now();
    while (rendererRestartTimes.length && now - rendererRestartTimes[0] > RENDERER_RESTART_WINDOW_MS) rendererRestartTimes.shift();
    if (rendererRestartTimes.length >= MAX_RENDERER_RESTARTS) return logMainEvent('renderer-recovery-paused', { reason: 'too-many-restarts', restartCount: rendererRestartTimes.length, lastDetails: details });
    rendererRestartTimes.push(now);
    setTimeout(() => { if (!win.isDestroyed()) win.loadFile('index.html'); }, 1000);
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
        icon: path.join(__dirname, 'icon.png')
    });
    mainWindow = win;
    win.loadFile('index.html');
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('render-process-gone', (_event, details) => { logMainEvent('render-process-gone', details); scheduleRendererRecovery(win, details); });
    win.webContents.on('unresponsive', () => logMainEvent('window-unresponsive'));
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => logMainEvent('did-fail-load', { errorCode, errorDescription, validatedURL }));
    win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
    win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
    logMainEvent('app-ready', { version: app.getVersion() });
    installIpc();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => { BrowserWindow.getAllWindows().forEach(win => { try { win.webContents.send('ntkiot:before-quit'); } catch (_) { } }); logMainEvent('before-quit'); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
