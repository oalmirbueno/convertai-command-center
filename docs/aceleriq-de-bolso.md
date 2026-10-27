# Aceleriq de Bolso: operação

Estúdio de campanhas em autoatendimento dentro da área de membros (`/membros`, seções Estúdio e Créditos e acesso; administração em `/membros/administrar` → Aceleriq de Bolso). "Sua agência de marketing digital de bolso: você cria, revisa e publica." Não é agência humana, não faz gestão de anúncios e não garante vendas.

**Estado padrão: tudo desligado.** Não está pronto para venda.

## Peças

| Peça | Onde |
|---|---|
| Banco (tabelas `bolso_*`, funções, bucket privado `bolso`) | `supabase/migrations/20261027120000_aceleriq_de_bolso.sql` |
| Trabalhador (fornecedor simulado e adaptador OpenAI desligado) | `supabase/functions/bolso/` |
| Telas | `src/components/membros/bolso/` (`EstudioBolso`, `CreditosBolso`, `AdminBolso`) |
| Regras da tela e chamadas | `src/lib/bolso/` |
| Cenários de banco (transação abortada, nada fica gravado) | `supabase/testes/bolso_cenarios.sql` + `node scripts/bolso-testar-banco.mjs` |

## Chaves (em `bolso_config`, só administração muda, tudo auditado em `bolso_auditoria`)

- `modulo_exposto`: o estúdio aparece aos membros. Desligado, só a administração vê.
- `modo_simulado`: provedor simulado para admin e contas com crédito de teste. A faixa "DEMONSTRAÇÃO / PROVEDOR SIMULADO" fica fixa na tela. Créditos de teste ficam numa carteira separada.
- `geracao_real`: só liga com política comercial aprovada. Ainda exige no servidor `BOLSO_OPENAI_HABILITADO=sim` e os modelos explícitos da lista em `regras.ts`. Credencial: `BOLSO_OPENAI_API_KEY` tem prioridade; se estiver vazia, usa `OPENAI_API_KEY` já configurada no servidor. Nenhuma credencial é lida com o gate dedicado desligado. **A implementação e os testes isolados não comprovam geração real, custo faturado ou qualidade.**
- `pagamentos`: sem ela, `bolso_evento_pagamento` só guarda o evento. Não há webhook ligado; Kiwify e Asaas continuam desligados.
- `kill_switch`: pausa pedidos novos na hora. Consulta, histórico e download continuam.
- `limites`: paralelo por pessoa, pedidos por dia por pessoa e teto global do dia. Sem os três, nenhum pedido passa.

## Créditos

Extrato só de inclusão (`bolso_creditos`): concessão, reserva, captura, liberação, estorno e expiração, cada um ligado a um direito. Saldo = soma; ninguém grava saldo. O pedido reserva antes de enfileirar, com trava por pessoa; a mesma chave com o mesmo pedido devolve o mesmo job, com outro pedido é recusada. Sucesso captura uma vez; falha definitiva ou cancelamento libera uma vez. Resposta atrasada do trabalhador é ignorada. Fornecedor real sem resposta vira **incerto**: não repete nem devolve sozinho; a administração confere e decide (Não houve entrega / Tentar de novo).

## Pausar e reverter

- Pausar: Administrar → Aceleriq de Bolso → Pausar o estúdio (ou desligar "Estúdio visível").
- Tirar do ar sem apagar histórico financeiro: revogar `EXECUTE` das funções `bolso_*`. As tabelas ficam.
- Biblioteca, CRM e licenças antigas não dependem de nada do Bolso.

## Oferta aprovada e próxima etapa

Almir aprovou **R$ 97 por ano**, com possibilidade de parcelamento no cartão. Na landing, R$ 8,08 é apenas a equivalência mensal do anual dividido por 12, não o valor de uma parcela. Checkout continua para depois; número de parcelas e juros não foram definidos. Esta aprovação não liga pagamentos, geração real ou créditos automaticamente.

Em 27/10/2026, o estúdio passou a consumir o núcleo criativo puro compartilhado com a Mesa Ads, mantendo seus próprios dados, autorizações, créditos e adaptadores. A interface foi refinada e a arte passou a receber headline e CTA exatos da versão escolhida. Escopo, pesquisa, validação e limites estão em [BOLSO-MOTOR-CRIATIVO.md](membros/BOLSO-MOTOR-CRIATIVO.md). Essa evolução de código não confirma publicação nem homologação do fornecedor.

## Homologação real limitada

Almir autorizou testar **um texto e uma imagem na própria conta**, mantendo pagamentos para depois. O código aceita `BOLSO_OPENAI_MODELO_TEXTO=gpt-4.1-mini` e `BOLSO_OPENAI_MODELO_IMAGEM=gpt-image-2`. O modelo anterior `gpt-image-1`, encerrado em 23/10/2026, é recusado. O texto mantém saída JSON e máximo de 1200 tokens. A imagem usa uma saída, qualidade `medium`, PNG opaco; o teste usa `feed_1x1` em 1024 × 1024. Fontes oficiais: [descontinuações](https://developers.openai.com/api/docs/deprecations), [modelos e custos de imagem](https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency) e [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini).

Com cerca de 2000 tokens de entrada, a previsão do texto é US$ 0,00272 (saída máxima, sem cache) e a da imagem é aproximadamente US$ 0,063. São estimativas, não limites de cobrança. Para esse teste: concorrência 1, teto por pessoa 2 e teto global 2 pedidos em 24 horas, após conferir que a fila e a janela estão vazias; conceder somente os créditos necessários ao titular. Esses limites contam pedidos, não dólares. Uma tentativa que falhe também ocupa a cota diária.

Nas conclusões com `usage` válido, `bolso_custos_fornecedor` recebe uma **estimativa baseada nos tokens efetivamente informados e nos preços Standard verificados em 27/10/2026**, arredondada a seis casas. Uso ausente ou incoerente mantém a entrega sem inventar custo zero. A tabela não guarda os tokens originais nem comprova a fatura. Falhas após o processamento (validação, armazenamento ou conclusão) podem gerar gasto no fornecedor sem registro nessa tabela; exigem conciliação externa. Créditos comerciais continuam regidos pela política e pelo extrato, não por essa estimativa.

Executar um `processar` para cada pedido, em sequência. Evitar `processar_fila` na homologação: o laço pode repetir falhas 429/5xx da fila até o limite existente de tentativas. O polling da tela só consulta o estado; um timeout real só muda para `incerto` quando `bolso_trabalho_pegar` for chamado novamente após o lease de 150 segundos. Conferir o fornecedor antes de reenfileirar. O encerramento de um pedido incerto e a liberação de créditos continuam sendo decisões da administração.

Limitação de formato: o download entrega os pixels originais. Os formatos verticais ainda geram 1024 × 1536 e precisam de exportação na proporção anunciada antes de liberação comercial. Para a homologação inicial, a política deve permitir somente `feed_1x1`.

## Decisões pendentes do dono

Créditos comerciais, tarifas de texto e arte para clientes, validade, formatos além do quadrado previsto no teste, suporte, recarga e mensal (preço, cota, sobra), regra do anual vencendo no meio de um mensal pago, retenção e exclusão, termos e reembolso, orçamento de operação comercial, destino comercial de "Conhecer serviços da agência" e condições de parcelamento. A autorização do teste limitado não define esses termos comerciais.
