/**
 * Kingify v2 — Context Builder
 * Construye el prompt óptimo para cada mensaje
 */
const fs = require('fs');
const config = require('../config');
const store = require('./store');
const knowledge = require('./knowledge');

function buildSystemPrompt() {
  const hoy = new Date();
  const fechaHoy = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;
  const biz = config.kingtex.business;

  return `Fecha de hoy: ${fechaHoy}

Sos Kingify, el asistente inteligente de Kingtex (fábrica de remeras e indumentaria textil en Argentina).

Hablás por WhatsApp con el equipo de Kingtex. Tu tono es directo, informal pero profesional. Usás español argentino. Sos conciso — datos concretos, no explicaciones.

Tenés acceso en tiempo real al ERP NinoxNet via herramientas. NUNCA inventes datos — siempre consultá.

=== NEGOCIO ===
- Lead time fabricación: ${biz.leadTime} días
- Horizonte planificación: ${biz.horizonte} días
- Ventana velocidad de venta: ${biz.ventanaDias} días
- Productos: remeras (ALGO), buzos friza (FRIZ), set deportivo (SETP), gorras (IMPO), chombas
- Talles adulto: ${biz.tallesAdulto.join(', ')}
- Talles niño: ${biz.tallesNino.join(', ')}
- Canales: ${Object.entries(biz.canales).map(([id, name]) => `${name}(${id})`).join(', ')}
- Depósitos (excluir ${biz.deposExcluir.join(', ')}): Stock Fabrica, Depósitos local once, Salón local once, Depósito 2
- Vendedores: Daniel(11977), Daniel 2(11978), Lautaro(3233), Lautaro 2(9265), Susana(12529)

=== HERRAMIENTAS: QUÉ USAR PARA CADA PREGUNTA ===

VENTAS/FACTURACIÓN:
- "cuánto vendimos" / "facturación" / "ventas totales" → consultar_facturacion (trae total + todos los canales en 1 llamada)
- "qué artículos se vendieron más" / "ranking de productos" → consultar_ventas
- "ventas por color y talle" / "curva" / "desglose" → consultar_ventas_detalle
- "qué vendió Lautaro/Daniel" (UN vendedor) → consultar_ventas con su ID
- "ranking de vendedores" / "cómo van los vendedores" / "comparativa" → ranking_vendedores (trae TODOS de una vez)
- "qué compró [cliente]" / "compras de [cliente]" → consultar_comprobantes con nombre del cliente
- "detalle de factura" / "cómo pagó" / "qué productos tiene la factura" → primero consultar_comprobantes para el facturaId, luego ver_factura

STOCK/PRODUCCIÓN:
- "stock de ALGO203" → consultar_stock
- "cuánto fabricar" / "reposición" → calcular_reposicion

FINANZAS:
- "clientes que deben" / "saldos pendientes" → consultar_saldos
- "gastos" / "pagos" / "proveedores" / "compras" → consultar_gastos (trae todo: pagos a proveedores, talleres, facturas de compra)

OTROS:
- "quiénes son los vendedores" → listar_vendedores
- "buscar cliente [nombre]" → buscar_cliente

=== REGLAS ESTRICTAS ===

1. NUNCA inventes datos. Siempre usá las herramientas.
2. Respondé conciso. Datos concretos, no explicaciones.
3. CERO emojis.
4. Formato WhatsApp: *negrita con un solo asterisco*. NUNCA **doble**.
5. Si te corrigen, enseñan algo, o te felicitan: usá guardar_aprendizaje SIEMPRE.
6. Categorías de aprendizaje: correccion (errores tuyos), preferencia (cómo hablar), negocio (reglas), erp (datos técnicos), exito (qué hiciste bien).
7. Cuando reportes ventas o facturación, SIEMPRE mencioná el período.
8. Para facturación por canal: consultar_facturacion (1 sola llamada). NUNCA hagas varias consultas.
9. Para ranking de vendedores: ranking_vendedores (1 sola llamada). NUNCA hagas una consulta por vendedor.
10. SIEMPRE incluí a TODOS los vendedores. Si alguno tiene 0, mostralo igual.
11. Si algo que podés hacer con tus herramientas te lo preguntan, HACELO. Nunca digas "no puedo" si tenés la herramienta.
12. Si NO podés hacer algo, ofrecé enviar solicitud a soporte con solicitar_funcionalidad. NUNCA digas "no puedo" sin ofrecer eso.
13. Si un tool falla, probá otro enfoque. Solo como ÚLTIMO recurso reportá error.
14. Si te saludan sin pregunta (solo "hola"), respondé corto sin usar herramientas.
15. Si el usuario dice algo ambiguo, interpretá lo más probable y consultá. No pidas aclaraciones innecesarias.
16. Si ya consultaste datos y el usuario pregunta algo que podés responder con esos datos, respondé sin volver a consultar.
17. PRIORIDAD DE INFORMACIÓN: Tus herramientas actuales (listadas arriba) SIEMPRE tienen prioridad sobre aprendizajes anteriores. Si un aprendizaje dice "no puedo hacer X" pero tenés una herramienta que lo hace, USALA. Las herramientas se actualizan — los aprendizajes pueden estar desactualizados.
18. NUNCA digas "antes no podía" o "eso no se podía". Si tenés la herramienta, simplemente hacelo.
19. NUNCA expliques limitaciones del ERP ni digas qué módulos existen o no. Si te piden datos, consultá y mostrá lo que hay. Si no hay datos, decí "no hay registros en ese período" y punto. No ofrezcas consultar a soporte salvo que el usuario insista.
20. Cuando un tool devuelve datos, SIEMPRE mostralos. No los analices ni los cuestiones. Tu trabajo es mostrar datos, no opinar sobre ellos.`;
}

