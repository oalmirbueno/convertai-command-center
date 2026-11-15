# Vigia da mensagem da semana (ACQ-11)

Regra do dono (Almir, 13/11/2026): **a mensagem tem de sair para todos os clientes, não só para metade.**

A mensagem sai segunda (fluxo 07h20, envio 08h), quarta e sexta (fluxo 17h20, envio 18h, janela até 20h),
horário de Brasília. São 13 grupos em `/etc/mercurio-pilot/allowed-groups.json` no servidor.

## Conferir uma rodada

1. Quem recebeu hoje (no servidor, `ssh root@ssh.aceleriq.com.br`):
   `grep '"fase":"envio"' /var/lib/aceleriq-grupo-cliente/diario.jsonl | grep 'semana:' | grep "$(date -u +%F)"`
   Atenção: o diário é em UTC; envio das 18h de Brasília aparece como 21h.
2. Lista esperada: os 13 `group_name` de `allowed-groups.json`. Quem não aparece no passo 1 está faltando.
3. Por que faltou: `journalctl -u aceleriq-grupo-cliente.service --since "-40 min" | grep semana_segurada`
   (ignore `nao_veio_do_fluxo` e `de_outra_semana`, que são pedidos antigos e ensaios).

## Soltar quem ficou segurado

Na pasta `automacoes/n8n` desta máquina (precisa de `TYPESAFE_API_KEY`, `N8N_BASE_URL` e `N8N_MCP_TOKEN` no ambiente do Windows):

```
node tools/semana-vigia/n8n.mjs ultimas
node tools/semana-vigia/n8n.mjs execucao <id da rodada de gatilho de hoje> > C:/tmp/rodada.json
node tools/semana-vigia/soltar-segurados.mjs C:/tmp/rodada.json C:/tmp/soltar.json --texto
```

Leia os textos impressos. Depois, crie os pedidos pelo servidor (o envio é do timer, a cada poucos minutos):

```
scp tools/semana-vigia/criar-pedidos-no-servidor.mjs C:/tmp/soltar.json root@ssh.aceleriq.com.br:/root/
ssh root@ssh.aceleriq.com.br "cd /root && /opt/mercurio-pilot/node criar-pedidos-no-servidor.mjs soltar.json; rm -f criar-pedidos-no-servidor.mjs soltar.json"
```

Se o cliente nem foi escrito (não aparece em "Fechar texto"): `node tools/semana-vigia/n8n.mjs manual` roda a rodada
real de novo e pula quem já recebeu.

## O que nunca fazer

- Marcar `conferencia.ok` à mão, mexer nos limites ou enviar texto que a conferência reprovou.
- Acrescentar frase ao texto. O reparo só corta.
- Enviar duas vezes ao mesmo grupo: confira o passo 1 antes de criar pedido.
- Mexer em `allowed-groups.json`, na ponte ou reiniciar serviço sem o Almir pedir.
