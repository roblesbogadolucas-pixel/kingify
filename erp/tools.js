/**
 * Kingify v2.4 — Tools reorganizados
 * SIMPLE: 10 tools para consultas rápidas (Sonnet)
 * ALL: 16 tools para consultas complejas (Opus)
 */
const erp = require('./client');
const cache = require('./cache');

// ============ TOOLS SIMPLES (consultas ERP directas) ============

const TOOLS_SIMPLE = [
  {
    name: 'consultar_erp',
    description: `Consulta el ERP NinoxNet. Tipos disponibles:
- stock: stock de un producto por talle/color/depósito
- ventas: ranking de artículos más vendidos (filtrable por canal/vendedor)
- ventas_detalle: desglose por color y talle (la "curva")
- facturacion: facturación total + desglose por canal (todo en 1)
- comprobantes: facturas con cliente/monto/canal (filtrable por vendedor/cliente)
- ver_factura: detalle de una factura (productos, método de pago)
- ranking_vendedores: TODOS los vendedores con unidades + facturación
- gastos: gastos y pagos registrados
- saldos: clientes con deuda pendiente
- metodos_pago: facturación por método de pago (efectivo/tarjeta/etc)`,
    input_schema: {
      type: 'object',
      properties: {
        tipo: {
          type: 'string',
          enum: ['stock', 'ventas', 'ventas_detalle', 'facturacion', 'comprobantes', 'ver_factura', 'ranking_vendedores', 'gastos', 'saldos', 'metodos_pago'],
          description: 'Tipo de consulta',
        },
        periodo: { type: 'string', description: '"hoy", "ayer", "semana", "mes", o "DD-MM-YYYY,DD-MM-YYYY"' },
        producto: { type: 'string', description: 'Código de producto (para stock, ventas_detalle)' },
        canal: { type: 'string', description: 'Canal: "4" Local, "5" WhatsApp, "9" Online, "8" Fábrica, "11" Henko' },
        vendedor: { type: 'string', description: 'ID vendedor: Daniel=11977, Daniel 2=11978, LAUTARO=3233, LAUTARO 2=9265, SUSANA=12529' },
        cliente: { type: 'string', description: 'Nombre del cliente para filtrar' },
        factura_id: { type: 'string', description: 'ID de factura (para ver_factura)' },
      },
      required: ['tipo'],
    },
  },
  {
    name: 'calcular_reposicion',
    description: 'Análisis de reposición: stock vs velocidad de venta, días de stock, cuánto fabricar.',
    input_schema: {
      type: 'object',
      properties: {
        producto: { type: 'string', description: 'Código del producto (ej: ALGO203)' },
      },
      required: ['producto'],
    },
  },
  {
    name: 'buscar_cliente',
    description: 'Buscar un cliente por nombre.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre o parte del nombre' },
      },
      required: ['nombre'],
    },
  },
  {
    name: 'guardar_aprendizaje',
    description: 'Guarda algo que aprendiste para recordarlo SIEMPRE. Usalo cuando te corrigen, te enseñan algo, o te felicitan.',
    input_schema: {
      type: 'object',
      properties: {
        categoria: { type: 'string', enum: ['preferencia', 'negocio', 'erp', 'correccion', 'exito'], description: 'Tipo de aprendizaje' },
        contenido: { type: 'string', description: 'Qué aprendiste' },
      },
      required: ['categoria', 'contenido'],
    },
  },
];

// ============ TOOLS ADICIONALES (solo para consultas complejas con Opus) ============

