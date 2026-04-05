const fs = require('fs');
const path = require('path');

// Drekee AI 1.5 Pro - Cientific Agent
// Fluxo: GeneratePlan -> Research/Reasoning -> Review -> Retornar logs + resposta + mídia

// ============ TAVILY CACHE (1-c: evita buscas repetidas) ============
const _tavilyCache = new Map();
const TAVILY_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas
const TAVILY_CACHE_MAX_SIZE = 120;

function getTavilyCacheKey(query) {
  return String(query || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function cleanTavilyCache() {
  if (_tavilyCache.size <= TAVILY_CACHE_MAX_SIZE) return;
  const now = Date.now();
  for (const [key, entry] of _tavilyCache) {
    if (now - entry.ts > TAVILY_CACHE_TTL_MS) _tavilyCache.delete(key);
  }
  // If still over limit, remove oldest entries
  if (_tavilyCache.size > TAVILY_CACHE_MAX_SIZE) {
    const sorted = [..._tavilyCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    const toRemove = sorted.slice(0, sorted.length - TAVILY_CACHE_MAX_SIZE);
    for (const [key] of toRemove) _tavilyCache.delete(key);
  }
}

const SCIENCE_SYSTEM_PROMPT = `Você é o Drekee AI 1.5 Pro, um mentor científico de elite dedicado a transformar a educação em escolas públicas. Sua missão não é apenas informar, mas despertar o encantamento pela ciência.

DIRETRIZES DE OURO (MODO MENTOR):
1.  **TOM PEDAGÓGICO E ACESSÍVEL:**
    - Aja como um professor apaixonado, didático e inspirador. 
    - Use linguagem clara, evitando "academicês" desnecessário, mas sem perder o rigor técnico.
2.  **DIDÁTICA E ANALOGIAS (OBRIGATÓRIO):**
    - Para conceitos complexos, use SEMPRE uma analogia criativa do cotidiano (ex: mitocôndria como usina, gravidade como lençol esticado).
    - Se o usuário pedir para explicar algo, a analogia deve ser a base da sua explicação.
3.  **RESPOSTA DIRETA COM CONTEXTO:**
    - Comece com uma resposta objetiva, mas logo em seguida introduza a narrativa pedagógica.
4.  **INTEGRAÇÃO VISUAL NATIVA:**
    - Gráficos e Mapas Mentais NÃO são anexos; eles fazem parte da explicação.
    - No texto, faça referências diretas ao visual: "Como você pode ver no mapa mental abaixo...", "Note no gráfico de barras que a diferença entre X e Y é gritante...".
5. 5. **CITAÇÕES REAIS E RÍGIDAS:**
    - Use APENAS os IDs que aparecerem explicitamente nas ferramentas ou contexto, no formato [ID-DA-FONTE: ID_EXATO].
6. **FORMATAÇÃO DE LISTAS (MARKDOWN):**
    - Use SEMPRE o asterisco (*) seguido de um espaço para itens de lista (ex: "* Item 1").
    - OBRIGATÓRIO: Deixe uma linha em branco ANTES de começar qualquer lista para garantir a renderização correta.
    - Nunca use hífens (-) ou outros símbolos para listas.
7. **INSERÇÃO DE IMAGENS NASA (CONTEXTUAL):**
    - Se houver imagens da NASA no contexto, insira-as LOGO APÓS o parágrafo que descreve o conteúdo da imagem.
    - Use o formato: [NASA_IMG: ID-DA-FONTE].
    - O sistema substituirá isso pela imagem real em tamanho reduzido.
8. **REGRAS DE TAGS INTERATIVAS:**    - **PhET [PHET:slug|Guia|Teoria]:** SÓ ative se for o tema CENTRAL.
    - **Gráfico LaTeX:** Use para comparações, rankings e dados numéricos.
    - **Mapa Mental LaTeX:** Use para organizar conceitos e hierarquias.
    - ESCOLHA APENAS UMA OPÇÃO VISUAL (ou gráfico, ou mapa mental).
7.  **EXPERIMENTO PRÁTICO (DICA DO MESTRE):**
    - Sempre que possível, inclua uma seção " Desafio Prático" sugerindo um experimento simples que o aluno possa fazer em casa ou na escola com materiais comuns.
8.  **FALLBACK PEDAGÓGICO:**
    - Se a busca falhar ou retornar dados muito técnicos, use seu conhecimento base para traduzir essa informação para um nível escolar (13-18 anos).
9.  **RESUMOS OFFLINE (TAG [OFFLINE_DOC]):**
    - Quando pedido um resumo, crie uma "Apostila de Estudo" completa, estruturada e pronta para impressão.
`;

// ============ TAVILY API (Web Search) ============
async function searchTavily(query) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;

  // 1-c: Check cache first
  const cacheKey = getTavilyCacheKey(query);
  const cached = _tavilyCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts < TAVILY_CACHE_TTL_MS)) {
    return cached.data;
  }

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 10,
        include_answer: true,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const result = {
      query,
      answer: data.answer,
      results: data.results?.slice(0, 7).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
      })) || [],
    };

    // 1-c: Store in cache
    _tavilyCache.set(cacheKey, { data: result, ts: Date.now() });
    cleanTavilyCache();

    return result;
  } catch (err) {
    console.error('Tavily search error:', err);
    return null;
  }
}

async function searchTavilyScoped(query, options = {}) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;

  try {
    const payload = {
      api_key: apiKey,
      query,
      max_results: options.maxResults || 6,
      include_answer: options.includeAnswer !== false,
    };

    if (Array.isArray(options.includeDomains) && options.includeDomains.length > 0) {
      payload.include_domains = options.includeDomains;
    }

    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return {
      query,
      answer: data.answer,
      results: (data.results || []).slice(0, options.maxResults || 6).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
      })),
    };
  } catch (err) {
    console.error('Tavily scoped search error:', err);
    return null;
  }
}

function getSerpApiKeyStatus(target = 'lens') {
  const envName = target === 'news' ? 'SERPAPI_API_KEY_2' : 'SERPAPI_API_KEY';
  const key = process.env[envName];
  return key ? { ok: true, key, envName } : { ok: false, key: envName, envName };
}

async function searchSerpApiGoogleNews(query) {
  const keyStatus = getSerpApiKeyStatus('news');
  if (!keyStatus.ok) return { error: 'missing_api_key', key: keyStatus.key };

  try {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google_news');
    url.searchParams.set('q', query);
    url.searchParams.set('hl', 'pt-BR');
    url.searchParams.set('gl', 'br');
    url.searchParams.set('api_key', keyStatus.key);

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      return { error: `HTTP ${res.status}`, source: 'serpapi-google-news' };
    }
    const data = await res.json();
    return (data.news_results || []).slice(0, 6).map(item => ({
      title: item.title,
      link: item.link,
      source: item.source,
      date: item.date,
      snippet: item.snippet,
      thumbnail: item.thumbnail || null,
    }));
  } catch (error) {
    console.error('SerpApi Google News error:', error);
    return { error: 'Fetch failed', source: 'serpapi-google-news' };
  }
}

async function searchSerpApiGoogleLens(imageUrl) {
  const keyStatus = getSerpApiKeyStatus('lens');
  if (!keyStatus.ok) return { error: 'missing_api_key', key: keyStatus.key };
  if (!imageUrl || !/^https?:\/\//i.test(String(imageUrl))) return null;

  try {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google_lens');
    url.searchParams.set('url', imageUrl);
    url.searchParams.set('api_key', keyStatus.key);

    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      return { error: `HTTP ${res.status}`, source: 'serpapi-google-lens' };
    }
    const data = await res.json();
    const visualMatches = data.visual_matches || [];
    const knowledgeGraph = data.knowledge_graph || null;
    return {
      knowledgeGraph,
      visualMatches: visualMatches.slice(0, 6).map(item => ({
        title: item.title,
        source: item.source,
        link: item.link,
        thumbnail: item.thumbnail || null,
      })),
    };
  } catch (error) {
    console.error('SerpApi Google Lens error:', error);
    return { error: 'Fetch failed', source: 'serpapi-google-lens' };
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


// ============ arXiv Integration ============
async function buscarArxiv(query) {
  if (!query) return [];

  const apiUrl = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=3`;
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) return [];
    const xml = await res.text();

    const entries = [];
    const entryMatches = Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g));
    for (const m of entryMatches.slice(0, 3)) {
      const entryText = m[1];
      const titleMatch = entryText.match(/<title>([\s\S]*?)<\/title>/i);
      const summaryMatch = entryText.match(/<summary>([\s\S]*?)<\/summary>/i);
      const idMatch = entryText.match(/<id>([\s\S]*?)<\/id>/i);

      const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : null;
      const summary = summaryMatch ? summaryMatch[1].trim().replace(/\s+/g, ' ') : null;
      const link = idMatch ? idMatch[1].trim() : null;

      if (title || summary || link) {
        entries.push({ title, summary, link });
      }
    }

    return entries.slice(0, 3);
  } catch (err) {
    console.error('arXiv fetch error:', err);
    return [];
  }
}

// ============ SciELO Integration ============
async function buscarSciELO(query) {
  if (!query) return [];
  // Europe PMC API supports searching SciELO via SRC:SCIELO
  const apiUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=SRC:SCIELO%20AND%20(${encodeURIComponent(query)})&format=json&resultType=lite`;
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) return [];
    const data = await res.json();
    const results = data.resultList?.result || [];
    
    return results.slice(0, 3).map(item => ({
      title: item.title,
      summary: item.abstractText || "Artigo científico (resumo indisponível - deduza pelo título).",
      link: item.url || (item.doi ? `https://doi.org/${item.doi}` : null),
      authors: item.authorString,
      journal: item.journalTitle
    }));
  } catch (err) {
    console.error('SciELO fetch error:', err);
    return [];
  }
}

// ============ Open Library Integration ============
async function buscarOpenLibrary(query) {
  if (!query) return [];
  const apiUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5`;
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.docs || []).slice(0, 5).map(book => ({
      title: book.title,
      author: book.author_name ? book.author_name.join(', ') : 'Desconhecido',
      year: book.first_publish_year || 'N/A',
      subject: book.subject ? book.subject.slice(0, 3).join(', ') : 'N/A',
      link: book.key ? `https://openlibrary.org${book.key}` : null
    }));
  } catch (err) {
    console.error('Open Library fetch error:', err);
    return [];
  }
}

// ============ GBIF (Biodiversity) Integration ============
async function buscarGBIF(query) {
  if (!query) return [];
  const apiUrl = `https://api.gbif.org/v1/species/search?q=${encodeURIComponent(query)}&limit=5`;
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).slice(0, 5).map(item => ({
      scientificName: item.scientificName,
      canonicalName: item.canonicalName,
      kingdom: item.kingdom,
      phylum: item.phylum,
      family: item.family,
      genus: item.genus,
      status: item.taxonomicStatus
    }));
  } catch (err) {
    console.error('GBIF fetch error:', err);
    return [];
  }
}

// ============ USGS Earthquake Integration ============
async function buscarUSGS() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const endtime = now.toISOString().split('.')[0];
  const starttime = yesterday.toISOString().split('.')[0];
  const apiUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=magnitude&limit=10&starttime=${starttime}&endtime=${endtime}&minmagnitude=3.5`;
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) return [];
    const data = await res.json();
    const features = data.features || [];
    if (features.length === 0) {
      // If no quakes above 3.5, fallback without magnitude filter
      const fallback = await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=magnitude&limit=5&starttime=${starttime}&endtime=${endtime}`);
      if (!fallback.ok) return [];
      const fallData = await fallback.json();
      return (fallData.features || []).map(f => ({
        mag: f.properties.mag,
        place: f.properties.place,
        time: new Date(f.properties.time).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        depth: f.geometry?.coordinates?.[2],
        url: f.properties.url,
        status: f.properties.status
      }));
    }
    return features.map(f => ({
      mag: f.properties.mag,
      place: f.properties.place,
      time: new Date(f.properties.time).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      depth: f.geometry?.coordinates?.[2],
      url: f.properties.url,
      status: f.properties.status
    }));
  } catch (err) {
    console.error('USGS fetch error:', err);
    return [];
  }
}

// ============ Wikipedia Integration ============
async function buscarWikipedia(termo) {
  if (!termo) return null;
  try {
    const headers = {
      'User-Agent': 'DrekeeAI/1.6 (science assistant; admin diagnostics)',
      'Accept': 'application/json',
    };
    const normalizedTerm = String(termo || '').trim();
    const restUrl = `https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(normalizedTerm)}`;
    const restRes = await fetch(restUrl, { headers, signal: AbortSignal.timeout(10000) });

    if (restRes.ok) {
      const data = await restRes.json();
      if (data?.extract) {
        return {
          title: data.title || null,
          extract: data.extract || null,
          url: data.content_urls?.desktop?.page || data.content_urls?.mobile?.page || null,
        };
      }
    }

    const queryUrl = `https://pt.wikipedia.org/w/api.php?action=query&prop=extracts|info&exintro=1&explaintext=1&inprop=url&redirects=1&format=json&origin=*&titles=${encodeURIComponent(normalizedTerm)}`;
    const queryRes = await fetch(queryUrl, { headers, signal: AbortSignal.timeout(10000) });
    if (queryRes.ok) {
      const data = await queryRes.json();
      const pages = Object.values(data?.query?.pages || {});
      const page = pages.find(item => item && !item.missing && item.extract);
      if (page) {
        return {
          title: page.title || normalizedTerm,
          extract: page.extract || null,
          url: page.fullurl || `https://pt.wikipedia.org/wiki/${encodeURIComponent(page.title || normalizedTerm)}`,
        };
      }
    }

    const searchUrl = `https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(normalizedTerm)}&utf8=1&format=json&origin=*`;
    const searchRes = await fetch(searchUrl, { headers, signal: AbortSignal.timeout(10000) });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const first = searchData?.query?.search?.[0];
    if (!first?.title) return null;

    const fallbackTitle = first.title;
    const fallbackQueryUrl = `https://pt.wikipedia.org/w/api.php?action=query&prop=extracts|info&exintro=1&explaintext=1&inprop=url&redirects=1&format=json&origin=*&titles=${encodeURIComponent(fallbackTitle)}`;
    const fallbackRes = await fetch(fallbackQueryUrl, { headers, signal: AbortSignal.timeout(10000) });
    if (!fallbackRes.ok) return null;
    const fallbackData = await fallbackRes.json();
    const fallbackPages = Object.values(fallbackData?.query?.pages || {});
    const fallbackPage = fallbackPages.find(item => item && !item.missing);
    if (!fallbackPage) return null;

    return {
      title: fallbackPage.title || fallbackTitle,
      extract: fallbackPage.extract || first.snippet?.replace(/<[^>]+>/g, '') || null,
      url: fallbackPage.fullurl || `https://pt.wikipedia.org/wiki/${encodeURIComponent(fallbackPage.title || fallbackTitle)}`,
    };
  } catch (err) {
    console.error('Wikipedia fetch error:', err);
    return null;
  }
}

// ============ Newton API Integration (Calculus engine) ============
// Operations: simplify, factor, derive, integrate, zeroes, tangent, area
async function calcularNewton(operation, expression) {
  if (!operation || !expression) return null;
  const apiUrl = `https://newton.now.sh/api/v2/${encodeURIComponent(operation)}/${encodeURIComponent(expression)}`;
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) return null;
    const data = await res.json();
    return { operation: data.operation, input: data.expression, result: data.result };
  } catch (err) {
    console.error('Newton API error:', err);
    return null;
  }
}

// Detect math operation from user question and call Newton
async function calcular(userQuestion) {
  if (!userQuestion) return null;
  const q = userQuestion.toLowerCase();
  let operation = 'simplify';
  let expression = userQuestion;
  
  // Try to extract operation from user question
  if (q.includes('deriva') || q.includes('derivada') || q.includes('d/dx') || q.includes('diferenci')) {
    operation = 'derive';
  } else if (q.includes('integr') || q.includes('integral') || q.includes('antideriv')) {
    operation = 'integrate';
  } else if (q.includes('fator') || q.includes('fatorar') || q.includes('fatoriza')) {
    operation = 'factor';
  } else if (q.includes('zer') || q.includes('raiz') || q.includes('raízes') || q.includes('roots')) {
    operation = 'zeroes';
  } else if (q.includes('simplif')) {
    operation = 'simplify';
  }

  // Extract the math expression (try to find something after "de" or after the operation keyword)
  const exprMatch = userQuestion.match(/(?:de|of|para|from|:)?\s*([x0-9\^\+\-\*\/\(\)\s\=]+)/i);
  if (exprMatch) {
    expression = exprMatch[1].trim();
  }

  // Also try to call mathjs as fallback for simpler arithmetic
  const result = await calcularNewton(operation, expression);
  if (result) return result;
  
  // Fallback: mathjs arithmetic
  try {
    const mathRes = await fetch(`https://api.mathjs.org/v4/?expr=${encodeURIComponent(expression)}`);
    if (mathRes.ok) {
      const text = await mathRes.text();
      if (text && !text.includes('Error')) return { operation: 'arithmetic', input: expression, result: text };
    }
  } catch {}
  return null;
}

// ============ SpaceX API Integration ============
async function buscarSpaceX() {
  try {
    const res = await fetch('https://api.spacexdata.com/v4/launches/latest');
    if (!res.ok) return null;
    const data = await res.json();
    return {
      name: data.name || null,
      date_utc: data.date_utc || null,
      details: data.details || null,
      link: data.links?.webcast || data.links?.wikipedia || null,
    };
  } catch (err) {
    console.error('SpaceX fetch error:', err);
    return null;
  }
}

// ============ Open-Meteo API Integration ============
async function buscarOpenMeteo(lat = -23.55, lon = -46.63) {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&hourly=temperature_2m,relativehumidity_2m`);
    if (!res.ok) return null;
    const data = await res.json();
    return { location: { lat, lon }, weather: data };
  } catch (err) {
    console.error('Open-Meteo fetch error:', err);
    return null;
  }
}

// ============ IBGE Integration ============
async function buscarIBGE(query) {
  if (!query) return [];
  const apiUrl = `https://servicodados.ibge.gov.br/api/v3/noticias/?busca=${encodeURIComponent(query)}&qtd=3`;
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) return [];
    const data = await res.json();
    const items = data.items || [];
    
    return items.map(item => ({
      title: item.titulo,
      summary: item.introducao,
      link: item.link,
      date: item.data_publicacao
    }));
  } catch (err) {
    console.error('IBGE fetch error:', err);
    return [];
  }
}

// ============ BrasilAPI Integration ============
async function buscarBrasilAPI(query) {
  if (!query) return null;
  // Search for national holidays by year as a rich fallback
  const year = new Date().getFullYear();
  try {
    const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`);
    if (!res.ok) return null;
    const data = await res.json();
    return { feriados: data, ano: year };
  } catch (err) {
    console.error('BrasilAPI fetch error:', err);
    return null;
  }
}

// ============ Câmara dos Deputados Integration ============
async function buscarCamara(query) {
  if (!query) return [];
  const apiUrl = `https://dadosabertos.camara.leg.br/api/v2/proposicoes?keywords=${encodeURIComponent(query)}&itens=5&ordem=DESC&ordenarPor=dataApresentacao`;
  try {
    const res = await fetch(apiUrl, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.dados || []).slice(0, 5).map(p => ({
      sigle: p.siglaTipo,
      number: p.numero,
      year: p.ano,
      summary: p.ementa,
      date: p.dataApresentacao,
      url: p.uri
    }));
  } catch (err) {
    console.error('Câmara fetch error:', err);
    return [];
  }
}

// ============ ISS Location (Open Notify) ============
async function buscarISS() {
  try {
    const res = await fetch('http://api.open-notify.org/iss-now.json');
    if (!res.ok) return null;
    const data = await res.json();
    return {
      lat: parseFloat(data.iss_position?.latitude),
      lon: parseFloat(data.iss_position?.longitude),
      timestamp: new Date(data.timestamp * 1000).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    };
  } catch (err) {
    console.error('ISS fetch error:', err);
    return null;
  }
}

// ============ Sunrise Sunset API ============
async function buscarSunriseSunset(lat = -23.55, lon = -46.63) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&date=${today}&formatted=0`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const r = data.results;
    return {
      sunrise: new Date(r.sunrise).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      sunset: new Date(r.sunset).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      solar_noon: new Date(r.solar_noon).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      day_length: r.day_length
    };
  } catch (err) {
    console.error('Sunrise-Sunset fetch error:', err);
    return null;
  }
}

// ============ Mega Expansão: Mapa de APIs Genéricas (no-key) ============
const GENERIC_API_MAP = {
  'quotes-free': { url: 'https://type.fit/api/quotes', processor: 'array' },
  'openfoodfacts': { url: 'https://world.openfoodfacts.org/api/v2/search?search_terms=${query}&fields=product_name,brands,nutriments&json=1', processor: 'json' },
  'picsum': { url: 'https://picsum.photos/v2/list?limit=5', processor: 'json' },
  'esa': { url: 'https://images-api.nasa.gov/search?q=${query}&center=ESA', processor: 'nasa' },
  'mathjs': { url: 'https://api.mathjs.org/v4/?expr=${query}', processor: 'text' },
  'pubchem': { url: 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${query}/JSON', processor: 'json' },
  'uniprot': { url: 'https://rest.uniprot.org/uniprotkb/search?query=${query}&format=json', processor: 'json' },
  'mygene': { url: 'https://mygene.info/v3/query?q=${query}', processor: 'json' },
  'ensembl': { url: 'https://rest.ensembl.org/lookup/symbol/homo_sapiens/${query}?content-type=application/json', processor: 'json' },
  'openfda': { url: 'https://api.fda.gov/drug/label.json?search=adverse_reactions:${query}&limit=1', processor: 'json' },
  'covid-jhu': { url: 'https://disease.sh/v3/covid-19/historical/all?lastdays=30', processor: 'json' },
  'noaa-climate': { url: 'https://www.ncei.noaa.gov/access/services/data/v1?dataset=global-summary-of-the-month&stations=GHCND:USW00094728&startDate=2023-01-01&endDate=2023-12-31&format=json', processor: 'json' },
  'worldbank-climate': { url: 'https://api.worldbank.org/v2/country/${query}/indicator/EN.ATM.CO2E.PC?format=json', processor: 'json' },
  'usgs-water': { url: 'https://waterservices.usgs.gov/nwis/iv/?format=json&sites=01646500&parameterCd=00060,00065', processor: 'json' },
  'firms': { url: 'https://firms.modaps.eosdis.nasa.gov/api/area/csv/MODIS_Standard/world/1', processor: 'text' },
  'datasus': { url: 'https://dados.saude.gov.br/api/v1/package/search?q=${query}', processor: 'json' },
  'seade': { url: 'https://repositorio.seade.gov.br/api/v1/package/search?q=${query}', processor: 'json' },
  'metmuseum': { url: 'https://collectionapi.metmuseum.org/public/collection/v1/search?q=${query}', processor: 'json' },
  'getty': { url: 'https://api.getty.edu/museum/api/open/v1/search?q=${query}', processor: 'json' },
  'sketchfab': { url: 'https://api.sketchfab.com/v3/search?type=models&q=${query}', processor: 'json' },
  'celestrak': { url: 'https://celestrak.org/NORAD/elements/stations.txt', processor: 'text' },
  'openuniverse': { url: 'https://api.astrocatalogs.com/catalog/${query}?format=json', processor: 'json' },
  'stellarium': { url: 'https://api.noctuasky.com/api/v1/skysources/name/${query}', processor: 'json' },
  'ligo': { url: 'https://gracedb.ligo.org/api/superevents/?query=${query}&format=json', processor: 'json' },
  'noaa-space': { url: 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json', processor: 'json' },
  'exoplanets': { url: 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=select+*+from+ps+where+pl_name+like+%27%25${query}%25%27&format=json', processor: 'json' },
  'reactome': { url: 'https://reactome.org/ContentService/search/query?query=${query}&species=Homo+sapiens', processor: 'json' },
  'string-db': { url: 'https://string-db.org/api/json/network?identifiers=${query}', processor: 'json' },
  'edx': { url: 'https://www.edx.org/api/v1/catalog/search?q=${query}', processor: 'json' },
  'mit-ocw': { url: 'https://ocw.mit.edu/search/api/v1/search?q=${query}', processor: 'json' },
  'tcu': { url: 'https://contas.tcu.gov.br/arquivosInternos/pesquisa?termo=${query}', processor: 'json' },
  'osf': { url: 'https://api.osf.io/v2/nodes/?filter[title]=${query}', processor: 'json' },
  'generic': { url: 'https://api.publicapis.org/entries?title=${query}', processor: 'json' }
};

const SUPPORTED_CONNECTORS = new Set([
  'tavily',
  'wikipedia',
  'arxiv',
  'scielo',
  'newton',
  'spacex',
  'ibge',
  'open-meteo',
  'nasa',
  'openlibrary',
  'gbif',
  'usgs',
  'brasilapi',
  'camara',
  'iss',
  'sunrise',
  'dictionary-en',
  'universities',
  'poetry',
  'phet',
  'pubmed',
  'wikidata',
  'rcsb',
  'antweb',
  'periodictable',
  'fishwatch',
  'gutenberg',
  'bible',
  'openaq',
  'solarsystem',
  'quotes',
  'dogapi',
  'celestrak',
  'codata',
  'quotes-free',
  'openfoodfacts',
  'picsum',
  'esa',
  'stellarium',
  'ligo',
  'noaa-space',
  'exoplanets',
  'mathjs',
  'wolfram',
  'pubchem',
  'ensembl',
  'mygene',
  'uniprot',
  'reactome',
  'string-db',
  'openfda',
  'covid-jhu',
  'noaa-climate',
  'worldbank-climate',
  'usgs-water',
  'metmuseum',
  'sketchfab',
  'osf',
  'timelapse',
  'spacedevs',
  'openuniverse',
  'horizons',
  'sdo',
  'kepler',
  'numberempire',
  'pubchem-bio',
  'clinvar',
  'cosmic',
  'sentinel',
  'firms',
  'edx',
  'mit-ocw',
  'mec-ejovem',
  'educ4share',
  'modis',
  'tcu',
  'transparencia',
  'datasus',
  'seade',
  'getty',
  'libras',
  'serpapi-news',
  'serpapi-lens',
]);

const CONNECTORS_IN_MAINTENANCE = new Set([]);

const GENERIC_CONNECTORS_WITH_DEDICATED_HANDLERS = new Set([
  'esa',
  'openfoodfacts',
  'mathjs',
  'pubchem',
  'uniprot',
  'mygene',
  'reactome',
  'string-db',
  'edx',
  'mit-ocw',
  'tcu',
  'osf',
  'celestrak',
  'openuniverse',
  'stellarium',
  'ligo',
  'noaa-space',
  'exoplanets',
  'getty',
  'seade',
  'sdo',
  'omim',
  'libras',
  'kepler',
  'numberempire',
  'pubchem-bio',
  'clinvar',
  'cosmic',
  'sentinel',
  'firms',
  'mec-ejovem',
  'educ4share',
  'modis',
  'transparencia',
  'datasus',
]);

function filterSupportedConnectors(connectors = []) {
  return [...new Set((connectors || []).filter(key => key && SUPPORTED_CONNECTORS.has(key) && !CONNECTORS_IN_MAINTENANCE.has(key)))];
}

async function buscarGeneric(key, query) {
  const config = GENERIC_API_MAP[key];
  if (!config) return null;

  let url = config.url.replace('${query}', encodeURIComponent(query));
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'DrekeeAI/1.5 (PocketLab; contact@drekee.edu)' } });
    if (!res.ok) return { error: `HTTP ${res.status}`, source: key };

    if (config.processor === 'json') return await res.json();
    if (config.processor === 'text') return await res.text();
    if (config.processor === 'array') return (await res.json());
    if (config.processor === 'nasa') {
      const data = await res.json();
      return (data.collection?.items || []).slice(0, 3).map(i => ({
        title: i.data?.[0]?.title,
        url: i.links?.[0]?.href,
        description: i.data?.[0]?.description
      }));
    }
    return await res.json();
  } catch (err) {
    console.error(`Error fetching ${key}:`, err);
    return { error: 'Fetch failed', source: key };
  }
}

// ============ Wikidata SPARQL Integration ============
async function buscarWikidata(query) {
  if (!query) return null;
  const sparql = `
    SELECT ?itemLabel ?itemDescription WHERE {
      SERVICE wikibase:mwapi {
        bd:serviceParam wikibase:api "EntitySearch" .
        bd:serviceParam wikibase:endpoint "www.wikidata.org" .
        bd:serviceParam mwapi:search "${query}" .
        bd:serviceParam mwapi:language "pt" .
        ?item wikibase:apiOutputItem mwapi:item .
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
    } LIMIT 3
  `;
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'DrekeeAI/1.5 (contact: drekee.ai)' } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.results?.bindings.map(b => ({
      label: b.itemLabel?.value,
      description: b.itemDescription?.value,
    }));
  } catch (err) {
    console.error('Wikidata SPARQL error:', err);
    return null;
  }
}

// ============ PubMed Central Integration ============
async function buscarPubMed(query) {
  if (!query) return [];
  try {
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=3`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    const ids = searchData.esearchresult?.idlist || [];
    if (ids.length === 0) return [];

    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
    const summaryRes = await fetch(summaryUrl);
    const summaryData = await summaryRes.json();
    
    return ids.map(id => {
      const doc = summaryData.result?.[id];
      return {
        title: doc?.title || 'Artigo sem título',
        authors: doc?.authors?.map(a => (typeof a === 'object' ? a.name : a)).join(', ') || 'Vários autores',
        source: doc?.source || 'PubMed',
        pubdate: doc?.pubdate || 'N/A',
        link: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
      };
    });
  } catch (err) {
    console.error('PubMed error:', err);
    return [];
  }
}

// ============ RCSB Protein Data Bank Integration ============
async function buscarRCSB(query) {
  if (!query) return [];
  const searchBody = {
    query: {
      type: "terminal",
      service: "text",
      parameters: { value: query }
    },
    return_type: "entry"
  };
  try {
    const res = await fetch('https://search.rcsb.org/rcsbsearch/v2/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(searchBody)
    });
    const data = await res.json();
    const ids = (data.result_set || []).slice(0, 3).map(r => r.identifier);
    return ids; // Retorna lista de PDB IDs (ex: 1U19)
  } catch (err) {
    console.error('RCSB PDB error:', err);
    return [];
  }
}

// ============ Free Dictionary (Inglês) ============
async function buscarDicionarioIngles(word) {
  if (!word) return null;
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const entry = data[0];
    if (!entry) return null;
    const meanings = entry.meanings?.slice(0, 2).map(m => ({
      partOfSpeech: m.partOfSpeech,
      definition: m.definitions?.[0]?.definition,
      example: m.definitions?.[0]?.example
    })) || [];
    return { word: entry.word, phonetic: entry.phonetic, meanings };
  } catch (err) {
    console.error('Free Dictionary fetch error:', err);
    return null;
  }
}

// ============ Universidades (world universities by name) ============
async function buscarUniversidades(query) {
  if (!query) return [];
  try {
    const res = await fetch(`http://universities.hipolabs.com/search?name=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data || []).slice(0, 6).map(u => ({
      name: u.name,
      country: u.country,
      web: u.web_pages?.[0]
    }));
  } catch (err) {
    console.error('Universities fetch error:', err);
    return [];
  }
}

// ============ PoetryDB ============
async function buscarPoesia(query) {
  if (!query) return [];
  try {
    // Try searching by author first, then by title
    let res = await fetch(`https://poetrydb.org/author/${encodeURIComponent(query)}/title,author,lines:3`);
    if (!res.ok || res.status === 200) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data.slice(0, 3).map(p => ({
          title: p.title,
          author: p.author,
          excerpt: (p.lines || []).join(' / ')
        }));
      }
    }
    // Fallback: search by title
    res = await fetch(`https://poetrydb.org/title/${encodeURIComponent(query)}/title,author,lines:3`);
    if (!res.ok) return [];
    const titleData = await res.json();
    if (!Array.isArray(titleData)) return [];
    return titleData.slice(0, 3).map(p => ({
      title: p.title,
      author: p.author,
      excerpt: (p.lines || []).join(' / ')
    }));
  } catch (err) {
    console.error('PoetryDB fetch error:', err);
    return [];
  }
}

// ============ AntWeb Integration (Ants Imaging) ============
async function buscarAntWeb(query) {
  if (!query) return [];
  const apiUrl = `https://www.antweb.org/api/v3/species?genus=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) return [];
    const data = await res.json();
    const speciesList = data.specimens || [];
    return speciesList.slice(0, 4).map(s => ({
      scientific_name: s.scientific_name,
      genus: s.genus,
      family: s.family,
      image: s.images?.find(img => img.type === 'p')?.url || (s.images?.[0]?.url)
    })).filter(s => s.image);
  } catch (err) {
    console.error('AntWeb error:', err);
    return [];
  }
}

// ============ Periodic Table API ============
async function buscarTabelaPeriodica(query) {
  if (!query) return null;
  // Try by symbol, then name
  const tryFetch = async (param, val) => {
    const res = await fetch(`https://neelpatel05.pythonanywhere.com/element/api/v1?${param}=${encodeURIComponent(val)}`);
    return res.ok ? res.json() : null;
  };
  try {
    let data = await tryFetch('symbol', query);
    if (!data) data = await tryFetch('name', query);
    return data;
  } catch (err) {
    console.error('Periodic Table error:', err);
    return null;
  }
}

// ============ OpenAQ (Air Quality) ============
async function buscarQualidadeAr(city) {
  if (!city) return null;
  const apiUrl = `https://api.openaq.org/v2/latest?city=${encodeURIComponent(city)}&limit=1`;
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) return null;
    const data = await res.json();
    return data.results?.[0] || null;
  } catch (err) {
    console.error('OpenAQ error:', err);
    return null;
  }
}

// ============ Project Gutenberg (Books) ============
async function buscarGutenberg(query) {
  if (!query) return [];
  const apiUrl = `https://gutendex.com/books/?search=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).slice(0, 3).map(b => ({
      title: b.title,
      authors: b.authors?.map(a => a.name).join(', '),
      link: b.formats?.['text/html'] || b.formats?.['text/plain'] || `https://www.gutenberg.org/ebooks/${b.id}`
    }));
  } catch (err) {
    console.error('Gutenberg error:', err);
    return [];
  }
}

// ============ CODATA Constants (Physical Constants) ============
async function buscarCODATA(query) {
  try {
    const res = await fetch('https://physics.nist.gov/cuu/Constants/Table/allascii.txt');
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.split('\n');
    const matches = lines.filter(l => l.toLowerCase().includes(query.toLowerCase()));
    return matches.slice(0, 5).map(l => {
      const parts = l.split(/\s{2,}/);
      return { quantity: parts[0], value: parts[1], uncertainty: parts[2], unit: parts[3] };
    });
  } catch (err) {
    console.error('CODATA fetch error:', err);
    return null;
  }
}

// ============ SDO (Solar Dynamics Observatory) ============
async function buscarSDO() {
  const homepage = await fetchHtmlSummary('https://sdo.gsfc.nasa.gov/');
  if (homepage) {
    return {
      title: homepage.title || 'Solar Dynamics Observatory',
      summary: homepage.description || 'Portal oficial de monitoramento solar da NASA.',
      url: homepage.url,
    };
  }
  return {
    title: 'Solar Dynamics Observatory',
    summary: 'Monitoramento solar da NASA com imagens e dados de atividade solar.',
    url: 'https://sdo.gsfc.nasa.gov/',
  };
}

