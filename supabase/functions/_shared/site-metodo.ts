/**
 * Método da casa para sites (frente SIT, 30/09/2026), a partir de
 * plano/p3-referencias.md §2.1: etapas, fórmula de 6 blocos (o quê,
 * estrutura, estilo/DNA, movimento, stack, referência de nível), DNA de 3 a 5
 * atributos, fórmula de imagem com espaço negativo e proporção por slot,
 * fórmula de copy e "gerar 3 e escolher".
 *
 * Julgamento é do Jev: o DNA sai das referências assim, a visão descreve (um
 * modelo com imagem escreve o que vê) e o Jev escolhe os atributos numa lista
 * fechada (Noul por atributo, Choice para movimento, nível e nicho). Nada de
 * prompt-e-parse para classificar.
 *
 * Puro: sem Deno e sem banco. A função mesa-site, o worker, a tela e os
 * testes importam o mesmo arquivo.
 */

/** As formas do Jev (as mesmas de jev.ts, repetidas aqui porque a tela importa este arquivo e jev.ts usa Deno). */
type PerguntaJev =
  | { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }
  | { type: "score"; instructions: unknown; criteria: string[] }
  | { type: "noul"; instructions: unknown; criteria?: { true: unknown; false: unknown } };
type RespostaJev = { choice?: string; noul?: number; score?: number; confidence?: number; probabilities?: Record<string, number> };

export const ETAPAS_DO_SITE = [
  { valor: "briefing", rotulo: "Briefing" },
  { valor: "referencias", rotulo: "Referências" },
  { valor: "direcao", rotulo: "Direção" },
  { valor: "conteudo", rotulo: "Conteúdo" },
  { valor: "imagens", rotulo: "Imagens" },
  { valor: "construcao", rotulo: "Construção" },
  { valor: "revisao", rotulo: "Revisão" },
  { valor: "publicacao", rotulo: "Publicação" },
] as const;
export type EtapaDoSite = (typeof ETAPAS_DO_SITE)[number]["valor"];
export const ehEtapaDoSite = (v: unknown): v is EtapaDoSite => typeof v === "string" && ETAPAS_DO_SITE.some((e) => e.valor === v);

// ------------------------------------------------------------------ DNA

export type AtributoDoDna = { id: string; rotulo: string; descricao: string };

/** Lista fechada (o DNA escuro é uma estética entre várias; a paleta vem da marca). */
export const ATRIBUTOS_DO_DNA: AtributoDoDna[] = [
  { id: "quase_preto", rotulo: "Quase preto com um destaque", descricao: "fundo quase preto com uma única cor de destaque" },
  { id: "claro_editorial", rotulo: "Claro e editorial", descricao: "fundo claro, editorial, muito respiro e texto bem composto" },
  { id: "luz_dramatica", rotulo: "Luz dramática", descricao: "luz dramática: uma luz principal, luz de recorte e brilho volumétrico" },
  { id: "profundidade", rotulo: "Profundidade", descricao: "profundidade com camadas e parallax" },
  { id: "serifada_gigante", rotulo: "Serifada gigante", descricao: "tipografia serifada gigante com entrelinha apertada e sans fina de apoio" },
  { id: "sans_pesada", rotulo: "Sans pesada", descricao: "títulos em sans pesada e geométrica, de alto impacto" },
  { id: "textura", rotulo: "Textura e atmosfera", descricao: "textura e atmosfera: grão de filme, vinheta, névoa ou partículas" },
  { id: "vidro", rotulo: "Vidro", descricao: "acabamento em vidro fosco (glassmorphism)" },
  { id: "bento", rotulo: "Grade bento", descricao: "grade bento com blocos de tamanhos diferentes" },
  { id: "minimalista", rotulo: "Minimalista", descricao: "poucos elementos e muito espaço vazio" },
  { id: "foto_real", rotulo: "Foto real grande", descricao: "fotografia real em destaque, grande, sangrando a tela" },
  { id: "cena_3d", rotulo: "Cena 3D", descricao: "cena 3D ou objeto renderizado como herói" },
];

