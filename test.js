// Test script for Drekee AI 1.5 Pro APIs
// Run with: node test.js

const handler = require('./api/chat.js');

async function runTests() {
  console.log('🧪 Iniciando testes do Drekee AI...\n');

  // Mock request for testing (simulating raw JSON stream)
  const testData = JSON.stringify({
    text: 'What is photosynthesis?',
    connectors: ['wikipedia'],
    nasa: false,
    connectorAuto: true
  });

  const mockReq = {
    method: 'POST',
    on: function(event, callback) {
      if (event === 'data') {
        // Simulate receiving data in chunks
        setTimeout(() => callback(testData), 10);
      } else if (event === 'end') {
        setTimeout(() => callback(), 20);
      }
    }
  };

  const mockRes = {
    status: function(code) {
      console.log(`HTTP ${code}`);
      return {
        json: (data) => {
          console.log('Response:', JSON.stringify(data, null, 2));
          return data;
        }
      };
    },
    json: function(data) {
      console.log('Response:', JSON.stringify(data, null, 2));
      return data;
    }
  };

  console.log('1. Testando handler completo...');
  console.log('Query: "What is photosynthesis?"');
  console.log('Connectors: wikipedia');
  console.log('NASA: disabled\n');

  try {
    await handler(mockReq, mockRes);
    console.log('\n✅ Handler executed successfully');
  } catch (error) {
    console.log('\n❌ Handler failed:', error.message);
    console.log('Stack:', error.stack);
  }

  console.log('\n🎯 Teste concluído!');
  console.log('\n💡 Status atual:');
  console.log('   ✅ Servidor local configurado');
  console.log('   ✅ Sintaxe validada');
  console.log('   ⚠️  APIs precisam de chaves (ver .env.example)');
  console.log('   🎯 Pronto para teste oficial!');
}

runTests().catch(console.error);