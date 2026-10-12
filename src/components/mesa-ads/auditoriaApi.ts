/**
 * Alertas da Conta ao vivo e Auditoria da conta (12/10/2026): tipos tolerantes e as chamadas
 * conta_alertas, auditoria_rodar e auditoria_ler da mesa-ads. Tudo é calculado no servidor em
 * código (sem IA, sem custo); a tela só mostra.
 */
import { chamarAds } from "./adsApi";

export type NivelDoAlerta = "atencao" | "critico";
export interface AlertaNaTela {
  nivel: NivelDoAlerta;
  tipo: string;
  alvo: { nivel: string; meta_id: string; nome: string } | null;
  titulo: string;
  texto: string;
  camada: string;
}

export type Resultado = "passou" | "falhou" | "sem_dado" | "nao_se_aplica";
export interface ControleNaTela {
  id: string;
  categoria: string;
  nome: string;
  severidade: "critico" | "alto" | "medio" | "informativo";
  resultado: Resultado;
  evidencia: string;
  acao: string | null;
}
export interface CategoriaNaTela {
  categoria: string;
  rotulo: string;
  saude: number | null;
  cobertura: number;
  peso: number;
}
export interface AuditoriaNaTela {
  id: string | null;
  nota: number | null;
  cobertura: number;
  faixa: "valendo" | "provisoria" | "dado_insuficiente";
  categorias: CategoriaNaTela[];
  controles: ControleNaTela[];
  prioridades: ControleNaTela[];
  criado_em: string | null;
}

const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const txt = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);

export function normalizarAlerta(v: unknown): AlertaNaTela | null {
  const a = obj(v);
  if (!txt(a.titulo)) return null;
  const alvo = obj(a.alvo);
  return {
    nivel: a.nivel === "critico" ? "critico" : "atencao",
    tipo: txt(a.tipo),
    alvo: txt(alvo.meta_id) ? { nivel: txt(alvo.nivel), meta_id: txt(alvo.meta_id), nome: txt(alvo.nome) } : null,
    titulo: txt(a.titulo),
    texto: txt(a.texto),
    camada: txt(a.camada),
  };
}

const normalizarControle = (v: unknown): ControleNaTela => {
  const c = obj(v);
  const sev = ["critico", "alto", "medio", "informativo"].includes(c.severidade) ? c.severidade : "medio";
  const res = ["passou", "falhou", "sem_dado", "nao_se_aplica"].includes(c.resultado) ? c.resultado : "sem_dado";
  return { id: txt(c.id), categoria: txt(c.categoria), nome: txt(c.nome), severidade: sev, resultado: res, evidencia: txt(c.evidencia), acao: txt(c.acao) || null };
};

export function normalizarAuditoria(v: unknown): AuditoriaNaTela | null {
  const a = obj(v);
  if (typeof a.cobertura !== "number") return null;
  return {
    id: txt(a.id) || null,
    nota: num(a.nota),
    cobertura: num(a.cobertura) ?? 0,
    faixa: a.faixa === "valendo" || a.faixa === "provisoria" ? a.faixa : "dado_insuficiente",
    categorias: lista(a.categorias).map((c) => ({ categoria: txt(obj(c).categoria), rotulo: txt(obj(c).rotulo), saude: num(obj(c).saude), cobertura: num(obj(c).cobertura) ?? 0, peso: num(obj(c).peso) ?? 0 })),
    controles: lista(a.controles).map(normalizarControle),
    prioridades: lista(a.prioridades).map(normalizarControle),
    criado_em: txt(a.criado_em) || null,
  };
}

export const chavesAuditoria = {
  alertas: (clientId: string) => ["mesa-ads", "alertas", clientId] as const,
  auditorias: (clientId: string) => ["mesa-ads", "auditorias", clientId] as const,
};

export async function lerAlertas(clientId: string): Promise<AlertaNaTela[]> {
  const d = await chamarAds("conta_alertas", { client_id: clientId });
  return lista(obj(d).alertas).map(normalizarAlerta).filter((x): x is AlertaNaTela => !!x);
}

export async function lerAuditorias(clientId: string): Promise<AuditoriaNaTela[]> {
  const d = await chamarAds("auditoria_ler", { client_id: clientId });
  return lista(obj(d).ultimas).map(normalizarAuditoria).filter((x): x is AuditoriaNaTela => !!x);
}

export async function rodarAuditoria(clientId: string): Promise<AuditoriaNaTela | null> {
  const d = await chamarAds("auditoria_rodar", { client_id: clientId });
  return normalizarAuditoria(obj(d).auditoria);
}
