/**
 * Selo da campanha (frente SEL, 30/09): regras puras, as mesmas na tela, nas
 * funções e nos testes (sem Deno e sem npm).
 *
 * Pedido do dono (29/09): "ele gera o selo, mas eu quero poder escolher um
 * selo pronto também, pedir para ele melhorar, enviar uma referência, tudo.
 * Ele está gerando muitos selos genéricos."
 *
 * Por que saía genérico (medido no banco em 29/09, 3 campanhas, 7 desenhos):
 * - o desenho ia sem NENHUMA imagem (referencias: []), nem quando a equipe
 *   mandou o selo pronto no pedido (Promoção do Amor, CME: "a única coisa que
 *   você vai usar é o selo promoção do amor, da segunda imagem") e o gerador
 *   redesenhou um adesivo de corações de banco de imagens;
 * - o prompt tinha só o texto, a descrição curta, as cores e uma direção
 *   igual para todo tipo ("poucas formas, no máximo duas cores, sem textura,
 *   sem brilho"), sem as fontes da marca, sem conceito, público, período,
 *   tom nem o que o dono já reprovou: sai o selo "de encarte" de sempre;
 * - a marca vinha só do marca_id da chamada (a tela não mandava): a campanha
 *   da CME era desenhada com o kit da Acerbi (a principal);
 * - sempre o modelo padrão, qualidade média, UMA imagem por vez: a Oferta
 *   Stop foi redesenhada 4 vezes (3 em 3 minutos) até sair algo usável;
 * - o texto não era conferido (saiu "Por R$ 9,90" com "Por" inventado).
 *
 * Aqui mora: os estilos nomeados, a direção completa (campanha, marca,
 * referências com papel, regras do dono), a conferência do texto, a caixa do
 * selo na lâmina (o Estúdio cola o selo pelo código, intacto), as perguntas
 * do Jev (papel da referência e o pedido do agente) e o impacto da troca.
 *
 * Sem lookbehind, propriedade Unicode ou grupo nomeado em regex (Safari 11).
 */

// ------------------------------------------------------------------ estilos

export const ESTILOS_DE_SELO = [
  "carimbo",
  "badge_circular",
  "fita",
  "etiqueta",
  "tipografico",
  "monograma",
  "adesivo",
  "escudo",
  "3d_sutil",
] as const;

export type EstiloDeSelo = (typeof ESTILOS_DE_SELO)[number];
export const ESTILO_AUTOMATICO = "automatico";
export type EscolhaDeEstilo = EstiloDeSelo | typeof ESTILO_AUTOMATICO;

export const DEFINICAO_DO_ESTILO: Record<EstiloDeSelo, { rotulo: string; direcao: string }> = {
  carimbo: {
    rotulo: "Carimbo",
    direcao: "Carimbo: borda dupla (circular ou retangular), texto em arco ou em faixa, tinta chapada de uma cor da marca com falhas leves de impressão, como se tivesse sido carimbado à mão.",
  },
  badge_circular: {
    rotulo: "Badge circular",
    direcao: "Badge circular: disco com o texto correndo em arco pela borda e a palavra principal ou um ícone próprio do tema no centro, contornos limpos, duas cores da marca.",
  },
  fita: {
    rotulo: "Fita",
    direcao: "Fita: faixa com as pontas cortadas em V, levemente curvada, com o texto na faixa; um emblema pequeno do tema pode ficar acima dela.",
  },
  etiqueta: {
    rotulo: "Etiqueta de preço",
    direcao: "Etiqueta (tag): forma de etiqueta com furo e um cordão fino, cantos arredondados, texto forte e curto dentro, cara de vitrine de loja boa, não de encarte.",
  },
  tipografico: {
    rotulo: "Tipográfico",
    direcao: "Tipográfico: só letras, sem moldura. Composição de tipos com contraste de peso e tamanho, a palavra principal em destaque, encaixe entre as palavras, na família de título da marca.",
  },
  monograma: {
    rotulo: "Linha fina",
    direcao: "Linha fina: emblema delicado em traço fino de uma cor só, com muito respiro, elegante e discreto, como uma assinatura do tema.",
  },
  adesivo: {
    rotulo: "Adesivo recortado",
    direcao: "Adesivo recortado (die-cut): silhueta própria do tema com borda branca grossa em volta, leve inclinação, cara de sticker bem impresso.",
  },
  escudo: {
    rotulo: "Escudo",
    direcao: "Escudo moderno: forma de escudo simples e chapada, o texto numa faixa no meio, um símbolo pequeno do tema em cima.",
  },
  "3d_sutil": {
    rotulo: "3D sutil",
    direcao: "3D sutil: volume leve (bisel suave e sombra própria curta), material fosco, luz de estúdio suave. Nada de brilho metálico, cromado ou dourado reluzente.",
  },
};

