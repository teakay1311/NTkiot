const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../script.js'), 'utf8');

function between(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(start, -1, `Missing ${startMarker}`);
    assert.notEqual(end, -1, `Missing ${endMarker}`);
    return source.slice(start, end);
}

function createTestContext(context) {
    if (!context.canMutateManagement) context.canMutateManagement = () => true;
    if (!context.hasDesktopStorage) context.hasDesktopStorage = () => false;
    if (!Object.prototype.hasOwnProperty.call(context, 'desktop')) context.desktop = null;
    if (!Object.prototype.hasOwnProperty.call(context, 'cust')) context.cust = null;
    if (!Object.prototype.hasOwnProperty.call(context, 'invoiceTabs')) context.invoiceTabs = [];
    if (!context.beginInventoryCommit) context.beginInventoryCommit = () => ({});
    if (!context.saveInventoryCommit) context.saveInventoryCommit = () => true;
    if (!context.beginHistoryCommit) context.beginHistoryCommit = () => ({});
    if (!context.saveHistoryCommit) context.saveHistoryCommit = () => true;
    if (!context.saveNow) context.saveNow = () => true;
    vm.createContext(context);
    vm.runInContext(between('function sameStoredId(', '\nfunction isValidAdminAccount('), context);
    return context;
}

test('renderer bootstrap can reuse the SheetJS XLSX global', () => {
    const bootstrapEnd = source.indexOf('function serializeError');
    assert.notEqual(bootstrapEnd, -1);

    const context = { window: { ntkiot: null, JsBarcode: () => {}, XLSX: { utils: {} } } };
    vm.createContext(context);
    vm.runInContext('var XLSX = window.XLSX;', context);

    assert.doesNotThrow(() => vm.runInContext(source.slice(0, bootstrapEnd), context));
    assert.equal(context.XLSX, context.window.XLSX);
});

test('stored ID matching uses the production helper and preserves identity boundaries', () => {
    const context = {};
    createTestContext(context);

    assert.equal(context.sameStoredId(101, '101'), true);
    assert.equal(context.sameStoredId('SKU-101', 'SKU-101'), true);
    assert.equal(context.sameStoredId(1, '1'), true);
    assert.equal(context.sameStoredId('001', 1), false);
    assert.equal(context.sameStoredId('SKU-101', 101), false);
    assert.equal(context.sameStoredId(null, 1), false);
    assert.equal(context.sameStoredId(undefined, '1'), false);
});

test('restore rejects a non-empty user list without valid admin credentials', () => {
    const context = {
        cloneDefaultData: () => ({
            products: [], users: [{ id: 1, user: 'admin', pass: '123', role: 'admin' }], custs: [],
            invoices: [], suppliers: [], stockHistory: [], returns: [], activityLog: [], purchaseOrders: [],
            categories: [], settings: {}, drafts: { invoices: [], purchaseOrders: [], products: [] }
        }),
        normalizeShortcutSettings: () => ({})
    };
    createTestContext(context);
    vm.runInContext(between('function isValidAdminAccount(', '\nfunction loadJsonDataText('), context);

    const valid = context.normalizeDataShape({
        products: [], users: [{ id: 7, user: 'admin-old', pass: 'keep-this', role: 'admin' }]
    });
    assert.deepEqual(JSON.parse(JSON.stringify(valid.users)), [{ id: 7, user: 'admin-old', pass: 'keep-this', role: 'admin' }]);
    assert.throws(
        () => context.normalizeDataShape({ products: [], users: [{ id: 2, user: 'staff', pass: 'x', role: 'staff' }] }),
        /admin hợp lệ/
    );
});

test('an invalid primary data file is never replaced from localStorage without a valid backup', () => {
    const context = {
        desktop: { data: { load: () => ({ ok: true, primary: { exists: true, text: '{invalid' }, backup: { exists: false }, backups: [] }) } },
        loadLatestValidBackup: () => null,
        localStorage: { getItem: () => { throw new Error('localStorage must not be used'); } },
        cloneDefaultData: () => ({ settings: {} })
    };
    createTestContext(context);
    vm.runInContext(between('function loadPersistedData(', '\nfunction getBackupIntervalMs('), context);
    const result = context.loadPersistedData();
    assert.equal(result.saveBlocked, true);
    assert.equal(result.source, 'default');
    assert.match(result.errors.join(' '), /backup hợp lệ/);
});

test('reverting an inbound stock record preserves a negative balance', () => {
    const context = {
        db: { products: [{ id: 1, stock: 5 }], stockHistory: [{ id: 10, type: 'in', productId: 1, productName: 'A', qty: 10 }] },
        confirm: () => true, toast: () => {}, isLinkedStockHistoryEntry: () => false,
        pushUndo: (_type, data) => { context.undo = data; }, logActivity: () => {}, save: () => {},
        renderInventory: () => {}, renderManagement: () => {}, toFiniteNumber: value => Number.isFinite(Number(value)) ? Number(value) : 0,
        UNDO_ACTIONS: { DELETE_STOCK_ENTRY: 'DELETE_STOCK_ENTRY' }
    };
    createTestContext(context);
    vm.runInContext(between('function deleteStockEntry(', '\n// BULK DELETE - INVOICES'), context);
    context.deleteStockEntry(10);
    assert.equal(context.db.products[0].stock, -5);
    assert.equal(context.undo.stockAdjustment, -10);
    assert.equal(context.db.products[0].stock - context.undo.stockAdjustment, 5);
});

test('reverting a purchase order preserves a negative balance', () => {
    const context = {
        db: {
            products: [{ id: 1, stock: 5 }], stockHistory: [],
            purchaseOrders: [{ id: 'PO-1', code: 'PN1', totalAmount: 1, items: [{ productId: 1, qty: 10 }]}]
        },
        confirm: () => true, toast: () => {}, money: value => String(value), isStockHistoryForPurchaseOrder: () => false,
        pushUndo: (_type, data) => { context.undo = data; }, logActivity: () => {}, save: () => {},
        renderPOHistory: () => {}, renderInventory: () => {}, renderManagement: () => {},
        toFiniteNumber: value => Number.isFinite(Number(value)) ? Number(value) : 0,
        UNDO_ACTIONS: { DELETE_PURCHASE_ORDER: 'DELETE_PURCHASE_ORDER' }
    };
    createTestContext(context);
    vm.runInContext(between('function deletePurchaseOrder(', '\nfunction viewPurchaseOrder('), context);
    context.deletePurchaseOrder('PO-1');
    assert.equal(context.db.products[0].stock, -5);
    assert.equal(context.db.products[0].stock + context.undo.po.items[0].qty, 5);
});

test('persisted IDs use context-specific escaping in every audited renderer', () => {
    for (const marker of [
        'function renderHist()', 'function renderReturnsHistory()', 'function renderPOHistory()', 'function renderStockHistory()',
        'function renderInventoryStockHistory()', 'function renderUsers()', 'function renderPODrafts()',
        'function renderDraftsModalList()'
    ]) assert.ok(source.includes(marker), `Missing renderer ${marker}`);

    assert.match(source, /const escapeJsArgument = value => escapeAttr/);
    assert.match(source, /CSS\.escape\(returnId\)/);
    assert.match(source, /CSS\.escape\(invoiceId\)/);
    assert.doesNotMatch(source, /(?:viewInvoice|deleteInvoice|printReturnSlip|deletePurchaseOrder)\('\$\{(?:i|r|po)\.id\}'\)/);
});

test('management and inventory stock-history renderers keep price and total currency on one line', () => {
    const managementRenderer = source.slice(source.indexOf('function renderStockHistory()'), source.indexOf('// Separate function for Inventory tab stock history filter'));
    const inventoryRenderer = source.slice(source.indexOf('function renderInventoryStockHistory()'), source.indexOf('// Delete stock history entry'));
    const moneyCells = /<td class="money-cell">\$\{h\.(?:price|total) \? money\(h\.(?:price|total)\) : '-'\}<\/td>/g;

    assert.equal((managementRenderer.match(moneyCells) || []).length, 2);
    assert.equal((inventoryRenderer.match(moneyCells) || []).length, 2);
});

test('product tab hides category management while retaining category selection and filtering', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    assert.doesNotMatch(html, /🏷️ Danh mục sản phẩm/);
    assert.doesNotMatch(html, /id="new-cat-name"|id="cat-list-manage"/);
    assert.match(html, /id="prod-filter-cat"/);
    assert.match(html, /id="p-cat-search"/);
    assert.match(html, /id="p-cat-list"/);
});

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function makeUserContext({ users, actor, fields = {}, disableLogin = false }) {
    const elements = new Map(Object.entries(fields).map(([id, value]) => [id, { value }]));
    const context = {
        db: { users: plain(users), settings: { disableLogin } },
        currUser: actor ? plain(actor) : null,
        isAuthenticated: true,
        toast: message => { context.lastToast = message; },
        save: () => { context.saved = true; },
        ensureUserCodes: () => {}, renderStaffView: () => {}, closeModal: () => {}, closeAllModals: () => {},
        renderNav: () => {}, router: () => {},
        showLoginModal: () => { context.currUser = null; context.isAuthenticated = false; context.loginShown = true; },
        logActivity: () => { context.logged = true; },
        escapeJsArgument: value => String(value), escapeHtml: value => String(value), safeImageSrc: () => '',
        generateEmployeeCode: () => 'NV-TEST',
        confirm: () => true,
        $: id => elements.get(id) || { value: '', style: {}, classList: { contains: () => false } }
    };
    createTestContext(context);
    vm.runInContext(between('function sameStoredId(', '\nfunction normalizeDataShape('), context);
    vm.runInContext(between('function isLoginDisabled()', '\n// Multi-Invoice Tab System'), context);
    vm.runInContext(between('function logout()', '\nfunction toggleSidebar()'), context);
    vm.runInContext(between('// Render user cards for expanded view\nfunction getCurrentUserRecord', '\n// STAFF VIEW - Salary Management'), context);
    return context;
}

test('account mutations enforce staff and manager boundaries and retain a valid admin', () => {
    const users = [
        { id: 1, user: 'admin', pass: 'admin-pass', name: 'Admin', role: 'admin', baseSalary: 10, commission: 1 },
        { id: 2, user: 'manager', pass: 'manager-pass', name: 'Manager', role: 'manager' },
        { id: 3, user: 'staff', pass: 'staff-pass', name: 'Staff', role: 'staff', baseSalary: 30, commission: 5 }
    ];

    const staff = makeUserContext({
        users, actor: users[2],
        fields: { 'u-id': '1', 'u-user': 'admin', 'u-pass': 'stolen', 'u-name': 'Admin', 'u-role': 'admin' }
    });
    const beforeStaffAttempt = plain(staff.db.users);
    staff.saveUser();
    assert.deepEqual(plain(staff.db.users), beforeStaffAttempt);

    const manager = makeUserContext({
        users, actor: users[1],
        fields: { 'u-id': '1', 'u-user': 'admin', 'u-pass': 'stolen', 'u-name': 'Admin', 'u-role': 'admin' }
    });
    const beforeManagerAttempt = plain(manager.db.users);
    manager.saveUser();
    assert.deepEqual(plain(manager.db.users), beforeManagerAttempt);

    const managerCreatesStaff = makeUserContext({
        users, actor: users[1],
        fields: { 'u-id': '', 'u-code': 'NV-NEW', 'u-user': 'new-user', 'u-pass': 'new-pass', 'u-name': 'New user', 'u-role': 'admin' }
    });
    managerCreatesStaff.saveUser();
    assert.equal(managerCreatesStaff.db.users.at(-1).role, 'staff');

    const managerEditsStaff = makeUserContext({
        users, actor: users[1],
        fields: { 'u-id': '3', 'u-user': 'staff', 'u-pass': 'reset-pass', 'u-name': 'Staff changed', 'u-role': 'admin', 'u-basesalary': '999', 'u-commission': '99' }
    });
    managerEditsStaff.saveUser();
    const editedStaff = managerEditsStaff.db.users.find(user => user.id === 3);
    assert.equal(editedStaff.name, 'Staff changed');
    assert.equal(editedStaff.pass, 'reset-pass');
    assert.equal(editedStaff.role, 'staff');
    assert.equal(editedStaff.baseSalary, 30);
    assert.equal(editedStaff.commission, 5);

    const soleAdmin = makeUserContext({
        users: [users[0]], actor: users[0],
        fields: { 'u-id': '1', 'u-user': 'admin', 'u-pass': '', 'u-name': 'Admin', 'u-role': 'staff' }
    });
    const beforeDemotion = plain(soleAdmin.db.users);
    soleAdmin.saveUser();
    assert.deepEqual(plain(soleAdmin.db.users), beforeDemotion);
});

test('deleting a user preserves the last valid admin and legacy system account', () => {
    const admin = { id: 1, user: 'admin', pass: 'admin-pass', name: 'Admin', role: 'admin' };
    const onlyAdmin = makeUserContext({ users: [admin], actor: admin });
    onlyAdmin.delUser(1);
    assert.equal(onlyAdmin.db.users.length, 1);

    const secondAdmin = { id: 2, user: 'admin-two', pass: 'two-pass', name: 'Admin 2', role: 'admin' };
    const canDeleteSecond = makeUserContext({ users: [admin, secondAdmin], actor: admin });
    canDeleteSecond.delUser(2);
    assert.deepEqual(plain(canDeleteSecond.db.users), [admin]);
});

test('deleting the current admin ends or refreshes the session through logout', () => {
    const admin = { id: 1, user: 'admin', pass: 'admin-pass', name: 'Admin', role: 'admin' };
    const currentAdmin = { id: 2, user: 'admin-two', pass: 'two-pass', name: 'Admin 2', role: 'admin' };

    const normalLogin = makeUserContext({ users: [admin, currentAdmin], actor: currentAdmin });
    normalLogin.delUser(2);
    assert.deepEqual(plain(normalLogin.db.users), [admin]);
    assert.equal(normalLogin.currUser, null);
    assert.equal(normalLogin.isAuthenticated, false);
    assert.equal(normalLogin.loginShown, true);

    const loginDisabled = makeUserContext({ users: [admin, currentAdmin], actor: currentAdmin, disableLogin: true });
    loginDisabled.delUser(2);
    assert.deepEqual(plain(loginDisabled.db.users), [admin]);
    assert.equal(loginDisabled.currUser.id, 1);
    assert.equal(loginDisabled.isAuthenticated, true);
    assert.equal(loginDisabled.getCurrentUserRecord().id, 1);
});