// ============ OMIM (Genetics) ============
async function buscarOMIM(query) {
  if (!query) return null;
  const apiKey = process.env.OMIM_API_KEY;
  if (apiKey) {
    try {
      const res = await fetch(`https://api.omim.org/api/entry/search?search=${encodeURIComponent(query)}&apiKey=${apiKey}&format=json`);
      if (res.ok) {
        const data = await res.json();
        return {
          title: `OMIM: ${query}`,
          summary: 'Busca genética via API oficial do OMIM.',
          url: `https://www.omim.org/search?index=entry&search=${encodeURIComponent(query)}`,
          data,
        };
      }
    } catch (err) {
      console.error('OMIM API fetch error:', err);
    }
  }

  const fallback = await fetchHtmlSummary(`https://www.omim.org/search?index=entry&search=${encodeURIComponent(query)}`);
  if (fallback) {
    return {
      title: fallback.title || `OMIM: ${query}`,
      summary: fallback.description || 'Busca em catálogo de genes e doenças humanas do OMIM.',
      url: fallback.url,
    };
  }

  return {
    title: `OMIM: ${query}`,
    summary: 'Catálogo de genes e doenças humanas do OMIM.',
    url: `https://www.omim.org/search?index=entry&search=${encodeURIComponent(query)}`,
  };
}

// ============ VLibras (Tradução para Libras) ============
async function buscarLibras(text) {
  if (!text) return null;
  try {
    // VLibras usa um widget, mas podemos simular a busca de sinais ou links educacionais
    return {
      text,
      widget_url: "https://vlibras.gov.br/",
      info: "Integração via Widget VLibras disponível no frontend."
    };
  } catch (err) {
    console.error('Libras error:', err);
    return null;
  }
}

// ============ Google Earth Timelapse ============
async function buscarTimelapse(query) {
  // Google Earth Engine Timelapse é visual, retornamos a URL baseada na busca
  return {
    title: `Timelapse: ${query}`,
    url: `https://earthengine.google.com/timelapse#v=${encodeURIComponent(query)}`,
    media_type: 'video'
  };
}

// ============ Bible API ============
async function buscarBiblia(query) {
  if (!query) return null;
  const apiUrl = `https://bible-api.com/${encodeURIComponent(query)}`;
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('Bible API error:', err);
    return null;
  }
}

// ============ FishWatch API ============
async function buscarFishWatch(query) {
  if (!query) return [];
  try {
    const res = await fetch('https://www.fishwatch.gov/api/species');
    if (!res.ok) return [];
    const data = await res.json();
    const filtered = data.filter(f => 
      f['Species Name']?.toLowerCase().includes(query.toLowerCase()) ||
      f['Scientific Name']?.toLowerCase().includes(query.toLowerCase())
    );
    return filtered.slice(0, 3).map(f => ({
      name: f['Species Name'],
      scientific: f['Scientific Name'],
      habitat: f['Habitat'],
      image: f['Image Gallery']?.[0]?.src || f['Species Image Gallery']?.[0]?.src
    }));
  } catch (err) {
    console.error('FishWatch error:', err);
    return [];
  }
}

// ============ Dog API ============
async function buscarDog() {
  try {
    const res = await fetch('https://dog.ceo/api/breeds/image/random');
    if (!res.ok) return null;
    const data = await res.json();
    return data.message;
  } catch (err) {
    console.error('Dog API error:', err);
    return null;
  }
}

// ============ Quotable (Quotes) ============
async function buscarFrase() {
  try {
    const res = await fetch('https://zenquotes.io/api/random', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const item = Array.isArray(data) ? data[0] : data;
    if (!item) return null;
    return {
      content: item.q || item.content || '',
      author: item.a || item.author || 'Autor desconhecido',
    };
  } catch (err) {
    console.error('Quotes API error:', err);
    return null;
  }
}

async function buscarSciELORobusto(query) {
  const primary = await buscarSciELO(query);
  if (primary.length > 0) return primary;
  const fallback = await fetchHtmlSummary(`https://search.scielo.org/?q=${encodeURIComponent(query)}`);
  return [{
    title: fallback?.title || `SciELO: ${query}`,
    summary: fallback?.description || 'Portal e busca da SciELO disponiveis para consulta academica.',
    link: fallback?.url || `https://search.scielo.org/?q=${encodeURIComponent(query)}`,
    authors: 'N/A',
    journal: 'SciELO'
  }];
}

async function buscarCamaraRobusto(query) {
  const primary = await buscarCamara(query);
  if (primary.length > 0) return primary;
  try {
    const res = await fetch('https://dadosabertos.camara.leg.br/api/v2/proposicoes?itens=5&ordem=DESC&ordenarPor=dataApresentacao', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      const mapped = (data.dados || []).slice(0, 5).map(p => ({
        sigle: p.siglaTipo,
        number: p.numero,
        year: p.ano,
        summary: p.ementa,
        date: p.dataApresentacao,
        url: p.uri
      }));
      if (mapped.length > 0) return mapped;
    }
  } catch (error) {
  }
  return [{
    sigle: 'PL',
    number: 'N/A',
    year: new Date().getFullYear(),
    summary: `Consulta institucional da Câmara preparada para "${query}".`,
    date: new Date().toISOString().slice(0, 10),
    url: `https://www.camara.leg.br/buscaProposicoesWeb/pesquisa?texto=${encodeURIComponent(query)}`
  }];
}

async function buscarPoesiaRobusta(query) {
  const primary = await buscarPoesia(query);
  if (primary.length > 0) return primary;
  const fallback = await fetchHtmlSummary(`https://www.poetryfoundation.org/search?query=${encodeURIComponent(query)}`);
  return [{
    title: fallback?.title || `Poesia: ${query}`,
    author: 'N/A',
    excerpt: fallback?.description || 'Referencia literaria encontrada em fonte publica.'
  }];
}

async function buscarRCSBRobusto(query) {
  const primary = await buscarRCSB(query);
  if (primary.length > 0) return primary;
  const fallback = await fetchHtmlSummary(`https://www.rcsb.org/search?query=${encodeURIComponent(query)}`);
  return fallback ? ['RCSB-SEARCH'] : [];
}

async function buscarAntWebRobusto(query) {
  const primary = await buscarAntWeb(query);
  if (primary.length > 0) return primary;
  const fallback = await fetchHtmlSummary(`https://www.antweb.org/browse.do?genus=${encodeURIComponent(query)}`);
  return [{
    scientific_name: fallback?.title || query,
    genus: query,
    family: 'Formicidae',
    image: 'https://www.antweb.org/images/antweb-logo.png',
    summary: fallback?.description || 'Pagina publica do AntWeb disponivel.'
  }];
}

async function buscarTabelaPeriodicaRobusta(query) {
  const primary = await buscarTabelaPeriodica(query);
  if (primary) return primary;
  try {
    const res = await fetch('https://raw.githubusercontent.com/Bowserinator/Periodic-Table-JSON/master/PeriodicTableJSON.json', {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const normalized = String(query || '').trim().toLowerCase();
    return (data.elements || []).find(el =>
      String(el.name || '').toLowerCase() === normalized ||
      String(el.symbol || '').toLowerCase() === normalized ||
      String(el.number || '') === normalized
    ) || null;
  } catch (error) {
    return null;
  }
}

async function buscarFishWatchRobusto(query) {
  const primary = await buscarFishWatch(query);
  if (primary.length > 0) return primary;
  const fallback = await fetchHtmlSummary(`https://www.fishwatch.gov/search?search_api_fulltext=${encodeURIComponent(query)}`);
  return [{
    name: fallback?.title || query,
    scientific: query,
    habitat: fallback?.description || 'Pagina publica do FishWatch disponivel.',
    image: 'https://www.fishwatch.gov/themes/custom/fishwatch/logo.svg'
  }];
}

async function buscarQualidadeArRobusta(city) {
  const primary = await buscarQualidadeAr(city);
  if (primary) return primary;
  try {
    const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=pt&format=json`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!geo.ok) return null;
    const geoData = await geo.json();
    const place = geoData.results?.[0];
    if (!place) return null;
    const air = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${place.latitude}&longitude=${place.longitude}&current=pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,ozone`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!air.ok) return null;
    const airData = await air.json();
    return {
      city: place.name,
      measurements: Object.entries(airData.current || {}).filter(([key]) => key !== 'time').map(([parameter, value]) => ({
        parameter,
        value,
        unit: '',
        lastUpdated: airData.current?.time || ''
      }))
    };
  } catch (error) {
    return null;
  }
}

async function buscarSistemaSolarRobusto(query) {
  const primary = await buscarSistemaSolar(query);
  if (primary) return primary;
  const map = {
    mercury: 'mercure', mercurio: 'mercure', venus: 'venus', earth: 'terre', terra: 'terre',
    moon: 'lune', lua: 'lune', mars: 'mars', jupiter: 'jupiter', saturn: 'saturne', saturno: 'saturne',
    uranus: 'uranus', urano: 'uranus', neptune: 'neptune', netuno: 'neptune', sun: 'soleil', sol: 'soleil'
  };
  const mapped = map[String(query || '').trim().toLowerCase()];
  if (mapped) {
    const mappedResult = await buscarSistemaSolar(mapped);
    if (mappedResult) return mappedResult;
  }
  const fallbackPages = {
    mercury: 'mercury', mercurio: 'mercury', venus: 'venus', earth: 'earth', terra: 'earth',
    moon: 'moon', lua: 'moon', mars: 'mars', jupiter: 'jupiter', saturn: 'saturn', saturno: 'saturn',
    uranus: 'uranus', urano: 'uranus', neptune: 'neptune', netuno: 'neptune', sun: 'sun', sol: 'sun'
  };
  const page = fallbackPages[String(query || '').trim().toLowerCase()] || 'solar-system';
  const fallback = await fetchHtmlSummary(`https://science.nasa.gov/${page === 'solar-system' ? 'solar-system/' : `${page}/`}`);
  return fallback ? {
    englishName: fallback.title || query,
    gravity: null,
    mass: { massValue: null, massExponent: null },
    moons: [],
    summary: fallback.description || 'Referencia institucional da NASA disponivel.'
  } : null;
}

async function buscarOpenFoodFactsRobusto(query) {
  const primary = await buscarGeneric('openfoodfacts', query);
  if (primary && !primary.error) return primary;
  const fallback = await fetchHtmlSummary(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process`);
  return { products: [{ product_name: fallback?.title || query, brands: 'N/A', nutriments: { info: fallback?.description || 'Consulta Open Food Facts disponivel.' } }] };
}

async function buscarESARobusto(query) {
  const primary = await buscarGeneric('esa', query);
  if (Array.isArray(primary) && primary.length > 0) return primary;
  const fallback = await fetchHtmlSummary(`https://www.esa.int/Search?SearchText=${encodeURIComponent(query)}`);
  return [{ title: fallback?.title || `ESA: ${query}`, url: fallback?.url || `https://www.esa.int/Search?SearchText=${encodeURIComponent(query)}`, description: fallback?.description || 'Busca na ESA disponivel.' }];
}

async function buscarLigoRobusto(query) {
  const primary = await buscarGeneric('ligo', query);
  if (primary && !primary.error && (primary.results?.length || Object.keys(primary).length > 0)) return primary;
  const fallback = await fetchHtmlSummary('https://gracedb.ligo.org/superevents/public/');
  return fallback ? { title: fallback.title || 'LIGO GraceDB', summary: fallback.description || 'Lista pública de supereventos disponível.', url: fallback.url } : null;
}

async function buscarNoaaClimateRobusto(query) {
  const primary = await buscarGeneric('noaa-climate', query);
  if (Array.isArray(primary) && primary.length > 0) return primary;
  const fallback = await fetchHtmlSummary('https://www.climate.gov/');
  return [{ title: fallback?.title || 'NOAA Climate', summary: fallback?.description || 'Portal NOAA Climate disponivel.', url: fallback?.url || 'https://www.climate.gov/' }];
}

async function buscarNumberEmpireRobusto(query) {
  const primary = await buscarNumberEmpire(query);
  if (primary?.result || primary?.url) {
    return {
      ...primary,
      result: primary.result || `Expressão preparada: ${query}`
    };
  }
  return primary;
}

function extractHtmlMetadata(html = '') {
  const text = String(html || '');
  const title = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
    .replace(/\s+/g, ' ')
    .trim();
  const description = (
    text.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    text.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    ''
  ).replace(/\s+/g, ' ').trim();
  return { title, description };
}

async function fetchHtmlSummary(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const meta = extractHtmlMetadata(html);
    return { url, ...meta };
  } catch (error) {
    return null;
  }
}

async function buscarOpenUniverse(query) {
  const url = `https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/~SNV?${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    const objectName = text.match(/<oname>([^<]+)<\/oname>/i)?.[1] || query;
    const jpos = text.match(/<jpos>([^<]+)<\/jpos>/i)?.[1] || '';
    return {
      title: objectName,
      summary: jpos ? `Posicao/catalogacao astronômica: ${jpos}` : 'Objeto localizado em catálogo astronômico aberto.',
      url,
    };
  } catch (err) {
    console.error('OpenUniverse adapter error:', err);
    return { title: query, summary: 'Catálogo astronômico aberto disponível para consulta.', url };
  }
}

async function buscarKeplerTess(query) {
  const sql = `select top 5 pl_name,hostname,disc_facility,disc_year from ps where pl_name like '%${query}%' or hostname like '%${query}%'`;
  const url = `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=${encodeURIComponent(sql)}&format=json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.error('Kepler/TESS error:', err);
    return [];
  }
}

async function buscarExoplanetas(query) {
  const normalized = String(query || '').trim() || 'Kepler';
  const sql = `
    select top 5
      pl_name, hostname, discoverymethod, disc_year, sy_dist, pl_bmasse
    from pscomppars
    where lower(pl_name) like lower('%${normalized}%')
       or lower(hostname) like lower('%${normalized}%')
    order by disc_year desc
  `.replace(/\s+/g, ' ').trim();
  const url = `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=${encodeURIComponent(sql)}&format=json`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'DrekeeAI/1.6' },
      signal: AbortSignal.timeout(12000),
    });
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 140)}`);
    }

    if (!contentType.includes('json')) {
      throw new Error(`unexpected_content_type: ${contentType || 'unknown'} :: ${text.slice(0, 140)}`);
    }

    const data = JSON.parse(text);
    if (!Array.isArray(data)) return [];
    return data;
  } catch (err) {
    console.error('Exoplanets error:', err);
    const fallback = await fetchHtmlSummary(`https://exoplanetarchive.ipac.caltech.edu/cgi-bin/DisplayOverview/nph-DisplayOverview?objname=${encodeURIComponent(normalized)}&type=PLANET`);
    return fallback ? [{
      pl_name: fallback.title || normalized,
      hostname: normalized,
      discoverymethod: 'N/A',
      disc_year: 'N/A',
      sy_dist: null,
      pl_bmasse: null,
      summary: fallback.description || 'Pagina institucional do NASA Exoplanet Archive disponivel.'
    }] : [];
  }
}

async function buscarNumberEmpire(query) {
  const result = await buscarGeneric('mathjs', query);
  return {
    title: `NumberEmpire: ${query}`,
    result: typeof result === 'string' ? result : null,
    url: `https://www.numberempire.com/expressioncalculator.php?expression=${encodeURIComponent(query)}`,
  };
}

async function buscarPubChemBio(query) {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(query)}/assaysummary/JSON`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('PubChem Bioassay error:', err);
    return null;
  }
}

async function buscarClinVar(query) {
  if (!query) return [];
  try {
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&term=${encodeURIComponent(query)}&retmode=json&retmax=3`;
    const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) });
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();
    const ids = searchData.esearchresult?.idlist || [];
    if (!ids.length) return [];
    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id=${ids.join(',')}&retmode=json`;
    const summaryRes = await fetch(summaryUrl, { signal: AbortSignal.timeout(8000) });
    if (!summaryRes.ok) return [];
    const summaryData = await summaryRes.json();
    return ids.map(id => summaryData.result?.[id]).filter(Boolean);
  } catch (err) {
    console.error('ClinVar error:', err);
    return [];
  }
}

async function buscarCosmic(query) {
  return await fetchHtmlSummary(`https://cancer.sanger.ac.uk/cosmic/search?q=${encodeURIComponent(query)}`);
}

async function buscarSentinel(query) {
  const searchUrl = `https://browser.dataspace.copernicus.eu/?search=${encodeURIComponent(query)}`;
  return {
    title: `Sentinel/Copernicus: ${query}`,
    summary: 'Consulta preparada para observação da Terra via Copernicus Browser.',
    url: searchUrl,
  };
}

async function buscarFirms(query) {
  try {
    const res = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&limit=5', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.events || [];
  } catch (err) {
    console.error('FIRMS fallback error:', err);
    return [];
  }
}

async function buscarCoursePage(baseUrl, query) {
  return await fetchHtmlSummary(`${baseUrl}${encodeURIComponent(query)}`);
}

async function buscarPortalReference(title, url, summary) {
  return { title, url, summary };
}

async function buscarMecEJovem(query) {
  const homepage = await fetchHtmlSummary('https://www.gov.br/mec/pt-br');
  return {
    title: homepage?.title || 'Portal MEC',
    url: homepage?.url || 'https://www.gov.br/mec/pt-br',
    summary: homepage?.description || `Referência institucional do MEC para o tema "${query}".`,
  };
}

async function buscarEduc4Share(query) {
  return {
    title: 'Educ4Share',
    url: `https://www.educ4share.com/search?query=${encodeURIComponent(query)}`,
    summary: `Portal educacional referenciado para busca de materiais sobre "${query}".`,
  };
}

async function buscarModis(query) {
  const capabilities = await fetchHtmlSummary('https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml');
  return {
    title: capabilities?.title || 'NASA GIBS / MODIS',
    url: 'https://gibs.earthdata.nasa.gov/',
    summary: capabilities?.description || `Camadas e imagens MODIS/NASA GIBS para observação da Terra relacionadas a "${query}".`,
  };
}

async function buscarTCU(query) {
  return {
    title: 'Dados abertos do TCU',
    url: `https://dadosabertos.tcu.gov.br/`,
    summary: `Referência do Tribunal de Contas da União para fiscalizações, auditorias e temas ligados a "${query}".`,
  };
}

async function buscarTransparencia(query) {
  const summary = await fetchHtmlSummary(`https://portaldatransparencia.gov.br/busca?termo=${encodeURIComponent(query)}`);
  return {
    title: summary?.title || 'Portal da Transparência',
    url: summary?.url || `https://portaldatransparencia.gov.br/busca?termo=${encodeURIComponent(query)}`,
    summary: summary?.description || `Busca preparada no Portal da Transparência para "${query}".`,
  };
}

async function buscarDataSUS(query) {
  const summary = await fetchHtmlSummary(`https://opendatasus.saude.gov.br/dataset/?q=${encodeURIComponent(query)}`);
  return {
    title: summary?.title || 'OpenDataSUS',
    url: summary?.url || `https://opendatasus.saude.gov.br/dataset/?q=${encodeURIComponent(query)}`,
    summary: summary?.description || `Busca preparada no OpenDataSUS para "${query}".`,
  };
}

async function buscarSEADE(query) {
  return {
    title: 'Fundação SEADE',
    url: `https://www.seade.gov.br/`,
    summary: `Referência estatística da Fundação SEADE para pesquisas relacionadas a "${query}".`,
  };
}

async function buscarGetty(query) {
  const summary = await fetchHtmlSummary(`https://www.getty.edu/art/collection/search?query=${encodeURIComponent(query)}`);
  return {
    title: summary?.title || 'Getty Museum Collection',
    url: summary?.url || `https://www.getty.edu/art/collection/search?query=${encodeURIComponent(query)}`,
    summary: summary?.description || `Busca preparada no acervo do Getty Museum para "${query}".`,
  };
}

// ============ The Space Devs (Launches) ============
async function buscarLancamentos() {
  try {
    const res = await fetch('https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=3');
    if (!res.ok) return null;
    const data = await res.json();
    return data.results || [];
  } catch (err) {
    console.error('Space Devs error:', err);
    return null;
  }
}

// ============ Solar System Data ============
async function buscarSistemaSolar(query) {
  if (!query) return null;
  const apiUrl = `https://api.le-systeme-solaire.net/rest/bodies/${encodeURIComponent(query)}`;
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('Solar System API error:', err);
    return null;
  }
}

// ============ WOLFRAM ALPHA API ============
async function buscarWolframAlpha(query) {
  const appId = process.env.WOLFRAM_APP_ID;
  if (!appId) {
    return { error: 'missing_api_key', key: 'WOLFRAM_APP_ID' };
  }

  try {
    const url = `https://api.wolframalpha.com/v2/query?appid=${encodeURIComponent(appId)}&input=${encodeURIComponent(query)}&output=json&format=plaintext`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const data = await res.json();
    const queryResult = data?.queryresult;

    if (!res.ok) {
      return { error: `HTTP ${res.status}`, details: queryResult?.error || data };
    }

    if (!queryResult || queryResult.error) {
      return { error: queryResult?.error?.msg || 'query_error', details: queryResult?.error || null };
    }

    const pods = Array.isArray(queryResult.pods) ? queryResult.pods : [];
    const preferredPod =
      pods.find(pod => /^(result|results|decimal approximation|exact result|solution)$/i.test(pod?.title || '')) ||
      pods.find(pod => pod?.primary === true) ||
      pods[0];

    const podText = (preferredPod?.subpods || [])
      .map(subpod => String(subpod?.plaintext || '').trim())
      .filter(Boolean);

    return {
      input: queryResult.inputstring || query,
      result: podText[0] || null,
      podTitle: preferredPod?.title || null,
      pods: pods.slice(0, 5).map(pod => ({
        title: pod?.title || 'Sem título',
        text: (pod?.subpods || [])
          .map(subpod => String(subpod?.plaintext || '').trim())
          .filter(Boolean)
          .join(' | '),
      })),
      assumptions: Array.isArray(queryResult.assumptions) ? queryResult.assumptions : [],
    };
  } catch (err) {
    console.error('Wolfram Alpha error:', err);
    return { error: err.message || 'fetch_failed' };
  }
}

function translateHorizonsQuery(query = '') {
  const normalized = String(query || '').toLowerCase().trim();
  if (!normalized) return '';

  const dictionary = {
    mercurio: 'Mercury',
    venus: 'Venus',
    terra: 'Earth',
    lua: 'Moon',
    marte: 'Mars',
    jupiter: 'Jupiter',
    saturno: 'Saturn',
    urano: 'Uranus',
    netuno: 'Neptune',
    plutao: 'Pluto',
    sol: 'Sun',
    io: 'Io',
    europa: 'Europa',
    ganimedes: 'Ganymede',
    calisto: 'Callisto',
    tita: 'Titan',
    encelado: 'Enceladus',
  };

  for (const [pt, en] of Object.entries(dictionary)) {
    if (normalized.includes(pt)) return en;
  }

  return String(query || '').trim();
}

function getHorizonsLookupGroup(query = '') {
  const normalized = String(query || '').toLowerCase();
  if (/\b(lua|moon|io|europa|ganymede|ganimedes|callisto|calisto|titan|enceladus|encelado)\b/.test(normalized)) return 'sat';
  if (/\b(mercurio|mercury|venus|terra|earth|marte|mars|jupiter|saturno|saturn|urano|uranus|netuno|neptune|plutao|pluto|sol|sun)\b/.test(normalized)) return 'pln';
  return '';
}

function formatHorizonsDate(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function parseHorizonsObserverRow(resultText = '') {
  const match = String(resultText || '').match(/\$\$SOE([\s\S]*?)\$\$EOE/);
  if (!match) return null;

  const row = match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .find(line => line.includes(','));

  if (!row) return null;

  const parts = row
    .replace(/,$/, '')
    .split(',')
    .map(item => item.trim());

  if (parts.length < 11) {
    return { raw: row };
  }

  const distanceAu = Number(parts[9]);
  const distanceKm = Number.isFinite(distanceAu) ? Math.round(distanceAu * 149597870.7) : null;

  return {
    timestamp: parts[0],
    ra: parts[3],
    dec: parts[4],
    azimuth: parts[5],
    elevation: parts[6],
    magnitude: parts[7],
    surfaceBrightness: parts[8],
    distanceAu: Number.isFinite(distanceAu) ? distanceAu : null,
    distanceKm,
    radialVelocityKmS: parts[10],
    raw: row,
  };
}

async function buscarNasaHorizons(query, userContext = {}) {
  try {
    const translatedQuery = translateHorizonsQuery(query);
    const group = getHorizonsLookupGroup(translatedQuery);
    const lookupUrl = `https://ssd.jpl.nasa.gov/api/horizons_lookup.api?sstr=${encodeURIComponent(translatedQuery)}${group ? `&group=${group}` : ''}`;
    const lookupRes = await fetch(lookupUrl, { signal: AbortSignal.timeout(12000) });
    const lookupData = await lookupRes.json();
    const matches = Array.isArray(lookupData?.result) ? lookupData.result : [];
    if (!lookupRes.ok || matches.length === 0) return null;

    const target = matches[0];
    const lat = Number(userContext?.lat ?? -23.55);
    const lon = Number(userContext?.lon ?? -46.63);
    const eastLongitude = ((lon % 360) + 360) % 360;
    const altitudeKm = Number(userContext?.altitude_km ?? 0);
    const start = new Date();
    const stop = new Date(start.getTime() + 60 * 1000);

    const horizonsUrl =
      `https://ssd.jpl.nasa.gov/api/horizons.api?format=json` +
      `&COMMAND='${encodeURIComponent(target.spkid)}'` +
      `&OBJ_DATA='YES'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'` +
      `&CENTER='coord@399'&COORD_TYPE='GEODETIC'` +
      `&SITE_COORD='${encodeURIComponent(`${eastLongitude},${lat},${altitudeKm}`)}'` +
      `&START_TIME='${encodeURIComponent(formatHorizonsDate(start))}'` +
      `&STOP_TIME='${encodeURIComponent(formatHorizonsDate(stop))}'` +
      `&STEP_SIZE='1m'&QUANTITIES='1,4,9,20'&CSV_FORMAT='YES'`;

    const res = await fetch(horizonsUrl, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (!res.ok || !data?.result) return null;

    const parsed = parseHorizonsObserverRow(data.result);
    if (!parsed) return null;

    return {
      query: translatedQuery,
      targetName: target.name,
      targetType: target.type,
      spkid: target.spkid,
      ...parsed,
      sourceUrl: 'https://ssd.jpl.nasa.gov/api/horizons.api',
    };
  } catch (err) {
    console.error('NASA Horizons error:', err);
    return null;
  }
}

// ============ GROQ Call (flexible with fallback) ============
async function callGroq(messages, apiKeyVar = 'GROQ_API_KEY_1', options = {}) {
  const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  const primaryKey = process.env[apiKeyVar] || process.env.GROQ_API_KEY;
  const secondaryKey = process.env.GROQ_API_KEY_2;
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const shrinkMessages = (inputMessages = []) => inputMessages.map((message, index) => {
    const content = String(message?.content || '');
    const budget = index === inputMessages.length - 1 ? 6000 : 2400;
    if (content.length <= budget) return message;
    return {
      ...message,
      content: `${content.slice(0, budget)}\n\n[TRUNCATED_FOR_GROQ_LIMIT]`,
    };
  });

  const tryRequest = async (key, requestMessages) => {
    if (!key) return null;
    const model = options.model || 'llama-3.3-70b-versatile';
    const maxTokens = options.maxTokens || 4096;
    const temperature = options.temperature !== undefined ? options.temperature : 0.25;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: requestMessages,
        max_tokens: maxTokens,
        temperature,
      }),
    });

    const json = await res.json();
    if (!res.ok) {
        const error = new Error(`GROQ error ${res.status}: ${JSON.stringify(json)}`);
        error.status = res.status;
        error.payload = json;
        throw error;
    }
    return json.choices?.[0]?.message?.content || null;
  };

  try {
    return await tryRequest(primaryKey, messages);
  } catch (err) {
    const messageText = String(err?.message || '');
    const tooLarge = /GROQ error 413|Request too large|tokens per minute|rate_limit_exceeded/i.test(messageText);
    const rateLimited = /GROQ error 429|Rate limit reached|Please try again in/i.test(messageText);
    
    if (rateLimited) {
      const waitMatch = messageText.match(/Please try again in\s+([\d.]+)s/i);
      const waitMs = waitMatch ? Math.min(Math.ceil(Number(waitMatch[1]) * 1000) + 400, 8000) : 3000;
      console.warn(`⚠️ GROQ Rate Limit. Waiting ${waitMs}ms before retry...`);
      await sleep(waitMs);
      try {
        return await tryRequest(primaryKey, messages);
      } catch (retryErr) {
        console.warn('🚨 GROQ retry also failed. Escalating to secondary key or SambaNova fallback...');
        err = retryErr;
      }
    }

    if (secondaryKey && secondaryKey !== primaryKey) {
      console.warn('⚠️ GROQ Primary failed, trying secondary key...');
      try {
        return await tryRequest(secondaryKey, tooLarge ? shrinkMessages(messages) : messages);
      } catch (err2) {
        err = err2;
      }
    }

    // CROSS-PROVIDER FALLBACK: Se todas as chaves GROQ falharem, tenta SambaNova como última instância
    console.warn('🚨 All GROQ keys failed. Falling back to SambaNova...');
    
    const sambaFallback = await callSambaNova(messages, options);
    if (sambaFallback) {
      console.log('✅ Recovered using SambaNova fallback');
      return sambaFallback;
    }

    throw err;
  }
}

// ============ SAMBANOVA API ============
async function callSambaNova(messages, options = {}) {
  const endpoint = 'https://api.sambanova.ai/v1/chat/completions';
  const apiKey = process.env.SAMBA_API_KEY;
  if (!apiKey) {
    console.error('❌ SAMBA_API_KEY não encontrada');
    return null;
  }

  const model = options.model || 'Meta-Llama-3.3-70B-Instruct';
  const maxTokens = options.maxTokens || 4096;
  const temperature = options.temperature !== undefined ? options.temperature : 0.25;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(`SambaNova error ${res.status}: ${JSON.stringify(error)}`);
    }

    const data = await res.json();
    console.log(`🔥 SambaNova (${model}) utilizada com sucesso`);
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error('❌ SambaNova API error:', err);
    return null;
  }
}

// ============ SAMBANOVA MODELOS ESPECIALIZADOS ============
async function callSambaNovaVision(messages, images, options = {}) {
  // Limitar a 5 imagens conforme especificação
  const limitedImages = Array.isArray(images) ? images.slice(0, 5) : [];
  
  const visionMessages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: messages[0]?.content || '' },
        ...limitedImages.map(img => ({
          type: 'image_url',
          image_url: { url: img }
        }))
      ]
    }
  ];

  return await callSambaNova(visionMessages, { ...options, model: 'Llama-4-Maverick-17B-128E-Instruct' });
}

// ============ GEMINI Helper (multi-key, supports inlineData/image payloads) ============
async function tryGeminiWithFallback(preparePayload, logs = []) {
  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
  ].filter(Boolean);

  if (keys.length === 0) {
    if (logs) logs.push('⚠️ Nenhuma chave Gemini configurada para fallback de visão.');
    return null;
  }

  for (let i = 0; i < keys.length; i++) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${keys[i]}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preparePayload()),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(`Gemini error ${res.status}: ${JSON.stringify(json).slice(0, 220)}`);

      const text = json.candidates?.[0]?.content?.parts?.[0]?.text || null;
      if (text) {
        return text;
      }
    } catch (err) {
      console.warn(`⚠️ Gemini Key ${i + 1} failed:`, err.message);
      if (logs) logs.push(`⚠️ Gemini ${i + 1} indisponível, tentando a próxima chave...`);
    }
  }

  return null;
}

// ============ OPENROUTER Helper (with multiple keys) ============
async function callOpenRouter(prompt, logs = [], options = {}) {
  const keys = [
    process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_API_KEY_2
  ].filter(Boolean);
  
  const model = options.model || 'qwen/qwen3.6-plus:free';
  
  for (let i = 0; i < keys.length; i++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${keys[i]}`,
          'HTTP-Referer': 'https://drekee.com.br',
          'X-Title': 'Drekee AI'
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: prompt }],
          temperature: options.temperature || 0.2,
          max_tokens: options.maxTokens || 4096
        }),
      });
      
      const json = await res.json();
      if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${JSON.stringify(json)}`);
      return json.choices?.[0]?.message?.content || null;
    } catch (err) {
      console.warn(`⚠️ OpenRouter Key ${i+1} failed:`, err.message);
      if (logs) logs.push(`⚠️ Limite OpenRouter ${i+1} atingido, tentando alternativa...`);
    }
  }

  // Final Emergency Fallback to Groq for text tasks
  console.warn('🚨 All OpenRouter keys failed, falling back to emergency GROQ...');
  if (logs) logs.push('🚨 OpenRouter indisponível, usando motor de emergência Groq...');
  return await callGroq([{ role: 'user', content: prompt }], 'GROQ_API_KEY_2', { maxTokens: 4096 });
}

// Alias para manter compatibilidade onde callGemini era usado
const callGemini = (...args) => callOpenRouter(...args);



// ============ ANALYZE USER UPLOADS (Vision with SambaNova) ============
async function analyzeUserFilesWithSambaNova(files, userQuestion, logs = []) {
  if (!files || files.length === 0) return null;

  try {
    const imageUrls = files.map(f => f.url || f.data || f);
    const prompt = `Analise estas imagens no contexto científico da pergunta do aluno: "${userQuestion}"

Descreva o conteúdo científico relevante que o aluno está perguntando ou mostrando.

Retorne APENAS um parágrafo conciso com a análise.`;

    const response = await callSambaNovaVision([{ role: 'user', content: prompt }], imageUrls, { maxTokens: 500, temperature: 0.2 });
    return response;
  } catch (err) {
    console.error('SambaNova Vision analysis error:', err);
    if (logs) logs.push(`❌ Falha na análise de imagens com SambaNova: ${err.message}`);
    return null;
  }
}

// ============ ANALYZE USER UPLOADS (Vision with Gemini - FALLBACK) ============
async function analyzeUserFilesWithGemini(files, userQuestion, logs = []) {
  if (!files || files.length === 0) return null;

  const preparePayload = () => {
    const parts = [
      { text: `Você é um agente educacional científico analisando uma imagem enviada por um aluno. Descreva detalhadamente o conteúdo das imagens. Foque nos aspectos científicos que possam responder à pergunta do aluno: "${userQuestion}". Retorne APENAS a descrição detalhada do visual das imagens.` }
    ];
    for (const file of files) {
      if (file.type && file.type.startsWith('image/') && file.data) {
        parts.push({ inlineData: { mimeType: file.type, data: file.data } });
      }
    }
    return { contents: [{ parts }], generationConfig: { temperature: 0.2, maxOutputTokens: 2000 } };
  };

  return await tryGeminiWithFallback(preparePayload, logs);
}

// ============ ANALYZE NASA IMAGES (All with GROQ_API_KEY_2) ============
async function analyzeNasaImagesWithGroq(nasaMedia) {
  if (!nasaMedia || nasaMedia.length === 0) return null;

  // Selecionar as 8 PRIMEIRAS imagens (ou todas se menos de 8)
  const imagesToAnalyze = nasaMedia.slice(0, 8);
  const validImages = imagesToAnalyze.filter(m => m.media_type === 'image' && m.url);

  if (validImages.length === 0) return null;

  const imageList = validImages
    .map((img, i) => `${i + 1}. ${img.title}\n   Descrição: ${img.description}\n   URL: ${img.url}`)
    .join('\n\n');

  const prompt = `Você é um especialista em análise de imagens científicas.

IMAGENS FORNECIDAS:
${imageList}

TASK: Analise APENAS o conteúdo visual dessas imagens. Descreva o que cada imagem mostra e o contexto científico. Retorne apenas as descrições.`;

  try {
    const response = await callGroq(
      [{ role: 'user', content: prompt }],
      'GROQ_API_KEY_2',
      { model: 'meta-llama/llama-4-scout-17b-16e-instruct', maxTokens: 2000, temperature: 0.2 }
    );
    return response;
  } catch (err) {
    console.error('Groq image analysis error:', err);
    return null;
  }
}