export function estiloValido(v: unknown): EstiloDeSelo | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (ESTILOS_DE_SELO as readonly string[]).indexOf(s) >= 0 ? (s as EstiloDeSelo) : null;
}

export const rotuloDoEstilo = (v: unknown): string => {
  const e = estiloValido(v);
  return e ? DEFINICAO_DO_ESTILO[e].rotulo : "";
};

/** Estilos que combinam com cada tipo de campanha (as opções automáticas saem diferentes entre si). */
const ESTILOS_DO_TIPO: Record<string, EstiloDeSelo[]> = {
  promocao: ["etiqueta", "adesivo", "tipografico", "badge_circular"],
  lancamento: ["tipografico", "monograma", "3d_sutil", "badge_circular"],
  data_comemorativa: ["fita", "monograma", "adesivo", "carimbo"],
  institucional: ["monograma", "tipografico", "escudo", "carimbo"],
  evento: ["badge_circular", "tipografico", "carimbo", "fita"],
  prova_social: ["escudo", "badge_circular", "carimbo", "monograma"],
  sazonal: ["carimbo", "adesivo", "badge_circular", "tipografico"],
};
const ESTILOS_SEM_TIPO: EstiloDeSelo[] = ["tipografico", "badge_circular", "carimbo", "adesivo"];

/** Variações de composição quando todas as opções são do mesmo estilo. */
export const VARIACOES_DE_COMPOSICAO = [
  "composição compacta, o texto numa linha ou duas, largo e baixo",
  "composição empilhada e centrada, a palavra principal maior",
  "um símbolo próprio do tema integrado às letras (não ao lado delas)",
  "a versão mais ousada: contraste forte de tamanho e uma forma inesperada, ainda legível pequena",
];

export const MAX_OPCOES_DE_SELO = 4;
export const OPCOES_PADRAO_DE_SELO = 3;

/** Quantas opções (1 a 4; padrão 3). */
export function quantidadeDeOpcoes(v: unknown): number {
  const n = Math.round(Number(v));
  if (!isFinite(n) || n < 1) return OPCOES_PADRAO_DE_SELO;
  return Math.min(MAX_OPCOES_DE_SELO, n);
}

/**
 * O estilo e a variação de cada opção. Automático: estilos diferentes que
 * combinam com o tipo da campanha (sem repetir). Estilo escolhido: o mesmo
 * estilo em composições diferentes.
 */
export function planoDasOpcoes(escolha: unknown, tipo: unknown, quantidade: number): Array<{ estilo: EstiloDeSelo; variacao: number }> {
  const n = quantidadeDeOpcoes(quantidade);
  const fixo = estiloValido(escolha);
  const saida: Array<{ estilo: EstiloDeSelo; variacao: number }> = [];
  if (fixo) {
    for (let i = 0; i < n; i++) saida.push({ estilo: fixo, variacao: i % VARIACOES_DE_COMPOSICAO.length });
    return saida;
  }
  const lista = ESTILOS_DO_TIPO[String(tipo || "")] || ESTILOS_SEM_TIPO;
  for (let i = 0; i < n; i++) saida.push({ estilo: lista[i % lista.length], variacao: Math.floor(i / lista.length) % VARIACOES_DE_COMPOSICAO.length });
  return saida;
}

// ------------------------------------------------------------------ texto

/** O texto do selo: o da identidade da campanha; sem ele, o nome. Até 60 caracteres. */
export function textoDoSelo(campanha: { nome?: string | null; identidade?: Record<string, unknown> | null }, pedido?: string | null): string {
  const doPedido = typeof pedido === "string" ? pedido.trim() : "";
  if (doPedido) return doPedido.slice(0, 60);
  const selo = campanha.identidade && typeof campanha.identidade === "object" ? (campanha.identidade as Record<string, unknown>).selo : null;
  const t = selo && typeof selo === "object" ? String((selo as Record<string, unknown>).texto || "").trim() : "";
  return (t || String(campanha.nome || "").trim()).slice(0, 60);
}

