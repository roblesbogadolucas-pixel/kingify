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

async function getTopVentas(periodo = 'hoy', appId = null, vendedorId = null) {
  const { desde, hasta } = parsePeriodo(periodo);
  const filtroObj = {
    desde: formatDate(desde),
    hasta: formatDate(hasta),
    sucursal: '1',
  };
  if (appId) filtroObj.appId = String(appId);
  if (vendedorId) filtroObj.vendedor = String(vendedorId);

  const data = await apiGet('/Articulos/Reportes/jsGetPagedReporteTopVenta', {
    draw: '1', start: '0', length: '5000',
    'search[value]': '', 'search[regex]': 'false',
    filtro: JSON.stringify(filtroObj),
  });

  // El endpoint sin params columns[] devuelve líneas individuales (1 ud c/u)
  // Agrupamos por código de artículo en Node.js
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

  // Ordenar por cantidad desc y formatear totales
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
  getVendedores,
  buscarCliente,
  getSaldosClientes,
  getCanales,
  getReposicion,
  rawRequest,
  parsePeriodo,
  formatDate,
  formatDateSlash,
};
