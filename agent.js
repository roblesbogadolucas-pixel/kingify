/**
 * Kingify v2.4 — Agent con router Opus/Sonnet
 * - Consultas simples → Sonnet (~$0.01)
 * - Consultas complejas (sheets, comparativas, análisis) → Opus (~$0.05)
 * - Tools reducidos y agrupados por categoría
 */
const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const { TOOLS_SIMPLE, TOOLS_COMPLEX, TOOLS_ALL, execute } = require('./erp/tools');
const { buildContext } = require('./memory/context');
const store = require('./memory/store');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL_SIMPLE = 'claude-sonnet-4-6';
const MODEL_COMPLEX = 'claude-opus-4-6';

const MAX_TOOL_CALLS = 12;
const MAX_ITERATIONS = 8;
const TOOL_TIMEOUT_MS = 30_000;
const SLOW_TOOLS = ['crear_google_sheet', 'escribir_google_sheet', 'leer_google_sheet', 'ranking_vendedores', 'stock_historial', 'consultar_cortes', 'consultar_talleres'];
const SLOW_TIMEOUT_MS = 90_000;

// Clasificar complejidad del mensaje
function classifyComplexity(message) {
  const msg = message.toLowerCase();

  // COMPLEX: sheets, comparativas, análisis, reportes, múltiples datos
  const complexPatterns = [
    /sheet/i, /planilla/i, /google/i, /excel/i, /spreadsheet/i,
    /compar[aá]/i, /vs\b/i, /año pasado/i, /año anterior/i, /crecimiento/i,
    /reporte completo/i, /reporte general/i, /resumen (del|de la|completo)/i,
    /analiz[aá]/i, /analis/i, /tendencia/i, /proyecci[oó]n/i, /estim[aá]/i,
    /imagen/i, /foto/i, /captura/i,
    /historial/i, /día a día/i, /días sin stock/i,
    /etiqueta/i, /tag/i,
    /cheque/i, /corte/i, /taller/i, /fábrica/i, /producción/i,
  ];

  for (const p of complexPatterns) {
    if (p.test(msg)) return 'complex';
  }

  // Si el mensaje es largo (>100 chars) probablemente es complejo
  if (msg.length > 100) return 'complex';

  return 'simple';
}

async function executeWithTimeout(toolName, input, deps) {
  const timeout = SLOW_TOOLS.includes(toolName) ? SLOW_TIMEOUT_MS : TOOL_TIMEOUT_MS;
  return Promise.race([
    execute(toolName, input, deps),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${toolName} tardó más de ${timeout / 1000}s`)), timeout)
    ),
  ]);
}

async function processQuery(contactId, userMessage, imageBuffer) {
  const { systemPrompt, messages: history } = buildContext(contactId, userMessage);

  // Construir mensaje del usuario
  let userContent;
  if (imageBuffer) {
    const base64 = imageBuffer.toString('base64');
    userContent = [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
      { type: 'text', text: userMessage || 'Qué ves en esta imagen?' },
    ];
  } else {
    userContent = userMessage;
  }

  const messages = [...history, { role: 'user', content: userContent }];

  // Router: elegir modelo y tools según complejidad
  const complexity = imageBuffer ? 'complex' : classifyComplexity(userMessage);
  const model = complexity === 'complex' ? MODEL_COMPLEX : MODEL_SIMPLE;
  const tools = complexity === 'complex' ? TOOLS_ALL : TOOLS_SIMPLE;

  console.log(`[agent] ${complexity} → ${model === MODEL_COMPLEX ? 'Opus' : 'Sonnet'} | ${tools.length} tools`);

  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let toolsUsed = [];
  let totalToolCalls = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const useTools = totalToolCalls < MAX_TOOL_CALLS;

    const params = {
      model,
      max_tokens: 2048,
      system: useTools
        ? systemPrompt
        : systemPrompt + '\n\nYa usaste el máximo de herramientas. Respondé AHORA con TODA la información que recopilaste.',
      messages,
    };
    if (useTools) params.tools = tools;

    let response;
    try {
      response = await anthropic.messages.create(params);
    } catch (err) {
      if (err.status === 529 || err.message?.includes('overloaded')) {
        console.log('[agent] API sobrecargada, reintentando en 10s...');
        await new Promise(r => setTimeout(r, 10000));
        try { response = await anthropic.messages.create(params); }
        catch (err2) { throw err2; }
      } else {
        throw err;
      }
    }

    totalTokensIn += response.usage?.input_tokens || 0;
    totalTokensOut += response.usage?.output_tokens || 0;

    const toolBlocks = response.content.filter(b => b.type === 'tool_use');

    if (toolBlocks.length === 0) {
      const reply = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      return { reply, model, tokensIn: totalTokensIn, tokensOut: totalTokensOut, toolsUsed };
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    for (const tool of toolBlocks) {
      if (totalToolCalls >= MAX_TOOL_CALLS) {
        toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: 'Límite alcanzado. Respondé con lo que tenés.', is_error: true });
        continue;
      }

      console.log(`[agent] Tool ${totalToolCalls + 1}/${MAX_TOOL_CALLS}: ${tool.name}(${JSON.stringify(tool.input).substring(0, 120)})`);
      toolsUsed.push(tool.name);
      totalToolCalls++;

      try {
        const result = await executeWithTimeout(tool.name, tool.input, { store });
        const resultStr = JSON.stringify(result);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: resultStr.length > 10000 ? resultStr.substring(0, 10000) + '\n[truncado]' : resultStr,
        });
      } catch (err) {
        console.error(`[agent] Tool error: ${tool.name}:`, err.message);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: JSON.stringify({ error: err.message }),
          is_error: true,
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  // Fallback
  messages.push({ role: 'user', content: 'Respondé ahora con toda la información disponible.' });
  try {
    const finalResponse = await anthropic.messages.create({
      model, max_tokens: 2048,
      system: systemPrompt + '\n\nDEBÉS responder ahora con la información disponible.',
      messages,
    });
    totalTokensIn += finalResponse.usage?.input_tokens || 0;
    totalTokensOut += finalResponse.usage?.output_tokens || 0;
    const reply = finalResponse.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    return { reply, model, tokensIn: totalTokensIn, tokensOut: totalTokensOut, toolsUsed };
  } catch {
    return { reply: 'Tuve un problema. Probá de nuevo.', model, tokensIn: totalTokensIn, tokensOut: totalTokensOut, toolsUsed };
  }
}

module.exports = { processQuery };
