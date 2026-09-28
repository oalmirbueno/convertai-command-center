# Sistema de design do painel Aceleriq

Frente D1, 26/09/2026. Fundação que todas as telas seguem: mobile, notebook e desktop.
A identidade continua (fundo escuro, verde Aceleriq `#00A600`/`#00FF66`, fonte Outfit). O que muda é
organização, densidade e consistência.

Pedido do dono (resumo): mais limpo e profissional, sem container empilhado, sem texto empilhado, mesa
na largura toda, seletor de mesa elegante, agente fixo com rolagem certa, estado que não se perde,
menos texto, nada piscando, nada travando.

Referência aplicada: a Mesa (`/mesa`, `src/pages/MesaDoCliente.tsx` e `src/components/mesa/Aba*.tsx`).
Componentes: `src/components/sistema/` (importe de `@/components/sistema`).

---

## 1. Tokens

| Token | Valor | Uso |
|---|---|---|
| `--background` | `0 0% 5%` | Fundo da página. Nível 0. |
| `--card` | `0 0% 10%` | A única superfície elevada (Painel). Nível 1. |
| `--muted` | `0 0% 13%` | Poço dentro de um painel, faixa segmentada, esqueleto. Nível 2. |
| `--border` | `0 0% 17%` | Borda de painel e divisória fina. |
| `--primary` | verde da marca | Ação principal, etapa aberta, foco. Nunca fundo de área grande. |
| `--radius` | `0.75rem` | `rounded-lg` 12 px (painel), `rounded-md` 10 px (botão, campo), `rounded-sm` 8 px. Era 20 px. |
| Sombra | quase nenhuma | Só em popover/janela (já no shadcn). Painel não tem sombra. |

Três níveis de superfície, no máximo: fundo, painel, poço. Nada além disso.

Classes prontas em `src/components/sistema/estilos.ts`: `texto`, `campo`, `campoTexto`, `botao`,
`superficie`, `foco`, `etiqueta`, `larguraDaMesa`, `juntar`, `toqueCompacto`.

`juntar` resolve conflito do Tailwind (tailwind-merge): a classe que vem depois vence, então
`juntar(botao.secundario, "h-8")` fica com 32 px (antes o `h-9` da base vencia pela ordem do CSS). Diferença
do padrão: trocar o tamanho da letra não apaga o `leading-*` anterior (os tamanhos do painel são arbitrários
e não trazem altura de linha).

## 2. Tipografia (5 papéis, 4 tamanhos)

| Papel | Classe (`texto.*`) | Tamanho |
|---|---|---|
| Título da página | `tituloPagina` | 20 px semibold, tracking -0.01em |
| Título de seção | `tituloSecao` | 15 px semibold |
| Rótulo | `rotulo` | 12 px medium, cinza |
| Corpo | `corpo` | 13 px |
| Auxiliar | `auxiliar` | 12 px cinza, uma linha |

Sem CAIXA ALTA em subtítulo novo. Números com `tabular-nums`.

## 3. Espaçamento, grade e larguras

- Escala de 4/8: 4, 8, 12, 16, 20, 24, 32. Entre seções: 20 a 24 px. Dentro de painel: 16 (celular) e 20 px.
- Mesa: a área de trabalho usa a tela toda até **1760 px** (`larguraDaMesa`), com os gutters do painel
  (16 px no celular, 24 px de 768 para cima). Nada de coluna estreita no meio.
- Colunas: grade (`grid`) com `minmax(0,1fr)`; todo filho de grade/flex com `min-w-0`.
- Lateral de agente: 320 px (1024), 360 px (1280), 400 px (1440).

### Faixas (breakpoints)

| Faixa | Largura | Tailwind |
|---|---|---|
| Celular | < 640 | base |
| Tablet | 640 a 1023 | `sm:` / `md:` |
| Notebook | 1024 a 1439 (1280x720, 1366x768) | `lg:` / `xl:` |
| Desktop | >= 1440 | `desk:` (novo; não misture `desk:` e `2xl:` no mesmo elemento) |

