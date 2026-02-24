import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle, ChevronRight, ChevronLeft, Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── Step configs ─── */
const SEGMENTO_OPTIONS = ["Varejo", "Serviços", "Tecnologia", "Saúde", "Educação", "Indústria", "Alimentação", "Outro"];
const TEMPO_EMPRESA_OPTIONS = ["Menos de 1 ano", "1-3 anos", "3-5 anos", "5-10 anos", "Mais de 10 anos"];
const SERVICO_OPTIONS = [
  "Gestão de Redes Sociais", "Tráfego Pago (Meta/Google Ads)", "Criação de Site / Landing Page",
  "Automação de Marketing", "Identidade Visual / Branding", "Produção de Conteúdo", "Consultoria Estratégica",
];
const ORCAMENTO_OPTIONS = ["Até R$1.000", "R$1.000-3.000", "R$3.000-5.000", "R$5.000-10.000", "Acima de R$10.000", "Não sei ainda"];
const PRAZO_OPTIONS = ["O mais rápido possível", "Próxima semana", "Próximo mês", "Sem pressa"];
const FAIXA_ETARIA = ["18-24", "25-34", "35-44", "45-54", "55+"];
const GENERO_OPTIONS = ["Masculino", "Feminino", "Ambos"];
const REGIAO_OPTIONS = ["Local (cidade/bairro)", "Regional (estado)", "Nacional", "Internacional"];
const CANAL_OPTIONS = ["Instagram", "Google", "Indicação", "WhatsApp", "Eventos", "Outro"];
const IDENTIDADE_OPTIONS = ["Sim, completa", "Parcial", "Não tenho"];
const TOM_OPTIONS = ["Profissional", "Descontraído", "Sofisticado", "Jovem", "Técnico", "Inspirador", "Minimalista"];

const STEP_LABELS = ["Empresa", "Projeto", "Público", "Referências", "Revisão"];

