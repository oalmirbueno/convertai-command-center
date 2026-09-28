import { useState, useRef, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { FileSignature, Upload, Send, CheckCircle2, Clock, ExternalLink, Copy, Mail, Trash2 } from "lucide-react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import {
  AreaDeTrabalho,
  CabecalhoDePagina,
  CampoDeBusca,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  GrupoDeCampos,
  Painel,
  SeletorCompacto,
  botao,
  campo,
  campoTexto,
  etiqueta,
  juntar,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";
import {
  resolveFileUrl,
  storageRefFromFile,
  useResolvedFileUrl,
} from "@/lib/fileUrls";

type Contract = {
  id: string;
  title: string;
  description: string | null;
  client_id: string;
  status: string;
  original_file_url: string;
  original_file_name: string;
  admin_signature_name: string | null;
  admin_signed_at: string | null;
  client_signature_name: string | null;
  client_signed_at: string | null;
  sign_token: string;
  sent_at: string | null;
  created_at: string;
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  draft: { label: "Rascunho", cls: "bg-muted text-muted-foreground" },
  sent: { label: "Aguardando cliente", cls: "bg-warning/15 text-warning" },
  signed: { label: "Em revisão", cls: "bg-primary/15 text-primary" },
  completed: { label: "Assinado", cls: "bg-success/15 text-success" },
};

const FILTROS_DE_STATUS = [
  { valor: "todos", rotulo: "Todos os status" },
  { valor: "draft", rotulo: "Rascunho" },
  { valor: "sent", rotulo: "Aguardando cliente" },
  { valor: "signed", rotulo: "Em revisão" },
  { valor: "completed", rotulo: "Assinado" },
];

function normalizar(v: string) {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export default function AdminContracts({ clientId: lockedClientId }: { clientId?: string } = {}) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: clients = [] } = useClients();
  const isAdminOrStaff = profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "");
  const canManageContracts =
    profile?.role === "admin" || profile?.role === "manager";
  const canDeleteContracts = profile?.role === "admin";

  // "Novo contrato" do agente Aceleriq chega com ?novo=1&client=<id>.
  const [params] = useSearchParams();
  const [uploadOpen, setUploadOpen] = useState(params.get("novo") === "1");
  const clienteDoLink = params.get("client") || "";
  const [signOpen, setSignOpen] = useState<Contract | null>(null);
  const [linkOpen, setLinkOpen] = useState<{ url: string; email: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Contract | null>(null);
  // Filtro e busca lembrados ao sair e voltar (por cliente quando a lista está travada num cliente).
  const escopo = lockedClientId || "todos";
  const [filtroStatus, setFiltroStatus] = useEstadoDaTela(`contratos:status:${escopo}`, "todos", {
    validar: (v) => typeof v === "string" && FILTROS_DE_STATUS.some((f) => f.valor === v),
  });
  const [busca, setBusca] = useEstadoDaTela(`contratos:busca:${escopo}`, "", { validar: (v) => typeof v === "string" });

  const { data: contracts = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["contracts", user?.id, lockedClientId || "all"],
    queryFn: async () => {
      let q = supabase.from("contracts").select("*").order("created_at", { ascending: false });
      if (lockedClientId) q = q.eq("client_id", lockedClientId);
      const { data, error } = await q;
      if (error) throw error;
      return data as Contract[];
    },
    enabled: !!user,
    refetchInterval: 15000,
  });

  const clientById = (id: string) => clients.find((c: any) => c.id === id);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    if (
      !canDeleteContracts
      || confirmDelete.status !== "draft"
      || confirmDelete.admin_signed_at
      || confirmDelete.sent_at
      || confirmDelete.client_signed_at
    ) {
      toast({
        title: "Contrato protegido",
        description: "Somente rascunhos ainda não assinados podem ser excluídos.",
        variant: "destructive",
      });
      setConfirmDelete(null);
      return;
    }
    const storageRef = storageRefFromFile({
      fileUrl: confirmDelete.original_file_url,
    });
    const { error } = await supabase.from("contracts").delete().eq("id", confirmDelete.id);
    if (error) toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    else {
      let storageError: string | null = null;
      if (storageRef) {
        const { error: removeError } = await supabase.storage
          .from(storageRef.bucket)
          .remove([storageRef.path]);
        storageError = removeError?.message || null;
      }
      toast({
        title: storageError
          ? "Contrato removido; arquivo pendente de limpeza"
          : "Contrato removido",
        description: storageError || undefined,
        variant: storageError ? "destructive" : "default",
      });
      qc.invalidateQueries({ queryKey: ["contracts"] });
    }
    setConfirmDelete(null);
  };

  const abrirContrato = async (c: Contract) => {
    try {
      const url = await resolveFileUrl({ fileUrl: c.original_file_url });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error: any) {
      toast({
        title: "Não foi possível abrir o contrato",
        description: error?.message,
        variant: "destructive",
      });
    }
  };

  const enviarContrato = async (c: Contract) => {
    const client = clientById(c.client_id);
    const { data, error } = await supabase.functions.invoke("send-contract-email", {
      body: { contract_id: c.id },
    });
    if (error || (data as any)?.error) {
      toast({ title: "Erro ao enviar", description: error?.message || (data as any)?.error, variant: "destructive" });
    } else {
      toast({ title: "E-mail enviado ao cliente" });
      qc.invalidateQueries({ queryKey: ["contracts"] });
      setLinkOpen({ url: (data as any).signUrl, email: client?.email || "" });
    }
  };

  if (!isAdminOrStaff) {
    return (
      <div className="min-w-0 space-y-4">
        <CabecalhoDePagina titulo="Contratos" descricao="Área restrita à equipe" />
      </div>
    );
  }

  const termo = normalizar(busca);
  const contagem: Record<string, number> = {};
  for (const c of contracts) contagem[c.status] = (contagem[c.status] || 0) + 1;
  const filtrados = contracts.filter((c) => {
    if (filtroStatus !== "todos" && c.status !== filtroStatus) return false;
    if (!termo) return true;
    const cl = clientById(c.client_id);
    return normalizar([c.title, c.description, cl?.full_name, cl?.company_name, c.original_file_name].filter(Boolean).join(" ")).indexOf(termo) >= 0;
  });
  const aguardandoAssinatura = contracts.filter((c) => !c.admin_signed_at).length;
  const filtrando = filtroStatus !== "todos" || !!termo;

  const lista: ReactNode = isError ? (
    <EstadoDeErro
      titulo="Não foi possível carregar os contratos."
      acao={
        <button type="button" onClick={() => refetch()} className={botao.secundario}>
          Tentar de novo
        </button>
      }
    />
  ) : isLoading && contracts.length === 0 ? (
    <Carregando rotulo="Carregando contratos" linhas={4} />
  ) : contracts.length === 0 ? (
    <EstadoVazio
      icone={<FileSignature className="h-5 w-5" />}
      titulo="Nenhum contrato ainda"
      descricao="Suba o primeiro para começar."
      acao={
        canManageContracts ? (
          <button type="button" onClick={() => setUploadOpen(true)} className={botao.secundario}>
            <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" /> Novo contrato
          </button>
        ) : undefined
      }
    />
  ) : filtrados.length === 0 ? (
    <EstadoVazio
      compacto
      titulo="Nenhum contrato nesse filtro."
      acao={
        <button
          type="button"
          onClick={() => {
            setFiltroStatus("todos");
            setBusca("");
          }}
          className={botao.discreto}
        >
          Limpar filtros
        </button>
      }
    />
  ) : (
    <Painel semEspaco>
      <ul className="divide-y divide-border">
        {filtrados.map((c) => {
          const client = clientById(c.client_id);
          const meta = STATUS_META[c.status] || STATUS_META.draft;
          const podeExcluir = canDeleteContracts && c.status === "draft" && !c.admin_signed_at && !c.sent_at && !c.client_signed_at;
          return (
            <li key={c.id} className="flex min-w-0 items-center px-3 py-3 sm:px-4">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center">
                  <FileSignature className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <h3 className="min-w-0 truncate text-[13px] font-medium leading-5 text-foreground">{c.title}</h3>
                  <span className={juntar(etiqueta, "ml-2 hidden sm:inline-flex", meta.cls)}>{meta.label}</span>
                </div>
                <p className={juntar(texto.auxiliar, "mt-1 truncate sm:pl-6")}>
                  <span className="sm:hidden">{meta.label} · </span>
                  {client?.full_name || "-"}
                  {client?.company_name ? ` · ${client.company_name}` : ""}
                  {` · ${new Date(c.created_at).toLocaleDateString("pt-BR")}`}
                </p>
                <p className="mt-1 flex min-w-0 flex-wrap items-center text-[12px] sm:pl-6 [&>*]:mr-3">
                  {c.admin_signed_at ? (
                    <span className="inline-flex items-center text-success">
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Admin assinou
                    </span>
                  ) : (
                    <span className="inline-flex items-center text-muted-foreground">
                      <Clock className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Aguarda sua assinatura
                    </span>
                  )}
                  {c.client_signed_at ? (
                    <span className="inline-flex items-center text-success">
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Cliente assinou
                    </span>
                  ) : c.sent_at ? (
                    <span className="inline-flex items-center text-warning">
                      <Mail className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Enviado, aguardando cliente
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="ml-3 flex shrink-0 items-center sm:ml-4 [&>*+*]:ml-1.5 sm:[&>*+*]:ml-2">
                <button type="button" onClick={() => void abrirContrato(c)} className={botao.secundario} aria-label={`Abrir ${c.title}`}>
                  <ExternalLink className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Abrir</span>
                </button>
                {canManageContracts && !c.admin_signed_at && (
                  <button type="button" onClick={() => setSignOpen(c)} className={juntar(botao.secundario, "border-primary/50 text-primary hover:bg-primary/10")}>
                    <FileSignature className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Assinar</span>
                    <span className="sr-only sm:hidden">Assinar {c.title}</span>
                  </button>
                )}
                {canManageContracts && c.admin_signed_at && !c.client_signed_at && (
                  <button type="button" onClick={() => void enviarContrato(c)} className={botao.secundario}>
                    <Send className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                    <span className="hidden sm:inline">{c.sent_at ? "Reenviar" : "Enviar"}</span>
                    <span className="sr-only sm:hidden">{c.sent_at ? "Reenviar" : "Enviar"} {c.title}</span>
                  </button>
                )}
                {podeExcluir && (
                  <button type="button" onClick={() => setConfirmDelete(c)} className={juntar(botao.icone, "hover:text-destructive")} aria-label={`Excluir ${c.title}`}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Painel>
  );

  return (
    <div className="min-w-0 space-y-4">
      <CabecalhoDePagina
        titulo="Contratos"
        nivel={lockedClientId ? 2 : 1}
        descricao={
          contracts.length === 0
            ? undefined
            : filtrando
              ? `${filtrados.length} de ${contracts.length}`
              : `${contracts.length} ${contracts.length === 1 ? "contrato" : "contratos"}${aguardandoAssinatura ? ` · ${aguardandoAssinatura} aguardando sua assinatura` : ""}`
        }
        ajuda="Suba o PDF do contrato, assine e envie o link para o cliente assinar no portal."
        acoes={
          canManageContracts ? (
            <button type="button" onClick={() => setUploadOpen(true)} className={botao.primario} aria-label="Novo contrato">
              <Upload className="h-4 w-4" aria-hidden="true" />
              <span className="ml-1.5 hidden sm:inline">Novo contrato</span>
            </button>
          ) : undefined
        }
      />

      {contracts.length > 0 && (
        <div className="-m-1 flex flex-wrap items-center [&>*]:m-1">
          <CampoDeBusca
            valor={busca}
            onMudar={setBusca}
            placeholder="Buscar por título ou cliente"
            rotulo="Buscar contrato"
            className="flex-1 basis-full sm:basis-[240px]"
          />
          <SeletorCompacto
            rotulo="Status do contrato"
            opcoes={FILTROS_DE_STATUS.map((f) => ({ ...f, contador: f.valor === "todos" ? contracts.length : contagem[f.valor] || 0 }))}
            valor={filtroStatus}
            onEscolher={setFiltroStatus}
          />
        </div>
      )}

      {lockedClientId ? (
        lista
      ) : (
        <AreaDeTrabalho memoriaDaRolagem="contratos:lista" rotuloDoPrincipal="Lista de contratos">
          {lista}
        </AreaDeTrabalho>
      )}

      <UploadContractDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        clients={clients}
        lockedClientId={lockedClientId}
        clienteInicial={clienteDoLink}
        onCreated={() => qc.invalidateQueries({ queryKey: ["contracts"] })}
      />

      <AdminSignDialog
        contract={signOpen}
        onClose={() => setSignOpen(null)}
        onSigned={() => { qc.invalidateQueries({ queryKey: ["contracts"] }); setSignOpen(null); }}
        adminName={profile?.full_name || ""}
      />

      <Dialog open={!!linkOpen} onOpenChange={(o) => !o && setLinkOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contrato enviado</DialogTitle>
            <DialogDescription>
              Link de assinatura enviado para <strong>{linkOpen?.email}</strong>.
            </DialogDescription>
          </DialogHeader>
          <CampoDeFormulario rotulo="Link de assinatura">
            <input readOnly value={linkOpen?.url || ""} onFocus={(e) => e.currentTarget.select()} className={juntar(campo, "font-mono text-[12px]")} />
          </CampoDeFormulario>
          <DialogFooter>
            <button
              type="button"
              className={botao.secundario}
              onClick={() => {
                if (linkOpen) navigator.clipboard.writeText(linkOpen.url);
                toast({ title: "Link copiado" });
              }}
            >
              <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" /> Copiar link
            </button>
            <button type="button" className={botao.primario} onClick={() => setLinkOpen(null)}>
              Fechar
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={!!confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        title="Excluir contrato?"
        description="Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        onConfirm={handleDelete}
      />
    </div>
  );
}

function UploadContractDialog({ open, onOpenChange, clients, onCreated, lockedClientId, clienteInicial }: any) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState(lockedClientId || clienteInicial || "");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const reset = () => {
    setTitle(""); setDescription(""); setClientId(lockedClientId || ""); setFile(null);
  };

  const handleSubmit = async () => {
    if (!file || !clientId || !title) {
      toast({ title: "Preencha todos os campos", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `contracts/${clientId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("files").upload(path, file, {
        cacheControl: "3600", upsert: false,
      });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from("contracts").insert({
        client_id: clientId,
        title,
        description: description || null,
        original_file_url: `files://${path}`,
        original_file_name: file.name,
        status: "draft",
        created_by: user?.id,
      });
      if (insErr) {
        const { error: cleanupError } = await supabase.storage
          .from("files")
          .remove([path]);
        if (cleanupError) {
          throw new Error(
            `${insErr.message}. O arquivo enviado também ficou pendente de limpeza: ${cleanupError.message}`,
          );
        }
        throw insErr;
      }

      toast({ title: "Contrato criado", description: "Agora assine para liberar o envio ao cliente." });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo contrato</DialogTitle>
          <DialogDescription>Suba o PDF e escolha o cliente.</DialogDescription>
        </DialogHeader>
        <GrupoDeCampos colunas={1}>
          <CampoDeFormulario rotulo="Título" obrigatorio>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Contrato de prestação de serviços 2026" className={campo} />
          </CampoDeFormulario>
          {!lockedClientId && (
            <CampoDeFormulario rotulo="Cliente" obrigatorio>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={campo}>
                <option value="">Selecione o cliente</option>
                {clients.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name} {c.company_name ? `· ${c.company_name}` : ""}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
          )}
          <CampoDeFormulario rotulo="Descrição" apoio="Opcional.">
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Resumo do escopo..." className={juntar(campoTexto, "min-h-[64px]")} />
          </CampoDeFormulario>
          <CampoDeFormulario
            rotulo="Arquivo PDF"
            obrigatorio
            apoio={file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : undefined}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full min-w-0 text-[13px] text-muted-foreground file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-muted file:px-3 file:text-[13px] file:font-medium file:text-foreground hover:file:bg-muted/80"
            />
          </CampoDeFormulario>
        </GrupoDeCampos>
        <DialogFooter>
          <button type="button" className={botao.secundario} onClick={() => onOpenChange(false)}>Cancelar</button>
          <button type="button" className={botao.primario} onClick={handleSubmit} disabled={uploading}>
            {uploading ? "Enviando..." : "Criar contrato"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdminSignDialog({ contract, onClose, onSigned, adminName }: any) {
  const { toast } = useToast();
  const [signName, setSignName] = useState(adminName);
  const [accept, setAccept] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!contract) return null;

  const handleSign = async () => {
    if (!signName.trim() || !accept) {
      toast({ title: "Preencha o nome e aceite os termos", variant: "destructive" });
      return;
    }
    setLoading(true);
    const { error } = await supabase.from("contracts").update({
      admin_signature_name: signName.trim(),
      admin_signed_at: new Date().toISOString(),
      admin_signature_ip: "portal",
      status: "sent",
    }).eq("id", contract.id);
    setLoading(false);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else { toast({ title: "Assinatura registrada", description: "Agora você pode enviar ao cliente." }); onSigned(); }
  };

  return (
    <Dialog open={!!contract} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Assinar contrato</DialogTitle>
          <DialogDescription>Revise o documento e assine digitalmente.</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          <PrivateContractFrame contract={contract} />
          <div className="space-y-3 border-t border-border pt-4">
            <CampoDeFormulario rotulo="Seu nome completo" obrigatorio apoio="Como deve aparecer na assinatura.">
              <input value={signName} onChange={(e) => setSignName(e.target.value)} className={campo} />
            </CampoDeFormulario>
            <div className="flex items-start">
              <Checkbox id="admin-accept" checked={accept} onCheckedChange={(v) => setAccept(!!v)} className="mr-2 mt-0.5" />
              <label htmlFor="admin-accept" className={juntar(texto.corpo, "cursor-pointer")}>
                Li o contrato na íntegra e, ao assinar digitalmente, declaro que estou ciente e de acordo com todos os termos descritos.
              </label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <button type="button" className={botao.secundario} onClick={onClose}>Cancelar</button>
          <button type="button" onClick={handleSign} disabled={loading} className={botao.primario}>
            <FileSignature className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {loading ? "Assinando..." : "Assinar contrato"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PrivateContractFrame({ contract }: { contract: Contract }) {
  const { url, loading, error } = useResolvedFileUrl({
    fileUrl: contract.original_file_url,
    expiresIn: 15 * 60,
  });

  if (loading) {
    return <div className="h-[50vh] max-h-[400px] w-full animate-pulse rounded-md bg-muted" aria-busy="true" aria-label="Carregando contrato" />;
  }

  if (error || !url) {
    return <EstadoDeErro titulo="Não foi possível carregar o contrato." />;
  }

  return (
    <iframe
      src={`${url}#toolbar=1&view=FitH`}
      className="h-[50vh] max-h-[400px] w-full rounded-md border border-border bg-white"
      title={contract.title}
    />
  );
}