## 4. Hierarquia: uma superfície por nível

- **Nada de cartão dentro de cartão dentro de cartão.** Seções se separam por espaço e por uma linha fina
  (`border-t border-border`), não por caixas.
- `Painel` só quando o bloco precisa se destacar (formulário que é o assunto, lista que é uma coisa só,
  calendário, cartão de mídia). Dentro do painel: divisória ou poço (`superficie.poco`), nunca outro painel.
- Grupos recolhíveis viram lista com divisória (ver `Hub` em `ContextoHub.tsx`).

### 4.1 Fundo e cartões (28/09, pedido do dono)

- **Fundo liso** nos dois temas. Nada de grade, manchas ou gradiente atrás do conteúdo: no claro deixava
  a tela com cara de suja e, no escuro, as seções pareciam transparentes. Claro: `--background` cinza-gelo
  (96,5%) com cartão branco por cima; escuro: 5% com cartão a 10%.
- **Cartão é sempre sólido** (`bg-card`). Nada de `bg-card/40`, `/50` ou `/60` em bloco de conteúdo;
  translúcido só em estado de passar o mouse ou vazio tracejado.
- Tela com duas ou mais colunas de seções (Central, perfis, painéis de cliente): cada seção num cartão,
  `<Secao cartao>` (canto 12 px, borda, `shadow-sm`, 16/20 px de respiro), com 16 px entre cartões.
  Dentro do cartão continua valendo: divisória ou poço, nunca outro cartão.
- Lista dentro de cartão vai de borda a borda (`-mx-4 sm:-mx-5`), para as divisórias tocarem o cartão.

### 4.2 Organização e respiro (28/09, pedido do dono)

- **Título de seção numa linha só.** Nunca quebra; se faltar espaço, reticências. O resumo do bloco
  recolhido vai na linha **de baixo**, não ao lado espremendo o título. Armadilha medida em 28/09: margem
  negativa (`-ml-1`) no botão do título tira a mesma medida da largura calculada e o título corta com
  espaço sobrando; para alinhar, use `relative -left-1`.
- **Nada espremido numa linha só.** Uma barra de controles tem no máximo **duas linhas organizadas**; se
  ainda não couber, o resto vai para um **seletor lateral ou menu "..."**. Nunca uma terceira fileira.
- **Nada de linha nova para um seletor pequeno** (ex.: "Pautas do mês | Arte rápida"): ele entra numa
  barra que já existe.
- **Agrupar antes de empilhar.** Área com muitas funções (ex.: direção do Estúdio: foto, referência, link,
  arquivo, logo, gerador) vira grupos com título curto, em grade alinhada, com espaço entre os grupos e
  controles do mesmo tamanho; o secundário de cada grupo vai num "...".
- **Escolha entre poucas opções de tamanho/formato**: seletor compacto, não fileira de botões grandes.
- **Tirar poluição nunca é tirar função.** Toda função continua lá, só mais organizada.
- **Rolagem**: uma por região, nunca rolagem dentro de rolagem, nada cortado sem poder rolar.

## 5. Texto: menos, sempre

- Página, seção e cartão mostram **só o título curto**. A explicação vai num **"?"** ao lado do título
  (`AjudaRecolhida`: passa o mouse no computador, toca no celular). Nada de parágrafo explicativo fixo.
- Linha auxiliar é **estado** (contagem, data, "3 de 9 completos"), em uma linha. Não é explicação.
- Não repetir o que a barra já mostra (o nome do cliente está na casca: o título é "Contexto", não
  "Contexto de Fulano").
- Frases curtas, sem travessão, sem exclamação.

## 6. Botões e ações

- **Um primário por área** (`botao.primario`). O resto: `secundario` (borda) ou `discreto` (texto).
- **Botão sozinho não ocupa uma linha**: ações vão na linha do título da seção/página (à direita). No
  celular, ícone ou menu "...", na mesma linha.