/** Avisos do texto (não impedem): preço dentro do selo de promoção, texto longo demais. */
export function avisosDoTexto(texto: string, tipo: unknown): string[] {
  const avisos: string[] = [];
  const palavras = texto.split(/\s+/).filter(Boolean).length;
  if (palavras > 5) avisos.push(`O texto tem ${palavras} palavras: selo lê bem com até 4.`);
  if (tipo === "promocao" && /(r\$\s*\d|\d+\s*%|\d+[,.]\d{2})/i.test(texto)) {
    avisos.push("Preço ou percentual dentro do selo deixa com cara de encarte (a regra da promoção põe o preço na arte, fora do selo).");
  }
  return avisos;
}

/**
 * Palavras para comparar (minúsculas, com acento; pontuação fora). Acento
 * errado continua erro. Sem \p{} (Safari 11): letras latinas com acento pela faixa.
 */
export function palavrasDoSelo(s: string): string[] {
  return String(s || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9à-öø-ÿ]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

export type ConferenciaDoTexto = {
  ok: boolean | null;
  esperado: string;
  lido: string | null;
  faltando: string[];
  sobrando: string[];
  aviso: string | null;
};

/**
 * Confere o texto lido no selo com o pedido (multiconjunto de palavras: a
 * ordem num selo circular varia). Sem leitura: ok null e aviso. É só aviso:
 * nada é refeito sozinho (sem laço de correção).
 */
export function conferirTextoDoSelo(esperado: string, lido: string | null | undefined): ConferenciaDoTexto {
  if (lido == null) {
    return { ok: null, esperado, lido: null, faltando: [], sobrando: [], aviso: "O texto deste selo não foi conferido (a leitura falhou). Confira antes de usar." };
  }
  const restantes = palavrasDoSelo(lido);
  const faltando: string[] = [];
  for (const p of palavrasDoSelo(esperado)) {
    const i = restantes.indexOf(p);
    if (i >= 0) restantes.splice(i, 1);
    else faltando.push(p);
  }
  const ok = faltando.length === 0 && restantes.length === 0;
  const partes: string[] = [];
  if (faltando.length) partes.push(`faltou "${faltando.join(" ")}"`);
  if (restantes.length) partes.push(`escreveu a mais "${restantes.join(" ")}"`);
  return {
    ok,
    esperado,
    lido: String(lido),
    faltando,
    sobrando: restantes,
    aviso: ok ? null : `O gerador errou o texto do selo: ${partes.join(" e ")}. Leu: "${String(lido).slice(0, 80)}".`,
  };
}

// ------------------------------------------------------------------ direção

export const PAPEIS_DA_REFERENCIA = ["estilo", "forma", "cor", "inspiracao"] as const;
export type PapelDaReferencia = (typeof PAPEIS_DA_REFERENCIA)[number];

export const ROTULO_DO_PAPEL_DA_REFERENCIA: Record<PapelDaReferencia, string> = {
  estilo: "Estilo",
  forma: "Forma",
  cor: "Cor",
  inspiracao: "Só inspiração",
};

const USO_DO_PAPEL: Record<PapelDaReferencia, string> = {
  estilo: "referência de ESTILO: siga o acabamento (traço, textura, tipo de letra, tratamento)",
  forma: "referência de FORMA: siga o contorno e a composição (onde fica o texto, proporção)",
  cor: "referência de COR: siga a paleta dela, ajustada às cores da marca",
  inspiracao: "só INSPIRAÇÃO de clima: não copie nada específico dela",
};

export type ReferenciaDoSelo = { caminho: string; papel: PapelDaReferencia; confianca?: number | null; nota?: string | null; descricao?: string | null };

export function papelValido(v: unknown): PapelDaReferencia | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (PAPEIS_DA_REFERENCIA as readonly string[]).indexOf(s) >= 0 ? (s as PapelDaReferencia) : null;
}

