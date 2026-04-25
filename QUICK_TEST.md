# 🚀 Quick Start - Teste as Mudanças

## ⚡ Passos de 1 Minuto

### 1️⃣ Inicie o Servidor
```bash
npm start
# ou
node server.js
```

### 2️⃣ Abra o navegador
- http://localhost:3000

### 3️⃣ Abra DevTools
- Pressione `F12` ou `Ctrl+Shift+I`
- Vá para aba **Console**

### 4️⃣ Envie sua primeira mensagem
- Digite: "O que é fotossíntese?"
- Clique "Enviar" ou pressione `Enter`

### 5️⃣ Observe os 3 efeitos
```
✅ INPUT BOX
└─ Deve estar CENTRALIZADO na tela
└─ Quando envia, move para ESQUERDA em 0.3s

✅ PLACEHOLDER CARD  
└─ Deve aparecer NO PAINEL DIREITO
└─ Com "Pesquisando na web..."
└─ E uma frase aleatória embaixo

✅ TAVILY SEARCH
└─ Deve ver logs no console:
   └─ "[TAVILY DEBUG] ✅ Starting Tavily search"
   └─ "[TAVILY] ✅ API response received"
```

---

## 🔍 O Que Procurar nos Logs

### Console do Navegador (F12)
```
📤 sendMessage() triggered - USER: O que é fotossíntese?
📨 addMessage() - Role: user, Has content: true
⚠️ Chat not active yet, activating...
🎯 activateChatLayout() CALLED
✅ chat-active class added to body
⏱️ Showing placeholder card immediately...
✨ Placeholder card inserted and made visible
```

### Console do Servidor (terminal)
```
[TAVILY DEBUG] podeBuscarWeb: true missingImageInterpretation: false
[TAVILY DEBUG] ✅ Starting Tavily search for: O que é fotossíntese
[TAVILY] searchTavily() called for: ... API key present: true
[TAVILY] Making API request to Tavily...
[TAVILY] ✅ API response received. Results: 8 Photos: 3
```

---

## ❌ Se Algo NÃO Funcionar

### Input box não se move
- [ ] Verifique se `📦 Input wrapper computed left:` muda de `0px` para `288px`
- [ ] Se não mudar: há conflito CSS (procure por outro `left:` no CSS)
- [ ] Tente limpar cache: `Ctrl+Shift+Delete` → "Cookies and other site data"

### Placeholder card não aparece
- [ ] Verifique se "✨ Placeholder card inserted" aparece nos logs
- [ ] Se não aparecer: `#chatSidebar` pode estar escondido
- [ ] Se aparecer mas não vê: pode estar fora da tela (scroll para direita?)

### Tavily não funciona
- [ ] Procure por `[TAVILY] ❌ NO API KEY`
- [ ] Se vir: adicione em `.env`: `TAVILY_API_KEY=tvly-[sua-chave]`
- [ ] Se vir `API returned non-OK status`: chave pode ser inválida

---

## 💡 Dicas

1. **Logs demais?** Use `Ctrl+L` para limpar console
2. **Procurar por log específico?** `Ctrl+F` dentro do console
3. **Não vê o placeholder?** Pode estar com scroll para esquerda - role para direita
4. **Quer mais detalhe?** Leia `DEBUG_GUIDE.md` para investigação completa

---

## ✨ Esperado vs Atual

### ✅ Agora Funciona
- Input box: CENTRALIZADO até enviar → move para esquerda suave
- Placeholder: Aparece IMEDIATAMENTE quando processa
- Tavily: Roda em TODAS as mensagens (API key obrigatória)

### ⚠️ Comportamento Pode Parecer "Estranho" (Mas é correto)
- Versão anterior: placeholder nunca aparecia
- Versão nova: placeholder aparece, depois desaparece quando resposta chega
- Isso é **proposital** - mostra que está processando!

---

## 📞 Próximas Ações

1. Se os 3 efeitos funcionarem → 🎉 **Pronto!**
2. Se um não funcionar → Leia a seção "Se Algo NÃO Funcionar" acima
3. Se tiver dúvida → Consulte `DEBUG_GUIDE.md` para investigação completa

**Tempo esperado: 2-3 minutos para testar tudo!**
