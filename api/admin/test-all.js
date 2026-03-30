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
    const connectors = Array.isArray(chatHandler.supportedConnectors) ? chatHandler.supportedConnectors : [];
    const concurrency = 6;
    const results = [];
    let index = 0;

    async function worker() {
      while (index < connectors.length) {
        const current = connectors[index++];
        const result = await chatHandler.probeConnector(current, { userContext: req.body?.userContext || {} });
        results.push(result);
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, connectors.length) }, () => worker()));
    results.sort((a, b) => a.key.localeCompare(b.key));

    return res.status(200).json({
      ok: true,
      total: results.length,
      counts: {
        active: results.filter(item => item.status === 'active').length,
        error: results.filter(item => item.status === 'error').length,
        missing_key: results.filter(item => item.status === 'missing_key').length,
        present_only: results.filter(item => item.status === 'present_only').length,
      },
      results,
    });
  } catch (error) {
    console.error('Admin test-all error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};
