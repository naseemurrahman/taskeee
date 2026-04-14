// redis.js — gracefully falls back to in-memory if Redis unavailable
const logger = require('./logger');

// In-memory fallback store
const memStore = new Map();
let usingMemory = false;

const memClient = {
  get: async (k) => memStore.get(k) ?? null,
  set: async (k, v) => { memStore.set(k, v); return 'OK'; },
  setEx: async (k, ttl, v) => {
    memStore.set(k, v);
    setTimeout(() => memStore.delete(k), ttl * 1000);
    return 'OK';
  },
  del: async (k) => { memStore.delete(k); return 1; },
  keys: async (pattern) => {
    const prefix = pattern.replace('*', '');
    return [...memStore.keys()].filter(k => k.startsWith(prefix));
  },
};

let client = memClient;

async function connectRedis() {
  const url = process.env.REDIS_URL || '';
  if (url === 'memory://' || url === '' || process.env.DEMO_MODE === 'true') {
    logger.info('Redis: using in-memory cache (demo mode)');
    usingMemory = true;
    return;
  }
  try {
    const { createClient } = require('redis');
    const rc = createClient({ url, socket: { connectTimeout: 3000, reconnectStrategy: false } });
    rc.on('error', () => {});
    await rc.connect();
    client = rc;
    logger.info('Redis connected');
  } catch {
    logger.warn('Redis unavailable — using in-memory cache');
    usingMemory = true;
  }
}

function getRedis() { return client; }

async function cacheSet(key, value, ttlSeconds = 300) {
  try { await client.setEx(key, ttlSeconds, JSON.stringify(value)); } catch {}
}
async function cacheGet(key) {
  try {
    const v = await client.get(key);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}
async function cacheDel(key) {
  try { await client.del(key); } catch {}
}
async function cacheDelPattern(pattern) {
  try {
    const keys = await client.keys(pattern);
    if (keys.length > 0) await client.del(keys);
  } catch {}
}

module.exports = { connectRedis, getRedis, cacheSet, cacheGet, cacheDel, cacheDelPattern };
