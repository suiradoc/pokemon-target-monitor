/**
 * Pokemon Target Drop Monitor v5
 * Uses a real headless Chrome browser (Puppeteer) to bypass Target's
 * bot detection. Reads the actual fulfillment status from the page.
 *
 * Usage: node monitor.js
 */

import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';
import notifier from 'node-notifier';
import { exec } from 'child_process';

// ─── CONFIG ────────────────────────────────────────────────────────────────
const CONFIG = {
  pollIntervalSeconds: 10,
  autoOpenBrowser: true,
  sound: true,

  products: [
    { name: 'Mega Evolution Perfect Order ETB', tcin: '95230445' },
    { name: 'Prismatic Evolutions Booster Bundle', tcin: '93954446' },
    { name: 'Mega Evolution S3 Perfect Order Booster Bundle', tcin: '95230447' },
    { name: 'Mega Evolution Perfect Order Booster Display', tcin: '95252674' },
    { name: 'Mega Evolution Ascended Heroes First Partners Deluxe Pin Collection', tcin: '95093989' },
    // { name: 'Whatever Set', tcin: '12345678' },
  ],
};
// ───────────────────────────────────────────────────────────────────────────

const previousState = {};
let browser = null;

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

function openBrowser(url) {
  // Works on Windows, Mac, and Linux
  const cmd = process.platform === 'win32'  ? `start "" "${url}"` :
              process.platform === 'darwin' ? `open "${url}"` :
                                              `xdg-open "${url}"`;
  exec(cmd);
}

function triggerAlert(product, statusMsg) {
  log(`🚨 ${product.name} — ${statusMsg}`);
  notifier.notify({
    title: '🎴 Pokemon Drop Alert!',
    message: `${product.name} is IN STOCK!`,
    sound: CONFIG.sound,
    wait: false,
    timeout: 15,
  });
  if (CONFIG.autoOpenBrowser) {
    openBrowser(`https://www.target.com/p/-/A-${product.tcin}`);
  }
}

// Find Chrome/Edge on the user's machine
function findChromePath() {
  const paths = {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ],
  };

  const candidates = paths[process.platform] ?? paths.linux;
  for (const p of candidates) {
    try {
      // Check if file exists
      execSync(process.platform === 'win32' ? `if exist "${p}" echo yes` : `test -f "${p}"`, { stdio: 'pipe' });
      return p;
    } catch (_) {}
  }
  return null;
}

let browserPromise = null;
async function getBrowser() {
  if (browser) return browser;
  if (browserPromise) return browserPromise; // reuse in-flight launch

  const chromePath = findChromePath();
  if (!chromePath) {
    throw new Error(
      'Could not find Chrome or Edge. Please install Chrome from https://www.google.com/chrome'
    );
  }

  log(`Launching browser: ${chromePath}`);
  browserPromise = puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800',
    ],
  }).then(b => { browser = b; browserPromise = null; return b; });

  return browserPromise;
}

