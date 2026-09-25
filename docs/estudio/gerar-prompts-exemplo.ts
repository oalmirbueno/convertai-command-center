/**
 * Gera os prompts de exemplo do Estúdio da Mesa (docs/estudio/PROMPTS-EXEMPLO.md),
 * com os dados reais da AcelerIQ (kit, fontes, direção do trabalho 615faaf6 de
 * 26/09) e um molde de exemplo (a referência "VALE A PENA?" medida à mão).
 *
 *   deno run --allow-write=docs/estudio docs/estudio/gerar-prompts-exemplo.ts
 *
 * O compositor (promptDaLamina, promptDoReplicar, blocoDaSerie, blocos da logo)
 * é importado do código de verdade. O que só existe dentro de
 * estudio-arte/index.ts (regras finais, aberturas "EDITE a imagem 1" dos modos
 * de edição e as legendas dos anexos) está copiado aqui do jeito que a função
 * monta em 27/09; se mudar lá, mude aqui.
 */

import {
  blocoDaSerie,
  descricaoDaLogo,
  legendaDaLogo,
  type CardDirecao,
  type LeituraDaLogo,
  type LogoMedida,
  type MarcaParaDirecao,
  type MoldeDaReferencia,
  promptDaLamina,
  promptDoReplicar,
} from "../../supabase/functions/_shared/direcao-arte.ts";

const MARCA: MarcaParaDirecao = {
  nomeCliente: "AcelerIQ",
  paleta: [
    { hex: "#00D52B", nome: "Verde vibrante", papel: "primária e destaque" },
    { hex: "#111111", nome: "Preto carvão", papel: "secundária e fundo" },
    { hex: "#F7F7F7", nome: "Branco suave", papel: "fundo e texto sobre" },
    { hex: "#E7E8E9", nome: "Cinza claro", papel: "fundo" },
    { hex: "#6B6F73", nome: "Cinza médio", papel: "texto secundário" },
  ],
  estilo: "As artes usam fotografias ou cenas fotorrealistas de contexto profissional, como escritório, celular, notebook e materiais de trabalho. A iluminação alterna entre fundos escuros com luz de recorte e cenas claras com luz suave, mantendo contraste alto para a mensagem. (resumido para o exemplo)",
  regras: "Faça: preserve a combinação de verde, preto e branco; mantenha alto contraste e hierarquia clara. Não faça: invente resultados, depoimentos, urgência ou escassez. (resumido para o exemplo)",
  fontes: [{ nome: "Citrica", papel: "titulo" }, { nome: "Roboto", papel: "texto" }],
  tipografiaCitada: null,
  temLogo: true,
};

// Logo do kit (logo-1790364144125-2048.png): "Aceler" branco, "iq" verde, símbolo verde e branco.
const LOGO: LogoMedida = { tom: "#00D52B", clara: true, aspecto: 3.4, cores: ["#FFFFFF", "#00D52B"] };
const LEITURA_DA_LOGO: LeituraDaLogo = {
  texto: "Aceleriq",
  partes: [{ texto: "Aceler", cor: "branco #FFFFFF" }, { texto: "iq", cor: "verde #00D52B" }],
  simbolo: "seta angular em traços geométricos verdes e brancos, à esquerda das letras",
};
const DESCRICAO_DA_LOGO = descricaoDaLogo({ nome: MARCA.nomeCliente, leitura: LEITURA_DA_LOGO, medida: LOGO });
const LEGENDA_LOGO = legendaDaLogo({ clara: true, texto: LEITURA_DA_LOGO.texto });

const CONCEITO = "Transformar a proposta em uma página que deixa de ser uma lista de entregas e passa a mostrar o raciocínio por trás delas.";
const FIO = "Mesmo ensaio fotorrealista em uma mesa de trabalho contemporânea: proposta impressa, caderno e notebook sem marcas; mãos de uma pessoa adulta em roupa neutra, sem mostrar rosto. Luz natural lateral suave, alternando fundos claros e carvão, com verde #00D52B só nos destaques.";

