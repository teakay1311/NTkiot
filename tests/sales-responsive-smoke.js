// Native geometry regression, using only generated data and isolated Electron paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const source = path.resolve(process.argv.find(arg => arg.startsWith('--source='))?.slice(9) || path.join(__dirname, '..'));
const legacy = process.argv.includes('--legacy');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
if (!process.argv.includes('--child')) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ntkiot-sales-ui-'));
    for (const key of ['userData','sessionData','logs','downloads','crashDumps']) fs.mkdirSync(path.join(sandbox,key));
    const item = {id:'P1',name:'Cà phê sữa',code:'CF1',price:25000,cost:7000,stock:80,cat:'Cà phê',unit:'Ly'};
    const date = new Date().toISOString();
    const fixture = {products:[item],categories:['Cà phê'],users:[{id:'U1',user:'fixture',pass:'fixture',name:'Admin',code:'NV0001',role:'admin'}],
        custs:[{id:1,name:'Khách lẻ',points:0,debt:0,totalBuy:0}],suppliers:[],purchaseOrders:[],activityLog:[],drafts:{invoices:[],purchaseOrders:[],products:[]},
        invoices:[{id:'350854',date,cust:'Khách lẻ',custId:1,staff:'NV0001_Admin',method:'CASH',total:45000,discount:0,items:[{...item,qty:1,lineTotal:25000},{...item,id:'P2',name:'Cà phê đen',price:20000,qty:1,lineTotal:20000}]}],
        returns:[{id:'R1',invoiceId:'350854',date,cust:'Khách lẻ',staff:'Admin',difference:25000,returnItems:[{...item,qty:1}],exchangeItems:[]}],
        stockHistory:[{id:'S1',date,type:'in',productId:'P1',productName:item.name,qty:5,price:7000,total:35000,note:'Nhập kho',user:'Admin'}],
        settings:{autoBackup:false,autoPrint:false,sound:false,disableLogin:false,theme:'light',uiSize:'medium'}};
    fs.writeFileSync(path.join(sandbox,'userData','data.json'),JSON.stringify(fixture));
    const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'),[__filename,'--child',sandbox,...process.argv.slice(2)],{env,cwd:source,stdio:'inherit',timeout:180000,killSignal:'SIGKILL'});
    console.log('Evidence:',sandbox);
    if(result.error) console.error(result.error.message);
    process.exitCode = result.status === 0 ? 0 : 1;
} else {
    const {app,BrowserWindow,screen,session} = require('electron');
    const sandbox = fs.realpathSync(process.argv[process.argv.indexOf('--child')+1]);
    assert.ok(sandbox.startsWith(fs.realpathSync(os.tmpdir())+path.sep)&&path.basename(sandbox).startsWith('ntkiot-sales-ui-'));
    for(const key of ['userData','sessionData','downloads','crashDumps']) {const folder=fs.realpathSync(path.join(sandbox,key));app.setPath(key,folder);assert.equal(app.getPath(key),folder);}
    app.setAppLogsPath(path.join(sandbox,'logs')); app.setAppPath(source);
    // Install external-effect guards before production main creates its window.
    app.whenReady().then(()=>{
        session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
        session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
        session.defaultSession.on('will-download',event=>event.preventDefault());
    });
    require(path.join(source,'main.js'));
    app.whenReady().then(async()=>{
        const report={source,legacy,storage:Object.fromEntries(['userData','sessionData','logs','downloads','crashDumps'].map(key=>[key,app.getPath(key)])),electron:process.versions.electron,results:[],controls:[],errors:[]};
        const evaluate=code=>win.webContents.executeJavaScript(code);
        const win=BrowserWindow.getAllWindows()[0];
        try {
            win.webContents.setBackgroundThrottling(false);
            win.webContents.print=(_options,callback)=>callback?.(false,'PRINT_BLOCKED');
            win.webContents.getPrintersAsync=async()=>[];
            win.webContents.on('console-message',event=>{if(event.level==='error')report.errors.push(event.message);});
            let ready=false;
            for(let i=0;i<250;i++){if(!win.webContents.isLoading()&&await evaluate("typeof dataLoadStatus!=='undefined'&&dataLoadStatus==='primary'")){ready=true;break;}await wait(20);}
            assert.ok(ready,'fixture loaded from isolated primary'); console.log('Fixture ready');
            // executeJavaScript must not return the actor object from login.
            await evaluate("document.fonts.ready.then(async()=>{$('log-u').value='fixture';$('log-p').value='fixture';await login();return true;})");
            await wait(400); console.log('Fixture authenticated');
            if(!legacy)await evaluate(`window.__measureAudit={zones:0,unsafe:0};window.__measureObserver=new MutationObserver(records=>{
                for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&node.matches('[data-sales-measurement]')){
                    __measureAudit.zones++;if(!node.inert||node.getAttribute('aria-hidden')!=='true')__measureAudit.unsafe++;
                    for(const child of node.querySelectorAll('*'))if([...child.attributes].some(attr=>/^on/i.test(attr.name)||['id','src','srcset','href','autofocus','tabindex'].includes(attr.name)))__measureAudit.unsafe++;
                }
                for(const record of records)if(record.target.nodeType===1&&record.target.matches('[data-sales-measurement]'))for(const node of record.removedNodes)if(node.nodeType===1){
                    for(const child of [node,...node.querySelectorAll('*')])if([...child.attributes].some(attr=>/^on/i.test(attr.name)||['id','src','srcset','href','autofocus','tabindex'].includes(attr.name)))__measureAudit.unsafe++;
                }
            });__measureObserver.observe(document.body,{childList:true,subtree:true});undefined;`);
            const before=await evaluate('JSON.stringify(db)'),primary=fs.readFileSync(path.join(sandbox,'userData','data.json'),'utf8');
            const resize=async width=>{win.setContentSize(width,850);await wait(90);};
            const inspect=async id=>evaluate(`(${geometry.toString()})('${id}')`);
            await evaluate("router('history');renderHistoryTab('sales');undefined;");console.log('History ready');
            for(const theme of ['light','dark'])for(const size of ['small','medium','large'])for(const collapsed of [false,true]){
                await evaluate(`applyTheme('${theme}',false);applyUISize('${size}',false);document.querySelector('aside').classList.toggle('collapsed',${collapsed});`);
                await wait(360);
                console.log('Geometry',theme,size,collapsed);
                for(const width of [1440,1512,1800,2400]){
                    await resize(width);
                    const result=await inspect('hist-body');report.results.push({theme,size,collapsed,width,...result});
                    if(!legacy){assert.equal(result.overflow,0);assert.deepEqual(result.clipped,[]);assert.equal(result.columns,10,'short fixture full at supported widths');assert.equal(result.allocated,result.available);}
                }
            }
            console.log('48 short-fixture geometry cases measured');
            await evaluate("applyTheme('light',false);applyUISize('medium',false);document.querySelector('aside').classList.remove('collapsed');");await wait(360);
            for(const id of ['returns-body','mgmt-stock-history-body','inv-stock-history-body'])for(const width of [1440,1512,1800,2400]){await resize(width);report.controls.push({width,...await inspect(id)});}
            await evaluate("router('history');renderHistoryTab('sales');$('hist-staff-search').value='Admin';toggleHistorySort('sales','total');historyDisplayLimits.sales=1;renderHist(true);const row=$('hist-body').querySelector('.hist-row');row.querySelector('input').checked=true;selectedInvoices.add(db.invoices[0].id);toggleHistRow(row);$('hist-staff-search').focus();");await wait(90);
            const state=()=>evaluate("JSON.stringify({db,selected:[...selectedInvoices],sort:historySortStates,limit:historyDisplayLimits,expanded:$('hist-body').querySelector('.hist-row').className,focus:document.activeElement.id,search:$('hist-staff-search').value})");
            const stateBefore=await state();
            report.boundaries=[];
            for(const offset of [8,7,23,24]){
                await evaluate(`(()=>{const t=$('hist-body').closest('table'),w=t.closest('.table-wrap');w.style.width=(Number(t.dataset.fullWidth)+${offset}+w.offsetWidth-w.clientWidth)+'px';})()`);await wait(90);
                const result=await evaluate("(()=>{const t=$('hist-body').closest('table');return {compact:t.classList.contains('is-compact'),width:t.closest('.table-wrap').clientWidth,full:+t.dataset.fullWidth};})()");
                report.boundaries.push({offset,...result});assert.equal(result.compact,[7,23].includes(offset));assert.equal(await state(),stateBefore);
            }
            await evaluate("$('hist-body').closest('.table-wrap').style.width='';");await resize(1512);
            report.special=await evaluate(`(${special.toString()})()`);
            if(!legacy)report.fallback=await evaluate(`(${fallback.toString()})()`);
            await evaluate("$('hist-staff-search').value='';renderHist();");
            report.variants=[];
            for(const theme of ['light','dark'])for(const large of [false,true])for(const size of ['small','medium','large']){
                await evaluate(`(()=>{window.__salesFixture??=JSON.stringify(db.invoices);const invoice=db.invoices[0];
                    invoice.cust='Khách hàng dài '.repeat(20);invoice.staff='Nhân viên dài '.repeat(20);invoice.saleType='wholesale';invoice.method='CK';
                    invoice.total=${large?50047497000:45000};invoice.discount=${large?999999999:5000};
                    for(const item of invoice.items){item.name='Tên sản phẩm dài '.repeat(30);item.qty=${large?9999.999:1};item.price=${large?2001899880:20000};item.lineTotal=${large?50047497000:20000};}
                    applyTheme('${theme}',false);applyUISize('${size}',false);renderHist();})()`);await wait(100);
                for(const width of [1440,1512,2400]){await resize(width);const result=await inspect('hist-body');report.variants.push({theme,large,size,width,...result});if(!legacy){assert.equal(result.overflow,0);assert.deepEqual(result.clipped,[]);assert.equal(result.allocated,result.available);}}
                await evaluate("db.invoices=JSON.parse(window.__salesFixture);renderHist();");
            }
            await evaluate("delete window.__salesFixture;applyTheme('light',false);applyUISize('medium',false);renderHist();");await wait(150);
            assert.equal(await evaluate('JSON.stringify(db)'),before,'presentation cannot mutate database');
            assert.equal(fs.readFileSync(path.join(sandbox,'userData','data.json'),'utf8'),primary,'presentation cannot write primary');
            await evaluate("router('history');renderHistoryTab('sales');toggleHistRow($('hist-body').querySelector('.hist-row'));");
            win.show();win.setFullScreen(true);
            for(let i=0;i<100&&!win.isFullScreen();i++)await wait(50);await wait(1100);
            assert.equal(win.isFullScreen(),true,'native fullscreen');
            report.fullscreen={native:win.isFullScreen(),bounds:win.getBounds(),...await inspect('hist-body')};
            fs.writeFileSync(path.join(sandbox,'fullscreen.png'),(await win.webContents.capturePage()).toPNG());
            win.setFullScreen(false);for(let i=0;i<100&&win.isFullScreen();i++)await wait(50);await wait(1100);
            win.maximize();await wait(500);report.maximize={native:win.isMaximized(),bounds:win.getBounds(),...await inspect('hist-body')};
            assert.equal(win.isMaximized(),true,'native maximize');
            if(!legacy){assert.equal(report.fullscreen.columns,10);assert.deepEqual(report.fullscreen.clipped,[]);assert.equal(report.maximize.columns,10);assert.deepEqual(report.maximize.clipped,[]);}
            report.display=screen.getDisplayMatching(win.getBounds()).size;report.zoom=win.webContents.getZoomFactor();report.stats=await evaluate('NTKIOTResponsiveTables.stats()');
            if(!legacy){report.measureAudit=await evaluate('({...__measureAudit,remaining:document.querySelectorAll("[data-sales-measurement]").length})');assert.ok(report.measureAudit.zones>0);assert.equal(report.measureAudit.unsafe,0);assert.equal(report.measureAudit.remaining,0);}
            fs.writeFileSync(path.join(sandbox,'layout.json'),JSON.stringify(report,null,2));
            console.log(JSON.stringify({cases:report.results.length,fullscreen:report.fullscreen.columns,maximize:report.maximize.columns,stats:report.stats,errors:report.errors}));app.exit(0);
        }catch(error){report.failure=error.stack;fs.writeFileSync(path.join(sandbox,'layout.json'),JSON.stringify(report,null,2));console.error(error.stack);app.exit(1);}
    });
}

