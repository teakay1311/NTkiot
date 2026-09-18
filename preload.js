const { contextBridge, ipcRenderer } = require('electron');

const sync = (channel, payload) => ipcRenderer.sendSync(channel, payload);

contextBridge.exposeInMainWorld('ntkiot', Object.freeze({
    data: Object.freeze({
        load: () => sync('ntkiot:data-load'),
        save: (text, options = {}) => sync('ntkiot:data-save', { text, keepBak: options.keepBak !== false }),
        createBackup: (text, limit) => sync('ntkiot:backup-create', { text, limit }),
        listBackups: () => sync('ntkiot:backup-list'),
        readBackup: id => sync('ntkiot:backup-read', { id }),
        cleanupBackups: limit => sync('ntkiot:backup-cleanup', { limit }),
        resetAll: () => sync('ntkiot:data-reset-all')
    }),
    printers: Object.freeze({
        list: () => ipcRenderer.invoke('ntkiot:printers-list'),
        print: options => ipcRenderer.send('ntkiot:print', options)
    }),
    log: entry => ipcRenderer.send('ntkiot:renderer-log', entry),
    onBeforeQuit: callback => { if (typeof callback === 'function') ipcRenderer.on('ntkiot:before-quit', callback); }
}));
