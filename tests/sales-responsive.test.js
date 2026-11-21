const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../responsive-tables.js'), 'utf8');

function harness({ canvas = false, failProbe = false } = {}) {
    const frames = [], observers = [], bodies = new Map();
    let size = 'medium';
    const computed = { paddingLeft:'0px',paddingRight:'0px',fontWeight:'400',fontSize:'14px',fontFamily:'Arial',letterSpacing:'0px',textTransform:'none' };
    const context = {document:{
        body:{getAttribute:()=>size},addEventListener(){},getElementById:id=>bodies.get(id),
        createElement:tag=>{
            if(tag==='canvas')return {getContext:()=>canvas?{measureText:()=>({width:0})}:null};
            if(failProbe)throw Error('MEASUREMENT_UNAVAILABLE');
            return {dataset:{},style:{},setAttribute(){},remove(){}};
        }
    },getComputedStyle:()=>computed,requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},
    ResizeObserver:class{constructor(fn){this.callback=fn;observers.push(this);}observe(target){this.target=target;}}};
    vm.createContext(context);
    // Test private calculations without changing the production API.
    vm.runInContext(source.replace('    const api =', '    root.testAllocate = allocateWidths;\n    const api ='), context);
    function table(id) {
        const def=context.NTKIOTResponsiveTables.definitions[id],classes=new Set();
        const cell=()=>({dataset:{},style:{},tagName:'TH',textContent:'',querySelector:()=>null,querySelectorAll:()=>[]});
        const headers=def.columns.map(cell),detail={cells:Array.from({length:7},()=>({colSpan:1,hidden:false,textContent:''}))},empty={cells:[{colSpan:10}]};
        const wrapper={clientWidth:1800};
        const node={dataset:{},style:{},tHead:{rows:[{cells:headers}]},classList:{contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)},closest:()=>wrapper};
        const body={id,rows:[detail,empty],closest:()=>node,querySelectorAll:selector=>selector==='.history-detail-row'?[detail]:[]};
        bodies.set(id,body);
        return {wrapper,node,body,detail,empty,headers};
    }
    return {context,table,observers,frames,setSize:value=>{size=value;},setPadding:value=>{computed.paddingLeft=computed.paddingRight=value+'px';},allocate:(a,b,w)=>{
        const result=context.testAllocate(a,b,w);return result && Array.from(result);
    }};
}

test('sales pixel allocation handles no headroom, partial headroom and surplus deterministically',()=>{
    const {allocate}=harness();
    assert.deepEqual(allocate([40,60],[50,80],100),[40,60]);
    assert.deepEqual(allocate([40,60],[50,80],115),[45,70]);
    assert.deepEqual(allocate([40,60],[50,80],130),[50,80]);
    assert.deepEqual(allocate([40,60],[50,80],143),[55,88]);
    assert.deepEqual(allocate([40,60],[40,60],110),[44,66]);
    assert.deepEqual(allocate([1,1,1],[2,2,2],4),[2,1,1],'fraction ties follow original column order');
    assert.deepEqual(allocate([1.1,2.2],[1,2],6.9),[2,4]);
    assert.deepEqual(allocate([40,60],[50,80],99),[40,60],'never squeeze below the minima');
    assert.equal(allocate([NaN],[1],10),null);
    assert.equal(allocate([0],[1],10),null);
    assert.equal(allocate([1],[],10),null);
    assert.equal(allocate([1],[Infinity],10),null);
});

test('sales allocation preserves exact integer totals and minima across 1000 deterministic inputs',()=>{
    const {allocate}=harness();
    for(let sample=0;sample<1000;sample++) {
        const length=sample%10+1;
        const minimum=Array.from({length},(_,i)=>(sample*17+i*23)%160+1+(i%3)/3);
        const preferred=minimum.map((value,i)=>value+(sample+i*19)%80);
        const total=minimum.reduce((sum,value)=>sum+Math.ceil(value),0),width=total+sample%700;
        const result=allocate(minimum,preferred,width);
        assert.equal(result.reduce((a,b)=>a+b,0),width);
        assert.ok(result.every((value,i)=>Number.isInteger(value)&&value>=Math.ceil(minimum[i])));
        assert.deepEqual(result,allocate(minimum,preferred,width));
    }
});

test('sales legacy fallback keeps 10/7 spans, ignores zero width and respects both hysteresis directions',()=>{
    const h=harness(),t=h.table('hist-body'),api=h.context.NTKIOTResponsiveTables;
    api.refresh('hist-body');
    assert.equal(t.node.dataset.fullWidth,1272);
    assert.equal(t.node.dataset.compactWidth,900);
    assert.equal(t.detail.cells[1].colSpan,4);
    assert.equal(t.empty.cells[0].colSpan,10);
    t.wrapper.clientWidth=1272+8;api.refresh('hist-body');assert.equal(t.node.classList.contains('is-compact'),false);
    t.wrapper.clientWidth=1272+7;api.refresh('hist-body');assert.equal(t.node.classList.contains('is-compact'),true);
    assert.equal(t.detail.cells[1].colSpan,2);assert.equal(t.detail.cells[5].hidden,true);assert.equal(t.empty.cells[0].colSpan,7);
    t.wrapper.clientWidth=1272+23;api.refresh('hist-body');assert.equal(t.node.classList.contains('is-compact'),true);
    t.wrapper.clientWidth=0;api.refresh('hist-body');assert.equal(t.node.classList.contains('is-compact'),true);
    t.wrapper.clientWidth=1272+24;api.refresh('hist-body');assert.equal(t.node.classList.contains('is-compact'),false);
    assert.equal(t.detail.cells[5].hidden,false);assert.equal(t.empty.cells[0].colSpan,10);
    h.setPadding(8);t.wrapper.clientWidth=0;api.refresh('hist-body');assert.equal(t.node.classList.contains('is-compact'),false,'hidden padded wrapper is ignored');
    h.setPadding(0);t.wrapper.clientWidth=1800;
    h.setSize('large');api.refresh('hist-body');assert.equal(t.node.dataset.fullWidth,1296);
    assert.equal(h.observers.length,1);
    for(let i=0;i<5;i++)h.observers[0].callback([{target:t.wrapper,contentRect:{width:1800}}]);
    assert.equal(h.frames.length,1,'one pending RAF per wrapper');h.frames.shift()();
    assert.equal(t.node.classList.contains('is-compact'),false);
});

test('sales measurement exceptions fall back without changing public API or other table budgets',()=>{
    const h=harness({canvas:true,failProbe:true}),sales=h.table('hist-body'),api=h.context.NTKIOTResponsiveTables;
    assert.doesNotThrow(()=>api.refresh('hist-body'));
    assert.equal(sales.node.dataset.fullWidth,1272);
    assert.deepEqual(Object.keys(api).sort(),['definitions','init','refresh','stats']);
    for(const id of ['returns-body','mgmt-stock-history-body','inv-stock-history-body']) {
        const table=h.table(id);api.refresh(id);
        const def=api.definitions[id],expected=Array.from(def.widths);
        assert.equal(table.node.dataset.fullWidth,expected.reduce((a,b)=>a+b,0));
        assert.equal(table.node.dataset.compactWidth,expected.reduce((sum,width,i)=>sum+(def.hide.includes(def.columns[i])?0:width),0));
    }
    assert.equal(h.observers.length,4);
});