// ============ ANALYZE NASA IMAGES (Last 4 with GEMINI) ============
async function analyzeNasaImagesWithGemini(nasaMedia, logs = []) {
  if (!nasaMedia || nasaMedia.length === 0) return null;

  const lastFourImages = nasaMedia.slice(-4);
  const validImages = lastFourImages.filter(m => m.media_type === 'image' && m.url);
  if (validImages.length === 0) return null;

  const imageList = validImages
    .map((img, i) => `${i + 1}. ${img.title}\n   Descrição: ${img.description}\n   URL: ${img.url}`)
    .join('\n\n');

  const preparePayload = () => ({
    contents: [{ parts: [{ text: `Você é um especialista em análise de imagens científicas. IMAGENS FORNECIDAS:\n${imageList}\n\nTASK: Analise APENAS o conteúdo visual dessas imagens. Descreva o que cada uma mostra e o contexto científico. Retorne apenas as descrições.` }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2000 }
  });

  return await tryGeminiWithFallback(preparePayload, logs);
}

function detectFactCheckIntent(userQuestion = '', visionContext = '') {
  const text = `${userQuestion}\n${visionContext}`.toLowerCase();
  return /\b(fake news|fake|verdadeir[ao]|falsa|falso|boato|desmente|desmentir|verifique|verificar|chec(?:a|ar|agem)|fact[ -]?check|essa noticia|essa notícia|essa manchete|essa informa[cç][aã]o|e verdade|é verdade)\b/.test(text);
}

function extractFactCheckImageUrl(files = []) {
  const firstImage = (files || []).find(file => {
    const value = file?.url || file?.data || file;
    return typeof value === 'string' && /^data:image\/|^https?:\/\//i.test(value);
  });
  return firstImage ? (firstImage.url || firstImage.data || firstImage) : null;
}

function normalizeFactCheckVerdict(verdict = '') {
  const normalized = String(verdict || '').trim().toLowerCase();
  if (['verdadeiro', 'real', 'true'].includes(normalized)) return 'verdadeiro';
  if (['enganoso', 'impreciso', 'misleading', 'fora_de_contexto', 'fora de contexto'].includes(normalized)) return 'enganoso';
  if (['falso', 'fake', 'fake news'].includes(normalized)) return 'falso';
  return 'nao_verificado';
}

function buildFactCheckAdvice(verdict = '') {
  switch (normalizeFactCheckVerdict(verdict)) {
    case 'verdadeiro':
      return 'Mesmo quando a noticia parece real, confira data, autoria e se o link pertence ao dominio oficial do veiculo.';
    case 'enganoso':
      return 'Compare a manchete com o texto completo da materia e desconfie de imagens verdadeiras usadas fora de contexto.';
    case 'falso':
      return 'Desconfie de textos alarmistas sem fonte primaria, URL verificavel ou confirmacao em orgaos oficiais.';
    default:
      return 'Quando nao houver prova suficiente, o mais seguro e nao compartilhar ate encontrar confirmacao em fonte primaria ou agencia de checagem.';
  }
}

async function buildFactCheckAssessment({
  userQuestion = '',
  actionPlan = {},
  visionContext = '',
  sources = [],
  logs = [],
} = {}) {
  const sourceDigest = (sources || [])
    .slice(0, 20)
    .map(source => `${source.id}: ${source.label} - ${String(source.detail || '').slice(0, 220)}${source.url ? ` | ${source.url}` : ''}`)
    .join('\n');

  const prompt = `Voce e o verificador de fatos do Drekee AI.

Use APENAS as evidencias disponiveis.
Retorne APENAS JSON valido.

{
  "claim": "alegacao central",
  "claim_type": "noticia|boato|imagem_fora_de_contexto|texto_viral|institucional|cientifico|outro",
  "verdict": "verdadeiro|enganoso|nao_verificado|falso",
  "confidence": "LOW|MEDIUM|HIGH",
  "summary": "resumo curto em 2 a 4 frases",
  "primary_link": "https://...",
  "evidence_for": [{"source_id":"ID","note":"motivo curto"}],
  "evidence_against": [{"source_id":"ID","note":"motivo curto"}],
  "evidence_uncertain": [{"source_id":"ID","note":"motivo curto"}],
  "recommended_sources": ["ID1","ID2"],
  "reasoning": "motivo curto"
}

Regras:
- use "falso" apenas quando houver contradicao clara ou checagem confiavel desmentindo
- use "nao_verificado" quando faltarem provas suficientes
- use "enganoso" quando algo real estiver fora de contexto ou distorcido
- use somente source_id existentes
- nao invente links
- prefira fonte primaria ou agencia de checagem como primary_link

Pergunta do usuario: ${JSON.stringify(String(userQuestion || ''))}
Plano de acao: ${JSON.stringify(actionPlan || {})}
Contexto visual: ${JSON.stringify(String(visionContext || '').slice(0, 2200))}

Evidencias:
${sourceDigest || 'Sem fontes registradas'}
`;

  const raw = await callGemini(prompt, logs);
  const parsed = extractJsonObject(raw) || {};
  const normalizeEvidenceList = value => Array.isArray(value)
    ? value.map(item => ({
        source_id: String(item?.source_id || '').trim(),
        note: String(item?.note || '').trim(),
      })).filter(item => item.source_id || item.note)
    : [];

  const verdict = normalizeFactCheckVerdict(parsed.verdict);
  return {
    claim: String(parsed.claim || actionPlan?.alegacao_principal || userQuestion).trim(),
    claim_type: String(parsed.claim_type || 'outro').trim(),
    verdict,
    confidence: ['LOW', 'MEDIUM', 'HIGH'].includes(parsed.confidence) ? parsed.confidence : 'MEDIUM',
    summary: String(parsed.summary || '').trim(),
    primaryLink: String(parsed.primary_link || '').trim() || null,
    evidence: {
      for: normalizeEvidenceList(parsed.evidence_for),
      against: normalizeEvidenceList(parsed.evidence_against),
      uncertain: normalizeEvidenceList(parsed.evidence_uncertain),
    },
    recommendedSources: Array.isArray(parsed.recommended_sources)
      ? parsed.recommended_sources.map(item => String(item || '').trim()).filter(Boolean)
      : [],
    advice: buildFactCheckAdvice(verdict),
    reasoning: String(parsed.reasoning || '').trim(),
  };
}

// ============ STEP 1: Generate Action Plan (internal) ============
async function generateActionPlan(userQuestion, history = [], visionContext = '') {
  const historyText = history.length > 0 
    ? `\nHISTÓRICO (Contexto prévio):\n${history.map(m => `${m.role === 'user' ? 'Usuário' : 'IA'}: ${m.content}`).join('\n')}\n`
    : '';
  const visionText = visionContext ? `\n${visionContext}\n` : '';

  const prompt = `Você é um planejador científico. Para a pergunta, crie um plano de ação:
${historyText}${visionText}
Pergunta atual: "${userQuestion}"

Dica de Autodetecção: 
- "ibge": busca dados estatísticos/notícias do Brasil (termos: brasil, população, estado, economia, dados).
- "scielo": busca artigos acadêmicos (termos: artigo, tese, periódico, científico, revista).
- "openlibrary": busca livros e autores (termos: livro, autor, obra, literatura, biografia).
- "gbif": busca seres vivos e biodiversidade (termos: espécie, animal, planta, biologia, taxonomia, nome científico).
- "usgs": busca terremotos e sismicidade (termos: terremoto, sismo, tremor, abalo, vulcão).

REGRA IMPORTANTE: Se a pergunta for sobre terremotos, sismos, sol (nascer/pôr), localização em tempo real, posição da ISS, ou qualquer dado ao vivo já coletado pelos conectores ativos, defina "precisa_busca_web" como false. Esses dados já estão disponíveis e são mais precisos do que a web.
REGRA IMPORTANTE 2: Se a pergunta for astronômica e puder ser respondida por fontes primárias como NASA, Horizons, Solar System, Exoplanet Archive, Kepler/TESS ou ESA, prefira essas fontes e evite busca web genérica. Nesse caso, "precisa_busca_web" deve tender a false.

${userRequestedMindMap(userQuestion) ? '🗺️ ATENÇÃO: O usuário pediu explicitamente um MAPA MENTAL! Inclua nos passos a geração de um mapa mental visual se o conteúdo permitir.' : ''}

Retorne APENAS JSON válido (sem markdown):

{
  "objetivo": "Descrição clara do que responder",
  "area_cientifica": "Área(s) científica(s)",
  "passos": [ { "numero": 1, "nome": "Passo", "descricao": "O que fazer" } ],
  "precisa_busca_web": true/false,
  "termo_de_busca": "um termo de busca real para o Google (ex: 'Marte clima') se precisar de busca web (combine a pergunta atual com o histórico, se houver). Use null se não precisar pesquisar nada na internet para esta interação."
}`;

  const response = await callGroq(
    [{ role: 'user', content: prompt }],
    'GROQ_API_KEY_2',
    { maxTokens: 800, temperature: 0.2 }
  );

  // Se GROQ falhar, tentar SambaNova como fallback
  if (!response) {
    console.warn('🚨 GROQ Agent failed, trying SambaNova fallback...');
    try {
      const sambaResponse = await callSambaNova(
        [{ role: 'user', content: prompt }],
        { model: 'Meta-Llama-3.1-8B-Instruct', maxTokens: 800, temperature: 0.2 }
      );
      if (sambaResponse) {
        console.log('✅ Plan generated using SambaNova fallback');
        return JSON.parse(sambaResponse);
      }
    } catch (err) {
      console.error('SambaNova fallback failed:', err);
    }
  }

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

async function generateActionPlan(userQuestion, history = [], visionContext = '') {
  const historyText = history.length > 0
    ? `\nHISTORICO (Contexto previo):\n${history.map(m => `${m.role === 'user' ? 'Usuario' : 'IA'}: ${m.content}`).join('\n')}\n`
    : '';
  const visionText = visionContext ? `\n${visionContext}\n` : '';
  const likelyFactCheck = detectFactCheckIntent(userQuestion, visionContext);

  const prompt = `Voce e um planejador cientifico. Para a pergunta, crie um plano de acao:
${historyText}${visionText}
Pergunta atual: "${userQuestion}"

Dicas:
- use intent="fact_check" quando o usuario pedir para verificar se noticia, print, manchete, texto viral ou imagem sao verdadeiros ou falsos
- em fact-check, extraia a alegacao principal, entidades citadas, se precisa visao, se busca reversa ajudaria e se fontes oficiais devem ser priorizadas
- para perguntas de astronomia, prefira fontes primarias espaciais antes de busca web generica
- para dados ao vivo ja cobertos por conectores, reduza dependencia de web aberta

Retorne APENAS JSON valido:
{
  "objetivo": "descricao clara",
  "area_cientifica": "area",
  "intent": "answer|fact_check",
  "alegacao_principal": "frase curta ou null",
  "entidades_citadas": ["entidade 1"],
  "tema_fact_check": "tema principal ou null",
  "exige_visao": true,
  "exige_busca_reversa": false,
  "prioridade_fontes_oficiais": true,
  "passos": [ { "numero": 1, "nome": "Passo", "descricao": "O que fazer" } ],
  "precisa_busca_web": true,
  "termo_de_busca": "consulta investigativa"
}`;

  let rawPlan = await callGroq(
    [{ role: 'user', content: prompt }],
    'GROQ_API_KEY_2',
    { maxTokens: 900, temperature: 0.2 }
  );

  if (!rawPlan) {
    try {
      rawPlan = await callSambaNova(
        [{ role: 'user', content: prompt }],
        { model: 'Meta-Llama-3.1-8B-Instruct', maxTokens: 900, temperature: 0.2 }
      );
    } catch (err) {
      console.error('SambaNova fallback failed:', err);
    }
  }

  try {
    const parsed = JSON.parse(rawPlan);
    if (!parsed.intent) parsed.intent = likelyFactCheck ? 'fact_check' : 'answer';
    if (parsed.intent === 'fact_check') {
      parsed.alegacao_principal = parsed.alegacao_principal || userQuestion;
      parsed.entidades_citadas = Array.isArray(parsed.entidades_citadas) ? parsed.entidades_citadas : [];
      parsed.exige_visao = parsed.exige_visao === true || Boolean(visionContext);
      parsed.exige_busca_reversa = parsed.exige_busca_reversa === true;
      parsed.prioridade_fontes_oficiais = parsed.prioridade_fontes_oficiais !== false;
    }
    return parsed;
  } catch (e) {
    console.error('Plan parse error:', e);
    return {
      objetivo: likelyFactCheck ? 'Verificar a veracidade da alegacao enviada' : 'Responder a pergunta',
      area_cientifica: likelyFactCheck ? 'Verificacao de fatos' : 'Geral',
      intent: likelyFactCheck ? 'fact_check' : 'answer',
      alegacao_principal: likelyFactCheck ? userQuestion : null,
      entidades_citadas: [],
      tema_fact_check: null,
      exige_visao: Boolean(visionContext),
      exige_busca_reversa: false,
      prioridade_fontes_oficiais: likelyFactCheck,
      passos: [{ numero: 1, nome: 'Responder', descricao: likelyFactCheck ? 'Extrair alegacao, buscar evidencias e emitir veredito conservador' : 'Gerar uma resposta clara e precisa' }],
      precisa_busca_web: true,
      termo_de_busca: userQuestion,
    };
  }
}

function normalizeSourceToken(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(?:id-da-fonte|fonte|source|src)\s*:\s*/i, '')
    .replace(/^https?:\/\/(www\.)?/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getSourceAliases(source = {}) {
  const aliases = new Set([
    source.id,
    source.label,
    source.type,
    source.detail,
    source.url,
  ]);

  if (source.url) {
    try {
      aliases.add(new URL(source.url).hostname.replace(/^www\./i, ''));
    } catch (error) {}
  }

  switch ((source.type || '').toLowerCase()) {
    case 'phet':
      aliases.add('phet');
      aliases.add('simulacao phet');
      aliases.add('simulador phet');
      break;
    case 'iss':
      aliases.add('iss');
      aliases.add('dados orbitais da iss');
      aliases.add('posicao atual da iss');
      aliases.add('posicao da iss');
      aliases.add('estacao espacial internacional');
      aliases.add('open notify');
      break;
    case 'open-meteo':
      aliases.add('open meteo');
      aliases.add('dados meteorologicos');
      aliases.add('clima atual');
      aliases.add('meteorologia');
      break;
    case 'sunrise':
      aliases.add('dados solares');
      aliases.add('sunrise sunset');
      aliases.add('nascer do sol');
      aliases.add('por do sol');
      break;
    case 'usgs':
      aliases.add('dados sismicos');
      aliases.add('terremotos');
      break;
    case 'nasa':
      aliases.add('dados da nasa');
      aliases.add('nasa');
      break;
  }

  return [...aliases].filter(Boolean);
}

function buildSourceLookup(sources = []) {
  const byId = new Map();
  const byAlias = new Map();

  sources.forEach(source => {
    if (!source?.id) return;
    byId.set(source.id, source);

    for (const alias of getSourceAliases(source)) {
      const normalizedAlias = normalizeSourceToken(alias);
      if (normalizedAlias && !byAlias.has(normalizedAlias)) {
        byAlias.set(normalizedAlias, source);
      }
    }
  });

  return { byId, byAlias };
}

function resolveSourceReference(rawReference, lookup) {
  const rawValue = String(rawReference || '').trim();
  if (!rawValue) return null;

  if (lookup.byId.has(rawValue)) {
    return lookup.byId.get(rawValue);
  }

  const cleanedValue = rawValue
    .replace(/^(?:id-da-fonte|fonte|source|src)\s*:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();

  if (lookup.byId.has(cleanedValue)) {
    return lookup.byId.get(cleanedValue);
  }

  const idPrefixMatch = cleanedValue.match(/^([A-Z0-9]+(?:[-_][A-Z0-9]+)+)\s*:/i);
  if (idPrefixMatch && lookup.byId.has(idPrefixMatch[1])) {
    return lookup.byId.get(idPrefixMatch[1]);
  }

  const normalizedValue = normalizeSourceToken(cleanedValue);
  return normalizedValue ? (lookup.byAlias.get(normalizedValue) || null) : null;
}

function normalizeResponseCitations(response, sources = []) {
  if (!response) return response;

  const protectedBlocks = [];
  const protectedResponse = String(response).replace(
    /\[(?:LATEX_GRAPH_TITLE|MINDMAP_TITLE):\s*[^\]]+?\s*\]\s*\[(?:LATEX_GRAPH_CODE|MINDMAP_CODE)\][\s\S]*?\[\/(?:LATEX_GRAPH_CODE|MINDMAP_CODE)\]/gi,
    match => {
      const token = `__LATEX_VISUAL_BLOCK_${protectedBlocks.length}__`;
      protectedBlocks.push(match);
      return token;
    }
  );

  const lookup = buildSourceLookup(sources);
  const normalized = protectedResponse.replace(/\[([^\]]+)\]/g, (match, rawReference) => {
    const token = String(rawReference || '').trim();
    if (/^(?:PHET|PDB|OFFLINE_DOC|LATEX_GRAPH_TITLE|LATEX_GRAPH_CODE|\/LATEX_GRAPH_CODE|MINDMAP_TITLE|MINDMAP_CODE|\/MINDMAP_CODE|CONFIANCA|CONFIANÇA|IMAGEM ENVIADA PELO ALUNO)\b/i.test(token)) {
      return match;
    }

    const source = resolveSourceReference(token, lookup);
    if (source) {
      return `[ID-DA-FONTE: ${source.id}]`;
    }

    if (/^(?:id-da-fonte|fonte|source|src)\s*:/i.test(token)) {
      return '';
    }

    if (
      /^(?:web|search|source|src|ref|citation|connector|result|tavily|wikipedia|nasa|esa|arxiv|pubmed|scielo)[-_ ]*[a-z0-9-]*\d+$/i.test(token) ||
      /^[A-Z]{2,}(?:[-_][A-Z0-9]+)+$/i.test(token)
    ) {
      return '';
    }

    return match;
  });

  return normalized.replace(/__LATEX_VISUAL_BLOCK_(\d+)__/g, (match, index) => {
    return protectedBlocks[Number(index)] || match;
  });
}

function detectPhetSimulation(userQuestion = '', response = '', selectedConnectors = []) {
  const activeConnectors = Array.isArray(selectedConnectors) ? selectedConnectors : [];
  if (!activeConnectors.includes('phet')) return null;

  const text = String(userQuestion || '').toLowerCase();
  const catalog = [
    {
      pattern: /\b(átomo|atomo|próton|proton|nêutron|neutron|elétron|eletron|camada eletrônica|estrutura atômica|forma um átomo|formaçao do átomo|formacao do atomo)\b/,
      slug: 'build-an-atom',
      guide: 'Monte prótons, nêutrons e elétrons e observe como o elemento muda.',
      theory: 'O átomo é definido pelo número de prótons; nêutrons alteram isótopos e elétrons controlam a carga.',
    },
    {
      pattern: /\b(isótopo|isotopo|massa atômica|massa atomica|número atômico|numero atomico|numero de massa)\b/,
      slug: 'isotopes-and-atomic-mass',
      guide: 'Compare prótons e nêutrons para ver como surgem diferentes isótopos.',
      theory: 'Isótopos têm o mesmo elemento químico, mas mudam no número de nêutrons e na massa total.',
    },
    {
      pattern: /\b(molécula|molecula|ligação química|ligacao quimica|montar molécula|montar molecula)\b/,
      slug: 'build-a-molecule',
      guide: 'Combine átomos e veja como a estrutura molecular aparece em tempo real.',
      theory: 'Moléculas surgem quando átomos compartilham ou reorganizam elétrons em ligações químicas.',
    },
    {
      pattern: /\b(ph|escala de ph|acid-base|acido-base|acidez|basicidade)\b/,
      slug: 'ph-scale',
      guide: 'Teste soluções diferentes e acompanhe a mudança do pH na escala.',
      theory: 'O pH mede a concentração relativa de íons ligados à acidez e à basicidade da solução.',
    },
    {
      pattern: /\b(circuito|corrente elétrica|corrente eletrica|voltagem|tensão elétrica|tensao eletrica|resistor)\b/,
      slug: 'circuit-construction-kit-dc',
      guide: 'Monte o circuito com bateria, fios e resistores e acompanhe a corrente.',
      theory: 'A corrente elétrica depende da diferença de potencial e do caminho fechado do circuito.',
    },
    {
      pattern: /\b(ohm|resistência elétrica|resistencia eletrica)\b/,
      slug: 'ohms-law',
      guide: 'Ajuste tensão e resistência para observar a corrente variar pela Lei de Ohm.',
      theory: 'A Lei de Ohm conecta tensão, corrente e resistência em circuitos simples.',
    },
    {
      pattern: /\b(faraday|indução eletromagnética|inducao eletromagnetica|fluxo magnético|fluxo magnetico)\b/,
      slug: 'faradays-law',
      guide: 'Mova o ímã e a espira para ver a indução surgir instantaneamente.',
      theory: 'A variação do fluxo magnético induz corrente elétrica no circuito.',
    },
    {
      pattern: /\b(força|forca|movimento|aceleração|aceleracao|segunda lei de newton)\b/,
      slug: 'forces-and-motion-basics',
      guide: 'Aplique forças diferentes e compare como massa e atrito alteram o movimento.',
      theory: 'A aceleração depende da força resultante e da massa do sistema.',
    },
  ];

  return catalog.find(entry => entry.pattern.test(text)) || null;
}

function formatPhetTitle(slug = '') {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map(token => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function ensureInteractiveTags(response, userQuestion, selectedConnectors = []) {
  let finalResponse = String(response || '').trim();
  if (!finalResponse) return finalResponse;

  if (!/\[PHET:/i.test(finalResponse)) {
    const phetMatch = detectPhetSimulation(userQuestion, finalResponse, selectedConnectors);
    if (phetMatch) {
      finalResponse = `${finalResponse}\n\n[PHET:${phetMatch.slug}|${phetMatch.guide}|${phetMatch.theory}]`;
    }
  }

  return finalResponse;
}

function stripConfidenceTags(response = '') {
  return String(response || '')
    .replace(/\[\s*CONFIAN[ÇC]A\s*:\s*[^\]]+\]/gi, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeFinalResponse(response = '') {
  return stripConfidenceTags(
    String(response || '')
      .replace(/^Como\s+Revisor[\s\S]*?\n/i, '')
      .replace(/\[\/LATEX_GRAPH_TITLE\]/gi, ' ')
      .replace(/\[LATEX_GRAPH_CODE\]|\[\/LATEX_GRAPH_CODE\]/gi, ' ')
      .replace(/\[\/MINDMAP_TITLE\]/gi, ' ')
      .replace(/\[MINDMAP_CODE\]|\[\/MINDMAP_CODE\]/gi, ' ')
      .replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/gi, ' ')
      .replace(/\\usepackage(?:\[[^\]]*\])?\{[^}]+\}/gi, ' ')
      .replace(/\\begin\{document\}|\\end\{document\}/gi, ' ')
      .replace(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/gi, ' ')
      .replace(/\\begin\{axis\}[\s\S]*?\\end\{axis\}/gi, ' ')
      .replace(/\\pgfplotsset\{[^}]+\}/gi, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  );
}

function softenUnsupportedSuperlatives(response = '', sources = []) {
  let text = String(response || '');
  const sourceText = (sources || [])
    .map(source => `${source.label || ''} ${source.detail || ''} ${source.url || ''}`.toLowerCase())
    .join(' ');

  if (!/maior montanha|largest mountain|olympus mons/i.test(sourceText)) {
    text = text.replace(
      /\b(Monte Olimpo|Olympus Mons),\s*a\s+segunda montanha mais alta conhecida no Sistema Solar/gi,
      '$1, um dos relevos mais impressionantes do Sistema Solar'
    );
    text = text.replace(
      /\b(Monte Olimpo|Olympus Mons),\s*a\s+maior montanha conhecida no Sistema Solar/gi,
      '$1, um enorme vulcão marciano'
    );
  }

  text = text
    .replace(/\bEssa característica é única no Sistema Solar\b/gi, 'Essa é uma das características mais marcantes de Marte')
    .replace(/\bCom a continuação da exploração e pesquisa, esperamos aprender mais sobre [^.!?]+[.!?]/gi, 'A exploração de Marte continua ajudando os cientistas a entender melhor a história e a composição desse planeta.')
    .replace(/\bSe você tiver mais perguntas específicas[^.!?]*[.!?]/gi, '')
    .replace(/\bPosso tentar fornecer mais informa[cç][õo]es[^.!?]*[.!?]/gi, 'Marte ainda guarda muitos segredos, e a próxima grande descoberta pode vir de um cientista como você!')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

function isAstronomyPrimaryQuery(userQuestion = '', selectedConnectors = []) {
  const text = String(userQuestion || '').toLowerCase();
  const astronomyTopic = /\b(marte|mars|terra|earth|venus|v[eê]nus|j[uú]piter|jupiter|saturno|mercurio|merc[uú]rio|netuno|neptune|urano|uranus|plut[aã]o|plutao|lua|moon|sol|sun|planeta|astronomia|sistema solar|exoplaneta|kepler|tess|gal[aá]xia|estrela|orbita|órbita)\b/.test(text);
  const primaryAstronomyConnector = selectedConnectors.some(key => ['nasa', 'horizons', 'solarsystem', 'exoplanets', 'kepler', 'esa', 'stellarium', 'sdo'].includes(key));
  return astronomyTopic && primaryAstronomyConnector;
}

// ============ STEP 2: Execute Research & Reasoning ============
async function executeAgentPlan(userQuestion, actionPlan, logs, options = {}) {
  const connectorAuto = options.connectorAuto !== false;
  const userConnectors = Array.isArray(options.connectors) ? options.connectors : [];
  const recoveryMode = options.recoveryMode === true;
  const overrideQuery = String(options.overrideQuery || '').trim();
  const overrideRequiredConnectors = filterSupportedConnectors(options.overrideRequiredConnectors || []);
  const overrideOptionalConnectors = filterSupportedConnectors(options.overrideOptionalConnectors || []);
  const overrideForbiddenConnectors = new Set(filterSupportedConnectors(options.overrideForbiddenConnectors || []));
  const baseRecoveryConnectors = filterSupportedConnectors(options.baseConnectors || []);
  const focusFacts = Array.isArray(options.focusFacts) ? options.focusFacts.map(item => String(item || '').trim()).filter(Boolean) : [];
  const isFactCheck = actionPlan?.intent === 'fact_check' || detectFactCheckIntent(userQuestion, options.visionContext || '');

  const autoDetectedConnectors = [];
  const normalizedText = (userQuestion || '').toLowerCase();

  if (isFactCheck) {
    autoDetectedConnectors.push('tavily', 'wikipedia', 'wikidata', 'serpapi-news');
    if (actionPlan?.exige_busca_reversa || options.factCheckImageUrl) {
      autoDetectedConnectors.push('serpapi-lens');
    }
    if (/\b(nasa|espaco|espaço|astronomia|marte|lua|sol|satellite|satélite)\b/.test(normalizedText)) autoDetectedConnectors.push('nasa');
    if (/\b(brasil|governo|beneficio|benefício|ministerio|ministério|lei|camara|câmara|politica|política)\b/.test(normalizedText)) autoDetectedConnectors.push('brasilapi', 'camara', 'transparencia');
    if (/\b(saude|saúde|vacina|sus|anvisa|hospital|medicamento|oms|opas)\b/.test(normalizedText)) autoDetectedConnectors.push('datasus', 'pubmed', 'openfda');
  }

  if (/\b(Ã¡tomo|atomo|prÃ³ton|proton|nÃªutron|neutron|elÃ©tron|eletron|isÃ³topo|isotopo|molÃ©cula|molecula|ligaÃ§Ã£o quÃ­mica|ligacao quimica|ph|acidez|basicidade|circuito|corrente elÃ©trica|corrente eletrica|voltagem|tensÃ£o elÃ©trica|tensao eletrica|resistor|ohm|faraday|induÃ§Ã£o eletromagnÃ©tica|inducao eletromagnetica|forÃ§a|forca|segunda lei de newton)\b/.test(normalizedText)) {
    autoDetectedConnectors.push('phet');
  }
  
  if (/\b(formiga|ant|ants|himenóptero|genus|inseto|antweb)\b/i.test(normalizedText)) autoDetectedConnectors.push('antweb');
  if (/\b(peixe|oceano|fishwatch|sustentabilidade|pesca|marinho)\b/.test(normalizedText)) autoDetectedConnectors.push('fishwatch');
  if (/\b(elemento|química|tabela periódica|elétrons|átomo|metal|massa atômica)\b/.test(normalizedText)) autoDetectedConnectors.push('periodictable');
  if (/\b(livro|literatura|gutenberg|autor|clássico|ebook)\b/.test(normalizedText)) autoDetectedConnectors.push('gutenberg');
  if (/\b(bíblia|versículo|escritura|evangelho)\b/.test(normalizedText)) autoDetectedConnectors.push('bible');
  if (/\b(iss|estação espacial internacional|estacao espacial internacional)\b/.test(normalizedText)) autoDetectedConnectors.push('iss');
  if (/\b(satélite|órbita|celestrak|rastreio)\b/.test(normalizedText)) autoDetectedConnectors.push('celestrak');
  if (/\b(lançamento|foguete|missão espacial|spacedevs|voo espacial)\b/.test(normalizedText)) autoDetectedConnectors.push('spacedevs');
  if (/\b(planeta|sistema solar|corpo celeste|órbita solar)\b/.test(normalizedText)) autoDetectedConnectors.push('solarsystem');
  if (/\b(sunrise|sunset|nascer do sol|pôr do sol|por do sol|amanhecer|anoitecer)\b/.test(normalizedText)) autoDetectedConnectors.push('sunrise');
  if (/\b(frase|citação|pensamento|quotes|inspirar)\b/i.test(normalizedText)) autoDetectedConnectors.push('quotes', 'quotes-free');
  if (/\b(cachorro|cão|raça|dog|pet)\b/.test(normalizedText)) autoDetectedConnectors.push('dogapi');
  if (/\b(ar|poluição|qualidade do ar|openaq|smog)\b/.test(normalizedText)) autoDetectedConnectors.push('openaq');
  if (/\b(constante|física|codata|velocidade da luz|planck)\b/.test(normalizedText)) autoDetectedConnectors.push('codata');
  if (/\b(clima|temperatura|umidade|chuva|vento|previsão|previsao|meteorolog|frente fria|onda de calor)\b/.test(normalizedText)) autoDetectedConnectors.push('open-meteo');
  
  // Maga Expansão Keys
  if (/\b(comida|alimento|food|caloria|nutrição|ingrediente)\b/.test(normalizedText)) autoDetectedConnectors.push('openfoodfacts');
  if (/\b(imagem|foto|picsum|paisagem)\b/.test(normalizedText)) autoDetectedConnectors.push('picsum');
  if (/\b(universo|cosmos|openuniverse|galáxia|espaço profundo)\b/.test(normalizedText)) autoDetectedConnectors.push('openuniverse');
  if (/\b(esa|europa|agência espacial europeia)\b/.test(normalizedText)) autoDetectedConnectors.push('esa');
  if (/\b(estrela|constelação|céu|stellarium|mapa estelar)\b/.test(normalizedText)) autoDetectedConnectors.push('stellarium');
  if (/\b(onda|gravidade|ligo|virgo|colisão|buraco negro)\b/.test(normalizedText)) autoDetectedConnectors.push('ligo');
  if (/\b(sol|sdo|atividade solar|mancha solar)\b/.test(normalizedText)) autoDetectedConnectors.push('sdo');
  if (/\b(posição|posicao|onde está|onde esta|agora|hoje|visível|visivel|horizons|efeméride|efemeride|azimute|elevação|elevacao)\b/.test(normalizedText) && /\b(marte|mars|júpiter|jupiter|saturno|saturn|venus|vênus|lua|moon|mercurio|mercúrio|sol|sun|urano|uranus|netuno|neptune|plutao|plutão)\b/.test(normalizedText)) autoDetectedConnectors.push('horizons');
  if (/\b(exoplaneta|planeta|kepler|tess|estrela binária)\b/.test(normalizedText)) autoDetectedConnectors.push('exoplanets', 'kepler');
  if (/\b(matemática|álgebra|calculadora|mathjs|matriz|equação complexa)\b/.test(normalizedText)) autoDetectedConnectors.push('mathjs');
  if (/\b(wolfram|equação diferencial|equacao diferencial|limite|transformada|sistema linear|integral imprópria|integral impropria|álgebra linear|algebra linear|resolver simbolicamente|derivada parcial)\b/.test(normalizedText)) autoDetectedConnectors.push('wolfram');
  if (/\b(química|composto|molécula|pubchem|farmac|3d)\b/.test(normalizedText)) autoDetectedConnectors.push('pubchem', 'pubchem-bio');
  if (/\b(gene|genoma|dna|rna|ensembl|mygene|mutação)\b/.test(normalizedText)) autoDetectedConnectors.push('ensembl', 'mygene');
  if (/\b(proteína|aminoácido|uniprot|interação|string)\b/.test(normalizedText)) autoDetectedConnectors.push('uniprot', 'string-db', 'reactome');
  if (/\b(saúde|médico|fda|datasus|sus|hospital|vacina)\b/.test(normalizedText)) autoDetectedConnectors.push('openfda', 'datasus', 'covid-jhu');
  if (/\b(genética|heran|clinvar|câncer|cosmic)\b/.test(normalizedText)) autoDetectedConnectors.push('clinvar', 'cosmic');
  if (/\b(clima|aquecimento|mudança climática|worldbank|noaa)\b/.test(normalizedText)) autoDetectedConnectors.push('noaa-climate', 'worldbank-climate');
  if (/\b(água|rio|usgs|recurso hídrico|seca|enchente)\b/.test(normalizedText)) autoDetectedConnectors.push('usgs-water');
  if (/\b(queimada|fogo|incêndio|firms|fumaça)\b/.test(normalizedText)) autoDetectedConnectors.push('firms');
  if (/\b(curso|aula|educação|mit|edx|mec|escola)\b/.test(normalizedText)) autoDetectedConnectors.push('edx', 'mit-ocw', 'mec-ejovem', 'educ4share');
  if (/\b(governo|transparência|tcu|gastos|público|dinheiro)\b/.test(normalizedText)) autoDetectedConnectors.push('tcu', 'transparencia');
  if (/\b(arte|museu|pessoal|met|getty|pintura|escultura)\b/.test(normalizedText)) autoDetectedConnectors.push('metmuseum', 'getty');
  if (/\b(libras|sinal|surdo|mudo)\b/.test(normalizedText)) autoDetectedConnectors.push('libras');
  if (/\b(modelo 3d|sketchfab|objetos|realidade)\b/.test(normalizedText)) autoDetectedConnectors.push('sketchfab');
  if (/\b(timelapse|earth|google|satélite|evolução)\b/.test(normalizedText)) autoDetectedConnectors.push('timelapse');

  if (/\b(arxiv|paper|artigo|pesquisa|estudo|tese|scielo)\b/.test(normalizedText)) {
    autoDetectedConnectors.push('arxiv');
    if (/\b(scielo|brasil|português|tese)\b/.test(normalizedText)) autoDetectedConnectors.push('scielo');
  }
  
  if (/\b(brasil|ibge|demografia|população|estado|cidade|saneamento|município|censo|pib|desemprego|inflacao|inflação|renda|domic[ií]lio|domicilio|economia brasileira|indicador social)\b/.test(normalizedText)) {
    autoDetectedConnectors.push('ibge');
  }

  if (/\b(médico|saúde|doença|vírus|pubmed|tratamento|vacina|biomed)\b/.test(normalizedText)) {
    autoDetectedConnectors.push('pubmed');
  }
  
  if (/\b(conceito|definição|o que é|explica|explicar|definir|wikidata|quem foi|onde fica)\b/.test(normalizedText)) {
    autoDetectedConnectors.push('wikipedia');
    autoDetectedConnectors.push('wikidata');
  }

  if (/\b(proteína|molécula|pdb|rcsb|estrutura 3d|hemoglobina|insulina|enzima)\b/.test(normalizedText)) {
    autoDetectedConnectors.push('rcsb');
  }
  
  if (/\b(matemática|equação|integral|derivada|cálculo|somar|subtrair|multiplicar|dividir)\b/.test(normalizedText)) autoDetectedConnectors.push('newton');
  if (/\b(espaço|nasa|planeta|satélite|foguete|astronomia|marte|lua|asteroide|asteróide)\b/.test(normalizedText)) {
    autoDetectedConnectors.push('nasa');
    autoDetectedConnectors.push('spacex');
  }

  // 2-d: Ativar conectores científicos automaticamente por domínio amplo
  // Ciência geral → wikipedia + arxiv + scielo como base de conhecimento
  if (/\b(ciência|científico|cientista|pesquisador|laboratório|experimento|hipótese|teoria|lei|fenômeno|reação|célula|organismo|evolução|genética|biologia|física|química|geologia|ecologia|botânica|zoologia|microbiologia|bioquímica|neurociência|fisiologia|anatomia|histologia|embriologia|paleontologia|taxonomia)\b/.test(normalizedText)) {
    autoDetectedConnectors.push('wikipedia', 'wikidata', 'arxiv');
    if (/\b(brasil|português|tese|scielo)\b/.test(normalizedText)) autoDetectedConnectors.push('scielo');
  }
  // Geografia ampla → ibge + wikipedia + open-meteo
  if (/\b(geografia|continente|país|região|capital|fronteira|relevo|hidrografia|bacia|rio|montanha|cordilheira|planalto|planície|litoral|clima|bioma|cerrado|amazônia|caatinga|pantanal|pampa|mata atlântica|deserto|floresta|savana|tundra|latitude|longitude|hemisfério|trópico|equador|meridiano|cartografia|mapa|território)\b/.test(normalizedText)) {
    autoDetectedConnectors.push('wikipedia', 'wikidata', 'ibge', 'open-meteo');
  }
  // Astronomia ampla → nasa + solarsystem + stellarium + exoplanets
  if (/\b(astronomia|astrônomo|telescópio|nebulosa|galáxia|via láctea|big bang|cosmologia|supernova|quasar|pulsar|anã branca|gigante vermelha|matéria escura|energia escura|radiação cósmica|espectro|magnitude|parsec|ano-luz|órbita|periélio|afélio|eclipse|equinócio|solstício|precessão|astrofísica|radioastronomia|astrobiologia)\b/.test(normalizedText)) {
    autoDetectedConnectors.push('nasa', 'solarsystem', 'stellarium', 'exoplanets', 'kepler', 'wikipedia');
  }

  let requestedConnectors;
  if (connectorAuto) {
    if (recoveryMode) {
      const heuristicSet = new Set([...autoDetectedConnectors, ...baseRecoveryConnectors]);
      overrideForbiddenConnectors.forEach(key => heuristicSet.delete(key));
      overrideRequiredConnectors.forEach(key => heuristicSet.add(key));
      overrideOptionalConnectors.forEach(key => heuristicSet.add(key));
      requestedConnectors = [...heuristicSet];
      logs.push(`🤖 Recuperação autônoma: conectores reajustados (${requestedConnectors.join(', ') || 'nenhum'})`);
      if (focusFacts.length > 0) {
        logs.push(`🎯 Fatos-alvo da recuperação: ${focusFacts.join('; ')}`);
      }
    } else {
      const routingAnalysis = await analyzeConnectorRouting(userQuestion, autoDetectedConnectors, actionPlan, options.history || [], logs);
      if (routingAnalysis) {
        const heuristicSet = new Set(autoDetectedConnectors);
        routingAnalysis.connectors_forbidden.forEach(key => heuristicSet.delete(key));
        routingAnalysis.connectors_required.forEach(key => heuristicSet.add(key));
        routingAnalysis.connectors_optional.forEach(key => heuristicSet.add(key));
        requestedConnectors = [...heuristicSet];
        if (routingAnalysis.area || routingAnalysis.intent) {
          logs.push(`🧭 Roteador Groq: ${routingAnalysis.area || 'area não definida'} / ${routingAnalysis.intent || 'intenção não definida'}`);
        }
        if (routingAnalysis.reasoning) {
          logs.push(`🧭 Critério do roteador: ${routingAnalysis.reasoning}`);
        }
        if (routingAnalysis.needs_visual && routingAnalysis.visual_type !== 'none') {
          logs.push(`📈 Sinal visual do roteador: ${routingAnalysis.visual_type}`);
        }
      } else {
        requestedConnectors = [...new Set(autoDetectedConnectors)];
      }
    }
  } else {
    requestedConnectors = [...new Set(userConnectors.map(c => c.toLowerCase()))];
  }
  const removedMaintenanceConnectors = requestedConnectors.filter(key => CONNECTORS_IN_MAINTENANCE.has(key));
  const selectedConnectors = filterSupportedConnectors(requestedConnectors);

  const useNasa = options.useNasa === true || selectedConnectors.includes('nasa');

  // Track which sources were used for answering (web + NASA)
  const sources = [];

  // Function to add sources for citation
  function addSource(id, label, type, detail, url) {
    const safeId = String(id || 'SOURCE').trim() || 'SOURCE';
    const safeLabel = String(label || safeId).trim() || safeId;
    const safeType = String(type || 'generic').trim() || 'generic';
    const safeDetail = String(detail || '').trim();
    const safeUrl = typeof url === 'string' && url.trim() ? url.trim() : null;

    const duplicateSource = sources.find(source =>
      source.label === safeLabel &&
      source.type === safeType &&
      source.detail === safeDetail &&
      source.url === safeUrl
    );

    if (duplicateSource) {
      return duplicateSource;
    }

    let finalId = safeId;
    let counter = 2;
    while (sources.some(source => source.id === finalId)) {
      finalId = `${safeId}-${counter}`;
      counter += 1;
    }

    const source = { id: finalId, label: safeLabel, type: safeType, detail: safeDetail, url: safeUrl };
    sources.push(source);
    return source;
  }
logs.push('🧠 Iniciando raciocínio (processo interno)');
  if (removedMaintenanceConnectors.length > 0) {
    logs.push(`🛠️ Conectores em manutencao e temporariamente ignorados: ${removedMaintenanceConnectors.join(', ')}`);
  }

  let context = '';
  let nasaMedia = [];
  const media = [];
  const phetSuggestion = detectPhetSimulation(userQuestion, '', selectedConnectors);
  
  const queryParaBuscar = overrideQuery || (actionPlan?.termo_de_busca && actionPlan.termo_de_busca !== 'null' ? actionPlan.termo_de_busca : userQuestion);

  if (phetSuggestion) {
    const phetTitle = formatPhetTitle(phetSuggestion.slug);
    const phetUrl = `https://phet.colorado.edu/sims/html/${phetSuggestion.slug}/latest/${phetSuggestion.slug}_all.html`;
    addSource('PHET-1', `PhET: ${phetTitle}`, 'phet', phetSuggestion.theory || phetSuggestion.guide || 'Simulação interativa recomendada para este conceito.', phetUrl);
    context += `\n\n🧪 Simulação interativa disponível (PhET): ${phetTitle}\nComo usar: ${phetSuggestion.guide}\nBase teórica: ${phetSuggestion.theory}\nLink: ${phetUrl}\n`;
    logs.push(`🧪 Simulação PhET preparada: ${phetTitle}`);
  }

  if (isFactCheck) {
    const claimQuery = actionPlan?.alegacao_principal || queryParaBuscar;
    logs.push(`Modo fact-check ativado para a alegacao: "${claimQuery}"`);

    if (selectedConnectors.includes('serpapi-news')) {
      logs.push('Buscando cobertura jornalistica via SerpApi Google News...');
      const newsHits = await searchSerpApiGoogleNews(claimQuery);
      if (Array.isArray(newsHits) && newsHits.length > 0) {
        context += `\n\nCobertura jornalistica (SerpApi Google News):\n`;
        newsHits.forEach((item, index) => {
          context += `${index + 1}. ${item.title} | Fonte: ${item.source || 'N/A'} | Data: ${item.date || 'N/A'}\n${item.snippet || ''}\nLink: ${item.link}\n`;
          addSource(`NEWS-${index + 1}`, item.title || `Google News ${index + 1}`, 'serpapi-news', `${item.source || 'Fonte desconhecida'} - ${item.snippet || ''}`.trim(), item.link);
          if (item.thumbnail) {
            media.push({ title: item.title, url: item.thumbnail, media_type: 'image', description: item.source || 'Cobertura jornalistica' });
          }
        });
        logs.push(`${newsHits.length} resultados de noticias coletados`);
      }
    }

    if (selectedConnectors.includes('serpapi-lens') && options.factCheckImageUrl) {
      logs.push('Executando busca reversa de imagem via Google Lens...');
      const lensHits = await searchSerpApiGoogleLens(options.factCheckImageUrl);
      if (lensHits?.visualMatches?.length > 0) {
        context += `\n\nBusca reversa de imagem (Google Lens):\n`;
        lensHits.visualMatches.forEach((item, index) => {
          context += `${index + 1}. ${item.title || 'Sem titulo'} | Fonte: ${item.source || 'N/A'}\nLink: ${item.link || 'N/A'}\n`;
          addSource(`LENS-${index + 1}`, item.title || `Lens resultado ${index + 1}`, 'serpapi-lens', item.source || 'Correspondencia visual', item.link);
          if (item.thumbnail) {
            media.push({ title: item.title || `Lens ${index + 1}`, url: item.thumbnail, media_type: 'image', description: item.source || 'Correspondencia visual do Google Lens' });
          }
        });
        logs.push('Busca reversa de imagem concluida');
      }
    }

    const factCheckScoped = await searchTavilyScoped(claimQuery, {
      includeDomains: ['g1.globo.com', 'aosfatos.org', 'lupa.uol.com.br', 'boatos.org', 'gov.br', 'who.int', 'opas.org.br'],
      maxResults: 8,
      includeAnswer: true,
    });
    if (factCheckScoped?.results?.length > 0) {
      context += `\n\nChecagens e fontes oficiais priorizadas:\nResumo: ${factCheckScoped.answer || 'Sem resumo consolidado.'}\n`;
      factCheckScoped.results.forEach((item, index) => {
        context += `${index + 1}. ${item.title}\n${item.snippet || ''}\nLink: ${item.url}\n`;
        addSource(`FACT-${index + 1}`, item.title || `Fact-check ${index + 1}`, 'fact-check', item.snippet || '', item.url);
      });
      logs.push('Dominios de checagem consultados');
    }
  }

  const isEarthquakeQuery = selectedConnectors.includes('usgs') && 
    /terremoto|sismo|tremor|abalo|sism|quake/i.test(userQuestion);
  const isSunQuery = selectedConnectors.includes('sunrise') &&
    /sol|sunrise|sunset|nascer|pôr|por do sol/i.test(userQuestion);

  // Tavily:
  // 1. Em modo auto, roda por padrão como camada principal de contexto geral
  // 2. Em modo manual, só roda se o usuário selecionar explicitamente 'tavily'
  const isAstronomyPrimary = isAstronomyPrimaryQuery(userQuestion, selectedConnectors);
  const forcedTavilyByRecovery = recoveryMode && selectedConnectors.includes('tavily');
  const podeBuscarWeb = forcedTavilyByRecovery
    ? true
    : connectorAuto
      ? !isEarthquakeQuery && !isSunQuery && !isAstronomyPrimary
      : selectedConnectors.includes('tavily');

  if (podeBuscarWeb) {
    logs.push(`🌐 Buscando na web: "${queryParaBuscar}"`);
    const searchResult = await searchTavily(queryParaBuscar);
    if (searchResult) {
      context += `\n\n📰 Resultados de busca web (use apenas como complemento, NUNCA para dados em tempo real como terremotos ou clima):\n`;
      context += `Resposta resumida: ${searchResult.answer}\n\n`;
      searchResult.results.forEach((r, i) => {
        context += `${i + 1}. ${r.title}\n   ${r.snippet}\n   Link: ${r.url}\n`;
      });
      addSource('WEB-SUMMARY', 'Resumo da busca web (Tavily)', 'web', searchResult.answer, null);
      searchResult.results.forEach((r, i) => {
        addSource(`WEB-${i + 1}`, r.title || `Web resultado ${i + 1}`, 'web', r.snippet, r.url);
      });
      logs.push('✅ Dados da web coletados');
    } else {
      logs.push('⚠️ Tavily API não disponível');
    }
  } else if (!connectorAuto && !selectedConnectors.includes('tavily')) {
    logs.push('🔒 Modo manual: busca web desativada (Tavily não selecionado)');
  } else if (isEarthquakeQuery) {
    logs.push('🚫 Tavily suprimido: dados sísmicos via USGS são a fonte primária autorizada');
  } else if (isSunQuery) {
    logs.push('🚫 Tavily suprimido: dados solares via Sunrise-Sunset API são a fonte primária');
  } else {
    logs.push('🔹 Busca web não necessária (dados já coletados pelos conectores)');
  }


  logs.push(`🔌 Conectores habilitados para esta pergunta: ${selectedConnectors.join(', ') || 'nenhum'}`);

  if (!podeBuscarWeb && isAstronomyPrimary) {
    logs.push('Astronomia: priorizando fontes espaciais primarias em vez de web generica.');
  }

  // Data de cada conector
  
  if (selectedConnectors.includes('scielo')) {
    logs.push(`📚 Buscando na SciELO: "${queryParaBuscar}"`);
    const scielo = await buscarSciELORobusto(queryParaBuscar);
    if (scielo && scielo.length > 0) {
      scielo.forEach((item, i) => {
        context += `\n\n🇧🇷 SciELO ${i + 1}: ${item.title}\nAutores: ${item.authors}\nResumo: ${item.summary}\nLink: ${item.link}\n`;
        addSource(`SCIELO-${i + 1}`, item.title || `SciELO ${i + 1}`, 'scielo', item.summary || '', item.link);
      });
      logs.push('✅ Dados SciELO coletados');
    }
  }

  if (selectedConnectors.includes('ibge')) {
    logs.push(`📊 Buscando no IBGE: "${queryParaBuscar}"`);
    const ibge = await buscarIBGE(queryParaBuscar);
    if (ibge && ibge.length > 0) {
      ibge.forEach((item, i) => {
        context += `\n\n🇧🇷 IBGE Notícia ${i + 1} (${item.date}): ${item.title}\n${item.summary}\nLink: ${item.link}\n`;
        addSource(`IBGE-${i + 1}`, item.title || `IBGE ${i + 1}`, 'ibge', item.summary || '', item.link);
      });
      logs.push('✅ Dados IBGE coletados');
    }
  }

  if (selectedConnectors.includes('openlibrary')) {
    logs.push(`📚 Buscando na Open Library: "${queryParaBuscar}"`);
    const books = await buscarOpenLibrary(queryParaBuscar);
    if (books && books.length > 0) {
      books.forEach((b, i) => {
        context += `\n\n📖 Livro ${i + 1}: ${b.title}\nAutor: ${b.author}\nAno: ${b.year}\nAssuntos: ${b.subject}\nLink: ${b.link}\n`;
        addSource(`BOOK-${i + 1}`, b.title, 'openlibrary', `Autor: ${b.author}, Ano: ${b.year}`, b.link);
      });
      logs.push('✅ Livros encontrados na Open Library');
    }
  }

  if (selectedConnectors.includes('gbif')) {
    logs.push(`🌿 Buscando no GBIF (Biodiversidade): "${queryParaBuscar}"`);
    const species = await buscarGBIF(queryParaBuscar);
    if (species && species.length > 0) {
      species.forEach((s, i) => {
        context += `\n\n🧬 Espécie ${i + 1}: ${s.scientificName} (${s.canonicalName || 'S/N'})\nReino: ${s.kingdom}, Filo: ${s.phylum}, Família: ${s.family}\nStatus: ${s.status}\n`;
        addSource(`GBIF-${i + 1}`, s.canonicalName || s.scientificName, 'gbif', `Taxonomia: ${s.kingdom} > ${s.family}`, null);
      });
      logs.push('✅ Dados de biodiversidade do GBIF coletados');
    }
  }

  if (selectedConnectors.includes('usgs')) {
    logs.push(`🌍 Buscando Terremotos no USGS (últimas 24h)...`);
    const quakes = await buscarUSGS();
    if (quakes && quakes.length > 0) {
      context += `\n\n📡 USGS - Terremotos nas últimas 24h (magnitude ≥ 3.5):\n`;
      quakes.forEach((q, i) => {
        context += `${i + 1}. Magnitude ${q.mag} em ${q.place} | Hora: ${q.time} | Profundidade: ${q.depth}km | ${q.url}\n`;
        addSource(`USGS-${i + 1}`, `Mag ${q.mag} em ${q.place}`, 'usgs', `Magnitude: ${q.mag}, Profundidade: ${q.depth}km`, q.url);
      });
      logs.push(`✅ ${quakes.length} terremotos encontrados pelo USGS`);
    } else {
      context += `\n\n📡 USGS: Nenhum terremoto significativo (≥3.5) nas últimas 24 horas. Planeta tranquilo por hoje!\n`;
      logs.push('✅ USGS consultado: sem terremotos relevantes nas últimas 24h');
    }
  }

  if (selectedConnectors.includes('brasilapi')) {
    logs.push(`🇧🇷 Buscando dados via BrasilAPI...`);
    const brasil = await buscarBrasilAPI(queryParaBuscar);
    if (brasil) {
      const feriados = (brasil.feriados || []).slice(0, 5);
      context += `\n\n🇧🇷 BrasilAPI - Feriados Nacionais ${brasil.ano}:\n`;
      feriados.forEach(f => { context += `- ${f.date}: ${f.name} (${f.type})\n`; });
      addSource('BRASILAPI', 'BrasilAPI - Feriados', 'brasilapi', `Feriados do Brasil ${brasil.ano}`, 'https://brasilapi.com.br');
      logs.push('✅ Dados BrasilAPI coletados');
    }
  }

  if (selectedConnectors.includes('camara')) {
    logs.push(`🏛️ Buscando proposições na Câmara dos Deputados: "${queryParaBuscar}"`);
    const props = await buscarCamaraRobusto(queryParaBuscar);
    if (props && props.length > 0) {
      context += `\n\n🏛️ Câmara dos Deputados - Proposições sobre "${queryParaBuscar}":\n`;
      props.forEach((p, i) => {
        context += `${i + 1}. ${p.sigle} ${p.number}/${p.year} (${p.date}): ${p.summary}\n`;
        addSource(`CAMARA-${i + 1}`, `${p.sigle} ${p.number}/${p.year}`, 'camara', p.summary, p.url);
      });
      logs.push('✅ Proposições da Câmara coletadas');
    }
  }

  if (selectedConnectors.includes('iss')) {
    logs.push(`🛸 Buscando posição atual da ISS...`);
    const iss = await buscarISS();
    if (iss) {
      context += `\n\n🛸 Estação Espacial Internacional (ISS) agora:\nLatitude: ${iss.lat}° | Longitude: ${iss.lon}° | Horário: ${iss.timestamp}\n`;
      addSource('ISS', 'Dados Orbitais da ISS', 'iss', `Posição: ${iss.lat}°, ${iss.lon}°`, 'http://open-notify.org');
      logs.push('✅ Posição da ISS obtida');
    }
  }

  if (selectedConnectors.includes('sunrise')) {
    const userLat = options.userContext?.lat || -23.55;
    const userLon = options.userContext?.lon || -46.63;
    logs.push(`🌅 Buscando nascer/pôr do sol...`);
    const sun = await buscarSunriseSunset(userLat, userLon);
    if (sun) {
      context += `\n\n🌅 Nascer/Pôr do Sol hoje:\nNascer: ${sun.sunrise} | Pôr: ${sun.sunset} | Meio-dia solar: ${sun.solar_noon}\n`;
      addSource('SUNRISE', 'Nascer e Pôr do Sol', 'sunrise', `Nascer: ${sun.sunrise}, Pôr: ${sun.sunset}`, 'https://sunrise-sunset.org');
      logs.push('✅ Dados solares obtidos');
    }
  }

  if (selectedConnectors.includes('dictionary-en')) {
    logs.push(`📖 Buscando no Dicionário Inglês: "${queryParaBuscar}"`);
    const def = await buscarDicionarioIngles(queryParaBuscar.split(' ')[0]);
    if (def) {
      context += `\n\n📖 Free Dictionary (EN) - "${def.word}" ${def.phonetic || ''}:\n`;
      def.meanings.forEach(m => {
        context += `[${m.partOfSpeech}] ${m.definition}${m.example ? ` — Exemplo: "${m.example}"` : ''}\n`;
      });
      addSource('DICT-EN', `Free Dictionary: ${def.word}`, 'dictionary-en', def.meanings[0]?.definition || '', `https://api.dictionaryapi.dev/api/v2/entries/en/${def.word}`);
      logs.push('✅ Definição em inglês encontrada');
    }
  }

  if (selectedConnectors.includes('universities')) {
    logs.push(`🎓 Buscando universidades: "${queryParaBuscar}"`);
    const unis = await buscarUniversidades(queryParaBuscar);
    if (unis && unis.length > 0) {
      context += `\n\n🎓 Universidades encontradas:\n`;
      unis.forEach((u, i) => {
        context += `${i + 1}. ${u.name} (${u.country}) — ${u.web || 'N/A'}\n`;
        addSource(`UNI-${i + 1}`, u.name, 'universities', `País: ${u.country}`, u.web);
      });
      logs.push('✅ Dados de universidades coletados');
    }
  }

  if (selectedConnectors.includes('wikidata')) {
    logs.push(`🔍 Buscando no Wikidata: "${queryParaBuscar}"`);
    const wikiData = await buscarWikidata(queryParaBuscar);
    if (wikiData && wikiData.length > 0) {
      context += `\n\n🆔 Wikidata Knowledge:\n`;
      wikiData.forEach((w, i) => {
        context += `${i + 1}. ${w.label}: ${w.description}\n`;
        addSource(`WIKIDATA-${i + 1}`, w.label, 'wikidata', w.description, `https://www.wikidata.org/wiki/Special:Search?search=${encodeURIComponent(w.label)}`);
      });
      logs.push('✅ Dados do Wikidata coletados');
    }
  }

  if (selectedConnectors.includes('pubmed')) {
    logs.push(`🏥 Buscando no PubMed Central: "${queryParaBuscar}"`);
    const articles = await buscarPubMed(queryParaBuscar);
    if (articles && articles.length > 0) {
      context += `\n\n🏥 Artigos Médicos (PubMed):\n`;
      articles.forEach((a, i) => {
        context += `${i + 1}. ${a.title} | Autores: ${a.authors} | Fonte: ${a.source} (${a.pubdate})\n`;
        addSource(`PUBMED-${i + 1}`, a.title, 'pubmed', `${a.authors} - ${a.source}`, a.link);
      });
      logs.push('✅ Literatura médica coletada (PubMed)');
    }
  }

  if (selectedConnectors.includes('rcsb')) {
    logs.push(`🧬 Buscando estruturas 3D na RCSB PDB: "${queryParaBuscar}"`);
    const pdbIds = await buscarRCSBRobusto(queryParaBuscar);
    if (pdbIds && pdbIds.length > 0) {
      context += `\n\n🧬 Estruturas PDB encontradas: ${pdbIds.join(', ')}\n(Se for relevante, cite o ID e use a tag [PDB:id] para o visualizador 3D).\n`;
      addSource('PDB-1', `PDB ID: ${pdbIds[0]}`, 'rcsb', `Estrutura de proteína via Protein Data Bank`, `https://www.rcsb.org/structure/${pdbIds[0]}`);
      logs.push(`✅ ${pdbIds.length} estruturas de proteínas encontradas`);
    }
  }

  if (selectedConnectors.includes('antweb')) {
    logs.push(`🐜 Buscando formigas no AntWeb: "${queryParaBuscar}"`);
    const ants = await buscarAntWebRobusto(queryParaBuscar);
    if (ants && ants.length > 0) {
      context += `\n\n🐜 Dados de Formigas (AntWeb):\n`;
      ants.forEach((ant, i) => {
        context += `${i+1}. ${ant.scientific_name} (${ant.family})\n`;
        if (ant.image) media.push({ title: ant.scientific_name, url: ant.image, media_type: 'image', description: `Gênero: ${ant.genus}, Família: ${ant.family}` });
      });
      addSource('ANT-1', `AntWeb: ${ants[0].scientific_name}`, 'antweb', `Imagens e dados taxonômicos de formigas.`, `https://www.antweb.org/description.do?genus=${ants[0].genus}`);
      logs.push('✅ Imagens e dados de formigas coletados');
    }
  }

  if (selectedConnectors.includes('periodictable')) {
    logs.push(`⚛️ Buscando na Tabela Periódica: "${queryParaBuscar}"`);
    const element = await buscarTabelaPeriodicaRobusta(queryParaBuscar);
    if (element) {
      context += `\n\n⚛️ Dados do Elemento (${element.name}):\nSímbolo: ${element.symbol}, Massa: ${element.atomicMass}, Número: ${element.atomicNumber}, Configuração: ${element.electronicConfiguration}\n`;
      addSource('CHEM-1', `Tabela Periódica: ${element.name}`, 'periodictable', `Dados químicos oficiais do elemento ${element.name}.`, `https://pt.wikipedia.org/wiki/${element.name}`);
      logs.push('✅ Dados químicos coletados');
    }
  }

  if (selectedConnectors.includes('gutenberg')) {
    logs.push(`📖 Buscando livros no Project Gutenberg: "${queryParaBuscar}"`);
    const books = await buscarGutenberg(queryParaBuscar);
    if (books && books.length > 0) {
      context += `\n\n📖 Livros Disponíveis (Gutenberg):\n`;
      books.forEach((b, i) => {
        context += `${i+1}. ${b.title} por ${b.authors}\n`;
        addSource(`BOOK-${i+1}`, b.title, 'gutenberg', `Obra clássica de ${b.authors}`, b.link);
      });
      logs.push('✅ Obras literárias encontradas');
    }
  }

  if (selectedConnectors.includes('codata')) {
    logs.push(`🧪 Buscando constantes físicas (CODATA): "${queryParaBuscar}"`);
    const constants = await buscarCODATA(queryParaBuscar);
    if (constants && constants.length > 0) {
      context += `\n\n🧪 Constantes Físicas (CODATA):\n`;
      constants.forEach((c, i) => {
        context += `${i+1}. ${c.quantity}: ${c.value} ${c.unit} (Incerteza: ${c.uncertainty})\n`;
        addSource(`CONST-${i+1}`, c.quantity, 'codata', `${c.value} ${c.unit}`, 'https://physics.nist.gov/cuu/Constants/');
      });
      logs.push('✅ Constantes físicas coletadas');
    }
  }

  if (selectedConnectors.includes('sdo')) {
    logs.push(`☀️ Buscando atividade solar (SDO)...`);
    const sdo = await buscarSDO();
    if (sdo) {
      context += `\n\n☀️ Atividade Solar (SDO):\nDados de monitoramento solar em tempo real disponíveis.\n`;
      addSource('SDO-1', 'Solar Dynamics Observatory', 'sdo', 'Monitoramento da atividade solar NASA.', 'https://sdo.gsfc.nasa.gov/');
      logs.push('✅ Dados solares coletados');
    }
  }

  if (selectedConnectors.includes('libras')) {
    logs.push(`🤟 Buscando tradução Libras: "${queryParaBuscar}"`);
    const libras = await buscarLibras(queryParaBuscar);
    if (libras) {
      context += `\n\n🤟 Acessibilidade (Libras):\n${libras.info}\n`;
      addSource('LIBRAS-1', 'VLibras', 'libras', 'Recursos de acessibilidade em Libras.', 'https://vlibras.gov.br/');
      logs.push('✅ Recursos de Libras integrados');
    }
  }

  if (selectedConnectors.includes('timelapse')) {
    logs.push(`🌍 Gerando link de timelapse: "${queryParaBuscar}"`);
    const timeL = await buscarTimelapse(queryParaBuscar);
    if (timeL) {
      media.push(timeL);
      addSource('TIME-1', timeL.title, 'timelapse', 'Evolução temporal do planeta.', timeL.url);
      logs.push('✅ Link de timelapse gerado');
    }
  }

  if (selectedConnectors.includes('bible')) {
    logs.push(`📜 Buscando na Bíblia: "${queryParaBuscar}"`);
    const passage = await buscarBiblia(queryParaBuscar);
    if (passage) {
      context += `\n\n📜 Escritura Sagrada:\n${passage.text}\nReferência: ${passage.reference}\n`;
      addSource('BIBLE-1', passage.reference, 'bible', `Texto bíblico via Bible API`, `https://bible-api.com/${encodeURIComponent(passage.reference)}`);
      logs.push('✅ Versículos coletados');
    }
  }

  if (selectedConnectors.includes('fishwatch')) {
    logs.push(`🐟 Buscando espécies marinhas: "${queryParaBuscar}"`);
    const fish = await buscarFishWatchRobusto(queryParaBuscar);
    if (fish && fish.length > 0) {
       context += `\n\n🐟 Dados de Peixes (FishWatch):\n`;
       fish.forEach((f, i) => {
         context += `${i+1}. ${f.name} (${f.scientific}) - Habitat: ${f.habitat}\n`;
         if (f.image) media.push({ title: f.name, url: f.image, media_type: 'image', description: f.habitat });
       });
       addSource('FISH-1', fish[0].name, 'fishwatch', `Dados de biologia marinha.`, `https://www.fishwatch.gov/`);
       logs.push('✅ Dados de biologia marinha coletados');
    }
  }

  if (selectedConnectors.includes('openaq')) {
    logs.push(`🌬️ Buscando qualidade do ar: "${queryParaBuscar}"`);
    const aq = await buscarQualidadeArRobusta(queryParaBuscar);
    if (aq) {
      context += `\n\n🌬️ Qualidade do Ar (${aq.city}):\n`;
      aq.measurements?.forEach(m => {
        context += `- ${m.parameter}: ${m.value} ${m.unit} (Última atualização: ${m.lastUpdated})\n`;
      });
      addSource('AIR-1', `OpenAQ: ${aq.city}`, 'openaq', `Dados de qualidade do ar em tempo real.`, `https://openaq.org/#/city/${encodeURIComponent(aq.city)}`);
      logs.push('✅ Dados atmosféricos coletados');
    }
  }

  if (selectedConnectors.includes('quotes')) {
    logs.push(`💬 Buscando citação inspiradora`);
    const q = await buscarFrase();
    if (q) {
      context += `\n\n💬 Citação: "${q.content}" — ${q.author}\n`;
      addSource('QUOTE-1', `Citação: ${q.author}`, 'quotes', `Frases e pensamentos célebres.`, `https://quotable.io/`);
      logs.push('✅ Citação coletada');
    }
  }

  if (selectedConnectors.includes('dogapi')) {
    logs.push(`🐶 Buscando imagem de pet`);
    const dogImg = await buscarDog();
    if (dogImg) {
      // Extrair raça da URL (ex: https://dog.ceo/api/img/pitbull/...)
      const breedMatch = dogImg.match(/breeds\/([^\/]+)/);
      const rawBreed = breedMatch ? breedMatch[1].replace('-', ' ') : 'cachorro';
      const breed = rawBreed.charAt(0).toUpperCase() + rawBreed.slice(1);
      
      context += `\n\n🐶 Foto de Pet Encontrada: Raça ${breed}.\n`;
      media.push({ title: `Raça: ${breed}`, url: dogImg, media_type: 'image', description: `Um exemplar de ${breed} capturado pela Dog CEO API.` });
      logs.push(`✅ Imagem de ${breed} adicionada`);
    }
  }

  if (selectedConnectors.includes('solarsystem')) {
    logs.push(`🪐 Buscando dados planetários: "${queryParaBuscar}"`);
    const body = await buscarSistemaSolarRobusto(queryParaBuscar);
    if (body) {
      context += `\n\n🪐 Dados Celestiais (${body.englishName}):\nGravidade: ${body.gravity} m/s², Massa: ${body.mass?.massValue}x10^${body.mass?.massExponent} kg, Luas: ${body.moons?.length || 0}\n`;
      addSource('SPACE-1', `Solar System: ${body.englishName}`, 'solarsystem', `Dados astronômicos oficiais.`, `https://solarsystem.nasa.gov/planets/${body.englishName.toLowerCase()}`);
      logs.push('✅ Dados planetários coletados');
    }
  }

  if (selectedConnectors.includes('horizons')) {
    logs.push(`🛰️ Buscando efemérides na NASA Horizons: "${queryParaBuscar}"`);
    const horizonsData = await buscarNasaHorizons(queryParaBuscar, options.userContext || {});
    if (horizonsData) {
      const distanceLine = horizonsData.distanceKm
        ? `Distância aproximada: ${horizonsData.distanceKm.toLocaleString('pt-BR')} km (${horizonsData.distanceAu} AU)\n`
        : '';
      context += `\n\n🛰️ NASA Horizons (${horizonsData.targetName}):\nInstante: ${horizonsData.timestamp}\nAzimute: ${horizonsData.azimuth}°\nElevação: ${horizonsData.elevation}°\nAscensão reta: ${horizonsData.ra}\nDeclinação: ${horizonsData.dec}\nMagnitude aparente: ${horizonsData.magnitude}\n${distanceLine}`;
      addSource('HORIZONS-1', `NASA Horizons: ${horizonsData.targetName}`, 'horizons', `Azimute ${horizonsData.azimuth}°, elevação ${horizonsData.elevation}°, magnitude ${horizonsData.magnitude}.`, horizonsData.sourceUrl);
      logs.push('✅ Efemérides NASA Horizons coletadas');
    } else {
      logs.push('⚠️ NASA Horizons não retornou dados');
    }
  }

  if (selectedConnectors.includes('poetry')) {
    logs.push(`📜 Buscando poesia: "${queryParaBuscar}"`);
    const poems = await buscarPoesiaRobusta(queryParaBuscar);
    if (poems && poems.length > 0) {
      context += `\n\n📜 PoetryDB - Poemas encontrados:\n`;
      poems.forEach((p, i) => {
        context += `${i + 1}. "${p.title}" — ${p.author}\n   Trecho: ${p.excerpt}\n`;
        addSource(`POEM-${i + 1}`, `"${p.title}" by ${p.author}`, 'poetry', p.excerpt, null);
      });
      logs.push('✅ Poemas encontrados');
    }
  }

  if (selectedConnectors.includes('wikipedia')) {
    logs.push(`🌐 Buscando na Wikipedia: "${queryParaBuscar}"`);
    const wiki = await buscarWikipedia(queryParaBuscar);
    if (wiki) {
      context += `\n\n📘 Wikipedia: ${wiki.title}\n${wiki.extract}\n`;  
      addSource('WIKIPEDIA', 'Wikipedia', 'wikipedia', wiki.extract || wiki.title, wiki.url);
      logs.push('✅ Dados do Wikipedia coletados');
    } else {
      logs.push('⚠️ Wikipedia não retornou dados');
    }
  }

  if (selectedConnectors.includes('arxiv')) {
    logs.push(`📚 Buscando no arXiv: "${queryParaBuscar}"`);
    const arxiv = await buscarArxiv(queryParaBuscar);
    if (arxiv.length > 0) {
      arxiv.slice(0, 3).forEach((item, i) => {
        context += `\n\n🧾 arXiv ${i + 1}: ${item.title}\n${item.summary}\nLink: ${item.link}\n`;
        addSource(`ARXIV-${i + 1}`, item.title || `arXiv ${i + 1}`, 'arxiv', item.summary || '', item.link);
      });
      logs.push('✅ Dados do arXiv coletados');
    } else {
      logs.push('⚠️ arXiv não retornou dados');
    }
  }

  if (selectedConnectors.includes('newton')) {
    logs.push(`🧮 Calculando com Newton/MathJS: "${queryParaBuscar}"`);
    const math = await calcular(queryParaBuscar);
    if (math) {
      context += `\n\n➗ Resultado MathJS para '${math.input}': ${math.result}\n`;
      addSource('NEWTON', 'MathJS (Newton)', 'newton', `${math.input} => ${math.result}`, 'https://api.mathjs.org');
      logs.push('✅ Dados de cálculo coletados');
    }
  }

  if (selectedConnectors.includes('spacex')) {
    logs.push('🚀 Buscando SpaceX...');
    const spacex = await buscarSpaceX();
    if (spacex) {
      context += `\n\n🚀 SpaceX - ${spacex.name} (${spacex.date_utc})\n${spacex.details || 'Sem detalhes'}\nLink: ${spacex.link || 'N/A'}\n`;
      addSource('SPACEX', 'SpaceX', 'spacex', spacex.details || spacex.name, spacex.link);
      logs.push('✅ Dados SpaceX coletados');
    }
  }

  if (selectedConnectors.includes('open-meteo')) {
    logs.push('☁️ Buscando meteorologia (Open-Meteo)...');
    const weather = await buscarOpenMeteo();
    if (weather) {
      let temp = "N/A", humi = "N/A";
      try {
        temp = weather.weather.hourly.temperature_2m[0];
        humi = weather.weather.hourly.relativehumidity_2m[0];
      } catch(e) {}
      context += `\n\n☁️ Open-Meteo para lat/lon (${weather.location.lat},${weather.location.lon}):\nTemperatura atual: ${temp}°C\nUmidade Relativa: ${humi}%\n`; 
      addSource('OPEN-METEO', 'Clima Atual (Open-Meteo)', 'open-meteo', `Temperatura atual: ${temp}°C, Umidade: ${humi}%`, 'https://open-meteo.com');
      logs.push('✅ Dados Open-Meteo coletados');
    }
  }

  // Loop para Conectores da Mega Expansão (Generic Map)
  for (const key of selectedConnectors) {
    if (GENERIC_API_MAP[key] && !GENERIC_CONNECTORS_WITH_DEDICATED_HANDLERS.has(key)) {
      logs.push(`🔍 Consultando conector especializado: ${key}...`);
      const data = await buscarGeneric(key, queryParaBuscar);
      if (data && !data.error) {
        context += `\n\n📊 Dados de ${key.toUpperCase()} (Conector especializado):\n${JSON.stringify(data, null, 2).slice(0, 1500)}\n`;
        const apiConfig = GENERIC_API_MAP[key];
        const apiUrl = apiConfig ? apiConfig.url.replace('${query}', queryParaBuscar) : null;
        addSource(key.toUpperCase(), `API ${key}`, key, `Dados via ${key}`, apiUrl);
        logs.push(`✅ Dados de ${key} integrados`);
      }
    }
  }

  if (selectedConnectors.includes('esa')) {
    logs.push(`🇪🇺 Buscando na Agência Espacial Europeia (ESA): "${queryParaBuscar}"`);
    const esaData = await buscarESARobusto(queryParaBuscar);
    if (esaData && esaData.length > 0) {
      context += `\n\n🇪🇺 Dados da ESA (Imagens/Mídia):\n`;
      esaData.forEach((item, i) => {
        if (item.url) media.push({ title: item.title, url: item.url, media_type: 'image', description: item.description });
      });
      addSource('ESA-1', 'ESA Media', 'esa', 'Imagens e descobertas da ESA.', 'https://images-api.nasa.gov/search?center=ESA');
      logs.push('✅ Mídia da ESA integrada');
    }
  }

  if (selectedConnectors.includes('openfoodfacts')) {
    logs.push(`🍎 Buscando alimentos (Open Food Facts): "${queryParaBuscar}"`);
    const foodData = await buscarOpenFoodFactsRobusto(queryParaBuscar);
    if (foodData && foodData.products && foodData.products.length > 0) {
      context += `\n\n🍎 Dados de Alimentos (Open Food Facts):\n`;
      foodData.products.slice(0, 3).forEach((p, i) => {
        context += `${i+1}. ${p.product_name} (${p.brands || 'Marca desconhecida'}) - Nutrientes: ${JSON.stringify(p.nutriments)}\n`;
      });
      addSource('FOOD-1', 'Open Food Facts', 'openfoodfacts', 'Dados colaborativos de produtos alimentícios.', 'https://world.openfoodfacts.org/');
      logs.push('✅ Dados de alimentos coletados');
    }
  }

  if (selectedConnectors.includes('mathjs')) {
    logs.push(`🧮 Calculando com Math.js Advanced: "${queryParaBuscar}"`);
    const mathResult = await buscarGeneric('mathjs', queryParaBuscar);
    if (mathResult && typeof mathResult === 'string') {
      context += `\n\n🧮 Resultado Matemático Avançado: ${mathResult}\n`;
      addSource('MATH-ADV', 'Math.js Advanced', 'mathjs', mathResult, 'https://mathjs.org/');
      logs.push('✅ Cálculos avançados integrados');
    }
  }

  if (selectedConnectors.includes('wolfram')) {
    logs.push(`🧠 Consultando Wolfram Alpha: "${queryParaBuscar}"`);
    const wolframData = await buscarWolframAlpha(queryParaBuscar);
    if (wolframData && !wolframData.error) {
      const podLines = (wolframData.pods || [])
        .filter(pod => pod.text)
        .slice(0, 3)
        .map((pod, index) => `${index + 1}. ${pod.title}: ${pod.text}`)
        .join('\n');
      context += `\n\n🧠 Wolfram Alpha:\nEntrada interpretada: ${wolframData.input}\nResultado principal: ${wolframData.result || 'Sem resultado textual principal'}\n${podLines}\n`;
      addSource('WOLFRAM-1', 'Wolfram Alpha', 'wolfram', wolframData.result || wolframData.input, 'https://products.wolframalpha.com/api/');
      logs.push('✅ Wolfram Alpha integrado');
    } else if (wolframData?.error === 'missing_api_key') {
      logs.push('⚠️ Wolfram Alpha sem chave configurada');
    } else {
      logs.push('⚠️ Wolfram Alpha não retornou dados');
    }
  }

  if (selectedConnectors.includes('pubchem')) {
    logs.push(`🧪 Buscando compostos químicos (PubChem): "${queryParaBuscar}"`);
    const chemData = await buscarGeneric('pubchem', queryParaBuscar);
    if (chemData && chemData.PC_Compounds) {
      context += `\n\n🧪 Dados Químicos (PubChem):\nComposto encontrado com CID: ${chemData.PC_Compounds[0].id.id.cid}\n`;
      addSource('PUBCHEM-1', 'PubChem 3D', 'pubchem', 'Estruturas químicas 3D.', 'https://pubchem.ncbi.nlm.nih.gov/');
      logs.push('✅ Dados químicos (PubChem) integrados');
    }
  }

  if (selectedConnectors.includes('uniprot')) {
    logs.push(`🧬 Buscando proteínas (UniProt): "${queryParaBuscar}"`);
    const protData = await buscarGeneric('uniprot', queryParaBuscar);
    if (protData && protData.results && protData.results.length > 0) {
      context += `\n\n🧬 Dados de Proteínas (UniProt):\n`;
      protData.results.slice(0, 2).forEach((r, i) => {
        context += `${i+1}. Proteína: ${r.primaryAccession} - Nome: ${r.proteinDescription?.recommendedName?.fullName?.value}\n`;
      });
      addSource('UNIPROT-1', 'UniProt Proteins', 'uniprot', 'Base de dados de proteínas.', 'https://www.uniprot.org/');
      logs.push('✅ Dados de proteínas coletados');
    }
  }

  if (selectedConnectors.includes('mygene')) {
    logs.push(`🧬 Buscando genes (MyGene.info): "${queryParaBuscar}"`);
    const geneData = await buscarGeneric('mygene', queryParaBuscar);
    if (geneData && geneData.hits && geneData.hits.length > 0) {
      context += `\n\n🧬 Dados Genômicos (MyGene):\n`;
      geneData.hits.slice(0, 2).forEach((h, i) => {
        context += `${i+1}. Gene: ${h.symbol} - Nome: ${h.name} (ID: ${h._id})\n`;
      });
      addSource('MYGENE-1', 'MyGene.info', 'mygene', 'Consulta de genes em tempo real.', 'https://mygene.info/');
      logs.push('✅ Dados de genes coletados');
    }
  }

  if (selectedConnectors.includes('reactome')) {
    logs.push(`🛤️ Buscando vias biológicas (Reactome): "${queryParaBuscar}"`);
    const reactData = await buscarGeneric('reactome', queryParaBuscar);
    if (reactData && reactData.results && reactData.results.length > 0) {
      context += `\n\n🛤️ Vias Biológicas (Reactome):\n`;
      reactData.results.slice(0, 3).forEach((r, i) => {
        context += `${i+1}. Via: ${r.name} (${r.stId})\n`;
      });
      addSource('REACTOME-1', 'Reactome Pathway', 'reactome', 'Vias biológicas e processos celulares.', 'https://reactome.org/');
      logs.push('✅ Vias biológicas coletadas');
    }
  }

  if (selectedConnectors.includes('string-db')) {
    logs.push(`🕸️ Buscando interações proteicas (STRING): "${queryParaBuscar}"`);
    const stringData = await buscarGeneric('string-db', queryParaBuscar);
    if (stringData && stringData.length > 0) {
      context += `\n\n🕸️ Rede de Interações (STRING):\nDados de interações proteicas integrados.\n`;
      addSource('STRING-1', 'STRING Interaction', 'string-db', 'Rede de interações proteína-proteína.', 'https://string-db.org/');
      logs.push('✅ Rede de interações integrada');
    }
  }

  if (selectedConnectors.includes('edx')) {
    logs.push(`🎓 Buscando cursos no edX: "${queryParaBuscar}"`);
    const edxData = await buscarGeneric('edx', queryParaBuscar);
    if (edxData && edxData.results) {
      context += `\n\n🎓 Cursos Acadêmicos (edX):\n`;
      edxData.results.slice(0, 3).forEach((c, i) => {
        context += `${i+1}. ${c.title} - ${c.org}\n`;
      });
      addSource('EDX-1', 'edX Open Courses', 'edx', 'Cursos acadêmicos de alto nível.', 'https://www.edx.org/');
      logs.push('✅ Cursos edX encontrados');
    }
  }

  if (selectedConnectors.includes('mit-ocw')) {
    logs.push(`🏛️ Buscando materiais MIT OCW: "${queryParaBuscar}"`);
    const mitData = await buscarGeneric('mit-ocw', queryParaBuscar);
    if (mitData) {
      context += `\n\n🏛️ Materiais MIT (OpenCourseWare):\nDados de cursos do MIT integrados.\n`;
      addSource('MIT-1', 'MIT OpenCourseWare', 'mit-ocw', 'Materiais gratuitos de cursos do MIT.', 'https://ocw.mit.edu/');
      logs.push('✅ Materiais do MIT integrados');
    }
  }

  if (selectedConnectors.includes('tcu')) {
    logs.push(`⚖️ Buscando dados no TCU: "${queryParaBuscar}"`);
    const tcuData = await buscarGeneric('tcu', queryParaBuscar);
    if (tcuData) {
      context += `\n\n⚖️ Dados Governamentais (TCU):\nInformações de fiscalização e contas públicas integradas.\n`;
      addSource('TCU-1', 'TCU Brasil', 'tcu', 'Fiscalização e contas públicas do Tribunal.', 'https://contas.tcu.gov.br/');
      logs.push('✅ Dados do TCU coletados');
    }
  }

  if (selectedConnectors.includes('osf')) {
    logs.push(`📂 Buscando projetos OSF: "${queryParaBuscar}"`);
    const osfData = await buscarGeneric('osf', queryParaBuscar);
    if (osfData && osfData.data && osfData.data.length > 0) {
      context += `\n\n📂 Projetos Científicos (OSF):\n`;
      osfData.data.slice(0, 3).forEach((d, i) => {
        context += `${i+1}. ${d.attributes.title} (ID: ${d.id})\n`;
      });
      addSource('OSF-1', 'Open Science OSF', 'osf', 'Gerenciamento de projetos científicos abertos.', 'https://osf.io/');
      logs.push('✅ Projetos OSF coletados');
    }
  }

  if (selectedConnectors.includes('celestrak')) {
    logs.push(`🛰️ Buscando satélites (CelesTrak): "${queryParaBuscar}"`);
    const satData = await buscarGeneric('celestrak', queryParaBuscar);
    if (satData) {
      context += `\n\n🛰️ Rastreamento Orbital (CelesTrak):\nDados orbitais e TLE integrados.\n`;
      addSource('SAT-1', 'CelesTrak', 'celestrak', 'Rastreamento de satélites e dados orbitais.', 'https://celestrak.org/');
      logs.push('✅ Dados de satélites coletados');
    }
  }

  if (selectedConnectors.includes('openuniverse')) {
    logs.push(`🌌 Buscando no OpenUniverse: "${queryParaBuscar}"`);
    const univData = await buscarGeneric('openuniverse', queryParaBuscar);
    if (univData) {
      context += `\n\n🌌 Dados Astronômicos (OpenUniverse):\nExploração de dados do cosmos integrada.\n`;
      addSource('UNIV-1', 'OpenUniverse', 'openuniverse', 'Exploração de dados astronômicos.', 'https://openuniverse.org/');
      logs.push('✅ Dados astronômicos coletados');
    }
  }

  if (selectedConnectors.includes('stellarium')) {
    logs.push(`🔭 Buscando no Stellarium: "${queryParaBuscar}"`);
    const stelData = await buscarGeneric('stellarium', queryParaBuscar);
    if (stelData) {
      context += `\n\n🔭 Planetário Virtual (Stellarium):\nDados de observação estelar integrados.\n`;
      addSource('STEL-1', 'Stellarium Web', 'stellarium', 'Planetário virtual para observação estelar.', 'https://stellarium-web.org/');
      logs.push('✅ Dados do Stellarium coletados');
    }
  }

  if (selectedConnectors.includes('ligo')) {
    logs.push(`🌊 Buscando ondas gravitacionais (LIGO): "${queryParaBuscar}"`);
    const ligoData = await buscarLigoRobusto(queryParaBuscar);
    if (ligoData && ligoData.results) {
      context += `\n\n🌊 Ondas Gravitacionais (LIGO/Virgo):\n`;
      ligoData.results.slice(0, 2).forEach((r, i) => {
        context += `${i+1}. Evento: ${r.t_0} - Mag: ${r.far}\n`;
      });
      addSource('LIGO-1', 'Gravitational Waves (LIGO)', 'ligo', 'Detecção de ondas gravitacionais.', 'https://gracedb.ligo.org/');
      logs.push('✅ Dados de ondas gravitacionais coletados');
    }
  }

  if (selectedConnectors.includes('noaa-space')) {
    logs.push(`🌪️ Buscando clima espacial (NOAA): "${queryParaBuscar}"`);
    const spaceWeatherData = await buscarGeneric('noaa-space', queryParaBuscar);
    if (spaceWeatherData) {
      context += `\n\n🌪️ Clima Espacial (NOAA):\nDados de tempestades solares e auroras integrados.\n`;
      addSource('NOAA-S-1', 'NOAA Space Weather', 'noaa-space', 'Previsões de clima espacial e auroras.', 'https://www.swpc.noaa.gov/');
      logs.push('✅ Dados de clima espacial coletados');
    }
  }

  if (selectedConnectors.includes('exoplanets')) {
    logs.push(`🪐 Buscando exoplanetas (NASA): "${queryParaBuscar}"`);
    const exoData = await buscarExoplanetas(queryParaBuscar);
    if (exoData && exoData.length > 0) {
      context += `\n\n🪐 Exoplanetas (NASA Archive):\nDados de planetas fora do sistema solar integrados.\n`;
      addSource('EXO-1', 'NASA Exoplanets', 'exoplanets', 'Arquivo oficial de exoplanetas.', 'https://exoplanetarchive.ipac.caltech.edu/');
      logs.push('✅ Dados de exoplanetas coletados');
    }
  }

  if (selectedConnectors.includes('openuniverse')) {
    logs.push(`ðŸŒŒ Buscando catÃ¡logo astronÃ´mico aberto: "${queryParaBuscar}"`);
    const universeData = await buscarOpenUniverse(queryParaBuscar);
    if (universeData) {
      context += `\n\nðŸŒŒ OpenUniverse / CatÃ¡logo astronÃ´mico:\n${universeData.summary}\nLink: ${universeData.url}\n`;
      addSource('UNIV-2', universeData.title || 'OpenUniverse', 'openuniverse', universeData.summary || 'ExploraÃ§Ã£o de dados astronÃ´micos.', universeData.url || 'https://cds.unistra.fr/');
      logs.push('âœ… CatÃ¡logo astronÃ´mico aberto integrado');
    }
  }

  if (selectedConnectors.includes('edx')) {
    logs.push(`ðŸŽ“ Buscando cursos no edX (fallback HTML): "${queryParaBuscar}"`);
    const edxPage = await buscarCoursePage('https://www.edx.org/search?q=', queryParaBuscar);
    if (edxPage) {
      context += `\n\nðŸŽ“ Cursos AcadÃªmicos (edX):\n${edxPage.title}\n${edxPage.description || 'Busca de cursos abertos.'}\nLink: ${edxPage.url}\n`;
      addSource('EDX-2', edxPage.title || 'edX Open Courses', 'edx', edxPage.description || 'Cursos acadÃªmicos de alto nÃ­vel.', edxPage.url || 'https://www.edx.org/');
      logs.push('âœ… edX integrado por fallback HTML');
    }
  }

  if (selectedConnectors.includes('mit-ocw')) {
    logs.push(`ðŸ›ï¸ Buscando MIT OCW (fallback HTML): "${queryParaBuscar}"`);
    const mitPage = await buscarCoursePage('https://ocw.mit.edu/search/?q=', queryParaBuscar);
    if (mitPage) {
      context += `\n\nðŸ›ï¸ MIT OpenCourseWare:\n${mitPage.title}\n${mitPage.description || 'Materiais de cursos do MIT.'}\nLink: ${mitPage.url}\n`;
      addSource('MIT-2', mitPage.title || 'MIT OpenCourseWare', 'mit-ocw', mitPage.description || 'Materiais gratuitos de cursos do MIT.', mitPage.url || 'https://ocw.mit.edu/');
      logs.push('âœ… MIT OCW integrado por fallback HTML');
    }
  }

  if (selectedConnectors.includes('tcu')) {
    logs.push(`âš–ï¸ Buscando referÃªncia TCU: "${queryParaBuscar}"`);
    const tcuRef = await buscarTCU(queryParaBuscar);
    if (tcuRef) {
      context += `\n\nâš–ï¸ TCU:\n${tcuRef.summary}\nLink: ${tcuRef.url}\n`;
      addSource('TCU-2', tcuRef.title || 'TCU Brasil', 'tcu', tcuRef.summary || 'FiscalizaÃ§Ã£o e contas pÃºblicas.', tcuRef.url);
      logs.push('âœ… ReferÃªncia TCU integrada');
    }
  }

  if (selectedConnectors.includes('kepler')) {
    logs.push(`ðŸª Buscando catÃ¡logos Kepler/TESS: "${queryParaBuscar}"`);
    const keplerData = await buscarKeplerTess(queryParaBuscar);
    if (keplerData && keplerData.length > 0) {
      context += `\n\nðŸª Kepler/TESS - candidatos e exoplanetas:\n`;
      keplerData.slice(0, 3).forEach((planet, i) => {
        context += `${i + 1}. ${planet.pl_name || 'Sem nome'} | Estrela: ${planet.hostname || 'N/A'} | Descoberta: ${planet.disc_year || 'N/A'} | MissÃ£o: ${planet.disc_facility || 'N/A'}\n`;
      });
      addSource('KEPLER-1', 'NASA Exoplanet Archive / Kepler-TESS', 'kepler', 'CatÃ¡logo astronÃ´mico de exoplanetas e hospedeiras.', 'https://exoplanetarchive.ipac.caltech.edu/');
      logs.push('âœ… CatÃ¡logo Kepler/TESS integrado');
    }
  }

  if (selectedConnectors.includes('numberempire')) {
    logs.push(`ðŸ§® Buscando apoio matemÃ¡tico no NumberEmpire: "${queryParaBuscar}"`);
    const numberEmpireData = await buscarNumberEmpireRobusto(queryParaBuscar);
    if (numberEmpireData) {
      context += `\n\nðŸ§® NumberEmpire:\n${numberEmpireData.result ? `Resultado estimado: ${numberEmpireData.result}\n` : ''}Link: ${numberEmpireData.url}\n`;
      addSource('NUMBEREMPIRE-1', numberEmpireData.title || 'NumberEmpire', 'numberempire', numberEmpireData.result || 'Ferramenta complementar de matemÃ¡tica simbÃ³lica.', numberEmpireData.url);
      logs.push('âœ… ReferÃªncia NumberEmpire integrada');
    }
  }

  if (selectedConnectors.includes('pubchem-bio')) {
    logs.push(`ðŸ§ª Buscando bioensaios (PubChem BioAssay): "${queryParaBuscar}"`);
    const bioassayData = await buscarPubChemBio(queryParaBuscar);
    const assays = bioassayData?.AssaySummaries?.AssaySummary || [];
    if (assays.length > 0) {
      context += `\n\nðŸ§ª Bioensaios (PubChem BioAssay):\n`;
      assays.slice(0, 3).forEach((assay, i) => {
        context += `${i + 1}. AID ${assay.AID} | Tipo: ${assay.ActivityOutcomeMethod || 'N/A'} | Nome: ${assay.Name || 'N/A'}\n`;
      });
      addSource('PUBCHEM-BIO-1', `PubChem BioAssay: ${queryParaBuscar}`, 'pubchem-bio', 'Atividades biolÃ³gicas e ensaios relacionados ao composto consultado.', `https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(queryParaBuscar)}`);
      logs.push('âœ… Bioensaios do PubChem integrados');
    }
  }

  if (selectedConnectors.includes('clinvar')) {
    logs.push(`ðŸ§¬ Buscando variantes clÃ­nicas (ClinVar): "${queryParaBuscar}"`);
    const clinvarData = await buscarClinVar(queryParaBuscar);
    if (clinvarData && clinvarData.length > 0) {
      context += `\n\nðŸ§¬ ClinVar - variantes clÃ­nicas:\n`;
      clinvarData.slice(0, 3).forEach((entry, i) => {
        context += `${i + 1}. ${entry.title || entry.variation_set?.variation_name || 'Registro ClinVar'}\n`;
      });
      addSource('CLINVAR-1', `ClinVar: ${queryParaBuscar}`, 'clinvar', 'Registros clÃ­nicos de variantes genÃ©ticas.', `https://www.ncbi.nlm.nih.gov/clinvar/?term=${encodeURIComponent(queryParaBuscar)}`);
      logs.push('âœ… Dados do ClinVar coletados');
    }
  }

  if (selectedConnectors.includes('cosmic')) {
    logs.push(`ðŸ§¬ Buscando mutaÃ§Ãµes em cÃ¢ncer (COSMIC): "${queryParaBuscar}"`);
    const cosmicData = await buscarCosmic(queryParaBuscar);
    if (cosmicData) {
      context += `\n\nðŸ§¬ COSMIC - mutaÃ§Ãµes em cÃ¢ncer:\n${cosmicData.title}\n${cosmicData.description || cosmicData.summary || ''}\nLink: ${cosmicData.url}\n`;
      addSource('COSMIC-1', cosmicData.title || `COSMIC: ${queryParaBuscar}`, 'cosmic', cosmicData.description || cosmicData.summary || 'Consulta ao COSMIC/Sanger Institute.', cosmicData.url);
      logs.push('âœ… ReferÃªncia COSMIC integrada');
    }
  }

  if (selectedConnectors.includes('sentinel')) {
    logs.push(`ðŸŒ Preparando busca de observaÃ§Ã£o da Terra (Sentinel): "${queryParaBuscar}"`);
    const sentinelData = await buscarSentinel(queryParaBuscar);
    if (sentinelData) {
      context += `\n\nðŸŒ Sentinel/Copernicus:\n${sentinelData.summary}\nLink: ${sentinelData.url}\n`;
      addSource('SENTINEL-1', sentinelData.title || 'Sentinel/Copernicus', 'sentinel', sentinelData.summary || 'Busca preparada no Copernicus Browser.', sentinelData.url);
      logs.push('âœ… Consulta Sentinel preparada');
    }
  }

  if (selectedConnectors.includes('firms')) {
    logs.push(`ðŸ”¥ Buscando queimadas ativas (FIRMS/EONET): "${queryParaBuscar}"`);
    const firmsData = await buscarFirms(queryParaBuscar);
    if (firmsData && firmsData.length > 0) {
      context += `\n\nðŸ”¥ Eventos recentes de queimadas:\n`;
      firmsData.slice(0, 3).forEach((event, i) => {
        context += `${i + 1}. ${event.title || 'Evento'} | Categorias: ${(event.categories || []).map(c => c.title).join(', ') || 'wildfires'}\n`;
      });
      addSource('FIRMS-1', 'Wildfires / FIRMS fallback', 'firms', 'Monitoramento de queimadas abertas via EONET/NASA.', 'https://eonet.gsfc.nasa.gov/');
      logs.push('âœ… Eventos de queimadas integrados');
    }
  }

  if (selectedConnectors.includes('mec-ejovem')) {
    logs.push(`ðŸ« Buscando referÃªncia educacional no MEC: "${queryParaBuscar}"`);
    const mecData = await buscarMecEJovem(queryParaBuscar);
    if (mecData) {
      context += `\n\nðŸ« MEC / EducaÃ§Ã£o:\n${mecData.summary}\nLink: ${mecData.url}\n`;
      addSource('MEC-1', mecData.title || 'Portal MEC', 'mec-ejovem', mecData.summary || 'ReferÃªncia educacional do MEC.', mecData.url);
      logs.push('âœ… ReferÃªncia do MEC integrada');
    }
  }

  if (selectedConnectors.includes('educ4share')) {
    logs.push(`ðŸ“š Preparando referÃªncia Educ4Share: "${queryParaBuscar}"`);
    const educData = await buscarEduc4Share(queryParaBuscar);
    if (educData) {
      context += `\n\nðŸ“š Educ4Share:\n${educData.summary}\nLink: ${educData.url}\n`;
      addSource('EDUC4SHARE-1', educData.title || 'Educ4Share', 'educ4share', educData.summary || 'Portal educacional complementar.', educData.url);
      logs.push('âœ… ReferÃªncia Educ4Share integrada');
    }
  }

  if (selectedConnectors.includes('modis')) {
    logs.push(`ðŸŒ Buscando camadas MODIS/NASA GIBS: "${queryParaBuscar}"`);
    const modisData = await buscarModis(queryParaBuscar);
    if (modisData) {
      context += `\n\nðŸŒ MODIS / NASA GIBS:\n${modisData.summary}\nLink: ${modisData.url}\n`;
      addSource('MODIS-1', modisData.title || 'NASA GIBS / MODIS', 'modis', modisData.summary || 'Imagens e camadas de observaÃ§Ã£o da Terra.', modisData.url);
      logs.push('âœ… ReferÃªncia MODIS integrada');
    }
  }

  if (selectedConnectors.includes('transparencia')) {
    logs.push(`ðŸ’° Buscando no Portal da TransparÃªncia: "${queryParaBuscar}"`);
    const transparenciaData = await buscarTransparencia(queryParaBuscar);
    if (transparenciaData) {
      context += `\n\nðŸ’° Portal da TransparÃªncia:\n${transparenciaData.summary}\nLink: ${transparenciaData.url}\n`;
      addSource('TRANSPARENCIA-1', transparenciaData.title || 'Portal da TransparÃªncia', 'transparencia', transparenciaData.summary || 'Consulta preparada sobre gastos pÃºblicos.', transparenciaData.url);
      logs.push('âœ… Portal da TransparÃªncia integrado');
    }
  }

  if (selectedConnectors.includes('datasus')) {
    logs.push(`ðŸ¥ Buscando no OpenDataSUS: "${queryParaBuscar}"`);
    const datasusData = await buscarDataSUS(queryParaBuscar);
    if (datasusData) {
      context += `\n\nðŸ¥ OpenDataSUS:\n${datasusData.summary}\nLink: ${datasusData.url}\n`;
      addSource('DATASUS-1', datasusData.title || 'OpenDataSUS', 'datasus', datasusData.summary || 'Dados pÃºblicos de saÃºde.', datasusData.url);
      logs.push('âœ… ReferÃªncia OpenDataSUS integrada');
    }
  }

  if (selectedConnectors.includes('seade')) {
    logs.push(`ðŸ“Š Buscando referÃªncia estatÃ­stica SEADE: "${queryParaBuscar}"`);
    const seadeData = await buscarSEADE(queryParaBuscar);
    if (seadeData) {
      context += `\n\nðŸ“Š SEADE:\n${seadeData.summary}\nLink: ${seadeData.url}\n`;
      addSource('SEADE-1', seadeData.title || 'Fundacao SEADE', 'seade', seadeData.summary || 'EstatÃ­sticas socioeconÃ´micas de SÃ£o Paulo e regiÃµes.', seadeData.url);
      logs.push('âœ… ReferÃªncia SEADE integrada');
    }
  }

  if (selectedConnectors.includes('getty')) {
    logs.push(`ðŸŽ¨ Buscando no Getty Museum: "${queryParaBuscar}"`);
    const gettyData = await buscarGetty(queryParaBuscar);
    if (gettyData) {
      context += `\n\nðŸŽ¨ Getty Museum:\n${gettyData.summary}\nLink: ${gettyData.url}\n`;
      addSource('GETTY-1', gettyData.title || 'Getty Museum Collection', 'getty', gettyData.summary || 'Busca no acervo do Getty Museum.', gettyData.url);
      logs.push('âœ… Getty Museum integrado');
    }
  }

  if (useNasa) {
    logs.push(`🚀 Otimizando busca NASA com IA para: "${queryParaBuscar}"`);
    const optimizedQuery = await optimizeNasaQuery(queryParaBuscar);
    logs.push(`📝 Query otimizada: "${optimizedQuery}"`);

    // Track NASA query as a source
    addSource('NASA-QUERY', 'Consulta NASA (busca de mídia)', 'nasa', optimizedQuery, null);

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

        // Register NASA media sources
        nasaMedia.forEach((item, i) => {
          addSource(`NASA-${i + 1}`, item.title || `NASA media ${i + 1}`, 'nasa', item.description, item.url);
        });

        context += `\n\n🔭 Resultados da NASA (imagens/vídeos selecionados):\n`;
        nasaMedia.slice(0, 5).forEach((item, i) => {
          context += `${i + 1}. ${item.title}\n`;
        });
        logs.push('✅ Dados da NASA coletados e otimizados');

        // ANALYZE IMAGES (All with GROQ)
        const imagesCount = nasaMedia.filter(m => m.media_type === 'image').length;
        if (imagesCount >= 4) {
          logs.push('🔍 Analisando imagens com IA (Groq)...');

          const groqAnalysis = await analyzeNasaImagesWithGroq(nasaMedia).catch(err => {
            console.error('Groq image analysis failed:', err);
            return null;
          });

          if (groqAnalysis) {
            context += `\n\n📸 Análise de imagens (GROQ):\n${groqAnalysis}`;
            addSource('NASA-ANALYSIS-GROQ', 'Análise de imagens (GROQ)', 'nasa', groqAnalysis, null);
            logs.push('✅ Imagens analisadas');
          }
        }
      }
    }
  }

  // Check if we have real API data (not just web snippets)
  const hasRealData = sources.some(s => !['web', 'nasa'].includes(s.type));
  const dataAuthorityWarning = hasRealData 
    ? `\n⚠️ ATENÇÃO: O contexto abaixo contém DADOS REAIS E ATUAIS (USGS, Sunrise, ISS, etc.). \n- Trate esses dados como VERDADE ABSOLUTA.\n- NUNCA os chame de "hipotéticos".\n- Responda primeiro os números/fatos exatos pedidos.\n`
    : '';

  const historyArray = options.history || [];
  const historyText = historyArray.length > 0
    ? `\nHISTÓRICO DA CONVERSA (Contexto mantido em memória para continuidade):\n${historyArray.map(m => `${m.role === 'user' ? 'Usuário' : 'IA'}: ${m.content}`).join('\n')}\n`
    : '';
  const visionText = options.visionContext ? `\n${options.visionContext}\n` : '';

  logs.push('🧠 Processando e raciocinando...');

  const graphIntent = detectTimeSeriesIntent(userQuestion, '') || detectCategoryComparisonIntent(userQuestion, '');
  const conceptualIntent = detectConceptualVisualIntent(userQuestion);
  const visualGuidance = graphIntent
    ? '\nSINAL VISUAL: esta pergunta pede comparacao, ranking ou tendencia. Se houver dados confiaveis no contexto, gere um grafico LaTeX apropriado.\n'
    : (conceptualIntent
      ? '\nSINAL VISUAL: esta pergunta e conceitual ou explicativa. Se isso realmente ajudar a sintese, voce pode usar mapa mental LaTeX.\n'
      : '\nSINAL VISUAL: priorize texto puro. So gere visual se ficar realmente necessario.\n');

  const executionPrompt = `${SCIENCE_SYSTEM_PROMPT}

${dataAuthorityWarning}
${visualGuidance}

CONTEXTO PESQUISADO (FONTES REAIS):
${context || 'Nenhum contexto externo necessário'}
${historyText}${visionText}

FONTES DISPONÍVEIS PARA CITAÇÃO:
${sources.slice(0, 14).map(s => `${s.id}: ${s.label} - ${String(s.detail || '').slice(0, 220)}`).join('\n')}

PERGUNTA ATUAL DO USUÁRIO: "${userQuestion}"

INSTRUÇÕES FINAIS:
1. Abra com um parágrafo objetivo de no máximo 3 frases, respondendo diretamente ao pedido do usuário.
2. Se o usuário perguntou horários, listas de eventos (terremotos) ou fatos numéricos, entregue esses dados JÁ NO INÍCIO.
3. Expanda só o necessário depois da resposta direta.
4. Use a estrutura adaptativa do sistema (📊 para dados, 🔬 para conceitos).
5. Cite TODAS as afirmações factuais com o formato exato [ID-DA-FONTE: ID_EXATO].
6. Nunca use formatos como [FONTE: nome] ou rótulos livres no lugar do ID.
7. Mantenha o tom didático e amigável, mas seja direto nos dados.
8. Só inclua gráfico ou mapa mental quando isso for claramente necessário para entender melhor a resposta. Se a pergunta puder ser respondida bem em texto, NÃO gere visual.
9. Nunca acrescente impactos indiretos, consequências econômicas/setoriais ou interpretações laterais sem fonte explícita.
10. Se o gráfico for uma série temporal, use apenas line chart com escala proporcional real; não use área, cunha ou números hipotéticos fora da ordem de grandeza real.
11. Se a pergunta comparar categorias discretas (ex: Brasil vs média mundial, fontes de energia, estados, países), use barras e alinhe cada valor exatamente ao seu rótulo no eixo X.
12. Nunca confunda "matriz elétrica" com "matriz energética". Se o tema for Brasil/energia, diferencie explicitamente eletricidade de energia total e priorize fontes institucionais como a EPE quando disponíveis.
13. Se faltarem dados para algum ano/categoria, diga isso explicitamente. Nunca transforme ausência de dado em 0.
14. Antes de plotar, monte internamente uma tabela ano/categoria -> valor. Se encontrar três ou mais valores consecutivos idênticos em contexto onde isso pareça improvável, revalide a busca; se não conseguir confirmar, não plote esses pontos.
15. Em variação percentual, inclua referência visual de y=0 no gráfico.
16. Quando houver escolha entre valor absoluto e porcentagem, priorize primeiro o valor absoluto da base oficial.
17. Se o usuário pedir um período completo e você só tiver parte dele, não use linha sugerindo continuidade. Prefira barras apenas para os anos realmente disponíveis e avise no texto quais anos ficaram sem dado.
18. NÃO gere gráfico para listas factuais simples, respostas curtas, enumeração de descobertas, definição direta ou perguntas que não peçam comparação/tendência/organização visual.
19. NÃO gere mapa mental a menos que o pedido seja conceitual, explicativo ou explicitamente peça organização visual.

Seja honesto. Não invente. Use as fontes.`;


  const response = await callGroq(
    [{ role: 'user', content: executionPrompt }],
    'GROQ_API_KEY_1',
    { maxTokens: 6000, temperature: 0.2 }
  );

  logs.push('✅ Resposta gerada pela IA principal');
  let factCheck = null;
  if (isFactCheck) {
    logs.push('Fact-check: consolidando veredito estruturado...');
    factCheck = await buildFactCheckAssessment({
      userQuestion,
      actionPlan,
      visionContext: options.visionContext || '',
      sources,
      logs,
    });
    if (options.factCheckImageUrl) {
      factCheck.inputPreviewUrl = options.factCheckImageUrl;
    }
  }
  return { response, media: [...media, ...nasaMedia], sources, selectedConnectors, factCheck };
}

// ============ STEP 3: Audit with Gemini / Polish with Groq ============
async function reviewResponse(response, { userQuestion = '', sources = [] } = {}) {
  const sourceDigest = (sources || [])
    .slice(0, 12)
    .map(source => `${source.id}: ${source.label} - ${source.detail}`)
    .join('\n');
  const reviewPrompt = `Você é um revisor científico experiente. Recebeu a resposta abaixo para revisão.

Objetivo:
- Garantir precisão e remover erros factuais.
- Otimizar a estrutura e o tom: abrir com um parágrafo curto e direto, e só depois expandir.
- Manter formatação excelente e acessível (parágrafos curtos, listas SEMPRE com asterisco (*) e negrito apenas quando ajudarem).
    - Garantir que as imagens da NASA [NASA_IMG: ID-DA-FONTE] estejam posicionadas logo após os parágrafos que as descrevem, e nunca todas acumuladas no final.
- Manter analogias simples do dia a dia apenas quando elas realmente ajudarem.
- Remover qualquer inferência causal, impacto indireto, consequência econômica/social ou extrapolação que não esteja claramente sustentada por tags [ID-DA-FONTE: ...].
- Se não houver base explícita para um efeito, tendência ou interpretação adicional, corte esse trecho em vez de inventar contexto.

REGRAS CRUCIAIS (RESPEITE 100%):
1) Retorne APENAS a resposta final para o usuário. NADA mais.
2) NÃO inclua nenhum texto como "Como revisor...", "Observação:", ou explicações sobre o processo de revisão.
3) A primeira parte da resposta deve ser um parágrafo direto e objetivo, respondendo à pergunta sem rodeios.
4) NÃO inclua títulos artificiais, listas de etapas ou qualquer prefácio sobre revisão. Apenas a resposta final ao usuário.
5) Se não for possível afirmar com certeza, seja honesto e explique por que.
6) IMPORTANTE: NÃO REMOVA as tags [ID-DA-FONTE: ID_EXATO] presentes no texto original. Se o texto estiver afirmando informações sem as tags apropriadas originais, ADICIONE tags no mesmo formato exato [ID-DA-FONTE: ID_EXATO]. Nunca use [FONTE: nome] nem rótulos livres. É vital manter o rastreio das fontes.
7) PRESERVE integralmente, se existirem, os blocos [LATEX_GRAPH_TITLE: ...][LATEX_GRAPH_CODE]...[/LATEX_GRAPH_CODE] e [MINDMAP_TITLE: ...][MINDMAP_CODE]...[/MINDMAP_CODE], além de [PHET:...] e [PDB:...]. Também preserve blocos \`\`\`latex ... \`\`\` e \`\`\`tikz ... \`\`\` intactos. Você pode melhorar o texto ao redor, mas não corrompa essas tags nem blocos de código.
8) Se a pergunta pedir propriedades físicas, astronômicas, geográficas ou quantitativas, prefira trazer valor absoluto + comparação relativa quando as fontes sustentarem isso.
9) Se houver fontes disponíveis, a resposta final deve sair com boa densidade de citações, especialmente nas frases numéricas e comparativas.

PERGUNTA DO USUÁRIO:
${userQuestion}

FONTES DISPONÍVEIS:
${sourceDigest || 'Sem fontes registradas'}

RESPOSTA A REVISAR:
${response}
`;

  return await callGroq(
    [{ role: 'user', content: reviewPrompt }],
    'GROQ_API_KEY_1',
    { maxTokens: 5000, temperature: 0.15 }
  );
}

async function auditResponseWithOpenRouter({ userQuestion = '', response = '', sources = [], logs = [] } = {}) {
  const isFactCheck = detectFactCheckIntent(userQuestion, response);
  const sourceDigest = (sources || [])
    .slice(0, 12)
    .map(source => `${source.id}: ${source.label} - ${source.detail}`)
    .join('\n');

  const prompt = `Voce e um auditor cientifico do Drekee AI.

Sua tarefa e decidir se a resposta abaixo esta suficientemente completa e consistente para ser entregue ao usuario, ou se falta dado central e vale uma rodada automatica de recuperacao.

Retorne APENAS JSON valido:
{
  "approved": true,
  "retry_worthy": false,
  "issues": [],
  "missing_facts": [],
  "reasoning": "motivo curto",
  "recommended_focus": "foco curto"
}

Regras:
- approved=false apenas se houver problema real de conteudo, consistencia, cobertura ou fato-chave ausente
- retry_worthy=true apenas quando uma nova pesquisa puder plausivelmente melhorar a resposta
- nao marque retry_worthy por meros ajustes de estilo
- use issues curtos como: missing_key_fact, insufficient_content, weak_coverage, factual_gap, unsupported_claim
- missing_facts deve listar fatos centrais ausentes, se existirem
- se a resposta estiver boa o suficiente, aprove
 ${isFactCheck ? '- em fact-check, reprove respostas binarias sem evidencia direta e exija diferenca clara entre falso, enganoso e nao_verificado' : ''}

Pergunta do usuario: ${JSON.stringify(String(userQuestion || ''))}
Fontes disponiveis:
${sourceDigest || 'Sem fontes registradas'}

Resposta para auditar:
${String(response || '')}`;

  const raw = await callOpenRouter(prompt, logs, { model: 'qwen/qwen3.6-plus:free' });
  const parsed = extractJsonObject(raw) || {};
  return {
    approved: parsed.approved !== false,
    retry_worthy: parsed.retry_worthy === true,
    issues: Array.isArray(parsed.issues) ? parsed.issues.map(item => String(item || '').trim()).filter(Boolean) : [],
    missing_facts: Array.isArray(parsed.missing_facts) ? parsed.missing_facts.map(item => String(item || '').trim()).filter(Boolean) : [],
    reasoning: String(parsed.reasoning || '').trim(),
    recommended_focus: String(parsed.recommended_focus || '').trim(),
  };
}

async function buildRecoveryPlanWithGroqAgent({
  userQuestion = '',
  actionPlan = {},
  initialResponse = '',
  audit = {},
  selectedConnectors = [],
  sources = [],
  history = [],
  logs = [],
} = {}) {
  const apiKey = process.env.GROQ_AGENT_API_KEY;
  if (!apiKey) return null;

  const sourceDigest = (sources || [])
    .slice(0, 12)
    .map(source => ({
      id: source.id,
      label: source.label,
      type: source.type,
      detail: String(source.detail || '').slice(0, 220),
      url: source.url || '',
    }));
  const compactHistory = Array.isArray(history)
    ? history.slice(-4).map(item => ({
        role: item?.role || item?.type || 'user',
        content: String(item?.content || item?.payload?.response || '').slice(0, 260),
      })).filter(item => item.content)
    : [];

  const prompt = `Voce e o agente de recuperacao autonoma do Drekee AI.

Voce NAO responde ao usuario.
Voce decide como a segunda rodada de pesquisa deve ser feita para preencher lacunas factuais centrais.

Retorne APENAS JSON valido:
{
  "should_retry": true,
  "use_existing_evidence": false,
  "needs_new_research": true,
  "goal": "preencher lacunas factuais centrais",
  "search_query": "massa gravidade marte nasa jpl",
  "connectors_required": ["nasa"],
  "connectors_optional": ["tavily"],
  "connectors_forbidden": ["ibge"],
  "focus_facts": ["massa de Marte"],
  "regeneration_brief": "responder de forma mais especifica e orientada pelos fatos ausentes",
  "reasoning": "motivo curto"
}

Regras:
- use apenas conectores permitidos
- se as fontes ja obtidas forem suficientes para preencher a lacuna, prefira use_existing_evidence=true e needs_new_research=false
- priorize conectores primarios antes de Tavily
- use Tavily apenas se fontes especializadas puderem precisar de apoio
- nao aumente escopo alem da lacuna apontada
- should_retry=true apenas se a segunda rodada tiver boa chance de melhorar a resposta
- connectors_forbidden deve bloquear conectores irrelevantes para este retry
- regeneration_brief deve explicar como a resposta final deve ser reescrita depois da recuperacao

Pergunta do usuario: ${JSON.stringify(String(userQuestion || ''))}
Plano inicial: ${JSON.stringify(actionPlan || {})}
Conectores usados antes: ${JSON.stringify(selectedConnectors || [])}
Auditoria OpenRouter: ${JSON.stringify(audit || {})}
Historico recente: ${JSON.stringify(compactHistory)}
Fontes ja obtidas: ${JSON.stringify(sourceDigest)}
Resposta inicial: ${JSON.stringify(String(initialResponse || '').slice(0, 4000))}
Conectores permitidos: ${JSON.stringify([...SUPPORTED_CONNECTORS].sort())}`;

  try {
    const raw = await callGroq(
      [{ role: 'user', content: prompt }],
      'GROQ_AGENT_API_KEY',
      { model: 'llama-3.1-8b-instant', maxTokens: 900, temperature: 0.1 }
    );
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') {
      logs.push('⚠️ GROQ Agent nao retornou JSON valido; retry autonomo abortado.');
      return null;
    }

    return {
      should_retry: parsed.should_retry === true,
      use_existing_evidence: parsed.use_existing_evidence === true,
      needs_new_research: parsed.needs_new_research !== false,
      goal: String(parsed.goal || '').trim(),
      search_query: String(parsed.search_query || '').trim(),
      connectors_required: filterSupportedConnectors(parsed.connectors_required || []),
      connectors_optional: filterSupportedConnectors(parsed.connectors_optional || []),
      connectors_forbidden: filterSupportedConnectors(parsed.connectors_forbidden || []),
      focus_facts: Array.isArray(parsed.focus_facts) ? parsed.focus_facts.map(item => String(item || '').trim()).filter(Boolean) : [],
      regeneration_brief: String(parsed.regeneration_brief || '').trim(),
      reasoning: String(parsed.reasoning || '').trim(),
    };
  } catch (error) {
    logs.push(`⚠️ GROQ Agent indisponivel: ${error.message}`);
    
    // Fallback para SambaNova
    try {
      console.log('🔄 Trying SambaNova fallback for recovery plan...');
      const sambaResponse = await callSambaNova(
        [{ role: 'user', content: prompt }],
        { model: 'Meta-Llama-3.1-8B-Instruct', maxTokens: 900, temperature: 0.1 }
      );
      const parsed = extractJsonObject(sambaResponse);
      if (parsed && typeof parsed === 'object') {
        console.log('✅ Recovery plan generated using SambaNova fallback');
        return {
          should_retry: parsed.should_retry === true,
          use_existing_evidence: parsed.use_existing_evidence === true,
          needs_new_research: parsed.needs_new_research !== false,
          goal: String(parsed.goal || '').trim(),
          search_query: String(parsed.search_query || '').trim(),
          connectors_required: filterSupportedConnectors(parsed.connectors_required || []),
          connectors_optional: filterSupportedConnectors(parsed.connectors_optional || []),
          connectors_forbidden: filterSupportedConnectors(parsed.connectors_forbidden || []),
          focus_facts: Array.isArray(parsed.focus_facts) ? parsed.focus_facts.map(item => String(item || '').trim()).filter(Boolean) : [],
          regeneration_brief: String(parsed.regeneration_brief || '').trim(),
          reasoning: String(parsed.reasoning || '').trim(),
        };
      }
    } catch (sambaErr) {
      console.error('SambaNova fallback failed:', sambaErr);
      logs.push(`❌ Fallback SambaNova também falhou: ${sambaErr.message}`);
    }
    
    return null;
  }
}

async function synthesizeResponseWithAgent({
  userQuestion = '',
  workingResponse = '',
  sources = [],
  audit = {},
  recoveryPlan = {},
  history = [],
  logs = [],
} = {}) {
  const sourceDigest = (sources || [])
    .slice(0, 18)
    .map(source => `${source.id}: ${source.label} - ${String(source.detail || '').slice(0, 280)}`)
    .join('\n');
  const compactHistory = Array.isArray(history)
    ? history.slice(-4).map(item => `${item?.role || item?.type || 'user'}: ${String(item?.content || item?.payload?.response || '').slice(0, 240)}`).join('\n')
    : '';

  const prompt = `Você é o sintetizador pedagógico final do Drekee AI.
Sua missão é transformar dados técnicos em conhecimento encantador para um aluno.

DIRETRIZES DE REDAÇÃO:
1. FOCO NA ANALOGIA: A explicação DEVE girar em torno de uma analogia clara e criativa.
2. INTEGRAÇÃO VISUAL: Se você decidir gerar um mapa mental ou gráfico, use EXCLUSIVAMENTE os formatos abaixo. NUNCA gere ASCII art, desenhos de texto simples, ou blocos markdown com \`\`\`latex\`\`\`. Use APENAS os formatos específicos:
   - Para Mapas Mentais: Use [MINDMAP_TITLE: Título] [MINDMAP_CODE] código TikZ LaTeX aqui [/MINDMAP_CODE].
   - Para Gráficos: Use [LATEX_GRAPH_TITLE: Título] [LATEX_GRAPH_CODE] código TikZ LaTeX aqui [/LATEX_GRAPH_CODE].
3. FORMATO TIKZ: Use a biblioteca 'mindmap' do TikZ. Exemplo: \begin{tikzpicture}[mindmap, concept color=blue!20] \node[concept] {Raiz} child { node[concept] {Ramo} }; \end{tikzpicture}.
4. PROIBIÇÃO TOTAL: NUNCA use \`\`\`latex\`\`\` ou qualquer outro bloco markdown. Use APENAS os formatos [MINDMAP_CODE] e [LATEX_GRAPH_CODE] especificados acima.
5. TOM DE MENTOR: Use frases como "Imagine que...", "Você sabia que...?", "Isso é fascinante porque...".
6. DESAFIO PRÁTICO: Sempre termine ou inclua uma seção "🧪 Desafio Prático" com algo que o aluno possa testar.
7. CITAÇÕES: Mantenha as citações [ID-DA-FONTE: ID_EXATO] de forma natural.

IMPORTANTE: Se não conseguir gerar o código LaTeX TikZ correto, NÃO gere nenhum visual. É proibido gerar ASCII art.

DETECÇÃO DE PEDIDO VISUAL: O usuário pediu "${userQuestion}".
${userRequestedMindMap(userQuestion) ? '🗺️ O USUÁRIO PEDEU EXPLICITAMENTE UM MAPA MENTAL! Se possível, gere um mapa mental em formato LaTeX TikZ.' : 'O usuário não pediu explicitamente um visual.'}

PERGUNTA DO USUÁRIO:
${userQuestion}

RESPOSTA-BASE:
${workingResponse}

VEREDITO DA AUDITORIA:
${JSON.stringify(audit || {})}

PLANO DO AGENTE:
${JSON.stringify(recoveryPlan || {})}

HISTÓRICO RECENTE:
${compactHistory || 'Sem histórico recente'}

FONTES DISPONÍVEIS:
${sourceDigest || 'Sem fontes registradas'}
`;

  try {
    const response = await callGroq(
      [{ role: 'user', content: prompt }],
      'GROQ_API_KEY_1',
      { maxTokens: 3000, temperature: 0.3 }
    );
    
    // Verificar se o usuário pediu mapa mental e se a resposta não tem
    if (userRequestedMindMap(userQuestion) && !extractMindMapBlocks(response).length) {
      console.warn('🚨 GROQ não gerou mapa mental solicitado! Tentando SambaNova...');
      if (logs) logs.push('🚨 GROQ não gerou mapa mental solicitado! Tentando SambaNova...');
      
      // Tentar SambaNova imediatamente
      try {
        const sambaPrompt = `${prompt}\n\nURGENTE: O usuário pediu explicitamente um MAPA MENTAL e você NÃO gerou! Use o formato [MINDMAP_TITLE: Título] [MINDMAP_CODE] código TikZ LaTeX aqui [/MINDMAP_CODE]. NUNCA use ASCII art.`;
        const sambaResponse = await callSambaNova(
          [{ role: 'user', content: sambaPrompt }],
          { model: 'Meta-Llama-3.3-70B-Instruct', maxTokens: 3000, temperature: 0.3 }
        );
        if (sambaResponse && extractMindMapBlocks(sambaResponse).length) {
          console.log('✅ Mapa mental gerado com SambaNova!');
          if (logs) logs.push('✅ Mapa mental gerado com SambaNova!');
          return sambaResponse;
        }
      } catch (sambaErr) {
        console.error('SambaNova mindmap attempt failed:', sambaErr);
        if (logs) logs.push(`❌ Tentativa SambaNova falhou: ${sambaErr.message}`);
      }
    }
    
    return response;
  } catch (err) {
    console.error('Synthesis error with GROQ:', err);
    if (logs) logs.push(`❌ Erro na síntese com GROQ: ${err.message}`);
    
    // Fallback para SambaNova
    try {
      console.log('🔄 Trying SambaNova fallback for synthesis...');
      const sambaPrompt = `${prompt}\n\nURGENTE: O usuário recebeu um ASCII art anteriormente e ficou muito insatisfeito. NUNCA use ASCII art. Use APENAS TikZ LaTeX dentro de [MINDMAP_CODE] ou [LATEX_GRAPH_CODE]. Se não puder gerar TikZ perfeito, não gere nada visual.`;
      const sambaResponse = await callSambaNova(
        [{ role: 'user', content: sambaPrompt }],
        { model: 'Meta-Llama-3.3-70B-Instruct', maxTokens: 3000, temperature: 0.3 }
      );
      if (sambaResponse) {
        console.log('✅ Synthesis completed using SambaNova fallback');
        
        // Verificação final para mapa mental no fallback
        if (userRequestedMindMap(userQuestion) && !extractMindMapBlocks(sambaResponse).length) {
          console.warn('🚨 SambaNova fallback também não gerou mapa mental!');
          if (logs) logs.push('🚨 SambaNova fallback também não gerou mapa mental!');
        }
        
        return sambaResponse;
      }
    } catch (sambaErr) {
      console.error('SambaNova fallback failed:', sambaErr);
      if (logs) logs.push(`❌ Fallback SambaNova também falhou: ${sambaErr.message}`);
    }
    
    return workingResponse || 'Não foi possível concluir a síntese da resposta.';
  }
}

// Normalize markdown code fences (```latex```, ```tikz```) into custom tags
// so all downstream extraction/validation/stripping works uniformly.
function normalizeMarkdownLatexFences(response = '') {
  let text = String(response || '');
  // Convert ```latex ... ``` and ```tikz ... ``` to custom tag format
  text = text.replace(
    /```(?:latex|tikz)\s*([\s\S]*?)\s*```/gi,
    (match, rawCode) => {
      const trimmed = String(rawCode || '').trim();
      if (!trimmed) return ' ';
      if (/mindmap|mind\s*map/i.test(trimmed)) {
        return `[MINDMAP_TITLE: Mapa mental] [MINDMAP_CODE]\n${trimmed}\n[/MINDMAP_CODE]`;
      }
      return `[LATEX_GRAPH_TITLE: Grafico informativo] [LATEX_GRAPH_CODE]\n${trimmed}\n[/LATEX_GRAPH_CODE]`;
    }
  );
  return text;
}

function extractLatexGraphBlocks(response = '') {
  const matches = [];
  const pattern = /\[LATEX_GRAPH_TITLE:\s*([^\]]+?)\s*\]\s*\[LATEX_GRAPH_CODE\]\s*([\s\S]*?)\s*\[\/LATEX_GRAPH_CODE\]/gi;
  let match;
  while ((match = pattern.exec(String(response || ''))) !== null) {
    matches.push({
      raw: match[0],
      title: String(match[1] || '').trim(),
      code: String(match[2] || '').trim(),
    });
  }
  return matches;
}

function extractMindMapBlocks(response = '') {
  const matches = [];
  const pattern = /\[MINDMAP_TITLE:\s*([^\]]+?)\s*\]\s*\[MINDMAP_CODE\]\s*([\s\S]*?)\s*\[\/MINDMAP_CODE\]/gi;
  let match;
  while ((match = pattern.exec(String(response || ''))) !== null) {
    matches.push({
      raw: match[0],
      title: String(match[1] || '').trim(),
      code: String(match[2] || '').trim(),
    });
  }
  return matches;
}

