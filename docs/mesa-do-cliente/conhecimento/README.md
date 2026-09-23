# Base de conhecimento de design da Mesa do cliente

Material que ensina o diretor de arte (LLM) a dirigir lâminas de carrossel e posts do Instagram em 4:5 (1080 x 1350). Tudo aqui foi lido e consolidado em `supabase/functions/_shared/conhecimento-design.ts` (versão `2026-09-23.2`).

## Como a base entra no agente

1. **`conhecimento-design.ts`** é a versão operacional: regras numeradas, com números para 1080 x 1350, e a lista de desempates quando os materiais discordam (vale sempre a regra mais conservadora). Tem três exports:
   - `VERSAO_CONHECIMENTO`: sobe a cada revisão da base.
   - `CONHECIMENTO_DIRETOR`: entra no **início do sistema do diretor de arte** em `supabase/functions/estudio-arte/index.ts` (`sistema: CONHECIMENTO_DIRETOR + prompt do diretor + INSTRUCOES_DIRECAO`). Por ser um prefixo fixo, o provedor reaproveita o cache e o custo cai. Limite de 6.000 palavras.
   - `PADRAO_NA_IMAGEM`: 12 linhas curtas e imperativas que o compositor (`supabase/functions/_shared/direcao-arte.ts`, função `promptDaLamina`) coloca **no fim de todo prompt de imagem**. Também vai no sistema do ajuste de lâmina (`INSTRUCOES_AJUSTE` em `estudio-arte/index.ts`).
2. O compositor `direcao-arte.ts` já aplica em código parte das regras (margens de 90/100/106 px, 34 px extras na capa, canto superior direito livre, tamanhos por papel, paleta 60-30-10). Os ajustes recomendados para alinhar o código à base estão em `regras-do-compositor.md`.
3. Os arquivos desta pasta não são lidos em tempo de execução. Para mudar o comportamento do agente, edite `conhecimento-design.ts` e suba a versão.

## Índice dos arquivos

### PDFs enviados pelo dono (pasta `Design/` do dono)

| Arquivo | Origem | Conteúdo |
|---|---|---|
| `pdf-gestalt.md` | PDF do dono `Design/arquivo_anexo_22032.pdf` (mapa mental "Gestalt") | Leis da Gestalt aplicadas ao card: ponto focal, proximidade em px, fechamento, corte, figura e fundo. |
| `pdf-tipografia-1.md` | PDF do dono `Design/arquivo_anexo_22564.pdf` (mapa mental "Tipografia") | Termos, espaçamentos, hierarquia em 3 níveis, alinhamento, quebras, as 13 dicas. |
| `pdf-tipografia-2.md` | PDF do dono `Design/arquivo_anexo_22565.pdf` (infográfico de anatomia tipográfica) | Anatomia da letra, terminais, serifas, eixo, entrelinha com acentos do português, kerning. |
| `pdf-cores.md` | PDF do dono `Design/arquivo_anexo_22571.pdf` (mapa mental "Cores") | Perfis, roda, harmonias, temperatura, processo de paleta, psicologia e 60-30-10. |
| `pdf-cores-22570.md` | PDF do dono `Design/arquivo_anexo_22570.pdf` ("Estudo das Cores!", Thiago Rodrigues) | Paleta consciente, psicologia por cor, 60-30-10 em px, contraste e combinações proibidas. |
| `pdf-grid.md` | PDF do dono `Design/arquivo_anexo_22569.pdf` (mapa mental "GRIDS") | Anatomia do grid e o grid de referência 1080 x 1350 (margens 90/100/106, 6 colunas, zonas do Instagram). |
| `pdf-grids-22568.md` | PDF do dono `Design/arquivo_anexo_22568.pdf` (amostra de "Criar Grids", Beth Tondreau) | Estruturas de grid, cor como organizadora, ritmo, oásis, silhuetas, grid suíço. |
| `pdf-tecnicas-22031.md` | PDF do dono `Design/arquivo_anexo_22031.pdf` ("Técnicas e Recursos de Design", DG PRO) | As 20 técnicas de composição (linhas, escala, cor, opacidade, profundidade, enquadramento etc.). |

### Aulas em vídeo (resumos por legenda e quadros)

