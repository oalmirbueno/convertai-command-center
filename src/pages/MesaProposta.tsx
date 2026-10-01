import { lazy, Suspense, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, ChevronRight, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { DialogoDeRecarga, type ConsumoDoMes } from "@/components/mesa/BarraDeCusto";
import { MesaProvider, useCatalogo, useMesa as useMesaDaPagina, type MesaValor } from "@/components/mesa/MesaContexto";
import { inicioDoMes, lerPrevisao, modeloDoPapel, type PrevisaoDoPlano } from "@/lib/mesa/api";
import { CustoCompacto } from "@/components/mesa/CustoCompacto";
import SeletorDeClientesDaMesa from "@/components/mesa/SeletorDeClientesDaMesa";
import type { ClienteBruto } from "@/components/mesa/clientesDaMesa";
import { lazyComPreCarga } from "@/lib/lazyComPreCarga";
import { useTelaCheiaDaMesa } from "@/components/mesa/TelaCheiaDaMesa";
import CascaDaMesa from "@/components/sistema/CascaDaMesa";
import BotaoDoConselho from "@/components/conselho/BotaoDoConselho";
import SeletorDeMarca, { useMarcaNaCasca } from "@/components/mesa/SeletorDeMarca";
import AreaDeTrabalho, { abrirLateralDaArea } from "@/components/sistema/AreaDeTrabalho";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, foco, juntar, superficie } from "@/components/sistema/estilos";
import { CHAVES, usePropostas, type Proposta } from "@/components/mesa-proposta/propostaApi";
import { EtapasDaMesaProposta, SeletorDaProposta } from "@/components/mesa-proposta/NaCascaDaProposta";
import { JanelasDaProposta, MenuDaProposta, MenuDaPropostaNoCelular, type PedidoDaProposta } from "@/components/mesa-proposta/AcoesDaProposta";
import { ETAPAS_DA_PROPOSTA, ehEtapaDaProposta, etapaPeloStatus, type EtapaDaProposta } from "@/components/mesa-proposta/caminhoDaProposta";
import NovaProposta from "@/components/clientes-propostas/NovaProposta";

/**
 * Mesa Proposta (/mesa-proposta, só admin e gestor), frente PRO (30/09).
 * Entra por Clientes (área Propostas: Nova proposta para cliente novo ou
 * lead, e Proposta de upsell no cliente da casa; frente PRO3, 30/09: fora do
 * seletor de mesas, a casca mostra "Clientes › Propostas"), ou pelo lead do Comercial
 * (?lead=). Mesma casca das outras mesas; o estrategista comercial fica fixo
 * ao lado (no celular, a gaveta do botão de baixo).
 * Endereço: /mesa-proposta?client=<id>&etapa=contexto|rascunho|revisao|envio|acompanhar&proposta=<id>&lead=<id>
 *
 * Frente UXS (30/09): a proposta aberta fica no seletor da casca em todas as
 * etapas (com "Nova proposta"); &nova=1 abre a nova proposta sem abrir a
 * mais recente; &foco= (uma vez) leva do "Resolver" ao ponto que conserta.
 *
 * Frente PRS (30/09), "está completa e confusa": o caminho virou cinco
 * etapas com o nome do que se faz (Conversa, Rascunho, Revisar, Enviar,
 * Acompanhar; ver caminhoDaProposta.ts), cada uma termina no próximo passo, a
 * "Nova proposta" é a mesma janela de Clientes e as ações da proposta
 * (todas as propostas, biblioteca, duplicar, modelo, arquivar, status) ficam
 * no "..." ao lado do seletor da proposta. Endereço: etapa=contexto|rascunho|
 * revisao|envio|acompanhar (os valores de antes seguem valendo).
 */