/** Lista de referências gravada na campanha, limpa (até 4). */
export function referenciasDoSelo(bruto: unknown): ReferenciaDoSelo[] {
  const lista = Array.isArray(bruto) ? bruto : [];
  const saida: ReferenciaDoSelo[] = [];
  for (const r of lista) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const caminho = typeof o.caminho === "string" ? o.caminho.trim() : "";
    if (!caminho || caminho.indexOf("..") >= 0) continue;
    saida.push({
      caminho,
      papel: papelValido(o.papel) || "inspiracao",
      confianca: typeof o.confianca === "number" && isFinite(o.confianca) ? o.confianca : null,
      nota: typeof o.nota === "string" ? o.nota.slice(0, 300) : null,
      descricao: typeof o.descricao === "string" ? o.descricao.slice(0, 600) : null,
    });
    if (saida.length >= MAX_REFERENCIAS_DO_SELO) break;
  }
  return saida;
}

export const MAX_REFERENCIAS_DO_SELO = 4;

export type CorDoSelo = { nome?: string | null; hex: string; papel?: string | null };
export type FonteDoSelo = { nome: string; papel?: string | null };

export type ContextoDoSelo = {
  texto: string;
  estilo: EstiloDeSelo;
  variacao?: number;
  campanha: {
    nome: string;
    tipo?: string | null;
    tipoRotulo?: string | null;
    direcaoDoTipo?: string | null;
    objetivo?: string | null;
    conceito?: string | null;
    periodo_inicio?: string | null;
    periodo_fim?: string | null;
    tema_visual?: string | null;
    elementos?: string | null;
    tom?: string | null;
    tipografia?: string | null;
    paleta_apoio?: CorDoSelo[];
    selo_descricao?: string | null;
    oferta?: string | null;
    publico?: string | null;
    mensagem_central?: string | null;
  };
  marca: { nome?: string | null; paleta: CorDoSelo[]; fontes: FonteDoSelo[]; estilo?: string | null; tom?: string | null; regras?: string | null };
  /** Referências na ordem das imagens anexadas (a primeira anexada é a imagem `inicio`). */
  referencias: Array<{ papel: PapelDaReferencia; nota?: string | null; descricao?: string | null }>;
  evitar: string[];
  preferir: string[];
  /** Pedido extra da equipe nesta geração ("mais elegante", "com um coração"). */
  pedido?: string | null;
  fundoTransparente: boolean;
  /** Melhorar: a imagem 1 é o selo atual (edição). */
  melhorar?: { pedido: string } | null;
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "outubro de 2026", "de 28/09 a 15/10": o período em palavras para o clima do selo. */
export function periodoEmTexto(inicio?: string | null, fim?: string | null): string {
  const ok = (s?: string | null) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!ok(inicio)) return "";
  const a = String(inicio);
  const b = ok(fim) ? String(fim) : a;
  if (a.slice(0, 7) === b.slice(0, 7)) return `${MESES[Number(a.slice(5, 7)) - 1]} de ${a.slice(0, 4)}`;
  return `de ${a.slice(8, 10)}/${a.slice(5, 7)} a ${b.slice(8, 10)}/${b.slice(5, 7)}`;
}

