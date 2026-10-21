import { useQuery } from "@tanstack/react-query";
import { listarFerramentas } from "@/lib/membros/ferramentas";

export function useCatalogoFerramentas(usuario?: string, habilitado = true) {
  return useQuery({
    queryKey: ["membros", "ferramentas", usuario],
    queryFn: listarFerramentas,
    enabled: !!usuario && habilitado,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: "always",
    refetchInterval: (consulta) => {
      const proximos = (consulta.state.data || [])
        .map((f) => (f.fim ? Date.parse(f.fim) - Date.now() : NaN))
        .filter((tempo) => Number.isFinite(tempo) && tempo > 0);
      return Math.max(100, Math.min(60000, ...proximos));
    },
  });
}
