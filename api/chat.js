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

// ============ OPTIMIZE QUERY WITH AI (for better NASA search) ============
async function optimizeNasaQuery(userQuestion) {
  const prompt = `Você é um especialista em otimizar buscas científicas para APIs.\n\nTransforme a pergunta do usuário em palavras-chave específicas para buscar imagens científicas na NASA.\n\nPergunta: "${userQuestion}"\n\nRetorne APENAS palavras-chave separadas por espaço (máximo 5 palavras).\nExemplos:\n- "Quais são as estruturas de Marte?" → "mars surface structures"\n- "Me mostre fotos de buracos negros" → "black hole galaxy"\n- "Imagens de auroras" → "aurora northern lights"\n\nRetorne apenas as palavras-chave, nada mais.`;

  try {
    const result = await callGroq(
      [{ role: 'user', content: prompt }],
      'GROQ_API_KEY_1',
      { maxTokens: 50, temperature: 0.3 }
    );
    return result.trim();
  } catch (err) {
    console.error('Query optimization error:', err);
    return userQuestion;
  }
}

// ============ FILTER NASA RESULTS BY RELEVANCE ============
function filterNasaResultsByRelevance(results, originalQuery) {
  if (!results || results.length === 0) return [];

  const lowerQuery = originalQuery.toLowerCase();
  const keywords = lowerQuery.split(/\s+/).filter(w => w.length > 3);

  const scored = results.map(item => {
    let score = 0;
    const titleLower = (item.title || '').toLowerCase();
    const descLower = (item.description || '').toLowerCase();

    if (titleLower.includes(lowerQuery)) score += 10;
    if (descLower.includes(lowerQuery)) score += 5;

    keywords.forEach(keyword => {
      if (titleLower.includes(keyword)) score += 3;
      if (descLower.includes(keyword)) score += 1;
    });

    if (titleLower.includes('video') || titleLower.includes('b-roll')) score -= 2;
    if (titleLower.includes('animation') || titleLower.includes('3d')) score -= 1;
    if (item.description && item.description.length > 50) score += 2;

    return { ...item, relevanceScore: score };
  });

  return scored
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .filter(item => item.relevanceScore > 0)
    .map(({ relevanceScore, ...item }) => item)
    .slice(0, 12);
}

// ============ SELECT BEST RESULTS WITH AI ============
async function selectBestNasaResults(results, userQuestion) {
  if (!results || results.length === 0) return [];
  if (results.length <= 3) return results;

  const topResults = results.slice(0, 8);
  const resultsList = topResults
    .map((r, i) => `${i + 1}. ${r.title}\n   Descrição: ${r.description || 'N/A'}`)
    .join('\n\n');

  const prompt = `Você é um assistente especializado em seleção de conteúdo científico.\n\nPergunta: "${userQuestion}"\n\nOPÇÕES:\n${resultsList}\n\nSelecione os 3-4 resultados MAIS relevantes.\nRetorne APENAS os números separados por vírgula (ex: 1,3,5).`;

  try {
    const selection = await callGroq(
      [{ role: 'user', content: prompt }],
      'GROQ_API_KEY_1',
      { maxTokens: 20, temperature: 0.1 }
    );

    const numbers = selection
      .split(/[,;]|\s+/)
      .map(n => parseInt(n.trim()))
      .filter(n => n > 0 && n <= topResults.length);

    if (numbers.length > 0) {
      return numbers.map(idx => topResults[idx - 1]);
    }

    return topResults.slice(0, 3);
  } catch (err) {
    console.error('Result selection error:', err);
    return topResults.slice(0, 3);
  }
}

// ============ TRANSLATE PORTUGUESE TO ENGLISH (Science Terms) ============
function translateNasaQuery(query) {
  const translations = {
    'moon': 'moon', 'mars': 'mars', 'sun': 'sun', 'galaxy': 'galaxy',
    'lua': 'moon', 'marte': 'mars', 'sol': 'sun', 'galáxia': 'galaxy',
    'imagem': 'image', 'telescópio': 'telescope', 'satélite': 'satellite',
    'planeta': 'planet', 'estrela': 'star', 'buraco negro': 'black hole',
    'nebulosa': 'nebula', 'cometa': 'comet', 'asteroide': 'asteroid',
    'eclipse': 'eclipse', 'aurora': 'aurora', 'vulcão': 'volcano',
    'cratera': 'crater', 'superfície': 'surface', 'atmosfera': 'atmosphere',
    'espaço': 'space', 'universo': 'universe', 'cosmologia': 'cosmology',
    'astrofísica': 'astrophysics', 'astrologia': 'astronomy',
    'estrutura': 'structure', 'fenômeno': 'phenomenon',
  };

  const lowerQuery = query.toLowerCase();
  let translated = query;

  for (const [pt, en] of Object.entries(translations)) {
    if (lowerQuery.includes(pt)) {
      translated = translated.replace(new RegExp(pt, 'gi'), en);
    }
  }

  return translated;
}

