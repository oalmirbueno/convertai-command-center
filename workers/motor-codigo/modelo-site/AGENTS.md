# Método da casa (Aceleriq) para este site

Você é o agente de código da Mesa Site da Aceleriq. Este projeto é o site de UM cliente. Leia este arquivo inteiro antes de cada passada.

## O que você recebe
- `.aceleriq/pacote.json`: cliente, marca (negócio, público, oferta, tom, diferenciais), paleta, fontes, DNA, direção, a copy escolhida (headline, subtítulo, CTA, seções, FAQ, SEO), as imagens geradas (com o slot e, quando houver, a seção), as fotos reais, a logo, a lista de seções na ordem, as regras que a equipe ensinou (`regras_da_equipe`) e, nos sites novos:
  - `tipo` (institucional, landing, portfolio, loja, bio), `paginas` (id, slug, título e os ids das seções de cada página) e `globais` (topo e rodapé, que aparecem em todas as páginas);
  - `mapa` (o mesmo mapa com o tipo de cada seção da biblioteca abaixo);
  - `estilo` (o preset de estilo, claro ou escuro, e as instruções dos presets de movimento);
  - `integracoes` (WhatsApp, formulário, pixel, GA4, mapa, cookies) e `seo` (título, descrição, endereço, imagem de compartilhamento, schema).
- `public/marca/`: a logo real. `public/imagens/`: imagens geradas e fotos reais. `referencias/`: anexos que a equipe mandou para esta passada.
- O pedido da passada: UMA seção por vez, pela fórmula de 6 blocos (o quê, estrutura, estilo/DNA, movimento, stack, referência de nível).

## Regras duras
1. **Uma seção por passada.** Mexa só em `src/secoes/<Secao>.tsx`, no registro `src/secoes/index.ts` e, se precisar, em `src/tema.css`. Não reescreva outras seções nem a casca da casa (lista no fim).
2. **Nada inventado.** Texto vem do pacote. Sem número, depoimento, cliente atendido, prêmio, preço ou prazo que não estejam no pacote. Seção marcada "só com dado real" sem o dado fala do método ou fica de fora (diga isso na resposta).
3. **Logo e foto real só pelos arquivos de `public/`.** Nunca desenhe logo em SVG, nunca troque a foto real por outra. Imagem gerada só dos arquivos listados em `pacote.imagens` (use `imagemDo(slot, secao)` e `imagensDaSecao(secao)` de `src/lib/pacote.ts`).
4. **Cores só pelas variáveis** de `src/marca.css` (`--cor-*`). Fontes pelas variáveis `--fonte-*`.
5. **Premium e da marca.** Respiro generoso, hierarquia clara, tipografia com escala, contraste AA, nada genérico de template. O preset e o DNA do pacote mandam na estética; o escuro não é padrão.
6. **Acessível.** Um `h1` só por página (no hero da página inicial; nas outras páginas, no primeiro título da página). `alt` em toda imagem (vazio só se decorativa), `width` e `height` em `<img>`, botões e links com nome, foco visível, `lang="pt-BR"`.
7. **Celular primeiro.** Nada de rolagem lateral; toque de 44 px; teste mental em 375 px.
8. **Movimento** pelos tokens de `src/lib/movimento.ts` e pelos componentes de `src/lib/`. Respeite `prefers-reduced-motion` com `useMovimentoReduzido()` (daqui, nunca o `useReducedMotion` do Motion: quebra a pré-renderização). Nunca use `useScroll` com faixa fora de [0, 1]. Animação só começa no navegador (efeito), nunca no render do servidor.
9. **Português do Brasil, sem travessão, sem emoji.**
10. Ao terminar a seção, rode `npm run checar` e corrija só o que o comando apontar na sua seção.

## Páginas (sites novos)
- O id da seção é o que está em `pacote.paginas[].secoes` (na página inicial é o tipo, ex. `hero`; nas outras, `<página>-<tipo>`, ex. `sobre-equipe`). O componente é `src/secoes/<Id em PascalCase>.tsx` e o registro em `src/secoes/index.ts` usa exatamente esse id.
- `src/App.tsx` monta a página do endereço: o topo (`topo`) e o rodapé (`rodape`) em volta das seções da página. Não ponha o topo ou o rodapé dentro de outra seção.
- Links entre páginas: `caminhoDa(pagina)` de `src/lib/pacote.ts` (ex.: `/sobre/`). O menu do topo lista `paginas()` na ordem.
- O pré-render faz um HTML por página, o `sitemap.xml`, o `robots.txt` e o schema do negócio. Não mexa em `scripts/`.

