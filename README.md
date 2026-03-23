# Pokemon Target Drop Monitor

Desktop app that monitors Target.com for Pokemon TCG product restocks. When stock is detected, it sends desktop notifications, auto-opens the product page, and can automatically add items to your cart.

## Features

- **Real-time stock monitoring** — Checks Target product pages every 10 seconds using headless Chrome
- **Auto-add to cart** — Automatically clicks "Add to Cart" when a drop is detected
- **Desktop notifications** — Alerts with sound when stock is found
- **Electron desktop app** — Runs as a standalone app with a web dashboard
- **AI restock predictions** — Uses Ollama (local LLM) to analyze stock patterns and predict restocks
- **ZIP code support** — Set your ZIP for local store pickup availability
- **Persistent config** — Products and settings saved between restarts

## Setup

1. Install [Node.js](https://nodejs.org) (LTS version)
2. Clone this repo and install dependencies:

```bash
git clone https://github.com/suiradoc/pokemon-target-monitor.git
cd pokemon-target-monitor
npm install
```

3. (Optional) Install [Ollama](https://ollama.com) for AI predictions:

```bash
ollama pull llama3.1
```

## Running

**As a desktop app (Electron):**

```bash
npm run electron
```

Or double-click `start.vbs` (Windows) for a hidden background launch.

**As a web server only:**

```bash
npm start
```

Then open http://localhost:3000 in your browser.

## Adding Products

Use the dashboard UI — enter a product name and TCIN, then click "Add".

The TCIN is the number at the end of any Target product URL:

```
https://www.target.com/p/product-name/-/A-95230445
                                          ^^^^^^^^ TCIN
```

## Settings

All configurable from the dashboard gear icon:

| Option                | Default | Description                              |
|-----------------------|---------|------------------------------------------|
| Poll interval         | 10s     | How often to check stock                 |
| Auto-open browser     | On      | Open Target page when stock is found     |
| Sound notifications   | On      | Play sound with desktop alert            |
| Auto-add to cart      | Off     | Automatically add to cart on detection   |
| ZIP code              | —       | Your ZIP for local store availability    |

## Tech Stack

- **Puppeteer** — Headless Chrome for stock detection
- **Express + WebSocket** — Real-time dashboard
- **Electron** — Desktop app wrapper
- **Ollama** — Local AI for restock predictions (no API keys needed)

## License

MIT
