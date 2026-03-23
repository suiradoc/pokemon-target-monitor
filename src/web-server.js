/**
 * Express HTTP server + WebSocket for real-time dashboard updates.
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as state from './state.js';
import * as ai from './ai-service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

export function startServer(port = 3000) {
  const app = express();
  app.use(express.json());
  app.use(express.static(publicDir));

  // REST API
  app.get('/api/state', (_req, res) => {
    res.json(state.getState());
  });

  app.post('/api/products', (req, res) => {
    const { name, tcin } = req.body;
    if (!name || !tcin) return res.status(400).json({ error: 'name and tcin required' });
    const added = state.addProduct(name, String(tcin));
    if (!added) return res.status(409).json({ error: 'product already exists' });
    res.json({ ok: true });
  });

  app.delete('/api/products/:tcin', (req, res) => {
    const removed = state.removeProduct(req.params.tcin);
    if (!removed) return res.status(404).json({ error: 'product not found' });
    res.json({ ok: true });
  });

  app.post('/api/config', (req, res) => {
    state.updateConfig(req.body);
    res.json({ ok: true, config: state.getConfig() });
  });

  app.get('/api/predictions', async (_req, res) => {
    const history = state.getStockHistory();
    const products = state.getProducts();
    if (history.length === 0) {
      return res.json({ predictions: [], message: 'No stock events recorded yet. Keep the monitor running to collect data.' });
    }
    const aiReady = await ai.isConfigured();
    if (!aiReady) {
      return res.json({ predictions: [], message: 'Ollama not running or model not found. Install Ollama and run: ollama pull llama3.1' });
    }
    const predictions = await ai.predictRestocks(history, products);
    res.json({ predictions: predictions || [], message: predictions ? null : 'Prediction failed. Try again later.' });
  });

  app.get('/api/history', (_req, res) => {
    res.json(state.getStockHistory());
  });

  // HTTP + WebSocket on the same port
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  wss.on('connection', ws => {
    // Send full state on connect
    ws.send(JSON.stringify({ type: 'init', data: state.getState() }));
  });

  // Broadcast state changes to all connected clients
  state.onStateChange(event => {
    const msg = JSON.stringify(event);
    for (const ws of wss.clients) {
      if (ws.readyState === 1) ws.send(msg);
    }
  });

  server.listen(port, () => {
    console.log(`  Dashboard: http://localhost:${port}`);
    console.log('');
  });

  return server;
}
