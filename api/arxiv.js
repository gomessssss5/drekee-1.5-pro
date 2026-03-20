const fetch = global.fetch || require('node-fetch');

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const q = (req.query?.q || new URL(req.url, 'http://localhost').searchParams.get('q') || '').toString().trim();
  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter q' });
  }

  const apiUrl = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&start=0&max_results=3`;

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      return res.status(502).json({ error: 'arXiv API error', status: response.status });
    }

    const xml = await response.text();
    const entries = Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)).slice(0, 3);

    const result = entries.map(match => {
      const entry = match[1];
      const extract = (re) => {
        const m = entry.match(re);
        if (!m) return null;
        return m[1].replace(/\s+/g, ' ').trim();
      };

      return {
        title: extract(/<title>([\s\S]*?)<\/title>/i) || null,
        summary: extract(/<summary>([\s\S]*?)<\/summary>/i) || null,
        link: extract(/<id>([\s\S]*?)<\/id>/i) || null,
      };
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('arxiv proxy error:', err);
    return res.status(500).json({ error: 'Failed to fetch arXiv data' });
  }
}

module.exports = handler;
