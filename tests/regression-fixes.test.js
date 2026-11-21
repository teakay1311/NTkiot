const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../script.js'), 'utf8');
const mainSource = fs.readFileSync(require.resolve('../main.js'), 'utf8');

function mainBetween(startMarker, endMarker) {
    const start = mainSource.indexOf(startMarker);
    const end = mainSource.indexOf(endMarker, start);
    assert.notEqual(start, -1, `Missing ${startMarker}`);
    assert.notEqual(end, -1, `Missing ${endMarker}`);
    return mainSource.slice(start, end);
}

function between(startMarker, endMarker) {
    const alternateStartMarker = startMarker.startsWith('function ') ? `async ${startMarker}` : startMarker;
    const alternateEndMarker = endMarker.includes('\nfunction ') ? endMarker.replace('\nfunction ', '\nasync function ') : endMarker;
    const start = source.indexOf(alternateStartMarker) !== -1 ? source.indexOf(alternateStartMarker) : source.indexOf(startMarker);
    const end = source.indexOf(alternateEndMarker, start) !== -1 ? source.indexOf(alternateEndMarker, start) : source.indexOf(endMarker, start);
    assert.notEqual(start, -1, `Missing ${startMarker}`);
    assert.notEqual(end, -1, `Missing ${endMarker}`);
    // VM fixtures exercise mutation semantics with synchronous fake persistence.
    // Production functions remain async; strip only async syntax in extracted fixture code.
    return source.slice(start, end)
        .replace(/\basync function\s+/g, 'function ')
        .replace(/\bawait\s+/g, '');
}

function createTestContext(context) {
    context.NTKIOTDataModel = require('../data-model');
    // Existing extracted fixtures cover synchronous mutation oracles. The full-source
    // suite in verified-bugs.test.js separately verifies ownership, async I/O and guards.
    if (!context.beginDataMutation) context.beginDataMutation = () => ({});
    if (!context.finishDataMutation) context.finishDataMutation = () => {};
    if (!context.saveMutationNow) context.saveMutationNow = (_token, ...args) => context.saveNow(...args);
    if (!Object.prototype.hasOwnProperty.call(context, 'activeDataMutation')) context.activeDataMutation = {};
    if (!Object.prototype.hasOwnProperty.call(context, 'undoSession')) context.undoSession = 0;
    if (!context.clearSessionUndo) context.clearSessionUndo = () => { context.undoSession++; if (context.undoStack) context.undoStack.length = 0; };
    if (!context.clearImportCandidate) context.clearImportCandidate = () => {
        context.importedData = []; context.importColumnMap = {};
        const button = context.$?.('import-confirm-btn'); if (button) button.disabled = true;
    };
    if (!context.toFiniteNumber) context.toFiniteNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    if (!context.setStatMoney) context.setStatMoney = (element, value) => {
        if (element) element.innerText = context.money ? context.money(value) : String(value);
    };
    if (!context.scheduleStatMoneyFit) context.scheduleStatMoneyFit = () => {};
    if (!context.fitCartMoneyInputs) context.fitCartMoneyInputs = () => {};
    if (!context.getStockHistoryDisplayDate) context.getStockHistoryDisplayDate = value => {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('vi-VN');
    };
    if (!context.isViewActive) context.isViewActive = () => true;
    if (!context.canMutateManagement) context.canMutateManagement = () => true;
    if (!context.hasDesktopStorage) context.hasDesktopStorage = () => false;
    if (!Object.prototype.hasOwnProperty.call(context, 'desktop')) context.desktop = null;
    if (!Object.prototype.hasOwnProperty.call(context, 'cust')) context.cust = null;
    if (!Object.prototype.hasOwnProperty.call(context, 'invoiceTabs')) context.invoiceTabs = [];
    if (!context.beginInventoryCommit) context.beginInventoryCommit = () => ({});
    if (!context.saveInventoryCommit) context.saveInventoryCommit = () => true;
    if (!context.beginHistoryCommit) context.beginHistoryCommit = () => ({});
    if (!context.saveHistoryCommit) context.saveHistoryCommit = () => true;
    if (!context.canMutateOperationalData) context.canMutateOperationalData = () => true;
    if (!context.getCurrentUserRecord) context.getCurrentUserRecord = () => {
        if (!context.isAuthenticated || !context.currUser) return null;
        return context.db?.users?.find(user => context.sameStoredId(user?.id, context.currUser.id)) || null;
    };
    if (!context.saveNow) context.saveNow = () => true;
    vm.createContext(context);
    vm.runInContext(between('function sameStoredId(', '\nfunction isValidAdminAccount('), context);
    vm.runInContext(between('function getSupplierDebt(', '\nfunction updateSupplierSortUI('), context);
    vm.runInContext(between('function getEditedInvoiceTotals(', '\nfunction recalcEditInvoice('), context);
    if (context.undoStack) {
        if (context.isAuthenticated === undefined) context.isAuthenticated = true;
        if (!context.currUser) context.currUser = { id: 'TEST-ADMIN', role: 'admin' };
        if (context.currUser.id === undefined) context.currUser.id = 'TEST-ADMIN';
        if (context.currUser.role === undefined) context.currUser.role = 'admin';
        if (context.db && !context.db.users) context.db.users = [context.currUser];
        const stamp = action => {
            if (Object.values(context.UNDO_ACTIONS || {}).includes(action?.type)) {
                action.owner = context.currUser.id; action.session = context.undoSession;
            }
        };
        context.undoStack.forEach(stamp);
        if (context.pushUndo) {
            const push = context.pushUndo;
            context.pushUndo = (...args) => { const result = push(...args); stamp(context.undoStack.at(-1)); return result; };
        }
    }
    if (!context.normalizeSettingsSearchText) vm.runInContext(between('function normalizeSettingsSearchText(', '\nfunction clearSettingsSearch'), context);
    return context;
}

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
    vm.runInContext(between('function normalizeMinWholesaleQty(', '\nasync function listBackupFiles('), context);

    const valid = context.normalizeDataShape({
        products: [{ id: 'P-OLD', name: 'Legacy', minWholesaleQty: '12' }], users: [{ id: 7, user: 'admin-old', pass: 'keep-this', role: 'admin' }]
    });
    assert.deepEqual(JSON.parse(JSON.stringify(valid.users)), [{ id: 7, user: 'admin-old', pass: 'keep-this', role: 'admin' }]);
    assert.equal(valid.products[0].minWholesaleQty, 12);
    assert.equal(valid.products[0].stock, 0);
    const normalizedStock = context.normalizeDataShape({
        products: [{ id: 'P-STOCK', name: 'Stock', stock: '5' }, { id: 'P-INVALID', name: 'Invalid stock', stock: 'not-a-number' }],
        users: [{ id: 7, user: 'admin-old', pass: 'keep-this', role: 'admin' }]
    });
    assert.deepEqual(normalizedStock.products.map(product => product.stock), [5, 0]);
    const normalizedCustomer = context.normalizeDataShape({
        products: [], users: [{ id: 7, user: 'admin-old', pass: 'keep-this', role: 'admin' }],
        custs: [{ id: 'C-LEGACY', name: 'Khách cũ', points: '12', debt: '10000', totalBuy: '25000' }]
    });
    assert.deepEqual(
        JSON.parse(JSON.stringify(normalizedCustomer.custs[0])),
        { id: 'C-LEGACY', name: 'Khách cũ', points: 12, debt: 10000, totalBuy: 25000 }
    );
    for (const invalidCustomer of [null, [], { id: 'C-1' }, { id: 'C-2', name: '   ' }]) {
        assert.throws(
            () => context.loadJsonDataText(JSON.stringify({
                products: [], custs: [invalidCustomer],
                users: [{ id: 7, user: 'admin-old', pass: 'keep-this', role: 'admin' }]
            })),
            /Dữ liệu khách hàng không hợp lệ/
        );
    }
    assert.throws(
        () => context.normalizeDataShape({ products: [], users: [{ id: 2, user: 'staff', pass: 'x', role: 'staff' }] }),
        /admin hợp lệ/
    );
    for (const field of ['users', 'suppliers', 'stockHistory']) {
        for (const invalidRecord of [null, []]) {
            assert.throws(
                () => context.loadJsonDataText(JSON.stringify({
                    products: [], users: [{ id: 7, user: 'admin-old', pass: 'keep-this', role: 'admin' }],
                    [field]: field === 'users' ? [invalidRecord] : [invalidRecord]
                })),
                /Dữ liệu (users|suppliers|stockHistory) không hợp lệ/
            );
        }
    }
    const validLegacyRecords = context.normalizeDataShape({
        products: [], users: [{ id: 7, user: 'admin-old', pass: 'keep-this', role: 'admin' }],
        suppliers: [{ id: 'S-LEGACY' }], stockHistory: [{ id: 'H-LEGACY' }]
    });
    assert.equal(validLegacyRecords.suppliers[0].id, 'S-LEGACY');
    assert.equal(validLegacyRecords.stockHistory[0].id, 'H-LEGACY');
    for (const invalidProduct of [null, []]) {
        assert.throws(
            () => context.loadJsonDataText(JSON.stringify({ products: [invalidProduct], users: [{ id: 7, user: 'admin-old', pass: 'keep-this', role: 'admin' }] })),
            /Dữ liệu sản phẩm không hợp lệ/
        );
    }
});

