
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const source=fs.readFileSync(require.resolve('../script.js'),'utf8'),mainSource=fs.readFileSync(require.resolve('../main.js'),'utf8'),html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x));
function make(productionSource=source){
 const fields=new Map(),events=[],timers=[],logs=[],toasts=[],writes=[],storage=new Map();
 function element(id=''){let value='';return {id,get value(){return value},set value(v){value=String(v??'')},innerText:'',textContent:'',innerHTML:'',checked:false,disabled:false,hidden:false,max:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},removeEventListener(){},setAttribute(){},getAttribute(){return null},removeAttribute(){},querySelector(){return null},querySelectorAll(){return[]},closest(){return null},focus(){},select(){},appendChild(){},remove(){},getBoundingClientRect(){return {width:100,height:100,left:0,top:0,right:100,bottom:100}},offsetWidth:100,clientWidth:100};}
 for(const m of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g))fields.set(m[1],element(m[1]));
 const document={getElementById:id=>fields.get(id)||null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(...args)=>events.push(args),removeEventListener(){},createElement:()=>element(),createElementNS:()=>element(),body:element(),head:element(),documentElement:element()};
 const c={NTKIOTDataModel:require('../data-model'),document,console:{log:(...a)=>logs.push(a),warn:(...a)=>logs.push(a),error:(...a)=>logs.push(a)},
 localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k),clear:()=>storage.clear()},
 sessionStorage:{getItem:k=>storage.get('session:'+k)??null,setItem:(k,v)=>storage.set('session:'+k,String(v)),removeItem:k=>storage.delete('session:'+k),clear:()=>{for(const key of storage.keys())if(key.startsWith('session:'))storage.delete(key)}},
 setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},setInterval:()=>0,clearInterval(){},requestAnimationFrame:()=>0,cancelAnimationFrame(){},
 MutationObserver:class{observe(){}disconnect(){}},ResizeObserver:class{observe(){}disconnect(){}},
 addEventListener:(...a)=>events.push(a),removeEventListener(){},confirm:()=>true,alert(){},
 ntkiot:{data:{loadPrimary:async()=>({ok:true,primary:{exists:false}}),save:async text=>{writes.push(JSON.parse(text));return {ok:true}}},log:()=>{},onBeforeQuit:()=>{},printers:{list:async()=>[]}},
 getComputedStyle:()=>({getPropertyValue:()=>'',paddingLeft:'0',paddingRight:'0',fontSize:'16px'}),
 crypto:crypto.webcrypto,URL,Blob,TextEncoder,performance,
 navigator:{platform:'MacIntel'},innerWidth:1200,innerHeight:800,devicePixelRatio:1
 };
 c.window=c;c.globalThis=c;vm.createContext(c);vm.runInContext(productionSource,c,{filename:'script.js',timeout:5000});
 const noops=['renderPos','renderCart','renderInvoiceTabs','renderProdTable','renderInventory','renderManagement','renderHist','renderCustTable','renderSuppliers','renderPOHistory','renderReturnsHistory','renderStockHistory','renderStaffView','updateCustList','updateReturnExchangeModeUI','updateReturnModeUI','playSuccessSound','printInv','printReturnSlip','applyTheme','applyUISize','renderUsers','renderDraftsModalList','renderPOItems','refreshAllAfterImport','showLoading','hideLoading'];
 const originals={};for(const n of noops){originals[n]=c[n];c[n]=()=>{};}
 c.toast=(...a)=>toasts.push(a);c.showToast=(...a)=>toasts.push(a);
 const run=(code)=>vm.runInContext(code,c,{timeout:5000});
 run("db=cloneDefaultData(); db.settings.autoPrint=false; db.settings.autoBackup=false; db.settings.pointsEnabled=false; db.users=[{id:'U1',user:'audit',pass:'fixture',name:'Audit',code:'NV001',role:'admin'}]; currUser=db.users[0];isAuthenticated=true; saveSuppressed=false;saveBlockedReason='';_saveInProgress=false;cust=db.custs[0];");
 return {c,run,fields,events,timers,logs,toasts,writes,storage,originals};
}

function makeMain(options={}){
 const files=new Map(Object.entries(options.files||{})),handlers=new Map(),operations=[],logs=[];
 const failure=code=>Object.assign(new Error(code),{code});
 const fakeFs={mkdirSync(){},appendFileSync:(p,t)=>logs.push(JSON.parse(t)),promises:options.fsp || {
 realpath:async p=>{if(!files.has(p))throw failure('ENOENT');return p},
 stat:async p=>{if(options.statErrorPath===p)throw failure('EACCES');if(!files.has(p))throw failure('ENOENT');return {mtimeMs:1,atime:new Date(1),mtime:new Date(1),size:Buffer.byteLength(files.get(p)),isFile:()=>true}},
 readFile:async(p,encoding)=>{if(options.beforeRead)await options.beforeRead(p);if(!files.has(p))throw failure('ENOENT');return encoding?files.get(p):Buffer.from(files.get(p))},
 readdir:async p=>{if(options.readdirError||options.failReaddir)throw failure(options.readdirError||'EACCES');return [...files.keys()].filter(k=>k.startsWith(p+'/')).map(k=>k.slice(p.length+1));},
 mkdir:async()=>{},
 open:async p=>({writeFile:async t=>{if(options.failWrite)throw failure('ENOSPC');files.set(p,t);operations.push(['write',p])},sync:async()=>{if(options.failSync||(options.failBackupSync&&p.endsWith('.bak')))throw failure('ENOSPC')},close:async()=>{},utimes:async()=>{}}),
 copyFile:async(a,b)=>{if(options.failCopy)throw failure('ENOSPC');files.set(b,files.get(a));operations.push(['copy',a,b])},
 rename:async(a,b)=>{if(options.failRename===b)throw failure('ENOSPC');if(!files.has(a))throw failure('ENOENT');files.set(b,files.get(a));files.delete(a);operations.push(['rename',a,b])},
 unlink:async p=>{files.delete(p)},rm:async p=>{for(const k of files.keys())if(k===p||k.startsWith(p+'/'))files.delete(k)}
 }};
 let legacy=options.legacyText;
 const wc={getURL:()=> 'file:///readonly/index.html',getPrintersAsync:async()=>[],print:()=>{throw Error('REAL_PRINT_PROHIBITED')},on(){},setWindowOpenHandler(){},executeJavaScript:options.executeJavaScript || (options.legacyText===undefined?undefined:async code=>{if(code==="localStorage.getItem('pos_pro_v10')")return legacy;if(code.includes('localStorage.removeItem'))legacy=null;})};
 const electron={app:{getPath:()=>options.userData || '/ram',whenReady:()=>({then:callback=>options.ready?.push(callback)}),on:(event,callback)=>options.appEvents?.on(event,callback),getVersion:()=> 'audit'},screen:options.screen,BrowserWindow:options.BrowserWindow||{getAllWindows:()=>[]},ipcMain:{handle:(n,f)=>handlers.set(n,f),on:(n,f)=>handlers.set(n,f)},Menu:{setApplicationMenu(){}},dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[options.restorePath]}),showSaveDialog:options.showSaveDialog}};
 const c={require:n=>{if(n==='electron')return electron;if(n==='fs')return fakeFs;if(n==='path')return require('node:path');if(n==='./data-authority' && options.dataAuthority)return options.dataAuthority;if(['./data-model','./data-authority','node:crypto'].includes(n))return n.startsWith('./')?require('../'+n.slice(2)):require(n);throw Error('BLOCKED_REQUIRE')},Buffer,process:{pid:123,platform:'darwin'},__dirname:'/readonly',console,setTimeout:options.setTimeout||(()=>0),clearTimeout:options.clearTimeout||(()=>{})};
 vm.createContext(c);vm.runInContext(mainSource,c);c.windowFixture={isDestroyed:()=>false,webContents:wc};vm.runInContext('mainWindow=windowFixture;installIpc();',c);
 const write=async(text,options={})=>{try{c.writeText=text;c.writeOptions=options;await vm.runInContext("writeTextFileDurably('/ram/data.json',writeText,writeOptions)",c);return {ok:true}}catch(error){return {ok:false,code:error.code}}};
 return {c,files,handlers,operations,logs,write,event:{sender:wc},legacy:()=>legacy};
}

const test=require('node:test');
process.env.TZ='Asia/Ho_Chi_Minh';

test('UI20261021-03: native controls inside clickable cards retain Enter and Space',()=>{
 for(const key of ['Enter',' '])for(const tag of ['BUTTON','INPUT','SELECT','TEXTAREA','A','SPAN']){
  const h=make();let clicks=0;const card={click(){clicks++}},control={tagName:tag==='SPAN'?'BUTTON':tag};
  h.c.initAccessibilityEnhancements();const listener=h.events.filter(([type])=>type==='keydown').at(-1)[1];
  const e={key,target:{tagName:tag,closest:selector=>selector.includes('data-a11y-clickable')?card:control},preventDefault(){this.defaultPrevented=true}};
  const before=JSON.stringify(h.run('db'));listener(e);
  assert.equal(clicks,0,tag+' '+key);assert.equal(e.defaultPrevented,undefined);assert.equal(JSON.stringify(h.run('db')),before);assert.equal(h.writes.length,0);
 }
 const h=make();let clicks=0;const card={click(){clicks++}};h.c.initAccessibilityEnhancements();const listener=h.events.filter(([type])=>type==='keydown').at(-1)[1];
 const event={key:' ',target:{closest:s=>s.includes('data-a11y-clickable')?card:null},preventDefault(){this.defaultPrevented=true}};
 listener(event);assert.equal(clicks,1);assert.equal(event.defaultPrevented,true);
 listener({...event,defaultPrevented:true});listener({...event,isComposing:true,defaultPrevented:false});assert.equal(clicks,1);
});

test('UI20261021-02: date menus fit their clipping ancestor and scroll on the larger side',()=>{
 for(const [top,height]of [[190,300],[50,800],[5,300]]){
  const h=make();h.c.innerWidth=720;h.c.innerHeight=height;
  const clip={parentElement:h.c.document.body,offsetWidth:620,offsetHeight:height,clientWidth:620,clientHeight:height,clientLeft:0,clientTop:0,getBoundingClientRect:()=>({left:100,top:0,right:720,bottom:height,width:620,height})};
  const anchor={parentElement:clip,offsetWidth:140,offsetHeight:40,getBoundingClientRect:()=>({left:102,top,right:242,bottom:top+40,width:140,height:40})};
  const menu={style:{},scrollHeight:478,offsetParent:anchor,closest:()=>anchor,classList:{contains:()=>true,remove(){this.closed=true}}};
  h.c.getComputedStyle=e=>({overflowX:e===clip?'auto':'visible',overflowY:e===clip?'auto':'visible',borderTopWidth:'0',borderBottomWidth:'0'});
  h.c.positionDateFilterMenu(menu);
  const left=102+parseFloat(menu.style.left),y=top+parseFloat(menu.style.top),maxHeight=parseFloat(menu.style.maxHeight);
  assert.ok(left>=108&&left+parseFloat(menu.style.width)<=712);assert.ok(y>=8);assert.ok(y+Math.min(478,maxHeight)<=height-8+.01);
  if(top===190)assert.ok(y<top,'insufficient space below opens above');
 }
});

function invoicePreviewFocusFixture(){
 const h=make(),listeners=new Map();let restored=0;
 const origin={isConnected:true,disabled:false,hidden:false,getClientRects:()=>[{}],focus(){restored++;h.c.document.activeElement=this}};
 const doc={activeElement:null,addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k)};
 const frame={id:'invoice-pdf-print-iframe',isConnected:true,style:{display:'block'},contentDocument:doc,contentWindow:{focus(){}}};
 const control=id=>({id,hidden:false,ownerDocument:doc,getAttribute:()=>null,focus(){doc.activeElement=this;h.c.document.activeElement=frame}});
 const print=control('print-btn'),close=control('close-btn');doc.querySelectorAll=()=>[print,close];doc.getElementById=id=>id==='close-btn'?close:print;
 h.c.document.activeElement=origin;h.c.getComputedStyle=()=>({display:'block',visibility:'visible'});h.c.requestAnimationFrame=f=>{f();return 1};
 return{...h,frame,doc,origin,print,close,listeners,restored:()=>restored};
}

test('UI20261021-04: PDF focus stays in the visible preview and stale close callbacks do nothing',()=>{
 const h=invoicePreviewFocusFixture();h.c.bindInvoicePreviewFocus(h.frame,h.origin);
 assert.equal(h.doc.activeElement,h.close);assert.equal(h.c.document.activeElement,h.frame);
 const key=(shiftKey=false)=>({key:'Tab',shiftKey,preventDefault(){this.defaultPrevented=true},stopPropagation(){}});
 const tab=key();h.listeners.get('keydown')(tab);assert.equal(h.doc.activeElement,h.print);assert.equal(tab.defaultPrevented,true);
 h.listeners.get('keydown')(key(true));assert.equal(h.doc.activeElement,h.close);
 const oldAfterPrint=h.frame.contentWindow.onafterprint;h.c.bindInvoicePreviewFocus(h.frame,h.origin);oldAfterPrint();assert.equal(h.frame.style.display,'block');
 h.close.onclick();assert.equal(h.frame.style.display,'none');assert.equal(h.restored(),1);assert.equal(h.listeners.size,0);
});

test('UI20261021-04: preview isolates business shortcuts and restores a valid fallback',()=>{
 const h=invoicePreviewFocusFixture();h.origin.isConnected=false;let navFocus=0;
 h.c.document.querySelector=()=>({focus(){navFocus++}});h.c.bindInvoicePreviewFocus(h.frame,h.origin);
 const event=(key,extra={})=>({key,preventDefault(){this.defaultPrevented=true},stopPropagation(){this.stopped=true},...extra});
 for(const e of [event('F4'),event('z',{ctrlKey:true}),event('t',{metaKey:true}),event('ArrowLeft',{altKey:true})]){h.listeners.get('keydown')(e);assert.equal(e.defaultPrevented,true);assert.equal(e.stopped,true)}
 for(const e of [event('c',{ctrlKey:true}),event('a',{metaKey:true}),event('Tab',{isComposing:true})]){h.listeners.get('keydown')(e);assert.equal(e.defaultPrevented,undefined)}
 h.close.onclick();assert.equal(h.restored(),0);assert.equal(navFocus,1);assert.equal(h.listeners.size,0);
});

test('AUDIT-A01: linked return effects treat invoice ID 0 and string 0 identically',()=>{
 for(const id of [0,'0']){
  const h=make();h.run("db.custs=[{id:0,name:'Customer',points:350,totalBuy:25000}];db.settings.pointsEnabled=true;db.settings.pointsRate=1");
  h.c.returnFixture={id:'R',invoiceId:id,custId:0,returnTotal:25000,exchangeTotal:0};
  assert.equal(h.run('applyLinkedReturnCustomerEffects(returnFixture,1)'),true);
  assert.deepEqual(plain(h.run('db.custs[0]')),{id:0,name:'Customer',points:100,totalBuy:0});
  assert.deepEqual(plain(h.c.returnFixture.customerEffects),{customerId:0,pointsDelta:-250,totalBuyDelta:-25000});
 }
});

test('AUDIT-A01: empty legacy invoice references keep their original quick-return fallback',()=>{
 for(const id of ['',false]){
  const h=make();h.run("db.custs=[{id:0,name:'Customer',points:100,totalBuy:0}];db.settings.pointsEnabled=true;");
  h.c.returnFixture={id:'R',invoiceId:id,custId:0,returnTotal:1000,exchangeTotal:0};
  assert.equal(h.run('applyLinkedReturnCustomerEffects(returnFixture,1)'),false);
  assert.equal(h.run('db.custs[0].points'),100);assert.equal(h.c.returnFixture.customerEffects,undefined);
 }
});

test('AUDIT-A01: invoice undo removes only its own restock history when IDs overlap',async()=>{
 const h=make();h.run("db.invoices=[];db.stockHistory=[{id:'OWN',source:'delete_return',note:'Hoàn kho - Xóa HĐ 12'},{id:'OTHER',source:'bulk_delete_return',note:'Hoàn kho - Xóa HĐ 312'}];pushUndo(UNDO_ACTIONS.DELETE_INVOICE,{invoice:{id:'12',items:[],total:0},restoredItems:[]});");
 await h.c.performUndo();assert.deepEqual(plain(h.run('db.stockHistory.map(h=>h.id)')),['OTHER']);
});

test('AUDIT-A01: canonical numeric-string pointsUsed keeps the numeric reversal formula',()=>{
 const h=make();h.run("db.custs=[{id:'C',name:'Customer',points:70,totalBuy:5000}];db.settings.pointsEnabled=true;db.settings.pointsRate=1;db.returns=[];reverseInvoiceCustomerEffects({id:'OLD',custId:'C',total:'1000',pointsUsed:'10'});");
 assert.equal(h.run('db.custs[0].points'),70);assert.equal(h.run('db.custs[0].totalBuy'),4000);
});

test('AUDIT-A02: CSV quoted newlines and escaped quotes preserve one complete product row',()=>{
 const h=make();
 const input='Mã hàng,Tên hàng,Giá bán,Giá vốn,Tồn kho\r\n001,"Nồi, ""thử""\r\ndòng hai",25000,15000,5\r\n';
 assert.deepEqual(plain(h.c.parseCSV(input)),[{'Mã hàng':'001','Tên hàng':'Nồi, "thử"\r\ndòng hai','Giá bán':'25000','Giá vốn':'15000','Tồn kho':'5'}]);
});
test('AUDIT-A02: CSV rejects broken quoting/excess fields but preserves optional trailing fields',()=>{
 const h=make();
 for(const text of ['code,name\nA,"unclosed','code,name\nA,B,C','code,name\nA,"B"junk'])assert.throws(()=>h.c.parseCSV(text));
 assert.deepEqual(plain(h.c.parseCSV('code,name,unit\n001,Nồi\n\n')),[{code:'001',name:'Nồi',unit:''}]);
 assert.deepEqual(plain(h.c.parseCSV('a,b\n"",""\n')),[{a:'',b:''}]);
 assert.deepEqual(plain(h.c.parseCSV('name\n"\n"\n')),[{name:'\n'}]);
});

test('authority startup: browser-cache migration commits once and removes cache only after durable success',async()=>{
 const data=plain(require('../data-model').defaults);data.users[0].code='NV0001';data.settings.autoBackup=false;
 for(const failed of [false,true]){
  const legacy=JSON.stringify(data),h=makeMain({legacyText:legacy,...(failed?{failRename:'/ram/data.json'}:{})});
  const result=await h.handlers.get('ntkiot:data-load-primary')(h.event);
  assert.equal(result.ok,true);assert.equal(result.saveBlocked,failed);assert.ok(result.data.users.every(user=>!Object.hasOwn(user,'pass')));
  assert.equal(h.legacy(),failed?legacy:null);
  if(failed)assert.equal(h.files.has('/ram/data.json'),false);
  else {assert.ok(require('../data-model').validPasswordHash(JSON.parse(h.files.get('/ram/data.json')).users[0].passwordHash));const writes=h.operations.length;await h.handlers.get('ntkiot:data-load-primary')(h.event);assert.equal(h.operations.length,writes);}
 }
});

test('authority startup: invalid primary falls back to valid bak; invalid sources never overwrite the primary',async()=>{
 const data=plain(require('../data-model').defaults);data.users[0].code='NV0001';data.settings.autoBackup=false;
 for(const validBak of [false,true]){
  const bak=validBak?JSON.stringify(data):'{invalid-bak';
  const h=makeMain({files:{'/ram/data.json':'{invalid-primary','/ram/data.json.bak':bak}});
  const result=await h.handlers.get('ntkiot:data-load-primary')(h.event);
  assert.equal(result.saveBlocked,!validBak);assert.equal(result.source,validBak?'data-bak':'default');
  assert.equal(h.files.get('/ram/data.json.bak'),bak);
  if(validBak){const disk=JSON.parse(h.files.get('/ram/data.json'));assert.ok(require('../data-model').validPasswordHash(disk.users[0].passwordHash));disk.users[0]=data.users[0];assert.deepEqual(disk,data);}else assert.equal(h.files.get('/ram/data.json'),'{invalid-primary');
 }
});

test('authority startup: failed maintenance restores previous in-memory codes and preserves durable file',async()=>{
 const data=plain(require('../data-model').defaults);data.settings.autoBackup=false;
 const text=JSON.stringify(data),h=makeMain({files:{'/ram/data.json':text},failRename:'/ram/data.json'});
 const result=await h.handlers.get('ntkiot:data-load-primary')(h.event);
 assert.equal(result.saveBlocked,true);assert.equal(result.data.users[0].code,undefined);assert.equal(h.files.get('/ram/data.json'),text);
});

test('successful restore clears cached recovery block; failed restore preserves the blocked load state',async()=>{
 const data=plain(require('../data-model').defaults);data.users[0].code='NV0001';data.settings.autoBackup=false;
 for(const failed of [false,true]){
  const h=makeMain({files:{'/ram/data.json':'{invalid','/ram/fixture.json':JSON.stringify(data)},restorePath:'/ram/fixture.json',...(failed?{failRename:'/ram/data.json'}:{})});
  const call=(channel,payload)=>h.handlers.get(channel)(h.event,payload);
  assert.equal((await call('ntkiot:data-load-primary')).saveBlocked,true);
  const session=await call('ntkiot:auth-login',{username:'admin',password:'123'});assert.equal(session.ok,true);
  const candidate=await call('ntkiot:restore-prepare');assert.equal(candidate.ok,true);
  const result=await call('ntkiot:restore-commit',{requestId:'restore-fixture',token:candidate.token,baseRevision:session.revision,sessionEpoch:session.sessionEpoch});
  assert.equal(result.committed,!failed);
  const loaded=await call('ntkiot:data-load-primary');assert.equal(loaded.saveBlocked,failed);
  if(!failed){assert.equal(loaded.source,'primary');assert.deepEqual(plain(loaded.errors),[]);}else assert.equal(h.files.get('/ram/data.json'),'{invalid');
 }
});

test('restore preview token rejects same-size content changes and missing source without altering state',async()=>{
 for(const removed of [false,true]){
  const data=plain(require('../data-model').defaults);data.users[0].code='NV0001';data.settings.autoBackup=false;data.settings.name='AAAA';
  const original=JSON.stringify(data),h=makeMain({files:{'/ram/data.json':original,'/ram/fixture.json':original},restorePath:'/ram/fixture.json'});
  const call=(channel,payload)=>h.handlers.get(channel)(h.event,payload);
  await call('ntkiot:data-load-primary');const migrated=h.files.get('/ram/data.json');const session=await call('ntkiot:auth-login',{username:'admin',password:'123'});
  const candidate=await call('ntkiot:restore-prepare');assert.equal(candidate.ok,true);
  if(removed)h.files.delete('/ram/fixture.json');else{data.settings.name='BBBB';const changed=JSON.stringify(data);assert.equal(changed.length,original.length);h.files.set('/ram/fixture.json',changed);}
  // The fake stat has identical size/mtime; rejecting a same-size edit proves
  // validation compares content, not just metadata or file existence.
  const result=await call('ntkiot:restore-commit',{requestId:'stale-source',token:candidate.token,baseRevision:session.revision,sessionEpoch:session.sessionEpoch});
  assert.equal(result.code,'STALE_STATE');assert.equal(result.committed,false);assert.equal(h.files.get('/ram/data.json'),migrated);
  assert.equal((await call('ntkiot:auth-current')).actor.role,'admin');
 }
});