async function checkProduct(product) {
  const url = `https://www.target.com/p/-/A-${product.tcin}`;
  let page = null;

  try {
    const b = await getBrowser();
    page = await b.newPage();

    // Make the browser look like a real user
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    // Intercept requests — block images/fonts to load faster
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for React to hydrate fulfillment state
    await new Promise(r => setTimeout(r, 3000));

    // Pull availability from the live page
    const result = await page.evaluate(() => {
      const AVAILABLE_STATUSES = ['IN_STOCK', 'LIMITED_STOCK', 'AVAILABLE', 'PREORDER'];

      // Method 1: data-test ATC button
      const atcBtn = document.querySelector(
        '[data-test="addToCartButton"]:not([disabled]), [data-test="shipItButton"]:not([disabled]), ' +
        '[data-test="preOrderButton"]:not([disabled]), [data-test="preorderButton"]:not([disabled]), ' +
        '[data-test="espAddToCartButton"]:not([disabled])'
      );
      if (atcBtn) return { available: true, status: 'In Stock' };

      // Method 2: Fulfillment cell text — catches "get it today/tomorrow" shipping
      const shippingCell = document.querySelector('[data-test="fulfillment-cell-shipping"]');
      const pickupCell   = document.querySelector('[data-test="fulfillment-cell-pickup"]');
      const deliveryCell = document.querySelector('[data-test="fulfillment-cell-delivery"]');
      const cellText = [shippingCell, pickupCell, deliveryCell]
        .map(el => el?.textContent?.toLowerCase() ?? '').join(' ');
      const shippingAvailable =
        cellText.includes('get it today') ||
        cellText.includes('get it tomorrow') ||
        cellText.includes('get it by') ||
        cellText.includes('in stock') ||
        cellText.includes('order pickup') ||
        cellText.includes('same day');
      if (shippingAvailable) return { available: true, status: 'In Stock' };

      // Method 3: __NEXT_DATA__ fulfillment JSON
      const el = document.getElementById('__NEXT_DATA__');
      if (el) {
        try {
          const nd = JSON.parse(el.textContent);
          const fulfillment =
            nd?.props?.pageProps?.pageData?.pdpData?.product?.fulfillment ||
            nd?.props?.pageProps?.initialData?.data?.product?.fulfillment;
          if (fulfillment) {
            const ship   = fulfillment?.shipping_options?.availability_status ?? '';
            const pickup = fulfillment?.store_options?.[0]?.availability_status ?? '';
            const available = AVAILABLE_STATUSES.includes(ship) || AVAILABLE_STATUSES.includes(pickup);
            return { available, status: `ship:${ship} pickup:${pickup}` };
          }
          const allStatuses = [...JSON.stringify(nd).matchAll(/"availability_status"\s*:\s*"([^"]+)"/g)]
            .map(m => m[1]);
          if (allStatuses.length > 0) {
            const available = allStatuses.some(s => AVAILABLE_STATUSES.includes(s));
            return { available, status: allStatuses.join(', ') };
          }
        } catch (e) {}
      }

      // Method 4: Explicit sold-out signals
      const soldOutEl = document.querySelector(
        '[data-test="soldOutMessage"], [data-test="preorderButtonDisabled"], ' +
        '[class*="SoldOut"], [class*="sold-out"]'
      );
      if (soldOutEl) return { available: false, status: 'Sold Out' };

      return { available: false, status: 'Unavailable' };
    });

    const icon = result.available ? '✅' : '❌';
    log(`${icon}  A-${product.tcin}  |  ${product.name.padEnd(30)}  |  ${result.available ? 'IN STOCK 🚨' : result.status}`);

    const prev = previousState[product.tcin];
    if (result.available && prev !== 'AVAILABLE') {
      previousState[product.tcin] = 'AVAILABLE';
      triggerAlert(product, result.status);
    } else if (!result.available && prev === 'AVAILABLE') {
      previousState[product.tcin] = 'OOS';
      log(`📦 ${product.name} went out of stock`);
    } else {
      previousState[product.tcin] = result.available ? 'AVAILABLE' : 'OOS';
    }

  } catch (err) {
    log(`❌ Error checking ${product.name}: ${err.message}`);
    // If browser crashed, reset so it relaunches next cycle
    if (err.message.includes('Target closed') || err.message.includes('Session closed')) {
      browser = null;
    }
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

async function runOnce() {
  await Promise.all(CONFIG.products.map(product => checkProduct(product)));
}

async function main() {
  console.log('');
  console.log('  🎴  Pokemon Target Monitor v5  🎴');
  console.log('  ──────────────────────────────────');
  console.log(`  Watching ${CONFIG.products.length} product(s)`);
  console.log(`  Poll interval: every ${CONFIG.pollIntervalSeconds}s`);
  console.log('  Using headless Chrome (bypasses bot detection)');
  console.log('  Press Ctrl+C to stop');
  console.log('');

  await runOnce();
  setInterval(runOnce, CONFIG.pollIntervalSeconds * 1000);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});