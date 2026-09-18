// POS PRO V10 - PLATINUM EDITION - MAIN SCRIPT
// Electron capabilities are intentionally exposed only through preload.js.
const desktop = window.ntkiot || null;
const JsBarcode = window.JsBarcode;
var XLSX = window.XLSX;
const hasDesktopStorage = () => typeof desktop !== 'undefined' && !!desktop?.data?.load;

function serializeError(error) {
    if (!error) return {};
    return {
        message: error.message || String(error),
        stack: error.stack || '',
        name: error.name || ''
    };
}

function logRendererEvent(type, payload = {}) {
    try {
        desktop?.log?.({ type, payload });
    } catch (e) {
        console.error('Renderer log failed:', e);
    }
}

window.onunhandledrejection = function (event) {
    console.error("Unhandled Promise Rejection:", event.reason);
    logRendererEvent('unhandled-rejection', {
        reason: serializeError(event.reason)
    });
};

// Global Error Handler
window.onerror = function (msg, url, line, col, error) {
    console.error("Global Error:", error);
    logRendererEvent('window-error', {
        message: msg,
        url,
        line,
        col,
        error: serializeError(error)
    });
    return false;
};

const $ = id => document.getElementById(id);

const escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeAttr = escapeHtml;

const escapeJsString = value => String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/</g, '\\x3C')
    .replace(/>/g, '\\x3E');

// ponytail: one context-safe literal keeps persisted IDs compatible without trusting their format.
const escapeJsArgument = value => escapeAttr(
    typeof value === 'number' && Number.isFinite(value)
        ? String(value)
        : `'${escapeJsString(value)}'`
);

const toFiniteNumber = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

function safeImageSrc(value) {
    const src = String(value || '').trim();
    if (!src) return '';
    return /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(src) ? src : '';
}

// Money formatting - exact display without rounding
// Used for prices, inventory, reports, product management, etc.
const money = n => Math.round(parseFloat(n || 0)).toLocaleString('vi-VN') + ' ₫';

// Money formatting with rounding to nearest 1000₫
// ONLY used for cart total and printed invoices (customer convenience)
const moneyRounded = n => {
    const value = parseFloat(n || 0);
    const rounded = Math.round(value / 1000) * 1000;
    return rounded.toLocaleString('vi-VN') + ' ₫';
};

// Format quantity - show decimals only when needed (up to 3 decimal places)
// Uses vi-VN locale: period (.) for thousands, comma (,) for decimals
const formatQty = (q) => {
    const val = parseFloat(q || 0);
    if (Number.isInteger(val)) return val.toLocaleString('vi-VN');
    return val.toLocaleString('vi-VN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 3
    });
};

// Parse Vietnamese formatted number string to JavaScript number
// Input: "1.000,5" -> Output: 1000.5
const parseVN = (str) => {
    if (typeof str === 'number') return str;
    if (!str) return 0;
    return parseFloat(str.toString().replace(/\./g, '').replace(',', '.')) || 0;
};

function getInvoiceItemCost(item) {
    const storedCost = parseFloat(item?.cost);
    if (Number.isFinite(storedCost)) return storedCost;
    const product = db.products.find(x => sameStoredId(x.id, item?.id));
    const fallbackCost = parseFloat(product?.cost);
    return Number.isFinite(fallbackCost) ? fallbackCost : 0;
}

function getInvoiceItemRevenue(item) {
    if (item?.lineTotal !== undefined) return parseFloat(item.lineTotal) || 0;
    return Math.round((parseFloat(item?.price) || 0) * (parseFloat(item?.qty) || 0));
}

function getInvoiceCost(invoice) {
    return (invoice?.items || []).reduce((sum, item) => {
        return sum + getInvoiceItemCost(item) * (parseFloat(item.qty) || 0);
    }, 0);
}

// Format date as YYYY-MM-DD in LOCAL timezone (Vietnam UTC+7)
const toLocalDateStr = (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

function parseLocalDateInput(value, endOfDay = false) {
    const [year, month, day] = String(value || '').split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(
        year,
        month - 1,
        day,
        endOfDay ? 23 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 999 : 0
    );
}

// Format date as YYYY-MM in LOCAL timezone
const toLocalMonthStr = (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
};

// Format date as YYYY-MM-DDTHH:MM for datetime-local inputs
const toLocalDateTimeStr = (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    return toLocalDateStr(dt) + 'T' + String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
};

// ========== PERFORMANCE OPTIMIZATION UTILITIES ==========
// Debounce: delay function execution until after delay ms have elapsed since last call
function debounce(func, delay = 150) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
}

// Throttle: ensure function is called at most once per delay ms
function throttle(func, delay = 100) {
    let lastCall = 0;
    let timeoutId;
    return function (...args) {
        const now = Date.now();
        const remaining = delay - (now - lastCall);
        clearTimeout(timeoutId);
        if (remaining <= 0) {
            lastCall = now;
            func.apply(this, args);
        } else {
            timeoutId = setTimeout(() => {
                lastCall = Date.now();
                func.apply(this, args);
            }, remaining);
        }
    };
}

// Performance constants
let currentVisibleLimit = 100; // Dynamic limit for POS grid
const MAX_VISIBLE_PRODUCTS = 100; // Default limit products rendered in POS grid
const SEARCH_DEBOUNCE_MS = 150;   // Debounce delay for search input

function loadMoreProducts() {
    currentVisibleLimit += 100;
    renderPos();
}

// Return/Exchange Mode State - Declared early to avoid TDZ issues
let isReturnExchangeMode = false;
let activeReturnCart = 'return'; // 'return' or 'exchange'
let returnItems = [];      // Items being returned
let exchangeItems = [];    // Items being exchanged/bought

// Default Data Structure
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


let db = JSON.parse(JSON.stringify(defaultData));

// Time offset (milliseconds) for manual date/time override in settings
let timeOffset = 0;

// Get app's "current date" with offset applied
function getAppDate() {
    return new Date(Date.now() + timeOffset);
}

// Get app's "current timestamp" with offset applied
function getAppNow() {
    return Date.now() + timeOffset;
}

let currUser = null;
let isAuthenticated = false;
let cart = [];
let cust = null;
let isQuickAddCust = false;
let currentInvoice = null;
let currentReturnInvoice = null;
let backupTimer = null;
let dataLoadStatus = 'default';
let lastDataLoadError = null;
let saveBlockedReason = '';
let saveBlockedToastShown = false;
let saveSuppressed = false;
let focusedProductIndex = -1;
let globalBarcodeBuffer = '';

function isLoginDisabled() {
    return db.settings?.disableLogin === true;
}

function getDefaultAdminUser() {
    return db.users.find(u => u.role === 'admin' && sameStoredId(u.id, 1))
        || db.users.find(u => u.role === 'admin')
        || null;
}

function updateAuthPanel() {
    if ($('user-display')) {
        $('user-display').innerText = currUser ? `${currUser.name} (${currUser.role})` : 'Chưa đăng nhập';
    }
    const logoutBtn = $('logout-btn');
    if (logoutBtn) {
        logoutBtn.style.display = isAuthenticated && isLoginDisabled() ? 'none' : '';
    }
}

function signInAsDefaultAdmin(options = {}) {
    const admin = getDefaultAdminUser();
    if (!admin) {
        if (options.showError) {
            toast("Không tìm thấy tài khoản admin để tự đăng nhập!", "error");
        }
        return false;
    }

    currUser = admin;
    isAuthenticated = true;
    if ($('log-p')) $('log-p').value = '';
    closeModal('login-modal');
    updateAuthPanel();
    renderNav();
    if (options.route) router(options.route);
    return true;
}

// Multi-Invoice Tab System
let invoiceTabs = [{
    id: 1, name: 'Đơn 1',
    cart: [], cust: null, discount: 0, discountType: 'amount',
    // Return/exchange state per tab
    returnItems: [], exchangeItems: [],
    isReturnExchangeMode: false, activeReturnCart: 'return'
}];
let activeTabId = 1;
let nextTabId = 2;

// ========== MULTI-TAB INVOICE SYSTEM ==========

// Create a new invoice tab
function createNewInvoiceTab() {
    // Save current cart to active tab first
    saveCurrentTabState();

    // Create new tab
    const newTab = {
        id: nextTabId,
        name: `Đơn ${nextTabId}`,
        cart: [], cust: null, discount: 0, discountType: 'amount',
        // Return/exchange state - each tab starts fresh
        returnItems: [], exchangeItems: [],
        isReturnExchangeMode: false, activeReturnCart: 'return'
    };

    invoiceTabs.push(newTab);
    nextTabId++;

    // Switch to new tab
    activeTabId = newTab.id;
    loadTabState(newTab.id);

    renderInvoiceTabs();
    renderCart();
    toast(`📋 Đã tạo ${newTab.name}`, 'info');
}

// Switch to a different tab
function switchTab(tabId) {
    if (tabId === activeTabId) return;

    // Save current tab state
    saveCurrentTabState();

    // Load new tab state
    activeTabId = tabId;
    loadTabState(tabId);

    // Reset global navigation/barcode state on tab switch
    focusedProductIndex = -1;
    posSelectedIndex = -1;
    posSelectedProductId = null;
    isNavigatingProducts = false;
    globalBarcodeBuffer = '';
    if (globalBarcodeTimeout) {
        clearTimeout(globalBarcodeTimeout);
        globalBarcodeTimeout = null;
    }

    renderInvoiceTabs();
    renderCart();

    // Update cart section style based on new tab's mode
    updateReturnModeUI(isReturnMode());
}

// Close a tab
function closeTab(tabId, event) {
    if (event) event.stopPropagation();

    // Cannot close if only one tab
    if (invoiceTabs.length <= 1) {
        toast('Không thể đóng đơn cuối cùng', 'warning');
        return;
    }

    const tab = invoiceTabs.find(t => t.id === tabId);

    // Confirm if tab has items
    if (tab && tab.cart.length > 0) {
        if (!confirm(`Đơn "${tab.name}" có ${tab.cart.length} sản phẩm. Đóng và xóa?`)) {
            return;
        }
    }

    // Remove tab
    invoiceTabs = invoiceTabs.filter(t => t.id !== tabId);

    // If closed tab was active, switch to first tab
    if (activeTabId === tabId) {
        if (invoiceTabs.length > 0) {
            activeTabId = invoiceTabs[0].id;
            loadTabState(activeTabId);
        } else {
            createNewInvoiceTab();
            return;
        }
    }

    renderInvoiceTabs();
    renderCart();

    // Update cart section style based on new active tab
    updateReturnModeUI(isReturnMode());
}

// Save current cart state to active tab
function saveCurrentTabState() {
    const tab = invoiceTabs.find(t => t.id === activeTabId);
    if (tab) {
        tab.cart = cart.map(item => ({ ...item })); // Deep copy cart items
        tab.cust = cust ? { ...cust } : null; // Deep copy customer object
        tab.discount = parseInt(($('cart-discount')?.value || '0').replace(/\D/g, '')) || 0;
        tab.discountType = $('discount-type')?.value || 'amount';

        // Save return/exchange state per tab
        tab.returnItems = returnItems.map(item => ({ ...item }));
        tab.exchangeItems = exchangeItems.map(item => ({ ...item }));
        tab.isReturnExchangeMode = isReturnExchangeMode;
        tab.activeReturnCart = activeReturnCart;
    }
}

// Load tab state into current cart
function loadTabState(tabId) {
    const tab = invoiceTabs.find(t => t.id === tabId);
    if (tab) {
        cart = tab.cart.map(item => ({ ...item })); // Deep copy cart items
        cust = tab.cust ? { ...tab.cust } : null; // Deep copy customer object

        // Update UI
        if ($('cart-discount')) $('cart-discount').value = tab.discount || 0;
        if ($('discount-type')) $('discount-type').value = tab.discountType || 'amount';
        if ($('cart-cust')) $('cart-cust').value = cust?.name || '';

        // Load return/exchange state per tab
        returnItems = (tab.returnItems || []).map(item => ({ ...item }));
        exchangeItems = (tab.exchangeItems || []).map(item => ({ ...item }));
        isReturnExchangeMode = tab.isReturnExchangeMode || false;
        activeReturnCart = tab.activeReturnCart || 'return';

        // Update return/exchange mode UI (without triggering toggle)
        updateReturnExchangeModeUI();
    }
}

// Render invoice tabs UI
function renderInvoiceTabs() {
    const container = $('invoice-tabs-list');
    if (!container) return;

    container.innerHTML = invoiceTabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        // For active tab, use global cart (most current); for other tabs, use saved cart
        const tabCart = isActive ? cart : tab.cart;
        const itemCount = tabCart.reduce((sum, i) => sum + i.qty, 0);
        const hasItems = itemCount > 0;

        return `
            <div class="invoice-tab ${isActive ? 'active' : ''}" 
                 data-tab-id="${tab.id}"
                 data-tab-index="${index}"
                 data-mode="${tab.mode || ''}"
                 draggable="true"
                 onclick="switchTab(${tab.id})">
                <span class="tab-name">${escapeHtml(tab.name)}</span>
                ${hasItems ? `<span class="tab-badge">${itemCount}</span>` : ''}
                ${invoiceTabs.length > 1 ? `<span class="tab-close" onclick="closeTab(${tab.id}, event)">×</span>` : ''}
            </div>
        `;
    }).join('');

    // Setup drag-drop after rendering
    setupTabDragDrop();
}

// ═══════════════════════════════════════════════════════════════════════════
// INVOICE TAB DRAG AND DROP - Kéo thả sắp xếp lại thứ tự tab đơn hàng
// ═══════════════════════════════════════════════════════════════════════════

let draggedTab = null;
let draggedTabIndex = -1;
let isDraggingTab = false;
let tabDragDelegationSetup = false;

function setupTabDragDrop() {
    const container = $('invoice-tabs-list');
    if (!container || tabDragDelegationSetup) return;
    tabDragDelegationSetup = true;

    container.addEventListener('dragstart', function(e) {
        const tab = e.target.closest('.invoice-tab');
        if (tab) handleTabDragStart.call(tab, e);
    });
    container.addEventListener('dragover', function(e) {
        const tab = e.target.closest('.invoice-tab');
        if (tab) handleTabDragOver.call(tab, e);
    });
    container.addEventListener('dragleave', function(e) {
        const tab = e.target.closest('.invoice-tab');
        if (tab) handleTabDragLeave.call(tab, e);
    });
    container.addEventListener('drop', function(e) {
        const tab = e.target.closest('.invoice-tab');
        if (tab) handleTabDrop.call(tab, e);
    });
    container.addEventListener('dragend', function(e) {
        const tab = e.target.closest('.invoice-tab');
        if (tab) handleTabDragEnd.call(tab, e);
    });
}

function handleTabDragStart(e) {
    draggedTab = this;
    draggedTabIndex = parseInt(this.dataset.tabIndex);
    isDraggingTab = true;

    // Visual feedback
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.tabId);

    // Delay opacity change for better visual
    setTimeout(() => {
        if (draggedTab) {
            draggedTab.style.opacity = '0.5';
        }
    }, 0);
}

function handleTabDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (this !== draggedTab) {
        // Remove drag-over from all tabs first
        document.querySelectorAll('.invoice-tab').forEach(t => t.classList.remove('drag-over'));
        this.classList.add('drag-over');
    }
}

function handleTabDragLeave(e) {
    this.classList.remove('drag-over');
}

function handleTabDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    this.classList.remove('drag-over');

    if (this === draggedTab || !draggedTab) return;

    const targetIndex = parseInt(this.dataset.tabIndex);

    // Đổi vị trí trong mảng invoiceTabs
    reorderInvoiceTabs(draggedTabIndex, targetIndex);
}

function handleTabDragEnd(e) {
    if (draggedTab) {
        draggedTab.classList.remove('dragging');
        draggedTab.style.opacity = '';
    }

    // Clear all drag-over states
    document.querySelectorAll('.invoice-tab').forEach(tab => {
        tab.classList.remove('drag-over', 'dragging');
    });

    // Reset drag state after a short delay (to prevent click from firing)
    setTimeout(() => {
        isDraggingTab = false;
        draggedTab = null;
        draggedTabIndex = -1;
    }, 50);
}

function reorderInvoiceTabs(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= invoiceTabs.length || toIndex >= invoiceTabs.length) return;

    // Lấy tab cần di chuyển
    const [movedTab] = invoiceTabs.splice(fromIndex, 1);

    // Chèn vào vị trí mới
    invoiceTabs.splice(toIndex, 0, movedTab);

    // Re-render
    renderInvoiceTabs();

    showToast(`📋 Đã di chuyển ${movedTab.name}`, 'info');
}


// Quick Return Mode - allows returning items without finding original invoice
let isQuickReturnMode = false;

// Product View Mode (grid, list, details)
let currentViewMode = localStorage.getItem('posViewMode') || 'grid';

// View Mode Switch function - called from HTML buttons
function setViewMode(mode) {
    currentViewMode = mode;
    localStorage.setItem('posViewMode', mode);

    // Update button states
    document.querySelectorAll('.view-mode-toggle .view-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-view') === mode) {
            btn.classList.add('active');
        }
    });

    // Update grid class for different view modes
    const grid = $('pos-grid');
    if (grid) {
        grid.classList.remove('grid-view', 'list-view', 'details-view', 'view-grid', 'view-list', 'view-details');
        grid.classList.add(mode + '-view', `view-${mode}`);
    }

    // Re-render to apply any view-specific changes
    renderPos();
}

// Bulk delete selection tracking
let selectedProducts = new Set();
let selectedInvoices = new Set();
let selectedReturns = new Set();
let selectedStockEntries = new Set();

// UNDO SYSTEM - Ctrl+Z support
const undoStack = [];
const MAX_UNDO_HISTORY = 20;
const UNDO_ACTIONS = {
    DELETE_PRODUCT: 'DELETE_PRODUCT',
    DELETE_INVOICE: 'DELETE_INVOICE',
    DELETE_STOCK_ENTRY: 'DELETE_STOCK_ENTRY',
    DELETE_CUSTOMER: 'DELETE_CUSTOMER',
    EDIT_PRODUCT: 'EDIT_PRODUCT',
    CLEAR_CART: 'CLEAR_CART',
    DELETE_CATEGORY: 'DELETE_CATEGORY',
    DELETE_SUPPLIER: 'DELETE_SUPPLIER',
    RETURN_GOODS: 'RETURN_GOODS',
    DELETE_PURCHASE_ORDER: 'DELETE_PURCHASE_ORDER'
};

// Toast deduplication system - prevent showing same message multiple times
let shownToastMessages = new Set();

function clearToastHistory() {
    shownToastMessages.clear();
}

function pushUndo(actionType, data) {
    undoStack.push({ type: actionType, data: JSON.parse(JSON.stringify(data)), timestamp: Date.now() });
    if (undoStack.length > MAX_UNDO_HISTORY) undoStack.shift();
}

function performUndo() {
    if (undoStack.length === 0) {
        showToast('Không có thao tác để hoàn tác', 'warning');
        return;
    }

    const dbSnapshot = JSON.stringify(db);
    const undoSnapshot = undoStack.slice();
    const action = undoStack.pop();
    let message = '';

    switch (action.type) {
        case UNDO_ACTIONS.DELETE_PRODUCT:
            db.products.push(action.data);
            renderProdTable();
            message = `Đã khôi phục sản phẩm "${action.data.name}"`;
            break;

        case UNDO_ACTIONS.DELETE_INVOICE:
            const deletedInvoice = action.data.invoice || action.data;
            db.invoices.push(deletedInvoice);
            if (action.data.invoice) {
                (action.data.restoredItems || []).forEach(item => {
                    const p = db.products.find(x => sameStoredId(x.id, item.id));
                    if (p) p.stock -= item.qty;
                });
                db.stockHistory = (db.stockHistory || []).filter(h =>
                    !((h.source === 'delete_return' || h.source === 'bulk_delete_return') &&
                        h.note?.includes(deletedInvoice.id))
                );
                reapplyInvoiceCustomerEffects(deletedInvoice);
                renderPos();
                renderInventory();
            }
            renderHist();
            message = `Đã khôi phục đơn hàng #${String(deletedInvoice.id ?? '').slice(-6)}`;
            break;

        case UNDO_ACTIONS.DELETE_STOCK_ENTRY:
            if (!db.stockHistory) db.stockHistory = [];
            const stockUndo = action.data?.entry ? action.data : { entry: action.data, stockReverted: false };
            const restoredStockEntry = stockUndo.entry;
            db.stockHistory.push(restoredStockEntry);
            if (stockUndo.stockReverted) {
                const product = db.products.find(p => sameStoredId(p.id, restoredStockEntry.productId));
                const qty = parseFloat(restoredStockEntry.qty) || 0;
                if (product && Number.isFinite(stockUndo.stockAdjustment)) {
                    product.stock -= stockUndo.stockAdjustment;
                } else {
                    if (product && restoredStockEntry.type === 'in') product.stock += qty;
                    if (product && restoredStockEntry.type === 'out') product.stock -= qty;
                }
            }
            renderStockHistory();
            renderInventory();
            renderManagement();
            message = `Đã khôi phục lịch sử kho`;
            break;

        case UNDO_ACTIONS.DELETE_CUSTOMER:
            db.custs.push(action.data);
            renderCustTable();
            message = `Đã khôi phục khách hàng "${action.data.name}"`;
            break;

        case UNDO_ACTIONS.EDIT_PRODUCT:
            const prodIdx = db.products.findIndex(p => sameStoredId(p.id, action.data.id));
            if (prodIdx >= 0) db.products[prodIdx] = action.data;
            renderProdTable();
            message = `Đã hoàn tác chỉnh sửa sản phẩm "${action.data.name}"`;
            break;

        case UNDO_ACTIONS.CLEAR_CART:
            // Deep copy each item to prevent shared references
            cart = action.data.map(item => ({ ...item }));
            renderCart();
            message = `Đã khôi phục giỏ hàng (${cart.length} sản phẩm)`;
            break;

        case UNDO_ACTIONS.DELETE_CATEGORY:
            if (!db.categories) db.categories = [];
            db.categories.push(action.data);
            renderCategories();
            message = `Đã khôi phục danh mục "${action.data}"`;
            break;

        case UNDO_ACTIONS.DELETE_SUPPLIER:
            if (!db.suppliers) db.suppliers = [];
            db.suppliers.push(action.data);
            renderSuppliers();
            message = `Đã khôi phục nhà cung cấp "${action.data.name}"`;
            break;

        case UNDO_ACTIONS.RETURN_GOODS:
            // Reverse the return: subtract stock back and remove return record
            // Handle two different data structures:
            // 1. From processReturn: action.data = { ...returnRecord, deletedInvoice } with .items array
            // 2. From checkoutReturn: action.data = { returnRecord, returnItems, exchangeItems }

            if (action.data.returnRecord) {
                // Structure from checkoutReturn (quick return mode)
                const quickReturnData = action.data;
                const quickReturnRecord = quickReturnData.returnRecord;

                // Reverse return items: subtract stock that was added back
                (quickReturnData.returnItems || []).forEach(item => {
                    const p = db.products.find(x => sameStoredId(x.id, item.id));
                    if (p) p.stock -= item.qty;
                });

                // Reverse exchange items: add stock that was subtracted
                (quickReturnData.exchangeItems || []).forEach(item => {
                    const p = db.products.find(x => sameStoredId(x.id, item.id));
                    if (p) p.stock = toFiniteNumber(p.stock) + toFiniteNumber(item.qty);
                });

                // Remove the return record
                db.returns = (db.returns || []).filter(r => !sameStoredId(r.id, quickReturnRecord.id));
                restoreCustomerPointsAfterUndoReturn(quickReturnRecord);

                // Remove related stock history entries
                db.stockHistory = (db.stockHistory || []).filter(h => !isReturnStockHistoryEntry(h, quickReturnRecord.id));

                renderHist();
                renderPos();
                renderInventory();
                renderReturnsHistory();
                message = `Đã hoàn tác đổi/trả hàng #${String(quickReturnRecord.id ?? '').slice(-6)}`;
            } else {
                // Structure from processReturn (modal return)
                const returnRecord = action.data;
                (returnRecord.returnItems || returnRecord.items || []).forEach(item => {
                    const p = db.products.find(x => sameStoredId(x.id, item.id));
                    if (p) p.stock -= item.qty; // Subtract stock that was added back
                });
                // Reverse exchange items if present
                if (returnRecord.isExchange && returnRecord.exchangeItems) {
                    returnRecord.exchangeItems.forEach(item => {
                        const p = db.products.find(x => sameStoredId(x.id, item.id));
                        if (p) p.stock += item.qty;
                    });
                }
                // Remove the return record
                db.returns = (db.returns || []).filter(r => !sameStoredId(r.id, returnRecord.id));
                restoreCustomerPointsAfterUndoReturn(returnRecord);

                // Remove related stock history entries
                db.stockHistory = (db.stockHistory || []).filter(h => !isReturnStockHistoryEntry(h, returnRecord.id));

                // If invoice was deleted due to full return, restore it
                restoreReturnDeletedInvoice(returnRecord);
                renderHist();
                renderPos();
                renderInventory();
                renderReturnsHistory();
                message = `Đã hoàn tác trả hàng đơn #${String(returnRecord.id ?? '').slice(-6)}`;
            }
            break;

        case UNDO_ACTIONS.DELETE_PURCHASE_ORDER:
            if (!db.purchaseOrders) db.purchaseOrders = [];
            const restoredPO = action.data.po;
            db.purchaseOrders.unshift(restoredPO);
            // If stock was reverted during deletion, restore it
            if (action.data.stockReverted) {
                restoredPO.items.forEach(item => {
                    const p = db.products.find(x => sameStoredId(x.id, item.productId));
                    if (p) p.stock += item.qty;
                });
                // Re-add stock history entries for the PO
                restoredPO.items.forEach(item => {
                    const p = db.products.find(x => sameStoredId(x.id, item.productId));
                    if (p) {
                        db.stockHistory.unshift({
                            id: Date.now() + Math.random(),
                            date: restoredPO.date,
                            type: 'in',
                            productId: item.productId,
                            productName: item.productName,
                            qty: item.qty,
                            price: item.price,
                            total: item.total,
                            note: `Nhập hàng - ${restoredPO.code} (khôi phục)`,
                            user: restoredPO.user || '',
                            source: 'purchase_order',
                            purchaseOrderId: restoredPO.id
                        });
                    }
                });
            }
            renderPOHistory();
            renderInventory();
            renderManagement();
            message = `Đã khôi phục đơn nhập ${restoredPO.code}`;
            break;

        default:
            message = 'Đã hoàn tác thao tác';
    }

    if (!saveNow()) {
        db = JSON.parse(dbSnapshot);
        undoStack.splice(0, undoStack.length, ...undoSnapshot);
        ['renderPos', 'renderInventory', 'renderManagement', 'renderHist', 'renderCustTable', 'renderSuppliers', 'renderPOHistory', 'renderReturnsHistory']
            .forEach(name => { if (typeof globalThis[name] === 'function') globalThis[name](); });
        toast('Không thể hoàn tác vì dữ liệu chưa được lưu. Dữ liệu hiện tại vẫn được giữ.', 'error');
        return;
    }
    showToast(message, 'success');
}

function showLoading(msg = 'Đang xử lý...') {
    let overlay = $('loading-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loading-overlay';
        overlay.innerHTML = '<div class="loading-spinner"></div><div class="loading-text"></div>';
        document.body.appendChild(overlay);
    }
    overlay.querySelector('.loading-text').textContent = msg;
    overlay.style.display = 'flex';
}
function hideLoading() {
    const overlay = $('loading-overlay');
    if (overlay) overlay.style.display = 'none';
}

function showToast(message, type = 'info', dedupe = true) {
    // Deduplication: if message already shown in this session, skip
    // Use product-generic key for stock warnings (normalize the key)
    let dedupeKey = message;
    // Normalize stock-related messages to prevent duplicates for same product
    const stockPatterns = [
        /Bán âm kho: .+ \(Tồn: [\-\d]+\)/,
        /Vượt tồn kho: .+ \(Tồn: [\-\d]+, Bán: \d+\)/
    ];
    for (const pattern of stockPatterns) {
        if (pattern.test(message)) {
            // Extract product name only for deduplication
            dedupeKey = message.replace(/\(Tồn: [\-\d]+(?:, Bán: \d+)?\)/, '(stock_warning)');
            break;
        }
    }

    if (dedupe && shownToastMessages.has(dedupeKey)) {
        return; // Already shown this message in current session
    }

    if (dedupe) {
        shownToastMessages.add(dedupeKey);
    }

    // Remove existing toast
    const existingToast = document.querySelector('.undo-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = 'undo-toast';
    toast.style.cssText = `
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        background: ${type === 'success' ? 'var(--success)' : type === 'warning' ? 'var(--warning)' : 'var(--primary)'};
        color: white; padding: 12px 24px; border-radius: 8px; font-weight: 600;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 10000;
        animation: slideUp 0.3s ease;
    `;
    toast.innerHTML = `<span style="margin-right:8px">↩️</span>${escapeHtml(message)}`;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}



// Debounced search functions for performance
const debouncedProdSearch = debounce(() => { prodTablePage = 0; renderProdTable(); }, 150);
const debouncedCustSearch = debounce(() => renderCustTable(), 150);
const debouncedPosSearch = debounce((val) => handleSearch({ target: { value: val } }), 100);

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

function isValidAdminAccount(user) {
    return user?.role === 'admin' &&
        typeof user.user === 'string' && user.user.trim() &&
        typeof user.pass === 'string' && user.pass.trim();
}

function hasValidAdminAccount(users) {
    return Array.isArray(users) && users.some(isValidAdminAccount);
}

function normalizeDataShape(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Dữ liệu không phải object JSON hợp lệ');
    }

    const knownKeys = ['products', 'users', 'custs', 'invoices', 'settings', 'categories'];
    if (!knownKeys.some(key => Object.prototype.hasOwnProperty.call(raw, key))) {
        throw new Error('File không có cấu trúc dữ liệu POS');
    }

    const base = cloneDefaultData();
    const normalized = { ...base, ...raw };
    normalized.settings = { ...base.settings, ...(raw.settings || {}) };
    normalized.settings.shortcuts = normalizeShortcutSettings((raw.settings && raw.settings.shortcuts) || {});
    normalized.drafts = { ...base.drafts, ...(raw.drafts || {}) };

    const arrayFields = ['products', 'categories', 'users', 'custs', 'invoices', 'suppliers', 'stockHistory', 'returns', 'activityLog', 'purchaseOrders'];
    arrayFields.forEach(field => {
        if (!Array.isArray(normalized[field])) {
            normalized[field] = Array.isArray(base[field]) ? [...base[field]] : [];
        }
    });

    ['invoices', 'purchaseOrders', 'products'].forEach(field => {
        if (!Array.isArray(normalized.drafts[field])) normalized.drafts[field] = [];
    });

    if (normalized.users.length === 0) normalized.users = [...base.users];
    if (normalized.custs.length === 0) normalized.custs = [...base.custs];
    if (!hasValidAdminAccount(normalized.users)) {
        throw new Error('Dữ liệu không có tài khoản admin hợp lệ');
    }
    return normalized;
}

function loadJsonDataText(text) {
    if (!text || !text.trim()) throw new Error('File dữ liệu rỗng');
    return normalizeDataShape(JSON.parse(text));
}

function listBackupFiles() {
    const result = desktop?.data?.listBackups?.();
    return result?.ok ? result.backups || [] : [];
}

function loadLatestValidBackup(backups = []) {
    for (const backup of backups) {
        try {
            if (typeof backup.text !== 'string') continue;
            return { data: loadJsonDataText(backup.text), id: backup.id || backup.name };
        } catch (e) {
            console.warn('Invalid backup skipped:', backup.id || backup.name, e);
        }
    }
    return null;
}

function loadPersistedData() {
    const result = { data: null, source: 'default', recoveredFrom: '', needsPrimaryRewrite: false, saveBlocked: false, errors: [] };
    const stored = desktop?.data?.load?.();
    if (stored?.ok) {
        const primaryExists = stored.primary?.exists === true;
        if (primaryExists) {
            try {
                result.data = loadJsonDataText(stored.primary.text);
                result.source = 'primary';
                return result;
            } catch (e) { result.errors.push(`data.json: ${e.message}`); }
        }
        if (stored.backup?.exists) {
            try {
                result.data = loadJsonDataText(stored.backup.text);
                result.source = 'data-bak';
                result.recoveredFrom = 'data.json.bak';
                result.needsPrimaryRewrite = true;
                return result;
            } catch (e) { result.errors.push(`data.json.bak: ${e.message}`); }
        }
        const backup = loadLatestValidBackup(stored.backups || []);
        if (backup) {
            result.data = backup.data;
            result.source = 'backup';
            result.recoveredFrom = backup.id;
            result.needsPrimaryRewrite = true;
            return result;
        }
        if (primaryExists) {
            result.saveBlocked = true;
            result.errors.push('Không tìm thấy bản backup hợp lệ để phục hồi');
            return result;
        }
    }
    const local = localStorage.getItem('pos_pro_v10');
    if (local) {
        try {
            result.data = normalizeDataShape(JSON.parse(local));
            result.source = 'localStorage';
            result.needsPrimaryRewrite = hasDesktopStorage();
            return result;
        } catch (e) { result.errors.push(`localStorage: ${e.message}`); }
    }
    result.data = cloneDefaultData();
    return result;
}

function getBackupIntervalMs(value = db.settings.backupInterval) {
    const intervals = {
        hourly: 60 * 60 * 1000,
        every2h: 2 * 60 * 60 * 1000,
        every6h: 6 * 60 * 60 * 1000,
        daily: 24 * 60 * 60 * 1000
    };
    return intervals[value] || intervals.daily;
}

function shouldBackupNow() {
    if (!db.settings.lastBackupAt) return true;
    const last = new Date(db.settings.lastBackupAt).getTime();
    if (!Number.isFinite(last)) return true;
    return Date.now() - last >= getBackupIntervalMs();
}

function getBackupLimit(value = db.settings.backupLimit) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 60;
    return Math.min(1000, Math.max(3, parsed));
}

// AUTO BACKUP TIMER
function setupAutoBackup() {
    if (backupTimer) {
        clearInterval(backupTimer);
        backupTimer = null;
    }
    if (!db.settings.autoBackup || !hasDesktopStorage() || saveBlockedReason) return;

    const interval = getBackupIntervalMs();
    backupTimer = setInterval(() => {
        performBackup({ force: true, reason: 'scheduled' });
    }, interval);
    console.log('Auto backup scheduled:', db.settings.backupInterval);
}


// INIT
async function initDataPath() { return hasDesktopStorage(); }

async function init() {
    await initDataPath();
    try {
        const loadResult = loadPersistedData();
        db = loadResult.data || cloneDefaultData();
        dataLoadStatus = loadResult.source;
        lastDataLoadError = loadResult.errors.join(' | ') || null;
        saveBlockedReason = loadResult.saveBlocked ? `Không thể tải dữ liệu hiện tại. ${lastDataLoadError || ''}` : '';

        if (!saveBlockedReason && typeof migrateLegacyOrderDrafts === 'function') migrateLegacyOrderDrafts();

        if (loadResult.recoveredFrom) {
            console.warn('Data recovered from:', loadResult.recoveredFrom);
        }

        if (loadResult.needsPrimaryRewrite && !saveBlockedReason) {
            const keepBak = !loadResult.recoveredFrom;
            if (!saveNow({ keepBak })) {
                saveBlockedReason = 'Không thể ghi lại dữ liệu đã phục hồi. Dữ liệu gốc và backup vẫn được giữ nguyên.';
            }
        }
    } catch (e) {
        console.error("Init error:", e);
        lastDataLoadError = e.message;
        db = cloneDefaultData();
        saveBlockedReason = hasDesktopStorage()
            ? `Không thể tải dữ liệu hiện tại. ${e.message}`
            : '';
    }

    currUser = null;
    isAuthenticated = false;
    updateAuthPanel();
    if (db.settings.autoBackup && hasDesktopStorage() && !saveBlockedReason && dataLoadStatus !== 'default' && shouldBackupNow()) {
        performBackup({ force: true, reason: 'startup-due' });
    }
    setupAutoBackup();
    applyTheme(db.settings.theme, false); // Don't save during init
    applyUISize(db.settings.uiSize || 'medium');
    renderNav();
    cust = db.custs[0] || defaultData.custs[0];

    // NOTE: Global keyboard shortcuts are now handled by handleGlobalShortcuts()
    // Re-enabled for F1-F12 shortcuts to work properly
    setupGlobalShortcuts();

    // Setup Enter key handlers for modals
    setupEnterKeyHandlers();

    // Setup dropdown keyboard navigation (Arrow keys + Enter)
    setupDropdownKeyboardNav();
    setupPOSKeyboardNav();
    setupClickOutsideToClearSelection();

    // Apply saved view mode
    applyViewMode();

    // Setup POS cart resizer (drag to resize cart panel)
    initPosResizer();

    // Populate year options in all period selects
    populateYearOptions();
    if (isLoginDisabled()) {
        if (signInAsDefaultAdmin({ showError: true })) {
            setTimeout(() => {
                if (isAuthenticated && isLoginDisabled()) router('pos');
            }, 0);
        } else {
            showLoginModal();
        }
    } else {
        showLoginModal();
    }
}

// Auto-detect years with data and add to all period/filter selects
function populateYearOptions() {
    const currentYear = getAppDate().getFullYear();

    // Find earliest year from all data sources (single-pass)
    let earliestYear = currentYear;
    const sources = [db.invoices, db.purchaseOrders, db.stockHistory, db.returns];
    for (const arr of sources) {
        for (const item of arr) {
            if (item.date) {
                const y = new Date(item.date).getFullYear();
                if (y > 2000 && y <= currentYear && y < earliestYear) earliestYear = y;
            }
        }
    }

    // Build year options for years before current year
    const yearOptions = [];
    for (let y = currentYear - 1; y >= earliestYear; y--) {
        yearOptions.push(`<option value="year-${y}">Năm ${y}</option>`);
    }
    // If no past data yet, still add option for last year so user knows it's possible
    if (yearOptions.length === 0 && currentYear > 2024) {
        yearOptions.push(`<option value="year-${currentYear - 1}">Năm ${currentYear - 1}</option>`);
    }

    const yearOptionsHtml = yearOptions.join('');

    // Add to all period selects
    ['report-period', 'staff-period'].forEach(id => {
        const sel = $(id);
        if (sel && yearOptionsHtml) {
            // Check if already added
            if (!sel.querySelector('option[value^="year-"]')) {
                sel.insertAdjacentHTML('beforeend', yearOptionsHtml);
            }
        }
    });

    // Add "Năm trước" button to all date filter menus
    document.querySelectorAll('[id$="-date-filter-menu"]').forEach(menu => {
        if (!menu.querySelector('.year-preset-added')) {
            const prefix = menu.id.replace('-date-filter-menu', '');
            // Find the year button to insert after
            const yearBtn = Array.from(menu.querySelectorAll('.date-preset-btn')).find(b => b.textContent.trim().startsWith('Năm'));
            if (yearBtn) {
                const prevYearBtn = document.createElement('button');
                prevYearBtn.className = 'date-preset-btn year-preset-added';
                prevYearBtn.textContent = 'Năm trước';
                prevYearBtn.onclick = () => setDatePreset(prefix, 'prev-year');
                yearBtn.insertAdjacentElement('afterend', prevYearBtn);
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTER KEY HANDLERS FOR MODAL FORMS
// ═══════════════════════════════════════════════════════════════════════════

function setupEnterKeyHandlers() {
    // Modal configurations: [modalId, saveFunction, excludedInputIds]
    const modalConfigs = [
        ['prod-modal', saveProd, []],
        ['cust-modal', saveCust, []],
        ['user-modal', saveUser, []],
        ['supplier-modal', saveSupplier, []],
        ['debt-modal', saveDebt, []],
        ['stock-in-modal', saveStockIn, ['si-product-search']],
        ['stock-out-modal', saveStockOut, ['so-product-search']],
        ['inventory-check-modal', saveInventoryCheck, []]
    ];

    document.addEventListener('keydown', function (e) {
        // Only respond to Enter key
        if (e.key !== 'Enter') return;

        // Skip if on textarea (allow Enter for new lines)
        if (e.target.tagName === 'TEXTAREA') return;

        // Check each modal configuration
        for (const [modalId, saveFunc, excludedInputs] of modalConfigs) {
            const modal = $(modalId);
            if (!modal || !modal.classList.contains('active')) continue;

            // Skip if in excluded input (like search fields)
            if (excludedInputs.includes(e.target.id)) continue;

            // Skip if in dropdown list (product search dropdown)
            if (e.target.closest('.dropdown-list') || e.target.closest('.po-product-list')) continue;

            // Prevent form submission and call save function
            e.preventDefault();
            saveFunc();
            return;
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// KEYBOARD NAVIGATION FOR PRODUCT SEARCH DROPDOWNS
// Arrow Up/Down to navigate, Enter to select
// ═══════════════════════════════════════════════════════════════════════════

let dropdownSelectedIndex = -1;

function setupDropdownKeyboardNav() {
    // Dropdown configurations: [inputId, listId, itemSelector, selectFunction, quickAddSelector]
    const dropdownConfigs = [
        {
            inputId: 'po-product-search',
            listId: 'po-product-list',
            itemSelector: '.po-product-item',
            quickAddSelector: '.po-quick-add-header',
            getSelectAction: (item) => {
                const onclick = item.getAttribute('onclick');
                if (onclick) {
                    const match = onclick.match(/addProductToPO\((\d+)\)/);
                    if (match) return () => addProductToPO(parseInt(match[1]));
                    if (onclick.includes('openQuickAddProductFromPO')) {
                        const searchVal = $('po-product-search')?.value || '';
                        return () => openQuickAddProductFromPO(searchVal);
                    }
                }
                return null;
            }
        },
        {
            inputId: 'si-product-search',
            listId: 'si-product-list',
            itemSelector: '.si-product-item',
            getSelectAction: (item) => {
                const onclick = item.getAttribute('onclick');
                if (onclick) {
                    const match = onclick.match(/selectStockInProduct\((\d+)\)/);
                    if (match) return () => selectStockInProduct(parseInt(match[1]));
                }
                return null;
            }
        },
        {
            inputId: 'so-product-search',
            listId: 'so-product-list',
            itemSelector: '.so-product-item',
            getSelectAction: (item) => {
                const onclick = item.getAttribute('onclick');
                if (onclick) {
                    const match = onclick.match(/selectStockOutProduct\((\d+)\)/);
                    if (match) return () => selectStockOutProduct(parseInt(match[1]));
                }
                return null;
            }
        }
    ];

    document.addEventListener('keydown', function (e) {
        // Only handle arrow keys and Enter
        if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;

        // Find active dropdown config based on focused input
        const activeConfig = dropdownConfigs.find(config => {
            const input = $(config.inputId);
            return input && document.activeElement === input;
        });

        if (!activeConfig) return;

        const listEl = $(activeConfig.listId);
        if (!listEl || listEl.style.display === 'none') return;

        // Get all selectable items
        let items = Array.from(listEl.querySelectorAll(activeConfig.itemSelector));
        if (activeConfig.quickAddSelector) {
            const quickAdd = listEl.querySelector(activeConfig.quickAddSelector);
            if (quickAdd) items = [quickAdd, ...items]; // Quick add at top
        }

        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            dropdownSelectedIndex = Math.min(dropdownSelectedIndex + 1, items.length - 1);
            highlightDropdownItem(items, dropdownSelectedIndex);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            dropdownSelectedIndex = Math.max(dropdownSelectedIndex - 1, 0);
            highlightDropdownItem(items, dropdownSelectedIndex);
        } else if (e.key === 'Enter') {
            if (dropdownSelectedIndex >= 0 && dropdownSelectedIndex < items.length) {
                e.preventDefault();
                const selectedItem = items[dropdownSelectedIndex];
                const action = activeConfig.getSelectAction(selectedItem);
                if (action) {
                    dropdownSelectedIndex = -1;
                    action();
                }
            }
        }
    });

    // Reset selection when input changes
    dropdownConfigs.forEach(config => {
        const input = $(config.inputId);
        if (input) {
            input.addEventListener('input', () => {
                dropdownSelectedIndex = -1;
            });
        }
    });
}

function highlightDropdownItem(items, index) {
    // Remove highlight from all items
    items.forEach(item => item.setAttribute('data-selected', 'false'));

    // Highlight selected item
    if (index >= 0 && index < items.length) {
        items[index].setAttribute('data-selected', 'true');
        items[index].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

// POS Grid keyboard navigation
let posSelectedIndex = -1;
let posSelectedProductId = null; // Track product ID for reliable selection
let skipNextSelectionReset = false; // Flag to skip reset after Enter action (prevents index reset bug)
let isNavigatingProducts = false; // Flag to track active navigation state
let lastNavigationTime = 0; // Timestamp of last arrow key press
const NAVIGATION_DEBOUNCE_MS = 100; // Minimum time between navigation and auto-add

function setupPOSKeyboardNav() {
    // NOTE: Arrow keys and Enter are now handled by handleSearchKey() in the input's onkeydown
    // This function only resets selection when search input changes via other means

    // Reset selection when search changes via paste or other input methods
    const posSearch = $('pos-search');
    if (posSearch) {
        posSearch.addEventListener('input', () => {
            // Don't reset here - handleSearchInput handles this
        });
    }
}

function highlightPOSCard(cards, index) {
    const grid = $('pos-grid');
    if (!grid) return;

    // STEP 1: ALWAYS clear ALL cards first (critical - prevents multi-selection)
    grid.querySelectorAll('.p-card').forEach(card => {
        card.setAttribute('data-selected', 'false');
    });

    // STEP 2: Only highlight ONE card if valid index
    if (cards && index >= 0 && index < cards.length && cards[index]) {
        cards[index].setAttribute('data-selected', 'true');
        cards[index].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

// Clear selection when clicking on empty area (not on product cards)
function setupClickOutsideToClearSelection() {
    document.addEventListener('click', function (e) {
        // Only clear if click is in pos-left area but NOT on a product card
        const posLeft = document.querySelector('.pos-left');
        const grid = $('pos-grid');
        if (!posLeft || !grid) return;

        // Check if click is within pos-left
        if (!posLeft.contains(e.target)) return;

        // Check if click is on a product card - if so, don't clear
        if (e.target.closest('.p-card')) return;

        // Click is on empty area - clear selection
        if (posSelectedIndex >= 0) {
            posSelectedIndex = -1;
            posSelectedProductId = null;
            isNavigatingProducts = false; // Reset navigation state
            const cards = Array.from(grid.querySelectorAll('.p-card'));
            highlightPOSCard(cards, -1);
        }
    });
}

// Clear POS selection when clicking on empty area (called from onclick)
function clearPOSSelection(event) {
    // Only clear if click is NOT on a product card
    if (event.target.closest('.p-card')) return;

    // Clear keyboard selection state (System 1: data-selected)
    posSelectedIndex = -1;
    posSelectedProductId = null;

    // Also clear keyboard focus state (System 2: keyboard-focused) to prevent dual-highlight bug
    if (typeof focusedProductIndex !== 'undefined') {
        focusedProductIndex = -1;
    }

    const grid = $('pos-grid');
    if (grid) {
        grid.querySelectorAll('.p-card').forEach(card => {
            card.setAttribute('data-selected', 'false');
            card.classList.remove('keyboard-focused');
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCT VIEW MODE (Grid / List / Details)
// ═══════════════════════════════════════════════════════════════════════════

// NOTE: setViewMode() is defined at line ~271 with full implementation

function applyViewMode() {
    const grid = $('pos-grid');
    const toggleBtns = document.querySelectorAll('.view-btn');

    if (!grid) return;

    // Remove all view mode classes
    grid.classList.remove('grid-view', 'list-view', 'details-view', 'view-grid', 'view-list', 'view-details');

    // Add current view mode class
    grid.classList.add(`${currentViewMode}-view`, `view-${currentViewMode}`);

    // Update toggle button states
    toggleBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === currentViewMode);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// POS CART RESIZER - Drag to resize cart panel width
// ═══════════════════════════════════════════════════════════════════════════

function initPosResizer() {
    const resizer = $('pos-resizer');
    const posRight = document.querySelector('.pos-right');
    const posView = $('pos-view');

    if (!resizer || !posRight) return;

    // Restore saved width from localStorage
    const savedWidth = localStorage.getItem('pos-cart-width');
    if (savedWidth) {
        const width = parseInt(savedWidth);
        if (width >= 350 && width <= 900) {
            posRight.style.width = width + 'px';
        }
    }

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    // Mouse down on resizer - start resizing
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = posRight.offsetWidth;
        resizer.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    // Mouse move - resize cart panel
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        // Calculate new width (dragging left = increase width, dragging right = decrease width)
        const deltaX = startX - e.clientX;
        let newWidth = startWidth + deltaX;

        // Constrain to min/max bounds
        const minWidth = 350;
        const maxWidth = 900;
        newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

        posRight.style.width = newWidth + 'px';
    });

    // Mouse up - stop resizing and save width
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            // Save width to localStorage
            localStorage.setItem('pos-cart-width', posRight.offsetWidth);
        }
    });

    // Touch support for mobile/tablet
    resizer.addEventListener('touchstart', (e) => {
        isResizing = true;
        startX = e.touches[0].clientX;
        startWidth = posRight.offsetWidth;
        resizer.classList.add('resizing');
        e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        if (!isResizing) return;
        const deltaX = startX - e.touches[0].clientX;
        let newWidth = startWidth + deltaX;
        newWidth = Math.max(350, Math.min(900, newWidth));
        posRight.style.width = newWidth + 'px';
    }, { passive: true });

    document.addEventListener('touchend', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('resizing');
            localStorage.setItem('pos-cart-width', posRight.offsetWidth);
        }
    });
}

// GLOBAL KEYBOARD SHORTCUTS HANDLER
function setupGlobalShortcuts() {
    // Use capture phase (true) to intercept keys before browser defaults (F2 = rename in Windows)
    document.addEventListener('keydown', handleGlobalShortcuts, true);
}

function matchesShortcut(combo, event) {
    if (!combo) return false;
    if (combo === '+') return event.key === '+' || event.key === '=';
    if (combo === '-') return event.key === '-' || event.key === '_';
    const parts = combo.split('+');
    const keyPart = parts[parts.length - 1];
    const eventKey = event.key?.length === 1 ? event.key.toUpperCase() : event.key;
    const expectedKey = keyPart.length === 1 ? keyPart.toUpperCase() : keyPart;
    // macOS Option+number emits a symbol in event.key but preserves DigitN in event.code.
    const altDigitMatch = parts.includes('Alt') && /^\d$/.test(expectedKey) && event.code === `Digit${expectedKey}`;
    return (eventKey === expectedKey || altDigitMatch) &&
        event.altKey === parts.includes('Alt') &&
        event.ctrlKey === parts.includes('Ctrl') &&
        event.shiftKey === parts.includes('Shift');
}


function isLoginModalActive() {
    return $('login-modal')?.classList.contains('active') === true;
}

function showLoginModal() {
    currUser = null;
    isAuthenticated = false;
    updateAuthPanel();
    renderNav();
    const modal = $('login-modal');
    if (modal) modal.classList.add('active');
    setTimeout(() => $('log-u')?.focus(), 50);
}

function handleGlobalShortcuts(e) {
    const key = e.key;
    const isCtrl = e.ctrlKey;
    const isAlt = e.altKey;
    const shortcuts = db.settings?.shortcuts || {};
    const consumeShortcut = () => {
        e.preventDefault();
        e.stopPropagation();
    };

    if (!isAuthenticated || isLoginModalActive()) {
        if (isLoginModalActive() && key === 'Enter') {
            consumeShortcut();
            login();
        } else if (isLoginModalActive() && key === 'Escape') {
            consumeShortcut();
        }
        return;
    }

    // Don't trigger shortcuts when typing in inputs (except for function keys, Ctrl, and Alt combos)
    const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    const isFunctionKey = key.startsWith('F') && key.length <= 3;

    if (isTyping && !isFunctionKey && !isCtrl && !isAlt) return;


    // Ctrl+Z - Undo last action
    if (matchesShortcut(shortcuts.undo || 'Ctrl+Z', e)) {
        consumeShortcut();
        performUndo();
        return;
    }

    // ESC - Close active modal
    if (key === 'Escape') {
        const activeModal = document.querySelector('.modal-overlay.active');
        if (activeModal) {
            // Auto-save PO draft if closing purchase-order-modal with items
            if (activeModal.id === 'purchase-order-modal' && typeof autoSavePOAsDraft === 'function') {
                autoSavePOAsDraft();
            }
            activeModal.classList.remove('active');
            consumeShortcut();
            return;
        }
    }

    // Focus search (default: F1)
    if (matchesShortcut(shortcuts.search || 'F1', e)) {
        consumeShortcut();
        const posSearch = $('pos-search');
        if (posSearch) {
            posSearch.focus();
            posSearch.select();
        }
        return;
    }

    // Clear cart (default: F2, with Electron fallback for the default key)
    const clearShortcut = shortcuts.clear || 'F2';
    if (matchesShortcut(clearShortcut, e) || (clearShortcut === 'F2' && (e.keyCode === 113 || e.code === 'F2'))) {
        consumeShortcut();
        clearCart();
        toast('🗑️ Đã xoá giỏ hàng', 'info');
        return;
    }


    // Print last invoice (default: F3)
    if (matchesShortcut(shortcuts.print || 'F3', e)) {
        consumeShortcut();
        if (db.invoices.length > 0) {
            printInv(db.invoices[0]);
        } else {
            toast("Chưa có hóa đơn nào!", "warning");
        }
        return;
    }

    // Direct Checkout (default: F4)
    if (matchesShortcut(shortcuts.pay || 'F4', e)) {
        consumeShortcut();
        directCheckout();
        return;
    }

    // NOTE: F5, F6, F7 are handled by handleKeyboardNav() with customizable shortcuts
    // F5 = Customer focus (customizable), F6 = Discount focus, F7 = Note
    // F8 = Save draft, F9 = New tab, F10 = Toggle menu, F12 = Help


    // Ctrl+S - Save
    if (matchesShortcut(shortcuts.quickSave || 'Ctrl+S', e)) {
        consumeShortcut();
        performGlobalSave();
        return;
    }

    // Ctrl+N - New (context-aware)
    if (matchesShortcut(shortcuts.newItem || 'Ctrl+N', e)) {
        consumeShortcut();
        const currentView = document.querySelector('.view.active')?.id;
        if (currentView === 'products-view') openProdModal();
        else if (currentView === 'customers-view') openCustModal();
        else if (currentView === 'staff-view') openUserModal();
        return;
    }

    // Ctrl+P - Print (newest invoice is at index 0)
    if (matchesShortcut(shortcuts.quickPrint || 'Ctrl+P', e)) {
        consumeShortcut();
        if (db.invoices.length > 0) {
            printInv(db.invoices[0]);
        } else {
            toast("Chưa có hóa đơn nào!", "warning");
        }
        return;
    }
    // ═══════════════════════════════════════════════════════════════════
    // DYNAMIC NAVIGATION SHORTCUTS (from settings)
    // ═══════════════════════════════════════════════════════════════════
    // Navigation shortcuts from settings
    const navShortcuts = {
        navPos: { route: 'pos', default: 'Alt+1' },
        navProducts: { route: 'products', default: 'Alt+2' },
        navHistory: { route: 'history', default: 'Alt+3' },
        navManagement: { route: 'management', default: 'Alt+4' },
        navCustomers: { route: 'customers', default: 'Alt+5' },
        navStaff: { route: 'staff', default: 'Alt+6' },
        navSettings: { route: 'settings', default: 'Alt+7' }
    };

    for (const [action, config] of Object.entries(navShortcuts)) {
        const combo = shortcuts[action] || config.default;
        if (matchesShortcut(combo, e)) {
            consumeShortcut();
            router(config.route);
            return;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // CUSTOM ACTION SHORTCUTS (configurable from settings)
    // ═══════════════════════════════════════════════════════════════════

    // Add Product shortcut (default: Ctrl+Shift+A) - Context-specific
    const addProductCombo = shortcuts.addProduct || defaultShortcuts.addProduct?.key || 'Ctrl+Shift+A';
    if (matchesShortcut(addProductCombo, e)) {
        const currentView = document.querySelector('.view.active')?.id;
        // Only allow in products-view or management-view
        if (currentView === 'products-view' || currentView === 'management-view') {
            consumeShortcut();
            openProdModal();
        }
        return;
    }
}

// SHORTCUTS SETTINGS MANAGEMENT
// These must match the keyboard handler in handleKeyboardNav()
const defaultShortcuts = {
    // ═══════════════════════════════════════════════════════════════════
    // POS ACTION SHORTCUTS (F1-F12)
    // ═══════════════════════════════════════════════════════════════════
    search: { key: 'F1', label: 'Tìm kiếm SP', description: 'Focus vào ô tìm kiếm sản phẩm', group: 'pos' },
    clear: { key: 'F2', label: 'Huỷ đơn hàng', description: 'Xoá giỏ hàng hiện tại', group: 'pos' },
    print: { key: 'F3', label: 'In hoá đơn cuối', description: 'In lại hoá đơn gần nhất', group: 'pos' },
    pay: { key: 'F4', label: 'Thanh toán nhanh', description: 'Thanh toán nhanh theo thông tin trong giỏ hàng', group: 'pos' },
    customer: { key: 'F5', label: 'Chọn khách hàng', description: 'Focus vào ô chọn khách hàng', group: 'pos' },
    discount: { key: 'F6', label: 'Nhập giảm giá', description: 'Focus vào ô giảm giá', group: 'pos' },
    note: { key: 'F7', label: 'Ghi chú đơn', description: 'Thêm ghi chú cho đơn hàng', group: 'pos' },
    save: { key: 'F8', label: 'Lưu nháp', description: 'Lưu đơn hàng tạm', group: 'pos' },
    newTab: { key: 'F9', label: 'Tạo tab mới', description: 'Tạo tab hoá đơn mới', group: 'pos' },
    menu: { key: 'F10', label: 'Mở/đóng menu', description: 'Toggle sidebar menu (mobile)', group: 'pos' },
    help: { key: 'F12', label: 'Trợ giúp', description: 'Hiện hướng dẫn phím tắt', group: 'pos' },
    addProduct: { key: 'Ctrl+Shift+A', label: 'Thêm SP mới', description: 'Mở form thêm sản phẩm mới', group: 'pos' },
    category: { key: '`', label: 'Chuyển danh mục', description: 'Chuyển qua danh mục tiếp theo', group: 'pos' },

    // ═══════════════════════════════════════════════════════════════════
    // CART OPERATIONS (Quick keys)
    // ═══════════════════════════════════════════════════════════════════
    cartIncrease: { key: '+', label: 'Tăng SL cuối', description: 'Tăng số lượng sản phẩm cuối giỏ', group: 'cart' },
    cartDecrease: { key: '-', label: 'Giảm SL cuối', description: 'Giảm số lượng sản phẩm cuối giỏ', group: 'cart' },
    cartDeleteLast: { key: 'Delete', label: 'Xoá SP cuối', description: 'Xoá sản phẩm cuối khỏi giỏ', group: 'cart' },
    returnGoods: { key: 'Ctrl+R', label: 'Trả hàng', description: 'Mở form trả hàng', group: 'cart' },

    // ═══════════════════════════════════════════════════════════════════
    // TAB MANAGEMENT (Chrome-style)
    // ═══════════════════════════════════════════════════════════════════
    tabNew: { key: 'Ctrl+T', label: 'Tab mới', description: 'Tạo tab hoá đơn mới', group: 'tab' },
    tabClose: { key: 'Ctrl+W', label: 'Đóng tab', description: 'Đóng tab hoá đơn hiện tại', group: 'tab' },
    tabNext: { key: 'Ctrl+Tab', label: 'Tab tiếp', description: 'Chuyển sang tab tiếp theo', group: 'tab' },
    tabPrev: { key: 'Ctrl+Shift+Tab', label: 'Tab trước', description: 'Chuyển về tab trước đó', group: 'tab' },

    // ═══════════════════════════════════════════════════════════════════
    // SYSTEM SHORTCUTS (Ctrl+key)
    // ═══════════════════════════════════════════════════════════════════
    quickSave: { key: 'Ctrl+S', label: 'Lưu nhanh', description: 'Lưu dữ liệu (theo ngữ cảnh)', group: 'system' },
    undo: { key: 'Ctrl+Z', label: 'Hoàn tác', description: 'Hoàn tác thao tác cuối', group: 'system' },
    quickPrint: { key: 'Ctrl+P', label: 'In nhanh', description: 'In hoá đơn cuối cùng', group: 'system' },
    newItem: { key: 'Ctrl+N', label: 'Tạo mới', description: 'Tạo mới (SP/KH/NV theo ngữ cảnh)', group: 'system' },

    // ═══════════════════════════════════════════════════════════════════
    // NAVIGATION SHORTCUTS (Alt+1 to Alt+7)
    // ═══════════════════════════════════════════════════════════════════
    navPos: { key: 'Alt+1', label: 'Bán hàng', description: 'Chuyển đến màn hình bán hàng', group: 'nav' },
    navProducts: { key: 'Alt+2', label: 'Hàng hoá', description: 'Chuyển đến quản lý hàng hoá', group: 'nav' },
    navHistory: { key: 'Alt+3', label: 'Lịch sử', description: 'Chuyển đến lịch sử giao dịch', group: 'nav' },
    navManagement: { key: 'Alt+4', label: 'Quản lý', description: 'Chuyển đến quản lý kho/nhập', group: 'nav' },
    navCustomers: { key: 'Alt+5', label: 'Khách hàng', description: 'Chuyển đến quản lý khách hàng', group: 'nav' },
    navStaff: { key: 'Alt+6', label: 'Nhân viên', description: 'Chuyển đến quản lý nhân viên', group: 'nav' },
    navSettings: { key: 'Alt+7', label: 'Cài đặt', description: 'Chuyển đến cài đặt', group: 'nav' }
};

let capturingShortcut = null;
let tempShortcuts = {}; // Temporary state for shortcuts before saving

function renderShortcutsSettings() {
    // Initialize temp state from saved settings
    tempShortcuts = { ...(db.settings.shortcuts || {}) };
    const grid = $('shortcuts-grid');
    if (!grid) return;

    const shortcuts = db.settings.shortcuts || {};

    // Separate shortcuts by group
    const posShortcuts = Object.entries(defaultShortcuts).filter(([_, def]) => def.group === 'pos');
    const cartShortcuts = Object.entries(defaultShortcuts).filter(([_, def]) => def.group === 'cart');
    const tabShortcuts = Object.entries(defaultShortcuts).filter(([_, def]) => def.group === 'tab');
    const systemShortcuts = Object.entries(defaultShortcuts).filter(([_, def]) => def.group === 'system');
    const navShortcuts = Object.entries(defaultShortcuts).filter(([_, def]) => def.group === 'nav');

    const renderShortcutItem = ([action, def]) => {
        const currentKey = shortcuts[action] || def.key;
        return `<div class="shortcut-item" title="${escapeAttr(def.description || '')}">
            <span class="shortcut-label">${escapeHtml(def.label)}</span>
            <input type="text" class="shortcut-key" 
                data-action="${escapeAttr(action)}" 
                value="${escapeAttr(currentKey)}" 
                readonly
                onclick="startCaptureShortcut(this)"
                onkeydown="captureShortcut(event, this)"
                onblur="stopCaptureShortcut(this)">
        </div>`;
    };

    grid.innerHTML = `
        <div class="shortcuts-group">
            <h4 class="shortcuts-group-title">🎯 Phím chức năng POS</h4>
            <div class="shortcuts-group-items">
                ${posShortcuts.map(renderShortcutItem).join('')}
            </div>
        </div>
        <div class="shortcuts-group">
            <h4 class="shortcuts-group-title">🛒 Thao tác giỏ hàng</h4>
            <div class="shortcuts-group-items">
                ${cartShortcuts.map(renderShortcutItem).join('')}
            </div>
        </div>
        <div class="shortcuts-group">
            <h4 class="shortcuts-group-title">📑 Quản lý Tab hoá đơn</h4>
            <div class="shortcuts-group-items">
                ${tabShortcuts.map(renderShortcutItem).join('')}
            </div>
        </div>
        <div class="shortcuts-group">
            <h4 class="shortcuts-group-title">⚡ Phím tắt hệ thống</h4>
            <div class="shortcuts-group-items">
                ${systemShortcuts.map(renderShortcutItem).join('')}
            </div>
        </div>
        <div class="shortcuts-group">
            <h4 class="shortcuts-group-title">🧭 Điều hướng menu</h4>
            <div class="shortcuts-group-items">
                ${navShortcuts.map(renderShortcutItem).join('')}
            </div>
        </div>
    `;
}

function startCaptureShortcut(input) {
    capturingShortcut = input.dataset.action;
    input.classList.add('capturing');
    input.value = '...';
}

function stopCaptureShortcut(input) {
    if (input.classList.contains('capturing')) {
        const action = input.dataset.action;
        const shortcuts = db.settings.shortcuts || {};
        input.value = shortcuts[action] || defaultShortcuts[action]?.key || 'F1';
        input.classList.remove('capturing');
    }
    capturingShortcut = null;
}

function captureShortcut(e, input) {
    if (!input.classList.contains('capturing')) return;
    e.preventDefault();
    e.stopPropagation();

    const key = e.key;
    if (key === 'Escape') {
        stopCaptureShortcut(input);
        return;
    }

    // Build key combo string
    let combo = '';
    if (e.ctrlKey) combo += 'Ctrl+';
    if (e.altKey) combo += 'Alt+';
    if (e.shiftKey) combo += 'Shift+';

    // Only capture valid keys
    const validKeys = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
        '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

    const keyUpper = key.toUpperCase();
    if (validKeys.includes(key) || validKeys.includes(keyUpper)) {
        combo += key.startsWith('F') ? key : keyUpper;

        const action = input.dataset.action;

        // Check for duplicate keys
        const existingAction = Object.entries(tempShortcuts).find(([act, k]) => k === combo && act !== action);
        if (existingAction) {
            const existingLabel = defaultShortcuts[existingAction[0]]?.label || existingAction[0];
            toast(`⚠️ Phím "${combo}" đã được dùng cho "${existingLabel}"!`, 'warning');
            stopCaptureShortcut(input);
            return;
        }

        // Save to temp state only (not persisted until user clicks Save)
        tempShortcuts[action] = combo;

        input.value = combo;
        input.classList.remove('capturing');
        capturingShortcut = null;
        toast(`Đã chọn phím: ${combo} (nhấn Lưu để áp dụng)`, 'info');
    }
}

function resetShortcuts() {
    if (!canMutateSettings()) return;
    if (confirm('Khôi phục tất cả phím tắt về mặc định?')) {
        const previousShortcuts = { ...(db.settings.shortcuts || {}) };
        db.settings.shortcuts = {};
        Object.entries(defaultShortcuts).forEach(([action, def]) => {
            db.settings.shortcuts[action] = def.key;
        });
        if (!saveNow()) {
            db.settings.shortcuts = previousShortcuts;
            return;
        }
        renderShortcutsSettings();
        toast('Đã khôi phục phím tắt mặc định!');
    }
}

function saveShortcuts() {
    if (!canMutateSettings()) return;
    // Persist temp shortcuts to db
    const previousShortcuts = { ...(db.settings.shortcuts || {}) };
    db.settings.shortcuts = { ...tempShortcuts };
    if (!saveNow()) {
        db.settings.shortcuts = previousShortcuts;
        return;
    }
    // Update all UI labels with new shortcuts
    updateShortcutLabels();
    toast('✓ Đã lưu cấu hình phím tắt!');
}

// Update all shortcut labels in the UI dynamically
function updateShortcutLabels() {
    const shortcuts = db.settings?.shortcuts || {};

    // Define UI elements that need shortcut labels updated
    const labelMappings = [
        { id: 'btn-clear-cart', action: 'clear', icon: '❌ Hủy', defaultKey: 'F2' },
        { id: 'btn-payment', action: 'pay', icon: '✅ Thanh toán', defaultKey: 'F4' },
    ];

    labelMappings.forEach(({ id, action, icon, defaultKey }) => {
        const btn = $(id);
        if (btn) {
            const key = shortcuts[action] || defaultKey;
            btn.innerHTML = `${icon} (<span class="shortcut-key">${escapeHtml(key)}</span>)`;
        }
    });

    // Update any other shortcut labels with class="shortcut" 
    // These are found in help text and tips throughout the app
    document.querySelectorAll('[data-shortcut-action]').forEach(el => {
        const action = el.dataset.shortcutAction;
        if (action && defaultShortcuts[action]) {
            el.textContent = shortcuts[action] || defaultShortcuts[action].key;
        }
    });
}

// GLOBAL SAVE - Detects active modal/context and saves appropriately
function performGlobalSave() {
    // Check for active modals first
    const prodModal = $('prod-modal');
    const custModal = $('cust-modal');
    const userModal = $('user-modal');
    const supplierModal = $('supplier-modal');
    const stockInModal = $('stock-in-modal');
    const stockOutModal = $('stock-out-modal');
    const poModal = $('purchase-order-modal');

    if (prodModal?.classList.contains('active')) {
        saveProd();
        return;
    }
    if (custModal?.classList.contains('active')) {
        saveCust();
        return;
    }
    if (userModal?.classList.contains('active')) {
        saveUser();
        return;
    }
    if (supplierModal?.classList.contains('active')) {
        saveSupplier();
        return;
    }
    if (stockInModal?.classList.contains('active')) {
        saveStockIn();
        return;
    }
    if (stockOutModal?.classList.contains('active')) {
        saveStockOut();
        return;
    }
    if (poModal?.classList.contains('active')) {
        savePurchaseOrder();
        return;
    }

    // Check current view for context-aware save
    const currentView = document.querySelector('.view.active')?.id;
    if (currentView === 'settings-view') {
        saveSets();
        return;
    }

    if (saveNow()) toast("✓ Dữ liệu đã được lưu!", "success");
}

function applyTheme(theme, persist = false) {
    const previousTheme = db?.settings?.theme;
    if (!theme) theme = 'light';
    document.body.setAttribute('data-theme', theme);
    if ($('set-theme')) $('set-theme').value = theme;

    // Save theme to settings when changed by user
    if (persist && db && db.settings) {
        db.settings.theme = theme;
        if (!saveNow()) {
            db.settings.theme = previousTheme;
            document.body.setAttribute('data-theme', previousTheme || 'light');
            if ($('set-theme')) $('set-theme').value = previousTheme || 'light';
            return;
        }
    }

    redrawVisibleChartsForTheme();
}

function redrawVisibleChartsForTheme() {
    const activeViewId = document.querySelector('.view.active')?.id;

    try {
        if (activeViewId === 'management-view') {
            if (typeof drawMgmtChart === 'function') drawMgmtChart();
            if (typeof drawMgmtPieChart === 'function') drawMgmtPieChart();
        } else if (activeViewId === 'staff-view') {
            if (typeof renderStaffView === 'function') renderStaffView();
        } else if (activeViewId === 'reports-view') {
            if (typeof drawRevenueChart === 'function') drawRevenueChart();
            if (typeof drawPieChart === 'function') drawPieChart();
        }
    } catch (e) { console.warn('Chart redraw on theme change:', e); }
}

function applyUISize(size, persist = false) {
    const previousSize = db?.settings?.uiSize;
    const validSizes = ['small', 'medium', 'large'];
    if (!validSizes.includes(size)) size = 'medium';
    document.body.setAttribute('data-ui-size', size);
    if ($('set-ui-size')) $('set-ui-size').value = size;

    // Save immediately for better UX
    if (persist && db.settings) {
        db.settings.uiSize = size;
        if (!saveNow()) {
            db.settings.uiSize = previousSize;
            document.body.setAttribute('data-ui-size', previousSize || 'medium');
            if ($('set-ui-size')) $('set-ui-size').value = previousSize || 'medium';
        }
    }
}

function playSuccessSound() {
    if (!db.settings.sound) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start(); osc.stop(ctx.currentTime + 0.5);
    } catch (e) { }
}

function toBackupTimestamp(date = getAppDate()) {
    const pad = n => String(n).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('-') + '_' + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join('-');
}

function pruneOldBackups(limit = getBackupLimit()) {
    const result = desktop?.data?.cleanupBackups?.(getBackupLimit(limit));
    return result?.ok ? result.removed || 0 : 0;
}

function updateBackupStats() {
    const el = $('backup-stats');
    if (!el) return;
    if (!hasDesktopStorage()) {
        el.innerText = 'Backup file chỉ hoạt động trong ứng dụng desktop.';
        return;
    }

    try {
        const files = listBackupFiles();
        const limit = getBackupLimit();
        const latest = files[0] ? new Date(files[0].mtimeMs).toLocaleString('vi-VN') : 'Chưa có';
        el.innerText = `Hiện có ${files.length}/${limit} bản backup. Gần nhất: ${latest}.`;
        el.title = 'Backup được lưu trong dữ liệu ứng dụng NTKIOT.';
    } catch (e) {
        el.innerText = 'Không thể đọc thông tin backup.';
        logRendererEvent('backup-stats-error', { error: serializeError(e) });
    }
}

function cleanupBackupsNow() {
    if (!canMutateSettings()) return;
    if (!hasDesktopStorage()) return toast("Không thể dọn backup trong chế độ trình duyệt", "warning");
    try {
        const before = listBackupFiles().length;
        pruneOldBackups(getBackupLimit($('set-backup-limit')?.value || db.settings.backupLimit));
        const after = listBackupFiles().length;
        updateBackupStats();
        toast(`Đã dọn ${Math.max(0, before - after)} bản backup cũ`, "success");
    } catch (e) {
        console.error('Cleanup backups failed:', e);
        logRendererEvent('cleanup-backups-error', { error: serializeError(e) });
        toast("Lỗi dọn backup cũ", "error");
    }
}

function performBackup(options = {}) {
    if (!hasDesktopStorage() || saveBlockedReason) return false;
    const force = options.force === true;
    if (!force && !shouldBackupNow()) return false;

    try {
        const backup = desktop.data.createBackup(JSON.stringify(db, null, 2), getBackupLimit());
        if (!backup?.ok) return false;
        const previousLastBackupAt = db.settings.lastBackupAt;
        db.settings.lastBackupAt = getAppDate().toISOString();
        pruneOldBackups();
        updateBackupStats();
        if (!saveNow()) {
            db.settings.lastBackupAt = previousLastBackupAt;
            return false;
        }
        console.log('Backup saved:', backup.id, options.reason || 'manual');
        return true;
    } catch (e) {
        console.error("Backup failed:", e);
        return false;
    }
}

let _saveTimer = null;
let _saveInProgress = false;
let _savePending = false;
function _saveNow(options = {}) {
    if (saveSuppressed) return false;
    if (saveBlockedReason) {
        console.warn('Save blocked:', saveBlockedReason);
        if (!saveBlockedToastShown && typeof toast === 'function') {
            saveBlockedToastShown = true;
            toast("Không lưu dữ liệu mới vì file dữ liệu hiện tại bị lỗi. Hãy khôi phục từ backup.", "error");
        }
        return false;
    }

    if (!hasDesktopStorage()) {
        try {
            localStorage.setItem('pos_pro_v10', JSON.stringify(db));
            return true;
        } catch (e) {
            console.error('Local save error:', e);
            return false;
        }
    }
    if (_saveInProgress) {
        _savePending = true;
        return false;
    }
    _saveInProgress = true;
    let ok = false;
    try {
        const result = desktop.data.save(JSON.stringify(db, null, 2), { keepBak: options.keepBak !== false });
        ok = result?.ok === true;
        if (!ok) throw new Error(result?.code || 'IO_FAILED');
    } catch (e) {
        console.error('Save error:', e);
        toast("Lỗi lưu dữ liệu! Dữ liệu cũ vẫn được giữ trong data.json.bak", "error");
    } finally {
        _saveInProgress = false;
        if (_savePending) {
            _savePending = false;
            _saveNow();
        }
    }
    return ok;
}
function save() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_saveNow, 500);
}
function saveNow(options = {}) {
    if (_saveTimer) {
        clearTimeout(_saveTimer);
        _saveTimer = null;
    }
    return _saveNow(options);
}

window.addEventListener('beforeunload', () => {
    saveNow();
});

window.addEventListener('pagehide', () => {
    saveNow();
});

desktop?.onBeforeQuit?.(() => saveNow());

function logActivity(action, detail) {
    if (db.activityLog.length >= 500) db.activityLog.length = 499;
    db.activityLog.unshift({ id: Date.now(), date: getAppDate().toISOString(), user: currUser?.name || 'System', action, detail });
}

function resetApp() {
    if (!canMutateDangerSettings()) return;
    if (confirm("XÓA TOÀN BỘ DỮ LIỆU? Không thể khôi phục!")) {
        try {
            saveSuppressed = true;
            if (_saveTimer) {
                clearTimeout(_saveTimer);
                _saveTimer = null;
            }
            if (hasDesktopStorage() && !desktop.data.resetAll()?.ok) throw new Error('RESET_FAILED');
            localStorage.clear();
            sessionStorage.clear();
            location.reload();
        } catch (e) {
            saveSuppressed = false;
            console.error('Reset error:', e);
            toast("Lỗi!", "error");
        }
    }
}

// Uninstall app settings - clear settings, cache, preferences but keep business data
function uninstallAppSettings() {
    if (!canMutateDangerSettings()) return;
    const confirmMsg = `🧹 GỠ CÀI ĐẶT ỨNG DỤNG

Sẽ XÓA:
✗ Cài đặt cửa hàng (tên, địa chỉ, logo...)
✗ Giao diện và theme
✗ Phím tắt tùy chỉnh
✗ Cài đặt in ấn
✗ Cài đặt tích điểm
✗ Đơn hàng lưu tạm (drafts)
✗ Các cache khác

Sẽ GIỮ LẠI:
✓ Danh sách sản phẩm, hàng hóa
✓ Danh mục sản phẩm
✓ Khách hàng
✓ Lịch sử đơn hàng
✓ Nhà cung cấp
✓ Lịch sử kho

Tiếp tục gỡ cài đặt?`;

    if (!confirm(confirmMsg)) return;

    try {
        const previousDb = db;
        // Preserve business data and every existing account.
        const preservedData = {
            products: db.products || [],
            categories: db.categories || [],
            custs: db.custs || [],
            invoices: db.invoices || [],
            suppliers: db.suppliers || [],
            stockHistory: db.stockHistory || [],
            returns: db.returns || [],
            purchaseOrders: db.purchaseOrders || [],
            users: db.users || [],
            activityLog: [] // Clear activity log as it may contain old settings
        };

        // Reset to default structure with preserved data
        const nextDb = JSON.parse(JSON.stringify(defaultData));
        nextDb.products = preservedData.products;
        nextDb.categories = preservedData.categories;
        nextDb.custs = preservedData.custs;
        nextDb.invoices = preservedData.invoices;
        nextDb.suppliers = preservedData.suppliers;
        nextDb.stockHistory = preservedData.stockHistory;
        nextDb.returns = preservedData.returns;
        nextDb.purchaseOrders = preservedData.purchaseOrders;
        nextDb.users = preservedData.users;
        nextDb.activityLog = preservedData.activityLog;
        db = nextDb;

        // Log the uninstall action
        logActivity('Gỡ cài đặt', 'Đã xóa cài đặt và cache, giữ lại dữ liệu hàng hóa');
        if (!saveNow()) {
            db = previousDb;
            return;
        }

        // Clear additional localStorage items only after the durable commit.
        localStorage.removeItem('posViewMode');
        localStorage.removeItem('orderDrafts');

        toast("✅ Đã gỡ cài đặt thành công! Đang tải lại...", "success");

        // Reload to apply changes
        setTimeout(() => location.reload(), 1500);

    } catch (e) {
        console.error("Uninstall error:", e);
        toast("❌ Lỗi khi gỡ cài đặt!", "error");
    }
}

function exportData() {
    showLoading('Đang xuất dữ liệu...');
    const str = JSON.stringify(db, null, 2);
    const blob = new Blob([str], { type: "application/json" });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `POS_Backup_${toLocalDateStr(getAppDate())}.json`;
    a.click();
    // Clean up to prevent memory leak
    setTimeout(() => URL.revokeObjectURL(url), 100);
    hideLoading();
    toast("Đã xuất file backup!");
}

function importData() {
    if (!canMutateSettings()) return;
    const file = $('restore-file').files[0];
    if (!file) return toast("Chưa chọn file", "error");

    if (!confirm("⚠️ Khôi phục dữ liệu sẽ ghi đè toàn bộ dữ liệu hiện tại. Bạn có chắc chắn?")) {
        $('restore-file').value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);

            // Stronger validation: check if required fields are arrays
            if (!Array.isArray(data.products) || !Array.isArray(data.users)) {
                return toast("File không hợp lệ: thiếu products hoặc users", "error");
            }

            const previousDb = db;
            const previousLoadState = { saveBlockedReason, saveBlockedToastShown, dataLoadStatus };
            db = normalizeDataShape(data);

            saveBlockedReason = '';
            saveBlockedToastShown = false;
            dataLoadStatus = 'manual-import';
            if (!saveNow()) {
                db = previousDb;
                ({ saveBlockedReason, saveBlockedToastShown, dataLoadStatus } = previousLoadState);
                toast('Không thể khôi phục dữ liệu vì ghi tệp thất bại. Dữ liệu hiện tại vẫn được giữ.', 'error');
                return;
            }
            toast("Khôi phục thành công! Đang tải lại...");
            setTimeout(() => location.reload(), 1000);
        } catch (e) {
            console.error('Import error:', e);
            toast("Lỗi đọc file: " + e.message, "error");
        }
    };
    reader.readAsText(file);
}

// Toggle backup interval visibility
function toggleBackupInterval() {
    const isChecked = $('set-backup')?.checked;
    const container = $('backup-interval-container');
    if (container) {
        container.style.display = isChecked ? 'block' : 'none';
    }
}

// DATA IMPORT FROM FILE
let importedData = [];
let importColumnMap = {};

function openImportModal(type) {
    if (type === 'products' && !canMutateManagement()) return;
    $('import-modal').classList.add('active');
    $('import-type').value = type;
    $('import-file').value = '';
    $('import-preview-section').style.display = 'none';
    $('import-confirm-btn').disabled = true;
    importedData = [];
    importColumnMap = {};
}

function handleImportFile() {
    const file = $('import-file').files[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();

    reader.onload = e => {
        try {
            let data = [];
            if (ext === 'csv') {
                data = parseCSV(e.target.result);
            } else if (ext === 'json') {
                data = parseJSON(e.target.result);
            } else if (ext === 'xlsx' || ext === 'xls') {
                data = parseExcel(e.target.result);
            } else {
                return toast("Định dạng file không hỗ trợ!", "error");
            }

            if (data.length === 0) return toast("File không có dữ liệu!", "error");

            importedData = data;
            detectAndMapColumns(data);
            previewImportData(data);

        } catch (err) {
            console.error(err);
            toast("Lỗi đọc file: " + err.message, "error");
        }
    };

    if (ext === 'xlsx' || ext === 'xls') {
        reader.readAsArrayBuffer(file);
    } else {
        reader.readAsText(file);
    }
}

function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];

    const parseLine = line => {
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current.trim());
        return values;
    };

    const headers = parseLine(lines[0]);
    const data = [];

    for (let i = 1; i < lines.length; i++) {
        const values = parseLine(lines[i]);
        const row = {};
        headers.forEach((h, idx) => row[h] = values[idx] || '');
        data.push(row);
    }
    return data;
}

function parseJSON(text) {
    try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : (parsed.data || parsed.items || parsed.products || parsed.customers || []);
    } catch (e) {
        console.error('JSON parse error:', e);
        toast('Lỗi đọc file JSON', 'error');
        return [];
    }
}

function parseExcel(buffer) {
    if (!XLSX) {
        toast("Thư viện Excel không khả dụng!", "error");
        return [];
    }
    try {
        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheet = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheet];
        return XLSX.utils.sheet_to_json(worksheet);
    } catch (e) {
        console.error('Excel parse error:', e);
        toast('Lỗi đọc file Excel', 'error');
        return [];
    }
}

function detectAndMapColumns(data) {
    if (data.length === 0) return;

    const type = $('import-type').value;
    const firstRow = data[0];
    const cols = Object.keys(firstRow);

    // KiotViet and common column mappings
    const productMaps = {
        'Mã hàng': 'code', 'Mã SP': 'code', 'Mã sản phẩm': 'code', 'code': 'code', 'sku': 'code', 'SKU': 'code',
        'Tên hàng': 'name', 'Tên SP': 'name', 'Tên sản phẩm': 'name', 'name': 'name', 'ProductName': 'name',
        'Giá bán': 'price', 'Giá': 'price', 'price': 'price', 'Price': 'price', 'RetailPrice': 'price',
        'Giá vốn': 'cost', 'Giá nhập': 'cost', 'cost': 'cost', 'Cost': 'cost', 'ImportPrice': 'cost',
        'Tồn kho': 'stock', 'SL tồn': 'stock', 'Số lượng': 'stock', 'stock': 'stock', 'Stock': 'stock', 'Quantity': 'stock',
        'Nhóm hàng': 'cat', 'Danh mục': 'cat', 'Loại': 'cat', 'category': 'cat', 'Category': 'cat', 'cat': 'cat',
        'Đơn vị': 'unit', 'ĐVT': 'unit', 'unit': 'unit', 'Unit': 'unit'
    };

    const customerMaps = {
        'Tên khách hàng': 'name', 'Tên KH': 'name', 'Họ tên': 'name', 'name': 'name', 'Name': 'name', 'CustomerName': 'name',
        'Điện thoại': 'phone', 'SĐT': 'phone', 'Số điện thoại': 'phone', 'phone': 'phone', 'Phone': 'phone', 'Mobile': 'phone',
        'Địa chỉ': 'addr', 'Đ/C': 'addr', 'address': 'addr', 'Address': 'addr', 'addr': 'addr',
        'Email': 'email', 'email': 'email',
        'Nhóm KH': 'group', 'Nhóm khách': 'group', 'group': 'group', 'Group': 'group', 'CustomerGroup': 'group',
        'Ghi chú': 'note', 'note': 'note', 'Note': 'note'
    };

    const maps = type === 'products' ? productMaps : customerMaps;
    importColumnMap = {};

    cols.forEach(col => {
        if (maps[col]) importColumnMap[col] = maps[col];
    });

    // Detect format
    const isKiotViet = cols.some(c => ['Mã hàng', 'Tên hàng', 'Nhóm hàng', 'Tên khách hàng', 'Nhóm KH'].includes(c));
    $('import-format-detected').innerText = isKiotViet ? '🎯 KiotViet detected' : '📄 Standard format';

    // Display mapping
    const mappingHtml = Object.entries(importColumnMap).map(([src, dst]) =>
        `<span class="badge badge-secondary" style="margin-right:4px">${escapeHtml(src)} → ${escapeHtml(dst)}</span>`
    ).join('');
    $('import-mapping').innerHTML = mappingHtml || '<span style="color:var(--text-muted)">Không nhận dạng được cột</span>';
}

function previewImportData(data) {
    if (data.length === 0) return;

    const cols = Object.keys(data[0]);
    $('import-preview-head').innerHTML = '<tr>' + cols.map(c => `<th>${escapeHtml(c)}</th>`).join('') + '</tr>';
    $('import-preview-body').innerHTML = data.slice(0, 10).map(row =>
        '<tr>' + cols.map(c => `<td>${escapeHtml(row[c] || '')}</td>`).join('') + '</tr>'
    ).join('');

    $('import-count').innerText = data.length.toLocaleString('vi-VN');
    $('import-confirm-count').innerText = data.length.toLocaleString('vi-VN');
    $('import-preview-section').style.display = 'block';
    $('import-confirm-btn').disabled = Object.keys(importColumnMap).length === 0;
}

function confirmImport() {
    if (!canMutateManagement()) return;
    const type = $('import-type').value;
    const skipExisting = $('import-skip-existing').checked;
    const updateExisting = $('import-update-existing').checked;

    if (importedData.length === 0) return toast("Không có dữ liệu để nhập!", "error");
    if (Object.keys(importColumnMap).length === 0) return toast("Không nhận dạng được cột dữ liệu!", "error");

    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;
    const customerSnapshot = (db.custs || []).map(customer => ({ customer, values: JSON.parse(JSON.stringify(customer)) }));
    const customerList = customerSnapshot.map(({ customer }) => customer);
    showLoading('Đang nhập dữ liệu...');

    let addedCount = 0, updatedCount = 0, skippedCount = 0;

    importedData.forEach(row => {
        const mapped = {};
        Object.entries(importColumnMap).forEach(([src, dst]) => {
            mapped[dst] = row[src];
        });

        if (type === 'products') {
            // Check for existing product by code
            const mappedCode = (mapped.code || '').toString().trim();
            const existing = mappedCode ? db.products.find(p =>
                (p.code || '').trim().toLowerCase() === mappedCode.toLowerCase()
            ) : null;

            if (existing) {
                if (updateExisting) {
                    Object.assign(existing, {
                        name: mapped.name || existing.name,
                        price: parseImportedNumber(mapped.price, existing.price),
                        cost: parseImportedNumber(mapped.cost, existing.cost),
                        stock: parseImportedNumber(mapped.stock, existing.stock),
                        cat: mapped.cat || existing.cat,
                        unit: mapped.unit || existing.unit
                    });
                    updatedCount++;
                } else if (skipExisting) {
                    skippedCount++;
                }
            } else {
                // Add new product
                const newCat = mapped.cat || 'Khác';
                if (!db.categories.includes(newCat)) db.categories.push(newCat);

                db.products.push({
                    id: Date.now() + addedCount,
                    code: mappedCode,
                    name: mapped.name || 'Sản phẩm mới',
                    price: parseImportedNumber(mapped.price, 0),
                    cost: parseImportedNumber(mapped.cost, 0),
                    stock: parseImportedNumber(mapped.stock, 0),
                    cat: newCat,
                    unit: mapped.unit || '',
                    img: ''
                });
                addedCount++;
            }
        } else if (type === 'customers') {
            // Check for existing customer by phone or name
            const existing = mapped.phone ?
                db.custs.find(c => c.phone === mapped.phone) :
                db.custs.find(c => c.name === mapped.name);

            if (existing) {
                if (updateExisting) {
                    Object.assign(existing, {
                        name: mapped.name || existing.name,
                        phone: mapped.phone || existing.phone,
                        addr: mapped.addr || existing.addr,
                        email: mapped.email || existing.email,
                        group: mapped.group || existing.group,
                        note: mapped.note || existing.note
                    });
                    updatedCount++;
                } else if (skipExisting) {
                    skippedCount++;
                }
            } else {
                // Add new customer
                db.custs.push({
                    id: Date.now() + addedCount,
                    name: mapped.name || 'Khách hàng mới',
                    phone: mapped.phone || '',
                    addr: mapped.addr || '',
                    email: mapped.email || '',
                    group: mapped.group || 'normal',
                    note: mapped.note || '',
                    points: 0,
                    debt: 0,
                    totalBuy: 0
                });
                addedCount++;
            }
        }
    });

    logActivity('Nhập dữ liệu', `${type === 'products' ? 'Sản phẩm' : 'Khách hàng'}: +${addedCount}, cập nhật ${updatedCount}, bỏ qua ${skippedCount}`);
    if (!saveInventoryCommit(inventoryCommit)) {
        customerSnapshot.forEach(({ customer, values }) => {
            Object.keys(customer).forEach(key => delete customer[key]);
            Object.assign(customer, values);
        });
        db.custs = customerList;
        hideLoading();
        return;
    }

    hideLoading();
    toast(`Đã nhập thành công! Thêm: ${addedCount}, Cập nhật: ${updatedCount}, Bỏ qua: ${skippedCount}`);
    closeModal('import-modal');

    if (type === 'products') {
        renderProdTable();
        renderCategories();
        renderPos();
    } else {
        renderCustTable();
        updateCustList();
    }
}

// CATEGORIES
function renderPosCategoryFilter() {
    const posCat = $('pos-cat');
    if (!posCat) return;

    const selectedCat = posCat.value;
    posCat.innerHTML = '<option value="">Tất cả</option>' + db.categories.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('') + '<option value="low_stock">⚠️ Sắp hết</option>';

    if (selectedCat === 'low_stock' || db.categories.includes(selectedCat)) {
        posCat.value = selectedCat;
    }
}

function renderCategories() {
    const div = $('cat-list-manage');
    if (div) {
        div.innerHTML = db.categories.map(c => `<span class="cat-chip">${escapeHtml(c)} <span class="del-cat" onclick="deleteCategory('${escapeJsString(c)}')">×</span></span>`).join('');
    }
    const filter = $('prod-filter-cat');
    if (filter) {
        const selectedCat = filter.value;
        filter.innerHTML = '<option value="">Tất cả danh mục</option>' + db.categories.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
        if (selectedCat && db.categories.includes(selectedCat)) filter.value = selectedCat;
    }
    // Update datalist for searchable category input
    const catList = $('p-cat-list');
    if (catList) {
        catList.innerHTML = db.categories.map(c => `<option value="${escapeAttr(c)}">`).join('');
    }
    renderPosCategoryFilter();
}

// Filter category list (for searchable category input)
function filterCatList(val) {
    const catList = $('p-cat-list');
    if (!catList) return;
    const search = val.toLowerCase();
    const filtered = db.categories.filter(c => c.toLowerCase().includes(search));
    catList.innerHTML = filtered.map(c => `<option value="${escapeAttr(c)}">`).join('');
}

function addCategory() {
    if (!canMutateManagement()) return;
    const val = $('new-cat-name').value.trim();
    if (!val || db.categories.includes(val)) return toast("Tên không hợp lệ", "warning");
    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;
    db.categories.push(val);
    if (!saveInventoryCommit(inventoryCommit)) return;
    $('new-cat-name').value = '';
    renderCategories();
    renderPos();
    toast("Đã thêm danh mục!");
}

function deleteCategory(val) {
    if (!canMutateManagement()) return;
    const assignedCount = db.products.filter(p => p.cat === val).length;
    if (assignedCount > 0) {
        return toast(`Không thể xóa: danh mục "${val}" đang có ${assignedCount} sản phẩm.`, "warning");
    }

    if (confirm(`Xóa danh mục "${val}"?`)) {
        const inventoryCommit = beginInventoryCommit();
        if (!inventoryCommit) return;
        pushUndo(UNDO_ACTIONS.DELETE_CATEGORY, val);
        db.categories = db.categories.filter(c => c !== val);
        if (!saveInventoryCommit(inventoryCommit)) return;
        renderCategories();
        renderPos();
    }
}

// QUICK ADD CATEGORY FROM PRODUCT MODAL
function toggleQuickAddCat() {
    const container = $('quick-cat-inline');
    if (container) {
        const isVisible = container.style.display !== 'none';
        container.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) {
            $('quick-cat-name').value = '';
            $('quick-cat-name').focus();
        }
    }
}

function quickAddCatFromProduct() {
    if (!canMutateManagement()) return;
    const input = $('quick-cat-name');
    const val = input?.value.trim();
    if (!val) return toast("Nhập tên danh mục!", "warning");
    if (db.categories.includes(val)) return toast("Danh mục đã tồn tại!", "warning");

    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;
    // Add new category
    db.categories.push(val);
    if (!saveInventoryCommit(inventoryCommit)) return;

    // Update the category input in product modal
    const catInput = $('p-cat-search');
    if (catInput) {
        catInput.value = val; // Set the newly added category
    }

    // Also update other category lists
    renderCategories();
    renderPos();

    // Hide the quick add form
    toggleQuickAddCat();
    toast("Đã thêm danh mục: " + val);
}

// CUSTOMERS
function renderCustTable() {
    const search = ($('cust-search')?.value || '').toLowerCase();
    const filtered = db.custs.filter(c => c.name.toLowerCase().includes(search) || (c.phone || '').includes(search))
        .sort((a, b) => b.id - a.id); // Sort newest first

    if ($('cust-total')) $('cust-total').innerText = db.custs.length.toLocaleString('vi-VN');
    if ($('cust-vip')) $('cust-vip').innerText = db.custs.filter(c => c.group === 'vip').length.toLocaleString('vi-VN');
    if ($('cust-total-debt')) $('cust-total-debt').innerText = money(db.custs.reduce((a, c) => a + (c.debt || 0), 0));

    const tbody = $('cust-body-manage');
    if (!tbody) return;

    tbody.innerHTML = filtered.map(c => {
        const groupBadge = { normal: '', silver: '🥈', gold: '🥇', vip: '👑' }[c.group || 'normal'];
        const groupClass = { normal: 'badge-secondary', silver: 'badge-secondary', gold: 'badge-warning', vip: 'badge-primary' }[c.group || 'normal'];
        const groupLabel = { normal: 'Thường', silver: 'Bạc', gold: 'Vàng', vip: 'VIP' }[c.group || 'normal'] || c.group || 'Thường';
        const customerIdJs = escapeJsArgument(c.id);
        const custTypeBadge = c.customerType === 'wholesale' ?
            '<span class="badge" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;margin-left:4px;">📦 Sỉ</span>' : '';
        return `<tr>
            <td><strong>${escapeHtml(c.name)}</strong>${custTypeBadge}</td>
            <td><span class="badge ${groupClass}">${groupBadge} ${escapeHtml(groupLabel)}</span></td>
            <td>${escapeHtml(c.phone || '-')}</td>
            <td>${escapeHtml(c.addr || '-')}</td>
            <td><span class="badge badge-primary">${(c.points || 0).toLocaleString()} điểm</span></td>
            <td class="${(c.debt || 0) > 0 ? 'debt-amount negative' : ''}">${money(c.debt || 0)}</td>
            <td>${money(c.totalBuy || 0)}</td>
            <td>
                ${!sameStoredId(c.id, 1) ? `
                    <button class="btn-sm btn-secondary" onclick="editCust(${customerIdJs})">Sửa</button>
                    <button class="btn-sm btn-warning" onclick="openDebtModal(${customerIdJs})">Công nợ</button>
                    <button class="btn-sm btn-danger" onclick="delCust(${customerIdJs})">Xóa</button>
                ` : '<span style="color:var(--text-muted);font-size:11px">Mặc định</span>'}
            </td>
        </tr>`;
    }).join('');
}

function openCustModal(isQuick = false) {
    isQuickAddCust = isQuick;
    $('cust-modal').classList.add('active');
    $('c-id').value = '';
    $('c-name').value = '';
    $('c-phone').value = '';
    $('c-addr').value = '';
    $('c-note').value = '';
    $('c-group').value = 'normal';
    if ($('c-birthday')) $('c-birthday').value = '';
    if ($('c-email')) $('c-email').value = '';
    if ($('c-customer-type')) $('c-customer-type').value = 'retail';

    // Auto-focus on name input after modal animation completes
    setTimeout(() => $('c-name')?.focus(), 100);
}

function editCust(id) {
    const c = db.custs.find(x => sameStoredId(x.id, id));
    if (!c) return;
    $('cust-modal').classList.add('active');
    $('c-id').value = c.id;
    $('c-name').value = c.name;
    $('c-phone').value = c.phone || '';
    $('c-addr').value = c.addr || '';
    $('c-note').value = c.note || '';
    $('c-group').value = c.group || 'normal';
    if ($('c-birthday')) $('c-birthday').value = c.birthday || '';
    if ($('c-email')) $('c-email').value = c.email || '';
    if ($('c-customer-type')) $('c-customer-type').value = c.customerType || 'retail';
    isQuickAddCust = false;
}

function saveCust() {
    const n = $('c-name').value.trim();
    if (!n) return toast("Nhập tên khách!", "error");
    const id = $('c-id').value;
    const data = {
        name: n,
        phone: $('c-phone').value,
        addr: $('c-addr').value,
        note: $('c-note').value,
        group: $('c-group').value,
        birthday: $('c-birthday')?.value || '',
        email: $('c-email')?.value || '',
        customerType: $('c-customer-type')?.value || 'retail'
    };
    const historyCommit = beginHistoryCommit();
    if (!historyCommit) return;

    let message;
    if (id) {
        const idx = db.custs.findIndex(x => sameStoredId(x.id, id));
        if (idx > -1) {
            const oldName = db.custs[idx].name;
            db.custs[idx] = { ...db.custs[idx], ...data };
            refreshCustomerReferences(db.custs[idx], oldName);
        }
        message = 'Đã cập nhật!';
    } else {
        const newC = { id: Date.now(), ...data, points: 0, debt: 0, totalBuy: 0 };
        db.custs.push(newC);
        if (isQuickAddCust) {
            updateCustList();
            if ($('cart-cust')) $('cart-cust').value = newC.name;
            cust = newC;
            // Re-render cart to apply new customer's pricing (wholesale/retail)
            renderCart();
        }
        message = 'Đã thêm khách hàng!';
    }
    if (!saveHistoryCommit(historyCommit)) return;
    closeModal('cust-modal');
    updateCustList();
    renderCustTable();
    toast(message);
}

function refreshCustomerReferences(customer, oldName = '') {
    if (!customer) return;
    const selectedName = ($('cart-cust')?.value || '').trim();
    if (sameStoredId(cust?.id, customer.id) || (oldName && selectedName === oldName)) {
        cust = { ...customer };
        if ($('cart-cust')) $('cart-cust').value = cust.name;
    }
    invoiceTabs.forEach(tab => {
        if (sameStoredId(tab.cust?.id, customer.id) || (oldName && tab.cust?.name === oldName)) tab.cust = { ...customer };
    });
}

function clearDeletedCustomerReferences(customerId, oldName = '') {
    const selectedName = ($('cart-cust')?.value || '').trim();
    if (sameStoredId(cust?.id, customerId) || (oldName && selectedName === oldName)) {
        cust = db.custs.find(c => sameStoredId(c.id, 1)) || null;
        if ($('cart-cust')) $('cart-cust').value = '';
    }
    invoiceTabs.forEach(tab => {
        if (sameStoredId(tab.cust?.id, customerId) || (oldName && tab.cust?.name === oldName)) tab.cust = null;
    });
}

function getCustomerDependencies(custId) {
    const documents = [];
    const transient = [];
    const invCount = db.invoices.filter(inv => sameStoredId(inv.custId, custId)).length;
    if (invCount > 0) documents.push(`${invCount} hóa đơn`);
    const returnCount = (db.returns || []).filter(returnRecord =>
        sameStoredId(returnRecord.custId ?? returnRecord.customerId ?? returnRecord.customer?.id, custId)
    ).length;
    if (returnCount > 0) documents.push(`${returnCount} phiếu trả/đổi`);
    // Check active tabs
    const tabsWithCust = invoiceTabs.filter(tab => tab.cust && sameStoredId(tab.cust.id, custId));
    if (tabsWithCust.length > 0) transient.push(`${tabsWithCust.length} đơn hàng đang mở`);
    if (cust && sameStoredId(cust.id, custId)) transient.push('giỏ hàng hiện tại');
    return { documents, transient };
}

function delCust(id) {
    const c = db.custs.find(x => sameStoredId(x.id, id));
    if (!c) return toast("Không tìm thấy khách hàng!", "error");
    const deps = getCustomerDependencies(id);
    if (deps.documents.length > 0) {
        return toast(`Không thể xóa khách hàng còn liên kết với: ${deps.documents.join(', ')}.`, 'warning');
    }
    let msg = "Xóa khách hàng này?";
    if (deps.transient.length > 0) {
        msg = `Khách hàng đang liên kết với: ${deps.transient.join(', ')}.\nBạn vẫn muốn xóa?`;
    }
    if (confirm(msg)) {
        const historyCommit = beginHistoryCommit();
        if (!historyCommit) return;
        pushUndo(UNDO_ACTIONS.DELETE_CUSTOMER, c);
        db.custs = db.custs.filter(x => !sameStoredId(x.id, id));
        clearDeletedCustomerReferences(id, c?.name || '');
        if (!saveHistoryCommit(historyCommit)) return;
        updateCustList();
        renderCustTable();
    }
}

function openDebtModal(id) {
    const c = db.custs.find(x => sameStoredId(x.id, id));
    if (!c) return;
    $('debt-modal').classList.add('active');
    $('debt-cust-id').value = id;
    $('debt-current').innerText = money(c.debt || 0);
    $('debt-amount').value = '';
    $('debt-note').value = '';
}

function saveDebt() {
    const id = $('debt-cust-id').value;
    const c = db.custs.find(x => sameStoredId(x.id, id));
    if (!c) return;
    const type = $('debt-type').value;
    const amount = parseInt(($('debt-amount').value || '0').replace(/\D/g, '')) || 0;
    if (amount <= 0) return toast("Nhập số tiền!", "error");

    const historyCommit = beginHistoryCommit();
    if (!historyCommit) return;
    if (type === 'pay') {
        c.debt = Math.max(0, (c.debt || 0) - amount);
        logActivity('Thu nợ', `${c.name}: ${money(amount)}`);
    } else {
        c.debt = (c.debt || 0) + amount;
        logActivity('Ghi nợ', `${c.name}: ${money(amount)}`);
    }
    if (!saveHistoryCommit(historyCommit)) return;
    closeModal('debt-modal');
    renderCustTable();
    toast("Đã cập nhật công nợ!");
}

// WHOLESALE PRICE CALCULATION
function getEffectivePrice(product, qty, customer) {
    // Check conditions for wholesale price:
    // 1. Product has wholesale price
    // 2. Customer is wholesale type OR quantity >= minimum wholesale qty
    const isWholesaleCustomer = customer?.customerType === 'wholesale';
    const hasWholesalePrice = product.wholesalePrice && product.wholesalePrice > 0;
    const meetsMinQty = qty >= (product.minWholesaleQty || 10);

    if (hasWholesalePrice && (isWholesaleCustomer || meetsMinQty)) {
        return {
            price: product.wholesalePrice,
            type: 'wholesale',
            label: '📦 Sỉ'
        };
    }
    return {
        price: product.price,
        type: 'retail',
        label: '🛍️ Lẻ'
    };
}

// FIX: Wrapper function to reset selection state when category dropdown changes (mouse click)
// This prevents stale selection from persisting across category changes
function handleCategoryChange() {
    // Reset selection state BEFORE render to prevent stale selection
    if (typeof focusedProductIndex !== 'undefined') {
        focusedProductIndex = -1;
    }
    posSelectedIndex = -1;
    posSelectedProductId = null;
    isNavigatingProducts = false;

    // Clear barcode buffer to prevent accidental scans
    if (typeof globalBarcodeBuffer !== 'undefined') {
        globalBarcodeBuffer = '';
    }
    if (typeof globalBarcodeTimeout !== 'undefined' && globalBarcodeTimeout) {
        clearTimeout(globalBarcodeTimeout);
    }

    renderPos();
}

// POS
function renderPos() {
    const g = $('pos-grid');
    if (!g) return;
    updateProductFilterUI();

    // Apply current view mode class on every render
    g.classList.remove('grid-view', 'list-view', 'details-view', 'view-grid', 'view-list', 'view-details');
    g.classList.add(currentViewMode + '-view', `view-${currentViewMode}`);

    const posCat = $('pos-cat');
    if (posCat && posCat.options.length <= 1) renderPosCategoryFilter();

    let list = getFilteredProductsForPos();

    // Performance: Limit rendered items, show "load more" if needed
    const totalProducts = list.length;
    const visibleList = list.slice(0, currentVisibleLimit);
    const hasMore = totalProducts > currentVisibleLimit;

    // Build HTML using array join for better performance
    const productsHtml = visibleList.map(p => {
        const productIdAttr = escapeAttr(String(p.id ?? ''));
        const productIdJs = escapeJsArgument(p.id);
        const lowStock = db.settings.lowStock || 5;
        const isLow = p.stock <= lowStock && p.stock > 0;
        const isNegative = p.stock < 0;
        const isOutOfStock = p.stock === 0;
        // Allow clicking even when out of stock - for negative stock sales
        const cls = isNegative ? 'negative-stock' : (isOutOfStock ? 'out-stock-clickable' : (isLow ? 'low-stock' : ''));
        const stockLabel = isNegative ? `Âm: ${formatQty(Math.abs(p.stock))}` : `Kho: ${formatQty(p.stock)}`;
        const stockStyle = isNegative ? 'color:var(--danger);font-weight:bold' : (isLow || isOutOfStock ? 'color:var(--warning);font-weight:bold' : '');
        const imgSrc = safeImageSrc(p.img);
        const imgStyle = imgSrc ? ` style="background-image:url('${escapeAttr(imgSrc)}')"` : '';
        return `<div class="p-card ${cls}" onclick="addCartClick(${productIdJs})" data-id="${productIdAttr}" data-selected="false">
            <div class="p-img"${imgStyle}>${imgSrc ? '' : '📷'}</div>
            <div class="p-info">
                <div class="p-name">${escapeHtml(p.name)}</div>
                <div class="p-price">${money(p.price)}</div>
                <div class="p-stock">
                    <span>${escapeHtml(p.code || 'N/A')}</span>
                    <span style="${stockStyle}">${stockLabel}</span>
                </div>
            </div>
        </div>`;
    }).join('');

    // Add "load more" indicator if there are more products
    const moreIndicator = hasMore ? `
        <div class="load-more-indicator" style="grid-column: 1/-1; text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">
            📦 Hiển thị ${visibleList.length}/${totalProducts} sản phẩm.
            <button onclick="loadMoreProducts()" style="margin-left:8px; padding:4px 12px; border:1px solid var(--border); border-radius:4px; background:var(--bg); cursor:pointer; color:var(--text);">Hiển thị thêm</button>
        </div>` : '';

    g.innerHTML = productsHtml + moreIndicator;

    // IMPORTANT: Re-apply keyboard selection after rendering to ensure highlight persists
    if (posSelectedProductId) {
        const cards = Array.from(g.querySelectorAll('.p-card'));
        let foundIndex = -1;

        // First pass: clear ALL cards and find the selected one
        for (let i = 0; i < cards.length; i++) {
            cards[i].setAttribute('data-selected', 'false');
            cards[i].classList.remove('keyboard-focused');

            if (cards[i].getAttribute('data-id') === posSelectedProductId) {
                foundIndex = i;
            }
        }

        // Second pass: apply selection to the found card
        if (foundIndex >= 0) {
            cards[foundIndex].setAttribute('data-selected', 'true');
            posSelectedIndex = foundIndex;
        } else {
            // Product not found in filtered list - reset selection
            posSelectedIndex = -1;
            posSelectedProductId = null;
        }
    }
}

// Handle text input changes - only render grid, don't reset selection unless text changed
let lastSearchValue = ''; // Track previous search value to detect actual text changes

// Debounced renderPos for search input - prevents lag during fast typing
const debouncedRenderPos = debounce(renderPos, SEARCH_DEBOUNCE_MS);

function handleSearchInput() {
    const currentValue = $('pos-search')?.value || '';
    currentVisibleLimit = MAX_VISIBLE_PRODUCTS; // Reset limit on new search

    // Check if text actually changed
    const textChanged = currentValue !== lastSearchValue;
    lastSearchValue = currentValue;

    // Skip everything if flag is set (after Enter action)
    if (skipNextSelectionReset) {
        skipNextSelectionReset = false;
        renderPos(); // Immediate render for Enter action responsiveness
        return;
    }

    // Reset selection BEFORE rendering if text changed
    // This ensures renderPos() doesn't re-apply stale selection
    if (textChanged) {
        posSelectedIndex = -1;
        posSelectedProductId = null;
        // Also reset System 2
        if (typeof focusedProductIndex !== 'undefined') {
            focusedProductIndex = -1;
        }
        // Use debounced render for typing - prevents lag during fast input
        debouncedRenderPos();
    } else {
        // No text change, just render immediately
        renderPos();
    }
}

// Handle special keys (Enter, ESC, Arrow keys) - separate from text input
function handleSearchKey(e) {
    // Arrow keys - navigate grid (adapt to view mode)
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();

        // Track navigation state to prevent accidental auto-add
        isNavigatingProducts = true;
        lastNavigationTime = Date.now();

        const grid = $('pos-grid');
        if (!grid) return;

        // CRITICAL: Clear System 2 (keyboard-focused) first to prevent dual-highlight bug
        // This happens when addCart auto-focuses search input while System 2 was active
        if (typeof focusedProductIndex !== 'undefined') {
            focusedProductIndex = -1;
        }
        grid.querySelectorAll('.p-card').forEach(card => {
            card.setAttribute('data-selected', 'false');
            card.classList.remove('keyboard-focused');
        });

        // Use consistent query - ALL cards (including out-of-stock for negative sales)
        const cards = Array.from(grid.querySelectorAll('.p-card'));
        if (cards.length === 0) return;

        // Determine navigation mode based on view
        // Grid mode: use columns based on actual layout, List/Details mode: single column (1)
        let columns = 1;
        if (currentViewMode === 'grid') {
            // Calculate columns based on actual grid layout
            const gridWidth = grid.offsetWidth;
            const firstCard = cards[0];
            if (firstCard) {
                const cardWidth = firstCard.offsetWidth + 16; // include gap
                columns = Math.max(1, Math.floor(gridWidth / cardWidth));
            } else {
                columns = 4; // default fallback
            }
        }

        // Handle initial selection (when no product is selected)
        // First press should both select and navigate in the pressed direction
        if (posSelectedIndex < 0) {
            // Start from appropriate position based on direction
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                // Moving forward: start at first product
                posSelectedIndex = 0;
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                // Moving backward: start at last product
                posSelectedIndex = cards.length - 1;
            }
        } else {
            // Navigate based on direction and view mode
            if (currentViewMode === 'grid') {
                // Grid mode: all 4 directions work
                if (e.key === 'ArrowDown') {
                    const newIndex = posSelectedIndex + columns;
                    if (newIndex < cards.length) {
                        posSelectedIndex = newIndex;
                    }
                } else if (e.key === 'ArrowUp') {
                    const newIndex = posSelectedIndex - columns;
                    if (newIndex >= 0) {
                        posSelectedIndex = newIndex;
                    }
                } else if (e.key === 'ArrowRight') {
                    if (posSelectedIndex < cards.length - 1) {
                        posSelectedIndex++;
                    }
                } else if (e.key === 'ArrowLeft') {
                    if (posSelectedIndex > 0) {
                        posSelectedIndex--;
                    }
                }
            } else {
                // List/Details mode: only up/down work
                if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                    if (posSelectedIndex < cards.length - 1) {
                        posSelectedIndex++;
                    }
                } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                    if (posSelectedIndex > 0) {
                        posSelectedIndex--;
                    }
                }
            }
        }

        // Validate index bounds
        if (posSelectedIndex < 0) posSelectedIndex = 0;
        if (posSelectedIndex >= cards.length) posSelectedIndex = cards.length - 1;

        // Apply highlight to selected card only and track product ID
        if (posSelectedIndex >= 0 && posSelectedIndex < cards.length) {
            const selectedCard = cards[posSelectedIndex];
            selectedCard.setAttribute('data-selected', 'true');
            selectedCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            posSelectedProductId = selectedCard.getAttribute('data-id');
        }
        return;
    }

    // ESC - clear search and selection
    if (e.key === 'Escape') {
        e.preventDefault();
        isNavigatingProducts = false; // Reset navigation state
        $('pos-search').value = '';
        posSelectedIndex = -1;
        posSelectedProductId = null;
        // Also clear System 2 state
        if (typeof focusedProductIndex !== 'undefined') {
            focusedProductIndex = -1;
        }
        renderPos();
        const grid = $('pos-grid');
        if (grid) {
            grid.querySelectorAll('.p-card').forEach(card => {
                card.setAttribute('data-selected', 'false');
                card.classList.remove('keyboard-focused');
            });
        }
        return;
    }

    // Enter - add product to cart
    if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();

        const grid = $('pos-grid');
        if (!grid) return;

        // Use consistent query - ALL cards
        const cards = Array.from(grid.querySelectorAll('.p-card'));
        if (cards.length === 0) return;

        const v = $('pos-search').value.toLowerCase().trim();

        // PRIORITY 1: If user has keyboard selection, use that (don't override with barcode)
        if (posSelectedIndex >= 0 && posSelectedIndex < cards.length) {
            const card = cards[posSelectedIndex];
            const productId = card.getAttribute('data-id');

            if (productId) {
                // Save the product ID for re-selection
                const savedProductId = productId;

                // Add to cart FIRST
                addCart(productId);

                // Re-apply selection immediately after addCart
                // (addCart may have triggered events that cleared selection)
                posSelectedProductId = savedProductId;
                posSelectedIndex = -1; // Will be recalculated

                // Find and re-select the card
                const freshCards = Array.from(grid.querySelectorAll('.p-card'));
                for (let i = 0; i < freshCards.length; i++) {
                    if (freshCards[i].getAttribute('data-id') === savedProductId) {
                        freshCards[i].setAttribute('data-selected', 'true');
                        posSelectedIndex = i;
                    } else {
                        freshCards[i].setAttribute('data-selected', 'false');
                    }
                    freshCards[i].classList.remove('keyboard-focused');
                }

                skipNextSelectionReset = true;
                return;
            }
        }

        // PRIORITY 2: Barcode scan - exact code match (only if no keyboard selection)
        if (v && posSelectedIndex < 0) {
            const barcodeMatch = db.products.find(x => (x.code || '').toLowerCase() === v);
            if (barcodeMatch) {
                // Clear all highlights
                grid.querySelectorAll('.p-card').forEach(card => {
                    card.setAttribute('data-selected', 'false');
                    card.classList.remove('keyboard-focused');
                });
                if (typeof focusedProductIndex !== 'undefined') focusedProductIndex = -1;

                addCart(barcodeMatch.id);

                // Keep product code in search box and select all for consecutive scanning
                const searchInput = $('pos-search');
                searchInput.value = barcodeMatch.code || v;
                lastSearchValue = barcodeMatch.code || v; // Update tracking variable
                searchInput.focus();
                searchInput.select();  // Select all text - next scan will auto-replace
                posSelectedIndex = -1;
                posSelectedProductId = null;
                renderPos();
                return;
            }
        }

        // PRIORITY 3: No selection and no barcode - auto-select first product
        if (posSelectedIndex < 0 && cards.length > 0) {
            // PROTECTION: Prevent auto-add if user was just navigating with arrow keys
            const timeSinceNavigation = Date.now() - lastNavigationTime;
            if (isNavigatingProducts && timeSinceNavigation < NAVIGATION_DEBOUNCE_MS) {
                console.log('[POS Debug] Blocked auto-add: Too soon after navigation (' + timeSinceNavigation + 'ms)');
                // Just select the first product without adding to cart
                posSelectedIndex = 0;
                posSelectedProductId = cards[0].getAttribute('data-id');
                cards[0].setAttribute('data-selected', 'true');
                isNavigatingProducts = false;
                return;
            }

            // FIX: Only auto-add if there's a search term (user intent to find product)
            // This prevents accidental auto-add when pressing Enter without selection
            const searchValue = $('pos-search')?.value?.trim() || '';
            if (searchValue.length === 0) {
                console.log('[POS Debug] Blocked auto-add: No search term - likely accidental Enter');
                // Just select first product without adding to cart
                posSelectedIndex = 0;
                posSelectedProductId = cards[0].getAttribute('data-id');
                cards[0].setAttribute('data-selected', 'true');
                return;
            }

            const card = cards[0];
            const productId = card.getAttribute('data-id');

            if (productId) {
                isNavigatingProducts = false; // Reset navigation state
                // Add to cart FIRST
                addCart(productId);

                // Set selection state
                posSelectedIndex = 0;
                posSelectedProductId = productId;

                // Apply highlight to first card
                const freshCards = Array.from(grid.querySelectorAll('.p-card'));
                for (let i = 0; i < freshCards.length; i++) {
                    if (i === 0) {
                        freshCards[i].setAttribute('data-selected', 'true');
                    } else {
                        freshCards[i].setAttribute('data-selected', 'false');
                    }
                    freshCards[i].classList.remove('keyboard-focused');
                }

                skipNextSelectionReset = true;
                return;
            }
        }
    }
}

// Legacy alias for backward compatibility
function handleSearch(e) {
    if (e && e.key) {
        handleSearchKey(e);
    } else {
        handleSearchInput();
    }
}

// Mouse click handler for product cards - clears keyboard selection state
function addCartClick(id) {
    // Clear all keyboard selection state to prevent double-highlight (System 1)
    posSelectedIndex = -1;
    posSelectedProductId = null;
    // Also clear System 2
    if (typeof focusedProductIndex !== 'undefined') {
        focusedProductIndex = -1;
    }
    const grid = $('pos-grid');
    if (grid) {
        grid.querySelectorAll('.p-card').forEach(card => {
            card.setAttribute('data-selected', 'false');
            card.classList.remove('keyboard-focused');
        });
    }
    // Now add to cart
    addCart(id);
}

function addCart(id) {
    // If in return/exchange mode, route to inline return cart
    if (isReturnExchangeMode) {
        const p = db.products.find(x => sameStoredId(x.id, id));
        if (!p) return toast("Không tìm thấy sản phẩm!", "error");
        addToReturnExchangeCart(p);
        return;
    }

    const p = db.products.find(x => sameStoredId(x.id, id));
    if (!p) return toast("Không tìm thấy sản phẩm!", "error");

    // Show warning if selling with negative stock but still allow it
    if (p.stock <= 0) {
        toast(`⚠️ Bán âm kho: ${p.name} (Tồn: ${p.stock})`, "warning");
    }

    const ex = cart.find(x => sameStoredId(x.id, id));
    if (ex) {
        ex.qty++;
        // Warn if quantity exceeds stock but allow it
        if (ex.qty > p.stock) {
            toast(`⚠️ Vượt tồn kho: ${p.name} (Tồn: ${p.stock}, Bán: ${ex.qty})`, "warning");
        }
    } else {
        cart.unshift({ ...p, qty: 1 }); // Add new items at the top
    }
    renderCart();
    saveCurrentTabState(); // Sync to active tab for multi-tab isolation
    setTimeout(() => $('pos-search')?.focus(), 50);
}

let _lastCartHash = '';
function renderCart() {
    const l = $('cart-list');
    if (!l) return;
    // Skip re-render if cart hasn't changed
    const discountHash = `${$('discount-type')?.value || 'amount'}:${parseInt(($('cart-discount')?.value || '0').replace(/\D/g, '')) || 0}`;
    const cartHash = JSON.stringify(cart.map(i => `${i.id}:${i.qty}:${i.customPrice}:${i.customLineTotal}`)) +
        (cust?.id || 0) + ':' + (cust?.points || 0) + ':' + discountHash + ':' + (db.settings.pointsEnabled !== false) + ':' + (db.settings.pointsValue || 0);
    if (cartHash === _lastCartHash && cart.length > 0) return;
    _lastCartHash = cartHash;
    if (cart.length === 0) {
        _lastCartHash = '';
        l.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🛒</div><div class="empty-state-text">Giỏ hàng trống</div></div>`;
        $('cart-subtotal').innerText = '0 ₫';
        $('cart-total').innerText = '0 ₫';
        if ($('cart-change')) $('cart-change').innerText = '0 ₫';
        $('cart-badge').innerText = 0;
        updatePaymentDetailsSummary(0, 0);
        renderInvoiceTabs(); // Update tab badges
        return;
    }

    l.innerHTML = '';
    let sub = 0, count = 0;
    cart.forEach(i => {
        const cartItemIdJs = escapeJsArgument(i.id);
        // Get effective price based on customer and quantity
        const product = db.products.find(p => sameStoredId(p.id, i.id)) || i;
        const effective = getEffectivePrice(product, i.qty, cust);
        const effectivePrice = effective.price;
        const priceType = effective.type;
        const priceLabel = effective.label;
        // Use custom price if set, otherwise effective price
        const displayPrice = i.customPrice !== undefined ? i.customPrice : effectivePrice;
        // Use customLineTotal if set (preserves exact user-entered value for decimal quantities)
        const lineTotal = i.customLineTotal !== undefined ? i.customLineTotal : Math.round(displayPrice * i.qty);
        sub += lineTotal;
        count += i.qty;
        const d = document.createElement('div');
        d.className = 'cart-item';

        // Show price type badge for wholesale  
        const typeBadge = priceType === 'wholesale' ?
            `<span style="font-size:10px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;padding:1px 6px;border-radius:8px;margin-left:4px;">📦 Sỉ</span>` : '';

        // Calculate discount amount if customPrice is lower than original
        const originalPrice = effectivePrice;
        const discountPerItem = i.customPrice !== undefined && i.customPrice < originalPrice
            ? originalPrice - i.customPrice : 0;
        const discountHtml = discountPerItem > 0
            ? `<div style="color:red;font-size:11px;margin-top:2px;">-${discountPerItem.toLocaleString('vi-VN')} ₫</div>`
            : '';

        d.innerHTML = `
            <div style="flex:1;min-width:0">
                <div style="font-weight:600;word-break:break-word;line-height:1.3" title="${escapeAttr(i.name)}">${escapeHtml(i.name)}${typeBadge}</div>
                <div style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:4px">
                    <input type="text" class="cart-price-input" value="${parseInt(displayPrice).toLocaleString('vi-VN')}" 
                        onchange="updateCartItemPrice(${cartItemIdJs},this.value)" 
                        onfocus="this.select()" 
                        style="width:80px;padding:2px 4px;font-size:12px;border:1px solid var(--border-light);border-radius:4px;text-align:right;">
                    <span>₫ ${i.unit ? '/ ' + escapeHtml(i.unit) : ''}</span>
                    ${i.customPrice !== undefined ? '<span style="color:var(--warning);font-size:10px" title="Giá đã chỉnh sửa">✏️</span>' : ''}
                </div>
                ${discountHtml}
            </div>
            <div class="qty-box">
                <button class="qty-btn" onclick="modQty(${cartItemIdJs},-1)">-</button>
                <input class="qty-input" type="text" inputmode="decimal" value="${formatQty(i.qty)}" onchange="upQtyMan(${cartItemIdJs},this.value)" onfocus="this.select()" style="width:70px;text-align:center;">
                <button class="qty-btn" onclick="modQty(${cartItemIdJs},1)">+</button>
            </div>
            <div style="font-weight:700;min-width:100px;text-align:right">
                <input type="text" class="cart-linetotal-input" value="${lineTotal.toLocaleString('vi-VN')}" 
                    onchange="updateCartItemLineTotal(${cartItemIdJs},this.value)" 
                    onfocus="this.select()" 
                    title="Click để chỉnh tổng giá dòng này"
                    style="width:95px;padding:4px 6px;font-size:14px;font-weight:700;border:1px solid transparent;border-radius:4px;text-align:right;background:transparent;color:inherit;cursor:pointer;"
                    onmouseover="this.style.borderColor='var(--primary)';this.style.background='var(--bg-muted)'"
                    onmouseout="if(document.activeElement!==this){this.style.borderColor='transparent';this.style.background='transparent'}">
                <span style="font-size:12px">₫</span>
            </div>
            <div style="margin-left:10px;cursor:pointer;color:var(--danger);font-size:18px" onclick="modQty(${cartItemIdJs},-999)">✕</div>
        `;
        l.appendChild(d);
    });

    $('cart-subtotal').innerText = money(sub);
    $('cart-badge').innerText = count.toLocaleString('vi-VN');
    updateCartTotal();
}

let paymentDetailsExpanded = false;

function setPaymentDetailsExpanded(expanded) {
    paymentDetailsExpanded = !!expanded;
    const panel = $('payment-details-panel');
    const toggle = $('payment-details-toggle');
    const caret = $('payment-details-caret');

    if (panel) {
        panel.classList.toggle('expanded', paymentDetailsExpanded);
        panel.setAttribute('aria-hidden', paymentDetailsExpanded ? 'false' : 'true');
        panel.querySelectorAll('input, select, button, textarea').forEach(el => {
            if (paymentDetailsExpanded) el.removeAttribute('tabindex');
            else el.setAttribute('tabindex', '-1');
        });
    }
    if (toggle) toggle.setAttribute('aria-expanded', paymentDetailsExpanded ? 'true' : 'false');
    if (caret) caret.textContent = paymentDetailsExpanded ? '▴' : '▾';
}

function togglePaymentDetails() {
    setPaymentDetailsExpanded(!paymentDetailsExpanded);
}

function getCartSubtotalValue() {
    return cart.reduce((sub, i) => {
        const product = db.products.find(p => sameStoredId(p.id, i.id)) || i;
        const effective = getEffectivePrice(product, i.qty, cust);
        const price = i.customPrice !== undefined ? i.customPrice : effective.price;
        const lineTotal = i.customLineTotal !== undefined ? i.customLineTotal : Math.round(price * i.qty);
        return sub + lineTotal;
    }, 0);
}

function getCartDiscountAmount(subtotal) {
    const discVal = parseInt(($('cart-discount')?.value || '0').replace(/\D/g, '')) || 0;
    const discType = $('discount-type')?.value || 'amount';
    return discType === 'percent' ? Math.round(subtotal * discVal / 100) : discVal;
}

function getCartPointsUsage(totalBeforePoints) {
    const row = $('cart-points-row');
    const useEl = $('cart-use-points');
    const inputEl = $('cart-points-input');
    const availableEl = $('cart-points-available');
    const selectedCustomer = cust?.id && !sameStoredId(cust.id, 1) ? (db.custs.find(c => sameStoredId(c.id, cust.id)) || cust) : null;
    const availablePoints = db.settings.pointsEnabled && selectedCustomer ? (parseInt(selectedCustomer.points) || 0) : 0;
    const pointsValue = db.settings.pointsValue || 1000;
    const maxPointsByTotal = Math.floor(Math.max(0, totalBeforePoints || 0) / pointsValue);
    const maxPoints = Math.max(0, Math.min(availablePoints, maxPointsByTotal));
    const shouldShow = availablePoints > 0 && maxPointsByTotal > 0;

    if (row) row.style.display = shouldShow ? 'grid' : 'none';
    if (availableEl) availableEl.textContent = `${availablePoints.toLocaleString('vi-VN')} điểm`;

    if (!shouldShow) {
        if (useEl) useEl.checked = false;
        if (inputEl) {
            inputEl.value = '0';
            inputEl.disabled = true;
            inputEl.max = 0;
        }
        return { pointsUsed: 0, pointsValue: 0, availablePoints, maxPoints: 0 };
    }

    if (inputEl) {
        inputEl.max = maxPoints;
        inputEl.disabled = !(useEl?.checked);
    }

    if (!useEl?.checked) {
        if (inputEl) inputEl.value = '0';
        return { pointsUsed: 0, pointsValue: 0, availablePoints, maxPoints };
    }

    let pointsUsed = parseInt(inputEl?.value) || 0;
    if (pointsUsed <= 0) pointsUsed = maxPoints;
    pointsUsed = Math.max(0, Math.min(pointsUsed, maxPoints));
    if (inputEl) inputEl.value = pointsUsed;

    return { pointsUsed, pointsValue: pointsUsed * pointsValue, availablePoints, maxPoints };
}

function toggleCartPoints() {
    const useEl = $('cart-use-points');
    const inputEl = $('cart-points-input');
    if (inputEl) {
        inputEl.disabled = !(useEl?.checked);
        if (useEl?.checked && (!parseInt(inputEl.value) || parseInt(inputEl.value) <= 0)) {
            inputEl.value = inputEl.max || '0';
        }
    }
    updateCartTotal();
}

function updatePaymentDetailsSummary(subtotalOverride, discountOverride) {
    const summary = $('payment-details-summary');
    if (!summary) return;

    if (isReturnExchangeMode) {
        const flowText = $('cart-subtotal')?.textContent?.trim() || 'Trả: 0 ₫ | Mua: 0 ₫';
        const resultText = $('cart-total')?.textContent?.trim() || 'Ngang giá';
        summary.textContent = `${flowText} · ${resultText}`;
        return;
    }

    const subtotal = Number.isFinite(subtotalOverride) ? subtotalOverride : getCartSubtotalValue();
    const discount = Number.isFinite(discountOverride) ? discountOverride : getCartDiscountAmount(subtotal);
    const pointsInfo = getCartPointsUsage(Math.max(0, subtotal - discount));
    const pointsText = pointsInfo.pointsValue > 0 ? ` · Điểm -${money(pointsInfo.pointsValue)}` : '';
    const changeText = $('cart-change')?.textContent?.trim() || '0 ₫';
    summary.textContent = `Tạm tính ${money(subtotal)} · Giảm ${money(discount)}${pointsText} · Thừa ${changeText}`;
}

function updateCartTotal() {
    let sub = getCartSubtotalValue();
    let disc = getCartDiscountAmount(sub);
    const beforePoints = Math.max(0, sub - disc);
    const pointsInfo = getCartPointsUsage(beforePoints);
    let total = Math.max(0, beforePoints - pointsInfo.pointsValue);
    const totalEl = $('cart-total');
    if (totalEl) {
        totalEl.innerText = moneyRounded(total);
        totalEl.style.color = '';
    }
    // Also update cart change when total changes
    calcCartChange();
    renderInvoiceTabs(); // Update tab badges
}

// Calculate change directly in cart panel
function calcCartChange() {
    const totalEl = $('cart-total');
    const giveEl = $('cart-customer-give');
    const changeEl = $('cart-change');
    if (!totalEl || !giveEl || !changeEl) return;

    const total = parseInt(totalEl.innerText.replace(/\D/g, '')) || 0;
    const given = parseInt((giveEl.value || '0').replace(/\D/g, '')) || 0;
    const change = Math.max(0, given - total);
    changeEl.innerText = money(change);
    updatePaymentDetailsSummary();
}

function captureSaleFieldState() {
    const fieldIds = [
        'cart-cust', 'cart-discount', 'discount-type', 'cart-customer-give', 'cart-change', 'cart-pay-method',
        'cart-use-points', 'cart-points-input', 'cart-points-row', 'cart-points-available',
        'pay-method', 'pay-give', 'pay-change', 'use-points', 'points-input', 'order-note', 'pos-search', 'pos-cat'
    ];
    return fieldIds.map(id => {
        const element = $(id);
        if (!element) return null;
        const props = {};
        ['value', 'checked', 'disabled', 'max', 'innerText'].forEach(key => {
            if (key in element) props[key] = element[key];
        });
        if (element.style && 'display' in element.style) props.display = element.style.display;
        return { id, props };
    }).filter(Boolean);
}

function restoreSaleFieldState(fields) {
    fields.forEach(({ id, props }) => {
        const element = $(id);
        if (!element) return;
        Object.entries(props).forEach(([key, value]) => {
            if (key === 'display') element.style.display = value;
            else element[key] = value;
        });
    });
}

function captureSaleMutationSnapshot() {
    const activeTab = invoiceTabs.find(tab => tab.id === activeTabId);
    return {
        // Reuse the durable-data snapshot already used by return commits.
        data: captureReturnMutationSnapshot(),
        cart: cart.map(item => ({ ...item })),
        cust: cust ? { ...cust } : null,
        tab: activeTab && {
            tab: activeTab,
            cart: activeTab.cart.map(item => ({ ...item })),
            cust: activeTab.cust ? { ...activeTab.cust } : null,
            discount: activeTab.discount,
            discountType: activeTab.discountType,
            returnItems: activeTab.returnItems.map(item => ({ ...item })),
            exchangeItems: activeTab.exchangeItems.map(item => ({ ...item })),
            isReturnExchangeMode: activeTab.isReturnExchangeMode,
            activeReturnCart: activeTab.activeReturnCart
        },
        fields: captureSaleFieldState()
    };
}

function rollbackSaleMutation(snapshot) {
    rollbackReturnMutation(snapshot.data);
    cart = snapshot.cart.map(item => ({ ...item }));
    cust = snapshot.cust ? { ...snapshot.cust } : null;
    if (snapshot.tab) {
        const { tab, ...state } = snapshot.tab;
        Object.assign(tab, {
            ...state,
            cart: state.cart.map(item => ({ ...item })),
            cust: state.cust ? { ...state.cust } : null,
            returnItems: state.returnItems.map(item => ({ ...item })),
            exchangeItems: state.exchangeItems.map(item => ({ ...item }))
        });
    }
    restoreSaleFieldState(snapshot.fields);
}

function beginSaleCommit() {
    if (saveBlockedReason) {
        if (!saveBlockedToastShown) {
            saveBlockedToastShown = true;
            toast("Không lưu dữ liệu mới vì file dữ liệu hiện tại bị lỗi. Hãy khôi phục từ backup.", "error");
        }
        return null;
    }
    if (saveSuppressed) {
        toast('Không thể lưu giao dịch bán hàng lúc này.', 'error');
        return null;
    }
    if (_saveInProgress) {
        toast('Đang lưu dữ liệu, vui lòng thử lại sau.', 'warning');
        return null;
    }
    return captureSaleMutationSnapshot();
}

function saveSale(snapshot) {
    // ponytail: both sale paths share the same synchronous commit and rollback.
    if (saveNow()) return true;
    rollbackSaleMutation(snapshot);
    return false;
}

function captureInventoryMutationSnapshot() {
    return {
        products: (db.products || []).map(product => ({ product, values: { ...product } })),
        categories: (db.categories || []).slice(),
        stockHistory: (db.stockHistory || []).slice(),
        purchaseOrders: (db.purchaseOrders || []).map(purchaseOrder => ({ purchaseOrder, values: JSON.parse(JSON.stringify(purchaseOrder)) })),
        suppliers: (db.suppliers || []).map(supplier => ({ supplier, values: JSON.parse(JSON.stringify(supplier)) })),
        users: Object.prototype.hasOwnProperty.call(db, 'users') ? (db.users || []).map(user => ({ user, values: JSON.parse(JSON.stringify(user)) })) : null,
        currentUser: typeof currUser === 'undefined' ? null : currUser,
        activityLog: (db.activityLog || []).slice(),
        undo: undoStack.slice()
    };
}

function rollbackInventoryMutation(snapshot) {
    snapshot.products.forEach(({ product, values }) => {
        Object.keys(product).forEach(key => delete product[key]);
        Object.assign(product, values);
    });
    db.products = snapshot.products.map(({ product }) => product);
    db.categories = snapshot.categories.slice();
    db.stockHistory = snapshot.stockHistory.slice();
    snapshot.purchaseOrders.forEach(({ purchaseOrder, values }) => {
        Object.keys(purchaseOrder).forEach(key => delete purchaseOrder[key]);
        Object.assign(purchaseOrder, values);
    });
    db.purchaseOrders = snapshot.purchaseOrders.map(({ purchaseOrder }) => purchaseOrder);
    snapshot.suppliers.forEach(({ supplier, values }) => {
        Object.keys(supplier).forEach(key => delete supplier[key]);
        Object.assign(supplier, values);
    });
    db.suppliers = snapshot.suppliers.map(({ supplier }) => supplier);
    if (snapshot.users !== null) {
        snapshot.users.forEach(({ user, values }) => {
            Object.keys(user).forEach(key => delete user[key]);
            Object.assign(user, values);
        });
        db.users = snapshot.users.map(({ user }) => user);
        if (typeof currUser !== 'undefined') currUser = snapshot.currentUser;
    }
    db.activityLog = snapshot.activityLog.slice();
    undoStack.splice(0, undoStack.length, ...snapshot.undo);
}

function beginInventoryCommit() {
    if (saveBlockedReason) {
        if (!saveBlockedToastShown) {
            saveBlockedToastShown = true;
            toast("Không lưu dữ liệu mới vì file dữ liệu hiện tại bị lỗi. Hãy khôi phục từ backup.", "error");
        }
        return null;
    }
    if (saveSuppressed) {
        toast('Không thể lưu thay đổi hàng hóa lúc này.', 'error');
        return null;
    }
    if (_saveInProgress) {
        toast('Đang lưu dữ liệu, vui lòng thử lại sau.', 'warning');
        return null;
    }
    return captureInventoryMutationSnapshot();
}

function saveInventoryCommit(snapshot) {
    // ponytail: one synchronous commit keeps the audited inventory mutations atomic.
    if (saveNow()) return true;
    rollbackInventoryMutation(snapshot);
    return false;
}

function canMutateManagement() {
    if (isAuthenticated && currUser && ['admin', 'manager'].includes(currUser.role)) return true;
    toast('Bạn không có quyền thực hiện thao tác này!', 'error');
    return false;
}

function canMutateSettings() {
    if (isAuthenticated && currUser && ['admin', 'manager'].includes(currUser.role)) return true;
    toast('Bạn không có quyền thay đổi cài đặt!', 'error');
    return false;
}

function canMutateDangerSettings() {
    if (isAuthenticated && currUser?.role === 'admin') return true;
    toast('Chỉ quản trị viên được phép thực hiện thao tác này!', 'error');
    return false;
}

function captureHistoryMutationSnapshot() {
    const arrays = ['invoices', 'stockHistory', 'activityLog'].map(key => ({
        key,
        exists: Object.prototype.hasOwnProperty.call(db, key),
        value: Array.isArray(db[key]) ? db[key].slice() : db[key]
    }));
    return {
        arrays,
        invoices: (db.invoices || []).map(invoice => ({ invoice, values: JSON.parse(JSON.stringify(invoice)) })),
        products: (db.products || []).map(product => ({ product, stock: product.stock })),
        customers: Object.prototype.hasOwnProperty.call(db, 'custs') ? (db.custs || []).map(customer => ({ customer, values: JSON.parse(JSON.stringify(customer)) })) : null,
        customerUi: {
            selectedCustomer: typeof cust === 'undefined' ? null : cust,
            tabs: (typeof invoiceTabs === 'undefined' ? [] : invoiceTabs).map(tab => ({ tab, customer: tab.cust || null })),
            cartCustomerValue: $('cart-cust')?.value || ''
        },
        undo: undoStack.slice(),
        selectedInvoices: [...selectedInvoices]
    };
}

function rollbackHistoryMutation(snapshot) {
    snapshot.invoices.forEach(({ invoice, values }) => {
        Object.keys(invoice).forEach(key => delete invoice[key]);
        Object.assign(invoice, values);
    });
    snapshot.products.forEach(({ product, stock }) => { product.stock = stock; });
    if (snapshot.customers !== null) {
        snapshot.customers.forEach(({ customer, values }) => {
            Object.keys(customer).forEach(key => delete customer[key]);
            Object.assign(customer, values);
        });
        db.custs = snapshot.customers.map(({ customer }) => customer);
    }
    snapshot.arrays.forEach(({ key, exists, value }) => {
        if (exists) db[key] = Array.isArray(value) ? value.slice() : value;
        else delete db[key];
    });
    undoStack.splice(0, undoStack.length, ...snapshot.undo);
    if (typeof cust !== 'undefined' && snapshot.customers !== null) cust = snapshot.customerUi.selectedCustomer;
    snapshot.customerUi.tabs.forEach(({ tab, customer }) => {
        tab.cust = snapshot.customers === null ? null : customer;
    });
    if ($('cart-cust')) $('cart-cust').value = snapshot.customerUi.cartCustomerValue;
    selectedInvoices.clear();
    snapshot.selectedInvoices.forEach(id => selectedInvoices.add(id));
}

function beginHistoryCommit() {
    if (saveBlockedReason) {
        if (!saveBlockedToastShown) {
            saveBlockedToastShown = true;
            toast("Không lưu dữ liệu mới vì file dữ liệu hiện tại bị lỗi. Hãy khôi phục từ backup.", "error");
        }
        return null;
    }
    if (saveSuppressed) {
        toast('Không thể lưu thay đổi lịch sử lúc này.', 'error');
        return null;
    }
    if (_saveInProgress) {
        toast('Đang lưu dữ liệu, vui lòng thử lại sau.', 'warning');
        return null;
    }
    return captureHistoryMutationSnapshot();
}

function saveHistoryCommit(snapshot) {
    // ponytail: one commit gate covers the three audited history mutations.
    if (saveNow()) return true;
    rollbackHistoryMutation(snapshot);
    return false;
}

// Direct checkout - process order without payment modal
function directCheckout() {
    // If in inline return/exchange mode, use checkoutReturnExchange instead
    if (isReturnExchangeMode) {
        return checkoutReturnExchange();
    }

    // If in tab-based return mode, use checkoutReturn instead
    if (isReturnMode()) {
        return checkoutReturn();
    }

    if (cart.length === 0) return toast("Giỏ hàng trống!", "error");
    const saleCommit = beginSaleCommit();
    if (!saleCommit) return;
    if (!validateCartItems()) return;
    syncCustomerFromInput(false);

    const method = $('cart-pay-method')?.value || 'CASH';

    // Calculate totals using existing logic
    let subtotal = 0;
    let hasWholesale = false;
    const itemsWithPrices = cart.map(i => {
        const product = db.products.find(p => sameStoredId(p.id, i.id)) || i;
        const effective = getEffectivePrice(product, i.qty, cust);
        if (effective.type === 'wholesale') hasWholesale = true;
        // Use custom price if set, otherwise effective price
        const price = i.customPrice !== undefined ? i.customPrice : effective.price;
        // Use customLineTotal if available to preserve exact user-entered values
        const lineTotal = i.customLineTotal !== undefined ? i.customLineTotal : Math.round(price * i.qty);
        subtotal += lineTotal;
        return { ...i, price: price, lineTotal: lineTotal, originalPrice: effective.price, effectivePrice: price, priceType: effective.type };
    });

    let discVal = parseInt(($('cart-discount')?.value || '0').replace(/\D/g, '')) || 0;
    let discType = $('discount-type')?.value || 'amount';
    let discount = discType === 'percent' ? Math.round(subtotal * discVal / 100) : discVal;
    const totalBeforePoints = Math.max(0, subtotal - discount);
    const pointsInfo = getCartPointsUsage(totalBeforePoints);
    const totalBeforeRounding = Math.max(0, totalBeforePoints - pointsInfo.pointsValue);
    const total = Math.round(totalBeforeRounding / 1000) * 1000;

    // Get given amount, default to total if not entered or less than total
    let given = parseInt(($('cart-customer-give')?.value || '0').replace(/\D/g, '')) || 0;
    if (given === 0 || given < total) {
        given = total;
    }
    const change = given - total;

    const saleType = hasWholesale || cust?.customerType === 'wholesale' ? 'wholesale' : 'retail';

    const inv = {
        id: Date.now().toString(),
        date: getAppDate().toISOString(),
        cust: cust?.name || 'Khách lẻ',
        custId: cust?.id,
        items: itemsWithPrices,
        subtotal, discount, pointsUsed: pointsInfo.pointsUsed, pointsValue: pointsInfo.pointsValue, total, given, change, method,
        note: window.orderNote || '',
        staff: getStaffDisplayName(currUser),
        saleType: saleType
    };

    // Update stock + Add stock history for sales
    inv.items.forEach(i => {
        const p = db.products.find(x => sameStoredId(x.id, i.id));
        if (p) {
            p.stock -= i.qty;
            // Add stock history entry for sale
            db.stockHistory.unshift({
                id: Date.now() + Math.random(),
                date: getAppDate().toISOString(),
                type: 'out',
                productId: i.id,
                productName: p.name,
                qty: i.qty,
                price: i.price,
                total: i.lineTotal || (i.qty * i.price),
                note: `Bán hàng - HĐ ${inv.id}`,
                user: currUser?.name || '',
                source: 'sale'
            });
        }
    });

    // Update customer points & totalBuy (consistent with finishOrder)
    if (cust && !sameStoredId(cust.id, 1)) {
        const dbCust = db.custs.find(c => sameStoredId(c.id, cust.id));
        if (dbCust) {
            dbCust.points = Math.max(0, (dbCust.points || 0) - pointsInfo.pointsUsed);
            if (db.settings.pointsEnabled) {
                const earned = Math.floor(total * (db.settings.pointsRate || 1) / 100);
                dbCust.points = (dbCust.points || 0) + earned;
            }
            dbCust.totalBuy = (dbCust.totalBuy || 0) + total;
        }
    }

    db.invoices.unshift(inv);
    logActivity('Bán hàng', `HĐ #${inv.id.slice(-6)} - ${money(total)}`);
    if (!saveSale(saleCommit)) return;
    toast("Thanh toán thành công!");
    playSuccessSound();

    // Print invoice
    if (db.settings.autoPrint !== false) {
        printInv(inv);
    }

    // Reset cart and payment fields
    cart = [];
    clearToastHistory(); // Reset toast deduplication for next order
    if ($('cart-discount')) $('cart-discount').value = '0';
    if ($('cart-customer-give')) $('cart-customer-give').value = '';
    if ($('cart-change')) $('cart-change').innerText = '0 ₫';
    if ($('cart-pay-method')) $('cart-pay-method').value = 'CASH';
    window.orderNote = '';
    saveCurrentTabState(); // Sync cleared cart to active invoice tab

    renderCart();

    // Reset search and category filter for next customer
    if ($('pos-search')) $('pos-search').value = '';
    if ($('pos-cat')) $('pos-cat').value = '';

    renderPos();
}

function modQty(id, d) {
    const i = cart.find(x => sameStoredId(x.id, id));
    const p = db.products.find(x => sameStoredId(x.id, id));
    if (!i) return;
    i.qty += d;
    // Clear customLineTotal when quantity changes - it's no longer accurate
    delete i.customLineTotal;
    // Allow negative stock sales - just warn if exceeding stock
    if (p && i.qty > p.stock) {
        toast(`⚠️ Vượt tồn kho: ${p.name} (Tồn: ${p.stock}, Bán: ${i.qty})`, "warning");
    }
    if (i.qty <= 0) cart = cart.filter(x => !sameStoredId(x.id, id));
    renderCart();
    saveCurrentTabState(); // Sync to active tab for multi-tab isolation
}

function upQtyMan(id, val) {
    const i = cart.find(x => sameStoredId(x.id, id));
    const p = db.products.find(x => sameStoredId(x.id, id));
    if (!i) return;
    // Use parseVN to handle Vietnamese number format (comma as decimal separator)
    let q = parseVN(val);
    if (isNaN(q) || q <= 0) q = 0.001; // Allow very small quantities for decimal sales
    // Allow negative stock sales - just warn if exceeding stock
    if (p && q > p.stock) {
        toast(`⚠️ Vượt tồn kho: ${p.name} (Tồn: ${formatQty(p.stock)}, Bán: ${formatQty(q)})`, "warning");
    }
    i.qty = q;
    // Clear customLineTotal when quantity changes - it's no longer accurate
    delete i.customLineTotal;
    renderCart();
    saveCurrentTabState(); // Sync to active tab for multi-tab isolation
}

// Update cart item price (order-specific, doesn't affect product catalog)
function updateCartItemPrice(id, priceStr) {
    const item = cart.find(x => sameStoredId(x.id, id));
    if (!item) return;
    const newPrice = parseInt((priceStr || '0').replace(/\D/g, '')) || 0;
    if (newPrice > 0) {
        item.customPrice = newPrice;
        // Clear customLineTotal when price changes - let it recalculate from price * qty
        delete item.customLineTotal;
        toast(`✓ Đã cập nhật giá: ${money(newPrice)} `, 'success');
    } else {
        delete item.customPrice; // Reset to default price
        delete item.customLineTotal;
        toast('Đã khôi phục giá gốc', 'info');
    }
    renderCart();
    saveCurrentTabState(); // Sync to active tab for multi-tab isolation
}

// Update cart item line total (order-specific, stores exact total to avoid floating-point issues)
function updateCartItemLineTotal(id, totalStr) {
    const item = cart.find(x => sameStoredId(x.id, id));
    if (!item) return;
    const newTotal = parseInt((totalStr || '0').replace(/\D/g, '')) || 0;
    if (newTotal > 0 && item.qty > 0) {
        // Store the exact line total to avoid floating-point precision issues with decimal quantities
        // e.g., qty=0.333, total=3500 -> if we calculate price=3500/0.333=10510.51 then 10510.51*0.333=3500.04
        // By storing customLineTotal directly, we preserve the exact user-entered value
        item.customLineTotal = newTotal;
        // Also calculate approximate unit price for display (but total takes precedence)
        item.customPrice = Math.round(newTotal / item.qty);
        toast(`✓ Đã cập nhật tổng giá dòng: ${money(newTotal)}`, 'success');
    } else if (newTotal === 0) {
        delete item.customPrice; // Reset to default price
        delete item.customLineTotal; // Reset custom line total
        toast('Đã khôi phục giá gốc', 'info');
    }
    renderCart();
    saveCurrentTabState(); // Sync to active tab for multi-tab isolation
}

function clearCart() {
    // If in return/exchange mode, exit it first
    if (isReturnExchangeMode) {
        toggleReturnExchangeMode();
        return;
    }

    if (cart.length > 0) pushUndo(UNDO_ACTIONS.CLEAR_CART, cart);
    cart = [];
    if ($('cart-discount')) $('cart-discount').value = 0;
    clearToastHistory(); // Reset toast deduplication
    saveCurrentTabState(); // Sync cart to tab state
    renderInvoiceTabs(); // Update tab badge
    renderCart();
}

function updateCustList() {
    const dl = $('cust-list');
    if (dl) dl.innerHTML = db.custs.map(c => `<option value="${escapeAttr(c.name)}"></option>`).join('');
}

function syncCustomerFromInput(shouldRender = true) {
    const v = ($('cart-cust')?.value || '').trim();
    cust = db.custs.find(x => x.name === v) || (v
        ? { id: 0, name: v, phone: "", points: 0, customerType: 'retail' }
        : (db.custs.find(c => sameStoredId(c.id, 1)) || defaultData.custs[0]));
    // Re-render cart to update prices based on customer type (retail/wholesale)
    if (shouldRender) renderCart();
    saveCurrentTabState();
    return cust;
}

function updateCust() {
    syncCustomerFromInput(true);
}

// PAYMENT
function openPayment() {
    if (cart.length === 0) return toast("Giỏ hàng trống!", "error");
    syncCustomerFromInput(false);

    // Calculate subtotal using effective prices (wholesale/retail)
    let sub = 0;
    cart.forEach(i => {
        const product = db.products.find(p => sameStoredId(p.id, i.id)) || i;
        const effective = getEffectivePrice(product, i.qty, cust);
        // Use custom price if set, otherwise effective price
        const price = i.customPrice !== undefined ? i.customPrice : effective.price;
        // Use customLineTotal if available to preserve exact user-entered values
        const lineTotal = i.customLineTotal !== undefined ? i.customLineTotal : Math.round(price * i.qty);
        sub += lineTotal;
    });

    let discVal = parseInt(($('cart-discount')?.value || '0').replace(/\D/g, '')) || 0;
    let discType = $('discount-type')?.value || 'amount';
    let disc = discType === 'percent' ? Math.round(sub * discVal / 100) : discVal;
    let totalBeforeRounding = Math.max(0, sub - disc);
    let total = Math.round(totalBeforeRounding / 1000) * 1000;

    if ($('pay-total-txt')) $('pay-total-txt').innerText = money(total);
    if ($('pay-give')) $('pay-give').value = '';
    if ($('pay-change')) $('pay-change').innerText = '0 ₫';
    if ($('pay-cust-points')) $('pay-cust-points').innerText = (cust?.points || 0).toLocaleString();
    if ($('use-points')) $('use-points').checked = false;
    if ($('points-input')) { $('points-input').value = ''; $('points-input').disabled = true; }
    if ($('order-note')) $('order-note').value = '';

    $('pay-modal').classList.add('active');
    setTimeout(() => $('pay-give')?.focus(), 100);
}

function togglePoints() {
    const use = $('use-points');
    const inp = $('points-input');
    if (!use || !inp) return;
    inp.disabled = !use.checked;
    if (use.checked) { inp.value = cust?.points || 0; inp.focus(); }
    else inp.value = '';
    calcChange();
}

// Format money input with thousand separators (dots)
function formatMoneyInput(input) {
    // Get cursor position
    const cursorPos = input.selectionStart;
    const oldLength = input.value.length;

    // Remove all non-digits
    let value = input.value.replace(/\D/g, '');

    // Format with dots as thousand separators (Vietnamese format)
    if (value) {
        value = parseInt(value).toLocaleString('vi-VN');
    }

    // Update input value
    input.value = value;

    // Restore cursor position (adjusted for added dots)
    const newLength = input.value.length;
    const newPos = cursorPos + (newLength - oldLength);
    input.setSelectionRange(newPos, newPos);
}

// Alias for backward compatibility
const formatPaymentInput = formatMoneyInput;
function calcChange() {
    const totalEl = $('pay-total-txt');
    const giveEl = $('pay-give');
    const changeEl = $('pay-change');
    if (!totalEl || !giveEl || !changeEl) return;

    const total = parseInt(totalEl.innerText.replace(/\D/g, '')) || 0;
    const given = parseInt((giveEl.value || '0').replace(/\D/g, '')) || 0;
    let points = 0;
    if ($('use-points')?.checked && $('points-input')) {
        points = Math.min(parseInt($('points-input').value) || 0, cust?.points || 0);
        // Cap points so their VND value doesn't exceed total
        const pv = db.settings.pointsValue || 1000;
        const maxPointsByTotal = Math.floor(total / pv);
        points = Math.min(points, Math.max(0, maxPointsByTotal));
    }
    const pointsValue = points * (db.settings.pointsValue || 1000);
    changeEl.innerText = money(Math.max(0, given - Math.max(0, total - pointsValue)));
}

function validateCartItems() {
    const invalidItems = cart.filter(i => !db.products.find(p => sameStoredId(p.id, i.id)));
    if (invalidItems.length > 0) {
        const names = invalidItems.map(i => i.name).join(', ');
        toast(`Sản phẩm đã bị xóa: ${names}. Vui lòng kiểm tra giỏ hàng!`, 'warning');
        // Remove deleted items from cart
        cart = cart.filter(i => db.products.find(p => sameStoredId(p.id, i.id)));
        renderCart();
        return false;
    }
    return true;
}

function finishOrder() {
    const saleCommit = beginSaleCommit();
    if (!saleCommit) return;
    if (!validateCartItems()) return;
    syncCustomerFromInput(false);
    const method = $('pay-method')?.value || 'CASH';

    // Calculate subtotal using effective prices
    let subtotal = 0;
    let hasWholesale = false;
    const itemsWithPrices = cart.map(i => {
        const product = db.products.find(p => sameStoredId(p.id, i.id)) || i;
        const effective = getEffectivePrice(product, i.qty, cust);
        if (effective.type === 'wholesale') hasWholesale = true;
        // Use custom price if set, otherwise effective price
        const price = i.customPrice !== undefined ? i.customPrice : effective.price;
        // Use customLineTotal if available to preserve exact user-entered values
        const lineTotal = i.customLineTotal !== undefined ? i.customLineTotal : Math.round(price * i.qty);
        subtotal += lineTotal;
        return { ...i, price: price, lineTotal: lineTotal, originalPrice: effective.price, effectivePrice: price, priceType: effective.type };
    });

    let discVal = parseInt(($('cart-discount')?.value || '0').replace(/\D/g, '')) || 0;
    let discType = $('discount-type')?.value || 'amount';
    let discount = discType === 'percent' ? Math.round(subtotal * discVal / 100) : discVal;
    let pointsUsed = 0;
    if ($('use-points')?.checked && $('points-input')) {
        pointsUsed = Math.min(parseInt($('points-input').value) || 0, cust?.points || 0);
        // Cap points so their VND value doesn't exceed (subtotal - discount)
        const pv = db.settings.pointsValue || 1000;
        const maxPointsByTotal = Math.floor(Math.max(0, subtotal - discount) / pv);
        pointsUsed = Math.min(pointsUsed, maxPointsByTotal);
    }
    const pointsValue = pointsUsed * (db.settings.pointsValue || 1000);
    const totalBeforeRounding = Math.max(0, subtotal - discount - pointsValue);
    const total = Math.round(totalBeforeRounding / 1000) * 1000;

    // Auto-fill given amount with total if not provided - no longer require manual entry
    let given = parseInt(($('pay-give')?.value || '0').replace(/\D/g, '')) || 0;
    if (given === 0 || given < total) {
        given = total; // Automatically assume full payment
    }
    const change = given - total;

    // Determine sale type - wholesale if any item uses wholesale price or customer is wholesale
    const saleType = hasWholesale || cust?.customerType === 'wholesale' ? 'wholesale' : 'retail';

    const inv = {
        id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 4),
        date: getAppDate().toISOString(),
        cust: cust?.name || 'Khách lẻ',
        custId: cust?.id,
        items: itemsWithPrices,
        subtotal, discount, pointsUsed, pointsValue, total, given, change, method,
        note: $('order-note')?.value || '',
        staff: getStaffDisplayName(currUser),
        saleType: saleType
    };

    // Update stock + Add stock history for sales
    inv.items.forEach(i => {
        const p = db.products.find(x => sameStoredId(x.id, i.id));
        if (p) {
            p.stock -= i.qty;
            // Add stock history entry for sale
            db.stockHistory.unshift({
                id: Date.now() + Math.random(),
                date: getAppDate().toISOString(),
                type: 'out',
                productId: i.id,
                productName: p.name,
                qty: i.qty,
                price: i.price,
                total: i.lineTotal || (i.qty * i.price),
                note: `Bán hàng - HĐ ${inv.id}`,
                user: currUser?.name || '',
                source: 'sale'
            });
        }
    });

    // Update customer points & totalBuy
    if (cust && !sameStoredId(cust.id, 1)) {
        const dbCust = db.custs.find(c => sameStoredId(c.id, cust.id));
        if (dbCust) {
            dbCust.points = (dbCust.points || 0) - pointsUsed;
            if (db.settings.pointsEnabled) {
                const earned = Math.floor(total * (db.settings.pointsRate || 1) / 100);
                dbCust.points += earned;
            }
            dbCust.totalBuy = (dbCust.totalBuy || 0) + total;
        }
    }

    db.invoices.unshift(inv);
    logActivity('Bán hàng', `HĐ #${inv.id.slice(-6)} - ${money(total)} `);
    if (!saveSale(saleCommit)) return;
    toast("Thanh toán thành công!");
    playSuccessSound();

    // Print invoice after checkout (unless autoPrint is explicitly disabled)
    // Note: 'silent' means print without dialog, not skip printing
    if (db.settings.autoPrint !== false) {
        printInv(inv);
    }

    cart = [];
    clearToastHistory(); // Reset toast deduplication for next order
    saveCurrentTabState(); // Sync cleared cart to active invoice tab
    renderCart();
    closeModal('pay-modal');

    // Reset search and category filter after checkout for next customer
    const posSearch = $('pos-search');
    if (posSearch) posSearch.value = '';
    const posCat = $('pos-cat');
    if (posCat) posCat.value = '';

    renderPos();
}

function printInv(inv) {
    // Guard clause: check if invoice and items exist
    if (!inv || !inv.items || !Array.isArray(inv.items)) {
        toast("Không tìm thấy hóa đơn hoặc dữ liệu bị lỗi!", "error");
        return;
    }

    const s = db.settings;
    const d = new Date(inv.date);
    const tm = `${d.getDate()} /${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')} `;
    const invoiceDisplayId = escapeHtml(String(inv.id || '').slice(-6));
    const safeStoreName = escapeHtml(s.name || '');
    const safeCustomer = escapeHtml(inv.cust || 'Khách lẻ');
    const safeStaff = escapeHtml(inv.staff || '-');
    const safeFooter = escapeHtml(s.footer || 'Cảm ơn quý khách!');

    // Build items HTML with 3-column format: Đơn giá | SL | Thành tiền
    // Using simple layout for better thermal printer compatibility
    let itemsHtml = `
        <div style="display:table; width:100%; font-size:11px; border-bottom:1px dashed #000; padding:4px 0;">
            <div style="display:table-cell; width:50%; text-align:left; font-weight:bold;">Đơn giá</div>
            <div style="display:table-cell; width:20%; text-align:center; font-weight:bold;">SL</div>
            <div style="display:table-cell; width:30%; text-align:right; font-weight:bold;">Thành tiền</div>
        </div>`;
    inv.items.forEach(i => {
        const itemName = escapeHtml(i.name || 'Sản phẩm');
        // Check if item has discount (price < originalPrice)
        const hasDiscount = i.originalPrice && i.price < i.originalPrice;
        const priceDisplay = hasDiscount
            ? `${parseInt(i.price).toLocaleString('vi-VN')} <span style="text-decoration:line-through;color:#666;font-size:9px;">${parseInt(i.originalPrice).toLocaleString('vi-VN')}</span>`
            : parseInt(i.price).toLocaleString('vi-VN');
        // Use lineTotal if available (preserves exact user-entered values for decimal quantities)
        const lineTotal = i.lineTotal !== undefined ? i.lineTotal : Math.round(i.qty * i.price);

        itemsHtml += `
            <div style="padding:4px 0; page-break-inside:avoid;">
                <div style="font-weight:bold; font-size:12px; margin-bottom:2px;">${itemName}</div>
                <div style="display:table; width:100%; font-size:11px;">
                    <div style="display:table-cell; width:50%; text-align:left;">${priceDisplay}</div>
                    <div style="display:table-cell; width:20%; text-align:center;">${formatQty(i.qty)}</div>
                    <div style="display:table-cell; width:30%; text-align:right; font-weight:bold;">${lineTotal.toLocaleString('vi-VN')}</div>
                </div>
            </div>`;
    });

    // QR code section
    let qrHtml = '';
    if (s.qr && s.num) {
        qrHtml = `
            <div style="border-bottom:1px dashed #000; margin:6px 0;"></div>
            <div style="text-align:center; padding:8px 0;">
                <div style="font-style:italic; font-size:11px;">Quét QR thanh toán</div>
                <img src="${escapeAttr(safeImageSrc(s.qr))}" style="max-width:100px; height:auto; margin:4px 0;">
                <div style="font-weight:bold; font-size:13px;">${escapeHtml(s.bank || '')}</div>
                <div style="font-size:12px;">${escapeHtml(s.num || '')} - ${escapeHtml(s.owner || '')}</div>
            </div>`;
    }


    // Complete receipt HTML - using minimal CSS for maximum thermal printer compatibility
    const receiptContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Hóa đơn #${invoiceDisplayId}</title>
    <style>
        /* Reset and base styles - CRITICAL: prevent ALL page breaks */
        * { 
            margin: 0; 
            padding: 0; 
            box-sizing: border-box;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }

        /* Page settings for thermal printers - use large fixed height to prevent page breaks */
        @page {
            size: 72mm 297mm;
            margin: 0;
        }

        html, body {
            width: 72mm;
            max-width: 72mm;
            font-family: 'Arial', 'Helvetica', sans-serif;
            font-size: 12px;
            line-height: 1.3;
            color: #000;
            background: #fff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-before: avoid !important;
            page-break-after: avoid !important;
            orphans: 99 !important;
            widows: 99 !important;
        }

        body { padding: 3mm; }

        /* Receipt wrapper - CRITICAL for preventing page breaks */
        .receipt-wrapper {
            display: block !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-before: avoid !important;
            page-break-after: avoid !important;
        }

        /* Receipt container - prevent page breaks inside */
        .receipt { 
            width: 100%; 
            display: block !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-before: avoid !important;
            page-break-after: avoid !important;
        }

        /* Text alignment helpers */
        .center { text-align: center; }
        .bold { font-weight: bold; }

        /* Row - use block+float instead of flex to prevent page breaks */
        .row {
            display: block !important;
            overflow: hidden !important;
            padding: 2px 0;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }
        .row span:first-child { float: left; }
        .row span:last-child { float: right; }

        /* Dashed line separator */
        .line {
            border-bottom: 1px dashed #000;
            margin: 6px 0;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }

        /* Item section - prevent breaks */
        .item-row {
            display: block !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }
        .item-row > div {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }
        .item-row > div[style*="flex"] {
            display: block !important;
            overflow: hidden !important;
        }
        .item-row > div[style*="flex"] span:first-child { float: left; }
        .item-row > div[style*="flex"] span:last-child { float: right; }

        /* Print-specific styles */
        @media print {
            @page {
                size: 72mm 297mm;
                margin: 0;
            }
            html, body {
                width: 72mm !important;
                max-width: 72mm !important;
                height: auto !important;
                overflow: visible !important;
            }
            body { padding: 2mm !important; }
            .receipt-wrapper, .receipt, .row, .item-row, .line, div {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
                orphans: 99 !important;
                widows: 99 !important;
            }
        }
    </style>
</head>
<body>
    <div class="receipt">
        ${s.name ? `<div class="center bold" style="font-size:16px; margin-bottom:3px;">${safeStoreName}</div>` : ''}
        ${s.addr ? `<div class="center" style="font-size:11px;">Địa chỉ: ${escapeHtml(s.addr)}</div>` : ''}
        ${s.phone ? `<div class="center" style="font-size:11px;">Điện thoại: ${escapeHtml(s.phone)}</div>` : ''}
        <div style="font-size:11px; padding:4px 0;">Ngày bán: ${tm}</div>
        <div class="line"></div>
        <div class="center bold" style="font-size:14px; margin:4px 0;">HOÁ ĐƠN BÁN HÀNG</div>
        <div class="center" style="font-size:11px; margin-bottom:6px;">HD${invoiceDisplayId}</div>
        <div style="font-size:11px; line-height:1.5;">
            <div><b>Khách hàng:</b> ${safeCustomer}</div>
            <div><b>Địa chỉ:</b> </div>
            <div><b>Khu vực:</b> </div>
            <div><b>Thời gian giao hàng:</b> </div>
            <div><b>Điện thoại:</b> </div>
        </div>
        <div style="font-size:11px; padding:6px 0;"><b>Người bán:</b> ${safeStaff}</div>
        <div class="line"></div>
        ${itemsHtml}
        <div class="line"></div>
        <div style="text-align:right; font-size:11px; line-height:1.6;">
            <div><span>Tổng tiền hàng:</span> <span style="min-width:80px; display:inline-block;">${money(inv.subtotal)}</span></div>
            <div><span>Chiết khấu:</span> <span style="min-width:80px; display:inline-block;">${inv.discount > 0 ? money(inv.discount) : '0'}</span></div>
            <div style="font-weight:bold;"><span>Tổng cộng:</span> <span style="min-width:80px; display:inline-block;">${moneyRounded(inv.total)}</span></div>
        </div>
        ${qrHtml}
        <div class="line"></div>
        <div class="center" style="font-style:italic; font-size:11px; margin:4px 0;">${safeFooter}</div>
        <div style="margin-bottom: 10mm;"></div>
    </div>
</body>
</html>`;

    // Use iframe approach for Electron compatibility instead of window.open()
    let printIframe = document.getElementById('invoice-print-iframe');
    if (!printIframe) {
        printIframe = document.createElement('iframe');
        printIframe.id = 'invoice-print-iframe';
        printIframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;border:none;background:#fff;';
        document.body.appendChild(printIframe);
    } else {
        printIframe.style.display = 'block';
    }

    // Add close button and print controls to receipt content
    const printContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Hóa đơn #${invoiceDisplayId}</title>
    <style>
        /* Reset and base styles - CRITICAL: prevent ALL page breaks */
        * { 
            margin: 0; 
            padding: 0; 
            box-sizing: border-box;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }

        /* Page settings for thermal printers - use large fixed height to prevent page breaks */
        @page {
            size: 72mm 297mm;
            margin: 0;
        }

        html, body {
            width: 72mm;
            max-width: 72mm;
            font-family: 'Arial', 'Helvetica', sans-serif;
            font-size: 12px;
            line-height: 1.3;
            color: #000;
            background: #fff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-before: avoid !important;
            page-break-after: avoid !important;
            orphans: 99 !important;
            widows: 99 !important;
        }

        body { padding: 3mm; }

        /* Preview controls - hidden when printing */
        .preview-controls {
            position: fixed;
            top: 0; left: 0; right: 0;
            background: linear-gradient(135deg, #6366F1, #8B5CF6);
            color: white;
            padding: 12px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 1000;
            font-size: 14px;
        }
        .preview-controls button {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            margin-left: 8px;
        }
        .btn-print { background: #10B981; color: white; }
        .btn-close { background: #EF4444; color: white; }

        /* Receipt wrapper - CRITICAL for preventing page breaks */
        .receipt-wrapper {
            display: block !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-before: avoid !important;
            page-break-after: avoid !important;
        }

        /* Receipt container - prevent page breaks inside */
        .receipt { 
            width: 100%; 
            display: block !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-before: avoid !important;
            page-break-after: avoid !important;
        }

        /* Text alignment helpers */
        .center { text-align: center; }
        .bold { font-weight: bold; }

        /* Row - use block+float instead of flex to prevent page breaks */
        .row {
            display: block !important;
            overflow: hidden !important;
            padding: 2px 0;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }
        .row span:first-child { float: left; }
        .row span:last-child { float: right; }

        /* Dashed line separator */
        .line {
            border-bottom: 1px dashed #000;
            margin: 6px 0;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }

        /* Item section - prevent breaks */
        .item-row {
            display: block !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }
        .item-row > div {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }
        .item-row > div[style*="flex"] {
            display: block !important;
            overflow: hidden !important;
        }
        .item-row > div[style*="flex"] span:first-child { float: left; }
        .item-row > div[style*="flex"] span:last-child { float: right; }

        /* Print-specific styles */
        @media print {
            .preview-controls { display: none !important; }
            @page {
                size: 72mm 297mm;
                margin: 0;
            }
            html, body {
                width: 72mm !important;
                max-width: 72mm !important;
                height: auto !important;
                overflow: visible !important;
            }
            body { padding: 2mm !important; padding-top: 2mm !important; }
            .receipt-wrapper, .receipt, .row, .item-row, .line, div {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
                orphans: 99 !important;
                widows: 99 !important;
            }
        }

        /* Screen preview */
        @media screen {
            html, body { width: 100%; max-width: 100%; }
            body { 
                padding: 80px 20px 20px 20px; 
                background: #f5f5f5;
                display: flex;
                justify-content: center;
            }
            .receipt { 
                background: white; 
                padding: 15px;
                width: 72mm;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                border-radius: 4px;
            }
        }
    </style>
</head>
<body>
    <div class="preview-controls">
        <span>🧾 Hóa đơn #${invoiceDisplayId} - ${safeCustomer}</span>
        <div>
            <button class="btn-print" id="print-btn">🖨️ In</button>
            <button class="btn-close" id="close-btn">✕</button>
        </div>
    </div>
    <div class="receipt">
        ${s.name ? `<div class="center bold" style="font-size:16px; margin-bottom:3px;">${safeStoreName}</div>` : ''}
        ${s.addr ? `<div class="center" style="font-size:11px;">Địa chỉ: ${escapeHtml(s.addr)}</div>` : ''}
        ${s.phone ? `<div class="center" style="font-size:11px;">Điện thoại: ${escapeHtml(s.phone)}</div>` : ''}
        <div style="font-size:11px; padding:4px 0;">Ngày bán: ${tm}</div>
        <div class="line"></div>
        <div class="center bold" style="font-size:14px; margin:4px 0;">HOÁ ĐƠN BÁN HÀNG</div>
        <div class="center" style="font-size:11px; margin-bottom:6px;">HD${invoiceDisplayId}</div>
        <div style="font-size:11px; line-height:1.5;">
            <div><b>Khách hàng:</b> ${safeCustomer}</div>
            <div><b>Địa chỉ:</b> </div>
            <div><b>Khu vực:</b> </div>
            <div><b>Thời gian giao hàng:</b> </div>
            <div><b>Điện thoại:</b> </div>
        </div>
        <div style="font-size:11px; padding:6px 0;"><b>Người bán:</b> ${safeStaff}</div>
        <div class="line"></div>
        ${itemsHtml}
        <div class="line"></div>
        <div style="text-align:right; font-size:11px; line-height:1.6;">
            <div><span>Tổng tiền hàng:</span> <span style="min-width:80px; display:inline-block;">${money(inv.subtotal)}</span></div>
            <div><span>Chiết khấu:</span> <span style="min-width:80px; display:inline-block;">${inv.discount > 0 ? money(inv.discount) : '0'}</span></div>
            <div style="font-weight:bold;"><span>Tổng cộng:</span> <span style="min-width:80px; display:inline-block;">${moneyRounded(inv.total)}</span></div>
        </div>
        ${qrHtml}
        <div class="line"></div>
        <div class="center" style="font-style:italic; font-size:11px; margin:4px 0;">${safeFooter}</div>
        <div style="margin-bottom: 10mm;"></div>
    </div>
</body>
</html>`;

    // Write content to iframe
    const iframeDoc = printIframe.contentDocument || printIframe.contentWindow?.document;
    if (!iframeDoc) { toast('Không thể tạo tài liệu in!', 'error'); return; }
    iframeDoc.open();
    iframeDoc.write(printContent);
    iframeDoc.close();

    // Wait for iframe to load then setup event handlers
    setTimeout(() => {
        const printBtn = iframeDoc.getElementById('print-btn');
        const closeBtn = iframeDoc.getElementById('close-btn');

        if (printBtn) {
            printBtn.onclick = function () {
                printIframe.contentWindow.print();
            };
        }
        if (closeBtn) {
            closeBtn.onclick = function () {
                printIframe.style.display = 'none';
            };
        }

        // Handle afterprint event
        printIframe.contentWindow.onafterprint = function () {
            printIframe.style.display = 'none';
        };
    }, 100);
}

// Alias for keyboard shortcuts (F3, Ctrl+P)
const printInvoice = printInv;

// PRODUCTS
let prodTablePage = 0;
const PROD_PAGE_SIZE = 100;

function parseProductFilterNumber(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return null;
    const num = parseInt(digits, 10);
    return Number.isFinite(num) ? num : null;
}

function getProductStockStatus(p) {
    const stock = parseFloat(p.stock) || 0;
    const lowStock = db.settings.lowStock || 5;
    if (stock <= 0) return 'out';
    if (stock <= lowStock) return 'low';
    return 'in';
}

function getProductStatusLabel(status) {
    return { in: 'Còn hàng', low: 'Sắp hết', out: 'Hết hàng' }[status] || 'Còn hàng';
}

function getProductStatusBadge(p) {
    const status = getProductStockStatus(p);
    const badgeClass = status === 'out' ? 'badge-danger' : status === 'low' ? 'badge-warning' : 'badge-success';
    return `<span class="badge ${badgeClass}">${getProductStatusLabel(status)}</span>`;
}

function isAdminUser() {
    return currUser?.role === 'admin';
}

function normalizeProductSort(sortValue) {
    const needsAdmin = sortValue === 'cost_asc' || sortValue === 'cost_desc';
    if (needsAdmin && !isAdminUser()) return 'new_desc';
    return sortValue || 'new_desc';
}

function getProductFilterOptions(source) {
    const isTable = source === 'table';
    const prefix = isTable ? 'prod' : 'pos';
    const sortEl = $(isTable ? 'prod-sort' : 'pos-sort');
    return {
        source,
        search: ($(isTable ? 'prod-search' : 'pos-search')?.value || '').trim(),
        category: ($(isTable ? 'prod-filter-cat' : 'pos-cat')?.value || '').trim(),
        status: $(`${prefix}-filter-status`)?.value || '',
        priceMin: parseProductFilterNumber($(`${prefix}-price-min`)?.value),
        priceMax: parseProductFilterNumber($(`${prefix}-price-max`)?.value),
        sort: normalizeProductSort(sortEl?.value || 'new_desc')
    };
}

function applyProductFilters(products, options = {}) {
    const lowStock = db.settings.lowStock || 5;
    const keywords = String(options.search || '').toLowerCase().split(/\s+/).filter(Boolean);
    let min = options.priceMin;
    let max = options.priceMax;
    if (min !== null && max !== null && min > max) [min, max] = [max, min];

    const filtered = (products || []).filter(p => {
        if (options.category === 'low_stock') {
            if ((parseFloat(p.stock) || 0) > lowStock) return false;
        } else if (options.category && p.cat !== options.category) {
            return false;
        }

        if (options.status && getProductStockStatus(p) !== options.status) return false;

        const price = parseFloat(p.price) || 0;
        if (min !== null && price < min) return false;
        if (max !== null && price > max) return false;

        if (keywords.length > 0) {
            const nameLC = String(p.name || '').toLowerCase();
            const codeLC = String(p.code || '').toLowerCase();
            if (!keywords.every(k => nameLC.includes(k) || codeLC.includes(k))) return false;
        }

        return true;
    });

    const sort = normalizeProductSort(options.sort);
    const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi', { sensitivity: 'base' });
    const byNumber = (field) => (a, b) => (parseFloat(a[field]) || 0) - (parseFloat(b[field]) || 0);
    const byNewest = (a, b) => (parseFloat(b.id) || 0) - (parseFloat(a.id) || 0);

    const sorters = {
        name_asc: byName,
        name_desc: (a, b) => byName(b, a),
        price_asc: byNumber('price'),
        price_desc: (a, b) => byNumber('price')(b, a),
        cost_asc: byNumber('cost'),
        cost_desc: (a, b) => byNumber('cost')(b, a),
        stock_asc: byNumber('stock'),
        stock_desc: (a, b) => byNumber('stock')(b, a),
        new_desc: byNewest
    };

    const sorter = sorters[sort] || byNewest;
    return filtered.sort((a, b) => sorter(a, b) || byName(a, b) || byNewest(a, b));
}

function getFilteredProductsForTable() {
    return applyProductFilters(db.products, getProductFilterOptions('table'));
}

function getFilteredProductsForPos() {
    return applyProductFilters(db.products, getProductFilterOptions('pos'));
}

function updateAdminProductSortOptions() {
    const admin = isAdminUser();
    document.querySelectorAll('#prod-sort option[data-admin-only="true"], #pos-sort option[data-admin-only="true"]').forEach(option => {
        option.disabled = !admin;
        option.hidden = !admin;
    });
    ['prod-sort', 'pos-sort'].forEach(id => {
        const select = $(id);
        if (select && normalizeProductSort(select.value) !== select.value) select.value = 'new_desc';
    });
}

function isProductFilterActive(source) {
    const prefix = source === 'table' ? 'prod' : 'pos';
    const sortValue = $(`${prefix}-sort`)?.value || 'new_desc';
    return !!(
        $(`${prefix}-filter-status`)?.value ||
        $(`${prefix}-price-min`)?.value ||
        $(`${prefix}-price-max`)?.value ||
        sortValue !== 'new_desc'
    );
}

function updateProductFilterUI() {
    updateAdminProductSortOptions();
    const posToggle = $('pos-filter-toggle');
    if (posToggle) posToggle.classList.toggle('active', isProductFilterActive('pos'));

    const indicator = $('prod-name-sort-indicator');
    const prodSort = $('prod-sort')?.value || 'new_desc';
    if (indicator) {
        indicator.textContent = prodSort === 'name_asc' ? '▲' : prodSort === 'name_desc' ? '▼' : '';
    }
}

function resetProductNavigationState() {
    currentVisibleLimit = MAX_VISIBLE_PRODUCTS;
    posSelectedIndex = -1;
    posSelectedProductId = null;
    isNavigatingProducts = false;
    if (typeof focusedProductIndex !== 'undefined') focusedProductIndex = -1;
}

function onProductTableFiltersChanged() {
    prodTablePage = 0;
    renderProdTable();
}

function onPosProductFiltersChanged() {
    resetProductNavigationState();
    renderPos();
}

function resetProductTableFilters() {
    ['prod-filter-cat', 'prod-search', 'prod-filter-status', 'prod-price-min', 'prod-price-max'].forEach(id => {
        const el = $(id);
        if (el) el.value = '';
    });
    if ($('prod-sort')) $('prod-sort').value = 'new_desc';
    onProductTableFiltersChanged();
}

function resetPosProductFilters() {
    ['pos-filter-status', 'pos-price-min', 'pos-price-max'].forEach(id => {
        const el = $(id);
        if (el) el.value = '';
    });
    if ($('pos-sort')) $('pos-sort').value = 'new_desc';
    onPosProductFiltersChanged();
}

function toggleProdNameSort() {
    const sort = $('prod-sort');
    if (!sort) return;
    sort.value = sort.value === 'name_asc' ? 'name_desc' : 'name_asc';
    onProductTableFiltersChanged();
}

function togglePosProductFilters(event) {
    event?.stopPropagation();
    $('pos-filter-popover')?.classList.toggle('active');
}

document.addEventListener('click', function (event) {
    const popover = $('pos-filter-popover');
    const wrap = document.querySelector('.pos-filter-wrap');
    if (popover?.classList.contains('active') && wrap && !wrap.contains(event.target)) {
        popover.classList.remove('active');
    }
});

function renderProdTable() {
    const tbody = $('prod-body');
    if (!tbody) return;
    updateProductFilterUI();

    // Clear selections when re-rendering
    selectedProducts.clear();
    updateBulkDeleteUI('products');

    const canManage = isAuthenticated && ['admin', 'manager'].includes(currUser?.role);
    const filtered = getFilteredProductsForTable();
    const totalItems = filtered.length;
    const pageItems = filtered.slice(0, (prodTablePage + 1) * PROD_PAGE_SIZE);

    if (totalItems === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:18px;color:var(--text-muted);">Không có sản phẩm phù hợp</td></tr>';
        return;
    }

    tbody.innerHTML = pageItems.map(p => {
        const statusBadge = getProductStatusBadge(p);
        const productIdAttr = escapeAttr(String(p.id ?? ''));
        const productIdJs = escapeJsArgument(p.id);

        // Wholesale info
        const imgSrc = safeImageSrc(p.img);
        const wholesaleInfo = p.wholesalePrice > 0 ?
            `<div style="font-size:11px;color:var(--warning-dark,#b45309);">📦 ${money(p.wholesalePrice)} (≥${p.minWholesaleQty || 10})</div>` : '';

        return `<tr>
            <td style="width:40px;text-align:center;">${canManage ? `<input type="checkbox" data-id="${productIdAttr}" onchange="toggleProductSelect(${productIdJs})" style="width:18px;height:18px;cursor:pointer;">` : ''}</td>
            <td>${imgSrc ? `<img src="${escapeAttr(imgSrc)}" style="width:45px;height:45px;object-fit:cover;border-radius:8px">` : '<span style="color:var(--text-muted)">📷</span>'}</td>
            <td><code>${escapeHtml(p.code || '-')}</code></td>
            <td><strong>${escapeHtml(p.name)}</strong></td>
            <td><span class="badge badge-secondary">${escapeHtml(p.cat)}</span></td>
            <td style="white-space:nowrap"><div style="font-weight:600;color:var(--primary);">${money(p.price)}</div>${wholesaleInfo}</td>
            <td style="white-space:nowrap">${currUser?.role === 'admin' ? money(p.cost || 0) : '***'}</td>
            <td style="font-weight:600">${formatQty(p.stock)}</td>
            <td>${statusBadge}</td>
            <td style="white-space:nowrap">
                <button class="btn-sm btn-secondary" onclick="openLabelPrintModal(${productIdJs})" title="In tem">🏷️</button>
                ${canManage ? `<button class="btn-sm btn-secondary" onclick="editP(${productIdJs})">Sửa</button><button class="btn-sm btn-danger" onclick="delP(${productIdJs})">Xóa</button>` : ''}
            </td>
        </tr>`;
    }).join('');

    // Show "load more" row if there are more items
    if (pageItems.length < totalItems) {
        tbody.innerHTML += `<tr><td colspan="10" style="text-align:center;padding:12px;">
            <button class="btn btn-secondary" onclick="prodTablePage++;renderProdTable();">Xem thêm (${pageItems.length}/${totalItems})</button>
        </td></tr>`;
    }
}

function openProdModal() {
    if (!canMutateManagement()) return;
    $('prod-modal').classList.add('active');
    renderCategories();
    $('p-id').value = '';
    $('p-name').value = '';
    $('p-code').value = '';
    $('p-price').value = '';
    $('p-cost').value = '';
    $('p-stock').value = '';
    if ($('p-cat-search')) $('p-cat-search').value = db.categories[0] || '';
    $('p-file').value = '';
    $('p-img-data').value = '';
    if ($('p-unit')) $('p-unit').value = '';
    if ($('p-wholesale-price')) $('p-wholesale-price').value = '';
    if ($('p-min-wholesale')) $('p-min-wholesale').value = '10';
    if ($('quick-cat-inline')) $('quick-cat-inline').style.display = 'none';
}

function editP(id) {
    if (!canMutateManagement()) return;
    openProdModal();
    const p = db.products.find(x => sameStoredId(x.id, id));
    if (!p) return;
    $('p-id').value = p.id;
    $('p-name').value = p.name;
    $('p-code').value = p.code || '';
    $('p-price').value = p.price ? p.price.toLocaleString('vi-VN') : '';
    $('p-cost').value = p.cost ? p.cost.toLocaleString('vi-VN') : '';
    $('p-stock').value = p.stock || 0;
    if ($('p-cat-search')) $('p-cat-search').value = p.cat || '';
    $('p-img-data').value = p.img || '';
    if ($('p-unit')) $('p-unit').value = p.unit || '';
    if ($('p-wholesale-price')) $('p-wholesale-price').value = p.wholesalePrice ? p.wholesalePrice.toLocaleString('vi-VN') : '';
    if ($('p-min-wholesale')) $('p-min-wholesale').value = p.minWholesaleQty || 10;
}

function handlePImg(inp) { compress(inp, res => $('p-img-data').value = res); }

function saveProd() {
    if (!canMutateManagement()) return false;
    const id = $('p-id').value;
    const existingProduct = id ? db.products.find(x => sameStoredId(x.id, id)) : null;
    const p = {
        id: existingProduct?.id ?? Date.now(),
        name: $('p-name').value.trim(),
        code: $('p-code').value.trim(),
        price: parseInt(($('p-price').value || '0').replace(/\D/g, '')) || 0,
        cost: parseInt(($('p-cost').value || '0').replace(/\D/g, '')) || 0,
        stock: parseFloat($('p-stock').value) || 0,
        cat: $('p-cat-search')?.value.trim() || db.categories[0] || '',
        img: $('p-img-data').value,
        unit: $('p-unit')?.value || '',
        wholesalePrice: parseInt(($('p-wholesale-price')?.value || '0').replace(/\D/g, '')) || 0,
        minWholesaleQty: parseInt($('p-min-wholesale')?.value) || 10
    };
    if (!p.name || !p.price) {
        toast("Nhập tên và giá!", "error");
        return false;
    }

    if (p.code) {
        const normalizedCode = p.code.toLowerCase();
        const duplicateCode = db.products.find(x =>
            !sameStoredId(x.id, p.id) && (x.code || '').trim().toLowerCase() === normalizedCode
        );
        if (duplicateCode) {
            toast(`Mã "${p.code}" đã được dùng cho sản phẩm "${duplicateCode.name}"!`, "error");
            return false;
        }
    }

    // Check for duplicate product name (only when adding new product)
    if (!id) {
        const duplicateName = db.products.find(x =>
            x.name.toLowerCase().trim() === p.name.toLowerCase().trim()
        );
        if (duplicateName) {
            toast(`Sản phẩm "${p.name}" đã tồn tại trong kho!`, "error");
            return false;
        }
    }

    const productIndex = existingProduct ? db.products.indexOf(existingProduct) : -1;
    if (id && productIndex < 0) {
        toast("Không tìm thấy sản phẩm!", "error");
        return false;
    }

    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return false;

    let categoryAdded = false;
    if (p.cat && !db.categories.includes(p.cat)) {
        db.categories.push(p.cat);
        categoryAdded = true;
    }

    if (id) {
        const previous = db.products[productIndex];
        const previousStock = parseFloat(previous.stock) || 0;
        const stockDiff = p.stock - previousStock;
        db.products[productIndex] = p;

        if (stockDiff !== 0) {
            db.stockHistory.unshift({
                id: Date.now() + Math.random(),
                date: getAppDate().toISOString(),
                type: stockDiff > 0 ? 'in' : 'out',
                productId: p.id,
                productName: p.name,
                qty: Math.abs(stockDiff),
                price: p.cost,
                total: Math.abs(stockDiff) * p.cost,
                note: 'Điều chỉnh tồn kho (sửa sản phẩm)',
                user: currUser?.name || '',
                source: 'adjustment'
            });
        }
        logActivity('Sửa SP', p.name);
    } else {
        db.products.push(p);
        logActivity('Thêm SP', p.name);
    }
    if (!saveInventoryCommit(inventoryCommit)) return false;
    renderProdTable();
    if (categoryAdded) renderCategories();
    renderPos();
    closeModal('prod-modal');
    toast("Đã lưu sản phẩm!");
    return true;
}

function getProductDependencies(productId) {
    const deps = [];
    // Check active carts across all tabs
    const tabsWithProduct = invoiceTabs.filter(tab =>
        (tab.cart && tab.cart.some(i => sameStoredId(i.id, productId))) ||
        (tab.returnItems && tab.returnItems.some(i => sameStoredId(i.id, productId))) ||
        (tab.exchangeItems && tab.exchangeItems.some(i => sameStoredId(i.id, productId)))
    );
    if (tabsWithProduct.length > 0) deps.push(`${tabsWithProduct.length} đơn hàng đang mở`);
    if (cart.some(i => sameStoredId(i.id, productId))) deps.push('giỏ hàng hiện tại');
    if (returnItems.some(i => sameStoredId(i.id, productId)) || exchangeItems.some(i => sameStoredId(i.id, productId))) {
        deps.push('giỏ đổi/trả hiện tại');
    }
    // Check invoices
    const invCount = db.invoices.filter(inv => inv.items && inv.items.some(i => sameStoredId(i.id, productId))).length;
    if (invCount > 0) deps.push(`${invCount} hóa đơn`);
    // Check POs
    const poCount = (db.purchaseOrders || []).filter(po => po.items && po.items.some(i => sameStoredId(i.id, productId))).length;
    if (poCount > 0) deps.push(`${poCount} phiếu nhập`);
    const returnCount = (db.returns || []).filter(r =>
        (r.returnItems || r.items || []).some(i => sameStoredId(i.id, productId)) ||
        (r.exchangeItems || []).some(i => sameStoredId(i.id, productId))
    ).length;
    if (returnCount > 0) deps.push(`${returnCount} phiếu đổi/trả`);
    const stockHistoryCount = (db.stockHistory || []).filter(h => sameStoredId(h.productId, productId)).length;
    if (stockHistoryCount > 0) deps.push(`${stockHistoryCount} lịch sử kho`);
    return deps;
}

function delP(id) {
    if (!canMutateManagement()) return;
    const p = db.products.find(x => sameStoredId(x.id, id));
    const deps = getProductDependencies(id);
    if (deps.length > 0) {
        toast(`Không thể xóa "${p?.name || 'sản phẩm'}" vì đang liên kết với: ${deps.join(', ')}.`, "warning");
        return;
    }
    const msg = "Xóa sản phẩm này?";
    if (confirm(msg)) {
        const inventoryCommit = beginInventoryCommit();
        if (!inventoryCommit) return;
        if (p) pushUndo(UNDO_ACTIONS.DELETE_PRODUCT, p);
        db.products = db.products.filter(x => !sameStoredId(x.id, id));
        if (p) logActivity('Xóa SP', p.name);
        if (!saveInventoryCommit(inventoryCommit)) return;
        renderProdTable();
        renderPos();
    }
}

// BULK DELETE - PRODUCTS
function toggleProductSelect(id) {
    if (selectedProducts.has(id)) {
        selectedProducts.delete(id);
    } else {
        selectedProducts.add(id);
    }
    updateBulkDeleteUI('products');
}

function toggleAllProducts(checkbox) {
    const tbody = $('prod-body');
    if (!tbody) return;
    const checkboxes = tbody.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        const product = db.products.find(item => sameStoredId(item.id, cb.dataset.id));
        if (!product) return;
        const id = product.id;
        if (checkbox.checked) {
            selectedProducts.add(id);
            cb.checked = true;
        } else {
            selectedProducts.delete(id);
            cb.checked = false;
        }
    });
    updateBulkDeleteUI('products');
}

function deleteSelectedProducts() {
    if (!canMutateManagement()) return;
    if (selectedProducts.size === 0) return toast("Chưa chọn sản phẩm nào!", "warning");

    // Check dependencies for all selected products
    let totalDeps = [];
    selectedProducts.forEach(id => {
        const deps = getProductDependencies(id);
        if (deps.length > 0) {
            const p = db.products.find(x => sameStoredId(x.id, id));
            totalDeps.push(`${p?.name || id}: ${deps.join(', ')}`);
        }
    });
    if (totalDeps.length > 0) {
        const detail = totalDeps.slice(0, 3).join('; ');
        toast(`Không thể xóa sản phẩm đang liên kết dữ liệu: ${detail}${totalDeps.length > 3 ? '...' : ''}`, "warning");
        return;
    }
    let msg = `Xóa ${selectedProducts.size} sản phẩm đã chọn?`;
    if (!confirm(msg)) return;
    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;

    const names = [];
    selectedProducts.forEach(id => {
        const p = db.products.find(x => sameStoredId(x.id, id));
        if (p) {
            // Push to undo stack before deleting
            pushUndo(UNDO_ACTIONS.DELETE_PRODUCT, p);
            names.push(p.name);
        }
        db.products = db.products.filter(x => !sameStoredId(x.id, id));
    });

    logActivity('Xóa SP hàng loạt', `${names.length} sản phẩm`);
    if (!saveInventoryCommit(inventoryCommit)) return;
    selectedProducts.clear();
    renderProdTable();
    renderPos();
    updateBulkDeleteUI('products');
    toast(`Đã xóa ${names.length} sản phẩm!`);
}


function updateBulkDeleteUI(type) {
    if (type === 'products') {
        const btn = $('bulk-delete-products-btn');
        if (btn) {
            btn.style.display = selectedProducts.size > 0 ? 'inline-flex' : 'none';
            btn.innerHTML = `🗑️ Xóa(${selectedProducts.size})`;
        }
        // Update header checkbox
        const headerCb = $('select-all-products');
        if (headerCb) {
            const tbody = $('prod-body');
            const total = tbody ? tbody.querySelectorAll('input[type="checkbox"]').length : 0;
            headerCb.checked = total > 0 && selectedProducts.size === total;
            headerCb.indeterminate = selectedProducts.size > 0 && selectedProducts.size < total;
        }
    } else if (type === 'invoices') {
        const btn = $('bulk-delete-invoices-btn');
        if (btn) {
            btn.style.display = selectedInvoices.size > 0 ? 'inline-flex' : 'none';
            btn.innerHTML = `🗑️ Xóa(${selectedInvoices.size})`;
        }
        const headerCb = $('select-all-invoices');
        if (headerCb) {
            const tbody = $('hist-body');
            const total = tbody ? tbody.querySelectorAll('input[type="checkbox"]').length : 0;
            headerCb.checked = total > 0 && selectedInvoices.size === total;
            headerCb.indeterminate = selectedInvoices.size > 0 && selectedInvoices.size < total;
        }
    } else if (type === 'returns') {
        const btn = $('bulk-delete-returns-btn');
        if (btn) {
            btn.style.display = selectedReturns.size > 0 ? 'inline-flex' : 'none';
            btn.innerHTML = `🗑️ Xóa(${selectedReturns.size})`;
        }
        const headerCb = $('select-all-returns');
        if (headerCb) {
            const tbody = $('returns-body');
            const total = tbody ? tbody.querySelectorAll('input[type="checkbox"]').length : 0;
            headerCb.checked = total > 0 && selectedReturns.size === total;
            headerCb.indeterminate = selectedReturns.size > 0 && selectedReturns.size < total;
        }
    } else if (type === 'stockHistory') {
        const btn = $('bulk-delete-stock-btn');
        if (btn) {
            btn.style.display = selectedStockEntries.size > 0 ? 'inline-flex' : 'none';
            btn.innerHTML = `🗑️ Xóa(${selectedStockEntries.size})`;
        }
        ['select-all-stock', 'select-all-inv-stock'].forEach(headerId => {
            const headerCb = $(headerId);
            if (!headerCb) return;
            const tbody = headerCb.closest('table')?.querySelector('tbody');
            const total = tbody ? tbody.querySelectorAll('input[type="checkbox"]').length : 0;
            headerCb.checked = total > 0 && selectedStockEntries.size === total;
            headerCb.indeterminate = selectedStockEntries.size > 0 && selectedStockEntries.size < total;
        });
    }
}

// INVENTORY
function renderInventory() {
    const totalValue = db.products.reduce((a, p) => a + (p.cost || 0) * p.stock, 0);
    const lowStock = db.settings.lowStock || 5;

    if ($('inv-total-value')) $('inv-total-value').innerText = money(totalValue);
    if ($('inv-total-products')) $('inv-total-products').innerText = db.products.length.toLocaleString('vi-VN');
    if ($('inv-low-stock')) $('inv-low-stock').innerText = db.products.filter(p => p.stock > 0 && p.stock <= lowStock).length.toLocaleString('vi-VN');
    if ($('inv-out-stock')) $('inv-out-stock').innerText = db.products.filter(p => p.stock <= 0).length.toLocaleString('vi-VN');

    renderInventoryStockHistory();
}

const LINKED_STOCK_HISTORY_SOURCES = new Set([
    'sale',
    'return',
    'exchange',
    'quick_return',
    'purchase_order',
    'invoice_edit',
    'delete_return',
    'bulk_delete_return'
]);

function isLinkedStockHistoryEntry(entry) {
    if (!entry) return false;
    if (LINKED_STOCK_HISTORY_SOURCES.has(entry.source)) return true;
    return (db.purchaseOrders || []).some(po => isStockHistoryForPurchaseOrder(entry, po));
}

function getSelectedLinkedStockEntries() {
    return (db.stockHistory || []).filter(entry =>
        selectedStockEntries.has(entry.id) && isLinkedStockHistoryEntry(entry)
    );
}

function renderStockHistory() {
    const filter = $('stock-filter')?.value || 'all';

    let list = db.stockHistory || [];
    if (filter !== 'all') list = list.filter(h => h.type === filter);
    list = list.sort((a, b) => new Date(b.date) - new Date(a.date)); // Sort newest first

    // Clear selections when re-rendering
    selectedStockEntries.clear();
    updateBulkDeleteUI('stockHistory');

    const canManage = isAuthenticated && ['admin', 'manager'].includes(currUser?.role);
    const historyHtml = list.slice(0, 50).map(h => {
        const typeLabel = { in: '📥 Nhập', out: '📤 Xuất', adjust: '🔧 Điều chỉnh' }[h.type] || h.type;
        const typeClass = { in: 'badge-success', out: 'badge-warning', adjust: 'badge-secondary' }[h.type] || '';
        const stockIdAttr = escapeAttr(String(h.id ?? ''));
        const stockIdJs = escapeJsArgument(h.id);
        return `<tr>
            <td style="width:40px;text-align:center;">${canManage ? `<input type="checkbox" data-id="${stockIdAttr}" onchange="toggleStockEntrySelect(${stockIdJs})" style="width:18px;height:18px;cursor:pointer;">` : ''}</td>
            <td>${new Date(h.date).toLocaleString('vi-VN')}</td>
            <td><span class="badge ${typeClass}">${typeLabel}</span></td>
            <td>${escapeHtml(h.productName)}</td>
            <td style="font-weight:600">${h.type === 'out' ? '-' : '+'}${formatQty(h.qty)}</td>
            <td class="money-cell">${h.price ? money(h.price) : '-'}</td>
            <td class="money-cell">${h.total ? money(h.total) : '-'}</td>
            <td>${escapeHtml(h.note || '-')}</td>
            <td>${escapeHtml(h.user)}</td>
            <td style="white-space:nowrap">
                <button class="btn btn-sm btn-secondary" onclick="printStockSlip(${stockIdJs})" title="In phiếu">🖨️</button>
                ${canManage ? `<button class="btn btn-sm btn-danger" onclick="deleteStockEntry(${stockIdJs})" title="Xóa">🗑️</button>` : ''}
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="10" class="text-center" style="padding:30px;color:var(--text-muted)">Chưa có lịch sử</td></tr>';

    const mgmtTbody = $('mgmt-stock-history-body');

    if (mgmtTbody) mgmtTbody.innerHTML = historyHtml;
}

// Separate function for Inventory tab stock history filter
function renderInventoryStockHistory() {
    const filter = $('inv-stock-filter')?.value || 'all';

    let list = db.stockHistory || [];
    if (filter !== 'all') list = list.filter(h => h.type === filter);
    list = list.sort((a, b) => new Date(b.date) - new Date(a.date));

    const canManage = isAuthenticated && ['admin', 'manager'].includes(currUser?.role);
    const historyHtml = list.slice(0, 50).map(h => {
        const typeLabel = { in: '📥 Nhập', out: '📤 Xuất', adjust: '🔧 Điều chỉnh' }[h.type] || h.type;
        const typeClass = { in: 'badge-success', out: 'badge-warning', adjust: 'badge-secondary' }[h.type] || '';
        const stockIdAttr = escapeAttr(String(h.id ?? ''));
        const stockIdJs = escapeJsArgument(h.id);
        return `<tr>
            <td style="width:40px;text-align:center;">${canManage ? `<input type="checkbox" data-id="${stockIdAttr}" onchange="toggleStockEntrySelect(${stockIdJs})" style="width:18px;height:18px;cursor:pointer;">` : ''}</td>
            <td>${new Date(h.date).toLocaleString('vi-VN')}</td>
            <td><span class="badge ${typeClass}">${typeLabel}</span></td>
            <td>${escapeHtml(h.productName)}</td>
            <td style="font-weight:600">${h.type === 'out' ? '-' : '+'}${formatQty(h.qty)}</td>
            <td class="money-cell">${h.price ? money(h.price) : '-'}</td>
            <td class="money-cell">${h.total ? money(h.total) : '-'}</td>
            <td>${escapeHtml(h.note || '-')}</td>
            <td>${escapeHtml(h.user)}</td>
            <td style="white-space:nowrap">
                <button class="btn btn-sm btn-secondary" onclick="printStockSlip(${stockIdJs})" title="In phiếu">🖨️</button>
                ${canManage ? `<button class="btn btn-sm btn-danger" onclick="deleteStockEntry(${stockIdJs})" title="Xóa">🗑️</button>` : ''}
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="10" class="text-center" style="padding:30px;color:var(--text-muted)">Chưa có lịch sử</td></tr>';

    const invTbody = $('inv-stock-history-body');
    if (invTbody) invTbody.innerHTML = historyHtml;
}

// Delete stock history entry with option to revert stock
function deleteStockEntry(id) {
    if (!canMutateManagement()) return;
    const entry = (db.stockHistory || []).find(h => sameStoredId(h.id, id));
    if (!entry) return toast("Không tìm thấy lịch sử!", "error");
    if (isLinkedStockHistoryEntry(entry)) {
        return toast("Lịch sử kho này liên kết với chứng từ gốc. Hãy xử lý tại hóa đơn, trả hàng hoặc đơn nhập.", "warning");
    }

    const product = db.products.find(p => sameStoredId(p.id, entry.productId));
    const productName = entry.productName || 'Sản phẩm';
    const qty = toFiniteNumber(entry.qty);
    const typeLabel = entry.type === 'in' ? 'Nhập' : entry.type === 'out' ? 'Xuất' : 'Điều chỉnh';

    // Build confirmation message based on entry type
    let message = `Xóa lịch sử "${typeLabel}" ${qty} x ${productName}?\n\n`;

    let stockReverted = false;
    let stockAdjustment = 0;
    if (product && (entry.type === 'in' || entry.type === 'out')) {
        message += `Bạn có muốn hoàn lại tồn kho không ?\n`;
        message += `• Nhấn OK để xóa VÀ hoàn lại tồn kho\n`;
        message += `• Nhấn Cancel để chỉ xóa lịch sử`;

        const revertStock = confirm(message);

        if (revertStock) {
            stockReverted = true;
            const previousStock = toFiniteNumber(product.stock);
            // Revert stock based on entry type
            if (entry.type === 'in') {
                product.stock = previousStock - qty;
            } else if (entry.type === 'out') {
                product.stock = previousStock + qty;
            }
            stockAdjustment = product.stock - previousStock;
        } else {
            // User clicked Cancel - ask if they still want to delete history only
            if (!confirm("Chỉ xóa lịch sử (không thay đổi tồn kho)?")) {
                return;
            }
        }
    } else {
        // For adjust type or product not found, just confirm delete
        if (!confirm(message + "Xác nhận xóa?")) return;
    }

    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;
    // Remove from stockHistory
    pushUndo(UNDO_ACTIONS.DELETE_STOCK_ENTRY, { entry, stockReverted, stockAdjustment });
    db.stockHistory = db.stockHistory.filter(h => !sameStoredId(h.id, id));

    logActivity('Xóa lịch sử kho', `${productName} x${qty} `);
    if (!saveInventoryCommit(inventoryCommit)) return;
    renderInventory();
    renderManagement();
    toast(`Đã xóa lịch sử!${stockReverted ? ` Đã hoàn lại tồn kho: ${entry.type === 'in' ? '-' : '+'}${qty}.` : ''}`);
}

// BULK DELETE - INVOICES
function getOutstandingInvoiceItems(invoice) {
    const soldByProduct = {};
    (invoice.items || []).forEach(item => {
        if (!soldByProduct[item.id]) soldByProduct[item.id] = { ...item, qty: 0 };
        soldByProduct[item.id].qty += parseFloat(item.qty) || 0;
    });

    (db.returns || []).filter(r => sameStoredId(r.invoiceId, invoice.id)).forEach(r => {
        (r.returnItems || r.items || []).forEach(item => {
            if (soldByProduct[item.id]) {
                soldByProduct[item.id].qty -= parseFloat(item.qty) || 0;
            }
        });
    });

    return Object.values(soldByProduct)
        .map(item => ({ ...item, qty: Math.max(0, item.qty) }))
        .filter(item => item.qty > 0);
}

function hasLinkedReturn(invoiceId) {
    return (db.returns || []).some(returnRecord => sameStoredId(returnRecord.invoiceId, invoiceId));
}

function getInvoiceIdsWithLinkedReturns(invoiceIds) {
    return [...new Set(invoiceIds.filter(hasLinkedReturn))];
}

function blockLinkedInvoiceDeletion(invoiceIds) {
    const blockedIds = getInvoiceIdsWithLinkedReturns(invoiceIds);
    if (blockedIds.length === 0) return false;
    toast(`Không thể xóa ${blockedIds.length} hóa đơn đã phát sinh trả/đổi hàng.`, 'warning');
    return true;
}

function getInvoiceReturnedAmount(invoice) {
    const returnedAmount = (db.returns || [])
        .filter(r => sameStoredId(r.invoiceId, invoice.id))
        .reduce((sum, r) => sum + (parseFloat(r.returnTotal ?? r.refundAmount) || 0), 0);
    return Math.min(invoice.total || 0, returnedAmount);
}

function getReturnFinancialTotals(returnRecord = {}) {
    const sumItems = (items = []) => items.reduce((sum, item) => sum + getReturnItemTotal(item), 0);
    const parsedReturn = parseFloat(returnRecord.returnTotal ?? returnRecord.refundAmount);
    const parsedExchange = parseFloat(returnRecord.exchangeTotal);
    return {
        returnAmount: Number.isFinite(parsedReturn) ? parsedReturn : sumItems(returnRecord.returnItems || returnRecord.items || []),
        exchangeAmount: Number.isFinite(parsedExchange) ? parsedExchange : sumItems(returnRecord.exchangeItems || [])
    };
}

function getReturnCustomerId(returnRecord = {}) {
    return returnRecord.custId ?? returnRecord.customerId ?? returnRecord.customer?.id ?? null;
}

function recordReturnCustomerEffects(returnRecord, applyEffects) {
    const customerId = getReturnCustomerId(returnRecord);
    const customer = customerId && !sameStoredId(customerId, 1)
        ? db.custs.find(c => sameStoredId(c.id, customerId))
        : null;
    const effects = { customerId: customer?.id ?? customerId, pointsDelta: 0, totalBuyDelta: 0 };
    if (!customer) {
        returnRecord.customerEffects = effects;
        return false;
    }

    const points = Number(customer.points) || 0;
    const totalBuy = Number(customer.totalBuy) || 0;
    applyEffects(customer);
    effects.pointsDelta = (Number(customer.points) || 0) - points;
    effects.totalBuyDelta = (Number(customer.totalBuy) || 0) - totalBuy;
    returnRecord.customerEffects = effects;
    return true;
}

function restoreStoredReturnCustomerEffects(returnRecord = {}) {
    const effects = returnRecord.customerEffects;
    if (!effects || !Object.prototype.hasOwnProperty.call(effects, 'pointsDelta') ||
        !Object.prototype.hasOwnProperty.call(effects, 'totalBuyDelta')) return false;
    const customerId = effects.customerId ?? getReturnCustomerId(returnRecord);
    const customer = customerId && !sameStoredId(customerId, 1)
        ? db.custs.find(c => sameStoredId(c.id, customerId))
        : null;
    if (!customer) return false;

    customer.points = Math.max(0, (Number(customer.points) || 0) - (Number(effects.pointsDelta) || 0));
    customer.totalBuy = Math.max(0, (Number(customer.totalBuy) || 0) - (Number(effects.totalBuyDelta) || 0));
    return true;
}

function applyLinkedReturnCustomerEffects(returnRecord, direction = 1) {
    if (!returnRecord?.invoiceId || returnRecord.invoiceId === 'QUICK_RETURN') return false;
    const customerId = getReturnCustomerId(returnRecord);
    if (!customerId || customerId === 1) return false;

    const dbCust = db.custs.find(c => sameStoredId(c.id, customerId));
    if (!dbCust) return false;

    const { returnAmount, exchangeAmount } = getReturnFinancialTotals(returnRecord);
    const totalBuyDelta = exchangeAmount - returnAmount;
    const applyEffects = customer => {
        customer.totalBuy = Math.max(0, (customer.totalBuy || 0) + direction * totalBuyDelta);
        if (db.settings.pointsEnabled) {
            const rate = db.settings.pointsRate || 1;
            const pointDelta = Math.floor(exchangeAmount * rate / 100) - Math.floor(returnAmount * rate / 100);
            customer.points = Math.max(0, (customer.points || 0) + direction * pointDelta);
        }
    };
    if (direction === 1) return recordReturnCustomerEffects(returnRecord, applyEffects);
    applyEffects(dbCust);

    return true;
}

function reverseInvoiceCustomerEffects(invoice) {
    if (!invoice.custId || sameStoredId(invoice.custId, 1)) return;
    const dbCust = db.custs.find(c => sameStoredId(c.id, invoice.custId));
    if (!dbCust) return;

    const remainingAmount = Math.max(0, (invoice.total || 0) - getInvoiceReturnedAmount(invoice));
    dbCust.totalBuy = Math.max(0, (dbCust.totalBuy || 0) - remainingAmount);
    if (db.settings.pointsEnabled) {
        const earnedPoints = Math.floor(remainingAmount * (db.settings.pointsRate || 1) / 100);
        dbCust.points = Math.max(0, (dbCust.points || 0) - earnedPoints + (invoice.pointsUsed || 0));
    }
}

function reapplyInvoiceCustomerEffects(invoice) {
    if (!invoice.custId || sameStoredId(invoice.custId, 1)) return;
    const dbCust = db.custs.find(c => sameStoredId(c.id, invoice.custId));
    if (!dbCust) return;

    const remainingAmount = Math.max(0, (invoice.total || 0) - getInvoiceReturnedAmount(invoice));
    dbCust.totalBuy = (dbCust.totalBuy || 0) + remainingAmount;
    if (db.settings.pointsEnabled) {
        const earnedPoints = Math.floor(remainingAmount * (db.settings.pointsRate || 1) / 100);
        dbCust.points = Math.max(0, (dbCust.points || 0) + earnedPoints - (invoice.pointsUsed || 0));
    }
}

function reverseQuickReturnCustomerPoints(returnRecord) {
    if (!db.settings.pointsEnabled) return 0;
    const customerId = returnRecord.custId || returnRecord.customerId || returnRecord.customer?.id;
    if (!customerId || customerId === 1) return 0;

    const dbCust = db.custs.find(c => sameStoredId(c.id, customerId));
    if (!dbCust) return 0;

    const returnAmount = returnRecord.returnTotal ?? returnRecord.refundAmount ?? 0;
    const requestedPoints = Math.floor((Number(returnAmount) || 0) * (db.settings.pointsRate || 1) / 100);
    const pointsReversed = Math.min(Math.max(0, Number(dbCust.points) || 0), Math.max(0, requestedPoints));
    dbCust.points -= pointsReversed;
    return pointsReversed;
}

function restoreCustomerPointsAfterUndoReturn(returnRecord) {
    if (restoreStoredReturnCustomerEffects(returnRecord)) return;
    if (applyLinkedReturnCustomerEffects(returnRecord, -1)) return;
    if (!db.settings.pointsEnabled) return;
    const customerId = returnRecord.custId || returnRecord.customerId || returnRecord.customer?.id;
    if (!customerId || customerId === 1) return;

    const dbCust = db.custs.find(c => sameStoredId(c.id, customerId));
    if (!dbCust) return;

    const recordedPoints = Number(returnRecord.pointsReversed);
    const returnAmount = returnRecord.returnTotal || returnRecord.refundAmount || 0;
    const returnedPoints = Number.isFinite(recordedPoints) && recordedPoints >= 0
        ? recordedPoints
        : Math.floor(returnAmount * (db.settings.pointsRate || 1) / 100);
    dbCust.points = (dbCust.points || 0) + returnedPoints;
}

function toggleInvoiceSelect(id) {
    if (selectedInvoices.has(id)) {
        selectedInvoices.delete(id);
    } else {
        selectedInvoices.add(id);
    }
    updateBulkDeleteUI('invoices');
}

function toggleAllInvoices(checkbox) {
    const tbody = $('hist-body');
    if (!tbody) return;
    const checkboxes = tbody.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        const id = cb.dataset.id;
        if (checkbox.checked) {
            selectedInvoices.add(id);
            cb.checked = true;
        } else {
            selectedInvoices.delete(id);
            cb.checked = false;
        }
    });
    updateBulkDeleteUI('invoices');
}

function toggleReturnSelect(id) {
    if (selectedReturns.has(id)) selectedReturns.delete(id);
    else selectedReturns.add(id);
    updateBulkDeleteUI('returns');
}

function toggleAllReturns(checkbox) {
    const tbody = $('returns-body');
    if (!tbody) return;
    tbody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        const id = cb.dataset.id;
        if (checkbox.checked) selectedReturns.add(id);
        else selectedReturns.delete(id);
        cb.checked = checkbox.checked;
    });
    updateBulkDeleteUI('returns');
}

function deleteSelectedReturns() {
    if (selectedReturns.size === 0) return toast('Chưa chọn phiếu đổi/trả nào!', 'warning');
    const records = [...selectedReturns].map(id => (db.returns || []).find(record => sameStoredId(record.id, id)));
    if (records.some(record => !record)) return toast('Không tìm thấy một hoặc nhiều phiếu đổi/trả.', 'error');
    const missingProduct = getMissingReturnDeletionProduct(records);
    if (missingProduct) return toast(`Không thể xóa: không tìm thấy sản phẩm "${missingProduct.name || String(missingProduct.id)}".`, 'error');

    let message = `Xóa ${records.length} phiếu đổi/trả?\n\nKho và dữ liệu khách hàng sẽ được khôi phục.`;
    if (records.some(record => !record.customerEffects)) message += '\n\nCó phiếu cũ không lưu chênh lệch khách hàng; hệ thống sẽ khôi phục điểm theo công thức legacy đang lưu.';
    if (!confirm(message)) return;

    deleteReturnRecords(records, 'Xóa phiếu đổi/trả hàng loạt', `${records.length} phiếu đổi/trả`, `Đã xóa ${records.length} phiếu đổi/trả và khôi phục dữ liệu liên quan.`);
}

function deleteSelectedInvoices() {
    if (selectedInvoices.size === 0) return toast("Chưa chọn hóa đơn nào!", "warning");
    if (blockLinkedInvoiceDeletion([...selectedInvoices])) return;

    // Show modal with options for stock return
    openBulkDeleteInvoiceModal();
}

function openBulkDeleteInvoiceModal() {
    if (blockLinkedInvoiceDeletion([...selectedInvoices])) return;
    const modal = $('bulk-delete-invoice-modal');
    if (!modal) {
        // Create modal dynamically if not exists
        const modalHtml = `
        <div class="modal-overlay" id="bulk-delete-invoice-modal">
            <div class="modal" style="width:500px">
                <div class="modal-header" style="background:linear-gradient(135deg, #ef4444, #dc2626); color:#fff;">
                    🗑️ Xóa ${selectedInvoices.size} hóa đơn
                    <span onclick="closeModal('bulk-delete-invoice-modal')">✕</span>
                </div>
                <div class="modal-body">
                    <div style="text-align:center; margin-bottom:20px;">
                        <div style="font-size:48px; margin-bottom:10px;">⚠️</div>
                        <div style="font-weight:600; font-size:18px; margin-bottom:8px;">Xác nhận xóa ${selectedInvoices.size} hóa đơn?</div>
                        <div style="color:var(--text-muted);">Có thể hoàn tác bằng Ctrl+Z sau khi xóa</div>
                    </div>
                    <div style="background:var(--bg-muted); padding:16px; border-radius:var(--radius-md); margin-bottom:16px;">
                        <div style="font-weight:600; margin-bottom:12px;">📦 Xử lý tồn kho:</div>
                        <label style="display:flex; align-items:center; gap:10px; padding:12px; background:var(--bg-surface); border-radius:var(--radius-sm); cursor:pointer; margin-bottom:8px; border:2px solid var(--success);">
                            <input type="radio" name="bulk-inv-stock-option" value="return" checked>
                                <div>
                                    <div style="font-weight:600; color:var(--success);">✅ Hoàn hàng về kho</div>
                                    <div style="font-size:12px; color:var(--text-muted);">Số lượng sản phẩm sẽ được cộng lại vào kho</div>
                                </div>
                        </label>
                        <label style="display:flex; align-items:center; gap:10px; padding:12px; background:var(--bg-surface); border-radius:var(--radius-sm); cursor:pointer; border:2px solid var(--border-light);">
                            <input type="radio" name="bulk-inv-stock-option" value="no-return">
                                <div>
                                    <div style="font-weight:600; color:var(--warning);">⛔ Không hoàn hàng</div>
                                    <div style="font-size:12px; color:var(--text-muted);">Chỉ xóa hóa đơn, không thay đổi tồn kho</div>
                                </div>
                        </label>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal('bulk-delete-invoice-modal')">Hủy</button>
                    <button class="btn btn-danger" onclick="confirmBulkDeleteInvoices()">🗑️ Xác nhận xóa</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    } else {
        // Update modal content
        const modalHeader = modal.querySelector('.modal-header');
        if (modalHeader) modalHeader.innerHTML = `🗑️ Xóa ${selectedInvoices.size} hóa đơn <span onclick="closeModal('bulk-delete-invoice-modal')">✕</span>`;
        const modalMsg = modal.querySelector('.modal-body div div:nth-child(2)');
        if (modalMsg) modalMsg.textContent = `Xác nhận xóa ${selectedInvoices.size} hóa đơn?`;
    }
    $('bulk-delete-invoice-modal').classList.add('active');
}

function confirmBulkDeleteInvoices() {
    if (blockLinkedInvoiceDeletion([...selectedInvoices])) return;
    const historyCommit = beginHistoryCommit();
    if (!historyCommit) return;
    const returnStock = document.querySelector('input[name="bulk-inv-stock-option"]:checked')?.value === 'return';

    let returnedCount = 0;
    selectedInvoices.forEach(id => {
        const inv = db.invoices.find(x => sameStoredId(x.id, id));
        if (inv) {
            const outstandingItems = getOutstandingInvoiceItems(inv);
            pushUndo(UNDO_ACTIONS.DELETE_INVOICE, { invoice: inv, restoredItems: returnStock ? outstandingItems : [] });
            if (returnStock) {
                // Return items to stock + Add stock history
                outstandingItems.forEach(item => {
                    const p = db.products.find(x => sameStoredId(x.id, item.id));
                    if (p) {
                        p.stock += item.qty;
                        returnedCount += item.qty;
                        // Add stock history entry for returned items
                        db.stockHistory.unshift({
                            id: Date.now() + Math.random(),
                            date: getAppDate().toISOString(),
                            type: 'in',
                            productId: item.id,
                            productName: p.name,
                            qty: item.qty,
                            price: item.price,
                            total: item.total || Math.round(item.qty * item.price),
                            note: `Hoàn kho - Xóa HĐ ${inv.id}`,
                            user: currUser?.name || '',
                            source: 'bulk_delete_return'
                        });
                    }
                });
            }
            reverseInvoiceCustomerEffects(inv);
        }
        db.invoices = db.invoices.filter(x => !sameStoredId(x.id, id));
    });

    const count = selectedInvoices.size;
    logActivity('Xóa HĐ hàng loạt', `${count} hóa đơn${returnStock ? ', hoàn kho' : ''} `);
    if (!saveHistoryCommit(historyCommit)) return;
    selectedInvoices.clear();
    closeModal('bulk-delete-invoice-modal');
    renderHist();
    renderPos();
    renderInventory();
    updateBulkDeleteUI('invoices');
    toast(`Đã xóa ${count} hóa đơn!${returnStock ? ` Hoàn ${returnedCount} SP về kho.` : ''} `);
}

// NOTE: deleteInvoice() is defined later with better modal UX

// BULK DELETE - STOCK HISTORY
function toggleStockEntrySelect(id) {
    if (selectedStockEntries.has(id)) {
        selectedStockEntries.delete(id);
    } else {
        selectedStockEntries.add(id);
    }
    updateBulkDeleteUI('stockHistory');
}

function toggleAllStockEntries(checkbox) {
    const tbody = checkbox?.closest('table')?.querySelector('tbody') || $('mgmt-stock-history-body') || $('inv-stock-history-body');
    if (!tbody) return;
    const checkboxes = tbody.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        const entry = (db.stockHistory || []).find(item => sameStoredId(item.id, cb.dataset.id));
        if (!entry) return;
        const id = entry.id;
        if (checkbox.checked) {
            selectedStockEntries.add(id);
            cb.checked = true;
        } else {
            selectedStockEntries.delete(id);
            cb.checked = false;
        }
    });
    updateBulkDeleteUI('stockHistory');
}

function deleteSelectedStockEntries() {
    if (selectedStockEntries.size === 0) return toast("Chưa chọn lịch sử nào!", "warning");
    const linkedEntries = getSelectedLinkedStockEntries();
    if (linkedEntries.length > 0) {
        return toast(`Có ${linkedEntries.length} lịch sử liên kết với chứng từ gốc, không thể xóa trực tiếp.`, "warning");
    }

    openBulkDeleteStockModal();
}

function openBulkDeleteStockModal() {
    const modal = $('bulk-delete-stock-modal');
    if (!modal) {
        const modalHtml = `
        <div class="modal-overlay" id="bulk-delete-stock-modal">
            <div class="modal" style="width:500px">
                <div class="modal-header" style="background:linear-gradient(135deg, #ef4444, #dc2626); color:#fff;">
                    🗑️ Xóa ${selectedStockEntries.size} lịch sử kho
                    <span onclick="closeModal('bulk-delete-stock-modal')">✕</span>
                </div>
                <div class="modal-body">
                    <div style="text-align:center; margin-bottom:20px;">
                        <div style="font-size:48px; margin-bottom:10px;">⚠️</div>
                        <div style="font-weight:600; font-size:18px; margin-bottom:8px;">Xác nhận xóa ${selectedStockEntries.size} lịch sử?</div>
                        <div style="color:var(--text-muted);">Có thể hoàn tác bằng Ctrl+Z sau khi xóa</div>
                    </div>
                    <div style="background:var(--bg-muted); padding:16px; border-radius:var(--radius-md); margin-bottom:16px;">
                        <div style="font-weight:600; margin-bottom:12px;">📦 Xử lý tồn kho:</div>
                        <label style="display:flex; align-items:center; gap:10px; padding:12px; background:var(--bg-surface); border-radius:var(--radius-sm); cursor:pointer; margin-bottom:8px; border:2px solid var(--success);">
                            <input type="radio" name="bulk-stock-option" value="revert" checked>
                                <div>
                                    <div style="font-weight:600; color:var(--success);">✅ Hoàn lại tồn kho</div>
                                    <div style="font-size:12px; color:var(--text-muted);">Nhập kho sẽ trừ đi, Xuất kho sẽ cộng lại</div>
                                </div>
                        </label>
                        <label style="display:flex; align-items:center; gap:10px; padding:12px; background:var(--bg-surface); border-radius:var(--radius-sm); cursor:pointer; border:2px solid var(--border-light);">
                            <input type="radio" name="bulk-stock-option" value="no-revert">
                                <div>
                                    <div style="font-weight:600; color:var(--warning);">⛔ Không hoàn lại</div>
                                    <div style="font-size:12px; color:var(--text-muted);">Chỉ xóa lịch sử, không thay đổi tồn kho</div>
                                </div>
                        </label>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal('bulk-delete-stock-modal')">Hủy</button>
                    <button class="btn btn-danger" onclick="confirmBulkDeleteStockEntries()">🗑️ Xác nhận xóa</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    } else {
        const stockHeader = modal.querySelector('.modal-header');
        if (stockHeader) stockHeader.innerHTML = `🗑️ Xóa ${selectedStockEntries.size} lịch sử kho <span onclick="closeModal('bulk-delete-stock-modal')">✕</span>`;
        const stockMsg = modal.querySelector('.modal-body div div:nth-child(2)');
        if (stockMsg) stockMsg.textContent = `Xác nhận xóa ${selectedStockEntries.size} lịch sử?`;
    }
    $('bulk-delete-stock-modal').classList.add('active');
}

function confirmBulkDeleteStockEntries() {
    if (!canMutateManagement()) return;
    const linkedEntries = getSelectedLinkedStockEntries();
    if (linkedEntries.length > 0) {
        return toast(`Có ${linkedEntries.length} lịch sử liên kết với chứng từ gốc, không thể xóa trực tiếp.`, "warning");
    }

    const revertStock = document.querySelector('input[name="bulk-stock-option"]:checked')?.value === 'revert';
    const entries = [...selectedStockEntries].map(id => (db.stockHistory || []).find(entry => sameStoredId(entry.id, id)));
    if (entries.some(entry => !entry)) return toast('Không tìm thấy đầy đủ lịch sử đã chọn. Dữ liệu chưa thay đổi.', 'error');
    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;

    let revertedQty = 0;
    selectedStockEntries.forEach(id => {
        const entry = (db.stockHistory || []).find(h => sameStoredId(h.id, id));
        if (entry) {
            let stockReverted = false;
            let stockAdjustment = 0;

            if (revertStock) {
                const product = db.products.find(p => sameStoredId(p.id, entry.productId));
                if (product && (entry.type === 'in' || entry.type === 'out')) {
                    stockReverted = true;
                    const previousStock = toFiniteNumber(product.stock);
                    const qty = toFiniteNumber(entry.qty);
                    if (entry.type === 'in') {
                        product.stock = previousStock - qty;
                        revertedQty += qty;
                    } else if (entry.type === 'out') {
                        product.stock = previousStock + qty;
                        revertedQty += qty;
                    }
                    stockAdjustment = product.stock - previousStock;
                }
            }
            pushUndo(UNDO_ACTIONS.DELETE_STOCK_ENTRY, { entry, stockReverted, stockAdjustment });
        }
        db.stockHistory = db.stockHistory.filter(h => !sameStoredId(h.id, id));
    });

    const count = selectedStockEntries.size;
    logActivity('Xóa lịch sử kho hàng loạt', `${count} mục${revertStock ? ', hoàn kho' : ''} `);
    if (!saveInventoryCommit(inventoryCommit)) return;
    selectedStockEntries.clear();
    closeModal('bulk-delete-stock-modal');
    renderInventory();
    renderManagement();
    renderStockHistory();
    updateBulkDeleteUI('stockHistory');
    toast(`Đã xóa ${count} lịch sử!${revertStock ? ` Đã điều chỉnh ${revertedQty} SP.` : ''} `);
}


function openStockInModal() {
    if (!canMutateManagement()) return;
    $('stock-in-modal').classList.add('active');

    // Clear search input and hidden field
    $('si-product-search').value = '';
    $('si-product').value = '';

    // Show all products initially
    filterStockInProducts();

    const supSel = $('si-supplier');
    if (supSel) supSel.innerHTML = '<option value="">-- Không chọn --</option>' + (db.suppliers || []).map(s => `<option value="${escapeAttr(String(s.id ?? ''))}">${escapeHtml(s.name)}</option>`).join('');

    $('si-qty').value = 1;
    $('si-price').value = '';
    $('si-note').value = '';
    updateStockPrice();

    // Auto-focus search input for better UX
    setTimeout(() => $('si-product-search')?.focus(), 100);
}

// Filter and display products for Stock-In search
function filterStockInProducts() {
    const search = ($('si-product-search')?.value || '').toLowerCase().trim();
    const listEl = $('si-product-list');
    if (!listEl) return;

    // Only show list when user has typed something
    if (search.length === 0) {
        listEl.style.display = 'none';
        return;
    }

    const filtered = db.products.filter(p =>
        p.name.toLowerCase().includes(search) ||
        (p.code || '').toLowerCase().includes(search)
    ).slice(0, 20); // Limit to 20 results

    if (filtered.length === 0) {
        listEl.innerHTML = '<div style="padding:12px; color:var(--text-muted); text-align:center;">Không tìm thấy sản phẩm</div>';
    } else {
        listEl.innerHTML = filtered.map(p => {
        const productIdJs = escapeJsArgument(p.id);
        return `
        <div class="si-product-item" onclick="selectStockInProduct(${productIdJs})"
            style="padding:12px 14px; cursor:pointer; border-bottom:1px solid var(--border-light); transition:background 0.15s;"
            onmouseover="this.style.background='var(--primary-light)'"
            onmouseout="this.style.background='transparent'">
                <div style="font-weight:600; margin-bottom:4px;">${escapeHtml(p.name)}</div>
                <div style="display:flex; gap:16px; font-size:12px; color:var(--text-muted); flex-wrap:wrap;">
                    <span>Mã: <strong>${escapeHtml(p.code || 'N/A')}</strong></span>
                    <span>Tồn: <strong style="color:var(--primary)">${(p.stock || 0).toLocaleString('vi-VN')}</strong></span>
                    <span>Giá: <strong style="color:var(--success)">${money(p.cost || 0)}</strong></span>
                </div>
        </div>
        `;
        }).join('');
    }

    listEl.style.display = 'block';
}

// Select product from search results
function selectStockInProduct(productId) {
    const p = db.products.find(x => sameStoredId(x.id, productId));
    if (!p) return;

    $('si-product').value = productId;
    $('si-product-search').value = p.name;
    $('si-product-list').style.display = 'none';
    $('si-price').value = p.cost || '';
    updateStockPrice();
}

function updateStockPrice() {
    const productId = $('si-product').value;
    if (productId) {
        const p = db.products.find(x => sameStoredId(x.id, productId));
        if (p && !$('si-price').value) {
            $('si-price').value = p.cost || '';
        }
    }
    updateStockTotal();
}

function updateStockTotal() {
    const qty = parseFloat($('si-qty').value) || 0;
    const price = parseInt(($('si-price').value || '0').replace(/\D/g, '')) || 0;
    if ($('si-total')) $('si-total').value = money(qty * price);
}

function saveStockIn() {
    if (!canMutateManagement()) return;

    const productId = $('si-product').value;
    const qty = parseFloat($('si-qty').value) || 0;
    const price = parseInt(($('si-price').value || '0').replace(/\D/g, '')) || 0;

    if (!productId || qty <= 0) return toast("Nhập số lượng!", "error");

    const p = db.products.find(x => sameStoredId(x.id, productId));
    if (!p) return toast("Không tìm thấy sản phẩm!", "error");

    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;

    p.stock += qty;
    if (price > 0) p.cost = price;

    db.stockHistory.unshift({
        id: Date.now(),
        date: getAppDate().toISOString(),
        type: 'in',
        productId: p.id,
        productName: p.name,
        qty,
        price,
        total: qty * price,
        supplierId: $('si-supplier').value || null,
        note: $('si-note').value,
        user: currUser?.name || ''
    });

    logActivity('Nhập kho', `${p.name} x${qty} `);
    if (!saveInventoryCommit(inventoryCommit)) return;
    closeModal('stock-in-modal');
    renderInventory();
    renderManagement();
    renderPos();
    toast("Đã nhập kho!");
}

function openStockOutModal() {
    if (!canMutateManagement()) return;
    $('stock-out-modal').classList.add('active');

    // Clear search input and hidden field
    $('so-product-search').value = '';
    $('so-product').value = '';
    $('so-product-list').style.display = 'none';

    $('so-qty').value = 1;
    $('so-note').value = '';

    // Auto-focus search input for better UX
    setTimeout(() => $('so-product-search')?.focus(), 100);
}

// Filter and display products for Stock-Out search
function filterStockOutProducts() {
    const search = ($('so-product-search')?.value || '').toLowerCase().trim();
    const listEl = $('so-product-list');
    if (!listEl) return;

    // Only show list when user has typed something
    if (search.length === 0) {
        listEl.style.display = 'none';
        return;
    }

    // Only show products with stock > 0
    const filtered = db.products.filter(p =>
        p.stock > 0 && (
            p.name.toLowerCase().includes(search) ||
            (p.code || '').toLowerCase().includes(search)
        )
    ).slice(0, 20);

    if (filtered.length === 0) {
        listEl.innerHTML = '<div style="padding:12px; color:var(--text-muted); text-align:center;">Không tìm thấy sản phẩm có tồn kho</div>';
    } else {
        listEl.innerHTML = filtered.map(p => {
        const productIdJs = escapeJsArgument(p.id);
        return `
        <div class="so-product-item" onclick="selectStockOutProduct(${productIdJs})"
            style="padding:12px 14px; cursor:pointer; border-bottom:1px solid var(--border-light); transition:background 0.15s;"
            onmouseover="this.style.background='var(--warning-light)'"
            onmouseout="this.style.background='transparent'">
                <div style="font-weight:600; margin-bottom:4px;">${escapeHtml(p.name)}</div>
                <div style="display:flex; gap:16px; font-size:12px; color:var(--text-muted); flex-wrap:wrap;">
                    <span>Mã: <strong>${escapeHtml(p.code || 'N/A')}</strong></span>
                    <span>Tồn: <strong style="color:var(--primary)">${(p.stock || 0).toLocaleString('vi-VN')}</strong></span>
                </div>
        </div>
        `;
        }).join('');
    }

    listEl.style.display = 'block';
}

// Select product from Stock-Out search results
function selectStockOutProduct(productId) {
    const p = db.products.find(x => sameStoredId(x.id, productId));
    if (!p) return;

    $('so-product').value = productId;
    $('so-product-search').value = p.name;
    $('so-product-list').style.display = 'none';
}

function saveStockOut() {
    if (!canMutateManagement()) return;

    const productId = $('so-product').value;
    const qty = parseFloat($('so-qty').value) || 0;
    const reason = $('so-reason').value;

    if (!productId || qty <= 0) return toast("Nhập số lượng!", "error");

    const p = db.products.find(x => sameStoredId(x.id, productId));
    if (!p || p.stock < qty) return toast("Không đủ tồn kho!", "error");

    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;

    p.stock -= qty;

    db.stockHistory.unshift({
        id: Date.now(),
        date: getAppDate().toISOString(),
        type: 'out',
        productId: p.id,
        productName: p.name,
        qty,
        price: p.cost || p.price || 0,
        total: qty * (p.cost || p.price || 0),
        reason,
        note: $('so-note').value,
        user: currUser?.name || '',
        source: 'manual_out'
    });

    logActivity('Xuất kho', `${p.name} x${qty} (${reason})`);
    if (!saveInventoryCommit(inventoryCommit)) return;
    closeModal('stock-out-modal');
    renderInventory();
    renderManagement();
    renderPos();
    toast("Đã xuất kho!");
}

// INVENTORY CHECK
let inventoryCheckData = {};

function openInventoryCheckModal() {
    if (!canMutateManagement()) return;
    $('inventory-check-modal').classList.add('active');

    // Populate category filter
    const catSel = $('ic-category');
    catSel.innerHTML = '<option value="">Tất cả danh mục</option>' + db.categories.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');

    // Reset fields
    $('ic-search').value = '';
    $('ic-only-diff').checked = false;
    $('ic-note').value = '';

    // Initialize inventory check data with current stock values
    inventoryCheckData = {};
    db.products.forEach(p => {
        inventoryCheckData[p.id] = {
            systemStock: p.stock,
            actualStock: p.stock, // Default to system stock
            diff: 0
        };
    });

    renderInventoryCheckList();
}

function renderInventoryCheckList() {
    const catFilter = $('ic-category')?.value || '';
    const search = ($('ic-search')?.value || '').toLowerCase();
    const onlyDiff = $('ic-only-diff')?.checked || false;

    let filtered = db.products.filter(p => {
        if (catFilter && p.cat !== catFilter) return false;
        if (search && !p.name.toLowerCase().includes(search) && !(p.code || '').toLowerCase().includes(search)) return false;
        if (onlyDiff) {
            const data = inventoryCheckData[p.id];
            if (!data || data.diff === 0) return false;
        }
        return true;
    });

    const tbody = $('ic-products-body');
    if (!tbody) return;

    tbody.innerHTML = filtered.map(p => {
        const data = inventoryCheckData[p.id] || { systemStock: p.stock, actualStock: p.stock, diff: 0 };
        const productIdAttr = escapeAttr(String(p.id ?? ''));
        const productIdJs = escapeJsArgument(p.id);
        const diffClass = data.diff > 0 ? 'color:var(--success);font-weight:bold' :
            data.diff < 0 ? 'color:var(--danger);font-weight:bold' : '';
        const diffText = data.diff > 0 ? `+ ${formatQty(data.diff)} ` : formatQty(data.diff);

        return `<tr>
            <td><code>${escapeHtml(p.code || '-')}</code></td>
            <td><strong>${escapeHtml(p.name)}</strong></td>
            <td><span class="badge badge-secondary">${escapeHtml(p.cat || '-')}</span></td>
            <td style="text-align:center; font-weight:600">${formatQty(data.systemStock)}</td>
            <td style="text-align:center">
                <input type="number" id="ic-actual-${productIdAttr}" value="${data.actualStock}"
                    min="0" step="0.001" style="width:80px; text-align:center; padding:6px"
                    onchange="updateInventoryDiff(${productIdJs})" onfocus="this.select()">
            </td>
            <td style="text-align:center; ${diffClass}">${diffText}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="6" class="text-center" style="padding:30px;color:var(--text-muted)">Không có sản phẩm</td></tr>';

    // Update summary
    const diffCount = Object.values(inventoryCheckData).filter(d => d.diff !== 0).length;
    $('ic-total-products').innerText = db.products.length.toLocaleString('vi-VN');
    $('ic-diff-count').innerText = diffCount.toLocaleString('vi-VN');
}

function updateInventoryDiff(productId) {
    const input = $(`ic-actual-${productId}`);
    if (!input) return;

    const actualStock = parseFloat(input.value) || 0;
    const product = db.products.find(p => sameStoredId(p.id, productId));
    if (!product) return;

    inventoryCheckData[productId] = {
        systemStock: product.stock,
        actualStock: actualStock,
        diff: actualStock - product.stock
    };

    renderInventoryCheckList();
}

function resetInventoryCheck() {
    db.products.forEach(p => {
        inventoryCheckData[p.id] = {
            systemStock: p.stock,
            actualStock: p.stock,
            diff: 0
        };
    });
    renderInventoryCheckList();
    toast("Đã đặt lại giá trị kiểm kho!");
}

function saveInventoryCheck() {
    if (!canMutateManagement()) return;
    const adjustments = Object.entries(inventoryCheckData)
        .filter(([id, data]) => data.diff !== 0)
        .map(([id, data]) => ({ id, ...data }));

    if (adjustments.length === 0) {
        toast("Không có sản phẩm nào cần điều chỉnh!", "warning");
        return;
    }

    if (!confirm(`Xác nhận điều chỉnh tồn kho cho ${adjustments.length} sản phẩm ? `)) return;

    const note = $('ic-note')?.value || 'Kiểm kho định kỳ';
    const timestamp = Date.now();
    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;

    adjustments.forEach((adj, index) => {
        const product = db.products.find(p => sameStoredId(p.id, adj.id));
        if (!product) return;

        // Update product stock
        const oldStock = product.stock;
        product.stock = adj.actualStock;

        // Add to stock history
        db.stockHistory.unshift({
            id: timestamp + index,
            date: getAppDate().toISOString(),
            type: 'adjust',
            productId: product.id,
            productName: product.name,
            qty: Math.abs(adj.diff),
            oldStock: oldStock,
            newStock: adj.actualStock,
            diff: adj.diff,
            note: note,
            user: currUser?.name || ''
        });
    });

    logActivity('Kiểm kho', `Điều chỉnh ${adjustments.length} sản phẩm`);
    if (!saveInventoryCommit(inventoryCommit)) return;

    toast(`Đã điều chỉnh tồn kho cho ${adjustments.length} sản phẩm!`);
    closeModal('inventory-check-modal');
    renderInventory();
    renderManagement();
    renderPos();
}

function exportInventoryCheckExcel() {
    const headers = ['Mã', 'Tên sản phẩm', 'Danh mục', 'Tồn hệ thống', 'Tồn thực tế', 'Chênh lệch'];
    const data = db.products.map(p => {
        const checkData = inventoryCheckData[p.id] || { systemStock: p.stock, actualStock: p.stock, diff: 0 };
        return [
            p.code || '',
            p.name,
            p.cat || '',
            checkData.systemStock,
            checkData.actualStock,
            checkData.diff
        ];
    });

    exportToExcel(data, headers, 'KiemKho');
}

// SUPPLIERS
function renderSuppliers() {
    const canManage = isAuthenticated && ['admin', 'manager'].includes(currUser?.role);
    const supplierHtml = (db.suppliers || []).map(s => {
        const supplierIdJs = escapeJsArgument(s.id);
        return `<tr>
        <td><strong>${escapeHtml(s.name)}</strong></td>
        <td>${escapeHtml(s.contact || '-')}</td>
        <td>${escapeHtml(s.phone || '-')}</td>
        <td>${escapeHtml(s.email || '-')}</td>
        <td>${escapeHtml(s.addr || '-')}</td>
        <td>${money(s.debt || 0)}</td>
        <td>
            ${canManage ? `<button class="btn-sm btn-secondary" onclick="editSupplier(${supplierIdJs})">Sửa</button><button class="btn-sm btn-danger" onclick="delSupplier(${supplierIdJs})">Xóa</button>` : ''}
        </td>
    </tr>`;
    }).join('') || '<tr><td colspan="7" class="text-center" style="padding:30px;color:var(--text-muted)">Chưa có nhà cung cấp</td></tr>';

    ['supplier-body', 'suppliers-body'].forEach(id => {
        const tbody = $(id);
        if (tbody) tbody.innerHTML = supplierHtml;
    });
}

function openSupplierModal() {
    if (!canMutateManagement()) return;
    $('supplier-modal').classList.add('active');
    $('sup-id').value = '';
    $('sup-name').value = '';
    $('sup-contact').value = '';
    $('sup-phone').value = '';
    $('sup-email').value = '';
    $('sup-addr').value = '';
    $('sup-note').value = '';
    // Auto-focus on supplier name input
    setTimeout(() => $('sup-name')?.focus(), 100);
}

function editSupplier(id) {
    if (!canMutateManagement()) return;
    const s = (db.suppliers || []).find(x => sameStoredId(x.id, id));
    if (!s) return;
    $('supplier-modal').classList.add('active');
    $('sup-id').value = s.id;
    $('sup-name').value = s.name;
    $('sup-contact').value = s.contact || '';
    $('sup-phone').value = s.phone || '';
    $('sup-email').value = s.email || '';
    $('sup-addr').value = s.addr || '';
    $('sup-note').value = s.note || '';
}

function saveSupplier() {
    if (!canMutateManagement()) return;
    const name = $('sup-name').value.trim();
    if (!name) return toast("Nhập tên NCC!", "error");

    const id = $('sup-id').value;
    const data = {
        name,
        contact: $('sup-contact').value,
        phone: $('sup-phone').value,
        email: $('sup-email').value,
        addr: $('sup-addr').value,
        note: $('sup-note').value
    };

    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;
    if (!db.suppliers) db.suppliers = [];

    if (id) {
        const idx = db.suppliers.findIndex(x => sameStoredId(x.id, id));
        if (idx > -1) db.suppliers[idx] = { ...db.suppliers[idx], ...data };
    } else {
        db.suppliers.push({ id: Date.now(), ...data, debt: 0 });
    }

    if (!saveInventoryCommit(inventoryCommit)) return;
    closeModal('supplier-modal');
    renderSuppliers();
    toast("Đã lưu NCC!");
}

function getSupplierDependencies(supplierId) {
    const deps = [];
    const poCount = (db.purchaseOrders || []).filter(po => sameStoredId(po.supplierId, supplierId)).length;
    if (poCount > 0) deps.push(`${poCount} phiếu nhập`);
    return deps;
}

function delSupplier(id) {
    if (!canMutateManagement()) return;
    const s = db.suppliers.find(x => sameStoredId(x.id, id));
    if (!s) return toast("Không tìm thấy nhà cung cấp!", "error");
    const deps = getSupplierDependencies(id);
    if (deps.length > 0) {
        return toast(`Không thể xóa nhà cung cấp đang liên kết với: ${deps.join(', ')}.`, "warning");
    }
    if (confirm("Xóa nhà cung cấp này?")) {
        const inventoryCommit = beginInventoryCommit();
        if (!inventoryCommit) return;
        pushUndo(UNDO_ACTIONS.DELETE_SUPPLIER, s);
        db.suppliers = db.suppliers.filter(x => !sameStoredId(x.id, id));
        if (!saveInventoryCommit(inventoryCommit)) return;
        renderSuppliers();
    }
}

// RETURNS
function getReturnItemTotal(item) {
    const storedTotal = parseFloat(item?.total);
    if (Number.isFinite(storedTotal)) return storedTotal;
    return Math.round((parseFloat(item?.price) || 0) * (parseFloat(item?.qty) || 0));
}

function getReturnDisplayTotals(returnRecord = {}) {
    const finiteNumber = value => Number.isFinite(Number(value)) ? Number(value) : null;
    const sumItems = items => items.reduce((sum, item) => sum + getReturnItemTotal(item), 0);
    const returnItems = Array.isArray(returnRecord.returnItems)
        ? returnRecord.returnItems
        : (Array.isArray(returnRecord.items) ? returnRecord.items : []);
    const exchangeItems = Array.isArray(returnRecord.exchangeItems) ? returnRecord.exchangeItems : [];
    const returnTotal = finiteNumber(returnRecord.returnTotal) ?? finiteNumber(returnRecord.refundAmount) ?? sumItems(returnItems);
    const exchangeTotal = finiteNumber(returnRecord.exchangeTotal) ?? sumItems(exchangeItems);
    const difference = finiteNumber(returnRecord.difference) ?? (returnTotal - exchangeTotal);
    return { returnTotal, exchangeTotal, difference };
}

function captureReturnArrayState(key) {
    const exists = Object.prototype.hasOwnProperty.call(db, key);
    const value = db[key];
    return { key, exists, value: Array.isArray(value) ? value.slice() : value };
}

function captureReturnMutationSnapshot() {
    return {
        arrays: ['stockHistory', 'returns', 'invoices', 'activityLog'].map(captureReturnArrayState),
        products: (db.products || []).map(product => ({ product, stock: product.stock })),
        customers: (db.custs || []).map(customer => ({
            customer,
            points: customer.points,
            totalBuy: customer.totalBuy,
            debt: customer.debt
        })),
        undo: undoStack.slice()
    };
}

function rollbackReturnMutation(snapshot) {
    snapshot.products.forEach(({ product, stock }) => { product.stock = stock; });
    snapshot.customers.forEach(({ customer, points, totalBuy, debt }) => {
        customer.points = points;
        customer.totalBuy = totalBuy;
        customer.debt = debt;
    });
    snapshot.arrays.forEach(({ key, exists, value }) => {
        if (exists) db[key] = value;
        else delete db[key];
    });
    undoStack.splice(0, undoStack.length, ...snapshot.undo);
}

function beginReturnCommit() {
    if (saveBlockedReason) {
        if (!saveBlockedToastShown) {
            saveBlockedToastShown = true;
            toast("Không lưu dữ liệu mới vì file dữ liệu hiện tại bị lỗi. Hãy khôi phục từ backup.", "error");
        }
        return null;
    }
    if (saveSuppressed) {
        toast('Không thể lưu giao dịch đổi/trả lúc này.', 'error');
        return null;
    }
    if (_saveInProgress) {
        toast('Đang lưu dữ liệu, vui lòng thử lại sau.', 'warning');
        return null;
    }
    return captureReturnMutationSnapshot();
}

function saveReturnAndPreview(returnId, snapshot) {
    // ponytail: one shared commit gate keeps all return flows atomic without new persistence paths.
    if (saveNow()) {
        setTimeout(() => printReturnSlip(returnId), 0);
        return true;
    }
    rollbackReturnMutation(snapshot);
    return false;
}

function isReturnStockHistoryEntry(entry, returnId) {
    const marker = `Phiếu ${String(returnId ?? '')}`;
    if (!String(entry?.note || '').trimEnd().endsWith(marker)) return false;
    return !entry.source || ['return', 'exchange', 'quick_return'].includes(entry.source);
}

function restoreReturnDeletedInvoice(returnRecord) {
    const invoice = returnRecord?.deletedInvoice;
    if (!invoice || (db.invoices || []).some(item => sameStoredId(item.id, invoice.id))) return false;
    db.invoices.push(JSON.parse(JSON.stringify(invoice)));
    return true;
}

function getMissingReturnDeletionProduct(records) {
    return records.flatMap(record => [
        ...(record.returnItems || record.items || []),
        ...(record.exchangeItems || [])
    ]).find(item => !db.products.some(product => sameStoredId(product.id, item.id)));
}

function deleteReturnRecords(records, activityAction, activityDetail, successMessage) {
    const snapshot = beginReturnCommit();
    if (!snapshot) return false;
    records.forEach(returnRecord => {
        (returnRecord.returnItems || returnRecord.items || []).forEach(item => {
            db.products.find(entry => sameStoredId(entry.id, item.id)).stock -= Number(item.qty) || 0;
        });
        (returnRecord.exchangeItems || []).forEach(item => {
            db.products.find(entry => sameStoredId(entry.id, item.id)).stock += Number(item.qty) || 0;
        });
    });
    db.stockHistory = (db.stockHistory || []).filter(entry => !records.some(record => isReturnStockHistoryEntry(entry, record.id)));
    db.returns = (db.returns || []).filter(record => !records.some(selected => sameStoredId(record.id, selected.id)));
    records.forEach(record => {
        restoreCustomerPointsAfterUndoReturn(record);
        restoreReturnDeletedInvoice(record);
    });
    for (let index = undoStack.length - 1; index >= 0; index--) {
        const data = undoStack[index]?.data;
        const undoReturn = data?.returnRecord || data;
        if (undoStack[index]?.type === UNDO_ACTIONS.RETURN_GOODS && records.some(record => sameStoredId(undoReturn?.id, record.id))) undoStack.splice(index, 1);
    }
    logActivity(activityAction, activityDetail);

    if (!saveNow()) {
        rollbackReturnMutation(snapshot);
        return false;
    }
    selectedReturns.clear();
    renderPos();
    renderInventory();
    renderStockHistory();
    renderHist();
    renderReturnsHistory();
    renderManagement();
    renderDashboard();
    renderStaffView();
    toast(successMessage, 'success');
    return true;
}

function deleteReturn(returnId) {
    const returnRecord = (db.returns || []).find(record => sameStoredId(record.id, returnId));
    if (!returnRecord) return toast('Không tìm thấy phiếu đổi/trả', 'error');
    const missingProduct = getMissingReturnDeletionProduct([returnRecord]);
    if (missingProduct) return toast(`Không thể xóa: không tìm thấy sản phẩm "${missingProduct.name || String(missingProduct.id)}".`, 'error');

    let message = `Xóa phiếu đổi/trả #${String(returnRecord.id ?? '').slice(-6)}?\n\nKho và dữ liệu khách hàng sẽ được khôi phục.`;
    if (!returnRecord.customerEffects) message += '\n\nPhiếu cũ không lưu chênh lệch khách hàng; hệ thống sẽ khôi phục điểm theo công thức legacy đang lưu.';
    if (!confirm(message)) return;
    deleteReturnRecords([returnRecord], 'Xóa phiếu đổi/trả', `Phiếu #${String(returnRecord.id ?? '').slice(-6)}`, 'Đã xóa phiếu đổi/trả và khôi phục dữ liệu liên quan.');
}

// Go back to order list from invoice detail view
function backToReturnList() {
    // Hide invoice info section
    if ($('return-invoice-info')) $('return-invoice-info').style.display = 'none';
    if ($('modal-return-items-list')) $('modal-return-items-list').innerHTML = '';
    currentReturnInvoice = null;

    // Show recent orders list
    const recentOrdersSection = $('return-recent-orders');
    if (recentOrdersSection) {
        recentOrdersSection.style.display = 'block';
    }

    // Clear search and refresh list
    $('return-invoice-search').value = '';
    renderRecentOrdersForReturn();
}

// ========== QUICK RETURN MODE - ENHANCED ==========
// Helper function to update UI for Quick Return mode
function updateQuickReturnUI(isReturnMode) {
    const quickReturnBtn = $('btn-quick-return');
    const paymentBtn = $('btn-payment');
    const cartHeader = document.querySelector('.cart-header span');

    if (isReturnMode) {
        if (quickReturnBtn) {
            quickReturnBtn.style.background = 'var(--danger)';
            quickReturnBtn.style.color = 'white';
            quickReturnBtn.innerHTML = '✕ Hủy trả hàng';
            quickReturnBtn.onclick = exitQuickReturn;
        }
        if (paymentBtn) {
            paymentBtn.onclick = processQuickReturn;
            const payKey = db.settings?.shortcuts?.pay || 'F4';
            paymentBtn.innerHTML = `🔄 Xác nhận trả (${payKey})`;
            paymentBtn.style.background = 'var(--warning)';
        }
        if (cartHeader) {
            cartHeader.innerHTML = '🔄 Trả hàng nhanh <span class="badge badge-warning" style="font-size:10px;">RETURN</span>';
        }
    } else {
        if (quickReturnBtn) {
            quickReturnBtn.style.background = '';
            quickReturnBtn.style.color = '';
            quickReturnBtn.innerHTML = '⚡ Trả nhanh';
            quickReturnBtn.onclick = startQuickReturn;
        }
        if (paymentBtn) {
            paymentBtn.onclick = directCheckout;
            const payKey2 = db.settings?.shortcuts?.pay || 'F4';
            paymentBtn.innerHTML = `✅ Thanh toán (${payKey2})`;
            paymentBtn.style.background = '';
        }
        if (cartHeader) {
            cartHeader.innerHTML = '🛒 Giỏ hàng';
        }
    }
}

// Start Quick Return - creates a new tab in return mode (no modal)
function startQuickReturn() {
    // 1. If cart has items, save to a new tab first
    if (cart.length > 0) {
        saveCurrentTabState();
        const savedTabName = invoiceTabs.find(t => t.id === activeTabId)?.name || 'Đơn hiện tại';
        toast(`📦 Đã lưu "${savedTabName}" - đang tạo đơn trả hàng mới`, 'info');
    }

    // 2. Create new return tab
    const newTab = {
        id: nextTabId,
        name: `🔄 Trả hàng ${nextTabId}`,
        cart: [],
        cust: null,
        discount: 0,
        discountType: 'amount',
        mode: 'return' // Special mode for return orders
    };

    invoiceTabs.push(newTab);
    nextTabId++;

    // 3. Switch to new return tab
    activeTabId = newTab.id;
    cart = [];
    cust = null;

    // 4. Update UI to show return mode
    updateReturnModeUI(true);
    renderInvoiceTabs();
    renderCart();

    toast('🔄 Đơn trả hàng mới - Thêm sản phẩm cần trả/đổi', 'success');
}

// Exit Quick Return - cancel return order and delete the tab
function exitQuickReturn() {
    const currentTab = invoiceTabs.find(t => t.id === activeTabId);

    if (currentTab && currentTab.mode === 'return') {
        // Confirm if there are items
        if (cart.length > 0) {
            if (!confirm('Hủy đơn trả hàng này? Các sản phẩm đã thêm sẽ bị xóa.')) {
                return;
            }
        }

        // Remove return tab
        invoiceTabs = invoiceTabs.filter(t => t.id !== activeTabId);

        // Switch to first available tab or create new one
        if (invoiceTabs.length === 0) {
            invoiceTabs.push({
                id: nextTabId,
                name: `Đơn ${nextTabId}`,
                cart: [],
                cust: null,
                discount: 0,
                discountType: 'amount'
            });
            nextTabId++;
        }

        activeTabId = invoiceTabs[0].id;
        loadTabState(activeTabId);
        renderInvoiceTabs();
        renderCart();

        // Update cart section style based on new active tab
        updateReturnModeUI(isReturnMode());

        toast('❌ Đã hủy đơn trả hàng', 'info');
    }
}

// Update UI to reflect return mode
function updateReturnModeUI(isReturnMode) {
    const cartSection = document.querySelector('.pos-right');

    if (isReturnMode) {
        cartSection?.classList.add('return-mode');
    } else {
        cartSection?.classList.remove('return-mode');
    }

    updateQuickReturnUI(isReturnMode);
}

function parseImportedNumber(value, fallback = 0) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    if (value === null || value === undefined || value.toString().trim() === '') return fallback;
    return parseVN(value);
}

// Check if current tab is in return mode
function isReturnMode() {
    const currentTab = invoiceTabs.find(t => t.id === activeTabId);
    return currentTab?.mode === 'return';
}

// Toggle item between return and exchange in return mode
function toggleReturnExchange(index) {
    if (!isReturnMode() || !cart[index]) return;

    cart[index].isExchange = !cart[index].isExchange;
    renderCart();

    const item = cart[index];
    if (item.isExchange) {
        toast(`📤 "${item.name}" → Đổi/Mua thêm`, 'info');
    } else {
        toast(`📥 "${item.name}" → Trả lại`, 'info');
    }
}

// Checkout Return - process return/exchange order
function checkoutReturn() {
    if (cart.length === 0) return toast("Chưa có sản phẩm nào!", "error");

    // Separate return items and exchange items
    const returnItems = cart.filter(i => !i.isExchange).map(i => {
        const product = db.products.find(p => sameStoredId(p.id, i.id)) || i;
        const price = i.customPrice !== undefined ? i.customPrice : product.price;
        return { ...i, price, total: Math.round(price * i.qty) };
    });

    const exchangeItems = cart.filter(i => i.isExchange).map(i => {
        const product = db.products.find(p => sameStoredId(p.id, i.id)) || i;
        const price = i.customPrice !== undefined ? i.customPrice : product.price;
        return { ...i, price, total: Math.round(price * i.qty) };
    });

    // Calculate totals
    const returnTotal = returnItems.reduce((sum, i) => sum + i.total, 0);
    const exchangeTotal = exchangeItems.reduce((sum, i) => sum + i.total, 0);
    const difference = returnTotal - exchangeTotal; // Positive = refund to customer

    // Create return record
    const returnRecord = {
        id: Date.now().toString(),
        date: getAppDate().toISOString(),
        customer: cust ? { ...cust } : { name: 'Khách lẻ' },
        customerId: cust?.id || null,
        returnItems: returnItems,
        exchangeItems: exchangeItems,
        returnTotal: returnTotal,
        exchangeTotal: exchangeTotal,
        difference: difference,
        note: '',
        staff: currUser?.name || 'Admin'
    };
    const returnCommit = beginReturnCommit();
    if (!returnCommit) return;

    // Update stock: +return items, -exchange items + Add stock history
    returnItems.forEach(item => {
        const p = db.products.find(x => sameStoredId(x.id, item.id));
        if (p) {
            p.stock = (p.stock || 0) + item.qty; // Add back to stock
            // Add stock history entry for returned item
            db.stockHistory.unshift({
                id: Date.now() + Math.random(),
                date: getAppDate().toISOString(),
                type: 'in',
                productId: item.id,
                productName: p.name,
                qty: item.qty,
                price: item.price,
                total: item.total || Math.round(item.qty * item.price),
                note: `Trả hàng (Tab) - Phiếu ${returnRecord.id}`,
                user: currUser?.name || 'Admin',
                source: 'return'
            });
        }
    });

    exchangeItems.forEach(item => {
        const p = db.products.find(x => sameStoredId(x.id, item.id));
        if (p) {
            p.stock = (p.stock || 0) - item.qty; // Remove from stock
            // Add stock history entry for exchanged item
            db.stockHistory.unshift({
                id: Date.now() + Math.random(),
                date: getAppDate().toISOString(),
                type: 'out',
                productId: item.id,
                productName: p.name,
                qty: item.qty,
                price: item.price,
                total: item.total || Math.round(item.qty * item.price),
                note: `Đổi hàng (Tab) - Phiếu ${returnRecord.id}`,
                user: currUser?.name || 'Admin',
                source: 'exchange'
            });
        }
    });

    // Save to db.returns
    if (!db.returns) db.returns = [];
    db.returns.unshift(returnRecord);

    recordReturnCustomerEffects(returnRecord, customer => {
        if (!db.settings.pointsEnabled) return;
        const points = Math.floor(returnTotal * (db.settings.pointsRate || 1) / 100);
        customer.points = Math.max(0, (customer.points || 0) - points);
    });

    // Push undo action
    pushUndo(UNDO_ACTIONS.RETURN_GOODS, {
        returnRecord: JSON.parse(JSON.stringify(returnRecord)),
        returnItems: returnItems.map(i => ({ id: i.id, qty: i.qty })),
        exchangeItems: exchangeItems.map(i => ({ id: i.id, qty: i.qty }))
    });

    // Log activity
    const summary = difference > 0
        ? `Trả khách ${money(difference)}`
        : difference < 0
            ? `Thu thêm ${money(Math.abs(difference))}`
            : 'Ngang giá';
    logActivity('Đổi/Trả hàng', `Phiếu #${returnRecord.id.slice(-6)} - ${summary}`);

    if (!saveReturnAndPreview(returnRecord.id, returnCommit)) return;

    // Show success message
    let msg = '✅ Hoàn thành đổi/trả hàng!';
    if (difference > 0) {
        msg += ` Trả lại khách: ${money(difference)}`;
    } else if (difference < 0) {
        msg += ` Thu thêm: ${money(Math.abs(difference))}`;
    } else {
        msg += ' (Ngang giá)';
    }
    toast(msg, 'success');
    playSuccessSound();

    // Remove return tab and switch back
    invoiceTabs = invoiceTabs.filter(t => t.id !== activeTabId);

    if (invoiceTabs.length === 0) {
        invoiceTabs.push({
            id: nextTabId,
            name: `Đơn ${nextTabId}`,
            cart: [],
            cust: null,
            discount: 0,
            discountType: 'amount'
        });
        nextTabId++;
    }

    activeTabId = invoiceTabs[0].id;
    loadTabState(activeTabId);
    // Note: loadTabState already loads the cart and cust from the tab
    // Don't reset them here as it would wipe out the loaded data
    renderInvoiceTabs();
    renderCart();
    renderPos();

    // Update related views
    renderReturnsHistory();
    renderStockHistory();

    // Update cart section style based on new active tab
    updateReturnModeUI(isReturnMode());
}

// Legacy alias for backwards compatibility
function toggleQuickReturnMode() {
    if ($('quick-return-exchange-modal')?.classList.contains('active')) {
        closeQuickReturnExchangeModal();
    } else {
        startQuickReturn();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// RETURN/EXCHANGE MODE - Inline dual-cart mode in main cart section
// Note: State variables (isReturnExchangeMode, returnItems, etc.) are declared at top of script
// ═══════════════════════════════════════════════════════════════════════════

// Toggle between normal cart and return/exchange mode
function toggleReturnExchangeMode() {
    isReturnExchangeMode = !isReturnExchangeMode;

    const toggleBtn = $('btn-return-toggle');
    const cartList = $('cart-list');
    const returnExchangeView = $('return-exchange-view');
    const cartFooter = document.querySelector('.cart-footer');

    if (isReturnExchangeMode) {
        // Switch to return/exchange mode
        if (toggleBtn) toggleBtn.classList.add('active');
        if (cartList) cartList.style.display = 'none';
        if (returnExchangeView) returnExchangeView.classList.add('active');

        // Reset return/exchange items
        returnItems = [];
        exchangeItems = [];
        activeReturnCart = 'return';

        // Update footer for return mode
        updateReturnExchangeFooter();
        renderReturnExchangeView();

        toast('🔄 Chế độ Đổi/Trả - Click chọn giỏ để thêm sản phẩm', 'info');
        saveCurrentTabState(); // Save return/exchange mode state to tab
    } else {
        // Switch back to normal cart mode
        if (toggleBtn) toggleBtn.classList.remove('active');
        if (cartList) cartList.style.display = '';
        if (returnExchangeView) returnExchangeView.classList.remove('active');

        // Clear return/exchange items
        returnItems = [];
        exchangeItems = [];

        // Reset footer
        updateCartTotal();
        renderCart();

        toast('🛒 Đã trở về chế độ bán hàng bình thường', 'info');
        saveCurrentTabState(); // Save normal mode state to tab
    }
}

// Update return/exchange mode UI based on current state (for tab switching, no toggle)
function updateReturnExchangeModeUI() {
    const toggleBtn = $('btn-return-toggle');
    const cartList = $('cart-list');
    const returnExchangeView = $('return-exchange-view');

    if (isReturnExchangeMode) {
        // Show return/exchange mode UI
        if (toggleBtn) toggleBtn.classList.add('active');
        if (cartList) cartList.style.display = 'none';
        if (returnExchangeView) returnExchangeView.classList.add('active');

        // Render return/exchange view with current data
        updateReturnExchangeFooter();
        renderReturnExchangeView();
    } else {
        // Show normal cart mode UI
        if (toggleBtn) toggleBtn.classList.remove('active');
        if (cartList) cartList.style.display = '';
        if (returnExchangeView) returnExchangeView.classList.remove('active');

        // Render normal cart
        renderCart();
    }
}

// Select which cart to add products to
function selectReturnCart(type) {
    activeReturnCart = type;

    const returnRow = $('return-cart-row');
    const exchangeRow = $('exchange-cart-row');

    if (type === 'return') {
        returnRow?.classList.add('active');
        exchangeRow?.classList.remove('active');
    } else {
        returnRow?.classList.remove('active');
        exchangeRow?.classList.add('active');
    }
}

// Add product to the selected return/exchange cart
function addToReturnExchangeCart(product) {
    const targetArray = activeReturnCart === 'return' ? returnItems : exchangeItems;

    // Check if product already exists
    const existing = targetArray.find(x => sameStoredId(x.id, product.id));
    if (existing) {
        existing.qty++;
    } else {
        targetArray.push({
            id: product.id,
            name: product.name,
            price: product.price,
            qty: 1
        });
    }

    renderReturnExchangeView();
    updateReturnExchangeFooter();
    saveCurrentTabState(); // Save return/exchange state to tab
}

// Render return/exchange cart items
function renderReturnExchangeView() {
    const returnList = $('return-items-list');
    const exchangeList = $('exchange-items-list');
    const returnCount = $('return-cart-count');
    const exchangeCount = $('exchange-cart-count');
    const returnTotal = $('return-total');
    const exchangeTotal = $('exchange-total');

    // Render return items
    if (returnList) {
        if (returnItems.length === 0) {
            returnList.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">Click để chọn, sau đó thêm sản phẩm cần trả</div>';
        } else {
            returnList.innerHTML = returnItems.map(item => {
                const itemIdJs = escapeJsArgument(item.id);
                return `
                <div class="cart-item" style="padding:8px;border-bottom:1px solid var(--border-light);">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:600;font-size:13px;">${escapeHtml(item.name)}</div>
                        <div style="font-size:11px;color:var(--text-muted);">${money(item.price)} x ${item.qty}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:4px;">
                        <button class="qty-btn" onclick="modReturnQty('return',${itemIdJs},-1)">-</button>
                        <span style="min-width:30px;text-align:center;">${item.qty}</span>
                        <button class="qty-btn" onclick="modReturnQty('return',${itemIdJs},1)">+</button>
                        <button class="qty-btn" onclick="removeReturnItem('return',${itemIdJs})" style="color:var(--danger);">×</button>
                    </div>
                    <div style="font-weight:700;min-width:80px;text-align:right;">${money(item.price * item.qty)}</div>
                </div>
            `;
            }).join('');
        }
    }

    // Render exchange items
    if (exchangeList) {
        if (exchangeItems.length === 0) {
            exchangeList.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">Click để chọn, sau đó thêm sản phẩm đổi</div>';
        } else {
            exchangeList.innerHTML = exchangeItems.map(item => {
                const itemIdJs = escapeJsArgument(item.id);
                return `
                <div class="cart-item" style="padding:8px;border-bottom:1px solid var(--border-light);">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:600;font-size:13px;">${escapeHtml(item.name)}</div>
                        <div style="font-size:11px;color:var(--text-muted);">${money(item.price)} x ${item.qty}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:4px;">
                        <button class="qty-btn" onclick="modReturnQty('exchange',${itemIdJs},-1)">-</button>
                        <span style="min-width:30px;text-align:center;">${item.qty}</span>
                        <button class="qty-btn" onclick="modReturnQty('exchange',${itemIdJs},1)">+</button>
                        <button class="qty-btn" onclick="removeReturnItem('exchange',${itemIdJs})" style="color:var(--danger);">×</button>
                    </div>
                    <div style="font-weight:700;min-width:80px;text-align:right;">${money(item.price * item.qty)}</div>
                </div>
            `;
            }).join('');
        }
    }

    // Update counts
    const returnQty = returnItems.reduce((a, b) => a + b.qty, 0);
    const exchangeQty = exchangeItems.reduce((a, b) => a + b.qty, 0);
    if (returnCount) returnCount.textContent = `${returnQty} SP`;
    if (exchangeCount) exchangeCount.textContent = `${exchangeQty} SP`;

    // Update totals
    const returnSum = returnItems.reduce((a, b) => a + (b.price * b.qty), 0);
    const exchangeSum = exchangeItems.reduce((a, b) => a + (b.price * b.qty), 0);
    if (returnTotal) returnTotal.textContent = money(returnSum);
    if (exchangeTotal) exchangeTotal.textContent = money(exchangeSum);
}

// Modify quantity in return/exchange cart
function modReturnQty(type, id, delta) {
    const targetArray = type === 'return' ? returnItems : exchangeItems;
    const item = targetArray.find(x => sameStoredId(x.id, id));
    if (item) {
        item.qty += delta;
        if (item.qty <= 0) {
            if (type === 'return') {
                returnItems = returnItems.filter(x => !sameStoredId(x.id, id));
            } else {
                exchangeItems = exchangeItems.filter(x => !sameStoredId(x.id, id));
            }
        }
        renderReturnExchangeView();
        updateReturnExchangeFooter();
        saveCurrentTabState(); // Save return/exchange state to tab
    }
}

// Remove item from return/exchange cart
function removeReturnItem(type, id) {
    if (type === 'return') {
        returnItems = returnItems.filter(x => !sameStoredId(x.id, id));
    } else {
        exchangeItems = exchangeItems.filter(x => !sameStoredId(x.id, id));
    }
    renderReturnExchangeView();
    updateReturnExchangeFooter();
    saveCurrentTabState(); // Save return/exchange state to tab
}

// Update footer totals for return/exchange mode
function updateReturnExchangeFooter() {
    const returnSum = returnItems.reduce((a, b) => a + Math.round(b.price * b.qty), 0);
    const exchangeSum = exchangeItems.reduce((a, b) => a + Math.round(b.price * b.qty), 0);
    const difference = returnSum - exchangeSum;

    // Update main total display
    const cartTotal = $('cart-total');
    if (cartTotal) {
        if (difference > 0) {
            cartTotal.textContent = `Trả khách: ${money(difference)}`;
            cartTotal.style.color = 'var(--success)';
        } else if (difference < 0) {
            cartTotal.textContent = `Thu thêm: ${money(Math.abs(difference))}`;
            cartTotal.style.color = 'var(--danger)';
        } else {
            cartTotal.textContent = 'Ngang giá';
            cartTotal.style.color = 'var(--primary)';
        }
    }

    // Update subtotal
    const cartSubtotal = $('cart-subtotal');
    if (cartSubtotal) {
        cartSubtotal.textContent = `Trả: ${money(returnSum)} | Mua: ${money(exchangeSum)}`;
    }
    updatePaymentDetailsSummary();
}

// Checkout for inline return/exchange mode
function checkoutReturnExchange() {
    if (returnItems.length === 0 && exchangeItems.length === 0) {
        return toast("Vui lòng thêm sản phẩm cần đổi/trả!", "error");
    }

    const returnSum = returnItems.reduce((a, b) => a + Math.round(b.price * b.qty), 0);
    const exchangeSum = exchangeItems.reduce((a, b) => a + Math.round(b.price * b.qty), 0);
    const difference = returnSum - exchangeSum;

    // Confirm transaction
    let msg = '📋 Xác nhận đổi/trả hàng:\n\n';
    msg += `• Trả hàng: ${returnItems.length} SP - ${money(returnSum)}\n`;
    msg += `• Đổi hàng: ${exchangeItems.length} SP - ${money(exchangeSum)}\n\n`;
    if (difference > 0) {
        msg += `💚 Trả khách: ${money(difference)}`;
    } else if (difference < 0) {
        msg += `❤️ Thu thêm: ${money(Math.abs(difference))}`;
    } else {
        msg += `⚖️ Ngang giá`;
    }

    if (!confirm(msg)) return;

    // Create return record
    const returnRecord = {
        id: 'RT-' + Date.now(),
        date: getAppDate().toISOString(),
        cust: cust?.name || 'Khách lẻ',
        custId: cust?.id || null,
        customer: cust ? { ...cust } : { name: 'Khách lẻ' },
        customerId: cust?.id || null,
        returnItems: returnItems.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty, total: getReturnItemTotal(i) })),
        exchangeItems: exchangeItems.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty, total: getReturnItemTotal(i) })),
        returnTotal: returnSum,
        exchangeTotal: exchangeSum,
        difference: difference,
        note: '',
        staff: currUser?.name || 'Admin'
    };
    const returnCommit = beginReturnCommit();
    if (!returnCommit) return;

    // Update stock: +return items, -exchange items + Add stock history
    returnItems.forEach(item => {
        const p = db.products.find(x => sameStoredId(x.id, item.id));
        if (p) {
            p.stock = (p.stock || 0) + item.qty; // Add back to stock
            // Add stock history entry for returned item
            db.stockHistory.unshift({
                id: Date.now() + Math.random(),
                date: getAppDate().toISOString(),
                type: 'in',
                productId: item.id,
                productName: p.name,
                qty: item.qty,
                price: item.price,
                total: item.total || Math.round(item.qty * item.price),
                note: `Trả hàng - Phiếu ${returnRecord.id}`,
                user: currUser?.name || 'Admin',
                source: 'return'
            });
        }
    });

    exchangeItems.forEach(item => {
        const p = db.products.find(x => sameStoredId(x.id, item.id));
        if (p) {
            p.stock = (p.stock || 0) - item.qty; // Remove from stock
            // Add stock history entry for exchanged item
            db.stockHistory.unshift({
                id: Date.now() + Math.random(),
                date: getAppDate().toISOString(),
                type: 'out',
                productId: item.id,
                productName: p.name,
                qty: item.qty,
                price: item.price,
                total: item.total || Math.round(item.qty * item.price),
                note: `Đổi hàng - Phiếu ${returnRecord.id}`,
                user: currUser?.name || 'Admin',
                source: 'exchange'
            });
        }
    });

    // Save to db.returns
    if (!db.returns) db.returns = [];
    db.returns.unshift(returnRecord);

    recordReturnCustomerEffects(returnRecord, customer => {
        if (!db.settings.pointsEnabled) return;
        const points = Math.floor((returnRecord.returnTotal || 0) * (db.settings.pointsRate || 1) / 100);
        customer.points = Math.max(0, (customer.points || 0) - points);
    });

    // Push undo action
    pushUndo(UNDO_ACTIONS.RETURN_GOODS, {
        returnRecord: JSON.parse(JSON.stringify(returnRecord)),
        returnItems: returnItems.map(i => ({ id: i.id, qty: i.qty })),
        exchangeItems: exchangeItems.map(i => ({ id: i.id, qty: i.qty }))
    });

    // Log activity
    const summary = difference > 0
        ? `Trả khách ${money(difference)}`
        : difference < 0
            ? `Thu thêm ${money(Math.abs(difference))}`
            : 'Ngang giá';
    logActivity('Đổi/Trả hàng', `Phiếu #${returnRecord.id.slice(-6)} - ${summary}`);

    if (!saveReturnAndPreview(returnRecord.id, returnCommit)) return;

    // Show success
    toast('✅ Hoàn thành đổi/trả hàng!', 'success');
    playSuccessSound();

    // Exit return/exchange mode
    toggleReturnExchangeMode();
    renderPos();

    // Update related views
    renderReturnsHistory();
    renderStockHistory();
}

// NOTE: Return/exchange mode is handled by adding check at top of original addCart function
// See addCart function at line ~2706

// ========== QUICK RETURN/EXCHANGE MODAL (KiotViet Style) ==========
let qrReturnItems = [];   // Items to return
let qrExchangeItems = []; // Items to exchange/buy
let qrAddMode = 'return'; // 'return' or 'exchange' - which list to add to

// Open Quick Return Exchange Modal
function openQuickReturnExchangeModal() {
    qrReturnItems = [];
    qrExchangeItems = [];
    qrAddMode = 'return';

    const modal = $('quick-return-exchange-modal');
    if (modal) {
        modal.classList.add('active');
        setTimeout(() => $('qr-search')?.focus(), 100);
    }

    renderQRReturnList();
    renderQRExchangeList();
    updateQRDifference();
}

// Close Quick Return Exchange Modal
function closeQuickReturnExchangeModal() {
    const hasItems = qrReturnItems.length > 0 || qrExchangeItems.length > 0;
    if (hasItems) {
        if (!confirm('Hủy giao dịch trả/đổi hàng này?')) {
            return;
        }
    }

    qrReturnItems = [];
    qrExchangeItems = [];

    const modal = $('quick-return-exchange-modal');
    if (modal) modal.classList.remove('active');

    // Reset add mode
    qrAddMode = 'return';
    if ($('qr-add-mode')) $('qr-add-mode').value = 'return';
}

// Toggle add mode (return vs exchange)
function toggleQRExchangeMode() {
    qrAddMode = qrAddMode === 'return' ? 'exchange' : 'return';
    if ($('qr-add-mode')) $('qr-add-mode').value = qrAddMode;

    const label = qrAddMode === 'exchange' ? '📤 Đang thêm hàng MUA' : '📥 Đang thêm hàng TRẢ';
    toast(label, 'info');
}

// Filter products for QR search
function filterQuickReturnProducts() {
    const searchVal = ($('qr-search')?.value || '').toLowerCase().trim();
    const dropdown = $('qr-product-dropdown');

    if (!searchVal || searchVal.length < 1) {
        if (dropdown) dropdown.style.display = 'none';
        return;
    }

    // Fuzzy search
    const keywords = searchVal.split(/\s+/).filter(k => k.length > 0);
    const matches = db.products.filter(p => {
        const nameLC = p.name.toLowerCase();
        const codeLC = (p.code || '').toLowerCase();
        return keywords.every(k => nameLC.includes(k) || codeLC.includes(k));
    }).slice(0, 10); // Limit to 10 results

    if (matches.length === 0) {
        if (dropdown) dropdown.style.display = 'none';
        return;
    }

    // Render dropdown
    const modeLabel = qrAddMode === 'exchange' ? '➕ Mua' : '↩️ Trả';
    const modeColor = qrAddMode === 'exchange' ? 'var(--success)' : 'var(--warning)';

    dropdown.innerHTML = matches.map(p => {
        const productIdJs = escapeJsArgument(p.id);
        return `
        <div class="qr-product-item" onclick="addToQRList(${productIdJs})" 
            style="padding:10px 12px; cursor:pointer; border-bottom:1px solid var(--border-light); display:flex; justify-content:space-between; align-items:center;"
            onmouseover="this.style.background='var(--bg-muted)'" 
            onmouseout="this.style.background=''">
            <div>
                <div style="font-weight:600;">${escapeHtml(p.name)}</div>
                <div style="font-size:12px; color:var(--text-muted);">${escapeHtml(p.code || 'N/A')} | Kho: ${formatQty(p.stock)} | ${money(p.price)}</div>
            </div>
            <span style="background:${modeColor}; color:white; padding:4px 8px; border-radius:4px; font-size:11px;">${modeLabel}</span>
        </div>
    `;
    }).join('');

    dropdown.style.display = 'block';
}

// Handle keyboard in QR search
function handleQuickReturnSearchKey(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        const searchVal = ($('qr-search')?.value || '').trim();

        // Try exact barcode match first
        const exactMatch = db.products.find(p =>
            p.code?.toLowerCase() === searchVal.toLowerCase() ||
            p.name?.toLowerCase() === searchVal.toLowerCase()
        );

        if (exactMatch) {
            addToQRList(exactMatch.id);
            $('qr-search').value = '';
            $('qr-product-dropdown').style.display = 'none';
        } else {
            // Get first from dropdown
            const firstItem = $('qr-product-dropdown')?.querySelector('.qr-product-item');
            if (firstItem) {
                firstItem.click();
                $('qr-search').value = '';
            }
        }
    } else if (e.key === 'Escape') {
        $('qr-search').value = '';
        $('qr-product-dropdown').style.display = 'none';
    }
}

// Add product to appropriate list
function addToQRList(productId) {
    const p = db.products.find(x => sameStoredId(x.id, productId));
    if (!p) return;

    const targetList = qrAddMode === 'exchange' ? qrExchangeItems : qrReturnItems;
    const existing = targetList.find(x => sameStoredId(x.id, productId));

    if (existing) {
        existing.qty++;
    } else {
        targetList.push({
            id: p.id,
            name: p.name,
            code: p.code,
            price: p.price,
            qty: 1
        });
    }

    // Clear search
    $('qr-search').value = '';
    $('qr-product-dropdown').style.display = 'none';

    // Re-render lists
    if (qrAddMode === 'exchange') {
        renderQRExchangeList();
    } else {
        renderQRReturnList();
    }
    updateQRDifference();

    // Focus back to search
    $('qr-search')?.focus();
}

// Modify quantity in return list
function modQRReturnQty(productId, delta) {
    const item = qrReturnItems.find(x => sameStoredId(x.id, productId));
    if (!item) return;

    item.qty += delta;
    if (item.qty <= 0) {
        qrReturnItems = qrReturnItems.filter(x => !sameStoredId(x.id, productId));
    }

    renderQRReturnList();
    updateQRDifference();
}

// Modify quantity in exchange list
function modQRExchangeQty(productId, delta) {
    const item = qrExchangeItems.find(x => sameStoredId(x.id, productId));
    if (!item) return;

    item.qty += delta;
    if (item.qty <= 0) {
        qrExchangeItems = qrExchangeItems.filter(x => !sameStoredId(x.id, productId));
    }

    renderQRExchangeList();
    updateQRDifference();
}

// Render return items list
function renderQRReturnList() {
    const container = $('qr-return-list');
    if (!container) return;

    if (qrReturnItems.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding:30px; text-align:center; color:var(--text-muted);">
                <div style="font-size:24px;">📦</div>
                <div style="font-size:13px;">Thêm sản phẩm cần trả</div>
            </div>
        `;
        $('qr-return-total').innerText = '0 ₫';
        return;
    }

    let total = 0;
    container.innerHTML = qrReturnItems.map(item => {
        const lineTotal = item.price * item.qty;
        const itemIdJs = escapeJsArgument(item.id);
        total += lineTotal;
        return `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid var(--border-light);">
                <div style="flex:1;">
                    <div style="font-weight:600; font-size:13px;">${escapeHtml(item.name)}</div>
                    <div style="font-size:11px; color:var(--text-muted);">${money(item.price)}</div>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                    <button class="btn btn-sm" onclick="modQRReturnQty(${itemIdJs}, -1)" style="padding:2px 8px;">-</button>
                    <span style="min-width:30px; text-align:center; font-weight:600;">${formatQty(item.qty)}</span>
                    <button class="btn btn-sm" onclick="modQRReturnQty(${itemIdJs}, 1)" style="padding:2px 8px;">+</button>
                    <span style="min-width:80px; text-align:right; font-weight:600;">${money(lineTotal)}</span>
                </div>
            </div>
        `;
    }).join('');

    $('qr-return-total').innerText = money(total);
}

// Render exchange items list
function renderQRExchangeList() {
    const container = $('qr-exchange-list');
    if (!container) return;

    if (qrExchangeItems.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding:30px; text-align:center; color:var(--text-muted);">
                <div style="font-size:24px;">🛒</div>
                <div style="font-size:13px;">Thêm sản phẩm đổi lấy (tùy chọn)</div>
            </div>
        `;
        $('qr-exchange-total').innerText = '0 ₫';
        return;
    }

    let total = 0;
    container.innerHTML = qrExchangeItems.map(item => {
        const lineTotal = item.price * item.qty;
        const itemIdJs = escapeJsArgument(item.id);
        total += lineTotal;
        return `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid var(--border-light);">
                <div style="flex:1;">
                    <div style="font-weight:600; font-size:13px;">${escapeHtml(item.name)}</div>
                    <div style="font-size:11px; color:var(--text-muted);">${money(item.price)}</div>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                    <button class="btn btn-sm" onclick="modQRExchangeQty(${itemIdJs}, -1)" style="padding:2px 8px;">-</button>
                    <span style="min-width:30px; text-align:center; font-weight:600;">${formatQty(item.qty)}</span>
                    <button class="btn btn-sm" onclick="modQRExchangeQty(${itemIdJs}, 1)" style="padding:2px 8px;">+</button>
                    <span style="min-width:80px; text-align:right; font-weight:600;">${money(lineTotal)}</span>
                </div>
            </div>
        `;
    }).join('');

    $('qr-exchange-total').innerText = money(total);
}

// Calculate and display difference
function updateQRDifference() {
    const returnTotal = qrReturnItems.reduce((sum, i) => sum + Math.round(i.price * i.qty), 0);
    const exchangeTotal = qrExchangeItems.reduce((sum, i) => sum + Math.round(i.price * i.qty), 0);
    const diff = returnTotal - exchangeTotal;

    const diffLabel = $('qr-diff-label');
    const diffAmount = $('qr-diff-amount');
    const diffSection = $('qr-difference-section');

    if (diff > 0) {
        // Refund to customer
        diffLabel.innerText = '💰 Cần trả khách:';
        diffAmount.innerText = money(diff);
        diffAmount.style.color = 'var(--warning)';
        diffSection.style.borderColor = 'var(--warning)';
    } else if (diff < 0) {
        // Customer pays
        diffLabel.innerText = '💵 Khách cần trả thêm:';
        diffAmount.innerText = money(Math.abs(diff));
        diffAmount.style.color = 'var(--success)';
        diffSection.style.borderColor = 'var(--success)';
    } else {
        // Even
        diffLabel.innerText = '⚖️ Ngang giá:';
        diffAmount.innerText = '0 ₫';
        diffAmount.style.color = 'var(--primary)';
        diffSection.style.borderColor = 'var(--primary)';
    }
}

// Process the Quick Return/Exchange transaction
function processQuickReturnExchange() {
    if (qrReturnItems.length === 0) {
        return toast('Chưa có sản phẩm nào để trả!', 'error');
    }

    const returnTotal = qrReturnItems.reduce((sum, i) => sum + Math.round(i.price * i.qty), 0);
    const exchangeTotal = qrExchangeItems.reduce((sum, i) => sum + Math.round(i.price * i.qty), 0);
    const diff = returnTotal - exchangeTotal;

    // Build confirmation message
    let confirmMsg = `Xác nhận giao dịch:\n\n`;
    confirmMsg += `📥 Trả: ${qrReturnItems.length} SP = ${money(returnTotal)}\n`;
    if (qrExchangeItems.length > 0) {
        confirmMsg += `📤 Mua: ${qrExchangeItems.length} SP = ${money(exchangeTotal)}\n`;
    }
    confirmMsg += `\n💰 Chênh lệch: ${diff >= 0 ? 'Trả khách ' : 'Khách trả '}${money(Math.abs(diff))}`;

    if (!confirm(confirmMsg)) return;

    // Create return record
    const returnRecord = {
        id: Date.now().toString(),
        date: getAppDate().toISOString(),
        invoiceId: 'QUICK_RETURN',
        cust: cust?.name || 'Khách lẻ',
        custId: cust?.id || null,
        returnItems: qrReturnItems.map(i => ({ ...i, total: getReturnItemTotal(i) })),
        refundAmount: returnTotal,
        reason: qrExchangeItems.length > 0 ? 'exchange' : 'quick_return',
        note: qrExchangeItems.length > 0 ? 'Đổi hàng nhanh' : 'Trả hàng nhanh',
        staff: currUser?.name || '',
        isExchange: qrExchangeItems.length > 0,
        exchangeItems: qrExchangeItems.map(i => ({ ...i, total: getReturnItemTotal(i) })),
        exchangeTotal: exchangeTotal,
        difference: diff,
        returnTotal: returnTotal
    };
    const returnCommit = beginReturnCommit();
    if (!returnCommit) return;

    // Update stock: Add returned items back + Add stock history
    qrReturnItems.forEach(item => {
        const p = db.products.find(x => sameStoredId(x.id, item.id));
        if (p) {
            p.stock += item.qty;
            // Add stock history entry for returned item
            db.stockHistory.unshift({
                id: Date.now() + Math.random(),
                date: getAppDate().toISOString(),
                type: 'in',
                productId: item.id,
                productName: p.name,
                qty: item.qty,
                price: item.price,
                total: item.total || Math.round(item.qty * item.price),
                note: `Trả hàng nhanh (QR) - Phiếu ${returnRecord.id}`,
                user: currUser?.name || '',
                source: 'quick_return'
            });
        }
    });

    // Update stock: Subtract exchanged/bought items + Add stock history
    qrExchangeItems.forEach(item => {
        const p = db.products.find(x => sameStoredId(x.id, item.id));
        if (p) {
            p.stock -= item.qty;
            // Add stock history entry for exchanged item
            db.stockHistory.unshift({
                id: Date.now() + Math.random(),
                date: getAppDate().toISOString(),
                type: 'out',
                productId: item.id,
                productName: p.name,
                qty: item.qty,
                price: item.price,
                total: item.total || Math.round(item.qty * item.price),
                note: `Đổi hàng nhanh (QR) - Phiếu ${returnRecord.id}`,
                user: currUser?.name || '',
                source: 'exchange'
            });
        }
    });

    // Save return record
    if (!db.returns) db.returns = [];
    db.returns.unshift(returnRecord);

    // ponytail: retain the applied value so Undo and deletion are exact when points were insufficient.
    recordReturnCustomerEffects(returnRecord, () => {
        returnRecord.pointsReversed = reverseQuickReturnCustomerPoints(returnRecord);
    });

    // Push undo for Ctrl+Z support (consistent with other return pathways)
    pushUndo(UNDO_ACTIONS.RETURN_GOODS, {
        returnRecord: JSON.parse(JSON.stringify(returnRecord)),
        returnItems: qrReturnItems.map(i => ({ id: i.id, qty: i.qty })),
        exchangeItems: qrExchangeItems.map(i => ({ id: i.id, qty: i.qty }))
    });

    // Log activity
    if (qrExchangeItems.length > 0) {
        logActivity('Đổi hàng nhanh', `${qrReturnItems.length} SP trả, ${qrExchangeItems.length} SP mua - Chênh lệch: ${money(diff)}`);
    } else {
        logActivity('Trả hàng nhanh', `${qrReturnItems.length} SP - ${money(returnTotal)}`);
    }

    if (!saveReturnAndPreview(returnRecord.id, returnCommit)) return;

    // Success message
    const successMsg = qrExchangeItems.length > 0
        ? `✅ Đổi hàng thành công! Chênh lệch: ${money(diff)}`
        : `✅ Trả hàng thành công! Hoàn tiền: ${money(returnTotal)}`;
    toast(successMsg, 'success');

    // Close modal and reset
    qrReturnItems = [];
    qrExchangeItems = [];
    const modal = $('quick-return-exchange-modal');
    if (modal) modal.classList.remove('active');

    // Refresh views
    renderPos();
    renderHist();
    renderReturnsHistory();
    renderStockHistory();
}

// Process Quick Return - return items without original invoice
function processQuickReturn() {
    // Redirect to tab-based checkoutReturn if current tab is in return mode (new system)
    const currentTab = invoiceTabs.find(t => t.id === activeTabId);
    if (currentTab && currentTab.mode === 'return') {
        checkoutReturn();
        return;
    }

    // Legacy fallback for old isQuickReturnMode system
    if (!isQuickReturnMode) return;
    if (cart.length === 0) return toast('Chưa có sản phẩm nào để trả!', 'error');

    // Calculate total refund
    let refundAmount = 0;
    const returnItems = cart.map(item => {
        const itemTotal = Math.round(item.price * item.qty);
        refundAmount += itemTotal;
        return {
            id: item.id,
            name: item.name,
            price: item.price,
            qty: item.qty,
            unit: item.unit || 'SP',
            total: itemTotal
        };
    });

    // Confirm return
    if (!confirm(`Xác nhận trả ${returnItems.length} sản phẩm?\nTổng tiền hoàn: ${money(refundAmount)}`)) {
        return;
    }

    // Create return record
    const returnRecord = {
        id: Date.now().toString(),
        date: getAppDate().toISOString(),
        invoiceId: 'QUICK_RETURN', // Mark as quick return
        cust: cust?.name || 'Khách lẻ',
        custId: cust?.id || null,
        returnItems: returnItems,
        refundAmount,
        reason: 'quick_return',
        note: 'Trả hàng nhanh - không có hóa đơn gốc',
        staff: currUser?.name || ''
    };
    const returnCommit = beginReturnCommit();
    if (!returnCommit) return;

    // Update stock (add back) + Add stock history
    returnItems.forEach(item => {
        const p = db.products.find(x => sameStoredId(x.id, item.id));
        if (p) {
            p.stock += item.qty;
            // Add stock history entry for returned item
            db.stockHistory.unshift({
                id: Date.now() + Math.random(),
                date: getAppDate().toISOString(),
                type: 'in',
                productId: item.id,
                productName: p.name,
                qty: item.qty,
                price: item.price,
                total: item.total || Math.round(item.qty * item.price),
                note: `Trả hàng nhanh - Phiếu ${returnRecord.id}`,
                user: currUser?.name || '',
                source: 'quick_return'
            });
        }
    });

    // Save return record
    if (!db.returns) db.returns = [];
    db.returns.unshift(returnRecord);

    recordReturnCustomerEffects(returnRecord, customer => {
        if (!db.settings.pointsEnabled) return;
        const points = Math.floor(refundAmount * (db.settings.pointsRate || 1) / 100);
        customer.points = Math.max(0, (customer.points || 0) - points);
    });

    // Push undo for Ctrl+Z support (consistent with other return pathways)
    pushUndo(UNDO_ACTIONS.RETURN_GOODS, {
        returnRecord: JSON.parse(JSON.stringify(returnRecord)),
        returnItems: returnItems.map(i => ({ id: i.id, qty: i.qty })),
        exchangeItems: []
    });

    logActivity('Trả hàng nhanh', `${returnItems.length} SP - ${money(refundAmount)}`);

    if (!saveReturnAndPreview(returnRecord.id, returnCommit)) return;

    // Clear cart and exit quick return mode
    cart = [];
    isQuickReturnMode = false;

    // Reset UI
    const quickReturnBtn = $('btn-quick-return');
    const paymentBtn = $('btn-payment');
    const cartHeader = document.querySelector('.cart-header span');

    if (quickReturnBtn) {
        quickReturnBtn.style.background = '';
        quickReturnBtn.style.color = '';
        quickReturnBtn.innerHTML = '⚡ Trả nhanh';
    }
    if (paymentBtn) {
        paymentBtn.onclick = directCheckout;
        const payKey3 = db.settings?.shortcuts?.pay || 'F4';
        paymentBtn.innerHTML = `✅ Thanh toán (${payKey3})`;
        paymentBtn.style.background = '';
    }
    if (cartHeader) {
        cartHeader.innerHTML = '🛒 Giỏ hàng';
    }

    renderCart();
    renderPos();
    renderHist();
    renderReturnsHistory();
    renderStockHistory();

    toast(`✅ Đã trả hàng thành công! Hoàn tiền: ${money(refundAmount)}`, 'success');
}

// ========== EXCHANGE FEATURE ==========
// Note: exchangeItems is declared at top of script (line 93)

// Toggle exchange section based on reason selection
function onReturnReasonChange() {
    const reason = $('return-reason')?.value;
    const exchangeSection = $('exchange-section');
    const processBtn = $('btn-process-return');

    if (reason === 'exchange') {
        if (exchangeSection) exchangeSection.style.display = 'block';
        if (processBtn) processBtn.innerHTML = '🔄 Xác nhận đổi hàng';
        updateExchangeCalculation();
    } else {
        if (exchangeSection) exchangeSection.style.display = 'none';
        if (processBtn) processBtn.innerHTML = '✅ Xác nhận trả hàng';
        exchangeItems = [];
    }
}

// Open modal to select exchange products
function openExchangeProductSelector() {
    $('exchange-product-modal').classList.add('active');
    $('exchange-product-search').value = '';
    filterExchangeProducts();
    setTimeout(() => $('exchange-product-search')?.focus(), 100);
}

// Filter products for exchange
function filterExchangeProducts() {
    const search = ($('exchange-product-search')?.value || '').toLowerCase();
    const list = $('exchange-product-list');
    if (!list) return;

    let products = db.products.filter(p => p.stock > 0);

    if (search) {
        products = products.filter(p =>
            p.name.toLowerCase().includes(search) ||
            (p.code || '').toLowerCase().includes(search)
        );
    }

    products = products.slice(0, 50); // Limit for performance

    if (products.length === 0) {
        list.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">Không tìm thấy sản phẩm</div>';
        return;
    }

    list.innerHTML = products.map(p => {
        const productIdJs = escapeJsArgument(p.id);
        return `
        <div class="d-flex justify-between items-center" 
            style="padding:10px 12px; border-bottom:1px solid var(--border-light); cursor:pointer; transition:background 0.2s;"
            onmouseover="this.style.background='var(--bg-muted)'" 
            onmouseout="this.style.background='transparent'"
            onclick="addExchangeProduct(${productIdJs})">
            <div style="flex:1;">
                <div style="font-weight:600;">${escapeHtml(p.name)}</div>
                <div style="font-size:11px; color:var(--text-muted);">Mã: ${escapeHtml(p.code || '-')} | Tồn: ${p.stock}</div>
            </div>
            <div style="text-align:right;">
                <div style="font-weight:700; color:var(--primary);">${money(p.price)}</div>
                <button class="btn btn-sm btn-success" style="font-size:10px; padding:2px 8px;">+ Thêm</button>
            </div>
        </div>
    `;
    }).join('');
}

// Add product to exchange list
function addExchangeProduct(productId) {
    const product = db.products.find(p => sameStoredId(p.id, productId));
    if (!product) return;

    const existing = exchangeItems.find(x => sameStoredId(x.id, productId));
    if (existing) {
        existing.qty++;
    } else {
        exchangeItems.push({
            id: product.id,
            name: product.name,
            price: product.price,
            qty: 1
        });
    }

    renderExchangeItems();
    updateExchangeCalculation();
    toast(`Đã thêm: ${product.name}`, 'success');
}

// Remove product from exchange list
function removeExchangeProduct(productId) {
    exchangeItems = exchangeItems.filter(x => !sameStoredId(x.id, productId));
    renderExchangeItems();
    updateExchangeCalculation();
}

// Modify exchange item quantity
function modifyExchangeQty(productId, delta) {
    const item = exchangeItems.find(x => sameStoredId(x.id, productId));
    if (!item) return;

    item.qty += delta;
    if (item.qty <= 0) {
        exchangeItems = exchangeItems.filter(x => !sameStoredId(x.id, productId));
    }

    renderExchangeItems();
    updateExchangeCalculation();
}

// Render exchange items list
function renderExchangeItems() {
    const list = $('modal-exchange-items-list');
    if (!list) return;

    if (exchangeItems.length === 0) {
        list.innerHTML = `<div style="padding:8px; text-align:center; color:var(--text-muted); font-size:12px;">
            Chưa chọn sản phẩm đổi. Bấm "+ Thêm SP" để chọn.
        </div>`;
        return;
    }

    list.innerHTML = exchangeItems.map(item => {
        const itemIdJs = escapeJsArgument(item.id);
        return `
        <div class="d-flex justify-between items-center" 
            style="padding:8px; border-bottom:1px solid var(--border-light); background:var(--bg-surface);">
            <div style="flex:1;">
                <div style="font-weight:600; font-size:13px;">${escapeHtml(item.name)}</div>
                <div style="font-size:12px; color:var(--primary);">${money(item.price)}</div>
            </div>
            <div class="d-flex items-center gap-1">
                <button class="btn btn-sm btn-secondary" onclick="modifyExchangeQty(${itemIdJs}, -1)" style="padding:2px 6px;">−</button>
                <span style="min-width:30px; text-align:center; font-weight:600;">${item.qty}</span>
                <button class="btn btn-sm btn-secondary" onclick="modifyExchangeQty(${itemIdJs}, 1)" style="padding:2px 6px;">+</button>
                <button class="btn btn-sm btn-danger" onclick="removeExchangeProduct(${itemIdJs})" style="padding:2px 6px;">✕</button>
            </div>
        </div>
    `;
    }).join('');
}

// Calculate exchange amounts
function updateExchangeCalculation() {
    // Get return amount from updateReturnRefund
    const returnAmountEl = $('return-refund-amount');
    const returnAmount = parseInt((returnAmountEl?.value || '0').replace(/\D/g, '')) || 0;

    // Calculate new products total
    const newAmount = exchangeItems.reduce((sum, item) => sum + (item.price * item.qty), 0);

    // Calculate difference
    const diff = newAmount - returnAmount;

    // Update display
    if ($('exchange-return-amount')) $('exchange-return-amount').innerText = money(returnAmount);
    if ($('exchange-new-amount')) $('exchange-new-amount').innerText = money(newAmount);

    const diffEl = $('exchange-diff-amount');
    if (diffEl) {
        if (diff > 0) {
            diffEl.style.color = 'var(--danger)';
            diffEl.innerText = `+${money(diff)}`; // Customer pays more
        } else if (diff < 0) {
            diffEl.style.color = 'var(--success)';
            diffEl.innerText = money(diff); // Refund to customer
        } else {
            diffEl.style.color = 'var(--text-primary)';
            diffEl.innerText = '0 ₫'; // Even
        }
    }
}

// Return reason change listener - initialized in consolidated DOMContentLoaded

function openReturnModal() {
    $('return-modal').classList.add('active');
    $('return-invoice-search').value = '';
    $('return-invoice-info').style.display = 'none';
    $('modal-return-items-list').innerHTML = '';
    $('return-note').value = '';
    $('return-refund-amount').value = '';
    currentReturnInvoice = null;

    // Reset exchange items
    exchangeItems = [];
    if ($('exchange-section')) $('exchange-section').style.display = 'none';
    if ($('return-reason')) $('return-reason').value = 'defect';
    if ($('btn-process-return')) $('btn-process-return').innerHTML = '✅ Xác nhận trả hàng';

    // Show recent orders section (it may have been hidden when an invoice was selected)
    const recentOrdersSection = $('return-recent-orders');
    if (recentOrdersSection) {
        recentOrdersSection.style.display = 'block';
    }

    // Render recent orders
    renderRecentOrdersForReturn();

    setTimeout(() => $('return-invoice-search')?.focus(), 100);
}

function renderRecentOrdersForReturn() {
    const recentList = $('return-recent-list');
    if (!recentList) return;

    // Get filter values
    const productSearch = ($('return-product-search')?.value || '').trim().toLowerCase();
    const dateFrom = $('return-date-from')?.value ? (() => { const d = new Date($('return-date-from').value + 'T00:00:00'); return d; })() : null;
    const dateTo = $('return-date-to')?.value ? (() => { const d = new Date($('return-date-to').value + 'T23:59:59'); return d; })() : null;

    // Filter orders
    let orders = [...db.invoices];

    // Filter by product name
    if (productSearch) {
        orders = orders.filter(inv =>
            inv.items.some(item => item.name.toLowerCase().includes(productSearch))
        );
    }

    // Filter by date range
    if (dateFrom) {
        orders = orders.filter(inv => new Date(inv.date) >= dateFrom);
    }
    if (dateTo) {
        orders = orders.filter(inv => new Date(inv.date) <= dateTo);
    }

    // Sort newest first before limiting to keep the "recent orders" list correct
    orders = orders.sort((a, b) => new Date(b.date) - new Date(a.date));
    orders = orders.slice(0, 50);

    // Update count display
    const countEl = $('return-orders-count');
    if (countEl) {
        countEl.textContent = `Hiển thị ${orders.length} / ${db.invoices.length} đơn`;
    }

    if (orders.length === 0) {
        recentList.innerHTML = '<div style="padding:16px; text-align:center; color:var(--text-muted);">Không tìm thấy đơn hàng phù hợp</div>';
        return;
    }

    recentList.innerHTML = orders.map(inv => {
        const invoiceIdJs = escapeJsArgument(inv.id);
        const d = new Date(inv.date);
        const timeStr = `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
        const itemsCount = inv.items.reduce((a, b) => a + b.qty, 0);
        // Show product names (max 3)
        const productNames = inv.items.slice(0, 3).map(i => i.name).join(', ');
        const moreProducts = inv.items.length > 3 ? ` +${inv.items.length - 3}` : '';

        return `<div class="recent-order-item" onclick="selectInvoiceForReturn(${invoiceIdJs})" 
            style="padding:10px 12px; border-bottom:1px solid var(--border-light); cursor:pointer; transition:background 0.2s;"
            onmouseover="this.style.background='var(--bg-muted)'" 
            onmouseout="this.style.background='transparent'">
            <div class="d-flex justify-between items-center">
                <div style="flex:1; min-width:0;">
                    <div class="d-flex items-center gap-2">
                        <code style="font-size:13px; color:var(--primary); font-weight:600;">#${escapeHtml(String(inv.id ?? '').slice(-6))}</code>
                        <span style="font-size:12px; color:var(--text-muted);">${timeStr}</span>
                    </div>
                    <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">
                        👤 ${escapeHtml(inv.cust)} • ${itemsCount} sản phẩm
                    </div>
                    <div style="font-size:11px; color:var(--text-muted); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        📦 ${escapeHtml(productNames)}${moreProducts}
                    </div>
                </div>
                <div style="text-align:right; flex-shrink:0; margin-left:8px;">
                    <div style="font-weight:600; color:var(--primary); font-size:14px;">${money(inv.total)}</div>
                    <span class="badge badge-${inv.method === 'CASH' ? 'success' : 'primary'}" style="font-size:10px;">${escapeHtml(inv.method || '-')}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

function selectInvoiceForReturn(invoiceId) {
    $('return-invoice-search').value = String(invoiceId ?? '').slice(-6);
    searchInvoiceForReturn();
}

// Filter return orders by product name
function filterReturnOrdersByProduct() {
    renderRecentOrdersForReturn();
}

// Filter return orders by date range
function filterReturnOrdersByDate() {
    renderRecentOrdersForReturn();
}

// Toggle return date filter dropdown
function toggleReturnDateFilter() {
    const menu = $('return-date-filter-menu');
    if (menu) {
        menu.classList.toggle('show');
        if (menu.classList.contains('show')) {
            setTimeout(() => {
                document.addEventListener('click', function closeReturnMenu(e) {
                    if (!e.target.closest('.date-filter-dropdown')) {
                        menu.classList.remove('show');
                        document.removeEventListener('click', closeReturnMenu);
                    }
                });
            }, 10);
        }
    }
}

// Set return date preset
function setReturnDatePreset(preset) {
    const now = getAppDate();
    let from = null;
    let to = new Date(now);
    let label = '';

    // Update active button
    document.querySelectorAll('#return-date-filter-menu .date-preset-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    // Hide custom section by default
    const customSection = $('return-custom-date-section');
    if (customSection) customSection.style.display = 'none';

    switch (preset) {
        case 'all':
            label = 'Tất cả thời gian';
            break;
        case 'today':
            from = new Date(now);
            label = 'Hôm nay';
            break;
        case 'yesterday':
            from = new Date(now);
            from.setDate(from.getDate() - 1);
            to = new Date(from);
            label = 'Hôm qua';
            break;
        case 'week':
            from = new Date(now);
            from.setDate(from.getDate() - 7);
            label = '7 ngày qua';
            break;
        case 'month':
            from = new Date(now);
            from.setDate(from.getDate() - 30);
            label = '30 ngày qua';
            break;
        case 'custom':
            if (customSection) customSection.style.display = 'block';
            return; // Don't close menu or apply filter yet
    }

    // Update inputs
    const fromEl = $('return-date-from');
    const toEl = $('return-date-to');
    if (fromEl) fromEl.value = from ? toLocalDateStr(from) : '';
    if (toEl) toEl.value = to ? toLocalDateStr(to) : '';

    // Update label
    const labelEl = $('return-date-label');
    if (labelEl) labelEl.textContent = label;

    // Close menu
    const menu = $('return-date-filter-menu');
    if (menu) menu.classList.remove('show');

    // Update list
    renderRecentOrdersForReturn();
}

// Apply custom date filter
function applyReturnCustomDate() {
    const fromEl = $('return-date-from');
    const toEl = $('return-date-to');

    if (fromEl?.value && toEl?.value) {
        const from = new Date(fromEl.value);
        const to = new Date(toEl.value);
        const labelEl = $('return-date-label');
        if (labelEl) {
            labelEl.textContent = `${from.toLocaleDateString('vi-VN')} - ${to.toLocaleDateString('vi-VN')}`;
        }

        // Remove active from all presets
        document.querySelectorAll('#return-date-filter-menu .date-preset-btn').forEach(btn => {
            btn.classList.remove('active');
        });
    }

    // Close menu
    const menu = $('return-date-filter-menu');
    if (menu) menu.classList.remove('show');

    // Update list
    renderRecentOrdersForReturn();
}

// Clear all return filters
function clearReturnFilters() {
    if ($('return-product-search')) $('return-product-search').value = '';
    if ($('return-date-from')) $('return-date-from').value = '';
    if ($('return-date-to')) $('return-date-to').value = '';
    if ($('return-date-label')) $('return-date-label').textContent = 'Tất cả thời gian';

    // Reset active button
    document.querySelectorAll('#return-date-filter-menu .date-preset-btn').forEach((btn, index) => {
        btn.classList.toggle('active', index === 0);
    });

    renderRecentOrdersForReturn();
    toast('Đã xóa bộ lọc');
}

function searchInvoiceForReturn() {
    const search = ($('return-invoice-search')?.value || '').trim().toLowerCase();
    if (!search) return toast("Nhập mã hóa đơn!", "warning");

    const inv = db.invoices.find(i => {
        const storedId = String(i.id ?? '');
        return storedId.toLowerCase().includes(search) || storedId.slice(-6).toLowerCase() === search;
    });
    if (!inv) return toast("Không tìm thấy hóa đơn!", "error");

    currentReturnInvoice = inv;

    // Hide recent orders and show invoice info
    if ($('return-recent-orders')) $('return-recent-orders').style.display = 'none';

    // Display invoice info
    $('return-inv-id').innerText = '#' + String(inv.id ?? '').slice(-6);
    $('return-inv-date').innerText = new Date(inv.date).toLocaleString('vi-VN');
    $('return-inv-cust').innerText = inv.cust;
    $('return-inv-total').innerText = money(inv.total);

    // Display payment method
    const methodLabels = { 'CASH': '💵 Tiền mặt', 'CK': '🏦 Chuyển khoản', 'COMBO': '💳 Combo' };
    if ($('return-inv-method')) {
        $('return-inv-method').innerText = methodLabels[inv.method] || inv.method;
    }

    // Display items summary
    if ($('return-inv-items-summary')) {
        const itemsSummary = inv.items.map(i =>
            `<div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dotted var(--border-light);">
                <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(i.name)} × ${i.qty}</span>
                <strong style="margin-left:8px; white-space:nowrap;">${money(i.price * i.qty)}</strong>
            </div>`
        ).join('');
        $('return-inv-items-summary').innerHTML = itemsSummary;
    }

    // Calculate already returned quantities
    const returnedQty = {};
    db.returns.filter(r => sameStoredId(r.invoiceId, inv.id)).forEach(r => {
        (r.returnItems || r.items || []).forEach(i => {
            returnedQty[i.id] = (returnedQty[i.id] || 0) + i.qty;
        });
    });

    // Display items with checkboxes - TABLE LAYOUT
    $('modal-return-items-list').innerHTML = `<table style="width:100%; border-collapse:collapse;">
        <thead>
            <tr style="background:var(--bg-muted); font-size:12px; color:var(--text-muted);">
                <th style="padding:8px 10px; text-align:center; width:30px;">
                    <input type="checkbox" id="return-select-all" onchange="toggleAllReturnItems(this.checked)" title="Chọn tất cả">
                </th>
                <th style="padding:8px 6px; text-align:left;">Sản phẩm</th>
                <th style="padding:8px 6px; text-align:right; width:90px;">Đơn giá</th>
                <th style="padding:8px 10px; text-align:center; width:80px;">SL trả</th>
            </tr>
            <tr style="background:var(--warning-light); font-size:11px;">
                <td colspan="4" style="padding:6px 10px; color:var(--text-secondary);">
                    💡 <em>Không cần tick - mặc định trả tất cả. Tick nếu muốn chọn riêng từng sản phẩm.</em>
                </td>
            </tr>
        </thead>
        <tbody>
            ${inv.items.map(i => {
        const itemIdAttr = escapeAttr(String(i.id ?? ''));
        const alreadyReturned = returnedQty[i.id] || 0;
        const maxQty = i.qty - alreadyReturned;
        if (maxQty <= 0) {
            return `<tr style="opacity:0.5; background:var(--bg-muted);">
                        <td colspan="4" style="padding:8px 10px; font-size:13px;">
                            <s>${escapeHtml(i.name)}</s> <span class="badge badge-secondary" style="font-size:10px;">Đã trả hết</span>
                        </td>
                    </tr>`;
        }
        return `<tr style="border-bottom:1px solid var(--border-light);">
                    <td style="padding:8px 10px; text-align:center;">
                        <input type="checkbox" id="return-item-${itemIdAttr}" data-id="${itemIdAttr}" data-name="${escapeAttr(i.name)}" data-price="${i.price}" data-maxqty="${maxQty}" onchange="updateReturnRefund()">
                    </td>
                    <td style="padding:8px 6px;">
                        <div style="font-weight:600; font-size:13px;">${escapeHtml(i.name)}</div>
                        <div style="font-size:11px; color:var(--text-muted);">
                            Đã mua: ${formatQty(i.qty)}${alreadyReturned > 0 ? ` <span style="color:var(--warning);">(trả ${formatQty(alreadyReturned)})</span>` : ''}
                        </div>
                    </td>
                    <td style="padding:8px 6px; text-align:right; font-size:13px; white-space:nowrap;">${money(i.price)}</td>
                    <td style="padding:8px 10px; text-align:center;">
                        <input type="number" id="return-qty-${itemIdAttr}" min="0.001" max="${maxQty}" value="${maxQty}" step="0.001"
                            style="width:60px; padding:4px; text-align:center; font-size:13px;" onchange="updateReturnRefund()">
                    </td>
                </tr>`;
    }).join('')}
        </tbody>
    </table>`;

    $('return-invoice-info').style.display = 'block';
    updateReturnRefund();
}

// Toggle all return checkboxes
function toggleAllReturnItems(checked) {
    if (!currentReturnInvoice) return;
    currentReturnInvoice.items.forEach(i => {
        const checkbox = $(`return-item-${i.id}`);
        if (checkbox && !checkbox.disabled) {
            checkbox.checked = checked;
        }
    });
    updateReturnRefund();
}

function updateReturnRefund() {
    if (!currentReturnInvoice) return;

    // Check if any items are selected
    let anySelected = false;
    currentReturnInvoice.items.forEach(i => {
        const checkbox = $(`return-item-${i.id}`);
        if (checkbox?.checked) anySelected = true;
    });

    let total = 0;
    currentReturnInvoice.items.forEach(i => {
        const checkbox = $(`return-item-${i.id}`);
        const qtyInput = $(`return-qty-${i.id}`);

        // If any item is selected, only count selected items
        // If nothing selected, count all items (default return all)
        if (qtyInput) {
            const qty = Math.min(parseFloat(qtyInput.value) || 0, parseFloat(qtyInput.max) || 1);
            if (anySelected) {
                // Manual selection mode - only count checked items
                if (checkbox?.checked) {
                    total += i.price * qty;
                }
            } else {
                // Default mode - count all returnable items
                if (parseFloat(qtyInput.max) > 0) {
                    total += i.price * qty;
                }
            }
        }
    });

    $('return-refund-amount').value = money(total);

    // Update exchange calculation if in exchange mode
    if ($('return-reason')?.value === 'exchange') {
        updateExchangeCalculation();
    }
}

function processReturn() {
    if (!currentReturnInvoice) return toast("Chưa chọn hóa đơn!", "error");

    const isExchange = $('return-reason')?.value === 'exchange';

    // Validate exchange: must have exchange items
    if (isExchange && exchangeItems.length === 0) {
        return toast("Vui lòng chọn sản phẩm đổi lấy!", "error");
    }

    // Check if any items are manually selected
    let anySelected = false;
    currentReturnInvoice.items.forEach(i => {
        const checkbox = $(`return-item-${i.id}`);
        if (checkbox?.checked) anySelected = true;
    });

    const returnItems = [];
    let refundAmount = 0;

    currentReturnInvoice.items.forEach(i => {
        const checkbox = $(`return-item-${i.id}`);
        const qtyInput = $(`return-qty-${i.id}`);

        if (qtyInput) {
            const maxQty = parseFloat(qtyInput.max) || 0;
            if (maxQty <= 0) return; // Skip already fully returned items

            const qty = Math.min(parseFloat(qtyInput.value) || 0, maxQty);

            if (anySelected) {
                // Manual selection mode - only return checked items
                if (checkbox?.checked && qty > 0) {
                    returnItems.push({ id: i.id, name: i.name, price: i.price, qty, unit: i.unit || 'SP', total: Math.round(i.price * qty) });
                    refundAmount += i.price * qty;
                }
            } else {
                // Default mode - return all items with quantity
                if (qty > 0) {
                    returnItems.push({ id: i.id, name: i.name, price: i.price, qty, unit: i.unit || 'SP', total: Math.round(i.price * qty) });
                    refundAmount += i.price * qty;
                }
            }
        }
    });

    if (returnItems.length === 0) return toast("Không có sản phẩm nào để trả!", "error");

    // Calculate exchange amounts
    let exchangeTotal = 0;
    let difference = 0; // Positive = refund to customer, negative = customer pays extra
    if (isExchange) {
        exchangeTotal = exchangeItems.reduce((sum, item) => sum + (item.price * item.qty), 0);
        difference = refundAmount - exchangeTotal;
    } else {
        difference = refundAmount;
    }

    // Confirm action
    let confirmMsg = isExchange
        ? `Xác nhận ĐỔI HÀNG?\n\nTrả: ${returnItems.length} SP = ${money(refundAmount)}\nĐổi: ${exchangeItems.length} SP = ${money(exchangeTotal)}\nChênh lệch: ${difference > 0 ? 'Hoàn khách ' + money(difference) : difference < 0 ? 'Khách trả thêm ' + money(Math.abs(difference)) : 'Ngang giá'}`
        : `Xác nhận trả ${returnItems.length} sản phẩm?\nTổng tiền hoàn: ${money(refundAmount)}`;

    if (!confirm(confirmMsg)) return;

    const returnRecord = {
        id: Date.now().toString(),
        date: getAppDate().toISOString(),
        invoiceId: currentReturnInvoice.id,
        cust: currentReturnInvoice.cust,
        custId: currentReturnInvoice.custId,
        returnItems: returnItems,
        refundAmount,
        reason: $('return-reason')?.value || 'other',
        note: $('return-note')?.value || '',
        staff: currUser?.name || '',
        // Exchange specific fields
        isExchange: isExchange,
        exchangeItems: isExchange ? [...exchangeItems] : [],
        exchangeTotal: exchangeTotal,
        difference: difference,
        returnTotal: refundAmount
    };
    const sourceInvoiceDisplayId = String(currentReturnInvoice.id ?? '').slice(-6);
    const returnCommit = beginReturnCommit();
    if (!returnCommit) return;

    // Update stock for returned items (add back) + Add stock history
    returnItems.forEach(i => {
        const p = db.products.find(x => sameStoredId(x.id, i.id));
        if (p) {
            p.stock += i.qty;
            // Add stock history entry for returned item
            db.stockHistory.unshift({
                id: Date.now() + Math.random(),
                date: getAppDate().toISOString(),
                type: 'in',
                productId: i.id,
                productName: p.name,
                qty: i.qty,
                price: i.price,
                total: i.total || Math.round(i.qty * i.price),
                note: `Trả hàng - HĐ ${currentReturnInvoice.id} - Phiếu ${returnRecord.id}`,
                user: currUser?.name || '',
                source: 'return'
            });
        }
    });

    // If exchange, update stock for new items (subtract) + Add stock history
    if (isExchange) {
        exchangeItems.forEach(item => {
            const p = db.products.find(x => sameStoredId(x.id, item.id));
            if (p) {
                p.stock -= item.qty;
                // Add stock history entry for exchanged item
                db.stockHistory.unshift({
                    id: Date.now() + Math.random(),
                    date: getAppDate().toISOString(),
                    type: 'out',
                    productId: item.id,
                    productName: p.name,
                    qty: item.qty,
                    price: item.price,
                    total: item.total || Math.round(item.qty * item.price),
                    note: `Đổi hàng - HĐ ${currentReturnInvoice.id} - Phiếu ${returnRecord.id}`,
                    user: currUser?.name || '',
                    source: 'exchange'
                });
            }
        });
    }

    // Save return record
    if (!db.returns) db.returns = [];
    db.returns.unshift(returnRecord);

    // Keep linked customer totals/points in sync with the invoice return/exchange.
    applyLinkedReturnCustomerEffects(returnRecord, 1);

    if (isExchange) {
        logActivity('Đổi hàng', `#${returnRecord.id.slice(-6)} từ HĐ #${sourceInvoiceDisplayId} - Chênh lệch: ${money(difference)}`);
    } else {
        logActivity('Trả hàng', `Đơn #${returnRecord.id.slice(-6)} từ HĐ #${sourceInvoiceDisplayId} - ${money(refundAmount)}`);
    }

    // Check if all items from the invoice have been fully returned
    const allReturnsForInvoice = db.returns.filter(r => sameStoredId(r.invoiceId, currentReturnInvoice.id));
    const totalReturnedQty = {};
    allReturnsForInvoice.forEach(r => {
        (r.returnItems || r.items || []).forEach(i => {
            totalReturnedQty[i.id] = (totalReturnedQty[i.id] || 0) + i.qty;
        });
    });

    // Check if every item in the original invoice has been fully returned
    const isFullyReturned = currentReturnInvoice.items.every(item => {
        const returned = totalReturnedQty[item.id] || 0;
        return returned >= item.qty;
    });

    // If fully returned, remove invoice from history
    if (isFullyReturned) {
        const invoiceId = currentReturnInvoice.id;
        const deletedInvoice = db.invoices.find(inv => sameStoredId(inv.id, invoiceId));
        if (deletedInvoice) returnRecord.deletedInvoice = JSON.parse(JSON.stringify(deletedInvoice));
        db.invoices = db.invoices.filter(inv => !sameStoredId(inv.id, invoiceId));
        logActivity('Xóa HĐ tự động', `HĐ #${sourceInvoiceDisplayId} đã được trả hàng hoàn toàn`);
    }

    // Push undo BEFORE save - include deleted invoice for restoration
    pushUndo(UNDO_ACTIONS.RETURN_GOODS, returnRecord);

    if (!saveReturnAndPreview(returnRecord.id, returnCommit)) return;

    // Reset exchange items
    exchangeItems = [];

    const successMsg = isExchange
        ? `Đổi hàng thành công! ${difference > 0 ? 'Hoàn khách: ' + money(difference) : difference < 0 ? 'Khách trả thêm: ' + money(Math.abs(difference)) : 'Ngang giá'}`
        : "Đã xử lý trả hàng thành công!" + (isFullyReturned ? " Hóa đơn đã được xóa khỏi lịch sử." : "");

    toast(successMsg, 'success');
    closeModal('return-modal');
    renderPos(); // Refresh POS after stock update
    renderHist(); // Refresh history to reflect changes
    renderManagement(); // Refresh management reports
    renderDashboard(); // Refresh dashboard/reports
    renderStaffView(); // Refresh staff revenue/orders
    renderReturnsHistory(); // Refresh returns history
    renderStockHistory(); // Refresh stock history
    currentReturnInvoice = null;
}

// HISTORY & REPORTS
function renderHist() {
    const staffSearch = ($('hist-staff-search')?.value || '').toLowerCase().trim();

    // Read date range from hidden inputs (set by YouTube-style date filter)
    const fromInput = $('hist-date-from');
    const toInput = $('hist-date-to');

    let s, e;

    // If date inputs have values, use them; otherwise default to today
    // Parse dates in LOCAL timezone (not UTC) - input values are 'YYYY-MM-DD'
    if (fromInput && fromInput.value) {
        const [y, m, d] = fromInput.value.split('-').map(Number);
        s = new Date(y, m - 1, d, 0, 0, 0, 0); // Start of day local
    } else {
        // Default: today
        s = getAppDate();
        s.setHours(0, 0, 0, 0);
    }

    if (toInput && toInput.value) {
        const [y, m, d] = toInput.value.split('-').map(Number);
        e = new Date(y, m - 1, d, 23, 59, 59, 999); // End of day local
    } else {
        // Default: today
        e = getAppDate();
        e.setHours(23, 59, 59, 999);
    }

    let list = db.invoices.filter(i => {
        const d = new Date(i.date);
        return d >= s && d <= e;
    });

    // Apply staff search filter (by name or code)
    if (staffSearch) {
        list = list.filter(i => {
            const staffStr = (i.staff || '').toLowerCase();
            return staffStr.includes(staffSearch);
        });
    }

    const totalRev = list.reduce((a, b) => a + b.total, 0);
    const avgOrder = list.length > 0 ? Math.round(totalRev / list.length) : 0;

    if ($('hist-total-rev')) $('hist-total-rev').innerText = money(totalRev);
    if ($('hist-total-orders')) $('hist-total-orders').innerText = list.length.toLocaleString('vi-VN');
    if ($('hist-avg-order')) $('hist-avg-order').innerText = money(avgOrder);

    const tbody = $('hist-body');
    if (!tbody) return;

    // Clear selections when re-rendering
    selectedInvoices.clear();
    updateBulkDeleteUI('invoices');

    // Performance: limit rendered records
    const MAX_HIST_RECORDS = 200;
    const totalRecords = list.length;
    const sortedList = list.sort((a, b) => new Date(b.date) - new Date(a.date));
    const visibleList = sortedList.slice(0, MAX_HIST_RECORDS);
    const hasMoreRecords = totalRecords > MAX_HIST_RECORDS;

    tbody.innerHTML = visibleList.map(i => {
        const saleTypeBadge = i.saleType === 'wholesale' ?
            '<span class="badge" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;font-size:10px;margin-left:4px;">📦 Sỉ</span>' : '';
        const invoiceIdAttr = escapeAttr(String(i.id ?? ''));
        const invoiceIdJs = escapeJsArgument(i.id);

        return `<tr class="hist-row" data-invoice-id="${invoiceIdAttr}" onclick="toggleHistRow(this, event)" style="cursor:pointer;">
        <td style="width:40px;text-align:center;" onclick="event.stopPropagation()"><input type="checkbox" data-id="${invoiceIdAttr}" onchange="toggleInvoiceSelect(${invoiceIdJs})" style="width:18px;height:18px;cursor:pointer;"></td>
        <td><code>#${escapeHtml(String(i.id ?? '').slice(-6))}</code>${saleTypeBadge} <span style="font-size:10px;color:var(--text-muted)">▼</span></td>
        <td>${new Date(i.date).toLocaleString('vi-VN')}</td>
        <td>${escapeHtml(i.cust)}</td>
        <td><span style="color:var(--primary);font-weight:500">${escapeHtml(i.staff || '-')}</span></td>
        <td>${i.items.length} SP</td>
        <td class="money-cell" style="font-weight:700;color:var(--primary)">${money(i.total)}</td>
        <td>${i.discount ? money(i.discount) : '-'}</td>
        <td><span class="badge badge-${i.method === 'CASH' ? 'success' : 'primary'}">${escapeHtml(i.method || '-')}</span></td>
        <td onclick="event.stopPropagation()">
            <button class="btn-sm btn-secondary" onclick="viewInvoice(${invoiceIdJs})">Chi tiết</button>
            <button class="btn-sm" onclick="printInv(db.invoices.find(x => sameStoredId(x.id, ${invoiceIdJs})))">In</button>
            <button class="btn-sm btn-danger" onclick="deleteInvoice(${invoiceIdJs})" title="Xóa hóa đơn">🗑️</button>
        </td>
    </tr>
    ${i.items.map((item, idx) => {
            const itemLineTotal = item.lineTotal !== undefined ? item.lineTotal : Math.round(item.qty * item.price);
            return `
    <tr class="hist-detail-row" data-invoice-id="${invoiceIdAttr}" style="display:none;background:var(--bg-secondary);cursor:pointer;" onclick="toggleHistRowById(${invoiceIdJs})">
        <td style="width:40px;text-align:center;"></td>
        <td colspan="4" style="padding-left:30px;"><span style="color:var(--text-muted);margin-right:8px;">└</span> ${escapeHtml(item.name)} <span style="color:var(--text-muted);font-size:12px;">(${money(item.price)}/${escapeHtml(item.unit || 'SP')})</span></td>
        <td style="text-align:left;">${formatQty(item.qty)} ${escapeHtml(item.unit || 'SP')}</td>
        <td class="money-cell" style="font-weight:500;color:var(--primary);">${money(itemLineTotal)}</td>
        <td></td>
        <td></td>
        <td></td>
    </tr>`;
        }).join('')}`;
    }).join('') || '<tr><td colspan="10" class="text-center" style="padding:30px;color:var(--text-muted)">Không có đơn hàng</td></tr>';

    // Add indicator if there are more records
    if (hasMoreRecords) {
        tbody.innerHTML += `<tr><td colspan="10" class="text-center" style="padding:15px;color:var(--text-muted);font-size:13px;">📋 Hiển thị ${MAX_HIST_RECORDS}/${totalRecords} đơn hàng. Dùng bộ lọc ngày để xem thêm.</td></tr>`;
    }
}

function getFilteredReturnsHistory() {
    const staffSearch = ($('returns-staff-search')?.value || '').toLowerCase().trim();
    const fromInput = $('returns-date-from');
    const toInput = $('returns-date-to');
    const s = fromInput?.value ? parseLocalDateInput(fromInput.value) : (() => {
        const date = getAppDate();
        date.setHours(0, 0, 0, 0);
        return date;
    })();
    const e = toInput?.value ? parseLocalDateInput(toInput.value, true) : (() => {
        const date = getAppDate();
        date.setHours(23, 59, 59, 999);
        return date;
    })();
    const list = (db.returns || []).filter(record => {
        const date = new Date(record.date);
        return date >= s && date <= e && (!staffSearch || String(record.staff || '').toLowerCase().includes(staffSearch));
    });
    return { list, s, e };
}

// RETURNS HISTORY - Display list of return/exchange transactions
function renderReturnsHistory() {
    const tbody = $('returns-body');
    if (!tbody) return;
    const { list } = getFilteredReturnsHistory();

    const totalReturns = list.length;
    const totalRefund = list.reduce((sum, r) => {
        const { difference } = getReturnDisplayTotals(r);
        return sum + (difference > 0 ? difference : 0);
    }, 0);
    const totalCollected = list.reduce((sum, r) => {
        const { difference } = getReturnDisplayTotals(r);
        return sum + (difference < 0 ? Math.abs(difference) : 0);
    }, 0);

    // Update stats display
    if ($('returns-total-count')) $('returns-total-count').innerText = totalReturns;
    if ($('returns-total-refund')) $('returns-total-refund').innerText = money(totalRefund);
    if ($('returns-total-collected')) $('returns-total-collected').innerText = money(totalCollected);

    selectedReturns.clear();
    updateBulkDeleteUI('returns');

    const sortedList = list.sort((a, b) => new Date(b.date) - new Date(a.date));
    const visibleList = sortedList.slice(0, 200);
    const rows = visibleList.map(r => {
        const { difference } = getReturnDisplayTotals(r);
        const diffClass = difference > 0 ? 'color:#22c55e' : difference < 0 ? 'color:#ef4444' : '';
        const diffText = difference > 0 ? `+${money(difference)}` : difference < 0 ? `-${money(Math.abs(difference))}` : 'Ngang giá';
        const returnCount = r.returnItems?.length || 0;
        const exchangeCount = r.exchangeItems?.length || 0;
        const customerName = r.customer?.name || r.cust || 'Khách lẻ';
        const returnIdAttr = escapeAttr(String(r.id ?? ''));
        const returnIdJs = escapeJsArgument(r.id);

        return `<tr class="returns-row" data-return-id="${returnIdAttr}" onclick="toggleReturnsRow(this)" style="cursor:pointer">
            <td style="width:40px;text-align:center" onclick="event.stopPropagation()"><input type="checkbox" data-id="${returnIdAttr}" onchange="toggleReturnSelect(${returnIdJs})" style="width:18px;height:18px;cursor:pointer;"></td>
            <td><code>#${escapeHtml(String(r.id ?? '').slice(-6))}</code> <span class="returns-row-toggle" style="font-size:10px;color:var(--text-muted)">▼</span></td>
            <td>${new Date(r.date).toLocaleString('vi-VN')}</td>
            <td>${escapeHtml(customerName)}</td>
            <td><span style="color:#22c55e">${returnCount} SP trả</span></td>
            <td><span style="color:#3b82f6">${exchangeCount} SP đổi</span></td>
            <td class="money-cell" style="font-weight:700;${diffClass}">${diffText}</td>
            <td>${escapeHtml(r.staff || '-')}</td>
            <td onclick="event.stopPropagation()">
                <button class="btn-sm btn-secondary" onclick="viewReturnDetail(${returnIdJs})">Chi tiết</button>
                <button class="btn-sm" onclick="printReturnSlip(${returnIdJs})">In</button>
                <button class="btn-sm btn-danger" onclick="deleteReturn(${returnIdJs})" title="Xóa phiếu đổi/trả">🗑️</button>
            </td>
        </tr>
        ${(r.returnItems || []).map(item => `
        <tr class="returns-detail-row" data-return-id="${returnIdAttr}" style="display:none;background:rgba(34,197,94,0.05)">
            <td></td><td colspan="2" style="padding-left:30px"><span style="color:#22c55e">📥</span> ${escapeHtml(item.name)}</td>
            <td>${formatQty(item.qty)} ${escapeHtml(item.unit || 'SP')}</td>
            <td colspan="2">${money(item.price)}</td>
            <td class="money-cell" style="color:#22c55e">+${money(getReturnItemTotal(item))}</td>
            <td colspan="2"></td>
        </tr>`).join('')}
        ${(r.exchangeItems || []).map(item => `
        <tr class="returns-detail-row" data-return-id="${returnIdAttr}" style="display:none;background:rgba(59,130,246,0.05)">
            <td></td><td colspan="2" style="padding-left:30px"><span style="color:#3b82f6">📤</span> ${escapeHtml(item.name)}</td>
            <td>${formatQty(item.qty)} ${escapeHtml(item.unit || 'SP')}</td>
            <td colspan="2">${money(item.price)}</td>
            <td class="money-cell" style="color:#3b82f6">-${money(getReturnItemTotal(item))}</td>
            <td colspan="2"></td>
        </tr>`).join('')}`;
    }).join('') || '<tr><td colspan="9" class="text-center" style="padding:30px;color:var(--text-muted)">Chưa có phiếu đổi/trả nào trong khoảng thời gian này</td></tr>';
    tbody.innerHTML = rows;
    if (list.length > visibleList.length) tbody.innerHTML += `<tr><td colspan="9" class="text-center" style="padding:15px;color:var(--text-muted);font-size:13px;">📋 Hiển thị ${visibleList.length}/${list.length} phiếu. Dùng bộ lọc ngày để xem thêm.</td></tr>`;
}

// Toggle returns row expansion
function toggleReturnsRow(row) {
    const returnId = row.getAttribute('data-return-id');
    if (!returnId) return;

    const detailRows = document.querySelectorAll(`.returns-detail-row[data-return-id="${CSS.escape(returnId)}"]`);
    if (detailRows.length === 0) return;

    const isExpanded = detailRows[0].style.display !== 'none';

    if (isExpanded) {
        detailRows.forEach(r => r.style.display = 'none');
        row.querySelector('.returns-row-toggle').textContent = '▼';
    } else {
        // Collapse others first
        document.querySelectorAll('.returns-detail-row').forEach(r => r.style.display = 'none');
        document.querySelectorAll('.returns-row-toggle').forEach(s => s.textContent = '▼');
        // Expand this one
        detailRows.forEach(r => r.style.display = 'table-row');
        row.querySelector('.returns-row-toggle').textContent = '▲';
    }
}

// View return detail modal
function viewReturnDetail(returnId) {
    const r = db.returns?.find(x => sameStoredId(x.id, returnId));
    if (!r) return toast('Không tìm thấy phiếu trả', 'error');
    const { returnTotal, exchangeTotal, difference } = getReturnDisplayTotals(r);

    const content = `
        <div style="padding:20px">
            <h3 style="margin-bottom:16px">📋 Chi tiết phiếu đổi/trả #${String(returnId ?? '').slice(-6)}</h3>
            <p><strong>Ngày:</strong> ${new Date(r.date).toLocaleString('vi-VN')}</p>
            <p><strong>Khách hàng:</strong> ${escapeHtml(r.customer?.name || r.cust || 'Khách lẻ')}</p>
            <p><strong>Nhân viên:</strong> ${escapeHtml(r.staff || '-')}</p>
            
            <h4 style="margin:16px 0 8px;color:#22c55e">📥 Hàng trả lại (${r.returnItems?.length || 0} SP)</h4>
            <table class="data-table" style="font-size:13px">
                <tr><th>Sản phẩm</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr>
                ${(r.returnItems || []).map(i => `<tr><td>${escapeHtml(i.name)}</td><td>${formatQty(i.qty)}</td><td>${money(i.price)}</td><td>${money(getReturnItemTotal(i))}</td></tr>`).join('')}
                <tr style="font-weight:700"><td colspan="3">Tổng trả:</td><td style="color:#22c55e">${money(returnTotal)}</td></tr>
            </table>

            ${r.exchangeItems?.length > 0 ? `
            <h4 style="margin:16px 0 8px;color:#3b82f6">📤 Hàng đổi/mua thêm (${r.exchangeItems.length} SP)</h4>
            <table class="data-table" style="font-size:13px">
                <tr><th>Sản phẩm</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr>
                ${r.exchangeItems.map(i => `<tr><td>${escapeHtml(i.name)}</td><td>${formatQty(i.qty)}</td><td>${money(i.price)}</td><td>${money(getReturnItemTotal(i))}</td></tr>`).join('')}
                <tr style="font-weight:700"><td colspan="3">Tổng đổi:</td><td style="color:#3b82f6">${money(exchangeTotal)}</td></tr>
            </table>` : ''}

            <div style="margin-top:20px;padding:16px;background:var(--bg-secondary);border-radius:8px;text-align:center">
                <div style="font-size:18px;font-weight:700;${difference > 0 ? 'color:#22c55e' : difference < 0 ? 'color:#ef4444' : ''}">
                    ${difference > 0 ? `Trả lại khách: ${money(difference)}` : difference < 0 ? `Khách trả thêm: ${money(Math.abs(difference))}` : 'Ngang giá'}
                </div>
            </div>
        </div>
    `;

    openModal('generic-modal');
    $('generic-modal-title').textContent = 'Chi tiết phiếu đổi/trả';
    $('generic-modal-content').innerHTML = content;
}

function buildReturnSlipHtml(r) {
    const returnItems = Array.isArray(r.returnItems) ? r.returnItems : (Array.isArray(r.items) ? r.items : []);
    const exchangeItems = Array.isArray(r.exchangeItems) ? r.exchangeItems : [];
    const linkedCustomer = r.customer || db.custs?.find(customer => sameStoredId(customer.id, r.customerId ?? r.custId));
    const { returnTotal, exchangeTotal, difference } = getReturnDisplayTotals(r);
    const receiptMoney = value => Math.round(Number(value) || 0).toLocaleString('vi-VN');
    const receiptDate = new Date(r.date);
    const printedDate = Number.isNaN(receiptDate.getTime())
        ? ''
        : String(receiptDate.getDate()).padStart(2, '0') + '/' +
            String(receiptDate.getMonth() + 1).padStart(2, '0') + '/' +
            receiptDate.getFullYear() + ' ' +
            String(receiptDate.getHours()).padStart(2, '0') + ':' +
            String(receiptDate.getMinutes()).padStart(2, '0');
    const safeStoreName = escapeHtml(db.settings.name || 'Cửa hàng');
    const safeStoreAddress = escapeHtml(db.settings.addr || '');
    const safeStorePhone = escapeHtml(db.settings.phone || '');
    const safeCustomer = escapeHtml(linkedCustomer?.name || r.cust || 'Khách lẻ');
    const safeCustomerAddress = escapeHtml(linkedCustomer?.addr || '');
    const safeStaff = escapeHtml(r.staff || '-');
    const itemHeader = '<div style="display:table;width:100%;font-weight:700;padding:4px 0;border-bottom:1px dashed #000">' +
        '<div style="display:table-cell;width:50%">Đơn giá</div>' +
        '<div style="display:table-cell;width:20%;text-align:center">SL</div>' +
        '<div style="display:table-cell;width:30%;text-align:right">Thành tiền</div>' +
        '</div>';
    const itemRows = items => items.map(item => '<div style="padding:5px 0;page-break-inside:avoid">' +
        '<div style="font-weight:700;margin-bottom:2px">' + escapeHtml(item?.name || 'Sản phẩm') + '</div>' +
        '<div style="display:table;width:100%">' +
        '<div style="display:table-cell;width:50%">' + receiptMoney(item?.price) + '</div>' +
        '<div style="display:table-cell;width:20%;text-align:center">' + escapeHtml(String(formatQty(item?.qty))) + '</div>' +
        '<div style="display:table-cell;width:30%;text-align:right">' + receiptMoney(getReturnItemTotal(item)) + '</div>' +
        '</div></div>').join('');
    const line = '<div style="border-bottom:1px dashed #000;margin:7px 0"></div>';
    const returnSection = returnItems.length ? itemHeader + itemRows(returnItems) : '';
    const exchangeSection = exchangeItems.length
        ? line + '<div style="text-align:center;font-weight:700;font-size:14px;margin:6px 0">Mua mới</div>' + itemHeader + itemRows(exchangeItems)
        : '';
    const settlement = difference > 0
        ? 'Tiền trả khách: ' + receiptMoney(difference)
        : difference < 0
            ? 'Khách trả thêm: ' + receiptMoney(Math.abs(difference))
            : 'Ngang giá: 0';

    return '<div style="width:72mm;box-sizing:border-box;padding:3mm;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.35;color:#000;background:#fff">' +
        '<div style="text-align:center;font-weight:700;font-size:15px">' + safeStoreName + '</div>' +
        (safeStoreAddress ? '<div style="text-align:center;font-size:11px">Địa chỉ: ' + safeStoreAddress + '</div>' : '') +
        (safeStorePhone ? '<div style="text-align:center;font-size:11px">Điện thoại: ' + safeStorePhone + '</div>' : '') +
        line +
        '<div style="font-size:11px">Ngày bán: ' + printedDate + '</div>' +
        '<div style="text-align:center;font-weight:700;font-size:14px;margin:8px 0">HÓA ĐƠN TRẢ HÀNG</div>' +
        '<div style="font-size:11px;line-height:1.55">' +
        '<div><b>Khách hàng:</b> ' + safeCustomer + '</div>' +
        '<div><b>Địa chỉ:</b> ' + safeCustomerAddress + '</div>' +
        '<div><b>Khu vực:</b></div>' +
        '<div><b>Người bán:</b> ' + safeStaff + '</div></div>' +
        line + returnSection + exchangeSection + line +
        '<div style="font-size:12px;line-height:1.65;text-align:right">' +
        '<div>Tổng tiền hóa đơn trả: <b>' + receiptMoney(returnTotal) + '</b></div>' +
        '<div>Tổng tiền hóa đơn mua: <b>' + receiptMoney(exchangeTotal) + '</b></div>' +
        '<div style="font-size:14px">Tổng cộng: <b>' + receiptMoney(Math.abs(difference)) + '</b></div>' +
        '<div style="font-size:14px">' + settlement + '</div></div>' +
        '<div style="height:8mm"></div></div>';
}

// Print return slip
function printReturnSlip(returnId) {
    const r = db.returns?.find(x => sameStoredId(x.id, returnId));
    if (!r) return toast('Không tìm thấy phiếu trả', 'error');
    const returnDisplayId = escapeHtml(String(r.id ?? '').slice(-6));
    const safeStoreName = escapeHtml(db.settings.name || 'Cửa hàng');
    const safeCustomer = escapeHtml(r.customer?.name || r.cust || 'Khách lẻ');
    const safeFooter = escapeHtml(db.settings.footer || 'Cảm ơn quý khách!');

    const html = `
        <div style="width:80mm;font-family:Arial;font-size:12px;padding:10px">
            <div style="text-align:center;font-weight:700;font-size:14px;margin-bottom:10px">PHIẾU ĐỔI/TRẢ HÀNG</div>
            <div style="text-align:center;margin-bottom:10px">${safeStoreName}</div>
            <div style="border-top:1px dashed #000;padding:8px 0">
                <div>Mã: #${returnDisplayId}</div>
                <div>Ngày: ${new Date(r.date).toLocaleString('vi-VN')}</div>
                <div>KH: ${safeCustomer}</div>
            </div>
            ${r.returnItems?.length > 0 ? `
            <div style="border-top:1px dashed #000;padding:8px 0">
                <div style="font-weight:700">HÀNG TRẢ LẠI:</div>
                ${r.returnItems.map(i => `<div>${escapeHtml(i.name || 'Sản phẩm')} x${formatQty(i.qty)} = ${money(getReturnItemTotal(i))}</div>`).join('')}
                <div style="font-weight:700">Tổng: ${money(r.returnTotal)}</div>
            </div>` : ''}
            ${r.exchangeItems?.length > 0 ? `
            <div style="border-top:1px dashed #000;padding:8px 0">
                <div style="font-weight:700">HÀNG ĐỔI:</div>
                ${r.exchangeItems.map(i => `<div>${escapeHtml(i.name || 'Sản phẩm')} x${formatQty(i.qty)} = ${money(getReturnItemTotal(i))}</div>`).join('')}
                <div style="font-weight:700">Tổng: ${money(r.exchangeTotal)}</div>
            </div>` : ''}
            <div style="border-top:1px dashed #000;padding:8px 0;text-align:center;font-weight:700;font-size:14px">
                ${r.difference > 0 ? `Trả khách: ${money(r.difference)}` : r.difference < 0 ? `Thu thêm: ${money(Math.abs(r.difference))}` : 'Ngang giá'}
            </div>
            <div style="text-align:center;margin-top:10px;font-size:11px">${safeFooter}</div>
        </div>
    `;
    const receiptHtml = buildReturnSlipHtml(r);

    // Use iframe approach for Electron compatibility instead of window.open()
    let printIframe = document.getElementById('return-slip-print-iframe');
    if (!printIframe) {
        printIframe = document.createElement('iframe');
        printIframe.id = 'return-slip-print-iframe';
        printIframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;border:none;background:#fff;';
        document.body.appendChild(printIframe);
    } else {
        printIframe.style.display = 'block';
    }

    const printContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Phiếu trả #${returnDisplayId}</title>
    <style>
        @page { size: 72mm auto; margin: 0; }
        body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
        .preview-controls {
            position: fixed; top: 0; left: 0; right: 0;
            background: linear-gradient(135deg, #6366F1, #8B5CF6);
            color: white; padding: 12px 20px;
            display: flex; justify-content: space-between; align-items: center;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2); z-index: 1000; font-size: 14px;
        }
        .preview-controls button {
            padding: 8px 16px; border: none; border-radius: 6px;
            cursor: pointer; font-weight: 600; margin-left: 8px;
        }
        .btn-print { background: #10B981; color: white; }
        .btn-close { background: #EF4444; color: white; }
        .content-wrapper { margin-top: 70px; display: flex; justify-content: center; }
        @media print {
            .preview-controls { display: none !important; }
            .content-wrapper { margin-top: 0; display: block; width: 72mm; max-width: 72mm; box-sizing: border-box; background: transparent !important; border-radius: 0; box-shadow: none; padding: 0; }
            .content-wrapper > div { width: 72mm !important; max-width: 72mm !important; box-sizing: border-box !important; }
        }
        @media screen {
            html, body { width: 100%; max-width: 100%; }
            body { padding: 80px 20px 20px; background: #f5f5f5; display: flex; justify-content: center; }
            .content-wrapper { margin-top: 0; display: block; width: 72mm; max-width: 72mm; box-sizing: border-box; background: white; border-radius: 4px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .content-wrapper > div { width: 100% !important; max-width: 100% !important; box-sizing: border-box !important; }
        }
    </style>
</head>
<body>
    <div class="preview-controls">
        <span>🧾 Hóa đơn đổi/trả #${returnDisplayId} - ${safeCustomer}</span>
        <div>
            <button class="btn-print" id="print-btn">🖨️ In</button>
            <button class="btn-close" id="close-btn">✕</button>
        </div>
    </div>
    <div class="content-wrapper">${receiptHtml}</div>
</body>
</html>`;

    const iframeDoc = printIframe.contentDocument || printIframe.contentWindow?.document;
    if (!iframeDoc) { toast('Không thể tạo tài liệu in!', 'error'); return; }
    iframeDoc.open();
    iframeDoc.write(printContent);
    iframeDoc.close();

    setTimeout(() => {
        const printBtn = iframeDoc.getElementById('print-btn');
        const closeBtn = iframeDoc.getElementById('close-btn');
        if (printBtn) printBtn.onclick = () => {
            try {
                if (typeof printIframe.contentWindow?.print !== 'function') throw new Error('Print is unavailable');
                printIframe.contentWindow.print();
            } catch (error) {
                console.error('Return slip print failed:', error);
                toast('Không thể gửi lệnh in!', 'error');
            }
        };
        if (closeBtn) closeBtn.onclick = () => printIframe.style.display = 'none';
        printIframe.contentWindow.onafterprint = () => printIframe.style.display = 'none';
    }, 100);
}

// Toggle invoice row expansion in history
function toggleHistRow(row, event) {
    const invoiceId = row.getAttribute('data-invoice-id');
    if (!invoiceId) return;

    const detailRows = document.querySelectorAll(`.hist-detail-row[data-invoice-id="${CSS.escape(invoiceId)}"]`);
    if (detailRows.length === 0) return;

    const isExpanded = detailRows[0].style.display !== 'none';

    if (isExpanded) {
        // Collapse
        detailRows.forEach(r => r.style.display = 'none');
        row.querySelector('td:nth-child(2) span').textContent = '▼';
        row.style.background = '';
    } else {
        // Expand - first collapse any other expanded rows
        document.querySelectorAll('.hist-detail-row').forEach(r => {
            r.style.display = 'none';
        });
        document.querySelectorAll('.hist-row').forEach(r => {
            const arrow = r.querySelector('td:nth-child(2) span');
            if (arrow) arrow.textContent = '▼';
            r.style.background = '';
        });

        // Expand this row's details
        detailRows.forEach(r => r.style.display = 'table-row');
        row.querySelector('td:nth-child(2) span').textContent = '▲';
        row.style.background = 'var(--bg-secondary)';
    }
}

// Toggle by invoice ID (for clicking on detail area)
function toggleHistRowById(invoiceId) {
    const row = document.querySelector(`.hist-row[data-invoice-id="${CSS.escape(invoiceId)}"]`);
    if (row) {
        toggleHistRow(row, null);
    }
}

function viewInvoice(id) {
    const inv = db.invoices.find(x => sameStoredId(x.id, id));
    if (!inv) return;
    currentInvoice = inv;
    const invoiceDisplayId = escapeHtml(String(inv.id || '').slice(-6));

    const body = $('invoice-detail-body');
    body.innerHTML = `
        <div style="text-align:center;margin-bottom:20px;">
            <div style="font-size:12px;color:var(--text-muted)">Mã hóa đơn</div>
            <div style="font-size:24px;font-weight:800">#${invoiceDisplayId}</div>
        </div>
        <div class="d-flex justify-between mb-2">
            <span>Thời gian:</span><strong>${new Date(inv.date).toLocaleString('vi-VN')}</strong>
        </div>
        <div class="d-flex justify-between mb-2">
            <span>Khách hàng:</span><strong>${escapeHtml(inv.cust)}</strong>
        </div>
        <div class="d-flex justify-between mb-2">
            <span>Thu ngân:</span><strong>${escapeHtml(inv.staff || '-')}</strong>
        </div>
        <hr style="border:none;border-top:1px dashed var(--border-light);margin:16px 0">
        <div style="font-weight:600;margin-bottom:10px">Sản phẩm:</div>
        ${inv.items.map(i => {
        const itemLineTotal = i.lineTotal !== undefined ? i.lineTotal : Math.round(i.price * i.qty);
        return `<div class="d-flex justify-between" style="margin-bottom:8px">
            <span>${escapeHtml(i.name)} x${formatQty(i.qty)}</span><strong>${money(itemLineTotal)}</strong>
        </div>`;
    }).join('')}
        <hr style="border:none;border-top:1px dashed var(--border-light);margin:16px 0">
        <div class="d-flex justify-between mb-1"><span>Tạm tính:</span><span>${money(inv.subtotal)}</span></div>
        <div class="d-flex justify-between mb-1"><span>Giảm giá:</span><span>${inv.discount ? '-' + money(inv.discount) : '-'}</span></div>
        ${inv.pointsValue ? `<div class="d-flex justify-between mb-1"><span>Điểm:</span><span>-${money(inv.pointsValue)}</span></div>` : ''}
        <div class="d-flex justify-between" style="font-size:18px;font-weight:700;margin-top:10px">
            <span>Tổng:</span><span style="color:var(--primary)">${money(inv.total)}</span>
        </div>
        ${inv.note ? `<div style="margin-top:16px;padding:10px;background:var(--bg-muted);border-radius:8px"><strong>Ghi chú:</strong> ${escapeHtml(inv.note)}</div>` : ''}
    `;
    $('invoice-modal').classList.add('active');
}

function printCurrentInvoice() {
    if (currentInvoice) printInv(currentInvoice);
}

function renderDashboard() {
    const period = $('report-period')?.value || 'month';
    const staffSearch = ($('report-staff-search')?.value || '').toLowerCase().trim();
    const now = getAppDate();
    let s = new Date(now), e = new Date(now);

    if (period === 'today') {
        s.setHours(0, 0, 0, 0);
    } else if (period === 'week') {
        const d = now.getDay() || 7;
        s.setDate(now.getDate() - d + 1);
        s.setHours(0, 0, 0, 0);
    } else if (period === 'month') {
        s.setDate(1);
        s.setHours(0, 0, 0, 0);
    } else if (period === 'year') {
        s = new Date(now.getFullYear(), 0, 1);
    } else if (period.startsWith('year-')) {
        const yr = parseInt(period.replace('year-', ''));
        s = new Date(yr, 0, 1);
        e = new Date(yr, 11, 31, 23, 59, 59, 999);
    }
    if (!period.startsWith('year-')) e.setHours(23, 59, 59, 999);

    let invs = db.invoices.filter(i => {
        const d = new Date(i.date);
        return d >= s && d <= e;
    });

    // Apply staff search filter (by name or code)
    if (staffSearch) {
        invs = invs.filter(i => {
            const staffStr = (i.staff || '').toLowerCase();
            return staffStr.includes(staffSearch);
        });
    }

    const revenue = invs.reduce((a, b) => a + b.total, 0);
    const cost = invs.reduce((a, inv) => a + getInvoiceCost(inv), 0);
    const profit = revenue - cost;

    if ($('dash-revenue')) $('dash-revenue').innerText = money(revenue);
    if ($('dash-profit')) $('dash-profit').innerText = money(profit);
    if ($('dash-orders')) $('dash-orders').innerText = invs.length.toLocaleString('vi-VN');
    if ($('dash-customers')) $('dash-customers').innerText = db.custs.length.toLocaleString('vi-VN');

    // Top products
    const prodCounts = {};
    invs.forEach(inv => (inv.items || []).forEach(i => {
        prodCounts[i.name] = (prodCounts[i.name] || 0) + i.qty;
    }));
    const top = Object.entries(prodCounts).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 5);

    if ($('top-products')) {
        $('top-products').innerHTML = top.map((p, i) => `
            <div class="top-item">
                <div class="d-flex items-center">
                    <div class="top-rank">${i + 1}</div>
                    <div class="top-name">${escapeHtml(p.name)}</div>
                </div>
                <div class="top-qty">${p.qty} đã bán</div>
            </div>
        `).join('') || '<div style="text-align:center;color:var(--text-muted);padding:20px">Chưa có dữ liệu</div>';
    }

    // Staff Revenue
    const staffRevenue = {};
    const staffOrders = {};
    // Use all invoices in period (not filtered by staff) for staff comparison
    const allInvsInPeriod = db.invoices.filter(i => {
        const d = new Date(i.date);
        return d >= s && d <= e;
    });
    allInvsInPeriod.forEach(inv => {
        const staff = inv.staff || 'Không xác định';
        staffRevenue[staff] = (staffRevenue[staff] || 0) + inv.total;
        staffOrders[staff] = (staffOrders[staff] || 0) + 1;
    });
    const topStaff = Object.entries(staffRevenue)
        .map(([name, total]) => ({ name, total, orders: staffOrders[name] || 0 }))
        .sort((a, b) => b.total - a.total);

    if ($('staff-revenue')) {
        $('staff-revenue').innerHTML = topStaff.map((st, i) => `
            <div class="top-item" style="${staffSearch && st.name.toLowerCase().includes(staffSearch) ? 'background:var(--primary-light);' : ''}">
                <div class="d-flex items-center">
                    <div class="top-rank" style="background:${i === 0 ? 'var(--success)' : i === 1 ? 'var(--warning)' : 'var(--secondary)'};">${i + 1}</div>
                    <div>
                        <div class="top-name">${escapeHtml(st.name)}</div>
                        <div style="font-size:11px;color:var(--text-muted)">${st.orders} đơn hàng</div>
                    </div>
                </div>
                <div class="top-qty" style="color:var(--success);font-weight:700">${money(st.total)}</div>
            </div>
        `).join('') || '<div style="text-align:center;color:var(--text-muted);padding:20px">Chưa có dữ liệu</div>';
    }

    // Top customers
    const custTotals = {};
    invs.forEach(inv => {
        if (inv.cust && inv.cust !== 'Khách lẻ') {
            custTotals[inv.cust] = (custTotals[inv.cust] || 0) + inv.total;
        }
    });
    const topCusts = Object.entries(custTotals).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 5);

    if ($('top-customers')) {
        $('top-customers').innerHTML = topCusts.map((c, i) => `
            <div class="top-item">
                <div class="d-flex items-center">
                    <div class="top-rank">${i + 1}</div>
                    <div class="top-name">${escapeHtml(c.name)}</div>
                </div>
                <div class="top-qty">${money(c.total)}</div>
            </div>
        `).join('') || '<div style="text-align:center;color:var(--text-muted);padding:20px">Chưa có dữ liệu</div>';
    }

    // Recent orders
    if ($('recent-orders-body')) {
        $('recent-orders-body').innerHTML = db.invoices.slice(0, 8).map(i => `
            <tr>
                <td><code>#${escapeHtml(String(i.id ?? '').slice(-6))}</code></td>
                <td>${new Date(i.date).toLocaleString('vi-VN')}</td>
                <td>${escapeHtml(i.cust)}</td>
                <td style="color:var(--primary);font-weight:500">${escapeHtml(i.staff || '-')}</td>
                <td style="font-weight:600">${money(i.total)}</td>
            </tr>
        `).join('');
    }

    drawRevenueChart();
    drawPieChart();
}

function drawRevenueChart() {
    const canvas = $('rev-chart');
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    const chartType = $('chart-type')?.value || 'line';
    const period = $('report-period')?.value || 'month';

    const data = [], labels = [];
    let numPoints;

    // Pre-process invoices once into lookup maps to avoid repeated filtering
    const invoiceDateCache = db.invoices.map(inv => ({ date: new Date(inv.date), total: inv.total }));

    if (period === 'today') {
        numPoints = 12;
        // Group invoices by hour
        const hourMap = {};
        invoiceDateCache.forEach(inv => {
            const key = toLocalDateStr(inv.date) + '_' + inv.date.getHours();
            hourMap[key] = (hourMap[key] || 0) + inv.total;
        });
        for (let i = numPoints - 1; i >= 0; i--) {
            const d = getAppDate();
            d.setHours(d.getHours() - i, 0, 0, 0);
            const key = toLocalDateStr(d) + '_' + d.getHours();
            data.push(hourMap[key] || 0);
            labels.push(`${d.getHours()}h`);
        }
    } else if (period === 'week') {
        numPoints = 7;
        // Group invoices by date
        const dayMap = {};
        invoiceDateCache.forEach(inv => {
            const key = toLocalDateStr(inv.date);
            dayMap[key] = (dayMap[key] || 0) + inv.total;
        });
        for (let i = numPoints - 1; i >= 0; i--) {
            const d = getAppDate();
            d.setDate(d.getDate() - i);
            const dateStr = toLocalDateStr(d);
            data.push(dayMap[dateStr] || 0);
            labels.push(`${d.getDate()}/${d.getMonth() + 1}`);
        }
    } else if (period === 'month') {
        numPoints = 6;
        // Group invoices by date for range lookup
        const dayMap = {};
        invoiceDateCache.forEach(inv => {
            const key = toLocalDateStr(inv.date);
            dayMap[key] = (dayMap[key] || 0) + inv.total;
        });
        for (let i = numPoints - 1; i >= 0; i--) {
            const endDate = getAppDate();
            endDate.setDate(endDate.getDate() - (i * 5));
            const startDate = new Date(endDate);
            startDate.setDate(startDate.getDate() - 4);
            let rev = 0;
            for (let d = new Date(startDate); d <= endDate; ) {
                rev += dayMap[toLocalDateStr(d)] || 0;
                d.setDate(d.getDate() + 1);
            }
            data.push(rev);
            labels.push(`${startDate.getDate()}/${startDate.getMonth() + 1}`);
        }
    } else if (period === 'year' || period.startsWith('year-')) {
        numPoints = 12;
        const monthNames = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'];
        const targetYear = period.startsWith('year-') ? parseInt(period.replace('year-', '')) : getAppDate().getFullYear();
        // Group invoices by year-month
        const monthMap = {};
        invoiceDateCache.forEach(inv => {
            const key = inv.date.getFullYear() + '-' + inv.date.getMonth();
            monthMap[key] = (monthMap[key] || 0) + inv.total;
        });
        for (let m = 0; m < 12; m++) {
            const key = targetYear + '-' + m;
            data.push(monthMap[key] || 0);
            labels.push(monthNames[m]);
        }
    } else {
        // Default: 7 days
        numPoints = 7;
        const dayMap = {};
        invoiceDateCache.forEach(inv => {
            const key = toLocalDateStr(inv.date);
            dayMap[key] = (dayMap[key] || 0) + inv.total;
        });
        for (let i = numPoints - 1; i >= 0; i--) {
            const d = getAppDate();
            d.setDate(d.getDate() - i);
            const dateStr = toLocalDateStr(d);
            data.push(dayMap[dateStr] || 0);
            labels.push(`${d.getDate()}/${d.getMonth() + 1}`);
        }
    }

    const pad = 40, w = canvas.width - pad * 2, h = canvas.height - pad * 2;
    const maxVal = Math.max(...data, 100000);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Grid
    ctx.strokeStyle = '#E2E8F0';
    ctx.fillStyle = '#94A3B8';
    ctx.font = '11px system-ui';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
        const y = pad + h - (i * (h / 4));
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(pad + w, y);
        ctx.stroke();
        ctx.fillText(Math.round((i * (maxVal / 4)) / 1000) + 'k', 5, y + 4);
    }

    if (chartType === 'bar') {
        // Bar Chart
        const barWidth = (w / numPoints) * 0.7;
        const gap = (w / numPoints) * 0.3;

        const gradient = ctx.createLinearGradient(0, pad, 0, pad + h);
        gradient.addColorStop(0, '#6366F1');
        gradient.addColorStop(1, '#818CF8');

        data.forEach((val, i) => {
            const barH = (val / maxVal) * h;
            const x = pad + (i * (w / numPoints)) + gap / 2;
            const y = pad + h - barH;

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.roundRect(x, y, barWidth, barH, [4, 4, 0, 0]);
            ctx.fill();

            // Value on top
            if (val > 0) {
                ctx.fillStyle = '#64748B';
                ctx.font = '10px system-ui';
                ctx.fillText(Math.round(val / 1000) + 'k', x + barWidth / 2 - 10, y - 5);
            }

            // Labels
            ctx.fillStyle = '#64748B';
            ctx.fillText(labels[i], x + barWidth / 2 - 12, canvas.height - 10);
        });
    } else {
        // Line Chart
        ctx.beginPath();
        ctx.strokeStyle = '#6366F1';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const stepX = w / (numPoints - 1);
        data.forEach((val, i) => {
            const x = pad + (i * stepX);
            const y = pad + h - ((val / maxVal) * h);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Area fill
        ctx.lineTo(pad + w, pad + h);
        ctx.lineTo(pad, pad + h);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.1)';
        ctx.fill();

        // Points & labels
        data.forEach((val, i) => {
            const x = pad + (i * stepX);
            const y = pad + h - ((val / maxVal) * h);

            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#6366F1';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = '#64748B';
            ctx.fillText(labels[i], x - 15, canvas.height - 10);
        });
    }
}

function drawPieChart() {
    const canvas = $('pie-chart');
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');

    // Get category revenue
    const catRevenue = {};
    db.invoices.forEach(inv => {
        (inv.items || []).forEach(item => {
            const prod = db.products.find(p => sameStoredId(p.id, item.id));
            const cat = prod?.cat || 'Khác';
            catRevenue[cat] = (catRevenue[cat] || 0) + getInvoiceItemRevenue(item);
        });
    });

    const catData = Object.entries(catRevenue).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const total = catData.reduce((a, b) => a + b.value, 0);

    if (total === 0) {
        ctx.fillStyle = '#94A3B8';
        ctx.font = '14px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('Chưa có dữ liệu', canvas.width / 2, canvas.height / 2);
        return;
    }

    const colors = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#06B6D4', '#EF4444', '#84CC16'];
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2 - 20;
    const radius = Math.max(20, Math.min(centerX, centerY) - 20);

    // Prevent negative radius error
    if (radius <= 0 || isNaN(radius)) {
        ctx.fillStyle = '#94A3B8';
        ctx.font = '14px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('Canvas quá nhỏ', canvas.width / 2, canvas.height / 2);
        return;
    }

    let startAngle = -Math.PI / 2;

    catData.forEach((cat, i) => {
        const sliceAngle = (cat.value / total) * Math.PI * 2;
        const color = colors[i % colors.length];

        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        startAngle += sliceAngle;
    });

    // Draw center hole (donut effect)
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg-surface') || '#fff';
    ctx.fill();

    // Center text
    ctx.fillStyle = '#64748B';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Tổng', centerX, centerY - 5);
    ctx.fillStyle = '#1E293B';
    ctx.font = 'bold 14px system-ui';
    ctx.fillText(money(total).replace(' ₫', ''), centerX, centerY + 12);

    // Legend at bottom
    const legendY = canvas.height - 35;
    const legendStartX = 10;
    let legendX = legendStartX;

    ctx.font = '10px system-ui';
    catData.slice(0, 4).forEach((cat, i) => {
        const color = colors[i % colors.length];
        const percent = Math.round((cat.value / total) * 100);
        const text = `${cat.name} ${percent}%`;

        ctx.fillStyle = color;
        ctx.fillRect(legendX, legendY, 10, 10);

        ctx.fillStyle = '#64748B';
        ctx.textAlign = 'left';
        ctx.fillText(text, legendX + 14, legendY + 9);

        legendX += ctx.measureText(text).width + 24;
    });
}

// SETTINGS
function loadSets() {
    const s = db.settings;
    if ($('set-name')) $('set-name').value = s.name || '';
    if ($('set-addr')) $('set-addr').value = s.addr || '';
    if ($('set-phone')) $('set-phone').value = s.phone || '';
    if ($('set-footer')) $('set-footer').value = s.footer || '';
    if ($('set-bank')) $('set-bank').value = s.bank || '';
    if ($('set-num')) $('set-num').value = s.num || '';
    if ($('set-owner')) $('set-owner').value = s.owner || '';

    if (s.qr && $('set-qr-view')) {
        $('set-qr-view').src = s.qr;
        $('set-qr-view').style.display = 'block';
    }

    if ($('set-paper')) $('set-paper').value = s.paper || '80';
    if ($('set-silent')) $('set-silent').checked = s.silent || false;
    if ($('set-sound')) $('set-sound').checked = s.sound !== false;
    if ($('set-label-paper')) $('set-label-paper').value = s.labelPaper || 110;
    if ($('set-label-columns')) $('set-label-columns').value = s.labelColumns || 3;
    if ($('set-label-size')) $('set-label-size').value = s.labelSize || '35x22';
    if ($('set-label-gap')) $('set-label-gap').value = s.labelGap || 2;
    if ($('set-scanner-popup')) $('set-scanner-popup').checked = s.scannerPopup !== false;
    if ($('set-scanner-auto-add')) $('set-scanner-auto-add').checked = s.scannerAutoAdd !== false;
    if ($('set-theme')) $('set-theme').value = s.theme || 'light';
    if ($('set-disable-login')) $('set-disable-login').checked = s.disableLogin === true;
    if ($('set-backup')) $('set-backup').checked = s.autoBackup !== false;
    if ($('set-backup-interval')) {
        $('set-backup-interval').value = s.backupInterval || 'daily';
        $('backup-interval-container').style.display = s.autoBackup !== false ? 'block' : 'none';
    }
    if ($('set-backup-limit')) $('set-backup-limit').value = getBackupLimit(s.backupLimit);
    updateBackupStats();
    if ($('set-low-stock')) $('set-low-stock').value = s.lowStock || 5;
    if ($('set-ui-size')) {
        $('set-ui-size').value = s.uiSize || 'medium';
        applyUISize(s.uiSize || 'medium');
    }
    if ($('set-points-rate')) $('set-points-rate').value = s.pointsRate || 1;
    if ($('set-points-value')) $('set-points-value').value = s.pointsValue || 1000;
    if ($('set-points-enabled')) $('set-points-enabled').checked = s.pointsEnabled !== false;
    // Load all keyboard shortcuts via renderShortcutsSettings()
    if (typeof renderShortcutsSettings === 'function') renderShortcutsSettings();

    // Load printers
    if (desktop?.printers?.list) {
        desktop.printers.list().then(printers => {
            const sel = $('set-printer');
            if (!sel) return;
            sel.innerHTML = '<option value="">Mặc định hệ thống</option>';
            printers.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.name;
                opt.innerText = p.name + (p.isDefault ? ' (Mặc định)' : '');
                if (s.printer === p.name) opt.selected = true;
                sel.appendChild(opt);
            });
        }).catch(() => { });
    }

    // Load time offset settings
    if (s.timeOffset) timeOffset = s.timeOffset;
    if ($('set-time-override')) {
        $('set-time-override').checked = !!s.timeOverrideEnabled;
        const container = $('time-override-container');
        if (container) container.style.display = s.timeOverrideEnabled ? 'block' : 'none';
        if (s.timeOverrideEnabled && $('set-custom-datetime')) {
            $('set-custom-datetime').value = toLocalDateTimeStr(getAppDate());
        }
    }
    updateTimeDiffDisplay();
    startSettingsClock();

    renderUsers();
}

function handleQR(inp) {
    compress(inp, res => {
        if ($('set-qr-view')) {
            $('set-qr-view').src = res;
            $('set-qr-view').style.display = 'block';
        }
    });
}

function saveSets() {
    if (!canMutateSettings()) return;

    const previousSettings = db.settings || {};
    const nextSettings = { ...previousSettings };
    const wasLoginDisabled = previousSettings.disableLogin === true;
    nextSettings.name = $('set-name')?.value || '';
    nextSettings.addr = $('set-addr')?.value || '';
    nextSettings.phone = $('set-phone')?.value || '';
    nextSettings.footer = $('set-footer')?.value || '';
    nextSettings.bank = $('set-bank')?.value || '';
    nextSettings.num = $('set-num')?.value || '';
    nextSettings.owner = $('set-owner')?.value || '';

    const qrSrc = $('set-qr-view')?.src || '';
    nextSettings.qr = qrSrc.startsWith('data:') ? qrSrc : '';

    nextSettings.printer = $('set-printer')?.value || '';
    nextSettings.paper = $('set-paper')?.value || '80';
    nextSettings.silent = $('set-silent')?.checked || false;
    nextSettings.sound = $('set-sound')?.checked !== false;
    nextSettings.theme = $('set-theme')?.value || 'light';
    nextSettings.autoBackup = $('set-backup')?.checked !== false;
    nextSettings.backupInterval = $('set-backup-interval')?.value || 'daily';
    nextSettings.backupLimit = getBackupLimit($('set-backup-limit')?.value);
    nextSettings.lowStock = parseInt($('set-low-stock')?.value) || 5;
    nextSettings.uiSize = $('set-ui-size')?.value || 'medium';
    if (currUser?.role === 'admin' && $('set-disable-login')) {
        const wantsLoginDisabled = $('set-disable-login').checked === true;
        if (wantsLoginDisabled && !wasLoginDisabled) {
            const confirmed = confirm("Khi bật tùy chọn này, ai mở ứng dụng cũng sẽ sử dụng quyền Admin mà không cần mật khẩu. Bạn chắc chắn muốn bật?");
            if (!confirmed) {
                $('set-disable-login').checked = false;
                nextSettings.disableLogin = false;
            } else {
                nextSettings.disableLogin = true;
            }
        } else {
            nextSettings.disableLogin = wantsLoginDisabled;
        }
    }
    nextSettings.pointsRate = Math.max(0, parseInt($('set-points-rate')?.value) || 1);
    nextSettings.pointsValue = Math.max(1, parseInt($('set-points-value')?.value) || 1000);
    nextSettings.pointsEnabled = $('set-points-enabled')?.checked !== false;

    // Label printer settings
    nextSettings.labelPaper = parseInt($('set-label-paper')?.value) || 110;
    nextSettings.labelColumns = parseInt($('set-label-columns')?.value) || 3;
    nextSettings.labelSize = $('set-label-size')?.value || '35x22';
    nextSettings.labelGap = parseInt($('set-label-gap')?.value) || 2;
    nextSettings.scannerPopup = $('set-scanner-popup')?.checked !== false;
    nextSettings.scannerAutoAdd = $('set-scanner-auto-add')?.checked !== false;

    // Save time offset
    nextSettings.timeOffset = timeOffset;
    nextSettings.timeOverrideEnabled = $('set-time-override')?.checked || false;

    // Save all keyboard shortcuts from data-action inputs
    const shortcutInputs = document.querySelectorAll('#shortcuts-grid input[data-action]');
    const savedShortcuts = { ...(previousSettings.shortcuts || {}) };
    shortcutInputs.forEach(input => {
        const action = input.dataset.action;
        if (action && input.value) {
            savedShortcuts[action] = input.value;
        }
    });
    nextSettings.shortcuts = savedShortcuts;

    db.settings = nextSettings;
    if (!saveNow()) {
        db.settings = previousSettings;
        applyTheme(previousSettings.theme || 'light', false);
        applyUISize(previousSettings.uiSize || 'medium', false);
        return;
    }

    applyTheme(nextSettings.theme, false);
    applyUISize(nextSettings.uiSize, false);
    setupAutoBackup();
    pruneOldBackups(nextSettings.backupLimit);
    updateBackupStats();
    updateAuthPanel();
    toast("Đã lưu cài đặt!");
}

// ========== DATE/TIME OVERRIDE SETTINGS ==========

function toggleTimeOverride() {
    if (!canMutateSettings()) return;
    const checked = $('set-time-override')?.checked;
    const container = $('time-override-container');
    if (container) container.style.display = checked ? 'block' : 'none';
    if (!checked) {
        const previousSettings = { ...db.settings };
        const previousOffset = timeOffset;
        const activitySnapshot = (db.activityLog || []).slice();
        timeOffset = 0;
        db.settings.timeOffset = 0;
        db.settings.timeOverrideEnabled = false;
        logActivity('Cài đặt', 'Tắt tùy chỉnh ngày giờ');
        if (!saveNow()) {
            timeOffset = previousOffset;
            Object.assign(db.settings, previousSettings);
            db.activityLog = activitySnapshot;
            if ($('set-time-override')) $('set-time-override').checked = true;
            if (container) container.style.display = 'block';
            return;
        }
        toast("Đã tắt tùy chỉnh ngày giờ - sử dụng giờ hệ thống");
    } else {
        const el = $('set-custom-datetime');
        if (el) el.value = toLocalDateTimeStr(new Date());
        updateTimeDiffDisplay();
    }
}

function updateTimeOffset() {
    if (!canMutateSettings()) return;
    const customStr = $('set-custom-datetime')?.value;
    if (!customStr) return;
    const customDate = new Date(customStr);
    if (isNaN(customDate.getTime())) return toast("Ngày giờ không hợp lệ!", "error");
    const previousSettings = { ...db.settings };
    const previousOffset = timeOffset;
    const activitySnapshot = (db.activityLog || []).slice();
    timeOffset = customDate.getTime() - Date.now();
    db.settings.timeOffset = timeOffset;
    db.settings.timeOverrideEnabled = true;
    logActivity('Cài đặt', `Chỉnh ngày giờ: ${formatTimeDiff(timeOffset)}`);
    if (!saveNow()) {
        timeOffset = previousOffset;
        Object.assign(db.settings, previousSettings);
        db.activityLog = activitySnapshot;
        updateTimeDiffDisplay();
        return;
    }
    updateTimeDiffDisplay();
    toast("Đã cập nhật ngày giờ ứng dụng!");
}

function resetTimeToSystem() {
    if (!canMutateSettings()) return;
    const previousSettings = { ...db.settings };
    const previousOffset = timeOffset;
    timeOffset = 0;
    db.settings.timeOffset = 0;
    const el = $('set-custom-datetime');
    if (el) el.value = toLocalDateTimeStr(new Date());
    if (!saveNow()) {
        timeOffset = previousOffset;
        Object.assign(db.settings, previousSettings);
        updateTimeDiffDisplay();
        return;
    }
    updateTimeDiffDisplay();
    toast("Đã đồng bộ với giờ hệ thống!");
}

function formatTimeDiff(ms) {
    if (Math.abs(ms) < 60000) return 'Không có chênh lệch';
    const sign = ms >= 0 ? '+' : '-';
    const abs = Math.abs(ms);
    const days = Math.floor(abs / 86400000);
    const hours = Math.floor((abs % 86400000) / 3600000);
    const minutes = Math.floor((abs % 3600000) / 60000);
    let result = sign;
    if (days > 0) result += `${days} ngày `;
    if (hours > 0) result += `${hours} giờ `;
    result += `${minutes} phút`;
    return result;
}

function updateTimeDiffDisplay() {
    const el = $('set-time-diff');
    if (el) el.textContent = `Chênh lệch so với hệ thống: ${formatTimeDiff(timeOffset)}`;
}

// Live clock updater for settings
let _clockInterval = null;
function startSettingsClock() {
    if (_clockInterval) clearInterval(_clockInterval);
    _clockInterval = setInterval(() => {
        const sysClock = $('set-system-clock');
        if (sysClock) sysClock.textContent = new Date().toLocaleString('vi-VN');
        const appClock = $('set-app-clock');
        if (appClock) {
            if (timeOffset !== 0) {
                appClock.textContent = getAppDate().toLocaleString('vi-VN');
                appClock.style.color = 'var(--warning)';
            } else {
                appClock.textContent = new Date().toLocaleString('vi-VN');
                appClock.style.color = 'var(--primary)';
            }
        }
    }, 1000);
}

// USERS
// Generate unique employee code
function generateEmployeeCode() {
    const prefix = 'NV';
    const existingCodes = db.users.map(u => u.code).filter(Boolean);
    let counter = 1;
    let code;
    do {
        code = `${prefix}${String(counter).padStart(4, '0')}`;
        counter++;
    } while (existingCodes.includes(code));
    return code;
}

// Ensure all existing users have employee codes
function ensureUserCodes() {
    const previousCodes = db.users.map(user => user.code);
    let updated = false;
    db.users.forEach(u => {
        if (!u.code) {
            u.code = generateEmployeeCode();
            updated = true;
        }
    });
    if (updated && !saveNow()) db.users.forEach((user, index) => { user.code = previousCodes[index]; });
}

// Get staff display name for invoices: MãNV_TênNV
function getStaffDisplayName(user) {
    if (!user) return '';
    if (!user.code) {
        const dbUser = db.users.find(u => sameStoredId(u.id, user.id));
        if (dbUser) {
            if (!dbUser.code) {
                dbUser.code = generateEmployeeCode();
                if (!saveNow()) {
                    dbUser.code = '';
                    return `${user.code || 'NV0000'}_${user.name || 'Nhân viên'}`;
                }
            }
            user.code = dbUser.code;
        }
    }
    return `${user.code || 'NV0000'}_${user.name || 'Nhân viên'}`;
}

function invoiceBelongsToStaff(inv, user) {
    const staff = inv?.staff || '';
    if (!user || !staff) return false;
    const legacyDisplayName = `NV0000_${user.name || 'Nhân viên'}`;
    return staff === user.name ||
        staff === legacyDisplayName ||
        staff === getStaffDisplayName(user) ||
        (!!user.code && staff.startsWith(`${user.code}_`));
}

function getStaffPeriodRange(period) {
    const now = getAppDate();
    let startDate = new Date(now);
    let endDate = new Date(now);

    if (period === 'day') {
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
    } else if (period === 'week') {
        const day = startDate.getDay() || 7;
        startDate.setDate(startDate.getDate() - day + 1);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
    } else if (period === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (period === 'year') {
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    } else if (period.startsWith('year-')) {
        const yr = parseInt(period.replace('year-', ''));
        startDate = new Date(yr, 0, 1);
        endDate = new Date(yr, 11, 31, 23, 59, 59, 999);
    }

    return { startDate, endDate };
}

function getStaffViewUsers(search = '') {
    ensureUserCodes();
    const q = search.toLowerCase().trim();
    let users = db.users.filter(u => u.role !== 'admin' || db.users.length === 1);
    if (q) {
        users = users.filter(u =>
            (u.code && u.code.toLowerCase().includes(q)) ||
            (u.name && u.name.toLowerCase().includes(q))
        );
    }
    return users;
}

// Search users by code or name
function searchUsers(query) {
    if (!query) return db.users;
    const q = query.toLowerCase().trim();
    return db.users.filter(u =>
        (u.code && u.code.toLowerCase().includes(q)) ||
        (u.name && u.name.toLowerCase().includes(q)) ||
        (u.fullName && u.fullName.toLowerCase().includes(q)) ||
        (u.user && u.user.toLowerCase().includes(q))
    );
}

// Calculate staff salary for a period
function calculateStaffSalary(staffId, startDate, endDate) {
    const user = db.users.find(u => sameStoredId(u.id, staffId));
    if (!user) return { base: 0, commission: 0, revenue: 0, orders: 0, total: 0 };

    const invoices = db.invoices.filter(inv => {
        const d = new Date(inv.date);
        return invoiceBelongsToStaff(inv, user) && d >= startDate && d <= endDate;
    });

    const revenue = invoices.reduce((sum, inv) => sum + inv.total, 0);
    const orders = invoices.length;
    const baseSalary = parseFloat(user.baseSalary) || 0;
    const commissionRate = parseFloat(user.commission) || 0;
    const commissionAmount = revenue * (commissionRate / 100);

    return {
        base: baseSalary,
        commission: commissionAmount,
        commissionRate: commissionRate,
        revenue: revenue,
        orders: orders,
        total: baseSalary + commissionAmount
    };
}

// Render user cards for expanded view
function getCurrentUserRecord() {
    if (!isAuthenticated || !currUser) return null;
    return db.users.find(user => sameStoredId(user.id, currUser.id)) || null;
}

function canEditUser(actor, target) {
    if (!actor || !target) return false;
    if (actor.role === 'admin') return true;
    if (actor.role === 'manager') return target.role === 'staff';
    return actor.role === 'staff' && sameStoredId(actor.id, target.id);
}

function canCreateUser(actor) {
    return actor?.role === 'admin' || actor?.role === 'manager';
}

function renderUsers() {
    ensureUserCodes();
    const container = $('user-cards-container');
    const tbody = $('user-body');
    const actor = getCurrentUserRecord();

    // For backwards compatibility, also render table if exists
    if (tbody) {
        tbody.innerHTML = db.users.map(u => {
            const userIdJs = escapeJsArgument(u.id);
            return `
            <tr onclick="viewUserDetail(${userIdJs})" style="cursor:pointer">
                <td><code style="background:var(--primary-light);color:var(--primary);padding:2px 8px;border-radius:4px;">${escapeHtml(u.code || '-')}</code></td>
                <td><code>${escapeHtml(u.user)}</code></td>
                <td>${escapeHtml(u.name)}</td>
                <td><span class="badge badge-${u.role === 'admin' ? 'primary' : u.role === 'manager' ? 'warning' : 'secondary'}">${u.role === 'admin' ? '👑 Admin' : u.role === 'manager' ? '👔 Quản lý' : '👤 Nhân viên'}</span></td>
                <td><span class="badge badge-success">Hoạt động</span></td>
                <td style="text-align:right">
                    ${canEditUser(actor, u) ? `<button class="btn-sm btn-secondary" onclick="event.stopPropagation(); openUserModal(${userIdJs})">Sửa</button>` : ''}
                    ${!sameStoredId(u.id, 1) && actor?.role === 'admin' ? `<button class="btn-sm btn-danger" onclick="event.stopPropagation(); delUser(${userIdJs})">Xóa</button>` : ''}
                </td>
            </tr>
        `;
        }).join('');
    }

    // Render cards if container exists
    if (container) {
        container.innerHTML = db.users.map(u => {
            const userIdJs = escapeJsArgument(u.id);
            return `
            <div class="user-card" onclick="viewUserDetail(${userIdJs})">
                <div class="user-card-avatar">
                    ${safeImageSrc(u.avatar) ? `<img src="${escapeAttr(safeImageSrc(u.avatar))}" alt="${escapeAttr(u.name)}">` : `<div class="avatar-placeholder">${escapeHtml((u.name || 'U')[0].toUpperCase())}</div>`}
                </div>
                <div class="user-card-info">
                    <div class="user-card-name">${escapeHtml(u.name || u.user)}</div>
                    <div class="user-card-code">${escapeHtml(u.code || '-')}</div>
                    <span class="badge badge-${u.role === 'admin' ? 'primary' : u.role === 'manager' ? 'warning' : 'secondary'}">${u.role === 'admin' ? '👑 Admin' : u.role === 'manager' ? '👔 Quản lý' : '👤 Nhân viên'}</span>
                </div>
            </div>
        `;
        }).join('');
    }
}

// View user detail modal
function viewUserDetail(id) {
    const u = db.users.find(x => sameStoredId(x.id, id));
    if (!u) return;

    // Check permission - staff can only view themselves
    if (currUser?.role === 'staff' && !sameStoredId(currUser.id, u.id)) {
        toast("Bạn chỉ có thể xem thông tin của chính mình!", "error");
        return;
    }

    const body = $('user-detail-body');
    if (!body) {
        openUserModal(id);
        return;
    }

    const salaryInfo = calculateStaffSalary(u.id, new Date(getAppDate().getFullYear(), getAppDate().getMonth(), 1), getAppDate());

    body.innerHTML = `
        <div style="text-align:center; margin-bottom:20px;">
            <div style="width:80px;height:80px;margin:0 auto 10px;border-radius:50%;overflow:hidden;background:var(--bg-muted);display:flex;align-items:center;justify-content:center;font-size:32px;color:var(--primary);">
                ${safeImageSrc(u.avatar) ? `<img src="${escapeAttr(safeImageSrc(u.avatar))}" style="width:100%;height:100%;object-fit:cover;">` : escapeHtml((u.name || 'U')[0].toUpperCase())}
            </div>
            <div style="font-size:20px;font-weight:700">${escapeHtml(u.name)}</div>
            <div style="color:var(--text-muted)">${escapeHtml(u.code)} • ${u.role === 'admin' ? '👑 Admin' : u.role === 'manager' ? '👔 Quản lý' : '👤 Nhân viên'}</div>
        </div>
        
        <div class="user-detail-grid">
            <div class="user-detail-item"><span>👤 Họ và tên:</span><strong>${escapeHtml(u.fullName || u.name || '-')}</strong></div>
            <div class="user-detail-item"><span>🔑 Username:</span><strong>${escapeHtml(u.user)}</strong></div>
            <div class="user-detail-item"><span>📞 Điện thoại:</span><strong>${escapeHtml(u.phone || '-')}</strong></div>
            <div class="user-detail-item"><span>🎂 Ngày sinh:</span><strong>${u.birthday ? new Date(u.birthday).toLocaleDateString('vi-VN') : '-'}</strong></div>
            <div class="user-detail-item"><span>📅 Ngày vào làm:</span><strong>${u.startDate ? new Date(u.startDate).toLocaleDateString('vi-VN') : '-'}</strong></div>
            <div class="user-detail-item"><span>🪪 Căn cước:</span><strong>${escapeHtml(u.idCard || '-')}</strong></div>
        </div>
        
        ${currUser?.role === 'admin' ? `
        <div style="margin-top:20px; padding:15px; background:var(--bg-muted); border-radius:var(--radius-md);">
            <div style="font-weight:600;margin-bottom:10px;">💰 Thông tin lương</div>
            <div class="user-detail-grid">
                <div class="user-detail-item"><span>Lương cứng:</span><strong>${money(u.baseSalary || 0)}</strong></div>
                <div class="user-detail-item"><span>Hoa hồng:</span><strong>${u.commission || 0}%</strong></div>
            </div>
            <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border-light);">
                <div style="font-size:12px;color:var(--text-muted);margin-bottom:5px;">📊 Tháng này</div>
                <div class="d-flex gap-2">
                    <div style="flex:1;text-align:center;padding:8px;background:var(--bg-surface);border-radius:6px;">
                        <div style="font-size:11px;color:var(--text-muted)">Doanh thu</div>
                        <div style="font-weight:600;color:var(--primary)">${money(salaryInfo.revenue)}</div>
                    </div>
                    <div style="flex:1;text-align:center;padding:8px;background:var(--bg-surface);border-radius:6px;">
                        <div style="font-size:11px;color:var(--text-muted)">Đơn hàng</div>
                        <div style="font-weight:600">${salaryInfo.orders}</div>
                    </div>
                    <div style="flex:1;text-align:center;padding:8px;background:var(--success-light);border-radius:6px;">
                        <div style="font-size:11px;color:var(--text-muted)">Tổng lương</div>
                        <div style="font-weight:700;color:var(--success)">${money(salaryInfo.total)}</div>
                    </div>
                </div>
            </div>
        </div>
        ` : ''}
    `;

    // Store current viewing user
    $('user-detail-modal').dataset.userId = u.id;
    $('user-detail-modal').classList.add('active');
}

function openUserModal(id = null) {
    const modal = $('user-modal');
    if (!modal) return;

    const actor = getCurrentUserRecord();
    const target = id ? db.users.find(user => sameStoredId(user.id, id)) : null;
    if (!actor || (id ? !canEditUser(actor, target) : !canCreateUser(actor))) {
        toast("Bạn không có quyền quản lý tài khoản này!", "error");
        return;
    }

    modal.classList.add('active');
    $('u-id').value = id || '';

    if (id) {
        const u = target;
        if (!u) return closeModal('user-modal');

        if ($('u-code')) $('u-code').value = u.code || '';
        if ($('u-user')) $('u-user').value = u.user || '';
        if ($('u-pass')) $('u-pass').value = '';
        if ($('u-name')) $('u-name').value = u.name || '';
        if ($('u-fullname')) $('u-fullname').value = u.fullName || '';
        if ($('u-phone')) $('u-phone').value = u.phone || '';
        if ($('u-birthday')) $('u-birthday').value = u.birthday || '';
        if ($('u-startdate')) $('u-startdate').value = u.startDate || '';
        if ($('u-idcard')) $('u-idcard').value = u.idCard || '';
        if ($('u-basesalary')) $('u-basesalary').value = u.baseSalary || '';
        if ($('u-commission')) $('u-commission').value = u.commission || '';
        if ($('u-role')) {
            $('u-role').value = u.role || 'staff';
            $('u-role').disabled = actor.role !== 'admin';
        }
        // Handle avatar display
        if (u.avatar) {
            if ($('u-avatar-preview')) {
                $('u-avatar-preview').src = u.avatar;
                $('u-avatar-preview').style.display = 'block';
            }
            if ($('u-avatar-placeholder')) {
                $('u-avatar-placeholder').style.display = 'none';
            }
        } else {
            if ($('u-avatar-preview')) {
                $('u-avatar-preview').src = '';
                $('u-avatar-preview').style.display = 'none';
            }
            if ($('u-avatar-placeholder')) $('u-avatar-placeholder').style.display = 'block';
        }

        // Hide salary fields for non-admin
        const salarySection = $('salary-section');
        if (salarySection) {
            salarySection.style.display = actor.role === 'admin' ? 'block' : 'none';
        }
    } else {
        if ($('u-code')) $('u-code').value = generateEmployeeCode();
        if ($('u-user')) $('u-user').value = '';
        if ($('u-pass')) $('u-pass').value = '';
        if ($('u-name')) $('u-name').value = '';
        if ($('u-fullname')) $('u-fullname').value = '';
        if ($('u-phone')) $('u-phone').value = '';
        if ($('u-birthday')) $('u-birthday').value = '';
        if ($('u-startdate')) $('u-startdate').value = getAppDate().toISOString().split('T')[0];
        if ($('u-idcard')) $('u-idcard').value = '';
        if ($('u-basesalary')) $('u-basesalary').value = '';
        if ($('u-commission')) $('u-commission').value = '';
        if ($('u-role')) {
            $('u-role').value = 'staff';
            $('u-role').disabled = actor.role !== 'admin';
        }
        if ($('u-avatar-preview')) {
            $('u-avatar-preview').src = '';
            $('u-avatar-preview').style.display = 'none';
        }
        if ($('u-avatar-placeholder')) $('u-avatar-placeholder').style.display = 'block';

        // Show salary section for admin when adding new user
        const salarySection = $('salary-section');
        if (salarySection) {
            salarySection.style.display = actor.role === 'admin' ? 'block' : 'none';
        }
    }
    // Auto-focus on name input after modal is ready
    setTimeout(() => $('u-name')?.focus(), 100);
}

function handleUserAvatar(input) {
    compress(input, res => {
        if ($('u-avatar-preview')) {
            $('u-avatar-preview').src = res;
            $('u-avatar-preview').style.display = 'block';
        }
        if ($('u-avatar-placeholder')) {
            $('u-avatar-placeholder').style.display = 'none';
        }
        // Store the avatar data directly in the preview element for saveUser to use
    });
}

function saveUser() {
    const id = $('u-id').value;
    const user = ($('u-user')?.value || '').trim();
    const pass = $('u-pass')?.value || '';
    const name = ($('u-name')?.value || '').trim();
    const role = $('u-role')?.value || 'staff';
    const actor = getCurrentUserRecord();
    const isEditing = id !== '' && id !== null && id !== undefined;
    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;

    if (!user || !name) return toast("Nhập đầy đủ thông tin!", "error");
    if (!['admin', 'manager', 'staff'].includes(role)) return toast("Quyền hạn không hợp lệ!", "error");

    // Check for duplicate username - exclude current user when editing
    const duplicateUser = db.users.find(x => x.user === user && !sameStoredId(x.id, id));
    if (duplicateUser) {
        return toast("Tên đăng nhập đã tồn tại! Vui lòng chọn tên khác.", "error");
    }

    // Collect extended fields
    const profileData = {
        fullName: $('u-fullname')?.value || '',
        phone: $('u-phone')?.value || '',
        birthday: $('u-birthday')?.value || '',
        startDate: $('u-startdate')?.value || '',
        idCard: $('u-idcard')?.value || '',
        avatar: $('u-avatar-data')?.value || $('u-avatar-preview')?.src || ''
    };
    const salaryData = {
        baseSalary: parseFloat(($('u-basesalary')?.value || '0').replace(/\D/g, '')) || 0,
        commission: parseFloat($('u-commission')?.value) || 0
    };

    // Clean avatar if it's not a data URL
    if (profileData.avatar && !profileData.avatar.startsWith('data:')) {
        profileData.avatar = '';
    }

    let candidateUsers;
    if (isEditing) {
        const idx = db.users.findIndex(x => sameStoredId(x.id, id));
        const target = db.users[idx];
        if (!target) return toast("Không tìm thấy tài khoản!", "error");
        if (!canEditUser(actor, target)) return toast("Bạn không có quyền sửa tài khoản này!", "error");

        const nextUser = {
            ...target,
            user,
            name,
            ...(pass ? { pass } : {}),
            ...profileData
        };
        if (actor.role === 'admin') Object.assign(nextUser, { role, ...salaryData });
        candidateUsers = db.users.map((account, accountIndex) => accountIndex === idx ? nextUser : account);
    } else {
        if (!canCreateUser(actor)) return toast("Bạn không có quyền tạo tài khoản!", "error");
        if (!pass) return toast("Nhập mật khẩu!", "error");
        const code = $('u-code')?.value || generateEmployeeCode();
        const nextUser = {
            id: Date.now(),
            code,
            user,
            pass,
            name,
            role: actor.role === 'admin' ? role : 'staff',
            ...profileData,
            ...(actor.role === 'admin' ? salaryData : {})
        };
        candidateUsers = [...db.users, nextUser];
    }

    if (!hasValidAdminAccount(candidateUsers)) return toast("Phải giữ ít nhất một tài khoản admin hợp lệ!", "error");
    db.users = candidateUsers;
    const refreshedCurrentUser = db.users.find(account => sameStoredId(account.id, currUser?.id));
    if (refreshedCurrentUser) currUser = refreshedCurrentUser;

    logActivity('Quản lý nhân viên', id ? `Sửa: ${name}` : `Thêm mới: ${name}`);
    if (!saveInventoryCommit(inventoryCommit)) return;
    if ($('staff-view')?.classList.contains('active')) renderStaffView();
    else renderUsers();
    closeModal('user-modal');
    toast("Đã lưu!");
}

// Change own password (for staff)
function changeOwnPassword() {
    const oldPass = $('own-old-pass')?.value;
    const newPass = $('own-new-pass')?.value;
    const confirmPass = $('own-confirm-pass')?.value;

    if (!oldPass || !newPass || !confirmPass) {
        return toast("Vui lòng nhập đầy đủ thông tin!", "error");
    }

    if (newPass !== confirmPass) {
        return toast("Mật khẩu mới không khớp!", "error");
    }

    if (newPass.length < 3) {
        return toast("Mật khẩu mới phải có ít nhất 3 ký tự!", "error");
    }

    const idx = db.users.findIndex(u => sameStoredId(u.id, currUser.id));
    if (idx === -1) return toast("Không tìm thấy tài khoản!", "error");

    if (db.users[idx].pass !== oldPass) {
        return toast("Mật khẩu cũ không đúng!", "error");
    }
    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;
    db.users[idx].pass = newPass;
    currUser.pass = newPass;
    logActivity('Đổi mật khẩu', currUser.name);
    if (!saveInventoryCommit(inventoryCommit)) return;
    toast("Đổi mật khẩu thành công!");
    closeModal('change-password-modal');
}

function delUser(id) {
    const actor = getCurrentUserRecord();
    if (actor?.role !== 'admin') {
        toast("Bạn không có quyền xóa nhân viên!", "error");
        return;
    }

    const user = db.users.find(x => sameStoredId(x.id, id));
    if (!user) return toast("Không tìm thấy tài khoản!", "error");
    if (sameStoredId(user.id, 1)) return toast("Không thể xóa tài khoản hệ thống!", "error");
    const deletesCurrentUser = sameStoredId(user.id, currUser?.id);
    const candidateUsers = db.users.filter(x => !sameStoredId(x.id, id));
    if (!hasValidAdminAccount(candidateUsers)) {
        return toast("Phải giữ ít nhất một tài khoản admin hợp lệ!", "error");
    }

    if (confirm("Xóa nhân viên này?")) {
        const inventoryCommit = beginInventoryCommit();
        if (!inventoryCommit) return;
        db.users = candidateUsers;
        logActivity('Quản lý nhân viên', `Xóa: ${user.name}`);
        if (!saveInventoryCommit(inventoryCommit)) return;
        if (deletesCurrentUser) return logout();
        if ($('staff-view')?.classList.contains('active')) renderStaffView();
        else renderUsers();
    }
}

// STAFF VIEW - Salary Management
function renderStaffView() {
    const period = $('staff-period')?.value || 'month';
    const search = ($('staff-search')?.value || '').toLowerCase().trim();

    const { startDate, endDate } = getStaffPeriodRange(period);
    const users = getStaffViewUsers(search);

    // Calculate salaries
    const staffData = users.map(u => {
        const salary = calculateStaffSalary(u.id, startDate, endDate);
        return { ...u, ...salary };
    }).sort((a, b) => b.revenue - a.revenue);

    const totalSalary = staffData.reduce((sum, s) => sum + s.total, 0);
    const totalRevenue = staffData.reduce((sum, s) => sum + s.revenue, 0);
    const totalOrders = staffData.reduce((sum, s) => sum + s.orders, 0);

    // Update stats
    if ($('staff-total-salary')) $('staff-total-salary').innerText = money(totalSalary);
    if ($('staff-count')) $('staff-count').innerText = staffData.length.toLocaleString('vi-VN');
    if ($('staff-total-revenue')) $('staff-total-revenue').innerText = money(totalRevenue);
    if ($('staff-total-orders')) $('staff-total-orders').innerText = totalOrders.toLocaleString('vi-VN');

    // Render table
    const tbody = $('staff-salary-body');
    if (tbody) {
        tbody.innerHTML = staffData.map((s, i) => `
            <tr>
                <td style="text-align:center;font-weight:600;color:${i === 0 ? 'var(--success)' : i === 1 ? 'var(--warning)' : 'var(--text-muted)'}">${i + 1}</td>
                <td><code style="background:var(--primary-light);color:var(--primary);padding:2px 6px;border-radius:4px;">${escapeHtml(s.code)}</code></td>
                <td><strong>${escapeHtml(s.name)}</strong></td>
                <td style="text-align:right">${money(s.base)}</td>
                <td style="text-align:right">${s.commissionRate}%</td>
                <td style="text-align:right;color:var(--primary)">${money(s.revenue)}</td>
                <td style="text-align:center">${s.orders}</td>
                <td style="text-align:right">${money(s.commission)}</td>
                <td style="text-align:right;font-weight:700;color:var(--success)">${money(s.total)}</td>
            </tr>
        `).join('') || '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-muted)">Không có dữ liệu</td></tr>';
    }

    // Draw chart
    drawStaffChart(staffData);

    // Render user cards
    renderUsers();
}

function drawStaffChart(data) {
    const canvas = $('staff-chart');
    if (!canvas) return;

    if (!Array.isArray(data) || data.length === 0) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');

    const pad = 40;
    const w = canvas.width - pad * 2;
    const h = canvas.height - pad * 2;

    const maxVal = Math.max(...data.map(d => d.revenue), 100000);
    const barWidth = Math.min(60, (w / data.length) * 0.7);
    const gap = (w - barWidth * data.length) / (data.length + 1);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Get theme-aware colors
    const textColor = getComputedStyle(document.body).getPropertyValue('--text-primary').trim() || '#000';
    const gridColor = getComputedStyle(document.body).getPropertyValue('--border-light').trim() || '#E2E8F0';

    // Grid
    ctx.strokeStyle = gridColor;
    ctx.fillStyle = textColor;
    ctx.font = 'bold 11px system-ui';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
        const y = pad + h - (i * (h / 4));
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(pad + w, y);
        ctx.stroke();
        ctx.fillText(Math.round((i * (maxVal / 4)) / 1000) + 'k', 5, y + 4);
    }

    // Bars
    const colors = ['#10B981', '#F59E0B', '#6366F1', '#8B5CF6', '#EC4899', '#06B6D4'];
    data.slice(0, 6).forEach((d, i) => {
        const barH = (d.revenue / maxVal) * h;
        const x = pad + gap + i * (barWidth + gap);
        const y = pad + h - barH;

        ctx.fillStyle = colors[i % colors.length];
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barH, [4, 4, 0, 0]);
        ctx.fill();

        // Label
        ctx.fillStyle = textColor;
        ctx.font = 'bold 10px system-ui';
        ctx.textAlign = 'center';
        const label = d.name.length > 8 ? d.name.substring(0, 8) + '...' : d.name;
        ctx.fillText(label, x + barWidth / 2, canvas.height - 10);

        // Value on top
        if (d.revenue > 0) {
            ctx.fillText(Math.round(d.revenue / 1000) + 'k', x + barWidth / 2, y - 5);
        }
    });
}

function exportStaffSalaryExcel() {
    const period = $('staff-period')?.value || 'month';
    const periodLabels = { day: 'Hôm nay', week: 'Tuần này', month: 'Tháng này', year: 'Năm nay' };
    const search = ($('staff-search')?.value || '').toLowerCase().trim();

    const { startDate, endDate } = getStaffPeriodRange(period);

    const users = getStaffViewUsers(search);
    const data = users.map(u => {
        const s = calculateStaffSalary(u.id, startDate, endDate);
        return [u.code, u.name, u.baseSalary || 0, (u.commission || 0) + '%', s.revenue, s.orders, s.commission, s.total];
    });

    const headers = ['Mã NV', 'Tên NV', 'Lương cứng', 'Hoa hồng', 'Doanh thu', 'Đơn hàng', 'Tiền HH', 'Tổng lương'];
    exportToExcel(data, headers, `BangLuong_${periodLabels[period] || period}`);
}

// AUTH
function login() {
    const u = ($('log-u')?.value || '').trim();
    const p = $('log-p')?.value;
    const f = db.users.find(x => x.user == u && x.pass == p);
    if (f) {
        currUser = f;
        isAuthenticated = true;
        updateAuthPanel();
        if ($('log-p')) $('log-p').value = '';
        closeModal('login-modal');
        renderNav();
        router('pos');
        logActivity('Đăng nhập', f.name);
        toast("Đăng nhập thành công!");
    } else {
        currUser = null;
        isAuthenticated = false;
        if ($('log-p')) {
            $('log-p').focus();
            $('log-p').select();
        }
        toast("Sai thông tin!", "error");
    }
}

function logout() {
    closeAllModals();
    if (isLoginDisabled() && signInAsDefaultAdmin({ route: 'pos', showError: true })) {
        toast("Chế độ không cần đăng nhập đang bật.", "info");
        return;
    }
    showLoginModal();
}

// ═══════════════════════════════════════════════════════════════════════════
// SIDEBAR TOGGLE - Thu gọn/mở rộng thanh menu bên trái
// ═══════════════════════════════════════════════════════════════════════════

function toggleSidebar() {
    const sidebar = document.querySelector('aside');
    const toggleBtn = document.querySelector('.sidebar-toggle');

    if (!sidebar) return;

    sidebar.classList.toggle('collapsed');

    // Update toggle button icon
    if (toggleBtn) {
        toggleBtn.textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
    }

    // Save state to localStorage
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
}

// Initialize sidebar state from localStorage
function initSidebarState() {
    const sidebar = document.querySelector('aside');
    const toggleBtn = document.querySelector('.sidebar-toggle');
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';

    if (sidebar && isCollapsed) {
        sidebar.classList.add('collapsed');
        if (toggleBtn) toggleBtn.textContent = '▶';
    }
}

// Sidebar state - initialized in consolidated DOMContentLoaded

// NAVIGATION
function renderNav() {

    const menu = [
        { id: 'pos', icon: '🛒', t: 'Bán hàng', r: ['admin', 'manager', 'staff'] },
        { id: 'products', icon: '📦', t: 'Hàng hoá', r: ['admin', 'manager', 'staff'] },
        { id: 'history', icon: '📜', t: 'Lịch sử', r: ['admin', 'manager', 'staff'] },
        { id: 'management', icon: '📊', t: 'Quản lý', r: ['admin', 'manager'] },
        { id: 'customers', icon: '👥', t: 'Khách hàng', r: ['admin', 'manager', 'staff'] },
        { id: 'staff', icon: '👔', t: 'Nhân viên', r: ['admin', 'manager'] },
        { id: 'settings', icon: '⚙️', t: 'Cài đặt', r: ['admin', 'manager', 'staff'] }
    ];

    const nav = $('nav-menu');
    if (!nav) return;
    nav.innerHTML = menu
        .filter(i => i.r.includes(currUser?.role))
        .map(i => `<button id="nav-${i.id}" onclick="router('${i.id}')" title="${i.t}"><span class="nav-icon">${i.icon}</span><span class="nav-text">${i.t}</span></button>`)
        .join('');
    syncManagementMutationUi();
}

function syncManagementMutationUi() {
    const canManage = isAuthenticated && ['admin', 'manager'].includes(currUser?.role);
    document.querySelectorAll('[data-management-mutation]').forEach(element => { element.hidden = !canManage; });
}

let currentHistoryTab = 'sales';

function renderHistoryTab(tab) {
    currentHistoryTab = tab === 'returns' ? 'returns' : 'sales';
    selectedReturns.clear();
    updateBulkDeleteUI('returns');
    document.querySelectorAll('#history-view .products-tab-btn').forEach(button => {
        button.classList.toggle('active', button.dataset.tab === currentHistoryTab);
    });
    document.querySelectorAll('#history-view .products-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `history-tab-${currentHistoryTab}`);
    });
    document.querySelectorAll('#history-header-tools [data-history-tools]').forEach(toolbar => {
        toolbar.style.display = toolbar.dataset.historyTools === currentHistoryTab ? '' : 'none';
    });
    if (currentHistoryTab === 'returns') renderReturnsHistory();
    else renderHist();
}

function router(id) {
    if (!isAuthenticated) {
        showLoginModal();
        return;
    }

    // Handle legacy routes - redirect to new consolidated views
    if (id === 'inventory') id = 'products';
    if (id === 'suppliers') id = 'products';
    if (id === 'reports') id = 'management';

    const restrictedRoutes = {
        management: ['admin', 'manager'],
        staff: ['admin', 'manager']
    };
    if (restrictedRoutes[id] && !restrictedRoutes[id].includes(currUser?.role)) {
        toast("Bạn không có quyền truy cập mục này!", "warning");
        return;
    }

    document.querySelectorAll('.view').forEach(e => e.classList.remove('active'));
    document.querySelectorAll('nav button').forEach(e => e.classList.remove('active'));

    const view = $(id + '-view');
    if (view) view.classList.add('active');
    const navBtn = $('nav-' + id);
    if (navBtn) navBtn.classList.add('active');

    if (id === 'pos') {
        renderPos();
        renderInvoiceTabs();
        renderCart();
        renderCustTable();
        updateCustList();
        // Initialize quick return button
        const btnQuickReturn = $('btn-quick-return');
        if (btnQuickReturn && !btnQuickReturn.onclick) {
            btnQuickReturn.onclick = function () { startQuickReturn(); };
        }
        // Update return mode UI based on current tab
        const currentTab = invoiceTabs.find(t => t.id === activeTabId);
        updateReturnModeUI(currentTab && currentTab.mode === 'return');
        setTimeout(() => $('pos-search')?.focus(), 100);
    }
    if (id === 'products') { renderProductsTab('products'); }
    if (id === 'history') renderHistoryTab('sales');
    if (id === 'management') renderManagement();
    if (id === 'customers') renderCustTable();
    if (id === 'settings') { loadSets(); applySettingsPermissions(); }
    if (id === 'staff') renderStaffView();
    if (id === 'help') { /* Help view is static HTML, no render needed */ }
}

// Products tab switching (Hàng hoá)
let currentProductsTab = 'products';
function renderProductsTab(tab) {
    currentProductsTab = tab;

    // Update tab buttons
    document.querySelectorAll('#products-view .products-tab-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`#products-view .products-tab-btn[data-tab="${tab}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // Show/hide tab content
    document.querySelectorAll('.products-tab-content').forEach(c => c.classList.remove('active'));
    const activeContent = $(`products-tab-${tab}`);
    if (activeContent) activeContent.classList.add('active');

    // Render content
    if (tab === 'products') { renderProdTable(); renderCategories(); }
    if (tab === 'inventory') renderInventory();
    if (tab === 'suppliers') renderSuppliers();
}

// Management Tab Switch
function renderMgmtTab(tab) {
    // Update tab buttons
    document.querySelectorAll('#management-view .products-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Update tab content
    document.querySelectorAll('.mgmt-tab-content').forEach(content => {
        content.classList.remove('active');
    });

    const tabContent = $('mgmt-tab-' + tab);
    if (tabContent) tabContent.classList.add('active');

    // Render content
    if (tab === 'inventory') {
        renderStockHistory();
        // Update inventory stats
        const totalValue = db.products.reduce((a, p) => a + (p.cost || 0) * (p.stock || 0), 0);
        const lowStock = db.settings.lowStock || 5;
        if ($('mgmt-inv-value')) $('mgmt-inv-value').innerText = money(totalValue);
        if ($('mgmt-inv-products')) $('mgmt-inv-products').innerText = db.products.length.toLocaleString('vi-VN');
        if ($('mgmt-low-stock')) $('mgmt-low-stock').innerText = db.products.filter(p => p.stock > 0 && p.stock <= lowStock).length.toLocaleString('vi-VN');
        if ($('mgmt-out-stock')) $('mgmt-out-stock').innerText = db.products.filter(p => p.stock <= 0).length.toLocaleString('vi-VN');
    }
    if (tab === 'reports') {
        initMgmtDateFilter();
        updateMgmtReport();
    }
}

// YouTube-style Date Filter Toggle
function toggleDateFilter(prefix) {
    const menu = $(prefix + '-date-filter-menu');
    if (menu) {
        menu.classList.toggle('show');
        // Initialize calendar when opened
        if (menu.classList.contains('show')) {
            initCalendar(prefix);
            setTimeout(() => {
                document.addEventListener('click', function closeMenu(e) {
                    if (!e.target.closest('.date-filter-dropdown')) {
                        menu.classList.remove('show');
                        document.removeEventListener('click', closeMenu);
                    }
                });
            }, 10);
        }
    }
}

// Set Date Preset
function setDatePreset(prefix, preset) {
    const now = getAppDate();
    let from = new Date(now);
    let to = new Date(now);
    let label = '';

    // Update active button
    document.querySelectorAll('#' + prefix + '-date-filter-menu .date-preset-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.onclick.toString().includes("'" + preset + "'")) {
            btn.classList.add('active');
        }
    });

    switch (preset) {
        case 'today':
            label = '📅 Hôm nay';
            break;
        case 'yesterday':
            from.setDate(from.getDate() - 1);
            to.setDate(to.getDate() - 1);
            label = '📅 Hôm qua';
            break;
        case 'week':
            from.setDate(from.getDate() - 7);
            label = '📅 7 ngày qua';
            break;
        case 'month':
            from.setDate(from.getDate() - 30);
            label = '📅 30 ngày qua';
            break;
        case 'quarter':
            from.setMonth(Math.floor(from.getMonth() / 3) * 3);
            from.setDate(1);
            label = '📅 Quý này';
            break;
        case 'year':
            from = new Date(now.getFullYear(), 0, 1);
            label = '📅 Năm nay';
            break;
        case 'prev-year':
            from = new Date(now.getFullYear() - 1, 0, 1);
            to = new Date(now.getFullYear() - 1, 11, 31);
            label = '📅 Năm ' + (now.getFullYear() - 1);
            break;
        case 'all':
            from = new Date(2020, 0, 1);
            label = '📅 Tất cả';
            break;
    }

    // Update inputs with LOCAL timezone formatting
    const fromEl = $(prefix + '-date-from');
    const toEl = $(prefix + '-date-to');
    if (fromEl) fromEl.value = toLocalDateStr(from);
    if (toEl) toEl.value = toLocalDateStr(to);

    // Update label
    const labelEl = $(prefix + '-date-filter-label');
    if (labelEl) labelEl.textContent = label;

    // Close menu
    const menu = $(prefix + '-date-filter-menu');
    if (menu) menu.classList.remove('show');

    // Update report
    if (prefix === 'mgmt') updateMgmtReport();
    if (prefix === 'hist') renderHist();
    if (prefix === 'returns') renderReturnsHistory();
    if (prefix === 'report-modal') refreshReportModalContent(from, to);
}
// Apply Custom Date Filter
function applyCustomDateFilter(prefix) {
    const fromEl = $(prefix + '-date-from');
    const toEl = $(prefix + '-date-to');

    if (fromEl && toEl && fromEl.value && toEl.value) {
        const from = new Date(fromEl.value);
        const to = new Date(toEl.value);
        const labelEl = $(prefix + '-date-filter-label');
        if (labelEl) {
            labelEl.textContent = `📅 ${from.toLocaleDateString('vi-VN')} - ${to.toLocaleDateString('vi-VN')}`;
        }

        // Remove active from presets
        document.querySelectorAll('#' + prefix + '-date-filter-menu .date-preset-btn').forEach(btn => {
            btn.classList.remove('active');
        });
    }

    // Close menu
    const menu = $(prefix + '-date-filter-menu');
    if (menu) menu.classList.remove('show');

    // Update report
    if (prefix === 'mgmt') updateMgmtReport();
    if (prefix === 'hist') renderHist();
    if (prefix === 'returns') renderReturnsHistory();
}

// Calendar Range Picker State
const calendarState = {};

function initCalendar(prefix) {
    if (!calendarState[prefix]) {
        calendarState[prefix] = {
            currentMonth: new Date(),
            startDate: null,
            endDate: null,
            selectingEnd: false
        };
    }
    renderCalendar(prefix);
}

function renderCalendar(prefix) {
    const container = $(prefix + '-calendar-container');
    if (!container) return;

    const state = calendarState[prefix];
    const year = state.currentMonth.getFullYear();
    const month = state.currentMonth.getMonth();

    const monthNames = ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12'];
    const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let html = `
        <div class="calendar-range-display">
            <span>Từ:</span>
            <span class="date-val">${state.startDate ? state.startDate.toLocaleDateString('vi-VN') : '--/--/----'}</span>
            <span>→</span>
            <span>Đến:</span>
            <span class="date-val">${state.endDate ? state.endDate.toLocaleDateString('vi-VN') : '--/--/----'}</span>
        </div>
        <div class="calendar-picker">
            <div class="calendar-header">
                <button onclick="navigateCalendar('${prefix}', -1)">◀</button>
                <span>${monthNames[month]} ${year}</span>
                <button onclick="navigateCalendar('${prefix}', 1)">▶</button>
            </div>
            <div class="calendar-grid">
                ${dayNames.map(d => `<div class="calendar-day-header">${d}</div>`).join('')}
    `;

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
        html += '<div class="calendar-day empty"></div>';
    }

    // Days of month
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dateStr = toLocalDateStr(date);

        let classes = 'calendar-day';
        if (state.startDate && dateStr === toLocalDateStr(state.startDate)) {
            classes += ' start selected';
        } else if (state.endDate && dateStr === toLocalDateStr(state.endDate)) {
            classes += ' end selected';
        } else if (state.startDate && state.endDate && date > state.startDate && date < state.endDate) {
            classes += ' in-range';
        }

        html += `<div class="${classes}" onclick="selectCalendarDate('${prefix}', '${dateStr}')">${day}</div>`;
    }

    html += `
            </div>
            <div style="margin-top:10px; text-align:right">
                <button class="btn btn-sm" onclick="applyCalendarRange('${prefix}')">Áp dụng</button>
            </div>
        </div>
    `;

    container.innerHTML = html;
}

function navigateCalendar(prefix, delta) {
    const state = calendarState[prefix];
    state.currentMonth.setMonth(state.currentMonth.getMonth() + delta);
    renderCalendar(prefix);
}

function selectCalendarDate(prefix, dateStr) {
    const state = calendarState[prefix];
    const date = parseLocalDateInput(dateStr);

    if (!state.startDate || state.selectingEnd === false) {
        // Selecting start date
        state.startDate = date;
        state.endDate = null;
        state.selectingEnd = true;
    } else {
        // Selecting end date
        if (date >= state.startDate) {
            state.endDate = date;
        } else {
            // If end date is before start, swap them
            state.endDate = state.startDate;
            state.startDate = date;
        }
        state.selectingEnd = false;
    }

    // Update hidden inputs
    const fromEl = $(prefix + '-date-from');
    const toEl = $(prefix + '-date-to');
    if (fromEl && state.startDate) fromEl.value = toLocalDateStr(state.startDate);
    if (toEl && state.endDate) toEl.value = toLocalDateStr(state.endDate);

    renderCalendar(prefix);
}

function applyCalendarRange(prefix) {
    const state = calendarState[prefix];

    if (state.startDate && state.endDate) {
        const labelEl = $(prefix + '-date-filter-label');
        if (labelEl) {
            labelEl.textContent = `📅 ${state.startDate.toLocaleDateString('vi-VN')} - ${state.endDate.toLocaleDateString('vi-VN')}`;
        }

        // Remove active from presets
        document.querySelectorAll('#' + prefix + '-date-filter-menu .date-preset-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        // Close menu
        const menu = $(prefix + '-date-filter-menu');
        if (menu) menu.classList.remove('show');

        // Update report
        if (prefix === 'mgmt') updateMgmtReport();
        if (prefix === 'hist') renderHist();
        if (prefix === 'report-modal') refreshReportModalContent(state.startDate, state.endDate);
    } else {
        toast('Vui lòng chọn cả ngày bắt đầu và kết thúc', 'warning');
    }
}

// Management view (merged Reports + overview)
function renderManagement() {
    // Calculate and display inventory stats for Management view (mgmt-* IDs) FIRST
    const totalValue = db.products.reduce((a, p) => a + (p.cost || 0) * (p.stock || 0), 0);
    const lowStock = db.settings.lowStock || 5;
    const totalProducts = db.products.length;
    const lowStockCount = db.products.filter(p => p.stock > 0 && p.stock <= lowStock).length;
    const outOfStockCount = db.products.filter(p => p.stock <= 0).length;

    if ($('mgmt-inv-value')) $('mgmt-inv-value').innerText = money(totalValue);
    if ($('mgmt-inv-products')) $('mgmt-inv-products').innerText = totalProducts.toLocaleString('vi-VN');
    if ($('mgmt-low-stock')) $('mgmt-low-stock').innerText = lowStockCount.toLocaleString('vi-VN');
    if ($('mgmt-out-stock')) $('mgmt-out-stock').innerText = outOfStockCount.toLocaleString('vi-VN');

    // Render stock history in management view
    renderStockHistory();

    // Initialize date filters and render report
    initMgmtDateFilter();
    updateMgmtReport();

    // Render dashboard charts (wrapped in try-catch to prevent canvas errors from blocking stats)
    try {
        renderDashboard();
    } catch (e) {
        console.warn('Dashboard render error (may happen when charts are hidden):', e);
    }
}

// Management Report Date Filter
let mgmtReportData = { orders: [], fromDate: null, toDate: null };
let reportModalData = { orders: [], fromDate: null, toDate: null };

function initMgmtDateFilter() {
    const today = getAppDate();
    const fromEl = $('mgmt-date-from');
    const toEl = $('mgmt-date-to');

    if (!fromEl || !toEl) return;

    // Only set default values if inputs are empty (preserve user selections)
    if (!fromEl.value) {
        fromEl.value = toLocalDateStr(today);
    }
    if (!toEl.value) {
        toEl.value = toLocalDateStr(today);
    }
}

function setMgmtDateFilter(period) {
    const now = getAppDate();
    let from = new Date(now);
    let to = new Date(now);

    // Update active button
    document.querySelectorAll('.mgmt-quick-filter').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.period === period);
    });

    switch (period) {
        case 'today':
            // Already set to today
            break;
        case 'week':
            from.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
            break;
        case 'month':
            from.setDate(1); // Start of month
            break;
        case 'year':
            from = new Date(now.getFullYear(), 0, 1); // Jan 1st
            break;
    }

    const fromEl = $('mgmt-date-from');
    const toEl = $('mgmt-date-to');
    if (fromEl) fromEl.value = toLocalDateStr(from);
    if (toEl) toEl.value = toLocalDateStr(to);

    updateMgmtReport();
}

function updateMgmtReport() {
    const fromEl = $('mgmt-date-from');
    const toEl = $('mgmt-date-to');

    if (!fromEl || !toEl) return;

    // Parse dates in LOCAL timezone (not UTC)
    // fromEl.value is 'YYYY-MM-DD', we need start of day in local time
    let fromDate, toDate;
    if (fromEl.value) {
        const [y, m, d] = fromEl.value.split('-').map(Number);
        fromDate = new Date(y, m - 1, d, 0, 0, 0, 0); // Start of day local
    } else {
        fromDate = getAppDate();
        fromDate.setHours(0, 0, 0, 0);
    }

    if (toEl.value) {
        const [y, m, d] = toEl.value.split('-').map(Number);
        toDate = new Date(y, m - 1, d, 23, 59, 59, 999); // End of day local
    } else {
        toDate = getAppDate();
        toDate.setHours(23, 59, 59, 999);
    }

    // Filter invoices by date (data is stored in db.invoices, not db.orders)
    const orders = (db.invoices || []).filter(o => {
        const d = new Date(o.date || o.time);
        return d >= fromDate && d <= toDate;
    });

    mgmtReportData = { orders, fromDate, toDate };

    // Calculate stats
    const revenue = orders.reduce((a, o) => a + (o.total || 0), 0);
    const totalCost = orders.reduce((a, o) => a + getInvoiceCost(o), 0);
    const profit = revenue - totalCost;

    const orderCount = orders.length;
    const uniqueCustomers = new Set(orders.map(o => o.custId).filter(id => id && id !== 1)).size;

    // Update stats
    if ($('mgmt-revenue')) $('mgmt-revenue').innerText = money(revenue);
    if ($('mgmt-profit')) $('mgmt-profit').innerText = money(profit);
    if ($('mgmt-orders')) $('mgmt-orders').innerText = orderCount.toLocaleString('vi-VN');
    if ($('mgmt-customers')) $('mgmt-customers').innerText = uniqueCustomers.toLocaleString('vi-VN');

    // Draw charts
    try {
        drawMgmtChart();
        drawMgmtPieChart();
    } catch (e) {
        console.warn('Chart error:', e);
    }

    // Render top/worst products
    renderMgmtTopProducts();
}

function drawMgmtChart() {
    const canvas = $('mgmt-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    // Always use bar chart (line chart removed)
    const chartType = 'bar';

    // Get parent dimensions using offsetWidth/Height to avoid layout thrashing
    const parent = canvas.parentElement;
    if (!parent) return;

    // Use stable dimensions - avoid getBoundingClientRect during animations
    const parentWidth = parent.offsetWidth || parent.clientWidth || 500;
    const parentHeight = parent.offsetHeight || parent.clientHeight || 450;

    // Set canvas size with fixed constraints to prevent layout shifts
    canvas.width = Math.min(Math.max(parentWidth - 24, 300), 1200);
    canvas.height = Math.min(Math.max(parentHeight - 24, 400), 500);

    const w = canvas.width;
    const h = canvas.height;

    if (w <= 0 || h <= 0) return;

    ctx.clearRect(0, 0, w, h);

    // Group orders by date
    const { orders, fromDate, toDate } = mgmtReportData;
    const dailyData = {};

    // Create date range
    const current = new Date(fromDate);
    const daysDiff = Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24));

    // Aggregate by week/month for long ranges
    let groupBy = 'day';
    if (daysDiff > 60) groupBy = 'week';
    if (daysDiff > 180) groupBy = 'month';

    while (current <= toDate) {
        let key;
        if (groupBy === 'month') {
            key = toLocalMonthStr(current);
        } else if (groupBy === 'week') {
            const weekStart = new Date(current);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            key = toLocalDateStr(weekStart);
        } else {
            key = toLocalDateStr(current);
        }
        if (!dailyData[key]) dailyData[key] = { revenue: 0, profit: 0, cost: 0 };
        current.setDate(current.getDate() + 1);
    }

    // Aggregate data
    orders.forEach(o => {
        const d = new Date(o.date || o.time);
        let key;
        if (groupBy === 'month') {
            key = toLocalMonthStr(d);
        } else if (groupBy === 'week') {
            const weekStart = new Date(d);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            key = toLocalDateStr(weekStart);
        } else {
            key = toLocalDateStr(d);
        }
        if (dailyData[key]) {
            dailyData[key].revenue += o.total || 0;
            const orderCost = getInvoiceCost(o);
            const orderProfit = (o.total || 0) - orderCost;
            dailyData[key].cost += orderCost;
            dailyData[key].profit += orderProfit;
        }
    });

    const dates = Object.keys(dailyData).sort();
    const revenueData = dates.map(d => dailyData[d].revenue);
    const profitData = dates.map(d => dailyData[d].profit);
    const costData = dates.map(d => dailyData[d].cost);

    if (dates.length === 0) {
        const textColor = getComputedStyle(document.body).getPropertyValue('--text-primary').trim() || '#000';
        ctx.fillStyle = textColor;
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Chưa có dữ liệu', w / 2, h / 2);
        return;
    }

    const maxVal = Math.max(...revenueData, ...profitData, ...costData, 1);
    const padding = { left: 70, right: 15, top: 40, bottom: 35 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    // Get theme-aware colors
    const textColor = getComputedStyle(document.body).getPropertyValue('--text-primary').trim() || '#000';
    const gridColor = getComputedStyle(document.body).getPropertyValue('--border-light').trim() || '#e5e7eb';

    // Draw legend at top left (inside chart) - 3 columns: Revenue, Cost, Profit
    const compactLegend = w < 420;
    const legendStart = compactLegend ? 6 : padding.left + 5;
    const legendPositions = compactLegend
        ? [legendStart, legendStart + Math.floor((w - 12) / 3), legendStart + Math.floor((w - 12) * 2 / 3)]
        : [legendStart, padding.left + 110, padding.left + 195];
    const legendItems = [
        { label: 'Doanh thu', color: '#6366f1' },
        { label: 'Giá vốn', color: '#f59e0b' },
        { label: 'Lợi nhuận', color: '#10b981' }
    ];

    ctx.font = `${compactLegend ? 11 : 13}px Inter, sans-serif`;
    ctx.textAlign = 'left';
    legendItems.forEach((item, index) => {
        const x = legendPositions[index];
        ctx.fillStyle = item.color;
        ctx.fillRect(x, 8, 14, 14);
        ctx.fillStyle = textColor;
        ctx.fillText(item.label, x + 19, 19);
    });

    // Draw grid lines
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (chartH * i / 4);
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        ctx.stroke();

        // Y-axis labels - format money properly
        ctx.fillStyle = textColor;
        ctx.font = 'bold 12px Inter, sans-serif';
        ctx.textAlign = 'right';
        const val = maxVal * (1 - i / 4);
        let label = (val / 1000000).toFixed(1) + 'M';
        if (val < 1000000) label = (val / 1000).toFixed(0) + 'K';
        if (val < 1000) label = val.toFixed(0);
        ctx.fillText(label, padding.left - 6, y + 4);
    }

    const barWidth = Math.max(20, Math.min(chartW / dates.length - 10, 60)); // Adjusted for 3 bars
    const barSpacing = chartW / dates.length;
    const showLabels = dates.length <= 15;

    if (chartType === 'bar') {
        // Bar chart with 3 columns: Revenue, Cost, Profit
        const singleBarW = barWidth / 3;
        dates.forEach((date, i) => {
            const x = padding.left + (chartW / dates.length) * (i + 0.5);
            const revH = (revenueData[i] / maxVal) * chartH;
            const costH = (costData[i] / maxVal) * chartH;
            const profH = (profitData[i] / maxVal) * chartH;

            // Revenue bar (blue) - left
            ctx.fillStyle = 'rgba(99, 102, 241, 0.85)';
            ctx.fillRect(x - barWidth / 2, padding.top + chartH - revH, singleBarW - 1, revH);

            // Cost bar (orange) - middle
            ctx.fillStyle = 'rgba(245, 158, 11, 0.85)';
            ctx.fillRect(x - barWidth / 2 + singleBarW, padding.top + chartH - costH, singleBarW - 1, costH);

            // Profit bar (green) - right
            ctx.fillStyle = 'rgba(16, 185, 129, 0.85)';
            ctx.fillRect(x - barWidth / 2 + singleBarW * 2, padding.top + chartH - profH, singleBarW - 1, profH);

            // X-axis label - Vietnamese date format (dd/mm)
            if (showLabels || i % Math.ceil(dates.length / 10) === 0) {
                ctx.fillStyle = textColor;
                ctx.font = 'bold 11px Inter, sans-serif';
                ctx.textAlign = 'center';
                // Convert YYYY-MM-DD to dd/mm format
                let label;
                if (groupBy === 'month') {
                    label = date.slice(5); // MM format for months
                } else {
                    const parts = date.split('-');
                    label = parts[2] + '/' + parts[1]; // dd/mm format
                }
                ctx.fillText(label, x, h - 8);
            }
        });
    } else {
        // Line chart
        const drawLine = (data, color) => {
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            data.forEach((val, i) => {
                const x = padding.left + (chartW / (dates.length - 1 || 1)) * i;
                const y = padding.top + chartH - (val / maxVal) * chartH;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();

            // Draw dots (only if not too many)
            if (dates.length <= 30) {
                data.forEach((val, i) => {
                    const x = padding.left + (chartW / (dates.length - 1 || 1)) * i;
                    const y = padding.top + chartH - (val / maxVal) * chartH;
                    ctx.beginPath();
                    ctx.arc(x, y, 3, 0, Math.PI * 2);
                    ctx.fillStyle = color;
                    ctx.fill();
                });
            }
        };

        drawLine(revenueData, '#6366f1');
        drawLine(profitData, '#10b981');

        dates.forEach((date, i) => {
            if (showLabels || i % Math.ceil(dates.length / 10) === 0) {
                const x = padding.left + (chartW / (dates.length - 1 || 1)) * i;
                ctx.fillStyle = textColor;
                ctx.font = 'bold 11px Inter, sans-serif';
                ctx.textAlign = 'center';
                // Convert YYYY-MM-DD to dd/mm format
                let label;
                if (groupBy === 'month') {
                    label = date.slice(5); // MM format for months
                } else {
                    const parts = date.split('-');
                    label = parts[2] + '/' + parts[1]; // dd/mm format
                }
                ctx.fillText(label, x, h - 8);
            }
        });
    }

    // Store chart data for tooltip
    canvas._chartData = { dates, revenueData, profitData, costData, padding, chartW, chartH, chartType, groupBy };

    // Add tooltip event listeners (only once)
    if (!canvas._tooltipInit) {
        canvas._tooltipInit = true;
        const tooltip = $('chart-tooltip');

        canvas.addEventListener('mousemove', (e) => {
            const data = canvas._chartData;
            if (!data || !tooltip) return;

            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // Find which data point is closest
            let closestIdx = -1;
            let minDist = Infinity;

            data.dates.forEach((_, i) => {
                let x;
                if (data.chartType === 'bar') {
                    x = data.padding.left + (data.chartW / data.dates.length) * (i + 0.5);
                } else {
                    x = data.padding.left + (data.chartW / (data.dates.length - 1 || 1)) * i;
                }
                const dist = Math.abs(mouseX - x);
                // Use half the bar spacing as threshold to prevent overlap detection
                const threshold = data.chartType === 'bar' ? (data.chartW / data.dates.length) / 2 : 50;
                if (dist < minDist && dist < threshold) {
                    minDist = dist;
                    closestIdx = i;
                }
            });

            if (closestIdx >= 0 && mouseY > data.padding.top && mouseY < canvas.height - data.padding.bottom) {
                const date = data.dates[closestIdx];
                const revenue = data.revenueData[closestIdx];
                const profit = data.profitData[closestIdx];
                const cost = data.costData ? data.costData[closestIdx] : 0;
                // Format date label to dd/mm
                let dateLabel;
                if (data.groupBy === 'month') {
                    dateLabel = date;
                } else {
                    const parts = date.split('-');
                    dateLabel = parts[2] + '/' + parts[1]; // dd/mm format
                }

                tooltip.innerHTML = `
                    <div style="font-weight:600; margin-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.2); padding-bottom:4px">📅 ${dateLabel}</div>
                    <div style="color:#a5b4fc">💰 Doanh thu: ${money(revenue)}</div>
                    <div style="color:#fcd34d">📦 Giá vốn: ${money(cost)}</div>
                    <div style="color:#6ee7b7">📈 Lợi nhuận: ${money(profit)}</div>
                `;

                // Calculate position BEFORE showing - check if tooltip would overflow right edge
                const canvasWidth = canvas.offsetWidth;
                const tooltipWidth = 160; // Approximate tooltip width
                let tooltipX = mouseX + 15;

                // If tooltip would overflow right, show on left side of cursor
                if (mouseX + tooltipWidth + 15 > canvasWidth) {
                    tooltipX = mouseX - tooltipWidth - 10;
                }

                tooltip.style.display = 'block';
                tooltip.style.left = tooltipX + 'px';
                tooltip.style.top = (mouseY - 10) + 'px';
                tooltip.style.pointerEvents = 'none'; // Prevent tooltip from triggering mousemove
            } else {
                tooltip.style.display = 'none';
            }
        });

        canvas.addEventListener('mouseleave', () => {
            if (tooltip) tooltip.style.display = 'none';
        });
    }
}

function drawMgmtPieChart() {
    const canvas = $('mgmt-pie-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();

    // Fill container
    canvas.width = rect.width - 20;
    canvas.height = Math.max(rect.height - 20, 120);

    const w = canvas.width;
    const h = canvas.height;

    if (w <= 0 || h <= 0) return;

    ctx.clearRect(0, 0, w, h);

    // Calculate sales by category
    const { orders } = mgmtReportData;
    const catSales = {};

    orders.forEach(o => {
        (o.items || []).forEach(item => {
            const product = db.products.find(p => sameStoredId(p.id, item.id));
            const cat = product?.cat || 'Khác';
            catSales[cat] = (catSales[cat] || 0) + getInvoiceItemRevenue(item);
        });
    });

    const cats = Object.entries(catSales).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const total = cats.reduce((a, c) => a + c[1], 0);

    if (total === 0 || cats.length === 0) {
        const textColor = getComputedStyle(document.body).getPropertyValue('--text-primary').trim() || '#000';
        ctx.fillStyle = textColor;
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Chưa có dữ liệu', w / 2, h / 2);
        return;
    }

    const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

    // Scale pie chart based on container
    const r = Math.min(w * 0.2, h * 0.4, 60);
    const cx = r + 20;
    const cy = h / 2;

    if (r <= 0 || isNaN(r)) return; // Prevent negative/invalid radius

    let startAngle = -Math.PI / 2;
    cats.forEach((cat, i) => {
        const sliceAngle = (cat[1] / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, startAngle, startAngle + sliceAngle);
        ctx.closePath();
        ctx.fillStyle = colors[i % colors.length];
        ctx.fill();
        startAngle += sliceAngle;
    });

    // Legend on the right - scale with container
    const textColor = getComputedStyle(document.body).getPropertyValue('--text-primary').trim() || '#000';
    const legendX = cx + r + 20;
    const legendSpacing = Math.min(22, h / cats.length - 2);
    cats.forEach((cat, i) => {
        const y = 15 + i * legendSpacing;
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(legendX, y, 12, 12);
        ctx.fillStyle = textColor;
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'left';
        const pct = Math.round(cat[1] / total * 100);
        const shortName = cat[0].length > 10 ? cat[0].slice(0, 10) + '..' : cat[0];
        const revK = (cat[1] / 1000).toFixed(0) + 'K';
        ctx.fillText(`${shortName} ${pct}% (${revK})`, legendX + 18, y + 10);
    });
}

function renderMgmtTopProducts() {
    const topEl = $('mgmt-top-products');
    const worstEl = $('mgmt-worst-products');

    if (!topEl || !worstEl) return;

    const { orders } = mgmtReportData;

    // Aggregate product sales
    const productSales = {};
    orders.forEach(o => {
        (o.items || []).forEach(item => {
            const cost = getInvoiceItemCost(item);
            const revenue = getInvoiceItemRevenue(item);
            if (!productSales[item.id]) {
                productSales[item.id] = { id: item.id, name: item.name, qty: 0, revenue: 0, profit: 0 };
            }
            productSales[item.id].qty += item.qty || 0;
            productSales[item.id].revenue += revenue;
            productSales[item.id].profit += revenue - cost * (item.qty || 0);
        });
    });

    const products = Object.values(productSales);

    // Format money short
    const moneyShort = n => {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
        return n.toFixed(0);
    };

    // Top 15 by revenue
    const topProducts = [...products].sort((a, b) => b.revenue - a.revenue).slice(0, 15);
    topEl.innerHTML = topProducts.length ? topProducts.map((p, i) => `
        <div class="product-rank-item">
            <div class="d-flex justify-between items-center">
                <span class="product-rank-name"><span class="rank-badge rank-top">${i + 1}</span>${escapeHtml(p.name.slice(0, 20))}${p.name.length > 20 ? '..' : ''}</span>
                <span style="font-weight:700; color:var(--success); font-size:16px">${moneyShort(p.revenue)}</span>
            </div>
            <div style="font-size:13px; color:var(--text-muted); margin-left:34px; font-weight:600">
                SL: ${p.qty} · LN: ${moneyShort(p.profit)}
            </div>
        </div>
    `).join('') : '<div style="font-size:13px; color:var(--text-muted); text-align:center; padding:20px">Chưa có dữ liệu</div>';

    // Worst 15 (products with sales but low revenue)
    const worstProducts = [...products].sort((a, b) => a.revenue - b.revenue).slice(0, 15);
    worstEl.innerHTML = worstProducts.length ? worstProducts.map((p, i) => `
        <div class="product-rank-item">
            <div class="d-flex justify-between items-center">
                <span class="product-rank-name"><span class="rank-badge rank-worst">${i + 1}</span>${escapeHtml(p.name.slice(0, 20))}${p.name.length > 20 ? '..' : ''}</span>
                <span style="font-weight:700; color:var(--danger); font-size:16px">${moneyShort(p.revenue)}</span>
            </div>
            <div style="font-size:13px; color:var(--text-muted); margin-left:34px; font-weight:600">
                SL: ${p.qty} · LN: ${moneyShort(p.profit)}
            </div>
        </div>
    `).join('') : '<div style="font-size:13px; color:var(--text-muted); text-align:center; padding:20px">Chưa có dữ liệu</div>';
}

// Toggle product list expand/collapse
function toggleProductList(type) {
    const el = $('mgmt-' + type + '-products');
    const btn = document.querySelector(`[onclick="toggleProductList('${type}')"]`);
    if (el) {
        el.classList.toggle('expanded');
        if (btn) {
            btn.textContent = el.classList.contains('expanded') ? '🔼 Thu gọn' : '🔽 Mở rộng';
        }
        // Add click-to-collapse when expanded
        if (el.classList.contains('expanded')) {
            el.onclick = function (e) {
                // Only collapse if clicking on empty space (not on buttons, inputs, links)
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' ||
                    e.target.tagName === 'A' || e.target.closest('button') ||
                    e.target.closest('a') || e.target.closest('input')) {
                    return;
                }
                toggleProductList(type);
            };
            el.style.cursor = 'pointer';
        } else {
            el.onclick = null;
            el.style.cursor = '';
        }
    }
}

function exportMgmtReportExcel() {
    const dataSource = $('report-viewer-modal')?.classList.contains('active') ? reportModalData : mgmtReportData;
    const { orders, fromDate, toDate } = dataSource;

    const headers = ['Ngày', 'Mã HĐ', 'Khách hàng', 'Tổng tiền', 'Số SP'];
    const data = orders.map(o => [
        new Date(o.date || o.time).toLocaleDateString('vi-VN'),
        o.id,
        o.cust || 'Khách lẻ',
        o.total,
        o.items?.length || 0
    ]);

    const filename = `Baocao_${toLocalDateStr(fromDate)}_${toLocalDateStr(toDate)}`;
    exportToExcel(data, headers, filename, { appendDate: false });
    toast('Đã xuất Excel!');
}

function exportMgmtReportPDF() {
    const dataSource = $('report-viewer-modal')?.classList.contains('active') ? reportModalData : mgmtReportData;
    const { orders, fromDate, toDate } = dataSource;
    const revenue = orders.reduce((a, o) => a + (o.total || 0), 0);

    const content = `
        <h2 style="text-align:center; margin-bottom:20px">BÁO CÁO KINH DOANH</h2>
        <p><strong>Từ:</strong> ${fromDate.toLocaleDateString('vi-VN')} - <strong>Đến:</strong> ${toDate.toLocaleDateString('vi-VN')}</p>
        <p><strong>Tổng doanh thu:</strong> ${money(revenue)}</p>
        <p><strong>Số đơn hàng:</strong> ${orders.length}</p>
        <hr>
        <table style="width:100%; border-collapse:collapse; margin-top:20px; font-size:12px">
            <tr style="background:#f3f4f6">
                <th style="border:1px solid #ddd; padding:8px">Ngày</th>
                <th style="border:1px solid #ddd; padding:8px">Mã HĐ</th>
                <th style="border:1px solid #ddd; padding:8px">Tổng tiền</th>
            </tr>
            ${orders.slice(0, 50).map(o => `
                <tr>
                    <td style="border:1px solid #ddd; padding:6px">${new Date(o.date || o.time).toLocaleDateString('vi-VN')}</td>
                    <td style="border:1px solid #ddd; padding:6px">${escapeHtml(o.id || '')}</td>
                    <td style="border:1px solid #ddd; padding:6px; text-align:right">${money(o.total)}</td>
                </tr>
            `).join('')}
        </table>
    `;

    // Use iframe approach for Electron compatibility
    let printIframe = document.getElementById('report-print-iframe');
    if (!printIframe) {
        printIframe = document.createElement('iframe');
        printIframe.id = 'report-print-iframe';
        printIframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;border:none;background:#fff;';
        document.body.appendChild(printIframe);
    } else {
        printIframe.style.display = 'block';
    }

    const printContent = `
        <html>
        <head>
            <title>Báo cáo</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; }
                .preview-controls {
                    position: fixed; top: 0; left: 0; right: 0;
                    background: linear-gradient(135deg, #6366F1, #8B5CF6);
                    color: white; padding: 12px 20px;
                    display: flex; justify-content: space-between; align-items: center;
                    z-index: 1000;
                }
                .preview-controls button {
                    padding: 8px 16px; border: none; border-radius: 6px;
                    cursor: pointer; font-weight: 600; margin-left: 8px;
                }
                .btn-print { background: #10B981; color: white; }
                .btn-close { background: #EF4444; color: white; }
                .content-area { padding-top: 60px; }
                @media print {
                    .preview-controls { display: none !important; }
                    .content-area { padding-top: 0; }
                }
            </style>
        </head>
        <body>
            <div class="preview-controls">
                <span>📊 Báo cáo kinh doanh</span>
                <div>
                    <button class="btn-print" id="print-btn">🖨️ In</button>
                    <button class="btn-close" id="close-btn">✕</button>
                </div>
            </div>
            <div class="content-area">${content}</div>
        </body>
        </html>
    `;

    const iframeDoc = printIframe.contentDocument || printIframe.contentWindow?.document;
    if (!iframeDoc) { toast('Không thể tạo tài liệu in!', 'error'); return; }
    iframeDoc.open();
    iframeDoc.write(printContent);
    iframeDoc.close();

    setTimeout(() => {
        const printBtn = iframeDoc.getElementById('print-btn');
        const closeBtn = iframeDoc.getElementById('close-btn');

        if (printBtn) {
            printBtn.onclick = function () { printIframe.contentWindow.print(); };
        }
        if (closeBtn) {
            closeBtn.onclick = function () { printIframe.style.display = 'none'; };
        }
        printIframe.contentWindow.onafterprint = function () { printIframe.style.display = 'none'; };
    }, 100);
}

// Open in-app report viewer modal with table format
function openReportViewerModal() {
    const { orders, fromDate, toDate } = mgmtReportData;
    reportModalData = { orders: [...orders], fromDate, toDate };

    const modalFrom = $('report-modal-date-from');
    const modalTo = $('report-modal-date-to');
    const modalLabel = $('report-modal-date-filter-label');
    if (modalFrom) modalFrom.value = toLocalDateStr(fromDate);
    if (modalTo) modalTo.value = toLocalDateStr(toDate);
    if (modalLabel) {
        const mainLabel = $('mgmt-date-filter-label')?.textContent?.replace(/^📅\s*/, '');
        modalLabel.textContent = mainLabel || `${fromDate.toLocaleDateString('vi-VN')} - ${toDate.toLocaleDateString('vi-VN')}`;
    }
    document.querySelectorAll('#report-modal-date-filter-menu .date-preset-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Calculate totals
    const revenue = orders.reduce((a, o) => a + (o.total || 0), 0);
    let totalCost = 0;
    let totalProfit = 0;

    orders.forEach(o => {
        const orderCost = getInvoiceCost(o);
        totalCost += orderCost;
        totalProfit += (o.total || 0) - orderCost;
    });

    const content = $('report-viewer-content');
    if (!content) return;

    content.innerHTML = `
        <div style="margin-bottom:20px; padding:16px; background:var(--bg-muted); border-radius:12px;">
            <h3 style="margin:0 0 12px 0; color:var(--primary);">📊 Báo cáo từ ${fromDate.toLocaleDateString('vi-VN')} đến ${toDate.toLocaleDateString('vi-VN')}</h3>
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:16px;">
                <div style="background:var(--bg-main); padding:12px; border-radius:8px; text-align:center;">
                    <div style="font-size:12px; color:var(--text-muted);">Doanh thu</div>
                    <div style="font-size:18px; font-weight:700; color:var(--primary);">${money(revenue)}</div>
                </div>
                <div style="background:var(--bg-main); padding:12px; border-radius:8px; text-align:center;">
                    <div style="font-size:12px; color:var(--text-muted);">Giá vốn</div>
                    <div style="font-size:18px; font-weight:700; color:#b45309;">${money(totalCost)}</div>
                </div>
                <div style="background:var(--bg-main); padding:12px; border-radius:8px; text-align:center;">
                    <div style="font-size:12px; color:var(--text-muted);">Lợi nhuận</div>
                    <div style="font-size:18px; font-weight:700; color:#047857;">${money(totalProfit)}</div>
                </div>
                <div style="background:var(--bg-main); padding:12px; border-radius:8px; text-align:center;">
                    <div style="font-size:12px; color:var(--text-muted);">Số đơn</div>
                    <div style="font-size:18px; font-weight:700;">${orders.length}</div>
                </div>
            </div>
        </div>
        <div style="font-size:11px; color:var(--text-muted); margin-bottom:8px; font-style:italic;">💡 Click vào đơn hàng để xem chi tiết sản phẩm</div>
        <div class="table-wrap" style="max-height:400px; overflow-y:auto;">
            <table style="width:100%; font-size:13px; table-layout:fixed;">
                <thead>
                    <tr>
                        <th style="position:sticky;top:0;background:var(--bg-muted);z-index:1;width:30px;"></th>
                        <th style="position:sticky;top:0;background:var(--bg-muted);z-index:1;width:80px;">Ngày</th>
                        <th style="position:sticky;top:0;background:var(--bg-muted);z-index:1;width:80px;">Mã HĐ</th>
                        <th style="position:sticky;top:0;background:var(--bg-muted);z-index:1;">Khách hàng</th>
                        <th style="position:sticky;top:0;background:var(--bg-muted);z-index:1;width:60px;text-align:center;">Số SP</th>
                        <th style="position:sticky;top:0;background:var(--bg-muted);z-index:1;width:100px;text-align:right;">Doanh thu</th>
                        <th style="position:sticky;top:0;background:var(--bg-muted);z-index:1;width:100px;text-align:right;">Giá vốn</th>
                        <th style="position:sticky;top:0;background:var(--bg-muted);z-index:1;width:100px;text-align:right;">Lợi nhuận</th>
                    </tr>
                </thead>
                <tbody>
                    ${orders.sort((a, b) => new Date(b.date || b.time) - new Date(a.date || a.time)).map(o => {
        const orderCost = getInvoiceCost(o);
        const orderProfit = (o.total || 0) - orderCost;
        const orderIdAttr = escapeAttr(String(o.id ?? ''));
        const orderIdJs = escapeJsArgument(o.id);

        // Generate product details HTML for expandable row
        const productDetailsHtml = (o.items || []).map(item => {
            const itemRevenue = getInvoiceItemRevenue(item);
            const itemCost = getInvoiceItemCost(item) * (item.qty || 0);
            const itemProfit = itemRevenue - itemCost;
            return `<tr style="background:var(--primary-light); font-size:12px;">
                <td style="padding:4px 8px;"></td>
                <td style="padding:4px 8px;"></td>
                <td style="padding:4px 8px;"></td>
                <td style="padding:4px 8px;"><span style="color:var(--text-muted);">↳</span> ${escapeHtml(item.name || 'Sản phẩm')}</td>
                <td style="padding:4px 8px; text-align:center;">${item.qty || 0}</td>
                <td style="padding:4px 8px; color:#4338ca; text-align:right;">${money(itemRevenue)}</td>
                <td style="padding:4px 8px; color:#b45309; text-align:right;">${money(itemCost)}</td>
                <td style="padding:4px 8px; color:#047857; text-align:right;">${money(itemProfit)}</td>
            </tr>`;
        }).join('');

        return `<tr class="report-order-row" onclick="toggleReportOrderDetails(${orderIdJs})" style="cursor:pointer; transition:background 0.15s;" onmouseover="this.style.background='var(--bg-muted)'" onmouseout="this.style.background=''">
                            <td style="text-align:center;"><span class="expand-icon" id="expand-icon-${orderIdAttr}">▶</span></td>
                            <td>${new Date(o.date || o.time).toLocaleDateString('vi-VN')}</td>
                            <td><code>#${escapeHtml(String(o.id ?? '').slice(-6))}</code></td>
                            <td>${escapeHtml(o.cust || 'Khách lẻ')}</td>
                            <td style="text-align:center;">${o.items?.length || 0}</td>
                            <td style="color:#4338ca;font-weight:700;text-align:right;">${money(o.total)}</td>
                            <td style="color:#b45309;font-weight:600;text-align:right;">${money(orderCost)}</td>
                            <td style="color:#047857;font-weight:700;text-align:right;">${money(orderProfit)}</td>
                        </tr>
                        ${productDetailsHtml ? `<tbody class="order-details-row" id="order-details-${orderIdAttr}" style="display:none;">${productDetailsHtml}</tbody>` : ''}`;
    }).join('')}
                </tbody>
            </table>
        </div>
    `;

    $('report-viewer-modal').classList.add('active');
}

// Refresh report modal content when date filter is changed inside the modal
function refreshReportModalContent(fromDate, toDate) {
    // Set end of day for toDate
    const from = new Date(fromDate);
    from.setHours(0, 0, 0, 0);
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);

    // Filter orders by date range
    const orders = db.invoices.filter(inv => {
        const d = new Date(inv.date || inv.time);
        return d >= from && d <= to;
    });
    reportModalData = { orders, fromDate: from, toDate: to };

    // Calculate totals
    const revenue = orders.reduce((a, o) => a + (o.total || 0), 0);
    let totalCost = 0;
    let totalProfit = 0;

    orders.forEach(o => {
        const orderCost = getInvoiceCost(o);
        totalCost += orderCost;
        totalProfit += (o.total || 0) - orderCost;
    });

    const content = $('report-viewer-content');
    if (!content) return;

    content.innerHTML = `
        <div style="margin-bottom:20px; padding:16px; background:var(--bg-muted); border-radius:12px;">
            <h3 style="margin:0 0 12px 0; color:var(--primary);">📊 Báo cáo từ ${from.toLocaleDateString('vi-VN')} đến ${to.toLocaleDateString('vi-VN')}</h3>
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:16px;">
                <div style="background:var(--bg-main); padding:12px; border-radius:8px; text-align:center;">
                    <div style="font-size:12px; color:var(--text-muted);">Doanh thu</div>
                    <div style="font-size:18px; font-weight:700; color:var(--primary);">${money(revenue)}</div>
                </div>
                <div style="background:var(--bg-main); padding:12px; border-radius:8px; text-align:center;">
                    <div style="font-size:12px; color:var(--text-muted);">Giá vốn</div>
                    <div style="font-size:18px; font-weight:700; color:#b45309;">${money(totalCost)}</div>
                </div>
                <div style="background:var(--bg-main); padding:12px; border-radius:8px; text-align:center;">
                    <div style="font-size:12px; color:var(--text-muted);">Lợi nhuận</div>
                    <div style="font-size:18px; font-weight:700; color:#047857;">${money(totalProfit)}</div>
                </div>
                <div style="background:var(--bg-main); padding:12px; border-radius:8px; text-align:center;">
                    <div style="font-size:12px; color:var(--text-muted);">Số đơn</div>
                    <div style="font-size:18px; font-weight:700;">${orders.length}</div>
                </div>
            </div>
        </div>
        <div style="font-size:11px; color:var(--text-muted); margin-bottom:8px; font-style:italic;">💡 Click vào đơn hàng để xem chi tiết sản phẩm</div>
        <div class="table-wrap" style="max-height:450px; overflow-y:auto;">
            <table style="width:100%; font-size:13px; table-layout:fixed;">
                <thead>
                    <tr>
                        <th style="position:sticky;top:0;background:var(--bg-muted);z-index:1;width:30px;"></th>
                        <th style="position:sticky;top:0;background:var(--bg-muted);z-index:1;width:80px;">Ngày</th>
                        <th style="position:sticky;top:0;background:var(--bg-muted);z-index:1;width:80px;">Mã HĐ</th>
                        <th style="position:sticky;top:0;background:var(--bg-muted);z-index:1;">Khách hàng</th>
                        <th style="position:sticky;top:0;background:var(--bg-muted);z-index:1;width:60px;text-align:center;">Số SP</th>
                        <th style="position:sticky;top:0;background:var(--bg-muted);z-index:1;width:100px;text-align:right;">Doanh thu</th>
                        <th style="position:sticky;top:0;background:var(--bg-muted);z-index:1;width:100px;text-align:right;">Giá vốn</th>
                        <th style="position:sticky;top:0;background:var(--bg-muted);z-index:1;width:100px;text-align:right;">Lợi nhuận</th>
                    </tr>
                </thead>
                <tbody>
                    ${orders.length === 0 ? '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-muted);">Không có dữ liệu trong khoảng thời gian này</td></tr>' : orders.sort((a, b) => new Date(b.date || b.time) - new Date(a.date || a.time)).map(o => {
        const orderCost = getInvoiceCost(o);
        const orderProfit = (o.total || 0) - orderCost;
        const orderIdAttr = escapeAttr(String(o.id ?? ''));
        const orderIdJs = escapeJsArgument(o.id);

        // Generate product details HTML for expandable row
        const productDetailsHtml = (o.items || []).map(item => {
            const itemRevenue = getInvoiceItemRevenue(item);
            const itemCost = getInvoiceItemCost(item) * (item.qty || 0);
            const itemProfit = itemRevenue - itemCost;
            return `<tr style="background:var(--primary-light); font-size:12px;">
                <td style="padding:4px 8px;"></td>
                <td style="padding:4px 8px;"></td>
                <td style="padding:4px 8px;"></td>
                <td style="padding:4px 8px;"><span style="color:var(--text-muted);">↳</span> ${escapeHtml(item.name || 'Sản phẩm')}</td>
                <td style="padding:4px 8px; text-align:center;">${item.qty || 0}</td>
                <td style="padding:4px 8px; color:#4338ca; text-align:right;">${money(itemRevenue)}</td>
                <td style="padding:4px 8px; color:#b45309; text-align:right;">${money(itemCost)}</td>
                <td style="padding:4px 8px; color:#047857; text-align:right;">${money(itemProfit)}</td>
            </tr>`;
        }).join('');

        return `<tr class="report-order-row" onclick="toggleReportOrderDetails(${orderIdJs})" style="cursor:pointer; transition:background 0.15s;" onmouseover="this.style.background='var(--bg-muted)'" onmouseout="this.style.background=''">
                            <td style="text-align:center;"><span class="expand-icon" id="expand-icon-${orderIdAttr}">▶</span></td>
                            <td>${new Date(o.date || o.time).toLocaleDateString('vi-VN')}</td>
                            <td><code>#${escapeHtml(String(o.id ?? '').slice(-6))}</code></td>
                            <td>${escapeHtml(o.cust || 'Khách lẻ')}</td>
                            <td style="text-align:center;">${o.items?.length || 0}</td>
                            <td style="color:#4338ca;font-weight:700;text-align:right;">${money(o.total)}</td>
                            <td style="color:#b45309;font-weight:600;text-align:right;">${money(orderCost)}</td>
                            <td style="color:#047857;font-weight:700;text-align:right;">${money(orderProfit)}</td>
                        </tr>
                        ${productDetailsHtml ? `<tbody class="order-details-row" id="order-details-${orderIdAttr}" style="display:none;">${productDetailsHtml}</tbody>` : ''}`;
    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// Toggle order details in report modal
function toggleReportOrderDetails(orderId) {
    const detailsRow = document.getElementById('order-details-' + orderId);
    const expandIcon = document.getElementById('expand-icon-' + orderId);

    if (!detailsRow) return;

    if (detailsRow.style.display === 'none') {
        detailsRow.style.display = 'table-row-group';
        if (expandIcon) expandIcon.textContent = '▼';
        // Add click-to-collapse when expanded
        detailsRow.onclick = function (e) {
            // Only collapse if clicking on empty space (not on buttons, inputs, links)
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' ||
                e.target.tagName === 'A' || e.target.closest('button') ||
                e.target.closest('a') || e.target.closest('input')) {
                return;
            }
            toggleReportOrderDetails(orderId);
        };
        detailsRow.style.cursor = 'pointer';
    } else {
        detailsRow.style.display = 'none';
        if (expandIcon) expandIcon.textContent = '▶';
        detailsRow.onclick = null;
        detailsRow.style.cursor = '';
    }
}

// Apply settings permissions based on user role
function applySettingsPermissions() {
    const role = currUser?.role || 'staff';

    // Settings sections visibility based on user request:
    // Staff can VIEW (read-only): store info, hardware, label printer, barcode scanner, shortcuts
    // Staff CANNOT see: payment QR, UI/data, loyalty, user management, danger zone
    const sections = {
        'store-info-section': ['admin', 'manager', 'staff'], // All can view
        'hardware-section': ['admin', 'manager', 'staff'], // All can view
        'label-printer-section': ['admin', 'manager', 'staff'], // All can view
        'barcode-section': ['admin', 'manager', 'staff'], // All can view
        'shortcuts-section': ['admin', 'manager', 'staff'], // Staff can view for reference
        'payment-qr-section': ['admin', 'manager'], // Admin & Manager only
        'ui-data-section': ['admin', 'manager'], // Admin & Manager only
        'loyalty-section': ['admin', 'manager'], // Admin & Manager only
        'user-management-section': ['admin', 'manager'], // Admin & Manager only
        'danger-zone-section': ['admin'] // Admin only
    };

    Object.entries(sections).forEach(([sectionId, roles]) => {
        const section = $(sectionId);
        if (section) {
            section.style.display = roles.includes(role) ? '' : 'none';
        }
    });

    // Make settings read-only for staff
    if (role === 'staff') {
        // Disable all inputs in visible settings sections
        const inputs = document.querySelectorAll('#settings-view input, #settings-view select, #settings-view textarea');
        inputs.forEach(input => {
            // Don't disable inputs in change password modal
            if (!input.closest('#change-password-modal')) {
                input.disabled = true;
            }
        });

        // Hide all save/action buttons except change password
        document.querySelectorAll('#settings-view .btn').forEach(btn => {
            const btnText = btn.textContent || '';
            const onclick = btn.getAttribute('onclick') || '';

            // Keep only the change password button visible
            if (onclick.includes('openChangePasswordModal') ||
                onclick.includes('changeOwnPassword') ||
                onclick.includes('closeModal') ||
                btnText.includes('Đổi mật khẩu')) {
                btn.style.display = '';
            } else {
                btn.style.display = 'none';
            }
        });

        // Show staff password section for staff
        const staffPassSection = $('staff-password-section');
        if (staffPassSection) staffPassSection.style.display = 'block';

        // Show change password button for staff
        const changePassBtn = $('change-pass-btn');
        if (changePassBtn) changePassBtn.style.display = 'inline-block';

        // Hide save-all button
        document.querySelectorAll('#settings-view .btn-success.btn-lg').forEach(btn => {
            if (btn.textContent.includes('LƯU TẤT')) {
                btn.style.display = 'none';
            }
        });
    } else {
        // Re-enable for admin/manager
        const inputs = document.querySelectorAll('#settings-view input, #settings-view select, #settings-view textarea');
        inputs.forEach(input => {
            if (input.id !== 'u-code') { // Keep employee code readonly
                input.disabled = false;
            }
        });

        document.querySelectorAll('#settings-view .btn').forEach(btn => {
            btn.style.display = '';
        });

        // Hide staff password section for admin/manager
        const staffPassSection = $('staff-password-section');
        if (staffPassSection) staffPassSection.style.display = 'none';
    }
}

// Open change password modal for staff
function openChangePasswordModal() {
    $('change-password-modal')?.classList.add('active');
    if ($('own-old-pass')) $('own-old-pass').value = '';
    if ($('own-new-pass')) $('own-new-pass').value = '';
    if ($('own-confirm-pass')) $('own-confirm-pass').value = '';
}

// UTILITIES
function toast(m, t = "success", dedupe = true) {
    // Deduplication: if message already shown in this session, skip
    let dedupeKey = m;
    // Normalize stock-related messages to prevent duplicates for same product
    const stockPatterns = [
        /Bán âm kho: .+ \(Tồn: [\-\d]+\)/,
        /Vượt tồn kho: .+ \(Tồn: [\-\d]+, Bán: \d+\)/
    ];
    for (const pattern of stockPatterns) {
        if (pattern.test(m)) {
            // Extract product name only for deduplication
            dedupeKey = m.replace(/\(Tồn: [\-\d]+(?:, Bán: \d+)?\)/, '(stock_warning)');
            break;
        }
    }

    if (dedupe && shownToastMessages.has(dedupeKey)) {
        return; // Already shown this message in current session
    }

    if (dedupe) {
        shownToastMessages.add(dedupeKey);
    }

    const d = document.createElement('div');
    d.className = `toast ${t}`;
    d.innerHTML = `${t === 'success' ? '✅' : t === 'error' ? '❌' : t === 'warning' ? '⚠️' : 'ℹ️'} ${escapeHtml(m)}`;
    $('toast-box')?.appendChild(d);
    setTimeout(() => d.remove(), 3500);
}

function openModal(id) { $(id)?.classList.add('active'); }
function closeModal(id) {
    if (id === 'login-modal' && !isAuthenticated) return;
    $(id)?.classList.remove('active');
}

function compress(inp, cb) {
    const f = inp.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = e => {
        const i = new Image();
        i.src = e.target.result;
        i.onload = () => {
            const c = document.createElement('canvas');
            const x = c.getContext('2d');
            const m = 300;
            let w = i.width, h = i.height;
            if (w > h) { if (w > m) { h *= m / w; w = m; } }
            else { if (h > m) { w *= m / h; h = m; } }
            c.width = w; c.height = h;
            x.drawImage(i, 0, 0, w, h);
            cb(c.toDataURL('image/jpeg', 0.8));
        };
    };
    r.readAsDataURL(f);
}

// EXCEL & PDF EXPORT FUNCTIONS

function exportToExcel(data, headers, filename, options = {}) {
    if (!data || data.length === 0) {
        toast("Không có dữ liệu để xuất!", "warning");
        return;
    }
    if (!XLSX) {
        toast("Thư viện Excel không khả dụng!", "error");
        return;
    }

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Báo cáo');
    const workbookData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true });
    const blob = new Blob([workbookData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const baseName = String(filename || 'BaoCao').replace(/\.(xlsx|xls|csv)$/i, '');
    const suffix = options.appendDate === false ? '' : `_${toLocalDateStr(getAppDate())}`;
    const downloadName = `${baseName}${suffix}.xlsx`;

    link.setAttribute('href', url);
    link.setAttribute('download', downloadName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast("Đã xuất Excel thành công!", "success");
    logActivity('Xuất Excel', downloadName);
}

function exportHistoryExcel() {
    // Use YouTube-style date filter (same as renderHist)
    const fromInput = $('hist-date-from');
    const toInput = $('hist-date-to');
    let s, e;

    if (fromInput && fromInput.value) {
        s = parseLocalDateInput(fromInput.value);
    } else {
        s = getAppDate();
        s.setHours(0, 0, 0, 0);
    }

    if (toInput && toInput.value) {
        e = parseLocalDateInput(toInput.value, true);
    } else {
        e = getAppDate();
        e.setHours(23, 59, 59, 999);
    }

    const list = db.invoices.filter(i => {
        const d = new Date(i.date);
        return d >= s && d <= e;
    });

    const headers = ['Mã HĐ', 'Thời gian', 'Khách hàng', 'Số SP', 'Tổng tiền', 'Giảm giá', 'Thanh toán', 'Thu ngân', 'Ghi chú'];
    const data = list.map(i => [
        '#' + String(i.id ?? '').slice(-6),
        new Date(i.date).toLocaleString('vi-VN'),
        i.cust,
        i.items.length,
        i.total,
        i.discount || 0,
        i.method,
        i.staff || '',
        i.note || ''
    ]);

    exportToExcel(data, headers, 'LichSuDonHang');
}

function exportReturnsHistoryExcel() {
    const { list } = getFilteredReturnsHistory();
    const headers = ['Mã phiếu', 'Thời gian', 'Khách hàng', 'Số SP trả', 'Số SP đổi', 'Hoàn trả', 'Thu thêm', 'Chênh lệch', 'Nhân viên'];
    const data = list.map(record => {
        const { difference } = getReturnDisplayTotals(record);
        return [
            '#' + String(record.id ?? '').slice(-6),
            new Date(record.date).toLocaleString('vi-VN'),
            record.customer?.name || record.cust || 'Khách lẻ',
            (record.returnItems || record.items || []).length,
            (record.exchangeItems || []).length,
            difference > 0 ? difference : 0,
            difference < 0 ? Math.abs(difference) : 0,
            difference,
            record.staff || ''
        ];
    });
    exportToExcel(data, headers, 'LichSuDoiTra');
}

function exportProductsExcel() {
    const filtered = getFilteredProductsForTable();

    const headers = ['Mã', 'Tên sản phẩm', 'Danh mục', 'Giá bán', 'Giá vốn', 'Tồn kho', 'Đơn vị', 'Trạng thái'];
    const data = filtered.map(p => {
        const status = getProductStatusLabel(getProductStockStatus(p));

        return [
            p.code || '',
            p.name,
            p.cat || '',
            p.price,
            p.cost || 0,
            p.stock,
            p.unit || '',
            status
        ];
    });

    exportToExcel(data, headers, 'DanhSachSanPham');
}

function exportCustomersExcel() {
    const search = ($('cust-search')?.value || '').toLowerCase();
    const filtered = db.custs.filter(c => c.name.toLowerCase().includes(search) || (c.phone || '').includes(search));

    const groupLabels = { normal: 'Thường', silver: 'Bạc', gold: 'Vàng', vip: 'VIP' };
    const headers = ['Tên khách hàng', 'Nhóm', 'Điện thoại', 'Địa chỉ', 'Email', 'Điểm tích lũy', 'Công nợ', 'Tổng mua'];
    const data = filtered.map(c => [
        c.name,
        groupLabels[c.group] || c.group || 'Thường',
        c.phone || '',
        c.addr || '',
        c.email || '',
        c.points || 0,
        c.debt || 0,
        c.totalBuy || 0
    ]);

    exportToExcel(data, headers, 'DanhSachKhachHang');
}

function exportInvoicePDF(invoiceId) {
    const inv = invoiceId ? db.invoices.find(x => sameStoredId(x.id, invoiceId)) : currentInvoice;
    if (!inv) {
        toast("Không tìm thấy hóa đơn!", "error");
        return;
    }

    const s = db.settings;
    const d = new Date(inv.date);
    const tm = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    const invoiceDisplayId = escapeHtml(String(inv.id || '').slice(-6));
    const safeStoreName = escapeHtml(s.name || '');
    const safeCustomer = escapeHtml(inv.cust || 'Khách lẻ');
    const safeStaff = escapeHtml(inv.staff || '-');
    const safeMethod = escapeHtml(inv.method === 'CASH' ? '💵 Tiền mặt' : inv.method === 'CK' ? '🏦 Chuyển khoản' : '💳 ' + (inv.method || '-'));
    const safeFooter = escapeHtml(s.footer || 'Cảm ơn quý khách!');

    const html = `
        <div class="p-page" style="font-family: Arial, sans-serif; padding: 30px; max-width: 600px; margin: 0 auto; background: white;">
            <div style="text-align: center; margin-bottom: 25px; border-bottom: 2px solid #E2E8F0; padding-bottom: 20px;">
                <h1 style="margin: 0; color: #1E293B; font-size: 24px;">${safeStoreName}</h1>
                <p style="color: #64748B; margin: 5px 0; font-size: 14px;">${escapeHtml(s.addr || '')}</p>
                ${s.phone ? `<p style="color: #64748B; margin: 3px 0; font-size: 13px;">ĐT: ${escapeHtml(s.phone)}</p>` : ''}
            </div>
            
            <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="margin: 0; color: #6366F1; font-size: 20px;">HÓA ĐƠN BÁN HÀNG</h2>
                <p style="color: #94A3B8; font-size: 28px; font-weight: bold; margin: 10px 0;">#${invoiceDisplayId}</p>
            </div>
            
            <div style="background: #F8FAFC; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="color: #64748B;">Thời gian:</span>
                    <strong style="color: #1E293B;">${tm}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="color: #64748B;">Khách hàng:</span>
                    <strong style="color: #1E293B;">${safeCustomer}</strong>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: #64748B;">Thu ngân:</span>
                    <strong style="color: #1E293B;">${safeStaff}</strong>
                </div>
            </div>
            
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <thead>
                    <tr style="background: #F1F5F9;">
                        <th style="padding: 12px; text-align: left; border-bottom: 2px solid #E2E8F0; font-size: 13px;">Sản phẩm</th>
                        <th style="padding: 12px; text-align: center; border-bottom: 2px solid #E2E8F0; font-size: 13px; width: 60px;">SL</th>
                        <th style="padding: 12px; text-align: right; border-bottom: 2px solid #E2E8F0; font-size: 13px; width: 100px;">Đơn giá</th>
                        <th style="padding: 12px; text-align: right; border-bottom: 2px solid #E2E8F0; font-size: 13px; width: 110px;">Thành tiền</th>
                    </tr>
                </thead>
                <tbody>
                    ${(inv.items || []).map(i => `
                        <tr>
                            <td style="padding: 10px; border-bottom: 1px solid #E2E8F0;">${escapeHtml(i.name || 'Sản phẩm')}</td>
                            <td style="padding: 10px; text-align: center; border-bottom: 1px solid #E2E8F0;">${escapeHtml(formatQty(i.qty))}</td>
                            <td style="padding: 10px; text-align: right; border-bottom: 1px solid #E2E8F0;">${money(i.price)}</td>
                            <td style="padding: 10px; text-align: right; border-bottom: 1px solid #E2E8F0; font-weight: 600;">${money(getInvoiceItemRevenue(i))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            
            <div style="background: #F8FAFC; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="color: #64748B;">Tạm tính:</span>
                    <span style="color: #1E293B;">${money(inv.subtotal)}</span>
                </div>
                ${inv.discount > 0 ? `
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="color: #64748B;">Giảm giá:</span>
                    <span style="color: #EF4444;">-${money(inv.discount)}</span>
                </div>` : ''}
                ${inv.pointsValue ? `
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="color: #64748B;">Điểm (${inv.pointsUsed} điểm):</span>
                    <span style="color: #EF4444;">-${money(inv.pointsValue)}</span>
                </div>` : ''}
                <div style="display: flex; justify-content: space-between; border-top: 2px dashed #E2E8F0; padding-top: 12px; margin-top: 8px;">
                    <strong style="color: #1E293B; font-size: 18px;">TỔNG CỘNG:</strong>
                    <strong style="color: #6366F1; font-size: 22px;">${money(inv.total)}</strong>
                </div>
            </div>
            
            <div style="background: #ECFDF5; padding: 12px; border-radius: 8px; margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span style="color: #059669;">Khách đưa:</span>
                    <strong style="color: #059669;">${money(inv.given)}</strong>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: #059669;">Tiền thừa:</span>
                    <strong style="color: #059669;">${money(inv.change)}</strong>
                </div>
            </div>
            
            <div style="display: flex; justify-content: space-between; margin-bottom: 20px; padding: 10px; background: #F1F5F9; border-radius: 6px;">
                <span style="color: #64748B;">Phương thức thanh toán:</span>
                <strong style="color: #1E293B;">${safeMethod}</strong>
            </div>
            
            ${inv.note ? `
            <div style="background: #FEF3C7; padding: 12px; border-radius: 8px; margin-bottom: 20px;">
                <strong style="color: #92400E;">Ghi chú:</strong>
                <span style="color: #92400E;"> ${escapeHtml(inv.note)}</span>
            </div>` : ''}
            
            ${s.qr && s.num ? `
            <div style="text-align: center; padding: 15px; border: 1px dashed #E2E8F0; border-radius: 8px; margin-bottom: 20px;">
                <p style="font-style: italic; color: #64748B; font-size: 12px; margin: 0 0 10px;">Quét QR để thanh toán</p>
                <img src="${escapeAttr(safeImageSrc(s.qr))}" style="max-width: 120px; max-height: 120px; margin-bottom: 10px;">
                <p style="font-weight: bold; margin: 5px 0; color: #1E293B;">${escapeHtml(s.bank || '')}</p>
                <p style="margin: 3px 0; color: #64748B;">${escapeHtml(s.num || '')} - ${escapeHtml(s.owner || '')}</p>
            </div>` : ''}
            
            <div style="text-align: center; color: #94A3B8; font-size: 12px; border-top: 1px solid #E2E8F0; padding-top: 15px;">
                <p style="font-style: italic; margin: 0;">${safeFooter}</p>
                <p style="margin: 8px 0 0; font-size: 11px;">In vào: ${getAppDate().toLocaleString('vi-VN')}</p>
            </div>
        </div>
    `;

    // Use iframe approach for Electron compatibility instead of window.print()
    let printIframe = document.getElementById('invoice-pdf-print-iframe');
    if (!printIframe) {
        printIframe = document.createElement('iframe');
        printIframe.id = 'invoice-pdf-print-iframe';
        printIframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;border:none;background:#fff;';
        document.body.appendChild(printIframe);
    } else {
        printIframe.style.display = 'block';
    }

    const printContent = `<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Hóa đơn #${invoiceDisplayId}</title>
    <style>
        @page { size: A4; margin: 15mm; }
        body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
        .preview-controls {
            position: fixed; top: 0; left: 0; right: 0;
            background: linear-gradient(135deg, #6366F1, #8B5CF6);
            color: white; padding: 12px 20px;
            display: flex; justify-content: space-between; align-items: center;
            z-index: 1000;
        }
        .preview-controls button {
            padding: 8px 16px; border: none; border-radius: 6px;
            cursor: pointer; font-weight: 600; margin-left: 8px;
        }
        .btn-print { background: #10B981; color: white; }
        .btn-close { background: #EF4444; color: white; }
        @media print {
            .preview-controls { display: none !important; }
        }
        @media screen {
            body { background: #f5f5f5; padding: 60px 20px 20px; }
            .p-page { background: white; box-shadow: 0 2px 10px rgba(0,0,0,0.1); border-radius: 8px; }
        }
    </style>
    </head><body>
    <div class="preview-controls">
        <span>📄 Hóa đơn A4 #${invoiceDisplayId}</span>
        <div>
            <button class="btn-print" id="print-btn">🖨️ In</button>
            <button class="btn-close" id="close-btn">✕ Đóng</button>
        </div>
    </div>
    ${html}
    </body></html>`;

    const iframeDoc = printIframe.contentDocument || printIframe.contentWindow?.document;
    if (!iframeDoc) { toast('Không thể tạo tài liệu in!', 'error'); return; }
    iframeDoc.open();
    iframeDoc.write(printContent);
    iframeDoc.close();

    setTimeout(() => {
        const printBtn = iframeDoc.getElementById('print-btn');
        const closeBtn = iframeDoc.getElementById('close-btn');
        if (printBtn) printBtn.onclick = () => printIframe.contentWindow.print();
        if (closeBtn) closeBtn.onclick = () => printIframe.style.display = 'none';
        printIframe.contentWindow.onafterprint = () => printIframe.style.display = 'none';
    }, 100);

    logActivity('Xuất PDF', `Hóa đơn #${inv.id.slice(-6)}`);
}

function exportStockHistoryExcel() {
    const filter = $('stock-filter')?.value || 'all';
    let list = db.stockHistory || [];
    if (filter !== 'all') list = list.filter(h => h.type === filter);

    const typeLabels = { in: 'Nhập kho', out: 'Xuất kho', adjust: 'Điều chỉnh' };
    const headers = ['Thời gian', 'Loại', 'Sản phẩm', 'Số lượng', 'Giá', 'Tổng tiền', 'Ghi chú', 'Người thực hiện'];
    const data = list.map(h => [
        new Date(h.date).toLocaleString('vi-VN'),
        typeLabels[h.type] || h.type,
        h.productName,
        h.type === 'out' ? -h.qty : h.qty,
        h.price || 0,
        h.total || 0,
        h.note || '',
        h.user || ''
    ]);

    exportToExcel(data, headers, 'LichSuKho');
}

// ========== PDF EXPORT FUNCTIONS FOR LISTS (A4 FORMAT) ==========

// Helper function to open print window with A4 landscape format - FIXED for Electron
function openA4PrintWindow(title, content) {
    // Use iframe approach for Electron compatibility
    const safeTitle = escapeHtml(title || '');
    let printIframe = document.getElementById('a4-print-iframe');
    if (!printIframe) {
        printIframe = document.createElement('iframe');
        printIframe.id = 'a4-print-iframe';
        printIframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;border:none;background:#fff;';
        document.body.appendChild(printIframe);
    } else {
        printIframe.style.display = 'block';
    }

    const printContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${safeTitle}</title>
            <style>
                @page { size: A4 landscape; margin: 15mm; }
                body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; padding: 20px; }
                /* Preview controls */
                .preview-controls {
                    position: fixed; top: 0; left: 0; right: 0;
                    background: linear-gradient(135deg, #6366F1, #8B5CF6);
                    color: white; padding: 12px 20px;
                    display: flex; justify-content: space-between; align-items: center;
                    z-index: 1000; font-size: 14px;
                }
                .preview-controls button {
                    padding: 8px 16px; border: none; border-radius: 6px;
                    cursor: pointer; font-weight: 600; margin-left: 8px;
                }
                .btn-print { background: #10B981; color: white; }
                .btn-close { background: #EF4444; color: white; }
                .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 15px; }
                .header h1 { margin: 0; font-size: 22px; color: #1E293B; }
                .header h2 { margin: 10px 0 5px; font-size: 18px; color: #6366F1; }
                .header p { color: #666; margin: 5px 0; font-size: 12px; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                th { background: #F1F5F9; padding: 10px 8px; text-align: left; border: 1px solid #E2E8F0; font-weight: 600; font-size: 11px; }
                td { padding: 8px; border: 1px solid #E2E8F0; font-size: 11px; }
                tr:nth-child(even) { background: #F8FAFC; }
                .footer { text-align: center; color: #888; font-size: 10px; margin-top: 20px; border-top: 1px solid #E2E8F0; padding-top: 10px; }
                .stats { display: flex; gap: 20px; margin-bottom: 20px; }
                .stat-box { flex: 1; background: #F8FAFC; padding: 15px; border-radius: 8px; text-align: center; border: 1px solid #E2E8F0; }
                .stat-box .label { font-size: 11px; color: #64748B; }
                .stat-box .value { font-size: 18px; font-weight: bold; color: #1E293B; margin-top: 5px; }
                .text-right { text-align: right; }
                .text-center { text-align: center; }
                .text-success { color: #10B981; }
                .text-warning { color: #F59E0B; }
                .text-danger { color: #EF4444; }
                .content-area { padding-top: 60px; }
                @media print {
                    .preview-controls { display: none !important; }
                    .content-area { padding-top: 0; }
                    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
                }
            </style>
        </head>
        <body>
            <div class="preview-controls">
                <span>📄 ${safeTitle}</span>
                <div>
                    <button class="btn-print" id="print-btn">🖨️ In</button>
                    <button class="btn-close" id="close-btn">✕</button>
                </div>
            </div>
            <div class="content-area">
                ${content}
            </div>
        </body>
        </html>
    `;

    const iframeDoc = printIframe.contentDocument || printIframe.contentWindow?.document;
    if (!iframeDoc) { toast('Không thể tạo tài liệu in!', 'error'); return; }
    iframeDoc.open();
    iframeDoc.write(printContent);
    iframeDoc.close();

    setTimeout(() => {
        const printBtn = iframeDoc.getElementById('print-btn');
        const closeBtn = iframeDoc.getElementById('close-btn');

        if (printBtn) {
            printBtn.onclick = function () {
                printIframe.contentWindow.print();
            };
        }
        if (closeBtn) {
            closeBtn.onclick = function () {
                printIframe.style.display = 'none';
            };
        }

        printIframe.contentWindow.onafterprint = function () {
            printIframe.style.display = 'none';
        };
    }, 100);
}

// Export Products to PDF (A4 Landscape)
function exportProductsPDF() {
    const filtered = getFilteredProductsForTable();

    if (filtered.length === 0) {
        toast("Không có dữ liệu để xuất!", "warning");
        return;
    }

    const lowStock = db.settings.lowStock || 5;
    const totalValue = filtered.reduce((sum, p) => sum + (p.price * p.stock), 0);
    const outOfStock = filtered.filter(p => p.stock <= 0).length;
    const lowStockCount = filtered.filter(p => p.stock > 0 && p.stock <= lowStock).length;

    const content = `
        <div class="header">
            <h1>${escapeHtml(db.settings.name || '')}</h1>
            <h2>📦 DANH SÁCH SẢN PHẨM</h2>
            <p>Ngày xuất: ${getAppDate().toLocaleDateString('vi-VN')} - Tổng: ${filtered.length} sản phẩm</p>
        </div>
        <div class="stats">
            <div class="stat-box"><div class="label">Tổng sản phẩm</div><div class="value">${filtered.length}</div></div>
            <div class="stat-box"><div class="label">Giá trị kho</div><div class="value">${money(totalValue)}</div></div>
            <div class="stat-box"><div class="label">Sắp hết</div><div class="value text-warning">${lowStockCount}</div></div>
            <div class="stat-box"><div class="label">Hết hàng</div><div class="value text-danger">${outOfStock}</div></div>
        </div>
        <table>
            <thead>
                <tr>
                    <th style="width:40px">STT</th>
                    <th style="width:80px">Mã SP</th>
                    <th>Tên sản phẩm</th>
                    <th style="width:100px">Danh mục</th>
                    <th class="text-right" style="width:100px">Giá bán</th>
                    <th class="text-right" style="width:90px">Giá vốn</th>
                    <th class="text-center" style="width:70px">Tồn kho</th>
                    <th style="width:60px">Đơn vị</th>
                    <th style="width:80px">Trạng thái</th>
                </tr>
            </thead>
            <tbody>
                ${filtered.map((p, i) => {
        const statusKey = getProductStockStatus(p);
        const status = getProductStatusLabel(statusKey);
        const statusClass = statusKey === 'out' ? 'text-danger' : statusKey === 'low' ? 'text-warning' : 'text-success';
        return `
                        <tr>
                            <td class="text-center">${i + 1}</td>
                            <td><code>${escapeHtml(p.code || '-')}</code></td>
                            <td><strong>${escapeHtml(p.name)}</strong></td>
                            <td>${escapeHtml(p.cat || '-')}</td>
                            <td class="text-right">${money(p.price)}</td>
                            <td class="text-right">${money(p.cost || 0)}</td>
                            <td class="text-center">${p.stock}</td>
                            <td>${escapeHtml(p.unit || '-')}</td>
                            <td class="${statusClass}">${status}</td>
                        </tr>
                    `;
    }).join('')}
            </tbody>
        </table>
        <div class="footer">Ngày xuất: ${getAppDate().toLocaleString('vi-VN')}</div>
    `;

    openA4PrintWindow('Danh sách sản phẩm', content);
    logActivity('Xuất PDF', 'Danh sách sản phẩm');
}

// Export Customers to PDF (A4 Landscape)
function exportCustomersPDF() {
    const search = ($('cust-search')?.value || '').toLowerCase();
    const filtered = db.custs.filter(c => c.name.toLowerCase().includes(search) || (c.phone || '').includes(search));

    if (filtered.length === 0) {
        toast("Không có dữ liệu để xuất!", "warning");
        return;
    }

    const groupLabels = { normal: 'Thường', silver: 'Bạc', gold: 'Vàng', vip: 'VIP' };
    const totalDebt = filtered.reduce((sum, c) => sum + (c.debt || 0), 0);
    const totalBuy = filtered.reduce((sum, c) => sum + (c.totalBuy || 0), 0);
    const vipCount = filtered.filter(c => c.group === 'vip').length;

    const content = `
        <div class="header">
            <h1>${escapeHtml(db.settings.name || '')}</h1>
            <h2>👥 DANH SÁCH KHÁCH HÀNG</h2>
            <p>Ngày xuất: ${getAppDate().toLocaleDateString('vi-VN')} - Tổng: ${filtered.length} khách hàng</p>
        </div>
        <div class="stats">
            <div class="stat-box"><div class="label">Tổng khách hàng</div><div class="value">${filtered.length}</div></div>
            <div class="stat-box"><div class="label">Khách VIP</div><div class="value" style="color:#F59E0B">${vipCount}</div></div>
            <div class="stat-box"><div class="label">Tổng công nợ</div><div class="value text-danger">${money(totalDebt)}</div></div>
            <div class="stat-box"><div class="label">Tổng mua</div><div class="value text-success">${money(totalBuy)}</div></div>
        </div>
        <table>
            <thead>
                <tr>
                    <th style="width:40px">STT</th>
                    <th>Tên khách hàng</th>
                    <th style="width:80px">Nhóm</th>
                    <th style="width:120px">Điện thoại</th>
                    <th>Địa chỉ</th>
                    <th>Email</th>
                    <th class="text-center" style="width:80px">Điểm</th>
                    <th class="text-right" style="width:100px">Công nợ</th>
                    <th class="text-right" style="width:110px">Tổng mua</th>
                </tr>
            </thead>
            <tbody>
                ${filtered.map((c, i) => `
                    <tr>
                        <td class="text-center">${i + 1}</td>
                        <td><strong>${escapeHtml(c.name)}</strong></td>
                        <td>${escapeHtml(groupLabels[c.group] || c.group || 'Thường')}</td>
                        <td>${escapeHtml(c.phone || '-')}</td>
                        <td>${escapeHtml(c.addr || '-')}</td>
                        <td>${escapeHtml(c.email || '-')}</td>
                        <td class="text-center">${c.points || 0}</td>
                        <td class="text-right ${(c.debt || 0) > 0 ? 'text-danger' : ''}">${money(c.debt || 0)}</td>
                        <td class="text-right">${money(c.totalBuy || 0)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        <div class="footer">Ngày xuất: ${getAppDate().toLocaleString('vi-VN')}</div>
    `;

    openA4PrintWindow('Danh sách khách hàng', content);
    logActivity('Xuất PDF', 'Danh sách khách hàng');
}

// Export Order History to PDF (A4 Landscape)
function exportHistoryPDF() {
    // Use YouTube-style date filter (same as renderHist)
    const fromInput = $('hist-date-from');
    const toInput = $('hist-date-to');
    let s, e;

    if (fromInput && fromInput.value) {
        s = parseLocalDateInput(fromInput.value);
    } else {
        s = getAppDate();
        s.setHours(0, 0, 0, 0);
    }

    if (toInput && toInput.value) {
        e = parseLocalDateInput(toInput.value, true);
    } else {
        e = getAppDate();
        e.setHours(23, 59, 59, 999);
    }

    const list = db.invoices.filter(i => {
        const d = new Date(i.date);
        return d >= s && d <= e;
    });

    if (list.length === 0) {
        toast("Không có dữ liệu để xuất!", "warning");
        return;
    }

    const totalRevenue = list.reduce((sum, i) => sum + i.total, 0);
    const totalDiscount = list.reduce((sum, i) => sum + (i.discount || 0), 0);
    const avgOrder = list.length > 0 ? Math.round(totalRevenue / list.length) : 0;

    // Get period label from the button text or generate from dates
    const filterLabel = $('hist-date-filter-label')?.textContent || 'Tùy chỉnh';
    const periodText = filterLabel.replace('📅 ', '');

    const content = `
        <div class="header">
            <h1>${escapeHtml(db.settings.name || '')}</h1>
            <h2>📜 LỊCH SỬ ĐƠN HÀNG</h2>
            <p>Kỳ: ${escapeHtml(periodText)} - Từ ${s.toLocaleDateString('vi-VN')} đến ${e.toLocaleDateString('vi-VN')}</p>
        </div>
        <div class="stats">
            <div class="stat-box"><div class="label">Tổng đơn hàng</div><div class="value">${list.length}</div></div>
            <div class="stat-box"><div class="label">Tổng doanh thu</div><div class="value text-success">${money(totalRevenue)}</div></div>
            <div class="stat-box"><div class="label">Tổng giảm giá</div><div class="value text-warning">${money(totalDiscount)}</div></div>
            <div class="stat-box"><div class="label">TB/Đơn</div><div class="value">${money(avgOrder)}</div></div>
        </div>
        <table>
            <thead>
                <tr>
                    <th style="width:40px">STT</th>
                    <th style="width:80px">Mã HĐ</th>
                    <th style="width:140px">Thời gian</th>
                    <th>Khách hàng</th>
                    <th>Thu ngân</th>
                    <th class="text-center" style="width:60px">Số SP</th>
                    <th class="text-right" style="width:110px">Tổng tiền</th>
                    <th class="text-right" style="width:90px">Giảm giá</th>
                    <th style="width:90px">Thanh toán</th>
                </tr>
            </thead>
            <tbody>
                ${list.map((i, idx) => `
                    <tr>
                        <td class="text-center">${idx + 1}</td>
                        <td><code>#${escapeHtml(String(i.id ?? '').slice(-6))}</code></td>
                        <td>${new Date(i.date).toLocaleString('vi-VN')}</td>
                        <td>${escapeHtml(i.cust || 'Khách lẻ')}</td>
                        <td>${escapeHtml(i.staff || '-')}</td>
                        <td class="text-center">${i.items.length}</td>
                        <td class="text-right"><strong>${money(i.total)}</strong></td>
                        <td class="text-right text-warning">${i.discount ? '-' + money(i.discount) : '-'}</td>
                        <td>${escapeHtml(i.method || '-')}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        <div class="footer">Ngày xuất: ${getAppDate().toLocaleString('vi-VN')}</div>
    `;

    openA4PrintWindow('Lịch sử đơn hàng', content);
    logActivity('Xuất PDF', 'Lịch sử đơn hàng');
}

function exportReturnsHistoryPDF() {
    const { list, s, e } = getFilteredReturnsHistory();
    if (list.length === 0) return toast('Không có dữ liệu để xuất!', 'warning');

    const totalRefund = list.reduce((sum, record) => sum + Math.max(0, getReturnDisplayTotals(record).difference), 0);
    const totalCollected = list.reduce((sum, record) => sum + Math.max(0, -getReturnDisplayTotals(record).difference), 0);
    const periodText = ($('returns-date-filter-label')?.textContent || 'Tùy chỉnh').replace('📅 ', '');
    const content = `
        <div class="header">
            <h1>${escapeHtml(db.settings.name || '')}</h1>
            <h2>🔄 LỊCH SỬ ĐỔI/TRẢ HÀNG</h2>
            <p>Kỳ: ${escapeHtml(periodText)} - Từ ${s.toLocaleDateString('vi-VN')} đến ${e.toLocaleDateString('vi-VN')}</p>
        </div>
        <div class="stats">
            <div class="stat-box"><div class="label">Hoàn trả</div><div class="value text-danger">${money(totalRefund)}</div></div>
            <div class="stat-box"><div class="label">Số phiếu</div><div class="value">${list.length}</div></div>
            <div class="stat-box"><div class="label">Thu thêm</div><div class="value text-success">${money(totalCollected)}</div></div>
        </div>
        <table>
            <thead><tr><th>STT</th><th>Mã phiếu</th><th>Thời gian</th><th>Khách hàng</th><th>Trả</th><th>Đổi</th><th class="text-right">Chênh lệch</th><th>Nhân viên</th></tr></thead>
            <tbody>${list.map((record, index) => {
                const { difference } = getReturnDisplayTotals(record);
                const differenceText = difference > 0 ? '+' + money(difference) : difference < 0 ? '-' + money(Math.abs(difference)) : 'Ngang giá';
                return `<tr><td>${index + 1}</td><td><code>#${escapeHtml(String(record.id ?? '').slice(-6))}</code></td><td>${new Date(record.date).toLocaleString('vi-VN')}</td><td>${escapeHtml(record.customer?.name || record.cust || 'Khách lẻ')}</td><td>${(record.returnItems || record.items || []).length} SP</td><td>${(record.exchangeItems || []).length} SP</td><td class="text-right"><strong>${differenceText}</strong></td><td>${escapeHtml(record.staff || '-')}</td></tr>`;
            }).join('')}</tbody>
        </table>
        <div class="footer">Ngày xuất: ${getAppDate().toLocaleString('vi-VN')}</div>`;
    openA4PrintWindow('Lịch sử đổi/trả hàng', content);
    logActivity('Xuất PDF', 'Lịch sử đổi/trả hàng');
}

// Export Stock History to PDF (A4 Landscape)
function exportStockHistoryPDF() {
    const filter = $('stock-filter')?.value || 'all';
    let list = db.stockHistory || [];
    if (filter !== 'all') list = list.filter(h => h.type === filter);

    if (list.length === 0) {
        toast("Không có dữ liệu để xuất!", "warning");
        return;
    }

    const typeLabels = { in: 'Nhập kho', out: 'Xuất kho', adjust: 'Điều chỉnh' };
    const filterLabels = { all: 'Tất cả', in: 'Nhập kho', out: 'Xuất kho', adjust: 'Điều chỉnh' };

    const totalIn = list.filter(h => h.type === 'in').reduce((sum, h) => sum + (h.total || 0), 0);
    const totalOut = list.filter(h => h.type === 'out').reduce((sum, h) => sum + (h.total || 0), 0);
    const inCount = list.filter(h => h.type === 'in').length;
    const outCount = list.filter(h => h.type === 'out').length;

    const content = `
        <div class="header">
            <h1>${escapeHtml(db.settings.name || '')}</h1>
            <h2>📊 LỊCH SỬ NHẬP/XUẤT KHO</h2>
            <p>Bộ lọc: ${filterLabels[filter]} - Ngày xuất: ${getAppDate().toLocaleDateString('vi-VN')}</p>
        </div>
        <div class="stats">
            <div class="stat-box"><div class="label">Tổng giao dịch</div><div class="value">${list.length}</div></div>
            <div class="stat-box"><div class="label">Số lần nhập</div><div class="value text-success">${inCount}</div></div>
            <div class="stat-box"><div class="label">Số lần xuất</div><div class="value text-warning">${outCount}</div></div>
            <div class="stat-box"><div class="label">Tổng nhập</div><div class="value text-success">${money(totalIn)}</div></div>
        </div>
        <table>
            <thead>
                <tr>
                    <th style="width:40px">STT</th>
                    <th style="width:140px">Thời gian</th>
                    <th style="width:80px">Loại</th>
                    <th>Sản phẩm</th>
                    <th class="text-center" style="width:70px">Số lượng</th>
                    <th class="text-right" style="width:90px">Đơn giá</th>
                    <th class="text-right" style="width:100px">Tổng tiền</th>
                    <th>Ghi chú</th>
                    <th style="width:100px">Người thực hiện</th>
                </tr>
            </thead>
            <tbody>
                ${list.map((h, i) => `
                    <tr>
                        <td class="text-center">${i + 1}</td>
                        <td>${new Date(h.date).toLocaleString('vi-VN')}</td>
                        <td class="${h.type === 'in' ? 'text-success' : h.type === 'out' ? 'text-warning' : ''}">${typeLabels[h.type] || h.type}</td>
                        <td>${escapeHtml(h.productName)}</td>
                        <td class="text-center ${h.type === 'out' ? 'text-danger' : 'text-success'}">${h.type === 'out' ? '-' : '+'}${h.qty}</td>
                        <td class="text-right">${money(h.price || 0)}</td>
                        <td class="text-right">${money(h.total || 0)}</td>
                        <td>${escapeHtml(h.note || '-')}</td>
                        <td>${escapeHtml(h.user || '-')}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        <div class="footer">Ngày xuất: ${getAppDate().toLocaleString('vi-VN')}</div>
    `;

    openA4PrintWindow('Lịch sử kho', content);
    logActivity('Xuất PDF', 'Lịch sử kho');
}

// Export Staff Salary to PDF (A4 Landscape)
function exportStaffSalaryPDF() {
    const period = $('staff-period')?.value || 'month';
    const periodLabels = { day: 'Hôm nay', week: 'Tuần này', month: 'Tháng này', year: 'Năm nay' };
    const search = ($('staff-search')?.value || '').toLowerCase().trim();

    const { startDate, endDate } = getStaffPeriodRange(period);

    const users = getStaffViewUsers(search);
    if (users.length === 0) {
        toast("Không có dữ liệu nhân viên!", "warning");
        return;
    }

    const salaryData = users.map(u => {
        const s = calculateStaffSalary(u.id, startDate, endDate);
        return { ...u, ...s };
    }).sort((a, b) => b.total - a.total);

    const totalSalary = salaryData.reduce((sum, s) => sum + s.total, 0);
    const totalRevenue = salaryData.reduce((sum, s) => sum + s.revenue, 0);
    const totalOrders = salaryData.reduce((sum, s) => sum + s.orders, 0);

    const content = `
        <div class="header">
            <h1>${escapeHtml(db.settings.name || '')}</h1>
            <h2>💼 BẢNG LƯƠNG NHÂN VIÊN</h2>
            <p>Kỳ: ${periodLabels[period]} (${startDate.toLocaleDateString('vi-VN')} - ${endDate.toLocaleDateString('vi-VN')})</p>
        </div>
        <div class="stats">
            <div class="stat-box"><div class="label">Số nhân viên</div><div class="value">${salaryData.length}</div></div>
            <div class="stat-box"><div class="label">Tổng lương</div><div class="value text-success">${money(totalSalary)}</div></div>
            <div class="stat-box"><div class="label">Tổng doanh thu</div><div class="value">${money(totalRevenue)}</div></div>
            <div class="stat-box"><div class="label">Tổng đơn hàng</div><div class="value">${totalOrders}</div></div>
        </div>
        <table>
            <thead>
                <tr>
                    <th style="width:40px">STT</th>
                    <th style="width:80px">Mã NV</th>
                    <th>Tên nhân viên</th>
                    <th class="text-right" style="width:100px">Lương cứng</th>
                    <th class="text-center" style="width:70px">% Hoa hồng</th>
                    <th class="text-right" style="width:110px">Doanh thu</th>
                    <th class="text-center" style="width:70px">Đơn hàng</th>
                    <th class="text-right" style="width:100px">Tiền HH</th>
                    <th class="text-right" style="width:110px">Tổng lương</th>
                </tr>
            </thead>
            <tbody>
                ${salaryData.map((s, i) => `
                    <tr>
                        <td class="text-center">${i + 1}</td>
                        <td><code>${escapeHtml(s.code || '-')}</code></td>
                        <td><strong>${escapeHtml(s.name || '-')}</strong></td>
                        <td class="text-right">${money(s.base || 0)}</td>
                        <td class="text-center">${s.commissionRate || 0}%</td>
                        <td class="text-right">${money(s.revenue)}</td>
                        <td class="text-center">${s.orders}</td>
                        <td class="text-right">${money(s.commission)}</td>
                        <td class="text-right text-success"><strong>${money(s.total)}</strong></td>
                    </tr>
                `).join('')}
            </tbody>
            <tfoot>
                <tr style="background: #E2E8F0; font-weight: bold;">
                    <td colspan="3" class="text-right">TỔNG CỘNG:</td>
                    <td class="text-right">${money(salaryData.reduce((s, u) => s + (u.base || 0), 0))}</td>
                    <td></td>
                    <td class="text-right">${money(totalRevenue)}</td>
                    <td class="text-center">${totalOrders}</td>
                    <td class="text-right">${money(salaryData.reduce((s, u) => s + u.commission, 0))}</td>
                    <td class="text-right text-success">${money(totalSalary)}</td>
                </tr>
            </tfoot>
        </table>
        <div style="margin-top: 40px; display: flex; justify-content: space-between;">
            <div style="text-align: center; flex: 1;">
                <p style="margin: 0; color: #64748B;">Người lập bảng</p>
                <div style="margin-top: 50px; border-top: 1px solid #333; width: 150px; display: inline-block;"></div>
                <p style="margin: 5px 0 0; font-weight: bold;">${escapeHtml(currUser?.name || '')}</p>
            </div>
            <div style="text-align: center; flex: 1;">
                <p style="margin: 0; color: #64748B;">Giám đốc duyệt</p>
                <div style="margin-top: 50px; border-top: 1px solid #333; width: 150px; display: inline-block;"></div>
                <p style="margin: 5px 0 0; font-weight: bold;"></p>
            </div>
        </div>
        <div class="footer">Ngày xuất: ${getAppDate().toLocaleString('vi-VN')}</div>
    `;

    openA4PrintWindow('Bảng lương nhân viên', content);
    logActivity('Xuất PDF', `Bảng lương ${periodLabels[period]}`);
}

// Print Stock Slip (A4 Landscape) - For single stock record
function printStockSlip(recordId) {
    const record = (db.stockHistory || []).find(h => sameStoredId(h.id, recordId));
    if (!record) {
        toast("Không tìm thấy phiếu!", "error");
        return;
    }

    const typeLabels = { in: 'PHIẾU NHẬP KHO', out: 'PHIẾU XUẤT KHO', adjust: 'PHIẾU ĐIỀU CHỈNH' };
    const typeColors = { in: '#10B981', out: '#F59E0B', adjust: '#6366F1' };
    const d = new Date(record.date);

    const content = `
        <div class="header">
            <h1>${escapeHtml(db.settings.name || '')}</h1>
            <h2 style="color: ${typeColors[record.type]}">${typeLabels[record.type] || 'PHIẾU KHO'}</h2>
            <p>Số phiếu: #${escapeHtml(String(record.id ?? ''))} - Ngày: ${d.toLocaleDateString('vi-VN')}</p>
        </div>
        <div style="background: #F8FAFC; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <table style="border: none; width: 100%;">
                <tr>
                    <td style="border: none; width: 50%; padding: 5px;"><strong>Thời gian:</strong> ${d.toLocaleString('vi-VN')}</td>
                    <td style="border: none; width: 50%; padding: 5px;"><strong>Người thực hiện:</strong> ${escapeHtml(record.user || '-')}</td>
                </tr>
                <tr>
                    <td style="border: none; padding: 5px;"><strong>Lý do:</strong> ${escapeHtml(record.reason || '-')}</td>
                    <td style="border: none; padding: 5px;"><strong>Ghi chú:</strong> ${escapeHtml(record.note || '-')}</td>
                </tr>
            </table>
        </div>
        <table>
            <thead>
                <tr>
                    <th>Sản phẩm</th>
                    <th class="text-center" style="width: 100px">Số lượng</th>
                    <th class="text-right" style="width: 120px">Đơn giá</th>
                    <th class="text-right" style="width: 130px">Thành tiền</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><strong>${escapeHtml(record.productName)}</strong></td>
                    <td class="text-center" style="font-size: 16px; font-weight: bold; color: ${record.type === 'out' ? '#EF4444' : '#10B981'}">${record.type === 'out' ? '-' : '+'}${record.qty}</td>
                    <td class="text-right">${money(record.price || 0)}</td>
                    <td class="text-right"><strong>${money(record.total || 0)}</strong></td>
                </tr>
            </tbody>
            <tfoot>
                <tr style="background: #E2E8F0;">
                    <td colspan="3" class="text-right"><strong>TỔNG GIÁ TRỊ:</strong></td>
                    <td class="text-right" style="font-size: 16px; font-weight: bold; color: ${typeColors[record.type]}">${money(record.total || 0)}</td>
                </tr>
            </tfoot>
        </table>
        <div style="margin-top: 50px; display: flex; justify-content: space-between;">
            <div style="text-align: center; flex: 1;">
                <p style="margin: 0; color: #64748B;">Người giao</p>
                <div style="margin-top: 50px; border-top: 1px solid #333; width: 150px; display: inline-block;"></div>
            </div>
            <div style="text-align: center; flex: 1;">
                <p style="margin: 0; color: #64748B;">Thủ kho</p>
                <div style="margin-top: 50px; border-top: 1px solid #333; width: 150px; display: inline-block;"></div>
                <p style="margin: 5px 0 0; font-weight: bold;">${escapeHtml(record.user || '')}</p>
            </div>
            <div style="text-align: center; flex: 1;">
                <p style="margin: 0; color: #64748B;">Kế toán</p>
                <div style="margin-top: 50px; border-top: 1px solid #333; width: 150px; display: inline-block;"></div>
            </div>
        </div>
        <div class="footer">Ngày in: ${getAppDate().toLocaleString('vi-VN')}</div>
    `;

    openA4PrintWindow(typeLabels[record.type], content);
    logActivity('In phiếu kho', `${typeLabels[record.type]} #${record.id}`);
}



function exportInventoryCheckPDF() {
    const diffProducts = db.products.filter(p => {
        const data = inventoryCheckData[p.id];
        return data && data.diff !== 0;
    });

    const html = `
        <div class="p-page" style="font-family: Arial, sans-serif; padding: 30px; max-width: 900px; margin: 0 auto; background: white;">
            <div style="text-align: center; margin-bottom: 25px; border-bottom: 2px solid #E2E8F0; padding-bottom: 20px;">
                <h1 style="margin: 0; color: #1E293B; font-size: 22px;">${escapeHtml(db.settings.name || '')}</h1>
                <h2 style="margin: 15px 0 5px; color: #6366F1;">BÁO CÁO KIỂM KHO</h2>
                <p style="color: #94A3B8; font-size: 13px;">Ngày kiểm: ${getAppDate().toLocaleDateString('vi-VN')}</p>
            </div>
            
            <div style="display: flex; gap: 20px; margin-bottom: 25px;">
                <div style="flex: 1; background: #F1F5F9; padding: 15px; border-radius: 8px; text-align: center;">
                    <div style="color: #64748B; font-size: 12px;">Tổng sản phẩm</div>
                    <div style="font-size: 24px; font-weight: bold; color: #1E293B;">${db.products.length}</div>
                </div>
                <div style="flex: 1; background: #FEF3C7; padding: 15px; border-radius: 8px; text-align: center;">
                    <div style="color: #92400E; font-size: 12px;">Có chênh lệch</div>
                    <div style="font-size: 24px; font-weight: bold; color: #F59E0B;">${diffProducts.length}</div>
                </div>
                <div style="flex: 1; background: #ECFDF5; padding: 15px; border-radius: 8px; text-align: center;">
                    <div style="color: #059669; font-size: 12px;">Khớp số liệu</div>
                    <div style="font-size: 24px; font-weight: bold; color: #10B981;">${db.products.length - diffProducts.length}</div>
                </div>
            </div>
            
            <h3 style="color: #1E293B; border-bottom: 2px solid #E2E8F0; padding-bottom: 10px;">📋 Chi tiết kiểm kho</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
                <thead>
                    <tr style="background: #F8FAFC;">
                        <th style="padding: 10px; text-align: left; border-bottom: 2px solid #E2E8F0; font-size: 12px;">Mã SP</th>
                        <th style="padding: 10px; text-align: left; border-bottom: 2px solid #E2E8F0; font-size: 12px;">Tên sản phẩm</th>
                        <th style="padding: 10px; text-align: left; border-bottom: 2px solid #E2E8F0; font-size: 12px;">Danh mục</th>
                        <th style="padding: 10px; text-align: center; border-bottom: 2px solid #E2E8F0; font-size: 12px;">Tồn HT</th>
                        <th style="padding: 10px; text-align: center; border-bottom: 2px solid #E2E8F0; font-size: 12px;">Tồn TT</th>
                        <th style="padding: 10px; text-align: center; border-bottom: 2px solid #E2E8F0; font-size: 12px;">Chênh lệch</th>
                    </tr>
                </thead>
                <tbody>
                    ${db.products.map(p => {
        const data = inventoryCheckData[p.id] || { systemStock: p.stock, actualStock: p.stock, diff: 0 };
        const diffStyle = data.diff > 0 ? 'color: #10B981; font-weight: bold;' :
            data.diff < 0 ? 'color: #EF4444; font-weight: bold;' : 'color: #64748B;';
        const diffText = data.diff > 0 ? `+${data.diff}` : data.diff;
        return `
                            <tr>
                                <td style="padding: 8px; border-bottom: 1px solid #E2E8F0; font-size: 12px;"><code>${escapeHtml(p.code || '-')}</code></td>
                                <td style="padding: 8px; border-bottom: 1px solid #E2E8F0; font-size: 12px;">${escapeHtml(p.name || 'Sản phẩm')}</td>
                                <td style="padding: 8px; border-bottom: 1px solid #E2E8F0; font-size: 12px;">${escapeHtml(p.cat || '-')}</td>
                                <td style="padding: 8px; text-align: center; border-bottom: 1px solid #E2E8F0; font-size: 12px;">${data.systemStock}</td>
                                <td style="padding: 8px; text-align: center; border-bottom: 1px solid #E2E8F0; font-size: 12px;">${data.actualStock}</td>
                                <td style="padding: 8px; text-align: center; border-bottom: 1px solid #E2E8F0; ${diffStyle}">${diffText}</td>
                            </tr>
                        `;
    }).join('')}
                </tbody>
            </table>
            
            <div style="margin-bottom: 20px; padding: 12px; background: #F1F5F9; border-radius: 8px;">
                <strong>Ghi chú kiểm kho:</strong> ${escapeHtml($('ic-note')?.value || 'Không có ghi chú')}
            </div>
            
            <div style="display: flex; justify-content: space-between; margin-top: 40px; padding-top: 20px; border-top: 1px solid #E2E8F0;">
                <div style="text-align: center; flex: 1;">
                    <p style="color: #64748B; margin: 0;">Người kiểm kho</p>
                    <div style="margin-top: 50px; border-top: 1px solid #1E293B; display: inline-block; width: 150px;"></div>
                    <p style="margin: 5px 0 0; font-weight: bold;">${escapeHtml(currUser?.name || '')}</p>
                </div>
                <div style="text-align: center; flex: 1;">
                    <p style="color: #64748B; margin: 0;">Xác nhận của quản lý</p>
                    <div style="margin-top: 50px; border-top: 1px solid #1E293B; display: inline-block; width: 150px;"></div>
                    <p style="margin: 5px 0 0; font-weight: bold;"></p>
                </div>
            </div>
            
            <div style="text-align: center; color: #94A3B8; font-size: 11px; margin-top: 30px;">
                Báo cáo được tạo vào ${getAppDate().toLocaleString('vi-VN')}
            </div>
        </div>
    `;

    // Use iframe approach for Electron compatibility instead of window.print()
    let printIframe = document.getElementById('inventory-check-print-iframe');
    if (!printIframe) {
        printIframe = document.createElement('iframe');
        printIframe.id = 'inventory-check-print-iframe';
        printIframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;border:none;background:#fff;';
        document.body.appendChild(printIframe);
    } else {
        printIframe.style.display = 'block';
    }

    const printContent = `<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Báo cáo kiểm kho</title>
    <style>
        @page { size: A4 landscape; margin: 10mm; }
        body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
        .preview-controls {
            position: fixed; top: 0; left: 0; right: 0;
            background: linear-gradient(135deg, #6366F1, #8B5CF6);
            color: white; padding: 12px 20px;
            display: flex; justify-content: space-between; align-items: center;
            z-index: 1000;
        }
        .preview-controls button {
            padding: 8px 16px; border: none; border-radius: 6px;
            cursor: pointer; font-weight: 600; margin-left: 8px;
        }
        .btn-print { background: #10B981; color: white; }
        .btn-close { background: #EF4444; color: white; }
        @media print {
            .preview-controls { display: none !important; }
        }
        @media screen {
            body { background: #f5f5f5; padding: 60px 20px 20px; }
            .p-page { background: white; box-shadow: 0 2px 10px rgba(0,0,0,0.1); border-radius: 8px; }
        }
    </style>
    </head><body>
    <div class="preview-controls">
        <span>📦 Báo cáo kiểm kho</span>
        <div>
            <button class="btn-print" id="print-btn">🖨️ In</button>
            <button class="btn-close" id="close-btn">✕ Đóng</button>
        </div>
    </div>
    ${html}
    </body></html>`;

    const iframeDoc = printIframe.contentDocument || printIframe.contentWindow?.document;
    if (!iframeDoc) { toast('Không thể tạo tài liệu in!', 'error'); return; }
    iframeDoc.open();
    iframeDoc.write(printContent);
    iframeDoc.close();

    setTimeout(() => {
        const printBtn = iframeDoc.getElementById('print-btn');
        const closeBtn = iframeDoc.getElementById('close-btn');
        if (printBtn) printBtn.onclick = () => printIframe.contentWindow.print();
        if (closeBtn) closeBtn.onclick = () => printIframe.style.display = 'none';
        printIframe.contentWindow.onafterprint = () => printIframe.style.display = 'none';
    }, 100);

    logActivity('Xuất PDF', 'Báo cáo kiểm kho');
}

function exportReportPDF() {
    const period = $('report-period')?.value || 'month';
    const periodLabels = { today: 'Hôm nay', week: 'Tuần này', month: 'Tháng này', year: 'Năm nay' };
    const now = getAppDate();
    let s = new Date(now), e = new Date(now);

    if (period === 'today') {
        s.setHours(0, 0, 0, 0);
    } else if (period === 'week') {
        const d = now.getDay() || 7;
        s.setDate(now.getDate() - d + 1);
        s.setHours(0, 0, 0, 0);
    } else if (period === 'month') {
        s.setDate(1);
        s.setHours(0, 0, 0, 0);
    } else if (period === 'year') {
        s = new Date(now.getFullYear(), 0, 1);
    } else if (period.startsWith('year-')) {
        const yr = parseInt(period.replace('year-', ''));
        s = new Date(yr, 0, 1);
        e = new Date(yr, 11, 31, 23, 59, 59, 999);
    }
    if (!period.startsWith('year-')) e.setHours(23, 59, 59, 999);

    const invs = db.invoices.filter(i => {
        const d = new Date(i.date);
        return d >= s && d <= e;
    });

    const revenue = invs.reduce((a, b) => a + b.total, 0);
    const cost = invs.reduce((a, inv) => a + getInvoiceCost(inv), 0);
    const profit = revenue - cost;

    // Top products
    const prodCounts = {};
    invs.forEach(inv => (inv.items || []).forEach(i => {
        prodCounts[i.name] = (prodCounts[i.name] || 0) + i.qty;
    }));
    const topProducts = Object.entries(prodCounts).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 10);

    const html = `
        <div class="p-page" style="font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto;">
            <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="margin: 0; color: #1E293B;">${escapeHtml(db.settings.name || '')}</h1>
                <p style="color: #64748B; margin: 5px 0;">${escapeHtml(db.settings.addr || '')}</p>
                <h2 style="margin: 20px 0 5px; color: #6366F1;">BÁO CÁO KINH DOANH</h2>
                <p style="color: #94A3B8;">Kỳ báo cáo: ${periodLabels[period]} (${s.toLocaleDateString('vi-VN')} - ${e.toLocaleDateString('vi-VN')})</p>
            </div>

            <div style="display: flex; gap: 20px; margin-bottom: 30px;">
                <div style="flex: 1; background: #F1F5F9; padding: 20px; border-radius: 10px; text-align: center;">
                    <div style="color: #64748B; font-size: 12px;">💰 Doanh thu</div>
                    <div style="font-size: 24px; font-weight: bold; color: #1E293B;">${money(revenue)}</div>
                </div>
                <div style="flex: 1; background: #ECFDF5; padding: 20px; border-radius: 10px; text-align: center;">
                    <div style="color: #64748B; font-size: 12px;">📈 Lợi nhuận</div>
                    <div style="font-size: 24px; font-weight: bold; color: #10B981;">${money(profit)}</div>
                </div>
                <div style="flex: 1; background: #EEF2FF; padding: 20px; border-radius: 10px; text-align: center;">
                    <div style="color: #64748B; font-size: 12px;">🧾 Đơn hàng</div>
                    <div style="font-size: 24px; font-weight: bold; color: #6366F1;">${invs.length}</div>
                </div>
            </div>

            <div style="margin-bottom: 30px;">
                <h3 style="color: #1E293B; border-bottom: 2px solid #E2E8F0; padding-bottom: 10px;">🏆 Top sản phẩm bán chạy</h3>
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #F8FAFC;">
                            <th style="padding: 12px; text-align: left; border-bottom: 1px solid #E2E8F0;">STT</th>
                            <th style="padding: 12px; text-align: left; border-bottom: 1px solid #E2E8F0;">Sản phẩm</th>
                            <th style="padding: 12px; text-align: right; border-bottom: 1px solid #E2E8F0;">Số lượng bán</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${topProducts.map((p, i) => `
                            <tr>
                                <td style="padding: 10px; border-bottom: 1px solid #E2E8F0;">${i + 1}</td>
                                <td style="padding: 10px; border-bottom: 1px solid #E2E8F0;">${escapeHtml(p.name || 'Sản phẩm')}</td>
                                <td style="padding: 10px; text-align: right; border-bottom: 1px solid #E2E8F0; font-weight: 600;">${p.qty}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <div style="margin-bottom: 30px;">
                <h3 style="color: #1E293B; border-bottom: 2px solid #E2E8F0; padding-bottom: 10px;">📦 Tình trạng kho</h3>
                <div style="display: flex; gap: 20px;">
                    <div style="flex: 1; background: #F0FDF4; padding: 15px; border-radius: 8px;">
                        <div style="color: #22C55E; font-weight: 600;">Còn hàng</div>
                        <div style="font-size: 20px; font-weight: bold;">${db.products.filter(p => p.stock > (db.settings.lowStock || 5)).length} sản phẩm</div>
                    </div>
                    <div style="flex: 1; background: #FFFBEB; padding: 15px; border-radius: 8px;">
                        <div style="color: #F59E0B; font-weight: 600;">Sắp hết</div>
                        <div style="font-size: 20px; font-weight: bold;">${db.products.filter(p => p.stock > 0 && p.stock <= (db.settings.lowStock || 5)).length} sản phẩm</div>
                    </div>
                    <div style="flex: 1; background: #FEF2F2; padding: 15px; border-radius: 8px;">
                        <div style="color: #EF4444; font-weight: 600;">Hết hàng</div>
                        <div style="font-size: 20px; font-weight: bold;">${db.products.filter(p => p.stock <= 0).length} sản phẩm</div>
                    </div>
                </div>
            </div>

            <div style="text-align: center; color: #94A3B8; font-size: 12px; margin-top: 40px; border-top: 1px solid #E2E8F0; padding-top: 20px;">
                Báo cáo được tạo vào ${getAppDate().toLocaleString('vi-VN')}
            </div>
        </div>
    `;

    // Use iframe approach for Electron compatibility instead of window.print()
    let printIframe = document.getElementById('report-pdf-print-iframe');
    if (!printIframe) {
        printIframe = document.createElement('iframe');
        printIframe.id = 'report-pdf-print-iframe';
        printIframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;border:none;background:#fff;';
        document.body.appendChild(printIframe);
    } else {
        printIframe.style.display = 'block';
    }

    const printContent = `<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Báo cáo kinh doanh</title>
    <style>
        @page { size: A4; margin: 15mm; }
        body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
        .preview-controls {
            position: fixed; top: 0; left: 0; right: 0;
            background: linear-gradient(135deg, #6366F1, #8B5CF6);
            color: white; padding: 12px 20px;
            display: flex; justify-content: space-between; align-items: center;
            z-index: 1000;
        }
        .preview-controls button {
            padding: 8px 16px; border: none; border-radius: 6px;
            cursor: pointer; font-weight: 600; margin-left: 8px;
        }
        .btn-print { background: #10B981; color: white; }
        .btn-close { background: #EF4444; color: white; }
        @media print {
            .preview-controls { display: none !important; }
        }
        @media screen {
            body { background: #f5f5f5; padding: 60px 20px 20px; }
            .p-page { background: white; box-shadow: 0 2px 10px rgba(0,0,0,0.1); border-radius: 8px; }
        }
    </style>
    </head><body>
    <div class="preview-controls">
        <span>📊 Báo cáo kinh doanh</span>
        <div>
            <button class="btn-print" id="print-btn">🖨️ In</button>
            <button class="btn-close" id="close-btn">✕ Đóng</button>
        </div>
    </div>
    ${html}
    </body></html>`;

    const iframeDoc = printIframe.contentDocument || printIframe.contentWindow?.document;
    if (!iframeDoc) { toast('Không thể tạo tài liệu in!', 'error'); return; }
    iframeDoc.open();
    iframeDoc.write(printContent);
    iframeDoc.close();

    setTimeout(() => {
        const printBtn = iframeDoc.getElementById('print-btn');
        const closeBtn = iframeDoc.getElementById('close-btn');
        if (printBtn) printBtn.onclick = () => printIframe.contentWindow.print();
        if (closeBtn) closeBtn.onclick = () => printIframe.style.display = 'none';
        printIframe.contentWindow.onafterprint = () => printIframe.style.display = 'none';
    }, 100);

    logActivity('Xuất PDF', 'Báo cáo kinh doanh');
}

function holdOrder() { toast("Tính năng tạm giữ đơn đang phát triển", "info"); }

// Export Report to Excel
function exportReportExcel() {
    const period = $('report-period')?.value || 'month';
    const periodLabels = { today: 'Hôm nay', week: 'Tuần này', month: 'Tháng này', year: 'Năm nay' };
    const now = getAppDate();
    let s = new Date(now), e = new Date(now);

    if (period === 'today') {
        s.setHours(0, 0, 0, 0);
    } else if (period === 'week') {
        const d = now.getDay() || 7;
        s.setDate(now.getDate() - d + 1);
        s.setHours(0, 0, 0, 0);
    } else if (period === 'month') {
        s.setDate(1);
        s.setHours(0, 0, 0, 0);
    } else if (period === 'year') {
        s = new Date(now.getFullYear(), 0, 1);
    } else if (period.startsWith('year-')) {
        const yr = parseInt(period.replace('year-', ''));
        s = new Date(yr, 0, 1);
        e = new Date(yr, 11, 31, 23, 59, 59, 999);
    }
    if (!period.startsWith('year-')) e.setHours(23, 59, 59, 999);

    const invs = db.invoices.filter(i => {
        const d = new Date(i.date);
        return d >= s && d <= e;
    });

    const revenue = invs.reduce((a, b) => a + b.total, 0);
    const cost = invs.reduce((a, inv) => a + getInvoiceCost(inv), 0);
    const profit = revenue - cost;

    // Top products
    const prodCounts = {};
    invs.forEach(inv => (inv.items || []).forEach(i => {
        prodCounts[i.name] = (prodCounts[i.name] || 0) + i.qty;
    }));
    const topProducts = Object.entries(prodCounts).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 20);

    // Create data for Excel with multiple sections
    const headers = ['Hạng mục', 'Giá trị'];
    const data = [
        ['--- BÁO CÁO KINH DOANH ---', ''],
        ['Kỳ báo cáo', periodLabels[period]],
        ['Từ ngày', s.toLocaleDateString('vi-VN')],
        ['Đến ngày', e.toLocaleDateString('vi-VN')],
        ['', ''],
        ['--- TỔNG QUAN ---', ''],
        ['Doanh thu', revenue],
        ['Chi phí', cost],
        ['Lợi nhuận', profit],
        ['Số đơn hàng', invs.length],
        ['', ''],
        ['--- TOP SẢN PHẨM BÁN CHẠY ---', ''],
        ...topProducts.map((p, i) => [`${i + 1}. ${p.name}`, p.qty]),
        ['', ''],
        ['--- TÌNH TRẠNG KHO ---', ''],
        ['Còn hàng', db.products.filter(p => p.stock > (db.settings.lowStock || 5)).length + ' sản phẩm'],
        ['Sắp hết', db.products.filter(p => p.stock > 0 && p.stock <= (db.settings.lowStock || 5)).length + ' sản phẩm'],
        ['Hết hàng', db.products.filter(p => p.stock <= 0).length + ' sản phẩm']
    ];

    exportToExcel(data, headers, `BaoCaoKinhDoanh_${periodLabels[period]}`);
}

// NOTE: Main keyboard shortcuts are handled by handleKeyboardNav() in initKeyboardNavigation()
// The duplicate listener that was here has been removed to prevent conflicts

// ========== COLLAPSIBLE SETTINGS ==========

function toggleSettingsSection(toggleElement) {
    const box = toggleElement.closest('.settings-collapsible');
    if (!box) return;

    if (box.classList.contains('collapsed')) {
        expandSettingsSection(box);
    } else {
        collapseSettingsSection(box);
    }
}

function getSettingsSectionContent(box) {
    return box ? box.querySelector('.settings-content') : null;
}

function expandSettingsSection(box) {
    const content = getSettingsSectionContent(box);
    if (!content) {
        box.classList.remove('collapsed');
        return;
    }

    box.classList.add('is-animating');
    content.style.overflow = 'hidden';
    content.style.maxHeight = '0px';
    box.classList.remove('collapsed');

    requestAnimationFrame(() => {
        content.style.maxHeight = `${content.scrollHeight}px`;
    });

    let finished = false;
    const finishExpand = (event) => {
        if (finished || (event && event.propertyName !== 'max-height')) return;
        finished = true;
        content.removeEventListener('transitionend', finishExpand);
        if (!box.classList.contains('collapsed')) {
            content.style.maxHeight = 'none';
            content.style.overflow = 'visible';
        }
        box.classList.remove('is-animating');
    };
    content.addEventListener('transitionend', finishExpand);
    setTimeout(() => finishExpand(), 450);
}

function collapseSettingsSection(box) {
    const content = getSettingsSectionContent(box);
    if (!content) {
        box.classList.add('collapsed');
        return;
    }

    box.classList.add('is-animating');
    content.style.overflow = 'hidden';
    content.style.maxHeight = `${content.scrollHeight}px`;
    content.offsetHeight;
    box.classList.add('collapsed');

    requestAnimationFrame(() => {
        content.style.maxHeight = '0px';
    });

    let finished = false;
    const finishCollapse = (event) => {
        if (finished || (event && event.propertyName !== 'max-height')) return;
        finished = true;
        content.removeEventListener('transitionend', finishCollapse);
        box.classList.remove('is-animating');
    };
    content.addEventListener('transitionend', finishCollapse);
    setTimeout(() => finishCollapse(), 450);
}

function setSettingsSectionCollapsed(box, collapsed) {
    const content = getSettingsSectionContent(box);
    box.classList.toggle('collapsed', collapsed);
    box.classList.remove('is-animating');
    if (!content) return;

    content.style.maxHeight = collapsed ? '0px' : 'none';
    content.style.overflow = collapsed ? 'hidden' : 'visible';
}

// Initialize collapsed state for some settings on load
// Settings collapsible init - initialized in consolidated DOMContentLoaded

// Inject drafts button dynamically
function injectDraftsButton() {
    // Find all button containers in management/inventory views
    const buttonGroups = document.querySelectorAll('.d-flex.gap-1');
    buttonGroups.forEach(group => {
        // Check if this group contains the PO history button
        const historyBtn = Array.from(group.querySelectorAll('button')).find(b =>
            b.onclick && b.onclick.toString().includes('openPOHistoryModal')
        );

        if (historyBtn && !group.querySelector('[data-drafts-btn]')) {
            const draftsBtn = document.createElement('button');
            draftsBtn.className = 'btn';
            draftsBtn.setAttribute('data-drafts-btn', 'true');
            draftsBtn.style.background = 'linear-gradient(135deg, #F59E0B, #D97706)';
            draftsBtn.innerHTML = '📋 Đơn lưu tạm';
            draftsBtn.onclick = openDraftsModal;
            group.appendChild(draftsBtn);
        }
    });
}

// ========== DEVICE DETECTION ==========

let detectedDevices = [];

async function detectDevices() {
    const listEl = $('detected-devices-list');
    const printerSelect = $('set-printer');

    if (listEl) {
        listEl.innerHTML = '<div style="color:var(--text-muted); font-style:italic;">🔄 Đang quét thiết bị...</div>';
    }

    try {
        let printers = [];

        // Try to get printers via Electron IPC
        if (desktop?.printers?.list) {
            printers = await desktop.printers.list();
        }

        // Classify devices by type
        detectedDevices = printers.map(p => ({
            name: p.name,
            displayName: p.displayName || p.name,
            isDefault: p.isDefault,
            status: p.status || 0,
            type: classifyPrinter(p.name)
        }));

        // Update device list display
        if (listEl) {
            if (detectedDevices.length === 0) {
                listEl.innerHTML = `
                    <div style="color:var(--warning); padding:8px;">
                        ⚠️ Không phát hiện máy in nào.<br>
                        <span style="font-size:10px; color:var(--text-muted);">
                            Kiểm tra kết nối và driver máy in của bạn.
                        </span>
                    </div>
                `;
            } else {
                listEl.innerHTML = detectedDevices.map(d => `
                    <div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border-light);">
                        <span style="font-size:16px;">${getDeviceIcon(d.type)}</span>
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                ${escapeHtml(d.displayName)}
                                ${d.isDefault ? '<span style="background:var(--primary); color:white; font-size:9px; padding:1px 4px; border-radius:3px; margin-left:4px;">Mặc định</span>' : ''}
                            </div>
                            <div style="font-size:10px; color:var(--text-muted);">${getDeviceTypeName(d.type)}</div>
                        </div>
                        <span style="font-size:20px; color:${d.status === 0 ? 'var(--success)' : 'var(--warning)'};">●</span>
                    </div>
                `).join('');
            }
        }

        // Populate printer dropdown
        if (printerSelect) {
            const currentValue = printerSelect.value;
            printerSelect.innerHTML = '<option value="">Mặc định hệ thống (Tự động)</option>';
            detectedDevices.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.name;
                opt.textContent = `${getDeviceIcon(d.type)} ${d.displayName}`;
                if (d.isDefault) opt.textContent += ' ★';
                printerSelect.appendChild(opt);
            });
            printerSelect.value = currentValue;
        }

        console.log(`Detected ${detectedDevices.length} devices`);

    } catch (e) {
        console.error('Device detection failed:', e);
        if (listEl) {
            listEl.innerHTML = `
                <div style="color:var(--text-muted); padding:8px;">
                    ℹ️ Chạy trong trình duyệt - không thể quét thiết bị.<br>
                    <span style="font-size:10px;">Mở ứng dụng Electron để quét máy in.</span>
                </div>
            `;
        }
    }
}

// Classify printer type by name
function classifyPrinter(name) {
    const lowerName = (name || '').toLowerCase();

    // Label printers
    if (lowerName.includes('godex') || lowerName.includes('tsc') ||
        lowerName.includes('zebra') || lowerName.includes('xprinter') ||
        lowerName.includes('gprinter') || lowerName.includes('label')) {
        return 'label';
    }

    // Thermal/Receipt printers
    if (lowerName.includes('thermal') || lowerName.includes('pos') ||
        lowerName.includes('receipt') || lowerName.includes('epson tm') ||
        lowerName.includes('star') || lowerName.includes('bixolon') ||
        lowerName.includes('80mm') || lowerName.includes('58mm')) {
        return 'thermal';
    }

    // PDF printers
    if (lowerName.includes('pdf') || lowerName.includes('xps') ||
        lowerName.includes('onenote') || lowerName.includes('fax')) {
        return 'virtual';
    }

    // Regular printers
    return 'regular';
}

// Get device icon by type
function getDeviceIcon(type) {
    switch (type) {
        case 'label': return '🏷️';
        case 'thermal': return '🧾';
        case 'virtual': return '📄';
        default: return '🖨️';
    }
}

// Get device type name
function getDeviceTypeName(type) {
    switch (type) {
        case 'label': return 'Máy in tem nhãn';
        case 'thermal': return 'Máy in nhiệt/hóa đơn';
        case 'virtual': return 'Máy in ảo';
        default: return 'Máy in thông thường';
    }
}

// ========== AUTO PRINTER SELECTION ==========

// Get best printer for receipt/invoice printing
function getReceiptPrinter() {
    // Priority: user-selected > thermal > regular > default
    const savedPrinter = db.settings?.printer;
    if (savedPrinter) {
        const printer = detectedDevices.find(d => d.name === savedPrinter);
        if (printer) return printer;
    }

    // Auto-detect thermal printer
    const thermalPrinter = detectedDevices.find(d => d.type === 'thermal');
    if (thermalPrinter) {
        console.log('Auto-selected receipt printer:', thermalPrinter.name);
        return thermalPrinter;
    }

    // Fallback to default printer (excluding virtual and label)
    const defaultPrinter = detectedDevices.find(d => d.isDefault && d.type !== 'virtual' && d.type !== 'label');
    if (defaultPrinter) return defaultPrinter;

    const anyPrinter = detectedDevices.find(d => d.type === 'regular');
    return anyPrinter || null;
}

// Get best printer for label printing
function getLabelPrinter() {
    // Priority: saved label printer > auto-detect label > regular
    const savedLabelPrinter = db.settings?.labelPrinter;
    if (savedLabelPrinter) {
        const printer = detectedDevices.find(d => d.name === savedLabelPrinter);
        if (printer) return printer;
    }

    // Auto-detect label printer
    const labelPrinter = detectedDevices.find(d => d.type === 'label');
    if (labelPrinter) {
        console.log('Auto-selected label printer:', labelPrinter.name);
        return labelPrinter;
    }

    // Fallback to any non-virtual printer
    return detectedDevices.find(d => d.type !== 'virtual') || null;
}

// Smart print function - auto-selects printer
async function smartPrint(type = 'receipt', options = {}) {
    const printer = type === 'label' ? getLabelPrinter() : getReceiptPrinter();

    if (!printer) {
        console.log('No printer found, using system default');
        return { useBrowserPrint: true };
    }

    console.log(`Smart print: Using ${printer.displayName} for ${type}`);

    // If Electron, use IPC for silent printing
    if (desktop?.printers?.print) {
        const silent = db.settings?.silent !== false; // Default to silent
        return {
            printerName: printer.name,
            silent: silent,
            useElectron: true
        };
    }

    // Browser - show print dialog
    return { useBrowserPrint: true, suggestedPrinter: printer.name };
}

// Get printer status indicator
function getPrinterStatus() {
    const receiptPrinter = getReceiptPrinter();
    const labelPrinter = getLabelPrinter();

    return {
        receipt: receiptPrinter ? {
            name: receiptPrinter.displayName,
            status: receiptPrinter.status === 0 ? 'ready' : 'offline',
            type: receiptPrinter.type
        } : null,
        label: labelPrinter ? {
            name: labelPrinter.displayName,
            status: labelPrinter.status === 0 ? 'ready' : 'offline',
            type: labelPrinter.type
        } : null
    };
}

// Show printer status in UI
function updatePrinterStatusUI() {
    const status = getPrinterStatus();

    // Update receipt printer indicator
    const receiptIndicator = $('receipt-printer-status');
    if (receiptIndicator && status.receipt) {
        receiptIndicator.innerHTML = `
            <span style="color:${status.receipt.status === 'ready' ? 'var(--success)' : 'var(--warning)'}">●</span>
            ${escapeHtml(status.receipt.name)}
        `;
    }

    // Update label printer indicator
    const labelIndicator = $('label-printer-status');
    if (labelIndicator && status.label) {
        labelIndicator.innerHTML = `
            <span style="color:${status.label.status === 'ready' ? 'var(--success)' : 'var(--warning)'}">●</span>
            ${escapeHtml(status.label.name)}
        `;
    }
}

// Refresh devices and update status
async function refreshPrinters() {
    await detectDevices();
    updatePrinterStatusUI();
    toast('Đã cập nhật danh sách máy in', 'success');
}

// ========== BARCODE GENERATION ==========

// Generate EAN-13 compatible barcode
function generateEAN13() {
    // Start with country code 890 (Vietnam) or random prefix
    let code = '890';
    // Add 9 random digits
    for (let i = 0; i < 9; i++) {
        code += Math.floor(Math.random() * 10);
    }
    // Calculate check digit
    let sum = 0;
    for (let i = 0; i < 12; i++) {
        sum += parseInt(code[i]) * (i % 2 === 0 ? 1 : 3);
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    return code + checkDigit;
}

// Validate EAN-13 barcode checksum
function validateEAN13(code) {
    if (!code || code.length !== 13) return false;
    if (!/^\d{13}$/.test(code)) return false;

    let sum = 0;
    for (let i = 0; i < 12; i++) {
        sum += parseInt(code[i]) * (i % 2 === 0 ? 1 : 3);
    }
    const expectedCheckDigit = (10 - (sum % 10)) % 10;
    return parseInt(code[12]) === expectedCheckDigit;
}

function getBarcodeFormat(code) {
    return code?.length === 13 && validateEAN13(code) ? 'EAN13' : 'CODE128';
}

// Fix invalid barcode - regenerate if not valid EAN-13
function fixInvalidBarcode(productId) {
    const product = db.products.find(p => sameStoredId(p.id, productId));
    if (!product) return null;

    // If code is valid EAN-13, keep it
    if (product.code && validateEAN13(product.code)) {
        return product.code;
    }

    // If code exists but invalid, or no code, generate new one
    const newCode = generateEAN13();
    const previousCode = product.code;
    product.code = newCode;
    if (!saveNow()) {
        product.code = previousCode;
        return previousCode || null;
    }
    console.log(`Fixed barcode for product ${product.name}: ${newCode}`);
    return newCode;
}

// Check and fix all product barcodes on startup
function validateAllBarcodes() {
    const previousCodes = db.products.map(product => product.code);
    let fixedCount = 0;
    db.products.forEach(p => {
        if (p.code && p.code.length === 13 && !validateEAN13(p.code)) {
            const oldCode = p.code;
            p.code = generateEAN13();
            fixedCount++;
            console.log(`Regenerated invalid barcode for ${p.name}: ${oldCode} -> ${p.code}`);
        }
    });
    if (fixedCount > 0) {
        if (!saveNow()) {
            db.products.forEach((product, index) => { product.code = previousCodes[index]; });
            return;
        }
        console.log(`Fixed ${fixedCount} invalid barcodes`);
    }
}

// Generate barcode for product modal
function generateProductBarcode() {
    const newCode = generateEAN13();
    $('p-code').value = newCode;
    updateBarcodePreview(newCode);
    toast("Đã tạo mã vạch mới!", "success");
}

// Update barcode preview in product modal
function updateBarcodePreview(code) {
    const container = $('barcode-preview-container');
    const svgElement = $('barcode-preview');

    if (!code || code.length < 4) {
        if (container) container.style.display = 'none';
        return;
    }

    try {
        if (typeof JsBarcode !== 'undefined' && svgElement) {
            JsBarcode(svgElement, code, {
                format: getBarcodeFormat(code),
                width: 2,
                height: 60,
                displayValue: true,
                fontSize: 14,
                margin: 10
            });
            if (container) container.style.display = 'block';
        }
    } catch (e) {
        console.warn('Barcode generation failed:', e);
        if (container) container.style.display = 'none';
    }
}

// Barcode preview listener - initialized in consolidated DOMContentLoaded

// ========== BARCODE SCANNER INTEGRATION ==========

let scannedProduct = null;
let lastInputTime = 0;
let inputBuffer = '';

// Enhanced search handler for barcode scanner
function handleBarcodeInput(e) {
    const now = Date.now();
    const input = $('pos-search');

    // Detect rapid input (typical of barcode scanners)
    if (now - lastInputTime < 100 && e.key !== 'Enter') {
        // This is likely barcode scanner input
        inputBuffer += e.key;
    } else if (e.key !== 'Enter') {
        inputBuffer = e.key;
    }

    lastInputTime = now;

    if (e.key === 'Enter') {
        e.preventDefault();
        const searchValue = input.value.trim();

        if (searchValue) {
            // Search for product by code (primary), or name/id (fallback)
            let product = db.products.find(p =>
                (p.code || '').toLowerCase() === searchValue.toLowerCase() ||
                p.code === searchValue
            );

            // Fallback: search by partial code or product name
            if (!product) {
                product = db.products.find(p =>
                    (p.code || '').includes(searchValue) ||
                    p.name.toLowerCase().includes(searchValue.toLowerCase())
                );
            }

            if (product) {
                if (db.settings?.scannerAutoAdd !== false) {
                    addCart(product.id);
                    toast(`✓ Đã thêm: ${product.name}`, "success");
                } else if (db.settings?.scannerPopup !== false) {
                    showScannedProductPopup(product);
                } else {
                    toast(`Tìm thấy: ${product.name}`, "info");
                }

                // Keep product code in search box and select all for consecutive scanning
                input.value = product.code || searchValue;
                input.focus();
                input.select();  // Select all text - next scan will auto-replace
                renderPos(); // Trigger search to display the product
            } else {
                toast("Không tìm thấy sản phẩm với mã: " + searchValue, "warning");
            }
        }
        inputBuffer = '';
    }
}

// Override the handleSearch function to support scanner
const originalHandleSearch = handleSearch;
handleSearch = function (e) {
    if (e.key === 'Enter') {
        handleBarcodeInput(e);
    } else {
        renderPos();
    }
};

// Show scanned product popup
function showScannedProductPopup(product) {
    scannedProduct = product;

    // Update popup content
    const imgEl = $('scanned-product-img');
    const imgSrc = safeImageSrc(product.img);
    if (imgSrc) {
        imgEl.innerHTML = `<img src="${escapeAttr(imgSrc)}" style="width:100%; height:100%; object-fit:cover;">`;
    } else {
        imgEl.innerHTML = '📷';
    }

    $('scanned-product-name').textContent = product.name;
    $('scanned-product-code').textContent = `Mã: ${product.code || 'N/A'}`;
    $('scanned-product-price').textContent = money(product.price);
    $('scanned-product-stock').textContent = product.stock;
    $('scanned-product-qty').value = 1;
    $('scanned-product-qty').removeAttribute('max');

    // Show modal
    $('scanned-product-modal').classList.add('active');

    // Focus quantity input
    setTimeout(() => $('scanned-product-qty').focus(), 100);
}

// Modify scanned quantity
function modifyScannedQty(delta) {
    const input = $('scanned-product-qty');
    let qty = parseInt(input.value) || 1;
    qty += delta;

    if (qty < 1) qty = 1;

    input.value = qty;
}

// Add scanned product to cart
function addScannedToCart() {
    if (!scannedProduct) return;

    const qty = Math.max(1, parseInt($('scanned-product-qty').value) || 1);
    $('scanned-product-qty').value = qty;

    // Check if already in cart
    const existingItem = cart.find(i => sameStoredId(i.id, scannedProduct.id));
    const totalQty = (existingItem?.qty || 0) + qty;
    if (existingItem) {
        existingItem.qty = totalQty;
    } else {
        cart.push({ ...scannedProduct, qty });
    }

    if (scannedProduct.stock <= 0) {
        toast(`⚠️ Bán âm kho: ${scannedProduct.name} (Tồn: ${scannedProduct.stock})`, "warning");
    } else if (totalQty > scannedProduct.stock) {
        toast(`⚠️ Vượt tồn kho: ${scannedProduct.name} (Tồn: ${scannedProduct.stock}, Bán: ${totalQty})`, "warning");
    }

    renderCart();
    closeModal('scanned-product-modal');
    toast(`Đã thêm ${qty}x ${scannedProduct.name} vào giỏ hàng`, "success");

    // Refocus search for next scan
    setTimeout(() => $('pos-search')?.focus(), 100);
}

// ========== LABEL PRINTING ==========

let labelProduct = null;

// Open label print modal
function openLabelPrintModal(productId) {
    const product = db.products.find(p => sameStoredId(p.id, productId));
    if (!product) return toast("Không tìm thấy sản phẩm!", "error");

    labelProduct = product;
    $('label-product-id').value = productId;
    $('label-product-name').textContent = product.name;
    $('label-product-code').textContent = `Mã: ${product.code || 'N/A'}`;
    $('label-preview-name').textContent = product.name;
    $('label-preview-price').textContent = money(product.price);
    $('label-quantity').value = 1;

    // Set label size from settings (default to 35x22)
    const savedLabelSize = $('set-label-size')?.value || db.settings?.labelSize || '35x22';
    if ($('label-size')) {
        $('label-size').value = savedLabelSize;
    }

    // Reset format options to default
    $('label-show-barcode').checked = true;
    $('label-show-name').checked = true;
    $('label-show-price').checked = false;

    // Generate barcode preview
    updateLabelPreview();

    // Check printer status
    checkLabelPrinter();

    $('label-print-modal').classList.add('active');
}

// Update label preview
function updateLabelPreview() {
    if (!labelProduct) return;

    const showBarcode = $('label-show-barcode')?.checked !== false;
    const showName = $('label-show-name')?.checked !== false;
    const showPrice = $('label-show-price')?.checked === true;

    const code = labelProduct.code || '';
    const svgElement = $('label-barcode');
    const nameEl = $('label-preview-name');
    const priceEl = $('label-preview-price');

    // Barcode visibility and generation
    if (showBarcode && code && typeof JsBarcode !== 'undefined') {
        try {
            JsBarcode(svgElement, code, {
                format: getBarcodeFormat(code),
                width: 1.5,
                height: 40,
                displayValue: true,
                fontSize: 10,
                margin: 5
            });
            svgElement.style.display = 'block';
        } catch (e) {
            svgElement.innerHTML = '<text x="50%" y="50%" text-anchor="middle">Không có mã vạch</text>';
            svgElement.style.display = 'block';
        }
    } else if (showBarcode && !code) {
        svgElement.innerHTML = '<text x="50%" y="50%" text-anchor="middle" font-size="12">Chưa có mã vạch</text>';
        svgElement.style.display = 'block';
    } else {
        svgElement.style.display = 'none';
    }

    // Name visibility
    nameEl.textContent = labelProduct.name;
    nameEl.style.display = showName ? 'block' : 'none';

    // Price visibility
    priceEl.textContent = money(labelProduct.price);
    priceEl.style.display = showPrice ? 'block' : 'none';
}

// Print label - supports thermal label printers with CSS Grid layout (3 columns on 110mm)
function printLabel() {
    if (!labelProduct) return;

    const qty = parseInt($('label-quantity').value) || 1;
    const size = $('label-size')?.value || $('set-label-size')?.value || '35x22';
    const code = labelProduct.code || '';
    const name = labelProduct.name || 'Sản phẩm';
    const safeCode = escapeHtml(code);
    const safeName = escapeHtml(name);
    const price = labelProduct.price || 0;

    // Get format options from checkboxes (with safe defaults)
    const showBarcode = $('label-show-barcode')?.checked !== false;
    const showName = $('label-show-name')?.checked !== false;
    const showPrice = $('label-show-price')?.checked === true;

    // Fixed dimensions for 110mm paper with 3 columns (matching PO batch print)
    const paperWidthMM = 110;
    const labelWidthMM = getLabelWidth(size); // 35mm
    const labelHeightMM = getLabelHeight(size); // 22mm
    const columnsPerRow = 3;
    const marginLeftMM = (paperWidthMM - (labelWidthMM * columnsPerRow)) / 2; // ~2.5mm

    // Generate barcode SVG
    function generateBarcodeSvg(barcodeCode) {
        if (!barcodeCode || typeof JsBarcode !== 'function') return '';
        try {
            const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            JsBarcode(tempSvg, barcodeCode, {
                format: getBarcodeFormat(barcodeCode),
                width: 1.5, height: 18, displayValue: false, margin: 0,
                background: '#ffffff', lineColor: '#000000'
            });
            return tempSvg.outerHTML;
        } catch (e) { return '<span class="no-barcode">Lỗi mã</span>'; }
    }

    // Generate labels HTML using CSS Grid (matching working PO batch print)
    const barcodeHtml = showBarcode ? (code ? generateBarcodeSvg(code) : '<div class="no-barcode">Không có mã</div>') : '';
    const priceText = money(price);

    let labelsHtml = '';
    for (let i = 0; i < Math.min(qty, 100); i++) {
        labelsHtml += `<div class="label">
            ${showName ? `<div class="label-name">${safeName}</div>` : ''}
            ${showBarcode ? `<div class="barcode-container">${barcodeHtml}</div>` : ''}
            ${showBarcode && code ? `<div class="label-code">${safeCode}</div>` : ''}
            ${showPrice ? `<div class="label-price">${priceText}</div>` : ''}
        </div>`;
    }

    // Use iframe approach for Electron compatibility
    let printIframe = document.getElementById('label-print-iframe');
    if (!printIframe) {
        printIframe = document.createElement('iframe');
        printIframe.id = 'label-print-iframe';
        printIframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;border:none;background:#f0f0f0;';
        document.body.appendChild(printIframe);
    } else {
        printIframe.style.display = 'block';
    }

    const printContent = `<!DOCTYPE html><html><head>
<meta charset="UTF-8">
<title>In tem - ${safeName}</title>
<style>
    /* Reset */
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    /* Page setup for thermal printer */
    @page { 
        size: ${paperWidthMM}mm auto; 
        margin: 0; 
    }
    
    body { 
        margin: 0; 
        padding: 0; 
        font-family: Arial, sans-serif; 
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        width: ${paperWidthMM}mm;
    }
    
    /* CSS Grid container - exact positioning for 3 columns */
    .label-container { 
        width: ${paperWidthMM}mm;
        padding-left: ${marginLeftMM}mm;
        padding-right: ${marginLeftMM}mm;
        display: grid;
        grid-template-columns: repeat(${columnsPerRow}, ${labelWidthMM}mm);
        grid-auto-rows: ${labelHeightMM}mm;
        gap: 0;
    }
    
    /* Each label cell */
    .label { 
        width: ${labelWidthMM}mm; 
        height: ${labelHeightMM}mm;
        padding: 0.8mm;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        overflow: hidden !important;
        background: white;
        contain: strict;
        clip-path: inset(0);
    }
    
    /* Product name */
    .label-name { 
        font-size: 6pt; 
        font-weight: bold; 
        text-align: center;
        width: 100%;
        max-width: ${labelWidthMM - 2}mm;
        max-height: 5.5mm;
        overflow: hidden !important;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        line-height: 1.15;
        margin-bottom: 0.5mm;
    }
    
    /* Barcode container */
    .barcode-container {
        width: 100%;
        max-width: ${labelWidthMM - 2}mm;
        height: 6mm;
        max-height: 6mm;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden !important;
    }
    
    .barcode-container svg {
        max-width: ${labelWidthMM - 3}mm;
        height: 6mm !important;
        max-height: 6mm !important;
    }
    
    /* Barcode number */
    .label-code { 
        font-size: 5pt; 
        text-align: center; 
        font-weight: 600;
        max-width: ${labelWidthMM - 2}mm;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        height: 2.5mm;
        line-height: 2.5mm;
    }
    
    /* Price */
    .label-price { 
        font-size: 8pt; 
        font-weight: bold; 
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        height: 3.5mm;
        line-height: 3.5mm;
    }
    
    .no-barcode { font-size: 5pt; color: #666; }
    
    /* Preview controls */
    .preview-controls { 
        position: fixed; top: 0; left: 0; right: 0; 
        background: linear-gradient(135deg, #6366F1, #8B5CF6); 
        color: white; padding: 12px 20px; 
        display: flex; justify-content: space-between; align-items: center; 
        z-index: 1000; 
    }
    .preview-controls button { 
        padding: 8px 16px; border: none; border-radius: 6px; 
        cursor: pointer; font-weight: 600; margin-left: 8px; 
    }
    .btn-print { background: #10B981; color: white; }
    .btn-close { background: #EF4444; color: white; }
    
    /* Print specific rules */
    @media print {
        .preview-controls { display: none !important; }
        body { 
            padding: 0 !important; 
            margin: 0 !important;
            width: ${paperWidthMM}mm !important;
        }
    }
    
    /* Screen preview */
    @media screen {
        body { background: #e5e5e5; padding: 60px 20px 20px 20px; }
        .label-container { background: #fff; margin: 0 auto; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
        .label { border: 1px dashed #ccc; }
    }
</style>
</head>
<body>
    <div class="preview-controls">
        <span>📋 ${qty} tem (${labelWidthMM}x${labelHeightMM}mm) - ${safeName}</span>
        <div>
            <button class="btn-print" id="print-btn">🖨️ In</button>
            <button class="btn-close" id="close-btn">✕ Đóng</button>
        </div>
    </div>
    
    <div class="label-container">
        ${labelsHtml}
    </div>
</body>
</html>`;

    // Write content to iframe
    const iframeDoc = printIframe.contentDocument || printIframe.contentWindow?.document;
    if (!iframeDoc) { toast('Không thể tạo tài liệu in!', 'error'); return; }
    iframeDoc.open();
    iframeDoc.write(printContent);
    iframeDoc.close();

    // Wait for iframe to load then setup event handlers
    setTimeout(() => {
        const printBtn = iframeDoc.getElementById('print-btn');
        const closeBtn = iframeDoc.getElementById('close-btn');

        if (printBtn) {
            printBtn.onclick = function () {
                printIframe.contentWindow.print();
            };
        }
        if (closeBtn) {
            closeBtn.onclick = function () {
                printIframe.style.display = 'none';
            };
        }

        // Handle afterprint event
        printIframe.contentWindow.onafterprint = function () {
            printIframe.style.display = 'none';
        };
    }, 100);

    logActivity('In tem', `${qty}x ${name} (${size})`);
    closeModal('label-print-modal');
    toast(`Đã mở preview ${qty} tem cho: ${name}`, "info");
}

// Generate label HTML in grid layout (3 columns for 110mm paper)
function generateLabelGridHTML(code, name, price, qty, columns, showBarcode, showName, showPrice) {
    const priceText = typeof money === 'function' ? money(price) : (price?.toLocaleString('vi-VN') + ' VNĐ');
    const safeCode = escapeHtml(code || '');
    const safeName = escapeHtml(name || '');

    let html = '';
    for (let i = 0; i < qty; i++) {
        html += `
            <div class="label">
                ${showName ? `<div class="label-name">${safeName}</div>` : ''}
                ${showBarcode ? (code ? '<svg class="barcode-svg"></svg>' : '<div class="no-barcode">Không có mã</div>') : ''}
                ${showBarcode && code ? `<div class="label-code">${safeCode}</div>` : ''}
                ${showPrice ? `<div class="label-price">${priceText}</div>` : ''}
            </div>
        `;
    }
    return html;
}

// Generate label HTML
function generateLabelHTML(code, name, price, size, qty, showBarcode, showName, showPrice) {
    // Format price for display
    const priceText = typeof money === 'function' ? money(price) : (price?.toLocaleString('vi-VN') + ' ₫');
    const safeName = escapeHtml(name || '');

    let html = '';
    for (let i = 0; i < qty; i++) {
        html += `
            <div class="label">
                ${showBarcode ? (code ? '<svg class="barcode-svg"></svg>' : '<div style="font-size:10pt; color:#666;">Không có mã vạch</div>') : ''}
                ${showName ? `<div class="label-name">${safeName}</div>` : ''}
                ${showPrice ? `<div class="label-price">${priceText}</div>` : ''}
            </div>
        `;
    }
    return html;
}

// Label size helpers - returns actual label dimensions for thermal printers
// NOTE: 35x22 or 22x35 labels are LANDSCAPE (35mm wide x 22mm tall)
function getLabelWidth(size) {
    // Width in mm - 35mm for standard 22x35/35x22 labels
    const sizes = { '22x35': 35, '35x22': 35, '30x20': 30, '40x25': 40, '50x30': 50, '60x40': 60, '100x50': 100 };
    return sizes[size] || 35;
}

function getLabelHeight(size) {
    // Height in mm - 22mm for standard 22x35/35x22 labels
    const sizes = { '22x35': 22, '35x22': 22, '30x20': 20, '40x25': 25, '50x30': 30, '60x40': 40, '100x50': 50 };
    return sizes[size] || 22;
}

function getLabelPageSize(size) {
    return `${getLabelWidth(size)}mm ${getLabelHeight(size)}mm`;
}

// Check label printer status and connection
let labelPrinterStatus = { connected: false, name: '', type: '' };
const SYSTEM_DEFAULT_PRINTER_DETAIL = 'Sẽ sử dụng máy in mặc định của hệ thống';

function checkLabelPrinter() {
    const indicatorEl = $('label-printer-indicator');
    const nameEl = $('label-printer-name');
    const detailEl = $('label-printer-detail');

    if (!indicatorEl) return;

    // Show checking status
    indicatorEl.style.color = 'var(--warning)';
    indicatorEl.textContent = '●';
    nameEl.textContent = 'Đang kiểm tra máy in...';
    detailEl.textContent = 'Vui lòng đợi';

    // Check for printers using browser API
    if (typeof navigator !== 'undefined') {
        // Try to detect available printers
        const checkPrinters = async () => {
            try {
                // Get list of detected printers from our device list
                const printers = detectedDevices.filter(d =>
                    d.type === 'label' || d.type === 'thermal' || d.type === 'regular'
                );

                // Find label printers specifically
                const labelPrinters = printers.filter(d => d.type === 'label');
                const otherPrinters = printers.filter(d => d.type !== 'label' && d.type !== 'virtual');

                if (labelPrinters.length > 0) {
                    // Found label printer
                    const printer = labelPrinters[0];
                    labelPrinterStatus = {
                        connected: true,
                        name: printer.displayName || printer.name,
                        type: 'label'
                    };
                    indicatorEl.style.color = 'var(--success)';
                    indicatorEl.textContent = '●';
                    nameEl.textContent = `✅ ${printer.displayName || printer.name}`;
                    detailEl.textContent = 'Máy in tem sẵn sàng';
                } else if (otherPrinters.length > 0) {
                    // Found other printers
                    const printer = otherPrinters[0];
                    labelPrinterStatus = {
                        connected: true,
                        name: printer.displayName || printer.name,
                        type: 'regular'
                    };
                    indicatorEl.style.color = 'var(--info)';
                    indicatorEl.textContent = '●';
                    nameEl.textContent = `🖨️ ${printer.displayName || printer.name}`;
                    detailEl.textContent = 'Sử dụng máy in thường (cần chọn khổ giấy phù hợp)';
                } else if (printers.length === 0 && detectedDevices.length === 0) {
                    // No printers detected - check if we can print anyway
                    labelPrinterStatus = {
                        connected: true,
                        name: 'Máy in mặc định hệ thống',
                        type: 'system'
                    };
                    indicatorEl.style.color = 'var(--primary)';
                    indicatorEl.textContent = '●';
                    nameEl.textContent = '🖨️ Máy in mặc định hệ thống';
                    detailEl.textContent = SYSTEM_DEFAULT_PRINTER_DETAIL;
                } else {
                    // No printer found
                    labelPrinterStatus = { connected: false, name: '', type: '' };
                    indicatorEl.style.color = 'var(--danger)';
                    indicatorEl.textContent = '●';
                    nameEl.textContent = '❌ Không tìm thấy máy in';
                    detailEl.textContent = 'Kiểm tra kết nối và driver máy in';
                }
            } catch (error) {
                console.error('Error checking printers:', error);
                // Fallback to system default
                labelPrinterStatus = {
                    connected: true,
                    name: 'Máy in mặc định hệ thống',
                    type: 'system'
                };
                indicatorEl.style.color = 'var(--primary)';
                indicatorEl.textContent = '●';
                nameEl.textContent = '🖨️ Máy in mặc định hệ thống';
                detailEl.textContent = SYSTEM_DEFAULT_PRINTER_DETAIL;
            }
        };

        // Run printer check
        setTimeout(checkPrinters, 300);
    }
}

// ========== MODIFY EXISTING FUNCTIONS ==========

// Override openProdModal to reset barcode preview and auto-focus
const originalOpenProdModal = openProdModal;
openProdModal = function () {
    originalOpenProdModal();
    const container = $('barcode-preview-container');
    if (container) container.style.display = 'none';
    // Auto-focus on product name input after modal animation completes
    setTimeout(() => {
        const nameInput = $('p-name');
        if (nameInput) {
            nameInput.focus();
            nameInput.select();
        }
    }, 100);
};

// Override editP to show barcode preview
const originalEditP = editP;
editP = function (id) {
    originalEditP(id);
    const p = db.products.find(x => sameStoredId(x.id, id));
    if (p && p.code) {
        updateBarcodePreview(p.code);
    }
};

// Override saveProd to auto-generate barcode for new products
const originalSaveProd = saveProd;
saveProd = function () {
    const id = $('p-id').value;
    let code = $('p-code').value.trim();

    // If new product and no code, generate one
    if (!id && !code) {
        code = generateEAN13();
        $('p-code').value = code;
    }

    return originalSaveProd();
};

// ═══════════════════════════════════════════════════════════════════════════
// HELP SECTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function toggleHelpSection(header) {
    const section = header.closest('.help-section');
    section.classList.toggle('expanded');
}

// Toggle help item in inline accordion (Settings)
function toggleHelpItem(header) {
    const item = header.closest('.help-item');
    item.classList.toggle('active');
}

// Search help inline (Settings)
function searchHelpInline(query) {
    const items = document.querySelectorAll('#help-accordion-inline .help-item');
    const q = query.toLowerCase().trim();

    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        if (q === '' || text.includes(q)) {
            item.style.display = '';
            if (q !== '') item.classList.add('active');
        } else {
            item.style.display = 'none';
        }
    });
}

function searchHelp(query) {
    const sections = document.querySelectorAll('.help-section');
    const q = query.toLowerCase().trim();

    sections.forEach(section => {
        const keywords = section.dataset.keywords || '';
        const headerText = section.querySelector('.help-section-header')?.textContent || '';
        const contentText = section.querySelector('.help-section-content')?.textContent || '';
        const searchText = (keywords + ' ' + headerText + ' ' + contentText).toLowerCase();

        if (q === '' || searchText.includes(q)) {
            section.style.display = '';
            if (q !== '') {
                section.classList.add('expanded');
                section.classList.add('help-highlight');
                setTimeout(() => section.classList.remove('help-highlight'), 1000);
            }
        } else {
            section.style.display = 'none';
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// PURCHASE ORDER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

let currentPOItems = [];
let currentViewPOId = null;

function isStockHistoryForPurchaseOrder(entry, purchaseOrder) {
    if (!entry || !purchaseOrder) return false;
    if (entry.purchaseOrderId && sameStoredId(entry.purchaseOrderId, purchaseOrder.id)) return true;
    return [
        `Đơn nhập: ${purchaseOrder.code}`,
        `Sửa đơn nhập: ${purchaseOrder.code}`,
        `Nhập hàng - ${purchaseOrder.code} (khôi phục)`
    ].includes(entry.note);
}

function openPurchaseOrderModal() {
    if (!canMutateManagement()) return;
    editingPOId = null;
    skipPOAutoSave = false;
    $('purchase-order-modal').classList.add('active');

    // Generate PO code
    const now = getAppDate();
    const dateStr = toLocalDateStr(now).replace(/-/g, '');
    const codePrefix = `PN-${dateStr}-`;
    const existingCodes = new Set((db.purchaseOrders || []).map(po => po.code));
    (db.stockHistory || []).forEach(entry => {
        const matchedCode = String(entry.note || '').match(/PN-\d{8}-\d+/)?.[0];
        if (matchedCode) existingCodes.add(matchedCode);
    });
    let seq = 1;
    while (existingCodes.has(`${codePrefix}${String(seq).padStart(4, '0')}`)) seq++;
    $('po-code').value = `${codePrefix}${String(seq).padStart(4, '0')}`;

    // Set current datetime
    $('po-date').value = toLocalDateTimeStr(now);

    // Populate suppliers
    const supSel = $('po-supplier');
    supSel.innerHTML = '<option value="">-- Chọn NCC --</option>' +
        (db.suppliers || []).map(s => `<option value="${escapeAttr(String(s.id ?? ''))}">${escapeHtml(s.name)}</option>`).join('');

    // Clear items
    currentPOItems = [];
    $('po-note').value = '';
    if ($('po-is-paid')) $('po-is-paid').checked = false;
    $('po-product-search').value = '';
    $('po-product-list').style.display = 'none';

    renderPOItems();

    // Auto-focus search input for better UX
    setTimeout(() => $('po-product-search')?.focus(), 100);
}

function filterPOProducts() {
    const search = ($('po-product-search')?.value || '').toLowerCase().trim();
    const listEl = $('po-product-list');
    if (!listEl) return;

    if (search.length === 0) {
        listEl.style.display = 'none';
        return;
    }

    // Fuzzy search: split search into keywords and match products containing ALL keywords
    const keywords = search.split(/\s+/).filter(k => k.length > 0);

    const fuzzyMatch = (text, kws) => {
        const textLower = text.toLowerCase();
        return kws.every(kw => textLower.includes(kw));
    };

    const filtered = db.products.filter(p =>
        fuzzyMatch(p.name, keywords) ||
        (p.code || '').toLowerCase().includes(search) ||
        (p.barcode || '').toLowerCase().includes(search)
    ).slice(0, 15);

    if (filtered.length === 0) {
        // Show "Add new product" option when no products found
        listEl.innerHTML = `
            <div style="padding:16px; text-align:center;">
                <div style="color:var(--text-muted); margin-bottom:12px;">Không tìm thấy sản phẩm "${escapeHtml(search)}"</div>
                <button class="btn btn-sm" onclick="openQuickAddProductFromPO('${escapeJsString(search)}')" 
                        style="background:linear-gradient(135deg, var(--success), #059669);">
                    ➕ Thêm sản phẩm mới
                </button>
            </div>`;
    } else {
        // Show "Add new product" option at the TOP for better accessibility (Issue #4)
        listEl.innerHTML = `
            <div class="po-quick-add-header" onclick="openQuickAddProductFromPO('${escapeJsString(search)}')">
                <span class="icon">➕</span>
                <span class="text">Thêm nhanh sản phẩm mới "${escapeHtml(search)}"</span>
            </div>` +
            filtered.map(p => {
            const productIdJs = escapeJsArgument(p.id);
            return `
            <div class="po-product-item" onclick="addProductToPO(${productIdJs})">
                <div style="font-weight:600;">${escapeHtml(p.name)}</div>
                <div style="font-size:12px; color:var(--text-muted);">
                    Mã: ${escapeHtml(p.code || 'N/A')} | Tồn: ${formatQty(p.stock)} | Giá vốn: ${money(p.cost || 0)}
                </div>
            </div>
        `;
        }).join('');
    }

    listEl.style.display = 'block';
}

// Quick add product from Purchase Order modal
let pendingPOProductName = '';

function openQuickAddProductFromPO(searchText) {
    pendingPOProductName = searchText || '';
    $('po-product-list').style.display = 'none';

    // Apply blur effect to PO modal (keep visible but blurred in background)
    const poModal = $('purchase-order-modal');
    if (poModal) {
        poModal.classList.add('modal-blurred');
    }

    // Open the product modal with pre-filled name
    openProdModal();

    // Ensure product modal is on top of the blurred PO modal
    const prodModal = $('prod-modal');
    if (prodModal) {
        prodModal.style.zIndex = '600';
    }

    // Pre-fill the product name
    if (pendingPOProductName) {
        $('p-name').value = pendingPOProductName;
    }

    // Store that we're adding from PO
    sessionStorage.setItem('addingFromPO', 'true');
}

// Override saveProd to handle adding from PO
const originalSaveProdForPO = saveProd;
saveProd = function () {
    const isFromPO = sessionStorage.getItem('addingFromPO') === 'true';
    const productName = $('p-name').value.trim();

    // Call original save
    const saved = originalSaveProdForPO();
    if (!saved) return false;

    // If we were adding from PO, add the new product to the PO
    if (isFromPO && productName) {
        sessionStorage.removeItem('addingFromPO');

        // Remove blur effect from PO modal
        const poModal = $('purchase-order-modal');
        if (poModal) {
            poModal.classList.remove('modal-blurred');
        }

        // Find the newly added product
        const newProduct = db.products.find(p => p.name === productName);
        if (newProduct) {
            // Add to PO items
            setTimeout(() => {
                addProductToPO(newProduct.id);
                toast(`Đã thêm "${productName}" vào đơn nhập!`);
            }, 100);
        }
    }
    return true;
};

// Restore PO modal if prod modal is closed without saving
const originalCloseModal = closeModal;
closeModal = function (id) {
    // Auto-save PO draft if closing purchase-order-modal with items
    if (id === 'purchase-order-modal' && typeof autoSavePOAsDraft === 'function') {
        autoSavePOAsDraft();
    }
    originalCloseModal(id);

    // If closing prod-modal and we were adding from PO, restore PO modal
    if (id === 'prod-modal') {
        const isFromPO = sessionStorage.getItem('addingFromPO') === 'true';
        if (isFromPO) {
            sessionStorage.removeItem('addingFromPO');
            const poModal = $('purchase-order-modal');
            if (poModal) {
                poModal.classList.remove('modal-blurred');
            }
        }
    }
};

function addProductToPO(productId) {
    const p = db.products.find(x => sameStoredId(x.id, productId));
    if (!p) return;

    // Check if already in list
    const existing = currentPOItems.find(i => sameStoredId(i.productId, productId));
    if (existing) {
        existing.qty += 1;
        existing.total = existing.qty * existing.price;
    } else {
        currentPOItems.unshift({ // Add new items at the top
            productId: p.id,
            productName: p.name,
            productCode: p.code || '',
            qty: 1,
            price: p.cost || 0,
            sellPrice: p.price || 0, // Giá bán hiện tại
            total: p.cost || 0
        });
    }

    $('po-product-search').value = '';
    $('po-product-list').style.display = 'none';
    renderPOItems();
}

function updatePOItemQty(index, qty) {
    if (index < 0 || index >= currentPOItems.length) return;
    qty = parseFloat(qty) || 0;
    if (qty <= 0) {
        removeFromPO(index);
        return;
    }
    currentPOItems[index].qty = qty;
    currentPOItems[index].total = qty * currentPOItems[index].price;
    renderPOItems();
}

function updateNewPOItemPrice(index, priceStr) {
    if (index < 0 || index >= currentPOItems.length) return;
    const price = parseInt((priceStr || '0').replace(/\D/g, '')) || 0;
    currentPOItems[index].price = price;
    currentPOItems[index].total = currentPOItems[index].qty * price;
    renderPOItems();
}

function removeFromPO(index) {
    if (index < 0 || index >= currentPOItems.length) return;
    currentPOItems.splice(index, 1);
    renderPOItems();
}

// Update selling price for PO item
function updatePOItemSellPrice(index, priceStr) {
    if (index < 0 || index >= currentPOItems.length) return;
    const price = parseInt(priceStr.replace(/[.,\s]/g, '')) || 0;
    currentPOItems[index].sellPrice = price;
    // Note: sellPrice doesn't affect total, it's just for updating product price later
}

function renderPOItems() {
    const tbody = $('po-items-body');
    if (!tbody) return;

    if (currentPOItems.length === 0) {
        tbody.innerHTML = `<tr id="po-empty-row" class="po-empty-row">
            <td colspan="7" class="po-empty-cell">
                Chưa có sản phẩm. Tìm và thêm sản phẩm ở trên.
            </td>
        </tr>`;
    } else {
        tbody.innerHTML = currentPOItems.map((item, idx) => `
            <tr>
                <td style="text-align:center">${idx + 1}</td>
                <td>
                    <div style="font-weight:600; cursor:pointer; color:var(--primary); text-decoration:underline dotted;"
                         onclick="openQuickEditProduct(${escapeJsArgument(item.productId)}, event)"
                         title="Click để sửa nhanh sản phẩm">${escapeHtml(item.productName)}</div>
                    <div style="font-size:11px; color:var(--text-muted)">${escapeHtml(item.productCode)}</div>
                </td>
                <td style="text-align:center">
                    <input type="number" class="qty-input" value="${item.qty}" min="0.001" step="0.001"
                           onchange="updatePOItemQty(${idx}, this.value)" onfocus="this.select()">
                </td>
                <td style="text-align:right">
                    <input type="text" class="price-input" value="${item.price.toLocaleString('vi-VN')}" 
                           oninput="formatMoneyInput(this)" 
                           onchange="updateNewPOItemPrice(${idx}, this.value)" onfocus="this.select()">
                </td>
                <td style="text-align:right">
                    <input type="text" class="price-input" value="${(item.sellPrice || 0).toLocaleString('vi-VN')}" 
                           oninput="formatMoneyInput(this)" 
                           onchange="updatePOItemSellPrice(${idx}, this.value)" onfocus="this.select()"
                           style="color:var(--success);">
                </td>
                <td style="text-align:right; font-weight:600; color:var(--primary)">${money(item.total)}</td>
                <td style="text-align:center">
                    <button class="remove-btn" onclick="removeFromPO(${idx})" title="Xóa">✕</button>
                </td>
            </tr>
        `).join('');
    }

    // Update summary
    const itemCount = currentPOItems.length;
    const totalQty = currentPOItems.reduce((a, b) => a + b.qty, 0);
    const totalAmount = currentPOItems.reduce((a, b) => a + b.total, 0);

    $('po-item-count').innerText = itemCount.toLocaleString('vi-VN');
    $('po-total-qty').innerText = totalQty.toLocaleString('vi-VN');
    $('po-total-amount').innerText = money(totalAmount);
}

// ========== QUICK EDIT PRODUCT FROM PO ==========

function openQuickEditProduct(productId, event) {
    const p = db.products.find(x => sameStoredId(x.id, productId));
    if (!p) return toast("Không tìm thấy sản phẩm!", "error");

    $('qe-product-id').value = p.id;
    $('qe-name').value = p.name;
    $('qe-stock').value = p.stock || 0;
    $('qe-unit').value = p.unit || '';
    $('qe-price').value = p.price ? p.price.toLocaleString('vi-VN') : '0';
    $('qe-cost').value = p.cost ? p.cost.toLocaleString('vi-VN') : '0';
    $('qe-wholesale').value = p.wholesalePrice ? p.wholesalePrice.toLocaleString('vi-VN') : '0';

    window._qeOldStock = p.stock || 0;
    window._qeOldName = p.name;

    const popup = $('quick-edit-product-popup');
    if (!popup) return;
    const overlay = $('quick-edit-overlay');
    if (overlay) overlay.style.display = 'block';
    popup.style.display = 'block';
}

function closeQuickEditProduct() {
    const popup = $('quick-edit-product-popup');
    if (popup) popup.style.display = 'none';
    const overlay = $('quick-edit-overlay');
    if (overlay) overlay.style.display = 'none';
    delete window._qeOldStock;
    delete window._qeOldName;
}

function saveQuickEditProduct() {
    if (!canMutateManagement()) return;

    const id = $('qe-product-id').value;
    const idx = db.products.findIndex(x => sameStoredId(x.id, id));
    if (idx === -1) return toast("Không tìm thấy sản phẩm!", "error");

    const name = $('qe-name').value.trim();
    const newStock = parseFloat($('qe-stock').value) || 0;
    const unit = $('qe-unit').value.trim();
    const price = parseInt(($('qe-price').value || '0').replace(/\D/g, '')) || 0;
    const cost = parseInt(($('qe-cost').value || '0').replace(/\D/g, '')) || 0;
    const wholesalePrice = parseInt(($('qe-wholesale').value || '0').replace(/\D/g, '')) || 0;

    if (!name) return toast("Tên sản phẩm không được để trống!", "error");
    if (!price) return toast("Giá bán không được để trống!", "error");

    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;
    const poItemsBeforeEdit = currentPOItems.map(item => ({ ...item }));

    const p = db.products[idx];
    const oldStock = window._qeOldStock || 0;

    // Update product
    p.name = name;
    p.stock = newStock;
    p.unit = unit;
    p.price = price;
    p.cost = cost;
    p.wholesalePrice = wholesalePrice;

    // Create stock history if stock changed
    if (newStock !== oldStock) {
        const diff = newStock - oldStock;
        db.stockHistory.unshift({
            id: Date.now() + Math.random(),
            date: getAppDate().toISOString(),
            type: diff > 0 ? 'in' : 'out',
            productId: p.id,
            productName: p.name,
            qty: Math.abs(diff),
            price: p.cost,
            total: Math.abs(diff) * p.cost,
            note: 'Điều chỉnh tồn kho (sửa nhanh từ đơn nhập)',
            user: currUser?.name || '',
            source: 'adjustment'
        });
    }

    // Update PO items if name/code/prices changed
    currentPOItems.forEach(item => {
        if (sameStoredId(item.productId, p.id)) {
            item.productName = p.name;
            item.productCode = p.code || '';
            item.sellPrice = p.price;       // sync giá bán
            item.price = p.cost;            // sync giá nhập
            item.total = item.qty * item.price; // recalculate thành tiền
        }
    });

    logActivity('Sửa nhanh SP', `${p.name} - Tồn kho: ${oldStock} → ${newStock}`);
    if (!saveInventoryCommit(inventoryCommit)) {
        currentPOItems = poItemsBeforeEdit;
        return;
    }

    // Refresh all related views
    renderPOItems();
    if (typeof renderProdTable === 'function') renderProdTable();
    if (typeof renderPos === 'function') renderPos();
    if (typeof renderInventory === 'function') renderInventory();
    if (typeof renderDashboard === 'function') renderDashboard();
    if (typeof renderInventoryStockHistory === 'function') renderInventoryStockHistory();

    closeQuickEditProduct();
    toast("Đã cập nhật sản phẩm!");
}

function savePurchaseOrder() {
    if (!canMutateManagement()) return;
    if (currentPOItems.length === 0) {
        return toast("Vui lòng thêm ít nhất 1 sản phẩm!", "error");
    }

    const supplierId = $('po-supplier').value;
    const supplier = db.suppliers?.find(s => sameStoredId(s.id, supplierId));
    const poCode = $('po-code').value.trim();
    if (!poCode) return toast("Mã đơn nhập không được để trống!", "error");
    if ((db.purchaseOrders || []).some(po => po.code === poCode && !sameStoredId(po.id, editingPOId))) {
        return toast(`Mã đơn nhập "${poCode}" đã tồn tại!`, "error");
    }

    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;

    const totalQty = currentPOItems.reduce((a, b) => a + b.qty, 0);
    const totalAmount = currentPOItems.reduce((a, b) => a + b.total, 0);

    const po = {
        id: 'PO-' + Date.now(),
        code: $('po-code').value,
        date: $('po-date').value ? new Date($('po-date').value).toISOString() : getAppDate().toISOString(),
        supplierId: supplier?.id ?? null,
        supplierName: supplier?.name || 'Không xác định',
        items: currentPOItems.map(i => ({ ...i })),
        totalQty: totalQty,
        totalAmount: totalAmount,
        isPaid: $('po-is-paid')?.checked || false,
        note: $('po-note').value,
        user: currUser?.name || '',
        createdAt: getAppDate().toISOString()
    };

    // Initialize purchaseOrders array if needed
    if (!db.purchaseOrders) db.purchaseOrders = [];
    db.purchaseOrders.unshift(po);

    // Update stock for each product
    currentPOItems.forEach(item => {
        const p = db.products.find(x => sameStoredId(x.id, item.productId));
        if (p) {
            p.stock += item.qty;
            if (item.price > 0) p.cost = item.price;
            // Update selling price if specified
            if (item.sellPrice > 0) p.price = item.sellPrice;

            // Add to stock history
            if (!db.stockHistory) db.stockHistory = [];
            db.stockHistory.unshift({
                id: Date.now() + Math.random(),
                date: po.date,
                type: 'in',
                productId: item.productId,
                productName: item.productName,
                qty: item.qty,
                price: item.price,
                sellPrice: item.sellPrice || 0, // Track selling price in history
                total: item.total,
                supplierId: po.supplierId,
                note: `Đơn nhập: ${po.code}`,
                user: currUser?.name || ''
            });
        }
    });

    logActivity('Nhập hàng', `Đơn ${po.code} - ${money(totalAmount)}`);
    if (!saveInventoryCommit(inventoryCommit)) return;

    skipPOAutoSave = true; // Prevent auto-save draft when closing (order already saved)
    currentPOItems = []; // Clear items before closing to prevent auto-draft
    closeModal('purchase-order-modal');
    toast(`Đã lưu đơn nhập hàng! Tổng: ${money(totalAmount)}`);

    // Defer heavy render calls to avoid blocking the UI thread
    setTimeout(() => {
        renderInventory();
        renderManagement();
        renderPos();
    }, 50);
}

function openPOHistoryModal() {
    $('po-history-modal').classList.add('active');

    // Set default date range (last 30 days)
    const now = getAppDate();
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    $('po-filter-from').value = toLocalDateStr(from);
    $('po-filter-to').value = toLocalDateStr(now);

    // Populate suppliers filter
    const supSel = $('po-filter-supplier');
    supSel.innerHTML = '<option value="">Tất cả NCC</option>' +
        (db.suppliers || []).map(s => `<option value="${escapeAttr(String(s.id ?? ''))}">${escapeHtml(s.name)}</option>`).join('');

    renderPOHistory();
}

// Track which PO cards are expanded
let expandedPOIds = new Set();

function renderPOHistory() {
    const listEl = $('po-history-list');
    if (!listEl) return;
    const canManage = isAuthenticated && ['admin', 'manager'].includes(currUser?.role);

    const fromDate = parseLocalDateInput($('po-filter-from').value);
    const toDate = parseLocalDateInput($('po-filter-to').value, true);
    const supplierId = $('po-filter-supplier').value;
    const paymentFilter = $('po-filter-payment')?.value || '';

    let orders = db.purchaseOrders || [];

    // Sort by date descending (newest first)
    orders = [...orders].sort((a, b) => new Date(b.date) - new Date(a.date));

    // Filter
    if (fromDate) orders = orders.filter(o => new Date(o.date) >= fromDate);
    if (toDate) orders = orders.filter(o => new Date(o.date) <= toDate);
    if (supplierId) orders = orders.filter(o => String(o.supplierId) === String(supplierId));
    if (paymentFilter === 'paid') orders = orders.filter(o => o.isPaid === true);
    if (paymentFilter === 'unpaid') orders = orders.filter(o => !o.isPaid);

    if (orders.length === 0) {
        listEl.innerHTML = `<div class="po-empty">
            <div class="icon">📦</div>
            <div>Chưa có đơn nhập hàng nào</div>
        </div>`;
        return;
    }

    listEl.innerHTML = orders.map(po => {
        const d = new Date(po.date);
        const dateStr = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
        const isExpanded = expandedPOIds.has(po.id);
        const poIdJs = escapeJsArgument(po.id);

        const paymentBadge = po.isPaid
            ? '<span class="badge badge-success" style="margin-left:8px;">💰 Đã TT</span>'
            : '<span class="badge badge-danger" style="margin-left:8px;">⚠️ Còn nợ</span>';

        // Generate items detail HTML
        const itemsHtml = isExpanded ? `
            <div class="po-items-detail" style="margin-top:12px;padding:12px;background:var(--bg-muted);border-radius:var(--radius-md);">
                <!-- Action buttons at TOP for easy access -->
                <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;padding-bottom:10px;border-bottom:1px solid var(--border-light);">
                    ${canManage ? `<button class="btn btn-sm btn-info" onclick="event.stopPropagation();openBatchLabelSelector(${poIdJs})">🏷️ In tem</button>
                    <button class="btn btn-sm btn-warning" onclick="event.stopPropagation();markPOAsPaid(${poIdJs})">💰 Đánh dấu TT</button>
                    <button class="btn btn-sm" onclick="event.stopPropagation();editPurchaseOrder(${poIdJs})">✏️ Sửa</button>` : ''}
                    <button class="btn btn-sm btn-primary" onclick="event.stopPropagation();viewPurchaseOrder(${poIdJs})">📄 Xem chi tiết</button>
                </div>
                <!-- Products table -->
                <div onclick="togglePOExpand(${poIdJs})" style="cursor:pointer;">
                    <table style="width:100%;font-size:12px;border-collapse:collapse;">
                        <thead>
                            <tr style="border-bottom:1px solid var(--border-light);">
                                <th style="text-align:left;padding:6px 4px;">Sản phẩm</th>
                                <th style="text-align:center;padding:6px 4px;width:50px;">SL</th>
                                <th style="text-align:right;padding:6px 4px;width:80px;">Đơn giá</th>
                                <th style="text-align:right;padding:6px 4px;width:80px;">Giá bán</th>
                                <th style="text-align:right;padding:6px 4px;width:90px;">Thành tiền</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${po.items.map(item => `
                                <tr style="border-bottom:1px dashed var(--border-light);">
                                    <td style="padding:6px 4px;">${escapeHtml(item.productName)}</td>
                                    <td style="text-align:center;padding:6px 4px;">${item.qty}</td>
                                    <td style="text-align:right;padding:6px 4px;">${money(item.price)}</td>
                                    <td style="text-align:right;padding:6px 4px;color:var(--success);">${money(item.sellPrice || 0)}</td>
                                    <td style="text-align:right;padding:6px 4px;font-weight:600;">${money(item.total)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                        <tfoot>
                            <tr style="font-weight:700;">
                                <td colspan="4" style="text-align:right;padding:8px 4px;">Tổng cộng:</td>
                                <td style="text-align:right;padding:8px 4px;color:var(--primary);">${money(po.totalAmount)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        ` : '';


        return `<div class="po-history-card ${isExpanded ? 'expanded' : ''}" style="${isExpanded ? 'border-color:var(--primary);background:var(--bg-surface);' : ''}">
            <div class="po-history-header" onclick="togglePOExpand(${poIdJs})" style="cursor:pointer;">
                <div class="d-flex justify-between items-center">
                    <div>
                        <div class="po-code">
                            <span style="margin-right:8px;transition:transform 0.2s;display:inline-block;${isExpanded ? 'transform:rotate(90deg);' : ''}">${isExpanded ? '▼' : '▶'}</span>
                            ${escapeHtml(po.code)}${paymentBadge}
                        </div>
                        <div class="po-date">📅 ${dateStr}</div>
                    </div>
                    <div class="po-total">${money(po.totalAmount)}</div>
                </div>
                <div class="d-flex justify-between items-center mt-1" style="font-size:13px;">
                    <div class="po-supplier">🏭 ${escapeHtml(po.supplierName)}</div>
                    <div class="d-flex items-center gap-1">
                        <span style="color:var(--text-muted);">📦 ${po.items.length} mặt hàng • ${po.totalQty} SP</span>
                        ${canManage ? `<button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deletePurchaseOrder(${poIdJs})" title="Xóa đơn nhập">🗑️</button>` : ''}
                    </div>
                </div>
            </div>
            ${itemsHtml}
        </div>`;
    }).join('');
}

// Toggle PO expand/collapse
function togglePOExpand(poId) {
    if (expandedPOIds.has(poId)) {
        expandedPOIds.delete(poId);
    } else {
        expandedPOIds.add(poId);
    }
    renderPOHistory();
}

// Delete purchase order with option to revert stock
function deletePurchaseOrder(poId) {
    if (!canMutateManagement()) return;
    const po = (db.purchaseOrders || []).find(o => sameStoredId(o.id, poId));
    if (!po) return toast("Không tìm thấy đơn nhập!", "error");
    let message = `Xóa đơn nhập ${po.code}?\n`;
    message += `• Tổng tiền: ${money(po.totalAmount)}\n`;
    message += `• Số mặt hàng: ${po.items.length}\n\n`;
    message += `Bạn có muốn hoàn lại tồn kho không?\n`;
    message += `• Nhấn OK để xóa VÀ trừ tồn kho\n`;
    message += `• Nhấn Cancel để chỉ xóa đơn nhập`;

    const revertStock = confirm(message);

    if (revertStock) {
        // Revert stock for all items
        po.items.forEach(item => {
            const p = db.products.find(x => sameStoredId(x.id, item.productId));
            if (p) {
                p.stock = toFiniteNumber(p.stock) - toFiniteNumber(item.qty);
            }
        });

        // Also remove related stock history entries
        db.stockHistory = db.stockHistory.filter(h => !isStockHistoryForPurchaseOrder(h, po));

    } else {
        if (!confirm("Chỉ xóa đơn nhập (không thay đổi tồn kho)?")) {
            return;
        }
    }

    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;

    // Push to undo stack before deleting
    pushUndo(UNDO_ACTIONS.DELETE_PURCHASE_ORDER, { po: po, stockReverted: revertStock });

    // Remove purchase order
    db.purchaseOrders = db.purchaseOrders.filter(o => !sameStoredId(o.id, poId));

    logActivity('Xóa đơn nhập', po.code);
    if (!saveInventoryCommit(inventoryCommit)) return;
    renderPOHistory();
    renderInventory();
    renderManagement();
    toast("Đã xóa đơn nhập!");
}

function viewPurchaseOrder(poId) {
    const po = (db.purchaseOrders || []).find(o => sameStoredId(o.id, poId));
    if (!po) return;

    currentViewPOId = po.id;
    const poIdJs = escapeJsArgument(po.id);

    const d = new Date(po.date);
    const dateStr = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

    const content = $('po-view-content');
    content.innerHTML = `
        <div class="po-header-info">
            <div>
                <label class="label">Mã đơn nhập</label>
                <div style="font-weight:700; font-size:16px; color:var(--primary)">${escapeHtml(po.code)}</div>
            </div>
            <div>
                <label class="label">Nhà cung cấp</label>
                <div style="font-weight:600">${escapeHtml(po.supplierName)}</div>
            </div>
            <div>
                <label class="label">Ngày nhập</label>
                <div>${dateStr}</div>
            </div>
            <div>
                <label class="label">Người tạo</label>
                <div>${escapeHtml(po.user || '-')}</div>
            </div>
        </div>
        
        <div style="background:var(--warning-light); padding:8px 12px; border-radius:var(--radius-sm); margin-bottom:12px; font-size:12px;">
            💡 <strong>Mẹo:</strong> Click vào giá để chỉnh sửa, nhấn Enter hoặc Tab để lưu. Giá vốn sản phẩm sẽ được cập nhật tự động.
        </div>
        
        <div class="table-wrap" style="box-shadow:none;">
            <table>
                <thead>
                    <tr>
                        <th>STT</th>
                        <th>Sản phẩm</th>
                        <th style="text-align:center">SL</th>
                        <th style="text-align:right">Giá nhập</th>
                        <th style="text-align:right">Thành tiền</th>
                    </tr>
                </thead>
                <tbody>
                    ${po.items.map((item, idx) => `
                        <tr>
                            <td>${idx + 1}</td>
                            <td>
                                <div style="font-weight:600">${escapeHtml(item.productName)}</div>
                                <div style="font-size:11px; color:var(--text-muted)">${escapeHtml(item.productCode || '')}</div>
                            </td>
                            <td style="text-align:center; font-weight:600">${item.qty.toLocaleString('vi-VN')}</td>
                            <td style="text-align:right">
                                <input type="text" 
                                    id="po-item-price-${idx}" 
                                    value="${item.price.toLocaleString('vi-VN')}" 
                                    style="width:100px; text-align:right; padding:4px 8px; font-size:13px; border:1px solid var(--border-light); border-radius:4px;"
                                    oninput="formatMoneyInput(this)"
                                    onchange="updatePOItemPrice(${poIdJs}, ${idx}, this.value)"
                                    onkeydown="if(event.key==='Enter'){this.blur();}"
                                    onfocus="this.select()">
                            </td>
                            <td style="text-align:right; font-weight:600; color:var(--primary)" id="po-item-total-${idx}">${money(item.total)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        
        <div class="po-summary">
            <div class="po-summary-item">
                <div class="label">Số mặt hàng</div>
                <div class="value">${po.items.length}</div>
            </div>
            <div class="po-summary-item">
                <div class="label">Tổng số lượng</div>
                <div class="value">${po.totalQty.toLocaleString('vi-VN')}</div>
            </div>
            <div class="po-summary-item total">
                <div class="label">💰 TỔNG TIỀN</div>
                <div class="value" id="po-view-total">${money(po.totalAmount)}</div>
            </div>
        </div>
        
        ${po.note ? `<div style="background:var(--bg-muted); padding:12px; border-radius:var(--radius-md); margin-top:12px;">
            <strong>📝 Ghi chú:</strong> ${escapeHtml(po.note)}
        </div>` : ''}
    `;

    closeModal('po-history-modal');
    $('po-view-modal').classList.add('active');
}

// Update price for a PO item and sync with product cost
function updatePOItemPrice(poId, itemIndex, newPriceStr) {
    if (!canMutateManagement()) return;
    const po = (db.purchaseOrders || []).find(o => sameStoredId(o.id, poId));
    if (!po) return;

    const newPrice = parseInt(newPriceStr.replace(/\D/g, '')) || 0;
    const item = po.items[itemIndex];
    if (!item) return;

    const oldPrice = item.price;
    if (oldPrice === newPrice) return; // No change
    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;

    // Update PO item
    item.price = newPrice;
    item.total = newPrice * item.qty;

    // Recalculate PO totals
    po.totalAmount = po.items.reduce((sum, i) => sum + i.total, 0);

    // Update product cost in catalog
    const product = db.products.find(p => sameStoredId(p.id, item.productId));
    if (product) {
        product.cost = newPrice;
        logActivity('Cập nhật giá vốn', `${product.name}: ${money(oldPrice)} → ${money(newPrice)}`);
    }

    if (!saveInventoryCommit(inventoryCommit)) return;
    const totalEl = $(`po-item-total-${itemIndex}`);
    if (totalEl) totalEl.innerText = money(item.total);
    const poTotalEl = $('po-view-total');
    if (poTotalEl) poTotalEl.innerText = money(po.totalAmount);
    toast(`Đã cập nhật giá: ${money(newPrice)}`);
}


function printCurrentPO() {
    const po = (db.purchaseOrders || []).find(o => sameStoredId(o.id, currentViewPOId));
    if (!po) return;

    const d = new Date(po.date);
    const dateStr = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    const s = db.settings;

    let html = `<div class="p-page">
        ${s.name ? `<div class="p-center p-bold" style="font-size:16px">${escapeHtml(s.name)}</div>` : ''}
        ${s.addr ? `<div class="p-center">${escapeHtml(s.addr)}</div>` : ''}
        ${s.phone ? `<div class="p-center">ĐT: ${escapeHtml(s.phone)}</div>` : ''}
        <div class="p-line"></div>
        <div class="p-center p-bold">PHIẾU NHẬP HÀNG</div>
        <div class="p-row"><span>Mã phiếu:</span><span>${escapeHtml(po.code)}</span></div>
        <div class="p-row"><span>Ngày:</span><span>${dateStr}</span></div>
        <div class="p-row"><span>NCC:</span><span>${escapeHtml(po.supplierName)}</span></div>
        <div class="p-row"><span>Người tạo:</span><span>${escapeHtml(po.user || '-')}</span></div>
        <div class="p-line"></div>`;

    po.items.forEach((item, idx) => {
        html += `<div style="font-weight:bold">${idx + 1}. ${escapeHtml(item.productName)}</div>
            <div class="p-row"><span>${item.qty} x ${money(item.price)}</span><span>${money(item.total)}</span></div>`;
    });

    html += `<div class="p-line"></div>
        <div class="p-row"><span>Tổng SL:</span><span>${po.totalQty}</span></div>
        <div class="p-row p-bold" style="font-size:14px"><span>TỔNG TIỀN:</span><span>${money(po.totalAmount)}</span></div>`;

    if (po.note) {
        html += `<div class="p-line"></div><div>Ghi chú: ${escapeHtml(po.note)}</div>`;
    }

    html += `</div>`;

    // Use iframe approach for Electron compatibility instead of window.print()
    let printIframe = document.getElementById('po-print-iframe');
    if (!printIframe) {
        printIframe = document.createElement('iframe');
        printIframe.id = 'po-print-iframe';
        printIframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;border:none;background:#fff;';
        document.body.appendChild(printIframe);
    } else {
        printIframe.style.display = 'block';
    }

    const printContent = `<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Phiếu nhập ${escapeHtml(po.code)}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; page-break-inside: avoid !important; break-inside: avoid !important; }
        @page { size: 80mm auto; margin: 0; }
        html, body { width: 80mm; max-width: 80mm; font-family: Arial, sans-serif; font-size: 12px; line-height: 1.3; color: #000; background: #fff; orphans: 99 !important; widows: 99 !important; }
        body { padding: 3mm; }
        .p-center { text-align: center; margin-bottom: 4px; }
        .p-bold { font-weight: bold; }
        .p-row { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 12px; }
        .p-line { border-bottom: 1px dashed #000; margin: 6px 0; }
        .preview-controls {
            position: fixed; top: 0; left: 0; right: 0;
            background: linear-gradient(135deg, #6366F1, #8B5CF6);
            color: white; padding: 12px 20px;
            display: flex; justify-content: space-between; align-items: center;
            z-index: 1000;
        }
        .preview-controls button {
            padding: 8px 16px; border: none; border-radius: 6px;
            cursor: pointer; font-weight: 600; margin-left: 8px;
        }
        .btn-print { background: #10B981; color: white; }
        .btn-close { background: #EF4444; color: white; }
        @media print {
            .preview-controls { display: none !important; }
            html, body { width: 80mm !important; max-width: 80mm !important; }
            body { padding: 2mm !important; }
        }
        @media screen {
            html, body { width: 100%; max-width: 100%; }
            body { background: #f5f5f5; padding: 80px 20px 20px 20px; display: flex; justify-content: center; }
            .p-page { background: white; padding: 15px; width: 80mm; box-shadow: 0 2px 10px rgba(0,0,0,0.1); border-radius: 4px; }
        }
    </style>
    </head><body>
    <div class="preview-controls">
        <span>📋 Phiếu nhập ${escapeHtml(po.code)}</span>
        <div>
            <button class="btn-print" id="print-btn">🖨️ In</button>
            <button class="btn-close" id="close-btn">✕ Đóng</button>
        </div>
    </div>
    ${html}
    </body></html>`;

    const iframeDoc = printIframe.contentDocument || printIframe.contentWindow?.document;
    if (!iframeDoc) { toast('Không thể tạo tài liệu in!', 'error'); return; }
    iframeDoc.open();
    iframeDoc.write(printContent);
    iframeDoc.close();

    setTimeout(() => {
        const printBtn = iframeDoc.getElementById('print-btn');
        const closeBtn = iframeDoc.getElementById('close-btn');
        if (printBtn) printBtn.onclick = () => printIframe.contentWindow.print();
        if (closeBtn) closeBtn.onclick = () => printIframe.style.display = 'none';
        printIframe.contentWindow.onafterprint = () => printIframe.style.display = 'none';
    }, 100);
}

function exportPOHistoryExcel() {
    const orders = db.purchaseOrders || [];
    if (orders.length === 0) {
        return toast("Không có đơn nhập hàng để xuất!", "warning");
    }

    const headers = ['Mã đơn', 'Ngày nhập', 'Nhà cung cấp', 'Số mặt hàng', 'Tổng SL', 'Tổng tiền', 'Người tạo', 'Ghi chú'];
    const data = orders.map(po => [
        po.code,
        new Date(po.date).toLocaleString('vi-VN'),
        po.supplierName,
        po.items.length,
        po.totalQty,
        po.totalAmount,
        po.user || '',
        po.note || ''
    ]);

    exportToExcel(data, headers, 'DonNhapHang');
}

// ═══════════════════════════════════════════════════════════════════════════
// NEW FEATURES: Delete Invoice, PO Enhancements, Drafts, Payment Status
// ═══════════════════════════════════════════════════════════════════════════

// 1. DELETE INVOICE WITH AUTOMATIC STOCK RETURN
function deleteInvoice(invoiceId) {
    const invoice = db.invoices.find(i => sameStoredId(i.id, invoiceId));
    if (!invoice) return toast("Không tìm thấy hóa đơn!", "error");
    if (blockLinkedInvoiceDeletion([invoice.id])) return;
    const invoiceDisplayId = escapeHtml(String(invoice.id ?? '').slice(-6));
    const invoiceJsId = escapeJsArgument(invoice.id);

    // Create simple confirm modal
    const modalHtml = `
        <div class="modal-overlay active" id="delete-invoice-modal" style="z-index:9999">
            <div class="modal" style="width:400px; max-width:95vw;">
                <div class="modal-header" style="background:linear-gradient(135deg, var(--danger), #DC2626); color:white;">
                    🗑️ Xóa hóa đơn
                    <span onclick="closeModal('delete-invoice-modal')">✕</span>
                </div>
                <div class="modal-body" style="padding:20px;">
                    <div style="text-align:center; margin-bottom:20px;">
                        <div style="font-size:48px; margin-bottom:10px;">⚠️</div>
                        <div style="font-weight:600; font-size:16px;">Bạn có chắc muốn xóa hóa đơn này?</div>
                        <div style="margin-top:10px; padding:10px; background:var(--bg-muted); border-radius:8px;">
                            <div style="font-size:12px; color:var(--text-muted);">Mã hóa đơn</div>
                            <div style="font-size:20px; font-weight:700;">#${invoiceDisplayId}</div>
                            <div style="margin-top:8px; font-size:14px;">Tổng: <strong style="color:var(--primary)">${money(invoice.total)}</strong></div>
                        </div>
                        <div style="margin-top:12px; padding:10px; background:var(--success-light, #d1fae5); border-radius:8px; color:var(--success, #059669); font-weight:600; font-size:13px;">
                            📦 Hàng hóa sẽ được tự động hoàn lại kho
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal('delete-invoice-modal')">Hủy</button>
                    <button class="btn btn-danger" onclick="confirmDeleteInvoice(${invoiceJsId})">🗑️ Xóa hóa đơn</button>
                </div>
            </div>
        </div>
    `;

    // Remove existing modal if any
    const existingModal = $('delete-invoice-modal');
    if (existingModal) existingModal.remove();

    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function confirmDeleteInvoice(invoiceId) {
    const invoice = db.invoices.find(i => sameStoredId(i.id, invoiceId));
    if (!invoice) return;
    const storedInvoiceId = invoice.id;
    if (blockLinkedInvoiceDeletion([storedInvoiceId])) return;
    const historyCommit = beginHistoryCommit();
    if (!historyCommit) return;

    const outstandingItems = getOutstandingInvoiceItems(invoice);

    // Save to undo stack before deleting
    pushUndo(UNDO_ACTIONS.DELETE_INVOICE, { invoice, restoredItems: outstandingItems });

    // Always restore stock automatically + Add stock history
    outstandingItems.forEach(item => {
        const p = db.products.find(x => sameStoredId(x.id, item.id));
        if (p) {
            p.stock += item.qty;
            // Add stock history entry for returned items
            db.stockHistory.unshift({
                id: Date.now() + Math.random(),
                date: getAppDate().toISOString(),
                type: 'in',
                productId: item.id,
                productName: p.name,
                qty: item.qty,
                price: item.price,
                total: item.total || Math.round(item.qty * item.price),
                note: `Hoàn kho - Xóa HĐ ${storedInvoiceId}`,
                user: currUser?.name || '',
                source: 'delete_return'
            });
        }
    });

    reverseInvoiceCustomerEffects(invoice);

    // Remove invoice
    const idx = db.invoices.findIndex(i => sameStoredId(i.id, storedInvoiceId));
    if (idx > -1) db.invoices.splice(idx, 1);

    logActivity('Xóa hóa đơn', `#${String(storedInvoiceId).slice(-6)} - ${money(invoice.total)} (hoàn kho + điểm)`);
    if (!saveHistoryCommit(historyCommit)) return;
    closeModal('delete-invoice-modal');
    renderHist();
    renderPos();
    renderInventory();
    toast("Đã xóa hóa đơn và hoàn trả tồn kho!", "success");
}

// EDIT INVOICE FEATURE
let editingInvoiceId = null;
let editingInvoiceItems = [];

function openEditInvoice(invoiceId) {
    const invoice = db.invoices.find(i => sameStoredId(i.id, invoiceId));
    if (!invoice) return toast("Không tìm thấy hóa đơn!", "error");
    if (hasLinkedReturn(invoice.id)) {
        return toast("Không thể sửa hóa đơn đã phát sinh trả/đổi hàng.", "warning");
    }

    editingInvoiceId = invoiceId;
    editingInvoiceItems = JSON.parse(JSON.stringify(invoice.items)); // Deep copy
    const invoiceDisplayId = escapeHtml(String(invoiceId || '').slice(-6));

    closeModal('invoice-modal');

    const modalHtml = `
        <div class="modal-overlay active" id="edit-invoice-modal" style="z-index:9999">
            <div class="modal" style="width:700px; max-width:95vw;">
                <div class="modal-header" style="background:linear-gradient(135deg, var(--primary), var(--secondary)); color:white;">
                    ✏️ Chỉnh sửa hóa đơn #${invoiceDisplayId}
                    <span onclick="closeModal('edit-invoice-modal')">✕</span>
                </div>
                <div class="modal-body" style="padding:20px; max-height:70vh; overflow-y:auto;">
                    <!-- Customer Info -->
                    <div class="mb-2">
                        <label class="label">Khách hàng</label>
                        <select id="edit-inv-cust" class="input" style="width:100%">
                            ${db.custs.map(c => `<option value="${escapeAttr(String(c.id ?? ''))}" ${sameStoredId(c.id, invoice.custId) || (!invoice.custId && c.name === invoice.cust) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
                        </select>
                    </div>
                    
                    <!-- Items -->
                    <div class="mb-2">
                        <label class="label">Sản phẩm</label>
                        <div id="edit-inv-items" style="border:1px solid var(--border-light); border-radius:8px; overflow:hidden;">
                            <table class="table-sm" style="margin:0;">
                                <thead>
                                    <tr>
                                        <th>Tên SP</th>
                                        <th style="width:80px">SL</th>
                                        <th style="width:120px">Đơn giá</th>
                                        <th style="width:100px">Thành tiền</th>
                                        <th style="width:40px"></th>
                                    </tr>
                                </thead>
                                <tbody id="edit-inv-items-body"></tbody>
                            </table>
                        </div>
                    </div>
                    
                    <!-- Add Product -->
                    <div class="mb-2">
                        <label class="label">Thêm sản phẩm</label>
                        <select id="edit-inv-add-product" class="input" style="width:100%" onchange="addProductToEditInvoice()">
                            <option value="">-- Chọn sản phẩm --</option>
                            ${db.products.map(p => `<option value="${escapeAttr(String(p.id ?? ''))}">${escapeHtml(p.name)} - ${money(p.price)}</option>`).join('')}
                        </select>
                    </div>
                    
                    <!-- Discount & Note -->
                    <div class="d-flex gap-2 mb-2">
                        <div style="flex:1">
                            <label class="label">Giảm giá</label>
                            <input type="text" id="edit-inv-discount" class="input" value="${invoice.discount || 0}" onchange="recalcEditInvoice()">
                        </div>
                        <div style="flex:1">
                            <label class="label">Ghi chú</label>
                            <input type="text" id="edit-inv-note" class="input" value="${escapeAttr(invoice.note || '')}">
                        </div>
                    </div>
                    
                    <!-- Totals -->
                    <div style="padding:15px; background:var(--bg-muted); border-radius:8px;">
                        <div class="d-flex justify-between mb-1"><span>Tạm tính:</span><span id="edit-inv-subtotal">0 ₫</span></div>
                        <div class="d-flex justify-between mb-1"><span>Giảm giá:</span><span id="edit-inv-disc-display">0 ₫</span></div>
                        <div class="d-flex justify-between" style="font-size:18px; font-weight:700; color:var(--primary);">
                            <span>Tổng cộng:</span><span id="edit-inv-total">0 ₫</span>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal('edit-invoice-modal')">Hủy</button>
                    <button class="btn btn-success" onclick="saveEditInvoice()">💾 Lưu thay đổi</button>
                </div>
            </div>
        </div>
    `;

    const existingModal = $('edit-invoice-modal');
    if (existingModal) existingModal.remove();

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    renderEditInvoiceItems();
    recalcEditInvoice();
}

function renderEditInvoiceItems() {
    const tbody = $('edit-inv-items-body');
    if (!tbody) return;

    tbody.innerHTML = editingInvoiceItems.map((item, idx) => {
        const itemTotal = item.lineTotal !== undefined ? item.lineTotal : Math.round(item.qty * item.price);
        return `
        <tr>
            <td>${escapeHtml(item.name)}</td>
            <td><input type="number" class="input" value="${item.qty}" min="0.001" step="0.001" style="width:60px; padding:4px 8px;" onchange="updateEditInvoiceItem(${idx}, 'qty', this.value)"></td>
            <td><input type="text" class="input" value="${item.price}" style="width:100px; padding:4px 8px;" onchange="updateEditInvoiceItem(${idx}, 'price', this.value)"></td>
            <td style="font-weight:600">${money(itemTotal)}</td>
            <td><button class="btn-sm btn-danger" onclick="removeEditInvoiceItem(${idx})">✕</button></td>
        </tr>`;
    }).join('') || '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted)">Chưa có sản phẩm</td></tr>';
}

function updateEditInvoiceItem(index, field, value) {
    if (!editingInvoiceItems[index]) return;
    editingInvoiceItems[index][field] = field === 'qty' ? (parseFloat(value) || 0) : parseVN(value);
    editingInvoiceItems[index].lineTotal = Math.round(
        (parseFloat(editingInvoiceItems[index].qty) || 0) *
        (parseFloat(editingInvoiceItems[index].price) || 0)
    );
    renderEditInvoiceItems();
    recalcEditInvoice();
}

function removeEditInvoiceItem(index) {
    editingInvoiceItems.splice(index, 1);
    renderEditInvoiceItems();
    recalcEditInvoice();
}

function addProductToEditInvoice() {
    const select = $('edit-inv-add-product');
    const productId = select.value;
    if (!productId) return;

    const product = db.products.find(p => sameStoredId(p.id, productId));
    if (!product) return;

    // Check if already in list
    const existing = editingInvoiceItems.find(i => sameStoredId(i.id, productId));
    if (existing) {
        existing.qty += 1;
        existing.lineTotal = Math.round(existing.qty * existing.price);
    } else {
        editingInvoiceItems.push({
            id: product.id,
            name: product.name,
            qty: 1,
            price: product.price,
            cost: product.cost || 0
        });
    }

    select.value = '';
    renderEditInvoiceItems();
    recalcEditInvoice();
}

function recalcEditInvoice() {
    const subtotal = editingInvoiceItems.reduce((a, i) => {
        const itemTotal = i.lineTotal !== undefined ? i.lineTotal : Math.round(i.qty * i.price);
        return a + itemTotal;
    }, 0);
    const discount = parseVN($('edit-inv-discount')?.value);
    const totalBeforeRounding = Math.max(0, subtotal - discount);
    const total = Math.round(totalBeforeRounding / 1000) * 1000;

    if ($('edit-inv-subtotal')) $('edit-inv-subtotal').innerText = money(subtotal);
    if ($('edit-inv-disc-display')) $('edit-inv-disc-display').innerText = money(discount);
    if ($('edit-inv-total')) $('edit-inv-total').innerText = money(total);
}

function saveEditInvoice() {
    if (!editingInvoiceId) return;

    const invoice = db.invoices.find(i => sameStoredId(i.id, editingInvoiceId));
    if (!invoice) return toast("Không tìm thấy hóa đơn!", "error");
    if (hasLinkedReturn(invoice.id)) {
        return toast("Không thể sửa hóa đơn đã phát sinh trả/đổi hàng.", "warning");
    }

    if (editingInvoiceItems.length === 0) {
        return toast("Hóa đơn phải có ít nhất 1 sản phẩm!", "error");
    }
    if (editingInvoiceItems.some(item => (parseFloat(item.qty) || 0) <= 0)) {
        return toast("Số lượng sản phẩm trong hóa đơn phải lớn hơn 0!", "error");
    }

    const historyCommit = beginHistoryCommit();
    if (!historyCommit) return;

    // Calculate net stock differences before applying any changes
    const oldItems = invoice.items;
    const oldQtyByProduct = {};
    const newQtyByProduct = {};
    oldItems.forEach(item => oldQtyByProduct[item.id] = (oldQtyByProduct[item.id] || 0) + (parseFloat(item.qty) || 0));
    editingInvoiceItems.forEach(item => newQtyByProduct[item.id] = (newQtyByProduct[item.id] || 0) + (parseFloat(item.qty) || 0));

    for (const productId of new Set([...Object.keys(oldQtyByProduct), ...Object.keys(newQtyByProduct)])) {
        const p = db.products.find(x => sameStoredId(x.id, productId));
        const additionalQty = (newQtyByProduct[productId] || 0) - (oldQtyByProduct[productId] || 0);
        if (p && additionalQty > p.stock) {
            return toast(`Kho "${p.name}" chỉ còn ${formatQty(p.stock)}, không đủ thêm ${formatQty(additionalQty)}.`, "error");
        }
    }

    // Restore old stock
    oldItems.forEach(item => {
        const p = db.products.find(x => sameStoredId(x.id, item.id));
        if (p) p.stock += item.qty;
    });

    // Deduct new stock
    editingInvoiceItems.forEach(item => {
        const p = db.products.find(x => sameStoredId(x.id, item.id));
        if (p) p.stock -= item.qty;
    });

    // Update invoice
    const newSubtotal = editingInvoiceItems.reduce((a, i) => {
        const itemTotal = i.lineTotal !== undefined ? i.lineTotal : Math.round(i.qty * i.price);
        return a + itemTotal;
    }, 0);
    const newDiscount = parseVN($('edit-inv-discount')?.value);
    const newTotalBeforeRounding = Math.max(0, newSubtotal - newDiscount);
    const newTotal = Math.round(newTotalBeforeRounding / 1000) * 1000;

    const selectedCustomerOption = db.custs.find(c => sameStoredId(c.id, $('edit-inv-cust')?.value));
    const selectedCustomerId = selectedCustomerOption && !sameStoredId(selectedCustomerOption.id, 1)
        ? selectedCustomerOption.id
        : null;
    const selectedCustomer = selectedCustomerId ? selectedCustomerOption : null;

    // Recalculate customer points and totalBuy based on old vs new invoice/customer
    const oldTotal = invoice.total || 0;
    const oldCustomer = invoice.custId && !sameStoredId(invoice.custId, 1) ? db.custs.find(c => sameStoredId(c.id, invoice.custId)) : null;
    const pointsRate = db.settings.pointsRate || 1;
    const oldEarned = Math.floor(oldTotal * pointsRate / 100);
    const newEarned = Math.floor(newTotal * pointsRate / 100);

    if (oldCustomer && !sameStoredId(oldCustomer.id, selectedCustomerId)) {
        oldCustomer.totalBuy = Math.max(0, (oldCustomer.totalBuy || 0) - oldTotal);
        if (db.settings.pointsEnabled) {
            oldCustomer.points = Math.max(0, (oldCustomer.points || 0) - oldEarned + (invoice.pointsUsed || 0));
        }
    }
    if (selectedCustomer) {
        if (sameStoredId(oldCustomer?.id, selectedCustomer.id)) {
            selectedCustomer.totalBuy = Math.max(0, (selectedCustomer.totalBuy || 0) + (newTotal - oldTotal));
            if (db.settings.pointsEnabled) {
                selectedCustomer.points = Math.max(0, (selectedCustomer.points || 0) + newEarned - oldEarned);
            }
        } else {
            selectedCustomer.totalBuy = (selectedCustomer.totalBuy || 0) + newTotal;
            if (db.settings.pointsEnabled) {
                selectedCustomer.points = Math.max(0, (selectedCustomer.points || 0) + newEarned - (invoice.pointsUsed || 0));
            }
        }
    }

    // Record the net stock changes caused by editing the invoice
    for (const productId of new Set([...Object.keys(oldQtyByProduct), ...Object.keys(newQtyByProduct)])) {
        const p = db.products.find(x => sameStoredId(x.id, productId));
        const qtyDiff = (newQtyByProduct[productId] || 0) - (oldQtyByProduct[productId] || 0);
        if (p && qtyDiff !== 0) {
            db.stockHistory.unshift({
                id: Date.now() + Math.random(),
                date: getAppDate().toISOString(),
                type: qtyDiff > 0 ? 'out' : 'in',
                productId: p.id,
                productName: p.name,
                qty: Math.abs(qtyDiff),
                price: p.cost || 0,
                total: Math.abs(qtyDiff) * (p.cost || 0),
                note: `Điều chỉnh do sửa HĐ ${editingInvoiceId}`,
                user: currUser?.name || '',
                source: 'invoice_edit'
            });
        }
    }

    invoice.items = editingInvoiceItems.map(item => ({ ...item }));
    invoice.cust = selectedCustomerOption?.name || invoice.cust;
    invoice.custId = selectedCustomerId;
    invoice.subtotal = newSubtotal;
    invoice.discount = newDiscount;
    invoice.total = newTotal;
    invoice.note = $('edit-inv-note')?.value || '';
    invoice.editedAt = getAppDate().toISOString();

    logActivity('Sửa hóa đơn', `#${String(editingInvoiceId).slice(-6)} - ${money(oldTotal)} → ${money(newTotal)}`);
    if (!saveHistoryCommit(historyCommit)) return;
    closeModal('edit-invoice-modal');
    renderHist();
    renderPos();
    renderInventory();
    toast("Đã cập nhật hóa đơn!", "success");

    editingInvoiceId = null;
    editingInvoiceItems = [];
}

// 2. EDIT PURCHASE ORDER
let editingPOId = null;

function editPurchaseOrder(poId) {
    const po = (db.purchaseOrders || []).find(o => sameStoredId(o.id, poId));
    if (!po) return toast("Không tìm thấy đơn nhập!", "error");

    editingPOId = poId;
    closeModal('po-view-modal');
    closeModal('po-history-modal');

    // Open PO modal with data
    $('purchase-order-modal').classList.add('active');
    $('po-code').value = po.code;
    $('po-date').value = po.date.slice(0, 16);

    // Populate suppliers
    const supSel = $('po-supplier');
    supSel.innerHTML = '<option value="">-- Chọn NCC --</option>' +
        (db.suppliers || []).map(s => `<option value="${escapeAttr(String(s.id ?? ''))}" ${sameStoredId(s.id, po.supplierId) ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');

    $('po-note').value = po.note || '';

    // Set payment status if checkbox exists
    if ($('po-is-paid')) $('po-is-paid').checked = po.isPaid || false;

    // Load items
    currentPOItems = po.items.map(i => ({ ...i }));
    renderPOItems();
}

// Override savePurchaseOrder to handle editing
const originalSavePO = savePurchaseOrder;
savePurchaseOrder = function () {
    if (!canMutateManagement()) return;
    if (currentPOItems.length === 0) {
        return toast("Vui lòng thêm ít nhất 1 sản phẩm!", "error");
    }

    const supplierId = $('po-supplier').value;
    const supplier = db.suppliers?.find(s => sameStoredId(s.id, supplierId));
    const poCode = $('po-code').value.trim();
    if (!poCode) return toast("Mã đơn nhập không được để trống!", "error");
    if ((db.purchaseOrders || []).some(po => po.code === poCode && !sameStoredId(po.id, editingPOId))) {
        return toast(`Mã đơn nhập "${poCode}" đã tồn tại!`, "error");
    }

    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;
    const poUiState = {
        items: currentPOItems.map(item => ({ ...item })),
        editingPOId,
        skipPOAutoSave,
        fields: ['po-supplier', 'po-code', 'po-date', 'po-is-paid', 'po-note'].map(id => {
            const field = $(id);
            return { id, value: field?.value, checked: field?.checked };
        }),
        focusId: typeof document !== 'undefined' ? document.activeElement?.id : ''
    };

    const totalQty = currentPOItems.reduce((a, b) => a + b.qty, 0);
    const totalAmount = currentPOItems.reduce((a, b) => a + b.total, 0);

    const isPaid = $('po-is-paid')?.checked || false;
    let successMessage;

    if (editingPOId) {
        // EDITING EXISTING PO
        const poIndex = db.purchaseOrders.findIndex(o => sameStoredId(o.id, editingPOId));
        if (poIndex === -1) return toast("Không tìm thấy đơn!", "error");

        const oldPO = db.purchaseOrders[poIndex];

        // Reverse old stock changes
        oldPO.items.forEach(item => {
            const p = db.products.find(x => sameStoredId(x.id, item.productId));
            if (p) p.stock -= item.qty;
        });
        db.stockHistory = (db.stockHistory || []).filter(h => !isStockHistoryForPurchaseOrder(h, oldPO));

        // Update PO
        db.purchaseOrders[poIndex] = {
            ...oldPO,
            code: poCode,
            date: $('po-date').value ? new Date($('po-date').value).toISOString() : oldPO.date,
            supplierId: supplierId ? (supplier?.id ?? null) : null,
            supplierName: supplier?.name || 'Không xác định',
            items: currentPOItems.map(i => ({ ...i })),
            totalQty: totalQty,
            totalAmount: totalAmount,
            note: $('po-note').value,
            isPaid: isPaid,
            paidDate: isPaid ? getAppDate().toISOString() : null,
            updatedAt: getAppDate().toISOString()
        };

        // Apply new stock changes and create stock history
        const updatedPO = db.purchaseOrders[poIndex];
        currentPOItems.forEach(item => {
            const p = db.products.find(x => sameStoredId(x.id, item.productId));
            if (p) {
                p.stock += item.qty;
                if (item.price > 0) p.cost = item.price;
                // Update selling price if provided
                if (item.sellPrice > 0) p.price = item.sellPrice;

                db.stockHistory.unshift({
                    id: Date.now() + Math.random(),
                    date: updatedPO.date,
                    type: 'in',
                    productId: p.id,
                    productName: item.productName,
                    qty: item.qty,
                    price: item.price,
                    total: item.total,
                    supplierId: updatedPO.supplierId,
                    note: `Đơn nhập: ${updatedPO.code}`,
                    user: currUser?.name || '',
                    source: 'purchase_order',
                    purchaseOrderId: updatedPO.id
                });
            }
        });

        logActivity('Sửa đơn nhập', `${oldPO.code} - ${money(totalAmount)}`);
        successMessage = `Đã cập nhật đơn nhập! Tổng: ${money(totalAmount)}`;

    } else {
        // CREATING NEW PO
        const po = {
            id: 'PO-' + Date.now(),
            code: poCode,
            date: $('po-date').value ? new Date($('po-date').value).toISOString() : getAppDate().toISOString(),
            supplierId: supplierId ? (supplier?.id ?? null) : null,
            supplierName: supplier?.name || 'Không xác định',
            items: currentPOItems.map(i => ({ ...i })),
            totalQty: totalQty,
            totalAmount: totalAmount,
            note: $('po-note').value,
            isPaid: isPaid,
            paidDate: isPaid ? getAppDate().toISOString() : null,
            user: currUser?.name || '',
            createdAt: getAppDate().toISOString()
        };

        if (!db.purchaseOrders) db.purchaseOrders = [];
        db.purchaseOrders.unshift(po);

        currentPOItems.forEach(item => {
            const p = db.products.find(x => sameStoredId(x.id, item.productId));
            if (p) {
                p.stock += item.qty;
                if (item.price > 0) p.cost = item.price;
                // Update selling price if provided
                if (item.sellPrice > 0) p.price = item.sellPrice;

                db.stockHistory.unshift({
                    id: Date.now() + Math.random(),
                    date: po.date,
                    type: 'in',
                    productId: p.id,
                    productName: item.productName,
                    qty: item.qty,
                    price: item.price,
                    total: item.total,
                    supplierId: po.supplierId,
                    note: `Đơn nhập: ${po.code}`,
                    user: currUser?.name || '',
                    source: 'purchase_order',
                    purchaseOrderId: po.id
                });
            }
        });

        logActivity('Nhập hàng', `Đơn ${po.code} - ${money(totalAmount)}`);
        successMessage = `Đã lưu đơn nhập hàng! Tổng: ${money(totalAmount)}`;
    }

    if (!saveInventoryCommit(inventoryCommit)) {
        currentPOItems = poUiState.items.map(item => ({ ...item }));
        editingPOId = poUiState.editingPOId;
        skipPOAutoSave = poUiState.skipPOAutoSave;
        poUiState.fields.forEach(({ id, value, checked }) => {
            const field = $(id);
            if (!field) return;
            if (value !== undefined) field.value = value;
            if (checked !== undefined) field.checked = checked;
        });
        if (poUiState.focusId) $(poUiState.focusId)?.focus?.();
        return;
    }

    editingPOId = null;
    skipPOAutoSave = true; // Prevent auto-save when intentionally saving
    currentPOItems = []; // Clear items before closing to prevent auto-draft
    closeModal('purchase-order-modal');
    toast(successMessage);

    // Defer heavy render calls to avoid blocking the UI thread
    setTimeout(() => {
        renderInventory();
        renderManagement();
        renderPos();
    }, 50);
};

// 3. BATCH PRINT LABELS FOR PO
function printBatchLabelsForPO(poId) {
    const po = (db.purchaseOrders || []).find(o => sameStoredId(o.id, poId));
    if (!po) return toast("Không tìm thấy đơn nhập!", "error");

    const products = po.items.map(item => {
        const p = db.products.find(x => sameStoredId(x.id, item.productId));
        return p ? { ...p, labelQty: item.qty } : null;
    }).filter(Boolean);

    if (products.length === 0) return toast("Không có sản phẩm để in tem!", "warning");

    // Calculate total labels and show confirmation
    const totalLabelsPreview = products.reduce((sum, p) => sum + Math.min(p.labelQty, 100), 0);
    toast(`🏷️ Đang chuẩn bị in ${totalLabelsPreview} tem cho ${products.length} sản phẩm...`, "info");

    // Fixed dimensions for 110mm paper with 3 columns of 35x22mm labels
    const paperWidthMM = 110;
    const labelWidthMM = 35;
    const labelHeightMM = 22;
    const columnsPerRow = 3;
    const totalLabelsWidthMM = labelWidthMM * columnsPerRow; // 105mm
    const marginLeftMM = (paperWidthMM - totalLabelsWidthMM) / 2; // 2.5mm each side

    function generateBarcodeSvg(code) {
        if (!code || typeof JsBarcode !== 'function') return '';
        try {
            const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            JsBarcode(tempSvg, code, {
                format: getBarcodeFormat(code),
                width: 1.5, height: 18, displayValue: false, margin: 0,
                background: '#ffffff', lineColor: '#000000'
            });
            return tempSvg.outerHTML;
        } catch (e) {
            console.error('Barcode generation error for', code, e);
            return '<span class="no-barcode">Lỗi mã</span>';
        }
    }

    let labelsHtml = '';
    products.forEach(p => {
        const code = p.code || '';
        const name = p.name || '';
        const safeCode = escapeHtml(code);
        const safeName = escapeHtml(name);
        const priceText = money(p.price);
        const barcodeHtml = code ? generateBarcodeSvg(code) : '<div class="no-barcode">Không có mã</div>';

        for (let i = 0; i < Math.min(p.labelQty, 100); i++) {
            labelsHtml += `<div class="label">
                <div class="label-name">${safeName}</div>
                <div class="barcode-container">${barcodeHtml}</div>
                ${code ? `<div class="label-code">${safeCode}</div>` : ''}
                <div class="label-price">${priceText}</div>
            </div>`;
        }
    });

    const totalLabels = products.reduce((a, b) => a + Math.min(b.labelQty, 100), 0);

    // Use iframe approach for Electron compatibility instead of window.open()
    let printIframe = document.getElementById('label-print-iframe');
    if (!printIframe) {
        printIframe = document.createElement('iframe');
        printIframe.id = 'label-print-iframe';
        printIframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;border:none;background:#f0f0f0;';
        document.body.appendChild(printIframe);
    } else {
        printIframe.style.display = 'block';
    }

    const printContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>In tem hàng loạt - Đơn nhập ${escapeHtml(po.code)}</title>
    <style>
        /* Reset */
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        /* Page setup for thermal printer */
        @page { 
            size: ${paperWidthMM}mm auto; 
            margin: 0; 
        }
        
        body { 
            margin: 0; 
            padding: 0; 
            font-family: Arial, sans-serif; 
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            width: ${paperWidthMM}mm;
        }
        
        /* CSS Grid container - exact positioning */
        .label-container { 
            width: ${paperWidthMM}mm;
            padding-left: ${marginLeftMM}mm;
            padding-right: ${marginLeftMM}mm;
            display: grid;
            grid-template-columns: repeat(${columnsPerRow}, ${labelWidthMM}mm);
            grid-auto-rows: ${labelHeightMM}mm;
            gap: 0;
        }
        
        /* Each label cell */
        .label { 
            width: ${labelWidthMM}mm; 
            height: ${labelHeightMM}mm;
            padding: 0.8mm;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            overflow: hidden !important;
            background: white;
            contain: strict;
            clip-path: inset(0);
        }
        
        /* Product name */
        .label-name { 
            font-size: 6pt; 
            font-weight: bold; 
            text-align: center;
            width: 100%;
            max-width: ${labelWidthMM - 2}mm;
            max-height: 5.5mm;
            overflow: hidden !important;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            line-height: 1.15;
            margin-bottom: 0.5mm;
        }
        
        /* Barcode container */
        .barcode-container {
            width: 100%;
            max-width: ${labelWidthMM - 2}mm;
            height: 6mm;
            max-height: 6mm;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden !important;
        }
        
        .barcode-container svg {
            max-width: ${labelWidthMM - 3}mm;
            height: 6mm !important;
            max-height: 6mm !important;
        }
        
        /* Barcode number */
        .label-code { 
            font-size: 5pt; 
            text-align: center; 
            font-weight: 600;
            max-width: ${labelWidthMM - 2}mm;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            height: 2.5mm;
            line-height: 2.5mm;
        }
        
        /* Price */
        .label-price { 
            font-size: 8pt; 
            font-weight: bold; 
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            height: 3.5mm;
            line-height: 3.5mm;
        }
        
        .no-barcode { font-size: 5pt; color: #666; }
        
        /* Preview controls */
        .preview-controls { 
            position: fixed; top: 0; left: 0; right: 0; 
            background: linear-gradient(135deg, #6366F1, #8B5CF6); 
            color: white; padding: 12px 20px; 
            display: flex; justify-content: space-between; align-items: center; 
            z-index: 1000; font-size: 14px;
        }
        .preview-controls button { 
            padding: 8px 16px; border: none; border-radius: 6px; 
            cursor: pointer; font-weight: 600; margin-left: 8px; 
        }
        .btn-print { background: #10B981; color: white; }
        .btn-close { background: #EF4444; color: white; }
        
        /* Print specific rules */
        @media print { 
            .preview-controls { display: none !important; }
            body { padding: 0 !important; }
            .label-container { padding-top: 0 !important; }
        }
        
        /* Screen preview */
        @media screen { 
            body { background: #f0f0f0; padding-top: 60px; } 
            .label-container { background: white; box-shadow: 0 2px 10px rgba(0,0,0,0.1); margin: 10px auto; } 
            .label { border: 1px dashed #ccc; } 
        }
    </style>
</head>
<body>
    <div class="preview-controls">
        <span>📋 ${totalLabels} tem (${labelWidthMM}x${labelHeightMM}mm) - Đơn nhập ${escapeHtml(po.code)}</span>
        <div>
            <button class="btn-print" id="print-btn">🖨️ In</button>
            <button class="btn-close" id="close-btn">✕</button>
        </div>
    </div>
    <div class="label-container">${labelsHtml}</div>
</body>
</html>`;

    // Write content to iframe
    const iframeDoc = printIframe.contentDocument || printIframe.contentWindow?.document;
    if (!iframeDoc) { toast('Không thể tạo tài liệu in!', 'error'); return; }
    iframeDoc.open();
    iframeDoc.write(printContent);
    iframeDoc.close();

    // Wait for iframe to load then setup event handlers
    setTimeout(() => {
        const printBtn = iframeDoc.getElementById('print-btn');
        const closeBtn = iframeDoc.getElementById('close-btn');

        if (printBtn) {
            printBtn.onclick = function () {
                printIframe.contentWindow.print();
            };
        }
        if (closeBtn) {
            closeBtn.onclick = function () {
                printIframe.style.display = 'none';
            };
        }

        // Handle afterprint event
        printIframe.contentWindow.onafterprint = function () {
            printIframe.style.display = 'none';
        };
    }, 100);

    logActivity('In tem hàng loạt', `${totalLabels} tem - Đơn ${po.code}`);
    toast(`Đã mở preview ${totalLabels} tem nhãn cho đơn nhập ${po.code}`, "info");
}

// 4. MARK PO AS PAID
function markPOAsPaid(poId) {
    if (!canMutateManagement()) return;
    const po = (db.purchaseOrders || []).find(o => sameStoredId(o.id, poId));
    if (!po) return toast("Không tìm thấy đơn!", "error");
    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;

    po.isPaid = !po.isPaid;
    po.paidDate = po.isPaid ? getAppDate().toISOString() : null;

    if (!saveInventoryCommit(inventoryCommit)) return;
    renderPOHistory();
    viewPurchaseOrder(poId);

    toast(po.isPaid ? "Đã đánh dấu ĐÃ THANH TOÁN!" : "Đã đánh dấu CHƯA THANH TOÁN!", po.isPaid ? "success" : "warning");
}

// 5. DRAFT SYSTEM
if (!db.drafts) db.drafts = { invoices: [], purchaseOrders: [], products: [] };

function migrateLegacyOrderDrafts() {
    let legacyDrafts;
    try {
        legacyDrafts = JSON.parse(localStorage.getItem('orderDrafts') || '[]');
    } catch (e) {
        console.warn('Không thể đọc bản nháp POS cũ:', e);
        return false;
    }
    if (!Array.isArray(legacyDrafts) || legacyDrafts.length === 0) return false;

    const originalDrafts = (db.drafts.invoices || []).slice();
    const existingIds = new Set(originalDrafts.map(draft => String(draft.id)));
    let hasInvalidDraft = false;
    const migratedDrafts = legacyDrafts.flatMap((legacyDraft, index) => {
        if (!legacyDraft || !Array.isArray(legacyDraft.cart) || legacyDraft.cart.length === 0) {
            hasInvalidDraft = true;
            return [];
        }
        const id = `DRAFT-legacy-${legacyDraft.id ?? index}`;
        if (existingIds.has(id)) return [];
        existingIds.add(id);
        const createdAt = legacyDraft.savedAt || getAppDate().toISOString();
        return [{
            id,
            type: 'invoices',
            name: legacyDraft.name || `Bản nháp ${new Date(createdAt).toLocaleString('vi-VN')}`,
            createdAt,
            data: {
                name: legacyDraft.name || 'Đơn hàng',
                items: legacyDraft.cart.map(item => ({ ...item })),
                customer: legacyDraft.cust ? { ...legacyDraft.cust } : null,
                discount: Number(legacyDraft.discount) || 0,
                discountType: legacyDraft.discountType || 'amount',
                savedAt: createdAt
            }
        }];
    });

    if (migratedDrafts.length > 0) {
        db.drafts.invoices = [...migratedDrafts, ...originalDrafts];
        if (!saveNow()) {
            db.drafts.invoices = originalDrafts;
            toast('Không thể di trú bản nháp POS cũ. Dữ liệu cũ vẫn được giữ.', 'error');
            return false;
        }
    }
    if (!hasInvalidDraft) localStorage.removeItem('orderDrafts');
    return migratedDrafts.length > 0;
}

function saveDraft(type, data) {
    if (type === 'purchaseOrders' && !canMutateManagement()) return null;
    if (!db.drafts) db.drafts = { invoices: [], purchaseOrders: [], products: [] };
    const originalDrafts = (db.drafts[type] || []).slice();

    const draft = {
        id: 'DRAFT-' + Date.now(),
        type: type,
        data: data,
        createdAt: getAppDate().toISOString(),
        name: data.name || `Bản nháp ${getAppDate().toLocaleString('vi-VN')}`
    };

    db.drafts[type] = db.drafts[type] || [];
    db.drafts[type].unshift(draft);
    // Giới hạn tối đa 20 drafts per type để tránh tràn bộ nhớ
    if (db.drafts[type].length > 20) {
        db.drafts[type] = db.drafts[type].slice(0, 20);
    }
    if (!saveNow()) {
        db.drafts[type] = originalDrafts;
        toast('Không thể lưu bản nháp. Dữ liệu hiện tại vẫn được giữ.', 'error');
        return null;
    }
    const typeNames = { invoices: 'đơn hàng', purchaseOrders: 'đơn nhập', products: 'sản phẩm' };
    toast(`Đã lưu bản nháp ${typeNames[type] || type}!`);
    return draft.id;
}

function loadDraft(type, draftId) {
    const draft = (db.drafts?.[type] || []).find(d => sameStoredId(d.id, draftId));
    if (!draft) return toast("Không tìm thấy bản nháp!", "error");
    return draft.data;
}

function deleteDraft(type, draftId) {
    if (type === 'purchaseOrders' && !canMutateManagement()) return;
    if (!db.drafts?.[type]) return;
    const idx = db.drafts[type].findIndex(d => sameStoredId(d.id, draftId));
    if (idx > -1) {
        const originalDrafts = db.drafts[type].slice();
        db.drafts[type].splice(idx, 1);
        if (!saveNow()) {
            db.drafts[type] = originalDrafts;
            toast('Không thể xóa bản nháp. Dữ liệu hiện tại vẫn được giữ.', 'error');
            return;
        }
        toast("Đã xóa bản nháp!");
    }
}

function getDraftsList(type) {
    return db.drafts?.[type] || [];
}

// Save cart as draft
function saveCartAsDraft() {
    saveCurrentTabState();
    const tab = invoiceTabs.find(t => t.id === activeTabId);
    if (!tab || tab.cart.length === 0) return toast("Giỏ hàng trống!", "warning");

    const draftData = {
        name: tab.name,
        items: tab.cart.map(i => ({ ...i })),
        customer: tab.cust ? { ...tab.cust } : null,
        discount: tab.discount || 0,
        discountType: tab.discountType || 'amount',
        savedAt: getAppDate().toISOString()
    };

    const originalDrafts = (db.drafts.invoices || []).slice();
    const draft = {
        id: `DRAFT-${Date.now()}`,
        type: 'invoices',
        data: draftData,
        createdAt: draftData.savedAt,
        name: draftData.name
    };
    db.drafts.invoices = [draft, ...originalDrafts];
    if (!saveNow()) {
        db.drafts.invoices = originalDrafts;
        toast('Không thể lưu bản nháp. Dữ liệu giỏ hàng vẫn được giữ.', 'error');
        return null;
    }
    toast('Đã lưu bản nháp đơn hàng!', 'success');
    return draft.id;
}

// Load cart from draft
function loadCartFromDraft(draftId) {
    const data = loadDraft('invoices', draftId);
    if (!data) return false;

    const missingProducts = [];
    const draftCart = (data.items || []).flatMap(item => {
        const p = db.products.find(product => sameStoredId(product.id, item.id));
        if (!p) {
            missingProducts.push(item.name || item.id);
            return [];
        }
        const fresh = { ...item };
        delete fresh.customPrice;
        delete fresh.customLineTotal;
        fresh.id = p.id;
        fresh.name = p.name;
        fresh.price = p.price;
        return [fresh];
    });

    if (draftCart.length === 0) {
        toast('Không thể tải nháp vì các sản phẩm không còn tồn tại.', 'error');
        return false;
    }
    if (cart.length > 0) createNewInvoiceTab();

    cart = draftCart;
    const savedCustomer = data.customer;
    cust = savedCustomer ? db.custs.find(customer => sameStoredId(customer.id, savedCustomer.id)) || null : null;
    if ($('cart-discount')) $('cart-discount').value = data.discount || 0;
    if ($('discount-type')) $('discount-type').value = data.discountType || 'amount';
    if ($('cart-cust')) $('cart-cust').value = cust?.name || '';
    saveCurrentTabState();

    renderCart();
    updateCustList();
    if (missingProducts.length > 0) toast(`Đã bỏ qua ${missingProducts.length} sản phẩm không còn tồn tại.`, 'warning');
    if (savedCustomer && !cust) toast('Khách hàng trong nháp không còn tồn tại; đã chuyển sang khách lẻ.', 'warning');
    toast("Đã tải bản nháp vào giỏ hàng!");
    return true;
}

// Save current PO as draft
function savePOAsDraft() {
    if (!canMutateManagement()) return;
    if (currentPOItems.length === 0) return toast("Chưa có sản phẩm nào!", "warning");

    const inventoryCommit = beginInventoryCommit();
    if (!inventoryCommit) return;
    const draftState = (db.drafts?.purchaseOrders || []).slice();
    const poUiState = {
        items: currentPOItems.map(item => ({ ...item })),
        editingPOId,
        skipPOAutoSave,
        fields: ['po-supplier', 'po-code', 'po-date', 'po-is-paid', 'po-note'].map(id => {
            const field = $(id);
            return { id, value: field?.value, checked: field?.checked };
        }),
        focusId: typeof document !== 'undefined' ? document.activeElement?.id : ''
    };

    const draftData = {
        name: `Đơn nhập - ${currentPOItems.length} SP - ${money(currentPOItems.reduce((a, b) => a + b.total, 0))}`,
        items: currentPOItems.map(i => ({ ...i })),
        supplierId: $('po-supplier').value,
        note: $('po-note').value,
        savedAt: getAppDate().toISOString()
    };

    const draft = {
        id: 'DRAFT-' + Date.now(),
        type: 'purchaseOrders',
        data: draftData,
        createdAt: getAppDate().toISOString(),
        name: draftData.name
    };
    db.drafts.purchaseOrders = [draft, ...draftState].slice(0, 20);
    if (!saveNow()) {
        rollbackInventoryMutation(inventoryCommit);
        db.drafts.purchaseOrders = draftState;
        currentPOItems = poUiState.items.map(item => ({ ...item }));
        editingPOId = poUiState.editingPOId;
        skipPOAutoSave = poUiState.skipPOAutoSave;
        poUiState.fields.forEach(({ id, value, checked }) => {
            const field = $(id);
            if (!field) return;
            if (value !== undefined) field.value = value;
            if (checked !== undefined) field.checked = checked;
        });
        if (poUiState.focusId) $(poUiState.focusId)?.focus?.();
        return;
    }

    editingPOId = null;
    skipPOAutoSave = true; // Prevent auto-save when intentionally saving draft
    closeModal('purchase-order-modal');
    toast('Đã lưu bản nháp đơn nhập!');
}

// Flag to prevent double-save when user intentionally saves PO
let skipPOAutoSave = false;

// Auto-save PO to draft when accidentally closing modal (ESC/X/Huỷ)
function autoSavePOAsDraft() {
    if (skipPOAutoSave) { skipPOAutoSave = false; return false; }
    if (editingPOId) { editingPOId = null; return false; } // Đang edit PO đã lưu, không tạo draft trùng
    if (!currentPOItems || currentPOItems.length === 0) return false;

    const draftData = {
        name: `[Tự động] Đơn nhập - ${currentPOItems.length} SP - ${money(currentPOItems.reduce((a, b) => a + b.total, 0))}`,
        items: currentPOItems.map(i => ({ ...i })),
        supplierId: $('po-supplier')?.value || '',
        note: $('po-note')?.value || '',
        code: $('po-code')?.value || '',
        savedAt: getAppDate().toISOString()
    };

    saveDraft('purchaseOrders', draftData);
    return true;
}

// Load PO from draft
function loadPOFromDraft(draftId) {
    const data = loadDraft('purchaseOrders', draftId);
    if (!data) return;

    currentPOItems = data.items || [];
    if (data.supplierId) $('po-supplier').value = data.supplierId;
    if (data.note) $('po-note').value = data.note;

    renderPOItems();
    toast("Đã tải bản nháp đơn nhập!");
}

// Toggle drafts section visibility
let draftsExpanded = false;
function toggleDraftsSection() {
    draftsExpanded = !draftsExpanded;
    const list = $('po-drafts-list');
    const toggle = $('po-drafts-toggle');
    if (list) list.style.display = draftsExpanded ? 'block' : 'none';
    if (toggle) toggle.textContent = draftsExpanded ? '▲' : '▼';
    if (draftsExpanded) renderPODrafts();
}

// Render PO drafts list
function renderPODrafts() {
    const drafts = db.drafts?.purchaseOrders || [];
    const container = $('po-drafts-list');
    const countEl = $('po-drafts-count');

    if (countEl) countEl.textContent = drafts.length;
    if (!container) return;

    if (drafts.length === 0) {
        container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">Chưa có đơn nháp nào được lưu</div>';
        return;
    }

    container.innerHTML = drafts.map(d => {
        const draftIdJs = escapeJsArgument(d.id);
        return `
        <div style="padding:10px 12px;border-bottom:1px solid var(--border-light);display:flex;justify-content:space-between;align-items:center;background:var(--bg-surface);">
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(d.name)}</div>
                <div style="font-size:11px;color:var(--text-muted);">Ngày lưu: ${new Date(d.createdAt).toLocaleString('vi-VN')}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
                <button class="btn btn-sm btn-success" onclick="loadPODraft(${draftIdJs})">📂 Tải</button>
                <button class="btn btn-sm btn-danger" onclick="deletePODraft(${draftIdJs})">🗑️</button>
            </div>
        </div>
    `;
    }).join('');
}

let activeDraftType = 'purchaseOrders';

// Open standalone drafts modal from Kho hang or POS
function openDraftsModal(type = 'purchaseOrders') {
    activeDraftType = type === 'invoices' ? 'invoices' : 'purchaseOrders';
    const isInvoiceDraft = activeDraftType === 'invoices';
    const title = $('drafts-modal-title');
    if (title) title.textContent = `📋 ${isInvoiceDraft ? 'Đơn bán lưu tạm' : 'Đơn nhập lưu tạm'}`;
    renderDraftsModalList();
    $('drafts-modal').classList.add('active');
}

function openInvoiceDraftsModal() {
    openDraftsModal('invoices');
}

// Render drafts in standalone modal
function renderDraftsModalList() {
    const isInvoiceDraft = activeDraftType === 'invoices';
    const drafts = db.drafts?.[activeDraftType] || [];
    const container = $('drafts-modal-list');
    if (!container) return;

    if (drafts.length === 0) {
        const hint = isInvoiceDraft ? 'Thêm hàng vào giỏ và bấm F8 để lưu' : 'Tạo đơn nhập và bấm "Lưu tạm" để lưu';
        container.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-muted);"><div style="font-size:48px;margin-bottom:10px;">📋</div><div style="font-size:14px;">Chưa có đơn lưu tạm nào</div><div style="font-size:12px;margin-top:5px;">${hint}</div></div>`;
        return;
    }

    container.innerHTML = drafts.map((d, index) => {
        const items = d.data?.items || [];
        const draftIdAttr = escapeAttr(String(d.id ?? ''));
        const draftIdJs = escapeJsArgument(d.id);
        const itemsHtml = items.length > 0 ? items.map((item, i) => `
            <div style="display:flex;justify-content:space-between;padding:8px 12px;background:var(--bg-muted);border-radius:var(--radius-sm);margin-bottom:4px;font-size:12px;">
                <div style="flex:1;">
                    <span style="color:var(--text-muted);margin-right:6px;">${i + 1}.</span>
                    <span style="font-weight:600;">${escapeHtml(item.productName || item.name || 'Sản phẩm')}</span>
                </div>
                <div style="display:flex;gap:12px;color:var(--text-muted);">
                    <span>SL: <strong style="color:var(--primary);">${item.qty}</strong></span>
                    <span>Giá: <strong>${money(item.price || 0)}</strong></span>
                </div>
            </div>
        `).join('') : '<div style="padding:8px;color:var(--text-muted);font-size:12px;font-style:italic;">Không có sản phẩm</div>';

        return `
        <div class="draft-item-card" data-draft-id="${draftIdAttr}" style="border:1px solid var(--border-light);border-radius:var(--radius-md);margin-bottom:10px;background:var(--bg-surface);overflow:hidden;transition:all 0.2s ease;">
            <!-- Header - Clickable to expand -->
            <div class="draft-item-header" onclick="toggleDraftExpand(${draftIdJs})" style="padding:14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:background 0.2s;">
                <div style="flex:1;min-width:0;display:flex;align-items:center;gap:10px;">
                    <span class="draft-toggle-icon" id="draft-icon-${draftIdAttr}" style="font-size:12px;color:var(--text-muted);transition:transform 0.2s;">▶</span>
                    <div>
                        <div style="font-weight:600;font-size:14px;margin-bottom:2px;">${escapeHtml(d.name)}</div>
                        <div style="font-size:11px;color:var(--text-muted);">
                            🕒 ${new Date(d.createdAt).toLocaleString('vi-VN')} · 📦 ${items.length} sản phẩm
                        </div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;flex-shrink:0;" onclick="event.stopPropagation();">
                    <button class="btn btn-sm btn-success" onclick="${isInvoiceDraft ? 'loadInvoiceDraftFromModal' : 'loadDraftAndOpenPO'}(${draftIdJs})">📂 ${isInvoiceDraft ? 'Tải' : 'Tải & Mở'}</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteDraftFromModal(${draftIdJs})">🗑️</button>
                </div>
            </div>
            <!-- Expandable Content -->
            <div class="draft-item-content" id="draft-content-${draftIdAttr}" style="display:none;padding:0 14px 14px;border-top:1px dashed var(--border-light);">
                <div style="padding-top:10px;">
                    <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;">Chi tiết sản phẩm</div>
                    ${itemsHtml}
                    <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border-light);display:flex;justify-content:space-between;font-size:13px;">
                        <span style="font-weight:600;">Tổng tiền:</span>
                        <span style="font-weight:700;color:var(--primary);">${money(items.reduce((a, b) => a + (b.total || b.price * b.qty || 0), 0))}</span>
                    </div>
                </div>
            </div>
        </div>
    `}).join('');
}

// Toggle draft expand/collapse
function toggleDraftExpand(draftId) {
    const content = $(`draft-content-${draftId}`);
    const icon = $(`draft-icon-${draftId}`);
    const card = content?.closest('.draft-item-card');

    if (!content) return;

    const isExpanded = content.style.display !== 'none';

    if (isExpanded) {
        content.style.display = 'none';
        if (icon) icon.style.transform = 'rotate(0deg)';
        if (card) card.style.boxShadow = '';
    } else {
        content.style.display = 'block';
        if (icon) icon.style.transform = 'rotate(90deg)';
        if (card) card.style.boxShadow = 'var(--shadow-md)';
    }
}

// Load draft and open PO modal
function loadDraftAndOpenPO(draftId) {
    closeModal('drafts-modal');
    const data = loadDraft('purchaseOrders', draftId);
    if (!data) return;

    // Open modal first (which resets currentPOItems)
    openPurchaseOrderModal();

    // Then set the draft data AFTER the modal has reset
    currentPOItems = data.items || [];
    if (data.supplierId) $('po-supplier').value = data.supplierId;
    if (data.note) $('po-note').value = data.note;

    // Render the items
    renderPOItems();
    toast("Đã tải bản nháp!", "success");
}

// Delete draft from modal
function deleteDraftFromModal(draftId) {
    if (!confirm('Xóa bản nháp này?')) return;
    deleteDraft(activeDraftType, draftId);
    renderDraftsModalList();
    toast("Đã xóa bản nháp!");
}

function loadInvoiceDraftFromModal(draftId) {
    if (loadCartFromDraft(draftId)) closeModal('drafts-modal');
}

// Load PO draft
function loadPODraft(draftId) {
    const data = loadDraft('purchaseOrders', draftId);
    if (!data) return;

    currentPOItems = data.items || [];
    if (data.supplierId) $('po-supplier').value = data.supplierId;
    if (data.note) $('po-note').value = data.note;

    renderPOItems();
    toast("Đã tải bản nháp!", "success");
}

// Delete PO draft
function deletePODraft(draftId) {
    if (!confirm('Xóa bản nháp này?')) return;
    deleteDraft('purchaseOrders', draftId);
    renderPODrafts();
    toast("Đã xóa bản nháp!");
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCH LABEL SELECTION SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

let batchLabelItems = [];
let currentBatchPOId = null;

// Open batch label selector (replaces direct print)
function openBatchLabelSelector(poId) {
    const po = (db.purchaseOrders || []).find(o => sameStoredId(o.id, poId));
    if (!po) return toast("Không tìm thấy đơn nhập!", "error");

    currentBatchPOId = poId;

    batchLabelItems = po.items.map(item => {
        const p = db.products.find(x => sameStoredId(x.id, item.productId));
        return {
            productId: item.productId,
            productName: item.productName,
            code: p?.code || '',
            price: p?.price || 0,
            origQty: item.qty,
            labelQty: item.qty,
            selected: true
        };
    });

    renderBatchLabelItems();
    $('batch-label-select-all').checked = true;
    $('batch-label-modal').classList.add('active');
}

// Render batch label items
function renderBatchLabelItems() {
    const container = $('batch-label-items');
    if (!container) return;

    const selected = batchLabelItems.filter(i => i.selected).length;
    $('batch-label-count').textContent = `${selected}/${batchLabelItems.length} sản phẩm`;

    container.innerHTML = batchLabelItems.map((item, idx) => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px;border-bottom:1px solid var(--border-light);${!item.selected ? 'opacity:0.5;background:var(--bg-muted);' : 'background:var(--bg-surface);'}">
            <input type="checkbox" ${item.selected ? 'checked' : ''} onchange="toggleLabelItem(${idx}, this.checked)" style="width:20px;height:20px;cursor:pointer;">
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.productName)}</div>
                <div style="font-size:11px;color:var(--text-muted);">Mã: ${escapeHtml(item.code || 'N/A')} | Giá: ${money(item.price)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:12px;color:var(--text-muted);">Số tem:</span>
                <input type="number" value="${item.labelQty}" min="0" max="100" 
                    onchange="updateLabelQty(${idx}, this.value)"
                    style="width:65px;text-align:center;padding:6px;border-radius:var(--radius-sm);border:1px solid var(--border-light);font-weight:600;">
                <span style="font-size:11px;color:var(--text-muted);">/ ${item.origQty}</span>
            </div>
        </div>
    `).join('');
}

// Toggle single label item
function toggleLabelItem(idx, checked) {
    batchLabelItems[idx].selected = checked;
    const allSelected = batchLabelItems.every(i => i.selected);
    $('batch-label-select-all').checked = allSelected;
    renderBatchLabelItems();
}

// Toggle all label items
function toggleAllLabelItems(checked) {
    batchLabelItems.forEach(i => i.selected = checked);
    renderBatchLabelItems();
}

// Update label quantity
function updateLabelQty(idx, qty) {
    batchLabelItems[idx].labelQty = Math.max(0, Math.min(100, parseInt(qty) || 0));
}

// Print selected labels
function printSelectedLabels() {
    const toPrint = batchLabelItems.filter(i => i.selected && i.labelQty > 0);
    if (toPrint.length === 0) return toast("Chưa chọn sản phẩm nào hoặc số lượng = 0!", "warning");

    const products = toPrint.map(item => {
        const p = db.products.find(x => sameStoredId(x.id, item.productId));
        return p ? { ...p, labelQty: item.labelQty } : null;
    }).filter(Boolean);

    if (products.length === 0) return toast("Không có sản phẩm hợp lệ!", "warning");

    closeModal('batch-label-modal');
    printBatchLabelsWithCustomQty(products, currentBatchPOId);
}

// Print batch labels with custom quantities - FIXED with CSS Grid layout
function printBatchLabelsWithCustomQty(products, poId) {
    const po = (db.purchaseOrders || []).find(o => sameStoredId(o.id, poId));
    const poCode = po?.code || 'Batch';

    // Fixed dimensions for 110mm paper with 3 columns of 35x22mm labels
    const paperWidthMM = 110;
    const labelWidthMM = 35;
    const labelHeightMM = 22;
    const columnsPerRow = 3;
    const totalLabelsWidthMM = labelWidthMM * columnsPerRow; // 105mm
    const marginLeftMM = (paperWidthMM - totalLabelsWidthMM) / 2; // 2.5mm each side

    function generateBarcodeSvg(code) {
        if (!code || typeof JsBarcode !== 'function') return '';
        try {
            const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            JsBarcode(tempSvg, code, {
                format: getBarcodeFormat(code),
                width: 1.5, height: 18, displayValue: false, margin: 0,
                background: '#ffffff', lineColor: '#000000'
            });
            return tempSvg.outerHTML;
        } catch (e) { return '<span class="no-barcode">Lỗi mã</span>'; }
    }

    let labelsHtml = '';
    products.forEach(p => {
        const code = p.code || '';
        const name = p.name || '';
        const safeCode = escapeHtml(code);
        const safeName = escapeHtml(name);
        const priceText = money(p.price);
        const barcodeHtml = code ? generateBarcodeSvg(code) : '<div class="no-barcode">Không có mã</div>';

        for (let i = 0; i < Math.min(p.labelQty, 100); i++) {
            labelsHtml += `<div class="label">
                <div class="label-name">${safeName}</div>
                <div class="barcode-container">${barcodeHtml}</div>
                ${code ? `<div class="label-code">${safeCode}</div>` : ''}
                <div class="label-price">${priceText}</div>
            </div>`;
        }
    });

    const totalLabels = products.reduce((a, b) => a + Math.min(b.labelQty, 100), 0);

    // Use iframe approach for Electron compatibility instead of window.open()
    let printIframe = document.getElementById('label-print-iframe');
    if (!printIframe) {
        printIframe = document.createElement('iframe');
        printIframe.id = 'label-print-iframe';
        printIframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;border:none;background:#f0f0f0;';
        document.body.appendChild(printIframe);
    } else {
        printIframe.style.display = 'block';
    }

    const printContent = `<!DOCTYPE html><html><head>
<meta charset="UTF-8">
<title>In tem - ${escapeHtml(poCode)}</title>
<style>
    /* Reset */
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    /* Page setup for thermal printer */
    @page { 
        size: ${paperWidthMM}mm auto; 
        margin: 0; 
    }
    
    body { 
        margin: 0; 
        padding: 0; 
        font-family: Arial, sans-serif; 
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        width: ${paperWidthMM}mm;
    }
    
    /* CSS Grid container - exact positioning */
    .label-container { 
        width: ${paperWidthMM}mm;
        padding-left: ${marginLeftMM}mm;
        padding-right: ${marginLeftMM}mm;
        display: grid;
        grid-template-columns: repeat(${columnsPerRow}, ${labelWidthMM}mm);
        grid-auto-rows: ${labelHeightMM}mm;
        gap: 0;
    }
    
    /* Each label cell */
    .label { 
        width: ${labelWidthMM}mm; 
        height: ${labelHeightMM}mm;
        padding: 0.8mm;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        overflow: hidden !important;
        background: white;
        contain: strict;
        clip-path: inset(0);
    }
    
    /* Product name */
    .label-name { 
        font-size: 6pt; 
        font-weight: bold; 
        text-align: center;
        width: 100%;
        max-width: ${labelWidthMM - 2}mm;
        max-height: 5.5mm;
        overflow: hidden !important;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        line-height: 1.15;
        margin-bottom: 0.5mm;
    }
    
    /* Barcode container */
    .barcode-container {
        width: 100%;
        max-width: ${labelWidthMM - 2}mm;
        height: 6mm;
        max-height: 6mm;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden !important;
    }
    
    .barcode-container svg {
        max-width: ${labelWidthMM - 3}mm;
        height: 6mm !important;
        max-height: 6mm !important;
    }
    
    /* Barcode number */
    .label-code { 
        font-size: 5pt; 
        text-align: center; 
        font-weight: 600;
        max-width: ${labelWidthMM - 2}mm;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        height: 2.5mm;
        line-height: 2.5mm;
    }
    
    /* Price */
    .label-price { 
        font-size: 8pt; 
        font-weight: bold; 
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        height: 3.5mm;
        line-height: 3.5mm;
    }
    
    .no-barcode { font-size: 5pt; color: #666; }
    
    /* Preview controls */
    .preview-controls { 
        position: fixed; top: 0; left: 0; right: 0; 
        background: linear-gradient(135deg, #6366F1, #8B5CF6); 
        color: white; padding: 12px 20px; 
        display: flex; justify-content: space-between; align-items: center; 
        z-index: 1000; 
    }
    .preview-controls button { 
        padding: 8px 16px; border: none; border-radius: 6px; 
        cursor: pointer; font-weight: 600; margin-left: 8px; 
    }
    .btn-print { background: #10B981; color: white; }
    .btn-close { background: #EF4444; color: white; }
    
    /* Print specific rules */
    @media print { 
        .preview-controls { display: none !important; }
        body { padding: 0 !important; }
        .label-container { padding-top: 0 !important; }
    }
    
    /* Screen preview */
    @media screen { 
        body { background: #f0f0f0; padding-top: 60px; } 
        .label-container { background: white; box-shadow: 0 2px 10px rgba(0,0,0,0.1); margin: 10px auto; } 
        .label { border: 1px dashed #ccc; } 
    }
</style>
</head>
<body>
    <div class="preview-controls">
        <span>📋 ${totalLabels} tem (${labelWidthMM}x${labelHeightMM}mm) - ${escapeHtml(poCode)}</span>
        <div>
            <button class="btn-print" id="print-btn">🖨️ In</button>
            <button class="btn-close" id="close-btn">✕</button>
        </div>
    </div>
    <div class="label-container">${labelsHtml}</div>
</body></html>`;

    const iframeDoc = printIframe.contentDocument || printIframe.contentWindow?.document;
    if (!iframeDoc) { toast('Không thể tạo tài liệu in!', 'error'); return; }
    iframeDoc.open();
    iframeDoc.write(printContent);
    iframeDoc.close();

    setTimeout(() => {
        const printBtn = iframeDoc.getElementById('print-btn');
        const closeBtn = iframeDoc.getElementById('close-btn');

        if (printBtn) {
            printBtn.onclick = function () { printIframe.contentWindow.print(); };
        }
        if (closeBtn) {
            closeBtn.onclick = function () { printIframe.style.display = 'none'; };
        }
        printIframe.contentWindow.onafterprint = function () { printIframe.style.display = 'none'; };
    }, 100);

    toast(`Đã mở preview ${totalLabels} tem`, "info");
}

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-INVOICE TAB EXTENSIONS
// Additional functions for order drafts - Main tab functions are at lines 131-248
// ═══════════════════════════════════════════════════════════════════════════

// Save current order as draft
function saveOrderDraft() {
    return saveCartAsDraft();
}

// Initialize tabs on load
function initInvoiceTabs() {
    renderInvoiceTabs();
}

// Add Ctrl+T shortcut for new tab
document.addEventListener('keydown', function (e) {
    if (!isAuthenticated) return;
    if (matchesShortcut(db.settings?.shortcuts?.tabNew || 'Ctrl+T', e)) {
        e.preventDefault();
        createNewInvoiceTab();
    }
    // Ctrl+1-9 to switch tabs
    if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key) - 1;
        if (index < invoiceTabs.length) {
            e.preventDefault();
            switchTab(invoiceTabs[index].id);
        }
    }
});

// Invoice tabs - initialized in consolidated DOMContentLoaded

// ═══════════════════════════════════════════════════════════════════════════
// ENHANCED KEYBOARD NAVIGATION SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

// focusedProductIndex declared at top of file
let keyboardNavEnabled = true;

// Initialize keyboard navigation
function initKeyboardNavigation() {
    document.addEventListener('keydown', handleKeyboardNav);
}

// Handle keyboard navigation - Comprehensive KiotViet-style shortcuts
function handleKeyboardNav(e) {
    if (!isAuthenticated || isLoginModalActive()) {
        if (isLoginModalActive() && e.key === 'Escape') e.preventDefault();
        return;
    }
    if (e.defaultPrevented) return;

    const isInputField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
    const isSearchInput = e.target.id === 'pos-search';
    const isModalOpen = document.querySelector('.modal-overlay.active');

    // ═══════════════════════════════════════════════════════════════════
    // CUSTOMIZABLE SHORTCUTS - Read from db.settings.shortcuts
    // ═══════════════════════════════════════════════════════════════════

    const shortcuts = db.settings?.shortcuts || {};
    const key = e.key;

    // Search shortcut (default: F1)
    if (matchesShortcut(shortcuts.search || 'F1', e)) {
        e.preventDefault();
        $('pos-search')?.focus();
        $('pos-search')?.select();
        return;
    }

    // Clear/Cancel shortcut (default: F2)
    if (matchesShortcut(shortcuts.clear || 'F2', e)) {
        e.preventDefault();
        if (cart.length > 0) {
            if (confirm('Huỷ đơn hàng hiện tại?')) {
                clearCart();
                toast('Đã huỷ đơn hàng', 'info');
            }
        }
        return;
    }

    // Print shortcut (default: F3)
    if (matchesShortcut(shortcuts.print || 'F3', e)) {
        e.preventDefault();
        const lastInv = db.invoices[0];
        if (lastInv) {
            printInv(lastInv);
            toast('Đang in hoá đơn cuối...', 'info');
        } else {
            toast('Chưa có hoá đơn nào', 'warning');
        }
        return;
    }

    // Payment shortcut (default: F4)
    if (matchesShortcut(shortcuts.pay || 'F4', e)) {
        e.preventDefault();
        if (cart.length > 0) {
            directCheckout();
        } else {
            toast('Giỏ hàng trống!', 'warning');
        }
        return;
    }

    // Customer shortcut (default: F5)
    if (matchesShortcut(shortcuts.customer || 'F5', e)) {
        e.preventDefault();
        $('cart-cust')?.focus();
        return;
    }

    // Discount shortcut (default: F6)
    if (matchesShortcut(shortcuts.discount || 'F6', e)) {
        e.preventDefault();
        $('cart-discount')?.focus();
        $('cart-discount')?.select();
        return;
    }

    // Note shortcut (default: F7)
    if (matchesShortcut(shortcuts.note || 'F7', e)) {
        e.preventDefault();
        const noteVal = prompt('Ghi chú đơn hàng:', window.orderNote || '');
        if (noteVal !== null) {
            window.orderNote = noteVal;
            toast('Đã thêm ghi chú', 'success');
        }
        return;
    }

    // Save draft shortcut (default: F8)
    if (matchesShortcut(shortcuts.save || 'F8', e)) {
        e.preventDefault();
        saveOrderDraft();
        return;
    }

    // New tab shortcut (default: F9)
    if (matchesShortcut(shortcuts.newTab || 'F9', e)) {
        e.preventDefault();
        createNewInvoiceTab();
        return;
    }

    // Help shortcut (default: F12)
    if (matchesShortcut(shortcuts.help || 'F12', e)) {
        e.preventDefault();
        showKeyboardShortcutsHelp();
        return;
    }

    // Toggle sidebar (default: F10)
    if (matchesShortcut(shortcuts.menu || 'F10', e)) {
        e.preventDefault();
        document.querySelector('aside')?.classList.toggle('mobile-open');
        return;
    }

    // F11 - Fullscreen (let browser handle)
    if (key === 'F11') {
        return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // CTRL SHORTCUTS - System shortcuts with Ctrl modifier
    // ═══════════════════════════════════════════════════════════════════

    {

        // Ctrl+Z - Undo last action
        if (matchesShortcut(shortcuts.undo || 'Ctrl+Z', e)) {
            e.preventDefault();
            performUndo();
            return;
        }

        // Ctrl+S - Save (context-aware)
        if (matchesShortcut(shortcuts.quickSave || 'Ctrl+S', e)) {
            e.preventDefault();
            performGlobalSave();
            return;
        }

        // Ctrl+N - New (context-aware: product/customer/staff)
        if (matchesShortcut(shortcuts.newItem || 'Ctrl+N', e)) {
            e.preventDefault();
            const currentView = document.querySelector('.view.active')?.id;
            if (currentView === 'products-view') openProdModal();
            else if (currentView === 'customers-view') openCustModal();
            else if (currentView === 'staff-view') openUserModal();
            return;
        }

        // Ctrl+P - Print last invoice (newest is at index 0)
        if (matchesShortcut(shortcuts.quickPrint || 'Ctrl+P', e)) {
            e.preventDefault();
            if (db.invoices.length > 0) {
                printInv(db.invoices[0]);
            } else {
                toast("Chưa có hóa đơn nào!", "warning");
            }
            return;
        }

        // Ctrl+R - Return goods
        if (matchesShortcut(shortcuts.returnGoods || 'Ctrl+R', e)) {
            e.preventDefault();
            if (typeof openReturnModal === 'function') {
                openReturnModal();
            }
            return;
        }

        // Ctrl+W - Close current tab
        if (matchesShortcut(shortcuts.tabClose || 'Ctrl+W', e)) {
            e.preventDefault();
            if (typeof closeTab === 'function' && typeof activeTabId !== 'undefined') {
                closeTab(activeTabId, null);
            }
            return;
        }

        // Ctrl+Tab - Next tab / Ctrl+Shift+Tab - Previous tab
        if (matchesShortcut(shortcuts.tabNext || 'Ctrl+Tab', e) ||
            matchesShortcut(shortcuts.tabPrev || 'Ctrl+Shift+Tab', e)) {
            e.preventDefault();
            if (typeof invoiceTabs !== 'undefined' && invoiceTabs.length > 1) {
                const currentIndex = invoiceTabs.findIndex(t => t.id === activeTabId);
                if (matchesShortcut(shortcuts.tabPrev || 'Ctrl+Shift+Tab', e)) {
                    // Previous tab
                    const prevIndex = currentIndex > 0 ? currentIndex - 1 : invoiceTabs.length - 1;
                    switchTab(invoiceTabs[prevIndex].id);
                } else {
                    // Next tab
                    const nextIndex = currentIndex < invoiceTabs.length - 1 ? currentIndex + 1 : 0;
                    switchTab(invoiceTabs[nextIndex].id);
                }
            }
            return;
        }

        // Ctrl+Shift+A - Add new product
        if (matchesShortcut(shortcuts.addProduct || 'Ctrl+Shift+A', e)) {
            const currentView = document.querySelector('.view.active')?.id;
            if (currentView === 'products-view' || currentView === 'management-view') {
                e.preventDefault();
                openProdModal();
            }
            return;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // ESCAPE - Universal close
    // ═══════════════════════════════════════════════════════════════════

    if (e.key === 'Escape') {
        e.preventDefault();
        if (isModalOpen) {
            closeAllModals();
        } else if (focusedProductIndex >= 0 || posSelectedIndex >= 0) {
            // Clear BOTH systems
            clearProductFocus();
            posSelectedIndex = -1;
            posSelectedProductId = null;
            const grid = $('pos-grid');
            if (grid) {
                grid.querySelectorAll('.p-card').forEach(c => c.setAttribute('data-selected', 'false'));
            }
        } else if ($('pos-search')?.value) {
            $('pos-search').value = '';
            renderPos();
        }
        return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // ` (BACKTICK) - Cycle through categories (ONLY on POS view)
    // Using backtick instead of Tab to avoid browser conflicts
    // ═══════════════════════════════════════════════════════════════════

    // Check if we're on the POS view by verifying pos-grid is visible
    const posGrid = $('pos-grid');
    const isOnPosView = posGrid && posGrid.offsetParent !== null && posGrid.offsetHeight > 0;

    const categoryShortcut = shortcuts.category || '`';
    if ((matchesShortcut(categoryShortcut, e) || (categoryShortcut === '`' && e.key === '~')) &&
        !isModalOpen && isOnPosView && !isInputField) {
        e.preventDefault();
        const posCat = $('pos-cat');
        if (posCat) {
            const options = Array.from(posCat.options);
            const currentIndex = posCat.selectedIndex;

            if (e.shiftKey) {
                // Previous category
                posCat.selectedIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
            } else {
                // Next category
                posCat.selectedIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
            }
            // FIX: Reset BOTH systems BEFORE render to prevent stale selection re-application
            focusedProductIndex = -1;
            posSelectedIndex = -1;
            posSelectedProductId = null;
            renderPos();
            toast(`Danh mục: ${posCat.options[posCat.selectedIndex].text}`, 'info');
            return;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // CART OPERATIONS - Only when not in input fields and on POS view
    // ═══════════════════════════════════════════════════════════════════

    if (!isInputField && cart.length > 0) {
        // + Add quantity to last item
        const increaseShortcut = shortcuts.cartIncrease || '+';
        if (matchesShortcut(increaseShortcut, e) || (increaseShortcut === '+' && e.key === '=')) {
            e.preventDefault();
            const lastItem = cart[cart.length - 1];
            if (lastItem) {
                const product = db.products.find(p => sameStoredId(p.id, lastItem.id));
                if (product && lastItem.qty < product.stock) {
                    lastItem.qty++;
                    renderCart();
                    toast(`${lastItem.name}: ${lastItem.qty}`, 'success');
                } else {
                    toast('Đã đạt giới hạn tồn kho!', 'warning');
                }
            }
            return;
        }

        // - Reduce quantity of last item
        const decreaseShortcut = shortcuts.cartDecrease || '-';
        if (matchesShortcut(decreaseShortcut, e) || (decreaseShortcut === '-' && e.key === '_')) {
            e.preventDefault();
            const lastItem = cart[cart.length - 1];
            if (lastItem) {
                if (lastItem.qty > 1) {
                    lastItem.qty--;
                    renderCart();
                    toast(`${lastItem.name}: ${lastItem.qty}`, 'info');
                } else {
                    // Remove item
                    cart.pop();
                    renderCart();
                    toast(`Đã xoá ${lastItem.name}`, 'info');
                }
            }
            return;
        }

        // Delete - Remove last item from cart
        const deleteLastShortcut = shortcuts.cartDeleteLast || 'Delete';
        if (matchesShortcut(deleteLastShortcut, e) || (deleteLastShortcut === 'Delete' && e.key === 'Backspace')) {
            e.preventDefault();
            const lastItem = cart.pop();
            if (lastItem) {
                renderCart();
                toast(`Đã xoá ${lastItem.name}`, 'info');
            }
            return;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // NUMBER KEYS 1-9 - Quick add products (when not in input)
    // ═══════════════════════════════════════════════════════════════════

    if (!isInputField && !e.ctrlKey && !e.altKey) {
        const numMatch = e.key.match(/^[1-9]$/);
        if (numMatch) {
            const index = parseInt(e.key) - 1;
            const grid = $('pos-grid');
            if (grid) {
                const cards = grid.querySelectorAll('.p-card');
                if (cards[index]) {
                    e.preventDefault();
                    cards[index].click();
                    // Visual feedback
                    cards[index].classList.add('keyboard-clicked');
                    setTimeout(() => cards[index].classList.remove('keyboard-clicked'), 200);
                    return;
                }
            }
        }

        // 0 - Show all products (clear category filter)
        if (e.key === '0') {
            e.preventDefault();
            const posCat = $('pos-cat');
            if (posCat) {
                posCat.value = '';
                renderPos();
                toast('Hiện tất cả sản phẩm', 'info');
            }
            return;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // ARROW KEYS & ENTER - Product navigation
    // DISABLED: All arrow key and Enter handling is now done by System 1 (handleSearchKey)
    // to prevent dual-system conflicts that caused selection resets.
    // ═══════════════════════════════════════════════════════════════════

    // If user is in any input field, don't handle navigation here
    if (isInputField) return;

    // DISABLED: Arrow keys and Enter are now handled ONLY by handleSearchKey (System 1)
    // to prevent the selection reset bug caused by two competing systems.
    // When arrow keys are pressed, we just focus the search input and let System 1 handle it.
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) {
        // Focus search input to activate System 1
        const searchInput = $('pos-search');
        if (searchInput) {
            searchInput.focus();
            // Let the keydown event bubble to handleSearchKey
            // Dispatch a new keydown event to handleSearchKey
            handleSearchKey(e);
        }
        return;
    }

    // Keep Home/End/PageUp/PageDown but use System 1 variables
    const grid = $('pos-grid');
    if (!grid) return;

    const cards = Array.from(grid.querySelectorAll('.p-card'));
    if (cards.length === 0) return;

    const gridWidth = grid.offsetWidth;
    const cardWidth = cards[0]?.offsetWidth || 1;
    const columns = Math.max(1, Math.floor(gridWidth / cardWidth));

    switch (e.key) {
        case 'Home':
            e.preventDefault();
            posSelectedIndex = 0;
            posSelectedProductId = cards[0]?.getAttribute('data-id') || null;
            applyPOSSelectionHighlight(grid, cards, 0);
            break;

        case 'End':
            e.preventDefault();
            posSelectedIndex = cards.length - 1;
            posSelectedProductId = cards[cards.length - 1]?.getAttribute('data-id') || null;
            applyPOSSelectionHighlight(grid, cards, cards.length - 1);
            break;

        case 'PageDown':
            e.preventDefault();
            posSelectedIndex = Math.min((posSelectedIndex < 0 ? 0 : posSelectedIndex) + (columns * 3), cards.length - 1);
            posSelectedProductId = cards[posSelectedIndex]?.getAttribute('data-id') || null;
            applyPOSSelectionHighlight(grid, cards, posSelectedIndex);
            break;

        case 'PageUp':
            e.preventDefault();
            posSelectedIndex = Math.max((posSelectedIndex < 0 ? 0 : posSelectedIndex) - (columns * 3), 0);
            posSelectedProductId = cards[posSelectedIndex]?.getAttribute('data-id') || null;
            applyPOSSelectionHighlight(grid, cards, posSelectedIndex);
            break;
    }
}

// Helper function to apply POS selection highlight (System 1 unified)
function applyPOSSelectionHighlight(grid, cards, index) {
    grid.querySelectorAll('.p-card').forEach(card => {
        card.setAttribute('data-selected', 'false');
        card.classList.remove('keyboard-focused');
    });
    if (cards[index]) {
        cards[index].setAttribute('data-selected', 'true');
        cards[index].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

// Show keyboard shortcuts help modal - Toggle on/off and use dynamic shortcuts
function showKeyboardShortcutsHelp() {
    // Toggle: if modal already exists, close it and return
    const existingModal = document.getElementById('keyboard-help-modal');
    if (existingModal) {
        closeModal('keyboard-help-modal');
        return;
    }

    // Get current shortcuts (custom or default from settings)
    const shortcuts = db.settings?.shortcuts || {};

    // Helper to get current key for a shortcut
    const getKey = (id) => {
        // First check custom shortcuts, then fall back to default
        if (shortcuts[id]) return shortcuts[id];
        if (defaultShortcuts[id]) return defaultShortcuts[id].key;
        return '';
    };

    // Build dynamic help content based on current shortcuts
    const helpHtml = `
        <div style="max-width:600px;">
            <h3 style="margin-bottom:16px; color:var(--primary);">⌨️ Phím tắt bàn phím</h3>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                <div>
                    <h4 style="margin-bottom:8px; color:var(--text-primary);">🎯 Phím chức năng</h4>
                    <div class="shortcut-list">
                        <div><kbd>${getKey('search')}</kbd> Tìm kiếm sản phẩm</div>
                        <div><kbd>${getKey('clear')}</kbd> Huỷ đơn hàng</div>
                        <div><kbd>${getKey('print')}</kbd> In hoá đơn cuối</div>
                        <div><kbd>${getKey('pay')}</kbd> Thanh toán</div>
                        <div><kbd>${getKey('customer')}</kbd> Chọn khách hàng</div>
                        <div><kbd>${getKey('discount')}</kbd> Nhập giảm giá</div>
                        <div><kbd>${getKey('note')}</kbd> Ghi chú đơn</div>
                        <div><kbd>${getKey('save')}</kbd> Lưu nháp</div>
                        <div><kbd>${getKey('newTab')}</kbd> Tạo tab mới</div>
                        <div><kbd>${getKey('help')}</kbd> Hiện trợ giúp này</div>
                    </div>
                </div>
                <div>
                    <h4 style="margin-bottom:8px; color:var(--text-primary);">🧭 Điều hướng</h4>
                    <div class="shortcut-list">
                        <div><kbd>${getKey('navPos')}</kbd> Bán hàng</div>
                        <div><kbd>${getKey('navProducts')}</kbd> Sản phẩm</div>
                        <div><kbd>${getKey('navHistory')}</kbd> Lịch sử</div>
                        <div><kbd>${getKey('navManagement')}</kbd> Quản lý</div>
                        <div><kbd>${getKey('navCustomers')}</kbd> Khách hàng</div>
                        <div><kbd>${getKey('navStaff')}</kbd> Nhân viên</div>
                        <div><kbd>${getKey('navSettings')}</kbd> Cài đặt</div>
                    </div>
                </div>
            </div>
            <div style="margin-top:16px;">
                <h4 style="margin-bottom:8px; color:var(--text-primary);">🛒 Thao tác giỏ hàng</h4>
                <div class="shortcut-list" style="display:flex; flex-wrap:wrap; gap:8px;">
                    <div><kbd>1-9</kbd> Thêm nhanh SP 1-9</div>
                    <div><kbd>+</kbd> Tăng SL sản phẩm</div>
                    <div><kbd>-</kbd> Giảm SL sản phẩm</div>
                    <div><kbd>Del</kbd> Xoá SP cuối</div>
                    <div><kbd>Esc</kbd> Đóng/Huỷ</div>
                </div>
            </div>
            <div style="margin-top:16px;">
                <h4 style="margin-bottom:8px; color:var(--text-primary);">📑 Di chuyển & Tab</h4>
                <div class="shortcut-list" style="display:flex; flex-wrap:wrap; gap:8px;">
                    <div><kbd>↑↓←→</kbd> Di chuyển SP</div>
                    <div><kbd>Enter</kbd> Thêm vào giỏ</div>
                    <div><kbd>Ctrl+T</kbd> Tạo tab mới</div>
                    <div><kbd>Ctrl+1-9</kbd> Chuyển tab</div>
                </div>
            </div>
            <div style="margin-top:12px; padding:10px; background:var(--bg-muted); border-radius:var(--radius-sm); font-size:12px; color:var(--text-muted);">
                💡 Bạn có thể tùy chỉnh phím tắt tại <strong>Cài đặt → Phím tắt tùy chỉnh</strong>
            </div>
        </div>
    `;

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.id = 'keyboard-help-modal';
    modal.innerHTML = `
        <div class="modal" style="max-width:650px;">
            <div class="modal-head">
                <span>Trợ giúp phím tắt</span>
                <span class="close" onclick="closeModal('keyboard-help-modal')">×</span>
            </div>
            <div class="modal-body">
                ${helpHtml}
            </div>
            <div class="modal-foot">
                <button class="btn btn-secondary" onclick="closeModal('keyboard-help-modal')">Đóng (Esc)</button>
            </div>
        </div>
        <style>
            .shortcut-list { font-size:13px; }
            .shortcut-list > div { padding:4px 0; display:flex; align-items:center; gap:8px; }
            .shortcut-list kbd {
                background: var(--bg-muted);
                border: 1px solid var(--border-medium);
                border-radius: 4px;
                padding: 2px 6px;
                font-family: monospace;
                font-size: 11px;
                min-width: 24px;
                text-align: center;
                box-shadow: 0 1px 2px rgba(0,0,0,0.1);
            }
        </style>
    `;
    document.body.appendChild(modal);
}

// Update visual focus on product cards
function updateProductFocus(cards) {
    // Remove previous focus
    cards.forEach(c => c.classList.remove('keyboard-focused'));

    // Add focus to current card
    if (focusedProductIndex >= 0 && focusedProductIndex < cards.length) {
        const card = cards[focusedProductIndex];
        card.classList.add('keyboard-focused');

        // CRITICAL: Sync System 1 (posSelectedIndex) with System 2 (focusedProductIndex)
        // This ensures Enter key works correctly regardless of which system initiated navigation
        posSelectedIndex = focusedProductIndex;
        posSelectedProductId = card.getAttribute('data-id');

        // Scroll into view if needed
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
}

// Clear product focus
function clearProductFocus() {
    focusedProductIndex = -1;
    const cards = document.querySelectorAll('.p-card.keyboard-focused');
    cards.forEach(c => c.classList.remove('keyboard-focused'));
}

// Add global click listener to clear keyboard focus when clicking outside products
document.addEventListener('click', function (e) {
    // Only clear focus if clicking outside a product card
    if (!e.target.closest('.p-card')) {
        clearProductFocus();
    }
});

// Close all modals
function closeAllModals() {
    const modals = document.querySelectorAll('.modal-overlay.active');
    modals.forEach(modal => {
        if (modal.id === 'login-modal' && !isAuthenticated) return;
        if (modal.id) {
            closeModal(modal.id);
        } else {
            modal.classList.remove('active');
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL BARCODE SCANNER (Issue #7)
// Works regardless of focus - captures rapid keyboard input
// ═══════════════════════════════════════════════════════════════════════════

// globalBarcodeBuffer declared at top of file
let globalBarcodeTimeout = null;
const BARCODE_INPUT_TIMEOUT = 150; // ms - scanner types faster than humans (increased for better compatibility)

document.addEventListener('keypress', function (e) {
    if (!isAuthenticated || isLoginModalActive()) return;

    // Skip if typing in certain fields
    const isModal = e.target.closest('.modal-overlay.active');
    const isInputField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);

    // Only process if not in an active modal input (except pos-search)
    if (isModal && isInputField && e.target.id !== 'pos-search') {
        return;
    }

    // Clear previous timeout
    if (globalBarcodeTimeout) clearTimeout(globalBarcodeTimeout);

    // If Enter key, check if we have a barcode
    if (e.key === 'Enter') {
        if (globalBarcodeBuffer.length >= 4) {
            e.preventDefault();
            e.stopPropagation();
            processGlobalBarcode(globalBarcodeBuffer.trim());
        }
        globalBarcodeBuffer = '';
        return;
    }

    // Accumulate printable characters
    if (e.key.length === 1) {
        globalBarcodeBuffer += e.key;
    }

    // Reset buffer after timeout (human typing is slower)
    globalBarcodeTimeout = setTimeout(() => {
        globalBarcodeBuffer = '';
    }, BARCODE_INPUT_TIMEOUT);
});

// Process barcode from global scanner
function processGlobalBarcode(barcode) {
    console.log('Scanner detected barcode:', barcode);

    // Search for product by code
    let product = db.products.find(p =>
        (p.code || '').toLowerCase() === barcode.toLowerCase() ||
        p.code === barcode
    );

    // Fallback: partial match
    if (!product) {
        product = db.products.find(p =>
            (p.code || '').includes(barcode)
        );
    }

    if (product) {
        // Check if on POS page
        const posGrid = $('pos-grid');
        if (posGrid) {
            const autoAdd = db.settings?.scannerAutoAdd !== false;
            const showPopup = db.settings?.scannerPopup !== false;
            if (autoAdd && product.stock > 0) {
                addCart(product.id);
                toast(`Đã quét: ${product.name}`, 'success');
            } else if (showPopup && product.stock > 0) {
                showScannedProductPopup(product);
            } else if (product.stock > 0) {
                toast(`Tìm thấy: ${product.name}`, 'info');
            } else {
                toast(`${product.name} - Hết hàng!`, 'warning');
            }
        } else {
            toast(`Tìm thấy: ${product.name}`, 'info');
        }
    } else {
        toast(`Không tìm thấy sản phẩm với mã: ${barcode}`, 'warning');
    }

    // Keep barcode in search box and select all for consecutive scanning
    const posSearch = $('pos-search');
    if (posSearch) {
        posSearch.value = barcode; // Display barcode in search box
        posSearch.focus();         // Focus the search box
        posSearch.select();        // Select all text - next scan will auto-replace
        renderPos();               // Update product display
    }
}

// Keyboard nav, cart resize, shortcut labels - initialized in consolidated DOMContentLoaded

// Cart Panel Resize by Mouse Drag
function initCartResize() {
    const posRight = document.querySelector('.pos-right');
    if (!posRight) return;
    if ($('pos-resizer')) return;
    if (posRight.querySelector('.cart-resize-handle')) return;

    // Create resize handle element
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'cart-resize-handle';
    resizeHandle.innerHTML = '⋮⋮';
    posRight.appendChild(resizeHandle);

    // Add required styles dynamically
    const styleEl = document.createElement('style');
    styleEl.textContent = `
        .cart-resize-handle {
            position: absolute;
            left: 0;
            top: 50%;
            transform: translateY(-50%);
            width: 12px;
            height: 80px;
            background: linear-gradient(90deg, var(--primary-light), transparent);
            color: var(--primary);
            font-size: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 0 6px 6px 0;
            cursor: ew-resize;
            opacity: 0.3;
            transition: opacity 0.2s, background 0.2s;
            z-index: 100;
            user-select: none;
        }
        .cart-resize-handle:hover,
        .cart-resize-handle.active {
            opacity: 1;
            background: linear-gradient(90deg, var(--primary), transparent 80%);
        }
        .pos-right {
            resize: none !important; /* Disable CSS resize, using JS instead */
        }
        .pos-right::after {
            display: none !important; /* Hide CSS pseudo-element handle */
        }
        body.resizing {
            cursor: ew-resize !important;
            user-select: none !important;
        }
        body.resizing * {
            cursor: ew-resize !important;
            user-select: none !important;
        }
    `;
    document.head.appendChild(styleEl);

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    const minWidth = 400;
    const maxWidth = 800;

    resizeHandle.addEventListener('mousedown', function (e) {
        e.preventDefault();
        isResizing = true;
        startX = e.clientX;
        startWidth = posRight.offsetWidth;
        resizeHandle.classList.add('active');
        document.body.classList.add('resizing');
    });

    document.addEventListener('mousemove', function (e) {
        if (!isResizing) return;
        e.preventDefault();

        // Calculate new width (resizing from left edge, so invert delta)
        const deltaX = startX - e.clientX;
        let newWidth = startWidth + deltaX;

        // Constrain to min/max
        newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

        posRight.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', function (e) {
        if (isResizing) {
            isResizing = false;
            resizeHandle.classList.remove('active');
            document.body.classList.remove('resizing');
            // Save preferred width to localStorage
            localStorage.setItem('cartPanelWidth', posRight.offsetWidth);
        }
    });

    // Restore saved width
    const savedWidth = localStorage.getItem('cartPanelWidth');
    if (savedWidth) {
        const width = parseInt(savedWidth);
        if (width >= minWidth && width <= maxWidth) {
            posRight.style.width = width + 'px';
        }
    }
}

// ========== BATCH LABEL MODAL HANDLERS ==========

// Update batch label count display
function updateBatchLabelCount() {
    const container = $('batch-label-items');
    if (!container) return;

    // Find all items - look for checkboxes in the container
    const allCheckboxes = container.querySelectorAll('input[type="checkbox"]');
    const checkedCheckboxes = container.querySelectorAll('input[type="checkbox"]:checked');

    // Calculate total labels from all number inputs next to checked checkboxes
    let totalLabels = 0;
    checkedCheckboxes.forEach(checkbox => {
        // Try to find the input[type="number"] in the same row/item
        const parent = checkbox.closest('div') || checkbox.parentElement?.parentElement;
        const qtyInput = parent?.querySelector('input[type="number"]');
        if (qtyInput) {
            totalLabels += parseInt(qtyInput.value) || 0;
        }
    });

    // Also try to get total by looking at all number inputs directly
    if (totalLabels === 0) {
        const allInputs = container.querySelectorAll('input[type="number"]');
        allInputs.forEach(input => {
            // Check if the parent item is selected (has checked checkbox)
            const parent = input.closest('div') || input.parentElement?.parentElement;
            const checkbox = parent?.querySelector('input[type="checkbox"]');
            if (checkbox?.checked) {
                totalLabels += parseInt(input.value) || 0;
            }
        });
    }

    // Update count displays
    const countEl = $('batch-label-count');
    const totalEl = $('batch-label-total');

    if (countEl) {
        countEl.textContent = `${checkedCheckboxes.length}/${allCheckboxes.length} sản phẩm`;
    }
    if (totalEl) {
        totalEl.textContent = `Tổng: ${totalLabels.toLocaleString('vi-VN')} tem`;
        totalEl.style.color = totalLabels > 0 ? 'var(--primary)' : 'var(--text-muted)';
    }

    // Update select all checkbox
    const selectAllCheckbox = $('batch-label-select-all');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = checkedCheckboxes.length === allCheckboxes.length && allCheckboxes.length > 0;
        selectAllCheckbox.indeterminate = checkedCheckboxes.length > 0 && checkedCheckboxes.length < allCheckboxes.length;
    }
}

// NOTE: toggleAllLabelItems and printSelectedLabels are defined earlier (line ~10917 and ~10928)
// using the global batchLabelItems array, not DOM queries

// Event delegation for batch label modal - auto update count on changes
document.addEventListener('change', function (e) {
    const modal = $('batch-label-modal');
    if (!modal || !modal.classList.contains('active')) return;

    if (e.target.closest('#batch-label-items')) {
        updateBatchLabelCount();
    }
});

document.addEventListener('input', function (e) {
    const modal = $('batch-label-modal');
    if (!modal || !modal.classList.contains('active')) return;

    if (e.target.closest('#batch-label-items') && e.target.type === 'number') {
        updateBatchLabelCount();
    }
});

// Also update when modal opens - use MutationObserver
const batchModalObserver = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            const modal = mutation.target;
            if (modal.id === 'batch-label-modal' && modal.classList.contains('active')) {
                setTimeout(updateBatchLabelCount, 100);
            }
        }
    });
});

function safeRun(label, fn, fallback) {
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            return result.catch(error => {
                console.error(`SafeRun failed: ${label}`, error);
                logRendererEvent('safe-run-error', { label, error: serializeError(error) });
                if (typeof fallback === 'function') {
                    try { return fallback(error); } catch (fallbackError) {
                        console.error(`SafeRun fallback failed: ${label}`, fallbackError);
                    }
                }
                if (typeof toast === 'function') {
                    try { toast("Có lỗi giao diện. Ứng dụng đã ghi log và tiếp tục hoạt động.", "error"); } catch (_) { }
                }
                return undefined;
            });
        }
        return result;
    } catch (error) {
        console.error(`SafeRun failed: ${label}`, error);
        logRendererEvent('safe-run-error', { label, error: serializeError(error) });
        if (typeof fallback === 'function') {
            try { return fallback(error); } catch (fallbackError) {
                console.error(`SafeRun fallback failed: ${label}`, fallbackError);
            }
        }
        if (typeof toast === 'function') {
            try { toast("Có lỗi giao diện. Ứng dụng đã ghi log và tiếp tục hoạt động.", "error"); } catch (_) { }
        }
        return undefined;
    }
}

function safeWrapAppFunction(name) {
    const original = globalThis[name];
    if (typeof original !== 'function' || original.__safeWrapped) return;

    const wrapped = function (...args) {
        return safeRun(name, () => original.apply(this, args));
    };
    wrapped.__safeWrapped = true;
    globalThis[name] = wrapped;
}

[
    'renderNav',
    'router',
    'renderPos',
    'renderCart',
    'renderInvoiceTabs',
    'renderProdTable',
    'renderProductsTab',
    'renderHist',
    'renderReturnsHistory',
    'renderManagement',
    'renderMgmtTab',
    'renderCustTable',
    'renderStaffView',
    'renderUsers',
    'drawRevenueChart',
    'drawPieChart',
    'drawStaffChart',
    'drawMgmtChart',
    'drawMgmtPieChart',
    'loadSets',
    'updateShortcutLabels',
    'initInvoiceTabs',
    'initKeyboardNavigation',
    'initCartResize',
    'initSidebarState',
    'detectDevices'
].forEach(safeWrapAppFunction);

// ═══════════════════════════════════════════════════════════════════════════
// CONSOLIDATED DOMContentLoaded - All initialization in one listener
// ═══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async function () {
    await safeRun('DOMContentLoaded', async () => {
        // 1. Core init (load data, setup shortcuts, render)
        await init();
        setPaymentDetailsExpanded(false);

        // 2. Invoice tabs
        initInvoiceTabs();

        // 3. Keyboard navigation
        initKeyboardNavigation();

        // 4. Sidebar state
        setTimeout(initSidebarState, 50);

        // 5. Return reason change listener
        const reasonSelect = $('return-reason');
        if (reasonSelect) {
            reasonSelect.addEventListener('change', onReturnReasonChange);
        }

        // 6. Barcode preview listener
        const codeInput = $('p-code');
        if (codeInput) {
            codeInput.addEventListener('input', (e) => {
                safeRun('updateBarcodePreview', () => updateBarcodePreview(e.target.value));
            });
        }

        // 7. Settings collapsible & devices
        setTimeout(() => safeRun('settings-delayed-init', () => {
            document.querySelectorAll('.settings-collapsible').forEach((box, index) => {
                setSettingsSectionCollapsed(box, index >= 2);
            });
            if (typeof detectDevices === 'function') detectDevices();
            if (typeof injectDraftsButton === 'function') injectDraftsButton();
        }), 100);

        // 8. Shortcut labels (after db loaded)
        setTimeout(() => safeRun('updateShortcutLabels', updateShortcutLabels), 500);

        // 9. Batch label modal observer
        const batchModal = $('batch-label-modal');
        if (batchModal && typeof batchModalObserver !== 'undefined') {
            batchModalObserver.observe(batchModal, { attributes: true });
        }
    });
});
