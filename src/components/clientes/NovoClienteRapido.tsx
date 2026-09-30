import { useEffect, useMemo, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, campo, texto } from "@/components/sistema/estilos";
import { supabase } from "@/integrations/supabase/client";
import { APP_PUBLIC_URL as PORTAL_URL } from "@/lib/publicUrl";
import { generatePassword } from "@/components/admin/CreateClientModal";
import { useLeadsParaProposta, type LeadParaProposta } from "@/components/clientes-propostas/propostasDaCarteira";

/**
 * Cliente avulso na hora (frente PRO3, adendo do dono de 30/09): "às vezes o
 * cliente ainda não está no painel e só quer algo avulso". Janela CENTRAL
 * (regra do dono: nada de gaveta lateral) com o mínimo: nome, contato (e-mail
 * e/ou WhatsApp), empresa e o tipo (avulso por padrão, ou lead do Comercial).
 * A janela é a JanelaCentral do sistema.
 *
 * Usa o mesmo caminho do "Novo cliente" (função manage-team, só admin, e a
 * atualização do perfil pela RLS de hoje): nenhum atalho. A diferença é que
 * NADA sai para o cliente sozinho: sem e-mail de boas-vindas, sem onboarding
 * e sem convite. O convite fica para depois, pelo botão "Enviar convite"
 * (no aviso de criado e na ficha do cliente).
 *
 * Sem e-mail (só WhatsApp): o cadastro de acesso exige um e-mail, então vai um
 * endereço de reserva que não recebe nada (domínio .invalid); o convite só
 * aparece quando houver e-mail de verdade.
 */

export type TipoDoClienteRapido = "avulso" | "lead";
export type DadosDoClienteRapido = { nome: string; empresa: string; email: string; whatsapp: string; leadId: string | null };
export type ClienteCriado = { id: string; nome: string; email: string | null };

export const DOMINIO_SEM_EMAIL = "sem-email.aceleriq.invalid";
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emailDeReserva = (): string => {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return `cliente-${Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("")}@${DOMINIO_SEM_EMAIL}`;
};
export const ehEmailDeReserva = (email: string | null | undefined) => !!email && email.toLowerCase().endsWith(`@${DOMINIO_SEM_EMAIL}`);

/** O que falta para criar (null = pode criar). */
export function faltaNoClienteRapido(d: DadosDoClienteRapido): string | null {
  if (d.nome.trim().length < 2) return "Escreva o nome do cliente.";
  const email = d.email.trim();
  const whats = d.whatsapp.replace(/\D/g, "");
  if (!email && whats.length < 10) return "Informe o e-mail ou o WhatsApp (com DDD).";
  if (email && !EMAIL_OK.test(email)) return "O e-mail não parece certo.";
  if (whats && whats.length < 10) return "O WhatsApp precisa do DDD.";
  return null;
}

function registro(v: unknown): Record<string, unknown> | null {
  const c = Array.isArray(v) ? v[0] : v;
  return c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : null;
}

/**
 * Cria o cliente pelo caminho de hoje (manage-team + perfil) e o põe na lista
 * de clientes em cache na hora (o seletor da mesa já mostra), relendo em volta.
 */
