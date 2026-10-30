# ACQ n8n — cinco workflows da Aceleriq OS

O n8n conduz horários, eventos, integrações e retomadas. O painel continua sendo a fonte dos estados,
do contexto e das aprovações; o Hermes interpreta e prepara respostas com evidência. **Nada aqui está
ativo em produção.**

| Workflow | O que faz | Gatilhos (inativos) |
|---|---|---|
| `ACQ-00-Ferramenta-Aceleriq` | Adaptador único do MCP: allowlist por workflow, dry-run imposto, erros (HTTP 200 com `error` é falha), paginação | chamado pelos outros (`Execute Sub-workflow`, um item por chamada) |
| `ACQ-00-Erros` | Registra falha de qualquer ACQ como incidente deduplicado (sem alerta externo) | Error Trigger |
| `ACQ-01-Contexto-Rituais` | Separa fato, resposta humana, interpretação, lacuna e decisão; propõe seção do dossiê, rascunho do ritual e pedido de revisão | seg e qua 08h30, sex 16h30, manual por `client_id` |
| `ACQ-02-Despacho-Aprovado` | Fila → claim atômico → revalidação → transporte → recibo → registro no painel | a cada 5 min; webhook de recibos |
| `ACQ-03-Post-No-Ar` | Publicação comprovada (conta, permalink, prova) → print do perfil → aviso para revisão; reconciliação editorial diária | a cada 10 min; 07h30 |
| `ACQ-04-Conversas-Contexto` | Mensagens e áudios → registro durável → transcrição → Jev → regras → proposta/handoff | webhook autenticado; entrada interna de teste |
| `ACQ-05-Dia-Prioritario-Radar` | Pauta do Dia Prioritário (até 3 ações), reconciliação 17h, verificação técnica | dias úteis 08h e 17h; a cada 15 min |
| `ACQ-06-Comercial-Primeiro-Contato` | Mercúrio: primeiro contato com lead da fila pelo modelo aprovado da Cloud API (dry-run próprio) | dias úteis 9h-18h, a cada 20 min |
| `ACQ-07-Comercial-Respostas` | Webhook do WhatsApp comercial: registra, Jev julga a intenção, "pare" grava nao_contatar, resposta na janela de 24 h, Caixa | webhook GET/POST `acq07-whatsapp` |

## Estrutura

```
lib/            lógica pura (a mesma que vai nos nós Code; testada localmente)
contratos/      allowlist de ferramentas por workflow (leitura/escrita/proibidas)
config/         ambientes test / pilot / production (dry-run por padrão)
migrations/     estado persistente acq_n8n (NÃO aplicada) + rascunhos para o painel
build/gerar.mjs gera workflows/*.json a partir de lib + config + contratos
workflows/      os 7 JSONs importáveis (ambiente pilot)
fixtures/       mundo de teste sanitizado
tools/          servidores de teste, n8n local, e2e, importador/verificador de homologação, avaliação do Jev, piloto
test/           testes de lógica e de estado (Postgres real)
piloto/         evidências: e2e, homologação, avaliação do Jev, piloto Mirante
docs/           mudanças no painel, plano de ativação, matriz
```

## Gerar, testar e importar

```bash
npm install
node build/gerar.mjs                        # workflows/ (pilot: dry-run forçado, só Mirante)
node build/gerar.mjs --ambiente test --saida workflows-test
node tools/pg-local.mjs                     # Postgres local (deixe rodando)
npm test                                    # lógica + estado
node tools/e2e-local.mjs                    # n8n 2.42.7 local + replay + transporte de teste
node tools/importar-homologacao.mjs         # importa INATIVO na homologação (MCP da instância)
node tools/verificar-homologacao.mjs        # lê de volta e compara
```

