import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Building2,
  Cable,
  CheckCircle2,
  Facebook,
  FolderKanban,
  Instagram,
  Link2,
  Loader2,
  Plus,
  ShieldAlert,
  Unplug,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useEditorialAccountMutations,
  type EditorialAccountRow,
} from "@/hooks/useEditorialCalendar";
import { useMetaOAuth } from "@/hooks/useMetaOAuth";
import {
  EDITORIAL_PLATFORMS,
  PLATFORM_LABELS,
  type EditorialPlatform,
} from "@/lib/editorial";
import {
  filterMetaOAuthResources,
  parseMetaOAuthPopupMessage,
  type MetaOAuthResource,
} from "@/lib/socialMetaOAuth";

interface EditorialAccountSetupProps {
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  linkedAccounts: EditorialAccountRow[];
  availableAccounts: EditorialAccountRow[];
  canManage: boolean;
  permissionUnavailable: boolean;
  onAccountReady: (accountId: string) => void;
}

const MAX_VISIBLE_META_RESOURCES = 100;

interface ActiveMetaSession {
  id: string;
  clientId: string;
  projectId: string;
}

const META_POPUP_TIMEOUT_MS = 5 * 60 * 1_000;
const META_POPUP_POLL_MS = 500;

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  const candidate = error as { message?: unknown } | null;
  return typeof candidate?.message === "string" && candidate.message.trim()
    ? candidate.message
    : fallback;
}

function accountConnectionLabel(account: EditorialAccountRow) {
  if (account.connection_status === "connected") return "Conectada";
  if (account.connection_status === "expired") return "Expirada";
  if (account.connection_status === "revoked") return "Desconectada";
  return "Manual";
}

