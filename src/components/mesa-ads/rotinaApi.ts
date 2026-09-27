/**
 * Rotina de monitoramento do tráfego (frente TR, 27/09): tipos, normalização
 * tolerante e as chamadas rotina_* da mesa-ads. O servidor decide tudo (regra
 * em código, Jev no caso de julgamento, travas duras); a tela mostra o que o
 * agente está olhando, o que fez com a prova, o que pretende fazer, e dá os
 * três controles do dono: Pausar a rotina, Desfazer por ação e Interferir.
 */
import { chamarAds } from "./adsApi";
import { caminhoDaTela, type CaminhoNaTela } from "./acoesDoAgenteApi";

export interface AlvoNaTela {
  nivel: string;
  meta_id: string;
  nome: string;
}

export interface RegraNaTela {
  id: string;
  texto: string;
  tipo: string;
  alvos: AlvoNaTela[];
  ate: string | null;
  ativa: boolean;
  /** "Não pausar: conjunto Raio 5 km, até 03/10" (feito no servidor). */
  texto_da_regra: string;
  /** Ainda vale hoje (ativa e dentro do prazo). */
  vale: boolean;
}

export interface EstadoDaRotinaNaTela {
  rodada_em: string | null;
  olhando: string;
  fez: string[];
  planeja: string[];
  parou_por: string | null;
  bloqueio: string | null;
  sincronizado_em: string | null;
  proxima_rodada_em: string | null;
}

export interface RotinaNaTela {
  ligada: boolean;
  teto_diario_brl: number | null;
  subida_max_pct: number;
  max_acoes_rodada: number;
  max_acoes_dia: number;
  limites: Record<string, number>;
  regras: RegraNaTela[];
  estado: EstadoDaRotinaNaTela | null;
  ultima_rodada_em: string | null;
  proxima_rodada_em: string | null;
  ligada_em: string | null;
  pausada_em: string | null;
}

export interface EstadoLidoNaTela {
  status: string | null;
  orcamento_diario_brl: number | null;
  nome: string | null;
}

/** A prova da ação: os números que motivaram, a fonte e a hora, o antes e o depois na Meta, e o Jev. */
export interface ProvaNaTela {
  periodo: { inicio: string; fim: string; dias: number } | null;
  gasto: number | null;
  impressoes: number | null;
  resultados: number | null;
  resultado_rotulo: string;
  custo_por_resultado: number | null;
  ctr_link_pct: number | null;
  frequencia: number | null;
  fonte: string;
  sincronizado_em: string | null;
  relido_na_meta_em: string | null;
  regra: string;
  custo_alvo_brl: number | null;
  fonte_do_alvo: string;
  antes: EstadoLidoNaTela | null;
  depois: EstadoLidoNaTela | null;
  jev: { escolha: string | null; probabilidade: number | null } | null;
  decisao: string;
  pedido_ao_agente: string;
  /** "Ir para ..." (contrato comum dos agentes; só rota interna). */
  caminho: CaminhoNaTela | null;
}

export interface AcaoFeita {
  id: string;
  origem: "rotina" | "agente";
  tipo: string;
  estado: "feita" | "falhou" | "proposta" | "desfeita" | "descartada";
  alvo: AlvoNaTela | null;
  resumo: string;
  porque: string;
  prova: ProvaNaTela | null;
  resultado_depois: { em: string; gasto: number | null; resultados: number | null; custo_por_resultado: number | null } | null;
  criado_em: string;
  desfeita_em: string | null;
  pode_desfazer: boolean;
}

export interface LeituraDaRotina {
  disponivel: boolean;
  motivo: string | null;
  rotina: RotinaNaTela | null;
  acoes: AcaoFeita[];
  /** Aviso da última ação (ex.: a regra entrou como "só avisar" porque o Jev não respondeu). */
  aviso: string | null;
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || typeof v === "boolean" || !isFinite(Number(v)) ? null : Number(v));