test('POS restore rejects malformed line items before they can reach the return renderer', () => {
    const context = {
        cloneDefaultData: () => ({
            products: [], users: [{ id: 1, user: 'admin', pass: 'safe', role: 'admin' }], custs: [], invoices: [], returns: [],
            suppliers: [], stockHistory: [], activityLog: [], purchaseOrders: [], categories: [], settings: {}, drafts: { invoices: [], purchaseOrders: [], products: [] }
        }),
        normalizeShortcutSettings: () => ({}), saveCalls: 0, saveNow: () => { context.saveCalls++; return true; }
    };
    createTestContext(context);
    vm.runInContext(between('function normalizeMinWholesaleQty(', '\nasync function listBackupFiles('), context);
    const validUser = { id: 1, user: 'admin', pass: 'safe', role: 'admin' };
    const makeData = extra => ({ products: [], users: [validUser], invoices: [], returns: [], drafts: { invoices: [] }, ...extra });

    const legacy = context.loadJsonDataText(JSON.stringify(makeData({
        invoices: [{ id: 'LEGACY-1' }, { id: 'INV-1', items: [{ id: 'P-1', qty: '2', price: '100' }] }]
    })));
    assert.equal(Object.hasOwn(legacy.invoices[0], 'items'), false);
    assert.equal(legacy.invoices[1].items[0].qty, 2);
    assert.equal(legacy.invoices[1].items[0].price, 100);

    const legacyPO = context.loadJsonDataText(JSON.stringify(makeData({
        purchaseOrders: [{ id: 'PO-LEGACY' }, { id: 'PO-VALID', items: [{ productId: 'P-1', qty: '2', price: '100', total: '200', sellPrice: '150' }] }],
        drafts: { invoices: [], purchaseOrders: [{ id: 'DRAFT-PO', data: { items: [{ productId: 'P-1', qty: '2', price: '100' }] } }], products: [] }
    })));
    assert.equal(Object.hasOwn(legacyPO.purchaseOrders[0], 'items'), false);
    assert.equal(legacyPO.purchaseOrders[1].items[0].sellPrice, 150);

    const maliciousQty = '<img src=x onerror="window.__posXss=1">';
    const invalidCases = [
        makeData({ invoices: [null] }),
        makeData({ invoices: [{ items: [null] }] }),
        makeData({ invoices: [{ items: [{ qty: maliciousQty, price: 100 }] }] }),
        makeData({ returns: [{ returnItems: 'not-an-array' }] }),
        makeData({ drafts: { invoices: [{ data: { items: [{ qty: 1, price: 'NaN' }] } }] } }),
        makeData({ purchaseOrders: [null] }),
        makeData({ purchaseOrders: [{ items: [{ qty: maliciousQty, price: 100 }] }] }),
        makeData({ drafts: { purchaseOrders: [{ data: { items: [{ qty: 1, price: 'Infinity' }] } }] } })
    ];
    invalidCases.forEach(data => assert.throws(() => context.loadJsonDataText(JSON.stringify(data)), /Dữ liệu/));
    assert.equal(context.saveCalls, 0);

    const elements = new Map([
        ['return-invoice-search', { value: 'INV-XSS' }], ['return-recent-orders', { style: {} }], ['return-inv-id', {}],
        ['return-inv-date', {}], ['return-inv-cust', {}], ['return-inv-total', {}], ['return-inv-method', {}],
        ['return-inv-items-summary', { innerHTML: '' }], ['modal-return-items-list', { innerHTML: '' }], ['return-invoice-info', { style: {} }]
    ]);
    const renderer = {
        db: { invoices: [{ id: 'INV-XSS', date: '2026-01-01T00:00:00Z', cust: 'Khách lẻ', total: 0, method: 'CASH', items: [{ id: 'P-1', name: 'An toàn', qty: maliciousQty, price: 100 }] }], returns: [] },
        $: id => elements.get(id) || null, toast: (message, type) => renderer.toasts.push({ message, type }), toasts: [],
        money: value => String(value), formatQty: value => String(value), escapeHtml: value => String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        escapeAttr: value => String(value).replace(/"/g, '&quot;'), updateReturnRefund: () => {}
    };
    createTestContext(renderer);
    vm.runInContext(between('function searchInvoiceForReturn()', '\nfunction toggleAllReturnItems('), renderer);
    renderer.searchInvoiceForReturn();
    assert.match(renderer.toasts[0].message, /thiếu hoặc sai dữ liệu/);
    assert.equal(elements.get('return-inv-items-summary').innerHTML, '');
    assert.equal(elements.get('modal-return-items-list').innerHTML, '');
});

test('wholesale minimum is normalized before pricing and product-table HTML rendering', () => {
    const tbody = {
        html: '',
        set innerHTML(value) { this.html = value; },
        get innerHTML() { return this.html; }
    };
    const context = {
        db: { settings: { lowStock: 5 }, products: [{ id: 'P-1', name: 'An toàn', code: 'SAFE', cat: 'Khác', stock: 1, price: 1000, cost: 10, wholesalePrice: 1, minWholesaleQty: '<img src=x onerror="window.__auditXss=1">' }] },
        $: id => id === 'prod-body' ? tbody : null,
        updateProductFilterUI: () => {}, selectedProducts: new Set(), updateBulkDeleteUI: () => {},
        isAuthenticated: true, currUser: { role: 'admin' }, getFilteredProductsForTable: () => context.db.products,
        prodTablePage: 0, PROD_PAGE_SIZE: 100, isAdminUser: () => true, getProductStatusBadge: () => '', escapeHtml: String, escapeAttr: String, escapeJsArgument: value => `'${value}'`,
        safeImageSrc: () => '', money: value => String(value), formatQty: value => String(value)
    };
    createTestContext(context);
    vm.runInContext(between('function normalizeMinWholesaleQty(', '\nfunction isValidAdminAccount('), context);
    vm.runInContext(between('function getEffectivePrice(', '\n// FIX: Wrapper function'), context);
    vm.runInContext(between('// Keep the existing row geometry;', '\nfunction renderProdTable()'), context);
    vm.runInContext(between('function renderProdTable(', '\nfunction openProdModal'), context);

    assert.equal(context.normalizeMinWholesaleQty('12'), 12);
    for (const invalidValue of ['', 0, -1, 'not-a-number', Infinity]) assert.equal(context.normalizeMinWholesaleQty(invalidValue), 10);
    assert.equal(context.getEffectivePrice(context.db.products[0], 9, null).type, 'retail');
    assert.equal(context.getEffectivePrice(context.db.products[0], 10, null).type, 'wholesale');
    context.renderProdTable();
    assert.match(tbody.innerHTML, /≥10/);
    assert.doesNotMatch(tbody.innerHTML, /auditXss|<img/);
});

test('renderer reuses the SheetJS global without a lexical binding collision', () => {
    const preamble = source.slice(0, source.indexOf('const hasDesktopStorage'));
    const context = { window: { ntkiot: null, JsBarcode: null, XLSX: {} } };
    vm.createContext(context);
    vm.runInContext('var XLSX = window.XLSX;', context);

    assert.doesNotMatch(preamble, /\b(?:const|let)\s+XLSX\s*=/);
    assert.doesNotThrow(() => vm.runInContext(preamble, context));
});

test('login accepts only exact string credentials', () => {
    const fields = new Map([
        ['log-u', { value: 'legacy', focus: () => {}, select: () => {} }],
        ['log-p', { value: '', focus: () => {}, select: () => {} }]
    ]);
    const context = {
        db: { users: [{ id: 1, user: 'legacy', pass: 0, role: 'staff' }, { id: 2, user: 'staff', pass: '123', role: 'staff', name: 'Nhân viên' }] },
        $: id => fields.get(id) || null,
        updateAuthPanel: () => {}, closeModal: () => {}, renderNav: () => {}, router: () => {}, logActivity: () => {},
        toast: (message, type) => { context.lastToast = { message, type }; }
    };
    createTestContext(context);
    vm.runInContext(between('function login()', '\nfunction logout()'), context);

    context.login();
    assert.equal(context.isAuthenticated, false);
    assert.equal(context.currUser, null);
    assert.equal(context.lastToast.type, 'error');

    fields.get('log-u').value = 'staff';
    fields.get('log-p').value = '123';
    context.login();
    assert.equal(context.isAuthenticated, true);
    assert.equal(context.currUser.id, 2);
});

test('legacy invoices with missing items render as empty and cannot mutate linked data', () => {
    const legacyInvoice = { id: 'LEGACY-1', total: 120000, custId: 9 };
    const context = {
        db: { invoices: [legacyInvoice], returns: [], products: [], stockHistory: [], custs: [] },
        toast: message => { context.lastToast = message; },
        blockLinkedInvoiceDeletion: () => { throw new Error('linked-data mutation guard must run first'); },
        $: () => null
    };
    createTestContext(context);
    vm.runInContext(between('function sameStoredId(', '\nfunction isValidAdminAccount('), context);
    vm.runInContext(between('function deleteInvoice(', '\n// EDIT INVOICE FEATURE'), context);

    assert.deepEqual(plain(context.getInvoiceItems(legacyInvoice)), []);
    assert.equal(context.hasIncompleteInvoiceItems(legacyInvoice), true);
    context.deleteInvoice('LEGACY-1');
    assert.equal(context.db.invoices.length, 1);
    assert.match(context.lastToast, /chỉ có thể xem hoặc in/);
    assert.match(source, /<td>\$\{getInvoiceItems\(i\)\.length\} mặt hàng<\/td>/);
    assert.match(source, /getInvoiceItems\(inv\)\.map/);
    assert.match(source, /const items = getInvoiceItems\(inv\);/);
    assert.match(source, /const canMutateInvoice = !hasIncompleteInvoiceItems\(i\);/);
    assert.match(source, /editButton\.style\.display = hasIncompleteInvoiceItems\(inv\) \? 'none' : ''/);
});

test('modal controls, clickable cards, labels, and contrast fixes remain accessible', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');

    assert.doesNotMatch(html, /<span[^>]*onclick="closeModal\(/);
    assert.match(html, /<button type="button" class="modal-close"[^>]*data-icon-tooltip="Đóng"[^>]*aria-label="Đóng" onclick="closeModal\(/);
    assert.match(html, /<button type="button" class="help-item-header"/);
    assert.match(source, /function initAccessibilityEnhancements\(\)/);
    assert.match(source, /data-a11y-clickable/);
    assert.match(source, /syncSettingsSectionAria/);
    assert.match(source, /syncHelpSectionAria/);
    const returnToggleCss = css.slice(css.indexOf('.btn-return-toggle {'), css.indexOf('.btn-return-toggle:hover'));
    const lowStockBadgeCss = css.slice(css.indexOf('.p-card.low-stock::after {'), css.indexOf('.p-card.out-stock {'));
    const outStockBadgeCss = css.slice(css.indexOf('.p-card.out-stock-clickable::after {'), css.indexOf('/* Negative stock card styling */'));
    assert.match(returnToggleCss, /color: #111827;/);
    assert.match(lowStockBadgeCss, /color: #111827;/);
    assert.match(outStockBadgeCss, /color: #111827;/);
    assert.match(css, /\.rank-badge\.rank-top \{[\s\S]*?color: #111827;/);
    assert.match(css, /\.rank-badge\.rank-worst \{[\s\S]*?#475569, #334155/);
    assert.match(css, /\.invoice-tab\[data-mode="return"\] \.tab-badge \{[\s\S]*?#c2410c/);
});

test('icon-only controls use the shared delayed tooltip registry without persistence', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
    const tooltipSource = source.slice(source.indexOf('const ICON_TOOLTIP_DELAY_MS'), source.indexOf('function syncSidebarToggleTooltip()'));
    const modalCloseButtons = [...html.matchAll(/<button\b[^>]*class="[^"]*\bmodal-close\b[^"]*"[^>]*>/g)].map(match => match[0]);

    assert.match(tooltipSource, /const ICON_TOOLTIP_DELAY_MS = 1500;/);
    assert.match(tooltipSource, /addEventListener\('pointerover', onPointerOver\)/);
    assert.match(tooltipSource, /addEventListener\('pointerout', onPointerOut\)/);
    assert.match(tooltipSource, /addEventListener\('pointerdown', hide, true\)/);
    assert.match(tooltipSource, /addEventListener\('click', hide, true\)/);
    assert.match(tooltipSource, /addEventListener\('scroll', hide, true\)/);
    assert.match(tooltipSource, /setTimeout\(\(\) => show\(next\), ICON_TOOLTIP_DELAY_MS\)/);
    assert.match(tooltipSource, /tooltip\.textContent = element\.dataset\.iconTooltip/);
    assert.match(tooltipSource, /position:fixed/);
    assert.match(tooltipSource, /@media print/);
    assert.doesNotMatch(tooltipSource, /saveNow\(|\bdb\b|localStorage/);
    assert.match(css, /\.icon-tooltip \{/);
    assert.match(css, /pointer-events: none;/);

    assert.equal(modalCloseButtons.length, 29);
    modalCloseButtons.forEach(button => {
        assert.match(button, /data-icon-tooltip="Đóng"/);
        assert.match(button, /aria-label="Đóng"/);
        assert.doesNotMatch(button, /\btitle=/);
    });

    for (const label of [
        'Thu gọn menu', 'Dạng lưới', 'Dạng danh sách', 'Dạng chi tiết', 'Đổi/trả', 'Tạm giữ đơn',
        'Mở đơn tạm', 'Thêm đơn', 'Tạo mã', 'Thêm danh mục', 'Lưu danh mục', 'Hủy',
        'Giảm số lượng', 'Tăng số lượng', 'In tem', 'In phiếu', 'Xóa lịch sử', 'Xóa hóa đơn',
        'Xóa phiếu trả', 'Tháng trước', 'Tháng sau', 'Xóa đơn nhập', 'Xóa khỏi đơn',
        'Xóa bản nháp', 'Xóa sản phẩm'
    ]) {
        const attr = `data-icon-tooltip="${label}"`;
        assert.ok(html.includes(attr) || source.includes(attr), `Missing icon tooltip label: ${label}`);
    }

    assert.match(source, /const label = sidebar\.classList\.contains\('collapsed'\) \? 'Mở menu' : 'Thu gọn menu';/);
    const desktopSidebarCss = css.slice(css.indexOf('@media (min-width: 769px) {'), css.indexOf('nav button::before {'));
    assert.match(desktopSidebarCss, /\.sidebar-toggle \{\s*top: 12px;\s*right: 10px;\s*width: 28px;\s*height: 36px;\s*transform: none;\s*border-radius: 8px;/);
    assert.match(desktopSidebarCss, /\.sidebar-toggle:hover \{\s*right: 10px;\s*width: 28px;/);
    assert.match(desktopSidebarCss, /aside\.collapsed \.sidebar-toggle \{\s*right: 0;\s*width: 24px;\s*transform: rotate\(180deg\);/);
    assert.match(desktopSidebarCss, /aside\.collapsed \.brand \{\s*padding: 0 0 0 8px;\s*justify-content: flex-start;/);
    assert.match(desktopSidebarCss, /aside\.collapsed \.brand-icon \{\s*flex: 0 0 24px;\s*margin-left: 0;/);
    assert.doesNotMatch(desktopSidebarCss, /padding-right: 42px|aside:not\(\.collapsed\) nav|padding: 12px 30px 12px 6px|padding-inline: 0/);
    assert.equal((source.match(/initIconTooltips\(iframeDoc\)/g) || []).length, 11);
    assert.equal((source.match(/class="btn-close" id="close-btn" data-icon-tooltip="Đóng" aria-label="Đóng">✕<\/button>/g) || []).length, 6);
    assert.doesNotMatch(html.match(/id="hold-btn"[^>]*>/)?.[0] || '', /\btitle=/);
    assert.doesNotMatch(html.match(/class="btn-return-toggle"[^>]*>/)?.[0] || '', /\btitle=/);
});

test('an invalid primary data file is never replaced from localStorage without a valid backup', () => {
    const context = {
        desktop: { data: {
            loadPrimary: () => ({ ok: true, primary: { exists: true, text: '{invalid' } }),
            loadBak: () => ({ ok: true, backup: { exists: false } })
        } },
        listBackupFiles: () => [],
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
        'function renderHist(', 'function renderReturnsHistory(', 'function renderPOHistory()', 'function renderStockHistory()',
        'function renderInventoryStockHistory()', 'function renderUsers()',
        'function renderDraftsModalList()'
    ]) assert.ok(source.includes(marker), `Missing renderer ${marker}`);

    assert.match(source, /const escapeJsArgument = value => escapeAttr/);
    assert.match(source, /CSS\.escape\(returnId\)/);
    assert.match(source, /CSS\.escape\(invoiceId\)/);
    assert.doesNotMatch(source, /(?:viewInvoice|deleteInvoice|printReturnSlip|deletePurchaseOrder)\('\$\{(?:i|r|po)\.id\}'\)/);
});

test('shared stock-history row renderer keeps price and total currency on one line', () => {
    const rowRenderer = source.slice(source.indexOf('function renderStockHistoryRows('), source.indexOf('function renderStockHistory()'));
    const moneyCells = /<td class="money-cell stock-history-money">\$\{toFiniteNumber\(h\.(?:price|total)\) \? money\(toFiniteNumber\(h\.(?:price|total)\)\) : '-'\}<\/td>/g;

    assert.equal((rowRenderer.match(moneyCells) || []).length, 2);
});

test('stock-history presentation shortens only system notes without mutating stored history', () => {
    const context = {};
    createTestContext(context);
    vm.runInContext(between('function getStockHistoryDisplayNote(', '\nfunction renderStockHistoryRows('), context);

    const entries = [
        { source: 'sale', note: 'Bán hàng - HĐ 123' },
        { source: 'return', note: 'Hoàn kho - HĐ 123' },
        { source: 'exchange', note: 'Xuất hàng đổi' },
        { source: 'purchase_order', note: 'Đơn nhập: PN001' },
        { source: 'adjustment', note: 'Điều chỉnh tồn kho' },
        { source: 'invoice_edit', note: 'Sửa hóa đơn' },
        { source: 'manual_out', type: 'out', note: 'Hỏng do vận chuyển' },
        { type: 'in', note: '' }
    ];
    const before = plain(entries);

    assert.deepEqual(entries.map(context.getStockHistoryDisplayNote), [
        'Bán hàng', 'Hoàn kho', 'Đổi hàng', 'Đơn nhập', 'Điều chỉnh kho', 'Sửa hóa đơn',
        'Hỏng do vận chuyển', 'Nhập kho'
    ]);
    assert.equal(context.getStockHistoryDisplayDate('2026-09-23T14:35:00Z').includes(':'), false);
    assert.equal(context.getStockHistoryDisplayDate('not-a-date'), '-');
    assert.deepEqual(plain(entries), before, 'display labels never rewrite stock-history snapshots');
});

test('management UI hierarchy is presentation-only and scoped to approved controls', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
    const reportModal = html.slice(html.indexOf('id="report-viewer-modal"'), html.indexOf('<div id="toast-box"'));

    assert.match(html, /class="d-flex gap-1 management-inventory-actions"/);
    assert.match(html, /class="btn mgmt-action-primary" onclick="openPurchaseOrderModal/);
    assert.match(html, /class="stock-history-table"/);
    assert.equal((html.match(/class="stock-history-table"/g) || []).length, 1);
    assert.match(html, /class="po-history-filters mb-2"/);
    assert.match(html, /class="po-date-range"/);
    assert.match(html, /class="modal-footer management-modal-footer inventory-check-footer"/);
    assert.match(html, /class="modal management-modal" style="width:800px/);
    assert.match(html, /class="modal-body report-viewer-body"/);
    assert.doesNotMatch(reportModal, /min-height:550px/);
    assert.match(css, /\.stock-history-table \{ min-width: 1080px; table-layout: fixed; \}/);
    assert.match(css, /\.po-view-header-info \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(css, /\.mgmt-report-kpis \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(160px, 1fr\)\)/);
    assert.match(css, /\.mgmt-report-table-wrap thead th \{ position: sticky/);
    assert.match(css, /\.bulk-stock-option:has\(input:checked\)/);
    const stockHistoryDisplayHelper = source.slice(source.indexOf('function getStockHistoryDisplayNote('), source.indexOf('function renderStockHistoryRows('));
    assert.match(stockHistoryDisplayHelper, /function getStockHistoryDisplayNote\(entry\)/);
    assert.match(source, /class="btn btn-sm btn-primary" onclick="event\.stopPropagation\(\);viewPurchaseOrder/);
    assert.match(source, /class="btn btn-sm po-payment-button"/);
    assert.doesNotMatch(stockHistoryDisplayHelper, /saveNow\(/);
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

test('UI-01/UI-02: zero invoice and customer IDs remain selected, visible, durable, and rollback-safe', async () => {
    for (const id of [0, '0']) {
        const context = makeHistoryEditContext({ invoiceId: id });
        context.db.custs.push({ id, name: `Khách ${id}`, points: 125, totalBuy: 100000, debt: 0 });
        context.db.invoices[0].cust = 'Snapshot cũ';
        context.db.invoices[0].custId = id;
        context.renderEditInvoiceItems = () => {};
        context.recalcEditInvoice = () => {};
        context.openEditInvoice(id);
        assert.match(context.openedModal, new RegExp(`Chỉnh sửa hóa đơn #${id}`));
        assert.match(context.openedModal, new RegExp(`value=\"${id}\" selected`));
        assert.doesNotMatch(context.openedModal, /value="1" selected/);

        context.$('edit-inv-cust').value = String(id);
        await context.saveEditInvoice();
        assert.equal(context.db.invoices[0].id, id);
        assert.equal(context.db.invoices[0].custId, id);
        assert.equal(context.db.custs[1].points, 125);
        assert.equal(context.db.custs[1].totalBuy, 100000);
        assert.equal(context.saveNowCount, 1);

        const failed = makeHistoryEditContext({ invoiceId: id, saveResult: false });
        failed.db.custs.push({ id, name: `Khách ${id}`, points: 125, totalBuy: 100000, debt: 0 });
        failed.db.invoices[0].custId = id;
        failed.$('edit-inv-cust').value = String(id);
        setEditedInvoiceItems(failed, id);
        const before = plain(failed.db);
        await failed.saveEditInvoice();
        assert.deepEqual(plain(failed.db), before);
        assert.equal(failed.closed, undefined);
    }
});

test('UI-08: light semantic foregrounds stay scoped and meet the verified contrast floor', () => {
    const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
    assert.match(css, /--success-on-light:\s*#047857/);
    assert.match(css, /--warning-on-light:\s*#92400E/);
    assert.match(css, /\.badge-success\s*\{[\s\S]*?color:\s*var\(--success-on-light\)/);
    assert.match(css, /\.badge-warning\s*\{[\s\S]*?color:\s*var\(--warning-on-light\)/);
    assert.match(css, /\.mgmt-action-in\s*\{[\s\S]*?color:\s*var\(--success-on-light\)/);
    assert.match(css, /\.mgmt-action-out\s*\{[\s\S]*?color:\s*var\(--warning-on-light\)/);
    assert.match(css, /#toast-box\s*\{[\s\S]*?pointer-events:\s*none;/);
    assert.match(css, /#toast-box \.toast\s*\{\s*pointer-events:\s*none;/);
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
        { id: 'RET-EXPLICIT', date: '2026-01-01T10:00:00Z', cust: 'C', staff: 'Admin', returnTotal: 50000, exchangeTotal: 20000, difference: 10000, returnItems: [], exchangeItems: [] },
        { id: 'RET-EQUAL', date: '2026-01-01T11:00:00Z', cust: 'D', staff: 'Admin', difference: 0, returnItems: [], exchangeItems: [] }
    ];
    const context = {
        db: { returns: plain(returns), custs: [], settings: { name: 'Cửa hàng' } }, $: id => elements.get(id) || null,
        getAppDate: () => new Date('2026-01-01T12:00:00Z'), money: value => String(value), formatQty: value => String(value),
        getReturnItemTotal: undefined, escapeHtml: value => String(value), escapeAttr: value => String(value), escapeJsArgument: value => JSON.stringify(value),
        sameStoredId: (left, right) => String(left) === String(right), openModal: () => {}, selectedReturns: new Set(),
        compareVietnameseText: (left, right) => String(left || '').localeCompare(String(right || ''), 'vi', { sensitivity: 'base' }),
        document: { querySelectorAll: () => [] }, updateBulkDeleteUI: () => {}, parseLocalDateInput: (value, end) => new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`)
    };
    createTestContext(context);
    vm.runInContext(between('function getReturnItemTotal(', '\nfunction captureReturnArrayState('), context);
    vm.runInContext(between('const historySortStates =', '\n// Toggle returns row expansion'), context);
    vm.runInContext(between('function viewReturnDetail(', 'function printReturnSlip('), context);

    assert.deepEqual(plain(context.getReturnDisplayTotals(returns[0])), { returnTotal: 45000, exchangeTotal: 0, difference: 45000 });
    assert.deepEqual(plain(context.getReturnDisplayTotals(returns[1])), { returnTotal: 20000, exchangeTotal: 50000, difference: -30000 });
    assert.deepEqual(plain(context.getReturnDisplayTotals(returns[2])), { returnTotal: 50000, exchangeTotal: 20000, difference: 10000 });
    context.renderReturnsHistory();
    assert.equal(elements.get('returns-total-refund').innerText, '55000');
    assert.equal(elements.get('returns-total-collected').innerText, '30000');
    assert.match(elements.get('returns-body').innerHTML, /color:#22c55e">45000/);
    assert.match(elements.get('returns-body').innerHTML, /color:#ef4444">30000/);
    assert.match(elements.get('returns-body').innerHTML, /color:var\(--text-muted\)">0/);
    assert.doesNotMatch(elements.get('returns-body').innerHTML, /Hoàn khách:|Thu thêm:|Ngang giá/);
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
        applyTheme: () => {}, applyUISize: () => {}, updateTimeOverrideBadge: () => {}, renderNav: () => {}, setupGlobalShortcuts: () => {}, setupEnterKeyHandlers: () => {},
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
    const invoice = { id: invoiceId, total: invoiceQty * 100, cust: 'Khách A', custId: 9, items: [{ id: 10, name: 'A', price: 100, qty: invoiceQty, unit: 'SP' }] };
    const context = {
        db: { invoices: [plain(invoice)], products: [{ id: 10, name: 'A', stock: 5 }], stockHistory: [], returns: [], activityLog: [], settings: { pointsEnabled: false } },
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
    vm.runInContext(between('function linkedReturnControlKey(', '\n// HISTORY & REPORTS'), context);
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
    // Canonical baseline is unchanged except line endings and notification metadata.
    const invoicePreview = between('function printInv(inv)', '\n// Alias for keyboard shortcuts')
        .replace(/\r/g, '').replace(/, true, "[\w.-]+"(?=\))/g, '')
        .replace("String(inv.id ?? '')", "String(inv.id || '')");
    assert.equal(crypto.createHash('sha256').update(invoicePreview).digest('hex'), '88357be45d5b9e5048ac8d6aba41e5377acc6eaa5a0e74b0aca255c26f2cf2cc');
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
    assert.deepEqual(context.rendered, ['pos', 'inventory', 'stock', 'history', 'returns', 'management', 'staff']);
    assert.equal(context.toasts.at(-1).type, 'success');
});

test('return deletion preserves state when canceled or not durable, and handles missing inventory safely', () => {
    const canceled = makeDeleteReturnContext({ confirmResult: false });
    const beforeCanceled = plain(canceled.db);
    canceled.deleteReturn(100);
    assert.deepEqual(plain(canceled.db), beforeCanceled);
    assert.equal(canceled.saveCalls, 0);

    const incomplete = makeDeleteReturnContext({ missingProduct: true });
    incomplete.deleteReturn(100);
    assert.equal(incomplete.db.returns.length, 0);
    assert.deepEqual(plain(incomplete.db.products.map(product => product.stock)), [10]);
    assert.equal(incomplete.db.invoices[0].id, 'INV-2');
    assert.match(incomplete.confirmMessage, /Kho của sản phẩm còn tồn tại/);
    assert.match(incomplete.toasts.at(-1).message, /Không điều chỉnh tồn kho cho 1 dòng/);

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
    assert.match(html, /id="hist-staff-search" placeholder="🔍 Mã HĐ, khách hàng, NV, sản phẩm\.\.\." aria-label="Tìm mã hóa đơn, khách hàng, nhân viên hoặc sản phẩm"/);
    assert.match(html, /id="returns-staff-search" placeholder="🔍 Mã phiếu, HĐ gốc, khách, NV, sản phẩm\.\.\." aria-label="Tìm mã phiếu, hóa đơn gốc, khách hàng, nhân viên hoặc sản phẩm"/);
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
    assert.match(html, /<div class="table-wrap">\s*<table class="history-table history-returns-table">\s*<thead>\s*<tr>\s*<th style="width:40px;text-align:center;">\s*<input type="checkbox"\s*id="select-all-returns"/);
    assert.doesNotMatch(html, /<input type="date" id="returns-date-/);
    assert.doesNotMatch(source, /function renderReturns\(|function renderReturnsSection\(|function toggleReturnsSection\(/);
    assert.match(source, /<td class="money-cell" style="font-weight:700;color:var\(--primary\)">\$\{money\(toFiniteNumber\(i\.total\)\)\}/);
    assert.match(source, /<td class="money-cell history-line-total" style="font-weight:500;color:var\(--primary\);">\$\{money\(itemLineTotal\)\}/);
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
        getReturnItemTotal: undefined, exportToExcel: (data, headers, filename) => { exportContext.exported = { data, headers, filename }; },
        compareVietnameseText: (left, right) => String(left || '').localeCompare(String(right || ''), 'vi', { sensitivity: 'base' })
    };
    createTestContext(exportContext);
    vm.runInContext(between('function getReturnItemTotal(', '\nfunction captureReturnArrayState('), exportContext);
    vm.runInContext(between('const historySortStates =', '\n// Toggle returns row expansion'), exportContext);
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
        assert.match(body, /if \(!await saveReturnAndPreview\(returnRecord\.id, returnCommit\)\) return;/);
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
        draftId: 'DRAFT-source', savedFingerprint: 'saved', dirty: false,
        returnItems: [], exchangeItems: [], isReturnExchangeMode: false, activeReturnCart: 'return'
    };
    const context = {
        db: {
            users: [{ id: 'U-1', name: 'Admin', role: 'admin' }], products: [product], custs: [customer], invoices: [], returns: [], stockHistory: [], activityLog: [],
            settings: { pointsEnabled: true, pointsRate: 1, autoPrint }
        },
        cart: [{ ...cartItem }], cust: customer, invoiceTabs: [tab], activeTabId: 1,
        returnItems: [], exchangeItems: [], isReturnExchangeMode: false, activeReturnCart: 'return', undoStack: [],
        saveBlockedReason, saveBlockedToastShown: false, saveSuppressed, _saveInProgress: saveInProgress,
        window: { orderNote: 'Giữ nguyên' }, isAuthenticated: true, currUser: { id: 'U-1', name: 'Admin', role: 'admin' },
        $: id => elements.get(id) || null,
        toast: (message, type) => { context.toasts.push({ message, type }); }, toasts: [], saveCalls: 0,
        saveNow: () => { context.saveCalls++; return saveResult; },
        validateCartItems: () => true,
        syncCustomerFromInput: () => {
            context.cust = context.db.custs[0];
            const active = context.invoiceTabs[0];
            active.cust = { ...context.cust };
            return context.cust;
        },
        getEffectivePrice: item => ({ price: item.price, type: 'retail' }),
        getCartPointsUsage: () => ({ pointsUsed: 0, pointsValue: 0 }),
        getAppDate: () => new Date('2026-01-01T00:00:00Z'), getStaffDisplayName: () => 'Admin',
        money: value => String(value), logActivity: (action, detail) => context.db.activityLog.unshift({ action, detail }),
        printInv: () => { context.printCalls++; }, printCalls: 0,
        playSuccessSound: () => { context.soundCalls++; }, soundCalls: 0,
        consumeInvoiceDraftAfterCheckout: () => { context.draftCleanupCalls++; }, draftCleanupCalls: 0,
        closeCompletedSaleTab: () => false,
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
        assert.equal(context.draftCleanupCalls, 0);
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

test('operational mutation roots reject guest and stale sessions before snapshots or persistence', () => {
    const rootSpecs = [
        ['beginSaleCommit', 'captureSaleMutationSnapshot', '\nasync function saveSale'],
        ['beginHistoryCommit', 'captureHistoryMutationSnapshot', '\nasync function saveHistoryCommit'],
        ['beginReturnCommit', 'captureReturnMutationSnapshot', '\nasync function saveReturnAndPreview']
    ];
    for (const session of [
        { isAuthenticated: false, currUser: { id: 'U-1' } },
        { isAuthenticated: true, currUser: { id: 'MISSING' } }
    ]) {
        const context = {
            ...session, db: { users: [{ id: 'U-1', role: 'staff' }] }, toast: (message, type) => context.toasts.push({ message, type }), toasts: [],
            saveBlockedReason: '', saveSuppressed: false, _saveInProgress: false
        };
        createTestContext(context);
        vm.runInContext(between('// Render user cards for expanded view\nfunction getCurrentUserRecord', '\nfunction getValidCommissionRate'), context);
        for (const [root, capture, end] of rootSpecs) {
            context[capture] = () => { context.captures++; return {}; };
            context.captures = 0;
            vm.runInContext(rawBetween(`function ${root}()`, end), context);
            assert.equal(context[root](), null, `${root} blocks invalid session`);
            assert.equal(context.captures, 0, `${root} blocks before snapshot`);
        }
        assert.match(context.toasts[0].message, /đăng nhập lại/);
    }

    const valid = { isAuthenticated: true, currUser: { id: 'U-1' }, db: { users: [{ id: 'U-1', role: 'staff' }] }, toast: () => {} };
    createTestContext(valid);
    vm.runInContext(between('// Render user cards for expanded view\nfunction getCurrentUserRecord', '\nfunction getValidCommissionRate'), valid);
    assert.equal(valid.canMutateOperationalData(), true);
});

test('POS draft mutations reject guest and stale sessions without touching state', () => {
    for (const session of [
        { isAuthenticated: false, currUser: { id: 'U-1' } },
        { isAuthenticated: true, currUser: { id: 'MISSING' } }
    ]) {
        const context = {
            ...session,
            db: { users: [{ id: 'U-1' }], drafts: { invoices: [{ id: 'DRAFT-1' }], purchaseOrders: [], products: [] } },
            invoiceTabs: [{ id: 1, cart: [{ id: 'P-1', qty: 1 }], name: 'Đơn 1' }], activeTabId: 1,
            saveCurrentTabState: () => { context.synced++; }, synced: 0, saveNow: () => { context.saveCalls++; return true; }, saveCalls: 0,
            getAppDate: () => new Date('2026-01-01T00:00:00Z'), toast: () => {}, sameStoredId: (left, right) => String(left) === String(right)
        };
        createTestContext(context);
        vm.runInContext(between('// Render user cards for expanded view\nfunction getCurrentUserRecord', '\nfunction getValidCommissionRate'), context);
        vm.runInContext(between('async function saveDraft(', '\nfunction loadDraft'), context);
        vm.runInContext(between('async function deleteDraft(', '\nfunction getDraftsList'), context);
        vm.runInContext(between('async function saveCartAsDraft(', '\n// Load cart from draft'), context);
        const before = plain(context.db);
        assert.equal(context.saveDraft('invoices', { name: 'Blocked' }), null);
        assert.equal(context.deleteDraft('invoices', 'DRAFT-1'), false);
        assert.equal(context.saveCartAsDraft(), null);
        assert.deepEqual(plain(context.db), before);
        assert.equal(context.synced, 0);
        assert.equal(context.saveCalls, 0);
    }
});

test('points rate preserves zero and legacy numeric values across both checkout flows', () => {
    const rates = [[0, 0], ['2', 2], [undefined, 1], ['Infinity', 1]];
    for (const [stored, expected] of rates) {
        const context = { db: { settings: { pointsRate: stored } } };
        createTestContext(context);
        assert.equal(context.getPointsRate(), expected);
    }
    assert.doesNotMatch(source, /pointsRate\s*\|\|\s*1/);

    for (const flow of ['directCheckout', 'finishOrder']) {
        const { context } = makeSaleCheckoutContext({ saveResult: true });
        context.db.settings.pointsRate = 0;
        context[flow]();
        assert.equal(context.db.custs[0].points, 20, `${flow} does not award points at rate zero`);
    }
});

test('stale session after durable checkout keeps the invoice and source draft when cleanup is denied', () => {
    const { context } = makeSaleCheckoutContext({ saveResult: true });
    context.db.drafts = { invoices: [{ id: 'DRAFT-source' }], purchaseOrders: [], products: [] };
    context.saveNow = () => { context.saveCalls++; context.isAuthenticated = false; return true; };
    vm.runInContext(between('// Render user cards for expanded view\nfunction getCurrentUserRecord', '\nfunction getValidCommissionRate'), context);
    vm.runInContext(between('async function deleteDraft(', '\nfunction getDraftsList'), context);
    vm.runInContext(between('async function consumeInvoiceDraftAfterCheckout(', '\nlet activeDraftType'), context);
    context.directCheckout();
    assert.equal(context.db.invoices.length, 1);
    assert.equal(context.db.products[0].stock, 4);
    assert.deepEqual(plain(context.db.drafts.invoices), [{ id: 'DRAFT-source' }]);
    assert.equal(context.toasts.some(({ message }) => /Hóa đơn đã lưu nhưng nháp chưa được xóa/.test(message)), true);
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
        assert.equal(context.invoiceTabs[0].draftId, null);
        assert.equal(context.printCalls, 1);
        assert.equal(context.soundCalls, 1);
        assert.equal(context.draftCleanupCalls, 1);
        assert.equal(context.toasts.some(({ message }) => message === 'Thanh toán thành công!'), true);
    }

    const noPrint = makeSaleCheckoutContext({ saveResult: true, autoPrint: false }).context;
    noPrint.directCheckout();
    assert.equal(noPrint.db.invoices.length, 1);
    assert.equal(noPrint.printCalls, 0);
});

test('successful multi-tab checkouts close only the completed tab and preserve the destination state', () => {
    for (const flow of ['directCheckout', 'finishOrder']) {
        const { context, elements } = makeSaleCheckoutContext({ saveResult: true });
        const destination = {
            id: 2, name: 'Đơn 2', cart: [{ id: 'P-2', qty: 3 }], cust: { id: 'C-2', name: 'Khách B' },
            discount: 500, discountType: 'amount', draftId: null, savedFingerprint: 'saved', dirty: true,
            returnItems: [], exchangeItems: [], isReturnExchangeMode: false, activeReturnCart: 'return'
        };
        context.invoiceTabs.push(destination);
        context.consumeInvoiceDraftAfterCheckout = () => { context.draftCleanupCalls++; return false; };
        context.closeCompletedSaleTab = completedTabId => {
            context.completedTabId = completedTabId;
            if (flow === 'directCheckout') {
                context.directFieldsBeforeSwitch = {
                    discount: elements.get('cart-discount').value,
                    given: elements.get('cart-customer-give').value,
                    change: elements.get('cart-change').innerText,
                    method: elements.get('cart-pay-method').value,
                    note: context.window.orderNote
                };
            }
            context.invoiceTabs = context.invoiceTabs.filter(tab => tab.id !== completedTabId);
            context.activeTabId = destination.id;
            context.cart = destination.cart.map(item => ({ ...item }));
            context.cust = { ...destination.cust };
            elements.get('cart-cust').value = destination.cust.name;
            elements.get('cart-discount').value = String(destination.discount);
            elements.get('discount-type').value = destination.discountType;
            return true;
        };

        context[flow]();
        assert.equal(context.completedTabId, 1, `${flow} closes the committed tab`);
        assert.equal(context.activeTabId, 2, `${flow} selects the destination tab`);
        assert.deepEqual(plain(context.cart), [{ id: 'P-2', qty: 3 }]);
        assert.equal(context.cust.name, 'Khách B');
        assert.equal(elements.get('cart-discount').value, '500');
        assert.equal(context.invoiceTabs.length, 1);

        if (flow === 'directCheckout') {
            assert.deepEqual(context.directFieldsBeforeSwitch, {
                discount: '0', given: '', change: '0 ₫', method: 'CASH', note: ''
            });
        } else {
            assert.equal(context.closeCalls, 1, 'finishOrder still closes its payment modal');
        }
    }
});

test('cart cache tracks effective pricing inputs without persisting', () => {
    const cartList = { innerHTML: '', appended: 0, appendChild: () => { cartList.appended++; } };
    const fields = new Map([
        ['cart-list', cartList], ['discount-type', { value: 'amount' }], ['cart-discount', { value: '0' }],
        ['cart-subtotal', { innerText: '' }], ['cart-badge', { innerText: '' }]
    ]);
    const context = {
        db: { products: [{ id: 'P-1', name: 'Cà phê', price: 100, wholesalePrice: 80, minWholesaleQty: 10 }], settings: { pointsEnabled: false } },
        cart: [{ id: 'P-1', name: 'Cà phê', qty: 1 }], cust: { id: 'C-1', points: 0, customerType: 'wholesale' },
        $: id => fields.get(id) || null, document: { createElement: () => ({}) }, saveNow: () => { context.saveCalls++; return true; }, saveCalls: 0,
        sameStoredId: (left, right) => String(left) === String(right), normalizeMinWholesaleQty: value => Number(value) > 0 ? Number(value) : 10,
        getEffectivePrice: (product, qty, customer) => ({ price: customer?.customerType === 'wholesale' || qty >= Number(product.minWholesaleQty) ? product.wholesalePrice : product.price, type: 'retail', label: '' }),
        escapeHtml: String, escapeAttr: String, escapeJsArgument: String, formatQty: String, money: String, updateCartTotal: () => {}
    };
    createTestContext(context);
    vm.runInContext(between('let _lastCartHash =', '\nlet paymentDetailsExpanded'), context);

    context.renderCart();
    assert.equal(fields.get('cart-subtotal').innerText, '80');
    context.cust.customerType = 'retail';
    context.renderCart();
    assert.equal(fields.get('cart-subtotal').innerText, '100');
    context.db.products[0].price = 120;
    context.renderCart();
    assert.equal(fields.get('cart-subtotal').innerText, '120');
    context.cart[0].customPrice = 75;
    context.renderCart();
    context.db.products[0].price = 140;
    context.renderCart();
    assert.equal(fields.get('cart-subtotal').innerText, '75');
    assert.equal(context.saveCalls, 0);
    assert.equal(cartList.appended, 5);
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
        addCart: () => { context.autoAddCalls++; }, autoAddCalls: 0, renderPos: () => {},
        getScannerMode: settings => settings?.scannerAutoAdd !== false ? 'auto' : settings?.scannerPopup !== false ? 'popup' : 'find',
        setPosScanStatus: () => {}
    };
    createTestContext(context);
    vm.runInContext(
        `let scannedProduct = null; let lastInputTime = 0; let inputBuffer = '';\n${between('function handleMatchedPosBarcode(', '\nfunction processGlobalBarcode')}\n${between('function handleBarcodeInput(', '\n// Override the handleSearch')}\n${between('function showScannedProductPopup(', '\n// ========== LABEL PRINTING')}`,
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

    const zeroStock = makeScannerPopupContext({ stock: 0 });
    zeroStock.context.db.settings = { scannerAutoAdd: true, scannerPopup: false };
    zeroStock.context.$('pos-search').value = 'CF10';
    zeroStock.context.handleBarcodeInput({ key: 'Enter', preventDefault: () => {} });
    assert.equal(zeroStock.context.autoAddCalls, 1);
    assert.match(source, /handleMatchedPosBarcode\(barcodeMatch, barcodeMatch\.code \|\| v\)/);
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
        db: { invoices: [{ id: 121761, date: '2026-01-01T00:00:00Z', cust: 'Khách lẻ', total: 0, method: 'CASH', items: [{ id: 10, name: 'A', qty: 1, price: 0 }] }], returns: [] },
        $: id => searchElements.get(id) || null, toast: () => { throw new Error('unexpected search failure'); },
        money: value => String(value), escapeHtml: value => String(value), escapeAttr: value => String(value), formatQty: value => value,
        updateReturnRefund: () => {}
    };
    createTestContext(search);
    vm.runInContext(between('function searchInvoiceForReturn()', '\nfunction toggleAllReturnItems('), search);
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
    vm.runInContext(between('function getReturnHistoryItems(', '\nfunction getFilteredReturnsHistory('), detail);
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
        getFilteredSalesHistory: () => ({ list: exportContext.db.invoices }), getSortedHistoryEntries: entries => entries.slice(),
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
    const invoice = { id: 'INV-1', total: 100, cust: 'Khách A', custId: 9, items: [{ id: 10, name: 'A', price: 100, qty: 1, unit: 'SP' }] };
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
        getPointsRate: () => 1,
        applyLinkedReturnCustomerEffects: record => { context.db.custs[0].points--; context.db.custs[0].totalBuy -= record.returnTotal; },
        pushUndo: (_type, data) => context.undoStack.push(data), UNDO_ACTIONS: { RETURN_GOODS: 'RETURN_GOODS' },
        closeModal: () => { context.closed = true; }, renderPos: () => { context.rendered = true; }, renderHist: () => {}, renderManagement: () => {},
        renderDashboard: () => {}, renderStaffView: () => {}, renderReturnsHistory: () => {}, renderStockHistory: () => {},
        $: id => fields.get(id) || null
    };
    createTestContext(context);
    vm.runInContext(between('function captureReturnArrayState(', '\nfunction backToReturnList('), context);
    vm.runInContext(between('function linkedReturnControlKey(', '\n// HISTORY & REPORTS'), context);
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
            drafts: { purchaseOrders: [] }, users: [{ id: 1, name: 'Admin', role: options.role || 'admin' }]
        },
        undoStack: [{ type: 'KEEP', data: { id: 1 } }], currUser: { id: 1, name: 'Admin', role: options.role || 'admin' },
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
    context.completePurchaseOrderClose = () => { vm.runInContext('currentPOItems = []; editingPOId = null;', context); context.closeModal('purchase-order-modal'); };
    context.elements = elements;
    createTestContext(context);
    vm.runInContext(between('function captureInventoryMutationSnapshot()', '\n// Direct checkout'), context);
    return context;
}

function loadInventoryMutationFlow(context, flow) {
    if (flow === 'product') {
        vm.runInContext(between('function saveProd()', '\nfunction getOpenProductCartImpact'), context);
        return () => context.saveProd();
    }
    if (flow === 'stock') {
        vm.runInContext(between('function saveStockIn()', '\nfunction openStockOutModal'), context);
        return () => context.saveStockIn();
    }
    vm.runInContext('let currentPOItems = [];', context);
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
        vm.runInContext(between('function openQuickEditProduct(', '\nasync function savePurchaseOrder'), context);
        return () => context.saveQuickEditProduct();
    }
    if (flow === 'po') return loadInventoryMutationFlow(context, 'po');
    throw new Error(`Unknown management test flow: ${flow}`);
}

test('management mutation guards reject direct staff calls and preserve manager access', () => {
    for (const flow of ['stock-in', 'stock-out', 'inventory-check', 'quick-edit', 'po']) {
        const staff = makeInventoryMutationContext({ role: 'staff' });
        const execute = loadManagementMutation(staff, flow);
        const beforeDb = plain(staff.db);
        execute();
        assert.deepEqual(plain(staff.db), beforeDb, `${flow} rejects direct staff mutation`);
        assert.equal(staff.saveCalls, 0, `${flow} does not save for staff`);
        assert.deepEqual(staff.closed, [], `${flow} keeps staff UI unchanged`);
    }

    for (const flow of ['stock-in', 'stock-out', 'inventory-check', 'quick-edit', 'po']) {
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

test('purchase-order draft UI and dedicated mutation entry points are retired without removing sales drafts', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
    assert.doesNotMatch(html, /savePOAsDraft|po-draft-button/);
    assert.doesNotMatch(css, /po-draft-button/);
    assert.doesNotMatch(source, /injectDraftsButton|persistPurchaseOrderDraft|autoSavePOAsDraft|savePOAsDraft|loadPODraft|renderPODrafts|skipPOAutoSave/);
    assert.match(source, /function openInvoiceDraftsModal/);
    assert.match(html, /onclick="openInvoiceDraftsModal\(\)"/);
});

test('purchase-order dirty snapshot compares persisted form content without coercing invalid numbers to zero', () => {
    for (const id of [0, '0']) {
        const context = makeInventoryMutationContext();
        context.currentPOItems = [{ productId: id, productName: 'Sản phẩm', qty: 2, price: 5000, total: 10000 }];
        vm.runInContext(between('let poFormInitialState = null;', '\nfunction isStockHistoryForPurchaseOrder'), context);
        const before = context.capturePurchaseOrderFormState();
        context.currentPOItems[0].qty = '2'; context.currentPOItems[0].productId = String(id);
        assert.equal(context.capturePurchaseOrderFormState(), before);
        context.$('po-product-search').value = 'Searching only';
        assert.equal(context.capturePurchaseOrderFormState(), before);
        context.$('po-note').value += ' ';
        assert.notEqual(context.capturePurchaseOrderFormState(), before, 'note whitespace is real content');
        context.$('po-note').value = 'Phiếu thử';
        assert.equal(context.capturePurchaseOrderFormState(), before, 'reverting edits clears dirty state');
        context.currentPOItems[0].qty = '';
        const invalid = context.capturePurchaseOrderFormState();
        context.currentPOItems[0].qty = 0;
        assert.notEqual(context.capturePurchaseOrderFormState(), invalid);
    }
});

test('management mutations rollback all linked state when durable save fails', () => {
    for (const flow of ['stock-out', 'inventory-check', 'quick-edit', 'po']) {
        const failed = makeInventoryMutationContext({ saveResult: false });
        const execute = loadManagementMutation(failed, flow);
        if (flow === 'quick-edit') vm.runInContext("currentPOItems = [{ productId: 1, productName: 'Sản phẩm kho', productCode: 'SP-1', qty: 2, price: 4000, sellPrice: 8000, total: 8000 }];", failed);
        const beforeDb = plain(failed.db);
        const hasPOState = ['quick-edit', 'po'].includes(flow);
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

test('product bulk selection preserves stored legacy IDs and product tabs do not reset management tabs', async () => {
    for (const id of ['10', 'SKU-LEGACY', 10]) {
        const checkbox = { dataset: { id: String(id) }, checked: false };
        const context = {
            db: { products: [{ id, name: 'Legacy' }], invoices: [], purchaseOrders: [], returns: [], stockHistory: [], activityLog: [] },
            selectedProducts: new Set(), sameStoredId: (left, right) => String(left) === String(right),
            $: key => key === 'prod-body' ? { querySelectorAll: () => [checkbox] } : null,
            updateBulkDeleteUI: () => {}, deleteProductsFromInventory: async ids => {
                context.db.products = context.db.products.filter(product => !ids.some(id => context.sameStoredId(product.id, id)));
                return true;
            },
            confirm: () => true, pushUndo: () => {}, logActivity: () => {}, save: () => {}, renderProdTable: () => {}, renderPos: () => {}, toast: () => {},
            UNDO_ACTIONS: { DELETE_PRODUCT: 'DELETE_PRODUCT' }
        };
        createTestContext(context);
        vm.runInContext(between('function toggleProductSelect(', '\nfunction updateBulkDeleteUI'), context);
        context.toggleAllProducts({ checked: true });
        assert.equal(context.selectedProducts.has(id), true);
        await context.deleteSelectedProducts();
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
        'set-scanner-mode': makeElement('popup'), 'set-time-override': makeElement('', false),
        'set-custom-datetime': makeElement('2026-01-01T08:00'), 'time-override-container': makeElement(), 'time-override-badge': makeElement(), 'backup-stats': makeElement(), 'restore-file': makeElement(),
        'own-old-pass': makeElement(), 'own-new-pass': makeElement(), 'own-confirm-pass': makeElement(),
        'user-detail-modal': makeElement(), 'user-detail-body': makeElement(), 'user-modal': makeElement(), 'u-id': makeElement(),
        'u-code': makeElement(), 'u-user': makeElement(), 'u-pass': makeElement(), 'u-name': makeElement(), 'u-fullname': makeElement(),
        'u-phone': makeElement(), 'u-birthday': makeElement(), 'u-startdate': makeElement(), 'u-idcard': makeElement(),
        'u-basesalary': makeElement(), 'u-commission': makeElement(), 'u-role': makeElement(), 'u-avatar-preview': makeElement(),
        'u-avatar-placeholder': makeElement(), 'salary-section': makeElement()
    }).map(([id, element]) => [id, element]));
    const context = {
        db: {
            settings: { name: 'Cửa hàng cũ', theme: 'light', uiSize: 'medium', shortcuts: { pay: 'F4' }, disableLogin: false },
            users: [{ id: 1, user: 'admin', pass: 'admin-pass', name: 'Admin', role: options.role || 'admin' }],
            products: [{ id: 1 }], categories: ['A'], custs: [{ id: 1 }], invoices: [{ id: 1 }], suppliers: [{ id: 1 }],
            stockHistory: [{ id: 1 }], returns: [{ id: 1 }], purchaseOrders: [{ id: 1 }], activityLog: [{ id: 1 }],
            drafts: { invoices: [1], purchaseOrders: [2], products: [3] }
        },
        defaultData: { products: [], categories: [], custs: [], invoices: [], suppliers: [], stockHistory: [], returns: [], purchaseOrders: [], activityLog: [], users: [], settings: {}, drafts: { invoices: [], purchaseOrders: [], products: [] } },
        currUser: { id: 1, role: options.role || 'admin', name: options.role || 'Admin' }, isAuthenticated: options.isAuthenticated !== false,
        sameStoredId: (left, right) => left !== undefined && left !== null && right !== undefined && right !== null && String(left) === String(right),
        timeOffset: 0, tempShortcuts: { pay: 'Ctrl+P' }, defaultShortcuts: { pay: { key: 'F4' } },
        saveNow: () => { context.saveCalls++; return options.saveResult !== false; }, saveCalls: 0,
        save: () => { context.deferredSaves++; }, deferredSaves: 0, saveBlockedReason: '', saveSuppressed: false, _saveInProgress: false, hasDesktopStorage: () => true,
        desktop: options.desktop || { data: { listBackups: async () => ({ ok: true, backups: [] }), cleanupBackups: async () => ({ ok: true, removed: 0 }) } },
        setupAutoBackup: () => context.sideEffects.push('backup'), pruneOldBackups: () => context.sideEffects.push('prune'),
        updateBackupStats: () => context.sideEffects.push('stats'), updateAuthPanel: () => context.sideEffects.push('auth'),
        updateShortcutLabels: () => context.sideEffects.push('shortcut-labels'), renderShortcutsSettings: () => context.sideEffects.push('shortcuts-render'),
        redrawVisibleChartsForTheme: () => {}, getBackupLimit: value => Number(value) || 60,
        getScannerMode: settings => settings?.scannerAutoAdd !== false ? 'auto' : settings?.scannerPopup !== false ? 'popup' : 'find',
        getScannerFlags: mode => mode === 'popup' ? { scannerAutoAdd: false, scannerPopup: true } : mode === 'find' ? { scannerAutoAdd: false, scannerPopup: false } : { scannerAutoAdd: true, scannerPopup: false },
        markSettingsBaseline: () => context.sideEffects.push('baseline'), refreshSettingsDirtyState: () => context.sideEffects.push('dirty-refresh'), updateTimeOverrideBadge: () => context.sideEffects.push('time-badge'),
        prepareRestoreData: () => {},
        toast: (message, type) => context.toasts.push({ message, type }), toasts: [], sideEffects: [], confirm: () => { context.confirmCalls++; return options.confirm !== false; }, confirmCalls: 0,
        fs: options.fs || null, path: options.path || null, userDataPath: options.userDataPath || null,
        listBackupFiles: () => [], pruneOldBackups: () => context.sideEffects.push('prune'), logRendererEvent: () => {}, serializeError: String,
        localStorage: { removeItem: key => context.cacheRemovals.push(key) }, cacheRemovals: [], sessionStorage: { clear: () => context.sideEffects.push('session-clear') },
        location: { reload: () => context.sideEffects.push('reload') }, setTimeout: callback => { context.deferred.push(callback); return 1; }, clearTimeout: () => {}, deferred: [],
        logActivity: (action, detail) => context.db.activityLog.unshift({ action, detail }),
        getAppDate: () => new Date('2026-01-01T08:00:00Z'), toLocalDateTimeStr: () => '2026-01-01T08:00', updateTimeDiffDisplay: () => {}, formatTimeDiff: () => '',
        calculateStaffSalary: () => ({ revenue: 0, orders: 0, total: 0 }), money: String, safeImageSrc: () => '', escapeHtml: String,
        generateEmployeeCode: () => 'NV-TEST', closeModal: () => {}, canEditUser: (actor, target) => actor?.role === 'admin' || (actor?.role === 'staff' && String(actor.id) === String(target?.id)), canCreateUser: actor => actor?.role === 'admin',
        beginInventoryCommit: () => ({}), saveInventoryCommit: async () => true,
        document: {
            body: { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } },
            querySelectorAll: selector => selector === '#shortcuts-grid input[data-action]' ? [] : [], querySelector: () => null
        },
        $: id => elements.get(id) || makeElement()
    };
    context.completePurchaseOrderClose = () => { vm.runInContext('currentPOItems = []; editingPOId = null;', context); context.closeModal('purchase-order-modal'); };
    context.elements = elements;
    createTestContext(context);
    vm.runInContext(between('// Keep the existing row geometry;', '\nfunction renderProdTable()'), context);
    vm.runInContext(between('function canMutateSettings()', '\nfunction captureHistoryMutationSnapshot'), context);
    vm.runInContext(between('function resetShortcuts()', '\n// Update all shortcut labels'), context);
    vm.runInContext('let dateFilterPlacementFrame = 0;\n' + between('function scheduleDateFilterPlacement()', '\nfunction initDateFilterPlacement()'), context);
    vm.runInContext(between('function applyTheme(', '\nfunction playSuccessSound'), context);
    vm.runInContext(between('async function getBackupFilesResult()', '\nasync function loadLatestValidBackup'), context);
    vm.runInContext(between('async function cleanupBackupsNow()', '\nasync function performBackup'), context);
    vm.runInContext(between('function resetApp()', '\nfunction exportData'), context);
    vm.runInContext(between('function importData()', '\n// Toggle backup interval visibility'), context);
    vm.runInContext(between('function readBoundedSettingsInteger(', '\n// ========== DATE/TIME OVERRIDE SETTINGS'), context);
    vm.runInContext(between('function syncTimeOverrideFormAfterRollback()', '\nfunction formatTimeDiff'), context);
    vm.runInContext(between('// Render user cards for expanded view\nfunction getCurrentUserRecord', '\nfunction handleUserAvatar'), context);
    vm.runInContext(between('async function changeOwnPassword()', '\nasync function delUser'), context);
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
    assert.deepEqual(manager.sideEffects, ['backup', 'prune', 'stats', 'auth', 'shortcut-labels', 'time-badge', 'baseline']);
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
    assert.deepEqual(failedSave.sideEffects, ['time-badge']);
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

test('settings numeric bounds preserve valid zero and block invalid values before persistence', async () => {
    const valid = makeSettingsContext();
    valid.elements.get('set-points-rate').value = '0';
    assert.equal(await valid.saveSets(), true);
    assert.equal(valid.db.settings.pointsRate, 0);

    for (const [id, value] of [
        ['set-points-rate', '101'], ['set-points-rate', '-1'], ['set-points-rate', '0.5'], ['set-points-rate', ''],
        ['set-points-value', '99'], ['set-low-stock', '0'], ['set-low-stock', 'Infinity']
    ]) {
        const context = makeSettingsContext();
        context.elements.get(id).value = value;
        const beforeDb = plain(context.db);
        assert.equal(await context.saveSets(), false, `${id}=${value} is rejected`);
        assert.deepEqual(plain(context.db), beforeDb, `${id}=${value} leaves settings unchanged`);
        assert.equal(context.saveCalls, 0, `${id}=${value} does not persist`);
        assert.equal(context.sideEffects.length, 0, `${id}=${value} does not update runtime settings`);
    }

    const navigation = {
        pendingSettingsRoute: 'pos', saveSets: () => false, routerCalls: 0,
        $: () => ({ classList: { remove() {} } }), router: () => { navigation.routerCalls++; }, cancelSettingsNavigation: () => {}
    };
    createTestContext(navigation);
    vm.runInContext(between('async function saveSettingsAndNavigate()', '\nfunction discardSettingsAndNavigate'), navigation);
    await navigation.saveSettingsAndNavigate();
    assert.equal(navigation.pendingSettingsRoute, 'pos');
    assert.equal(navigation.routerCalls, 0);
});

test('backup UI distinguishes IPC failures from empty backup lists without changing recovery fallback', async () => {
    const unavailable = makeSettingsContext({
        desktop: { data: { listBackups: () => ({ ok: false, code: 'IO_FAILED' }), cleanupBackups: () => ({ ok: false, code: 'IO_FAILED' }) } }
    });
    vm.runInContext(between('async function updateBackupStats()', '\nasync function cleanupBackupsNow'), unavailable);
    const beforeUnavailable = plain(unavailable.db);
    await unavailable.updateBackupStats();
    assert.match(unavailable.elements.get('backup-stats').innerText, /Không thể đọc thông tin backup/);
    await unavailable.cleanupBackupsNow();
    assert.equal(unavailable.toasts.some(toast => toast.type === 'success'), false);
    assert.equal(unavailable.toasts.some(toast => toast.type === 'error'), true);
    assert.deepEqual(plain(unavailable.db), beforeUnavailable);

    let backups = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const successful = makeSettingsContext({
        desktop: {
            data: {
                    listBackups: () => ({ ok: true, backups }),
                cleanupBackups: () => { backups = backups.slice(0, 1); return { ok: true, removed: 2 }; }
            }
        }
    });
    await successful.cleanupBackupsNow();
    assert.equal(successful.toasts.some(toast => /Đã dọn 2/.test(toast.message) && toast.type === 'success'), true);

    const recovery = { desktop: { data: { listBackups: () => ({ ok: false }) } } };
    createTestContext(recovery);
    vm.runInContext(between('async function listBackupFiles()', '\nasync function getBackupFilesResult'), recovery);
    assert.deepEqual(plain(await recovery.listBackupFiles()), []);
});

test('time override failures restore the form without clearing unrelated dirty settings', async () => {
    for (const action of ['toggleTimeOverride', 'updateTimeOffset', 'resetTimeToSystem']) {
        const context = makeSettingsContext({ saveResult: false });
        context.db.settings.timeOverrideEnabled = true;
        context.db.settings.timeOffset = 3600000;
        context.timeOffset = 3600000;
        context.elements.get('set-time-override').checked = action === 'toggleTimeOverride' ? false : true;
        context.elements.get('time-override-container').style.display = action === 'toggleTimeOverride' ? 'none' : 'block';
        context.elements.get('set-custom-datetime').value = '2027-01-01T08:00';
        const beforeDb = plain(context.db);
        await context[action]();
        assert.deepEqual(plain(context.db), beforeDb, `${action} restores settings and activity log`);
        assert.equal(context.timeOffset, 3600000, `${action} restores offset`);
        assert.equal(context.elements.get('set-time-override').checked, true, `${action} restores checkbox`);
        assert.equal(context.elements.get('time-override-container').style.display, 'block', `${action} restores container`);
        assert.equal(context.sideEffects.includes('baseline'), false, `${action} preserves existing dirty baseline`);
        assert.equal(context.sideEffects.includes('dirty-refresh'), true, `${action} refreshes dirty state`);
    }
});

test('changeOwnPassword rejects missing or stale sessions without throwing or mutating', async () => {
    for (const setup of [
        context => { context.isAuthenticated = false; context.currUser = null; },
        context => { context.currUser = { id: 'missing', role: 'staff' }; }
    ]) {
        const context = makeSettingsContext();
        context.elements.get('own-old-pass').value = 'admin-pass';
        context.elements.get('own-new-pass').value = 'new-pass';
        context.elements.get('own-confirm-pass').value = 'new-pass';
        setup(context);
        const beforeDb = plain(context.db);
        assert.doesNotThrow(() => context.changeOwnPassword());
        assert.deepEqual(plain(context.db), beforeDb);
        assert.equal(context.saveCalls, 0);
        assert.match(context.toasts.at(-1).message, /Phiên đăng nhập không hợp lệ/);
    }

    const valid = makeSettingsContext();
    valid.elements.get('own-old-pass').value = 'admin-pass';
    valid.elements.get('own-new-pass').value = 'new-pass';
    valid.elements.get('own-confirm-pass').value = 'new-pass';
    await valid.changeOwnPassword();
    assert.equal(valid.db.users[0].pass, 'new-pass');
});

test('settings runtime helpers preserve legacy scanner behavior and keep restore previews read-only', async () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
    assert.match(html, /id="settings-search"/);
    assert.match(html, /data-settings-search=/);
    assert.match(html, /id="settings-unsaved-modal"/);
    assert.match(html, /id="set-scanner-mode"/);
    assert.doesNotMatch(html, /id="set-scanner-popup"|id="set-scanner-auto-add"/);
    assert.match(html, /id="restore-preview"/);
    assert.match(html, /data-shortcut-action="save"/);
    assert.match(css, /\.settings-search-hidden \{ display: none !important; \}/);
    assert.match(css, /\.time-override-badge/);
    const settingsInit = source.slice(source.indexOf("safeRun('settings-delayed-init'"), source.indexOf('// Settings runtime helpers do not persist form state.'));
    assert.match(settingsInit, /forEach\(box => \{\s*setSettingsSectionCollapsed\(box, true\);/);
    assert.doesNotMatch(settingsInit, /index >= 2/);

    const scanner = { db: { settings: { scannerAutoAdd: true, scannerPopup: true } } };
    createTestContext(scanner);
    vm.runInContext(between('function getScannerMode(', '\nfunction getSettingsFingerprint'), scanner);
    assert.equal(scanner.getScannerMode(), 'auto');
    assert.deepEqual(plain(scanner.getScannerFlags('auto')), { scannerAutoAdd: true, scannerPopup: false });
    assert.deepEqual(plain(scanner.getScannerFlags('popup')), { scannerAutoAdd: false, scannerPopup: true });
    assert.deepEqual(plain(scanner.getScannerFlags('find')), { scannerAutoAdd: false, scannerPopup: false });

    const oldDb = { products: [{ id: 1 }], invoices: [{ id: 'OLD' }], settings: {} };
    const restore = {
        db: plain(oldDb), JSON, restoreCandidate: null, restoreReadToken: 0,
        saveBlockedReason: '', saveBlockedToastShown: false, dataLoadStatus: 'primary',
        canMutateSettings: () => true, confirm: () => true, saveNow: async () => false,
        $: () => null, toast: message => { restore.lastToast = message; },
        location: { reload: () => { restore.reloaded = true; } }, setTimeout: () => 0
    };
    createTestContext(restore);
    vm.runInContext(source.slice(source.indexOf('let restoreCandidate = null;'), source.indexOf('// Toggle backup interval visibility')), restore);
    vm.runInContext("restoreCandidate = { file: { name: 'safe.json', size: 1000, lastModified: 0 }, data: { products: [{ id: 2 }], invoices: [{ id: 'NEW' }], users: [] } };", restore);
    const previewDb = plain(restore.db);
    const summary = restore.getRestoreCandidateSummary({ name: 'safe.json', size: 1000, lastModified: 0 }, { products: [{ id: 2 }], users: [] });
    assert.match(summary, /Sản phẩm: 1/);
    assert.deepEqual(plain(restore.db), previewDb);
    assert.equal(await restore.confirmRestoreData(), false);
    assert.deepEqual(plain(restore.db), previewDb);
    assert.match(restore.lastToast, /Dữ liệu hiện tại vẫn được giữ/);

    const settingsSlice = source.slice(source.indexOf('function searchSettings('), source.indexOf('function updateTimeOverrideBadge('));
    assert.doesNotMatch(settingsSlice, /saveNow\(|db\s*=/);
    assert.match(source, /currentViewId === 'settings-view' && id !== 'settings' && settingsDirty/);
    assert.match(source, /function saveSettingsAndNavigate\(\)/);
    assert.match(source, /function discardSettingsAndNavigate\(\)/);
});

test('settings UI refinements remain presentation-only and show one dirty save action', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
    const storeSection = html.slice(html.indexOf('id="store-info-section"'), html.indexOf('<!-- Payment & QR -->'));
    const helpView = html.slice(html.indexOf('<!-- 9. HELP VIEW'), html.indexOf('<!-- MODALS -->'));

    assert.doesNotMatch(storeSection, /saveSets\(\)/);
    assert.match(html, /id="settings-save-bar" class="settings-save-bar" hidden/);
    assert.match(html, /class="settings-field-pair mb-2"/);
    assert.match(html, /class="settings-subsection-title">Sao lưu tự động/);
    assert.match(html, /class="[^"]*settings-danger-zone/);
    assert.match(html, /class="[^"]*settings-password-modal-header/);
    assert.equal((helpView.match(/<button type="button" class="help-section-header"/g) || []).length, 10);
    assert.doesNotMatch(helpView, /<div class="help-section-header"/);
    assert.match(css, /\.settings-collapsible \.settings-toggle:hover \{[\s\S]*?box-shadow: inset/);
    assert.doesNotMatch(css.slice(css.indexOf('.settings-collapsible .settings-toggle:hover'), css.indexOf('.settings-collapsible .toggle-icon')), /margin:\s*-/);
    assert.match(css, /#settings-view \.settings-save-bar \{[\s\S]*?position: fixed/);
    assert.match(css, /#settings-view \.settings-field-pair \{[\s\S]*?grid-template-columns: repeat\(2/);
    assert.match(css, /@media \(max-width: 480px\) \{[\s\S]*?#settings-view \.settings-field-pair,[\s\S]*?grid-template-columns: 1fr/);
    assert.match(css, /\.help-item\.active \.help-item-content \{[\s\S]*?display: block/);
    assert.doesNotMatch(css, /\.help-item\.active \.help-item-content \{[\s\S]*?max-height: 200px/);

    const elements = new Map([
        ['settings-dirty-indicator', { hidden: true }],
        ['settings-save-bar', { hidden: true }]
    ]);
    const ui = { settingsDirty: false, $: id => elements.get(id) || null };
    vm.createContext(ui);
    vm.runInContext(source.slice(source.indexOf('function syncSettingsDirtyIndicator()'), source.indexOf('function markSettingsBaseline()')), ui);
    ui.syncSettingsDirtyIndicator();
    assert.equal(elements.get('settings-dirty-indicator').hidden, true);
    assert.equal(elements.get('settings-save-bar').hidden, true);
    ui.settingsDirty = true;
    ui.syncSettingsDirtyIndicator();
    assert.equal(elements.get('settings-dirty-indicator').hidden, false);
    assert.equal(elements.get('settings-save-bar').hidden, false);
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
            markInvoiceTabSaved: (tab, draftId) => { tab.draftId = draftId; tab.dirty = false; },
            renderInvoiceTabs: () => {},
            sameStoredId: (left, right) => String(left) === String(right),
            $: id => fields.get(id) || null, renderCart: () => {}, updateCustList: () => {}
        };
        context.storage = storage;
        return context;
    };

    const migrated = createContext(true);
    createTestContext(migrated);
    vm.runInContext(between('// 5. DRAFT SYSTEM', '\nlet activeDraftType'), migrated);
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
    const savedDraftId = migrated.db.drafts.invoices[0].id;
    migrated.invoiceTabs[0].cart[0].qty = 3;
    assert.ok(migrated.saveCartAsDraft());
    assert.equal(migrated.db.drafts.invoices.length, 2);
    assert.equal(migrated.db.drafts.invoices[0].id, savedDraftId);
    assert.equal(migrated.db.drafts.invoices[0].data.items[0].qty, 3);

    migrated.cart = [];
    assert.equal(migrated.loadCartFromDraft('DRAFT-legacy-44'), true);
    assert.equal(migrated.cart[0].name, 'Sản phẩm mới');
    assert.equal(migrated.cart[0].price, 12000);
    assert.equal(migrated.cust.name, 'Khách mới');

    migrated.db.drafts.invoices.unshift({
        id: 'custom-price', data: {
            items: [{ id: 'P-1', name: 'Tên cũ', price: 10000, qty: 2, customPrice: '7500', customLineTotal: '15000' }],
            customer: { id: 'C-1' }
        }
    });
    const draftBeforeLoad = plain(migrated.db.drafts.invoices);
    migrated.cart = [];
    assert.equal(migrated.loadCartFromDraft('custom-price'), true);
    assert.equal(migrated.cart[0].name, 'Sản phẩm mới');
    assert.equal(migrated.cart[0].price, 12000);
    assert.equal(migrated.cart[0].customPrice, 7500);
    assert.equal(migrated.cart[0].customLineTotal, 15000);
    assert.deepEqual(plain(migrated.db.drafts.invoices), draftBeforeLoad);

    migrated.db.drafts.invoices.unshift({ id: 'invalid-custom', data: { items: [{ id: 'P-1', qty: 1, customPrice: 'NaN', customLineTotal: Infinity }] } });
    migrated.cart = [];
    assert.equal(migrated.loadCartFromDraft('invalid-custom'), true);
    assert.equal(Object.hasOwn(migrated.cart[0], 'customPrice'), false);
    assert.equal(Object.hasOwn(migrated.cart[0], 'customLineTotal'), false);

    migrated.db.drafts.invoices.unshift({ id: 'missing', data: { items: [{ id: 'gone', name: 'Đã xóa', qty: 1 }] } });
    const beforeCart = JSON.stringify(migrated.cart);
    assert.equal(migrated.loadCartFromDraft('missing'), false);
    assert.equal(JSON.stringify(migrated.cart), beforeCart);

    const failed = createContext(false);
    createTestContext(failed);
    vm.runInContext(between('// 5. DRAFT SYSTEM', '\nlet activeDraftType'), failed);
    assert.equal(failed.migrateLegacyOrderDrafts(), false);
    assert.equal(failed.db.drafts.invoices.length, 0);
    assert.equal(failed.storage.has('orderDrafts'), true);
    failed.cart = failed.invoiceTabs[0].cart.map(item => ({ ...item }));
    const draftsBeforeFailedSave = plain(failed.db.drafts.invoices);
    assert.equal(failed.saveCartAsDraft(), null);
    assert.deepEqual(plain(failed.db.drafts.invoices), draftsBeforeFailedSave);
});

test('POS invoice drafts never evict another draft at the 20-draft limit', () => {
    const makeDrafts = count => Array.from({ length: count }, (_, index) => ({
        id: `DRAFT-${index + 1}`,
        type: 'invoices',
        name: `Đơn ${index + 1}`,
        createdAt: '2026-01-01T00:00:00.000Z',
        data: { items: [{ id: 'P-1', qty: 1, price: 10000 }] }
    }));
    const makeContext = ({ count, draftId = null } = {}) => {
        const tab = {
            id: 1, name: 'Đơn đang bán', cart: [{ id: 'P-1', qty: 2, price: 10000 }],
            cust: { id: 'C-1', name: 'Khách A' }, discount: 0, discountType: 'amount', draftId, dirty: true
        };
        const context = {
            db: { drafts: { invoices: makeDrafts(count), purchaseOrders: [], products: [] } },
            invoiceTabs: [tab], activeTabId: 1, cart: plain(tab.cart), cust: plain(tab.cust),
            getAppDate: () => new Date('2026-01-02T00:00:00.000Z'),
            saveCurrentTabState: () => { context.synced++; }, synced: 0,
            saveNow: () => { context.saveCalls++; return true; }, saveCalls: 0,
            markInvoiceTabSaved: (savedTab, savedDraftId) => { savedTab.draftId = savedDraftId; savedTab.dirty = false; },
            renderInvoiceTabs: () => { context.renderCalls++; }, renderCalls: 0,
            toast: (message, type) => context.toasts.push({ message, type }), toasts: []
        };
        createTestContext(context);
        vm.runInContext(between('async function saveCartAsDraft(', '\n// Load cart from draft'), context);
        return { context, tab };
    };

    const full = makeContext({ count: 20 });
    const fullBefore = plain(full.context.db.drafts.invoices);
    assert.equal(full.context.saveCartAsDraft(), null);
    assert.deepEqual(plain(full.context.db.drafts.invoices), fullBefore);
    assert.equal(full.context.saveCalls, 0);
    assert.equal(full.context.renderCalls, 0);
    assert.equal(full.tab.draftId, null);
    assert.equal(full.tab.dirty, true);
    assert.match(full.context.toasts.at(-1).message, /tối đa 20 đơn lưu tạm/);

    const existing = makeContext({ count: 20, draftId: 'DRAFT-1' });
    assert.equal(existing.context.saveCartAsDraft(), 'DRAFT-1');
    assert.equal(existing.context.db.drafts.invoices.length, 20);
    assert.equal(existing.context.db.drafts.invoices[0].data.items[0].qty, 2);
    assert.equal(existing.context.saveCalls, 1);

    const stale = makeContext({ count: 20, draftId: 'DRAFT-missing' });
    const staleBefore = plain(stale.context.db.drafts.invoices);
    assert.equal(stale.context.saveCartAsDraft(), null);
    assert.deepEqual(plain(stale.context.db.drafts.invoices), staleBefore);
    assert.equal(stale.context.saveCalls, 0);

    const available = makeContext({ count: 19 });
    const newDraftId = available.context.saveCartAsDraft();
    assert.match(newDraftId, /^DRAFT-/);
    assert.equal(available.context.db.drafts.invoices.length, 20);
    assert.equal(available.context.saveCalls, 1);
});

test('POS draft callers keep the order open when the shared save guard rejects it', () => {
    const context = {
        pendingUnsavedTabId: 1,
        saveCartAsDraft: () => null,
        closeUnsavedTabModal: () => { context.closedModal++; }, closedModal: 0,
        finalizeCloseTab: () => { context.closedTab++; }, closedTab: 0
    };
    createTestContext(context);
    vm.runInContext(between('async function saveAndCloseUnsavedTab()', '\nfunction discardAndCloseUnsavedTab'), context);
    context.saveAndCloseUnsavedTab();
    assert.equal(context.closedModal, 0);
    assert.equal(context.closedTab, 0);
});

test('POS UI hierarchy remains presentation-only and preserves existing sale controls', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
    const posHeader = html.slice(html.indexOf('<div class="cart-header">'), html.indexOf('<!-- Invoice Tabs for Multi-Order Support -->'));
    const paymentModal = html.slice(html.indexOf('<div class="modal-overlay" id="pay-modal">'), html.indexOf('<!-- Product Modal -->'));
    const quickReturnModal = html.slice(html.indexOf('<div class="modal-overlay" id="quick-return-exchange-modal">'), html.indexOf('<!-- Generic Modal for return/exchange details -->'));
    const unsavedModal = html.slice(html.indexOf('<div class="modal-overlay" id="unsaved-order-modal">'), html.indexOf('<!-- Batch Label Print Selection Modal -->'));
    const cartRenderer = source.slice(source.indexOf('function renderCart()'), source.indexOf('\nlet paymentDetailsExpanded'));

    assert.match(html, /<select id="pos-cat" class="pos-category-select" onchange="handleCategoryChange\(\)"><\/select>/);
    assert.match(posHeader, /id="btn-return-toggle" class="btn-return-toggle"[\s\S]*?onclick="toggleReturnExchangeMode\(\)"/);
    assert.match(posHeader, /id="hold-btn" class="btn-return-toggle btn-hold-order" onclick="holdOrder\(\)"[\s\S]*?data-icon-tooltip="Tạm giữ đơn" aria-label="Tạm giữ đơn"/);
    assert.match(css, /\.btn-hold-order \{[\s\S]*?background: var\(--bg-muted\);/);
    assert.match(css, /container-type: inline-size;/);
    assert.match(css, /@container \(max-width: 660px\) \{[\s\S]*?\.search-area #pos-search/);

    assert.match(source, /function renderInvoiceTabs\(\)/);
    assert.match(source, /draggable="true"/);
    assert.doesNotMatch(source, /tab-unsaved/);
    assert.doesNotMatch(css, /tab-unsaved/);
    assert.match(cartRenderer, /class="cart-price-input" value="\$\{parseInt\(displayPrice\)\.toLocaleString\('vi-VN'\)\}"/);
    assert.match(cartRenderer, /class="cart-linetotal-input" value="\$\{lineTotal\.toLocaleString\('vi-VN'\)\}"/);
    assert.match(cartRenderer, /fitCartMoneyInputs\(l\);/);
    assert.doesNotMatch(cartRenderer, /unitPriceText|lineTotalText|\ssize=|min-width:\d+ch/);
    assert.match(source, /function fitCartMoneyInput\(input, minimumFontSize = 10\)/);
    assert.match(css, /#cart-list \.cart-price-input \{[\s\S]*?flex: 0 0 80px;[\s\S]*?width: 80px;[\s\S]*?max-width: 80px;/);
    assert.match(css, /#cart-list \.cart-linetotal-input \{[\s\S]*?flex: 0 0 95px;[\s\S]*?width: 95px;[\s\S]*?max-width: 95px;/);
    assert.match(css, /@media \(max-width: 480px\) \{[\s\S]*?#cart-list \.cart-price-input \{[\s\S]*?flex: 0 0 72px;[\s\S]*?width: 72px;/);
    assert.match(css, /@media \(max-width: 480px\) \{[\s\S]*?#cart-list \.cart-linetotal-input \{[\s\S]*?flex: 0 0 86px;[\s\S]*?width: 86px;/);
    assert.match(css, /#cart-list \.cart-price-input \+ span,[\s\S]*?white-space: nowrap;/);
    assert.match(css, /#cart-list \.cart-item>div:nth-last-child\(2\) \{[\s\S]*?white-space: nowrap;/);
    assert.match(css, /\.invoice-tab \{[\s\S]*?height: 34px;/);
    assert.match(css, /\.invoice-tab \.tab-name \{[\s\S]*?max-width: 88px;/);
    assert.match(css, /\.invoice-tab \.tab-close \{[\s\S]*?width: 24px;/);
    assert.match(css, /#products-tab-inventory \.table-wrap table td\.stock-history-note,[\s\S]*?\.stock-history-table td\.stock-history-note \{ text-align: left; \}/);

    assert.match(paymentModal, /class="payment-modal-total"/);
    assert.match(paymentModal, /id="pay-give" class="payment-give-input"[\s\S]*?oninput="formatPaymentInput\(this\); calcChange\(\)"/);
    assert.match(paymentModal, /id="pay-change" class="payment-change-amount"/);
    assert.match(paymentModal, /onclick="finishOrder\(\)"/);
    assert.match(css, /#pay-modal \.payment-modal-total-value \{[\s\S]*?font-size: 34px;/);
    assert.match(css, /@media \(max-width: 480px\) \{[\s\S]*?#pay-modal \.payment-modal-fields/);

    assert.match(quickReturnModal, /class="quick-return-panels"/);
    assert.match(quickReturnModal, /class="quick-return-panel quick-return-panel-return"/);
    assert.match(quickReturnModal, /class="quick-return-panel quick-return-panel-exchange"/);
    assert.match(quickReturnModal, /class="btn btn-sm quick-return-add-exchange" onclick="toggleQRExchangeMode\(\)"/);
    assert.match(quickReturnModal, /id="qr-difference-section" class="quick-return-difference"/);
    assert.match(quickReturnModal, /onclick="processQuickReturnExchange\(\)"/);
    assert.match(css, /#quick-return-exchange-modal \.quick-return-panel-return \.quick-return-panel-header \{[\s\S]*?background: #fffbeb;/);
    assert.match(css, /@media \(max-width: 680px\) \{[\s\S]*?\.quick-return-panel/);

    assert.match(unsavedModal, /class="modal-footer unsaved-order-actions"/);
    assert.match(unsavedModal, /class="btn btn-danger unsaved-order-discard" onclick="discardAndCloseUnsavedTab\(\)"/);
    assert.match(unsavedModal, /class="btn btn-primary unsaved-order-save" onclick="saveAndCloseUnsavedTab\(\)"/);
    assert.match(css, /#unsaved-order-modal \.unsaved-order-discard \{[\s\S]*?background: transparent;/);
    assert.doesNotMatch(source, /payment-modal-total|quick-return-panel|unsaved-order-actions|btn-hold-order/);
});

test('cart money fitting keeps compact widths and only reduces long values to the readable floor', () => {
    const context = {
        getComputedStyle: input => ({ fontSize: input.style.fontSize || `${input.baseFontSize}px` })
    };
    vm.createContext(context);
    vm.runInContext(between('function fitCartMoneyInput(', '\nlet _lastCartHash'), context);

    const makeInput = ({ width, baseFontSize, textWidthAtOnePx, value = '20.000' }) => ({
        clientWidth: width,
        baseFontSize,
        textWidthAtOnePx,
        value,
        style: {
            fontSize: '',
            removeProperty(property) {
                if (property === 'font-size') this.fontSize = '';
            }
        },
        get scrollWidth() {
            const size = Number.parseFloat(this.style.fontSize || `${this.baseFontSize}px`);
            return Math.ceil(this.textWidthAtOnePx * size);
        }
    });

    const shortPrice = makeInput({ width: 80, baseFontSize: 12, textWidthAtOnePx: 4 });
    const longTotal = makeInput({ width: 95, baseFontSize: 14, textWidthAtOnePx: 8.5, value: '2.500.000.000' });
    const extremeTotal = makeInput({ width: 95, baseFontSize: 14, textWidthAtOnePx: 12, value: '9.007.199.254.740.991' });
    const hiddenPrice = makeInput({ width: 0, baseFontSize: 12, textWidthAtOnePx: 8, value: '20.000.000' });

    context.fitCartMoneyInputs({ querySelectorAll: () => [shortPrice, longTotal, extremeTotal] });
    assert.equal(shortPrice.style.fontSize, '');
    assert.equal(longTotal.style.fontSize, '11px');
    assert.equal(extremeTotal.style.fontSize, '10px');
    assert.equal(longTotal.value, '2.500.000.000');
    assert.equal(extremeTotal.clientWidth, 95);

    longTotal.style.fontSize = '10px';
    longTotal.textWidthAtOnePx = 4;
    context.fitCartMoneyInput(longTotal);
    assert.equal(longTotal.style.fontSize, '');

    context.fitCartMoneyInput(hiddenPrice);
    assert.equal(hiddenPrice.style.fontSize, '');
    assert.equal(hiddenPrice.value, '20.000.000');
});

test('POS held orders only clear after durable drafts and retain the original sale state on failure', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const cartHeader = html.slice(html.indexOf('<div class="cart-header">'), html.indexOf('<!-- Invoice Tabs for Multi-Order Support -->'));
    const cartFooter = html.slice(html.indexOf('<div class="cart-footer checkout-fast">'), html.indexOf('</div>\n                </div>\n            </div>\n\n            <!-- 2. HISTORY -->'));
    assert.match(cartHeader, /id="btn-return-toggle"[\s\S]*?id="hold-btn"[\s\S]*?onclick="holdOrder\(\)"/);
    assert.match(cartHeader, /data-icon-tooltip="Tạm giữ đơn" aria-label="Tạm giữ đơn"/);
    assert.doesNotMatch(cartFooter, /id="hold-btn"/);

    const makeContext = saveResult => {
        const fields = new Map([
            ['cart-discount', { value: '500' }], ['discount-type', { value: 'amount' }], ['cart-cust', { value: 'Khách A' }]
        ]);
        const tab = { id: 1, cart: [{ id: 'P-1', qty: 1 }], cust: { id: 'C-1', name: 'Khách A' }, discount: 500, discountType: 'amount', draftId: null, savedFingerprint: '', dirty: true };
        const context = {
            invoiceTabs: [tab], activeTabId: 1, cart: plain(tab.cart), cust: plain(tab.cust),
            $: id => fields.get(id) || null, isRegularSaleTab: candidate => !!candidate,
            isReturnExchangeMode: false,
            saveCartAsDraft: () => saveResult ? 'DRAFT-1' : null,
            saveCurrentTabState: () => { context.synced = true; }, renderCart: () => { context.rendered = true; }, renderInvoiceTabs: () => { context.tabsRendered = true; },
            toast: (message, type) => context.toasts.push({ message, type }), toasts: []
        };
        return { context, fields, tab };
    };

    const saved = makeContext(true);
    createTestContext(saved.context);
    vm.runInContext(between('async function holdOrder()', '\n// Export Report to Excel'), saved.context);
    saved.context.holdOrder();
    assert.deepEqual(plain(saved.context.cart), []);
    assert.equal(saved.context.cust, null);
    assert.equal(saved.fields.get('cart-discount').value, '0');
    assert.equal(saved.tab.draftId, null);
    assert.equal(saved.tab.dirty, false);

    const failed = makeContext(false);
    createTestContext(failed.context);
    vm.runInContext(between('async function holdOrder()', '\n// Export Report to Excel'), failed.context);
    failed.context.holdOrder();
    assert.deepEqual(plain(failed.context.cart), [{ id: 'P-1', qty: 1 }]);
    assert.equal(failed.context.cust.name, 'Khách A');
    assert.equal(failed.fields.get('cart-discount').value, '500');
});

test('invoice draft cleanup removes only the source draft after a successful invoice save', () => {
    const makeContext = saveResult => {
        const context = {
            db: { drafts: { invoices: [{ id: 'DRAFT-source' }, { id: 'DRAFT-other' }] } },
            sameStoredId: (left, right) => String(left) === String(right), saveNow: () => saveResult,
            toast: (message, type) => context.toasts.push({ message, type }), toasts: []
        };
        return context;
    };

    const saved = makeContext(true);
    createTestContext(saved);
    vm.runInContext(between('async function deleteDraft(', '\nfunction getDraftsList'), saved);
    vm.runInContext(between('async function consumeInvoiceDraftAfterCheckout(', '\nlet activeDraftType'), saved);
    assert.equal(saved.consumeInvoiceDraftAfterCheckout('DRAFT-source'), true);
    assert.deepEqual(plain(saved.db.drafts.invoices), [{ id: 'DRAFT-other' }]);

    const failed = makeContext(false);
    createTestContext(failed);
    vm.runInContext(between('async function deleteDraft(', '\nfunction getDraftsList'), failed);
    vm.runInContext(between('async function consumeInvoiceDraftAfterCheckout(', '\nlet activeDraftType'), failed);
    assert.equal(failed.consumeInvoiceDraftAfterCheckout('DRAFT-source'), false);
    assert.deepEqual(plain(failed.db.drafts.invoices), [{ id: 'DRAFT-source' }, { id: 'DRAFT-other' }]);
    assert.equal(failed.toasts.some(({ message }) => /Hóa đơn đã lưu/.test(message)), true);

    const missing = makeContext(true);
    createTestContext(missing);
    vm.runInContext(between('async function deleteDraft(', '\nfunction getDraftsList'), missing);
    vm.runInContext(between('async function consumeInvoiceDraftAfterCheckout(', '\nlet activeDraftType'), missing);
    assert.equal(missing.consumeInvoiceDraftAfterCheckout('DRAFT-deleted'), true);
    assert.equal(missing.toasts.length, 0);
});

test('invoice draft cleanup keeps the source draft and warns when deletion throws', () => {
    const context = {
        db: { drafts: { invoices: [{ id: 'DRAFT-source' }] } },
        sameStoredId: (left, right) => String(left) === String(right),
        deleteDraft: () => { throw new Error('I/O failed'); },
        toast: (message, type) => context.toasts.push({ message, type }), toasts: [],
        console: { error: () => {} }
    };
    createTestContext(context);
    vm.runInContext(between('async function consumeInvoiceDraftAfterCheckout(', '\nlet activeDraftType'), context);

    assert.equal(context.consumeInvoiceDraftAfterCheckout('DRAFT-source'), false);
    assert.deepEqual(plain(context.db.drafts.invoices), [{ id: 'DRAFT-source' }]);
    assert.equal(context.toasts.some(({ message }) => /Hóa đơn đã lưu nhưng nháp chưa được xóa/.test(message)), true);
});

test('completed sale tabs close to the visual neighbor without affecting return tabs', () => {
    const makeTab = (id, mode = '') => ({
        id, mode, cart: [{ id: `P-${id}`, qty: 1 }], cust: { id: `C-${id}` }, discount: id * 100,
        discountType: 'amount', isReturnExchangeMode: mode === 'return'
    });
    const context = {
        invoiceTabs: [makeTab(1), makeTab(2), makeTab(3)], activeTabId: 3,
        cart: [], cust: null,
        isRegularSaleTab: tab => !!tab && tab.mode !== 'return' && !tab.isReturnExchangeMode,
        isReturnMode: () => context.invoiceTabs.find(tab => tab.id === context.activeTabId)?.mode === 'return',
        loadTabState: tabId => {
            const tab = context.invoiceTabs.find(candidate => candidate.id === tabId);
            context.cart = tab.cart.map(item => ({ ...item }));
            context.cust = { ...tab.cust };
            context.loadedTabId = tabId;
        },
        renderInvoiceTabs: () => { context.tabRenders++; }, tabRenders: 0,
        renderCart: () => { context.cartRenders++; }, cartRenders: 0,
        updateReturnModeUI: value => { context.returnMode = value; }
    };
    createTestContext(context);
    vm.runInContext(between('function closeCompletedSaleTab(', '\nfunction isRegularSaleTab'), context);

    assert.equal(context.closeCompletedSaleTab(3), true);
    assert.deepEqual(plain(context.invoiceTabs.map(tab => tab.id)), [1, 2]);
    assert.equal(context.activeTabId, 2);
    assert.equal(context.loadedTabId, 2);
    assert.deepEqual(plain(context.cart), [{ id: 'P-2', qty: 1 }]);

    context.invoiceTabs = [makeTab(1), makeTab(2)];
    context.activeTabId = 1;
    assert.equal(context.closeCompletedSaleTab(1), true);
    assert.equal(context.activeTabId, 2);

    context.invoiceTabs = [makeTab(3), makeTab(1), makeTab(2)];
    context.activeTabId = 1;
    assert.equal(context.closeCompletedSaleTab(1), true);
    assert.equal(context.activeTabId, 3);

    context.invoiceTabs = [makeTab(1, 'return'), makeTab(2)];
    context.activeTabId = 1;
    assert.equal(context.closeCompletedSaleTab(1), false);
    assert.deepEqual(plain(context.invoiceTabs.map(tab => tab.id)), [1, 2]);
});

test('POS unsaved fingerprints stay runtime-only and ignore return tabs', () => {
    const context = { $: () => null };
    createTestContext(context);
    vm.runInContext(between('function isRegularSaleTab(', '\n// Save current cart state'), context);

    const tab = { cart: [{ id: 'P-1', qty: 1 }], cust: { id: 'C-1', name: 'Khách A' }, discount: 0, discountType: 'amount' };
    assert.equal(context.refreshInvoiceTabDirty(tab), true);
    context.markInvoiceTabSaved(tab, 'DRAFT-1');
    assert.equal(tab.draftId, 'DRAFT-1');
    assert.equal(context.refreshInvoiceTabDirty(tab), false);
    tab.cart[0].qty = 2;
    assert.equal(context.refreshInvoiceTabDirty(tab), true);

    const returnTab = { mode: 'return', cart: [{ id: 'P-1', qty: 1 }], dirty: true };
    assert.equal(context.refreshInvoiceTabDirty(returnTab), false);
    assert.equal(returnTab.dirty, false);
});

test('unsaved sale tabs use the dedicated close prompt while the last tab keeps its existing guard', () => {
    const modal = { classList: { add: () => { modal.opened = true; }, remove: () => {} } };
    const context = {
        invoiceTabs: [
            { id: 1, name: 'Đơn 1', cart: [{ id: 'P-1', qty: 1 }], dirty: true },
            { id: 2, name: 'Đơn 2', cart: [], dirty: false }
        ],
        activeTabId: 1, $: id => id === 'unsaved-order-modal' ? modal : null,
        toast: message => { context.lastToast = message; }, confirm: () => { throw new Error('dirty tabs must use the dedicated prompt'); }
    };
    createTestContext(context);
    vm.runInContext(between('function closeTab(', '\n// Save current cart state'), context);
    context.closeTab(1);
    assert.equal(modal.opened, true);
    assert.equal(context.invoiceTabs.length, 2);

    context.invoiceTabs = [{ id: 1, name: 'Đơn 1', cart: [{ id: 'P-1', qty: 1 }], dirty: true }];
    context.closeTab(1);
    assert.match(context.lastToast, /Không thể đóng đơn cuối cùng/);

    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    assert.match(html, /saveAndCloseUnsavedTab\(\)/);
    assert.match(html, /discardAndCloseUnsavedTab\(\)/);
    assert.match(html, /closeUnsavedTabModal\(\)/);
});

test('scanner notifications have one source and preserve routing without the inline banner', () => {
    const run = ({ stock = 5, settings = {}, barcode = 'SKU-1' } = {}) => {
        const status = { textContent: '', dataset: {}, hidden: true };
        const search = { value: '', focus: () => { search.focused = true; }, select: () => { search.selected = true; } };
        const context = {
            db: { products: [{ id: 'P-1', code: 'SKU-1', name: 'Cà phê', stock }], settings },
            $: id => ({ 'pos-grid': {}, 'pos-scan-status': status, 'pos-search': search }[id] || null),
            addCart: () => { context.added++; if (stock <= 0) context.toasts.push({ message: 'Bán âm kho', type: 'warning' }); }, added: 0,
            showScannedProductPopup: () => { context.popup++; }, popup: 0,
            toast: (message, type) => context.toasts.push({ message, type }), toasts: [], renderPos: () => { context.rendered++; }, rendered: 0,
            console: { log: () => {} }
        };
        context.getScannerMode = settings => settings?.scannerAutoAdd !== false ? 'auto' : settings?.scannerPopup !== false ? 'popup' : 'find';
        createTestContext(context);
        vm.runInContext(between('function setPosScanStatus(', '\n// Keyboard nav'), context);
        context.processGlobalBarcode(barcode);
        return { context, status, search };
    };

    const added = run();
    assert.equal(added.context.added, 1);
    assert.deepEqual(added.context.toasts, [{ message: 'Đã quét: Cà phê', type: 'success' }]);
    assert.equal(added.status.hidden, true);
    assert.equal(added.search.focused, true);

    const popup = run({ settings: { scannerAutoAdd: false } });
    assert.equal(popup.context.popup, 1);
    assert.equal(popup.context.toasts.length, 1);
    assert.equal(popup.context.toasts[0].type, 'info');

    const found = run({ settings: { scannerAutoAdd: false, scannerPopup: false } });
    assert.equal(found.context.added, 0);
    assert.match(found.context.toasts[0].message, /Tìm thấy/);

    const outOfStock = run({ stock: 0 });
    assert.equal(outOfStock.context.added, 1);
    assert.deepEqual(outOfStock.context.toasts, [{ message: 'Bán âm kho', type: 'warning' }]);

    const missing = run({ barcode: 'UNKNOWN' });
    assert.equal(missing.context.toasts.length, 1);
    assert.equal(missing.context.toasts[0].type, 'warning');
    assert.match(missing.context.toasts[0].message, /Không tìm thấy/);
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
        toast: (message, type) => { exportContext.lastToast = { message, type }; }, logActivity: (action, detail) => { exportContext.activity = { action, detail }; }
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
    exportContext.activity = null;
    exportContext.exportToExcel([['Đặng']], ['Tên'], 'KhongLog', { appendDate: false, logActivity: false });
    assert.equal(exportContext.activity, null);
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
    vm.runInContext(between('function saveProd(', '\nfunction getOpenProductCartImpact('), product);
    assert.equal(product.saveProd(), true);
    assert.equal(product.db.products.length, 1);
    assert.equal(product.db.products[0].id, 'SKU-101');
    assert.equal(product.db.products[0].name, 'Sản phẩm đã sửa');

    const customerFields = new Map([
        ['debt-cust-id', { value: '9' }], ['debt-type', { value: 'add' }], ['debt-amount', { value: '25000' }]
    ]);
    const customer = {
        db: { custs: [{ id: 9, name: 'Khách A', debt: '10000' }] }, $: id => customerFields.get(id) || null,
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

test('customer deletion protects the default record and Undo restores only unchanged POS references after persistence', () => {
    function makeContext(saveResult = true) {
        const fields = new Map([['cart-cust', { value: 'Khách A' }]]);
        const defaultCustomer = { id: 1, name: 'Khách lẻ', points: 0, debt: 0, totalBuy: 0 };
        const customer = { id: 'C-9', name: 'Khách A', points: 12, debt: 10000, totalBuy: 25000 };
        const context = {
            db: { custs: [defaultCustomer, customer], invoices: [], returns: [], activityLog: [] },
            cust: { ...customer }, invoiceTabs: [{ id: 'TAB-9', cust: { ...customer } }], undoStack: [],
            UNDO_ACTIONS: { DELETE_CUSTOMER: 'DELETE_CUSTOMER' }, MAX_UNDO_HISTORY: 20,
            $: id => fields.get(id) || null, confirm: () => true, beginHistoryCommit: () => ({}), saveHistoryCommit: () => true,
            saveNow: () => {
                context.persistSnapshots.push({
                    activeCustomerId: context.cust?.id ?? null,
                    cartCustomer: fields.get('cart-cust').value,
                    tabCustomerId: context.invoiceTabs[0].cust?.id ?? null
                });
                return saveResult;
            },
            pushUndo: (type, data) => context.undoStack.push({ type, data: JSON.parse(JSON.stringify(data)) }),
            toast: (message, type) => context.toasts.push({ message, type }), showToast: (message, type) => context.toasts.push({ message, type }),
            updateCustList: () => { context.updateCustListCalls++; }, renderCustTable: () => { context.renderCustTableCalls++; },
            renderCart: () => { context.renderCartCalls++; }, toasts: [], persistSnapshots: [],
            updateCustListCalls: 0, renderCustTableCalls: 0, renderCartCalls: 0
        };
        createTestContext(context);
        vm.runInContext(between('function refreshCustomerReferences(', '\nasync function delCust'), context);
        vm.runInContext(between('async function delCust(', '\nfunction openDebtModal'), context);
        vm.runInContext(between('async function performUndo()', '\nfunction showLoading'), context);
        return { context, fields, defaultCustomer, customer };
    }

    const protectedDefault = makeContext();
    const protectedBefore = plain(protectedDefault.context.db);
    protectedDefault.context.delCust(1);
    assert.deepEqual(plain(protectedDefault.context.db), protectedBefore);
    assert.equal(protectedDefault.context.undoStack.length, 0);
    assert.match(protectedDefault.context.toasts.at(-1).message, /khách hàng mặc định/i);

    const restored = makeContext(true);
    restored.context.delCust('C-9');
    assert.deepEqual(restored.context.db.custs.map(customer => customer.id), [1]);
    assert.equal(restored.context.cust.id, 1);
    assert.equal(restored.fields.get('cart-cust').value, '');
    assert.equal(restored.context.invoiceTabs[0].cust, null);
    assert.deepEqual(restored.context.undoStack[0].data.references.tabs, [{ tabId: 'TAB-9', customer: restored.customer }]);

    restored.context.renderCartCalls = 0;
    restored.context.performUndo();
    assert.deepEqual(restored.context.persistSnapshots, [{ activeCustomerId: 1, cartCustomer: '', tabCustomerId: null }]);
    assert.equal(restored.context.cust.id, 'C-9');
    assert.equal(restored.fields.get('cart-cust').value, 'Khách A');
    assert.equal(restored.context.invoiceTabs[0].cust.id, 'C-9');
    assert.equal(restored.context.renderCartCalls, 1);
    assert.equal(restored.context.updateCustListCalls, 2);

    const unchangedChoice = makeContext(true);
    unchangedChoice.context.delCust('C-9');
    unchangedChoice.context.cust = { id: 'C-NEW', name: 'Khách mới' };
    unchangedChoice.fields.get('cart-cust').value = 'Khách mới';
    unchangedChoice.context.invoiceTabs[0].cust = { id: 'C-NEW', name: 'Khách mới' };
    unchangedChoice.context.renderCartCalls = 0;
    unchangedChoice.context.performUndo();
    assert.equal(unchangedChoice.context.cust.id, 'C-NEW');
    assert.equal(unchangedChoice.fields.get('cart-cust').value, 'Khách mới');
    assert.equal(unchangedChoice.context.invoiceTabs[0].cust.id, 'C-NEW');
    assert.equal(unchangedChoice.context.renderCartCalls, 0);

    const failedUndo = makeContext(false);
    failedUndo.context.delCust('C-9');
    failedUndo.context.performUndo();
    assert.deepEqual(plain(failedUndo.context.db.custs.map(customer => customer.id)), [1]);
    assert.equal(failedUndo.context.cust.id, 1);
    assert.equal(failedUndo.fields.get('cart-cust').value, '');
    assert.equal(failedUndo.context.invoiceTabs[0].cust, null);
    assert.equal(failedUndo.context.renderCartCalls, 0);
    assert.equal(failedUndo.context.undoStack.length, 1);
});

test('persisted relations use sameStoredId and identity inputs are never parsed as numbers', () => {
    const relation = /\.(?:id|productId|custId|supplierId|invoiceId|returnId|purchaseOrderId)\s*(?:===|!==|==|!=)|(?:===|!==|==|!=)\s*[^;]*\.(?:id|productId|custId|supplierId|invoiceId|returnId|purchaseOrderId)/;
    const allowed = [
        /invoiceTabs/, /activeTabId/, /activeModal\.id/, /modal\.id/, /input\.id/, /e\.target\.id/,
        /QUICK_RETURN/, /document\.activeElement/, /history-tab-/,
        /\.(?:id|supplierId)\s*(?:===|!=)\s*(?:undefined|null)/
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
    assert.match(main, /devTools:\s*false/);
    assert.match(main, /\bMenu\b/);
    assert.match(main, /Menu\.setApplicationMenu\(null\)/);
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

test('desktop reset recovers before commit and reports success after commit despite partial cleanup', async t => {
    const files = require('node:fs/promises');
    const path = require('node:path');
    const root = await files.mkdtemp(path.join(require('node:os').tmpdir(), 'ntkiot-reset-test-'));
    t.after(() => files.rm(root, { recursive: true, force: true }));
    const fingerprint = 'a'.repeat(64);
    const create = async (name, behavior = {}) => {
        const dir = path.join(root, name);
        const primary = path.join(dir, 'data.json'), backup = primary + '.bak', backupDir = path.join(dir, 'backups');
        await files.mkdir(backupDir, { recursive: true });
        await files.writeFile(primary, '{"original":true}');
        await files.writeFile(backup, '{"secondary":true}');
        await files.writeFile(path.join(backupDir, 'backup_original.json'), '{"archived":true}');
        const boot = behavior => {
            const logs = [];
            const eio = () => Object.assign(new Error('EIO'), { code: 'EIO' });
            const fsp = { ...files,
                rename: async (from, to) => {
                    if (behavior.failRename?.(from, to)) throw eio();
                    return files.rename(from, to);
                },
                rm: async (target, options) => {
                    if (behavior.failCleanup && target.endsWith('.committed/data')) {
                        await files.rm(path.join(target, 'data.json'), { force: true });
                        throw eio();
                    }
                    if (behavior.failRolledBackCleanup && target.endsWith('.rolled-back')) {
                        await files.rm(path.join(target, 'journal.json'), { force: true });
                        throw eio();
                    }
                    return files.rm(target, options);
                }
            };
            const context = {
                fsp, path, Buffer, process, MAX_DATA_BYTES: 1024 * 1024, parseDataText: JSON.parse,
                dataPaths: () => ({ primary, backup, backupDir }),
                mainWindow: { webContents: { executeJavaScript: async () => behavior.clearCache !== false } },
                logMainEvent: (type, payload) => logs.push({ type, payload }), logs
            };
            vm.createContext(context);
            for (const [start, end] of [['async function readRecord(', 'async function listBackupRecords('],
                ['async function writeTextFileDurably(', 'function isTrustedSender('], ['function resetPaths()', 'function scheduleBackupPasswordMigration(']]) {
                vm.runInContext(mainBetween(start, end), context);
            }
            return context;
        };
        return { primary, backup, backupDir, boot, context: boot(behavior) };
    };
    for (const target of ['data.json', 'data.json.bak', 'backups', '.ntkiot-reset.pending']) {
        const h = await create('fail-' + target, { failRename: (from, to) => path.basename(from) === target &&
            (to.includes('.pending/data/') || to.endsWith('.committed')) });
        await assert.rejects(() => h.context.resetStoredData('request', fingerprint), { code: 'EIO' });
        assert.equal(await files.readFile(h.primary, 'utf8'), '{"original":true}');
        assert.equal(await files.readFile(h.backup, 'utf8'), '{"secondary":true}');
        assert.equal(await h.context.committedResetReceipt('request'), null);
    }
    const pending = await create('interrupted');
    const pendingPaths = pending.context.resetPaths();
    const payload = path.join(pendingPaths.pending, 'data');
    await files.mkdir(payload, { recursive: true });
    await files.writeFile(path.join(pendingPaths.pending, 'journal.json'), JSON.stringify({ requestId: 'interrupted', fingerprint, present: [true, true, true] }));
    await files.rename(pending.primary, path.join(payload, 'data.json'));
    assert.equal(await pending.boot({}).reconcileReset(), false);
    assert.equal(await files.readFile(pending.primary, 'utf8'), '{"original":true}');

    const prepared = await create('interrupted-preparation');
    const preparing = prepared.context.resetPaths().preparing;
    await files.mkdir(preparing);
    await files.writeFile(path.join(preparing, 'journal.json'), '{"interrupted":');
    assert.equal(await prepared.boot({}).reconcileReset(), false);
    assert.equal(await prepared.context.pathExists(preparing), false);
    assert.equal(await files.readFile(prepared.primary, 'utf8'), '{"original":true}');

    const rolled = await create('rollback-cleanup');
    const rolledPaths = rolled.context.resetPaths();
    const staged = path.join(rolledPaths.pending, 'data');
    await files.mkdir(staged, { recursive: true });
    await files.writeFile(path.join(rolledPaths.pending, 'journal.json'), JSON.stringify({ requestId: 'rollback', fingerprint, present: [true, true, true] }));
    await files.rename(rolled.primary, path.join(staged, 'data.json'));
    const interruptedRollback = rolled.boot({ failRename: (from, to) => from === rolledPaths.pending && to === rolledPaths.rolledBack });
    await assert.rejects(() => interruptedRollback.reconcileReset(), { code: 'EIO' });
    assert.equal(await files.readFile(rolled.primary, 'utf8'), '{"original":true}');
    const pendingCleanup = rolled.boot({ failRolledBackCleanup: true });
    assert.equal(await pendingCleanup.reconcileReset(), false);
    assert.equal(await pendingCleanup.committedResetReceipt('rollback'), null);
    assert.equal(await pendingCleanup.pathExists(rolledPaths.pending), false);
    assert.equal(await pendingCleanup.pathExists(rolledPaths.rolledBack), true);
    await assert.rejects(() => pendingCleanup.resetStoredData('new-reset', fingerprint), { message: 'BUSY' });
    assert.equal(await files.readFile(rolled.primary, 'utf8'), '{"original":true}');
    await files.writeFile(rolled.primary, '{"new":true}');
    assert.equal(await rolled.boot({}).reconcileReset(), false);
    assert.equal(await rolled.context.pathExists(rolledPaths.rolledBack), false);
    assert.equal(await files.readFile(rolled.primary, 'utf8'), '{"new":true}');

    const h = await create('committed', { clearCache: false });
    await h.context.resetStoredData('committed', fingerprint);
    assert.equal(await h.context.pathExists(h.primary), false);
    const waiting = h.boot({ clearCache: false });
    assert.equal(await waiting.reconcileReset(), true);
    assert.equal(await waiting.pathExists(path.join(waiting.resetPaths().committed, 'data', 'data.json')), true);
    const partial = h.boot({ failCleanup: true });
    assert.equal(await partial.reconcileReset(), true);
    assert.equal((await partial.committedResetReceipt('committed')).fingerprint, fingerprint);
    assert.equal(partial.logs[0].type, 'reset-cleanup-pending');
    await files.writeFile(h.primary, '{"new":true}');
    const reopened = h.boot({});
    assert.equal(await reopened.reconcileReset(), true);
    assert.equal((await reopened.committedResetReceipt('committed')).requestId, 'committed');
    assert.equal(await files.readFile(h.primary, 'utf8'), '{"new":true}');
    assert.equal(await reopened.pathExists(reopened.resetPaths().committed), false);
    assert.match(mainSource, /registerAsync\('ntkiot:data-reset-all', async payload => authority.serial\(async \(\) => \{[\s\S]*?authority.requireRole\(\['admin'\]\);[\s\S]*?await resetStoredData\(payload.requestId, fingerprint\);/);
});

function rawBetween(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(start, -1, `Missing ${startMarker}`);
    assert.notEqual(end, -1, `Missing ${endMarker}`);
    return source.slice(start, end);
}

test('async persistence commits wait for a durable result and rollback on failure', async () => {
    const context = {
        activeDataMutation: {}, finishDataMutation: () => {},
        updateAffectedSupplierDebts: () => {},
        saveMutationNow: async () => false,
        saveNow: async () => false,
        rollbackSaleMutation: snapshot => { context.saleRollback = snapshot; },
        rollbackInventoryMutation: snapshot => { context.inventoryRollback = snapshot; },
        rollbackHistoryMutation: snapshot => { context.historyRollback = snapshot; },
        rollbackReturnMutation: snapshot => { context.returnRollback = snapshot; },
        setTimeout: () => { throw new Error('print must not be scheduled after a failed save'); },
        printReturnSlip: () => { throw new Error('print must not run after a failed save'); }
    };
    vm.createContext(context);
    vm.runInContext(rawBetween('async function saveSale(', '\nfunction captureInventoryMutationSnapshot'), context);
    vm.runInContext(rawBetween('async function saveInventoryCommit(', '\nfunction canMutateManagement'), context);
    vm.runInContext(rawBetween('async function saveHistoryCommit(', '\n// Direct checkout'), context);
    vm.runInContext(rawBetween('async function saveReturnAndPreview(', '\nfunction isReturnStockHistoryEntry'), context);

    assert.equal(await context.saveSale('sale'), false);
    assert.equal(context.saleRollback, 'sale');
    const inventorySnapshot = { purchaseOrders: [] };
    assert.equal(await context.saveInventoryCommit(inventorySnapshot), false);
    assert.equal(context.inventoryRollback, inventorySnapshot);
    assert.equal(await context.saveHistoryCommit('history'), false);
    assert.equal(context.historyRollback, 'history');
    assert.equal(await context.saveReturnAndPreview('RET-1', 'return'), false);
    assert.equal(context.returnRollback, 'return');
});

test('startup loads backup data only after primary and data.bak fail', async () => {
    const calls = [];
    const context = {
        desktop: { data: {
            loadPrimary: async () => { calls.push('primary'); return { ok: true, primary: { exists: true, text: '{"ok":"primary"}' } }; },
            loadBak: async () => { calls.push('bak'); return { ok: true, backup: { exists: true, text: '{"ok":"bak"}' } }; },
            listBackups: async () => { calls.push('list'); return { ok: true, backups: [{ id: 'new' }, { id: 'old' }] }; },
            readBackup: async id => { calls.push(`read:${id}`); return { ok: true, text: id === 'old' ? '{"ok":"old"}' : '{broken' }; }
        } },
        loadJsonDataText: text => JSON.parse(text),
        loadBackupJsonDataText: text => JSON.parse(text),
        console: { warn: () => {} }
    };
    vm.createContext(context);
    vm.runInContext(rawBetween('async function listBackupFiles()', '\nfunction getBackupIntervalMs'), context);

    const primary = await context.loadPersistedData();
    assert.equal(primary.source, 'primary');
    assert.deepEqual(calls, ['primary']);

    context.desktop.data.loadPrimary = async () => { calls.push('primary-fail'); return { ok: true, primary: { exists: true, text: '{broken' } }; };
    context.desktop.data.loadBak = async () => { calls.push('bak-fail'); return { ok: true, backup: { exists: true, text: '{broken' } }; };
    calls.length = 0;
    const recovered = await context.loadPersistedData();
    assert.equal(recovered.source, 'backup');
    assert.equal(recovered.data.ok, 'old');
    assert.deepEqual(calls, ['primary-fail', 'bak-fail', 'list', 'read:new', 'read:old']);
});

test('1.0.2 bridge and management analysis remain non-blocking and preserve legacy ID lookup', () => {
    const main = fs.readFileSync(require.resolve('../main.js'), 'utf8');
    const preload = fs.readFileSync(require.resolve('../preload.js'), 'utf8');
    assert.doesNotMatch(preload, /sendSync/);
    assert.match(preload, /ipcRenderer\.invoke/);
    assert.match(main, /ipcMain\.handle/);
    assert.match(main, /fs\.promises/);
    assert.match(source, /function analyzeInvoices\(invoices = \[\]\)/);
    assert.match(source, /const productLookup = createProductLookup\(\)/);
    assert.match(source, /analysis\.orderCosts\.get\(o\)/);
    assert.match(source, /const catSales = analysis\.categorySales/);
    assert.match(source, /const products = \[\.\.\.analysis\.productSales\.values\(\)\]/);
});

test('performance render paths reuse ID-safe lookup and skip inactive views', () => {
    const context = {
        db: {
            products: [{ id: 101, cost: 7000, cat: 'Cà phê' }]
        }
    };
    vm.createContext(context);
    vm.runInContext(rawBetween('function createProductLookup(', '\n// Format date as YYYY-MM-DD'), context);

    const lookup = context.createProductLookup();
    assert.equal(context.getInvoiceItemCost({ id: '101' }, lookup), 7000);
    assert.equal(context.getInvoiceCost({ items: [{ id: '101', qty: 2 }] }, lookup), 14000);

    const dashboard = rawBetween('function renderDashboard()', '\nfunction drawRevenueChart(');
    const pieChart = rawBetween('function drawPieChart(', '\n// SETTINGS');
    const management = rawBetween('function renderManagement()', '\n// Management Report Date Filter');
    assert.match(source, /function isViewActive\(id\)/);
    assert.match(dashboard, /if \(!isViewActive\('reports-view'\)\) return;/);
    assert.match(dashboard, /getInvoiceCost\(inv, productLookup\)/);
    assert.match(dashboard, /drawRevenueChart\(invoiceDateCache\)/);
    assert.match(pieChart, /lookup\.get\(String\(item\?\.id\)\)/);
    assert.doesNotMatch(pieChart, /db\.products\.find/);
    assert.match(management, /if \(!isViewActive\('management-view'\)\) return;/);
    assert.doesNotMatch(management, /renderDashboard\(\)/);
});

test('text search is debounced without changing immediate filters or POS input', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    assert.match(source, /const debouncedHistSearch = debounce\(\(\) => renderHist\(\), 150\)/);
    assert.match(source, /const debouncedReturnsSearch = debounce\(\(\) => renderReturnsHistory\(\), 150\)/);
    assert.match(source, /function onProductTableFiltersChanged\(deferred = false\)/);
    assert.match(html, /id="hist-staff-search"[\s\S]*?oninput="debouncedHistSearch\(\)"/);
    assert.match(html, /id="returns-staff-search"[\s\S]*?oninput="debouncedReturnsSearch\(\)"/);
    assert.match(html, /id="prod-search"[\s\S]*?oninput="onProductTableFiltersChanged\(true\)"/);
    assert.match(html, /id="prod-price-min"[\s\S]*?oninput="onProductTableFiltersChanged\(true\)"/);
    assert.match(html, /id="prod-price-max"[\s\S]*?oninput="onProductTableFiltersChanged\(true\)"/);
    assert.match(html, /id="pos-search"[\s\S]*?oninput="handleSearchInput\(\)"/);
});

test('POS routing keeps its customer picker without rendering the hidden customer table', () => {
    const router = rawBetween('function router(id)', '\n// Products tab switching');
    const posBranch = router.slice(router.indexOf("if (id === 'pos')"), router.indexOf("if (id === 'products')"));
    assert.match(posBranch, /updateCustList\(\)/);
    assert.doesNotMatch(posBranch, /renderCustTable\(\)/);
});

function makeProductDeletionContext(saveResult = true) {
    const invoice = { id: 'INV-1', items: [{ id: 'SKU-LEGACY', name: 'Tên hóa đơn', cat: 'Danh mục cũ', cost: 4000, price: 10000, qty: 1 }] };
    const returnRecord = { id: 'RET-1', returnItems: [{ id: 'SKU-LEGACY', name: 'Tên trả', qty: 1 }], exchangeItems: [] };
    const purchaseOrder = { id: 'PO-1', items: [{ productId: 'SKU-LEGACY', productName: 'Tên phiếu nhập', productCode: 'PO-CODE', price: 4000, sellPrice: 10000, qty: 1 }] };
    const stockHistory = [{ id: 'STK-1', productId: 'SKU-LEGACY', productName: 'Tên lịch sử', qty: 1 }];
    const context = {
        db: {
            products: [{ id: 'SKU-LEGACY', name: 'Tên kho', stock: 4, cat: 'Danh mục mới' }],
            invoices: [invoice], returns: [returnRecord], purchaseOrders: [purchaseOrder], stockHistory, activityLog: []
        },
        invoiceTabs: [
            { id: 1, cart: [], returnItems: [], exchangeItems: [] },
            { id: 2, cart: [], returnItems: [], exchangeItems: [{ id: 'SKU-LEGACY', qty: 1 }] }
        ],
        activeTabId: 1, cart: [{ id: 'SKU-LEGACY', qty: 1 }], returnItems: [{ id: 'SKU-LEGACY', qty: 1 }], exchangeItems: [],
        undoStack: [], selectedProducts: new Set(), UNDO_ACTIONS: { DELETE_PRODUCT: 'DELETE_PRODUCT' },
        canMutateManagement: () => true, confirm: message => { context.confirmMessage = message; return true; },
        beginInventoryCommit: () => { context.snapshot = plain(context.db); return context.snapshot; },
        saveInventoryCommit: () => {
            context.saveCalls++;
            if (saveResult) return true;
            context.db = plain(context.snapshot);
            return false;
        },
        saveCalls: 0, pushUndo: (type, data) => context.undoStack.push({ type, data: plain(data) }),
        logActivity: (action, detail) => context.db.activityLog.unshift({ action, detail }),
        saveCurrentTabState: () => {
            const active = context.invoiceTabs.find(tab => tab.id === context.activeTabId);
            if (active) {
                active.cart = plain(context.cart);
                active.returnItems = plain(context.returnItems);
                active.exchangeItems = plain(context.exchangeItems);
            }
        },
        renderProdTable: () => {}, renderPos: () => {}, renderCart: () => {}, renderReturnExchangeView: () => {}, updateReturnExchangeFooter: () => {},
        updateBulkDeleteUI: () => {},
        toast: (message, type) => { context.lastToast = { message, type }; }
    };
    createTestContext(context);
    vm.runInContext(between('function getOpenProductCartImpact(', '\nfunction updateBulkDeleteUI'), context);
    return { context, invoice, returnRecord, purchaseOrder, stockHistory };
}

test('product deletion removes only inventory and live carts after durable save', () => {
    const { context, invoice, returnRecord, purchaseOrder, stockHistory } = makeProductDeletionContext();
    assert.equal(context.delP('SKU-LEGACY'), true);
    assert.equal(context.saveCalls, 1);
    assert.equal(context.db.products.length, 0);
    assert.deepEqual(plain(context.db.invoices), [invoice]);
    assert.deepEqual(plain(context.db.returns), [returnRecord]);
    assert.deepEqual(plain(context.db.purchaseOrders), [purchaseOrder]);
    assert.deepEqual(plain(context.db.stockHistory), stockHistory);
    assert.equal(context.cart.length, 0);
    assert.equal(context.returnItems.length, 0);
    assert.equal(context.exchangeItems.length, 0);
    assert.equal(context.invoiceTabs.every(tab => tab.cart.length === 0 && tab.returnItems.length === 0 && tab.exchangeItems.length === 0), true);
    assert.deepEqual(plain(context.undoStack), [{ type: 'DELETE_PRODUCT', data: { id: 'SKU-LEGACY', name: 'Tên kho', stock: 4, cat: 'Danh mục mới' }, owner: 'TEST-ADMIN', session: 0 }]);
    assert.match(context.confirmMessage, /3 dòng trong 2 đơn\/giỏ/);
    assert.match(context.confirmMessage, /Hóa đơn, lịch sử, báo cáo/);

    const failed = makeProductDeletionContext(false).context;
    const beforeDb = plain(failed.db);
    const beforeTabs = plain(failed.invoiceTabs);
    const beforeCart = plain([failed.cart, failed.returnItems, failed.exchangeItems]);
    assert.equal(failed.delP('SKU-LEGACY'), false);
    assert.deepEqual(plain(failed.db), beforeDb);
    assert.deepEqual(plain(failed.invoiceTabs), beforeTabs);
    assert.deepEqual(plain([failed.cart, failed.returnItems, failed.exchangeItems]), beforeCart);
    assert.deepEqual(plain(failed.undoStack), []);

    const bulk = makeProductDeletionContext().context;
    bulk.db.products.push({ id: 'SKU-FREE', name: 'Không liên kết', stock: 1 });
    bulk.selectedProducts = new Set(['SKU-LEGACY', 'SKU-FREE']);
    bulk.deleteSelectedProducts();
    assert.equal(bulk.db.products.length, 0);
    assert.equal(bulk.selectedProducts.size, 0);
});

test('invoice reports use stored snapshots after product deletion and ID reuse', () => {
    const context = { db: { products: [] } };
    vm.createContext(context);
    vm.runInContext(rawBetween('function createProductLookup(', '\n// Format date as YYYY-MM-DD'), context);
    const invoice = { items: [{ id: 'SKU-LEGACY', name: 'Tên cũ', cat: 'Danh mục cũ', cost: 4000, price: 10000, qty: 2 }] };

    const withoutProduct = context.analyzeInvoices([invoice]);
    assert.equal(withoutProduct.categorySales['Danh mục cũ'], 20000);
    assert.equal(withoutProduct.totalCost, 8000);
    assert.equal(withoutProduct.productSales.get('SKU-LEGACY').name, 'Tên cũ');

    context.db.products = [{ id: 'SKU-LEGACY', name: 'Tên mới', cat: 'Danh mục mới', cost: 9000 }];
    const reusedId = context.analyzeInvoices([invoice]);
    assert.equal(reusedId.categorySales['Danh mục cũ'], 20000);
    assert.equal(reusedId.totalCost, 8000);
    assert.match(rawBetween('function drawPieChart(', '\n// SETTINGS'), /item\?\.cat \|\| prod\?\.cat \|\| 'Khác'/);
});

test('deleted-product return cleanup and purchase-order labels use record snapshots', async () => {
    const returnRecord = { id: 'RET-1', returnItems: [{ id: 'SKU-LEGACY', qty: 1 }], exchangeItems: [{ id: 'SKU-OTHER', qty: 2 }] };
    const returnContext = {
        db: { products: [], returns: [returnRecord], stockHistory: [{ id: 'STK-1' }], activityLog: [] },
        undoStack: [], selectedReturns: new Set(['RET-1']), sameStoredId: (left, right) => String(left) === String(right),
        beginReturnCommit: () => ({}), saveNow: async () => true, rollbackReturnMutation: () => { throw new Error('unexpected rollback'); },
        isReturnStockHistoryEntry: () => true, restoreCustomerPointsAfterUndoReturn: () => {}, restoreReturnDeletedInvoice: () => false,
        logActivity: () => {}, renderPos: () => {}, renderInventory: () => {}, renderStockHistory: () => {}, renderHist: () => {}, renderReturnsHistory: () => {}, renderManagement: () => {}, renderStaffView: () => {},
        toast: (message, type) => { returnContext.lastToast = { message, type }; }
    };
    createTestContext(returnContext);
    vm.runInContext(rawBetween('async function deleteReturnRecords(', '\nasync function deleteReturn'), returnContext);
    assert.equal(await returnContext.deleteReturnRecords([returnRecord], 'Xóa', 'Phiếu', 'Đã xóa.'), true);
    assert.equal(returnContext.db.returns.length, 0);
    assert.match(returnContext.lastToast.message, /Không điều chỉnh tồn kho cho 2 dòng/);

    const poContext = { db: { products: [] }, sameStoredId: (left, right) => String(left) === String(right) };
    vm.createContext(poContext);
    vm.runInContext(rawBetween('function getPOItemLabelProduct(', '\nfunction printBatchLabelsForPO'), poContext);
    assert.deepEqual(plain(poContext.getPOItemLabelProduct({ productId: 'SKU-LEGACY', productName: 'Tên phiếu nhập', productCode: 'PO-CODE', price: 4000, sellPrice: 10000 })), {
        id: 'SKU-LEGACY', name: 'Tên phiếu nhập', code: 'PO-CODE', price: 10000
    });
});

test('product column sorts use the existing filter pipeline and preserve role boundaries', () => {
    const context = {
        db: { settings: { lowStock: 5 }, users: [{ id: 1, role: 'admin' }] },
        isAuthenticated: true, currUser: { id: 1, role: 'admin' }
    };
    createTestContext(context);
    vm.runInContext(between('function getProductStockStatus(', '\nfunction getFilteredProductsForTable'), context);

    const products = [
        { id: 3, code: 'B-02', name: 'Beta', cat: 'Nước', price: 30000, cost: 15000, stock: 10 },
        { id: 2, code: 'A-01', name: 'Alpha', cat: 'Cà phê', price: 10000, cost: 7000, stock: 3 },
        { id: 1, code: 'C-03', name: 'Gamma', cat: 'Cà phê', price: 20000, cost: 9000, stock: 0 }
    ];
    const before = plain(products);
    const sortedIds = sort => plain(context.applyProductFilters(products, { sort }).map(product => product.id));

    assert.deepEqual(sortedIds('code_asc'), [2, 3, 1]);
    assert.deepEqual(sortedIds('category_asc'), [2, 1, 3]);
    assert.deepEqual(sortedIds('price_desc'), [3, 1, 2]);
    assert.deepEqual(sortedIds('cost_asc'), [2, 1, 3]);
    assert.deepEqual(sortedIds('stock_asc'), [1, 2, 3]);
    assert.deepEqual(sortedIds('status_asc'), [1, 2, 3]);
    assert.deepEqual(plain(products), before, 'sorting never mutates product data');

    context.currUser.role = 'manager';
    context.db.users[0].role = 'manager';
    assert.equal(context.normalizeProductSort('cost_asc'), 'new_desc');
});

test('stock-history search and sorting are read-only, legacy-safe, and keep missing amounts last', () => {
    const fields = new Map([
        ['inv-stock-filter', { value: 'all' }], ['inv-stock-search', { value: '' }],
        ['stock-filter', { value: 'all' }], ['stock-search', { value: '' }],
        ['stock-date-from', { value: '', dataset: {} }], ['stock-date-to', { value: '', dataset: {} }]
    ]);
    const context = {
        db: {
            products: [{ id: 'SKU-1', code: 'CF01' }],
            stockHistory: [
                { id: 'A', date: '2026-01-03T08:00:00Z', type: 'in', productId: 'SKU-1', productName: 'Cà phê', qty: 10, price: 5, total: 50 },
                { id: 'B', date: '2026-01-02T08:00:00Z', type: 'out', productId: 'SKU-1', productName: 'Cà phê', qty: 2, price: 20, total: 40 },
                { id: 'C', date: 'ngày lỗi', type: 'adjust', productId: 'SKU-ĐÃ-XÓA', productName: 'Hàng đã xóa', qty: 1 }
            ]
        },
        $: id => fields.get(id) || null,
        parseLocalDateInput: (value, endOfDay) => {
            const [year, month, day] = String(value || '').split('-').map(Number);
            return year && month && day ? new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0) : null;
        },
        toast: (message, type) => { context.dateToast = { message, type }; }
    };
    createTestContext(context);
    vm.runInContext(between('const stockHistorySortStates =', '\n// Delete stock history entry'), context);

    const before = plain(context.db);
    fields.get('inv-stock-search').value = 'cf01';
    assert.deepEqual(plain(context.getFilteredSortedStockHistory('inventory').map(entry => entry.id)), ['A', 'B']);
    fields.get('inv-stock-search').value = 'đã xóa';
    assert.deepEqual(plain(context.getFilteredSortedStockHistory('inventory').map(entry => entry.id)), ['C']);

    fields.get('inv-stock-search').value = '';
    vm.runInContext("stockHistorySortStates.inventory = { key: 'price', direction: 'asc' };", context);
    assert.deepEqual(plain(context.getFilteredSortedStockHistory('inventory').map(entry => entry.id)), ['A', 'B', 'C']);
    vm.runInContext("stockHistorySortStates.inventory = { key: 'price', direction: 'desc' };", context);
    assert.deepEqual(plain(context.getFilteredSortedStockHistory('inventory').map(entry => entry.id)), ['B', 'A', 'C']);
    fields.get('inv-stock-filter').value = 'out';
    assert.deepEqual(plain(context.getFilteredSortedStockHistory('inventory').map(entry => entry.id)), ['B']);

    fields.get('stock-filter').value = 'all';
    fields.get('stock-date-from').value = '2026-01-02';
    fields.get('stock-date-to').value = '2026-01-02';
    assert.deepEqual(plain(context.getFilteredSortedStockHistory('management').map(entry => entry.id)), ['B']);
    assert.deepEqual(plain(context.db), before, 'search and sorting never mutate stock history or products');

    const stockSearch = source.slice(source.indexOf('function getFilteredSortedStockHistory('), source.indexOf('\nfunction updateStockHistorySortUI', source.indexOf('function getFilteredSortedStockHistory(')));
    assert.doesNotMatch(stockSearch, /\.find\(/, 'SKU lookup never scans products for every history row');
});

test('management-only stock-history date controls stay scoped away from the products inventory view', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
    const managementStart = html.indexOf('<div id="management-view"');
    const productsStart = html.indexOf('<div id="products-view"');
    const managementMarkup = html.slice(managementStart);
    const productsMarkup = html.slice(productsStart, managementStart);

    assert.match(managementMarkup, /id="stock-date-filter-dropdown"/);
    assert.match(managementMarkup, /onclick="toggleDateFilter\('stock'\)"/);
    assert.match(managementMarkup, /id="stock-date-filter-label">📅 Tất cả/);
    assert.match(managementMarkup, /id="stock-calendar-container"/);
    assert.match(managementMarkup, /<input type="hidden" id="stock-date-from">/);
    assert.match(managementMarkup, /<input type="hidden" id="stock-date-to">/);
    assert.doesNotMatch(managementMarkup, /management-stock-history-date-range|onManagementStockHistoryDateChanged/);
    assert.doesNotMatch(productsMarkup, /stock-date-(?:from|to)|onManagementStockHistoryDateChanged/);
    assert.match(css, /#management-view \.management-stock-history-filters/);
    assert.doesNotMatch(css, /management-stock-history-date-range/);
    assert.doesNotMatch(source, /function onManagementStockHistoryDateChanged\(/);
    assert.doesNotMatch(source.match(/inventory:\s*\{[^}]+\}/)?.[0] || '', /DateId/);
});

test('inventory-check close warning preserves unconfirmed differences without touching data', () => {
    const active = { 'inventory-check-modal': true, 'other-modal': true };
    const modal = id => ({ id, classList: { contains: name => name === 'active' && active[id], remove: name => { if (name === 'active') active[id] = false; } } });
    const input = { id: 'ic-actual-1', value: '7' };
    const context = {
        db: { products: [{ id: 1, stock: 5 }], stockHistory: [], activityLog: [] }, isAuthenticated: true,
        $: id => id === 'inventory-check-modal' ? modal(id) : null,
        closeModal: id => { context.closed.push(id); active[id] = false; return true; }, closed: [],
        confirm: () => false, parseNonNegativeStock: value => Number.isFinite(Number(value)) && String(value).trim() !== '' && Number(value) >= 0 ? Number(value) : null,
        isLoginDisabled: () => false, showLoginModal: () => { context.loginShown = true; },
        document: {
            querySelectorAll: selector => selector === '#inventory-check-modal input[id^="ic-actual-"]'
                ? [input]
                : selector === '.modal-overlay.active'
                    ? ['other-modal', 'inventory-check-modal'].filter(id => active[id]).map(modal)
                    : []
        }
    };
    createTestContext(context);
    vm.runInContext(between('let inventoryCheckData = {};', '\nfunction openInventoryCheckModal'), context);
    vm.runInContext("inventoryCheckData = { '1': { systemStock: 5, actualStock: 5, diff: 0 } };", context);
    vm.runInContext(between('const originalCloseModal = closeModal;', '\nfunction addProductToPO'), context);
    vm.runInContext(between('function closeAllModals()', '\n// ═'), context);
    vm.runInContext(between('function logout()', '\n// ═'), context);

    const beforeDb = plain(context.db);
    assert.equal(context.closeModal('inventory-check-modal'), false);
    assert.equal(active['inventory-check-modal'], true);
    assert.deepEqual(context.closed, []);
    assert.deepEqual(plain(context.db), beforeDb);

    assert.equal(context.closeAllModals(), false);
    assert.equal(active['other-modal'], true, 'other modals remain open when inventory close is cancelled');
    assert.equal(context.logout(), false);
    assert.equal(context.loginShown, undefined);

    context.confirm = () => true;
    assert.equal(context.closeAllModals(), true);
    assert.equal(active['inventory-check-modal'], false);
    assert.equal(active['other-modal'], false);
    assert.deepEqual(plain(context.db), beforeDb);

    active['inventory-check-modal'] = true;
    vm.runInContext('skipInventoryCheckCloseWarning = true;', context);
    context.confirm = () => { throw new Error('successful inventory save must bypass the close warning'); };
    assert.equal(context.closeModal('inventory-check-modal'), true);
    assert.equal(active['inventory-check-modal'], false);
});

test('purchase-order close confirms changes, preserves cancel focus and blocks pending or unknown saves', () => {
    const closeFlow = rawBetween('function completePurchaseOrderClose()', '\ncloseModal = function');
    const context = { currentPOItems: [{productId: 0, qty: 2}], editingPOId: 0, editingPODateValue: {},
        poFormInitialState: 'initial', activeDataMutation: null, saveBlockedReason: '', questions: 0, closes: [],
        capturePurchaseOrderFormState: () => 'changed',
        confirm: () => { context.questions++; return false; },
        originalCloseModal: id => context.closes.push(id),
        document: { activeElement: { isConnected: true, focus: () => { context.focused = true; } } },
        $: () => ({ contains: () => true }) };
    createTestContext(context); vm.runInContext(closeFlow, context);
    assert.equal(context.closePurchaseOrder(), false);
    assert.equal(context.focused, true); assert.equal(context.questions, 1);
    assert.equal(context.currentPOItems.length, 1); assert.equal(context.editingPOId, 0);
    context.activeDataMutation = { owner: 'savePurchaseOrder' };
    assert.equal(context.closePurchaseOrder(), false); assert.equal(context.questions, 1);
    context.activeDataMutation = null; context.saveBlockedReason = 'unknown';
    assert.equal(context.closePurchaseOrder(), false); assert.equal(context.questions, 1);
    context.saveBlockedReason = ''; context.capturePurchaseOrderFormState = () => 'initial';
    assert.equal(context.closePurchaseOrder(), true); assert.equal(context.questions, 1);
    assert.deepEqual(context.closes, ['purchase-order-modal']); assert.equal(context.currentPOItems.length, 0);
    assert.equal(context.poFormInitialState, null); assert.equal(context.editingPOId, null);
    context.poFormInitialState = 'initial'; context.capturePurchaseOrderFormState = () => 'changed';
    context.confirm = () => true; assert.equal(context.closePurchaseOrder(), true);
    assert.deepEqual(context.closes, ['purchase-order-modal', 'purchase-order-modal']);
    const shortcuts = source.slice(source.indexOf('function handleGlobalShortcuts('), source.indexOf('\n// Focus search', source.indexOf('function handleGlobalShortcuts(')));
    assert.match(shortcuts, /closeModal\(activeModal\.id\)/);
    assert.doesNotMatch(shortcuts, /activeModal\.classList\.remove\('active'\)/);
});

test('quick-add from a purchase order waits for the committed product identity', async () => {
    const quickStart = source.indexOf('const originalSaveProdForPO = saveProd;');
    const quickEnd = source.indexOf('\n// Restore PO modal if prod modal is closed without saving', quickStart);
    const closeStart = source.indexOf('const originalCloseModal = closeModal;', quickEnd);
    const closeEnd = source.indexOf('\nfunction addProductToPO(', closeStart);
    assert.notEqual(quickStart, -1);
    assert.notEqual(quickEnd, -1);
    assert.notEqual(closeStart, -1);
    assert.notEqual(closeEnd, -1);

    const makeContext = () => {
        const storage = new Map([['addingFromPO', 'true']]);
        const poModal = { classList: { remove: value => { context.blurRemoved = value; } } };
        const context = {
            mode: 'fail', db: { products: [{ id: 'P-OLD', name: 'Cũ' }] }, added: [], toasts: [], closed: [], blurRemoved: null,
            sessionStorage: { getItem: key => storage.get(key) || null, removeItem: key => storage.delete(key) },
            $: id => id === 'purchase-order-modal' ? poModal : null,
            toast: (message, type) => context.toasts.push({ message, type }),
            addProductToPO: id => context.added.push(id),
            closeModal: id => context.closed.push(id),
            saveProd: async () => {
                if (context.mode === 'fail') return false;
                if (context.mode === 'ambiguous') context.db.products.push({ id: 'P-NEW-1', name: 'Mới 1' }, { id: 'P-NEW-2', name: 'Mới 2' });
                else context.db.products.push({ id: 'P-NEW', name: 'Mới' });
                context.closeModal('prod-modal');
                return true;
            }
        };
        context.marker = () => storage.get('addingFromPO') || null;
        return context;
    };

    const context = makeContext();
    createTestContext(context);
    vm.runInContext(source.slice(quickStart, quickEnd), context);
    vm.runInContext(source.slice(closeStart, closeEnd), context);

    assert.equal(await context.saveProd(), false);
    assert.equal(context.marker(), 'true', 'failed save keeps the retry marker');
    assert.deepEqual(context.added, []);
    assert.equal(context.toasts.some(({ message }) => /Đã thêm/.test(message)), false);

    context.mode = 'success';
    assert.equal(await context.saveProd(), true);
    assert.deepEqual(context.added, ['P-NEW']);
    assert.equal(context.marker(), null);
    assert.equal(context.blurRemoved, 'modal-blurred');
    assert.equal(context.toasts.filter(({ message }) => /Đã thêm/.test(message)).length, 1);

    const ambiguous = makeContext();
    ambiguous.mode = 'ambiguous';
    createTestContext(ambiguous);
    vm.runInContext(source.slice(quickStart, quickEnd), ambiguous);
    vm.runInContext(source.slice(closeStart, closeEnd), ambiguous);
    assert.equal(await ambiguous.saveProd(), false);
    assert.deepEqual(ambiguous.added, []);
    assert.equal(ambiguous.marker(), null);
    assert.equal(ambiguous.toasts.some(({ type }) => type === 'error'), true);
    assert.doesNotMatch(source.slice(quickStart, quickEnd), /setTimeout/);
});

test('draft delete renderers wait for persistence and never show false success', async () => {
    const deleteDraftSource = rawBetween('async function deleteDraft(', '\nfunction getDraftsList');
    const modalDeleteSource = rawBetween('async function deleteDraftFromModal(', '\nfunction loadInvoiceDraftFromModal');

    const makeContext = saveNow => {
        const context = {
            db: { drafts: { invoices: [{ id: 'D-1' }], purchaseOrders: [{ id: 'PO-D-1' }] } },
            activeDraftType: 'invoices', saveNow, confirm: () => true, renders: [], toasts: [],
            toast: (message, type) => context.toasts.push({ message, type }),
            renderDraftsModalList: () => context.renders.push('modal')
        };
        createTestContext(context);
        vm.runInContext(deleteDraftSource, context);
        vm.runInContext(modalDeleteSource, context);
        return context;
    };

    const failed = makeContext(async () => false);
    assert.equal(await failed.deleteDraftFromModal('D-1'), false);
    assert.deepEqual(plain(failed.db.drafts.invoices), [{ id: 'D-1' }]);
    assert.deepEqual(failed.renders, ['modal']);
    assert.equal(failed.toasts.some(({ message }) => /^Đã xóa/.test(message)), false);

    const saved = makeContext(async () => true);
    assert.equal(await saved.deleteDraftFromModal('D-1'), true);
    assert.deepEqual(plain(saved.db.drafts.invoices), []);
    assert.deepEqual(saved.renders, ['modal']);
    assert.equal(saved.toasts.filter(({ message }) => /^Đã xóa/.test(message)).length, 1);
    assert.equal(await saved.deleteDraft('purchaseOrders', 'PO-D-1'), false);
    assert.deepEqual(plain(saved.db.drafts.purchaseOrders), [{ id: 'PO-D-1' }]);
    assert.deepEqual(saved.renders, ['modal']);

    let resolveSave;
    const changedTab = makeContext(() => new Promise(resolve => { resolveSave = resolve; }));
    const pending = changedTab.deleteDraftFromModal('D-1');
    changedTab.activeDraftType = 'purchaseOrders';
    resolveSave(true);
    await pending;
    assert.deepEqual(changedTab.renders, [], 'a completed delete never redraws a different active draft tab');
});

test('supplier sorting and duplicate-name guard preserve linked data before commit', () => {
    const fields = new Map([
        ['sup-id', { value: '' }], ['sup-name', { value: '  ncc   a  ' }], ['sup-contact', { value: '' }],
        ['sup-phone', { value: '' }], ['sup-email', { value: '' }], ['sup-addr', { value: '' }], ['sup-note', { value: '' }]
    ]);
    const context = {
        db: {
            suppliers: [{ id: 'SUP-1', name: 'NCC A', debt: 100 }, { id: 'SUP-2', name: 'NCC B', debt: 500 }],
            purchaseOrders: [{ id: 'PO-1', supplierId: 'SUP-1' }], activityLog: []
        },
        currUser: { role: 'admin' }, isAuthenticated: true, undoStack: [{ type: 'KEEP' }],
        $: id => fields.get(id) || { value: '' }, toast: (message, type) => { context.lastToast = { message, type }; },
        escapeJsArgument: value => JSON.stringify(value), escapeHtml: value => String(value ?? ''), money: value => String(value ?? 0),
        beginInventoryCommit: () => { context.commits++; return {}; }, saveInventoryCommit: () => { context.saves++; return true; },
        closeModal: () => { context.closed++; }, commits: 0, saves: 0, closed: 0,
        renderSuppliers: () => {}, document: { querySelectorAll: () => [] }
    };
    createTestContext(context);
    vm.runInContext(between('// SUPPLIERS\nlet supplierSortState', '\nfunction getSupplierDependencies'), context);

    const beforeBlocked = plain({ db: context.db, undoStack: context.undoStack });
    context.saveSupplier();
    assert.equal(context.commits, 0);
    assert.equal(context.saves, 0);
    assert.equal(context.closed, 0);
    assert.match(context.lastToast.message, /đã tồn tại/);
    assert.deepEqual(plain({ db: context.db, undoStack: context.undoStack }), beforeBlocked);

    vm.runInContext("supplierSortState = { key: 'debt', direction: 'desc' };", context);
    assert.deepEqual(plain(context.getSortedSuppliers().map(supplier => supplier.id)), ['SUP-2', 'SUP-1']);

    context.db.suppliers[1].name = 'ncc a';
    fields.get('sup-id').value = 'SUP-1';
    fields.get('sup-name').value = 'NCC A';
    context.saveSupplier();
    assert.equal(context.commits, 1, 'legacy duplicate can update without renaming');
    assert.equal(context.saves, 1);
    assert.equal(context.db.purchaseOrders[0].supplierId, 'SUP-1');
});

test('sortable table headers use native controls and accessible state', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');

    assert.match(html, /data-product-sort-key="status" aria-sort="none"><button type="button" class="sortable-header"/);
    assert.match(html, /data-stock-history-view="inventory" data-stock-history-sort-key="date" aria-sort="descending"/);
    assert.match(html, /data-stock-history-view="management" data-stock-history-sort-key="total" aria-sort="none"/);
    assert.equal((html.match(/data-supplier-sort-key="debt"/g) || []).length, 2);
    assert.match(html, /data-history-sort-view="sales" data-history-sort-key="method" aria-sort="none"><button type="button" class="sortable-header"/);
    assert.match(html, /data-history-sort-view="returns" data-history-sort-key="difference" aria-sort="none"><button type="button" class="sortable-header"/);
    assert.match(html, /data-customer-sort-key="totalBuy" aria-sort="none"><button type="button" class="sortable-header"/);
    assert.match(html, /data-staff-sort-key="total" aria-sort="none"><button type="button" class="sortable-header"/);
    assert.match(css, /\.sortable-header:focus-visible/);
    const sortableHeaderCss = css.slice(css.indexOf('.sortable-header {'), css.indexOf('.sortable-header:focus-visible'));
    assert.match(sortableHeaderCss, /border: none !important/);
    assert.match(sortableHeaderCss, /box-shadow: none !important/);
    assert.match(sortableHeaderCss, /padding: 0 !important/);
    assert.match(sortableHeaderCss, /font-size: inherit !important/);
    assert.match(sortableHeaderCss, /letter-spacing: inherit !important/);
    assert.match(sortableHeaderCss, /text-transform: inherit !important/);
    assert.match(source, /function toggleProductTableSort\(key\)/);
    assert.match(source, /function toggleStockHistorySort\(view, key\)/);
    assert.match(source, /function toggleHistorySort\(view, key\)/);
    assert.match(source, /function toggleCustomerSort\(key\)/);
    assert.match(source, /function toggleStaffSalarySort\(key\)/);
    assert.match(source, /function toggleMgmtReportSort\(key\)/);
});

test('history sorting is read-only, uses displayed return differences, and preserves only visible selections', () => {
    const fields = new Map([
        ['returns-body', {}], ['returns-total-count', {}], ['returns-total-refund', {}], ['returns-total-collected', {}],
        ['returns-date-from', { value: '2026-01-01' }], ['returns-date-to', { value: '2026-01-01' }], ['returns-staff-search', { value: '' }]
    ]);
    const returns = Array.from({ length: 201 }, (_, index) => ({
        id: `RET-${index}`, date: '2026-01-01T12:00:00Z', cust: index % 2 ? 'Ánh' : 'Bình', staff: 'NV A',
        returnTotal: index, exchangeTotal: 0, difference: index, returnItems: [], exchangeItems: []
    }));
    const context = {
        db: { returns: plain(returns), invoices: [], activityLog: [], settings: {} }, selectedReturns: new Set(['RET-200', 'RET-0']),
        $: id => fields.get(id) || null, getAppDate: () => new Date('2026-01-01T12:00:00Z'),
        parseLocalDateInput: (value, end) => new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`),
        compareVietnameseText: (left, right) => String(left || '').localeCompare(String(right || ''), 'vi', { sensitivity: 'base' }),
        sameStoredId: (left, right) => String(left) === String(right), getReturnDisplayTotals: record => ({ returnTotal: record.returnTotal, exchangeTotal: record.exchangeTotal, difference: record.difference }),
        money: value => String(value), formatQty: value => String(value), getReturnItemTotal: () => 0,
        escapeHtml: value => String(value), escapeAttr: value => String(value), escapeJsArgument: value => JSON.stringify(value),
        updateBulkDeleteUI: () => {}, document: { querySelectorAll: () => [] }, saveNow: () => { context.saved = true; }
    };
    createTestContext(context);
    vm.runInContext(between('const historySortStates =', '\n// Toggle returns row expansion'), context);
    const before = plain(context.db);
    vm.runInContext("historySortStates.returns = { key: 'difference', direction: 'desc' };", context);
    assert.deepEqual(plain(context.getSortedHistoryEntries(context.db.returns, 'returns').slice(0, 3).map(record => record.id)), ['RET-200', 'RET-199', 'RET-198']);
    context.renderReturnsHistory(true);
    assert.deepEqual(plain([...context.selectedReturns]), ['RET-200']);
    assert.match(fields.get('returns-body').innerHTML, /RET-200[\s\S]*checked/);
    context.showMoreHistory('returns');
    assert.equal(vm.runInContext('historyDisplayLimits.returns', context), 400);
    assert.deepEqual(plain([...context.selectedReturns]), ['RET-200']);
    assert.deepEqual(plain(context.db), before);
    assert.equal(context.saved, undefined);
    assert.match(source.slice(source.indexOf('function exportStockHistoryExcel()'), source.indexOf('// ========== PDF EXPORT FUNCTIONS FOR LISTS')), /logActivity: false/);
    assert.doesNotMatch(source.slice(source.indexOf('function exportStockHistoryPDF()'), source.indexOf('// Export Staff Salary to PDF')), /logActivity\(/);
    context.selectedReturns.add('RET-200');
    context.renderReturnsHistory();
    assert.equal(context.selectedReturns.size, 0, 'normal filtering/rendering keeps the existing selection reset');
});

test('customer, staff, and management-report sort helpers keep source data and rankings intact', () => {
    const customerContext = {
        compareVietnameseText: (left, right) => String(left || '').localeCompare(String(right || ''), 'vi', { sensitivity: 'base' }),
        compareOptionalSortNumbers: (left, right, direction) => {
            const leftMissing = left === undefined || left === null || left === '' || !Number.isFinite(Number(left));
            const rightMissing = right === undefined || right === null || right === '' || !Number.isFinite(Number(right));
            if (leftMissing || rightMissing) return leftMissing === rightMissing ? 0 : (leftMissing ? 1 : -1);
            return direction === 'desc' ? Number(right) - Number(left) : Number(left) - Number(right);
        },
        compareRecordSortFallback: (left, right) => String(left.id).localeCompare(String(right.id)), document: { querySelectorAll: () => [] }
    };
    createTestContext(customerContext);
    vm.runInContext(between('// CUSTOMERS\nlet customerSortState', '\nfunction openCustModal('), customerContext);
    const customers = [{ id: '4', name: 'Z', group: 'vip', points: 1 }, { id: '3', name: 'A', group: 'normal', points: 10 }, { id: '2', name: 'B', group: 'gold', points: 5 }, { id: '1', name: 'C', group: 'diamond', points: 9 }];
    const customerBefore = plain(customers);
    vm.runInContext("customerSortState = { key: 'group', direction: 'asc' };", customerContext);
    assert.deepEqual(plain(customerContext.getSortedCustomers(customers).map(customer => customer.id)), ['3', '2', '4', '1']);
    vm.runInContext("customerSortState = { key: 'points', direction: 'desc' };", customerContext);
    assert.deepEqual(plain(customerContext.getSortedCustomers(customers).map(customer => customer.id)), ['3', '1', '2', '4']);
    assert.deepEqual(plain(customers), customerBefore);

    const staffContext = {
        compareOptionalSortText: (left, right, direction) => direction === 'desc' ? String(right).localeCompare(String(left)) : String(left).localeCompare(String(right)),
        compareOptionalSortNumbers: (left, right, direction) => direction === 'desc' ? Number(right) - Number(left) : Number(left) - Number(right),
        compareRecordSortFallback: (left, right) => String(left.id).localeCompare(String(right.id)), document: { querySelectorAll: () => [] }
    };
    createTestContext(staffContext);
    vm.runInContext(between('// STAFF VIEW - Salary Management\nlet staffSalarySortState', '\nfunction renderStaffView()'), staffContext);
    const salaryRows = [{ id: 'A', code: 'NV02', revenue: 50, total: 70 }, { id: 'B', code: 'NV01', revenue: 100, total: 30 }];
    const salaryBefore = plain(salaryRows);
    vm.runInContext("staffSalarySortState = { key: 'code', direction: 'asc' };", staffContext);
    assert.deepEqual(plain(staffContext.getSortedStaffSalaryRows(salaryRows).map(row => row.id)), ['B', 'A']);
    assert.deepEqual(plain(salaryRows), salaryBefore);

    const reportContext = {
        compareOptionalSortText: (left, right, direction) => direction === 'desc' ? String(right).localeCompare(String(left)) : String(left).localeCompare(String(right)),
        compareOptionalSortNumbers: (left, right, direction) => direction === 'desc' ? Number(right) - Number(left) : Number(left) - Number(right),
        compareRecordSortFallback: (left, right) => String(left.id).localeCompare(String(right.id)),
        getSortableDateValue: value => new Date(value).getTime(), getInvoiceCost: () => 0, analyzeInvoices: () => ({}), refreshReportModalContent: () => {}
    };
    createTestContext(reportContext);
    vm.runInContext(between('let mgmtReportData =', '\nfunction initMgmtDateFilter()'), reportContext);
    const orders = [{ id: 'INV-1', date: '2026-01-01', total: 50, items: [] }, { id: 'INV-2', date: '2026-01-02', total: 100, items: [] }];
    const reportBefore = plain(orders);
    vm.runInContext("mgmtReportSortState = { key: 'revenue', direction: 'desc' };", reportContext);
    assert.deepEqual(plain(reportContext.getSortedMgmtReportOrders(orders, { orderCosts: new Map(), productLookup: new Map() }).map(order => order.id)), ['INV-2', 'INV-1']);
    assert.deepEqual(plain(orders), reportBefore);
});

test('history search, show-more, and Excel export share the filtered sorted source without persistence', () => {
    const fields = new Map([
        ['hist-staff-search', { value: '' }], ['hist-date-from', { value: '2026-01-01' }], ['hist-date-to', { value: '2026-01-01' }],
        ['hist-total-rev', {}], ['hist-total-orders', {}], ['hist-avg-order', {}], ['hist-body', {}],
        ['returns-staff-search', { value: '' }], ['returns-date-from', { value: '2026-01-01' }], ['returns-date-to', { value: '2026-01-01' }],
        ['returns-total-count', {}], ['returns-total-refund', {}], ['returns-total-collected', {}], ['returns-body', {}]
    ]);
    const invoices = Array.from({ length: 401 }, (_, index) => ({
        id: `INV-${String(index).padStart(3, '0')}`, date: '2026-01-01T12:00:00Z', cust: 'Khách A', staff: 'Thu ngân',
        items: [{ name: index === 0 ? 'Cà phê đặc biệt' : 'Hàng thường', qty: 1, price: index }], total: index, discount: 0, method: 'CASH'
    }));
    invoices[0].id = 'FULL-ABC123';
    const returns = [{
        id: 55, invoiceId: 'FULL-ABC123', date: '2026-01-01T12:00:00Z', cust: 'Khách B', staff: 'Thu ngân',
        items: [{ name: 'Đường legacy', qty: 1, price: 10 }], exchangeItems: [{ name: 'Hàng đổi', qty: 1, price: 20 }], difference: 10
    }];
    const context = {
        db: { invoices: plain(invoices), returns: plain(returns), activityLog: [] }, selectedInvoices: new Set(), selectedReturns: new Set(),
        $: id => fields.get(id) || null, getAppDate: () => new Date('2026-01-01T12:00:00Z'),
        parseLocalDateInput: (value, end) => new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`),
        compareVietnameseText: (left, right) => String(left || '').localeCompare(String(right || ''), 'vi', { sensitivity: 'base' }),
        getReturnDisplayTotals: record => ({ returnTotal: record.difference || 0, exchangeTotal: 0, difference: record.difference || 0 }),
        getReturnItemTotal: item => item.price * item.qty, hasIncompleteInvoiceItems: () => false,
        money: value => String(value), formatQty: value => String(value), escapeHtml: value => String(value), escapeAttr: value => String(value), escapeJsArgument: value => JSON.stringify(value),
        updateBulkDeleteUI: () => {}, document: { querySelectorAll: () => [] }, exportToExcel: (data, headers, filename) => { context.exported = { data, headers, filename }; },
        saveNow: () => { context.saved = true; }
    };
    createTestContext(context);
    vm.runInContext(between('function getReturnItemTotal(', '\nfunction captureReturnArrayState('), context);
    vm.runInContext(between('const historySortStates =', '\n// Toggle returns row expansion'), context);
    vm.runInContext(between('function exportHistoryExcel()', '\nfunction exportProductsExcel('), context);
    const before = plain(context.db);

    fields.get('hist-staff-search').value = 'abc123';
    assert.deepEqual(plain(context.getFilteredSalesHistory().list.map(invoice => invoice.id)), ['FULL-ABC123']);
    fields.get('hist-staff-search').value = 'cà phê';
    assert.deepEqual(plain(context.getFilteredSalesHistory().list.map(invoice => invoice.id)), ['FULL-ABC123']);
    fields.get('hist-staff-search').value = 'ca phe';
    assert.deepEqual(plain(context.getFilteredSalesHistory().list.map(invoice => invoice.id)), ['FULL-ABC123']);
    for (const term of ['55', 'abc123', 'khách b', 'đường legacy', 'duong', 'hàng đổi']) {
        fields.get('returns-staff-search').value = term;
        assert.equal(context.getFilteredReturnsHistory().list.length, 1, `return search matches ${term}`);
    }

    fields.get('hist-staff-search').value = '';
    context.renderHist();
    assert.match(fields.get('hist-body').innerHTML, /Hiển thị 200\/401 đơn hàng/);
    context.selectedInvoices.add('FULL-ABC123');
    context.showMoreHistory('sales');
    assert.equal(vm.runInContext('historyDisplayLimits.sales', context), 400);
    assert.match(fields.get('hist-body').innerHTML, /Hiển thị 400\/401 đơn hàng/);
    assert.deepEqual(plain([...context.selectedInvoices]), ['FULL-ABC123']);
    context.renderHist();
    assert.equal(vm.runInContext('historyDisplayLimits.sales', context), 200);
    assert.equal(context.selectedInvoices.size, 0);

    vm.runInContext("historySortStates.sales = { key: 'total', direction: 'desc' };", context);
    context.exportHistoryExcel();
    assert.equal(context.exported.data.length, 401, 'export is not limited by the rendered page');
    assert.equal(context.exported.data[0][0], '#NV-400', 'export uses the active table order');
    assert.deepEqual(plain(context.db), before);
    assert.equal(context.saved, undefined);
});

test('history all preset uses the earliest valid record and legacy return rows share their item source', () => {
    const fields = new Map([
        ['hist-staff-search', { value: '' }], ['hist-date-from', { value: '' }], ['hist-date-to', { value: '' }], ['hist-date-filter-label', {}], ['hist-date-filter-menu', { classList: { remove() {} } }],
        ['returns-staff-search', { value: '' }], ['returns-date-from', { value: '' }], ['returns-date-to', { value: '' }], ['returns-date-filter-label', {}], ['returns-date-filter-menu', { classList: { remove() {} } }],
        ['returns-body', {}], ['returns-total-count', {}], ['returns-total-refund', {}], ['returns-total-collected', {}],
        ['mgmt-date-from', { value: '' }], ['mgmt-date-to', { value: '' }], ['mgmt-date-filter-label', {}], ['mgmt-date-filter-menu', { classList: { remove() {} } }],
        ['stock-date-from', { value: '' }], ['stock-date-to', { value: '' }], ['stock-date-filter-label', {}], ['stock-date-filter-menu', { classList: { remove() {} } }]
    ]);
    const legacyReturn = { id: 'RET-LEGACY', date: '1965-02-03T12:00:00Z', cust: 'Khách cũ', staff: 'Admin', items: [{ name: 'Hàng cũ', qty: 2, price: 10 }], exchangeItems: [], difference: 20 };
    const context = {
        db: {
            invoices: [{ id: 'INV-LEGACY', date: '1965-02-03T12:00:00Z', items: [] }, { id: 'INV-BAD-DATE', date: 'không hợp lệ', items: [] }],
            returns: [legacyReturn, { id: 'RET-BAD-DATE', date: 'không hợp lệ', items: [], exchangeItems: [] }],
            activityLog: []
        },
        selectedReturns: new Set(),
        $: id => fields.get(id) || null,
        getAppDate: () => new Date('2026-01-01T12:00:00Z'),
        parseLocalDateInput: (value, end) => new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`),
        toLocalDateStr: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        compareVietnameseText: (left, right) => String(left || '').localeCompare(String(right || ''), 'vi'),
        getReturnItemTotal: item => item.price * item.qty,
        money: value => String(value), formatQty: value => String(value), escapeHtml: value => String(value), escapeAttr: value => String(value), escapeJsArgument: value => JSON.stringify(value),
        calendarState: { stock: { currentMonth: new Date('2026-01-01T00:00:00Z'), startDate: new Date('2026-01-02T00:00:00Z'), endDate: new Date('2026-01-03T00:00:00Z'), selectingEnd: true } },
        updateBulkDeleteUI: () => {}, updateMgmtReport: () => {}, refreshReportModalContent: () => {}, renderStockHistory: () => { context.stockRendered = (context.stockRendered || 0) + 1; },
        document: { querySelectorAll: () => [] }, saveNow: () => { context.saved = true; }
    };
    createTestContext(context);
    vm.runInContext(between('function getReturnItemTotal(', '\nfunction captureReturnArrayState('), context);
    vm.runInContext(between('const historySortStates =', '\n// Toggle returns row expansion'), context);
    vm.runInContext(between('function setDatePreset(', '\n// Apply Custom Date Filter'), context);
    const before = plain(context.db);

    context.setDatePreset('hist', 'all');
    assert.equal(fields.get('hist-date-from').value, '1965-02-03');
    assert.deepEqual(plain(context.getFilteredSalesHistory().list.map(record => record.id)), ['INV-LEGACY']);

    context.setDatePreset('returns', 'all');
    assert.equal(fields.get('returns-date-from').value, '1965-02-03');
    assert.deepEqual(plain(context.getFilteredReturnsHistory().list.map(record => record.id)), ['RET-LEGACY']);
    assert.equal(context.getHistorySortValue(legacyReturn, 'returns', 'returnCount'), 1);
    context.renderReturnsHistory();
    assert.match(fields.get('returns-body').innerHTML, /1 mặt hàng trả/);
    assert.match(fields.get('returns-body').innerHTML, /Hàng cũ/);

    context.setDatePreset('mgmt', 'all');
    assert.equal(fields.get('mgmt-date-from').value, '2020-01-01');
    context.setDatePreset('stock', 'all');
    assert.equal(fields.get('stock-date-from').value, '');
    assert.equal(fields.get('stock-date-to').value, '');
    assert.equal(fields.get('stock-date-filter-label').textContent, '📅 Tất cả');
    assert.deepEqual(plain(context.calendarState.stock), { currentMonth: '2026-01-01T00:00:00.000Z', startDate: null, endDate: null, selectingEnd: false });
    assert.equal(context.stockRendered, 1);
    assert.deepEqual(plain(context.db), before);
    assert.equal(context.saved, undefined);
});

test('custom calendar ranges redraw only the matching history or stock view', () => {
    const fields = new Map([
        ['returns-date-filter-label', {}], ['returns-date-filter-menu', { classList: { remove() {} } }],
        ['stock-date-filter-label', {}], ['stock-date-filter-menu', { classList: { remove() {} } }]
    ]);
    const context = {
        calendarState: {
            returns: { startDate: new Date('2026-02-01T00:00:00Z'), endDate: new Date('2026-02-03T00:00:00Z') },
            stock: { startDate: new Date('2026-03-01T00:00:00Z'), endDate: new Date('2026-03-03T00:00:00Z') }
        },
        db: { invoices: [], returns: [], stockHistory: [], activityLog: [] },
        $: id => fields.get(id) || null,
        document: { querySelectorAll: () => [] },
        renderReturnsHistory: () => { context.returnsRendered = (context.returnsRendered || 0) + 1; },
        renderStockHistory: () => { context.stockRendered = (context.stockRendered || 0) + 1; },
        updateMgmtReport: () => { context.managementRendered = true; },
        renderHist: () => { context.salesRendered = true; },
        refreshReportModalContent: () => { context.reportModalRendered = true; },
        toast: () => { context.toasted = true; }, saveNow: () => { context.saved = true; }
    };
    createTestContext(context);
    vm.runInContext(between('function applyCalendarRange(', '\n// Management view'), context);
    const before = plain(context.db);

    context.applyCalendarRange('returns');
    context.applyCalendarRange('stock');

    assert.equal(context.returnsRendered, 1);
    assert.equal(context.stockRendered, 1);
    assert.match(fields.get('returns-date-filter-label').textContent, /^📅 /);
    assert.match(fields.get('stock-date-filter-label').textContent, /^📅 /);
    assert.equal(context.salesRendered, undefined);
    assert.equal(context.managementRendered, undefined);
    assert.equal(context.reportModalRendered, undefined);
    assert.equal(context.toasted, undefined);
    assert.equal(context.saved, undefined);
    assert.deepEqual(plain(context.db), before);
});

test('history PDFs include active search context and return detail preserves source metadata', () => {
    const fields = new Map([
        ['hist-staff-search', { value: 'Khách' }], ['hist-date-from', { value: '2026-01-01' }], ['hist-date-to', { value: '2026-01-01' }], ['hist-date-filter-label', { textContent: '📅 Hôm nay' }],
        ['returns-staff-search', { value: 'Khách' }], ['returns-date-from', { value: '2026-01-01' }], ['returns-date-to', { value: '2026-01-01' }], ['returns-date-filter-label', { textContent: '📅 Hôm nay' }],
        ['generic-modal-title', {}], ['generic-modal-content', {}]
    ]);
    const context = {
        db: {
            settings: { name: 'Cửa hàng' },
            invoices: [
                { id: 'INV-1', date: '2026-01-01T08:00:00Z', cust: 'Khách A', staff: 'Admin', items: [], total: 10, discount: 0, method: 'CASH' },
                { id: 'INV-2', date: '2026-01-01T09:00:00Z', cust: 'Khách B', staff: 'Admin', items: [], total: 20, discount: 0, method: 'CK' }
            ],
            returns: [
                { id: 'RET-1', invoiceId: 'INV-1', date: '2026-01-01T08:00:00Z', cust: 'Khách A', staff: 'Admin', reason: 'defect', note: 'Lỗi vỏ', returnItems: [{ name: 'A', qty: 1, price: 10 }], exchangeItems: [], difference: 10 },
                { id: 'RET-2', invoiceId: 'QUICK_RETURN', date: '2026-01-01T09:00:00Z', cust: 'Khách B', staff: 'Admin', reason: 'quick_return', note: '', returnItems: [], exchangeItems: [], difference: 0 },
                { id: 'RET-3', date: '2026-01-01T10:00:00Z', cust: 'Khách C', staff: 'Admin', items: [{ name: 'Legacy', qty: 1, price: 5 }], exchangeItems: [], reason: 'legacy_reason', note: 'Ghi chú cũ', difference: 5 }
            ]
        },
        $: id => fields.get(id) || null, getAppDate: () => new Date('2026-01-01T12:00:00Z'),
        parseLocalDateInput: (value, end) => new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`),
        compareVietnameseText: (left, right) => String(left || '').localeCompare(String(right || ''), 'vi', { sensitivity: 'base' }),
        getReturnItemTotal: item => item.price * item.qty, money: value => String(value), formatQty: value => String(value), escapeHtml: value => String(value), escapeJsArgument: value => JSON.stringify(value),
        openA4PrintWindow: (title, content) => { context.printed = { title, content }; }, logActivity: () => {}, openModal: () => {},
        closeModal: id => { context.closedModal = id; }, viewInvoice: id => { context.openedInvoice = id; }, toast: (message, type) => { context.toastMessage = { message, type }; }, document: { querySelectorAll: () => [] }
    };
    createTestContext(context);
    vm.runInContext(between('function getReturnItemTotal(', '\nfunction captureReturnArrayState('), context);
    vm.runInContext(between('const historySortStates =', '\n// Toggle returns row expansion'), context);
    vm.runInContext(between('function viewReturnSourceInvoice(', 'function buildReturnSlipHtml('), context);
    vm.runInContext(between('function exportHistoryPDF()', '\nfunction exportReturnsHistoryPDF('), context);
    vm.runInContext(between('function exportReturnsHistoryPDF()', '\n// Export Stock History to PDF'), context);

    vm.runInContext("historySortStates.sales = { key: 'total', direction: 'desc' };", context);
    context.exportHistoryPDF();
    assert.match(context.printed.content, /Tổng kết quả: 2 - Từ khóa tra cứu: Khách/);
    assert.ok(context.printed.content.indexOf('#INV-2') < context.printed.content.indexOf('#INV-1'));
    vm.runInContext("historySortStates.returns = { key: 'difference', direction: 'desc' };", context);
    context.exportReturnsHistoryPDF();
    assert.match(context.printed.content, /Tổng kết quả: 3 - Từ khóa tra cứu: Khách/);
    assert.ok(context.printed.content.indexOf('#RET-1') < context.printed.content.indexOf('#RET-3'));
    assert.ok(context.printed.content.indexOf('#RET-3') < context.printed.content.indexOf('#RET-2'));

    context.viewReturnDetail('RET-1');
    assert.match(fields.get('generic-modal-content').innerHTML, /Hóa đơn gốc:<\/strong> #INV-1/);
    assert.match(fields.get('generic-modal-content').innerHTML, /Xem HĐ gốc/);
    assert.match(fields.get('generic-modal-content').innerHTML, /Lỗi sản phẩm/);
    assert.match(fields.get('generic-modal-content').innerHTML, /Lỗi vỏ/);
    context.viewReturnDetail('RET-2');
    assert.match(fields.get('generic-modal-content').innerHTML, /Trả nhanh – không có hóa đơn gốc/);
    assert.doesNotMatch(fields.get('generic-modal-content').innerHTML, /Xem HĐ gốc/);
    context.viewReturnDetail('RET-3');
    assert.match(fields.get('generic-modal-content').innerHTML, /Không có thông tin hóa đơn gốc/);
    assert.doesNotMatch(fields.get('generic-modal-content').innerHTML, /Xem HĐ gốc/);
    assert.match(fields.get('generic-modal-content').innerHTML, /legacy_reason/);
    assert.match(fields.get('generic-modal-content').innerHTML, /Legacy/);

    const invoice = context.db.invoices[0];
    context.db.invoices = [];
    const beforeStaleOpen = plain(context.db);
    assert.equal(context.viewReturnSourceInvoice('INV-1'), false);
    assert.deepEqual(plain(context.db), beforeStaleOpen);
    assert.equal(context.closedModal, undefined);
    assert.equal(context.openedInvoice, undefined);
    assert.deepEqual(plain(context.toastMessage), { message: 'Hóa đơn gốc không còn tồn tại.', type: 'error' });
    context.db.invoices = [invoice];
    assert.equal(context.viewReturnSourceInvoice('INV-1'), true);
    assert.equal(context.closedModal, 'generic-modal');
    assert.equal(context.openedInvoice, 'INV-1');
    context.db.invoices = [{ id: 101 }];
    assert.equal(context.viewReturnSourceInvoice('101'), true);
    assert.equal(context.openedInvoice, 101);
});

test('management stock history shows more without persistence and exports the active filtered sorted source', () => {
    const fields = new Map([
        ['stock-filter', { value: 'in' }], ['stock-search', { value: '' }],
        ['stock-date-from', { value: '', dataset: {} }], ['stock-date-to', { value: '', dataset: {} }],
        ['mgmt-stock-history-body', { innerHTML: '' }], ['mgmt-stock-history-count', { textContent: '' }],
        ['mgmt-stock-history-more', { style: {} }], ['mgmt-stock-history-pagination', { style: {} }],
        ['mgmt-tab-inventory', { classList: { contains: () => true } }]
    ]);
    const stockHistory = Array.from({ length: 101 }, (_, index) => ({
        id: index + 1, date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T08:00:00Z`, type: 'in',
        productId: index + 1, productName: `SP ${String(index).padStart(3, '0')}`, qty: index + 1, price: 10, total: (index + 1) * 10, note: '', user: 'Admin'
    }));
    const context = {
        db: { products: [], stockHistory: plain(stockHistory), settings: { name: 'Cửa hàng' } }, currUser: { role: 'admin' }, isAuthenticated: true,
        selectedStockEntries: new Set([1]), $: id => fields.get(id) || null, isViewActive: () => true,
        document: { querySelectorAll: () => [] }, escapeAttr: value => String(value), escapeJsArgument: value => JSON.stringify(value), escapeHtml: value => String(value),
        formatQty: value => String(value), money: value => String(value), printStockSlip: () => {}, deleteStockEntry: () => {}, updateBulkDeleteUI: () => {},
        exportToExcel: (data, headers, filename) => { context.exported = { data, headers, filename }; }, openA4PrintWindow: (title, content) => { context.printed = { title, content }; },
        parseLocalDateInput: (value, endOfDay) => {
            const [year, month, day] = String(value || '').split('-').map(Number);
            return year && month && day ? new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0) : null;
        },
        getAppDate: () => new Date('2026-01-31T12:00:00Z'), logActivity: () => {}, toast: () => {}, saveNow: () => { context.saved = true; }
    };
    createTestContext(context);
    vm.runInContext(between('const stockHistorySortStates =', '\n// Delete stock history entry with option to revert stock'), context);
    vm.runInContext(between('function exportStockHistoryExcel()', '\n// ========== PDF EXPORT FUNCTIONS FOR LISTS'), context);
    vm.runInContext(between('function exportStockHistoryPDF()', '\n// Export Staff Salary to PDF'), context);
    const before = plain(context.db);

    context.renderStockHistory();
    assert.match(fields.get('mgmt-stock-history-count').textContent, /50\/101/);
    assert.equal(fields.get('mgmt-stock-history-more').style.display, '');
    context.showMoreManagementStockHistory();
    assert.match(fields.get('mgmt-stock-history-count').textContent, /100\/101/);
    assert.deepEqual(plain([...context.selectedStockEntries]), [1]);

    fields.get('stock-search').value = 'SP 0';
    vm.runInContext("stockHistorySortStates.management = { key: 'product', direction: 'asc' };", context);
    context.exportStockHistoryExcel();
    assert.equal(context.exported.data.length, 100);
    assert.equal(context.exported.data[0][2], 'SP 000');
    context.exportStockHistoryPDF();
    assert.match(context.printed.content, /Từ khóa: SP 0/);
    assert.ok(context.printed.content.indexOf('SP 000') < context.printed.content.indexOf('SP 099'));
    assert.deepEqual(plain(context.db), before);
    assert.equal(context.saved, undefined);
});

test('management reconciliation is legacy-safe, deduplicates full-return snapshots, and stays read-only', () => {
    const context = {
        db: { invoices: [], returns: [] }, money: value => String(value),
        getReturnDisplayTotals: record => ({ difference: record.difference }), saveNow: () => { context.saved = true; }
    };
    createTestContext(context);
    vm.runInContext(between('function isManagementReportDateInRange(', '\nfunction getMgmtReportOrderCost('), context);
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-01-31T23:59:59.999Z');
    const orders = [
        { id: 'LIVE-1', date: '2026-01-05T08:00:00Z', total: 100, custId: 8 },
        { id: 'LIVE-2', date: '2026-01-06T08:00:00Z', total: 60, custId: '8' },
        { id: 'GUEST-NUMBER', date: '2026-01-07T08:00:00Z', total: 20, custId: 1 },
        { id: 'GUEST-STRING', date: '2026-01-08T08:00:00Z', total: 20, custId: '1' }
    ];
    const returns = [
        { id: 'RET-1', date: '2026-01-10T08:00:00Z', difference: 20 },
        { id: 'RET-2', date: '2026-01-11T08:00:00Z', difference: -30 },
        { id: 'QUICK', invoiceId: 'QUICK_RETURN', date: '2026-01-12T08:00:00Z', difference: 10 },
        { id: 'FULL', date: '2026-01-13T08:00:00Z', difference: 70, deletedInvoice: { id: 'FULL-1', date: '2026-01-09T08:00:00Z', total: 70 } },
        { id: 'DUP', date: '2026-01-14T08:00:00Z', difference: 0, deletedInvoice: { id: 'LIVE-1', date: '2026-01-05T08:00:00Z', total: 999 } },
        { id: 'LEGACY', date: '2026-01-15T08:00:00Z', difference: 0, deletedInvoice: { id: 'BROKEN' } },
        { id: 'BAD-DATE', date: 'not-a-date', difference: 5 }
    ];
    const beforeOrders = plain(orders);
    const beforeReturns = plain(returns);
    const reconciliation = context.getManagementReportReconciliation(orders, returns, from, to);

    assert.equal(reconciliation.grossSales, 270);
    assert.equal(reconciliation.refunds, 100);
    assert.equal(reconciliation.collections, 30);
    assert.equal(reconciliation.netCash, 200);
    assert.equal(reconciliation.snapshotCount, 1);
    assert.equal(reconciliation.snapshotSales, 70);
    assert.equal(reconciliation.excludedSnapshots, 1);
    assert.equal(reconciliation.excludedReturns, 1);
    assert.equal(context.getManagementUniqueCustomerCount(orders), 1);
    assert.deepEqual(plain(orders), beforeOrders);
    assert.deepEqual(plain(returns), beforeReturns);
    assert.equal(context.saved, undefined);
});

test('management report PDF prints every order and repeats headers without changing export order', () => {
    const reportPdf = source.slice(source.indexOf('function exportMgmtReportPDF()'), source.indexOf('// Open in-app report viewer modal with table format'));

    assert.doesNotMatch(reportPdf, /orders\.slice\(0,\s*50\)/);
    assert.match(reportPdf, /<tbody>\$\{orders\.map/);
    assert.match(reportPdf, /thead \{ display: table-header-group; \}/);
    assert.match(reportPdf, /tr \{ break-inside: avoid; page-break-inside: avoid; \}/);
    assert.match(reportPdf, /Dòng tiền thuần theo phát sinh/);
});

test('products UI density remains scoped and preserves existing controls', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
    const productsTab = html.slice(html.indexOf('<div id="products-tab-products"'), html.indexOf('<!-- Tab Content: Inventory -->'));
    const inventoryTab = html.slice(html.indexOf('<div id="products-tab-inventory"'), html.indexOf('<!-- Tab Content: Suppliers -->'));
    const suppliersTab = html.slice(html.indexOf('<div id="products-tab-suppliers"'), html.indexOf('</div><!-- End Suppliers Tab -->'));
    const productModal = html.slice(html.indexOf('<div class="modal-overlay" id="prod-modal">'), html.indexOf('<!-- Customer Modal -->'));
    const labelModal = html.slice(html.indexOf('<div class="modal-overlay" id="label-print-modal">'), html.indexOf('<!-- Change Password Modal -->'));

    assert.match(productsTab, /class="product-list-header"/);
    assert.match(productsTab, /class="product-list-topline"/);
    assert.match(productsTab, /class="[^"]*\bproduct-list-actions\b[^"]*"/);
    assert.match(productsTab, /id="prod-search"[\s\S]*?oninput="onProductTableFiltersChanged\(true\)"/);
    assert.match(productsTab, /<table class="product-table">/);
    assert.doesNotMatch(productsTab, /<table class="stock-history-table">/);
    assert.match(productsTab, /toggleProductTableSort\('status'\)/);
    assert.match(productsTab, /class="btn btn-sm btn-primary" onclick="openProdModal\(\)"/);

    assert.match(inventoryTab, /class="d-flex gap-1 management-inventory-actions"/);
    assert.match(inventoryTab, /class="btn mgmt-action-primary" onclick="openPurchaseOrderModal\(\)"/);
    assert.match(inventoryTab, /class="btn mgmt-action-soft mgmt-action-in" onclick="openStockInModal\(\)"/);
    assert.match(inventoryTab, /class="btn mgmt-action-soft mgmt-action-out" onclick="openStockOutModal\(\)"/);
    assert.match(inventoryTab, /class="btn mgmt-action-soft mgmt-action-check" onclick="openInventoryCheckModal\(\)"/);
    assert.match(inventoryTab, /class="btn mgmt-action-history" onclick="openPOHistoryModal\(\)"/);

    assert.match(suppliersTab, /<table class="supplier-table">/);
    assert.match(suppliersTab, /toggleSupplierSort\('name'\)/);
    assert.match(suppliersTab, /toggleSupplierSort\('debt'\)/);
    assert.match(css, /\.product-table \{\s*min-width: 1110px;\s*table-layout: fixed;/);
    assert.match(css, /\.product-table th:nth-child\(10\), \.product-table td:nth-child\(10\) \{ width: 180px; padding-inline: 8px; text-align: center; white-space: nowrap; \}/);
    assert.match(css, /#products-tab-suppliers \.supplier-table \{\s*min-width: 980px;\s*table-layout: fixed;/);
    assert.match(css, /#products-tab-suppliers \.supplier-table td:nth-child\(4\),[\s\S]*?text-overflow: ellipsis;/);

    assert.match(productModal, /class="product-wholesale-panel"/);
    assert.doesNotMatch(productModal, /linear-gradient|dashed/);
    assert.match(labelModal, /class="label-format-options"/);
    assert.match(labelModal, /class="label-printer-block"/);
    assert.match(labelModal, /<div id="label-printer-status" class="label-printer-status">[\s\S]*?<div class="label-printer-support">/);
    assert.match(labelModal, /id="label-printer-indicator"/);
    assert.match(labelModal, /id="label-printer-name"/);
    assert.match(labelModal, /id="label-printer-detail"/);
    assert.match(css, /@media \(max-width: 480px\) \{\s*\.label-format-options \{ grid-template-columns: 1fr; \}/);
});

test('history UI presentation is scoped and preserves history mechanics', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
    const historyHtml = html.slice(html.indexOf('<div id="history-view"'), html.indexOf('<!-- 3. PRODUCTS'));
    const historyRenderers = source.slice(source.indexOf('function renderHist('), source.indexOf('// View return detail modal'));
    const historyExcel = rawBetween('function exportHistoryExcel()', '\nfunction exportProductsExcel(');
    const returnsExcel = rawBetween('function exportReturnsHistoryExcel()', '\nfunction exportStockHistoryExcel(');
    const returnDetail = source.slice(source.indexOf('function viewReturnDetail('), source.indexOf('function buildReturnSlipHtml('));
    const invoiceDetail = source.slice(source.indexOf('function viewInvoice('), source.indexOf('function printCurrentInvoice('));
    const editInvoice = source.slice(source.indexOf('function openEditInvoice('), source.indexOf('function renderEditInvoiceItems('));

    assert.match(historyHtml, /class="[^\"]*\bhistory-toolbar\b[^\"]*" data-history-tools="sales"/);
    assert.match(historyHtml, /class="history-search" oninput="debouncedHistSearch\(\)"/);
    assert.match(historyHtml, /<table class="history-table history-sales-table">/);
    assert.match(historyHtml, /<table class="history-table history-returns-table">/);
    assert.match(historyHtml, /data-history-sort-key="items"[\s\S]*?Sắp xếp số mặt hàng cao-thấp\/thấp-cao[\s\S]*?>Mặt hàng/);
    assert.match(historyHtml, /data-history-sort-key="returnCount"[\s\S]*?Sắp xếp số mặt hàng trả cao-thấp\/thấp-cao[\s\S]*?>Mặt hàng trả/);
    assert.match(historyHtml, /data-history-sort-key="exchangeCount"[\s\S]*?Sắp xếp số mặt hàng đổi cao-thấp\/thấp-cao[\s\S]*?>Mặt hàng đổi/);
    assert.match(html, /class="modal-footer invoice-detail-footer"/);
    assert.match(historyRenderers, /history-expandable-row/);
    assert.match(historyRenderers, /history-detail-row/);
    assert.match(historyRenderers, /history-more-row/);
    assert.match(historyRenderers, /showMoreHistory\('sales'\)/);
    assert.match(historyRenderers, /showMoreHistory\('returns'\)/);
    assert.doesNotMatch(historyRenderers, /saveNow\(/);
    assert.match(returnDetail, /class="return-detail-content"/);
    assert.match(returnDetail, /class="return-detail-meta"/);
    assert.match(returnDetail, /viewReturnSourceInvoice\(/);
    assert.doesNotMatch(returnDetail, /<h3/);
    assert.match(invoiceDetail, /class="invoice-detail-code"/);
    assert.match(editInvoice, /class="modal edit-invoice-modal"/);
    assert.match(editInvoice, /class="modal-header edit-invoice-header"/);
    assert.doesNotMatch(editInvoice, /linear-gradient\(135deg, var\(--primary\)/);
    assert.match(historyHtml, /data-history-sort-view="sales" data-history-sort-key="date" aria-sort="descending"><button[^>]+title="Sắp xếp ngày mới\/cũ">Ngày/);
    assert.match(historyHtml, /data-history-sort-view="returns" data-history-sort-key="date" aria-sort="descending"><button[^>]+title="Sắp xếp ngày mới\/cũ">Ngày/);
    assert.match(historyRenderers, /getStockHistoryDisplayDate\(i\.date\)/);
    assert.match(historyRenderers, /getStockHistoryDisplayDate\(r\.date\)/);
    assert.match(historyRenderers, /const diffText = money\(Math\.abs\(difference\)\)/);
    assert.doesNotMatch(historyRenderers, /Hoàn khách:|Thu thêm:|Ngang giá/);
    assert.match(historyExcel, /toLocaleString\('vi-VN'\)/);
    assert.match(returnsExcel, /toLocaleString\('vi-VN'\)/);
    assert.match(css, /#history-view \.history-sales-table \{ min-width: 1196px; \}/);
    assert.match(css, /#history-view \.history-sales-table th:nth-child\(2\),\s*#history-view \.history-sales-table > tbody > \.hist-row > td:nth-child\(2\) \{ width: 140px; \}/);
    assert.match(css, /#history-view \.history-sales-table th:nth-child\(3\) \{ width: 104px; \}/);
    assert.match(css, /#history-view \.history-sales-table th:nth-child\(4\) \{ width: 140px; \}/);
    assert.match(historyRenderers, /saleType === 'wholesale'/);
    assert.match(historyRenderers, /history-row-toggle/);
    assert.match(css, /#history-view \.history-returns-table th:nth-child\(5\), #history-view \.history-returns-table th:nth-child\(6\) \{ width: 132px; \}/);
    assert.match(css, /#history-view \.history-table > tbody > \.hist-row > td,/);
    assert.match(css, /#history-view \.history-sales-table > tbody > \.hist-row > td:nth-child\(4\),/);
    assert.match(css, /#history-view \.history-returns-table th:nth-child\(9\),\s*#history-view \.history-returns-table td:nth-child\(9\) \{ width: 192px; padding-inline: 8px; \}/);
    assert.match(css, /#generic-modal \.return-detail-content/);
    assert.match(css, /#edit-invoice-modal \.edit-invoice-header/);
    assert.match(css, /@media \(max-width: 640px\) \{\s*#history-view \.history-page-header/);
});

test('table action columns retain their controls inside scrollable table wrappers at every UI size', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
    const productsTab = html.slice(html.indexOf('<div id="products-tab-products"'), html.indexOf('<!-- Tab Content: Inventory -->'));
    const productRenderer = rawBetween('function renderProdTable()', '\nfunction openProdModal(');
    const historyRenderer = rawBetween('function renderHist(', '\n// View return detail modal');
    const stockRenderer = rawBetween('function renderStockHistoryRows(', '\nfunction renderStockHistory()');

    assert.match(css, /\.product-table th:nth-child\(10\), \.product-table td:nth-child\(10\) \{ width: 180px; padding-inline: 8px;/);
    assert.match(css, /#history-view \.history-sales-table th:nth-child\(10\),\s*#history-view \.history-sales-table td:nth-child\(10\) \{ width: 192px; padding-inline: 8px;/);
    assert.match(css, /#history-view \.history-returns-table th:nth-child\(9\),\s*#history-view \.history-returns-table td:nth-child\(9\) \{ width: 192px; padding-inline: 8px;/);
    assert.match(css, /\.stock-history-actions \{ width: 116px; padding-inline: 8px;/);
    assert.match(css, /\[data-ui-size="large"\] \.product-table th:nth-child\(10\),[\s\S]*?width: 204px;/);
    assert.match(css, /\[data-ui-size="large"\] #history-view \.history-sales-table th:nth-child\(10\),[\s\S]*?width: 216px;/);
    assert.match(css, /\[data-ui-size="large"\] \.stock-history-actions \{ width: 128px; \}/);
    assert.match(css, /\.table-wrap \{\s*overflow-x: auto;/);
    assert.doesNotMatch(css, /\.table-wrap\s*\{[^}]*overflow:\s*visible/);
    assert.match(productsTab, /<th>Thao tác<\/th>/);
    assert.doesNotMatch(productsTab, /<th[^>]*style=[^>]*>Thao tác<\/th>/);
    assert.match(productRenderer, /openLabelPrintModal\(/);
    assert.match(productRenderer, /editP\(/);
    assert.match(productRenderer, /delP\(/);
    assert.match(historyRenderer, /viewInvoice\(/);
    assert.match(stockRenderer, /stock-history-actions/);
});

test('customer UI remains presentation-only and keeps customer state read-only', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
    const customersHtml = html.slice(html.indexOf('<div id="customers-view"'), html.indexOf('<!-- 7. STAFF VIEW'));
    const customerModal = html.slice(html.indexOf('<div class="modal-overlay" id="cust-modal">'), html.indexOf('<!-- User Modal -->'));
    const debtModal = html.slice(html.indexOf('<div class="modal-overlay" id="debt-modal">'), html.indexOf('<!-- Import Data Modal -->'));
    const renderer = source.slice(source.indexOf('let customerSortState ='), source.indexOf('function openCustModal('));
    const importOpener = source.slice(source.indexOf('function openImportModal('), source.indexOf('function handleImportFile('));
    const debtOpener = source.slice(source.indexOf('function openDebtModal('), source.indexOf('async function saveDebt('));

    assert.match(customersHtml, /class="[^\"]*\bcustomer-page-header\b[^\"]*"/);
    assert.match(customersHtml, /class="customer-search"/);
    assert.match(customersHtml, /<table class="customer-table">/);
    assert.match(customerModal, /class="modal customer-form-modal"/);
    assert.match(customerModal, /class="modal-footer customer-form-footer"/);
    assert.match(debtModal, /class="debt-current-summary"/);
    assert.match(debtModal, /class="modal-footer debt-modal-footer"/);
    assert.match(html, /class="modal-header import-modal-header"/);
    assert.match(html, /class="d-flex gap-2 import-preview-options"/);
    assert.match(renderer, /customer-empty-row/);
    assert.match(renderer, /customer-type-badge/);
    assert.match(renderer, /customer-points-badge/);
    assert.doesNotMatch(renderer, /saveNow\(/);
    assert.match(importOpener, /classList\.remove\('import-customers'\)/);
    assert.match(importOpener, /classList\.toggle\('import-customers', type === 'customers'\)/);
    assert.match(debtOpener, /classList\.toggle\('is-outstanding', Number\(c\.debt\) > 0\)/);
    const customerTableCss = css.slice(css.indexOf('#customers-view .customer-table {'), css.indexOf('#customers-view .customer-type-badge {'));
    assert.match(customerTableCss, /#customers-view \.customer-table \{ min-width: 1284px; table-layout: fixed; \}/);
    assert.match(customerTableCss, /th:nth-child\(1\), #customers-view \.customer-table td:nth-child\(1\) \{ width: 176px; text-align: left; \}/);
    assert.match(customerTableCss, /th:nth-child\(2\), #customers-view \.customer-table td:nth-child\(2\) \{ width: 100px; text-align: center; \}/);
    assert.match(customerTableCss, /th:nth-child\(3\), #customers-view \.customer-table td:nth-child\(3\) \{ width: 124px; text-align: center; \}/);
    assert.match(customerTableCss, /th:nth-child\(5\), #customers-view \.customer-table td:nth-child\(5\) \{ width: 128px; text-align: center; \}/);
    assert.match(customerTableCss, /th:nth-child\(6\), #customers-view \.customer-table td:nth-child\(6\), #customers-view \.customer-table th:nth-child\(7\), #customers-view \.customer-table td:nth-child\(7\) \{ width: 160px; text-align: right; white-space: nowrap; \}/);
    assert.match(customerTableCss, /th:nth-child\(8\), #customers-view \.customer-table td:nth-child\(8\) \{ width: 276px; padding-inline: 8px; text-align: center; \}/);
    assert.match(customerTableCss, /\[data-ui-size="large"\] #customers-view \.customer-table \{ min-width: 1308px; \}/);
    assert.match(customerTableCss, /\[data-ui-size="large"\] #customers-view \.customer-table th:nth-child\(8\), \[data-ui-size="large"\] #customers-view \.customer-table td:nth-child\(8\) \{ width: 300px; \}/);
    assert.doesNotMatch(customerTableCss, /nth-child\(4\)[^{]*\{[^}]*width:/);
    assert.equal([176, 100, 124, 128, 160, 160, 276].reduce((sum, width) => sum + width, 0) + 160, 1284);
    assert.equal([176, 100, 124, 128, 160, 160, 300].reduce((sum, width) => sum + width, 0) + 160, 1308);
    assert.match(css, /#import-modal\.import-customers \.import-preview-options/);
    assert.match(css, /#debt-modal #debt-current\.is-outstanding/);

    const fields = new Map([
        ['cust-search', { value: '' }], ['cust-total', { innerText: '' }], ['cust-vip', { innerText: '' }], ['cust-total-debt', { innerText: '' }], ['cust-body-manage', { innerHTML: '' }],
        ['import-modal', { classList: { remove: name => { fields.get('import-modal').removed = name; }, toggle: (name, active) => { fields.get('import-modal').toggled = { name, active }; }, add: name => { fields.get('import-modal').added = name; } } }],
        ['import-type', { value: '' }], ['import-file', { value: '' }], ['import-preview-section', { style: {} }], ['import-confirm-btn', { disabled: false }],
        ['debt-modal', { classList: { add: name => { fields.get('debt-modal').added = name; } } }], ['debt-cust-id', { value: '' }],
        ['debt-current', { innerText: '', classList: { toggle: (name, active) => { fields.get('debt-current').toggled = { name, active }; } } }], ['debt-amount', { value: '' }], ['debt-note', { value: '' }]
    ]);
    const context = {
        db: { custs: [{ id: 1, name: 'Khách lẻ', phone: '', debt: 0, totalBuy: 0 }, { id: 2, name: 'Khách VIP', phone: '0901', group: 'vip', debt: 20, totalBuy: 50, points: 10, customerType: 'wholesale' }], invoices: [], returns: [], activityLog: [] },
        $: id => fields.get(id) || null, isViewActive: () => true, document: { querySelectorAll: () => [] },
        compareVietnameseText: (left, right) => String(left || '').localeCompare(String(right || ''), 'vi', { sensitivity: 'base' }),
        compareOptionalSortText: () => 0, compareOptionalSortNumbers: () => 0, compareRecordSortFallback: () => 0,
        escapeHtml: value => String(value), escapeJsArgument: value => JSON.stringify(value), money: value => String(value),
        setStatMoney: (element, value) => { if (element) element.innerText = String(value); }, saveNow: () => { context.saved = true; }
    };
    createTestContext(context);
    vm.runInContext(renderer, context);
    vm.runInContext(importOpener, context);
    vm.runInContext(debtOpener, context);
    const before = plain(context.db);

    context.renderCustTable();
    assert.match(fields.get('cust-body-manage').innerHTML, /customer-type-badge/);
    fields.get('cust-search').value = 'không có';
    context.renderCustTable();
    assert.match(fields.get('cust-body-manage').innerHTML, /Không tìm thấy khách hàng phù hợp/);
    assert.equal(fields.get('cust-total').innerText, '2');
    context.openDebtModal(2);
    assert.deepEqual(fields.get('debt-current').toggled, { name: 'is-outstanding', active: true });
    context.openImportModal('customers');
    assert.deepEqual(fields.get('import-modal').toggled, { name: 'import-customers', active: true });
    context.openImportModal('products');
    assert.deepEqual(fields.get('import-modal').toggled, { name: 'import-customers', active: false });
    assert.deepEqual(plain(context.db), before);
    assert.equal(context.saved, undefined);
});

test('staff UI remains scoped, responsive, and read-only', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
    const staffHtml = html.slice(html.indexOf('<div id="staff-view"'), html.indexOf('<!-- 8. REPORTS & DASHBOARD -->'));
    const userModal = html.slice(html.indexOf('<div class="modal-overlay" id="user-modal">'), html.indexOf('<!-- User Detail View Modal -->'));
    const detailModal = html.slice(html.indexOf('<div class="modal-overlay" id="user-detail-modal">'), html.indexOf('<!-- Stock In Modal -->'));
    const staffRender = source.slice(source.indexOf('function renderStaffView()'), source.indexOf('function drawStaffChart('));
    const chartRender = source.slice(source.indexOf('function drawStaffChart('), source.indexOf('function exportStaffSalaryExcel('));
    const canvasHelper = rawBetween('function prepareHiDpiCanvas(', '\nfunction drawRevenueChart(');
    const chartMoneyHelper = source.slice(source.indexOf('const CHART_MONEY_UNITS ='), source.indexOf('// Money formatting with rounding'));
    const userRender = source.slice(source.indexOf('function getCurrentUserRecord()'), source.indexOf('function openUserModal('));

    assert.match(staffHtml, /class="d-flex justify-between items-center mb-2 staff-page-header"/);
    assert.match(staffHtml, /id="staff-search"[\s\S]*?class="staff-search" oninput="debouncedStaffSearch\(\)"/);
    assert.match(staffHtml, /id="staff-period" class="staff-period" onchange="renderStaffView\(\)"/);
    assert.match(staffHtml, /class="btn btn-sm staff-add-button" onclick="openUserModal\(\)"/);
    assert.match(staffHtml, /id="staff-chart-empty" class="staff-chart-empty" role="status" hidden/);
    assert.match(staffHtml, /<table class="staff-salary-table">/);
    assert.match(staffHtml, /data-staff-sort-key="total" aria-sort="none"/);
    assert.match(userModal, /class="modal staff-user-modal"/);
    assert.match(userModal, /<label class="label">Tên đăng nhập \*<\/label>/);
    assert.match(userModal, /id="salary-section" class="staff-form-section staff-salary-section"/);
    assert.match(detailModal, /class="modal staff-user-detail-modal"/);
    assert.match(detailModal, /class="modal-footer staff-user-detail-footer"/);
    assert.match(css, /#staff-view \.staff-salary-table \{\s*min-width: 1160px;\s*table-layout: fixed;/);
    assert.match(css, /@media \(max-width: 820px\) \{\s*#staff-view \.staff-overview \{ grid-template-columns: 1fr; \}/);
    assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto auto auto;/);
    assert.match(css, /@media \(max-width: 480px\) \{[\s\S]*?#staff-view \.staff-period,[\s\S]*?#staff-view \.staff-add-button \{ grid-column: 1 \/ -1; \}/);
    assert.doesNotMatch(staffRender, /saveNow\(/);
    assert.doesNotMatch(userRender, /saveNow\(/);

    const classes = () => {
        const active = new Set();
        return { add: value => active.add(value), contains: value => active.has(value) };
    };
    const fields = new Map([
        ['staff-period', { value: 'month' }], ['staff-search', { value: '' }], ['staff-total-salary', {}], ['staff-count', {}], ['staff-total-revenue', {}], ['staff-total-orders', {}], ['staff-salary-body', { innerHTML: '' }],
        ['staff-chart-empty', { hidden: true }], ['user-cards-container', { innerHTML: '' }], ['user-detail-body', { innerHTML: '' }], ['user-detail-modal', { dataset: {}, classList: classes() }]
    ]);
    const db = { users: [], invoices: [], activityLog: [] };
    const context = {
        db, currUser: { id: 1, role: 'admin', name: 'Admin' }, isAuthenticated: true,
        $: id => fields.get(id) || null, isViewActive: () => true,
        getStaffPeriodRange: () => ({ startDate: new Date('2026-01-01'), endDate: new Date('2026-01-31') }), getStaffViewUsers: () => [],
        getSortedStaffSalaryRows: rows => rows.slice(), updateStaffSalarySortUI: () => {}, drawStaffChart: () => {}, renderUsers: () => {},
        money: value => String(value), setStatMoney: (element, value) => { if (element) element.innerText = String(value); }, staffSalarySortState: { key: null, direction: null }, saveNow: () => { context.saved = true; },
        sameStoredId: (left, right) => String(left) === String(right), calculateStaffSalary: () => ({ revenue: 0, orders: 0, total: 0 }),
        safeImageSrc: () => '', escapeHtml: value => String(value), escapeAttr: value => String(value), escapeJsArgument: value => JSON.stringify(value),
        document: { body: {} }
    };
    createTestContext(context);
    vm.runInContext(staffRender, context);
    const before = plain(context.db);
    context.renderStaffView();
    assert.match(fields.get('staff-salary-body').innerHTML, /staff-salary-empty/);
    assert.deepEqual(plain(context.db), before);
    assert.equal(context.saved, undefined);

    const drawCalls = [];
    const canvasContext = { clearRect: () => drawCalls.push('clear'), beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {}, fillText: () => {}, roundRect: () => {}, fill: () => {}, setTransform: () => {}, measureText: text => ({ width: String(text).length * 7 }) };
    fields.set('staff-chart', { width: 0, height: 0, style: {}, parentElement: { getBoundingClientRect: () => ({ width: 360, height: 180 }) }, getContext: () => canvasContext });
    context.getComputedStyle = () => ({ getPropertyValue: () => '#6366F1' });
    vm.runInContext(canvasHelper, context);
    vm.runInContext(chartMoneyHelper, context);
    vm.runInContext(chartRender, context);
    context.drawStaffChart([]);
    assert.equal(fields.get('staff-chart-empty').hidden, false);
    assert.equal(drawCalls.includes('clear'), true);
    context.drawStaffChart([{ name: 'Nhân viên dài', revenue: 100 }]);
    assert.equal(fields.get('staff-chart-empty').hidden, true);

    const userContext = {
        db: { users: [], invoices: [], activityLog: [] }, currUser: { id: 1, role: 'admin' }, isAuthenticated: true,
        $: id => fields.get(id) || null, sameStoredId: (left, right) => String(left) === String(right), canEditUser: () => true,
        safeImageSrc: () => '', escapeHtml: value => String(value), escapeAttr: value => String(value), escapeJsArgument: value => JSON.stringify(value),
        calculateStaffSalary: () => ({ revenue: 0, orders: 0, total: 0 }), money: value => String(value), saveNow: () => { userContext.saved = true; }
    };
    createTestContext(userContext);
    vm.runInContext(userRender, userContext);
    const userBefore = plain(userContext.db);
    userContext.renderUsers();
    assert.match(fields.get('user-cards-container').innerHTML, /Chưa có nhân viên để hiển thị/);
    assert.deepEqual(plain(userContext.db), userBefore);
    assert.equal(userContext.saved, undefined);
});

test('purchase-order renderers coerce stored numeric values before placing them in HTML', () => {
    const fields = new Map([
        ['po-items-body', { innerHTML: '' }], ['po-item-count', {}], ['po-total-qty', {}], ['po-total-amount', {}]
    ]);
    const context = {
        $: id => fields.get(id) || null, escapeHtml: value => String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        escapeAttr: value => String(value).replace(/"/g, '&quot;'), escapeJsArgument: value => JSON.stringify(value),
        money: value => String(value), formatQty: value => String(value)
    };
    createTestContext(context);
    vm.runInContext('let currentPOItems = [{ productId: 1, productName: "An toàn", productCode: "PO-1", qty: "<img src=x onerror=1>", price: "NaN", sellPrice: "Infinity", total: "<svg onload=1>" }];', context);
    vm.runInContext(between('function renderPOItems()', '\nfunction openQuickEditProduct'), context);
    context.renderPOItems();
    assert.doesNotMatch(fields.get('po-items-body').innerHTML, /<img|<svg|onerror|onload/);
    assert.match(fields.get('po-items-body').innerHTML, /value="0"/);
    assert.equal(fields.get('po-total-qty').innerText, '0');
    assert.equal(fields.get('po-total-amount').innerText, '0');
});

test('single stock-history and purchase-order deletion snapshot before any mutation', () => {
    const run = kind => {
        const context = {
            db: kind === 'stock' ? {
                products: [{ id: 1, stock: 5 }], stockHistory: [{ id: 'H-1', type: 'in', productId: 1, productName: 'A', qty: 2 }], purchaseOrders: [], activityLog: []
            } : {
                products: [{ id: 1, stock: 5 }], stockHistory: [{ id: 'H-1', purchaseOrderId: 'PO-1' }], purchaseOrders: [{ id: 'PO-1', code: 'PN-1', totalAmount: 200, items: [{ productId: 1, qty: 2 }] }], activityLog: []
            },
            undoStack: [], confirm: () => true, toast: () => {}, money: value => String(value),
            isLinkedStockHistoryEntry: () => false, isStockHistoryForPurchaseOrder: entry => entry.purchaseOrderId === 'PO-1',
            toFiniteNumber: value => Number.isFinite(Number(value)) ? Number(value) : 0,
            pushUndo: (_type, data) => context.undoStack.push(data), logActivity: (action, detail) => context.db.activityLog.unshift({ action, detail }),
            renderInventory: () => { throw new Error('must not render success UI'); }, renderManagement: () => { throw new Error('must not render success UI'); }, renderPOHistory: () => { throw new Error('must not render success UI'); },
            UNDO_ACTIONS: { DELETE_STOCK_ENTRY: 'DELETE_STOCK_ENTRY', DELETE_PURCHASE_ORDER: 'DELETE_PURCHASE_ORDER' }
        };
        let snapshot;
        context.beginInventoryCommit = () => {
            snapshot = { db: plain(context.db), undo: plain(context.undoStack) };
            return snapshot;
        };
        context.saveInventoryCommit = () => {
            context.db = JSON.parse(JSON.stringify(snapshot.db));
            context.undoStack.splice(0, context.undoStack.length, ...snapshot.undo);
            return false;
        };
        createTestContext(context);
        const before = plain(context.db);
        vm.runInContext(kind === 'stock'
            ? between('function deleteStockEntry(', '\n// BULK DELETE - INVOICES')
            : between('function deletePurchaseOrder(', '\nfunction viewPurchaseOrder('), context);
        kind === 'stock' ? context.deleteStockEntry('H-1') : context.deletePurchaseOrder('PO-1');
        assert.deepEqual(snapshot.db, before, `${kind} captures state before mutation`);
        assert.deepEqual(plain(context.db), before, `${kind} restores state after failed persistence`);
        assert.deepEqual(plain(context.undoStack), [], `${kind} restores Undo after failed persistence`);
    };
    run('stock');
    run('po');
});

test('inventory check rejects negative actual stock before confirmation or persistence', () => {
    const context = makeInventoryMutationContext();
    let confirmCalls = 0;
    context.confirm = () => { confirmCalls++; return true; };
    vm.runInContext(between('let inventoryCheckData = {};', '\nfunction exportInventoryCheckExcel'), context);
    vm.runInContext("inventoryCheckData = { '1': { systemStock: 5, actualStock: -1, diff: -6 } };", context);
    const beforeDb = plain(context.db);
    const beforeUndo = plain(context.undoStack);
    context.saveInventoryCheck();
    assert.equal(confirmCalls, 0);
    assert.equal(context.saveCalls, 0);
    assert.deepEqual(plain(context.db), beforeDb);
    assert.deepEqual(plain(context.undoStack), beforeUndo);
});

test('inventory stock validation rejects blank values without silently changing stock', () => {
    const context = makeInventoryMutationContext();
    const input = { value: '' };
    context.$ = id => id === 'ic-actual-1' ? input : context.elements.get(id) || null;
    vm.runInContext('let inventoryCheckData = { "1": { systemStock: 5, actualStock: 7, diff: 2 } };', context);
    vm.runInContext(between('function updateInventoryDiff(', '\nfunction resetInventoryCheck'), context);
    const beforeCheck = plain(vm.runInContext('inventoryCheckData', context));
    context.updateInventoryDiff(1);
    assert.deepEqual(plain(vm.runInContext('inventoryCheckData', context)), beforeCheck);
    assert.equal(String(input.value), '7');
    assert.match(context.toasts.at(-1).message, /Tồn thực tế phải là số không âm/);

    const saveContext = makeInventoryMutationContext();
    let confirmCalls = 0;
    saveContext.confirm = () => { confirmCalls++; return true; };
    vm.runInContext(between('let inventoryCheckData = {};', '\nfunction exportInventoryCheckExcel'), saveContext);
    vm.runInContext('inventoryCheckData = { "1": { systemStock: 5, actualStock: 7, diff: 2 }, "2": { systemStock: 4, actualStock: " ", diff: 0 } };', saveContext);
    const beforeDb = plain(saveContext.db);
    const beforeUndo = plain(saveContext.undoStack);
    saveContext.saveInventoryCheck();
    assert.equal(confirmCalls, 0);
    assert.equal(saveContext.saveCalls, 0);
    assert.deepEqual(plain(saveContext.db), beforeDb);
    assert.deepEqual(plain(saveContext.undoStack), beforeUndo);

    const quickEdit = makeInventoryMutationContext();
    quickEdit.elements.get('qe-stock').value = '';
    vm.runInContext('let currentPOItems = [];', quickEdit);
    vm.runInContext(between('function openQuickEditProduct(', '\nasync function savePurchaseOrder'), quickEdit);
    const beforeQuickEdit = plain(quickEdit.db);
    quickEdit.saveQuickEditProduct();
    assert.equal(quickEdit.saveCalls, 0);
    assert.deepEqual(plain(quickEdit.db), beforeQuickEdit);
    assert.match(quickEdit.toasts.at(-1).message, /Tồn kho phải là số không âm/);

    assert.equal(context.parseNonNegativeStock(0), 0);
    assert.equal(context.parseNonNegativeStock('0.5'), 0.5);
    for (const value of ['', ' ', -1, 'NaN', Infinity, null, undefined, false]) assert.equal(context.parseNonNegativeStock(value), null);
});

test('legacy purchase orders without items remain view-only and undo safely', () => {
    const legacyPO = { id: 'PO-LEGACY', code: 'PN-LEGACY', date: '2026-01-01T00:00:00.000Z' };
    const editContext = makeInventoryMutationContext();
    editContext.db.purchaseOrders = [legacyPO];
    vm.runInContext(between('let editingPOId = null;', '\n// Override savePurchaseOrder'), editContext);
    const beforeEdit = plain(editContext.db);
    editContext.editPurchaseOrder('PO-LEGACY');
    assert.deepEqual(plain(editContext.db), beforeEdit);
    assert.deepEqual(editContext.closed, []);
    assert.match(editContext.toasts.at(-1).message, /chỉ có thể xem hoặc in/);

    const directSave = makeInventoryMutationContext();
    directSave.db.purchaseOrders = [legacyPO];
    loadInventoryMutationFlow(directSave, 'po');
    vm.runInContext("editingPOId = 'PO-LEGACY';", directSave);
    const beforeDirectSave = plain(directSave.db);
    directSave.savePurchaseOrder();
    assert.equal(directSave.saveCalls, 0);
    assert.deepEqual(plain(directSave.db), beforeDirectSave);
    assert.match(directSave.toasts.at(-1).message, /chỉ có thể xem hoặc in/);

    const makeUndoContext = saveResult => {
        const context = {
            undoStack: [{ type: 'DELETE_PURCHASE_ORDER', data: { po: legacyPO, stockReverted: true } }],
            UNDO_ACTIONS: { DELETE_PURCHASE_ORDER: 'DELETE_PURCHASE_ORDER' },
            db: { purchaseOrders: [], products: [{ id: 1, stock: 5 }], stockHistory: [], activityLog: [] },
            renderPOHistory: () => {}, renderInventory: () => {}, renderManagement: () => {},
            renderPos: () => {}, renderHist: () => {}, renderCustTable: () => {}, renderSuppliers: () => {}, renderReturnsHistory: () => {},
            saveNow: () => saveResult, showToast: () => {}, toast: () => {}
        };
        createTestContext(context);
        vm.runInContext(between('function performUndo()', '\nfunction showLoading('), context);
        return context;
    };

    const undoSuccess = makeUndoContext(true);
    assert.doesNotThrow(() => undoSuccess.performUndo());
    assert.deepEqual(plain(undoSuccess.db.purchaseOrders), [legacyPO]);
    assert.deepEqual(plain(undoSuccess.db.stockHistory), []);
    assert.equal(undoSuccess.undoStack.length, 0);

    const undoFailure = makeUndoContext(false);
    const beforeUndoFailureDb = plain(undoFailure.db);
    const beforeUndoFailureStack = plain(undoFailure.undoStack);
    undoFailure.performUndo();
    assert.deepEqual(plain(undoFailure.db), beforeUndoFailureDb);
    assert.deepEqual(plain(undoFailure.undoStack), beforeUndoFailureStack);
});

test('product import skips missing and duplicate identities without starting a commit when none are valid', () => {
    const fields = new Map([
        ['import-type', { value: 'products' }], ['import-skip-existing', { checked: true }], ['import-update-existing', { checked: false }]
    ]);
    const context = {
        db: { products: [{ id: 1, code: 'EX', name: 'Gốc', price: 1, cost: 1, stock: 1 }], categories: ['Khác'], custs: [], activityLog: [] },
        undoStack: [], importedData: [], importColumnMap: { Mã: 'code', Tên: 'name', Giá: 'price' },
        $: id => fields.get(id) || null, canMutateManagement: () => true, parseImportedNumber: value => Number(value) || 0,
        showLoading: () => { context.loading = true; }, hideLoading: () => { context.loading = false; }, toast: (message, type) => context.toasts.push({ message, type }), toasts: [],
        logActivity: (action, detail) => context.db.activityLog.push({ action, detail }), renderProdTable: () => {}, renderCategories: () => {}, renderPos: () => {}, renderCustTable: () => {}, updateCustList: () => {}, closeModal: () => {}
    };
    let commitCalls = 0;
    context.beginInventoryCommit = () => { commitCalls++; return {}; };
    context.saveInventoryCommit = () => true;
    createTestContext(context);
    vm.runInContext(between('function confirmImport()', '\n// CATEGORIES'), context);

    vm.runInContext("importedData = [{ Mã: '', Tên: 'Thiếu mã' }, { Mã: 'N-1', Tên: 'Gốc' }];", context);
    const before = plain(context.db);
    context.confirmImport();
    assert.equal(commitCalls, 0);
    assert.deepEqual(plain(context.db), before);

    fields.get('import-update-existing').checked = true;
    vm.runInContext("importedData = [{ Mã: 'EX', Tên: 'Tên mới' }, { Mã: 'N-1', Tên: 'Gốc' }, { Mã: 'N-1', Tên: 'Một' }, { Mã: 'N-2', Tên: 'một' }, { Mã: 'N-3', Tên: 'Tên mới' }];", context);
    context.confirmImport();
    assert.equal(commitCalls, 1);
    assert.deepEqual(context.db.products.map(product => [product.code, product.name]), [['EX', 'Tên mới'], ['N-1', 'Một']]);
    assert.match(context.toasts.at(-1).message, /Thêm: 1, Cập nhật: 1, Bỏ qua: 3/);

    vm.runInContext("importedData = [{ Mã: 'EX', Tên: '', Giá: '99' }];", context);
    context.confirmImport();
    assert.equal(commitCalls, 2);
    assert.equal(context.db.products[0].name, 'Tên mới');
    assert.equal(context.db.products[0].price, 99);
});

test('staff salary is numeric, read-only, and keeps checkout staff labels compatible', () => {
    const context = {
        db: {
            users: [
                { id: 'S-1', code: 'NV0001', name: 'An', role: 'staff', baseSalary: '100', commission: '10' },
                { id: 'S-2', name: 'Legacy', role: 'staff', baseSalary: 'bad', commission: '<img src=x onerror=1>' }
            ],
            invoices: [
                { staff: 'NV0001_An', date: '2026-09-10T12:00:00.000Z', total: '100' },
                { staff: 'NV0001_An', date: '2026-09-11T12:00:00.000Z', total: '200' }
            ]
        }
    };
    createTestContext(context);
    vm.runInContext(source.slice(source.indexOf('function getStaffDisplayName'), source.indexOf('function renderUsers()')), context);

    const before = plain(context.db);
    const salary = context.calculateStaffSalary('S-1', new Date('2026-09-01'), new Date('2026-09-30'));
    assert.deepEqual(plain(salary), { base: 100, commission: 30, commissionRate: 10, revenue: 300, orders: 2, total: 130 });
    assert.equal(context.getStaffDisplayName(context.db.users[0]), 'NV0001_An');
    assert.equal(context.getStaffDisplayName(context.db.users[1]), 'NV0000_Legacy');
    assert.equal(context.invoiceBelongsToStaff({ staff: 'NV0000_Legacy' }, context.db.users[1]), true);
    assert.deepEqual(plain(context.db), before);

    let userLookups = 0;
    const originalFind = context.db.users.find.bind(context.db.users);
    context.db.users.find = (...args) => { userLookups++; return originalFind(...args); };
    context.calculateStaffSalary('S-1', new Date('2026-09-01'), new Date('2026-09-30'), context.db.users[0]);
    assert.equal(userLookups, 0);
    assert.match(source, /calculateStaffSalary\(u\.id, startDate, endDate, u\)/);
    assert.match(source, /staff:\s*getStaffDisplayName\(currUser\)/);
});

test('staff handlers reject direct unauthorized access and detail rendering escapes restored commission data', () => {
    const makeContext = ({ actor, authenticated = true }) => {
        const elements = new Map([
            ['user-detail-body', { innerHTML: '' }],
            ['user-detail-modal', { dataset: {}, classList: { add: () => { elements.get('user-detail-modal').opened = true; } } }],
            ['staff-period', { value: 'month' }], ['staff-search', { value: '' }]
        ]);
        const context = {
            db: {
                users: [
                    { id: 1, code: 'NV0001', user: 'admin', name: 'Admin', role: 'admin' },
                    { id: 2, code: 'NV0002', user: 'staff', name: 'Staff', role: 'staff', commission: '<img src=x onerror=globalThis.pwned=1>' }
                ],
                invoices: [], settings: {}, activityLog: []
            },
            currUser: actor, isAuthenticated: authenticated, $: id => elements.get(id) || null,
            getAppDate: () => new Date('2026-09-20T12:00:00.000Z'),
            toast: (message, type) => context.toasts.push({ message, type }), toasts: [],
            escapeHtml: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
            escapeAttr: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
            safeImageSrc: () => '', money: value => String(value),
            exportToExcel: () => { context.excelCalls++; }, excelCalls: 0,
            openA4PrintWindow: () => { context.pdfCalls++; }, pdfCalls: 0,
            logActivity: () => { context.db.activityLog.push({ action: 'Xuất PDF' }); }
        };
        createTestContext(context);
        vm.runInContext(source.slice(source.indexOf('function getStaffDisplayName'), source.indexOf('function renderUsers()')), context);
        vm.runInContext(between('function viewUserDetail(', '\nfunction openUserModal('), context);
        vm.runInContext(between('function exportStaffSalaryExcel(', '\n// AUTH'), context);
        vm.runInContext(between('function exportStaffSalaryPDF(', '\n// Print Stock Slip'), context);
        return { context, elements };
    };

    const guest = makeContext({ actor: null, authenticated: false });
    const guestBefore = plain(guest.context.db);
    guest.context.viewUserDetail(2);
    guest.context.exportStaffSalaryExcel();
    guest.context.exportStaffSalaryPDF();
    assert.equal(guest.elements.get('user-detail-modal').opened, undefined);
    assert.equal(guest.context.excelCalls, 0);
    assert.equal(guest.context.pdfCalls, 0);
    assert.deepEqual(plain(guest.context.db), guestBefore);

    const staff = makeContext({ actor: { id: 2, role: 'staff', name: 'Staff' } });
    staff.context.viewUserDetail(2);
    assert.doesNotMatch(staff.elements.get('user-detail-body').innerHTML, /<img|onerror/);
    staff.context.exportStaffSalaryExcel();
    staff.context.exportStaffSalaryPDF();
    assert.equal(staff.context.excelCalls, 0);
    assert.equal(staff.context.pdfCalls, 0);

    const admin = makeContext({ actor: { id: 1, role: 'admin', name: 'Admin' } });
    admin.context.exportStaffSalaryExcel();
    admin.context.exportStaffSalaryPDF();
    assert.equal(admin.context.excelCalls, 1);
    assert.equal(admin.context.pdfCalls, 1);
    assert.equal(admin.context.db.activityLog.length, 1);
});

test('staff commission validation happens before a user commit', () => {
    const admin = { id: 1, user: 'admin', pass: 'admin-pass', name: 'Admin', role: 'admin' };
    const makeFields = commission => ({
        'u-id': '', 'u-code': 'NV-NEW', 'u-user': 'new-staff', 'u-pass': 'new-pass', 'u-name': 'New staff',
        'u-role': 'staff', 'u-basesalary': '1000000', 'u-commission': commission
    });

    for (const invalid of ['-1', '100.1', 'NaN', 'Infinity']) {
        const context = makeUserContext({ users: [admin], actor: admin, fields: makeFields(invalid) });
        let commitCalls = 0;
        context.beginInventoryCommit = () => { commitCalls++; return {}; };
        const before = plain(context.db.users);
        context.saveUser();
        assert.equal(commitCalls, 0, invalid);
        assert.deepEqual(plain(context.db.users), before, invalid);
    }

    for (const valid of ['0', '0.5', '100']) {
        const context = makeUserContext({ users: [admin], actor: admin, fields: makeFields(valid) });
        context.saveUser();
        assert.equal(context.db.users.at(-1).commission, Number(valid));
    }

    const rollback = makeUserContext({
        users: [{ ...admin, baseSalary: 100, commission: 1 }], actor: admin,
        fields: { ...makeFields('5'), 'u-id': '1', 'u-user': 'admin', 'u-pass': '', 'u-name': 'Admin', 'u-role': 'admin' }
    });
    rollback.db.activityLog = [];
    rollback.undoStack = [];
    rollback.logActivity = () => rollback.db.activityLog.push({ action: 'Quản lý nhân viên' });
    let closed = false;
    let rendered = false;
    rollback.closeModal = () => { closed = true; };
    rollback.renderUsers = () => { rendered = true; };
    rollback.beginInventoryCommit = () => ({ users: plain(rollback.db.users), currUser: plain(rollback.currUser), activityLog: plain(rollback.db.activityLog), undo: plain(rollback.undoStack) });
    rollback.saveInventoryCommit = snapshot => {
        rollback.db.users = snapshot.users;
        rollback.currUser = snapshot.currUser;
        rollback.db.activityLog = snapshot.activityLog;
        rollback.undoStack = snapshot.undo;
        return false;
    };
    const beforeRollback = { db: plain(rollback.db), currUser: plain(rollback.currUser), undo: plain(rollback.undoStack) };
    rollback.saveUser();
    assert.deepEqual(plain(rollback.db), beforeRollback.db);
    assert.deepEqual(plain(rollback.currUser), beforeRollback.currUser);
    assert.deepEqual(plain(rollback.undoStack), beforeRollback.undo);
    assert.equal(closed, false);
    assert.equal(rendered, false);
});

test('shared canvas surface is HiDPI-safe without changing chart data or persistence', () => {
    const helperSource = rawBetween('function prepareHiDpiCanvas(', '\nfunction drawRevenueChart(');
    const context = { devicePixelRatio: 1, db: { settings: {}, invoices: [] } };
    vm.createContext(context);
    vm.runInContext(helperSource, context);

    const transforms = [];
    const makeCanvas = () => {
        const ctx = { setTransform: (...args) => transforms.push(args) };
        return { width: 17, height: 19, style: {}, getContext: () => ctx };
    };

    const before = plain(context.db);
    const dprOneCanvas = makeCanvas();
    const dprOne = context.prepareHiDpiCanvas(dprOneCanvas, 320, 180);
    assert.equal(dprOne.width, 320);
    assert.equal(dprOne.height, 180);
    assert.equal(dprOne.dpr, 1);
    assert.equal(dprOneCanvas.style.width, '320px');
    assert.equal(dprOneCanvas.style.height, '180px');
    assert.equal(dprOneCanvas.width, 320);
    assert.equal(dprOneCanvas.height, 180);
    assert.deepEqual(transforms.at(-1), [1, 0, 0, 1, 0, 0]);

    context.devicePixelRatio = 2;
    const dprTwoCanvas = makeCanvas();
    const dprTwo = context.prepareHiDpiCanvas(dprTwoCanvas, 320, 180);
    assert.equal(dprTwo.dpr, 2);
    assert.equal(dprTwoCanvas.width, 640);
    assert.equal(dprTwoCanvas.height, 360);
    assert.deepEqual(transforms.at(-1), [2, 0, 0, 2, 0, 0]);

    context.devicePixelRatio = 3;
    const cappedCanvas = makeCanvas();
    const capped = context.prepareHiDpiCanvas(cappedCanvas, 200, 100);
    assert.equal(capped.dpr, 2);
    assert.equal(cappedCanvas.width, 400);
    assert.equal(cappedCanvas.height, 200);

    const invalidCanvas = makeCanvas();
    const invalidBefore = { width: invalidCanvas.width, height: invalidCanvas.height, style: { ...invalidCanvas.style }, transformCount: transforms.length };
    assert.equal(context.prepareHiDpiCanvas(invalidCanvas, 0, 100), null);
    assert.equal(context.prepareHiDpiCanvas(invalidCanvas, Infinity, 100), null);
    assert.deepEqual({ width: invalidCanvas.width, height: invalidCanvas.height, style: invalidCanvas.style, transformCount: transforms.length }, invalidBefore);
    assert.deepEqual(plain(context.db), before);
    assert.equal(context.saved, undefined);

    const chartSpecs = [
        ['function drawStaffChart(', '\nfunction exportStaffSalaryExcel('],
        ['function drawMgmtChart(', '\nfunction drawMgmtPieChart('],
        ['function drawMgmtPieChart(', '\nfunction renderMgmtTopProducts('],
        ['function drawRevenueChart(', '\nfunction drawPieChart('],
        ['function drawPieChart(', '\n// SETTINGS']
    ];
    for (const [start, end] of chartSpecs) {
        const chartSource = rawBetween(start, end);
        assert.match(chartSource, /prepareHiDpiCanvas\(/, start);
        assert.doesNotMatch(chartSource, /canvas\.(?:width|height)\s*=/, start);
    }

    const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
    const mgmtChartStart = css.indexOf('#mgmt-chart {');
    const mgmtChartCss = css.slice(mgmtChartStart, css.indexOf('}', mgmtChartStart) + 1);
    assert.match(mgmtChartCss, /display: block;/);
    assert.match(mgmtChartCss, /max-width: 100%;/);
    assert.doesNotMatch(mgmtChartCss, /width:\s*100%\s*!important/);
});

test('large-number display keeps Vietnamese labels and draws negative report bars from zero', () => {
    const chartMoneyHelper = source.slice(source.indexOf('const CHART_MONEY_UNITS ='), source.indexOf('// Money formatting with rounding'));
    const context = {
        toFiniteNumber: value => Number.isFinite(Number(value)) ? Number(value) : 0,
        money: value => `${Math.round(Number(value) || 0).toLocaleString('vi-VN')} ₫`
    };
    vm.createContext(context);
    vm.runInContext(chartMoneyHelper, context);

    assert.equal(context.formatChartMoney(0), '0 ₫');
    assert.equal(context.formatChartMoney(500000), '500 nghìn');
    assert.equal(context.formatChartMoney(1500285000), '1,5 tỷ');
    assert.equal(context.formatChartMoney(-48499515000), '-48,5 tỷ');
    assert.equal(context.formatChartMoney(999999), '1 triệu');
    assert.equal(context.formatChartMoney('not-a-number'), '0 ₫');

    const labels = [0, 12500000000, 25000000000].map(context.createChartMoneyFormatter([0, 12500000000, 25000000000]).format);
    assert.equal(new Set(labels).size, labels.length);

    const mgmtChart = rawBetween('function drawMgmtChart(', '\nfunction drawMgmtPieChart(');
    const staffChart = rawBetween('function drawStaffChart(', '\nfunction exportStaffSalaryExcel(');
    const revenueChart = rawBetween('function drawRevenueChart(', '\nfunction drawPieChart(');
    const pieChart = rawBetween('function drawMgmtPieChart(', '\nfunction renderMgmtTopProducts(');
    const topProducts = rawBetween('function renderMgmtTopProducts(', '\n// Toggle product list');
    const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');

    assert.match(mgmtChart, /const minVal = Math\.min\(0, \.\.\.allValues\);/);
    assert.match(mgmtChart, /const maxVal = Math\.max\(0, \.\.\.allValues\);/);
    assert.match(mgmtChart, /const zeroY = valueToY\(0\);/);
    assert.match(mgmtChart, /Math\.min\(valueY, zeroY\).*Math\.abs\(zeroY - valueY\)/s);
    assert.match(mgmtChart, /createChartMoneyFormatter\(tickValues\)/);
    assert.match(staffChart, /createChartMoneyFormatter\(tickValues\)/);
    assert.match(revenueChart, /createChartMoneyFormatter\(tickValues\)/);
    assert.match(pieChart, /formatChartMoney\(cat\[1\]\)/);
    assert.match(topProducts, /SL: \$\{formatQty\(p\.qty\)\} · LN: \$\{money\(p\.profit\)\}/);
    assert.doesNotMatch(topProducts, /moneyShort|\+ 'M'|\+ 'K'/);
    assert.match(css, /\.stat-card\.stat-card-money-wide \{[\s\S]*?flex: 1 1 var\(--stat-money-min-width\) !important;/);
    assert.match(css, /#customers-view \.customer-table th:nth-child\(8\), #customers-view \.customer-table td:nth-child\(8\) \{ width: 276px; padding-inline: 8px; text-align: center; \}/);
    assert.match(css, /\[data-ui-size="large"\] #customers-view \.customer-table th:nth-child\(8\), \[data-ui-size="large"\] #customers-view \.customer-table td:nth-child\(8\) \{ width: 300px; \}/);

    const order = { date: '2026-09-25T10:00:00', total: 1499985000 };
    const fillRects = [];
    const canvasContext = {
        clearRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {}, arc: () => {}, fill: () => {},
        fillRect: (...args) => fillRects.push(args), fillText: () => {}, measureText: text => ({ width: String(text).length * 7 })
    };
    const canvas = {
        parentElement: { offsetWidth: 1200, offsetHeight: 500, clientWidth: 1200, clientHeight: 500 },
        offsetWidth: 1176, getBoundingClientRect: () => ({ left: 0, top: 0 }), addEventListener: () => {}
    };
    const geometryContext = {
        ...context,
        $: id => id === 'mgmt-chart' ? canvas : id === 'chart-tooltip' ? { style: {}, innerHTML: '' } : null,
        prepareHiDpiCanvas: () => ({ ctx: canvasContext, width: 1176, height: 476, dpr: 1 }),
        getComputedStyle: () => ({ getPropertyValue: () => '#e5e7eb' }), document: { body: {} },
        toLocalDateStr: () => '2026-09-25', toLocalMonthStr: () => '2026-09',
        getInvoiceCost: () => 49999500000,
        mgmtReportData: {
            orders: [order], fromDate: new Date('2026-09-25T00:00:00'), toDate: new Date('2026-09-25T23:59:59'),
            analysis: { orderCosts: new Map([[order, 49999500000]]), productLookup: new Map() }
        }
    };
    vm.createContext(geometryContext);
    vm.runInContext(chartMoneyHelper, geometryContext);
    vm.runInContext(mgmtChart, geometryContext);
    geometryContext.drawMgmtChart();
    const chart = canvas._chartData;
    assert.ok(chart.zeroY > chart.padding.top && chart.zeroY < chart.height - chart.padding.bottom, JSON.stringify(chart));
    const bars = fillRects.slice(-3);
    assert.equal(bars.length, 3);
    for (const [, y, , height] of bars) {
        assert.ok(y >= chart.padding.top);
        assert.ok(height >= 0);
        assert.ok(y + height <= chart.height - chart.padding.bottom);
    }
    assert.equal(bars[2][1], chart.zeroY);
});

test('restore rejects present malformed collections and draft containers before any lifecycle work', () => {
    const context = {
        cloneDefaultData: () => ({
            products: [], categories: [], users: [{ id: 1, user: 'admin', pass: 'safe', role: 'admin' }], custs: [], invoices: [],
            suppliers: [], stockHistory: [], returns: [], activityLog: [], purchaseOrders: [], settings: {}, drafts: { invoices: [], purchaseOrders: [], products: [] }
        }),
        normalizeShortcutSettings: () => ({})
    };
    createTestContext(context);
    vm.runInContext(between('function normalizeMinWholesaleQty(', '\nasync function listBackupFiles('), context);
    const validUser = { id: 1, user: 'admin', pass: 'safe', role: 'admin' };

    for (const field of ['products', 'categories', 'users', 'custs', 'invoices', 'suppliers', 'stockHistory', 'returns', 'activityLog', 'purchaseOrders']) {
        assert.throws(
            () => context.loadJsonDataText(JSON.stringify({ products: [], users: [validUser], [field]: { corrupt: true } })),
            new RegExp(`Dữ liệu ${field} không hợp lệ`)
        );
    }
    for (const drafts of [null, [], { invoices: {} }, { purchaseOrders: {} }, { products: {} }]) {
        assert.throws(
            () => context.loadJsonDataText(JSON.stringify({ products: [], users: [validUser], drafts })),
            /Dữ liệu nháp/
        );
    }
    assert.doesNotThrow(() => context.loadJsonDataText(JSON.stringify({ products: [], users: [validUser] })));
});

test('canonical user guards reject stale sessions and preserve live number/string identities', () => {
    const context = {
        db: { users: [{ id: 1, role: 'admin' }] }, isAuthenticated: true, currUser: { id: '1', role: 'staff' },
        toast: (message, type) => context.toasts.push({ message, type }), toasts: []
    };
    createTestContext(context);
    vm.runInContext(between('function getCurrentUserRecord()', '\nfunction getValidCommissionRate'), context);
    vm.runInContext(between('function canMutateManagement()', '\nfunction captureHistoryMutationSnapshot'), context);
    vm.runInContext(between('function canMutateOperationalData()', '\nfunction getValidCommissionRate'), context);
    vm.runInContext(between('function isAdminUser()', '\nfunction normalizeProductSort'), context);

    assert.equal(context.canMutateOperationalData(), true);
    assert.equal(context.canMutateManagement(), true);
    assert.equal(context.canMutateSettings(), true);
    assert.equal(context.canMutateDangerSettings(), true);
    assert.equal(context.isAdminUser(), true);

    context.db.users.length = 0;
    assert.equal(context.canMutateOperationalData(), false);
    assert.equal(context.canMutateManagement(), false);
    assert.equal(context.canMutateSettings(), false);
    assert.equal(context.canMutateDangerSettings(), false);
    assert.equal(context.isAdminUser(), false);
    assert.equal(context.toasts.length, 4);
});

test('primary-load IPC failures block writes instead of falling back to default or local data', async () => {
    for (const loadPrimary of [
        async () => ({ ok: false, code: 'IO_FAILED' }),
        async () => { throw new Error('IPC_DOWN'); }
    ]) {
        const context = {
            desktop: { data: { loadPrimary } }, localStorage: { getItem: () => { throw new Error('local fallback must not run'); } }
        };
        createTestContext(context);
        vm.runInContext(rawBetween('async function loadPersistedData()', '\nfunction getBackupIntervalMs'), context);
        const result = await context.loadPersistedData();
        assert.equal(result.data, null);
        assert.equal(result.source, 'default');
        assert.equal(result.saveBlocked, true);
        assert.match(result.errors.join(' '), /(IO_FAILED|IPC_DOWN)/);
    }
});

test('product Excel omits cost only for non-admins and legacy monetary totals stay finite', () => {
    const exports = [];
    const context = {
        db: {
            users: [{ id: 1, role: 'admin' }],
            products: [{ id: 'P-1', code: 'P-1', name: 'An toàn', cat: 'Khác', price: 20000, cost: 7000, stock: 3, unit: 'SP' }],
            invoices: [{ id: 'I-1', total: '20000' }, { id: 'I-2', total: '30000' }]
        },
        isAuthenticated: true, currUser: { id: 1, role: 'admin' }, getFilteredProductsForTable: () => context.db.products,
        getProductStatusLabel: () => 'Còn hàng', getProductStockStatus: () => 'in',
        exportToExcel: (data, headers) => exports.push({ data, headers })
    };
    createTestContext(context);
    vm.runInContext(between('function getCurrentUserRecord()', '\nfunction getValidCommissionRate'), context);
    vm.runInContext(between('function isAdminUser()', '\nfunction normalizeProductSort'), context);
    vm.runInContext(between('function exportProductsExcel()', '\nfunction exportCustomersExcel'), context);

    context.exportProductsExcel();
    assert.ok(exports[0].headers.includes('Giá vốn'));
    assert.equal(exports[0].data[0][4], 7000);
    context.db.users[0].role = 'manager';
    context.currUser.role = 'manager';
    context.exportProductsExcel();
    assert.equal(exports[1].headers.includes('Giá vốn'), false);
    assert.equal(exports[1].data[0].includes(7000), false);

    const historyFields = new Map([['hist-total-rev', {}], ['hist-total-orders', {}], ['hist-avg-order', {}], ['hist-body', {}]]);
    const renderContext = {
        db: context.db, selectedInvoices: new Set(), historyDisplayLimits: { sales: 200 },
        $: id => historyFields.get(id) || null,
        getFilteredSalesHistory: () => ({ list: context.db.invoices }), getSortedHistoryEntries: entries => entries.slice(),
        resetHistoryDisplayLimit: () => {}, updateBulkDeleteUI: () => {}, updateHistorySortUI: () => {}, getInvoiceItems: () => [],
        hasIncompleteInvoiceItems: () => false, money: value => String(value), setStatMoney: (element, value) => { if (element) element.innerText = String(value); }, escapeHtml: String, escapeAttr: String,
        escapeJsArgument: value => JSON.stringify(value), getStockHistoryDisplayDate: () => '01/01/2026', isViewActive: () => true
    };
    createTestContext(renderContext);
    vm.runInContext(between('function renderHist(', '\nfunction renderReturnsHistory'), renderContext);
    renderContext.renderHist();
    assert.equal(historyFields.get('hist-total-rev').innerText, '50000');
    assert.equal(historyFields.get('hist-avg-order').innerText, '25000');
    assert.equal(renderContext.db.invoices[0].total, '20000');
});

test('money KPIs use a hidden measurement and stay stable until a real layout change', () => {
    const statMoneySource = source.slice(source.indexOf('let statMoneyFitFrame = null;'), source.indexOf('// Money formatting with rounding'));
    const frames = [];
    const classNames = new Set();
    const observers = [], fontReadyCallbacks = [], resizeTimers = new Map();
    let nextTimer = 0;
    let padding = 30;
    const makeStyle = () => {
        const values = Object.create(null);
        return {
            fontWrites: 0,
            get fontSize() { return values['font-size']; },
            set fontSize(value) { this.setProperty('font-size', value); },
            getPropertyValue(name) { return values[name] || ''; },
            removeProperty(name) { delete values[name]; },
            setProperty(name, value) { if (name === 'font-size') this.fontWrites++; values[name] = value; }
        };
    };
    const makeClassList = names => ({
        add: name => names.add(name), remove: name => names.delete(name),
        toggle: (name, force) => { if (force) names.add(name); else names.delete(name); },
        contains: name => names.has(name)
    });
    const card = {
        clientWidth: 360, isConnected: true, style: makeStyle(), classList: makeClassList(classNames),
        appendChild(node) { node.parentElement = this; node.isConnected = true; this.probe = node; return node; }
    };
    const parent = { className: 'd-flex gap-2 mb-2', querySelectorAll: () => [element] };
    card.parentElement = parent;
    const makeProbe = () => {
        const probeClasses = new Set(['stat-val']);
        const probe = {
            tagName: 'DIV', innerText: '', textContent: '', dataset: {}, style: makeStyle(), attributes: undefined,
            classList: makeClassList(probeClasses), setAttribute: () => {}, removeAttribute: () => {}, getAttribute: () => '',
            remove() { this.parentElement = null; this.isConnected = false; },
            get clientWidth() { return Number.parseFloat(this.style.getPropertyValue('width')) || 0; },
            get scrollWidth() { return this.clientWidth ? Math.max(this.clientWidth, Math.ceil(this.innerText.length * Number.parseFloat(this.style.fontSize || '42px') * 0.6)) : 0; }
        };
        return probe;
    };
    const style = makeStyle();
    const element = {
        tagName: 'DIV', innerText: '', textContent: '', style, dataset: {}, attributes: undefined, parentElement: card,
        closest: selector => selector === '.stat-card' ? card : null, cloneNode: () => makeProbe(), getAttribute: () => '',
        get clientWidth() { return card.clientWidth ? Math.round(Math.max(0, card.clientWidth - 2 * padding)) : 0; },
        get scrollWidth() { return this.clientWidth ? Math.max(this.clientWidth, Math.ceil(this.innerText.length * Number.parseFloat(this.style.fontSize || '42px') * 0.6)) : 0; }
    };
    const context = {
        money: value => `${Number(value).toLocaleString('vi-VN')} ₫`,
        getComputedStyle: target => target === card
            ? { paddingLeft: `${padding}px`, paddingRight: `${padding}px` }
            : { fontSize: target.style.fontSize || '42px' },
        requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
        setTimeout: callback => { const id = ++nextTimer; resizeTimers.set(id, callback); return id; },
        clearTimeout: id => resizeTimers.delete(id),
        document: {
            body: { dataset: { uiSize: 'medium', theme: 'light' } }, createElement: () => makeProbe(),
            querySelectorAll: selector => selector === '[data-stat-money-fit]' ? [element] : [],
            fonts: { ready: { then: callback => fontReadyCallbacks.push(callback) } }
        },
        ResizeObserver: class {
            constructor(callback) { this.callback = callback; this.targets = new Set(); this.registrations = 0; observers.push(this); }
            observe(target) { this.targets.add(target); this.registrations++; }
            unobserve(target) { this.targets.delete(target); }
        },
        window: { innerWidth: 1440, innerHeight: 800, addEventListener: (event, callback) => { context.resizeHandler = event === 'resize' ? callback : null; } },
        db: { settings: {} }, undoStack: [], activityLog: [], saveNow: () => { context.saved = true; }
    };
    vm.createContext(context);
    vm.runInContext(statMoneySource, context);

    const before = plain({ db: context.db, undoStack: context.undoStack, activityLog: context.activityLog });
    context.setStatMoney(element, Number.MAX_SAFE_INTEGER);
    context.setStatMoney(element, Number.MAX_SAFE_INTEGER);
    assert.equal(frames.length, 1);
    frames.shift()();
    assert.equal(element.dataset.statMoneyFit, '');
    assert.ok(Number.parseFloat(element.style.fontSize) < 42);
    assert.equal(card.classList.contains('stat-card-money-wide'), false);
    assert.equal(element.style.fontWrites, 1, 'only the final font reaches the visible KPI');
    assert.ok(card.probe.style.fontWrites > 1, 'candidate sizes are tried only on the hidden probe');

    context.setStatMoney(element, Number.MAX_SAFE_INTEGER);
    frames.shift()();
    assert.equal(element.style.fontWrites, 1, 'unchanged input does not reset or rewrite the fitted font');

    context.setStatMoney(element, 0);
    frames.shift()();
    assert.equal(element.style.fontSize, undefined, 'a short value returns to the CSS size without an inline font');

    card.clientWidth = 0;
    context.setStatMoney(element, Number.MAX_SAFE_INTEGER);
    frames.shift()();
    assert.equal(card.classList.contains('stat-card-money-wide'), false);
    card.clientWidth = 360;
    context.resizeHandler();
    frames.shift()();
    assert.ok(Number.parseFloat(element.style.fontSize) < 42);

    card.clientWidth = 100;
    context.resizeHandler();
    frames.shift()();
    assert.equal(card.classList.contains('stat-card-money-wide'), true);
    assert.match(card.style.getPropertyValue('--stat-money-min-width'), /^\d+px$/);

    // A 100%-wide block rounds to 219px even when card width minus animated padding is 218.723px.
    card.clientWidth = 259;
    padding = 20.1385;
    context.setStatMoney(element, 446942888);
    frames.shift()();
    assert.equal(element.clientWidth, 219);
    assert.equal(element.style.fontSize, '28px', 'choose the largest fitting font, not the 18px fallback');
    assert.equal(card.classList.contains('stat-card-money-wide'), false);
    assert.equal(element.scrollWidth, element.clientWidth);

    const fittedBeforeUnavailableMeasure = element.style.fontSize;
    context.document.createElement = undefined;
    context.setStatMoney(element, 446942889);
    frames.shift()();
    assert.equal(element.style.fontSize, fittedBeforeUnavailableMeasure, 'an unavailable measurement restores the previous visible result');
    context.document.createElement = () => makeProbe();

    assert.equal(observers.length, 1, 'one observer is shared across repeated renders');
    const observer = observers[0];
    assert.equal(observer.targets.size, 1);
    assert.equal(observer.registrations, 1, 'the same card is observed only once');
    const resized = width => observer.callback([{ target: card, contentRect: { width, height: 100 } }]);
    resized(218.723);
    resized(218.723);
    assert.equal(resizeTimers.size, 1, 'the first external width notification schedules one trailing fit');
    const flushResize = () => { const callbacks = [...resizeTimers.values()]; resizeTimers.clear(); callbacks.forEach(callback => callback()); };
    flushResize();
    assert.equal(frames.length, 1, 'animated width notifications share one animation frame');
    frames.shift()();
    const writesAfterResize = element.style.fontWrites;
    resized(218.723);
    assert.equal(frames.length, 0, 'height-only or unchanged-width notifications do not refit');
    assert.equal(element.style.fontWrites, writesAfterResize);

    assert.equal(fontReadyCallbacks.length, 1, 'font readiness is registered once');
    fontReadyCallbacks[0]();
    assert.equal(frames.length, 1);
    frames.shift()();
    card.isConnected = false;
    context.scheduleStatMoneyFit();
    frames.shift()();
    assert.equal(observer.targets.size, 0, 'removed cards are unobserved');

    assert.deepEqual(plain({ db: context.db, undoStack: context.undoStack, activityLog: context.activityLog }), before);

    const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
    assert.match(css, /\.stat-card \.stat-val\[data-stat-money-fit\] \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/);
    assert.match(css, /\.stat-money-measurement \{[\s\S]*?position: fixed !important;[\s\S]*?visibility: hidden !important;/);
    assert.match(source, /window\.addEventListener\('resize', scheduleStatMoneyFit\)/);
    assert.match(between('async function applyUISize(', '\nfunction playSuccessSound'), /scheduleStatMoneyFit\(\);/);
});
