/**
 * Kingify v2 — Caché en memoria con TTL
 */
const config = require('../config');

const store = new Map();

function makeKey(type, params) {
  return `${type}:${JSON.stringify(params)}`;
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
