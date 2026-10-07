import { chromium, expect } from '@playwright/test';
const b=await chromium.launch({channel:'chrome',headless:true});const p=await b.newPage();let value=10;
await p.route('http://127.0.0.1:30061/**',r=>r.fulfill({body:r.request().url().includes('/Encoder/')?String(value):r.request().url().includes('/in/')?'true':'200'}));
try{
 await p.goto('http://127.0.0.1:5174');await p.getByRole('button',{name:'Your robot',exact:true}).click();await p.getByRole('button',{name:'Connect Finch 2 A',exact:true}).click();
 const home=p.getByRole('button',{name:'Set Home',exact:true}), status=p.getByLabel('Encoder recording');await expect(home).toBeEnabled();await home.click();await expect(status).toContainText('Δ Left: +0.00');
 await p.getByRole('button',{name:'Drive forward',exact:true}).focus();await p.keyboard.down('w');value=11;await expect(status).toContainText('Δ Right: +1.00');await p.keyboard.up('w');await expect(status).toContainText('Segments: 1');
 await p.getByRole('button',{name:'Clear Home',exact:true}).click();await expect(status).toContainText('Home: Not set');await expect(status).toContainText('Segments: 0');
 await home.click();await p.getByRole('button',{name:'Disconnect from app',exact:true}).click();await expect(status).toContainText('Home: Not set');
 console.log('Set Home, live relative readings, segment recording, Clear Home and disconnect passed; hardware mocked.');
}finally{await b.close();}
