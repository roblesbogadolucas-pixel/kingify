/**
 * Kingify v2 — WhatsApp Connection (Baileys)
 */
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const path = require('path');
const config = require('./config');
const router = require('./router');
const { processQuery } = require('./agent');
const { transcribe } = require('./audio');
const store = require('./memory/store');

const fs = require('fs');
const AUTH_DIR = config.paths.auth;
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

// Map de LID → autorizado (se puebla al recibir mensajes con notify/sender_pn)
const authorizedLids = new Set();

function isAuthorized(jid) {
  // Grupos y newsletters — ignorar
  if (jid.includes('@g.us') || jid.includes('@newsletter') || jid.includes('@broadcast')) return false;

  // Si ya lo autorizamos antes
  if (authorizedLids.has(jid)) return true;

  // JIDs con número de teléfono (@s.whatsapp.net)
  const numbers = config.kingtex.whatsapp.authorizedNumbers;
  if (numbers.length === 0) return true;

  const cleaned = jid.split('@')[0].replace(/\D/g, '');
  const matchByNumber = numbers.some(n => {
    const cleanN = n.replace(/\D/g, '');
    return cleaned.includes(cleanN) || cleanN.includes(cleaned);
  });

  if (matchByNumber) {
    authorizedLids.add(jid);
    return true;
  }

  // LIDs (@lid) — Baileys 6.6 usa IDs internos, no tienen el número
  // Autorizar todos los chats individuales @lid por ahora
  // (grupos ya fueron filtrados arriba)
  if (jid.endsWith('@lid') || jid.endsWith('@s.whatsapp.net')) {
    authorizedLids.add(jid);
    return true;
  }

  return false;
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        console.log('[wa] Sesión cerrada. Eliminá auth/ y arrancá de nuevo.');
        process.exit(0);
      } else {
        console.log('[wa] Reconectando en 5s...');
        setTimeout(() => start(), 5000);
      }
    } else if (connection === 'open') {
      console.log('[wa] Conectado a WhatsApp');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
    if (type !== 'notify') return;

    for (const msg of msgs) {
      if (msg.key.fromMe) continue;
      if (!msg.message) continue;

      const chatId = msg.key.remoteJid;

      if (!isAuthorized(chatId)) {
        console.log(`[wa] No autorizado: ${chatId}`);
        continue;
      }

      let userText = null;

      // Texto
      if (msg.message.conversation) {
        userText = msg.message.conversation;
      } else if (msg.message.extendedTextMessage?.text) {
        userText = msg.message.extendedTextMessage.text;
      }
      // Audio
      else if (msg.message.audioMessage || msg.message.pttMessage) {
        try {
          console.log(`[wa] Audio de ${chatId.split('@')[0]}`);
          await sock.sendMessage(chatId, { react: { text: '🎤', key: msg.key } });

          const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
            reuploadRequest: sock.updateMediaMessage,
          });

          if (!buffer || buffer.length === 0) throw new Error('Buffer vacío');
          userText = await transcribe(buffer);
          console.log(`[wa] Transcripción: ${userText.substring(0, 80)}`);
        } catch (err) {
          console.error('[wa] Error audio:', err.message);
          await sock.sendMessage(chatId, { text: 'No pude escuchar el audio, podés escribirlo?' });
          continue;
        }
      }

      if (!userText) continue;

      const contactId = chatId.split('@')[0];
      console.log(`[wa] ${contactId}: ${userText.substring(0, 80)}`);

      // Guardar mensaje del usuario
      store.addMessage(contactId, 'user', userText);

      try {
        await sock.sendPresenceUpdate('composing', chatId);

        // Router — clasificar primero
        const type = router.classify(userText);

        let reply;
        let meta = {};

        if (type !== 'query') {
          // Respuesta local, sin IA
          reply = router.getResponse(type);
          console.log(`[wa] Router: ${type} → respuesta directa`);
        } else {
          // Consulta ERP → Agent
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

        // Enviar respuesta (split si es larga)
        if (reply.length > 3500) {
          const parts = reply.match(/[\s\S]{1,3500}/g) || [reply];
          for (const part of parts) {
            await sock.sendMessage(chatId, { text: part.trim() });
          }
        } else {
          await sock.sendMessage(chatId, { text: reply });
        }

        // Guardar respuesta
        store.addMessage(contactId, 'assistant', reply, meta);

      } catch (err) {
        console.error('[wa] Error:', err.message);

        if (err.status === 529 || err.message?.includes('overloaded')) {
          await sock.sendMessage(chatId, { text: 'Estoy con mucha demanda, probá en unos minutos.' });
        } else {
          await sock.sendMessage(chatId, { text: 'Tuve un error, probá de nuevo.' });
        }
      }
    }
  });

  return sock;
}

module.exports = { start };
