import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true, executablePath: '/bin/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
const logs = [];
const reqs = [];
page.on('console', msg => logs.push(`${msg.type()}: ${msg.text()}`));
page.on('requestfailed', req => reqs.push({ failed: req.url(), reason: req.failure()?.errorText }));
page.on('response', res => { const u = res.url(); if (/an-api|as-cdn|hls/.test(u)) reqs.push({ status: res.status(), url: u.slice(0,220), ct: res.headers()['content-type'] }); });
await page.goto('http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded', timeout: 45000 });
const result = await page.evaluate(async () => {
  const base = 'https://kqxpzqegtvaiwgdusrin.supabase.co/functions/v1/an-api';
  const ep = await fetch(`${base}/episode?slug=jujutsu-kaisen-1x1&type=series`).then(r=>r.json());
  const link = (ep.links || []).find(l => /720/.test(l.quality)) || ep.links?.[0];
  const proxied = `${base}/hls?url=${encodeURIComponent(link.url)}`;
  const plRes = await fetch(proxied);
  const playlist = await plRes.text();
  const firstSeg = playlist.split(/\r?\n/).find(l => l && !l.startsWith('#'));
  const segRes = await fetch(firstSeg, { headers: { Range: 'bytes=0-1023' } });
  const segBuf = await segRes.arrayBuffer();
  const mod = await import('/node_modules/.vite/deps/hls__js.js?v=1f278a72');
  const Hls = mod.default || mod.Hls;
  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.controls = true;
  document.body.innerHTML = '';
  document.body.appendChild(video);
  let hlsEvents = [];
  let err = null;
  const hls = new Hls({ enableWorker: true, lowLatencyMode: false, manifestLoadingTimeOut: 7000, fragLoadingTimeOut: 16000 });
  hls.on(Hls.Events.ERROR, (_e, data) => { hlsEvents.push({ type: data.type, details: data.details, fatal: data.fatal, code: data.response?.code }); if (data.fatal) err = data; });
  hls.on(Hls.Events.MANIFEST_PARSED, () => { hlsEvents.push({ event: 'manifest', levels: hls.levels?.length || 0, audio: hls.audioTracks?.length || 0 }); video.play().catch(e => { err = { message: e.message }; }); });
  hls.on(Hls.Events.FRAG_BUFFERED, (_e, data) => { if (hlsEvents.length < 20) hlsEvents.push({ event: 'frag', sn: data.frag?.sn, level: data.frag?.level }); });
  hls.loadSource(proxied);
  hls.attachMedia(video);
  await new Promise(resolve => setTimeout(resolve, 15000));
  return {
    linkQuality: link.quality,
    playlistStatus: plRes.status,
    playlistFirstLines: playlist.split(/\r?\n/).slice(0,8),
    firstSegStatus: segRes.status,
    firstSegContentRange: segRes.headers.get('content-range'),
    firstSegBytes: segBuf.byteLength,
    video: { readyState: video.readyState, currentTime: video.currentTime, paused: video.paused, duration: video.duration, error: video.error ? { code: video.error.code, message: video.error.message } : null },
    hlsEvents,
    fatal: err ? { type: err.type, details: err.details, fatal: err.fatal, code: err.response?.code, message: err.message } : null,
  };
});
await page.screenshot({ path: '/mnt/documents/an-hls-playback-test.png', fullPage: true });
console.log(JSON.stringify({ result, logs: logs.slice(-30), reqs: reqs.slice(-80) }, null, 2));
await browser.close();
