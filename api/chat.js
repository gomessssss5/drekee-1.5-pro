// Drekee AI 1.5 Pro - Cientific Agent
// Fluxo: GeneratePlan -> Research/Reasoning -> Review -> Retornar logs + resposta + mídia

const SCIENCE_SYSTEM_PROMPT = `Você é o Drekee AI 1.5 Pro, um agente científico avançado.

Seu objetivo é fornecer respostas científicas confiáveis, claras e acessíveis.

Diretrizes:
- Baseie respostas em conhecimento científico consolidado
- Evite especulações; deixe claro quando há incerteza
- Não invente dados, estudos ou fontes
- Priorize explicações corretas, mesmo simplificadas
- Seja didático e acessível
- Organize respostas de forma clara
- Mencione a área científica envolvida
- Indique nível de confiança (ALTO/MÉDIO/BAIXO)
`;

// ============ TAVILY API (Web Search) ============
async function searchTavily(query) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 5,
        include_answer: true,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return {
      query,
      answer: data.answer,
      results: data.results?.slice(0, 3).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
      })) || [],
    };
  } catch (err) {
    console.error('Tavily search error:', err);
    return null;
  }
}

// ============ NASA Image/Video Library (search) ============
async function searchNasaMedia(query) {
  if (!query) return null;

  try {
    const res = await fetch(`https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=image,video`);
    if (!res.ok) return null;
    const json = await res.json();
    const items = json?.collection?.items || [];

    const media = items
      .slice(0, 8)
      .map(item => {
        const data = item.data?.[0] || {};
        const links = item.links || [];

        const firstLink = links.find(l => l.href);
        const imageLink = links.find(l =>
          (l.render && l.render.toLowerCase().includes('image')) ||
          (l.rel && l.rel.toLowerCase().includes('preview')) ||
          (l.href && l.href.match(/\.(jpe?g|png|gif|webp)$/i))
        )?.href;
        const videoLink = links.find(l =>
          (l.render && l.render.toLowerCase().includes('video')) ||
          (l.rel && l.rel.toLowerCase().includes('enclosure')) ||
          (l.href && l.href.match(/\.mp4($|\?)/i))
        )?.href;

        const url = imageLink || videoLink || firstLink?.href || item.href;
        const mediaType = (videoLink || (url && url.match(/\.mp4($|\?)/i))) ? 'video' : 'image';

        return {
          title: data.title,
          description: data.description || data.photographer || '',
          date: data.date_created,
          url,
          media_type: mediaType,
        };
      })
      .filter(m => m.url);

    return media;
  } catch (err) {
    console.error('NASA media search error:', err);
    return null;
  }
}

// ============ GROQ Call (flexible) ============
async function callGroq(messages, apiKeyVar = 'GROQ_API_KEY_1', options = {}) {
  const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  const apiKey = process.env[apiKeyVar] || process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error(`${apiKeyVar} not configured`);

  const model = options.model || 'llama-3.3-70b-versatile';
  const maxTokens = options.maxTokens || 1000;
  const temperature = options.temperature !== undefined ? options.temperature : 0.3;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`GROQ error ${res.status}: ${JSON.stringify(json)}`);
  }

  return json.choices?.[0]?.message?.content || null;
}

// ============ GEMINI Call (Review) ============
async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 800,
      },
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Gemini error ${res.status}: ${JSON.stringify(json)}`);
  }

  return json.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

// ============ STEP 1: Generate Action Plan (internal) ============
async function generateActionPlan(userQuestion) {
  const prompt = `Você é um planejador científico. Para a pergunta, crie um plano de ação:

Pergunta: "${userQuestion}"

