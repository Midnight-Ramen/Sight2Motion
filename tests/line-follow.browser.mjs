import { chromium, expect } from '@playwright/test';
const b=await chromium.launch({channel:'chrome',headless:true}),p=await b.newPage();
await p.addInitScript(()=>{
 window.hardware={available:true,paths:[],left:98,right:98};
 const original=window.fetch;
 window.fetch=async(url,options)=>{
  if(!String(url).startsWith('http://127.0.0.1:30061/'))return original(url,options);
  const h=window.hardware,path=new URL(String(url)).pathname;h.paths.push(path);
  return new Response(path.includes('/Line/')?(h.available?String(path.includes('/Left/')?h.left:h.right):'Not Connected'):path.includes('/Distance/')?'100':path.includes('/Encoder/')?'0':path.includes('/in/')?'true':'200');
 };
});
const stopped=()=>p.evaluate(()=>window.hardware.paths.filter(x=>x.includes('/stopall/')).length);
try{
 await p.goto('http://127.0.0.1:5174');
 await p.getByRole('button',{name:'Your robot',exact:true}).click();
 await p.getByRole('button',{name:'Connect Finch 2 A',exact:true}).click();
 await p.getByRole('button',{name:'+ Add behavior',exact:true}).click();await p.getByLabel('Add behavior',{exact:true}).selectOption('Line Follow');
 const start=p.getByRole('button',{name:'Start Line Follow',exact:true});
 await expect(start).toBeEnabled();
 await expect(p.getByRole('spinbutton',{name:'Line Follow speed',exact:true})).toHaveValue('20');
 await expect(p.getByRole('spinbutton',{name:'Line Follow sensitivity',exact:true})).toHaveCount(0);
 await expect(p.getByLabel('Line marker action')).toHaveValue('stop');
 await p.getByRole('spinbutton',{name:'Line Follow speed',exact:true}).fill('25');
 await expect(p.getByRole('slider',{name:'Line Follow speed slider',exact:true})).toHaveValue('25');
 for(const event of ['space','button','blur','hidden','stale','manual','disconnect']){
  console.log(event);await p.evaluate(()=>window.hardware.available=true);await p.waitForTimeout(1200);await expect(start).toBeEnabled();
  await start.click();await expect(p.getByText('Line Follow active',{exact:true})).toBeVisible();
  await expect(p.getByLabel('Line Follow readings')).toContainText('STRAIGHT');
  const n=await stopped();
  if(event==='space')await p.keyboard.press('Space');
  if(event==='button')await p.getByRole('button',{name:/STOP ROBOT/}).click();
  if(event==='blur')await p.evaluate(()=>window.dispatchEvent(new Event('blur')));
  if(event==='hidden')await p.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  if(event==='stale')await p.evaluate(()=>window.hardware.available=false);
  if(event==='manual'){await p.getByRole('button',{name:'Drive forward',exact:true}).focus();await p.keyboard.down('w');}
  if(event==='disconnect')await p.getByRole('button',{name:'Disconnect from app',exact:true}).click();
  await expect.poll(stopped).toBeGreaterThan(n);
  if(event==='manual')await p.keyboard.up('w');
  if(event==='hidden')await p.evaluate(()=>Object.defineProperty(document,'hidden',{value:false,configurable:true}));
  await p.evaluate(()=>window.hardware.available=true);
  // Wait for the existing provider to refresh the restored distance before restarting.
  if(event!=='disconnect')await p.waitForTimeout(350);
 }
 console.log('Line Follow speed sync, Space/STOP/blur/hidden/stale/manual/disconnect passed; hardware mocked.');
}finally{await b.close();}
