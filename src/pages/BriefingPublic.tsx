import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle } from "lucide-react";

export default function BriefingPublic() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [briefing, setBriefing] = useState<any>(null);
  const [invalid, setInvalid] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [objetivo, setObjetivo] = useState("");
  const [publicoAlvo, setPublicoAlvo] = useState("");
  const [referencias, setReferencias] = useState("");
  const [prazo, setPrazo] = useState("");
  const [orcamento, setOrcamento] = useState("");
  const [observacoes, setObservacoes] = useState("");

  useEffect(() => {
    if (!token) { setInvalid(true); setLoading(false); return; }
    supabase.from("briefings").select("*").eq("token", token).maybeSingle().then(({ data }) => {
      if (!data || data.submitted) { setInvalid(true); } else { setBriefing(data); }
      setLoading(false);
    });
  }, [token]);

  const handleSubmit = async () => {
    if (!objetivo.trim()) return;
    setSubmitting(true);
    const responses = { objetivo, publicoAlvo, referencias, prazo, orcamento, observacoes };
    await supabase.from("briefings").update({ responses, submitted: true }).eq("id", briefing.id);

    // Notify admin
    if (briefing.client_id) {
      const { data: adminRole } = await supabase.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
      if (adminRole) {
        await supabase.from("notifications").insert({
          user_id: adminRole.user_id,
          message: "Briefing recebido de cliente",
          notification_type: "system", link: "/clientes",
        });
      }
    }
    setSubmitted(true);
    setSubmitting(false);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  if (invalid) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-2">
        <p className="text-lg font-semibold text-foreground">Link inválido ou já utilizado</p>
        <p className="text-sm text-muted-foreground">Este briefing já foi enviado ou o link expirou.</p>
      </div>
    </div>
  );

  if (submitted) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-3">
        <CheckCircle className="w-12 h-12 text-success mx-auto" />
        <p className="text-lg font-semibold text-foreground">Briefing enviado com sucesso!</p>
        <p className="text-sm text-muted-foreground">Entraremos em contato em breve.</p>
      </div>
    </div>
  );

  const inputCls = "w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-[560px] bg-card border border-border rounded-2xl p-6 md:p-8 space-y-6">
        <div className="text-center space-y-1">
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center mx-auto mb-3">
            <span className="text-base font-bold text-primary-foreground">C</span>
          </div>
          <h1 className="text-lg font-semibold text-foreground">Briefing do Projeto</h1>
          <p className="text-sm text-muted-foreground">Preencha as informações abaixo para iniciarmos.</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Qual o objetivo principal do projeto? *</label>
            <textarea value={objetivo} onChange={e => setObjetivo(e.target.value)} rows={3} placeholder="Descreva o objetivo..." className={inputCls + " resize-none"} />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Quem é o público-alvo?</label>
            <textarea value={publicoAlvo} onChange={e => setPublicoAlvo(e.target.value)} rows={2} placeholder="Ex: Mulheres 25-45 anos..." className={inputCls + " resize-none"} />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Referências visuais</label>
            <textarea value={referencias} onChange={e => setReferencias(e.target.value)} rows={2} placeholder="Descreva ou cole links..." className={inputCls + " resize-none"} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Prazo desejado</label>
              <input type="date" value={prazo} onChange={e => setPrazo(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Orçamento disponível</label>
              <input value={orcamento} onChange={e => setOrcamento(e.target.value)} placeholder="R$ ..." className={inputCls} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Observações adicionais</label>
            <textarea value={observacoes} onChange={e => setObservacoes(e.target.value)} rows={3} placeholder="Algo mais que devemos saber?" className={inputCls + " resize-none"} />
          </div>
        </div>

        <button onClick={handleSubmit} disabled={submitting || !objetivo.trim()}
          className="w-full px-5 py-3 rounded-[10px] text-[14px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50">
          {submitting ? "Enviando..." : "Enviar Briefing"}
        </button>
      </div>
    </div>
  );
}
