// Electron's write boundary. Renderer operation names never confer privileges.
const crypto = require('node:crypto');
const model = require('./data-model');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const copy = value => JSON.parse(JSON.stringify(value));
const fail = (code, detail = '') => { const error = new Error(code); error.detail = detail; throw error; };
const profileFields = ['user', 'name', 'fullName', 'phone', 'birthday', 'startDate', 'idCard', 'avatar'];
const operational = ['admin', 'manager', 'staff'];
const management = ['admin', 'manager'];
const policies = {};
function register(names, roles, collections) {
    for (const name of names.split(' ')) policies[name] = { roles, collections: [...collections, 'activityLog'] };
}
register('directCheckout finishOrder', operational, ['products', 'custs', 'invoices', 'stockHistory']);
register('checkoutReturn checkoutReturnExchange processQuickReturnExchange processQuickReturn processReturn deleteReturnRecords', operational, ['products', 'custs', 'invoices', 'returns', 'stockHistory']);
register('saveEditInvoice confirmDeleteInvoice confirmBulkDeleteInvoices', operational, ['products', 'custs', 'invoices', 'stockHistory']);
register('saveCust delCust saveDebt', operational, ['custs']);
register('saveProd saveQuickEditProduct deleteProductsFromInventory', management, ['products', 'categories', 'stockHistory']);
register('addCategory deleteCategory quickAddCatFromProduct', management, ['categories']);
register('confirmImport', management, ['products', 'categories', 'custs']);
register('saveStockIn saveStockOut saveInventoryCheck deleteStockEntry confirmBulkDeleteStockEntries', management, ['products', 'stockHistory']);
register('saveSupplier delSupplier', management, ['suppliers']);
register('savePurchaseOrder updatePOItemPrice deletePurchaseOrder markPOAsPaid', management, ['products', 'purchaseOrders', 'stockHistory', 'suppliers']);
register('markSelectedPOsAsPaid', management, ['purchaseOrders', 'suppliers']);
register('confirmBulkDeletePurchaseOrders', management, ['products', 'purchaseOrders', 'stockHistory', 'suppliers']);
register('saveDraft deleteDraft saveCartAsDraft', operational, ['drafts']);
register('saveSets resetShortcuts saveShortcuts applyTheme applyUISize toggleTimeOverride updateTimeOffset resetTimeToSystem', management, ['settings']);
register('saveUser changeOwnPassword', operational, ['users']);
register('delUser', ['admin'], ['users']);
register('performUndo', operational, ['products', 'categories', 'custs', 'invoices', 'returns', 'stockHistory', 'suppliers', 'purchaseOrders']);
register('background-save', operational, []);
register('performBackup ensureUserCodes validateAllBarcodes migrateLegacyOrderDrafts', [], []);
register('fixInvalidBarcode', management, ['products']);
register('confirmRestoreData', management, []);
register('resetApp uninstallAppSettings', ['admin'], ['settings', 'drafts']);

