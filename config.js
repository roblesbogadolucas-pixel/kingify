const path = require('path');

// En Railway: RAILWAY_VOLUME_MOUNT_PATH=/data
// Local: usa carpetas del proyecto
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const IS_RAILWAY = !!process.env.RAILWAY_VOLUME_MOUNT_PATH;

module.exports = {
  client: 'kingtex',
  isRailway: IS_RAILWAY,

  paths: {
    auth: path.join(DATA_DIR, 'auth'),
    db: path.join(DATA_DIR, 'db'),
    solicitudes: path.join(DATA_DIR, 'solicitudes.log'),
  },

  kingtex: {
    name: 'Kingtex',
    erp: {
      baseUrl: process.env.NINOXNET_BASE_URL,
      user: process.env.NINOXNET_USER,
      password: process.env.NINOXNET_PASSWORD,
      sessionTTL: 60_000,
    },
    business: {
      leadTime: 20,
      horizonte: 60,
      ventanaDias: 90,
      deposExcluir: ['MATERIA PRIMA'],
      tallesAdulto: ['S', 'M', 'L', 'XL', 'XXL'],
      tallesNino: ['6', '8', '10', '12', '14', '16'],
      canales: {
        4: 'Local',
        5: 'WhatsApp',
        8: 'Fábrica',
        9: 'Tienda Online',
        11: 'Henko',
      },
    },
    whatsapp: {
      authorizedNumbers: (process.env.AUTHORIZED_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean),
    },
    paths: {
      knowledge: path.join(__dirname, 'data', 'ninox_knowledge.md'),
      memory: path.join(__dirname, 'data', 'MEMORY.md'),
    },
  },

  claude: {
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
    maxTokens: 1024,
    maxToolCalls: 3,
  },

  cache: {
    stock: 5 * 60 * 1000,
    ventas: 60 * 1000,
    facturacion: 60 * 1000,
    saldos: 10 * 60 * 1000,
    canales: 60 * 60 * 1000,
  },
};
