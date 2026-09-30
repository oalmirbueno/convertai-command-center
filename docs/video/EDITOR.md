# Editor de vídeo da Mesa Edição (frente V-B, 26/09/2026)

Editor tipo CapCut/DaVinci dentro da Mesa Edição (`/mesa-edicao`, etapa Editar): prévia com o
Remotion Player, linha do tempo com trilhas, ferramentas manuais, skills determinísticas, troca de
câmera, continuar e transição por geração, Timestamp (palavra por palavra), referências de edição
com receita e agente editor com visão. Tudo edita o MESMO projeto
(`supabase/functions/_shared/projeto-de-edicao.ts`, coluna `video_versoes.projeto`) e salva sozinho
por `projeto_salvar` (função `mesa-videos`).

Regra que vale em tudo: **a IA escolhe e parametriza; quem calcula tempo é o código.** Mão, skill e
agente geram a mesma lista de operações puras (`src/lib/editor/operacoes.ts`); nada muda sem o dono
ver a lista e confirmar; tudo desfaz.

---

## 1. Pesquisa (resumo próprio, com fontes)

### Editores abertos com React/Remotion

| Projeto | O que é | Licença | Uso aqui |
|---|---|---|---|
| Remotion (`remotion`, `@remotion/player`) | Vídeo em React; Player toca a composição no navegador | Remotion License: grátis para pessoa física e empresa de **até 3 pessoas**; acima disso, Company License (Creators US$ 25 por mês por assento; Automators US$ 0,01 por render, mínimo US$ 100 por mês) | **Usado.** Só o Player e o núcleo, versão fixa 4.0.529 |
| Remotion Editor Starter | Modelo de editor pronto (linha do tempo, canvas, legendas) | **Pago**: US$ 600 (compra única para pessoa e empresa pequena; empresa maior precisa da Company License) | Não usado (pago) |
| Remotion Timeline | Componente de linha do tempo | **Pago**: US$ 300 | Não usado (pago) |
| designcombo/react-video-editor (hoje "OpenVideo") | Clone de CapCut/Canva | Dupla: grátis até 3 funcionários, licença paga acima; hoje usa PixiJS, não Remotion | Não usado (licença e motor diferentes) |
| Twick (`@twick/video-editor`) | SDK de editor com linha do tempo e legendas por IA | Sustainable Use License (não é licença aberta comum) | Não usado |

Conclusão: a linha do tempo, o inspector, as skills e o formato do projeto foram **escritos aqui**
(encaixam no formato que já existia e nas regras do painel: Safari 11 no resto do painel, sem
travessão, estado lembrado). Do Remotion vem só o Player e a composição.

**Licença do Remotion:** grátis até 3 pessoas. Em 26/09/2026 o dono confirmou que a gestão da
Aceleriq tem 2 pessoas (clientes não usam o editor), então vale a licença gratuita e o Player passa
`acknowledgeRemotionLicense`. Se a equipe passar de 3 pessoas, é preciso a Company License (a partir
de US$ 25 por mês por pessoa que desenvolve).

