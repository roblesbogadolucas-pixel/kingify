/**
 * Kingify v2 — ERP Client (NinoxNet)
 * Singleton con auto-relogin y manejo de sesión
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');
const config = require('../config');

const EXCLUIR_DEPOSITOS = config.kingtex.business.deposExcluir;

let sessionCookies = null;
let lastLogin = 0;

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Content-Type': 'application/x-www-form-urlencoded',
        ...options.headers,
      },
    };

    if (sessionCookies) {
      reqOpts.headers['Cookie'] = sessionCookies;
    }

    const req = lib.request(reqOpts, (res) => {
      const setCookies = res.headers['set-cookie'];
      if (setCookies) {
        const newCookies = setCookies.map(c => c.split(';')[0]).join('; ');
        sessionCookies = sessionCookies ? sessionCookies + '; ' + newCookies : newCookies;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : `${config.kingtex.erp.baseUrl}${res.headers.location}`;
          return resolve(request(redirectUrl));
        }
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });

    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function login() {
  const { baseUrl, user, password, sessionTTL } = config.kingtex.erp;
  if (Date.now() - lastLogin < sessionTTL && sessionCookies) return true;

  sessionCookies = null;
  const body = `UserName=${encodeURIComponent(user)}&Password=${encodeURIComponent(password)}&RememberMe=true`;

  const res = await request(`${baseUrl}/Account/Login`, { method: 'POST', body });
  lastLogin = Date.now();
  return !res.data.includes('Iniciar sesi');
}

// Construir query string SIN encodear brackets (ASP.NET DataTables los necesita literales)
function buildQueryString(params) {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

async function apiGet(path, params = {}) {
  const { baseUrl } = config.kingtex.erp;
  await login();
  const qs = Object.keys(params).length > 0 ? '?' + buildQueryString(params) : '';
  const fullUrl = `${baseUrl}${path}${qs}`;
  const res = await request(fullUrl);

  try {
    return JSON.parse(res.data);
  } catch {
    sessionCookies = null;
    lastLogin = 0;
    await login();
    const res2 = await request(fullUrl);
    return JSON.parse(res2.data);
  }
}

// --- Helpers de fecha ---

function formatDate(d) {
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function formatDateSlash(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function parsePeriodo(periodo) {
  const hoy = new Date();
  const ayer = new Date(hoy - 86400000);
  const hace7 = new Date(hoy - 7 * 86400000);
  const primeroDeMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

  switch (periodo) {
    case 'hoy': return { desde: hoy, hasta: hoy };
    case 'ayer': return { desde: ayer, hasta: ayer };
    case 'semana': return { desde: hace7, hasta: hoy };
    case 'mes': return { desde: primeroDeMes, hasta: hoy };
    default: {
      // DD-MM-YYYY,DD-MM-YYYY
      const parts = periodo.split(',');
      if (parts.length === 2) {
        const parse = (s) => {
          const [d, m, y] = s.trim().split(/[-/]/);
          return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
        };
        return { desde: parse(parts[0]), hasta: parse(parts[1]) };
      }
      return { desde: hoy, hasta: hoy };
    }
  }
}

// --- Funciones públicas ---

async function getStock(search) {
  const filtro = JSON.stringify({ sucursal: 'all' });
  const data = await apiGet('/Stk/jsGetPagedStock', {
    draw: '1', start: '0', length: '5000',
    'search[value]': search, 'search[regex]': 'false',
    filtro,
  });

  const items = [];
  for (const row of (data.data || [])) {
    if (!Array.isArray(row) || row.length < 11) continue;
    const depName = row[3] || row[2];
    if (EXCLUIR_DEPOSITOS.includes(depName)) continue;

    items.push({
      deposito: depName,
      codigo: row[4],
      descripcion: row[5],
      color: row[6] || 'U',
      talle: row[7] || 'U',
      cantidad: parseInt(row[8]) || 0,
      reservado: parseInt(row[9]) || 0,
      total: parseInt(row[10]) || 0,
    });
  }
  return items;
}

async function getTopVentas(periodo = 'hoy', appId = null, vendedorId = null, incluirCurva = false) {
  const { desde, hasta } = parsePeriodo(periodo);
  const filtroObj = {
    desde: formatDate(desde),
    hasta: formatDate(hasta),
    sucursal: '1',
  };
  if (appId) filtroObj.appId = String(appId);
  if (vendedorId) filtroObj.vendedor = String(vendedorId);
  if (incluirCurva) filtroObj.incluircurva = true;

  const data = await apiGet('/Articulos/Reportes/jsGetPagedReporteTopVenta', {
    draw: '1', start: '0', length: '5000',
    'search[value]': '', 'search[regex]': 'false',
    filtro: JSON.stringify(filtroObj),
  });

  // Con incluircurva: cada fila ya tiene color/talle, devolvemos directo
  if (incluirCurva) {
    return (data.data || []).map(row => ({
      codigo: row[0],
      descripcion: row[1],
      cantidad: parseInt(row[2]) || 0,
      color: row[5] || 'U',
      talle: row[6] || 'U',
      precioUnit: row[7] || '0',
      totalFacturado: row[8] || '0',
    })).sort((a, b) => b.cantidad - a.cantidad);
  }

  // Sin curva: agrupamos por código de artículo en Node.js
  const grouped = {};
  for (const row of (data.data || [])) {
    const codigo = row[0];
    const qty = parseInt(row[2]) || 0;
    const total = parseFloat((row[8] || '0').replace(/\./g, '').replace(',', '.')) || 0;
    const precio = parseFloat((row[7] || '0').replace(/\./g, '').replace(',', '.')) || 0;

    if (!grouped[codigo]) {
      grouped[codigo] = { codigo, descripcion: row[1], cantidad: 0, totalFacturado: 0, precioUnit: precio };
    }
    grouped[codigo].cantidad += qty;
    grouped[codigo].totalFacturado += total;
  }

  return Object.values(grouped)
    .sort((a, b) => b.cantidad - a.cantidad)
    .map(v => ({
      ...v,
      totalFacturado: v.totalFacturado.toLocaleString('es-AR', { maximumFractionDigits: 0 }),
      precioUnit: v.precioUnit.toLocaleString('es-AR', { maximumFractionDigits: 0 }),
    }));
}

async function getFacturacion(periodo = 'hoy', appId = null) {
  const { desde, hasta } = parsePeriodo(periodo);
  const periodoStr = `${formatDateSlash(desde)},${formatDateSlash(hasta)}`;
  const params = { sucursalid: '1', Periodo: periodoStr };
  if (appId) params.appId = String(appId);
  return apiGet('/facturacion/GetFacturacionGeneral', params);
}

async function getComprobantesVenta(periodo = 'hoy', appId = null, vendedorId = null, clienteBuscar = null) {
  const { desde, hasta } = parsePeriodo(periodo);
  const filtroObj = {
    desde: formatDate(desde),
    hasta: formatDate(hasta),
    sucursal: '1',
  };
  if (appId) filtroObj.appId = String(appId);
  if (vendedorId) filtroObj.vendedor = String(vendedorId);

  const data = await apiGet('/Venta/jsGetPagedVentas', {
    draw: '1', start: '0', length: '5000',
    'search[value]': '', 'search[regex]': 'false',
    filtro: JSON.stringify(filtroObj),
  });

  let results = (data.data || []).map(row => ({
    facturaId: row[0],
    fecha: row[1],
    hora: row[2],
    tipo: (row[3] || '').trim(),
    comprobante: row[4],
    cliente: row[5],
    monto: parseFloat(row[6]) || 0,
    estado: row[8],
    canal: row[9],
  }));

  // Filtrar por nombre de cliente si se especificó
  if (clienteBuscar) {
    const term = clienteBuscar.toLowerCase();
    results = results.filter(r => (r.cliente || '').toLowerCase().includes(term));
  }

  return results;
}

async function getVendedores() {
  const data = await apiGet('/empleado/jsGetAllSelect2');
  if (typeof data === 'string') {
    try { return JSON.parse(data); } catch { return []; }
  }
  return Array.isArray(data) ? data : [];
}

async function getFacturacionPorCanal(periodo = 'hoy') {
  const canales = { 4: 'Local', 5: 'WhatsApp', 9: 'Tienda Online', 8: 'Fábrica', 11: 'Henko' };
  const { desde, hasta } = parsePeriodo(periodo);
  const periodoStr = `${formatDateSlash(desde)},${formatDateSlash(hasta)}`;

  // Consultar total y cada canal principal
  const results = {};
  const totalData = await apiGet('/facturacion/GetFacturacionGeneral', { sucursalid: '1', Periodo: periodoStr });
  results.total = {
    ventas: totalData.TotalVentas || 0,
    movimientos: totalData.MovimientosVentas || 0,
  };

  for (const [appId, nombre] of Object.entries(canales)) {
    // Rate limit: esperar entre requests
    await new Promise(r => setTimeout(r, 350));
    const data = await apiGet('/facturacion/GetFacturacionGeneral', {
      sucursalid: '1', Periodo: periodoStr, appId: String(appId),
    });
    results[nombre] = {
      ventas: data.TotalVentas || 0,
      movimientos: data.MovimientosVentas || 0,
    };
  }

  return { periodo: periodoStr, ...results };
}

async function buscarCliente(term) {
  // Búsqueda global que encuentra clientes, artículos, etc.
  const results = await apiGet('/nx/ajGlobalQueryLs', { q: term });
  if (Array.isArray(results)) {
    return results.filter(r => r.tipo === 'cliente').slice(0, 10);
  }
  return [];
}

async function getGastos(periodo = 'mes', tipoFiltro = null) {
  const { desde, hasta } = parsePeriodo(periodo);
  const filtroObj = { desde: formatDate(desde), hasta: formatDate(hasta) };
  if (tipoFiltro) filtroObj.tipo = tipoFiltro;

  const data = await apiGet('/Compra/jsGetPagedCompras', {
    draw: '1', start: '0', length: '5000',
    'search[value]': '', 'search[regex]': 'false',
    filtro: JSON.stringify(filtroObj),
  });

  return (data.data || []).map(row => ({
    id: row[0],
    fecha: row[1],
    comprobante: row[3],
    destinatario: row[4],
    monto: parseFloat((row[5] || '0').replace(/\./g, '').replace(',', '.')) || 0,
    estado: row[7],
  }));
}

async function getDetalleFactura(facturaId) {
  const { baseUrl, user, password } = config.kingtex.erp;
  const https = require('https');
  const hostname = new URL(baseUrl).hostname;

  // Login fresco
  const loginRes = await new Promise((res, rej) => {
    const r = https.request({ hostname, path: '/Account/Login', method: 'POST',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded' }
    }, resp => {
      const sc = (resp.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      let d = ''; resp.on('data', c => d += c); resp.on('end', () => res({ cookies: sc }));
    });
    r.on('error', rej);
    r.write(`UserName=${encodeURIComponent(user)}&Password=${encodeURIComponent(password)}&RememberMe=true`);
    r.end();
  });

  const factRes = await new Promise((res, rej) => {
    const r = https.request({ hostname, path: '/Facturacion/paGetFactura', method: 'POST',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': loginRes.cookies }
    }, resp => {
      let d = ''; resp.on('data', c => d += c); resp.on('end', () => res(d));
    });
    r.on('error', rej);
    r.write(`id=${facturaId}`);
    r.end();
  });

  // Parsear header
  const getSpan = (id) => {
    const m = factRes.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</`, 'i'));
    return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
  };
  const header = {
    cliente: getSpan('factura_entidad'),
    fecha: getSpan('factura_fecha'),
    numero: getSpan('factura_numerofull'),
    estado: getSpan('factura_estado'),
    pagado: getSpan('factura_pagado'),
    pendiente: getSpan('factura_pendiente'),
    empleado: getSpan('factura_empleado'),
    sucursal: getSpan('factura_sucursal'),
  };

  // Parsear items y medios de pago de las tablas HTML
  const items = [];
  const mediosPago = [];
  const rows = factRes.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];

  for (const row of rows) {
    const tds = [];
    for (const m of row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)) {
      tds.push(m[1].replace(/<[^>]+>/g, '').trim());
    }

    // Items: Articulo | Color | Talle | Cant | Precio | SubTotal | Desc | Total
    if (tds.length >= 4 && tds[3] && !isNaN(parseInt(tds[3]))) {
      const desc = tds[0].split(/\s{2,}/);
      items.push({
        codigo: desc[0] || tds[0],
        descripcion: desc.slice(1).join(' ') || tds[0],
        color: tds[1] || 'U',
        talle: tds[2] || 'U',
        cantidad: parseInt(tds[3]) || 0,
        precio: tds[4] || '0',
        total: tds[7] || tds[5] || '0',
      });
    }
    // Medios de pago: "Efectivo\n Caja Vendedor 2 | $282.100"
    else if (tds.length === 2 && tds[1].includes('$')) {
      const medio = tds[0].replace(/\s+/g, ' ').trim();
      const monto = tds[1].trim();
      mediosPago.push({ medio, monto });
    }
  }

  return { header, items, mediosPago };
}

async function getVentasDetalleProducto(periodo = 'hoy', codigoProducto) {
  const comprobantes = await getComprobantesVenta(periodo);

  const ventasPorVariante = {};
  let facturasProcesadas = 0;

  for (const comp of comprobantes) {
    if (comp.estado === 'ANULADO') continue;

    await new Promise(r => setTimeout(r, 350)); // Rate limit ERP: 15 req/5s
    facturasProcesadas++;

    try {
      const detalle = await getDetalleFactura(comp.facturaId);
      for (const item of detalle.items) {
        if (!item.codigo.startsWith(codigoProducto)) continue;
        const key = `${item.color}|${item.talle}`;
        if (!ventasPorVariante[key]) ventasPorVariante[key] = { color: item.color, talle: item.talle, cantidad: 0 };
        ventasPorVariante[key].cantidad += item.cantidad;
      }
    } catch (err) {
      // Silenciar errores individuales
    }
  }

  const variantes = Object.values(ventasPorVariante).sort((a, b) => b.cantidad - a.cantidad);
  const totalUnidades = variantes.reduce((s, v) => s + v.cantidad, 0);

  return {
    producto: codigoProducto,
    periodo,
    facturasProcesadas,
    totalFacturas: comprobantes.length,
    totalUnidades,
    variantes,
  };
}

async function getSaldosClientes() {
  return apiGet('/saldos/SaldoVencidoClientes');
}

async function getCanales() {
  return apiGet('/apps/canales');
}

async function getReposicion(codigoProducto, horizonte, leadTime) {
  const biz = config.kingtex.business;
  horizonte = horizonte || biz.horizonte;
  leadTime = leadTime || biz.leadTime;
  const diasVentas = biz.ventanaDias;

  const stockItems = await getStock(codigoProducto);
  const stockByVariant = {};
  let stockTotal = 0;
  let nombre = codigoProducto;

  for (const item of stockItems) {
    if (item.codigo !== codigoProducto) continue;
    const key = `${item.talle}|${item.color}`;
    stockByVariant[key] = (stockByVariant[key] || 0) + item.cantidad;
    stockTotal += item.cantidad;
    nombre = item.descripcion;
  }

  // Ventas de los últimos N días
  const hoy = new Date();
  const hace = new Date(hoy - diasVentas * 86400000);
  const periodo = `${formatDate(hace)},${formatDate(hoy)}`;
  const topVentas = await getTopVentas(periodo);
  const productoVenta = topVentas.find(v => v.codigo === codigoProducto);
  const ventaTotal = productoVenta ? productoVenta.cantidad : 0;
  const velDiaria = ventaTotal / diasVentas;
  const diasStock = velDiaria > 0 ? stockTotal / velDiaria : 999;
  const fabricar = Math.max(0, Math.round(velDiaria * horizonte - stockTotal));

  return {
    codigo: codigoProducto,
    nombre,
    stockTotal,
    stockByVariant,
    ventaTotal,
    diasVentas,
    velDiaria: Math.round(velDiaria * 10) / 10,
    diasStock: Math.round(diasStock),
    fabricar,
    horizonte,
    leadTime,
    urgencia: diasStock <= leadTime ? 'CRITICO' : diasStock <= leadTime * 2 ? 'ATENCION' : 'OK',
  };
}

// Comparativa año a año de un producto
async function getComparativaAnual(codigoProducto, mesActual) {
  const hoy = new Date();
  const mes = mesActual || hoy.getMonth(); // 0-indexed
  const anioActual = hoy.getFullYear();
  const anioAnterior = anioActual - 1;

  const diaHoy = hoy.getDate();
  // Mismo período del año anterior
  const desde2 = `01-${String(mes + 1).padStart(2, '0')}-${anioActual}`;
  const hasta2 = `${String(diaHoy).padStart(2, '0')}-${String(mes + 1).padStart(2, '0')}-${anioActual}`;
  const desde1 = `01-${String(mes + 1).padStart(2, '0')}-${anioAnterior}`;
  const hasta1 = `${String(diaHoy).padStart(2, '0')}-${String(mes + 1).padStart(2, '0')}-${anioAnterior}`;

  const [ventasAnterior, ventasActual] = await Promise.all([
    getTopVentas(`${desde1},${hasta1}`),
    getTopVentas(`${desde2},${hasta2}`),
  ]);

  const findProducto = (ventas) => ventas.find(v => v.codigo === codigoProducto);
  const anterior = findProducto(ventasAnterior);
  const actual = findProducto(ventasActual);

  const cantAnterior = anterior ? anterior.cantidad : 0;
  const cantActual = actual ? actual.cantidad : 0;
  const cambio = cantAnterior > 0 ? Math.round(((cantActual - cantAnterior) / cantAnterior) * 100) : (cantActual > 0 ? 100 : 0);

  return {
    producto: codigoProducto,
    periodoAnterior: `${desde1} a ${hasta1}`,
    periodoActual: `${desde2} a ${hasta2}`,
    anterior: { unidades: cantAnterior, facturacion: anterior?.totalFacturado || '0' },
    actual: { unidades: cantActual, facturacion: actual?.totalFacturado || '0' },
    cambioPorcentual: cambio,
    tendencia: cambio > 10 ? 'CRECIMIENTO' : cambio < -10 ? 'CAÍDA' : 'ESTABLE',
  };
}

// Facturación comparativa entre dos períodos (incluye métodos de pago)
async function getFacturacionComparativa(periodo1, periodo2) {
  const p1 = parsePeriodo(periodo1);
  const p2 = parsePeriodo(periodo2);
  const ps1 = `${formatDateSlash(p1.desde)},${formatDateSlash(p1.hasta)}`;
  const ps2 = `${formatDateSlash(p2.desde)},${formatDateSlash(p2.hasta)}`;

  const [f1, f2] = await Promise.all([
    apiGet('/facturacion/GetFacturacionGeneral', { sucursalid: '1', Periodo: ps1 }),
    apiGet('/facturacion/GetFacturacionGeneral', { sucursalid: '1', Periodo: ps2 }),
  ]);

  const extractMetodos = (data) => {
    const metodos = {};
    for (const v of (data.Ventas || [])) {
      metodos[v.Nombre] = { total: v.Total, cantidad: v.Cantidad };
    }
    return metodos;
  };

  return {
    periodo1: { label: ps1, totalVentas: f1.TotalVentas || 0, movimientos: f1.MovimientosVentas || 0, metodosPago: extractMetodos(f1) },
    periodo2: { label: ps2, totalVentas: f2.TotalVentas || 0, movimientos: f2.MovimientosVentas || 0, metodosPago: extractMetodos(f2) },
    diferencia: (f2.TotalVentas || 0) - (f1.TotalVentas || 0),
    cambioPorcentual: (f1.TotalVentas || 0) > 0 ? Math.round((((f2.TotalVentas || 0) - (f1.TotalVentas || 0)) / (f1.TotalVentas || 0)) * 100) : 0,
  };
}

// Métodos de pago disponibles
async function getMetodosPago() {
  return apiGet('/facturacion/GetMetodosPagoVenta');
}

// Historial de stock estimado (reconstruye día a día desde ventas)
async function getStockHistorial(codigoProducto, dias = 14) {
  const stockItems = await getStock(codigoProducto);
  const stockActual = stockItems.filter(i => i.codigo === codigoProducto).reduce((s, i) => s + i.cantidad, 0);
  const nombre = stockItems.find(i => i.codigo === codigoProducto)?.descripcion || codigoProducto;

  const historial = [];
  let stockAcumulado = stockActual;

  // Ir de hoy hacia atrás
  for (let d = 0; d < dias; d++) {
    const fecha = new Date(Date.now() - d * 86400000);
    const fStr = formatDate(fecha);

    if (d === 0) {
      historial.push({ fecha: fStr, stockEstimado: stockActual, vendidas: 0, nota: 'hoy' });
      continue;
    }

    try {
      await new Promise(r => setTimeout(r, 400)); // Rate limit
      const ventas = await getTopVentas(`${fStr},${fStr}`);
      const prod = ventas.find(v => v.codigo === codigoProducto);
      const vendidas = prod ? prod.cantidad : 0;
      // Stock de ese día = stock actual + ventas de días posteriores
      stockAcumulado += vendidas;
      historial.push({ fecha: fStr, stockEstimado: stockAcumulado, vendidas });
    } catch {
      historial.push({ fecha: fStr, stockEstimado: null, vendidas: null, nota: 'error' });
    }
  }

  // Invertir para que vaya de más viejo a más nuevo
  historial.reverse();

  const diasSinStock = historial.filter(h => h.stockEstimado !== null && h.stockEstimado <= 0).length;
  const diasBajo = historial.filter(h => h.stockEstimado !== null && h.stockEstimado > 0 && h.stockEstimado < 50).length;

  return {
    producto: codigoProducto,
    nombre,
    stockActual,
    dias,
    diasSinStock,
    diasStockBajo: diasBajo,
    historial,
  };
}

// Cheques
async function getCheques() {
  const data = await apiGet('/Cheque/jsGetPaged', {
    draw: '1', start: '0', length: '5000',
    'search[value]': '', 'search[regex]': 'false',
  });
  return (data.data || []).map(row => ({
    id: row[0],
    fechaEmision: row[1],
    fechaVencimiento: row[2],
    empresa: row[3],
    monto: parseFloat((row[4] || '0').replace(/\./g, '').replace(',', '.')) || 0,
    banco: row[5],
    proveedor: row[7] || row[8] || '',
    beneficiario: row[8] || row[7] || '',
  }));
}

// Cortes de fábrica
async function getCortes() {
  const data = await apiGet('/fabrica2/Cortes/jsGetPaged', {
    draw: '1', start: '0', length: '5000',
    'search[value]': '', 'search[regex]': 'false',
    filtro: JSON.stringify({}),
  });
  return (data.data || []).map(row => ({
    id: row[0],
    producto: row[1],
    cantidad: parseInt(row[2]) || 0,
    temporada: row[7],
    estadoTemporada: row[8],
    cortados: parseInt(row[9]) || 0,
    enviados: parseInt(row[10]) || 0,
    pendientes: parseInt(row[11]) || 0,
    estado: row[12],
    estadoCorte: row[14],
  }));
}

// Envíos a talleres
async function getEnviosTalleres() {
  const data = await apiGet('/fabrica2/Envios/jsGetPaged', {
    draw: '1', start: '0', length: '5000',
    'search[value]': '', 'search[regex]': 'false',
    filtro: JSON.stringify({}),
  });
  return (data.data || []).map(row => ({
    id: row[0],
    taller: row[1],
    lote: row[2],
    fecha: row[3],
    producto: row[4],
    tipo: row[5],
    estado: row[6],
    cantidadEnviada: parseInt(row[7]) || 0,
    cantidadRecibida: parseInt(row[19]) || 0,
    pendiente: (parseInt(row[7]) || 0) - (parseInt(row[19]) || 0),
  }));
}

async function rawRequest(path, params = {}, method = 'GET') {
  const { baseUrl } = config.kingtex.erp;
  await login();
  const url = new URL(path, baseUrl);
  if (method === 'GET') {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const options = { method };
  if (method === 'POST') {
    options.body = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  }

  const res = await request(url.toString(), options);

  try {
    return { type: 'json', data: JSON.parse(res.data), status: res.status };
  } catch {
    const text = res.data
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 3000);

    return { type: 'html', status: res.status, textContent: text };
  }
}

module.exports = {
  login,
  getStock,
  getTopVentas,
  getFacturacion,
  getFacturacionPorCanal,
  getComprobantesVenta,
  getGastos,
  getDetalleFactura,
  getVentasDetalleProducto,
  getVendedores,
  buscarCliente,
  getSaldosClientes,
  getCanales,
  getReposicion,
  getComparativaAnual,
  getFacturacionComparativa,
  getMetodosPago,
  getStockHistorial,
  getCheques,
  getCortes,
  getEnviosTalleres,
  rawRequest,
  parsePeriodo,
  formatDate,
  formatDateSlash,
};
