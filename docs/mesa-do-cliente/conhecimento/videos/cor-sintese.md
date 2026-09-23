# Síntese de cor para o diretor de arte (cards 4:5, 1080x1350)

Base: três aulas de "Imersão no mundo das cores" (Cursos Thiago) resumidas em `cor-01` a `cor-03`, mais valores de contraste do padrão WCAG convertidos para o card de celular. Onde a regra não veio das aulas, está marcada como regra de trabalho.

Contexto do sistema: a paleta do cliente fica em `cliente_kit_marca.paleta` como `[{nome, hex, papel}]`. O diretor de arte escolhe as cores de cada lâmina a partir desses papéis e descreve no prompt com hex e função.

---

## 1. Psicologia e função das cores

As cores mexem com emoção e ativam gatilhos (neuromarketing). Uma boa cor vende; a certa vende mais. A leitura muda com cultura, gênero e contexto, e toda cor tem lado negativo (roda de Plutchik). Parta sempre da essência da marca.

| Cor | Sensação principal | Função no card | Nichos típicos | Cuidado |
|---|---|---|---|---|
| Vermelho | energia, paixão, urgência, apetite; acelera o coração | selo de oferta, "últimas unidades", preço de liquidação | fast-food, varejo, promoção | em botão de ação lê como "pare"; cansa em área grande |
| Laranja | alegria, entusiasmo, amizade, impulso | CTA de compra, destaque de preço | cursos, varejo, alimentação, pet | branco sobre laranja claro não tem contraste |
| Amarelo | otimismo, juventude, atenção (sinalização) | chamar o olho para um ponto, fundo de faixa de destaque | alimentação, promoção, infantil | ruim como cor dominante em saúde (exemplo da aula: clínica odontológica); texto branco sobre amarelo é ilegível |
| Verde | natureza, saúde, riqueza, crescimento, calma | CTA, "ok", sustentabilidade, dinheiro | saúde, finanças, agro, natural | verde muito saturado cansa |
| Azul | confiança, segurança, tranquilidade; cor preferida da maioria | dominante de marcas de confiança, CTA de agendamento | bancos, saúde, jurídico, tech, seguros | pode soar frio ou triste em excesso |
| Rosa | carinho, feminino, romântico, amor próprio | tom afetivo, datas comemorativas | beleza, moda feminina, confeitaria | clichê se usado só por ser "para mulher" |
| Roxo / violeta | sofisticação, criatividade, calma, mistério | marca criativa, luxo acessível | estética, anti-idade, tech, açaí | combinações vibrantes podem ficar infantis |
| Preto | poder, luxo, elegância, seriedade | fundo premium, texto principal | moda, luxo, automotivo, Black Friday | fundo preto com texto fino some no celular |
| Cinza | equilíbrio, neutralidade, tecnologia | fundo, texto secundário, apoio | tech, corporativo | cinza médio com texto branco falha no contraste |
| Branco / off-white | limpeza, pureza, espaço | fundo, respiro | saúde, minimalista, luxo | branco puro em área grande pode estourar; off-white é mais elegante |
| Dourado / metálicos | valor, riqueza, prêmio | detalhe, fio, selo | luxo, beleza, joias | em área grande vira bege sem brilho |

Temperatura (aula 03):
- **Quentes** (vermelho, laranja, amarelo): imediatismo, impulso, decisão rápida, promoção relâmpago, comida.
- **Frias** (verde, azul, roxo): calma, compromisso, confiança, sofisticação.
- **Neutras** (preto, cinza, branco, bege): a "caminha" onde as outras cores se apoiam; descansam o olho.

Cor e conversão (aula 03): CTA de compra em laranja ou verde; azul em nicho de confiança; vermelho em botão de ação tende a converter menos.

## 2. Harmonias

| Harmonia | Como montar | Resultado | Risco | Quando usar no card |
|---|---|---|---|---|
| Monocromática | uma matiz variando luz e saturação | coesa, calma, segura | monótona | marca de uma cor só, conteúdo informativo, carrossel educativo |
| Análoga | 3 vizinhas na roda | elegante, equilibrada, pouco contraste | falta de ponto focal | lifestyle, beleza, natureza; eleja uma dominante |
| Complementar | 2 opostas na roda | contraste máximo de matiz, impacto | vibração se as duas forem saturadas em áreas iguais | dominante + complementar só em CTA e destaque |
| Complementar dividida (split) | análoga + a complementar da dominante como acento | harmônica e com ponto focal | quase nenhum; técnica preferida do professor | marcas em geral; post de conversão |
| Tríade | 3 equidistantes | vibrante, divertida, colorida mesmo em pastel | "matar" o layout se usada sem dominante | infantil, açaí, app, datas festivas |
| Tétrade | 4 cores em retângulo | rica, muitas funções | a mais fácil de errar, barulhenta | só quando a marca já tem 4 cores; uma domina |

