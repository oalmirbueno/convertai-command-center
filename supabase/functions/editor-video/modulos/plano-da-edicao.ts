/**
 * Plano do "Editar com IA" (frente EDT, rodada 2, 30/09/2026). PURO: a tela e
 * a função editor-video usam o mesmo esquema, as mesmas receitas e a mesma
 * limpeza.
 *
 * Como funciona (sem laço, como o EDIT IA PRO faz, com as nossas regras):
 * 1. O modelo escolhido lê a instrução do dono e um resumo do vídeo (fala,
 *    duração, formato, mídias, marca) e devolve UM plano: quais peças ligar e
 *    com que opções (tudo em lista fechada) e os textos curtos (gancho,
 *    chamada), tirados da fala.
 * 2. O código limpa o plano (opção fora da lista vira a padrão; número que
 *    não foi dito sai do texto) e monta a edição inteira com as skills
 *    determinísticas; os julgamentos finos (momentos fortes, B-roll do acervo,
 *    capítulos, momentos virais, animações) vão para o Jev.
 * 3. A pessoa vê a lista do que muda, confirma, e cada peça fica na linha do
 *    tempo para ajustar. Sem crédito de IA, o "plano da casa" (receita, sem
 *    modelo) faz o mesmo de graça.
 */

import { motivoDoPedido, pecaPermitida, ROTULO_DA_PECA, type PecaDoPedido, type PedidoDoDono } from "./pedido-do-dono.ts";

export const FORMATOS_DO_PLANO = ["manter", "9:16", "1:1", "4:5", "16:9"] as const;
/** Mesmos ids de src/lib/editor/estilosDeTexto.ts (o teste confere). */
export const LEGENDAS_DO_PLANO = ["destaque", "caixa", "caixa_palavra", "impacto", "gigante", "pulso", "fita", "papelaria", "discreta", "simples"] as const;
/** Mesmos ids de src/lib/editor/cor.ts (o teste confere). */
export const LOOKS_DO_PLANO = ["natural", "vivo", "quente", "frio", "cinema", "suave", "vintage", "noite", "pb"] as const;
export const TRANSICOES_DO_PLANO = ["fade", "dissolver", "whip", "flash", "desfoque", "zoom", "deslizar"] as const;
export const POSICOES_DO_PLANO = ["auto", "topo", "meio", "base"] as const;

export interface PlanoDaEdicao {
  resumo: string;
  receita: string;
  cortar_erros: boolean;
  cortar_pausas: boolean;
  formato: (typeof FORMATOS_DO_PLANO)[number];
  seguir_rosto: boolean;
  legenda: { ligado: boolean; estilo: string; palavras: number; posicao: string };
  zoom: { ligado: boolean; intensidade: "suave" | "media" | "forte" };
  textos: { gancho: string; chamada: string; nome: string };
  motion: { ligado: boolean; densidade: "poucas" | "medias" };
  broll: { ligado: boolean; maximo: number };
  musica: { ligado: boolean; fonte: string };
  sons: { ligado: boolean; modo: "casados" | "poucos" };
  transicoes: { ligado: boolean; tipo: string };
  cor: { look: string; intensidade: number };
  capitulos: boolean;
  virais: boolean;
  logo: "nenhum" | "canto" | "sting" | "cartao_final";
  cartao_final: { ligado: boolean; titulo: string; botao: string };
}

export interface Receita {
  id: string;
  rotulo: string;
  /** O pedido pronto (vai no campo; a pessoa muda à vontade). */
  instrucao: string;
  plano: Partial<PlanoDaEdicao>;
}

const BASE: PlanoDaEdicao = {
  resumo: "",
  receita: "dinamico",
  cortar_erros: true,
  cortar_pausas: true,
  formato: "manter",
  seguir_rosto: true,
  legenda: { ligado: true, estilo: "destaque", palavras: 3, posicao: "auto" },
  zoom: { ligado: true, intensidade: "media" },
  textos: { gancho: "", chamada: "", nome: "" },
  motion: { ligado: true, densidade: "medias" },
  broll: { ligado: true, maximo: 4 },
  musica: { ligado: true, fonte: "" },
  sons: { ligado: true, modo: "casados" },
  transicoes: { ligado: true, tipo: "whip" },
  cor: { look: "vivo", intensidade: 0.8 },
  capitulos: false,
  virais: false,
  logo: "cartao_final",
  cartao_final: { ligado: true, titulo: "", botao: "" },
};