export const MOVIMENTOS = [
  { id: "sutil", rotulo: "Sutil", descricao: "entradas suaves de seção e micro-interações, sem cena de rolagem" },
  { id: "rolagem_fixa", rotulo: "Rolagem fixa", descricao: "cenas presas na rolagem (scroll-pinned), imersivo" },
  { id: "tipo_cinetico", rotulo: "Tipografia cinética", descricao: "títulos que se montam e se movem com a rolagem, ousado" },
  { id: "ken_burns", rotulo: "Ken Burns lento", descricao: "zoom lento nas imagens, elegante" },
] as const;
export type Movimento = (typeof MOVIMENTOS)[number]["id"];

export const NIVEIS = [
  { id: "awwwards", rotulo: "Site do dia (Awwwards)", descricao: "nível Awwwards Site of the Day" },
  { id: "apple", rotulo: "Página de produto Apple", descricao: "página de produto da Apple: precisa, limpa e cinematográfica" },
  { id: "editorial", rotulo: "Revista editorial", descricao: "revista editorial impressa levada para a tela" },
  { id: "saas", rotulo: "SaaS premium", descricao: "SaaS premium (Linear, Vercel, Stripe): claro, rápido e confiável" },
] as const;
export type Nivel = (typeof NIVEIS)[number]["id"];

export const NICHOS = [
  { id: "servico_local", rotulo: "Serviço local" },
  { id: "agencia", rotulo: "Agência" },
  { id: "saas", rotulo: "SaaS" },
  { id: "portfolio", rotulo: "Portfólio" },
  { id: "lancamento", rotulo: "Lançamento" },
  { id: "ecommerce", rotulo: "Loja" },
  { id: "app", rotulo: "App" },
  { id: "evento", rotulo: "Evento" },
  { id: "luxo", rotulo: "Luxo" },
] as const;
export type Nicho = (typeof NICHOS)[number]["id"];

export const MIN_ATRIBUTOS = 3;
export const MAX_ATRIBUTOS = 5;
/** Probabilidade mínima do Noul para o atributo entrar sozinho no DNA. */
export const LIMIAR_DO_ATRIBUTO = 0.55;

export type DnaDoSite = {
  atributos: Array<{ id: string; prob: number | null }>;
  movimento: Movimento;
  nivel: Nivel;
  nicho: Nicho;
  /** Cores que a visão leu nas referências (só apoio; a paleta vem do kit da marca). */
  cores_das_referencias: string[];
  observacoes: string;
  fonte: "jev" | "manual" | "padrao";
};

/**
 * Perguntas do Jev sobre as observações das referências: um Noul por
 * atributo e um Choice para movimento, nível e nicho. O estado leva as
 * observações e o contexto da marca; nunca a chave nem dado sensível.
 */
export function perguntasDoDna(): Record<string, PerguntaJev> {
  const q: Record<string, PerguntaJev> = {};
  for (const a of ATRIBUTOS_DO_DNA) {
    q[`attr_${a.id}`] = {
      type: "noul",
      instructions: `The reference websites and images described in state.observacoes clearly show this visual trait: ${a.descricao}. Judge only from the observations.`,
      criteria: { true: "the observations show this trait", false: "the observations do not show this trait" },
    };
  }
  q.movimento = {
    type: "choice",
    instructions: "Which motion style best matches the references (state.observacoes) and the brand (state.marca)?",
    criteria: Object.fromEntries(MOVIMENTOS.map((m) => [m.id, m.descricao])),
  };
  q.nivel = {
    type: "choice",
    instructions: "Which quality reference level do these references aim at?",
    criteria: Object.fromEntries(NIVEIS.map((n) => [n.id, n.descricao])),
  };
  q.nicho = {
    type: "choice",
    instructions: "Which niche fits the client's business (state.marca.negocio) for this website?",
    criteria: Object.fromEntries(NICHOS.map((n) => [n.id, n.rotulo])),
  };
  return q;
}

const escolhaValida = <T extends string>(r: RespostaJev | undefined, validos: readonly { id: T }[], padrao: T): T => {
  const c = r && typeof r.choice === "string" ? r.choice : "";
  return (validos.find((v) => v.id === c) || { id: padrao }).id;
};

/**
 * Lê as respostas do Jev: os atributos acima do limiar, do mais provável ao
 * menos; menos de 3, completa com os mais prováveis; mais de 5, corta.
 */
