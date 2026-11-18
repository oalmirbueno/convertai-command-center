/**
 * CRM como produto no plano do cliente (18/11/2026, pedido do dono): "eu marcando como pago ali já libera
 * o uso do CRM; o acesso ao painel é um, o acesso ao CRM é outro; o CRM é por usuário mensal, junto no
 * plano ou separado via assinatura, sem duplicidade".
 *
 * O CRM pelo plano é um extra "crm" mensal na ficha do cliente (Extras e produtos) com `quantidade`
 * (usuários) e `produto_plano_id`. Depois de salvar o extra, a função do produto liga a conta do CRM
 * (admin_crm_pelo_plano). Pagar a cobrança do extra libera o acesso na hora, pelo gatilho do banco
 * (supabase/migrations/20261118100000_crm_pelo_plano_do_cliente.sql). Aqui ficam as contas, as
 * conferências e a leitura do estado; as telas são ExtrasDoCliente e NewIncomeModal.
 */
import { supabase } from "@/integrations/supabase/client";
import { casa } from "@/lib/produto/api";
import { lerValorBR } from "@/lib/paymentInstallments";

export type PlanoDoCrm = { id: string; nome: string; preco_usuario: number };

export type PessoaDoCrm = { id: string; nome: string; email: string; papel: string; estado: string };

export type CrmDoCliente = {
  conta_id: string;
  nome: string;
  estado: string;
  cobranca_por: "plano" | "assinatura";
  extra_id: string | null;
  plano_id: string | null;
  usuarios_contratados: number;
  acesso_ate: string | null;
  liberada: boolean;
  usuarios_ativos: number;
  convites: number;
  equipe: PessoaDoCrm[];
  assinatura_no_cartao: boolean;
};

export type CrmLigado = { conta_id: string; membro_id: string | null; estado: string; acesso_ate: string | null; liberada: boolean; convite_enviado: boolean };

/** Os campos do formulário do CRM, como o dono digita. */
export type FormDoCrm = { planoId: string; usuarios: string; valor: string; email: string; nome: string };

export const AJUDA_DO_EMAIL_DO_CRM = "É a pessoa que entra no CRM. O login geral do painel continua só para o painel.";

const num = (v: unknown) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};
const paraCampo = (n: number) => (n > 0 ? String(n.toFixed(2)).replace(".", ",") : "");

/** Valor sugerido do extra: usuários × preço por usuário do plano, em centavos certos. */
export function valorSugeridoDoCrm(usuarios: number, precoPorUsuario: number): number {
  const u = Math.floor(num(usuarios));
  const p = num(precoPorUsuario);
  if (u < 1 || p <= 0) return 0;
  return Math.round(u * p * 100) / 100;
}

/** Muda um campo; trocar plano ou usuários recalcula o valor sugerido (o dono ainda pode editar). */
export function mudarFormDoCrm(form: FormDoCrm, campo: keyof FormDoCrm, valor: string, planos: PlanoDoCrm[]): FormDoCrm {
  const novo = { ...form, [campo]: valor };
  if (campo === "planoId" || campo === "usuarios") {
    const plano = planos.find((p) => p.id === novo.planoId);
    const sugerido = plano ? valorSugeridoDoCrm(Number(novo.usuarios), plano.preco_usuario) : 0;
    if (sugerido > 0) novo.valor = paraCampo(sugerido);
  }
  return novo;
}

