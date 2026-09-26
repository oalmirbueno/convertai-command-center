import { useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { notifyAdmin } from "@/lib/notifyHelpers";
import { fireWebhook, webhooks } from "@/lib/webhooks";
import { CampoDeFormulario, SeletorCompacto, botao, campo, campoTexto, juntar, texto, useEstadoDaTela } from "@/components/sistema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const priorities = [
  { value: "normal", label: "Normal" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
] as const;

export default function RequestButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { user, profile } = useAuth();
  const { isImpersonating } = useClientIdentity();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  // Rascunho do pedido por projeto: fechar a janela ou sair não apaga o que já foi escrito.
  const [title, setTitle] = useEstadoDaTela<string>(`pedido-projeto:titulo:${projectId}`, "");
  const [description, setDescription] = useEstadoDaTela<string>(`pedido-projeto:descricao:${projectId}`, "");
  const [priority, setPriority] = useState<string>("normal");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (isImpersonating) return;
    if (!title.trim() || !description.trim() || !user) return;
    setSubmitting(true);
    try {
      await supabase.from("client_requests").insert({
        client_id: user.id,
        project_id: projectId,
        title: title.trim(),
        description: description.trim(),
        priority,
      });

      // Notify admin
      await notifyAdmin(`Novo pedido de ${profile?.company_name || profile?.full_name}: ${title}`, "request", "/pedidos");

      queryClient.invalidateQueries({ queryKey: ["client-requests"] });
      queryClient.invalidateQueries({ queryKey: ["project-updates"] });

      // Fire webhook
      fireWebhook(webhooks.clientRequest, {
        request_id: crypto.randomUUID(),
        client_id: user.id,
        client_name: profile?.full_name || '',
        company: profile?.company_name || '',
        title: title.trim(),
        description: description.trim(),
        priority,
      });

      toast({ title: "Pedido enviado com sucesso", description: "Vamos analisar sua solicitação em breve." });
      setOpen(false);
      setTitle("");
      setDescription("");
      setPriority("normal");
    } catch (e) {
      toast({ title: "Erro", description: "Falha ao enviar pedido.", variant: "destructive" });
    }
    setSubmitting(false);
  };

  if (isImpersonating) return null;

  return (
    <>
      {/* Na linha do título do projeto (antes era um botão flutuante que cobria
          a lista e a barra de baixo no celular). No celular vira só o ícone. */}
      <button type="button" onClick={() => setOpen(true)} className={botao.primario} aria-label="Fazer pedido">
        <Plus className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
        <span className="hidden sm:inline">Fazer pedido</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className={texto.tituloSecao}>Novo pedido</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <CampoDeFormulario rotulo="Título" obrigatorio>
              <input
                className={campo}
                placeholder="Ex.: Criar novo banner para Instagram"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </CampoDeFormulario>

            <CampoDeFormulario rotulo="Descrição" obrigatorio apoio={`Projeto: ${projectName}`}>
              <textarea
                className={juntar(campoTexto, "resize-none")}
                placeholder="Descreva o que você precisa"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
            </CampoDeFormulario>

            <CampoDeFormulario rotulo="Prioridade">
              <SeletorCompacto
                rotulo="Prioridade"
                modo="segmentado"
                larguraTotal
                valor={priority}
                onEscolher={setPriority}
                opcoes={priorities.map((p) => ({ valor: p.value, rotulo: p.label }))}
              />
            </CampoDeFormulario>
          </div>

          <div className="flex items-center justify-end border-t border-border pt-3 [&>*+*]:ml-2">
            <button type="button" onClick={() => setOpen(false)} className={botao.secundario}>Cancelar</button>
            <button
              type="button"
              className={botao.primario}
              onClick={handleSubmit}
              disabled={submitting || !title.trim() || !description.trim()}
            >
              {submitting ? "Enviando..." : "Enviar pedido"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
