import { chromium, expect } from '@playwright/test';
const b=await chromium.launch({channel:'chrome',headless:true});
const p=await b.newPage({viewport:{width:1440,height:900}});
const paths=[]; p.on('pageerror',e=>console.error(e.message));
await p.route('http://127.0.0.1:30061/**',r=>{const path=new URL(r.request().url()).pathname;paths.push(path);return r.fulfill({body:path.includes('/in/')?'true':'200'});});
const wheels=()=>paths.filter(x=>x.includes('/wheels/'));
const stops=()=>paths.filter(x=>x.includes('/stopall/')).length;
try {
 await p.goto('http://127.0.0.1:5174');
 await p.getByRole('button',{name:'Your robot',exact:true}).click();
 const forward=p.getByRole('button',{name:'Drive forward',exact:true});
 await expect(forward).toBeDisabled();
 await p.getByRole('button',{name:'Connect Finch 2 A',exact:true}).click();
 await expect(forward).toBeEnabled();
 for(const [key,pair] of [['w','30/30'],['ArrowUp','30/30'],['s','-30/-30'],['ArrowDown','-30/-30'],['a','-30/30'],['ArrowLeft','-30/30'],['d','30/-30'],['ArrowRight','30/-30']]) {
  await forward.focus();const n=wheels().length;await p.keyboard.down(key);
  await expect.poll(()=>wheels().length).toBe(n+1);expect(wheels().at(-1)).toContain('/'+pair+'/');
  await p.keyboard.down(key);expect(wheels().length).toBe(n+1);
  const s=stops();await p.keyboard.up(key);await expect.poll(stops).toBeGreaterThan(s);
 }
 const number=p.getByRole('spinbutton',{name:'Manual drive speed',exact:true});
 await number.fill('25');await expect(p.getByRole('slider',{name:'Manual drive speed slider',exact:true})).toHaveValue('25');
 const n=wheels().length;await p.keyboard.press('w');expect(wheels().length).toBe(n);
 await p.getByRole('slider',{name:'Manual drive speed slider',exact:true}).fill('35');await expect(number).toHaveValue('35');
 for(const event of ['blur','hidden','space','collapse','disconnect']) {
  await forward.focus();const count=wheels().length;await p.keyboard.down('w');await expect.poll(()=>wheels().length).toBe(count+1);const s=stops();
  if(event==='blur') await p.evaluate(()=>window.dispatchEvent(new Event('blur')));
  if(event==='hidden') await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  if(event==='space') await p.keyboard.press('Space');
  if(event==='collapse') await p.getByRole('button',{name:'Your robot',exact:true}).click();
  if(event==='disconnect') await p.getByRole('button',{name:'Disconnect from app',exact:true}).click();
  await expect.poll(stops).toBeGreaterThan(s);await p.keyboard.up('w');
  if(event==='hidden') await p.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:false}));
  if(event==='collapse') await p.getByRole('button',{name:'Your robot',exact:true}).click();
 }
 await p.getByRole('button',{name:'Connect Finch 2 A',exact:true}).click();
 await expect(forward).toBeEnabled();
 await forward.scrollIntoViewIfNeeded();const box=await forward.boundingBox();const count=wheels().length;
 await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();
 await expect.poll(()=>wheels().length).toBe(count+1);const beforeRelease=stops();await p.mouse.up();await expect.poll(stops).toBeGreaterThan(beforeRelease);
 await p.getByRole('button',{name:'Getting started',exact:true}).click();
 await p.getByRole('button',{name:'Try the demo',exact:true}).click();
 await p.getByRole('button',{name:'Play rules',exact:true}).click();
 await expect(forward).toBeDisabled();
 await expect(p.getByText('Stop rules to drive manually.',{exact:true})).toBeVisible();
 const beforeBlocked=wheels().length;await p.keyboard.press('w');expect(wheels().length).toBe(beforeBlocked);
 await p.keyboard.press('Space');await expect(forward).toBeEnabled();
 await p.route('**/manual-drive-fixture',r=>r.fulfill({contentType:'text/html',body:`<div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';
 import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js'; const {createRoot}=ReactDOM;
 import {ManualDrive} from '/src/components/ManualDrive.tsx';
 import {ActionEngine} from '/src/core/ActionEngine.ts';
 import {MockRobotAdapter} from '/tests/MockRobotAdapter.ts';
 const robot=new MockRobotAdapter();await robot.connect();
 const engine=new ActionEngine(robot),root=createRoot(document.getElementById('root'));
 window.manualFixture={robot,engine,unmount:()=>root.unmount()};
 root.render(React.createElement(ManualDrive,{engine,connected:true,running:false,busy:false,open:true}));
 </script>`}));
 await p.goto('http://127.0.0.1:5174/manual-drive-fixture');
 await p.getByRole('button',{name:'Drive forward',exact:true}).focus();await p.keyboard.down('w');
 await expect.poll(()=>p.evaluate(()=>window.manualFixture.robot.state.left)).toBe(30);
 await p.evaluate(()=>window.manualFixture.unmount());
 await expect.poll(()=>p.evaluate(()=>window.manualFixture.robot.state.left)).toBe(0);
 expect(await p.evaluate(()=>window.manualFixture.engine.activeMotorOwnerRuleId)).toBeNull();
 await p.keyboard.up('w');
 console.log('Manual keys, pointer hold, rules lockout, speed sync, unmount and stop events passed; hardware intercepted.');
}finally{await b.close();}


