/**
 * Kingify v2 — Tools tipados para Claude
 * Cada tool ejecuta directo en Node.js (no Python)
 */
const erp = require('./client');
const cache = require('./cache');

const TOOL_DEFINITIONS = [
  {
    name: 'consultar_stock',
    description: 'Stock actual de un producto por talle, color y depósito. Trae todas las sucursales (Fábrica + KingTex), excluye materia prima.',
    input_schema: {
      type: 'object',
      properties: {
        producto: { type: 'string', description: 'Código del producto (ej: ALGO203, FRIZ302, SETP400)' },
      },
      required: ['producto'],
    },
  },
  {
    name: 'consultar_ventas',
    description: 'Artículos más vendidos en un período. Ranking por cantidad con facturación. Se puede filtrar por canal y/o vendedor.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: '"hoy", "ayer", "semana", "mes", o "DD-MM-YYYY,DD-MM-YYYY"' },
        canal: { type: 'string', description: 'Canal (opcional): "4" Local, "5" WhatsApp, "9" Tienda Online, "8" Fábrica, "11" Henko' },
        vendedor: { type: 'string', description: 'ID del vendedor (opcional). IDs: Daniel=11977, LAUTARO=3233, LAUTARO 2=9265, SUSANA=12529' },
      },
      required: ['periodo'],
    },
  },
  {
    name: 'consultar_facturacion',
    description: 'Facturación total por período. Devuelve el total Y el desglose por canal (Local, WhatsApp, Tienda Online, Fábrica, Henko) en una sola consulta.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: '"hoy", "ayer", "semana", "mes", o "DD-MM-YYYY,DD-MM-YYYY"' },
      },
      required: ['periodo'],
    },
  },
  {
    name: 'consultar_comprobantes',
    description: 'Comprobantes de venta (facturas, remitos, notas de crédito). Detalle de cada operación con cliente, monto, canal y estado. Filtrá por período, canal, vendedor y/o cliente. Ideal para ver historial de compras de un cliente o ventas de un vendedor.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: '"hoy", "ayer", "semana", "mes", o "DD-MM-YYYY,DD-MM-YYYY"' },
        canal: { type: 'string', description: 'Canal (opcional): "4" Local, "5" WhatsApp, "9" Tienda Online' },
        vendedor: { type: 'string', description: 'ID vendedor (opcional). IDs: Daniel=11977, LAUTARO=3233, LAUTARO 2=9265, SUSANA=12529' },
        cliente: { type: 'string', description: 'Nombre del cliente para filtrar (opcional). Búsqueda parcial, ej: "dario" encuentra "Dario Gomez".' },
      },
      required: ['periodo'],
    },
  },
  {
    name: 'consultar_saldos',
    description: 'Clientes con saldo pendiente (cuenta corriente). Devuelve nombre, saldo total y desglose por antigüedad.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'buscar_cliente',
    description: 'Buscar un cliente por nombre. Devuelve ID, nombre y datos del cliente.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre o parte del nombre del cliente' },
      },
      required: ['nombre'],
    },
  },
  {
    name: 'calcular_reposicion',
    description: 'Análisis de reposición de un producto: stock actual vs velocidad de venta (últimos 90 días), días de stock, cuánto fabricar. Incluye desglose por talle/color.',
    input_schema: {
      type: 'object',
      properties: {
        producto: { type: 'string', description: 'Código del producto (ej: ALGO203)' },
        horizonte: { type: 'number', description: 'Días a cubrir (default: 60)' },
        lead_time: { type: 'number', description: 'Días de fabricación (default: 20)' },
      },
      required: ['producto'],
    },
  },
  {
    name: 'listar_vendedores',
    description: 'Lista todos los vendedores/empleados con su ID. Usar para saber qué vendedor filtrar.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'solicitar_funcionalidad',
    description: 'Cuando David pide algo que no podés hacer con tus herramientas actuales, usá esto para enviar un email a soporte@poolerinc.com solicitando la integración. Después avisale a David que se envió el email y que cuando esté listo le van a avisar.',
    input_schema: {
      type: 'object',
      properties: {
        funcionalidad: { type: 'string', description: 'Qué funcionalidad pidió David (ej: "ver detalle de productos de una factura")' },
        contexto: { type: 'string', description: 'Contexto de la conversación — qué estaba preguntando David y por qué lo necesita' },
      },
      required: ['funcionalidad', 'contexto'],
    },
  },
  {
    name: 'guardar_aprendizaje',
    description: 'Guarda algo que aprendiste para recordarlo siempre. Usalo cuando David te corrija, te enseñe algo del negocio, o te pida cambiar cómo respondés.',
    input_schema: {
      type: 'object',
      properties: {
        categoria: {
          type: 'string',
          enum: ['preferencia', 'negocio', 'erp', 'correccion'],
          description: 'Tipo: preferencia (cómo hablar), negocio (regla), erp (endpoint/formato), correccion (error tuyo)',
        },
        contenido: { type: 'string', description: 'Qué aprendiste' },
      },
      required: ['categoria', 'contenido'],
    },
  },
];

