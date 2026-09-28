import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DependenciasDaAmostra } from "./amostraDaFonte";

/**
 * Tipografia do cliente na tela (frente T2, 26/09/2026): as fontes que valem
 * para a marca aberta, com a mesma regra do servidor (fontesDaMarca em
 * supabase/functions/_shared/marca.ts):
 * - sem marca (cliente com uma marca só): todas as fontes do cliente;
 * - marca principal: as do cliente (sem marca) e as dela;
 * - outra marca (ex.: CME dentro da Acerbi): só as dela (frente AE, 28/09,
 *   dono: "está misturando tudo"); sem nenhuma, o Estúdio trava e oferece
 *   copiar as do cliente para ela num clique. Fonte de OUTRA marca nunca entra.
 *
 * A consulta é sempre por client_id e a chave do cache leva o cliente e a
 * marca: trocar de cliente ou de marca nunca mostra a fonte do outro.
 * Kit sem fonte que valha: o Estúdio bloqueia a geração (não inventa).
 */

export interface FonteDaTipografia {
  id: string;
  client_id?: string;
  nome: string;
  papel: string;
  storage_path: string;
  amostra_path: string | null;
  origem: string;
  biblioteca_id: string | null;
  marca_id: string | null;
}

export type MarcaDaTipografia = { id: string; principal: boolean } | null | undefined;

/** Mesma regra do servidor (fontesDaMarca). */
export function fontesDaMarcaNaTela<F extends { marca_id?: string | null }>(fontes: F[], marca: MarcaDaTipografia): F[] {
  if (!marca) return fontes;
  if (marca.principal) return fontes.filter((f) => !f.marca_id || f.marca_id === marca.id);
  // Frente AE (28/09): outra marca fica só com as dela (sem nenhuma, trava; a tela oferece copiar as da principal).
  return fontes.filter((f) => f.marca_id === marca.id);
}

/** Outra marca sem fonte própria, com fontes do cliente que dá para copiar para ela (a tela oferece, num clique). */
export function usaFontesDoCliente(fontes: { marca_id?: string | null }[], marca: MarcaDaTipografia): boolean {
  return !!marca && !marca.principal && !fontes.some((f) => f.marca_id === marca.id) && fontes.some((f) => !f.marca_id);
}

/** Igual ao servidor (tipografiaDoKit): vale se ao menos uma fonte tem nome. */
export function temTipografia(fontes: { nome?: string | null }[] | null | undefined): boolean {
  return (fontes || []).some((f) => !!f && typeof f.nome === "string" && f.nome.trim() !== "");
}

/** marca_id para gravar uma fonte nova: só de outra marca (a principal fica no cliente). */
export function marcaParaGravarNaTela(marca: MarcaDaTipografia): { marca_id: string } | Record<string, never> {
  return marca && !marca.principal ? { marca_id: marca.id } : {};
}

/** Chave do cache: debaixo de ["mesa", "fontes", cliente] (invalidada junto com as fontes), com a marca. */
export const chaveDaTipografia = (clientId: string, marcaId?: string | null) => ["mesa", "fontes", clientId, "tipografia", marcaId || "geral"];

const COLUNAS = "id, client_id, nome, papel, storage_path, amostra_path, origem, biblioteca_id";

/** Fontes do cliente com a marca de cada uma (sem a coluna marca_id no banco: todas do cliente). */
export async function lerFontesComMarca(clientId: string): Promise<FonteDaTipografia[]> {
  const comMarca = await (supabase as any).from("cliente_fontes").select(`${COLUNAS}, marca_id`).eq("client_id", clientId).order("criado_em", { ascending: true });
  const r = comMarca.error
    ? await (supabase as any).from("cliente_fontes").select(COLUNAS).eq("client_id", clientId).order("criado_em", { ascending: true })
    : comMarca;
  if (r.error) throw r.error;
  return ((r.data || []) as FonteDaTipografia[])
    // Defesa: só as linhas deste cliente (a consulta já filtra).
    .filter((f) => !f.client_id || f.client_id === clientId)
    .map((f) => ({ ...f, origem: f.origem || "upload", biblioteca_id: f.biblioteca_id || null, marca_id: f.marca_id || null }));
}

/** Fontes que valem para a marca aberta (e todas, para quem precisa da lista inteira). */
export function useTipografiaDaMarca(clientId: string, marca: MarcaDaTipografia) {
  return useQuery({
    queryKey: chaveDaTipografia(clientId, marca ? marca.id : null),
    enabled: !!clientId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const todas = await lerFontesComMarca(clientId);
      const daMarca = fontesDaMarcaNaTela(todas, marca);
      return { todas, daMarca, temTipografia: temTipografia(daMarca), usaDoCliente: usaFontesDoCliente(todas, marca) };
    },
  });
}

/** A marca aberta está sem tipografia? Enquanto lê: false (sem bloqueio, para não piscar). */
export function useSemTipografia(clientId: string, marca: MarcaDaTipografia): boolean {
  const q = useTipografiaDaMarca(clientId, marca);
  return !!q.data && !q.data.temTipografia;
}

/** Dependências reais da amostra (Storage mesa e cliente_fontes), sempre presas ao cliente. */
export function depsDaAmostraNoSupabase(clientId: string): DependenciasDaAmostra {
  return {
    baixar: async (caminho) => {
      const { data, error } = await supabase.storage.from("mesa").download(caminho);
      if (error || !data) throw error || new Error("Arquivo da fonte indisponível.");
      return data;
    },
    enviar: async (caminho, png) => {
      const { error } = await supabase.storage.from("mesa").upload(caminho, png, { contentType: "image/png", upsert: true });
      if (error) throw error;
    },
    registrar: async (fonteId, caminho) => {
      const { error } = await (supabase as any).from("cliente_fontes").update({ amostra_path: caminho }).eq("id", fonteId).eq("client_id", clientId);
      if (error) throw error;
    },
    remover: async (caminhos) => {
      await supabase.storage.from("mesa").remove(caminhos);
    },
  };
}