export const RECEITAS: Receita[] = [
  { id: "dinamico", rotulo: "Reels dinâmico", instrucao: "Deixa dinâmico para Reels: tira pausas e erros, legenda animada, zoom nos momentos fortes, animações, sons e música baixa.", plano: {} },
  {
    id: "anuncio",
    rotulo: "Anúncio com prova",
    instrucao: "Anúncio: gancho forte no começo, legenda de impacto, prova na tela com B-roll do acervo, chamada no fim com a logo.",
    plano: { legenda: { ligado: true, estilo: "impacto", palavras: 2, posicao: "auto" }, zoom: { ligado: true, intensidade: "forte" }, cor: { look: "vivo", intensidade: 1 }, transicoes: { ligado: true, tipo: "flash" } },
  },
  {
    id: "aula",
    rotulo: "Aula ou tutorial",
    instrucao: "Aula: corte limpo, legenda discreta, capítulos, zoom suave, passo a passo na tela, sem música alta.",
    plano: { legenda: { ligado: true, estilo: "discreta", palavras: 5, posicao: "base" }, zoom: { ligado: true, intensidade: "suave" }, capitulos: true, sons: { ligado: false, modo: "poucos" }, cor: { look: "natural", intensidade: 1 }, transicoes: { ligado: true, tipo: "fade" } },
  },
  {
    id: "depoimento",
    rotulo: "Depoimento",
    instrucao: "Depoimento: sem cortar respiros demais, nome da pessoa na tela, legenda em caixa, cor quente e música suave.",
    plano: { legenda: { ligado: true, estilo: "caixa", palavras: 4, posicao: "auto" }, zoom: { ligado: true, intensidade: "suave" }, motion: { ligado: false, densidade: "poucas" }, cor: { look: "quente", intensidade: 0.8 }, sons: { ligado: false, modo: "poucos" }, transicoes: { ligado: true, tipo: "dissolver" } },
  },
  {
    id: "podcast",
    rotulo: "Podcast em cortes",
    instrucao: "Podcast: acha os momentos virais e os capítulos, reenquadra para 9:16 seguindo o rosto, legenda palavra gigante.",
    plano: { formato: "9:16", capitulos: true, virais: true, legenda: { ligado: true, estilo: "gigante", palavras: 1, posicao: "auto" }, broll: { ligado: false, maximo: 0 }, cor: { look: "cinema", intensidade: 0.7 } },
  },
  {
    id: "institucional",
    rotulo: "Institucional",
    instrucao: "Institucional da marca: ritmo calmo, cor de cinema, títulos elegantes, transições suaves, logo na abertura e no fim.",
    plano: { legenda: { ligado: true, estilo: "fita", palavras: 4, posicao: "base" }, zoom: { ligado: true, intensidade: "suave" }, motion: { ligado: true, densidade: "poucas" }, cor: { look: "cinema", intensidade: 1 }, transicoes: { ligado: true, tipo: "dissolver" }, logo: "sting" },
  },
];

const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Plano da casa (sem modelo, de graça): a receita por cima da base. Com
 * música na Mídia do projeto, a primeira entra abaixo da voz (a pessoa troca
 * ou tira no plano); sem música, a peça fica desligada.
 */
export function planoPadrao(receita = "dinamico", musicas: string[] = []): PlanoDaEdicao {
  const r = RECEITAS.find((x) => x.id === receita) || RECEITAS[0];
  const p: PlanoDaEdicao = { ...copia(BASE), ...copia(r.plano), receita: r.id, resumo: `Plano da casa: ${r.rotulo.toLowerCase()}.` };
  const fonte = musicas.length ? String(musicas[0]) : "";
  p.musica = { ligado: p.musica.ligado && !!fonte, fonte };
  return p;
}

// ------------------------------------------------------------------ limpeza

const um = <T extends string>(v: unknown, lista: readonly T[], padrao: T): T => ((lista as readonly string[]).indexOf(String(v)) >= 0 ? (String(v) as T) : padrao);
const sim = (v: unknown, padrao: boolean) => (typeof v === "boolean" ? v : padrao);
const numero = (v: unknown, min: number, max: number, padrao: number) => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !isFinite(n) ? padrao : Math.max(min, Math.min(max, n));
};
const curto = (v: unknown, max: number) =>
  String(v === null || v === undefined ? "" : v)
    .replace(/[–—]/g, ",")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** Números citados num texto ("R$ 1.200", "30%", "3 passos" -> 1200, 30, 3). */
