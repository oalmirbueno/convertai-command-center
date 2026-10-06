import { lazy, Suspense, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { useAuth } from "@/contexts/AuthContext";
import { useMesa } from "./MesaContexto";
import { chamarMesaVideos, type ArquivoDeVideo } from "@/components/mesa-videos/videosApi";
import { handoffWorkspaceFileToFiles, type WorkspaceFileForHandoff } from "@/lib/workspaceFileHandoff";
import { requestFileAgencyReview } from "@/lib/fileApprovalActions";
import { loadEditorialPostForMutation, type EditorialPostBundle } from "@/hooks/useEditorialCalendar";
import type { ItemDoMes } from "./useItensDoMes";

const Editor = lazy(() => import("@/components/editorial/EditorialEditor"));
const Detalhe = lazy(() => import("@/components/editorial/EditorialDetailSheet"));

/** Reuses Workspace -> Files -> Agenda and its two approval gates. Never auto-publishes. */
export default function EntregaDoVideoDaPauta({ item, arquivo }: { item: ItemDoMes; arquivo: ArquivoDeVideo }) {
  const { clientId, clientName, userId } = useMesa();
  const { profile } = useAuth();
  const { isImpersonating } = useImpersonation();
  const cache = useQueryClient();
  const [ocupado, setOcupado] = useState(false);
  const [editor, setEditor] = useState(false);
  const [detalhe, setDetalhe] = useState(false);
  const [fileId, setFileId] = useState<string | null>(null);
  const [post, setPost] = useState<EditorialPostBundle | null>(null);
  const [revisao, setRevisao] = useState<EditorialPostBundle | null>(null);
  const projeto = useQuery({ queryKey: ["mesa", "projeto-da-pauta", clientId, item.project_id], queryFn: async () => {
    const { data, error } = await supabase.from("projects").select("id, name").eq("id", item.project_id).eq("client_id", clientId).single();
    if (error) throw error; return data;
  } });
  const preparar = async () => {
    if (!userId || !projeto.data) return;
    setOcupado(true);
    try {
      const r = await chamarMesaVideos<{ client_id: string; workspace: { node_id: string | null } }>({ acao: "final_para_workspace", arquivo_id: arquivo.id });
      if (r.client_id !== clientId || !r.workspace.node_id) throw new Error("O vídeo ainda não foi confirmado no Workspace.");
      const { data: node, error } = await supabase.from("workspace_nodes").select("id, client_id, kind, name, mime, size_bytes, storage_path, sent_for_approval_file_id").eq("id", r.workspace.node_id).eq("client_id", clientId).single();
      if (error || !node) throw new Error("Não foi possível conferir o vídeo salvo no Workspace.");
      const f = await handoffWorkspaceFileToFiles({ node: node as WorkspaceFileForHandoff, clientId, userId, fileName: item.title, folder: "materiais", fileType: "creative", projectId: item.project_id });
      setFileId(f.fileId);
      const { data: vinculados, error: erroVinculo } = await supabase.from("editorial_post_internal").select("post_id").eq("task_id", item.id);
      if (erroVinculo) throw erroVinculo;
      const atuais = await Promise.all((vinculados || []).map((v) => loadEditorialPostForMutation(v.post_id, clientId)));
      const atual = atuais.filter((p) => !p.post.archived_at).sort((a, b) => b.post.created_at.localeCompare(a.post.created_at))[0] || null;
      // An existing piece with another file becomes a revision, never an overwrite.
      const precisaRevisao = !!atual?.post.primary_file_id && atual.post.primary_file_id !== f.fileId;
      setPost(precisaRevisao ? null : atual); setRevisao(precisaRevisao ? atual : null);
      await cache.invalidateQueries({ queryKey: ["editorial-editor-options"] });
      setEditor(true);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível preparar o vídeo para a Agenda."); }
    finally { setOcupado(false); }
  };
  const salvo = async (id: string) => {
    setEditor(false);
    void cache.invalidateQueries({ queryKey: ["mesa", "itens-do-mes", clientId] });
    void cache.invalidateQueries({ queryKey: ["mesa", "item-avulso", clientId] });
    try { setPost(await loadEditorialPostForMutation(id, clientId)); setDetalhe(true); }
    catch (e) { toast.error("Post salvo. Não foi possível abrir a conferência agora; consulte a Agenda."); }
  };
  const podeEditar = ["admin", "manager", "design"].includes(profile?.role || "") && !isImpersonating;
  return <div className="space-y-2 border-t pt-2">
    <button type="button" className="rounded-md border px-3 py-2 text-[12px]" disabled={ocupado || !podeEditar || !projeto.data} onClick={() => void preparar()}>{ocupado ? "Preparando vídeo…" : "Legenda do post, revisão e Agenda"}</button>
    {projeto.isError && <p role="alert" className="text-[12px]">Não foi possível ler o projeto desta pauta. <button onClick={() => void projeto.refetch()}>Tentar novamente</button></p>}
    {fileId && post && <button type="button" disabled={ocupado} className="ml-2 text-[12px] text-primary" onClick={async () => { setOcupado(true); try { await requestFileAgencyReview(fileId); toast.success("Vídeo enviado para revisão da agência."); } catch (e) { toast.error(e instanceof Error ? e.message : "Revisão não confirmada."); } finally { setOcupado(false); } }}>Pedir revisão da agência</button>}
    <Suspense fallback={<p role="status">Abrindo a Agenda…</p>}>
      {editor && <Editor open post={post} revisionOf={revisao} clients={[{ id: clientId, name: clientName }]} projects={[{ id: item.project_id, name: projeto.data?.name || "Projeto da pauta", client_id: clientId }]} teamMembers={[]} defaultClientId={clientId} defaultProjectId={item.project_id} defaultTaskId={item.id} lockTaskId defaultTitle={item.title} defaultContentType={item.delivery_type === "reel" || item.delivery_type === "short" ? item.delivery_type : "video"} defaultPrimaryFileId={fileId || ""} onOpenChange={setEditor} onSaved={(id) => void salvo(id)} />}
      {detalhe && post && <Detalhe open post={post} clientName={clientName} projectName={projeto.data?.name || "Projeto da pauta"} canEdit={podeEditar} canPublish={profile?.role === "admin" || profile?.role === "manager"} isImpersonating={!!isImpersonating} onOpenChange={setDetalhe} onEdit={(p) => { setPost(p); setRevisao(null); setDetalhe(false); setEditor(true); }} onCreateRevision={(p) => { setPost(null); setRevisao(p); setDetalhe(false); setEditor(true); }} onArchived={() => { setDetalhe(false); setPost(null); }} />}
    </Suspense>
  </div>;
}
