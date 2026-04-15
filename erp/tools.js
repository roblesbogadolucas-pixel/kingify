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
    description: 'Artículos más vendidos en un período. Ranking por cantidad con facturación. Se puede filtrar por canal y/o vendedor. Para ver ventas de UN vendedor específico usá este tool con su ID.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: '"hoy", "ayer", "semana", "mes", o "DD-MM-YYYY,DD-MM-YYYY"' },
        canal: { type: 'string', description: 'Canal (opcional): "4" Local, "5" WhatsApp, "9" Tienda Online, "8" Fábrica, "11" Henko' },
        vendedor: { type: 'string', description: 'ID del vendedor (opcional). IDs: Daniel=11977, Daniel 2=11978, LAUTARO=3233, LAUTARO 2=9265, SUSANA=12529' },
      },
      required: ['periodo'],
    },
  },
  {
    name: 'consultar_ventas_detalle',
    description: 'Desglose de ventas por COLOR y TALLE (la "curva"). Muestra cuántas unidades se vendieron de cada variante (color + talle). Podés filtrar por producto, canal y vendedor.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: '"hoy", "ayer", "semana", "mes", o "DD-MM-YYYY,DD-MM-YYYY"' },
        producto: { type: 'string', description: 'Código del producto para filtrar (opcional, ej: SETP400)' },
        canal: { type: 'string', description: 'Canal (opcional): "4" Local, "5" WhatsApp, "9" Tienda Online' },
        vendedor: { type: 'string', description: 'ID vendedor (opcional)' },
      },
      required: ['periodo'],
    },
  },
  {
    name: 'consultar_facturacion',
    description: 'Facturación total por período. Devuelve el total Y el desglose por canal (Local, WhatsApp, Tienda Online, Fábrica, Henko) TODO en una sola consulta. SIEMPRE usá este tool cuando pregunten "cuánto vendimos", "facturación", "ventas totales".',
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
    description: 'Comprobantes de venta (facturas, remitos). Cada comprobante tiene: fecha, cliente, monto, canal, estado, facturaId. Filtrá por período, canal, vendedor y/o cliente. Para ver las compras de un cliente específico, pasá su nombre.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: '"hoy", "ayer", "semana", "mes", o "DD-MM-YYYY,DD-MM-YYYY"' },
        canal: { type: 'string', description: 'Canal (opcional): "4" Local, "5" WhatsApp, "9" Tienda Online' },
        vendedor: { type: 'string', description: 'ID vendedor (opcional). IDs: Daniel=11977, Daniel 2=11978, LAUTARO=3233, LAUTARO 2=9265, SUSANA=12529' },
        cliente: { type: 'string', description: 'Nombre del cliente para filtrar (opcional). Búsqueda parcial, ej: "dario" encuentra "Dario Gomez".' },
      },
      required: ['periodo'],
    },
  },
  {
    name: 'ver_factura',
    description: 'Detalle completo de una factura: productos comprados (código, color, talle, cantidad, precio), método de pago (efectivo, transferencia, tarjeta), cliente, vendedor. Necesitás el facturaId (viene en consultar_comprobantes).',
    input_schema: {
      type: 'object',
      properties: {
        factura_id: { type: 'string', description: 'ID de la factura (el campo facturaId de consultar_comprobantes)' },
      },
      required: ['factura_id'],
    },
  },
  {
    name: 'ranking_vendedores',
    description: 'Ranking completo de TODOS los vendedores (Daniel, Daniel 2, Lautaro, Lautaro 2, Susana) con unidades vendidas Y facturación. Una sola llamada. SIEMPRE usá este tool cuando pidan ranking, comparativa, o "cómo van los vendedores".',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: '"hoy", "ayer", "semana", "mes", o "DD-MM-YYYY,DD-MM-YYYY"' },
      },
      required: ['periodo'],
    },
  },
  {
    name: 'consultar_gastos',
    description: 'Consulta TODOS los gastos del período: gastos operativos, compras, pagos. Cada registro tiene destinatario, monto y tipo. Llamá a este tool cuando pregunten por gastos de cualquier tipo.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: '"hoy", "ayer", "semana", "mes", o "DD-MM-YYYY,DD-MM-YYYY"' },
      },
      required: ['periodo'],
    },
  },
  {
    name: 'consultar_saldos',
    description: 'Clientes con saldo pendiente (cuenta corriente). Devuelve nombre, saldo y antigüedad de la deuda.',
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
    description: 'Análisis de reposición: stock actual vs velocidad de venta (últimos 90 días), días de stock, cuánto fabricar. Desglose por talle/color.',
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
    name: 'comparar_anio',
    description: 'Comparativa año a año de un producto: ventas del mismo período este año vs año anterior. Muestra unidades, facturación y % de cambio.',
    input_schema: {
      type: 'object',
      properties: {
        producto: { type: 'string', description: 'Código del producto (ej: ALGO203)' },
      },
      required: ['producto'],
    },
  },
  {
    name: 'comparar_facturacion',
    description: 'Comparar facturación entre dos períodos. Incluye desglose por método de pago (efectivo, tarjeta, transferencia, etc). Ideal para comparar meses, trimestres o años.',
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
    name: 'consultar_metodos_pago',
    description: 'Facturación desglosada por método de pago (efectivo, tarjeta, transferencia, cuenta corriente, MercadoPago, cheques). Muestra cuánto se cobró por cada método.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: '"hoy", "ayer", "semana", "mes", o "DD-MM-YYYY,DD-MM-YYYY"' },
      },
      required: ['periodo'],
    },
  },
  {
    name: 'ventas_por_etiqueta',
    description: 'Ventas filtradas por etiqueta/tag de producto. Ejemplo: "ALGODON 24.1", "SET_DEPORTIVO", "BUZO", "CHOMBA". Primero consultá listar_etiquetas para ver las etiquetas disponibles.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: '"hoy", "ayer", "semana", "mes", o "DD-MM-YYYY,DD-MM-YYYY"' },
        etiqueta: { type: 'string', description: 'Nombre de la etiqueta (ej: ALGODON PEINADO 24.1, SET_DEPORTIVO)' },
      },
      required: ['periodo', 'etiqueta'],
    },
  },
  {
    name: 'listar_etiquetas',
    description: 'Lista todas las etiquetas/tags de productos disponibles en el ERP. Usalo para saber qué etiquetas existen antes de filtrar ventas.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'detalle_compra',
    description: 'Detalle de una factura/comprobante de COMPRA (no venta). Muestra proveedor, concepto, monto, medio de pago. Necesitás el ID del comprobante (viene en consultar_gastos como id).',
    input_schema: {
      type: 'object',
      properties: {
        compra_id: { type: 'string', description: 'ID del comprobante de compra' },
      },
      required: ['compra_id'],
    },
  },
  {
    name: 'stock_historial',
    description: 'Historial de stock día a día de un producto. Muestra stock estimado y unidades vendidas cada día. Detecta días sin stock o con stock bajo. Por defecto últimos 14 días.',
    input_schema: {
      type: 'object',
      properties: {
        producto: { type: 'string', description: 'Código del producto (ej: ALGO203)' },
        dias: { type: 'number', description: 'Cantidad de días hacia atrás (default: 14, max: 30)' },
      },
      required: ['producto'],
    },
  },
  {
    name: 'consultar_cheques',
    description: 'Cheques emitidos y recibidos. Muestra monto, banco, proveedor/beneficiario, fechas de emisión y vencimiento.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'consultar_cortes',
    description: 'Cortes de producción en fábrica. Muestra producto, cantidades cortadas, enviadas a talleres y pendientes. Estado de cada corte.',
    input_schema: {
      type: 'object',
      properties: {
        producto: { type: 'string', description: 'Código o nombre del producto para filtrar (opcional)' },
      },
    },
  },
  {
    name: 'consultar_talleres',
    description: 'Envíos a talleres: qué productos se enviaron a qué taller, cantidades enviadas vs recibidas, estado (entregado/pendiente). Ideal para saber cuántos cortes hay en cada taller.',
    input_schema: {
      type: 'object',
      properties: {
        taller: { type: 'string', description: 'Nombre del taller para filtrar (opcional)' },
        estado: { type: 'string', description: 'Estado para filtrar: ENTREGADO, PENDIENTE, etc. (opcional)' },
      },
    },
  },
  {
    name: 'listar_vendedores',
    description: 'Lista todos los vendedores del equipo con su ID.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'crear_google_sheet',
    description: 'Crear una nueva Google Sheet y escribir datos. Ideal para generar reportes. Devuelve el link de la sheet creada. Podés crear una sheet con datos del ERP directamente.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título del spreadsheet (ej: "Ranking Vendedores Abril 2026")' },
        filas: {
          type: 'array',
          description: 'Filas de datos. La primera fila son los headers. Ej: [["Vendedor","Unidades","Facturación"],["Lautaro","4789","$28M"]]',
          items: { type: 'array', items: { type: 'string' } },
        },
      },
      required: ['titulo', 'filas'],
    },
  },
  {
    name: 'leer_google_sheet',
    description: 'Leer datos de una Google Sheet. Necesitás el ID del spreadsheet (está en la URL: docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/). Devuelve las filas y columnas.',
    input_schema: {
      type: 'object',
      properties: {
        spreadsheet_id: { type: 'string', description: 'ID del spreadsheet de Google (de la URL)' },
        rango: { type: 'string', description: 'Rango a leer, ej: "Sheet1" o "Sheet1!A1:D10". Default: toda la primera hoja.' },
      },
      required: ['spreadsheet_id'],
    },
  },
  {
    name: 'escribir_google_sheet',
    description: 'Escribir filas de datos en una Google Sheet. Podés completar una planilla con datos del ERP (stock, ventas, etc.). Pasá las filas como array de arrays.',
    input_schema: {
      type: 'object',
      properties: {
        spreadsheet_id: { type: 'string', description: 'ID del spreadsheet de Google' },
        hoja: { type: 'string', description: 'Nombre de la hoja/tab. Default: Sheet1' },
        filas: {
          type: 'array',
          description: 'Array de filas. Cada fila es un array de valores. Ej: [["Producto","Stock"],["ALGO203",6399]]',
          items: { type: 'array', items: { type: 'string' } },
        },
      },
      required: ['spreadsheet_id', 'filas'],
    },
  },
  {
    name: 'solicitar_funcionalidad',
    description: 'Cuando piden algo que no podés hacer con tus herramientas, usá esto para enviar email a soporte@poolerinc.com. SIEMPRE ofrecé esto antes de decir "no puedo".',
    input_schema: {
      type: 'object',
      properties: {
        funcionalidad: { type: 'string', description: 'Qué funcionalidad pidieron' },
        contexto: { type: 'string', description: 'Contexto de la conversación' },
      },
      required: ['funcionalidad', 'contexto'],
    },
  },
  {
    name: 'guardar_aprendizaje',
    description: 'Guarda algo que aprendiste para recordarlo SIEMPRE en todas las conversaciones futuras. Usalo cuando: te corrigen un dato, te enseñan algo del negocio, te piden cambiar cómo respondés, descubrís algo nuevo del ERP, o te felicitan por algo que hiciste bien (guardá QUÉ hiciste bien para repetirlo).',
    input_schema: {
      type: 'object',
      properties: {
        categoria: {
          type: 'string',
          enum: ['preferencia', 'negocio', 'erp', 'correccion', 'exito'],
          description: 'preferencia=cómo hablar, negocio=regla del negocio, erp=dato técnico, correccion=error que cometiste, exito=algo que hiciste bien y gustó',
        },
        contenido: { type: 'string', description: 'Qué aprendiste. Sé específico y conciso.' },
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

    case 'consultar_ventas_detalle': {
      const cacheKey = { periodo: input.periodo, producto: input.producto, canal: input.canal, vendedor: input.vendedor, tipo: 'detalle' };
      const cached = cache.get('ventas', cacheKey);
      if (cached) return cached;

      const ventas = await erp.getTopVentas(input.periodo, input.canal, input.vendedor, true);
      let filtered = ventas;
      if (input.producto) {
        filtered = ventas.filter(v => v.codigo === input.producto);
      }
      const result = {
        periodo: input.periodo,
        producto: input.producto || 'todos',
        totalVariantes: filtered.length,
        totalUnidades: filtered.reduce((s, v) => s + v.cantidad, 0),
        variantes: filtered.slice(0, 50),
      };

      cache.set('ventas', cacheKey, result);
      return result;
    }

    case 'consultar_facturacion': {
      const cached = cache.get('facturacion', { periodo: input.periodo });
      if (cached) return cached;

      const data = await erp.getFacturacionPorCanal(input.periodo);
      cache.set('facturacion', { periodo: input.periodo }, data);
      return data;
    }

    case 'consultar_comprobantes': {
      const cacheKey = { periodo: input.periodo, canal: input.canal, vendedor: input.vendedor, cliente: input.cliente };
      const cached = cache.get('comprobantes', cacheKey);
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
        comprobantes: comprobantes.slice(0, 30),
      };

      cache.set('comprobantes', cacheKey, result);
      return result;
    }

    case 'consultar_saldos': {
      const cached = cache.get('saldos', {});
      if (cached) return cached;

      const data = await erp.getSaldosClientes();
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
        { nombre: 'Daniel', id: '11977' },
        { nombre: 'Daniel 2', id: '11978' },
        { nombre: 'Lautaro', id: '3233' },
        { nombre: 'Lautaro 2', id: '9265' },
        { nombre: 'Susana', id: '12529' },
      ];

      const ranking = [];
      for (const v of vendedores) {
        await new Promise(r => setTimeout(r, 350));
        const ventas = await erp.getTopVentas(input.periodo, null, v.id);
        const totalUnidades = ventas.reduce((s, item) => s + item.cantidad, 0);
        const totalFacturado = ventas.reduce((s, item) => {
          const val = typeof item.totalFacturado === 'string'
            ? parseFloat(item.totalFacturado.replace(/\./g, '').replace(',', '.')) || 0
            : (item.totalFacturado || 0);
          return s + val;
        }, 0);
        const top3 = ventas.slice(0, 3).map(item => `${item.codigo} (${item.cantidad}u)`);
        ranking.push({
          vendedor: v.nombre,
          id: v.id,
          unidades: totalUnidades,
          facturacion: totalFacturado,
          facturacionStr: '$' + totalFacturado.toLocaleString('es-AR', { maximumFractionDigits: 0 }),
          articulos: ventas.length,
          top3Productos: top3,
        });
      }

      ranking.sort((a, b) => b.facturacion - a.facturacion);
      const result = {
        periodo: input.periodo,
        ranking,
        totalUnidadesEquipo: ranking.reduce((s, v) => s + v.unidades, 0),
        totalFacturacionEquipo: ranking.reduce((s, v) => s + v.facturacion, 0),
        totalFacturacionStr: '$' + ranking.reduce((s, v) => s + v.facturacion, 0).toLocaleString('es-AR', { maximumFractionDigits: 0 }),
      };

      cache.set('ranking', cacheKey, result);
      return result;
    }

    case 'consultar_gastos': {
      const cacheKey = { periodo: input.periodo };
      const cached = cache.get('gastos', cacheKey);
      if (cached) return cached;

      // Traer todo: compras + gastos operativos, deduplicar
      const [compras, gastosOp] = await Promise.all([
        erp.getGastos(input.periodo),
        erp.getGastos(input.periodo, 'G'),
      ]);
      const byId = new Map();
      for (const g of compras) byId.set(g.id, g);
      for (const g of gastosOp) byId.set(g.id, g);
      const gastos = [...byId.values()];
      const totalMonto = gastos.reduce((s, g) => s + g.monto, 0);

      // Agrupar por destinatario
      const porDestinatario = {};
      for (const g of gastos) {
        const nombre = g.destinatario || 'Sin nombre';
        if (!porDestinatario[nombre]) porDestinatario[nombre] = { cantidad: 0, total: 0 };
        porDestinatario[nombre].cantidad++;
        porDestinatario[nombre].total += g.monto;
      }
      const resumen = Object.entries(porDestinatario)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 20)
        .map(([nombre, data]) => ({ nombre, ...data }));

      const result = {
        periodo: input.periodo,
        totalGastos: gastos.length,
        totalMonto,
        resumen,
        detalle: gastos.slice(0, 30),
      };

      cache.set('gastos', cacheKey, result);
      return result;
    }

    case 'buscar_cliente': {
      const data = await erp.buscarCliente(input.nombre);
      const results = Array.isArray(data) ? data.slice(0, 10) : [];
      return {
        busqueda: input.nombre,
        resultados: results.length,
        clientes: results,
        nota: results.length >= 10 ? 'Mostrando primeros 10. Si no encontrás al cliente, probá con un nombre más específico.' : null,
      };
    }

    case 'calcular_reposicion': {
      return erp.getReposicion(input.producto, input.horizonte, input.lead_time);
    }

    case 'comparar_anio': {
      const cacheKey = { producto: input.producto, tipo: 'comparativa' };
      const cached = cache.get('ventas', cacheKey);
      if (cached) return cached;

      const result = await erp.getComparativaAnual(input.producto);
      cache.set('ventas', cacheKey, result);
      return result;
    }

    case 'comparar_facturacion': {
      const result = await erp.getFacturacionComparativa(input.periodo1, input.periodo2);
      return result;
    }

    case 'consultar_metodos_pago': {
      const cacheKey = { periodo: input.periodo, tipo: 'metodosPago' };
      const cached = cache.get('facturacion', cacheKey);
      if (cached) return cached;

      const { desde, hasta } = erp.parsePeriodo(input.periodo);
      const periodoStr = `${erp.formatDateSlash(desde)},${erp.formatDateSlash(hasta)}`;
      const data = await erp.rawRequest('/facturacion/GetFacturacionGeneral', { sucursalid: '1', Periodo: periodoStr });

      const metodos = {};
      let totalGeneral = 0;
      for (const v of (data.data?.Ventas || [])) {
        metodos[v.Nombre] = { total: v.Total, operaciones: v.Cantidad };
        totalGeneral += v.Total;
      }

      const result = {
        periodo: input.periodo,
        totalGeneral,
        metodosPago: metodos,
      };
      cache.set('facturacion', cacheKey, result);
      return result;
    }

    case 'ventas_por_etiqueta': {
      const cacheKey = { periodo: input.periodo, etiqueta: input.etiqueta };
      const cached = cache.get('ventas', cacheKey);
      if (cached) return cached;

      const ventas = await erp.getVentasPorEtiqueta(input.periodo, input.etiqueta);
      const totalUnidades = ventas.reduce((s, v) => s + v.cantidad, 0);
      const totalFacturado = ventas.reduce((s, v) => s + v.totalFacturado, 0);
      const result = {
        etiqueta: input.etiqueta,
        periodo: input.periodo,
        totalProductos: ventas.length,
        totalUnidades,
        totalFacturado,
        productos: ventas.slice(0, 30),
      };
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

    case 'detalle_compra': {
      const cached = cache.get('facturas', { id: input.compra_id, tipo: 'compra' });
      if (cached) return cached;

      const detalle = await erp.getDetalleCompra(input.compra_id);
      cache.set('facturas', { id: input.compra_id, tipo: 'compra' }, detalle);
      return detalle;
    }

    case 'stock_historial': {
      const dias = Math.min(input.dias || 14, 30);
      const result = await erp.getStockHistorial(input.producto, dias);
      return result;
    }

    case 'consultar_cheques': {
      const cached = cache.get('cheques', {});
      if (cached) return cached;

      const cheques = await erp.getCheques();
      const totalMonto = cheques.reduce((s, c) => s + c.monto, 0);

      // Agrupar por proveedor
      const porProv = {};
      for (const c of cheques) {
        const nombre = c.proveedor || c.beneficiario || 'Sin nombre';
        if (!porProv[nombre]) porProv[nombre] = { cantidad: 0, total: 0 };
        porProv[nombre].cantidad++;
        porProv[nombre].total += c.monto;
      }
      const resumen = Object.entries(porProv)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 15)
        .map(([nombre, data]) => ({ nombre, ...data }));

      const result = { totalCheques: cheques.length, totalMonto, resumen, cheques: cheques.slice(0, 30) };
      cache.set('cheques', {}, result);
      return result;
    }

    case 'consultar_cortes': {
      const cached = cache.get('cortes', { producto: input.producto || '' });
      if (cached) return cached;

      let cortes = await erp.getCortes();
      if (input.producto) {
        const term = input.producto.toLowerCase();
        cortes = cortes.filter(c => c.producto.toLowerCase().includes(term));
      }

      // Agrupar por estado
      const porEstado = {};
      for (const c of cortes) {
        const est = c.estado || 'Sin estado';
        if (!porEstado[est]) porEstado[est] = { cantidad: 0, totalCortados: 0, totalEnviados: 0, totalPendientes: 0 };
        porEstado[est].cantidad++;
        porEstado[est].totalCortados += c.cortados;
        porEstado[est].totalEnviados += c.enviados;
        porEstado[est].totalPendientes += c.pendientes;
      }

      const result = {
        totalCortes: cortes.length,
        porEstado,
        cortes: cortes.slice(0, 30),
      };
      cache.set('cortes', { producto: input.producto || '' }, result);
      return result;
    }

    case 'consultar_talleres': {
      const cached = cache.get('talleres', { taller: input.taller || '', estado: input.estado || '' });
      if (cached) return cached;

      let envios = await erp.getEnviosTalleres();
      if (input.taller) {
        const term = input.taller.toLowerCase();
        envios = envios.filter(e => e.taller.toLowerCase().includes(term));
      }
      if (input.estado) {
        const term = input.estado.toUpperCase();
        envios = envios.filter(e => e.estado.toUpperCase().includes(term));
      }

      // Agrupar por taller
      const porTaller = {};
      for (const e of envios) {
        const nombre = e.taller || 'Sin taller';
        if (!porTaller[nombre]) porTaller[nombre] = { envios: 0, enviados: 0, recibidos: 0, pendientes: 0 };
        porTaller[nombre].envios++;
        porTaller[nombre].enviados += e.cantidadEnviada;
        porTaller[nombre].recibidos += e.cantidadRecibida;
        porTaller[nombre].pendientes += e.pendiente;
      }
      const resumenTalleres = Object.entries(porTaller)
        .sort((a, b) => b[1].pendientes - a[1].pendientes)
        .slice(0, 20)
        .map(([nombre, data]) => ({ taller: nombre, ...data }));

      const result = {
        totalEnvios: envios.length,
        resumenTalleres,
        envios: envios.slice(0, 30),
      };
      cache.set('talleres', { taller: input.taller || '', estado: input.estado || '' }, result);
      return result;
    }

    case 'listar_vendedores': {
      return [
        { nombre: 'Daniel', id: '11977' },
        { nombre: 'Daniel 2', id: '11978' },
        { nombre: 'Lautaro', id: '3233' },
        { nombre: 'Lautaro 2', id: '9265' },
        { nombre: 'Susana', id: '12529' },
      ];
    }

    case 'crear_google_sheet': {
      const sheets = require('./sheets');
      try {
        const created = await sheets.createSheet(input.titulo);
        // Extraer datos de tool_response (viaSocket MCP wrappea la respuesta)
        const resp = created.tool_response?.[0] || created;
        const spreadsheetId = resp.spreadsheetId || created.spreadsheetId || '';
        const url = resp.spreadsheetUrl || created.spreadsheetUrl || (spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` : '');

        // Escribir datos si hay filas
        if (input.filas && input.filas.length > 0 && spreadsheetId) {
          await sheets.writeRows(spreadsheetId, 'Sheet1', input.filas);
        }

        return {
          ok: true,
          titulo: input.titulo,
          url: url,
          spreadsheetId: spreadsheetId,
          filas: input.filas ? input.filas.length : 0,
        };
      } catch (err) {
        return { error: 'No pude crear la sheet: ' + err.message };
      }
    }

    case 'leer_google_sheet': {
      const sheets = require('./sheets');
      try {
        const data = await sheets.readSheet(input.spreadsheet_id, input.rango);
        return data;
      } catch (err) {
        return { error: 'No pude leer la sheet: ' + err.message };
      }
    }

    case 'escribir_google_sheet': {
      const sheets = require('./sheets');
      try {
        const result = await sheets.writeRows(input.spreadsheet_id, input.hoja, input.filas);
        return { ok: true, ...result };
      } catch (err) {
        return { error: 'No pude escribir en la sheet: ' + err.message };
      }
    }

    case 'solicitar_funcionalidad': {
      const { sendSolicitud } = require('./email');
      const ok = await sendSolicitud(input.funcionalidad, input.contexto);
      if (store) {
        store.addLearning('erp', `Solicitud enviada: ${input.funcionalidad}`);
      }
      return ok
        ? { ok: true, mensaje: 'Email enviado a soporte@poolerinc.com. Le van a avisar cuando esté listo.' }
        : { ok: false, mensaje: 'No se pudo enviar el email pero la solicitud quedó registrada en el sistema.' };
    }

    case 'guardar_aprendizaje': {
      if (store) {
        // Deduplicar: no guardar si ya existe uno muy parecido
        const existing = store.getLearnings(input.categoria);
        const isDuplicate = existing.some(l =>
          l.content.toLowerCase().substring(0, 80) === input.contenido.toLowerCase().substring(0, 80)
        );
        if (isDuplicate) {
          return { ok: true, mensaje: 'Ya tengo esto guardado.' };
        }
        store.addLearning(input.categoria, input.contenido);
      }
      return { ok: true, mensaje: `Guardado: ${input.contenido.substring(0, 60)}...` };
    }

    default:
      return { error: `Tool no reconocido: ${toolName}` };
  }
}

module.exports = { TOOL_DEFINITIONS, execute };
