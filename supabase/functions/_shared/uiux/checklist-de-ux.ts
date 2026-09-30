/**
 * O checklist das 109 regras de UX da web da base UI UX Pro Max (frente UXM):
 * junta o que o código conferiu (em todas as páginas do build), a prova do
 * agente do motor, as marcações da equipe e o padrão de cada modo.
 *
 * SEM dado da base e sem os textos em português: a tela importa este arquivo
 * de forma fixa (é leve) e passa os textos do pt.ts que ela carregou sob
 * demanda (src/lib/uiux/carregar.ts). Assim nenhum pedaço da tela prende a
 * base de forma fixa. O servidor, o worker e o teste usam
 * itensDoChecklistDeUx de revisao-ux.ts, com os textos já ligados.
 * Sem lookbehind, sem grupo nomeado, sem travessão.
 */

import type { AvisoDeQa } from "../site-metodo.ts";
import { modoDaRegra, type ModoDaRegra } from "./mapeamentos.ts";
import type { SeveridadeDaRegra } from "./pt.ts";

export type AvisoDeUx = AvisoDeQa & {
  /** "uupm:ux:9" */
  regra: string;
  severidade: SeveridadeDaRegra;
  /** "Como corrigir" em português (texto nosso). */
  corrigir: string;
  /** O "código bom" da base. */
  exemplo?: string;
  modo: "codigo" | "agente" | "manual";
  /** As páginas (caminho, "/" ou "/contato/") em que o aviso acendeu, quando o build tem mais de uma. */
  paginas?: string[];
};

/**
 * Regras de código que dependem do HTML de CADA página (imagem, título, campo,
 * link de fonte, script, vídeo, faixa que gira). As outras (movimento
 * reduzido no CSS, foco visível, contraste dos tokens) valem para o site
 * inteiro.
 */
export const REGRAS_DE_PAGINA = ["38", "39", "42", "43", "45", "47", "50", "51", "54", "57", "58", "68", "75", "96", "99", "108"];

/** Uma regra da base, só com o que o checklist usa (a base completa e o índice leve servem). */
export type RegraParaChecklist = { no: string; plataforma: string; severidade: string; codigoBom: string };

/** Os textos em português (de pt.ts, carregado sob demanda na tela). */
export type TextosDoChecklist = {
  REGRA_DE_UX_EM_PORTUGUES: Record<string, { titulo: string; corrigir: string }>;
  severidadeDaRegra: (s: string) => SeveridadeDaRegra;
};

export type EntradaDoChecklist = {
  avisos?: AvisoDeUx[] | null;
  revisado: boolean;
  agente?: ProvaDoAgente[] | null;
  marcas?: Record<string, "ok" | "nao_se_aplica">;
  /** As páginas que a revisão leu (resultado.ux_paginas). */
  paginas?: string[] | null;
  /** Quantas páginas o mapa do site tem. */
  paginasDoSite?: number | null;
};

export type EstadoDoItem = "ok" | "falhou" | "pendente" | "nao_se_aplica";
export type ItemDoChecklistDeUx = {
  no: string;
  regra: string;
  titulo: string;
  corrigir: string;
  exemplo: string;
  severidade: SeveridadeDaRegra;
  modo: ModoDaRegra;
  estado: EstadoDoItem;
  /** De onde veio o estado: "conferido no código", "o agente conferiu", "confira você", "não se aplica". */
  origem: string;
  detalhe?: string;
  secao?: string | null;
};

/**
 * O que o agente do motor deixou em .aceleriq/ux/<seção>.json, como o worker
 * juntou: já normalizado pelo mesmo leitor do evento da passada
 * (normalizarProvaDeUx de workers/motor-codigo/lib/prova-da-base.ts, que
 * aceita o id "uupm:ux:28" ou o nome da regra "Focus States"), só das seções
 * do mapa atual e só a prova da última passada que mexeu na seção.
 */
export type ProvaDoAgente = { secao: string; conferidas: string[]; pendentes: Array<{ regra: string; motivo?: string }> };

const noDaRegra = (r: string) => {
  const m = /(\d{1,3})$/.exec(String(r || ""));
  return m ? m[1] : "";
};