function estadoLido(v: unknown): EstadoLidoNaTela | null {
  const o = obj(v);
  if (!Object.keys(o).length) return null;
  return { status: txt(o.status) || null, orcamento_diario_brl: num(o.orcamento_diario_brl), nome: txt(o.nome) || null };
}

function alvo(v: unknown): AlvoNaTela | null {
  const o = obj(v);
  return txt(o.meta_id) ? { nivel: txt(o.nivel), meta_id: txt(o.meta_id), nome: txt(o.nome) || txt(o.meta_id) } : null;
}

export function normalizarProva(bruto: unknown): ProvaNaTela | null {
  const p = obj(bruto);
  if (!Object.keys(p).length) return null;
  const n = obj(p.numeros);
  const periodo = obj(n.periodo);
  const limites = obj(p.limites);
  const jev = p.jev ? obj(p.jev) : null;
  return {
    periodo: txt(periodo.inicio) ? { inicio: txt(periodo.inicio), fim: txt(periodo.fim), dias: num(periodo.dias) || 0 } : null,
    gasto: num(n.gasto),
    impressoes: num(n.impressoes),
    resultados: num(n.resultados),
    resultado_rotulo: txt(n.resultado_rotulo) || "resultados",
    custo_por_resultado: num(n.custo_por_resultado),
    ctr_link_pct: num(n.ctr_link_pct),
    frequencia: num(n.frequencia),
    fonte: txt(p.fonte),
    sincronizado_em: txt(p.sincronizado_em) || txt(n.atualizado_em) || null,
    relido_na_meta_em: txt(p.relido_na_meta_em) || null,
    regra: txt(p.regra),
    custo_alvo_brl: num(limites.custo_alvo_brl),
    fonte_do_alvo: txt(limites.fonte_do_alvo),
    antes: estadoLido(p.antes),
    depois: estadoLido(p.depois),
    jev: jev && (txt(jev.escolha) || num(jev.probabilidade) !== null) ? { escolha: txt(jev.escolha) || null, probabilidade: num(jev.probabilidade) } : null,
    decisao: txt(p.decisao),
    pedido_ao_agente: txt(p.pedido_ao_agente),
    caminho: caminhoDaTela(p.caminho),
  };
}

const ESTADOS = ["feita", "falhou", "proposta", "desfeita", "descartada"];

