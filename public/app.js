/** Frontend — WebSocket client, DOM updates, form handling. */

let appState = { products: [], statuses: {}, alertHistory: [], config: {} };
let ws = null;
let reconnectTimer = null;

// ─── WebSocket ────────────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    setConnectionStatus(true);
    clearTimeout(reconnectTimer);
  };

  ws.onclose = () => {
    setConnectionStatus(false);
    reconnectTimer = setTimeout(connectWS, 3000);
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'init':
      appState = msg.data;
      renderAll();
      break;
    case 'status_update':
      appState.statuses[msg.data.tcin] = msg.data;
      renderProducts();
      break;
    case 'product_added':
      if (!appState.products.some(p => p.tcin === msg.data.tcin)) {
        appState.products.push(msg.data);
      }
      renderProducts();
      break;
    case 'product_removed':
      appState.products = appState.products.filter(p => p.tcin !== msg.data.tcin);
      delete appState.statuses[msg.data.tcin];
      renderProducts();
      break;
    case 'alert':
      appState.alertHistory.unshift(msg.data);
      if (appState.alertHistory.length > 100) appState.alertHistory.length = 100;
      renderAlerts();
      break;
    case 'config_updated':
      appState.config = msg.data;
      populateConfig();
      break;
  }
}

function setConnectionStatus(connected) {
  const dot = document.getElementById('connection-status');
  dot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  dot.title = connected ? 'Connected' : 'Disconnected';
}

// ─── Rendering ────────────────────────────────────────────────────────────
function renderAll() {
  populateConfig();
  renderProducts();
  renderAlerts();
}

function renderProducts() {
  const grid = document.getElementById('product-grid');
  if (appState.products.length === 0) {
    grid.innerHTML = '<p class="empty-state">No products being monitored</p>';
    return;
  }

  grid.innerHTML = appState.products.map(p => {
    const s = appState.statuses[p.tcin] || {};
    const available = s.available === true;
    const statusClass = s.available === true ? 'available' : s.available === false ? 'unavailable' : 'unknown';
    const cardClass = available ? 'in-stock' : s.available === false ? 'sold-out' : '';
    const statusText = s.status || 'Waiting...';
    const lastChecked = s.lastChecked ? new Date(s.lastChecked).toLocaleTimeString() : '--';
    const price = s.price ? `$${s.price}` : '';
    const deal = s.deal;

    let dealBadge = '';
    if (deal) {
      dealBadge = `<span class="deal-badge ${deal.assessment}" title="${deal.explanation || ''}">${deal.assessment.replace('_', ' ')}</span>`;
    }

    const imageUrl = s.image || '';

    return `
      <div class="product-card ${cardClass}" data-tcin="${p.tcin}">
        <div class="card-body">
          ${imageUrl ? `<img class="card-image" src="${esc(imageUrl)}" alt="${esc(p.name)}">` : '<div class="card-image placeholder"></div>'}
          <div class="card-info">
            <div class="card-header">
              <div>
                <a class="card-name" href="https://www.target.com/p/-/A-${esc(p.tcin)}" target="_blank" rel="noopener">${esc(p.name)}</a>
                <div class="card-tcin">TCIN: ${esc(p.tcin)}</div>
              </div>
              <button class="btn btn-danger" onclick="removeProduct('${esc(p.tcin)}')">Remove</button>
            </div>
            <div class="card-status ${statusClass}">${esc(statusText)}</div>
            <div class="card-meta">
              <span>Last checked: ${lastChecked}</span>
              ${price ? `<span>${price}</span>` : ''}
              ${dealBadge}
              ${s.autoAdded ? '<span class="cart-badge">Added to Cart</span>' : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderAlerts() {
  const list = document.getElementById('alert-list');
  if (appState.alertHistory.length === 0) {
    list.innerHTML = '<p class="empty-state">No alerts yet</p>';
    return;
  }

  list.innerHTML = appState.alertHistory.map(a => {
    const time = new Date(a.timestamp).toLocaleString();
    return `
      <div class="alert-entry">
        <span class="alert-time">${time}</span>
        <div class="alert-product">${esc(a.name)}</div>
        <div class="alert-message">${esc(a.message)}</div>
      </div>
    `;
  }).join('');
}

function populateConfig() {
  const c = appState.config;
  if (!c) return;
  document.getElementById('poll-interval').value = c.pollIntervalSeconds ?? 10;
  document.getElementById('auto-open').checked = c.autoOpenBrowser ?? true;
  document.getElementById('sound-enabled').checked = c.sound ?? true;
  document.getElementById('auto-add-cart').checked = c.autoAddToCart ?? false;
  document.getElementById('zip-code').value = c.zipCode ?? '';
}

// ─── Actions ──────────────────────────────────────────────────────────────
document.getElementById('config-toggle').addEventListener('click', () => {
  document.getElementById('config-panel').classList.toggle('hidden');
});

document.getElementById('save-config').addEventListener('click', async () => {
  const config = {
    pollIntervalSeconds: parseInt(document.getElementById('poll-interval').value, 10),
    autoOpenBrowser: document.getElementById('auto-open').checked,
    sound: document.getElementById('sound-enabled').checked,
    autoAddToCart: document.getElementById('auto-add-cart').checked,
    zipCode: document.getElementById('zip-code').value.trim(),
  };
  await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
});

document.getElementById('add-product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('product-name').value.trim();
  const tcin = document.getElementById('product-tcin').value.trim();
  if (!name || !tcin) return;

  const res = await fetch('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, tcin }),
  });

  if (res.ok) {
    document.getElementById('product-name').value = '';
    document.getElementById('product-tcin').value = '';
  }
});

async function removeProduct(tcin) {
  if (!confirm('Remove this product from monitoring?')) return;
  await fetch(`/api/products/${tcin}`, { method: 'DELETE' });
}

// ─── Predictions ──────────────────────────────────────────────────────────
document.getElementById('refresh-predictions').addEventListener('click', async () => {
  const list = document.getElementById('predictions-list');
  const btn = document.getElementById('refresh-predictions');
  btn.disabled = true;
  btn.textContent = 'Analyzing...';
  list.innerHTML = '<p class="predictions-loading">Asking Ollama to analyze stock patterns...</p>';

  try {
    const res = await fetch('/api/predictions');
    const data = await res.json();
    renderPredictions(data);
  } catch {
    list.innerHTML = '<p class="empty-state">Failed to fetch predictions. Try again.</p>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analyze';
  }
});

function renderPredictions(data) {
  const list = document.getElementById('predictions-list');

  if (!data.predictions || data.predictions.length === 0) {
    list.innerHTML = `<p class="empty-state">${esc(data.message || 'No predictions available.')}</p>`;
    return;
  }

  list.innerHTML = data.predictions.map(p => `
    <div class="prediction-card">
      <div class="pred-name">
        ${esc(p.name || p.tcin)}
        <span class="confidence-badge ${p.confidence}">${esc(p.confidence)}</span>
      </div>
      <div class="pred-pattern">Pattern: ${esc(p.pattern)}</div>
      <div class="pred-next">Next restock: ${esc(p.nextRestock)}</div>
      ${p.tip ? `<div class="pred-tip">${esc(p.tip)}</div>` : ''}
    </div>
  `).join('');
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ─── Start ────────────────────────────────────────────────────────────────
connectWS();
