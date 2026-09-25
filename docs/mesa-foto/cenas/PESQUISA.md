# Cenas e personagens persistentes no Canvas (pesquisa prática)

Data: 2026-09-25. Pedido do dono: gerar várias cenas com a mesma pessoa e o mesmo produto, ligar a pessoa gerada noutro gerador, montar uma história com as cenas e depois animar (Mesa Vídeos). Este documento diz o que as ferramentas de 2026 fazem e o que aplicamos **com os motores que o painel já usa**: GPT Image 2.5 Sunburst (padrão do Canvas), Nano Banana Pro, Seedream 5.0 Pro e os outros da rodada. Nenhum motor foi trocado.

Continuação de `docs/mesa-foto/MODELOS-E-CANVAS.md` e `docs/mesa-foto/CLONES.md`. Contrato do vídeo em `docs/mesa-videos/CONTRATO.md`.

## 1. Como as ferramentas seguram a mesma pessoa e o mesmo produto

| Ferramenta | O que faz | O que serve para nós |
| --- | --- | --- |
| Higgsfield Soul ID | Treina uma identidade com 20 a 80 fotos nítidas (3 a 5 min, cerca de US$ 1,25). Depois vale em imagem e vídeo sem reenviar fotos. | Não temos treino. O equivalente é a **folha de identidade** (âncora + vistas aprovadas) que as personas e os clones já têm. |
| Higgsfield Popcorn | Storyboard de até 8 quadros coerentes, com até 4 referências citadas por número ("homem da imagem 1 no cenário da imagem 3"). Manual (quadro a quadro) ou automático. | O Canvas já cita cada imagem por número e papel. A História faz o papel do storyboard, quadro a quadro. |
| Higgsfield Cinema Studio 2.0 | Parte de um "quadro herói", até 3 personagens por cena, grade de variações, lista de movimentos de câmera, planos de 1 a 12 s. Fluxo sugerido: Soul ID, Popcorn, Cinema Studio, áudio. | Cena = foto-chave + ação + câmera + duração. Os campos de câmera, duração e áudio ficam reservados para a Mesa Vídeos. |
| Nano Banana Pro (Gemini 3 Pro Image) | Até 14 referências, sendo até 5 de pessoa e 6 de objeto em alta fidelidade. Na prática a consistência cai com mais de 2 pessoas. Com várias entradas, a proporção pode seguir a última imagem. | Limite de pessoas por cena (aviso acima de 2). O formato vai sempre explícito no pedido. |
| GPT Image (1.5 e 2.x) | Alta fidelidade de entrada preserva rosto e logo; a **primeira** imagem recebe a textura mais rica. Edições em cadeia ficam granuladas. | Na cena, a personagem vai como Imagem 1. Nunca editamos em cadeia a partir do último quadro. |
| Seedream 4.5 / 5.0 | 10 a 14 referências; modo sequencial gera N imagens coerentes numa chamada (cobra por `max_images`). | Usamos uma imagem por chamada (custo previsível, já é o padrão do painel). |
| FLUX Kontext / FLUX.2 | Edição encadeada com pouca deriva; FLUX.2 aceita até 10 referências. | Edição encadeada só com volta à âncora (ver armadilhas). |
| Runway Gen-4 References | Até 3 referências marcadas no prompt; segura a pessoa com uma referência só. | Confirma que 1 a 3 referências bem rotuladas bastam; mais não é melhor. |
| Krea 2 | Folha de personagem (turnaround, expressões, roupas); usar a 1ª vista como referência das outras melhora. Para travar de verdade, LoRA. | A folha da personagem sai da âncora, uma vista por vez, pelo mesmo motor. |

## 2. Técnicas que funcionam com qualquer motor de várias imagens

1. **Papel de cada imagem, por número, antes da cena.** "Imagem 1 é a personagem, Imagem 2 é o produto, Imagem 3 é o lugar." Sem isso o motor trata as imagens como inspiração. O Canvas já faz; agora a foto de outra cena entra com o papel da ligação (personagem, produto, cenário, estilo).
2. **O que tem que ficar igual vem primeiro.** Na cena, a pessoa vai antes do produto (o GPT Image dá mais fidelidade à 1ª imagem). Fora de cena continua produto primeiro.
3. **Nome ligado à referência.** "A personagem Lia (Imagem 1)", nunca pronome solto.
4. **Âncoras de texto repetidas palavra por palavra** (a "bíblia" da personagem): cabelo, roupa, marcas, luz. A ficha e os traços fixos (invariantes) da personagem vão iguais em toda cena.
5. **Lista de preservação a cada cena:** "mude só a ação, o lugar e o enquadramento; não mude rosto, tom de pele, corpo, identidade nem o produto". É o bloco CONTINUIDADE DA HISTÓRIA.
6. **Voltar à âncora, não ao último quadro.** Quando a personagem veio de uma persona, o rosto vem da âncora e das vistas aprovadas; a foto da cena anterior entra só para roupa e cabelo.
7. **Seed fixa por cena** reduz a deriva quando o motor aceita (campo "Semente fixa" na cena).
8. **Uma mudança por vez.** Duplicar a cena e mudar só o contexto é melhor do que pedir tudo novo.

