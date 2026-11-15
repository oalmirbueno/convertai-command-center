---
name: clio-conversas-dos-grupos
description: "Use na rotina diária da Clio: transformar a fila de pedidos e pendências das conversas dos grupos de WhatsApp em tarefas internas do painel, sem duplicar, e registrar no cérebro do cliente o que ele ensinou."
version: 1.0.0
---

# Clio — das conversas dos grupos para tarefas internas

## De onde vem a fila
O n8n lê os 12 grupos de clientes pelo número 41 9748-3429 (só leitura), transcreve os áudios e, às 11h30, 15h30 e 20h30, escreve ou atualiza o resumo do dia de cada cliente (um modelo escreve e o Jev confere cada afirmação contra as mensagens). O resumo vai para o dossiê do cliente, na seção "Conversas do grupo de WhatsApp".

A sua rotina roda às 11h45, 15h45 e 20h45. Antes de você acordar, um script busca a fila no n8n e coloca no seu pedido um bloco `FILA DA CLIO` em JSON. Sem fila, você nem é chamada.

Cada cliente da fila traz:
- `client_id` e `cliente`;
- `resumos`: o texto do resumo do dia, para você entender o contexto;
- `projetos`: os projetos ativos ou em planejamento do cliente, com `project_id`, nome, status e tipo;
- `tarefas_abertas`: até 60 tarefas ainda não concluídas do cliente (título, status, prazo, dono e projeto), das mais recentes para as mais antigas;
- `itens`: cada um com `origem_externa` (use exatamente como veio), `dia`, `tipo`, `texto`, `veio_de_audio` e `pode_ser_repeticao`.

Tipos de item:
- `pedido_cliente`: o cliente pediu que a agência faça, envie, mude ou produza algo.
- `pendencia_agencia`: a agência prometeu algo e ainda não entregou.
- `pendencia_cliente`: a agência espera resposta, aprovação ou material do cliente.

A fila só traz o que ainda não tem tarefa. Quem dá baixa é o banco: o item some da fila quando existe uma tarefa do mesmo cliente com a `origem_externa` dele ou com `grupo:<chave>` escrito na descrição. Cada item é entregue no máximo duas vezes.

## Passo a passo, cliente por cliente
1. Leia os `resumos` e os `itens` do cliente.
2. Veja em `tarefas_abertas` o que já está aberto. Essa lista já vem na fila: NÃO chame o painel para listar tarefas nem para ler o dossiê inteiro, porque a resposta é grande demais e você fica sem conseguir ler.
3. Escolha em `projetos` o projeto com status `active` onde a tarefa cabe. Regra: tarefa de conteúdo, post, vídeo ou anúncio vai no projeto recorrente de marketing do cliente; tarefa de site, marca ou outro trabalho avulso vai no projeto daquele trabalho. Projeto em `planning` não serve, com uma exceção autorizada pelo Almir em 11/11/2026: a Casa dos Assados, enquanto não tiver projeto ativo, recebe as tarefas no projeto em `planning` que ela tem; diga no relato que abriu no projeto em planejamento. Para os outros clientes, se não houver projeto ativo que sirva, não crie: diga isso no relato.
4. Decida item por item, pelas regras abaixo.
5. Crie as tarefas com `aceleriq_create_task`.
6. Se o cliente ensinou algo duradouro, registre com `aceleriq_cerebro_registrar` (regras mais abaixo).

## Regras para abrir tarefa
- **Pedido do cliente:** uma tarefa por pedido. Se já existe tarefa aberta sobre o mesmo assunto, não crie outra.
- **Quando uma tarefa aberta "cobre" o item:** só quando o título dela fala do mesmo pedido específico (o mesmo ajuste, a mesma peça, o mesmo material). Tarefa genérica da mesma área ("Estruturar o plano de anúncios", "Preparar 4 posts", "Stories: vagas da semana") NÃO cobre um pedido novo e específico do cliente (mudar o raio da mídia, incluir duas promoções na Black, divulgar a vaga enviada hoje). Na dúvida, ABRA a tarefa e escreva na descrição "Pode ter relação com a tarefa: <título>". Pedido de cliente sem tarefa é pior do que uma tarefa a mais.
- **Promessa nossa (pendencia_agencia):** junte as promessas do mesmo assunto numa tarefa só. Se o resumo mostra que já foi feito, ou se já existe tarefa aberta que cobre, não crie.
- **Resposta que esperamos do cliente (pendencia_cliente):** no máximo UMA tarefa por cliente por rodada, com o título "Cobrar retorno de <cliente>: <assunto principal>", listando na descrição tudo o que falta ele responder. Essa tarefa é um lembrete para a equipe; você não cobra o cliente.
- **Teto:** no máximo 3 tarefas novas por cliente por rodada. O que passar disso entra na descrição da tarefa mais próxima ou vai para o relato como "ficou de fora".
- **`pode_ser_repeticao: true`:** o resumo do dia foi reescrito ou o item já veio antes. Só crie se, depois de ler as tarefas abertas, tiver certeza de que não existe nada igual.
- **Item que você juntou em outra tarefa:** escreva na descrição dela a linha `Ref: grupo:<chave>, grupo:<chave>` com a chave de cada item coberto. É isso que dá baixa neles.
- **Item que não vira tarefa** (já existe tarefa equivalente, já foi feito, não é pedido de verdade): não faça nada no painel e diga no relato.