const CAPA: CardDirecao = {
  ordem: 1,
  funcao: "capa",
  texto_exato: "Seu orçamento parece\numa lista de tarefas?",
  blocos: [{ papel: "headline", texto: "Seu orçamento parece\numa lista de tarefas?" }],
  layout: {
    zona_texto: "topo-esquerda",
    alinhamento: "esquerda",
    cor_fundo: "#F7F7F7",
    cor_texto: "#111111",
    cor_destaque: "#00D52B",
    imagem: "Vista oblíqua próxima de uma proposta impressa ocupando a metade inferior da mesa; uma mão segura a página com linhas de tarefas sem texto legível. Um fio verde sai da lista e segue em direção à borda direita",
    ponto_focal: "Headline grande no alto à esquerda; a folha inclinada abaixo reforça a ideia de lista",
    fundo: "Mesa clara com área uniforme no topo para o título",
    tratamento: "Foto integrada com perspectiva diagonal, recorte próximo e fio verde conectando a lista à saída pela direita",
  },
  composicao: "",
  ilustracao: "",
  prompt_imagem: "",
};
const LAMINA_2: CardDirecao = {
  ordem: 2,
  funcao: "conteudo",
  texto_exato: "Entregas sem objetivo\nA proposta enumera entregas, mas não conecta cada uma ao objetivo.",
  blocos: [
    { papel: "headline", texto: "Entregas sem objetivo" },
    { papel: "apoio", texto: "A proposta enumera entregas, mas não conecta cada uma ao objetivo." },
  ],
  layout: {
    zona_texto: "centro-esquerda",
    alinhamento: "esquerda",
    cor_fundo: "#111111",
    cor_texto: "#F7F7F7",
    cor_destaque: "#00D52B",
    imagem: "Close de uma página de proposta com linhas de tarefas desconectadas; mão aponta para a lista",
    ponto_focal: "A lista impressa, vista de perto, com headline em área escura uniforme à esquerda",
    fundo: "Campo carvão #111111 na metade esquerda para o texto; mesa clara e documento à direita",
    tratamento: "Contraste por planos: painel escuro integrado ao enquadramento, documento nítido em primeiro plano",
  },
  composicao: "",
  ilustracao: "",
  prompt_imagem: "",
};
const FINAL: CardDirecao = {
  ordem: 4,
  funcao: "cta",
  texto_exato: "Feche com o próximo passo\nInclua etapas, dependências e próximo passo para aprovação.\nSalve para revisar sua próxima proposta.",
  blocos: [
    { papel: "headline", texto: "Feche com o próximo passo" },
    { papel: "apoio", texto: "Inclua etapas, dependências e próximo passo para aprovação." },
    { papel: "cta", texto: "Salve para revisar sua próxima proposta." },
  ],
  layout: { ...LAMINA_2.layout!, zona_texto: "base-esquerda", imagem: "Proposta organizada em páginas sobre a mesma mesa; uma mão aponta para a última etapa" },
  composicao: "",
  ilustracao: "",
  prompt_imagem: "",
};

// Molde da referência 1 ("VALE A PENA?"), como o leitor devolve (medido à mão para o exemplo).
const MOLDE_1: MoldeDaReferencia = {
  versao: 1,
  proporcao: "4:5",
  fundo: "cor lisa clara, quase branca, com leve textura de papel",
  cor_do_fundo: "#F2F2EE",
  grade: "Título enorme ocupa a faixa de cima de borda a borda; pessoa centralizada da metade para baixo; textos pequenos nos quatro cantos; celulares espalhados em volta da pessoa.",
  assunto: { tipo: "pessoa", descricao: "pessoa jovem olhando para a câmera, meio corpo", enquadramento: "plano médio frontal, cortado pela base", x0: 24, y0: 30, x1: 76, y1: 100 },
  blocos: [
    { papel: "titulo", x0: 6, y0: 6, x1: 94, y1: 27, altura_da_letra: 9.5, linhas: 2, caixa_alta: true, familia: "sem serifa", largura_da_letra: "condensada", peso: "black", cor: "#1E4FD8", alinhamento: "centro" },
    { papel: "rotulo", x0: 5, y0: 2, x1: 30, y1: 4.5, altura_da_letra: 1.4, linhas: 1, caixa_alta: true, familia: "sem serifa", largura_da_letra: "normal", peso: "medio", cor: "#111111", alinhamento: "esquerda" },
    { papel: "rotulo", x0: 70, y0: 2, x1: 95, y1: 4.5, altura_da_letra: 1.4, linhas: 1, caixa_alta: true, familia: "sem serifa", largura_da_letra: "normal", peso: "medio", cor: "#111111", alinhamento: "direita" },
    { papel: "texto", x0: 5, y0: 88, x1: 32, y1: 96, altura_da_letra: 1.6, linhas: 3, caixa_alta: false, familia: "sem serifa", largura_da_letra: "normal", peso: "regular", cor: "#111111", alinhamento: "esquerda" },
    { papel: "perfil", x0: 70, y0: 92, x1: 95, y1: 95.5, altura_da_letra: 1.5, linhas: 1, caixa_alta: false, familia: "sem serifa", largura_da_letra: "normal", peso: "medio", cor: "#111111", alinhamento: "direita" },
  ],
  elementos: [
    { descricao: "celulares com a tela virada para a câmera, inclinados em volta da pessoa", cor: "#1E4FD8", x0: 4, y0: 35, x1: 96, y1: 85 },
    { descricao: "fio fino horizontal separando o título da foto", cor: "#111111", x0: 6, y0: 29, x1: 94, y1: 29.5 },
  ],
  tratamento: "Luz de estúdio suave e frontal, cores chapadas, contraste alto entre o título e o fundo; acabamento de pôster editorial.",
};

