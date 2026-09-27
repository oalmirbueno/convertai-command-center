# Referência e copy (frente R, 26/09/2026)

Pedido do dono: da referência vem o ESTILO (estratégia, layout, estética); a
imagem é montada com o CONTEXTO DA COPY e do roteiro da lâmina e com o design
do cliente. A imagem reforça a mensagem do texto. É complemento: o que já
funciona não muda.

## Como funciona (modo replicar referência, só no Estúdio)

1. **Leitura** (uma vez por referência, guardada em
   `<cliente>/estudio/leituras/conteudo-<ref>.json`, modelo de leitura do
   catálogo): ESTÉTICA (layout, tipografia, cores, luz, tratamento,
   composição, enquadramento, elementos, gancho) separada do CONTEÚDO
   (assunto, objetos, pessoas, cenário, texto escrito e sentido). O molde
   (layout medido) continua o mesmo arquivo de antes.
2. **Julgamento** (Jev, `_shared/jev.ts`): Noul "o assunto da referência serve
   para transmitir esta lâmina?" e Choice do que aproveitar (`tudo`,
   `estetica_e_tipo_de_cena`, `so_estetica`). Estado em campos nomeados:
   `lamina` (copy, função, posição), `post` (conceito, roteiro, ideia do
   diretor), `cliente` (negócio, público, oferta) e `referencia` (conteúdo).
   **Limiar: serve com 0,75 ou mais.** Abaixo disso adapta; na dúvida (meio)
   adapta com a troca conservadora (mesmo tipo de cena). O gasto vai à
   carteira por `cobrarJev`.
3. **Cena** (só quando não serve): o diretor de arte (modelo padrão
   `diretor_arte`) escreve UMA cena que transmite a copy, na mesma composição.
   Ela entra num bloco curto logo depois do `promptDoReplicar`:
   `ADAPTAR O CONTEÚDO À MENSAGEM`. Idêntica: composição quase exata com o
   assunto trocado. Próxima: composição parecida. Inspirada e Criativa: só
   reforça que a imagem transmite a copy.
4. **Guardado**: julgamento e cena ficam em `adapta-<ref>-<chave>.json`
   (chave do texto da lâmina). Refazer a lâmina com o mesmo texto não paga de
   novo. Sem laço de correção: uma leitura, um julgamento, uma cena.

**Fica igual a hoje, byte a byte** (fixture `replicar-identica-hoje.json`):
conteúdo que serve, lâmina sem copy, lâmina com foto do cliente (o assunto já
é dela), interruptor desligado, criativo de anúncio (Mesa Ads) e qualquer
falha da leitura, do Jev ou do diretor. Fixture do caminho adaptado:
`src/test/fixtures/replicar-adaptado.json`.

## Trava da marca (regra dura do dono)

Letra, cores (na função que a referência dá) e logo são sempre os do kit. A
cena passa por `neutralizarMarcaDaReferencia` (`_shared/trava-da-marca.ts`,
da frente T) antes de ir ao gerador, e o diretor nem recebe a tipografia e as
cores da referência.

Cor dos elementos gráficos: o molde guarda a cor da referência sempre como
hex, e `corDaMarcaNoPapel` sempre acha par quando o kit tem ao menos uma cor
válida (neutro vai ao neutro mais perto em luminância; colorida vai ao
destaque do kit, senão à primeira colorida). O fallback `|| x.cor` só dispara
com o kit SEM nenhuma cor (fixture aprovado `post 1:1 sem paleta`). Decisão
do dono (26/09): fica como está, porque não há cor do cliente para usar; um
teste trava esse comportamento. A tela avisa "Cliente sem cores no kit:
usando as da referência." com o link para o Contexto
(`EstudioAvisoSemFonte.tsx`, export `EstudioAvisoDoKit`).

Kit sem fonte: continua como hoje (o `promptDoReplicar` usa o desenho da
letra da referência, porque não há fonte do cliente). A tela da referência
mostra "Cliente sem fonte no kit: usando a da referência." com o link
"Definir fonte" para o Contexto, onde "Sugerir automaticamente"
(`agente-contexto`, ação `fontes_da_biblioteca`, escolha pelo Jev) sugere o
par de fontes (`src/components/mesa/ContextoCartaoMarca.tsx`).

## Rosto escolhido (acréscimo do dono)

Seletor **Rosto** (Nenhum, Cliente, Equipe, Fotos), por trabalho
(`direcao.rosto`):

