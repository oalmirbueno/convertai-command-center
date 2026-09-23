# Regras recomendadas para o compositor de prompt

- Alvo: `supabase/functions/_shared/direcao-arte.ts` (funções `caixaDaZona`, `tamanhoDoBloco`, `blocosDoTexto`, `normalizarLayout`, `layoutPadrao`, `promptDaLamina`).
- Base: `supabase/functions/_shared/conhecimento-design.ts` versão `2026-09-23.2` (regras e desempates) e os arquivos desta pasta.
- Status: **recomendação, nada aplicado**. O arquivo `direcao-arte.ts` não foi editado.
- Por que mexer no compositor: o diretor escreve pouco e o código monta o prompt. Se o código calcula um tamanho ou uma zona que contradiz a base, a base perde. Hoje há contradições medidas (itens 1, 2, 7 e 12).

## Tamanhos por papel e hierarquia

1. **Garantir a razão de 3 vezes entre headline e apoio.** Hoje `tamanhoDoBloco` dá headline de 150, 124, 102, 88 ou 76 px (vezes 0,82 em coluna estreita, até 62 px) e apoio de 38 ou 34 px. Razões reais: 88/38 = 2,3; 76/38 = 2,0; 62/34 = 1,8. A base pede pelo menos 3 vezes. Proposta:
   - apoio: 40 px até 90 caracteres, 36 px acima disso; nunca 34 px (a base fixa 36 px como mínimo de apoio);
   - headline: capa 160 px (até 16 caracteres), 132 px (até 28), 116 px (até 44), 108 px (até 54); miolo 140, 124, 112 e 108 px nas mesmas faixas;
   - depois de calcular, aplicar `headline = max(headline, 3 x maior tamanho de N2)`;
   - em coluna estreita (largura abaixo de 55%), não reduzir a headline abaixo de 108 px: se não cabe, trocar a zona para uma de largura total ou devolver alerta de texto longo.
2. **Headline acima de 54 caracteres não encolhe; é cortada.** Três linhas de até 18 caracteres é o teto da base. Acima disso, `blocosDoTexto` deve mandar o excedente para o apoio e o estúdio deve devolver um alerta (`headline_longa`) para a tela, em vez de reduzir a letra para 76 px. Hoje `blocosDoTexto` junta até 60 caracteres na headline: baixar para 54.
3. **Subtítulo vira nível 2, não um quarto nível.** `subtitulo` hoje sai com 56 ou 48 px, o que quebra a razão de 3 vezes (102/56 = 1,8) e cria um nível entre headline e apoio. Proposta: `subtitulo` com 44 px e tratado como N2; se houver `subtitulo` e `apoio` na mesma lâmina, fundir os dois em um só bloco de apoio.
4. **Contar níveis e elementos.** Mapear papéis em níveis: `headline` ou `numero` = N1; `subtitulo`, `apoio`, `cta` = N2; `selo` = N3. Quando vier `numero` e `headline` juntos, o número é N1 e a headline passa a legenda N2 (44 a 56 px, colada ao número a 8 a 24 px). No máximo 4 blocos por lâmina (N1, N2, CTA, selo); o que passar disso é fundido ao apoio e gera alerta.
5. **Limites de palavras como alerta, não como corte silencioso.** Capa: headline até 7 palavras. Miolo: até 25 palavras somando todos os blocos. Teto absoluto: 40 palavras. O compositor devolve `alertas` junto com o card para a tela mostrar antes de gastar com imagem.
6. **Descrever tamanho também em relação.** O gerador segue mal "letra de cerca de 120 px". Acrescentar em cada prompt: "a headline tem cerca de 3 vezes a altura do texto de apoio" e "cada linha da headline ocupa cerca de 9% da altura do quadro" (120/1350). Relações e percentuais são seguidos melhor que pixels.

## Zonas de texto e margens

