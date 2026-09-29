import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAllFiles, useClients } from "@/hooks/useSupabaseData";
import { useEditorialApprovalPreview } from "@/hooks/useEditorialCalendar";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Building2, Check, CheckCircle2, ChevronLeft, ChevronRight, FileCheck2, FileImage, FileText, Film, ListChecks, Loader2, MessageSquare, Plus, RefreshCw } from "lucide-react";
import FilePreviewContent from "@/components/shared/FilePreviewContent";
import { downloadFile } from "@/lib/fileActions";
import { isCarouselAssetGroup, mediaKindFromFile, resolveFileUrl, useResolvedFileUrl } from "@/lib/fileUrls";
import { orderEditorialCarouselFiles } from "@/lib/editorialMedia";
import {
  aprovarPeloCliente,
  motivoDaRecusaDaAprovacao,
  NOTA_DO_AVAL,
  podeAprovarPeloCliente,
  recordOfflineClientApproval,
  releaseFileToClient,
  reviewFileAgency,
  type FileApprovalDecision,
  type FileReleaseMode,
} from "@/lib/fileApprovalActions";
import { PLATFORM_LABELS, type EditorialPlatform } from "@/lib/editorial";
import { useConfirm } from "@/components/shared/confirmDialog";
import { supabase } from "@/integrations/supabase/client";
import {
  AreaDeTrabalho,
  CabecalhoDePagina,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  Etapas,
  RegiaoRolavel,
  SeletorCompacto,
  botao,
  campoTexto,
  etiqueta,
  juntar,
  superficie,
  texto,
  useEstadoDaTela,
  useLargo,
} from "@/components/sistema";

const clientApprovalBadge: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-warning/10 text-warning border-warning/20", label: "Aguardando cliente" },
  approved: { cls: "bg-success/10 text-success border-success/20", label: "Aprovado pelo cliente" },
  rejected: { cls: "bg-destructive/10 text-destructive border-destructive/20", label: "Cliente pediu ajustes" },
};

const agencyApprovalBadge: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-warning/10 text-warning border-warning/20", label: "Aguardando revisão interna" },
  approved: { cls: "bg-success/10 text-success border-success/20", label: "Aprovado internamente" },
  rejected: { cls: "bg-destructive/10 text-destructive border-destructive/20", label: "Ajustes internos pedidos" },
  not_requested: { cls: "bg-muted text-muted-foreground border-border", label: "Rascunho interno" },
};

const CLIENT_TABS = [
  { id: "all", label: "Todos" },
  { id: "pending", label: "Aguardando" },
  { id: "approved", label: "Aprovados" },
  { id: "rejected", label: "Pediu ajustes" },
];

const AGENCY_TABS = [
  { id: "all", label: "Todos" },
  { id: "pending", label: "Aguardando" },
  { id: "approved", label: "Aprovados" },
  { id: "rejected", label: "Ajustes pedidos" },
];

const ABAS_VALIDAS = ["all", "pending", "approved", "rejected"];

/** Selo de estado: pílula pequena com a cor da situação. */
const selo = "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium";

function ApprovalThumb({ file }: { file: any }) {
  const kind = mediaKindFromFile(file.file_name, file.file_url, file.mime_type || file.file_type, file.extension);
  const { url } = useResolvedFileUrl({
    fileUrl: file.file_url,
    storageBucket: file.storage_bucket,
    storagePath: file.storage_path,
    miniatura: kind === "image",
    expiresIn: 3600,
  });

  if (kind === "image" && url) {
    return <img src={url} alt={file.file_name} className="w-full h-full object-contain" loading="lazy" decoding="async" />;
  }
  if (kind === "video" && url) {
    return <video src={`${url}#t=0.1`} className="w-full h-full bg-black object-contain" muted playsInline preload="metadata" />;
  }
  const Icon = kind === "video" ? Film : kind === "image" ? FileImage : FileText;
  return <Icon className="w-12 h-12 text-muted-foreground/30" />;
}