test('malformed startup and restore JSON never expose input fragments in errors or logs',async()=>{
 const secret='SECRET-FIXTURE',invalid=`{"pass": ${secret}}`;
 const data=plain(require('../data-model').defaults);data.users[0].code='NV0001';data.settings.autoBackup=false;
 const h=makeMain({files:{'/ram/data.json':invalid,'/ram/fixture.json':invalid},restorePath:'/ram/fixture.json'});
 const call=(channel,payload)=>h.handlers.get(channel)(h.event,payload);
 const load=await call('ntkiot:data-load-primary');assert.equal(load.saveBlocked,true);assert.equal(h.files.get('/ram/data.json'),invalid);
 await call('ntkiot:auth-login',{username:'admin',password:'123'});
 const restore=await call('ntkiot:restore-prepare');assert.equal(restore.code,'INVALID_DATA');
 assert.equal(JSON.stringify([load.errors,restore,h.logs]).includes('SECRET'),false);
});

test('cancelled restore cannot commit after an asynchronous source-file check resumes',async()=>{
 const data=plain(require('../data-model').defaults);data.users[0].code='NV0001';data.settings.autoBackup=false;
 const text=JSON.stringify(data),options={files:{'/ram/data.json':text,'/ram/fixture.json':text},restorePath:'/ram/fixture.json'};
 const h=makeMain(options),call=(channel,payload)=>h.handlers.get(channel)(h.event,payload);
 await call('ntkiot:data-load-primary');const migrated=h.files.get('/ram/data.json');const session=await call('ntkiot:auth-login',{username:'admin',password:'123'});
 const candidate=await call('ntkiot:restore-prepare');assert.equal(candidate.ok,true);
 let release,entered;const reading=new Promise(resolve=>entered=resolve);
 options.beforeRead=p=>{if(p==='/ram/fixture.json'){entered();return new Promise(resolve=>release=resolve);}};
 const writes=h.operations.length;
 const commit=call('ntkiot:restore-commit',{requestId:'cancel-during-read',token:candidate.token,baseRevision:session.revision,sessionEpoch:session.sessionEpoch});
 await reading;assert.equal((await call('ntkiot:restore-cancel')).ok,true);release();
 const result=await commit;assert.equal(result.code,'STALE_STATE');assert.equal(result.committed,false);
 assert.equal(h.operations.length,writes);assert.equal(h.files.get('/ram/data.json'),migrated);
 assert.equal((await call('ntkiot:auth-current')).actor.role,'admin');
});