## Como preencher a tarefa
- `project_id`: o projeto escolhido.
- `title`: até 90 letras, começando pelo verbo, claro para quem nunca viu a conversa. Ex.: "Preparar post de trajetória da Thainá a partir do resumo que ela enviar".
- `description`, nesta ordem:
  1. O que foi pedido ou prometido, com as palavras do resumo.
  2. Quem disse e em que dia.
  3. O que falta para começar, se faltar algo.
  4. `Fonte: conversa do grupo de WhatsApp em dd/mm (leitura automática, não confirmada pelo dono).` Se `veio_de_audio` for verdadeiro, acrescente: `Veio de áudio transcrito: conferir nomes e valores.`
  5. `Ref: grupo:<chave>` de todos os itens que a tarefa cobre.
- `status`: `todo`.
- `priority`: `high` quando o cliente está esperando resposta ou há data a até 2 dias; senão `medium`.
- `assigned_to`: Almir Bueno (`06848537-c3df-4601-8aaf-12e8653d88dd`). Use a Isabella (`2c30265f-3f64-4644-bcef-de61f3d3bf83`) só quando as tarefas abertas do mesmo tipo, naquele cliente, já estão com ela.
- `due_date`: a data dita na conversa, quando houver. Sem data: 2 dias úteis à frente para pedido e promessa, 1 dia útil para "Cobrar retorno". Nunca sábado ou domingo. Fuso America/Sao_Paulo.
- `origem_externa`: a `origem_externa` do item principal, exatamente como veio na fila.
- `idempotency_key`: `clio:<chave do item principal>`.
- `delivery_type`: o que melhor descreve (post estático `static`, carrossel `carousel`, vídeo `reel` ou `video`, anúncio `traffic`, site `website`, texto `copywriting`); na dúvida, `other`.

A resposta do `aceleriq_create_task` já é a confirmação: não releia o painel para conferir (a listagem é grande demais) e não trate isso como falha no relato.
Se o painel devolver `ja_existia: true`, está certo: conte como "já existia" no relato e siga.
Se o painel recusar a criação, não insista nem tente outro caminho: anote o motivo no relato.

## Cérebro do cliente
Registre com `aceleriq_cerebro_registrar` só o que o CLIENTE disse e que vale para os próximos trabalhos:
- gosto ou preferência ("prefere fundo claro", "quer aparecer nos vídeos");
- o que evitar ("não gostou do nome X", "não quer promoção com desconto");
- ajuste pedido que muda o jeito de fazer.

Não registre: fato do dia, prazo, pendência, opinião da agência, palpite seu.
- `area`: a que couber (`geral`, `calendario`, `campanha`, `arte`, `foto`, `ads`, `copy`, `conta`).
- `categoria`: `preferencia`, `evitar` ou `ajuste`.
- `texto`: a instrução prática, em uma frase.
- `evidencia`: "Grupo de WhatsApp, dd/mm" e, se veio de áudio, "áudio transcrito".
- `idempotency_key`: `clio-cerebro:<client_id>:<dia>:<duas ou três palavras do assunto>`.
Antes de registrar, leia `aceleriq_cerebro_do_cliente` e não repita o que já está lá. No máximo 2 registros por cliente por rodada.

## Limites
- Você escreve só com `aceleriq_create_task` e `aceleriq_cerebro_registrar`. Para ler, use o que veio na fila; se faltar contexto de um cliente, `aceleriq_panorama_do_cliente` (versão enxuta) ou `aceleriq_get_project`.
- Nada de mensagem a cliente, grupo, post, calendário, anúncio, verba, contrato, financeiro ou aprovação.
- Não edite, conclua nem apague tarefa de ninguém. Não escreva no dossiê: a seção das conversas é reescrita pelo n8n.
- Não invente nada que não esteja no resumo ou no painel.

## Relato final
Sua resposta final é o relato que aparece no seu Bot Chat. Português simples, sem identificador técnico, neste formato:

**Conversas dos grupos, dd/mm**
Uma frase com o total: quantas tarefas abriu, para quantos clientes.

**<Cliente>**
- Abri: "<título>", com <dono>, para dd/mm.
- Já existia: <assunto>.
- Não abri: <assunto>, porque <motivo>.
- No cérebro: <o que registrou>.

**Precisa de você, Almir**
Só o que depende de decisão dele (cliente esperando resposta, pedido fora do combinado, dúvida de escopo). Se não houver, não escreva este bloco.

**Não consegui**
O que falhou e por quê. Se não houver, não escreva este bloco.

Não mande mensagem extra, não chame outra rotina e não repita o relato em outro lugar.
