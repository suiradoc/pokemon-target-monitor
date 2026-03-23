/**
 * Central state store — holds products, statuses, alerts, and config.
 * Persists products and config to data.json so changes survive restarts.
 * Emits 'change' events so the WebSocket server can broadcast updates.
 */

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, '..', 'data.json');
const HISTORY_FILE = join(__dirname, '..', 'stock-history.json');

const emitter = new EventEmitter();

const DEFAULTS = {
  products: [
    { tcin: '95230445', name: 'Mega Evolution Perfect Order ETB' },
    { tcin: '93954446', name: 'Prismatic Evolutions Booster Bundle' },
    { tcin: '95230447', name: 'Mega Evolution S3 Perfect Order Booster Bundle' },
    { tcin: '95252674', name: 'Mega Evolution Perfect Order Booster Display' },
    { tcin: '95093989', name: 'Mega Evolution Ascended Heroes First Partners Deluxe Pin Collection' },
  ],
  config: {
    pollIntervalSeconds: 10,
    autoOpenBrowser: true,
    sound: true,
    autoAddToCart: false,
    zipCode: '',
  },
};

function loadFromDisk() {
  try {
    const raw = readFileSync(DATA_FILE, 'utf-8');
    const saved = JSON.parse(raw);
    return {
      products: saved.products ?? DEFAULTS.products,
      config: { ...DEFAULTS.config, ...saved.config },
    };
  } catch {
    return { products: DEFAULTS.products, config: { ...DEFAULTS.config } };
  }
}

function saveToDisk() {
  const data = { products: state.products, config: state.config };
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const loaded = loadFromDisk();

const state = {
  products: loaded.products,
  statuses: {},
  alertHistory: [],
  config: loaded.config,
};

function emit(type, data) {
  emitter.emit('change', { type, data });
}

export function getState() {
  return state;
}

export function getProducts() {
  return state.products;
}

export function getConfig() {
  return state.config;
}

export function updateProductStatus(tcin, result) {
  state.statuses[tcin] = {
    ...result,
    lastChecked: new Date().toISOString(),
  };
  emit('status_update', { tcin, ...state.statuses[tcin] });
}

export function addProduct(name, tcin) {
  if (state.products.some(p => p.tcin === tcin)) return false;
  const product = { tcin, name };
  state.products.push(product);
  saveToDisk();
  emit('product_added', product);
  return true;
}

export function removeProduct(tcin) {
  const idx = state.products.findIndex(p => p.tcin === tcin);
  if (idx === -1) return false;
  state.products.splice(idx, 1);
  delete state.statuses[tcin];
  saveToDisk();
  emit('product_removed', { tcin });
  return true;
}

export function addAlert(entry) {
  const alert = { ...entry, timestamp: new Date().toISOString() };
  state.alertHistory.unshift(alert);
  if (state.alertHistory.length > 200) state.alertHistory.length = 200;
  emit('alert', alert);
}

export function updateConfig(partial) {
  Object.assign(state.config, partial);
  saveToDisk();
  emit('config_updated', state.config);
}

// ─── Stock History (for restock prediction) ──────────────────────────────
// Each entry: { tcin, name, event: "in_stock"|"out_of_stock", timestamp }

function loadHistory() {
  try {
    return JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveHistory() {
  writeFileSync(HISTORY_FILE, JSON.stringify(stockHistory, null, 2));
}

const stockHistory = loadHistory();

export function logStockEvent(tcin, name, event) {
  stockHistory.push({ tcin, name, event, timestamp: new Date().toISOString() });
  // Keep last 5000 events
  if (stockHistory.length > 5000) stockHistory.splice(0, stockHistory.length - 5000);
  saveHistory();
}

export function getStockHistory() {
  return stockHistory;
}

export function onStateChange(listener) {
  emitter.on('change', listener);
}