async function geometry(id){
    if(id==='hist-body'){router('history');renderHistoryTab('sales');}
    if(id==='returns-body'){router('history');renderHistoryTab('returns');}
    if(id==='mgmt-stock-history-body'){router('management');renderMgmtTab('inventory');}
    if(id==='inv-stock-history-body'){router('products');renderProductsTab('inventory');}
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const body=$(id),table=body.closest('table'),wrapper=table.closest('.table-wrap');
    const first=body.querySelector('.hist-row,.returns-row');
    if(first&&!first.classList.contains('is-expanded')){if(id==='hist-body')toggleHistRow(first);else toggleReturnsRow(first);}
    const headers=[...table.tHead.rows[0].cells].filter(cell=>getComputedStyle(cell).display!=='none');
    const clipped=[];
    for(const row of table.rows)if(getComputedStyle(row).display!=='none'){
        const cells=[...row.cells].filter(cell=>getComputedStyle(cell).display!=='none');
        if(cells.reduce((sum,cell)=>sum+cell.colSpan,0)!==headers.length)throw Error('colspan '+id);
        for(const cell of cells){
            if(getComputedStyle(cell).whiteSpace!=='nowrap')throw Error('wrapping '+id);
            if(cell.tagName!=='TH'&&['customer','staff','product'].includes(cell.dataset.column))continue;
            const price=cell.querySelector('.history-line-price');
            if(price){if(price.scrollWidth>price.clientWidth+1||price.getBoundingClientRect().right>cell.getBoundingClientRect().right+1)clipped.push('detail-price');continue;}
            if(cell.scrollWidth>cell.clientWidth+1)clipped.push(cell.dataset.column||cell.textContent);
            const rect=cell.getBoundingClientRect();
            for(const button of cell.querySelectorAll('button')){const b=button.getBoundingClientRect();if(b.right>rect.right+1||b.left<rect.left-1)clipped.push('button-boundary');}
        }
    }
    if(id==='hist-body'&&first){
        const edge=cell=>cell.getBoundingClientRect().right-parseFloat(getComputedStyle(cell).paddingRight);
        const center=cell=>(cell.getBoundingClientRect().left+cell.getBoundingClientRect().right)/2;
        const money=[headers.find(cell=>cell.dataset.column==='total'),first.querySelector('[data-column="total"]'),body.querySelector('.history-line-total')];
        if(money.some(cell=>getComputedStyle(cell).textAlign!=='right'||Math.abs(edge(cell)-edge(money[0]))>1))throw Error('money alignment');
        if(Math.abs(center(headers.find(cell=>cell.dataset.column==='items'))-center(body.querySelector('.history-line-quantity')))>1)throw Error('quantity alignment');
    }
    const allocated=headers.reduce((sum,cell)=>sum+parseFloat(cell.style.width),0);
    if(id==='hist-body'){
        const hidden=[...table.tHead.rows[0].cells].filter(cell=>getComputedStyle(cell).display==='none').map(cell=>cell.dataset.column);
        if(JSON.stringify(hidden)!==JSON.stringify(table.classList.contains('is-compact')?['customer','staff','payment']:[]))throw Error('sales optional columns');
    }
    return{id,viewport:innerWidth,full:+table.dataset.fullWidth,compactWidth:+table.dataset.compactWidth,compact:table.classList.contains('is-compact'),columns:headers.length,allocated,available:wrapper.clientWidth,
        widths:headers.map(cell=>cell.style.width),spans:[...body.rows].map(row=>[...row.cells].map(cell=>[cell.colSpan,cell.hidden])),overflow:Math.max(0,wrapper.scrollWidth-wrapper.clientWidth),clipped};
}
async function special(){
    const body=$('hist-body'),original=body.innerHTML,table=body.closest('table'),wrapper=table.closest('.table-wrap'),results=[];
    try{for(const compact of [false,true]){
        body.innerHTML='<tr><td>Không có dữ liệu</td></tr><tr class="history-more-row"><td><button>Xem thêm</button></td></tr>';
        NTKIOTResponsiveTables.refresh('hist-body');
        wrapper.style.width=(Number(table.dataset.fullWidth)+(compact?7:24)+wrapper.offsetWidth-wrapper.clientWidth)+'px';
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const count=[...table.tHead.rows[0].cells].filter(cell=>getComputedStyle(cell).display!=='none').length;
        if(count!==(compact?7:10)||[...body.rows].some(row=>row.cells[0].colSpan!==count))throw Error('special colspan');results.push(count);
        body.innerHTML=original;NTKIOTResponsiveTables.refresh('hist-body');
    }}finally{body.innerHTML=original;wrapper.style.width='';NTKIOTResponsiveTables.refresh('hist-body');}return results;
}
function fallback(){
    const original=Element.prototype.getBoundingClientRect;
    let injected=0;
    try{Element.prototype.getBoundingClientRect=function(){if(this.closest('[data-sales-measurement]')){injected++;throw Error('TEST_MEASUREMENT_FAILURE');}return original.call(this);};NTKIOTResponsiveTables.refresh('hist-body');
        if(!injected||document.querySelector('[data-sales-measurement]'))throw Error('fallback/cleanup');
        return{injected,full:+$('hist-body').closest('table').dataset.fullWidth};
    }finally{Element.prototype.getBoundingClientRect=original;NTKIOTResponsiveTables.refresh('hist-body');}
}
