// Production Electron IPC and filesystem; only disposable fixture paths may write.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const model = require('../data-model');
const root = path.resolve(__dirname, '..');
const sourceHashes = () => Object.fromEntries(['main.js', 'preload.js', 'script.js', 'data-authority.js', 'data-model.js'].map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')]));
if (!process.argv.includes('--electron-child')) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ntkiot-persistence-'));
    for (const key of ['userData', 'sessionData', 'logs', 'downloads', 'crashDumps']) fs.mkdirSync(path.join(sandbox, key));
    const data = JSON.parse(JSON.stringify(model.defaults));
    data.users = ['admin', 'manager', 'staff'].map(role => ({ id: role, user: role, pass: role + '-fixture', name: role, role }));
    data.products = [{ id: 'P', name: 'Fixture', code: 'FIXTURE', stock: 10, price: 1000, cost: 600, unit: 'SP' }];
    data.custs.push({ id: 'C', name: 'Customer', points: 70, totalBuy: 5000, debt: 0 });
    Object.assign(data.settings, { autoBackup: false, autoPrint: false, sound: false, disableLogin: false, pointsEnabled: true, pointsRate: 1 });
    if (process.argv.includes('--muted')) data.settings.notificationPreferences = { version: 1, enabled: false, disabledEventIds: [] };
    const text = JSON.stringify(data);
    fs.writeFileSync(path.join(sandbox, 'userData', 'data.json'), text);
    fs.writeFileSync(path.join(sandbox, 'fixture.json'), text);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const before = sourceHashes();
    const result = spawnSync(require('electron'), [__filename, '--electron-child', sandbox], { cwd: root, env, stdio: 'inherit', timeout: 60000, killSignal: 'SIGKILL' });
    assert.deepEqual(sourceHashes(), before, 'production source did not change during native scenarios');
    console.log('Persistence evidence:', sandbox);
    process.exitCode = result.status === 0 ? 0 : 1;
} else {
    const { app, BrowserWindow, dialog } = require('electron');
    const sandbox = fs.realpathSync(process.argv[process.argv.indexOf('--electron-child') + 1]);
    assert.ok(sandbox.startsWith(fs.realpathSync(os.tmpdir()) + path.sep) && path.basename(sandbox).startsWith('ntkiot-persistence-'));
    for (const key of ['userData', 'sessionData', 'downloads', 'crashDumps']) {
        app.setPath(key, path.join(sandbox, key)); assert.equal(app.getPath(key), path.join(sandbox, key));
    }
    app.setAppLogsPath(path.join(sandbox, 'logs')); assert.equal(app.getPath('logs'), path.join(sandbox, 'logs'));
    const primary = path.join(sandbox, 'userData', 'data.json');
    const temporary = file => typeof file === 'string' && file.startsWith(primary + '.tmp-');
    let fault = null, triggered = false, pickedFile = path.join(sandbox, 'fixture.json');
    let readGate = null, gatedPath = null, readEntered = false;
    const readFile = fs.promises.readFile.bind(fs.promises);
    fs.promises.readFile = async (file, ...args) => {
        if (readGate && file === gatedPath) { readEntered = true; await readGate; readGate = null; }
        return readFile(file, ...args);
    };
    const fail = kind => {
        if (fault !== kind) return;
        fault = null; triggered = true;
        throw Object.assign(new Error('ISOLATED_' + kind), { code: kind === 'write' ? 'ENOSPC' : 'EIO' });
    };
    const open = fs.promises.open.bind(fs.promises);
    fs.promises.open = async (file, flags, ...args) => {
        const handle = await open(file, flags, ...args);
        if (temporary(file)) {
            const writeFile = handle.writeFile.bind(handle), sync = handle.sync.bind(handle);
            handle.writeFile = async (...values) => { fail('write'); return writeFile(...values); };
            handle.sync = async () => { fail(file.endsWith('.bak') ? 'backup-sync' : 'sync'); return sync(); };
        }
        return handle;
    };
    const copyFile = fs.promises.copyFile.bind(fs.promises), rename = fs.promises.rename.bind(fs.promises);
    fs.promises.copyFile = async (from, to, ...args) => { if (temporary(to)) fail('backup-copy'); return copyFile(from, to, ...args); };
    fs.promises.rename = async (from, to) => {
        if (temporary(from) && to === primary) fail('rename');
        if (temporary(from) && to === primary + '.bak') fail('backup-publish');
        return rename(from, to);
    };
    dialog.showOpenDialog = async () => ({ canceled: !pickedFile, filePaths: pickedFile ? [pickedFile] : [] });
    dialog.showSaveDialog = async () => ({ canceled: true });
    app.setAppPath(root); require('../main');
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    app.whenReady().then(async () => {
        const evidence = { sourceHashes: sourceHashes(), faults: [], permissionBoundary: [], restoreTokens: [], paths: Object.fromEntries(['userData', 'sessionData', 'logs', 'downloads', 'crashDumps'].map(key => [key, app.getPath(key)])) };
        try {
            const win = BrowserWindow.getAllWindows()[0];
            win.webContents.print = (_options, cb) => cb?.(false, 'PRINT_BLOCKED');
            win.webContents.getPrintersAsync = async () => [];
            win.webContents.session.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
            win.webContents.session.on('will-download', (_event, item) => item.setSavePath(path.join(sandbox, 'downloads', path.basename(item.getFilename()))));
            const run = code => win.webContents.executeJavaScript(code);
            const loaded = async () => {
                for (let i = 0; i < 250; i++) {
                    if (!win.webContents.isLoading() && await run("typeof dataLoadStatus!=='undefined'&&dataLoadStatus==='primary'")) { await wait(200); return; }
                    await wait(20);
                }
                throw new Error('Initialization timeout');
            };
            const login = async role => {
                assert.equal(await run(`(async()=>{window.confirm=()=>true;$('log-u').value='${role}';$('log-p').value='${role}-fixture';await login();return getCurrentUserRecord()?.role;})()`), role);
                await wait(700);
            };
            const reload = async () => {
                const done = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
                win.webContents.reload(); await done; await loaded();
            };
            const projection = `(()=>({stock:db.products[0].stock,invoices:db.invoices.length,returns:db.returns.length,history:db.stockHistory.length,customer:(()=>{const c=db.custs.find(c=>c.id==='C');return{points:c.points,totalBuy:c.totalBuy,debt:c.debt};})()}))()`;
            await loaded(); await login('manager');
            pickedFile = path.join(sandbox, 'malformed-secret.json');
            fs.writeFileSync(pickedFile, '{"pass": SECRET-FIXTURE}');
            const rejectedJson = await run('desktop.data.prepareRestore()');
            evidence.malformedJson = rejectedJson;
            assert.equal(rejectedJson.code, 'INVALID_DATA');
            assert.equal(JSON.stringify(rejectedJson).includes('SECRET'), false, 'parse errors must not expose even a credential fragment');
            evidence.invalidWrites = [];
            const initial = fs.readFileSync(primary, 'utf8');
            for (const operation of ['background-save', 'toString', 'constructor', ['saveSets'], { name: 'saveSets' }]) {
                const result = await run(`desktop.data.save(${operation === 'background-save' ? JSON.stringify('{"pass": SECRET-FIXTURE}') : 'JSON.stringify(db)'},desktopRequestOptions(${JSON.stringify(operation)}))`);
                assert.equal(result.committed, false); assert.ok(['INVALID_DATA', 'FORBIDDEN'].includes(result.code));
                assert.equal(JSON.stringify(result).includes('SECRET'), false);
                assert.equal(fs.readFileSync(primary, 'utf8'), initial);
                evidence.invalidWrites.push({ operation, result });
            }
            const owners = Object.keys(require('../data-authority').policies);
            assert.equal(owners.length, 57);
            for (const role of ['guest', 'staff', 'manager', 'admin']) {
                if (role === 'guest') await run('desktop.auth.logout()');
                else await login(role);
                const unchanged = fs.readFileSync(primary, 'utf8');
                for (let repeat = 0; repeat < 2; repeat++) for (const operation of owners) {
                    const result = await run(`(async()=>{
                        const session=await desktop.auth.current();
                        const next=JSON.parse(JSON.stringify(db));next.users.find(u=>u.id==='staff').role='admin';
                        return desktop.data.save(JSON.stringify(next),desktopRequestOptions(${JSON.stringify(operation)},
                            {baseRevision:session.revision,sessionEpoch:session.sessionEpoch,role:'admin',actorId:'admin',system:true}));
                    })()`);
                    assert.equal(result.ok, false, `${operation}/${role}`); assert.equal(result.committed, false);
                    assert.equal(fs.readFileSync(primary, 'utf8'), unchanged, 'denied generic save must never publish primary');
                    evidence.permissionBoundary.push({ role, repeat, operation, code: result.code });
                }
                console.log('Verified generic write boundary:', role, owners.length * 2, 'rejections');
            }
            await login('manager');
            // Prove a candidate cannot silently outlive changes to its source file.
            for (let repeat = 0; repeat < 2; repeat++) {
                pickedFile = path.join(sandbox, `changed-${repeat}.json`);
                fs.copyFileSync(path.join(sandbox, 'fixture.json'), pickedFile);
                const candidate = await run('desktop.data.prepareRestore()'); assert.equal(candidate.ok, true);
                const changed = JSON.parse(fs.readFileSync(pickedFile, 'utf8')); changed.settings.name = 'Changed after preview';
                fs.writeFileSync(pickedFile, JSON.stringify(changed));
                const before = fs.readFileSync(primary, 'utf8');
                const result = await run(`desktop.data.commitRestore(desktopRequestOptions('confirmRestoreData',{token:${JSON.stringify(candidate.token)}}))`);
                evidence.restoreTokens.push({ repeat, result });
                assert.equal(result.ok, false, 'changed file must invalidate restore candidate');
                assert.equal(result.code, 'STALE_STATE'); assert.equal(fs.readFileSync(primary, 'utf8'), before);
                assert.equal((await run('desktop.auth.current()')).actor.role, 'manager');
            }
            for (let repeat = 0; repeat < 2; repeat++) {
                pickedFile = path.join(sandbox, 'fixture.json');
                const prepared = await run('desktop.data.prepareRestore()'); assert.equal(prepared.ok, true);
                const before = fs.readFileSync(primary, 'utf8');
                let release; readGate = new Promise(resolve => { release = resolve; });
                gatedPath = pickedFile; readEntered = false;
                const committing = run(`desktop.data.commitRestore(desktopRequestOptions('confirmRestoreData',{token:${JSON.stringify(prepared.token)}}))`);
                for (let i = 0; i < 250 && !readEntered; i++) await wait(5);
                assert.ok(readEntered, 'restore source-file verification is in progress');
                const cancelled = await run('desktop.data.cancelRestore()'); assert.equal(cancelled.ok, true);
                release(); const result = await committing;
                assert.equal(result.code, 'STALE_STATE'); assert.equal(result.committed, false);
                assert.equal(fs.readFileSync(primary, 'utf8'), before);
                evidence.restoreTokens.push({ repeat, kind: 'cancel-during-read', result });
            }
            for (let repeat = 0; repeat < 2; repeat++) for (const kind of ['write', 'sync', 'backup-copy', 'backup-sync', 'rename', 'backup-publish']) {
                fault = null; pickedFile = path.join(sandbox, 'fixture.json');
                const prepared = await run('desktop.data.prepareRestore()'); assert.equal(prepared.ok, true);
                const restored = await run(`desktop.data.commitRestore(desktopRequestOptions('confirmRestoreData',{token:${JSON.stringify(prepared.token)}}))`);
                assert.equal(restored.committed, true, 'manager full restore remains allowed');
                await reload(); await login('staff');
                const before = fs.readFileSync(primary, 'utf8'), business = await run(projection);
                fault = kind; triggered = false;
                await run("(async()=>{router('pos');addCart('P');$('cart-cust').value='Customer';await directCheckout();})()");
                assert.ok(triggered, `${kind} hit the production filesystem path`);
                const after = await run(projection), cart = await run('cart.length');
                const committed = kind === 'backup-publish';
                if (committed) {
                    assert.deepEqual(after, { stock: 9, invoices: 1, returns: 0, history: 1, customer: { points: 80, totalBuy: 6000, debt: 0 } });
                    assert.equal(cart, 0); assert.notEqual(fs.readFileSync(primary, 'utf8'), before);
                } else {
                    assert.deepEqual(after, business); assert.equal(cart, 1); assert.equal(fs.readFileSync(primary, 'utf8'), before);
                }
                assert.equal(await run('activeDataMutation===null'), true);
                evidence.faults.push({ repeat, kind, committed, cart, business: after });
                await reload(); await login('manager');
                assert.deepEqual(await run(projection), after, `${kind}: durable result survives reload`);
                console.log('Verified', repeat, kind, 'committed:', committed);
            }
            const leftovers = fs.readdirSync(path.join(sandbox, 'userData')).filter(name => name.startsWith('data.json.tmp-'));
            assert.deepEqual(leftovers, [], 'failed atomic writes clean their own temporary files');
            fs.writeFileSync(path.join(sandbox, 'persistence.json'), JSON.stringify(evidence, null, 2));
            console.log('Persistence scenarios passed:', evidence.faults.length); app.exit(0);
        } catch (error) {
            fs.writeFileSync(path.join(sandbox, 'persistence.json'), JSON.stringify({ ...evidence, failure: error.stack }, null, 2));
            console.error(error.stack); app.exit(1);
        }
    });
}
