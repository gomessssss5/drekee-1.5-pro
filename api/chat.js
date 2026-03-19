// Drekee AI 1.5 Pro - Scientific Agent with multi-stage reasoning
// Flow: GeneratePlan → ResearchExecution → ReviewValidation → ReturnWithLogs

const SCIENCE_SYSTEM_PROMPT = `Você é o Drekee AI 1.5 Pro, um agente científico avançado.

Seu objetivo é fornecer respostas científicas confiáveis, claras e acessíveis.

Diretrizes:
- Baseie respostas em conhecimento científico consolidado
- Evite especulações, deixe claro quando há incerteza
- Não invente dados, estudos ou fontes
- Priorize explicações corretas, mesmo simplificadas
- Seja didático e acessível
- Organize respostas de forma clara
- Mencione áreas científicas envolvidas
- Indique nível de confiança (ALTO/MÉDIO/BAIXO)`;

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

// ============ NASA API ============
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
    };
  } catch (err) {
    console.error('NASA fetch error:', err);
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

// ============ STEP 1: Generate Action Plan ============
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
  "precisa_busca_web": true/false,
  "precisa_nasa": true/false
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
      passos: [{ numero: 1, nome: 'Pesquisa', descricao: 'Pesquisar a resposta' }],
      precisa_busca_web: true,
      precisa_nasa: false,
    };
  }
}

// ============ STEP 2: Execute Research & Reasoning ============
async function executeAgentPlan(userQuestion, actionPlan, logs) {
  logs.push('📋 Plano de ação gerado');
  logs.push(`🎯 Objetivo: ${actionPlan.objetivo}`);
  logs.push(`🔬 Área: ${actionPlan.area_cientifica}`);

  let context = '';

  // Search Tavily if needed
  if (actionPlan.precisa_busca_web) {
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

  // Search NASA if space-related
  if (actionPlan.precisa_nasa) {
    logs.push('🚀 Buscando dados da NASA...');
    const nasaData = await fetchNasaInfo();
    if (nasaData) {
      context += `\n\n🔭 Dados NASA (APOD):\n${nasaData.title}\nData: ${nasaData.date}\nExplicação: ${nasaData.explanation}`;
      logs.push('✅ Dados da NASA coletados');
    } else {
      logs.push('⚠️ NASA API não disponível');
    }
  }

  // Execute reasoning with context
  logs.push('🧠 Processando e raciocinando...');
  const executionPrompt = `${SCIENCE_SYSTEM_PROMPT}

CONTEXTO PESQUISADO:
${context || 'Nenhum contexto externo necessário'}

PERGUNTA DO USUÁRIO: "${userQuestion}"

Siga EXATAMENTE este processo:
1. Entenda profundamente a pergunta
2. Identifique a área científica principal
3. Analise o contexto pesquisado se disponível
4. Raciocine com base em FATOS consolidados
5. Organize a resposta clara e didaticamente
6. AO FINAL, indique: [CONFIANÇA: ALTO/MÉDIO/BAIXO]

Seja honesto e preciso. Não especule.`;

  const response = await callGroq(
    [{ role: 'user', content: executionPrompt }],
    'GROQ_API_KEY_1',
    { maxTokens: 1200, temperature: 0.2 }
  );

  logs.push('✅ Resposta gerada pela IA principal');
  return response;
}

// ============ STEP 3: Review with Gemini ============
async function reviewResponse(response) {
  const reviewPrompt = `REVISOR CIENTÍFICO: Analise e melhore a resposta.

VERIFICAR:
- Erros científicos
- Informações incorretas
- Clareza e didatismo
- Manter [CONFIANÇA: ...] no final

RESPOSTA A REVISAR:
${response}

RETORNAR: Resposta revisada e melhorada, mantendo estrutura e tags.`;

  return await callGemini(reviewPrompt);
}

// ============ Extract Confidence Level ============
function extractConfidenceLevel(response) {
  const match = response.match(/\[CONFIANÇA:\s*(ALTO|MÉDIO|BAIXO)\]/i);
  if (match) {
    return match[1].toUpperCase();
  }
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
  if (!userQuestion) {
    return res.status(400).json({ error: 'Pergunta vazia' });
  }

  const logs = [];

  try {
    logs.push('🚀 Iniciando Agente Científico...');

    // Step 1: Generate Action Plan
    const actionPlan = await generateActionPlan(userQuestion);

    // Step 2: Execute Research & Reasoning
    let response = await executeAgentPlan(userQuestion, actionPlan, logs);

    // Step 3: Review with Gemini
    logs.push('👁️ Revisando resposta com Gemini...');
    response = await reviewResponse(response);
    logs.push('✅ Resposta revisada e validada');

    // Extract confidence
    const confidence = extractConfidenceLevel(response);
    
    // Clean confidence tag from display
    const displayResponse = response.replace(/\s*\[CONFIANÇA:\s*\w+\]\s*$/i, '').trim();

    return res.status(200).json({
      response: displayResponse,
      actionPlan,
      logs,
      confidence,
    });
  } catch (err) {
    console.error('Agent error:', err);
    logs.push(`❌ Erro: ${err.message}`);
    
    return res.status(200).json({
      response: 'Desculpe, não consegui processar sua solicitação agora. Tente novamente em alguns instantes.',
      error: err.message,
      logs,
      confidence: 'BAIXO',
      actionPlan: null,
    });
  }
}

module.exports = handler;