export function lerDnaDoJev(answers: Record<string, RespostaJev>, extra: { observacoes: string; cores: string[] }): DnaDoSite {
  const probs = ATRIBUTOS_DO_DNA.map((a) => {
    const r = answers[`attr_${a.id}`];
    const p = r && typeof r.noul === "number" && Number.isFinite(r.noul) ? r.noul : null;
    return { id: a.id, prob: p };
  }).sort((x, y) => (y.prob ?? -1) - (x.prob ?? -1));
  let escolhidos = probs.filter((a) => (a.prob ?? 0) >= LIMIAR_DO_ATRIBUTO);
  if (escolhidos.length < MIN_ATRIBUTOS) escolhidos = probs.filter((a) => a.prob !== null).slice(0, MIN_ATRIBUTOS);
  escolhidos = escolhidos.slice(0, MAX_ATRIBUTOS);
  return {
    atributos: escolhidos,
    movimento: escolhaValida(answers.movimento, MOVIMENTOS, "sutil"),
    nivel: escolhaValida(answers.nivel, NIVEIS, "saas"),
    nicho: escolhaValida(answers.nicho, NICHOS, "servico_local"),
    cores_das_referencias: coresValidas(extra.cores).slice(0, 8),
    observacoes: String(extra.observacoes || "").slice(0, 4000),
    fonte: "jev",
  };
}

export const HEX = /^#[0-9a-f]{6}$/i;
export const coresValidas = (lista: unknown): string[] =>
  (Array.isArray(lista) ? lista : [])
    .map((c) => String(c || "").trim())
    .map((c) => (/^#[0-9a-f]{3}$/i.test(c) ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c))
    .filter((c) => HEX.test(c))
    .map((c) => c.toUpperCase())
    .filter((c, i, l) => l.indexOf(c) === i);

/** DNA escolhido à mão (a equipe manda): ids válidos, de 3 a 5. */
export function dnaManual(b: unknown, antes?: DnaDoSite | null): DnaDoSite {
  const o = b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  const ids = (Array.isArray(o.atributos) ? o.atributos : [])
    .map((x) => (x && typeof x === "object" ? String((x as { id?: unknown }).id || "") : String(x || "")))
    .filter((id) => ATRIBUTOS_DO_DNA.some((a) => a.id === id))
    .filter((id, i, l) => l.indexOf(id) === i)
    .slice(0, MAX_ATRIBUTOS);
  const m = MOVIMENTOS.find((x) => x.id === o.movimento);
  const n = NIVEIS.find((x) => x.id === o.nivel);
  const ni = NICHOS.find((x) => x.id === o.nicho);
  return {
    atributos: ids.map((id) => ({ id, prob: null })),
    movimento: m ? m.id : antes ? antes.movimento : "sutil",
    nivel: n ? n.id : antes ? antes.nivel : "saas",
    nicho: ni ? ni.id : antes ? antes.nicho : "servico_local",
    cores_das_referencias: antes ? antes.cores_das_referencias : [],
    observacoes: antes ? antes.observacoes : "",
    fonte: "manual",
  };
}

export const rotuloDoAtributo = (id: string) => (ATRIBUTOS_DO_DNA.find((a) => a.id === id) || { rotulo: id }).rotulo;

// ------------------------------------------------------------------ seções

export const SECOES_DO_SITE = [
  { id: "topo", rotulo: "Topo e navegação" },
  { id: "hero", rotulo: "Abertura (hero)" },
  { id: "problema", rotulo: "Problema" },
  { id: "servicos", rotulo: "Serviços" },
  { id: "processo", rotulo: "Como funciona" },
  { id: "diferenciais", rotulo: "Diferenciais" },
  { id: "prova", rotulo: "Prova (só real)" },
  { id: "faq", rotulo: "Perguntas" },
  { id: "chamada", rotulo: "Chamada final" },
  { id: "rodape", rotulo: "Rodapé" },
] as const;
export type SecaoDoSite = (typeof SECOES_DO_SITE)[number]["id"];
export const SECOES_PADRAO: SecaoDoSite[] = ["topo", "hero", "servicos", "processo", "diferenciais", "faq", "chamada", "rodape"];
export const rotuloDaSecao = (id: string) => (SECOES_DO_SITE.find((s) => s.id === id) || { rotulo: id }).rotulo;

// ------------------------------------------------------------------ conteúdo (copy)

export type SecaoDeCopy = { id: string; titulo: string; texto: string; itens: string[] };
export type OpcaoDeCopy = {
  conceito: string;
  headline: string;
  subtitulo: string;
  cta: string;
  secoes: SecaoDeCopy[];
  faq: Array<{ pergunta: string; resposta: string }>;
  seo: { titulo: string; descricao: string; palavras: string[] };
};

/** Esquema do conteúdo: exatamente 3 opções (gerar a mais e escolher). */
export const ESQUEMA_DO_CONTEUDO = {
  nome: "conteudo_do_site",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["opcoes"],
    properties: {
      opcoes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["conceito", "headline", "subtitulo", "cta", "secoes", "faq", "seo"],
          properties: {
            conceito: { type: "string" },
            headline: { type: "string" },
            subtitulo: { type: "string" },
            cta: { type: "string" },
            secoes: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "titulo", "texto", "itens"],
                properties: { id: { type: "string" }, titulo: { type: "string" }, texto: { type: "string" }, itens: { type: "array", items: { type: "string" } } },
              },
            },
            faq: {
              type: "array",
              items: { type: "object", additionalProperties: false, required: ["pergunta", "resposta"], properties: { pergunta: { type: "string" }, resposta: { type: "string" } } },
            },
            seo: {
              type: "object",
              additionalProperties: false,
              required: ["titulo", "descricao", "palavras"],
              properties: { titulo: { type: "string" }, descricao: { type: "string" }, palavras: { type: "array", items: { type: "string" } } },
            },
          },
        },
      },
    },
  },
};

