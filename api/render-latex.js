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

const DREKEE_LATEX_THEME = [
  '\\definecolor{drekeeBlue}{RGB}{66,133,244}',
  '\\definecolor{drekeeMint}{RGB}{124,169,153}',
  '\\definecolor{drekeeSun}{RGB}{255,153,0}',
  '\\definecolor{drekeeRose}{RGB}{214,92,122}',
  '\\definecolor{drekeeSlate}{RGB}{56,68,87}',
  '\\pgfplotsset{',
  '  drekee axis/.style={',
  '    width=16cm,',
  '    height=9cm,',
  '    enlarge x limits=0.16,',
  '    ymajorgrids=true,',
  '    grid style={dashed, draw=drekeeSlate!24},',
  '    axis line style={draw=drekeeSlate!58},',
  '    tick style={draw=drekeeSlate!58},',
  '    tick label style={font=\\small, text=black!80},',
  '    label style={font=\\bfseries\\small, text=black!82},',
  '    title style={font=\\bfseries\\large, text=black!94, align=center},',
  '    legend style={at={(0.5,-0.17)}, anchor=north, legend columns=-1, draw=none, font=\\small, /tikz/every even column/.append style={column sep=12pt}},',
  '    every axis plot/.append style={line width=1.35pt},',
  '    cycle list={',
  '      {fill=drekeeMint, draw=drekeeMint!70!black, color=drekeeMint!70!black, mark=*},',
  '      {fill=drekeeBlue, draw=drekeeBlue!70!black, color=drekeeBlue!74!black, mark=square*},',
  '      {fill=drekeeSun, draw=drekeeSun!70!black, color=drekeeSun!78!black, mark=triangle*},',
  '      {fill=drekeeRose, draw=drekeeRose!70!black, color=drekeeRose!78!black, mark=diamond*}',
  '    }',
  '  },',
  '  every axis/.append style={drekee axis}',
  '}',
].join('\n');

function injectLatexTheme(documentCode = '') {
  let themed = String(documentCode || '').trim();
  if (!themed || /\\definecolor\{drekeeBlue\}/.test(themed)) return themed;

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
  const normalized = normalizeLatexText(sanitizeLatexDocument(rawCode));
  if (!normalized) return [];

  const candidates = [];
  const seen = new Set();
  const push = value => {
    const candidate = String(value || '').trim();
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    candidates.push(candidate);
  };

  push(injectLatexTheme(normalized));

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

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});

    const code = sanitizeLatexDocument(body.code || '');
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
    console.error('render-latex API error:', error);
    return res.status(500).json({ error: 'Failed to render LaTeX graph' });
  }
}

module.exports = handler;
