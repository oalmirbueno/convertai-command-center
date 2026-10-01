# Canvas: cartões Vídeo e Quadro (frente CNV, 30/09/2026)

Pedido do dono: "falta funcionar o canvas nos vídeos também; deixe o canvas melhorado, mais inteligente e mais completinho".

## Por que não funcionava

O Canvas da Mesa Foto só reservava o lugar do vídeo. O cartão "Vídeo" ficava desligado na paleta ("em breve"), a função recusava o tipo `video` e a cena mostrava "Vídeo da cena (Mesa Vídeos, em breve)". Era código, não operação. Nos dados de produção de 30/09 havia 10 canvases, nenhum pedido de vídeo saído do Canvas e um só pedido de vídeo no painel inteiro (um ângulo). O motor de vídeo existe e responde pela Mesa Vídeos (`mesa-videos`, `cena_gerar`). O FAL já foi usado com sucesso para recorte e ampliação.

## Cartão Vídeo

- Tem três alças na esquerda.
  - **1º quadro:** a foto de um Resultado.
  - **Último quadro:** opcional. É a foto de outro Resultado e faz a emenda entre cenas, no modo `primeiro_ultimo`.
  - **Continuar:** o vídeo de outro cartão Vídeo. Usa a extensão nativa do motor ou, se ela não existir, o último quadro tirado no navegador. Se o navegador não conseguir tirar o último quadro, o Gerar para com um aviso e nada é cobrado: nunca recomeça do 1º quadro do clipe anterior.
  - Continuar não convive com a foto do 1º nem do último quadro (a tela não deixa ligar, e a função recusa).
- A saída leva o vídeo pronto para um Quadro ou para outro Vídeo.
- Ajustes:
  - motor de vídeo, por nível, com o estado do servidor (pronto ou falta chave);
  - duração e formato, dentro do que o motor aceita (nas faixas longas aparecem as usuais mais a mínima e a máxima, então 10, 12 e 15 s sempre estão lá; trocar de motor leva a duração para a mais próxima que ele aceita);
  - câmera, com 10 movimentos em palavras, e a câmera pronta da Higgsfield quando o motor tem;
  - áudio, que usa a fala da narrativa da cena;
  - 2 variações;
  - o pedido ao motor, que pode ser escrito pela cena, sem IA;
  - o que evitar.
- O botão Gerar mostra o custo antes e só chama `cena_gerar` ou `continuar_video` depois do Confirmar. São a mesma carteira e as mesmas regras da Mesa Vídeos: idempotência por `uid`, nenhuma nova tentativa e cobrança só do que ficar pronto. A foto de uma cena vai com `plano_ref = c<número>` e `tipo = gerar_plano`.
- O cartão guarda os pedidos em `dados.video.pedidos`: id, estado, erro, custo e os vídeos prontos (`arquivo_id`, `storage_path`). O vídeo fica em `video_arquivos` e aparece na Mesa Vídeos, em Resultados, para aprovar e mandar para a Edição.
- O andamento é consultado sem laço de correção: ao abrir o canvas (se houver pedido em andamento), no botão Conferir e, enquanto o canvas está aberto, com intervalo crescente (45 s, 90 s e depois a cada 3 min) até o estado final ou o prazo do motor (`prazo_min`). Falha de consulta vai para o console e para a tela, e a próxima segue agendada. O servidor também trava 15 s por pedido.
- Pendência de outra frente (mesa-videos): `gerar_status` aplica `passouDoPrazo` antes de perguntar ao provedor. Quem volta depois do prazo perde um vídeo que o provedor já terminou e cobrou. A correção é consultar o provedor antes de marcar erro por prazo.
- O texto das camadas do Quadro não passa pelo filtro da persona (não vai a gerador de imagem): "Moda infantil" ou "a cara da sua marca" salvam normalmente. O pedido do cartão Vídeo, que vai ao gerador, continua conferido, e o erro diz o cartão e o campo.
- Para "Animar", há três caminhos: o botão Animar no Resultado, o "Animar" da cena nos ajustes e na História, e o "Animar as que faltam" da História. Cada um cria o cartão Vídeo ao lado, já ligado ao 1º quadro, com o movimento escolhido pelo enquadramento da cena.

## Cartão Quadro (composição animada em camadas)

O modelo é `supabase/functions/mesa-foto/modulos/quadro-animado.ts`. Ele é puro e é o mesmo na tela, na exportação e no render.

- **Camadas:** texto, imagem, vídeo, forma (retângulo, pílula, círculo, linha) e logo (do kit da marca, sempre pelo código). Cada camada pode ser vista, travada, renomeada, duplicada, levada para a frente ou para o fundo e agrupada.
- **Palco:**
  - alças de tamanho (cantos mantêm a proporção em mídia; Shift troca) e de giro (de 15 em 15 graus);
  - encaixe com guias no centro, nas bordas, na margem de 6% e nas outras camadas (Alt solta o encaixe);
  - zoom de 50% a 200%;
  - proporções 9:16, 4:5, 1:1 e 16:9;
  - alinhar em 6 direções e distribuir.
