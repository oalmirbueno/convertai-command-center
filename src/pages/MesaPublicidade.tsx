import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { DialogoDeRecarga, type ConsumoDoMes } from "@/components/mesa/BarraDeCusto";
import { MesaProvider, useCatalogo, type MesaValor } from "@/components/mesa/MesaContexto";
import { inicioDoMes, lerPrevisao, type PrevisaoDoPlano } from "@/lib/mesa/api";
import { CustoCompacto } from "@/components/mesa/CustoCompacto";
import SeletorDeClientesDaMesa from "@/components/mesa/SeletorDeClientesDaMesa";
import type { ClienteBruto } from "@/components/mesa/clientesDaMesa";
import TrocaDeMesas from "@/components/mesa-foto/TrocaDeMesas";
import SeletorDeMarca, { useMarcaNaCasca } from "@/components/mesa/SeletorDeMarca";
import { lazyComPreCarga } from "@/lib/lazyComPreCarga";
import { BotaoDeTelaCheia, classeDaRaiz, useTelaCheiaDaMesa } from "@/components/mesa/TelaCheiaDaMesa";
import { ehEtapa, ETAPAS_DA_PUBLICIDADE, MesaPublicidadeProvider, type EtapaDaPublicidade, type MesaPublicidadeValor } from "@/components/mesa-publicidade/Comuns";
import { chaveDaCampanha, guardarCampanha, lerRascunho, useCampanha, useCampanhas, type CampanhaDePublicidade } from "@/components/mesa-publicidade/publicidadeApi";

/**
 * Mesa Publicidade (/mesa-publicidade, só equipe: admin, gestor e design):
 * dirige campanhas de produto com pessoas, ambientes e fotografia
 * profissional (kit de pesquisa da Mesa de Publicidade, 24/09). Mesma casca
 * das outras mesas: seletor de cliente, etapas, troca de mesas, saldo e tela
 * cheia. Endereço completo:
 * /mesa-publicidade?client=<id>&etapa=revisao&campanha=<id | rascunho>
 *
 * Cinco passos: 1. Campanha (produto do kit da Mesa Foto e briefing
 * versionado), 2. Direção (três territórios; a equipe aprova um), 3. Tomadas
 * (seis, pedidas à Mesa Foto), 4. Revisão (produto antes da estética) e
 * 5. Envio (Mesa e Mesa Ads, com linhagem). O agente da campanha fica à mão
 * em todas, no botão do centro da base.
 *
 * A Publicidade dirige; a Mesa Foto produz; a Mesa Ads testa. Nada de motor,
 * acervo ou carteira paralelos. Regra da fotografia: nunca escurecer a foto.
 */

const carregarCampanha = () => import("@/components/mesa-publicidade/EtapaCampanha");
const carregarDirecao = () => import("@/components/mesa-publicidade/EtapaDirecao");
const carregarTomadas = () => import("@/components/mesa-publicidade/EtapaTomadas");
const carregarRevisao = () => import("@/components/mesa-publicidade/EtapaRevisao");
const carregarEnvio = () => import("@/components/mesa-publicidade/EtapaEnvio");
// Mesmas chaves da pré-carga do painel (src/lib/mesa/preCarga.ts).
const EtapaCampanha = lazyComPreCarga("mesa-publicidade/campanha", carregarCampanha);
const EtapaDirecao = lazyComPreCarga("mesa-publicidade/direcao", carregarDirecao);
const EtapaTomadas = lazyComPreCarga("mesa-publicidade/tomadas", carregarTomadas);
const EtapaRevisao = lazyComPreCarga("mesa-publicidade/revisao", carregarRevisao);
const EtapaEnvio = lazyComPreCarga("mesa-publicidade/envio", carregarEnvio);
const AgenteDaPublicidade = lazyComPreCarga("mesa-publicidade/agente", () => import("@/components/mesa-publicidade/AgenteDaPublicidade"));
const ChavesECotas = lazy(() => import("@/components/mesa/ChavesECotas"));
const ModelosDeIa = lazy(() => import("@/components/mesa/ModelosDeIa"));

