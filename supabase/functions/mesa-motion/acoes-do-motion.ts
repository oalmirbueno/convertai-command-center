/**
 * Ações do agente de motion (Mesa Motion, papel `motion`), no contrato comum
 * de ../_shared/acoes-do-agente.ts: apelido em vez de id, cartão Confirmar
 * com o custo antes, item a item, Desfazer, travas e auditoria.
 *
 * Pedidos que viram operação:
 * - "refaz o BRAND.md mais sóbrio"          -> gerar_brand (x1; para = pedido extra)      custo de modelo
 * - "gera os storyboards"                   -> gerar_storyboards (x1; para = pedido)       custo de modelo
 * - "fica com o segundo storyboard"         -> escolher_storyboard (b1..b3)               na hora, Desfazer
 * - "escreve a cena 2 com um traço..."      -> escrever_cena (c..; para = a ideia)          custo de modelo, teto por cena
 * - "troca a cena 3 pelo cartão final"      -> usar_peca (c..; para = peça do kit)          na hora, Desfazer
 * - "tira o still da cena 1"                -> pedir_still (c..)                            na hora (worker), Desfazer = cancelar
 * - "manda a amostra da cena 2"             -> pedir_amostra (c..)                          na hora (worker), Desfazer = cancelar
 * - "aprova o still da 1"                   -> aprovar_still (c..)                          na hora, Desfazer
 * - "renderiza as cenas"                    -> pedir_final (c..)                            Confirmar (worker, todos os formatos)
 * - "mede as batidas" / "casa no ritmo"     -> medir_batidas / casar_ritmo (x1)             na hora, Desfazer
 * - "critica o filme"                       -> criticar (x1)                                Jev (centavos)
 * - "monta e renderiza"                     -> montar_filme (x1)                            Confirmar
 *
 * Sem import de Deno: o vitest lê este arquivo.
 */
import {
  type AcaoDoAgente,
  type AlvoComApelido,
  blocoDosAlvos,
  comApelido,
  esquemaDasAcoes,
  normalizarAcaoDoAgente,
  type RegraDaOperacao,
  regraDasAcoes,
} from "../_shared/acoes-do-agente.ts";
import { PECAS_DO_KIT } from "../_shared/cena-hf.ts";

export const OPERACOES_DO_MOTION = [
  "gerar_brand",
  "gerar_storyboards",
  "escolher_storyboard",
  "escrever_cena",
  "usar_peca",
  "pedir_still",
  "pedir_amostra",
  "aprovar_still",
  "pedir_final",
  "medir_batidas",
  "casar_ritmo",
  "criticar",
  "montar_filme",
];
export const OPERACOES_COM_CUSTO = ["gerar_brand", "gerar_storyboards", "escrever_cena", "criticar"];
export const ESQUEMA_DAS_ACOES_DO_MOTION = esquemaDasAcoes(OPERACOES_DO_MOTION);

type AlvoDoMotion = { id: string; titulo: string; detalhe?: string | null; dados?: Record<string, unknown> };

const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export type ListasDoMotion = {
  filmeId: string;
  cenas: Array<{ id: string; titulo: string; peca: string | null; modo: string; tipo_plano: string; tem_still: boolean; still_aprovado: boolean }>;
  storyboards: Array<{ conceito: string; escolhido: boolean }>;
  tem_trilha: boolean;
  tem_batidas: boolean;
};

export function alvosDoMotion(l: ListasDoMotion): Array<AlvoComApelido<AlvoDoMotion>> {
  const cenas = comApelido(
    l.cenas.map((c, i) => ({
      id: c.id,
      titulo: `cena ${i + 1}: ${umaLinha(c.titulo, 60)}`,
      detalhe: `${c.tipo_plano !== "hf" ? `plano ${c.tipo_plano}` : c.modo === "sob_medida" ? "sob medida" : c.peca || ""}${c.still_aprovado ? " · still aprovado" : c.tem_still ? " · still pronto" : ""}`,
      dados: { hf: c.tipo_plano === "hf", tem_still: c.tem_still, still_aprovado: c.still_aprovado },
    })),
    "c",
  );
  const sbs = comApelido(l.storyboards.map((s, i) => ({ id: String(i), titulo: umaLinha(s.conceito, 100) || `Storyboard ${i + 1}`, detalhe: s.escolhido ? "escolhido" : null, dados: { escolhido: s.escolhido } })), "b");
  const filme = comApelido([{ id: l.filmeId, titulo: "o filme aberto", dados: { tem_trilha: l.tem_trilha, tem_batidas: l.tem_batidas, cenas: l.cenas.length } }], "x");
  return [...cenas, ...sbs, ...filme];
}

