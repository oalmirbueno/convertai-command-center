import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
import { ETAPAS_DA_MESA_VIDEOS, etapaValida, type EtapaDaMesaVideos } from "@/components/mesa-videos/Comuns";

/**
 * Mesa Vídeos (/mesa-videos, só equipe: admin, gestor e design), Frente V2
 * (docs/mesa-videos/CONTRATO.md). Mesma casca das outras mesas: barra fina
 * com o seletor de cliente, as etapas, a troca entre as mesas, o saldo e a
 * tela cheia. Endereço: /mesa-videos?client=<id>&etapa=edicao
 *
 * Etapas: Acervo (fotos que servem a vídeo, vindas da Mesa Foto, e as
 * gravações brutas), História (as cenas do mesmo Canvas, com "Animar cena"
 * como pedido preparado), Roteiro e cenas (roteiros aprovados da Mesa
 * Roteiros, só pelo roteiro_id), Edição (organizador de takes, legenda e o
 * pacote para editar) e Versões (memória por vídeo). Abrir a mesa só lê:
 * nenhuma ação gasta sem o clique da equipe.
 */

const carregarAcervo = () => import("@/components/mesa-videos/EtapaAcervo");
const carregarHistoria = () => import("@/components/mesa-videos/EtapaHistoria");
const carregarRoteiros = () => import("@/components/mesa-videos/EtapaRoteiros");
const carregarEdicao = () => import("@/components/mesa-videos/EtapaEdicao");
const carregarMemoria = () => import("@/components/mesa-videos/EtapaMemoria");
// Mesmas chaves da pré-carga do painel (src/lib/mesa/preCarga.ts).
const EtapaAcervo = lazyComPreCarga("mesa-videos/acervo", carregarAcervo);
const EtapaHistoria = lazyComPreCarga("mesa-videos/historia", carregarHistoria);
const EtapaRoteiros = lazyComPreCarga("mesa-videos/roteiros", carregarRoteiros);
const EtapaEdicao = lazyComPreCarga("mesa-videos/edicao", carregarEdicao);
const EtapaMemoria = lazyComPreCarga("mesa-videos/memoria", carregarMemoria);
const ChavesECotas = lazy(() => import("@/components/mesa/ChavesECotas"));
const ModelosDeIa = lazy(() => import("@/components/mesa/ModelosDeIa"));

export { ETAPAS_DA_MESA_VIDEOS };

const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const chaveOnde = (clientId: string) => `mesa-videos:onde:${clientId}`;

function lerOnde(clientId: string): { etapa: string | null; nome: string | null } {
  try {
    const v = JSON.parse(window.localStorage.getItem(chaveOnde(clientId)) || "null");
    if (!v || typeof v !== "object") return { etapa: null, nome: null };
    return {
      etapa: ETAPAS_DA_MESA_VIDEOS.some((e) => e.valor === v.etapa) ? String(v.etapa) : null,
      nome: typeof v.nome === "string" && v.nome ? v.nome.slice(0, 120) : null,
    };
  } catch {
    return { etapa: null, nome: null };
  }
}