- Ícone sozinho: `botao.icone` e sempre `aria-label`.
- Ícone com texto que no celular vira só ícone: `BotaoComIcone` (ou `RotuloLargo` dentro de um botão/link).
- Área de toque: abaixo de 768 px todo botão e link tem 44 px de altura mínima (`src/styles/responsive.css`),
  menos os compactos do sistema (classe `toque-compacto`, que já vem em `botao.*`, `SeletorCompacto`,
  `Etapas`, `SeletorDeMesa` e no "?"; ou atributo `data-compacto`): esses ficam no tamanho desenhado e ganham
  os 44 px por um pseudo-elemento invisível. Botão pequeno feito à mão: some `toqueCompacto` ou `data-compacto`.
- `BarraDeAcoes` para resumo + ações; `fixa` gruda no pé em formulário longo.

## 7. Navegação

- **Mesas**: `CascaDaMesa` (cabeçalho fino) com `SeletorDeMesa` ("Mesa ▾"), seletor de cliente, marca,
  etapas, ações e tela cheia. A fileira antiga "Mesa · Mesa Ads · ..." saiu.
- **Etapas/abas principais**: `Etapas` (sublinhado verde, número opcional, nunca corta o texto; no
  celular rola para o lado por dentro).
- **Navegação secundária e filtros**: `SeletorCompacto`. Até 4 opções = segmentado; mais de 4 = um
  seletor com ícone (lista). Ex.: Mesa Foto "Biblioteca, Modelos, Clones, Book, Canvas" e, na Biblioteca,
  "prompts, referências, produto, alimento, serviço..." viram um seletor.
- **Lista única das mesas**: `MESAS` em `src/components/mesa-foto/TrocaDeMesas.tsx` (nome, ícone,
  descrição, caminho). Mesa nova é uma linha lá. A linha da Mesa Edição (`/mesa-edicao`) está pronta no
  comentário, para entrar quando a rota existir.
- **Lançador** (`src/components/lancador/Lancador.tsx`, regras em `src/lib/lancador.ts`): um botão só para
  agente Aceleriq (voz e IA), "Ajuda: como fazer nesta tela", tour e atalhos. O cliente vê só o "?".
  Mora **nas barras, nunca flutuando**: de 768 px para cima, ícone na barra do topo (ao lado da busca);
  no celular, item da barra de baixo. O menu abre preso à barra. Alt+A abre o agente e "?" a ajuda (só a
  variante da largura atual responde). Nada de botão flutuante novo sobre o conteúdo: ação de tela vai na
  linha do título ou na barra.

## 8. Área de trabalho e rolagem

Dono: "o agente tem que ficar fixo; rolar um lugar não rola tudo; sempre separadinho".

- `AreaDeTrabalho`: de 1024 px para cima ocupa a altura da janela abaixo do cabeçalho (medida em px por
  JS, sem `dvh`, que o Safari 11 não tem; recalcula ao redimensionar, girar e ligar a tela cheia). Cada
  região rola sozinha; a página não rola junto (o body ganha `data-area-de-trabalho` e o CSS tira o recuo
  de baixo e tira o botão de ajuda de cima do campo do agente).
  - principal: rola por dentro (`RegiaoRolavel`), ou `principalRolavel={false}` e a aba põe a
    `RegiaoRolavel` só na lista longa (ex.: Entrega).
  - lateral: o agente, parado. Recolhível (lembra no navegador). `nasceRecolhida` começa recolhida enquanto
    a pessoa não escolheu (Canvas). Abrir de fora: `abrirLateralDaArea()` ou a prop `pedidoDeAbrir`.
  - **Celular e tablet: a página rola normal** (nada de caixa com rolagem própria prendendo o dedo) e o
    agente vira botão flutuante que abre em tela cheia (gaveta, fica montada: a conversa não se perde).
    Botão flutuante reserva o fim da página (`useReservaFlutuante`): rolando até o fim, nada fica por baixo dele.