/** O formulário do começo: o primeiro plano, um usuário e o valor já sugerido. */
export function formInicialDoCrm(planos: PlanoDoCrm[], parcial: Partial<FormDoCrm> = {}): FormDoCrm {
  const planoId = parcial.planoId || planos[0]?.id || "starter";
  const usuarios = parcial.usuarios || "1";
  const plano = planos.find((p) => p.id === planoId);
  const valor = parcial.valor ?? (plano ? paraCampo(valorSugeridoDoCrm(Number(usuarios), plano.preco_usuario)) : "");
  return { planoId, usuarios, valor, email: parcial.email ?? "", nome: parcial.nome ?? "" };
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const limpo = (e?: string | null) => String(e ?? "").trim().toLowerCase();

/** O que falta para salvar o CRM. Devolve a frase que aparece no formulário, ou null quando está certo. */
export function conferirCrm(f: {
  planoId: string;
  usuarios: number;
  valor: number;
  email: string;
  /** Sem ninguém administrando ainda, o e-mail é obrigatório. */
  emailObrigatorio: boolean;
  /** O e-mail do login geral do painel do cliente, quando a tela conhece. */
  loginDoPainel?: string | null;
  /** Pessoas que já estão no CRM (o banco não aceita contratar menos do que isso). */
  ocupados?: number;
}): string | null {
  if (!f.planoId) return "Escolha o plano do CRM.";
  if (!Number.isInteger(f.usuarios) || f.usuarios < 1 || f.usuarios > 500) return "Usuários vai de 1 a 500.";
  if (f.ocupados && f.usuarios < f.ocupados) return `A empresa já tem ${f.ocupados} pessoas no CRM. Contrate pelo menos isso ou remova alguém antes.`;
  if (!(f.valor > 0)) return "Diga o valor por mês.";
  const email = limpo(f.email);
  if (!email) return f.emailObrigatorio ? "Diga o e-mail de quem vai administrar o CRM." : null;
  if (!EMAIL.test(email)) return "E-mail de quem administra o CRM inválido.";
  if (f.loginDoPainel && email === limpo(f.loginDoPainel)) {
    return "O acesso ao CRM é separado do painel: use o e-mail da pessoa que vai administrar o CRM, não o login geral do painel.";
  }
  return null;
}

/** Lê o que `produto_crm_do_cliente` devolveu (null quando o cliente não tem CRM). */
export function lerCrmDoCliente(d: unknown): CrmDoCliente | null {
  if (!d || typeof d !== "object") return null;
  const r = d as Record<string, unknown>;
  if (!r.conta_id) return null;
  const equipe = Array.isArray(r.equipe) ? (r.equipe as Record<string, unknown>[]) : [];
  return {
    conta_id: String(r.conta_id),
    nome: String(r.nome ?? ""),
    estado: String(r.estado ?? ""),
    cobranca_por: r.cobranca_por === "plano" ? "plano" : "assinatura",
    extra_id: r.extra_id ? String(r.extra_id) : null,
    plano_id: r.plano_id ? String(r.plano_id) : null,
    usuarios_contratados: num(r.usuarios_contratados),
    acesso_ate: r.acesso_ate ? String(r.acesso_ate) : null,
    liberada: r.liberada === true,
    usuarios_ativos: num(r.usuarios_ativos),
    convites: num(r.convites),
    equipe: equipe.map((m) => ({ id: String(m.id ?? ""), nome: String(m.nome ?? ""), email: String(m.email ?? ""), papel: String(m.papel ?? ""), estado: String(m.estado ?? "") })),
    assinatura_no_cartao: r.assinatura_no_cartao === true,
  };
}

/**
 * "dd/mm" do último dia com acesso, no horário de Brasília. O banco grava o instante em que o acesso
 * acaba (meia-noite do dia seguinte), então o último dia é o anterior a esse instante.
 */
export function ultimoDiaDoAcesso(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!isFinite(t)) return "";
  const partes = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).formatToParts(new Date(t - 1));
  const dia = partes.find((p) => p.type === "day")?.value ?? "";
  const mes = partes.find((p) => p.type === "month")?.value ?? "";
  return dia && mes ? `${dia}/${mes}` : "";
}

export type SituacaoDoCrm = {
  /** Este extra é o que paga a conta do CRM. */
  ligado: boolean;
  rotulo: string;
  tom: "ok" | "espera" | "fim";
  /** "2 de 3 usuários em uso", ou null quando não está ligado. */
  usuarios: string | null;
  /** A empresa já paga o CRM no cartão: o extra não deve existir. */
  cartao: boolean;
  /** Já tem alguém administrando o CRM. */
  temAdmin: boolean;
  ocupados: number;
};

