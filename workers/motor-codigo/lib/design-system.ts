/**
 * Design system da base de design (skill ui-ux-pro-max) no projeto do
 * cliente, gerado pelo MOTOR e não pelo agente (correção da UIM, 30/09/2026).
 *
 * Antes, o AGENTS.md mandava o agente gerar `design-system/<cliente>/MASTER.md`
 * "uma vez" e nunca sobrescrever: o primeiro build travava o design system
 * (às vezes com consulta vazia ou improvisada) e a troca de produto ou estilo
 * feita depois na Direção nunca chegava ao MASTER.md. Agora:
 *  - o worker grava a consulta usada em `.aceleriq/uiux-consulta.json`;
 *  - quando `pacote.base_de_design.consulta` muda (ou o MASTER.md sumiu), o
 *    worker apaga `design-system/` e gera de novo, pela busca da skill, num
 *    commit próprio, antes da primeira passada;
 *  - sem consulta no pacote não há design system (a pasta velha sai) e o bloco
 *    BASE DE DESIGN não vai no pedido da seção;
 *  - o agente só lê (o embrulho recusa `--persist` e `--force`).
 * Sem o SDK: o teste do painel importa este arquivo.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EventoResumido } from "../../../supabase/functions/_shared/motor-codigo.ts";

export const PASTA_DO_DESIGN_SYSTEM = "design-system";
export const CONSULTA_GRAVADA = join(".aceleriq", "uiux-consulta.json");

export type ConsultaGravada = { consulta: string; cliente: string; master: string | null; em: string };
export type AcaoDoDesignSystem = "manter" | "gerar" | "apagar";
export type ResultadoDaBusca = { codigo: number; saida?: string; erro?: string };
export type ResultadoDoDesignSystem = { acao: AcaoDoDesignSystem; ok: boolean; consulta: string; master: string | null; motivo: string | null; evento: EventoResumido | null };

const umaLinha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

/** A consulta em inglês que o painel montou (pacote.base_de_design.consulta), ou "" quando não há. */
export function consultaDoPacote(pacote: Record<string, unknown> | null | undefined): string {
  const bd = pacote && pacote.base_de_design && typeof pacote.base_de_design === "object" ? (pacote.base_de_design as { consulta?: unknown }) : null;
  return bd ? umaLinha(bd.consulta, 300) : "";
}

/** O nome do projeto para a busca (vira a pasta design-system/<slug>). */
export function clienteDoPacote(pacote: Record<string, unknown> | null | undefined): string {
  return umaLinha(pacote && pacote.cliente, 80) || "site";
}

export function lerConsultaGravada(pasta: string): ConsultaGravada | null {
  try {
    const o = JSON.parse(readFileSync(join(pasta, CONSULTA_GRAVADA), "utf8")) as Partial<ConsultaGravada>;
    if (!o || typeof o.consulta !== "string") return null;
    return { consulta: o.consulta, cliente: String(o.cliente || ""), master: typeof o.master === "string" ? o.master : null, em: String(o.em || "") };
  } catch {
    return null;
  }
}

/** O MASTER.md do projeto (caminho relativo com "/"), ou null. */
export function masterDoProjeto(pasta: string): string | null {
  const raiz = join(pasta, PASTA_DO_DESIGN_SYSTEM);
  if (!existsSync(raiz)) return null;
  for (const nome of readdirSync(raiz).sort()) {
    try {
      if (statSync(join(raiz, nome)).isDirectory() && existsSync(join(raiz, nome, "MASTER.md"))) return `${PASTA_DO_DESIGN_SYSTEM}/${nome}/MASTER.md`;
    } catch {
      /* entrada sumiu no meio da leitura */
    }
  }
  return null;
}

/**
 * O que fazer com o design system antes da passada:
 *  - consulta vazia: apagar o que houver (MASTER.md velho ou gravado), senão manter;
 *  - mesma consulta já gerada e o MASTER.md no lugar: manter;
 *  - qualquer outro caso (consulta nova, MASTER.md sumido, MASTER.md que o
 *    motor não gerou): gerar de novo.
 */
export function decidirDesignSystem(consulta: string, gravada: ConsultaGravada | null, master: string | null, temPasta = !!master): AcaoDoDesignSystem {
  if (!consulta) return master || temPasta || (gravada && gravada.consulta) ? "apagar" : "manter";
  if (gravada && gravada.consulta === consulta && master) return "manter";
  return "gerar";
}

