/**
 * Kingify v2 — Agent (Orquestador Claude)
 * Procesa queries con tools tipados, máximo 3 tool calls TOTAL
 */
const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const { TOOL_DEFINITIONS, execute } = require('./erp/tools');
const { buildContext } = require('./memory/context');
const store = require('./memory/store');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_TOOL_CALLS = config.claude.maxToolCalls; // 3
const MAX_ITERATIONS = 4; // Loop safety cap

async function processQuery(contactId, userMessage) {
  const { systemPrompt, messages: history } = buildContext(contactId, userMessage);
  const messages = [...history, { role: 'user', content: userMessage }];

  const model = config.claude.model;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let toolsUsed = [];
  let totalToolCalls = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // Si ya llegamos al límite de tools, pedirle que responda sin tools
    const useTools = totalToolCalls < MAX_TOOL_CALLS;

    let response;
    try {
      const params = {
        model,
        max_tokens: config.claude.maxTokens,
        system: useTools
          ? systemPrompt
          : systemPrompt + '\n\nIMPORTANTE: Ya usaste todas tus herramientas disponibles para esta consulta. Respondé con la información que ya tenés. NO pidas más herramientas.',
        messages,
      };
      if (useTools) params.tools = TOOL_DEFINITIONS;

      response = await anthropic.messages.create(params);
    } catch (err) {
      if (err.status === 529 || err.message?.includes('overloaded')) {
        console.log('[agent] API sobrecargada, reintentando en 10s...');
        await new Promise(r => setTimeout(r, 10000));
        const params = {
          model,
          max_tokens: config.claude.maxTokens,
          system: systemPrompt,
          messages,
        };
        if (useTools) params.tools = TOOL_DEFINITIONS;
        response = await anthropic.messages.create(params);
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
      return { reply, model, tokensIn: totalTokensIn, tokensOut: totalTokensOut, toolsUsed };
    }

    // Ejecutar tools (máximo hasta llegar al cap)
    messages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    for (const tool of toolBlocks) {
      if (totalToolCalls >= MAX_TOOL_CALLS) {
        // Rechazar tools extra
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: JSON.stringify({ error: 'Límite de herramientas alcanzado. Respondé con lo que ya tenés.' }),
          is_error: true,
        });
        continue;
      }

      console.log(`[agent] Tool ${totalToolCalls + 1}/${MAX_TOOL_CALLS}: ${tool.name}(${JSON.stringify(tool.input).substring(0, 100)})`);
      toolsUsed.push(tool.name);
      totalToolCalls++;

      try {
        const result = await execute(tool.name, tool.input, { store });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: JSON.stringify(result).substring(0, 4000),
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

  return {
    reply: 'No pude completar la consulta. Probá de nuevo con una pregunta más específica.',
    model,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    toolsUsed,
  };
}

module.exports = { processQuery };
