const test=require('node:test');const assert=require('node:assert/strict');
const {createLongPress}=require('../public/maintenance.js');
function fixture(){let callback=null, opens=0,ms; const press=createLongPress(()=>opens++, (cb,delay)=>{callback=cb;ms=delay;return 1;},()=>{callback=null;});return{press,get opens(){return opens},get ms(){return ms},fire(){callback?.()}};}
test('hidden shortcut requires a four-second hold and fires once',()=>{const f=fixture();f.press.start(0,0);assert.equal(f.opens,0);assert.equal(f.ms,4000);f.fire();f.fire();assert.equal(f.opens,1)});
test('tap, release, cancelled touch or drag cannot open the terminal',()=>{for(const cancel of [f=>f.press.cancel(),f=>f.press.move(20,0)]){const f=fixture();f.press.start(0,0);cancel(f);f.fire();assert.equal(f.opens,0)}});
test('a small finger movement still allows a deliberate hold',()=>{const f=fixture();f.press.start(10,10);f.press.move(14,14);f.fire();assert.equal(f.opens,1)});
