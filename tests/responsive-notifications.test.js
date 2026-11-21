const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const events = require('../notification-events');
const policy = require('../notifications');

function browserPolicy() {
    const timers = new Map(), listeners=[]; let nextTimer = 0;
    class Element {
        constructor() { this.children=[]; this.dataset={}; this.style={}; this.attributes={}; this.hidden=true; this.textContent=''; this.className=''; }
        get classList() { return { contains: name=>this.className.split(' ').includes(name) }; }
        get childElementCount() { return this.children.length; }
        appendChild(node) { node.remove(); this.children.push(node); node.parentElement=this; return node; }
        remove() { if(this.parentElement) { const children=this.parentElement.children; children.splice(children.indexOf(this),1); this.parentElement=null; } }
        setAttribute(k,v) { this.attributes[k]=v; }
    }
    const fields = new Map(['toast-box','pos-notifications','pos-view'].map(id=>[id,new Element()]));
    fields.get('pos-view').className='view active';
    const modal=new Element(); modal.className='modal-overlay';
    const context = { NTKIOTNotificationEvents:events, document:{body:new Element(),getElementById:id=>fields.get(id),querySelectorAll:()=>[modal],createElement:()=>new Element(),addEventListener:(...args)=>listeners.push(args)},
        MutationObserver:class{observe(){}},getComputedStyle:()=>({lineHeight:'20px',fontSize:'16px'}),
        setTimeout:(fn,ms)=>{timers.set(++nextTimer,{fn,ms});return nextTimer;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:()=>1 };
    vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname,'../notifications.js'),'utf8'),context);
    return { api:context.NTKIOTNotifications,fields,timers,modal,listeners };
}

test('UI20261021-09: one wheel handler scrolls only visible overflowing toast content and retains timers',()=>{
    const {api,fields,timers,modal,listeners}=browserPolicy();api.init();api.init();
    const wheels=listeners.filter(([type])=>type==='wheel');assert.equal(wheels.length,1);assert.equal(wheels[0][2].passive,false);assert.equal(wheels[0][2].capture,true);
    modal.className='modal-overlay active';api.emit('long text','error',false,'inventory.ma-da-duoc-dung-cho-san-pham');
    const box=fields.get('toast-box'),toast=box.children[0];box.clientHeight=100;box.scrollHeight=300;box.scrollTop=0;box.getBoundingClientRect=()=>({left:20,top:20,right:480,bottom:120});toast.getBoundingClientRect=()=>({left:20,top:20,right:480,bottom:300});
    const wheel=wheels[0][1],event=(extra={})=>({clientX:50,clientY:50,deltaY:30,deltaMode:0,cancelable:true,preventDefault(){this.defaultPrevented=true},...extra});
    let e=event();wheel(e);assert.equal(box.scrollTop,30);assert.equal(e.defaultPrevented,true);
    wheel(event({deltaY:2,deltaMode:1}));assert.equal(box.scrollTop,70);wheel(event({deltaY:1,deltaMode:2}));assert.equal(box.scrollTop,170);
    wheel(event({deltaY:500}));assert.equal(box.scrollTop,200);e=event();wheel(e);assert.equal(box.scrollTop,200);assert.equal(e.defaultPrevented,true,'boundary does not scroll the background');
    wheel(event({deltaY:-120}));assert.equal(box.scrollTop,80);wheel(event({deltaY:-200}));assert.equal(box.scrollTop,0);e=event({deltaY:-10});wheel(e);assert.equal(e.defaultPrevented,true);
    for(const extra of [{clientX:10},{ctrlKey:true},{metaKey:true},{cancelable:false}]){e=event(extra);wheel(e);assert.equal(e.defaultPrevented,undefined)}
    toast.getBoundingClientRect=()=>({left:20,top:20,right:480,bottom:45});e=event({clientY:60});wheel(e);assert.equal(e.defaultPrevented,undefined,'blank area stays transparent to wheel');
    assert.equal([...timers.values()][0].ms,3500);api.commit({enabled:false,disabledEventIds:[]});assert.equal(box.scrollTop,0);assert.equal(box.hidden,true);
});

