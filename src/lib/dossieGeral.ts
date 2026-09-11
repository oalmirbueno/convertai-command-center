/**
 * O dossie GERAL do cliente e a fonte da verdade do "onde estamos".
 *
 * Um cliente pode ter varios dossies atuais (o geral e um por projeto). A
 * Central pegava "o mais recente" e, quando o do projeto era reescrito todo
 * dia, a mensagem do grupo passava a falar do projeto e esquecia o geral.
 * Regra do dono: a leitura e SEMPRE do geral final (dossier_type 'contexto',
 * sem projeto), nunca atrasada; os de projeto sao complemento.
 *
 * E a progressao vem de comparar a versao atual com a anterior: o que
 * entrou de novo entre uma e outra e o caminho que a semana andou.
 */

import { supabase } from "@/integrations/supabase/client";

export interface DossieLinha {
  id: string;
  client_id: string;
  project_id: string | null;
  dossier_type: string | null;
  version: number | null;
  summary: string | null;
  content: string | null;
  updated_at: string | null;
  effective_at?: string | null;
  prior_version_id?: string | null;
  change_reason?: string | null;
}

export interface DossieDoCliente {
  /** O geral atual. Null so quando o cliente nao tem dossie nenhum. */
  geral: DossieLinha | null;
  /** A versao imediatamente anterior do geral, quando existe. */
  anterior: DossieLinha | null;
  /** Linhas que entraram ou mudaram do anterior para o atual (ate 6). */
  mudancas: string[];
  /** Outros dossies atuais (por projeto), mais recente primeiro. */
  outros: DossieLinha[];
  /** Verdadeiro quando o "geral" e na verdade um substituto (nao ha geral). */
  substituto: boolean;
}

export function ehGeral(d: Pick<DossieLinha, "dossier_type" | "project_id">): boolean {
  return (d.dossier_type ?? "contexto") === "contexto" && d.project_id == null;
}

/** Entre os dossies atuais de um cliente, o geral; sem geral, o mais recente. */
export function escolherDossieGeral<T extends DossieLinha>(atuais: readonly T[]): { geral: T | null; substituto: boolean; outros: T[] } {
  const ordenados = [...atuais].sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  const geral = ordenados.find(ehGeral) ?? null;
  if (geral) return { geral, substituto: false, outros: ordenados.filter((d) => d.id !== geral.id) };
  const primeiro = ordenados[0] ?? null;
  return { geral: primeiro, substituto: primeiro !== null, outros: ordenados.slice(1) };
}

function paragrafos(texto: string | null | undefined): string[] {
  return String(texto ?? "")
    .split(/\r?\n+/)
    .map((l) => l.replace(/^[\s#*\-•>]+/, "").replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 12);
}

const normal = (l: string) => l.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();

/**
 * O que mudou do dossie anterior para o atual, em linhas curtas: so o que
 * entrou de novo (paragrafo que nao existia). Titulos de secao e a parte
 * automatica de "Avancos recentes" ficam de fora, porque nao sao mudanca de
 * situacao, sao rotulo.
 */
export function mudancasEntreVersoes(anterior: string | null | undefined, atual: string | null | undefined, limite = 6): string[] {
  const antes = new Set(paragrafos(anterior).map(normal));
  const novas: string[] = [];
  let dentroDoAutomatico = false;
  for (const linha of String(atual ?? "").split(/\r?\n/)) {
    if (/^##\s*avancos recentes/i.test(linha.trim()) || /^##\s*avanços recentes/i.test(linha.trim())) { dentroDoAutomatico = true; continue; }
    if (/^##?\s+/.test(linha.trim())) { dentroDoAutomatico = false; continue; }
    if (dentroDoAutomatico) continue;
    const limpa = linha.replace(/^[\s#*\-•>]+/, "").replace(/\s+/g, " ").trim();
    if (limpa.length < 12) continue;
    if (antes.has(normal(limpa))) continue;
    novas.push(limpa.length > 220 ? `${limpa.slice(0, 217).trimEnd()}…` : limpa);
    if (novas.length >= limite) break;
  }
  return novas;
}

export function montarDossieDoCliente(atuais: DossieLinha[], anteriores: Map<string, DossieLinha>): DossieDoCliente {
  const { geral, substituto, outros } = escolherDossieGeral(atuais);
  const anterior = geral?.prior_version_id ? anteriores.get(geral.prior_version_id) ?? null : null;
  const mudancas = geral && anterior ? mudancasEntreVersoes(anterior.content ?? anterior.summary, geral.content ?? geral.summary) : [];
  return { geral, anterior, mudancas, outros, substituto };
}

const CAMPOS = "id, client_id, project_id, dossier_type, version, summary, content, updated_at, effective_at, prior_version_id, change_reason";

/** Os dossies da carteira inteira em duas consultas: atuais + versoes anteriores dos gerais. */
export async function lerDossiesDaCarteira(clientIds?: readonly string[]): Promise<Map<string, DossieDoCliente>> {
  let q = (supabase as any).from("client_dossiers").select(CAMPOS).eq("is_current", true).order("updated_at", { ascending: false });
  if (clientIds && clientIds.length > 0) q = q.in("client_id", clientIds);
  const { data, error } = await q;
  if (error) throw error;
  const atuais = (data ?? []) as DossieLinha[];
  const porCliente = new Map<string, DossieLinha[]>();
  for (const d of atuais) porCliente.set(d.client_id, [...(porCliente.get(d.client_id) ?? []), d]);

  const idsAnteriores = Array.from(new Set(
    [...porCliente.values()].map((lista) => escolherDossieGeral(lista).geral?.prior_version_id).filter((x): x is string => Boolean(x)),
  ));
  const anteriores = new Map<string, DossieLinha>();
  if (idsAnteriores.length > 0) {
    const { data: prev } = await (supabase as any).from("client_dossiers").select(CAMPOS).in("id", idsAnteriores);
    for (const d of (prev ?? []) as DossieLinha[]) anteriores.set(d.id, d);
  }

  const out = new Map<string, DossieDoCliente>();
  for (const [clientId, lista] of porCliente) out.set(clientId, montarDossieDoCliente(lista, anteriores));
  return out;
}

/** O dossie de um cliente so (gaveta do Ciclo, perfil). */
export async function lerDossieDoCliente(clientId: string): Promise<DossieDoCliente> {
  const mapa = await lerDossiesDaCarteira([clientId]);
  return mapa.get(clientId) ?? { geral: null, anterior: null, mudancas: [], outros: [], substituto: false };
}

/** "v12 · atualizado há 3 h" para a tela. */
export function rotuloDoDossie(d: DossieDoCliente | null | undefined, agora: Date = new Date()): string {
  if (!d?.geral) return "sem dossiê";
  const ms = agora.getTime() - new Date(d.geral.updated_at ?? 0).getTime();
  const min = Math.max(0, Math.floor(ms / 60_000));
  const idade = min < 60 ? `${min} min` : min < 60 * 48 ? `${Math.floor(min / 60)} h` : `${Math.floor(min / 1440)} d`;
  return `${d.substituto ? "dossiê do projeto" : "dossiê geral"} v${d.geral.version ?? "?"} · atualizado há ${idade}${d.mudancas.length ? ` · ${d.mudancas.length} mudança${d.mudancas.length === 1 ? "" : "s"} desde a v${d.anterior?.version ?? "?"}` : ""}`;
}