// ============ NASA Image/Video Library (search) ============
async function searchNasaMedia(query) {
  if (!query) return null;

  try {
    // Translate query to English if needed
    const translatedQuery = translateNasaQuery(query);

    // Build NASA API URL with better parameters
    let searchUrl = `https://images-api.nasa.gov/search?` +
      `q=${encodeURIComponent(translatedQuery)}&` +
      `media_type=image,video&` +
      `page_size=50`; // Request 50 results (API limit friendly)

    const res = await fetch(searchUrl);
    if (!res.ok) return null;
    const json = await res.json();
    const items = json?.collection?.items || [];

    if (items.length === 0) return null;

    // Process and deduplicate by URL
    const seenUrls = new Set();
    const media = [];

    for (const item of items) {
      if (media.length >= 12) break; // Limit to 12 results max

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
      if (!url || seenUrls.has(url)) continue; // Skip duplicates

      seenUrls.add(url);
      const mediaType = (videoLink || (url && url.match(/\.mp4($|\?)/i))) ? 'video' : 'image';

      media.push({
        title: data.title || 'NASA Image',
        description: data.description || data.photographer || `Related to: ${translatedQuery}`,
        date: data.date_created,
        url,
        media_type: mediaType,
      });
    }

    return media.length > 0 ? media : null;
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
  const maxTokens = options.maxTokens || 4096;
  const temperature = options.temperature !== undefined ? options.temperature : 0.25;

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
        maxOutputTokens: 3500,
      },
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Gemini error ${res.status}: ${JSON.stringify(json)}`);
  }

  return json.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

// ============ ANALYZE NASA IMAGES (First 4 with GROQ_API_KEY_2) ============
async function analyzeNasaImagesWithGroq(nasaMedia) {
  if (!nasaMedia || nasaMedia.length === 0) return null;

  // Selecionar as 4 PRIMEIRAS imagens
  const firstFourImages = nasaMedia.slice(0, 4);
  const validImages = firstFourImages.filter(m => m.media_type === 'image' && m.url);

  if (validImages.length === 0) return null;

  const imageList = validImages
    .map((img, i) => `${i + 1}. ${img.title}\n   Descrição: ${img.description}\n   URL: ${img.url}`)
    .join('\n\n');

  const prompt = `Você é um especialista em análise de imagens científicas.

IMAGENS FORNECIDAS:
${imageList}

TASK: Analise APENAS o conteúdo visual dessas imagens. Descreva:
- O que cada imagem mostra (objetos, fenômenos, estruturas)
- Contexto científico (se aparente)
- Detalhes relevantes

Sejam descritivos mas concisos. Retorne apenas as descrições das imagens.`;

  try {
    const response = await callGroq(
      [{ role: 'user', content: prompt }],
      'GROQ_API_KEY_2',
      { model: 'meta-llama/llama-4-scout-17b-16e-instruct', maxTokens: 1500, temperature: 0.2 }
    );
    return response;
  } catch (err) {
    console.error('Groq image analysis error:', err);
    return null;
  }
}

// ============ ANALYZE NASA IMAGES (Last 4 with GEMINI) ============
async function analyzeNasaImagesWithGemini(nasaMedia) {
  if (!nasaMedia || nasaMedia.length === 0) return null;

  // Selecionar as 4 ÚLTIMAS imagens
  const lastFourImages = nasaMedia.slice(-4);
  const validImages = lastFourImages.filter(m => m.media_type === 'image' && m.url);

  if (validImages.length === 0) return null;

  const imageList = validImages
    .map((img, i) => `${i + 1}. ${img.title}\n   Descrição: ${img.description}\n   URL: ${img.url}`)
    .join('\n\n');

  const prompt = `Você é um especialista em análise de imagens científicas.

IMAGENS FORNECIDAS:
${imageList}

TASK: Analise APENAS o conteúdo visual dessas imagens. Descreva:
- O que cada imagem mostra (objetos, fenômenos, estruturas)
- Contexto científico (se aparente)
- Detalhes relevantes

Sejam descritivos mas concisos. Retorne apenas as descrições das imagens.`;

  try {
    return await callGemini(prompt);
  } catch (err) {
    console.error('Gemini image analysis error:', err);
    return null;
  }
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
    logs.push('🚀 Otimizando busca NASA com IA...');
    const optimizedQuery = await optimizeNasaQuery(userQuestion);
    logs.push(`📝 Query otimizada: "${optimizedQuery}"`);

    logs.push('🚀 Buscando mídia da NASA...');
    let results = await searchNasaMedia(optimizedQuery);

    // If no results, try alternative queries
    if (!results || results.length === 0) {
      logs.push('🔁 Tentando alternativa de busca...');
      
      const keywords = userQuestion
        .split(/\s+/)
        .filter(w => w.length > 4)
        .slice(0, 3)
        .join(' ');
      
      if (keywords && keywords !== userQuestion) {
        results = await searchNasaMedia(keywords);
      }
    }

    // Last resort
    if (!results || results.length === 0) {
      logs.push('🔁 Buscando por categoria relacionada...');
      const categoryFallbacks = [
        'space exploration',
        'earth observation', 
        'astronomy',
        'solar system'
      ];
      
      for (const category of categoryFallbacks) {
        results = await searchNasaMedia(category);
        if (results && results.length > 0) {
          logs.push(`✅ Dados encontrados em categoria: ${category}`);
          break;
        }
      }
    }

    if (results && results.length > 0) {
      // Filter by relevance
      results = filterNasaResultsByRelevance(results, userQuestion);
      logs.push(`🔍 Filtrando resultados por relevância...`);

      if (results && results.length > 0) {
        // Select best results with AI
        const bestResults = await selectBestNasaResults(results, userQuestion);
        nasaMedia = bestResults.length > 0 ? bestResults : results.slice(0, 6);
        logs.push(`✅ Selecionados ${nasaMedia.length} melhores resultados`);

        context += `\n\n🔭 Resultados da NASA (imagens/vídeos selecionados):\n`;
        nasaMedia.slice(0, 5).forEach((item, i) => {
          context += `${i + 1}. ${item.title}\n`;
        });
        logs.push('✅ Dados da NASA coletados e otimizados');

        // ANALYZE IMAGES
        const imagesCount = nasaMedia.filter(m => m.media_type === 'image').length;
        if (imagesCount >= 2) {
          logs.push('🔍 Analisando imagens com IA...');
          const groqImageAnalysis = await analyzeNasaImagesWithGroq(nasaMedia);
          if (groqImageAnalysis) {
            context += `\n\n📸 Análise de imagens:\n${groqImageAnalysis}`;
            logs.push('✅ Imagens analisadas');
          }
        }
      }
    } else {
      logs.push('⚠️ Nenhum resultado relevante encontrado da NASA');
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
5. Se a resposta for longa, não pare no meio de uma frase; continue até concluir a explicação.
6. Ao final, inclua apenas a tag: [CONFIANÇA: ALTO/MÉDIO/BAIXO]

Seja honesto e preciso. Não especule.`;

  const response = await callGroq(
    [{ role: 'user', content: executionPrompt }],
    'GROQ_API_KEY_1',
    { maxTokens: 3000, temperature: 0.2 }
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

// ============ CONVERT LOGS TO COHERENT THINKING PARAGRAPH ============
function convertLogsToThinking(logs) {
  if (!logs || logs.length === 0) {
    return 'Iniciando análise científica...';
  }

  // Extract meaningful actions from logs
  const thinking = [];

  for (const log of logs) {
    if (log.includes('Iniciando Agente')) {
      thinking.push('O agente científico foi inicializado');
    } else if (log.includes('busca web') || log.includes('Tavily')) {
      thinking.push('consultando fontes web em tempo real');
    } else if (log.includes('Dados da web')) {
      thinking.push('dados web foram integrados ao contexto');
    } else if (log.includes('Otimizando busca NASA')) {
      thinking.push('otimizando a busca por imagens ciêntíficas');
    } else if (log.includes('Query otimizada')) {
      thinking.push(`personalizando a busca de imagens NASA`);
    } else if (log.includes('Filtrando resultados')) {
      thinking.push('filtrando resultados por relevância');
    } else if (log.includes('Selecionados')) {
      const match = log.match(/(\\d+)/);
      if (match) thinking.push(`selecionados ${match[1]} resultados mais relevantes`);
    } else if (log.includes('Analisando imagens')) {
      thinking.push('analisando imagens científicas com modelos de IA');
    } else if (log.includes('Imagens analisadas')) {
      thinking.push('imagens foram contextualizadas');
    } else if (log.includes('Processando e raciocínio')) {
      thinking.push('processando informações e gerando resposta');
    } else if (log.includes('Resposta gerada')) {
      thinking.push('resposta científica foi gerada');
    } else if (log.includes('Revisando')) {
      thinking.push('validando precisão e clareza da resposta');
    } else if (log.includes('Resposta revisada')) {
      thinking.push('resposta foi revisada e validada');
    }
  }

  if (thinking.length === 0) {
    return 'Processando sua pergunta científica...';
  }

  // Create natural paragraph
  const uniqueThinking = [...new Set(thinking)]; // Remove duplicates
  return uniqueThinking.join(', ') + '.';
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

    // Convert logs to thinking paragraph
    const thinking = convertLogsToThinking(logs);

    return res.status(200).json({
      response: displayResponse || 'Desculpe, não consegui gerar uma resposta confiável.',
      thinking,
      logs,
      media: exec.media || [],
    });
  } catch (err) {
    console.error('Agent error:', err);
    logs.push(`❌ Erro: ${err.message}`);

    const thinking = convertLogsToThinking(logs);

    return res.status(200).json({
      response: 'Desculpe, não consegui processar sua solicitação agora. Tente novamente em alguns instantes.',
      thinking,
      error: err.message,
      logs,
      media: [],
    });
  }
}

module.exports = handler;
