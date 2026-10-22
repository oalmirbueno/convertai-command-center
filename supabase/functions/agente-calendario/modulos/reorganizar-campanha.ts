/**
 * "Reorganizar datas e fases" (22/10/2026): recalcula a linha do tempo da campanha (evento e início),
 * redistribui as peças que não estão aprovadas nem publicadas pelas vagas certas e cria as que faltam na
 * introdução e no encerramento. Sai como mudança planejada (diff, Confirmar, versão e "a refazer"); as peças
 * protegidas ficam onde estão. As datas saem do código; o modelo só escreve o conteúdo das peças novas.
 * Puro.
 */

import {
  ETAPA_DA_FASE,
  faseDaEtapa,
  type FaseDaLinha,
  type LinhaDoTempo,
  ORDEM_DAS_FASES,
  vagasDasPecas,
  type VagaDaPeca,
} from "./linha-do-tempo.ts";
import type { ItemDaMudanca, PecaParaOAgente } from "./mudanca-da-campanha.ts";

export interface Movimento {
  peca: PecaParaOAgente;
  data: string;
  etapa: string;
  fase: FaseDaLinha;
}

export interface Reorganizacao {
  movimentos: Movimento[];
  /** As peças novas da introdução e do encerramento (as vagas; o conteúdo vem depois). */
  novas: VagaDaPeca[];
  avisos: string[];
}

const curta = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const ordemDaFase = (p: PecaParaOAgente) => {
  const f = faseDaEtapa(p.etapa);
  return f ? ORDEM_DAS_FASES.indexOf(f) : 2;
};

/**
 * As peças livres (não protegidas) na ordem da história (fase da etapa, depois a data) vão para as vagas da
 * linha; falta introdução ou encerramento na série inteira, a peça nova entra na ponta.
 */
export function reorganizarPecas(e: { linha: LinhaDoTempo; pecas: PecaParaOAgente[]; porDia: number; ocupacao: Record<string, number> }): Reorganizacao {
  const avisos: string[] = [];
  const livres = e.pecas.filter((p) => !p.protegida).slice().sort((a, b) => ordemDaFase(a) - ordemDaFase(b) || a.data.localeCompare(b.data));
  const temFase = (f: FaseDaLinha) => e.pecas.some((p) => faseDaEtapa(p.etapa) === f && (!p.protegida || (p.data >= e.linha.inicio && p.data <= e.linha.fim)));
  const faltaIntro = !temFase("aquecimento");
  const faltaFim = !temFase("encerramento");
  e.pecas.filter((p) => p.protegida && (p.data < e.linha.inicio || p.data > e.linha.fim)).forEach((p) => {
    avisos.push(`${p.apelido} (${p.tema || "peça"}) está aprovada ou na agenda em ${curta(p.data)}, fora da janela nova: ficou onde está.`);
  });
  const total = livres.length + (faltaIntro ? 1 : 0) + (faltaFim ? 1 : 0);
  const { vagas, avisos: daAgenda } = vagasDasPecas(e.linha, total, { porDia: e.porDia, ocupacao: e.ocupacao });
  daAgenda.forEach((a) => avisos.push(a));
  const novas: VagaDaPeca[] = [];
  const movimentos: Movimento[] = [];
  let k = 0;
  if (faltaIntro && vagas[k]) novas.push(vagas[k++]);
  livres.forEach((p) => {
    const v = vagas[k++];
    if (v) movimentos.push({ peca: p, data: v.data, etapa: v.etapa, fase: v.fase });
  });
  if (faltaFim && vagas[k]) novas.push(vagas[k++]);
  return { movimentos, novas, avisos };
}

/** O conteúdo de uma peça nova (do modelo, ou do esquema quando o modelo falhar). */
export interface ConteudoDaPonta {
  tema: string;
  gancho: string;
  laminas: string[];
  cta: string;
  legenda: string;
}

export const ESQUEMA_DAS_PONTAS = {
  nome: "pontas_da_campanha",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["pecas"],
    properties: {
      pecas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["vaga", "tema", "gancho", "laminas", "cta", "legenda"],
          properties: {
            vaga: { type: "integer" },
            tema: { type: "string" },
            gancho: { type: "string" },
            laminas: { type: "array", items: { type: "string" } },
            cta: { type: "string" },
            legenda: { type: "string" },
          },
        },
      },
    },
  },
};