function makeDocumentContext() {
    const context = {
        db: {
            invoices: [{ id: 'INV-1', total: 100, items: [{ id: 10, qty: 1, price: 100 }]}],
            returns: [{ id: 'RET-1', invoiceId: 'INV-1', custId: 9, returnTotal: 100 }],
            products: [{ id: 10, stock: 5 }], custs: [{ id: 1, name: 'Khách lẻ' }, { id: 9, name: 'Khách A' }],
            stockHistory: [], activityLog: [], settings: { pointsEnabled: false }
        },
        selectedInvoices: new Set(['INV-1']), invoiceTabs: [], cust: null,
        toast: message => { context.lastToast = message; },
        confirm: () => { throw new Error('confirm must not be called for a blocked mutation'); },
        pushUndo: () => { context.undoPushed = true; }, logActivity: () => { context.logged = true; }, save: () => { context.saved = true; },
        reverseInvoiceCustomerEffects: () => { context.customerReversed = true; },
        getOutstandingInvoiceItems: () => [{ id: 10, qty: 1, price: 100 }],
        money: value => String(value), escapeHtml: value => String(value), escapeJsString: value => String(value),
        renderHist: () => {}, renderPos: () => {}, renderInventory: () => {}, updateBulkDeleteUI: () => {},
        updateCustList: () => {}, renderCustTable: () => {}, clearDeletedCustomerReferences: () => {},
        UNDO_ACTIONS: { DELETE_INVOICE: 'DELETE_INVOICE', DELETE_CUSTOMER: 'DELETE_CUSTOMER' },
        $: () => null
    };
    createTestContext(context);
    vm.runInContext(between('function sameStoredId(', '\nfunction normalizeDataShape('), context);
    vm.runInContext(between('function hasLinkedReturn(', '\nfunction getInvoiceReturnedAmount('), context);
    vm.runInContext(between('function deleteSelectedInvoices(', '\n// NOTE: deleteInvoice()'), context);
    vm.runInContext(between('function deleteInvoice(', '\n// EDIT INVOICE FEATURE'), context);
    vm.runInContext(between('function clearDeletedCustomerReferences(', '\nfunction openDebtModal('), context);
    return context;
}

test('linked returns block invoice deletion and customer deletion without mutation', () => {
    const context = makeDocumentContext();
    const before = plain(context.db);
    context.deleteInvoice('INV-1');
    context.deleteSelectedInvoices();
    context.confirmBulkDeleteInvoices();
    context.delCust(9);
    assert.deepEqual(plain(context.db), before);
    assert.equal(context.undoPushed, undefined);
    assert.equal(context.saved, undefined);
});

function makeInvoiceDeleteContext({ invoiceId, returns = [] }) {
    const checkbox = { dataset: { id: String(invoiceId) }, checked: false };
    const context = {
        db: {
            invoices: [{ id: invoiceId, total: 100, items: [{ id: 10, qty: 1, price: 100 }]}],
            returns: plain(returns), products: [{ id: 10, name: 'A', stock: 5 }], stockHistory: [], activityLog: [], settings: {}
        },
        currUser: { name: 'Admin' }, selectedInvoices: new Set(), undoStack: [],
        saveBlockedReason: '', saveBlockedToastShown: false, saveSuppressed: false, _saveInProgress: false,
        document: {
            body: { insertAdjacentHTML: (_position, html) => { context.modalHtml = html; } },
            querySelector: () => ({ value: 'return' })
        },
        $: id => id === 'hist-body' ? { querySelectorAll: () => [checkbox] } : null,
        toast: message => { context.toastMessage = message; }, pushUndo: (type, data) => { context.undoCount = (context.undoCount || 0) + 1; context.undoStack.push({ type, data }); },
        logActivity: (action, detail) => { context.logged = true; context.db.activityLog.unshift({ action, detail }); }, saveNow: () => { context.saveNowCount = (context.saveNowCount || 0) + 1; return context.saveResult !== false; }, closeModal: () => { context.closed = true; },
        renderHist: () => {}, renderPos: () => {}, renderInventory: () => {}, updateBulkDeleteUI: () => {},
        reverseInvoiceCustomerEffects: () => { context.customerEffectsReversed = true; }, getOutstandingInvoiceItems: invoice => invoice.items,
        getAppDate: () => new Date('2026-01-01T00:00:00Z'), money: value => String(value), escapeHtml: value => String(value),
        escapeJsArgument: value => typeof value === 'number' && Number.isFinite(value) ? String(value) : `'${String(value)}'`,
        UNDO_ACTIONS: { DELETE_INVOICE: 'DELETE_INVOICE' }
    };
    createTestContext(context);
    vm.runInContext(between('function sameStoredId(', '\nfunction normalizeDataShape('), context);
    vm.runInContext(between('function hasLinkedReturn(', '\nfunction getInvoiceReturnedAmount('), context);
    vm.runInContext(between('function captureHistoryMutationSnapshot()', '\n// Direct checkout'), context);
    vm.runInContext(between('function toggleInvoiceSelect(', '\n// BULK DELETE - STOCK HISTORY'), context);
    vm.runInContext(between('function deleteInvoice(', '\n// EDIT INVOICE FEATURE'), context);
    return context;
}

test('invoice deletion supports numeric legacy IDs in modal, bulk selection, and linked-return guards', () => {
    const single = makeInvoiceDeleteContext({ invoiceId: 7 });
    single.deleteInvoice(7);
    assert.match(single.modalHtml, /confirmDeleteInvoice\(7\)/);
    single.confirmDeleteInvoice(7);
    assert.equal(single.db.invoices.length, 0);
    assert.equal(single.db.products[0].stock, 6);
    assert.equal(single.db.stockHistory.length, 1);
    assert.equal(single.undoCount, 1);
    assert.equal(single.saveNowCount, 1);

    const bulk = makeInvoiceDeleteContext({ invoiceId: 7 });
    bulk.toggleAllInvoices({ checked: true });
    assert.deepEqual(plain([...bulk.selectedInvoices]), ['7']);
    bulk.confirmBulkDeleteInvoices();
    assert.equal(bulk.db.invoices.length, 0);
    assert.equal(bulk.db.products[0].stock, 6);
    assert.equal(bulk.undoCount, 1);
    assert.equal(bulk.saveNowCount, 1);

    const linked = makeInvoiceDeleteContext({ invoiceId: 7, returns: [{ id: 'RET-1', invoiceId: '7' }] });
    const before = plain(linked.db);
    linked.deleteInvoice(7);
    linked.selectedInvoices.add('7');
    linked.confirmBulkDeleteInvoices();
    assert.deepEqual(plain(linked.db), before);
    assert.equal(linked.undoCount, undefined);
    assert.equal(linked.saved, undefined);

    const textId = makeInvoiceDeleteContext({ invoiceId: 'INV-1' });
    textId.confirmDeleteInvoice('INV-1');
    assert.equal(textId.db.invoices.length, 0);
    assert.equal(textId.db.products[0].stock, 6);
});

test('history invoice deletions are durable before success UI and rollback on failure', () => {
    for (const operation of ['single', 'bulk']) {
        const failed = makeInvoiceDeleteContext({ invoiceId: 'INV-1' });
        failed.saveResult = false;
        if (operation === 'bulk') failed.selectedInvoices.add('INV-1');
        const before = plain(failed.db);
        operation === 'single' ? failed.confirmDeleteInvoice('INV-1') : failed.confirmBulkDeleteInvoices();
        assert.deepEqual(plain(failed.db), before);
        assert.deepEqual(plain(failed.undoStack), []);
        assert.equal(failed.closed, undefined);
        assert.equal(failed.saveNowCount, 1);
        assert.equal(operation === 'bulk' ? failed.selectedInvoices.has('INV-1') : failed.selectedInvoices.size === 0, true);

        const blocked = makeInvoiceDeleteContext({ invoiceId: 'INV-1' });
        blocked.saveBlockedReason = 'blocked';
        if (operation === 'bulk') blocked.selectedInvoices.add('INV-1');
        const beforeBlocked = plain(blocked.db);
        operation === 'single' ? blocked.confirmDeleteInvoice('INV-1') : blocked.confirmBulkDeleteInvoices();
        assert.deepEqual(plain(blocked.db), beforeBlocked);
        assert.equal(blocked.saveNowCount, undefined);
    }
});

function makeHistoryEditContext({ invoiceId = 7, returns = [], saveResult = true } = {}) {
    const fields = new Map([
        ['edit-inv-discount', { value: '0' }], ['edit-inv-cust', { value: '1' }], ['edit-inv-note', { value: 'Đã sửa' }]
    ]);
    const context = {
        db: {
            invoices: [{ id: invoiceId, cust: 'Khách lẻ', custId: null, items: [{ id: 10, name: 'A', qty: 1, price: 100000, lineTotal: 100000 }], subtotal: 100000, discount: 0, total: 100000 }],
            returns: plain(returns), products: [{ id: 10, name: 'A', stock: 10, cost: 50000 }], custs: [{ id: 1, name: 'Khách lẻ' }],
            stockHistory: [], activityLog: [], settings: { pointsEnabled: false, pointsRate: 1 }
        },
        currUser: { name: 'Admin' }, selectedInvoices: new Set(), undoStack: [],
        saveBlockedReason: '', saveBlockedToastShown: false, saveSuppressed: false, _saveInProgress: false,
        $: id => fields.get(id) || null, document: { body: { insertAdjacentHTML: (_where, html) => { context.openedModal = html; } } },
        toast: (message, type) => { (context.toasts ||= []).push({ message, type }); }, closeModal: () => { context.closed = true; },
        renderHist: () => { context.rendered = true; }, renderPos: () => {}, renderInventory: () => {},
        saveNow: () => { context.saveNowCount = (context.saveNowCount || 0) + 1; return saveResult; },
        logActivity: (action, detail) => context.db.activityLog.unshift({ action, detail }),
        getAppDate: () => new Date('2026-01-01T00:00:00Z'), money: value => String(value), formatQty: value => String(value), parseVN: value => Number(value) || 0,
        escapeHtml: value => String(value), escapeAttr: value => String(value)
    };
    createTestContext(context);
    vm.runInContext(between('function sameStoredId(', '\nfunction normalizeDataShape('), context);
    vm.runInContext(between('function hasLinkedReturn(', '\nfunction getInvoiceReturnedAmount('), context);
    vm.runInContext(between('function captureHistoryMutationSnapshot()', '\n// Direct checkout'), context);
    vm.runInContext(between('// EDIT INVOICE FEATURE', '\n// 2. EDIT PURCHASE ORDER'), context);
    return context;
}

function setEditedInvoiceItems(context, id = 7) {
    vm.runInContext(`editingInvoiceId = ${JSON.stringify(id)}; editingInvoiceItems = [{ id: 10, name: 'A', qty: 2, price: 100000, lineTotal: 200000 }];`, context);
}

test('history invoice editing supports numeric IDs, linked-return guards, and durable rollback', () => {
    const numeric = makeHistoryEditContext();
    setEditedInvoiceItems(numeric);
    numeric.saveEditInvoice();
    assert.equal(numeric.db.invoices[0].total, 200000);
    assert.equal(numeric.db.products[0].stock, 9);
    assert.equal(numeric.db.stockHistory.length, 1);
    assert.equal(numeric.db.activityLog.length, 1);
    assert.equal(numeric.saveNowCount, 1);
    assert.equal(numeric.closed, true);

    const linked = makeHistoryEditContext({ returns: [{ id: 'RET-1', invoiceId: '7' }] });
    linked.renderEditInvoiceItems = () => {};
    linked.recalcEditInvoice = () => {};
    linked.openEditInvoice(7);
    assert.equal(linked.openedModal, undefined);
    setEditedInvoiceItems(linked);
    const beforeLinked = plain(linked.db);
    linked.saveEditInvoice();
    assert.deepEqual(plain(linked.db), beforeLinked);
    assert.equal(linked.saveNowCount, undefined);

    const failed = makeHistoryEditContext({ invoiceId: 'INV-1', saveResult: false });
    setEditedInvoiceItems(failed, 'INV-1');
    const beforeFailed = plain(failed.db);
    failed.saveEditInvoice();
    assert.deepEqual(plain(failed.db), beforeFailed);
    assert.deepEqual(plain(failed.undoStack), []);
    assert.equal(failed.closed, undefined);
    assert.equal(failed.saveNowCount, 1);
    assert.equal(Boolean(failed.toasts?.some(toast => toast.type === 'success')), false);
});

