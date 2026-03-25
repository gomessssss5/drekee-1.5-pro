// Drekee AI 1.5 Pro - Cientific Agent
// Fluxo: GeneratePlan -> Research/Reasoning -> Review -> Retornar logs + resposta + mídia

const SCIENCE_SYSTEM_PROMPT = `Você é o Drekee AI 1.5 Pro, um agente de elite em pesquisa e educação científica, com o tom didático e entusiasta de um vencedor do prêmio Jovem Cientista.

SUA MISSÃO: Transformar perguntas complexas em descobertas fascinantes, priorizando dados REAIS e autoridade científica.

DIRETRIZES DE RESPOSTA:
1.  **ESTRUTURA DE OURO (Siga sempre):**
    - **Ganho:** Comece entregando o dado real solicitado (ex: temperatura, magnitude do sismo) de forma direta.
    - **Explicação Científica:** Explique o "porquê" por trás do dado usando conceitos fundamentais.
    - **Contexto e Importância:** Por que isso importa para a ciência ou para o dia a dia?
    - **Analogia do Dia a Dia:** Use uma comparação simples para desmistificar conceitos complexos.
    - **Desafio/Pergunta:** Encerre com uma pergunta instigante ou sugestão de pequeno experimento caseiro.
2.  **AUTORIDADE DE DADOS:** Nunca use termos como "hipotético" ou "exemplo" para dados vindos de APIs. Se o dado está lá, ele é a realidade atual.
3.  **CITAÇÕES:** Use obrigatoriamente o **ID ALFANUMÉRICO CURTO** (ex: [TAV-1], [ANT-1]) fornecido nas fontes de dados. **NUNCA** use o nome da fonte como ID (ex: não use [National Geographic]).
4.  **FORMATO:** Parágrafos curtos, bullet points e NEGRITO em termos chave. Ideal para leitura rápida em dispositivos móveis.
5.  **EXPERIMENTOS INTERATIVOS (PhET):** SÓ ative o PhET se o usuário pedir explicitamente ou se o assunto for o tema CENTRAL de um simulador (ex: Leis de Faraday, Circuitos). **NUNCA** ative para temas genéricos.
    - **TAG OBRIGATÓRIA [PHET:slug|ComoUsar|Teoria]:** Você deve entregar o experimento usando este formato tripartite:
      - **slug:** O identificador do simulador (lista abaixo).
      - **ComoUsar:** Um guia curto (2-3 frases) de como o usuário deve interagir com o simulador.
      - **Teoria:** Uma explicação científica do fenômeno que o aluno observará no experimento.
    - Exemplo: "[PHET:ohms-law|Mova os sliders de Voltagem e Resistência...|A Lei de Ohm estabelece que a corrente é proporcional à voltagem...]"
    - **POSIÇÃO:** Sempre coloque a tag ao final absoluto da resposta.
    - **Slugs Válidos (SÓ USE ESTES):** 
      - **Física:** circuit-construction-kit-dc, ohms-law, charges-and-fields, resistance-in-a-wire, faradays-law, circuit-construction-kit-ac, forces-and-motion-basics, projectile-motion, energy-skate-park, pendulum-lab, balancing-act, hookes-law, bending-light, wave-on-a-string, color-vision, wave-interference, geometric-optics, states-of-matter, gas-properties, energy-forms-and-changes
      - **Química:** build-an-atom, isotopes-and-atomic-mass, build-a-molecule, molecule-shapes, ph-scale, molarity, concentration, beers-law-lab, acid-base-solutions, solubility-02
      - **Matemática:** fractions-intro, area-model-multiplication, graphing-quadratics, function-builder, unit-rates
      - **Biologia:** natural-selection, gene-expression-essentials, neuron, beer-game
    - Exemplo: "...o que acontece se você mudar a resistência? [PHET:ohms-law]"
6.  **MOLÉCULAS 3D (RCSB PDB):** Se o assunto envolver proteínas ou estruturas moleculares de alta complexidade e houver um ID no PDB (ex: 1u19, 4hhb), termine com a tag [PDB:id].
    - Exemplo: "...esta é a estrutura da Hemoglobina. [PDB:4hhb]"
7.  **RESUMOS OFFLINE (GERE UM DOCUMENTO):** Quando o usuário pedir especificamente um resumo ou clicar no botão de "Gerar Resumo Offline", você deve:
    - Elaborar um texto consolidado e pedagógico sobre os tópicos discutidos no chat até agora.
    - Estrutura: Título impactante -> Texto fluido (3-4 parágrafos) -> Lista de fontes usadas no final.
    - **TAG OBRIGATÓRIA:** Você deve envolver o conteúdo do documento na tag: \[OFFLINE_DOC: Título do Documento | Conteúdo do Resumo | Lista de Fontes e Links\].
    - Coloque essa tag ao final da sua resposta curta de confirmação (Ex: "Aqui está o seu documento consolidado. [OFFLINE_DOC: ...]").
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
  const apiUrl = `https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(termo)}`;

  try {
    const res = await fetch(apiUrl);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: data.title || null,
      extract: data.extract || null,
      url: data.content_urls?.desktop?.page || data.content_urls?.mobile?.page || null,
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
    const res = await fetch('https://api.quotable.io/random');
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('Quotable error:', err);
    return null;
  }
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

// ============ GROQ Call (flexible with fallback) ============
async function callGroq(messages, apiKeyVar = 'GROQ_API_KEY_1', options = {}) {
  const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  const primaryKey = process.env[apiKeyVar] || process.env.GROQ_API_KEY;
  const secondaryKey = process.env.GROQ_API_KEY_2;

  const tryRequest = async (key) => {
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
  };

  try {
    return await tryRequest(primaryKey);
  } catch (err) {
    if (secondaryKey && secondaryKey !== primaryKey) {
      console.warn('⚠️ GROQ Primary failed, trying fallback...');
      try {
        return await tryRequest(secondaryKey);
      } catch (err2) {
        throw new Error(`Both GROQ keys failed. Last error: ${err2.message}`);
      }
    }
    throw err;
  }
}

// ============ GEMINI Helper (with multiple keys) ============
async function tryGeminiWithFallback(preparePayload, logs = []) {
  const keys = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2].filter(Boolean);
  
  for (let i = 0; i < keys.length; i++) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys[i]}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preparePayload()),
      });
      
      const json = await res.json();
      if (!res.ok) throw new Error(`Gemini error ${res.status}: ${JSON.stringify(json)}`);
      return json.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (err) {
      console.warn(`⚠️ Gemini Key ${i+1} failed:`, err.message);
      if (logs) logs.push(`⚠️ Limite Gemini ${i+1} atingido, tentando alternativa...`);
    }
  }
  return null;
}

// ============ GEMINI Call (Review with dual-key fallback + Groq emergency) ============
async function callGemini(prompt, logs = []) {
  const preparePayload = () => ({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
  });

  const geminiResult = await tryGeminiWithFallback(preparePayload, logs);
  if (geminiResult !== null) {
    return geminiResult;
  }

  // Final Emergency Fallback to Groq for text tasks
  console.warn('🚨 Both Gemini keys failed, falling back to emergency GROQ...');
  if (logs) logs.push('🚨 Gemini indisponível, usando motor de emergência Groq...');
  return await callGroq([{ role: 'user', content: prompt }], 'GROQ_API_KEY_2', { maxTokens: 4096 });
}



// ============ ANALYZE USER UPLOADS (Vision with Gemini) ============
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

TASK: Analise APENAS o conteúdo visual dessas imagens. Descreva o que cada imagem mostra e o contexto científico. Retorne apenas as descrições.`;

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
  const connectorAuto = options.connectorAuto !== false;
  const userConnectors = Array.isArray(options.connectors) ? options.connectors : [];

  const autoDetectedConnectors = ['phet', 'wikidata', 'pubmed', 'rcsb'];
  const normalizedText = (userQuestion || '').toLowerCase();
  
  if (/\b(formiga|ant|ants|himenóptero|genus|inseto|antweb)\b/i.test(normalizedText)) autoDetectedConnectors.push('antweb');
  if (/\b(peixe|oceano|fishwatch|sustentabilidade|pesca|marinho)\b/.test(normalizedText)) autoDetectedConnectors.push('fishwatch');
  if (/\b(elemento|química|tabela periódica|elétrons|átomo|metal|massa atômica)\b/.test(normalizedText)) autoDetectedConnectors.push('periodictable');
  if (/\b(livro|literatura|gutenberg|autor|clássico|ebook)\b/.test(normalizedText)) autoDetectedConnectors.push('gutenberg');
  if (/\b(bíblia|versículo|escritura|evangelho)\b/.test(normalizedText)) autoDetectedConnectors.push('bible');
  if (/\b(satélite|órbita|celestrak|rastreio)\b/.test(normalizedText)) autoDetectedConnectors.push('celestrak');
  if (/\b(lançamento|foguete|missão espacial|spacedevs|voo espacial)\b/.test(normalizedText)) autoDetectedConnectors.push('spacedevs');
  if (/\b(planeta|sistema solar|corpo celeste|órbita solar)\b/.test(normalizedText)) autoDetectedConnectors.push('solarsystem');
  if (/\b(frase|citação|pensamento|quotes|inspirar)\b/.test(normalizedText)) autoDetectedConnectors.push('quotes');
  if (/\b(cachorro|cão|raça|dog|pet)\b/.test(normalizedText)) autoDetectedConnectors.push('dogapi');
  if (/\b(ar|poluição|qualidade do ar|openaq|smog)\b/.test(normalizedText)) autoDetectedConnectors.push('openaq');
  if (/\b(constante|física|codata|velocidade da luz|planck)\b/.test(normalizedText)) autoDetectedConnectors.push('codata');

  if (/\b(arxiv|paper|artigo|pesquisa|estudo|tese|scielo)\b/.test(normalizedText)) {
    autoDetectedConnectors.push('arxiv');
    if (/\b(scielo|brasil|português|tese)\b/.test(normalizedText)) autoDetectedConnectors.push('scielo');
  }
  
  if (/\b(brasil|ibge|demografia|população|estado|cidade|saneamento|município)\b/.test(normalizedText)) {
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
  autoDetectedConnectors.push('open-meteo');

  const selectedConnectors = connectorAuto
    ? [...new Set(autoDetectedConnectors)]
    : [...new Set(userConnectors.map(c => c.toLowerCase()))];

  const useNasa = options.useNasa === true || selectedConnectors.includes('nasa');

  // Track which sources were used for answering (web + NASA)
  const sources = [];

  // Function to add sources for citation
  function addSource(id, label, type, detail, url) {
    sources.push({ id, label, type, detail, url });
  }
logs.push('🧠 Iniciando raciocínio (processo interno)');

  let context = '';
  let nasaMedia = [];
  const media = [];
  
  const queryParaBuscar = actionPlan?.termo_de_busca && actionPlan.termo_de_busca !== 'null' ? actionPlan.termo_de_busca : userQuestion;

  const isEarthquakeQuery = selectedConnectors.includes('usgs') && 
    /terremoto|sismo|tremor|abalo|sism|quake/i.test(userQuestion);
  const isSunQuery = selectedConnectors.includes('sunrise') &&
    /sol|sunrise|sunset|nascer|pôr|por do sol/i.test(userQuestion);

  // Tavily só roda se:
  // 1. Modo Auto E o plano pede busca E não é query de dado em tempo real
  // 2. OU modo manual E o usuário EXPLICITAMENTE selecionou 'tavily'
  const podeBuscarWeb = connectorAuto
    ? (actionPlan?.precisa_busca_web && !isEarthquakeQuery && !isSunQuery)
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


  logs.push(`🔌 Conectores selecionados: ${selectedConnectors.join(', ') || 'nenhum'}`);

  // Data de cada conector
  
  if (selectedConnectors.includes('scielo')) {
    logs.push(`📚 Buscando na SciELO: "${queryParaBuscar}"`);
    const scielo = await buscarSciELO(queryParaBuscar);
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
    const props = await buscarCamara(queryParaBuscar);
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
      addSource('ISS', 'Open Notify - ISS Tracker', 'iss', `Posição: ${iss.lat}°, ${iss.lon}°`, 'http://open-notify.org');
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
      addSource('SUNRISE', 'Sunrise-Sunset.org', 'sunrise', `Nascer: ${sun.sunrise}, Pôr: ${sun.sunset}`, 'https://sunrise-sunset.org');
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
    const pdbIds = await buscarRCSB(queryParaBuscar);
    if (pdbIds && pdbIds.length > 0) {
      context += `\n\n🧬 Estruturas PDB encontradas: ${pdbIds.join(', ')}\n(Se for relevante, cite o ID e use a tag [PDB:id] para o visualizador 3D).\n`;
      addSource('PDB-1', `PDB ID: ${pdbIds[0]}`, 'rcsb', `Estrutura de proteína via Protein Data Bank`, `https://www.rcsb.org/structure/${pdbIds[0]}`);
      logs.push(`✅ ${pdbIds.length} estruturas de proteínas encontradas`);
    }
  }

  if (selectedConnectors.includes('antweb')) {
    logs.push(`🐜 Buscando formigas no AntWeb: "${queryParaBuscar}"`);
    const ants = await buscarAntWeb(queryParaBuscar);
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
    const element = await buscarTabelaPeriodica(queryParaBuscar);
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
    const fish = await buscarFishWatch(queryParaBuscar);
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
    const aq = await buscarQualidadeAr(queryParaBuscar);
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
    const body = await buscarSistemaSolar(queryParaBuscar);
    if (body) {
      context += `\n\n🪐 Dados Celestiais (${body.englishName}):\nGravidade: ${body.gravity} m/s², Massa: ${body.mass?.massValue}x10^${body.mass?.massExponent} kg, Luas: ${body.moons?.length || 0}\n`;
      addSource('SPACE-1', `Solar System: ${body.englishName}`, 'solarsystem', `Dados astronômicos oficiais.`, `https://solarsystem.nasa.gov/planets/${body.englishName.toLowerCase()}`);
      logs.push('✅ Dados planetários coletados');
    }
  }

  if (selectedConnectors.includes('poetry')) {
    logs.push(`📜 Buscando poesia: "${queryParaBuscar}"`);
    const poems = await buscarPoesia(queryParaBuscar);
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
      addSource('OPEN-METEO', 'Open-Meteo API', 'open-meteo', `Temperatura atual: ${temp}°C, Umidade: ${humi}%`, 'https://open-meteo.com');
      logs.push('✅ Dados Open-Meteo coletados');
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

        // ANALYZE IMAGES (first 4 with GROQ, last 4 with Gemini)
        const imagesCount = nasaMedia.filter(m => m.media_type === 'image').length;
        if (imagesCount >= 4) {
          logs.push('🔍 Analisando imagens com IA (Groq + Gemini)...');

          const [groqAnalysis, geminiAnalysis] = await Promise.all([
            analyzeNasaImagesWithGroq(nasaMedia).catch(err => {
              console.error('Groq image analysis failed:', err);
              return null;
            }),
            analyzeNasaImagesWithGemini(nasaMedia).catch(err => {
              console.error('Gemini image analysis failed:', err);
              return null;
            }),
          ]);

          if (groqAnalysis) {
            context += `\n\n📸 Análise de imagens (GROQ):\n${groqAnalysis}`;
            addSource('NASA-ANALYSIS-GROQ', 'Análise de imagens (GROQ)', 'nasa', groqAnalysis, null);
          }
          if (geminiAnalysis) {
            context += `\n\n📸 Análise de imagens (Gemini):\n${geminiAnalysis}`;
            addSource('NASA-ANALYSIS-GEMINI', 'Análise de imagens (Gemini)', 'nasa', geminiAnalysis, null);
          }

          if (groqAnalysis || geminiAnalysis) {
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

  const executionPrompt = `${SCIENCE_SYSTEM_PROMPT}

${dataAuthorityWarning}

CONTEXTO PESQUISADO (FONTES REAIS):
${context || 'Nenhum contexto externo necessário'}
${historyText}${visionText}

FONTES DISPONÍVEIS PARA CITAÇÃO:
${sources.map(s => `${s.id}: ${s.label} - ${s.detail}`).join('\n')}

PERGUNTA ATUAL DO USUÁRIO: "${userQuestion}"

INSTRUÇÕES FINAIS:
1. Se o usuário perguntou horários, listas de eventos (terremotos) ou fatos numéricos, entregue esses dados JÁ NO INÍCIO.
2. Use a estrutura adaptativa do sistema (📊 para dados, 🔬 para conceitos).
3. Cite TODAS as afirmações factuais com [ID-DA-FONTE].
4. Mantenha o tom didático e amigável, mas seja direto nos dados.

Seja honesto. Não invente. Use as fontes.`;


  const response = await callGroq(
    [{ role: 'user', content: executionPrompt }],
    'GROQ_API_KEY_1',
    { maxTokens: 6000, temperature: 0.2 }
  );

  logs.push('✅ Resposta gerada pela IA principal');
  return { response, media: [...media, ...nasaMedia], sources };
}

// ============ STEP 3: Review with Gemini ============
async function reviewResponse(response) {
  const reviewPrompt = `Você é um revisor científico experiente. Recebeu a resposta abaixo para revisão.

Objetivo:
- Garantir precisão e remover erros factuais.
- Otimizar a estrutura e o tom: garantir uso de analogias simples do dia a dia.
- Manter formatação excelente e acessível (parágrafos curtos, bullet points, negrito em conceitos chave).
- Assegurar que há uma proposta de experimento ou pergunta instigante no final.

REGRAS CRUCIAIS (RESPEITE 100%):
1) Retorne APENAS a resposta final para o usuário. NADA mais.
2) NÃO inclua nenhum texto como "Como revisor...", "Observação:", ou explicações sobre o processo de revisão.
3) NÃO inclua títulos, cabeçalhos ou listas de etapas. Apenas texto fluido.
4) Ao final, inclua SOMENTE a tag de confiança no formato: [CONFIANÇA: ALTO/MÉDIO/BAIXO]
5) Se não for possível afirmar com certeza, seja honesto e explique por que.
6) IMPORTANTE: NÃO REMOVA as tags [ID-DA-FONTE] presentes no texto original. Se o texto estiver afirmando informações sem as tags apropriadas originais, ADICIONE as tags [ID-DA-FONTE] ao longo do texto. É vital manter o rastreio das fontes.

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
  const connectorAuto = body?.connectorAuto !== false;
  const connectors = Array.isArray(body?.connectors) ? body.connectors : [];
  const history = Array.isArray(body?.history) ? body.history : [];

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

  if (!userQuestion) {
    return res.status(400).json({ error: 'Pergunta vazia' });
  }

  const logs = [];

  try {
    logs.push('🚀 Iniciando Agente Científico...');

    const files = Array.isArray(body?.files) ? body.files : [];
    let visionContext = '';
    if (files.length > 0) {
      logs.push('👁️ Analisando arquivos anexados com visão computacional...');
      const imgDesc = await analyzeUserFilesWithGemini(files, userQuestion);
      if (imgDesc) {
        visionContext = `[IMAGEM ENVIADA PELO ALUNO]: ${imgDesc}\n`;
        logs.push('✅ Análise visual concluída');
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

    const exec = await executeAgentPlan(userQuestion, actionPlan, logs, { connectorAuto, connectors, useNasa: body?.nasa, history, visionContext, userContext });

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
      sources: exec.sources || [],
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
      sources: [],
    });
  }
}

module.exports = handler;
