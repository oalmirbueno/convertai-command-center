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

Kit sem fonte: MUDOU na frente T2 (26/09, dono: "não inventar"). A geração
é recusada (409 `sem_tipografia`) e o Estúdio bloqueia com "Defina a
tipografia do cliente" (Sugerir da biblioteca ou Definir no Contexto). A
letra da referência nunca entra. A tela da referência mostra "Cliente sem
fonte no kit: a arte não é gerada." com o link para o Contexto. Detalhes na
seção Tipografia, abaixo.

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

## Tipografia (frente T2, 26/09)

Pedido do dono: "tem que seguir a tipografia correta de cada cliente, e cada
cliente sem misturar, e não inventar, e seguir a consistência das fontes no
carrossel."

**Diagnóstico (o que havia antes).**

- A fonte chegava ao gerador quase só pelo NOME no texto (`marca.fontes` no
  `promptDaLamina` e no `promptDoReplicar`). Ia uma amostra só, a do título,
  com teto 1, e o prompt dizia "se houver amostra anexada" sem citar o número
  da imagem. A fonte do texto nunca tinha amostra anexada.
- Todas as 24 fontes gravadas (11 clientes; o Rodrigo tem o par duplicado) vêm da biblioteca e apontam para
  a amostra genérica da biblioteca (`biblioteca/fontes/<família>/amostra.png`),
  não para uma prancha no peso usado.
- Marca: o servidor já resolvia a marca do trabalho (`fontesDaMarca`), mas a
  tela não: o Contexto, a biblioteca de fontes e o aviso do Estúdio liam todas
  as fontes do cliente. Escolher fonte com a CME aberta trocava as do cliente
  (Acerbi), e `fontes_da_biblioteca` contava e gravava sempre no cliente. A
  CME não tem fonte própria e usa as do cliente (Abril Fatface e Lato), pela
  regra da frente G.
- Cache: nenhum cache de fonte no servidor (a lista de marcas guarda 30 s por
  cliente); na tela, a chave era por cliente. Nada vazava entre clientes; a
  amostra da biblioteca é a mesma família para todos.
- Kit sem fonte: o `promptDaLamina` mandava seguir "a tipografia das artes da
  marca anexadas" e o `promptDoReplicar`, "a da referência"; a tipografia
  citada em documento entrava como reserva. Ou seja, a letra era inventada.
- Lâminas com fontes diferentes: (1) "Gerar todas" roda 2 lâminas ao mesmo
  tempo na fila (3 no caminho antigo), então a lâmina 2 nascia junto com a
  capa, sem a capa como guia; (2) no replicar Idêntica e Próxima a capa não
  vai anexada e cada lâmina seguia o desenho de letra da própria referência
  (peso, caixa e largura mudavam); (3) o peso do título era "extra negrito ou
  negrito"; (4) sem amostra do texto, o apoio variava.

**O que mudou.**

1. Amostra da tipografia (`src/lib/mesa/amostraDaFonte.ts`): o navegador
   desenha, uma vez por fonte, uma prancha PNG de 1600 x 900 (fundo neutro,
   nome pequeno, "AaBbCc 123" e uma frase com acentos em caixa alta e baixa)
   a partir do ARQUIVO da fonte (do cliente ou o da biblioteca gravado no kit)
   ou, sem arquivo, do Google Fonts pelo nome (API CSS2 por link; a CSP já
   libera, nada mudou nela). Título em 700 e texto em 400 no Google; o arquivo
   já é o próprio peso. Vai para `mesa/<cliente>/marca/<marca da fonte, se não
   for a principal>/tipografia-<papel>-<id>.png` e fica em
   `cliente_fontes.amostra_path` (sem SQL). Feita sozinha ao enviar a fonte,
   ao escolher na biblioteca, depois do "Sugerir automaticamente" e ao mudar
   o papel; botão "Gerar amostra da tipografia" no Contexto, em Fontes. A
   amostra antiga do cliente sai do Storage; a da biblioteca, nunca.
