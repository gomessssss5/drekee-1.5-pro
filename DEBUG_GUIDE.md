# 🔍 Guia de Diagnóstico - Drekee UI Issues

Foram adicionados logs detalhados em todo o código para diagnosticar os 3 problemas relatados. Siga este guia para testá-los.

## Como Usar

1. **Abra o navegador** (Chrome, Firefox, ou Edge)
2. **Acesse a aplicação**: http://localhost:3000 (ou onde está rodando)
3. **Abra DevTools**: `F12` ou `Ctrl+Shift+I`
4. **Vá para a aba "Console"**
5. **Envie uma mensagem** e observe os logs

---

## 🎯 Problema 1: Input Box Moving Left Before Chat Starts

### O que esperar:
- Input deve ficar **centralizado** na tela
- Quando você envia a mensagem, deve se mover para a **esquerda** suavemente em 0.3s

### O que procurar nos logs:
```
📤 sendMessage() triggered - USER: [sua mensagem aqui]
📨 addMessage() - Role: user, Has content: true
⚠️ Chat not active yet, activating...
🎯 activateChatLayout() CALLED
✅ chat-active class added to body
📦 Input wrapper computed left: 0px
📦 Input wrapper computed right: 0px
```

Depois de alguns ms (transição de 300ms):
```
📦 Input wrapper computed left: 288px (aproximadamente 18rem)
📦 Input wrapper computed right: [valor calculado]
```

### Se não funcionar:
- ❌ Se não ver "🎯 activateChatLayout() CALLED", o input não está sendo ativado
- ❌ Se o left/right não mudar, há um conflito CSS

---

## 📱 Problema 2: Placeholder Card Not Showing During Processing

### O que esperar:
- Quando a IA está processando, deve aparecer um card no painel direito
- Card deve ter título "Pesquisando na web..."
- Card deve conter uma frase aleatória motivacional

### O que procurar nos logs:
Primeira resposta da IA:
```
📊 hasResponseContent: false HTML length: 0
🔍 No response content yet, showing placeholder card
➕ Adding tavilySearchCard to rightCol
```

Depois 420ms:
```
🎬 revealAgentResponseSequence() called
  rightSections count: 1
  Section 0: tavily-search-card agent-pane-reveal right-pane-hidden
🎭 Revealing right pane sections at 420ms
  Revealing section 0: tavily-search-card agent-pane-reveal right-pane-hidden
```

Após esta linha, card muda para classe `right-pane-show` (visível):
```
  Revealing section 0: tavily-search-card agent-pane-reveal right-pane-show
```

### Se não funcionar:
- ❌ Se vir "right Sections count: 0" = card não foi adicionado
- ❌ Se vir "hasResponseContent: true" logo de primeira = falha na lógica
- ❌ Se não seguir para "Revealing right pane" = erro na função

### Checklist:
- [ ] `#chatSidebar` elemento existe e é visível (não `display: none`)
- [ ] `frases.json` foi carregado (procure por console de sucesso ao carregar)
- [ ] CSS de `.tavily-search-card` e `.right-pane-show` está aplicado

---

## 🌐 Problema 3: Tavily API Not Running on All Messages

### O que esperar:
- Quando você envia qualquer pergunta, deve fazer busca na web via Tavily
- Deve coletar fontes e imagens
- Deve aparecer nos logs da IA como "📰 Resultados de busca web"

### O que procurar nos logs (Frontend):
```
[TAVILY DEBUG] podeBuscarWeb: true missingImageInterpretation: false
[TAVILY DEBUG] ✅ Starting Tavily search for: [sua pergunta]
```

### O que procurar nos logs (Backend/Console do Servidor):
```
[TAVILY] searchTavily() called for: [sua pergunta] API key present: true
[TAVILY] Making API request to Tavily...
[TAVILY] ✅ API response received. Results: [número] Photos: [número]
```

ou (se using escopado):
```
[TAVILY SCOPED] searchTavilyScoped() called for: [sua pergunta]
[TAVILY SCOPED] Making API request...
[TAVILY SCOPED] ✅ API response received
```

### Se não funcionar:

**Caso 1: podeBuscarWeb é false**
```
[TAVILY DEBUG] podeBuscarWeb: false
```
- ❌ Alguma imagem não foi interpretada (missingImageInterpretation = true)
- ❌ Solução: não enviar imagens

**Caso 2: API key não presente**
```
[TAVILY] ❌ NO API KEY - returning null
```
- ❌ Variável `TAVILY_API_KEY` não foi configurada
- ❌ Solução: Adicione na `.env`:
```
TAVILY_API_KEY=tvly-[sua chave aqui]
```

**Caso 3: API retorna erro**
```
[TAVILY] ❌ API returned non-OK status: 401
[TAVILY] ❌ Search error: FetchError...
```
- ❌ Chave expirada ou inválida
- ❌ Limite de requisições atingido
- ❌ Problema de rede

**Caso 4: Nenhum log de Tavily aparece**
- ❌ `podeBuscarWeb` pode estar sendo falso
- ❌ Cheque: há uma imagem sendo enviada?
- ❌ Se sim: isso pode estar bloqueanado Tavily

---

## 📋 Checklist de Verificação Rápida

```
FRONTEND:
[ ] Logs aparecem no console do navegador (F12)
[ ] "📤 sendMessage()" aparece quando enviam mensagem
[ ] "🎯 activateChatLayout()" aparece depois
[ ] "📦 Input wrapper computed..." mostra valores mudando

BACKEND:
[ ] Logs aparecem no console do servidor
[ ] "[TAVILY DEBUG]" ou "[TAVILY]" aparecem
[ ] Se vir "NO API KEY", configure .env
[ ] Se vir "API response received", Tavily está funcionando!

UI:
[ ] Input box centra na tela vazia
[ ] Input box move para esquerda quando envia
[ ] Placeholder card aparece no painel direito (após 420ms)
[ ] Fontes aparecem quando IA responde
```

---

## 🛠️ Próximas Ações

Se encontrar um dos problemas acima:

1. **Input não se move**: Verifique CSS specificity conflito
2. **Placeholder não aparece**: Verifique se `#chatSidebar` tem `display: flex` e não está escondido
3. **Tavily não roda**: Configure `TAVILY_API_KEY` no `.env` e reinicie o servidor

---

## 📝 Notas de Debug

- Todos os logs são prefixados para facilitar busca:
  - 🎯 = Ativação de layout
  - 📨 = Adição de mensagens
  - 📊 = Conteúdo da resposta
  - 🌐 = Busca web
  - 💾 = Cache
  - ❌ = Erros

Use `Ctrl+F` no console para procurar por esses emojis!
