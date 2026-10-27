# Economia unitária do Aceleriq de Bolso

Análise de 27/10/2026. Estudo financeiro, sem alteração de preços, concessões, pagamentos ou produção.

## Decisão sugerida

**Os preços aprovados deixam espaço para margem no consumo observado. Não há motivo demonstrado para reduzi-los.** O anual de R$ 97, com 100 créditos iniciais, pode funcionar como entrada; as recargas financiam o uso adicional. O maior cuidado é custo de aquisição e atendimento humano. A recarga de 350 é a mais sensível a aumentos do custo de imagem.

Não é possível afirmar lucro líquido nem uma margem “esperada” estatística a partir de apenas um texto e uma imagem. Os valores abaixo são projeções condicionais. Não incluem conversão, recompra, renovação ou clientes que deixam créditos sem usar como receitas presumidas.

Recomendação inicial: manter os preços aprovados, preservar os 100 créditos como **pacote inicial único, não mensal**, usar R$ 30 como teto experimental de CAC no cenário indicado e validar custos com uma amostra maior antes de escalar. Nenhum desses parâmetros foi alterado na aplicação por este estudo.

## Entradas e origem

| Entrada | Valor | Natureza |
| --- | --- | --- |
| Acesso anual | R$ 97 + 100 créditos iniciais | Aprovado pelo dono nesta conversa |
| Recarga pequena | 50 créditos por R$ 19 | Aprovado pelo dono |
| Recarga intermediária | 150 créditos por R$ 49 | Aprovado pelo dono |
| Recarga maior | 350 créditos por R$ 97 | Aprovado pelo dono |
| Texto / imagem | 1 / 5 créditos por geração | Aprovado pelo dono |
| Texto concluído | US$ 0,000681 | Custo observado informado pelo agente principal; uma chamada |
| Imagem concluída | US$ 0,067599 | Custo observado informado pelo agente principal; uma imagem |
| Provisão operacional | R$ 0,14 por crédito | Sugestão de planejamento, não custo medido |
| Câmbio efetivo | R$ 5, R$ 6 e R$ 7 por US$ | Hipóteses, **não cotações** |
| OpenRouter Standard | 5,5% na compra de créditos | Fonte primária consultada em 27/10/2026 |

