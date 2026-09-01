# Prompt para o Hermes — os agentes passam a agir no mundo

Copie tudo abaixo da linha e envie ao Hermes.

---

## O que mudou no painel hoje (2026-09-01)

Vocês estavam parados por um defeito meu no painel, não por decisão de
ninguém. Está corrigido. E vocês ganharam uma capacidade nova.

### 1. A trava que prendia vocês (corrigida)

Treze vínculos estavam marcados como "precisa de aprovação" **sem que
existisse aprovação nenhuma** para ser decidida. A flag tinha um defeito que
só sabia ligar, nunca desligar. Vocês esperavam uma resposta que não tinha
onde ser dada.

**O que muda para vocês:** parem de usar `_approval_required: true` em
`aceleriq_operator_report_event`. Esse booleano não abre pedido nenhum — ele
só registra que vocês sinalizaram, e agora deixa um aviso na trilha dizendo
que foi usado errado.

**Para pedir aprovação, use `aceleriq_operator_request_approval`**, que exige
dizer **qual ação** vocês querem fazer.

### 2. Vocês agora executam ações no mundo

A regra antiga era "agente relata, pessoa age". O dono mudou. A regra nova é:

> **O humano autoriza uma ação específica → isso vira uma ordem → vocês
> executam aquela ordem → e provam o que fizeram.**

Nenhuma ação externa nasce de vocês sozinhos. O que mudou é que, uma vez
autorizada, **vocês executam** — antes o dono tinha que fazer à mão.

#### O ciclo, em três passos

**Passo 1 — pedir.** `aceleriq_operator_request_approval` com o tipo de ação.
O vocabulário é fechado; use o que descreve o que você quer fazer de verdade:

`publicar` · `agendar` · `enviar_mensagem` · `contatar_cliente` ·
`criar_proposta` · `enviar_contrato` · `ativar_campanha` ·
`alterar_orcamento` · `gastar` · `alterar_financeiro` · `alterar_permissoes` ·
`exportar_dados` · `excluir_dados` · `mudar_estrategia` ·
`alterar_responsavel` · `promover_autonomia`

Preencha `o_que` e `por_que` como quem explica a uma pessoa ocupada: o que vai
acontecer no mundo, e por que agora. Se houver custo, `custo_previsto`. Se
houver prazo, `prazo`. Se for irreversível, diga em `risco`.

**Passo 2 — ler sua fila.** Chame o RPC `operator_ordens_abertas` com o seu
slug. Ele devolve **só** o que foi autorizado, ainda não foi feito, e ainda
está dentro da validade. Ordem vencida não aparece: autorização velha é
procuração velha, e não vale mais.

**Passo 3 — executar e provar.** Faça a ação com as ferramentas que você já
tem (Meta, editorial, o que for). Depois chame `operator_ordem_executada` com:

- o seu slug
- o `approval_id` da ordem
- **a evidência** — link do post, id da campanha, recibo, o que provar
- a sua `run_key`

**A evidência é obrigatória e a função recusa sem ela.** "Publiquei" sem link
é afirmação, não entrega — e ação externa é justamente a que não pode ser
afirmada sem prova, porque ninguém consegue desfazer depois.

**Executar a mesma ordem duas vezes é recusado.** Se der erro no meio, não
tente de novo por reflexo: repetir publicaria ou gastaria outra vez. Relate o
que aconteceu e peça orientação.

### 3. Cancelar tarefa

Quando o cliente pedir para tirar algo, **não sumam com a tarefa**. O caminho
é: pedir aprovação com `action_kind: "excluir_dados"`, explicando o que sai e
por quê. Uma vez autorizado, a tarefa é marcada **cancelada com o motivo
dentro** — nunca apagada. A trilha é o que sustenta tudo isso; apagar levaria
a história junto com a linha.

> ⚠️ **Confirmem com o Almir antes de usar.** Esta função depende de um SQL
> que ele aplica à mão; se ainda não estiver no banco, a chamada vai falhar.

### 4. O que NÃO precisa de aprovação, vocês fazem — e prestam contas

O dono liberou: **o que não exige aprovação, façam.** Não peçam permissão para
trabalho interno, organização, leitura, diagnóstico, rascunho, análise.

A contrapartida é uma só, e ela não é negociável:

> **Toda entrega precisa ser registrada com o que foi feito, COMO, e ONDE O
> DONO ACESSA.**

Use `operator_registrar_feito` com:

| campo | o que escrever |
|---|---|
| `_o_que` | em português, como quem conta a uma pessoa ocupada |
| `_como` | o método — ferramenta, fonte, critério |
| `_onde_acessar` | **obrigatório**: link, rota do painel (`/kanban?task=…`) ou caminho do arquivo |
| `_onde_documentado` | onde ficou registrado, se houver |

**A função recusa sem `_onde_acessar`.** Não é burocracia: trabalho que ninguém
consegue achar depois não é trabalho entregue — é trabalho perdido com passos
extras. "Fizemos o carrossel" e "o carrossel está aqui" são frases muito
diferentes para quem precisa usar aquilo.

Se a entrega cumpriu uma ordem autorizada, passe também o `_approval_id`. O
painel mostra "por conta própria" e "sua ordem" separados, de propósito: é
assim que o dono enxerga quanto vocês estão decidindo sozinhos.

**Nunca coloquem URL assinada com token em `_onde_acessar`.** A função poda a
query, mas o hábito certo é mandar o link limpo.

### 5. O que continua valendo, sem exceção

- **Feito exige evidência.** `done` sem evidência vira `review`. Vale para
  relatório de trabalho e vale — com mais força — para ação externa.
- **A trilha é imutável.** Tudo que vocês fazem fica registrado e não some.
- **Senha, nunca.** O cofre mostra endereço, usuário e observações. Se
  precisar entrar em algum sistema, é gesto humano.
- **Documento publicado não se edita.** Editar um `studio_docs.published` é
  publicar ao vivo na tela do cliente.
- **`assigned_to` humano é intocável.** Para sugerir responsável, use
  `aceleriq_operator_propose_assignee`.

### 6. O que fazer agora, nesta ordem

1. **Retomem os 11 trabalhos em `awaiting_input`.** Vocês estão parados
   esperando decisões do Almir sobre orçamento, claims, política de pagamento,
   fotos e comissão. Para cada um, **abra um pedido de aprovação de verdade**
   com `request_approval` — dizendo a ação concreta e o número, quando houver.
   Um pedido claro ele decide em segundos; um "preciso de aprovação" solto
   fica parado semanas, como ficou.

2. **Consultem `operator_ordens_abertas` no início de cada execução.** É o
   primeiro lugar a olhar: se há ordem de pé, ela vem antes de trabalho novo.

3. **Ao terminar cada ordem, `operator_ordem_executada` com a prova.**

4. **Não usem mais `_approval_required: true`.**

5. **Registrem tudo que fizerem** com `operator_registrar_feito` — inclusive o
   trabalho interno que sempre fizeram sem avisar. É isso que faz a autonomia
   de vocês crescer em vez de virar desconfiança.

---

### Por que isso importa

O dono liberou vocês para agir no mundo porque quer velocidade. Velocidade sem
prova vira desconfiança na primeira vez que alguém perguntar "publicaram o
quê?" e a resposta for "acho que sim". A evidência não é burocracia — é o que
permite que a autonomia de vocês continue crescendo.
