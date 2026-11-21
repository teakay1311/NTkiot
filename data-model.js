/* Shared load/restore contract. No storage, DOM or migration side effects. */
(function (root) {
const toFiniteNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const defaultData = {
    products: [
        { id: 1, name: "Cà phê đen", code: "CF01", price: 20000, cost: 5000, stock: 100, cat: "Cà phê", img: "", unit: "Ly", wholesalePrice: 15000, minWholesaleQty: 10 },
        { id: 2, name: "Cà phê sữa", code: "CF02", price: 25000, cost: 7000, stock: 80, cat: "Cà phê", img: "", unit: "Ly", wholesalePrice: 20000, minWholesaleQty: 10 }
    ],
    categories: ["Cà phê", "Trà", "Sinh tố", "Nước ngọt"],
    users: [{ id: 1, user: "admin", pass: "123", name: "Admin", role: "admin" }],
    custs: [{ id: 1, name: "Khách lẻ", phone: "", addr: "", note: "", group: "normal", points: 0, debt: 0, totalBuy: 0, customerType: "retail" }],
    invoices: [],
    suppliers: [],
    stockHistory: [],
    returns: [],
    activityLog: [],
    purchaseOrders: [],
    drafts: { invoices: [], purchaseOrders: [], products: [] },
    settings: {
        name: "", addr: "", phone: "", footer: "Cảm ơn quý khách!",
        bank: "", num: "", owner: "", qr: "", printer: "", paper: "80",
        silent: false, autoBackup: true, backupInterval: 'daily', backupLimit: 60, theme: 'light', sound: true, lowStock: 5, timeOffset: 0, timeOverrideEnabled: false,
        disableLogin: false,
        labelPaper: 110, labelColumns: 3, labelSize: '35x22', labelGap: 2,
        scannerPopup: true, scannerAutoAdd: true,
        pointsRate: 1, pointsValue: 1000, pointsEnabled: true,
        shortcuts: {
            search: 'F1',
            clear: 'F2',
            print: 'F3',
            pay: 'F4',
            customer: 'F5',
            discount: 'F6',
            note: 'F7',
            save: 'F8',
            newTab: 'F9',
            menu: 'F10',
            help: 'F12',
            addProduct: 'Ctrl+Shift+A',
            category: '`',
            cartIncrease: '+',
            cartDecrease: '-',
            cartDeleteLast: 'Delete',
            returnGoods: 'Ctrl+R',
            tabNew: 'Ctrl+T',
            tabClose: 'Ctrl+W',
            tabNext: 'Ctrl+Tab',
            tabPrev: 'Ctrl+Shift+Tab',
            quickSave: 'Ctrl+S',
            undo: 'Ctrl+Z',
            quickPrint: 'Ctrl+P',
            newItem: 'Ctrl+N',
            navPos: 'Alt+1',
            navProducts: 'Alt+2',
            navHistory: 'Alt+3',
            navManagement: 'Alt+4',
            navCustomers: 'Alt+5',
            navStaff: 'Alt+6',
            navSettings: 'Alt+7'
        }
    }
};
function cloneDefaultData() {
    return JSON.parse(JSON.stringify(defaultData));
}

function normalizeShortcutSettings(rawShortcuts = {}) {
    const raw = rawShortcuts && typeof rawShortcuts === 'object' && !Array.isArray(rawShortcuts) ? rawShortcuts : {};
    const shortcuts = { ...defaultData.settings.shortcuts, ...raw };
    const legacyKeys = ['refresh', 'products', 'reports', 'settings', 'pos', 'history'];
    const hasLegacyKeys = legacyKeys.some(key => Object.prototype.hasOwnProperty.call(raw, key));

    legacyKeys.forEach(key => delete shortcuts[key]);

    if (hasLegacyKeys && raw.save === 'F9' && !Object.prototype.hasOwnProperty.call(raw, 'newTab')) {
        shortcuts.save = defaultData.settings.shortcuts.save;
    }

    return shortcuts;
}

function sameStoredId(left, right) {
    return left !== undefined && left !== null && right !== undefined && right !== null && String(left) === String(right);
}

function normalizeMinWholesaleQty(value) {
    const quantity = Math.trunc(Number(value));
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 10;
}

function normalizeCustomerFinancialValue(value) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function normalizeStoredCustomer(customer) {
    if (!customer || typeof customer !== 'object' || Array.isArray(customer) ||
        typeof customer.name !== 'string' || !customer.name.trim()) {
        throw new Error('Dữ liệu khách hàng không hợp lệ');
    }
    return {
        ...customer,
        points: normalizeCustomerFinancialValue(customer.points),
        debt: normalizeCustomerFinancialValue(customer.debt),
        totalBuy: normalizeCustomerFinancialValue(customer.totalBuy)
    };
}

var POS_LINE_NUMERIC_FIELDS = ['qty', 'price', 'total', 'lineTotal', 'customPrice', 'customLineTotal'];
var PURCHASE_ORDER_LINE_NUMERIC_FIELDS = ['qty', 'price', 'total', 'sellPrice'];

function isStoredRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteStoredLineNumber(value) {
    return (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));
}

function hasValidStoredLineItem(item) {
    return isStoredRecord(item) && POS_LINE_NUMERIC_FIELDS.every(field =>
        !Object.prototype.hasOwnProperty.call(item, field) || isFiniteStoredLineNumber(item[field])
    );
}

function hasValidStoredPurchaseOrderLineItem(item) {
    return isStoredRecord(item) && PURCHASE_ORDER_LINE_NUMERIC_FIELDS.every(field =>
        !Object.prototype.hasOwnProperty.call(item, field) || isFiniteStoredLineNumber(item[field])
    );
}

function getStoredLineNumber(item, field, fallback = 0) {
    return isFiniteStoredLineNumber(item?.[field]) ? Number(item[field]) : fallback;
}

function normalizeStoredLineNumbers(item, fields = POS_LINE_NUMERIC_FIELDS) {
    const normalized = { ...item };
    fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(normalized, field) && isFiniteStoredLineNumber(normalized[field])) {
            normalized[field] = Number(normalized[field]);
        }
    });
    return normalized;
}