test('return history surfaces share legacy display totals with the thermal slip', () => {
    const elements = new Map([
        ['returns-body', {}], ['returns-total-count', {}], ['returns-total-refund', {}], ['returns-total-collected', {}],
        ['returns-date-from', { value: '2026-01-01' }], ['returns-date-to', { value: '2026-01-01' }], ['returns-staff-search', { value: '' }],
        ['generic-modal-title', {}], ['generic-modal-content', {}]
    ]);
    const returns = [
        { id: 'RET-REFUND', date: '2026-01-01T08:00:00Z', cust: 'A', staff: 'Admin', refundAmount: 45000, returnItems: [{ name: 'A', qty: 1, price: 45000 }], exchangeItems: [] },
        { id: 'RET-COLLECT', date: '2026-01-01T09:00:00Z', cust: 'B', staff: 'Admin', returnItems: [{ name: 'B', qty: 1, price: 20000 }], exchangeItems: [{ name: 'C', qty: 1, price: 50000 }] },
        { id: 'RET-EXPLICIT', date: '2026-01-01T10:00:00Z', cust: 'C', staff: 'Admin', returnTotal: 50000, exchangeTotal: 20000, difference: 10000, returnItems: [], exchangeItems: [] }
    ];
    const context = {
        db: { returns: plain(returns), custs: [], settings: { name: 'Cửa hàng' } }, $: id => elements.get(id) || null,
        getAppDate: () => new Date('2026-01-01T12:00:00Z'), money: value => String(value), formatQty: value => String(value),
        getReturnItemTotal: undefined, escapeHtml: value => String(value), escapeAttr: value => String(value), escapeJsArgument: value => JSON.stringify(value),
        sameStoredId: (left, right) => String(left) === String(right), openModal: () => {}, selectedReturns: new Set(),
        updateBulkDeleteUI: () => {}, parseLocalDateInput: (value, end) => new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`)
    };
    createTestContext(context);
    vm.runInContext(between('function getReturnItemTotal(', '\nfunction captureReturnArrayState('), context);
    vm.runInContext(between('function getFilteredReturnsHistory()', '\n// Toggle returns row expansion'), context);
    vm.runInContext(between('function viewReturnDetail(', 'function printReturnSlip('), context);

    assert.deepEqual(plain(context.getReturnDisplayTotals(returns[0])), { returnTotal: 45000, exchangeTotal: 0, difference: 45000 });
    assert.deepEqual(plain(context.getReturnDisplayTotals(returns[1])), { returnTotal: 20000, exchangeTotal: 50000, difference: -30000 });
    assert.deepEqual(plain(context.getReturnDisplayTotals(returns[2])), { returnTotal: 50000, exchangeTotal: 20000, difference: 10000 });
    context.renderReturnsHistory();
    assert.equal(elements.get('returns-total-refund').innerText, '55000');
    assert.equal(elements.get('returns-total-collected').innerText, '30000');
    assert.match(elements.get('returns-body').innerHTML, /\+45000/);
    assert.match(elements.get('returns-body').innerHTML, /-30000/);
    assert.match(elements.get('returns-body').innerHTML, /money-cell/);
    context.viewReturnDetail('RET-COLLECT');
    assert.match(elements.get('generic-modal-content').innerHTML, /Khách trả thêm: 30000/);
    assert.match(context.buildReturnSlipHtml(returns[0]), /Tiền trả khách: 45.000/);
});

function makeQuickReturnContext(points) {
    const customer = { id: 9, name: 'Khách A', points };
    const context = {
        db: { products: [{ id: 10, name: 'A', stock: 5 }], returns: [], stockHistory: [], custs: [customer], settings: { pointsEnabled: true, pointsRate: 1 } },
        cust: customer, currUser: { name: 'Admin' }, qrReturnItems: [{ id: 10, name: 'A', price: 1000, qty: 1 }], qrExchangeItems: [],
        confirm: () => true, money: value => String(value), getReturnItemTotal: item => item.total ?? item.price * item.qty,
        getAppDate: () => new Date('2026-01-01T00:00:00Z'), toast: () => {}, logActivity: () => {},
        beginReturnCommit: () => ({}), saveReturnAndPreview: () => true,
        pushUndo: (_type, value) => { context.undo = value; }, UNDO_ACTIONS: { RETURN_GOODS: 'RETURN_GOODS' },
        renderPos: () => {}, renderHist: () => {}, renderReturnsHistory: () => {}, renderStockHistory: () => {},
        $: () => null, applyLinkedReturnCustomerEffects: () => false
    };
    createTestContext(context);
    vm.runInContext(between('function getReturnCustomerId(', '\nfunction toggleInvoiceSelect('), context);
    vm.runInContext(between('// Process the Quick Return/Exchange transaction', '\n// Process Quick Return - return items'), context);
    return context;
}

test('quick return exchange stores the applied point reversal so Undo is exact', () => {
    for (const initialPoints of [100, 5]) {
        const context = makeQuickReturnContext(initialPoints);
        context.processQuickReturnExchange();
        const returnRecord = context.undo.returnRecord;
        assert.equal(returnRecord.pointsReversed, Math.min(initialPoints, 10));
        assert.equal(context.db.custs[0].points, initialPoints - returnRecord.pointsReversed);
        context.restoreCustomerPointsAfterUndoReturn(returnRecord);
        assert.equal(context.db.custs[0].points, initialPoints);
    }
});

test('recovery rewrite disables backup rotation while normal saves retain it', () => {
    const context = {
        saveSuppressed: false, saveBlockedReason: '', saveBlockedToastShown: false, _saveInProgress: false, _savePending: false,
        db: { users: [] }, JSON, localStorage: { setItem: () => {} },
        hasDesktopStorage: () => true,
        desktop: { data: { save: (_text, options) => { context.writeOptions.push(options); return { ok: true }; } } },
        toast: () => {}, console: { error: () => {}, warn: () => {} }
    };
    context.writeOptions = [];
    createTestContext(context);
    vm.runInContext(between('function _saveNow(', '\nfunction save()'), context);
    assert.equal(context._saveNow({ keepBak: false }), true);
    assert.equal(context._saveNow(), true);
    assert.deepEqual(plain(context.writeOptions), [{ keepBak: false }, { keepBak: true }]);
});

test('a failed recovery rewrite blocks later startup writes without replacing the backup', async () => {
    const recovered = { settings: { autoBackup: true, theme: 'light', uiSize: 'medium' }, custs: [], invoices: [], purchaseOrders: [], stockHistory: [], returns: [] };
    const context = {
        ipcRenderer: null, fs: {}, DATA_PATH: '/tmp/data.json', defaultData: { custs: [] },
        loadPersistedData: () => ({ data: recovered, source: 'data-bak', recoveredFrom: '/tmp/data.json.bak', needsPrimaryRewrite: true, saveBlocked: false, errors: [] }),
        saveNow: options => { context.saveOptions = options; return false; },
        updateAuthPanel: () => {}, shouldBackupNow: () => true, performBackup: () => { context.backedUp = true; }, setupAutoBackup: () => {},
        applyTheme: () => {}, applyUISize: () => {}, renderNav: () => {}, setupGlobalShortcuts: () => {}, setupEnterKeyHandlers: () => {},
        setupDropdownKeyboardNav: () => {}, setupPOSKeyboardNav: () => {}, setupClickOutsideToClearSelection: () => {}, applyViewMode: () => {}, initPosResizer: () => {},
        populateYearOptions: () => {}, isLoginDisabled: () => false, showLoginModal: () => {}, console: { warn: () => {}, error: () => {} }
    };
    createTestContext(context);
    vm.runInContext(between('async function initDataPath()', 'function populateYearOptions()'), context);
    await context.init();
    assert.deepEqual(plain(context.saveOptions), { keepBak: false });
    assert.match(context.saveBlockedReason, /Không thể ghi lại dữ liệu đã phục hồi/);
    assert.equal(context.backedUp, undefined);
});

function makeProcessReturnContext({ invoiceId, invoiceQty, returnQty }) {
    const fields = new Map([
        ['return-reason', { value: 'other' }],
        ['return-note', { value: '' }],
        ['return-item-10', { checked: false }],
        ['return-qty-10', { value: String(returnQty), max: String(invoiceQty) }]
    ]);
    const invoice = { id: invoiceId, cust: 'Khách A', custId: 9, items: [{ id: 10, name: 'A', price: 100, qty: invoiceQty, unit: 'SP' }] };
    const context = {
        db: { invoices: [plain(invoice)], products: [{ id: 10, name: 'A', stock: 5 }], stockHistory: [], returns: [], activityLog: [] },
        currentReturnInvoice: plain(invoice), exchangeItems: [], currUser: { name: 'Admin' },
        confirm: () => true, money: value => String(value), getAppDate: () => new Date('2026-01-01T00:00:00Z'),
        toast: () => {}, logActivity: (action, detail) => context.logs.push({ action, detail }), applyLinkedReturnCustomerEffects: () => {},
        pushUndo: (_type, data) => { context.undo = data; }, beginReturnCommit: () => ({}), saveReturnAndPreview: returnId => {
            context.previewId = returnId;
            context.returnExistedBeforePreview = context.db.returns.some(r => r.id === returnId);
        },
        UNDO_ACTIONS: { RETURN_GOODS: 'RETURN_GOODS' }, logs: [],
        closeModal: () => {}, renderPos: () => {}, renderHist: () => {}, renderManagement: () => {}, renderDashboard: () => {},
        renderStaffView: () => {}, renderReturnsHistory: () => {}, renderStockHistory: () => {},
        $: id => fields.get(id) || null
    };
    createTestContext(context);
    vm.runInContext(between('function processReturn()', '\n// HISTORY & REPORTS'), context);
    return context;
}

test('returns from numeric legacy invoices complete for partial and full returns', () => {
    for (const scenario of [
        { invoiceQty: 2, returnQty: 1, invoicesAfter: 1 },
        { invoiceQty: 1, returnQty: 1, invoicesAfter: 0 }
    ]) {
        const context = makeProcessReturnContext({ invoiceId: 7, ...scenario });
        assert.doesNotThrow(() => context.processReturn());
        assert.equal(context.db.returns.length, 1);
        assert.equal(context.db.products[0].stock, 5 + scenario.returnQty);
        assert.equal(context.db.stockHistory.length, 1);
        assert.equal(context.db.invoices.length, scenario.invoicesAfter);
        assert.ok(context.undo);
        assert.ok(context.previewId);
        assert.equal(context.returnExistedBeforePreview, true);
        assert.ok(context.logs.every(entry => !entry.detail.includes('undefined')));
        if (scenario.invoicesAfter === 0) {
            assert.equal(context.db.returns[0].deletedInvoice.id, 7);
            assert.equal(context.undo.deletedInvoice.id, 7);
        }
    }
});

function makeReturnPrintContext({ print } = {}) {
    const buttons = {};
    const iframeDoc = {
        open: () => {}, write: html => { iframeDoc.html = html; }, close: () => {},
        getElementById: id => buttons[id] || (buttons[id] = {})
    };
    const iframe = { id: '', style: {}, contentDocument: iframeDoc, contentWindow: { print } };
    const context = {
        db: { returns: [{ id: 7, date: '2026-01-01T00:00:00Z', cust: 'Khách A', returnItems: [], exchangeItems: [], difference: 0 }], settings: {} },
        document: { getElementById: id => id === 'return-slip-print-iframe' && context.iframe, createElement: () => iframe, body: { appendChild: value => { context.iframe = value; } } },
        sameStoredId: (left, right) => left !== undefined && left !== null && right !== undefined && right !== null && String(left) === String(right),
        escapeHtml: value => String(value), buildReturnSlipHtml: () => '<div>receipt</div>', setTimeout: callback => callback(),
        toast: (message, type) => { context.toasts.push({ message, type }); }, console: { error: () => { context.printErrors++; } },
        toasts: [], printErrors: 0
    };
    createTestContext(context);
    vm.runInContext(between('function printReturnSlip(', '\n// Toggle invoice row expansion in history'), context);
    return { context, iframeDoc, buttons, iframe };
}

test('return-slip reprint accepts a numeric legacy return ID from a history dataset', () => {
    const { context, iframeDoc, buttons } = makeReturnPrintContext({ print: () => { context.printed = (context.printed || 0) + 1; } });
    context.printReturnSlip('7');
    assert.match(iframeDoc.html, /Phiếu trả #7/);
    assert.deepEqual(plain(context.toasts), []);
    buttons['print-btn'].onclick();
    assert.equal(context.printed, 1);
});

test('return-slip screen preview matches the sale preview card without changing print or sale output', () => {
    const { context, iframeDoc } = makeReturnPrintContext({ print: () => {} });
    context.printReturnSlip(7);
    assert.match(iframeDoc.html, /🧾 Hóa đơn đổi\/trả #7 - Khách A/);
    assert.match(iframeDoc.html, /\.btn-print \{ background: #10B981; color: white; \}/);
    assert.match(iframeDoc.html, /\.btn-close \{ background: #EF4444; color: white; \}/);
    assert.match(iframeDoc.html, /@media screen[\s\S]*?background: #f5f5f5[\s\S]*?width: 72mm[\s\S]*?border-radius: 4px[\s\S]*?box-shadow: 0 2px 10px rgba\(0,0,0,0\.1\)/);
    assert.match(iframeDoc.html, /@page \{ size: 72mm auto; margin: 0; \}/);
    assert.match(iframeDoc.html, /@media print[\s\S]*?background: transparent !important;[\s\S]*?border-radius: 0;[\s\S]*?box-shadow: none;/);
    const invoicePreview = between('function printInv(inv)', '\n// Alias for keyboard shortcuts');
    assert.equal(crypto.createHash('sha256').update(invoicePreview).digest('hex'), '74cea084a1f4ec7f31219724c0e34499357c1ee8eddcdcc9dddc614b975e0926');
});

test('return-slip print failures are handled without closing the preview or mutating data', () => {
    for (const print of [undefined, () => { throw new Error('print unavailable'); }]) {
        const { context, buttons, iframe } = makeReturnPrintContext({ print });
        const before = plain(context.db);
        context.printReturnSlip(7);
        iframe.style.display = 'block';
        assert.doesNotThrow(() => buttons['print-btn'].onclick());
        assert.deepEqual(plain(context.db), before);
        assert.equal(iframe.style.display, 'block');
        assert.deepEqual(plain(context.toasts), [{ message: 'Không thể gửi lệnh in!', type: 'error' }]);
        assert.equal(context.printErrors, 1);
    }
});

function makeReturnCommitContext({ saveResult = true, saveBlockedReason = '', saveSuppressed = false, saveInProgress = false } = {}) {
    const product = { id: 10, stock: 5 };
    const customer = { id: 9, points: 20, totalBuy: 1000, debt: 0 };
    const invoice = { id: 'INV-1' };
    const context = {
        db: { products: [product], custs: [customer], invoices: [invoice], returns: [], stockHistory: [], activityLog: [] },
        undoStack: [{ type: 'EXISTING' }], saveBlockedReason, saveBlockedToastShown: false,
        saveSuppressed, _saveInProgress: saveInProgress, saveNow: () => { context.saveCalls++; return saveResult; },
        setTimeout: callback => callback(), printReturnSlip: id => { context.previewId = id; },
        toast: (message, type) => { context.toasts.push({ message, type }); }, saveCalls: 0, toasts: []
    };
    createTestContext(context);
    vm.runInContext(between('function captureReturnArrayState(', '\nfunction backToReturnList('), context);
    return context;
}

test('return commit rolls back every mutated linked collection when durable save fails', () => {
    const context = makeReturnCommitContext({ saveResult: false });
    const beforeDb = plain(context.db);
    const beforeUndo = plain(context.undoStack);
    const snapshot = context.beginReturnCommit();

    context.db.products[0].stock = 6;
    context.db.custs[0].points = 10;
    context.db.custs[0].totalBuy = 900;
    context.db.custs[0].debt = 100;
    context.db.stockHistory.unshift({ id: 'STOCK-1' });
    context.db.returns.unshift({ id: 'RET-1' });
    context.db.invoices = [];
    context.db.activityLog.unshift({ type: 'return' });
    context.undoStack.push({ type: 'RETURN_GOODS' });

    assert.equal(context.saveReturnAndPreview('RET-1', snapshot), false);
    assert.deepEqual(plain(context.db), beforeDb);
    assert.deepEqual(plain(context.undoStack), beforeUndo);
    assert.equal(context.previewId, undefined);
    assert.equal(context.saveCalls, 1);
});

test('return commit previews only after a durable save and rejects unavailable persistence before mutation', () => {
    const saved = makeReturnCommitContext({ saveResult: true });
    const snapshot = saved.beginReturnCommit();
    saved.db.returns.unshift({ id: 'RET-1' });
    assert.equal(saved.saveReturnAndPreview('RET-1', snapshot), true);
    assert.equal(saved.previewId, 'RET-1');
    assert.equal(saved.saveCalls, 1);

    for (const options of [
        { saveBlockedReason: 'recovery failed' },
        { saveSuppressed: true },
        { saveInProgress: true }
    ]) {
        const blocked = makeReturnCommitContext(options);
        const before = plain(blocked.db);
        assert.equal(blocked.beginReturnCommit(), null);
        assert.deepEqual(plain(blocked.db), before);
        assert.equal(blocked.saveCalls, 0);
    }
});

function makeDeleteReturnContext({ saveResult = true, confirmResult = true, missingProduct = false, legacy = false } = {}) {
    const returnRecord = {
        id: 100,
        invoiceId: 'INV-2',
        custId: '9',
        returnItems: [{ id: '101', name: 'Hàng trả', qty: 2 }],
        exchangeItems: [{ id: '102', name: 'Hàng đổi', qty: 2 }],
        deletedInvoice: legacy ? undefined : { id: 'INV-2', total: 400, items: [{ id: '101', qty: 2 }] },
        customerEffects: legacy ? undefined : { customerId: 9, pointsDelta: -5, totalBuyDelta: -400 }
    };
    const context = {
        db: {
            products: missingProduct ? [{ id: 101, name: 'Hàng trả', stock: 12 }] : [{ id: 101, name: 'Hàng trả', stock: 12 }, { id: 102, name: 'Hàng đổi', stock: 3 }],
            custs: [{ id: 9, points: 5, totalBuy: 600, debt: 0 }], invoices: [], returns: [returnRecord],
            stockHistory: [
                { source: 'return', note: 'Trả hàng - Phiếu 100' },
                { source: 'exchange', note: 'Đổi hàng - Phiếu 100' },
                { note: 'Dữ liệu cũ - Phiếu 100' },
                { source: 'return', note: 'Trả hàng - Phiếu 1000' },
                { source: 'purchase_order', note: 'Nhập hàng - Phiếu 100' },
                { source: 'return', note: 'Trả hàng - Phiếu 100 bổ sung' }
            ], activityLog: [], settings: { pointsEnabled: true, pointsRate: 1 }
        },
        undoStack: [
            { type: 'RETURN_GOODS', data: { returnRecord: { id: '100' } } },
            { type: 'RETURN_GOODS', data: { id: 100 } },
            { type: 'OTHER', data: { id: 100 } }
        ],
        selectedReturns: new Set(),
        confirm: message => { context.confirmMessage = message; return confirmResult; },
        toast: (message, type) => context.toasts.push({ message, type }), toasts: [],
        saveNow: () => { context.saveCalls++; return saveResult; }, saveCalls: 0,
        logActivity: (action, detail) => context.db.activityLog.unshift({ action, detail }),
        renderPos: () => context.rendered.push('pos'), renderInventory: () => context.rendered.push('inventory'),
        renderStockHistory: () => context.rendered.push('stock'), renderHist: () => context.rendered.push('history'),
        renderReturnsHistory: () => context.rendered.push('returns'), renderManagement: () => context.rendered.push('management'),
        renderDashboard: () => context.rendered.push('dashboard'), renderStaffView: () => context.rendered.push('staff'), rendered: [],
        UNDO_ACTIONS: { RETURN_GOODS: 'RETURN_GOODS' }, saveBlockedReason: '', saveBlockedToastShown: false,
        saveSuppressed: false, _saveInProgress: false, money: value => String(value),
        getReturnItemTotal: item => (Number(item.price) || 0) * (Number(item.qty) || 0),
        sameStoredId: (left, right) => String(left) === String(right)
    };
    createTestContext(context);
    vm.runInContext(between('function getReturnFinancialTotals(', '\nfunction toggleInvoiceSelect('), context);
    vm.runInContext(between('function captureReturnArrayState(', '\nfunction backToReturnList('), context);
    return context;
}

test('deleting a return reverses only its linked records and restores its full-return invoice', () => {
    const context = makeDeleteReturnContext();
    context.deleteReturn('100');

    assert.equal(context.db.returns.length, 0);
    assert.deepEqual(plain(context.db.products.map(product => product.stock)), [10, 5]);
    assert.deepEqual(plain(context.db.custs[0]), { id: 9, points: 10, totalBuy: 1000, debt: 0 });
    assert.deepEqual(plain(context.db.invoices.map(invoice => invoice.id)), ['INV-2']);
    assert.deepEqual(plain(context.db.stockHistory.map(entry => entry.note)), ['Trả hàng - Phiếu 1000', 'Nhập hàng - Phiếu 100', 'Trả hàng - Phiếu 100 bổ sung']);
    assert.deepEqual(plain(context.undoStack), [{ type: 'OTHER', data: { id: 100 } }]);
    assert.equal(context.saveCalls, 1);
    assert.deepEqual(context.rendered, ['pos', 'inventory', 'stock', 'history', 'returns', 'management', 'dashboard', 'staff']);
    assert.equal(context.toasts.at(-1).type, 'success');
});

test('return deletion preserves state when canceled, incomplete, or not durable, and warns for legacy effects', () => {
    const canceled = makeDeleteReturnContext({ confirmResult: false });
    const beforeCanceled = plain(canceled.db);
    canceled.deleteReturn(100);
    assert.deepEqual(plain(canceled.db), beforeCanceled);
    assert.equal(canceled.saveCalls, 0);

    const incomplete = makeDeleteReturnContext({ missingProduct: true });
    const beforeIncomplete = plain(incomplete.db);
    incomplete.deleteReturn(100);
    assert.deepEqual(plain(incomplete.db), beforeIncomplete);
    assert.equal(incomplete.confirmMessage, undefined);

    const failed = makeDeleteReturnContext({ saveResult: false });
    const beforeFailed = plain(failed.db);
    const beforeUndo = plain(failed.undoStack);
    failed.deleteReturn(100);
    assert.deepEqual(plain(failed.db), beforeFailed);
    assert.deepEqual(plain(failed.undoStack), beforeUndo);
    assert.deepEqual(failed.rendered, []);

    const legacy = makeDeleteReturnContext({ legacy: true });
    legacy.deleteReturn(100);
    assert.match(legacy.confirmMessage, /công thức legacy/);
    assert.equal(legacy.db.invoices.length, 0);
});

test('history header owns each tab toolbar while returns reuses sales controls, cards, table wrapping, and money cells', () => {
    const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
    const headerStart = html.indexOf('id="history-header-tools"');
    const tabsStart = html.indexOf('class="products-tabs mb-2"', headerStart);
    assert.ok(headerStart > -1 && headerStart < tabsStart);
    assert.match(html, /data-history-tools="sales"/);
    assert.match(html, /data-history-tools="returns" style="display:none"/);
    assert.equal((html.match(/id="hist-staff-search"/g) || []).length, 1);
    assert.equal((html.match(/id="returns-staff-search"/g) || []).length, 1);
    assert.equal((html.match(/id="hist-date-filter-dropdown"/g) || []).length, 1);
    assert.equal((html.match(/id="returns-date-filter-dropdown"/g) || []).length, 1);
    assert.match(html, /history-tab-sales/);
    assert.match(html, /history-tab-returns/);
    assert.doesNotMatch(html, /Xem lịch sử trả hàng|returns-section|returns-history-view/);
    assert.match(html, /returns-staff-search/);
    assert.match(html, /returns-date-filter-dropdown/);
    assert.match(html, /exportReturnsHistoryExcel\(\)/);
    assert.match(html, /exportReturnsHistoryPDF\(\)/);
    assert.match(html, /bulk-delete-returns-btn/);
    assert.match(html, /<div class="table-wrap">\s*<table>\s*<thead>\s*<tr>\s*<th style="width:40px;text-align:center;">\s*<input type="checkbox"\s*id="select-all-returns"/);
    assert.doesNotMatch(html, /<input type="date" id="returns-date-/);
    assert.doesNotMatch(source, /function renderReturns\(|function renderReturnsSection\(|function toggleReturnsSection\(/);
    assert.match(source, /<td class="money-cell" style="font-weight:700;color:var\(--primary\)">\$\{money\(i\.total\)\}/);
    assert.match(source, /<td class="money-cell" style="font-weight:500;color:var\(--primary\);">\$\{money\(itemLineTotal\)\}/);
    assert.match(source, /function toggleAllReturns\(checkbox\)/);
    assert.match(source, /function deleteSelectedReturns\(\)/);
    assert.match(source, /function deleteReturnRecords\(records, activityAction, activityDetail, successMessage\)/);
    assert.match(source, /document\.querySelectorAll\('#history-header-tools \[data-history-tools\]'\)\.forEach\(toolbar => \{\s*toolbar\.style\.display = toolbar\.dataset\.historyTools === currentHistoryTab \? '' : 'none';/);
});

test('return-history export follows staff and date filters while batch deletion is one durable rollback-safe commit', () => {
    const exportFields = new Map([
        ['returns-staff-search', { value: 'admin' }], ['returns-date-from', { value: '2026-01-01' }], ['returns-date-to', { value: '2026-01-01' }]
    ]);
    const exportContext = {
        db: { returns: [
            { id: 100, date: '2026-01-01T08:00:00Z', cust: 'A', staff: 'Admin', refundAmount: 100, returnItems: [], exchangeItems: [] },
            { id: '200', date: '2026-01-02T08:00:00Z', cust: 'B', staff: 'Admin', refundAmount: 200, returnItems: [], exchangeItems: [] },
            { id: 300, date: '2026-01-01T08:00:00Z', cust: 'C', staff: 'Thu ngân', refundAmount: 300, returnItems: [], exchangeItems: [] }
        ] },
        $: id => exportFields.get(id) || null, getAppDate: () => new Date('2026-01-01T12:00:00Z'),
        parseLocalDateInput: (value, end) => new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`),
        getReturnItemTotal: undefined, exportToExcel: (data, headers, filename) => { exportContext.exported = { data, headers, filename }; }
    };
    createTestContext(exportContext);
    vm.runInContext(between('function getReturnItemTotal(', '\nfunction captureReturnArrayState('), exportContext);
    vm.runInContext(between('function getFilteredReturnsHistory()', '\n// Toggle returns row expansion'), exportContext);
    vm.runInContext(between('function exportReturnsHistoryExcel()', '\nfunction exportProductsExcel('), exportContext);
    exportContext.exportReturnsHistoryExcel();
    assert.equal(exportContext.exported.data.length, 1);
    assert.deepEqual(plain([exportContext.exported.data[0][0], exportContext.exported.data[0][2], ...exportContext.exported.data[0].slice(3)]), ['#100', 'A', 0, 0, 100, 0, 100, 'Admin']);
    assert.deepEqual(plain(exportContext.exported.headers.slice(0, 3)), ['Mã phiếu', 'Thời gian', 'Khách hàng']);
    assert.equal(exportContext.exported.filename, 'LichSuDoiTra');

    const committed = makeDeleteReturnContext();
    const second = { id: '200', returnItems: [{ id: 101, name: 'Hàng trả', qty: 1 }], exchangeItems: [], customerEffects: { customerId: 9, pointsDelta: 0, totalBuyDelta: 0 } };
    committed.db.returns.push(second);
    committed.db.stockHistory.push({ source: 'return', note: 'Trả hàng - Phiếu 200' });
    committed.selectedReturns.add('100');
    committed.selectedReturns.add(200);
    assert.equal(committed.deleteReturnRecords([committed.db.returns[0], second], 'Xóa phiếu đổi/trả hàng loạt', '2 phiếu đổi/trả', 'Đã xóa 2 phiếu đổi/trả và khôi phục dữ liệu liên quan.'), true);
    assert.equal(committed.saveCalls, 1);
    assert.equal(committed.db.returns.length, 0);
    assert.deepEqual(plain(committed.db.products.map(product => product.stock)), [9, 5]);
    assert.equal(committed.selectedReturns.size, 0);

    const failed = makeDeleteReturnContext({ saveResult: false });
    const before = plain(failed.db);
    failed.selectedReturns.add('100');
    assert.equal(failed.deleteReturnRecords([failed.db.returns[0]], 'Xóa phiếu đổi/trả hàng loạt', '1 phiếu đổi/trả', 'Không được hiển thị'), false);
    assert.deepEqual(plain(failed.db), before);
    assert.deepEqual(plain([...failed.selectedReturns]), ['100']);
});