A roda dá o ponto de partida, não a resposta final: ajuste luz, saturação e matiz a olho até harmonizar (aulas 02 e 03).

## 3. Proporção 60-30-10

- **60%** cor dominante: fundo ou maior área.
- **30%** cor de apoio: blocos, formas, faixa, foto tratada; análoga ou monocromática da dominante.
- **10%** acento: CTA, palavra destacada, selo, ícone; geralmente complementar ou a cor de destaque da marca.
- Analogia do terno: terno e calça 60, camisa 30, gravata 10.
- Os neutros entram dentro dos 60 ou dos 30 (fundo off-white, texto quase preto).

Como mapear para o kit (regra de trabalho):
- Papel `primaria` ou `dominante` → 60% ou 30%, conforme a lâmina seja clara ou escura.
- Papel `secundaria` / `apoio` → 30%.
- Papel `destaque` / `acento` / `cta` → 10%, nunca mais que isso.
- Papel `neutro` / `fundo` / `texto` → fundo e texto.
- Em carrossel, mantenha a mesma dominante em todas as lâminas e alterne no máximo entre versão clara e versão escura para ritmo. O acento aparece só onde há destaque.

## 4. Contraste e legibilidade (valores mínimos)

Base: razão de contraste WCAG 2.x, convertida para o card. No celular, 1 px do canvas vira cerca de 0,36 px de tela; "texto grande" no WCAG (24 px de tela, ou 18,7 px em negrito) corresponde a cerca de 64 px no canvas (52 px em negrito).

| Elemento no canvas 1080x1350 | Contraste mínimo | Recomendado |
|---|---|---|
| Texto abaixo de 64 px (ou abaixo de 52 px em negrito): texto corrido, rodapé, @ | 4,5:1 | 7:1 |
| Título a partir de 64 px (ou 52 px em negrito) | 3:1 | 4,5:1 |
| Botão, ícone, borda de elemento essencial contra o fundo | 3:1 | 4,5:1 |
| Texto sobre foto | mesmo mínimo, medido contra a área mais clara ou mais escura atrás do texto | usar faixa sólida, gradiente ou escurecimento de 40% a 60% |

Referências calculadas (para calibrar o olho):
- Branco sobre azul marinho #0B2A4A: 14,5:1 (ótimo).
- Off-white #F5F1EA sobre quase preto #1A1A1A: 15,5:1 (ótimo).
- Branco sobre laranja #F28C28: 2,45:1 (falha até para título). Use texto #111111 sobre esse laranja (7,7:1) ou escureça o laranja para #C2410C (5,2:1 com branco).
- Branco sobre amarelo #FFD600: 1,4:1 (ilegível). Preto sobre o mesmo amarelo: 13,4:1.
- Branco sobre vermelho #E53935: 4,2:1 (só título ou texto grande em negrito).
- Branco sobre verde #16A34A: 3,3:1 (só título); sobre verde #2E7D32: 5,1:1.
- Branco sobre azul #1877F2: 4,2:1 (título ou botão com texto em negrito grande).
- Branco sobre rosa #EC4899: 3,5:1 (só título); sobre roxo #7C3AED: 5,7:1.
- Branco sobre cinza #9CA3AF: 2,5:1 (falha).
- Marrom #6B4F2A sobre preto: 2,8:1 (o exemplo de ilegibilidade da aula 02).

Regras práticas:
- Contraste não é só de cor: diferença de luminosidade é o que o olho lê. Duas cores complementares com a mesma luminosidade vibram e não se leem (vermelho puro sobre verde puro).
- Texto nunca sobre área com muito detalhe da foto.
- Evite preto puro #000000 e branco puro #FFFFFF em áreas grandes; quase preto e off-white são mais confortáveis e continuam com contraste alto.

## 5. Como montar a paleta a partir das cores da marca

