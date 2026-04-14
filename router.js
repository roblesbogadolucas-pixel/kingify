/**
 * Kingify v2 — Router local (clasificación sin IA)
 * Resuelve saludos, agradecimientos y meta-preguntas sin gastar tokens
 * SOLO clasifica si el mensaje es PURAMENTE un saludo/gracias — si tiene contenido extra, va a Claude
 */

const PATTERNS = {
  greeting: /^(hola|buenas?|hey|buen ?d[ií]a|buenas? tardes?|buenas? noches?|qu[eé] tal|c[oó]mo and[aá]s|qu[eé] onda|epa|wena|holis|holaa+)[!?.,]*$/i,
  thanks: /^(gracias|grax|genial|perfecto|dale|ok|buen[ií]simo|joya|excelente|b[aá]rbaro|10 puntos|de una|copado|buenísimo)[!?.,]*$/i,
  farewell: /^(chau|nos vemos|hasta luego|hasta ma[nñ]ana|bye|adi[oó]s|suerte|buenas noches)[!?.,]*$/i,
  meta: /^(qu[eé] pod[eé]s hacer|ayuda|help|funciones|c[oó]mo funcion[aá]s|para qu[eé] serv[ií]s)[?!.,]*$/i,
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
    `*Ranking vendedores* — "ranking de vendedores del mes"\n` +
    `*Reposición* — "cuánto fabricar de ALGO203"\n` +
    `*Gastos* — "gastos del mes"\n` +
    `*Saldos* — "clientes con saldo pendiente"\n` +
    `*Detalle factura* — "qué compró [cliente]"\n\n` +
    `Preguntame lo que necesites del ERP.`,
  ],
};

function classify(text) {
  const clean = text.trim();

  // Solo clasificar como template si el mensaje COMPLETO matchea el pattern
  // Esto evita que "perfecto, cuánto vendimos?" se clasifique como thanks
  for (const [type, pattern] of Object.entries(PATTERNS)) {
    if (pattern.test(clean)) return type;
  }
  return 'query';
}

function getResponse(type) {
  const options = RESPONSES[type];
  if (!options) return null;
  return options[Math.floor(Math.random() * options.length)];
}

module.exports = { classify, getResponse };