export function numerosDoTexto(t: string): number[] {
  const saida: number[] = [];
  const re = /(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(t || "")))) {
    const n = Number(m[1].replace(/\./g, "") + (m[2] ? `.${m[2]}` : ""));
    if (isFinite(n)) saida.push(n);
  }
  return saida;
}

/** Texto com número que não foi dito vira vazio (o vídeo não inventa dado). */
export function semNumeroInventado(texto: string, fala: string): { texto: string; tirou: boolean } {
  const ditos = numerosDoTexto(fala);
  const inventado = numerosDoTexto(texto).some((n) => !ditos.some((d) => Math.abs(d - n) < 1e-9));
  return inventado ? { texto: "", tirou: true } : { texto, tirou: false };
}

/**
 * Plano conferido: tudo em lista fechada; música só entre as fontes de áudio
 * do projeto; textos curtos, sem travessão e sem número que não foi dito.
 */
export function normalizarPlano(bruto: unknown, ctx: { fontesDeAudio: string[]; fala: string }): { plano: PlanoDaEdicao; avisos: string[] } {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const receita = RECEITAS.some((r) => r.id === o.receita) ? String(o.receita) : "dinamico";
  const base = planoPadrao(receita);
  const avisos: string[] = [];
  const obj = (k: string) => (o[k] && typeof o[k] === "object" ? (o[k] as Record<string, unknown>) : {});
  const leg = obj("legenda");
  const zoom = obj("zoom");
  const tx = obj("textos");
  const mo = obj("motion");
  const br = obj("broll");
  const mu = obj("musica");
  const so = obj("sons");
  const tr = obj("transicoes");
  const co = obj("cor");
  const cf = obj("cartao_final");
  const limpar = (v: unknown, max: number, nome: string) => {
    const t = curto(v, max);
    const r = semNumeroInventado(t, ctx.fala);
    if (r.tirou) avisos.push(`O ${nome} citava um número que não foi dito: ficou de fora.`);
    return r.texto;
  };
  let fonte = curto(mu.fonte, 60);
  if (fonte && ctx.fontesDeAudio.indexOf(fonte) < 0) {
    avisos.push(`A música "${fonte}" não está na Mídia do projeto: ficou sem música (escolha no painel Som).`);
    fonte = "";
  } else if (!fonte && ctx.fontesDeAudio.length === 1 && mu.ligado !== false) fonte = ctx.fontesDeAudio[0];
  const plano: PlanoDaEdicao = {
    resumo: curto(o.resumo, 400) || base.resumo,
    receita,
    cortar_erros: sim(o.cortar_erros, base.cortar_erros),
    cortar_pausas: sim(o.cortar_pausas, base.cortar_pausas),
    formato: um(o.formato, FORMATOS_DO_PLANO, base.formato),
    seguir_rosto: sim(o.seguir_rosto, base.seguir_rosto),
    legenda: {
      ligado: sim(leg.ligado, base.legenda.ligado),
      estilo: um(leg.estilo, LEGENDAS_DO_PLANO, base.legenda.estilo as (typeof LEGENDAS_DO_PLANO)[number]),
      palavras: Math.round(numero(leg.palavras, 1, 8, base.legenda.palavras)),
      posicao: um(leg.posicao, POSICOES_DO_PLANO, base.legenda.posicao as (typeof POSICOES_DO_PLANO)[number]),
    },
    zoom: { ligado: sim(zoom.ligado, base.zoom.ligado), intensidade: um(zoom.intensidade, ["suave", "media", "forte"] as const, base.zoom.intensidade) },
    textos: { gancho: limpar(tx.gancho, 60, "gancho"), chamada: limpar(tx.chamada, 40, "texto da chamada"), nome: limpar(tx.nome, 60, "nome") },
    motion: { ligado: sim(mo.ligado, base.motion.ligado), densidade: um(mo.densidade, ["poucas", "medias"] as const, base.motion.densidade) },
    broll: { ligado: sim(br.ligado, base.broll.ligado), maximo: Math.round(numero(br.maximo, 0, 12, base.broll.maximo)) },
    musica: { ligado: sim(mu.ligado, base.musica.ligado) && !!fonte, fonte },
    sons: { ligado: sim(so.ligado, base.sons.ligado), modo: um(so.modo, ["casados", "poucos"] as const, base.sons.modo) },
    transicoes: { ligado: sim(tr.ligado, base.transicoes.ligado), tipo: um(tr.tipo, TRANSICOES_DO_PLANO, base.transicoes.tipo as (typeof TRANSICOES_DO_PLANO)[number]) },
    cor: { look: um(co.look, LOOKS_DO_PLANO, base.cor.look as (typeof LOOKS_DO_PLANO)[number]), intensidade: Math.round(numero(co.intensidade, 0, 1, base.cor.intensidade) * 100) / 100 },
    capitulos: sim(o.capitulos, base.capitulos),
    virais: sim(o.virais, base.virais),
    logo: um(o.logo, ["nenhum", "canto", "sting", "cartao_final"] as const, base.logo),
    cartao_final: { ligado: sim(cf.ligado, base.cartao_final.ligado), titulo: limpar(cf.titulo, 50, "título do cartão final"), botao: limpar(cf.botao, 30, "botão do cartão final") },
  };
  if (!ctx.fala.trim()) {
    if (plano.legenda.ligado || plano.zoom.ligado || plano.motion.ligado) avisos.push("Sem fala marcada: legenda, zoom nos momentos e animações pedem a fala (Timestamp).");
  }
  return { plano, avisos };
}