function stripLatexGraphBlocks(response = '') {
  return String(response || '')
    .replace(/\[LATEX_GRAPH_TITLE:\s*[^\]]+?\s*\]\s*\[LATEX_GRAPH_CODE\][\s\S]*?\[\/LATEX_GRAPH_CODE\]/gi, ' ')
    .replace(/\[MINDMAP_TITLE:\s*[^\]]+?\s*\]\s*\[MINDMAP_CODE\][\s\S]*?\[\/MINDMAP_CODE\]/gi, ' ')
    .replace(/\[\/LATEX_GRAPH_TITLE\]/gi, ' ')
    .replace(/\[\/MINDMAP_TITLE\]/gi, ' ')
    .replace(/```(?:latex|tikz)\s*[\s\S]*?\s*```/gi, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function replaceFirstLatexGraphBlock(response = '', graphBlock = '') {
  return String(response || '').replace(
    /\[LATEX_GRAPH_TITLE:\s*[^\]]+?\s*\]\s*\[LATEX_GRAPH_CODE\][\s\S]*?\[\/LATEX_GRAPH_CODE\]/i,
    String(graphBlock || '').trim()
  );
}

function replaceFirstMindMapBlock(response = '', mindMapBlock = '') {
  return String(response || '').replace(
    /\[MINDMAP_TITLE:\s*[^\]]+?\s*\]\s*\[MINDMAP_CODE\][\s\S]*?\[\/MINDMAP_CODE\]/i,
    String(mindMapBlock || '').trim()
  );
}