test('all return entry points stop after the shared commit guard fails', () => {
    for (const name of [
        'checkoutReturn', 'checkoutReturnExchange', 'processQuickReturnExchange', 'processQuickReturn', 'processReturn'
    ]) {
        const start = source.indexOf(`function ${name}(`);
        const end = source.indexOf('\nfunction ', start + 1);
        const body = source.slice(start, end === -1 ? source.length : end);
        assert.match(body, /const returnCommit = beginReturnCommit\(\);\s*if \(!returnCommit\) return;/);
        assert.match(body, /if \(!saveReturnAndPreview\(returnRecord\.id, returnCommit\)\) return;/);
    }
});

function makeSaleCheckoutContext({ saveResult = true, saveBlockedReason = '', saveSuppressed = false, saveInProgress = false, autoPrint = true } = {}) {
    const product = { id: 10, name: 'Cà phê', price: 10000, stock: 5 };
    const customer = { id: 9, name: 'Khách thân thiết', points: 20, totalBuy: 1000, debt: 0 };
    const cartItem = { ...product, qty: 1 };
    const elements = new Map();
    const addElement = (id, value = '') => {
        const element = { value, innerText: '', checked: false, disabled: false, max: '', style: { display: '' } };
        elements.set(id, element);
        return element;
    };
    [
        'cart-cust', 'cart-discount', 'discount-type', 'cart-customer-give', 'cart-change', 'cart-pay-method',
        'cart-use-points', 'cart-points-input', 'cart-points-row', 'cart-points-available',
        'pay-method', 'pay-give', 'pay-change', 'use-points', 'points-input', 'order-note', 'pos-search', 'pos-cat'
    ].forEach(id => addElement(id));
    elements.get('cart-cust').value = customer.name;
    elements.get('cart-pay-method').value = 'CASH';
    elements.get('pay-method').value = 'CASH';
    elements.get('cart-customer-give').value = '10.000';
    elements.get('pay-give').value = '10.000';
    elements.get('order-note').value = 'Giữ nguyên';

    const tab = {
        id: 1, name: 'Đơn 1', cart: [{ ...cartItem }], cust: { ...customer }, discount: 0, discountType: 'amount',
        returnItems: [], exchangeItems: [], isReturnExchangeMode: false, activeReturnCart: 'return'
    };
    const context = {
        db: {
            products: [product], custs: [customer], invoices: [], returns: [], stockHistory: [], activityLog: [],
            settings: { pointsEnabled: true, pointsRate: 1, autoPrint }
        },
        cart: [{ ...cartItem }], cust: customer, invoiceTabs: [tab], activeTabId: 1,
        returnItems: [], exchangeItems: [], isReturnExchangeMode: false, activeReturnCart: 'return', undoStack: [],
        saveBlockedReason, saveBlockedToastShown: false, saveSuppressed, _saveInProgress: saveInProgress,
        window: { orderNote: 'Giữ nguyên' }, currUser: { name: 'Admin' },
        $: id => elements.get(id) || null,
        toast: (message, type) => { context.toasts.push({ message, type }); }, toasts: [], saveCalls: 0,
        saveNow: () => { context.saveCalls++; return saveResult; },
        validateCartItems: () => true,
        syncCustomerFromInput: () => {
            context.cust = context.db.custs[0];
            const active = context.invoiceTabs[0];
            active.cust = { ...context.cust };
        },
        getEffectivePrice: item => ({ price: item.price, type: 'retail' }),
        getCartPointsUsage: () => ({ pointsUsed: 0, pointsValue: 0 }),
        getAppDate: () => new Date('2026-01-01T00:00:00Z'), getStaffDisplayName: () => 'Admin',
        money: value => String(value), logActivity: (action, detail) => context.db.activityLog.unshift({ action, detail }),
        printInv: () => { context.printCalls++; }, printCalls: 0,
        playSuccessSound: () => { context.soundCalls++; }, soundCalls: 0,
        clearToastHistory: () => { context.clearCalls++; }, clearCalls: 0,
        saveCurrentTabState: () => {
            const active = context.invoiceTabs.find(item => item.id === context.activeTabId);
            active.cart = context.cart.map(item => ({ ...item }));
            active.cust = context.cust ? { ...context.cust } : null;
        },
        renderCart: () => { context.renderCartCalls++; }, renderCartCalls: 0,
        renderPos: () => { context.renderPosCalls++; }, renderPosCalls: 0,
        closeModal: () => { context.closeCalls++; }, closeCalls: 0,
        checkoutReturnExchange: () => { throw new Error('unexpected return flow'); },
        checkoutReturn: () => { throw new Error('unexpected return flow'); }, isReturnMode: () => false
    };
    createTestContext(context);
    vm.runInContext(between('function captureReturnArrayState(', '\nfunction backToReturnList('), context);
    vm.runInContext(between('function captureSaleFieldState(', '\n// Direct checkout'), context);
    vm.runInContext(between('function directCheckout()', '\nfunction modQty('), context);
    vm.runInContext(between('function finishOrder()', '\nfunction printInv('), context);
    return { context, elements };
}