const txt = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().replace(/\s*[–—]\s*/g, ", ").slice(0, max) : "");

/** O conteúdo de cada vaga nova pela resposta; o que faltar sai do papel da fase (nada inventado de oferta). */
export function conteudoDasPontas(r: unknown, novas: VagaDaPeca[], padrao: (v: VagaDaPeca) => ConteudoDaPonta): ConteudoDaPonta[] {
  const lista = (r && typeof r === "object" && Array.isArray((r as Record<string, unknown>).pecas) ? (r as Record<string, unknown>).pecas : []) as Array<Record<string, unknown>>;
  return novas.map((v, i) => {
    const o = lista.filter((x) => Number(x && x.vaga) === i + 1)[0] || lista[i] || null;
    const base = padrao(v);
    if (!o || !txt(o.tema, 200)) return base;
    const laminas = (Array.isArray(o.laminas) ? o.laminas : []).map((l) => txt(l, 1200)).filter(Boolean).slice(0, 10);
    return {
      tema: txt(o.tema, 200),
      gancho: txt(o.gancho, 400) || base.gancho,
      laminas: laminas.length ? laminas : base.laminas,
      cta: txt(o.cta, 300) || base.cta,
      legenda: typeof o.legenda === "string" ? o.legenda.trim().slice(0, 2200) : "",
    };
  });
}

const resumoDaLinha = (l: LinhaDoTempo | null) =>
  l ? l.fases.map((f) => `${f.nome} ${curta(f.inicio)}${f.fim !== f.inicio ? `-${curta(f.fim)}` : ""}`).join(" · ") : "(sem linha do tempo)";

/** A lista da mudança: a linha nova, as peças que mudam de dia ou de fase e as que entram. */
export function itensDaReorganizacao(
  antes: LinhaDoTempo | null,
  linha: LinhaDoTempo,
  r: Reorganizacao,
  conteudos: ConteudoDaPonta[],
): ItemDaMudanca[] {
  const itens: ItemDaMudanca[] = [];
  let n = 0;
  const ref = () => `m${++n}`;
  itens.push({
    ref: ref(),
    alvo_id: "linha_do_tempo",
    titulo: `Linha do tempo: evento em ${curta(linha.evento)}, de ${curta(linha.inicio)} a ${curta(linha.fim)}`,
    detalhe: `${resumoDaLinha(antes)} → ${resumoDaLinha(linha)}${linha.avisos.length ? ` (${linha.avisos.join(" ")})` : ""}`,
    operacao: "linha_do_tempo",
    rotulo: "Datas",
    para: JSON.stringify({ valor: linha }),
  });
  r.movimentos.forEach((m) => {
    const partes: string[] = [];
    const campos: Record<string, string> = {};
    if (m.data !== m.peca.data) {
      partes.push(`Data: ${m.peca.data ? curta(m.peca.data) : "(sem)"} → ${curta(m.data)}`);
      campos.data = m.data;
    }
    if (m.etapa !== m.peca.etapa) {
      partes.push(`Fase: ${m.peca.etapa || "(sem)"} → ${m.etapa}`);
      campos.etapa = m.etapa;
    }
    if (!partes.length) return;
    itens.push({
      ref: ref(),
      alvo_id: m.peca.tema_id,
      titulo: `${m.peca.apelido} · ${m.peca.tema || "Peça"}`,
      detalhe: `${partes.join("; ")} (a arte continua valendo)`,
      operacao: "alterar_peca",
      rotulo: "Muda",
      para: JSON.stringify(campos),
    });
  });
  r.novas.forEach((v, i) => {
    const c = conteudos[i];
    if (!c) return;
    const intro = v.fase === "aquecimento";
    itens.push({
      ref: ref(),
      alvo_id: "",
      titulo: c.tema,
      detalhe: `${intro ? "Introdução" : "Encerramento"} · ${ETAPA_DA_FASE[v.fase]} · ${v.data} (${intro ? "prepara o público antes da oferta" : "fecha a campanha com a última chamada"})`,
      operacao: "nova_peca",
      rotulo: "Entra",
      para: JSON.stringify({ data: v.data, formato: "estatico", etapa: v.etapa, tema: c.tema, gancho: c.gancho, laminas: c.laminas.slice(0, 1), cta: c.cta, produto: "", ...(c.legenda ? { legenda: c.legenda } : {}) }),
    });
  });
  return itens;
}