test('notification registry has stable unique IDs, Vietnamese labels and quiet POS defaults only',()=>{
    assert.equal(new Set(events.map(e=>e.id)).size,events.length);
    assert.ok(events.length>200);
    for(const event of events) {
        assert.match(event.id,/^[A-Za-z0-9.-]+$/);
        assert.ok(event.label && event.group);
        if(!event.defaultEnabled) {
            assert.ok(['pos','returns'].includes(event.group));
            assert.ok(!['error','warning'].includes(event.severity));
            assert.equal(event.mixed,false);
        }
    }
    assert.equal(events.find(e=>e.id==='pos.da-tao-ma-vach-moi').defaultEnabled,true,'barcode generation is not scanner noise');
});

test('every notification registry event has a production caller; metadata never becomes a runtime text filter',()=>{
    const source=fs.readFileSync(path.join(__dirname,'../script.js'),'utf8');
    for(const event of events)assert.ok(source.includes(JSON.stringify(event.id))||source.includes(`'${event.id}'`),event.id);
    // Portable drift sentinel; the release audit additionally parses the AST.
    // There is one eventId forwarding call and one two-ID popup branch, which
    // cancel in the count. A new untagged/unregistered call must fail this check.
    const calls=(source.match(/\b(?:toast|showToast|setPosScanStatus)\s*\(/g)||[]).length;
    const declarations=(source.match(/function (?:toast|showToast|setPosScanStatus)\s*\(/g)||[]).length;
    const references=events.reduce((sum,event)=>sum+source.split(JSON.stringify(event.id)).length-1+source.split(`'${event.id}'`).length-1,0);
    assert.equal(calls-declarations,references,'notification caller drift requires an explicit registry audit');
    const moduleSource=fs.readFileSync(path.join(__dirname,'../notifications.js'),'utf8');
    assert.doesNotMatch(moduleSource,/disabled.*(?:message|text)\.match|new RegExp/);
    assert.match(source,/function toast\(m, t = "success", dedupe = true, eventId\)/);
    assert.match(source,/function showToast\(message, type = 'info', dedupe = true, eventId\)/);
});

test('retired purchase-order draft events are absent while sales draft notifications remain registered',()=>{
    const retired = ["purchase.da-co-toi-da-20-don-nhap-luu-tam-hay", "purchase.da-luu-ban-nhap-don-nhap", "purchase.chua-co-san-pham-nao", "purchase.da-tai-ban-nhap-don-nhap", "purchase.da-tai-ban-nhap"];
    for(const id of retired)assert.equal(events.some(event=>event.id===id),false,id);
    assert.equal(events.some(event=>event.id==='pos.da-luu-ban-nhap-don-hang'),true);
});

test('legacy/malformed preferences default safely without modifying input or adding persisted fields',()=>{
    const input={enabled:'false',disabledEventIds:'all'};
    const before=JSON.stringify(input), normalized=policy.normalize(input);
    assert.equal(normalized.enabled,true); assert.ok(normalized.disabledEventIds.includes('pos.da-quet'));
    assert.equal(JSON.stringify(input),before);
    assert.deepEqual(policy.normalize({enabled:false,disabledEventIds:['future.event','future.event',null,7]}),
        {version:1,enabled:false,disabledEventIds:['future.event']});
    assert.deepEqual(policy.normalize({enabled:true,disabledEventIds:[]}),{version:1,enabled:true,disabledEventIds:[]});
});

test('default scanner success is suppressed but warnings render safely above POS payment',()=>{
    const {api,fields}=browserPolicy();
    api.emit('Đã quét: <img src=x onerror=bad()>','success',true,'pos.da-quet');
    assert.equal(fields.get('pos-notifications').childElementCount,0);
    api.emit('<img src=x onerror=bad()>','warning',true,'pos.da-dat-gioi-han-ton-kho');
    const node=fields.get('pos-notifications').children[0];
    assert.equal(node.textContent,'⚠️ <img src=x onerror=bad()>');
    assert.equal(node.children.length,0); assert.equal(node.attributes.role,'alert');
    assert.equal(fields.get('toast-box').hidden,true);
});

test('master off suppresses all severities and unknown events, not upstream validation return values',()=>{
    const {api,fields}=browserPolicy();api.commit({enabled:false,disabledEventIds:[]});
    for(const type of ['success','info','warning','error'])assert.equal(api.emit('hidden',type,false,'unknown.future'),undefined);
    assert.equal(fields.get('toast-box').childElementCount+fields.get('pos-notifications').childElementCount,0);
    api.commit({enabled:true,disabledEventIds:['unknown.future']});
    api.emit('unknown shown','error',false,'unknown.future');
    assert.equal(fields.get('pos-notifications').childElementCount,1);
});

test('muted messages do not consume dedupe and commits remove visible notices/timers without replay',()=>{
    const {api,fields,timers}=browserPolicy();
    api.emit('same','success',true,'pos.da-quet');
    api.commit({enabled:true,disabledEventIds:[]});api.emit('same','success',true,'pos.da-quet');
    assert.equal(fields.get('pos-notifications').childElementCount,1);
    api.commit({enabled:true,disabledEventIds:['pos.da-quet']});
    assert.equal(fields.get('pos-notifications').childElementCount,0); assert.equal(timers.size,0);
    api.commit({enabled:true,disabledEventIds:[]});assert.equal(fields.get('pos-notifications').childElementCount,0);
    api.emit('same','success',true,'pos.da-quet');assert.equal(fields.get('pos-notifications').childElementCount,1);
    const copy=api.preferences();copy.disabledEventIds.push('pos.da-quet');assert.equal(api.allowed('pos.da-quet'),true);
});

test('UI-06: dedupe expires with the matching visible toast',()=>{
    const {api,fields,timers}=browserPolicy();
    api.emit('Nhập tên khách hàng','error',true,'customers.nhap-ten-khach');
    assert.equal(fields.get('pos-notifications').childElementCount,1);
    const timer=[...timers.keys()][0];timers.get(timer).fn();
    assert.equal(fields.get('pos-notifications').childElementCount,0);
    api.emit('Nhập tên khách hàng','error',true,'customers.nhap-ten-khach');
    api.emit('Nhập tên khách hàng','error',true,'customers.nhap-ten-khach');
    assert.equal(fields.get('pos-notifications').childElementCount,1);
});

test('route/modal docking retains node identity and timeout, undo replacement retains 3000ms lifetime',()=>{
    const {api,fields,timers,modal}=browserPolicy();
    api.emit('warn','warning',false,'pos.da-dat-gioi-han-ton-kho');
    const node=fields.get('pos-notifications').children[0], timer=[...timers.keys()][0];
    assert.equal(timers.get(timer).ms,3500);
    modal.className='modal-overlay active';api.dock();assert.equal(fields.get('toast-box').children[0],node);
    modal.className='modal-overlay';api.dock();assert.equal(fields.get('pos-notifications').children[0],node);assert.ok(timers.has(timer));
    api.emit('undo 1','info',false,'pos.performUndo.message','undo');
    api.emit('undo 2','success',false,'pos.performUndo.message','undo');
    assert.equal(fields.get('pos-notifications').children.filter(n=>n.className.includes('undo-toast')).length,1);
    assert.equal([...timers.values()].filter(t=>t.ms===3000).length,1);
    timers.get(timer).fn();assert.ok(!fields.get('pos-notifications').children.includes(node));
});

test('only the four history tables are responsive; definitions hide exactly the approved columns',()=>{
    const tables=require('../responsive-tables').definitions;
    assert.deepEqual(Object.keys(tables),['hist-body','returns-body','mgmt-stock-history-body','inv-stock-history-body']);
    assert.deepEqual(tables['hist-body'].hide,['customer','staff','payment']);
    assert.deepEqual(tables['returns-body'].hide,['customer','staff']);
    for(const id of ['mgmt-stock-history-body','inv-stock-history-body'])assert.deepEqual(tables[id].hide,['note','user']);
});
