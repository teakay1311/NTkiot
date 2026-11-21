const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('ntkiot', Object.freeze({
    auth: Object.freeze({
        login: (username, password, requestId) => invoke('ntkiot:auth-login', { username, password, requestId }),
        logout: () => invoke('ntkiot:auth-logout'),
        current: () => invoke('ntkiot:auth-current')
    }),
    data: Object.freeze({
        loadPrimary: () => invoke('ntkiot:data-load-primary'),
        loadBak: () => invoke('ntkiot:data-load-bak'),
        save: (text, options = {}) => invoke('ntkiot:data-save', { ...options, text }),
        getCommitStatus: requestId => invoke('ntkiot:data-commit-status', { requestId }),
        createBackup: (_text, _limit, options = {}) => invoke('ntkiot:backup-create', { reason: options.reason }),
        listBackups: () => invoke('ntkiot:backup-list'),
        readBackup: id => invoke('ntkiot:backup-read', { id }),
        cleanupBackups: limit => invoke('ntkiot:backup-cleanup', { limit }),
        resetAll: options => invoke('ntkiot:data-reset-all', options),
        exportBackup: () => invoke('ntkiot:backup-export'),
        prepareRestore: () => invoke('ntkiot:restore-prepare'),
        cancelRestore: () => invoke('ntkiot:restore-cancel'),
        commitRestore: options => invoke('ntkiot:restore-commit', options)
    }),
    printers: Object.freeze({
        list: () => ipcRenderer.invoke('ntkiot:printers-list'),
        print: options => ipcRenderer.send('ntkiot:print', options)
    }),
    log: entry => ipcRenderer.send('ntkiot:renderer-log', entry),
    onBeforeQuit: callback => { if (typeof callback === 'function') ipcRenderer.on('ntkiot:before-quit', callback); }
}));