/**
 * Junta tudo num checklist por regra: resultado do código (quando o site foi
 * revisado), prova do agente, marcação manual (base_de_design.ux) e o padrão
 * de cada modo. A regra de código que o build conferiu e não acendeu fica ok.
 *
 * `paginas` são as páginas que a revisão leu (resultado.ux_paginas) e
 * `paginasDoSite` quantas o mapa tem. Revisão antiga (só a página inicial) ou
 * que não leu todas as páginas do mapa: a regra de PÁGINA fica "a conferir",
 * com a origem "conferido só na página inicial" (ou "em N de M páginas"),
 * nunca ok sem ter lido o HTML.
 */
export function itensDoChecklist(regras: RegraParaChecklist[], entrada: EntradaDoChecklist, textos: TextosDoChecklist): ItemDoChecklistDeUx[] {
  const { REGRA_DE_UX_EM_PORTUGUES, severidadeDaRegra } = textos;
  const falhas: Record<string, string> = {};
  for (const a of entrada.avisos || []) {
    const n = noDaRegra(a.regra);
    if (n) falhas[n] = falhas[n] ? `${falhas[n]} ${a.texto}` : a.texto;
  }
  const doAgente: Record<string, { ok: boolean; motivo?: string; secao: string }> = {};
  for (const p of entrada.agente || []) {
    for (const r of p.conferidas || []) if (!doAgente[noDaRegra(r)]) doAgente[noDaRegra(r)] = { ok: true, secao: p.secao };
    for (const r of p.pendentes || []) doAgente[noDaRegra(r.regra)] = { ok: false, motivo: r.motivo, secao: p.secao };
  }
  const marcas = entrada.marcas || {};
  return regras
    .filter((r) => r.plataforma === "Web" || r.plataforma === "All")
    .map((r) => {
      const pt = REGRA_DE_UX_EM_PORTUGUES[r.no] || { titulo: `Regra ${r.no}`, corrigir: "" };
      const m = modoDaRegra(r.no);
      const base = { no: r.no, regra: `uupm:ux:${r.no}`, titulo: pt.titulo, corrigir: pt.corrigir, exemplo: r.codigoBom, severidade: severidadeDaRegra(r.severidade), modo: m.modo };
      if (marcas[r.no]) return { ...base, estado: marcas[r.no] as EstadoDoItem, origem: marcas[r.no] === "ok" ? "a equipe marcou" : "a equipe marcou: não se aplica" };
      if (m.modo === "codigo") {
        if (falhas[r.no]) return { ...base, estado: "falhou" as EstadoDoItem, origem: "conferido no código", detalhe: falhas[r.no] };
        if (!entrada.revisado) return { ...base, estado: "pendente" as EstadoDoItem, origem: "o código confere na próxima revisão" };
        if (REGRAS_DE_PAGINA.indexOf(r.no) < 0) return { ...base, estado: "ok" as EstadoDoItem, origem: "conferido no código" };
        const doSite = Math.max(1, Number(entrada.paginasDoSite) || 1);
        const lidas = Array.isArray(entrada.paginas) ? entrada.paginas.length : 0;
        if (!lidas) return doSite > 1 ? { ...base, estado: "pendente" as EstadoDoItem, origem: "conferido só na página inicial" } : { ...base, estado: "ok" as EstadoDoItem, origem: "conferido no código" };
        if (lidas < doSite) return { ...base, estado: "pendente" as EstadoDoItem, origem: `conferido em ${lidas} de ${doSite} páginas` };
        return { ...base, estado: "ok" as EstadoDoItem, origem: lidas > 1 ? `conferido no código em ${lidas} páginas` : "conferido no código" };
      }
      if (m.modo === "agente") {
        const a = doAgente[r.no];
        if (a) return { ...base, estado: (a.ok ? "ok" : "falhou") as EstadoDoItem, origem: "o agente conferiu", detalhe: a.motivo, secao: a.secao };
        return { ...base, estado: "pendente" as EstadoDoItem, origem: "o agente confere ao construir" };
      }
      if (m.modo === "nao_se_aplica") return { ...base, estado: "nao_se_aplica" as EstadoDoItem, origem: "não se aplica", detalhe: m.motivo };
      return { ...base, estado: "pendente" as EstadoDoItem, origem: "confira você" };
    });
}

/** Pendências críticas e altas: o que falhou e o que ainda não foi conferido (o item não obrigatório do checklist de lançamento). */
export const pendenciasGraves = (itens: ItemDoChecklistDeUx[]) => itens.filter((i) => (i.estado === "falhou" || i.estado === "pendente") && (i.severidade === "critica" || i.severidade === "alta")).length;