function AccountConnectionBadge({ account }: { account: EditorialAccountRow }) {
  const label = accountConnectionLabel(account);
  const className =
    account.connection_status === "connected"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : account.connection_status === "expired"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : account.connection_status === "revoked"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "border-border bg-muted/30 text-muted-foreground";

  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

function MetaPlatformIcon({ platform }: { platform: MetaOAuthResource["platform"] }) {
  return platform === "instagram" ? (
    <Instagram className="h-4 w-4" aria-hidden="true" />
  ) : (
    <Facebook className="h-4 w-4" aria-hidden="true" />
  );
}

export default function EditorialAccountSetup({
  clientId,
  clientName,
  projectId,
  projectName,
  linkedAccounts,
  availableAccounts,
  canManage,
  permissionUnavailable,
  onAccountReady,
}: EditorialAccountSetupProps) {
  const { createAndLinkAccount, linkAccount } = useEditorialAccountMutations(
    clientId,
    projectId,
  );
  const {
    startConnection,
    connectResource,
    finishSession,
    disconnectAccount,
  } = useMetaOAuth(clientId, projectId);
  const popupRef = useRef<Window | null>(null);
  const popupPollRef = useRef<number | null>(null);
  const popupTimeoutRef = useRef<number | null>(null);
  const scopeRef = useRef({ clientId, projectId });
  const activeMetaSessionRef = useRef<ActiveMetaSession | null>(null);
  const finalizingSessionIdsRef = useRef(new Set<string>());
  const [expanded, setExpanded] = useState(false);
  const [existingAccountId, setExistingAccountId] = useState("");
  const [platform, setPlatform] = useState<EditorialPlatform | "">("");
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [metaDialogOpen, setMetaDialogOpen] = useState(false);
  const [metaSessionId, setMetaSessionId] = useState("");
  const [metaResources, setMetaResources] = useState<MetaOAuthResource[]>([]);
  const [metaSearch, setMetaSearch] = useState("");
  const [connectedMetaCandidateIds, setConnectedMetaCandidateIds] = useState<
    string[]
  >([]);
  const pending =
    createAndLinkAccount.isPending ||
    linkAccount.isPending ||
    startConnection.isPending ||
    connectResource.isPending ||
    finishSession.isPending ||
    disconnectAccount.isPending;
  const linkedAccountCount = linkedAccounts.length;
  const showForm = linkedAccountCount === 0 || expanded;
  const filteredMetaResources = useMemo(
    () => filterMetaOAuthResources(metaResources, metaSearch),
    [metaResources, metaSearch],
  );
  const visibleMetaResources = filteredMetaResources.slice(
    0,
    MAX_VISIBLE_META_RESOURCES,
  );

  const clearPopupMonitoring = useCallback(() => {
    if (popupPollRef.current !== null) {
      window.clearInterval(popupPollRef.current);
      popupPollRef.current = null;
    }
    if (popupTimeoutRef.current !== null) {
      window.clearTimeout(popupTimeoutRef.current);
      popupTimeoutRef.current = null;
    }
  }, []);

  const clearMetaSelection = useCallback(() => {
    activeMetaSessionRef.current = null;
    setMetaDialogOpen(false);
    setMetaSessionId("");
    setMetaResources([]);
    setMetaSearch("");
    setConnectedMetaCandidateIds([]);
  }, []);

  const finishSessionAsyncRef = useRef(finishSession.mutateAsync);
  useEffect(() => {
    finishSessionAsyncRef.current = finishSession.mutateAsync;
  }, [finishSession.mutateAsync]);

  const finalizeMetaSession = useCallback(
    async (session: ActiveMetaSession | null) => {
      if (!session || finalizingSessionIdsRef.current.has(session.id)) return;
      finalizingSessionIdsRef.current.add(session.id);
      try {
        await finishSessionAsyncRef.current({
          oauthSessionId: session.id,
          sessionClientId: session.clientId,
          sessionProjectId: session.projectId,
        });
      } catch (error: unknown) {
        toast.warning(
          errorMessage(
            error,
            "A conta foi preservada, mas não foi possível encerrar a sessão temporária da Meta.",
          ),
        );
      } finally {
        finalizingSessionIdsRef.current.delete(session.id);
        if (activeMetaSessionRef.current?.id === session.id) {
          clearMetaSelection();
        }
      }
    },
    [clearMetaSelection],
  );

  useLayoutEffect(() => {
    const previousSession = activeMetaSessionRef.current;
    scopeRef.current = { clientId, projectId };
    clearPopupMonitoring();
    popupRef.current?.close();
    popupRef.current = null;
    setExpanded(false);
    setExistingAccountId("");
    setPlatform("");
    setDisplayName("");
    setHandle("");
    clearMetaSelection();
    if (
      previousSession &&
      (previousSession.clientId !== clientId ||
        previousSession.projectId !== projectId)
    ) {
      void finalizeMetaSession(previousSession);
    }
  }, [
    clearMetaSelection,
    clearPopupMonitoring,
    clientId,
    finalizeMetaSession,
    projectId,
  ]);

  useEffect(() => {
    if (
      existingAccountId &&
      !availableAccounts.some((account) => account.id === existingAccountId)
    ) {
      setExistingAccountId("");
    }
  }, [availableAccounts, existingAccountId]);

  const monitorMetaPopup = useCallback(
    (popup: Window) => {
      clearPopupMonitoring();
      popupPollRef.current = window.setInterval(() => {
        if (!popup.closed || popupRef.current !== popup) return;
        clearPopupMonitoring();
        popupRef.current = null;
        toast.error("A janela de conexão foi fechada antes da conclusão.");
      }, META_POPUP_POLL_MS);
      popupTimeoutRef.current = window.setTimeout(() => {
        if (popupRef.current !== popup) return;
        clearPopupMonitoring();
        popup.close();
        popupRef.current = null;
        toast.error("A conexão com a Meta expirou. Tente novamente.");
      }, META_POPUP_TIMEOUT_MS);
    },
    [clearPopupMonitoring],
  );

  useEffect(() => {
    const receiveMetaResult = (event: MessageEvent<unknown>) => {
      const popup = popupRef.current;
      if (
        event.origin !== window.location.origin ||
        !popup ||
        event.source !== popup
      ) {
        return;
      }

      const message = parseMetaOAuthPopupMessage(event.data);
      if (!message) return;
      clearPopupMonitoring();
      popupRef.current = null;

      if (message.ok === false) {
        toast.error(message.error);
        return;
      }

      const currentScope = scopeRef.current;
      const activeSession = {
        id: message.oauth_session_id,
        clientId: currentScope.clientId,
        projectId: currentScope.projectId,
      };
      activeMetaSessionRef.current = activeSession;

      if (message.resources.length === 0) {
        toast.error(
          "A Meta não encontrou Página do Facebook ou Instagram profissional disponível.",
        );
        void finalizeMetaSession(activeSession);
        return;
      }

      setMetaSessionId(message.oauth_session_id);
      setMetaResources(message.resources);
      setMetaSearch("");
      setConnectedMetaCandidateIds([]);
      setMetaDialogOpen(true);
    };

    window.addEventListener("message", receiveMetaResult);
    return () => {
      window.removeEventListener("message", receiveMetaResult);
      clearPopupMonitoring();
      popupRef.current?.close();
      popupRef.current = null;
      void finalizeMetaSession(activeMetaSessionRef.current);
    };
  }, [clearPopupMonitoring, finalizeMetaSession]);

  const handleStartMetaConnection = async () => {
    if (!canManage || pending) return;

    const requestScope = { clientId, projectId };
    setMetaSearch("");
    popupRef.current?.close();
    const popup = window.open(
      "about:blank",
      "aceleriq-meta-oauth",
      "popup=yes,width=620,height=760,resizable=yes,scrollbars=yes",
    );
    if (!popup) {
      toast.error("Autorize pop-ups para conectar sua conta da Meta.");
      return;
    }

    popupRef.current = popup;
    monitorMetaPopup(popup);
    try {
      const { authorization_url: authorizationUrl } =
        await startConnection.mutateAsync();
      if (
        popupRef.current !== popup ||
        popup.closed ||
        scopeRef.current.clientId !== requestScope.clientId ||
        scopeRef.current.projectId !== requestScope.projectId
      ) {
        if (popupRef.current === popup) {
          clearPopupMonitoring();
          popup.close();
          popupRef.current = null;
        }
        return;
      }
      popup.location.replace(authorizationUrl);
      popup.focus();
    } catch (error: unknown) {
      if (
        popupRef.current !== popup ||
        scopeRef.current.clientId !== requestScope.clientId ||
        scopeRef.current.projectId !== requestScope.projectId
      ) {
        return;
      }
      clearPopupMonitoring();
      popup.close();
      if (popupRef.current === popup) popupRef.current = null;
      toast.error(
        errorMessage(error, "Não foi possível iniciar a conexão com a Meta."),
      );
    }
  };

  const handleConnectMetaResource = async (resource: MetaOAuthResource) => {
    const activeSession = activeMetaSessionRef.current;
    if (
      !canManage ||
      !metaSessionId ||
      !activeSession ||
      activeSession.id !== metaSessionId ||
      connectedMetaCandidateIds.includes(resource.candidate_id)
    ) {
      return;
    }
    try {
      const { external_account_id: accountId } =
        await connectResource.mutateAsync({
          oauthSessionId: metaSessionId,
          candidateId: resource.candidate_id,
        });
      if (
        scopeRef.current.clientId !== activeSession.clientId ||
        scopeRef.current.projectId !== activeSession.projectId ||
        activeMetaSessionRef.current?.id !== activeSession.id
      ) {
        return;
      }

      const connectedCandidateIds = [
        ...connectedMetaCandidateIds,
        resource.candidate_id,
      ];
      setConnectedMetaCandidateIds(connectedCandidateIds);
      onAccountReady(accountId);
      if (connectedCandidateIds.length >= metaResources.length) {
        setMetaDialogOpen(false);
        toast.success("Contas oficiais conectadas e selecionadas.");
        await finalizeMetaSession(activeSession);
      } else {
        toast.success(
          "Conta oficial conectada. Você pode escolher outra ou concluir.",
        );
      }
    } catch (error: unknown) {
      if (
        scopeRef.current.clientId !== activeSession.clientId ||
        scopeRef.current.projectId !== activeSession.projectId
      ) {
        return;
      }
      toast.error(
        errorMessage(error, "Não foi possível vincular a conta da Meta."),
      );
    }
  };

  const handleDisconnectMetaAccount = async (accountId: string) => {
    if (!canManage) return;
    try {
      await disconnectAccount.mutateAsync(accountId);
      toast.success("Conexão oficial removida. A conta não será apagada.");
    } catch (error: unknown) {
      toast.error(
        errorMessage(error, "Não foi possível desconectar a conta da Meta."),
      );
    }
  };

  const handleFinishMetaConnection = () => {
    const activeSession = activeMetaSessionRef.current;
    setMetaDialogOpen(false);
    void finalizeMetaSession(activeSession);
  };

  const handleLinkExisting = async () => {
    if (!canManage || !existingAccountId) return;
    try {
      const accountId = await linkAccount.mutateAsync({
        accountId: existingAccountId,
      });
      setExistingAccountId("");
      setExpanded(false);
      onAccountReady(accountId);
      toast.success("Conta vinculada e selecionada nesta publicação.");
    } catch (error: unknown) {
      const message = errorMessage(
        error,
        "Não foi possível vincular a conta ao projeto.",
      );
      toast.error(
        /duplicate|unique/i.test(message)
          ? "Esta conta já está vinculada ao projeto."
          : message,
      );
    }
  };

  const handleCreate = async () => {
    if (!canManage) return;
    if (!platform) {
      toast.error("Selecione a plataforma.");
      return;
    }
    if (!displayName.trim()) {
      toast.error("Informe um nome para identificar a conta.");
      return;
    }

    try {
      const accountId = await createAndLinkAccount.mutateAsync({
        platform,
        displayName: displayName.trim(),
        handle: handle.trim() || null,
      });
      setPlatform("");
      setDisplayName("");
      setHandle("");
      setExpanded(false);
      onAccountReady(accountId);
      toast.success("Conta manual cadastrada e selecionada nesta publicação.");
    } catch (error: unknown) {
      const message = errorMessage(
        error,
        "Não foi possível cadastrar e vincular a conta.",
      );
      toast.error(
        /duplicate|unique/i.test(message)
          ? "Já existe uma conta com essa plataforma e usuário para este cliente."
          : message,
      );
    }
  };

  if (!canManage && linkedAccountCount > 0) {
    return null;
  }

  return (
    <>
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              {linkedAccountCount === 0
                ? "Adicione uma conta para liberar as plataformas"
                : "Contas de publicação"}
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              Conecte a Meta oficialmente ou mantenha um cadastro manual. O
              conteúdo atual permanece aberto.
            </p>
          </div>
          {canManage && linkedAccountCount > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setExpanded((current) => !current)}
              disabled={pending}
            >
              {showForm ? (
                <X className="mr-1.5 h-4 w-4" />
              ) : (
                <Plus className="mr-1.5 h-4 w-4" />
              )}
              {showForm ? "Fechar cadastro manual" : "Cadastro manual"}
            </Button>
          )}
        </div>

        {!canManage && (
          <div
            className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-xs text-amber-700 dark:text-amber-300"
            role="alert"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {permissionUnavailable
                ? "Não foi possível confirmar sua permissão. Atualize a tela ou peça a um administrador para vincular a conta."
                : "Somente administradores e responsáveis por este cliente podem cadastrar ou vincular contas. Peça a um responsável para concluir esta etapa."}
            </p>
          </div>
        )}

        {linkedAccounts.length > 0 && (
          <div className="mt-4 space-y-2" aria-label="Contas vinculadas">
            {linkedAccounts.map((account) => (
              <div
                key={account.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                  {PLATFORM_LABELS[account.platform as EditorialPlatform] ||
                    account.platform}
                  {" · "}
                  {account.handle || account.display_name}
                </span>
                <AccountConnectionBadge account={account} />
                {canManage && account.connection_status === "connected" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => handleDisconnectMetaAccount(account.id)}
                    disabled={pending}
                    aria-label={`Desconectar ${account.display_name}`}
                  >
                    {disconnectAccount.isPending &&
                    disconnectAccount.variables === account.id ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Unplug className="mr-1 h-3.5 w-3.5" />
                    )}
                    Desconectar
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {canManage && (
          <div className="mt-4 rounded-xl border border-primary/25 bg-primary/[0.04] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <Cable className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Conexão oficial Meta
                  </p>
                  <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                    Entre com Facebook/Meta para escolher Páginas que você
                    administra e contas profissionais do Instagram ligadas a
                    elas. A senha nunca passa pelo Aceleriq OS.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                onClick={handleStartMetaConnection}
                disabled={pending}
              >
                {startConnection.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Cable className="mr-1.5 h-4 w-4" />
                )}
                Entrar com Facebook/Meta
              </Button>
            </div>
            <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
              A conexão apenas identifica e vincula a conta. A publicação
              automática ainda não está habilitada.
            </p>
          </div>
        )}

        {canManage && showForm && (
          <div className="mt-4 space-y-4 border-t border-border pt-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Alternativas de cadastro
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Vincule uma conta já existente ou registre uma referência
                manual, sem login oficial e somente para planejamento.
              </p>
            </div>

            {availableAccounts.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="editorial-existing-account">
                  Conta já cadastrada
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select
                    value={existingAccountId}
                    onValueChange={setExistingAccountId}
                    disabled={pending}
                  >
                    <SelectTrigger
                      id="editorial-existing-account"
                      className="flex-1"
                    >
                      <SelectValue placeholder="Selecione uma conta" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableAccounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {PLATFORM_LABELS[
                            account.platform as EditorialPlatform
                          ] || account.platform}
                          {" · "}
                          {account.handle || account.display_name}
                          {" · "}
                          {accountConnectionLabel(account)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleLinkExisting}
                    disabled={pending || !existingAccountId}
                  >
                    {linkAccount.isPending ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Link2 className="mr-1.5 h-4 w-4" />
                    )}
                    Vincular e usar
                  </Button>
                </div>
              </div>
            )}

            <div className="grid gap-3 border-t border-border pt-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="editorial-new-account-platform">
                  Plataforma manual
                </Label>
                <Select
                  value={platform}
                  onValueChange={(value) =>
                    setPlatform(value as EditorialPlatform)
                  }
                  disabled={pending}
                >
                  <SelectTrigger id="editorial-new-account-platform">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {EDITORIAL_PLATFORMS.map((item) => (
                      <SelectItem key={item} value={item}>
                        {PLATFORM_LABELS[item]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="editorial-new-account-name">
                  Nome da conta
                </Label>
                <Input
                  id="editorial-new-account-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Ex.: Instagram oficial"
                  maxLength={120}
                  disabled={pending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editorial-new-account-handle">
                  Usuário ou @
                </Label>
                <Input
                  id="editorial-new-account-handle"
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  placeholder="Ex.: @cliente"
                  maxLength={180}
                  disabled={pending}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] leading-4 text-muted-foreground">
                Cadastro manual: libera somente planejamento e agendamento
                interno; não autentica a rede social.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={handleCreate}
                disabled={pending || !platform || !displayName.trim()}
              >
                {createAndLinkAccount.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 h-4 w-4" />
                )}
                Cadastrar manualmente e usar
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={metaDialogOpen}
        onOpenChange={(open) => {
          if (connectResource.isPending || finishSession.isPending) return;
          if (open) {
            setMetaDialogOpen(true);
            return;
          }
          handleFinishMetaConnection();
        }}
      >
        <DialogContent
          className="sm:max-w-lg"
          aria-busy={connectResource.isPending || finishSession.isPending}
        >
          <DialogHeader>
            <DialogTitle>Escolha a conta da Meta</DialogTitle>
            <DialogDescription>
              Pesquise e vincule somente a Página ou conta profissional que
              pertence ao cliente abaixo. Isso não ativa publicação automática.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-primary/25 bg-primary/[0.04] p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Destino obrigatório do vínculo
            </p>
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex min-w-0 items-center gap-2">
                <Building2
                  className="h-4 w-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block text-[10px] text-muted-foreground">
                    Cliente
                  </span>
                  <span className="block truncate font-medium text-foreground">
                    {clientName}
                  </span>
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <FolderKanban
                  className="h-4 w-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block text-[10px] text-muted-foreground">
                    Projeto
                  </span>
                  <span className="block truncate text-foreground">
                    {projectName}
                  </span>
                </span>
              </div>
            </div>
          </div>
          <Command
            shouldFilter={false}
            className="rounded-lg border border-border"
          >
            <CommandInput
              value={metaSearch}
              onValueChange={setMetaSearch}
              placeholder="Pesquisar por nome, @ ou plataforma"
              aria-label="Pesquisar contas encontradas na Meta"
              maxLength={120}
            />
            <div
              className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground"
              aria-live="polite"
            >
              {filteredMetaResources.length} de {metaResources.length} contas
              {filteredMetaResources.length > MAX_VISIBLE_META_RESOURCES
                ? ` · mostrando as primeiras ${MAX_VISIBLE_META_RESOURCES}`
                : ""}
            </div>
            <CommandList className="max-h-[45vh] overscroll-contain p-1">
              <CommandEmpty>
                Nenhuma conta encontrada. Tente buscar pelo nome ou @.
              </CommandEmpty>
              <CommandGroup>
                {visibleMetaResources.map((resource) => {
                  const connected = connectedMetaCandidateIds.includes(
                    resource.candidate_id,
                  );
                  const connecting =
                    connectResource.isPending &&
                    connectResource.variables?.candidateId ===
                      resource.candidate_id;
                  return (
                    <CommandItem
                      key={resource.candidate_id}
                      value={resource.candidate_id}
                      className="min-h-14 cursor-pointer gap-3 border border-transparent px-3 py-2.5 data-[selected=true]:border-primary/40"
                      onSelect={() => handleConnectMetaResource(resource)}
                      disabled={connectResource.isPending || connected}
                    >
                      <span className="rounded-lg bg-muted p-2 text-foreground">
                        <MetaPlatformIcon platform={resource.platform} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {resource.display_name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {resource.platform === "instagram"
                            ? "Instagram profissional"
                            : "Página do Facebook"}
                          {resource.handle ? ` · ${resource.handle}` : ""}
                        </span>
                      </span>
                      {connected ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          Conectada
                        </span>
                      ) : connecting ? (
                        <span className="inline-flex items-center">
                          <Loader2
                            className="h-4 w-4 animate-spin text-primary"
                            aria-hidden="true"
                          />
                          <span className="sr-only">
                            Vinculando {resource.display_name}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-primary">
                          Vincular
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
          <DialogFooter>
            <Button
              type="button"
              onClick={handleFinishMetaConnection}
              disabled={connectResource.isPending || finishSession.isPending}
            >
              {finishSession.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              Concluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
