const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

if (!process.argv.includes('--electron-child')) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ntkiot-smoke-'));
    const folders = ['userData', 'sessionData', 'logs', 'downloads', 'crashDumps'];
    for (const folder of folders) fs.mkdirSync(path.join(sandbox, folder));
    const fixture = {
        products: [{ id: "SKU-'A", name: 'Smoke product', code: 'SMOKE', price: 100000, cost: 60000, stock: 10, cat: 'Smoke' }],
        users: [{ id: 'SMOKE-ADMIN', user: 'smoke', pass: 'fixture-only', name: 'Smoke admin', code: 'NV001', role: 'admin' },
            { id: 'SMOKE-STAFF', user: 'staff', pass: 'fixture-only', name: 'Smoke staff', code: 'NV002', role: 'staff' }],
        custs: [{ id: 1, name: 'Khách lẻ', points: 0, debt: 0, totalBuy: 0 },
            { id: 'SMOKE-C', name: 'Smoke customer', points: 0, debt: 0, totalBuy: 0 }],
        suppliers: [{ id: 'SMOKE-S', name: 'Smoke supplier', debt: 100000 }],
        categories: ['Smoke'], invoices: [], returns: [], purchaseOrders: [], stockHistory: [], activityLog: [],
        drafts: { invoices: [], purchaseOrders: [], products: [] },
        settings: { autoBackup: false, autoPrint: false, sound: false, pointsEnabled: false, disableLogin: false,
            timeOverrideEnabled: true, timeOffset: 86400000 }
    };
    if (process.argv.includes('--muted')) fixture.settings.notificationPreferences = { version: 1, enabled: false, disabledEventIds: [] };
    fs.writeFileSync(path.join(sandbox, 'userData', 'data.json'), JSON.stringify(fixture));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [__filename, '--electron-child', sandbox, ...process.argv.slice(2)], {
        cwd: root, env, encoding: 'utf8', timeout: 30000, stdio: 'inherit', killSignal:'SIGKILL'
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) console.error('Electron exit:', result.status, 'signal:', result.signal);
    console.log('Isolated test directory:', sandbox);
    process.exitCode = result.status === 0 ? 0 : 1;
} else {
    const { app, BrowserWindow } = require('electron');
    const sandbox = fs.realpathSync(process.argv[process.argv.indexOf('--electron-child') + 1]);
    assert.ok(sandbox && path.resolve(sandbox).startsWith(fs.realpathSync(os.tmpdir()) + path.sep), 'temporary directory required');
    assert.ok(path.basename(sandbox).startsWith('ntkiot-smoke-'), 'known fixture directory required');
    for (const key of ['userData', 'sessionData', 'downloads', 'crashDumps']) {
        const target = fs.realpathSync(path.join(sandbox, key));
        assert.ok(target.startsWith(fs.realpathSync(sandbox) + path.sep));
        app.setPath(key, target);
        assert.equal(app.getPath(key), target);
    }
    app.setAppLogsPath(path.join(sandbox, 'logs'));
    assert.equal(app.getPath('logs'), path.join(sandbox, 'logs'));
    // Paths and all write destinations are fixed before loading the production entry point.
    app.setAppPath(root);
    require(path.join(root, 'main.js'));
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    async function loadedWindow() {
        const win = BrowserWindow.getAllWindows()[0];
        assert.ok(win, 'production window exists');
        win.webContents.print = (_options, callback) => { callback?.(false, 'PRINT_BLOCKED_BY_TEST'); };
        win.webContents.getPrintersAsync = async () => [];
        win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        win.webContents.session.on('will-download', (_event, item) => {
            item.setSavePath(path.join(sandbox, 'downloads', path.basename(item.getFilename())));
        });
        for (let i = 0; i < 250; i++) {
            if (!win.webContents.isLoading() && await win.webContents.executeJavaScript("typeof dataLoadStatus !== 'undefined' && dataLoadStatus === 'primary'")) return win;
            await delay(20);
        }
        throw new Error('production initialization did not finish');
    }
    app.whenReady().then(async () => {
        try {
            let win = await loadedWindow();
            console.log('SMOKE: production initialized in sandbox');
            const errors = [];
            win.webContents.on('console-message', event => {
                if (event.level === 'error') errors.push(event.message);
            });
            const result = await win.webContents.executeJavaScript('(' + rendererSmoke.toString() + ')()');
            console.log('SMOKE: renderer flows completed');
            assert.equal(result.saleStock, 7);
            assert.equal(result.returnStock, 8);
            assert.equal(result.poStock, 10);
            assert.equal(result.debt, 120000);
            assert.equal(result.offset, 86400000);
            assert.equal(result.routes.length, 7);
            const committed = JSON.parse(fs.readFileSync(path.join(sandbox, 'userData', 'data.json'), 'utf8'));
            assert.equal(committed.products[0].stock, 10);
            assert.equal(committed.invoices.length, 1);
            assert.equal(committed.returns.length, 1);
            assert.equal(committed.suppliers[0].debt, 120000);
            // A clean window close and fresh production window exercise load from durable storage.
            const closed = new Promise(resolve => win.once('closed',resolve));
            win.close(); await closed;
            app.emit('activate');
            win = await loadedWindow();
            const reloaded = await win.webContents.executeJavaScript("({stock:db.products[0].stock,invoices:db.invoices.length,returns:db.returns.length,debt:db.suppliers[0].debt})");
            assert.deepEqual(reloaded, { stock: 10, invoices: 1, returns: 1, debt: 120000 });
            assert.deepEqual(errors, [], 'renderer console errors');
            const rename = fs.promises.rename;
            let injected = false;
            fs.promises.rename = async (from, to) => {
                if (!injected && to === path.join(sandbox, 'userData', 'data.json')) {
                    injected = true;
                    throw Object.assign(new Error('SMOKE_IO_FAILED'), { code: 'ENOSPC' });
                }
                return rename.call(fs.promises, from, to);
            };
            let failedSave;
            try {
                failedSave = await win.webContents.executeJavaScript("(async()=>{window.confirm=()=>true;$('log-u').value='smoke';$('log-p').value='fixture-only';await login();addCart(\"SKU-'A\");await directCheckout();return {stock:db.products[0].stock,invoices:db.invoices.length,cart:cart.length,owner:activeDataMutation===null,errorShown:[...document.querySelectorAll('.notification-region')].some(region=>region.innerText.includes('Lỗi lưu dữ liệu'))};})()");
            } finally { fs.promises.rename = rename; }
            assert.ok(injected);
            assert.deepEqual(failedSave, { stock: 10, invoices: 1, cart: 1, owner: true, errorShown: !process.argv.includes('--muted') });
            const closedAfterFailure = new Promise(resolve => win.once('closed',resolve));
            win.close(); await closedAfterFailure; app.emit('activate'); win = await loadedWindow();
            const afterFailure = await win.webContents.executeJavaScript('({stock:db.products[0].stock,invoices:db.invoices.length})');
            assert.deepEqual(afterFailure, { stock: 10, invoices: 1 });
            console.log(JSON.stringify({ result, reloaded, failedSave, afterFailure, userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), logs: app.getPath('logs'), downloads: app.getPath('downloads') }, null, 2));
            app.exit(0);
        } catch (error) {
            console.error(error.stack);
            app.exit(1);
        }
    });
}

