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
- **Regras puras** em `supabase/functions/_shared/computador-do-agente.ts`:
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
