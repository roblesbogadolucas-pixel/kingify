/**
 * Kingify v2 — Entry Point
 * Agente WhatsApp inteligente para ERP (Baileys + chip físico)
 */
require('dotenv').config();

// Validar env vars críticas
const REQUIRED_ENV = ['ANTHROPIC_API_KEY', 'NINOXNET_BASE_URL', 'NINOXNET_USER', 'NINOXNET_PASSWORD'];
for (const env of REQUIRED_ENV) {
  if (!process.env[env]) {
    console.error(`[fatal] Falta variable de entorno: ${env}`);
    process.exit(1);
  }
}

const store = require('./memory/store');
const knowledge = require('./memory/knowledge');
const whatsapp = require('./whatsapp');

async function main() {
  console.log('=== Kingify v2.3 ===');
  console.log('Agente WhatsApp inteligente para ERP');
  console.log('WhatsApp via Baileys (chip fisico)\n');

  // 1. Inicializar SQLite
  await store.init();

  // 2. Indexar knowledge base
  knowledge.init();

  // 3. Stats
  const stats = store.getStats();
  console.log(`[init] DB: ${stats.messages} mensajes, ${stats.learnings} aprendizajes, ${stats.contacts} contactos`);
  console.log(`[init] Knowledge: ${knowledge.getChunkCount()} chunks indexados`);

  // 4. Warnings
  if (!process.env.OPENAI_API_KEY) console.log('[warn] Sin OPENAI_API_KEY — audios no van a funcionar');
  if (!process.env.RESEND_API_KEY) console.log('[warn] Sin RESEND_API_KEY — solicitudes se guardan en archivo');

  // 5. Iniciar WhatsApp
  console.log('\n[init] Conectando a WhatsApp...');
  whatsapp.start();
}

main().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n[shutdown] Cerrando...');
  store.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  store.close();
  process.exit(0);
});

// No crashear por errores no manejados
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err?.message || err);
});
