#!/usr/bin/env node

// Quick test for the new keyword-matching system
const fs = require('fs');
const path = require('path');

// ============ KEYWORD MATCHING FUNCTIONS (copied from chat.js) ============
let CONNECTOR_KEYWORDS_MAP = null;

function loadConnectorKeywords() {
  if (CONNECTOR_KEYWORDS_MAP) return CONNECTOR_KEYWORDS_MAP;
  try {
    const dataPath = path.join(process.cwd(), 'data.json');
    const rawData = fs.readFileSync(dataPath, 'utf8');
    const dataJson = JSON.parse(rawData);
    CONNECTOR_KEYWORDS_MAP = {};
    if (Array.isArray(dataJson.apis)) {
      for (const api of dataJson.apis) {
        const connectorKey = api.nome?.toLowerCase().replace(/\s+/g, '-').replace(/[()]/g, '') || '';
        const keywords = (api.palavras_chave || []).map(kw => 
          String(kw).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        );
        if (connectorKey && keywords.length > 0) {
          CONNECTOR_KEYWORDS_MAP[connectorKey] = keywords;
        }
      }
    }
    console.log(`✅ Loaded ${Object.keys(CONNECTOR_KEYWORDS_MAP).length} connectors from data.json`);
    return CONNECTOR_KEYWORDS_MAP;
  } catch (err) {
    console.error('[KEYWORDS] Failed to load data.json:', err);
    return {};
  }
}

function levenshteinDistance(str1, str2) {
  const len1 = str1.length, len2 = str2.length;
  const matrix = Array(len2 + 1).fill(null).map(() => Array(len1 + 1).fill(0));
  for (let i = 0; i <= len1; i++) matrix[0][i] = i;
  for (let j = 0; j <= len2; j++) matrix[j][0] = j;
  for (let j = 1; j <= len2; j++) {
    for (let i = 1; i <= len1; i++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }
  return matrix[len2][len1];
}

function matchKeywordWithTolerance(userWord, keywordWord, maxDistance = 2) {
  const distance = levenshteinDistance(userWord, keywordWord);
  return distance <= Math.max(2, Math.floor(keywordWord.length * 0.3));
}

function detectConnectorsByKeywords(userQuestion) {
  const keywordMap = loadConnectorKeywords();
  if (!keywordMap || Object.keys(keywordMap).length === 0) return [];

  const normalized = String(userQuestion || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  
  const userWords = normalized.split(/\s+/).filter(w => w.length > 2);
  const detectedConnectors = new Set();

  for (const [connectorKey, keywords] of Object.entries(keywordMap)) {
    for (const userWord of userWords) {
      for (const keyword of keywords) {
        if (userWord === keyword || matchKeywordWithTolerance(userWord, keyword)) {
          detectedConnectors.add(connectorKey);
          break;
        }
      }
    }
  }

  return Array.from(detectedConnectors);
}

// ============ TEST CASES ============
console.log('\n🧪 Testing keyword-based connector detection:\n');

const testCases = [
  { query: 'clima de marte', expected: ['open-meteo', 'nasa'] },
  { query: 'proteína no sangue', expected: ['uniprot', 'pubmed'] },
  { query: 'Açúcar', expected: ['openfoodfacts'] },
  { query: 'noticia recente', expected: ['google-news-serpapi'] },
  { query: 'derivada integral calculo', expected: ['newton'] },
  { query: 'artigo científico física', expected: ['arxiv'] },
  { query: 'mouse genoma', expected: ['mgi'] },
  { query: 'drosophila flybase', expected: ['flybase'] },
  { query: 'enciclopédia wikipedia', expected: ['wikipedia'] },
];

let passed = 0;
let failed = 0;

testCases.forEach(testCase => {
  const result = detectConnectorsByKeywords(testCase.query);
  const hasExpected = testCase.expected.some(exp => result.includes(exp));
  const status = hasExpected ? '✅' : '❌';
  
  console.log(`${status} Query: "${testCase.query}"`);
  console.log(`   Expected: ${testCase.expected.join(', ')}`);
  console.log(`   Got: ${result.join(', ') || '(none)'}`);
  
  if (hasExpected) {
    passed++;
  } else {
    failed++;
  }
  console.log();
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${testCases.length} tests`);