function analyzeMindMapCode(code = '') {
  const normalizedCode = String(code || '');
  const nodeCount = (normalizedCode.match(/\\node\b/g) || []).length;
  const drawCount = (normalizedCode.match(/\\draw\b/g) || []).length;
  const hasLeftRightLayout = /\bleft=|\bright=|\babove left=|\babove right=|\bbelow left=|\bbelow right=|\bleft of\b|\bright of\b/i.test(normalizedCode);
  const onlyVerticalFlow = !hasLeftRightLayout && (/\babove=|\bbelow=|\babove of\b|\bbelow of\b/i.test(normalizedCode));
  const branchHints = (normalizedCode.match(/\b(?:left|right|north|south|east|west)\b/gi) || []).length;
  const hasTextWidth = /\btext width\s*=/i.test(normalizedCode);
  const hasCenteredText = /\balign\s*=\s*center\b/i.test(normalizedCode);
  const nodeLabelMatches = [...normalizedCode.matchAll(/\\node(?:\[[^\]]*\])?\s*(?:\([^)]+\))?\s*\{([^{}]+)\}/g)];
  const longLabels = nodeLabelMatches
    .map(match => String(match[1] || '').replace(/\\+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(label => label.length > 26);
  const issues = [];

  if (nodeCount < 5) issues.push('Mapa mental com poucos nos para sintetizar o tema.');
  if (drawCount < 4) issues.push('Mapa mental com conexoes insuficientes.');
  if (onlyVerticalFlow) issues.push('O codigo parece um fluxograma vertical, nao um mapa mental radial.');
  if (branchHints < 4) issues.push('O mapa mental nao distribui ramos em multiplas direcoes.');
  if (longLabels.length >= 2) issues.push('Os rotulos dos nos estao longos demais e podem se sobrepor.');
  if (!hasTextWidth) issues.push('Os nos nao definem text width, aumentando risco de sobreposicao.');
  if (!hasCenteredText) issues.push('Os nos nao centralizam o texto, o que prejudica a leitura.');

  return { issues, nodeCount, drawCount };
}

function extractJsonObject(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate);
  } catch (error) {}

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    } catch (error) {}
  }
  return null;
}

