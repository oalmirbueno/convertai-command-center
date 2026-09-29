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
import SeletorDeMarca, { useMarcaNaCasca } from "@/components/mesa/SeletorDeMarca";
import { lazyComPreCarga } from "@/lib/lazyComPreCarga";
import { useTelaCheiaDaMesa } from "@/components/mesa/TelaCheiaDaMesa";
import CascaDaMesa from "@/components/sistema/CascaDaMesa";
import Etapas from "@/components/sistema/Etapas";
import AreaDeTrabalho from "@/components/sistema/AreaDeTrabalho";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { juntar, superficie } from "@/components/sistema/estilos";
import { abrirLateralDaArea } from "@/components/mesa-foto/lateralDaArea";
import { Megaphone } from "lucide-react";
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
 * 5. Envio (Mesa e Mesa Ads, com linhagem). O agente da campanha fica fixo
 * ao lado das etapas (lateral da AreaDeTrabalho; no celular, a gaveta do
 * botão de baixo). "Pedir ao agente" põe o pedido no campo dele e o mostra.
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
  return <Carregando forma="aba" rotulo="Abrindo a etapa" />;
}

/** Enquanto o agente baixa (primeira abertura): a casca dele, sem texto. */
function EsqueletoDoAgente() {
  return <div aria-busy="true" aria-label="Abrindo o agente" className={juntar(superficie.painel, "h-full min-h-[320px] animate-pulse")} />;
}

/** Leva o foco para o campo do agente (depois que a lateral ou a gaveta aparece). */
function focarNoAgente() {
  window.setTimeout(() => {
    try {
      const campo = document.querySelector("[data-agente-publicidade] textarea") as HTMLTextAreaElement | null;
      if (campo && campo.offsetParent !== null) {
        campo.focus();
        campo.setSelectionRange(campo.value.length, campo.value.length);
      }
    } catch {
      /* sem documento */
    }
  }, 150);
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
  // Rascunho do campo do agente, guardado por cliente (sair e voltar mantém; "pedir ao agente" cai nele).
  const [rascunhoDoAgente, setRascunhoDoAgente] = useEstadoDaTela<string>(`mesa-publicidade:agente:rascunho:${clientId || "sem-cliente"}`, "");

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
      setRascunhoDoAgente(mensagem);
      abrirLateralDaArea();
      focarNoAgente();
    },
  };

  return (
    // Casca padrão das mesas (src/components/sistema/CascaDaMesa.tsx).
    <CascaDaMesa
      mesa="publicidade"
      titulo="Mesa Publicidade"
      clientId={clientId}
      marcaId={marca ? marca.id : null}
      telaCheia={telaCheia}
      cliente={<SeletorDeClientesDaMesa mesa="publicidade" clientesBrutos={clientesQuery.data as ClienteBruto[] | undefined} valor={clientId} nome={nomeDoCliente} carregando={clientesQuery.isLoading} onEscolher={trocarCliente} />}
      marca={clientId && marca ? <SeletorDeMarca marcas={marcas} valor={marca.id} onEscolher={(id) => mudar({ marca: id }, true)} /> : null}
      etapas={
        clientId ? (
          <Etapas
            rotulo="Etapas da Mesa Publicidade"
            numerar
            itens={ETAPAS_DA_PUBLICIDADE.map((p) => ({ valor: p.valor, rotulo: p.rotulo, dica: p.dica }))}
            valor={etapa}
            onEscolher={(v) => mudar({ etapa: v })}
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
            onChaves={abrirChaves}
            onModelos={abrirModelos}
          />
        ) : null
      }
      abaixo={
        clientId && campanha ? (
          <p className="truncate text-[12px] text-muted-foreground" data-campanha-aberta="">
            Campanha: <span className="font-medium text-foreground">{campanha.nome || campanha.kit_nome || "sem nome"}</span>
            {campanha.kit_nome ? ` · produto ${campanha.kit_nome}` : ""}
            {!campanha.persistida ? " · rascunho" : ""}
          </p>
        ) : null
      }
    >

      {!clientId && (
        <EstadoVazio
          icone={<Megaphone className="h-5 w-5" />}
          titulo="Escolha um cliente para abrir a Mesa Publicidade dele."
          descricao="Campanhas de produto, com o custo antes."
        />
      )}

      {valor && (
        <MesaProvider valor={valor}>
          <MesaPublicidadeProvider valor={valorDaPublicidade}>
            {/* Área de trabalho (src/components/sistema/AreaDeTrabalho.tsx): no
                computador a etapa rola por dentro e o agente fica parado ao lado,
                com o campo sempre à vista; no celular a página rola normal e o
                agente abre em tela cheia pelo botão de baixo. */}
            <AreaDeTrabalho
              key={valor.clientId}
              memoria="mesa-publicidade"
              rotuloDaLateral="Agente da campanha"
              iconeDaLateral={<Megaphone className="h-4 w-4" />}
              rotuloDoPrincipal="Etapa da Mesa Publicidade"
              principalRolavel={false}
              lateral={
                <Suspense fallback={<EsqueletoDoAgente />}>
                  <AgenteDaPublicidade rascunho={rascunhoDoAgente} onRascunho={setRascunhoDoAgente} />
                </Suspense>
              }
            >
              {/* Uma região por etapa e cliente: trocar de etapa e voltar devolve a rolagem. */}
              <RegiaoRolavel key={etapa} modo="lg" memoria={`mesa-publicidade:${valor.clientId}:${etapa}`} className="pb-6 lg:pr-1" data-regiao-da-etapa={etapa}>
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
              </RegiaoRolavel>
            </AreaDeTrabalho>
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
    </CascaDaMesa>
  );
}
