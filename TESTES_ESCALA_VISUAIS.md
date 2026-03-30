# Testes em Escala de Confiabilidade Visual

Arquivo base da bateria:
`tests/drekee-scale-test-battery.json`

## Objetivo

Verificar, em escala, se o Drekee:
- so mostra grafico quando os dados passam na validacao;
- so mostra mapa mental quando os ramos passam na auditoria semantica;
- exibe aviso claro quando um visual e removido por seguranca.

## Dominios cobertos

- IBGE
- Clima
- Saude
- Energia
- Astronomia
- Series historicas
- Comparacao entre paises
- Temas conceituais

## O que conferir em cada teste

- fidelidade das fontes e dos numeros;
- unidade e rotulo tecnico corretos;
- ausencia de zeros artificiais;
- tratamento correto de dados ausentes;
- template visual correto: linha, barras, composicao ou mapa mental radial;
- ausencia de causalidade inventada;
- ausencia de simplificacao excessiva em temas sensiveis;
- aviso claro quando o visual for removido.

## Uso sugerido

1. Rode os prompts do arquivo JSON por dominio.
2. Registre se houve visual, aviso de fallback e confianca final.
3. Marque qualquer caso em que o visual contradiga o texto ou a fonte.
4. Reaplique os testes depois de cada ajuste relevante no backend.