function CarouselPreview({ images, small }: { images: any[]; small?: boolean }) {
  const [idx, setIdx] = useState(0);
  if (images.length === 0) return null;
  const current = images[idx];
  const maxH = small ? "h-36" : "min-h-[260px]";

  return (
    <div className="relative group">
      <div className={`${maxH} bg-muted/50 flex items-center justify-center overflow-hidden`}>
        {small ? (
          <ApprovalThumb file={current} />
        ) : (
          <div className="w-full">
            <FilePreviewContent
              fileName={current.file_name}
              fileUrl={current.file_url}
              fileId={current.id}
              storageBucket={current.storage_bucket}
              storagePath={current.storage_path}
              mimeType={current.mime_type || current.file_type}
              extension={current.extension}
            />
          </div>
        )}
      </div>
      {images.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Lâmina anterior"
            className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full border border-border bg-background/80 p-1.5 opacity-80 transition-all hover:bg-background hover:opacity-100"
            onClick={(e) => { e.stopPropagation(); setIdx((idx - 1 + images.length) % images.length); }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Próxima lâmina"
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full border border-border bg-background/80 p-1.5 opacity-80 transition-all hover:bg-background hover:opacity-100"
            onClick={(e) => { e.stopPropagation(); setIdx((idx + 1) % images.length); }}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <div className="absolute bottom-1 left-1/2 flex -translate-x-1/2 space-x-1">
            {images.map((_, i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === idx ? "bg-primary" : "bg-muted-foreground/40"}`} />
            ))}
          </div>
        </>
      )}
      {images.length > 1 && (
        <span className="absolute right-1 top-1 rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          {idx + 1}/{images.length}
        </span>
      )}
    </div>
  );
}

export default function AdminApprovals() {
  const { profile, user } = useAuth();
  const confirmDialog = useConfirm();
  // Situação e cliente vão na linha das filas de 1024 px para cima.
  const largo = useLargo();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedClient = searchParams.get("client") || "all";
  // Fila, aba e cliente ficam guardados: sair e voltar mantém onde estava.
  const [queue, setQueue] = useEstadoDaTela<"agency" | "client">("aprovacoes:fila", "agency", {
    validar: (v) => v === "agency" || v === "client",
  });
  const [clienteGuardado, setClienteGuardado] = useEstadoDaTela<string>("aprovacoes:cliente", "all", { validar: (v) => typeof v === "string" });
  // Cliente e fila recortados no banco: a tela recebia a tabela inteira e
  // descartava quase tudo em JS. A aba (pendente/aprovado/ajustes) segue em
  // JS porque a contagem de pendentes precisa da fila completa.
  const { data: allFiles, isLoading, isError, refetch } = useAllFiles(
    selectedClient === "all" ? undefined : selectedClient,
    {
      statusIn: queue === "agency"
        ? { column: "agency_approval_status", values: ["pending", "approved", "rejected"] }
        : { column: "approval_status", values: ["pending", "approved", "rejected"] },
    },
  );
  const { data: clients } = useClients();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useEstadoDaTela<string>(`aprovacoes:aba:${queue}`, "all", {
    validar: (v) => typeof v === "string" && ABAS_VALIDAS.indexOf(v) >= 0,
  });
  const [previewFile, setPreviewFile] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<any>(null);
  const [reviewFeedback, setReviewFeedback] = useState("");
  const editorialPreview = useEditorialApprovalPreview(
    previewFile?.id || null,
    !!previewFile,
  );
  const canReviewAndRelease = profile?.role === "admin" || profile?.role === "manager";
  // Frente EN: admin e gestor aprovam pelo cliente (um item ou vários marcados).
  const [selecionando, setSelecionando] = useState(false);
  const [marcados, setMarcados] = useState<string[]>([]);
  const aprovavelPeloCliente = (f: any) => canReviewAndRelease && podeAprovarPeloCliente(f);

  // Build carousel children map
  const allFilesList = allFiles || [];
  const childrenMap = new Map<string, any[]>();
  allFilesList.forEach((f: any) => {
    if (f.parent_file_id) {
      const arr = childrenMap.get(f.parent_file_id) || [];
      arr.push(f);
      childrenMap.set(f.parent_file_id, arr);
    }
  });

  // O banco ja recortou cliente e fila; os testes abaixo so seguram o cache
  // anterior enquanto a nova consulta chega.
  const approvalFiles = allFilesList.filter((f: any) => {
    if (f.parent_file_id) return false;
    if (selectedClient !== "all" && f.client_id !== selectedClient) return false;
    if (queue === "agency") {
      return (f.agency_approval_status || "not_requested") !== "not_requested";
    }
    if (f.approval_status === "none") return false;
    return true;
  });
  const statusField = queue === "agency" ? "agency_approval_status" : "approval_status";
  const filtered = activeTab === "all"
    ? approvalFiles
    : approvalFiles.filter((f: any) => (f[statusField] || "not_requested") === activeTab);
  const pendingCount = approvalFiles.filter((f: any) => f[statusField] === "pending").length;
  const selectedClientProfile = (clients || []).find((client: any) => client.id === selectedClient);
  const tabs = queue === "agency" ? AGENCY_TABS : CLIENT_TABS;
  const activeTabLabel = tabs.find((tab) => tab.id === activeTab)?.label || "selecionado";
  const contagemDaAba = (id: string) =>
    id === "all" ? approvalFiles.length : approvalFiles.filter((f: any) => (f[statusField] || "not_requested") === id).length;
  const nomeDoClienteEscolhido = selectedClientProfile
    ? selectedClientProfile.company_name || selectedClientProfile.full_name
    : "";

  const handleClientChange = (clientId: string) => {
    const next = new URLSearchParams(searchParams);
    if (clientId === "all") {
      next.delete("client");
    } else {
      next.set("client", clientId);
    }
    setActiveTab("all");
    setClienteGuardado(clientId);
    setSearchParams(next, { replace: true });
  };

  // Volta ao cliente escolhido da última vez (quando o endereço não traz um).
  const restaurou = useRef(false);
  useEffect(() => {
    if (restaurou.current || !clients) return;
    restaurou.current = true;
    if (searchParams.get("client") || clienteGuardado === "all") return;
    if (!clients.some((client: any) => client.id === clienteGuardado)) return;
    const next = new URLSearchParams(searchParams);
    next.set("client", clienteGuardado);
    setSearchParams(next, { replace: true });
  }, [clients, clienteGuardado, searchParams, setSearchParams]);

  useEffect(() => {
    if (!clients || selectedClient === "all") return;
    const clientExists = clients.some((client: any) => client.id === selectedClient);
    if (clientExists) return;

    const next = new URLSearchParams(searchParams);
    next.delete("client");
    setActiveTab("all");
    setClienteGuardado("all");
    setSearchParams(next, { replace: true });
    toast({
      title: "Cliente não encontrado",
      description: "O filtro foi removido. Escolha um cliente existente.",
      variant: "destructive",
    });
  }, [clients, searchParams, selectedClient, setSearchParams, toast]);

  const getCarouselImages = (f: any) => {
    const children = childrenMap.get(f.id) || [];
    if (isCarouselAssetGroup(f, children)) {
      // Ordem numérica real das lâminas: "card 2" antes de "card 10" (o
      // localeCompare alfabético embaralhava a partir de 10 lâminas), igual
      // à aprovação do cliente.
      return orderEditorialCarouselFiles(f, children);
    }
    return [f];
  };

  const getCorrectionUrl = (file: any) => {
    const params = new URLSearchParams({
      client: file.client_id,
      folder: file.folder || "materiais",
      novo: "1",
      revisionOf: file.id,
    });
    return `/arquivos?${params.toString()}`;
  };

  const handleDownload = async (file: any) => {
    if (!file) return;
    const url = await resolveFileUrl({
      fileUrl: file.file_url,
      storageBucket: file.storage_bucket,
      storagePath: file.storage_path,
      expiresIn: 3600,
    });
    await downloadFile(url, file.file_name);
  };

  const refreshApprovalQueues = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["all-files"] }),
      queryClient.invalidateQueries({ queryKey: ["files"] }),
    ]);
  };

  const handleAgencyReview = async (
    file: any,
    decision: FileApprovalDecision,
    feedback?: string | null,
  ) => {
    if (!canReviewAndRelease) return;
    setSubmitting(true);
    try {
      await reviewFileAgency(file.id, decision, feedback);
      await refreshApprovalQueues();
      setPreviewFile(null);
      setReviewTarget(null);
      setReviewFeedback("");
      toast({
        title: decision === "approved" ? "Revisão interna aprovada" : "Ajustes internos solicitados",
        description: decision === "approved"
          ? "Agora um admin ou manager pode liberar esta versão ao cliente."
          : "O conteúdo continua visível somente para a equipe.",
      });
    } catch (error: any) {
      toast({
        title: "Não foi possível concluir a revisão",
        description: error?.message || "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRelease = async (file: any, mode: FileReleaseMode) => {
    if (!canReviewAndRelease) return;
    setSubmitting(true);
    try {
      await releaseFileToClient(file.id, mode);
      await refreshApprovalQueues();
      setPreviewFile(null);
      toast({
        title: mode === "approval" ? "Enviado para aprovação do cliente" : "Disponibilizado ao cliente",
        description: "A liberação foi registrada com segurança.",
      });
    } catch (error: any) {
      toast({
        title: "Não foi possível liberar a entrega",
        description: error?.message || "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * O cliente respondeu "pode publicar" no grupo e não vai entrar no painel.
   * Em vez de deixar o material travado (e a publicação agendada não sair), a
   * equipe registra o aceite por aqui. Fica gravado quem registrou e por onde
   * veio, e o cliente vê no diário que a aprovação dele foi registrada.
   */
  const handleOfflineApproval = async (file: any) => {
    if (!canReviewAndRelease) return;
    const confirmed = await confirmDialog({
      title: "Registrar aprovação dada no grupo?",
      description:
        `O cliente aprovou "${file.file_name}" fora do painel e você está registrando por ele. ` +
        "Fica gravado que quem registrou foi você, e o material segue para publicação. " +
        "Use só quando o aceite realmente aconteceu.",
      confirmLabel: "Sim, o cliente aprovou",
    });
    if (!confirmed) return;

    setSubmitting(true);
    try {
      await recordOfflineClientApproval(file.id, Number(file.version ?? 1), "grupo");
      // O cliente enxerga o registro no Diário do Trabalho, sem sombra.
      let diarioFalhou = false;
      if (file.project_id && user?.id) {
        const { error: erroDiario } = await supabase.from("updates").insert({
          project_id: file.project_id,
          author_id: user.id,
          message: `Aprovação registrada pela equipe: você aprovou "${file.file_name}" pelo grupo. Seguimos para a publicação.`,
          update_type: "progress",
          client_visible: true,
        });
        // A aprovacao ja esta gravada; o que falhou foi o aviso no diario.
        // Avisar em vez de esconder: a tela dizia "registrado" sem o diario ter recebido nada.
        diarioFalhou = Boolean(erroDiario);
      }
      await refreshApprovalQueues();
      setPreviewFile(null);
      if (diarioFalhou) {
        toast({
          title: "Aprovação registrada, mas o diário não recebeu o aviso",
          description: "O material foi destravado. O registro no Diário do Trabalho falhou; anote manualmente se o cliente precisar ver.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Aprovação registrada",
          description: "O material foi destravado e segue para a publicação.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Não foi possível registrar",
        description: error?.message || "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Frente EN (28/09, dono: "o cliente está ocupado e pede para eu aprovar;
   * eu entro e aprovo todos, valendo pelo cliente e por mim"). Uma RPC por
   * material (aprovar_pelo_cliente): revisão interna, liberação e o aval do
   * cliente dado ao admin, com as travas de sempre. O cliente recebe um aviso
   * e vê no histórico "Aprovado por <nome> em nome do cliente".
   */
  const sairDaSelecao = () => {
    setSelecionando(false);
    setMarcados([]);
  };
  const handleApproveOnBehalf = async (arquivos: any[]) => {
    const alvos = arquivos.filter(aprovavelPeloCliente);
    if (!alvos.length) return;
    const confirmed = await confirmDialog({
      title: alvos.length === 1 ? `Aprovar "${alvos[0].file_name}" pelo cliente?` : `Aprovar ${alvos.length} materiais pelo cliente?`,
      description:
        "O cliente deu o aval para você aprovar. Registra a revisão interna, a liberação e a aprovação em nome dele. " +
        "No histórico do cliente fica \"aprovado por você em nome do cliente\" e ele recebe um aviso.",
      confirmLabel: "Aprovar pelo cliente",
    });
    if (!confirmed) return;
    setSubmitting(true);
    const falhas: string[] = [];
    let feitos = 0;
    try {
      // Um de cada vez: cada aprovação trava o material no banco.
      for (const f of alvos) {
        try {
          await aprovarPeloCliente(f.id, NOTA_DO_AVAL);
          feitos++;
        } catch (error) {
          falhas.push(`${f.file_name || "material"}: ${motivoDaRecusaDaAprovacao(error)}`);
        }
      }
      await refreshApprovalQueues();
      await queryClient.invalidateQueries({ queryKey: ["editorial-calendar"] });
      setPreviewFile(null);
      sairDaSelecao();
      if (falhas.length) {
        toast({
          title: feitos ? `${feitos} de ${alvos.length} aprovados pelo cliente` : "Nenhum material foi aprovado",
          description: falhas.join(" ").slice(0, 400),
          variant: "destructive",
        });
      } else {
        toast({
          title: feitos === 1 ? "Aprovado pelo cliente" : `${feitos} materiais aprovados pelo cliente`,
          description: "Já podem ser programados na Agenda.",
        });
      }
    } finally {
      setSubmitting(false);
    }
  };
  const aprovaveisNaTela = filtered.filter(aprovavelPeloCliente);

  const formatDate = (d: string) => {
    const data = new Date(d);
    return isNaN(data.getTime()) ? "" : data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const novoConteudo = `/arquivos?client=${encodeURIComponent(selectedClient)}&folder=materiais&novo=1`;

  /* Frente EN: aprovar pelo cliente em lote (só admin e gestor). */
  const acoesDeLote = canReviewAndRelease && aprovaveisNaTela.length > 0 ? (
    selecionando ? (
      <span className="flex shrink-0 items-center" role="group" aria-label="Aprovar pelo cliente as marcadas">
        <button
          type="button"
          className={juntar(botao.primario, "h-8 px-2.5 text-[12px]")}
          disabled={!marcados.length || submitting}
          onClick={() => void handleApproveOnBehalf(aprovaveisNaTela.filter((f: any) => marcados.indexOf(f.id) >= 0))}
          data-aprovar-lote={marcados.length}
        >
          {submitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileCheck2 className="mr-1.5 h-3.5 w-3.5" />}
          Aprovar pelo cliente{marcados.length ? ` (${marcados.length})` : ""}
        </button>
        <button type="button" className={juntar(botao.discreto, "ml-1 h-8 px-2 text-[12px]")} onClick={() => setMarcados(aprovaveisNaTela.map((f: any) => f.id))}>
          Todas
        </button>
        <button type="button" className={juntar(botao.discreto, "h-8 px-2 text-[12px]")} onClick={sairDaSelecao}>
          Cancelar
        </button>
      </span>
    ) : (
      <button
        type="button"
        className={botao.barra}
        onClick={() => setSelecionando(true)}
        title="Marcar vários materiais e aprovar pelo cliente (o cliente deu o aval)"
      >
        <ListChecks className="mr-1 h-3.5 w-3.5" /> Aprovar pelo cliente
      </button>
    )
  ) : null;

  /* Situação e cliente: seletores pequenos não ganham linha própria
     (SISTEMA.md 4.2). No computador vão na linha das filas, à direita; abaixo
     de 1024 px ficam numa linha curta embaixo das filas. */
  const seletores = (
    <>
      <SeletorCompacto
        rotulo="Situação"
        valor={activeTab}
        onEscolher={setActiveTab}
        modo="segmentado"
        listaQuandoNaoCabe
        opcoes={tabs.map((t) => ({ valor: t.id, rotulo: t.label, contador: contagemDaAba(t.id) }))}
      />
      <SeletorCompacto
        rotulo="Cliente"
        icone={<Building2 className="h-3.5 w-3.5" />}
        valor={selectedClient}
        onEscolher={handleClientChange}
        modo="lista"
        opcoes={[{ valor: "all", rotulo: "Todos os clientes" }].concat(
          (clients || []).map((client: any) => ({ valor: client.id, rotulo: client.company_name || client.full_name })),
        )}
      />
      {acoesDeLote}
    </>
  );

  return (
    <div className="min-w-0">
      {/* Sistema de design (docs/design/SISTEMA.md): no computador a tela tem a
          altura da janela e só a grade de entregas rola, por dentro, lembrando a
          posição. No celular a página rola normal. */}
      <CabecalhoDePagina
          titulo="Aprovações"
          descricao={
            pendingCount > 0
              ? `${pendingCount} ${queue === "agency" ? "aguardando revisão interna" : "aguardando cliente"}${nomeDoClienteEscolhido ? ` · ${nomeDoClienteEscolhido}` : ""}`
              : nomeDoClienteEscolhido || undefined
          }
          ajuda={
            <>
              Revise internamente antes de liberar e acompanhe a decisão do cliente em uma fila separada.
              {!canReviewAndRelease && " Você pode acompanhar a fila. Somente admin ou manager pode revisar e liberar uma entrega."}
            </>
          }
          acoes={
            selectedClientProfile ? (
              <Link to={novoConteudo} className={botao.primario} aria-label="Novo conteúdo">
                <Plus className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Novo conteúdo</span>
              </Link>
            ) : undefined
          }
        />

      <AreaDeTrabalho principalRolavel={false} className="mt-3">
        <div className="shrink-0 border-b border-border">
          <Etapas
            rotulo="Filas de aprovação"
            valor={queue}
            onEscolher={(v) => setQueue(v === "client" ? "client" : "agency")}
            itens={[
              { valor: "agency", rotulo: "Revisão interna", contador: queue === "agency" ? pendingCount : null },
              { valor: "client", rotulo: "Decisão do cliente", contador: queue === "client" ? pendingCount : null },
            ]}
            depois={largo ? <div className="ml-auto flex shrink-0 items-center py-1 pl-4 [&>*+*]:ml-2">{seletores}</div> : undefined}
          />
        </div>

        {!largo && (
          <div className="mt-3 shrink-0">
            <div className="-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1">{seletores}</div>
          </div>
        )}

        <div className="mt-4 flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
          {isLoading ? (
            <Carregando forma="grade" linhas={6} rotulo="Carregando aprovações" />
          ) : isError && allFilesList.length === 0 ? (
            <EstadoDeErro
              titulo="Não foi possível carregar as aprovações."
              acao={<button type="button" className={botao.secundario} onClick={() => refetch()}>Tentar de novo</button>}
            />
          ) : filtered.length === 0 ? (
            <EstadoVazio
              icone={<CheckCircle2 className="h-5 w-5" />}
              titulo={
                activeTab !== "all"
                  ? `Nenhum item em "${activeTabLabel}"${nomeDoClienteEscolhido ? ` para ${nomeDoClienteEscolhido}` : ""}.`
                  : nomeDoClienteEscolhido
                  ? `Nenhuma aprovação encontrada para ${nomeDoClienteEscolhido}.`
                  : "Nenhuma aprovação encontrada."
              }
              acao={
                activeTab !== "all" ? (
                  <button type="button" onClick={() => setActiveTab("all")} className={botao.secundario}>
                    Ver todas as aprovações
                  </button>
                ) : selectedClientProfile ? (
                  <Link to={novoConteudo} className={botao.secundario}>
                    Criar conteúdo
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <RegiaoRolavel modo="lg" rotulo="Entregas para aprovar" memoria={`aprovacoes:${queue}:${selectedClient}`}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:pb-6 lg:pr-1 desk:grid-cols-4">
                {filtered.map((f: any) => {
                  const badge = queue === "agency"
                    ? agencyApprovalBadge[f.agency_approval_status] || agencyApprovalBadge.not_requested
                    : clientApprovalBadge[f.approval_status] || clientApprovalBadge.pending;
                  const activeFeedback = queue === "agency" ? f.agency_feedback : f.feedback;
                  const images = getCarouselImages(f);
                  const isCarousel = images.length > 1;
                  const meta = [f.project?.name, f.client?.company_name || f.client?.full_name, formatDate(f.created_at)].filter(Boolean).join(" · ");
                  const aprovavel = aprovavelPeloCliente(f);
                  const marcado = marcados.indexOf(f.id) >= 0;
                  const abrirOuMarcar = () => {
                    if (selecionando) {
                      if (aprovavel) setMarcados((l) => (l.indexOf(f.id) >= 0 ? l.filter((x) => x !== f.id) : l.concat([f.id])));
                      return;
                    }
                    setPreviewFile(f);
                  };
                  return (
                    <div
                      key={f.id}
                      role="button"
                      tabIndex={0}
                      aria-label={selecionando ? `Marcar ${f.file_name || "entrega"}` : `Abrir ${f.file_name || "entrega"}`}
                      aria-pressed={selecionando ? marcado : undefined}
                      onClick={abrirOuMarcar}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        abrirOuMarcar();
                      }}
                      className={juntar(
                        superficie.painel,
                        "relative flex h-full cursor-pointer flex-col overflow-hidden transition-colors hover:border-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selecionando && !aprovavel && "cursor-default opacity-50",
                        selecionando && marcado && "border-primary",
                      )}
                    >
                      {selecionando && aprovavel && (
                        <span
                          className={juntar(
                            "absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded border",
                            marcado ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
                          )}
                          aria-hidden="true"
                        >
                          {marcado && <Check className="h-3.5 w-3.5" />}
                        </span>
                      )}
                      <CarouselPreview images={images} small />
                      <div className="flex min-w-0 flex-1 flex-col px-4 py-3">
                        <div className="flex min-w-0 items-center">
                          <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">{f.file_name || "Sem nome"}</p>
                          {isCarousel && (
                            <span className={juntar(etiqueta, "ml-2 bg-primary/10 text-primary")}>
                              Carrossel · {images.length}
                            </span>
                          )}
                        </div>
                        {meta && <p className={juntar(texto.auxiliar, "mt-1 truncate")}>{meta}</p>}
                        <span className={juntar(selo, "mt-2 self-start", badge.cls)}>{badge.label}</span>

                        {f[statusField] === "rejected" && activeFeedback && (
                          <p className="mt-2 line-clamp-3 text-[12px] leading-5 text-muted-foreground">
                            <span className="font-medium text-destructive">
                              {queue === "agency" ? "Feedback interno: " : "Feedback do cliente: "}
                            </span>
                            {activeFeedback}
                          </p>
                        )}

                        {aprovavel && !selecionando && (
                          <div className="mt-auto pt-3">
                            <button
                              type="button"
                              className={juntar(botao.secundario, "h-8 px-3 text-[12px]")}
                              disabled={submitting}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleApproveOnBehalf([f]);
                              }}
                              data-aprovar-pelo-cliente={f.id}
                            >
                              <FileCheck2 className="mr-1.5 h-3 w-3" aria-hidden="true" /> Aprovar pelo cliente
                            </button>
                          </div>
                        )}

                        {f[statusField] === "rejected" && (
                          <div className="mt-auto pt-3">
                            <Link
                              to={getCorrectionUrl(f)}
                              onClick={(event) => event.stopPropagation()}
                              className={juntar(botao.secundario, "h-8 px-3 text-[12px]")}
                            >
                              <RefreshCw className="mr-1.5 h-3 w-3" aria-hidden="true" /> Criar nova versão
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </RegiaoRolavel>
          )}
        </div>
      </AreaDeTrabalho>

      {/* Preview Modal */}
      <Dialog open={!!previewFile} onOpenChange={() => setPreviewFile(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className={juntar(texto.tituloSecao, "flex min-w-0 flex-wrap items-center pr-6 text-left")}>
              <span className="mr-2 min-w-0 [overflow-wrap:anywhere]">{previewFile?.file_name}</span>
              {previewFile && getCarouselImages(previewFile).length > 1 && (
                <span className={juntar(etiqueta, "bg-primary/10 text-primary")}>
                  Carrossel · {getCarouselImages(previewFile).length} imagens
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {previewFile && (
            <div className="min-w-0 space-y-4">
              <div className="overflow-hidden rounded-lg bg-muted/50">
                <CarouselPreview images={getCarouselImages(previewFile)} />
              </div>
              <p className={texto.auxiliar}>
                Enviado por {previewFile.uploader?.full_name || "-"}
                {formatDate(previewFile.created_at) ? ` · ${formatDate(previewFile.created_at)}` : ""}
              </p>
              {previewFile.caption && <div><p className={texto.rotulo}>Legenda</p><p className={juntar(texto.corpo, "mt-1")}>{previewFile.caption}</p></div>}
              {previewFile.carousel_text && <div><p className={texto.rotulo}>Texto do carrossel</p><p className={juntar(texto.corpo, "mt-1 whitespace-pre-wrap")}>{previewFile.carousel_text}</p></div>}
              {previewFile.description && <div><p className={texto.rotulo}>Descrição</p><p className={juntar(texto.corpo, "mt-1")}>{previewFile.description}</p></div>}
              {editorialPreview.isLoading && (
                <p className={juntar(texto.auxiliar, "flex items-center")}>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Conferindo o conteúdo editorial vinculado…
                </p>
              )}
              {editorialPreview.isError && (
                <EstadoDeErro
                  titulo="Não foi possível conferir o conteúdo editorial."
                  descricao="Revisão e liberação ficam bloqueadas até a prévia ser validada."
                  acao={
                    <button type="button" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")} onClick={() => editorialPreview.refetch()}>
                      Tentar novamente
                    </button>
                  }
                />
              )}
              {!editorialPreview.isLoading
                && !editorialPreview.isError
                && (editorialPreview.data || []).map((snapshot) => (
                  <section key={snapshot.post_id} className={juntar(superficie.poco, "space-y-3 p-3.5")}>
                    <div>
                      <p className="text-[12px] font-medium text-primary">Conteúdo editorial vinculado</p>
                      <p className="mt-1 text-[14px] font-semibold text-foreground">{snapshot.title}</p>
                      <p className={juntar(texto.auxiliar, "mt-0.5")}>Formato: {snapshot.content_type}</p>
                    </div>
                    {snapshot.objective && <p className="whitespace-pre-wrap text-[12px] text-foreground">{snapshot.objective}</p>}
                    {snapshot.default_caption && (
                      <div>
                        <p className={texto.rotulo}>Legenda base</p>
                        <p className="mt-1 whitespace-pre-wrap text-[12px] text-foreground">{snapshot.default_caption}</p>
                      </div>
                    )}
                    {snapshot.plans.length > 0 && (
                      <div className="divide-y divide-border border-t border-border">
                        {snapshot.plans.map((plan, planIndex) => (
                          <div key={`${plan.platform}-${plan.account_handle || plan.account_name || planIndex}`} className="space-y-1.5 py-2.5">
                            <p className="text-[12px] font-medium text-foreground">
                              {PLATFORM_LABELS[plan.platform as EditorialPlatform] || plan.platform}
                              {(plan.account_handle || plan.account_name) ? ` · ${plan.account_handle || plan.account_name}` : ""}
                            </p>
                            {plan.caption && <p className="whitespace-pre-wrap text-[12px] text-foreground">{plan.caption}</p>}
                            {plan.first_comment && <p className="whitespace-pre-wrap text-[11px] text-muted-foreground">Primeiro comentário: {plan.first_comment}</p>}
                            {plan.alt_text && <p className="whitespace-pre-wrap text-[11px] text-muted-foreground">Texto alternativo: {plan.alt_text}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                ))}
              <div className="-m-1 flex flex-wrap items-center [&>*]:m-1">
                <span className={juntar(selo, (agencyApprovalBadge[previewFile.agency_approval_status] || agencyApprovalBadge.not_requested).cls)}>
                  {(agencyApprovalBadge[previewFile.agency_approval_status] || agencyApprovalBadge.not_requested).label}
                </span>
                {previewFile.approval_status !== "none" && (
                  <span className={juntar(selo, (clientApprovalBadge[previewFile.approval_status] || clientApprovalBadge.pending).cls)}>
                    {(clientApprovalBadge[previewFile.approval_status] || clientApprovalBadge.pending).label}
                  </span>
                )}
                {previewFile.version > 1 && (
                  <span className={texto.auxiliar}>Versão {previewFile.version}</span>
                )}
              </div>
              {previewFile.locked_at && (
                <p className="text-[12px] text-success">Versão final protegida contra alterações.</p>
              )}
              {previewFile.agency_approval_status === "rejected" && previewFile.agency_feedback && (
                <div className="border-l-2 border-destructive/60 pl-3">
                  <p className={texto.rotulo}>Feedback interno</p>
                  <p className="mt-0.5 text-[12px] text-foreground">{previewFile.agency_feedback}</p>
                </div>
              )}
              {previewFile.approval_status === "rejected" && previewFile.feedback && (
                <div className="border-l-2 border-destructive/60 pl-3">
                  <p className={texto.rotulo}>Feedback do cliente</p>
                  <p className="mt-0.5 text-[12px] text-foreground">{previewFile.feedback}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="[&>*+*]:mb-2 sm:[&>*+*]:mb-0">
            <button type="button" className={botao.secundario} onClick={() => handleDownload(previewFile)}>Baixar</button>
            {previewFile?.[statusField] === "rejected" && (
              <Link to={getCorrectionUrl(previewFile)} onClick={() => setPreviewFile(null)} className={botao.secundario}>
                <RefreshCw className="mr-1.5 h-3 w-3" aria-hidden="true" /> Criar nova versão
              </Link>
            )}
            {/* Frente EN: o cliente deu o aval ao admin; aprova em nome dele. */}
            {previewFile && aprovavelPeloCliente(previewFile) && (
              <button
                type="button"
                className={botao.secundario}
                disabled={submitting}
                onClick={() => void handleApproveOnBehalf([previewFile])}
              >
                <FileCheck2 className="mr-1.5 h-3 w-3" aria-hidden="true" /> Aprovar pelo cliente
              </button>
            )}
            {/* Cliente que aprova pelo grupo e não entra no painel: a equipe
                registra o aceite aqui para nada ficar travado. */}
            {queue === "client"
              && previewFile?.approval_status === "pending"
              && canReviewAndRelease && (
                <button
                  type="button"
                  className={botao.secundario}
                  disabled={submitting}
                  onClick={() => handleOfflineApproval(previewFile)}
                >
                  <MessageSquare className="mr-1.5 h-3 w-3" aria-hidden="true" /> Aprovou no grupo
                </button>
              )}
            {queue === "agency"
              && previewFile?.agency_approval_status === "approved"
              && previewFile?.visibility === "internal"
              && canReviewAndRelease && (
                <>
                  {/* Revisão interna já aconteceu: disponibilizar é o padrão.
                      Aprovação do cliente só quando pedida explicitamente. */}
                  <button
                    type="button"
                    className={botao.secundario}
                    disabled={submitting || editorialPreview.isFetching || editorialPreview.isError}
                    onClick={() => handleRelease(previewFile, "approval")}
                  >
                    Pedir aprovação do cliente
                  </button>
                  <button
                    type="button"
                    className={botao.primario}
                    disabled={submitting || editorialPreview.isFetching || editorialPreview.isError}
                    onClick={() => handleRelease(previewFile, "client_shared")}
                  >
                    Disponibilizar ao cliente
                  </button>
                </>
              )}
            {queue === "agency"
              && previewFile?.agency_approval_status === "pending"
              && canReviewAndRelease && (
                <>
                  <button
                    type="button"
                    className={botao.perigo}
                    disabled={submitting || editorialPreview.isFetching || editorialPreview.isError}
                    onClick={() => {
                      setReviewTarget(previewFile);
                      setReviewFeedback("");
                      setPreviewFile(null);
                    }}
                  >
                    Pedir ajustes internos
                  </button>
                  <button
                    type="button"
                    className={botao.primario}
                    disabled={submitting || editorialPreview.isFetching || editorialPreview.isError}
                    onClick={() => handleAgencyReview(previewFile, "approved")}
                  >
                    Aprovar internamente
                  </button>
                </>
              )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reviewTarget} onOpenChange={(open) => {
        if (!open && !submitting) {
          setReviewTarget(null);
          setReviewFeedback("");
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className={juntar(texto.tituloSecao, "text-left")}>Pedir ajustes internos</DialogTitle>
          </DialogHeader>
          <CampoDeFormulario rotulo="O que precisa ser corrigido" apoio="Mínimo de 10 caracteres.">
            <textarea
              id="agency-review-feedback"
              value={reviewFeedback}
              onChange={(event) => setReviewFeedback(event.target.value)}
              rows={4}
              className={juntar(campoTexto, "resize-none")}
              placeholder="Feedback interno para a equipe"
            />
          </CampoDeFormulario>
          <DialogFooter className="[&>*+*]:mb-2 sm:[&>*+*]:mb-0">
            <button
              type="button"
              className={botao.secundario}
              onClick={() => setReviewTarget(null)}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button
              type="button"
              className={juntar(botao.primario, "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
              disabled={submitting || reviewFeedback.trim().length < 10}
              onClick={() => handleAgencyReview(reviewTarget, "rejected", reviewFeedback)}
            >
              {submitting ? "Salvando..." : "Solicitar ajustes"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
