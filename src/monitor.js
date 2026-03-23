/**
 * Refactored monitor core — headless Chrome stock checker.
 * Reads/writes through state.js and optionally uses ai-service.js.
 */

import puppeteer from 'puppeteer-core';
import { execSync, exec } from 'child_process';
import notifier from 'node-notifier';
import * as state from './state.js';

let browser = null;
let browserPromise = null;
let intervalId = null;

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

function openBrowser(url) {
  const cmd = process.platform === 'win32'  ? `start "" "${url}"` :
              process.platform === 'darwin' ? `open "${url}"` :
                                              `xdg-open "${url}"`;
  exec(cmd);
}

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
      execSync(
        process.platform === 'win32' ? `if exist "${p}" echo yes` : `test -f "${p}"`,
        { stdio: 'pipe' }
      );
      return p;
    } catch (_) {}
  }
  return null;
}

async function getBrowser() {
  if (browser) return browser;
  if (browserPromise) return browserPromise;

  const chromePath = findChromePath();
  if (!chromePath) {
    throw new Error('Could not find Chrome or Edge. Install Chrome from https://www.google.com/chrome');
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
  const config = state.getConfig();
  let page = null;

  try {
    const b = await getBrowser();
    page = await b.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Set zipcode cookie if configured
    const zip = config.zipCode;
    if (zip) {
      await page.setCookie({
        name: 'GuestLocation',
        value: `${zip}|0|0|false|false`,
        domain: '.target.com',
        path: '/',
      });
    }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    // Pull availability + price from the live page
    const result = await page.evaluate(() => {
      const AVAILABLE_STATUSES = ['IN_STOCK', 'LIMITED_STOCK', 'AVAILABLE', 'PREORDER'];

      // Extract price and image
      let price = null;
      let image = null;
      const priceEl = document.querySelector('[data-test="product-price"]');
      if (priceEl) {
        const m = priceEl.textContent.match(/\$?([\d.]+)/);
        if (m) price = parseFloat(m[1]);
      }
      // Try to get product image from meta tag or __NEXT_DATA__
      const ogImage = document.querySelector('meta[property="og:image"]');
      if (ogImage) image = ogImage.getAttribute('content');

      // Method 1: ATC button
      const atcBtn = document.querySelector(
        '[data-test="addToCartButton"]:not([disabled]), [data-test="shipItButton"]:not([disabled]), ' +
        '[data-test="preOrderButton"]:not([disabled]), [data-test="preorderButton"]:not([disabled]), ' +
        '[data-test="espAddToCartButton"]:not([disabled])'
      );
      if (atcBtn) return { available: true, status: 'In Stock', price, image };

      // Method 2: Fulfillment cell text
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
      if (shippingAvailable) return { available: true, status: 'In Stock', price, image };

      // Method 3: __NEXT_DATA__ JSON
      const el = document.getElementById('__NEXT_DATA__');
      if (el) {
        try {
          const nd = JSON.parse(el.textContent);
          // Try to extract price from JSON too
          if (!price) {
            const priceData =
              nd?.props?.pageProps?.pageData?.pdpData?.product?.price?.current_retail ??
              nd?.props?.pageProps?.initialData?.data?.product?.price?.current_retail;
            if (priceData) price = priceData;
          }
          const fulfillment =
            nd?.props?.pageProps?.pageData?.pdpData?.product?.fulfillment ||
            nd?.props?.pageProps?.initialData?.data?.product?.fulfillment;
          if (fulfillment) {
            const ship   = fulfillment?.shipping_options?.availability_status ?? '';
            const pickup = fulfillment?.store_options?.[0]?.availability_status ?? '';
            const available = AVAILABLE_STATUSES.includes(ship) || AVAILABLE_STATUSES.includes(pickup);
            return { available, status: `ship:${ship} pickup:${pickup}`, price, image };
          }
          const allStatuses = [...JSON.stringify(nd).matchAll(/"availability_status"\s*:\s*"([^"]+)"/g)]
            .map(m => m[1]);
          if (allStatuses.length > 0) {
            const available = allStatuses.some(s => AVAILABLE_STATUSES.includes(s));
            return { available, status: allStatuses.join(', '), price, image };
          }
        } catch (e) {}
      }

      // Method 4: Explicit sold-out signals
      const soldOutEl = document.querySelector(
        '[data-test="soldOutMessage"], [data-test="preorderButtonDisabled"], ' +
        '[class*="SoldOut"], [class*="sold-out"]'
      );
      if (soldOutEl) return { available: false, status: 'Sold Out', price, image };

      return { available: false, status: 'Unavailable', price, image };
    });

    // Auto-add to cart if enabled and product is available
    let autoAdded = false;
    if (result.available && config.autoAddToCart) {
      try {
        const atcBtn = await page.$('[data-test="addToCartButton"]:not([disabled]), [data-test="shipItButton"]:not([disabled]), [data-test="preOrderButton"]:not([disabled])');
        if (atcBtn) {
          await atcBtn.click();
          await new Promise(r => setTimeout(r, 2500)); // Wait for cart XHR
          autoAdded = true;
          log(`\uD83D\uDED2 Auto-added ${product.name} to cart!`);
        }
      } catch (err) {
        log(`\u26A0\uFE0F Auto-add to cart failed for ${product.name}: ${err.message}`);
      }
    }

    const icon = result.available ? '\u2705' : '\u274C';
    log(`${icon}  A-${product.tcin}  |  ${product.name.padEnd(30)}  |  ${result.available ? 'IN STOCK' : result.status}${result.price ? `  |  $${result.price}` : ''}${autoAdded ? '  |  ADDED TO CART' : ''}`);

    // Update state
    state.updateProductStatus(product.tcin, {
      available: result.available,
      status: result.status,
      price: result.price ?? null,
      image: result.image ?? null,
      autoAdded,
    });

    // Handle transitions
    const prev = state.getState().statuses[product.tcin]?._prev;
    if (result.available && prev !== 'AVAILABLE') {
      let alertMsg = result.status;

      state.addAlert({ tcin: product.tcin, name: product.name, message: alertMsg });
      state.logStockEvent(product.tcin, product.name, 'in_stock');
      triggerDesktopAlert(product, alertMsg);
      state.getState().statuses[product.tcin]._prev = 'AVAILABLE';
    } else if (!result.available && prev === 'AVAILABLE') {
      log(`\uD83D\uDCE6 ${product.name} went out of stock`);
      state.logStockEvent(product.tcin, product.name, 'out_of_stock');
      state.getState().statuses[product.tcin]._prev = 'OOS';
    } else {
      state.getState().statuses[product.tcin]._prev = result.available ? 'AVAILABLE' : 'OOS';
    }

  } catch (err) {
    log(`\u274C Error checking ${product.name}: ${err.message}`);
    if (err.message.includes('Target closed') || err.message.includes('Session closed')) {
      browser = null;
    }
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

function triggerDesktopAlert(product, message) {
  const config = state.getConfig();
  log(`\uD83D\uDEA8 ${product.name} — ${message}`);
  notifier.notify({
    title: 'Pokemon Drop Alert!',
    message: `${product.name} is IN STOCK!`,
    sound: config.sound,
    wait: false,
    timeout: 15,
  });
  if (config.autoOpenBrowser) {
    openBrowser(`https://www.target.com/p/-/A-${product.tcin}`);
  }
}

async function runOnce() {
  const products = state.getProducts();
  await Promise.all(products.map(p => checkProduct(p)));
}

export function startMonitor() {
  const config = state.getConfig();
  console.log('');
  console.log('  Pokemon Target Monitor v6');
  console.log('  ──────────────────────────────────');
  console.log(`  Watching ${state.getProducts().length} product(s)`);
  console.log(`  Poll interval: every ${config.pollIntervalSeconds}s`);
  console.log('  AI predictions: via Ollama (local) — click Analyze in dashboard');
  console.log('');

  runOnce();
  intervalId = setInterval(runOnce, config.pollIntervalSeconds * 1000);

  // Allow config changes to update the interval
  state.onStateChange(({ type }) => {
    if (type === 'config_updated') {
      const newConfig = state.getConfig();
      clearInterval(intervalId);
      intervalId = setInterval(runOnce, newConfig.pollIntervalSeconds * 1000);
      log(`Poll interval updated to ${newConfig.pollIntervalSeconds}s`);
    }
  });
}
