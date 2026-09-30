/**
 * Contexto completo da marca: as regras puras (frente SYNC, 30/09/2026).
 *
 * Pedido do dono: "tudo puxa o contexto completo das marcas, tudo é
 * sincronizado 100%, e aprende e evolui também, mesma lógica".
 *
 * Aqui mora o que não depende do banco, para a tela e o servidor usarem o
 * MESMO arquivo (a leitura fica em contexto-completo-da-marca.ts):
 * - o pacote da marca aberta (kit, contexto, estratégia da Mesa Identidade,
 *   briefing mais novo, dossiê, decisões do conselho, cérebro, Instagram,
 *   referências e acervo) e o bloco pronto para o prompt, por área, sempre
 *   dentro de um teto de tamanho;
 * - a linha "Usando: ..." que a mesa mostra para o dono ver o que o agente
 *   leu;
 * - a marca de uma linha do cérebro e se ela vale na marca aberta (regra
 *   da herança: a marca que não é a principal só usa o que é dela);
 * - a estratégia aprovada virando contexto da marca (sugestão com
 *   Confirmar e Desfazer na Mesa Identidade).
 *
 * Só importa arquivo puro. Sem lookbehind, sem \p{} e sem grupo nomeado
 * (Safari 11). Sem travessão.
 */

import { estrategiaParaBrandbook, normalizarEstrategia } from "./estrategia-de-marca.ts";

// ------------------------------------------------------------------ vocabulário

export const PARTES_DO_CONTEXTO = ["marca", "kit", "contexto", "estrategia", "briefing", "dossie", "decisoes", "cerebro", "instagram", "referencias"] as const;
export type ParteDoContexto = (typeof PARTES_DO_CONTEXTO)[number];

/**
 * Partes que completam quem já lê o kit e o contexto por conta própria (o
 * leitor antigo do cérebro e do dossiê, contexto-do-agente.ts). Sem kit e
 * sem contexto para não repetir no prompt o que a função já põe.
 */
export const PARTES_COMPLEMENTARES: ParteDoContexto[] = ["marca", "estrategia", "briefing", "dossie", "decisoes", "cerebro", "instagram"];

/** Área do trabalho: decide a ordem das partes, as áreas do cérebro e o teto. */
export const AREAS_DO_CONTEXTO = ["geral", "arte", "foto", "video", "copy", "calendario", "campanha", "ads", "comercial", "site", "identidade", "documento", "contrato"] as const;
export type AreaDoContexto = (typeof AREAS_DO_CONTEXTO)[number];

export function ehAreaDoContexto(v: unknown): v is AreaDoContexto {
  return typeof v === "string" && (AREAS_DO_CONTEXTO as readonly string[]).indexOf(v) >= 0;
}

/** Áreas do cérebro (as fixas do banco) que cada área lê; a "geral" entra sempre. */
export const CEREBRO_DA_AREA: Record<AreaDoContexto, string[]> = {
  geral: ["geral", "calendario", "campanha", "copy", "arte"],
  arte: ["arte", "foto"],
  foto: ["foto", "arte"],
  video: ["arte", "copy"],
  copy: ["copy", "campanha"],
  calendario: ["calendario", "campanha", "copy"],
  campanha: ["campanha", "copy", "arte"],
  ads: ["ads", "conta", "campanha"],
  comercial: ["copy", "campanha"],
  site: ["arte", "copy"],
  identidade: ["arte", "copy"],
  documento: ["copy", "campanha", "arte"],
  contrato: ["conta"],
};

/** Teto padrão do bloco por área (caracteres). */
export const TETO_DA_AREA: Record<AreaDoContexto, number> = {
  geral: 6000,
  arte: 6000,
  foto: 5000,
  video: 6000,
  copy: 7000,
  calendario: 7000,
  campanha: 7000,
  ads: 6000,
  comercial: 8000,
  site: 8000,
  identidade: 8000,
  documento: 6000,
  contrato: 4000,
};
export const TETO_MINIMO_DO_CONTEXTO = 600;
export const TETO_MAXIMO_DO_CONTEXTO = 16_000;

