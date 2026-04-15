/**
 * Kingify v2 — Google Sheets integration via viaSocket MCP
 */
const https = require('https');

const MCP_URL = process.env.SHEETS_MCP_URL || 'https://mcp.viasocket.com/mcp/69deb151b979dbb7d9dd3410-105686';

function callMCP(action_name, instructions, thread_id = 'kingify-sheets') {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'Google_Sheets',
        arguments: { thread_id, action_name, instructions },
      },
      id: Date.now(),
    });

    const url = new URL(MCP_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          // Parse SSE response
          const match = data.match(/data: (.+)/);
          if (match) {
            const parsed = JSON.parse(match[1]);
            const text = parsed.result?.content?.[0]?.text || '';
            try {
              const inner = JSON.parse(text);
              resolve(inner);
            } catch {
              resolve({ message: text });
            }
          } else {
            resolve({ message: data.substring(0, 500) });
          }
        } catch (err) {
          reject(new Error('Error parseando respuesta MCP: ' + err.message));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout MCP')); });
    req.write(body);
    req.end();
  });
}

// Crear sheet Y escribir datos en una sola operación
async function createAndWrite(title, rows) {
  // Paso 1: crear
  const created = await callMCP(
    'Create a Spreadsheet',
    `Create a new Google Spreadsheet with title: "${title}"`,
    'kingify-create-' + Date.now()
  );
  const resp = created.tool_response?.[0] || created;
  const spreadsheetId = resp.spreadsheetId || '';
  const url = resp.spreadsheetUrl || (spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` : '');

  if (!spreadsheetId) {
    return { ok: false, error: 'No se pudo crear la sheet', raw: JSON.stringify(created).substring(0, 200) };
  }

  // Paso 2: escribir filas si hay
  if (rows && rows.length > 0) {
    const rowsStr = rows.map(r => JSON.stringify(r)).join('\n');
    await callMCP(
      'Add Multiple Rows',
      `Add these rows to spreadsheet ID: ${spreadsheetId}, sheet: Sheet1.\nRows (each is a JSON array):\n${rowsStr}`,
      'kingify-write-' + Date.now()
    );
  }

  return { ok: true, spreadsheetId, url, filas: rows ? rows.length : 0 };
}

// Leer datos de una hoja
async function readSheet(spreadsheetId, range) {
  return callMCP(
    'Get spreadsheet data from specific sheets/ranges',
    `Read data from spreadsheet ID: ${spreadsheetId}, range: ${range || 'Sheet1'}. Return all rows and columns.`
  );
}

// Escribir filas en una hoja
async function writeRows(spreadsheetId, sheetName, rows) {
  const rowsStr = rows.map(r => JSON.stringify(r)).join('\n');
  return callMCP(
    'Add Multiple Rows',
    `Add these rows to spreadsheet ID: ${spreadsheetId}, sheet: ${sheetName || 'Sheet1'}.\nRows (each is a JSON array):\n${rowsStr}`
  );
}

// Actualizar una fila
async function updateRow(spreadsheetId, sheetName, rowNumber, data) {
  return callMCP(
    'Update Spreadsheet Row',
    `Update row ${rowNumber} in spreadsheet ID: ${spreadsheetId}, sheet: ${sheetName || 'Sheet1'}. Set values: ${JSON.stringify(data)}`
  );
}

// Listar hojas de un spreadsheet
async function listSheets(spreadsheetId) {
  return callMCP(
    'List Subsheet',
    `List all sheets/tabs in spreadsheet ID: ${spreadsheetId}`
  );
}

// Crear una hoja nueva
async function createSheet(title) {
  return callMCP(
    'Create a Spreadsheet',
    `Create a new Google Spreadsheet with title: "${title}"`
  );
}

// Buscar filas
async function lookupRows(spreadsheetId, sheetName, column, value) {
  return callMCP(
    'Lookup Spreadsheet Rows',
    `In spreadsheet ID: ${spreadsheetId}, sheet: ${sheetName || 'Sheet1'}, find all rows where column "${column}" contains "${value}"`
  );
}

module.exports = { createAndWrite, readSheet, writeRows, updateRow, listSheets, createSheet, lookupRows, callMCP };