- `RegiaoRolavel`: `modo="lg"` (padrão) só rola por dentro de 1024 para cima; `modo="sempre"` só em caixa
  de altura fixa em toda largura (conversa, janela). Sombra sutil em cima/embaixo quando há mais.
  `overscroll-behavior: contain`. Com `memoria`, **guarda a posição** (trocar de etapa, reabrir, dado
  novo chegando e esqueleto encolhendo não jogam para o topo; vale também sair e voltar). Trocar para uma
  chave sem posição guardada volta ao topo antes da pintura. O elemento que rola é `relative` (prende o que é
  absoluto lá dentro, como o select escondido do Radix, que esticava a página).
- Sticky só dentro da própria região. Nada grudado no topo por cima do conteúdo.
- `scroll-mt-*` grande (para o cabeçalho da página) vira `lg:scroll-mt-4` dentro de região.

## 9. Agentes

`PainelDoAgente`: cabeçalho fixo (ícone, nome, uma linha, "?", recolher/fechar), topo fixo opcional
(modos), **mensagens rolando por dentro**, avisos fixos, **compositor fixo embaixo** (atalhos, campo,
microfone, enviar). Peças avulsas para agentes grandes: `CabecalhoDoAgente`, `MensagensDoAgente`,
`CompositorDoAgente` (o Agente do mês usa as peças dentro da janela grande; o diretor do Estúdio usa as
mesmas peças dentro da coluna dele, sem mudar comportamento).

Texto da conversa (dono, 28/09: "muito curtinho, não consigo ler"): 14 px com linha 1,6 em todo agente.
`TextoDoAgente` já nasce assim; o balão é `BalaoDaConversa de="usuario" | "agente"` (ou `conversa.balao` +
`conversa.doUsuario`/`conversa.doAgente` de `estilos.ts`); apoio dentro da conversa (vazio, lendo) é
`conversa.apoio`; o campo de digitar dentro do `CompositorDoAgente` fica em 14 px sozinho.

## 10. Formulários

- Rótulo **em cima**, altura única de campo (36 px, `campo`), apoio em uma linha embaixo, erro no lugar
  do apoio (`CampoDeFormulario` liga `id`, `aria-describedby`, `aria-invalid`).
- `GrupoDeCampos`: 2 colunas no computador, 1 no celular (3 com `colunas={3}` de 1024 para cima).
- Ajuda longa do campo: `ajuda` (o "?").

## 11. Estados

- **Vazio** (`EstadoVazio`): ícone discreto, título curto, uma linha, a ação que resolve. `compacto` dentro de listas.
- **Carregando** (`Carregando`): esqueleto **na região**, com a forma do que vem (`lista`, `grade`, `aba`).
  Nunca tela inteira bloqueada; nunca spinner solto no meio do nada.
- **Erro** (`EstadoDeErro`): o que houve em uma frase e "Tentar de novo".
- **Não trava**: ação longa roda sem congelar (botão com estado, cronômetro); o resto da tela segue usável.
- **Nada pisca**: esqueleto só na primeira carga (depois, dado velho fica na tela enquanto relê); nada
  alterna sozinho; imagem não some e volta; medidas só mudam quando mudam de verdade (a área nasce na altura
  certa, antes da pintura).

## 12. Estado que não se perde

`useEstadoDaTela(chave, inicial, { validar, esperaMs, rota })`: `useState` que lembra, por usuário + rota + chave
(ponha o cliente na chave). `rota` fixa a rota (página que troca de endereço sem desmontar, como o Comercial:
`useEstadoDoComercial` é só isso com `rota: "/comercial"`). Etapa/aba interna, filtros, seleção, rascunho de texto (grava com respiro de 300 ms),
posição de rolagem (via `RegiaoRolavel memoria`). Armazenamento com try/catch (Safari privado segue
funcionando sem lembrar). Vence em 30 dias. O que já vai para o servidor continua indo.