test('T02: every precommit write/sync/copy/rename failure preserves primary and previous bak',async()=>{
 for(const stage of [{failWrite:true},{failSync:true},{failBackupSync:true},{failCopy:true},{failRename:'/ram/data.json'}]){
 const h=makeMain({...stage,files:{'/ram/data.json':'{"old":1}','/ram/data.json.bak':'{"older":1}'}});
 const result=await h.write('{"new":1}');
 assert.equal(result.ok,false);assert.equal(h.files.get('/ram/data.json'),'{"old":1}');assert.equal(h.files.get('/ram/data.json.bak'),'{"older":1}');
 assert.equal([...h.files.keys()].some(p=>p.includes('.tmp-')),false);
 }
 const h=makeMain({files:{'/ram/data.json':'{"old":1}','/ram/data.json.bak':'{"older":1}'}});
 assert.equal((await h.write('{"new":1}',{keepBak:false})).ok,true);assert.equal(h.files.get('/ram/data.json.bak'),'{"older":1}');
});
test('T03/R15: failed recovery rewrite blocks migrations and backup writes',async()=>{
 const h=make();const data=plain(h.run('db'));delete data.users[0].code;
 h.c.ntkiot.data.loadPrimary=async()=>({ok:true,primary:{exists:true,text:'{broken'}});
 h.c.ntkiot.data.loadBak=async()=>({ok:true,backup:{exists:true,text:JSON.stringify(data)}});
 h.c.ntkiot.data.save=async text=>{h.writes.push(JSON.parse(text));return {ok:false}};
 initStubs(h);await h.c.init();assert.equal(h.writes.length,1);assert.equal(h.run('db.users[0].code'),undefined);assert.ok(h.run('saveBlockedReason'));
 await h.c.ensureUserCodes();assert.equal(h.writes.length,1);assert.equal(await h.c.performBackup({force:true}),false);
});
test('R15: automatic backup remains permitted before login, captures only settled data',async()=>{
 const h=make();h.run('currUser=null;isAuthenticated=false;db.settings.autoBackup=true;');const backups=[];
 h.c.ntkiot.data.createBackup=async text=>{backups.push(JSON.parse(text));return {ok:true,id:'backup_fake.json'}};
 h.c.ntkiot.data.cleanupBackups=async()=>({ok:true});h.c.ntkiot.data.listBackups=async()=>({ok:true,backups:[]});
 assert.equal(await h.c.performBackup({force:true,reason:'startup-due'}),true);assert.equal(backups.length,1);assert.equal(h.writes.length,1);assert.equal(h.run('isAuthenticated'),false);
});
test('R16: admin reset cancels old background jobs, preserves role checks and error recovery',async()=>{
 for(const role of ['admin','staff']){
 const h=make();let resets=0,oldResult;h.c.location={reload(){}};h.c.ntkiot.data.resetAll=async()=>{resets++;return {ok:true}};
 h.run('db.users[0].role='+JSON.stringify(role));h.c.oldJobResolve=value=>oldResult=value;
 h.run("backgroundDataJobs.push({key:'old',run:()=>{throw Error('stale reset write')},resolvers:[oldJobResolve]});");
 await h.c.resetApp();assert.equal(resets,role==='admin'?1:0);assert.equal(h.writes.length,0);
 if(role==='admin'){assert.equal(oldResult,false);assert.equal(h.run('saveSuppressed'),true);}
 }
 const h=make();h.c.location={reload(){}};h.c.ntkiot.data.resetAll=async()=>({ok:false});await h.c.resetApp();assert.equal(h.run('saveSuppressed'),false);assert.equal(h.run('activeDataMutation'),null);
});
test('R12: staff changes only own password through the real guard; failed persistence restores it',async()=>{
 for(const success of [false,true]){
 const h=make();h.run("db.users.push({id:'U2',user:'staff',pass:'fixture',name:'Staff',role:'staff'});currUser=db.users[1];");
 h.fields.get('own-old-pass').value='fixture';h.fields.get('own-new-pass').value='new-fixture';h.fields.get('own-confirm-pass').value='new-fixture';
 h.c.ntkiot.data.save=async()=>({ok:success});await h.c.changeOwnPassword();
 assert.equal(h.run('db.users[1].pass'),success?'new-fixture':'fixture');assert.equal(h.run('db.users[0].pass'),'fixture');
 }
});
test('R17: every storage IPC rejects an untrusted sender before I/O',async()=>{
 const h=makeMain();for(const [channel,handler]of h.handlers){
 if(!/^ntkiot:(?:data-|backup-|auth-|restore-)/.test(channel))continue;
 const result=await handler({sender:{}},{text:'{"unsafe":1}',id:'../escape',limit:3});assert.equal(result.ok,false,channel);assert.equal(result.code,'UNAUTHORIZED',channel);
 }
 assert.equal(h.operations.length,0);
 assert.equal((await h.handlers.get('ntkiot:data-save')(h.event,{text:'broken'})).ok,false);
 assert.equal((await h.handlers.get('ntkiot:backup-read')(h.event,{id:'../escape'})).ok,false);assert.equal(h.operations.length,0);
});
test('R18: every static HTML handler resolves to an existing production entry point',()=>{
 const h=make();const handlers=[...html.matchAll(/\bon(?:click|change|input|keydown|keyup|focus|blur|mousedown|dblclick)\s*=\s*(["'])(.*?)\1/gs)];
 const names=[...new Set(handlers.flatMap(match=>[...match[2].matchAll(/(?:^|[^.\w])([A-Za-z_$][\w$]*)\s*\(/g)].map(item=>item[1])).filter(name=>!['if','parseInt','parseFloat','String','Number'].includes(name)))];
 assert.ok(names.length>=180);for(const name of names)assert.equal(h.run('typeof '+name),'function',name);
});


test('T01/R03: every coordinated foreground caller refuses an overlapping sale before mutation',async()=>{
 const h=poFixture();h.run("cart=[{id:'P1',name:'A',qty:3,price:100000,cost:60000}];saveCurrentTabState();");
 let resolve;h.c.ntkiot.data.save=()=>new Promise(r=>resolve=r);const sale=h.c.directCheckout();const before=JSON.stringify(h.run('db'));
 const names=[...new Set([...source.matchAll(/beginDataMutation\('([^']+)'/g)].map(match=>match[1]))].filter(name=>!['background-save','performBackup','applyTheme','applyUISize'].includes(name));
 assert.ok(names.length>=50);
 for(const name of names){
  await h.c[name]();assert.equal(JSON.stringify(h.run('db')),before,name);
 }
 await h.c.applyTheme('dark',true);await h.c.applyUISize('large',true);assert.equal(JSON.stringify(h.run('db')),before,'persisted presentation settings');
 resolve({ok:false});await sale;assert.equal(h.run('activeDataMutation'),null);assert.equal(h.run('db.invoices.length'),0);
});
test('T01/R03: exceptions and early returns release ownership; committed UI failure retains invoice',async()=>{
 const h=poFixture();h.run("cart=[{id:'P1',name:'A',qty:3,price:100000,cost:60000}];saveCurrentTabState();");
 const before=JSON.stringify(h.run('db'));h.c.logActivity=()=>{throw Error('fixture-render-error')};await h.c.directCheckout();
 assert.equal(JSON.stringify(h.run('db')),before);assert.equal(h.run('activeDataMutation'),null);assert.equal(h.writes.length,0);
 const committed=poFixture();committed.run("cart=[{id:'P1',name:'A',qty:3,price:100000,cost:60000}];saveCurrentTabState();");
 committed.c.renderCart=()=>{throw Error('fixture-render-error')};await committed.c.directCheckout();assert.equal(committed.run('db.invoices.length'),1);assert.equal(committed.writes[0].products[0].stock,7);assert.equal(committed.run('activeDataMutation'),null);
 const empty=make();await empty.c.directCheckout();assert.equal(empty.run('activeDataMutation'),null);assert.equal(empty.writes.length,0);
});
test('T01/R03/R12: failed write does not resurrect admin or erase a concurrent login log',async()=>{
 const h=poFixture();h.run("db.users.push({id:'U2',user:'staff',pass:'fixture',name:'Staff',role:'staff'});cart=[{id:'P1',name:'A',qty:3,price:100000,cost:60000}];saveCurrentTabState();");
 let resolve,calls=0;h.c.ntkiot.data.save=text=>{h.writes.push(JSON.parse(text));return ++calls===1?new Promise(r=>resolve=r):Promise.resolve({ok:true})};
 const pending=h.c.directCheckout();h.c.showLoginModal();h.fields.get('log-u').value='staff';h.fields.get('log-p').value='fixture';h.c.login();
 resolve({ok:false});await pending;await Promise.resolve();await Promise.resolve();
 assert.equal(h.run('getCurrentUserRecord().role'),'staff');assert.equal(h.run('db.activityLog[0].action'),'Đăng nhập');
 assert.equal(h.run('db.activityLog[0].user'),'Staff');assert.equal(h.run('undoStack.length'),0);assert.equal(h.run('db.invoices.length'),0);
});
test('T01: queued save Promises resolve actual results and preserve distinct keepBak choices',async()=>{
 const h=poFixture();h.run("cart=[{id:'P1',name:'A',qty:3,price:100000,cost:60000}];saveCurrentTabState();");
 let resolve,count=0;const options=[];h.c.ntkiot.data.save=(text,opt)=>{options.push(opt.keepBak);return ++count===1?new Promise(r=>resolve=r):Promise.resolve({ok:opt.keepBak!==false})};
 const sale=h.c.directCheckout();const a=h.c.saveNow({keepBak:false}),b=h.c.saveNow({keepBak:false}),c=h.c.saveNow({keepBak:true});
 resolve({ok:false});await sale;assert.deepEqual(await Promise.all([a,b,c]),[false,false,true]);assert.deepEqual(options,[true,false,true]);assert.equal(h.run('activeDataMutation'),null);
});
test('T01/R03/R04: sale rollback and commit preserve the other active tab',async()=>{
 for(const success of [false,true]){
 const h=poFixture();h.run("invoiceTabs=[{id:1,name:'Sale A',cart:[{id:'P1',name:'A',qty:3,price:100000}],cust:null,discount:0,discountType:'amount',returnItems:[],exchangeItems:[]},{id:2,name:'Sale B',cart:[{id:'P1',name:'A',qty:4,price:100000}],cust:null,discount:5000,discountType:'amount',returnItems:[],exchangeItems:[]}];activeTabId=1;loadTabState(1);");
 let resolve;h.c.ntkiot.data.save=()=>new Promise(r=>resolve=r);const pending=h.c.directCheckout();h.c.switchTab(2);h.c.window.orderNote='other-tab-note';resolve({ok:success});await pending;
 assert.equal(h.run('activeTabId'),2);assert.equal(h.run('cart[0].qty'),4);assert.equal(h.fields.get('cart-discount').value,'5000');assert.equal(h.c.window.orderNote,'other-tab-note');
 assert.equal(h.run('db.invoices.length'),success?1:0);
 }
});
test('T04: missing legacy points snapshot permits note-only edits and refuses financial changes',async()=>{
 const h=editFixture(3,100);h.fields.set('edit-inv-total',{innerText:''});h.run('delete db.invoices[0].pointsValue;db.settings.pointsValue=9000;');h.c.recalcEditInvoice();assert.equal(h.fields.get('edit-inv-total').innerText,h.run('money(200000)'));
 await h.c.saveEditInvoice();assert.equal(h.run('db.invoices[0].total'),200000);
 const invalid=editFixture(3,100);invalid.run('delete db.invoices[0].pointsValue;editingInvoiceItems[0].qty=2;editingInvoiceItems[0].lineTotal=200000;');await invalid.c.saveEditInvoice();assert.equal(invalid.writes.length,0);assert.equal(invalid.run('db.products[0].stock'),7);
});
test('T09/D06-D08/D10: deleting the final PO clears fallback debt; undo and supplier move reconcile',async()=>{
 for(const revertStock of [false,true]){
 const h=poFixture();await h.c.savePurchaseOrder();const id=h.run('db.purchaseOrders[0].id');let question=0;h.c.confirm=()=>++question===1?revertStock:true;
 await h.c.deletePurchaseOrder(id);assert.equal(h.run('db.suppliers[0].debt'),0);assert.equal(h.run('db.products[0].stock'),revertStock?10:12);
 await h.c.performUndo();assert.equal(h.run('db.suppliers[0].debt'),120000);assert.equal(h.run('db.products[0].stock'),12);
 }
 const h=poFixture();h.run("db.suppliers[0].id=101;db.suppliers.push({id:'B',name:'Supplier B',debt:100000});");h.fields.get('po-supplier').value='101';await h.c.savePurchaseOrder();
 assert.equal(h.run('getSupplierDebt(db.suppliers[0])'),120000);
 const before=JSON.stringify(h.run('db'));h.originals.renderSuppliers();assert.equal(JSON.stringify(h.run('db')),before);
 await h.c.editPurchaseOrder(h.run('db.purchaseOrders[0].id'));h.fields.get('po-supplier').value='B';await h.c.savePurchaseOrder();assert.equal(h.run('db.suppliers[0].debt'),0);assert.equal(h.run('db.suppliers[1].debt'),120000);
});
test('T11: late FileReader results, type changes, close/reopen and onerror cannot resurrect candidates',()=>{
 const h=make();const readers=[];h.c.FileReader=class{constructor(){readers.push(this)}readAsText(){}};
 h.c.openImportModal('products');const a={name:'A.csv'},b={name:'B.csv'};
 const csv=name=>'code,name,price,stock\n'+name+','+name+',100000,3';
 h.fields.get('import-file').files=[a];h.c.handleImportFile();h.fields.get('import-file').files=[b];h.c.handleImportFile();
 readers[1].onload({target:{result:csv('B')}});const accepted=h.run('JSON.stringify(importedData)');
 readers[0].onload({target:{result:csv('A')}});assert.equal(h.run('JSON.stringify(importedData)'),accepted);
 h.c.closeModal('import-modal');h.c.openImportModal('customers');readers[1].onload({target:{result:csv('B')}});assert.equal(h.run('importedData.length'),0);
 h.fields.get('import-file').files=[b];h.c.handleImportFile();readers.at(-1).onerror();assert.equal(h.fields.get('import-confirm-btn').disabled,true);assert.equal(h.run('importedData.length'),0);
});
test('T12: deliberate local PO date edit converts correctly; invalid date has no partial stock mutation',async()=>{
 const h=poFixture();h.fields.get('po-date').value='2026-10-01T10:25';await h.c.savePurchaseOrder();assert.equal(h.run('db.purchaseOrders[0].date'),'2026-10-01T03:25:00.000Z');
 const bad=poFixture();bad.fields.get('po-date').value='not-a-date';await bad.c.savePurchaseOrder();assert.equal(bad.run('db.products[0].stock'),10);assert.equal(bad.writes.length,0);assert.equal(bad.run('activeDataMutation'),null);
});
test('T13: offset zero, negative, disabled and invalid load before settings',async()=>{
 for(const [enabled,value,expected]of [[true,0,0],[true,-86400000,-86400000],[false,86400000,0],[true,'broken',0]]){
 const h=make();const data=plain(h.run('db'));data.settings.timeOverrideEnabled=enabled;data.settings.timeOffset=value;
 h.c.ntkiot.data.loadPrimary=async()=>({ok:true,primary:{exists:true,text:JSON.stringify(data)}});initStubs(h);await h.c.init();assert.equal(h.run('timeOffset'),expected);h.c.loadSets();assert.equal(h.run('timeOffset'),expected);
 }
});
test('T08/R12: canonical role revocation and unknown undo action are rejected without consuming history',async()=>{
 const h=poFixture();await h.c.delP('P1');h.run("db.users[0].role='staff'");const before=JSON.stringify(h.run('db'));await h.c.performUndo();assert.equal(JSON.stringify(h.run('db')),before);assert.equal(h.run('undoStack.length'),1);
 h.run("db.users[0].role='admin';undoStack[0].type='UNKNOWN'");await h.c.performUndo();assert.equal(h.run('undoStack.length'),1);assert.equal(h.run('db.products.length'),0);
});

test('T13/R14: failed time writes restore the clock, settings and activity together',async()=>{
 for(const name of ['toggleTimeOverride','updateTimeOffset','resetTimeToSystem']){
 const h=make();h.run('timeOffset=86400000;db.settings.timeOffset=86400000;db.settings.timeOverrideEnabled=true;');
 h.fields.get('set-time-override').checked=false;h.fields.get('set-custom-datetime').value='2026-10-04T12:30';
 const before=JSON.stringify(h.run('db'));h.c.ntkiot.data.save=async()=>({ok:false});await h.c[name]();
 assert.equal(JSON.stringify(h.run('db')),before,name);assert.equal(h.run('timeOffset'),86400000,name);assert.equal(h.run('activeDataMutation'),null,name);
 }
});

test('T01/R05/R06/R10: failed document edits, deletes, returns and undo roll back all linked state',async()=>{
 for(const flow of ['invoice-edit','invoice-delete','invoice-bulk-delete','return','return-delete','undo-return','po-delete','po-paid']){
 let h,invoke;
 if(flow.startsWith('invoice')){
  h=editFixture();
  if(flow==='invoice-edit'){h.c.renderEditInvoiceItems=()=>{};h.c.updateEditInvoiceItem(0,'qty','2');invoke=()=>h.c.saveEditInvoice();}
  if(flow==='invoice-delete')invoke=()=>h.c.confirmDeleteInvoice('I1');
  if(flow==='invoice-bulk-delete'){h.run("selectedInvoices.add('I1');");h.c.document.querySelector=()=>({value:'return'});invoke=()=>h.c.confirmBulkDeleteInvoices();}
 }else if(flow.startsWith('po')){
  h=poFixture();await h.c.savePurchaseOrder();const id=h.run('db.purchaseOrders[0].id');
  h.c.viewPurchaseOrder=()=>{};invoke=()=>flow==='po-delete'?h.c.deletePurchaseOrder(id):h.c.markPOAsPaid(id);
 }else{
  h=make();h.run("db.products=[{id:'P1',name:'A',price:100000,cost:60000,stock:10}];db.custs.push({id:'C1',name:'C1',points:0,debt:0,totalBuy:0});cust=db.custs[1];cart=[{id:'P1',name:'A',price:100000,cost:60000,qty:3}];saveCurrentTabState();");
  await h.c.directCheckout();h.run('currentReturnInvoice=db.invoices[0]');h.fields.set('return-item-P1',{checked:true});h.fields.set('return-qty-P1',{value:'1',max:'3'});h.fields.get('return-reason').value='other';
  if(flow==='return')invoke=()=>h.c.processReturn();else{await h.c.processReturn();invoke=()=>flow==='return-delete'?h.c.deleteReturn(h.run('db.returns[0].id')):h.c.performUndo();}
 }
 const before=JSON.stringify(h.run('db')),undo=JSON.stringify(h.run('undoStack'));let attempts=0;
 h.c.ntkiot.data.save=async()=>{attempts++;return {ok:false}};await invoke();
 assert.equal(attempts,1,flow);assert.equal(JSON.stringify(h.run('db')),before,flow);assert.equal(JSON.stringify(h.run('undoStack')),undo,flow);assert.equal(h.run('activeDataMutation'),null,flow);
 }
});

function editFixture(qty=3,points=0){
 const h=make();h.run(`db.products=[{id:'P1',name:'A',price:100000,cost:60000,stock:7}];db.custs=[{id:1,name:'Khách lẻ',points:0,debt:0,totalBuy:0},{id:'C1',name:'C',points:0,debt:0,totalBuy:${300000-points*1000}}];db.invoices=[{id:'I1',date:'2026-10-01T10:00:00.000Z',cust:'C',custId:'C1',items:[{id:'P1',name:'A',qty:${JSON.stringify(qty)},price:100000,cost:60000,lineTotal:300000}],subtotal:300000,discount:0,pointsUsed:${points},pointsValue:${points*1000},total:${300000-points*1000},given:${300000-points*1000},change:0}];editingInvoiceId='I1';editingInvoiceItems=JSON.parse(JSON.stringify(db.invoices[0].items));`);
 for(const [id,value] of Object.entries({'edit-inv-cust':'C1','edit-inv-discount':'0','edit-inv-note':'note'}))h.fields.set(id,{value});
 return h;
}
function poFixture(paid=false){
 const h=make();h.run("db.products=[{id:'P1',name:'A',price:100000,cost:60000,stock:10}];db.suppliers=[{id:'S1',name:'Supplier A',debt:100000}];currentPOItems=[{productId:'P1',productName:'A',qty:2,price:60000,total:120000}];");
 for(const [id,value] of Object.entries({'po-supplier':'S1','po-code':'POAUDIT','po-date':'','po-note':''}))h.fields.get(id).value=value;
 h.fields.get('po-is-paid').checked=paid;return h;
}
function initStubs(h){
 for(const n of ['renderNav','updateAuthPanel','setupAutoBackup','setupGlobalShortcuts','setupEnterKeyHandlers','setupDropdownKeyboardNav','setupPOSKeyboardNav','setupClickOutsideToClearSelection','applyViewMode','initPosResizer','populateYearOptions','showLoginModal','updateTimeOverrideBadge'])h.c[n]=()=>{};
}
test('T01: failed sale settles rollback before queued backup reads data',async()=>{
 for(const success of [false,true]){
 const h=make();h.run("db.products=[{id:'P1',name:'A',price:100000,cost:60000,stock:10}];cart=[{id:'P1',name:'A',qty:3,price:100000,cost:60000}];saveCurrentTabState();");
 let resolve,call=0,durable=plain(h.run('db'));const backups=[];
 h.c.ntkiot.data.save=text=>{h.writes.push(JSON.parse(text));if(++call===1)return new Promise(r=>resolve=r);durable=JSON.parse(text);return Promise.resolve({ok:true})};
 h.c.ntkiot.data.createBackup=async text=>{backups.push(JSON.parse(text));return {ok:true,id:'backup_fixture.json'}};
 h.c.ntkiot.data.cleanupBackups=async()=>({ok:true});h.c.ntkiot.data.listBackups=async()=>({ok:true,backups:[]});
 const sale=h.c.directCheckout();const backup=h.c.performBackup({force:true});await Promise.resolve();
 assert.equal(backups.length,0,'backup must wait for settlement');
 if(success)durable=plain(h.writes[0]);resolve({ok:success,code:'ENOSPC'});await sale;await backup;
 assert.equal(h.run('db.products[0].stock'),success?7:10);
 assert.equal(durable.invoices.length,success?1:0);assert.equal(backups[0].invoices.length,success?1:0);
 }
});
test('T02: precommit failure never publishes primary; postcommit bak failure does not roll back',async()=>{
 for(const existing of [false,true]){
 const h=makeMain({failCopy:true,files:existing?{'/ram/data.json':'{"old":1}'}:{}});
 const r=await h.write('{"new":1}');
 assert.equal(r.ok,false);assert.equal(h.files.get('/ram/data.json'),existing?'{"old":1}':undefined);
 }
 const h=makeMain({failRename:'/ram/data.json.bak'});const r=await h.write('{"new":1}');
 assert.equal(r.ok,true);assert.equal(h.files.get('/ram/data.json'),'{"new":1}');
});
test('T03: recovery rewrite precedes code migration and preserves good backup',async()=>{
 for(const withCode of [false,true]){
 const h=make();const before=plain(h.run('db'));before.users[0].code=withCode?'NV001':undefined;
 before.settings.disableLogin=false;const original=JSON.stringify(before);
 const main=makeMain({files:{'/ram/data.json':'{broken','/ram/data.json.bak':original}});
 h.c.ntkiot.auth={login:()=>{throw Error('not used during recovery')},current:()=>main.handlers.get('ntkiot:auth-current')(main.event)};
 for(const [method,channel]of Object.entries({loadPrimary:'ntkiot:data-load-primary',loadBak:'ntkiot:data-load-bak',listBackups:'ntkiot:backup-list'}))h.c.ntkiot.data[method]=()=>main.handlers.get(channel)(main.event);
 h.c.ntkiot.data.save=(text,options)=>main.handlers.get('ntkiot:data-save')(main.event,{text,...options});initStubs(h);await h.c.init();
 assert.equal(main.files.get('/ram/data.json.bak'),original);assert.ok(JSON.parse(main.files.get('/ram/data.json')).users[0].code);
 }
});
test('T04: note edit preserves points snapshot and all financial fields',async()=>{
 for(const points of [0,100]){
 const h=editFixture(3,points);h.run('db.settings.pointsValue=9000;db.settings.pointsEnabled=true;db.custs[1].points=55;');const before=plain(h.run('db.invoices[0]'));await h.c.saveEditInvoice();
 for(const key of ['total','given','change','pointsUsed','pointsValue'])assert.equal(h.run('db.invoices[0]')[key],before[key]);
 assert.equal(h.run('db.custs[1].totalBuy'),before.total);assert.equal(h.run('db.custs[1].points'),55);
 }
});
test('T05: invalid invoice quantities, prices and totals cannot persist; zero and decimal values work',async()=>{
 for(const [field,values]of Object.entries({price:['-100000','NaN','Infinity','abc',''],qty:['0','-1','NaN','Infinity','abc',''],lineTotal:['-1','NaN','Infinity']}))for(const value of values){
 const h=editFixture(),before=JSON.stringify(h.run('db'));h.c.renderEditInvoiceItems=()=>{};
 if(field==='lineTotal')h.run('editingInvoiceItems[0].lineTotal='+JSON.stringify(value));else h.c.updateEditInvoiceItem(0,field,value);
 await h.c.saveEditInvoice();assert.equal(JSON.stringify(h.run('db')),before);assert.equal(h.writes.length,0);
 }
 const h=editFixture();h.c.renderEditInvoiceItems=()=>{};h.c.updateEditInvoiceItem(0,'price','0');await h.c.saveEditInvoice();assert.equal(h.run('db.invoices[0].total'),0);
 const decimal=editFixture();decimal.c.renderEditInvoiceItems=()=>{};decimal.c.updateEditInvoiceItem(0,'qty','2.5');decimal.c.updateEditInvoiceItem(0,'price','100.000,5');await decimal.c.saveEditInvoice();
 assert.equal(decimal.run('db.invoices[0].items[0].qty'),2.5);assert.equal(decimal.run('db.invoices[0].items[0].price'),100000.5);assert.equal(decimal.run('db.invoices[0].total'),250000);assert.equal(decimal.run('db.products[0].stock'),7.5);
});
test('T06: numeric-string invoice quantities and PO drafts never concatenate stock',async()=>{
 for(const qty of [3,'3']){const h=editFixture(qty);await h.c.saveEditInvoice();assert.equal(h.run('db.products[0].stock'),7);}
 for(const qty of [2,'2']){const h=poFixture();h.run('currentPOItems[0].qty='+JSON.stringify(qty));await h.c.savePurchaseOrder();assert.equal(h.run('db.products[0].stock'),12);}
});
test('T07: duplicate product identities reject restore without changing state',async()=>{
 for(const ids of [['A','A'],[101,'101'],['001',1],['A','B']]){
 const h=make();const data=plain(h.run('db'));data.products=ids.map((id,i)=>({id,name:'Item'+i,stock:10,price:100000+i*100000}));
 h.c.FileReader=class{readAsText(file){this.onload({target:{result:file.text}})}};const file={name:'restore.json',text:JSON.stringify(data),size:100,lastModified:1};
 h.fields.get('restore-file').files=[file];h.c.prepareRestoreData(h.fields.get('restore-file'));
 const duplicate=String(ids[0])===String(ids[1]);assert.equal(h.run('restoreCandidate!==null'),!duplicate);
 const before=JSON.stringify(h.run('db'));
 assert.equal(await h.c.confirmRestoreData(),!duplicate);assert.equal(h.writes.length,duplicate?0:1);
 if(duplicate)assert.equal(JSON.stringify(h.run('db')),before);else{h.c.addCart(ids[1]);assert.equal(h.run('cart[0].id'),ids[1]);assert.equal(h.run('cart[0].price'),200000);}
 }
});
test('T08: undo is bound to canonical user and session',async()=>{
 const h=make();h.run("db.products=[{id:'P1',name:'A',stock:10}];db.users.push({id:'U2',user:'staff',pass:'fixture',name:'Staff',role:'staff'});");await h.c.delP('P1');
 h.c.showLoginModal();h.fields.get('log-u').value='staff';h.fields.get('log-p').value='fixture';h.c.login();await h.c.performUndo();assert.equal(h.run('db.products.length'),0);
 const control=make();control.run("db.products=[{id:'P1',name:'A',stock:10}];");await control.c.delP('P1');await control.c.performUndo();assert.equal(control.run('db.products.length'),1);
});
test('T09/D01-D05/D09: supplier debt follows linked purchase orders and rolls back',async()=>{
 for(const paid of [false,true]){const h=poFixture(paid);await h.c.savePurchaseOrder();assert.equal(h.run('db.suppliers[0].debt'),paid?0:120000);
 h.c.viewPurchaseOrder=()=>{};await h.c.markPOAsPaid(h.run('db.purchaseOrders[0].id'));assert.equal(h.run('db.suppliers[0].debt'),paid?120000:0);}
 const h=poFixture();h.c.ntkiot.data.save=async()=>({ok:false});await h.c.savePurchaseOrder();assert.equal(h.run('db.suppliers[0].debt'),100000);assert.equal(h.run('db.purchaseOrders.length'),0);
});
test('T10: pending return closes only its source tab',async()=>{
 for(const success of [false,true])for(const switched of [false,true]){
 const h=make();h.run("db.products=[{id:'P1',name:'A',price:100000,cost:60000,stock:10}];invoiceTabs=[{id:1,name:'Sale',cart:[{id:'P1',name:'A',qty:4,price:100000}],cust:null,discount:0,discountType:'amount',returnItems:[],exchangeItems:[]},{id:2,name:'Return',mode:'return',cart:[{id:'P1',name:'A',qty:1,price:100000}],cust:null,discount:0,discountType:'amount',returnItems:[],exchangeItems:[]}];activeTabId=2;loadTabState(2);");
 let resolve;h.c.ntkiot.data.save=()=>new Promise(r=>resolve=r);const pending=h.c.checkoutReturn();if(switched)h.c.switchTab(1);resolve({ok:success});await pending;
 assert.deepEqual(plain(h.run('invoiceTabs.map(t=>t.id)')),success?[1]:[1,2]);assert.equal(h.run('activeTabId'),success||switched?1:2);assert.equal(h.run('cart[0].qty'),success||switched?4:1);
 }
});
test('T01/R05: the quick-return delegate waits for the tab return commit',async()=>{
 const h=make();h.run("db.products=[{id:'P1',name:'A',price:100000,cost:60000,stock:10}];cart=[{id:'P1',name:'A',qty:1,price:100000}];saveCurrentTabState();invoiceTabs.find(t=>t.id===activeTabId).mode='return';");
 let resolve,settled=false;h.c.ntkiot.data.save=()=>new Promise(r=>resolve=r);
 const pending=h.c.processQuickReturn().then(()=>{settled=true});await Promise.resolve();await Promise.resolve();
 assert.equal(settled,false,'the delegate must not resolve while storage is pending');
 resolve({ok:true});await pending;assert.equal(h.run('activeDataMutation'),null);assert.equal(h.run('db.returns.length'),1);assert.equal(h.run('db.products[0].stock'),11);
});
test('T01/R05: all quick and inline return/exchange roots commit or restore linked state',async()=>{
 for(const flow of ['checkoutReturnExchange','processQuickReturnExchange','processQuickReturn'])for(const success of [false,true]){
 const h=make();h.run("db.products=[{id:'P1',name:'A',price:100000,cost:60000,stock:10}];cust=db.custs[0];");
 const item="{id:'P1',name:'A',qty:2,price:100000}";
 if(flow==='checkoutReturnExchange')h.run('returnItems=['+item+'];exchangeItems=[{id:"P1",name:"A",qty:1,price:100000}];isReturnExchangeMode=true;');
 if(flow==='processQuickReturnExchange')h.run('qrReturnItems=['+item+'];qrExchangeItems=[{id:"P1",name:"A",qty:1,price:100000}];');
 if(flow==='processQuickReturn')h.run('cart=['+item+'];isQuickReturnMode=true;');
 const before=JSON.stringify(h.run('db'));let attempts=0;h.c.ntkiot.data.save=async()=>{attempts++;return {ok:success}};
 await h.c[flow]();assert.equal(attempts,1,flow);assert.equal(h.run('activeDataMutation'),null,flow);
 if(!success)assert.equal(JSON.stringify(h.run('db')),before,flow);else{assert.equal(h.run('db.products[0].stock'),flow==='processQuickReturn'?12:11,flow);assert.equal(h.run('db.returns.length'),1,flow);assert.equal(h.run('db.stockHistory.length'),flow==='processQuickReturn'?1:2,flow);}
 }
});
test('T11: new invalid import cannot confirm the old file',async()=>{
 const h=make();h.c.FileReader=class{readAsText(file){this.onload({target:{result:file.text}})}};
 h.c.openImportModal('products');h.fields.get('import-file').files=[{name:'A.csv',text:'code,name,price,stock\nAUDIT,Product A,100000,3'}];h.c.handleImportFile();
 h.fields.get('import-file').files=[{name:'B.json',text:'{broken'}];h.c.handleImportFile();assert.equal(h.fields.get('import-confirm-btn').disabled,true);assert.equal(h.run('importedData.length'),0);
 await h.c.confirmImport();assert.equal(h.writes.length,0);
});
test('T12: note-only PO edit preserves exact instant including milliseconds',async()=>{
 const h=poFixture();h.run("db.products[0].stock=12;db.purchaseOrders=[{id:'PO1',code:'PO1',date:'2026-10-01T03:00:24.123Z',items:currentPOItems.map(i=>({...i})),totalAmount:120000,isPaid:false,supplierId:'S1'}];");
 await h.c.editPurchaseOrder('PO1');h.fields.get('po-note').value='note';await h.c.savePurchaseOrder();assert.equal(h.run('db.purchaseOrders[0].date'),'2026-10-01T03:00:24.123Z');
});
test('T13: startup applies enabled offset before settings is opened',async()=>{
 const h=make();const data=plain(h.run('db'));data.settings.timeOffset=86400000;data.settings.timeOverrideEnabled=true;
 h.c.ntkiot.data.loadPrimary=async()=>({ok:true,primary:{exists:true,text:JSON.stringify(data)}});initStubs(h);await h.c.init();assert.equal(h.run('timeOffset'),86400000);
 h.c.loadSets();assert.equal(h.run('timeOffset'),86400000);
});
test('T14: all three keyboard dropdowns preserve numeric and string IDs',()=>{
 for(const id of [101,'101','SKU-A',"SKU-'A"]){
 for(const [inputId,listId,handler,result] of [['po-product-search','po-product-list','addProductToPO','currentPOItems.length'],['si-product-search','si-product-list','selectStockInProduct',"$('si-product').value"],['so-product-search','so-product-list','selectStockOutProduct',"$('so-product').value"]]){
 const h=make();h.run('db.products=[{id:'+JSON.stringify(id)+",name:'A',stock:10,price:100000,cost:60000}];");
 h.c.document.activeElement=h.fields.get(inputId);const list=h.fields.get(listId);list.style.display='block';
 list.querySelectorAll=()=>[{getAttribute:name=>name==='data-product-id'?String(id):handler+'('+JSON.stringify(id)+')',setAttribute(){},scrollIntoView(){}}];
 h.c.setupDropdownKeyboardNav();const listener=h.events.at(-1)[1];for(const key of ['ArrowDown','Enter'])listener({key,preventDefault(){}});
 assert.equal(h.run(result),handler==='addProductToPO'?1:String(id));
 }
 }
});
test('T15: backup read errors propagate and never trigger cleanup',async()=>{
 const empty=makeMain();assert.equal((await empty.handlers.get('ntkiot:backup-list')(empty.event)).ok,true);
 const missing=makeMain({readdirError:'ENOENT'});assert.equal((await missing.handlers.get('ntkiot:backup-list')(missing.event)).ok,true);
 for(const failure of [{failReaddir:true},{readdirError:'EIO'},{statErrorPath:'/ram/backups/backup_old.json'}]){
 const denied=makeMain({...failure,files:{'/ram/backups/backup_old.json':'{"retained":1}'}});assert.equal((await denied.handlers.get('ntkiot:backup-list')(denied.event)).ok,false);
 assert.equal((await denied.handlers.get('ntkiot:backup-cleanup')(denied.event)).ok,false);assert.equal(denied.operations.length,0);assert.equal(denied.files.get('/ram/backups/backup_old.json'),'{"retained":1}');
 const h=make();let cleanupCalls=0;h.c.ntkiot.data.listBackups=()=>denied.handlers.get('ntkiot:backup-list')(denied.event);
 h.c.ntkiot.data.cleanupBackups=async()=>{cleanupCalls++;return {ok:true}};
 await h.c.updateBackupStats();assert.equal(h.fields.get('backup-stats').innerText,'Không thể đọc thông tin backup.');await h.c.cleanupBackupsNow();assert.equal(cleanupCalls,0);
 }
});
test("R02/R05/R06/R11/R13: independently reconciled sale-return-undo lifecycle", async()=>{
const h=make();const steps=[];h.run("const auditEpoch=Date.now();let auditTick=0;Date.now=()=>auditEpoch+(auditTick++);db.products=[{id:'P1',name:'A',price:100000,cost:60000,stock:10}];db.custs=[{id:1,name:'Khách lẻ',points:0,debt:0,totalBuy:0},{id:'C1',name:'C1',points:0,debt:0,totalBuy:0}];cust=db.custs[1];cart=[{id:'P1',name:'A',price:100000,cost:60000,qty:3}];saveCurrentTabState();");h.fields.get('cart-cust').value='C1';
 function state(step){const r=plain(h.run("({stock:db.products[0].stock,invoices:db.invoices.length,returns:db.returns.length,totalBuy:db.custs[1].totalBuy})"));steps.push({step,...r});return r}
 await h.c.directCheckout();assert.deepEqual(state('sell-3'),{stock:7,invoices:1,returns:0,totalBuy:300000});
 const invoiceId=h.run('db.invoices[0].id');
 h.fields.set('return-item-P1',{checked:true});h.fields.set('return-qty-P1',{value:'1',max:'3'});h.fields.get('return-reason').value='other';h.run('currentReturnInvoice=db.invoices[0]');await h.c.processReturn();assert.deepEqual(state('return-1'),{stock:8,invoices:1,returns:1,totalBuy:200000});assert.equal(h.run('getOutstandingInvoiceItems(db.invoices[0])[0].qty'),2);
 h.fields.get('return-qty-P1').value='2';h.fields.get('return-qty-P1').max='2';h.run('currentReturnInvoice=db.invoices[0]');await h.c.processReturn();assert.deepEqual(state('return-remaining-2'),{stock:10,invoices:0,returns:2,totalBuy:0});
 const reconciliation=h.c.getManagementReportReconciliation(h.run('db.invoices'),h.run('db.returns'),new Date(0),new Date('2100-01-01'));assert.equal(reconciliation.netCash,0);assert.equal(reconciliation.grossSales,300000);assert.equal(reconciliation.refunds,300000);
 await h.c.performUndo();assert.deepEqual(state('undo-full-return'),{stock:8,invoices:1,returns:1,totalBuy:200000});
 await h.c.deleteReturn(h.run('db.returns[0].id'));assert.deepEqual(state('delete-partial-return'),{stock:7,invoices:1,returns:0,totalBuy:300000});
 await h.c.confirmDeleteInvoice(invoiceId);assert.deepEqual(state('delete-invoice'),{stock:10,invoices:0,returns:0,totalBuy:0});
 await h.c.performUndo();assert.deepEqual(state('undo-invoice-delete'),{stock:7,invoices:1,returns:0,totalBuy:300000});
 
});
test("R09/R11: inventory and customer debt commit/failure fixtures", async()=>{
const out=[];
for(const success of [false,true]){
 for(const flow of ['in','out','check','debt-pay','debt-add']){
 const h=make();h.run("db.products=[{id:'P1',name:'A',stock:10,price:100000,cost:60000}];db.custs.push({id:'C1',name:'C',points:0,totalBuy:0,debt:200000});");
 h.c.ntkiot.data.save=async text=>{h.writes.push(JSON.parse(text));return {ok:success}};
 let expectedStock=10,expectedDebt=200000;
 if(flow==='in'){for(const [id,value]of Object.entries({'si-product':'P1','si-qty':'2','si-price':'60000','si-note':'Test'}))h.fields.get(id).value=value;expectedStock=12;await h.c.saveStockIn();}
 if(flow==='out'){for(const [id,value]of Object.entries({'so-product':'P1','so-qty':'2','so-note':'Test','so-reason':'other'}))h.fields.get(id).value=value;expectedStock=8;await h.c.saveStockOut();}
 if(flow==='check'){h.run("inventoryCheckData={'P1':{systemStock:10,actualStock:8,diff:-2}};");h.fields.get('ic-note').value='Test';expectedStock=8;await h.c.saveInventoryCheck();}
 if(flow.startsWith('debt')){for(const [id,value]of Object.entries({'debt-cust-id':'C1','debt-type':flow==='debt-pay'?'pay':'add','debt-amount':'50000','debt-note':'Test'}))h.fields.get(id).value=value;expectedDebt=flow==='debt-pay'?150000:250000;await h.c.saveDebt();}
 assert.equal(h.run('db.products[0].stock'),success?expectedStock:10);assert.equal(h.run('db.custs[1].debt'),success?expectedDebt:200000);
 if(!success){assert.equal(h.run('db.stockHistory.length'),0);assert.equal(h.run('db.activityLog.length'),0);}
 if(success&&flow==='check'){assert.equal(h.run('db.stockHistory[0].qty'),2);assert.equal(h.writes[0].stockHistory[0].diff,-2);}assert.equal(h.writes.length,1);out.push({flow,success,stock:h.run('db.products[0].stock'),debt:h.run('db.custs[1].debt'),stockRecords:h.run('db.stockHistory.length'),writes:1});
 }
}

});

// B01–B04: full production source, independent balances, and real awaited saves.
function customerFixFixture(id=0,seed=1){
 const h=make();h.c.fixtureCustomerId=id;h.c.fixtureSeed=seed;
 h.run(`db.settings.pointsEnabled=true;db.settings.pointsRate=1;db.settings.pointsValue=1000;
 db.products=[{id:'P'+fixtureSeed,name:'Cà phê '+fixtureSeed,price:25000,cost:7000,stock:20,wholesalePrice:18000,minWholesaleQty:10}];
 db.custs=[{id:1,name:'Khách lẻ',points:0,totalBuy:0,debt:0},{id:fixtureCustomerId,name:'Khách '+fixtureSeed,points:100,totalBuy:0,debt:0,customerType:'retail'}];
 cust=db.custs[1];cart=[{...db.products[0],qty:1}];saveCurrentTabState();`);
 h.fields.get('cart-cust').value='Khách '+seed;
 for(const field of ['edit-inv-cust','edit-inv-discount','edit-inv-note'])h.fields.set(field,{value:''});return h;
}
function customerFixBalance(h){return plain(h.run('({stock:db.products[0].stock,points:db.custs[1].points,totalBuy:db.custs[1].totalBuy,debt:db.custs[1].debt,invoices:db.invoices.length,returns:db.returns.length})'));}
for(const seed of [1,2]){
 test(`B01/R01-${seed}: a duplicate-name draft keeps the selected wholesale ID`,async()=>{
  const h=customerFixFixture('first-'+seed,seed);
  h.run(`db.custs.push({...db.custs[1],id:'second-'+fixtureSeed,points:500,customerType:'wholesale'});cust={...db.custs[2]};
  db.drafts.invoices=[{id:'D'+fixtureSeed,type:'invoices',data:{items:cart.map(x=>({...x})),customer:{...cust}}}];saveCurrentTabState();invoiceTabs.find(t=>t.id===activeTabId).draftId='D'+fixtureSeed;`);
  await h.c.directCheckout();
  assert.equal(h.run('db.invoices[0].custId'),'second-'+seed);assert.equal(h.run('db.invoices[0].total'),18000);
  assert.deepEqual(plain(h.run('db.custs.slice(1).map(c=>[c.points,c.totalBuy])')),[[100,0],[680,18000]]);
  assert.equal(h.run('db.products[0].stock'),19);assert.equal(h.run('db.drafts.invoices.length'),0);
  assert.equal(h.writes.length,2);assert.equal(h.writes[0].invoices[0].custId,'second-'+seed);
  assert.equal(h.writes[0].drafts.invoices.length,1);assert.equal(h.writes[1].drafts.invoices.length,0);
 });
 test(`B01/R02-${seed}: ambiguous names block every payment root, including muted notifications`,async()=>{
  for(const entry of ['directCheckout','openPayment','finishOrder'])for(const mode of ['sale','return','exchange']){
   const h=customerFixFixture('first-'+seed,seed);
   h.run(`db.custs.push({...db.custs[1],id:'second-'+fixtureSeed});cust=null;window.orderNote='giữ ghi chú';saveCurrentTabState();
   db.drafts.invoices=[{id:'D'+fixtureSeed,type:'invoices',data:{items:cart.map(x=>({...x}))}}];invoiceTabs.find(t=>t.id===activeTabId).draftId='D'+fixtureSeed;`);
   h.fields.get('cart-discount').value='1000';h.fields.get('order-note').value='giữ ghi chú';
   if(mode==='return')h.run("invoiceTabs.find(t=>t.id===activeTabId).mode='return'");
   if(mode==='exchange')h.run('isReturnExchangeMode=true;returnItems=cart.map(x=>({...x}));exchangeItems=cart.map(x=>({...x}));');
   const before=JSON.stringify(h.run('db')),items=JSON.stringify(h.run('cart'));h.c.toast=()=>{};
   let opened=false;h.fields.get('pay-modal').classList.add=()=>{opened=true};await h.c[entry]();
   assert.equal(JSON.stringify(h.run('db')),before,entry+' '+mode);assert.equal(JSON.stringify(h.run('cart')),items);
   assert.equal(h.fields.get('cart-cust').value,'Khách '+seed);assert.equal(h.fields.get('cart-discount').value,'1000');
   assert.equal(h.c.window.orderNote,'giữ ghi chú');assert.equal(h.run('invoiceTabs.find(t=>t.id===activeTabId).draftId'),'D'+seed);
   assert.equal(h.writes.length,0);assert.equal(opened,false);assert.equal(h.run('activeDataMutation'),null);
  }
 });
 test(`B01/R03-${seed}: ID references survive same-name rename/delete/capture without crossing tabs`,()=>{
  for(const action of ['refresh','capture','clear']){
   const h=customerFixFixture('first-'+seed,seed);
   h.run(`db.custs.push({...db.custs[1],id:'second-'+fixtureSeed});cust={...db.custs[2]};
   invoiceTabs=[{id:1,cust:{...db.custs[1]}},{id:2,cust:{...db.custs[2]}}];activeTabId=2;`);
   if(action==='refresh'){h.run("db.custs[1].name='Tên mới';refreshCustomerReferences(db.custs[1],'Khách '+fixtureSeed)");assert.equal(h.run('invoiceTabs[0].cust.name'),'Tên mới');}
   if(action==='capture'){const refs=plain(h.c.captureDeletedCustomerReferences('first-'+seed,'Khách '+seed));assert.equal(refs.activeCustomer,null);assert.deepEqual(refs.tabs.map(x=>x.tabId),[1]);}
   if(action==='clear'){h.run("db.custs.splice(1,1);clearDeletedCustomerReferences('first-'+fixtureSeed,'Khách '+fixtureSeed)");assert.equal(h.run('invoiceTabs[0].cust'),null);}
   assert.equal(h.run('cust.id'),'second-'+seed);assert.equal(h.run('invoiceTabs[1].cust.id'),'second-'+seed);assert.equal(h.fields.get('cart-cust').value,'Khách '+seed);
  }
  const h=customerFixFixture('unique-'+seed,seed);h.run('cust={id:null,name:db.custs[1].name};invoiceTabs=[{id:1,cust:{...cust}}];db.custs[1].name="Đổi tên";');
  h.c.refreshCustomerReferences(h.run('db.custs[1]'),'Khách '+seed);assert.equal(h.run('cust.id'),'unique-'+seed);
 });
 test(`B01/R03-${seed}: changed input resolves a unique name; free text cannot alias real customer zero`,async()=>{
  const h=customerFixFixture(0,seed);h.run("db.custs.push({id:'other',name:'Khách khác',points:500,totalBuy:0,debt:0});");
  h.fields.get('cart-cust').value='Khách khác';h.c.syncCustomerFromInput(false);assert.equal(h.run('cust.id'),'other');
  h.fields.get('cart-cust').value='Khách chưa lưu';h.c.syncCustomerFromInput(false);assert.equal(h.run('cust.id'),null);
  await h.c.directCheckout();assert.equal(h.run('db.invoices[0].custId'),null);assert.equal(h.run('db.invoices[0].cust'),'Khách chưa lưu');
  assert.deepEqual(plain(h.run('db.custs.slice(1).map(c=>[c.points,c.totalBuy])')),[[100,0],[500,0]]);
  h.fields.get('cart-cust').value='';h.c.syncCustomerFromInput(false);assert.equal(h.run('cust.id'),1);
 });
 test(`B01/R03-${seed}: real quick-add and delete/undo preserve the other same-name customer`,async()=>{
  const h=customerFixFixture('first-'+seed,seed);
  h.run(`db.custs.push({...db.custs[1],id:'second-'+fixtureSeed});cust={...db.custs[2]};
  invoiceTabs=[{...invoiceTabs[0],id:10,cust:{...db.custs[1]}},{...invoiceTabs[0],id:20,cust:{...db.custs[2]}}];activeTabId=20;`);
  await h.c.delCust('first-'+seed);assert.equal(h.run('cust.id'),'second-'+seed);assert.equal(h.run('invoiceTabs[0].cust'),null);
  await h.c.performUndo();assert.equal(h.run('invoiceTabs[0].cust.id'),'first-'+seed);assert.equal(h.run('cust.id'),'second-'+seed);
  const other=JSON.stringify(h.run('invoiceTabs[0]'));h.c.openCustModal(true);h.fields.get('c-name').value='Khách '+seed;h.fields.get('c-customer-type').value='wholesale';await h.c.saveCust();
  const newId=h.run('cust.id');assert.notEqual(newId,'first-'+seed);assert.notEqual(newId,'second-'+seed);
  h.c.syncCustomerFromInput(false);assert.equal(h.run('cust.id'),newId);assert.equal(JSON.stringify(h.run('invoiceTabs[0]')),other);
  await h.c.directCheckout();assert.equal(h.run('db.invoices[0].custId'),newId);assert.equal(h.run('db.invoices[0].total'),18000);
 });
 for(const id of [0,'0','regular-'+seed]){
  const tag=typeof id+':'+id;
  test(`B02/R04-${seed}-${tag}: spending ten points commits 15000 and balance 240`,async()=>{
   const h=customerFixFixture(id,seed);h.fields.get('cart-use-points').checked=true;h.fields.get('cart-points-input').value='10';
   await h.c.directCheckout();assert.equal(h.run('db.invoices[0].custId'),id);assert.equal(h.run('db.invoices[0].pointsUsed'),10);
   assert.deepEqual(customerFixBalance(h),{stock:19,points:240,totalBuy:15000,debt:0,invoices:1,returns:0});
   assert.equal(h.writes[0].custs[1].points,240);
  });
  test(`B02/R05-${seed}-${tag}: partial/full returns, deletion and undo reconcile persisted balances`,async()=>{
   const h=customerFixFixture(id,seed);await h.c.directCheckout();
   assert.deepEqual(customerFixBalance(h),{stock:19,points:350,totalBuy:25000,debt:0,invoices:1,returns:0});
   const pid='P'+seed;h.fields.set('return-item-'+pid,{checked:true});h.fields.set('return-qty-'+pid,{value:'.5',max:'1'});h.fields.get('return-reason').value='other';h.run('currentReturnInvoice=db.invoices[0]');
   await h.c.processReturn();assert.equal(h.run('db.custs[1].totalBuy'),12500);assert.equal(h.run('db.custs[1].points'),225);
   await h.c.deleteReturn(h.run('db.returns[0].id'));assert.equal(h.run('db.custs[1].points'),350);assert.equal(h.run('db.custs[1].totalBuy'),25000);
   h.fields.get('return-qty-'+pid).value='1';h.run('currentReturnInvoice=db.invoices[0]');await h.c.processReturn();
   assert.deepEqual(customerFixBalance(h),{stock:20,points:100,totalBuy:0,debt:0,invoices:0,returns:1});
   await h.c.performUndo();assert.deepEqual(customerFixBalance(h),{stock:19,points:350,totalBuy:25000,debt:0,invoices:1,returns:0});
   assert.equal(h.writes.at(-1).custs[1].points,350);
  });
  test(`B02/R06-${seed}-${tag}: edit same customer, transfer, delete and undo apply effects once`,async()=>{
   const h=customerFixFixture(id,seed);await h.c.directCheckout();const invoiceId=h.run('db.invoices[0].id');
   h.run('editingInvoiceId=db.invoices[0].id;editingInvoiceItems=db.invoices[0].items.map(x=>({...x,qty:2,lineTotal:50000}));');
   for(const [field,value]of Object.entries({'edit-inv-cust':String(id),'edit-inv-discount':'0','edit-inv-note':'sửa'}))h.fields.get(field).value=value;
   await h.c.saveEditInvoice();assert.deepEqual(customerFixBalance(h),{stock:18,points:600,totalBuy:50000,debt:0,invoices:1,returns:0});
   h.run("db.custs.push({id:'other',name:'Khách khác',points:500,totalBuy:0,debt:0});editingInvoiceId=db.invoices[0].id;editingInvoiceItems=db.invoices[0].items.map(x=>({...x}));");h.fields.get('edit-inv-cust').value='other';await h.c.saveEditInvoice();
   assert.equal(h.run('db.custs[1].points'),100);assert.equal(h.run('db.custs[1].totalBuy'),0);assert.equal(h.run('db.custs[2].points'),1000);assert.equal(h.run('db.custs[2].totalBuy'),50000);
   await h.c.confirmDeleteInvoice(invoiceId);assert.equal(h.run('db.products[0].stock'),20);assert.equal(h.run('db.custs[2].points'),500);
   await h.c.performUndo();assert.equal(h.run('db.products[0].stock'),18);assert.equal(h.run('db.custs[2].points'),1000);
   h.run('db.invoices[0].custId=fixtureCustomerId;db.custs[1].points=600;db.custs[1].totalBuy=50000;');
   await h.c.confirmDeleteInvoice(invoiceId);assert.equal(h.run('db.custs[1].points'),100);assert.equal(h.run('db.custs[1].totalBuy'),0);
   await h.c.performUndo();assert.equal(h.run('db.custs[1].points'),600);assert.equal(h.run('db.custs[1].totalBuy'),50000);
  });
  test(`B02/R06-${seed}-${tag}: note-only legacy invoice with missing points snapshot stays nonfinancial`,()=>{
   const h=customerFixFixture(id,seed);h.run("db.invoices=[{id:'legacy',custId:fixtureCustomerId,items:cart.map(x=>({...x,lineTotal:25000})),total:15000,discount:0,pointsUsed:10}];editingInvoiceItems=db.invoices[0].items.map(x=>({...x}));");
   h.fields.get('edit-inv-cust').value=String(id);h.fields.get('edit-inv-discount').value='0';assert.equal(h.c.getEditedInvoiceTotals(h.run('db.invoices[0]')).financialChange,false);
  });
  test(`B02/R07-${seed}-${tag}: all quick/tab/inline record roots preserve the stored ID`,async()=>{
   for(const flow of ['checkoutReturn','checkoutReturnExchange','processQuickReturnExchange','processQuickReturn']){
    const h=customerFixFixture(id,seed);
    if(flow==='checkoutReturn')h.run("invoiceTabs.find(t=>t.id===activeTabId).mode='return'");
    if(flow==='checkoutReturnExchange')h.run('returnItems=cart.map(x=>({...x}));exchangeItems=[];isReturnExchangeMode=true;');
    if(flow==='processQuickReturnExchange')h.run('qrReturnItems=cart.map(x=>({...x}));qrExchangeItems=[];cart=[];');
    if(flow==='processQuickReturn')h.run('isQuickReturnMode=true;');
    await h.c[flow]();assert.equal(h.run('getReturnCustomerId(db.returns[0])'),id,flow);assert.equal(h.writes.length,1,flow);
   }
  });
  test(`B02/R07-${seed}-${tag}: saved actual effects take precedence; legacy quick effects use nullish ID`,()=>{
   const h=customerFixFixture(id,seed);h.run('db.custs[1].points=350;db.custs[1].totalBuy=25000;');
   const linked={invoiceId:'I',custId:id,returnTotal:25000,exchangeTotal:0};
   assert.equal(h.c.applyLinkedReturnCustomerEffects(linked),true);assert.deepEqual(plain(linked.customerEffects),{customerId:id,pointsDelta:-250,totalBuyDelta:-25000});
   h.c.restoreCustomerPointsAfterUndoReturn(linked);assert.equal(h.run('db.custs[1].points'),350);assert.equal(h.run('db.custs[1].totalBuy'),25000);
   const quick={custId:id,customerId:'other',returnTotal:25000};quick.pointsReversed=h.c.reverseQuickReturnCustomerPoints(quick);assert.equal(quick.pointsReversed,250);
   h.c.restoreCustomerPointsAfterUndoReturn(quick);assert.equal(h.run('db.custs[1].points'),350);
   h.run('db.custs[1].points=5;');const clipped={invoiceId:'I',custId:id,returnTotal:25000};h.c.applyLinkedReturnCustomerEffects(clipped);assert.equal(clipped.customerEffects.pointsDelta,-5);
   h.c.restoreCustomerPointsAfterUndoReturn(clipped);assert.equal(h.run('db.custs[1].points'),5);
  });
  for(const operation of ['recordReturnCustomerEffects','restoreStoredReturnCustomerEffects','applyLinkedReturnCustomerEffects','reverseInvoiceCustomerEffects','reapplyInvoiceCustomerEffects','reverseQuickReturnCustomerPoints','restoreCustomerPointsAfterUndoReturn']){
   test(`B02/isolated-${seed}-${tag}-${operation}: each affected entry preserves the ID and balance`,()=>{
    const h=customerFixFixture(id,seed);h.run('db.custs[1].points=350;db.custs[1].totalBuy=25000;');
    const record={invoiceId:'I',custId:id,customerId:'unrelated',returnTotal:25000};let points=100,totalBuy=25000;
    if(operation==='recordReturnCustomerEffects')assert.equal(h.c[operation](record,c=>{c.points-=250}),true);
    if(operation==='restoreStoredReturnCustomerEffects'){record.customerEffects={customerId:id,pointsDelta:-5,totalBuyDelta:-7000};assert.equal(h.c[operation](record),true);points=355;totalBuy=32000;}
    if(operation==='applyLinkedReturnCustomerEffects'){assert.equal(h.c[operation](record),true);totalBuy=0;}
    if(operation==='reverseInvoiceCustomerEffects'){h.c[operation]({custId:id,total:25000});totalBuy=0;}
    if(operation==='reapplyInvoiceCustomerEffects'){h.c[operation]({custId:id,total:25000});points=600;totalBuy=50000;}
    if(operation==='reverseQuickReturnCustomerPoints')assert.equal(h.c[operation](record),250);
    if(operation==='restoreCustomerPointsAfterUndoReturn'){delete record.invoiceId;record.pointsReversed=250;h.c[operation](record);points=600;}
    assert.equal(h.run('db.custs[1].points'),points);assert.equal(h.run('db.custs[1].totalBuy'),totalBuy);
   });
  }
  test(`B01/B02/R08-${seed}-${tag}: deferred save failure rolls back linked data and keeps source draft`,async()=>{
   const h=customerFixFixture(id,seed);h.run("db.drafts.invoices=[{id:'D',type:'invoices',data:{items:cart.map(x=>({...x}))}}];invoiceTabs.find(t=>t.id===activeTabId).draftId='D';");
   const before=JSON.stringify(h.run('db'));let resolve,attempts=0;h.c.ntkiot.data.save=()=>{attempts++;return new Promise(r=>resolve=r)};
   const pending=h.c.directCheckout();await h.c.directCheckout();assert.equal(attempts,1);resolve({ok:false});await pending;
   assert.equal(JSON.stringify(h.run('db')),before);assert.equal(h.run('cart.length'),1);assert.equal(h.run('invoiceTabs.find(t=>t.id===activeTabId).draftId'),'D');
  });
 }
 test(`B02/R04-${seed}: default and missing customers cannot receive financial effects`,()=>{
  for(const id of [1,'1',null,undefined]){
   const h=customerFixFixture(0,seed);h.run('db.custs[0].points=500;db.custs[0].totalBuy=25000;');const before=JSON.stringify(h.run('db.custs'));
   h.c.applyLinkedReturnCustomerEffects({invoiceId:'I',custId:id,returnTotal:25000});h.c.reverseQuickReturnCustomerPoints({custId:id,returnTotal:25000});
   h.c.reverseInvoiceCustomerEffects({custId:id,total:25000});h.c.reapplyInvoiceCustomerEffects({custId:id,total:25000});assert.equal(JSON.stringify(h.run('db.custs')),before);
  }
  const data=plain(require('../data-model').defaults);data.custs.push({id:0,name:'A'},{id:'0',name:'B'});assert.throws(()=>require('../data-model').validate(data),/trùng/);
 });
 test(`B04/R10-${seed}: numeric, zero, string and escaped IDs produce one log and closable preview`,()=>{
  for(const id of [9000+seed,0,'0','INV-'+seed,'<>&"\'']){
   const h=customerFixFixture(0,seed);let written='';const print={onclick:null},close={onclick:null};
   const frame={style:{},contentDocument:{open(){},write(text){written=text},close(){},addEventListener(){},removeEventListener(){},getElementById:id=>id==='close-btn'?close:print},contentWindow:{print(){throw Error('PHYSICAL_PRINT_PROHIBITED')}}};
   h.fields.set('invoice-pdf-print-iframe',frame);h.c.invoiceFixtureId=id;
   h.run("db.invoices=[{id:invoiceFixtureId,date:'2026-10-01T00:00:00.000Z',cust:'Khách <script>',staff:'Staff',items:cart.map(x=>({...x,lineTotal:25000})),total:25000,subtotal:25000,discount:0,method:'CASH'}];currentInvoice=null;");
   const escapedId=String(id).slice(-6).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
   h.c.exportInvoicePDF(id);assert.ok(written.includes('25.000'));assert.ok(written.includes(escapedId));assert.equal(written.includes('Khách <script>'),false);
   const log=plain(h.run("db.activityLog.filter(x=>x.action==='Xuất PDF')"));assert.equal(log.length,1);assert.equal(log[0].detail,'Hóa đơn #'+String(id).slice(-6));
   for(const timer of h.timers.filter(t=>t.ms===100))timer.fn();assert.equal(typeof close.onclick,'function');close.onclick();assert.equal(frame.style.display,'none');
  }
 });
}

// Optional, reproducible before/after measurements. No files or operating data are written.
// NTKIOT_BENCHMARK_BASELINE=/absolute/original/script.js node --expose-gc --test --test-name-pattern=F4 tests/verified-bugs.test.js
if(process.env.NTKIOT_BENCHMARK_BASELINE)test('F4: before/after RAM performance and retained heap',async()=>{
 assert.equal(typeof global.gc,'function','run with --expose-gc');
 const original=fs.readFileSync(process.env.NTKIOT_BENCHMARK_BASELINE,'utf8'),rows=[];
 const median=values=>values.sort((a,b)=>a-b)[2];
 async function measure(text,n,label){
  const h=make(text);h.c.ntkiot.data.save=async()=>({ok:true});
  const products=Array.from({length:n},(_,i)=>({id:'P'+i,name:'Sản phẩm '+i,code:'SKU'+i,stock:10,price:100000,cost:60000}));
  const invoices=Array.from({length:n},(_,i)=>({id:'I'+i,date:'2026-10-01T03:00:00.000Z',staff:'NV001_Audit',total:200000,items:[{id:'P'+i,name:'Sản phẩm '+i,qty:2,price:100000,cost:60000,lineTotal:200000}]}));
  h.c.productsFixture=products;h.c.invoiceFixture=invoices;h.run('db.products=productsFixture;db.invoices=invoiceFixture.slice();');
  const operations={
   analysis:()=>{const result=h.c.analyzeInvoices(invoices);assert.equal(result.totalCost,n*120000)},
   productFilterSort:()=>assert.equal(h.c.applyProductFilters(products,{search:'Sản phẩm',priceMin:null,priceMax:null,sort:'name_asc'}).length,n),
   historySort:()=>assert.equal(h.c.getSortedHistoryEntries(invoices,'sales').length,n),
   reconciliation:()=>assert.equal(h.c.getManagementReportReconciliation(invoices,[],new Date('2026-01-01'),new Date('2027-01-01')).netCash,n*200000),
   checkout:async()=>{
    h.run("db.products[0].stock=10;db.invoices=invoiceFixture.slice();cart=[{id:'P0',name:'Sản phẩm 0',qty:1,price:100000,cost:60000}];saveCurrentTabState();");
    await h.c.directCheckout();assert.equal(h.run('db.products[0].stock'),9);assert.equal(h.run('db.invoices.length'),n+1);
   }
  };
  const fn=operations[label];await fn();global.gc();const base=process.memoryUsage().heapUsed,times=[],heap=[];
  for(let i=0;i<5;i++){const start=performance.now();await fn();times.push(performance.now()-start);global.gc();heap.push((process.memoryUsage().heapUsed-base)/1024/1024);}
  return {medianMs:median(times),retainedMB:median(heap)};
 }
 const breaches=(before,after)=>after.medianMs>=before.medianMs*1.2&&after.medianMs-before.medianMs>=5||after.retainedMB>=before.retainedMB*1.2&&after.retainedMB-before.retainedMB>=5;
 for(const n of [100,1000,10000])for(const label of ['analysis','productFilterSort','historySort','reconciliation','checkout']){
  const before=await measure(original,n,label),after=await measure(source,n,label);const row={n,label,before,after};
  if(breaches(before,after)){row.repeat={before:await measure(original,n,label),after:await measure(source,n,label)};assert.equal(breaches(row.repeat.before,row.repeat.after),false,JSON.stringify(row));}
  rows.push(row);
 }
 console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,cpu:require('node:os').cpus()[0].model,warmup:1,repetitions:5,rows}));
});

// B05: keep product navigation local to the visible POS; native button
// activation is verified separately with real Electron keyboard events.
function keyboardFixture(visible) {
 const h=make(),grid=h.fields.get('pos-grid'),search=h.fields.get('pos-search');
 let focused=0,selected=0;
 grid.offsetParent=visible?{}:null;grid.offsetHeight=visible?300:0;
 grid.querySelectorAll=()=>[];
 search.focus=()=>focused++;search.select=()=>selected++;
 const event=(key,tagName='BUTTON')=>({key,target:{tagName,id:'settings-toggle',closest:()=>null},
  ctrlKey:false,altKey:false,shiftKey:false,metaKey:false,defaultPrevented:false,
  preventDefault(){this.defaultPrevented=true},stopPropagation(){this.propagationStopped=true}});
 return {...h,event,focused:()=>focused,selected:()=>selected};
}
for(const key of ['Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown']) {
 test(`B05: hidden POS must not consume ${key} or steal native control focus`,()=>{
  const h=keyboardFixture(false),e=h.event(key),before=JSON.stringify(h.run('({db,cart,invoiceTabs})'));
  // Cards still exist in the hidden DOM: Home/End must not change selection.
  const card={getAttribute:()=> 'P-HIDDEN',setAttribute(){},classList:{remove(){}},scrollIntoView(){}};
  h.fields.get('pos-grid').querySelectorAll=()=>[card];
  h.run('posSelectedIndex=-1;posSelectedProductId=null;');
  h.c.handleKeyboardNav(e);
  assert.equal(e.defaultPrevented,false);assert.equal(h.focused(),0);
  assert.equal(h.run('posSelectedIndex'),-1);assert.equal(h.run('posSelectedProductId'),null);
  assert.equal(JSON.stringify(h.run('({db,cart,invoiceTabs})')),before);assert.equal(h.writes.length,0);
 });
}

test('UI-03: an active modal consumes F4 before either checkout handler can mutate the sale',()=>{
 const h=make();h.run('checkoutCount=0;directCheckout=()=>{checkoutCount++}');
 const modal={id:'cust-modal',classList:{contains:name=>name==='active'}};
 h.c.document.querySelectorAll=selector=>selector==='.modal-overlay.active, #quick-edit-product-popup.active'?[modal]:[];
 const event={key:'F4',ctrlKey:false,altKey:false,preventDefault(){this.defaultPrevented=true},stopPropagation(){this.stopped=true}};
 h.c.handleGlobalShortcuts(event);
 assert.equal(h.run('checkoutCount'),0);assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);
});

test('UI-05: a closed keyboard-help modal is reopened without adding a duplicate',()=>{
 const h=make();let active=false,closed=0;
 h.fields.set('keyboard-help-modal',{classList:{contains:name=>name==='active'&&active,add:name=>{if(name==='active')active=true}}});
 h.c.closeModal=()=>{closed++;active=false};
 h.c.showKeyboardShortcutsHelp();assert.equal(active,true);assert.equal(closed,0);
 h.c.showKeyboardShortcutsHelp();assert.equal(active,false);assert.equal(closed,1);
});

test('UI-04: one shared focus manager selects the highest active modal once',()=>{
 const h=make(),under={id:'under',style:{},hidden:false,classList:{contains:name=>name==='active'},contains:()=>false},top={id:'top',style:{},hidden:false,classList:{contains:name=>name==='active'},contains:()=>false};
 h.c.document.querySelectorAll=selector=>selector==='.modal-overlay.active, #quick-edit-product-popup.active'?[under,top]:[];
 h.c.getComputedStyle=element=>({zIndex:element===top?'900':'500',display:'block',visibility:'visible'});
 assert.equal(h.c.getTopActiveModal(),top);
 const before=h.events.length;h.c.initModalFocusManagement();h.c.initModalFocusManagement();
 assert.deepEqual(h.events.slice(before).filter(([type])=>type==='keydown'||type==='focusin').map(([type])=>type),['keydown','focusin']);
});
for(const tagName of ['INPUT','TEXTAREA','SELECT']) {
 test(`B05: ${tagName} retains Enter handling on visible POS`,()=>{
  const h=keyboardFixture(true),e=h.event('Enter',tagName);
  h.c.handleKeyboardNav(e);assert.equal(e.defaultPrevented,false);assert.equal(h.focused(),0);assert.equal(h.writes.length,0);
 });
}
test('B05: visible POS still routes Enter to the existing search handler',()=>{
 const h=keyboardFixture(true),e=h.event('Enter','DIV');h.c.handleKeyboardNav(e);
 assert.equal(e.defaultPrevented,true);assert.equal(e.propagationStopped,true);assert.equal(h.focused(),1);assert.equal(h.writes.length,0);
});
test('AUDIT-A04: focused POS buttons and nested interactive targets retain native Enter/arrows',()=>{
 for(const key of ['Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'])for(const nested of [false,true]){
  const h=keyboardFixture(true),e=h.event(key,nested?'SPAN':'BUTTON');
  if(nested)e.target.closest=()=>({tagName:'BUTTON'});
  h.c.handleKeyboardNav(e);
  assert.equal(e.defaultPrevented,false);assert.equal(h.focused(),0);assert.equal(h.writes.length,0);
 }
});
test('B05: global search shortcut dispatch is unchanged outside POS',()=>{
 const h=keyboardFixture(false),e=h.event('F1');h.c.handleKeyboardNav(e);
 assert.equal(e.defaultPrevented,true);assert.equal(h.focused(),1);assert.equal(h.selected(),1);
});
test('B05: consumed events and unauthenticated users cannot reach POS navigation',()=>{
 for(const authenticated of [false,true]){
  const h=keyboardFixture(true),e=h.event('Enter');
  h.run('isAuthenticated='+authenticated);e.defaultPrevented=authenticated;
  h.c.handleKeyboardNav(e);assert.equal(h.focused(),0);assert.equal(h.writes.length,0);
 }
});

for(const key of ['Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown']) {
 test(`B05-M: active modal retains ${key} over visible POS`,()=>{
  const h=keyboardFixture(true),e=h.event(key);
  h.c.document.querySelectorAll=selector=>selector==='.modal-overlay.active, #quick-edit-product-popup.active'?[{id:'pay-modal'}]:[];
  const card=h.fields.get('btn-payment');card.getAttribute=()=> 'P-MODAL';card.scrollIntoView=()=>{};
  h.fields.get('pos-grid').querySelectorAll=()=>[card];
  h.run('posSelectedIndex=-1;posSelectedProductId=null;');
  const before=JSON.stringify(h.run('({db,cart,invoiceTabs})'));
  h.c.handleKeyboardNav(e);
  assert.equal(e.defaultPrevented,false);assert.equal(h.focused(),0);assert.equal(h.run('posSelectedIndex'),-1);
  assert.equal(JSON.stringify(h.run('({db,cart,invoiceTabs})')),before);assert.equal(h.writes.length,0);
 });
}


test('product layout: a hidden or unavailable table never mutates application data',()=>{
 const h=make(),before=h.run('JSON.stringify({db,cart,invoiceTabs})');
 assert.equal(h.c.applyProductIdentityLayout(true),false);
 assert.equal(h.run('JSON.stringify({db,cart,invoiceTabs})'),before);assert.equal(h.writes.length,0);
});

test('product layout: rapid resize requests execute one real asynchronous layout task',async()=>{
 const h=make();let calls=0;
 h.c.setTimeout=setTimeout;h.c.clearTimeout=clearTimeout;
 h.c.requestAnimationFrame=fn=>setTimeout(fn,0);h.c.cancelAnimationFrame=clearTimeout;
 h.c.applyProductIdentityLayout=()=>{calls++;return true};
 h.run('productIdentityLayoutState={timer:0,frame:0};');
 h.c.scheduleProductIdentityLayout();h.c.scheduleProductIdentityLayout();h.c.scheduleProductIdentityLayout();
 assert.equal(calls,0);await new Promise(resolve=>setTimeout(resolve,180));
 assert.equal(calls,1);assert.equal(h.writes.length,0);
});

test('product layout: changing UI size schedules layout without rerendering or saving data',async()=>{
 const h=make();let layout=0,renders=0;h.c.scheduleProductIdentityLayout=()=>layout++;h.c.renderProdTable=()=>renders++;
 const before=h.run('JSON.stringify(db)');await h.originals.applyUISize('large',false);
 assert.equal(layout,1);assert.equal(renders,0);assert.equal(h.run('JSON.stringify(db)'),before);assert.equal(h.writes.length,0);
});

test('product layout: failed UI size persistence schedules the restored size too',async()=>{
 const h=make();let layouts=0;const sizes=[];h.c.scheduleProductIdentityLayout=()=>layouts++;
 h.fields.get('set-ui-size').value='medium';h.run("db.settings.uiSize='medium'");
 h.c.document.body.setAttribute=(key,value)=>{if(key==='data-ui-size')sizes.push(value)};
 h.c.saveMutationNow=async()=>false;await h.originals.applyUISize('large',true);
 assert.deepEqual(sizes,['large','medium']);assert.equal(layouts,2);assert.equal(h.run('db.settings.uiSize'),'medium');
});

for(const empty of [false,true])test(`product layout: original renderer preserves data and escaped handlers (${empty?'empty':'populated'})`,()=>{
 const h=make();let layouts=0;const original=h.c.applyProductIdentityLayout;
 h.c.applyProductIdentityLayout=force=>{assert.equal(force,true);layouts++;return original(force)};
 h.run(`db.products=${empty?'[]':JSON.stringify([{id:0,code:'8903099703239',name:'<img onerror=alert(1)> & tên',cat:'Danh mục',price:25000,cost:7000,stock:20}])};`);
 const before=h.run('JSON.stringify(db)');h.originals.renderProdTable();
 assert.equal(layouts,1);assert.equal(h.run('JSON.stringify(db)'),before);assert.equal(h.writes.length,0);
 const markup=h.fields.get('prod-body').innerHTML;
 if(empty)assert.match(markup,/Không có sản phẩm phù hợp/);
 else {assert.match(markup,/&lt;img onerror=alert\(1\)&gt; &amp; tên/);assert.match(markup,/toggleProductSelect\(0\)/);assert.match(markup,/editP\(0\)/);assert.match(markup,/openLabelPrintModal\(0\)/);}
});

test('AUD-01: valid zero invoice IDs remain visible in the production detail, receipt, and report paths', () => {
 const h=make();
 h.run("db.invoices=[{id:0,date:'2026-10-01T10:00:00.000Z',cust:'Khách A',staff:'Thu ngân',items:[],subtotal:0,discount:0,total:0}];");
 h.c.viewInvoice(0);
 assert.match(h.fields.get('invoice-detail-body').innerHTML, /#0</);
 const printPath=source.slice(source.indexOf('function printInv(inv)'),source.indexOf('// Alias for keyboard shortcuts'));
 const detailPath=source.slice(source.indexOf('function viewInvoice('),source.indexOf('function printCurrentInvoice('));
 const reportPath=source.slice(source.indexOf('function exportMgmtReportPDF()'),source.indexOf('// Open in-app report viewer modal with table format'));
 assert.match(printPath,/String\(inv\.id \?\? ''\)\.slice\(-6\)/);
 assert.match(detailPath,/String\(inv\.id \?\? ''\)\.slice\(-6\)/);
 assert.match(reportPath,/escapeHtml\(String\(o\.id \?\? ''\)\)/);
 assert.doesNotMatch(printPath,/String\(inv\.id \|\| ''\)/);
 assert.doesNotMatch(detailPath,/String\(inv\.id \|\| ''\)/);
 assert.doesNotMatch(reportPath,/escapeHtml\(o\.id \|\| ''\)/);
});

test('AUD-02: zero user IDs open, save, and retain existing permission boundaries', async () => {
 for(const requestedId of [0,'0']){
  const h=make();
  h.run("db.users=[{id:0,user:'zero',pass:'fixture',name:'Zero',role:'admin'},{id:7,user:'other',pass:'fixture',name:'Other',role:'staff'}];currUser=db.users[0];isAuthenticated=true;");
  h.c.openUserModal(requestedId);
  assert.equal(h.fields.get('u-id').value,'0');
  assert.equal(h.fields.get('u-user').value,'zero');
  assert.equal(h.fields.get('u-name').value,'Zero');
  h.fields.get('u-name').value='Zero đã sửa';
  await h.c.saveUser();
  assert.equal(h.run('db.users.length'),2);
  assert.equal(h.run('db.users.find(user=>sameStoredId(user.id,0)).name'),'Zero đã sửa');
  assert.equal(h.run('db.users.find(user=>sameStoredId(user.id,7)).name'),'Other');
 }
 const manager=make();
 manager.run("db.users=[{id:'M',user:'manager',pass:'fixture',name:'Manager',role:'manager'},{id:0,user:'zero',pass:'fixture',name:'Zero',role:'staff'},{id:'A',user:'admin',pass:'fixture',name:'Admin',role:'admin'}];currUser=db.users[0];isAuthenticated=true;");
 manager.c.openUserModal(0);
 assert.equal(manager.fields.get('u-id').value,'0');
 assert.equal(manager.fields.get('u-name').value,'Zero');
 manager.fields.get('u-name').value='Giữ nguyên';
 manager.c.openUserModal('A');
 assert.equal(manager.fields.get('u-name').value,'Giữ nguyên');
 const staff=make();
 staff.run("db.users=[{id:0,user:'zero',pass:'fixture',name:'Zero',role:'staff'},{id:'A',user:'admin',pass:'fixture',name:'Admin',role:'admin'}];currUser=db.users[0];isAuthenticated=true;");
 staff.c.openUserModal(0);
 assert.equal(staff.fields.get('u-id').value,'0');
 const create=make();
 create.run("db.users=[{id:'M',user:'manager',pass:'fixture',name:'Manager',role:'manager'}];currUser=db.users[0];isAuthenticated=true;");
 for(const requestedId of [null,undefined,'']){
  create.c.openUserModal(requestedId);
  assert.equal(create.fields.get('u-id').value,'');
  assert.equal(create.fields.get('u-user').value,'');
 }
});


function makeWindowFixture(workArea) {
 const {EventEmitter}=require('node:events');
 const screen=new EventEmitter(),appEvents=new EventEmitter(),ready=[],windows=[],changes=[],pending=new Map();let timerId=0;
 screen.area={...workArea};
 screen.getPrimaryDisplay=()=>({workArea:screen.area});
 screen.getDisplayMatching=bounds=>{screen.matchedBounds={...bounds};return {workArea:screen.area}};
 class Window extends EventEmitter {
  static getAllWindows(){return windows.filter(win=>!win.destroyed)}
  constructor(options){super();this.options=options;this.bounds={x:options.x??0,y:options.y??0,width:options.width,height:options.height};this.minimum=[options.minWidth||0,0];this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};windows.push(this)}
  getBounds(){return {...this.bounds}}
  getMinimumSize(){return [...this.minimum]}
  setMinimumSize(width,height){changes.push(['minimum',width,height]);this.minimum=[width,height];this.bounds.width=Math.max(width,this.bounds.width)}
  setBounds(bounds){changes.push(['bounds',{...bounds}]);this.bounds={...bounds,width:Math.max(bounds.width,this.minimum[0])};this.emit('moved')}
  isDestroyed(){return !!this.destroyed}
  isMaximized(){return !!this.maximized}
  isFullScreen(){return !!this.fullscreen}
  isMinimized(){return !!this.minimized}
  loadFile(){this.loads=(this.loads||0)+1}
  setMenuBarVisibility(){}
 }
 const h=makeMain({screen,BrowserWindow:Window,ready,appEvents,setTimeout:callback=>{pending.set(++timerId,callback);return timerId},clearTimeout:id=>pending.delete(id)});
 ready[0]();
 return {...h,screen,appEvents,windows,changes,pending,flush:()=>{const callbacks=[...pending.values()];pending.clear();callbacks.forEach(callback=>callback())},win:windows[0]};
}

for(const [width,height]of [[1024,768],[1280,720],[1366,768],[1440,900],[1512,982]]) {
 test(`window fit: initial native options stay inside ${width}x${height} work area`,()=>{
  const h=makeWindowFixture({x:-1920,y:35,width,height}),win=h.win;
  const expectedWidth=width<1440?width:1440,expectedHeight=height<800?height:800;
  assert.deepEqual(plain(win.getBounds()),{x:-1920+Math.floor((width-expectedWidth)/2),y:35+Math.floor((height-expectedHeight)/2),width:expectedWidth,height:expectedHeight});
  assert.equal(win.minimum[0],expectedWidth);
  assert.deepEqual(plain(win.options.webPreferences),{nodeIntegration:false,contextIsolation:true,devTools:false,preload:'/readonly/preload.js'});
 });
}

test('window fit: display metrics and monitor removal lower the minimum before clamping, without writes',()=>{
 const h=makeWindowFixture({x:0,y:0,width:1920,height:1040});
 h.win.bounds={x:900,y:400,width:1800,height:900};
 h.screen.area={x:0,y:40,width:1280,height:640};
 h.screen.emit('display-metrics-changed',{}, {}, ['workArea','scaleFactor']);
 assert.deepEqual(h.win.getBounds(),{x:0,y:40,width:1280,height:640});
 assert.equal(h.changes[0][0],'minimum');assert.equal(h.changes[1][0],'bounds');
 const count=h.changes.length;
 for(let i=0;i<30;i++)h.screen.emit('display-metrics-changed',{}, {}, ['workArea']);
 assert.equal(h.changes.length,count,'unchanged geometry must not trigger repeated native writes');
 h.screen.area={x:-1366,y:-750,width:1366,height:728};h.screen.emit('display-removed',{},{});
 assert.deepEqual(h.win.getBounds(),{x:-1366,y:-662,width:1366,height:640});
 assert.deepEqual(h.operations,[]);
});

test('window fit: moving to a larger display restores its minimum without changing zoom or reload state',()=>{
 const h=makeWindowFixture({x:0,y:0,width:1280,height:720});
 h.screen.area={x:1280,y:0,width:1920,height:1040};h.win.bounds.x=1300;
 h.win.emit('moved');h.flush();
 assert.deepEqual(h.screen.matchedBounds,{x:1300,y:0,width:1280,height:720});
 assert.deepEqual(h.win.getBounds(),{x:1300,y:0,width:1440,height:720});
 assert.equal(h.win.minimum[0],1440);assert.equal(h.win.loads,1);
 assert.deepEqual(h.operations,[]);
});

test('window fit: maximized, fullscreen and minimized states are preserved; restore clamps normal bounds',()=>{
 for(const [property,event]of [['maximized','unmaximize'],['fullscreen','leave-full-screen'],['minimized','restore']]){
  const h=makeWindowFixture({x:0,y:0,width:1920,height:1040});h.win[property]=true;
  h.screen.area={x:0,y:30,width:1024,height:700};
  h.screen.emit('display-metrics-changed',{}, {}, ['bounds']);
  assert.equal(h.win[property],true);assert.equal(h.changes.some(item=>item[0]==='bounds'),false);
  h.win[property]=false;h.win.emit(event);
  assert.deepEqual(h.win.getBounds(),{x:0,y:30,width:1024,height:700});
 }
});

test('window fit: shared display listeners do not multiply across window recreation or renderer recovery',()=>{
 const h=makeWindowFixture({x:0,y:0,width:1512,height:865});
 for(const event of ['display-metrics-changed','display-removed'])assert.equal(h.screen.listenerCount(event),1);
 for(let i=0;i<30;i++){
  const win=h.windows.at(-1);win.webContents.emit('render-process-gone',{}, {reason:'clean-exit'});
  win.destroyed=true;win.emit('closed');h.appEvents.emit('activate');
 }
 assert.equal(h.windows.length,31);
 for(const event of ['display-metrics-changed','display-removed'])assert.equal(h.screen.listenerCount(event),1);
 const win=h.windows.at(-1);win.destroyed=true;win.emit('closed');
 assert.doesNotThrow(()=>h.screen.emit('display-removed',{},{}));assert.deepEqual(h.operations,[]);
});


test('window fit: drag/resize events coalesce until movement settles and closing clears pending work',()=>{
 const h=makeWindowFixture({x:0,y:0,width:1512,height:865});
 const loads=h.win.loads;
 for(let i=0;i<30;i++){h.win.bounds.x=100+i;h.win.emit('moved');h.win.emit('resized')}
 assert.equal(h.pending.size,1);assert.equal(h.changes.length,0);
 h.screen.area={x:1512,y:0,width:1280,height:720};h.win.bounds.x=1600;h.flush();
 assert.deepEqual(h.win.getBounds(),{x:1512,y:0,width:1280,height:720});assert.equal(h.win.loads,loads);
 h.win.emit('moved');assert.equal(h.pending.size,1);h.win.destroyed=true;h.win.emit('closed');assert.equal(h.pending.size,0);
 assert.deepEqual(h.operations,[]);
});


// Q01/K01: original handlers, no stripped async bodies or replacement business logic.
test('Q01: quick edit joins the shared modal stack and all close paths remove its state',()=>{
 const h=make(),popup=h.fields.get('quick-edit-product-popup'),classes=new Set();
 popup.classList={contains:x=>classes.has(x),add:x=>classes.add(x),remove:x=>classes.delete(x)};
 const trigger={id:'quick-trigger'};h.c.document.activeElement=trigger;
 h.c.document.querySelectorAll=()=>classes.has('active')?[popup]:[];
 h.run("db.products=[{id:0,name:'Product',price:25000,cost:15000,stock:10}]");
 h.c.openQuickEditProduct(0,{currentTarget:trigger});
 assert.equal(h.c.getTopActiveModal(),popup);assert.equal(popup.style.display,'flex');
 assert.equal(h.run("modalFocusOrigins.get($('quick-edit-product-popup'))"),trigger);
 h.c.closeModal('quick-edit-product-popup');
 assert.equal(classes.has('active'),false);assert.equal(h.fields.get('quick-edit-overlay').style.display,'none');
 assert.equal(h.run("typeof window._qeOldStock"),'undefined');
 h.c.openQuickEditProduct(0);h.c.closeModal('purchase-order-modal');
 assert.equal(classes.has('active'),false);assert.equal(popup.style.display,'none');
});

test('K01: text editing keys pass through every modal while business shortcuts remain consumed',()=>{
 for(const tagName of ['INPUT','TEXTAREA','DIV'])for(const readOnly of [false,true]){
  const h=make(),target={tagName,type:'text',isContentEditable:tagName==='DIV',readOnly};
  const modal={id:'po-history-modal',contains:node=>node===target};
  h.c.document.activeElement=target;h.c.document.querySelectorAll=()=>[modal];
  h.run('performUndo=()=>{throw Error("Business undo must not run")};');
  const before=h.run('JSON.stringify({db,cart,invoiceTabs})');
  for(const modifier of ['ctrlKey','metaKey'])for(const key of ['a','c','v','x','z','y','ArrowLeft','ArrowRight','Home','End','Backspace','Delete']){
   const event={key,[modifier]:true,shiftKey:true,preventDefault(){this.defaultPrevented=true},stopPropagation(){}};
   h.c.handleGlobalShortcuts(event);assert.notEqual(event.defaultPrevented,true,tagName+' '+modifier+' '+key);
  }
  for(const combo of [{key:'F4'},{key:'t',ctrlKey:true},{key:'t',metaKey:true},{key:'ArrowLeft',altKey:true,ctrlKey:true}]){
   const event={...combo,preventDefault(){this.defaultPrevented=true},stopPropagation(){}};
   h.c.handleGlobalShortcuts(event);assert.equal(event.defaultPrevented,true);
  }
  for(const combo of [{key:'Escape',isComposing:true},{key:'Escape',keyCode:229},{key:'q',ctrlKey:true,altKey:true,getModifierState:k=>k==='AltGraph'},{key:'ArrowLeft',altKey:true},{key:'Dead',altKey:true},{key:'å',altKey:true}]){
   const event={...combo,preventDefault(){this.defaultPrevented=true},stopPropagation(){}};
   h.c.handleGlobalShortcuts(event);assert.notEqual(event.defaultPrevented,true);
  }
  assert.equal(h.run('JSON.stringify({db,cart,invoiceTabs})'),before);assert.equal(h.writes.length,0);
 }
});

test('K01: selected text may be copied only when both endpoints belong to the top modal',()=>{
 const h=make(),inside={},outside={},button={tagName:'BUTTON'},modal={id:'prod-modal',contains:n=>n===inside};
 h.c.document.activeElement=button;h.c.document.querySelectorAll=()=>[modal];
 for(const end of [inside,outside]){
  h.c.getSelection=()=>({isCollapsed:false,anchorNode:inside,focusNode:end});
  const e={key:'c',ctrlKey:true,preventDefault(){this.defaultPrevented=true},stopPropagation(){}};
  h.c.handleGlobalShortcuts(e);assert.equal(!!e.defaultPrevented,end===outside);
 }
});

function poPaymentFixture(id=0) {
 const h=make();h.c.paymentFixtureId=id;
 h.run(`db.products=[{id:'P',name:'Product',code:'FIXTURE',stock:10,price:25000,cost:15000}];
 db.suppliers=[{id:'A',name:'NCC A',debt:100000},{id:'B',name:'NCC B',debt:90000},{id:'C',name:'Unrelated',debt:123}];
 db.purchaseOrders=[{id:paymentFixtureId,code:'PN-A',supplierId:'A',date:'2026-10-20T01:00:00.000Z',totalAmount:60000,isPaid:false,items:[]},
 {id:'A2',code:'PN-A2',supplierId:'A',date:'2026-10-20T01:00:00.000Z',totalAmount:40000,isPaid:false,items:[]},
 {id:'B1',code:'PN-B',supplierId:'B',date:'2026-10-20T01:00:00.000Z',totalAmount:90000,isPaid:false,items:[]},
 {id:'PAID',code:'PN-OLD',supplierId:'A',date:'2026-10-20T01:00:00.000Z',totalAmount:25000,isPaid:true,paidDate:'2026-10-01T00:00:00.000Z',items:[]}];`);
 return h;
}

function poBulkFixture(id=0) {
 const h=poPaymentFixture(id);
 h.run(`db.products=[{id:'P',name:'Product',code:'FIXTURE',stock:20,price:25000,cost:15000},{id:'Q',name:'Other',stock:30,price:30000,cost:20000}];
 db.purchaseOrders.forEach((po,i)=>{po.supplierName=po.supplierId;po.items=[{productId:i===1?'Q':'P',productName:i===1?'Other':'Product',qty:[4,2,6,1][i],price:[15000,20000,15000,25000][i],total:po.totalAmount}];po.totalQty=po.items[0].qty});
 db.stockHistory=db.purchaseOrders.map((po,i)=>({id:'PO-H'+i,date:po.date,type:'in',productId:po.items[0].productId,productName:po.items[0].productName,qty:po.items[0].qty,price:po.items[0].price,total:po.totalAmount,purchaseOrderId:po.id,source:'purchase_order',note:'Đơn nhập: '+po.code,user:'Audit'}));
 db.stockHistory.push({id:'UNRELATED',type:'in',qty:3,productId:'P',note:'Other adjustment'});`);
 return h;
}

test('PO bulk: shared selection includes paid orders but payment commits only unpaid selected orders',async()=>{
 const h=poBulkFixture();h.c.toggleAllPOPayments(true);
 assert.equal(h.run('selectedPOPaymentIds.size'),4);
 assert.match(h.fields.get('po-payment-selected-count').textContent,/4 đơn.*3 chưa thanh toán/);
 h.c.togglePOPaymentSelection('A2',false);
 const paid=h.run('JSON.stringify(db.purchaseOrders[3])');
 assert.equal(await h.c.markSelectedPOsAsPaid(),true);
 assert.deepEqual(h.writes[0].suppliers.map(s=>s.debt),[40000,0,123]);
 assert.equal(h.run('JSON.stringify(db.purchaseOrders[3])'),paid);
 h.c.togglePOPaymentSelection('PAID',true);
 assert.equal(h.fields.get('po-payment-submit').disabled,true);assert.equal(h.fields.get('po-bulk-delete-open').disabled,false);
});

for(const id of [0,'0'])for(const revert of [false,true])test(`PO bulk: one atomic delete/individual undo preserves the independent ledger (${typeof id}, stock ${revert})`,async()=>{
 const h=poBulkFixture(id),unrelated=h.run('JSON.stringify({custs:db.custs,invoices:db.invoices,returns:db.returns,drafts:db.drafts,supplier:db.suppliers[2]})');
 for(const key of [id,'B1','PAID'])h.c.togglePOPaymentSelection(key,true);
 assert.equal(h.c.openBulkDeletePurchaseOrders(),true);
 assert.equal(h.fields.get('po-bulk-delete-keep-stock').checked,true);
 assert.match(h.fields.get('po-bulk-delete-summary').textContent,/3 đơn.*175.000/);
 h.fields.get('po-bulk-delete-revert-stock').checked=revert;
 assert.equal(await h.c.confirmBulkDeletePurchaseOrders(),true);assert.equal(h.writes.length,1);
 assert.deepEqual(plain(h.run('db.purchaseOrders.map(po=>po.id)')),['A2']);
 assert.deepEqual(plain(h.run('db.suppliers.map(s=>s.debt)')),[40000,0,123]);
 assert.deepEqual(plain(h.run('db.products.map(p=>p.stock)')),[revert?9:20,30]);
 assert.equal(h.run('db.stockHistory.length'),revert?2:5);assert.equal(h.run('undoStack.length'),3);
 assert.equal(h.run('selectedPOPaymentIds.size'),0);
 assert.equal(h.run('JSON.stringify({custs:db.custs,invoices:db.invoices,returns:db.returns,drafts:db.drafts,supplier:db.suppliers[2]})'),unrelated);
 // An unrelated adjustment between commit and undo must survive every item.
 h.run("db.products[0].stock-=2;db.stockHistory.push({id:'LATER',type:'out',productId:'P',qty:2,note:'Later adjustment'})");
 for(let i=0;i<3;i++)await h.c.performUndo();
 assert.equal(h.run('db.purchaseOrders.length'),4);assert.deepEqual(plain(h.run('db.products.map(p=>p.stock)')),[18,30]);
 assert.deepEqual(plain(h.run('db.suppliers.map(s=>s.debt)')),[100000,90000,123]);
 assert.equal(h.run("db.stockHistory.some(h=>h.id==='LATER')"),true);
});
for(const id of [0,'0','PO-string'])test(`R01: one original async commit pays the exact selection and debts (${typeof id} ${id})`,async()=>{
 const h=poPaymentFixture(id),unrelated=h.run('JSON.stringify({products:db.products,custs:db.custs,stockHistory:db.stockHistory,old:db.purchaseOrders[3],supplier:db.suppliers[2]})');
 h.c.togglePOPaymentSelection(id,true);h.c.togglePOPaymentSelection('B1',true);
 let question='';h.c.confirm=message=>{question=message;return true};
 assert.equal(await h.c.markSelectedPOsAsPaid(),true);assert.match(question,/2 đơn/);assert.match(question,/150.000/);
 assert.equal(h.writes.length,1);const disk=h.writes[0];
 assert.deepEqual(disk.purchaseOrders.map(po=>po.isPaid),[true,false,true,true]);
 assert.deepEqual(disk.suppliers.map(s=>s.debt),[40000,0,123]);
 assert.equal(disk.purchaseOrders[0].id,id);assert.equal(disk.purchaseOrders[0].paidDate,disk.purchaseOrders[2].paidDate);
 assert.equal(disk.activityLog.filter(x=>x.action==='Thanh toán đơn nhập hàng loạt').length,1);
 assert.equal(h.run('JSON.stringify({products:db.products,custs:db.custs,stockHistory:db.stockHistory,old:db.purchaseOrders[3],supplier:db.suppliers[2]})'),unrelated);
 assert.equal(h.run('selectedPOPaymentIds.size'),0);assert.equal(await h.c.markSelectedPOsAsPaid(),false);assert.equal(h.writes.length,1);
});

test('R01: filtered selection, mixed-state checkbox and expand/filter/close lifecycle',()=>{
 const h=poPaymentFixture();h.fields.get('po-filter-supplier').value='A';h.c.toggleAllPOPayments(true);
 assert.equal(h.run('selectedPOPaymentIds.size'),3);assert.equal(h.fields.get('po-payment-select-all').checked,true);
 h.c.togglePOPaymentSelection(0,false);assert.equal(h.fields.get('po-payment-select-all').indeterminate,true);
 h.c.togglePOPaymentSelection('PAID',true);h.c.togglePOPaymentSelection('B1',true);assert.equal(h.run('selectedPOPaymentIds.size'),2);
 h.c.togglePOExpand('A2');assert.equal(h.run('selectedPOPaymentIds.size'),2);
 h.originals.renderPOHistory();assert.match(h.fields.get('po-history-list').innerHTML,/data-po-payment-select="0"/);
 assert.match(h.fields.get('po-history-list').innerHTML,/data-po-payment-select="PAID"/);
 h.fields.get('po-filter-supplier').value='B';h.c.changePOHistoryFilter();assert.equal(h.run('selectedPOPaymentIds.size'),0);
 h.c.toggleAllPOPayments(true);h.c.closeModal('po-history-modal');assert.equal(h.run('selectedPOPaymentIds.size'),0);
 h.fields.get('po-filter-payment').value='paid';h.fields.get('po-filter-supplier').value='';h.c.toggleAllPOPayments(true);
 assert.equal(h.run('selectedPOPaymentIds.size'),1);assert.equal(h.fields.get('po-payment-submit').disabled,true);
 assert.equal(h.fields.get('po-bulk-delete-open').disabled,false);
});

test('R01: cancel and changed order/session/role never pay a partial group',async()=>{
 for(const change of ['cancel','deleted','paid','amount','supplier','session','revision','role']){
  const h=poPaymentFixture();h.c.togglePOPaymentSelection(0,true);h.c.togglePOPaymentSelection('B1',true);
  h.c.confirm=()=>{
   const code={deleted:'db.purchaseOrders.splice(2,1)',paid:'db.purchaseOrders[2].isPaid=true',amount:'db.purchaseOrders[2].totalAmount=1',supplier:"db.purchaseOrders[2].supplierId='A'",session:'undoSession++',revision:"desktopRevision='changed'",role:"db.users[0].role='staff'"}[change];
   if(code)h.run(code);return change!=='cancel';
  };
  assert.equal(await h.c.markSelectedPOsAsPaid(),false,change);assert.equal(h.writes.length,0,change);
  assert.equal(h.run('db.purchaseOrders[0].isPaid'),false,change);
  assert.equal(h.run('poPaymentPending'),false,change);
  if(change==='cancel')assert.equal(h.run('selectedPOPaymentIds.size'),2);
 }
});

test('R01: save failure rolls back every linked collection and preserves selection',async()=>{
 const h=poPaymentFixture();h.c.toggleAllPOPayments(true);const before=h.run('JSON.stringify(db)');
 h.c.ntkiot.data.save=async()=>({ok:false,code:'IO_FAILED'});
 assert.equal(await h.c.markSelectedPOsAsPaid(),false);assert.equal(h.run('JSON.stringify(db)'),before);
 assert.equal(h.run('selectedPOPaymentIds.size'),4);assert.equal(h.run('activeDataMutation'),null);assert.equal(h.fields.get('po-payment-submit').disabled,false);
});

test('R01: a second click cannot enter a pending real asynchronous save',async()=>{
 const h=poPaymentFixture();h.c.toggleAllPOPayments(true);let release,calls=0;
 h.c.ntkiot.data.save=async text=>{calls++;await new Promise(resolve=>release=resolve);h.writes.push(JSON.parse(text));return {ok:true}};
 const first=h.c.markSelectedPOsAsPaid();assert.equal(h.run('poPaymentPending'),true);assert.equal(h.fields.get('po-payment-submit').disabled,true);
 assert.equal(await h.c.markSelectedPOsAsPaid(),false);assert.equal(calls,1);release();assert.equal(await first,true);assert.equal(h.writes.length,1);
});

test('R01: lost ACK resolves committed status once; unknown commit blocks further writes',async()=>{
 for(const known of [true,false]){
  const h=poPaymentFixture();h.c.toggleAllPOPayments(true);let calls=0,status=0;
  h.c.ntkiot.auth={};h.c.ntkiot.data.save=async()=>{calls++;throw Error('ACK_LOST')};
  h.c.ntkiot.data.getCommitStatus=async()=>{status++;return known?{ok:true,committed:true,revision:'R2',sessionEpoch:1}:{ok:false,code:'UNKNOWN_COMMIT'}};
  assert.equal(await h.c.markSelectedPOsAsPaid(),known);assert.equal(calls,1);assert.equal(status,1);
  if(!known){assert.equal(h.run('activeDataMutation.state'),'Blocked');assert.notEqual(h.run('saveBlockedReason'),'');assert.equal(h.fields.get('po-payment-submit').disabled,true);assert.equal(await h.c.markSelectedPOsAsPaid(),false);assert.equal(calls,1)}
 }
});

test('Q01: real async save failure preserves popup input and rolls back product, PO lines and history',async()=>{
 for(const id of [0,'0']){
  const h=make(),popup=h.fields.get('quick-edit-product-popup'),classes=new Set();h.c.quickFixtureId=id;
  popup.classList={contains:x=>classes.has(x),add:x=>classes.add(x),remove:x=>classes.delete(x)};
  h.run("db.products=[{id:quickFixtureId,name:'Before',code:'FIXTURE',stock:10,price:295000,cost:215000,unit:'Cai'}];currentPOItems=[{productId:quickFixtureId,productName:'Before',qty:2,price:215000,sellPrice:295000,total:430000}];db.purchaseOrders=[{id:'OLD',items:[{productId:quickFixtureId,productName:'Snapshot',qty:1,price:60000,total:60000}],totalAmount:60000}];");
  h.c.openQuickEditProduct(id);
  for(const [field,value] of Object.entries({'qe-name':'After','qe-stock':'12','qe-unit':'Hop','qe-price':'300.000','qe-cost':'220.000','qe-wholesale':'280.000'}))h.fields.get(field).value=value;
  const before=h.run('JSON.stringify({db,currentPOItems})');let calls=0;
  h.c.ntkiot.data.save=async()=>{calls++;await Promise.resolve();return {ok:false,code:'IO_FAILED'}};
  await h.c.saveQuickEditProduct();assert.equal(calls,1);assert.equal(h.run('JSON.stringify({db,currentPOItems})'),before);
  assert.equal(classes.has('active'),true);assert.equal(popup.style.display,'flex');assert.equal(h.fields.get('qe-name').value,'After');assert.equal(h.fields.get('qe-stock').value,'12');
  h.c.ntkiot.data.save=async text=>{h.writes.push(JSON.parse(text));return {ok:true}};
  await h.c.saveQuickEditProduct();assert.equal(h.writes.length,1);assert.equal(h.writes[0].products[0].stock,12);
  assert.equal(h.run('currentPOItems[0].total'),440000);assert.equal(h.writes[0].stockHistory.length,1);assert.equal(h.writes[0].stockHistory[0].qty,2);
  assert.equal(h.writes[0].purchaseOrders[0].items[0].productName,'Snapshot');assert.equal(classes.has('active'),false);
 }
});

test('PO bulk: cancel preserves selection; stale document, actor, epoch or role cannot delete a partial group',async()=>{
 for(const change of ['cancel','deleted','amount','supplier','paid','session','epoch','revision','actor','role']){
  const h=poBulkFixture();h.c.togglePOPaymentSelection(0,true);h.c.togglePOPaymentSelection('B1',true);
  assert.equal(h.c.openBulkDeletePurchaseOrders(),true);
  assert.equal(h.c.closeModal('po-history-modal'),false);
  if(change==='cancel'){
   assert.equal(h.c.closeModal('po-bulk-delete-modal'),true);assert.equal(h.run('selectedPOPaymentIds.size'),2);
  }else{
   h.run({deleted:"db.purchaseOrders.splice(2,1)",amount:"db.purchaseOrders[0].totalAmount++",supplier:"db.purchaseOrders[0].supplierId='B'",
    paid:"db.purchaseOrders[0].isPaid=true",session:"undoSession++",epoch:"desktopSessionEpoch++",revision:"desktopRevision='changed'",
    actor:"db.users[0].id='OTHER'",role:"db.users[0].role='staff'"}[change]);
  }
  const before=h.run('JSON.stringify(db)');
  assert.equal(await h.c.confirmBulkDeletePurchaseOrders(),false,change);assert.equal(h.writes.length,0,change);
  assert.equal(h.run('JSON.stringify(db)'),before,change);assert.equal(h.run('poPaymentPending'),false,change);
 }
});

test('PO bulk: failed save rolls back inventory, debt, journal and undo together while keeping the confirmation',async()=>{
 for(const id of [0,'0']){
  const h=poBulkFixture(id);h.c.toggleAllPOPayments(true);h.c.openBulkDeletePurchaseOrders();
  h.fields.get('po-bulk-delete-revert-stock').checked=true;
  const before=h.run('JSON.stringify({db,undoStack})');h.c.ntkiot.data.save=async()=>({ok:false,code:'IO_FAILED'});
  assert.equal(await h.c.confirmBulkDeletePurchaseOrders(),false);assert.equal(h.run('JSON.stringify({db,undoStack})'),before);
  assert.equal(h.run('selectedPOPaymentIds.size'),4);assert.equal(h.run('poPaymentPending'),true);
  assert.equal(h.run('poBulkDeleteSaving'),false);assert.equal(h.fields.get('po-bulk-delete-confirm').disabled,false);
  assert.equal(h.fields.get('po-bulk-delete-revert-stock').checked,true);
  h.c.closeModal('po-bulk-delete-modal');assert.equal(h.run('poPaymentPending'),false);
 }
});

test('PO bulk: pending write blocks repeated confirm, payment, selection and closing the active transaction',async()=>{
 const h=poBulkFixture();h.c.toggleAllPOPayments(true);h.c.openBulkDeletePurchaseOrders();let release,calls=0;
 h.c.ntkiot.data.save=async text=>{calls++;await new Promise(r=>release=r);h.writes.push(JSON.parse(text));return {ok:true}};
 const first=h.c.confirmBulkDeletePurchaseOrders();assert.equal(h.run('poBulkDeleteSaving'),true);
 assert.equal(await h.c.confirmBulkDeletePurchaseOrders(),false);assert.equal(await h.c.markSelectedPOsAsPaid(),false);
 h.c.toggleAllPOPayments(false);assert.equal(h.run('selectedPOPaymentIds.size'),4);
 assert.equal(h.c.closeModal('po-bulk-delete-modal'),false);assert.equal(h.c.closeModal('po-history-modal'),false);
 assert.equal(h.fields.get('po-bulk-delete-cancel').disabled,true);assert.equal(calls,1);
 release();assert.equal(await first,true);assert.equal(h.writes.length,1);assert.equal(h.run('poPaymentPending'),false);
});

test('PO bulk: lost ACK verifies the original request and unknown outcome blocks all further writes',async()=>{
 for(const known of [true,false]){
  const h=poBulkFixture();h.c.toggleAllPOPayments(true);h.c.openBulkDeletePurchaseOrders();let calls=0,status=0;
  h.c.ntkiot.auth={};h.c.ntkiot.data.save=async()=>{calls++;throw Error('ACK_LOST')};
  h.c.ntkiot.data.getCommitStatus=async()=>{status++;return known?{ok:true,committed:true,revision:'R2',sessionEpoch:1}:{ok:false,code:'UNKNOWN_COMMIT'}};
  assert.equal(await h.c.confirmBulkDeletePurchaseOrders(),known);assert.equal(calls,1);assert.equal(status,1);
  if(!known){assert.equal(h.run('activeDataMutation.state'),'Blocked');assert.notEqual(h.run('saveBlockedReason'),'');assert.equal(h.fields.get('po-bulk-delete-confirm').disabled,true);assert.equal(await h.c.confirmBulkDeletePurchaseOrders(),false);assert.equal(calls,1)}
 }
});

test('PO bulk: more than 20 orders retains the existing undo limit and warns before commit',async()=>{
 const h=poBulkFixture();
 h.run("db.purchaseOrders=Array.from({length:25},(_,i)=>({id:'M'+i,code:'M'+i,date:'2026-10-20T00:00:00.000Z',supplierId:'A',totalAmount:1000,isPaid:false,items:[]}));db.suppliers[0].debt=25000");
 h.c.toggleAllPOPayments(true);h.c.openBulkDeletePurchaseOrders();
 assert.equal(h.fields.get('po-bulk-delete-undo-limit').hidden,false);
 assert.equal(await h.c.confirmBulkDeletePurchaseOrders(),true);assert.equal(h.run('undoStack.length'),20);
 assert.deepEqual(plain(h.run('undoStack.map(a=>a.data.po.id)')),Array.from({length:20},(_,i)=>'M'+(i+5)));
 assert.equal(h.run('db.suppliers[0].debt'),0);assert.equal(h.writes.length,1);
});

test('PO bulk: zero product/supplier identities, fractional and legacy missing lines keep the single-delete rules',async()=>{
 for(const id of [0,'0']){
  const h=poBulkFixture();h.c.zeroPOId=id;
  h.run("db.products[0].id=zeroPOId;db.suppliers[0].id=zeroPOId;db.purchaseOrders=[{id:'FRAC',code:'FRAC',date:'2026-10-20T00:00:00.000Z',supplierId:zeroPOId,isPaid:false,totalAmount:1000,items:[{productId:zeroPOId,qty:1.5}]},{id:'LEGACY',code:'LEGACY',date:'2026-10-20T00:00:00.000Z',supplierId:'MISSING',isPaid:true,totalAmount:0}];db.stockHistory=[];db.suppliers[0].debt=1000");
  h.c.toggleAllPOPayments(true);h.c.openBulkDeletePurchaseOrders();h.fields.get('po-bulk-delete-revert-stock').checked=true;
  assert.equal(await h.c.confirmBulkDeletePurchaseOrders(),true);assert.equal(h.run('db.products[0].stock'),18.5);
  assert.equal(h.run('db.suppliers[0].debt'),0);
  await h.c.performUndo();await h.c.performUndo();assert.equal(h.run('db.products[0].stock'),20);assert.equal(h.run('db.suppliers[0].debt'),1000);
 }
});


test('PO bulk: explicit history identity including zero outranks a duplicate legacy note',async()=>{
 for(const id of [0,'0']){
  const h=poBulkFixture(id);h.c.zeroPOHistory=id;
  h.run("db.stockHistory=[{id:'ZERO',purchaseOrderId:zeroPOHistory,note:'Unrelated-looking note'},{id:'KEEP',purchaseOrderId:'A2',note:'Đơn nhập: PN-A'},{id:'LEGACY',note:'Đơn nhập: PN-A'},{id:'OTHER',note:'Đơn nhập: PN-AA'}]");
  h.c.togglePOPaymentSelection(id,true);h.c.openBulkDeletePurchaseOrders();h.fields.get('po-bulk-delete-revert-stock').checked=true;
  assert.equal(await h.c.confirmBulkDeletePurchaseOrders(),true);
  assert.deepEqual(plain(h.run('db.stockHistory.map(h=>h.id)')),['KEEP','OTHER']);
 }
});


test('PO draft retirement: shared entry points preserve legacy drafts and cannot save/load/delete them for any role',async()=>{
 for(const id of [0,'0'])for(const role of ['admin','manager','staff',null]){
  const h=make();h.c.fixtureId=id;h.run("db.drafts.purchaseOrders=[{id:fixtureId,type:'purchaseOrders',name:'Old draft',createdAt:'2026-10-01T00:00:00Z',data:{items:[]}}];db.users[0].role="+JSON.stringify(role||'staff')+";isAuthenticated="+Boolean(role));
  const before=h.run('JSON.stringify(db)');
  assert.equal(await h.c.saveDraft('purchaseOrders',{items:[]}),null);
  assert.equal(h.c.loadDraft('purchaseOrders',id),null);
  assert.equal(await h.c.deleteDraft('purchaseOrders',id),false);
  assert.equal(h.c.openDraftsModal('purchaseOrders'),false);
  assert.equal(h.run('JSON.stringify(db)'),before);assert.equal(h.writes.length,0);
 }
});

function retiredPODraftFixture(id=0){
 const h=poFixture();h.c.fixtureId=id;
 h.run("db.products[0].id=fixtureId;db.suppliers[0].id=fixtureId;currentPOItems[0].productId=fixtureId;db.drafts.purchaseOrders=[{id:'OLD',type:'purchaseOrders',name:'Old draft',createdAt:'2026-10-01T00:00:00Z',data:{items:[]}}]");
 h.fields.get('po-supplier').value=id;
 const classes=new Set(['active']);h.fields.get('purchase-order-modal').classList={contains:n=>classes.has(n),add:n=>classes.add(n),remove:n=>classes.delete(n)};
 h.run('poFormInitialState=capturePurchaseOrderFormState()');h.fields.get('po-note').value='Edited note';
 return {h,classes};
}

test('PO draft retirement: async save blocks close and repeat submit, failure preserves form and legacy drafts',async()=>{
 for(const id of [0,'0'])for(const ok of [false,true]){
  const {h,classes}=retiredPODraftFixture(id),before=h.run('JSON.stringify(db)'),legacy=h.run('JSON.stringify(db.drafts.purchaseOrders)');
  let release,calls=0;h.c.ntkiot.data.save=text=>{calls++;h.writes.push(JSON.parse(text));return new Promise(resolve=>release=resolve)};
  h.c.confirm=()=>{throw Error('pending or committed save must not ask to discard')};
  const pending=h.c.savePurchaseOrder();assert.equal(calls,1);assert.equal(h.c.closeModal('purchase-order-modal'),false);
  await h.c.savePurchaseOrder();assert.equal(calls,1);assert.equal(classes.has('active'),true);
  release({ok,code:ok?undefined:'ENOSPC'});await pending;
  assert.equal(h.run('JSON.stringify(db.drafts.purchaseOrders)'),legacy);
  assert.equal(classes.has('active'),!ok);assert.equal(h.run('activeDataMutation'),null);
  if(!ok){assert.equal(h.run('JSON.stringify(db)'),before);assert.equal(h.fields.get('po-note').value,'Edited note');assert.notEqual(h.run('poFormInitialState'),null);assert.equal(h.run('currentPOItems.length'),1)}
  else{assert.equal(h.run('db.products[0].stock'),12);assert.equal(h.run('db.suppliers[0].debt'),120000);assert.equal(h.run('currentPOItems.length'),0);assert.equal(h.run('poFormInitialState'),null)}
 }
});

test('PO draft retirement: lost ACK verifies once; unknown commit retains form and locks close and resend',async()=>{
 for(const id of [0,'0'])for(const known of [true,false]){
  const {h,classes}=retiredPODraftFixture(id);let calls=0,status=0;
  h.c.ntkiot.auth={};h.c.ntkiot.data.save=async()=>{calls++;throw Error('ACK_LOST')};
  h.c.ntkiot.data.getCommitStatus=async()=>{status++;return known?{ok:true,committed:true,revision:'R2',sessionEpoch:1}:{ok:false,code:'UNKNOWN_COMMIT'}};
  await h.c.savePurchaseOrder();assert.equal(calls,1);assert.equal(status,1);assert.equal(classes.has('active'),!known);
  if(!known){assert.equal(h.run('activeDataMutation.state'),'Blocked');assert.equal(h.c.closeModal('purchase-order-modal'),false);await h.c.savePurchaseOrder();assert.equal(calls,1);assert.equal(h.fields.get('po-note').value,'Edited note');assert.equal(h.run('currentPOItems.length'),1)}
 }
});

test('PO draft retirement: backup, restore and admin reset retain their existing data and permission boundaries',async()=>{
 for(const id of [0,'0']){
  const {h}=retiredPODraftFixture(id),legacy=h.run('JSON.stringify(db.drafts.purchaseOrders)'),backups=[];
  h.c.ntkiot.data.createBackup=async text=>{backups.push(JSON.parse(text));return {ok:true,id:'backup_fixture.json'}};
  h.c.ntkiot.data.cleanupBackups=async()=>({ok:true});h.c.ntkiot.data.listBackups=async()=>({ok:true,backups:[]});
  assert.equal(await h.c.performBackup({force:true}),true);assert.equal(JSON.stringify(backups[0].drafts.purchaseOrders),legacy);
  h.c.fileText=JSON.stringify(backups[0]);h.run("restoreCandidate={file:{name:'fixture.json'},data:normalizeDataShape(JSON.parse(fileText))}");
  assert.equal(await h.c.confirmRestoreData(),true);assert.equal(h.run('JSON.stringify(db.drafts.purchaseOrders)'),legacy);
  h.c.location={reload(){}};let resets=0;h.c.ntkiot.data.resetAll=async()=>{resets++;return {ok:true}};
  await h.c.resetApp();assert.equal(resets,1);
 }
});

test('PO draft retirement: opening and editing capture their own initial state, discard never writes or undoes committed products',async()=>{
 for(const id of [0,'0']){
  const {h,classes}=retiredPODraftFixture(id);h.c.openPurchaseOrderModal();
  const before=h.run('JSON.stringify(db)');let questions=0;h.c.confirm=()=>{questions++;return false};
  assert.equal(h.run('poFormInitialState'),h.c.capturePurchaseOrderFormState());
  assert.equal(h.c.closeModal('purchase-order-modal'),true);assert.equal(questions,0);
  h.c.openPurchaseOrderModal();h.fields.get('po-note').value='note only';
  assert.equal(h.c.closeModal('purchase-order-modal'),false);assert.equal(questions,1);assert.equal(classes.has('active'),true);
  assert.equal(h.fields.get('po-note').value,'note only');h.fields.get('po-note').value='';
  assert.equal(h.c.closeModal('purchase-order-modal'),true);assert.equal(questions,1);
  h.c.fixtureId=id;h.run("db.purchaseOrders=[{id:fixtureId,code:'EXISTING',date:'2026-10-01T03:00:24.123Z',supplierId:fixtureId,items:[{productId:fixtureId,productName:'A',qty:1,price:60000,total:60000}],totalAmount:60000,isPaid:false}]");
  await h.c.editPurchaseOrder(id);assert.equal(h.run('poFormInitialState'),h.c.capturePurchaseOrderFormState());
  h.fields.get('po-note').value='editing';assert.equal(h.c.closeModal('purchase-order-modal'),false);
  h.run('db.products[0].stock=15');h.c.confirm=()=>true;assert.equal(h.c.closeModal('purchase-order-modal'),true);
  assert.equal(h.run('db.products[0].stock'),15,'discard must not undo independently committed product changes');
  assert.equal(h.writes.length,0);assert.equal(h.run('db.drafts.purchaseOrders.length'),1);
  assert.notEqual(h.run('JSON.stringify(db)'),before,'fixture intentionally introduced an existing PO and a committed product change');
 }
});

test('restore rejects product-only data before preview and preserves the active data and backup', async () => {
 const model=require('../data-model'),{migratePasswords}=require('../data-authority');
 const data=plain(model.defaults);data.users[0].code='NV0001';data.settings.autoBackup=false;
 data.invoices.push({id:'I',total:50000,items:[{id:1,qty:1,price:50000}]});
 const primary=JSON.stringify(await migratePasswords(data)),backup=JSON.stringify(data);
 const h=makeMain({files:{'/ram/data.json':primary,'/ram/data.json.bak':backup,'/ram/products.json':JSON.stringify({products:data.products})},restorePath:'/ram/products.json'});
 const call=(channel,payload)=>h.handlers.get(channel)(h.event,payload);
 assert.equal((await call('ntkiot:auth-login',{username:'admin',password:'123'})).ok,true);
 assert.equal((await call('ntkiot:restore-prepare')).code,'INVALID_DATA');
 assert.equal(h.files.get('/ram/data.json'),primary);
 assert.equal(h.files.get('/ram/data.json.bak'),backup);
 assert.equal(h.operations.length,0);
});

test('hashed credentials are stripped from public data and the renderer cannot write either credential field', async () => {
 const model=require('../data-model'),{DataAuthority,migratePasswords}=require('../data-authority');
 const data=plain(model.defaults);data.users.push({id:7,user:'staff',name:'Staff',role:'staff',pass:data.users[0].pass});
 const migrated=await migratePasswords(data);
 assert.notEqual(migrated.users[0].passwordHash,migrated.users[1].passwordHash);
 assert.equal(await migratePasswords(migrated),migrated);
 const authority=new DataAuthority(()=>{throw Error('Unexpected write');});authority.adopt(migrated);
 assert.equal((await authority.login({username:'admin',password:'wrong'})).ok,false);
 const result=await authority.login({username:'admin',password:'123'});
 assert.equal(result.ok,true);assert.equal(Object.hasOwn(result.actor,'passwordHash'),false);
 for(const field of ['pass','passwordHash']){
  const projection=plain(authority.publicData());assert.equal(projection.users.some(user=>Object.hasOwn(user,field)),false);
  projection.users[0][field]='forged';
  const rejected=await authority.save({requestId:crypto.randomUUID(),operation:'background-save',baseRevision:result.revision,sessionEpoch:result.sessionEpoch,text:JSON.stringify(projection)});
  assert.equal(rejected.code,'INVALID_DATA');
 }
});

test('backup credential migration preserves an archive on write failure and resumes after restart', async () => {
 const model=require('../data-model'),{migratePasswords}=require('../data-authority');
 const data=plain(model.defaults);data.users[0].code='NV0001';data.settings.autoBackup=false;
 data.invoices.push({id:'I',total:50000,items:[{id:1,qty:1,price:50000}]});
 const primary=JSON.stringify(await migratePasswords(data)),backup=JSON.stringify(data);
 const archive='/ram/backups/backup_old.json';
 const boot=async(files,failRename)=>{
  const h=makeMain({files,failRename,setTimeout:callback=>setTimeout(callback,0)});
  const loaded=await h.handlers.get('ntkiot:data-load-primary')(h.event);
  assert.equal(loaded.saveBlocked,false);
  await vm.runInContext('backupPasswordJob',h.c);
  assert.equal(h.files.get('/ram/data.json'),primary);
  return h;
 };
 const interrupted=await boot({'/ram/data.json':primary,[archive]:backup},archive);
 assert.equal(interrupted.files.get(archive),backup);
 assert.ok(interrupted.logs.some(log=>log.type==='backup-password-migration-pending'));
 const restarted=await boot(Object.fromEntries(interrupted.files));
 const migrated=JSON.parse(restarted.files.get(archive));
 assert.ok(model.validPasswordHash(migrated.users[0].passwordHash));
 assert.equal(Object.hasOwn(migrated.users[0],'pass'),false);
 migrated.users[0]=data.users[0];assert.deepEqual(migrated,data);
});

test('Reset recovery preserves backups when credential migration is already running', async t => {
    const fsp = fs.promises, path = require('node:path'), os = require('node:os');
    const model = require('../data-model'), { migratePasswords } = require('../data-authority');
    const data = plain(model.defaults);
    data.users[0].code = 'NV0001';
    data.settings.autoBackup = false;
    data.invoices = [{ id: 'I', total: 80000, items: [{ id: 'A', qty: 1, price: 80000 }] }];
    const primaryText = JSON.stringify(await migratePasswords(data));
    const oldArchive = JSON.stringify(data);

    for (const phase of ['read', 'prepared', 'moved', 'moved-before-prepared']) await t.test(phase, { timeout: 15000 }, async sub => {
        const userData = await fsp.mkdtemp(path.join(os.tmpdir(), 'ntkiot-migration-reset-'));
        sub.after(() => fsp.rm(userData, { recursive: true, force: true }));
        const primary = path.join(userData, 'data.json'), backup = primary + '.bak';
        const backupDir = path.join(userData, 'backups'), archive = path.join(backupDir, 'backup_legacy.json');
        const pending = path.join(userData, '.ntkiot-reset.pending');
        const staged = path.join(pending, 'data'), stagedBackups = path.join(staged, 'backups');
        const stagedPrimary = path.join(staged, 'data.json');
        const backupDirMoved = phase.startsWith('moved');
        const lockedBackupDir = backupDirMoved ? stagedBackups : backupDir;
        await fsp.mkdir(backupDir);
        for (const file of [primary, backup]) await fsp.writeFile(file, primaryText);
        await fsp.writeFile(archive, oldArchive);

        const paused = Promise.withResolvers(), release = Promise.withResolvers();
        const pause = async () => { paused.resolve(); await release.promise; };
        const faultFs = { ...fsp, readFile: async (file, ...args) => {
            if (phase === 'read' && file === archive) await pause();
            return fsp.readFile(file, ...args);
        }, rename: async (from, to) => {
            const resetMoveFailed = backupDirMoved
                ? from === pending && to === path.join(userData, '.ntkiot-reset.committed') || from === stagedBackups && to === backupDir
                : to === stagedBackups || from === stagedPrimary && to === primary;
            if (resetMoveFailed) {
                throw Object.assign(new Error('fixture rename failed'), { code: 'EIO' });
            }
            const publishingCandidate = path.basename(to).startsWith('.ntkiot-credential-') && to.endsWith('.tmp');
            if (publishingCandidate && phase === 'moved-before-prepared') await pause();
            await fsp.rename(from, to);
            if (publishingCandidate && (phase === 'prepared' || phase === 'moved')) await pause();
        } };
        const channel = (h, name, payload) => h.handlers.get('ntkiot:' + name)(h.event, payload);
        const h = makeMain({ userData, fsp: faultFs, setTimeout });
        const admin = await channel(h, 'auth-login', { username: 'admin', password: '123' });
        assert.equal(admin.ok, true);
        const job = vm.runInContext('backupPasswordJob', h.c);
        const capture = async () => {
            const entries = await fsp.readdir(userData, { recursive: true, withFileTypes: true });
            const files = entries.filter(entry => entry.isFile() && !entry.name.startsWith('.ntkiot-credential-'));
            return Object.fromEntries(await Promise.all(files.map(async entry => {
                const file = path.join(entry.parentPath, entry.name);
                const hash = crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex');
                return [path.relative(userData, file), hash];
            })));
        };
        try {
            await Promise.race([paused.promise, job.then(() => { throw Error('Migration did not reach ' + phase); })]);
            const reset = await channel(h, 'data-reset-all', { requestId: 'migration-interrupted-reset',
                baseRevision: admin.revision, sessionEpoch: admin.sessionEpoch });
            assert.equal(reset.code, 'RESET_RECOVERY_REQUIRED');
            assert.equal((await channel(h, 'data-load-primary')).saveBlocked, true);
            const lockedFiles = await capture();
            assert.equal(await fsp.readFile(path.join(lockedBackupDir, 'backup_legacy.json'), 'utf8'), oldArchive);
            assert.ok(lockedFiles[path.relative(userData, stagedPrimary)]);
            release.resolve();
            await job;
            assert.deepEqual(await capture(), lockedFiles);
            assert.deepEqual(await fsp.readdir(lockedBackupDir), ['backup_legacy.json']);
            assert.equal((await channel(h, 'data-load-primary')).saveBlocked, true);
        } finally {
            release.resolve();
            await job;
        }

        const restarted = makeMain({ userData, fsp, setTimeout });
        const loaded = await channel(restarted, 'data-load-primary');
        assert.deepEqual([loaded.source, loaded.saveBlocked], ['primary', false]);
        await vm.runInContext('backupPasswordJob', restarted.c);
        const migrated = JSON.parse(await fsp.readFile(archive, 'utf8'));
        assert.ok(model.validPasswordHash(migrated.users[0].passwordHash));
        assert.equal(Object.hasOwn(migrated.users[0], 'pass'), false);
        migrated.users[0] = data.users[0];
        assert.deepEqual(migrated, data);
        assert.equal(await fsp.readFile(backup, 'utf8'), primaryText);
    });
});

test('manual export hashes a blocked legacy snapshot and preserves protected paths and existing exports', async t => {
 const fsp=fs.promises,path=require('node:path'),os=require('node:os');
 const model=require('../data-model'),authority=require('../data-authority');
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'ntkiot-export-test-'));
 t.after(()=>fsp.rm(root,{recursive:true,force:true}));
 const profile=path.join(root,'profile'),backups=path.join(profile,'backups'),primary=path.join(profile,'data.json'),backup=primary+'.bak';
 const archive=path.join(backups,'backup_original.json'),external=path.join(root,'export.json');
 await fsp.mkdir(backups,{recursive:true});
 const data=plain(model.defaults);data.users[0].code='NV0001';data.settings.autoBackup=false;data.settings.backupLimit=3;
 data.invoices.push({id:'I',total:50000,items:[{id:1,qty:1,price:50000}]});
 const old=JSON.stringify(data);
 for(const file of [primary,backup,archive])await fsp.writeFile(file,old);
 const extraArchives = ['a', 'b', 'c'].map(id => path.join(backups, 'backup_' + id + '.json'));
 for (const file of extraArchives) await fsp.writeFile(file, old);
 await fsp.writeFile(external,'previous export');
 const linkedDir=path.join(root,'linked-profile'),sym=path.join(root,'linked-primary.json'),hard=path.join(root,'linked-archive.json');
 await fsp.symlink(profile,linkedDir,process.platform==='win32'?'junction':'dir');
 if(process.platform!=='win32')await fsp.symlink(primary,sym);
 await fsp.link(archive,hard);
 const hash=async file=>crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex');
 const before=await Promise.all([primary,backup,archive].map(hash));
 let destination=external,failHash=false,failExport=false,showSaveDialog;
 const faultFs={...fsp,rename:async(from,to)=>{
  if(to===primary || failExport && path.basename(to)===path.basename(external))throw Object.assign(new Error('fixture write failed'),{code:'ENOSPC'});
  return fsp.rename(from,to);
 }};
 const h=makeMain({userData:profile,fsp:faultFs,showSaveDialog:()=>showSaveDialog(),
  dataAuthority:{...authority,migratePasswords:input=>{if(failHash)throw new Error('fixture hash failed');return authority.migratePasswords(input);}}});
 showSaveDialog=async()=>({canceled:false,filePath:destination});
 const call=(channel,payload)=>h.handlers.get(channel)(h.event,payload);
 assert.equal((await call('ntkiot:data-load-primary')).saveBlocked,true);
 assert.equal((await call('ntkiot:auth-login',{username:'admin',password:'123'})).ok,true);
 assert.equal((await call('ntkiot:backup-cleanup')).code, 'INVALID_DATA');
 assert.equal((await call('ntkiot:backup-list')).backups.length, 4);
 for (const file of [archive, ...extraArchives]) assert.equal(await fsp.readFile(file, 'utf8'), old);
 for(const target of [primary,backup,archive,path.join(backups,'new.json'),path.join(linkedDir,'data.json'),hard,
  path.join(profile,'.ntkiot-reset.receipt.json'),path.join(profile,'.ntkiot-reset.rolled-back','file.json'),...(process.platform==='win32'?[]:[sym])]){
  destination=target;
  assert.equal((await call('ntkiot:backup-export')).code,'INVALID_DESTINATION',target);
 }
 assert.deepEqual(await Promise.all([primary,backup,archive].map(hash)),before);
 assert.equal(await fsp.readFile(external,'utf8'),'previous export');
 destination=external;
 failHash=true;
 assert.equal((await call('ntkiot:backup-export')).code,'IO_FAILED');
 failHash=false;failExport=true;
 assert.equal((await call('ntkiot:backup-export')).code,'IO_FAILED');
 failExport=false;
 assert.equal(await fsp.readFile(external,'utf8'),'previous export');
 assert.equal((await call('ntkiot:backup-export')).ok,true);
 const exported=JSON.parse(await fsp.readFile(external,'utf8'));
 assert.equal(exported.users.some(user=>Object.hasOwn(user,'pass')),false);
 assert.ok(model.validPasswordHash(exported.users[0].passwordHash));
 assert.deepEqual(authority.projection(exported),authority.projection(data));
 assert.deepEqual(await Promise.all([primary,backup,archive].map(hash)),before);
 assert.equal((await call('ntkiot:data-load-primary')).saveBlocked,true);

 const restoredProfile=path.join(root,'restored');await fsp.mkdir(restoredProfile);
 const recovered=makeMain({userData:restoredProfile,fsp,restorePath:external});
 const restore=(channel,payload)=>recovered.handlers.get(channel)(recovered.event,payload);
 const admin=await restore('ntkiot:auth-login',{username:'admin',password:'123'});
 assert.ok(admin.ok);
 const preview=await restore('ntkiot:restore-prepare');
 assert.ok(preview.ok);
 assert.equal((await restore('ntkiot:restore-commit',{requestId:'restore-export',token:preview.token,baseRevision:admin.revision,sessionEpoch:admin.sessionEpoch})).committed,true);
 assert.ok((await restore('ntkiot:auth-login',{username:'admin',password:'123'})).ok);
 assert.deepEqual(authority.projection(JSON.parse(await fsp.readFile(path.join(restoredProfile,'data.json'),'utf8'))),authority.projection(exported));

 showSaveDialog=async()=>({canceled:true});
 assert.equal((await call('ntkiot:backup-export')).canceled,true);
 showSaveDialog=async()=>{await call('ntkiot:auth-logout');await call('ntkiot:auth-login',{username:'admin',password:'123'});return {canceled:false,filePath:external};};
 assert.equal((await call('ntkiot:backup-export')).code,'STALE_STATE');
});

test('backup operations preserve recovery files and resume when a valid profile is loaded', async t => {
    const fsp = fs.promises, path = require('node:path'), os = require('node:os');
    const model = require('../data-model'), { migratePasswords } = require('../data-authority');
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ntkiot-backup-boundaries-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const data = plain(model.defaults);
    data.users[0].code = 'NV0001';
    data.settings.autoBackup = false;
    data.invoices.push({ id: 'I', total: 50000, items: [{ id: 1, qty: 1, price: 50000 }] });
    const stored = JSON.stringify(await migratePasswords(data));
    let dialogs = 0;
    const destination = path.join(root, 'export.json');
    const openProfile = async (userData, source, blocked) => {
        const h = makeMain({ userData, fsp, showSaveDialog: async () => {
            dialogs++;
            return { canceled: false, filePath: destination };
        } });
        const call = (name, payload) => h.handlers.get('ntkiot:' + name)(h.event, payload);
        const loaded = await call('data-load-primary');
        assert.deepEqual([loaded.source, loaded.saveBlocked], [source, blocked]);
        assert.equal((await call('auth-login', { username: 'admin', password: '123' })).ok, true);
        return call;
    };
    const fresh = path.join(root, 'fresh');
    await fsp.mkdir(fresh);
    const freshCall = await openProfile(fresh, 'default', false);
    assert.equal((await freshCall('backup-export')).ok, true);
    assert.equal((await freshCall('backup-cleanup')).removed, 0);

    const invalid = path.join(root, 'invalid');
    await fsp.mkdir(invalid);
    await fsp.writeFile(path.join(invalid, 'data.json'), '{broken');
    const invalidCall = await openProfile(invalid, 'default', true);
    assert.equal((await invalidCall('backup-export')).code, 'INVALID_DATA');
    assert.equal((await invalidCall('backup-cleanup')).code, 'INVALID_DATA');

    const profile = path.join(root, 'recovery');
    const primary = path.join(profile, 'data.json'), backup = primary + '.bak';
    const backupDir = path.join(profile, 'backups');
    const staged = path.join(profile, '.ntkiot-reset.pending', 'data');
    await fsp.mkdir(staged, { recursive: true });
    await fsp.mkdir(backupDir);
    await fsp.writeFile(backup, stored);
    const names = Array.from({ length: 61 }, (_, index) => 'backup_' + String(index).padStart(3, '0') + '.json');
    await Promise.all(names.map(async (name, index) => {
        const file = path.join(backupDir, name);
        await fsp.writeFile(file, stored);
        const stamp = new Date(1700000000000 + index * 1000);
        await fsp.utimes(file, stamp, stamp);
    }));
    const previousExport = await fsp.readFile(destination, 'utf8');
    const missingPrimary = await openProfile(profile, 'default', true);
    assert.equal((await missingPrimary('backup-export')).code, 'RESET_RECOVERY_REQUIRED');
    assert.equal((await missingPrimary('backup-cleanup')).code, 'RESET_RECOVERY_REQUIRED');

    await fsp.writeFile(primary, stored);
    const stagedPrimary = path.join(staged, 'data.json');
    await fsp.writeFile(stagedPrimary, stored);
    const blocked = await openProfile(profile, 'primary', true);
    const renderer = make();
    renderer.c.ntkiot.data.listBackups = () => blocked('backup-list');
    renderer.c.ntkiot.data.cleanupBackups = () => blocked('backup-cleanup');
    renderer.c.ntkiot.data.exportBackup = () => blocked('backup-export');
    await renderer.c.cleanupBackupsNow();
    await renderer.c.exportData();
    assert.deepEqual(renderer.toasts.map(([, severity]) => severity), ['error', 'error']);
    assert.match(renderer.toasts[0][0], /phục hồi.*dọn backup/);
    assert.match(renderer.toasts[1][0], /phục hồi.*xuất backup/);
    assert.equal(dialogs, 1);
    assert.equal(await fsp.readFile(destination, 'utf8'), previousExport);
    assert.deepEqual((await fsp.readdir(backupDir)).sort(), names);
    for (const file of [backup, primary, stagedPrimary, ...names.map(name => path.join(backupDir, name))]) {
        assert.equal(await fsp.readFile(file, 'utf8'), stored);
    }

    await fsp.unlink(stagedPrimary);
    const recovered = await openProfile(profile, 'primary', false);
    assert.equal((await recovered('backup-export')).ok, true);
    assert.deepEqual(JSON.parse(await fsp.readFile(destination, 'utf8')).invoices, data.invoices);
    assert.equal((await recovered('backup-cleanup')).removed, 1);
    assert.deepEqual((await fsp.readdir(backupDir)).sort(), names.slice(1));
});

test('backup export rechecks recovery when a Reset cannot roll back while the dialog is open', async t => {
    const fsp = fs.promises, path = require('node:path'), os = require('node:os');
    const model = require('../data-model'), { migratePasswords } = require('../data-authority');
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ntkiot-backup-dialog-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const primary = path.join(root, 'data.json'), backup = primary + '.bak';
    const pending = path.join(root, '.ntkiot-reset.pending', 'data');
    const stagedPrimary = path.join(pending, 'data.json');
    const stagedBackup = stagedPrimary + '.bak';
    const data = plain(model.defaults);
    data.users[0].code = 'NV0001';
    const stored = JSON.stringify(await migratePasswords(data));
    for (const file of [primary, backup]) await fsp.writeFile(file, stored);
    const existing = path.join(root, 'existing.json'), missing = path.join(root, 'missing.json');
    await fsp.writeFile(existing, 'previous export');
    const faultFs = { ...fsp, rename: async (from, to) => {
        if (to === stagedBackup || from === stagedPrimary && to === primary) {
            throw Object.assign(new Error('fixture rename failed'), { code: 'EIO' });
        }
        return fsp.rename(from, to);
    } };
    const opened = Promise.withResolvers(), chosen = Promise.withResolvers();
    const destinations = [existing, missing];
    const h = makeMain({ userData: root, fsp: faultFs, showSaveDialog: async () => {
        const filePath = destinations.shift();
        if (!destinations.length) opened.resolve();
        await chosen.promise;
        return { canceled: false, filePath };
    } });
    const call = (name, payload) => h.handlers.get('ntkiot:' + name)(h.event, payload);
    const admin = await call('auth-login', { username: 'admin', password: '123' });
    assert.equal(admin.ok, true);
    const exports = [call('backup-export'), call('backup-export')];
    await opened.promise;
    const reset = await call('data-reset-all', { requestId: 'interrupted-reset',
        baseRevision: admin.revision, sessionEpoch: admin.sessionEpoch });
    chosen.resolve();
    assert.equal(reset.code, 'RESET_RECOVERY_REQUIRED');
    for (const result of await Promise.all(exports)) assert.equal(result.code, 'RESET_RECOVERY_REQUIRED');
    assert.equal(await fsp.readFile(existing, 'utf8'), 'previous export');
    await assert.rejects(fsp.stat(missing), { code: 'ENOENT' });
    assert.equal(await fsp.readFile(stagedPrimary, 'utf8'), stored);
    assert.equal(await fsp.readFile(backup, 'utf8'), stored);
});

test('management reconciliation renders the stored fractions consistently on screen and in PDF', () => {
    const h = make(), model = require('../data-model');
    const saleDate = '2026-11-20T01:00:00Z', finalDate = '2026-11-21T01:00:00Z';
    const invoice = { id: 'I', date: saleDate, total: 80000, items: [{ id: 'A', qty: 1, price: 50001 }] };
    const oldSlip = { id: 'OLD', invoiceId: invoice.id, date: saleDate,
        returnItems: [{ id: 'A', qty: .5, price: 50001 }], returnTotal: 25000.5, exchangeTotal: 0, difference: 25000.5 };
    const quote = model.quoteLinkedReturn(invoice, [oldSlip], [{ invoiceLineIndex: 0, qty: .5 }]);
    assert.deepEqual([quote.full, quote.total], [true, 54999]);
    const finalSlip = { id: 'NEW', invoiceId: invoice.id, date: finalDate, deletedInvoice: invoice,
        returnItems: quote.items, returnTotal: quote.total, exchangeTotal: 0, difference: quote.total };
    h.c.savedSlips = [finalSlip, oldSlip];
    h.run('db.invoices = []; db.returns = savedSlips;');
    const before = h.run('JSON.stringify(db)');
    let pdf;
    h.fields.set('report-print-iframe', { style: {}, contentDocument: {
        open() {}, write(html) { pdf = html; }, close() {}
    } });
    const from = new Date(saleDate), to = new Date(finalDate);
    const render = (start, end) => {
        const report = h.c.getManagementReportDataForRange(start, end);
        h.c.nextReport = report;
        h.run('mgmtReportData = nextReport');
        h.c.renderManagementReconciliation(report.reconciliation);
        h.c.exportMgmtReportPDF();
        return { report: report.reconciliation, screen: h.fields.get('mgmt-reconciliation').innerHTML, pdf };
    };
    const both = render(from, to);
    assert.deepEqual([both.report.grossSales, both.report.refunds, both.report.netCash], [80000, 79999.5, .5]);
    const textContent = html => html.replace(/<[^>]+>/g, ' ');
    for (const html of [both.screen, both.pdf]) {
        const text = textContent(html);
        assert.match(text, /Hoàn khách:?\s+79\.999,5 ₫/);
        assert.match(text, /Dòng tiền thuần theo phát sinh:?\s+0,5 ₫/);
        assert.match(text, /Thu thêm:?\s+0 ₫/);
        assert.match(text, /80\.000 ₫/);
    }
    const latest = render(to, to);
    assert.deepEqual([latest.report.grossSales, latest.report.refunds, latest.report.netCash], [0, 54999, -54999]);
    for (const html of [latest.screen, latest.pdf]) {
        assert.match(textContent(html), /Dòng tiền thuần theo phát sinh:?\s+-54\.999 ₫/);
    }
    const boundary = [[0, '0 ₫'], [.00049, '0 ₫'], [-.00049, '0 ₫'], [.0005, '0,001 ₫'], [-.0005, '-0,001 ₫']];
    for (const [amount, label] of boundary) assert.equal(h.c.formatManagementReconciliationMoney(amount), label);
    assert.equal(h.run('JSON.stringify(db)'), before);
    assert.equal(h.writes.length, 0);

    const fromStoredRecords = [
        [{ difference: 79999.99951 }, .00049, '0 ₫'],
        [{ difference: 79999.9995 }, .0005, '0,001 ₫'],
        [{ difference: '79999.99949' }, .00051, '0,001 ₫'],
        [{ difference: 80000.00049 }, -.00049, '0 ₫'],
        [{ difference: 80000.0005 }, -.0005, '-0,001 ₫'],
        [{ difference: 80000.00051 }, -.00051, '-0,001 ₫'],
        [{ items: [{ total: 39999.9995 }, { total: 40000 }] }, .0005, '0,001 ₫'],
        [{ refundAmount: 80001, exchangeItems: [{ total: 1 }, { total: 5e-4 }] }, .0005, '0,001 ₫'],
        [{ returnTotal: 80001, refundAmount: 99999, exchangeTotal: 1.0005 }, .0005, '0,001 ₫'],
        [{ returnItems: [{ price: 80000, qty: 1 }], exchangeItems: [{ total: 5e-7 }] }, 5e-7, '0 ₫']
    ];
    const assertStoredResult = (orders, slips, expected, label) => {
        h.c.activeInvoices = orders;
        h.c.slips = slips;
        h.run('db.invoices = activeInvoices; db.returns = slips;');
        const stored = h.run('JSON.stringify(db)');
        const result = render(from, to);
        assert.equal(result.report.netCash, expected, JSON.stringify(slips));
        for (const html of [result.screen, result.pdf]) {
            const line = textContent(html).split('Dòng tiền thuần theo phát sinh')[1];
            assert.ok(line.replace(/^:?\s+/, '').startsWith(label), line);
        }
        assert.equal(h.run('JSON.stringify(db)'), stored);
    };
    for (const [amounts, expected, label] of fromStoredRecords) {
        assertStoredResult([invoice], [{ date: saleDate, invoiceId: invoice.id, ...amounts }], expected, label);
    }

    const mixed = [79999, 1.0004, -.00091].map((difference, index) => ({
        id: 'MIXED-' + index, date: saleDate, invoiceId: invoice.id, difference
    }));
    assertStoredResult([invoice], mixed, .00051, '0,001 ₫');
    assertStoredResult([invoice], mixed.slice().reverse(), .00051, '0,001 ₫');

    const largeInvoices = ['LARGE-A', 'LARGE-B'].map(id => ({ id, date: saleDate, total: 900000000000, items: [] }));
    const largeReturns = largeInvoices.map(order => ({ id: 'R-' + order.id, invoiceId: order.id, date: saleDate, difference: order.total }));
    largeReturns.push({ id: 'LARGE-COLLECTION', invoiceId: largeInvoices[0].id, date: saleDate, difference: -.0005 });
    assertStoredResult(largeInvoices, largeReturns, .0005, '0,001 ₫');
    assert.equal(h.writes.length, 0);
});

test('linked returns reconcile with invoices, stock and customer points after each reload', async t => {
    const fsp = fs.promises, path = require('node:path'), os = require('node:os');
    const model = require('../data-model'), { migratePasswords } = require('../data-authority');
    const userData = await fsp.mkdtemp(path.join(os.tmpdir(), 'ntkiot-reconcile-reload-'));
    t.after(() => fsp.rm(userData, { recursive: true, force: true }));
    const data = plain(model.defaults);
    data.users[0].code = 'NV0001';
    const day = '2026-11-21T02:00:00Z', invoiceId = 'LEGACY-INVOICE';
    Object.assign(data.settings, { autoBackup: false, autoPrint: false, sound: false, pointsEnabled: true, pointsRate: 1 });
    data.custs.push({ id: 'C', name: 'Customer', debt: 0, points: 300, totalBuy: 30000 });
    data.products = ['A', 'B'].map(id => ({ id, code: id, name: id, price: 50000, cost: 30000, stock: id === 'A' ? 10 : 9 }));
    data.invoices = [{ id: invoiceId, date: day, cust: 'Customer', custId: 'C', total: 80000, discount: 20000,
        items: data.products.map(({ id, name, price }) => ({ id, name, price, qty: 1, unit: 'SP', lineTotal: price })), method: 'CASH' }];
    data.returns = [{ id: 'LEGACY-SLIP', invoiceId, date: day, custId: 'C',
        returnItems: [{ id: 'A', name: 'A', price: 50000, qty: 1, total: 50000 }],
        returnTotal: 50000, refundAmount: 50000, exchangeTotal: 0, difference: 50000,
        customerEffects: { customerId: 'C', pointsDelta: -500, totalBuyDelta: -50000 } }];
    data.stockHistory = [{ id: 'legacy-intake', date: day, type: 'in', productId: 'A', qty: 1, price: 50000, total: 50000,
        source: 'return', note: 'Trả hàng - HĐ LEGACY-INVOICE - Phiếu LEGACY-SLIP' }];
    await fsp.writeFile(path.join(userData, 'data.json'), JSON.stringify(await migratePasswords(data)));

    const open = async () => {
        const main = makeMain({ userData, fsp });
        const call = (name, payload) => main.handlers.get('ntkiot:' + name)(main.event, payload);
        const h = make();
        h.c.loaded = await call('data-load-primary');
        h.c.session = await call('auth-login', { username: 'admin', password: '123' });
        assert.deepEqual([h.c.loaded.source, h.c.loaded.saveBlocked, h.c.session.ok], ['primary', false, true]);
        h.c.ntkiot.auth = {};
        h.c.ntkiot.data.save = async (text, options) => {
            h.lastSave = await call('data-save', { ...options, text });
            return h.lastSave;
        };
        h.run('db = JSON.parse(JSON.stringify(loaded.data)); currUser = session.actor; acceptDesktopSession(session);');
        h.c.getAppDate = () => new Date(day);
        return h;
    };
    const issueReturn = async (h, product, expected) => {
        h.lastSave = null;
        for (const id of ['A', 'B']) h.fields.set('return-item-' + id, { checked: product === id });
        h.fields.set('return-qty-' + product, { value: '1', max: '1' });
        h.fields.get('return-reason').value = 'other';
        h.run('currentReturnInvoice = db.invoices[0]');
        await h.c.processReturn();
        assert.equal(h.lastSave?.committed, true, JSON.stringify({ result: h.lastSave, toasts: h.toasts }));
        assert.equal(h.run('db.returns[0].returnTotal'), expected);
        return h.run('db.returns[0].id');
    };
    const state = h => plain(h.run(`(() => {
        const current = db.custs.find(customer => customer.id === 'C');
        const r = getManagementReportDataForRange(new Date('2026-11-21T00:00Z'), new Date('2026-11-22T00:00Z')).reconciliation;
        return { invoices: db.invoices.map(i => i.id), links: db.returns.map(i => i.invoiceId),
            snapshots: db.returns.map(i => i.deletedInvoice?.id), stock: db.products.map(p => p.stock), points: current.points,
            totalBuy: current.totalBuy, refunds: r.refunds, gross: r.grossSales, net: r.netCash };
    })()`));
    let h = await open();
    const slipB = await issueReturn(h, 'B', 30000);
    h.lastSave = null;
    await h.c.deleteReturn('LEGACY-SLIP');
    assert.equal(h.lastSave?.committed, true, JSON.stringify(h.lastSave));
    const slipA = await issueReturn(h, 'A', 50000);
    const fullyReturned = { invoices: [], links: [invoiceId, invoiceId], snapshots: [invoiceId, invoiceId],
        stock: [10, 10], points: 0, totalBuy: 0, refunds: 80000, gross: 80000, net: 0 };
    h = await open();
    assert.deepEqual(state(h), fullyReturned);
    await h.c.deleteReturn(slipA);
    assert.equal(h.lastSave?.committed, true, JSON.stringify(h.lastSave));
    h = await open();
    assert.equal(h.run('db.returns[0].id'), slipB);
    assert.deepEqual(state(h), { invoices: [invoiceId], links: [invoiceId], snapshots: [invoiceId],
        stock: [9, 10], points: 500, totalBuy: 50000, refunds: 30000, gross: 80000, net: 50000 });
    await issueReturn(h, 'A', 50000);
    h = await open();
    assert.deepEqual(state(h), fullyReturned);
});

test('legacy Reset residue unlocks writes only when all original storage can be verified', async t => {
 const fsp=fs.promises,path=require('node:path'),os=require('node:os');
 const model=require('../data-model'),{migratePasswords}=require('../data-authority');
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'ntkiot-legacy-reset-'));
 t.after(()=>fsp.rm(root,{recursive:true,force:true}));
 const data=plain(model.defaults);data.users[0].code='NV0001';data.settings.autoBackup=false;
 const stored=JSON.stringify(await migratePasswords(data));
 for(const condition of ['complete','empty-backups','missing-primary','missing-bak','missing-folder','bad-primary','bad-bak','bad-archive','unidentified','staged-data']){
  const profile=path.join(root,condition),primary=path.join(profile,'data.json'),backup=primary+'.bak',archives=path.join(profile,'backups');
  const pending=path.join(profile,'.ntkiot-reset.pending'),payload=path.join(pending,'data');
  await fsp.mkdir(payload,{recursive:true});
  if(condition!=='missing-primary')await fsp.writeFile(primary,condition==='bad-primary'?'{}':stored);
  if(condition!=='missing-bak')await fsp.writeFile(backup,condition==='bad-bak'?'{}':stored);
  if(condition!=='missing-folder'){
   await fsp.mkdir(archives);
   if(condition!=='empty-backups')await fsp.writeFile(path.join(archives,'backup_old.json'),condition==='bad-archive'?'{}':stored);
  }
  if(condition==='unidentified')await fsp.writeFile(path.join(pending,'unexpected.json'),'{}');
  if(condition==='staged-data')await fsp.writeFile(path.join(payload,'data.json'),stored);
  const capture=async()=>Object.fromEntries(await Promise.all((await fsp.readdir(profile,{recursive:true,withFileTypes:true}))
   .filter(entry=>entry.isFile()).map(async entry=>{const file=path.join(entry.parentPath,entry.name);return [path.relative(profile,file),await fsp.readFile(file,'utf8')];})));
  const before=await capture(),h=makeMain({userData:profile,fsp});
  const call=(channel,payload)=>h.handlers.get(channel)(h.event,payload);
  const loaded=await call('ntkiot:data-load-primary'), safe=['complete','empty-backups'].includes(condition);
  assert.equal(loaded.saveBlocked,!safe,condition);
  assert.deepEqual(await capture(),before);
  if(safe){
   assert.equal(fs.existsSync(pending),false);
   const admin=await call('ntkiot:auth-login',{username:'admin',password:'123'});
   const result=await call('ntkiot:data-save',{requestId:'save-after-rollback',operation:'background-save',baseRevision:admin.revision,
    sessionEpoch:admin.sessionEpoch,text:JSON.stringify(loaded.data)});
   assert.equal(result.committed,true,condition);
  }else assert.equal(fs.existsSync(pending),true);
 }
});

