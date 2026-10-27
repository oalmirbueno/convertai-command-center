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
- `geracao_real`: só liga com política comercial aprovada. Ainda exige no servidor `BOLSO_OPENAI_HABILITADO=sim`, `BOLSO_OPENAI_API_KEY` e modelos da lista em `regras.ts`. **O adaptador nunca foi chamado de verdade (sem gasto); contrato, custo e qualidade não validados.**
- `pagamentos`: sem ela, `bolso_evento_pagamento` só guarda o evento. Não há webhook ligado; Kiwify e Asaas continuam desligados.
- `kill_switch`: pausa pedidos novos na hora. Consulta, histórico e download continuam.
- `limites`: paralelo por pessoa, pedidos por dia por pessoa e teto global do dia. Sem os três, nenhum pedido passa.

## Créditos

Extrato só de inclusão (`bolso_creditos`): concessão, reserva, captura, liberação, estorno e expiração, cada um ligado a um direito. Saldo = soma; ninguém grava saldo. O pedido reserva antes de enfileirar, com trava por pessoa; a mesma chave com o mesmo pedido devolve o mesmo job, com outro pedido é recusada. Sucesso captura uma vez; falha definitiva ou cancelamento libera uma vez. Resposta atrasada do trabalhador é ignorada. Fornecedor real sem resposta vira **incerto**: não repete nem devolve sozinho; a administração confere e decide (Não houve entrega / Tentar de novo).

## Pausar e reverter

- Pausar: Administrar → Aceleriq de Bolso → Pausar o estúdio (ou desligar "Estúdio visível").
- Tirar do ar sem apagar histórico financeiro: revogar `EXECUTE` das funções `bolso_*`. As tabelas ficam.
- Biblioteca, CRM e licenças antigas não dependem de nada do Bolso.

## Decisões pendentes do dono

Preço (R$ 97 é hipótese), créditos iniciais, tarifas de texto e arte, validade, formatos, suporte, recarga e mensal (preço, cota, sobra), regra do anual vencendo no meio de um mensal pago, retenção e exclusão, termos e reembolso, orçamento e modelo da OpenAI, destino comercial de "Conhecer serviços da agência" e autorização de homologação.