const PECAS = PECAS_DO_KIT.map((p) => p.id as string);

export function regrasDoMotion(): Record<string, RegraDaOperacao<AlvoDoMotion>> {
  const soHf = (a: AlvoComApelido<AlvoDoMotion>) => (a.dados && a.dados.hf === false ? "Esta cena é um plano de vídeo (gerado ou real), não uma cena em código." : null);
  return {
    gerar_brand: { rotulo: "gerar o BRAND.md e a beat sheet de", combina: true, alvos: ["x"], para: (b) => umaLinha(b, 600) || "sem pedido extra" },
    gerar_storyboards: { rotulo: "gerar 3 storyboards para", combina: true, alvos: ["x"], para: (b) => umaLinha(b, 600) || "sem pedido extra" },
    escolher_storyboard: { rotulo: "ficar com o storyboard", alvos: ["b"], direta: true, trava: (a) => (a.dados && a.dados.escolhido ? "Este storyboard já é o escolhido." : null) },
    escrever_cena: {
      rotulo: "escrever sob medida a",
      combina: true,
      alvos: ["c"],
      para: (b) => {
        const t = umaLinha(b, 900);
        return t.length >= 4 ? t : null;
      },
      trava: soHf,
    },
    usar_peca: {
      rotulo: "trocar pela peça do kit a",
      combina: true,
      alvos: ["c"],
      direta: true,
      para: (b) => {
        const t = umaLinha(b, 40).toLowerCase().replace(/\s+/g, "_");
        return PECAS.indexOf(t) >= 0 ? t : null;
      },
      trava: soHf,
    },
    pedir_still: { rotulo: "tirar o still da", combina: true, alvos: ["c"], direta: true, trava: soHf },
    pedir_amostra: { rotulo: "montar a amostra de 5 s da", combina: true, alvos: ["c"], direta: true, trava: soHf },
    aprovar_still: {
      rotulo: "aprovar o still da",
      combina: true,
      alvos: ["c"],
      direta: true,
      trava: (a) => soHf(a) || (a.dados && a.dados.still_aprovado ? "O still desta cena já está aprovado." : a.dados && !a.dados.tem_still ? "Esta cena ainda não tem still: peça o still antes." : null),
    },
    pedir_final: { rotulo: "renderizar a cena final (todos os formatos) de", combina: true, alvos: ["c"], trava: soHf },
    medir_batidas: { rotulo: "medir as batidas da trilha de", combina: true, alvos: ["x"], direta: true, trava: (a) => (a.dados && a.dados.tem_trilha ? null : "Escolha a trilha na etapa Som antes.") },
    casar_ritmo: { rotulo: "casar os cortes com a batida em", combina: true, alvos: ["x"], direta: true, trava: (a) => (a.dados && a.dados.tem_batidas ? null : "Meça as batidas da trilha antes.") },
    criticar: { rotulo: "criticar as cenas de", combina: true, alvos: ["x"] },
    montar_filme: { rotulo: "montar na Mesa Edição e renderizar", combina: true, alvos: ["x"], trava: (a) => (a.dados && Number(a.dados.cenas) > 0 ? null : "O filme ainda não tem cenas.") },
  };
}

