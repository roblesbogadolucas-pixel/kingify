/**
 * Kingify v2 — Email de solicitud de funcionalidad
 * Envía a soporte@poolerinc.com cuando David pide algo que Kingify no puede hacer
 */
const https = require('https');

const SMTP_ENDPOINT = 'https://api.resend.com/emails';
const FROM = 'Soporte <soporte@poolerinc.com>';
const TO = 'soporte@poolerinc.com';

async function sendSolicitud(funcionalidad, contexto) {
  const apiKey = process.env.RESEND_API_KEY;

  // Si no hay API key, guardar en archivo como fallback
  if (!apiKey) {
    const fs = require('fs');
    const path = require('path');
    const config = require('../config');
    const file = config.paths.solicitudes;
    const timestamp = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
    const entry = `[${timestamp}] ${funcionalidad}\nContexto: ${contexto}\n---\n`;
    fs.appendFileSync(file, entry);
    console.log(`[email] Sin API key — solicitud guardada en solicitudes.log`);
    return true;
  }

  const body = JSON.stringify({
    from: FROM,
    to: [TO],
    subject: `[Kingify] Solicitud: ${funcionalidad.substring(0, 60)}`,
    html: `
      <h2>Nueva solicitud de funcionalidad — Kingify</h2>
      <p><strong>Cliente:</strong> Kingtex</p>
      <p><strong>Solicitado por:</strong> David (CEO)</p>
      <p><strong>Funcionalidad:</strong> ${funcionalidad}</p>
      <p><strong>Contexto:</strong> ${contexto}</p>
      <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</p>
      <hr>
      <p><em>Enviado automáticamente por Kingify v2</em></p>
    `,
  });

  return new Promise((resolve) => {
    const req = https.request(SMTP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[email] Solicitud enviada: ${funcionalidad.substring(0, 50)}`);
          resolve(true);
        } else {
          console.error(`[email] Error ${res.statusCode}: ${data}`);
          // Fallback a archivo
          const fs = require('fs');
          const path = require('path');
          const config = require('../config');
    const file = config.paths.solicitudes;
          fs.appendFileSync(file, `[${new Date().toISOString()}] FALLBACK: ${funcionalidad}\n${contexto}\n---\n`);
          resolve(true);
        }
      });
    });

    req.on('error', (err) => {
      console.error(`[email] Error de red: ${err.message}`);
      resolve(false);
    });

    req.write(body);
    req.end();
  });
}

module.exports = { sendSolicitud };