// Ejecutores
async function execute(toolName, input, { store }) {
  switch (toolName) {
    case 'consultar_stock': {
      const cached = cache.get('stock', { producto: input.producto });
      if (cached) return cached;

      const items = await erp.getStock(input.producto);
      const filtered = items.filter(i => i.codigo === input.producto);

      const resumen = {};
      let total = 0;
      for (const item of filtered) {
        const key = `${item.talle}|${item.color}`;
        if (!resumen[key]) resumen[key] = { talle: item.talle, color: item.color, cantidad: 0, depositos: {} };
        resumen[key].cantidad += item.cantidad;
        resumen[key].depositos[item.deposito] = (resumen[key].depositos[item.deposito] || 0) + item.cantidad;
        total += item.cantidad;
      }

      const result = {
        producto: input.producto,
        descripcion: filtered[0]?.descripcion || input.producto,
        stockTotal: total,
        variantes: Object.values(resumen).sort((a, b) => b.cantidad - a.cantidad),
      };

      cache.set('stock', { producto: input.producto }, result);
      return result;
    }

    case 'consultar_ventas': {
      const cacheKey = { periodo: input.periodo, canal: input.canal, vendedor: input.vendedor };
      const cached = cache.get('ventas', cacheKey);
      if (cached) return cached;

      const ventas = await erp.getTopVentas(input.periodo, input.canal, input.vendedor);
      const result = {
        periodo: input.periodo,
        canal: input.canal || 'todos',
        vendedor: input.vendedor || 'todos',
        totalArticulos: ventas.length,
        totalUnidades: ventas.reduce((s, v) => s + v.cantidad, 0),
        top20: ventas.slice(0, 20),
      };

      cache.set('ventas', cacheKey, result);
      return result;
    }

    case 'consultar_facturacion': {
      const cached = cache.get('facturacion', { periodo: input.periodo, tipo: 'porCanal' });
      if (cached) return cached;

      const data = await erp.getFacturacionPorCanal(input.periodo);
      cache.set('facturacion', { periodo: input.periodo, tipo: 'porCanal' }, data);
      return data;
    }

    case 'consultar_comprobantes': {
      const cacheKey = { periodo: input.periodo, canal: input.canal, vendedor: input.vendedor, cliente: input.cliente, tipo: 'comprobantes' };
      const cached = cache.get('ventas', cacheKey);
      if (cached) return cached;

      const comprobantes = await erp.getComprobantesVenta(input.periodo, input.canal, input.vendedor, input.cliente);
      const totalMonto = comprobantes.reduce((s, c) => s + c.monto, 0);

      // Agrupar por cliente para resumen rápido
      const porCliente = {};
      for (const c of comprobantes) {
        const nombre = c.cliente || 'Sin nombre';
        if (!porCliente[nombre]) porCliente[nombre] = { compras: 0, total: 0 };
        porCliente[nombre].compras++;
        porCliente[nombre].total += c.monto;
      }
      const topClientes = Object.entries(porCliente)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 10)
        .map(([nombre, data]) => ({ nombre, ...data }));

      const result = {
        periodo: input.periodo,
        canal: input.canal || 'todos',
        vendedor: input.vendedor || 'todos',
        cliente: input.cliente || 'todos',
        totalComprobantes: comprobantes.length,
        totalMonto,
        topClientes,
        comprobantes: comprobantes.slice(0, 20),
      };

      cache.set('ventas', cacheKey, result);
      return result;
    }

    case 'consultar_saldos': {
      const cached = cache.get('saldos', {});
      if (cached) return cached;

      const data = await erp.getSaldosClientes();
      // Resumir: solo los que deben
      const deudores = (Array.isArray(data) ? data : [])
        .filter(c => c.Saldo < 0)
        .sort((a, b) => a.Saldo - b.Saldo)
        .map(c => ({
          nombre: c.Nombre,
          saldo: c.Saldo,
          antiguedad: c.Saldo90Mas ? '90+ días' : c.Saldo90 ? '90 días' : c.Saldo60 ? '60 días' : c.Saldo30 ? '30 días' : c.Saldo15 ? '15 días' : 'reciente',
        }));

      const result = { totalDeudores: deudores.length, deudores };
      cache.set('saldos', {}, result);
      return result;
    }

    case 'buscar_cliente': {
      const data = await erp.buscarCliente(input.nombre);
      return Array.isArray(data) ? data.slice(0, 10) : data;
    }

    case 'calcular_reposicion': {
      return erp.getReposicion(input.producto, input.horizonte, input.lead_time);
    }

    case 'listar_vendedores': {
      const cached = cache.get('canales', { tipo: 'vendedores' });
      if (cached) return cached;

      const data = await erp.getVendedores();
      cache.set('canales', { tipo: 'vendedores' }, data);
      return data;
    }

    case 'solicitar_funcionalidad': {
      const { sendSolicitud } = require('./email');
      const ok = await sendSolicitud(input.funcionalidad, input.contexto);
      if (store) {
        store.addLearning('erp', `Solicitud enviada: ${input.funcionalidad}`);
      }
      return ok
        ? { ok: true, mensaje: 'Email enviado a soporte@poolerinc.com' }
        : { ok: false, mensaje: 'No se pudo enviar el email, pero la solicitud quedó registrada' };
    }

    case 'guardar_aprendizaje': {
      if (store) {
        store.addLearning(input.categoria, input.contenido);
      }
      return { ok: true, mensaje: `Guardado: ${input.contenido.substring(0, 50)}...` };
    }

    default:
      return { error: `Tool no reconocido: ${toolName}` };
  }
}

module.exports = { TOOL_DEFINITIONS, execute };