/** A ordem das partes: o que mais pesa no trabalho da área vem antes (e ganha o espaço que sobrar). */
export const ORDEM_DA_AREA: Record<AreaDoContexto, ParteDoContexto[]> = {
  geral: ["marca", "contexto", "estrategia", "briefing", "decisoes", "cerebro", "dossie", "kit", "instagram", "referencias"],
  arte: ["marca", "kit", "estrategia", "cerebro", "contexto", "briefing", "referencias", "decisoes", "dossie", "instagram"],
  foto: ["marca", "kit", "cerebro", "estrategia", "contexto", "referencias", "briefing", "decisoes", "dossie", "instagram"],
  video: ["marca", "estrategia", "contexto", "cerebro", "briefing", "kit", "decisoes", "dossie", "referencias", "instagram"],
  copy: ["marca", "estrategia", "contexto", "cerebro", "briefing", "decisoes", "dossie", "instagram", "kit", "referencias"],
  calendario: ["marca", "estrategia", "contexto", "cerebro", "briefing", "decisoes", "instagram", "dossie", "kit", "referencias"],
  campanha: ["marca", "estrategia", "contexto", "cerebro", "briefing", "decisoes", "dossie", "kit", "instagram", "referencias"],
  ads: ["marca", "contexto", "estrategia", "cerebro", "decisoes", "instagram", "briefing", "dossie", "kit", "referencias"],
  comercial: ["marca", "contexto", "estrategia", "briefing", "decisoes", "dossie", "cerebro", "instagram", "kit", "referencias"],
  site: ["marca", "estrategia", "contexto", "kit", "briefing", "cerebro", "decisoes", "dossie", "referencias", "instagram"],
  identidade: ["marca", "estrategia", "contexto", "briefing", "kit", "cerebro", "referencias", "decisoes", "dossie", "instagram"],
  documento: ["marca", "contexto", "estrategia", "decisoes", "dossie", "briefing", "cerebro", "kit", "instagram", "referencias"],
  contrato: ["marca", "contexto", "decisoes", "briefing", "cerebro", "dossie", "estrategia", "kit", "instagram", "referencias"],
};

/** Parte do teto que cada parte recebe de saída (o que sobra passa adiante na ordem da área). */
const PESO: Record<ParteDoContexto, number> = {
  marca: 0.06,
  kit: 0.1,
  contexto: 0.14,
  estrategia: 0.14,
  briefing: 0.12,
  dossie: 0.14,
  decisoes: 0.07,
  cerebro: 0.15,
  instagram: 0.03,
  referencias: 0.05,
};

// ------------------------------------------------------------------ o pacote

export type MarcaDoPacote = { id: string; nome: string; principal: boolean; outras: string[] };

export type EstrategiaDoPacote = {
  projeto_id: string;
  titulo: string;
  /** Versão do projeto da Mesa Identidade quando a estratégia foi lida. */
  versao: number;
  /** A etapa Estratégia foi concluída (aprovada pela equipe) no projeto. */
  aprovada: boolean;
  atualizado_em: string | null;
  /** A estratégia normalizada (estrategia-de-marca.ts). */
  estrategia: Record<string, unknown>;
  /** Tagline ou slogan escolhido no Naming do projeto. */
  tagline: string | null;
  /** Nome escolhido no Naming (marca do zero), quando há. */
  nome: string | null;
};

export type BriefingDoPacote = { id: string | null; titulo: string | null; data: string | null; enviado: boolean; linhas: string[] };
export type DecisaoDoPacote = { id: string; titulo: string; resumo: string; data: string | null };