Retorne APENAS JSON válido (sem markdown):
{
  "objetivo": "Descrição clara do que responder",
  "area_cientifica": "Área(s) científica(s) envolvida(s)",
  "passos": [
    {
      "numero": 1,
      "nome": "Nome do passo",
      "descricao": "O que será feito"
    }
  ],
  "precisa_busca_web": true/false
}`;

  const response = await callGroq(
    [{ role: 'user', content: prompt }],
    'GROQ_API_KEY_2',
    { maxTokens: 800, temperature: 0.2 }
  );

  try {
    return JSON.parse(response);
  } catch (e) {
    console.error('Plan parse error:', e);
    return {
      objetivo: 'Responder à pergunta',
      area_cientifica: 'Geral',
      passos: [{ numero: 1, nome: 'Responder', descricao: 'Gerar uma resposta clara e precisa' }],
      precisa_busca_web: true,
    };
  }
}

// ============ STEP 2: Execute Research & Reasoning ============
async function executeAgentPlan(userQuestion, actionPlan, logs, options = {}) {
  const useNasa = options.useNasa === true;

  logs.push('🧠 Iniciando raciocínio (processo interno)');

  let context = '';
  let nasaMedia = [];

  if (actionPlan?.precisa_busca_web) {
    logs.push('🌐 Buscando na web (Tavily)...');
    const searchResult = await searchTavily(userQuestion);
    if (searchResult) {
      context += `\n\n📰 Resultados de busca web:\n`;
      context += `Resposta resumida: ${searchResult.answer}\n\n`;
      searchResult.results.forEach((r, i) => {
        context += `${i + 1}. ${r.title}\n   ${r.snippet}\n   Link: ${r.url}\n`;
      });
      logs.push('✅ Dados da web coletados');
    } else {
      logs.push('⚠️ Tavily API não disponível');
    }
  }

  if (useNasa) {
    logs.push('🚀 Buscando mídia da NASA...');
    let results = await searchNasaMedia(userQuestion);

    // Alguns termos em português retornam poucos resultados; tente fallback em inglês.
    if (!results || results.length === 0) {
      logs.push('🔁 Nenhum resultado encontrado com a busca original; tentando busca em inglês...');
      results = await searchNasaMedia('nasa latest images');
    }

    if (results && results.length > 0) {
      nasaMedia = results;
      context += `\n\n🔭 Resultados da NASA (imagens/vídeos):\n`;
      results.slice(0, 5).forEach((item, i) => {
        context += `${i + 1}. ${item.title} - ${item.url}\n`;
      });
      logs.push('✅ Dados da NASA coletados');
    } else {
      logs.push('⚠️ Nenhum resultado da NASA encontrado');
    }
  }

  logs.push('🧠 Processando e raciocinando...');

  const executionPrompt = `${SCIENCE_SYSTEM_PROMPT}

CONTEXTO PESQUISADO:
${context || 'Nenhum contexto externo necessário'}

PERGUNTA DO USUÁRIO: "${userQuestion}"

Siga EXATAMENTE este processo:
1. Entenda profundamente a pergunta.
2. Organize seu raciocínio de forma clara e didática.
3. Inclua informações factuais e, se disponível, use dados da NASA (quando solicitados).
4. Evite generalidades, seja direto e confiável.
5. Ao final, inclua apenas a tag: [CONFIANÇA: ALTO/MÉDIO/BAIXO]

Seja honesto e preciso. Não especule.`;

  const response = await callGroq(
    [{ role: 'user', content: executionPrompt }],
    'GROQ_API_KEY_1',
    { maxTokens: 1200, temperature: 0.2 }
  );

  logs.push('✅ Resposta gerada pela IA principal');
  return { response, media: nasaMedia };
}

// ============ STEP 3: Review with Gemini ============
async function reviewResponse(response) {
  const reviewPrompt = `Você é um revisor científico experiente. Recebeu a resposta abaixo para revisão.

Objetivo:
- Corrigir erros factuais
- Melhorar clareza e didatismo
- Manter o conteúdo o mais direto possível

REGRAS CRUCIAIS (RESPEITE 100%):
1) Retorne APENAS a resposta final para o usuário. NADA mais.
2) NÃO inclua nenhum texto como "Como revisor...", "Observação:", ou explicações sobre o processo de revisão.
3) NÃO inclua títulos, cabeçalhos ou listas de etapas. Apenas texto fluido.
4) Ao final, inclua SOMENTE a tag de confiança no formato: [CONFIANÇA: ALTO/MÉDIO/BAIXO]
5) Se não for possível afirmar com certeza, seja honesto e explique por que.

RESPOSTA A REVISAR:
${response}
`;

  return await callGemini(reviewPrompt);
}

// ============ EXTRACT CONFIDENCE ============
function extractConfidenceLevel(response) {
  const match = response.match(/\[CONFIANÇA:\s*(ALTO|MÉDIO|BAIXO)\]/i);
  if (match) return match[1].toUpperCase();
  return 'MÉDIO';
}

// ============ MAIN HANDLER ============
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

  const userQuestion = (body?.text || '').toString().trim();
  const useNasa = Boolean(body?.nasa);

  if (!userQuestion) {
    return res.status(400).json({ error: 'Pergunta vazia' });
  }

  const logs = [];

  try {
    logs.push('🚀 Iniciando Agente Científico...');

    const actionPlan = await generateActionPlan(userQuestion);

    const exec = await executeAgentPlan(userQuestion, actionPlan, logs, { useNasa });

    logs.push('👁️ Revisando resposta com Gemini...');
    let response = await reviewResponse(exec.response);
    logs.push('✅ Resposta revisada e validada');

    response = response.replace(/^Como\s+Revisor[\s\S]*?\n/, '').trim();
    const displayResponse = response.replace(/\s*\[CONFIANÇA:\s*\w+\]\s*$/i, '').trim();

    return res.status(200).json({
      response: displayResponse || 'Desculpe, não consegui gerar uma resposta confiável.',
      logs,
      media: exec.media || [],
    });
  } catch (err) {
    console.error('Agent error:', err);
    logs.push(`❌ Erro: ${err.message}`);

    return res.status(200).json({
      response: 'Desculpe, não consegui processar sua solicitação agora. Tente novamente em alguns instantes.',
      error: err.message,
      logs,
      media: [],
    });
  }
}

module.exports = handler;
