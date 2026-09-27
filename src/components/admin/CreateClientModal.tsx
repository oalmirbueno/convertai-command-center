import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, X, Loader2 } from "lucide-react";
import {
  AjudaRecolhida,
  CampoDeFormulario,
  EstadoDeErro,
  GrupoDeCampos,
  Secao,
  SeletorCompacto,
  botao,
  campo,
  juntar,
  superficie,
  texto,
} from "@/components/sistema";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { fireWebhook, webhooks } from "@/lib/webhooks";
import { APP_PUBLIC_URL as PORTAL_URL } from "@/lib/publicUrl";
import { useFinancePlans } from "@/hooks/useFinanceV2";
import type { Database } from "@/integrations/supabase/types";

type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];
type BillingInsert = Database["public"]["Tables"]["billing"]["Insert"];

/**
 * Senha provisória que SEMPRE passa na régua do manage-team (12+ com minúscula,
 * maiúscula, número e símbolo). Antes o sorteio livre deixava de fora símbolo
 * ou número em quase metade das vezes e o "Novo Cliente" falhava com 400.
 */
export function generatePassword(len = 16) {
  const grupos = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%*-_"];
  const todos = grupos.join("");
  const tamanho = Math.max(12, len);
  const sorteio = Array.from(crypto.getRandomValues(new Uint32Array(tamanho * 2)));
  const letras = grupos.map((g, i) => g[sorteio[i] % g.length]);
  for (let i = grupos.length; i < tamanho; i++) letras.push(todos[sorteio[i] % todos.length]);
  // Embaralha (Fisher-Yates) para a posição de cada classe não ser fixa.
  for (let i = letras.length - 1; i > 0; i--) {
    const j = sorteio[tamanho + i] % (i + 1);
    const t = letras[i];
    letras[i] = letras[j];
    letras[j] = t;
  }
  return letras.join("");
}