export type PacoteDaMarca = {
  clientId: string;
  nomeCliente: string;
  /** null: cliente de uma marca só (vale o dado do cliente). */
  marca: MarcaDoPacote | null;
  kit: { paleta: string[]; estilo: string | null; regras: string | null; fontes: string[]; temLogo: boolean } | null;
  /** Contexto consolidado com a marca por cima (regra da herança). */
  contexto: Record<string, unknown>;
  estrategia: EstrategiaDoPacote | null;
  briefing: BriefingDoPacote | null;
  dossie: { texto: string; data: string | null } | null;
  /** Resumo do cérebro já filtrado pela marca e pelas áreas pedidas. */
  cerebro: { texto: string; regras: number; fatos: number } | null;
  decisoes: DecisaoDoPacote[];
  instagram: { contas: string[]; seguidores: number | null; alcance: number | null; semana: string | null } | null;
  referencias: { referencias: number; acervo: number; categorias: Record<string, number> } | null;
  /** Partes que não foram lidas (falha de banco). Vão para o log e para a linha "Usando". */
  avisos: string[];
  lido_em: string;
};

export function pacoteVazio(clientId: string, nomeCliente = "cliente"): PacoteDaMarca {
  return {
    clientId,
    nomeCliente,
    marca: null,
    kit: null,
    contexto: {},
    estrategia: null,
    briefing: null,
    dossie: null,
    cerebro: null,
    decisoes: [],
    instagram: null,
    referencias: null,
    avisos: [],
    lido_em: new Date(0).toISOString(),
  };
}

// ------------------------------------------------------------------ utilitários

const limpa = (v: unknown, max = 600): string => {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

const preenchido = (v: unknown): boolean => {
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.some(preenchido);
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>).some((k) => preenchido((v as Record<string, unknown>)[k]));
  return true;
};

/** "2026-09-28T..." vira "28/09". Sem data válida, "". */
export function dataCurta(iso: string | null | undefined): string {
  return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "";
}