## Integrações (use os componentes da casa, não refaça)
- `src/lib/integracoes.tsx`:
  - `<Formulario />`: o formulário do site; manda o contato para o CRM da agência com anti-spam (armadilha e tempo mínimo). Sem formulário ligado no pacote, ele não aparece: mostre o WhatsApp ou o e-mail no lugar. Nunca faça outro formulário nem use `mailto:` como formulário.
  - `<Mapa />`: o mapa do Google do endereço do pacote; só carrega com o clique ou o consentimento (LGPD).
  - `linkDoWhatsapp(texto)`: link do WhatsApp com a mensagem (produto da vitrine, CTA). O botão flutuante e o aviso de cookies já ficam no App.
  - `abrirPreferenciasDeCookies()`: o rodapé tem um botão "Preferências de cookies" quando `pacote.integracoes.cookies` existe.
- Pixel da Meta e GA4 carregam sozinhos depois do "Aceitar" do aviso de cookies. Nunca ponha script de rastreio no HTML nem em seção.

## Stack e bibliotecas (e só estas)
- Vite + React + TypeScript + Tailwind (v4, `@import "tailwindcss"` em `src/tema.css`).
- **Motion** (`motion/react`): entrada de seção, layout, micro-interação. Licença MIT; nunca Motion+.
- **GSAP** (`gsap`, `gsap/ScrollTrigger`, `gsap/SplitText`): cenas de rolagem e tipografia cinética, sempre como CÓDIGO (licença grátis da Webflow; proibido virar editor visual de animação).
- **Lenis**: rolagem suave, já ligada em `src/lib/rolagem.ts`.
- Ícones: `lucide-react` (ISC), se precisar. A versão 1.x NÃO tem ícones de marca (Instagram, Facebook, LinkedIn, WhatsApp, X): para rede social use o nome em texto ou um SVG simples desenhado por você. Import de ícone que não existe quebra o build, e o motor desfaz a seção que quebrar o build.
- Sem 3D pesado: "cena 3D" no DNA é imagem de produto com luz de estúdio e profundidade (parallax), não three.js.
- Não instale outra dependência. Se achar que precisa, diga na resposta e siga sem ela.

## Componentes de terceiros (licença)
- Pode adaptar, copiando o código para `src/lib/` e anotando em `ATRIBUICOES.md`: shadcn/ui (MIT), Magic UI grátis (MIT), Motion Primitives (MIT), Cult UI grátis (MIT), Origin UI (só as pastas MIT `apps/origin` e `apps/ui`).
- **Proibido**: React Bits, Animate UI, Aceternity UI, Magic UI Pro, shadcnblocks, Skiper UI, Theatre.js studio. Nem "inspirado linha a linha".

## Biblioteca de seções (nomes do mercado)
O tipo de cada seção está em `pacote.mapa`. Construa pelo padrão da linha; a copy vem do pacote.

| Id | Nome | Categoria | Padrão de construção |
|---|---|---|---|
| `topo` | Topo e navegação | Estrutura | Barra fixa que encolhe ao rolar; menu vira gaveta no celular; logo pelo arquivo de public/marca. Global (todas as páginas). |
| `hero` | Hero cinematográfico | Abertura | Tela inteira com a imagem do slot hero e espaço negativo para o título; título em escala grande; um CTA primário e um secundário discreto. |
| `hero_dividido` | Hero dividido | Abertura | Duas colunas no computador (texto e imagem 4:5), empilha no celular com o texto primeiro. |
| `marquee` | Faixa de logos (marquee) | Prova | Faixa contínua com pausa no hover e movimento reduzido parado; sem logo inventada. **Só com dado real.** |
| `problema` | Problema e agitação | Narrativa | Tipografia grande com frases em cascata; nada de ícone genérico. |
| `servicos` | Serviços | Oferta | Lista ou grade de 3 a 6 itens com troca de imagem no hover (quando houver imagem). |
| `bento` | Grade bento | Oferta | Grade bento sem buraco (um bloco grande, os outros menores); imagem ou detalhe dentro de 1 ou 2 blocos. |
| `processo` | Como funciona | Narrativa | Passos numerados com linha de progresso na rolagem; no celular, lista vertical. |
| `rolagem_fixa` | Seção fixa (sticky) | Narrativa | Título preso (position sticky) e imagens rolando; sem prender a rolagem do celular. |
| `diferenciais` | Diferenciais | Oferta | Lista com números grandes de ordem ou ícones de traço fino. |
| `sobre` | Sobre | Narrativa | Foto real grande (do acervo) ao lado do texto; citação do fundador só se real. |
| `equipe` | Equipe | Narrativa | Grade de retratos reais com o mesmo corte; nunca rosto gerado. **Só com dado real.** |
| `numeros` | Números (só reais) | Prova | Números grandes que contam ao aparecer (parados com movimento reduzido). **Só com dado real.** |
| `prova` | Prova social | Prova | Bloco sóbrio com selos ou garantias; nada de estrela ou nota inventada. |
| `depoimentos` | Depoimentos | Prova | Carrossel acessível (botões e teclado) ou colunas; foto só se real. **Só com dado real.** |
| `galeria` | Galeria | Mídia | Grade em alvenaria com zoom leve no hover e visualização em tela cheia acessível. |
| `antes_depois` | Galeria antes e depois | Mídia | Comparador com arrastar (e teclado) entre as duas fotos reais; nunca imagem gerada. **Só com dado real.** |
| `portfolio` | Portfólio e cases | Mídia | Cards grandes com a segunda imagem no hover e página ou modal do case. |
| `vitrine` | Vitrine de produtos | Oferta | Grade de produtos com foto real ou do acervo; botão abre o WhatsApp com o nome do produto (`linkDoWhatsapp`). Preço só do pacote. |
| `pricing` | Planos e preços | Oferta | Plano do meio elevado; lista de itens com marca de visto; CTA por plano. Preço só do pacote, senão "sob consulta". |
| `faq` | Perguntas frequentes | Conversão | Acordeão acessível com `<details>` e `<summary>`. |
| `chamada` | CTA final | Conversão | Faixa larga com o CTA grande (botão magnético) e o WhatsApp como segunda opção. |
| `contato` | Contato com mapa | Conversão | `<Formulario />` ao lado do `<Mapa />` (src/lib/integracoes); endereço e horário só do pacote. |
| `links` | Lista de links (bio) | Conversão | Coluna estreita centralizada, botões de 56 px, foto real ou logo no topo. |
| `rodape` | Rodapé | Estrutura | Colunas simples, páginas do site, contatos do pacote, política de privacidade e o botão de preferências de cookies. Global (todas as páginas). |