test('replaying a committed Reset after restart cannot discard newly recorded data', async t => {
 const fsp=fs.promises,path=require('node:path'),os=require('node:os');
 const model=require('../data-model'),{migratePasswords}=require('../data-authority');
 const profile=await fsp.mkdtemp(path.join(os.tmpdir(),'ntkiot-reset-replay-'));
 t.after(()=>fsp.rm(profile,{recursive:true,force:true}));
 const primary=path.join(profile,'data.json');
 const fixture=plain(model.defaults);fixture.users[0].code='NV0001';fixture.settings.autoBackup=false;
 fixture.invoices.push({id:'BEFORE',items:[],total:0});
 await fsp.writeFile(primary,JSON.stringify(await migratePasswords(fixture)));
 let clearCalls=0;
 const boot=()=>{
  const h=makeMain({userData:profile,fsp,executeJavaScript:async code=>{assert.match(code,/localStorage.clear/);clearCalls++;return true;}});
  return (channel,payload)=>h.handlers.get(channel)(h.event,payload);
 };
 const initial=boot();
 const admin=await initial('ntkiot:auth-login',{username:'admin',password:'123'});
 assert.ok(admin.ok);
 const request={requestId:'reset-fixture',baseRevision:admin.revision,sessionEpoch:admin.sessionEpoch,operation:'resetApp'};
 assert.equal((await initial('ntkiot:data-reset-all',request)).committed,true);
 assert.equal(fs.existsSync(primary),false);
 const restarted=boot();
 const loaded=await restarted('ntkiot:data-load-primary');
 assert.equal(loaded.saveBlocked,false);
 assert.equal(loaded.data.invoices.length,0);
 assert.equal(clearCalls,1);
 assert.equal(fs.existsSync(path.join(profile,'.ntkiot-reset.committed')),false);
 const current=await restarted('ntkiot:auth-login',{username:'admin',password:'123'});
 const next=plain(loaded.data);next.products[0].stock--;
 const item=next.products[0],price=item.price,date=new Date().toISOString();
 next.invoices.unshift({id:'AFTER',date,custId:1,items:[{id:item.id,name:item.name,qty:1,price,lineTotal:price}],subtotal:price,discount:0,pointsUsed:0,pointsValue:0,total:price,given:price,change:0});
 next.stockHistory.unshift({id:'SALE-AFTER',date,type:'out',productId:item.id,productName:item.name,qty:1,price,total:price,source:'sale',note:'Bán hàng - HĐ AFTER',user:'Admin'});
 const receipt=await restarted('ntkiot:data-save',{requestId:'new-sale',baseRevision:current.revision,sessionEpoch:current.sessionEpoch,operation:'directCheckout',text:JSON.stringify(next)});
 assert.equal(receipt.committed,true);
 const bytes=await fsp.readFile(primary,'utf8');
 assert.equal((await restarted('ntkiot:data-commit-status',{requestId:request.requestId})).committed,true);
 assert.equal((await restarted('ntkiot:data-reset-all',request)).committed,true);
 assert.equal(await fsp.readFile(primary,'utf8'),bytes);
 assert.equal(clearCalls,1);
});
