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
  '\\definecolor{chatgpt_color}{RGB}{124,169,153}',
  '\\definecolor{gemini_color}{RGB}{66,133,244}',
  '\\definecolor{drekee_color}{RGB}{255,153,0}',
  '\\definecolor{graph_grid}{RGB}{214,220,230}',
  '\\pgfplotsset{',
  '  drekee premium/.style={',
  '    width=16cm,',
  '    height=9cm,',
  '    enlarge x limits=0.15,',
  '    ymajorgrids=true,',
  '    grid style={dashed, draw=graph_grid},',
  '    axis line style={draw=black!68},',
  '    tick style={draw=black!68},',
  '    tick label style={font=\\small},',
  '    label style={font=\\bfseries\\small},',
  '    title style={font=\\bfseries\\normalsize, align=center},',
  '    nodes near coords,',
  '    nodes near coords align={vertical},',
  '    every node near coord/.append style={font=\\footnotesize, /pgf/number format/fixed},',
  '    bar width=18pt,',
  '    legend style={at={(0.5,-0.15)}, anchor=north, legend columns=-1, draw=none, /tikz/every even column/.append style={column sep=15pt}}',
  '  },',
  '  every axis/.append style={drekee premium},',
  '  cycle list={',
  '    {fill=chatgpt_color, draw=chatgpt_color!70!black},',
  '    {fill=gemini_color, draw=gemini_color!70!black},',
  '    {fill=drekee_color, draw=drekee_color!70!black}',
  '  }',
  '}',
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
