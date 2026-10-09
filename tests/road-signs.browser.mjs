import {chromium,expect} from '@playwright/test';
const b=await chromium.launch({channel:'chrome',headless:true}),p=await b.newPage();
p.on('pageerror',e=>console.log('PAGE ERROR',e.message));p.on('console',m=>{if(m.type()==='error')console.log(m.text());});
try{
 await p.route('**/road-sign-ui-test',route=>route.fulfill({contentType:'text/html',body:`<div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
 const {VisionRoadSigns}=await import('/src/components/VisionRoadSigns.tsx');
 const root=ReactDOM.createRoot(document.getElementById('root'));window.actions=[];
 window.props={vision:{items:[],capturedAt:performance.now(),classes:['person','stop sign'],confidence:.7,ready:true,scope:'yolo'},available:true,resetKey:'0',onAction:async a=>{window.actions.push(a);return true;},onHide:()=>root.unmount()};
 window.render=()=>root.render(React.createElement(VisionRoadSigns,window.props));window.render();
 </script>`}));
 await p.goto('http://127.0.0.1:5174/road-sign-ui-test');
 await p.getByRole('button',{name:'Add mapping'}).click();await p.getByLabel('Road sign class 1').selectOption('person');await p.getByLabel('Road sign action 1').selectOption('left');
 await expect(p.getByRole('checkbox')).toHaveCount(0);
 const frame=()=>p.evaluate(()=>{window.props.vision={...window.props.vision,items:[{className:'person',confidence:.9}],capturedAt:performance.now()};window.render();});
 await frame();await p.waitForTimeout(270);await frame();await expect.poll(()=>p.evaluate(()=>window.actions)).toEqual(['left']);
 await frame();expect(await p.evaluate(()=>window.actions.length)).toBe(1);
 // Editing and adding mappings remain automatic; blank rows do not disable valid rows.
 await p.getByLabel('Road sign action 1').selectOption('right');await frame();await p.waitForTimeout(270);await frame();
 await expect.poll(()=>p.evaluate(()=>window.actions.at(-1))).toBe('right');
 await p.getByRole('button',{name:'Add mapping'}).click();await p.getByLabel('Road sign class 2').selectOption('stop sign');
 await p.getByRole('button',{name:'Remove road sign mapping 2'}).click();await frame();await p.waitForTimeout(270);await frame();
 await expect.poll(()=>p.evaluate(()=>window.actions.at(-1))).toBe('right');
 const beforeStop=await p.evaluate(()=>window.actions.length);
 await p.keyboard.press('Space');await p.waitForTimeout(270);await frame();expect(await p.evaluate(()=>window.actions.length)).toBe(beforeStop);
 await p.evaluate(()=>{window.props.vision={...window.props.vision,classes:['Go','Halt'],scope:'teachable-machine',items:[]};window.render();});
 await p.getByLabel('Road sign class 1').selectOption('Halt');await p.getByLabel('Road sign action 1').selectOption('stop');await p.evaluate(()=>{window.props.motionActive=true;window.render();});
 const halt=items=>p.evaluate(items=>{window.props.vision={...window.props.vision,items,capturedAt:performance.now()};window.render();},items);
 const stopSign=[{className:'Halt',confidence:.9}];await halt(stopSign);await p.waitForTimeout(270);await halt(stopSign);
 await expect.poll(()=>p.evaluate(()=>window.actions.at(-1))).toBe('stop');
 for(let i=0;i<4;i++){await p.waitForTimeout(500);await halt(stopSign);}
 expect(await p.evaluate(()=>window.actions.filter(a=>a==='stop').length)).toBe(1);
 await halt([]);await p.waitForTimeout(510);await halt([]);await expect.poll(()=>p.evaluate(()=>window.actions.at(-1))).toBe('resume');
 await halt(stopSign);await p.waitForTimeout(270);await halt(stopSign);await expect.poll(()=>p.evaluate(()=>window.actions.filter(a=>a==='stop').length)).toBe(2);
 await p.evaluate(()=>{window.props.available=false;window.render();});
 await p.getByRole('button',{name:'Hide Vision Road Signs'}).click();await expect(p.getByLabel('Vision Road Signs controls')).toHaveCount(0);
 console.log('Road-sign UI: YOLO/TM classes, mappings, one trigger, Space disarm, disconnect disarm passed; no hardware.');
}finally{await b.close();}
