// Vercel Serverless function for Drekee AI 1.5 Pro
// Supports: Groq (text), Gemini (files), NASA data enrichment, and Groq key failover.

const SCIENCE_SYSTEM_PROMPT = `Você é o Drekee AI 1.5 Pro, um assistente de inteligência artificial especializado em ciência.

Seu objetivo é fornecer respostas científicas confiáveis, claras e acessíveis ao usuário, contribuindo para a democratização do conhecimento científico.

Diretrizes:
- Baseie suas respostas em conhecimento científico consolidado
- Evite especulações e deixe claro quando algo não for totalmente certo
- Não invente dados, estudos ou fontes
- Priorize explicações corretas, mesmo que simplificadas

Estilo de resposta:
- Seja didático e fácil de entender
- Adapte a linguagem para diferentes níveis (iniciante até avançado)
- Use exemplos práticos do dia a dia sempre que possível
- Organize a resposta de forma clara (parágrafos ou tópicos)

Confiabilidade:
- Sempre que possível, mencione áreas científicas envolvidas (ex: física, biologia)
- Indique o nível de confiança da resposta (alto, médio ou baixo)

Comportamento:
- Se a pergunta não for científica, tente relacionar com ciência
- Se não souber a resposta, diga claramente
- Evite opiniões pessoais ou achismos

Seu foco principal é ajudar o usuário a entender ciência de forma confiável, simples e útil para a vida real.`;

function isSpaceRelated(text) {
  if (!text) return false;
  const normalized = text.toLowerCase();
  const keywords = [
    'espaço', 'planeta', 'astron', 'galáx', 'estrela', 'lua', 'sol', 'meteoro', 'cometa', 'orbita', 'nasa', 'astronomia'
  ];
  return keywords.some(k => normalized.includes(k));
}

async function fetchNasaInfo() {
  const key = process.env.NASA_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch(`https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: data.title,
      date: data.date,
      explanation: data.explanation,
      url: data.url,
      media_type: data.media_type,
    };
  } catch (err) {
    console.error('NASA fetch error', err);
    return null;
  }
}

function buildPrompt({ userText, nasaData, files }) {
  let prompt = `${SCIENCE_SYSTEM_PROMPT}\n\n`;

  if (nasaData) {
    prompt += `Dados da NASA (APOD):\n`;
    prompt += `Título: ${nasaData.title}\n`;
    prompt += `Data: ${nasaData.date}\n`;
    prompt += `Descrição: ${nasaData.explanation}\n`;
    prompt += `URL: ${nasaData.url}\n\n`;
  }

  if (files?.length) {
    prompt += `O usuário enviou ${files.length} arquivo(s). `;
    prompt += `Listei os nomes abaixo e use essas informações para orientar a resposta (não é necessário ler o conteúdo completo, apenas referencia):\n`;
    prompt += files.map((f, idx) => `  ${idx + 1}. ${f.name} (${f.type || 'desconhecido'}, ${f.size || 'tamanho desconhecido'})`).join('\n');
    prompt += `\n\n`;
  }

  prompt += `Pergunta do usuário:\n${userText}`;
  return prompt;
}

function extractTextFromAIResponse(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractTextFromAIResponse(item);
      if (extracted) return extracted;
    }
    return null;
  }
  if (typeof value === 'object') {
    // Specific handling for OpenAI-compatible responses (e.g., Groq /chat/completions).
    if (value.choices && Array.isArray(value.choices) && value.choices[0]?.message?.content) {
      return value.choices[0].message.content;
    }
    if (value.choices && Array.isArray(value.choices) && value.choices[0]?.text) {
      return value.choices[0].text;
    }

    // Prefer common text fields.
    const priority = ['output_text', 'text', 'content', 'message', 'response', 'output', 'result'];
    for (const key of priority) {
      if (key in value) {
        const extracted = extractTextFromAIResponse(value[key]);
        if (extracted) return extracted;
      }
    }

    // Fallback: search all values.
    for (const val of Object.values(value)) {
      const extracted = extractTextFromAIResponse(val);
      if (extracted) return extracted;
    }
  }

  return null;
}

async function callGroq(prompt) {
  // Note: Groq uses an OpenAI-compatible endpoint. See https://console.groq.com/docs/
  const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  // Prefer a Llama model that is strong and reasonably cost-effective.
  // You can override via env var GROQ_MODEL.
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 600,
    temperature: 0.2,
  };

  // Support both GROQ_API_KEY (single key) and GROQ_API_KEY_1 / GROQ_API_KEY_2 (multiple keys).
  const keys = [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_1, process.env.GROQ_API_KEY_2].filter(Boolean);
  if (!keys.length) throw new Error('GROQ API key(s) not configured');

  let lastError;
  for (const key of keys) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      let candidate = extractTextFromAIResponse(json);

      // If the response is a JSON object but no text was found, fall back to a safe string.
      if (!candidate && json) {
        candidate = JSON.stringify(json, null, 2);
      }

      if (res.ok && candidate) {
        return candidate;
      }

      // If this key is rate limited/quota, try the next one.
      if (res.status === 429 || res.status === 403) {
        lastError = new Error(`GROQ key fail (${res.status}): ${JSON.stringify(json)}`);
        continue;
      }

      // Any other error: stop and return the message (it will be handled upstream)
      lastError = new Error(`GROQ error ${res.status}: ${JSON.stringify(json)}`);
      break;
    } catch (err) {
      lastError = err;
      continue;
    }
  }

  throw lastError || new Error('GROQ request failed');
}

async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not configured');

  const endpoint = 'https://gemini.googleapis.com/v1/models/gemini-2.5-flash:generate';

  const body = {
    prompt: { text: prompt },
    temperature: 0.2,
    max_output_tokens: 1024,
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Gemini error ${res.status}: ${JSON.stringify(json)}`);
  }

  // The response may vary depending on API version. Attempt to extract plain text.
  const candidate =
    json?.candidates?.[0]?.content ||
    json?.output?.[0]?.content ||
    json?.text ||
    json?.result?.[0]?.content ||
    null;

  if (!candidate) {
    throw new Error(`Gemini did not return text: ${JSON.stringify(json)}`);
  }

  return candidate;
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body;
  try {
    body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const text = (body?.text || '').toString().trim();
  const files = Array.isArray(body?.files) ? body.files : [];

  if (!text && !files.length) {
    return res.status(400).json({ error: 'Mensagem vazia' });
  }

  const useNasa = isSpaceRelated(text);
  const nasaData = useNasa ? await fetchNasaInfo() : null;

  const prompt = buildPrompt({ userText: text, nasaData, files });

  try {
    const isFileMessage = files.length > 0;
    const responseText = isFileMessage
      ? await callGemini(prompt)
      : await callGroq(prompt);

    return res.status(200).json({ response: responseText });
  } catch (err) {
    console.error('AI request failed', err);
    return res.status(200).json({
      response: 'Desculpe, não consegui processar sua solicitação agora. Tente novamente em alguns instantes.',
      error: err?.message || String(err),
    });
  }
}

module.exports = handler;
