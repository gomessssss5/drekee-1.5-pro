# Configuração das APIs de IA - Novo Fluxo

## 🔄 **Arquitetura Atualizada**

### **1. GROQ (Principal com Fallback SambaNova)**
- **Modelo**: `llama-3.3-70b-versatile` (70B)
- **Função**: Raciocínio principal e síntese final
- **Chaves**: `GROQ_API_KEY_1` (primária), `GROQ_API_KEY_2` (secundária)
- **Fallback**: `SAMBA_API_KEY` com `Meta-Llama-3.3-70B-Instruct`

### **2. GROQ Agent (Planejamento com Fallback SambaNova)**
- **Modelo**: `llama-3.1-8b-instant` (8B)
- **Função**: Gerar plano de ação (`generateActionPlan`)
- **Chave**: `GROQ_AGENT_API_KEY`
- **Fallback**: `SAMBA_API_KEY` com `Meta-Llama-3.1-8B-Instruct`

### **3. GROQ Agent (Recuperação com Fallback SambaNova)**
- **Modelo**: `llama-3.1-8b-instant` (8B)
- **Função**: `buildRecoveryPlanWithGroqAgent`
- **Chave**: `GROQ_AGENT_API_KEY`
- **Fallback**: `SAMBA_API_KEY` com `Meta-Llama-3.1-8B-Instruct`

### **4. SambaNova Vision (Principal)**
- **Modelo**: `Llama-4-Maverick-17B-128E-Instruct`
- **Função**: `analyzeUserFilesWithSambaNova`
- **Chave**: `SAMBA_API_KEY`
- **Limite**: Até 5 imagens
- **Fallback**: `Gemini 2.0 Flash` (se falhar)

### **5. Gemini (Validação)**
- **Modelo**: `gemini-2.0-flash`
- **Função**: `auditResponseWithGemini`
- **Chaves**: `GEMINI_API_KEY`, `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`
- **Fallback**: `GROQ_API_KEY_2`

### **6. GROQ (Análise de Imagens NASA)**
- **Modelo**: `llama-3.3-70b-versatile`
- **Função**: `analyzeNasaImagesWithGroq`
- **Chave**: `GROQ_API_KEY_2`
- **Uso**: Analisa as 4 primeiras imagens retornadas pela NASA

---

## 📊 **Tabela de Fallbacks**

| Função Principal | API/Modelo Principal | Fallback Principal | Modelo Fallback |
|-----------------|---------------------|-------------------|-----------------|
| Planejamento | GROQ (8B) | SambaNova | Meta-Llama-3.1-8B-Instruct |
| Raciocínio | GROQ (70B) | SambaNova | Meta-Llama-3.3-70B-Instruct |
| Síntese | GROQ (70B) | SambaNova | Meta-Llama-3.3-70B-Instruct |
| Recuperação | GROQ (8B) | SambaNova | Meta-Llama-3.1-8B-Instruct |
| Visão | SambaNova (17B) | Gemini | gemini-2.0-flash |
| Validação | Gemini | GROQ | llama-3.3-70b-versatile |

---

## 🔥 **Logs para Identificar Uso da SambaNova**

Quando a SambaNova for utilizada, você verá:
- `🔥 SambaNova (Meta-Llama-3.3-70B-Instruct) utilizada com sucesso`
- `🔥 SambaNova (Llama-4-Maverick-17B-128E-Instruct) utilizada com sucesso`
- `🔥 SambaNova (Meta-Llama-3.1-8B-Instruct) utilizada com sucesso`

---

## ✅ **Configuração Necessária**

Adicione ao seu `.env`:
```
SAMBA_API_KEY=sua_chave_aqui
```

As chaves GROQ e Gemini existentes continuam funcionando como backup.

---

## 🧪 **Como Testar**

1. **Teste normal**: Use qualquer pergunta científica
2. **Teste com imagens**: Envie até 5 imagens
3. **Monitore os logs**: Veja quando `🔥 SambaNova` aparece

O sistema usará GROQ por padrão, mas fallback automático para SambaNova em caso de falha!



o card do Agente científico em execução
ainda não fechou quando a resposta da IA tava completamente pronta. outra: a fileira de imagens ficou melhor arrumada, mas, ainda há mudanças. 1: o card das fontes tá do lado das imagens. não pode! deve ser o card das imagens em cima (centralizado, nem pra esquerda nem pra direita, sem legenda as imagens e um pouquinho maiores), ok? e sem enhuma borda. 

e o gráfico tá sendo aplicado na resposta da IA sem necessidade. em algumas vezes, claro. ele tá sendo usado em respostas que não precisava dele, sabe?

e tem uma imagem da esa q n foi carregada, retire ela de uso