/** Corta um texto no teto em linha inteira quando dá (nunca passa do teto). */
export function cortarNoTeto(texto: string, teto: number): string {
  const t = String(texto || "");
  if (t.length <= teto) return t;
  if (teto <= 1) return "";
  const corte = t.slice(0, teto - 1);
  const fim = corte.lastIndexOf("\n");
  const base = fim > teto * 0.5 ? corte.slice(0, fim) : corte;
  return `${base.trimEnd()}…`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ------------------------------------------------------------------ cérebro por marca

/** Começo do texto da decisão do conselho guardada no cérebro (sincronia-entre-mesas.ts). */
export const PREFIXO_DA_DECISAO_DO_CONSELHO = "Decisão do conselho";

/** O fato do cérebro é uma decisão do conselho? (no pacote ela já vem na parte "decisões"). */
export function ehDecisaoDoConselho(texto: unknown): boolean {
  return String(texto || "").indexOf(PREFIXO_DA_DECISAO_DO_CONSELHO) === 0;
}

/**
 * A marca em que uma linha do cérebro foi aprendida: "marca:<id>" na
 * evidência (mesas de mídia e conselho) ou o referencia_id quando ele é uma
 * marca do cliente (agentes da Mesa do cliente). Sem marca: null.
 */
export function marcaDaLinhaDoCerebro(evidencia: unknown, referenciaId: unknown, idsDasMarcas: string[]): string | null {
  const m = /marca:([0-9a-f-]{36})/i.exec(String(evidencia || ""));
  if (m) return m[1].toLowerCase();
  const r = typeof referenciaId === "string" ? referenciaId.toLowerCase() : "";
  if (r && UUID.test(r) && idsDasMarcas.map((x) => String(x).toLowerCase()).indexOf(r) >= 0) return r;
  return null;
}

/**
 * A linha do cérebro vale na marca aberta? Regra da herança:
 * - sem marca aberta (cliente de uma marca só): vale tudo;
 * - principal: vale a sem marca (do cliente) e a dela;
 * - outra marca: SÓ a dela (nunca a do cliente, nunca a de outra marca).
 */
export function linhaDoCerebroValeNaMarca(marcaDaLinha: string | null, marca: { id: string; principal: boolean } | null): boolean {
  if (!marca) return true;
  const minha = String(marca.id).toLowerCase();
  if (marca.principal) return !marcaDaLinha || marcaDaLinha === minha;
  return marcaDaLinha === minha;
}

// ------------------------------------------------------------------ estratégia

/** A etapa Estratégia foi concluída no projeto (é o "aprovada" da Mesa Identidade). */
export function estrategiaAprovada(concluidas: unknown): boolean {
  return Array.isArray(concluidas) && concluidas.map(String).indexOf("estrategia") >= 0;
}

/** A estratégia tem conteúdo que vale ler? */
export function estrategiaTemConteudo(bruto: unknown): boolean {
  return !!estrategiaParaBrandbook(bruto, "a marca");
}

/** Linhas curtas da estratégia para o prompt (plataforma, posicionamento, promessa, público e tom). */
export function linhasDaEstrategia(e: EstrategiaDoPacote, nomeDaMarca: string): string[] {
  const b = estrategiaParaBrandbook(e.estrategia, nomeDaMarca);
  const linhas: string[] = [];
  if (e.nome) linhas.push(`Nome escolhido: ${limpa(e.nome, 80)}`);
  if (e.tagline) linhas.push(`Tagline: ${limpa(e.tagline, 140)}`);
  if (!b) return linhas;
  if (b.posicionamento) linhas.push(`Posicionamento: ${limpa(b.posicionamento, 500)}`);
  if (b.promessa) linhas.push(`Promessa: ${limpa(b.promessa, 300)}`);
  if (b.proposito) linhas.push(`Propósito: ${limpa(b.proposito, 300)}`);
  if (b.publico) linhas.push(`Público: ${limpa(b.publico, 400)}`);
  if (b.arquetipo) linhas.push(`Arquétipo: ${limpa(b.arquetipo, 80)}`);
  if (b.valores.length) linhas.push(`Valores: ${limpa(b.valores.join("; "), 400)}`);
  if (b.personalidade.length) linhas.push(`Personalidade: ${limpa(b.personalidade.join(", "), 200)}`);
  if (b.como_fala.length) linhas.push(`Fala assim: ${limpa(b.como_fala.join(" | "), 500)}`);
  if (b.como_nao_fala.length) linhas.push(`Não fala assim: ${limpa(b.como_nao_fala.join(" | "), 400)}`);
  if (b.missao) linhas.push(`Missão: ${limpa(b.missao, 300)}`);
  return linhas;
}

/**
 * O que a estratégia aprovada leva ao contexto da marca (negócio, público,
 * oferta, diferenciais, tom, posicionamento e tagline). Só campos com
 * conteúdo; a Mesa Identidade propõe como sugestão com Confirmar, e o
 * Desfazer volta o valor de antes, campo a campo.
 */
export function contextoDaEstrategia(bruto: unknown, extra: { tagline?: string | null; nomeDaMarca?: string | null } = {}): Record<string, unknown> {
  const e = normalizarEstrategia(bruto);
  const b = estrategiaParaBrandbook(bruto, extra.nomeDaMarca || "a marca");
  const saida: Record<string, unknown> = {};
  if (b && b.posicionamento) saida.posicionamento = limpa(b.posicionamento, 600);
  if (e.posicionamento.categoria) saida.negocio = limpa(e.posicionamento.categoria, 300);
  const publico = e.publico.resumo || e.posicionamento.publico;
  if (publico) saida.publico = limpa(publico, 600);
  if (e.proposta_de_valor.promessa) saida.oferta = limpa(e.proposta_de_valor.promessa, 400);
  const diferenciais = [e.posicionamento.diferencial].concat(e.proposta_de_valor.ganhos).map((x) => limpa(x, 200)).filter(Boolean);
  if (diferenciais.length) saida.diferenciais = diferenciais.filter((x, i) => diferenciais.indexOf(x) === i).slice(0, 6);
  const tom = e.tom.atributos.length ? e.tom.atributos.join(", ") : e.personalidade.tracos.join(", ");
  const fala = e.tom.fala_assim.slice(0, 2).join(" | ");
  const tomDeVoz = [tom, fala ? `fala assim: ${fala}` : ""].filter(Boolean).join("; ");
  if (tomDeVoz) saida.tom_de_voz = limpa(tomDeVoz, 400);
  if (extra.tagline && limpa(extra.tagline)) saida.tagline = limpa(extra.tagline, 140);
  return saida;
}

/** Campo a campo, o que muda no contexto (vazio no destino ou diferente). Sem mudança, objeto vazio. */
export function mudancasNoContexto(atual: Record<string, unknown> | null | undefined, proposta: Record<string, unknown>): Record<string, unknown> {
  const a = atual && typeof atual === "object" ? atual : {};
  const saida: Record<string, unknown> = {};
  for (const k of Object.keys(proposta)) {
    if (!preenchido(proposta[k])) continue;
    if (JSON.stringify(a[k] ?? null) !== JSON.stringify(proposta[k])) saida[k] = proposta[k];
  }
  return saida;
}

/** Aplica os campos no contexto e devolve o novo e o "antes" de cada campo (null = não existia). */
export function aplicarNoContexto(atual: Record<string, unknown> | null | undefined, campos: Record<string, unknown>): { contexto: Record<string, unknown>; antes: Record<string, unknown> } {
  const contexto: Record<string, unknown> = { ...(atual && typeof atual === "object" ? atual : {}) };
  const antes: Record<string, unknown> = {};
  for (const k of Object.keys(campos)) {
    antes[k] = Object.prototype.hasOwnProperty.call(contexto, k) ? contexto[k] : null;
    contexto[k] = campos[k];
  }
  return { contexto, antes };
}

/** Desfazer do aplicarNoContexto: volta cada campo ao de antes (null apaga o campo). */
export function reverterNoContexto(atual: Record<string, unknown> | null | undefined, antes: Record<string, unknown>): Record<string, unknown> {
  const contexto: Record<string, unknown> = { ...(atual && typeof atual === "object" ? atual : {}) };
  for (const k of Object.keys(antes || {})) {
    if (antes[k] == null) delete contexto[k];
    else contexto[k] = antes[k];
  }
  return contexto;
}

// ------------------------------------------------------------------ seções do bloco

const ROTULOS_DO_CONTEXTO: Array<[string, string]> = [
  ["negocio", "Negócio"],
  ["publico", "Público"],
  ["oferta", "Oferta"],
  ["diferenciais", "Diferenciais"],
  ["tom_de_voz", "Tom de voz"],
  ["posicionamento", "Posicionamento"],
  ["tagline", "Tagline"],
];

function valorEmTexto(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(valorEmTexto).filter(Boolean).join("; ");
  if (typeof v === "object") {
    return Object.keys(v as Record<string, unknown>)
      .map((k) => {
        const x = valorEmTexto((v as Record<string, unknown>)[k]);
        return x ? `${k.replace(/_/g, " ")}: ${x}` : "";
      })
      .filter(Boolean)
      .join("; ");
  }
  return String(v);
}

function linhasDoContexto(c: Record<string, unknown>): string[] {
  const linhas: string[] = [];
  const usados: Record<string, true> = { fontes_lidas: true, lacunas: true, marca: true, atualizado_por_sincronia: true };
  for (const [k, rotulo] of ROTULOS_DO_CONTEXTO) {
    usados[k] = true;
    const t = limpa(valorEmTexto(c[k]), 700);
    if (t) linhas.push(`${rotulo}: ${t}`);
  }
  for (const k of Object.keys(c)) {
    if (usados[k]) continue;
    const t = limpa(valorEmTexto(c[k]), 400);
    if (t) linhas.push(`${k.replace(/_/g, " ")}: ${t}`);
  }
  const extra = c.marca && typeof c.marca === "object" ? (c.marca as Record<string, unknown>).contexto_extra : null;
  if (typeof extra === "string" && extra.trim()) linhas.push(`Sobre a marca: ${limpa(extra, 1500)}`);
  return linhas;
}

const nomeDaMarcaAberta = (p: PacoteDaMarca) => (p.marca ? p.marca.nome : p.nomeCliente) || "a marca";

/** O texto de uma parte do pacote, com o título. Parte vazia: "". */
export function secaoDoPacote(p: PacoteDaMarca, parte: ParteDoContexto): string {
  switch (parte) {
    case "marca": {
      if (!p.marca) return `CLIENTE: ${limpa(p.nomeCliente, 120)}.`;
      const outras = p.marca.outras.filter((n) => n && n !== p.marca!.nome);
      return [
        `MARCA DESTE TRABALHO: ${p.marca.nome}${p.marca.principal ? " (marca principal do cliente)" : " (marca própria dentro do cliente, com projeto, logo e identidade separados)"}.`,
        "Use só o contexto, a logo, as cores, as referências e o tom desta marca.",
        outras.length ? `Não misture com ${outras.length === 1 ? "a outra marca do cliente" : "as outras marcas do cliente"}: ${outras.join(", ")}.` : "",
      ].filter(Boolean).join("\n");
    }
    case "kit": {
      const k = p.kit;
      if (!k) return "";
      const linhas = [
        k.paleta.length ? `Paleta: ${limpa(k.paleta.join(", "), 400)}` : "",
        k.fontes.length ? `Fontes: ${limpa(k.fontes.join(", "), 200)}` : "",
        k.estilo ? `Estilo: ${limpa(k.estilo, 600)}` : "",
        k.regras ? `Regras da marca: ${limpa(k.regras, 800)}` : "",
        `Logo no kit: ${k.temLogo ? "sim (entra pelo código, nunca pelo gerador)" : "não cadastrada"}`,
      ].filter(Boolean);
      return linhas.length ? `KIT DA MARCA\n${linhas.join("\n")}` : "";
    }
    case "contexto": {
      const linhas = linhasDoContexto(p.contexto || {});
      return linhas.length ? `CONTEXTO DA MARCA (negócio, público, oferta, diferenciais e tom)\n${linhas.join("\n")}` : "";
    }
    case "estrategia": {
      const e = p.estrategia;
      if (!e) return "";
      const linhas = linhasDaEstrategia(e, nomeDaMarcaAberta(p));
      if (!linhas.length) return "";
      const quando = dataCurta(e.atualizado_em);
      return `ESTRATÉGIA DE MARCA (Mesa Identidade, "${limpa(e.titulo, 80)}", v${e.versao}${e.aprovada ? ", aprovada" : ", em construção"}${quando ? `, ${quando}` : ""}; o tom e a tagline valem em tudo que fala pela marca)\n${linhas.join("\n")}`;
    }
    case "briefing": {
      const b = p.briefing;
      if (!b || !b.linhas.length) return "";
      const quando = dataCurta(b.data);
      return `BRIEFING MAIS NOVO${b.titulo ? ` ("${limpa(b.titulo, 80)}")` : ""}${quando ? ` de ${quando}` : ""}${b.enviado ? ", respondido pelo cliente" : ", ainda não enviado"}\n${b.linhas.map((l) => limpa(l, 500)).join("\n")}`;
    }
    case "dossie": {
      const d = p.dossie;
      if (!d || !d.texto.trim()) return "";
      const quando = dataCurta(d.data);
      return `DOSSIÊ ATUAL${quando ? ` (${quando})` : ""} (fatos do painel; vazio não quer dizer que não existe)\n${d.texto.trim()}`;
    }
    case "decisoes": {
      if (!p.decisoes.length) return "";
      return `DECISÕES DO CONSELHO (o dono decidiu; siga, a não ser que o pedido de agora mude)\n${p.decisoes.map((d) => `- ${limpa(d.titulo, 120)}${dataCurta(d.data) ? ` (${dataCurta(d.data)})` : ""}: ${limpa(d.resumo, 500)}`).join("\n")}`;
    }
    case "cerebro": {
      const c = p.cerebro;
      return c && c.texto.trim() ? c.texto.trim() : "";
    }
    case "instagram": {
      const i = p.instagram;
      if (!i || !i.contas.length) return "";
      const numeros = [
        i.seguidores != null ? `${i.seguidores.toLocaleString("pt-BR")} seguidores` : "",
        i.alcance != null ? `alcance de ${i.alcance.toLocaleString("pt-BR")}` : "",
      ].filter(Boolean).join(", ");
      return `INSTAGRAM DA MARCA: ${i.contas.map((c) => (c.charAt(0) === "@" ? c : `@${c}`)).join(", ")}${numeros ? ` (${numeros}${i.semana ? ` na semana de ${dataCurta(i.semana)}` : ""})` : ""}.`;
    }
    case "referencias": {
      const r = p.referencias;
      if (!r || (!r.referencias && !r.acervo)) return "";
      const cats = Object.keys(r.categorias)
        .filter((k) => r.categorias[k] > 0)
        .sort((a, b) => r.categorias[b] - r.categorias[a])
        .slice(0, 6)
        .map((k) => `${k.replace(/_/g, " ")} ${r.categorias[k]}`)
        .join(", ");
      return `REFERÊNCIAS E ACERVO DA MARCA: ${r.referencias} referência(s) ativa(s); ${r.acervo} foto(s) real(is) no acervo${cats ? ` (${cats})` : ""}. Foto real e logo entram pelo código, nunca pelo gerador.`;
    }
  }
  return "";
}

export const TITULO_DO_CONTEXTO_COMPLETO =
  "CONTEXTO COMPLETO DA MARCA (fonte única do painel: vale sobre suposição sua; o que não está aqui ainda não existe, não invente; regra do dono vale sobre sugestão sua)";

export type OpcoesDoBloco = {
  area?: AreaDoContexto;
  /** Teto do bloco em caracteres (padrão: o da área). */
  teto?: number;
  /** Só estas partes (padrão: todas, na ordem da área). */
  partes?: ParteDoContexto[];
  /** Sem o título (quem chama já tem o dele). */
  semTitulo?: boolean;
};

/** Teto seguro (dentro do mínimo e do máximo). */
export function tetoDoContexto(area: AreaDoContexto, teto?: number): number {
  const t = typeof teto === "number" && isFinite(teto) ? teto : TETO_DA_AREA[area];
  return Math.min(Math.max(Math.round(t), TETO_MINIMO_DO_CONTEXTO), TETO_MAXIMO_DO_CONTEXTO);
}

/**
 * O bloco pronto para o prompt, NUNCA acima do teto. Cada parte recebe uma
 * fatia pelo peso; o que uma parte curta não usa passa para as próximas, na
 * ordem da área. Parte vazia não aparece (nem o título dela).
 */
export function montarBlocoDoPacote(p: PacoteDaMarca, opcoes: OpcoesDoBloco = {}): string {
  const area: AreaDoContexto = opcoes.area && ehAreaDoContexto(opcoes.area) ? opcoes.area : "geral";
  const teto = tetoDoContexto(area, opcoes.teto);
  const pedidas = opcoes.partes && opcoes.partes.length ? opcoes.partes : PARTES_DO_CONTEXTO.slice();
  const ordem = ORDEM_DA_AREA[area].filter((x) => pedidas.indexOf(x) >= 0);
  const textos = ordem.map((parte) => ({ parte, texto: secaoDoPacote(p, parte) })).filter((s) => s.texto);
  if (!textos.length) return "";
  const titulo = opcoes.semTitulo ? "" : TITULO_DO_CONTEXTO_COMPLETO;
  const separador = 2;
  const disponivel = teto - (titulo ? titulo.length + separador : 0) - separador * (textos.length - 1);
  if (disponivel < 100) return cortarNoTeto(titulo ? `${titulo}\n\n${textos[0].texto}` : textos[0].texto, teto);
  const somaDosPesos = textos.reduce((s, x) => s + PESO[x.parte], 0) || 1;
  // 1ª passada: cada parte até a sua fatia.
  const fatia = textos.map((x) => Math.floor((disponivel * PESO[x.parte]) / somaDosPesos));
  const usado = textos.map((x, i) => Math.min(x.texto.length, fatia[i]));
  let sobra = disponivel - usado.reduce((s, n) => s + n, 0);
  // 2ª passada: a sobra vai para quem ficou cortado, na ordem da área.
  for (let i = 0; i < textos.length && sobra > 0; i++) {
    const falta = textos[i].texto.length - usado[i];
    if (falta <= 0) continue;
    const ganho = Math.min(falta, sobra);
    usado[i] += ganho;
    sobra -= ganho;
  }
  const pecas = textos
    .map((x, i) => (usado[i] >= x.texto.length ? x.texto : usado[i] >= 40 ? cortarNoTeto(x.texto, usado[i]) : ""))
    .filter(Boolean);
  const bloco = [titulo].concat(pecas).filter(Boolean).join("\n\n");
  return cortarNoTeto(bloco, teto);
}

// ------------------------------------------------------------------ "Usando: ..."

export type ItemUsado = { parte: ParteDoContexto; rotulo: string };

/**
 * O que o agente leu, em palavras do dono, na ordem: contexto da marca,
 * briefing, estratégia, dossiê, decisões, cérebro, Instagram, referências.
 * Só entra o que tinha conteúdo (e só as partes pedidas).
 */
export function itensUsados(p: PacoteDaMarca, partes?: ParteDoContexto[]): ItemUsado[] {
  const quer = (x: ParteDoContexto) => !partes || !partes.length || partes.indexOf(x) >= 0;
  const itens: ItemUsado[] = [];
  const nome = nomeDaMarcaAberta(p);
  const temContexto = linhasDoContexto(p.contexto || {}).length > 0;
  const temKit = !!p.kit && (p.kit.paleta.length > 0 || !!p.kit.estilo || !!p.kit.regras || p.kit.fontes.length > 0 || p.kit.temLogo);
  if ((quer("contexto") && temContexto) || (quer("kit") && temKit)) {
    itens.push({ parte: temContexto ? "contexto" : "kit", rotulo: `contexto da marca ${nome}${temKit && quer("kit") ? " (com o kit)" : ""}` });
  } else if (quer("marca")) {
    itens.push({ parte: "marca", rotulo: `marca ${nome} (contexto ainda vazio)` });
  }
  if (quer("briefing") && p.briefing && p.briefing.linhas.length) {
    const d = dataCurta(p.briefing.data);
    itens.push({ parte: "briefing", rotulo: `briefing${d ? ` de ${d}` : ""}${p.briefing.enviado ? "" : " (não enviado)"}` });
  }
  if (quer("estrategia") && p.estrategia) {
    itens.push({ parte: "estrategia", rotulo: `estratégia v${p.estrategia.versao}${p.estrategia.aprovada ? " aprovada" : " em construção"}${p.estrategia.tagline ? " com tagline" : ""}` });
  }
  if (quer("dossie") && p.dossie && p.dossie.texto.trim()) {
    const d = dataCurta(p.dossie.data);
    itens.push({ parte: "dossie", rotulo: `dossiê${d ? ` de ${d}` : ""}` });
  }
  if (quer("decisoes") && p.decisoes.length) {
    itens.push({ parte: "decisoes", rotulo: `${p.decisoes.length} decisão(ões) do conselho` });
  }
  if (quer("cerebro") && p.cerebro && p.cerebro.texto.trim()) {
    itens.push({ parte: "cerebro", rotulo: p.cerebro.regras ? `cérebro (${p.cerebro.regras} regra(s) ensinada(s))` : "cérebro do cliente" });
  }
  if (quer("instagram") && p.instagram && p.instagram.contas.length) {
    itens.push({ parte: "instagram", rotulo: `Instagram ${p.instagram.contas.map((c) => (c.charAt(0) === "@" ? c : `@${c}`)).join(", ")}` });
  }
  if (quer("referencias") && p.referencias && (p.referencias.referencias || p.referencias.acervo)) {
    itens.push({ parte: "referencias", rotulo: `${p.referencias.referencias} referência(s) e ${p.referencias.acervo} foto(s) do acervo` });
  }
  return itens;
}

/** "Usando: contexto da marca CME, briefing de 28/09, estratégia v3 aprovada." (vazio: "Sem contexto da marca ainda.") */
export function linhaDoUsando(itens: ItemUsado[], avisos: string[] = []): string {
  const base = itens.length ? `Usando: ${itens.map((i) => i.rotulo).join(", ")}.` : "Sem contexto da marca ainda.";
  return avisos.length ? `${base} Não deu para ler: ${avisos.slice(0, 4).join(", ")}.` : base;
}