A Central tem uma versão anterior da mesma ideia (`src/components/central/useEstadoDaTela.ts`, prefixo
`tela:v1:`, com `useRolagemDaTela`). Ela continua lá de propósito: trocar agora mudaria o formato guardado e
apagaria o que a equipe já tem salvo. Tela nova usa o do sistema; quem redesenhar a Central migra com leitura
do formato antigo.

Na Mesa: parte aberta e modo do agente no Contexto, rascunho do agente de contexto e do agente do mês,
rolagem do Contexto, do Mês e da lista de Entrega. Etapa e mês já moram no endereço e em "onde parou".

## 13. Listas, tabelas e mídia

- Lista: linhas com divisória (`divide-y`), sem caixa por linha. Ação da linha à direita.
- Tabela: cabeçalho com `texto.rotulo`, números à direita com `tabular-nums`; no celular vira lista.
- Cartão de mídia: a imagem manda (sem moldura extra), legenda em uma linha, ações no hover (e sempre
  visíveis no celular). Proporção por `padding-bottom` (sem `aspect-ratio`). Nunca escurecer foto.

## 14. Compatibilidade (Safari 11 / Chrome 64)

Sem `gap` em flex (só em grid: use margem / `space-x` / `[&>*+*]:ml-2`), sem `aspect-ratio`, `:has`,
`min()/max()/clamp()` em classe arbitrária, lookbehind, `\p{}`, grupo nomeado, `.at()`, `Object.hasOwn`.
Sem `dvh/svh` como única medida. Sem ResizeObserver obrigatório (MutationObserver + resize).

## 15. Componentes (API)

