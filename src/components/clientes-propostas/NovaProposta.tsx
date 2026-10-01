import { useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, Loader2 } from "lucide-react";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, campo, texto } from "@/components/sistema/estilos";
import { useModelosDeProposta } from "@/components/mesa-proposta/propostaApi";
import MaisOpcoes from "@/components/mesa-proposta/MaisOpcoes";
import { useCriarProposta, useLeadsParaProposta, type LeadParaProposta } from "./propostasDaCarteira";

export type ClienteDaEscolha = { id: string; nome: string };
/**
 * Para quem é a proposta: "nova" = cliente novo (do lead ou cadastrado agora),
 * "casa" = venda nova para quem já é cliente, "upsell" = cliente da casa a
 * partir do que ele já tem.
 */
export type TipoDaNovaProposta = "nova" | "casa" | "upsell";
/** O que a criação do cliente na hora precisa (o formulário de Novo cliente já preenchido). */
export type ClienteParaCriar = { fullName: string; company: string; email: string; phone: string; leadId: string | null; titulo?: string; modeloId?: string | null };

/**
 * "Nova proposta": a MESMA janela central em todo lugar (frente PRS, 30/09).
 * Antes eram três caminhos diferentes (a janela de Clientes com Cliente novo
 * e Upsell, o formulário dentro da Mesa com projeto, modelo e lead, e os
 * botões da ficha que criavam direto). Agora:
 * - "Cliente novo": o lead do Comercial. Lead que já virou cliente abre a
 *   proposta nele; lead sem ficha (ou nenhum) cria o cliente na hora pelo
 *   formulário de Novo cliente, com os dados do lead.
 * - "Cliente da casa": venda nova para quem já é cliente.
 * - "Upsell": cliente da casa; a proposta nasce com o que ele já tem
 *   (serviços e plano) e os resultados reais.
 * O projeto (título) vale para as três; o modelo de proposta e o lead de uma
 * venda da casa ficam em "Mais opções". Com `clienteFixo` (Mesa e ficha) o
 * cliente já está escolhido e só sobram "Venda nova" e "Upsell".
 * Criar é sem custo: faz na hora, abre a Mesa Proposta e o toast traz o Desfazer.
 */