// ----------------------------------------------------- partes copiadas do index.ts
const REGRA_TEXTO_NA_ARTE = "Arte final completa numa imagem só. Todo o texto é desenhado pela própria arte, integrado à composição, nunca uma caixa de texto solta por cima da imagem.";
function regrasDeRender(texto: string, anexos: string[], logo: "gerar" | false, infinito = false): string {
  return [
    "REGRAS FINAIS (valem sobre tudo acima)",
    `- ${REGRA_TEXTO_NA_ARTE}`,
    `- Escreva exatamente este texto, com a mesma grafia e acentuação, e nenhum outro texto: "${texto}"`,
    logo === "gerar"
      ? "- Logo: a oficial anexada, idêntica ao anexo, no tamanho do bloco LOGO (nunca pequenininha), sem caixa atrás. Uma logo só."
      : "- Sem logo nesta lâmina: não desenhe logo, símbolo nem marca.",
    infinito ? "- Carrossel infinito: o que chega à borda continua na lâmina vizinha com a mesma posição, escala, perspectiva e luz." : "",
    anexos.length ? `- Imagens anexadas, na ordem (use cada uma só para o que a legenda dela diz; nada delas entra na arte além disso): ${anexos.join("; ")}.` : "",
  ].filter(Boolean).join("\n");
}
const SEM_CAIXA_ATRAS_DO_TEXTO = "Escreva o texto e a logo DIRETAMENTE sobre a imagem, integrados à cena: sem caixa, cartão, painel, faixa, retângulo, moldura, véu, desfoque ou área de cor atrás das letras. Ignore qualquer indicação de fundo liso ou de área de cor para o texto: aqui o fundo é a própria foto. O contraste vem da cor e do peso das letras (escolha na paleta a cor que mais contrasta com aquela parte da foto) e, se preciso, de uma sombra suave nas próprias letras. Não escureça a foto.";
const NAO_REENQUADRAR = "Não reenquadre a imagem 1: mesmo corte, mesmo zoom, mesma posição e tamanho de cada pessoa e objeto, nada aproximado, afastado, girado ou espelhado. A saída tem exatamente o mesmo enquadramento da imagem 1.";
const FONTE = "amostra da fonte Citrica (titulo): siga o desenho destas letras";
const leg = (lista: string[], desloc = 0) => lista.map((r, i) => `imagem ${i + 1 + desloc}: ${r}`);

type Exemplo = { titulo: string; nota: string; prompt: string };
const exemplos: Exemplo[] = [];
const base = (card: CardDirecao, extra: Parameters<typeof promptDaLamina>[2]) =>
  promptDaLamina(card, MARCA, { conceito: CONCEITO, fioVisual: FIO, logo: LOGO, logoDescricao: DESCRICAO_DA_LOGO, ...extra });

