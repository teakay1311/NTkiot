/* ponytail: resize changes existing DOM only, never renderer state or persistence. */
(function (root) {
    const definitions = {
        'hist-body': { kind: 'sales', columns: ['select','id','date','customer','staff','items','total','discount','payment','actions'], hide: ['customer','staff','payment'], widths: [40,140,104,140,128,104,160,160,104,192], row: '.hist-row' },
        'returns-body': { kind: 'returns', columns: ['select','id','date','customer','returnCount','exchangeCount','difference','staff','actions'], hide: ['customer','staff'], widths: [40,106,104,140,132,132,160,96,192], row: '.returns-row' },
        'mgmt-stock-history-body': { kind: 'stock', columns: ['select','date','type','product','quantity','price','total','note','user','actions'], hide: ['note','user'], widths: [40,108,100,140,100,160,160,140,110,116], row: 'tr' },
        'inv-stock-history-body': { kind: 'stock', columns: ['select','date','type','product','quantity','price','total','note','user','actions'], hide: ['note','user'], widths: [40,108,100,140,100,160,160,140,110,116], row: 'tr' }
    };
    const records = new Map();
    const canvas = root.document?.createElement('canvas');
    let initialized = false;
    function allocateWidths(minimum, preferred, available) {
        if (!minimum.length || minimum.length !== preferred.length || !Number.isFinite(available) ||
            minimum.some(value => !Number.isFinite(value) || value <= 0) || preferred.some(value => !Number.isFinite(value))) return null;
        const mins = minimum.map(Math.ceil), prefs = preferred.map((value, i) => Math.max(mins[i], Math.ceil(value)));
        const width = Math.floor(available), total = mins.reduce((a, b) => a + b, 0);
        if (width <= total) return mins;
        const preferredTotal = prefs.reduce((a, b) => a + b, 0), headroom = preferredTotal - total, extra = width - total;
        const exact = headroom && extra <= headroom
            ? mins.map((value, i) => value + extra * (prefs[i] - value) / headroom)
            : prefs.map(value => value + (width - preferredTotal) * value / preferredTotal);
        const result = exact.map(Math.floor);
        const order = exact.map((value, i) => ({ i, fraction: value - result[i] }))
            .sort((a, b) => b.fraction - a.fraction || a.i - b.i);
        const remaining = width - result.reduce((a, b) => a + b, 0);
        for (let i = 0; i < remaining; i++) result[order[i].i]++;
        return result;
    }
    function measureSales(record) {
        const context = canvas?.getContext('2d');
        if (!context) return false;
        const { table, body, definition: def } = record;
        const styles = new Map(), probes = new Map(), requirements = [];
        const zone = record.measurementZone ||= root.document.createElement('div');
        zone.replaceChildren();
        zone.dataset.salesMeasurement = 'true';
        zone.setAttribute('aria-hidden', 'true');
        zone.inert = true;
        zone.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;white-space:nowrap;';
        const px = value => parseFloat(value) || 0;
        const styleOf = (element, column) => {
            const key = `${column}|${element.tagName}|${element.className}|${element.getAttribute('style') || ''}`;
            if (!styles.has(key)) styles.set(key, root.getComputedStyle(element));
            return styles.get(key);
        };
        const horizontal = style => px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth);
        const textWidth = (text, style) => {
            context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            if (style.textTransform === 'uppercase') text = text.toLocaleUpperCase('vi-VN');
            return context.measureText(text).width + px(style.letterSpacing) * text.length;
        };
        const probe = (element, column, arrow) => {
            const clone = element.cloneNode(true), style = styleOf(element, column);
            for (const node of [clone, ...clone.querySelectorAll('*')]) {
                for (const attr of [...node.attributes]) if (/^(?:on|data-)/i.test(attr.name) ||
                    ['id','name','for','form','autofocus','tabindex','href','src','srcset'].includes(attr.name.toLowerCase())) node.removeAttribute(attr.name);
                node.removeAttribute('hidden');
            }
            for (const name of ['font-family','font-size','font-weight','font-style','letter-spacing','line-height','text-transform',
                'display','gap','padding-left','padding-right','border-left-width','border-right-width','border-left-style','border-right-style','min-width']) {
                const value = style.getPropertyValue(name);
                if (value) clone.style.setProperty(name, value, 'important');
            }
            clone.style.setProperty('width', 'max-content', 'important');
            clone.style.setProperty('max-width', 'none', 'important');
            clone.style.setProperty('margin', '0', 'important');
            if (arrow) {
                const indicator = clone.querySelector('.sort-indicator');
                if (indicator) { indicator.textContent = arrow; indicator.style.setProperty('display', 'inline-block', 'important'); }
            }
            const key = clone.outerHTML;
            if (!probes.has(key)) {
                const holder = root.document.createElement('div');
                holder.style.cssText = 'width:max-content;';
                holder.appendChild(clone); zone.appendChild(holder);
                probes.set(key, { node: clone, width: 0 });
            }
            const entry = probes.get(key), margin = px(style.marginLeft) + px(style.marginRight);
            return () => entry.width + margin;
        };
        const inlineWidth = (element, column) => {
            const style = styleOf(element, column), children = [...element.childNodes];
            const parts = children.map((child, i) => {
                if (child.nodeType === 3) {
                    let text = child.textContent.replace(/\s+/g, ' ');
                    if (i === 0) text = text.trimStart();
                    if (i === children.length - 1) text = text.trimEnd();
                    const width = textWidth(text, style);
                    return () => width;
                }
                if (child.nodeType !== 1) return () => 0;
                if (child.tagName === 'BUTTON' || child.classList.contains('badge')) return probe(child, column);
                const inner = inlineWidth(child, column), childStyle = styleOf(child, column);
                const box = horizontal(childStyle) + px(childStyle.marginLeft) + px(childStyle.marginRight);
                return () => inner() + box;
            });
            return () => parts.reduce((sum, part) => sum + part(), 0);
        };
        const requireWidth = (column, cell, content) => {
            const padding = horizontal(styleOf(cell, column));
            requirements.push({ column, width: () => Math.ceil(content() + padding + 2) });
        };
        try {
            const headers = [...table.tHead.rows[0].cells];
            const minimum = Array(def.columns.length).fill(0); minimum[0] = 40;
            headers.forEach((cell, column) => {
                if (!column) return;
                const button = cell.querySelector('.sortable-header');
                if (button) {
                    const up = probe(button, column, '▲'), down = probe(button, column, '▼');
                    requireWidth(column, cell, () => Math.max(up(), down()));
                } else requireWidth(column, cell, inlineWidth(cell, column));
            });
            for (const row of body.querySelectorAll(def.row)) {
                if (row.cells.length !== def.columns.length) continue;
                [...row.cells].forEach((cell, column) => {
                    // Existing customer/staff ellipsis is deliberate; do not budget the entire name.
                    if (!column || [3,4].includes(column)) return;
                    requireWidth(column, cell, inlineWidth(cell, column));
                });
            }
            const detailNames = [];
            for (const row of body.querySelectorAll('.history-detail-row')) {
                requireWidth(5, row.cells[2], inlineWidth(row.cells[2], 5));
                requireWidth(6, row.cells[3], inlineWidth(row.cells[3], 6));
                const cell = row.cells[1], price = cell.querySelector('.history-line-price');
                if (price) {
                    const arrow = cell.querySelector('.history-line-content > span'), priceWidth = inlineWidth(price, 1);
                    const arrowWidth = arrow ? inlineWidth(arrow, 1) : () => 0;
                    const padding = horizontal(styleOf(cell, 1));
                    // Reserve the fixed price, branch marker, flex gaps and an ellipsis glyph.
                    const tail = padding + 8 + 12 + textWidth('…', styleOf(cell, 1));
                    detailNames.push(() => Math.ceil(priceWidth() + arrowWidth() + tail));
                }
            }
            if (probes.size) table.parentElement.appendChild(zone);
            for (const entry of probes.values()) {
                entry.width = entry.node.getBoundingClientRect().width;
                if (!Number.isFinite(entry.width) || entry.width <= 0) return false;
            }
            for (const requirement of requirements) minimum[requirement.column] = Math.max(minimum[requirement.column], requirement.width());
            for (const required of detailNames) minimum[1] += Math.max(0, required() - minimum[1] - minimum[2]);
            if (minimum.some(width => !Number.isFinite(width) || width <= 0)) return false;
            const preferred = [...def.widths];
            preferred[9] = root.document.body.getAttribute('data-ui-size') === 'large' ? 216 : 192;
            record.preferredWidths = preferred.map((width, i) => Math.max(width, minimum[i]));
            record.widths = minimum;
            record.size = root.document.body.getAttribute('data-ui-size');
            record.fullWidth = minimum.reduce((a, b) => a + b, 0);
            record.compactWidth = minimum.reduce((sum, width, i) => sum + (def.hide.includes(def.columns[i]) ? 0 : width), 0);
            return true;
        } finally { zone.remove(); zone.replaceChildren(); }
    }
    function measure(record) {
        const { table, body, definition: def } = record;
        const large = root.document.body.getAttribute('data-ui-size') === 'large';
        const widths = [...def.widths];
        widths[widths.length - 1] = def.kind === 'stock' ? (large ? 128 : 116) : (large ? 216 : 192);
        const context = canvas?.getContext('2d');
        if (context) for (let index = 0; index < def.columns.length; index++) {
            const column = def.columns[index];
            if (['product','select'].includes(column)) continue;
            const cells = [table.tHead.rows[0].cells[index], ...[...body.querySelectorAll(def.row)]
                .filter(row => row.cells.length === def.columns.length).map(row => row.cells[index])];
            for (const cell of cells) {
                const style = root.getComputedStyle(cell);
                const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
                let contentWidth;
                if (column === 'actions') {
                    const buttons = [...cell.querySelectorAll('button')];
                    contentWidth = buttons.reduce((sum, button) => sum + button.offsetWidth, 0) + Math.max(0, buttons.length - 1) * 6;
                    if (!buttons.length) contentWidth = 0;
                } else {
                    const label = cell.querySelector('button, .badge') || cell;
                    const textStyle = root.getComputedStyle(label);
                    context.font = `${textStyle.fontWeight} ${textStyle.fontSize} ${textStyle.fontFamily}`;
                    let text = label.textContent.replace(/\s+/g, ' ').trim();
                    if (textStyle.textTransform === 'uppercase') text = text.toLocaleUpperCase('vi-VN');
                    contentWidth = context.measureText(text).width + (parseFloat(textStyle.letterSpacing) || 0) * text.length;
                    if (label !== cell) contentWidth += parseFloat(textStyle.paddingLeft) + parseFloat(textStyle.paddingRight) + 8;
                    if (cell.tagName === 'TH' && label.tagName === 'BUTTON') contentWidth += 12;
                }
                widths[index] = Math.max(widths[index], Math.ceil(contentWidth + padding + 2));
            }
        }
        // Detail money/quantity can be wider than the main summary. Measure hidden
        // detail text without opening rows or modifying the expansion state.
        if (context) for (const row of body.querySelectorAll('.history-detail-row')) {
            const checks = def.kind === 'sales' ? [[row.cells[2], [5]], [row.cells[3], [6]]]
                : [[row.cells[2], [3,4]], [row.cells[3], [5]], [row.cells[4], [6]]];
            for (const [cell, indexes] of checks) {
                const style = root.getComputedStyle(cell);
                context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                const text = cell.textContent.replace(/\s+/g,' ').trim();
                const required = Math.ceil(context.measureText(text).width + (parseFloat(style.letterSpacing) || 0) * text.length + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2);
                for (const index of indexes) widths[index] = Math.max(widths[index], required);
            }
        }
        record.widths = widths;
        record.size = root.document.body.getAttribute('data-ui-size');
        record.fullWidth = widths.reduce((sum, width) => sum + width, 0);
        record.compactWidth = widths.reduce((sum, width, i) => sum + (def.hide.includes(def.columns[i]) ? 0 : width), 0);
        [...table.tHead.rows[0].cells].forEach((cell, i) => { cell.style.width = `${widths[i]}px`; });
    }
    function decorate(record) {
        const { table, body, definition: def } = record;
        table.dataset.responsiveHistory = def.kind;
        const assign = cells => [...cells].forEach((cell, i) => {
            cell.dataset.column = def.columns[i];
            if (def.hide.includes(def.columns[i])) cell.dataset.responsiveOptional = 'true';
        });
        assign(table.tHead.rows[0].cells);
        for (const row of body.querySelectorAll(def.row)) if (row.cells.length === def.columns.length) assign(row.cells);
        for (const cell of body.querySelectorAll('.stock-history-product')) cell.title = cell.textContent;
    }
    function spans(record, compact) {
        const { body, definition: def } = record;
        for (const row of body.querySelectorAll('.history-detail-row')) {
            const cells = row.cells;
            if (def.kind === 'sales') {
                cells[1].colSpan = compact ? 2 : 4;
                cells[5].hidden = compact;
            } else if (def.kind === 'returns') {
                cells[3].colSpan = compact ? 1 : 2;
                cells[5].colSpan = compact ? 1 : 2;
            }
        }
        for (const row of body.rows) if (row.cells.length === 1) row.cells[0].colSpan = def.columns.length - (compact ? def.hide.length : 0);
    }
    function apply(record, forceMeasure = false, observedWidth) {
        const rawWidth = observedWidth ?? record.wrapper.clientWidth;
        const width = record.definition.kind === 'sales' ? Math.floor(rawWidth - (record.wrapperPadding || 0)) : rawWidth;
        if (!rawWidth || width <= 0) return;
        const remeasure = forceMeasure || !record.widths || record.size !== root.document.body.getAttribute('data-ui-size');
        if (remeasure) {
            record.salesSizing = false;
            if (record.definition.kind === 'sales') {
                try { record.salesSizing = measureSales(record); }
                catch (_) { /* Measurement failure uses the unchanged legacy budget. */ }
            }
            if (!record.salesSizing) measure(record);
        }
        const threshold = record.fullWidth + 8;
        const compact = record.table.classList.contains('is-compact') ? width < threshold + 16 : width < threshold;
        // Unchanged resize frames need no cell writes. Newly rendered rows still
        // receive spans through refresh(forceMeasure), even in the same mode.
        if (remeasure || record.compact !== compact) {
            record.table.classList.toggle('is-compact', compact);
            record.table.style.minWidth = `${compact ? record.compactWidth : record.fullWidth}px`;
            record.table.dataset.fullWidth = record.fullWidth;
            record.table.dataset.compactWidth = record.compactWidth;
            spans(record, compact);
            record.compact = compact;
        }
        if (record.salesSizing) {
            const indexes = record.definition.columns.map((column, i) => i).filter(i => !compact || !record.definition.hide.includes(record.definition.columns[i]));
            const allocated = allocateWidths(indexes.map(i => record.widths[i]), indexes.map(i => record.preferredWidths[i]), width);
            if (allocated) indexes.forEach((index, i) => {
                const cell = record.table.tHead.rows[0].cells[index], value = `${allocated[i]}px`;
                if (cell.style.width !== value) cell.style.width = value;
            });
        }
    }
    function schedule(record) {
        if (record.frame) return;
        record.frame = root.requestAnimationFrame(() => { record.frame = 0; const width = record.observedWidth; record.observedWidth = undefined; apply(record, false, width); });
    }
    function refresh(bodyId) {
        const body = root.document?.getElementById(bodyId);
        if (!body) return;
        let record = records.get(bodyId);
        if (!record) {
            const table = body.closest('table'), wrapper = table?.closest('.table-wrap');
            if (!wrapper) return;
            record = { body, table, wrapper, definition: definitions[bodyId], frame: 0 };
            records.set(bodyId, record);
            if (root.ResizeObserver) {
                record.observer = new root.ResizeObserver(entries => {
                    // ponytail: ResizeObserver already supplies layout width; reading
                    // clientWidth again in RAF forces an unnecessary second layout.
                    const entry = entries.find(item => item.target === wrapper);
                    if (entry) record.observedWidth = Math.round(entry.contentRect.width + (record.wrapperPadding || 0));
                    schedule(record);
                });
                record.observer.observe(wrapper);
            }
        }
        const wrapperStyle = root.getComputedStyle(record.wrapper);
        record.wrapperPadding = (parseFloat(wrapperStyle.paddingLeft) || 0) + (parseFloat(wrapperStyle.paddingRight) || 0);
        decorate(record);
        apply(record, true);
    }
    function init() {
        if (initialized) return;
        initialized = true;
        Object.keys(definitions).forEach(refresh);
        root.document.fonts?.ready.then(() => Object.keys(definitions).forEach(refresh));
        new root.MutationObserver(() => { for (const record of records.values()) schedule(record); })
            .observe(root.document.body, { attributes: true, attributeFilter: ['data-ui-size'] });
    }
    const api = { definitions, refresh, init, stats: () => [...records.values()].map(record => ({ body: record.body.id, full: record.fullWidth, compact: record.compactWidth, observers: record.observer ? 1 : 0 })) };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else { root.NTKIOTResponsiveTables = api; root.document.addEventListener('DOMContentLoaded', init); }
})(globalThis);
