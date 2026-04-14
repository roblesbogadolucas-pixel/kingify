/**
 * Kingify v2 — Entry Point
 * Agente WhatsApp inteligente para ERP
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const store = require('./memory/store');
const knowledge = require('./memory/knowledge');
const whatsapp = require('./whatsapp');

async function main() {
  console.log('=== Kingify v2 ===');
  console.log('Agente WhatsApp inteligente para ERP\n');

  // 1. Inicializar SQLite (async por sql.js)
  await store.init();

  // 2. Migrar datos de v1 si es primera vez
  const dbStats = store.getStats();
  if (dbStats.messages === 0) {
    const v1Dir = path.join(__dirname, '..');
    const aprendizajesPath = path.join(v1Dir, 'aprendizajes.md');
    const chatsDir = path.join(v1Dir, 'chats');

    if (fs.existsSync(aprendizajesPath) || fs.existsSync(chatsDir)) {
      console.log('[init] Migrando datos de v1...');
      store.migrateFromV1(aprendizajesPath, chatsDir);
    }
  }

  // 3. Indexar knowledge base
  knowledge.init();

  // 4. Stats
  const stats = store.getStats();
  console.log(`[init] DB: ${stats.messages} mensajes, ${stats.learnings} aprendizajes, ${stats.contacts} contactos`);
  console.log(`[init] Knowledge: ${knowledge.getChunkCount()} chunks indexados`);

  // 5. Conectar WhatsApp
  console.log('\n[init] Conectando a WhatsApp...');
  console.log('       Escaneá el QR si es la primera vez\n');
  await whatsapp.start();
}

main().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});

// Cleanup
process.on('SIGINT', () => {
  console.log('\n[shutdown] Cerrando...');
  store.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  store.close();
  process.exit(0);
});