| Componente | Props principais |
|---|---|
| `CascaDaMesa` | `mesa`, `titulo`, `clientId`, `marcaId?`, `cliente`, `marca?`, `etapas?`, `acoes?`, `telaCheia`, `abaixo?`, `etapasEmLinhaPropriaAte?: "xl" \| "2xl"`, `className?`, `children` |
| `SeletorDeMesa` | `atual`, `clientId`, `marcaId?`, `className?` (Alt+M abre; 1 a 9 escolhe) |
| `Etapas` | `itens: {valor, rotulo, dica?, contador?, destaque?, icone?, dados?}[]`, `valor`, `onEscolher`, `rotulo` (aria-label), `numerar?`, `depois?` |
| `SeletorCompacto` | `opcoes: {valor, rotulo, icone?, contador?, descricao?, desativada?}[]`, `valor`, `onEscolher`, `rotulo`, `icone?`, `modo?`, `listaQuandoNaoCabe?` (o segmentado vira lista sozinho quando algum rótulo corta ou a faixa passa da borda; medido antes da pintura; ao alargar tenta de novo), `larguraTotal?` |
| `AreaDeTrabalho` | `children` (principal), `lateral?`, `rotuloDaLateral?`, `iconeDaLateral?`, `larguraDaLateral?: "padrao" \| "larga"`, `principalRolavel?`, `rotuloDoPrincipal?`, `memoria?` (lateral recolhida), `memoriaDaRolagem?`, `nasceRecolhida?`, `pedidoDeAbrir?` (muda a cada pedido). Função `abrirLateralDaArea()` abre de qualquer lugar (computador: tira do recolhido; celular: abre a gaveta) |
| `RegiaoRolavel` | `modo?: "lg" \| "sempre"`, `rotulo?`, `memoria?`, `sombras?`, `sobre?: "fundo" \| "cartao"`, `className?`, `classeDeFora?`, `onScroll?`, ref = o elemento que rola |
| `PainelDoAgente` | `titulo?`, `descricao?`, `icone?`, `acoes?`, `topo?`, `avisos?`, `compositor?`, `refDasMensagens?`, `rotuloDasMensagens?`, `semMoldura?`, `children` (mensagens) |
| `Secao` | `titulo?`, `descricao?` (estado), `acao?`, `ajuda?`, `divisoria?`, `nivel?`, `id?`, `data-*`. As ações quebram por dentro no celular (o título guarda 96 px). Recolher (28/09): `recolher="<area>:<bloco>:<cliente>"`, `resumo?` (à vista recolhida), `recolhidaDeInicio?`; o título vira o botão, descrição e ações somem recolhida |
| `CabecalhoDeSecao` | só o cabeçalho da Secao: `titulo?`, `descricao?`, `acao?`, `ajuda?`, `rotuloDaAjuda?`, `nivel?`, `icone?`, `truncar?`, `classeDoTitulo?`, `recolher?: { recolhido, onAlternar, resumo? }`, `className?`, `data-*`. Os cabeçalhos das mesas (`CabecalhoDaParte` da Mesa Ads, `CabecalhoDaEtapa` da Publicidade, `Cabecalho` dos Roteiros) usam este |
| `Painel` | `titulo?`, `descricao?`, `acao?`, `ajuda?` (o "?" ao lado do título; some na impressão), `rodape?`, `semEspaco?`, `as?` |
| `CabecalhoDePagina` | `titulo`, `descricao?`, `acoes?`, `ajuda?`, `voltar?: {para, rotulo}`, `nivel?`. As ações quebram por dentro no celular (o título guarda 120 px) |
| `FaixaDeNumeros` | `itens?: {rotulo, valor, apoio?, aoLado?, ponto?, corDoValor?, lado?, extra?, para?, aoClicar?, dica?, chave?}[]` ou `children` com `CelulaDeNumero`; `rotulo?`, `colunas?: 1..6` (2 no celular; nunca mais que os itens), `grade?` (classes exatas), `tamanho?: "grande" \| "compacto"`, `apoioAoLado?`, `semMoldura?` (já dentro de um Painel), `data-*`. `para` = número que leva a outra tela (link de verdade) |
| `CelulaDeNumero` | `rotulo`, `valor`, `apoio?`, `lado?`, `destaque?`, `tamanho?`, `children` (barra, minigráfico) |
| `CampoDeBusca` | `valor`, `onMudar`, `placeholder`, `rotulo` (aria-label), `className?` (lupa, campo de 36 px, "Limpar busca") |
| `CampoDeEscolha` | `rotulo`, `children` (pílulas, segmentado), `className?`: rótulo em cima de controle que não é campo de texto |
| `BotaoComIcone` / `RotuloLargo` | `icone`, `rotulo` (some abaixo de 640 px; vira o aria-label), `variante?: keyof botao`, `onClick?`, `disabled?`, `type?`, `aria-label?`, `title?` / `children` |
| `JanelaDoCelular` | `aberta`, `titulo`, `onFechar`, `rodape?` (ações fixas), `larga?` (520 px), `rotuloDoFundo?`, `classeDoCorpo?`, `children`. Nasce no body (por cima da barra de baixo), sobe de baixo no celular, Esc fecha |
| `useReservaFlutuante` | `(ativo, altura = 72)`: enquanto um botão flutua sobre o conteúdo (abaixo de 1024 px), reserva essa altura no fim da página |
| `CampoDeFormulario` | `rotulo`, `apoio?`, `erro?`, `ajuda?`, `obrigatorio?`, `largo?`, `children` (o controle) |
| `GrupoDeCampos` | `titulo?`, `descricao?`, `colunas?: 1 \| 2 \| 3`, `children` |
| `EstadoVazio` / `Carregando` / `EstadoDeErro` | `titulo`, `descricao?`, `acao?`, `icone?`, `compacto?` / `forma?`, `linhas?`, `rotulo?` / `titulo?`, `descricao?`, `acao?` |
| `BarraDeAcoes` | `inicio?`, `fixa?`, `children` (botões) |
| `AjudaRecolhida` | `children` (texto), `rotulo?`, `titulo?`, `lado?` |
| `useEstadoDaTela` | `(chave, inicial, { validar?, esperaMs?, rota? })` devolve `[valor, mudar, esquecer]` |

