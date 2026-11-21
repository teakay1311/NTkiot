const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const model = require('../data-model');
const { DataAuthority, policies } = require('../data-authority');
const clone = value => JSON.parse(JSON.stringify(value));

test('AUDIT-A01: sale/return/edit/delete owners reject orphan stock and customer deltas before writing', async () => {
    const owners = ['directCheckout','finishOrder','checkoutReturn','checkoutReturnExchange','processQuickReturn',
        'processQuickReturnExchange','processReturn','saveEditInvoice','confirmDeleteInvoice','confirmBulkDeleteInvoices','deleteReturnRecords'];
    for (const owner of owners) for (const field of ['stock','points','totalBuy','debt']) {
        const { authority, request, writes } = await setup();
        const before = clone(authority.publicData()), revision = authority.revision, next = clone(before);
        if (field === 'stock') next.products[0].stock += 100;
        else next.custs[1][field] += 100;
        const result = await authority.save(request(owner, next));
        assert.equal(result.committed, false, `${owner}/${field}`);
        assert.equal(writes.length, 0); assert.deepEqual(authority.publicData(), before); assert.equal(authority.revision, revision);
    }
});

test('AUDIT-A01: real sale effects, sibling deltas and document tampering are checked independently', async () => {
    for (const owner of ['directCheckout','finishOrder']) {
        for (const field of ['stock','points','totalBuy','debt','history','old-invoice']) {
            const {authority,request,writes}=await setup();
            assert.equal((await authority.save(request(owner,validSale(authority,'FIRST')))).committed,true);
            const next=validSale(authority,'SECOND'),before=clone(authority.publicData());
            if(field==='stock')next.products[0].stock++;
            else if(field==='history')next.stockHistory.shift();
            else if(field==='old-invoice')next.invoices[1].note='forged';
            else next.custs[1][field]++;
            assert.equal((await authority.save(request(owner,next))).committed,false,owner+'/'+field);
            assert.deepEqual(authority.publicData(),before);assert.equal(writes.length,1);
        }
    }
});

test('AUDIT-A01: invoice undo applies only its receipt after an intervening sale and consumes only after write', async () => {
    let failWrite=false;
    const {authority,request}=await setup('staff',async()=>{if(failWrite)throw Error('ENOSPC')});
    assert.equal((await authority.save(request('directCheckout',validSale(authority,'FIRST')))).ok,true);
    const deleted=clone(authority.publicData()),invoice=deleted.invoices.shift(),date='2026-10-20T00:00:00.000Z';
    deleted.products[0].stock++;deleted.custs[1].points-=10;deleted.custs[1].totalBuy-=1000;
    deleted.stockHistory.unshift({id:'DELETE-FIRST',date,type:'in',productId:'P',productName:'Product',qty:1,price:1000,total:1000,
        note:'Hoàn kho - Xóa HĐ FIRST',user:'Staff',source:'delete_return'});
    const deletion=request('confirmDeleteInvoice',deleted);
    assert.equal((await authority.save(deletion)).ok,true);
    assert.equal((await authority.save(request('directCheckout',validSale(authority,'SECOND')))).ok,true);
    const undo=clone(authority.publicData());undo.invoices.push(invoice);undo.products[0].stock--;undo.custs[1].points+=10;undo.custs[1].totalBuy+=1000;
    undo.stockHistory=undo.stockHistory.filter(h=>h.id!=='DELETE-FIRST');
    const before=clone(authority.publicData());failWrite=true;
    assert.equal((await authority.save(request('performUndo',undo,{undoReceiptId:deletion.requestId}))).committed,false);
    assert.deepEqual(authority.publicData(),before);assert.equal(authority.receipts.get(deletion.requestId).business[0].undone,undefined);
    failWrite=false;const payload=request('performUndo',undo,{undoReceiptId:deletion.requestId});
    assert.equal((await authority.save(payload)).ok,true);assert.equal(authority.data.products[0].stock,8);assert.equal(authority.data.custs[1].totalBuy,7000);
    assert.equal((await authority.save(payload)).ok,true,'ACK retry returns its receipt without applying twice');
    assert.equal((await authority.save(request('performUndo',undo,{undoReceiptId:deletion.requestId}))).committed,false);
});

test('AUDIT-A01: ordered bulk deletion preserves clamped points and supports each undo item after intervening sales', async () => {
    for (const id of [0, '0']) for (const restock of [true, false]) for (const reversed of [false, true]) {
        const {authority, request} = await setup();
        const date = '2026-10-20T00:00:00.000Z';
        const a = {id, date, custId:'C', total:0, pointsUsed:10, items:[{id:'P',qty:1,price:0}]};
        const b = {id:'B', date, custId:'C', total:1000, pointsUsed:0, items:[{id:'P',qty:1,price:1000}]};
        authority.data.invoices = [a,b]; authority.data.custs[1].points=0; authority.data.custs[1].totalBuy=1000;
        const next = clone(authority.publicData()), order = reversed ? [b,a] : [a,b];
        next.invoices=[];next.custs[1].points=reversed?10:0;next.custs[1].totalBuy=0;
        if(restock){next.products[0].stock=12;next.stockHistory=order.map(inv=>({id:'D-'+inv.id,date,type:'in',productId:'P',productName:'Product',qty:1,price:inv.items[0].price,total:inv.total,source:'bulk_delete_return',note:'Hoàn kho - Xóa HĐ '+inv.id,user:'Staff'}));}
        const before=clone(authority.publicData());
        for(const ids of [undefined,[id,id],['missing','B'],order.map(inv=>inv.id).reverse()]){
            const result=await authority.save(request('confirmBulkDeleteInvoices',next,{orderedInvoiceIds:ids}));
            assert.equal(result.committed,false);assert.deepEqual(authority.publicData(),before);
        }
        const deletion=request('confirmBulkDeleteInvoices',next,{orderedInvoiceIds:order.map(inv=>inv.id)});
        assert.equal((await authority.save(deletion)).committed,true);
        assert.equal(authority.data.custs[1].points,reversed?10:0);
        assert.equal((await authority.save(request('directCheckout',validSale(authority,'LATER')))).committed,true);
        // UI undoes the last selected invoice first. Preserve the subsequent sale.
        for(const inv of [...order].reverse()){
            const undo=clone(authority.publicData());undo.invoices.unshift(inv);
            if(restock)undo.products[0].stock--;
            undo.custs[1].totalBuy+=inv.total;
            undo.custs[1].points=Math.max(0,undo.custs[1].points+(inv===b?10:-10));
            undo.stockHistory=undo.stockHistory.filter(h=>h.id!=='D-'+inv.id);
            assert.equal((await authority.save(request('performUndo',undo,{undoReceiptId:deletion.requestId}))).committed,true);
        }
        assert.equal(authority.data.products[0].stock,9);assert.equal(authority.data.custs[1].totalBuy,2000);
        assert.equal(authority.receipts.get(deletion.requestId).business.filter(t=>t.undone).length,2);
    }
});

test('AUDIT-A05: pending logs preserve the canonical prefix, including the 500-entry limit and cross-session authors', async () => {
    for(const count of [0,3,500]) for(const guest of [false,true]){
        const {authority,request}=await setup();if(guest)await authority.logout();
        const stamp='2026-10-20T00:00:00.000Z';
        authority.data.activityLog=Array.from({length:count},(_,i)=>({id:'OLD-'+i,date:stamp,user:'Staff',action:'Old',detail:String(i)}));
        authority.backupReceipts.set('backup',{stamp,revision:authority.revision,epoch:authority.epoch});
        const next=clone(authority.publicData());next.settings.lastBackupAt=stamp;
        next.activityLog=[{id:0,date:stamp,user:'Previous session',action:'Đăng xuất',detail:''},{id:'LOGIN',date:stamp,user:'Manager',action:'Đăng nhập',detail:''},...next.activityLog].slice(0,500);
        const payload=request('performBackup',next,{backupReceiptId:'backup'});
        assert.equal((await authority.save(payload)).committed,true);assert.deepEqual(authority.data.activityLog,next.activityLog);
        assert.equal((await authority.save(payload)).committed,true,'lost ACK retry is idempotent');
        assert.equal((await authority.save(request('performBackup',next,{backupReceiptId:'backup'}))).committed,false,'receipt consumed');
    }
});

