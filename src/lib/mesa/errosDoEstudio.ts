import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DIAS_PADRAO,
  lerErrosDoEstudio,
  type LeituraDosErros,
} from "../../../supabase/functions/mcp-server/modulos/estudio-erros-regras";

/**
 * Erros do Estúdio na tela (16/11/2026). O panorama da casa contava
 * "estudio_fila: erro N" sem dizer quais eram nem o motivo. A leitura é a
 * mesma do MCP (aceleriq_estudio_erros), feita aqui com o login da pessoa:
 * a RLS da fila já deixa a equipe ler (is_staff + can_access_client), então
 * não há função nova nem migration.
 */

export type { ErroDoEstudio, LeituraDosErros, ResumoDosErros } from "../../../supabase/functions/mcp-server/modulos/estudio-erros-regras";
export { traduzirErroDoEstudio, tituloDaPeca } from "../../../supabase/functions/mcp-server/modulos/estudio-erros-regras";

export const chaveDosErrosDoEstudio = (clientId: string | null, dias: number) => ["mesa", "erros-do-estudio", clientId || "todos", dias] as const;

export async function lerErrosDoEstudioNaTela(clientId: string | null, dias = DIAS_PADRAO): Promise<LeituraDosErros> {
  return lerErrosDoEstudio(supabase as any, { clientId, dias, limite: 100 });
}

/** Erros do Estúdio de um cliente (ou de todos que a pessoa vê, com null). Lê de novo a cada minuto no máximo. */
export function useErrosDoEstudio(clientId: string | null, dias = DIAS_PADRAO, ligado = true) {
  return useQuery({
    queryKey: chaveDosErrosDoEstudio(clientId, dias),
    queryFn: () => lerErrosDoEstudioNaTela(clientId, dias),
    enabled: ligado,
    staleTime: 60_000,
    retry: 1,
  });
}