test('both sale checkouts rollback all linked state when durable save fails', () => {
    for (const flow of ['directCheckout', 'finishOrder']) {
        const { context, elements } = makeSaleCheckoutContext({ saveResult: false });
        const beforeDb = plain(context.db);
        const beforeCart = plain(context.cart);
        const beforeTab = plain(context.invoiceTabs);
        const beforeFields = plain([...elements.entries()].map(([id, element]) => [id, element]));

        context[flow]();

        assert.deepEqual(plain(context.db), beforeDb, `${flow} must rollback database changes`);
        assert.deepEqual(plain(context.cart), beforeCart, `${flow} must keep the cart`);
        assert.deepEqual(plain(context.invoiceTabs), beforeTab, `${flow} must keep the active tab`);
        assert.deepEqual(plain([...elements.entries()].map(([id, element]) => [id, element])), beforeFields, `${flow} must keep form fields`);
        assert.equal(context.saveCalls, 1);
        assert.equal(context.printCalls, 0);
        assert.equal(context.soundCalls, 0);
        assert.equal(context.clearCalls, 0);
        assert.equal(context.closeCalls, 0);
        assert.equal(context.toasts.some(({ message }) => message === 'Thanh toán thành công!'), false);
    }
});

test('both sale checkouts reject unavailable persistence before any mutation', () => {
    for (const flow of ['directCheckout', 'finishOrder']) {
        for (const options of [
            { saveBlockedReason: 'recovery failed' }, { saveSuppressed: true }, { saveInProgress: true }
        ]) {
            const { context } = makeSaleCheckoutContext(options);
            const beforeDb = plain(context.db);
            const beforeCart = plain(context.cart);
            context[flow]();
            assert.deepEqual(plain(context.db), beforeDb, `${flow} must not mutate when unavailable`);
            assert.deepEqual(plain(context.cart), beforeCart, `${flow} must keep the cart when unavailable`);
            assert.equal(context.saveCalls, 0);
            assert.equal(context.printCalls, 0);
        }
    }
});

test('both sale checkouts clean up and print only after a successful durable save', () => {
    for (const flow of ['directCheckout', 'finishOrder']) {
        const { context } = makeSaleCheckoutContext({ saveResult: true });
        context[flow]();
        assert.equal(context.saveCalls, 1);
        assert.equal(context.db.invoices.length, 1);
        assert.equal(context.db.stockHistory.length, 1);
        assert.equal(context.db.products[0].stock, 4);
        assert.equal(context.db.custs[0].totalBuy, 11000);
        assert.equal(context.db.custs[0].points, 120);
        assert.equal(context.cart.length, 0);
        assert.equal(context.printCalls, 1);
        assert.equal(context.soundCalls, 1);
        assert.equal(context.toasts.some(({ message }) => message === 'Thanh toán thành công!'), true);
    }

    const noPrint = makeSaleCheckoutContext({ saveResult: true, autoPrint: false }).context;
    noPrint.directCheckout();
    assert.equal(noPrint.db.invoices.length, 1);
    assert.equal(noPrint.printCalls, 0);
});

function makeScannerPopupContext({ stock = 5, cartItems = [] } = {}) {
    const input = { value: '1', max: 'legacy-max', focus: () => {}, removeAttribute: name => { delete input[name]; } };
    const elements = new Map([
        ['pos-search', { value: '', focus: () => {}, select: () => {} }],
        ['scanned-product-img', { innerHTML: '' }], ['scanned-product-name', { textContent: '' }],
        ['scanned-product-code', { textContent: '' }], ['scanned-product-price', { textContent: '' }],
        ['scanned-product-stock', { textContent: '' }], ['scanned-product-qty', input],
        ['scanned-product-modal', { classList: { add: () => {} } }]
    ]);
    const context = {
        db: { products: [{ id: 10, name: 'Cà phê', code: 'CF10', price: 10000, stock }], settings: {} },
        cart: plain(cartItems), safeImageSrc: () => '', escapeAttr: value => String(value), money: value => String(value),
        $: id => elements.get(id) || null, toast: (message, type) => context.toasts.push({ message, type }), toasts: [],
        renderCart: () => { context.renderCalls++; }, renderCalls: 0,
        closeModal: id => { context.closed = id; }, setTimeout: callback => callback(),
        addCart: () => { context.autoAddCalls++; }, autoAddCalls: 0, renderPos: () => {}
    };
    createTestContext(context);
    vm.runInContext(
        `let scannedProduct = null; let lastInputTime = 0; let inputBuffer = '';\n${between('function handleBarcodeInput(', '\n// Override the handleSearch')}\n${between('function showScannedProductPopup(', '\n// ========== LABEL PRINTING')}`,
        context
    );
    return { context, input, product: context.db.products[0] };
}

test('scanner popup follows the existing negative-stock sale policy', () => {
    const zeroStock = makeScannerPopupContext({ stock: 0 });
    zeroStock.context.showScannedProductPopup(zeroStock.product);
    assert.equal('max' in zeroStock.input, false);
    zeroStock.context.modifyScannedQty(2);
    assert.equal(zeroStock.input.value, 3);
    zeroStock.context.addScannedToCart();
    assert.equal(zeroStock.context.cart[0].qty, 3);
    assert.equal(zeroStock.context.toasts.some(({ type }) => type === 'error'), false);
    assert.equal(zeroStock.context.toasts.some(({ message }) => message.startsWith('⚠️ Bán âm kho:')), true);

    const overStock = makeScannerPopupContext({ stock: 3, cartItems: [{ id: 10, name: 'Cà phê', qty: 2 }] });
    overStock.context.showScannedProductPopup(overStock.product);
    overStock.input.value = '2';
    overStock.context.addScannedToCart();
    assert.equal(overStock.context.cart.length, 1);
    assert.equal(overStock.context.cart[0].qty, 4);
    assert.equal(overStock.context.toasts.some(({ message }) => message.startsWith('⚠️ Vượt tồn kho:')), true);
});

test('scanner popup keeps normal quantities and existing scanner routing intact', () => {
    const scanner = makeScannerPopupContext({ stock: 5 });
    scanner.context.showScannedProductPopup(scanner.product);
    scanner.input.value = 'invalid';
    scanner.context.addScannedToCart();
    assert.equal(scanner.context.cart[0].qty, 1);
    assert.equal(scanner.context.toasts.some(({ type }) => type === 'warning'), false);

    const negativeQty = makeScannerPopupContext({ stock: 5 });
    negativeQty.context.showScannedProductPopup(negativeQty.product);
    negativeQty.input.value = '-3';
    negativeQty.context.addScannedToCart();
    assert.equal(negativeQty.context.cart[0].qty, 1);

    const search = scanner.context.$('pos-search');
    scanner.context.db.settings = { scannerAutoAdd: true, scannerPopup: true };
    search.value = 'CF10';
    scanner.context.handleBarcodeInput({ key: 'Enter', preventDefault: () => {} });
    assert.equal(scanner.context.autoAddCalls, 1);

    scanner.context.db.settings = { scannerAutoAdd: false, scannerPopup: true };
    search.value = 'CF10';
    scanner.context.handleBarcodeInput({ key: 'Enter', preventDefault: () => {} });
    assert.equal(scanner.context.$('scanned-product-qty').value, 1);

    scanner.context.db.settings = { scannerAutoAdd: false, scannerPopup: false };
    search.value = 'CF10';
    scanner.context.handleBarcodeInput({ key: 'Enter', preventDefault: () => {} });
    assert.equal(scanner.context.autoAddCalls, 1);
    assert.equal(scanner.context.toasts.some(({ message }) => message.startsWith('Tìm thấy:')), true);
});