// 1) Normal (capa, sem foto): logo + fonte + 1 arte de referência da marca.
{
  const anexos = leg([LEGENDA_LOGO, FONTE, "arte já publicada da própria marca: siga a mesma identidade (cores, tipografia, tratamento de foto); não copie o layout, o texto nem as pessoas dela"]);
  const p = [base(CAPA, { total: 4, carrosselInfinito: false, levaLogo: true }), regrasDeRender(CAPA.texto_exato, anexos, "gerar")].join("\n\n");
  exemplos.push({ titulo: "Normal: capa de carrossel, sem foto", nota: "Lâmina 1 de 4 do trabalho 615faaf6. Anexos: logo achatada, amostra da fonte, uma arte da marca.", prompt: p });
}
// 2) Série (lâmina 2, sem foto): a capa anexada guia o sistema visual.
{
  const anexos = leg([FONTE, "CAPA desta série (lâmina 1), já aprovada: é o guia do sistema visual; repita o grid, as margens, as linhas, formas e elementos gráficos (mesmo traço, espessura e cor), a tipografia, a paleta, o tratamento e a mesma protagonista, cenário e luz; não copie o texto nem a composição exata dela"]);
  const p = [
    base(LAMINA_2, { total: 4, carrosselInfinito: false, levaLogo: false }),
    blocoDaSerie({ ordem: 2, total: 4, capa: 2 }),
    regrasDeRender(LAMINA_2.texto_exato, anexos, false),
  ].join("\n\n");
  exemplos.push({ titulo: "Série: lâmina 2 de 4 (sem logo)", nota: "A capa vai anexada como guia; o miolo não leva logo.", prompt: p });
}
// 3) Foto real fixa (final com logo): o gerador só escreve texto e logo nas áreas abertas.
{
  const area = { x0: 11, y0: 7, x1: 45, y1: 20 };
  const anexos = leg([LEGENDA_LOGO, FONTE], 1);
  const p = [
    "EDITE a imagem 1 (foto real do cliente). Desenhe SÓ dentro destas áreas: de 7% a 95% da largura e de 47% a 96% da altura; de 9% a 47% da largura e de 5% a 22% da altura. Fora delas a foto fica exatamente como está.",
    NAO_REENQUADRAR,
    SEM_CAIXA_ATRAS_DO_TEXTO,
    base(FINAL, { total: 4, carrosselInfinito: false, levaLogo: true, fotoReal: "foto da equipe na mesa de trabalho, luz natural", areaDaLogo: area }),
    blocoDaSerie({ ordem: 4, total: 4, capa: 4, cenaFixa: true }),
    regrasDeRender(FINAL.texto_exato, anexos, "gerar"),
  ].join("\n\n");
  exemplos.push({ titulo: "Foto real: lâmina final com foto do acervo", nota: "A foto é a imagem 1 (máscara); a área da logo abre junto com a do texto.", prompt: p });
}
// 4) Recorte: pessoa sem fundo posta pelo código.
{
  const card = { ...LAMINA_2, layout: { ...LAMINA_2.layout!, zona_texto: "coluna-esquerda" as const, imagem: "o recorte REAL (pessoa sorrindo segurando a proposta) já posto na imagem 1, de 50% a 100% da largura e de 10% a 100% da altura, com cenário simples em volta, na paleta da marca", ponto_focal: "a pessoa ou o produto recortado, com a headline no espaço livre ao lado ou acima" } };
  const anexos = leg([FONTE], 1);
  const p = [
    "EDITE a imagem 1: ela já tem a pessoa ou o produto REAL recortado, no lugar certo (de 50% a 100% da largura e de 10% a 100% da altura). Ele fica exatamente como está: mesmo rosto, feições, corpo, roupa, cores, tamanho e posição; não redesenhe, não mova, não corte e não cubra. Crie em volta dele a lâmina inteira pela direção abaixo: o fundo ou um cenário simples na paleta da marca, luz coerente com a do recorte, uma sombra de contato suave onde ele pousa, os elementos gráficos, o texto na área indicada.",
    "Sem caixa, moldura, borda, contorno branco, halo ou brilho em volta do recorte; nenhum texto, logo, forma ou elemento por cima dele. A cor lisa da imagem 1 é só o ponto de partida: troque pelo fundo da direção.",
    base(card, { total: 4, carrosselInfinito: false, levaLogo: false }),
    regrasDeRender(card.texto_exato, anexos, false),
  ].join("\n\n");
  exemplos.push({ titulo: "Recorte: pessoa sem fundo na lâmina 2", nota: "O código põe o recorte do lado oposto ao texto e cola o original de volta no fim.", prompt: p });
}
// 5) Contínuo (panorama): a fatia pronta é a imagem 1.
{
  const anexos = leg([LEGENDA_LOGO, FONTE], 1);
  const p = [
    "EDITE a imagem 1: ela é a cena desta lâmina, parte de um panorama que atravessa o carrossel, e já está pronta. Escreva só o texto e a logo por cima, nas áreas indicadas. Mantenha a mesma cena, luz, pessoas e objetos, na mesma posição e escala. Não mude nada nas faixas das bordas esquerda e direita (7% de cada lado): elas emendam com as lâminas vizinhas.",
    NAO_REENQUADRAR,
    SEM_CAIXA_ATRAS_DO_TEXTO,
    base(CAPA, { total: 4, carrosselInfinito: false, levaLogo: true, fotoReal: "fundo panorâmico contínuo do carrossel, já pronto: o texto entra por cima, sem mudar a cena", areaDaLogo: { x0: 11, y0: 88, x1: 45, y1: 92 } }),
    regrasDeRender(CAPA.texto_exato, anexos, "gerar"),
  ].join("\n\n");
  exemplos.push({ titulo: "Contínuo: capa sobre a fatia do panorama", nota: "O código cola só o que mudou nas áreas do texto e da logo sobre a fatia intacta.", prompt: p });
}
// 6) Anúncio (peça única 4:5).
{
  const card = { ...CAPA, texto_exato: "Sua proposta explica o porquê?\nFale com a AcelerIQ", blocos: [{ papel: "headline" as const, texto: "Sua proposta explica o porquê?" }, { papel: "cta" as const, texto: "Fale com a AcelerIQ" }] };
  const anexos = leg([LEGENDA_LOGO, FONTE]);
  const p = [base(card, { total: 1, carrosselInfinito: false, levaLogo: true, anuncio: { formato: "feed_4x5" } }), regrasDeRender(card.texto_exato, anexos, "gerar")].join("\n\n");
  exemplos.push({ titulo: "Anúncio: criativo único feed 4:5", nota: "Mesa Ads; zona segura e regras do criativo da base de anúncios.", prompt: p });
}
// 7) Replicar referência (capa, sem foto do cliente), referência 1 editada + referência 2.
{
  const anexos = leg([
    "REFERÊNCIA 1 escolhida pela equipe: o molde desta lâmina (layout, grade, escala e posição de cada bloco)",
    "REFERÊNCIA 2 escolhida pela equipe: só o acabamento (luz, textura, tratamento de cor e elementos gráficos)",
    LEGENDA_LOGO,
    FONTE,
  ]);
  const r = promptDoReplicar({
    card: FINAL,
    marca: MARCA,
    total: 4,
    referencias: [{ indice: 1, molde: MOLDE_1 }, { indice: 2, molde: null }],
    editando: true,
    fotos: [],
    logo: { leva: true, indice: 3, medida: LOGO, descricao: DESCRICAO_DA_LOGO },
    quadro: { largura: 1080, altura: 1350 },
  });
  const p = [r.prompt, regrasDeRender(r.textoExato, anexos, "gerar")].join("\n\n");
  exemplos.push({ titulo: "Replicar referência: lâmina final com a referência \"VALE A PENA?\" como molde", nota: "Imagem 1 = referência 1 (base a editar), qualidade alta. Nada da cena do diretor entra; o layout vem do molde medido.", prompt: p });
}

