import { supabase } from "@/integrations/supabase/client";
import { isFilePublishable } from "@/lib/editorial";
import { orderEditorialCarouselFiles, type EditorialMediaFile } from "@/lib/editorialMedia";
import { canDeliverAutomatically } from "@/lib/editorialScheduler";

/**
 * Frente AP (28/09): agendar na Agenda um post que veio do Estúdio.
 *
 * O post do Estúdio entra na Agenda ANTES da aprovação, e a Agenda só congela
 * as lâminas de arquivo aprovado. Agendar depois da aprovação pelo "Programar
 * publicação" mandava só conta e data: a publicação era promovida sem lâminas
 * e em modo manual, e o motor não publicava. Com a arte aprovada, a publicação
 * vai com as lâminas na ordem do carrossel e o modo de entrega (automático só
 * com a conta ligada e a automação ligada, até 10 lâminas), igual ao
 * "Agendar publicação" da Agenda. Sem aprovação, devolve null: a publicação
 * fica planejada com a data e o banco agenda quando o cliente aprovar.
 */

type PostComArte = {
  post: { production_status: string; primary_file_id: string | null };
  primaryFile: Parameters<typeof isFilePublishable>[0];
};

type Conta = { id: string; connection_status?: string | null; automation_enabled?: boolean | null };

export async function entregaDaArteAprovada(
  bundle: PostComArte,
  contaId: string,
  contas: readonly Conta[],
  lerLaminas: (raizId: string) => Promise<EditorialMediaFile[]> = lerLaminasDoBanco,
): Promise<{ delivery_mode: "automatic" | "manual"; asset_file_ids: string[] } | null> {
  const raizId = bundle.post.primary_file_id;
  if (!raizId || bundle.post.production_status !== "ready" || !isFilePublishable(bundle.primaryFile)) return null;
  const arquivos = await lerLaminas(raizId);
  const raiz = arquivos.find((f) => f.id === raizId);
  if (!raiz) return null;
  // Todas as filhas, como o banco confere (a lista congelada tem de ser a peça inteira).
  const filhas = arquivos.filter((f) => f.parent_file_id === raizId);
  const ids = orderEditorialCarouselFiles(raiz, filhas).map((f) => f.id);
  const conta = contas.find((c) => c.id === contaId);
  const automacao = !!conta && conta.connection_status === "connected" && conta.automation_enabled === true;
  return { delivery_mode: canDeliverAutomatically(ids, automacao) ? "automatic" : "manual", asset_file_ids: ids };
}

async function lerLaminasDoBanco(raizId: string): Promise<EditorialMediaFile[]> {
  const { data, error } = await supabase
    .from("files")
    .select("id, file_name, file_url, file_type, mime_type, extension, parent_file_id, status, archived_at, created_at")
    .or(`id.eq.${raizId},parent_file_id.eq.${raizId}`);
  if (error) throw error;
  return (data || []) as unknown as EditorialMediaFile[];
}
