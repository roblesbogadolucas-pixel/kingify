/**
 * Kingify v2 — Router local (clasificación sin IA)
 * Resuelve saludos, agradecimientos y meta-preguntas sin gastar tokens
 */

const PATTERNS = {
  greeting: /^(hola|buenas?|hey|buen ?d[ií]a|buenas? tardes?|buenas? noches?|qu[eé] tal|c[oó]mo and[aá]s|qu[eé] onda|epa|wena|holis|holaa+)\b/i,
  thanks: /^(gracias|grax|genial|perfecto|dale[,.]?$|ok[,!.]?$|buen[ií]simo|joya|excelente|b[aá]rbaro|10 puntos|de una)\b/i,
  farewell: /^(chau|nos vemos|hasta luego|hasta ma[nñ]ana|bye|adi[oó]s|suerte|buenas noches)\b/i,
  meta: /^(qu[eé] pod[eé]s hacer|ayuda|help|funciones|c[oó]mo funcion[aá]s|para qu[eé] serv[ií]s)/i,
};

const RESPONSES = {
  greeting: [
    'Hola! Qué necesitás?',
    'Buenas! En qué te ayudo?',
    'Hola, decime qué precisás.',
  ],
  thanks: [
    'De nada!',
    'A disposición.',
    'Dale, cualquier cosa avisá.',
  ],
  farewell: [
    'Nos vemos!',
    'Chau, cualquier cosa avisá.',
    'Hasta luego!',
  ],
  meta: [
    `Puedo ayudarte con:\n\n` +
    `*Stock* — "stock de ALGO203"\n` +
    `*Ventas* — "cuánto vendimos hoy"\n` +
    `*Facturación* — "facturación de la semana"\n` +
    `*Reposición* — "cuánto fabricar de ALGO203"\n` +
    `*Saldos* — "clientes con saldo pendiente"\n\n` +
    `Preguntame lo que necesites del ERP.`,
  ],
};

function classify(text) {
  const clean = text.trim();

  // Si el mensaje es largo (>30 chars), probablemente tiene una pregunta real
  // aunque empiece con "perfecto" o "hola"
  // Excepciones: meta siempre se evalúa (son frases largas)
  const isShort = clean.length <= 15;

  for (const [type, pattern] of Object.entries(PATTERNS)) {
    if (type === 'meta' && pattern.test(clean)) return type;
    if (isShort && pattern.test(clean)) return type;
  }
  return 'query';
}

function getResponse(type) {
  const options = RESPONSES[type];
  if (!options) return null;
  return options[Math.floor(Math.random() * options.length)];
}

module.exports = { classify, getResponse };