/**
 * Deixa o design system do projeto de acordo com o pacote. `buscar` é o
 * embrulho da casa (scripts/uiux.mjs, chamado com `motor: true`); `commitar`
 * grava o resultado num commit próprio. Nunca lança: falha vira aviso.
 */
export async function prepararDesignSystem(
  pasta: string,
  pacote: Record<string, unknown>,
  deps: {
    buscar: (args: string[], opcoes: { raiz: string; motor: true; buscador?: string | null }) => Promise<ResultadoDaBusca>;
    commitar: (pasta: string, mensagem: string) => Promise<{ novo: boolean; commit: string }>;
    buscador?: string | null;
  },
): Promise<ResultadoDoDesignSystem> {
  const consulta = consultaDoPacote(pacote);
  const gravada = lerConsultaGravada(pasta);
  const anterior = masterDoProjeto(pasta);
  const acao = decidirDesignSystem(consulta, gravada, anterior, existsSync(join(pasta, PASTA_DO_DESIGN_SYSTEM)));
  if (acao === "manter") return { acao, ok: true, consulta, master: anterior, motivo: null, evento: null };
  try {
    rmSync(join(pasta, PASTA_DO_DESIGN_SYSTEM), { recursive: true, force: true });
    let master: string | null = null;
    let motivo: string | null = null;
    if (acao === "gerar") {
      const r = await deps.buscar([consulta, "--design-system", "--persist", "-p", clienteDoPacote(pacote)], { raiz: pasta, motor: true, buscador: deps.buscador });
      master = masterDoProjeto(pasta);
      if (r.codigo === 3) motivo = "a busca da base não rodou (sem Python 3 ou sem a skill no motor)";
      else if (r.codigo !== 0) motivo = umaLinha(r.erro || `a busca saiu com o código ${r.codigo}`, 160);
      else if (!master) motivo = "a busca não escreveu o MASTER.md";
    }
    mkdirSync(join(pasta, ".aceleriq"), { recursive: true });
    const nova: ConsultaGravada = { consulta, cliente: clienteDoPacote(pacote), master, em: new Date().toISOString() };
    writeFileSync(join(pasta, CONSULTA_GRAVADA), `${JSON.stringify(nova, null, 2)}\n`);
    const curta = consulta.length > 60 ? `${consulta.slice(0, 57)}...` : consulta;
    const ok = acao === "apagar" || (!motivo && !!master);
    await deps.commitar(pasta, acao === "apagar" ? "Base de design: sem consulta no pacote, design system removido" : ok ? `Base de design: design system da consulta "${curta}"` : "Base de design: consulta nova, sem design system");
    const evento: EventoResumido =
      acao === "apagar"
        ? { tipo: "passo", resumo: "Sem consulta da base de design no pacote: o design system antigo saiu do projeto" }
        : ok
          ? { tipo: "passo", resumo: `Design system da base ${anterior || gravada ? "refeito" : "gerado"} pela consulta do pacote ("${curta}")`, dados: { master, consulta } }
          : { tipo: "aviso", resumo: `A base de design não gerou o design system: ${motivo}. O agente segue com o pacote e as buscas por domínio`.slice(0, 280) };
    return { acao, ok, consulta, master, motivo, evento };
  } catch (e) {
    const motivo = umaLinha(e instanceof Error ? e.message : e, 160) || "erro sem detalhe";
    return { acao, ok: false, consulta, master: masterDoProjeto(pasta), motivo, evento: { tipo: "aviso", resumo: `Design system da base: ${motivo}`.slice(0, 280) } };
  }
}

/**
 * O pedido da seção de acordo com o design system:
 *  - sem consulta no pacote, sai o bloco BASE DE DESIGN (a busca não teria o
 *    que usar e o agente improvisaria uma consulta);
 *  - com o MASTER.md gerado, o pedido diz onde ele está (o nome da pasta é o
 *    slug do cliente, que o agente não precisa adivinhar).
 */
export function ajustarPromptDaBase(texto: string, pacote: Record<string, unknown>, master: string | null): string {
  const consulta = consultaDoPacote(pacote);
  const linhas = String(texto || "").split("\n").filter((l) => consulta || !/^BASE DE DESIGN\b/.test(l));
  if (consulta && master) {
    const linha = `DESIGN SYSTEM: leia ${master} (o motor gerou da consulta do pacote). Use dele só o que o pacote não define: espaçamento, efeitos, estados e antipadrões.`;
    const fim = linhas.findIndex((l) => /^Ao terminar, rode/.test(l));
    if (fim >= 0) linhas.splice(fim, 0, linha);
    else linhas.push(linha);
  }
  return linhas.join("\n");
}
