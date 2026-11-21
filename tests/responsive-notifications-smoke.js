const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

if (!process.argv.includes('--electron-child')) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ntkiot-ui-smoke-'));
    for (const folder of ['userData','sessionData','logs','downloads','crashDumps']) fs.mkdirSync(path.join(sandbox, folder));
    const item = { id: 'SKU-UI', name: 'Sản phẩm tên rất dài để kiểm tra một dòng — '.repeat(6), code: 'UI-001', price: 100000, cost: 60000, stock: 100, cat: 'UI', unit: 'SP' };
    const date = new Date().toISOString();
    const fixture = {
        products: [item], categories: ['UI'],
        users: [{ id: 'UI-ADMIN', user: 'ui', pass: 'fixture', name: 'UI admin', code: 'NV001', role: 'admin' },
            { id: 'UI-MANAGER', user: 'manager', pass: 'fixture', name: 'UI manager', code: 'NV002', role: 'manager' },
            { id: 'UI-STAFF', user: 'staff', pass: 'fixture', name: 'UI staff', code: 'NV003', role: 'staff' }],
        custs: [{ id: 1, name: 'Khách lẻ', points: 0, debt: 0, totalBuy: 0 }], suppliers: [], purchaseOrders: [], activityLog: [],
        drafts: { invoices: [], purchaseOrders: [], products: [] },
        invoices: Array.from({length:60}, (_, i) => ({ id: `INV-UI-${i}`, date, saleType:i%3?'retail':'wholesale', cust: 'Khách hàng dài '.repeat(6), custId: 1, staff: 'Nhân viên UI', method: 'CASH', total: 50047497000, discount: 999999999,
            items: [{ ...item, qty: 25, price: 2001899880, lineTotal: 50047497000 }] })),
        returns: Array.from({length:60}, (_, i) => ({ id: `RET-UI-${i}`, invoiceId: `INV-UI-${i}`, date, cust: 'Khách hàng UI', staff: 'Nhân viên UI', difference: 50047497000,
            returnItems: [{ ...item, qty: 9999.999, price: 50047497000 }], exchangeItems: [{ ...item, qty: 9999.999, price: 50047497000 }] })),
        stockHistory: Array.from({length:60}, (_, i) => ({ id: `STOCK-UI-${i}`, date, type: ['in','out','adjust'][i % 3], productId: item.id, productName: item.name,
            qty: 9999.999, price: 50047497000, total: 50047497000, note: 'Ghi chú dài '.repeat(6), user: 'UI admin' })),
        settings: { autoBackup: false, autoPrint: false, sound: false, disableLogin: false, pointsEnabled: false, theme: 'light', uiSize: 'medium' }
    };
    fs.writeFileSync(path.join(sandbox, 'userData', 'data.json'), JSON.stringify(fixture));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [__filename, '--electron-child', sandbox, ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit', timeout: 60000, killSignal:'SIGKILL' });
    console.log('Isolated UI directory:', sandbox);
    if (result.error) console.error(result.error.message);
    process.exitCode = result.status === 0 ? 0 : 1;
} else {
    const { app, BrowserWindow, screen } = require('electron');
    const scale = process.argv.find(arg=>arg.startsWith('--scale='))?.split('=')[1];
    if (scale) assert.ok(['1','1.25','1.5','2'].includes(scale));
    const sandbox = fs.realpathSync(process.argv[process.argv.indexOf('--electron-child') + 1]);
    assert.ok(sandbox.startsWith(fs.realpathSync(os.tmpdir()) + path.sep) && path.basename(sandbox).startsWith('ntkiot-ui-smoke-'));
    for (const key of ['userData','sessionData','downloads','crashDumps']) {
        const target = fs.realpathSync(path.join(sandbox, key));
        assert.ok(target.startsWith(sandbox + path.sep)); app.setPath(key, target); assert.equal(app.getPath(key), target);
    }
    app.setAppLogsPath(path.join(sandbox,'logs')); assert.equal(app.getPath('logs'), path.join(sandbox,'logs'));
    app.setAppPath(root); require(path.join(root, 'main.js'));
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    app.whenReady().then(async () => {
        try {
            const win = BrowserWindow.getAllWindows()[0];
            assert.ok(win);
            win.webContents.on('will-navigate',(event,url)=>console.log('UI navigation',JSON.stringify({url:url||event.url,prevented:event.defaultPrevented})));
            win.webContents.on('did-finish-load',()=>console.log('UI document loaded'));
            if(scale)win.webContents.debugger.attach('1.3');
            const emulateDPR=async()=>{
                if(!scale)return;
                const [width,height]=win.getContentSize();
                await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:Number(scale),mobile:false});
            };
            win.webContents.print = (_opts, callback) => callback?.(false, 'PRINT_BLOCKED_BY_TEST');
            win.webContents.getPrintersAsync = async () => [];
            win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
            win.webContents.session.on('will-download', (_event, item) => item.setSavePath(path.join(sandbox,'downloads',path.basename(item.getFilename()))));
            const errors = [];
            win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
            for (let i=0; i<250; i++) {
                if (!win.webContents.isLoading() && await win.webContents.executeJavaScript("typeof dataLoadStatus !== 'undefined' && dataLoadStatus === 'primary'")) break;
                await wait(20);
            }
            await win.webContents.executeJavaScript("document.fonts.ready.then(async()=>{window.confirm=()=>true;$('log-u').value='ui';$('log-p').value='fixture';await login();})");
            await emulateDPR();
            if(scale)assert.equal(await win.webContents.executeJavaScript('devicePixelRatio'),Number(scale),'effective simulated DPR');
            await wait(150);
            const before = await win.webContents.executeJavaScript('JSON.stringify(db)');
            const nativeResize = async width => { win.setContentSize(width,900); await emulateDPR(); await wait(50); };
            await win.webContents.executeJavaScript("router('history');renderHistoryTab('sales');document.querySelector('aside').classList.remove('collapsed');");
            await wait(450);
            await nativeResize(2400);
            await win.webContents.executeJavaScript(`window.readRowState = ${readRowState.toString()}; undefined;`);
            const stateBefore = await win.webContents.executeJavaScript(`(${prepareRowState.toString()})()`);
            for (const width of [1800,1440,2400]) {
                await nativeResize(width);
                const stateAfter = await win.webContents.executeJavaScript(`(${readRowState.toString()})()`);
                assert.deepEqual(stateAfter,stateBefore,'resize preserves selections/details/sort/filter/limit');
            }
            const dimensions = await win.webContents.executeJavaScript("(()=>{const t=$('hist-body').closest('table'),w=t.closest('.table-wrap');return{full:Number(t.dataset.fullWidth),outer:innerWidth-w.clientWidth};})()");
            await nativeResize(dimensions.full+dimensions.outer+7);
            assert.equal(await win.webContents.executeJavaScript("$('hist-body').closest('table').classList.contains('is-compact')"),true,'compact at full budget + 7');
            await nativeResize(dimensions.full+dimensions.outer+23);
            assert.equal(await win.webContents.executeJavaScript("$('hist-body').closest('table').classList.contains('is-compact')"),true,'hysteresis preserves compact');
            await nativeResize(dimensions.full+dimensions.outer+24);
            assert.equal(await win.webContents.executeJavaScript("$('hist-body').closest('table').classList.contains('is-compact')"),false,'full at budget + 24');
            const results = [];
            const targets = ['hist-body','returns-body','mgmt-stock-history-body','inv-stock-history-body'];
            for (const theme of ['light','dark']) for (const size of ['small','medium','large']) for (const collapsed of [false,true]) {
                await win.webContents.executeJavaScript(`applyTheme('${theme}',false);applyUISize('${size}',false);document.querySelector('aside').classList.toggle('collapsed',${collapsed});`);
                await wait(350);
                for (const width of (process.argv.includes('--calibrate') ? [2400,1800,1440,1360,1280,1200] : [2400,1800,1440])) {
                    win.setContentSize(width, 900); await emulateDPR(); await wait(25);
                    for (const bodyId of targets) {
                        const result = await win.webContents.executeJavaScript(`(${inspectTable.toString()})('${bodyId}')`);
                        results.push({theme,size,collapsed,width,...result});
                    }
                }
            }
            const specialRows = await win.webContents.executeJavaScript(`(${specialTableChecks.toString()})()`);
            const focusedUI = await win.webContents.executeJavaScript(`(${inspectNotificationLayout.toString()})()`);
            assert.equal(await win.webContents.executeJavaScript('JSON.stringify(db)'), before, 'UI changes do not mutate database');
            const minimumRequired = Math.ceil(Math.max(...results.map(r => r.compactWidth + r.outerPadding)));
            assert.equal(win.getMinimumSize()[0],1440,'calibrated native minimum width');
            const overflow = results.filter(r => r.overflow > 1 || r.clipped.length || r.overlaps.length);
            const report = { minimumRequired, frame: win.getSize()[0] - win.getContentSize()[0], display: screen.getDisplayMatching(win.getBounds()).workAreaSize,
                scale:scale||'native', effectiveDevicePixelRatio:await win.webContents.executeJavaScript('devicePixelRatio'), zoom:win.webContents.getZoomFactor(), combinations: results.length, specialRows, focusedUI, overflow, results };
            fs.writeFileSync(path.join(sandbox,'layout.json'), JSON.stringify(report,null,2));
            console.log(JSON.stringify({minimumRequired,combinations:results.length,scale:report.scale,frame:report.frame,display:report.display,overflow:overflow.slice(0,12)},null,2));
            if (!process.argv.includes('--calibrate')) assert.equal(overflow.length,0,'supported table geometry');
            if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
            const sidebar = [];
            for (const width of [1024,993,992,768]) {
                await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:Number(scale)||1,mobile:false});
                await win.webContents.executeJavaScript("document.querySelector('aside').classList.remove('collapsed');"); await wait(350);
                const state = await win.webContents.executeJavaScript("(()=>{const aside=document.querySelector('aside');return{width:aside.getBoundingClientRect().width,icons:[...document.querySelectorAll('nav button .nav-icon')].map(el=>({display:getComputedStyle(el).display,width:el.getBoundingClientRect().width,text:el.textContent})),labels:[...document.querySelectorAll('nav button .nav-text')].map(el=>getComputedStyle(el).display)};})()");
                assert.ok(state.icons.length>=7 && state.icons.every(icon=>icon.display!=='none'&&icon.width>0&&icon.text.trim()),'sidebar icons never disappear');
                if(width<=992){assert.equal(state.width,70);assert.ok(state.labels.every(display=>display==='none'));}
                await win.webContents.executeJavaScript("document.querySelector('aside').classList.add('collapsed');"); await wait(350);
                assert.equal(await win.webContents.executeJavaScript("document.querySelector('aside').getBoundingClientRect().width"),60);
                sidebar.push({viewport:width,...state});
            }
            fs.writeFileSync(path.join(sandbox,'sidebar.json'),JSON.stringify(sidebar,null,2));
            await win.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');
            if (!scale) win.webContents.debugger.detach();
            win.setContentSize(1440,800);
            await emulateDPR();
            await win.webContents.executeJavaScript("document.querySelector('aside').classList.remove('collapsed');router('history');renderHistoryTab('sales');toggleHistRow($('hist-body').querySelector('.hist-row'));");
            await wait(450);
            fs.writeFileSync(path.join(sandbox,'sales-compact.png'), (await win.webContents.capturePage()).toPNG());
            await win.webContents.executeJavaScript("router('history');renderHistoryTab('returns');");
            await wait(450);
            fs.writeFileSync(path.join(sandbox,'history.png'), (await win.webContents.capturePage()).toPNG());
            const notifications = await win.webContents.executeJavaScript(`(${notificationChecks.toString()})()`);
            if(!win.webContents.debugger.isAttached())win.webContents.debugger.attach('1.3');
            try {
                await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
                await win.webContents.executeJavaScript("NTKIOTNotifications.commit();toast('Reduced-motion test','warning',false,'pos.ban-am-kho-ton');");
                assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('.notification-region .toast')).animationName"),'none');
                await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{media:'print',features:[]});
                assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('.notification-region')].every(region=>getComputedStyle(region).display==='none')"),true);
                await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{media:'',features:[]});
            } finally {if(!scale)win.webContents.debugger.detach();}
            await win.webContents.executeJavaScript("router('pos');addCart('SKU-UI');processGlobalBarcode('UNKNOWN-SCREENSHOT');");await wait(450);
            fs.writeFileSync(path.join(sandbox,'pos-warning.png'),(await win.webContents.capturePage()).toPNG());
            await win.webContents.executeJavaScript("router('settings');searchSettings('thong bao');");await wait(450);
            fs.writeFileSync(path.join(sandbox,'notification-settings.png'),(await win.webContents.capturePage()).toPNG());
            await win.webContents.executeJavaScript("clearSettingsSearch();");
            const rename = fs.promises.rename;
            let failed = false;
            fs.promises.rename = async (from,to) => {
                if (!failed && to === path.join(sandbox,'userData','data.json')) { failed=true; throw Object.assign(new Error('UI_SAVE_FAILED'),{code:'ENOSPC'}); }
                return rename.call(fs.promises,from,to);
            };
            let rollback;
            try {
                rollback = await win.webContents.executeJavaScript("(async()=>{const old=JSON.stringify(db.settings);router('settings');$('set-notifications-enabled').checked=false;$('set-notifications-enabled').dispatchEvent(new Event('change',{bubbles:true}));const result=await saveSets();return{result,unchanged:JSON.stringify(db.settings)===old,enabled:NTKIOTNotifications.preferences().enabled,dirty:settingsDirty,owner:activeDataMutation===null};})()");
            } finally { fs.promises.rename = rename; }
            assert.ok(failed); assert.deepEqual(rollback,{result:false,unchanged:true,enabled:true,dirty:true,owner:true});
            const saved = await win.webContents.executeJavaScript("(async()=>{const result=await saveSets();return{result,enabled:NTKIOTNotifications.preferences().enabled,dirty:settingsDirty};})()");
            assert.deepEqual(saved,{result:true,enabled:false,dirty:false});
            const disk=JSON.parse(fs.readFileSync(path.join(sandbox,'userData','data.json'),'utf8'));
            assert.equal(disk.settings.notificationPreferences.enabled,false);
            const safeGuard = await win.webContents.executeJavaScript("(async()=>{router('pos');cart=[];const old=JSON.stringify(db);const result=await directCheckout();return{result,unchanged:JSON.stringify(db)===old,notices:document.querySelectorAll('.notification-region .toast').length};})()");
            assert.equal(safeGuard.unchanged,true); assert.equal(safeGuard.notices,0);
            const reloaded = new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
            win.webContents.reload(); await reloaded; await wait(150);
            assert.equal(await win.webContents.executeJavaScript('NTKIOTNotifications.preferences().enabled'),false,'reload retains settings');
            await win.webContents.executeJavaScript("(async()=>{window.confirm=()=>true;$('log-u').value='ui';$('log-p').value='fixture';await login();router('settings');})()");
            const navigation=await win.webContents.executeJavaScript(`(async()=>{
                const previous=JSON.stringify(db.settings);
                $('set-notifications-enabled').checked=true;$('set-notifications-enabled').dispatchEvent(new Event('change',{bubbles:true}));router('pos');
                const blocked=$('settings-view').classList.contains('active')&&$('settings-unsaved-modal').classList.contains('active');
                cancelSettingsNavigation();router('pos');discardSettingsAndNavigate();
                const discarded=JSON.stringify(db.settings)===previous&&!NTKIOTNotifications.preferences().enabled;
                router('settings');const input=document.querySelector('[data-notification-event="pos.da-quet"]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));router('pos');
                await saveSettingsAndNavigate();
                const saved=$('pos-view').classList.contains('active')&&!settingsDirty&&!NTKIOTNotifications.preferences().enabled;
                router('settings');return{blocked,discarded,saved};
            })()`);
            assert.deepEqual(navigation,{blocked:true,discarded:true,saved:true},'notification preferences follow Save & leave and discard');
            assert.equal(await win.webContents.executeJavaScript("performBackup({force:true,reason:'notification-fixture-test'})"),true,'real backup succeeds in temporary storage');
            const backupDir=fs.realpathSync(path.join(sandbox,'userData','backups'));
            assert.ok(backupDir.startsWith(sandbox+path.sep));
            const backupNames=fs.readdirSync(backupDir).filter(name=>/^backup_.*\.json$/.test(name));
            assert.ok(backupNames.length);
            const backupPreferences=JSON.parse(fs.readFileSync(path.join(backupDir,backupNames[0]),'utf8')).settings.notificationPreferences;
            assert.deepEqual(backupPreferences,await win.webContents.executeJavaScript('NTKIOTNotifications.preferences()'),'backup retains notification preferences');
            const restoreFixture = JSON.parse(fs.readFileSync(path.join(sandbox,'userData','data.json'),'utf8'));
            restoreFixture.settings.notificationPreferences={version:1,enabled:true,disabledEventIds:['pos.da-quet']};
            const restorePath=path.join(sandbox,'ui-notifications-backup.json');
            fs.writeFileSync(restorePath,JSON.stringify(restoreFixture));
            const nativePicker=require('electron').dialog.showOpenDialog;
            require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[restorePath]});
            // Login's existing delayed activity-log save must settle before a
            // preview bound to the canonical revision is prepared.
            await wait(700);
            const prepared = await win.webContents.executeJavaScript(`(async()=>{
                await prepareRestoreData();
                return{ready:!!restoreCandidate,enabled:NTKIOTNotifications.preferences().enabled};
            })()`);
            console.log('UI restore prepared',JSON.stringify(prepared));
            require('electron').dialog.showOpenDialog=nativePicker;
            assert.deepEqual(prepared,{ready:true,enabled:false},'backup preview does not apply settings');
            failed=false;
            fs.promises.rename=async(from,to)=>{if(!failed&&to===path.join(sandbox,'userData','data.json')){failed=true;throw Object.assign(new Error('RESTORE_TEST_FAILURE'),{code:'ENOSPC'});}return rename.call(fs.promises,from,to);};
            let restoreFailure;
            try { restoreFailure=await win.webContents.executeJavaScript("(async()=>{const before=JSON.stringify(db);const result=await confirmRestoreData();return{result,unchanged:JSON.stringify(db)===before,enabled:NTKIOTNotifications.preferences().enabled};})()"); }
            finally {fs.promises.rename=rename;}
            assert.ok(failed);assert.deepEqual(restoreFailure,{result:false,unchanged:true,enabled:false});
            console.log('UI restore write failure verified');
            const restoredReload = new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
            const restoreSuccess=await win.webContents.executeJavaScript("confirmRestoreData().then(result=>({result,enabled:NTKIOTNotifications.preferences().enabled,disabled:NTKIOTNotifications.preferences().disabledEventIds}))");
            assert.deepEqual(restoreSuccess,{result:true,enabled:true,disabled:['pos.da-quet']});
            console.log('UI restore committed; waiting for production reload');
            await restoredReload; await wait(150);
            assert.equal(await win.webContents.executeJavaScript('NTKIOTNotifications.preferences().enabled'),true,'restore reload applies durable settings');
            assert.deepEqual(errors.filter(message=>!message.startsWith('Save error: Error: IO_FAILED')),[],'unexpected renderer errors');
            fs.writeFileSync(path.join(sandbox,'notifications.json'),JSON.stringify({notifications,reducedMotion:true,printMediaHidden:true,rollback,saved,safeGuard,navigation,backupPreferences,restoreFailure,restoreSuccess},null,2));
            console.log('UI notification policy, save rollback, durable settings and reload passed');
            app.exit(0);
        } catch (error) { console.error(error.stack); app.exit(1); }
    });
}