- **Animação:**
  - entrada (aparecer, subir, descer, dos lados, zoom, pulo, revelar) e saída;
  - movimentos prontos (Ken Burns, flutuar, pulsar, deslizar);
  - até 12 chaves por camada (posição, escala, opacidade, giro);
  - linha do tempo com as faixas (arrastar move, as pontas mudam o início e o fim), as chaves e o play.
- **Desfazer e refazer:** em tudo. Ctrl+Z, Ctrl+Shift+Z, Ctrl+D, Ctrl+G, setas, Delete e espaço.
- **Modelos da marca:** 8 layouts (capa cheia, produto no centro, título de impacto, lista de três, meio a meio, depoimento, chamada final, antes e depois). Usam as cores da paleta e a logo da marca aberta; uma marca que não é a principal não herda nada da outra (`useKitDaMesa`).
- **Sugestões de layout:** o mesmo conteúdo em outros modelos. O botão Ordenar pede ao **Jev** (Choice) que ordene as sugestões pelo pedido. Custa centavos.
- **Montar com IA** (`canvas_quadro_montar`, função `mesa-foto`):
  - O modelo do papel `motion` escreve o conteúdo e escolhe o modelo e as alternativas, com esquema JSON. A pessoa troca o modelo no seletor.
  - O código posiciona e anima as camadas.
  - O Jev ordena as opções.
  - O custo aparece antes, e nada é gravado sem a pessoa escolher uma opção (com Desfazer).
  - A regra dura vale: nada de número, preço ou nome que não esteja no contexto ou no pedido.
- **Trocar mídia:** pelo acervo, com as fotos da marca aberta, os vídeos do cliente e o que está ligado ao Quadro no Canvas. Só entra mídia da pasta do cliente; a função recusa outra ao salvar (`midia_de_outro_cliente`).
- **Exportar quadro:** PNG de 1080 px, desenhado no navegador (canvas 2D) no tempo escolhido. "Acervo" guarda o quadro como `quadro` na Mesa Vídeos (`quadro_registrar`), e ele serve de 1º quadro para gerar vídeo.
- **Render:**
  1. O botão cria uma versão rascunho na Mesa Edição (`versao_registrar`). O projeto tem uma trilha de sobreposição "Quadro do Canvas", e cada camada é um clipe com `estilo.camada`.
  2. Em seguida, o botão pede o render final (`render_pedir`).
  3. A composição (`Composicao.tsx`) desenha a camada com `CamadaNaComposicao`, que usa a mesma conta do palco.
  4. O worker da máquina da agência renderiza o MP4.

## Arquivos

- Modelos puros:
  - `supabase/functions/mesa-foto/modulos/video-do-canvas.ts`;
  - `supabase/functions/mesa-foto/modulos/quadro-animado.ts`.
- Função:
  - `canvas-regras.ts`: tipos `video` e `quadro`, ligações e `caminhosDeFora`;
  - `canvas.ts`: `canvas_quadro_montar`, `canvas_quadro_ordenar` e a trava de mídia de outro cliente.
- Tela:
  - `src/components/mesa-foto/canvas/videoNoCanvas.ts`, `vigiaDosVideos.ts`, `CartaoDeVideo.tsx` e `CartaoDoQuadro.tsx`;
  - `src/components/mesa-foto/canvas/quadro/`: editor, palco, linha do tempo, exportar, para a Edição e API;
  - `EtapaCanvas.tsx`, `canvasApi.ts`, `Cena.tsx`, `FaixaDaHistoria.tsx`, `ModoLista.tsx`, `Editores.tsx` e `comum.tsx`.
- Render: `src/components/mesa-edicao/editor/Composicao.tsx` ganhou uma ramificação de 3 linhas para `estilo.camada`.

## O que depende de operação

- **Gerar vídeo:** precisa de `FAL_KEY` (ou da chave do provedor do motor escolhido) nos segredos e de saldo na carteira do cliente. Sem chave, o seletor mostra "Precisa de chave", e a geração não sai.
- **Render:** precisa do worker de render ligado na máquina da agência. Em 30/09, `render_workers` estava vazio e havia 5 pedidos `cena_hf` parados na fila.
- **Atualizar o código do worker antes do 1º render de Quadro.** O worker empacota o `src` do próprio checkout (`workers/render/remotion/Raiz.tsx` importa `src/components/mesa-edicao/editor/Composicao.tsx`). Com o checkout antigo, os clipes com `estilo.camada` caem no `ClipeVisual` e o MP4 sai sem posição, animação e camadas certas. Na máquina da agência: `git pull` no main com a CNV, `npm install` em `workers/render` e reiniciar o worker. Publicar a função e o front não basta.
- **Montar com IA:** precisa de um modelo de texto com o papel `motion` (ou do estrategista) e de crédito no provedor. O Jev precisa de `TYPESAFE_API_KEY`; sem ela, as opções vêm na ordem da IA, com um aviso.