function validateStoredLineItems(items, label) {
    if (!Array.isArray(items) || !items.every(hasValidStoredLineItem)) {
        throw new Error(`Dữ liệu ${label} không hợp lệ`);
    }
}

function validateOptionalStoredLineItems(record, field, label) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
        validateStoredLineItems(record[field], label);
    }
}

function validateOptionalStoredPurchaseOrderLineItems(record, field, label) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) return;
    const items = record[field];
    if (!Array.isArray(items) || !items.every(hasValidStoredPurchaseOrderLineItem)) {
        throw new Error(`Dữ liệu ${label} không hợp lệ`);
    }
}

function validateRestoredRecordCollection(records, label) {
    if (!Array.isArray(records) || !records.every(isStoredRecord)) {
        throw new Error(`Dữ liệu ${label} không hợp lệ`);
    }
}

function validateRestoredPosDocuments(normalized) {
    normalized.invoices.forEach(invoice => {
        if (!isStoredRecord(invoice)) throw new Error('Dữ liệu hóa đơn không hợp lệ');
        validateOptionalStoredLineItems(invoice, 'items', 'dòng hàng hóa đơn');
    });
    normalized.returns.forEach(returnRecord => {
        if (!isStoredRecord(returnRecord)) throw new Error('Dữ liệu trả hàng không hợp lệ');
        ['items', 'returnItems', 'exchangeItems'].forEach(field =>
            validateOptionalStoredLineItems(returnRecord, field, 'dòng hàng trả/đổi')
        );
    });
    normalized.drafts.invoices.forEach(draft => {
        if (!isStoredRecord(draft)) throw new Error('Dữ liệu nháp hóa đơn không hợp lệ');
        if (!Object.prototype.hasOwnProperty.call(draft, 'data')) return;
        if (!isStoredRecord(draft.data)) throw new Error('Dữ liệu nháp hóa đơn không hợp lệ');
        validateOptionalStoredLineItems(draft.data, 'items', 'dòng hàng nháp hóa đơn');
    });
    normalized.purchaseOrders.forEach(purchaseOrder => {
        if (!isStoredRecord(purchaseOrder)) throw new Error('Dữ liệu đơn nhập không hợp lệ');
        validateOptionalStoredPurchaseOrderLineItems(purchaseOrder, 'items', 'dòng hàng đơn nhập');
    });
    normalized.drafts.purchaseOrders.forEach(draft => {
        if (!isStoredRecord(draft)) throw new Error('Dữ liệu nháp đơn nhập không hợp lệ');
        if (!Object.prototype.hasOwnProperty.call(draft, 'data')) return;
        if (!isStoredRecord(draft.data)) throw new Error('Dữ liệu nháp đơn nhập không hợp lệ');
        validateOptionalStoredPurchaseOrderLineItems(draft.data, 'items', 'dòng hàng nháp đơn nhập');
    });
}