function prepareRowState() {
    const row=$('hist-body').querySelector('.hist-row'),checkbox=row.querySelector('input');
    checkbox.checked=true;checkbox.dispatchEvent(new Event('change',{bubbles:true}));
    toggleHistRow(row);
    return readRowState();
}

function readRowState() {
    return { selection:[...selectedInvoices], checked:$('hist-body').querySelector('input').checked,
        expanded:$('hist-body').querySelector('.hist-row').classList.contains('is-expanded'),
        details:[...$('hist-body').querySelectorAll('.hist-detail-row')].map(row=>row.style.display),
        sort:JSON.stringify(historySortStates), search:$('hist-staff-search').value, limit:historyDisplayLimits.sales };
}

function inspectNotificationLayout() {
    router('settings');searchSettings('thong bao');
    const options=[...document.querySelectorAll('.notification-option')];
    if(getComputedStyle(document.querySelector('#notification-section .settings-toggle')).backgroundColor!=='rgba(0, 0, 0, 0)')throw Error('Notification heading must use theme background');
    const measured=options.map(label=>{
        const input=label.querySelector('input'),text=label.querySelector('span');
        const box=input.getBoundingClientRect(),words=text.getBoundingClientRect(),parent=label.getBoundingClientRect();
        if(Math.abs(box.width-20)>0.5||Math.abs(box.height-20)>0.5||words.width<80||words.right>parent.right+1||label.scrollWidth>label.clientWidth+1)throw Error('Notification checkbox/label geometry');
        return{width:box.width,textWidth:words.width};
    });
    const events=document.querySelectorAll('[data-notification-event]').length;
    if(events!==NTKIOTNotificationEvents.length)throw Error('Notification registry layout coverage');
    clearSettingsSearch();
    return{options:measured.length,events,minimumTextWidth:Math.min(...measured.map(row=>row.textWidth))};
}