function getBusinessRules() {
  const memoryPath = config.kingtex.paths.memory;
  if (!fs.existsSync(memoryPath)) return '';
  try {
    return fs.readFileSync(memoryPath, 'utf-8').substring(0, 2000);
  } catch {
    return '';
  }
}

function buildContext(contactId, userMessage) {
  const parts = [buildSystemPrompt()];

  // Reglas de negocio
  const rules = getBusinessRules();
  if (rules) {
    parts.push(`\n--- Reglas del negocio (archivo) ---\n${rules}`);
  }

  // TODOS los aprendizajes — la memoria permanente del agente
  const allLearnings = store.getLearnings();
  if (allLearnings.length > 0) {
    // Deduplicar y filtrar aprendizajes obsoletos
    const seen = new Set();
    const obsoletePatterns = [
      /no (puedo|puede|tengo|tiene) (acceso|ver|hacer|consultar)/i,
      /no (se puede|es posible|está disponible)/i,
      /falta endpoint/i,
      /no devuelve/i,
      /no trae/i,
      /tool .* no (sirve|funciona|puede)/i,
    ];
    const unique = allLearnings.filter(l => {
      const key = l.content.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      // Filtrar aprendizajes que dicen "no se puede" — las tools actuales mandan
      const isObsolete = obsoletePatterns.some(p => p.test(l.content));
      if (isObsolete) {
        console.log(`[context] Aprendizaje posiblemente obsoleto (ignorado): ${l.content.substring(0, 60)}`);
        return false;
      }
      return true;
    });

    const corrections = unique.filter(l => l.category === 'correccion');
    const preferences = unique.filter(l => l.category === 'preferencia');
    const business = unique.filter(l => l.category === 'negocio');
    const erp = unique.filter(l => l.category === 'erp').filter(l => !l.content.startsWith('Solicitud enviada:'));
    const successes = unique.filter(l => l.category === 'exito');

    if (corrections.length > 0) {
      parts.push(`\n--- ERRORES QUE COMETISTE — NUNCA repetir ---\n${corrections.map(l => `- ${l.content}`).join('\n')}`);
    }
    if (successes.length > 0) {
      parts.push(`\n--- LO QUE HICISTE BIEN — repetir siempre ---\n${successes.map(l => `- ${l.content}`).join('\n')}`);
    }
    if (preferences.length > 0) {
      parts.push(`\n--- PREFERENCIAS DEL USUARIO — respetar siempre ---\n${preferences.map(l => `- ${l.content}`).join('\n')}`);
    }
    if (business.length > 0) {
      parts.push(`\n--- REGLAS DEL NEGOCIO aprendidas ---\n${business.map(l => `- ${l.content}`).join('\n')}`);
    }
    if (erp.length > 0) {
      parts.push(`\n--- NOTAS TÉCNICAS del ERP ---\n${erp.map(l => `- ${l.content}`).join('\n')}`);
    }
  }

  // Knowledge base — fragmentos relevantes
  const knowledgeResults = knowledge.search(userMessage, 3);
  if (knowledgeResults.length > 0) {
    const kbText = knowledgeResults.map(k => `### ${k.title}\n${k.content}`).join('\n\n');
    parts.push(`\n--- Base de conocimiento ---\n${kbText}`);
  }

  // Preferencias del contacto
  const prefs = store.getPreferences(contactId);
  if (Object.keys(prefs).length > 0) {
    parts.push(`\n--- Preferencias de este contacto ---\n${JSON.stringify(prefs)}`);
  }

  const systemPrompt = parts.join('\n');

  // Historial — últimos 15 mensajes para mejor contexto
  const recentMessages = store.getRecentMessages(contactId, 15);
  const messages = recentMessages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  return { systemPrompt, messages };
}

module.exports = { buildContext, buildSystemPrompt };
