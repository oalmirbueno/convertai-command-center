# Intermediador dos grupos de cliente

Pedido do Almir em 25/11/2026: um agente no número 3429 que pergunta ao cliente no grupo quando outro agente
precisa de um dado. Ele marca a pessoa, conversa só dentro daquele tema, entende áudio, não responde ao resto do
grupo e devolve a resposta ao agente que pediu.

## Mapa

```
Agente (Fred, Jori, Hermes, Codex, Claude Code, n8n)
  │ aceleriq_intermediador_pedir  (MCP 2.39.0, painel: modulos/intermediador.ts)
  ▼
public.intermediador_assuntos  (fila: um assunto aberto por grupo)
  ▲                                   leitor dos grupos → acq_n8n.mensagens_entrada (texto, áudio transcrito,
  │ aceleriq_intermediador_rodada      imagem descrita); o painel lê só a pessoa marcada ou quem citou a pergunta
  │ (a cada minuto)                    e julga com o Jev (Choice relação + Noul por ponto + humano + quem_e)
Este processo no VPS  /opt/aceleriq-intermediador/intermediador.mjs
  │ POST /send na ponte do 3429 (texto + menção) ou, em prévia, ao WhatsApp do Almir
  │ aceleriq_intermediador_envio_feito (message_id da ponte)
  ▼
Resposta estruturada ao agente pelo Escritório (de "intermediador" para quem pediu)
```

O texto que vai ao cliente é escrito no painel, no contexto do cliente e da conversa, e conferido pelo Jev
(`intermediador-escrita.ts`). Este script não escreve nem decide nada: só envia o que o painel devolveu e confirma.

## Modos

- `INTERMEDIADOR_MODO=previa` (padrão): a pergunta vai só ao Almir, marcada `[Prévia → "grupo" · tipo]`, com o
  nome no lugar do número. O assunto fecha como `previa` e o agente recebe o aviso de prévia.
- `INTERMEDIADOR_MODO=grupos`: real. **Só com ok do Almir em palavras.** Trocar na unidade e `systemctl daemon-reload`.
- `INTERMEDIADOR_CLIENTES_REAIS=<client_id,...>`: piloto. Esses clientes saem de verdade no grupo mesmo com o modo geral
  em prévia. Desde 25/11/2026 só a Verzelo (`piloto-verzelo.conf` em `aceleriq-intermediador.service.d/piloto.conf`,
  ok do Almir "Sim, pode ligar Verzelo"). Apagar o arquivo e `daemon-reload` volta tudo à prévia.

## Ponte (menção)

`ponte/pilot_guard.mjs` é a trava da ponte com menção liberada (até 2 pessoas, com o `@numero` escrito no texto,
só quem participa do grupo na hora). Em grupo com LID a trava troca o `@telefone` pelo `@lid` do participante.
Teste: `node --test ponte/pilot_guard.mencao.test.mjs` (com `GUARD=ponte/pilot_guard.antes.mjs` os testes novos
falham, que é a prova de que a trava antiga barrava). Instalado em `/opt/mercurio-pilot/release-v1/pilot_guard.mjs`
(cópia anterior: `pilot_guard.mjs.antes-intermediador-<data>`).

Voltar a trava antiga: copiar o `.antes-intermediador-*` por cima e `systemctl restart mercurio-pilot-bridge`,
depois de conferir que nenhum envio está em curso (diários de grupo-cliente e post-no-ar).

## Instalar

```
mkdir -p /opt/aceleriq-intermediador /var/lib/aceleriq-intermediador
cp intermediador.mjs /opt/aceleriq-intermediador/
cp aceleriq-intermediador.service aceleriq-intermediador.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now aceleriq-intermediador.timer
```

Usa a mesma credencial do painel que o `grupo-cliente` (`MCP_ACELERIQ_API_KEY` do `/root/.hermes/.env`, operador
`default`) e o token da ponte. Não grava segredo em lugar nenhum.

## Conferir

- `journalctl -u aceleriq-intermediador -n 50` (uma linha `rodada` por minuto, com o que foi feito)
- `/var/lib/aceleriq-intermediador/diario.jsonl` (intenção, envio, recusa, incerto)
- `aceleriq_intermediador_estado` pelo MCP; tabelas `intermediador_assuntos`, `_envios`, `_eventos`.

## Desligar

`systemctl disable --now aceleriq-intermediador.timer`. Os pedidos ficam na fila; nada é perdido.

## Testes

`node --test intermediador.test.mjs` (este lado) e, no painel, `deno test` em
`mcp-server/modulos/intermediador-regras_test.ts` e `intermediador_test.ts`.