function validPasswordHash(value) {
    return typeof value === 'string' && /^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(value);
}

function isValidAdminAccount(user) {
    return user?.role === 'admin' &&
        typeof user.user === 'string' && user.user.trim() &&
        (Object.hasOwn(user, 'passwordHash') ? validPasswordHash(user.passwordHash) : typeof user.pass === 'string' && user.pass.trim());
}

function hasValidAdminAccount(users) {
    return Array.isArray(users) && users.some(isValidAdminAccount);
}

function validateIdentities(records, collection) {
    const seen = new Set();
    records.forEach((record, index) => {
        const id = record?.id;
        if (!record || (typeof id !== 'string' && typeof id !== 'number') ||
            (typeof id === 'number' && !Number.isFinite(id)) || String(id).trim() === '') {
            throw new Error(`${collection}[${index}].id: định danh không hợp lệ`);
        }
        if (seen.has(String(id))) throw new Error(`${collection}[${index}].id: định danh trùng`);
        seen.add(String(id));
    });
}

function validateProduct(product, index) {
    if (!isStoredRecord(product)) throw new Error('Dữ liệu sản phẩm không hợp lệ');
    if (typeof product.name !== 'string' || !product.name.trim()) throw new Error(`products[${index}].name: tên sản phẩm không hợp lệ`);
    if (product.code !== undefined && product.code !== null && typeof product.code !== 'string') throw new Error(`products[${index}].code: mã vạch phải là chuỗi`);
}

function validateDataShape(raw, { projected = false } = {}) {
    if (!isStoredRecord(raw)) throw new Error('Dữ liệu không phải object JSON hợp lệ');
    const data = { ...defaultData, ...raw, drafts: { ...defaultData.drafts, ...raw.drafts } };
    for (const field of ['products', 'categories', 'users', 'custs', 'invoices', 'suppliers', 'stockHistory', 'returns', 'activityLog', 'purchaseOrders']) {
        if (!Array.isArray(data[field])) throw new Error(`Dữ liệu ${field} không hợp lệ`);
    }
    for (const field of ['invoices', 'purchaseOrders', 'products']) if (!Array.isArray(data.drafts[field])) throw new Error('Dữ liệu nháp không hợp lệ');
    data.products.forEach(validateProduct);
    const ids = new Set();
    data.products.forEach(product => {
        if (product.id === undefined || product.id === null) return;
        if (ids.has(String(product.id))) throw new Error('Dữ liệu có ID sản phẩm trùng nhau');
        ids.add(String(product.id));
    });
    data.custs.forEach(normalizeStoredCustomer);
    ['users', 'suppliers', 'stockHistory'].forEach(field => validateRestoredRecordCollection(data[field], field));
    validateIdentities(data.users, 'users'); validateIdentities(data.custs, 'custs');
    validateRestoredPosDocuments(data);
    if (!(projected ? data.users.some(user => user.role === 'admin' && typeof user.user === 'string' && user.user.trim()) : hasValidAdminAccount(data.users))) throw new Error('Dữ liệu không có tài khoản admin hợp lệ');
    return raw;
}

