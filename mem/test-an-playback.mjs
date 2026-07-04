import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true, executablePath: '/bin/chromium' });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, ignoreHTTPSErrors: true });
const logs = [];
const requests = [];
page.on('console', msg => logs.push(`${msg.type()}: ${msg.text()}`));
page.on('requestfailed', req => requests.push({ url: req.url(), failure: req.failure()?.errorText }));
page.on('response', async res => {
  const u = res.url();
  if (/an-api|m3u8|as-cdn|video-proxy|hls/.test(u)) requests.push({ status: res.status(), url: u.slice(0, 260), ct: res.headers()['content-type'] });
});
await page.goto('http://127.0.0.1:8080/watch/as_jujutsu-kaisen?s=0&e=0', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(10000);
await page.screenshot({ path: '/mnt/documents/an-watch-after-fix.png', fullPage: true });
const state = await page.evaluate(() => {
  const v = document.querySelector('video');
  return {
    url: location.href,
    title: document.title,
    text: document.body.innerText.slice(0, 2500),
    video: v ? { src: v.currentSrc || v.src, readyState: v.readyState, paused: v.paused, duration: v.duration, currentTime: v.currentTime, error: v.error ? { code: v.error.code, message: v.error.message } : null } : null,
    iframes: [...document.querySelectorAll('iframe')].map(i=>i.src).slice(0,5),
  };
});
console.log(JSON.stringify({ state, logs: logs.slice(-60), requests: requests.slice(-120) }, null, 2));
await browser.close();
