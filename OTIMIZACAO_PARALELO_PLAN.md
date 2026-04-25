# 🚀 Plano de Otimização: Paralelização de Conectores

## Status Atual
Em `executeAgentPlan()` (chat.js linha 4218), todos os conectores são chamados **sequencialmente**:
- `if (scielo) await buscarSciELO()`  ← aguarda resposta
- `if (ibge) await buscarIBGE()`      ← só depois começa
- `if (openlibrary) await buscarOpenLibrary()` ← só depois
- ... (30+ conectores assim)

**Resultado**: Se 10 conectores são ativos, e cada um leva 500ms, você aguarda 5 segundos+ só nessa etapa.

---

## Potencial de Paralelização

### ✅ INDEPENDENTES (podem rodar em paralelo - ganho máximo)
Esses conectores NÃO dependem um do outro e podem ser acionados simultaneamente:

#### Grupo A: Acadêmico/Conteúdo
- `scielo`, `pubmed`, `arxiv`, `rcsb`, `gutenberg`, `openlibrary`, `wikidata`
- **Tempo sequencial**: ~3.5s
- **Tempo paralelo**: ~500ms
- **Ganho**: 85%

#### Grupo B: Biodiversidade/Natureza
- `gbif`, `fishwatch`, `antweb`, `codata`
- **Tempo sequencial**: ~2s
- **Tempo paralelo**: ~500ms
- **Ganho**: 75%

#### Grupo C: Astronomia/Espaço
- `spacex`, `solarsystem`, `horizons`, `sdo`
- **Tempo sequencial**: ~2.5s
- **Tempo paralelo**: ~500ms
- **Ganho**: 80%

#### Grupo D: Brasil/Localização
- `ibge`, `brasilapi`, `camara`, `iss`, `sunrise`
- **Tempo sequencial**: ~2.5s
- **Tempo paralelo**: ~500ms
- **Ganho**: 80%

#### Grupo E: Clima/Ambiente
- `openaq`, `noaa-climate`, `worldbank-climate`
- **Tempo sequencial**: ~1.5s
- **Tempo paralelo**: ~500ms
- **Ganho**: 66%

#### Grupo F: Busca/Conteúdo Web
- `wikipedia`, `dictionary-en`, `universities`, `bible`, `poetry`
- **Tempo sequencial**: ~2.5s
- **Tempo paralelo**: ~500ms
- **Ganho**: 80%

#### Grupo G: Utilidades
- `quotes`, `dogapi`, `newton`
- **Tempo sequencial**: ~1.5s
- **Tempo paralelo**: ~500ms
- **Ganho**: 66%

---

### 🔄 SEQUENCIAIS (devem manter ordem)

```
1. generateActionPlan()  ← primeiro, define estratégia
   ↓
2. [PARALELO] Todos os conectores independentes
   ↓
3. Tavily (busca web)    ← usa contexto dos conectores acima (opcional)
   ↓
4. NASA Search           ← usa query otimizada
   ↓
5. analyzeNasaImages()   ← analisa resultados da NASA
   ↓
6. callGroq()            ← síntese do modelo principal
   ↓
7. reviewResponse()      ← revisão Gemini
```

---

## Ganho Total Estimado

### Cenário atual (sequencial)
```
Plan:            200ms
Conectores:      6000ms  (30+ conectores × 200ms médio)
NASA:            2000ms
Análise:         1500ms
LLM Principal:   3000ms
Revisão Gemini:  2000ms
─────────────────────
TOTAL:          14,700ms ≈ 15 segundos
```

### Cenário otimizado (paralelo)
```
Plan:                 200ms
[Todos conectores]:   500ms  (paralelo dentro do mesmo "slot")
NASA:                2000ms
Análise:             1500ms
LLM Principal:       3000ms
Revisão Gemini:      2000ms
─────────────────────
TOTAL:              9,200ms ≈ 9 segundos
```

### 💚 Ganho: -6.5 segundos (37% mais rápido)

---

## O Que REMOVER (desnecessários para escolas)

### Conectores pouco úteis para educação:
- ❌ `dogapi` - fotos de cachorro (irrelevante)
- ❌ `quotes` - frases inspiracionais (não educacional)
- ❌ `poetry` - poesia/PoetryDB (marginal)
- ❌ `bible` - Bíblia (fora de currículo público)
- ❌ `libras` - não implementado
- ❌ `timelapse` - Google Earth timelapses (não prático)
- ❌ `metmuseum`, `getty`, `sketchfab` - arte/museus (marginal)
- ❌ `ligo`, `firms`, `usgs-water` - especializados demais

**Economias**:
- Remover 12 conectores = -4 segundos no pior caso
- Torna a lógica mais simples
- Reduz chance de erro

---

## Implementação Sugerida

### Passo 1: Agrupar tudo em Promise.all()
```javascript
// Antes (sequencial):
if (selectedConnectors.includes('scielo')) {
  const scielo = await buscarSciELO(queryParaBuscar);
  // ...
}
if (selectedConnectors.includes('ibge')) {
  const ibge = await buscarIBGE(queryParaBuscar);
  // ...
}

// Depois (paralelo):
const connectorTasks = [];
if (selectedConnectors.includes('scielo')) {
  connectorTasks.push(buscarSciELO(queryParaBuscar).then(data => ({ key: 'scielo', data })));
}
if (selectedConnectors.includes('ibge')) {
  connectorTasks.push(buscarIBGE(queryParaBuscar).then(data => ({ key: 'ibge', data })));
}
// ... mais conectores
const results = await Promise.all(connectorTasks);
// processar results
```

### Passo 2: Simplificar prompt
- Reduzir sistema principal de 50+ linhas para 20 linhas
- Remover instruções redundantes
- Enviar apenas dados relevantes

### Passo 3: Desabilitar revisão em casos simples
- Se pergunta é sobre definição, não revise (já é simples)
- Se pergunta é sobre cálculo, não revise (resultado é objetivo)
- Revise apenas em respostas com texto denso/ambíguo

---

## Próximos Passos

1. ✅ Você aprova o plano?
2. ❓ Quer que eu implemente as mudanças no chat.js?
3. ❓ Quer remover os 12 conectores inúteis?
4. ❓ Quer simplificar o prompt do LLM?