O OpenRouter informa cobrança da inferência conforme o modelo e taxa Standard na compra dos créditos; Business tem condição diferente. Este estudo usa Standard como hipótese e distribui a taxa sobre o consumo. [Preços oficiais](https://openrouter.ai/pricing).

Para compras não cripto, a publicação oficial informa taxa mínima de US$ 0,80 por recarga do fornecedor. O cálculo usa compra operacional hipotética de US$ 100, cuja taxa de 5,5% supera o mínimo; isso não é a recarga vendida ao cliente. Compras de US$ 10 teriam taxa efetiva de 8%, e compras de US$ 5 teriam 16%, pelas mesmas regras. [Regra oficial da taxa](https://openrouter.ai/blog/announcements/simplifying-our-platform-fee/).

As rotas permitidas no código são `openai/gpt-4.1-mini` e `google/gemini-3.1-flash-image`. A consulta pública do catálogo confirmou ambas em 27/10/2026. A análise usa o custo observado total da chamada, **não presume preço fixo por imagem nem interpreta um campo por token como preço por arquivo**. Fontes: [catálogo do texto](https://openrouter.ai/api/v1/model/openai/gpt-4.1-mini), [catálogo da imagem](https://openrouter.ai/api/v1/model/google/gemini-3.1-flash-image), [contrato dos preços do catálogo](https://openrouter.ai/docs/guides/overview/models).

## Margem após IA, consumindo tudo em imagens

É a composição mais cara entre texto e imagem **aos custos medidos por crédito**. Não é um pior caso absoluto: imagens maiores, mudanças de modelo/preço, falhas depois de a resposta ser cobrada e retrabalho podem custar mais. O estúdio pode reaproveitar texto já pronto; por isso o cenário dedica todos os créditos ao item mais caro. Não se presume que uma geração necessariamente resulte em uma arte aprovada ou em venda.

Hipóteses desta tabela: 100% dos créditos consumidos, câmbio efetivo R$ 7, custo por geração igual ao observado e 5,5% rateado da compra de créditos OpenRouter.

| Oferta | Receita por compra | Imagens equivalentes | Custo de IA | Sobra após IA | Margem após IA |
| --- | ---: | ---: | ---: | ---: | ---: |
| Anual | R$ 97,00 | 20 | R$ 9,98 | R$ 87,02 | 89,71% |
| Recarga 50 | R$ 19,00 | 10 | R$ 4,99 | R$ 14,01 | 73,73% |
| Recarga 150 | R$ 49,00 | 30 | R$ 14,98 | R$ 34,02 | 69,44% |
| Recarga 350 | R$ 97,00 | 70 | R$ 34,95 | R$ 62,05 | 63,97% |

“Sobra após IA” ainda precisa pagar checkout, impostos, perdas, suporte, infraestrutura, aquisição e despesas gerais; não é lucro líquido nem uma demonstração contábil de lucro bruto.

Sensibilidade do custo de IA à hipótese cambial, mantendo todo o restante igual:

| R$/US$ hipotético | Anual 100 | Recarga 50 | Recarga 150 | Recarga 350 |
| ---: | ---: | ---: | ---: | ---: |
| 5 | R$ 7,13 | R$ 3,57 | R$ 10,70 | R$ 24,96 |
| 6 | R$ 8,56 | R$ 4,28 | R$ 12,84 | R$ 29,95 |
| 7 | R$ 9,98 | R$ 4,99 | R$ 14,98 | R$ 34,95 |

## Mistura de texto e imagem

No anual, com 100% de uso e câmbio hipotético R$ 6:

| Créditos dedicados à imagem | Textos | Imagens | Custo de IA, incluindo taxa OR |
| ---: | ---: | ---: | ---: |
| 0% | 100 | 0 | R$ 0,43 |
| 50% | 50 | 10 | R$ 4,49 |
| 80% | 20 | 16 | R$ 6,93 |
| 100% | 0 | 20 | R$ 8,56 |

Um texto consome 1 crédito, uma imagem 5. A composição 80% não significa 80% das chamadas; significa 80 créditos em 16 imagens e 20 créditos em 20 textos. Uso menor gera custo menor, mas o orçamento deve conseguir atender todo o pacote prometido.

## Contribuição e limite de aquisição

Para tornar a comparação reproduzível, os cenários abaixo adicionam **hipóteses**, que precisam ser substituídas pelos contratos e custos reais:

- Checkout: 4,99% da venda + R$ 0,50 por pedido. Não é tarifa de um provedor escolhido; parcelamento, antecipação e cobrança por parcela ainda não estão definidos.
- Tributos sobre venda: 6%. É hipótese de simulação, não enquadramento tributário ou alíquota recomendada.
- Perdas/refundos: reserva simplificada de 2% da receita. Não modela todos os efeitos possíveis de chargeback, imposto devolvido ou tarifa retida.
- Suporte anual: R$ 12 por cliente no ano; infraestrutura alocada: R$ 3 por cliente no ano. Valores ilustrativos de um produto de autoatendimento, não medição de operação.
- Por recarga: suporte incremental de R$ 1,50 e infraestrutura de R$ 0,50. Não cobrar aqui de novo todo o custo de aquisição original: as recargas supõem cliente já adquirido e CAC incremental zero.
- CAC ilustrativo do anual: R$ 30. Não há campanha, taxa de conversão ou CAC real medidos neste estudo.

| Oferta | Contribuição antes de CAC, usando custo observado | Limite antes de CAC, reservando toda a provisão | CAC do cenário | Contribuição após CAC, usando custo observado |
| --- | ---: | ---: | ---: | ---: |
| Anual | R$ 58,92 | R$ 54,90 | R$ 30,00 | R$ 28,92 |
| Recarga 50 | R$ 9,04 | R$ 7,03 | R$ 0,00 | R$ 9,04 |
| Recarga 150 | R$ 25,16 | R$ 19,13 | R$ 0,00 | R$ 25,16 |
| Recarga 350 | R$ 46,95 | R$ 32,90 | R$ 0,00 | R$ 46,95 |

Para o anual, **CAC de equilíbrio = R$ 58,92** neste cenário. Esse valor deixa contribuição zero após as despesas incluídas; não é meta de aquisição. Reservando R$ 14 integralmente para IA, o teto de caixa disponível para CAC cai a **R$ 54,90**. Para preservar 25% da receita, o CAC máximo seria R$ 34,67 usando o custo observado ou **R$ 30,65 usando a provisão integral**. Por isso R$ 30 é um teto de teste mais prudente que R$ 55–59.

A provisão **substitui** o custo de IA no segundo cálculo. Somar provisão e consumo como duas despesas descontaria a mesma verba duas vezes. Se o consumo ultrapassar a provisão, considerar o custo maior; a reserva sozinha não protege o caixa.

No cenário de custo observado e CAC de R$ 30, o anual deixa **R$ 28,92 de contribuição (29,8%)**. Usando toda a provisão, deixa **R$ 24,90 (25,7%)**. Ainda falta absorver qualquer despesa fixa não contemplada nos R$ 3, desenvolvimento, salários, comissões e outras obrigações reais. Por isso não se chama lucro líquido.

## Provisão e estresse

Provisões sugeridas: anual R$ 14; recargas R$ 7, R$ 21 e R$ 49. Com a hipótese cambial R$ 7 e taxa de compra 5,5%, R$ 0,14 por crédito de imagem cobre até aproximadamente **US$ 0,094787 por imagem** de 5 créditos. É cerca de 40% acima da imagem medida, sem adicionais não modelados. Não é um teto garantido pelo fornecedor.

No anual, com todos os créditos em imagem, câmbio R$ 7 e CAC R$ 30:

| Multiplicador do custo observado | Custo IA | Folga da provisão de R$ 14 | Contribuição após CAC e despesas hipotéticas |
| ---: | ---: | ---: | ---: |
| 1× | R$ 9,98 | R$ 4,02 | R$ 28,92 |
| 1.5× | R$ 14,98 | R$ -0,98 | R$ 23,92 |
| 2× | R$ 19,97 | R$ -5,97 | R$ 18,93 |

Com custo de IA dobrado, a recarga de 350 deixa cerca de **R$ 12,01 (12,4%)** de contribuição antes de CAC incremental, nas mesmas hipóteses. Para 20% de contribuição nesse estresse, precisaria aproximadamente R$ 109; para 25%, aproximadamente R$ 117 (R$ 119 seria uma opção comercial). **É uma contingência para avaliar, não uma mudança recomendada automática com uma única observação.** Alternativas são reduzir a quantidade futura, aumentar a tarifa de crédito da imagem ou restringir opções mais caras, sempre com aprovação e sem alterar compras já realizadas.

O risco operacional também importa: se o suporte anual subir de R$ 12 para R$ 40, mantendo CAC R$ 30, a contribuição anual cai de R$ 28,92 para apenas R$ 0,92. Prometer agência humana por R$ 97/ano mudaria completamente esta conta.

**100 créditos mensais seriam outro produto.** Doze pacotes de 100 permitiriam 240 imagens; somente a IA custaria aproximadamente R$ 119,81 no cenário R$ 7, antes das demais despesas, acima da receita anual de R$ 97. Deixar explícito “100 créditos iniciais” em toda a oferta e no painel.

## Fórmulas

```text
creditos_usados = piso(creditos_do_pacote × percentual_de_uso)
imagens = piso(creditos_usados × fracao_destinada_a_imagem / 5)
textos = creditos_usados − 5 × imagens
fee_OR_efetivo = max(0,055; 0,80 / valor_da_recarga_OR_em_USD)
IA_BRL = (textos × 0,000681 + imagens × 0,067599)
         × cambio_efetivo × (1 + fee_OR_efetivo) × multiplicador_de_custo
checkout = preco × taxa_percentual + taxa_fixa
contribuicao_antes_CAC = preco − IA_BRL − checkout − tributos
                        − reserva_perdas − suporte − infraestrutura_alocada
CAC_equilibrio = contribuicao_antes_CAC
contribuicao_apos_CAC = contribuicao_antes_CAC − CAC
CAC_max_para_margem_alvo = contribuicao_antes_CAC − preco × margem_alvo
```

O câmbio efetivo deve incluir spread e encargos cambiais conhecidos. O multiplicador serve para simular custo maior, inclusive retrabalho pago; não é uma frequência medida. Os cenários não assumem renovação anual, recompra de créditos ou breakage. Faturamento recebido agora não significa sobra livre: há obrigação de acesso por 12 meses e créditos ainda utilizáveis.

## Próximo passo de medição

Manter preços e cotas aprovados, coletar custo por texto/imagem por formato e tamanho, registrar gasto mesmo quando a validação/armazenamento falhar depois da geração, reconciliar fatura e taxa de compra do fornecedor e acompanhar custo de suporte. Usar distribuição observada (p50/p95/p99), não só uma média. Medir CAC pago e retenção antes de aumentar orçamento. Escolher checkout e condições de parcelamento antes de substituir as hipóteses por preço efetivo. Não presumir vendas ou lucratividade porque o motor gerou uma peça.

Artefatos locais: `outputs/bolso-economia/premissas.json`, `cenarios.csv` (144 combinações) e `simulador.html` na pasta do trabalho Codex. O simulador funciona localmente, sem API, pagamentos, rastreamento ou alteração do painel.