async function rendererSmoke() {
    const check = (condition, label) => { if (!condition) throw new Error(label); };
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    window.confirm = () => true;
    const offset = timeOffset;
    $('log-u').value = 'smoke'; $('log-p').value = 'fixture-only'; await login();
    check(getCurrentUserRecord()?.role === 'admin', 'real login guard');
    const routes = [];
    for (const route of ['pos', 'products', 'history', 'management', 'customers', 'staff', 'settings']) {
        router(route); await wait(30);
        check($(route + '-view').classList.contains('active'), 'route ' + route);
        routes.push(route);
    }
    router('pos');
    console.log('SMOKE: seven routes passed');
    const modals = [];
    // Every static modal is opened/canceled in the real DOM. Business-specific handlers are exercised below.
    for (const modal of document.querySelectorAll('.modal-overlay')) {
        const id = modal.id;
        if (!id) continue;
        openModal(id);
        check(modal.classList.contains('active'), 'modal open ' + id);
        closeModal(id);
        await wait(5);
        check(!modal.classList.contains('active'), 'modal cancel ' + id);
        modals.push(id);
    }
    console.log('SMOKE: static modal open/cancel passed');
    addCart("SKU-'A"); modQty("SKU-'A", 2);
    $('cart-cust').value = 'Smoke customer';
    await directCheckout();
    console.log('SMOKE: checkout returned');
    check(db.invoices.length === 1 && db.products[0].stock === 7, 'durable sale');
    const saleStock = db.products[0].stock;
    const invoiceId = db.invoices[0].id;
    openEditInvoice(invoiceId);
    check($('edit-invoice-modal').classList.contains('active'), 'dynamic invoice edit');
    $('edit-inv-note').value = 'smoke note';
    await saveEditInvoice();
    check(db.invoices[0].total === 300000 && db.products[0].stock === 7, 'invoice note');
    const dynamicModals = ['edit-invoice-modal'];
    selectedInvoices.add(invoiceId); openBulkDeleteInvoiceModal();
    check($('bulk-delete-invoice-modal').classList.contains('active'), 'dynamic bulk invoice modal');
    await closeModal('bulk-delete-invoice-modal'); selectedInvoices.clear(); dynamicModals.push('bulk-delete-invoice-modal');
    deleteInvoice(invoiceId);
    check($('delete-invoice-modal').classList.contains('active'), 'dynamic delete invoice modal');
    await closeModal('delete-invoice-modal'); dynamicModals.push('delete-invoice-modal');
    showKeyboardShortcutsHelp();
    check($('keyboard-help-modal').classList.contains('active'), 'dynamic keyboard help');
    await closeModal('keyboard-help-modal'); dynamicModals.push('keyboard-help-modal');
    check(db.invoices.length === 1 && db.products[0].stock === 7, 'cancel dynamic modals has no mutation');
    viewInvoice(invoiceId);
    openReturnModal(); $('return-invoice-search').value = invoiceId; searchInvoiceForReturn();
    $("return-item-SKU-'A").checked = true;
    $("return-qty-SKU-'A").value = '1';
    $('return-reason').value = 'other';
    await processReturn();
    console.log('SMOKE: return completed');
    check(db.returns.length === 1 && db.products[0].stock === 8, 'partial return');
    const returnStock = db.products[0].stock;
    openPurchaseOrderModal();
    $('po-supplier').value = 'SMOKE-S';
    $('po-code').value = 'SMOKE-PO';
    $('po-product-search').value = 'Smoke';
    filterPOProducts();
    $('po-product-search').focus();
    $('po-product-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    $('po-product-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    $('po-product-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    check(currentPOItems.length === 1 && currentPOItems[0].productId === "SKU-'A", 'string ID keyboard in real DOM');
    currentPOItems[0].qty = 2; currentPOItems[0].price = 60000; currentPOItems[0].total = 120000;
    $('po-is-paid').checked = false;
    await savePurchaseOrder();
    console.log('SMOKE: PO save completed');
    check(db.products[0].stock === 10 && db.suppliers[0].debt === 120000, 'linked PO');
    const poStock = db.products[0].stock, debt = db.suppliers[0].debt;
    const date = db.purchaseOrders[0].date;
    await editPurchaseOrder(db.purchaseOrders[0].id);
    $('po-note').value = 'note only'; await savePurchaseOrder();
    check(db.purchaseOrders[0].date === date, 'PO timestamp unchanged');
    const stockSteps = [];
    openStockInModal(); $('si-product-search').value = 'Smoke'; filterStockInProducts();
    $('si-product-search').focus();
    for (const key of ['ArrowDown', 'Enter']) $('si-product-search').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    check($('si-product').value === "SKU-'A", 'stock-in keyboard original ID');
    $('si-qty').value = '2'; $('si-price').value = '60.000'; $('si-note').value = 'smoke inbound'; await saveStockIn();
    check(db.products[0].stock === 12 && !$('stock-in-modal').classList.contains('active'), 'stock-in form commit');
    stockSteps.push(db.products[0].stock);
    const inbound = db.stockHistory.find(entry => entry.note === 'smoke inbound');
    selectedStockEntries.add(inbound.id); deleteSelectedStockEntries();
    check($('bulk-delete-stock-modal').classList.contains('active'), 'dynamic bulk stock modal');
    await closeModal('bulk-delete-stock-modal'); selectedStockEntries.clear(); dynamicModals.push('bulk-delete-stock-modal');
    check(db.products[0].stock === 12 && db.stockHistory.includes(inbound), 'cancel stock deletion retains inventory');
    openStockOutModal(); $('so-product-search').value = 'Smoke'; filterStockOutProducts();
    $('so-product-search').focus();
    for (const key of ['ArrowDown', 'Enter']) $('so-product-search').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    check($('so-product').value === "SKU-'A", 'stock-out keyboard original ID');
    $('so-qty').value = '1'; $('so-note').value = 'smoke outbound'; await saveStockOut();
    check(db.products[0].stock === 11 && !$('stock-out-modal').classList.contains('active'), 'stock-out form commit');
    stockSteps.push(db.products[0].stock);
    openInventoryCheckModal(); $("ic-actual-SKU-'A").value = '10'; updateInventoryDiff("SKU-'A");
    await saveInventoryCheck();
    check(db.products[0].stock === 10 && !$('inventory-check-modal').classList.contains('active'), 'inventory-check form commit');
    stockSteps.push(db.products[0].stock);
    check(timeOffset === offset, 'settings leaves offset unchanged');
    return { routes, modals, dynamicModals, stockSteps, saleStock, returnStock, poStock, debt, offset };
}