const md = [
  "# Prompts de exemplo do Estúdio da Mesa (27/09)",
  "",
  "Gerados por `docs/estudio/gerar-prompts-exemplo.ts` com o código do compositor (`supabase/functions/_shared/direcao-arte.ts`), o kit real da AcelerIQ e a direção do trabalho 615faaf6. O prompt de verdade de cada geração agora fica gravado na versão da lâmina (`prompt_enviado` e `anexos_legendas`).",
  "",
  "## O que mudou em 27/09",
  "",
  "- Replicar referência: prompt próprio. Saiu tudo o que o diretor escreveu para a cena (imagem, ilustração, ponto focal, fundo, tratamento, zona do texto, tamanhos, fio visual, conceito, estilo de cena, série, padrão e proibições que brigavam com a referência). Entrou o molde: a referência lida por visão como especificação (posição e tamanho de cada bloco em %, caixa alta, família, largura e peso da letra, cor por papel, assunto, elementos, fundo), mapeado bloco a bloco para o texto da lâmina. A referência 1 é a imagem 1, a base a editar. Qualidade alta.",
  "- Logo: vai achatada sobre um fundo liso de contraste (cinza-escuro para logo clara), com o texto exato dela e as cores de cada parte escritos no prompt e na legenda. Logo clara em lâmina clara ganha uma parte escura da composição para pousar. Continua desenhada pelo gerador, no tamanho mínimo de antes.",
  "- Demais modos: a IMAGEM E COMPOSIÇÃO voltou a abrir o prompt (ordem de 23 e 24/09); voltaram as técnicas do padrão (rei da lâmina, planos de profundidade, recorte intencional, cores puxadas para a paleta, eixo e agrupamento) e o elemento visual forte e inesperado da capa; as proibições não proíbem mais o texto da logo nem esvaziam a cena.",
  "",
  ...exemplos.flatMap((e) => [`## ${e.titulo}`, "", e.nota, "", `Tamanho: ${e.prompt.length} caracteres.`, "", "```text", e.prompt, "```", ""]),
].join("\n");
await Deno.writeTextFile(new URL("./PROMPTS-EXEMPLO.md", import.meta.url), md);
console.log(exemplos.map((e) => `${e.titulo}: ${e.prompt.length}`).join("\n"));