test('numeric legacy IDs work in return selection, detail, Undo, and history export', () => {
    const selection = {
        input: { value: '' }, searchCalls: 0,
        $: id => id === 'return-invoice-search' ? selection.input : null,
        searchInvoiceForReturn: () => { selection.searchCalls++; }
    };
    createTestContext(selection);
    vm.runInContext(between('function selectInvoiceForReturn(', '\n// Filter return orders by product name'), selection);
    selection.selectInvoiceForReturn(121761);
    assert.equal(selection.input.value, '121761');
    assert.equal(selection.searchCalls, 1);

    const searchElements = new Map([
        ['return-invoice-search', { value: '121761' }], ['return-recent-orders', { style: {} }],
        ['return-inv-id', {}], ['return-inv-date', {}], ['return-inv-cust', {}], ['return-inv-total', {}],
        ['return-inv-method', {}], ['return-inv-items-summary', {}], ['modal-return-items-list', {}],
        ['return-invoice-info', { style: {} }]
    ]);
    const search = {
        db: { invoices: [{ id: 121761, date: '2026-01-01T00:00:00Z', cust: 'Khách lẻ', total: 0, method: 'CASH', items: [] }], returns: [] },
        $: id => searchElements.get(id) || null, toast: () => { throw new Error('unexpected search failure'); },
        money: value => String(value), escapeHtml: value => String(value), escapeAttr: value => String(value), formatQty: value => value,
        updateReturnRefund: () => {}
    };
    createTestContext(search);
    vm.runInContext(between('function searchInvoiceForReturn()', '\n// Toggle all return checkboxes'), search);
    search.searchInvoiceForReturn();
    assert.equal(search.currentReturnInvoice.id, 121761);
    assert.equal(searchElements.get('return-inv-id').innerText, '#121761');

    const detailElements = { title: {}, content: {} };
    const detail = {
        db: { returns: [{ id: 744290, date: '2026-01-01T00:00:00Z', cust: 'Khách lẻ', staff: 'Admin', returnItems: [], exchangeItems: [], difference: 0 }] },
        sameStoredId: (left, right) => String(left) === String(right), toast: () => { throw new Error('unexpected missing return'); },
        escapeHtml: value => String(value), formatQty: value => value, money: value => String(value), getReturnItemTotal: () => 0,
        openModal: () => {}, $: id => id === 'generic-modal-title' ? detailElements.title : detailElements.content
    };
    createTestContext(detail);
    vm.runInContext(between('function getReturnItemTotal(', '\nfunction captureReturnArrayState('), detail);
    vm.runInContext(between('function viewReturnDetail(', 'function buildReturnSlipHtml('), detail);
    detail.viewReturnDetail('744290');
    assert.match(detailElements.content.innerHTML, /#744290/);

    const undo = {
        undoStack: [{ type: 'DELETE_INVOICE', data: { invoice: { id: 121761, items: [] }, restoredItems: [] } }],
        UNDO_ACTIONS: { DELETE_INVOICE: 'DELETE_INVOICE' }, db: { invoices: [], products: [], stockHistory: [] },
        renderHist: () => {}, renderPos: () => {}, renderInventory: () => {}, reapplyInvoiceCustomerEffects: () => {},
        saveNow: () => { undo.saved++; return true; }, showToast: message => { undo.message = message; }, saved: 0
    };
    createTestContext(undo);
    vm.runInContext(between('function performUndo()', '\nfunction showLoading('), undo);
    undo.performUndo();
    assert.equal(undo.db.invoices.length, 1);
    assert.equal(undo.saved, 1);
    assert.match(undo.message, /121761/);

    const exportContext = {
        db: { invoices: [{ id: 121761, date: '2026-01-01T00:00:00Z', cust: 'Khách lẻ', items: [], total: 0, discount: 0, method: 'CASH' }] },
        $: () => null, getAppDate: () => new Date('2026-01-01T00:00:00Z'), parseLocalDateInput: () => null,
        exportToExcel: data => { exportContext.data = data; }
    };
    createTestContext(exportContext);
    vm.runInContext(between('function exportHistoryExcel()', '\nfunction exportProductsExcel('), exportContext);
    exportContext.exportHistoryExcel();
    assert.equal(exportContext.data[0][0], '#121761');
});

test('processReturn restores linked state and stops success UI when its durable commit fails', () => {
    const fields = new Map([
        ['return-reason', { value: 'other' }], ['return-note', { value: '' }],
        ['return-item-10', { checked: true }], ['return-qty-10', { value: '1', max: '1' }]
    ]);
    const invoice = { id: 'INV-1', cust: 'Khách A', custId: 9, items: [{ id: 10, name: 'A', price: 100, qty: 1, unit: 'SP' }] };
    const context = {
        db: {
            invoices: [plain(invoice)], products: [{ id: 10, name: 'A', stock: 5 }], stockHistory: [], returns: [], activityLog: [],
            custs: [{ id: 9, points: 10, totalBuy: 100, debt: 0 }], settings: { pointsEnabled: true, pointsRate: 1 }
        },
        undoStack: [], currentReturnInvoice: plain(invoice), exchangeItems: [], currUser: { name: 'Admin' },
        saveBlockedReason: '', saveBlockedToastShown: false, saveSuppressed: false, _saveInProgress: false,
        saveNow: () => false, setTimeout: () => { context.previewScheduled = true; }, printReturnSlip: () => {},
        confirm: () => true, money: value => String(value), getAppDate: () => new Date('2026-01-01T00:00:00Z'),
        toast: () => { context.toastCalls++; }, toastCalls: 0,
        logActivity: (action, detail) => context.db.activityLog.unshift({ action, detail }),
        applyLinkedReturnCustomerEffects: record => { context.db.custs[0].points--; context.db.custs[0].totalBuy -= record.returnTotal; },
        pushUndo: (_type, data) => context.undoStack.push(data), UNDO_ACTIONS: { RETURN_GOODS: 'RETURN_GOODS' },
        closeModal: () => { context.closed = true; }, renderPos: () => { context.rendered = true; }, renderHist: () => {}, renderManagement: () => {},
        renderDashboard: () => {}, renderStaffView: () => {}, renderReturnsHistory: () => {}, renderStockHistory: () => {},
        $: id => fields.get(id) || null
    };
    createTestContext(context);
    vm.runInContext(between('function captureReturnArrayState(', '\nfunction backToReturnList('), context);
    vm.runInContext(between('function processReturn()', '\n// HISTORY & REPORTS'), context);
    const beforeDb = plain(context.db);
    context.processReturn();
    assert.deepEqual(plain(context.db), beforeDb);
    assert.deepEqual(plain(context.undoStack), []);
    assert.equal(context.previewScheduled, undefined);
    assert.equal(context.closed, undefined);
    assert.equal(context.rendered, undefined);
});

function makeInventoryMutationContext(options = {}) {
    const elements = new Map(Object.entries({
        'p-id': { value: '' }, 'p-name': { value: 'Sản phẩm mới' }, 'p-code': { value: 'SP-MOI' },
        'p-price': { value: '10000' }, 'p-cost': { value: '5000' }, 'p-stock': { value: '2' },
        'p-cat-search': { value: 'Danh mục mới' }, 'p-img-data': { value: '' }, 'p-unit': { value: 'SP' },
        'p-wholesale-price': { value: '' }, 'p-min-wholesale': { value: '10' },
        'si-product': { value: '1' }, 'si-qty': { value: '2' }, 'si-price': { value: '5000' },
        'si-supplier': { value: '10' }, 'si-note': { value: 'Nhập thử' },
        'so-product': { value: '1' }, 'so-qty': { value: '2' }, 'so-reason': { value: 'Xuất thử' }, 'so-note': { value: 'Xuất thử' },
        'qe-product-id': { value: '1' }, 'qe-name': { value: 'Sản phẩm kho' }, 'qe-stock': { value: '7' },
        'qe-unit': { value: 'SP' }, 'qe-price': { value: '8000' }, 'qe-cost': { value: '4000' }, 'qe-wholesale': { value: '0' },
        'ic-note': { value: 'Kiểm thử' },
        'po-supplier': { value: '10' }, 'po-code': { value: 'PN-TEST' }, 'po-date': { value: '2026-01-01T08:00' },
        'po-is-paid': { checked: false }, 'po-note': { value: 'Phiếu thử' }
    }).map(([id, props]) => [id, { ...props, style: {}, classList: { remove() {}, add() {} } }]));
    const context = {
        db: {
            products: [{ id: 1, name: 'Sản phẩm kho', code: 'SP-1', stock: 5, price: 8000, cost: 4000, cat: 'Cũ' }],
            categories: ['Cũ'], stockHistory: [], purchaseOrders: [], activityLog: [], suppliers: [{ id: 10, name: 'NCC A' }],
            drafts: { purchaseOrders: [] }
        },
        undoStack: [{ type: 'KEEP', data: { id: 1 } }], currUser: { name: 'Admin', role: options.role || 'admin' },
        isAuthenticated: options.isAuthenticated !== false,
        sameStoredId: (left, right) => left !== undefined && left !== null && right !== undefined && right !== null && String(left) === String(right),
        saveBlockedReason: options.saveBlockedReason || '', saveBlockedToastShown: false,
        saveSuppressed: options.saveSuppressed || false, _saveInProgress: options.saveInProgress || false,
        saveNow: () => { context.saveCalls++; return options.saveResult !== false; }, saveCalls: 0,
        save: () => { context.legacySaveCalls = (context.legacySaveCalls || 0) + 1; },
        getAppDate: () => new Date('2026-01-01T08:00:00Z'), money: value => String(value),
        toast: (message, type) => context.toasts.push({ message, type }), toasts: [],
        logActivity: (action, detail) => context.db.activityLog.unshift({ action, detail }),
        closeModal: id => { context.closed.push(id); }, closed: [],
        renderProdTable: () => { context.renders.push('products'); }, renderCategories: () => { context.renders.push('categories'); },
        renderInventory: () => { context.renders.push('inventory'); }, renderManagement: () => { context.renders.push('management'); },
        renderPos: () => { context.renders.push('pos'); }, renderPOItems: () => { context.renders.push('po-items'); },
        renderDashboard: () => { context.renders.push('dashboard'); }, renderInventoryStockHistory: () => { context.renders.push('stock-history'); }, renders: [],
        setTimeout: callback => { context.deferred.push(callback); return 1; }, deferred: [],
        clearTimeout: () => {}, saveProd: () => {}, savePurchaseOrder: () => {}, confirm: () => true, window: {},
        $: id => elements.get(id) || { value: '', style: {}, classList: { remove() {}, add() {} } }
    };
    context.elements = elements;
    createTestContext(context);
    vm.runInContext(between('function captureInventoryMutationSnapshot()', '\n// Direct checkout'), context);
    return context;
}

function loadInventoryMutationFlow(context, flow) {
    if (flow === 'product') {
        vm.runInContext(between('function saveProd()', '\nfunction getProductDependencies'), context);
        return () => context.saveProd();
    }
    if (flow === 'stock') {
        vm.runInContext(between('function saveStockIn()', '\nfunction openStockOutModal'), context);
        return () => context.saveStockIn();
    }
    vm.runInContext('let currentPOItems = []; let skipPOAutoSave = false;', context);
    vm.runInContext(between('let editingPOId = null;', '\n// 3. BATCH PRINT LABELS FOR PO'), context);
    vm.runInContext("currentPOItems = [{ productId: 1, productName: 'Sản phẩm kho', qty: 2, price: 5000, sellPrice: 9000, total: 10000 }];", context);
    context.getCurrentPOItems = () => JSON.parse(vm.runInContext('JSON.stringify(currentPOItems)', context));
    return () => context.savePurchaseOrder();
}

test('audited inventory mutations are durable before success UI and rollback on failure', () => {
    for (const flow of ['product', 'stock', 'po']) {
        const failed = makeInventoryMutationContext({ saveResult: false });
        const executeFailed = loadInventoryMutationFlow(failed, flow);
        const beforeDb = plain(failed.db);
        const beforeUndo = plain(failed.undoStack);
        const beforeFields = plain([...failed.elements.entries()].map(([id, element]) => [id, { value: element.value, checked: element.checked }]));
        const beforePOItems = flow === 'po' ? failed.getCurrentPOItems() : null;
        executeFailed();
        assert.equal(failed.saveCalls, 1, `${flow} attempts one durable save`);
        assert.deepEqual(plain(failed.db), beforeDb, `${flow} rolls back data on save failure`);
        assert.deepEqual(plain(failed.undoStack), beforeUndo, `${flow} keeps Undo unchanged on save failure`);
        assert.deepEqual(plain([...failed.elements.entries()].map(([id, element]) => [id, { value: element.value, checked: element.checked }])), beforeFields, `${flow} keeps its form unchanged`);
        if (flow === 'po') assert.deepEqual(failed.getCurrentPOItems(), beforePOItems, 'PO items remain available after save failure');
        assert.deepEqual(failed.closed, [], `${flow} keeps its modal open on save failure`);
        assert.deepEqual(failed.renders, [], `${flow} does not render success UI on save failure`);
        assert.equal(failed.toasts.some(toast => /Đã lưu|Đã nhập/.test(toast.message)), false, `${flow} does not show a success toast on save failure`);

        const succeeded = makeInventoryMutationContext();
        const executeSucceeded = loadInventoryMutationFlow(succeeded, flow);
        executeSucceeded();
        assert.equal(succeeded.saveCalls, 1, `${flow} saves once on success`);
        assert.notDeepEqual(plain(succeeded.db), beforeDb, `${flow} changes data once after a successful save`);
        assert.ok(succeeded.closed.length > 0, `${flow} closes its modal after commit`);
        assert.equal(succeeded.toasts.some(toast => /Đã lưu|Đã nhập/.test(toast.message)), true, `${flow} shows success only after commit`);
    }
});

test('audited inventory mutations reject unavailable persistence before mutation', () => {
    for (const state of [
        { saveBlockedReason: 'blocked' }, { saveSuppressed: true }, { saveInProgress: true }
    ]) for (const flow of ['product', 'stock', 'po']) {
        const context = makeInventoryMutationContext(state);
        const execute = loadInventoryMutationFlow(context, flow);
        const beforeDb = plain(context.db);
        const beforeUndo = plain(context.undoStack);
        execute();
        assert.equal(context.saveCalls, 0, `${flow} does not save when persistence is unavailable`);
        assert.deepEqual(plain(context.db), beforeDb, `${flow} does not mutate when persistence is unavailable`);
        assert.deepEqual(plain(context.undoStack), beforeUndo, `${flow} preserves Undo when persistence is unavailable`);
    }
});

function loadManagementMutation(context, flow) {
    if (flow === 'stock-in') {
        vm.runInContext(between('function saveStockIn()', '\nfunction openStockOutModal'), context);
        return () => context.saveStockIn();
    }
    if (flow === 'stock-out') {
        vm.runInContext(between('function saveStockOut()', '\n// INVENTORY CHECK'), context);
        return () => context.saveStockOut();
    }
    if (flow === 'inventory-check') {
        vm.runInContext(between('let inventoryCheckData = {};', '\nfunction exportInventoryCheckExcel'), context);
        vm.runInContext("inventoryCheckData = { '1': { systemStock: 5, actualStock: 7, diff: 2 } };", context);
        return () => context.saveInventoryCheck();
    }
    if (flow === 'quick-edit') {
        vm.runInContext('let currentPOItems = [];', context);
        vm.runInContext(between('function openQuickEditProduct(', '\nfunction savePurchaseOrder'), context);
        return () => context.saveQuickEditProduct();
    }
    if (flow === 'po') return loadInventoryMutationFlow(context, 'po');
    vm.runInContext('let currentPOItems = []; let editingPOId = null; let skipPOAutoSave = false;', context);
    vm.runInContext(between('function savePOAsDraft()', '\n// Flag to prevent double-save'), context);
    vm.runInContext("currentPOItems = [{ productId: 1, productName: 'Sản phẩm kho', qty: 2, price: 5000, total: 10000 }];", context);
    return () => context.savePOAsDraft();
}

test('management mutation guards reject direct staff calls and preserve manager access', () => {
    for (const flow of ['stock-in', 'stock-out', 'inventory-check', 'quick-edit', 'po', 'draft']) {
        const staff = makeInventoryMutationContext({ role: 'staff' });
        const execute = loadManagementMutation(staff, flow);
        const beforeDb = plain(staff.db);
        execute();
        assert.deepEqual(plain(staff.db), beforeDb, `${flow} rejects direct staff mutation`);
        assert.equal(staff.saveCalls, 0, `${flow} does not save for staff`);
        assert.deepEqual(staff.closed, [], `${flow} keeps staff UI unchanged`);
    }

    for (const flow of ['stock-in', 'stock-out', 'inventory-check', 'quick-edit', 'po', 'draft']) {
        const manager = makeInventoryMutationContext({ role: 'manager' });
        const execute = loadManagementMutation(manager, flow);
        execute();
        assert.equal(manager.saveCalls, 1, `${flow} remains available to manager`);
    }
});

test('management legacy IDs retain product, supplier, and purchase-order links', () => {
    const makeLegacyContext = () => {
        const context = makeInventoryMutationContext();
        context.db.products[0].id = 'SKU-LEGACY';
        context.db.suppliers[0].id = 'SUP-LEGACY';
        context.elements.get('si-product').value = 'SKU-LEGACY';
        context.elements.get('so-product').value = 'SKU-LEGACY';
        context.elements.get('qe-product-id').value = 'SKU-LEGACY';
        context.elements.get('po-supplier').value = 'SUP-LEGACY';
        return context;
    };

    for (const flow of ['stock-in', 'stock-out', 'quick-edit', 'po']) {
        const context = makeLegacyContext();
        const execute = loadManagementMutation(context, flow);
        if (flow === 'po') vm.runInContext("currentPOItems = [{ productId: 'SKU-LEGACY', productName: 'Sản phẩm kho', qty: 2, price: 5000, sellPrice: 9000, total: 10000 }];", context);
        execute();
        assert.equal(context.saveCalls, 1, `${flow} saves with legacy IDs`);
        if (flow !== 'po') assert.equal(context.db.stockHistory[0].productId, 'SKU-LEGACY', `${flow} keeps the stored product ID`);
        if (flow === 'po') {
            assert.equal(context.db.purchaseOrders[0].supplierId, 'SUP-LEGACY');
            assert.equal(context.db.purchaseOrders[0].supplierName, 'NCC A');
            assert.equal(context.db.stockHistory[0].productId, 'SKU-LEGACY');
        }
    }

    const inventory = makeLegacyContext();
    vm.runInContext(between('let inventoryCheckData = {};', '\nfunction exportInventoryCheckExcel'), inventory);
    vm.runInContext("inventoryCheckData = { 'SKU-LEGACY': { systemStock: 5, actualStock: 7, diff: 2 } };", inventory);
    inventory.saveInventoryCheck();
    assert.equal(inventory.db.products[0].stock, 7);
    assert.equal(inventory.db.stockHistory[0].productId, 'SKU-LEGACY');

    const priceContext = makeLegacyContext();
    priceContext.db.purchaseOrders = [{ id: 77, items: [{ productId: 'SKU-LEGACY', qty: 2, price: 100, total: 200 }], totalAmount: 200 }];
    vm.runInContext(between('function updatePOItemPrice(', '\nfunction printCurrentPO'), priceContext);
    priceContext.updatePOItemPrice('77', 0, '300');
    assert.equal(priceContext.db.purchaseOrders[0].items[0].price, 300);
    assert.equal(priceContext.db.products[0].cost, 300);
    assert.match(source, /onchange="updatePOItemPrice\(\$\{poIdJs\}, \$\{idx\}, this\.value\)"/);
});

test('purchase-order draft rollback keeps UI state and avoids an auto-draft on save failure', () => {
    const failed = makeInventoryMutationContext({ saveResult: false });
    const executeFailed = loadManagementMutation(failed, 'draft');
    const beforeDb = plain(failed.db);
    const beforeFields = plain([...failed.elements.entries()].map(([id, element]) => [id, { value: element.value, checked: element.checked }]));
    const beforeItems = failed.getCurrentPOItems ? failed.getCurrentPOItems() : plain(vm.runInContext('currentPOItems', failed));
    executeFailed();
    assert.equal(failed.saveCalls, 1);
    assert.deepEqual(plain(failed.db), beforeDb);
    assert.deepEqual(plain([...failed.elements.entries()].map(([id, element]) => [id, { value: element.value, checked: element.checked }])), beforeFields);
    assert.deepEqual(plain(vm.runInContext('currentPOItems', failed)), plain(beforeItems));
    assert.deepEqual(failed.closed, []);
    assert.equal(failed.toasts.some(toast => /Đã lưu bản nháp/.test(toast.message)), false);
});

test('management mutations rollback all linked state when durable save fails', () => {
    for (const flow of ['stock-out', 'inventory-check', 'quick-edit', 'po', 'draft']) {
        const failed = makeInventoryMutationContext({ saveResult: false });
        const execute = loadManagementMutation(failed, flow);
        if (flow === 'quick-edit') vm.runInContext("currentPOItems = [{ productId: 1, productName: 'Sản phẩm kho', productCode: 'SP-1', qty: 2, price: 4000, sellPrice: 8000, total: 8000 }];", failed);
        const beforeDb = plain(failed.db);
        const hasPOState = ['quick-edit', 'po', 'draft'].includes(flow);
        const beforeItems = hasPOState ? plain(vm.runInContext('currentPOItems', failed)) : null;
        execute();
        assert.equal(failed.saveCalls, 1, `${flow} attempts one durable save`);
        assert.deepEqual(plain(failed.db), beforeDb, `${flow} rolls back database state`);
        if (hasPOState) assert.deepEqual(plain(vm.runInContext('currentPOItems', failed)), beforeItems, `${flow} keeps pending PO items`);
        assert.deepEqual(failed.closed, [], `${flow} keeps the modal open`);
        assert.equal(failed.toasts.some(toast => /Đã xuất|Đã điều chỉnh|Đã cập nhật|Đã lưu/.test(toast.message)), false, `${flow} suppresses success UI`);
    }
});

test('legacy identity mutations keep linked collections intact when durable saves fail', () => {
    for (const flow of ['product', 'po']) {
        const context = makeInventoryMutationContext({ saveResult: false });
        context.db.products[0].id = 'SKU-LEGACY';
        context.db.suppliers[0].id = 'SUP-LEGACY';
        context.elements.get('p-id').value = 'SKU-LEGACY';
        context.elements.get('po-supplier').value = 'SUP-LEGACY';

        const execute = loadInventoryMutationFlow(context, flow);
        if (flow === 'po') {
            vm.runInContext("currentPOItems = [{ productId: 'SKU-LEGACY', productName: 'Sản phẩm kho', qty: 1, price: 12, sellPrice: 20, total: 12 }];", context);
        }

        const before = plain(context.db);
        execute();

        assert.deepEqual(plain(context.db), before, `${flow} must rollback legacy-ID changes`);
        assert.equal(context.saveCalls, 1, `${flow} must attempt its durable save once`);
        assert.deepEqual(context.closed, [], `${flow} must not close its success modal`);
        assert.ok(
            !context.toasts.some(message => /thành công/i.test(message)),
            `${flow} must not show a success toast`
        );
    }
});

test('supplier deletion preserves linked purchase orders and supports legacy IDs when unlinked', () => {
    const makeSupplierContext = db => {
        const context = {
            db, sameStoredId: (left, right) => String(left) === String(right), confirmed: 0, warned: 0, undo: 0, saved: 0, rendered: 0,
            UNDO_ACTIONS: { DELETE_SUPPLIER: 'DELETE_SUPPLIER' }
        };
        context.confirm = () => { context.confirmed++; return true; };
        context.toast = () => { context.warned++; };
        context.pushUndo = () => { context.undo++; };
        context.save = () => { context.saved++; };
        context.saveInventoryCommit = () => { context.saved++; return true; };
        context.renderSuppliers = () => { context.rendered++; };
        createTestContext(context);
        vm.runInContext(between('function getSupplierDependencies(', '\n// RETURNS'), context);
        return context;
    };
    const linked = makeSupplierContext({ suppliers: [{ id: '10', name: 'NCC A' }], purchaseOrders: [{ id: 'PO-1', supplierId: 10 }] });
    const beforeLinked = plain(linked.db);
    linked.delSupplier('10');
    assert.deepEqual(plain(linked.db), beforeLinked);
    assert.equal(linked.confirmed, 0);
    assert.equal(linked.undo, 0);
    assert.equal(linked.saved, 0);

    const unlinked = makeSupplierContext({ suppliers: [{ id: 'SKU-10', name: 'NCC B' }], purchaseOrders: [] });
    unlinked.delSupplier('SKU-10');
    assert.equal(unlinked.db.suppliers.length, 0);
    assert.equal(unlinked.confirmed, 1);
    assert.equal(unlinked.undo, 1);
    assert.equal(unlinked.saved, 1);
});

test('product bulk selection preserves stored legacy IDs and product tabs do not reset management tabs', () => {
    for (const id of ['10', 'SKU-LEGACY', 10]) {
        const checkbox = { dataset: { id: String(id) }, checked: false };
        const context = {
            db: { products: [{ id, name: 'Legacy' }], invoices: [], purchaseOrders: [], returns: [], stockHistory: [], activityLog: [] },
            selectedProducts: new Set(), sameStoredId: (left, right) => String(left) === String(right),
            $: key => key === 'prod-body' ? { querySelectorAll: () => [checkbox] } : null,
            updateBulkDeleteUI: () => {}, getProductDependencies: () => [], confirm: () => true, pushUndo: () => {}, logActivity: () => {}, save: () => {}, renderProdTable: () => {}, renderPos: () => {}, toast: () => {},
            UNDO_ACTIONS: { DELETE_PRODUCT: 'DELETE_PRODUCT' }
        };
        createTestContext(context);
        vm.runInContext(between('function toggleProductSelect(', '\nfunction updateBulkDeleteUI'), context);
        context.toggleAllProducts({ checked: true });
        assert.equal(context.selectedProducts.has(id), true);
        context.deleteSelectedProducts();
        assert.equal(context.db.products.length, 0);
    }

    const makeButton = (tab, active) => ({ dataset: { tab }, classList: { active, remove(name) { if (name === 'active') this.active = false; }, add(name) { if (name === 'active') this.active = true; } } });
    const products = makeButton('products', true);
    const management = makeButton('inventory', true);
    const tabs = {
        document: {
            querySelectorAll: selector => {
                if (selector === '#products-view .products-tab-btn') return [products];
                if (selector === '.products-tab-btn') return [products, management];
                return [{ classList: { remove() {}, add() {} } }];
            },
            querySelector: selector => selector === '#products-view .products-tab-btn[data-tab="products"]' ? products : null
        },
        $: () => null, renderProdTable: () => {}, renderCategories: () => {}, renderInventory: () => {}, renderSuppliers: () => {}
    };
    createTestContext(tabs);
    vm.runInContext(between('function renderProductsTab(tab)', '\n// Management Tab Switch'), tabs);
    tabs.renderProductsTab('products');
    assert.equal(management.classList.active, true);
});

function makeSettingsContext(options = {}) {
    const makeElement = (value = '', checked = false) => {
        const classes = new Set();
        return {
            value, checked, src: '', style: {}, dataset: {}, innerText: '', title: '',
            classList: {
                add(name) { classes.add(name); },
                remove(name) { classes.delete(name); },
                contains(name) { return classes.has(name); }
            },
            focus() {}
        };
    };
    const elements = new Map(Object.entries({
        'set-name': makeElement('Cửa hàng mới'), 'set-addr': makeElement('Địa chỉ mới'), 'set-phone': makeElement('0900'),
        'set-footer': makeElement('Cảm ơn'), 'set-bank': makeElement('Ngân hàng'), 'set-num': makeElement('123'),
        'set-owner': makeElement('Chủ TK'), 'set-qr-view': Object.assign(makeElement(), { src: '' }),
        'set-printer': makeElement(''), 'set-paper': makeElement('80'), 'set-silent': makeElement('', false),
        'set-sound': makeElement('', true), 'set-theme': makeElement('dark'), 'set-backup': makeElement('', true),
        'set-backup-interval': makeElement('daily'), 'set-backup-limit': makeElement('60'), 'set-low-stock': makeElement('5'),
        'set-ui-size': makeElement('large'), 'set-disable-login': makeElement('', false), 'set-points-rate': makeElement('1'),
        'set-points-value': makeElement('1000'), 'set-points-enabled': makeElement('', true), 'set-label-paper': makeElement('110'),
        'set-label-columns': makeElement('3'), 'set-label-size': makeElement('35x22'), 'set-label-gap': makeElement('2'),
        'set-scanner-popup': makeElement('', true), 'set-scanner-auto-add': makeElement('', false), 'set-time-override': makeElement('', false),
        'set-custom-datetime': makeElement('2026-01-01T08:00'), 'time-override-container': makeElement(), 'restore-file': makeElement(),
        'user-detail-modal': makeElement(), 'user-detail-body': makeElement(), 'user-modal': makeElement(), 'u-id': makeElement(),
        'u-code': makeElement(), 'u-user': makeElement(), 'u-pass': makeElement(), 'u-name': makeElement(), 'u-fullname': makeElement(),
        'u-phone': makeElement(), 'u-birthday': makeElement(), 'u-startdate': makeElement(), 'u-idcard': makeElement(),
        'u-basesalary': makeElement(), 'u-commission': makeElement(), 'u-role': makeElement(), 'u-avatar-preview': makeElement(),
        'u-avatar-placeholder': makeElement(), 'salary-section': makeElement()
    }).map(([id, element]) => [id, element]));
    const context = {
        db: {
            settings: { name: 'Cửa hàng cũ', theme: 'light', uiSize: 'medium', shortcuts: { pay: 'F4' }, disableLogin: false },
            users: [{ id: 1, user: 'admin', pass: 'admin-pass', name: 'Admin', role: 'admin' }],
            products: [{ id: 1 }], categories: ['A'], custs: [{ id: 1 }], invoices: [{ id: 1 }], suppliers: [{ id: 1 }],
            stockHistory: [{ id: 1 }], returns: [{ id: 1 }], purchaseOrders: [{ id: 1 }], activityLog: [{ id: 1 }],
            drafts: { invoices: [1], purchaseOrders: [2], products: [3] }
        },
        defaultData: { products: [], categories: [], custs: [], invoices: [], suppliers: [], stockHistory: [], returns: [], purchaseOrders: [], activityLog: [], users: [], settings: {}, drafts: { invoices: [], purchaseOrders: [], products: [] } },
        currUser: { id: 1, role: options.role || 'admin', name: options.role || 'Admin' }, isAuthenticated: options.isAuthenticated !== false,
        sameStoredId: (left, right) => left !== undefined && left !== null && right !== undefined && right !== null && String(left) === String(right),
        timeOffset: 0, tempShortcuts: { pay: 'Ctrl+P' }, defaultShortcuts: { pay: { key: 'F4' } },
        saveNow: () => { context.saveCalls++; return options.saveResult !== false; }, saveCalls: 0,
        save: () => { context.deferredSaves++; }, deferredSaves: 0, saveBlockedReason: '', saveSuppressed: false, _saveInProgress: false,
        setupAutoBackup: () => context.sideEffects.push('backup'), pruneOldBackups: () => context.sideEffects.push('prune'),
        updateBackupStats: () => context.sideEffects.push('stats'), updateAuthPanel: () => context.sideEffects.push('auth'),
        updateShortcutLabels: () => context.sideEffects.push('shortcut-labels'), renderShortcutsSettings: () => context.sideEffects.push('shortcuts-render'),
        redrawVisibleChartsForTheme: () => {}, getBackupLimit: value => Number(value) || 60,
        toast: (message, type) => context.toasts.push({ message, type }), toasts: [], sideEffects: [], confirm: () => { context.confirmCalls++; return options.confirm !== false; }, confirmCalls: 0,
        fs: options.fs || null, path: options.path || null, userDataPath: options.userDataPath || null,
        listBackupFiles: () => [], pruneOldBackups: () => context.sideEffects.push('prune'), logRendererEvent: () => {}, serializeError: String,
        localStorage: { removeItem: key => context.cacheRemovals.push(key) }, cacheRemovals: [], sessionStorage: { clear: () => context.sideEffects.push('session-clear') },
        location: { reload: () => context.sideEffects.push('reload') }, setTimeout: callback => { context.deferred.push(callback); return 1; }, clearTimeout: () => {}, deferred: [],
        logActivity: (action, detail) => context.db.activityLog.unshift({ action, detail }),
        getAppDate: () => new Date('2026-01-01T08:00:00Z'), toLocalDateTimeStr: () => '2026-01-01T08:00', updateTimeDiffDisplay: () => {}, formatTimeDiff: () => '',
        calculateStaffSalary: () => ({ revenue: 0, orders: 0, total: 0 }), money: String, safeImageSrc: () => '', escapeHtml: String,
        generateEmployeeCode: () => 'NV-TEST', closeModal: () => {}, canEditUser: (actor, target) => actor?.role === 'admin' || (actor?.role === 'staff' && String(actor.id) === String(target?.id)), canCreateUser: actor => actor?.role === 'admin',
        document: {
            body: { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } },
            querySelectorAll: selector => selector === '#shortcuts-grid input[data-action]' ? [] : [], querySelector: () => null
        },
        $: id => elements.get(id) || makeElement()
    };
    context.elements = elements;
    createTestContext(context);
    vm.runInContext(between('function canMutateSettings()', '\nfunction captureHistoryMutationSnapshot'), context);
    vm.runInContext(between('function resetShortcuts()', '\n// Update all shortcut labels'), context);
    vm.runInContext(between('function applyTheme(', '\nfunction playSuccessSound'), context);
    vm.runInContext(between('function cleanupBackupsNow()', '\nfunction performBackup'), context);
    vm.runInContext(between('function resetApp()', '\nfunction exportData'), context);
    vm.runInContext(between('function importData()', '\n// Toggle backup interval visibility'), context);
    vm.runInContext(between('function saveSets()', '\n// ========== DATE/TIME OVERRIDE SETTINGS'), context);
    vm.runInContext(between('function toggleTimeOverride()', '\nfunction formatTimeDiff'), context);
    vm.runInContext(between('// Render user cards for expanded view\nfunction getCurrentUserRecord', '\nfunction handleUserAvatar'), context);
    return context;
}

