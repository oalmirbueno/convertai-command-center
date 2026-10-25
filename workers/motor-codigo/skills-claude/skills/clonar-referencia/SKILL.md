---
name: clonar-referencia
description: Construir a seção do cliente seguindo um site de referência, nos modos fiel, próximo ou criativo, com o conteúdo, as cores, as imagens e a logo do cliente. Use quando o pedido da passada tiver "PARTIDA: referência".
---

# Clonar a referência (método adaptado do ai-website-cloner-template)

Adaptado da skill `clone-website` do projeto ai-website-cloner-template (MIT, Copyright (c) 2025 JCodesMore; cópia fixada no motor em `vendor/ai-website-cloner`). O método é o mesmo (mapear, observar, construir, comparar); a regra da casa muda o que se leva: a FORMA da referência, nunca o CONTEÚDO dela.

## O que você tem
O motor já capturou a referência (você não acessa a internet):
- `referencias/referencia/estrutura.json`: seções na ordem (altura, colunas, alinhamento, cor de fundo, tamanho dos títulos, se tem imagem, se tem botão), o menu, os tokens (fontes e escala de títulos, cores mais usadas, cantos, espaçamento entre seções, largura do conteúdo) e a medida no celular;
- `referencias/referencia/computador-1.jpg`, `computador-2.jpg`... e `celular-1.jpg`...: a página de cima a baixo, em fatias (a lista e a altura de cada fatia estão em `estrutura.json`, campo `prints`). Abra com a ferramenta de leitura de arquivo só as fatias do bloco que você vai construir.

## 1. Mapear
Ache no `estrutura.json` o bloco da referência que faz o papel da seção desta passada (o hero com o hero, a grade de serviços com os serviços). Se não houver, siga o ritmo geral da referência.

## 2. Observar
Anote para a seção: número de colunas no computador e no celular, alinhamento, proporção texto x imagem, altura relativa, espaçamento interno, tamanho do título em relação ao corpo, forma dos botões e cartões, fundo (cheio, foto, gradiente, borda) e o comportamento visível (menu fixo, carrossel, animação de entrada).

## 3. Construir (no modo pedido)
- FIEL: mesma ordem interna, mesma grade e proporção, mesmo ritmo e hierarquia, mesmo comportamento. Medidas próximas das da referência (traduza para as variáveis e para a escala da casa).
- PRÓXIMO: mesma linguagem e organização, com ajuste de proporção e componentes ao conteúdo do cliente.
- CRIATIVO: pegue uma ou duas ideias (o clima, um layout, um movimento) e crie algo próprio. Não pode parecer cópia.

Sempre: texto do pacote, imagens de `public/`, cores e fontes das variáveis de `src/marca.css`, componentes e tokens de movimento da casa (`src/lib/`). Escreva em React no método da casa (uma seção por passada, `data-secao`).

## 4. Comparar
Depois do `npm run checar`, compare mentalmente o seu bloco com o print da referência: geometria, quebra de título, espaçamento, celular. Corrija a maior diferença primeiro. Diga em `DECIDI:` onde ficou diferente de propósito (por conteúdo do cliente ou por regra da casa).

## Autoria (regra dura)
- NUNCA copie da referência: textos (nem parecidos), logo, nome, fotos, ilustrações, ícones próprios, vídeos, código-fonte, CSS ou fontes pagas.
- Fonte da referência que não está no pacote: use a fonte da marca (variável `--fonte-*`) com peso e escala parecidos.
- Ícone: só `lucide-react`.
- O motor confere no fim se o site tem trecho longo da referência; se tiver, a entrega volta com aviso.
