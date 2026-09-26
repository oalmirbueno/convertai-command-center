import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Scissors } from "lucide-react";
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
import { useTelaCheiaDaMesa } from "@/components/mesa/TelaCheiaDaMesa";
import CascaDaMesa from "@/components/sistema/CascaDaMesa";
import Etapas from "@/components/sistema/Etapas";
import AreaDeTrabalho from "@/components/sistema/AreaDeTrabalho";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";

/**
 * Casca comum da Mesa Vídeos (geração) e da Mesa Edição (frente E2, 26/09):
 * a mesma barra das outras mesas (seletor de mesa e de cliente, marca, etapas,
 * saldo e tela cheia), "onde parou" por cliente e a área de trabalho com o
 * agente fixo ao lado (no celular, botão que abre em tela cheia). Cada página
 * diz as etapas, o que mostrar em cada uma e o agente. Abrir só lê: nada gasta
 * sem o clique da equipe.
 */

export type QualMesaDeVideo = "videos" | "edicao";

export interface EtapaDaMesaDeVideo {
  valor: string;
  rotulo: string;
  dica?: string;
}

/** Ir para outra etapa (com parâmetros extras no endereço, ex.: a cena escolhida). */
export type IrPara = (etapa: string, extras?: Record<string, string | null>) => void;

export interface PropsDoAgenteDaMesa {
  mesa: QualMesaDeVideo;
  etapa: string;
  irPara: IrPara;
}

const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ChavesECotas = lazy(() => import("@/components/mesa/ChavesECotas"));
const ModelosDeIa = lazy(() => import("@/components/mesa/ModelosDeIa"));

function lerOnde(chave: string, etapas: readonly EtapaDaMesaDeVideo[]): { etapa: string | null; nome: string | null } {
  try {
    const v = JSON.parse(window.localStorage.getItem(chave) || "null");
    if (!v || typeof v !== "object") return { etapa: null, nome: null };
    return {
      etapa: etapas.some((e) => e.valor === v.etapa) ? String(v.etapa) : null,
      nome: typeof v.nome === "string" && v.nome ? v.nome.slice(0, 120) : null,
    };
  } catch {
    return { etapa: null, nome: null };
  }
}

