# Comercial: classe, qualificação e a meta de recorrentes

**Status: ready · Visibilidade: internal** (documento de dentro de casa; nada
aqui é visível a cliente).

Data: 2026-08-25. Escopo: apenas a área comercial. Nenhum outro módulo do
painel foi tocado; nenhum valor de cliente atual foi alterado; nenhum registro
foi criado ou preenchido em massa.

## O que mudou

### 1. Toda oportunidade tem uma classe (ou diz que não tem)

Cada lead do funil agora carrega uma de exatamente três classes:

| Classe | Significado |
| --- | --- |
| Cliente atual | Negócio novo com quem já é cliente da casa |
| Upsell | Ampliar o que um cliente atual já contrata |
| Novo prospect | Nunca comprou. É daqui que a meta de recorrentes sai |

Vazio significa **não confirmado** — nunca "zero" nem "não existe". Nenhuma
classe foi preenchida por backfill: classe chutada em massa parece resposta e
mente melhor que o campo em branco. O funil ganhou filtros por classe, e o
chip "Sem classe" mostra o que ainda precisa ser confirmado.

### 2. Qualificação com os campos do método

No editor do lead, uma seção de qualificação com sete campos, todos com a
mesma regra do vazio = não confirmado: aderência ao ICP, problema
identificado, orçamento, autoridade, urgência, potencial de recorrência e
aprovação necessária. Etapa atual, responsável único, próxima ação, prazo e
origem já existiam no funil e continuam onde estavam.

### 3. Metrificação por etapa

Cada coluna do funil mostra `qualificadas/total`. Qualificada = classe
confirmada + dono único + próximo passo agendado. É a régua que separa
oportunidade de verdade de nome numa lista.

### 4. Meta de clientes recorrentes, editável e lida do Financeiro

Nova métrica em Metas: **Clientes recorrentes ativos**. O alvo é editável
como as demais (é ali que entra a meta de 5 recorrentes de R$2.000 a
R$3.000/mês). O realizado é lido do Financeiro central: clientes distintos
com mensalidade gerada por regra de recorrência, competência no mês e não
cancelada. O funil não opina nesse número — vale quem o Financeiro cobrou de
verdade.

## O que NÃO mudou (de propósito)

- Prospects novos não se misturam com tarefas de entrega: o funil comercial
  (`commercial_leads`) segue separado do Kanban de projetos (`tasks`).
- Nenhum valor de cliente atual foi alterado.
- Nenhuma tarefa foi criada ou editada para melhorar número.
- O painel segue sendo base operacional com ajuste, não funil completo
  confiável para conversão da meta.

## Regra de aprovação

Qualquer mensagem, proposta, contrato, anúncio ou gasto exige aprovação
específica do dono antes de sair. Nada disso é disparado automaticamente pelo
painel; a classe e a qualificação são leitura e organização, não gatilho.

Responsável comercial: Mercúrio. Separação operacional: Augusto e Atlas.
Ativos internos: Helena.

## Base técnica

- Migration `20260825120000_comercial_classe_qualificacao.sql`: duas colunas
  em `commercial_leads` (`classe` com check das três classes; `qualificacao`
  jsonb). Idempotente, sem UPDATE e sem INSERT.
- Réguas protegidas por teste em `src/test/comercial-classes.test.ts`:
  exatamente três classes, vazio como não confirmado, migration sem backfill,
  realizado de recorrentes vindo do Financeiro.
