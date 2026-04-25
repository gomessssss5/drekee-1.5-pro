# 🧪 PROMPTS PARA TESTAR A DREKE AI

## 📋 **Testes Básicos (sem imagens)**

### **1. Teste de Raciocínio Científico**
```
Explique o que é fotossíntese usando uma analogia simples e dê um desafio prático.
```

### **2. Teste de Mapa Mental**
```
Crie um mapa mental sobre o sistema solar mostrando os planetas, suas características principais e relações entre eles.
```

### **3. Teste de Física**
```
Como funciona a gravidade? Use uma analogia com uma cama elástica e explique por que objetos caem.
```

### **4. Teste de Química**
```
O que são ligações químicas? Explique como se fossem relacionamentos entre pessoas.
```

### **5. Teste de Biologia**
```
Como o DNA armazena informação genética? Use a analogia de um livro de receitas.
```

---

## 🖼️ **Testes com Imagens**

### **6. Teste de Visão Computacional**
```
[Envie uma imagem de uma planta ou animal]
Analise esta imagem e explique as características biológicas do organismo mostrado.
```

### **7. Teste de Análise Científica**
```
[Envie uma imagem de um experimento químico]
O que está acontecendo nesta imagem? Descreva o processo químico envolvido.
```

### **8. Teste Múltiplo**
```
[Envie 2-3 imagens diferentes]
Compare os processos biológicos mostrados nestas imagens e explique as semelhanças e diferenças.
```

---

## 🌍 **Testes Geográficos e de Dados**

### **9. Teste de Localização**
```
Qual a população do Brasil e como ela se compara com outros países da América do Sul?
```

### **10. Teste de Dados em Tempo Real**
```
Qual a posição atual da Estação Espacial Internacional e quando poderá ser vista do Brasil?
```

### **11. Teste de Terremotos**
```
Houve algum terremoto significativo nas últimas 24 horas? Onde e qual magnitude?
```

---

## 🚀 **Testes Astronômicos**

### **12. Teste de Planetas**
```
Quais são as características de Marte que o tornam parecido e diferente da Terra?
```

### **13. Teste de Estrelas**
```
Como as estrelas nascem? Explique o processo desde a nebulosa até a ignição nuclear.
```

### **14. Teste de Buracos Negros**
```
O que acontece se algo cai em um buraco negro? Use a analogia de uma cachoeira cósmica.
```

---

## 🔬 **Testes de Conceitos Complexos**

### **15. Teste de Evolução**
```
Como a evolução por seleção natural funciona? Use o exemplo das mariposas industriais.
```

### **16. Teste de Células**
```
Explique como uma célula funciona usando a analogia de uma cidade.
```

### **17. Teste de Energia**
```
O que é a Lei da Conservação de Energia? Dê exemplos práticos do dia a dia.
```

---

## 📊 **Testes Específicos da API**

### **18. Teste de Fallback SambaNova**
```
[Force uma situação de erro ou use uma pergunta muito complexa]
Explique a teoria das cordas em física quântica de forma detalhada.
```
*Deve mostrar logs de fallback para SambaNova se GROQ falhar*

### **19. Teste de Visão com SambaNova**
```
[Envie uma imagem científica complexa]
Analise esta imagem detalhadamente e explique os princípios científicos envolvidos.
```
*Deve mostrar `🔥 SambaNova (Llama-4-Maverick-17B-128E-Instruct) utilizada com sucesso`*

### **20. Teste de Planejamento com Fallback**
```
Compare a eficiência de diferentes fontes de energia renovável (solar, eólica, hidrelétrica).
```
*Deve mostrar fallback para SambaNova no planejamento se GROQ Agent falhar*

---

## 🎯 **Testes de Verificação**

### **21. Verificar Citações**
```
Quais são os maiores avanços da medicina no século XXI? Cite fontes confiáveis.
```

### **22. Verificar Mapas Mentais**
```
Crie um mapa mental sobre as causas e efeitos do aquecimento global.
```

### **23. Verificar Desafios Práticos**
```
Como funciona um motor elétrico? Dê um desafio prático para construir um modelo simples.
```

---

## 📝 **Como Avaliar os Resultados**

### ✅ **Indicadores de Sucesso**
- **Resposta clara e didática** com analogias
- **Mapa mental** gerado quando solicitado
- **Desafio prático** incluído no final
- **Citações** de fontes confiáveis `[ID-DA-FONTE: ID_EXATO]`
- **Logs** mostrando qual API foi usada

### 🔥 **Logs SambaNova para Monitorar**
```
🔥 SambaNova (Llama-4-Maverick-17B-128E-Instruct) utilizada com sucesso
🔥 SambaNova (Meta-Llama-3.3-70B-Instruct) utilizada com sucesso
🔥 SambaNova (Meta-Llama-3.1-8B-Instruct) utilizada com sucesso
```

### ⚠️ **Logs de Fallback**
```
🚨 GROQ Agent failed, trying SambaNova fallback...
✅ Plan generated using SambaNova fallback
🔄 Trying SambaNova fallback for synthesis...
```

---

## 🚨 **Testes de Stress**

### **24. Teste de Múltiplas Imagens**
```
[Envie 5 imagens diferentes]
Analise todas estas imagens e crie uma conclusão integrada sobre o tema científico em comum.
```

### **25. Teste de Pergunta Complexa**
```
Explique a relação entre mecânica quântica, relatividade geral e como elas se aplicam a buracos negros, incluindo as implicações para a teoria das cordas e a busca por uma teoria de tudo.
```

---

## 📈 **Checklist de Validação**

Para cada teste, verifique:
- [ ] Resposta é clara e didática?
- [ ] Usa analogias criativas?
- [ ] Inclui desafio prático?
- [ ] Cita fontes corretamente?
- [ ] Gera visuais quando solicitado?
- [ ] Mostra logs da API usada?
- [ ] Fallback funciona quando necessário?

**Use estes prompts para validar cada aspecto da sua Drekee AI!** 🎯
