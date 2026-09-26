# Estilo do cliente (frente S2, 26/09/2026)

Pedido do dono: um agente de estilo de design por cliente, especialista em
design, arte, post e carrossel, acionado só quando ele quiser, dentro dos
estúdios que geram imagem. Ele monta e aprende o ESTILO DE DESIGN daquele
cliente (contexto, artes aprovadas, referências que o dono manda, tendência do
nicho), pode ser mudado a qualquer hora e é COMPLEMENTO: não troca a base, não
é obrigatório e não mexe no que já funciona.

## 1. Pesquisa (resumo com fontes)

### O que um guia de estilo de social precisa ter

Guia de marca comum fala de logo, cor e fonte. Para post e anúncio isso não
basta: o guia precisa decidir a produção (formato da capa, hierarquia do
título, área segura do texto, padrão de CTA, regras dos formatos que se
repetem). Pontos que se repetem nas fontes:

- Cor com função, não só lista de hex: uma cor dominante, um destaque e
  neutros de apoio por lâmina. Mais que isso vira ruído. A cor controla a
  hierarquia (o que se lê primeiro, o que se salva).
- Uma a três famílias de letra no máximo, e no carrossel no máximo dois
  tamanhos de texto por lâmina (título e apoio).
- Tratamento de foto igual em todas as peças (luz, contraste, temperatura,
  grão). A série se reconhece pelo tratamento antes do texto.
- Margens e área segura idênticas em todas as lâminas; proporção única (4:5).
- Carrossel: a capa é gancho (promessa concreta, contraste alto, pouca
  palavra, legível na miniatura); o miolo tem uma ideia por lâmina, cerca de
  25 palavras no máximo, com o mesmo molde; a última lâmina espelha a capa e
  traz um CTA só. O erro mais comum é desenhar cada lâmina como peça
  separada. Dica prática: desenhe a segunda lâmina primeiro; se ela conversa
  com a capa, achou o molde.
- Logo discreto (menos de 15% da área), indicador de progresso opcional
  (1/7) e sinal de "arraste" sutil na capa.