async function specialTableChecks() {
    const wait=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const counts=[];
    for(const view of ['sales','returns']) {
        router('history');renderHistoryTab(view);
        const body=$(view==='sales'?'hist-body':'returns-body');
        const previousLimit=historyDisplayLimits[view];
        historyDisplayLimits[view]=1;
        if(view==='sales')renderHist(true);else renderReturnsHistory(true);
        await wait();
        const table=body.closest('table'),headerCount=[...table.tHead.rows[0].cells].filter(cell=>getComputedStyle(cell).display!=='none').length;
        const more=body.querySelector('.history-more-row');
        if(!more||more.cells[0].colSpan!==headerCount||more.querySelector('br'))throw new Error('More-row layout '+view);
        more.querySelector('button').click();await wait();
        if(body.querySelector('.history-more-row'))throw new Error('More-row action '+view);
        historyDisplayLimits[view]=previousLimit;
        counts.push({view,more:headerCount});
    }
    for(const id of ['hist-body','returns-body','mgmt-stock-history-body','inv-stock-history-body']) {
        if(id==='hist-body'){router('history');renderHistoryTab('sales');}
        if(id==='returns-body'){router('history');renderHistoryTab('returns');}
        if(id==='mgmt-stock-history-body'){router('management');renderMgmtTab('inventory');}
        if(id==='inv-stock-history-body'){router('products');renderProductsTab('inventory');}
        await wait();
        const body=$(id),original=body.innerHTML;
        // A synthetic empty row tests presentation only: no business data is edited.
        body.innerHTML='<tr><td colspan="10">Không có dữ liệu</td></tr>';
        NTKIOTResponsiveTables.refresh(id);await wait();
        const table=body.closest('table'),count=[...table.tHead.rows[0].cells].filter(cell=>getComputedStyle(cell).display!=='none').length;
        if(body.rows[0].cells[0].colSpan!==count)throw new Error('Empty-row colspan '+id);
        body.innerHTML=original;NTKIOTResponsiveTables.refresh(id);
        counts.push({id,empty:count});
    }
    return counts;
}

