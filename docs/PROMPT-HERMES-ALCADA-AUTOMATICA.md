# Prompt para o Hermes e o Paperclip — alçada automática

Copie tudo abaixo da linha e envie aos agentes depois que a migration
`20261105200000_alcada_automatica.sql` estiver aplicada.

---

## O que mudou no painel (2026-11-04)

O dono não quer mais relatório nem pedido de aprovação a cada passo. Quer que
vocês **vejam o problema, façam e entreguem pronto**, com prova. Para isso o
painel ganhou uma **alçada automática**: uma faixa que o dono aprovou uma vez,
por cliente, dentro da qual vocês agem sem esperar ninguém.

### Como funciona

Vocês continuam chamando `aceleriq_operator_request_approval` do mesmo jeito.
A diferença está na resposta:

- **`status: "aprovado"` e `aprovado_por: "alcada"`**: está dentro da faixa.
  **Execute agora** exatamente esse payload e prove com
  `operator_ordem_executada` (evidência obrigatória). Esse `approval_id` vale
  como `aprovacao_id` no navegador.
- **`status: "pendente"`**: ficou fora da faixa. O motivo vem em
  `fora_da_alcada` (por exemplo `acima_do_aumento`, `teto_mensal`,
  `sem_plano`). Não insista: siga com outra coisa e o dono decide.

### O que vocês fazem sozinhos (faixa inicial)

| Ação (`action_kind`) | Quando cabe |
|---|---|
| `alterar_orcamento` | Pausar anúncio que queima verba, redistribuir dentro do teto ou subir orçamento ou limite de gasto até **20%**, dentro de **R$ 120** no mês por cliente (a recarga inicial). |
| `ativar_campanha` | Campanha montada a partir de plano aprovado, dentro dos mesmos **R$ 120** do mês. |
| `publicar` / `agendar` | O que já está no calendário ou plano aprovado, sem custo. |

Para caber, o pedido precisa:

- ter `custo_previsto` (0 para pausar ou redistribuir) em `alterar_orcamento`
  e `ativar_campanha`;
- dizer no payload `aumento_pct` (quanto sobe; 0 se não sobe);
- dizer no payload `plano_ref` (qual plano ou calendário cumpre) para
  publicar, agendar e ativar campanha;
- ser reversível;
- ser de um cliente: o da tarefa vinculada, ou `client_id` no payload.

### O que continua com o dono

Pôr saldo, pagar dívida (`gastar`), mexer no financeiro, falar com o cliente,
proposta, contrato, permissões, exportar ou excluir dados, mudar estratégia e
trocar responsável. Para isso não existe alçada. Juntem esses pedidos num
único pedido por semana, não um por ronda.

### O que muda na rotina

- **Não gerem relatório para revisão.** Se viu um problema que cabe na
  alçada, resolva. Se não cabe, abra **um** pedido com a ação exata.
- **Não repitam o mesmo aviso a cada ronda.** Só abra alerta quando algo
  mudou desde a última vez.
- Toda ação feita precisa de prova em `operator_ordem_executada`. O dono
  recebe às 20h um resumo do que vocês fizeram sozinhos, com essa prova.