test('AUDIT-A05: metadata failure retains the receipt; log tampering, stale receipt and sibling changes do not write', async () => {
    let failWrite=true,writes=0;
    const {authority,request}=await setup('staff',async()=>{if(failWrite)throw Error('ENOSPC');writes++});
    const stamp='2026-10-20T00:00:00.000Z',entry={id:'OLD',date:stamp,user:'Staff',action:'Old',detail:'retained'};
    authority.data.activityLog=[entry,{...entry,id:'OLD-2'}];
    authority.backupReceipts.set('backup',{stamp,revision:authority.revision,epoch:authority.epoch});
    const valid=clone(authority.publicData());valid.settings.lastBackupAt=stamp;
    valid.activityLog.unshift({...entry,id:'NEW',user:'Admin'});
    for(const mutate of [
        d=>{d.activityLog[1].detail='forged'},d=>{d.activityLog.reverse()},d=>{d.activityLog.pop()},
        d=>{d.activityLog[0].extra=true},d=>{delete d.activityLog[0].detail},d=>{d.activityLog[0].date='bad'},
        d=>{d.products[0].stock++},d=>{d.settings.lastBackupAt='forged'},d=>{d.settings.name='forged'}
    ]){const next=clone(valid);mutate(next);assert.equal((await authority.save(request('performBackup',next,{backupReceiptId:'backup'}))).code,'FORBIDDEN');}
    const before=clone(authority.publicData()),revision=authority.revision;
    assert.equal((await authority.save(request('performBackup',valid,{backupReceiptId:'backup'}))).code,'IO_FAILED');
    assert.deepEqual(authority.publicData(),before);assert.equal(authority.revision,revision);assert.equal(authority.backupReceipts.has('backup'),true);
    failWrite=false;assert.equal((await authority.save(request('performBackup',valid,{backupReceiptId:'backup'}))).committed,true);assert.equal(writes,1);
    authority.backupReceipts.set('stale',{stamp,revision,epoch:authority.epoch});
    assert.equal((await authority.save(request('performBackup',valid,{backupReceiptId:'stale'}))).code,'FORBIDDEN');
    authority.backupReceipts.set('epoch',{stamp,revision:authority.revision,epoch:authority.epoch-1});
    assert.equal((await authority.save(request('performBackup',valid,{backupReceiptId:'epoch'}))).code,'FORBIDDEN');
});

test('AUDIT-A01: each return owner accepts fractional lines, canonical effects and exact undo for zero/default/free customers', async () => {
    for(const owner of ['checkoutReturn','checkoutReturnExchange','processQuickReturn','processQuickReturnExchange','processReturn'])
    for(const cid of [0,'0',1,null]){
        const {authority,request}=await setup();const linked=owner==='processReturn',real=cid===0||cid==='0';
        authority.data.custs[1].id=real?cid:'C';
        const date='2026-10-20T00:00:00.000Z',invoice={id:0,date,custId:cid,total:1000,items:[{id:'P',qty:1,price:1000}]};
        if(linked)authority.data.invoices=[invoice];
        const next=clone(authority.publicData());next.products[0].stock+=0.5;
        if(real){next.custs[1].points=65;if(linked)next.custs[1].totalBuy=4500;}
        const r={id:'R',date,custId:cid,returnItems:[{id:'P',qty:0.5,price:1000,total:500}],exchangeItems:[],returnTotal:500,exchangeTotal:0,difference:500};
        if(linked){r.invoiceId=0;r.returnItems[0].invoiceLineIndex=0;r.returnItems[0].unit='SP';r.returnPointsRate=1;r.returnPointsReversed=5;}else if(owner.startsWith('processQuick'))r.invoiceId='QUICK_RETURN';
        if(!linked||real)r.customerEffects={customerId:cid,pointsDelta:real?-5:0,totalBuyDelta:real&&linked?-500:0};
        if(owner==='processQuickReturnExchange')r.pointsReversed=real?5:0;
        next.returns.unshift(r);
        const label=linked?'Trả hàng - HĐ 0':owner==='checkoutReturn'?'Trả hàng (Tab)':owner==='checkoutReturnExchange'?'Trả hàng':owner==='processQuickReturnExchange'?'Trả hàng nhanh (QR)':'Trả hàng nhanh';
        next.stockHistory.unshift({id:'HR',date,type:'in',productId:'P',productName:'Product',qty:0.5,price:1000,total:500,source:owner.startsWith('processQuick')?'quick_return':'return',note:label+' - Phiếu R',user:'Staff'});
        const before=clone(authority.publicData()),payload=request(owner,next);
        for(const field of ['stock','debt','effects','old-invoice']){
            if(field==='old-invoice'&&!linked)continue;
            const bad=clone(next);
            if(field==='stock')bad.products[0].stock++;
            else if(field==='debt')bad.custs[1].debt++;
            else if(field==='effects')bad.returns[0].customerEffects={customerId:cid,pointsDelta:999,totalBuyDelta:999};
            else bad.invoices[0].note='forged';
            assert.equal((await authority.save(request(owner,bad))).committed,false,owner+'/'+field+'/'+cid);
            assert.deepEqual(authority.publicData(),before);
        }
        assert.equal((await authority.save(payload)).committed,true,owner+'/'+cid);
        const undo=clone(before);assert.equal((await authority.save(request('performUndo',undo,{undoReceiptId:payload.requestId}))).committed,true,'undo '+owner+'/'+cid);
        assert.deepEqual(authority.publicData(),before);
    }
});

test('AUDIT-A01: return deletion honors explicit order and rejects missing/duplicate/reversed metadata atomically',async()=>{
 for(const id of [0,'0'])for(const reversed of [false,true]){
  let failWrite=false;const {authority,request}=await setup('staff',async()=>{if(failWrite)throw Error('ENOSPC')});
  const date='2026-10-20T00:00:00.000Z';authority.data.custs[1].points=0;
  const plus={id,custId:'C',invoiceId:'I',returnItems:[{id:'P',qty:1,price:1000}],exchangeItems:[{id:'P',qty:2,price:1000}],returnTotal:1000,exchangeTotal:2000,customerEffects:{customerId:'C',pointsDelta:10,totalBuyDelta:1000}};
  const minus={id:'MINUS',custId:'C',invoiceId:'QUICK_RETURN',returnItems:[{id:'P',qty:1,price:1000}],returnTotal:1000,customerEffects:{customerId:'C',pointsDelta:-10,totalBuyDelta:0}};
  authority.data.returns=[plus,minus];
  authority.data.stockHistory=[{id:'HP',source:'return',note:'Trả hàng - Phiếu '+id},{id:'HM',source:'quick_return',note:'Trả hàng nhanh - Phiếu MINUS'},{id:'OTHER',source:'return',note:'Trả hàng - Phiếu OTHER'}];
  const before=clone(authority.publicData()),next=clone(before),order=reversed?['MINUS',id]:[id,'MINUS'];
  next.returns=[];next.custs[1].points=reversed?0:10;next.custs[1].totalBuy=4000;next.stockHistory=[before.stockHistory[2]];
  for(const ids of [undefined,[id,id],['missing','MINUS'],[...order].reverse()]){
   assert.equal((await authority.save(request('deleteReturnRecords',next,{orderedReturnIds:ids}))).committed,false);assert.deepEqual(authority.publicData(),before);
  }
  failWrite=true;assert.equal((await authority.save(request('deleteReturnRecords',next,{orderedReturnIds:order}))).code,'IO_FAILED');assert.deepEqual(authority.publicData(),before);
  failWrite=false;const payload=request('deleteReturnRecords',next,{orderedReturnIds:order});assert.equal((await authority.save(payload)).committed,true);
  assert.equal(authority.data.custs[1].points,reversed?0:10);assert.equal(authority.data.products[0].stock,10);assert.deepEqual(authority.data.stockHistory,next.stockHistory);
  assert.equal((await authority.save(payload)).committed,true);assert.equal(authority.data.custs[1].points,reversed?0:10);
 }
});

test('AUDIT-A01: new money headers reject non-numeric coercions and disabled-points redemption',async()=>{
 for(const field of ['subtotal','discount','pointsUsed','pointsValue','total','given','change']){
  const {authority,request,writes}=await setup(),before=clone(authority.publicData()),next=validSale(authority);
  next.invoices[0][field]=false;
  assert.equal((await authority.save(request('directCheckout',next))).committed,false,field);assert.equal(writes.length,0);assert.deepEqual(authority.publicData(),before);
 }
 const {authority,request}=await setup();authority.data.settings.pointsEnabled=false;
 const next=validSale(authority),inv=next.invoices[0];Object.assign(inv,{pointsUsed:1,pointsValue:1000,total:0,given:0,change:0});next.custs[1].points=69;next.custs[1].totalBuy=5000;
 assert.equal((await authority.save(request('finishOrder',next))).committed,false);
});

