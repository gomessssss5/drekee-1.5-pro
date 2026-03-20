# Drekee AI 1.5 Pro

Agente científico avançado com integração real da NASA e múltiplas APIs.

## 🚀 Funcionalidades

- 🤖 Respostas científicas confiáveis e acessíveis
- 🔍 Busca na web (Tavily) para contexto atualizado
- 🚀 Integração com NASA (imagens e vídeos científicos)
- 📚 Fontes acadêmicas (arXiv, Wikipedia)
- 🧮 Cálculos matemáticos (MathJS)
- 🌦️ Dados meteorológicos (Open-Meteo)
- 🚀 Informações de lançamentos (SpaceX)

## 🛠️ Setup Local

### 1. Instalar dependências
```bash
npm install
```

### 2. Configurar variáveis de ambiente
```bash
cp .env.example .env
# Edite .env com suas chaves de API
```

**APIs necessárias:**
- `GROQ_API_KEY_1` - Modelo principal de raciocínio
- `GROQ_API_KEY_2` - Análise de imagens
- `GEMINI_API_KEY` - Revisão de respostas
- `TAVILY_API_KEY` - Busca na web

### 3. Executar
```bash
npm start
# ou
npm run dev
```

Acesse: http://localhost:3000

## 🧪 Testes

Consulte `TESTING_GUIDE.md` para casos de teste detalhados.

### Teste rápido:
1. Abra http://localhost:3000
2. Digite: "Explique o que é fotossíntese"
3. Clique em "Conectores" e ative "Wikipedia"
4. Envie a mensagem
5. Verifique logs e resposta

## 📁 Estrutura

```
/workspaces/drekee-1.5-pro/
├── index.html          # Frontend
├── api/chat.js         # Backend principal
├── server.js           # Servidor local
├── package.json        # Dependências
└── .env.example        # Template de configuração
```

## 🌐 Deploy

Para produção, use Vercel:
```bash
npm install -g vercel
vercel --prod
```

## 📝 Notas

- Leia `IMPLEMENTATION_NOTES.md` para detalhes técnicos
- `CHANGELOG_*.md` contém histórico de mudanças
- Todas as APIs são gratuitas ou têm tiers generosos