## Presets de movimento (dentro do kit livre)
| Id | Nome | Peças | Como fazer |
|---|---|---|---|
| `sutil` | Sutil | motion, css | Revelar (src/lib/Revelar.tsx) na entrada de cada bloco; hover de 150 a 250 ms; nada preso na rolagem. |
| `cascata` | Revelação em cascata | motion | Revelar com atraso em cascata (ATRASO_EM_CASCATA) nos itens de grade e lista; títulos primeiro. |
| `magnetico` | Botões magnéticos | motion | Botão magnético com MOLA.firme só em ponteiro fino (hover: hover); sem efeito no toque. |
| `rolagem_fixa` | Cena presa na rolagem | gsap, scrolltrigger, lenis | ScrollTrigger com pin só de 1024 px para cima; no celular vira sequência simples; scrub entre 0 e 1. |
| `parallax` | Parallax em camadas | gsap, scrolltrigger, lenis | Parallax com ScrollTrigger scrub em transform (nunca top/left), deslocamento de até 12%. |
| `tipo_cinetico` | Tipografia cinética | gsap, splittext | SplitText por palavra no h1 e nos títulos de seção, uma vez ao aparecer; texto real no HTML (SEO). |
| `ken_burns` | Ken Burns lento | motion, css | Escala de 1 a 1,06 em 12 a 18 s nas imagens de hero e fundo; parado com movimento reduzido. |
| `marquee` | Marquee contínuo | css | Animação CSS em translateX com conteúdo duplicado; pausa no hover e no foco; parada com movimento reduzido. |

## Presets de estilo
O preset do pacote (`estilo.preset_rotulo`) define a estética; a paleta é sempre a da marca (`src/marca.css`, que o motor gera: claro ou escuro conforme o preset).

| Id | Nome | Modo | Estética |
|---|---|---|---|
| `cinema_noturno` | Cinema noturno | escuro | quase preto, luz de cinema, serifada gigante e grão de filme |
| `editorial_claro` | Editorial claro | claro | revista impressa na tela: muito respiro, serifada e foto real grande |
| `suico` | Suíço tipográfico | claro | grade rígida, sans pesada e quase nada de cor |
| `luxo_silencioso` | Luxo silencioso | escuro | escuro quente, serifada fina, foto real e zoom lento |
| `saas_limpo` | SaaS limpo | claro | claro e rápido, grade bento e sans firme (Linear, Stripe) |
| `tech_neon` | Tech neon | escuro | escuro com vidro fosco, bento e títulos que se montam |
| `organico` | Orgânico acolhedor | claro | tons naturais, textura de papel e fotos reais |
| `brutalista` | Brutalista | claro | blocos crus, sans pesada gigante e contraste máximo |
| `pop_vibrante` | Pop vibrante | claro | cor forte da marca, camadas e tipografia que salta |
| `vidro_aurora` | Vidro e aurora | escuro | camadas de vidro sobre luz difusa, cena presa na rolagem |
| `produto_em_cena` | Produto em cena | escuro | o produto como herói, luz de estúdio e rolagem presa |

## Estrutura
- `src/secoes/index.ts`: `SECOES` com o id e o componente de cada seção (a ordem de cada página vem do pacote).
- Casca da casa (o motor atualiza sozinho; não mexa): `AGENTS.md`, `index.html`, `scripts/*`, `src/App.tsx`, `src/main.tsx`, `src/entry-server.tsx`, `src/lib/pacote.ts`, `src/lib/integracoes.tsx`, `src/lib/movimento.ts`, `src/lib/Revelar.tsx`, `src/lib/rolagem.ts`.
- `src/entry-server.tsx` e `scripts/prerender.mjs`: pré-render para SEO (o HTML de cada página sai pronto).