function gravarOnde(chave: string, etapa: string, nome: string | null) {
  try {
    window.localStorage.setItem(chave, JSON.stringify({ etapa, nome }));
  } catch {
    /* armazenamento indisponível: abre sempre na primeira etapa */
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

export default function MesaDeVideo({
  mesa,
  titulo,
  etapas,
  etapaValida,
  prefixoOnde,
  vazio,
  preCarregar,
  Agente,
  rotuloDoAgente,
  antesDaEtapa,
  children,
}: {
  mesa: QualMesaDeVideo;
  titulo: string;
  etapas: readonly EtapaDaMesaDeVideo[];
  etapaValida: (v: string | null) => string;
  /** Chave do "onde parou" (ex.: "mesa-videos:onde:"), a mesma da pré-carga. */
  prefixoOnde: string;
  vazio: { titulo: string; descricao: string };
  /** Etapas (lazy) para baixar no tempo ocioso. */
  preCarregar: Array<{ preCarregar: () => Promise<unknown> }>;
  Agente: ComponentType<PropsDoAgenteDaMesa>;
  rotuloDoAgente: string;
  /** Endereço antigo que precisa ir para outro lugar (devolve true quando cuidou). */
  antesDaEtapa?: (etapaUrl: string | null, clientId: string) => boolean;
  /** A etapa aberta. */
  children: (etapa: string, irPara: IrPara) => ReactNode;
}) {
  const { profile, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const clientesQuery = useClients();
  const catalogo = useCatalogo();

  const clientIdUrl = params.get("client") || "";
  const etapaUrl = params.get("etapa");
  const etapa = etapaValida(etapaUrl);

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
  const chaveOnde = (id: string) => `${prefixoOnde}${id}`;
  const onde = useMemo(() => (clientId ? lerOnde(`${prefixoOnde}${clientId}`, etapas) : null), [clientId, prefixoOnde, etapas]);
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

  const irPara: IrPara = (e, extras = {}) => mudar({ ...extras, etapa: e });

  // Troca de cliente: limpa o que era do anterior (a etapa remonta pela chave).
  const trocarCliente = (id: string) => {
    const o = lerOnde(chaveOnde(id), etapas);
    mudar({ client: id, etapa: o.etapa || etapas[0].valor, marca: null, origem: null });
  };

  const [redirecionando, setRedirecionando] = useState(false);
  useEffect(() => {
    if (!clientId) return;
    if (antesDaEtapa && antesDaEtapa(etapaUrl, clientId)) {
      setRedirecionando(true);
      return;
    }
    if (etapaUrl && etapaUrl !== etapa) {
      mudar({ etapa }, true);
      return;
    }
    if (etapaUrl) return;
    const o = lerOnde(chaveOnde(clientId), etapas);
    if (o.etapa) mudar({ etapa: o.etapa }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, etapaUrl]);

  useEffect(() => {
    if (clientId && etapaUrl && etapaUrl === etapa) gravarOnde(chaveOnde(clientId), etapa, nomeDoCliente || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, etapaUrl, etapa, nomeDoCliente]);

  useEffect(
    () =>
      quandoOcioso(() => {
        for (const e of preCarregar) {
          e.preCarregar().catch(() => {
            /* sem rede agora: baixa quando a etapa abrir */
          });
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const icone = mesa === "edicao" ? <Scissors className="h-4 w-4" /> : <Clapperboard className="h-4 w-4" />;

  return (
    // Casca padrão das mesas (src/components/sistema/CascaDaMesa.tsx).
    <CascaDaMesa
      mesa={mesa}
      titulo={titulo}
      clientId={clientId}
      marcaId={marca ? marca.id : null}
      telaCheia={telaCheia}
      cliente={<SeletorDeClientesDaMesa mesa={mesa} clientesBrutos={clientesQuery.data as ClienteBruto[] | undefined} valor={clientId} nome={nomeDoCliente} carregando={clientesQuery.isLoading} onEscolher={trocarCliente} />}
      marca={clientId && marca ? <SeletorDeMarca marcas={marcas} valor={marca.id} onEscolher={(id) => mudar({ marca: id }, true)} /> : null}
      etapas={
        clientId ? (
          <Etapas rotulo={`Etapas da ${titulo}`} numerar itens={etapas.map((e) => ({ valor: e.valor, rotulo: e.rotulo, dica: e.dica }))} valor={etapa} onEscolher={(v) => mudar({ etapa: v })} />
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
    >
      {!clientId && <EstadoVazio icone={icone} titulo={vazio.titulo} descricao={vazio.descricao} />}

      {valor && !redirecionando && (
        <MesaProvider valor={valor}>
          <div key={marca ? `${valor.clientId}:${marca.id}` : valor.clientId} className="min-w-0">
            <AreaDeTrabalho
              memoria={`${mesa === "edicao" ? "mesa-edicao" : "mesa-videos"}-agente`}
              rotuloDaLateral={rotuloDoAgente}
              iconeDaLateral={icone}
              rotuloDoPrincipal={titulo}
              memoriaDaRolagem={`${mesa}:${etapa}:${valor.clientId}`}
              lateral={
                <Suspense fallback={<Carregando forma="lista" linhas={3} rotulo="Abrindo o agente" />}>
                  <Agente mesa={mesa} etapa={etapa} irPara={irPara} />
                </Suspense>
              }
            >
              <Suspense fallback={<Carregando forma="aba" rotulo="Abrindo a etapa" />}>{children(etapa, irPara)}</Suspense>
            </AreaDeTrabalho>
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
    </CascaDaMesa>
  );
}
