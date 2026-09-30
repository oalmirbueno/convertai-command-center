import { useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, Loader2 } from "lucide-react";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, campo, texto } from "@/components/sistema/estilos";
import { useCriarProposta, useLeadsParaProposta, type LeadParaProposta } from "./propostasDaCarteira";

export type ClienteDaEscolha = { id: string; nome: string };
export type TipoDaNovaProposta = "nova" | "upsell";
/** O que a criação do cliente na hora precisa (o formulário de Novo cliente já preenchido). */
export type ClienteParaCriar = { fullName: string; company: string; email: string; phone: string; leadId: string | null };

/**
 * "Nova proposta" (frente PRO3, 30/09), na JanelaCentral (regra do dono:
 * pop-up nunca em gaveta lateral):
 * - Cliente novo: escolhe um lead do Comercial. Lead que já virou cliente abre
 *   a proposta direto; lead sem ficha (ou nenhum lead) cria o cliente na hora
 *   pelo formulário de Novo cliente que já existe, com os dados do lead.
 * - Upsell: escolhe o cliente da casa; a proposta nasce com o que ele já tem
 *   (serviços e plano) e os resultados reais.
 * Criar é sem custo: faz na hora, abre a Mesa Proposta e o toast traz o Desfazer.
 */
export default function NovaProposta({
  aberta,
  onAberta,
  clientes,
  tipoInicial = "nova",
  clienteInicial = "",
  podeCriarCliente,
  onCriarCliente,
}: {
  aberta: boolean;
  onAberta: (v: boolean) => void;
  /** Clientes da carteira (sem as empresas do grupo), para o upsell. */
  clientes: ClienteDaEscolha[];
  tipoInicial?: TipoDaNovaProposta;
  clienteInicial?: string;
  /** Só admin cria cliente (a mesma régua do botão Novo cliente). */
  podeCriarCliente: boolean;
  /** Fecha esta janela e abre o Novo cliente com os dados (a proposta nasce quando o cliente for criado). */
  onCriarCliente: (dados: ClienteParaCriar) => void;
}) {
  const [tipo, setTipo] = useState<TipoDaNovaProposta>(tipoInicial);
  const [leadId, setLeadId] = useState("");
  const [clienteId, setClienteId] = useState(clienteInicial);
  const leads = useLeadsParaProposta(aberta);
  const { criar, criando } = useCriarProposta();

  useEffect(() => {
    if (!aberta) return;
    setTipo(tipoInicial);
    setClienteId(clienteInicial);
    setLeadId("");
  }, [aberta, tipoInicial, clienteInicial]);

  const lead: LeadParaProposta | null = useMemo(() => (leads.data || []).find((l) => l.id === leadId) || null, [leads.data, leadId]);
  const ordenados = useMemo(() => clientes.slice().sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), [clientes]);

  const criarParaLeadComCliente = async () => {
    if (!lead || !lead.won_client_id) return;
    const id = await criar({ clientId: lead.won_client_id, leadId: lead.id, tipo: "nova" });
    if (id) onAberta(false);
  };
  const criarUpsell = async () => {
    if (!clienteId) return;
    const id = await criar({ clientId: clienteId, tipo: "upsell" });
    if (id) onAberta(false);
  };
  const criarCliente = () => {
    onCriarCliente({
      fullName: lead ? lead.nome : "",
      company: lead ? lead.empresa || lead.nome : "",
      email: lead ? lead.email || "" : "",
      phone: lead ? lead.whatsapp || "" : "",
      leadId: lead ? lead.id : null,
    });
  };

  const ocupado = !!criando;
  const leadJaCliente = !!(lead && lead.won_client_id);

  return (
    <JanelaCentral
      aberta={aberta}
      onMudar={(v) => !ocupado && onAberta(v)}
      titulo="Nova proposta"
      icone={<BriefcaseBusiness className="h-4 w-4" />}
      descricao={tipo === "upsell" ? "Upsell: cliente da casa" : "Cliente novo"}
      ajuda="Cliente novo: escolha o lead do Comercial (se já virou cliente, a proposta abre nele) ou crie o cliente agora, sem mandar nada para ele. Upsell: a proposta nasce com o que o cliente já tem (serviços e plano) e os resultados reais. Criar não custa nada e o aviso traz o Desfazer."
      largura="sm"
      data-nova-proposta=""
      rodape={
        <>
          <button type="button" className={botao.discreto} onClick={() => onAberta(false)} disabled={ocupado}>
            Cancelar
          </button>
          {tipo === "upsell" ? (
            <button type="button" className={botao.primario} onClick={() => void criarUpsell()} disabled={!clienteId || ocupado}>
              {ocupado && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              Criar proposta de upsell
            </button>
          ) : leadJaCliente ? (
            <button type="button" className={botao.primario} onClick={() => void criarParaLeadComCliente()} disabled={ocupado}>
              {ocupado && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              Criar proposta
            </button>
          ) : (
            <button type="button" className={botao.primario} onClick={criarCliente} disabled={!podeCriarCliente || ocupado}>
              Criar o cliente e seguir
            </button>
          )}
        </>
      }
    >
        <div className="min-w-0 space-y-4">
          <SeletorCompacto
            rotulo="Tipo da proposta"
            modo="segmentado"
            larguraTotal
            opcoes={[
              { valor: "nova", rotulo: "Cliente novo" },
              { valor: "upsell", rotulo: "Upsell" },
            ]}
            valor={tipo}
            onEscolher={(v) => setTipo(v as TipoDaNovaProposta)}
          />
          {tipo === "nova" ? (
            <>
              <CampoDeFormulario rotulo="Lead do Comercial" apoio={leads.isError ? "Os leads não foram lidos agora." : lead ? (leadJaCliente ? "Já é cliente: a proposta abre nele." : "Sem ficha ainda: o cliente é criado com estes dados.") : "Opcional"}>
                <select value={leadId} onChange={(e) => setLeadId(e.target.value)} className={campo} disabled={leads.isLoading} aria-label="Lead do Comercial">
                  <option value="">{leads.isLoading ? "Lendo os leads..." : "Sem lead (criar o cliente do zero)"}</option>
                  {(leads.data || []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.empresa ? `${l.empresa} · ${l.nome}` : l.nome}
                      {l.won_client_id ? " (já é cliente)" : ""}
                    </option>
                  ))}
                </select>
              </CampoDeFormulario>
              {!leadJaCliente && !podeCriarCliente && <p className={texto.auxiliar}>Só o admin cria cliente. Escolha um lead que já é cliente ou peça o cadastro.</p>}
            </>
          ) : (
            <CampoDeFormulario rotulo="Cliente da casa">
              <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className={campo} aria-label="Cliente do upsell">
                <option value="">Escolha o cliente</option>
                {ordenados.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
          )}
        </div>
    </JanelaCentral>
  );
}
