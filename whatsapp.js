/**
 * Kingify v2 — WhatsApp via Baileys
 * Conexión directa con chip físico
 */
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const http = require('http');

const config = require('./config');
const router = require('./router');
const { processQuery } = require('./agent');
const { transcribe } = require('./audio');
const store = require('./memory/store');

const AUTH_DIR = config.paths.auth;
let sock = null;
let retryCount = 0;

// --- Conectar a WhatsApp ---
async function connect() {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Kingify', 'Chrome', '1.0'],
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n[wa] Escaneá este QR con WhatsApp:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`[wa] Conexión cerrada. Status: ${statusCode}`);

      if (shouldReconnect) {
        retryCount++;
        // Backoff: 2s, 4s, 6s, 8s, 10s, luego siempre 30s
        const delay = retryCount <= 5 ? retryCount * 2000 : 30000;
        console.log(`[wa] Reconectando en ${delay / 1000}s (intento ${retryCount})...`);
        setTimeout(connect, delay);
      } else {
        console.log('[wa] Sesión cerrada (logged out). Borrá auth/ y escaneá QR de nuevo.');
        // Intentar reconectar en 60s por si fue un error temporal
        setTimeout(connect, 60000);
      }
    }

    if (connection === 'open') {
      retryCount = 0;
      console.log('[wa] Conectado a WhatsApp');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Mensajes entrantes
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (msg.key.fromMe) continue;
        if (msg.key.remoteJid.endsWith('@g.us')) continue;
        if (msg.key.remoteJid.endsWith('@newsletter')) continue;
        if (msg.key.remoteJid === 'status@broadcast') continue;

        const jid = msg.key.remoteJid;
        if (!jid.endsWith('@s.whatsapp.net') && !jid.includes('@lid')) continue;

        await handleMessage(msg, jid);
      } catch (err) {
        console.error('[wa] Error procesando mensaje:', err.message);
      }
    }
  });
}

// --- Enviar mensaje ---
async function sendMessage(jid, text) {
  if (!sock) return;
  const parts = text.length > 4000 ? text.match(/[\s\S]{1,4000}/g) : [text];
  for (const part of parts) {
    await sock.sendMessage(jid, { text: part.trim() });
  }
}

// --- Marcar como leído ---
async function markAsRead(msg) {
  try { await sock.readMessages([msg.key]); } catch {}
}

// --- Presence updates ---
async function sendPresence(jid, type) {
  try {
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate(type, jid);
  } catch {}
}
async function startTyping(jid) { await sendPresence(jid, 'composing'); }
async function startRecording(jid) { await sendPresence(jid, 'recording'); }
async function stopPresence(jid) { await sendPresence(jid, 'paused'); }

// --- Descargar media ---
async function downloadMedia(msg) {
  const { downloadMediaMessage } = require('@whiskeysockets/baileys');
  return downloadMediaMessage(msg, 'buffer', {});
}

// --- Extraer contenido del mensaje ---
function extractText(msg) {
  return msg.message?.conversation
    || msg.message?.extendedTextMessage?.text
    || msg.message?.imageMessage?.caption
    || msg.message?.videoMessage?.caption
    || null;
}

function extractAudio(msg) {
  return msg.message?.audioMessage || null;
}

// --- Procesar mensaje entrante ---
async function handleMessage(msg, jid) {
  let userText = null;

  // Texto
  const text = extractText(msg);
  if (text) {
    userText = text;
  }

  // Audio
  const audio = extractAudio(msg);
  if (audio && !userText) {
    try {
      console.log(`[wa] Audio de ${jid}`);
      await startRecording(jid);
      const buffer = await downloadMedia(msg);
      if (buffer && buffer.length > 0) {
        userText = await transcribe(buffer);
        console.log(`[wa] Transcripcion: ${userText.substring(0, 80)}`);
      }
    } catch (err) {
      console.error('[wa] Error audio:', err.message);
      await stopPresence(jid);
      await sendMessage(jid, 'No pude escuchar el audio, podes escribirlo?');
      return;
    }
  }

  if (!userText) return;

  // Extraer contactId
  const contactId = jid.replace('@s.whatsapp.net', '').replace(/@lid.*/, '').replace(/\D/g, '');
  console.log(`[wa] ${contactId}: ${userText.substring(0, 80)}`);

  // Guardar mensaje del usuario
  store.addMessage(contactId, 'user', userText);

  // Marcar como leído
  markAsRead(msg);

  // Mostrar "escribiendo..."
  await startTyping(jid);

  try {
    // Router: clasificar mensaje
    const msgType = router.classify(userText);
    let reply;
    let meta = {};

    if (msgType !== 'query') {
      reply = router.getResponse(msgType);
      console.log(`[wa] Router: ${msgType} → respuesta directa`);
    } else {
      const result = await processQuery(contactId, userText);
      reply = result.reply;
      meta = {
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        toolsUsed: result.toolsUsed,
      };
      console.log(`[wa] Agent: ${result.model} | ${result.tokensIn}+${result.tokensOut} tokens | tools: ${result.toolsUsed.join(',') || 'ninguno'}`);
    }

    await stopPresence(jid);
    await sendMessage(jid, reply);
    store.addMessage(contactId, 'assistant', reply, meta);

  } catch (err) {
    console.error('[wa] Error:', err.message);
    await stopPresence(jid);
    if (err.status === 529 || err.message?.includes('overloaded')) {
      await sendMessage(jid, 'Estoy con mucha demanda, proba en unos minutos.');
    } else {
      await sendMessage(jid, 'Tuve un error, proba de nuevo.');
    }
  }
}

// --- Health check server ---
function startHealthServer() {
  const PORT = process.env.PORT || 3000;

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
      const connected = !!sock?.user;
      res.writeHead(connected ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: connected ? 'ok' : 'disconnected',
        service: 'kingify-v2.3',
        connected,
        uptime: process.uptime(),
      }));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(PORT, () => {
    console.log(`[health] Servidor en puerto ${PORT}`);
  });
}

// --- Start ---
function start() {
  startHealthServer();
  connect();
}

module.exports = { start };
