# Computador do agente (Cua): o que resolve, onde roda e como entraria no painel

Frente V2, 25/09/2026. Pedido do dono: mandou o repositório [trycua/cua](https://github.com/trycua/cua) para "dar um computador" aos agentes.

Este documento é só leitura e desenho. **Nada do Cua foi instalado, clonado, executado ou contratado.** No painel existe apenas a fila "Tarefas para o computador do agente", **desligada por padrão** (detalhes na seção 6).

Fontes consultadas em 25/09/2026, todas públicas:

- README do repositório;
- LICENSE.md e SECURITY.md;
- `pyproject` do `cua-agent`;
- docs em cua.ai/docs: driver, sandbox SDK, fleets, credenciais, permissões e receitas;
- página cua.ai/pricing.

A leitura foi feita por resumo automático das páginas. Os números marcados "conferir" devem ser olhados de novo na página antes de qualquer contrato.

## 1. O que é o Cua hoje

Projeto aberto e muito ativo: cerca de 26 mil estrelas, releases em 25/09/2026 (`cua-driver-rs-v0.29.1`) e último push em 26/09/2026. O produto se organiza em cinco partes:

| Parte | O que faz | Onde roda |
|---|---|---|
| **Cua Driver** | Automação de aplicativos nativos: screenshot, árvore de acessibilidade, clicar, digitar, rolar, abrir app. Usa-se por CLI, MCP ou SDK. | O desktop real da máquina: Windows, macOS ou Linux |
| **Cua Fleets / Sandbox SDK** | Desktops descartáveis (Ubuntu 24.04 e Windows Server 2022) chamados por API | Nuvem (run.cua.ai) ou local (QEMU, Docker, Hyper-V; Lume no Mac Apple Silicon) |
| **Lume** | VMs de macOS e Linux | Só Mac Apple Silicon |
| **cua-agent** | Loop do agente em Python 3.11 a 3.13 (versão 0.8.4), com adaptadores de modelo e callbacks (detalhes abaixo) | Python |
| **CUA-S1 e Cua Bench** | Modelos pequenos (foco inicial em formulários) e avaliação de trajetórias | Diversos |

Adaptadores de modelo do cua-agent:

- Anthropic, OpenAI, Gemini;
- UI-TARS, OmniParser, Qwen-VL e outros.

Callbacks do cua-agent:

- teto de gasto em dólar (`budget_manager`);
- gravação de trajetória;
- anonimização de dados pessoais;
- telemetria.

O modo mais atual:

- o loop do modelo fica no harness (Claude Code ou Codex);
- o harness chama o Driver por MCP.

A doc diz que **não existe conexão direta do Driver com a API da Anthropic**.

## 2. Licença e custo

**Licença.** O código principal é MIT (Cua AI, Inc.). Algumas partes têm licença própria:

| Parte | Licença |
|---|---|
| `cua-som` | AGPL-3.0 |
| Conteúdo do OmniParser | CC-BY-4.0 |
| `cua-perception` | Mistura de licenças |

Se o painel embutir essas partes, AGPL exige cuidado. O caminho seguro é usar só o Driver ou o Sandbox SDK, que são MIT.

**Imagens de sistema.**

- Windows exige licença Microsoft própria, com direito de virtualização.
- macOS usa a imagem da Apple (IPSW).

**Preço do Cua Fleets.** Cobrança por uso, conferir na página:

- cerca de US$ 0,045 por vCPU por hora;
- cerca de US$ 0,022 por GB de RAM por hora.

Uma máquina de 2 vCPU e 4 GB sairia por uns US$ 0,18 por hora ligada. Não vimos plano gratuito nem crédito. A própria doc avisa que um pool com máquinas "quentes" continua cobrando depois que o trabalho acaba. Criar pool pode exigir cartão cadastrado.

**Preço do modelo.** Soma à parte, pelo modelo escolhido. Cada passo manda screenshot, e isso gasta muito token de imagem.

## 3. O que resolveria no painel

Casos reais da agência em que um "computador do agente" ajudaria:

1. **Organizar o projeto no Premiere.** O Pacote para editar da Mesa Vídeos já entrega roteiro, takes, `edl.json` e legendas. O agente abriria o Premiere, importaria a pasta, criaria bins por cena ("Café / Cena 2") e a sequência inicial pela EDL.
   - Hoje isso é manual.
   - A doc cobre apps Electron, WPF, WinUI e WebView2 no Windows.
   - **Não há receita pronta para Premiere**: seria o primeiro teste a fazer, sem promessa.
2. **Preencher cadastro sem senha.** Exemplos: formulário de parceiro, cadastro de produto num catálogo, inscrição num evento, a partir de um PDF ou planilha do cliente. A doc tem uma receita parecida: preencher formulário web a partir de um arquivo local.
3. **Organizar arquivos.** Renomear e mover pastas de gravação na máquina de edição, seguindo o organizador de takes. Não há receita pronta para isso; é o caso mais simples de testar.
4. **Conferência visual.** Abrir o vídeo exportado num player e tirar prints de pontos marcados (início, cortes, fim) para o revisor.
   - Isso é leitura, não ação.
   - É o uso de menor risco.

O que **não** deve ir para o computador do agente:

- publicar;
- pagar;
- mandar mensagem ao cliente;
- entrar em conta do cliente com senha;
- aceitar termos;
- apagar.

Esses passos continuam com a pessoa, como já é regra nas mesas.

## 4. Onde roda (não roda dentro de Edge Function)

- Uma Edge Function do Supabase tem 2 s de CPU, cerca de 256 MB e nenhuma tela. Ela não roda o loop do agente nem um desktop.
- O SDK TypeScript (`@trycua/fleet`) só cria e libera máquinas. As ações de tela ficam no SDK Python.
- O servidor MCP é só stdio.

Por isso o Cua precisa de um **host**. Duas opções:

| Opção | Como | Prós | Contras |
|---|---|---|---|
| **A. Máquina da agência** (o notebook do dono ou uma estação de edição com Windows 11) | Cua Driver instalado + um "executor" pequeno que busca tarefas aprovadas na fila do painel | Premiere e pastas reais já estão lá; sem custo de nuvem | Máquina precisa estar ligada; o agente mexe no desktop real (sem isolamento); instalação por script `irm ... \| iex` exige revisão |
| **B. Cua Fleets (nuvem)** | Worker próprio (Python + `cua-sandbox`) chamado pelo painel; máquina descartável Windows ou Ubuntu por tarefa | Isolado; descartável; não usa a máquina de ninguém | Custo por hora; sem Premiere licenciado na nuvem; sem macOS; credenciais do Cua (`CUA_CLIENT_ID` / `CUA_CLIENT_SECRET`) só no servidor |

Recomendação para quando o dono quiser ligar:

1. Começar pela **opção A**, só com o caso 4 (prints, leitura).
2. Depois, o caso 1 (bins no Premiere) numa **conta de usuário separada** do Windows, sem acesso às pastas pessoais.
3. Opção B só se aparecer tarefa que precise de isolamento ou escala.

## 5. Riscos e travas

| Risco | O que a doc do Cua diz | Trava no painel |
|---|---|---|
| Credencial de cliente | Nada impede o agente de digitar o que recebe | **Nenhuma senha, token ou cartão passa pelo painel ou pelo modelo.** A fila recusa tarefa com texto de credencial (`pareceCredencial`). Login fica com o dono. |
| Ação irreversível | O modo `unrestricted` não se defende de prompt injection; políticas não limitam screenshot nem rede | Tarefa com "enviar, publicar, pagar, apagar..." é marcada `irreversivel` e o executor para antes desse passo, pedindo a pessoa |
| Prompt injection (texto na tela ou no arquivo manda o agente fazer outra coisa) | Admitido na doc | O executor segue só os passos aprovados, na ordem; conteúdo lido na tela é dado, não instrução; sem shell livre |
| Permissão ampla demais | No MCP do CLI, uma lista de permissões vazia libera as 47 ferramentas | O executor sempre passa uma lista explícita e curta por tarefa (modo `standard` ou `bounded`, nunca `unrestricted`) |
| Porta local aberta | O `computer-server` escuta em 127.0.0.1:8000 sem autenticação própria | Só na opção A, só em localhost, com firewall; o painel nunca fala direto com essa porta (o executor puxa a fila) |
| Gasto sem teto | Existe `budget_manager` no cua-agent; Fleets cobram por hora | Teto por tarefa gravado na fila; máquina de Fleet liberada ao fim; nada fica "quente" |
| Prova | Trajetórias com print antes e depois de cada ação e `recording.mp4` | Print de cada passo sobe para o Storage (`<cliente>/computador/<tarefa>/passo-NN.png`) e fica na tarefa como prova |

## 6. Desenho da integração (padrão de confirmação da casa)

O desenho segue o mesmo contrato das mesas: o agente propõe, a pessoa confirma, a ação vai item a item, deixa prova e tem trava.

1. **Pedido.** Alguém da equipe (ou um agente, pelo contrato comum de ações) pede uma tarefa. O pedido entra pela função `mesa-videos`, ação `computador_pedir`, e leva:
   - título;
   - aplicativo;
   - passos, um por linha;
   - cliente (opcional).

   A função recusa quando:
   - a fila está desligada (`COMPUTADOR_DO_AGENTE_LIGADO` diferente de `1`);
   - o texto tem credencial;
   - falta título ou passo.
2. **Aprovação do dono.** Toda tarefa nasce `aguardando_dono`. Só admin aprova (`computador_decidir`). Quem pediu pode cancelar enquanto não começou.
3. **Execução fora do painel.** O executor (opção A ou B) faz o seguinte:
   1. busca só tarefas `aprovada`, usando a service_role guardada na máquina do executor e nunca no navegador;
   2. marca a tarefa `executando`;
   3. roda os passos com o Cua Driver;
   4. sobe o print de cada passo;
   5. marca `feita` ou `falhou`, com o motivo.

   Para em qualquer passo `irreversivel` e devolve à pessoa. Uma tentativa por aprovação: sem laço de correção.
4. **Prova e auditoria.** A tarefa guarda as provas (lista de prints) e cada mudança de estado vai para o `auditLog`. A tela mostra a lista e o estado.

Estados: `aguardando_dono` → `aprovada` → `executando` → `feita` ou `falhou`. A tarefa também pode ir para `cancelada` antes de executar.

**O que já existe no código (desligado):**

- **Tabela** `agente_computador_tarefas`, no SQL `V2-01-mesa-videos.sql` no scratchpad, ainda não aplicado. A RLS padrão deixa a equipe ler e só a service_role escrever.
- **Regras puras** em `supabase/functions/mesa-videos/modulos/computador-do-agente.ts`:
  - `computadorLigado`;
  - `pareceCredencial`;
  - `pedeAcaoIrreversivel`;
  - `motivoParaRecusar`;
  - `podeMudarEstado` (só admin aprova; a tela nunca marca `feita`).

  Os testes estão em `src/test/mesa-videos.test.tsx`.
- **Ações** `computador_pedir` e `computador_decidir` na função `mesa-videos`.
- **Cartão na tela**: "Tarefas para o computador do agente", na aba Edição da Mesa Vídeos. O botão "Pedir tarefa" está desligado, com o aviso.

**O que falta para ligar (decisão do dono):**

1. Escolher o host (A ou B).
2. Revisar e instalar o Cua Driver nesse host, lendo o script antes de rodar.
3. Escrever o executor pequeno que puxa a fila. Ele não existe ainda.
4. Criar a pasta de provas no Storage.
5. Ligar `COMPUTADOR_DO_AGENTE_LIGADO=1` nas variáveis da função.

## 7. Fontes

| Assunto | Link |
|---|---|
| Repositório e README | https://github.com/trycua/cua |
| Licença | https://raw.githubusercontent.com/trycua/cua/main/LICENSE.md |
| Segurança | https://raw.githubusercontent.com/trycua/cua/main/SECURITY.md |
| Plataformas do Driver | https://cua.ai/docs/reference/cua-driver/platform-support.md |
| Runtimes locais | https://cua.ai/docs/reference/sandbox-sdk/runtime-support.md |
| Fleets | https://cua.ai/docs/cloud-fleets.md |
| Credenciais do Fleets | https://cua.ai/docs/how-to-guides/sandbox/set-up-fleet-credentials.md |
| Catálogo de imagens | https://cua.ai/docs/reference/sandbox-sdk/os-image-catalog.md |
| Como funcionam as permissões | https://cua.ai/docs/concepts/how-permission-policies-work.md |
| Modos de permissão | https://cua.ai/docs/reference/cua-driver/permission-modes.md |
| Servidor MCP do CLI | https://cua.ai/docs/reference/cua-cli/mcp-server.md |
| Receita: preencher formulário | https://cua.ai/docs/how-to-guides/recipes/fill-a-form-from-a-local-file.md |
| Gravar trajetória | https://cua.ai/docs/how-to-guides/driver/record-and-render-a-trajectory.md |
| Preço | https://cua.ai/pricing |

## 8. Navegador do agente: computer use pela API (frente MOD, 30/09/2026)

O caminho que ficou mais seguro não foi o desktop (Cua), e sim um **navegador isolado**: um Chromium headless por tarefa, no worker da agência (`workers/computador`, a mesma máquina do worker de render). O desktop da seção 6 continua desligado.

### O que está ligado e o que está desligado

| Caso | Onde pede | Como roda | Estado |
|---|---|---|---|
| Capturar a tela inteira de um site de referência | Mesa Site › Referências, em cada endereço | roteiro fixo, sem modelo: abre, rola até o fim, captura computador e celular | **ligado** (custo zero de modelo) |
| Conferir se um post publicado está no ar | Agenda e Entrega › Publicação da Mesa › "Conferir no ar" | roteiro fixo: abre o link, lê status, og:title e o aviso de "não disponível" | **ligado** |
| Coletar dados públicos de concorrentes | Mesa Proposta › bloco Mercado | computer use (`computer_toolset_20260801` do Claude ou a ferramenta `computer` da OpenAI, esforço médio) | **ligado em 01/10**: prova real com o Claude Sonnet 5.5 (3 passos, US$ 0,025) e `COMPUTADOR_COM_MODELO_LIGADO=1` nos segredos; a frente CUS abriu para qualquer modelo com computer use (seção 9) |

### Travas (conferidas três vezes: na função, no banco e no worker)

1. **Confirmar do dono.** A tarefa nasce `aguardando_dono`. Só o admin confirma (`computador-do-agente`, ação `decidir`), e as travas são conferidas de novo no Confirmar. O worker só pega tarefa com `aprovado_por` e `aprovado_em` (RPC `computador_tarefa_pegar`).
2. **Lista de domínios.** A URL inicial entra na lista; extras só se forem domínios públicos (sem IP, localhost ou rede interna; no máximo 10). Navegação fora da lista é barrada dentro da página (link e `window.open`) e na rede.
3. **Nada de senha, pagamento ou login de cliente.** O pedido que fala em login, senha, pagamento ou em agir no site é recusado. Endereço de login, conta, cadastro ou checkout é recusado. Página com campo de senha, código ou cartão faz o worker parar, com o print de onde parou. O modelo não digita credencial, e-mail nem texto longo. Clique em campo de senha, envio de arquivo ou download é recusado.
4. **Só leitura.** Formulário não envia (bloqueado na página e na rede); POST, PUT e DELETE são bloqueados; download cancelado; janela nova fechada.
5. **Prova.** Um print por passo no Storage (`mesa/<cliente>/computador/<tarefa>/passo-NN.png`), visto na janela "Provas" (link de 10 minutos).
6. **Teto.** Passos (6, 4 e 25 por caso; máximo 60) e custo (US$ 0 nos fixos; US$ 1 na coleta; máximo 5). A RPC de passo devolve `teto` e a tarefa fecha com o que já tinha.
7. **Parar.** O dono ou quem pediu, a qualquer momento (`parar`). O worker vê no passo seguinte, e a conclusão não sobrescreve a parada (tudo com o token da trava).
8. **Uma tentativa por Confirmar** (sem laço de correção). Worker que cai no meio: a trava vence em 10 minutos e a tarefa vira "falhou" com o motivo. Aprovada e esquecida por mais de um dia sai da fila.

### Como o laço do computer use fala com a API (MOD2, 30/09)

Conferido na documentação oficial do computer use e do context editing em 30/09 (formas do corpo ainda sem prova contra a API real; ver "Prova real"):

- **Ferramenta:** `computer_toolset_20260801` (GA, sem cabeçalho beta, sem `name` nem tamanho de tela). Nos Claude Opus 5.5 e Sonnet 5.5 a ferramenta antiga `computer_20251124` dá 400. Cada ação chega como um `tool_use` com o nome da ação; toda resposta repete `toolset_name: "computer"`; a primeira ação que falha encerra o lote e as seguintes voltam com "Not executed: an earlier computer action in this turn failed.".
- **Só screenshot e zoom devolvem imagem;** as outras ações devolvem "OK". A prova do passo (print no Storage) continua saindo a cada turno, separada do que vai ao modelo.
- **Histórico só cresce.** Nos modelos 5.5 o pensamento fica preso à conversa (preserved thinking): apagar um print velho no cliente invalida o pensamento dos turnos seguintes e, nas contas criadas depois de 31/08/2026, o pedido volta 400. Os prints velhos agora são limpos pelo servidor (`context_management` com `clear_tool_uses_20250919`: a partir de 30 mil tokens de entrada, guarda os 3 últimos), o que não invalida o pensamento. Por garantia, o pedido leva `thinking.block_binding.prefix_mismatch_behavior = "drop_block"`. Cabeçalhos: `context-management-2025-06-27` e `thinking-binding-controls-2026-08-01`.
- **Cache:** marcador na ferramenta e cache automático no topo do pedido (o prefixo cresce a cada turno e é relido a US$ 0,20 por 1M).
- **Recusa do classificador** (`stop_reason: "refusal"`): a tarefa fecha como "falhou" com a categoria, e o que o turno custou vai para a carteira.
- **Modelo:** Sonnet 5.5 por padrão (US$ 2/10); `COMPUTADOR_MODELO=opus-5-5` na máquina troca pelo Opus 5.5 (US$ 4/20). O custo de cada turno usa o preço do modelo escolhido.
- **OpenAI:** o GPT-6.1 Sol também faz computer use (ferramenta `computer` da Responses API). O worker ainda fala só com a Anthropic; a troca de provedor fica para quando o dono ligar a coleta e quiser comparar.

### Rede interna (MOD2, 01/10)

O worker roda na máquina da agência, junto do render e do motor-codigo. Por isso o Chromium do agente não fala com a rede interna em pedido nenhum (página, imagem, script, fetch):
- `regraDoPedido` barra localhost, `*.local`, `*.internal`, `*.lan`, nome sem ponto, IP literal privado, de loopback, link-local, CGNAT e reservado (v4 e v6, inclusive `::ffff:127.0.0.1` e `http://2130706433/`);
- antes de abrir a página e em cada host novo de recurso, o worker resolve o DNS e barra o nome público que cai numa dessas faixas (a tarefa falha com o IP no motivo);
- o Chromium sobe com `--host-resolver-rules` que manda os nomes internos para `~NOTFOUND`.
Testado com um `<img src="http://127.0.0.1:porta/...">`, `localhost`, `[::1]`, `169.254.169.254` e um domínio que resolve para `10.0.0.5` (`workers/computador/testes/travas.test.ts`).

### Prova real do computer use (feita em 01/10)

Anthropic, 01/10: Claude Sonnet 5.5, 3 passos, US$ 0,025 (`workers/computador/tmp/prova-real-2026-10-01T13-22-14-087Z`); as duas tentativas antes pararam na chave (sem workspace e chave inválida), daí o `ANTHROPIC_WORKSPACE_ID` opcional. OpenAI, 01/10 (frente CUS): seção 9. Histórico do texto de 30/09: a prova era um comando: `npm run prova-real` em `workers/computador`, com a chave só na sessão. Ela roda uma coleta de ponta a ponta num site público, com teto de US$ 0,20 e 8 passos, e guarda em `tmp/prova-real-<data>/` cada pedido (sem a chave), cada resposta da API, os prints e o resumo. Se a API recusar alguma forma do corpo (400), o erro fica no resumo; corrija `corpoDoTurno` e rode de novo. Só depois de a prova passar e o dono ler as provas: `COMPUTADOR_COM_MODELO_LIGADO=1` na função `computador-do-agente` e no worker.

### Peças

- Regras puras: `supabase/functions/computador-do-agente/modulos/navegador.ts` (casos, URL, domínios, travas; importa `pareceCredencial` e os estados da parte antiga em `mesa-videos/modulos/computador-do-agente.ts`). Fora do `_shared` por causa do teto de 4 MB da publicação do Lovable.
- Função: `supabase/functions/computador-do-agente` (`estado`, `pedir`, `decidir`, `parar`, `provas`), `verify_jwt = true`.
- Banco: `20260930320200_navegador_do_agente.sql` (colunas, `computador_executores`, RPCs só da service_role, `ia_usos` aceita `computador`).
- Worker: `workers/computador` (`npm run worker`; testes com Chromium de verdade e com o SQL num Postgres em memória: `npm run teste`).
- Tela: `src/components/agentes/NavegadorDoAgente.tsx` (pedido, Confirmar, Parar e provas, tudo em janela central).

### Como ligar o worker

```
cd workers/computador
npm install
npm run navegador        (baixa o Chromium do Playwright, uma vez)
$env:SUPABASE_URL = "https://jjjtkowvxemvituvywvf.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<cole aqui, nunca em arquivo>"
npm run worker
```

Fontes da API: [computer use da Anthropic](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) (toolset GA, recomendações de segurança: VM ou contêiner dedicado, lista de domínios, nenhum dado sensível, humano confirma o que tem consequência), [computer use da OpenAI](https://developers.openai.com/api/docs/guides/tools-computer-use) (ferramenta `computer` nos GPT-6; navegador isolado, lista de sites, limites de passos, tempo e custo).

## 9. Qualquer modelo e mais ações (frente CUS, 01/10/2026)

Pedido do dono: "Eu posso usar o computer use com qualquer modelo? Em qualquer ação? Deixa bem completinho, bem pronto essa parte."

### Modelos

- **Qualquer modelo do catálogo marcado com computer use** (`ia_modelos.recursos.computer_use = true`, migration `20260930325000`): Claude Sonnet 5.5 (padrão) e Claude Opus 5.5, pela Anthropic (`computer_toolset_20260801`), e GPT-6.1 Sol e GPT-6 Astra, pela OpenAI (Responses API, ferramenta `computer`). O seletor das ações com modelo mostra só esses, com o porquê no "?": o computer use é uma ferramenta de cada provedor e só existe na API direta; pelo OpenRouter, e nos modelos sem a ferramenta, o modelo não vê a tela nem clica. A chave fica na máquina do navegador, por isso o modelo não precisa estar ligado em Modelos de IA.
- **O worker escolhe o provedor pelo modelo da tarefa** (`anthropic:...` ou `openai:...`) e lê o preço do catálogo. A pegada da fila (`computador_tarefa_pegar`, 5º argumento `_provedores`) só entrega tarefa de modelo cujo provedor tem chave na máquina; o worker antigo (4 argumentos) continua funcionando e só pega o que é da Anthropic.
- **Custo antes do Confirmar:** o pedido e o Confirmar mostram a estimativa (turnos típicos da ação vezes o turno típico do modelo, medido na prova real: 3.500 tokens novos, 6.000 em cache e 300 de saída por turno) e o teto. O que o modelo gasta vai para a carteira de IA do cliente (`ia_usos`, tarefa `computador`), mesmo quando a tarefa para no meio.

**OpenAI, conferido ao vivo em 01/10** (developers.openai.com/api/docs/guides/tools-computer-use e a referência de `POST /v1/responses`): ferramenta `{ "type": "computer" }`; a resposta traz `computer_call` com `call_id`, um lote em `actions` (`click {button, x, y, keys?}`, `double_click`, `scroll {x, y, scroll_x, scroll_y}`, `keypress {keys}`, `type {text}`, `move`, `drag {path}`, `wait`, `screenshot`) e `pending_safety_checks`; o cliente devolve `computer_call_output` com `{ type: "computer_screenshot", image_url: data URL, detail: "original" }` e segue com `previous_response_id`. Travas próprias: o lote passa pelas mesmas travas do Claude (cada ação da OpenAI é traduzida para a do toolset); ação recusada encerra o lote e o motivo vai em texto junto do print; **`pending_safety_checks` nunca é reconhecido sozinho**: a tarefa para e o passo volta para o dono.

**Prova real com a OpenAI (01/10, `npm run prova-real -- --provedor openai`, teto US$ 0,20):** GPT-6.1 Sol em https://www.example.com, feita, 2 passos, US$ 0,0058 (2.293 tokens de entrada, 126 de saída). A API aceitou o corpo (ferramenta `computer`, `reasoning`, `truncation: "auto"`, imagem de entrada). O modelo respondeu direto da primeira tela, sem pedir ação: a volta `computer_call` / `computer_call_output` ficou provada só com o fetch falso nos testes (formato da documentação), não contra a API real. Provas no scratchpad da entrega (`build/CUS-provas`).

### Ações (todas só de leitura de páginas públicas, com as travas da seção 8)

| Ação | Onde | Modelo | Teto | O que entrega | Vira insumo |
|---|---|---|---|---|---|
| Capturar a tela inteira (`captura_site`) | Mesa Site › Referências | sem modelo | 6 passos, US$ 0 | página inteira no computador e no celular | |
| Conferir post no ar (`conferir_post`) | Agenda e Entrega › Publicação | sem modelo | 4 passos, US$ 0 | no ar ou não, com o motivo | |
| **Conferir o site publicado** (`conferir_site`) | Mesa Site › Publicação (Domínio) | sem modelo | 6 passos, US$ 0 | prints no computador e no celular, tempo até o primeiro byte e de carga, peso, imagens pesadas e links quebrados do próprio site (HEAD de dentro do Chromium, sem seguir redirecionamento) | |
| Coletar dados de concorrente (`coleta_publica`) | Mesa Proposta › Mercado | o escolhido | 25 passos, US$ 1 | dados com a fonte | concorrente no bloco Mercado, com a fonte |
| **Capturar referência com notas de estilo** (`capturar_referencia`) | Mesa Site › Referências (botão "Notas de estilo") | o escolhido | 14 passos, US$ 0,60 | página inteira, cores, fontes, botão e logo lidos do CSS, notas de estilo (paleta, tipografia, ritmo, botões, fotos), levar e evitar | print nas referências e notas na observação da Direção (fica a versão anterior) |
| **Analisar perfil público** (`perfil_publico`) | Mesa Ads › Referências | o escolhido | 15 passos, US$ 0,60 | o que aparece sem login (og:title e og:description), bio, números, formatos e tom; rede que pede login para no que é público, sem chamar o modelo | referência E0 da biblioteca, com o print |
| **Pesquisar concorrentes visuais** (`concorrentes_visuais`) | Mesa Identidade › Pesquisa | o escolhido | 30 passos, US$ 1,50 | até 5 sites: topo e recorte do logo, cores e fontes do CSS e o que cada identidade comunica (uma sessão do modelo por site, até 5 turnos cada) | uma referência "concorrente" por site, com Desfazer |

Toda tarefa feita abre um **cartão** ("Resultado", em janela central): resumo, a página de onde veio, os prints marcados pelo worker (link de 10 min pela ação `cartao` da função) e o que a ação trouxe; o botão do cartão leva a coleta para a mesa de origem com um clique. A lista das ações, com o modelo e o custo médio real de cada uma, fica em Configurações › Estado dos motores › Navegador do agente.

### Peças novas ou mudadas

- Regras: `supabase/functions/computador-do-agente/modulos/navegador.ts` (casos novos, `modelosDoComputador`, `custoEstimadoDoCaso`, `POR_QUE_SO_ESTES_MODELOS`).
- Função `computador-do-agente`: `estado` devolve os modelos com computer use e o custo médio por ação; `pedir` aceita `modelo_id` e `urls`; ação nova `cartao`.
- Função `motores-estado`: motor "navegador" e a lista `acoes_do_navegador`.
- Banco: `20260930325000_navegador_qualquer_modelo_e_acoes.sql`.
- Worker (`cus-1.2`): `modelo.ts` (sessões Anthropic e OpenAI, laço único), `trabalho.ts` (ações novas), `principal.ts` (as duas chaves, último erro), `prova-real.ts` (`--provedor`, `--modelo`).
- Tela: `NavegadorDoAgente.tsx` (seletor de modelo, custo, sites), `ResultadoDoNavegador.tsx` (cartão), `src/lib/agentes/insumosDoNavegador.ts`.
- Atalhos: `workers/ligar/ligar-navegador.cmd`, `ligar-todos.cmd` (três janelas) e o conferir com Chromium, chave e variável.