// ------------------------------------------------------------------ pedido ao modelo

const texto = { type: "string" };
const booleano = { type: "boolean" };
const enumDe = (l: readonly string[]) => ({ type: "string", enum: l.slice() });

export const ESQUEMA_DO_PLANO = {
  nome: "plano_da_edicao",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["resumo", "receita", "cortar_erros", "cortar_pausas", "formato", "seguir_rosto", "legenda", "zoom", "textos", "motion", "broll", "musica", "sons", "transicoes", "cor", "capitulos", "virais", "logo", "cartao_final"],
    properties: {
      resumo: texto,
      receita: enumDe(RECEITAS.map((r) => r.id)),
      cortar_erros: booleano,
      cortar_pausas: booleano,
      formato: enumDe(FORMATOS_DO_PLANO),
      seguir_rosto: booleano,
      legenda: { type: "object", additionalProperties: false, required: ["ligado", "estilo", "palavras", "posicao"], properties: { ligado: booleano, estilo: enumDe(LEGENDAS_DO_PLANO), palavras: { type: "number" }, posicao: enumDe(POSICOES_DO_PLANO) } },
      zoom: { type: "object", additionalProperties: false, required: ["ligado", "intensidade"], properties: { ligado: booleano, intensidade: enumDe(["suave", "media", "forte"]) } },
      textos: { type: "object", additionalProperties: false, required: ["gancho", "chamada", "nome"], properties: { gancho: texto, chamada: texto, nome: texto } },
      motion: { type: "object", additionalProperties: false, required: ["ligado", "densidade"], properties: { ligado: booleano, densidade: enumDe(["poucas", "medias"]) } },
      broll: { type: "object", additionalProperties: false, required: ["ligado", "maximo"], properties: { ligado: booleano, maximo: { type: "number" } } },
      musica: { type: "object", additionalProperties: false, required: ["ligado", "fonte"], properties: { ligado: booleano, fonte: texto } },
      sons: { type: "object", additionalProperties: false, required: ["ligado", "modo"], properties: { ligado: booleano, modo: enumDe(["casados", "poucos"]) } },
      transicoes: { type: "object", additionalProperties: false, required: ["ligado", "tipo"], properties: { ligado: booleano, tipo: enumDe(TRANSICOES_DO_PLANO) } },
      cor: { type: "object", additionalProperties: false, required: ["look", "intensidade"], properties: { look: enumDe(LOOKS_DO_PLANO), intensidade: { type: "number" } } },
      capitulos: booleano,
      virais: booleano,
      logo: enumDe(["nenhum", "canto", "sting", "cartao_final"]),
      cartao_final: { type: "object", additionalProperties: false, required: ["ligado", "titulo", "botao"], properties: { ligado: booleano, titulo: texto, botao: texto } },
    },
  },
};

/** Princípio da casa (02/10, dono): o vídeo SEMPRE engaja; o setor do cliente nunca deixa a edição tímida. */
export const PRINCIPIO_DO_ENGAJAMENTO = [
  "Engajamento sempre: o estilo é escolhido para prender e reter, nunca pelo setor ou pela profissão do cliente (advogado, médico, contador e qualquer outro recebem edição tão viva quanto a de um criador).",
  "Gancho nos 2 primeiros segundos, nenhum trecho de mais de 4 s sem mudança visual, ritmo que varia, motion graphics com energia nas palavras-chave, texto grande e cinético nas frases-chave, efeito sonoro nos acentos, B-roll ou metáfora visual quando houver, e chamada no fim.",
  "A identidade da marca (letra, cores, logo) é respeitada; o tom e a energia nunca são baixados por causa da profissão. Regras de conteúdo valem (nada de promessa ou garantia de resultado que não foi dita), mas sem timidez visual.",
].join(" ");

