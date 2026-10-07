import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { GrupoDaFila, TipoDeAcao } from "./fila";

export const normalizarBusca = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export function filtrarPrioridades(grupos: GrupoDaFila[], busca: string, tipos: TipoDeAcao[] = []) {
  const termo = normalizarBusca(busca);
  return grupos.filter(g => normalizarBusca(g.nome).includes(termo))
    .map(g => ({ ...g, acoes: g.acoes.filter(a => !tipos.length || tipos.includes(a.tipo)) }))
    .filter(g => g.acoes.length > 0)
    .sort((a,b) => b.acoes[0].pontos - a.acoes[0].pontos
      || (a.acoes[0].prazo || "9999").localeCompare(b.acoes[0].prazo || "9999")
      || (b.acoes[0].diasEsperando || 0) - (a.acoes[0].diasEsperando || 0)
      || a.nome.localeCompare(b.nome, "pt-BR"));
}
export function avisoDoDossie(atual: { updated_at: string | null } | undefined, agora = Date.now()) {
  if (!atual) return "Sem dossiê geral registrado";
  const data = Date.parse(atual.updated_at || "");
  if (!Number.isFinite(data)) return "Conferir a data do dossiê";
  if (agora - data > 90 * 86400000) return "Dossiê sem revisão há mais de 90 dias";
  return null;
}
/** Só metadados, sem geração paga nem inferência sobre o conteúdo do cliente. */
export function useRevisoesDoDossie(clientes: { id: string; nome: string }[], enabled: boolean) {
  const ids = [...new Set(clientes.map(c => c.id))].sort();
  return useQuery({
    queryKey: ["mesa", "saude-conhecimento", ids], enabled: enabled && ids.length > 0,
    staleTime: 60_000, refetchOnWindowFocus: true,
    queryFn: async () => {
      const encontrados = new Map<string, { updated_at: string | null }>();
      for (let i = 0; i < ids.length; i += 100) {
        const r = await supabase.from("client_dossiers").select("client_id,updated_at").in("client_id", ids.slice(i, i + 100)).eq("dossier_type", "contexto").is("project_id", null).eq("is_current", true);
        if (r.error) throw r.error;
        for (const d of r.data || []) encontrados.set(d.client_id, d);
      }
      return clientes.map(c => ({ ...c, motivo: avisoDoDossie(encontrados.get(c.id)) })).filter(c => c.motivo);
    },
  });
}