export default function NovaProposta({
  aberta,
  onAberta,
  clientes,
  tipoInicial = "nova",
  clienteInicial = "",
  clienteFixo = null,
  leadInicial = "",
  marcaId = null,
  podeCriarCliente,
  onCriarCliente,
  onAbrir,
}: {
  aberta: boolean;
  onAberta: (v: boolean) => void;
  /** Clientes da carteira (sem as empresas do grupo), para a venda da casa e o upsell. */
  clientes: ClienteDaEscolha[];
  tipoInicial?: TipoDaNovaProposta;
  clienteInicial?: string;
  /** Cliente já escolhido (Mesa Proposta e ficha do cliente): some o "Cliente novo" e a escolha do cliente. */
  clienteFixo?: ClienteDaEscolha | null;
  /** Lead que veio no endereço (?lead= do Comercial). */
  leadInicial?: string;
  /** Marca aberta na mesa (a proposta nasce com a logo e as cores dela). */
  marcaId?: string | null;
  /** Só admin cria cliente (a mesma régua do botão Novo cliente). */
  podeCriarCliente: boolean;
  /** Fecha esta janela e abre o Novo cliente com os dados (a proposta nasce quando o cliente for criado). */
  onCriarCliente?: (dados: ClienteParaCriar) => void;
  /** Troca a navegação depois de criar (a ficha fecha antes). */
  onAbrir?: (caminho: string) => void | Promise<void>;
}) {
  const inicial: TipoDaNovaProposta = clienteFixo && tipoInicial === "nova" ? "casa" : tipoInicial;
  const [tipo, setTipo] = useState<TipoDaNovaProposta>(inicial);
  const [leadId, setLeadId] = useState(leadInicial);
  const [clienteId, setClienteId] = useState(clienteFixo ? clienteFixo.id : clienteInicial);
  const [titulo, setTitulo] = useState("");
  const [modeloId, setModeloId] = useState("");
  const leads = useLeadsParaProposta(aberta);
  const modelos = useModelosDeProposta();
  const { criar, criando } = useCriarProposta(onAbrir);

  useEffect(() => {
    if (!aberta) return;
    setTipo(clienteFixo && tipoInicial === "nova" ? "casa" : tipoInicial);
    setClienteId(clienteFixo ? clienteFixo.id : clienteInicial);
    setLeadId(leadInicial);
    setTitulo("");
    setModeloId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta, tipoInicial, clienteInicial, clienteFixo ? clienteFixo.id : "", leadInicial]);

  const lead: LeadParaProposta | null = useMemo(() => (leads.data || []).find((l) => l.id === leadId) || null, [leads.data, leadId]);
  const ordenados = useMemo(() => clientes.slice().sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), [clientes]);
  // Venda da casa: os leads ganhos por este cliente vêm primeiro (nada é escolhido sozinho).
  const leadsDaCasa = useMemo(() => {
    const todos = leads.data || [];
    return todos.filter((l) => l.won_client_id === clienteId).concat(todos.filter((l) => l.won_client_id !== clienteId));
  }, [leads.data, clienteId]);

  const extras = { titulo, modeloId: modeloId || null, marcaId };
  const fechar = (id: string | null) => {
    if (id) onAberta(false);
  };
  const criarParaLeadComCliente = async () => {
    if (!lead || !lead.won_client_id) return;
    fechar(await criar({ clientId: lead.won_client_id, leadId: lead.id, tipo: "nova", ...extras }));
  };
  const criarDaCasa = async () => {
    if (!clienteId) return;
    fechar(await criar({ clientId: clienteId, leadId: leadId || null, tipo: "nova", ...extras }));
  };
  const criarUpsell = async () => {
    if (!clienteId) return;
    fechar(await criar({ clientId: clienteId, tipo: "upsell", ...extras }));
  };
  const criarCliente = () => {
    if (!onCriarCliente) return;
    onCriarCliente({
      fullName: lead ? lead.nome : "",
      company: lead ? lead.empresa || lead.nome : "",
      email: lead ? lead.email || "" : "",
      phone: lead ? lead.whatsapp || "" : "",
      leadId: lead ? lead.id : null,
      ...(titulo.trim() ? { titulo: titulo.trim() } : {}),
      ...(modeloId ? { modeloId } : {}),
    });
  };

  const ocupado = !!criando;
  const leadJaCliente = !!(lead && lead.won_client_id);
  const abas = clienteFixo
    ? [
        { valor: "casa", rotulo: "Venda nova" },
        { valor: "upsell", rotulo: "Upsell" },
      ]
    : [
        { valor: "nova", rotulo: "Cliente novo" },
        { valor: "casa", rotulo: "Cliente da casa" },
        { valor: "upsell", rotulo: "Upsell" },
      ];
  const descricao = clienteFixo ? clienteFixo.nome : tipo === "upsell" ? "Upsell: cliente da casa" : tipo === "casa" ? "Venda nova: cliente da casa" : "Cliente novo";
  const escolhaDoCliente = !clienteFixo && tipo !== "nova";

  return (
    <JanelaCentral
      aberta={aberta}
      onMudar={(v) => !ocupado && onAberta(v)}
      titulo="Nova proposta"
      icone={<BriefcaseBusiness className="h-4 w-4" />}
      descricao={descricao}
      ajuda="Cliente novo: escolha o lead do Comercial (se já virou cliente, a proposta abre nele) ou crie o cliente agora, sem mandar nada para ele. Cliente da casa: venda nova para quem já é cliente. Upsell: a proposta nasce com o que o cliente já tem (serviços e plano) e os resultados reais. Depois de criar, a mesa abre na Conversa (no upsell, no Rascunho). Criar não custa nada e o aviso traz o Desfazer."
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
          ) : tipo === "casa" ? (
            <button type="button" className={botao.primario} onClick={() => void criarDaCasa()} disabled={!clienteId || ocupado}>
              {ocupado && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              Criar proposta
            </button>
          ) : leadJaCliente ? (
            <button type="button" className={botao.primario} onClick={() => void criarParaLeadComCliente()} disabled={ocupado}>
              {ocupado && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              Criar proposta
            </button>
          ) : (
            <button type="button" className={botao.primario} onClick={criarCliente} disabled={!podeCriarCliente || !onCriarCliente || ocupado}>
              Criar o cliente e seguir
            </button>
          )}
        </>
      }
    >
      <div className="min-w-0 space-y-4">
        <SeletorCompacto rotulo="Para quem é a proposta" modo="segmentado" larguraTotal opcoes={abas} valor={tipo} onEscolher={(v) => setTipo(v as TipoDaNovaProposta)} />
        {tipo === "nova" && (
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
        )}
        {escolhaDoCliente && (
          <CampoDeFormulario rotulo={tipo === "upsell" ? "Cliente do upsell" : "Cliente da casa"}>
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className={campo} aria-label={tipo === "upsell" ? "Cliente do upsell" : "Cliente da proposta"}>
              <option value="">Escolha o cliente</option>
              {ordenados.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
        )}
        <CampoDeFormulario rotulo="Projeto" apoio="Opcional: vira o título da proposta">
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} placeholder={tipo === "upsell" ? "Ex.: Tráfego pago" : "Ex.: Identidade visual e redes"} className={campo} aria-label="Projeto" />
        </CampoDeFormulario>
        <MaisOpcoes chave="nova-proposta:mais" resumo={[modeloId ? "modelo escolhido" : "modelo padrão", tipo === "casa" && leadId ? "com lead" : ""].filter(Boolean).join(" · ")}>
          <CampoDeFormulario rotulo="Modelo de proposta">
            <select value={modeloId} onChange={(e) => setModeloId(e.target.value)} className={campo} aria-label="Modelo de proposta">
              <option value="">Padrão da agência</option>
              {(modelos.data || []).map((m) => (
                <option key={m.id || m.nome} value={m.id || ""}>
                  {m.nome}
                  {m.padrao ? " (padrão)" : ""}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
          {tipo === "casa" && (
            <CampoDeFormulario rotulo="Lead desta venda" apoio="Opcional: liga a proposta ao funil do Comercial">
              <select value={leadId} onChange={(e) => setLeadId(e.target.value)} className={campo} aria-label="Lead desta venda">
                <option value="">Sem lead</option>
                {leadsDaCasa.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.empresa ? `${l.empresa} (${l.nome})` : l.nome}
                    {l.won_client_id && l.won_client_id === clienteId ? " (ganho deste cliente)" : ""}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
          )}
        </MaisOpcoes>
      </div>
    </JanelaCentral>
  );
}
