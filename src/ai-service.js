/**
 * Local AI integration via Ollama — restock predictions only.
 * Requires Ollama running locally: https://ollama.com
 * No API keys, no quotas, fully offline.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1';

async function ollamaGenerate(prompt, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.3 },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama ${res.status}: ${text}`);
    }

    const data = await res.json();
    return data.response;
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonResponse(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * Check if Ollama is running and the model is available.
 */
export async function isConfigured() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json();
    const models = data.models?.map(m => m.name) ?? [];
    return models.some(m => m.startsWith(OLLAMA_MODEL));
  } catch {
    return false;
  }
}

/**
 * Analyze stock history to predict restock patterns.
 * This is the only AI function — called on-demand from the dashboard.
 */
export async function predictRestocks(stockHistory, products) {
  if (stockHistory.length === 0) return null;

  try {
    const eventsByProduct = {};
    for (const e of stockHistory) {
      if (!eventsByProduct[e.tcin]) eventsByProduct[e.tcin] = [];
      eventsByProduct[e.tcin].push({ event: e.event, time: e.timestamp });
    }

    const summary = products.map(p => {
      const events = eventsByProduct[p.tcin] || [];
      if (events.length === 0) return `${p.name} (${p.tcin}): No stock events recorded yet.`;
      const lines = events.slice(-20).map(e =>
        `  ${e.event} at ${new Date(e.time).toLocaleString()}`
      ).join('\n');
      return `${p.name} (${p.tcin}):\n${lines}`;
    }).join('\n\n');

    const prompt = `You are a retail stock pattern analyst specializing in Pokemon TCG products at Target.

Below is the stock event history for monitored products. Each event shows when a product went "in_stock" or "out_of_stock" with timestamps.

Analyze the patterns and for each product provide:
1. Any detected restock patterns (day of week, time of day, frequency)
2. A predicted next restock window if possible
3. A confidence level (low/medium/high)

If there is not enough data for a product, say so and suggest how long to keep monitoring.

Respond with JSON only:
{
  "predictions": [
    {
      "tcin": "...",
      "name": "...",
      "pattern": "description of detected pattern or 'Insufficient data'",
      "nextRestock": "predicted window or 'Unknown'",
      "confidence": "low|medium|high",
      "tip": "actionable advice for the collector"
    }
  ]
}

Stock History:
${summary}`;

    console.log(`[AI] Requesting restock prediction from Ollama (${OLLAMA_MODEL})...`);
    const response = await ollamaGenerate(prompt);
    const parsed = parseJsonResponse(response);
    return parsed?.predictions ?? null;
  } catch (err) {
    console.log(`[AI] Restock prediction failed: ${err.message}`);
    return null;
  }
}
