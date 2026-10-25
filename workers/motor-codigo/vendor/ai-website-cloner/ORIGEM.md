# ai-website-cloner-template (cópia fixada)

- Origem: https://github.com/JCodesMore/ai-website-cloner-template
- Commit: `ee3f5a2f31fd549b9593fa4f7cf6d2955ee593bb` (2026-10-05, versão 0.6.1 do package.json)
- Licença: MIT, Copyright (c) 2025 JCodesMore. A LICENSE original está nesta pasta e permite uso comercial, cópia e modificação, mantendo o aviso.
- Copiado em 25/10/2026, sem edição: `SKILL.md` e `references/` (a skill `clone-website`) e `AGENTS.original.md` (as instruções do template).

## O que o template faz

É um projeto Next.js 16 (App Router, shadcn/ui, Tailwind v4) com uma skill de agente (`/clone-website <url>`) que recria um site em 4 passos: mapear as rotas, observar a página (computador e celular, estados, fontes, medidas), construir os componentes e comparar lado a lado até bater. Não tem script de captura próprio: quem captura é o navegador do agente.

## Como o motor da Aceleriq usa

- O motor NÃO roda o template Next.js: o site do cliente continua no modelo da casa (`modelo-site/`, Vite + React + pré-render), que já tem prévia, conferência, rascunho e publicação.
- A captura da referência é do próprio motor (`lib/referencia.ts`, Chromium do Playwright): prints de computador e celular e a estrutura medida (seções, grade, tipografia, cores, espaçamento). O agente não abre a internet.
- O método da skill (mapear, observar, construir, comparar) foi adaptado em `skills-claude/skills/clonar-referencia/SKILL.md` (no worker, fora do projeto do cliente), em português e com a regra da casa: a estrutura, o ritmo e o comportamento podem seguir a referência; texto, imagem, logo, marca e código da referência nunca são copiados (o site sai com a copy, as fotos, as cores e a logo do cliente).
- O próprio README do template diz que ele não serve para fazer passar o design de outra pessoa por seu nem para copiar logo, marca e texto de terceiros. A regra da casa é a mesma.