## 3. Armadilhas

- **Deriva em cadeia:** cena 3 feita da cena 2, feita da cena 1, vai mudando o rosto. Para a personagem ficar, use **Virar personagem** (a foto vira âncora e ganha folha) e ligue o cartão Pessoa dela nas cenas.
- **Rosto pequeno:** plano geral perde a identidade. A cena avisa; a foto-chave da personagem deve ser plano médio ou americano.
- **Gente demais:** mais de 2 pessoas misturam os rostos. A cena avisa; divida em duas.
- **Referência demais:** o teto anunciado é máximo, não meta. O Canvas continua com orçamento por papel e limite de 12.
- **Pessoa real:** nunca vira personagem sintética. Pessoa real com autorização vira clone (aba Clones); se ela entra numa cena, a próxima cena herda a regra de pessoa real.

## 4. Storyboard para vídeo (o que a Mesa Vídeos vai precisar)

Fórmula que as fontes usam: travar a identidade, montar 4 a 8 quadros-chave, animar cada quadro (imagem para vídeo ou primeiro e último quadro), gerar o áudio por cena e montar. Campos de uma cena para virar vídeo:

1. id e ordem;
2. foto-chave (1º quadro), gerada com as referências de personagem e produto;
3. último quadro (opcional), para interpolar ou emendar com a próxima cena;
4. referências presas à cena (no máximo 3 a 4 por clipe);
5. ação numa frase no presente;
6. câmera: plano, movimento (travelling, pan, órbita, câmera na mão), lente;
7. duração dentro do que o motor aceita (Veo 4, 6 ou 8 s; Seedance 4 a 15 s; Kling até 15 s);
8. ambiente e estilo repetidos da bíblia;
9. áudio: fala entre aspas com quem fala, trilha, efeitos;
10. motor de vídeo.

Os itens 1, 2, 4, 5, 6 (plano) e 8 já existem na cena do Canvas. Os itens 3, 6 (movimento), 7, 9 e 10 ficam em `dados.cena.animacao`, reservado, com `status: "em_breve"`.

## 5. O que foi implementado (25/09 à noite)

- **Resultado ligado a Resultado.** A alça à direita do Resultado leva a foto para outro Resultado. A alça onde a linha chega escolhe o papel (Pessoa = personagem, Produto, Ambiente = cenário, Estilo); dá para trocar no painel da ligação e escolher qual foto vai (senão: a foto da cena, a mais nova aprovada, a mais nova). Laço entre Resultados é recusado.
- **Montagem do pedido** (`canvas-regras.ts` e `canvas.ts`): a foto entra como referência com texto próprio por papel; personagem que veio de persona volta à âncora dela; pessoa real herdada segue a regra de pessoa real; a cena leva o bloco da cena, a pessoa em 1º, a continuidade e a seed.
- **Cena:** o Resultado marcado guarda título, ação, enquadramento, lugar, narrativa, foto da cena, semente e a animação reservada.
- **História:** faixa no pé do quadro (e bloco no modo lista) com as cenas em ordem, arrastar ou setas para ordenar, duplicar para mudar o contexto, próxima cena com a mesma pessoa, gerar e variações com o custo à vista antes, e a sinopse.
- **Personagem persistente:** "Virar personagem" na foto cria a persona com a foto como âncora (sem custo) e gera a folha (frente, 3/4, perfil, meio corpo) pelo mesmo motor, uma vista por vez, com custo à vista e aprovação.

## Fontes

- https://higgsfield.ai/blog/sould-id-best-character-consistency
- https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-popcorn
- https://higgsfield.ai/blog/how-to-keep-ai-persona-consistent-higgsfield-popcorn
- https://higgsfield.ai/blog/ai-short-film-pipeline
- https://higgsfield.ai/blog/cinema-studio-guide
- https://ai.google.dev/gemini-api/docs/image-generation
- https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/
- https://blog.google/technology/ai/nano-banana-pro/
- https://www.atlascloud.ai/blog/guides/nanobanana-14-reference-images-consistency
- https://help.scenario.com/articles/6803483730-runway-gen-4-references
- https://replicate.com/blog/flux-kontext
- https://bfl.ai/blog/flux-2
- https://www.krea.ai/blog/character-design-with-krea-2
- https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide
- https://developers.openai.com/cookbook/examples/generate_images_with_high_input_fidelity
- https://seed.bytedance.com/en/seedream4_5
- https://kling.ai/blog/kling-3-subject-binding-character-consistency
- https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1
- https://seed.bytedance.com/en/blog/official-launch-of-seedance-2-0

Alguns números (3 referências do Runway, queda com mais de 2 pessoas no Nano Banana Pro, limites do Seedance) vêm de sites de terceiros, não da documentação oficial.
