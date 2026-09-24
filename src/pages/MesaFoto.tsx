import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { DialogoDeRecarga, type ConsumoDoMes } from "@/components/mesa/BarraDeCusto";
import { MesaProvider, useCatalogo, type MesaValor } from "@/components/mesa/MesaContexto";
import { inicioDoMes, lerPrevisao, type PrevisaoDoPlano } from "@/lib/mesa/api";
import { CustoCompacto, SeletorDeCliente } from "@/pages/MesaDoCliente";
import {
  ABAS_FUTURAS,
  ETAPAS_DA_MESA_FOTO,
  ETAPAS_DE_APOIO,
  MesaFotoProvider,
  NavDoCriar,
  PASSOS_PRINCIPAIS,
  passoDaEtapa,
  type EtapaDaMesaFoto,
  type MesaFotoValor,
} from "@/components/mesa-foto/Comuns";
import { proximoPasso, useEnsaios, useFotos, useKits } from "@/components/mesa-foto/fotoApi";
import TrocaDeMesas from "@/components/mesa-foto/TrocaDeMesas";

/**
 * Mesa Foto (/mesa-foto, só equipe: admin, gestor e design): o estúdio
 * fotográfico do cliente (docs/mesa-foto/CONTRATO.md). Mesma casca da Mesa e
 * da Mesa Ads: barra fina com o seletor de cliente, as etapas, a troca entre
 * as mesas e o saldo; embaixo, o kit e o ensaio abertos com o estado e o
 * custo. Endereço completo:
 * /mesa-foto?client=<id>&etapa=ensaio&kit=<id>&ensaio=<id>&imagem=<id>
 *
 * Caminho principal em 3 passos (pedido do dono depois do primeiro uso:
 * "ainda estou confuso"): 1. Fotos do produto (acervo), 2. O produto (kit
 * identificado pela embalagem ou foto, com referências da internet) e
 * 3. Criar (Variações, Campanha com modelo ou Preparar). O próximo passo fica
 * sempre em destaque. Revisar, Usar e Biblioteca ficam ao lado, discretos,
 * e depois de um traço fino as avançadas: Modelos (personas sintéticas) e
 * Canvas (quadro de cartões ligados), de docs/mesa-foto/MODELOS-E-CANVAS.md.
 * O Canvas carrega o React Flow só quando a aba abre. O diretor de
 * fotografia fica à mão em todas, no botão do centro da base.
 *
 * Regra da fotografia: nunca escurecer a foto para dar destaque; foto
 * sintética sempre marcada como gerada.
 */

const carregarAcervo = () => import("@/components/mesa-foto/EtapaAcervo");
const carregarKits = () => import("@/components/mesa-foto/EtapaKits");
const carregarPreparar = () => import("@/components/mesa-foto/EtapaPreparar");
const carregarEnsaio = () => import("@/components/mesa-foto/EtapaEnsaio");
const carregarRevisar = () => import("@/components/mesa-foto/EtapaRevisar");
const carregarUsar = () => import("@/components/mesa-foto/EtapaUsar");
const carregarBiblioteca = () => import("@/components/mesa-foto/EtapaBiblioteca");
const carregarCampanha = () => import("@/components/mesa-foto/EtapaCampanha");
const carregarCriar = () => import("@/components/mesa-foto/EtapaCriar");
const carregarModelos = () => import("@/components/mesa-foto/EtapaModelos");
// O Canvas (React Flow, ~60 KB) não entra na pré-carga: só baixa quando a aba abre.
const EtapaModelos = lazy(carregarModelos);
const EtapaCanvas = lazy(() => import("@/components/mesa-foto/EtapaCanvas"));
const EtapaCampanha = lazy(carregarCampanha);
const EtapaCriar = lazy(carregarCriar);
const EtapaAcervo = lazy(carregarAcervo);
const EtapaKits = lazy(carregarKits);
const EtapaPreparar = lazy(carregarPreparar);
const EtapaEnsaio = lazy(carregarEnsaio);
const EtapaRevisar = lazy(carregarRevisar);
const EtapaUsar = lazy(carregarUsar);
const EtapaBiblioteca = lazy(carregarBiblioteca);
const BarraDoEnsaio = lazy(() => import("@/components/mesa-foto/BarraDoEnsaio"));
const AgenteDiretor = lazy(() => import("@/components/mesa-foto/AgenteDiretor"));
const ChavesECotas = lazy(() => import("@/components/mesa/ChavesECotas"));
const ModelosDeIa = lazy(() => import("@/components/mesa/ModelosDeIa"));

export { ETAPAS_DA_MESA_FOTO };

const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOuNulo = (v: string | null) => (v && UUID_VALIDO.test(v) ? v : null);

interface OndeParou {
  etapa: string | null;
  kit: string | null;
  ensaio: string | null;
  nome: string | null;
}