test('settings mutations enforce roles and defer theme and UI-size persistence until saveSets commits', () => {
    const staff = makeSettingsContext({ role: 'staff' });
    const beforeStaff = plain(staff.db);
    for (const fn of ['saveSets', 'saveShortcuts', 'resetShortcuts', 'toggleTimeOverride', 'updateTimeOffset', 'resetTimeToSystem', 'cleanupBackupsNow', 'importData', 'uninstallAppSettings', 'resetApp']) staff[fn]();
    assert.deepEqual(plain(staff.db), beforeStaff);
    assert.equal(staff.saveCalls, 0);
    assert.equal(staff.confirmCalls, 0);

    const manager = makeSettingsContext({ role: 'manager' });
    manager.applyTheme('dark');
    manager.applyUISize('large');
    assert.equal(manager.db.settings.theme, 'light');
    assert.equal(manager.db.settings.uiSize, 'medium');
    assert.equal(manager.deferredSaves, 0);
    manager.saveSets();
    assert.equal(manager.saveCalls, 1);
    assert.equal(manager.db.settings.theme, 'dark');
    assert.equal(manager.db.settings.uiSize, 'large');
    assert.deepEqual(manager.sideEffects, ['backup', 'prune', 'stats', 'auth']);
    manager.uninstallAppSettings();
    manager.resetApp();
    assert.equal(manager.confirmCalls, 0);
});

test('saveSets rolls back settings previews and uninstall preserves users only after a durable save', () => {
    const failedSave = makeSettingsContext({ saveResult: false });
    const beforeSettings = plain(failedSave.db.settings);
    failedSave.applyTheme('dark');
    failedSave.applyUISize('large');
    failedSave.saveSets();
    assert.equal(failedSave.saveCalls, 1);
    assert.deepEqual(plain(failedSave.db.settings), beforeSettings);
    assert.equal(failedSave.document.body.attributes['data-theme'], 'light');
    assert.equal(failedSave.document.body.attributes['data-ui-size'], 'medium');
    assert.deepEqual(failedSave.sideEffects, []);
    assert.equal(failedSave.toasts.some(toast => /Đã lưu cài đặt/.test(toast.message)), false);

    const failedUninstall = makeSettingsContext({ saveResult: false });
    const beforeUninstall = plain(failedUninstall.db);
    failedUninstall.uninstallAppSettings();
    assert.deepEqual(plain(failedUninstall.db), beforeUninstall);
    assert.deepEqual(failedUninstall.cacheRemovals, []);
    assert.equal(failedUninstall.sideEffects.includes('reload'), false);
    assert.equal(failedUninstall.toasts.some(toast => /gỡ cài đặt thành công/i.test(toast.message)), false);

    const succeededUninstall = makeSettingsContext();
    const originalUsers = plain(succeededUninstall.db.users);
    succeededUninstall.uninstallAppSettings();
    assert.equal(succeededUninstall.saveCalls, 1);
    assert.deepEqual(plain(succeededUninstall.db.users), originalUsers);
    assert.deepEqual(succeededUninstall.cacheRemovals, ['posViewMode', 'orderDrafts']);
    assert.equal(succeededUninstall.toasts.some(toast => /gỡ cài đặt thành công/i.test(toast.message)), true);
});