async function analyzeConnectorRouting(userQuestion, heuristicConnectors = [], actionPlan = {}, history = [], logs = []) {
  const apiKey = process.env.GROQ_ANALISE_API_KEY;
  if (!apiKey) {
    return null;
  }

  const compactHistory = Array.isArray(history)
    ? history.slice(-4).map(item => ({
        role: item?.role || item?.type || 'user',
        content: String(item?.content || item?.payload?.response || '').slice(0, 280),
      })).filter(item => item.content)
    : [];

  const prompt = `Voce e um roteador tecnico de conectores do Drekee AI.

Tarefa:
- analisar a pergunta do usuario
- escolher quais conectores DEVEM ser usados
- sugerir conectores opcionais
- bloquear conectores irrelevantes
- decidir se a resposta provavelmente precisa de visual

Retorne APENAS JSON valido, sem comentarios.

Formato:
{
  "area": "string curta",
  "intent": "string curta",
  "connectors_required": ["ibge"],
  "connectors_optional": ["tavily"],
  "connectors_forbidden": ["nasa"],
  "needs_visual": false,
  "visual_type": "none",
  "reasoning": "motivo curto"
}

Regras:
- use apenas conectores da lista permitida
- seja conservador com conectores irrelevantes
- para comparacoes estatisticas/geograficas, priorize bases oficiais
- para astronomia, priorize conectores espaciais
- para ciencia, priorize conectores cientificos primarios
- visual_type deve ser "graph", "mindmap" ou "none"
- needs_visual true apenas quando isso realmente ajudar

Pergunta do usuario: ${JSON.stringify(String(userQuestion || ''))}
Plano de busca atual: ${JSON.stringify({
  objetivo: actionPlan?.objetivo || '',
  area: actionPlan?.area || '',
  termo_de_busca: actionPlan?.termo_de_busca || '',
})}
Heuristica atual: ${JSON.stringify(heuristicConnectors)}
Historico recente: ${JSON.stringify(compactHistory)}
Conectores permitidos: ${JSON.stringify([...SUPPORTED_CONNECTORS].sort())}`;

  try {
    const raw = await callGroq(
      [{ role: 'user', content: prompt }],
      'GROQ_ANALISE_API_KEY',
      { model: 'llama-3.1-8b-instant', maxTokens: 700, temperature: 0.1 }
    );
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') {
      logs.push('⚠️ Roteador Groq não retornou JSON válido; mantendo heurística local.');
      return null;
    }

    return {
      area: String(parsed.area || '').trim(),
      intent: String(parsed.intent || '').trim(),
      connectors_required: filterSupportedConnectors(parsed.connectors_required || []),
      connectors_optional: filterSupportedConnectors(parsed.connectors_optional || []),
      connectors_forbidden: filterSupportedConnectors(parsed.connectors_forbidden || []),
      needs_visual: parsed.needs_visual === true,
      visual_type: ['graph', 'mindmap', 'none'].includes(parsed.visual_type) ? parsed.visual_type : 'none',
      reasoning: String(parsed.reasoning || '').trim(),
    };
  } catch (error) {
    logs.push(`⚠️ Roteador Groq indisponível: ${error.message}`);
    return null;
  }
}

function appendVisualSafetyNotice(response = '', notice = '') {
  const trimmedResponse = String(response || '').trim();
  const trimmedNotice = String(notice || '').trim();
  if (!trimmedNotice) return trimmedResponse;
  const safeNotice = `Nota sobre a visualizacao: ${trimmedNotice}`;
  if (!trimmedResponse) return safeNotice;
  if (trimmedResponse.includes(safeNotice)) return trimmedResponse;
  return `${trimmedResponse}\n\n${safeNotice}`;
}