export function sistemaDoPlano(): string {
  return [
    "Você é o diretor de edição da Aceleriq. Recebe o pedido do dono e um resumo do vídeo e devolve UM plano de edição no JSON pedido.",
    PRINCIPIO_DO_ENGAJAMENTO,
    "O pedido do dono é lei: o que ele pediu para não ter (sem legenda, sem música, sem zoom) fica desligado, e o que ele pediu entra.",
    "Você não edita: escolhe peças e opções. Quem corta, mede tempo e põe na linha do tempo é o código.",
    "Regras: português do Brasil, frases curtas, sem travessão. A fala gravada manda: nada de número, preço, prazo, nome ou promessa que não esteja na fala.",
    "gancho: até 8 palavras, tirado do que foi dito, para os 3 primeiros segundos (vazio se a fala não der um gancho). chamada: até 5 palavras (ex.: comente, chame no direct), só se fizer sentido. nome: \"Nome | cargo\" só se a fala disser quem é; senão vazio.",
    "cartao_final.titulo: a promessa da marca em até 6 palavras (sem número inventado); botao: a ação (ex.: Fale com a gente).",
    "musica.fonte: o nome exato de uma das músicas listadas, ou vazio. formato: \"manter\" se o dono não pediu outro. virais e capitulos só para vídeo longo (mais de 90 s) ou se o dono pediu.",
    "Escolha a receita pelo PEDIDO (dinamico para pessoa falando para a câmera, mesmo de profissão séria; institucional, depoimento ou aula só se o dono pedir esse tom) e ajuste as peças ao que o dono disse (o que ele pediu para não ter, desligue).",
    "resumo: 2 frases com o que o plano faz, para o dono ler antes de confirmar.",
  ].join("\n");
}

export interface ResumoParaOPlano {
  titulo: string;
  duracao_s: number;
  formato: string;
  fala: string;
  musicas: string[];
  tem_onda: boolean;
  tem_rosto: boolean;
  marca: string | null;
  acervo: number;
}

export function pedidoDoPlano(instrucao: string, r: ResumoParaOPlano): string {
  return [
    `Pedido do dono: ${curto(instrucao, 1500) || "Edite do jeito da casa."}`,
    "",
    `Vídeo: "${curto(r.titulo, 120)}", ${Math.round(r.duracao_s)} s, formato ${r.formato}.`,
    `Marca: ${r.marca || "sem marca aberta"}. Vídeos no acervo do cliente: ${r.acervo}.`,
    `Músicas na Mídia do projeto: ${r.musicas.length ? r.musicas.map((m) => `"${m}"`).join(", ") : "nenhuma"}.`,
    `Onda medida: ${r.tem_onda ? "sim" : "não"}. Rosto rastreado: ${r.tem_rosto ? "sim" : "não"}.`,
    "",
    `Fala (pode estar cortada): ${curto(r.fala, 9000) || "sem fala marcada"}`,
  ].join("\n");
}

/**
 * Custo do plano ANTES (a tela mostra e a função confere com a MESMA conta):
 * entrada pelo tamanho do pedido, saída fixa (mais com raciocínio). Arredonda
 * para cima (o mostrado nunca fica abaixo do conferido).
 */
export function estimativaDoPlanoUsd(precoEntrada1m: number | null, precoSaida1m: number | null, caracteres: number, comRaciocinio: boolean): number {
  const entrada = Math.ceil(Math.max(0, caracteres) / 3.5) + 600;
  const saida = comRaciocinio ? 5000 : 1800;
  return Math.ceil((((Number(precoEntrada1m) || 0) * entrada + (Number(precoSaida1m) || 0) * saida) / 1e6) * 10000) / 10000;
}

/**
 * O plano com o pedido do dono por cima (02/10, "instruções são lei"): o que
 * ele negou desliga, o que pediu liga, "só cortes" desliga o resto, e as
 * opções da legenda (grande, no meio, N palavras) entram. Devolve também a
 * lista do que ficou de fora por causa do pedido (vai no relatório).
 */
