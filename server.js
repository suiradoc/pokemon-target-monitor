/**
 * Pokemon Target Monitor v6 — Entry point.
 * Starts the web dashboard and the headless Chrome monitor.
 *
 * Usage: node server.js
 * AI predictions powered by Ollama (local LLM).
 */

import 'dotenv/config';
import { startServer } from './src/web-server.js';
import { startMonitor } from './src/monitor.js';

const PORT = process.env.PORT || 3000;

startServer(PORT);
startMonitor();