const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RASCUNHO = "rascunho";

interface OndeParou {
  etapa: string | null;
  campanha: string | null;
  nome: string | null;
}

const chaveOnde = (clientId: string) => `mesa-publicidade:onde:${clientId}`;

function lerOnde(clientId: string): OndeParou {
  try {
    const v = JSON.parse(window.localStorage.getItem(chaveOnde(clientId)) || "null");
    if (!v || typeof v !== "object") return { etapa: null, campanha: null, nome: null };
    const campanha = typeof v.campanha === "string" && (UUID_VALIDO.test(v.campanha) || v.campanha === RASCUNHO) ? v.campanha : null;
    return { etapa: ehEtapa(v.etapa) ? String(v.etapa) : null, campanha, nome: typeof v.nome === "string" ? v.nome.slice(0, 120) : null };
  } catch {
    return { etapa: null, campanha: null, nome: null };
  }
}

function gravarOnde(clientId: string, onde: OndeParou) {
  try {
    window.localStorage.setItem(chaveOnde(clientId), JSON.stringify(onde));
  } catch {
    /* sem armazenamento: abre sempre na Campanha */
  }
}

function EsqueletoDaEtapa() {
  return (
    <div aria-busy="true" aria-label="Abrindo a etapa" className="space-y-3">
      <div className="h-9 w-2/3 animate-pulse rounded-lg bg-muted sm:w-1/3" />
      <div className="h-28 animate-pulse rounded-xl bg-muted/80" />
      <div className="h-[40vh] animate-pulse rounded-xl bg-muted/60" />
    </div>
  );
}