7. **Tirar o texto da área do contador.** O contador do carrossel ocupa cerca de 180 x 110 px no canto superior direito (x de 83,3% a 100%, y de 0 a 8,1%). A margem de topo é 100 px (7,4%). As zonas `topo-centro` e `coluna-direita` começam em y = 7,4% e vão até x = 91,7%, então invadem a faixa de 100 a 110 px do contador. Proposta: em carrossel (`total > 1`), essas zonas começam em y = 8,9% (120 px) ou terminam em x = 83%.
8. **Coluna do apoio mais estreita que a zona.** As zonas `topo-centro`, `centro` e `base-centro` têm 900 px de largura; com apoio de 38 px isso dá cerca de 47 caracteres por linha, acima do teto de 38. Proposta: no prompt, "o texto de apoio ocupa uma coluna de no máximo 66% da largura do quadro (cerca de 720 px), com linhas de 25 a 38 caracteres", ou quebrar o apoio no código (item 9).
9. **Quebras de linha decididas no código.** Quando o diretor não manda `\n`, quebrar a headline em linhas de até 18 caracteres e o apoio em linhas de até 38, com três regras: nunca terminar linha em palavra curta ("e", "de", "da", "do", "a", "o", "em", "para", "com"); nunca deixar uma palavra sozinha na última linha; preferir linhas de comprimento parecido. As quebras vão no prompt com " / ", como já acontece na headline.
10. **Reservar a última linha do grid para os marcadores.** Se a série usar numeração ("02/07") ou seta de arraste, o compositor reserva a última linha do grid (146 px acima da margem de base, 10,8% da altura) e as zonas `base-*` terminam acima dela. Numeração à esquerda, seta à direita, 28 a 32 px, mesma posição em todas as lâminas, nunca no canto superior direito. Hoje não existe marcador no prompt: vale criar o campo como opção da direção.
11. **Carrossel contínuo com emenda protegida.** Acrescentar à linha do carrossel infinito: "nenhum texto a menos de 90 px das bordas laterais; o elemento de ligação sai pela borda direita e entra na lâmina seguinte na mesma altura, a Y px do topo" (Y vindo da direção quando o diretor informar).

## Espaçamento, entrelinha e alinhamento

12. **Trocar a frase de espaçamento e entrelinha.** Hoje o prompt diz "espaço entre blocos pelo menos o dobro da entrelinha; headline com entrelinha apertada (0,95 a 1,05)". Pela base: "headline e apoio formam um grupo, a 16 a 32 px um do outro; CTA, selo e logo ficam a pelo menos 96 px desse grupo; entrelinha da headline de 1,0 a 1,1, sem acento encostando na linha de cima; entrelinha do apoio de 1,3 a 1,45".
13. **Alinhamento consistente no carrossel.** `normalizarLayout` aceita qualquer alinhamento por lâmina. Proposta: usar o alinhamento da maioria das lâminas do miolo para todas; o centro fica permitido só na capa curta e no CTA final, e só quando o bloco tem até 3 linhas (se tiver mais, forçar esquerda).
14. **Variação controlada imposta.** Se a mesma `zona_texto` aparecer em 3 lâminas seguidas, trocar a terceira pela próxima variação de `layoutPadrao`. Hoje isso depende só da instrução ao diretor.

## Cor e contraste

