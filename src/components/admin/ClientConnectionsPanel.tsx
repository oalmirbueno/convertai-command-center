import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Power, PowerOff, Link2, Link2Off, Loader2, AlertTriangle, Pencil, Save, X } from "lucide-react";
import EditorialAccountSetup from "@/components/editorial/EditorialAccountSetup";
import {
  AjudaRecolhida,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  GrupoDeCampos,
  Secao,
  botao,
  campo,
  etiqueta,
  foco,
  juntar,
  superficie,
  texto,
} from "@/components/sistema";
import type { EditorialAccountRow } from "@/hooks/useEditorialCalendar";
import { EDITORIAL_PLATFORMS } from "@/lib/editorial";

interface Props {
  clientId: string;
  clientName: string;
  initialProjectId?: string | null;
}

const PLATFORMS = [
  { value: "meta_ads", label: "Meta Ads" },
  { value: "google_ads", label: "Google Ads" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "google_analytics", label: "Google Analytics" },
  { value: "google_business", label: "Google Business" },
  { value: "google_search_console", label: "Google Search Console" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "website", label: "Site" },
  { value: "domain", label: "Domínio" },
  { value: "crm", label: "CRM" },
  { value: "email", label: "E-mail" },
  { value: "outro", label: "Outro" },
];

const FRIENDLY_ERROR = "Não foi possível concluir a operação. Verifique suas permissões e tente novamente.";
const DUPLICATE_ERROR = "Já existe uma conta cadastrada com esses dados para este cliente.";
const LINK_DUPLICATE_ERROR = "Esta conta já está vinculada a este projeto.";
const EDITORIAL_PLATFORM_SET = new Set<string>(EDITORIAL_PLATFORMS);

function friendly(err: unknown, fallback = FRIENDLY_ERROR) {
  const raw =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message?: unknown }).message || "")
      : "";
  if (/duplicate|unique/i.test(raw)) return fallback === FRIENDLY_ERROR ? DUPLICATE_ERROR : fallback;
  if (/permission|denied|row-level|violates row-level/i.test(raw)) return "Você não tem permissão para esta ação.";
  return fallback;
}

