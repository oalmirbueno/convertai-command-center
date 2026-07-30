import { useEffect, useState } from "react";
import { Link2, Loader2, Plus, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import {
  EDITORIAL_PLATFORMS,
  PLATFORM_LABELS,
  type EditorialPlatform,
} from "@/lib/editorial";

interface EditorialAccountSetupProps {
  clientId: string;
  projectId: string;
  linkedAccountCount: number;
  availableAccounts: EditorialAccountRow[];
  canManage: boolean;
  permissionUnavailable: boolean;
  onAccountReady: (accountId: string) => void;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  const candidate = error as { message?: unknown } | null;
  return typeof candidate?.message === "string" && candidate.message.trim()
    ? candidate.message
    : fallback;
}

export default function EditorialAccountSetup({
  clientId,
  projectId,
  linkedAccountCount,
  availableAccounts,
  canManage,
  permissionUnavailable,
  onAccountReady,
}: EditorialAccountSetupProps) {
  const { createAndLinkAccount, linkAccount } = useEditorialAccountMutations(
    clientId,
    projectId,
  );
  const [expanded, setExpanded] = useState(false);
  const [existingAccountId, setExistingAccountId] = useState("");
  const [platform, setPlatform] = useState<EditorialPlatform | "">("");
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const pending = createAndLinkAccount.isPending || linkAccount.isPending;
  const showForm = linkedAccountCount === 0 || expanded;

  useEffect(() => {
    setExpanded(false);
    setExistingAccountId("");
    setPlatform("");
    setDisplayName("");
    setHandle("");
  }, [clientId, projectId]);

  useEffect(() => {
    if (
      existingAccountId &&
      !availableAccounts.some((account) => account.id === existingAccountId)
    ) {
      setExistingAccountId("");
    }
  }, [availableAccounts, existingAccountId]);

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
      toast.success("Conta cadastrada e selecionada nesta publicação.");
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
    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">
            {linkedAccountCount === 0
              ? "Adicione uma conta para liberar as plataformas"
              : "Contas de publicação"}
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            Cadastre ou vincule a conta sem sair deste conteúdo. O preenchimento
            atual permanece aberto.
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
            {showForm ? "Fechar" : "Adicionar ou vincular"}
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

      {canManage && showForm && (
        <div className="mt-4 space-y-4">
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
                Nova plataforma
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
              O cadastro libera o planejamento. Publicar automaticamente ainda
              exige a conexão oficial da rede social.
            </p>
            <Button
              type="button"
              onClick={handleCreate}
              disabled={pending || !platform || !displayName.trim()}
            >
              {createAndLinkAccount.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1.5 h-4 w-4" />
              )}
              Cadastrar e usar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
