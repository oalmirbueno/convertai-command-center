/**
 * Briefing, segunda leva (frente BRF2, 30/09/2026): as regras puras do
 * editor de modelos, das perguntas extras por projeto, do painel (pendentes,
 * vencendo, recebidos), do lembrete com mensagem pronta e da comparação de
 * dois briefings.
 *
 * - Editor: o dono muda as perguntas na tela e salva uma VERSÃO NOVA
 *   (briefing_modelos). Cada link guarda a cópia do modelo com que nasceu,
 *   então mudar nunca quebra briefing antigo. A condicional só aponta para
 *   uma pergunta de escolha que vem antes (senão sai, com aviso).
 * - Perguntas extras: entram num bloco próprio no fim da cópia do link, com
 *   chave começando por "extra_" (nunca colidem com as do modelo).
 * - Painel e lembrete: a mesma régua que o banco usa no aviso diário
 *   (briefing_lembretes_do_dia, migration 20260930196000).
 *
 * Puro: sem Deno e sem npm (a tela, a Edge Function e os testes leem o mesmo
 * arquivo). Compatível com Safari 11. Texto nosso, sem travessão.
 */

import {
  type AnexoDoBriefing,
  type BlocoDoBriefing,
  type CampoDoBriefing,
  camposDoModelo,
  campoVisivel,
  estadoDoLink,
  MODELOS_DE_FABRICA,
  type ModeloDeBriefing,
  normalizarModelo,
  type Respostas,
  type SlugDoModelo,
  textoDaResposta,
} from "./briefing-modelos.ts";

// ------------------------------------------------------------------ editor de modelos

export type LinhaDeVersao = { slug: string; versao: number };

/** A próxima versão de um modelo: acima da de fábrica e de todas as do banco. */
export function proximaVersao(slug: SlugDoModelo, linhas: LinhaDeVersao[] | null | undefined): number {
  let maior = MODELOS_DE_FABRICA[slug].versao;
  (linhas || []).forEach((l) => {
    if (l && l.slug === slug && Number(l.versao) > maior) maior = Number(l.versao);
  });
  return maior + 1;
}

const TIPOS_QUE_ABREM = ["single-chip", "multi-chip"];

/**
 * Confere o modelo editado antes de virar versão nova. Devolve o modelo
 * limpo e os avisos (o que saiu e por quê). Lança Error com a frase para a
 * tela quando não sobra pergunta nenhuma.
 */
export function validarModeloEditado(bruto: unknown, slug: SlugDoModelo): { modelo: ModeloDeBriefing; avisos: string[] } {
  const avisos: string[] = [];
  const brutoObj = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const blocosBrutos = Array.isArray(brutoObj.blocos) ? brutoObj.blocos : [];
  let camposNoPedido = 0;
  blocosBrutos.forEach((b) => {
    const campos = b && typeof b === "object" ? (b as Record<string, unknown>).campos : null;
    if (Array.isArray(campos)) camposNoPedido += campos.length;
  });
  const m = normalizarModelo({ ...brutoObj, slug }, slug);
  if (!m) throw new Error("O modelo ficou sem nenhuma pergunta válida. Cada pergunta precisa de chave, tipo e texto; escolha precisa de duas opções.");
  const total = camposDoModelo(m).length;
  if (total < camposNoPedido) avisos.push(`${camposNoPedido - total} ${camposNoPedido - total === 1 ? "pergunta saiu" : "perguntas saíram"} por estar incompleta ou com chave repetida.`);
  // Condicional: só para uma pergunta de escolha que aparece antes, com um valor que existe.
  const vistas: CampoDoBriefing[] = [];
  m.blocos.forEach((bl) => {
    bl.campos.forEach((c) => {
      if (c.mostrarSe) {
        const alvo = vistas.find((v) => v.key === c.mostrarSe!.key);
        const opcoes = alvo ? (alvo.opcoes || []).concat(alvo.outro ? ["Outro"] : []) : [];
        const valores = Array.isArray(c.mostrarSe.valor) ? c.mostrarSe.valor : [c.mostrarSe.valor];
        const ok = !!alvo && TIPOS_QUE_ABREM.indexOf(alvo.tipo) >= 0 && valores.every((v) => opcoes.indexOf(v) >= 0);
        if (!ok) {
          delete c.mostrarSe;
          avisos.push(`"${c.pergunta.slice(0, 60)}" perdeu a condição: ela precisa apontar para uma pergunta de escolha que vem antes, com uma opção que existe.`);
        }
      }
      vistas.push(c);
    });
  });
  return { modelo: m, avisos };
}

