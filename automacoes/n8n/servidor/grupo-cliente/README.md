# Mensagens no grupo do cliente: lembrete de aprovação e mensagem da semana

Tudo sai pelo mesmo número dos avisos de post no ar (41 9748-3429), só texto, só nos grupos de
`/etc/mercurio-pilot/allowed-groups.json`. Quem envia é um script só, neste servidor (a ponte do WhatsApp só aceita
chamada local). Quem escreve nunca é o script.

## Mapa

```
AVISO DE PEÇA NOVA (desde 12/11/2026)
 painel (robô aprovacao-aviso-whatsapp, a cada 2 min, dia útil 9h–18h)
   peça em aprovação que ainda não foi avisada no grupo (até 30 dias) → 3 min depois da última do lote,
   uma mensagem com todas as peças esperando, a nova primeiro e com o link dela; mesmo modelo aprovado do lembrete
   no máximo uma a cada 30 min por cliente; o lembrete diário não repete no dia em que já saiu aviso
        ↓ mesma fila (tipo lembrete_aprovacao, chave nova:<cliente>:<hora>)

SÓ PEÇA QUE AINDA VALE (desde 13/11/2026, vale para o aviso e para o lembrete)
 fora: peça esperando há mais de 60 dias, peça cujo post no calendário foi arquivado,
 e peça que o Jev julga vencida (data comemorativa, evento ou promoção que já passou)
 Jev: função aprovacao-validade, robô a cada 5 min, julga cada peça uma vez por dia (app_private.aprovacao_validade, corte 0,6)
 só peça dos últimos 7 dias dispara o aviso de peça nova; as mais velhas vão só no lembrete diário

LEMBRETE DE APROVAÇÃO
 painel (robô das :07 e :37, dia útil 9h–18h)
   peça esperando o cliente há mais de 48 h → 1 lembrete por cliente por dia, com o link direto da peça
   (https://aceleriq.online/aprovacoes?peca=<id>), no modelo que o dono aprovou em /central/mensagens
   não nasce se o cliente já recebeu o e-mail de lembrete hoje; para sozinho quando o cliente aprova
        ↓ fila aceleriq_mensagens_automaticas_fila
 enviar.mjs → grupo do cliente → marca enviado no painel → grava na memória do cliente

MENSAGEM DA SEMANA (segunda, quarta, sexta)
 n8n "Clientes: mensagem da semana no grupo (seg, qua, sex)" (ACQ-11): seg 07h20, qua e sex 17h20
   quem ainda não recebeu a mensagem do dia → escritor da Central (aceleriq_ritual_redigir)
   → Jev confere: apoiada nas fontes, números nas fontes, sem promessa, sem termo interno, sem repetir
   → guarda o rascunho no painel → se passou, prepara o pedido na Revisão do Ciclo com o grupo como destino
   → se não passou, aviso no sino do dono (o rascunho fica na Central para enviar à mão)
        ↓ fila aceleriq_central_review_fila
 enviar.mjs (seg a partir das 08h, qua e sex a partir das 18h, até 20h)
   só aprova pedido escrito pelo ACQ-11, conferido, desta semana, para o grupo exato → envia → marca enviado
   (marcar enviado é o que marca o Ciclo e grava a mensagem na memória do cliente)
```

## Travas

- Cobrança nunca sai por aqui (só `lembrete_aprovacao`).
- Pedido aprovado por outro caminho (à mão, pelo Hermes, antigo) não é enviado: o script só envia o que ele mesmo aprovou.
- Texto com a palavra "ritual" ou termo interno é segurado mesmo que o resto tenha passado.
- Dois textos nunca saem colados no mesmo grupo: 10 minutos de intervalo, contando os avisos de post no ar.
- Envio com resultado incerto nunca é repetido sozinho (`envio_incerto_nao_repetido` no registro).
- No máximo 4 envios por rodada; o timer roda a cada 2 minutos (era 5 até 12/11/2026).

## Modos

- `GRUPO_CLIENTE_MODO=previa` (padrão): manda cada texto só ao dono, uma vez, sem aprovar nem marcar. Aceita o ensaio do n8n.
- `GRUPO_CLIENTE_MODO=grupos`: o real.
- `GRUPO_CLIENTE_LIGADOS=lembrete,semana`: escolhe as frentes.

## Instalar e ligar

```bash
install -d -m 755 /opt/aceleriq-grupo-cliente && install -d -m 700 /var/lib/aceleriq-grupo-cliente
install -m 750 enviar.mjs /opt/aceleriq-grupo-cliente/enviar.mjs
install -m 644 aceleriq-grupo-cliente.service aceleriq-grupo-cliente.timer /etc/systemd/system/
systemctl daemon-reload
GRUPO_CLIENTE_MODO=previa /opt/mercurio-pilot/node /opt/aceleriq-grupo-cliente/enviar.mjs   # uma rodada de prévia
```

Para o modo real: trocar `Environment=GRUPO_CLIENTE_MODO=previa` por `grupos` na unidade, `systemctl daemon-reload` e
`systemctl enable --now aceleriq-grupo-cliente.timer`.

Registro: `journalctl -u aceleriq-grupo-cliente.service`. Estado: `/var/lib/aceleriq-grupo-cliente/diario.jsonl`.
Testes: `node --test servidor/grupo-cliente/enviar.test.mjs` e `node --test test/semana.test.mjs`.

## Antes de ligar

1. O dono aprova o modelo do lembrete em `/central/mensagens` (sem isso o painel não cria lembrete).
2. O MCP do painel precisa estar publicado com as `fontes` do escritor (senão o Jev segura toda mensagem com número).
3. As rotinas do Hermes "Abertura da semana" e "Atualização de meio e fechamento" precisam parar de preparar texto,
   senão o cliente recebe duas mensagens no mesmo dia.
4. Publicar o ACQ-11 no n8n.