const carregarContexto = () => import("@/components/mesa-proposta/EtapaContexto");
const carregarRascunho = () => import("@/components/mesa-proposta/EtapaRascunho");
const carregarRevisao = () => import("@/components/mesa-proposta/EtapaRevisao");
const carregarEnvio = () => import("@/components/mesa-proposta/EtapaEnvio");
const carregarAcompanhar = () => import("@/components/mesa-proposta/EtapaAcompanhar");
// Mesmas chaves da pré-carga do painel (src/lib/mesa/preCarga.ts).
const EtapaContexto = lazyComPreCarga("mesa-proposta/contexto", carregarContexto);
const EtapaRascunho = lazyComPreCarga("mesa-proposta/rascunho", carregarRascunho);
const EtapaRevisao = lazyComPreCarga("mesa-proposta/revisao", carregarRevisao);
const EtapaEnvio = lazyComPreCarga("mesa-proposta/envio", carregarEnvio);
const EtapaAcompanhar = lazyComPreCarga("mesa-proposta/acompanhar", carregarAcompanhar);
const AgenteDaProposta = lazyComPreCarga("mesa-proposta/agente", () => import("@/components/mesa-proposta/AgenteDaProposta"));
const ChavesECotas = lazy(() => import("@/components/mesa/ChavesECotas"));
const ModelosDeIa = lazy(() => import("@/components/mesa/ModelosDeIa"));

export const ETAPAS_DA_MESA_PROPOSTA = ETAPAS_DA_PROPOSTA;

type Etapa = EtapaDaProposta;

const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOuNulo = (v: string | null) => (v && UUID_VALIDO.test(v) ? v : null);
const chaveOnde = (clientId: string) => `mesa-proposta:onde:${clientId}`;

function lerOnde(clientId: string): { etapa: string | null; nome: string | null } {
  try {
    const v = JSON.parse(window.localStorage.getItem(chaveOnde(clientId)) || "null");
    if (!v || typeof v !== "object") return { etapa: null, nome: null };
    return { etapa: ehEtapaDaProposta(v.etapa) ? String(v.etapa) : null, nome: typeof v.nome === "string" && v.nome ? v.nome.slice(0, 120) : null };
  } catch {
    return { etapa: null, nome: null };
  }
}

function gravarOnde(clientId: string, etapa: string, nome: string | null) {
  try {
    window.localStorage.setItem(chaveOnde(clientId), JSON.stringify({ etapa, nome }));
  } catch {
    /* armazenamento indisponível: abre sempre no Contexto */
  }
}

const elo = juntar("toque-compacto inline-flex h-9 min-w-0 shrink-0 items-center rounded-md px-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted", foco);

/** PRO3: o caminho de volta no lugar do seletor de mesa (a proposta mora em Clientes). */
export function CaminhoDasPropostas() {
  return (
    <nav aria-label="Caminho" className="flex min-w-0 shrink-0 items-center" data-caminho-da-proposta="">
      <Link to="/clientes" className={elo}>
        <Users className="mr-1.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        Clientes
      </Link>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <Link to="/clientes?propostas=1" className={elo}>
        Propostas
      </Link>
    </nav>
  );
}

function EsqueletoDoAgente() {
  return <div aria-busy="true" aria-label="Abrindo o agente" className={juntar(superficie.painel, "h-full min-h-[320px] animate-pulse")} />;
}