const cores = (lista: CorDoSelo[]) => lista.filter((c) => c && /^#[0-9a-f]{6}$/i.test(c.hex)).map((c) => `${c.nome ? `${c.nome} ` : ""}${c.hex.toUpperCase()}${c.papel ? ` (${c.papel})` : ""}`).join(", ");

/** O que deixa um selo com cara de banco de imagens (vai sempre no prompt). */
export const SELO_GENERICO = [
  "estrela explodindo (starburst) ou selo serrilhado de encarte",
  "fita ou medalha dourada genérica, brilho metálico, cromado ou reflexo",
  "corações, estrelas ou confetes de clip-art soltos em volta",
  "a palavra OFERTA ou PROMOÇÃO sozinha num círculo vermelho",
  "sombra longa, gradiente arco-íris, contorno duplo grosso sem motivo",
  "letra genérica de sistema (Arial, Impact) no lugar da fonte da marca",
];

/**
 * A direção completa do selo (prompt do gerador). Tudo o que faz o selo ser
 * DESTA campanha e DESTA marca, as referências pelo papel e as regras que o
 * dono já ensinou. Texto exato entre aspas.
 */
export function direcaoDoSelo(ctx: ContextoDoSelo): string {
  const c = ctx.campanha;
  const m = ctx.marca;
  const estilo = DEFINICAO_DO_ESTILO[ctx.estilo];
  const periodo = periodoEmTexto(c.periodo_inicio, c.periodo_fim);
  const fonteTitulo = m.fontes.find((f) => /t[ií]tulo|destaque|display/i.test(String(f.papel || ""))) || m.fontes[0] || null;
  const inicioRefs = ctx.melhorar ? 2 : 1;
  const linhas: string[] = [
    ctx.melhorar
      ? `EDITE a imagem 1: ela é o selo atual da campanha "${c.nome}". Pedido da equipe: ${ctx.melhorar.pedido}. Mude só o que o pedido pede; o resto do selo (texto, cores da marca, forma) fica, a menos que o pedido diga outra coisa.`
      : `SELO (logo do tema) da campanha "${c.nome}"${m.nome ? ` da marca ${m.nome}` : ""}. Um emblema próprio desta campanha, que ninguém confundiria com o selo de outra loja.`,
    `TEXTO EXATO do selo, com a grafia e os acentos certos, e nenhuma outra palavra, número ou símbolo escrito: "${ctx.texto}".`,
    "",
    "A CAMPANHA",
    c.tipoRotulo ? `- Tipo: ${c.tipoRotulo}.` : "",
    c.objetivo ? `- Objetivo: ${c.objetivo}` : "",
    c.conceito ? `- Conceito: ${c.conceito}` : "",
    c.mensagem_central ? `- Mensagem central: ${c.mensagem_central}` : "",
    c.publico ? `- Público: ${c.publico}` : "",
    c.oferta ? `- Oferta (só contexto; não escreva no selo): ${c.oferta}` : "",
    periodo ? `- Período: ${periodo} (use o clima da época, sem escrever a data).` : "",
    c.tema_visual ? `- Tema visual: ${c.tema_visual}` : "",
    c.elementos ? `- Elementos do tema: ${c.elementos}` : "",
    c.tom || m.tom ? `- Tom: ${[c.tom, m.tom].filter(Boolean).join("; ")}` : "",
    c.selo_descricao ? `- Ideia do selo que o estrategista escreveu: ${c.selo_descricao}` : "",
    "",
    "A MARCA (manda nas cores e na letra)",
    cores(m.paleta) ? `- Paleta da marca (dominante): ${cores(m.paleta)}.` : "- A marca não tem paleta cadastrada: use no máximo duas cores sóbrias e diga nada sobre isso.",
    c.paleta_apoio && cores(c.paleta_apoio) ? `- Cores de apoio da campanha (só acento): ${cores(c.paleta_apoio)}.` : "",
    fonteTitulo ? `- Letra: a família "${fonteTitulo.nome}" da marca (ou a mais parecida com ela), no peso de título.` : c.tipografia ? `- Letra: ${c.tipografia}` : "",
    m.estilo ? `- Estilo da marca: ${m.estilo}` : "",
    m.regras ? `- Regras da marca: ${m.regras}` : "",
    "",
    `ESTILO DESTA OPÇÃO: ${estilo.direcao}`,
    typeof ctx.variacao === "number" ? `- Composição: ${VARIACOES_DE_COMPOSICAO[ctx.variacao % VARIACOES_DE_COMPOSICAO.length]}.` : "",
    c.direcaoDoTipo ? `- Pelo tipo da campanha: ${c.direcaoDoTipo}` : "",
    ctx.pedido ? `- Pedido da equipe para esta geração: ${ctx.pedido}` : "",
    ...ctx.referencias.map((r, i) => `- Imagem ${i + inicioRefs}: ${USO_DO_PAPEL[r.papel]}${r.nota ? ` (a equipe disse: ${r.nota})` : ""}. Não copie o texto nem a marca que aparecem nela.`),
    "",
    "NÃO FAÇA (selo genérico):",
    ...SELO_GENERICO.map((s) => `- ${s}`),
    ...ctx.evitar.map((s) => `- ${s} (o dono já pediu)`),
    ctx.preferir.length ? "\nO DONO PREFERE:" : "",
    ...ctx.preferir.map((s) => `- ${s}`),
    "",
    ctx.fundoTransparente
      ? "Fundo transparente. Um único selo centralizado, inteiro, com margem em volta; sem mockup, sem cena, sem sombra no chão, sem outros elementos."
      : "Fundo branco liso e vazio em volta (o fundo será removido). Um único selo centralizado, inteiro, com margem; sem mockup, sem cena, sem sombra no chão, sem outros elementos.",
    "Legível do tamanho de um ícone (o selo entra pequeno no canto das artes).",
  ];
  return linhas.filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== "")).join("\n").trim();
}

