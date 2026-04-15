/**
 * Kingify v2 — Agent (Orquestador Claude)
 * Tool loop robusto, timeouts, memoria automática
 */
const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const { TOOL_DEFINITIONS, execute } = require('./erp/tools');
const { buildContext } = require('./memory/context');
const store = require('./memory/store');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_TOOL_CALLS = 12;
const MAX_ITERATIONS = 8;
const TOOL_TIMEOUT_MS = 30_000;

// Ejecutar tool con timeout
async function executeWithTimeout(toolName, input, deps) {
  return Promise.race([
    execute(toolName, input, deps),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${toolName} tardó más de 30s`)), TOOL_TIMEOUT_MS)
    ),
  ]);
}

async function processQuery(contactId, userMessage, imageBuffer) {
  const { systemPrompt, messages: history } = buildContext(contactId, userMessage);

  // Construir el mensaje del usuario — con o sin imagen
  let userContent;
  if (imageBuffer) {
    const base64 = imageBuffer.toString('base64');
    const mediaType = 'image/jpeg'; // WhatsApp siempre manda JPEG
    userContent = [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: userMessage || 'Qué ves en esta imagen?' },
    ];
  } else {
    userContent = userMessage;
  }

  const messages = [...history, { role: 'user', content: userContent }];

  const model = config.claude.model;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let toolsUsed = [];
  let totalToolCalls = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const useTools = totalToolCalls < MAX_TOOL_CALLS;

    let response;
    const params = {
      model,
      max_tokens: 2048,
      system: useTools
        ? systemPrompt
        : systemPrompt + '\n\nYa usaste el máximo de herramientas. Respondé AHORA con TODA la información que recopilaste. Armá la mejor respuesta posible.',
      messages,
    };
    if (useTools) params.tools = TOOL_DEFINITIONS;

    try {
      response = await anthropic.messages.create(params);
    } catch (err) {
      if (err.status === 529 || err.message?.includes('overloaded')) {
        console.log('[agent] API sobrecargada, reintentando en 10s...');
        await new Promise(r => setTimeout(r, 10000));
        try {
          response = await anthropic.messages.create(params);
        } catch (err2) {
          throw err2;
        }
      } else {
        throw err;
      }
    }

    totalTokensIn += response.usage?.input_tokens || 0;
    totalTokensOut += response.usage?.output_tokens || 0;

    const toolBlocks = response.content.filter(b => b.type === 'tool_use');

    // Si no hay tool use, terminamos
    if (toolBlocks.length === 0) {
      const reply = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      // Auto-detectar si Claude aprendió algo de la conversación
      autoLearn(contactId, userMessage, reply);
      return { reply, model, tokensIn: totalTokensIn, tokensOut: totalTokensOut, toolsUsed };
    }

    // Ejecutar tools
    messages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    for (const tool of toolBlocks) {
      if (totalToolCalls >= MAX_TOOL_CALLS) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: 'Límite de herramientas alcanzado. Respondé con la información que ya tenés.',
          is_error: true,
        });
        continue;
      }

      console.log(`[agent] Tool ${totalToolCalls + 1}/${MAX_TOOL_CALLS}: ${tool.name}(${JSON.stringify(tool.input).substring(0, 120)})`);
      toolsUsed.push(tool.name);
      totalToolCalls++;

      try {
        const result = await executeWithTimeout(tool.name, tool.input, { store });
        const resultStr = JSON.stringify(result);
        // Si el resultado es muy grande, avisar a Claude que fue truncado
        if (resultStr.length > 10000) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: resultStr.substring(0, 10000) + '\n\n[NOTA: resultado truncado por tamaño, puede haber más datos]',
          });
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: resultStr,
          });
        }
      } catch (err) {
        console.error(`[agent] Tool error: ${tool.name}:`, err.message);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: JSON.stringify({
            error: err.message,
            sugerencia: 'Probá con otro enfoque o herramienta. NO digas que no podés — intentá resolver de otra forma.',
          }),
          is_error: true,
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  // Fallback: forzar respuesta final
  messages.push({
    role: 'user',
    content: 'Respondé ahora con toda la información disponible. No pidas más herramientas.',
  });
  try {
    const finalResponse = await anthropic.messages.create({
      model,
      max_tokens: 2048,
      system: systemPrompt + '\n\nDEBÉS responder ahora. Usá toda la información de las herramientas anteriores.',
      messages,
    });
    totalTokensIn += finalResponse.usage?.input_tokens || 0;
    totalTokensOut += finalResponse.usage?.output_tokens || 0;
    const reply = finalResponse.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    return { reply, model, tokensIn: totalTokensIn, tokensOut: totalTokensOut, toolsUsed };
  } catch {
    return {
      reply: 'Tuve un problema procesando la consulta. Probá de nuevo.',
      model,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      toolsUsed,
    };
  }
}

// Auto-aprendizaje: detectar correcciones y preferencias del usuario
function autoLearn(contactId, userMessage, reply) {
  const msg = userMessage.toLowerCase();

  // Detectar correcciones explícitas
  const correctionPatterns = [
    /no[,.]?\s*(eso|ese|esa)\s*(no|está mal|es incorrecto)/i,
    /está(s)?\s*mal/i,
    /no es así/i,
    /te equivocas/i,
    /eso no es/i,
    /mal[,.]?\s*(el|la|los|las|ese|esa)/i,
    /corregí/i,
    /error/i,
  ];

  for (const pattern of correctionPatterns) {
    if (pattern.test(msg)) {
      console.log(`[agent] Auto-learn: posible corrección detectada: "${userMessage.substring(0, 60)}"`);
      // No guardamos automáticamente — Claude lo hará si reconoce la corrección via guardar_aprendizaje
      break;
    }
  }
}

module.exports = { processQuery };