Ficaram locais (um uso só, não promovidos): `Recolhivel` (EsteiraClientSheet), `SemanaNav` (AdminEsteira),
`useLarguraMinima(1280)` (AdminComercial). O "useEstreito/useLargura640" que Pedidos, Aprovações e Execução
repetiam virou `listaQuandoNaoCabe` do `SeletorCompacto`.

Impressão ("Salvar PDF"): `src/index.css` (`@media print`) põe o conteúdo do painel no fluxo normal (no
celular ele é uma camada fixa com rolagem própria), tira barras, lançador, agente e o que flutua, e deixa o
fundo branco. Área de trabalho e regiões com rolagem própria viram página corrida.

---

## 16. Checklist de revisão visual (toda tela, toda frente)

Rodar em **375, 768, 1280x720, 1366x768, 1440 e 1920**:

1. Sem rolagem lateral da página (`document.documentElement.scrollWidth <= innerWidth`).
2. Nenhuma coluna espremida, nenhum texto de etapa/botão cortado, nenhum buraco (coluna vazia ao lado).
3. Nada cortando outro elemento, nada sobreposto (inclusive botões flutuantes sobre campo ou ação).
4. No máximo 3 níveis de superfície; nenhum cartão dentro de cartão.
5. Só título curto; explicação no "?"; nenhuma linha auxiliar com mais de uma linha.
6. Um primário por área; nenhum botão sozinho numa linha inteira.
7. Filtros e navegação secundária com mais de 4 opções estão num seletor.
8. Formulário: rótulo em cima, campos da mesma altura, 2 colunas no computador e 1 no celular.
9. Rolar a área principal não mexe o agente; rolar a lista não rola a página; o campo do agente fica sempre visível.
10. Celular sem rolagem presa: nenhuma caixa com rolagem própria dentro da página (só janela/gaveta).
11. Trocar de etapa e voltar, reabrir um painel, chegar dado novo: a rolagem fica onde estava.
12. Sair e voltar (outra rota, recarregar): aba interna, filtros, seleção e rascunhos continuam lá.
13. Tela parada = nada muda sozinho (esperar 10 s olhando: nada pisca, pula ou troca de lugar).
14. Carregando mostra esqueleto na região; o resto da tela continua usável; erro com "Tentar de novo".
15. Foco visível no teclado em tudo que clica; ícone sozinho com `aria-label`.
16. Tela cheia da mesa (e Esc) funcionando; seletor de mesa leva o cliente junto.
17. Claro e escuro: fundo liso, cartões sólidos, nada transparente sobre o fundo.
18. Nenhum título de seção quebrado em duas linhas; resumo recolhido embaixo do título.
19. Nenhuma barra com mais de duas linhas de controles; o que sobra está num seletor ou menu.
20. Áreas com muitas funções agrupadas com título curto e respiro entre os grupos (ver 4.2).

Como conferir sem o Supabase real (harness da D1, fora do repositório):
1. Subir o Vite pela API (`createServer`, `configFile: false`, `root` no repositório, `process.chdir` para
   ele) com `VITE_SUPABASE_URL=http://harness.supabase.test` e um plugin `transformIndexHtml` que injeta um
   script no `<head>`.
2. O script grava uma sessão falsa em `sb-harness-auth-token` e troca `window.fetch`: tudo que vai para
   `harness.supabase.test` recebe dados sintéticos (perfil admin, 3 clientes, algumas tarefas); qualquer
   `*.supabase.co` é recusado. WebSocket do tempo real vira um objeto mudo.
3. Playwright (o `chrome-headless-shell` já baixado) fotografa as 6 larguras e mede
   `scrollWidth`, elementos que passam da borda, altura das regiões e duas fotos com 6 s de diferença
   (tela parada tem de dar igual).
4. No fim: parar o servidor e apagar `node_modules/.vite-harness-*`.

