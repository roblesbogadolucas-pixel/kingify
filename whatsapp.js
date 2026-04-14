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

  // Usar pairing code si hay número configurado (para vincular sin QR en la nube)
  const PHONE_NUMBER = process.env.WA_PHONE_NUMBER || '';
  const usePairingCode = PHONE_NUMBER && !state.creds?.registered;
  let waitingForPairing = false;

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: usePairingCode ? ['Chrome (Linux)', '', ''] : ['Kingify', 'Chrome', '1.0'],
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
  });

  // Solicitar pairing code si no hay sesión
  if (usePairingCode) {
    waitingForPairing = true;
    await new Promise(r => setTimeout(r, 5000));
    try {
      const code = await sock.requestPairingCode(PHONE_NUMBER);
      console.log('');
      console.log('========================================');
      console.log('========================================');
      console.log(`    CODIGO: ${code}`);
      console.log('========================================');
      console.log('========================================');
      console.log('');
      console.log('Ingresalo en WhatsApp > Dispositivos vinculados > Vincular con numero');
      console.log('Tenes 3 minutos. Esperando vinculacion...');
      console.log('');
    } catch (err) {
      console.error('[wa] Error pairing code:', err.message);
      console.log('[wa] Reiniciando en 15s para nuevo código...');
      setTimeout(connect, 15000);
      return;
    }
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !usePairingCode) {
      console.log('\n[wa] Escaneá este QR con WhatsApp:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      console.log(`[wa] Conexión cerrada. Status: ${statusCode}`);

      // Si estamos esperando que pongan el código, NO reconectar — esperar 3 minutos
      if (waitingForPairing) {
        console.log('[wa] Esperando vinculación... no reconectar todavía.');
        console.log('[wa] Si el código expiró, se genera uno nuevo en 180s.');
        setTimeout(() => {
          waitingForPairing = false;
          // Limpiar auth y reconectar
          try {
            const files = fs.readdirSync(AUTH_DIR);
            for (const f of files) fs.unlinkSync(path.join(AUTH_DIR, f));
          } catch {}
          connect();
        }, 180000);
        return;
      }

      if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
        console.log('[wa] Sesión inválida, limpiando auth...');
        try {
          const files = fs.readdirSync(AUTH_DIR);
          for (const f of files) fs.unlinkSync(path.join(AUTH_DIR, f));
        } catch {}
        setTimeout(connect, 5000);
      } else {
        retryCount++;
        const delay = retryCount <= 5 ? retryCount * 2000 : 30000;
        console.log(`[wa] Reconectando en ${delay / 1000}s (intento ${retryCount})...`);
        setTimeout(connect, delay);
      }
    }

    if (connection === 'open') {
      waitingForPairing = false;
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