function normalizeDataShape(raw, { projected = false } = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Dữ liệu không phải object JSON hợp lệ');
    }

    const knownKeys = ['products', 'users', 'custs', 'invoices', 'settings', 'categories'];
    if (!knownKeys.some(key => Object.prototype.hasOwnProperty.call(raw, key))) {
        throw new Error('File không có cấu trúc dữ liệu POS');
    }

    const arrayFields = ['products', 'categories', 'users', 'custs', 'invoices', 'suppliers', 'stockHistory', 'returns', 'activityLog', 'purchaseOrders'];
    arrayFields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(raw, field) && !Array.isArray(raw[field])) {
            throw new Error(`Dữ liệu ${field} không hợp lệ`);
        }
    });
    if (Object.prototype.hasOwnProperty.call(raw, 'drafts')) {
        if (!raw.drafts || typeof raw.drafts !== 'object' || Array.isArray(raw.drafts)) {
            throw new Error('Dữ liệu nháp không hợp lệ');
        }
        ['invoices', 'purchaseOrders', 'products'].forEach(field => {
            if (Object.prototype.hasOwnProperty.call(raw.drafts, field) && !Array.isArray(raw.drafts[field])) {
                throw new Error(`Dữ liệu nháp ${field} không hợp lệ`);
            }
        });
    }

    const base = cloneDefaultData();
    const normalized = { ...base, ...raw };
    normalized.settings = { ...base.settings, ...(raw.settings || {}) };
    normalized.settings.shortcuts = normalizeShortcutSettings((raw.settings && raw.settings.shortcuts) || {});
    normalized.drafts = { ...base.drafts, ...(raw.drafts || {}) };

    arrayFields.forEach(field => {
        if (!Array.isArray(normalized[field])) {
            normalized[field] = Array.isArray(base[field]) ? [...base[field]] : [];
        }
    });

    normalized.products = normalized.products.map((product, index) => {
        validateProduct(product, index);
        return {
            ...product,
            code: product.code ?? '',
            stock: toFiniteNumber(product.stock),
            minWholesaleQty: normalizeMinWholesaleQty(product.minWholesaleQty)
        };
    });
    const productIds = new Set();
    normalized.products.forEach(product => {
        if (product.id === undefined || product.id === null) return;
        const id = String(product.id);
        if (productIds.has(id)) throw new Error('Dữ liệu có ID sản phẩm trùng nhau');
        productIds.add(id);
    });
    normalized.custs = normalized.custs.map(normalizeStoredCustomer);

    ['users', 'suppliers', 'stockHistory'].forEach(field =>
        validateRestoredRecordCollection(normalized[field], field)
    );

    ['invoices', 'purchaseOrders', 'products'].forEach(field => {
        if (!Array.isArray(normalized.drafts[field])) normalized.drafts[field] = [];
    });
    validateRestoredPosDocuments(normalized);
    const normalizeLines = (record, fields, keys = ['items']) => keys.forEach(key => {
        if (Array.isArray(record[key])) record[key] = record[key].map(item => normalizeStoredLineNumbers(item, fields));
    });
    normalized.invoices.forEach(record => normalizeLines(record, POS_LINE_NUMERIC_FIELDS));
    normalized.returns.forEach(record => {
        normalizeLines(record, POS_LINE_NUMERIC_FIELDS, ['items', 'returnItems', 'exchangeItems']);
        if (record.deletedInvoice) normalizeLines(record.deletedInvoice, POS_LINE_NUMERIC_FIELDS);
    });
    normalized.purchaseOrders.forEach(record => normalizeLines(record, PURCHASE_ORDER_LINE_NUMERIC_FIELDS));
    normalized.drafts.invoices.forEach(record => { if (record.data) normalizeLines(record.data, POS_LINE_NUMERIC_FIELDS); });
    normalized.drafts.purchaseOrders.forEach(record => { if (record.data) normalizeLines(record.data, PURCHASE_ORDER_LINE_NUMERIC_FIELDS); });

    if (normalized.users.length === 0) normalized.users = [...base.users];
    if (normalized.custs.length === 0) normalized.custs = [...base.custs];
    validateIdentities(normalized.users, 'users');
    validateIdentities(normalized.custs, 'custs');
    if (!(projected ? normalized.users.some(user => user.role === 'admin' && typeof user.user === 'string' && user.user.trim()) : hasValidAdminAccount(normalized.users))) {
        throw new Error('Dữ liệu không có tài khoản admin hợp lệ');
    }
    return normalized;
}