const semTravessao = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");
const txt = (v: unknown, max: number) => semTravessao(String(v ?? "").replace(/\s+/g, " ").trim()).slice(0, max);

/** Normaliza as opções do modelo (headline até 8 palavras, SEO no tamanho, sem travessão). */
export function normalizarOpcoesDeCopy(bruto: unknown): OpcaoDeCopy[] {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const lista = Array.isArray(o.opcoes) ? o.opcoes : [];
  return lista.slice(0, 3).map((b) => {
    const x = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
    const seo = (x.seo && typeof x.seo === "object" ? x.seo : {}) as Record<string, unknown>;
    const palavras = txt(x.headline, 120).split(" ").filter(Boolean);
    return {
      conceito: txt(x.conceito, 200),
      headline: palavras.slice(0, 8).join(" "),
      subtitulo: txt(x.subtitulo, 240),
      cta: txt(x.cta, 40),
      secoes: (Array.isArray(x.secoes) ? x.secoes : []).slice(0, 12).map((s) => {
        const y = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
        return { id: txt(y.id, 40).toLowerCase(), titulo: txt(y.titulo, 120), texto: txt(y.texto, 700), itens: (Array.isArray(y.itens) ? y.itens : []).slice(0, 8).map((i) => txt(i, 200)).filter(Boolean) };
      }),
      faq: (Array.isArray(x.faq) ? x.faq : []).slice(0, 8).map((f) => {
        const y = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
        return { pergunta: txt(y.pergunta, 200), resposta: txt(y.resposta, 600) };
      }).filter((f) => f.pergunta && f.resposta),
      seo: {
        titulo: txt(seo.titulo, 60),
        descricao: txt(seo.descricao, 155),
        palavras: (Array.isArray(seo.palavras) ? seo.palavras : []).slice(0, 10).map((p) => txt(p, 40)).filter(Boolean),
      },
    };
  }).filter((op) => op.headline && op.cta);
}

// ------------------------------------------------------------------ imagens

/** Slots de imagem: proporção por slot e onde fica o espaço negativo do título. */
export const SLOTS_DE_IMAGEM = [
  { id: "hero", rotulo: "Abertura", tamanho: "1536x1024", proporcao: "16:9 (cortada de 3:2)", espaco: "terço esquerdo livre e escuro para o título" },
  { id: "secao", rotulo: "Seção", tamanho: "1088x1360", proporcao: "4:5", espaco: "parte de cima livre para um título curto" },
  { id: "fundo", rotulo: "Fundo de seção", tamanho: "1536x1024", proporcao: "16:9", espaco: "centro calmo, baixo contraste, para texto por cima" },
  { id: "detalhe", rotulo: "Detalhe", tamanho: "1024x1024", proporcao: "1:1", espaco: "margem livre em volta do objeto" },
] as const;
export type SlotDeImagem = (typeof SLOTS_DE_IMAGEM)[number]["id"];

/**
 * Fórmula de imagem (sujeito, ação, luz, fundo, estilo, proporção), sempre
 * com espaço negativo e SEM texto nem logo: a logo e as fotos reais do
 * cliente entram pelo código no site, nunca pelo gerador.
 */
