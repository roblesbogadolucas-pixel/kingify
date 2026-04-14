/**
 * Kingify v2 — Reporte diario automático
 * Envía resumen del día a las 18:30 (hora Argentina)
 */
const erp = require('./erp/client');

const REPORT_HOUR = 18;
const REPORT_MINUTE = 30;

let reportSent = false;
let sendMessageFn = null;
let reportChatId = null;

function init(sendMessage, chatId) {
  sendMessageFn = sendMessage;
  reportChatId = chatId;
  console.log(`[cron] Reporte diario configurado para ${REPORT_HOUR}:${String(REPORT_MINUTE).padStart(2, '0')} → ${chatId}`);

  // Chequear cada minuto
  setInterval(checkAndSend, 60_000);
}

async function checkAndSend() {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();

  // Reset flag a medianoche
  if (hour === 0 && minute === 0) reportSent = false;

  // Enviar reporte a la hora configurada
  if (hour === REPORT_HOUR && minute === REPORT_MINUTE && !reportSent && sendMessageFn && reportChatId) {
    reportSent = true;
    console.log('[cron] Generando reporte diario...');
    try {
      const report = await generateReport();
      await sendMessageFn(reportChatId, report);
      console.log('[cron] Reporte enviado');
    } catch (err) {
      console.error('[cron] Error generando reporte:', err.message);
    }
  }
}

async function generateReport() {
  await erp.login();

  const hoy = new Date();
  const fecha = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;

  // Facturación del día
  const facturacion = await erp.getFacturacionPorCanal('hoy');
  const totalVentas = facturacion.total?.ventas || 0;
  const totalMovimientos = facturacion.total?.movimientos || 0;

  // Canales
  const canales = [];
  for (const [nombre, data] of Object.entries(facturacion)) {
    if (nombre === 'periodo' || nombre === 'total') continue;
    if (data.ventas > 0) canales.push({ nombre, ventas: data.ventas, movimientos: data.movimientos });
  }
  canales.sort((a, b) => b.ventas - a.ventas);

  // Ranking vendedores
  const vendedores = [
    { nombre: 'Daniel', id: '11977' },
    { nombre: 'Daniel 2', id: '11978' },
    { nombre: 'Lautaro', id: '3233' },
    { nombre: 'Lautaro 2', id: '9265' },
    { nombre: 'Susana', id: '12529' },
  ];

  const rankingVendedores = [];
  for (const v of vendedores) {
    await new Promise(r => setTimeout(r, 350));
    const ventas = await erp.getTopVentas('hoy', null, v.id);
    const totalUnidades = ventas.reduce((s, item) => s + item.cantidad, 0);
    const totalFacturado = ventas.reduce((s, item) => {
      const val = typeof item.totalFacturado === 'string'
        ? parseFloat(item.totalFacturado.replace(/\./g, '').replace(',', '.')) || 0
        : (item.totalFacturado || 0);
      return s + val;
    }, 0);
    rankingVendedores.push({ nombre: v.nombre, unidades: totalUnidades, facturacion: totalFacturado });
  }
  rankingVendedores.sort((a, b) => b.facturacion - a.facturacion);

  // Top 10 artículos
  const topArticulos = await erp.getTopVentas('hoy');
  const top10 = topArticulos.slice(0, 10);

  // Top 5 clientes
  const comprobantes = await erp.getComprobantesVenta('hoy');
  const porCliente = {};
  for (const c of comprobantes) {
    const nombre = c.cliente || 'Sin nombre';
    if (!porCliente[nombre]) porCliente[nombre] = { compras: 0, total: 0 };
    porCliente[nombre].compras++;
    porCliente[nombre].total += c.monto;
  }
  const topClientes = Object.entries(porCliente)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5);

  // Armar mensaje
  const formatMoney = (n) => '$' + Math.round(n).toLocaleString('es-AR');

  let msg = `*Reporte diario — ${fecha}*\n\n`;

  msg += `*Facturacion del dia*\n`;
  msg += `Total: ${formatMoney(totalVentas)} (${totalMovimientos} operaciones)\n`;
  for (const c of canales) {
    msg += `${c.nombre}: ${formatMoney(c.ventas)}\n`;
  }

  msg += `\n*Vendedores*\n`;
  for (const v of rankingVendedores) {
    msg += `${v.nombre}: ${formatMoney(v.facturacion)} (${v.unidades}u)\n`;
  }

  msg += `\n*Top 10 articulos*\n`;
  for (const a of top10) {
    msg += `${a.codigo}: ${a.cantidad}u\n`;
  }

  msg += `\n*Top 5 clientes*\n`;
  for (const [nombre, data] of topClientes) {
    msg += `${nombre}: ${formatMoney(data.total)} (${data.compras} compras)\n`;
  }

  return msg;
}

module.exports = { init, generateReport };