function loadJsonDataText(text) {
    if (!text || !text.trim()) throw new Error('File dữ liệu rỗng');
    return normalizeDataShape(JSON.parse(text));
}

function validateActiveIdentities(data) {
    validateIdentities(data.users, 'users');
    validateIdentities(data.custs, 'custs');
}

function requireBackupShape(raw, options) {
    const collections = ['products', 'categories', 'users', 'custs', 'invoices', 'suppliers', 'stockHistory', 'returns', 'activityLog', 'purchaseOrders'];
    if (!isStoredRecord(raw)) throw new Error('File không có cấu trúc bản sao lưu POS');
    for (const key of collections) {
        if (!Object.hasOwn(raw, key) || !Array.isArray(raw[key])) throw new Error(`Bản sao lưu thiếu hoặc sai kiểu dữ liệu ${key}`);
    }
    if (!isStoredRecord(raw.settings) || !isStoredRecord(raw.drafts)) throw new Error('Bản sao lưu thiếu cài đặt hoặc dữ liệu nháp hợp lệ');
    if (!(options?.projected ? raw.users.some(user => user?.role === 'admin' && typeof user.user === 'string' && user.user.trim()) : hasValidAdminAccount(raw.users))) {
        throw new Error('Bản sao lưu không có tài khoản admin hợp lệ');
    }
}

function normalizeBackup(raw, options) {
    requireBackupShape(raw, options);
    return normalizeDataShape(raw, options);
}

function validateBackup(raw) {
    requireBackupShape(raw);
    validateDataShape(raw);
}

function splitMoney(amount, weights) {
    if (!amount) return weights.map(() => 0);
    if (!Number.isSafeInteger(amount) || amount < 0 || weights.some(value => !Number.isFinite(value) || value < 0)) {
        throw new Error('Không đủ dữ liệu để phân bổ tiền trả hàng');
    }
    // Scale decimal weights to integers so equal monetary remainders stay equal.
    const decimals = weights.map(value => {
        const [coefficient, exponent = '0'] = String(value).split('e');
        const [whole, fraction = ''] = coefficient.split('.');
        return { digits: BigInt(whole + fraction), scale: fraction.length - Number(exponent) };
    });
    const scale = decimals.reduce((max, entry) => Math.max(max, entry.scale), 0);
    const units = decimals.map(entry => entry.digits * 10n ** BigInt(scale - entry.scale));
    const divisor = units.reduce((sum, value) => sum + value, 0n);
    if (!divisor) throw new Error('Không đủ dữ liệu để phân bổ tiền trả hàng');
    const numerators = units.map(value => value * BigInt(amount));
    const parts = numerators.map(value => Number(value / divisor));
    const order = numerators.map((value, index) => ({ index, remainder: value % divisor }))
        .sort((left, right) => left.remainder === right.remainder ? left.index - right.index : left.remainder > right.remainder ? -1 : 1);
    const residue = amount - parts.reduce((sum, value) => sum + value, 0);
    if (residue < 0 || residue > order.length) throw new Error('Không thể phân bổ tiền trả hàng');
    for (const entry of order.slice(0, residue)) parts[entry.index]++;
    return parts;
}

function returnTotal(record) {
    const items = record.returnItems || record.items || [];
    return getStoredLineNumber(record, 'returnTotal', getStoredLineNumber(record, 'refundAmount',
        items.reduce((sum, item) => sum + getStoredLineNumber(item, 'total', Math.round(Number(item.price) * Number(item.qty))), 0)));
}