export async function criarClienteRapido(d: DadosDoClienteRapido, qc?: QueryClient): Promise<ClienteCriado> {
  const falta = faltaNoClienteRapido(d);
  if (falta) throw new Error(falta);
  const nome = d.nome.trim();
  const empresa = d.empresa.trim();
  const emailReal = d.email.trim().toLowerCase();
  const email = emailReal || emailDeReserva();
  const { data, error } = await supabase.functions.invoke("manage-team", {
    body: { action: "create", email, full_name: nome, role: "client", password: generatePassword(), company_name: empresa || null },
  });
  if (error) throw new Error(error.message || "O cliente não foi criado.");
  const r = registro(data);
  if (r && r.error) {
    const msg = typeof r.error === "string" ? r.error : "O cliente não foi criado.";
    throw new Error(/already|exists/i.test(msg) ? "Este e-mail já está cadastrado. Procure o cliente na lista." : msg);
  }
  const id = r && typeof r.user_id === "string" ? r.user_id : "";
  if (!id) throw new Error("O cliente foi criado sem um identificador válido.");
  const perfil: Record<string, unknown> = {
    phone: d.whatsapp.trim() || null,
    company_name: empresa || nome,
    client_type: "one_off",
    // Bandeira de controle (não é serviço vendido): o lead de onde veio. Faz o cliente entrar nas mesas de criação.
    services_config: d.leadId ? { lead_id: d.leadId } : {},
  };
  // Lead que ainda não fechou fica "Em andamento" (não conta como cliente ativo).
  if (d.leadId) perfil.plan_status = "onboarding";
  const { error: erroPerfil } = await (supabase as any).from("profiles").update(perfil).eq("id", id);
  if (erroPerfil) throw new Error("O cliente foi criado, mas o cadastro não foi completado. Abra a ficha em Clientes.");
  const novo = { id, full_name: nome, company_name: empresa || nome, email, phone: perfil.phone, client_type: "one_off", plan_status: d.leadId ? "onboarding" : null, services_config: perfil.services_config, deleted_at: null, projectCount: 0 };
  if (qc) {
    qc.setQueriesData({ queryKey: ["clients"] }, (antes: unknown) => (Array.isArray(antes) && !antes.some((c: any) => c && c.id === id) ? antes.concat([novo]) : antes));
    void qc.invalidateQueries({ queryKey: ["clients"] });
  }
  return { id, nome: empresa || nome, email: emailReal || null };
}

/** O convite de primeiro acesso, só quando a pessoa pede (nunca sozinho). */
export async function enviarConviteDoCliente(c: { id: string; nome: string; empresa?: string; email: string }): Promise<void> {
  if (!c.email || ehEmailDeReserva(c.email)) throw new Error("Cadastre o e-mail do cliente antes de mandar o convite.");
  const { data, error } = await supabase.rpc("issue_first_access_token" as any, { p_profile_id: c.id });
  const r = registro(data);
  const token = r && typeof r.token === "string" ? r.token : "";
  if (error || !/^[a-f0-9]{64}$/.test(token)) throw new Error("O convite não foi gerado.");
  const { data: d2, error: e2 } = await supabase.functions.invoke("send-transactional-email", {
    body: {
      templateName: "client-welcome",
      recipientEmail: c.email,
      idempotencyKey: `client-welcome-${c.id}`,
      templateData: { name: c.nome, company: c.empresa || c.nome, email: c.email, firstAccessUrl: `${PORTAL_URL}/primeiro-acesso?token=${token}` },
    },
  });
  if (e2 || (registro(d2) && registro(d2)!.error)) throw new Error("O e-mail do convite não saiu. Tente de novo pela ficha do cliente.");
}

