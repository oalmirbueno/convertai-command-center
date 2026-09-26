/**
 * Agente sênior de tráfego (Mesa Ads v5): tipos, normalização tolerante da
 * estratégia e as chamadas conta_conversar e conta_conversa_ler. A estratégia
 * vem estruturada do servidor (diagnóstico, manter, cortar, escalar,
 * reestruturação, próximos criativos, pesquisa e perguntas).
 */
import { padraoPara, type ModeloIa, type ParteDaEstimativa } from "@/lib/mesa/api";
import { chamarAds } from "./adsApi";
import { normalizarAcoesDaConta, normalizarNumerosVistos, type AcoesDaConta, type NumerosVistos } from "./acoesDoAgenteApi";

export interface EstrategiaSenior {
  resposta: string;
  diagnostico: { titulo: string; detalhe: string; gravidade: "alta" | "media" | "baixa" }[];
  manter: { ad_id: string; porque: string }[];
  cortar: { ad_id: string; porque: string }[];
  escalar: { ad_id: string; porque: string; como: string }[];
  reestruturacao: {
    objetivo: string;
    porque: string;
    evento_otimizacao: string;
    campanhas: { nome: string; objetivo: string; orcamento_diario_brl: number | null; conjuntos: { nome: string; publico: string; orcamento_diario_brl: number | null; anuncios: string[] }[] }[];
    verba_total_diaria_brl: number | null;
    passos: string[];
  };
  proximos_criativos: { titulo: string; angulo: string; gancho_verbal: string; gancho_visual: string; formato: string; estilo_visual: string; objetivo: string; cta_meta: string; base_ad_id: string; porque: string }[];
  pesquisa: { achado: string; fonte: string }[];
  perguntas: string[];
  /** O teste que o agente montou (hipótese, variável, público, verba, duração, métrica e critério). */
  plano_de_teste: {
    hipotese: string;
    variavel: string;
    publico: string;
    orcamento_diario_brl: number | null;
    duracao_dias: number | null;
    metrica_decisao: string;
    criterio_vitoria: string;
  } | null;
}

export interface MensagemDoAgenteSenior {
  id: string;
  papel: "usuario" | "agente" | "sistema";
  conteudo: string;
  criado_em: string;
  estrategia: EstrategiaSenior | null;
  /** O que o agente viu (números do código, com fonte e período). */
  numeros: NumerosVistos | null;
  /** Ações propostas na conta, com o estado de cada uma. */
  acoes: AcoesDaConta | null;
}

const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const txt = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const valor = (v: unknown): number | null => (v === null || v === undefined || v === "" || !isFinite(Number(v)) ? null : Number(v));
const GRAVIDADES = ["alta", "media", "baixa"];