/** Chave nova a partir do texto da pergunta (sem acento, camelCase, única). */
export function chaveNova(pergunta: string, existentes: string[], prefixo = ""): string {
  const palavras = String(pergunta || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 2)
    .slice(0, 4);
  let base = palavras.map((p, i) => (i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())).join("") || "pergunta";
  if (/^[0-9]/.test(base)) base = `p${base}`;
  base = `${prefixo}${prefixo ? base.charAt(0).toUpperCase() + base.slice(1) : base}`.slice(0, 40);
  let chave = base;
  let n = 2;
  while (existentes.indexOf(chave) >= 0) chave = `${base}${n++}`;
  return chave;
}

/** Move um item de uma lista (arrastar e soltar ou setas). */
export function moverItem<T>(lista: T[], de: number, para: number): T[] {
  const nova = lista.slice();
  if (de < 0 || de >= nova.length) return nova;
  const alvo = Math.max(0, Math.min(nova.length - 1, para));
  const [item] = nova.splice(de, 1);
  nova.splice(alvo, 0, item);
  return nova;
}

// ------------------------------------------------------------------ perguntas extras por projeto

export const PREFIXO_EXTRA = "extra_";
export const MAX_EXTRAS = 15;
export const ID_DO_BLOCO_EXTRA = "extras";
export const TITULO_DO_BLOCO_EXTRA = "Perguntas deste projeto";

/**
 * As perguntas extras de um projeto, limpas: chave com o prefixo, sem
 * repetir, no máximo 15. Condicional só entre as próprias extras.
 */
export function normalizarExtras(bruto: unknown): CampoDoBriefing[] {
  const lista = Array.isArray(bruto) ? bruto.slice(0, MAX_EXTRAS) : [];
  const usadas: string[] = [];
  const troca: Record<string, string> = {};
  const objetos: Array<Record<string, unknown>> = [];
  // 1. Chaves: a provisória da tela ("extra_NovaPergunta") vira a do texto; sem prefixo, ganha o prefixo.
  lista.forEach((c) => {
    if (!c || typeof c !== "object") return;
    const o = { ...(c as Record<string, unknown>) };
    const antiga = typeof o.key === "string" ? o.key.trim() : "";
    const provisoria = antiga.indexOf(`${PREFIXO_EXTRA}NovaPergunta`) === 0;
    let key = antiga;
    if (!key || provisoria || key.indexOf(PREFIXO_EXTRA) !== 0 || !/^[A-Za-z][A-Za-z0-9_]{0,48}$/.test(key) || usadas.indexOf(key) >= 0) key = chaveNova(String(o.pergunta || ""), usadas, PREFIXO_EXTRA);
    if (antiga) troca[antiga] = key;
    usadas.push(key);
    o.key = key;
    objetos.push(o);
  });
  // 2. Cada pergunta limpa pela mesma regra do modelo; condição só entre as extras (com a chave nova).
  const campos: CampoDoBriefing[] = [];
  objetos.forEach((o) => {
    const m = normalizarModelo({ slug: "diagnostico", blocos: [{ id: "x", titulo: "x", campos: [o] }] }, "diagnostico");
    const campo = m ? m.blocos[0].campos[0] : null;
    if (!campo) return;
    // Pergunta extra não alimenta o contexto sozinha (a equipe decide na exportação).
    delete campo.alimenta;
    if (campo.mostrarSe) {
      const alvo = troca[campo.mostrarSe.key] || campo.mostrarSe.key;
      if (campos.some((x) => x.key === alvo)) campo.mostrarSe = { ...campo.mostrarSe, key: alvo };
      else delete campo.mostrarSe;
    }
    campos.push(campo);
  });
  return campos;
}