2. Na geração (`estudio-arte/tipografia-do-cliente.ts`, ligado no
   `gerarCard`, que também serve a Mesa Ads): as amostras do título (anexo
   `fonte`) e do texto (`fonte_texto`, só com família diferente) entram com o
   papel "TIPOGRAFIA DO CLIENTE: use exatamente estas letras (desenho, peso,
   proporção) no título/texto; não use outra fonte". Prioridade: lâmina (foto,
   referência da equipe, logo, capa, sequência) > rosto > TIPOGRAFIA >
   referência automática > estilo e template. A referência automática cede ao
   rosto primeiro; depois a amostra do texto e a do título (`tipografiaQueCede`).
   Só amostra da pasta do cliente ou da biblioteca. O bloco TIPOGRAFIA DO
   CLIENTE entra nos dois prompts (depois da campanha no normal, depois da
   continuidade no replicar) e fecha com "não use outra fonte: nem a da
   referência, nem uma parecida".
3. Série: família, peso e caixa fixos por papel (título, apoio, CTA). A capa
   (ou a primeira lâmina gerada) é a âncora: a versão guarda `tipografia`
   (chave cliente, marca e famílias; peso e caixa do título). As lâminas 2+
   repetem peso e caixa da âncora, mesmo com referência própria, e citam a
   imagem da capa quando ela vai anexada ("mesma fonte, peso e caixa do título
   da capa (imagem N)"); sem a capa anexada (replicar Idêntica), a âncora vai
   em texto. Âncora de outra chave (marca ou kit trocado) não vale. A lâmina
   2+ pedida junto com a capa espera por ela: `gerar_card` devolve 409
   `capa_pendente` enquanto a capa está na fila sem versão, e a fila espera 15 s
   e tenta de novo (teto de passos de sempre); no caminho sem fila, a tela gera
   a capa sozinha primeiro.
4. Não inventar: kit sem fonte na marca do trabalho, 409 `sem_tipografia`
   antes de qualquer custo. O Estúdio mostra "Defina a tipografia do cliente"
   (`EstudioSemTipografia.tsx`), desliga os botões de gerar e oferece
   "Sugerir da biblioteca" (`fontes_da_biblioteca` com `previa`: o Jev escolhe
   o par, nada é gravado; a equipe confirma e a ação grava com `gravar`, na
   marca do pedido, com a amostra e o Desfazer) e "Definir no Contexto". Kit
   com uma fonte só: título e texto saem dela (a citada em documento não entra).
5. Sem misturar: a tela usa a mesma regra do servidor
   (`src/lib/mesa/tipografiaDoCliente.ts`, chave do cache com cliente e marca).
   Com a CME aberta, o Contexto mostra e grava as fontes da CME (`marca_id`),
   a biblioteca troca só as dela e avisa quando ela ainda usa as do cliente.

**Fixtures.** Nenhum mudou: com título e texto no kit, a lista de fontes do
prompt é a mesma, e o bloco novo entra fora do `promptDaLamina` e do
`promptDoReplicar`. O caso "anúncio 9:16" sem fontes do
`replicar-identica-hoje.json` continua como texto do compositor, mas não chega
mais ao gerador (a geração é recusada antes). Testes em
`src/test/tipografia-do-cliente.test.tsx`.

## Texto da lâmina (frente R5, 26/09)

Pedido do dono: "quando gerar a arte, ele já refinar e encurtar o conteúdo,
senão fica textão; ou divide em partes e não deixa só em um lugar; ajuda na
continuação e dinâmica do carrossel, pra não ficar sempre fixo de um lado, na
mesma coisa."

**1. Enxugar na geração** (`estudio-arte/texto-da-lamina.ts`, gancho no
`gerarCard` logo depois da conferência da tipografia). A preparação (R3) só
enxuga as lâminas 2+ de uma vez. Agora cada `gerar_card` (Gerar, Refazer, a
lâmina avulsa e a fila) confere o texto contra o limite do papel, com os
números de sempre (`_shared/menos-texto-nas-laminas.ts`): capa até 14
palavras, miolo pela regra da R3 (total 37, headline 10, cada apoio 25),
fechamento 28, estático 40.

- Acima do limite: UMA chamada curta ao redator (modelo do diretor de arte),
  com os limites do papel, a lâmina anterior e a seguinte (para a sequência) e
  os intocáveis (número, preço, nome próprio, sigla, endereço). O CTA e o selo
  nunca vão para o redator: voltam como eram.
- Em código, sem nova chamada: a resposta sem headline, maior que o original
  ou sem algum intocável cai no corte do original no fim de frase, com aviso;
  a resposta boa que ainda passa é cortada no fim de frase, com aviso. Redator
  fora do ar: corte com aviso (não guardado). Erro do motor (saldo, cota,
  chave): a geração para com o aviso de sempre, sem cortar o texto.
- Guardado em `<cliente>/estudio/leituras/texto-<hash>.json` (papel, limite e
  texto): refazer ou preparar de novo com o mesmo texto não paga de novo.
- O texto enxuto vai para a direção (a equipe vê na tela) com
  `texto_na_geracao` (original, blocos de antes, origem, aviso, palavras antes
  e depois); o custo entra no trabalho e na versão (`custoExtraUsd`); a versão
  guarda o resumo em `texto_na_geracao`.
- Não muda: texto dentro do limite (nada é chamado), capa que já tem versão,
  anúncio (Mesa Ads) e o texto que a equipe mandou manter ("Voltar ao
  original" grava `manter`; editar o texto depois volta a valer a regra).
- Tela: o botão Gerar (e Gerar todas, Refazer, Gerar de novo) soma a chamada
  curta quando a lâmina vai precisar enxugar (mesma regra,
  `precisaEnxugarNaGeracao`). Na ferramenta Lâmina, junto do Refinar texto
  (`EstudioTextoDaLamina.tsx`): "Texto longo para a arte: ao gerar, ele é
  enxugado"; depois, "Enxugado ao gerar: de N para M palavras" com "Voltar ao
  original".

**2. Dividir em partes dentro da lâmina.** No miolo (lâmina 2 à penúltima),
fora do replicar e do anúncio, o texto com mais de uma ideia vira 2 a 4
partes curtas, em código (`dividirEmPartes`), nesta ordem: linhas com
marcador ou várias linhas curtas; comparação (antes e depois, errado e certo,
mito e verdade, vs); passos (primeiro, depois, em seguida, por fim);
enumeração ("A, B e C", com abertura "Três sinais:"); várias frases; ponto e
vírgula; frase longa com dois argumentos (corta na conjunção mais perto do
meio). Cada parte é um trecho contínuo do texto exato: a conferência continua
batendo. Texto que cabe num bloco não divide. O bloco `TEXTO EM PARTES` entra
logo depois do bloco do miolo desenhado (R4): título no lugar do título, cada
parte no item do componente (checklist, cartão, coluna, passo da linha do
tempo, caixa, etiqueta, linha com ícone), distribuídas pela forma e pela zona
(lado a lado na comparação, ligadas por um fio nos passos, empilhadas na
coluna, em fileira ou grade no topo e na base), apoio pequeno fechando; nunca
um parágrafo único num canto. Cena fixa: uma linha por parte, sem caixa. A
versão guarda `texto_em_partes` (forma e quantidade).

**3. Posição que varia na série** (`estudio-arte/posicao-na-serie.ts`,
gancho antes da zona do texto no `gerarCard`). No modo normal (sem
referência, foto, recorte, elemento nem contínuo; fora do anúncio), a zona do
texto roda na série: o plano é feito sobre a direção inteira, em código;
nenhuma lâmina repete a zona nem o eixo da anterior (esquerda, direita, topo,
base, centro, dividido) nem os da seguinte quando ela está fixa; o mesmo lado
não aparece 3 vezes seguidas; o eixo e o lado menos usados vêm primeiro; a
zona da direção fica quando já serve. O lado do assunto sai da descrição da
imagem e do ponto focal ("metade direita", "dois terços de cima"; o que fala
do texto não conta): o texto fica do outro lado, e para trocar de lado a
descrição é espelhada junto (direita vira esquerda, cima vira baixo).
Descrição ambígua: a zona fica. "Dividido" (só sem lado do assunto): título no
alto e o apoio ou as partes na faixa de baixo (bloco `ARRANJO DIVIDIDO`; a
faixa de baixo entra na área da correção automática). A decisão é gravada na
direção (`posicao_na_serie`, com a zona de antes), então a correção, a tela e
as lâminas geradas em paralelo usam a mesma; a lâmina decidida fica. Ficam
como estão: a capa, o fechamento, a lâmina com foto, elemento ou referência
própria, o contínuo, o anúncio e o carrossel de 2. Com referência vale a
regra da R3 por nível (Idêntica segue a referência). A continuidade vem da
identidade da série (R4) e da tipografia (T2). O diretor também ouve isso: a
linha da zona do texto nas instruções da direção deixou de pedir "o mesmo
eixo de alinhamento no carrossel".

**4. Dividir em 2 lâminas (com confirmação).** A lâmina 2+ (não a capa nem
o estático) que passa do limite e tem mais de uma ideia recebe a sugestão
(`sugestaoDeDividirEmDuas`): a primeira fica com o título e a primeira
metade (por frases ou partes, equilibrada), a nova com o resto; no fechamento
o CTA vai para a nova (que vira a última). A preparação devolve
`dividir_em_duas` e o aviso diz "Lâmina N: dá para dividir em 2 (ferramenta
Lâmina)". Na ferramenta Lâmina, "Dividir em 2 lâminas" mostra a prévia das
duas e só divide ao confirmar (ação `texto_da_lamina` com `operacao:
dividir` e `confirmado: true`, sem custo, com auditLog): a lâmina seguinte
nasce com a segunda parte e o layout padrão, e as lâminas depois andam uma
posição com as versões e as arquivadas. O aviso traz "Desfazer" (`juntar`),
que vale enquanto a lâmina nova não tem arte e os textos são os da divisão.
Travas: trabalho entregue, anúncio, contínuo, 20 lâminas e geração em
andamento na fila.

**O que não mudou.** `promptDaLamina` e `promptDoReplicar` são os mesmos: os
fixtures `lamina-normal-hoje.json`, `replicar-identica-hoje.json` e
`replicar-adaptado.json` ficaram iguais (os blocos novos entram fora deles, no
`gerarCard`, antes da variação). Nenhuma camada: tudo é pedido ao gerador.
Testes em `src/test/texto-da-lamina.test.ts`.

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
| Tipografia na geração (kit, amostra com papel, âncora, recusa) | `supabase/functions/estudio-arte/tipografia-do-cliente.ts`; espera da capa em `fila-de-geracao.ts` |
| Amostra no navegador e regra da marca na tela | `src/lib/mesa/amostraDaFonte.ts`, `src/lib/mesa/tipografiaDoCliente.ts` |
| Bloqueio e Sugerir da biblioteca | `src/components/mesa/EstudioSemTipografia.tsx`; `agente-contexto` (`fontes_da_biblioteca` com `previa` e `gravar`) |
| Testes da tipografia | `src/test/tipografia-do-cliente.test.tsx` |
| Enxugar na geração, texto em partes, dividir em 2 (puro) | `supabase/functions/estudio-arte/texto-da-lamina.ts` |
| Posição que varia na série (plano, espelho, dividido) | `supabase/functions/estudio-arte/posicao-na-serie.ts` |
| Ganchos e ação `texto_da_lamina` | `supabase/functions/estudio-arte/index.ts` (`textoDaLaminaNaGeracao`, `posicaoDaLaminaNaSerie`, `textoDaLamina`, `areasDeDesenho`) |
| Tela do texto da lâmina e custo no Gerar | `src/components/mesa/EstudioTextoDaLamina.tsx`; `partesGerarDas` em `AbaEstudio.tsx` |
| Testes do texto da lâmina | `src/test/texto-da-lamina.test.ts` (registro `texto_da_lamina` em `_shared/motores.ts`) |
