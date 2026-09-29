import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { DialogoDeRecarga, type ConsumoDoMes } from "@/components/mesa/BarraDeCusto";
import { MesaProvider, useCatalogo, type MesaValor } from "@/components/mesa/MesaContexto";
import { inicioDoMes, lerPrevisao, type PrevisaoDoPlano } from "@/lib/mesa/api";
import { CustoCompacto } from "@/components/mesa/CustoCompacto";
import SeletorDeClientesDaMesa from "@/components/mesa/SeletorDeClientesDaMesa";
import type { ClienteBruto } from "@/components/mesa/clientesDaMesa";
import { lazyComPreCarga } from "@/lib/lazyComPreCarga";
import { useTelaCheiaDaMesa } from "@/components/mesa/TelaCheiaDaMesa";
import CascaDaMesa from "@/components/sistema/CascaDaMesa";
import SeletorDeMarca, { useMarcaNaCasca } from "@/components/mesa/SeletorDeMarca";
import Etapas from "@/components/sistema/Etapas";
import AreaDeTrabalho from "@/components/sistema/AreaDeTrabalho";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, juntar, superficie } from "@/components/sistema/estilos";
import { ETAPAS_DO_SITE } from "../../supabase/functions/_shared/site-metodo";
import ListaDeSites from "@/components/mesa-site/ListaDeSites";
import { useSiteAberto } from "@/components/mesa-site/siteApi";

/**
 * Mesa Site (/mesa-site, só equipe: admin, gestor e design), frente SIT
 * (30/09). Criador de sites premium por etapas, com o motor de código
 * (opencode no worker da agência), prévia ao vivo e publicação com domínio.
 * Mesma casca das outras mesas: cliente, marca, etapas, saldo e tela cheia.
 * Endereço: /mesa-site?client=<id>&marca=<id>&site=<id>&etapa=<etapa>
 *
 * O diretor de site fica fixo ao lado (lateral da AreaDeTrabalho; no celular,
 * a gaveta do botão de baixo): conversa com anexos, aprende, e a mudança que
 * a equipe pede vira trabalho do motor com o custo antes e o Parar.
 */

const carregar = {
  briefing: () => import("@/components/mesa-site/EtapaBriefing"),
  referencias: () => import("@/components/mesa-site/EtapaReferencias"),
  direcao: () => import("@/components/mesa-site/EtapaDirecao"),
  conteudo: () => import("@/components/mesa-site/EtapaConteudo"),
  imagens: () => import("@/components/mesa-site/EtapaImagens"),
  construcao: () => import("@/components/mesa-site/EtapaConstrucao"),
  revisao: () => import("@/components/mesa-site/EtapaRevisao"),
  publicacao: () => import("@/components/mesa-site/EtapaPublicacao"),
};
// Mesmas chaves da pré-carga do painel (src/lib/mesa/preCarga.ts).
const EtapaBriefing = lazyComPreCarga("mesa-site/briefing", carregar.briefing);
const EtapaReferencias = lazyComPreCarga("mesa-site/referencias", carregar.referencias);
const EtapaDirecao = lazyComPreCarga("mesa-site/direcao", carregar.direcao);
const EtapaConteudo = lazyComPreCarga("mesa-site/conteudo", carregar.conteudo);
const EtapaImagens = lazyComPreCarga("mesa-site/imagens", carregar.imagens);
const EtapaConstrucao = lazyComPreCarga("mesa-site/construcao", carregar.construcao);
const EtapaRevisao = lazyComPreCarga("mesa-site/revisao", carregar.revisao);
const EtapaPublicacao = lazyComPreCarga("mesa-site/publicacao", carregar.publicacao);
const AgenteDoSite = lazyComPreCarga("mesa-site/agente", () => import("@/components/mesa-site/AgenteDoSite"));
const ChavesECotas = lazy(() => import("@/components/mesa/ChavesECotas"));
const ModelosDeIa = lazy(() => import("@/components/mesa/ModelosDeIa"));

type Etapa = (typeof ETAPAS_DO_SITE)[number]["valor"];

const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOuNulo = (v: string | null) => (v && UUID_VALIDO.test(v) ? v : null);
const chaveOnde = (clientId: string) => `mesa-site:onde:${clientId}`;

function lerOnde(clientId: string): { etapa: string | null; nome: string | null } {
  try {
    const v = JSON.parse(window.localStorage.getItem(chaveOnde(clientId)) || "null");
    if (!v || typeof v !== "object") return { etapa: null, nome: null };
    return { etapa: ETAPAS_DO_SITE.some((e) => e.valor === v.etapa) ? String(v.etapa) : null, nome: typeof v.nome === "string" ? v.nome.slice(0, 120) : null };
  } catch {
    return { etapa: null, nome: null };
  }
}

function gravarOnde(clientId: string, etapa: string, nome: string | null) {
  try {
    window.localStorage.setItem(chaveOnde(clientId), JSON.stringify({ etapa, nome }));
  } catch {
    /* armazenamento indisponível: abre sempre no Briefing */
  }
}