// ------------------------------------------------------------------ lugar do selo na lâmina

export type CaixaDoSelo = { x0: number; y0: number; x1: number; y1: number };

/**
 * Onde o Estúdio cola o selo (frações do quadro), no lado oposto ao da logo
 * (a logo fica à esquerda: em cima quando o texto está na base, embaixo nos
 * demais). Texto na base: selo em cima à direita (no carrossel, um pouco
 * abaixo do contador do Instagram). Texto na coluna da direita: em cima à
 * esquerda. Nos demais: embaixo à direita. Lado de 17% da largura.
 */
export function caixaDoSelo(o: { zona?: string | null; serie?: boolean; largura?: number; altura?: number; aspecto?: number | null }): CaixaDoSelo {
  const L = o.largura && o.largura > 0 ? o.largura : 1080;
  const A = o.altura && o.altura > 0 ? o.altura : 1350;
  const mx = 90 / 1080;
  const topo = 100 / 1350 + (o.serie ? 0.05 : 0);
  const base = 1 - 106 / 1350;
  const aspecto = o.aspecto && o.aspecto > 0 ? Math.max(0.5, Math.min(3, o.aspecto)) : 1;
  const largura = Math.min(0.26, 0.17 * Math.sqrt(aspecto));
  const altura = (largura / aspecto) * (L / A);
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const zona = String(o.zona || "");
  if (zona.indexOf("base") === 0) return { x0: r(1 - mx - largura), y0: r(topo), x1: r(1 - mx), y1: r(topo + altura) };
  if (zona === "coluna-direita") return { x0: r(mx), y0: r(topo), x1: r(mx + largura), y1: r(topo + altura) };
  return { x0: r(1 - mx - largura), y0: r(base - altura), x1: r(1 - mx), y1: r(base) };
}

/** Frase para o prompt da lâmina: a área que fica livre para o selo entrar pelo código. */
export function areaLivreParaOSelo(caixa: CaixaDoSelo): string {
  const pct = (n: number) => Math.round(n * 100);
  const lado = caixa.x0 > 0.5 ? "direita" : "esquerda";
  const alto = caixa.y0 < 0.5 ? "em cima" : "embaixo";
  return `SELO DA CAMPANHA: o selo pronto entra depois, colado pelo código, ${alto} à ${lado} (de ${pct(caixa.x0)}% a ${pct(caixa.x1)}% da largura e de ${pct(caixa.y0)}% a ${pct(caixa.y1)}% da altura). Deixe essa área só com o fundo: sem texto, sem logo, sem rosto e sem objeto importante nela. Não desenhe selo, etiqueta nem carimbo nenhum.`;
}

// ------------------------------------------------------------------ Jev

export type PerguntaDeEscolhaDoSelo = { type: "choice"; instructions: unknown; criteria: Record<string, unknown> };

/**
 * Papel de uma referência de selo. `state`: { pedido, nota, descricao }.
 * Choice do Jev (a descrição vem da leitura por visão; o julgamento é do Jev).
 */
export function perguntaDoPapelDaReferencia(): PerguntaDeEscolhaDoSelo {
  return {
    type: "choice",
    instructions: "A equipe de uma agência mandou esta imagem como referência para o selo (logo do tema) de uma campanha. `descricao` é o que se vê na imagem; `nota` é o que a equipe escreveu junto com ela (pode estar vazia); `pedido` é o pedido da equipe. Para desenhar o selo novo, qual é o papel principal desta referência?",
    criteria: {
      estilo: { what: "Seguir o acabamento visual: traço, textura, tipo de letra ou tratamento (carimbo, lettering, 3D, aquarela).", examples: ["quero nesse estilo de lettering", "com essa textura de carimbo"] },
      forma: { what: "Seguir o formato e a composição: o contorno (círculo, fita, escudo, etiqueta) e onde fica o texto.", examples: ["nesse formato de fita", "redondo assim"] },
      cor: { what: "Seguir as cores da referência.", examples: ["com essas cores", "nessa paleta"] },
      inspiracao: { what: "Só inspiração geral de clima, sem copiar nada específico; ou não dá para saber o que seguir.", examples: ["algo nessa vibe", "só para ter uma ideia"] },
    },
  };
}