function quoteLinkedReturn(invoice, records, selection = [], { quantityOnly = false } = {}) {
    if (!Array.isArray(invoice?.items) || !invoice.items.length) throw new Error('Hóa đơn thiếu dòng hàng');
    const paid = quantityOnly ? 0 : Math.floor(getStoredLineNumber(invoice, 'total', -1));
    if (!Number.isSafeInteger(paid) || paid < 0) throw new Error('Hóa đơn thiếu tổng tiền hợp lệ');
    const lines = invoice.items.map((item, index) => {
        const qty = getStoredLineNumber(item, 'qty'), price = getStoredLineNumber(item, 'price', -1);
        const weight = getStoredLineNumber(item, 'lineTotal', Math.round(price * qty));
        if (item.id == null || qty <= 0 || !quantityOnly && (price < 0 || weight < 0 || !Number.isFinite(weight))) throw new Error('Dòng hóa đơn không hợp lệ');
        return { item, index, qty, price, weight, previousQty: 0, credited: 0 };
    });
    const shares = quantityOnly ? [] : splitMoney(paid, lines.map(line => line.weight));
    const tolerance = qty => Number.EPSILON * 16 * Math.max(1, qty);
    const remaining = line => {
        const qty = Math.max(0, line.qty - line.previousQty);
        return qty <= tolerance(line.qty) ? 0 : qty;
    };
    let creditedTotal = 0;
    const previous = records.filter(record => sameStoredId(record.invoiceId, invoice.id));
    for (const record of [...previous].reverse()) {
        const applied = [];
        const items = record.returnItems || record.items || [];
        for (const item of items) {
            const indexed = item.invoiceLineIndex !== undefined;
            const price = getStoredLineNumber(item, 'price', -1);
            const matches = lines.filter(line => sameStoredId(line.item.id, item.id) && (price < 0 || price === line.price || quantityOnly && line.price < 0) &&
                (!indexed || line.index === item.invoiceLineIndex));
            let outstanding = getStoredLineNumber(item, 'qty');
            if (!(outstanding > 0) || !matches.length || indexed && price < 0) throw new Error('Không đối chiếu được phiếu trả cũ');
            for (const line of matches) {
                const qty = Math.min(remaining(line), outstanding);
                if (!qty) continue;
                line.previousQty += qty;
                outstanding -= qty;
                applied.push({ line, indexed, total: item.total, weight: qty * line.price, qty });
            }
            if (outstanding > tolerance(Number(item.qty))) throw new Error('Số lượng đã trả vượt hóa đơn');
        }
        if (quantityOnly) continue;
        const rawTotal = returnTotal(record);
        if (!Number.isFinite(rawTotal) || rawTotal < 0) throw new Error('Phiếu trả cũ thiếu tổng tiền hợp lệ');
        const known = applied.every(part => part.indexed && Number.isSafeInteger(part.total) && part.total >= 0);
        const total = Math.floor(rawTotal);
        const credits = known && applied.reduce((sum, part) => sum + part.total, 0) === total
            ? applied.map(part => part.total)
            : splitMoney(total, applied.some(part => part.weight > 0) ? applied.map(part => part.weight) : applied.map(part => part.qty));
        applied.forEach(({ line }, index) => { line.credited += credits[index]; });
        creditedTotal += rawTotal;
    }
    const selected = new Map();
    for (const { invoiceLineIndex, qty } of selection) {
        const line = lines[invoiceLineIndex];
        if (!Number.isInteger(invoiceLineIndex) || !line || selected.has(invoiceLineIndex) || !Number.isFinite(qty) || qty <= 0 || qty - remaining(line) > tolerance(line.qty)) {
            throw new Error('Số lượng hoặc dòng trả hàng không hợp lệ');
        }
        selected.set(invoiceLineIndex, Math.min(qty, remaining(line)));
    }
    let budget = Math.max(0, Math.floor(paid - creditedTotal));
    const items = [];
    for (const line of lines) {
        const qty = selected.get(line.index);
        if (!qty) continue;
        const share = shares[line.index];
        const cumulative = remaining(line) - qty <= tolerance(line.qty) ? share : Math.round((line.previousQty + qty) / line.qty * share);
        const total = Math.min(budget, Math.max(0, cumulative - line.credited));
        budget -= total;
        items.push({ id: line.item.id, name: line.item.name, price: line.price, qty, unit: line.item.unit || 'SP', total, invoiceLineIndex: line.index });
        line.previousQty += qty;
    }
    const outstanding = lines.map(remaining);
    const full = outstanding.every(qty => qty === 0);
    // A surviving slip can have been capped by a legacy refund that was later deleted.
    if (full && budget > 0 && items.length) {
        const finalLine = items.findLast(item => shares[item.invoiceLineIndex] > 0) || items.at(-1);
        finalLine.total += budget;
    }
    return { items, outstanding, full, total: items.reduce((sum, item) => sum + item.total, 0) };
}