export function normalizarEstrategiaSenior(bruto: unknown): EstrategiaSenior | null {
  const r = obj(bruto);
  if (!Object.keys(r).length) return null;
  const re = obj(r.reestruturacao);
  return {
    resposta: txt(r.resposta),
    diagnostico: lista(r.diagnostico)
      .map((d) => ({ titulo: txt(obj(d).titulo), detalhe: txt(obj(d).detalhe), gravidade: (GRAVIDADES.indexOf(obj(d).gravidade) >= 0 ? obj(d).gravidade : "media") as "alta" | "media" | "baixa" }))
      .filter((d) => !!d.titulo),
    manter: lista(r.manter).map((x) => ({ ad_id: txt(obj(x).ad_id), porque: txt(obj(x).porque) })).filter((x) => !!x.ad_id),
    cortar: lista(r.cortar).map((x) => ({ ad_id: txt(obj(x).ad_id), porque: txt(obj(x).porque) })).filter((x) => !!x.ad_id),
    escalar: lista(r.escalar).map((x) => ({ ad_id: txt(obj(x).ad_id), porque: txt(obj(x).porque), como: txt(obj(x).como) })).filter((x) => !!x.ad_id),
    reestruturacao: {
      objetivo: txt(re.objetivo),
      porque: txt(re.porque),
      evento_otimizacao: txt(re.evento_otimizacao),
      campanhas: lista(re.campanhas).map((c) => ({
        nome: txt(obj(c).nome),
        objetivo: txt(obj(c).objetivo),
        orcamento_diario_brl: valor(obj(c).orcamento_diario_brl),
        conjuntos: lista(obj(c).conjuntos).map((j) => ({ nome: txt(obj(j).nome), publico: txt(obj(j).publico), orcamento_diario_brl: valor(obj(j).orcamento_diario_brl), anuncios: lista(obj(j).anuncios).map(txt).filter(Boolean) })),
      })).filter((c) => !!c.nome),
      verba_total_diaria_brl: valor(re.verba_total_diaria_brl),
      passos: lista(re.passos).map(txt).filter(Boolean),
    },
    proximos_criativos: lista(r.proximos_criativos).map((c) => {
      const o = obj(c);
      return {
        titulo: txt(o.titulo), angulo: txt(o.angulo), gancho_verbal: txt(o.gancho_verbal), gancho_visual: txt(o.gancho_visual), formato: txt(o.formato),
        estilo_visual: txt(o.estilo_visual), objetivo: txt(o.objetivo), cta_meta: txt(o.cta_meta), base_ad_id: txt(o.base_ad_id), porque: txt(o.porque),
      };
    }).filter((c) => !!c.titulo),
    pesquisa: lista(r.pesquisa).map((p) => ({ achado: txt(obj(p).achado), fonte: txt(obj(p).fonte) })).filter((p) => !!p.achado),
    perguntas: lista(r.perguntas).map(txt).filter(Boolean),
    plano_de_teste: (() => {
      const t = obj(r.plano_de_teste);
      if (!Object.keys(t).length) return null;
      return {
        hipotese: txt(t.hipotese),
        variavel: txt(t.variavel),
        publico: txt(t.publico),
        orcamento_diario_brl: valor(t.orcamento_diario_brl),
        duracao_dias: valor(t.duracao_dias),
        metrica_decisao: txt(t.metrica_decisao),
        criterio_vitoria: txt(t.criterio_vitoria),
      };
    })(),
  };
}

export function normalizarMensagensDoAgente(bruto: unknown): { conversa_id: string | null; mensagens: MensagemDoAgenteSenior[] } {
  const r = obj(bruto);
  return {
    conversa_id: txt(r.conversa_id) || null,
    mensagens: lista(r.mensagens)
      .map((m) => {
        const o = obj(m);
        const papel = o.papel === "usuario" || o.papel === "agente" ? o.papel : "sistema";
        return {
          id: txt(o.id),
          papel,
          conteudo: txt(o.conteudo),
          criado_em: txt(o.criado_em),
          estrategia: normalizarEstrategiaSenior(o.estrategia),
          numeros: normalizarNumerosVistos(o.numeros),
          acoes: normalizarAcoesDaConta(o.acoes),
        } as MensagemDoAgenteSenior;
      })
      .filter((m) => !!m.id && (!!m.conteudo || !!m.estrategia)),
  };
}

export const chavesAgente = {
  conversa: (clientId: string) => ["mesa", "ads", "agente-senior", clientId] as const,
};

export async function lerConversaDoAgente(clientId: string) {
  return normalizarMensagensDoAgente(await chamarAds("conta_conversa_ler", { client_id: clientId }));
}

/** Contexto grande (conta, evolução, criativos, contexto do cliente) + pesquisa web quando ligada. */
export const TAMANHO_DO_AGENTE_SENIOR = { entrada: 45000, saida: 7000, buscas: 5 };

export function partesDoAgenteSenior(catalogo: ModeloIa[], pesquisar: boolean): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "estrategista");
  return [{
    modeloId: m ? m.id : null,
    tipo: "texto",
    tokensEntrada: TAMANHO_DO_AGENTE_SENIOR.entrada,
    tokensSaida: TAMANHO_DO_AGENTE_SENIOR.saida,
    buscasWeb: pesquisar ? TAMANHO_DO_AGENTE_SENIOR.buscas : 0,
  }];
}

export const ROTULO_DA_GRAVIDADE: Record<string, string> = { alta: "Urgente", media: "Importante", baixa: "Ajuste" };