async function inspectTable(bodyId) {
    const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
    if(bodyId==='hist-body') { router('history');renderHistoryTab('sales'); }
    if(bodyId==='returns-body') { router('history');renderHistoryTab('returns'); }
    if(bodyId==='mgmt-stock-history-body') { router('management');renderMgmtTab('inventory'); }
    if(bodyId==='inv-stock-history-body') { router('products');renderProductsTab('inventory'); }
    await wait(10);
    const body=$(bodyId),table=body.closest('table'),wrapper=table.closest('.table-wrap');
    const compact=table.classList.contains('is-compact');
    const first = body.querySelector('.hist-row,.returns-row') || body.rows[0];
    if(first?.classList.contains('hist-row'))toggleHistRow(first);
    if(first?.classList.contains('returns-row'))toggleReturnsRow(first);
    const expected=bodyId==='hist-body'?7:bodyId==='returns-body'?7:8;
    const headers=[...table.tHead.rows[0].cells].filter(c=>getComputedStyle(c).display!=='none');
    if(compact && headers.length!==expected)throw new Error('Incorrect columns '+bodyId);
    const clipped=[],overlaps=[];
    if(bodyId==='hist-body') {
        const head=table.tHead.rows[0],amount=head.querySelector('[data-column="total"]'),main=first.querySelector('[data-column="total"]'),detail=body.querySelector('.history-line-total');
        const edge=cell=>cell.getBoundingClientRect().right-parseFloat(getComputedStyle(cell).paddingRight);
        if([amount,main,detail].some(cell=>getComputedStyle(cell).textAlign!=='right')||Math.abs(edge(amount)-edge(main))>1||Math.abs(edge(main)-edge(detail))>1)throw Error('Sales money alignment '+JSON.stringify([amount,main,detail].map(cell=>({edge:edge(cell),align:getComputedStyle(cell).textAlign,padding:getComputedStyle(cell).paddingRight,span:cell.colSpan})))+' '+JSON.stringify({theme:document.body.dataset.theme,size:document.body.dataset.uiSize,compact}));
        const quantity=body.querySelector('.history-line-quantity'),items=head.querySelector('[data-column="items"]');
        const center=cell=>(cell.getBoundingClientRect().left+cell.getBoundingClientRect().right)/2;
        if(getComputedStyle(quantity).textAlign!=='center'||Math.abs(center(quantity)-center(items))>1)throw Error('Sales quantity alignment');
        // Cell alignment alone misses the space reserved by an empty sort icon.
        for(const key of ['items','total','discount']) {
            const cell=head.querySelector(`[data-column="${key}"]`),button=cell.querySelector('.sortable-header');
            const text=[...button.childNodes].find(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim());
            const range=document.createRange(),raw=text.textContent;
            range.setStart(text,raw.length-raw.trimStart().length);range.setEnd(text,raw.trimEnd().length);
            const rect=button.querySelector('.sort-indicator').textContent.trim()?button.getBoundingClientRect():range.getBoundingClientRect();
            const actual=key==='items'?(rect.left+rect.right)/2:rect.right,expected=key==='items'?center(cell):edge(cell);
            if(Math.abs(actual-expected)>1)throw Error('Sales visible header alignment '+JSON.stringify({key,actual,expected,theme:document.body.dataset.theme,size:document.body.dataset.uiSize}));
        }
        if(document.documentElement.getAttribute('data-theme')==='dark'||document.body.getAttribute('data-theme')==='dark') {
            const expanded=getComputedStyle(first).backgroundColor;
            if(expanded==='rgb(241, 245, 249)'||expanded==='rgb(255, 255, 255)')throw Error('Dark expanded row uses light background');
        }
    }
    for(const row of table.rows)if(getComputedStyle(row).display!=='none') {
        const cells=[...row.cells].filter(c=>getComputedStyle(c).display!=='none');
        const total=cells.reduce((sum,c)=>sum+c.colSpan,0);
        if(total!==headers.length)throw new Error(`colspan ${bodyId}: ${total}/${headers.length}`);
        for(const cell of cells) {
            if(getComputedStyle(cell).whiteSpace!=='nowrap')throw new Error('Wrapped cell '+bodyId);
            if(cell.querySelector('.history-line-name')) {
                const price=cell.querySelector('.history-line-price');
                if(price && price.getBoundingClientRect().right>cell.getBoundingClientRect().right+1)clipped.push({column:'detail-price',text:price.textContent});
                continue;
            }
            if(cell.classList.contains('stock-history-product'))continue;
            // Sales customer/staff names deliberately retain their existing ellipsis.
            // Headers, amounts, quantities and actions must still fit in full.
            const ellipsisName=bodyId==='hist-body'&&cell.tagName==='TD'&&['customer','staff'].includes(cell.dataset.column);
            if(ellipsisName&&(getComputedStyle(cell).textOverflow!=='ellipsis'||getComputedStyle(cell).overflowX!=='hidden'))throw Error('Sales name ellipsis policy');
            if(!ellipsisName&&cell.scrollWidth>cell.clientWidth+1)clipped.push({column:cell.dataset.column,text:cell.textContent.slice(0,100),scroll:cell.scrollWidth,width:cell.clientWidth});
            const buttons=[...cell.querySelectorAll('button')];
            if(buttons.some((b,i)=>i && b.getBoundingClientRect().left<buttons[i-1].getBoundingClientRect().right))overlaps.push(cell.dataset.column);
        }
    }
    return{bodyId,compact,compactWidth:Number(table.dataset.compactWidth),fullWidth:Number(table.dataset.fullWidth),outerPadding:innerWidth-wrapper.clientWidth,
        actualWidth:innerWidth,wrapper:wrapper.clientWidth,overflow:wrapper.scrollWidth-wrapper.clientWidth,clipped,overlaps};
}