/** As extras que já estão na cópia do link. */
export function extrasDoModelo(m: ModeloDeBriefing): CampoDoBriefing[] {
  const b = m.blocos.find((x) => x.id === ID_DO_BLOCO_EXTRA);
  return b ? b.campos.slice() : [];
}

/** A cópia do link com as extras no fim (troca o bloco de extras que já existia). */
export function modeloComExtras(m: ModeloDeBriefing, extras: CampoDoBriefing[]): ModeloDeBriefing {
  const blocos: BlocoDoBriefing[] = m.blocos.filter((b) => b.id !== ID_DO_BLOCO_EXTRA);
  const doModelo: string[] = [];
  blocos.forEach((b) => b.campos.forEach((c) => doModelo.push(c.key)));
  const limpas = extras.filter((c) => doModelo.indexOf(c.key) < 0);
  if (limpas.length) blocos.push({ id: ID_DO_BLOCO_EXTRA, titulo: TITULO_DO_BLOCO_EXTRA, campos: limpas });
  return { ...m, blocos };
}

// ------------------------------------------------------------------ painel

export type SituacaoNoPainel = "pendente" | "vencendo" | "recebido" | "reabrir" | "expirado";

/** Dias antes de vencer em que o link aparece como "vencendo". */
export const DIAS_PARA_VENCER = 5;

export type LinkNoPainel = {
  submitted?: boolean | null;
  expira_em?: string | null;
  reabertura_pedida_em?: string | null;
  enviado_em?: string | null;
  created_at?: string | null;
  rascunho_salvo_em?: string | null;
  ultimo_lembrete_em?: string | null;
  lembretes?: number | null;
};

export function situacaoNoPainel(b: LinkNoPainel, agora: Date = new Date()): SituacaoNoPainel {
  if (b.submitted && b.reabertura_pedida_em) return "reabrir";
  const e = estadoDoLink(b, agora);
  if (e === "enviado") return "recebido";
  if (e === "expirado") return "expirado";
  if (b.expira_em) {
    const falta = new Date(b.expira_em).getTime() - agora.getTime();
    if (!isNaN(falta) && falta <= DIAS_PARA_VENCER * 86_400_000) return "vencendo";
  }
  return "pendente";
}

export type ContagemDoPainel = { pendentes: number; vencendo: number; recebidos30: number; reabrir: number; expirados: number };

/** Números do topo do painel. Recebidos contam os últimos 30 dias. */
export function contagemDoPainel(lista: LinkNoPainel[], agora: Date = new Date()): ContagemDoPainel {
  const c: ContagemDoPainel = { pendentes: 0, vencendo: 0, recebidos30: 0, reabrir: 0, expirados: 0 };
  lista.forEach((b) => {
    const s = situacaoNoPainel(b, agora);
    if (s === "pendente") c.pendentes += 1;
    else if (s === "vencendo") {
      c.vencendo += 1;
      c.pendentes += 1;
    } else if (s === "reabrir") c.reabrir += 1;
    else if (s === "expirado") c.expirados += 1;
    else if (s === "recebido") {
      const t = b.enviado_em ? new Date(b.enviado_em).getTime() : NaN;
      if (!isNaN(t) && agora.getTime() - t <= 30 * 86_400_000) c.recebidos30 += 1;
    }
  });
  return c;
}

/** Máximo de lembretes por link (depois disso, a equipe liga para o cliente). */
export const MAX_LEMBRETES = 3;

/**
 * O link pede lembrete hoje? Mesma régua do aviso diário do banco: aberto,
 * com pelo menos 3 dias de vida e 2 dias sem ninguém salvar, ou vencendo em
 * até 3 dias; nunca dois lembretes em menos de 3 dias; no máximo 3.
 */