Fontes: [licença do Remotion](https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md),
[preços](https://www.remotion.pro/license), [Editor Starter](https://www.remotion.dev/docs/editor-starter)
e [loja](https://www.remotion.pro/store/editor-starter), [Timeline](https://www.remotion.pro/store/timeline),
[react-video-editor](https://github.com/designcombo/react-video-editor), [Twick](https://github.com/ncounterspecialist/twick).

### Render final (plano e custo)

| Caminho | Como | Custo | Quando |
|---|---|---|---|
| Máquina da agência | `npx remotion render` com a composição `ComposicaoDoProjeto` e o `projeto.json` do Pacote (o pacote já leva o projeto e o `edl.json`) | Zero por vídeo (luz e máquina); licença Remotion se mais de 3 pessoas | **Agora** (fase 1): mesma composição da prévia, qualidade máxima, sem nuvem |
| Remotion Lambda | Render na AWS da agência | Exemplo oficial: vídeo de 1 min ~US$ 0,017 (quente) a 0,021 (frio); 10 min ~US$ 0,10; mais AWS e a licença (Automators US$ 0,01 por render, mínimo US$ 100 por mês, se mais de 3 pessoas) | Fase 2, quando o volume pedir fila e render sem ninguém na máquina |
| Navegador (WebCodecs, `@remotion/web-renderer`) | `renderMediaOnWeb()` no próprio painel | Zero por render | Ainda não: pede WebCodecs; desenha CSS num canvas (sem `z-index`, `mix-blend-mode`, `object-position`), sem `Html5Video`/`OffthreadVideo`, sem multithread e lento em aba de fundo |

Fontes: [custo do Lambda](https://www.remotion.dev/docs/lambda/cost-example),
[render no navegador](https://www.remotion.dev/docs/client-side-rendering/) e
[limitações](https://www.remotion.dev/docs/client-side-rendering/limitations).

### Timestamp (palavra por palavra)

| Provedor | Palavra | Letra | Texto dado (alinhar) | Preço | Chave hoje |
|---|---|---|---|---|---|
| OpenAI `whisper-1` (`timestamp_granularities[]=word`) | sim | não | só como dica (`prompt`) | US$ 0,006 por min | `OPENAI_API_KEY` existe |
| OpenAI `gpt-transcribe` / `gpt-4o-transcribe` | **não** (sem tempos granulares) | não | não | - | - |
| ElevenLabs Scribe v2 (pela fal) | sim | não | não | US$ 0,008 por min | `FAL_KEY` existe |
| ElevenLabs Forced Alignment (pela fal) | sim | **sim** | **sim** | US$ 0,22 por hora iniciada (arredonda para cima por pedido) | `FAL_KEY` existe |
| Groq Whisper, Deepgram | sim | não | não | baratos | sem chave (não usados) |

Escolha: **transcrever = whisper-1** (mais barato com chave que já existe; o áudio vai em partes de
~60 s); **alinhar legenda/roteiro = Forced Alignment pela fal** (texto dado + áudio inteiro, palavra
e letra, uma chamada). Fontes: [OpenAI speech-to-text](https://developers.openai.com/api/docs/guides/speech-to-text),
[Scribe v2 na fal](https://fal.ai/models/fal-ai/elevenlabs/speech-to-text/scribe-v2),
[Forced Alignment na fal](https://fal.ai/models/fal-ai/elevenlabs/forced-alignment).

### Agente com ferramentas (padrão)

O laço do agente editor segue o padrão dos agentes de código: plano curto, chamada de ferramenta
tipada, resultado de volta, conferência, e fim; com limite de passos e de custo. Referências só de
padrão, **nenhum código copiado**: [Codex CLI](https://github.com/openai/codex) (Apache-2.0) e
[Claude Code](https://github.com/anthropics/claude-code) (repositório público, mas "todos os direitos
reservados": só a ideia do laço).

---

## 2. Onde está

| Parte | Arquivo |
|---|---|
| Formato do projeto (v2) e migração | `supabase/functions/_shared/projeto-de-edicao.ts` (`migrarProjeto`, `normalizarProjeto`) |
| Operações puras, histórico, apelidos | `src/lib/editor/operacoes.ts`, `historico.ts`, `apelidos.ts`, `tempo.ts` |
| Skills determinísticas | `src/lib/editor/skills/*` (`brabo`, `cortarSilencios`, `legendas`, `punchIn`, `organizar`, `antesDepois`, `receita`) |
| Fala, áudio, quadros, referência | `src/lib/editor/transcricao.ts`, `audio.ts`, `quadros.ts`, `referencia.ts` |
| Salvar sozinho | `src/lib/editor/autosave.ts` |
| Gerações (contrato V-A) | `src/lib/editor/geracao.ts` |
| Agente (lado da tela) | `src/lib/editor/agente.ts`, `cartao.ts` |
| Função nova | `supabase/functions/editor-video/` (`index.ts`, `ferramentas.ts`, `receita.ts`) |
| Tela | `src/components/mesa-edicao/AreaDoEditor.tsx` (encaixe, lazy) e `src/components/mesa-edicao/editor/*` |
| Comparador reutilizável | `src/components/comparar/ComparadorAntesDepois.tsx` |
| SQL pendente | `V-B-01-editor.sql` (scratchpad): tabela `video_receitas` (templates) |
| Testes | `src/test/editor-de-video.test.tsx`, `src/test/editor-de-video-tela.test.tsx` |

## 3. Formato do projeto (v2, compatível)

Tudo novo é opcional e tem padrão; projeto do formato 1 abre igual (`migrarProjeto`, testado).
- Fonte: `midia` (`video`, `audio`, `imagem`).
- Clipe: `comparar` (`fonte_b`, `entrada_b_s`, `modo` cortina, lado a lado, em cima e embaixo, divisão, alternar, `rotulos`) e `origem` (`manual`, `skill`, `angulo`, `continuar`, `transicao`, `cena`).
- Projeto: `transcricoes` (por fonte, **tempo da fonte**, versionada: `versao`, `em`, `origem`), `visoes` (o que o agente viu por trecho), `marcadores`, `continuidade` (personagem e cenário), `skills_aplicadas`, `referencias` (com a receita).
- O antes e depois que a V-A grava (`antes_depois_para_editor`: `estilo.layout` `lado_a_lado`, `cortina` ou `sequencia`, `par`, `lado`) é desenhado pela composição sem conversão.

## 4. Tela

- **Computador e notebook** (>= 1024 px): três colunas, cada uma rolando sozinha: esquerda (Mídia, Skills, Gerar, Timestamp, Referências), meio (barra e prévia), direita (Ajustes ou Agente); embaixo a linha do tempo.
- **Celular**: prévia, lista de cortes (toque leva o cursor) e as skills; a página rola normal, nada preso.
- **Linha do tempo**: régua (clique ou arraste para buscar), trilhas com som e visibilidade, miniaturas (quadros tirados no navegador, um por vez, com ícone quando a mídia não deixa ler), zoom (botões, régua e Ctrl + roda), seleção (Ctrl ou Shift soma), arrastar para mover (inclusive para outra trilha compatível), puxar a borda para aparar, ímã nas bordas e no cursor.
- **Atalhos**: espaço toca/pausa; J volta 1 s; K pausa; L toca (de novo: 2x); S divide no cursor; Delete tira (Shift puxa o resto); Ctrl+Z desfaz; Ctrl+Shift+Z ou Ctrl+Y refaz; setas andam 1 quadro (Shift 1 s); Home e End.
- **Salvar sozinho** (sem laço): só quando o conteúdo muda (assinatura com chaves em ordem), 1,5 s de respiro, um salvamento por vez; mudança durante a gravação vira uma gravação a mais; erro não tenta sozinho ("Tentar de novo"); conflito de revisão para e pede "Recarregar".
- **Estado lembrado** (`useEstadoDaTela`, por cliente): versão aberta, painel da esquerda e da direita, zoom, filtro da mídia, modelo e teto do agente, rascunho do agente, rolagem de cada painel.
- **Navegador antigo**: o editor pede Chrome/Edge 88+, Safari 14+ ou Firefox 85+. Abaixo disso a área mostra um aviso curto e a montagem para ler; se o módulo falhar ao abrir, o limite de erro mostra o mesmo (o resto do painel continua no piso Safari 11). O Remotion fica num pedaço só do editor (carregado sob demanda): medido no build, `EditorDeVideo-*.js` ~487 KB (153 KB gzip), fora da abertura do painel.

## 5. Skills (funções puras)

| Skill | O que faz | Base |
|---|---|---|
| Edição dinâmica (Brabo) | Corta silêncios, divide em batidas de ~2 s cortando nas pausas entre palavras, alterna zoom 1,00/1,08, corte seco, legenda de 4 palavras | kit brabo + clone 03 V2 |
| Cortar silêncios | Pausa >= 0,3 s vira respiro (0,10 s depois da fala, 0,08 s antes); pausa curta fica; nenhuma palavra sai | `clone-03-shopify/edit/build_edl.py` |
| Legendas animadas | Blocos de até N palavras no tempo da fala (depois dos cortes), palavra acesa na hora dela; estilos destaque, caixa, simples | HyperFrames / embedded-captions |
| Punch-in nos ganchos | Empurrão 1,00 a 1,12 no gancho; zoom alternado nos jump cuts da mesma fonte | Brabo, hyperframes-keyframes |
| Organizar por roteiro | Ordem das cenas do roteiro (ou ordem natural das cenas) e encosta | organizador de takes |
| Montar antes e depois | Dois clipes (ou duas imagens) viram um: cortina que atravessa, lado a lado, em cima e embaixo, divisão com rótulos, alternar | comparador |
| Fechar buracos | Encosta os clipes de cada trilha | EDL |
| Transições na troca de plano | Fade curto só onde muda a fonte | hyperframes-animation |

Cada skill devolve uma **proposta** (operações + como fica), mostrada no `CartaoDeAcao` da casa
(Confirmar/Cancelar e depois Desfazer). Aplicar é um passo só no Ctrl+Z.

## 6. Gerações no editor (contrato da V-A, `docs/video/CONTRATOS.md`)

- **Trocar câmera** (`angulo_gerar`): quadro do cursor (tempo exato, meio do quadro, PNG) sobe em
  `<cliente>/video/editor/quadros/`; órbita simples (frente, 3/4, perfil, costas, de cima, de baixo;
  perto, médio, longe), manter personagem/cenário, 1 a 4 variações.
- **Continuar a partir daqui** (`continuar_video`): último quadro do clipe (`saida - 1 quadro`, meio do quadro) e `arquivo_id` do vídeo.
- **Criar transição** (`transicao_gerar`): último quadro de A e primeiro de B.
- **Virar clipe** (`cena_gerar`, `modo: primeiro_quadro`): imagem da Mídia vira vídeo.
- Custo: 1) estimativa sem gasto (sem `custo_confirmado_usd`; `so_estimar` no ângulo; `409 confirmar_custo` também traz o custo); 2) "Gerar por US$ X" manda `custo_confirmado_usd` e `uid` do clique. `custo_mudou` pergunta de novo; `sem_cotacao` não gera; ação ausente = "em preparação".
- O resultado cai em `video_arquivos` (tipo `gerado` ou `angulo`) e aparece na Mídia; dali entra na linha do tempo (no cursor, no fim ou depois do clipe).
- Continuidade (personagem e cenário) fica no projeto e vai no `prompt` (o contrato não tem campo próprio).

## 7. Função `editor-video` (nova)

Só equipe com acesso ao cliente (JWT do chamador + `can_access_client`); gasto pelo motor
(`_shared/ia-motor.ts`) na carteira do cliente; `custo_maximo_usd` = o custo que a tela mostrou (passou:
`409 custo_mudou`).

| Ação | Entrada | Saída |
|---|---|---|
| `timestamp_estimar` | `client_id, modo, duracao_s` | `custo_usd, provedor, fonte` |
| `timestamp_parte` | `client_id, audio_path (<cliente>/video/editor/audio/...), inicio_s, duracao_s, texto?, idioma?, referencia_id, custo_maximo_usd` | `palavras [{t,i,f}]` já com o início da parte somado, `custo_usd, saldo_usd` |
| `alinhar_iniciar` / `alinhar_andamento` | áudio inteiro + texto; depois `pedido` | `pedido` (fila fal); `situacao`, `palavras`, `letras`; cobra uma vez (idempotente pela referência) |
| `agente_passo` | `modelo_id, raciocinio?, referencia_id (sessão), passo, ferramentas_usadas, teto_usd, pedido, contexto, historico` | `passo {plano, chamadas, resposta, terminou, recusadas}, custo_usd, gasto_usd` |
| `visao_descrever` | `fonte, modelo_id, quadros [{tempo_s, jpeg_base64}] (até 12), referencia_id, custo_maximo_usd` | `trechos` só nos tempos dos quadros enviados |
| `receita_ler` | quadros da referência + `medida` | `visao` (legenda, textos, B-roll, cor, gancho e CTA) |
| `receita_salvar` / `receita_arquivar` | template do cliente ou da agência (`client_id` nulo) | `receita` / `ok` (SQL V-B-01) |

Registro de uso com valores que o banco aceita hoje: agente editor `conversa`/`diretor_arte`; visão,
Timestamp e receita `leitura_referencia`/`leitor`; `referencia_tipo` `editor_*`.

## 8. Agente editor

- Modelo: qualquer modelo de texto ativo do `ia_modelos` (hoje OpenAI direto: GPT-5.5, 5.6 Luna/Sol/Terra, 6 Luna/Sol; OpenRouter: Claude Opus 5.5, GPT-6 Luna/Sol); esforço de raciocínio quando o modelo aceita. O agente só **sugere** um mais barato; o dono decide.
- Custo antes: estimativa por passo (tabela do catálogo) e teto por pedido (padrão US$ 0,50, máximo US$ 5). Travas: 6 passos, 12 ferramentas, teto conferido também no servidor (soma de `ia_usos` da sessão).
- Ferramentas (apelidos c1, c2; id cru é recusado): `ler_projeto`, `ler_fala`, `ler_visao`, `dividir`, `aparar`, `mover`, `remover`, `recortar`, `ajustar`, `inserir_texto`, `reordenar`, `fechar_buracos`, `aplicar_skill`. Rodam na tela, numa cópia; o fim é uma proposta com Confirmar/Desfazer.
- **Assistir o vídeo**: 1 quadro por segundo (até 24 por fonte, no meio da janela e no meio do quadro), lotes de 12 para um modelo com imagem; a descrição por trecho fica em `projeto.visoes` (não reprocessa). O agente só fala de imagem pelo `ler_visao`, citando o tempo.

## 9. Referências de edição (receita)

- Entrada: Mídia do cliente, upload (`<cliente>/video/editor/referencias/`), link do painel, ou link de
  Instagram/TikTok/YouTube (**só link**, nunca baixado: as plataformas não deixam; miniatura pública do
  YouTube; a tela pede o arquivo para a análise). Link de outro site também pede o arquivo (o CSP do
  painel só toca mídia do Supabase).
- **Medir** (sem custo, no navegador): quadros a cada 0,25 s (até 3 min) reduzidos a 32 x 18; troca de
  plano por diferença de quadros (acima de 0,12 e 3x a vizinhança, plano mínimo 0,3 s); prováveis
  punch-ins; duração média e mediana dos planos; energia do áudio e batidas por minuto; brilho,
  contraste e saturação.
- **Ler a edição** (pago, custo antes): até 10 quadros (um por plano) para um modelo com imagem:
  legenda (posição, tamanho, palavras por vez, destaque, caixa, animação), textos na tela, B-roll,
  transição predominante, cor, gancho e CTA. Nunca o conteúdo.
- **Aplicar** com os níveis do Estúdio: Idêntica (mesmo ritmo, zoom, transição e legenda), Próxima
  (planos 20% mais longos, zoom 1,05, palavras perto de 4), Inspirada (ritmo no meio do caminho para
  2,5 s, só o estilo da legenda), Criativa (corta silêncios e legenda padrão). Tudo pelas skills;
  proposta com Confirmar/Desfazer; "Lado a lado" abre o comparador com a referência e o vídeo do cliente.
- Templates por cliente e da agência (`video_receitas`, SQL V-B-01); sem o SQL, a receita fica no projeto.

## 10. Comparador antes e depois (para as outras mesas)

`src/components/comparar/ComparadorAntesDepois.tsx`, `export default`, props
`{ tipo: "imagem" | "video", antes, depois, rotulo?, proporcao?, modoInicial?, orientacao?, rotulos? }`,
com `antes`/`depois` como URL (contrato da V-A) ou `{ src, rotulo }`. Modos cortina (alavanca com mouse,
toque e setas), lado a lado e alternar; horizontal e vertical; vídeo sincronizado (play, pausa e tempo
juntos, correção acima de 0,1 s). Imagem funciona no Safari 11 (usa `-webkit-clip-path`).

Onde plugar nas mesas de imagem (sem mexer agora, outras frentes estão nelas):
- Mesa Foto: no resultado de edição/upscale/sem fundo (antes = original, depois = resultado), ao lado das ações do cartão da foto.
- Estúdio (Mesa): na versão nova de uma lâmina (antes = versão anterior, depois = atual).
- Mesa Vídeos: o `AntesEDepois.tsx` da V-A já procura este arquivo por `import.meta.glob`.

## 11. O que depende de fora

- **Deploy da `mesa-videos`**: ela importa `projeto-de-edicao.ts`; sem publicar de novo, o `projeto_salvar` do servidor antigo normaliza pelo formato 1 e **descarta** o que é novo (fala, visão, referências, antes e depois, continuidade).
- **Deploy da `editor-video`** (nova, já no `supabase/config.toml` com `verify_jwt = true`). Sem ela: Timestamp, agente, visão e "Ler a edição" mostram "em preparação"; o resto do editor funciona.
- **SQL V-B-01** para templates de edição.
- Licença do Remotion se a agência tiver mais de 3 pessoas.

---

## 12. Frente EDT (30/09/2026): render de verdade, corte pela onda, som e motion

Pedido do dono: "o agente edita pra mim, eu converso". O EDIT IA PRO (pacote autorizado pelo dono,
em `C:\AI\acervo-aceleriq\edit-ia-pro\`) entrou como ESPECIFICAÇÃO: as regras e os números medidos
foram reescritos no nosso padrão (a IA escolhe; quem calcula tempo é o código). Do pacote vieram só
os arquivos livres: sons CC0 (com o comprovante de cada um) e fontes OFL.

### 12.1 Render pela fila (F1)

| Parte | Onde |
|---|---|
| Fila | `render_pedidos` (SQL `20260930080000_render_pedidos.sql`): um pedido por clique (`client_id, uid`), um ativo por versão e tipo, tipos `render_final`, `amostra` (8 a 15 s) e `onda` |
| Pegar e travar | RPC `render_pedidos_pegar` (FOR UPDATE SKIP LOCKED, trava de 10 min renovada a cada progresso, 3 tentativas, esquecido 24 h sai); `render_pedidos_progresso` / `_concluir` / `_falhar` só com o token da trava; só `service_role` |
| Ações | `editor-video`: `render_pedir`, `render_status` (a tela lê no máximo a cada 15 s e só com pedido ativo), `render_cancelar` (`render.ts`) |
| Worker | `workers/render/` (Node 22.18+): baixa do Storage para o disco, roda a Remotion CLI com a `ComposicaoDoProjeto` (a MESMA da prévia), -14 LUFS em dois passos, sobe o MP4 pelo TUS em partes de 6 MB, grava em `video_arquivos` (tipo `render` ou `amostra`) e conclui |
| Tela | Botão **Renderizar** na barra do editor (`Renderizar.tsx`); "..." com Amostra de 12 s no cursor e Medir a onda; o cartão Exportar do agente virou **Renderizar** e o ZIP ficou como "Baixar ZIP" ao lado |

**Ligar o worker** (PowerShell, na máquina da agência; a chave só na sessão, nunca em arquivo):

```
cd workers\render
npm install
npx remotion browser ensure
$env:SUPABASE_URL = "https://jjjtkowvxemvituvywvf.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<cole aqui>"
npm run worker
```

Opcionais: `RENDER_WORKER_NOME`, `RENDER_CHROME` (Chrome Headless Shell já baixado),
`RENDER_PASTA`, `RENDER_INTERVALO_S` (15), `RENDER_CONCORRENCIA`, `RENDER_FFMPEG`, `RENDER_FFPROBE`.
`npm run uma-vez` faz um pedido e sai. Testes: `npm run teste` (fila no PGlite) e
`npm run ponta-a-ponta` (vídeo curto de exemplo, render de verdade, Storage local com TUS).

Máquina desligada: o pedido espera na fila e a barra diz "a máquina da agência parece desligada"
(worker não visto há 90 s e pedido parado há 2 min). Papel restrito em vez da service role: fica
para a F7 (mesmo worker no Modal).

### 12.2 Corte de verdade (F2)

- **Onda** (`_shared/onda-do-audio.ts`): RMS em janelas de 10 ms; limiar pelo chão de ruído de cada
  fonte (percentil 10 mais 35% do caminho até a voz); pausas guardadas em `projeto.ondas[fonte]` com
  o LUFS da voz. Palavra que o transcritor adiantou passa a começar quando a voz volta.
- **cortar_pela_onda**: nenhuma pausa acima de 0,25 s; emenda de 0,12 s (0,07 depois da fala, 0,05
  antes da próxima).
- **ficar_com_melhor_tomada**: falso começo, frase repetida e gagueira saem; fica a última tomada
  inteira; a lista do que saiu vai no cartão.
- **conferir_corte**: respiro acima de 0,25 s, palavra mordida, repetição e clipe curto. Só aviso.
- **Legenda padrão de 3 palavras** (`PALAVRAS_POR_LEGENDA`); o agente muda por comando (`legendar`).

### 12.3 Som e motion (F3)

- **Biblioteca CC0** (`_shared/som-do-editor.ts`, arquivos em `public/editor/sons/`, comprovantes em
  `public/editor/sons/licencas/`): 20 sons, pico medido por `workers/render/sons/medir-sons.mjs`.
- **Plano de sons**: o pico do som cai no quadro do auge do movimento da peça; 0,65 s entre sons
  (fica o mais importante); "poucos" = só os fortes, um a cada 2 s.
- **Trilha**: clipe de áudio com `estilo.papel = "trilha"`; 22 dB abaixo da voz (LUFS medidos pelo
  worker; na prévia, presumidos), sobe 6 dB nas pausas de 0,8 s ou mais; arquivo final em -14 LUFS.
- **Peças de motion** (`src/lib/editor/motion/catalogo.ts` e `editor/motion/Pecas.tsx`): rótulo,
  carimbo, lista (check ou riscada), passos, contador, notificação, polaroide, cartão final,
  lettering, barra, etiqueta de preço, comentário/CTA, selo e a logo (canto, cartão final, sting).
  Parâmetros tipados; entram na palavra dita; número, porcentagem e preço só se foram ditos.
  Letras OFL em `public/editor/fontes/`.
- **sugerir_animacoes**: o código monta as candidatas com o que foi dito; o Jev julga em uma chamada
  (Noul "pede animação?" e Choice "qual peça" por frase); o código escolhe pelo limiar 0,6 e pela
  densidade (poucas: 20 s; médias: 7 s).
- **Mensagens padrão** (`MensagemPadrao.tsx`): "Amostra pronta pra conferir" (player e estilos
  ligados n/5), "O que mudei" e o custo do pedido.

### 12.4 B-roll e elementos no agente (F4)

- `gerar_broll`: vídeo pela Mesa Vídeos (`gerar_video`, modo texto, motor sugerido "normal"), custo
  antes (409 `confirmar_custo` sem gasto), cartão "Gerar por US$ X"; pronto, "Pôr no trecho" põe numa
  trilha "B-roll" sem som por cima da principal.
- `gerar_elemento`: ícone ou objeto com fundo transparente (`elemento_estimar` / `elemento_gerar`,
  GPT Image), idempotente pelo uid do clique; entra na trilha "Elementos" no trecho pedido.
- Logo e foto real do cliente nunca pelo gerador: a logo vem do kit da marca aberta, pelo código.

### 12.5 O que depende de fora

- SQL `20260930080000_render_pedidos.sql` aplicado.
- Deploy da `editor-video` (ações novas) e da `mesa-videos` (o `projeto_salvar` normaliza pelo
  `projeto-de-edicao.ts`; sem publicar de novo, `ondas` e `mixagem` somem ao salvar).
- O worker ligado numa máquina com ffmpeg e Node 22.18+.

---

## 13. Frente MOT (30/09/2026): Mesa Motion e filme da marca

Pedido do dono: "no editor de vídeo, a área de motion e apresentação de empresa" e "um criador de
vídeos da marca, no final, para apresentação: para entregar ao cliente e usar como material,
portfólio e case", tudo agêntico e com escolha de modelo na hora. Método de
plano/p3-referencias.md §2.5 (claude-motion-design e product-film-skill, MIT, só como referência).

### 13.1 Onde está

| Parte | Onde |
|---|---|
| Tela | `/mesa-motion` (`src/pages/MesaMotion.tsx`, casca `MesaDeVideo` com `mesa="motion"`), etapas em `src/components/mesa-motion/*`, diretor de motion em `AgenteDoMotion.tsx` |
| Método (puro) | `_shared/motion-metodo.ts`: 9 etapas, ingredientes da entrevista, BRAND.md e beat sheet, 3 storyboards, cenas, assinatura do render, casar no ritmo, projeto do filme para a Mesa Edição, crítica |
| Kit e cena (puro) | `_shared/cena-hf.ts`: 10 peças (8 em 2D; carrossel de provas e logo em volume em 3D por CSS), invólucro HyperFrames, conferência da escrita do modelo, prompt da cena sob medida |
| Batidas (puro) | `_shared/batidas-da-trilha.ts`: andamento, batidas, compassos, drop e energia |
| Função | `supabase/functions/mesa-motion/` (`index.ts`, `acoes-do-motion.ts`), `verify_jwt = true` |
| Banco | `20260930180000_mesa_motion.sql`: `motion_filmes`, `portfolio_itens`, `render_pedidos` com `cena_hf` e `batidas` (`motion_id`), `video_arquivos` com `cena` e `still` |
| Worker | `workers/render/hyperframes.ts` (pedidos `cena_hf` e `batidas`), miniatura no render final (`trabalho.ts`) |

### 13.2 Cena HyperFrames pela fila

- Uma cena por pedido: `still` (quadro herói em PNG), `amostra` (5 s em meia resolução, MP4) ou
  `final` (WebM VP9 com alfa, em cada formato: 9:16, 1:1, 4:5, 16:9). Chave `cena:modo:formato`,
  um ativo por chave; still e amostra passam na frente.
- O worker monta a pasta (documento de `cena-hf.ts`, GSAP local, fontes OFL do painel, logo do kit
  e provas baixadas da pasta do cliente), roda `hyperframes lint` (erro = falha com a lista, sem
  nova tentativa) e `check` (layout e contraste vão para a crítica) e faz a saída. Folha de contato
  em tamanho de celular (4 quadros de 360 px) para a amostra e a final.
- Cena sob medida: o modelo escolhido escreve só o miolo (html, css e js que recebe `tl`, `D`, `U`);
  `conferirEscrita` recusa rede, relógio, sorteio, laço infinito, endereço externo, script e a
  classe `clip`. Uma cena por vez, teto por cena (padrão US$ 0,50, máximo US$ 2) conferido pela
  estimativa antes; recusa vira aviso e nada é trocado (sem laço).
- Na Mesa Edição, o `OffthreadVideo` lê `.webm` com `transparent` (a cena com fundo transparente
  vai por cima de outro vídeo); sobreposição em escala 1 perde o canto arredondado.

### 13.3 Filme e entrega

- Montar: um projeto por formato em `video_versoes` (rascunho, `video_id` fixo por formato): cenas
  em sequência na trilha de vídeo, música com `papel: "musica"` (sem duck: não há voz), efeitos CC0
  com o pico no quadro do movimento (0,65 s entre sons). O render final é o `render_final` da frente
  EDT (-14 LUFS), agora com miniatura (`resultado.miniatura_path`).
- Filme da marca: storyboard = roteiro de 6 a 10 planos (`gerado`, `real` ou `hf`); o plano gerado
  usa a Mesa Vídeos (`custo_estimar` e `gerar_video` com `custo_confirmado_usd`) e o vídeo escolhido
  do acervo entra como plano.
- Entregar: registra renders, miniatura, LUFS e nota no filme e no registro de ações
  (`motion_filme_entregue`, que o documento de entrega lê como "Filme da marca entregue");
  portfólio só com a autorização do cliente (quem, como, quando) em `portfolio_itens`.

### 13.4 Ligar

- SQL `20260930080000` (EDT) e depois `20260930180000` (MOT); deploy da `mesa-motion`.
- Worker: `npm install` em `workers/render` (traz `hyperframes@0.7.82` e `gsap@3.14.2`; o
  HyperFrames baixa o Chrome dele na primeira vez) ou `RENDER_HYPERFRAMES` e `RENDER_GSAP` apontando
  para uma instalação já feita. Teste local: `npm run motion-ponta-a-ponta` (PGlite, Storage local,
  OPENROUTER_API_KEY e TYPESAFE_API_KEY só na sessão).