| Arquivo | Vídeo | Conteúdo |
|---|---|---|
| `videos/fundamentos-01-forma-segue-funcao.md` | https://youtu.be/rAPVo37iaHU | Forma segue a função, hierarquia pelo objetivo, equilíbrio óptico. |
| `videos/fundamentos-02-gestalt.md` | https://youtu.be/4m1dKNPXskU | Leis da Gestalt faladas, teste do todo, anomalia. |
| `videos/fundamentos-03-proximidade.md` | https://youtu.be/OIRRBeWK77M | Proximidade, razão 1:3 de espaços, erro dos quatro cantos. |
| `videos/fundamentos-04-alinhamento-balanceamento.md` | https://youtu.be/N1oQHiXXGD8 | Grid antes do layout, poucos eixos, quebra intencional, quadrantes. |
| `videos/fundamentos-05-contraste.md` | https://youtu.be/_VB0oUI2ciQ | Os 12 tipos de contraste e um contraste dominante por lâmina. |
| `videos/fundamentos-06-repeticao.md` | https://youtu.be/L-mGMhHlSMM | Repetição, folha de estilos do carrossel, teste da logo coberta. |
| `videos/fundamentos-07-design-com-intencao.md` | https://youtu.be/G5Hy76v-vu4 | Design com intenção, ponto de contato, anticlichê. |
| `videos/fundamentos-08-o-que-faz-um-designer.md` | https://youtu.be/XNulpmEKIa8 | Papel do diretor de arte e processo criativo. |
| `videos/fundamentos-sintese.md` | Síntese das 8 aulas de fundamentos acima | Princípios, regras mensuráveis R1 a R28, frases de prompt e checklist. |
| `videos/tipografia-01-principios.md` | https://youtu.be/n9cODVZ_Dfw | Termos, classificação e espaçamentos. |
| `videos/tipografia-02-usabilidade-hierarquia-alinhamento.md` | https://youtu.be/jbZ7NJMjFeU | Hierarquia, legibilidade, alinhamento, trapos, viúvas e órfãos. |
| `videos/tipografia-03-13-dicas.md` | https://youtu.be/PlMRf6FvoTw | As 13 dicas práticas de uso de fontes. |
| `videos/tipografia-04-fontbase-gerenciador.md` | https://youtu.be/64HqEzhkK3g | Gerenciar e testar fontes; ligação com `cliente_fontes`. |
| `videos/tipografia-sintese.md` | Síntese das 4 aulas de tipografia acima | Classes, pareamentos, escala em px, entrelinha, tracking, fonte por nicho. |
| `videos/cor-01-teoria-das-cores.md` | https://youtu.be/b_fZVEjFEGY | Perfis, roda e harmonias com o risco de cada uma. |
| `videos/cor-02-criacao-de-paletas.md` | https://youtu.be/XDNKdm3N0sc | Como montar paleta para marca e para peça; ferramentas. |
| `videos/cor-03-psicologia-das-cores.md` | https://youtu.be/SGvUMYL72xg | Psicologia, cor e conversão, 60-30-10. |
| `videos/cor-sintese.md` | Síntese das 3 aulas de cor acima | Tabela de cores, harmonias, contraste WCAG calculado, cor por nicho. |
| `videos/tecnicas-01-recursos-e-tecnicas-parte-1.md` | https://youtu.be/om6zWM0FI8A | Recursos 01 a 10 comentados (linhas a hierarquia). |
| `videos/tecnicas-02-recursos-e-tecnicas-parte-2.md` | https://youtu.be/h9K4n6r4oj4 | Recursos 11 a 20 comentados (contraste a composição). |
| `videos/tecnicas-03-grids.md` | https://youtu.be/ujkV1UaxHYE | Grid de grades 20 x 20 para posts e grid em logotipo. |
| `videos/tecnicas-sintese.md` | Síntese das 3 aulas de técnicas cruzada com o quadro de referências | Técnicas para cards (recorte, painel, planos, texto atrás do sujeito, metáfora, carrossel contínuo). |

### Referências e pesquisa

| Arquivo | Origem | Conteúdo |
|---|---|---|
| `referencias-globais.md` | Quadro do Pinterest "Referências de Composição Visual" do professor Thiago Rodrigues (https://br.pinterest.com/thiagorodri/refer%C3%AAncias-de-composi%C3%A7%C3%A3o-visual/), 25 pins mais recentes lidos em 2026-09-23 | Padrões de boa composição, famílias de composição e como o diretor usa o banco. |
| `referencias-globais.json` | Mesmo quadro do Pinterest | Dados por peça: URL do pin, imagem, leitura da técnica e tags. |
| `pesquisa-repositorios-e-bancos.md` | Pesquisa própria de 2026-09-23 (GitHub, documentação oficial da OpenAI e do Google, bancos de referência) | Repositórios úteis, bancos legais de referência, técnicas para o gerador respeitar grid e hierarquia, recomendação final. |
| `regras-do-compositor.md` | Recomendação derivada desta base | Ajustes sugeridos no compositor `direcao-arte.ts` (não aplicados). |
| `README.md` | Este índice | |