function unique(records, id) {
    const found = records.filter(record => model.sameId(record.id, id));
    return found.length === 1 ? found[0] : null;
}
const scryptOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
function derivePassword(password, salt) {
    return new Promise((resolve, reject) => crypto.scrypt(password, salt, 32, scryptOptions, (error, key) => error ? reject(error) : resolve(key)));
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const key = await derivePassword(password, salt);
    return `scrypt-v1$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(user, input) {
    if (typeof input !== 'string') return false;
    if (!Object.hasOwn(user, 'passwordHash')) return typeof user.pass === 'string' && user.pass === input;
    if (!model.validPasswordHash(user.passwordHash)) return false;
    const [, salt, expected] = user.passwordHash.split('$');
    return crypto.timingSafeEqual(await derivePassword(input, Buffer.from(salt, 'hex')), Buffer.from(expected, 'hex'));
}

async function migratePasswords(data) {
    if (!data.users.some(user => Object.hasOwn(user, 'pass'))) return data;
    const users = [];
    for (const user of data.users) {
        const { pass, ...record } = user;
        if (!Object.hasOwn(record, 'passwordHash') && typeof pass === 'string') record.passwordHash = await hashPassword(pass);
        users.push(record);
    }
    return { ...data, users };
}

function hasCredential(user) { return Object.hasOwn(user, 'pass') || Object.hasOwn(user, 'passwordHash'); }
function publicUser(user) {
    if (!user) return null;
    const { pass, passwordHash, ...publicRecord } = user;
    return publicRecord;
}
function projection(data) { return { ...data, users: data.users.map(publicUser) }; }
function changedFields(before, after) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => !same(before[key], after[key]));
}
function recordChanges(before, after, allowedFields) {
    if (before.length !== after.length) fail('FORBIDDEN');
    for (const [index, next] of after.entries()) {
        if (next.id === undefined || next.id === null) {
            if (!same(before[index], next)) fail('FORBIDDEN');
            continue;
        }
        const old = unique(before, next.id);
        if (!old || changedFields(old, next).some(key => !allowedFields.includes(key))) fail('FORBIDDEN');
    }
}

const businessOwners = new Set(['directCheckout','finishOrder','checkoutReturn','checkoutReturnExchange',
    'processQuickReturn','processQuickReturnExchange','processReturn','saveEditInvoice',
    'confirmDeleteInvoice','confirmBulkDeleteInvoices','deleteReturnRecords']);
const idKey = id => String(id);
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const validNumber = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value));
const digest = record => crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex');
function requireBusiness(condition) { if (!condition) fail('FORBIDDEN', 'BUSINESS_TRANSITION'); }
function recordDiff(before, after) {
    requireBusiness(Array.isArray(before) && Array.isArray(after));
    const index = records => {
        const result = new Map();
        records.forEach((record, i) => {
            requireBusiness(record && typeof record === 'object');
            const key = record.id == null ? `legacy:${i}` : `id:${idKey(record.id)}`;
            requireBusiness(!result.has(key)); result.set(key, record);
        });
        return result;
    };
    const old = index(before), next = index(after), added = [], removed = [], changed = [];
    for (const [key, record] of next) {
        if (!old.has(key)) {
            requireBusiness((typeof record.id === 'string' && record.id.trim() !== '') || (typeof record.id === 'number' && Number.isFinite(record.id)));
            added.push(record);
        }
        else if (!same(old.get(key), record)) { requireBusiness(record.id != null); changed.push([old.get(key), record]); }
    }
    for (const [key, record] of old) if (!next.has(key)) { requireBusiness(record.id != null); removed.push(record); }
    // Existing records retain their order; adding/restoring a document may prepend or append.
    requireBusiness(same([...old.keys()].filter(k => next.has(k)), [...next.keys()].filter(k => old.has(k))));
    return { added, removed, changed };
}
function appendedLogCount(before, after, minimum = 0) {
    let added = minimum;
    while (added <= after.length && !same(after.slice(added), before.slice(0, 500 - added))) added++;
    if (added > after.length) fail('FORBIDDEN');
    return added;
}
function appendedLogs(before, after) {
    if (!Array.isArray(after) || after.length > 500) fail('FORBIDDEN');
    const added = appendedLogCount(before, after);
    for (const entry of after.slice(0, added)) {
        if (!entry || Object.keys(entry).some(k => !['id','date','user','action','detail'].includes(k)) ||
            !['number','string'].includes(typeof entry.id) || String(entry.id) === '' ||
            typeof entry.id === 'number' && !Number.isFinite(entry.id) ||
            typeof entry.date !== 'string' || !Number.isFinite(Date.parse(entry.date)) ||
            typeof entry.user !== 'string' || typeof entry.action !== 'string' || !entry.action || typeof entry.detail !== 'string') fail('FORBIDDEN');
    }
    return added;
}


function validatePurchaseOrderDeletion(before, next, operation, actor, receipt) {
    const deleting = operation === 'confirmBulkDeletePurchaseOrders';
    const undoing = operation === 'performUndo' && receipt?.purchaseOrderDeletes;
    if (!deleting && !undoing) return null;
    const diff = recordDiff(before.purchaseOrders, next.purchaseOrders);
    const products = copy(before.products), suppliers = copy(before.suppliers);
    const productMap = new Map();
    products.forEach(p => { if (p.id != null && !productMap.has(idKey(p.id))) productMap.set(idKey(p.id), p); });
    let orders, revertStock, consumed = null, historyIds = new Map(), targets = [];
    appendedLogs(before.activityLog, next.activityLog);
    if (deleting) {
        requireBusiness(diff.removed.length > 0 && !diff.added.length && !diff.changed.length);
        orders = diff.removed;
        const entry = next.activityLog[0], added = appendedLogCount(before.activityLog, next.activityLog, 1);
        const detail = orders.length + ' đơn, ';
        requireBusiness(entry?.action === 'Xóa đơn nhập hàng loạt' && entry.user === (actor.name || 'System') &&
            next.activityLog.slice(0, added).filter(log => log.action === entry.action).length === 1 &&
            [detail + 'giữ tồn kho', detail + 'trừ tồn kho'].includes(entry.detail));
        // The existing journal records the user's stock option; canonical lines determine every delta.
        revertStock = entry.detail === detail + 'trừ tồn kho';
        const ids = new Set(orders.map(po => idKey(po.id))), notes = new Map();
        orders.forEach(po => {
            historyIds.set(idKey(po.id), []);
            for (const note of ['Đơn nhập: ' + po.code, 'Sửa đơn nhập: ' + po.code, 'Nhập hàng - ' + po.code + ' (khôi phục)']) {
                if (!notes.has(note)) notes.set(note, []);
                notes.get(note).push(idKey(po.id));
            }
        });
        const kept = before.stockHistory.filter(h => {
            if (!revertStock) return true;
            const related = new Set(h.purchaseOrderId != null
                ? (ids.has(idKey(h.purchaseOrderId)) ? [idKey(h.purchaseOrderId)] : []) : notes.get(h.note) || []);
            related.forEach(id => { if (h.id != null) historyIds.get(id).push(h.id); });
            return !related.size;
        });
        requireBusiness(same(kept, next.stockHistory));
        targets = orders.map(po => ({ id: po.id, hash: digest(po), stockReverted: revertStock, historyIds: historyIds.get(idKey(po.id)) }));
    } else {
        requireBusiness(diff.added.length === 1 && !diff.removed.length && !diff.changed.length);
        const po = diff.added[0];
        consumed = receipt.purchaseOrderDeletes.find(target => model.sameId(target.id, po.id) && target.hash === digest(po));
        requireBusiness(consumed && !consumed.undone && same(next.purchaseOrders, [po, ...before.purchaseOrders]));
        orders = [po]; revertStock = consumed.stockReverted;
        const items = Array.isArray(po.items) ? po.items : [];
        const expectedHistory = revertStock ? items.filter(item => item.productId != null && productMap.has(idKey(item.productId))).map(item => copy({
            date: po.date, type: 'in', productId: item.productId, productName: item.productName,
            qty: item.qty, price: item.price, total: item.total,
            note: 'Nhập hàng - ' + po.code + ' (khôi phục)', user: po.user || '',
            source: 'purchase_order', purchaseOrderId: po.id
        })).reverse() : [];
        requireBusiness(next.stockHistory.length === before.stockHistory.length + expectedHistory.length &&
            same(next.stockHistory.slice(expectedHistory.length), before.stockHistory));
        const used = new Set(before.stockHistory.filter(h => h.id != null).map(h => idKey(h.id)));
        next.stockHistory.slice(0, expectedHistory.length).forEach((entry, i) => {
            const expected = expectedHistory[i];
            requireBusiness((typeof entry.id === 'string' && entry.id.trim() !== '' || typeof entry.id === 'number' && Number.isFinite(entry.id)) &&
                !used.has(idKey(entry.id)) && Object.keys(entry).length === Object.keys(expected).length + 1 &&
                Object.entries(expected).every(([key, value]) => same(entry[key], value)));
            used.add(idKey(entry.id));
        });
    }
    if (revertStock) for (const po of orders) for (const item of Array.isArray(po.items) ? po.items : []) {
        const product = item.productId != null ? productMap.get(idKey(item.productId)) : null;
        if (product) product.stock = number(product.stock) + (deleting ? -1 : 1) * number(item.qty);
    }
    const affected = new Set(orders.filter(po => po.supplierId != null).map(po => idKey(po.supplierId)));
    const debts = new Map();
    next.purchaseOrders.forEach(po => {
        if (po.supplierId != null && !po.isPaid) debts.set(idKey(po.supplierId), (debts.get(idKey(po.supplierId)) || 0) + number(po.totalAmount));
    });
    suppliers.forEach(supplier => { if (affected.has(idKey(supplier.id))) supplier.debt = debts.get(idKey(supplier.id)) || 0; });
    requireBusiness(same(products, next.products) && same(suppliers, next.suppliers));
    return { targets: [], poTargets: targets, consumed };
}

// ponytail: validate the existing snapshot protocol here; no second IPC or persisted transaction schema.
function validateBusinessTransition(before, next, operation, actor, undoReceipt, orderedInvoiceIds, orderedReturnIds) {
    if (!businessOwners.has(operation) && !(operation === 'performUndo' && undoReceipt?.business)) return null;
    if (!same(before.activityLog,next.activityLog)) appendedLogs(before.activityLog,next.activityLog);
    const invoices = recordDiff(before.invoices, next.invoices), returns = recordDiff(before.returns, next.returns);
    const products = before.products.map(p => ({ ...p })), customers = before.custs.map(c => ({ ...c }));
    const productMap = new Map(products.filter(p => p.id != null).map(p => [idKey(p.id), p]));
    const customerMap = new Map(customers.map(c => [idKey(c.id), c]));
    const invoiceMap = new Map(before.invoices.filter(i => i.id != null).map(i => [idKey(i.id), i]));
    const returnsByInvoice = new Map();
    for (const r of before.returns) if (r.invoiceId != null) {
        const key = idKey(r.invoiceId);
        if (!returnsByInvoice.has(key)) returnsByInvoice.set(key, []);
        returnsByInvoice.get(key).push(r);
    }
    const customer = id => id != null && !model.sameId(id, 1) ? customerMap.get(idKey(id)) : null;
    const rate = validNumber(before.settings.pointsRate) ? Number(before.settings.pointsRate) : 1;
    const earned = total => Math.floor(total * rate / 100);
    const enabled = before.settings.pointsEnabled;
    const addedHistory = [], removedHistory = new Set(), removedReturnIds = new Set(), targets = [];
    const unchanged = diff => requireBusiness(!diff.added.length && !diff.removed.length && !diff.changed.length);
    const orderedRecords = (records, ids) => {
        requireBusiness(Array.isArray(ids) && ids.length === records.length &&
            ids.every(id => typeof id === 'string' && id.trim() !== '' || typeof id === 'number' && Number.isFinite(id)) &&
            new Set(ids.map(idKey)).size === ids.length);
        const byId = new Map(records.map(record => [idKey(record.id),record]));
        requireBusiness(ids.every(id => byId.has(idKey(id))));
        return ids.map(id => byId.get(idKey(id)));
    };
    const linked = id => id != null && returnsByInvoice.has(idKey(id));
    const lines = (items, allowEmpty = false) => {
        requireBusiness(Array.isArray(items) && (allowEmpty || items.length > 0));
        for (const item of items) requireBusiness(item && item.id != null && validNumber(item.qty) && Number(item.qty) > 0 &&
            validNumber(item.price) && Number(item.price) >= 0 &&
            ['lineTotal','total'].every(k => item[k] === undefined || validNumber(item[k]) && Number(item[k]) >= 0));
        return items;
    };
    const lineTotal = item => item.total !== undefined ? Number(item.total) : Math.round(Number(item.price) * Number(item.qty));
    const outstandingItems = inv => {
        const grouped = new Map();
        for (const item of lines(inv.items)) {
            const key = idKey(item.id);
            if (!grouped.has(key)) grouped.set(key, { ...item, qty:0 });
            grouped.get(key).qty += Number(item.qty);
        }
        return [...grouped.values()];
    };
    const returnedId = r => r.custId ?? r.customerId ?? r.customer?.id ?? null;
    const returnLines = r => r.returnItems || r.items || [];
    const financialTotals = r => {
        const returned = parseFloat(r.returnTotal ?? r.refundAmount), exchanged = parseFloat(r.exchangeTotal);
        return {
            returned: Number.isFinite(returned) ? returned : returnLines(r).reduce((s, i) => s + lineTotal(i), 0),
            exchanged: Number.isFinite(exchanged) ? exchanged : (r.exchangeItems || []).reduce((s, i) => s + lineTotal(i), 0)
        };
    };
    const stock = (items, direction) => items.forEach(item => {
        const p = productMap.get(idKey(item.id));
        if (p) p.stock = number(p.stock) + direction * Number(item.qty);
    });
    const history = (items, direction, source, note, totalFor, user = actor.name || '') => items.forEach(item => {
        const p = productMap.get(idKey(item.id));
        if (p) addedHistory.push({type:direction > 0 ? 'in':'out',productId:item.id,productName:p.name,
            qty:Number(item.qty),price:item.price,total:totalFor(item),source,note,user});
    });
    const removeReturnHistory = r => removedReturnIds.add(String(r.id ?? ''));
    const restoreReturnCustomer = r => {
        const effects = r.customerEffects;
        let c = customer(effects?.customerId ?? returnedId(r));
        if (effects && Object.hasOwn(effects,'pointsDelta') && Object.hasOwn(effects,'totalBuyDelta') && c) {
            c.points = Math.max(0, number(c.points) - number(effects.pointsDelta));
            c.totalBuy = Math.max(0, number(c.totalBuy) - number(effects.totalBuyDelta)); return;
        }
        c = customer(returnedId(r)); if (!c) return;
        if ((r.invoiceId || r.invoiceId === 0) && r.invoiceId !== 'QUICK_RETURN') {
            const {returned,exchanged} = financialTotals(r);
            c.totalBuy = Math.max(0, number(c.totalBuy) - (exchanged - returned));
            if (enabled) c.points = Math.max(0, number(c.points) - (earned(exchanged) - earned(returned)));
        } else if (enabled) {
            const points = Number(r.pointsReversed);
            c.points = number(c.points) + (Number.isFinite(points) && points >= 0 ? points : earned(number(r.returnTotal || r.refundAmount)));
        }
    };
    const invoiceCustomer = (inv, direction) => {
        const c = customer(inv.custId); if (!c) return;
        const returned = Math.min(number(inv.total), (returnsByInvoice.get(idKey(inv.id)) || [])
            .reduce((s, r) => s + number(r.returnTotal ?? r.refundAmount), 0));
        const amount = Math.max(0, number(inv.total) - returned);
        c.totalBuy = direction > 0 ? number(c.totalBuy) + amount : Math.max(0, number(c.totalBuy) - amount);
        if (enabled) c.points = Math.max(0, number(c.points) + direction * (earned(amount) - number(inv.pointsUsed)));
    };
    let consumed = null;
    if (operation === 'performUndo') {
        const reversing = returns.removed.length === 1 && !returns.added.length && !returns.changed.length;
        const restoring = !reversing && invoices.added.length === 1 && !invoices.removed.length && !invoices.changed.length;
        requireBusiness(restoring || reversing);
        const record = restoring ? invoices.added[0] : returns.removed[0], kind = restoring ? 'invoice' : 'return';
        const target = undoReceipt.business.find(t => t.kind === kind && model.sameId(t.id,record.id) && t.hash === digest(record));
        requireBusiness(target && !target.undone);
        consumed = target;
        if (restoring) {
            unchanged(returns);
            if (target.stockReturned) stock(outstandingItems(record), -1);
            invoiceCustomer(record, 1);
            const ids = new Set(target.historyIds.map(idKey));
            before.stockHistory.forEach((h,i) => { if (h.id != null && ids.has(idKey(h.id))) removedHistory.add(i); });
        } else {
            stock(returnLines(record), -1); stock(record.exchangeItems || [], 1);
            restoreReturnCustomer(record); removeReturnHistory(record);
            const restored = model.invoicesReopenedByReturnRemoval(before.invoices, before.returns, [record]);
            requireBusiness(!invoices.removed.length && !invoices.changed.length && same(invoices.added, restored));
        }
    } else if (['directCheckout','finishOrder'].includes(operation)) {
        unchanged(returns); requireBusiness(invoices.added.length === 1 && !invoices.changed.length && !invoices.removed.length);
        const inv = invoices.added[0], items = lines(inv.items), c = customer(inv.custId);
        requireBusiness(items.every(i => productMap.has(idKey(i.id))));
        const subtotal = items.reduce((s,i) => s + (i.lineTotal !== undefined ? Number(i.lineTotal) : Math.round(Number(i.price) * Number(i.qty))),0);
        const used = number(inv.pointsUsed), value = before.settings.pointsValue || 1000;
        requireBusiness(['subtotal','discount','pointsUsed','pointsValue','total','given','change'].every(k => validNumber(inv[k])) && Number(inv.discount) >= 0 && Number.isInteger(used) && used >= 0 &&
            used <= (enabled && c ? Math.max(0, Math.trunc(number(c.points))) : 0) && used <= Math.floor(Math.max(0,subtotal - Number(inv.discount)) / value) &&
            number(inv.pointsValue) === used * value && number(inv.subtotal) === subtotal &&
            number(inv.total) === Math.round(Math.max(0,subtotal - Number(inv.discount) - used * value) / 1000) * 1000 &&
            validNumber(inv.given) && Number(inv.given) >= Number(inv.total) && number(inv.change) === Number(inv.given) - Number(inv.total));
        stock(items,-1);
        history(items,-1,'sale',`Bán hàng - HĐ ${inv.id}`,i => i.lineTotal || Number(i.qty) * Number(i.price));
        if (c) { c.points = Math.max(0,number(c.points) - used); if (enabled) c.points += earned(Number(inv.total)); c.totalBuy = number(c.totalBuy) + Number(inv.total); }
    } else if (['checkoutReturn','checkoutReturnExchange','processQuickReturn','processQuickReturnExchange','processReturn'].includes(operation)) {
        requireBusiness(returns.added.length === 1 && !returns.removed.length && !returns.changed.length);
        const r = returns.added[0], ret = lines(returnLines(r),true), ex = lines(r.exchangeItems || [],true), c = customer(returnedId(r));
        requireBusiness(ret.length + ex.length > 0);
        if (['processReturn','processQuickReturn','processQuickReturnExchange'].includes(operation)) requireBusiness(ret.length > 0);
        if (operation === 'processQuickReturn') requireBusiness(ex.length === 0);
        requireBusiness([r.custId,r.customerId,r.customer?.id].filter(id => id != null).every(id => model.sameId(id,returnedId(r))));
        const linkedReturn = operation === 'processReturn';
        const sum = items => items.reduce((total, item) => total + (linkedReturn ? Number(item.price) * Number(item.qty) : Math.round(Number(item.price) * Number(item.qty))), 0);
        let returned = sum(ret), pointsReversed = earned(returned);
        const exchanged = sum(ex);
        if (linkedReturn) {
            const inv = invoiceMap.get(idKey(r.invoiceId));
            requireBusiness(inv && (returnedId(r) == null && inv.custId == null || model.sameId(returnedId(r), inv.custId)));
            const previous = returnsByInvoice.get(idKey(inv.id)) || [];
            const quote = model.quoteLinkedReturn(inv, previous, ret.map(item => ({ invoiceLineIndex: item.invoiceLineIndex, qty: Number(item.qty) })));
            requireBusiness(quote.items.length === ret.length && quote.items.every((item, index) => {
                const actual = ret[index];
                return Object.is(item.id, actual.id) && item.invoiceLineIndex === actual.invoiceLineIndex && item.price === actual.price &&
                    item.qty === actual.qty && item.total === actual.total && item.name === actual.name && item.unit === actual.unit;
            }));
            returned = quote.total;
            pointsReversed = enabled ? model.linkedReturnPoints({ ...r, returnTotal: returned }, previous, rate) : 0;
            requireBusiness(enabled ? r.returnPointsRate === rate && r.returnPointsReversed === pointsReversed :
                r.returnPointsRate === undefined && r.returnPointsReversed === undefined);
            requireBusiness(!invoices.added.length && !invoices.changed.length && same(invoices.removed, quote.full ? [inv] : []));
            requireBusiness(quote.full ? same(r.deletedInvoice, inv) : r.deletedInvoice === undefined);
        } else {
            unchanged(invoices);
            requireBusiness(r.deletedInvoice === undefined && (r.invoiceId == null || r.invoiceId === 'QUICK_RETURN'));
        }
        requireBusiness(validNumber(r.returnTotal ?? r.refundAmount) && (r.exchangeTotal === undefined || validNumber(r.exchangeTotal)) &&
            (r.difference === undefined || validNumber(r.difference)) && number(r.returnTotal ?? r.refundAmount) === returned && number(r.exchangeTotal) === exchanged &&
            (r.difference === undefined && !ex.length || number(r.difference) === returned - exchanged));
        if (r.refundAmount !== undefined) requireBusiness(Number(r.refundAmount) === returned);
        stock(ret,1); stock(ex,-1);
        const p0 = c ? {points:number(c.points),totalBuy:number(c.totalBuy)} : {points:0,totalBuy:0};
        if (c) {
            if (linkedReturn) { c.totalBuy = Math.max(0,p0.totalBuy + exchanged-returned); if(enabled)c.points=Math.max(0,p0.points+earned(exchanged)-pointsReversed); }
            else if(enabled)c.points=Math.max(0,p0.points-earned(returned));
        }
        const effects = {customerId:c?.id ?? returnedId(r),pointsDelta:c ? number(c.points)-p0.points:0,totalBuyDelta:c ? number(c.totalBuy)-p0.totalBuy:0};
        requireBusiness(linkedReturn && !c ? r.customerEffects === undefined : same(r.customerEffects,effects));
        if (operation === 'processQuickReturnExchange') requireBusiness(number(r.pointsReversed) === -effects.pointsDelta);
        const label = linkedReturn ? `Trả hàng - HĐ ${r.invoiceId} - Phiếu ${r.id}` : operation === 'checkoutReturn' ? `Trả hàng (Tab) - Phiếu ${r.id}` :
            operation === 'checkoutReturnExchange' ? `Trả hàng - Phiếu ${r.id}` : operation === 'processQuickReturnExchange' ? `Trả hàng nhanh (QR) - Phiếu ${r.id}` : `Trả hàng nhanh - Phiếu ${r.id}`;
        const exLabel = linkedReturn ? `Đổi hàng - HĐ ${r.invoiceId} - Phiếu ${r.id}` : operation === 'checkoutReturn' ? `Đổi hàng (Tab) - Phiếu ${r.id}` :
            operation === 'checkoutReturnExchange' ? `Đổi hàng - Phiếu ${r.id}` : `Đổi hàng nhanh (QR) - Phiếu ${r.id}`;
        const user = ['checkoutReturn','checkoutReturnExchange'].includes(operation) ? actor.name || 'Admin' : actor.name || '';
        history(ret,1,operation.startsWith('processQuick') ? 'quick_return':'return',label,i => linkedReturn ? Math.round(Number(i.qty)*Number(i.price)) : i.total || Math.round(Number(i.qty)*Number(i.price)),user);
        history(ex,-1,'exchange',exLabel,i => i.total || Math.round(Number(i.qty)*Number(i.price)),user);
        targets.push({kind:'return',id:r.id,hash:digest(r)});
    } else if (operation === 'saveEditInvoice') {
        unchanged(returns); requireBusiness(!invoices.added.length && !invoices.removed.length && invoices.changed.length <= 1);
        if (!invoices.changed.length) {
            requireBusiness(same(products,next.products)&&same(customers,next.custs)&&same(before.stockHistory,next.stockHistory));
            return {targets:[],consumed:null};
        }
        const [old,inv] = invoices.changed[0]; requireBusiness(!linked(old.id));
        requireBusiness(changedFields(old,inv).every(k => ['items','cust','custId','subtotal','discount','total','note','editedAt'].includes(k)));
        const oldItems=lines(old.items),items=lines(inv.items),oldCustomer=customer(old.custId),newCustomer=customer(inv.custId);
        const subtotal=items.reduce((s,i)=>s+(i.lineTotal!==undefined?Number(i.lineTotal):Math.round(Number(i.qty)*Number(i.price))),0);
        const financial=!same(old.items,items)||number(old.discount)!==number(inv.discount)||!model.sameId(old.custId??1,inv.custId??1);
        requireBusiness(validNumber(inv.discount)&&Number(inv.discount)>=0&&number(inv.subtotal)===subtotal&&
            number(inv.total)===(financial?Math.round(Math.max(0,subtotal-number(inv.discount)-number(old.pointsValue))/1000)*1000:number(old.total))&&
            (!financial||number(old.pointsUsed)<=0||validNumber(old.pointsValue)));
        const oldQuantities=new Map(),newQuantities=new Map();
        oldItems.forEach(i=>oldQuantities.set(idKey(i.id),(oldQuantities.get(idKey(i.id))||0)+Number(i.qty)));
        items.forEach(i=>newQuantities.set(idKey(i.id),(newQuantities.get(idKey(i.id))||0)+Number(i.qty)));
        const quantities=new Map([...new Set([...oldQuantities.keys(),...newQuantities.keys()])].map(key=>[key,(newQuantities.get(key)||0)-(oldQuantities.get(key)||0)]));
        for(const[key,q]of quantities){const p=productMap.get(key);if(p)requireBusiness(q<=number(p.stock));}
        stock(oldItems,1);stock(items,-1);
        for(const[key,q]of quantities){const p=productMap.get(key);if(p&&q)history([{id:p.id,qty:Math.abs(q),price:p.cost||0}],-Math.sign(q),'invoice_edit',`Điều chỉnh do sửa HĐ ${inv.id}`,i=>Number(i.qty)*Number(i.price));}
        if(oldCustomer&&!model.sameId(oldCustomer.id,inv.custId)){oldCustomer.totalBuy=Math.max(0,number(oldCustomer.totalBuy)-number(old.total));if(enabled)oldCustomer.points=Math.max(0,number(oldCustomer.points)-earned(number(old.total))+number(old.pointsUsed));}
        if(newCustomer){if(model.sameId(oldCustomer?.id,newCustomer.id)){newCustomer.totalBuy=Math.max(0,number(newCustomer.totalBuy)+(number(inv.total)-number(old.total)));if(enabled)newCustomer.points=Math.max(0,number(newCustomer.points)+earned(number(inv.total))-earned(number(old.total)));}
            else{newCustomer.totalBuy=number(newCustomer.totalBuy)+number(inv.total);if(enabled)newCustomer.points=Math.max(0,number(newCustomer.points)+earned(number(inv.total))-number(old.pointsUsed));}}
    } else if (operation === 'deleteReturnRecords') {
        requireBusiness(returns.removed.length>0&&!returns.added.length&&!returns.changed.length&&!invoices.removed.length&&!invoices.changed.length);
        const removing = orderedRecords(returns.removed, orderedReturnIds);
        const restored = model.invoicesReopenedByReturnRemoval(before.invoices, before.returns, removing);
        for (const record of removing) {
            stock(returnLines(record), -1);
            stock(record.exchangeItems || [], 1);
            restoreReturnCustomer(record);
            removeReturnHistory(record);
        }
        requireBusiness(same(invoices.added,restored));
    } else {
        unchanged(returns);requireBusiness(!invoices.added.length&&!invoices.changed.length&&invoices.removed.length>0&&
            (operation!=='confirmDeleteInvoice'||invoices.removed.length===1));
        const incoming = next.stockHistory.length-before.stockHistory.length;
        const restock = operation==='confirmDeleteInvoice'||incoming>0;
        const deletedInvoices = operation === 'confirmBulkDeleteInvoices' ? orderedRecords(invoices.removed,orderedInvoiceIds) : invoices.removed;
        for(const inv of deletedInvoices){requireBusiness(!linked(inv.id));const items=outstandingItems(inv);
            if(restock){stock(items,1);history(items,1,operation==='confirmDeleteInvoice'?'delete_return':'bulk_delete_return',`Hoàn kho - Xóa HĐ ${inv.id}`,i=>i.total||Math.round(Number(i.qty)*Number(i.price)));}
            invoiceCustomer(inv,-1);targets.push({kind:'invoice',id:inv.id,hash:digest(inv),stockReturned:restock,historyIds:[]});}
    }
    requireBusiness(same(products,next.products)&&same(customers,next.custs));
    if (removedReturnIds.size) before.stockHistory.forEach((h,index) => {
        if (h.source && !['return','exchange','quick_return'].includes(h.source)) return;
        const note = String(h.note || '').trimEnd(), marker = 'Phiếu ';
        for (let at = note.indexOf(marker); at >= 0; at = note.indexOf(marker,at + 1)) {
            if (removedReturnIds.has(note.slice(at + marker.length))) { removedHistory.add(index); break; }
        }
    });
    const kept=before.stockHistory.filter((_,i)=>!removedHistory.has(i));
    requireBusiness(next.stockHistory.length===kept.length+addedHistory.length&&same(next.stockHistory.slice(addedHistory.length),kept));
    const prefix=next.stockHistory.slice(0,addedHistory.length),expected=new Map();
    const signature=h=>JSON.stringify([h.type,idKey(h.productId),h.productName,Number(h.qty),Number(h.price),Number(h.total),h.source,h.note,h.user]);
    for(const h of addedHistory){const k=signature(h);expected.set(k,(expected.get(k)||0)+1);}
    const historyIds=new Set(before.stockHistory.filter(h=>h.id!=null).map(h=>idKey(h.id))), historyByNote=new Map();
    for(const h of prefix){const k=signature(h);requireBusiness(expected.get(k)>0&&h.id!=null&&!historyIds.has(idKey(h.id))&&
        typeof h.date==='string'&&Number.isFinite(Date.parse(h.date))&&Object.keys(h).every(k=>['id','date','type','productId','productName','qty','price','total','note','user','source'].includes(k)));
        expected.set(k,expected.get(k)-1);historyIds.add(idKey(h.id));
        if(!historyByNote.has(h.note))historyByNote.set(h.note,[]);historyByNote.get(h.note).push(h.id);}
    for(const target of targets)if(target.kind==='invoice')target.historyIds=historyByNote.get(`Hoàn kho - Xóa HĐ ${target.id}`)||[];
    return {targets,consumed};
}

class DataAuthority {
    constructor(write) {
        this.write = write;
        this.data = null;
        this.boot = crypto.randomUUID();
        this.counter = 0;
        this.epoch = 0;
        this.userId = null;
        this.receipts = new Map();
        this.backupReceipts = new Map();
        this.restoreCandidate = null;
        this.queue = Promise.resolve();
        this.blocked = false;
    }
    get revision() { return `${this.boot}:${this.counter}`; }
    actor() { return this.data && this.userId !== null ? unique(this.data.users, this.userId) : null; }
    session() { return { actor: publicUser(this.actor()), sessionEpoch: this.epoch, revision: this.revision }; }
    adopt(data, { blocked = false } = {}) {
        this.data = model.normalize(data);
        this.blocked = blocked;
        this.counter++;
        return this.publicData();
    }
    publicData() { return projection(this.data); }
    serial(work) {
        const result = this.queue.then(work);
        this.queue = result.catch(() => {});
        return result;
    }
    requireRole(roles) {
        const actor = this.actor();
        if (!actor) fail('AUTH_REQUIRED');
        if (!roles.includes(actor.role)) fail('FORBIDDEN');
        return actor;
    }
    checkVersion(payload) {
        if (payload?.baseRevision !== this.revision || payload?.sessionEpoch !== this.epoch) fail('STALE_STATE');
    }
    login(payload) {
        return this.serial(async () => {
            const matches = [];
            for (const user of this.data?.users || []) {
                if (typeof user.user === 'string' && user.user === payload?.username && await verifyPassword(user, payload?.password)) matches.push(user);
            }
            this.userId = null;
            this.epoch++;
            this.restoreCandidate = null;
            this.backupReceipts.clear();
            if (matches.length !== 1) return { ok: false, code: 'AUTH_REQUIRED', ...this.session() };
            this.userId = matches[0].id;
            return { ok: true, ...this.session() };
        });
    }
    logout() {
        return this.serial(() => {
            this.userId = null;
            this.epoch++;
            this.restoreCandidate = null;
            this.backupReceipts.clear();
            if (this.data?.settings.disableLogin === true) {
                this.userId = (this.data.users.find(u => u.role === 'admin' && model.sameId(u.id, 1)) || this.data.users.find(u => u.role === 'admin'))?.id ?? null;
            }
            return { ok: true, ...this.session() };
        });
    }
    autoLogin() {
        if (this.data?.settings.disableLogin === true && !this.actor()) {
            this.userId = (this.data.users.find(u => u.role === 'admin' && model.sameId(u.id, 1)) || this.data.users.find(u => u.role === 'admin'))?.id ?? null;
        }
        return { ok: true, ...this.session() };
    }
    async mergeAccounts(next, operation, change, actor) {
        const before = this.data.users;
        if (next.users.some(hasCredential)) fail('INVALID_DATA');
        const publicBefore = before.map(publicUser);
        if (!['saveUser', 'delUser', 'changeOwnPassword'].includes(operation)) {
            if (!same(publicBefore, next.users)) fail('FORBIDDEN');
            next.users = before;
            return;
        }
        if (!change || !['create', 'edit', 'delete', 'changeOwnPassword'].includes(change.kind)) fail('INVALID_DATA');
        if (change.newPassword !== undefined && (typeof change.newPassword !== 'string' || !change.newPassword)) fail('INVALID_DATA');
        const old = unique(before, change.targetId);
        const target = unique(next.users, change.targetId);
        if (change.kind === 'create') {
            if (operation !== 'saveUser' || !management.includes(actor.role) || old || !target || next.users.length !== before.length + 1 ||
                typeof change.newPassword !== 'string' || !change.newPassword) fail('FORBIDDEN');
            if (actor.role === 'manager' && (target.role !== 'staff' || target.baseSalary !== undefined || target.commission !== undefined)) fail('FORBIDDEN');
        } else if (change.kind === 'delete') {
            if (operation !== 'delUser' || actor.role !== 'admin' || !old || target || model.sameId(old.id, 1) || next.users.length !== before.length - 1) fail('FORBIDDEN');
        } else {
            if (!old || !target || next.users.length !== before.length || !model.sameId(old.id, target.id)) fail('INVALID_DATA');
            if (change.kind === 'changeOwnPassword') {
                if (operation !== 'changeOwnPassword' || !model.sameId(old.id, actor.id) || !same(publicUser(old), target) ||
                    typeof change.newPassword !== 'string' || change.newPassword.length < 3 || !await verifyPassword(old, change.oldPassword)) fail('FORBIDDEN');
            } else {
                if (operation !== 'saveUser' || !(actor.role === 'admin' || actor.role === 'manager' && old.role === 'staff' || actor.role === 'staff' && model.sameId(actor.id, old.id))) fail('FORBIDDEN');
                if (actor.role === 'staff' && change.newPassword !== undefined) fail('FORBIDDEN');
                const allowed = actor.role === 'admin' ? [...profileFields, 'role', 'baseSalary', 'commission'] : profileFields;
                if (changedFields(publicUser(old), target).some(key => !allowed.includes(key))) fail('FORBIDDEN');
            }
        }
        for (const user of next.users) {
            const previous = unique(before, user.id);
            if (!model.sameId(user.id, change.targetId) && (!previous || !same(publicUser(previous), user))) fail('FORBIDDEN');
            if (model.sameId(user.id, change.targetId) && change.newPassword) user.passwordHash = await hashPassword(change.newPassword);
            else if (previous && Object.hasOwn(previous, 'passwordHash')) user.passwordHash = previous.passwordHash;
            else if (previous && Object.hasOwn(previous, 'pass')) user.pass = previous.pass;
        }
        const names = new Set();
        for (const user of next.users) {
            if (typeof user.user !== 'string' || !user.user.trim() || names.has(user.user) || !['admin', 'manager', 'staff'].includes(user.role)) fail('INVALID_DATA');
            names.add(user.user);
            if (user.commission !== undefined && (!Number.isFinite(Number(user.commission)) || Number(user.commission) < 0 || Number(user.commission) > 100)) fail('INVALID_DATA');
        }
    }
    async authorize(next, payload) {
        let policy = typeof payload.operation === 'string' && Object.hasOwn(policies, payload.operation) ? policies[payload.operation] : null;
        if (payload.operation === 'migrateLegacyOrderDrafts') {
            if (this.epoch > 1 || next.users.some(hasCredential)) fail('FORBIDDEN');
            const oldDrafts = this.data.drafts.invoices;
            const additions = next.drafts?.invoices?.filter(draft => !oldDrafts.some(old => model.sameId(old.id, draft.id)));
            if (!additions || additions.some(draft => !String(draft.id).startsWith('DRAFT-legacy-') || !Array.isArray(draft.data?.items))) fail('INVALID_DATA');
            const expected = { ...this.publicData(), drafts: { ...this.data.drafts, invoices: [...additions, ...oldDrafts] } };
            if (!same(expected, next)) fail('FORBIDDEN');
            next.users = this.data.users;
            return null;
        }
        if (payload.operation === 'performBackup') {
            const receipt = this.backupReceipts.get(payload.backupReceiptId);
            if (!receipt || receipt.revision !== this.revision || receipt.epoch !== this.epoch || next.users.some(hasCredential)) fail('FORBIDDEN');
            appendedLogs(this.data.activityLog, next.activityLog);
            const expected = { ...this.publicData(), activityLog: next.activityLog, settings: { ...this.data.settings, lastBackupAt: receipt.stamp } };
            if (!same(expected, next)) fail('FORBIDDEN');
            next.users = this.data.users;
            return null;
        }
        if (!policy || !policy.roles.length || ['confirmRestoreData', 'resetApp'].includes(payload.operation)) fail('FORBIDDEN');
        const actor = this.requireRole(policy.roles);
        if (payload.operation === 'performUndo') {
            if (payload.undoReceiptId) {
                const receipt = this.receipts.get(payload.undoReceiptId);
                const undoable = ['deleteProductsFromInventory','deleteCategory','delCust','delSupplier','deleteStockEntry','confirmBulkDeleteStockEntries','confirmDeleteInvoice','confirmBulkDeleteInvoices','deletePurchaseOrder','confirmBulkDeletePurchaseOrders','checkoutReturn','checkoutReturnExchange','processQuickReturnExchange','processQuickReturn','processReturn'];
                if (!receipt?.result.committed || receipt.epoch !== this.epoch || !model.sameId(receipt.actorId, actor.id) || !undoable.includes(receipt.operation)) fail('FORBIDDEN');
                policy = policies[receipt.operation];
            } else {
                // Clearing/restoring an unsaved cart has no business delta.
                for (const key of policy.collections) if (!same(this.data[key], next[key]) && key !== 'activityLog') fail('FORBIDDEN');
            }
        }
        await this.mergeAccounts(next, payload.operation, payload.accountChange, actor);
        for (const key of new Set([...Object.keys(this.data), ...Object.keys(next)])) {
            if (!policy.collections.includes(key) && !same(this.data[key], next[key])) fail('FORBIDDEN');
        }
        if (actor.role !== 'admin' && this.data.settings.disableLogin !== next.settings.disableLogin) fail('FORBIDDEN');
        if (payload.operation === 'markSelectedPOsAsPaid') {
            recordChanges(this.data.purchaseOrders, next.purchaseOrders, ['isPaid', 'paidDate']);
            recordChanges(this.data.suppliers, next.suppliers, ['debt']);
            const affected = new Set();
            let paidDate = null, count = 0;
            next.purchaseOrders.forEach((po, index) => {
                const before = this.data.purchaseOrders[index];
                if (!same(before.id, po.id)) fail('FORBIDDEN');
                if (same(before, po)) return;
                if (before.isPaid || po.isPaid !== true || typeof po.paidDate !== 'string' ||
                    !Number.isFinite(Date.parse(po.paidDate)) || new Date(po.paidDate).toISOString() !== po.paidDate ||
                    (paidDate !== null && paidDate !== po.paidDate)) fail('FORBIDDEN');
                paidDate = po.paidDate;
                count++;
                affected.add(String(po.supplierId));
            });
            if (!count) fail('FORBIDDEN');
            next.suppliers.forEach((supplier, index) => {
                const before = this.data.suppliers[index];
                if (!same(before.id, supplier.id)) fail('FORBIDDEN');
                if (!affected.has(String(supplier.id))) {
                    if (!same(before, supplier)) fail('FORBIDDEN');
                    return;
                }
                const debt = next.purchaseOrders.reduce((sum, po) => sum + (model.sameId(po.supplierId, supplier.id) && !po.isPaid && Number.isFinite(Number(po.totalAmount)) ? Number(po.totalAmount) : 0), 0);
                if (supplier.debt !== debt) fail('FORBIDDEN');
            });
            const entry = next.activityLog[0];
            // Other operations can leave pending logs (notably login) in renderer RAM.
            // Preserve the canonical tail with the existing 500-entry truncation rule.
            const added = appendedLogCount(this.data.activityLog, next.activityLog, 1);
            if (!entry || entry.action !== 'Thanh toán đơn nhập hàng loạt' || entry.user !== (actor.name || 'System') ||
                added > next.activityLog.length || next.activityLog.slice(0, added).filter(log => log.action === entry.action).length !== 1) fail('FORBIDDEN');
        }
        if (['directCheckout', 'finishOrder', 'checkoutReturn', 'checkoutReturnExchange', 'processQuickReturnExchange', 'processQuickReturn', 'processReturn', 'deleteReturnRecords', 'saveEditInvoice', 'confirmDeleteInvoice', 'confirmBulkDeleteInvoices'].includes(payload.operation)) {
            recordChanges(this.data.products, next.products, ['stock']);
            recordChanges(this.data.custs, next.custs, ['points', 'totalBuy', 'debt']);
        }
        if (payload.operation === 'saveDebt') {
            const change = payload.debtChange;
            const target = change && unique(this.data.custs, change.customerId);
            const result = target && model.customerDebtChange(target, change);
            if (!result) fail('INVALID_DATA');
            const expected = this.data.custs.map(customer => customer === target ? { ...customer, debt: result.debt } : customer);
            if (!same(next.custs, expected)) fail('FORBIDDEN');
            const added = appendedLogs(this.data.activityLog, next.activityLog);
            const debtLogs = next.activityLog.slice(0, added).filter(entry => ['Thu nợ', 'Ghi nợ'].includes(entry.action));
            if (debtLogs.length !== 1 || debtLogs[0].action !== result.action || debtLogs[0].detail !== result.detail ||
                debtLogs[0].user !== (actor.name || 'System')) fail('FORBIDDEN');
        }
        if (['saveStockIn','saveStockOut','saveInventoryCheck','deleteStockEntry','confirmBulkDeleteStockEntries'].includes(payload.operation)) recordChanges(this.data.products,next.products,['stock']);
        if (['saveDraft', 'deleteDraft', 'saveCartAsDraft'].includes(payload.operation) && !same(this.data.drafts.purchaseOrders, next.drafts.purchaseOrders)) fail('FORBIDDEN');
        if (payload.operation === 'performUndo' && actor.role === 'staff') {
            recordChanges(this.data.products, next.products, ['stock']);
            for (const key of ['categories', 'suppliers', 'purchaseOrders']) if (!same(this.data[key], next[key])) fail('FORBIDDEN');
        }
        return actor;
    }
    remember(id, fingerprint, result, metadata = {}) {
        this.receipts.set(id, { fingerprint, result, ...metadata });
        while (this.receipts.size > 128) this.receipts.delete(this.receipts.keys().next().value);
        return result;
    }
    commitStatus(requestId) {
        const receipt = this.receipts.get(requestId);
        return receipt ? receipt.result : { ok: false, code: 'UNKNOWN_COMMIT' };
    }
    invalidateSession() {
        return this.serial(() => {
            this.userId = null;
            this.epoch++;
            this.restoreCandidate = null;
            this.backupReceipts.clear();
            return this.session();
        });
    }
    save(payload) {
        return this.serial(async () => {
            const id = payload?.requestId;
            if (typeof id !== 'string' || !id || id.length > 128 || typeof payload.text !== 'string' || Buffer.byteLength(payload.text) > 100 * 1024 * 1024) fail('INVALID_DATA');
            const { text, ...metadata } = payload;
            const fingerprint = crypto.createHash('sha256').update(text).update(JSON.stringify(metadata)).digest('hex');
            const receipt = this.receipts.get(id);
            if (receipt) { if (receipt.fingerprint !== fingerprint) fail('INVALID_DATA'); return receipt.result; }
            try {
                if (typeof payload.operation !== 'string') fail('INVALID_DATA');
                this.checkVersion(payload);
                if (this.blocked) fail('INVALID_DATA');
                let next;
                try { next = JSON.parse(payload.text); }
                catch (_) { fail('INVALID_DATA'); }
                if (!next || !Array.isArray(next.users)) fail('INVALID_DATA');
                await this.authorize(next, payload);
                // Validation does not invent identities or silently merge records.
                try { model.validate(next); }
                catch (error) { fail('INVALID_DATA', error.message); }
                const transition = validatePurchaseOrderDeletion(this.data, next, payload.operation, this.actor(), this.receipts.get(payload.undoReceiptId)) ||
                    validateBusinessTransition(this.data, next, payload.operation, this.actor(), this.receipts.get(payload.undoReceiptId), payload.orderedInvoiceIds, payload.orderedReturnIds);
                await this.write(JSON.stringify(next), { keepBak: true, validated: true });
                this.data = next;
                if (transition?.consumed) transition.consumed.undone = true;
                if (payload.backupReceiptId) this.backupReceipts.delete(payload.backupReceiptId);
                this.counter++;
                this.restoreCandidate = null;
                return this.remember(id, fingerprint, { ok: true, committed: true, ...this.session() }, { actorId: this.actor()?.id, epoch: this.epoch, operation: payload.operation,
                    ...(transition?.targets.length ? {business:transition.targets} : {}),
                    ...(transition?.poTargets?.length ? {purchaseOrderDeletes:transition.poTargets} : {}) });
            } catch (error) {
                return this.remember(id, fingerprint, { ok: false, committed: false, code: ['AUTH_REQUIRED', 'FORBIDDEN', 'INVALID_DATA', 'STALE_STATE'].includes(error.message) ? error.message : 'IO_FAILED', detail: error.detail || '' });
            }
        });
    }
}

module.exports = { DataAuthority, policies, projection, publicUser, unique, migratePasswords };