export const DESCRICOES_DAS_ACOES = {
  gerar_brand: "gera o BRAND.md (essência, público, promessa, tom, provas com fonte, evitar, movimento) e a beat sheet. Custa modelo.",
  gerar_storyboards: "gera 3 storyboards diferentes para a equipe escolher (para = pedido extra). Custa modelo.",
  escolher_storyboard: "escolhe um dos storyboards (b1..b3): as cenas dele viram as cenas do filme. Sem custo.",
  escrever_cena: "o modelo escreve a cena em HTML e GSAP (para = a ideia com as palavras da equipe). Uma cena por vez, com teto. Custa modelo.",
  usar_peca: `troca a cena por uma peça do kit (para = uma de: ${PECAS.join(", ")}). Sem custo.`,
  pedir_still: "pede o still (quadro herói) da cena ao worker da agência. Sem custo.",
  pedir_amostra: "pede a amostra de 5 s da cena ao worker. Sem custo.",
  aprovar_still: "aprova o still da cena (libera a construção). Sem custo.",
  pedir_final: "pede a cena final com alfa em todos os formatos do filme. Sem custo de modelo (worker da agência).",
  medir_batidas: "mede as batidas e o drop da trilha escolhida. Sem custo.",
  casar_ritmo: "ajusta a duração das cenas para os cortes caírem na batida. Sem custo.",
  criticar: "nota de 1 a 10 por critério (legível no celular, hierarquia, ritmo, marca, só fatos reais) pelo Jev. Só aviso. Custo de centavos.",
  montar_filme: "monta o filme na Mesa Edição (um projeto por formato) e põe o render na fila. Sem custo de modelo.",
};

export function blocoDasAcoesDoMotion(l: ListasDoMotion): string {
  const alvos = alvosDoMotion(l);
  const por = (p: string) => alvos.filter((a) => a.ref.charAt(0) === p);
  return [blocoDosAlvos("CENAS DO FILME", por("c"), "nenhuma ainda."), blocoDosAlvos("STORYBOARDS", por("b"), "nenhum gerado ainda."), blocoDosAlvos("FILME", por("x")), regraDasAcoes(DESCRICOES_DAS_ACOES)].join("\n");
}

export function normalizarAcoesDoMotion(bruto: unknown, l: ListasDoMotion, clientId: string, custos: { brand: number; storyboards: number; cena: number; critica: number }, id?: string): AcaoDoAgente | null {
  const acao = normalizarAcaoDoAgente(bruto, alvosDoMotion(l), regrasDoMotion(), {
    agente: "motion",
    id: id || `motion-${Date.now().toString(36)}`,
    contexto: { client_id: clientId, filme_id: l.filmeId },
  });
  if (!acao) return null;
  let custo = 0;
  for (const i of acao.itens) {
    if (i.operacao === "gerar_brand") custo += custos.brand;
    else if (i.operacao === "gerar_storyboards") custo += custos.storyboards;
    else if (i.operacao === "escrever_cena") custo += custos.cena;
    else if (i.operacao === "criticar") custo += custos.critica;
  }
  acao.custo_estimado_usd = Math.round(custo * 1e6) / 1e6;
  if (acao.itens.length && acao.itens.every((i) => i.operacao === "criticar")) acao.sem_desfazer = true;
  return acao;
}

/** "Ir para" depois de feito: a etapa que mostra o resultado. */
export function caminhoDoMotion(clientId: string, filmeId: string, acao: Pick<AcaoDoAgente, "itens">): { rotulo: string; destino: string } {
  const ops = acao.itens.map((i) => i.operacao);
  const etapa = ops.indexOf("gerar_brand") >= 0
    ? "brand"
    : ops.indexOf("gerar_storyboards") >= 0 || ops.indexOf("escolher_storyboard") >= 0
      ? "storyboards"
      : ops.indexOf("pedir_still") >= 0 || ops.indexOf("aprovar_still") >= 0
        ? "stills"
        : ops.indexOf("medir_batidas") >= 0 || ops.indexOf("casar_ritmo") >= 0
          ? "som"
          : ops.indexOf("criticar") >= 0
            ? "critica"
            : ops.indexOf("montar_filme") >= 0
              ? "render"
              : "construcao";
  const rotulos: Record<string, string> = { brand: "Abrir o BRAND.md", storyboards: "Abrir os storyboards", stills: "Abrir os stills", som: "Abrir o som", critica: "Abrir a crítica", render: "Abrir o render", construcao: "Abrir a construção" };
  return { rotulo: rotulos[etapa], destino: `/mesa-motion?client=${clientId}&filme=${filmeId}&etapa=${etapa}` };
}
