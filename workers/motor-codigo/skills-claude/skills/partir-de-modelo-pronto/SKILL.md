---
name: partir-de-modelo-pronto
description: Construir a seção do cliente partindo de um site pronto de código aberto (coleção curada da Mesa Site), reaproveitando a estrutura e o estilo do modelo com o conteúdo e a marca do cliente. Use quando o pedido da passada tiver "PARTIDA: site pronto".
---

# Partir de um modelo pronto

O motor copiou o modelo escolhido para `referencias/modelo-pronto/`: as páginas em HTML, o SCSS do tema em `scss/` (variáveis, seções e componentes), o `js/` e a `LICENSE`. As fotos de demonstração NÃO vêm.

## Passo a passo
1. Leia o `index.html` (e a página que corresponde à seção, se o modelo tiver várias) e o SCSS do tema (`scss/_variables.scss`, `scss/sections/*`, `scss/components/*` quando existirem).
2. Ache o bloco do modelo que faz o papel da seção desta passada.
3. Reescreva esse bloco em React no método da casa (`src/secoes/<Secao>.tsx`, `data-secao`, variáveis de `src/marca.css`, componentes de `src/lib/`), mantendo a estrutura, a ordem, a grade, o ritmo e os estados do modelo. Bootstrap NÃO entra como dependência: traduza as classes para o CSS/Tailwind da casa.
4. Troque todo conteúdo: textos do pacote, imagens de `public/`, logo real, cores e fontes da marca.

## O que pode e o que não pode
- Pode: a estrutura, o layout, as proporções, o comportamento e trechos de código do modelo (a licença MIT permite; o aviso dela fica em `ATRIBUICOES.md`, o motor já anotou).
- Não pode: textos de demonstração ("Lorem ipsum", nomes, depoimentos, preços, endereços), as fotos e a marca Start Bootstrap.
- Faltou conteúdo para um bloco do modelo: use a copy do pacote ou deixe o bloco de fora e diga em `DECIDI:`.