export default function MesaPublicidade() {
  const { profile, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const clientesQuery = useClients();
  const catalogo = useCatalogo();
  const telaCheia = useTelaCheiaDaMesa();

  const clientIdUrl = params.get("client") || "";
  const etapaUrl = params.get("etapa");
  const etapa: EtapaDaPublicidade = ehEtapa(etapaUrl) ? etapaUrl : "campanha";
  const campanhaUrl = params.get("campanha") || "";
  const campanhaId = UUID_VALIDO.test(campanhaUrl) ? campanhaUrl : null;
  const emRascunho = campanhaUrl === RASCUNHO;

  const [recargaAberta, setRecargaAberta] = useState(false);
  const [chavesAbertas, setChavesAbertas] = useState(false);
  const [modelosAbertos, setModelosAbertos] = useState(false);
  const [chavesUsadas, setChavesUsadas] = useState(false);
  const [modelosUsados, setModelosUsados] = useState(false);
  const [versaoCarteira, setVersaoCarteira] = useState(0);
  const [agenteAberto, setAgenteAberto] = useState(false);
  const [pedidoAoAgente, setPedidoAoAgente] = useState<{ mensagem: string; em: number } | null>(null);
  const [rascunho, setRascunho] = useState<CampanhaDePublicidade | null>(null);

  const role = profile?.role || "";
  const isAdmin = role === "admin";
  const podeRecarregar = role === "admin" || role === "manager";

  const clientes = useMemo(
    () => ((clientesQuery.data || []) as any[]).map((c) => ({ id: String(c.id), nome: String(c.company_name || c.full_name || "Cliente") })),
    [clientesQuery.data],
  );
  const clienteNaLista = clientes.find((c) => c.id === clientIdUrl) || null;
  const naoEstaNaLista = clientesQuery.isSuccess && !clientesQuery.isFetching && clientes.length > 0 && !clienteNaLista;
  const clientId = clientIdUrl && UUID_VALIDO.test(clientIdUrl) && !naoEstaNaLista ? clientIdUrl : "";
  const onde = useMemo(() => (clientId ? lerOnde(clientId) : null), [clientId]);
  const nomeDoCliente = (clienteNaLista && clienteNaLista.nome) || (onde && onde.nome) || "";
  const { marcas, marca } = useMarcaNaCasca(clientId, params.get("marca"));

  const pendente = useRef<{ base: URLSearchParams; atual: URLSearchParams } | null>(null);
  const mudar = (mudancas: Record<string, string | null>, substituir = false) => {
    const base = pendente.current && pendente.current.base === params ? pendente.current.atual : params;
    const next = new URLSearchParams(base);
    Object.keys(mudancas).forEach((k) => {
      const v = mudancas[k];
      if (v) next.set(k, v);
      else next.delete(k);
    });
    pendente.current = { base: params, atual: next };
    setParams(next, { replace: substituir });
  };

  const trocarCliente = (id: string) => {
    const o = lerOnde(id);
    setRascunho(null);
    mudar({ client: id, etapa: o.etapa || "campanha", campanha: o.campanha, marca: null });
  };

  // Endereço só com o cliente: abre onde parou.
  useEffect(() => {
    if (!clientId || etapaUrl) return;
    const o = lerOnde(clientId);
    if (o.etapa || o.campanha) mudar({ etapa: o.etapa || "campanha", campanha: campanhaUrl || o.campanha }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (clientId && etapaUrl) gravarOnde(clientId, { etapa, campanha: campanhaUrl || null, nome: nomeDoCliente || null });
  }, [clientId, etapaUrl, etapa, campanhaUrl, nomeDoCliente]);

  // Rascunho (sem o SQL): volta da sessão do navegador.
  useEffect(() => {
    if (!clientId) return;
    setRascunho(emRascunho ? lerRascunho(clientId) : null);
  }, [clientId, emRascunho]);

  const campanhas = useCampanhas(clientId);
  const campanhaQ = useCampanha(campanhaId, clientId);
  const banco = !(campanhas.data && campanhas.data.banco === false);
  const campanha: CampanhaDePublicidade | null = campanhaId ? (campanhaQ.data && campanhaQ.data.client_id === clientId ? campanhaQ.data : null) : emRascunho ? rascunho : null;

  useEffect(
    () => {
      const id = window.setTimeout(() => {
        for (const e of [EtapaCampanha, EtapaDirecao, EtapaTomadas, EtapaRevisao, EtapaEnvio, AgenteDaPublicidade]) e.preCarregar().catch(() => undefined);
      }, 1500);
      return () => window.clearTimeout(id);
    },
    [],
  );

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
  const abrirChaves = () => {
    setChavesUsadas(true);
    setChavesAbertas(true);
  };
  const abrirModelos = () => {
    setModelosUsados(true);
    setModelosAbertos(true);
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
        abrirChaves,
        abrirModelos,
        versaoCarteira,
        marcas,
        marca,
      }
    : null;

  const valorDaPublicidade: MesaPublicidadeValor = {
    campanha,
    carregando: !!campanhaId && campanhaQ.isLoading,
    banco: banco && !emRascunho,
    abrirCampanha: (id) => mudar({ campanha: id }),
    aplicar: (c) => {
      guardarCampanha(queryClient, c);
      if (!c.id) {
        setRascunho(c);
        if (!emRascunho) mudar({ campanha: RASCUNHO }, true);
      } else {
        queryClient.setQueryData(chaveDaCampanha(c.id), c);
        if (campanhaId !== c.id) mudar({ campanha: c.id }, true);
      }
    },
    irPara: (e) => mudar({ etapa: e }),
    pedirAoAgente: (mensagem) => {
      setPedidoAoAgente({ mensagem, em: Date.now() });
      setAgenteAberto(true);
    },
  };

  return (
    <div className={`relative isolate -mx-4 space-y-5 bg-background px-4 pb-10 md:-mx-6 md:px-6 ${classeDaRaiz(telaCheia.cheia)}`}>
      <header data-cabecalho-da-mesa="" className="relative z-20 -mx-4 border-b border-border bg-background px-4 py-2 md:sticky md:-mx-6 md:top-[calc(env(safe-area-inset-top)+80px)] md:px-6">
        <h1 className="sr-only">Mesa Publicidade</h1>
        <div className="flex min-w-0 flex-wrap items-center lg:flex-nowrap">
          <div className="mr-2 flex min-w-0 flex-1 items-center lg:flex-none">
            <span className="mr-2 hidden shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-primary sm:inline">Publicidade</span>
            <SeletorDeClientesDaMesa mesa="publicidade" clientesBrutos={clientesQuery.data as ClienteBruto[] | undefined} valor={clientId} nome={nomeDoCliente} carregando={clientesQuery.isLoading} onEscolher={trocarCliente} />
          </div>
          {clientId && marca && <SeletorDeMarca marcas={marcas} valor={marca.id} onEscolher={(id) => mudar({ marca: id }, true)} className="mr-2" />}
          {clientId && (
            <nav aria-label="Etapas da Mesa Publicidade" className="order-last mt-2 w-full min-w-0 lg:order-none lg:mx-3 lg:mt-0 lg:w-auto lg:flex-1">
              <div className="grid w-full min-w-0 grid-cols-5 gap-0.5 rounded-lg bg-muted p-0.5" data-caminho-principal="">
                {ETAPAS_DA_PUBLICIDADE.map((p) => {
                  const ativo = etapa === p.valor;
                  return (
                    <button
                      key={p.valor}
                      type="button"
                      onClick={() => mudar({ etapa: p.valor })}
                      aria-current={ativo ? "page" : undefined}
                      title={p.dica}
                      className={`inline-flex min-w-0 items-center justify-center rounded-md px-1 py-1.5 text-[12.5px] font-medium transition-colors ${
                        ativo ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span className={`mr-1.5 hidden h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold sm:inline-flex ${ativo ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"}`}>
                        {p.passo}
                      </span>
                      <span className="truncate">{p.rotulo}</span>
                    </button>
                  );
                })}
              </div>
            </nav>
          )}
          {clientId && <TrocaDeMesas atual="publicidade" clientId={clientId} marcaId={marca ? marca.id : null} />}
          {clientId && (
            <CustoCompacto
              saldoUsd={saldoUsd}
              consumo={consumo.data || null}
              previsao={previsao.data || null}
              carregando={consumo.isLoading}
              podeRecarregar={podeRecarregar}
              isAdmin={isAdmin}
              onRecarregar={() => setRecargaAberta(true)}
              onChaves={abrirChaves}
              onModelos={abrirModelos}
            />
          )}
          <BotaoDeTelaCheia tela={telaCheia} />
        </div>
        {clientId && campanha && (
          <p className="mt-1.5 truncate text-[11.5px] text-muted-foreground" data-campanha-aberta="">
            Campanha: <span className="font-medium text-foreground">{campanha.nome || campanha.kit_nome || "sem nome"}</span>
            {campanha.kit_nome ? ` · produto ${campanha.kit_nome}` : ""}
            {!campanha.persistida ? " · rascunho" : ""}
          </p>
        )}
      </header>

      {!clientId && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-[14px] font-medium">Escolha um cliente para abrir a Mesa Publicidade dele.</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Cinco passos: produto e briefing, três territórios criativos, seis tomadas pedidas à Mesa Foto, revisão do produto antes da estética e envio para a Mesa e a Mesa Ads. Custo sempre à vista antes de gastar.
          </p>
        </div>
      )}

      {valor && (
        <MesaProvider valor={valor}>
          <MesaPublicidadeProvider valor={valorDaPublicidade}>
            <div key={valor.clientId} className="min-w-0">
              <Suspense fallback={<EsqueletoDaEtapa />}>
                {valorDaPublicidade.carregando ? (
                  <EsqueletoDaEtapa />
                ) : (
                  <>
                    {etapa === "campanha" && <EtapaCampanha />}
                    {etapa === "direcao" && <EtapaDirecao />}
                    {etapa === "tomadas" && <EtapaTomadas />}
                    {etapa === "revisao" && <EtapaRevisao />}
                    {etapa === "envio" && <EtapaEnvio />}
                  </>
                )}
              </Suspense>
            </div>
            <Suspense fallback={null}>
              <AgenteDaPublicidade key={`agente-${valor.clientId}`} aberto={agenteAberto} onAberto={setAgenteAberto} pedido={pedidoAoAgente} />
            </Suspense>
          </MesaPublicidadeProvider>

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
    </div>
  );
}
