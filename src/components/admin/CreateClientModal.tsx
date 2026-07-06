import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { fireWebhook, webhooks } from "@/lib/webhooks";

function generatePassword(len = 16) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#";
  return Array.from(crypto.getRandomValues(new Uint8Array(len)))
    .map((b) => chars[b % chars.length])
    .join("");
}

function generateToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const PORTAL_URL = "https://aceleriq.online";

const SERVICES = [
  { key: "trafego", label: "Tráfego Pago" },
  { key: "social", label: "Social Media" },
  { key: "videos_ia", label: "Vídeos com IA" },
  { key: "edicao_video", label: "Edição de Vídeo" },
  { key: "design", label: "Design / Branding" },
  { key: "copywriting", label: "Copywriting" },
  { key: "seo", label: "SEO" },
  { key: "email_marketing", label: "E-mail Marketing" },
  { key: "automacao", label: "Automação" },
  { key: "site", label: "Site / Landing Page" },
  { key: "relatorios", label: "Relatórios" },
  { key: "cobranca", label: "Cobrança" },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CreateClientModal({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [clientType, setClientType] = useState<"recurring" | "one_off" | "hybrid">("recurring");
  const [brand, setBrand] = useState<"aceleriq" | "sitebolt" | "">("");
  const [services, setServices] = useState<Record<string, boolean>>({});
  const [createdSuccess, setCreatedSuccess] = useState(false);

  // Plano recorrente (mensalidade)
  const [planValue, setPlanValue] = useState("");
  const [planRenewalDate, setPlanRenewalDate] = useState("");

  // Projeto avulso (one_off)
  const [projectValue, setProjectValue] = useState("");
  const [payMode, setPayMode] = useState<"integral" | "installments">("integral");
  const [installmentsCount, setInstallmentsCount] = useState("2");
  const [firstDueDate, setFirstDueDate] = useState("");

  if (!open) return null;

  const showRecurring = clientType === "recurring" || clientType === "hybrid";
  const showOneOff = clientType === "one_off" || clientType === "hybrid";

  const toggleService = (key: string) => {
    setServices((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const reset = () => {
    setFullName(""); setCompany(""); setEmail(""); setPhone("");
    setClientType("recurring"); setBrand("");
    setServices({});
    setPlanValue(""); setPlanRenewalDate("");
    setProjectValue(""); setPayMode("integral"); setInstallmentsCount("2"); setFirstDueDate("");
    setCreatedSuccess(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSave = async () => {
    if (!fullName.trim() || !company.trim() || !email.trim()) {
      toast.error("Preencha nome, empresa e email");
      return;
    }
    setSaving(true);
    try {
      // Random unknown password — the client will set their own via first-access link.
      const password = generatePassword();
      const firstAccessToken = generateToken();

      // Use edge function to create user server-side (avoids session swap)
      const { data: result, error: fnError } = await supabase.functions.invoke("manage-team", {
        body: {
          action: "create",
          email: email.trim(),
          full_name: fullName.trim(),
          role: "client",
          password,
        },
      });

      if (fnError) {
        toast.error(fnError.message || "Erro ao criar cliente");
        setSaving(false);
        return;
      }

      if (result?.error) {
        const msg = result.error;
        if (msg.includes("already") || msg.includes("exists")) {
          toast.error("Este email já está cadastrado");
        } else {
          toast.error(msg);
        }
        setSaving(false);
        return;
      }

      const newUserId = result?.user_id;

      // Update profile with extra fields + first-access token
      if (newUserId) {
        const planValueNum = parseFloat(planValue) || 0;
        const profileUpdate: any = {
          phone: phone.trim() || null,
          company_name: company.trim(),
          services_config: services,
          client_type: clientType,
          brand: brand || null,
          first_access_token: firstAccessToken,
          first_access_used_at: null,
          portal_password: null,
        };
        if (showRecurring && planValueNum > 0) {
          profileUpdate.plan_value = planValueNum;
          profileUpdate.plan_name = "Mensalidade";
          profileUpdate.plan_status = "active";
          if (planRenewalDate) profileUpdate.plan_renewal_date = planRenewalDate;
        }
        await supabase.from("profiles").update(profileUpdate).eq("id", newUserId);

        // Ao cadastrar um cliente recorrente, o pagamento do ciclo atual JÁ está pago
        // (motivo do cadastro). Registramos a entrada paga de hoje e a próxima
        // renovação como pendente na data informada.
        if (showRecurring && planValueNum > 0) {
          const todayStr = new Date().toISOString().slice(0, 10);
          const rowsRec: any[] = [{
            client_id: newUserId,
            type: "renewal",
            amount: planValueNum,
            due_date: todayStr,
            paid_date: todayStr,
            paid_amount: planValueNum,
            description: `Mensalidade — ${company.trim() || fullName.trim()} (pago no cadastro)`,
            status: "paid",
          }];
          if (planRenewalDate && planRenewalDate > todayStr) {
            rowsRec.push({
              client_id: newUserId,
              type: "renewal",
              amount: planValueNum,
              due_date: planRenewalDate,
              description: `Mensalidade — ${company.trim() || fullName.trim()}`,
              status: "pending",
            });
          }
          await supabase.from("billing").insert(rowsRec as any);
        }

        // Cria as cobranças do projeto avulso (integral ou parcelado)
        const projValueNum = parseFloat(projectValue) || 0;
        if (showOneOff && projValueNum > 0 && firstDueDate) {
          const n = payMode === "integral" ? 1 : Math.max(parseInt(installmentsCount) || 1, 1);
          const per = +(projValueNum / n).toFixed(2);
          const first = new Date(firstDueDate + "T00:00:00");
          const rows = Array.from({ length: n }, (_, idx) => {
            const due = new Date(first);
            due.setMonth(due.getMonth() + idx);
            const dueStr = due.toISOString().slice(0, 10);
            // Última parcela acerta arredondamento
            const amount = idx === n - 1 ? +(projValueNum - per * (n - 1)).toFixed(2) : per;
            return {
              client_id: newUserId,
              type: "one_off",
              amount,
              due_date: dueStr,
              description: n === 1
                ? `Projeto — ${company.trim() || fullName.trim()}`
                : `Projeto — Parcela ${idx + 1}/${n}`,
              status: "pending",
            };
          });
          await supabase.from("billing").insert(rows as any);
        }
      }

      setCreatedSuccess(true);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["billing"] });

      // Send welcome email with first-access link (fire and forget)
      const firstAccessUrl = `${PORTAL_URL}/primeiro-acesso?token=${firstAccessToken}`;
      supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "client-welcome",
          recipientEmail: email.trim(),
          idempotencyKey: `client-welcome-${newUserId ?? email.trim()}`,
          templateData: {
            name: fullName.trim(),
            company: company.trim(),
            email: email.trim(),
            firstAccessUrl,
          },
        },
      }).catch((e) => console.warn("welcome email failed", e));

      // Fire webhook (fire and forget)
      if (newUserId) {
        fireWebhook(webhooks.onboardClient, {
          client_id: newUserId,
          name: fullName.trim(),
          email: email.trim(),
          company: company.trim(),
          phone: phone.trim() || '',
          services: services,
          send_welcome_email: true,
        });
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar cliente");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-[520px] mx-4 animate-in fade-in zoom-in-[0.96] duration-200" style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">
            {createdSuccess ? "Cliente Criado" : "Novo Cliente"}
          </h2>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {createdSuccess ? (
          <>
            <div className="px-6 py-6 space-y-5">
              <div className="text-center space-y-1">
                <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3">
                  <span className="text-success text-xl">✓</span>
                </div>
                <p className="text-sm font-semibold text-foreground">{fullName}</p>
                <p className="text-xs text-muted-foreground">{email}</p>
              </div>

              <div className="bg-secondary border border-border rounded-xl p-4 space-y-2">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Convite de Primeiro Acesso</p>
                <p className="text-[13px] text-foreground leading-relaxed">
                  Enviamos um e-mail de boas-vindas com um botão de <strong>primeiro acesso</strong>.
                  O cliente clica, cria a própria senha e já entra no portal.
                </p>
              </div>

              <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
                Assim que o cliente criar a senha, ela fica disponível no cadastro dele
                (aba do cliente → <strong>Senha de Acesso</strong>), onde você pode visualizar ou alterar.
              </p>

            </div>

            <div className="px-6 py-4 border-t border-border flex justify-end">
              <button onClick={handleClose}
                className="px-5 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer">
                Fechar
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Nome Completo *</label>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nome do cliente"
                  className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Empresa *</label>
                <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Nome da empresa"
                  className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Email *</label>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="email@empresa.com"
                    className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Telefone</label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000"
                    className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
                </div>
              </div>

              {/* Tipo de relacionamento + Brand */}
              <div className="pt-2 space-y-3">
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 block">Tipo de Cliente *</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { v: "recurring", label: "Recorrente", hint: "Mensalidade" },
                      { v: "one_off", label: "Avulso", hint: "Projeto único" },
                      { v: "hybrid", label: "Híbrido", hint: "Os dois" },
                    ].map((opt) => (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => setClientType(opt.v as any)}
                        className={`px-3 py-2.5 rounded-[10px] text-[12px] border transition-all cursor-pointer text-left ${
                          clientType === opt.v
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border bg-secondary text-muted-foreground hover:border-muted-foreground/40"
                        }`}
                      >
                        <p className="font-semibold leading-tight">{opt.label}</p>
                        <p className="text-[10px] opacity-70 mt-0.5">{opt.hint}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 block">Brand</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { v: "", label: "Definir depois" },
                      { v: "aceleriq", label: "AcelerIQ" },
                      { v: "sitebolt", label: "SiteBolt" },
                    ].map((opt) => (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => setBrand(opt.v as any)}
                        className={`px-3 py-2 rounded-[10px] text-[12px] border transition-all cursor-pointer ${
                          brand === opt.v
                            ? "border-primary bg-primary/10 text-foreground font-semibold"
                            : "border-border bg-secondary text-muted-foreground hover:border-muted-foreground/40"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Plano & Cobrança */}
              <div className="pt-2 space-y-4">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground block">Plano & Cobrança</label>

                {showRecurring && (
                  <div className="bg-secondary/40 border border-border rounded-xl p-3 space-y-3">
                    <p className="text-[11px] font-semibold text-foreground/80">Mensalidade (recorrente)</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor mensal (R$)</label>
                        <input value={planValue} onChange={(e) => setPlanValue(e.target.value)} type="number" step="0.01" min="0" placeholder="0,00"
                          className="w-full bg-background border border-border rounded-[10px] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Próxima renovação</label>
                        <input value={planRenewalDate} onChange={(e) => setPlanRenewalDate(e.target.value)} type="date"
                          className="w-full bg-background border border-border rounded-[10px] px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors" />
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">Gera a 1ª fatura mensal na data informada. As próximas são criadas automaticamente.</p>
                  </div>
                )}

                {showOneOff && (
                  <div className="bg-secondary/40 border border-border rounded-xl p-3 space-y-3">
                    <p className="text-[11px] font-semibold text-foreground/80">Projeto avulso</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor total (R$)</label>
                        <input value={projectValue} onChange={(e) => setProjectValue(e.target.value)} type="number" step="0.01" min="0" placeholder="0,00"
                          className="w-full bg-background border border-border rounded-[10px] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Vencimento 1ª parcela</label>
                        <input value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} type="date"
                          className="w-full bg-background border border-border rounded-[10px] px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { v: "integral", label: "Integral", hint: "Pagamento à vista" },
                        { v: "installments", label: "Parcelado", hint: "Em N vezes" },
                      ].map((opt) => (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() => setPayMode(opt.v as any)}
                          className={`px-3 py-2 rounded-[10px] text-[12px] border transition-all cursor-pointer text-left ${
                            payMode === opt.v
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border bg-background text-muted-foreground hover:border-muted-foreground/40"
                          }`}
                        >
                          <p className="font-semibold leading-tight">{opt.label}</p>
                          <p className="text-[10px] opacity-70 mt-0.5">{opt.hint}</p>
                        </button>
                      ))}
                    </div>
                    {payMode === "installments" && (
                      <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
                        <div className="space-y-1.5">
                          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Nº de parcelas</label>
                          <input value={installmentsCount} onChange={(e) => setInstallmentsCount(e.target.value)} type="number" step="1" min="2" max="36"
                            className="w-full bg-background border border-border rounded-[10px] px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors" />
                        </div>
                        <p className="text-[11px] text-muted-foreground pb-2.5 font-mono">
                          {(() => {
                            const v = parseFloat(projectValue) || 0;
                            const n = Math.max(parseInt(installmentsCount) || 1, 1);
                            return v > 0 ? `${n}× R$ ${(v / n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
                          })()}
                        </p>
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground">Cria uma cobrança para cada parcela com vencimento mensal a partir da data escolhida.</p>
                  </div>
                )}

                {!showRecurring && !showOneOff && (
                  <p className="text-[11px] text-muted-foreground italic">Defina o tipo de cliente acima para configurar a cobrança.</p>
                )}
              </div>


              <div className="pt-2">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3 block">Serviços Ativos</label>
                <div className="space-y-3">
                  {SERVICES.map((s) => (
                    <div key={s.key} className="flex items-center justify-between">
                      <span className="text-sm text-foreground">{s.label}</span>
                      <Switch checked={!!services[s.key]} onCheckedChange={() => toggleService(s.key)} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
              <button onClick={handleClose} disabled={saving} className="px-4 py-2 rounded-[10px] text-[13px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border border-border">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving} className="px-5 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex items-center gap-2">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {saving ? "Criando..." : "Criar Cliente"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