- Cliente: rostos autorizados do Contexto (`cliente_rostos`, ativos) e clones
  da Mesa Foto (`foto_modelos`, origem `clone_de_foto_real`, autorização
  válida; fotos reais de `identidade_real`, a principal primeiro).
- Equipe: os mesmos, das empresas internas
  (`profiles.services_config.internal_company`).
- Fotos: até 2 enviadas na hora (`<cliente>/estudio/rostos/`), com a
  confirmação de autorização, ou até 3 escolhidas nas pastas e nos clones
  (ver Rosto v2).

Até 2 fotos entram depois dos anexos da lâmina e antes das do estilo do
cliente, no limite de imagens do modelo, com a legenda "identidade do rosto:
manter os traços; não copiar pose, fundo, roupa nem luz". O bloco
`ROSTO ESCOLHIDO` vem logo depois do bloco da copy: identidade muito fiel,
pose e enquadramento da arte, no lugar da pessoa da referência. "Destacar o
rosto" põe o rosto como ponto focal. Rosto escolhido que sumiu ou perdeu a
autorização: a geração recusa com aviso (409 `rosto_indisponivel`). Sem rosto:
nada é lido e nada muda.

### Rosto v2 (frente R2, 26/09)

Pedido do dono: "posso buscar qualquer foto que tiver pessoas, abrir a pasta,
selecionar qualquer foto e também o clone já gerado; detalhar sorrindo,
assim; e com base na foto ele tem que variar e compor com a imagem".

- **Escolher foto** (em Fotos): janela com Acervo (inclui a pasta Mesa Foto),
  Workspace, Arquivos e Clones. Clones mostram as fotos de origem, as
  variações GERADAS (acervo com a tag `clone:<id>`) e as vistas aprovadas da
  folha, só de clones usáveis (não arquivados, autorização válida), do
  cliente e da casa. Seleção de 1 a 3; foto que não é de clone pede a mesma
  confirmação de autorização do envio. Busca em todas as pastas e filtro
  "Só com pessoa" (metadados do acervo: categoria pessoa ou equipe, tags
  `tipo:pessoa` e `pessoa_real_autorizada`; e a leitura guardada). "Marcar
  pessoas" faz a leitura por visão barata (modelo de leitura do catálogo),
  até 12 fotos numa chamada, uma vez por foto, guardada em
  `<cliente>/estudio/leituras/pessoas.json` (sem SQL). Aba, pasta, filtro e
  busca lembrados por trabalho (`useEstadoDaTela`, chave
  `mesa:estudio:rosto-fotos:<trabalho>`). Miniaturas próprias
  (`.mini.jpg` ou original assinado), nunca a transformação do Storage.
- Gravado como `direcao.rosto = { fonte: "escolhidas", itens }`, com
  `i:<uuid>` (acervo), `w:<uuid>` (Workspace), `a:<uuid>` (Arquivos) e
  `k:<clone>:<foto>` (clone). Cada item é conferido de novo ao salvar e na
  geração (`localDoItemEscolhido`): do cliente, ativo; clone só usável; foto
  do acervo ligada a clone (tag ou foto de origem) só se algum desses clones
  ainda vale. Nenhuma válida: 409 `rosto_indisponivel`.
- **Como a pessoa aparece** (`direcao.rosto.como`, até 160 caracteres, em
  qualquer fonte): texto livre e pílulas (sorrindo, séria confiante,
  apontando para o título, de perfil, meio corpo, rosto em destaque). Vai ao
  bloco como "COMO ELA APARECE (pedido da equipe)", mantendo a identidade.
- **Variar e compor**: o bloco `ROSTO ESCOLHIDO` agora segue esta ordem:
  identidade muito fiel; das fotos só a identidade; a pose pedida; RECRIE a
  pessoa na composição (pose, gesto, olhar e enquadramento que combinam com
  o layout e deixam o texto livre, nunca a foto colada); o lugar dela;
  INTEGRADA NA LUZ DA ARTE, não na da foto (cor, direção e dureza da luz,
  reflexos, sombra de contato, mesma nitidez, grão e cor); sem escurecer;
  destacar.
- **Limite de imagens** (lâmina > rosto > referência > estilo e template):
  as escolhidas levam até 3 (as outras fontes, 2), sempre depois dos anexos
  da lâmina e antes do estilo e do template (`vagasDoRosto` com `max`).
