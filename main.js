const { app, BrowserWindow, ipcMain, Menu, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const model = require('./data-model');
const { DataAuthority, projection, migratePasswords } = require('./data-authority');
const crypto = require('node:crypto');

const rendererRestartTimes = [];
const MAX_RENDERER_RESTARTS = 3;
const RENDERER_RESTART_WINDOW_MS = 60 * 1000;
const MAX_DATA_BYTES = 100 * 1024 * 1024;
// Retain the existing layout floor only when the display work area can fit it.
const MIN_WINDOW_WIDTH = 1440;
let mainWindow = null;
let fittingWindowBounds = false;
const authority = new DataAuthority((text, options) => writeTextFileDurably(dataPaths().primary, text, options));
let loadingData = null;
let resetRecoveryBlocked = false;
let backupPasswordJob = null;
let resetGeneration = 0;
let activeForegroundRequests = 0;
let lastForegroundRequest = 0;

function parseDataText(text) {
    try { return JSON.parse(text); }
    catch (_) {
        // V8's SyntaxError may quote part of the input, including passwords.
        throw new Error('Dữ liệu JSON không hợp lệ');
    }
}

async function ensureLoaded() {
    if (authority.data) return;
    if (loadingData) return loadingData;
    loadingData = (async () => {
        let resetCommitted = false;
        try { resetCommitted = await reconcileReset(); resetRecoveryBlocked = false; }
        catch (_) { resetRecoveryBlocked = true; }
        const primary = await readRecord(dataPaths().primary, 'primary');
        const candidates = [primary];
        if (!resetRecoveryBlocked && (!primary.text || (() => { try { model.normalize(parseDataText(primary.text)); return false; } catch (_) { return true; } })())) {
            candidates.push(await readRecord(dataPaths().backup, 'data-bak'));
            for (const backup of await listBackupRecords()) candidates.push(await readRecord(path.join(dataPaths().backupDir, backup.id), backup.id));
        }
        const errors = resetRecoveryBlocked ? ['Chưa hoàn tất phục hồi dữ liệu sau khi đặt lại.'] : [];
        let data = null, source = 'default', recovered = false;
        for (const record of candidates) {
            if (!record.exists) continue;
            try {
                if (!record.text || record.error) throw new Error('READ_FAILED');
                data = (record.id === 'primary' ? model.normalize : model.normalizeBackup)(parseDataText(record.text));
                source = record.id === 'primary' ? 'primary' : record.id === 'data-bak' ? 'data-bak' : 'backup';
                recovered = record.id !== 'primary';
                break;
            } catch (error) { errors.push(`${record.id}: ${error.message}`); }
        }
        let blocked = resetRecoveryBlocked || (!data && candidates.some(record => record.exists));
        let needsPrimaryWrite = recovered;
        // One-time browser-cache migration is read by main from the trusted
        // local frame, never accepted as a renderer-authorized generic save.
        let legacy = null;
        if (!blocked && !resetCommitted && !data && !candidates.some(record => record.exists) && mainWindow?.webContents?.executeJavaScript) {
            legacy = await mainWindow.webContents.executeJavaScript("localStorage.getItem('pos_pro_v10')");
            if (legacy) {
                try {
                    data = model.normalize(parseDataText(legacy));
                    needsPrimaryWrite = true;
                    source = 'localStorage';
                } catch (error) { blocked = true; errors.push(`localStorage: ${error.message}`); }
            }
        }
        data ||= model.normalize(model.defaults);
        try {
            const migrated = await migratePasswords(data);
            if (!blocked && (needsPrimaryWrite || migrated !== data && source !== 'default')) {
                await authority.write(JSON.stringify(migrated), { keepBak: false });
            }
            data = migrated;
        } catch (_) {
            blocked = true;
            errors.push(recovered ? 'Không thể ghi lại dữ liệu đã phục hồi' : 'Không thể chuyển đổi mật khẩu hoặc ghi dữ liệu cũ');
        }
        if (!blocked && source === 'localStorage') {
            const digest = crypto.createHash('sha256').update(legacy).digest('hex');
            try {
                await mainWindow.webContents.executeJavaScript(`(async () => {
                    const key = 'pos_pro_v10', value = localStorage.getItem(key);
                    if (value === null) return;
                    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
                    const digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
                    if (digest === '${digest}' && localStorage.getItem(key) === value) localStorage.removeItem(key);
                })()`);
            } catch (_) { logMainEvent('legacy-cache-cleanup-pending'); }
        }
        if (!blocked) {
            const beforeMaintenance = { ...data, users: data.users.map(user => ({ ...user })), products: data.products.map(product => ({ ...product })) };
            let changed = false;
            for (const user of data.users) if (!user.code) {
                let index = 1, code;
                do { code = `NV${String(index++).padStart(4, '0')}`; } while (data.users.some(u => u.code === code));
                user.code = code; changed = true;
            }
            for (const product of data.products) if (product.code?.length === 13 && !validEAN13(product.code)) {
                const stem = '890' + Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('');
                product.code = stem + ((10 - [...stem].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10) % 10);
                changed = true;
            }
            if (changed && source !== 'default') {
                try { await authority.write(JSON.stringify(data), { keepBak: !recovered }); }
                catch (_) { data = beforeMaintenance; blocked = true; errors.push('Không thể lưu chuẩn hóa dữ liệu khởi động'); }
            }
        }
        authority.adopt(data, { blocked });
        authority.loadInfo = { source, saveBlocked: blocked, errors };
        if (!blocked) scheduleBackupPasswordMigration();
    })();
    try { await loadingData; } finally { loadingData = null; }
}

function validEAN13(code) {
    return /^\d{13}$/.test(code) && (10 - [...code.slice(0, 12)].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10) % 10 === Number(code[12]);
}

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

async function readRecord(filePath, id) {
    try {
        const stat = await fsp.stat(filePath);
        return { id, exists: true, text: await fsp.readFile(filePath, 'utf8'), mtimeMs: stat.mtimeMs };
    } catch (e) {
        if (e?.code === 'ENOENT') return { id, exists: false, text: null, mtimeMs: 0 };
        return { id, exists: true, text: null, mtimeMs: 0, error: 'READ_FAILED' };
    }
}

async function listBackupRecords() {
    const { backupDir } = dataPaths();
    let names;
    try { names = await fsp.readdir(backupDir); }
    catch (e) { if (e?.code === 'ENOENT') return []; throw e; }
    const records = await Promise.all(names
        .filter(name => /^backup_[A-Za-z0-9_-]+\.json$/i.test(name))
        .map(async name => {
            const filePath = path.join(backupDir, name);
            try {
                const stat = await fsp.stat(filePath);
                return { id: name, name, mtimeMs: stat.mtimeMs };
            } catch (e) { if (e?.code === 'ENOENT') return null; throw e; }
        }));
    return records
        .filter(Boolean)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function isSafeBackupId(value) { return typeof value === 'string' && /^backup_[A-Za-z0-9_-]+\.json$/i.test(value); }

async function readRestoreFile(filePath) {
    const realPath = await fsp.realpath(filePath);
    const stat = await fsp.stat(realPath);
    if (!stat.isFile() || stat.size > MAX_DATA_BYTES) throw new Error('INVALID_DATA');
    const bytes = await fsp.readFile(realPath);
    if (bytes.length > MAX_DATA_BYTES) throw new Error('INVALID_DATA');
    return {
        bytes,
        identity: { realPath, size: stat.size, mtimeMs: stat.mtimeMs, dev: stat.dev, ino: stat.ino,
            digest: crypto.createHash('sha256').update(bytes).digest('hex') }
    };
}

async function writeTextFileDurably(filePath, text, { keepBak = true, validated = false, timestamps, backupText, createParent = true } = {}) {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_DATA_BYTES) throw new Error('INVALID_DATA');
    if (!validated) parseDataText(text);
    if (createParent) await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const tempFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    const backupTemp = `${tempFile}.bak`;
    let fd;
    let committed = false;
    try {
        fd = await fsp.open(tempFile, 'w');
        await fd.writeFile(text, 'utf8');
        if (timestamps) await fd.utimes(...timestamps);
        await fd.sync();
        await fd.close();
        fd = null;
        const hadExistingFile = await fsp.stat(filePath).then(() => true, e => e?.code === 'ENOENT' ? false : Promise.reject(e));
        if (keepBak) {
            if (backupText === undefined) await fsp.copyFile(hadExistingFile ? filePath : tempFile, backupTemp);
            fd = await fsp.open(backupTemp, backupText === undefined ? 'r+' : 'w');
            if (backupText !== undefined) await fd.writeFile(backupText, 'utf8');
            await fd.sync();
            await fd.close();
            fd = null;
        }
        await fsp.rename(tempFile, filePath);
        committed = true;
        if (keepBak) await fsp.rename(backupTemp, `${filePath}.bak`);
    } catch (e) {
        if (fd !== undefined && fd !== null) try { await fd.close(); } catch (_) { }
        try { await fsp.unlink(tempFile); } catch (_) { }
        try { await fsp.unlink(backupTemp); } catch (_) { }
        if (!committed) throw e;
        logMainEvent('backup-publish-failed', { code: e.code || 'IO_FAILED' });
    }
}

function isTrustedSender(event) {
    return !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents &&
        (!event.senderFrame || event.senderFrame === event.sender.mainFrame) && event.sender.getURL().startsWith('file:');
}

function registerAsync(channel, callback) {
    const foreground = ['ntkiot:data-load-primary', 'ntkiot:auth-login', 'ntkiot:auth-logout', 'ntkiot:data-save',
        'ntkiot:backup-export', 'ntkiot:restore-commit', 'ntkiot:data-reset-all'].includes(channel);
    ipcMain.handle(channel, async (event, payload) => {
        if (!isTrustedSender(event)) return { ok: false, code: 'UNAUTHORIZED' };
        if (foreground) activeForegroundRequests++;
        try { return await callback(payload, event); }
        catch (e) {
            logMainEvent(`ipc:${channel}:failed`, { code: e.message || 'FAILED' });
            return { ok: false, committed: false, code: ['INVALID_DATA', 'INVALID_DESTINATION', 'AUTH_REQUIRED', 'FORBIDDEN', 'STALE_STATE', 'BUSY', 'RESET_RECOVERY_REQUIRED'].includes(e.message) ? e.message : 'IO_FAILED' };
        }
        finally {
            if (foreground) {
                activeForegroundRequests--;
                lastForegroundRequest = Date.now();
            }
        }
    });
}

function resetPaths() {
    const { primary, backup, backupDir } = dataPaths();
    const root = path.dirname(primary);
    return {
        preparing: path.join(root, '.ntkiot-reset.preparing'),
        pending: path.join(root, '.ntkiot-reset.pending'),
        rolledBack: path.join(root, '.ntkiot-reset.rolled-back'),
        committed: path.join(root, '.ntkiot-reset.committed'),
        receipt: path.join(root, '.ntkiot-reset.receipt.json'),
        targets: [primary, backup, backupDir]
    };
}

async function pathExists(target) {
    try { await fsp.stat(target); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function readResetJournal(file) {
    const record = await readRecord(file, 'reset');
    if (!record.exists) return null;
    const journal = parseDataText(record.text);
    if (!journal || typeof journal.requestId !== 'string' || !/^[a-f0-9]{64}$/.test(journal.fingerprint) ||
        !Array.isArray(journal.present) || journal.present.length !== 3 || journal.present.some(value => typeof value !== 'boolean')) {
        throw new Error('RESET_RECOVERY_REQUIRED');
    }
    return journal;
}

async function removeResetResidue(dir) {
    try { await fsp.rm(dir, { recursive: true, force: true }); }
    catch (error) { logMainEvent('reset-cleanup-pending', { code: error.code || 'IO_FAILED' }); }
}

async function validateLegacyResetRollback(paths, contents) {
    const entries = await fsp.readdir(paths.pending);
    if (entries.length !== 1 || entries[0] !== 'data' || !(await fsp.lstat(contents)).isDirectory() ||
        (await fsp.readdir(contents)).length) throw new Error('RESET_RECOVERY_REQUIRED');

    const [primary, backup, backupDir] = paths.targets;
    if (!(await fsp.lstat(backupDir)).isDirectory()) throw new Error('RESET_RECOVERY_REQUIRED');
    const archives = (await fsp.readdir(backupDir)).filter(isSafeBackupId);
    for (const file of [primary, backup, ...archives.map(name => path.join(backupDir, name))]) {
        const stat = await fsp.lstat(file);
        if (!stat.isFile() || stat.size > MAX_DATA_BYTES) throw new Error('RESET_RECOVERY_REQUIRED');
        model.normalizeBackup(parseDataText(await fsp.readFile(file, 'utf8')));
    }
}

async function rollbackPendingReset(paths) {
    if (!await pathExists(paths.pending)) return;
    if (!(await fsp.lstat(paths.pending)).isDirectory() || await pathExists(paths.rolledBack)) throw new Error('RESET_RECOVERY_REQUIRED');
    const contents = path.join(paths.pending, 'data');
    const journal = await readResetJournal(path.join(paths.pending, 'journal.json'));
    if (journal) {
        if (await pathExists(contents) && !(await fsp.lstat(contents)).isDirectory()) throw new Error('RESET_RECOVERY_REQUIRED');
        const moves = [];
        for (const [index, original] of paths.targets.entries()) {
            const staged = path.join(contents, path.basename(original));
            const originalExists = await pathExists(original), stagedExists = await pathExists(staged);
            if (originalExists && stagedExists || journal.present[index] !== (originalExists || stagedExists)) throw new Error('RESET_RECOVERY_REQUIRED');
            if (stagedExists) moves.push({ staged, original });
        }
        for (const { staged, original } of moves.reverse()) await fsp.rename(staged, original);
        if (await pathExists(contents) && (await fsp.readdir(contents)).length) throw new Error('RESET_RECOVERY_REQUIRED');
    } else {
        await validateLegacyResetRollback(paths, contents);
    }
    await fsp.rename(paths.pending, paths.rolledBack);
    await removeResetResidue(paths.rolledBack);
}

async function committedResetReceipt(requestId) {
    const paths = resetPaths();
    const staged = await readResetJournal(path.join(paths.committed, 'journal.json'));
    const last = staged || await readResetJournal(paths.receipt);
    return last?.requestId === requestId ? last : null;
}

async function reconcileReset() {
    const paths = resetPaths();
    if (await pathExists(paths.pending) && await pathExists(paths.committed)) throw new Error('RESET_RECOVERY_REQUIRED');
    if (await pathExists(paths.preparing)) await removeResetResidue(paths.preparing);
    if (await pathExists(paths.rolledBack)) await removeResetResidue(paths.rolledBack);
    await rollbackPendingReset(paths);
    if (!await pathExists(paths.committed)) return false;
    const journalPath = path.join(paths.committed, 'journal.json');
    const staged = await readResetJournal(journalPath);
    // The committed directory can remain empty if interrupted after publishing its receipt.
    if (!staged) {
        if (await pathExists(path.join(paths.committed, 'data')) || !await readResetJournal(paths.receipt)) throw new Error('RESET_RECOVERY_REQUIRED');
        try { await fsp.rm(paths.committed, { recursive: true, force: true }); }
        catch (error) { logMainEvent('reset-cleanup-pending', { code: error.code || 'IO_FAILED' }); }
        return true;
    }
    try {
        if (!staged.cacheCleared) {
            const cleared = await mainWindow?.webContents.executeJavaScript("localStorage.clear(); sessionStorage.clear(); localStorage.getItem('pos_pro_v10') === null");
            if (cleared !== true) throw new Error('CACHE_NOT_CLEARED');
            staged.cacheCleared = true;
            await writeTextFileDurably(journalPath, JSON.stringify(staged), { keepBak: false });
        }
        await fsp.rm(path.join(paths.committed, 'data'), { recursive: true, force: true });
        await writeTextFileDurably(paths.receipt, JSON.stringify(staged), { keepBak: false });
        await fsp.rm(paths.committed, { recursive: true, force: true });
    } catch (error) { logMainEvent('reset-cleanup-pending', { code: error.code || 'IO_FAILED' }); }
    return true;
}

async function resetStoredData(requestId, fingerprint) {
    const paths = resetPaths();
    await reconcileReset();
    if (await pathExists(paths.committed) || await pathExists(paths.preparing) || await pathExists(paths.rolledBack)) throw new Error('BUSY');
    const present = [];
    for (const target of paths.targets) present.push(await pathExists(target));
    await fsp.mkdir(paths.preparing);
    try {
        await writeTextFileDurably(path.join(paths.preparing, 'journal.json'), JSON.stringify({ requestId, fingerprint, present }), { keepBak: false });
        await fsp.mkdir(path.join(paths.preparing, 'data'));
        await fsp.rename(paths.preparing, paths.pending);
    } catch (error) {
        await removeResetResidue(paths.preparing);
        throw error;
    }
    try {
        const contents = path.join(paths.pending, 'data');
        for (const [index, target] of paths.targets.entries()) {
            if (present[index]) await fsp.rename(target, path.join(contents, path.basename(target)));
        }
        await fsp.rename(paths.pending, paths.committed);
    } catch (error) {
        try { await rollbackPendingReset(paths); }
        catch (_) {
            logMainEvent('RESET_ROLLBACK_FAILED', { code: 'IO_FAILED' });
            throw new Error('RESET_RECOVERY_REQUIRED');
        }
        throw error;
    }
}

async function backupExportDestination(filePath) {
    const { primary, backup, backupDir } = dataPaths();
    const { preparing, pending, committed, rolledBack, receipt } = resetPaths();
    const normalize = value => process.platform === 'linux' ? path.resolve(value) : path.resolve(value).toLowerCase();
    const within = (target, container) => {
        const relative = path.relative(normalize(container), normalize(target));
        return !relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
    };
    const existing = async file => fsp.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    const deny = () => { throw new Error('INVALID_DESTINATION'); };
    try {
        const base = path.basename(filePath);
        if (process.platform === 'win32' && /[:]|[. ]$/.test(base)) deny();
        const root = await fsp.realpath(path.dirname(primary));
        const destination = path.join(await fsp.realpath(path.dirname(filePath)), base);
        const files = [primary, backup, receipt];
        const folders = [backupDir, preparing, pending, committed, rolledBack];
        const roots = async targets => {
            const resolved = [];
            for (const target of targets) {
                resolved.push(target, path.join(root, path.basename(target)));
                if (await existing(target)) resolved.push(await fsp.realpath(target));
            }
            return resolved;
        };
        const protectedFiles = await roots(files), protectedFolders = await roots(folders);
        const overlaps = target => protectedFiles.some(file => normalize(file) === normalize(target)) ||
            protectedFolders.some(folder => within(target, folder));
        if (overlaps(filePath) || overlaps(destination)) deny();
        if (await existing(destination)) {
            const resolved = await fsp.realpath(destination);
            const stat = await fsp.stat(resolved, { bigint: true });
            if (overlaps(resolved) || !stat.isFile()) deny();
            if (stat.nlink > 1n) {
                for (const archive of await listBackupRecords()) files.push(path.join(backupDir, archive.name));
                for (const file of files) {
                    const managed = await fsp.stat(file, { bigint: true }).catch(error => { if (error.code !== 'ENOENT') throw error; });
                    if (managed && managed.dev === stat.dev && managed.ino === stat.ino) deny();
                }
            }
        }
        return destination;
    } catch (_) { throw new Error('INVALID_DESTINATION'); }
}

function scheduleBackupPasswordMigration() {
    if (backupPasswordJob) return;
    const { backup, backupDir } = dataPaths();
    const startGeneration = resetGeneration;
    const stillCurrent = () => authority.data && resetGeneration === startGeneration &&
        !resetRecoveryBlocked && !authority.blocked;
    const quiet = () => !activeForegroundRequests && Date.now() - lastForegroundRequest >= 750;
    const waitForQuiet = async () => {
        while (stillCurrent() && !quiet()) await new Promise(resolve => setTimeout(resolve, 100));
        return stillCurrent();
    };
    backupPasswordJob = (async () => {
        if (!await waitForQuiet()) return;
        const leftover = /^\.ntkiot-credential-[a-f0-9-]{36}\.tmp(?:\.tmp-\d+-\d+)?$/;
        const names = await fsp.readdir(backupDir).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
        for (const name of names.filter(name => leftover.test(name))) {
            const removed = await authority.serial(async () => {
                if (!stillCurrent()) return false;
                await fsp.unlink(path.join(backupDir, name)).catch(() => {});
                return true;
            });
            if (!removed) return;
        }
        if (!stillCurrent()) return;
        const paths = [backup, ...(await listBackupRecords()).map(record => path.join(backupDir, record.name))];
        for (const file of paths) {
            if (!await waitForQuiet()) break;
            let candidate;
            try {
                const stat = await fsp.stat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
                if (!stat) continue;
                const raw = parseDataText(await fsp.readFile(file, 'utf8'));
                if (!stillCurrent()) break;
                if (!raw?.users?.some?.(user => user && Object.hasOwn(user, 'pass'))) continue;
                model.validateBackup(raw);
                const migrated = await migratePasswords(raw);
                if (!await waitForQuiet()) break;
                if (file === backup) await authority.serial(async () => {
                    if (stillCurrent()) await fsp.mkdir(backupDir, { recursive: true });
                });
                if (!stillCurrent()) break;
                candidate = path.join(backupDir, `.ntkiot-credential-${crypto.randomUUID()}.tmp`);
                // Serialize and sync outside the POS queue, then publish the verified replacement in it.
                await writeTextFileDurably(candidate, JSON.stringify(migrated), {
                    keepBak: false, timestamps: [stat.atime, stat.mtime], createParent: false
                });
                while (await waitForQuiet()) {
                    const finished = await authority.serial(async () => {
                        if (!stillCurrent()) return true;
                        if (!quiet()) return false;
                        const current = await fsp.stat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
                        if (!stillCurrent()) return true;
                        if (!current || ['dev', 'ino', 'size', 'ctimeMs', 'mtimeMs'].some(key => current[key] !== stat[key])) return true;
                        if (!quiet()) return false;
                        await fsp.rename(candidate, file);
                        return true;
                    });
                    if (finished) break;
                }
            } catch (error) { logMainEvent('backup-password-migration-pending', { code: error.code || 'INVALID_DATA' }); }
            finally {
                if (candidate) await authority.serial(async () => {
                    await fsp.unlink(candidate).catch(() => {});
                    if (!resetRecoveryBlocked) return;
                    // A failed rollback can leave this job's staging file inside the moved backup directory.
                    const staged = path.join(resetPaths().pending, 'data', path.basename(backupDir));
                    const name = path.basename(candidate);
                    const names = await fsp.readdir(staged).catch(() => []);
                    for (const entry of names) {
                        if (entry === name || (entry.startsWith(`${name}.tmp-${process.pid}-`) && leftover.test(entry))) {
                            await fsp.unlink(path.join(staged, entry)).catch(() => {});
                        }
                    }
                });
            }
        }
    })().catch(error => logMainEvent('backup-password-migration-pending', { code: error.code || 'IO_FAILED' }))
        .finally(() => { backupPasswordJob = null; });
}

function assertBackupExportReady() {
    if (resetRecoveryBlocked) throw new Error('RESET_RECOVERY_REQUIRED');
    if (authority.blocked && authority.loadInfo.source === 'default') throw new Error('INVALID_DATA');
}

function installIpc() {
    registerAsync('ntkiot:data-load-primary', async () => {
        await authority.queue;
        await ensureLoaded();
        return { ok: true, data: authority.publicData(), ...authority.loadInfo, ...authority.session() };
    });
    registerAsync('ntkiot:data-load-bak', async () => {
        await ensureLoaded();
        const record = await readRecord(dataPaths().backup, 'backup');
        if (record.text) record.text = JSON.stringify(projection(model.normalize(parseDataText(record.text))));
        return { ok: true, backup: record };
    });
    registerAsync('ntkiot:auth-login', async payload => { await ensureLoaded(); return authority.login(payload); });
    registerAsync('ntkiot:auth-logout', async () => { await ensureLoaded(); return authority.logout(); });
    registerAsync('ntkiot:auth-current', async () => { await ensureLoaded(); return authority.autoLogin(); });
    registerAsync('ntkiot:data-save', async payload => { await ensureLoaded(); return authority.save(payload); });
    registerAsync('ntkiot:data-commit-status', async payload => {
        const status = authority.commitStatus(payload?.requestId);
        if (status.code !== 'UNKNOWN_COMMIT' || typeof payload?.requestId !== 'string' || payload.requestId.length > 128) return status;
        return await committedResetReceipt(payload.requestId) ? { ok: true, committed: true } : status;
    });
    registerAsync('ntkiot:backup-create', async payload => authority.serial(async () => {
        await ensureLoaded();
        if (authority.blocked) throw new Error('INVALID_DATA');
        const automatic = ['scheduled', 'startup-due'].includes(payload?.reason);
        if (automatic) {
            const intervals = { hourly: 3600000, every2h: 7200000, every6h: 21600000, daily: 86400000 };
            const appNow = Date.now() + (authority.data.settings.timeOverrideEnabled === true ? Number(authority.data.settings.timeOffset) || 0 : 0);
            const elapsed = appNow - new Date(authority.data.settings.lastBackupAt || 0).getTime();
            if (authority.data.settings.autoBackup === false || Number.isFinite(elapsed) && elapsed < (intervals[authority.data.settings.backupInterval] || intervals.daily)) throw new Error('FORBIDDEN');
        } else authority.requireRole(['admin', 'manager']);
        const { backupDir } = dataPaths();
        const limit = Math.min(1000, Math.max(3, Number(authority.data.settings.backupLimit) || 60));
        const stamp = new Date().toISOString();
        await fsp.mkdir(backupDir, { recursive: true });
        let name = `backup_${stamp.replace(/[:.]/g, '-')}.json`;
        let suffix = 1;
        while (await fsp.stat(path.join(backupDir, name)).then(() => true, e => e?.code === 'ENOENT' ? false : Promise.reject(e))) name = `backup_${stamp.replace(/[:.]/g, '-')}_${suffix++}.json`;
        await writeTextFileDurably(path.join(backupDir, name), JSON.stringify(authority.data), { keepBak: false });
        const backups = await listBackupRecords();
        await Promise.all(backups.slice(limit).map(record => fsp.unlink(path.join(backupDir, record.name))));
        const receiptId = crypto.randomUUID();
        authority.backupReceipts.clear();
        const metadataStamp = new Date(Date.now() + (authority.data.settings.timeOverrideEnabled === true ? Number(authority.data.settings.timeOffset) || 0 : 0)).toISOString();
        authority.backupReceipts.set(receiptId, { stamp: metadataStamp, epoch: authority.epoch, revision: authority.revision });
        return { ok: true, id: name, backupReceiptId: receiptId, stamp: metadataStamp };
    }));
    registerAsync('ntkiot:backup-list', async () => ({ ok: true, backups: await listBackupRecords() }));
    registerAsync('ntkiot:backup-read', async payload => {
        if (!isSafeBackupId(payload?.id)) throw new Error('INVALID_DATA');
        const record = await readRecord(path.join(dataPaths().backupDir, payload.id), payload.id);
        return record.exists && !record.error ? { ok: true, text: JSON.stringify(projection(model.normalize(parseDataText(record.text)))) } : { ok: false, code: 'NOT_FOUND' };
    });
    registerAsync('ntkiot:backup-cleanup', async () => authority.serial(async () => {
        await ensureLoaded();
        authority.requireRole(['admin', 'manager']);
        if (resetRecoveryBlocked) throw new Error('RESET_RECOVERY_REQUIRED');
        if (authority.blocked) throw new Error('INVALID_DATA');
        const limit = Math.min(1000, Math.max(3, Number(authority.data.settings.backupLimit) || 60));
        const backups = await listBackupRecords();
        await Promise.all(backups.slice(limit).map(record => fsp.unlink(path.join(dataPaths().backupDir, record.name))));
        return { ok: true, removed: Math.max(0, backups.length - limit) };
    }));
    registerAsync('ntkiot:backup-export', async () => {
        await ensureLoaded();
        authority.requireRole(['admin', 'manager']);
        assertBackupExportReady();
        const epoch = authority.epoch;
        const result = await dialog.showSaveDialog(mainWindow, { defaultPath: `POS_Backup_${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (result.canceled || !result.filePath) return { ok: false, canceled: true };
        // Permission is checked again after the native dialog has completed.
        return authority.serial(async () => {
            authority.requireRole(['admin', 'manager']);
            if (epoch !== authority.epoch) throw new Error('STALE_STATE');
            assertBackupExportReady();
            const snapshot = await migratePasswords(authority.data);
            if (snapshot.users.some(user => Object.hasOwn(user, 'pass') ||
                Object.hasOwn(user, 'passwordHash') && !model.validPasswordHash(user.passwordHash))) throw new Error('INVALID_DATA');
            model.validateBackup(snapshot);
            const destination = await backupExportDestination(result.filePath);
            await writeTextFileDurably(destination, JSON.stringify(snapshot, null, 2), { keepBak: false, createParent: false });
            return { ok: true };
        });
    });
    registerAsync('ntkiot:restore-prepare', async () => {
        await ensureLoaded();
        authority.requireRole(['admin', 'manager']);
        if (resetRecoveryBlocked) throw new Error('BUSY');
        authority.restoreCandidate = null;
        const sequence = authority.prepareSequence = (authority.prepareSequence || 0) + 1;
        const version = authority.revision, epoch = authority.epoch;
        const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
        return authority.serial(async () => {
            authority.requireRole(['admin', 'manager']);
            if (sequence !== authority.prepareSequence || version !== authority.revision || epoch !== authority.epoch) throw new Error('STALE_STATE');
            const filePath = result.filePaths[0];
            const { bytes, identity } = await readRestoreFile(filePath);
            let data;
            try { data = model.normalizeBackup(parseDataText(bytes.toString('utf8'))); }
            catch (error) { return { ok: false, code: 'INVALID_DATA', detail: error.message }; }
            const token = crypto.randomUUID();
            authority.restoreCandidate = { token, data, version, epoch, filePath, identity };
            const file = { name: path.basename(filePath), size: identity.size, lastModified: identity.mtimeMs };
            const counts = Object.fromEntries(Object.entries(data).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length]));
            return { ok: true, token, file, counts };
        });
    });
    registerAsync('ntkiot:restore-cancel', async () => { authority.prepareSequence = (authority.prepareSequence || 0) + 1; authority.restoreCandidate = null; return { ok: true }; });
    registerAsync('ntkiot:restore-commit', async payload => authority.serial(async () => {
        if (typeof payload?.requestId !== 'string' || !payload.requestId || payload.requestId.length > 128) throw new Error('INVALID_DATA');
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
        const oldReceipt = authority.receipts.get(payload?.requestId);
        if (oldReceipt) {
            if (oldReceipt.fingerprint !== fingerprint) throw new Error('INVALID_DATA');
            return oldReceipt.result;
        }
        authority.requireRole(['admin', 'manager']);
        if (resetRecoveryBlocked) throw new Error('BUSY');
        authority.checkVersion(payload);
        const candidate = authority.restoreCandidate;
        if (!candidate || candidate.token !== payload?.token || candidate.version !== authority.revision || candidate.epoch !== authority.epoch) throw new Error('STALE_STATE');
        // The preview authorizes this exact file, not a path whose content or
        // symlink target may have changed while the confirmation was open.
        let unchanged = false;
        try { unchanged = JSON.stringify((await readRestoreFile(candidate.filePath)).identity) === JSON.stringify(candidate.identity); }
        catch (_) { /* Missing/replaced/unreadable source requires a fresh preview. */ }
        if (!unchanged) {
            if (authority.restoreCandidate === candidate) authority.restoreCandidate = null;
            throw new Error('STALE_STATE');
        }
        // Cancel/new preview can arrive while the asynchronous file check runs.
        // Recheck at the write boundary; never resurrect the captured token.
        if (authority.restoreCandidate !== candidate) throw new Error('STALE_STATE');
        authority.requireRole(['admin', 'manager']);
        authority.checkVersion(payload);
        try {
            const restored = await migratePasswords(model.normalizeBackup(candidate.data));
            let backupText;
            if (authority.blocked) {
                const previous = await readRecord(dataPaths().primary, 'primary');
                if (previous.text) {
                    let previousData;
                    try { previousData = parseDataText(previous.text); model.validateBackup(previousData); }
                    catch (_) { previousData = null; /* Preserve the previous .bak if the primary is incomplete. */ }
                    if (previousData) backupText = JSON.stringify(await migratePasswords(previousData));
                }
            }
            const source = await readRestoreFile(candidate.filePath).catch(() => null);
            // Cancellation is allowed while expensive legacy credentials are being hashed.
            if (authority.restoreCandidate !== candidate || JSON.stringify(source?.identity) !== JSON.stringify(candidate.identity)) throw new Error('STALE_STATE');
            await authority.write(JSON.stringify(restored), { keepBak: !authority.blocked || backupText !== undefined, backupText });
            authority.adopt(restored);
            scheduleBackupPasswordMigration();
            authority.loadInfo = { source: 'primary', saveBlocked: false, errors: [] };
            authority.restoreCandidate = null;
            authority.userId = null;
            authority.epoch++;
            authority.backupReceipts.clear();
            return authority.remember(payload.requestId, fingerprint, { ok: true, committed: true, data: authority.publicData(), ...authority.session() });
        } catch (_) {
            return authority.remember(payload.requestId, fingerprint, { ok: false, committed: false, code: _.message === 'STALE_STATE' ? 'STALE_STATE' : 'IO_FAILED' });
        }
    }));
    registerAsync('ntkiot:data-reset-all', async payload => authority.serial(async () => {
        if (typeof payload?.requestId !== 'string' || !payload.requestId || payload.requestId.length > 128) throw new Error('INVALID_DATA');
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
        const receipt = authority.receipts.get(payload.requestId);
        if (receipt) {
            if (receipt.fingerprint !== fingerprint) throw new Error('INVALID_DATA');
            return receipt.result;
        }
        const committed = await committedResetReceipt(payload.requestId);
        if (committed) {
            if (committed.fingerprint !== fingerprint) throw new Error('INVALID_DATA');
            return { ok: true, committed: true };
        }
        await ensureLoaded();
        authority.requireRole(['admin']);
        authority.checkVersion(payload);
        if (resetRecoveryBlocked) return { ok: false, committed: false, code: 'RESET_RECOVERY_REQUIRED' };
        try { await resetStoredData(payload.requestId, fingerprint); }
        catch (error) {
            if (error.message === 'RESET_RECOVERY_REQUIRED') {
                resetRecoveryBlocked = true;
                authority.blocked = true;
                authority.loadInfo.saveBlocked = true;
            }
            const code = ['BUSY', 'RESET_RECOVERY_REQUIRED'].includes(error.message) ? error.message : 'IO_FAILED';
            return authority.remember(payload.requestId, fingerprint, { ok: false, committed: false, code });
        }
        resetGeneration++;
        authority.data = null;
        authority.userId = null;
        authority.epoch++;
        authority.counter++;
        authority.restoreCandidate = null;
        authority.backupReceipts.clear();
        return authority.remember(payload.requestId, fingerprint, { ok: true, committed: true, ...authority.session() });
    }));
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

let quitAllowed = false;
let quitPending = false;
async function drainWindow(win) {
    if (win.isDestroyed()) return true;
    try {
        const settled = await win.webContents.executeJavaScript("typeof prepareForShutdown === 'function' ? prepareForShutdown() : true");
        if (!settled) return false;
        await authority.queue;
        return true;
    } catch (_) {
        // A crashed renderer cannot supply an ACK; only durable main I/O may
        // finish. Its uncommitted renderer state is never written implicitly.
        await authority.queue;
        return win.webContents.isDestroyed() || win.webContents.isCrashed();
    }
}

function fitWindowToWorkArea(win) {
    if (!win || win.isDestroyed() || fittingWindowBounds) return;
    fittingWindowBounds = true;
    try {
        const bounds = win.getBounds();
        const area = screen.getDisplayMatching(bounds).workArea;
        const minWidth = Math.min(MIN_WINDOW_WIDTH, area.width);
        const [previousMinWidth, minHeight] = win.getMinimumSize();
        if (previousMinWidth !== minWidth) win.setMinimumSize(minWidth, minHeight);
        if (win.isMaximized() || win.isFullScreen() || win.isMinimized()) return;
        const width = Math.max(minWidth, Math.min(bounds.width, area.width));
        const height = Math.min(bounds.height, area.height);
        const next = {
            x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
            y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
            width,
            height
        };
        if (Object.keys(next).some(key => next[key] !== bounds[key])) win.setBounds(next);
    } finally { fittingWindowBounds = false; }
}

function createWindow() {
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(MIN_WINDOW_WIDTH, area.width);
    const height = Math.min(800, area.height);
    const win = new BrowserWindow({
        x: area.x + Math.floor((area.width - width) / 2),
        y: area.y + Math.floor((area.height - height) / 2),
        width,
        minWidth: width,
        height,
        webPreferences: { nodeIntegration: false, contextIsolation: true, devTools: false, preload: path.join(__dirname, 'preload.js') },
        icon: path.join(__dirname, 'icon.png')
    });
    mainWindow = win;
    let boundsTimer = null;
    // Coalesce movement so dragging between displays is not clamped mid-drag.
    for (const event of ['moved', 'resized']) {
        win.on(event, () => {
            clearTimeout(boundsTimer);
            boundsTimer = setTimeout(() => fitWindowToWorkArea(win), 150);
        });
    }
    for (const event of ['unmaximize', 'leave-full-screen', 'restore']) {
        win.on(event, () => fitWindowToWorkArea(win));
    }
    authority.userId = null;
    authority.epoch++;
    authority.restoreCandidate = null;
    authority.backupReceipts.clear();
    let firstNavigation = true;
    win.webContents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
        if (inPlace || !isMainFrame) return;
        if (firstNavigation) { firstNavigation = false; return; }
        void authority.invalidateSession();
    });
    win.loadFile('index.html');
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
        // Restore/reset may reload only this exact local document.
        if ((url || event.url) !== win.webContents.getURL()) event.preventDefault();
    });
    win.webContents.on('render-process-gone', (_event, details) => { logMainEvent('render-process-gone', details); scheduleRendererRecovery(win, details); });
    win.webContents.on('unresponsive', () => logMainEvent('window-unresponsive'));
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => logMainEvent('did-fail-load', { errorCode, errorDescription, validatedURL }));
    let closeAllowed = false, closePending = false;
    win.on('close', event => {
        if (quitAllowed || closeAllowed) return;
        event.preventDefault();
        if (closePending) return;
        closePending = true;
        void drainWindow(win).then(settled => {
            closePending = false;
            if (settled && !win.isDestroyed()) { closeAllowed = true; win.close(); }
            else logMainEvent('close-blocked', { code: 'UNKNOWN_COMMIT' });
        });
    });
    win.on('closed', () => {
        clearTimeout(boundsTimer);
        if (mainWindow === win) mainWindow = null;
    });
    win.setMenuBarVisibility(false);
}

if (app.requestSingleInstanceLock?.() === false) {
    app.exit(0);
} else {
app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
});
app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    logMainEvent('app-ready', { version: app.getVersion() });
    installIpc();
    createWindow();
    for (const event of ['display-metrics-changed', 'display-removed']) {
        screen.on(event, () => fitWindowToWorkArea(mainWindow));
    }
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', event => {
    if (quitAllowed) return;
    event.preventDefault();
    if (quitPending) return;
    quitPending = true;
    void Promise.all(BrowserWindow.getAllWindows().map(drainWindow)).then(results => {
        quitPending = false;
        if (results.every(Boolean)) { quitAllowed = true; logMainEvent('before-quit'); app.quit(); }
        else logMainEvent('quit-blocked', { code: 'UNKNOWN_COMMIT' });
    });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
