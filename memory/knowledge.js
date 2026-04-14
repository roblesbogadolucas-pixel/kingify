/**
 * Kingify v2 — Knowledge Base Search
 * Divide ninox_knowledge.md en chunks y busca por keywords
 */
const fs = require('fs');
const config = require('../config');

let chunks = [];

function init() {
  const knowledgePath = config.kingtex.paths.knowledge;
  if (!fs.existsSync(knowledgePath)) {
    console.log('[knowledge] Archivo no encontrado:', knowledgePath);
    return;
  }

  const content = fs.readFileSync(knowledgePath, 'utf-8');

  // Dividir por headers (## o #) — cada sección es un chunk
  const sections = content.split(/^(?=#{1,2} )/m);

  chunks = sections
    .filter(s => s.trim().length > 50)
    .map((text, i) => {
      const firstLine = text.split('\n')[0].replace(/^#+\s*/, '').trim();
      const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const uniqueWords = [...new Set(words)];

      return {
        id: i,
        title: firstLine || `Sección ${i + 1}`,
        text: text.trim(),
        keywords: uniqueWords,
      };
    });

  console.log(`[knowledge] ${chunks.length} chunks indexados (${Math.round(content.length / 1024)}KB)`);
}

function search(query, maxResults = 3) {
  if (chunks.length === 0) return [];

  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (queryWords.length === 0) return [];

  return chunks
    .map(chunk => {
      let score = 0;
      for (const word of queryWords) {
        if (chunk.keywords.some(k => k.includes(word) || word.includes(k))) {
          score++;
        }
        // Bonus si aparece en el título
        if (chunk.title.toLowerCase().includes(word)) {
          score += 2;
        }
      }
      return { ...chunk, score };
    })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(c => ({
      title: c.title,
      content: c.text.substring(0, 500),
    }));
}

function getChunkCount() {
  return chunks.length;
}

module.exports = { init, search, getChunkCount };