O importador usa o MCP da instância (`/mcp-server/http`) com o token na variável de usuário
`N8N_MCP_TOKEN` (nunca impresso nem gravado). Ele cria um rascunho, adiciona os nós e conexões do JSON
gerado e **nunca chama `publish_workflow`**. Se o workflow já existe, atualiza em vez de duplicar.

## Importação manual (UI do n8n)

1. Importe `ACQ-00-Erros` e `ACQ-00-Ferramenta-Aceleriq` primeiro (os outros referenciam o adaptador).
2. Importe os demais; nos nós `Execute Sub-workflow`, escolha `ACQ-00-Ferramenta-Aceleriq`.
3. Crie as credenciais pelos nomes abaixo e associe. Não publique.

## Credenciais (só por referência)

| Nome no n8n | Tipo | Usado por | Situação |
|---|---|---|---|
| `ACQ MCP Aceleriq (máquina n8n)` | Bearer | ACQ-00 | falta a chave `mcp_live_*` de máquina |
| `ACQ Estado (Postgres acq_n8n)` | Postgres | todos | falta aplicar a migration e criar o papel |
| `TypeSafe Jev (servidor)` | Bearer | ACQ-04 | chave existe no servidor do painel; criar no n8n |
| `ACQ Webhook mensagens (segredo)` | Header Auth | ACQ-04 | criar segredo |
| `ACQ Webhook recibos (segredo)` | Header Auth | ACQ-02 | criar segredo |
| `ACQ WhatsApp Cloud API (Meta)` | Bearer | ACQ-06, ACQ-07 | token do usuário do sistema (docs/COMERCIAL-WHATSAPP.md) |
| `ACQ OpenRouter (Mercúrio)` | Bearer | ACQ-07 | chave do OpenRouter |

## Execução manual

- ACQ-01: nó `Executar piloto (Mirante)` (no ambiente pilot roda só a Mirante) ou chamar `Manual por client_id`
  com `{ client_id, ritual?, agora? }`.
- ACQ-02, ACQ-03, ACQ-05: nó de execução manual. ACQ-03/05 também aceitam `Entrada interna` com `{ modo }`.
- ACQ-04: `Entrada interna de teste` com `{ provedor, mensagem: { id, grupo, de, em, tipo, texto } }`.

## Garantias e limites

- **Dry-run real:** o adaptador decide antes da rede. No `pilot` o dry-run é forçado mesmo que alguém edite a
  config; escrita vira simulação sem montar o corpo JSON-RPC. Testado em `test/logica.test.mjs`.
- **Deduplicação durável:** chaves de idempotência e estado no Postgres (`acq_n8n`), testadas com conexões
  concorrentes reais; não depende da janela de 24 h do MCP nem da memória do n8n.
- **Despacho:** um consumidor por saída (`FOR UPDATE SKIP LOCKED`), payload congelado (trigger), ponto sem volta
  antes do envio, `envio_incerto` nunca reenvia, aceite/entrega/leitura distintos, falha do painel retoma só o
  registro. Não há promessa de exactly-once externo: depende do provedor.
- **Publicação do adaptador:** no n8n 2.x, um `Execute Sub-workflow` disparado por agenda/webhook só chama
  sub-workflow publicado. Em execução manual pelo editor funciona com o rascunho. Na ativação, publicar
  `ACQ-00-Ferramenta-Aceleriq` antes dos outros (ver docs/PLANO-DE-ATIVACAO.md).
- **Limites conhecidos:** transporte oficial de WhatsApp, transcrição e captura real não estão homologados;
  o aviso de publicação não cabe na revisão atual (só relatório); `hermes_status` não existe no MCP 2.9.0;
  webhooks não foram exercitados com o workflow ativo (não se ativa nada nesta entrega); o texto final do
  ritual depende de uma rota de automação no ritual-writer.

## Rollback

Homologação: arquivar os workflows `ACQ-*` (nada está publicado). Repositório: os arquivos desta pasta são
novos; nenhuma migration do painel foi alterada. Produção: nada a desfazer.