const chaveOnde = (clientId: string) => `mesa-foto:onde:${clientId}`;

function lerOnde(clientId: string): OndeParou {
  try {
    const v = JSON.parse(window.localStorage.getItem(chaveOnde(clientId)) || "null");
    if (!v || typeof v !== "object") return { etapa: null, kit: null, ensaio: null, nome: null };
    return {
      etapa: ETAPAS_DA_MESA_FOTO.some((e) => e.valor === v.etapa) ? String(v.etapa) : null,
      kit: uuidOuNulo(typeof v.kit === "string" ? v.kit : null),
      ensaio: uuidOuNulo(typeof v.ensaio === "string" ? v.ensaio : null),
      nome: typeof v.nome === "string" && v.nome ? v.nome.slice(0, 120) : null,
    };
  } catch {
    return { etapa: null, kit: null, ensaio: null, nome: null };
  }
}

function gravarOnde(clientId: string, onde: OndeParou) {
  try {
    window.localStorage.setItem(chaveOnde(clientId), JSON.stringify(onde));
  } catch {
    /* armazenamento indisponível: abre sempre no Acervo */
  }
}

function quandoOcioso(fn: () => void): () => void {
  const w = window as any;
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(fn, { timeout: 4000 });
    return () => {
      if (typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(id);
    };
  }
  const id = window.setTimeout(fn, 1200);
  return () => window.clearTimeout(id);
}

function EsqueletoDaEtapa() {
  return (
    <div aria-busy="true" aria-label="Abrindo a etapa" className="space-y-3">
      <div className="h-9 w-2/3 animate-pulse rounded-lg bg-muted sm:w-1/3" />
      <div className="h-28 animate-pulse rounded-xl bg-muted/80" />
      <div className="h-[45vh] animate-pulse rounded-xl bg-muted/60" />
    </div>
  );
}