export default function ClientConnectionsPanel({
  clientId,
  clientName,
  initialProjectId = null,
}: Props) {
  const qc = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [platform, setPlatform] = useState<string>("");
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [externalId, setExternalId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [linkOpenFor, setLinkOpenFor] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPlatform, setEditPlatform] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editHandle, setEditHandle] = useState("");
  const [editExternalId, setEditExternalId] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [publishingProjectId, setPublishingProjectId] = useState(
    initialProjectId || "",
  );

  const {
    data: canManage = false,
    isLoading: permissionsLoading,
    isError: permissionsError,
  } = useQuery({
    queryKey: ["can-manage-client", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("can_manage_client", { _client_id: clientId });
      if (error) throw error;
      return !!data;
    },
    enabled: !!clientId,
    retry: false,
  });

  const {
    data: accounts,
    isLoading,
    isError: accountsError,
  } = useQuery({
    queryKey: ["external-accounts", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("external_accounts")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId,
  });

  const { data: projects, isError: projectsError } = useQuery({
    queryKey: ["connections-client-projects", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, client_id")
        .eq("client_id", clientId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId,
  });

  useEffect(() => {
    setPublishingProjectId(initialProjectId || "");
  }, [clientId, initialProjectId]);

  useEffect(() => {
    if (!projects) return;
    setPublishingProjectId((current) => {
      if (projects.some((project) => project.id === current)) return current;
      return projects.length === 1 ? projects[0].id : "";
    });
  }, [projects]);

  const publishingProject = (projects || []).find(
    (project) =>
      project.id === publishingProjectId && project.client_id === clientId,
  );
  const accountIds = useMemo(() => (accounts || []).map((a) => a.id), [accounts]);

  const {
    data: links,
    isLoading: linksLoading,
    isError: linksError,
  } = useQuery({
    queryKey: ["project-external-accounts", clientId, accountIds.join(",")],
    queryFn: async () => {
      if (!accountIds.length) return [];
      const { data, error } = await supabase
        .from("project_external_accounts")
        .select("id, project_id, external_account_id, client_id")
        .eq("client_id", clientId)
        .in("external_account_id", accountIds);
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId && accountIds.length > 0,
  });

  const {
    data: officialConnections,
    isLoading: officialConnectionsLoading,
    isError: officialConnectionsError,
  } = useQuery({
    queryKey: ["external-account-connections", clientId, accountIds.join(",")],
    queryFn: async () => {
      if (!accountIds.length) return [];
      const { data, error } = await supabase
        .from("external_account_connections")
        .select("external_account_id, connection_status, automation_enabled")
        .eq("client_id", clientId)
        .in("external_account_id", accountIds);
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId && accountIds.length > 0,
  });

  const officialAccountIds = useMemo(
    () => new Set((officialConnections || []).map((row) => row.external_account_id)),
    [officialConnections],
  );
  const publishingAccounts = useMemo<EditorialAccountRow[]>(() => {
    const connectionByAccountId = new Map(
      (officialConnections || []).map((connection) => [
        connection.external_account_id,
        connection,
      ]),
    );

    return (accounts || [])
      .filter(
        (account) =>
          account.status === "active" &&
          EDITORIAL_PLATFORM_SET.has(account.platform),
      )
      .map((account) => {
        const connection = connectionByAccountId.get(account.id);
        const connectionStatus: EditorialAccountRow["connection_status"] =
          !connection
            ? "manual"
            : connection.connection_status === "connected"
              ? "connected"
              : connection.connection_status === "revoked"
                ? "revoked"
                : "expired";
        return {
          id: account.id,
          client_id: account.client_id,
          platform: account.platform,
          display_name: account.display_name,
          handle: account.handle,
          status: account.status,
          connection_status: connectionStatus,
          automation_enabled: connection?.automation_enabled === true,
        };
      });
  }, [accounts, officialConnections]);
  const linkedPublishingAccountIds = useMemo(
    () =>
      new Set(
        (links || [])
          .filter((link) => link.project_id === publishingProject?.id)
          .map((link) => link.external_account_id),
      ),
    [links, publishingProject?.id],
  );
  const linkedPublishingAccounts = useMemo(
    () =>
      publishingAccounts.filter((account) =>
        linkedPublishingAccountIds.has(account.id),
      ),
    [linkedPublishingAccountIds, publishingAccounts],
  );
  const availablePublishingAccounts = useMemo(
    () =>
      publishingAccounts.filter(
        (account) => !linkedPublishingAccountIds.has(account.id),
      ),
    [linkedPublishingAccountIds, publishingAccounts],
  );
  const publishingAccountsLoading =
    isLoading ||
    permissionsLoading ||
    linksLoading ||
    officialConnectionsLoading;
  const publishingAccountsError =
    accountsError ||
    permissionsError ||
    linksError ||
    officialConnectionsError;
  const editingOfficial = editingId
    ? officialAccountIds.has(editingId)
    : false;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["external-accounts", clientId] });
    qc.invalidateQueries({ queryKey: ["project-external-accounts", clientId] });
    qc.invalidateQueries({ queryKey: ["external-account-connections", clientId] });
    qc.invalidateQueries({ queryKey: ["editorial-editor-options"] });
  };

  const resetForm = () => {
    setCreating(false);
    setPlatform("");
    setDisplayName("");
    setHandle("");
    setExternalId("");
  };

  const startEditing = (account: NonNullable<typeof accounts>[number]) => {
    resetForm();
    setEditingId(account.id);
    setEditPlatform(account.platform);
    setEditDisplayName(account.display_name);
    setEditHandle(account.handle || "");
    setEditExternalId(account.external_id || "");
    setLinkOpenFor(null);
    setSelectedProjectId("");
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditPlatform("");
    setEditDisplayName("");
    setEditHandle("");
    setEditExternalId("");
  };

  const saveEditing = async () => {
    if (!canManage || !editingId) return;
    if (!editPlatform) {
      toast.error("Selecione uma plataforma");
      return;
    }
    if (!editDisplayName.trim()) {
      toast.error("Nome de exibição é obrigatório");
      return;
    }

    setEditSubmitting(true);
    try {
      const updatePayload = editingOfficial
        ? {
            display_name: editDisplayName.trim(),
            handle: editHandle.trim() || null,
          }
        : {
            platform: editPlatform,
            display_name: editDisplayName.trim(),
            handle: editHandle.trim() || null,
            external_id: editExternalId.trim() || null,
          };
      const { data, error } = await supabase
        .from("external_accounts")
        .update(updatePayload)
        .eq("id", editingId)
        .eq("client_id", clientId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Nenhuma conta foi atualizada");

      toast.success("Conta atualizada");
      cancelEditing();
      invalidate();
    } catch (e: unknown) {
      toast.error(friendly(e, "Falha ao atualizar a conta."));
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleCreate = async () => {
    if (!canManage) return;
    if (!platform) {
      toast.error("Selecione uma plataforma");
      return;
    }
    if (!displayName.trim()) {
      toast.error("Nome de exibição é obrigatório");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from("external_accounts").insert({
        client_id: clientId,
        platform,
        display_name: displayName.trim(),
        handle: handle.trim() || null,
        external_id: externalId.trim() || null,
        status: "active",
      });
      if (error) throw error;
      toast.success("Conta cadastrada");
      resetForm();
      invalidate();
    } catch (e: unknown) {
      toast.error(friendly(e, "Falha ao cadastrar a conta."));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (acc: NonNullable<typeof accounts>[number]) => {
    if (!canManage) return;
    const next = acc.status === "active" ? "inactive" : "active";
    const { data, error } = await supabase
      .from("external_accounts")
      .update({ status: next })
      .eq("id", acc.id)
      .eq("client_id", clientId)
      .select("id")
      .maybeSingle();
    if (error) return toast.error(friendly(error));
    if (!data) return toast.error("O canal não foi alterado. Atualize a tela e tente novamente.");
    toast.success(next === "active" ? "Conta ativada" : "Conta inativada");
    invalidate();
  };

  const linkToProject = async (accountId: string) => {
    if (!canManage) return;
    if (!selectedProjectId) {
      toast.error("Selecione um projeto");
      return;
    }
    const { error } = await supabase.from("project_external_accounts").insert({
      client_id: clientId,
      project_id: selectedProjectId,
      external_account_id: accountId,
    });
    if (error) {
      const isDuplicate = /duplicate|unique/i.test(String(error.message || ""));
      toast.error(isDuplicate ? LINK_DUPLICATE_ERROR : friendly(error));
      return;
    }
    toast.success("Vinculado ao projeto");
    setLinkOpenFor(null);
    setSelectedProjectId("");
    invalidate();
  };

  const unlink = async (linkId: string) => {
    if (!canManage) return;
    const { data, error } = await supabase
      .from("project_external_accounts")
      .delete()
      .eq("id", linkId)
      .eq("client_id", clientId)
      .select("id")
      .maybeSingle();
    if (error) return toast.error(friendly(error));
    if (!data) return toast.error("O vínculo não foi removido. Atualize a tela e tente novamente.");
    toast.success("Vínculo removido");
    invalidate();
  };

  const totalDeCanais = (accounts || []).length;
  const canaisInativos = (accounts || []).filter((a) => a.status !== "active").length;
  const estadoDosCanais = isLoading || accountsError
    ? undefined
    : totalDeCanais === 0
      ? "Nenhum canal"
      : `${totalDeCanais} ${totalDeCanais === 1 ? "canal" : "canais"}${canaisInativos ? ` · ${canaisInativos} ${canaisInativos === 1 ? "inativo" : "inativos"}` : ""}`;
  const estadoDaPublicacao = projectsError
    ? "Projetos indisponíveis"
    : !projects
      ? undefined
      : projects.length === 0
        ? "Nenhum projeto neste cliente"
        : !publishingProject
          ? "Escolha o projeto"
          : publishingAccountsLoading || publishingAccountsError
            ? publishingProject.name
            : `${linkedPublishingAccounts.length} ${linkedPublishingAccounts.length === 1 ? "conta vinculada" : "contas vinculadas"}`;

  return (
    <div className="min-w-0 space-y-6">
      {/* Contas para publicação: o projeto escolhido fica na linha do título */}
      {/* Mesmo cabeçalho da Secao, mas o seletor de projeto desce para uma
          linha inteira no celular (na Secao a ação fica presa à largura dela). */}
      <section className="min-w-0" aria-labelledby="contas-para-publicacao">
        <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between">
          <div className="mr-3 min-w-0 flex-1">
            <div className="flex min-w-0 items-center">
              <h2 id="contas-para-publicacao" className={juntar(texto.tituloSecao, "min-w-0 truncate")}>
                Contas para publicação
              </h2>
              <AjudaRecolhida className="ml-1.5">
                A conta fica salva neste cliente e vinculada ao projeto escolhido. É por ela que o painel publica o
                material aprovado e agendado.
              </AjudaRecolhida>
            </div>
            {estadoDaPublicacao && <p className={juntar(texto.auxiliar, "mt-0.5 truncate")}>{estadoDaPublicacao}</p>}
          </div>
          <div className="mt-2 w-full min-w-0 sm:mt-0 sm:w-56">
            <label htmlFor="publishing-project" className="sr-only">
              Projeto
            </label>
            <select
              id="publishing-project"
              value={publishingProjectId}
              onChange={(event) => setPublishingProjectId(event.target.value)}
              disabled={projectsError || !projects?.length}
              className={campo}
            >
              <option value="">
                {(projects || []).length === 0
                  ? "Nenhum projeto disponível"
                  : "Selecione um projeto"}
              </option>
              {(projects || []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {publishingProject && publishingAccountsLoading && (
          <Carregando linhas={2} rotulo="Carregando contas de publicação" />
        )}
        {publishingProject && publishingAccountsError && (
          <EstadoDeErro
            titulo="Não foi possível carregar as contas de publicação deste projeto."
            acao={
              <button type="button" onClick={invalidate} className={juntar(botao.secundario, "h-8")}>
                Tentar de novo
              </button>
            }
          />
        )}
        {publishingProject &&
          !publishingAccountsLoading &&
          !publishingAccountsError && (
          <EditorialAccountSetup
            clientId={clientId}
            clientName={clientName}
            projectId={publishingProject.id}
            projectName={publishingProject.name || "Projeto"}
            linkedAccounts={linkedPublishingAccounts}
            availableAccounts={availablePublishingAccounts}
            canManage={canManage}
            permissionUnavailable={permissionsError}
            showManualOptions={false}
            onAccountReady={() => undefined}
            embutido
          />
          )}
      </section>

      {/* Canais do cliente: lista com divisória, ação da linha à direita */}
      <Secao
        titulo="Canais"
        divisoria
        descricao={estadoDosCanais}
        ajuda="Instagram, site, WhatsApp e outros canais deste cliente. O cliente já está cadastrado: aqui você só adiciona os canais que ele usa. Não guarde senha, token ou chave de acesso aqui; isso vai no cofre."
        acao={
          canManage && !creating && !editingId ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              aria-label="Adicionar canal"
              className={botao.secundario}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="ml-1.5 hidden sm:inline">Adicionar canal</span>
            </button>
          ) : undefined
        }
      >
        {(permissionsError || projectsError || linksError || officialConnectionsError) && (
          <div className="mb-3 space-y-1">
            {permissionsError && (
              <p className="flex min-w-0 items-start text-[12px] leading-4 text-warning" role="status">
                <AlertTriangle className="mr-1.5 mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Não foi possível confirmar sua permissão. Os canais estão em modo de leitura.
              </p>
            )}
            {(projectsError || linksError || officialConnectionsError) && (
              <p className="flex min-w-0 items-start text-[12px] leading-4 text-warning" role="status">
                <AlertTriangle className="mr-1.5 mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Alguns vínculos oficiais ou com projetos estão indisponíveis agora.
              </p>
            )}
          </div>
        )}

        {canManage && !permissionsLoading && creating && (
          <div className={juntar(superficie.poco, "mb-3 p-3 sm:p-4")}>
            <GrupoDeCampos>
              <CampoDeFormulario rotulo="Canal ou plataforma" obrigatorio>
                <select
                  id="new-channel-platform"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className={campo}
                >
                  <option value="">Selecione uma plataforma</option>
                  {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Nome para identificar" obrigatorio>
                <input
                  id="new-channel-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ex.: Instagram oficial"
                  className={campo}
                />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Usuário, link ou domínio">
                <input
                  id="new-channel-address"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="Ex.: @cliente ou cliente.com.br"
                  className={campo}
                />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Código da conta" apoio="Opcional. Nada de senha, token ou chave.">
                <input
                  id="new-channel-code"
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                  placeholder="Pode deixar em branco"
                  className={campo}
                />
              </CampoDeFormulario>
            </GrupoDeCampos>
            <div className="mt-4 flex justify-end [&>*+*]:ml-2">
              <button type="button" onClick={resetForm} className={botao.discreto}>
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={submitting || !platform || !displayName.trim()}
                className={botao.primario}
              >
                {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
                Salvar canal
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <Carregando linhas={2} rotulo="Carregando canais" />
        ) : accountsError ? (
          <EstadoDeErro
            titulo="Não foi possível carregar os canais deste cliente."
            acao={
              <button type="button" onClick={invalidate} className={juntar(botao.secundario, "h-8")}>
                Tentar de novo
              </button>
            }
          />
        ) : !accounts || accounts.length === 0 ? (
          <EstadoVazio
            compacto
            titulo="Nenhum canal ainda."
            descricao={canManage ? "Use Adicionar canal para incluir Instagram, site ou WhatsApp." : undefined}
          />
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {accounts.map((acc) => {
              const accLinks = (links || []).filter((link) => link.external_account_id === acc.id);
              const linkedProjectIds = new Set(accLinks.map((link) => link.project_id));
              const availableProjects = (projects || []).filter((project) => !linkedProjectIds.has(project.id));
              const isInactive = acc.status !== "active";
              const isEditing = editingId === acc.id;
              const isOfficial = officialAccountIds.has(acc.id);
              const nomeDaPlataforma = PLATFORMS.find(p => p.value === acc.platform)?.label || acc.platform;
              return (
                <li key={acc.id} className="min-w-0 py-3">
                  {isEditing ? (
                    <div className={juntar(superficie.poco, "p-3 sm:p-4")}>
                      <GrupoDeCampos>
                        <CampoDeFormulario
                          rotulo="Canal ou plataforma"
                          obrigatorio
                          apoio={editingOfficial ? "Conta oficial Meta: plataforma e ID são protegidos." : undefined}
                          ajuda={editingOfficial ? "Para trocar a identidade, desconecte e autorize a conta correta." : undefined}
                        >
                          <select
                            id={`edit-channel-platform-${acc.id}`}
                            value={editPlatform}
                            onChange={(e) => setEditPlatform(e.target.value)}
                            disabled={editingOfficial}
                            className={campo}
                          >
                            <option value="">Selecione uma plataforma</option>
                            {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                          </select>
                        </CampoDeFormulario>
                        <CampoDeFormulario rotulo="Nome para identificar" obrigatorio>
                          <input
                            id={`edit-channel-name-${acc.id}`}
                            value={editDisplayName}
                            onChange={(e) => setEditDisplayName(e.target.value)}
                            className={campo}
                          />
                        </CampoDeFormulario>
                        <CampoDeFormulario rotulo="Usuário, link ou domínio">
                          <input
                            id={`edit-channel-address-${acc.id}`}
                            value={editHandle}
                            onChange={(e) => setEditHandle(e.target.value)}
                            placeholder="Ex.: @cliente ou cliente.com.br"
                            className={campo}
                          />
                        </CampoDeFormulario>
                        <CampoDeFormulario rotulo="Código da conta" apoio={editingOfficial ? undefined : "Opcional."}>
                          <input
                            id={`edit-channel-code-${acc.id}`}
                            value={editExternalId}
                            onChange={(e) => setEditExternalId(e.target.value)}
                            readOnly={editingOfficial}
                            className={juntar(campo, "read-only:cursor-not-allowed read-only:opacity-60")}
                          />
                        </CampoDeFormulario>
                      </GrupoDeCampos>
                      <div className="mt-4 flex justify-end [&>*+*]:ml-2">
                        <button
                          type="button"
                          onClick={cancelEditing}
                          disabled={editSubmitting}
                          className={botao.discreto}
                        >
                          <X className="mr-1.5 h-4 w-4" aria-hidden="true" /> Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={saveEditing}
                          disabled={editSubmitting || !editPlatform || !editDisplayName.trim()}
                          className={botao.primario}
                        >
                          {editSubmitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                          Salvar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-w-0 items-start">
                      <div className={juntar("min-w-0 flex-1", isInactive && "opacity-60")}>
                        <div className="flex min-w-0 items-center">
                          <p className={juntar(texto.corpo, "min-w-0 truncate font-medium")}>{acc.display_name}</p>
                          {isOfficial && (
                            <span className={juntar(etiqueta, "ml-2 bg-primary/10 text-primary")}>
                              Oficial Meta
                            </span>
                          )}
                          {isInactive && (
                            <span className={juntar(etiqueta, "ml-2 bg-muted text-muted-foreground")}>Inativa</span>
                          )}
                        </div>
                        <p className={juntar(texto.auxiliar, "mt-0.5 truncate")}>
                          {nomeDaPlataforma}
                          {acc.handle && <span> · {acc.handle}</span>}
                          {acc.external_id && <span className="tabular-nums"> · ID {acc.external_id}</span>}
                        </p>
                      </div>
                      {canManage && !creating && !editingId && (
                        <div className="-my-0.5 ml-3 flex shrink-0 items-center [&>*+*]:ml-1">
                          <button
                            type="button"
                            onClick={() => startEditing(acc)}
                            title={
                              officialConnectionsError
                                ? "Não foi possível confirmar se a conta é oficial"
                                : officialConnectionsLoading
                                  ? "Confirmando o tipo da conta"
                                  : "Editar conta"
                            }
                            aria-label="Editar canal"
                            disabled={
                              officialConnectionsLoading ||
                              officialConnectionsError
                            }
                            className={juntar(botao.discreto, "h-8 px-2 disabled:cursor-not-allowed disabled:opacity-40")}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="ml-1.5 hidden md:inline">Editar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleStatus(acc)}
                            title={isInactive ? "Ativar" : "Inativar"}
                            aria-label={isInactive ? "Ativar canal" : "Inativar canal"}
                            className={juntar(botao.discreto, "h-8 px-2")}
                          >
                            {isInactive ? <Power className="h-3.5 w-3.5" aria-hidden="true" /> : <PowerOff className="h-3.5 w-3.5" aria-hidden="true" />}
                            <span className="ml-1.5 hidden md:inline">{isInactive ? "Ativar" : "Inativar"}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => { setLinkOpenFor(linkOpenFor === acc.id ? null : acc.id); setSelectedProjectId(""); }}
                            title={
                              projectsError || linksError
                                ? "Vínculos indisponíveis no momento"
                                : availableProjects.length > 0
                                  ? "Vincular a projeto"
                                  : "Todos os projetos já estão vinculados"
                            }
                            aria-label="Vincular canal a um projeto"
                            aria-expanded={linkOpenFor === acc.id}
                            disabled={projectsError || linksError || availableProjects.length === 0}
                            className={juntar(botao.discreto, "h-8 px-2 disabled:cursor-not-allowed disabled:opacity-40")}
                          >
                            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="ml-1.5 hidden md:inline">Projeto</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {canManage && !isEditing && !projectsError && !linksError && linkOpenFor === acc.id && availableProjects.length > 0 && (
                    <div className="mt-2 flex min-w-0 items-center">
                      <select
                        value={selectedProjectId}
                        onChange={(e) => setSelectedProjectId(e.target.value)}
                        aria-label="Projeto para vincular"
                        className={juntar(campo, "flex-1")}
                      >
                        <option value="">Selecione um projeto…</option>
                        {availableProjects.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!selectedProjectId}
                        onClick={() => linkToProject(acc.id)}
                        className={juntar(botao.primario, "ml-2")}
                      >
                        Vincular
                      </button>
                    </div>
                  )}

                  {!projectsError && !linksError && accLinks.length > 0 && (
                    <div className="-m-0.5 mt-1.5 flex min-w-0 flex-wrap [&>*]:m-0.5">
                      {accLinks.map((l) => {
                        const proj = (projects || []).find((p) => p.id === l.project_id);
                        return (
                          <span key={l.id} className="inline-flex h-6 min-w-0 max-w-full items-center rounded bg-muted pl-2 pr-0.5 text-[12px] text-foreground">
                            <span className="min-w-0 truncate">{proj?.name || "Projeto"}</span>
                            {canManage ? (
                              <button
                                type="button"
                                onClick={() => unlink(l.id)}
                                title="Desvincular"
                                aria-label={`Desvincular do projeto ${proj?.name || "selecionado"}`}
                                className={juntar("ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive", foco)}
                              >
                                <Link2Off className="h-3 w-3" aria-hidden="true" />
                              </button>
                            ) : (
                              <span className="w-1.5" aria-hidden="true" />
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Secao>
    </div>
  );
}
