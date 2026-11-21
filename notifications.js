/* ponytail: one display policy shared by toast, undo toast and scanner status. */
(function (root) {
    const events = typeof module !== 'undefined' && module.exports ? require('./notification-events') : root.NTKIOTNotificationEvents;
    const registry = new Map(events.map(event => [event.id, event]));
    const groups = {
        pos: 'Bán hàng & Quét mã', returns: 'Đổi / Trả hàng', inventory: 'Hàng hóa & Kho',
        purchase: 'Đơn nhập & Nhà cung cấp', history: 'Lịch sử chứng từ', customers: 'Khách hàng & Công nợ',
        staff: 'Nhân viên & Đăng nhập', reports: 'Báo cáo, In & Xuất', system: 'Cài đặt, Dữ liệu & Hệ thống'
    };
    const defaultDisabled = events.filter(event => !event.defaultEnabled).map(event => event.id);
    function normalize(value) {
        return {
            version: 1,
            enabled: typeof value?.enabled === 'boolean' ? value.enabled : true,
            disabledEventIds: Array.isArray(value?.disabledEventIds)
                ? [...new Set(value.disabledEventIds.filter(id => typeof id === 'string'))] : [...defaultDisabled]
        };
    }
    let committed = normalize();
    let disabled = new Set(committed.disabledEventIds);
    const notices = new Map();
    const shown = new Map();
    let dockFrame = 0;
    let initialized = false;
    const get = id => root.document?.getElementById(id);
    function allowed(eventId) { return committed.enabled && (!registry.has(eventId) || !disabled.has(eventId)); }
    function dispose(node) {
        const record = notices.get(node);
        if (record) {
            root.clearTimeout(record.timer);
            if (record.dedupeKey && shown.get(record.dedupeKey) === record.eventId) shown.delete(record.dedupeKey);
        }
        notices.delete(node);
        node.remove();
        syncRegions();
    }
    function syncRegions() {
        for (const id of ['toast-box', 'pos-notifications']) {
            const region = get(id);
            if (region) {
                region.hidden = region.childElementCount === 0;
                if (region.hidden) region.scrollTop = 0;
            }
        }
    }
    // Keep clicks transparent; only wheel over overflowing toast text scrolls this region.
    function handleToastWheel(event) {
        if (event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey || !event.deltaY) return;
        const region = get('toast-box');
        if (!region || region.hidden || !region.clientHeight || region.scrollHeight <= region.clientHeight) return;
        const bounds = region.getBoundingClientRect();
        const inside = rect => event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom;
        if (!inside(bounds)) return;
        const toast = [...region.children].find(node => inside(node.getBoundingClientRect()));
        if (!toast) return;
        const style = root.getComputedStyle(toast);
        const unit = event.deltaMode === 1 ? parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 14) * 1.2
            : event.deltaMode === 2 ? region.clientHeight : 1;
        region.scrollTop = Math.max(0, Math.min(region.scrollHeight - region.clientHeight, region.scrollTop + event.deltaY * unit));
        event.preventDefault();
    }
    function dock() {
        dockFrame = 0;
        const pos = get('pos-view');
        const modalOpen = [...(root.document?.querySelectorAll('.modal-overlay') || [])]
            .some(node => node.classList.contains('active') || ['flex', 'block'].includes(node.style.display));
        const target = pos?.classList.contains('active') && !modalOpen ? get('pos-notifications') : get('toast-box');
        if (target) for (const node of notices.keys()) if (node.parentElement !== target) target.appendChild(node);
        syncRegions();
    }
    function scheduleDock() {
        if (!dockFrame) dockFrame = root.requestAnimationFrame(dock);
    }
    function commit(value) {
        const previous = committed;
        committed = normalize(value);
        disabled = new Set(committed.disabledEventIds);
        for (const [node, record] of notices) if (!allowed(record.eventId)) dispose(node);
        // Reenabled types can display again, but old messages are never replayed.
        for (const [key, eventId] of shown) {
            if ((!previous.enabled && committed.enabled) ||
                (previous.disabledEventIds.includes(eventId) && !disabled.has(eventId))) shown.delete(key);
        }
        return preferences();
    }
    function preferences() { return { ...committed, disabledEventIds: [...committed.disabledEventIds] }; }
    function emit(message, type = 'success', dedupe = true, eventId, channel = 'toast') {
        if (!allowed(eventId)) return;
        const target = get('toast-box');
        if (!target) return;
        const text = String(message ?? '');
        // Retain the existing stock-warning dedupe, never use it to filter types.
        const normalizedText = /Bán âm kho:|Vượt tồn kho:/.test(text)
            ? text.replace(/\(Tồn: [\-\d]+(?:, Bán: \d+)?\)/, '(stock_warning)') : text;
        if (dedupe && shown.has(normalizedText)) return;
        if (channel === 'undo') for (const [node, record] of notices) if (record.channel === 'undo') dispose(node);
        const severity = ['success', 'info', 'warning', 'error'].includes(type) ? type : 'info';
        const node = root.document.createElement('div');
        node.className = `toast ${severity}${channel === 'undo' ? ' undo-toast' : ''}`;
        node.dataset.notificationEvent = eventId || '';
        node.setAttribute('role', severity === 'warning' || severity === 'error' ? 'alert' : 'status');
        node.setAttribute('aria-atomic', 'true');
        const icon = channel === 'undo' ? '↩️' : { success: '✅', info: 'ℹ️', warning: '⚠️', error: '❌' }[severity];
        node.textContent = `${icon} ${text}`;
        target.appendChild(node);
        notices.set(node, { eventId, channel, dedupeKey: dedupe ? normalizedText : null, timer: root.setTimeout(() => dispose(node), channel === 'undo' ? 3000 : 3500) });
        if (dedupe) shown.set(normalizedText, eventId);
        dock();
    }
    function clearDedupe() { shown.clear(); }
    function readSettings() {
        const inputs = [...(get('notification-settings-list')?.querySelectorAll('[data-notification-event]') || [])];
        if (!inputs.length) return preferences();
        const unknown = committed.disabledEventIds.filter(id => !registry.has(id));
        return { version: 1, enabled: get('set-notifications-enabled')?.checked !== false,
            disabledEventIds: [...unknown, ...inputs.filter(input => !input.checked).map(input => input.dataset.notificationEvent)] };
    }
    function refreshGroups() {
        const list = get('notification-settings-list');
        if (!list) return;
        for (const checkbox of list.querySelectorAll('[data-notification-group]')) {
            const inputs = [...checkbox.closest('fieldset').querySelectorAll('[data-notification-event]')];
            const count = inputs.filter(input => input.checked).length;
            checkbox.checked = count === inputs.length;
            checkbox.indeterminate = count > 0 && count < inputs.length;
        }
    }
    function renderSettings(value) {
        const list = get('notification-settings-list');
        if (!list) return;
        const settings = normalize(value);
        const selected = new Set(settings.disabledEventIds);
        const section = get('notification-section');
        if (section) section.dataset.settingsSearch = ['Thông báo bật tắt cảnh báo lỗi quét mã', ...Object.values(groups), ...events.map(event => event.label)].join(' ');
        get('set-notifications-enabled').checked = settings.enabled;
        list.replaceChildren();
        for (const [group, label] of Object.entries(groups)) {
            const fieldset = root.document.createElement('fieldset');
            const legend = root.document.createElement('legend');
            const groupLabel = root.document.createElement('label');
            groupLabel.className = 'notification-option notification-group-option';
            const groupInput = root.document.createElement('input');
            groupInput.type = 'checkbox'; groupInput.dataset.notificationGroup = group;
            const groupText = root.document.createElement('span'); groupText.textContent = label;
            groupLabel.append(groupInput, groupText);
            legend.appendChild(groupLabel); fieldset.appendChild(legend);
            for (const event of events.filter(event => event.group === group)) {
                const row = root.document.createElement('label'); row.className = 'notification-option';
                const input = root.document.createElement('input'); input.type = 'checkbox';
                input.dataset.notificationEvent = event.id; input.checked = !selected.has(event.id);
                const text = root.document.createElement('span'); text.textContent = event.label;
                row.append(input, text); fieldset.appendChild(row);
            }
            list.appendChild(fieldset);
        }
        refreshGroups();
    }
    function init() {
        if (initialized || !root.document?.body) return;
        initialized = true;
        root.document.addEventListener('wheel', handleToastWheel, { capture: true, passive: false });
        get('notification-settings-list')?.addEventListener('change', event => {
            const input = event.target;
            if (input.dataset.notificationGroup) for (const child of input.closest('fieldset').querySelectorAll('[data-notification-event]')) child.checked = input.checked;
            refreshGroups();
        });
        const observer = new root.MutationObserver(records => {
            if (records.some(record => record.type === 'attributes' && record.target.matches('.view, .modal-overlay') ||
                record.type === 'childList' && record.target === root.document.body)) scheduleDock();
        });
        observer.observe(root.document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
        dock();
    }
    const api = { events, normalize, allowed, commit, preferences, emit, clearDedupe, readSettings, renderSettings, init, dock };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else { root.NTKIOTNotifications = api; root.document.addEventListener('DOMContentLoaded', init); }
})(globalThis);
