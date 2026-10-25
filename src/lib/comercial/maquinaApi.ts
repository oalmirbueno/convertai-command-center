import { chamarFuncao, CUSTO_DA_CONFERENCIA_DO_JEV_USD } from "@/lib/mesa/api";
import type { FonteDaBusca } from "../../../supabase/functions/comercial-leads/regras";

/**
 * Máquina de leads na tela (25/10/2026): a função comercial-leads. Quem busca é o worker "leads" desta
 * casa (workers/leads); a tela cria a busca, acompanha o andamento e leva os escolhidos ao CRM.
 */

export type SituacaoDaBusca = "na_fila" | "rodando" | "pronta" | "falhou" | "cancelada";

export interface BuscaDeLeads {
  id: string;
  nicho: string;
  cidade: string;
  uf: string | null;
  fontes: FonteDaBusca[];
  limite: number;
  situacao: SituacaoDaBusca;
  erro: string | null;
  encontrados: number;
  progresso: { etapa?: string; feitos?: number; total?: number } | null;
  campanha_id: string | null;
  entregar_ao_mercurio: boolean;
  urls?: string[];
  created_at: string;
  terminado_em: string | null;
}

export interface EvidenciaDoCandidato {
  campo: string | null;
  valor: string | null;
  fonte: string | null;
  url: string | null;
}

export interface CandidatoDeLead {
  id: string;
  busca_id: string;
  nome: string;
  categoria: string | null;
  site: string | null;
  telefone: string | null;
  whatsapp: string | null;
  email: string | null;
  instagram: string | null;
  endereco: string | null;
  cidade: string | null;
  fonte: string;
  fonte_url: string | null;
  evidencias: EvidenciaDoCandidato[];
  nota: number | null;
  porque: string | null;
  situacao: "novo" | "importado" | "descartado";
  lead_id: string | null;
}

export interface NovaBusca {
  nicho: string;
  cidade: string;
  uf: string | null;
  fontes: FonteDaBusca[];
  limite: number;
  campanha_id: string | null;
  entregar_ao_mercurio: boolean;
  urls: string[];
}

export const chavesDaMaquina = {
  buscas: ["comercial", "maquina-de-leads", "buscas"] as const,
  candidatos: (id: string) => ["comercial", "maquina-de-leads", "candidatos", id] as const,
};

const chamar = <T>(corpo: Record<string, unknown>) => chamarFuncao<T>("comercial-leads", corpo);

export const listarBuscas = () => chamar<{ buscas: BuscaDeLeads[] }>({ acao: "listar_buscas" }).then((r) => r.buscas || []);
export const criarBusca = (b: NovaBusca) => chamar<{ busca: BuscaDeLeads }>({ acao: "criar_busca", ...b }).then((r) => r.busca);
export const cancelarBusca = (id: string) => chamar<{ busca: BuscaDeLeads }>({ acao: "cancelar_busca", busca_id: id }).then((r) => r.busca);
export const lerCandidatos = (id: string) => chamar<{ busca: BuscaDeLeads; candidatos: CandidatoDeLead[] }>({ acao: "candidatos", busca_id: id });
export const avaliarComJev = (id: string, candidatoIds: string[]) => chamar<{ avaliados: Array<{ id: string; nota: number | null; porque: string | null }>; custo_usd: number }>({ acao: "avaliar", busca_id: id, candidato_ids: candidatoIds });
export const importarParaOCrm = (id: string, candidatoIds: string[], mercurio: boolean) =>
  chamar<{ importados: Array<{ candidato_id: string; lead_id: string }>; repetidos: Array<{ candidato_id: string; lead_id: string }> }>({ acao: "importar", busca_id: id, candidato_ids: candidatoIds, mercurio });
export const descartarCandidatos = (id: string, candidatoIds: string[], voltar = false) => chamar<{ candidatos: CandidatoDeLead[] }>({ acao: "descartar", busca_id: id, candidato_ids: candidatoIds, voltar });

/** O custo antes de avaliar: uma conferência do Jev a cada 20 candidatos. */
export const custoDaAvaliacao = (n: number) => Math.ceil(Math.max(0, n) / 20) * CUSTO_DA_CONFERENCIA_DO_JEV_USD;

/** Ainda andando (a tela relê sozinha). */
export const buscaAndando = (b: Pick<BuscaDeLeads, "situacao">) => b.situacao === "na_fila" || b.situacao === "rodando";

/** O estado da busca em palavras. */
export function estadoDaBusca(b: BuscaDeLeads): string {
  if (b.situacao === "na_fila") return "Na fila";
  if (b.situacao === "rodando") {
    const p = b.progresso || {};
    const total = Number(p.total) || 0;
    return total ? `${p.etapa || "Buscando"} · ${Number(p.feitos) || 0} de ${total}` : p.etapa || "Buscando";
  }
  if (b.situacao === "pronta") return `${b.encontrados} ${b.encontrados === 1 ? "encontrado" : "encontrados"}`;
  if (b.situacao === "cancelada") return `Cancelada · ${b.encontrados} encontrados`;
  return b.erro || "Falhou";
}

/** Link do WhatsApp para o número em +55... */
export const linkDoWhatsapp = (numero: string) => `https://wa.me/${numero.replace(/\D/g, "")}`;

/** Telefone para ler: +5541999887766 vira (41) 99988-7766. */
export function telefoneLegivel(t: string | null): string {
  const d = String(t || "").replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t || "";
}

export const ROTULO_DA_ORIGEM_DO_DADO: Record<string, string> = {
  osm: "OpenStreetMap",
  site: "site da empresa",
  lista: "site colado",
  brasilapi: "BrasilAPI (CNPJ)",
};
