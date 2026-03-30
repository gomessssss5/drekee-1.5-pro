const express = require('express');
const cors = require('cors');
const path = require('path');
const packageJson = require('./package.json');

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
    const result = await chatHandler(req, res);
    // The handler should handle the response
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/status', async (req, res) => {
  try {
    const diagnostics = await chatHandler.getAdminDiagnostics();
    return res.json({
      ok: true,
      version: packageJson.version,
      diagnostics,
    });
  } catch (error) {
    console.error('Admin status error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/admin/test-connector', async (req, res) => {
  try {
    const key = String(req.body?.key || '').trim().toLowerCase();
    if (!key) {
      return res.status(400).json({ ok: false, error: 'Missing connector key' });
    }
    const result = await chatHandler.probeConnector(key, { userContext: req.body?.userContext || {} });
    return res.json({ ok: true, result });
  } catch (error) {
    console.error('Admin connector test error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/admin/test-all', async (req, res) => {
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

    return res.json({
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
});

function sanitizeLatexDocument(rawCode = '') {
  return String(rawCode || '')
    .replace(/^```(?:latex)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/\r/g, '')
    .trim();
}

function normalizeLatexText(input = '') {
  return String(input || '')
    .replace(/[\u2018\u2019]/g, '\'')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/\u200B/g, '')
    .trim();
}

function toAsciiLatexText(input = '') {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ç/g, 'c')
    .replace(/Ç/g, 'C');
}

function escapeLoosePercentSigns(input = '') {
  return String(input || '').replace(/(^|[^\\])%/g, '$1\\%');
}

const DREKEE_LATEX_THEME = [
  '\\definecolor{chatgpt_color}{RGB}{58,169,145}',
  '\\definecolor{gemini_color}{RGB}{52,110,232}',
  '\\definecolor{drekee_color}{RGB}{255,145,0}',
  '\\definecolor{graph_grid}{RGB}{214,220,230}',
  '\\pgfplotsset{',
  '  drekee premium/.style={',
  '    width=16cm,',
  '    height=9cm,',
  '    enlarge x limits=0.16,',
  '    ymajorgrids=true,',
  '    xmajorgrids=false,',
  '    grid style={dashed, draw=graph_grid},',
  '    axis line style={draw=black!72},',
  '    tick style={draw=black!72},',
  '    tick label style={font=\\small, text=black!82},',
  '    label style={font=\\bfseries\\small, text=black!88},',
  '    title style={font=\\bfseries\\normalsize, align=center, text=black!92},',
  '    legend style={at={(0.5,-0.15)}, anchor=north, legend columns=-1, draw=none, font=\\small, /tikz/every even column/.append style={column sep=15pt}},',
  '    legend cell align={left},',
  '    nodes near coords,',
  '    nodes near coords align={vertical},',
  '    every node near coord/.append style={font=\\footnotesize, /pgf/number format/fixed, fill=white, fill opacity=0.9, text opacity=1, rounded corners=2pt, inner sep=1.5pt},',
  '    every axis plot/.append style={line width=1.8pt, line join=round},',
  '    every mark/.append style={scale=1.15, solid, line width=1pt, fill=white},',
  '    bar width=18pt',
  '  },',
  '  every axis/.append style={drekee premium},',
  '  cycle list={',
  '    {fill=chatgpt_color!78, draw=chatgpt_color!90!black, color=chatgpt_color!95!black},',
  '    {fill=gemini_color!78, draw=gemini_color!88!black, color=gemini_color!92!black},',
  '    {fill=drekee_color!88, draw=drekee_color!86!black, color=drekee_color!92!black}',
  '  }',
  '}'
].join('\n');

function injectLatexTheme(documentCode = '') {
  let themed = String(documentCode || '').trim();
  if (!themed || /\\definecolor\{chatgpt_color\}/.test(themed)) return themed;

  if (!/\\usepackage\[utf8\]\{inputenc\}/.test(themed)) {
    themed = themed.replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}\s*/, match => `${match}\n\\usepackage[utf8]{inputenc}\n`);
  }
  if (!/\\usepackage\[T1\]\{fontenc\}/.test(themed)) {
    themed = themed.replace(/\\usepackage\[utf8\]\{inputenc\}\s*/, match => `${match}\\usepackage[T1]{fontenc}\n`);
  }
  if (!/\\usepackage\{xcolor\}/.test(themed)) {
    themed = themed.replace(/\\usepackage\{pgfplots\}\s*/, match => `${match}\\usepackage{xcolor}\n`);
  }

  if (!/\\pgfplotsset\{compat=/.test(themed)) {
    themed = themed.replace(/\\usepackage\{xcolor\}\s*/, match => `${match}\\pgfplotsset{compat=1.18}\n`);
    if (!/\\pgfplotsset\{compat=/.test(themed)) {
      themed = themed.replace(/\\usepackage\{pgfplots\}\s*/, match => `${match}\\pgfplotsset{compat=1.18}\n`);
    }
  }

  return themed.replace(/(\\pgfplotsset\{compat=[^}]+\}\s*)/, `$1${DREKEE_LATEX_THEME}\n`);
}

function wrapLatexDocument(body = '') {
  const trimmedBody = String(body || '').trim();
  return injectLatexTheme([
    '\\documentclass[border=10pt]{standalone}',
    '\\usepackage{pgfplots}',
    '\\usepackage{xcolor}',
    '\\pgfplotsset{compat=1.18}',
    '\\begin{document}',
    trimmedBody,
    '\\end{document}',
  ].join('\n'));
}

function buildLatexCandidates(rawCode = '') {
  const normalized = escapeLoosePercentSigns(normalizeLatexText(sanitizeLatexDocument(rawCode)));
  if (!normalized) return [];
  const asciiNormalized = toAsciiLatexText(normalized);

  const candidates = [];
  const seen = new Set();
  const push = value => {
    const candidate = String(value || '').trim();
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    candidates.push(candidate);
  };

  push(injectLatexTheme(normalized));
  if (asciiNormalized !== normalized) {
    push(injectLatexTheme(asciiNormalized));
  }

  const tikzMatch = normalized.match(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/);
  if (tikzMatch) {
    push(wrapLatexDocument(tikzMatch[0]));
  }

  const axisMatch = normalized.match(/\\begin\{axis\}[\s\S]*?\\end\{axis\}/);
  if (axisMatch) {
    push(wrapLatexDocument(`\\begin{tikzpicture}\n${axisMatch[0]}\n\\end{tikzpicture}`));
  }

  if (!/\\documentclass\b/.test(normalized)) {
    push(wrapLatexDocument(normalized));
    if (asciiNormalized !== normalized) {
      push(wrapLatexDocument(asciiNormalized));
    }
  } else {
    let repaired = normalized;
    if (!/\\usepackage\{pgfplots\}/.test(repaired)) {
      repaired = repaired.replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}\s*/, match => `${match}\n\\usepackage{pgfplots}\n`);
    }
    if (!/\\usepackage\{xcolor\}/.test(repaired)) {
      repaired = repaired.replace(/\\usepackage\{pgfplots\}\s*/, match => `${match}\\usepackage{xcolor}\n`);
    }
    if (!/\\pgfplotsset\{compat=/.test(repaired)) {
      repaired = repaired.replace(/\\usepackage\{xcolor\}\s*/, match => `${match}\\pgfplotsset{compat=1.18}\n`);
      if (!/\\pgfplotsset\{compat=/.test(repaired)) {
        repaired = repaired.replace(/\\usepackage\{pgfplots\}\s*/, match => `${match}\\pgfplotsset{compat=1.18}\n`);
      }
    }
    if (!/\\begin\{document\}/.test(repaired)) {
      repaired = repaired.replace(/(\\pgfplotsset\{compat=[^}]+\}\s*)/, '$1\\begin{document}\n');
      if (!/\\begin\{document\}/.test(repaired)) {
        repaired += '\n\\begin{document}\n';
      }
    }
    if (!/\\end\{document\}/.test(repaired)) {
      repaired += '\n\\end{document}';
    }
    push(injectLatexTheme(repaired));
    if (asciiNormalized !== normalized) {
      let asciiRepaired = asciiNormalized;
      if (!/\\usepackage\{pgfplots\}/.test(asciiRepaired)) {
        asciiRepaired = asciiRepaired.replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}\s*/, match => `${match}\n\\usepackage{pgfplots}\n`);
      }
      if (!/\\usepackage\{xcolor\}/.test(asciiRepaired)) {
        asciiRepaired = asciiRepaired.replace(/\\usepackage\{pgfplots\}\s*/, match => `${match}\\usepackage{xcolor}\n`);
      }
      if (!/\\pgfplotsset\{compat=/.test(asciiRepaired)) {
        asciiRepaired = asciiRepaired.replace(/\\usepackage\{xcolor\}\s*/, match => `${match}\\pgfplotsset{compat=1.18}\n`);
        if (!/\\pgfplotsset\{compat=/.test(asciiRepaired)) {
          asciiRepaired = asciiRepaired.replace(/\\usepackage\{pgfplots\}\s*/, match => `${match}\\pgfplotsset{compat=1.18}\n`);
        }
      }
      if (!/\\begin\{document\}/.test(asciiRepaired)) {
        asciiRepaired = asciiRepaired.replace(/(\\pgfplotsset\{compat=[^}]+\}\s*)/, '$1\\begin{document}\n');
        if (!/\\begin\{document\}/.test(asciiRepaired)) {
          asciiRepaired += '\n\\begin{document}\n';
        }
      }
      if (!/\\end\{document\}/.test(asciiRepaired)) {
        asciiRepaired += '\n\\end{document}';
      }
      push(injectLatexTheme(asciiRepaired));
    }
  }

  return candidates;
}

async function compileWithTexlive(code) {
  const form = new FormData();
  form.append('engine', 'lualatex');
  form.append('return', 'pdf');
  form.append('filename[]', 'document.tex');
  form.append('filecontents[]', code);
  const upstream = await fetch('https://texlive.net/cgi-bin/latexcgi', {
    method: 'POST',
    body: form,
  });
  const contentType = upstream.headers.get('content-type') || 'text/plain; charset=utf-8';

  if (contentType.startsWith('image/') || contentType.includes('pdf')) {
    return {
      ok: true,
      status: upstream.status,
      contentType,
      buffer: Buffer.from(await upstream.arrayBuffer()),
    };
  }

  return {
    ok: false,
    status: upstream.status,
    contentType,
    text: await upstream.text(),
  };
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
      const candidates = buildLatexCandidates(code);
      let result = null;
      let lastFailure = null;

      for (const candidate of candidates) {
        result = await compileWithTexlive(candidate);
        if (result.ok) {
          res.status(result.status);
          res.setHeader('Content-Type', result.contentType);
          return res.send(result.buffer);
        }
        lastFailure = result;
      }

      return res.status(422).json({
        error: 'Falha ao compilar o grafico LaTeX',
        details: String(lastFailure?.text || 'Compilacao LaTeX falhou sem detalhes.').slice(0, 1600),
      });
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
  res.json({ status: 'OK', version: packageJson.version });
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Drekee AI 1.5 Pro running on http://localhost:${PORT}`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/api/chat`);
});
