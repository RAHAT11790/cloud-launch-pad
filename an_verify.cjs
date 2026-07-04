const { chromium } = require('@playwright/test');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:390,height:844}, ignoreHTTPSErrors:true});
 page.on('console', msg=>{ if(['error','warning','log'].includes(msg.type())) console.log('CONSOLE',msg.type(),msg.text().slice(0,300)); });
 page.on('pageerror', err=>console.log('PAGEERROR',err.message));
 page.on('response', async res=>{ const u=res.url(); if(u.includes('verify-admin-pin')||u.includes('adminAccess')||u.includes('blocked')) console.log('RESP',res.status(),u, (await res.text().catch(()=>'' )).slice(0,200)); });
 await page.goto('http://localhost:8080/admin',{waitUntil:'networkidle',timeout:90000});
 const pin=page.getByPlaceholder('Enter PIN');
 console.log('pin count', await pin.count());
 await pin.fill('258800');
 console.log('input', await pin.inputValue());
 await page.screenshot({path:'/mnt/documents/admin_pin_filled.png',fullPage:true});
 await page.getByRole('button', {name:/Login with PIN/i}).click();
 for(let i=0;i<10;i++){
   await page.waitForTimeout(1000);
   const body=await page.locator('body').innerText().catch(e=>'ERR');
   console.log('tick',i,'has login?',body.includes('Admin Login'),'dashboard?',body.includes('Dashboard'), 'toast?', body.includes('Wrong PIN')||body.includes('failed')||body.includes('Access denied'));
   if(!body.includes('Admin Login')) break;
 }
 await page.screenshot({path:'/mnt/documents/admin_after_login.png',fullPage:true});
 console.log((await page.locator('body').innerText()).slice(0,2000));
 await browser.close();
})();