async function notificationChecks() {
    const check=(condition,message)=>{if(!condition)throw new Error(message);};
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    router('pos');
    NTKIOTNotifications.commit({enabled:false,disabledEventIds:[]});
    toast('Suppressed warning','warning',false,'pos.da-dat-gioi-han-ton-kho');
    check(document.querySelectorAll('.notification-region .toast').length===0,'master off suppresses warnings');
    NTKIOTNotifications.commit();clearToastHistory();
    const before=cart.length;processGlobalBarcode('UI-001');
    check(cart.length===before+1,'scanner adds cart');
    check(!$('pos-scan-status'),'inline scan banner removed');
    check(document.querySelectorAll('.notification-region .toast').length===0,'scan success quiet by default');
    check(document.activeElement===$('pos-search')&&$('pos-search').selectionStart===0,'auto scanner focus retained');
    const flags={scannerAutoAdd:db.settings.scannerAutoAdd,scannerPopup:db.settings.scannerPopup};
    Object.assign(db.settings,{scannerAutoAdd:false,scannerPopup:true});
    processGlobalBarcode('UI-001');await wait(120);
    check($('scanned-product-modal').classList.contains('active')&&document.activeElement===$('scanned-product-qty'),'popup and quantity focus retained');
    check(document.querySelectorAll('.notification-region .toast').length===0,'popup success quiet');
    const popupQty=cart[0].qty;addScannedToCart();await wait(120);
    check(cart[0].qty===popupQty+1&&document.activeElement===$('pos-search'),'popup addition and refocus retained');
    Object.assign(db.settings,{scannerAutoAdd:false,scannerPopup:false});
    const findQty=cart[0].qty;processGlobalBarcode('UI-');
    check(cart[0].qty===findQty&&document.activeElement===$('pos-search'),'find and partial match do not add cart');
    Object.assign(db.settings,flags);
    processGlobalBarcode('UNKNOWN');
    check($('pos-notifications').innerText.includes('Không tìm thấy'),'warning docked above footer');
    const region=$('pos-notifications').getBoundingClientRect(),footer=document.querySelector('.cart-footer').getBoundingClientRect();
    check(region.bottom<=footer.top+1,'notification does not overlap payment');
    const node=$('pos-notifications').firstElementChild;
    openModal('scanned-product-modal');await wait(30);
    check(node.parentElement===$('toast-box'),'same warning above modal');
    closeModal('scanned-product-modal');await wait(30);
    check(node.parentElement===$('pos-notifications'),'same warning returns to POS');
    NTKIOTNotifications.commit({enabled:true,disabledEventIds:[]});clearToastHistory();
    processGlobalBarcode('UI-001');check($('pos-notifications').innerText.includes('Đã quét'),'scan can be reenabled');
    NTKIOTNotifications.commit({enabled:false,disabledEventIds:[]});
    check(document.querySelectorAll('.notification-region .toast').length===0,'commit clears existing notices');
    NTKIOTNotifications.commit();router('settings');
    NTKIOTNotifications.renderSettings({enabled:true,disabledEventIds:[]});
    for(const event of NTKIOTNotifications.events) {
        const input=document.querySelector(`[data-notification-event="${event.id}"]`);
        check(!!input,'checkbox for '+event.id);
        input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));
        check(NTKIOTNotifications.readSettings().disabledEventIds.includes(event.id),'individual setting '+event.id);
        NTKIOTNotifications.commit(NTKIOTNotifications.readSettings());
        toast('Test '+event.id,'error',false,event.id);
        check(document.querySelectorAll('.notification-region .toast').length===0,'individual filtering '+event.id);
        input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));
        NTKIOTNotifications.commit(NTKIOTNotifications.readSettings());
        toast('Test '+event.id,'info',false,event.id);
        check(document.querySelectorAll('.notification-region .toast').length===1,'individual reenabling '+event.id);
        input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));NTKIOTNotifications.commit(NTKIOTNotifications.readSettings());
        input.checked=true;
    }
    const group=document.querySelector('[data-notification-group="pos"]');
    group.checked=false;group.dispatchEvent(new Event('change',{bubbles:true}));
    check([...group.closest('fieldset').querySelectorAll('[data-notification-event]')].every(input=>!input.checked),'group deselect');
    const first=group.closest('fieldset').querySelector('[data-notification-event]');first.checked=true;first.dispatchEvent(new Event('change',{bubbles:true}));
    check(group.indeterminate,'partial group state');
    NTKIOTNotifications.commit();loadSets();
    const input=document.querySelector('[data-notification-event="pos.da-quet"]');
    input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));
    check(settingsDirty,'individual checkbox marks dirty');
    check(!NTKIOTNotifications.allowed('pos.da-quet'),'uncommitted form does not affect policy');
    loadSets();check(!settingsDirty,'discard reloads saved form');
    for(const user of ['staff','manager','ui']) {
        $('log-u').value=user;$('log-p').value='fixture';await login();router('settings');
        const control=$('set-notifications-enabled');check(control.disabled===(user==='staff'),'notification permission '+user);
        if(user==='staff') {
            const previous=JSON.stringify(db.settings);control.checked=false;
            check(await saveSets()===false&&JSON.stringify(db.settings)===previous,'staff cannot persist direct invocation');
        }
    }
    searchSettings('thong bao');
    check(!$('notification-section').classList.contains('settings-search-hidden'),'settings search includes notifications');
    searchSettings('bo qua');check(!$('notification-section').classList.contains('settings-search-hidden'),'settings search includes individual event labels');clearSettingsSearch();
    return{scanner:true,popup:true,find:true,focus:true,suppression:true,docking:true,dirty:true,roles:true,eventTypes:NTKIOTNotifications.events.length};
}