test('settings user detail and edit preserve numeric and legacy string IDs', () => {
    for (const id of [2, '2', 'EMP-ALPHA']) {
        const context = makeSettingsContext();
        context.db.users = [{ id: 1, user: 'admin', pass: 'admin-pass', name: 'Admin', role: 'admin' }, { id, user: 'legacy', pass: 'legacy-pass', name: 'Legacy', role: 'staff' }];
        context.viewUserDetail(id);
        assert.equal(context.elements.get('user-detail-modal').classList.contains('active'), true);
        assert.equal(context.elements.get('user-detail-modal').dataset.userId, id);
        context.openUserModal(id);
        assert.equal(context.elements.get('u-id').value, id);
        assert.equal(context.elements.get('u-user').value, 'legacy');
    }

    const staff = makeSettingsContext({ role: 'staff' });
    staff.currUser = { id: 'EMP-ALPHA', role: 'staff', name: 'Legacy' };
    staff.db.users = [{ id: 'EMP-ALPHA', user: 'legacy', pass: 'legacy-pass', name: 'Legacy', role: 'staff' }, { id: 'OTHER', user: 'other', pass: 'other-pass', name: 'Other', role: 'staff' }];
    staff.viewUserDetail('EMP-ALPHA');
    assert.equal(staff.elements.get('user-detail-modal').dataset.userId, 'EMP-ALPHA');
    staff.viewUserDetail('OTHER');
    assert.equal(staff.toasts.some(toast => /chính mình/.test(toast.message)), true);
});

test('POS drafts migrate durably, preserve sale state, and refuse missing products', () => {
    const createContext = saveResult => {
        const storage = new Map([['orderDrafts', JSON.stringify([{
            id: 44, name: 'Đơn cũ', cart: [{ id: 'P-1', name: 'Tên cũ', price: 10000, qty: 2 }],
            cust: { id: 'C-1', name: 'Khách cũ' }, discount: 500, discountType: 'amount', savedAt: '2026-01-01T00:00:00.000Z'
        }])]]);
        const fields = new Map([['cart-discount', { value: '' }], ['discount-type', { value: '' }], ['cart-cust', { value: '' }]]);
        const context = {
            db: {
                drafts: { invoices: [], purchaseOrders: [], products: [] },
                products: [{ id: 'P-1', name: 'Sản phẩm mới', price: 12000 }],
                custs: [{ id: 'C-1', name: 'Khách mới' }]
            },
            localStorage: { getItem: key => storage.get(key) || null, removeItem: key => storage.delete(key) },
            getAppDate: () => new Date('2026-01-02T00:00:00.000Z'),
            saveNow: () => saveResult,
            toast: (message, type) => context.toasts.push({ message, type }), toasts: [],
            invoiceTabs: [{ id: 1, name: 'Đơn 1', cart: [{ id: 'P-1', name: 'Sản phẩm mới', price: 12000, qty: 1 }], cust: { id: 'C-1' }, discount: 250, discountType: 'percent' }],
            activeTabId: 1, cart: [], cust: null,
            saveCurrentTabState: () => {}, createNewInvoiceTab: () => { throw new Error('unexpected new tab'); },
            sameStoredId: (left, right) => String(left) === String(right),
            $: id => fields.get(id) || null, renderCart: () => {}, updateCustList: () => {}
        };
        context.storage = storage;
        return context;
    };

    const migrated = createContext(true);
    createTestContext(migrated);
    vm.runInContext(between('// 5. DRAFT SYSTEM', '\n// Save current PO as draft'), migrated);
    assert.equal(migrated.migrateLegacyOrderDrafts(), true);
    assert.equal(migrated.db.drafts.invoices.length, 1);
    assert.equal(migrated.db.drafts.invoices[0].id, 'DRAFT-legacy-44');
    assert.equal(migrated.db.drafts.invoices[0].data.discount, 500);
    assert.equal(migrated.storage.has('orderDrafts'), false);
    assert.equal(migrated.migrateLegacyOrderDrafts(), false);
    assert.equal(migrated.db.drafts.invoices.length, 1);

    migrated.cart = migrated.invoiceTabs[0].cart.map(item => ({ ...item }));
    assert.ok(migrated.saveCartAsDraft());
    assert.equal(migrated.db.drafts.invoices[0].data.discount, 250);
    assert.equal(migrated.db.drafts.invoices[0].data.discountType, 'percent');

    migrated.cart = [];
    assert.equal(migrated.loadCartFromDraft('DRAFT-legacy-44'), true);
    assert.equal(migrated.cart[0].name, 'Sản phẩm mới');
    assert.equal(migrated.cart[0].price, 12000);
    assert.equal(migrated.cust.name, 'Khách mới');

    migrated.db.drafts.invoices.unshift({ id: 'missing', data: { items: [{ id: 'gone', name: 'Đã xóa', qty: 1 }] } });
    const beforeCart = JSON.stringify(migrated.cart);
    assert.equal(migrated.loadCartFromDraft('missing'), false);
    assert.equal(JSON.stringify(migrated.cart), beforeCart);

    const failed = createContext(false);
    createTestContext(failed);
    vm.runInContext(between('// 5. DRAFT SYSTEM', '\n// Save current PO as draft'), failed);
    assert.equal(failed.migrateLegacyOrderDrafts(), false);
    assert.equal(failed.db.drafts.invoices.length, 0);
    assert.equal(failed.storage.has('orderDrafts'), true);
});

test('Excel exporter creates an XLSX download with a single extension', () => {
    const link = { attrs: {}, style: {}, setAttribute(key, value) { this.attrs[key] = value; }, click() { this.clicked = true; } };
    const exportContext = {
        XLSX: {
            utils: {
                aoa_to_sheet: rows => ({ rows }), book_new: () => ({}),
                book_append_sheet: (book, worksheet, name) => { book.worksheet = worksheet; book.name = name; }
            },
            write: (book, options) => { exportContext.workbook = book; exportContext.options = options; return new Uint8Array([1, 2, 3]); }
        },
        Blob, document: { createElement: () => link, body: { appendChild: () => {}, removeChild: () => {} } },
        URL: { createObjectURL: blob => { exportContext.blob = blob; return 'blob:test'; }, revokeObjectURL: () => {} },
        toLocalDateStr: () => '2026-01-02', getAppDate: () => new Date('2026-01-02T00:00:00.000Z'),
        toast: (message, type) => { exportContext.toast = { message, type }; }, logActivity: (action, detail) => { exportContext.activity = { action, detail }; }
    };
    createTestContext(exportContext);
    vm.runInContext(between('function exportToExcel(', '\nfunction exportHistoryExcel('), exportContext);
    exportContext.exportToExcel([['Đặng', '=1+1']], ['Tên', 'Ghi chú'], 'Baocao_2026-01-01.xlsx', { appendDate: false });
    assert.equal(link.attrs.download, 'Baocao_2026-01-01.xlsx');
    assert.equal(exportContext.options.bookType, 'xlsx');
    assert.equal(exportContext.options.type, 'array');
    assert.equal(exportContext.blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.deepEqual(plain(exportContext.workbook.worksheet.rows), [['Tên', 'Ghi chú'], ['Đặng', '=1+1']]);
    assert.equal(exportContext.activity.action, 'Xuất Excel');
});

test('macOS Option digits navigate while normal shortcut matching remains strict', () => {
    const context = {};
    createTestContext(context);
    vm.runInContext(between('function matchesShortcut(', '\n\nfunction isLoginModalActive('), context);
    assert.equal(context.matchesShortcut('Alt+1', { key: '¡', code: 'Digit1', altKey: true, ctrlKey: false, shiftKey: false }), true);
    assert.equal(context.matchesShortcut('Alt+1', { key: '¡', code: 'Digit1', altKey: false, ctrlKey: false, shiftKey: false }), false);
    assert.equal(context.matchesShortcut('Ctrl+P', { key: 'p', code: 'KeyP', altKey: false, ctrlKey: true, shiftKey: false }), true);
    assert.doesNotMatch(source, /máy in mặc định của Windows/);
    assert.match(source, /SYSTEM_DEFAULT_PRINTER_DETAIL/);
});

test('mixed legacy IDs retain product, customer, invoice, purchase-order, and draft links', () => {
    const productFields = new Map(Object.entries({
        'p-id': { value: 'SKU-101' }, 'p-name': { value: 'Sản phẩm đã sửa' }, 'p-code': { value: 'SKU-101' },
        'p-price': { value: '12000' }, 'p-cost': { value: '5000' }, 'p-stock': { value: '3' },
        'p-cat-search': { value: 'Hàng cũ' }, 'p-img-data': { value: '' }, 'p-unit': { value: 'SP' },
        'p-wholesale-price': { value: '' }, 'p-min-wholesale': { value: '10' }
    }).map(([id, value]) => [id, value]));
    const product = {
        db: { products: [{ id: 'SKU-101', name: 'Sản phẩm cũ', code: 'SKU-101', price: 10000, cost: 4000, stock: 2, cat: 'Hàng cũ' }], categories: ['Hàng cũ'], stockHistory: [], activityLog: [] },
        $: id => productFields.get(id) || null, beginInventoryCommit: () => ({}), saveInventoryCommit: () => true,
        getAppDate: () => new Date('2026-01-01T00:00:00Z'), currUser: { name: 'Admin' }, logActivity: () => {},
        renderProdTable: () => {}, renderCategories: () => {}, renderPos: () => {}, closeModal: () => {}, toast: () => {}
    };
    createTestContext(product);
    vm.runInContext(between('function saveProd(', '\nfunction getProductDependencies('), product);
    assert.equal(product.saveProd(), true);
    assert.equal(product.db.products.length, 1);
    assert.equal(product.db.products[0].id, 'SKU-101');
    assert.equal(product.db.products[0].name, 'Sản phẩm đã sửa');

    const customerFields = new Map([
        ['debt-cust-id', { value: '9' }], ['debt-type', { value: 'add' }], ['debt-amount', { value: '25000' }]
    ]);
    const customer = {
        db: { custs: [{ id: 9, name: 'Khách A', debt: 10000 }] }, $: id => customerFields.get(id) || null,
        money: value => String(value), logActivity: () => {}, save: () => {}, closeModal: () => {}, renderCustTable: () => {}, toast: () => {}
    };
    createTestContext(customer);
    vm.runInContext(between('function saveDebt(', '\n// WHOLESALE PRICE CALCULATION'), customer);
    customer.saveDebt();
    assert.equal(customer.db.custs[0].debt, 35000);

    const links = {
        db: {
            invoices: [], returns: [{ id: 'RET-1', invoiceId: '700', returnItems: [{ id: 'SKU-101', qty: 1 }] }],
            drafts: { invoices: [{ id: 'DRAFT-9', data: { items: [] } }], purchaseOrders: [], products: [] },
            stockHistory: [{ id: 'STK-1', purchaseOrderId: 'PO-8' }]
        },
        toast: () => {}, save: () => {}, saveNow: () => true
    };
    createTestContext(links);
    vm.runInContext(between('function getOutstandingInvoiceItems(', '\nfunction getInvoiceReturnedAmount('), links);
    vm.runInContext(between('function isStockHistoryForPurchaseOrder(', '\nfunction openPurchaseOrderModal('), links);
    vm.runInContext(between('function loadDraft(', '\nfunction getDraftsList('), links);
    const outstanding = links.getOutstandingInvoiceItems({ id: 700, items: [{ id: 'SKU-101', qty: 2, price: 100 }] });
    assert.equal(outstanding[0].qty, 1);
    assert.equal(links.isStockHistoryForPurchaseOrder(links.db.stockHistory[0], { id: 'PO-8', code: 'PN8' }), true);
    assert.deepEqual(plain(links.loadDraft('invoices', 'DRAFT-9')), { items: [] });
    links.deleteDraft('invoices', 'DRAFT-9');
    assert.equal(links.db.drafts.invoices.length, 0);
});

test('persisted relations use sameStoredId and identity inputs are never parsed as numbers', () => {
    const relation = /\.(?:id|productId|custId|supplierId|invoiceId|returnId|purchaseOrderId)\s*(?:===|!==|==|!=)|(?:===|!==|==|!=)\s*[^;]*\.(?:id|productId|custId|supplierId|invoiceId|returnId|purchaseOrderId)/;
    const allowed = [
        /invoiceTabs/, /activeTabId/, /activeModal\.id/, /modal\.id/, /input\.id/, /e\.target\.id/,
        /QUICK_RETURN/, /document\.activeElement/, /history-tab-/
    ];
    const violations = source.split(/\r?\n/).flatMap((line, index) =>
        relation.test(line) && !line.includes('sameStoredId') && !allowed.some(pattern => pattern.test(line))
            ? [`${index + 1}: ${line.trim()}`]
            : []
    );

    assert.deepEqual(violations, []);
    assert.doesNotMatch(source, /parseInt\([^\n]*(?:\bid\b|Id|ID)/);
});

test('stock-history bulk selection preserves the stored legacy ID instead of coercing it', () => {
    const rowCheckbox = { dataset: { id: 'STOCK-LEGACY-A' }, checked: false };
    const body = { querySelectorAll: () => [rowCheckbox] };
    const context = {
        db: { stockHistory: [{ id: 'STOCK-LEGACY-A' }] },
        selectedStockEntries: new Set(),
        sameStoredId: (left, right) => String(left) === String(right),
        updateBulkDeleteUI: () => {},
        $: () => null
    };
    createTestContext(context);
    vm.runInContext(between('function toggleAllStockEntries(', '\nfunction deleteSelectedStockEntries'), context);
    context.toggleAllStockEntries({ checked: true, closest: () => ({ querySelector: () => body }) });
    assert.deepEqual([...context.selectedStockEntries], ['STOCK-LEGACY-A']);
    assert.equal(rowCheckbox.checked, true);
});

test('Electron renderer is isolated behind the fixed NTKIOT bridge', () => {
    const main = fs.readFileSync(require.resolve('../main.js'), 'utf8');
    const preload = fs.readFileSync(require.resolve('../preload.js'), 'utf8');
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');

    assert.match(main, /nodeIntegration:\s*false/);
    assert.match(main, /contextIsolation:\s*true/);
    assert.match(main, /preload:\s*path\.join\(__dirname, 'preload\.js'\)/);
    assert.match(main, /isSafeBackupId/);
    assert.match(main, /isTrustedSender/);
    assert.match(preload, /contextBridge\.exposeInMainWorld\('ntkiot'/);
    assert.doesNotMatch(preload, /\b(fs|path)\b/);
    assert.doesNotMatch(source, /\brequire\s*\(/);
    assert.doesNotMatch(source, /\bipcRenderer\b|\bDATA_PATH\b|\buserDataPath\b/);
    assert.doesNotMatch(source, /\bsave\(\);/);
    assert.doesNotMatch(main.slice(main.indexOf('function writeTextFileDurably'), main.indexOf('function isTrustedSender')), /unlinkSync\(filePath\)/);
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /xlsx\.full\.min\.js/);
    assert.match(html, /JsBarcode\.all\.min\.js/);
});
