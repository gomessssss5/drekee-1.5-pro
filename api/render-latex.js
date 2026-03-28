async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});

    const code = String(body.code || '').trim();
    const format = String(body.format || 'png').trim().toLowerCase() || 'png';

    if (!code) {
      return res.status(400).json({ error: 'Missing LaTeX code' });
    }

    let upstream = null;
    let contentType = '';

    try {
      upstream = await fetch('https://r-latex.vercel.app/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, format }),
      });
      contentType = upstream.headers.get('content-type') || '';
    } catch (error) {
      upstream = null;
      contentType = '';
    }

    const shouldFallback =
      !upstream ||
      !upstream.ok ||
      (!contentType.startsWith('image/') && !contentType.includes('json'));

    if (shouldFallback) {
      const form = new FormData();
      form.append('engine', 'pdflatex');
      form.append('return', 'pdf');
      form.append('filename[]', 'document.tex');
      form.append('filecontents[]', code);

      upstream = await fetch('https://texlive.net/cgi-bin/latexcgi', {
        method: 'POST',
        body: form,
      });

      contentType = upstream.headers.get('content-type') || 'text/plain; charset=utf-8';
    }

    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);

    if (contentType.startsWith('image/') || contentType.includes('pdf')) {
      const arrayBuffer = await upstream.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    }

    const text = await upstream.text();
    return res.send(text);
  } catch (error) {
    console.error('render-latex API error:', error);
    return res.status(500).json({ error: 'Failed to render LaTeX graph' });
  }
}

module.exports = handler;