Fontes: [Hootsuite, guia de estilo de social 2026](https://blog.hootsuite.com/social-media-style-guide/),
[PostNitro, modelo de guia de estilo](https://postnitro.ai/blog/post/brand-style-guide-template),
[Metricool, guia de design de social](https://metricool.com/social-media-design-guide/),
[Adpicto, carrossel lâmina por lâmina](https://www.adpicto.com/en/blog/instagram-carousel-best-practices-2026),
[Social Habit, guia de carrossel](https://www.socialhabitmarketing.com/article-posts/the-ultimate-guide-to-designing-a-perfect-instagram-carousel),
[TrueFuture, estratégia de carrossel 2026](https://www.truefuturemedia.com/articles/instagram-carousel-strategy-2026).

### Como a IA de imagem segue melhor um estilo

- Prompt em ordem fixa e com rótulos curtos (cena, assunto, detalhes,
  restrições) e com o uso dito (post, anúncio): o modelo acerta o "modo" e o
  acabamento. Frases longas soltas perdem.
- Várias imagens de entrada: nomear cada uma por índice e papel ("Imagem 2:
  referência de estilo") e dizer como se combinam ("aplique o acabamento da
  Imagem 2"). O painel já faz isso nas referências da lâmina.
- Dizer o que NÃO pode mudar junto com o que muda, e repetir a lista a cada
  geração para não derivar.
- Texto literal entre aspas, com letra, tamanho, cor e posição.
- Série: fixar uma âncora (a arte aprovada) e pedir "mesmo estilo" a partir
  dela, em vez de redesenhar a cada vez.
- O estilo de marca funciona melhor como um bloco salvo e reaproveitado
  (paleta, luz, acabamento, clima) do que redescrito a cada pedido.

Fontes: [OpenAI, guia de prompt dos modelos de imagem](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide),
[OpenAI, guia do gpt-image-1.5](https://developers.openai.com/cookbook/examples/multimodal/image-gen-1.5-prompting_guide),
[getimg.ai, estilo consistente](https://getimg.ai/blog/how-to-generate-images-in-consistent-brand-style-with-ai),
[CapCut, GPT Image 2 para guia de marca](https://www.capcut.com/ideas/gpt-image-2/gpt-image-2-for-brand-style-guides).

Nenhum texto foi copiado; o que entrou no painel é resumo próprio.

## 2. Como virou código

| Peça | Onde |
| --- | --- |
| Conhecimento destilado (blocos) | `supabase/functions/_shared/conhecimento-estilo.ts` |
| Registro no índice dos motores | `supabase/functions/_shared/motores.ts` (motor `estilo.agente`, fonte `pesquisa_estilo`) |
| Modelo do estilo (tipos, normalização, bloco curto do prompt) | `supabase/functions/_shared/estilo-do-cliente.ts` |
| Ações do agente (apelidos, contrato comum) | `supabase/functions/agente-estilo/acoes-do-estilo.ts` |
| Agente (conversa, leitura das referências, testes, aprovar) | `supabase/functions/agente-estilo/index.ts` |
| Ligação com a geração (aditiva) | `estudio-arte` e `mesa-ads`: bloco `ESTILO DO CLIENTE` só com o interruptor ligado |
| Tela | `src/components/estilo/` (botão Estilo, painel com Conversa, Estilo e Testes, interruptor) |
| SQL | scratchpad `S2-estilo-do-cliente.sql` |

### O estilo guardado

Um estilo por cliente e marca (`cliente_estilos`), com versões:

- `resumo`: 2 a 3 frases do jeito do cliente.
- `regras`: layout e grade, tipografia, cor (com função), foto (tratamento),
  elementos gráficos, capa, miolo, CTA e o que evitar. Cada campo é lista de
  frases curtas e concretas.
- `referencias`: ids das imagens do acervo (`cliente_imagens`) que o estilo
  usa como guia de acabamento (máximo 4 vão ao gerador).
- `aprendizados`: "gostou" ou "não gostou", com a frase e a data.
- `ativo`: o estilo pode ser usado nas gerações.
- `versao_atual` e `versoes`: cada mudança confirmada vira versão; dá para
  voltar para uma anterior.

Não duplica o kit: paleta, logo e fontes continuam no kit da marca
(`cliente_kit_marca` ou `cliente_marcas`). O estilo fala de COMO usar (função
da cor, hierarquia, tratamento), nunca repete hex ou arquivo de logo.

Sem a tabela (SQL pendente), o agente guarda o estilo num JSON no
armazenamento do cliente e avisa. Nada quebra.

### Na geração (regra de ouro)

- Interruptor "Usar estilo do cliente nesta geração", desligado por padrão,
  por trabalho (`direcao.usar_estilo_do_cliente`).
- Desligado ou estilo inativo: o prompt é byte a byte o de hoje (teste com o
  fixture `replicar-identica-hoje.json` e um fixture novo do modo normal).
- Ligado: um bloco curto `ESTILO DO CLIENTE` entra no fim do prompt, depois de
  tudo o que já existe, e as referências do estilo entram depois das da
  lâmina, como guia de acabamento. A ordem e o conteúdo aprovado do
  `promptDaLamina` e do `promptDoReplicar` não mudam; o texto da lâmina e as
  referências da lâmina continuam valendo sobre o estilo.
- O modelo de imagem não muda.

### O agente

- Conversa em português, entende várias referências de uma vez (leitura por
  visão das imagens anexadas ou escolhidas do acervo).
- Propõe o estilo em blocos claros; só grava com confirmação (cartão
  Confirmar ou Cancelar, com Desfazer).
- Registra aprendizados ("o cliente não gostou de fundo escuro").
- Gerar teste: 1 a 4 imagens com o MESMO gerador do Estúdio, custo mostrado
  antes. Aprovar um teste sobe a imagem para o acervo (Arquivos) e a marca
  como referência do estilo.

## 3. Templates e combinação (frente T, 26/09/2026)

Pedido do dono: o agente de estilo cria REFERÊNCIAS e TEMPLATES com base no
que o cliente gosta, no que o dono gosta e no que vai ser montado; combina um
template aprovado com uma referência nova (ou dois templates) e fica com o
melhor de cada um. É complemento: não troca o kit, o estilo nem a direção.

| Peça | Onde |
| --- | --- |
| Modelo do template, versões, gostos, bloco TEMPLATE, combinação (puro) | `supabase/functions/_shared/templates-de-design.ts` |
| Continuidade do carrossel (leitura, faixa da borda, fatias) | `supabase/functions/_shared/continuidade-do-carrossel.ts` |
| Referência de carrossel (lâminas na ordem, mapa, partes) | `supabase/functions/_shared/referencia-de-carrossel.ts` |
| Trava da marca (letra, cor e logo sempre do cliente) | `supabase/functions/_shared/trava-da-marca.ts` |
| Ações do agente (n1, t*, r*, m1) | `supabase/functions/agente-estilo/acoes-dos-templates.ts` |
| Rotas, conversa e execução | `supabase/functions/agente-estilo/templates.ts` (plugado no `index.ts`) |
| Ligação com a geração | `estudio-arte/estilo-na-geracao.ts` (`templateNaLamina`) |
| Tela | `src/components/estilo/AbaTemplates.tsx`, `SeletorDeTemplate.tsx`, `templatesApi.ts` |
| SQL | scratchpad `T-01-templates-de-design.sql` (sem ele, JSON no bucket mesa) |

O template guarda: formato (post 4:5, carrossel, story, anúncio), regras por
dimensão (layout, hierarquia tipográfica, cor com função, tratamento,
elementos, capa, miolo, CTA, evitar), áreas (título, apoio, imagem, logo, CTA,
área segura), a continuidade do carrossel (lâminas, papel de cada uma, o que
cruza cada borda, ritmo), as âncoras com papel (capa, miolo, fechamento,
geral), os gostos ("cliente gostou", "dono não gostou", com a data) e as
versões com o "de onde veio". Do cliente ou da agência (a agência é lida por
toda a equipe). Apagar é arquivar.

Referência de carrossel: as lâminas guardadas na ordem (várias imagens ou um
print lado a lado, recortado em código pelo leitor da prancha), com as partes
de cada lâmina lidas (título, apoio, imagem, elementos, CTA, continuidade).
Ordenar arrastando ou pelas setas; a ordem nova vira versão.

Combinar: o dono escolhe 2 ou 3 fontes. Por dimensão, um Choice do Jev
("qual fonte resolve melhor esta dimensão para este cliente e este
objetivo", com a opção "combinar"); dimensão que só uma fonte descreve não vai
ao Jev. Depois, um Score de coerência do conjunto. O diretor de arte do
catálogo redige 1 proposta, ou 2 variações de uma vez quando a coerência fica
abaixo de 50% (sem laço de correção). Falha do Jev: nada de combinação
automática; a tela mostra a grade para o dono escolher cada dimensão.

Na geração (regra de ouro):

- Seletor "Template" ao lado do interruptor do estilo, "Nenhum" por padrão
  (`direcao.template_de_design`). Nenhum: prompt e entradas byte a byte os de
  hoje (teste com os fixtures do S2).
- Escolhido: bloco curto TEMPLATE (ou REFERÊNCIA DE CARROSSEL) depois do
  bloco do estilo, antes das regras de render. Imagens depois das da lâmina e
  das do estilo, dentro do limite do modelo: a lâmina da referência que esta
  segue, a faixa da borda da lâmina anterior e até 2 âncoras (as do papel da
  lâmina primeiro).
- Carrossel: o papel da lâmina (capa, miolo, fechamento) escolhe a parte do
  template. Referência de carrossel: 1 segue 1; com número diferente, capa
  com capa, miolos pela ordem repetindo o molde do miolo, fechamento com
  fechamento. Nível de fidelidade com os nomes do Estúdio.
- Continuidade: fundo ou foto que atravessa as lâminas fica com o carrossel
  contínuo que já existe (a cena é gerada uma vez e fatiada em código, a
  emenda bate no pixel; só GPT Image e 4:5). Elemento que cruza a borda: a
  lâmina N+1 recebe a faixa da borda direita da lâmina N (12% da largura,
  recorte determinístico) como referência de encaixe. O resto (cor que se
  repete, linha guia, numeração, narrativa) vai só em texto.
- Trava da marca: letra, cores e logo sempre do cliente. Fonte, hex e nome de
  cor que vierem da referência saem do texto antes de ir ao modelo; a regra
  da marca fecha o bloco. Vale também para o estilo do cliente (fonte e hex).

Gancho que falta no `estudio-arte/index.ts` (a frente R está nele): importar
`templateNaLamina` de `./estilo-na-geracao.ts`, a linha logo depois de
`const blocoDoEstilo = ...` e `blocoDoTemplate,` depois de cada
`blocoDoEstilo,` (texto exato no cabeçalho de `templateNaLamina`). Sem o
gancho a geração segue como hoje; o seletor só grava a escolha.