export function promptDaImagem(p: { slot: SlotDeImagem; sujeito: string; acao?: string; luz?: string; fundo?: string; estilo?: string; paleta?: string[]; dna?: string[] }): string {
  const slot = SLOTS_DE_IMAGEM.find((s) => s.id === p.slot) || SLOTS_DE_IMAGEM[0];
  const partes = [
    `Sujeito: ${txt(p.sujeito, 300) || "cena do negócio do cliente"}.`,
    p.acao ? `Ação: ${txt(p.acao, 200)}.` : "",
    `Luz: ${txt(p.luz, 160) || "luz principal suave de um lado, recorte discreto"}.`,
    `Fundo: ${txt(p.fundo, 160) || "ambiente coerente, desfocado"}.`,
    `Estilo: ${txt(p.estilo, 240) || "fotografia editorial premium, realista"}${p.dna && p.dna.length ? `; ${p.dna.map(rotuloDoAtributo).join(", ").toLowerCase()}` : ""}.`,
    p.paleta && p.paleta.length ? `Cores dominantes: ${coresValidas(p.paleta).slice(0, 4).join(", ")}.` : "",
    `Proporção ${slot.proporcao}. Composição com espaço negativo: ${slot.espaco}.`,
    "Sem texto, sem letras, sem logotipo, sem marca d'água, sem interface. Nada de rosto conhecido.",
  ];
  return partes.filter(Boolean).join(" ");
}

// ------------------------------------------------------------------ fórmula de 6 blocos

export type PacoteDoSite = {
  cliente: string;
  marca: { nome: string; negocio?: string; publico?: string; oferta?: string; tom?: string; diferenciais?: string[] };
  paleta: Array<{ hex: string; nome?: string; papel?: string }>;
  fontes: Array<{ nome: string; papel: string }>;
  dna: DnaDoSite | null;
  direcao: { nicho?: string; peca?: string; referencia_de_nivel?: string; observacao?: string };
  copy: OpcaoDeCopy | null;
  imagens: Array<{ slot: string; arquivo: string; alt: string }>;
  fotos_reais: Array<{ arquivo: string; alt: string }>;
  logo: string | null;
  secoes: string[];
};

/**
 * Prompt do agente de código pela fórmula de 6 blocos, para uma seção por
 * vez. O AGENTS.md do projeto traz o método e as regras de licença; aqui vai
 * o pedido da passada.
 */
export function promptDaSecao(p: PacoteDoSite, secao: string, extra?: string | null): string {
  const dna = p.dna ? p.dna.atributos.map((a) => rotuloDoAtributo(a.id)).join(", ") : "a definir pela marca";
  const mov = p.dna ? (MOVIMENTOS.find((m) => m.id === p.dna!.movimento) || MOVIMENTOS[0]).descricao : MOVIMENTOS[0].descricao;
  const nivel = p.dna ? (NIVEIS.find((n) => n.id === p.dna!.nivel) || NIVEIS[3]).descricao : NIVEIS[3].descricao;
  const copySecao = p.copy ? p.copy.secoes.find((s) => s.id === secao) : null;
  const blocos = [
    `1. O QUÊ: a seção "${rotuloDaSecao(secao)}" (id ${secao}) do site de uma página de ${p.cliente}.`,
    `2. ESTRUTURA: leia .aceleriq/pacote.json. Crie ou ajuste src/secoes/${nomeDoComponente(secao)}.tsx e registre em src/secoes/index.ts na ordem de pacote.secoes. ${copySecao ? "Use o texto de pacote.copy.secoes (id " + secao + ") sem inventar dado." : secao === "hero" && p.copy ? "Use headline, subtitulo e cta de pacote.copy." : "Use só o que está no pacote; o que faltar vira texto neutro e curto, sem número inventado."}`,
    `3. ESTILO E DNA: ${dna}. Paleta da marca em src/tema.css (variáveis), nunca cor solta. Logo e fotos reais só pelos arquivos de public/ citados no pacote.`,
    `4. MOVIMENTO: ${mov}. Use os tokens de src/lib/movimento.ts, respeite prefers-reduced-motion e não use useReducedMotion nem useScroll fora de [0,1].`,
    "5. STACK: Vite + React + Tailwind + Motion; GSAP ScrollTrigger/SplitText e Lenis só onde o movimento pedir. Nada de biblioteca fora do AGENTS.md.",
    `6. REFERÊNCIA DE NÍVEL: ${nivel}. Premium, com respiro, hierarquia clara e contraste AA.`,
  ];
  if (extra) blocos.push(`PEDIDO DA EQUIPE PARA ESTA SEÇÃO: ${txt(extra, 1500)}`);
  blocos.push("Ao terminar, rode `npm run checar` e corrija só o que o comando apontar nesta seção. Não mexa nas outras seções.");
  return blocos.join("\n");
}