export default function MesaSite() {
  const { profile, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const clientesQuery = useClients();
  const catalogo = useCatalogo();
  const telaCheia = useTelaCheiaDaMesa();

  const clientIdUrl = params.get("client") || "";
  const etapaUrl = params.get("etapa");
  const etapa: Etapa = ETAPAS_DO_SITE.some((e) => e.valor === etapaUrl) ? (etapaUrl as Etapa) : "briefing";
  const siteUrl = uuidOuNulo(params.get("site"));

  const [recargaAberta, setRecargaAberta] = useState(false);
  const [chavesAbertas, setChavesAbertas] = useState(false);
  const [modelosAbertos, setModelosAbertos] = useState(false);
  const [chavesUsadas, setChavesUsadas] = useState(false);
  const [modelosUsados, setModelosUsados] = useState(false);
  const [versaoCarteira, setVersaoCarteira] = useState(0);

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
  const { marcas, marca } = useMarcaNaCasca(clientId, params.get("marca"));
  const onde = useMemo(() => (clientId ? lerOnde(clientId) : null), [clientId]);
  const nomeDoCliente = (clienteNaLista && clienteNaLista.nome) || (onde && onde.nome) || "";
  const marcaId = marca ? marca.id : null;
  const { site, isLoading: sitesCarregando } = useSiteAberto(clientId, marcaId, siteUrl);
  const [rascunhoDoAgente, setRascunhoDoAgente] = useEstadoDaTela<string>(`mesa-site:agente:rascunho:${siteUrl || "sem-site"}`, "");

  const mudar = (mudancas: Record<string, string | null>, substituir = false) => {
    const next = new URLSearchParams(params);
    Object.keys(mudancas).forEach((k) => {
      const v = mudancas[k];
      if (v) next.set(k, v);
      else next.delete(k);
    });
    setParams(next, { replace: substituir });
  };

  const trocarCliente = (id: string) => {
    const o = lerOnde(id);
    mudar({ client: id, etapa: o.etapa || "briefing", site: null, marca: null });
  };

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

  const irPara = (e: string) => mudar({ etapa: e });

  return (
    <CascaDaMesa
      mesa="site"
      titulo="Mesa Site"
      clientId={clientId}
      telaCheia={telaCheia}
      marca={clientId && marca ? <SeletorDeMarca marcas={marcas} valor={marca.id} onEscolher={(id) => mudar({ marca: id, site: null }, true)} /> : null}
      cliente={<SeletorDeClientesDaMesa mesa="site" clientesBrutos={clientesQuery.data as ClienteBruto[] | undefined} valor={clientId} nome={nomeDoCliente} carregando={clientesQuery.isLoading} onEscolher={trocarCliente} />}
      etapas={
        clientId && site ? (
          <Etapas
            rotulo="Etapas da Mesa Site"
            numerar
            itens={ETAPAS_DO_SITE.map((e) => ({ valor: e.valor, rotulo: e.rotulo }))}
            valor={etapa}
            onEscolher={irPara}
            depois={
              <button type="button" className={juntar(botao.barra, "ml-2 max-w-[180px]")} onClick={() => mudar({ site: null })} title="Trocar de site" data-trocar-site="">
                <Globe className="mr-1 h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{site.nome}</span>
              </button>
            }
          />
        ) : null
      }
      acoes={
        clientId ? (
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
        ) : null
      }
    >
      {!clientId && <EstadoVazio icone={<Globe className="h-5 w-5" />} titulo="Escolha um cliente para abrir a Mesa Site dele." descricao="Site com prévia ao vivo e domínio." />}

      {valor && (
        <MesaProvider valor={valor}>
          {!site && (
            <RegiaoRolavel modo="lg" memoria={`mesa-site:${clientId}:sites`} className="pb-6">
              {sitesCarregando ? <Carregando forma="lista" rotulo="Lendo os sites" /> : <ListaDeSites marcaId={marcaId} onAbrir={(id, e) => mudar({ site: id, etapa: e || "briefing" })} icone={<Plus className="h-4 w-4" />} />}
            </RegiaoRolavel>
          )}
          {site && (
            <AreaDeTrabalho
              key={`${clientId}:${site.id}`}
              memoria="mesa-site"
              rotuloDaLateral="Diretor de site"
              iconeDaLateral={<Globe className="h-4 w-4" />}
              rotuloDoPrincipal="Etapa da Mesa Site"
              principalRolavel={false}
              lateral={
                <Suspense fallback={<div aria-busy="true" aria-label="Abrindo o diretor de site" className={juntar(superficie.painel, "h-full min-h-[320px] animate-pulse")} />}>
                  <AgenteDoSite site={site} rascunho={rascunhoDoAgente} onRascunho={setRascunhoDoAgente} onIrPara={irPara} />
                </Suspense>
              }
            >
              <RegiaoRolavel key={etapa} modo="lg" memoria={`mesa-site:${site.id}:${etapa}`} className="pb-6 lg:pr-1" data-regiao-da-etapa={etapa}>
                <Suspense fallback={<Carregando forma="aba" rotulo="Abrindo a etapa" />}>
                  {etapa === "briefing" && <EtapaBriefing site={site} onIrPara={irPara} />}
                  {etapa === "referencias" && <EtapaReferencias site={site} onIrPara={irPara} />}
                  {etapa === "direcao" && <EtapaDirecao site={site} onIrPara={irPara} />}
                  {etapa === "conteudo" && <EtapaConteudo site={site} onIrPara={irPara} />}
                  {etapa === "imagens" && <EtapaImagens site={site} onIrPara={irPara} />}
                  {etapa === "construcao" && <EtapaConstrucao site={site} onIrPara={irPara} />}
                  {etapa === "revisao" && <EtapaRevisao site={site} onIrPara={irPara} />}
                  {etapa === "publicacao" && <EtapaPublicacao site={site} />}
                </Suspense>
              </RegiaoRolavel>
            </AreaDeTrabalho>
          )}

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