const TOOLS_EXTRA = [
  {
    name: 'comparar_anio',
    description: 'Comparativa año a año de un producto: ventas este año vs año anterior.',
    input_schema: {
      type: 'object',
      properties: { producto: { type: 'string', description: 'Código del producto' } },
      required: ['producto'],
    },
  },
  {
    name: 'comparar_facturacion',
    description: 'Comparar facturación entre dos períodos con desglose por método de pago.',
    input_schema: {
      type: 'object',
      properties: {
        periodo1: { type: 'string', description: 'Primer período: "DD-MM-YYYY,DD-MM-YYYY"' },
        periodo2: { type: 'string', description: 'Segundo período: "DD-MM-YYYY,DD-MM-YYYY"' },
      },
      required: ['periodo1', 'periodo2'],
    },
  },
  {
    name: 'ventas_por_etiqueta',
    description: 'Ventas filtradas por etiqueta de producto (ej: "ALGODON PEINADO 24.1", "SET DEPORTIVO").',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: 'Período' },
        etiqueta: { type: 'string', description: 'Nombre de la etiqueta' },
      },
      required: ['periodo', 'etiqueta'],
    },
  },
  {
    name: 'listar_etiquetas',
    description: 'Lista todas las etiquetas/tags de productos disponibles.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'stock_historial',
    description: 'Historial de stock día a día. Detecta días sin stock o con stock bajo.',
    input_schema: {
      type: 'object',
      properties: {
        producto: { type: 'string', description: 'Código del producto' },
        dias: { type: 'number', description: 'Días hacia atrás (default 14, max 30)' },
      },
      required: ['producto'],
    },
  },
  {
    name: 'consultar_cheques',
    description: 'Cheques emitidos/recibidos con monto, banco, proveedor.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'consultar_cortes',
    description: 'Cortes de producción en fábrica con cantidades y estado.',
    input_schema: {
      type: 'object',
      properties: { producto: { type: 'string', description: 'Filtrar por producto (opcional)' } },
    },
  },
  {
    name: 'consultar_talleres',
    description: 'Envíos a talleres: cantidades enviadas vs recibidas, pendientes por taller.',
    input_schema: {
      type: 'object',
      properties: {
        taller: { type: 'string', description: 'Filtrar por taller (opcional)' },
        estado: { type: 'string', description: 'Filtrar por estado (opcional)' },
      },
    },
  },
  {
    name: 'google_sheets',
    description: `Interactuar con Google Sheets. Acciones:
- crear: crear nueva sheet con datos y devolver link
- leer: leer datos de una sheet existente (necesita spreadsheet_id)
- escribir: agregar filas a una sheet existente
SIEMPRE mandá el link al usuario después de crear.`,
    input_schema: {
      type: 'object',
      properties: {
        accion: { type: 'string', enum: ['crear', 'leer', 'escribir'], description: 'Acción a realizar' },
        titulo: { type: 'string', description: 'Título de la sheet nueva (para crear)' },
        spreadsheet_id: { type: 'string', description: 'ID del spreadsheet (para leer/escribir). Extraer de la URL.' },
        rango: { type: 'string', description: 'Rango a leer (para leer). Ej: "Sheet1!A1:D10"' },
        hoja: { type: 'string', description: 'Nombre de la hoja (para escribir)' },
        filas: { type: 'array', description: 'Filas de datos. Primera fila = headers.', items: { type: 'array', items: { type: 'string' } } },
      },
      required: ['accion'],
    },
  },
  {
    name: 'detalle_compra',
    description: 'Detalle de un comprobante de compra (proveedor, monto, medio de pago).',
    input_schema: {
      type: 'object',
      properties: { compra_id: { type: 'string', description: 'ID del comprobante de compra' } },
      required: ['compra_id'],
    },
  },
  {
    name: 'listar_vendedores',
    description: 'Lista vendedores con IDs.',
    input_schema: { type: 'object', properties: {} },
  },
];

const TOOLS_ALL = [...TOOLS_SIMPLE, ...TOOLS_EXTRA];
const TOOLS_COMPLEX = TOOLS_ALL; // alias

// ============ EJECUTORES ============