function gravarOnde(clientId: string, etapa: string, nome: string | null) {
  try {
    window.localStorage.setItem(chaveOnde(clientId), JSON.stringify({ etapa, nome }));
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

export default function MesaVideos() {
  const { profile, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const clientesQuery = useClients();
  const catalogo = useCatalogo();

  const clientIdUrl = params.get("client") || "";
  const etapaUrl = params.get("etapa");
  const etapa: EtapaDaMesaVideos = etapaValida(etapaUrl);

  const [recargaAberta, setRecargaAberta] = useState(false);
  const [chavesAbertas, setChavesAbertas] = useState(false);
  const [modelosAbertos, setModelosAbertos] = useState(false);
  const [chavesUsadas, setChavesUsadas] = useState(false);
  const [modelosUsados, setModelosUsados] = useState(false);
  const [versaoCarteira, setVersaoCarteira] = useState(0);
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
  const onde = useMemo(() => (clientId ? lerOnde(clientId) : null), [clientId]);
  const nomeDoCliente = (clienteNaLista && clienteNaLista.nome) || (onde && onde.nome) || "";
  const { marcas, marca } = useMarcaNaCasca(clientId, params.get("marca"));

  const mudar = (mudancas: Record<string, string | null>, substituir = false) => {
    const next = new URLSearchParams(params);
    Object.keys(mudancas).forEach((k) => {
      const v = mudancas[k];
      if (v) next.set(k, v);
      else next.delete(k);
    });
    setParams(next, { replace: substituir });
  };

  // Troca de cliente: limpa o que era do anterior antes de carregar o novo (a etapa remonta pela chave).
  const trocarCliente = (id: string) => {
    const o = lerOnde(id);
    mudar({ client: id, etapa: o.etapa || "acervo", marca: null });
  };

  useEffect(() => {
    if (!clientId || etapaUrl) return;
    const o = lerOnde(clientId);
    if (o.etapa) mudar({ etapa: o.etapa }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (clientId && etapaUrl) gravarOnde(clientId, etapa, nomeDoCliente || null);
  }, [clientId, etapaUrl, etapa, nomeDoCliente]);

  useEffect(
    () =>
      quandoOcioso(() => {
        for (const e of [EtapaAcervo, EtapaHistoria, EtapaRoteiros, EtapaEdicao, EtapaMemoria]) {
          e.preCarregar().catch(() => {
            /* sem rede agora: baixa quando a etapa abrir */
          });
        }
      }),
    [],
  );

  const mesAtual = inicioDoMes();
  // Mesmas chaves das outras mesas: o saldo é o mesmo em todas.
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
        marcas,
        marca,
      }
    : null;

  return (
    <div className={`relative isolate -mx-4 space-y-5 bg-background px-4 pb-10 md:-mx-6 md:px-6 ${classeDaRaiz(telaCheia.cheia)}`}>
      <header data-cabecalho-da-mesa="" className="relative z-20 -mx-4 border-b border-border bg-background px-4 py-2 md:sticky md:-mx-6 md:top-[calc(env(safe-area-inset-top)+80px)] md:px-6">
        <h1 className="sr-only">Mesa Vídeos</h1>
        <div className="flex min-w-0 flex-wrap items-center lg:flex-nowrap">
          <div className="mr-2 flex min-w-0 flex-1 items-center lg:flex-none">
            <span className="mr-2 hidden shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-primary sm:inline">Vídeos</span>
            <SeletorDeClientesDaMesa mesa="videos" clientesBrutos={clientesQuery.data as ClienteBruto[] | undefined} valor={clientId} nome={nomeDoCliente} carregando={clientesQuery.isLoading} onEscolher={trocarCliente} />
          </div>
          {clientId && marca && <SeletorDeMarca marcas={marcas} valor={marca.id} onEscolher={(id) => mudar({ marca: id }, true)} className="mr-2" />}
          {clientId && (
            <nav
              aria-label="Etapas da Mesa Vídeos"
              className="order-last mt-2 grid w-full grid-cols-3 gap-0.5 rounded-lg bg-muted p-0.5 sm:grid-cols-5 lg:order-none lg:mx-3 lg:mt-0 lg:flex lg:w-auto lg:min-w-0 lg:flex-1"
            >
              {ETAPAS_DA_MESA_VIDEOS.map((e, i) => (
                <button
                  key={e.valor}
                  type="button"
                  onClick={() => mudar({ etapa: e.valor })}
                  aria-current={etapa === e.valor ? "page" : undefined}
                  title={e.dica}
                  className={`min-w-0 truncate rounded-md px-1 py-1.5 text-[12px] font-medium transition-colors lg:flex-auto lg:px-1.5 ${
                    etapa === e.valor ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="mr-1 hidden text-[10.5px] text-muted-foreground sm:inline lg:hidden 2xl:inline">{i + 1}</span>
                  {e.rotulo}
                </button>
              ))}
            </nav>
          )}
          {clientId && <TrocaDeMesas atual="videos" clientId={clientId} marcaId={marca ? marca.id : null} />}
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
      </header>

      {!clientId && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-[14px] font-medium">Escolha um cliente para abrir a Mesa Vídeos dele.</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Fotos de personagem, clone, produto e cenas da Mesa Foto, as gravações brutas, a História do Canvas, o pacote para editar e as versões de cada vídeo. Nada gasta sem o seu clique.
          </p>
        </div>
      )}

      {valor && (
        <MesaProvider valor={valor}>
          <div key={marca ? `${valor.clientId}:${marca.id}` : valor.clientId} className="min-w-0">
            <Suspense fallback={<EsqueletoDaEtapa />}>
              {etapa === "acervo" && <EtapaAcervo />}
              {etapa === "historia" && <EtapaHistoria />}
              {etapa === "roteiros" && <EtapaRoteiros />}
              {etapa === "edicao" && <EtapaEdicao />}
              {etapa === "memoria" && <EtapaMemoria />}
            </Suspense>
          </div>

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