/** O corpo da mesa com o cliente aberto (as propostas vêm do banco pela RLS). */
function CorpoDaMesa({
  etapa,
  propostaUrl,
  leadUrl,
  nova,
  onNova,
  pedido,
  onPedidoFeito,
  etapaNaUrl,
  mudar,
  rascunhoDoAgente,
  setRascunhoDoAgente,
}: {
  etapa: Etapa;
  propostaUrl: string | null;
  leadUrl: string | null;
  /** A janela "Nova proposta" está aberta (a mesa não abre a mais recente sozinha). */
  nova: boolean;
  onNova: () => void;
  /** O que o "..." da proposta pediu (lista, biblioteca, duplicar...). */
  pedido: { tipo: PedidoDaProposta; em: number } | null;
  /** O pedido foi tratado (a casca esquece; remontar não repete). */
  onPedidoFeito: () => void;
  /** O endereço trouxe a etapa (link do agente, da carteira): a abertura automática não troca de etapa. */
  etapaNaUrl: boolean;
  mudar: (m: Record<string, string | null>, substituir?: boolean) => void;
  rascunhoDoAgente: string;
  setRascunhoDoAgente: Dispatch<SetStateAction<string>>;
}) {
  const { clientId, catalogo } = useMesaDaPagina();
  const propostas = usePropostas(clientId);
  const lista = propostas.data ? propostas.data.lista : [];
  const proposta = (propostaUrl && lista.find((p) => p.id === propostaUrl)) || null;
  // Modelo de IA escolhido na hora (papel "proposta"; sem ele, o do estrategista).
  const [modeloEscolhido, setModeloEscolhido] = useEstadoDaTela<string>("mesa-proposta:modelo", "", { validar: (v) => typeof v === "string" });
  // modeloDoPapel (frente BASE): o escolhido quando ainda está ligado; senão o padrão do papel "proposta"; senão o da estratégia.
  const modelo = modeloDoPapel(catalogo, "proposta", modeloEscolhido || null);
  const modeloId = modelo ? modelo.id : "";

  const pediuDoLead = useRef(false);
  // A etapa veio no link quando a mesa montou (a de "onde parou" chega depois e não conta).
  const etapaDoLink = useRef(etapaNaUrl);
  // Sem proposta no endereço: abre a mais recente viva (a do lead, quando veio do Comercial).
  // Pedido de proposta nova: não abre nenhuma sozinha.
  useEffect(() => {
    if (propostaUrl || nova || !propostas.data) return;
    const doLead = leadUrl ? lista.find((p) => p.lead_id === leadUrl && !p.arquivada_em) : null;
    if (leadUrl && !doLead) {
      // Veio do lead do Comercial e ele ainda não tem proposta: a janela de nova proposta abre (uma vez) com o lead.
      if (!pediuDoLead.current) {
        pediuDoLead.current = true;
        onNova();
      }
      return;
    }
    const alvo = doLead || lista.find((p) => !p.arquivada_em);
    // PRS: sem etapa no link, a enviada abre no Acompanhar (nunca no formulário do rascunho);
    // o rascunho abre onde a pessoa parou (a etapa de "onde parou" ainda pode não ter chegado ao endereço).
    const atual: Etapa = etapaNaUrl ? etapa : (lerOnde(clientId).etapa as Etapa | null) || etapa;
    if (alvo) mudar(etapaDoLink.current ? { proposta: alvo.id } : { proposta: alvo.id, etapa: etapaPeloStatus(alvo.status, atual) }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propostaUrl, propostas.data, leadUrl, nova]);

  // Abrir outra proposta: a etapa segue o status dela (a enviada no Acompanhar; o rascunho fica onde está).
  // Lê do cache: a proposta recém-duplicada já está lá antes do próximo desenho.
  const qc = useQueryClient();
  const abrir = (id: string, extra: Record<string, string | null> = {}) => {
    const cache = qc.getQueryData<{ lista: Proposta[] }>(CHAVES.propostas(clientId));
    const alvo = (cache ? cache.lista : lista).find((p) => p.id === id);
    mudar({ proposta: id, nova: null, ...(alvo ? { etapa: etapaPeloStatus(alvo.status, etapa) } : {}), ...extra });
  };
  // "Responder" de uma pergunta do estrategista: preenche a conversa (nunca envia sozinho; a mensagem tem custo).
  const responder = (pergunta: string) => {
    const linha = `Sobre: ${pergunta}`;
    setRascunhoDoAgente((r) => (r.trim() ? `${r.replace(/\s+$/, "")}\n${linha}` : linha));
    abrirLateralDaArea();
  };
  // Cada etapa remonta ao trocar de proposta: envio preparado, e-mail, prévia e foco nunca passam de uma para outra.
  const chaveDaEtapa = `${etapa}:${proposta ? proposta.id : "nenhuma"}`;

  return (
    <AreaDeTrabalho
      memoria="mesa-proposta"
      rotuloDaLateral="Estrategista comercial"
      iconeDaLateral={<BriefcaseBusiness className="h-4 w-4" />}
      rotuloDoPrincipal="Etapa da Mesa Proposta"
      principalRolavel={false}
      lateral={
        <Suspense fallback={<EsqueletoDoAgente />}>
          <AgenteDaProposta propostaId={proposta ? proposta.id : null} statusDaProposta={proposta ? proposta.status : null} modeloId={modeloId || null} modeloEscolhido={modeloEscolhido} onModelo={setModeloEscolhido} rascunho={rascunhoDoAgente} onRascunho={setRascunhoDoAgente} />
        </Suspense>
      }
    >
      <RegiaoRolavel key={etapa} modo="lg" memoria={`mesa-proposta:${clientId}:${etapa}`} className="pb-6 lg:pr-1" data-regiao-da-etapa={etapa}>
        {propostas.isLoading ? (
          <Carregando forma="aba" rotulo="Lendo as propostas" />
        ) : propostas.isError ? (
          <EstadoDeErro titulo="As propostas não foram lidas." acao={<button type="button" className={botao.secundario} onClick={() => void propostas.refetch()}>Tentar de novo</button>} />
        ) : (
          <Suspense fallback={<Carregando forma="aba" rotulo="Abrindo a etapa" />}>
            {etapa === "contexto" && <EtapaContexto key={chaveDaEtapa} proposta={proposta} propostas={lista} semTabela={!!(propostas.data && propostas.data.semTabela)} modeloId={modeloId} onModelo={setModeloEscolhido} onNova={onNova} onResponder={responder} />}
            {etapa === "rascunho" && <EtapaRascunho key={chaveDaEtapa} proposta={proposta} modeloId={modeloId} onModelo={setModeloEscolhido} />}
            {etapa === "revisao" && <EtapaRevisao key={chaveDaEtapa} proposta={proposta} />}
            {etapa === "envio" && <EtapaEnvio key={chaveDaEtapa} proposta={proposta} />}
            {etapa === "acompanhar" && <EtapaAcompanhar key={chaveDaEtapa} proposta={proposta} onAbrir={(id) => abrir(id, { etapa: "contexto" })} />}
          </Suspense>
        )}
      </RegiaoRolavel>
      <JanelasDaProposta pedido={pedido} proposta={proposta} propostas={lista} onAbrir={(id) => abrir(id)} onNova={onNova} onFeito={onPedidoFeito} />
    </AreaDeTrabalho>
  );
}

export default function MesaProposta() {
  const { profile, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const clientesQuery = useClients();
  const catalogo = useCatalogo();

  const clientIdUrl = params.get("client") || "";
  const etapaUrl = params.get("etapa");
  const etapa: Etapa = ETAPAS_DA_MESA_PROPOSTA.some((e) => e.valor === etapaUrl) ? (etapaUrl as Etapa) : "contexto";
  const propostaUrl = uuidOuNulo(params.get("proposta"));
  const leadUrl = uuidOuNulo(params.get("lead"));
  const novaUrl = params.get("nova") === "1";

  const [recargaAberta, setRecargaAberta] = useState(false);
  const [chavesAbertas, setChavesAbertas] = useState(false);
  const [modelosAbertos, setModelosAbertos] = useState(false);
  const [chavesUsadas, setChavesUsadas] = useState(false);
  const [modelosUsados, setModelosUsados] = useState(false);
  const [versaoCarteira, setVersaoCarteira] = useState(0);
  // PRS: a janela "Nova proposta" (a mesma de Clientes) e o pedido do "..." da proposta.
  const [novaAberta, setNovaAberta] = useState(novaUrl);
  const [pedido, setPedido] = useState<{ tipo: PedidoDaProposta; em: number } | null>(null);
  const telaCheia = useTelaCheiaDaMesa();

  const role = profile?.role || "";
  const isAdmin = role === "admin";
  const podeRecarregar = role === "admin" || role === "manager";

  const clientes = useMemo(
    () =>
      ((clientesQuery.data || []) as any[])
        .map((c) => ({ id: String(c.id), nome: String(c.company_name || c.full_name || "Cliente") }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [clientesQuery.data],
  );
  const clienteNaLista = clientes.find((c) => c.id === clientIdUrl) || null;
  const naoEstaNaLista = clientesQuery.isSuccess && !clientesQuery.isFetching && clientes.length > 0 && !clienteNaLista;
  const clientId = clientIdUrl && UUID_VALIDO.test(clientIdUrl) && !naoEstaNaLista ? clientIdUrl : "";
  const { marcas, marca } = useMarcaNaCasca(clientId, params.get("marca"));
  const onde = useMemo(() => (clientId ? lerOnde(clientId) : null), [clientId]);
  const nomeDoCliente = (clienteNaLista && clienteNaLista.nome) || (onde && onde.nome) || "";
  const [rascunhoDoAgente, setRascunhoDoAgente] = useEstadoDaTela<string>(`mesa-proposta:agente:rascunho:${clientId || "sem-cliente"}`, "");

  // Duas mudanças no mesmo ciclo (a abertura da proposta e a etapa de "onde parou") somam em vez de uma apagar a outra.
  const pendente = useRef<{ de: URLSearchParams; valor: URLSearchParams } | null>(null);
  const mudar = (mudancas: Record<string, string | null>, substituir = false) => {
    const base = pendente.current && pendente.current.de === params ? pendente.current.valor : params;
    const next = new URLSearchParams(base);
    Object.keys(mudancas).forEach((k) => {
      const v = mudancas[k];
      if (v) next.set(k, v);
      else next.delete(k);
    });
    pendente.current = { de: params, valor: next };
    setParams(next, { replace: substituir });
  };

  // ?nova=1 abre a janela uma vez e sai do endereço (recarregar não reabre).
  useEffect(() => {
    if (!novaUrl) return;
    setNovaAberta(true);
    mudar({ nova: null }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novaUrl]);

  // Veio do lead sem cliente no endereço: o lead ganho já aponta o cliente.
  const leadSemCliente = useQuery({
    queryKey: ["mesa-proposta", "lead", leadUrl],
    enabled: !!leadUrl && !clientIdUrl,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("commercial_leads").select("id, name, company, won_client_id").eq("id", leadUrl).maybeSingle();
      if (error) throw error;
      return data as { id: string; name: string; company: string | null; won_client_id: string | null } | null;
    },
  });
  useEffect(() => {
    const l = leadSemCliente.data;
    if (l && l.won_client_id && !clientIdUrl) mudar({ client: l.won_client_id }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadSemCliente.data]);

  // A etapa sai do endereço: "onde parou" volta pelo efeito abaixo e a proposta enviada abre no Acompanhar.
  const trocarCliente = (id: string) => {
    setPedido(null);
    mudar({ client: id, etapa: null, proposta: null, marca: null, nova: null, foco: null });
  };

  useEffect(() => {
    if (!clientId || etapaUrl) return;
    // A abertura da proposta já escolheu a etapa neste ciclo: ela vence.
    if (pendente.current && pendente.current.de === params && pendente.current.valor.get("etapa")) return;
    const o = lerOnde(clientId);
    if (o.etapa) mudar({ etapa: o.etapa }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (clientId && etapaUrl) gravarOnde(clientId, etapa, nomeDoCliente || null);
  }, [clientId, etapaUrl, etapa, nomeDoCliente]);

  const mesAtual = inicioDoMes();
  const consumo = useQuery({
    queryKey: ["mesa", "consumo", clientId, mesAtual],
    enabled: !!clientId,
    queryFn: async (): Promise<ConsumoDoMes> => {
      const { data, error } = await (supabase as any).rpc("ia_consumo_cliente", { _client_id: clientId, _mes: mesAtual });
      if (error) throw error;
      return (data || {}) as ConsumoDoMes;
    },
  });
  const previsao = useQuery({ queryKey: ["mesa", "previsao", clientId], enabled: !!clientId, queryFn: () => lerPrevisao(clientId) });
  const numeroOuNulo = (v: unknown) => (v === undefined || v === null || v === "" || !isFinite(Number(v)) ? null : Number(v));
  const saldoUsd = numeroOuNulo(consumo.data ? consumo.data.saldo_usd : null) ?? numeroOuNulo(previsao.data ? previsao.data.saldo_usd : null);
  const atualizarCusto = () => {
    void queryClient.invalidateQueries({ queryKey: ["mesa", "consumo", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "previsao", clientId] });
  };

  const valor: MesaValor | null = clientId
    ? {
        clientId,
        clientName: nomeDoCliente,
        userId: user?.id || null,
        isAdmin,
        podeRecarregar,
        saldoUsd,
        catalogo: catalogo.data || [],
        catalogoCarregando: catalogo.isLoading,
        atualizarCusto,
        abrirRecarga: () => setRecargaAberta(true),
        abrirChaves: () => {
          setChavesUsadas(true);
          setChavesAbertas(true);
        },
        abrirModelos: () => {
          setModelosUsados(true);
          setModelosAbertos(true);
        },
        versaoCarteira,
        marcas,
        marca,
      }
    : null;

  const lead = leadSemCliente.data;
  // Seletor da proposta na casca e controle do celular: a etapa segue o status (a enviada no Acompanhar).
  // A lista vem do cache (a casca não redesenha a cada mudança da lista).
  const abrirProposta = (id: string) => {
    const cache = clientId ? queryClient.getQueryData<{ lista: Proposta[] }>(CHAVES.propostas(clientId)) : undefined;
    const alvo = cache ? cache.lista.find((p) => p.id === id) : undefined;
    mudar({ proposta: id, nova: null, foco: null, ...(alvo ? { etapa: etapaPeloStatus(alvo.status, etapa) } : {}) });
  };
  const pedirNova = () => setNovaAberta(true);
  const pedir = (tipo: PedidoDaProposta) => setPedido({ tipo, em: Date.now() });
  // Lead sem ficha: abre o seletor de cliente da casca.
  const abrirSeletorDeCliente = () => {
    const alvo = document.querySelector("[data-casca-identidade] [role=\"combobox\"]") as HTMLElement | null;
    if (alvo) alvo.click();
  };

  return (
    <CascaDaMesa
      mesa="proposta"
      titulo="Mesa Proposta"
      clientId={clientId}
      telaCheia={telaCheia}
      caminho={<CaminhoDasPropostas />}
      etapasEmLinhaPropriaAte="2xl"
      marca={
        clientId ? (
          <div className="flex min-w-0 items-center">
            {marca && <SeletorDeMarca marcas={marcas} valor={marca.id} onEscolher={(id) => mudar({ marca: id, proposta: null }, true)} />}
            {/* UXS: a proposta aberta em todas as etapas (de 640 px para cima; no celular, na linha das ações). */}
            <SeletorDaProposta clientId={clientId} propostaId={propostaUrl} onAbrir={abrirProposta} onNova={pedirNova} className={juntar("hidden sm:inline-flex", marca ? "ml-2" : "")} />
            <MenuDaProposta clientId={clientId} propostaId={propostaUrl} onPedir={pedir} className="ml-1 hidden sm:inline-flex" />
          </div>
        ) : null
      }
      cliente={<SeletorDeClientesDaMesa mesa="proposta" clientesBrutos={clientesQuery.data as ClienteBruto[] | undefined} valor={clientId} nome={nomeDoCliente} carregando={clientesQuery.isLoading} onEscolher={trocarCliente} />}
      etapas={clientId ? <EtapasDaMesaProposta clientId={clientId} propostaId={propostaUrl} itens={ETAPAS_DA_MESA_PROPOSTA} valor={etapa} onEscolher={(v) => mudar({ etapa: v, foco: null })} /> : null}
      acoes={
        clientId ? (
          <>
          {/* PRS: no celular, um controle só (trocar de proposta, nova e as ações). */}
          <MenuDaPropostaNoCelular clientId={clientId} propostaId={propostaUrl} onAbrir={abrirProposta} onNova={pedirNova} onPedir={pedir} className="mr-auto sm:hidden" />
          <BotaoDoConselho
            clientId={clientId}
            origem="mesa-proposta"
            tema={`Proposta${nomeDoCliente ? ` de ${nomeDoCliente}` : ""}`}
            contexto={"A proposta comercial aberta na mesa: escopo, preço, argumento e objeções."}
            // PRO3 (adendo do dono): a sessão leva a referência da proposta aberta.
            referencia={propostaUrl ? { tipo: "proposta", id: propostaUrl } : { tipo: "proposta" }}
            onUsar={(t) => setRascunhoDoAgente(t)}
            rotuloDoUsar="Levar para o estrategista comercial"
          />
          <span aria-hidden="true" className="mx-1.5 h-4 w-px shrink-0 bg-border" />
          <CustoCompacto
            saldoUsd={saldoUsd}
            consumo={consumo.data || null}
            previsao={previsao.data || null}
            carregando={consumo.isLoading}
            podeRecarregar={podeRecarregar}
            isAdmin={isAdmin}
            onRecarregar={() => setRecargaAberta(true)}
            onChaves={() => {
              setChavesUsadas(true);
              setChavesAbertas(true);
            }}
            onModelos={() => {
              setModelosUsados(true);
              setModelosAbertos(true);
            }}
          />
          </>
        ) : null
      }
    >
      {!clientId && (
        <EstadoVazio
          icone={<BriefcaseBusiness className="h-5 w-5" />}
          titulo={lead ? `Escolha o cliente da proposta de ${lead.company || lead.name}.` : "Escolha um cliente para abrir a Mesa Proposta."}
          descricao={lead ? "Lead sem ficha: em Clientes › Propostas, Nova proposta cria o cliente na hora." : "Proposta comercial com link e aceite."}
          acao={
            <div className="flex flex-wrap items-center justify-center [&>*]:m-1">
              {/* UXS: resolve para admin e gestor sem sair daqui (a troca de cliente mantém o lead). */}
              <button type="button" className={botao.primario} onClick={abrirSeletorDeCliente}>
                Escolher o cliente
              </button>
              <Link to="/clientes?propostas=1" className={botao.secundario}>
                Ir para Clientes › Propostas
              </Link>
            </div>
          }
        />
      )}

      {valor && (
        <MesaProvider valor={valor}>
          <CorpoDaMesa key={valor.clientId} etapa={etapa} propostaUrl={propostaUrl} leadUrl={leadUrl} nova={novaAberta || novaUrl} onNova={pedirNova} pedido={pedido} onPedidoFeito={() => setPedido(null)} etapaNaUrl={!!etapaUrl} mudar={mudar} rascunhoDoAgente={rascunhoDoAgente} setRascunhoDoAgente={setRascunhoDoAgente} />
          <NovaProposta
            aberta={novaAberta}
            onAberta={setNovaAberta}
            clientes={[]}
            clienteFixo={{ id: valor.clientId, nome: valor.clientName || "Cliente" }}
            leadInicial={leadUrl || ""}
            marcaId={marca ? marca.id : null}
            podeCriarCliente={false}
          />
          {podeRecarregar && (
            <DialogoDeRecarga
              aberto={recargaAberta}
              onOpenChange={setRecargaAberta}
              clientId={valor.clientId}
              clientName={valor.clientName}
              onRecarregado={(saldoNovo) => {
                if (typeof saldoNovo === "number") {
                  queryClient.setQueryData<ConsumoDoMes>(["mesa", "consumo", clientId, mesAtual], (c) => ({ ...(c || {}), saldo_usd: saldoNovo }));
                  queryClient.setQueryData<PrevisaoDoPlano>(["mesa", "previsao", clientId], (p) => (p ? { ...p, saldo_usd: saldoNovo } : p));
                }
                atualizarCusto();
                setVersaoCarteira((v) => v + 1);
              }}
              sugestaoUsd={previsao.data?.recarga_sugerida_usd ?? null}
            />
          )}
          {isAdmin && (chavesUsadas || modelosUsados) && (
            <Suspense fallback={null}>
              {chavesUsadas && <ChavesECotas aberto={chavesAbertas} onOpenChange={setChavesAbertas} clientId={valor.clientId} clientName={valor.clientName} />}
              {modelosUsados && <ModelosDeIa aberto={modelosAbertos} onOpenChange={setModelosAbertos} />}
            </Suspense>
          )}
        </MesaProvider>
      )}
    </CascaDaMesa>
  );
}
