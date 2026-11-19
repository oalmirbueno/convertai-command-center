import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import { gravarNoKit } from "@/components/mesa/kitDaMesa";
import { hexParaOklch } from "../../../supabase/functions/_shared/cores/oklch";
import type { Briefing, Proposta } from "../../../supabase/functions/_shared/cores/paleta";

/** Textos que a IA escreve por cima da regra, e a nota do Jev (1 a 5). */
export type TextosDaIa = {
  resumo: string;
  propostas: Record<string, { titulo: string; frase: string; diagnostico: string; cores: Record<string, string> }>;
  mensagem: string;
  checklist: string[];
  ideias: string[];
  notas: Record<string, number | null>;
  escrito_em: string;
};

export type ModoDeEntrada = "cliente" | "briefing" | "zero" | "nicho" | "manual";

export type ProjetoDeCor = {
  id: string;
  client_id: string | null;
  titulo: string;
  modo: ModoDeEntrada;
  briefing: Briefing;
  propostas: Proposta[];
  escolhida: string | null;
  textos: Partial<TextosDaIa>;
  favorita: boolean;
  aplicada_em: string | null;
  atualizado_em: string;
};

const db = supabase as any;
const TABELA = "atelie_cor_projetos";

export function useProjetosDeCor() {
  return useQuery({
    queryKey: ["atelie-cor", "projetos"],
    staleTime: 30_000,
    queryFn: async (): Promise<ProjetoDeCor[]> => {
      const { data, error } = await db.from(TABELA).select("*").order("atualizado_em", { ascending: false }).limit(60);
      if (error) throw error;
      return (data || []) as ProjetoDeCor[];
    },
  });
}

export function useInvalidarProjetos() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["atelie-cor", "projetos"] });
}

export async function salvarProjeto(p: Omit<ProjetoDeCor, "id" | "atualizado_em" | "favorita" | "aplicada_em"> & { id?: string | null; favorita?: boolean }): Promise<ProjetoDeCor> {
  const campos = { client_id: p.client_id, titulo: p.titulo.slice(0, 120) || "Paleta", modo: p.modo, briefing: p.briefing, propostas: p.propostas, escolhida: p.escolhida, textos: p.textos, ...(p.favorita !== undefined ? { favorita: p.favorita } : {}) };
  if (p.id) {
    const { data, error } = await db.from(TABELA).update(campos).eq("id", p.id).select("*").single();
    if (error) throw error;
    return data as ProjetoDeCor;
  }
  const { data, error } = await db.from(TABELA).insert(campos).select("*").single();
  if (error) throw error;
  return data as ProjetoDeCor;
}

export async function apagarProjeto(id: string) {
  const { error } = await db.from(TABELA).delete().eq("id", id);
  if (error) throw error;
}

export async function marcarAplicada(id: string) {
  await db.from(TABELA).update({ aplicada_em: new Date().toISOString() }).eq("id", id);
}

/**
 * A proposta no kit do cliente, no formato que o Estúdio lê ([{nome, hex, papel}]):
 * a cor de marca mais viva entre dominante e apoio vira "primaria", a outra
 * "secundaria" (ou "neutra" se for quase cinza), o destaque "destaque" e os
 * neutros "neutra". Assim o Estúdio não toma um fundo creme por cor da marca.
 */
export function paletaParaKit(p: Proposta): Array<{ nome: string; hex: string; papel: string }> {
  const dom = p.cores.find((c) => c.papel === "dominante")!;
  const ap = p.cores.find((c) => c.papel === "apoio");
  const des = p.cores.find((c) => c.papel === "destaque");
  const [marca, outra] = ap && hexParaOklch(ap.hex).c > hexParaOklch(dom.hex).c ? [ap, dom] : [dom, ap];
  const lista: Array<{ nome: string; hex: string; papel: string }> = [{ nome: marca.nome, hex: marca.hex, papel: "primaria" }];
  if (outra) lista.push({ nome: outra.nome, hex: outra.hex, papel: hexParaOklch(outra.hex).c < 0.03 ? "neutra" : "secundaria" });
  if (des) lista.push({ nome: des.nome, hex: des.hex, papel: "destaque" });
  for (const c of p.cores.filter((k) => k.papel === "extra")) lista.push({ nome: c.nome, hex: c.hex, papel: "secundaria" });
  lista.push({ nome: "Tinta", hex: p.neutros.tinta, papel: "neutra" }, { nome: "Papel", hex: p.neutros.papel, papel: "neutra" });
  return lista;
}

export async function aplicarNoKit(clientId: string, p: Proposta, userId: string | null | undefined) {
  await gravarNoKit({ tabela: "cliente_kit_marca", clientId } as any, { paleta: paletaParaKit(p) }, userId);
}

export async function lerBriefingComIa(clientId: string, texto: string) {
  return chamarFuncao<{ briefing: Briefing; faltou: string[]; custo_usd: number }>("mesa-identidade", { acao: "cores_ler_briefing", client_id: clientId, texto });
}

export async function escreverComIa(clientId: string, briefing: Briefing, propostas: Proposta[], escolhida: string | null) {
  return chamarFuncao<{ textos: TextosDaIa; aviso_jev: string | null; custo_usd: number }>("mesa-identidade", {
    acao: "cores_escrever",
    client_id: clientId,
    briefing,
    escolhida,
    propostas: propostas.map((p) => ({ id: p.id, estrutura: p.estrutura, etiquetas: p.etiquetas, cores: p.cores.map((c) => ({ papel: c.papel, hex: c.hex, nome: c.nome })) })),
  });
}

/** Baixa um arquivo gerado na tela. */
export function baixar(nome: string, conteudo: string | Uint8Array, tipo: string) {
  const blob = new Blob([conteudo as BlobPart], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function nomeDeArquivo(s: string) {
  return (s || "paleta").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "paleta";
}
