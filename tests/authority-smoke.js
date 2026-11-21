// Native IPC verification. All credentials and files below are disposable fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const model = require('../data-model');
if (!process.argv.includes('--electron-child')) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ntkiot-authority-'));
    for (const key of ['userData', 'sessionData', 'logs', 'downloads', 'crashDumps']) fs.mkdirSync(path.join(sandbox, key));
    const data = JSON.parse(JSON.stringify(model.defaults));
    data.products = [{ id: 'P', name: 'Fixture product', code: 'FIXTURE', price: 1000, cost: 600, stock: 10, cat: 'Fixture', unit: 'SP' }];
    data.users = ['admin', 'manager', 'staff'].map((role, i) => ({ id: role, user: role, pass: role + '-fixture', role, name: role, code: 'NV000' + (i + 1) }));
    data.custs.push({ id: 'C', name: 'Fixture customer', points: 70, totalBuy: 5000, debt: 0 });
    data.suppliers = [{ id: 'N', name: 'Fixture supplier', debt: 0 }];
    Object.assign(data.settings, { autoBackup: false, autoPrint: false, sound: false, disableLogin: false, pointsEnabled: true, pointsRate: 1 });
    if(process.argv.includes('--muted'))data.settings.notificationPreferences={version:1,enabled:false,disabledEventIds:[]};
    fs.writeFileSync(path.join(sandbox, 'userData', 'data.json'), JSON.stringify(data));
    fs.writeFileSync(path.join(sandbox, 'original.json'), JSON.stringify(data));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(require('electron'), [__filename, '--electron-child', sandbox,...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit', timeout: 45000, killSignal: 'SIGKILL' });
    console.log('Authority evidence:', sandbox);
    if (child.status !== 0) console.error('Electron exit:', child.status, 'signal:', child.signal, child.error?.message || '');
    process.exitCode = child.status === 0 ? 0 : 1;
} else {
    const { app, BrowserWindow, ipcMain, dialog } = require('electron');
    const sandbox = fs.realpathSync(process.argv[process.argv.indexOf('--electron-child') + 1]);
    assert.ok(sandbox.startsWith(fs.realpathSync(os.tmpdir()) + path.sep) && path.basename(sandbox).startsWith('ntkiot-authority-'));
    for (const key of ['userData', 'sessionData', 'downloads', 'crashDumps']) { app.setPath(key, path.join(sandbox, key)); assert.equal(app.getPath(key), path.join(sandbox, key)); }
    app.setAppLogsPath(path.join(sandbox, 'logs'));
    const primary = path.join(sandbox, 'userData', 'data.json');
    let fault = null, pickedFile = null, writeGate = null, gateEntered = false;
    const handle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, listener) => handle(channel, async (event, payload) => {
        const result = await listener(event, payload);
        if (fault === 'unknown-ack' && channel === 'ntkiot:data-save' && result.committed === true) { fault = 'unknown-status'; throw Error('ACK_UNAVAILABLE'); }
        if (fault === 'unknown-status' && channel === 'ntkiot:data-commit-status') { fault = null; return { ok: false, code: 'UNKNOWN_COMMIT' }; }
        if (fault === 'ack' && channel === 'ntkiot:data-save' && result.committed === true) { fault = null; throw Error('ACK_LOST_AFTER_COMMIT'); }
        return result;
    });
    const rename = fs.promises.rename;
    fs.promises.rename = async (from, to) => {
        if (writeGate && to === primary) { gateEntered = true; await writeGate; writeGate = null; }
        if (fault === 'write' && to === primary) { fault = null; throw Object.assign(Error('FIXTURE_ENOSPC'), { code: 'ENOSPC' }); }
        return rename.call(fs.promises, from, to);
    };
    dialog.showOpenDialog = async () => ({ canceled: !pickedFile, filePaths: pickedFile ? [pickedFile] : [] });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(sandbox, 'export.json') });
    app.setAppPath(root); require('../main');
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    app.whenReady().then(async () => {
        try {
            let win = BrowserWindow.getAllWindows()[0];
            win.webContents.print = (_options, cb) => cb?.(false, 'PRINT_BLOCKED');
            win.webContents.getPrintersAsync = async () => [];
            win.webContents.session.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
            win.webContents.session.on('will-download', (_event, item) => item.setSavePath(path.join(sandbox, 'downloads', path.basename(item.getFilename()))));
            const run = code => win.webContents.executeJavaScript(code);
            const loaded = async () => {
                for (let i = 0; i < 250; i++) { if (!win.webContents.isLoading() && await run("typeof dataLoadStatus!=='undefined'&&dataLoadStatus==='primary'")) { await wait(150); return; } await wait(20); }
                throw Error('Initialization timeout');
            };
            const login = role => run(`(async()=>{window.confirm=()=>true;$('log-u').value=${JSON.stringify(role)};$('log-p').value=${JSON.stringify(role + '-fixture')};await login();return getCurrentUserRecord()?.role;})()`);
            const reload = async () => {
                const finished = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
                win.webContents.reload(); await finished; await loaded();
            };
            await loaded(); assert.equal(await login('staff'), 'staff');
            const evidence = { denied: [], restoreRejects: [], paths: Object.fromEntries(['userData', 'sessionData', 'logs', 'downloads', 'crashDumps'].map(key => [key, app.getPath(key)])) };
            const before = fs.readFileSync(primary, 'utf8');
            for (let repeat = 0; repeat < 2; repeat++) for (const operation of ['background-save', 'saveUser', 'saveSets', 'performUndo', 'performBackup', 'ensureUserCodes', 'unknown']) {
                const result = await run(`(async()=>{const data=JSON.parse(JSON.stringify(db));data.users.find(u=>u.role==='staff').role='admin';data.settings.disableLogin=true;return desktop.data.save(JSON.stringify(data),desktopRequestOptions(${JSON.stringify(operation)},{system:true,role:'admin'}));})()`);
                assert.equal(result.ok, false); assert.equal(result.committed, false); assert.equal(fs.readFileSync(primary, 'utf8'), before);
                evidence.denied.push({ repeat, operation, code: result.code });
            }
            assert.ok(await run('db.users.every(u=>!Object.hasOwn(u,"pass")&&!Object.hasOwn(u,"passwordHash"))'));
            assert.equal((await run('desktop.data.loadBak()')).backup.exists, false);
            fault = 'ack';
            evidence.checkout = await run(`(async()=>{router('pos');addCart('P');$('cart-cust').value='Fixture customer';await directCheckout();return{stock:db.products[0].stock,invoices:db.invoices.length,total:db.invoices[0].total,customer:db.custs.find(c=>c.id==='C'),cart:cart.length,owner:activeDataMutation===null};})()`);
            assert.equal(fault, null, 'genuine postcommit response loss injected');
            assert.equal(evidence.checkout.stock, 9); assert.equal(evidence.checkout.invoices, 1); assert.equal(evidence.checkout.total, 1000);
            assert.deepEqual([evidence.checkout.customer.points, evidence.checkout.customer.totalBuy, evidence.checkout.customer.debt], [80, 6000, 0]);
            assert.equal(evidence.checkout.cart, 0); assert.equal(evidence.checkout.owner, true);
            const committed = fs.readFileSync(primary, 'utf8');
            fault = 'write';
            evidence.failedCheckout = await run(`(async()=>{addCart('P');$('cart-cust').value='Fixture customer';await directCheckout();return{stock:db.products[0].stock,invoices:db.invoices.length,cart:cart.length,customer:db.custs.find(c=>c.id==='C'),owner:activeDataMutation===null};})()`);
            assert.equal(fault, null); assert.equal(fs.readFileSync(primary, 'utf8'), committed);
            assert.equal(evidence.failedCheckout.stock, 9); assert.equal(evidence.failedCheckout.invoices, 1); assert.equal(evidence.failedCheckout.cart, 1);
            assert.deepEqual([evidence.failedCheckout.customer.points, evidence.failedCheckout.customer.totalBuy], [80, 6000]);
            assert.equal(evidence.failedCheckout.owner, true);
            await reload();
            assert.equal((await run('desktop.auth.current()')).actor, null, 'reload invalidates main session');
            assert.equal(await login('staff'), 'staff');
            assert.equal(await run('db.products[0].stock'), 9);
            assert.equal(await login('manager'), 'manager');
            for (let repeat = 0; repeat < 2; repeat++) for (const kind of ['users', 'custs', 'name', 'code']) {
                const data = JSON.parse(committed);
                if (kind === 'users' || kind === 'custs') { data[kind][0].id = 7; data[kind][1].id = '7'; }
                else if (kind === 'name') delete data.products[0].name;
                else data.products[0].code = 123;
                pickedFile = path.join(sandbox, `invalid-${kind}-${repeat}.json`); fs.writeFileSync(pickedFile, JSON.stringify(data));
                const result = await run('desktop.data.prepareRestore()');
                assert.equal(result.ok, false); assert.equal(result.code, 'INVALID_DATA');
                assert.equal(fs.readFileSync(primary, 'utf8'), committed);
                evidence.restoreRejects.push({ repeat, kind, code: result.code, detail: result.detail });
            }
            const full = JSON.parse(committed); full.users[0] = { id: 'replacement-admin', user: 'replacement', name: 'Replacement admin', pass: 'replacement-fixture', role: 'admin', code: 'NV0999' };
            pickedFile = path.join(sandbox, 'valid-manager-restore.json'); fs.writeFileSync(pickedFile, JSON.stringify(full));
            const candidate = await run('desktop.data.prepareRestore()'); assert.equal(candidate.ok, true); assert.equal(Object.hasOwn(candidate, 'data'), false);
            fault = 'write';
            const request = `desktopRequestOptions('confirmRestoreData',{token:${JSON.stringify(candidate.token)}})`;
            evidence.failedRestore = await run(`desktop.data.commitRestore(${request})`);
            assert.equal(evidence.failedRestore.committed, false); assert.equal(fs.readFileSync(primary, 'utf8'), committed);
            assert.equal((await run('desktop.auth.current()')).actor.role, 'manager');
            evidence.managerRestore = await run(`desktop.data.commitRestore(${request})`);
            assert.equal(evidence.managerRestore.committed, true); assert.equal(evidence.managerRestore.actor, null);
            assert.ok(evidence.managerRestore.data.users.every(u => !Object.hasOwn(u, 'pass') && !Object.hasOwn(u, 'passwordHash')));
            assert.ok(model.validPasswordHash(JSON.parse(fs.readFileSync(primary, 'utf8')).users[0].passwordHash));
            await reload();
            assert.equal((await run("desktop.auth.login('replacement','replacement-fixture',crypto.randomUUID())")).actor.id, 'replacement-admin');
            assert.equal(await login('manager'), 'manager');
            assert.equal((await run('desktop.data.exportBackup()')).ok, true);
            assert.deepEqual(JSON.parse(fs.readFileSync(path.join(sandbox, 'export.json'), 'utf8')), JSON.parse(fs.readFileSync(primary, 'utf8')));
            fault = 'unknown-ack';
            evidence.unknownCommit = await run("(async()=>{router('pos');addCart('P');$('cart-cust').value='Fixture customer';const result=await directCheckout();const after=JSON.stringify(db);await directCheckout();return{result,blocked:activeDataMutation?.state==='Blocked',reason:saveBlockedReason,cart:cart.length,unchanged:JSON.stringify(db)===after,actor:getCurrentUserRecord(),notices:[...document.querySelectorAll('.notification-region')].map(r=>r.innerText)};})()");
            console.log('UNKNOWN scenario:',JSON.stringify(evidence.unknownCommit));
            assert.equal(fault, null); assert.equal(evidence.unknownCommit.blocked, true); assert.equal(evidence.unknownCommit.cart, 1); assert.equal(evidence.unknownCommit.unchanged, true);
            assert.equal(JSON.parse(fs.readFileSync(primary,'utf8')).products[0].stock, 8);
            await reload(); assert.equal(await run('db.products[0].stock'), 8);
            assert.equal(await login('manager'), 'manager');
            let release;
            writeGate = new Promise(resolve => { release = resolve; });
            await run("router('pos');addCart('P');$('cart-cust').value='Fixture customer';window.pendingCheckout=directCheckout();undefined;");
            for(let i=0;i<100&&!gateEntered;i++)await wait(10);
            assert.equal(gateEntered,true,'actual durable write reached before close');
            win.close(); await wait(30); assert.equal(win.isDestroyed(),false,'normal close waits for uncommitted write');
            release();
            for(let i=0;i<200&&!win.isDestroyed();i++)await wait(10);
            assert.equal(win.isDestroyed(),true);
            assert.equal(JSON.parse(fs.readFileSync(primary,'utf8')).products[0].stock,7);
            app.emit('activate'); win=BrowserWindow.getAllWindows()[0]; await loaded();
            assert.equal(await run('db.products[0].stock'),7); assert.equal(await run('db.invoices.length'),3);
            evidence.shutdownWaited = true;
            const fresh = async () => {
                assert.equal(await login('manager'),'manager');
                pickedFile=path.join(sandbox,'original.json');
                const prepared=await run('desktop.data.prepareRestore()'); assert.equal(prepared.ok,true);
                assert.equal((await run(`desktop.data.commitRestore(desktopRequestOptions('confirmRestoreData',{token:${JSON.stringify(prepared.token)}}))`)).committed,true);
                await reload(); assert.equal(await login('manager'),'manager');
            };
            await fresh();
            evidence.partialReturn=await run(`(async()=>{
                router('pos');addCart('P');modQty('P',1);$('cart-cust').value='Fixture customer';await directCheckout();
                const invoice=db.invoices[0];
                const sold={stock:db.products[0].stock,points:db.custs[1].points,totalBuy:db.custs[1].totalBuy,total:invoice.total};
                openReturnModal();$('return-invoice-search').value=invoice.id;searchInvoiceForReturn();$('return-item-P').checked=true;$('return-qty-P').value='1';$('return-reason').value='other';await processReturn();
                const returned={stock:db.products[0].stock,points:db.custs[1].points,totalBuy:db.custs[1].totalBuy,invoiceId:db.returns[0].invoiceId,invoiceRetained:db.invoices.some(i=>i.id===invoice.id),total:db.returns[0].returnTotal};
                await performUndo();
                return{sold,returned,undo:{stock:db.products[0].stock,points:db.custs[1].points,totalBuy:db.custs[1].totalBuy,returns:db.returns.length,invoices:db.invoices.length,stockHistory:db.stockHistory.length},linked:returned.invoiceId===invoice.id};
            })()`);
            assert.deepEqual(evidence.partialReturn.sold,{stock:8,points:90,totalBuy:7000,total:2000});
            assert.deepEqual([evidence.partialReturn.returned.stock,evidence.partialReturn.returned.points,evidence.partialReturn.returned.totalBuy,evidence.partialReturn.returned.total],[9,80,6000,1000]);
            assert.equal(evidence.partialReturn.returned.invoiceRetained,true);assert.equal(evidence.partialReturn.linked,true);
            assert.deepEqual(evidence.partialReturn.undo,{stock:8,points:90,totalBuy:7000,returns:0,invoices:1,stockHistory:1});
            await fresh();
            evidence.debt=await run(`(async()=>{openDebtModal('C');$('debt-type').value='add';$('debt-amount').value='3000';await saveDebt();const added=db.custs[1].debt;openDebtModal('C');$('debt-type').value='pay';$('debt-amount').value='1000';await saveDebt();return{added,paid:db.custs[1].debt,stock:db.products[0].stock,points:db.custs[1].points,totalBuy:db.custs[1].totalBuy,invoices:db.invoices.length};})()`);
            assert.deepEqual(evidence.debt,{added:3000,paid:2000,stock:10,points:70,totalBuy:5000,invoices:0});
            await fresh();
            evidence.purchase=await run(`(async()=>{openPurchaseOrderModal();$('po-supplier').value='N';$('po-code').value='FIXTURE-PO';currentPOItems=[{productId:'P',productName:'Fixture product',qty:5,price:600,total:3000}];$('po-is-paid').checked=false;await savePurchaseOrder();const po=db.purchaseOrders[0],created={stock:db.products[0].stock,debt:db.suppliers[0].debt,total:po.totalAmount,linked:db.stockHistory.some(h=>h.purchaseOrderId===po.id)};await markPOAsPaid(po.id);const paid=db.suppliers[0].debt;await markPOAsPaid(po.id);return{created,paid,unpaid:db.suppliers[0].debt,stock:db.products[0].stock,points:db.custs[1].points,totalBuy:db.custs[1].totalBuy};})()`);
            assert.deepEqual(evidence.purchase,{created:{stock:15,debt:3000,total:3000,linked:true},paid:0,unpaid:3000,stock:15,points:70,totalBuy:5000});
            await reload();
            assert.equal(await run('db.products[0].stock'),15);assert.equal(await run('db.suppliers[0].debt'),3000);
            assert.equal(await login('admin'),'admin');
            const createdId=await run("(async()=>{openUserModal();$('u-user').value='created-fixture';$('u-pass').value='created-fixture-pass';$('u-name').value='Created fixture';await saveUser();return db.users.find(u=>u.user==='created-fixture')?.id;})()");
            assert.ok(createdId);
            const createdHash = JSON.parse(fs.readFileSync(primary, 'utf8')).users.find(u => u.id === createdId).passwordHash;
            assert.ok(model.validPasswordHash(createdHash));
            assert.equal(await login('manager'),'manager');
            await run(`(async()=>{openUserModal(${JSON.stringify(createdId)});$('u-name').value='Manager edited staff';await saveUser();})()`);
            assert.equal(JSON.parse(fs.readFileSync(primary,'utf8')).users.find(u=>u.id===createdId).name,'Manager edited staff');
            assert.equal(JSON.parse(fs.readFileSync(primary, 'utf8')).users.find(u => u.id === createdId).passwordHash, createdHash);
            assert.equal(await login('staff'),'staff');
            assert.equal(await run("(async()=>{openUserModal('staff');const disabled=$('u-pass').disabled;$('u-name').value='Staff own profile';await saveUser();return disabled;})()"),true);
            const beforePassword=fs.readFileSync(primary,'utf8');
            await run("(async()=>{$('own-old-pass').value='incorrect';$('own-new-pass').value='new-fixture-pass';$('own-confirm-pass').value='new-fixture-pass';await changeOwnPassword();})()");
            assert.equal(fs.readFileSync(primary,'utf8'),beforePassword,'wrong old password never commits');
            await run("(async()=>{$('own-old-pass').value='staff-fixture';await changeOwnPassword();})()");
            assert.ok(model.validPasswordHash(JSON.parse(fs.readFileSync(primary, 'utf8')).users.find(u => u.id === 'staff').passwordHash));
            await reload();
            await run("(async()=>{$('log-u').value='staff';$('log-p').value='staff-fixture';await login();})()");
            assert.equal((await run('desktop.auth.current()')).actor,null,'old password is rejected after reload');
            await run("(async()=>{$('log-u').value='staff';$('log-p').value='new-fixture-pass';await login();})()");
            assert.equal((await run('desktop.auth.current()')).actor.id,'staff');
            assert.ok(await run('db.users.every(u=>!Object.hasOwn(u,"pass")&&!Object.hasOwn(u,"passwordHash"))'));
            assert.equal(await login('admin'),'admin');await run(`delUser(${JSON.stringify(createdId)})`);
            assert.equal(JSON.parse(fs.readFileSync(primary,'utf8')).users.some(u=>u.id===createdId),false);
            evidence.accounts={adminCreateDelete:true,managerEditStaff:true,staffOwnProfile:true,oldPasswordRejected:true,newPasswordReload:true,passwordsAbsentFromProjection:true};
            fs.writeFileSync(path.join(sandbox, 'authority.json'), JSON.stringify(evidence, null, 2));
            console.log(JSON.stringify({ denied: evidence.denied.length, restoreRejects: evidence.restoreRejects.length, checkout: evidence.checkout, managerRestore: evidence.managerRestore.committed, postcommitAckRecovered: true }, null, 2));
            app.exit(0);
        } catch (error) { console.error(error.stack); app.exit(1); }
    });
}
