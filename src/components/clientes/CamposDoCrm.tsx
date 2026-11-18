import { CampoDeFormulario, campo, juntar } from "@/components/sistema";
import { AJUDA_DO_EMAIL_DO_CRM, mudarFormDoCrm, type FormDoCrm, type PlanoDoCrm } from "@/lib/crmPeloPlano";

const dinheiro = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Os campos do CRM pelo plano (18/11/2026): plano, usuários, valor por mês (sugerido, editável) e quem
 * administra o CRM. Usado na ficha do cliente (Extras e produtos) e na Nova entrada. Vai dentro de um
 * GrupoDeCampos de duas colunas.
 */
export default function CamposDoCrm({ planos, form, aoMudar, emailObrigatorio, apoioDoEmail }: {
  planos: PlanoDoCrm[];
  form: FormDoCrm;
  aoMudar: (f: FormDoCrm) => void;
  emailObrigatorio: boolean;
  apoioDoEmail?: string;
}) {
  const mudar = (c: keyof FormDoCrm, v: string) => aoMudar(mudarFormDoCrm(form, c, v, planos));
  return (
    <>
      <CampoDeFormulario rotulo="Plano do CRM" obrigatorio>
        <select className={campo} value={form.planoId} onChange={(e) => mudar("planoId", e.target.value)} data-crm-plano="">
          {planos.length === 0 && <option value={form.planoId}>{form.planoId || "Carregando…"}</option>}
          {planos.map((p) => <option key={p.id} value={p.id}>{p.nome} · {dinheiro(p.preco_usuario)} por usuário</option>)}
        </select>
      </CampoDeFormulario>
      <CampoDeFormulario rotulo="Usuários" obrigatorio apoio="Pessoas que entram no CRM.">
        <input className={juntar(campo, "tabular-nums")} type="number" min={1} max={500} step={1} value={form.usuarios} onChange={(e) => mudar("usuarios", e.target.value)} data-crm-usuarios="" />
      </CampoDeFormulario>
      <CampoDeFormulario rotulo="Valor por mês (R$)" obrigatorio apoio="Usuários × preço do plano. Pode dar desconto.">
        <input className={juntar(campo, "tabular-nums")} inputMode="decimal" value={form.valor} onChange={(e) => mudar("valor", e.target.value)} placeholder="0,00" data-crm-valor="" />
      </CampoDeFormulario>
      <CampoDeFormulario rotulo="E-mail de quem administra o CRM" obrigatorio={emailObrigatorio} largo apoio={apoioDoEmail || AJUDA_DO_EMAIL_DO_CRM}>
        <input className={campo} type="email" autoComplete="off" value={form.email} maxLength={254} onChange={(e) => mudar("email", e.target.value)} placeholder="pessoa@empresa.com.br" data-crm-email="" />
      </CampoDeFormulario>
      <CampoDeFormulario rotulo="Nome de quem administra" largo>
        <input className={campo} value={form.nome} maxLength={120} onChange={(e) => mudar("nome", e.target.value)} placeholder="Opcional" data-crm-nome="" />
      </CampoDeFormulario>
    </>
  );
}