export default function BriefingPublic() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [briefing, setBriefing] = useState<any>(null);
  const [invalid, setInvalid] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [confirmed, setConfirmed] = useState(false);

  // Step 1 — Empresa
  const [empresaNome, setEmpresaNome] = useState("");
  const [segmento, setSegmento] = useState("");
  const [site, setSite] = useState("");
  const [instagram, setInstagram] = useState("");
  const [tempoEmpresa, setTempoEmpresa] = useState("");

  // Step 2 — Projeto
  const [servicos, setServicos] = useState<string[]>([]);
  const [descricaoProjeto, setDescricaoProjeto] = useState("");
  const [orcamento, setOrcamento] = useState("");
  const [prazo, setPrazo] = useState("");

  // Step 3 — Público
  const [faixaEtaria, setFaixaEtaria] = useState<string[]>([]);
  const [genero, setGenero] = useState("");
  const [regiao, setRegiao] = useState("");
  const [canais, setCanais] = useState<string[]>([]);
  const [clienteIdeal, setClienteIdeal] = useState("");

  // Step 4 — Referências
  const [identidadeVisual, setIdentidadeVisual] = useState("");
  const [linkReferencias, setLinkReferencias] = useState("");
  const [marcasAdmira, setMarcasAdmira] = useState("");
  const [tom, setTom] = useState<string[]>([]);
  const [naoQuer, setNaoQuer] = useState("");

  useEffect(() => {
    if (!token) { setInvalid(true); setLoading(false); return; }
    supabase.from("briefings").select("*").eq("token", token).maybeSingle().then(({ data }) => {
      if (!data || data.submitted) { setInvalid(true); } else { setBriefing(data); }
      setLoading(false);
    });
  }, [token]);

  const totalSteps = 5;
  const progress = Math.round((step / (totalSteps - 1)) * 100);

  const canAdvance = useCallback(() => {
    if (step === 0) return empresaNome.trim().length > 0 && segmento.length > 0;
    if (step === 1) return servicos.length > 0;
    if (step === 2) return true;
    if (step === 3) return true;
    if (step === 4) return confirmed;
    return true;
  }, [step, empresaNome, segmento, servicos, confirmed]);

  const goNext = () => {
    if (step < totalSteps - 1) { setDirection("next"); setStep(s => s + 1); }
    else handleSubmit();
  };
  const goPrev = () => { if (step > 0) { setDirection("prev"); setStep(s => s - 1); } };
  const goToStep = (s: number) => { setDirection(s > step ? "next" : "prev"); setStep(s); };

  const handleSubmit = async () => {
    if (!confirmed) return;
    setSubmitting(true);
    const responses = {
      empresa: { nome: empresaNome, segmento, site, instagram, tempoEmpresa },
      projeto: { servicos, descricao: descricaoProjeto, orcamento, prazo },
      publico: { faixaEtaria, genero, regiao, canais, clienteIdeal },
      referencias: { identidadeVisual, links: linkReferencias, marcasAdmira, tom, naoQuer },
    };
    await supabase.from("briefings").update({ responses, submitted: true }).eq("id", briefing.id);
    const { data: adminId } = await supabase.rpc("get_admin_user_id");
    if (adminId) {
      await supabase.from("notifications").insert({
        user_id: adminId, message: "Novo briefing recebido!", notification_type: "system", link: "/briefings",
      });
    }
    setSubmitted(true);
    setSubmitting(false);
  };

  const toggleArray = (arr: string[], val: string, setter: (v: string[]) => void) => {
    setter(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]);
  };

  // ─── Loading / Invalid / Success screens ───
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0D0D0D" }}>
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );
  if (invalid) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0D0D0D" }}>
      <div className="text-center space-y-2"><p className="text-lg font-semibold text-foreground">Link inválido ou já utilizado</p><p className="text-sm text-muted-foreground">Este briefing já foi enviado ou o link expirou.</p></div>
    </div>
  );
  if (submitted) return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#0D0D0D" }}>
      <div className="text-center space-y-6 max-w-md animate-scale-in">
        <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto" style={{ background: "rgba(0,255,102,0.12)" }}>
          <CheckCircle className="w-10 h-10 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-foreground">Briefing enviado com sucesso!</h2>
        <p className="text-sm text-muted-foreground">Nossa equipe vai analisar tudo e entrar em contato em até 24 horas.</p>
        <div className="text-left space-y-3 mt-6 bg-card rounded-xl p-6 border border-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-3">O que acontece agora:</p>
          {["Analisamos seu briefing em detalhes", "Montamos uma proposta personalizada", "Agendamos uma call de alinhamento"].map((t, i) => (
            <div key={i} className="flex items-start gap-3"><span className="text-primary text-sm mt-0.5">✦</span><span className="text-sm text-foreground">{t}</span></div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground/40 mt-8">Aceleriq — Performance OS</p>
      </div>
    </div>
  );

  // ─── Shared styles ───
  const inputCls = "w-full rounded-xl px-[18px] py-[14px] text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none transition-all border bg-[#1A1A1A] border-[#2A2A2A] focus:border-primary focus:shadow-[0_0_0_3px_rgba(0,255,102,0.08)]";
  const labelCls = "text-[12px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 block";
  const chipCls = (selected: boolean) => cn(
    "px-4 py-2.5 rounded-xl text-sm border cursor-pointer transition-all select-none",
    selected
      ? "bg-primary/10 border-primary text-primary"
      : "bg-[#1A1A1A] border-[#2A2A2A] text-muted-foreground hover:border-primary/40"
  );
  const radioCls = (selected: boolean) => cn(
    "flex items-center gap-2.5 px-4 py-3 rounded-xl border cursor-pointer transition-all text-sm",
    selected
      ? "bg-primary/10 border-primary text-primary"
      : "bg-[#1A1A1A] border-[#2A2A2A] text-muted-foreground hover:border-primary/40"
  );

  // ─── Step content renderer ───
  const renderStep = () => {
    switch (step) {
      case 0: return (
        <div className="space-y-5">
          <div><h2 className="text-xl font-bold text-foreground mb-1">Conte-nos sobre sua empresa</h2><p className="text-sm text-muted-foreground">Essas informações nos ajudam a entender seu universo.</p></div>
          <div><label className={labelCls}>Nome da empresa *</label><input value={empresaNome} onChange={e => setEmpresaNome(e.target.value)} placeholder="Nome da empresa" className={inputCls} /></div>
          <div><label className={labelCls}>Segmento / Nicho *</label><div className="flex flex-wrap gap-2">{SEGMENTO_OPTIONS.map(o => <button key={o} type="button" onClick={() => setSegmento(o)} className={chipCls(segmento === o)}>{o}</button>)}</div></div>
          <div><label className={labelCls}>Site <span className="text-muted-foreground/40">(opcional)</span></label><input value={site} onChange={e => setSite(e.target.value)} placeholder="https://seusite.com.br" className={inputCls} /></div>
          <div><label className={labelCls}>Instagram <span className="text-muted-foreground/40">(opcional)</span></label><input value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="@seuinstagram" className={inputCls} /></div>
          <div><label className={labelCls}>Há quanto tempo a empresa existe?</label><div className="space-y-2">{TEMPO_EMPRESA_OPTIONS.map(o => <button key={o} type="button" onClick={() => setTempoEmpresa(o)} className={radioCls(tempoEmpresa === o)}><div className={cn("w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0", tempoEmpresa === o ? "border-primary" : "border-[#2A2A2A]")}>{tempoEmpresa === o && <div className="w-2 h-2 rounded-full bg-primary" />}</div>{o}</button>)}</div></div>
        </div>
      );
      case 1: return (
        <div className="space-y-5">
          <div><h2 className="text-xl font-bold text-foreground mb-1">O que vamos construir juntos?</h2><p className="text-sm text-muted-foreground">Descreva o projeto ideal. Sem filtro — queremos entender sua visão.</p></div>
          <div><label className={labelCls}>Qual serviço você precisa? *</label><div className="flex flex-wrap gap-2">{SERVICO_OPTIONS.map(o => <button key={o} type="button" onClick={() => toggleArray(servicos, o, setServicos)} className={chipCls(servicos.includes(o))}>{o}</button>)}</div></div>
          <div><label className={labelCls}>Descreva brevemente o que espera do projeto</label><textarea value={descricaoProjeto} onChange={e => setDescricaoProjeto(e.target.value)} placeholder="Ex: Quero aumentar minhas vendas pelo Instagram e criar campanhas no Google..." rows={4} className={cn(inputCls, "resize-none min-h-[100px]")} /></div>
          <div><label className={labelCls}>Orçamento mensal estimado</label><div className="flex flex-wrap gap-2">{ORCAMENTO_OPTIONS.map(o => <button key={o} type="button" onClick={() => setOrcamento(o)} className={chipCls(orcamento === o)}>{o}</button>)}</div></div>
          <div><label className={labelCls}>Prazo desejado para começar</label><div className="space-y-2">{PRAZO_OPTIONS.map(o => <button key={o} type="button" onClick={() => setPrazo(o)} className={radioCls(prazo === o)}><div className={cn("w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0", prazo === o ? "border-primary" : "border-[#2A2A2A]")}>{prazo === o && <div className="w-2 h-2 rounded-full bg-primary" />}</div>{o}</button>)}</div></div>
        </div>
      );
      case 2: return (
        <div className="space-y-5">
          <div><h2 className="text-xl font-bold text-foreground mb-1">Quem é seu cliente ideal?</h2><p className="text-sm text-muted-foreground">Conhecer seu público nos permite criar estratégias certeiras.</p></div>
          <div><label className={labelCls}>Faixa etária principal</label><div className="flex flex-wrap gap-2">{FAIXA_ETARIA.map(o => <button key={o} type="button" onClick={() => toggleArray(faixaEtaria, o, setFaixaEtaria)} className={chipCls(faixaEtaria.includes(o))}>{o}</button>)}</div></div>
          <div><label className={labelCls}>Gênero predominante</label><div className="flex flex-wrap gap-2">{GENERO_OPTIONS.map(o => <button key={o} type="button" onClick={() => setGenero(o)} className={chipCls(genero === o)}>{o}</button>)}</div></div>
          <div><label className={labelCls}>Região de atuação</label><div className="space-y-2">{REGIAO_OPTIONS.map(o => <button key={o} type="button" onClick={() => setRegiao(o)} className={radioCls(regiao === o)}><div className={cn("w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0", regiao === o ? "border-primary" : "border-[#2A2A2A]")}>{regiao === o && <div className="w-2 h-2 rounded-full bg-primary" />}</div>{o}</button>)}</div></div>
          <div><label className={labelCls}>Como seus clientes encontram você?</label><div className="flex flex-wrap gap-2">{CANAL_OPTIONS.map(o => <button key={o} type="button" onClick={() => toggleArray(canais, o, setCanais)} className={chipCls(canais.includes(o))}>{o}</button>)}</div></div>
          <div><label className={labelCls}>Descreva seu cliente ideal em uma frase</label><input value={clienteIdeal} onChange={e => setClienteIdeal(e.target.value)} placeholder="Ex: Mulheres de 30-45 anos que buscam praticidade..." className={inputCls} /></div>
        </div>
      );
      case 3: return (
        <div className="space-y-5">
          <div><h2 className="text-xl font-bold text-foreground mb-1">Suas referências e identidade</h2><p className="text-sm text-muted-foreground">Nos mostre o que inspira você. Isso molda a direção criativa.</p></div>
          <div><label className={labelCls}>Tem identidade visual definida?</label><div className="space-y-2">{IDENTIDADE_OPTIONS.map(o => <button key={o} type="button" onClick={() => setIdentidadeVisual(o)} className={radioCls(identidadeVisual === o)}><div className={cn("w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0", identidadeVisual === o ? "border-primary" : "border-[#2A2A2A]")}>{identidadeVisual === o && <div className="w-2 h-2 rounded-full bg-primary" />}</div>{o}</button>)}</div></div>
          <div><label className={labelCls}>Links de referências que você gosta</label><textarea value={linkReferencias} onChange={e => setLinkReferencias(e.target.value)} placeholder="Ex: instagram.com/marca-legal, site-que-gostei.com.br" rows={3} className={cn(inputCls, "resize-none")} /></div>
          <div><label className={labelCls}>Marcas ou concorrentes que admira</label><input value={marcasAdmira} onChange={e => setMarcasAdmira(e.target.value)} placeholder="Ex: Nike, Nubank, Magazine Luiza..." className={inputCls} /></div>
          <div><label className={labelCls}>Tom de comunicação desejado</label><div className="flex flex-wrap gap-2">{TOM_OPTIONS.map(o => <button key={o} type="button" onClick={() => toggleArray(tom, o, setTom)} className={chipCls(tom.includes(o))}>{o}</button>)}</div></div>
          <div><label className={labelCls}>Algo que NÃO quer na comunicação? <span className="text-muted-foreground/40">(opcional)</span></label><textarea value={naoQuer} onChange={e => setNaoQuer(e.target.value)} placeholder="Ex: Não quero parecer muito informal..." rows={3} className={cn(inputCls, "resize-none")} /></div>
        </div>
      );
      case 4: return (
        <div className="space-y-5">
          <div><h2 className="text-xl font-bold text-foreground mb-1">Tudo pronto! Revise seu briefing</h2><p className="text-sm text-muted-foreground">Confira as informações antes de enviar. Você pode editar qualquer etapa.</p></div>
          <ReviewCard title="📋 Empresa" onEdit={() => goToStep(0)} items={[`Nome: ${empresaNome}`, `Segmento: ${segmento}`, tempoEmpresa && `Tempo: ${tempoEmpresa}`].filter(Boolean) as string[]} />
          <ReviewCard title="📋 Projeto" onEdit={() => goToStep(1)} items={[`Serviços: ${servicos.join(", ")}`, orcamento && `Orçamento: ${orcamento}`, prazo && `Prazo: ${prazo}`].filter(Boolean) as string[]} />
          <ReviewCard title="📋 Público-Alvo" onEdit={() => goToStep(2)} items={[faixaEtaria.length > 0 && `Faixa etária: ${faixaEtaria.join(", ")}`, regiao && `Região: ${regiao}`, clienteIdeal && `Cliente ideal: ${clienteIdeal}`].filter(Boolean) as string[]} />
          <ReviewCard title="📋 Referências" onEdit={() => goToStep(3)} items={[tom.length > 0 && `Tom: ${tom.join(", ")}`, identidadeVisual && `Identidade: ${identidadeVisual}`].filter(Boolean) as string[]} />
          <label className="flex items-center gap-3 mt-4 cursor-pointer select-none">
            <button type="button" onClick={() => setConfirmed(!confirmed)} className={cn("w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all bg-transparent cursor-pointer", confirmed ? "border-primary bg-primary" : "border-[#2A2A2A]")}>
              {confirmed && <Check className="w-3 h-3 text-primary-foreground" />}
            </button>
            <span className="text-sm text-foreground">Confirmo que as informações estão corretas</span>
          </label>
        </div>
      );
      default: return null;
    }
  };

  const isLastStep = step === totalSteps - 1;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0D0D0D" }}>
      <div className="grid-perspective opacity-30" />

      {/* Header */}
      <header className="sticky top-0 z-50 px-6 py-5" style={{ background: "rgba(13,13,13,0.9)", backdropFilter: "blur(12px)" }}>
        <div className="max-w-[720px] mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #00FF66, #00CC52)' }}>
                <span className="text-xs font-bold text-primary-foreground">A</span>
              </div>
              <span className="font-semibold text-sm text-foreground">Aceler<span className="text-primary">iq</span></span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <Clock className="w-3.5 h-3.5" />
              <span>~5 minutos</span>
            </div>
          </div>
          <div className="mb-2"><h1 className="text-sm font-semibold text-foreground">Briefing do Projeto</h1><p className="text-xs text-muted-foreground">Quanto mais detalhes, melhor entregamos resultado.</p></div>

          {/* Progress steps */}
          <div className="flex items-center gap-1 mt-4">
            {STEP_LABELS.map((label, i) => (
              <div key={i} className="flex items-center flex-1">
                <button type="button" onClick={() => i <= step && goToStep(i)} className={cn("w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 transition-all border-none cursor-pointer", i < step ? "bg-primary text-primary-foreground" : i === step ? "border-2 border-primary text-primary bg-transparent milestone-pulse" : "bg-[#2A2A2A] text-muted-foreground")}>
                  {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </button>
                <span className={cn("text-[11px] ml-1.5 hidden sm:inline whitespace-nowrap", i <= step ? "text-foreground" : "text-muted-foreground")}>{label}</span>
                {i < totalSteps - 1 && <div className={cn("flex-1 h-[2px] mx-2 rounded-full transition-all", i < step ? "bg-primary" : "bg-[#2A2A2A]")} />}
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* Step content */}
      <div className="flex-1 flex justify-center px-6 py-8">
        <div key={step} className="w-full max-w-[720px] rounded-2xl p-8 sm:p-12 border border-border" style={{ background: "#121212", animation: direction === "next" ? "briefSlideLeft 0.35s ease-out" : "briefSlideRight 0.35s ease-out" }}>
          {renderStep()}
        </div>
      </div>

      {/* Bottom nav */}
      <div className="sticky bottom-0 z-40 px-6 py-5" style={{ background: "rgba(13,13,13,0.9)", backdropFilter: "blur(12px)" }}>
        <div className="max-w-[720px] mx-auto flex items-center justify-between">
          {step > 0 ? (
            <button onClick={goPrev} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none">
              <ChevronLeft className="w-4 h-4" /> Voltar
            </button>
          ) : <div />}
          <button
            onClick={goNext}
            disabled={!canAdvance() || submitting}
            className="px-8 py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer border-none disabled:opacity-40 bg-primary text-primary-foreground hover:opacity-90 btn-interactive login-btn"
          >
            {submitting ? "Enviando..." : isLastStep ? "Enviar Briefing 🚀" : "Próximo →"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes briefSlideLeft { from { opacity:0; transform:translateX(30px); } to { opacity:1; transform:translateX(0); } }
        @keyframes briefSlideRight { from { opacity:0; transform:translateX(-30px); } to { opacity:1; transform:translateX(0); } }
        .animate-scale-in { animation: scaleIn 0.5s cubic-bezier(0.34,1.56,0.64,1); }
        @keyframes scaleIn { from { opacity:0; transform:scale(0.85); } to { opacity:1; transform:scale(1); } }
      `}</style>
    </div>
  );
}

/* ─── Review card component ─── */
function ReviewCard({ title, items, onEdit }: { title: string; items: string[]; onEdit: () => void }) {
  return (
    <div className="rounded-xl border border-border p-5 card-hover" style={{ background: "#1A1A1A" }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <button onClick={onEdit} className="text-xs text-primary hover:underline cursor-pointer bg-transparent border-none">Editar</button>
      </div>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <p key={i} className="text-xs text-muted-foreground">{item}</p>
        ))}
        {items.length === 0 && <p className="text-xs text-muted-foreground/40 italic">Não preenchido</p>}
      </div>
    </div>
  );
}
