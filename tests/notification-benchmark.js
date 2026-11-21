const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const hashSource=source=>Object.fromEntries(['main.js','preload.js','script.js','styles.css','index.html','data-model.js','data-authority.js','responsive-tables.js','notifications.js'].filter(name=>fs.existsSync(path.join(source,name))).map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(source,name))).digest('hex')]));
if(!process.argv.includes('--electron-child')) {
    const baseline=process.argv.find(arg=>arg.startsWith('--baseline='))?.slice('--baseline='.length);
    if(!baseline)throw new Error('Provide --baseline=/absolute/path/to/the/preserved/source');
    const candidate=process.argv.find(arg=>arg.startsWith('--candidate='))?.slice('--candidate='.length)||root;
    const reports=[];
    for(const source of [baseline,candidate]) {
        assert.ok(path.isAbsolute(source));
        const sourceHashes=hashSource(source);
        const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'ntkiot-benchmark-'));
        for(const key of ['userData','sessionData','logs','downloads','crashDumps'])fs.mkdirSync(path.join(sandbox,key));
        const product={id:'BENCH-P',name:'Benchmark',code:'BENCH-001',price:100000,cost:60000,stock:1000,cat:'Benchmark'};
        const data={products:[product],categories:['Benchmark'],users:[{id:'BENCH-U',user:'bench',pass:'fixture',name:'Benchmark',code:'NV001',role:'admin'}],
            custs:[{id:1,name:'Khách lẻ',points:0,debt:0,totalBuy:0}],suppliers:[],purchaseOrders:[],returns:[],stockHistory:[],activityLog:[],
            drafts:{invoices:[],purchaseOrders:[],products:[]},settings:{autoBackup:false,autoPrint:false,sound:false,pointsEnabled:false,scannerAutoAdd:true},
            invoices:Array.from({length:10000},(_,i)=>({id:'BENCH-'+i,date:'2026-01-01T00:00:00.000Z',custId:1,cust:'Khách lẻ',staff:'Benchmark',total:100000,discount:0,method:'CASH',items:[{...product,qty:1}]}))};
        fs.writeFileSync(path.join(sandbox,'userData','data.json'),JSON.stringify(data));
        const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
        const diagnostics=process.argv.filter(arg=>arg==='--profile');
        const result=spawnSync(require('electron'),[__filename,'--electron-child',sandbox,source,...diagnostics],{cwd:root,env,encoding:'utf8',timeout:60000,maxBuffer:5*1024*1024,killSignal:'SIGKILL'});
        assert.equal(result.status,0,result.stderr||result.stdout);
        assert.deepEqual(hashSource(source),sourceHashes,'source did not change during benchmark');
        const line=result.stdout.split('\n').find(line=>line.startsWith('BENCH_JSON '));assert.ok(line,result.stdout);
        reports.push({source,sourceHashes,sandbox,...JSON.parse(line.slice(11))});
    }
    assert.deepEqual(reports[1].business,reports[0].business,'business projections are identical');
    const comparison={};
    for(const key of ['scan','checkout','resize','nativeResize']) {
        const before=reports[0][key].p95,after=reports[1][key].p95,limit=before+Math.max(before*0.15,2);
        comparison[key]={baseline:before,current:after,limit,pass:after<=limit};
    }
    fs.writeFileSync(path.join(reports[1].sandbox,'benchmark.json'),JSON.stringify({reports,comparison},null,2));
    console.log(JSON.stringify({reports,comparison},null,2));
    assert.ok(Object.values(comparison).every(value=>value.pass),'p95 regression budget (including container and native window resize)');
} else {
    const {app,BrowserWindow}=require('electron');
    const sandbox=fs.realpathSync(process.argv[process.argv.indexOf('--electron-child')+1]);
    const source=fs.realpathSync(process.argv[process.argv.indexOf('--electron-child')+2]);
    assert.ok(sandbox.startsWith(fs.realpathSync(os.tmpdir())+path.sep)&&path.basename(sandbox).startsWith('ntkiot-benchmark-'));
    for(const key of ['userData','sessionData','downloads','crashDumps']){const dir=fs.realpathSync(path.join(sandbox,key));assert.ok(dir.startsWith(sandbox+path.sep));app.setPath(key,dir);assert.equal(app.getPath(key),dir);}
    app.setAppLogsPath(path.join(sandbox,'logs'));assert.equal(app.getPath('logs'),path.join(sandbox,'logs'));
    // Diagnostics wrap calls only inside this isolated harness, never production.
    const profile=process.argv.includes('--profile'),mainTimings={};
    const timed=(owner,key,name)=>{const original=owner[key];owner[key]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{(mainTimings[name]||=[]).push(performance.now()-start);}};};
    if(profile&&fs.existsSync(path.join(source,'data-authority.js'))){
        const authority=require(path.join(source,'data-authority.js')).DataAuthority;
        timed(authority.prototype,'authorize','authorize');
        timed(require(path.join(source,'data-model.js')),'validate','validate');
    }
    app.setAppPath(source);require(path.join(source,'main.js'));
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    app.whenReady().then(async()=>{
        try {
            const win=BrowserWindow.getAllWindows()[0];win.setContentSize(1440,800);
            win.webContents.print=(_opts,cb)=>cb?.(false,'PRINT_BLOCKED');win.webContents.getPrintersAsync=async()=>[];
            win.webContents.session.setPermissionRequestHandler((_c,_p,cb)=>cb(false));
            win.webContents.session.on('will-download',(_e,item)=>item.setSavePath(path.join(sandbox,'downloads',path.basename(item.getFilename()))));
            for(let i=0;i<250;i++){if(!win.webContents.isLoading()&&await win.webContents.executeJavaScript("typeof dataLoadStatus!=='undefined'&&dataLoadStatus==='primary'"))break;await wait(20);}
            await wait(500);
            const events=[];let inspector,inspectorPost;
            if(profile){
                inspector=new(require('node:inspector').Session)();inspector.connect();
                inspectorPost=(method)=>new Promise((resolve,reject)=>inspector.post(method,(error,result)=>error?reject(error):resolve(result)));
                await inspectorPost('Profiler.enable');await inspectorPost('Profiler.start');
                win.webContents.debugger.attach('1.3');win.webContents.debugger.on('message',(_event,method,params)=>{if(method==='Tracing.dataCollected')events.push(...params.value);});
                await win.webContents.debugger.sendCommand('Profiler.enable');await win.webContents.debugger.sendCommand('Profiler.start');
                await win.webContents.debugger.sendCommand('Tracing.start',{categories:'devtools.timeline,blink.user_timing',transferMode:'ReportEvents'});
            }
            const result=await win.webContents.executeJavaScript(`(${benchmark.toString()})()`);
            win.setContentSize(1800,800);await wait(150);
            const nativeSamples=[];
            for(let i=0;i<35;i++) {
                await win.webContents.executeJavaScript("window.__nativeResizeSample=new Promise(resolve=>{const start=performance.now();addEventListener('resize',()=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-start))),{once:true});});undefined;");
                win.setContentSize(i%2?1800:1440,800);
                const duration=await win.webContents.executeJavaScript('window.__nativeResizeSample');
                if(i>=5)nativeSamples.push(duration);
            }
            nativeSamples.sort((a,b)=>a-b);
            result.nativeResize={samples:nativeSamples.length,p95:nativeSamples[Math.ceil(nativeSamples.length*0.95)-1],median:nativeSamples[Math.floor(nativeSamples.length/2)]};
            if(profile){
                fs.writeFileSync(path.join(sandbox,'main.cpuprofile'),JSON.stringify((await inspectorPost('Profiler.stop')).profile));inspector.disconnect();
                fs.writeFileSync(path.join(sandbox,'renderer.cpuprofile'),JSON.stringify((await win.webContents.debugger.sendCommand('Profiler.stop')).profile));
                fs.writeFileSync(path.join(sandbox,'main-timings.json'),JSON.stringify(mainTimings));
                const done=new Promise(resolve=>{const listener=(_event,method)=>{if(method==='Tracing.tracingComplete'){win.webContents.debugger.removeListener('message',listener);resolve();}};win.webContents.debugger.on('message',listener);});await win.webContents.debugger.sendCommand('Tracing.end');await done;fs.writeFileSync(path.join(sandbox,'timeline.json'),JSON.stringify({traceEvents:events}));
            }
            console.log('BENCH_JSON '+JSON.stringify(result));app.exit(0);
        }catch(error){console.error(error.stack);app.exit(1);}
    });
}
async function benchmark(){
    window.confirm=()=>true;$('log-u').value='bench';$('log-p').value='fixture';await login();router('pos');
    const summarize=samples=>{const sorted=[...samples].sort((a,b)=>a-b);return{samples:sorted.length,p95:sorted[Math.ceil(sorted.length*0.95)-1],median:sorted[Math.floor(sorted.length/2)]};};
    const scan=[],checkout=[],resize=[];
    for(let i=0;i<35;i++){
        cart.length=0;clearToastHistory();const start=performance.now();processGlobalBarcode('BENCH-001');if(i>=5)scan.push(performance.now()-start);
        if(cart.length!==1||cart[0].qty!==1)throw new Error('Scanner business regression');
    }
    for(let i=0;i<35;i++){
        cart.length=0;addCart('BENCH-P');const start=performance.now();await directCheckout();if(i>=5)checkout.push(performance.now()-start);
    }
    router('history');$('hist-date-from').value='2020-01-01';$('hist-date-to').value='2099-12-31';renderHistoryTab('sales');
    const frameWork=[];
    const nativeFrame=requestAnimationFrame;
    window.requestAnimationFrame=callback=>nativeFrame(time=>{
        const start=performance.now();callback(time);
        if(String(callback).includes('apply(record'))frameWork.push(performance.now()-start);
    });
    const wrapper=$('hist-body').closest('.table-wrap');
    const rendered=$('hist-body').querySelectorAll('.hist-row').length;
    if(rendered!==200)throw new Error('History pagination changed');
    for(let i=0;i<35;i++) {
        await new Promise(resolve=>requestAnimationFrame(resolve));
        const start=performance.now();wrapper.style.width=(i%2?'1100px':'1800px');
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        if(i>=5)resize.push(performance.now()-start);
    }
    wrapper.style.width='';
    window.requestAnimationFrame=nativeFrame;
    const observers=typeof NTKIOTResponsiveTables!=='undefined'?NTKIOTResponsiveTables.stats():[];
    if(observers.some(record=>record.observers!==1)||observers.length&&observers.length!==4)throw new Error('Observer leak');
    if(db.invoices.length!==10035||db.products[0].stock!==965)throw new Error('Checkout business regression');
    return{scan:summarize(scan),checkout:summarize(checkout),resize:summarize(resize),resizeCallback:frameWork.length?summarize(frameWork):null,rendered,observers,business:{invoices:db.invoices.length,stock:db.products[0].stock,stockHistory:db.stockHistory.length,
        customer:db.custs.map(c=>({id:c.id,points:c.points,debt:c.debt,totalBuy:c.totalBuy})),newTotals:db.invoices.slice(10000).map(i=>i.total),cart:cart.length}};
}