export const CONFIANCA_MINIMA_DO_PAPEL = 0.5;

/** Papel aceito (abaixo da confiança mínima: só inspiração, o uso mais seguro). */
export function papelPelaResposta(r: { choice?: string; confidence?: number } | null | undefined): { papel: PapelDaReferencia; confianca: number | null } {
  const papel = r ? papelValido(r.choice) : null;
  const c = r && typeof r.confidence === "number" && isFinite(r.confidence) ? r.confidence : null;
  if (!papel || c === null || c < CONFIANCA_MINIMA_DO_PAPEL) return { papel: "inspiracao", confianca: c };
  return { papel, confianca: c };
}

export const INTENCOES_DO_SELO = ["nenhuma", "melhorar", "usar_logo", "usar_anexo", "gerar"] as const;
export type IntencaoDoSelo = (typeof INTENCOES_DO_SELO)[number];

/** Filtro barato antes do Jev: a mensagem fala de selo ou de usar a logo? */
export function falaDoSelo(mensagem: unknown): boolean {
  const t = String(mensagem == null ? "" : mensagem).toLowerCase();
  return /(^|[^a-zà-ú])(selo|selos|seleo|sello|badge|carimbo|emblema|logo do tema)([^a-zà-ú]|$)/.test(t) || /(usa|use|usar|coloca|p[oõ]e)\s+(a\s+)?logo/.test(t);
}

/**
 * O que a equipe quer com o selo na conversa da campanha. `state`:
 * { mensagem, imagens_anexadas, tem_selo }. "nenhuma": o pedido é sobre outra
 * coisa da campanha (o estrategista cuida).
 */
export function perguntaDoPedidoDoSelo(): PerguntaDeEscolhaDoSelo {
  return {
    type: "choice",
    instructions: "A equipe escreveu `mensagem` para o agente de uma campanha de redes sociais. `imagens_anexadas` diz quantas imagens vieram junto e `tem_selo` se a campanha já tem selo (logo do tema). O que a mensagem pede sobre o SELO da campanha?",
    criteria: {
      nenhuma: { what: "A mensagem não pede nada sobre o selo (é sobre conteúdos, período, oferta, tom, cores de apoio etc.), ou só pergunta algo." },
      melhorar: { what: "Mudar ou melhorar o selo atual: cor, letra, forma, deixar menos genérico, mais elegante; pode vir com uma imagem de referência.", examples: ["melhora o selo", "deixa o selo menos genérico", "o selo mais elegante, nesse estilo aqui"] },
      usar_logo: { what: "Usar a logo da marca como selo da campanha.", examples: ["usa a logo como selo", "põe a logo no lugar do selo"] },
      usar_anexo: { what: "Usar a imagem anexada, como está, como o selo da campanha.", examples: ["esse selo aqui", "usa esse selo que eu mandei", "o selo é esse"] },
      gerar: { what: "Criar selos novos do zero (outras opções).", examples: ["gera outros selos", "faz umas opções novas de selo"] },
    },
  };
}

export const CONFIANCA_MINIMA_DA_INTENCAO = 0.6;

/** Intenção aceita (confiança baixa ou pedido que precisa de anexo sem anexo: nenhuma). */
export function intencaoPelaResposta(r: { choice?: string; confidence?: number } | null | undefined, anexos: number): IntencaoDoSelo {
  if (!r) return "nenhuma";
  const i = (INTENCOES_DO_SELO as readonly string[]).indexOf(String(r.choice || "")) >= 0 ? (r.choice as IntencaoDoSelo) : "nenhuma";
  const c = typeof r.confidence === "number" && isFinite(r.confidence) ? r.confidence : 0;
  if (c < CONFIANCA_MINIMA_DA_INTENCAO) return "nenhuma";
  if (i === "usar_anexo" && anexos < 1) return "nenhuma";
  return i;
}