Fluxo das aulas adaptado para o card:
1. **Leia o kit**: quais cores existem e com que papel. Se o post precisa seguir a identidade (quase sempre, em cliente de agência), a paleta sai do kit.
2. **Leia o tom do tema**: alegre, urgente, sério, sensível, luxuoso. Tema sensível (luto, saúde mental, dívida) pede versão dessaturada e fria, com a cor vibrante só em detalhe (aula 02: depressão pediu azul acinzentado, não amarelo).
3. **Escolha a dominante** da lâmina entre as cores da marca que servem ao tom.
4. **Derive o apoio** por monocromia (versões mais claras e mais escuras da dominante) ou pelas análogas do kit.
5. **Defina o acento**: a cor de destaque do kit; se o kit não tiver, a complementar ou complementar dividida da dominante, usada só nos 10% (e registrada como sugestão para aprovar no kit).
6. **Complete com neutros com tempero da marca**: off-white levemente quente ou frio e quase preto puxado para a matiz da marca (ex.: #0E1624 em vez de #000000 para marca azul).
7. **Se houver foto**, puxe o apoio da própria foto (conta-gotas) e peça tratamento de cor leve para aproximar a foto da marca (aula 02: paleta verde tirada das fotos da Amazônia; sobreposição de cor com modos de mesclagem).
8. **Teste de contraste** de cada par texto/fundo (seção 4).
9. **Ajuste a olho**: puxe matiz, tire saturação, até ficar harmônico. A roda é guia, não lei.

Quando o kit tem só uma cor (regra de trabalho):
- Dominante = a cor da marca; apoio = 2 variações monocromáticas (uma clara para fundo, uma escura para texto ou bloco); acento = complementar dividida em uso mínimo; neutros = off-white e quase preto tingido.

Ferramentas citadas: Adobe Color (regras e extração de imagem), Coolors (trava a cor da marca e sugere as outras; extrai de foto), Paletton (adiciona complementar), Color Calculator da Sessions College (gera harmonias e exporta HEX/RGB/CMYK).

## 6. Cor por nicho (ponto de partida, sempre subordinado ao kit)

| Nicho | Dominante típica | Apoio | Acento | Evitar |
|---|---|---|---|---|
| Clínica médica, odontologia | azul, verde-água | branco, cinza claro | verde ou azul vivo no CTA | amarelo dominante, vermelho em excesso |
| Advocacia, contabilidade, consultoria | azul marinho, vinho, grafite | off-white, bege | dourado sóbrio | neon, tríade vibrante |
| Estética, beleza | nude, rosa queimado, lilás | off-white | dourado, vinho | saturação máxima |
| Moda | preto e branco | cor da coleção | uma cor forte | muitas cores ao mesmo tempo |
| Luxo, joias, imóveis de alto padrão | preto, off-white, verde escuro | bege, cinza quente | dourado | cores primárias puras |
| Fast-food, hamburgueria, pizzaria | vermelho, amarelo | preto, creme | laranja | azul dominante (reduz apetite na leitura popular) |
| Açaí, sorveteria, doces | roxo, rosa | branco, creme | verde-limão, amarelo (tríade) | paleta sóbria demais |
| Academia, esporte, suplemento | preto, grafite | cinza | laranja, verde neon, vermelho | pastel |
| Finanças, crédito, investimento | azul, verde escuro | branco | verde ou dourado | vermelho dominante |
| Tecnologia, SaaS, agência | azul, roxo, escuro | cinza | ciano, verde, gradiente | marrom, bege |
| Cursos, infoproduto, mentoria | escuro (azul noite, preto) | cinza | laranja ou verde no CTA | CTA vermelho |
| Infantil, pet | cores suaves em tríade | branco | amarelo, laranja | preto dominante |
| Agro, sustentável, natural | verdes, terrosos | bege | amarelo, laranja queimado | neon |
| Automotivo, oficina | preto, grafite | cinza metálico | vermelho ou azul | pastel |
| Datas: Black Friday | preto | grafite | amarelo, laranja | pastel |
| Datas: Dia das Mães, Dia da Mulher | rosa, lilás, nude | off-white | dourado, vinho | tons agressivos |

## 7. Erros comuns
- Tudo em destaque, cada frase com um fundo de cor diferente ("carnaval"): nada se destaca.
- Botão de compra vermelho.
- Texto branco sobre amarelo, laranja claro, verde claro, rosa claro ou cinza médio.
- Texto de cor escura sobre fundo escuro (marrom sobre preto).
- Duas cores complementares saturadas, em áreas iguais, com texto de uma sobre a outra.
- Tríade ou tétrade sem cor dominante.
- Cor alegre em tema sensível; cor fria e apagada em promoção relâmpago.
- Amarelo dominante em clínica de saúde.
- Trocar a cor da marca por gosto pessoal ou por tendência.
- Cada lâmina do carrossel com uma paleta diferente (quebra a unidade).
- Foto com cores que brigam com a marca, sem tratamento.
- Preto e branco puros em áreas grandes.
- Descrever cor no prompt só pelo nome ("azul"), sem hex e sem função.

## 8. Frases prontas para o prompt

Paleta e proporção:
- PT: "Paleta da marca: 60% azul marinho #0B2A4A no fundo, 30% azul claro #DCE8F5 nos blocos, 10% laranja #F28C28 só na palavra destacada e no botão."
- EN: "Brand palette: 60% deep navy #0B2A4A background, 30% light blue #DCE8F5 panels, 10% orange #F28C28 used only on the highlighted word and the button."

Harmonia:
- PT: "Harmonia complementar dividida: azuis análogos como base e um único acento laranja."
- EN: "Split-complementary harmony: analogous blues as the base with a single orange accent."
- PT: "Paleta monocromática em tons de verde-sálvia, do claro ao escuro, com texto quase preto."
- EN: "Monochromatic sage green palette from light to dark, with near-black text."
- PT: "Tríade vibrante e divertida (roxo, amarelo e verde-limão), com roxo dominante."
- EN: "Playful vibrant triadic palette (purple, yellow, lime green) with purple as the dominant color."

Contraste:
- PT: "Texto com contraste alto e leitura fácil no celular; texto nunca sobre área com detalhe."
- EN: "High-contrast, easily readable text on a phone screen; text never placed over busy detail."
- PT: "Escurecer a foto com gradiente de 50% atrás do título para garantir leitura."
- EN: "Darken the photo with a 50% gradient behind the headline to guarantee legibility."
- PT: "Texto quase preto #111111 sobre o botão laranja, não branco."
- EN: "Near-black #111111 text on the orange button, not white."

Tom e temperatura:
- PT: "Cores quentes e energéticas para uma oferta relâmpago."
- EN: "Warm, energetic colors for a flash sale."
- PT: "Paleta fria, calma e dessaturada, com respiro, para um tema sensível."
- EN: "Cool, calm, desaturated palette with plenty of breathing room for a sensitive topic."
- PT: "Fundo off-white quente e texto grafite; acento dourado discreto, sensação de luxo silencioso."
- EN: "Warm off-white background with graphite text and a subtle gold accent, quiet luxury feel."

Foto e consistência:
- PT: "Tratamento de cor leve na foto para puxar os tons para o azul da marca."
- EN: "Subtle color grading on the photo, pulling its tones toward the brand blue."
- PT: "Mesma paleta e mesmo fundo das lâminas anteriores do carrossel."
- EN: "Keep exactly the same palette and background treatment as the previous carousel slides."
- PT: "Sem cores fora da paleta indicada; sem gradientes arco-íris; sem neon."
- EN: "No colors outside the specified palette; no rainbow gradients; no neon."

---

## Checklist de revisão de cor (sim/não)

Responda sim ou não. Qualquer "não" volta para ajuste.

1. Todas as cores da lâmina estão no kit do cliente (ou são variações claras/escuras dele, ou um acento aprovado)?
2. Há uma cor claramente dominante?
3. A proporção se aproxima de 60-30-10, com o acento em no máximo 10% da área?
4. O acento aparece só no destaque, no selo ou no CTA?
5. A temperatura e o humor das cores combinam com o tom do tema (promoção quente, confiança fria, tema sensível dessaturado)?
6. A cor do CTA favorece a ação (laranja, verde ou azul de confiança; não vermelho em botão de compra)?
7. Todo texto abaixo de 64 px (52 px em negrito) tem contraste de pelo menos 4,5:1 com o fundo?
8. Todo título grande tem contraste de pelo menos 3:1?
9. Nenhum texto branco está sobre amarelo, laranja claro, verde claro, rosa claro ou cinza médio?
10. Texto sobre foto tem faixa, gradiente ou área calma atrás?
11. Não há duas cores saturadas de mesma luminosidade com texto de uma sobre a outra?
12. A paleta é a mesma em todas as lâminas do carrossel?
13. A foto usada foi tratada para conversar com a paleta?
14. O nicho não tem uma cor a evitar presente como dominante (ex.: amarelo em clínica)?
15. Pretos e brancos em área grande são quase preto e off-white, e não puros?
16. O prompt descreve cada cor com hex, função e proporção?
17. Olhando a lâmina pequena e em escala de cinza (mentalmente), título, texto e CTA continuam distinguíveis?
