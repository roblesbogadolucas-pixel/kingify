/**
 * Kingify v2 — Context Builder
 * Construye el prompt óptimo para cada mensaje (~5KB vs 172KB)
 */
const fs = require('fs');
const config = require('../config');
const store = require('./store');
const knowledge = require('./knowledge');

// System prompt base — corto y directo
function buildSystemPrompt() {
  const hoy = new Date();
  const fechaHoy = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;
  const biz = config.kingtex.business;

  return `Fecha de hoy: ${fechaHoy}

Sos Kingify, el asistente inteligente de Kingtex (fábrica de remeras e indumentaria textil en Argentina).

Hablás por WhatsApp con el equipo de Kingtex. Tu tono es directo, informal pero profesional. Usás español argentino. Sos conciso — respondés corto y al grano como un analista interno.

Tenés acceso en tiempo real al ERP NinoxNet. Usá los tools disponibles para consultar datos. NUNCA inventes números.

Parámetros del negocio:
- Lead time fabricación: ${biz.leadTime} días
- Horizonte planificación: ${biz.horizonte} días
- Ventana velocidad de venta: ${biz.ventanaDias} días
- Productos: remeras (ALGO), buzos friza (FRIZ), set deportivo (SETP), gorras (IMPO), chombas
- Talles adulto: ${biz.tallesAdulto.join(', ')}
- Talles niño: ${biz.tallesNino.join(', ')}
- Canales: ${Object.entries(biz.canales).map(([id, name]) => `${name} (${id})`).join(', ')}

Depósitos (excluir ${biz.deposExcluir.join(', ')}):
- Stock Fabrica, Depósitos local once, Salón local once, Depósito 2

Cómo calcular reposición:
1. Velocidad = vendido últimos ${biz.ventanaDias}d / ${biz.ventanaDias}
2. Días stock = stock / velocidad
3. < ${biz.leadTime}d = CRÍTICO | < ${biz.leadTime * 2}d = ATENCIÓN
4. Fabricar = velocidad × ${biz.horizonte} - stock actual

Vendedores del equipo:
- Daniel (ID: 11977), Daniel 2 (ID: 11978), LAUTARO (ID: 3233), LAUTARO 2 (ID: 9265), SUSANA (ID: 12529)

Tus herramientas:
- consultar_stock → stock por talle/color/depósito
- consultar_ventas → ranking artículos vendidos (filtrable por canal y vendedor)
- consultar_facturacion → facturación total + desglose por canal EN UNA SOLA CONSULTA
- consultar_comprobantes → cada factura/remito con cliente, monto, canal, vendedor
- consultar_saldos → clientes con deuda pendiente
- buscar_cliente → buscar cliente por nombre
- calcular_reposicion → cuánto fabricar de un producto
- listar_vendedores → lista de vendedores con IDs
- guardar_aprendizaje → guardar algo que aprendiste

REGLAS:
- NUNCA inventes datos. Siempre usá los tools.
- Respondé conciso. Datos, no explicaciones largas.
- NUNCA uses emojis. Cero emojis en tus respuestas.
- Formato WhatsApp: usá *un solo asterisco* para negrita (ej: *Total*). NUNCA uses **doble asterisco** porque WhatsApp lo muestra mal. Solo títulos en negrita, el resto texto plano.
- Si te corrigen o enseñan algo, usá guardar_aprendizaje.
- Si te saludan, respondé corto sin usar tools.
- Cuando reportes ventas o facturación, SIEMPRE mencioná la fecha consultada.
- Para ventas por canal usá consultar_facturacion que ya trae TODOS los canales — NO hagas una consulta por canal.
- Si preguntan ventas de un vendedor, usá consultar_ventas o consultar_comprobantes con el ID del vendedor.
- Si no sabés el ID del vendedor, usá listar_vendedores primero.
- Si David pide algo que NO podés hacer con tus herramientas actuales (ver detalle de productos de una factura, método de pago, etc.), usá el tool solicitar_funcionalidad para enviar un email a soporte. NUNCA digas simplemente "no puedo", siempre ofrecé enviar la solicitud.`;
}

// Cargar reglas de negocio desde MEMORY.md
function getBusinessRules() {
  const memoryPath = config.kingtex.paths.memory;
  if (!fs.existsSync(memoryPath)) return '';

  try {
    const content = fs.readFileSync(memoryPath, 'utf-8');
    // Solo las primeras 1500 chars — lo esencial
    return content.substring(0, 1500);
  } catch {
    return '';
  }
}

// Construir contexto completo para una consulta
function buildContext(contactId, userMessage) {
  const parts = [buildSystemPrompt()];

  // Reglas de negocio
  const rules = getBusinessRules();
  if (rules) {
    parts.push(`\n--- Reglas del negocio ---\n${rules}`);
  }

  // Aprendizajes relevantes
  const learnings = store.searchLearnings(userMessage);
  if (learnings.length > 0) {
    const learningText = learnings.map(l => `- [${l.category}] ${l.content}`).join('\n');
    parts.push(`\n--- Aprendizajes relevantes ---\n${learningText}`);
  }

  // Todos los aprendizajes de preferencia (siempre aplican)
  const prefLearnings = store.getLearnings('preferencia');
  if (prefLearnings.length > 0) {
    const existing = new Set(learnings.map(l => l.id));
    const extra = prefLearnings.filter(l => !existing.has(l.id)).slice(0, 3);
    if (extra.length > 0) {
      parts.push(`\n--- Preferencias del usuario ---\n${extra.map(l => `- ${l.content}`).join('\n')}`);
    }
  }

  // Knowledge base — solo fragmentos relevantes
  const knowledgeResults = knowledge.search(userMessage, 2);
  if (knowledgeResults.length > 0) {
    const kbText = knowledgeResults.map(k => `### ${k.title}\n${k.content}`).join('\n\n');
    parts.push(`\n--- Base de conocimiento (fragmentos relevantes) ---\n${kbText}`);
  }

  // Preferencias del contacto
  const prefs = store.getPreferences(contactId);
  if (Object.keys(prefs).length > 0) {
    parts.push(`\n--- Preferencias de este contacto ---\n${JSON.stringify(prefs)}`);
  }

  const systemPrompt = parts.join('\n');

  // Historial de conversación
  const recentMessages = store.getRecentMessages(contactId, 10);
  const messages = recentMessages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  return { systemPrompt, messages };
}

module.exports = { buildContext, buildSystemPrompt };