- **Lâmina normal** (sem referência, foto, recorte, elementos e fora da Mesa
  Ads): com rosto escolhido, um Noul do Jev pergunta se a direção da lâmina
  pede pessoa (`LIMIAR_PEDE_PESSOA` 0,5; falha = sem rosto). Pede: as fotos
  entram no mesmo lugar, a referência automática da marca (anexo
  `identidade`) cede a vaga se faltar lugar, e o bloco (modo "lamina") vem
  logo depois da base. O seletor Rosto aparece na ferramenta Referências
  também sem referência escolhida.
- **Sem rosto = hoje**: nada é lido, o Jev não é chamado, nenhuma imagem
  entra; `blocoDoRostoNaNormal` vazio é filtrado (fixtures
  `lamina-normal-hoje.json` e `replicar-identica-hoje.json`).
- **Conferência depois de gerar (só aviso)**: a versão guarda
  `rosto.fotos_usadas`; a tela (`EstudioAvisoDoRosto`, na faixa da lâmina)
  chama `conferir_rosto` uma vez depois da conferência da lâmina: leitura por
  visão dos traços na arte e nas fotos e um Noul do Jev "outra pessoa?"
  (`LIMIAR_AVISO_DO_ROSTO` 0,5). Guarda em `conferencia_rosto` na versão
  (chamar de novo não paga) e mostra "O rosto pode não ser o da pessoa
  escolhida. Confira antes de aprovar." ou "A arte saiu sem a pessoa
  escolhida". Nada é refeito (sem laço de correção).

## Composição dinâmica (frente R3, 26/09)

Pedidos do dono: "não segue a jogada de texto, fica travado"; "atrás estava
escrito 'melhor' e ele copiou"; "os textos ficam numa cor só"; "o card 2 é um
textão, tem que chegar refinado".

**Jogada do texto (por nível).** O molde passou para a versão 2
(`VERSAO_DO_MOLDE`): cada bloco diz a `camada` (frente, atrás do assunto, por
cima) e o texto decorativo de fundo tem papel próprio (`decorativo`, com a
palavra em `texto_decorativo`). Os moldes guardados na versão 1 são lidos de
novo na próxima geração (uma leitura por referência). Causa do "travado": a
headline ia inteira para o maior bloco; quando a referência quebra o título em
lugares diferentes, as outras partes ficavam vagas. Agora:

- Idêntica: a headline se divide nos blocos do título da referência (mesmo
  desenho e escala), na ordem de leitura, cada parte com posição, alinhamento
  e camada ("HEADLINE (parte 1 de 2)").
- Próxima: as mesmas posições, com a linha "Liberdade da Próxima" (anda um
  pouco e muda a quebra, mantendo lado, alinhamento, ordem e camada).
- Inspirada e Criativa: sai "os blocos no mesmo eixo"; entra uma jogada própria
  (`JOGADAS` em `_shared/jogada-do-texto.ts`) que muda de lâmina para lâmina.
  Inspirada fica na família da jogada da referência (separados, agrupados ou
  atrás do assunto); Criativa escolhe a própria.

**Palavra decorativa.** O decorativo nunca recebe texto da lâmina. Um Choice
do Jev escolhe, entre candidatos tirados da copy (as opções são os próprios
candidatos, mais "nenhum"), o termo que entra no lugar; guardado em
`termo-<chave>.json` (refazer não paga de novo). Sem Jev: o primeiro candidato.
A palavra da referência só fica quando é o tema (está na copy). Criativa não
leva palavra decorativa. O termo vai ao texto exato das regras finais e a
versão guarda `termo_decorativo`, que a conferência passa a esperar.

**Cor por papel** (`hierarquiaDeCor`, só a paleta e os neutros da trava): a
headline fica na cor de hoje; o apoio vai a um neutro legível diferente dela;
a palavra-chave ganha o destaque (na cor, ou com um traço atrás quando a cor
não lê no fundo). Idêntica e Próxima: duas cores coloridas diferentes da
referência que viravam a mesma da marca separam de novo (`separarCoresRepetidas`).
Anúncio (Mesa Ads) fica como está.

