import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true, executablePath: '/bin/chromium' });
const page = await browser.newPage({ viewport: { width: 800, height: 600 }, ignoreHTTPSErrors: true });
await page.goto('http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded', timeout: 45000 });
const result = await page.evaluate(async () => {
  const base = 'https://kqxpzqegtvaiwgdusrin.supabase.co/functions/v1/an-api';
  const ep = await fetch(`${base}/episode?slug=jujutsu-kaisen-1x1&type=series`).then(r=>r.json());
  const link = (ep.links || []).find(l => /240/.test(l.quality)) || ep.links?.[ep.links.length-1] || ep.links?.[0];
  const playlist = `${base}/hls?url=${encodeURIComponent(link.url)}`;
  const mod = await import('/src/lib/hlsDownloader.ts');
  const size = await mod.estimateHlsSize(playlist, 3);
  const ac = new AbortController();
  let progress = [];
  const p = mod.downloadHls(playlist, (loaded,total,bytes)=>{ if(progress.length<8 || loaded===total) progress.push({loaded,total,bytes}); }, ac.signal);
  setTimeout(()=>ac.abort(), 5000);
  try { await p; } catch(e) { return { quality: link.quality, size, progress, abortedError: e.name || e.message }; }
  return { quality: link.quality, size, progress, completed: true };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
