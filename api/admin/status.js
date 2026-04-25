const packageJson = require('../../package.json');
const chatHandler = require('../chat.js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const diagnostics = await chatHandler.getAdminDiagnostics();
    return res.status(200).json({
      ok: true,
      version: packageJson.version,
      diagnostics,
    });
  } catch (error) {
    console.error('Admin status error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};