async function execute(toolName, input, { store }) {
  switch (toolName) {

    // ---- TOOL UNIFICADO DE ERP ----
    case 'consultar_erp': {
      switch (input.tipo) {
        case 'stock': {
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
          const result = { producto: input.producto, descripcion: filtered[0]?.descripcion || input.producto, stockTotal: total, variantes: Object.values(resumen).sort((a, b) => b.cantidad - a.cantidad) };
          cache.set('stock', { producto: input.producto }, result);
          return result;
        }

        case 'ventas': {
          const cacheKey = { periodo: input.periodo, canal: input.canal, vendedor: input.vendedor };
          const cached = cache.get('ventas', cacheKey);
          if (cached) return cached;
          const ventas = await erp.getTopVentas(input.periodo, input.canal, input.vendedor);
          const result = { periodo: input.periodo, canal: input.canal || 'todos', vendedor: input.vendedor || 'todos', totalArticulos: ventas.length, totalUnidades: ventas.reduce((s, v) => s + v.cantidad, 0), top20: ventas.slice(0, 20) };
          cache.set('ventas', cacheKey, result);
          return result;
        }

        case 'ventas_detalle': {
          const cacheKey = { periodo: input.periodo, producto: input.producto, canal: input.canal, vendedor: input.vendedor, tipo: 'detalle' };
          const cached = cache.get('ventas', cacheKey);
          if (cached) return cached;
          const ventas = await erp.getTopVentas(input.periodo, input.canal, input.vendedor, true);
          let filtered = ventas;
          if (input.producto) filtered = ventas.filter(v => v.codigo === input.producto);
          const result = { periodo: input.periodo, producto: input.producto || 'todos', totalVariantes: filtered.length, totalUnidades: filtered.reduce((s, v) => s + v.cantidad, 0), variantes: filtered.slice(0, 50) };
          cache.set('ventas', cacheKey, result);
          return result;
        }

        case 'facturacion': {
          const cached = cache.get('facturacion', { periodo: input.periodo });
          if (cached) return cached;
          const data = await erp.getFacturacionPorCanal(input.periodo);
          cache.set('facturacion', { periodo: input.periodo }, data);
          return data;
        }

        case 'comprobantes': {
          const cacheKey = { periodo: input.periodo, canal: input.canal, vendedor: input.vendedor, cliente: input.cliente };
          const cached = cache.get('comprobantes', cacheKey);
          if (cached) return cached;
          const comprobantes = await erp.getComprobantesVenta(input.periodo, input.canal, input.vendedor, input.cliente);
          const totalMonto = comprobantes.reduce((s, c) => s + c.monto, 0);
          const porCliente = {};
          for (const c of comprobantes) {
            const nombre = c.cliente || 'Sin nombre';
            if (!porCliente[nombre]) porCliente[nombre] = { compras: 0, total: 0 };
            porCliente[nombre].compras++;
            porCliente[nombre].total += c.monto;
          }
          const topClientes = Object.entries(porCliente).sort((a, b) => b[1].total - a[1].total).slice(0, 10).map(([nombre, data]) => ({ nombre, ...data }));
          const result = { periodo: input.periodo, totalComprobantes: comprobantes.length, totalMonto, topClientes, comprobantes: comprobantes.slice(0, 30) };
          cache.set('comprobantes', cacheKey, result);
          return result;
        }

        case 'ver_factura': {
          const cached = cache.get('facturas', { id: input.factura_id });
          if (cached) return cached;
          const detalle = await erp.getDetalleFactura(input.factura_id);
          cache.set('facturas', { id: input.factura_id }, detalle);
          return detalle;
        }

        case 'ranking_vendedores': {
          const cacheKey = { periodo: input.periodo };
          const cached = cache.get('ranking', cacheKey);
          if (cached) return cached;
          const vendedores = [
            { nombre: 'Daniel', id: '11977' }, { nombre: 'Daniel 2', id: '11978' },
            { nombre: 'Lautaro', id: '3233' }, { nombre: 'Lautaro 2', id: '9265' },
            { nombre: 'Susana', id: '12529' },
          ];
          const ranking = [];
          for (const v of vendedores) {
            await new Promise(r => setTimeout(r, 350));
            const ventas = await erp.getTopVentas(input.periodo, null, v.id);
            const totalUnidades = ventas.reduce((s, item) => s + item.cantidad, 0);
            const totalFacturado = ventas.reduce((s, item) => {
              const val = typeof item.totalFacturado === 'string' ? parseFloat(item.totalFacturado.replace(/\./g, '').replace(',', '.')) || 0 : (item.totalFacturado || 0);
              return s + val;
            }, 0);
            ranking.push({ vendedor: v.nombre, id: v.id, unidades: totalUnidades, facturacion: totalFacturado, facturacionStr: '$' + totalFacturado.toLocaleString('es-AR', { maximumFractionDigits: 0 }), top3: ventas.slice(0, 3).map(item => `${item.codigo}(${item.cantidad}u)`) });
          }
          ranking.sort((a, b) => b.facturacion - a.facturacion);
          const result = { periodo: input.periodo, ranking, totalUnidades: ranking.reduce((s, v) => s + v.unidades, 0), totalFacturacion: '$' + ranking.reduce((s, v) => s + v.facturacion, 0).toLocaleString('es-AR', { maximumFractionDigits: 0 }) };
          cache.set('ranking', cacheKey, result);
          return result;
        }

        case 'gastos': {
          const cacheKey = { periodo: input.periodo };
          const cached = cache.get('gastos', cacheKey);
          if (cached) return cached;
          const [compras, gastosOp] = await Promise.all([erp.getGastos(input.periodo), erp.getGastos(input.periodo, 'G')]);
          const byId = new Map();
          for (const g of compras) byId.set(g.id, g);
          for (const g of gastosOp) byId.set(g.id, g);
          const gastos = [...byId.values()];
          const totalMonto = gastos.reduce((s, g) => s + g.monto, 0);
          const porDest = {};
          for (const g of gastos) { const n = g.destinatario || 'Sin nombre'; if (!porDest[n]) porDest[n] = { cantidad: 0, total: 0 }; porDest[n].cantidad++; porDest[n].total += g.monto; }
          const resumen = Object.entries(porDest).sort((a, b) => b[1].total - a[1].total).slice(0, 20).map(([nombre, data]) => ({ nombre, ...data }));
          const result = { periodo: input.periodo, totalGastos: gastos.length, totalMonto, resumen, detalle: gastos.slice(0, 30) };
          cache.set('gastos', cacheKey, result);
          return result;
        }

        case 'saldos': {
          const cached = cache.get('saldos', {});
          if (cached) return cached;
          const data = await erp.getSaldosClientes();
          const deudores = (Array.isArray(data) ? data : []).filter(c => c.Saldo < 0).sort((a, b) => a.Saldo - b.Saldo)
            .map(c => ({ nombre: c.Nombre, saldo: c.Saldo, antiguedad: c.Saldo90Mas ? '90+d' : c.Saldo90 ? '90d' : c.Saldo60 ? '60d' : c.Saldo30 ? '30d' : 'reciente' }));
          const result = { totalDeudores: deudores.length, deudores };
          cache.set('saldos', {}, result);
          return result;
        }

        case 'metodos_pago': {
          const cacheKey = { periodo: input.periodo, tipo: 'metodosPago' };
          const cached = cache.get('facturacion', cacheKey);
          if (cached) return cached;
          const { desde, hasta } = erp.parsePeriodo(input.periodo);
          const periodoStr = `${erp.formatDateSlash(desde)},${erp.formatDateSlash(hasta)}`;
          const data = await erp.rawRequest('/facturacion/GetFacturacionGeneral', { sucursalid: '1', Periodo: periodoStr });
          const metodos = {};
          let totalGeneral = 0;
          for (const v of (data.data?.Ventas || [])) { metodos[v.Nombre] = { total: v.Total, operaciones: v.Cantidad }; totalGeneral += v.Total; }
          const result = { periodo: input.periodo, totalGeneral, metodosPago: metodos };
          cache.set('facturacion', cacheKey, result);
          return result;
        }

        default:
          return { error: `Tipo de consulta no reconocido: ${input.tipo}` };
      }
    }

    // ---- TOOLS INDIVIDUALES ----

    case 'calcular_reposicion':
      return erp.getReposicion(input.producto, input.horizonte, input.lead_time);

    case 'buscar_cliente': {
      const data = await erp.buscarCliente(input.nombre);
      const results = Array.isArray(data) ? data.slice(0, 10) : [];
      return { busqueda: input.nombre, resultados: results.length, clientes: results };
    }

    case 'comparar_anio': {
      const cacheKey = { producto: input.producto, tipo: 'comparativa' };
      const cached = cache.get('ventas', cacheKey);
      if (cached) return cached;
      const result = await erp.getComparativaAnual(input.producto);
      cache.set('ventas', cacheKey, result);
      return result;
    }

    case 'comparar_facturacion':
      return erp.getFacturacionComparativa(input.periodo1, input.periodo2);

    case 'ventas_por_etiqueta': {
      const cacheKey = { periodo: input.periodo, etiqueta: input.etiqueta };
      const cached = cache.get('ventas', cacheKey);
      if (cached) return cached;
      const ventas = await erp.getVentasPorEtiqueta(input.periodo, input.etiqueta);
      const result = { etiqueta: input.etiqueta, periodo: input.periodo, totalProductos: ventas.length, totalUnidades: ventas.reduce((s, v) => s + v.cantidad, 0), productos: ventas.slice(0, 30) };
      cache.set('ventas', cacheKey, result);
      return result;
    }

    case 'listar_etiquetas': {
      const cached = cache.get('canales', { tipo: 'etiquetas' });
      if (cached) return cached;
      const tags = await erp.getTags();
      cache.set('canales', { tipo: 'etiquetas' }, tags);
      return tags;
    }

    case 'stock_historial':
      return erp.getStockHistorial(input.producto, Math.min(input.dias || 14, 30));

    case 'consultar_cheques': {
      const cached = cache.get('cheques', {});
      if (cached) return cached;
      const cheques = await erp.getCheques();
      const porProv = {};
      for (const c of cheques) { const n = c.proveedor || c.beneficiario || 'Sin nombre'; if (!porProv[n]) porProv[n] = { cantidad: 0, total: 0 }; porProv[n].cantidad++; porProv[n].total += c.monto; }
      const resumen = Object.entries(porProv).sort((a, b) => b[1].total - a[1].total).slice(0, 15).map(([nombre, data]) => ({ nombre, ...data }));
      const result = { totalCheques: cheques.length, totalMonto: cheques.reduce((s, c) => s + c.monto, 0), resumen, cheques: cheques.slice(0, 30) };
      cache.set('cheques', {}, result);
      return result;
    }

    case 'consultar_cortes': {
      const cached = cache.get('cortes', { producto: input.producto || '' });
      if (cached) return cached;
      let cortes = await erp.getCortes();
      if (input.producto) cortes = cortes.filter(c => c.producto.toLowerCase().includes(input.producto.toLowerCase()));
      const porEstado = {};
      for (const c of cortes) { const e = c.estado || 'Sin estado'; if (!porEstado[e]) porEstado[e] = { cantidad: 0, cortados: 0, enviados: 0, pendientes: 0 }; porEstado[e].cantidad++; porEstado[e].cortados += c.cortados; porEstado[e].enviados += c.enviados; porEstado[e].pendientes += c.pendientes; }
      const result = { totalCortes: cortes.length, porEstado, cortes: cortes.slice(0, 30) };
      cache.set('cortes', { producto: input.producto || '' }, result);
      return result;
    }

    case 'consultar_talleres': {
      const cached = cache.get('talleres', { taller: input.taller || '', estado: input.estado || '' });
      if (cached) return cached;
      let envios = await erp.getEnviosTalleres();
      if (input.taller) envios = envios.filter(e => e.taller.toLowerCase().includes(input.taller.toLowerCase()));
      if (input.estado) envios = envios.filter(e => e.estado.toUpperCase().includes(input.estado.toUpperCase()));
      const porTaller = {};
      for (const e of envios) { const n = e.taller || 'Sin taller'; if (!porTaller[n]) porTaller[n] = { envios: 0, enviados: 0, recibidos: 0, pendientes: 0 }; porTaller[n].envios++; porTaller[n].enviados += e.cantidadEnviada; porTaller[n].recibidos += e.cantidadRecibida; porTaller[n].pendientes += e.pendiente; }
      const resumenTalleres = Object.entries(porTaller).sort((a, b) => b[1].pendientes - a[1].pendientes).slice(0, 20).map(([nombre, data]) => ({ taller: nombre, ...data }));
      const result = { totalEnvios: envios.length, resumenTalleres, envios: envios.slice(0, 30) };
      cache.set('talleres', { taller: input.taller || '', estado: input.estado || '' }, result);
      return result;
    }

    case 'google_sheets': {
      const sheets = require('./sheets');
      try {
        if (input.accion === 'crear') {
          return await sheets.createAndWrite(input.titulo, input.filas);
        } else if (input.accion === 'leer') {
          return await sheets.readSheet(input.spreadsheet_id, input.rango);
        } else if (input.accion === 'escribir') {
          return await sheets.writeRows(input.spreadsheet_id, input.hoja, input.filas);
        }
        return { error: 'Acción no reconocida: ' + input.accion };
      } catch (err) {
        return { error: err.message };
      }
    }

    case 'detalle_compra': {
      const cached = cache.get('facturas', { id: input.compra_id, tipo: 'compra' });
      if (cached) return cached;
      const detalle = await erp.getDetalleCompra(input.compra_id);
      cache.set('facturas', { id: input.compra_id, tipo: 'compra' }, detalle);
      return detalle;
    }

    case 'listar_vendedores':
      return [{ nombre: 'Daniel', id: '11977' }, { nombre: 'Daniel 2', id: '11978' }, { nombre: 'Lautaro', id: '3233' }, { nombre: 'Lautaro 2', id: '9265' }, { nombre: 'Susana', id: '12529' }];

    case 'guardar_aprendizaje': {
      if (store) {
        const existing = store.getLearnings(input.categoria);
        const isDuplicate = existing.some(l => l.content.toLowerCase().substring(0, 80) === input.contenido.toLowerCase().substring(0, 80));
        if (isDuplicate) return { ok: true, mensaje: 'Ya tengo esto guardado.' };
        store.addLearning(input.categoria, input.contenido);
      }
      return { ok: true, mensaje: `Guardado: ${input.contenido.substring(0, 60)}` };
    }

    default:
      return { error: `Tool no reconocido: ${toolName}` };
  }
}

// NOTA: solicitar_funcionalidad ELIMINADO intencionalmente.
// Claude decía "no puedo, contacto a soporte" cuando SÍ podía.
// Si realmente no puede, que lo diga en texto sin mandar email automático.

module.exports = { TOOLS_SIMPLE, TOOLS_COMPLEX, TOOLS_ALL, execute };
