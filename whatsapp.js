/**
 * Kingify v2 — WhatsApp Connection (Baileys)
 */
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const path = require('path');
const http = require('http');
const config = require('./config');
const router = require('./router');
const { processQuery } = require('./agent');
const { transcribe } = require('./audio');
const store = require('./memory/store');
const cron = require('./cron');

const fs = require('fs');
const AUTH_DIR = config.paths.auth;
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

// Limpiar auth si se pide (para forzar QR nuevo en Railway)
if (process.env.WA_CLEAR_AUTH === 'true') {
  console.log('[wa] WA_CLEAR_AUTH=true — limpiando sesión para QR nuevo...');
  try {
    const files = fs.readdirSync(AUTH_DIR);
    for (const f of files) fs.unlinkSync(path.join(AUTH_DIR, f));
    console.log(`[wa] ${files.length} archivos de auth eliminados`);
  } catch {}
}

const QRCode = require('qrcode');
let currentSock = null;
let currentQR = null;

async function start() {
  // Health check server para Railway
  const PORT = process.env.PORT || 3000;
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
      const connected = !!currentSock?.user;
      res.writeHead(connected ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: connected ? 'ok' : 'waiting_qr', service: 'kingify-v2', hasQR: !!currentQR }));
      return;
    }
    // QR como página web — acceder desde el navegador del celular
    if (req.method === 'GET' && req.url === '/qr') {
      if (currentSock?.user) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;font-size:24px">Ya esta conectado!</body></html>');
        return;
      }
      if (!currentQR) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;font-size:24px">Esperando QR... Recarga en unos segundos.<script>setTimeout(()=>location.reload(),3000)</script></body></html>');
        return;
      }
      try {
        const qrImage = await QRCode.toDataURL(currentQR, { width: 400, margin: 2 });
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;font-family:sans-serif">
          <h2>Escanea este QR con WhatsApp</h2>
          <img src="${qrImage}" style="width:400px;height:400px"/>
          <p>Dispositivos vinculados > Vincular dispositivo</p>
          <script>setTimeout(()=>location.reload(),20000)</script>
        </body></html>`);
      } catch {
        res.writeHead(500);
        res.end('Error generando QR');
      }
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });
  server.listen(PORT, () => console.log(`[health] Puerto ${PORT}`));

  connectWhatsApp();
}

async function connectWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  currentSock = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      console.log('[wa] QR generado — escanealo en: https://kingify-production.up.railway.app/qr');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log(`[wa] Conexión cerrada. Status: ${statusCode}`);

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('[wa] Logged out. Limpiando auth...');
        try {
          const files = fs.readdirSync(AUTH_DIR);
          for (const f of files) fs.unlinkSync(path.join(AUTH_DIR, f));
        } catch {}
      }
      // Siempre reconectar
      console.log('[wa] Reconectando en 5s...');
      setTimeout(connectWhatsApp, 5000);
    } else if (connection === 'open') {
      currentQR = null;
      console.log('[wa] Conectado a WhatsApp');

      // Iniciar reporte diario — envía al número configurado en REPORT_CHAT_ID
      const reportChatId = process.env.REPORT_CHAT_ID;
      if (reportChatId) {
        const sendFn = (chatId, text) => sock.sendMessage(chatId, { text });
        cron.init(sendFn, reportChatId);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
    if (type !== 'notify') return;

    for (const msg of msgs) {
      if (msg.key.fromMe) continue;
      if (!msg.message) continue;

      const chatId = msg.key.remoteJid;

      // Ignorar grupos, newsletters, broadcasts
      if (chatId.includes('@g.us') || chatId.includes('@newsletter') || chatId.includes('@broadcast')) continue;

      let userText = null;
      let imageBuffer = null;

      // Unwrap Baileys message wrappers (viewOnce, ephemeral, etc)
      let innerMsg = msg.message;
      if (innerMsg.viewOnceMessage) innerMsg = innerMsg.viewOnceMessage.message;
      if (innerMsg.viewOnceMessageV2) innerMsg = innerMsg.viewOnceMessageV2.message;
      if (innerMsg.ephemeralMessage) innerMsg = innerMsg.ephemeralMessage.message;
      if (innerMsg.documentWithCaptionMessage) innerMsg = innerMsg.documentWithCaptionMessage.message;

      // Log tipo de mensaje para debug
      const msgTypes = Object.keys(innerMsg).filter(k => !k.startsWith('message') && k !== 'senderKeyDistributionMessage');
      if (msgTypes.length > 0) console.log(`[wa] Msg tipo: ${msgTypes.join(',')}`);

      // Texto
      if (innerMsg.conversation) {
        userText = innerMsg.conversation;
      } else if (innerMsg.extendedTextMessage?.text) {
        userText = innerMsg.extendedTextMessage.text;
      }
      // Imagen (con o sin caption)
      else if (innerMsg.imageMessage) {
        userText = innerMsg.imageMessage.caption || 'Analizá esta imagen';
        try {
          console.log(`[wa] Imagen de ${chatId.split('@')[0]}`);
          imageBuffer = await downloadMediaMessage(msg, 'buffer', {}, {
            reuploadRequest: sock.updateMediaMessage,
          });
          if (!imageBuffer || imageBuffer.length === 0) imageBuffer = null;
          else console.log(`[wa] Imagen descargada: ${imageBuffer.length} bytes`);
        } catch (err) {
          console.error('[wa] Error imagen:', err.message);
          imageBuffer = null;
        }
      }
      // Video (solo caption, no procesamos el video)
      else if (innerMsg.videoMessage?.caption) {
        userText = innerMsg.videoMessage.caption;
      }
      // Documento (PDF, etc)
      else if (innerMsg.documentMessage) {
        userText = innerMsg.documentMessage.caption || 'Me mandaron un documento';
        console.log(`[wa] Documento: ${innerMsg.documentMessage.fileName || 'sin nombre'}`);
      }
      // Sticker — ignorar silenciosamente
      else if (innerMsg.stickerMessage) {
        continue;
      }
      // Audio
      else if (innerMsg.audioMessage || innerMsg.pttMessage) {
        try {
          console.log(`[wa] Audio de ${chatId.split('@')[0]}`);
          try { await sock.sendPresenceUpdate('recording', chatId); } catch {}

          const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
            reuploadRequest: sock.updateMediaMessage,
          });

          if (!buffer || buffer.length === 0) throw new Error('Buffer vacío');
          userText = await transcribe(buffer);
          console.log(`[wa] Transcripcion: ${userText.substring(0, 80)}`);
        } catch (err) {
          console.error('[wa] Error audio:', err.message);
          try { await sock.sendPresenceUpdate('paused', chatId); } catch {}
          await sock.sendMessage(chatId, { text: 'No pude escuchar el audio, podes escribirlo?' });
          continue;
        }
      }

      if (!userText) continue;

      const contactId = chatId.split('@')[0];
      console.log(`[wa] ${contactId}: ${userText.substring(0, 80)}`);

      store.addMessage(contactId, 'user', userText);

      try {
        // Marcar como leído
        try { await sock.readMessages([msg.key]); } catch {}
        // Escribiendo...
        try { await sock.sendPresenceUpdate('composing', chatId); } catch {}

        const msgType = router.classify(userText);
        let reply;
        let meta = {};

        if (msgType !== 'query') {
          reply = router.getResponse(msgType);
          console.log(`[wa] Router: ${msgType} → respuesta directa`);
        } else {
          const result = await processQuery(contactId, userText, imageBuffer);
          reply = result.reply;
          meta = {
            model: result.model,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
            toolsUsed: result.toolsUsed,
          };
          console.log(`[wa] Agent: ${result.model} | ${result.tokensIn}+${result.tokensOut} tokens | tools: ${result.toolsUsed.join(',') || 'ninguno'}`);
        }

        // Parar typing
        try { await sock.sendPresenceUpdate('paused', chatId); } catch {}

        // Enviar respuesta
        if (reply.length > 3500) {
          const parts = reply.match(/[\s\S]{1,3500}/g) || [reply];
          for (const part of parts) {
            await sock.sendMessage(chatId, { text: part.trim() });
          }
        } else {
          await sock.sendMessage(chatId, { text: reply });
        }

        store.addMessage(contactId, 'assistant', reply, meta);

      } catch (err) {
        console.error('[wa] Error:', err.message);
        try { await sock.sendPresenceUpdate('paused', chatId); } catch {}

        if (err.status === 529 || err.message?.includes('overloaded')) {
          await sock.sendMessage(chatId, { text: 'Estoy con mucha demanda, proba en unos minutos.' });
        } else {
          await sock.sendMessage(chatId, { text: 'Tuve un error, proba de nuevo.' });
        }
      }
    }
  });
}

module.exports = { start };