test('AUDIT-A01: legacy return deletion uses canonical fallback and rejects conflicting invoice restoration',async()=>{
 for(const linked of [false,true]){
  const {authority,request}=await setup();const before=clone(authority.publicData());
  const invoice={id:'OLD',items:[{id:'P',qty:2,price:1000}],total:2000,custId:'C'};
  const r={id:'OLD-R',custId:'C',invoiceId:linked?'OLD':'QUICK_RETURN',returnItems:[{id:'P',qty:1,price:1000}],returnTotal:1000,exchangeTotal:0};
  if(linked)r.deletedInvoice=invoice;
  authority.data.returns=[r];
  const next=clone(authority.publicData());next.returns=[];next.products[0].stock=9;next.custs[1].points=80;if(linked){next.custs[1].totalBuy=6000;next.invoices.push(invoice);}
  if(linked){authority.data.invoices=[{...invoice,note:'Different canonical document'}];const invalid=clone(next);invalid.invoices=clone(authority.data.invoices);assert.equal((await authority.save(request('deleteReturnRecords',invalid,{orderedReturnIds:['OLD-R']}))).committed,false);authority.data.invoices=[];}
  assert.equal((await authority.save(request('deleteReturnRecords',next,{orderedReturnIds:['OLD-R']}))).committed,true);
  assert.equal(authority.data.products[0].stock,9);assert.equal(authority.data.custs[1].points,80);assert.equal(authority.data.custs[1].totalBuy,linked?6000:5000);
  assert.deepEqual(authority.data.suppliers,before.suppliers);
 }
});

test('AUDIT-A01: a valid financial transaction cannot erase or rewrite unrelated canonical activity logs',async()=>{
 for(const tamper of ['erase','rewrite']){
  const {authority,request}=await setup();authority.data.activityLog=[{id:'OLD',date:'2026-10-20T00:00:00.000Z',user:'Staff',action:'Previous',detail:'Keep'}];
  const next=validSale(authority),before=clone(authority.publicData());
  if(tamper==='erase')next.activityLog=[];else next.activityLog[0].detail='Forged';
  assert.equal((await authority.save(request('directCheckout',next))).committed,false);assert.deepEqual(authority.publicData(),before);
 }
});

test('AUDIT-A01: return undo restores the applied capped effects after an intervening sale, not requested points twice',async()=>{
 const {authority,request}=await setup();authority.data.custs[1].points=3;const date='2026-10-20T00:00:00.000Z';
 const returned=clone(authority.publicData());returned.products[0].stock=11;returned.custs[1].points=0;
 returned.returns=[{id:'R',date,invoiceId:'QUICK_RETURN',custId:'C',returnItems:[{id:'P',qty:1,price:1000,total:1000}],returnTotal:1000,customerEffects:{customerId:'C',pointsDelta:-3,totalBuyDelta:0}}];
 returned.stockHistory=[{id:'HR',date,type:'in',productId:'P',productName:'Product',qty:1,price:1000,total:1000,source:'quick_return',note:'Trả hàng nhanh - Phiếu R',user:'Staff'}];
 const receipt=request('processQuickReturn',returned);assert.equal((await authority.save(receipt)).committed,true);
 assert.equal((await authority.save(request('directCheckout',validSale(authority,'AFTER')))).committed,true);
 const undo=clone(authority.publicData());undo.returns=[];undo.stockHistory=undo.stockHistory.filter(h=>h.id!=='HR');undo.products[0].stock=9;undo.custs[1].points=13;
 const bad=clone(undo);bad.custs[1].points=260;
 assert.equal((await authority.save(request('performUndo',bad,{undoReceiptId:receipt.requestId}))).committed,false);
 assert.equal((await authority.save(request('performUndo',undo,{undoReceiptId:receipt.requestId}))).committed,true);
 assert.equal(authority.data.custs[1].points,13);assert.equal(authority.data.custs[1].totalBuy,6000);assert.equal(authority.data.invoices.length,1);
});

test('AUDIT-A01: undo keeps intervening changes to another product and customer intact',async()=>{
 const {authority,request}=await setup();authority.data.products.push({id:'OTHER',name:'Other product',stock:30,price:1000,cost:600});authority.data.custs.push({id:'D',name:'Other customer',points:100,totalBuy:5000,debt:0});
 const date='2026-10-20T00:00:00.000Z';assert.equal((await authority.save(request('directCheckout',validSale(authority,'FIRST')))).committed,true);
 const removed=clone(authority.publicData()),inv=removed.invoices.shift();removed.products[0].stock=10;removed.custs[1].points=70;removed.custs[1].totalBuy=5000;
 removed.stockHistory.unshift({id:'DELETE',date,type:'in',productId:'P',productName:'Product',qty:1,price:1000,total:1000,source:'delete_return',note:'Hoàn kho - Xóa HĐ FIRST',user:'Staff'});
 const receipt=request('confirmDeleteInvoice',removed);assert.equal((await authority.save(receipt)).committed,true);
 const later=clone(authority.publicData());later.products[1].stock=29;later.custs[2].points=110;later.custs[2].totalBuy=6000;
 later.invoices.unshift({...inv,id:'OTHER-SALE',custId:'D',cust:'Other customer',items:[{id:'OTHER',qty:1,price:1000,lineTotal:1000}]});
 later.stockHistory.unshift({id:'HO',date,type:'out',productId:'OTHER',productName:'Other product',qty:1,price:1000,total:1000,source:'sale',note:'Bán hàng - HĐ OTHER-SALE',user:'Staff'});
 assert.equal((await authority.save(request('finishOrder',later))).committed,true);
 const undo=clone(authority.publicData());undo.invoices.push(inv);undo.products[0].stock=9;undo.custs[1].points=80;undo.custs[1].totalBuy=6000;undo.stockHistory=undo.stockHistory.filter(h=>h.id!=='DELETE');
 assert.equal((await authority.save(request('performUndo',undo,{undoReceiptId:receipt.requestId}))).committed,true);
 assert.deepEqual(authority.data.products[1],later.products[1]);assert.deepEqual(authority.data.custs[2],later.custs[2]);assert.deepEqual(authority.data.invoices[0],later.invoices[0]);
});

test('AUDIT-A01: product/customer IDs 0 and string 0 retain their original type in a real sale commit',async()=>{
 for(const id of [0,'0']){
  const {authority,request}=await setup(),next=validSale(authority);
  authority.data.products[0].id=id;authority.data.custs[1].id=id;
  next.products[0].id=id;next.custs[1].id=id;next.invoices[0].custId=id;next.invoices[0].items[0].id=id;next.stockHistory[0].productId=id;
  const duplicate=clone(next);duplicate.products.push({...duplicate.products[0],id:typeof id==='number'?'0':0});
  assert.equal((await authority.save(request('directCheckout',duplicate))).committed,false);
  assert.equal((await authority.save(request('directCheckout',next))).committed,true);
  assert.equal(authority.data.products[0].id,id);assert.equal(authority.data.custs[1].id,id);assert.equal(authority.data.products[0].stock,9);assert.equal(authority.data.custs[1].points,80);
 }
});

test('AUDIT-A01: empty legacy invoice references use the same quick-return deletion formula',async()=>{
 for(const invoiceId of ['',false]){
  const {authority,request}=await setup();authority.data.returns=[{id:'LEGACY',invoiceId,custId:'C',returnTotal:1000,exchangeTotal:0,returnItems:[{id:'P',qty:1,price:1000}]}];
  const next=clone(authority.publicData());next.returns=[];next.products[0].stock=9;next.custs[1].points=80;
  assert.equal((await authority.save(request('deleteReturnRecords',next,{orderedReturnIds:['LEGACY']}))).committed,true);
  assert.equal(authority.data.custs[1].totalBuy,5000);assert.equal(authority.data.custs[1].points,80);
 }
});

function fixture() {
    const data = clone(model.defaults);
    data.users = [
        { id: 'A', user: 'admin', pass: 'admin-fixture', name: 'Admin', code: 'NV0001', role: 'admin' },
        { id: 'M', user: 'manager', pass: 'manager-fixture', name: 'Manager', code: 'NV0002', role: 'manager' },
        { id: 'S', user: 'staff', pass: 'staff-fixture', name: 'Staff', code: 'NV0003', role: 'staff', baseSalary: 100, commission: 2 }
    ];
    data.products = [{ id: 'P', name: 'Product', code: 'FIXTURE', stock: 10, price: 1000, cost: 600 }];
    data.custs.push({ id: 'C', name: 'Customer', points: 70, totalBuy: 5000, debt: 0 });
    data.settings.autoBackup = false;
    return data;
}
async function setup(role = 'staff', write) {
    const writes = [];
    const authority = new DataAuthority(write || (async text => writes.push(JSON.parse(text))));
    authority.adopt(fixture());
    const login = await authority.login({ username: role, password: `${role}-fixture` });
    assert.equal(login.ok, true);
    const request = (operation, data = authority.publicData(), extra = {}) => ({ operation, text: JSON.stringify(data),
        requestId: crypto.randomUUID(), baseRevision: authority.revision, sessionEpoch: authority.epoch, ...extra });
    return { authority, writes, request };
}