function linkedReturnPoints(record, previous, rate) {
    let basis = record.returnTotal, reversed = 0;
    for (const saved of previous) {
        if (sameStoredId(saved.invoiceId, record.invoiceId) && saved.returnPointsRate === rate && Number.isSafeInteger(saved.returnPointsReversed) && saved.returnPointsReversed >= 0) {
            basis += returnTotal(saved);
            reversed += saved.returnPointsReversed;
        }
    }
    return Math.max(0, Math.floor(basis * rate / 100) - reversed);
}

function invoicesReopenedByReturnRemoval(invoices = [], before, removed) {
    const reopened = [];
    const remaining = before.filter(record => !removed.some(item => sameStoredId(item.id, record.id)));
    for (const record of removed) {
        const invoiceId = record.invoiceId ?? record.deletedInvoice?.id;
        if (invoiceId == null || invoiceId === '' || invoiceId === 'QUICK_RETURN') continue;
        const active = invoices.find(invoice => sameStoredId(invoice.id, invoiceId));
        const linked = before.filter(item => sameStoredId(item.invoiceId ?? item.deletedInvoice?.id, invoiceId));
        const snapshots = linked.map(item => item.deletedInvoice).filter(Boolean);
        if (snapshots.some(invoice => !sameStoredId(invoice.id, invoiceId) || JSON.stringify(invoice) !== JSON.stringify(active || snapshots[0]))) {
            throw new Error('Bản chụp hóa đơn trả hàng không khớp');
        }
        if (active || reopened.some(invoice => sameStoredId(invoice.id, invoiceId))) continue;
        const snapshot = snapshots[0];
        const stillLinked = remaining.some(item => sameStoredId(item.invoiceId, invoiceId));
        if (snapshot && (!stillLinked || !quoteLinkedReturn(snapshot, remaining, [], { quantityOnly: true }).full)) reopened.push(snapshot);
        else if (!snapshot && (record.returnItems || []).some(item => item.invoiceLineIndex !== undefined)) throw new Error('Thiếu bản chụp hóa đơn trả hàng');
    }
    return reopened;
}

function customerDebtChange(customer, { kind, amount, note }) {
    if (!customer || !['pay', 'add'].includes(kind) || !Number.isSafeInteger(amount) || amount <= 0 || typeof note !== 'string') return null;
    const previous = normalizeCustomerFinancialValue(customer.debt);
    if (kind === 'pay' && amount > previous) return null;
    const debt = kind === 'pay' ? previous - amount : previous + amount;
    if (!Number.isFinite(debt) || debt > Number.MAX_SAFE_INTEGER) return null;
    return { debt, action: kind === 'pay' ? 'Thu nợ' : 'Ghi nợ',
        detail: `${customer.name}: ${amount.toLocaleString('vi-VN')} ₫${note.trim() ? ` — ${note.trim()}` : ''}` };
}

const api = { defaults: defaultData, normalize: normalizeDataShape, normalizeBackup, validateBackup, validate: validateDataShape, validateActiveIdentities,
    sameId: sameStoredId, quoteLinkedReturn, linkedReturnPoints, invoicesReopenedByReturnRemoval, customerDebtChange, validPasswordHash };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NTKIOTDataModel = api;
})(globalThis);