export function precisaDeLembrete(b: LinkNoPainel, agora: Date = new Date()): boolean {
  if (estadoDoLink(b, agora) !== "aberto") return false;
  if ((Number(b.lembretes) || 0) >= MAX_LEMBRETES) return false;
  const t = agora.getTime();
  const dia = 86_400_000;
  const ultimo = b.ultimo_lembrete_em ? new Date(b.ultimo_lembrete_em).getTime() : NaN;
  if (!isNaN(ultimo) && t - ultimo < 3 * dia) return false;
  const criado = b.created_at ? new Date(b.created_at).getTime() : NaN;
  const salvo = b.rascunho_salvo_em ? new Date(b.rascunho_salvo_em).getTime() : NaN;
  const vence = b.expira_em ? new Date(b.expira_em).getTime() : NaN;
  const parado = !isNaN(criado) && t - criado >= 3 * dia && (isNaN(salvo) || t - salvo >= 2 * dia);
  const vencendo = !isNaN(vence) && vence - t <= 3 * dia;
  return parado || vencendo;
}

const DATA_CURTA = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}`;
};

/** Mensagem pronta do lembrete (a equipe manda pelo WhatsApp ou pelo grupo). Sem travessão, sem exclamação. */
export function mensagemDeLembrete(p: {
  cliente?: string | null;
  modelo: ModeloDeBriefing;
  url: string;
  expiraEm?: string | null;
  respondidos: number;
  total: number;
  grupo?: boolean;
}): string {
  const nome = String(p.cliente || "").trim().slice(0, 80);
  const saudacao = p.grupo ? "Olá, pessoal." : nome ? `Olá, ${nome}.` : "Olá.";
  const titulo = `${p.modelo.titulo.charAt(0).toLowerCase()}${p.modelo.titulo.slice(1)}`;
  const faltam = Math.max(0, p.total - p.respondidos);
  const andamento = p.respondidos > 0
    ? `Vimos que o ${titulo} já tem ${p.respondidos} de ${p.total} respostas: ${faltam === 1 ? "falta só 1" : `faltam ${faltam}`}. O que você já escreveu está salvo.`
    : `Passando para lembrar do ${titulo}. Leva cerca de ${p.modelo.minutos} minutos e fica salvo enquanto você preenche.`;
  const linhas = [saudacao, andamento, p.url];
  const ate = DATA_CURTA(p.expiraEm);
  linhas.push(ate ? `O link vale até ${ate}. Se preferir, dá para responder por áudio nas perguntas abertas.` : "Se preferir, dá para responder por áudio nas perguntas abertas.");
  return linhas.join("\n\n");
}

// ------------------------------------------------------------------ comparar dois briefings

export type LadoDaComparacao = { modelo: ModeloDeBriefing; respostas: Respostas; anexos?: AnexoDoBriefing[] };
export type LinhaDaComparacao = { key: string; bloco: string; pergunta: string; a: string; b: string; igual: boolean };

const normal = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Lado a lado, pergunta por pergunta (pela chave): primeiro as do briefing A,
 * depois as que só o B tem. Pergunta que nenhum dos dois respondeu não entra.
 */
export function compararBriefings(a: LadoDaComparacao, b: LadoDaComparacao): LinhaDaComparacao[] {
  const linhas: LinhaDaComparacao[] = [];
  const vistas: string[] = [];
  const campoEm = (lado: LadoDaComparacao, key: string) => camposDoModelo(lado.modelo).find((c) => c.key === key) || null;
  const blocoEm = (lado: LadoDaComparacao, key: string) => {
    const bl = lado.modelo.blocos.find((x) => x.campos.some((c) => c.key === key));
    return bl ? bl.titulo : "";
  };
  const texto = (lado: LadoDaComparacao, key: string) => {
    const c = campoEm(lado, key);
    if (!c || !campoVisivel(c, lado.respostas)) return "";
    return textoDaResposta(c, lado.respostas, lado.anexos || []);
  };
  const adicionar = (key: string, dono: LadoDaComparacao) => {
    if (vistas.indexOf(key) >= 0) return;
    vistas.push(key);
    const c = campoEm(dono, key);
    if (!c) return;
    const ta = texto(a, key);
    const tb = texto(b, key);
    if (!ta && !tb) return;
    linhas.push({ key, bloco: blocoEm(dono, key), pergunta: c.pergunta, a: ta, b: tb, igual: normal(ta) === normal(tb) });
  };
  camposDoModelo(a.modelo).forEach((c) => adicionar(c.key, a));
  camposDoModelo(b.modelo).forEach((c) => adicionar(c.key, b));
  return linhas;
}