export default function MesaFoto() {
  const { profile, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const clientesQuery = useClients();
  const catalogo = useCatalogo();

  const clientIdUrl = params.get("client") || "";
  const etapaUrl = params.get("etapa");
  const etapa: EtapaDaMesaFoto = ETAPAS_DA_MESA_FOTO.some((e) => e.valor === etapaUrl) ? (etapaUrl as EtapaDaMesaFoto) : "acervo";
  const kitUrl = uuidOuNulo(params.get("kit"));
  const ensaioUrl = uuidOuNulo(params.get("ensaio"));
  const imagemUrl = uuidOuNulo(params.get("imagem"));

  const [recargaAberta, setRecargaAberta] = useState(false);
  const [chavesAbertas, setChavesAbertas] = useState(false);
  const [modelosAbertos, setModelosAbertos] = useState(false);
  const [chavesUsadas, setChavesUsadas] = useState(false);
  const [modelosUsados, setModelosUsados] = useState(false);
  const [versaoCarteira, setVersaoCarteira] = useState(0);
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [agenteAberto, setAgenteAberto] = useState(false);
  const [pedidoAoDiretor, setPedidoAoDiretor] = useState<{ mensagem: string; em: number } | null>(null);

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
  const onde = useMemo(() => (clientId ? lerOnde(clientId) : null), [clientId]);
  const nomeDoCliente = (clienteNaLista && clienteNaLista.nome) || (onde && onde.nome) || "";

  // Duas trocas no mesmo clique (ex.: escolher o kit e abrir o ensaio) se
  // somam: a segunda parte do endereço já mudado, não do que estava na tela.
  // Antes a segunda apagava a primeira e o kit sumia da URL.
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
    setSelecionadas([]);
    mudar({ client: id, etapa: o.etapa || "acervo", kit: o.kit, ensaio: o.ensaio, imagem: null });
  };

  // Endereço só com o cliente: abre onde parou.
  useEffect(() => {
    if (!clientId || etapaUrl) return;
    const o = lerOnde(clientId);
    if (o.etapa) mudar({ etapa: o.etapa, kit: kitUrl || o.kit, ensaio: ensaioUrl || o.ensaio }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (clientId && etapaUrl) gravarOnde(clientId, { etapa, kit: kitUrl, ensaio: ensaioUrl, nome: nomeDoCliente || null });
  }, [clientId, etapaUrl, etapa, kitUrl, ensaioUrl, nomeDoCliente]);

  // O caminho principal: o próximo passo sai do que já existe (fotos, kits, ensaio aberto).
  const fotosQ = useFotos(clientId);
  const kitsQ = useKits(clientId);
  const ensaiosQ = useEnsaios(clientId);
  const listaDeKits = kitsQ.data || [];
  const ensaioAberto = ensaioUrl ? (ensaiosQ.data || []).find((e) => e.id === ensaioUrl) || null : null;
  const proximo =
    clientId && fotosQ.isSuccess && kitsQ.isSuccess
      ? proximoPasso({ fotos: (fotosQ.data || []).length, kits: listaDeKits, kitId: kitUrl, ensaio: ensaioAberto, selecionadas: selecionadas.length })
      : null;

  // Kit ou ensaio no endereço que a lista em cache ainda não tem (gravado pelo
  // diretor ou pela função agora): relê uma vez, em vez de mostrar "nenhum".
  const relidos = useRef<string[]>([]);
  useEffect(() => {
    if (kitUrl && kitsQ.isSuccess && !kitsQ.isFetching && !listaDeKits.some((k) => k.id === kitUrl) && relidos.current.indexOf(`kit:${kitUrl}`) < 0) {
      relidos.current.push(`kit:${kitUrl}`);
      void kitsQ.refetch();
    }
    if (ensaioUrl && ensaiosQ.isSuccess && !ensaiosQ.isFetching && !ensaioAberto && relidos.current.indexOf(`ensaio:${ensaioUrl}`) < 0) {
      relidos.current.push(`ensaio:${ensaioUrl}`);
      void ensaiosQ.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kitUrl, ensaioUrl, kitsQ.dataUpdatedAt, ensaiosQ.dataUpdatedAt, kitsQ.isSuccess, ensaiosQ.isSuccess]);

  useEffect(
    () =>
      quandoOcioso(() => {
        for (const carregar of [carregarAcervo, carregarKits, carregarCriar, carregarEnsaio, carregarCampanha, carregarPreparar, carregarRevisar, carregarUsar, carregarBiblioteca, carregarModelos]) {
          carregar().catch(() => {
            /* sem rede agora: baixa quando a etapa abrir */
          });
        }
      }),
    [],
  );

  const mesAtual = inicioDoMes();
  // Mesmas chaves da Mesa e da Mesa Ads: o saldo é o mesmo nas três telas.
  const consumo = useQuery({
    queryKey: ["mesa", "consumo", clientId, mesAtual],
    enabled: !!clientId,
    queryFn: async (): Promise<ConsumoDoMes> => {
      const { data, error } = await (supabase as any).rpc("ia_consumo_cliente", { _client_id: clientId, _mes: mesAtual });
      if (error) throw error;
      return (data || {}) as ConsumoDoMes;
    },
  });
  const previsao = useQuery({
    queryKey: ["mesa", "previsao", clientId],
    enabled: !!clientId,
    queryFn: () => lerPrevisao(clientId),
  });

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
      }
    : null;

  const valorDaFoto: MesaFotoValor = {
    kitId: kitUrl,
    ensaioId: ensaioUrl,
    imagemId: imagemUrl,
    escolherKit: (id) => mudar({ kit: id }, true),
    escolherEnsaio: (id) => mudar({ ensaio: id }, true),
    irPara: (e, extras) => {
      const m: Record<string, string | null> = { etapa: e };
      if (extras && extras.imagem !== undefined) m.imagem = extras.imagem;
      if (extras && extras.kit !== undefined) m.kit = extras.kit;
      if (extras && extras.ensaio !== undefined) m.ensaio = extras.ensaio;
      mudar(m);
    },
    selecionadas,
    setSelecionadas,
    abrirAgente: () => setAgenteAberto(true),
    etapa,
    proximo,
    pedirAoDiretor: (mensagem: string) => {
      setPedidoAoDiretor({ mensagem, em: Date.now() });
      setAgenteAberto(true);
    },
  };
  const passoAtual = passoDaEtapa(etapa);
  const passoRecomendado = proximo ? passoDaEtapa(proximo.etapa) : null;
  const apoios = ETAPAS_DE_APOIO;
  const avancadas = ABAS_FUTURAS.filter((a) => a.disponivel && ETAPAS_DA_MESA_FOTO.some((e) => e.valor === a.etapa)).map((a) => ({ etapa: a.etapa as EtapaDaMesaFoto, rotulo: a.rotulo }));

  return (
    <div className="relative isolate -mx-4 space-y-5 bg-background px-4 pb-10 md:-mx-6 md:px-6">
      <header className="sticky top-0 z-20 -mx-4 border-b border-border bg-background px-4 py-2 md:-mx-6 md:top-[calc(env(safe-area-inset-top)+80px)] md:px-6">
        <h1 className="sr-only">Mesa Foto</h1>
        <div className="flex min-w-0 flex-wrap items-center lg:flex-nowrap">
          <div className="mr-2 flex min-w-0 flex-1 items-center lg:flex-none">
            <span className="mr-2 hidden shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-primary sm:inline">Foto</span>
            <SeletorDeCliente clientes={clientes} valor={clientId} nome={nomeDoCliente} carregando={clientesQuery.isLoading} onEscolher={trocarCliente} />
          </div>
          {clientId && (
            <nav aria-label="Etapas da Mesa Foto" className="order-last mt-2 flex w-full min-w-0 flex-wrap items-center lg:order-none lg:mx-3 lg:mt-0 lg:w-auto lg:flex-1">
              <div className="grid w-full min-w-0 grid-cols-3 gap-0.5 rounded-lg bg-muted p-0.5 sm:w-auto sm:flex-1" data-caminho-principal="">
                {PASSOS_PRINCIPAIS.map((p) => {
                  const ativo = !!passoAtual && passoAtual.passo === p.passo;
                  const recomendado = !ativo && !!passoRecomendado && passoRecomendado.passo === p.passo;
                  return (
                    <button
                      key={p.etapa}
                      type="button"
                      onClick={() => mudar({ etapa: p.etapa })}
                      aria-current={ativo ? "page" : undefined}
                      title={p.dica}
                      data-proximo={recomendado ? "" : undefined}
                      className={`inline-flex min-w-0 items-center justify-center rounded-md px-1 py-1.5 text-[12.5px] font-medium transition-colors ${
                        ativo ? "bg-card text-foreground shadow-sm" : recomendado ? "text-primary hover:bg-card/60" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span className={`mr-1.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${ativo || recomendado ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"}`}>
                        {p.passo}
                      </span>
                      <span className="truncate">{p.rotulo}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-1 flex w-full min-w-0 flex-wrap items-center justify-center sm:ml-1 sm:mt-0 sm:w-auto sm:shrink-0" data-etapas-de-apoio="">
                {apoios.map((e) => {
                  const ativo = etapa === e.etapa;
                  const recomendado = !ativo && !!proximo && proximo.etapa === e.etapa;
                  return (
                    <button
                      key={e.etapa}
                      type="button"
                      onClick={() => mudar({ etapa: e.etapa })}
                      aria-current={ativo ? "page" : undefined}
                      data-proximo={recomendado ? "" : undefined}
                      className={`h-8 rounded-md px-1.5 text-[12px] transition-colors ${
                        ativo ? "bg-muted font-medium text-foreground" : recomendado ? "font-medium text-primary hover:bg-muted" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {e.rotulo}
                    </button>
                  );
                })}
                {avancadas.length > 0 && <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />}
                {avancadas.map((e) => {
                  const ativo = etapa === e.etapa;
                  return (
                    <button
                      key={e.etapa}
                      type="button"
                      onClick={() => mudar({ etapa: e.etapa })}
                      aria-current={ativo ? "page" : undefined}
                      data-etapa-avancada={e.etapa}
                      className={`h-8 rounded-md px-1.5 text-[11.5px] transition-colors ${ativo ? "bg-muted font-medium text-foreground" : "text-muted-foreground/80 hover:bg-muted hover:text-foreground"}`}
                    >
                      {e.rotulo}
                    </button>
                  );
                })}
              </div>
            </nav>
          )}
          {clientId && <TrocaDeMesas atual="foto" clientId={clientId} />}
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
        </div>
        {valor && (
          <MesaProvider valor={valor}>
            <MesaFotoProvider valor={valorDaFoto}>
              <Suspense fallback={<div className="mt-2 h-5" />}>
                <BarraDoEnsaio />
              </Suspense>
            </MesaFotoProvider>
          </MesaProvider>
        )}
      </header>

      {!clientId && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-[14px] font-medium">Escolha um cliente para abrir a Mesa Foto dele.</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Três passos: as fotos do produto, o produto identificado e criar (variações, campanha com modelo ou ajuste fino). Custo sempre à vista antes de gerar.
          </p>
        </div>
      )}

      {valor && (
        <MesaProvider valor={valor}>
          <MesaFotoProvider valor={valorDaFoto}>
            <div key={valor.clientId} className="min-w-0">
              {(etapa === "ensaio" || etapa === "campanha" || etapa === "preparar") && <NavDoCriar atual={etapa} />}
              <Suspense fallback={<EsqueletoDaEtapa />}>
                {etapa === "acervo" && <EtapaAcervo />}
                {etapa === "kits" && <EtapaKits />}
                {etapa === "criar" && <EtapaCriar />}
                {etapa === "preparar" && <EtapaPreparar />}
                {etapa === "ensaio" && <EtapaEnsaio />}
                {etapa === "campanha" && <EtapaCampanha />}
                {etapa === "revisar" && <EtapaRevisar />}
                {etapa === "usar" && <EtapaUsar />}
                {etapa === "biblioteca" && <EtapaBiblioteca />}
                {etapa === "modelos" && <EtapaModelos />}
                {etapa === "canvas" && <EtapaCanvas />}
              </Suspense>
            </div>
            <Suspense fallback={null}>
              <AgenteDiretor key={`agente-${valor.clientId}`} aberto={agenteAberto} onAberto={setAgenteAberto} pedido={pedidoAoDiretor} />
            </Suspense>
          </MesaFotoProvider>

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
