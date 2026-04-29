import { useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { notifyAdmin } from "@/lib/notifyHelpers";
import { fireWebhook, webhooks } from "@/lib/webhooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>("normal");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
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

      // Create update in feed
      const { data: upd } = await supabase.from("updates").insert({
        project_id: projectId,
        author_id: user.id,
        message: `Novo pedido: ${title}`,
        update_type: "system",
      }).select().single();
      notifyOpsUpdate(upd);

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

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full px-5 py-3 flex items-center gap-2 shadow-lg hover:scale-105 transition-all duration-200 text-sm font-medium"
      >
        <Plus className="w-4 h-4" />
        Fazer Pedido
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Novo Pedido</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="label-sm mb-1.5 block">Título</label>
              <Input
                placeholder="Ex: Criar novo banner para Instagram"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div>
              <label className="label-sm mb-1.5 block">Descrição</label>
              <Textarea
                placeholder="Descreva o que você precisa..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
            </div>

            <div>
              <label className="label-sm mb-2 block">Prioridade</label>
              <div className="flex gap-2">
                {priorities.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setPriority(p.value)}
                    className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      priority === p.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={submitting || !title.trim() || !description.trim()}
            >
              {submitting ? "Enviando..." : "Enviar Pedido"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
