const test = require('node:test');
const assert = require('node:assert/strict');

const chat = require('../api/chat.js');

const {
  alignGraphWithResponseReliability,
  buildGraphBlockFromSpec,
  buildMindMapBlockFromSpec,
} = chat.__internals;

test('preserves a valid explicit graph when structured extraction is unavailable', async () => {
  const graphBlock = buildGraphBlockFromSpec({
    title: 'Comparacao',
    chartType: 'bar',
    xLabel: 'Categoria',
    yLabel: 'Participacao (%)',
    unit: '%',
    basis: 'percentage',
    missingLabels: [],
    series: [
      {
        name: 'Serie principal',
        points: [
          { label: 'A', value: 42, status: 'confirmed' },
          { label: 'B', value: 58, status: 'confirmed' },
        ],
      },
    ],
  });

  const response = [
    'A categoria A ficou com 42% [ID-DA-FONTE: SRC-1].',
    'A categoria B ficou com 58% [ID-DA-FONTE: SRC-2].',
    '',
    graphBlock,
  ].join('\n\n');

  const result = await alignGraphWithResponseReliability(
    response,
    [{ id: 'SRC-1' }, { id: 'SRC-2' }],
    'Faca um grafico comparando as categorias A e B',
    []
  );

  assert.match(result.response, /\[LATEX_GRAPH_CODE\]/);
  assert.equal(result.confidence, 'MEDIUM');
});

test('preserves a valid explicit mind map when semantic audit is unavailable', async () => {
  const mindMapBlock = buildMindMapBlockFromSpec({
    title: 'Mapa mental',
    center: 'Fotossintese',
    branches: [
      { label: 'Entrada', subtopics: ['agua', 'luz', 'CO2'] },
      { label: 'Processo', subtopics: ['cloroplasto', 'ATP', 'glicose'] },
      { label: 'Saidas', subtopics: ['oxigenio', 'energia', 'materia'] },
    ],
  });

  const response = [
    'A fotossintese depende de luz e agua [ID-DA-FONTE: SRC-1].',
    'Ela produz glicose e oxigenio [ID-DA-FONTE: SRC-2].',
    '',
    mindMapBlock,
  ].join('\n\n');

  const result = await alignGraphWithResponseReliability(
    response,
    [{ id: 'SRC-1' }, { id: 'SRC-2' }],
    'Crie um mapa mental sobre fotossintese',
    []
  );

  assert.match(result.response, /\[MINDMAP_CODE\]/);
  assert.equal(result.confidence, 'MEDIUM');
});

test('reports missing keyed connector before probing it', async () => {
  const result = await chat.probeConnector('tavily');

  assert.equal(result.status, 'missing_key');
  assert.equal(result.message, 'Chave ausente: TAVILY_API_KEY');
});
