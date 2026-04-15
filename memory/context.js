/**
 * Kingify v2.4 — Context Builder
 */
const fs = require('fs');
const config = require('../config');
const store = require('./store');
const knowledge = require('./knowledge');

function buildSystemPrompt() {
  const hoy = new Date();
  const fechaHoy = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;
  const biz = config.kingtex.business;

  return `Fecha: ${fechaHoy}

Sos Kingify, asistente de Kingtex (fábrica textil argentina). Hablás por WhatsApp, español argentino, conciso y directo. NUNCA inventés datos — siempre usá herramientas.

NEGOCIO: Lead time ${biz.leadTime}d | Horizonte ${biz.horizonte}d | Ventana ${biz.ventanaDias}d
Productos: remeras ALGO, buzos FRIZ, set SETP, gorras IMPO
Canales: Local(4), WhatsApp(5), Fábrica(8), Online(9), Henko(11)
Vendedores: Daniel(11977), Daniel 2(11978), Lautaro(3233), Lautaro 2(9265), Susana(12529)

HERRAMIENTA PRINCIPAL — consultar_erp:
Usá consultar_erp con el "tipo" correcto:
- stock → stock por talle/color
- ventas → ranking artículos vendidos
- ventas_detalle → desglose por color/talle (curva)
- facturacion → total + por canal en 1 consulta
- comprobantes → facturas con cliente/monto/canal
- ver_factura → detalle de una factura (productos + método pago)
- ranking_vendedores → TODOS los vendedores con facturación
- gastos → todo lo registrado (compras + pagos)
- saldos → clientes con deuda
- metodos_pago → cuánto en efectivo/tarjeta/deposito/etc

OTRAS HERRAMIENTAS:
- calcular_reposicion → cuánto fabricar
- buscar_cliente → buscar por nombre
- comparar_anio → producto este año vs año anterior
- comparar_facturacion → dos períodos
- ventas_por_etiqueta → filtrar por tag (SET DEPORTIVO, ALGODON 24.1, etc)
- stock_historial → stock día a día, detectar días sin stock
- consultar_cheques, consultar_cortes, consultar_talleres → fábrica/producción
- google_sheets → crear/leer/escribir planillas (SIEMPRE mandá el link)
- guardar_aprendizaje → guardar correcciones, preferencias, éxitos

REGLAS:
1. CERO emojis. Formato WhatsApp: *negrita con un asterisco*.
2. SIEMPRE usá herramientas para datos. NUNCA inventes.
3. SIEMPRE mencioná el período cuando reportes datos.
4. Si te corrigen o felicitan → guardar_aprendizaje.
5. Para Google Sheets: consultá datos primero, después creá/completá la sheet. SIEMPRE mandá el link.
6. NUNCA digas "no puedo" o "contacto a soporte". Si tenés una herramienta que se acerca, usala. Si realmente no podés, decilo simple sin mandar emails.
7. Herramientas actuales SIEMPRE tienen prioridad sobre aprendizajes viejos.
8. Respondé conciso. Datos, no explicaciones.`;
}

function getBusinessRules() {
  const memoryPath = config.kingtex.paths.memory;
  if (!fs.existsSync(memoryPath)) return '';
  try { return fs.readFileSync(memoryPath, 'utf-8').substring(0, 2000); } catch { return ''; }
}

function buildContext(contactId, userMessage) {
  const parts = [buildSystemPrompt()];

  const rules = getBusinessRules();
  if (rules) parts.push(`\n--- Reglas ---\n${rules}`);

  // Aprendizajes — filtrar obsoletos
  const allLearnings = store.getLearnings();
  if (allLearnings.length > 0) {
    const seen = new Set();
    const obsoletePatterns = [/no (puedo|puede|tengo|tiene)/i, /no (se puede|está disponible)/i, /falta endpoint/i, /no devuelve/i, /no trae/i];
    const unique = allLearnings.filter(l => {
      const key = l.content.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      if (l.content.startsWith('Solicitud enviada:')) return false;
      if (obsoletePatterns.some(p => p.test(l.content))) return false;
      return true;
    });

    const corrections = unique.filter(l => l.category === 'correccion');
    const successes = unique.filter(l => l.category === 'exito');
    const preferences = unique.filter(l => l.category === 'preferencia');
    const business = unique.filter(l => l.category === 'negocio');
    const erp = unique.filter(l => l.category === 'erp');

    if (corrections.length) parts.push(`\n--- ERRORES (no repetir) ---\n${corrections.map(l => `- ${l.content}`).join('\n')}`);
    if (successes.length) parts.push(`\n--- ÉXITOS (repetir) ---\n${successes.map(l => `- ${l.content}`).join('\n')}`);
    if (preferences.length) parts.push(`\n--- PREFERENCIAS ---\n${preferences.map(l => `- ${l.content}`).join('\n')}`);
    if (business.length) parts.push(`\n--- NEGOCIO ---\n${business.map(l => `- ${l.content}`).join('\n')}`);
    if (erp.length) parts.push(`\n--- ERP ---\n${erp.map(l => `- ${l.content}`).join('\n')}`);
  }

  // Knowledge base
  const knowledgeResults = knowledge.search(userMessage, 2);
  if (knowledgeResults.length > 0) {
    parts.push(`\n--- Knowledge ---\n${knowledgeResults.map(k => `### ${k.title}\n${k.content}`).join('\n\n')}`);
  }

  const prefs = store.getPreferences(contactId);
  if (Object.keys(prefs).length > 0) parts.push(`\n--- Prefs contacto ---\n${JSON.stringify(prefs)}`);

  const systemPrompt = parts.join('\n');
  const recentMessages = store.getRecentMessages(contactId, 20);
  const messages = recentMessages.map(m => ({ role: m.role, content: m.content }));

  return { systemPrompt, messages };
}

module.exports = { buildContext, buildSystemPrompt };
