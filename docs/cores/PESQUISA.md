# Pesquisa de cores (19/11/2026), base do Ateliê de Cor

## Reels do @jorgedaweb (quadros)
Regra: uma cor dominante forte, um neutro (claro ou escuro) e um destaque que contrasta, usado só no botão e no detalhe. Uma cor "sem graça" sozinha (azul-bebê, creme, musgo) fica boa quando entra na combinação certa.
- Reel 1: #002893 + #FFFFFF + #FD701C · #694545 + #D5B2DC · #000000 + #FFFFFF + #CBF615
- Reel 2: #F4E1D2 + #1B2F68 + #640119 · #381A56 + #D2AE90 + #D9F301 · #483B0F + #C99FC4 + #FDB0B7 · #DFE7ED (cor isolada)
Usar só como casos de teste; não entram como biblioteca.

## Funções do Combina Sacana (página pública; o app travou na extensão)
Briefing (PDF/DOCX/TXT/colar) ou do zero (perguntas por nicho) ou nicho pronto (16); conferir o entendimento; 3 propostas (1 recomendada, 2 alternativas), cada cor com função, motivo e onde aplicar; conferência automática (HEX, contraste, cores proibidas, propostas diferentes); laboratório com 19 heroes em computador/tablet/celular; 60-30-10 escolhido pelo usuário; contraste ao vivo; comparador lado a lado; nova alternativa e novo trio; tons e HEX; PDF sem marca e mensagem pronta; .ase e tokens; projetos salvos; limite diário.

## Teoria (fontes)
- Harmonias em graus: complementar 180°, dividida 150°/210°, análoga ±30°, triádica 120°, tetrádica 90°, monocromática. adobe.com/creativecloud/design/discover/color-wheel.html
- 60-30-10: 60 dominante/fundo, 30 marca, 10 destaque só no CTA. pixpa.com/blog/60-30-10-rule-in-web-design
- WCAG 2.2: 4.5:1 texto, 3:1 texto grande e UI (1.4.3, 1.4.11); cor nunca é o único sinal (1.4.1). w3.org/WAI/WCAG22/Understanding/relative-luminance.html
- APCA (segunda opinião): Lc 90 corpo ideal, 75 mínimo, 60 rótulos, 45 títulos grandes, 30 piso. github.com/Myndex/apca-introduction
- OKLCH: L perceptual, matiz estável; escala 50–950 com curva de L fixa, croma em sino, gamut por redução de croma. bottosson.github.io/posts/oklab · bottosson.github.io/posts/gamutclipping
- Daltonismo: matrizes Machado 2009 em RGB linear. inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
- Psicologia da cor: evidência fraca (Labrecque & Milne 2012); conta mais a coerência com o nicho e o contraste do CTA.
- E-mail escuro: meta color-scheme, @media prefers-color-scheme, [data-ogsc]/[data-ogsb], evitar #000/#fff puros, botão HTML com borda. litmus.com/blog/the-ultimate-guide-to-dark-mode-for-email-marketers

## O que já existe no painel
- `supabase/functions/_shared/cores-da-marca.ts`: hex/rgb/lab, deltaE, CMYK, contraste WCAG.
- `supabase/functions/_shared/escala-da-cor.ts`: escala em HSL (trocar por OKLCH).
- `supabase/functions/mesa-identidade/modulos/paleta-da-marca.ts`: HARMONIAS, avisos de contraste.
- `src/lib/identidadeVisual.ts`: extrairPaleta de imagem.
- Estúdio: `promptDaLamina` em `_shared/direcao-arte.ts:813` (60-30-10 na linha 951); paleta em `cliente_kit_marca.paleta` e `cliente_marcas.paleta` `[{nome,hex,papel}]`.
- Correio: envio só text/plain (`produto-correio/modulos/imap.ts:359`); outra frente mexeu nele em 19/11.
