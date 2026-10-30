# Matriz de entrega por workflow (14/10/2026)

Legenda: ✅ feito e verificado · ◑ parcial (detalhe ao lado) · ⛔ dependência externa bloqueando · — não se aplica.
"Integração viva validada" significa leitura real do painel, rodada no n8n da nuvem em modo simulação (nenhuma escrita no painel, nenhum envio).

| Workflow | Implementado localmente | Importado inativo (homologação) | Testado isoladamente | Integração viva validada | Dependência bloqueada |
|---|---|---|---|---|---|
| ACQ-00-Ferramenta-Aceleriq | ✅ | ✅ `xhZnAPoCqWaXVvfO` (lido de volta, igual) | ✅ lógica + dados fixos na Hostinger (5/5) | ✅ chave somente leitura ligada; leituras reais ok; escritas simuladas | publicar antes de ativar agendamentos |
| ACQ-00-Erros | ✅ | ✅ `evTkFzYoAHcVGQO2` | ◑ só conferência de código e de conexões | — | publicar para virar `errorWorkflow` (n8n exige) |
| ACQ-01-Contexto-Rituais | ✅ | ✅ `8v770a6M8LMCoIXU` | ✅ lógica (35) | ✅ leitura real da Mirante na nuvem, modo simulação, sem escrita | rota de automação no ritual-writer; limite do dossiê (60.954 > 60.000) |
| ACQ-02-Despacho-Aprovado | ✅ (transporte de teste) | ✅ `fLY4w3SYgv6Ul3dM` | ✅ estado com concorrência real (16) + lógica | ◑ leu a fila real na nuvem (sem aprovados) | provedor oficial de WhatsApp homologado no tipo de grupo; destinos técnicos aprovados |
| ACQ-03-Post-No-Ar | ✅ | ✅ `LUrPTs349RvFawvX` | ✅ lógica | ✅ na nuvem: cursor inicial sem anunciar histórico; post real de 14/10 validado (conta, link, prova) | captura real (navegador remoto); extensão da revisão para aviso de publicação |
| ACQ-04-Conversas-Contexto | ✅ (entrada de teste) | ✅ `rjeArp0UCeZVEt1g` | ✅ lógica + Jev real (29/29) | ⛔ | transporte oficial com leitura de grupo; serviço de transcrição |
| ACQ-05-Dia-Prioritario-Radar | ✅ | ✅ `b2SY93gJfFUsc0CS` | ✅ lógica | ✅ na nuvem: pauta real, repetição sem nova pauta, verificação técnica com 2 incidentes | `hermes_status` inexistente no MCP (lido pelo quadro de operadores) |
| ACQ-06-Comercial-Primeiro-Contato (30/10) | ✅ | — (não importado) | ✅ lógica + fluxo no simulador local (Postgres real, painel/Meta falsos) | ⛔ | número na Cloud API, token, modelos aprovados; ACQ-00 da nuvem reimportado |
| ACQ-07-Comercial-Respostas (30/10) | ✅ | — (não importado) | ✅ lógica + fluxo no simulador local (assinatura, Jev, LLM, Meta falsos) | ⛔ | webhook na Meta, app secret e verify token no acq_n8n, credenciais OpenRouter e Jev |

Instância de homologação: `blue-fly-822772.hostingersite.com`, n8n 2.42.7, projeto pessoal do Almir,
vazia antes desta entrega (0 workflows, 0 credenciais). Nenhum workflow publicado; nenhum gatilho registrado.
IDs e leitura de volta em `piloto/homologacao-ids.json` e `piloto/homologacao-leitura-de-volta.json`.

Atualização 14/10/2026, fim da tarde: chave MCP somente leitura e banco de controle (`acq_n8n`) ligados no n8n da
nuvem. Piloto da Mirante rodado na nuvem em modo manual e simulação: 0 escritas no painel (conferido no banco).
O teste de ponta a ponta no computador local foi interrompido a pedido; a validação passou a ser feita na nuvem.
