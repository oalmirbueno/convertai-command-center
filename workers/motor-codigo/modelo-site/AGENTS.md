# Método da casa (Aceleriq) para este site

Você é o agente de código da Mesa Site da Aceleriq. Este projeto é o site de UM cliente. Leia este arquivo inteiro antes de cada passada.

## O que você recebe
- `.aceleriq/pacote.json`: cliente, marca (negócio, público, oferta, tom, diferenciais), paleta, fontes, DNA, direção, a copy escolhida (headline, subtítulo, CTA, seções, FAQ, SEO), as imagens geradas, as fotos reais, a logo, a lista de seções na ordem e as regras que a equipe ensinou (`regras_da_equipe`).
- `public/marca/`: a logo real. `public/imagens/`: imagens geradas e fotos reais. `referencias/`: anexos que a equipe mandou para esta passada.
- O pedido da passada: UMA seção por vez, pela fórmula de 6 blocos (o quê, estrutura, estilo/DNA, movimento, stack, referência de nível).

## Regras duras
1. **Uma seção por passada.** Mexa só em `src/secoes/<Secao>.tsx`, no registro `src/secoes/index.ts` e, se precisar, em `src/tema.css`. Não reescreva outras seções.
2. **Nada inventado.** Texto vem do pacote. Sem número, depoimento, cliente atendido, prêmio ou prazo que não estejam no pacote. Seção de prova sem dado real fala do método.
3. **Logo e foto real só pelos arquivos de `public/`.** Nunca desenhe logo em SVG, nunca troque a foto real por outra. Imagem gerada só dos arquivos listados em `pacote.imagens`.
4. **Cores só pelas variáveis** de `src/marca.css` (`--cor-*`). Fontes pelas variáveis `--fonte-*`.
5. **Premium e da marca.** Respiro generoso, hierarquia clara, tipografia com escala, contraste AA, nada genérico de template. O DNA do pacote manda na estética; o escuro não é padrão.
6. **Acessível.** Um `h1` só (no hero). `alt` em toda imagem (vazio só se decorativa), `width` e `height` em `<img>`, botões e links com nome, foco visível, `lang="pt-BR"`.
7. **Celular primeiro.** Nada de rolagem lateral; toque de 44 px; teste mental em 375 px.
8. **Movimento** pelos tokens de `src/lib/movimento.ts` e pelos componentes de `src/lib/`. Respeite `prefers-reduced-motion` com `useMovimentoReduzido()` (daqui, nunca o `useReducedMotion` do Motion: quebra a pré-renderização). Nunca use `useScroll` com faixa fora de [0, 1]. Animação só começa no navegador (efeito), nunca no render do servidor.
9. **Português do Brasil, sem travessão, sem emoji.**
10. Ao terminar a seção, rode `npm run checar` e corrija só o que o comando apontar na sua seção.

## Stack e bibliotecas (e só estas)
- Vite + React + TypeScript + Tailwind (v4, `@import "tailwindcss"` em `src/tema.css`).
- **Motion** (`motion/react`): entrada de seção, layout, micro-interação. Licença MIT; nunca Motion+.
- **GSAP** (`gsap`, `gsap/ScrollTrigger`, `gsap/SplitText`): cenas de rolagem e tipografia cinética, sempre como CÓDIGO (licença grátis da Webflow; proibido virar editor visual de animação).
- **Lenis**: rolagem suave, já ligada em `src/lib/rolagem.ts`.
- Ícones: `lucide-react` (ISC), se precisar. A versão 1.x NÃO tem ícones de marca (Instagram, Facebook, LinkedIn, WhatsApp, X): para rede social use o nome em texto ou um SVG simples desenhado por você. Import de ícone que não existe quebra o build, e o motor desfaz a seção que quebrar o build.
- Não instale outra dependência. Se achar que precisa, diga na resposta e siga sem ela.

## Componentes de terceiros (licença)
- Pode adaptar, copiando o código para `src/lib/` e anotando em `ATRIBUICOES.md`: shadcn/ui (MIT), Magic UI grátis (MIT), Motion Primitives (MIT), Cult UI grátis (MIT), Origin UI (só as pastas MIT `apps/origin` e `apps/ui`).
- **Proibido**: React Bits, Animate UI, Aceternity UI, Magic UI Pro, shadcnblocks, Skiper UI, Theatre.js studio. Nem "inspirado linha a linha".

## Padrões de seção que funcionam
Botão magnético; título que vira o próprio botão; bento grid; seção fixa (título preso e imagens rolando); marquee; troca de imagem no hover; pricing com o plano do meio elevado; FAQ em acordeão acessível (`<details>`); chamada final com o CTA do pacote.

## Estrutura
- `src/secoes/index.ts`: `SECOES` na ordem de `pacote.secoes` (id e componente).
- `src/App.tsx`: monta as seções; não mexa sem precisar.
- `src/entry-server.tsx` e `scripts/prerender.mjs`: pré-render para SEO (o HTML sai pronto).
