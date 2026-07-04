import { chromium } from '@playwright/test';

const urls = [
  ['RS HTTPS HF MP4', 'https://rahat1102-video-hosting-bot.hf.space/15696/Hello+World+Hindi+Dub+720p.mp4?hash=AgADVx'],
  ['RS HTTP BOT MP4', 'http://fi3.bot-hosting.net:22854/15696/Hello+World+Hindi+Dub+720p.mp4?hash=AgADVx'],
  ['RS HTTPS RENDER MP4', 'https://rs-stream-bot-12.onrender.com/15696/Hello+World+Hindi+Dub+720p.mp4?hash=AgADVx'],
  ['RS HTTPS HF MKV', 'https://rahat1102-video-hosting-bot.hf.space/549/Jujutsu_Kaisen_S01_E01_1080P_%5B%40Anime_World_Official_Hindi_Du.mkv?hash=AgADlA'],
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
const results = [];
for (const [name, url] of urls) {
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#080808;color:white;font:16px sans-serif"><h1>${name}</h1><video id="v" controls muted preload="metadata" style="width:100%;height:520px;background:#000" src="${url}"></video><pre id="out"></pre><script>
    const v=document.getElementById('v'); const out=document.getElementById('out');
    const done=(s)=>{ out.textContent=s+' readyState='+v.readyState+' network='+v.networkState+' dur='+v.duration+' err='+(v.error&&v.error.code); window.__result=s; };
    v.addEventListener('loadedmetadata',()=>done('loadedmetadata'));
    v.addEventListener('canplay',()=>done('canplay'));
    v.addEventListener('error',()=>done('error'));
    setTimeout(()=>done(window.__result||'timeout'),8000);
  </script></body></html>`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__result, null, { timeout: 10000 }).catch(() => null);
  const status = await page.evaluate(() => window.__result || 'timeout');
  const detail = await page.locator('#out').innerText().catch(() => 'no detail');
  results.push({ name, status, detail });
  if (name.includes('HTTP BOT')) await page.screenshot({ path: '/mnt/documents/rs-video-test-http-server.png', fullPage: false });
}
await page.setContent(`<html><body style="background:#111;color:#e8ffe8;font:22px sans-serif;padding:32px"><h1>RS Playback Test</h1><ul>${results.map(r=>`<li><b>${r.name}</b>: ${r.detail}</li>`).join('')}</ul></body></html>`);
await page.screenshot({ path: '/mnt/documents/rs-playback-test-summary.png', fullPage: true });
console.log(JSON.stringify(results, null, 2));
await browser.close();