// ------------------------------------------------------------------ troca completa

export type LaminaDoTrabalho = { ordem: number; versao: number; selo_da_campanha?: { caminho?: string | null } | null };
export type TrabalhoDaCampanha = {
  id: string;
  titulo?: string | null;
  entrega_status?: string | null;
  aprovado_em?: string | null;
  post_id?: string | null;
  modelo_imagem_id?: string | null;
  qualidade?: string | null;
  total: number;
  cards: LaminaDoTrabalho[];
};

export type ImpactoDaTroca = {
  /** Aprovadas ou agendadas que usam outro selo: ficam como estão. */
  aprovadas: { trabalhos: number; laminas: number };
  /** Ainda não aprovadas que usam outro selo: dá para refazer (custo à vista e segundo clique para confirmar). */
  refazer: Array<{ trabalho_id: string; titulo: string | null; ordens: number[]; modelo_imagem_id: string | null; qualidade: string; enviada: boolean }>;
  /** Lâminas já com o selo atual. */
  com_o_atual: number;
};

export const aprovado = (t: Pick<TrabalhoDaCampanha, "entrega_status" | "aprovado_em" | "post_id">) =>
  !!t.aprovado_em || !!t.post_id || t.entrega_status === "aprovado" || t.entrega_status === "agendado";

/**
 * Depois de trocar o selo: as lâminas que levam selo (capa e fechamento) e
 * cuja última versão usa outro selo (ou nenhum colado pelo código). As
 * aprovadas ficam; as outras entram em "refazer". As que ainda não foram
 * geradas usam o selo novo na próxima geração, sozinhas.
 */
export function impactoDaTroca(trabalhos: TrabalhoDaCampanha[], seloAtual: string | null): ImpactoDaTroca {
  const saida: ImpactoDaTroca = { aprovadas: { trabalhos: 0, laminas: 0 }, refazer: [], com_o_atual: 0 };
  for (const t of trabalhos) {
    const total = Math.max(1, Math.round(Number(t.total) || 0));
    const comSelo = total > 1 ? [1, total] : [1];
    const velhas: number[] = [];
    for (const ordem of comSelo) {
      const versoes = (t.cards || []).filter((c) => c && c.ordem === ordem);
      if (!versoes.length) continue;
      const ultima = versoes.reduce((a, b) => (b.versao > a.versao ? b : a));
      const caminho = ultima.selo_da_campanha && ultima.selo_da_campanha.caminho ? ultima.selo_da_campanha.caminho : null;
      if (seloAtual && caminho === seloAtual) saida.com_o_atual += 1;
      else velhas.push(ordem);
    }
    if (!velhas.length) continue;
    if (aprovado(t)) {
      saida.aprovadas.trabalhos += 1;
      saida.aprovadas.laminas += velhas.length;
      continue;
    }
    saida.refazer.push({
      trabalho_id: t.id,
      titulo: t.titulo || null,
      ordens: velhas,
      modelo_imagem_id: t.modelo_imagem_id || null,
      qualidade: t.qualidade === "baixa" || t.qualidade === "alta" ? t.qualidade : "media",
      enviada: t.entrega_status === "aguardando_cliente" || t.entrega_status === "aguardando_agencia",
    });
  }
  return saida;
}

// ------------------------------------------------------------------ origens

export const ORIGENS_DO_SELO = ["gerado", "melhorado", "acervo", "arquivo", "enviado", "logo"] as const;
export type OrigemDoSelo = (typeof ORIGENS_DO_SELO)[number];

export const ROTULO_DA_ORIGEM: Record<OrigemDoSelo, string> = {
  gerado: "Gerado",
  melhorado: "Melhorado",
  acervo: "Do acervo",
  arquivo: "Selo antigo",
  enviado: "Enviado",
  logo: "Logo da marca",
};

/** Caminho de um selo desta campanha no bucket mesa. */
export const caminhoDoSelo = (clientId: string, campanhaId: string, sufixo: string) => `${clientId}/campanhas/${campanhaId}/selo-${sufixo}.png`;
