/**
 * Memória da conta em 8 camadas (12/10/2026): tipos e as chamadas memoria_ler e
 * memoria_salvar da mesa-ads. O servidor normaliza e calcula (CPA máximo e ROAS
 * de equilíbrio em código); a tela só mostra e manda o que a equipe preencheu.
 */
import { chamarAds } from "./adsApi";

export type Situacao = "ok" | "com_problema" | "nao_tem" | "nao_sei";
export type FonteQuePrevalece = "meta" | "vendas_registradas" | "crm" | "nao_definido";

export interface Preenchidas {
  comportamento: { observacoes: string };
  financas: {
    ticket_medio_brl: number | null;
    margem_pct: number | null;
    conversao: "venda" | "lead";
    taxa_fechamento_pct: number | null;
    compras_no_ano: number | null;
    observacoes: string;
  };
  confiabilidade: { pixel: Situacao; api_de_conversoes: Situacao; evento_principal: string; janela_de_atribuicao: string; armadilhas: string };
  mercado: { sazonalidade: string; ciclo_de_compra_dias: number | null; datas: { dia: string; nome: string }[] };
  dados: { fonte_que_prevalece: FonteQuePrevalece; observacoes: string };
}

export interface FinancasCalculadas {
  custo_maximo_brl: number | null;
  por: "compra" | "lead" | null;
  roas_de_equilibrio: number | null;
  valor_do_cliente_no_ano_brl: number | null;
  faltando: string[];
  contas: string[];
}

export interface CamadaNaTela {
  id: string;
  titulo: string;
  fonte: string;
  linhas: string[];
}

export interface MemoriaNaTela {
  disponivel: boolean;
  versao: number;
  atualizada_em: string | null;
  preenchidas: Preenchidas;
  financas: FinancasCalculadas;
  camadas: CamadaNaTela[];
}

const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);
const txt = (v: unknown) => (typeof v === "string" ? v : "");

export const PREENCHIDAS_VAZIAS: Preenchidas = {
  comportamento: { observacoes: "" },
  financas: { ticket_medio_brl: null, margem_pct: null, conversao: "venda", taxa_fechamento_pct: null, compras_no_ano: null, observacoes: "" },
  confiabilidade: { pixel: "nao_sei", api_de_conversoes: "nao_sei", evento_principal: "", janela_de_atribuicao: "", armadilhas: "" },
  mercado: { sazonalidade: "", ciclo_de_compra_dias: null, datas: [] },
  dados: { fonte_que_prevalece: "nao_definido", observacoes: "" },
};

/** Resposta tolerante: campo ausente vira vazio, nunca erro. */
export function normalizarMemoria(d: unknown): MemoriaNaTela {
  const o = obj(d);
  const p = obj(o.preenchidas), f = obj(p.financas), q = obj(p.confiabilidade), m = obj(p.mercado), da = obj(p.dados);
  const fin = obj(o.financas);
  return {
    disponivel: o.disponivel !== false,
    versao: num(o.versao) ?? 0,
    atualizada_em: typeof o.atualizada_em === "string" ? o.atualizada_em : null,
    preenchidas: {
      comportamento: { observacoes: txt(obj(p.comportamento).observacoes) },
      financas: {
        ticket_medio_brl: num(f.ticket_medio_brl),
        margem_pct: num(f.margem_pct),
        conversao: f.conversao === "lead" ? "lead" : "venda",
        taxa_fechamento_pct: num(f.taxa_fechamento_pct),
        compras_no_ano: num(f.compras_no_ano),
        observacoes: txt(f.observacoes),
      },
      confiabilidade: {
        pixel: (["ok", "com_problema", "nao_tem", "nao_sei"].includes(q.pixel) ? q.pixel : "nao_sei") as Situacao,
        api_de_conversoes: (["ok", "com_problema", "nao_tem", "nao_sei"].includes(q.api_de_conversoes) ? q.api_de_conversoes : "nao_sei") as Situacao,
        evento_principal: txt(q.evento_principal),
        janela_de_atribuicao: txt(q.janela_de_atribuicao),
        armadilhas: txt(q.armadilhas),
      },
      mercado: {
        sazonalidade: txt(m.sazonalidade),
        ciclo_de_compra_dias: num(m.ciclo_de_compra_dias),
        datas: lista(m.datas).map((x) => ({ dia: txt(obj(x).dia), nome: txt(obj(x).nome) })).filter((x) => x.dia && x.nome),
      },
      dados: {
        fonte_que_prevalece: (["meta", "vendas_registradas", "crm", "nao_definido"].includes(da.fonte_que_prevalece) ? da.fonte_que_prevalece : "nao_definido") as FonteQuePrevalece,
        observacoes: txt(da.observacoes),
      },
    },
    financas: {
      custo_maximo_brl: num(fin.custo_maximo_brl),
      por: fin.por === "compra" || fin.por === "lead" ? fin.por : null,
      roas_de_equilibrio: num(fin.roas_de_equilibrio),
      valor_do_cliente_no_ano_brl: num(fin.valor_do_cliente_no_ano_brl),
      faltando: lista(fin.faltando).map(txt).filter(Boolean),
      contas: lista(fin.contas).map(txt).filter(Boolean),
    },
    camadas: lista(o.camadas).map((c) => ({ id: txt(obj(c).id), titulo: txt(obj(c).titulo), fonte: txt(obj(c).fonte), linhas: lista(obj(c).linhas).map(txt).filter(Boolean) })).filter((c) => c.id),
  };
}

export const chavesMemoria = { conta: (clientId: string) => ["mesa-ads", "memoria", clientId] as const };

export async function lerMemoria(clientId: string): Promise<MemoriaNaTela> {
  return normalizarMemoria(await chamarAds("memoria_ler", { client_id: clientId }));
}

export async function salvarMemoria(clientId: string, camadas: Preenchidas, versao: number): Promise<MemoriaNaTela> {
  return normalizarMemoria(await chamarAds("memoria_salvar", { client_id: clientId, camadas, versao }));
}