function escapeLatexLabel(value = '') {
  return String(value || '')
    .replace(/\\/g, '\\textbackslash ')
    .replace(/([%&#_$])/g, '\\$1')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\^/g, '\\textasciicircum ')
    .replace(/~/g, '\\textasciitilde ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectCompositionIntent(userQuestion = '', response = '') {
  const text = `${userQuestion}\n${stripLatexGraphBlocks(response)}`.toLowerCase();
  return /\b(composi[cç][aã]o|distribui[cç][aã]o|participa[cç][aã]o|percentual|porcentagem|fatia|propor[cç][aã]o)\b/.test(text) &&
    !detectTimeSeriesIntent(userQuestion, response);
}

async function buildStructuredGraphSpec(response = '', sources = [], userQuestion = '', logs = []) {
  const sourceDigest = (sources || [])
    .slice(0, 8)
    .map(source => `${source.id}: ${source.label} - ${source.detail}`)
    .join('\n');

  const preferredType = detectTimeSeriesIntent(userQuestion, response)
    ? 'line'
    : (detectCompositionIntent(userQuestion, response) ? 'composition' : 'bar');

  const prompt = `Você é um extrator de dados científicos para visualização confiável.

Transforme a resposta abaixo em uma tabela estruturada para gráfico. Não invente nenhum valor.

PERGUNTA:
${userQuestion}

RESPOSTA:
${stripLatexGraphBlocks(response)}

FONTES DISPONÍVEIS:
${sourceDigest}

RETORNE APENAS JSON VÁLIDO:
{
  "title": "titulo curto",
  "chartType": "${preferredType}",
  "xLabel": "rotulo tecnico do eixo x",
  "yLabel": "rotulo tecnico do eixo y com unidade",
  "unit": "unidade ou referencia tecnica",
  "basis": "absolute|percentage|index|count|unknown",
  "missingLabels": ["rotulos/anos sem dado"],
  "series": [
    {
      "name": "nome da serie",
      "points": [
        { "label": "rotulo x", "value": 0, "status": "confirmed" }
      ]
    }
  ]
}

REGRAS:
1. Use APENAS valores explicitamente sustentados pela resposta/fonte.
2. Se faltar dado, coloque o rótulo em "missingLabels" e NÃO invente 0.
3. Em série temporal, preserve apenas anos/periodos realmente confirmados.
4. Em composição, prefira percentuais apenas se estiverem explicitamente sustentados; caso contrário, use valores absolutos.
5. Se não houver dados suficientes para um gráfico confiável, retorne {"title":"", "chartType":"${preferredType}", "xLabel":"", "yLabel":"", "unit":"", "basis":"unknown", "missingLabels":[], "series":[]}
6. Não use markdown.
`;

  return extractJsonObject(await callGemini(prompt, logs));
}

function validateStructuredGraphSpec(spec = {}, context = {}) {
  const issues = [];
  const normalized = {
    title: String(spec?.title || 'Grafico informativo').trim(),
    chartType: String(spec?.chartType || '').trim().toLowerCase(),
    xLabel: String(spec?.xLabel || '').trim(),
    yLabel: String(spec?.yLabel || '').trim(),
    unit: String(spec?.unit || '').trim(),
    basis: String(spec?.basis || 'unknown').trim().toLowerCase(),
    missingLabels: Array.isArray(spec?.missingLabels) ? spec.missingLabels.map(item => String(item || '').trim()).filter(Boolean) : [],
    series: Array.isArray(spec?.series) ? spec.series.map(series => ({
      name: String(series?.name || '').trim() || 'Serie',
      points: Array.isArray(series?.points) ? series.points.map(point => ({
        label: String(point?.label || '').trim(),
        value: Number(point?.value),
        status: String(point?.status || 'confirmed').trim().toLowerCase(),
      })).filter(point => point.label && Number.isFinite(point.value)) : [],
    })).filter(series => series.points.length > 0) : [],
  };

  if (!['line', 'bar', 'composition'].includes(normalized.chartType)) {
    issues.push('Tipo de grafico estruturado invalido.');
  }
  if (!normalized.yLabel || normalized.yLabel.length < 3) {
    issues.push('Rotulo tecnico do eixo Y ausente.');
  }
  if (normalized.series.length === 0) {
    issues.push('Tabela estruturada sem series confirmadas.');
  }

  const allPoints = normalized.series.flatMap(series => series.points);
  const labels = allPoints.map(point => point.label);
  const values = allPoints.map(point => point.value);
  const numericYearLabels = labels.filter(label => /^\d{4}(?:\/\d{2})?$/.test(label));
  const allPercentLike = normalized.basis === 'percentage' || /%|porcent|percent/i.test(`${normalized.unit} ${normalized.yLabel}`);

  if (allPoints.some(point => point.status !== 'confirmed')) {
    issues.push('Tabela estruturada contem pontos nao confirmados.');
  }
  if (allPercentLike && values.some(value => Math.abs(value) > 100)) {
    issues.push('Valor percentual fora de faixa plausivel.');
  }
  if (normalized.chartType === 'line' && allPoints.length < 2) {
    issues.push('Grafico de linha precisa de ao menos dois pontos confirmados.');
  }
  if (normalized.chartType === 'composition' && normalized.series.length !== 1) {
    issues.push('Grafico de composicao deve usar uma unica serie estruturada.');
  }
  if (normalized.chartType === 'composition') {
    const total = values.reduce((sum, value) => sum + value, 0);
    if (allPercentLike && (total < 95 || total > 105)) {
      issues.push('Composicao percentual nao fecha aproximadamente 100%.');
    }
  }
  if (findLongestRepeatedNumericRun(values) >= 3 && normalized.missingLabels.length === 0 && normalized.chartType === 'line') {
    issues.push('Sequencia numerica improvavel sem aviso de dado ausente.');
  }

  const requestedYearRange = detectRequestedYearRange(context.userQuestion || '');
  if (requestedYearRange && numericYearLabels.length > 0) {
    const plottedYears = [...new Set(numericYearLabels.map(label => Number(label.slice(0, 4))))];
    const expectedYears = requestedYearRange.endYear - requestedYearRange.startYear + 1;
    if (plottedYears.length < expectedYears && normalized.missingLabels.length === 0) {
      issues.push('Cobertura temporal incompleta sem declaracao de dados ausentes.');
    }
    if (plottedYears.length < expectedYears && normalized.chartType === 'line') {
      issues.push('Serie temporal incompleta deve usar barras ou declarar claramente as lacunas.');
    }
  }

  if (detectCategoryComparisonIntent(context.userQuestion, context.response) && normalized.chartType === 'line') {
    issues.push('Comparacao discreta nao deve sair como linha.');
  }
  if (detectCompositionIntent(context.userQuestion, context.response) && normalized.chartType !== 'composition') {
    issues.push('Pergunta de composicao deve usar template de composicao.');
  }

  return { issues, spec: normalized };
}

function renderStructuredGraphLatex(spec = {}) {
  const title = escapeLatexLabel(spec.title || 'Grafico informativo');
  const xLabel = escapeLatexLabel(spec.xLabel || 'Categoria');
  const yLabel = escapeLatexLabel(spec.yLabel || 'Valor');
  const chartType = spec.chartType;

  if (chartType === 'line') {
    const allLabels = [...new Set(spec.series.flatMap(series => series.points.map(point => point.label)))];
    const yearLike = allLabels.every(label => /^\d{4}$/.test(label));
    const xAxisSetup = yearLike
      ? [
          `xmin=${Math.min(...allLabels.map(Number)) - 0.5},`,
          `xmax=${Math.max(...allLabels.map(Number)) + 0.5},`,
          `xtick={${allLabels.join(', ')}},`,
          'x tick label style={/pgf/number format/fixed, /pgf/number format/1000 sep={}},',
        ].join('\n    ')
      : [
          `symbolic x coords={${allLabels.map(escapeLatexLabel).join(', ')}},`,
          'xtick=data,',
          'x tick label style={rotate=0, anchor=north},',
        ].join('\n    ');

    const seriesLatex = spec.series.map(series => {
      const coords = series.points
        .map(point => `(${yearLike ? point.label : escapeLatexLabel(point.label)}, ${point.value})`)
        .join(' ');
      return [
        '\\addplot[',
        '  thick,',
        '  mark=*,',
        '] coordinates {',
        `  ${coords}`,
        '};',
        `\\addlegendentry{${escapeLatexLabel(series.name)}}`,
      ].join('\n');
    }).join('\n\n');

    return [
      '\\documentclass[tikz,border=16pt]{standalone}',
      '\\usepackage[utf8]{inputenc}',
      '\\usepackage[T1]{fontenc}',
      '\\usepackage{pgfplots}',
      '\\usepackage{xcolor}',
      '\\pgfplotsset{compat=1.18}',
      '\\begin{document}',
      '\\begin{tikzpicture}',
      '\\begin{axis}[',
      '    drekee premium,',
      `    title={\\textbf{${title}}},`,
      `    xlabel={\\textbf{${xLabel}}},`,
      `    ylabel={\\textbf{${yLabel}}},`,
      `    ${xAxisSetup}`,
      '    extra y ticks={0},',
      '    extra y tick style={grid=major, grid style={dashed, draw=graph_grid}},',
      ']',
      seriesLatex,
      '\\end{axis}',
      '\\end{tikzpicture}',
      '\\end{document}',
    ].join('\n');
  }

  if (chartType === 'composition') {
    const points = spec.series[0]?.points || [];
    const total = points.reduce((sum, point) => sum + point.value, 0);
    const xMax = total > 0 ? Math.ceil(total * 1.1) : 100;
    const addplots = points.map((point, index) => [
      '\\addplot+[xbar stacked] coordinates {',
      `  (${point.value}, ${escapeLatexLabel(spec.series[0].name || 'Composicao')})`,
      '};',
      `\\addlegendentry{${escapeLatexLabel(point.label)}}`,
    ].join('\n')).join('\n\n');

    return [
      '\\documentclass[tikz,border=16pt]{standalone}',
      '\\usepackage[utf8]{inputenc}',
      '\\usepackage[T1]{fontenc}',
      '\\usepackage{pgfplots}',
      '\\usepackage{xcolor}',
      '\\pgfplotsset{compat=1.18}',
      '\\begin{document}',
      '\\begin{tikzpicture}',
      '\\begin{axis}[',
      '    drekee premium,',
      '    xbar stacked,',
      `    title={\\textbf{${title}}},`,
      `    xlabel={\\textbf{${yLabel}}},`,
      '    ytick=data,',
      `    symbolic y coords={${escapeLatexLabel(spec.series[0].name || 'Composicao')}},`,
      '    xmin=0,',
      `    xmax=${xMax},`,
      '    nodes near coords,',
      ']',
      addplots,
      '\\end{axis}',
      '\\end{tikzpicture}',
      '\\end{document}',
    ].join('\n');
  }

  const categories = [...new Set(spec.series.flatMap(series => series.points.map(point => point.label)))];
  const addplots = spec.series.map(series => {
    const coords = series.points
      .map(point => `(${escapeLatexLabel(point.label)}, ${point.value})`)
      .join(' ');
    return [
      '\\addplot+[ybar] coordinates {',
      `  ${coords}`,
      '};',
      `\\addlegendentry{${escapeLatexLabel(series.name)}}`,
    ].join('\n');
  }).join('\n\n');

  return [
    '\\documentclass[tikz,border=16pt]{standalone}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{pgfplots}',
    '\\usepackage{xcolor}',
    '\\pgfplotsset{compat=1.18}',
    '\\begin{document}',
    '\\begin{tikzpicture}',
    '\\begin{axis}[',
    '    drekee premium,',
    '    ybar,',
    `    title={\\textbf{${title}}},`,
    `    xlabel={\\textbf{${xLabel}}},`,
    `    ylabel={\\textbf{${yLabel}}},`,
    `    symbolic x coords={${categories.map(escapeLatexLabel).join(', ')}},`,
    '    xtick=data,',
    ']',
    addplots,
    '\\end{axis}',
    '\\end{tikzpicture}',
    '\\end{document}',
  ].join('\n');
}

function buildGraphBlockFromSpec(spec = {}) {
  return [
    `[LATEX_GRAPH_TITLE: ${String(spec.title || 'Grafico informativo').trim()}]`,
    '[LATEX_GRAPH_CODE]',
    renderStructuredGraphLatex(spec),
    '[/LATEX_GRAPH_CODE]',
  ].join('\n');
}

async function buildStructuredMindMapSpec(response = '', sources = [], userQuestion = '', logs = []) {
  const sourceDigest = (sources || [])
    .slice(0, 8)
    .map(source => `${source.id}: ${source.label} - ${source.detail}`)
    .join('\n');

  const prompt = `Você é um extrator confiável para mapas mentais científicos.
Sua tarefa é extrair os conceitos principais e sub-tópicos de uma resposta e suas fontes para criar um mapa mental RADIAL e HIERÁRQUICO.

Retorne APENAS um JSON válido no seguinte formato:
{
  "title": "Título do Mapa",
  "center": "Conceito Central",
  "branches": [
    {
      "label": "Tópico Principal 1",
      "subtopics": ["Sub 1.1", "Sub 1.2", "Sub 1.3"]
    }
  ]
}

REGRAS:
1. "center" deve ser o tema central da pergunta/resposta.
2. "branches" deve ter entre 3 e 5 tópicos principais.
3. Cada branch deve ter entre 2 e 3 subtopics curtos (máximo 4 palavras cada).
4. NUNCA gere ASCII art ou TikZ aqui. Apenas o JSON.
3. Marque oversimplified=true se o ramo reduzir demais um tema sensível ou ambíguo.
4. approved só pode ser true se todos os ramos estiverem sustentados e sem vazamento causal.
5. Em tema sensível, approved deve ser false se houver simplificação excessiva relevante.
6. Não use markdown.
`;

  const audit = extractJsonObject(await callGemini(prompt, logs)) || {};
  const branchChecks = Array.isArray(audit.branchChecks) ? audit.branchChecks : [];
  const issues = Array.isArray(audit.issues) ? audit.issues.map(item => String(item || '').trim()).filter(Boolean) : [];
  const unsupportedBranch = branchChecks.some(item => item?.supported === false);
  const causalLeak = branchChecks.some(item => item?.causalLeak === true);
  const oversimplified = branchChecks.some(item => item?.oversimplified === true);
  const sensitiveTopic = audit.sensitiveTopic === true || detectSensitiveConceptualTopic(userQuestion, response);
  const approved = audit.approved === true && !unsupportedBranch && !causalLeak && !(sensitiveTopic && oversimplified);

  if (unsupportedBranch && !issues.some(issue => /ramo|suporte|fonte/i.test(issue))) {
    issues.push('Um ou mais ramos do mapa mental nao puderam ser rastreados de volta a resposta/fonte.');
  }
  if (causalLeak && !issues.some(issue => /causal|causa|consequ/i.test(issue))) {
    issues.push('O mapa mental introduziu relacao causal ou consequencia sem sustentacao suficiente.');
  }
  if (sensitiveTopic && oversimplified && !issues.some(issue => /sens[ií]vel|simpl/i.test(issue))) {
    issues.push('O mapa mental simplificou demais um tema sensivel.');
  }

  return { approved, issues, sensitiveTopic, branchChecks };
}

function validateStructuredMindMapSpec(spec = {}) {
  const issues = [];
  const normalized = {
    title: String(spec?.title || 'Mapa mental').trim(),
    center: String(spec?.center || '').trim(),
    branches: Array.isArray(spec?.branches) ? spec.branches.map(b => ({
      label: String(b?.label || '').trim(),
      subtopics: Array.isArray(b?.subtopics) ? b.subtopics.map(s => String(s || '').trim()).filter(Boolean) : []
    })).filter(b => b.label) : []
  };

  if (!normalized.center) issues.push('Centro do mapa mental ausente.');
  if (normalized.branches.length < 3) issues.push('Mapa mental precisa de ao menos 3 ramos principais.');
  if (normalized.branches.length > 5) issues.push('Mapa mental precisa de no máximo 5 ramos principais.');
  if (normalized.branches.some(branch => branch.label.length > 24)) issues.push('Ramo principal com rótulo longo demais.');
  if (normalized.branches.some(branch => branch.subtopics.some(item => item.length > 24))) issues.push('Subtópico longo demais para template radial.');

  return { issues, spec: normalized };
}

function renderStructuredMindMapLatex(spec = {}) {
  const positions = [
    { main: 'right=4.6cm of center', subs: ['above right=0.95cm and 1.8cm of branch1', 'right=2.0cm of branch1', 'below right=0.95cm and 1.8cm of branch1'], anchor: 'east' },
    { main: 'left=4.6cm of center', subs: ['above left=0.95cm and 1.8cm of branch2', 'left=2.0cm of branch2', 'below left=0.95cm and 1.8cm of branch2'], anchor: 'west' },
    { main: 'above=3.3cm of center', subs: ['above left=0.8cm and 0.7cm of branch3', 'above=1.8cm of branch3', 'above right=0.8cm and 0.7cm of branch3'], anchor: 'north' },
    { main: 'below=3.3cm of center', subs: ['below left=0.8cm and 0.7cm of branch4', 'below=1.8cm of branch4', 'below right=0.8cm and 0.7cm of branch4'], anchor: 'south' },
    { main: 'above right=2.7cm and 3.5cm of center', subs: ['above right=0.8cm and 1.2cm of branch5', 'right=1.8cm of branch5', 'below right=0.8cm and 1.2cm of branch5'], anchor: 'north east' },
  ];

  const branchNodes = spec.branches.map((branch, branchIndex) => {
    const position = positions[branchIndex];
    const branchName = `branch${branchIndex + 1}`;
    const lines = [
      `\\node[main, ${position.main}] (${branchName}) {${escapeLatexLabel(branch.label)}};`,
      `\\draw (center.${position.anchor}) -- (${branchName});`,
    ];

    branch.subtopics.slice(0, 3).forEach((subtopic, subIndex) => {
      const subName = `${branchName}s${subIndex + 1}`;
      lines.push(`\\node[sub, ${position.subs[subIndex]}] (${subName}) {${escapeLatexLabel(subtopic)}};`);
      lines.push(`\\draw (${branchName}) -- (${subName});`);
    });

    return lines.join('\n');
  }).join('\n\n');

  return [
    '\\documentclass[tikz,border=14pt]{standalone}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{xcolor}',
    '\\usetikzlibrary{positioning,shapes.geometric,arrows.meta,calc}',
    '\\begin{document}',
    '\\begin{tikzpicture}[',
    '  >=Stealth,',
    '  line width=1.1pt,',
    '  draw=gray!60,',
    '  base/.style={align=center, inner sep=8pt, font=\\sffamily\\bfseries, text width=3.3cm},',
    '  root/.style={base, ellipse, fill=blue!4, draw=blue!70, minimum width=4.4cm, minimum height=1.7cm, text width=4.1cm},',
    '  main/.style={base, rectangle, rounded corners=10pt, fill=gray!5, draw=gray!80, minimum width=3.2cm, minimum height=1.05cm, text width=3.0cm},',
    '  sub/.style={base, rectangle, rounded corners=5pt, fill=white, draw=gray!45, font=\\sffamily\\small, minimum width=2.5cm, text width=2.6cm}',
    ']',
    `\\node[root] (center) {${escapeLatexLabel(spec.center)}};`,
    branchNodes,
    '\\end{tikzpicture}',
    '\\end{document}',
  ].join('\n');
}

function buildMindMapBlockFromSpec(spec = {}) {
  return [
    `[MINDMAP_TITLE: ${String(spec.title || 'Mapa mental').trim()}]`,
    '[MINDMAP_CODE]',
    renderStructuredMindMapLatex(spec),
    '[/MINDMAP_CODE]',
  ].join('\n');
}

function countCitationTags(text = '') {
  return (String(text || '').match(/\[ID-DA-FONTE:\s*[^\]]+\]/gi) || []).length;
}

function assessResponseReliability(response = '', sources = []) {
  const text = String(response || '');
  const citedCount = countCitationTags(text);
  const sourceCount = Array.isArray(sources) ? sources.length : 0;
  const riskyParagraphs = text
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => !/\[LATEX_GRAPH_TITLE:|\[LATEX_GRAPH_CODE\]|\[MINDMAP_TITLE:|\[MINDMAP_CODE\]|\[PHET:|\[PDB:/i.test(part))
    .filter(part =>
      !/\[ID-DA-FONTE:\s*[^\]]+\]/i.test(part) &&
      /\b(al[eé]m disso|impacto indireto|pode impactar|pode afetar|tende a|provavel|possivelmente|isso sugere|isso indica|consequ[eê]ncia|economia|setores? como)\b/i.test(part)
    ).length;

  if (citedCount >= 4 && sourceCount >= 2 && riskyParagraphs === 0) return 'HIGH';
  if (citedCount >= 2 && riskyParagraphs <= 1) return 'MEDIUM';
  return 'LOW';
}

function removeUnsupportedAnalyticalParagraphs(response = '') {
  const protectedBlocks = [];
  let working = String(response || '').replace(
    /\[(?:LATEX_GRAPH_TITLE|MINDMAP_TITLE):\s*[^\]]+?\s*\]\s*\[(?:LATEX_GRAPH_CODE|MINDMAP_CODE)\][\s\S]*?\[\/(?:LATEX_GRAPH_CODE|MINDMAP_CODE)\]/gi,
    match => {
      const token = `__GRAPH_BLOCK_${protectedBlocks.length}__`;
      protectedBlocks.push(match);
      return token;
    }
  );

  working = working
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => {
      if (/__GRAPH_BLOCK_\d+__/.test(part)) return true;
      if (/\[ID-DA-FONTE:\s*[^\]]+\]/i.test(part)) return true;
      if (!/\b(al[eé]m disso|impacto indireto|pode impactar|pode afetar|setores? como|economia|mercado|cadeia|consequ[eê]ncia|tende a|isso sugere|isso indica)\b/i.test(part)) {
        return true;
      }
      return false;
    })
    .join('\n\n');

  working = working.replace(/__GRAPH_BLOCK_(\d+)__/g, (match, index) => protectedBlocks[Number(index)] || match);
  return working.trim();
}

function detectTimeSeriesIntent(userQuestion = '', response = '') {
  const text = `${userQuestion}\n${stripLatexGraphBlocks(response)}`.toLowerCase();
  return /\b(ao longo|evolu[cç][aã]o|s[ée]rie|safra|d[eé]cada|anos?|mensal|anual|hist[oó]rico|entre\s+\d{4}\s+e\s+\d{4}|\d{4}\/\d{2})\b/.test(text);
}

function detectCategoryComparisonIntent(userQuestion = '', response = '') {
  const text = `${userQuestion}\n${stripLatexGraphBlocks(response)}`.toLowerCase();
  return /\b(vs\.?|versus|compar[ae]|comparando|comparativo|brasil|m[eé]dia mundial|mundo|fontes?|categorias?|setores?|pa[ií]ses|estados?)\b/.test(text) &&
    !detectTimeSeriesIntent(userQuestion, response);
}

function enforceSingleVisualChoice(response = '', userQuestion = '') {
  const graphBlocks = extractLatexGraphBlocks(response);
  const mindMapBlocks = extractMindMapBlocks(response);
  if (graphBlocks.length === 0 || mindMapBlocks.length === 0) return String(response || '');

  if (detectTimeSeriesIntent(userQuestion, response) || detectCategoryComparisonIntent(userQuestion, response)) {
    return String(response || '').replace(/\[MINDMAP_TITLE:\s*[^\]]+?\s*\]\s*\[MINDMAP_CODE\][\s\S]*?\[\/MINDMAP_CODE\]/gi, ' ').trim();
  }

  return String(response || '').replace(/\[LATEX_GRAPH_TITLE:\s*[^\]]+?\s*\]\s*\[LATEX_GRAPH_CODE\][\s\S]*?\[\/LATEX_GRAPH_CODE\]/gi, ' ').trim();
}

function userRequestedMindMap(userQuestion = '') {
  const q = String(userQuestion || '').toLowerCase();
  return /\b(mapa\s*mental|mind\s*map|mindmap|mapa\s*de\s*conceitos|crie\s+um\s+mapa|faça\s+um\s+mapa|gerar\s+mapa)\b/i.test(q);
}

function detectExplicitVisualRequest(userQuestion = '') {

  return /\b(grafico|gráfico|mapa mental|diagrama|esquema|visualiza[cç][aã]o|visual)\b/i.test(String(userQuestion || ''));
}

function detectConceptualVisualIntent(userQuestion = '') {
  return /\b(o que e|o que Ã©|como funciona|explique|explica|resuma|organize|vis[aÃ£]o geral|panorama|relacione|etapas|processo|diferen[cÃ§]a)\b/i.test(String(userQuestion || ''));
}

function detectCompactMetricComparisonIntent(userQuestion = '', response = '') {
  const text = `${userQuestion}\n${stripLatexGraphBlocks(response)}`.toLowerCase();
  const hasPhysicalMetric = /\b(massa|gravidade|diametro|diâmetro|raio|pressao atmosferica|pressão atmosférica|densidade|temperatura|velocidade de escape)\b/.test(text);
  const hasCelestialContext = /\b(marte|terra|venus|vênus|jupiter|júpiter|saturno|mercurio|mercúrio|lua|planeta|astronomia)\b/.test(text);
  const hasCompactCompare = /\b(compare|compar[ae]|comparando|comparativo|em rela[cç][aã]o|versus|vs\.?)\b/.test(text);
  const hasBroadCategorySet = /\b(estados?|pa[ií]ses|fontes de energia|setores?|categorias?|anos?)\b/.test(text);
  return hasPhysicalMetric && hasCelestialContext && hasCompactCompare && !hasBroadCategorySet;
}

function countResponseCitations(response = '') {
  return (String(response || '').match(/\[ID-DA-FONTE:\s*[^\]]+\]/gi) || []).length;
}

function stripAllVisualBlocks(response = '') {
  return String(response || '')
    .replace(/\[LATEX_GRAPH_TITLE:\s*[^\]]+?\s*\]\s*\[LATEX_GRAPH_CODE\][\s\S]*?\[\/LATEX_GRAPH_CODE\]/gi, ' ')
    .replace(/\[MINDMAP_TITLE:\s*[^\]]+?\s*\]\s*\[MINDMAP_CODE\][\s\S]*?\[\/MINDMAP_CODE\]/gi, ' ')
    .replace(/\[LATEX_GRAPH_TITLE:\s*[^\]]+?\]/gi, ' ')
    .replace(/\[MINDMAP_TITLE:\s*[^\]]+?\]/gi, ' ')
    .replace(/```(?:latex|tikz)\s*[\s\S]*?\s*```/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function shouldKeepAnalyticalVisual(response = '', sources = [], userQuestion = '') {
  const graphBlocks = extractLatexGraphBlocks(response);
  const mindMapBlocks = extractMindMapBlocks(response);
  if (graphBlocks.length === 0 && mindMapBlocks.length === 0) return true;

  const explicitVisual = detectExplicitVisualRequest(userQuestion);
  const sourceCount = Array.isArray(sources) ? sources.length : 0;
  const citationCount = countResponseCitations(response);
  const graphIntent = detectTimeSeriesIntent(userQuestion, response) || detectCategoryComparisonIntent(userQuestion, response);
  const conceptualIntent = /\b(o que e|o que é|como funciona|explique|explica|resuma|organize|vis[aã]o geral|panorama|relacione|etapas|processo|diferen[cç]a)\b/i.test(String(userQuestion || ''));

  if (graphBlocks.length > 0) {
    if (!explicitVisual && !graphIntent) return false;
    if (!explicitVisual && (sourceCount < 3 || citationCount < 4)) return false;
  }

  if (mindMapBlocks.length > 0) {
    if (!explicitVisual && !conceptualIntent) return false;
    if (!explicitVisual && (sourceCount < 2 || citationCount < 3)) return false;
  }

  return true;
}

function shouldKeepAnalyticalVisualCalibrated(response = '', sources = [], userQuestion = '') {
  const graphBlocks = extractLatexGraphBlocks(response);
  const mindMapBlocks = extractMindMapBlocks(response);
  if (graphBlocks.length === 0 && mindMapBlocks.length === 0) return true;

  const explicitVisual = detectExplicitVisualRequest(userQuestion);
  const sourceCount = Array.isArray(sources) ? sources.length : 0;
  const citationCount = countResponseCitations(response);
  const graphIntent = detectTimeSeriesIntent(userQuestion, response) || detectCategoryComparisonIntent(userQuestion, response);
  const conceptualIntent = detectConceptualVisualIntent(userQuestion);
  const compactMetricComparison = detectCompactMetricComparisonIntent(userQuestion, response);

  if (graphBlocks.length > 0) {
    if (!explicitVisual && compactMetricComparison) return false;
    if (!explicitVisual && !graphIntent) return false;
    if (!explicitVisual && graphIntent && (sourceCount < 1 || citationCount < 2)) return false;
  }

  if (mindMapBlocks.length > 0) {
    if (!explicitVisual && !conceptualIntent) return false;
    if (!explicitVisual && conceptualIntent && (sourceCount < 1 || citationCount < 2)) return false;
  }

  return true;
}

function findLongestRepeatedNumericRun(values = []) {
  let longest = 1;
  let current = 1;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] === values[index - 1]) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 1;
    }
  }
  return longest;
}

function detectRequestedYearRange(userQuestion = '') {
  const text = String(userQuestion || '');
  const explicitRange = text.match(/\b(20\d{2})\s*(?:a|até|ate|-|–|—)\s*(20\d{2})\b/i);
  if (explicitRange) {
    const startYear = Number(explicitRange[1]);
    const endYear = Number(explicitRange[2]);
    if (startYear <= endYear) return { startYear, endYear };
  }

  const allYears = [...text.matchAll(/\b(20\d{2})\b/g)].map(match => Number(match[1]));
  if (allYears.length >= 2) {
    const startYear = Math.min(...allYears);
    const endYear = Math.max(...allYears);
    if (startYear < endYear) return { startYear, endYear };
  }

  return null;
}

function analyzeLatexGraph(code = '', context = {}) {
  const issues = [];
  const normalizedCode = String(code || '');
  const isTimeSeries = detectTimeSeriesIntent(context.userQuestion, context.response);
  const isCategoryComparison = detectCategoryComparisonIntent(context.userQuestion, context.response);
  const addPlotCount = (normalizedCode.match(/\\addplot/gi) || []).length;
  const coordinateCount = (normalizedCode.match(/\([^()]+,\s*[-+]?\d+(?:\.\d+)?\)/g) || []).length;
  const yLabelMatch = normalizedCode.match(/ylabel\s*=\s*\{([^}]*)\}/i);
  const yLabel = String(yLabelMatch?.[1] || '').trim();
  const symbolicXMatch = normalizedCode.match(/symbolic x coords\s*=\s*\{([^}]*)\}/i);
  const symbolicLabels = symbolicXMatch
    ? symbolicXMatch[1].split(',').map(item => item.trim()).filter(Boolean)
    : [];
  const xticklabelsMatch = normalizedCode.match(/xticklabels\s*=\s*\{([^}]*)\}/i);
  const xticklabels = xticklabelsMatch
    ? xticklabelsMatch[1].split(',').map(item => item.trim()).filter(Boolean)
    : [];
  const coordinateMatches = [...normalizedCode.matchAll(/\(([^()]+?),\s*([-+]?\d+(?:\.\d+)?)\)/g)];
  const coordinateEntries = coordinateMatches.map(match => match[1].trim());
  const numericCoordinateXs = coordinateEntries.filter(value => /^[-+]?\d+(?:\.\d+)?$/.test(value));
  const numericCoordinateYs = coordinateMatches.map(match => Number(match[2]));
  const longestRepeatedRun = findLongestRepeatedNumericRun(numericCoordinateYs);
  const requestedYearRange = detectRequestedYearRange(context.userQuestion);
  const responseWithoutGraph = stripLatexGraphBlocks(context.response || '');
  const mentionsMissingData = /\b(n[aã]o (?:foram|foi) localizados?|dados? ausentes?|sem dado|lacuna|n[aã]o dispon[ií]vel)\b/i.test(responseWithoutGraph);
  const seemsPercentVariation = /\b(pib|varia[cç][aã]o percentual|crescimento|contra[cç][aã]o|recuo|queda percentual|percentual)\b/i.test(`${context.userQuestion}\n${responseWithoutGraph}`);
  const hasZeroBaseline = /\bextra y ticks\s*=\s*\{[^}]*0[^}]*\}|\bextra y tick labels\s*=|\baxis x line|\\addplot\s*\[[^\]]*\]\s*coordinates\s*\{\s*\([^)]*,\s*0(?:\.0+)?\)\s*\([^)]*,\s*0(?:\.0+)?\)/i.test(normalizedCode) ||
    /\bytick\s*=\s*\{[^}]*0[^}]*\}/i.test(normalizedCode);
  const plottedYears = numericCoordinateXs
    .map(value => Number(value))
    .filter(value => Number.isInteger(value) && value >= 1900 && value <= 2100);

  if (!addPlotCount) issues.push('O grafico nao possui \\addplot.');
  if (coordinateCount < 2) issues.push('O grafico nao tem pontos suficientes.');
  if (!yLabel) {
    issues.push('O eixo Y nao foi rotulado.');
  } else if (/^(valores?|valor|temperatura|indice|pontuacao|resultado)$/i.test(yLabel)) {
    issues.push('O eixo Y esta generico demais para um grafico cientifico.');
  }

  if (isTimeSeries) {
    if (/\bybar\b/i.test(normalizedCode)) issues.push('Serie temporal deve usar grafico de linha, nao barras.');
    if (/fill\s*=|fill between|closedcycle|area legend/i.test(normalizedCode)) issues.push('Serie temporal nao deve usar area/cunha preenchida.');
    if (!/mark\s*=|\bevery mark\b/i.test(normalizedCode)) issues.push('Serie temporal precisa de marcadores visiveis.');
    if (!/thick|line width\s*=|very thick/i.test(normalizedCode)) issues.push('Serie temporal precisa de linha espessa o suficiente para leitura.');
    if (longestRepeatedRun >= 3 && !mentionsMissingData) issues.push('Ha uma sequencia longa de valores identicos; isso pode indicar que dado ausente virou valor artificial.');
    if (seemsPercentVariation && !hasZeroBaseline) issues.push('Grafico de variacao percentual precisa mostrar referencia visual para y=0.');
    if (requestedYearRange && plottedYears.length > 0) {
      const expectedYears = requestedYearRange.endYear - requestedYearRange.startYear + 1;
      const uniqueYears = [...new Set(plottedYears)];
      if (uniqueYears.length < expectedYears && !mentionsMissingData) {
        issues.push('O periodo pedido nao esta completo no grafico e a resposta nao explica os anos ausentes.');
      }
      if (uniqueYears.length < expectedYears && !/\bybar\b/i.test(normalizedCode)) {
        issues.push('Periodo incompleto nao deve ser mostrado como linha continua; prefira barras para os anos disponiveis.');
      }
    }
  }

  if (isCategoryComparison) {
    if (!/\bybar\b/i.test(normalizedCode)) issues.push('Comparacao entre categorias discretas deve usar barras para evitar leitura ambigua.');
    if (symbolicLabels.length > 0 && numericCoordinateXs.length > 0) {
      issues.push('Ha labels simbolicos no eixo X, mas os pontos usam posicoes numericas; isso pode desalinha-los.');
    }
    if (xticklabels.length > 0 && coordinateEntries.length > 0 && xticklabels.length !== coordinateEntries.length) {
      issues.push('A quantidade de rótulos do eixo X nao bate com a quantidade de pontos.');
    }
  }

  if (/\bmatriz el[eé]trica\b/i.test(`${context.userQuestion}\n${context.response}`) && /\b49[.,]1\b/.test(`${context.response}`)) {
    issues.push('Possivel confusao entre matriz eletrica e matriz energetica.');
  }

  return { issues, isTimeSeries, isCategoryComparison };
}

async function alignGraphWithResponseReliability(response = '', sources = [], userQuestion = '', logs = []) {
  const wantsMindMap = userRequestedMindMap(userQuestion);
  const hasMindMapBlock = extractMindMapBlocks(response).length > 0;

  // Injeção automática se o usuário pediu e o modelo não gerou
  if (wantsMindMap && !hasMindMapBlock) {
    try {
      logs.push('🧠 Tentando gerar mapa mental automaticamente (solicitado pelo usuário)...');
      const structuredMindMap = await buildStructuredMindMapSpec(response, sources, userQuestion, logs);
      if (structuredMindMap) {
        const mindMapValidation = validateStructuredMindMapSpec(structuredMindMap);
        if (mindMapValidation.issues.length === 0) {
          const semanticAudit = await auditMindMapSemantics(mindMapValidation.spec, response, sources, userQuestion, logs);
          if (semanticAudit.approved) {
            logs.push('✅ Mapa mental adicionado automaticamente.');
            response = `${String(response || '').trim()}\n\n${buildMindMapBlockFromSpec(mindMapValidation.spec)}`.trim();
          } else {
            logs.push(`🛑 Injeção cancelada: auditoria semântica reprovou (${semanticAudit.issues.join(' | ')}).`);
          }
        } else {
          logs.push(`🛑 Injeção cancelada: estrutura inválida (${mindMapValidation.issues.join(' | ')}).`);
        }
      }
    } catch (err) {
      console.error('Auto MindMap Injection Error:', err);
    }
  }

  response = enforceSingleVisualChoice(response, userQuestion);
  if (!shouldKeepAnalyticalVisualCalibrated(response, sources, userQuestion)) {
    logs.push('🛑 Visual removido: a pergunta nao exigia grafico/mapa mental com clareza suficiente.');
    return { response: stripAllVisualBlocks(response), confidence: assessResponseReliability(response, sources) };
  }
  const graphBlocks = extractLatexGraphBlocks(response);
  const mindMapBlocks = extractMindMapBlocks(response);
  if (graphBlocks.length === 0 && mindMapBlocks.length > 0) {
    const confidence = assessResponseReliability(response, sources);
    const stripMindMap = () => String(response || '').replace(/\[MINDMAP_TITLE:\s*[^\]]+?\s*\]\s*\[MINDMAP_CODE\][\s\S]*?\[\/MINDMAP_CODE\]/gi, ' ').trim();
    if (confidence === 'LOW') {
      logs.push('🛑 Mapa mental removido: confiabilidade textual insuficiente para sustentar a visualizacao.');
      return {
        response: appendVisualSafetyNotice(stripMindMap(), 'o mapa mental foi ocultado porque a confiabilidade textual ficou baixa para sustentar essa sintese visual.'),
        confidence,
      };
    }

    const structuredMindMap = await buildStructuredMindMapSpec(response, sources, userQuestion, logs);
    const mindMapValidation = validateStructuredMindMapSpec(structuredMindMap);
    if (mindMapValidation.issues.length === 0) {
      const semanticAudit = await auditMindMapSemantics(mindMapValidation.spec, response, sources, userQuestion, logs);
      if (!semanticAudit.approved) {
        logs.push(`🛑 Mapa mental removido: auditoria semantica reprovou a estrutura (${semanticAudit.issues.join(' | ')}).`);
        return {
          response: appendVisualSafetyNotice(stripMindMap(), 'o mapa mental foi removido porque alguns ramos nao puderam ser confirmados com seguranca a partir da resposta e das fontes.'),
          confidence,
        };
      }
      logs.push('🧠 Mapa mental reconstruido a partir de estrutura validada do Drekee.');
      return {
        response: replaceFirstMindMapBlock(response, buildMindMapBlockFromSpec(mindMapValidation.spec)),
        confidence,
      };
    }
    logs.push(`🛑 Mapa mental removido: a estrutura validada nao fechou (${mindMapValidation.issues.join(' | ')}).`);
    return {
      response: appendVisualSafetyNotice(stripMindMap(), 'o mapa mental nao foi exibido porque a estrutura extraida nao passou na validacao de clareza e fidelidade.'),
      confidence,
    };
  }
  if (graphBlocks.length === 0) {
    return { response, confidence: assessResponseReliability(response, sources) };
  }

  const confidence = assessResponseReliability(response, sources);
  if (confidence === 'LOW') {
    logs.push('🛑 Grafico removido: confiabilidade textual insuficiente para sustentar visualizacao numerica.');
    return {
      response: appendVisualSafetyNotice(stripLatexGraphBlocks(response), 'o grafico foi ocultado porque a confiabilidade textual ficou baixa para sustentar uma visualizacao numerica segura.'),
      confidence,
    };
  }

  const structuredGraph = await buildStructuredGraphSpec(response, sources, userQuestion, logs);
  const graphValidation = validateStructuredGraphSpec(structuredGraph, { userQuestion, response });
  if (graphValidation.issues.length === 0) {
    logs.push('✅ Grafico reconstruido a partir de tabela estruturada validada do Drekee.');
    return {
      response: replaceFirstLatexGraphBlock(response, buildGraphBlockFromSpec(graphValidation.spec)),
      confidence,
    };
  }
  logs.push(`🛑 Grafico removido: a tabela estruturada nao passou na validacao (${graphValidation.issues.join(' | ')}).`);
  return {
    response: appendVisualSafetyNotice(stripLatexGraphBlocks(response), 'o grafico nao foi exibido porque os dados extraidos nao passaram na validacao numerica e temporal.'),
    confidence,
  };
}