export const nomeDoComponente = (secao: string) =>
  String(secao || "secao")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("") || "Secao";

// ------------------------------------------------------------------ revisão (QA como aviso)

export type AvisoDeQa = { area: "acessibilidade" | "celular" | "seo"; texto: string };

/**
 * Revisão do HTML pronto (o index.html pré-renderizado). Regras fixas, sem
 * julgamento: vira aviso, nunca bloqueia a publicação.
 */
export function revisarHtml(html: string): AvisoDeQa[] {
  const h = String(html || "");
  const avisos: AvisoDeQa[] = [];
  const tem = (re: RegExp) => re.test(h);
  if (!tem(/<html[^>]*\blang=["'][a-z]{2}/i)) avisos.push({ area: "acessibilidade", texto: "Falta o idioma da página (lang no <html>)." });
  if (!tem(/<meta[^>]+name=["']viewport["'][^>]*width=device-width/i)) avisos.push({ area: "celular", texto: "Falta a meta viewport com width=device-width." });
  const titulo = /<title>([^<]*)<\/title>/i.exec(h);
  if (!titulo || !titulo[1].trim()) avisos.push({ area: "seo", texto: "Falta o título da página." });
  else if (titulo[1].trim().length > 60) avisos.push({ area: "seo", texto: `Título com ${titulo[1].trim().length} caracteres (o ideal é até 60).` });
  const desc = /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(h);
  if (!desc || !desc[1].trim()) avisos.push({ area: "seo", texto: "Falta a meta description." });
  else if (desc[1].trim().length > 160) avisos.push({ area: "seo", texto: "Meta description longa (o ideal é até 155 caracteres)." });
  if (!tem(/<meta[^>]+property=["']og:title["']/i)) avisos.push({ area: "seo", texto: "Falta og:title (prévia ao compartilhar)." });
  if (!tem(/<meta[^>]+property=["']og:image["']/i)) avisos.push({ area: "seo", texto: "Falta og:image (imagem ao compartilhar)." });
  const h1 = (h.match(/<h1[\s>]/gi) || []).length;
  if (h1 === 0) avisos.push({ area: "seo", texto: "A página não tem título principal (h1)." });
  if (h1 > 1) avisos.push({ area: "seo", texto: `A página tem ${h1} títulos principais (h1); o certo é um.` });
  const imgs = h.match(/<img\b[^>]*>/gi) || [];
  const semAlt = imgs.filter((i) => !/\balt=/i.test(i)).length;
  if (semAlt) avisos.push({ area: "acessibilidade", texto: `${semAlt} imagem(ns) sem texto alternativo (alt).` });
  const semTamanho = imgs.filter((i) => !/\bwidth=/i.test(i) || !/\bheight=/i.test(i)).length;
  if (semTamanho) avisos.push({ area: "celular", texto: `${semTamanho} imagem(ns) sem largura e altura (a página pula ao carregar).` });
  const botoesVazios = (h.match(/<button\b[^>]*>\s*(<svg[\s\S]*?<\/svg>)?\s*<\/button>/gi) || []).filter((b) => !/aria-label=/i.test(b)).length;
  if (botoesVazios) avisos.push({ area: "acessibilidade", texto: `${botoesVazios} botão(ões) sem nome (texto ou aria-label).` });
  const linksVazios = (h.match(/<a\b[^>]*>\s*(<svg[\s\S]*?<\/svg>)?\s*<\/a>/gi) || []).filter((b) => !/aria-label=/i.test(b)).length;
  if (linksVazios) avisos.push({ area: "acessibilidade", texto: `${linksVazios} link(s) sem nome (texto ou aria-label).` });
  if (!tem(/<div id=["']root["'][^>]*>\s*<[a-z]/i)) avisos.push({ area: "seo", texto: "O conteúdo não veio pré-renderizado (o buscador vê a página vazia)." });
  return avisos;
}