export function planoComPedido(plano: PlanoDaEdicao, pedido: PedidoDoDono | null | undefined): { plano: PlanoDaEdicao; fora: string[] } {
  if (!pedido) return { plano, fora: [] };
  const p: PlanoDaEdicao = copia(plano);
  const fora: string[] = [];
  const nega = (peca: PecaDoPedido, desligar: () => void) => {
    if (pecaPermitida(pedido, peca)) return;
    desligar();
    const m = motivoDoPedido(pedido, peca);
    if (m) fora.push(m);
  };
  nega("legenda", () => (p.legenda.ligado = false));
  nega("musica", () => (p.musica = { ligado: false, fonte: "" }));
  nega("zoom", () => (p.zoom.ligado = false));
  nega("cortes", () => {
    p.cortar_pausas = false;
    p.cortar_erros = false;
  });
  nega("motion", () => (p.motion.ligado = false));
  nega("textos", () => (p.textos = { gancho: "", chamada: "", nome: "" }));
  nega("broll", () => (p.broll = { ligado: false, maximo: 0 }));
  nega("sons", () => (p.sons.ligado = false));
  nega("transicoes", () => (p.transicoes.ligado = false));
  nega("cor", () => (p.cor = { look: "natural", intensidade: 1 }));
  nega("logo", () => (p.logo = "nenhum"));
  nega("cartao_final", () => (p.cartao_final.ligado = false));
  const quer = (peca: PecaDoPedido) => pedido.com.indexOf(peca) >= 0;
  if (quer("legenda")) p.legenda.ligado = true;
  if (quer("zoom")) p.zoom.ligado = true;
  if (quer("motion")) p.motion.ligado = true;
  if (quer("sons")) p.sons.ligado = true;
  if (quer("transicoes")) p.transicoes.ligado = true;
  if (quer("cartao_final")) p.cartao_final.ligado = true;
  if (quer("broll")) p.broll = { ligado: true, maximo: Math.max(2, p.broll.maximo) };
  if (quer("cortes")) p.cortar_pausas = true;
  if (pedido.legenda.tamanho === "grande") p.legenda.estilo = "gigante";
  if (pedido.legenda.tamanho === "pequena") p.legenda.estilo = "discreta";
  if (pedido.legenda.posicao) p.legenda.posicao = pedido.legenda.posicao;
  if (pedido.legenda.palavras) p.legenda.palavras = pedido.legenda.palavras;
  return { plano: p, fora };
}

export { ROTULO_DA_PECA };

/** Linhas do plano para o dono ler (a tela mostra antes de montar). */
export function linhasDoPlano(p: PlanoDaEdicao): string[] {
  const l: string[] = [];
  if (p.cortar_erros) l.push("Tirar erros, repetições e falsos começos");
  if (p.cortar_pausas) l.push("Tirar pausas e respiros longos");
  if (p.formato !== "manter") l.push(`Reenquadrar para ${p.formato}${p.seguir_rosto ? " seguindo o rosto" : ""}`);
  if (p.legenda.ligado) l.push(`Legenda ${p.legenda.estilo}, ${p.legenda.palavras} ${p.legenda.palavras === 1 ? "palavra" : "palavras"} por vez`);
  if (p.zoom.ligado) l.push(`Zoom ${p.zoom.intensidade} nos momentos fortes`);
  if (p.textos.gancho) l.push(`Gancho: "${p.textos.gancho}"`);
  if (p.textos.nome) l.push(`Nome na tela: ${p.textos.nome}`);
  if (p.textos.chamada) l.push(`Chamada: "${p.textos.chamada}"`);
  if (p.motion.ligado) l.push(`Animações ${p.motion.densidade === "poucas" ? "poucas" : "no ritmo"} (lista, contador, preço...)`);
  if (p.broll.ligado && p.broll.maximo > 0) l.push(`Até ${p.broll.maximo} B-rolls do acervo`);
  if (p.musica.ligado) l.push(`Música "${p.musica.fonte}" abaixo da voz`);
  if (p.sons.ligado) l.push("Efeitos sonoros nas animações");
  if (p.transicoes.ligado) l.push(`Transição ${p.transicoes.tipo} na troca de plano`);
  if (p.cor.look !== "natural") l.push(`Cor: look ${p.cor.look}`);
  if (p.capitulos) l.push("Capítulos");
  if (p.virais) l.push("Momentos virais marcados");
  if (p.logo !== "nenhum") l.push(`Logo: ${p.logo.replace("_", " ")}`);
  if (p.cartao_final.ligado) l.push("Cartão final com a chamada");
  return l;
}