export function normalizarRotina(bruto: unknown): LeituraDaRotina {
  const r = obj(bruto);
  const disponivel = r.disponivel !== false;
  const ro = r.rotina ? obj(r.rotina) : null;
  const e = ro && ro.estado ? obj(ro.estado) : null;
  const rotina: RotinaNaTela | null = ro
    ? {
        ligada: !!ro.ligada,
        teto_diario_brl: num(ro.teto_diario_brl),
        subida_max_pct: num(ro.subida_max_pct) || 20,
        max_acoes_rodada: num(ro.max_acoes_rodada) || 3,
        max_acoes_dia: num(ro.max_acoes_dia) || 6,
        limites: Object.keys(obj(ro.limites)).reduce((acc, k) => {
          const v = num(obj(ro.limites)[k]);
          if (v !== null) acc[k] = v;
          return acc;
        }, {} as Record<string, number>),
        regras: lista(ro.regras)
          .map((x) => {
            const o = obj(x);
            return {
              id: txt(o.id),
              texto: txt(o.texto),
              tipo: txt(o.tipo) || "outra",
              alvos: lista(o.alvos).map(alvo).filter((a): a is AlvoNaTela => !!a),
              ate: txt(o.ate) || null,
              ativa: o.ativa !== false,
              texto_da_regra: txt(o.texto_da_regra),
              vale: o.vale !== false && o.ativa !== false,
            };
          })
          .filter((x) => !!x.id && !!x.texto),
        estado: e && Object.keys(e).length
          ? {
              rodada_em: txt(e.rodada_em) || null,
              olhando: txt(e.olhando),
              fez: lista(e.fez).map(txt).filter(Boolean),
              planeja: lista(e.planeja).map(txt).filter(Boolean),
              parou_por: txt(e.parou_por) || null,
              bloqueio: txt(e.bloqueio) || null,
              sincronizado_em: txt(e.sincronizado_em) || null,
              proxima_rodada_em: txt(e.proxima_rodada_em) || null,
            }
          : null,
        ultima_rodada_em: txt(ro.ultima_rodada_em) || null,
        proxima_rodada_em: txt(ro.proxima_rodada_em) || null,
        ligada_em: txt(ro.ligada_em) || null,
        pausada_em: txt(ro.pausada_em) || null,
      }
    : null;
  const acoes: AcaoFeita[] = lista(r.acoes)
    .map((x) => {
      const o = obj(x);
      const depois = o.resultado_depois ? obj(o.resultado_depois) : null;
      const conta = depois ? obj(depois.conta) : {};
      return {
        id: txt(o.id),
        origem: (o.origem === "agente" ? "agente" : "rotina") as AcaoFeita["origem"],
        tipo: txt(o.tipo),
        estado: (ESTADOS.indexOf(o.estado) >= 0 ? o.estado : "feita") as AcaoFeita["estado"],
        alvo: alvo(o.alvo),
        resumo: txt(o.resumo),
        porque: txt(o.porque),
        prova: normalizarProva(o.prova),
        resultado_depois: depois ? { em: txt(depois.em), gasto: num(conta.gasto), resultados: num(conta.resultados), custo_por_resultado: num(conta.custo_por_resultado) } : null,
        criado_em: txt(o.criado_em),
        desfeita_em: txt(o.desfeita_em) || null,
        pode_desfazer: !!o.pode_desfazer,
      };
    })
    .filter((a) => !!a.id && !!a.resumo);
  return { disponivel, motivo: txt(r.motivo) || null, rotina, acoes, aviso: txt(r.aviso) || null };
}

export const chavesRotina = {
  rotina: (clientId: string) => ["mesa", "ads", "rotina", clientId] as const,
};

export async function lerRotina(clientId: string): Promise<LeituraDaRotina> {
  return normalizarRotina(await chamarAds<any>("rotina_ler", { client_id: clientId }));
}

export async function salvarRotina(clientId: string, campos: Record<string, unknown>): Promise<LeituraDaRotina> {
  return normalizarRotina(await chamarAds<any>("rotina_salvar", { client_id: clientId, ...campos }));
}

/** "Interferir": a instrução do dono vira regra (o Jev lê o tipo, o alvo e o prazo; centavos). */
export async function mandarRegra(clientId: string, texto: string): Promise<LeituraDaRotina> {
  return normalizarRotina(await chamarAds<any>("rotina_regra", { client_id: clientId, texto }));
}

export async function tirarRegra(clientId: string, id: string): Promise<LeituraDaRotina> {
  return normalizarRotina(await chamarAds<any>("rotina_regra", { client_id: clientId, remover: id }));
}

export async function rodarAgora(clientId: string): Promise<LeituraDaRotina & { feitas: number }> {
  const data = await chamarAds<any>("rotina_rodar", { client_id: clientId });
  return { ...normalizarRotina(data), feitas: num(obj(obj(data).resumo).feitas) || 0 };
}

export async function desfazerAcaoFeita(acaoId: string): Promise<LeituraDaRotina> {
  return normalizarRotina(await chamarAds<any>("rotina_desfazer", { acao_id: acaoId }));
}

export async function descartarProposta(acaoId: string): Promise<LeituraDaRotina> {
  return normalizarRotina(await chamarAds<any>("rotina_proposta_descartar", { acao_id: acaoId }));
}

/** Uma chamada do Jev para ler a instrução (tipo, alvo e prazo): alguns centavos. */
export const CUSTO_DA_REGRA_USD = 0.01;

/** "há 5 min", "às 14:43" etc. ficam no adsApi (tempoDesde); aqui só a hora curta de São Paulo. */
export function horaCurta(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!isFinite(t)) return "";
  const d = new Date(t);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