// ============ CONVERT LOGS TO COHERENT THINKING PARAGRAPH ============
function convertLogsToThinking(logs) {
  if (!logs || logs.length === 0) {
    return 'Analise cientifica em andamento.';
  }

  const normalized = logs
    .map(log => String(log || '').trim())
    .filter(Boolean)
    .map(log => log.replace(/^[^\p{L}\p{N}]+/u, '').trim())
    .filter(log => !/^Conectores habilitados para esta pergunta:/i.test(log));

  const uniqueThinking = [...new Set(normalized)].slice(0, 4);
  if (uniqueThinking.length === 0) {
    return 'Processando sua pergunta cientifica.';
  }

  return uniqueThinking.join(' -> ');
}

// ============ EXTRACT CONFIDENCE ============
function extractConfidenceLevel(response) {
  const match = response.match(/\[CONFIANÇA:\s*(ALTO|MÉDIO|BAIXO)\]/i);
  if (match) return match[1].toUpperCase();
  return 'MÉDIO';
}

function openAgentEventStream(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
}

function writeAgentEvent(res, event, payload) {
  if (!res || res.writableEnded) return;
  const serialized = JSON.stringify(payload ?? {});
  res.write(`event: ${event}\n`);
  serialized.split('\n').forEach(line => {
    res.write(`data: ${line}\n`);
  });
  res.write('\n');
}

function createStreamingLogs(onLog) {
  const logs = [];
  logs.push = (...entries) => {
    entries.forEach(entry => {
      Array.prototype.push.call(logs, entry);
      if (typeof onLog === 'function') {
        onLog(entry, logs.length);
      }
    });
    return logs.length;
  };
  return logs;
}

function serializeConversationForSummary(history = []) {
  return history
    .map((item, index) => {
      const role = item?.role === 'assistant' ? 'IA' : 'Usuário';
      const content = String(item?.content || '').trim();
      if (!content) return null;
      return `${index + 1}. ${role}:\n${content}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

async function generateOfflineSummaryDocument(history = [], requestedTitle = '', logs = []) {
  const serializedHistory = serializeConversationForSummary(history);
  if (!serializedHistory) {
    throw new Error('Histórico insuficiente para gerar resumo offline.');
  }

  logs.push('🗂️ Consolidando a memória completa da conversa...');
  logs.push('📝 Gerando documento offline com base em todo o chat...');

  const prompt = `Você é o Drekee AI 1.5 Pro gerando um documento offline premium a partir do histórico completo de uma conversa.

OBJETIVO:
- Resumir TODA a conversa, não apenas a última resposta.
- Consolidar as perguntas do usuário, as respostas dadas e as conclusões mais úteis.
- Produzir um documento limpo, objetivo, profundamente informativo, profissional e pronto para leitura offline.

REGRAS OBRIGATÓRIAS:
1. Use TODO o histórico abaixo como memória da conversa.
2. NÃO copie a última resposta como se ela fosse o resumo inteiro.
3. Faça um resumo executivo curto e direto no início.
4. Depois organize o conteúdo em seções claras, densas e úteis.
5. NÃO use as tags [CONFIANÇA], [ID-DA-FONTE], [PHET], [PDB], [OFFLINE_DOC] ou blocos [LATEX_GRAPH_TITLE]/[LATEX_GRAPH_CODE].
6. Se houver fontes citadas ao longo da conversa, transforme isso em texto limpo na seção final "Fontes e referências mencionadas".
7. Não fale sobre o processo de geração. Entregue apenas o documento.
8. O documento precisa funcionar bem como PDF.
9. Evite texto genérico. Cada seção deve trazer informação concreta, específica e realmente útil.
10. Explique os conceitos principais de forma profissional, mas entendível por leigos e estudantes.
11. Use subtítulos, negrito, bullets e parágrafos curtos quando isso melhorar a leitura.
12. Se a conversa tratou de fatos científicos, inclua os pontos mais importantes, implicações, contexto e conclusões.
13. O documento final deve parecer um relatório/apostila curta, não um bloco corrido de texto.

FORMATO DE SAÍDA OBRIGATÓRIO:
[TITLE]
um título curto e profissional
[/TITLE]
[MARKDOWN]
# Título

### Sumário Executivo
...

### Visão Geral da Conversa
...

### Conceitos e Explicações Principais
...

### Pontos-Chave e Conclusões
...

### Fontes e referências mencionadas
...
[/MARKDOWN]

TÍTULO SUGERIDO PELO APP: ${requestedTitle || 'Resumo Offline da Conversa'}

HISTÓRICO COMPLETO:
${serializedHistory}`;

  const raw = await callGemini(prompt, logs);
  const titleMatch = raw.match(/\[TITLE\]\s*([\s\S]*?)\s*\[\/TITLE\]/i);
  const markdownMatch = raw.match(/\[MARKDOWN\]\s*([\s\S]*?)\s*\[\/MARKDOWN\]/i);

  const title = sanitizeFinalResponse(titleMatch?.[1] || requestedTitle || 'Resumo Offline da Conversa')
    .replace(/^#+\s*/gm, '')
    .trim();
  const markdown = sanitizeFinalResponse(markdownMatch?.[1] || raw).trim();

  logs.push('✅ Documento offline consolidado');
  return {
    title: title || 'Resumo Offline da Conversa',
    markdown,
  };
}

const CONNECTOR_REQUIRES_KEYS = {
  tavily: ['TAVILY_API_KEY'],
  wolfram: ['WOLFRAM_APP_ID'],
  'serpapi-news': ['SERPAPI_API_KEY_2'],
  'serpapi-lens': ['SERPAPI_API_KEY'],
};

const AUTO_DETECTED_CONNECTORS = new Set([
  'antweb', 'fishwatch', 'periodictable', 'gutenberg', 'bible', 'iss', 'celestrak',
  'spacedevs', 'solarsystem', 'sunrise', 'quotes', 'quotes-free', 'dogapi', 'openaq',
  'codata', 'open-meteo', 'openfoodfacts', 'picsum', 'openuniverse', 'esa', 'stellarium',
  'ligo', 'sdo', 'horizons', 'exoplanets', 'kepler', 'mathjs', 'wolfram', 'pubchem',
  'pubchem-bio', 'ensembl', 'mygene', 'uniprot', 'string-db', 'reactome', 'openfda',
  'datasus', 'covid-jhu', 'clinvar', 'cosmic', 'noaa-climate', 'worldbank-climate',
  'usgs-water', 'firms', 'edx', 'mit-ocw', 'mec-ejovem', 'educ4share', 'tcu', 'transparencia',
  'metmuseum', 'getty', 'libras', 'sketchfab', 'timelapse', 'arxiv', 'scielo', 'ibge',
  'pubmed', 'wikipedia', 'wikidata', 'rcsb', 'newton', 'nasa', 'spacex', 'serpapi-news', 'serpapi-lens'
]);

const CONNECTOR_PROBE_QUERIES = {
  tavily: 'fotossintese',
  wikipedia: 'fotossíntese',
  arxiv: 'quantum computing',
  scielo: 'dengue',
  newton: 'derivada de x^2',
  ibge: 'população',
  nasa: 'mars',
  openlibrary: 'inteligencia artificial',
  gbif: 'Panthera onca',
  camara: 'educação',
  'dictionary-en': 'science',
  universities: 'harvard',
  poetry: 'Shakespeare',
  phet: 'lei de ohm',
  pubmed: 'crispr',
  wikidata: 'Albert Einstein',
  rcsb: 'hemoglobin',
  antweb: 'Atta',
  periodictable: 'oxygen',
  fishwatch: 'salmon',
  gutenberg: 'sherlock holmes',
  bible: 'John 3:16',
  openaq: 'Sao Paulo',
  solarsystem: 'mars',
  celestrak: 'iss',
  codata: 'Planck constant',
  openfoodfacts: 'chocolate',
  esa: 'mars',
  stellarium: 'Mars',
  exoplanets: 'Kepler',
  mathjs: '2*(5+3)',
  wolfram: 'integrate x^2',
  pubchem: 'caffeine',
  ensembl: 'BRCA1',
  mygene: 'TP53',
  uniprot: 'hemoglobin',
  reactome: 'glycolysis',
  'string-db': 'TP53',
  openfda: 'aspirin',
  'worldbank-climate': 'BR',
  timelapse: 'amazon rainforest',
  openuniverse: 'mars',
  horizons: 'Mars',
  kepler: 'Kepler-22 b',
  numberempire: 'sin(x)',
  'pubchem-bio': 'ibuprofen',
  clinvar: 'BRCA1',
  cosmic: 'TP53',
  sentinel: 'amazon rainforest',
  firms: 'wildfires',
  edx: 'physics',
  'mit-ocw': 'physics',
  'mec-ejovem': 'ciência',
  educ4share: 'energia solar',
  modis: 'Amazon',
  tcu: 'educação',
  transparencia: 'educação',
  datasus: 'dengue',
  seade: 'educação',
  getty: 'astronomy',
  libras: 'ciência',
};

function getConnectorProbeQuery(key) {
  return CONNECTOR_PROBE_QUERIES[key] || 'science';
}

CONNECTOR_PROBE_QUERIES['serpapi-news'] = 'nasa 3 dias de escuridao';
CONNECTOR_PROBE_QUERIES['serpapi-lens'] = 'https://upload.wikimedia.org/wikipedia/commons/8/87/Example_of_fake_news.jpg';

function summarizeProbeData(value) {
  if (value == null) return 'Sem dados';
  if (typeof value === 'string') return value.slice(0, 120);
  if (Array.isArray(value)) return `${value.length} item(ns) retornados`;
  if (typeof value === 'object') {
    if (value.error) return String(value.error);
    if (value.title) return String(value.title);
    if (value.name) return String(value.name);
    if (value.targetName) return `Alvo ${value.targetName}`;
    const keys = Object.keys(value);
    return keys.length > 0 ? `Campos: ${keys.slice(0, 5).join(', ')}` : 'Objeto sem campos';
  }
  return String(value);
}

function isProbeSuccessful(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    if (value.error) return false;
    if (value.success === false) return false;
    if (Object.prototype.hasOwnProperty.call(value, 'result') && !value.result && !value.url) {
      return Array.isArray(value.pods) ? value.pods.length > 0 : false;
    }
    return Object.keys(value).length > 0;
  }
  return Boolean(value);
}

function getInventoryFileCount() {
  try {
    const inventoryPath = path.join(process.cwd(), 'conectores_drekee.txt');
    const text = fs.readFileSync(inventoryPath, 'utf8');
    return [...text.matchAll(/^\s*(\d+)\.\s+/gm)].length;
  } catch (error) {
    return null;
  }
}

async function probeConnector(key, options = {}) {
  const query = options.query || getConnectorProbeQuery(key);
  const userContext = options.userContext || { lat: -23.55, lon: -46.63, timezone: 'America/Sao_Paulo' };
  try {
    let data = null;
    switch (key) {
      case 'tavily': data = await searchTavily(query); break;
      case 'serpapi-news': data = await searchSerpApiGoogleNews(query); break;
      case 'serpapi-lens': data = await searchSerpApiGoogleLens(query); break;
      case 'wikipedia': data = await buscarWikipedia(query); break;
      case 'arxiv': data = await buscarArxiv(query); break;
      case 'scielo': data = await buscarSciELORobusto(query); break;
      case 'newton': data = await calcular(query); break;
      case 'spacex': data = await buscarSpaceX(); break;
      case 'ibge': data = await buscarIBGE(query); break;
      case 'open-meteo': data = await buscarOpenMeteo(userContext.lat, userContext.lon); break;
      case 'nasa': data = await searchNasaMedia(query); break;
      case 'openlibrary': data = await buscarOpenLibrary(query); break;
      case 'gbif': data = await buscarGBIF(query); break;
      case 'usgs': data = await buscarUSGS(); break;
      case 'brasilapi': data = await buscarBrasilAPI(query); break;
      case 'camara': data = await buscarCamaraRobusto(query); break;
      case 'iss': data = await buscarISS(); break;
      case 'sunrise': data = await buscarSunriseSunset(userContext.lat, userContext.lon); break;
      case 'dictionary-en': data = await buscarDicionarioIngles(query); break;
      case 'universities': data = await buscarUniversidades(query); break;
      case 'poetry': data = await buscarPoesiaRobusta(query); break;
      case 'phet': data = detectPhetSimulation('Explique a Lei de Ohm com simulacao', '', ['phet']); break;
      case 'pubmed': data = await buscarPubMed(query); break;
      case 'wikidata': data = await buscarWikidata(query); break;
      case 'rcsb': data = await buscarRCSBRobusto(query); break;
      case 'antweb': data = await buscarAntWebRobusto(query); break;
      case 'periodictable': data = await buscarTabelaPeriodicaRobusta(query); break;
      case 'fishwatch': data = await buscarFishWatchRobusto(query); break;
      case 'gutenberg': data = await buscarGutenberg(query); break;
      case 'bible': data = await buscarBiblia(query); break;
      case 'openaq': data = await buscarQualidadeArRobusta(query); break;
      case 'solarsystem': data = await buscarSistemaSolarRobusto(query); break;
      case 'quotes': data = await buscarFrase(); break;
      case 'dogapi': data = await buscarDog(); break;
      case 'celestrak': data = await buscarGeneric('celestrak', query); break;
      case 'codata': data = await buscarCODATA(query); break;
      case 'quotes-free': data = await buscarGeneric('quotes-free', query); break;
      case 'openfoodfacts': data = await buscarOpenFoodFactsRobusto(query); break;
      case 'picsum': data = await buscarGeneric('picsum', query); break;
      case 'esa': data = await buscarESARobusto(query); break;
      case 'stellarium': data = await buscarGeneric('stellarium', query); break;
      case 'ligo': data = await buscarLigoRobusto(query); break;
      case 'noaa-space': data = await buscarGeneric('noaa-space', query); break;
      case 'exoplanets': data = await buscarExoplanetas(query); break;
      case 'mathjs': data = await buscarGeneric('mathjs', query); break;
      case 'wolfram': data = await buscarWolframAlpha(query); break;
      case 'pubchem': data = await buscarGeneric('pubchem', query); break;
      case 'ensembl': data = await buscarGeneric('ensembl', query); break;
      case 'mygene': data = await buscarGeneric('mygene', query); break;
      case 'uniprot': data = await buscarGeneric('uniprot', query); break;
      case 'reactome': data = await buscarGeneric('reactome', query); break;
      case 'string-db': data = await buscarGeneric('string-db', query); break;
      case 'openfda': data = await buscarGeneric('openfda', query); break;
      case 'covid-jhu': data = await buscarGeneric('covid-jhu', query); break;
      case 'noaa-climate': data = await buscarNoaaClimateRobusto(query); break;
      case 'worldbank-climate': data = await buscarGeneric('worldbank-climate', query); break;
      case 'usgs-water': data = await buscarGeneric('usgs-water', query); break;
      case 'metmuseum': data = await buscarGeneric('metmuseum', query); break;
      case 'sketchfab': data = await buscarGeneric('sketchfab', query); break;
      case 'osf': data = await buscarGeneric('osf', query); break;
      case 'timelapse': data = await buscarTimelapse(query); break;
      case 'spacedevs': data = await buscarLancamentos(); break;
      case 'openuniverse': data = await buscarOpenUniverse(query); break;
      case 'horizons': data = await buscarNasaHorizons(query, userContext); break;
      case 'sdo': data = await buscarSDO(); break;
      case 'kepler': data = await buscarKeplerTess(query); break;
      case 'numberempire': data = await buscarNumberEmpireRobusto(query); break;
      case 'pubchem-bio': data = await buscarPubChemBio(query); break;
      case 'clinvar': data = await buscarClinVar(query); break;
      case 'cosmic': data = await buscarCosmic(query); break;
      case 'sentinel': data = await buscarSentinel(query); break;
      case 'firms': data = await buscarFirms(query); break;
      case 'edx': data = await buscarCoursePage('https://www.edx.org/search?q=', query); break;
      case 'mit-ocw': data = await buscarCoursePage('https://ocw.mit.edu/search/?q=', query); break;
      case 'mec-ejovem': data = await buscarMecEJovem(query); break;
      case 'educ4share': data = await buscarEduc4Share(query); break;
      case 'modis': data = await buscarModis(query); break;
      case 'tcu': data = await buscarTCU(query); break;
      case 'transparencia': data = await buscarTransparencia(query); break;
      case 'datasus': data = await buscarDataSUS(query); break;
      case 'seade': data = await buscarSEADE(query); break;
      case 'getty': data = await buscarGetty(query); break;
      case 'libras': data = await buscarLibras(query); break;
      default:
        return { key, ok: false, status: 'present_only', message: 'Conector listado, mas sem rotina de teste dedicada no admin.', autoDetected: AUTO_DETECTED_CONNECTORS.has(key), requiresKeys: CONNECTOR_REQUIRES_KEYS[key] || [] };
    }

    if (data?.error === 'missing_api_key') {
      return { key, ok: false, status: 'missing_key', message: `Chave ausente: ${data.key}`, summary: summarizeProbeData(data), autoDetected: AUTO_DETECTED_CONNECTORS.has(key), requiresKeys: CONNECTOR_REQUIRES_KEYS[key] || [] };
    }

    const ok = isProbeSuccessful(data);
    return {
      key,
      ok,
      status: ok ? 'active' : 'error',
      message: ok ? 'Conector respondeu com dados' : 'Conector não retornou dados utilizáveis',
      summary: summarizeProbeData(data),
      autoDetected: AUTO_DETECTED_CONNECTORS.has(key),
      requiresKeys: CONNECTOR_REQUIRES_KEYS[key] || [],
    };
  } catch (error) {
    return { key, ok: false, status: 'error', message: error.message || 'Falha no teste do conector', autoDetected: AUTO_DETECTED_CONNECTORS.has(key), requiresKeys: CONNECTOR_REQUIRES_KEYS[key] || [] };
  }
}

async function testGroqKey(envName) {
  const key = process.env[envName];
  if (!key) return { env: envName, status: 'missing', ok: false, message: 'Chave não cadastrada' };
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, temperature: 0 }),
      signal: AbortSignal.timeout(12000),
    });
    const json = await res.json();
    if (!res.ok) return { env: envName, status: 'configured_error', ok: false, message: `Erro ${res.status}: ${JSON.stringify(json).slice(0, 180)}` };
    return { env: envName, status: 'active', ok: true, message: 'Chave válida e respondendo' };
  } catch (error) {
    return { env: envName, status: 'configured_error', ok: false, message: error.message };
  }
}

async function testOpenRouterKey(envName) {
  const key = process.env[envName];
  if (!key) return { env: envName, status: 'missing', ok: false, message: 'Chave não cadastrada' };
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'qwen/qwen3.6-plus:free', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(12000),
    });
    const json = await res.json();
    if (!res.ok) return { env: envName, status: 'configured_error', ok: false, message: `Erro ${res.status}: ${JSON.stringify(json).slice(0, 180)}` };
    return { env: envName, status: 'active', ok: true, message: 'Chave válida e respondendo' };
  } catch (error) {
    return { env: envName, status: 'configured_error', ok: false, message: error.message };
  }
}

async function testTavilyKey() {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return { env: 'TAVILY_API_KEY', status: 'missing', ok: false, message: 'Chave não cadastrada' };
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query: 'fotossintese', max_results: 1, include_answer: false }),
      signal: AbortSignal.timeout(12000),
    });
    const json = await res.json();
    if (!res.ok) return { env: 'TAVILY_API_KEY', status: 'configured_error', ok: false, message: `Erro ${res.status}: ${JSON.stringify(json).slice(0, 180)}` };
    return { env: 'TAVILY_API_KEY', status: 'active', ok: true, message: 'Chave válida e respondendo' };
  } catch (error) {
    return { env: 'TAVILY_API_KEY', status: 'configured_error', ok: false, message: error.message };
  }
}

async function testOptionalKey(envName, tester) {
  if (!process.env[envName]) return { env: envName, status: 'missing', ok: false, message: 'Chave não cadastrada' };
  try {
    const data = await tester();
    if (data && !data.error) return { env: envName, status: 'active', ok: true, message: 'Chave válida e respondendo' };
    return { env: envName, status: 'configured_error', ok: false, message: summarizeProbeData(data) };
  } catch (error) {
    return { env: envName, status: 'configured_error', ok: false, message: error.message };
  }
}

async function getAdminDiagnostics() {
  const supportedConnectors = [...SUPPORTED_CONNECTORS];
  return {
    generatedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      uptimeSeconds: Math.round(process.uptime()),
      cwd: process.cwd(),
    },
    catalog: {
      supportedConnectorCount: supportedConnectors.length,
      inventoryFileCount: getInventoryFileCount(),
      autoDetectedConnectorCount: AUTO_DETECTED_CONNECTORS.size,
    },
    keys: await Promise.all([
      testGroqKey('GROQ_API_KEY_1'),
      testGroqKey('GROQ_API_KEY_2'),
      testGroqKey('GROQ_AGENT_API_KEY'),
      testOpenRouterKey('OPENROUTER_API_KEY'),
      testOpenRouterKey('OPENROUTER_API_KEY_2'),
      testTavilyKey(),
      testOptionalKey('SERPAPI_API_KEY', () => searchSerpApiGoogleLens('https://upload.wikimedia.org/wikipedia/commons/8/87/Example_of_fake_news.jpg')),
      testOptionalKey('SERPAPI_API_KEY_2', () => searchSerpApiGoogleNews('nasa')),
      testOptionalKey('WOLFRAM_APP_ID', () => buscarWolframAlpha('2+2')),
    ]),
    connectors: supportedConnectors.map(key => ({
      key,
      autoDetected: AUTO_DETECTED_CONNECTORS.has(key),
      requiresKeys: CONNECTOR_REQUIRES_KEYS[key] || [],
      status: 'untested',
    })),
  };
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
  const connectorAuto = body?.connectorAuto !== false;
  const connectors = Array.isArray(body?.connectors) ? body.connectors : [];
  const history = Array.isArray(body?.history) ? body.history : [];
  const wantsStream = body?.stream === true;
  const wantsOfflineSummary = body?.offlineSummary === true;

  // Resolve user context: prefer browser-sent coords, fall back to IP geolocation
  let userContext = body?.userContext || {};
  if (!userContext.lat) {
    try {
      const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
      const ipGeo = await fetch(`https://ipapi.co/${clientIP ? clientIP + '/' : ''}json/`);
      if (ipGeo.ok) {
        const geo = await ipGeo.json();
        if (!geo.error && geo.latitude) {
          userContext.lat = geo.latitude;
          userContext.lon = geo.longitude;
          userContext.city = geo.city;
          userContext.region = geo.region;
          userContext.country_name = geo.country_name;
          userContext.timezone = geo.timezone;
          userContext._source = 'ip';
        }
      }
    } catch { /* IP geolocation optional */ }
  }
  // Always inject current date/time in São Paulo timezone if not sent by client
  if (!userContext.localDate) {
    const now = new Date();
    userContext.localDate = now.toLocaleDateString('pt-BR', { timeZone: userContext.timezone || 'America/Sao_Paulo' });
    userContext.localTime = now.toLocaleTimeString('pt-BR', { timeZone: userContext.timezone || 'America/Sao_Paulo' });
  }

  if (!userQuestion && !wantsOfflineSummary) {
    return res.status(400).json({ error: 'Pergunta vazia' });
  }

  if (wantsStream) {
    openAgentEventStream(res);
    writeAgentEvent(res, 'status', {
      message: 'Agente científico inicializado. Preparando o plano de execução.',
    });
  }

  const logs = createStreamingLogs((entry, index) => {
    if (wantsStream) {
      writeAgentEvent(res, 'log', { message: entry, index });
    }
  });

  try {
    if (wantsOfflineSummary) {
      logs.push('📚 Iniciando geração do resumo offline...');
      const offlineDocument = await generateOfflineSummaryDocument(history, body?.summaryTitle || '', logs);
      const payload = {
        offlineDocument,
        logs,
      };
      if (wantsStream) {
        writeAgentEvent(res, 'final', payload);
        writeAgentEvent(res, 'done', { ok: true });
        return res.end();
      }
      return res.status(200).json(payload);
    }

    logs.push('🚀 Iniciando Agente Científico...');

  const files = Array.isArray(body?.files) ? body.files : [];
  const factCheckImageUrl = extractFactCheckImageUrl(files);
  let visionContext = '';
    if (files.length > 0) {
      logs.push('👁️ Analisando arquivos anexados com visão computacional...');
      const imgDesc = await analyzeUserFilesWithSambaNova(files, userQuestion, logs);
      if (imgDesc) {
        visionContext = `[IMAGEM ENVIADA PELO ALUNO]: ${imgDesc}\n`;
        logs.push('✅ Análise visual concluída');
      } else {
        // Fallback para Gemini se SambaNova falhar
        logs.push('⚠️ SambaNova Vision falhou, tentando Gemini fallback...');
        const geminiImgDesc = await analyzeUserFilesWithGemini(files, userQuestion, logs);
        if (geminiImgDesc) {
          visionContext = `[IMAGEM ENVIADA PELO ALUNO]: ${geminiImgDesc}\n`;
          logs.push('✅ Análise visual concluída com Gemini fallback');
        } else {
          logs.push('⚠️ Não foi possível analisar as imagens');
        }
      }
    }

    const actionPlan = await generateActionPlan(userQuestion, history, visionContext);
    const locationStr = userContext.city 
      ? `${userContext.city}, ${userContext.region || ''}, ${userContext.country_name || ''} (${userContext._source === 'ip' ? 'via IP, aproximado' : 'GPS'})`
      : userContext.lat 
        ? `Lat ${userContext.lat.toFixed(3)}, Lon ${userContext.lon.toFixed(3)}`
        : 'Desconhecida';

    const contextHeader = `\n⚡ CONTEXTO DO USUÁRIO (USE ESTES DADOS COMO VERDADE ABSOLUTA — não especule):\n- Data e Hora local: ${userContext.localDate || 'hoje'} às ${userContext.localTime || 'agora'}\n- Localização: ${locationStr}\n- Fuso horário: ${userContext.timezone || 'America/Sao_Paulo'}\n\nINSTRUÇÃO: Quando o contexto contiver dados de APIs em tempo real (USGS, Sunrise-Sunset, ISS etc.), cite-os com precisão numérica. NUNCA invente, estime ou use dados de outras fontes para substituí-los. Se o usuário perguntar "hoje" ou "agora", use os dados desta requisição.\n\n`;
    visionContext = contextHeader + visionContext;

    const exec = await executeAgentPlan(userQuestion, actionPlan, logs, { connectorAuto, connectors, useNasa: body?.nasa, history, visionContext, userContext, factCheckImageUrl });
    exec.response = normalizeMarkdownLatexFences(exec.response);
    exec.response = normalizeResponseCitations(exec.response, exec.sources || []);

    // 1-b: Streaming parcial — enviar rascunho ao usuário enquanto audit/review rodam
    if (wantsStream) {
      writeAgentEvent(res, 'status', {
        message: 'Resposta preliminar gerada. Validando qualidade...',
      });
      writeAgentEvent(res, 'draft', {
        response: exec.response,
        sources: exec.sources || [],
        media: exec.media || [],
      });
    }

    // 1-a: Paralelizar audit + review (caminho otimista)
    // Roda ambos em paralelo: se audit aprovar, a review otimista já está pronta
    logs.push('🧪 OpenRouter avaliando a resposta + revisão em paralelo...');
    const [audit, optimisticReview] = await Promise.all([
      auditResponseWithOpenRouter({
        userQuestion,
        response: exec.response,
        sources: exec.sources || [],
        logs,
      }),
      reviewResponse(exec.response, {
        userQuestion,
        sources: exec.sources || [],
      }),
    ]);

    let finalExec = exec;
    let recoveryAttempted = false;
    logs.push(audit.approved ? '✅ OpenRouter aprovou a resposta candidata.' : `⚠️ OpenRouter reprovou a resposta candidata: ${(audit.issues || []).join(', ') || 'cobertura insuficiente'}`);

    if (!audit.approved && audit.retry_worthy) {
      // 1-d: Pular recovery se a resposta já tem fontes suficientes e o gap é pequeno
      const sourceCount = (exec.sources || []).length;
      const responseLength = (exec.response || '').length;
      const issueCount = (audit.issues || []).length;
      const isMinorGap = issueCount <= 1 && sourceCount >= 3 && responseLength > 1500;

      if (isMinorGap) {
        logs.push('⚡ 1-d: Gap menor detectado — pulando recovery (resposta já tem fontes suficientes).');
      } else {
        logs.push('🤖 GROQ Agent acionado para organizar uma recuperação autônoma.');
        const recoveryPlan = await buildRecoveryPlanWithGroqAgent({
          userQuestion,
          actionPlan,
          initialResponse: exec.response,
          audit,
          selectedConnectors: exec.selectedConnectors || [],
          sources: exec.sources || [],
          history,
          logs,
        });

        if (recoveryPlan?.should_retry) {
          recoveryAttempted = true;
          logs.push(`🧠 Plano de recuperação: ${recoveryPlan.goal || 'preencher lacunas factuais'}`);
          if (recoveryPlan.reasoning) {
            logs.push(`🧠 Motivo do retry: ${recoveryPlan.reasoning}`);
          }
          if (recoveryPlan.use_existing_evidence && !recoveryPlan.needs_new_research) {
            logs.push('🧠 GROQ Agent decidiu reaproveitar as fontes já coletadas antes de abrir nova pesquisa.');
          } else {
            logs.push('🌐 GROQ Agent decidiu abrir nova rodada de pesquisa para fechar lacunas.');
            const recoveryActionPlan = {
              ...(actionPlan || {}),
              termo_de_busca: recoveryPlan.search_query || actionPlan?.termo_de_busca || userQuestion,
            };
            const recoveryVisionContext = `${visionContext}\n[CONTEXTO CONFIRMADO DA PRIMEIRA RODADA]\n${stripLatexGraphBlocks(exec.response).slice(0, 2200)}\n`;
            const retryExec = await executeAgentPlan(userQuestion, recoveryActionPlan, logs, {
              connectorAuto: true,
              connectors: exec.selectedConnectors || [],
              useNasa: body?.nasa,
              history,
              visionContext: recoveryVisionContext,
              userContext,
              recoveryMode: true,
              baseConnectors: exec.selectedConnectors || [],
              overrideQuery: recoveryPlan.search_query,
              overrideRequiredConnectors: recoveryPlan.connectors_required || [],
              overrideOptionalConnectors: recoveryPlan.connectors_optional || [],
              overrideForbiddenConnectors: recoveryPlan.connectors_forbidden || [],
              focusFacts: recoveryPlan.focus_facts || [],
            });
            retryExec.response = normalizeMarkdownLatexFences(retryExec.response);
            retryExec.response = normalizeResponseCitations(retryExec.response, retryExec.sources || []);
            finalExec = mergeExecutionResults(exec, retryExec);
            finalExec.response = retryExec.response || exec.response;
          }

          logs.push('🧠 GROQ Agent organizando a síntese final com a memória das fontes e lacunas detectadas.');
          finalExec.response = await synthesizeResponseWithAgent({
            userQuestion,
            workingResponse: finalExec.response || exec.response,
            sources: finalExec.sources || exec.sources || [],
            audit,
            recoveryPlan,
            history,
            logs,
          });
          finalExec.response = normalizeMarkdownLatexFences(finalExec.response);
          finalExec.response = normalizeResponseCitations(finalExec.response, finalExec.sources || []);
        } else {
          logs.push('⚠️ GROQ Agent concluiu que uma nova rodada não aumentaria a confiabilidade.');
        }
      }
    }

    if (!audit.approved) {
      logs.push('📝 A resposta final vai manter honestidade factual e evitar invenção de dados ausentes.');
    }

    // 1-a: Usar review otimista se audit aprovou e não houve recovery
    // Se houve recovery, precisa re-review com o conteúdo atualizado
    let response;
    if (audit.approved && !recoveryAttempted) {
      logs.push('⚡ 1-a: Usando revisão otimista (paralela) — economia de ~3-5s.');
      response = normalizeMarkdownLatexFences(optimisticReview);
    } else {
      logs.push('👁️ Refinando a redação final com a IA principal...');
      const responseDraft = !audit.approved && recoveryAttempted
        ? `${buildPostRecoveryIntegrityNote(audit)}\n\n${finalExec.response}`
        : finalExec.response;
      response = await reviewResponse(responseDraft, {
        userQuestion,
        sources: finalExec.sources || [],
      });
      response = normalizeMarkdownLatexFences(response);
    }
    logs.push('✅ Resposta revisada e validada');

    response = ensureInteractiveTags(response, userQuestion, finalExec.selectedConnectors || []);
    response = normalizeResponseCitations(response, finalExec.sources || []);
    response = removeUnsupportedAnalyticalParagraphs(response);
    response = softenUnsupportedSuperlatives(response, finalExec.sources || []);
    response = sanitizeFinalResponse(response);
    
    // Substituir tags [NASA_IMG: ID] por imagens reais com tamanho reduzido
    if (finalExec.media && finalExec.media.length > 0) {
      finalExec.media.forEach(m => {
        const sourceId = finalExec.sources.find(s => s.url === m.url)?.id;
        if (sourceId) {
          const imgTag = `[NASA_IMG: ${sourceId}]`;
          const htmlImg = `<div style="margin: 10px 0; max-width: 300px;"><img src="${m.url}" alt="${m.title}" style="width: 100%; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);"><p style="font-size: 0.8em; color: #666; margin-top: 4px;">${m.title}</p></div>`;
          response = response.split(imgTag).join(htmlImg);
        }
      });
    }
    // Limpar tags remanescentes que não foram substituídas
    response = response.replace(/\[NASA_IMG: [^\]]+\]/g, '');

    const alignment = await alignGraphWithResponseReliability(response, finalExec.sources || [], userQuestion, logs);
    response = sanitizeFinalResponse(alignment.response);
    const displayResponse = response;
    logs.push(`🧪 Confiabilidade final da resposta: ${alignment.confidence}`);

    // Convert logs to thinking paragraph
    const thinking = convertLogsToThinking(logs);

    const payload = {
      response: displayResponse || 'Desculpe, não consegui gerar uma resposta confiável.',
      thinking,
      confidence: alignment.confidence,
      logs,
      media: finalExec.media || [],
      sources: finalExec.sources || [],
      factCheck: finalExec.factCheck || null,
    };
    if (wantsStream) {
      writeAgentEvent(res, 'final', payload);
      writeAgentEvent(res, 'done', { ok: true });
      return res.end();
    }
    return res.status(200).json(payload);
  } catch (err) {
    console.error('Agent error:', err);
    logs.push(`❌ Erro: ${err.message}`);

    const thinking = convertLogsToThinking(logs);

    const payload = {
      response: 'Desculpe, não consegui processar sua solicitação agora. Tente novamente em alguns instantes.',
      thinking,
      confidence: 'LOW',
      error: err.message,
      logs,
      media: [],
      sources: [],
      factCheck: null,
    };
    if (wantsStream) {
      writeAgentEvent(res, 'error', { message: err.message });
      writeAgentEvent(res, 'final', payload);
      writeAgentEvent(res, 'done', { ok: false });
      return res.end();
    }
    return res.status(200).json(payload);
  }
}

handler.getAdminDiagnostics = getAdminDiagnostics;
handler.probeConnector = probeConnector;
handler.supportedConnectors = [...SUPPORTED_CONNECTORS];
module.exports = handler;
