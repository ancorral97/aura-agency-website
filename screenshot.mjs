import { mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);

const url = process.argv[2] || 'http://localhost:3000';
const label = process.argv[3] ? `-${process.argv[3]}` : '';

const screenshotsDir = join(__dirname, 'temporary screenshots');
await mkdir(screenshotsDir, { recursive: true });

const files = await readdir(screenshotsDir).catch(() => []);
const nums = files
  .map(f => parseInt(f.match(/screenshot-(\d+)/)?.[1] || '0'))
  .filter(n => n > 0);
const nextNum = nums.length ? Math.max(...nums) + 1 : 1;
const filename = `screenshot-${nextNum}${label}.png`;
const filepath = join(screenshotsDir, filename);

// Try multiple Puppeteer locations
const puppeteerPaths = [
  join(__dirname, 'node_modules/puppeteer'),
  'C:/Users/nateh/AppData/Local/Temp/puppeteer-test/node_modules/puppeteer',
  'puppeteer',
];

let puppeteer;
for (const p of puppeteerPaths) {
  try {
    puppeteer = (await import(p)).default;
    if (puppeteer) break;
  } catch {
    try { puppeteer = require(p); if (puppeteer) break; } catch { /* try next */ }
  }
}

if (!puppeteer) {
  console.error('Puppeteer not found. Tried:', puppeteerPaths.join(', '));
  process.exit(1);
}

// Chrome executable paths to try (system Chrome first)
const chromePaths = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Users/andyc/AppData/Local/Google/Chrome/Application/chrome.exe',
  'C:/Users/nateh/.cache/puppeteer/chrome/win64-131.0.6778.264/chrome-win64/chrome.exe',
];

let browser;
for (const executablePath of chromePaths) {
  try {
    browser = await puppeteer.launch({
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--window-size=1440,900'],
    });
    console.log('Using Chrome at:', executablePath);
    break;
  } catch { /* try next */ }
}

if (!browser) {
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  } catch(e) {
    console.error('Could not launch browser:', e.message);
    process.exit(1);
  }
}

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
// Use 'load' (not networkidle0) so the canvas requestAnimationFrame loop
// doesn't prevent the page from reaching "idle" state.
await page.goto(url, { waitUntil: 'load', timeout: 45000 });
await new Promise(r => setTimeout(r, 2000)); // let canvas paint several frames

// 1. Force-reveal all IntersectionObserver-driven elements immediately
await page.evaluate(() => {
  document.querySelectorAll('.reveal').forEach(el => el.classList.add('vis'));
});

// 2. Slow scroll through page to trigger any remaining lazy resources
await page.evaluate(async () => {
  await new Promise(resolve => {
    const totalHeight = document.body.scrollHeight;
    let scrolled = 0;
    const step = 200;
    const interval = setInterval(() => {
      window.scrollBy(0, step);
      scrolled += step;
      if (scrolled >= totalHeight) {
        clearInterval(interval);
        resolve();
      }
    }, 80);
  });
});

// 3. Scroll back to top, wait for all images and animations to settle
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise(r => setTimeout(r, 1200));

await page.screenshot({ path: filepath, fullPage: true });
await browser.close();

console.log(`Screenshot saved: ${filepath}`);