function rpcRecord(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : null;
}

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
  const [internalCompany, setInternalCompany] = useState(false);
  const [createdSuccess, setCreatedSuccess] = useState(false);
  const [createdUserId, setCreatedUserId] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [emailWarning, setEmailWarning] = useState(false);
  const [resendingInvite, setResendingInvite] = useState(false);

  // Plano recorrente (mensalidade)
  const [planValue, setPlanValue] = useState("");
  const [planRenewalDate, setPlanRenewalDate] = useState("");
  const [planName, setPlanName] = useState("");
  const { data: catalogPlans } = useFinancePlans();

  // Projeto avulso (one_off)
  const [projectValue, setProjectValue] = useState("");
  const [payMode, setPayMode] = useState<"integral" | "installments">("integral");
  const [installmentsCount, setInstallmentsCount] = useState("2");
  /**
   * O cadastro assumia que TODO pagamento inicial já tinha caído — a
   * mensalidade e a 1ª parcela nasciam "pagas no ato", sem pergunta. Cliente
   * que entrou sem pagar ficava como pago, e o financeiro mentia até alguém
   * caçar a linha errada. Recebido continua sendo o padrão (é o caso comum);
   * a diferença é que agora é uma ESCOLHA.
   */
  const [mensalidadeRecebida, setMensalidadeRecebida] = useState(true);
  const [entradaRecebida, setEntradaRecebida] = useState(true);
  /** Valor da 1ª parcela quando difere do rateio (entrada maior ou menor). */
  const [entradaValor, setEntradaValor] = useState("");
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
    setServices({}); setInternalCompany(false);
    setPlanValue(""); setPlanRenewalDate(""); setPlanName("");
    setProjectValue(""); setPayMode("integral"); setInstallmentsCount("2"); setFirstDueDate("");
    setCreatedSuccess(false);
    setCreatedUserId(""); setInviteUrl(""); setEmailWarning(false); setResendingInvite(false);
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
      // Random unknown password · the client will set their own via first-access link.
      const password = generatePassword();

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
        throw new Error(fnError.message || "Erro ao criar cliente");
      }

      const createResult = rpcRecord(result);
      if (createResult?.error) {
        const msg = typeof createResult.error === "string"
          ? createResult.error
          : "Erro ao criar cliente";
        if (msg.includes("already") || msg.includes("exists")) {
          throw new Error("Este email já está cadastrado");
        }
        throw new Error(msg);
      }

      const newUserId = typeof createResult?.user_id === "string"
        ? createResult.user_id
        : "";
      if (!newUserId) throw new Error("O usuário foi criado sem um identificador válido.");

      const planValueNum = parseFloat(planValue) || 0;
      const profileUpdate: ProfileUpdate = {
        phone: phone.trim() || null,
        company_name: company.trim(),
        services_config: internalCompany ? { ...services, internal_company: true } : services,
        client_type: clientType,
        brand: brand || null,
      };
      if (showRecurring && planValueNum > 0) {
        profileUpdate.plan_value = planValueNum;
        profileUpdate.plan_name = planName.trim() || "Mensalidade";
        profileUpdate.plan_status = "active";
        if (planRenewalDate) profileUpdate.plan_renewal_date = planRenewalDate;
      }
      const { error: profileError } = await supabase
        .from("profiles")
        .update(profileUpdate)
        .eq("id", newUserId);
      if (profileError) throw new Error("Não foi possível completar o cadastro do cliente.");

      // O ciclo atual entra como o DONO disse — recebido ou a receber. A
      // premissa antiga ("cadastrou porque pagou") virava registro falso
      // sempre que o combinado era pagar depois.
      if (showRecurring && planValueNum > 0) {
        const todayStr = new Date().toISOString().slice(0, 10);
        const rowsRec: BillingInsert[] = [{
          client_id: newUserId,
          type: "renewal",
          amount: planValueNum,
          due_date: todayStr,
          paid_date: mensalidadeRecebida ? todayStr : null,
          paid_amount: mensalidadeRecebida ? planValueNum : null,
          description: `Mensalidade · ${company.trim() || fullName.trim()}${mensalidadeRecebida ? " (pago no cadastro)" : " (a receber)"}`,
          status: mensalidadeRecebida ? "paid" : "pending",
        }];
        if (planRenewalDate && planRenewalDate > todayStr) {
          rowsRec.push({
            client_id: newUserId,
            type: "renewal",
            amount: planValueNum,
            due_date: planRenewalDate,
            description: `Mensalidade · ${company.trim() || fullName.trim()}`,
            status: "pending",
          });
        }
        const { error: recurringBillingError } = await supabase
          .from("billing")
          .insert(rowsRec);
        if (recurringBillingError) {
          throw new Error("Cliente criado, mas não foi possível registrar a cobrança recorrente.");
        }
      }

      // Cria as cobranças do projeto avulso (integral ou parcelado)
      const projValueNum = parseFloat(projectValue) || 0;
      if (showOneOff && projValueNum > 0 && firstDueDate) {
        const n = payMode === "integral" ? 1 : Math.max(parseInt(installmentsCount) || 1, 1);
        /* A entrada pode ter valor PRÓPRIO (ex.: 500 de sinal e o resto em
           parcelas iguais). Antes o rateio era sempre igual, e o dono
           acertava depois à mão no financeiro — errando de vez em quando. */
        const entradaNum = parseFloat(entradaValor);
        const temEntradaPropria =
          n > 1 && Number.isFinite(entradaNum) && entradaNum > 0 && entradaNum < projValueNum;
        const primeira = temEntradaPropria ? +entradaNum.toFixed(2) : +(projValueNum / n).toFixed(2);
        const restantePer = n > 1 ? +((projValueNum - primeira) / (n - 1)).toFixed(2) : 0;
        const first = new Date(firstDueDate + "T00:00:00");
        const todayIso = new Date().toISOString().slice(0, 10);
        const rows: BillingInsert[] = Array.from({ length: n }, (_, idx) => {
          const due = new Date(first);
          due.setMonth(due.getMonth() + idx);
          const dueStr = due.toISOString().slice(0, 10);
          const isFirst = idx === 0;
          // Última parcela acerta o arredondamento sobre o RESTANTE.
          const amount = isFirst
            ? primeira
            : idx === n - 1
              ? +(projValueNum - primeira - restantePer * (n - 2)).toFixed(2)
              : restantePer;
          const primeiraRecebida = isFirst && entradaRecebida;
          return {
            client_id: newUserId,
            type: "one_off",
            amount,
            // Recebida entra datada de hoje; a combinada para depois vence na
            // data informada, como qualquer parcela.
            due_date: primeiraRecebida ? todayIso : dueStr,
            paid_date: primeiraRecebida ? todayIso : null,
            paid_amount: primeiraRecebida ? amount : null,
            description: n === 1
              ? `Projeto · ${company.trim() || fullName.trim()}${primeiraRecebida ? " (pago no cadastro)" : " (a receber)"}`
              : `Projeto · ${isFirst ? "Entrada" : `Parcela ${idx + 1}/${n}`}${primeiraRecebida ? " (pago no cadastro)" : isFirst ? " (a receber)" : ""}`,
            status: primeiraRecebida ? "paid" : "pending",
          };
        });
        const { error: projectBillingError } = await supabase
          .from("billing")
          .insert(rows);
        if (projectBillingError) {
          throw new Error("Cliente criado, mas não foi possível registrar a cobrança do projeto.");
        }
      }

      // The database issues the bearer once and persists only its digest in a
      // private schema. No browser-generated token is written to profiles.
      const { data: issueData, error: issueError } = await supabase.rpc(
        "issue_first_access_token",
        { p_profile_id: newUserId },
      );
      const issue = rpcRecord(issueData);
      const firstAccessToken = typeof issue?.token === "string" ? issue.token : "";
      if (issueError || !/^[a-f0-9]{64}$/.test(firstAccessToken)) {
        throw new Error("Cliente criado, mas não foi possível gerar o convite de primeiro acesso.");
      }

      const firstAccessUrl = `${PORTAL_URL}/primeiro-acesso?token=${firstAccessToken}`;
      setCreatedUserId(newUserId);
      setInviteUrl(firstAccessUrl);
      const { data: emailData, error: emailError } = await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "client-welcome",
          recipientEmail: email.trim(),
          idempotencyKey: `client-welcome-${newUserId}`,
          templateData: {
            name: fullName.trim(),
            company: company.trim(),
            email: email.trim(),
            firstAccessUrl,
          },
        },
      });
      const emailResult = rpcRecord(emailData);
      // Falha de e-mail NUNCA deixa o cliente sem caminho: o cadastro segue,
      // com aviso claro, link de primeiro acesso para copiar e reenvio em um clique.
      setEmailWarning(Boolean(emailError || emailResult?.error));

      setCreatedSuccess(true);
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
      void queryClient.invalidateQueries({ queryKey: ["billing"] });

      // Fire webhook (fire and forget)
      void fireWebhook(webhooks.onboardClient, {
        client_id: newUserId,
        name: fullName.trim(),
        email: email.trim(),
        company: company.trim(),
        phone: phone.trim() || "",
        services,
        send_welcome_email: true,
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar cliente");
    } finally {
      setSaving(false);
    }
  };

  const reenviarConvite = async () => {
    setResendingInvite(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-reset-client-access", {
        body: { profile_id: createdUserId, new_email: email.trim().toLowerCase(), new_full_name: fullName.trim() },
      });
      const res = rpcRecord(data);
      if (error || res?.error) throw new Error();
      if (typeof res?.firstAccessUrl === "string") setInviteUrl(res.firstAccessUrl);
      setEmailWarning(false);
      toast.success("Convite reenviado por e-mail!");
    } catch {
      toast.error("Ainda não foi possível enviar. Copie o link abaixo e mande direto ao cliente.");
    } finally {
      setResendingInvite(false);
    }
  };

  const copiarConvite = async (mensagem: string) => {
    try { await navigator.clipboard.writeText(inviteUrl); toast.success(mensagem); }
    catch { toast.error("Selecione e copie o link manualmente."); }
  };

  /** Escolha em dois cartões (recebida / vai pagar, integral / parcelado): segmentado com uma linha de apoio. */
  const escolha = (
    rotulo: string,
    valor: string | boolean,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mudar: (v: any) => void,
    opcoes: { v: string | boolean; label: string; hint: string }[],
  ) => (
    <CampoDeFormulario rotulo={rotulo} largo apoio={(opcoes.find((o) => o.v === valor) || opcoes[0]).hint}>
      <SeletorCompacto
        rotulo={rotulo}
        larguraTotal
        modo="segmentado"
        opcoes={opcoes.map((o) => ({ valor: String(o.v), rotulo: o.label }))}
        valor={String(valor)}
        onEscolher={(v) => {
          const achada = opcoes.find((o) => String(o.v) === v);
          if (achada) mudar(achada.v);
        }}
      />
    </CampoDeFormulario>
  );

  const parcelaTexto = (() => {
    const v = parseFloat(projectValue) || 0;
    const n = Math.max(parseInt(installmentsCount) || 1, 1);
    return v > 0 ? `${n}× R$ ${(v / n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : undefined;
  })();

  // Portal no body: no celular o conteúdo do painel é uma camada própria e a janela ficava por baixo das barras.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/60" onClick={handleClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="novo-cliente-titulo"
        className="relative flex max-h-full w-full max-w-[640px] flex-col overflow-hidden border-border bg-card sm:max-h-[90vh] sm:rounded-lg sm:border"
      >
        <div className="flex min-w-0 items-center justify-between border-b border-border px-4 py-3 sm:px-5">
          <h2 id="novo-cliente-titulo" className={texto.tituloSecao}>
            {createdSuccess ? "Cliente criado" : "Novo cliente"}
          </h2>
          <button type="button" onClick={handleClose} aria-label="Fechar" className={botao.icone}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {createdSuccess ? (
          <>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">
              <div className="flex min-w-0 items-center">
                <span className="mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/10 text-success" aria-hidden="true">
                  <Check className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className={juntar(texto.corpo, "truncate font-semibold")}>{fullName}</p>
                  <p className={juntar(texto.auxiliar, "truncate")}>{email}</p>
                </div>
              </div>

              {emailWarning ? (
                <EstadoDeErro
                  titulo="O e-mail de convite não foi enviado."
                  descricao="O cliente foi criado. Reenvie o convite ou copie o link e mande direto."
                  acao={
                    <div className="flex flex-col items-end [&>*+*]:mt-2">
                      <button type="button" onClick={reenviarConvite} disabled={resendingInvite} className={botao.primario}>
                        {resendingInvite ? "Reenviando…" : "Reenviar e-mail"}
                      </button>
                      <button type="button" onClick={() => copiarConvite("Link copiado! Envie ao cliente pelo WhatsApp.")} className={botao.secundario}>
                        Copiar link
                      </button>
                    </div>
                  }
                />
              ) : (
                <Secao
                  titulo="Convite de primeiro acesso"
                  descricao="Enviado por e-mail"
                  ajuda="Enviamos um e-mail de boas-vindas com um botão de primeiro acesso. O cliente clica, cria a própria senha e já entra no portal."
                  acao={
                    inviteUrl ? (
                      <button type="button" onClick={() => copiarConvite("Link copiado!")} className={botao.secundario}>
                        Copiar link
                      </button>
                    ) : undefined
                  }
                />
              )}
              {emailWarning && inviteUrl && <p className={juntar(texto.auxiliar, "break-all")}>{inviteUrl}</p>}

              <p className={texto.auxiliar}>
                A senha criada pelo cliente permanece privada e protegida. Se necessário,
                um administrador pode definir uma nova senha no cadastro, sem visualizar a atual.
              </p>
            </div>

            <div className="flex justify-end border-t border-border px-4 py-3 sm:px-5">
              <button type="button" onClick={handleClose} className={botao.primario}>
                Fechar
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">
              <GrupoDeCampos titulo="Dados">
                <CampoDeFormulario rotulo="Nome completo" obrigatorio>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nome do cliente" className={campo} />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Empresa" obrigatorio>
                  <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Nome da empresa" className={campo} />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="E-mail" obrigatorio>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="email@empresa.com" className={campo} />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Telefone">
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" inputMode="tel" className={campo} />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Tipo de cliente" obrigatorio apoio={clientType === "recurring" ? "Mensalidade" : clientType === "one_off" ? "Projeto único" : "Mensalidade e projeto"}>
                  <SeletorCompacto
                    rotulo="Tipo de cliente"
                    larguraTotal
                    opcoes={[
                      { valor: "recurring", rotulo: "Recorrente" },
                      { valor: "one_off", rotulo: "Avulso" },
                      { valor: "hybrid", rotulo: "Híbrido" },
                    ]}
                    valor={clientType}
                    onEscolher={(v) => setClientType(v as typeof clientType)}
                  />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Marca">
                  <SeletorCompacto
                    rotulo="Marca"
                    larguraTotal
                    opcoes={[
                      { valor: "", rotulo: "Depois" },
                      { valor: "aceleriq", rotulo: "AcelerIQ" },
                      { valor: "sitebolt", rotulo: "SiteBolt" },
                    ]}
                    valor={brand}
                    onEscolher={(v) => setBrand(v as typeof brand)}
                  />
                </CampoDeFormulario>
                <div className={juntar(superficie.poco, "flex min-w-0 items-center justify-between px-3 py-2.5 sm:col-span-full")}>
                  <div className="mr-3 flex min-w-0 items-center">
                    <span className={juntar(texto.corpo, "font-medium")} id="novo-empresa-do-grupo">
                      Empresa do grupo (interna)
                    </span>
                    <AjudaRecolhida className="ml-1.5">Cadastro só para organização. Sem mensalidade, fora de cobranças e alertas.</AjudaRecolhida>
                  </div>
                  <Switch aria-labelledby="novo-empresa-do-grupo" checked={internalCompany} onCheckedChange={setInternalCompany} />
                </div>
              </GrupoDeCampos>

              {showRecurring && (
                <GrupoDeCampos titulo="Mensalidade" className="border-t border-border pt-5">
                  <CampoDeFormulario rotulo="Plano" largo apoio="Escolher um plano preenche o valor, que segue editável.">
                    <select
                      value={(catalogPlans || []).find((p) => p.name.trim().toLowerCase() === planName.trim().toLowerCase())?.id || ""}
                      onChange={(e) => {
                        const plan = (catalogPlans || []).find((p) => p.id === e.target.value);
                        if (!plan) { setPlanName(""); return; }
                        const v = plan.currentVersion || plan.versions[0] || null;
                        setPlanName(plan.name);
                        if (v) setPlanValue(String(v.finalAmount || v.amount));
                      }}
                      className={campo}
                    >
                      <option value="">Mensalidade (sem plano do catálogo)</option>
                      {(catalogPlans || []).filter((p) => p.isActive).map((p) => {
                        const v = p.currentVersion || p.versions[0] || null;
                        return (
                          <option key={p.id} value={p.id}>
                            {p.name}{v ? ` · R$ ${(v.finalAmount || v.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : ""}
                          </option>
                        );
                      })}
                    </select>
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Valor mensal (R$)">
                    <input value={planValue} onChange={(e) => setPlanValue(e.target.value)} type="number" step="0.01" min="0" placeholder="0,00" className={juntar(campo, "tabular-nums")} />
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Próxima renovação" ajuda="Gera a 1ª fatura mensal nesta data. As próximas são criadas automaticamente.">
                    <input value={planRenewalDate} onChange={(e) => setPlanRenewalDate(e.target.value)} type="date" className={campo} />
                  </CampoDeFormulario>
                  {escolha("Primeira mensalidade", mensalidadeRecebida, setMensalidadeRecebida, [
                    { v: true, label: "Recebida no cadastro", hint: "O dinheiro já caiu" },
                    { v: false, label: "Vai pagar", hint: "Fica pendente no financeiro" },
                  ])}
                </GrupoDeCampos>
              )}

              {showOneOff && (
                <GrupoDeCampos titulo="Projeto avulso" className="border-t border-border pt-5">
                  <CampoDeFormulario rotulo="Valor total (R$)">
                    <input value={projectValue} onChange={(e) => setProjectValue(e.target.value)} type="number" step="0.01" min="0" placeholder="0,00" className={juntar(campo, "tabular-nums")} />
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Vencimento 1ª parcela" ajuda="Cria uma cobrança para cada parcela, com vencimento mensal a partir desta data.">
                    <input value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} type="date" className={campo} />
                  </CampoDeFormulario>
                  {escolha("Pagamento", payMode, setPayMode, [
                    { v: "integral", label: "Integral", hint: "Pagamento à vista" },
                    { v: "installments", label: "Parcelado", hint: "Em N vezes" },
                  ])}
                  {payMode === "installments" && (
                    <>
                      <CampoDeFormulario rotulo="Valor da entrada (R$)">
                        <input value={entradaValor} onChange={(e) => setEntradaValor(e.target.value)} type="number" step="0.01" min="0" placeholder="vazio = parcelas iguais" className={juntar(campo, "tabular-nums")} />
                      </CampoDeFormulario>
                      <CampoDeFormulario rotulo="Nº de parcelas" apoio={parcelaTexto}>
                        <input value={installmentsCount} onChange={(e) => setInstallmentsCount(e.target.value)} type="number" step="1" min="2" max="36" className={juntar(campo, "tabular-nums")} />
                      </CampoDeFormulario>
                    </>
                  )}
                  {escolha("Primeira parcela", entradaRecebida, setEntradaRecebida, [
                    { v: true, label: "1ª parcela recebida", hint: "O valor já caiu no cadastro" },
                    { v: false, label: "1ª a receber", hint: "Vence na data informada" },
                  ])}
                </GrupoDeCampos>
              )}

              <Secao titulo="Serviços ativos" divisoria descricao={`${SERVICES.filter((s) => !!services[s.key]).length} de ${SERVICES.length}`}>
                <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                  {SERVICES.map((s) => (
                    <li key={s.key} className="flex min-w-0 items-center justify-between border-b border-border py-2">
                      <span className={juntar(texto.corpo, "min-w-0 truncate")} id={`novo-servico-${s.key}`}>
                        {s.label}
                      </span>
                      <Switch aria-labelledby={`novo-servico-${s.key}`} checked={!!services[s.key]} onCheckedChange={() => toggleService(s.key)} />
                    </li>
                  ))}
                </ul>
              </Secao>
            </div>

            <div className="flex justify-end border-t border-border px-4 py-3 sm:px-5 [&>*+*]:ml-2">
              <button type="button" onClick={handleClose} disabled={saving} className={botao.secundario}>
                Cancelar
              </button>
              <button type="button" onClick={handleSave} disabled={saving} className={botao.primario}>
                {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
                {saving ? "Criando..." : "Criar cliente"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