**Lâminas 2 em diante.** Na preparação (diretor e roteiro), as lâminas acima
do limite (`_shared/limite-do-miolo.ts`, com os números do agente do Mês em
`_shared/menos-texto-nas-laminas.ts`) são enxutas numa chamada só ao redator;
a capa nunca muda; o que volta fora do limite, maior ou sem a headline fica
como estava. Nenhuma acima do limite: nada é chamado e "Montar do roteiro"
continua grátis. Com lâmina longa, a tela diz quantas ("2 longas, enxuga com
IA") e mostra o preço da chamada curta antes; depois, o aviso diz quais
chegaram enxutas (`miolo_enxuto`) e quais ainda passam (`miolo_longo`).
Na geração, a lâmina de conteúdo (da 2 à penúltima) ganha o bloco LÂMINA DE
CONTEÚDO DESENHADA (número, pergunta, comparação, lista ou elemento gráfico).

**O que mudou nos fixtures (intencional):**
- `replicar-identica-hoje.json`, caso "final com cta e selo, cena": o CTA
  passa de `cor #111418` para `cor #1F6F43` (o título e o CTA da referência
  eram de cores diferentes e viravam a mesma). Os outros 6 casos são iguais.
- `lamina-normal-hoje.json`: capa, miolo, final e 1:1 ganham a linha "Cor com
  hierarquia" depois dos blocos; o anúncio 9:16 é igual.
- `replicar-adaptado.json`: Próxima ganha 2 linhas (liberdade e destaque);
  Inspirada e Criativa trocam a linha do "mesmo eixo" pela jogada e ganham a
  cor em cada bloco e a linha da hierarquia. Idêntica é igual.

## Série e miolo (frente R4, 26/09)

Pedidos do dono: "na referência da capa, ele fica puxando praticamente tudo
para a segunda lâmina; tem elementos que são só da capa"; "os outros cards são
muito simples; legal ter uma caixa dentro às vezes, ou algo ligado a algo;
não com camada, sempre no gerador, sem repetir e sem ficar genérico".

**Identidade da série x só da capa** (`estudio-arte/serie-da-capa.ts`). O
molde da referência da capa (já lido e guardado) é separado em:

- identidade da série (todas as lâminas seguem): fundo e textura, paleta na
  função, tipografia e hierarquia, grafismos pequenos que se repetem,
  alinhamento e margens, lugar da logo, tratamento de foto;
- só da capa (não vai para as lâminas 2+): título gigante (letra de 6% da
  altura ou mais), número gigante, palavra decorativa de fundo, chamada da
  capa, pessoa ou produto como foto herói, e elementos com nome de gancho
  (selo, etiqueta, sticker, seta, arraste, oferta, preço, balão) ou que
  emolduram o assunto.

Pelo papel do bloco e por regras claras, em código. O que fica ambíguo (texto
pequeno de canto, forma média sem nome claro, cena de fundo) vai a um Choice
do Jev por item ("identidade da série" ou "só da capa"), todos numa chamada,
guardada em `<cliente>/estudio/leituras/serie-<ref>.json` (assinatura do
molde: molde relido separa de novo). Sem Jev: a regra de tamanho (12% do
quadro ou mais fica só na capa) e nada é guardado. Uma vez por referência;
com duas lâminas em paralelo na primeira geração, até duas chamadas curtas.

Quando vale (em `gerarCard`):

- **Caso A**: lâmina 2+ que herdaria a referência do CONJUNTO, sem referência
  própria, sem foto nem elemento, sem quadro de sequência de prancha, fora do
  contínuo e do anúncio. Se a referência tem algo só da capa, ela sai do
  replicar desta lâmina e vai anexada como guia da identidade
  (`ROTULO_DA_REFERENCIA_NA_SERIE`); a lâmina é gerada como lâmina de
  conteúdo (prompt da direção), na qualidade alta (o mesmo custo de quando
  replicava; a tela já mostrava esse preço). Sem nada só da capa: replica como
  hoje. A versão guarda `serie_da_capa` (origem, referência, o que ficou em
  cada lado, e se o Jev respondeu).
- **Caso B**: lâmina 2+ que segue a capa gerada. Se a capa veio de uma
  referência (modo replicar) com o molde guardado, a lista é a dessa
  referência (sem leitura nova).

No prompt do post (o anúncio segue com `blocoDaSerie`, como está):
`blocoDaIdentidadeDaSerie` (o que herdar e o que não repetir, no lugar do
"repita tudo, não crie elementos que a capa não tem") e, quando há molde,
`blocoDaSerieDaReferencia` com as listas específicas ("Herde: ..." e "Não
repita da capa: ..."), cores sempre as da marca na mesma função e o texto pela
trava da marca. A legenda da capa anexada perdeu "a mesma protagonista,
cenário e luz": a pessoa ou o produto da capa só entra se a direção da lâmina
pedir, menor e a serviço do conteúdo.

**Miolo rico** (`estudio-arte/miolo-rico.ts`, ligado por
`blocoDoMioloDesenhado`). Nada é colado por código: o prompt descreve um
componente de lâmina que o gerador desenha junto com a arte. Tipo do conteúdo
em código (comparação, passos, lista, número, pergunta, citação, dica,
afirmação) e o componente:

| Tipo | Componentes (na ordem) |
| --- | --- |
| lista | checklist, cartões empilhados, chips, ícones de linha |
| comparação | colunas de comparação, cartões lado a lado |
| passos | linha do tempo, caixas conectadas |
| número | número em cartão, mini-gráfico |
| pergunta | balão de pergunta, cartão em destaque |
| citação | citação em destaque, cartão em destaque |
| dica | caixa de dica, cartão em destaque |
| afirmação | cartão em destaque, caixas conectadas, ícones de linha, chips |

O plano é feito sobre a direção inteira, na ordem (determinístico: lâminas em
paralelo concordam): nenhuma lâmina repete o componente da anterior e, na
série, um componente só volta quando os do tipo e os gerais acabaram. Refazer
troca o componente (a versão guarda `miolo_desenhado`) sem cair no das
vizinhas. O arranjo acompanha a zona do texto da direção. Cena fixa (foto
real ou contínuo): a versão leve, só gráfica, sem caixa atrás do texto. Regras
em toda lâmina: só as cores da paleta na função, mesma tipografia e margens,
sombra curta sem 3D, e só o texto exato (onde faltar rótulo, ícone de linha).

**O que não muda**: a capa; a lâmina com referência própria (qualquer nível);
referência de prancha com quadro de sequência; referência sem nada só da
capa; o anúncio (Mesa Ads). Fixtures `replicar-identica-hoje.json` e
`lamina-normal-hoje.json` iguais; só mudaram duas linhas de teste que fixavam a
chamada antiga do bloco da série no servidor.

## Onde está

| Peça | Arquivo |
| --- | --- |
| Leitura, Jev, cena e bloco | `supabase/functions/estudio-arte/referencia-adapta-copy.ts` |
| Rosto (normalização, vagas, bloco) | `supabase/functions/estudio-arte/rosto-na-geracao.ts` |
| Ligação, `configurar` e ação `rostos` | `supabase/functions/estudio-arte/index.ts` |
| Tela | `src/components/mesa/EstudioAdaptarConteudo.tsx`, `EstudioRostoDaReferencia.tsx` (em `ReferenciasDoEstudio.tsx`) |
| Rosto v2 (pastas, clones, pose, normal, conferência) | `rosto-na-geracao.ts`; ações `rostos_fotos`, `rostos_marcar`, `conferir_rosto` em `index.ts` |
| Tela do rosto v2 | `src/components/mesa/EstudioEscolherFotoDoRosto.tsx`, `EstudioAvisoDoRosto.tsx` (em `EstudioBaseDaLamina`) |
| Testes | `src/test/referencia-adapta-copy.test.ts`, `src/test/referencia-rosto.test.ts`, `src/test/referencia-rosto-v2.test.tsx` |
| Jogada, decorativo e cor (puro) | `supabase/functions/_shared/jogada-do-texto.ts` (ligado em `promptDoReplicar` e `promptDaLamina`) |
| Termo do Jev, miolo enxuto e desenhado | `supabase/functions/estudio-arte/composicao-dinamica.ts` |
| Testes da composição dinâmica | `src/test/estudio-composicao-dinamica.test.ts` |
| Identidade da série x só da capa (Jev guardado) | `supabase/functions/estudio-arte/serie-da-capa.ts` |
| Miolo rico (componentes, tipo, rotação) | `supabase/functions/estudio-arte/miolo-rico.ts` (via `blocoDoMioloDesenhado`) |
| Testes da série e do miolo | `src/test/estudio-serie-e-miolo.test.ts` |
| Registro | `_shared/motores.ts` (`referencia_adapta_copy`, `rosto_na_referencia`, `rosto_v2`, `composicao_dinamica`, `serie_e_miolo`) |