export default function NovoClienteRapido({
  aberto,
  onAberto,
  inicial,
  tipoInicial,
  titulo = "Novo cliente avulso",
  rotuloDoCriar = "Criar e abrir",
  onCriado,
}: {
  aberto: boolean;
  onAberto: (v: boolean) => void;
  /** Dados que já vêm (ex.: do lead escolhido na Nova proposta). */
  inicial?: Partial<DadosDoClienteRapido> | null;
  tipoInicial?: TipoDoClienteRapido;
  titulo?: string;
  rotuloDoCriar?: string;
  /** Criou: a tela abre a mesa (ou a proposta) nesse cliente. */
  onCriado: (c: ClienteCriado) => void | Promise<void>;
}) {
  const qc = useQueryClient();
  const vazio: DadosDoClienteRapido = { nome: "", empresa: "", email: "", whatsapp: "", leadId: null };
  const [dados, setDados] = useState<DadosDoClienteRapido>(vazio);
  const [tipo, setTipo] = useState<TipoDoClienteRapido>("avulso");
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const leads = useLeadsParaProposta(aberto && tipo === "lead");
  const semFicha = useMemo(() => (leads.data || []).filter((l) => !l.won_client_id), [leads.data]);

  useEffect(() => {
    if (!aberto) return;
    const d = { ...vazio, ...(inicial || {}) } as DadosDoClienteRapido;
    setDados(d);
    setTipo(tipoInicial || (d.leadId ? "lead" : "avulso"));
    setErro(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const mudar = (m: Partial<DadosDoClienteRapido>) => setDados((d) => ({ ...d, ...m }));
  const escolherLead = (l: LeadParaProposta | null) =>
    mudar(l ? { leadId: l.id, nome: l.nome, empresa: l.empresa || "", email: l.email || "", whatsapp: l.whatsapp || "" } : { leadId: null });

  const criar = async () => {
    const falta = faltaNoClienteRapido(dados);
    if (falta) {
      setErro(falta);
      return;
    }
    setCriando(true);
    setErro(null);
    try {
      const c = await criarClienteRapido({ ...dados, leadId: tipo === "lead" ? dados.leadId : null }, qc);
      onAberto(false);
      toast.success(`${c.nome} criado. Nenhum convite foi enviado.`, {
        duration: 12_000,
        action: c.email
          ? {
              label: "Enviar convite",
              onClick: () => {
                enviarConviteDoCliente({ id: c.id, nome: dados.nome.trim(), empresa: dados.empresa.trim(), email: c.email! })
                  .then(() => toast.success("Convite enviado por e-mail."))
                  .catch((e) => toast.error(e instanceof Error ? e.message : "O convite não saiu."));
              },
            }
          : undefined,
      });
      await onCriado(c);
    } catch (e) {
      // A mensagem volta para a janela e os campos ficam como estavam.
      setErro(e instanceof Error ? e.message : "O cliente não foi criado.");
    } finally {
      setCriando(false);
    }
  };

  return (
    <JanelaCentral
      aberta={aberto}
      onMudar={(v) => !criando && onAberto(v)}
      titulo={titulo}
      icone={<UserPlus className="h-4 w-4" />}
      descricao="Nada é enviado ao cliente"
      ajuda="O mínimo para começar: nome, um contato e a empresa. O cadastro passa pelo mesmo caminho do Novo cliente, mas sem e-mail de boas-vindas, sem onboarding e sem convite. O convite fica para depois: no aviso de criado (Enviar convite) ou na ficha do cliente, em Acesso."
      largura="sm"
      data-novo-cliente-rapido=""
      rodape={
        <>
          <button type="button" className={botao.discreto} onClick={() => onAberto(false)} disabled={criando}>
            Cancelar
          </button>
          <button type="button" className={botao.primario} onClick={() => void criar()} disabled={criando || (tipo === "lead" && !dados.leadId)}>
            {criando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            {criando ? "Criando..." : rotuloDoCriar}
          </button>
        </>
      }
    >
        <div className="min-w-0 space-y-3">
          <SeletorCompacto
            rotulo="Tipo do cliente"
            modo="segmentado"
            larguraTotal
            opcoes={[
              { valor: "avulso", rotulo: "Avulso" },
              { valor: "lead", rotulo: "Lead do Comercial" },
            ]}
            valor={tipo}
            onEscolher={(v) => {
              setTipo(v as TipoDoClienteRapido);
              if (v === "avulso") mudar({ leadId: null });
            }}
          />
          {tipo === "lead" && (
            <CampoDeFormulario rotulo="Lead" apoio={leads.isError ? "Os leads não foram lidos agora." : "Os dados do lead preenchem o cadastro."}>
              <select
                value={dados.leadId || ""}
                onChange={(e) => escolherLead(semFicha.find((l) => l.id === e.target.value) || null)}
                className={campo}
                aria-label="Lead do Comercial"
                disabled={leads.isLoading}
              >
                <option value="">{leads.isLoading ? "Lendo os leads..." : "Escolha o lead"}</option>
                {semFicha.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.empresa ? `${l.empresa} · ${l.nome}` : l.nome}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
          )}
          <CampoDeFormulario rotulo="Nome" obrigatorio>
            <input value={dados.nome} onChange={(e) => mudar({ nome: e.target.value })} className={campo} placeholder="Nome do contato" aria-label="Nome" />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Empresa">
            <input value={dados.empresa} onChange={(e) => mudar({ empresa: e.target.value })} className={campo} placeholder="Nome da empresa" aria-label="Empresa" />
          </CampoDeFormulario>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <CampoDeFormulario rotulo="E-mail">
              <input value={dados.email} onChange={(e) => mudar({ email: e.target.value })} type="email" className={campo} placeholder="email@empresa.com" aria-label="E-mail" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="WhatsApp">
              <input value={dados.whatsapp} onChange={(e) => mudar({ whatsapp: e.target.value })} inputMode="tel" className={campo} placeholder="(00) 00000-0000" aria-label="WhatsApp" />
            </CampoDeFormulario>
          </div>
          {erro && (
            <p role="alert" className={texto.auxiliar + " text-destructive"}>
              {erro}
            </p>
          )}
        </div>
    </JanelaCentral>
  );
}