function validSale(authority, id = 'SALE') {
    const next = clone(authority.publicData()), date = '2026-10-20T00:00:00.000Z';
    next.products[0].stock -= 1;
    next.custs.find(c => c.id === 'C').points += 10;
    next.custs.find(c => c.id === 'C').totalBuy += 1000;
    next.invoices.unshift({id,date,cust:'Customer',custId:'C',items:[{id:'P',name:'Product',qty:1,price:1000,lineTotal:1000}],
        subtotal:1000,discount:0,pointsUsed:0,pointsValue:0,total:1000,given:1000,change:0});
    next.stockHistory.unshift({id:'H-'+id,date,type:'out',productId:'P',productName:'Product',qty:1,price:1000,total:1000,
        note:'Bán hàng - HĐ '+id,user:authority.actor().name,source:'sale'});
    return next;
}

test('registry covers exactly every one of the 58 coordinated mutation owners', () => {
    const source = fs.readFileSync(require.resolve('../script.js'), 'utf8');
    const owners = [...new Set([...source.matchAll(/beginDataMutation\('([^']+)'/g)].map(match => match[1]))];
    assert.equal(owners.length, 58);
    assert.deepEqual(owners.sort(), Object.keys(policies).sort());
});

test('A01/A05: missing, malformed and numeric/string duplicate identities reject without altering input', () => {
    for (const collection of ['users', 'custs']) for (const invalid of [undefined, null, '', {}, NaN, Infinity]) {
        const data = fixture(); data[collection][0].id = invalid;
        assert.throws(() => model.normalize(data), new RegExp(`${collection}\\[0\\]\\.id`));
    }
    for (const collection of ['users', 'custs']) {
        const data = fixture(); data[collection][0].id = 7; data[collection][1].id = '7';
        const before = JSON.stringify(data);
        assert.throws(() => model.normalize(data), /định danh trùng/);
        assert.equal(JSON.stringify(data), before);
        data[collection][1].id = '007';
        assert.doesNotThrow(() => model.normalize(data));
    }
});

test('A02: reject malformed names/barcodes but keep optional legacy barcode and financial normalization', () => {
    for (const name of [undefined, null, 123, '', '   ']) {
        const data = fixture(); data.products[0].name = name;
        assert.throws(() => model.normalize(data), /products\[0\]\.name/);
    }
    for (const code of [123, {}, [], true]) {
        const data = fixture(); data.products[0].code = code;
        assert.throws(() => model.normalize(data), /products\[0\]\.code/);
    }
    for (const code of [undefined, null, '']) {
        const data = fixture(); data.products[0].code = code; data.products[0].stock = '10';
        const result = model.normalize(data);
        assert.equal(result.products[0].code, ''); assert.equal(result.products[0].stock, 10);
    }
});

test('A06: load projection and session never expose canonical passwords', async () => {
    const { authority } = await setup();
    assert.ok(authority.publicData().users.every(user => !Object.hasOwn(user, 'pass')));
    assert.equal(Object.hasOwn(authority.session().actor, 'pass'), false);
    assert.equal(authority.data.users[0].pass, 'admin-fixture');
    assert.equal((await authority.login({ username: 'admin', password: ' admin-fixture ' })).ok, false);
    assert.equal(authority.actor(), null);
});

test('A06: forged owner/role/system flag cannot elevate staff or alter settings', async () => {
    for (const operation of ['background-save', 'saveSets', 'saveUser', 'performUndo', 'performBackup', 'ensureUserCodes', 'validateAllBarcodes', 'unknown']) {
        const { authority, writes, request } = await setup();
        const data = clone(authority.publicData()); data.users[2].role = 'admin'; data.settings.name = 'forged';
        const result = await authority.save(request(operation, data, { role: 'admin', system: true, userId: 'A' }));
        assert.equal(result.ok, false, operation); assert.equal(result.committed, false);
        assert.equal(writes.length, 0); assert.equal(authority.data.users[2].role, 'staff');
    }
});

test('A06: operation collection and product/customer field guards reject sibling changes', async () => {
    for (const [operation, mutate] of [
        ['directCheckout', data => { data.products[0].price = 1; }],
        ['directCheckout', data => { data.custs[1].name = 'wrong'; }],
        ['saveDebt', data => { data.custs[1].points = 0; }],
        ['saveDraft', data => { data.drafts.purchaseOrders.push({ id: 'PO-DRAFT', data: {} }); }],
        ['performUndo', data => { data.products[0].cost = 0; }]
    ]) {
        const { authority, request, writes } = await setup(); const data = clone(authority.publicData()); mutate(data);
        const extra = operation === 'saveDebt' ? { debtChange: { customerId: 'C', kind: 'add', amount: 1, note: '' } } : {};
        assert.equal((await authority.save(request(operation, data, extra))).code, 'FORBIDDEN'); assert.equal(writes.length, 0);
    }
});

test('unchanged legacy product without ID does not block a valid sale; mutating that record fails closed',async()=>{
    const {authority,request}=await setup();
    authority.data.products.push({name:'Legacy read-only product',code:'',stock:0,price:1000,cost:600});
    let data=validSale(authority);
    assert.equal((await authority.save(request('directCheckout',data))).ok,true);
    data=clone(authority.publicData());data.products[1].stock=1;
    assert.equal((await authority.save(request('directCheckout',data))).code,'FORBIDDEN');
});

test('canonical credentials survive ordinary save and staff profile edit, remain absent from returned actor', async () => {
    const { authority, request, writes } = await setup();
    const data = clone(authority.publicData()); data.users[2].name = 'Updated';
    const result = await authority.save(request('saveUser', data, { accountChange: { kind: 'edit', targetId: 'S' } }));
    assert.equal(result.ok, true); assert.equal(writes.length, 1);
    assert.equal(writes[0].users[2].pass, 'staff-fixture');
    assert.equal(Object.hasOwn(result.actor, 'pass'), false);
});

test('staff profile edit cannot bypass old-password validation via account metadata', async () => {
    const {authority,request,writes}=await setup();
    const data=clone(authority.publicData()); data.users[2].name='Updated';
    assert.equal((await authority.save(request('saveUser',data,{accountChange:{kind:'edit',targetId:'S',newPassword:'bypass'}}))).code,'FORBIDDEN');
    assert.equal(writes.length,0); assert.equal(authority.data.users[2].pass,'staff-fixture');
});

test('navigation invalidation clears actor and tokens after pending write resolves', async () => {
    let release,started;
    const entered=new Promise(resolve=>{started=resolve;});
    const gate=new Promise(resolve=>{release=resolve;});
    const {authority,request}=await setup('staff',async()=>{started();await gate;});
    const pending=authority.save(request('background-save')); await entered;
    const epoch=authority.epoch,invalidated=authority.invalidateSession();
    assert.equal(authority.actor().role,'staff'); release();
    assert.equal((await pending).committed,true); await invalidated;
    assert.equal(authority.actor(),null); assert.equal(authority.epoch,epoch+1);
});

test('undo requires a committed receipt belonging to the same actor and epoch', async () => {
    const {authority,request,writes}=await setup();
    const removed=clone(authority.publicData());removed.custs.pop();
    const deletion=request('delCust',removed);
    assert.equal((await authority.save(deletion)).committed,true);
    const restored=clone(authority.publicData());restored.custs.push(fixture().custs[1]);
    assert.equal((await authority.save(request('performUndo',restored))).code,'FORBIDDEN');
    assert.equal((await authority.save(request('performUndo',restored,{undoReceiptId:deletion.requestId}))).ok,true);
    const second=request('delCust',removed);assert.equal((await authority.save(second)).ok,true);
    await authority.login({username:'manager',password:'manager-fixture'});
    assert.equal((await authority.save(request('performUndo',restored,{undoReceiptId:second.requestId}))).code,'FORBIDDEN');
    assert.equal(writes.length,3);
});

test('staff own-password change verifies old password and rolls back on durable failure', async () => {
    for (const failWrite of [false, true]) {
        const { authority, request } = await setup('staff', async () => { if (failWrite) throw Error('ENOSPC'); });
        const extra = { accountChange: { kind: 'changeOwnPassword', targetId: 'S', oldPassword: 'wrong', newPassword: 'new-fixture' } };
        assert.equal((await authority.save(request('changeOwnPassword', authority.publicData(), extra))).code, 'FORBIDDEN');
        extra.accountChange.oldPassword = 'staff-fixture';
        const result = await authority.save(request('changeOwnPassword', authority.publicData(), extra));
        assert.equal(result.ok, !failWrite);
        assert.equal(authority.data.users[2].pass, failWrite ? 'staff-fixture' : undefined);
        if (!failWrite) assert.ok(model.validPasswordHash(authority.data.users[2].passwordHash));
        assert.equal((await authority.login({username:'staff', password: failWrite ? 'staff-fixture' : 'new-fixture'})).ok, true);
        assert.equal(authority.data.users[0].pass, 'admin-fixture');
    }
});

test('manager edits staff profile but cannot edit admins, salary, role or ordinary disableLogin', async () => {
    for (const kind of ['profile', 'salary', 'role', 'admin', 'disableLogin']) {
        const { authority, request } = await setup('manager'); const data = clone(authority.publicData());
        if (kind === 'disableLogin') {
            data.settings.disableLogin = true;
            assert.equal((await authority.save(request('saveSets', data))).code, 'FORBIDDEN'); continue;
        }
        const targetId = kind === 'admin' ? 'A' : 'S';
        const target = data.users.find(user => user.id === targetId);
        if (kind === 'salary') target.baseSalary = 500;
        else if (kind === 'role') target.role = 'admin'; else target.name = 'Edited';
        const result = await authority.save(request('saveUser', data, { accountChange: { kind: 'edit', targetId } }));
        assert.equal(result.ok, kind === 'profile', kind);
    }
});

test('admin creation/deletion retain credentials and last-admin invariant', async () => {
    const { authority, request } = await setup('admin');
    const data = clone(authority.publicData()); data.users.push({ id: 'NEW', user: 'new', name: 'New', role: 'staff' });
    assert.equal((await authority.save(request('saveUser', data, { accountChange: { kind: 'create', targetId: 'NEW', newPassword: 'fixture' } }))).ok, true);
    assert.equal(authority.data.users.at(-1).pass, undefined);
    assert.ok(model.validPasswordHash(authority.data.users.at(-1).passwordHash));
    const invalid = clone(authority.publicData()); invalid.users = invalid.users.filter(user => user.id !== 'A');
    assert.equal((await authority.save(request('delUser', invalid, { accountChange: { kind: 'delete', targetId: 'A' } }))).code, 'INVALID_DATA');
    assert.ok(authority.data.users.some(user => user.id === 'A'));
});

test('stale revision/epoch, no session and raw password payload fail before write', async () => {
    const { authority, request, writes } = await setup();
    assert.equal((await authority.save(request('background-save', authority.publicData(), { baseRevision: 'stale' }))).code, 'STALE_STATE');
    assert.equal((await authority.save(request('background-save', authority.publicData(), { sessionEpoch: -1 }))).code, 'STALE_STATE');
    assert.equal((await authority.save(request('background-save', fixture()))).code, 'INVALID_DATA');
    await authority.logout();
    assert.equal((await authority.save(request('background-save'))).code, 'AUTH_REQUIRED');
    assert.equal(writes.length, 0);
});

test('duplicate request commits once; changed payload with same ID rejects; unknown receipt is not failure proof', async () => {
    const { authority, request, writes } = await setup();
    const payload = request('background-save');
    const result = await authority.save(payload);
    assert.deepEqual(await authority.save(payload), result); assert.equal(writes.length, 1);
    assert.deepEqual(authority.commitStatus(payload.requestId), result);
    await assert.rejects(authority.save({ ...payload, text: payload.text + ' ' }), /INVALID_DATA/);
    assert.equal(authority.commitStatus('unknown').code, 'UNKNOWN_COMMIT');
});

test('write failure leaves canonical projection/revision untouched and serial queue resumes', async () => {
    let shouldFail = true;
    const { authority, request } = await setup('staff', async () => { if (shouldFail) throw Error('ENOSPC'); });
    const before = JSON.stringify(authority.data), revision = authority.revision;
    const result = await authority.save(request('background-save'));
    assert.equal(result.committed, false); assert.equal(JSON.stringify(authority.data), before); assert.equal(authority.revision, revision);
    shouldFail = false; assert.equal((await authority.save(request('background-save'))).committed, true);
});

test('logout waits for inflight durable write, then revokes the old session', async () => {
    let release, entered;
    const writing = new Promise(resolve => { entered = resolve; });
    const { authority, request } = await setup('staff', () => new Promise(resolve => { release = resolve; entered(); }));
    const payload = request('background-save'), save = authority.save(payload);
    await writing; const logout = authority.logout();
    assert.equal(authority.actor().id, 'S');
    release(); assert.equal((await save).committed, true); await logout;
    assert.equal(authority.actor(), null);
    assert.equal((await authority.save({ ...payload, requestId: crypto.randomUUID() })).code, 'STALE_STATE');
});

test('backup receipt permits only issued metadata and is consumed after successful commit', async () => {
    const { authority, request } = await setup();
    const stamp = '2026-10-09T00:00:00.000Z';
    authority.backupReceipts.set('receipt', { stamp, revision: authority.revision, epoch: authority.epoch });
    const data = clone(authority.publicData()); data.settings.lastBackupAt = stamp; data.settings.name = 'forged';
    assert.equal((await authority.save(request('performBackup', data, { backupReceiptId: 'receipt' }))).code, 'FORBIDDEN');
    data.settings.name = authority.data.settings.name;
    assert.equal((await authority.save(request('performBackup', data, { backupReceiptId: 'receipt' }))).ok, true);
    assert.equal(authority.backupReceipts.has('receipt'), false);
});

test('canonical identity lookup fails closed if RAM unexpectedly becomes ambiguous', async () => {
    const { authority, request, writes } = await setup();
    authority.data.users.push({ ...authority.data.users[2], role: 'admin' });
    assert.equal(authority.actor(), null);
    assert.equal((await authority.save(request('background-save'))).code, 'AUTH_REQUIRED'); assert.equal(writes.length, 0);
});

for (const operation of Object.keys(policies)) {
    test(`write boundary ${operation}: forged account role never authorizes a generic database save`, async () => {
        for (const role of ['guest', 'staff', 'manager', 'admin']) {
            const { authority, request, writes } = await setup(role === 'guest' ? 'staff' : role);
            if (role === 'guest') await authority.logout();
            const before = JSON.stringify(authority.data), revision = authority.revision;
            const next = clone(authority.publicData());
            next.users.find(user => user.id === 'S').role = 'admin';
            const result = await authority.save(request(operation, next, { role: 'admin', actorId: 'A', system: true }));
            assert.equal(result.ok, false, `${operation}/${role}`);
            assert.equal(result.committed, false, `${operation}/${role}`);
            assert.equal(writes.length, 0); assert.equal(authority.revision, revision);
            assert.equal(JSON.stringify(authority.data), before);
        }
    });
}

test('receipt cache is bounded to 128 requests and never stores payloads or passwords', async () => {
    const { authority, request } = await setup('staff');
    let first;
    for (let i = 0; i < 130; i++) {
        const payload = request('background-save');
        if (!i) first = payload.requestId;
        assert.equal((await authority.save(payload)).committed, true);
    }
    assert.equal(authority.receipts.size, 128);
    assert.equal(authority.commitStatus(first).code, 'UNKNOWN_COMMIT');
    for (const receipt of authority.receipts.values()) {
        assert.equal(Object.hasOwn(receipt, 'text'), false);
        assert.equal(JSON.stringify(receipt).includes('staff-fixture'), false);
    }
});

test('malformed JSON is INVALID_DATA, not an I/O failure, and reveals no input fragment', async () => {
    const { authority, request, writes } = await setup('staff');
    const revision = authority.revision;
    const result = await authority.save({ ...request('background-save'), text: '{"pass": SECRET-FIXTURE}' });
    assert.equal(result.code, 'INVALID_DATA'); assert.equal(result.committed, false);
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
    assert.equal(writes.length, 0); assert.equal(authority.revision, revision);
});

test('unregistered or non-string operation fails closed with a validation/permission result', async () => {
    for (const operation of ['toString', 'constructor', ['saveSets'], { name: 'saveSets' }]) {
        const { authority, request, writes } = await setup('admin');
        const result = await authority.save(request(operation));
        assert.equal(result.committed, false);
        assert.ok(['INVALID_DATA', 'FORBIDDEN'].includes(result.code), String(operation));
        assert.equal(writes.length, 0);
    }
});

async function paymentAuthority(role='admin', id=0, failWrite=false) {
 const data=fixture(),writes=[];
 data.suppliers=[{id:'A',name:'NCC A',debt:100000},{id:'B',name:'NCC B',debt:90000},{id:'C',name:'Other',debt:123}];
 data.purchaseOrders=[{id,code:'PN-A',supplierId:'A',totalAmount:60000,isPaid:false,items:[]},
 {id:'A2',supplierId:'A',totalAmount:40000,isPaid:false,items:[]},{id:'B1',supplierId:'B',totalAmount:90000,isPaid:false,items:[]},
 {id:'PAID',supplierId:'A',totalAmount:25000,isPaid:true,paidDate:'2026-10-01T00:00:00.000Z',items:[]}];
 const authority=new DataAuthority(async text=>{if(failWrite)throw Error('ENOSPC');writes.push(JSON.parse(text))});authority.adopt(data);
 if(role!=='guest')assert.equal((await authority.login({username:role,password:`${role}-fixture`})).ok,true);
 const next=clone(authority.publicData());next.purchaseOrders[0].isPaid=true;next.purchaseOrders[0].paidDate='2026-10-20T01:00:00.000Z';
 next.purchaseOrders[2].isPaid=true;next.purchaseOrders[2].paidDate=next.purchaseOrders[0].paidDate;
 next.suppliers[0].debt=40000;next.suppliers[1].debt=0;
 next.activityLog.unshift({id:123,date:'2026-10-20T01:00:00.000Z',action:'Thanh toán đơn nhập hàng loạt',detail:'2 đơn - 150.000',user:authority.actor()?.name||'System'});
 const request=(data=next)=>({operation:'markSelectedPOsAsPaid',text:JSON.stringify(data),requestId:crypto.randomUUID(),baseRevision:authority.revision,sessionEpoch:authority.epoch});
 return {authority,writes,next,request};
}

test('R01 authority: admin/manager commit exact debts once; staff/guest are rejected',async()=>{
 for(const role of ['admin','manager','staff','guest'])for(const id of [0,'0','PO-ID']){
  const h=await paymentAuthority(role,id),before=JSON.stringify(h.authority.data),request=h.request();
  const result=await h.authority.save(request);const allowed=['admin','manager'].includes(role);
  assert.equal(result.committed,allowed,role);assert.equal(h.writes.length,allowed?1:0);
  if(allowed){assert.deepEqual(h.authority.data.suppliers.map(s=>s.debt),[40000,0,123]);assert.equal(h.authority.data.purchaseOrders[0].id,id);assert.equal((await h.authority.save(request)).committed,true);assert.equal(h.writes.length,1)}
  else assert.equal(JSON.stringify(h.authority.data),before);
 }
});

test('R01 authority: field, transition, order, debt and journal tampering are rejected atomically',async()=>{
 const changes=[
  d=>d.products[0].stock++, d=>d.purchaseOrders[0].totalAmount++,d=>d.purchaseOrders.reverse(),d=>d.purchaseOrders.pop(),
  d=>d.purchaseOrders.push({...d.purchaseOrders[0],id:'NEW'}),d=>d.purchaseOrders[3].isPaid=false,
  d=>d.purchaseOrders[3].paidDate='2026-10-20T01:00:00.000Z',d=>d.purchaseOrders[0].paidDate='invalid',
  d=>d.purchaseOrders[2].paidDate='2026-10-20T02:00:00.000Z',d=>d.suppliers[0].debt=0,
  d=>d.suppliers[2].debt=0,d=>d.suppliers[0].name='changed',d=>d.suppliers.reverse(),d=>d.activityLog=[],
  d=>d.purchaseOrders[0].id='0',d=>d.purchaseOrders[0].isPaid=false
 ];
 for(const [index,change] of changes.entries()){
  const h=await paymentAuthority(),before=JSON.stringify(h.authority.data);change(h.next);
  const result=await h.authority.save(h.request());assert.equal(result.committed,false,String(index));
  assert.equal(h.writes.length,0);assert.equal(JSON.stringify(h.authority.data),before);
 }
});

test('R01 authority: durable write failure and stale session/revision leave all records intact',async()=>{
 for(const mode of ['write','session','revision']){
  const h=await paymentAuthority('admin',0,mode==='write'),before=JSON.stringify(h.authority.data),request=h.request();
  if(mode==='session')await h.authority.logout();if(mode==='revision')h.authority.adopt(h.authority.data);
  const result=await h.authority.save(request);assert.equal(result.committed,false);assert.equal(result.code,mode==='write'?'IO_FAILED':'STALE_STATE');
  assert.equal(h.writes.length,0);assert.equal(JSON.stringify(h.authority.data),before);
 }
});

test('R01 authority: pending login logs and the 500-entry limit do not block the first payment',async()=>{
 for(const length of [0,3,500]){
  const h=await paymentAuthority();const canonical=Array.from({length},(_,i)=>({id:'L'+i,date:'2026-10-01T00:00:00.000Z',user:'Admin',action:'Old '+i,detail:'preserved'}));
  h.authority.data.activityLog=clone(canonical);
  const payment=h.next.activityLog[0],login={id:'LOGIN',date:'2026-10-20T00:00:00.000Z',user:'Admin',action:'Đăng nhập',detail:'Admin'};
  h.next.activityLog=[payment,login,...clone(canonical)].slice(0,500);
  const request=h.request(),result=await h.authority.save(request);assert.equal(result.committed,true,String(length));
  assert.deepEqual(h.authority.data.activityLog,h.next.activityLog);assert.equal(h.writes.length,1);
  if(length){const forged=await paymentAuthority();forged.authority.data.activityLog=clone(canonical);forged.next.activityLog=[payment];assert.equal((await forged.authority.save(forged.request())).committed,false)}
 }
});

async function bulkPOAuthority(role='admin',id=0,write){
 const data=fixture(),date='2026-10-20T01:00:00.000Z';
 data.products=[{id:'P',name:'Product',stock:20,price:25000,cost:15000},{id:'Q',name:'Other',stock:30,price:30000,cost:20000}];
 data.suppliers=[{id:'A',name:'A',debt:100000},{id:'B',name:'B',debt:90000},{id:'C',name:'Unrelated',debt:123}];
 data.purchaseOrders=[[id,'A',60000,false,'P',4,15000],['A2','A',40000,false,'Q',2,20000],['B1','B',90000,false,'P',6,15000],['PAID','A',25000,true,'P',1,25000]].map(([id,supplierId,totalAmount,isPaid,productId,qty,price])=>({id,code:'PN-'+id,date,supplierId,supplierName:supplierId,totalAmount,isPaid,...(isPaid?{paidDate:'2026-10-01T00:00:00.000Z'}:{}),items:[{productId,productName:productId==='P'?'Product':'Other',qty,price,total:totalAmount}]}));
 data.stockHistory=data.purchaseOrders.map((po,i)=>({id:'H'+i,date,type:'in',productId:po.items[0].productId,productName:po.items[0].productName,qty:po.items[0].qty,price:po.items[0].price,total:po.totalAmount,purchaseOrderId:po.id,source:'purchase_order',note:'Đơn nhập: '+po.code,user:'Admin'}));
 data.stockHistory.push({id:'OTHER',date,type:'in',productId:'P',qty:3,note:'Other adjustment'});
 const writes=[],authority=new DataAuthority(write|| (async text=>writes.push(JSON.parse(text))));authority.adopt(data);
 if(role!=='guest')assert.equal((await authority.login({username:role,password:role+'-fixture'})).ok,true);
 const request=(operation,next,extra={})=>({operation,text:JSON.stringify(next),requestId:crypto.randomUUID(),baseRevision:authority.revision,sessionEpoch:authority.epoch,...extra});
 const proposal=revert=>{const next=clone(authority.publicData());next.purchaseOrders=[next.purchaseOrders[1]];next.products[0].stock=revert?9:20;next.suppliers[0].debt=40000;next.suppliers[1].debt=0;
 if(revert)next.stockHistory=next.stockHistory.filter(h=>['H1','OTHER'].includes(h.id));
 next.activityLog.unshift({id:'BULK',date,action:'Xóa đơn nhập hàng loạt',detail:'3 đơn, '+(revert?'trừ tồn kho':'giữ tồn kho'),user:authority.actor()?.name||'System'});return next};
 return {authority,writes,request,proposal};
}

for(const id of [0,'0'])for(const revert of [false,true])test('PO bulk authority: ledger, bounded receipt, individual undo and intervening transactions ('+typeof id+'/'+revert+')',async()=>{
 const h=await bulkPOAuthority('admin',id),original=clone(h.authority.publicData()),del=h.request('confirmBulkDeletePurchaseOrders',h.proposal(revert));
 assert.equal((await h.authority.save(del)).committed,true);assert.equal(h.writes.length,1);
 assert.equal((await h.authority.save(del)).committed,true);assert.equal(h.writes.length,1);
 assert.equal(h.authority.receipts.get(del.requestId).purchaseOrderDeletes.length,3);
 assert.equal(JSON.stringify(h.authority.receipts.get(del.requestId)).includes('admin-fixture'),false);
 // Independent later adjustment: undo must add back only its own quantities.
 h.authority.data.products[0].stock-=2;
 for(const old of [original.purchaseOrders[3],original.purchaseOrders[2],original.purchaseOrders[0]]){
  const undo=clone(h.authority.publicData());undo.purchaseOrders.unshift(old);
  if(revert){undo.products[0].stock+=old.items[0].qty;undo.stockHistory.unshift({id:'RESTORE-'+old.id,date:old.date,type:'in',productId:old.items[0].productId,productName:old.items[0].productName,qty:old.items[0].qty,price:old.items[0].price,total:old.items[0].total,note:'Nhập hàng - '+old.code+' (khôi phục)',user:old.user||'',source:'purchase_order',purchaseOrderId:old.id})}
  if(old.id==='B1')undo.suppliers[1].debt=90000;else if(!old.isPaid)undo.suppliers[0].debt=100000;
  const payload=h.request('performUndo',undo,{undoReceiptId:del.requestId});
  assert.equal((await h.authority.save(payload)).committed,true,String(old.id));
  assert.equal((await h.authority.save(payload)).committed,true,'same ACK retry is idempotent');
  assert.equal((await h.authority.save(h.request('performUndo',undo,{undoReceiptId:del.requestId}))).committed,false,'no second restoration');
 }
 assert.equal(h.authority.data.products[0].stock,18);assert.equal(h.authority.data.products[1].stock,30);
 assert.deepEqual(h.authority.data.suppliers.map(s=>s.debt),[100000,90000,123]);
 assert.equal(h.authority.receipts.get(del.requestId).purchaseOrderDeletes.filter(t=>t.undone).length,3);
});

test('PO bulk authority: exact deletion is management-only and mismatched deltas never write',async()=>{
 for(const role of ['guest','staff','manager','admin']){
  const h=await bulkPOAuthority(role),before=clone(h.authority.publicData());
  assert.equal((await h.authority.save(h.request('confirmBulkDeletePurchaseOrders',h.proposal(false)))).committed,['admin','manager'].includes(role),role);
  if(['guest','staff'].includes(role))assert.deepEqual(h.authority.publicData(),before);
 }
 const changes=[d=>d.products[0].stock++,d=>d.products[1].stock--,d=>d.suppliers[0].debt=0,d=>d.suppliers[2].debt=0,
 d=>d.suppliers.reverse(),d=>d.custs[1].points++,d=>d.purchaseOrders[0].totalAmount++,d=>d.purchaseOrders.push({...d.purchaseOrders[0],id:'NEW'}),
 d=>d.stockHistory.pop(),d=>d.activityLog[0].detail='3 đơn, trừ tồn kho',d=>d.activityLog[0].user='Staff',d=>d.activityLog=[]];
 for(const [i,change]of changes.entries()){
  const h=await bulkPOAuthority(),before=clone(h.authority.publicData()),revision=h.authority.revision,next=h.proposal(false);change(next);
  assert.equal((await h.authority.save(h.request('confirmBulkDeletePurchaseOrders',next))).committed,false,String(i));
  assert.equal(h.writes.length,0);assert.equal(h.authority.revision,revision);assert.deepEqual(h.authority.publicData(),before);
 }
});

test('PO bulk authority: failed writes do not consume undo items; stale/foreign receipts cannot restore',async()=>{
 let failing=false;const h=await bulkPOAuthority('admin',0,async()=>{if(failing)throw Error('ENOSPC')});
 failing=true;const before=clone(h.authority.publicData());assert.equal((await h.authority.save(h.request('confirmBulkDeletePurchaseOrders',h.proposal(false)))).committed,false);assert.deepEqual(h.authority.publicData(),before);
 failing=false;const del=h.request('confirmBulkDeletePurchaseOrders',h.proposal(false));assert.equal((await h.authority.save(del)).committed,true);
 const undo=clone(h.authority.publicData());undo.purchaseOrders.unshift(before.purchaseOrders[3]);
 const snapshot=clone(h.authority.publicData());failing=true;
 assert.equal((await h.authority.save(h.request('performUndo',undo,{undoReceiptId:del.requestId}))).committed,false);
 assert.deepEqual(h.authority.publicData(),snapshot);assert.equal(h.authority.receipts.get(del.requestId).purchaseOrderDeletes[2].undone,undefined);
 failing=false;await h.authority.login({username:'manager',password:'manager-fixture'});
 assert.equal((await h.authority.save(h.request('performUndo',undo,{undoReceiptId:del.requestId}))).committed,false);
});


test('PO bulk authority: zero history links and conflicting notes cannot remove unselected history',async()=>{
 for(const id of [0,'0']){
  const h=await bulkPOAuthority('admin',id);
  h.authority.data.stockHistory=[{id:'ZERO',purchaseOrderId:id,note:'other'},{id:'KEEP',purchaseOrderId:'A2',note:'Đơn nhập: PN-'+id},{id:'LEGACY',note:'Đơn nhập: PN-'+id}];
  const next=h.proposal(true);next.stockHistory=[clone(h.authority.data.stockHistory[1])];
  assert.equal((await h.authority.save(h.request('confirmBulkDeletePurchaseOrders',next))).committed,true);
  assert.deepEqual(h.authority.data.stockHistory.map(h=>h.id),['KEEP']);
 }
});

test('PO bulk authority: undo rejects document, stock, history and sibling tampering and receipt reuse',async()=>{
 for(const kind of ['document','stock','debt','sibling','history','two-orders','reused-id','reused-receipt']){
  const h=await bulkPOAuthority(),original=clone(h.authority.publicData()),del=h.request('confirmBulkDeletePurchaseOrders',h.proposal(true));
  assert.equal((await h.authority.save(del)).committed,true);
  const old=original.purchaseOrders[3],undo=clone(h.authority.publicData());
  undo.purchaseOrders.unshift(old);undo.products[0].stock++;
  undo.stockHistory.unshift({id:'RESTORE',date:old.date,type:'in',productId:'P',productName:'Product',qty:1,price:25000,total:25000,note:'Nhập hàng - '+old.code+' (khôi phục)',user:'',source:'purchase_order',purchaseOrderId:old.id});
  if(kind==='document')undo.purchaseOrders[0].totalAmount++;
  if(kind==='stock')undo.products[0].stock++;
  if(kind==='debt')undo.suppliers[0].debt++;
  if(kind==='sibling')undo.custs[1].points++;
  if(kind==='history')undo.stockHistory[0].qty++;
  if(kind==='two-orders')undo.purchaseOrders.push(original.purchaseOrders[0]);
  if(kind==='reused-id')undo.stockHistory[0].id='OTHER';
  if(kind==='reused-receipt')assert.equal((await h.authority.save(h.request('performUndo',undo,{undoReceiptId:del.requestId}))).committed,true);
  const before=clone(h.authority.publicData()),count=h.writes.length;
  assert.equal((await h.authority.save(h.request('performUndo',undo,{undoReceiptId:del.requestId}))).committed,false,kind);
  assert.deepEqual(h.authority.publicData(),before,kind);assert.equal(h.writes.length,count,kind);
 }
});

test('PO bulk authority: fractional/missing legacy lines and 500 pending logs preserve canonical data',async()=>{
 for(const id of [0,'0']){
  const h=await bulkPOAuthority('admin',id),date='2026-10-20T00:00:00.000Z';
  h.authority.data.products[0].id=id;h.authority.data.suppliers[0].id=id;
  h.authority.data.purchaseOrders=[{id:'FRAC',code:'F',date,supplierId:id,totalAmount:1000,isPaid:false,items:[{productId:id,qty:1.5}]},{id:'LEGACY',date,code:'L',supplierId:'MISSING',isPaid:true,totalAmount:0}];
  h.authority.data.suppliers[0].debt=1000;h.authority.data.stockHistory=[];
  h.authority.data.activityLog=Array.from({length:500},(_,i)=>({id:'OLD'+i,date,action:'Old',detail:String(i),user:'Admin'}));
  const next=clone(h.authority.publicData());next.purchaseOrders=[];next.products[0].stock=18.5;next.suppliers[0].debt=0;
  next.activityLog=[{id:'BULK',date,action:'Xóa đơn nhập hàng loạt',detail:'2 đơn, trừ tồn kho',user:'Admin'},{id:'LOGIN',date,action:'Đăng nhập',detail:'Pending login',user:'Admin'},...next.activityLog.slice(0,498)];
  assert.equal((await h.authority.save(h.request('confirmBulkDeletePurchaseOrders',next))).committed,true);
  assert.equal(h.authority.data.products[0].stock,18.5);assert.equal(h.authority.data.activityLog.length,500);
 }
});


test('PO bulk authority: literal null/undefined supplier IDs never absorb unassigned legacy orders',async()=>{
 for(const id of ['null','undefined']){
  const h=await bulkPOAuthority();h.authority.data.suppliers[0].id=id;h.authority.data.suppliers[0].debt=60000;
  h.authority.data.purchaseOrders[0].supplierId=id;
  if(id==='null')h.authority.data.purchaseOrders[1].supplierId=null;else delete h.authority.data.purchaseOrders[1].supplierId;
  h.authority.data.purchaseOrders[2].isPaid=true;h.authority.data.suppliers[1].debt=0;
  const next=clone(h.authority.publicData());next.purchaseOrders.shift();next.suppliers[0].debt=0;
  next.activityLog.unshift({id:'D',date:'2026-10-20T00:00:00.000Z',user:'Admin',action:'Xóa đơn nhập hàng loạt',detail:'1 đơn, giữ tồn kho'});
  assert.equal((await h.authority.save(h.request('confirmBulkDeletePurchaseOrders',next))).committed,true,id);
  assert.equal(h.authority.data.suppliers[0].debt,0);
 }
});


test('PO draft retirement: every role rejects retired owner and shared-draft modifications atomically',async()=>{
 for(const role of ['admin','manager','staff'])for(const id of [0,'0'])for(const operation of ['saveDraft','deleteDraft','saveCartAsDraft','persistPurchaseOrderDraft']){
  const {authority,request,writes}=await setup(role);
  authority.data.drafts.purchaseOrders=[{id,type:'purchaseOrders',name:'Old draft',createdAt:'2026-10-01T00:00:00Z',data:{items:[]}}];
  const before=JSON.stringify(authority.data),revision=authority.revision,next=clone(authority.publicData());
  next.drafts.purchaseOrders=[];
  assert.equal((await authority.save(request(operation,next))).committed,false,role+'/'+operation);
  assert.equal(JSON.stringify(authority.data),before);assert.equal(authority.revision,revision);assert.equal(writes.length,0);
 }
 for(const role of ['admin','manager','staff']){
  const {authority,request}=await setup(role);authority.data.drafts.purchaseOrders=[{id:'OLD',data:{items:[]}}];
  const next=clone(authority.publicData());next.drafts.invoices.push({id:'SALE-DRAFT',data:{items:[]}});
  assert.equal((await authority.save(request('saveDraft',next))).committed,true);
  assert.deepEqual(authority.data.drafts.purchaseOrders,[{id:'OLD',data:{items:[]}}]);
 }
});

test('linked refunds allocate actual receipts and catch up after a middle slip is removed', () => {
    const tied = { id: 'T', total: 10, items: [1, 4, 1].map((price, id) => ({ id, qty: 1, price })) };
    assert.deepEqual(model.quoteLinkedReturn(tied, [], tied.items.map((_, invoiceLineIndex) => ({ invoiceLineIndex, qty: 1 }))).items.map(item => item.total), [2, 7, 1]);
    const invoice = { id: 0, total: 100000, items: [{ id: 'P', name: 'P', qty: 3, price: 40000 }] };
    const selected = [{ invoiceLineIndex: 0, qty: 1 }];
    let slips = [];
    for (const [index, expected] of [33333, 33334, 33333].entries()) {
        const quote = model.quoteLinkedReturn(invoice, slips, selected);
        assert.equal(quote.total, expected);
        const slip = { id: index, invoiceId: '0', returnItems: quote.items, returnTotal: quote.total, returnPointsRate: 1 };
        slip.returnPointsReversed = model.linkedReturnPoints(slip, slips, 1);
        if (quote.full) slip.deletedInvoice = invoice;
        slips = [slip, ...slips];
    }
    const middle = slips[1];
    assert.deepEqual(model.invoicesReopenedByReturnRemoval([], slips, [middle]), [invoice]);
    slips = slips.filter(slip => slip !== middle);
    assert.deepEqual(model.invoicesReopenedByReturnRemoval([invoice], slips, [slips[0]]), []);
    const retry = model.quoteLinkedReturn(invoice, slips, selected);
    assert.equal(retry.full, true);
    assert.equal(retry.total, 33334);
    assert.equal(model.linkedReturnPoints({ invoiceId: 0, returnTotal: retry.total }, slips, 1), middle.returnPointsReversed);
    const duplicate = { id: 'D', total: 80000, items: [{ id: 0, qty: 1, price: 25000 }, { id: '0', qty: 1, price: 75000 }] };
    const old = { id: 'L', invoiceId: 'D', returnItems: [{ id: 0, qty: '1', price: 25000 }], refundAmount: 90000 };
    const limited = model.quoteLinkedReturn(duplicate, [old], [{ invoiceLineIndex: 1, qty: 1 }]);
    assert.equal(limited.total, 0);
    assert.equal(limited.full, true);
    assert.equal(limited.items[0].id, '0');
    assert.throws(() => model.quoteLinkedReturn(duplicate, [old], selected), /không hợp lệ/);
});

test('full return compensates a capped line after an older slip and then the compensating slip are deleted', () => {
    const invoice = { id: 'I', total: 80000, items: [
        { id: 'A', qty: 1, price: 50000 }, { id: 'B', qty: 1, price: 50000 }
    ] };
    const slipA = { id: 'legacy', invoiceId: 'I', returnItems: [{ id: 'A', qty: 1, price: 50000 }], returnTotal: 50000 };
    const pick = invoiceLineIndex => [{ invoiceLineIndex, qty: 1 }];
    const quoteB = model.quoteLinkedReturn(invoice, [slipA], pick(1));
    assert.equal(quoteB.total, 30000);
    const slipB = { id: 'B', invoiceId: 'I', returnItems: quoteB.items, returnTotal: quoteB.total, deletedInvoice: invoice };
    assert.deepEqual(model.invoicesReopenedByReturnRemoval([], [slipB, slipA], [slipA]), [invoice]);
    const quoteA = model.quoteLinkedReturn(invoice, [slipB], pick(0));
    assert.deepEqual([quoteA.full, quoteA.total, quoteA.items[0].total], [true, 50000, 50000]);
    const compensated = { ...slipA, id: 'adjusted', returnItems: quoteA.items, returnTotal: quoteA.total, deletedInvoice: invoice };
    assert.deepEqual(model.invoicesReopenedByReturnRemoval([], [compensated, slipB], [compensated]), [invoice]);
    assert.equal(model.quoteLinkedReturn(invoice, [slipB], pick(0)).total, 50000);

    const withFreeLine = { ...invoice, items: [...invoice.items, { id: 'gift', qty: 1, price: 0 }] };
    assert.equal(model.quoteLinkedReturn(withFreeLine, [slipB], pick(0)).total, 40000);
    const newSlipA = { ...slipA, deletedInvoice: undefined, returnTotal: 40000 };
    const quoteGift = model.quoteLinkedReturn(withFreeLine, [newSlipA, slipB], pick(2));
    assert.deepEqual([quoteGift.full, quoteGift.items[0].id, quoteGift.total], [true, 'gift', 10000]);
});

test('saveDebt validates the original balance and commits a single matching note and amount', async () => {
    const { authority, request, writes } = await setup('staff');
    authority.data.custs[1].debt = 100000;
    const change = { customerId: 'C', kind: 'pay', amount: 100000, note: 'Khách đã chuyển <xong>' };
    const next = clone(authority.publicData());
    const result = model.customerDebtChange(next.custs[1], change);
    next.custs[1].debt = result.debt;
    next.activityLog.unshift({ id: 'D', date: '2026-11-21T03:00:00Z', user: 'Staff', action: result.action, detail: result.detail });
    const excessive = { ...change, amount: 150000 };
    assert.equal((await authority.save(request('saveDebt', next, { debtChange: excessive }))).code, 'INVALID_DATA');
    const missingNote = clone(next); missingNote.activityLog[0].detail = 'Customer: 100.000 ₫';
    assert.equal((await authority.save(request('saveDebt', missingNote, { debtChange: change }))).code, 'FORBIDDEN');
    const first = request('saveDebt', next, { debtChange: change });
    const second = request('saveDebt', next, { debtChange: change });
    assert.equal((await authority.save(first)).committed, true);
    assert.equal((await authority.save(second)).code, 'STALE_STATE');
    assert.equal((await authority.save(first)).committed, true);
    assert.equal(writes.length, 1);
    assert.equal(authority.data.custs[1].debt, 0);
    assert.match(authority.data.activityLog[0].detail, /100\.000 ₫ — Khách đã chuyển <xong>/);
});
