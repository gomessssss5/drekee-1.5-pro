const express = require('express');
const cors = require('cors');
const path = require('path');

// Import the chat handler
const chatHandler = require('./api/chat.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// API routes
app.post('/api/chat', async (req, res) => {
  try {
    const result = await chatHandler.default(req, res);
    // The handler should handle the response
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function sanitizeLatexDocument(rawCode = '') {
  return String(rawCode || '')
    .replace(/^```(?:latex)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/\r/g, '')
    .trim();
}

app.post('/api/render-latex', async (req, res) => {
  try {
    const code = sanitizeLatexDocument(req.body?.code || '');
    const format = String(req.body?.format || 'png').trim().toLowerCase() || 'png';

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
      form.append('engine', 'lualatex');
      form.append('return', 'pdf');
      form.append('filename[]', 'document.tex');
      form.append('filecontents[]', code);
      upstream = await fetch('https://texlive.net/cgi-bin/latexcgi', {
        method: 'POST',
        body: form,
      });
      contentType = upstream.headers.get('content-type') || 'text/plain; charset=utf-8';
    }

    if (contentType.startsWith('image/') || contentType.includes('pdf')) {
      res.status(upstream.status);
      res.setHeader('Content-Type', contentType);
      const arrayBuffer = await upstream.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    }

    const text = await upstream.text();
    return res.status(422).json({
      error: 'Falha ao compilar o grafico LaTeX',
      details: text.slice(0, 1600),
    });
  } catch (error) {
    console.error('LaTeX render proxy error:', error);
    return res.status(500).json({ error: 'Failed to render LaTeX graph' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', version: '1.5.3' });
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Drekee AI 1.5 Pro running on http://localhost:${PORT}`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/api/chat`);
});
