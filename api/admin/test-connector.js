const chatHandler = require('../chat.js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const key = String(req.body?.key || '').trim().toLowerCase();
    if (!key) {
      return res.status(400).json({ ok: false, error: 'Missing connector key' });
    }

    const result = await chatHandler.probeConnector(key, { userContext: req.body?.userContext || {} });
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    console.error('Admin connector test error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};
