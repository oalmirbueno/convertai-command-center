import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FileSignature, Upload, Send, CheckCircle2, Clock, FileText, ExternalLink, Copy, Mail, Trash2 } from "lucide-react";
import ConfirmModal from "@/components/ui/ConfirmModal";

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

export default function AdminContracts({ clientId: lockedClientId }: { clientId?: string } = {}) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: clients = [] } = useClients();
  const isAdminOrStaff = profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [signOpen, setSignOpen] = useState<Contract | null>(null);
  const [linkOpen, setLinkOpen] = useState<{ url: string; email: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Contract | null>(null);

  const { data: contracts = [], isLoading } = useQuery({
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
    const { error } = await supabase.from("contracts").delete().eq("id", confirmDelete.id);
    if (error) toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    else { toast({ title: "Contrato removido" }); qc.invalidateQueries({ queryKey: ["contracts"] }); }
    setConfirmDelete(null);
  };

  if (!isAdminOrStaff) {
    return (
      <div className="max-w-3xl mx-auto pt-12">
        <h1 className="text-2xl font-semibold mb-2">Contratos</h1>
        <p className="text-muted-foreground">Esta área é restrita à equipe.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto pb-20">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold flex items-center gap-3">
            <FileSignature className="w-7 h-7 text-primary" />
            Contratos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Suba um contrato, assine e envie para o cliente assinar no portal.
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Upload className="w-4 h-4 mr-2" /> Novo contrato
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando...</div>
      ) : contracts.length === 0 ? (
        <div className="border border-dashed border-border rounded-2xl p-12 text-center">
          <FileSignature className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nenhum contrato ainda. Suba o primeiro para começar.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {contracts.map((c, i) => {
            const client = clientById(c.client_id);
            const meta = STATUS_META[c.status] || STATUS_META.draft;
            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03, type: "spring", stiffness: 200, damping: 24 }}
                className="bg-card border border-border rounded-xl p-4 hover:border-primary/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${meta.cls}`}>
                        {meta.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(c.created_at).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                    <h3 className="font-medium text-foreground truncate">{c.title}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Para: <span className="text-foreground">{client?.full_name || "—"}</span>
                      {client?.company_name && <span className="text-muted-foreground"> · {client.company_name}</span>}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 mt-3 text-xs">
                      {c.admin_signed_at ? (
                        <span className="flex items-center gap-1.5 text-success">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Admin assinou
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Clock className="w-3.5 h-3.5" /> Aguarda sua assinatura
                        </span>
                      )}
                      {c.client_signed_at ? (
                        <span className="flex items-center gap-1.5 text-success">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Cliente assinou
                        </span>
                      ) : c.sent_at ? (
                        <span className="flex items-center gap-1.5 text-warning">
                          <Mail className="w-3.5 h-3.5" /> Enviado, aguardando cliente
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    <Button asChild variant="outline" size="sm">
                      <a href={c.original_file_url} target="_blank" rel="noreferrer">
                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Abrir
                      </a>
                    </Button>
                    {!c.admin_signed_at && (
                      <Button size="sm" onClick={() => setSignOpen(c)} className="bg-primary text-primary-foreground hover:bg-primary/90">
                        Assinar
                      </Button>
                    )}
                    {c.admin_signed_at && !c.client_signed_at && (
                      <Button size="sm" variant="outline" onClick={async () => {
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
                      }}>
                        <Send className="w-3.5 h-3.5 mr-1.5" /> {c.sent_at ? "Reenviar" : "Enviar"}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(c)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <UploadContractDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        clients={clients}
        lockedClientId={lockedClientId}
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
              Enviamos o link de assinatura para <strong>{linkOpen?.email}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-secondary rounded-lg p-3 text-xs break-all font-mono">{linkOpen?.url}</div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              if (linkOpen) navigator.clipboard.writeText(linkOpen.url);
              toast({ title: "Link copiado" });
            }}>
              <Copy className="w-3.5 h-3.5 mr-1.5" /> Copiar link
            </Button>
            <Button onClick={() => setLinkOpen(null)}>Fechar</Button>
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

function UploadContractDialog({ open, onOpenChange, clients, onCreated, lockedClientId }: any) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState(lockedClientId || "");
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
      const { data: pub } = supabase.storage.from("files").getPublicUrl(path);

      const { error: insErr } = await supabase.from("contracts").insert({
        client_id: clientId,
        title,
        description: description || null,
        original_file_url: pub.publicUrl,
        original_file_name: file.name,
        status: "draft",
        created_by: user?.id,
      });
      if (insErr) throw insErr;

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
          <DialogDescription>Suba o PDF do contrato e selecione o cliente.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Contrato de prestação de serviços 2026" />
          </div>
          {!lockedClientId && (
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name} {c.company_name ? `· ${c.company_name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Descrição (opcional)</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Resumo do escopo..." />
          </div>
          <div className="space-y-1.5">
            <Label>Arquivo PDF</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-secondary file:text-foreground hover:file:bg-secondary/80"
            />
            {file && <p className="text-xs text-muted-foreground mt-1">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={uploading}>
            {uploading ? "Enviando..." : "Criar contrato"}
          </Button>
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
          <DialogDescription>Revise o documento abaixo e assine digitalmente.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <iframe
            src={`${contract.original_file_url}#toolbar=1&view=FitH`}
            className="w-full h-[400px] rounded-lg border border-border bg-white"
            title={contract.title}
          />
          <div className="space-y-3 border-t border-border pt-4">
            <div className="space-y-1.5">
              <Label>Seu nome completo</Label>
              <Input value={signName} onChange={(e) => setSignName(e.target.value)} placeholder="Como deve aparecer na assinatura" />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox id="admin-accept" checked={accept} onCheckedChange={(v) => setAccept(!!v)} className="mt-0.5" />
              <Label htmlFor="admin-accept" className="text-sm font-normal leading-relaxed cursor-pointer">
                Li o contrato na íntegra e, ao assinar digitalmente, declaro que estou ciente e de acordo com todos os termos descritos.
              </Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSign} disabled={loading} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <FileSignature className="w-4 h-4 mr-2" />
            {loading ? "Assinando..." : "Assinar contrato"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