15. **Destaque de palavra na headline.** Hoje a cor de destaque só vai para `cta` e `numero`; uma headline sem número nem CTA não recebe acento. Proposta: campo opcional `destaque` (1 a 3 palavras) no bloco da headline, e o prompt passa a dizer "apenas a(s) palavra(s) "X" em [cor_destaque]; todo o resto em [cor_texto]".
16. **Não usar a cor secundária como acento.** `papelDaCor(paleta, "destaque", "acento", "secundaria", "secundária")` cai na cor secundária quando o kit não tem destaque; a secundária é a cor dos 30% e vira um acento grande demais. Proposta: sem `destaque` ou `acento` no kit, usar a complementar ou complementar dividida da dominante (calculada) ou nenhum acento, e dizer "acento em no máximo 10% da área, em no máximo 2 pontos".
17. **Conferir contraste em código quando as duas cores são hex.** Função pura de contraste WCAG 2 entre `cor_texto` e `cor_fundo` (sem dependência, ou `culori` pelo especificador `npm:`). Se o apoio ficar abaixo de 4,5:1 ou a headline abaixo de 3:1, trocar a cor do texto pelo neutro de maior contraste (off-white #F5F3EE ou quase preto #111418) e registrar em `evitar`. Exemplo real da base: branco sobre laranja #F28C28 dá 2,45:1 e falha até em título.

## Foto, painel, máscara e técnica

18. **Suporte do texto como campo fechado.** Acrescentar `layout.suporte_texto` com os valores `area_calma`, `painel_solido`, `painel_fosco`, `gradiente_local` e `fundo_liso`, e o compositor escreve a frase testada de cada um:
    - `area_calma`: "a foto tem uma área lisa e uniforme exatamente na zona do texto (parede, céu, sombra, fundo desfocado)";
    - `painel_solido` e `painel_fosco`: "painel [cor hex ou vidro fosco] alinhado às colunas do grid, cobrindo [metade, terço ou faixa], com o texto dentro e respiro interno de pelo menos 40 px; o que fica fora do painel continua nítido";
    - `gradiente_local`: "gradiente suave de 40 a 60% só na região do texto, sumindo até transparente; nunca uma faixa preta";
    - `fundo_liso`: "fundo liso da paleta com a foto recortada ao lado".
    O padrão da capa hoje ("fotografia escurecida de forma sutil só na área do texto") passa a ser `area_calma`, com `gradiente_local` como segunda opção.
19. **Técnica protagonista como campo fechado.** Acrescentar `layout.tecnica` com uma lista curta e, para cada item, a frase do prompt e a trava de segurança da base:
    - `texto_atras_do_sujeito`: só com headline de 1 palavra ou 2 curtas; "o sujeito cobre no máximo 30% da altura das letras, nunca a primeira letra, e a palavra continua legível inteira";
    - `numero_gigante`: "o número ocupa de 40 a 55% da altura, legenda colada abaixo";
    - `recorte_na_borda`: "pelo menos 15% do sujeito fora do quadro; nenhum corte na linha dos olhos nem em articulações";
    - `cor_seletiva`: "foto em preto e branco; a única cor saturada é [hex] no [elemento]";
    - `forma_como_janela`, `faixas_horizontais`, `painel_fosco`, `grid_visivel`, `silhueta_sobre_cor`, `tipografia_como_imagem`.
    Uma técnica por lâmina; no carrossel o compositor sugere repetir a mesma técnica protagonista. Nicho sóbrio (saúde, jurídico, contábil) não recebe `tipografia_como_imagem` nem texturas fortes.
20. **Plano e corte sempre ditos.** Campo `layout.plano` (`close_topo_cortado`, `close_extremo`, `meio_corpo`, `aberto`, `detalhe`, `vista_de_cima`). Sem ele, o gerador tende a entregar a foto inteira com o assunto pequeno no meio, que é o primeiro sintoma de arte genérica.
21. **Área de texto reservada na descrição da foto.** O compositor junta a zona do texto à descrição da imagem: "o sujeito fica em [lado oposto à zona]; a zona de [posição] é área calma para o texto". Hoje zona e imagem são descritas em seções separadas e o gerador nem sempre liga uma à outra.

## Logo e marca

22. **Logo com canto fixo e tamanho em altura.** Hoje: "pequena (de 13% a 20% da largura), num canto dentro das margens". O gerador escolhe o canto e ele muda entre capa e final. Proposta: altura de 48 a 72 px, largura de no máximo 20%, e o mesmo canto nas duas lâminas: inferior esquerdo por padrão, superior esquerdo quando a capa ou o final usar zona `base-esquerda`. Nunca o canto superior direito.

## Manutenção

23. **Uma fonte só para os números.** As margens (90/100/106 px), o extra da capa (34 px) e a área do contador aparecem em `direcao-arte.ts`, em `PADRAO_NA_IMAGEM` e em `CONHECIMENTO_DIRETOR`. Se um mudar, os outros ficam errados. Sugestão: um objeto de constantes exportado de um lugar só e usado pelos três (exigiria mudar os exports de `conhecimento-design.ts`, por isso fica só como sugestão).
24. **Testes de contrato do compositor.** Testes Deno para `promptDaLamina` e `tamanhoDoBloco`: headline pelo menos 3 vezes o apoio em todas as faixas de tamanho; nenhum bloco abaixo de 28 px; nenhuma zona de carrossel com texto na área do contador; contraste mínimo quando as duas cores são hex; alerta quando a capa passa de 7 palavras ou o miolo de 25.