## 17. Mapa de telas para as próximas frentes

| Área | Telas (rotas) | Arquivos principais |
|---|---|---|
| Mesas restantes (corpo) | `/mesa-ads`, `/mesa-foto`, `/mesa-videos`, `/mesa-publicidade`, `/mesa-roteiros` (e `/mesa-edicao` quando existir) | `src/pages/Mesa*.tsx`, `src/components/mesa-ads`, `mesa-foto`, `mesa-videos`, `mesa-publicidade`, `mesa-roteiros` |
| Mesa (restos) | Campanhas por dentro (CampanhaDetalhe), Estúdio (só aparência), fila de prioridades, custos | `src/components/mesa/Campanha*.tsx`, `AbaEstudio.tsx`, `FilaDePrioridades.tsx`, `PainelDeCustos.tsx` |
| Central e Ciclo | `/central`, `/ciclo`, `/ciclo/revisao`, `/aprovacoes`, `/execucao`, `/pedidos`, `/briefings` | `AdminExperience.tsx`, `AdminCiclo.tsx`, `AdminApprovals.tsx`, `AdminExecucao.tsx`, `AdminRequests.tsx`, `AdminBriefings.tsx`, `src/components/central`, `ciclo`, `execucao` |
| Dashboard, Projetos, Kanban, Agenda | `/dashboard`, `/projetos`, `/kanban`, `/calendario`, `/timeline` | `Index.tsx`, `AdminDashboard.tsx`, `Projects.tsx`, `Kanban.tsx`, `EditorialCalendar.tsx`, `TimelinePage.tsx`, `src/components/dashboard`, `editorial` |
| Clientes, CRM, Comercial | `/clientes`, `/comercial`, `/comercial/:aba`, `/contratos`, `/anuncios`, `/metricas`, `/relatorios` | `Clients.tsx`, `AdminComercial.tsx`, `AdminContracts.tsx`, `AdminAds.tsx`, `AdminMetricas.tsx`, `AdminReports.tsx`, `src/components/clients`, `comercial`, `ads`, `reports` |
| Financeiro | `/financeiro`, `/financeiro/projecao` | `AdminFinanceiro.tsx`, `AdminProjection.tsx`, `src/components/finance` (não quebrar `FinanceV2.tsx`) |
| Arquivos e Workspace | `/arquivos`, `/workspace`, `/cofre` | `AdminFiles.tsx`, `ClientVaultPage.tsx`, `src/components/workspace`, `vault` |
| Portal do cliente | `/dashboard` (cliente), `/onde-estamos`, `/documentos`, `/aprovacoes`, `/pedidos`, `/relatorios`, `/perfil`, `/ver-como-cliente` | `ClientDashboard.tsx`, `ClientJourneyUpdates.tsx`, `ClientDocuments.tsx`, `ClientApprovals.tsx`, `ClientRequests.tsx`, `ClientReports.tsx`, `ClientFinanceiro.tsx`, `ProfilePage.tsx`, `src/components/client` |
| Configurações e sistema | `/config`, `/equipe`, `/novidades`, `/api-docs`, `/conectar-mcp` | `SettingsPage.tsx`, `Team.tsx`, `Novidades.tsx`, `ApiDocs.tsx`, `MCPConnect.tsx` |
| Casca do painel | barra do topo, menu do celular, barra de baixo, notificações | `AppLayout.tsx`, `MobileBottomNav.tsx`, `NotificationsPanel.tsx` |
| Públicas | login, primeiro acesso, briefing, contrato, quiz | `Login.tsx`, `FirstAccess.tsx`, `BriefingPublic.tsx`, `ContractPublic.tsx`, `QuizPublicPage.tsx` |

Ordem sugerida por impacto: mesas restantes, Central/Ciclo, portal do cliente, Dashboard/Projetos/Kanban/Agenda,
Clientes/CRM/Comercial, Financeiro, Arquivos/Workspace, Configurações.