/** O estado do CRM na linha do extra, lido de `produto_crm_do_cliente`. */
export function situacaoDoCrm(crm: CrmDoCliente | null, extra: { id: string; status: string }): SituacaoDoCrm {
  const ligado = !!crm && crm.extra_id === extra.id;
  const cartao = !!crm && crm.assinatura_no_cartao;
  const ocupados = ligado && crm ? crm.equipe.length : 0;
  const temAdmin = ligado && !!crm && crm.equipe.some((m) => m.papel === "admin");
  const base = { ligado, cartao, temAdmin, ocupados, usuarios: null as string | null };
  if (!ligado || !crm) {
    if (extra.status === "encerrado") return { ...base, rotulo: "Encerrado", tom: "fim" };
    return { ...base, rotulo: "CRM ainda não ligado", tom: "espera" };
  }
  const n = crm.usuarios_contratados;
  const usuarios = `${ocupados} de ${n} ${n === 1 ? "usuário" : "usuários"} em uso${crm.convites > 0 ? ` · ${crm.convites} ${crm.convites === 1 ? "convite pendente" : "convites pendentes"}` : ""}`;
  const ate = ultimoDiaDoAcesso(crm.acesso_ate);
  if (extra.status === "encerrado" || crm.cobranca_por !== "plano") {
    return { ...base, usuarios, rotulo: crm.liberada && ate ? `Encerrado, acesso até ${ate}` : "Encerrado", tom: "fim" };
  }
  if (crm.liberada) return { ...base, usuarios, rotulo: ate ? `Liberado até ${ate}` : "Liberado", tom: "ok" };
  return { ...base, usuarios, rotulo: "Aguardando pagamento", tom: "espera" };
}

/** O aviso depois de ligar o CRM. */
export function avisoDoCrmLigado(r: CrmLigado, email: string): string {
  const quem = limpo(email);
  const convite = r.convite_enviado && quem ? ` Convite enviado para ${quem}.` : r.membro_id && quem ? ` O convite para ${quem} não saiu agora; reenvie pelo admin do produto.` : "";
  const ate = ultimoDiaDoAcesso(r.acesso_ate);
  if (r.liberada && ate) return `CRM ligado.${convite} Liberado até ${ate}.`;
  return `CRM ligado.${convite} O acesso libera quando você marcar a cobrança como paga.`;
}

/** A frase de quando o banco recusa um segundo CRM vivo para o mesmo cliente. */
export function erroDeCrmRepetido(e: unknown): string | null {
  const m = e && typeof e === "object" ? `${String((e as { message?: unknown }).message ?? "")} ${String((e as { details?: unknown }).details ?? "")}` : "";
  return /client_extras_um_crm_vivo/.test(m) ? "Este cliente já tem um CRM ativo. Edite o que já existe em Extras e produtos." : null;
}

/** Números do formulário. */
export function numerosDoCrm(f: FormDoCrm): { usuarios: number; valor: number } {
  return { usuarios: Number(f.usuarios), valor: lerValorBR(f.valor) };
}

// ------------------------------------------------------------------ banco

export async function lerPlanosDoCrm(): Promise<PlanoDoCrm[]> {
  const { data, error } = await (supabase as any).from("produto_planos").select("id, nome, preco_usuario, ordem, ativo").order("ordem", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[])
    .filter((p) => p.ativo !== false)
    .map((p) => ({ id: String(p.id), nome: String(p.nome ?? p.id), preco_usuario: num(p.preco_usuario) }));
}

/** O CRM do cliente (ou null) e o e-mail do login geral do painel dele. */
export async function lerCrmECadastro(clientId: string): Promise<{ crm: CrmDoCliente | null; loginDoPainel: string | null }> {
  const [crm, perfil] = await Promise.all([
    (supabase as any).rpc("produto_crm_do_cliente", { _client: clientId }),
    (supabase as any).from("profiles").select("email").eq("id", clientId).maybeSingle(),
  ]);
  if (crm.error) throw crm.error;
  return { crm: lerCrmDoCliente(crm.data), loginDoPainel: perfil.data?.email ? String(perfil.data.email) : null };
}

/** Grava usuários e plano no extra e liga a conta do CRM a ele (convida quem administra). */
export async function ligarCrmPeloPlano(p: { extraId: string; planoId: string; usuarios: number; email: string; nome: string }): Promise<CrmLigado> {
  const { error } = await (supabase as any).from("client_extras").update({ quantidade: p.usuarios, produto_plano_id: p.planoId }).eq("id", p.extraId);
  if (error) throw error;
  return casa.crmPeloPlano({ extra_id: p.extraId, email: limpo(p.email), nome: p.nome.trim() });
}
