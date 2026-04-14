/**
 * Kingify v2 — Caché en memoria con TTL
 * Tipos: stock, ventas, facturacion, comprobantes, saldos, canales, facturas
 */
const config = require('../config');

const store = new Map();
const MAX_ENTRIES = 200;

// Normalizar params para evitar colisiones por orden de keys
function sortedStringify(obj) {
  if (!obj || typeof obj !== 'object') return String(obj);
  return JSON.stringify(Object.keys(obj).sort().reduce((acc, key) => {
    acc[key] = obj[key];
    return acc;
  }, {}));
}

function makeKey(type, params) {
  return `${type}:${sortedStringify(params)}`;
}

function get(type, params) {
  const key = makeKey(type, params);
  const entry = store.get(key);
  if (!entry) return null;

  const ttl = config.cache[type] || 60_000;
  if (Date.now() - entry.ts > ttl) {
    store.delete(key);
    return null;
  }

  return entry.data;
}

function set(type, params, data) {
  // Evict si llegamos al máximo
  if (store.size >= MAX_ENTRIES) {
    // Borrar las más viejas
    const entries = [...store.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < 50; i++) {
      store.delete(entries[i][0]);
    }
  }

  const key = makeKey(type, params);
  store.set(key, { data, ts: Date.now() });
}

function invalidate(type) {
  for (const key of store.keys()) {
    if (key.startsWith(`${type}:`)) {
      store.delete(key);
    }
  }
}

function clear() {
  store.clear();
}

function stats() {
  let active = 0;
  let expired = 0;
  for (const [key, entry] of store) {
    const type = key.split(':')[0];
    const ttl = config.cache[type] || 60_000;
    if (Date.now() - entry.ts > ttl) expired++;
    else active++;
  }
  return { active, expired, total: store.size };
}

module.exports = { get, set, invalidate, clear, stats };
