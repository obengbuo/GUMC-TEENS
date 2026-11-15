'use strict';
/* Renders tools/intro/intro.html frame by frame and encodes app/public/intro.mp4.
   Needs Playwright (Chromium) and ffmpeg on the PATH.  Usage: npm run intro */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const FPS = 30, SECONDS = 7, SIZE = 720;

(async () => {
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'intro-'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(__dirname, 'intro', 'intro.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  for (let f = 0; f < FPS * SECONDS; f++) {
    await page.evaluate((ms) => document.getAnimations().forEach((a) => { a.currentTime = ms; }), (f * 1000) / FPS);
    await page.screenshot({ path: path.join(frames, String(f).padStart(4, '0') + '.png') });
  }
  await browser.close();
  const out = path.join(__dirname, '..', 'app', 'public', 'intro.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, '%04d.png'),
    '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'slow',
    '-movflags', '+faststart', '-an', out]);
  fs.rmSync(frames, { recursive: true, force: true });
  console.log('Wrote ' + out + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)');
})();
