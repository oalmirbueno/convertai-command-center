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
import { lazyComPreCarga } from "@/lib/lazyComPreCarga";
import { useTelaCheiaDaMesa } from "@/components/mesa/TelaCheiaDaMesa";
import CascaDaMesa from "@/components/sistema/CascaDaMesa";
import { etapasEmIcone } from "@/components/mesa-foto/IconesDasEtapas";
import SeletorDeMarca, { useMarcaNaCasca } from "@/components/mesa/SeletorDeMarca";
import Etapas from "@/components/sistema/Etapas";
import AreaDeTrabalho from "@/components/sistema/AreaDeTrabalho";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { lerEstadoDaTela, useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { juntar, superficie } from "@/components/sistema/estilos";
import { Clapperboard } from "lucide-react";
// Frente CNS (30/09): o conselho de agentes abre da Mesa Roteiros; a recomendação vai para o campo do agente.
import BotaoDoConselho from "@/components/conselho/BotaoDoConselho";
// 19/10/2026: faixa de roteiros abertos no topo (vários roteiros na mesma área, cada um na sua etapa).
import FaixaDeRoteiros from "@/components/mesa-roteiros/FaixaDeRoteiros";
import {
  abaDoPedido,
  abrirNaFaixa,
  atualizarAbaNaFaixa,
  ehEtapaDaAba,
  enderecoDaAba,
  FAIXA_VAZIA,
  FaixaContexto,
  fecharDaFaixa,
  preencherFormularioDaAba,
  tituloProvisorio,
  validarFaixa,
  type AbaDeRoteiro,
  type ApiDaFaixa,
  type FaixaGuardada,
  type PedidoDeAba,
} from "@/components/mesa-roteiros/roteirosAbertos";

/**
 * Mesa Roteiros (/mesa-roteiros, só equipe: admin, gestor e design), Frente
 * R2 (26/09). Primeiro lote do Estúdio Audiovisual V2: agenda -> roteiro ->
 * revisão salva -> PDF, mais a memória (modelos). Mesma casca das outras
 * mesas: barra fina com o seletor de cliente (padrão: plano mensal ativo),
 * as etapas, a troca de mesas, o saldo e a tela cheia. Endereço completo:
 * /mesa-roteiros?client=<id>&etapa=roteiro&roteiro=<id>&tarefa=<id>&modelo=<id>
 *
 * Etapas: Agenda (peças de vídeo da agenda e roteiros avulsos), Roteiro
 * (gerar com custo antes e editar), Revisão (versões, comentários, aprovar,
 * gravado, arquivar), PDF (padrão do documento de roteiro da agência, Baixar
 * e Compartilhar com o cliente) e Modelos (memória do cliente e da agência).
 * O agente da mesa fica fixo ao lado das etapas (lateral da AreaDeTrabalho;
 * no celular, a gaveta do botão de baixo), com ações confirmadas.
 *
 * 19/10/2026 (dono: "escolher em cima os roteiros que eu quiser e fazer
 * vários na mesma área"): a faixa de roteiros abertos no topo, como abas de
 * navegador (FaixaDeRoteiros.tsx). Cada aba é um roteiro com a etapa em que
 * parou (Roteiro, Revisão ou PDF); o endereço leva `aba=<id>`. Agenda e
 * Modelos continuam como estão; marcar vários lá abre todos na faixa ou gera
 * todos com o preço total antes. A faixa fica guardada por cliente.
 */

const carregarAgenda = () => import("@/components/mesa-roteiros/EtapaAgenda");
const carregarRoteiro = () => import("@/components/mesa-roteiros/EtapaRoteiro");
const carregarRevisao = () => import("@/components/mesa-roteiros/EtapaRevisao");
const carregarPdf = () => import("@/components/mesa-roteiros/EtapaPdf");
const carregarModelos = () => import("@/components/mesa-roteiros/EtapaModelos");
// Mesmas chaves da pré-carga do painel (src/lib/mesa/preCarga.ts).
const EtapaAgenda = lazyComPreCarga("mesa-roteiros/agenda", carregarAgenda);
const EtapaRoteiro = lazyComPreCarga("mesa-roteiros/roteiro", carregarRoteiro);
const EtapaRevisao = lazyComPreCarga("mesa-roteiros/revisao", carregarRevisao);
const EtapaPdf = lazyComPreCarga("mesa-roteiros/pdf", carregarPdf);
const EtapaModelos = lazyComPreCarga("mesa-roteiros/modelos", carregarModelos);
const AgenteRoteirista = lazyComPreCarga("mesa-roteiros/agente", () => import("@/components/mesa-roteiros/AgenteRoteirista"));
const ChavesECotas = lazy(() => import("@/components/mesa/ChavesECotas"));
const ModelosDeIa = lazy(() => import("@/components/mesa/ModelosDeIa"));

export const ETAPAS_DA_MESA_ROTEIROS = [
  { valor: "agenda", rotulo: "Agenda" },
  { valor: "roteiro", rotulo: "Roteiro" },
  { valor: "revisao", rotulo: "Revisão" },
  { valor: "pdf", rotulo: "PDF" },
  { valor: "modelos", rotulo: "Modelos" },
] as const;

type Etapa = (typeof ETAPAS_DA_MESA_ROTEIROS)[number]["valor"];

const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOuNulo = (v: string | null) => (v && UUID_VALIDO.test(v) ? v : null);

const chaveOnde = (clientId: string) => `mesa-roteiros:onde:${clientId}`;
const chaveDaFaixa = (clientId: string) => `mesa-roteiros:faixa:${clientId || "sem-cliente"}`;

function lerOnde(clientId: string): { etapa: string | null; nome: string | null } {
  try {
    const v = JSON.parse(window.localStorage.getItem(chaveOnde(clientId)) || "null");
    if (!v || typeof v !== "object") return { etapa: null, nome: null };
    return {
      etapa: ETAPAS_DA_MESA_ROTEIROS.some((e) => e.valor === v.etapa) ? String(v.etapa) : null,
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
    /* armazenamento indisponível: abre sempre na Agenda */
  }
}

function EsqueletoDaEtapa() {
  return <Carregando forma="aba" rotulo="Abrindo a etapa" />;
}

/** Enquanto o agente baixa (primeira abertura): a casca dele, sem texto. */
function EsqueletoDoAgente() {
  return <div aria-busy="true" aria-label="Abrindo o agente" className={juntar(superficie.painel, "h-full min-h-[320px] animate-pulse")} />;
}

export default function MesaRoteiros() {
  const { profile, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const clientesQuery = useClients();
  const catalogo = useCatalogo();

  const clientIdUrl = params.get("client") || "";
  const etapaUrl = params.get("etapa");
  const etapa: Etapa = ETAPAS_DA_MESA_ROTEIROS.some((e) => e.valor === etapaUrl) ? (etapaUrl as Etapa) : "agenda";
  const roteiroUrl = uuidOuNulo(params.get("roteiro"));
  const tarefaUrl = uuidOuNulo(params.get("tarefa"));
  const modeloUrl = uuidOuNulo(params.get("modelo"));
  const avulso = params.get("avulso") === "1";
  // Frente ROT: o modelo da biblioteca "Roteiros validados" escolhido na etapa Modelos (rv-..., casa-... ou UUID do próprio).
  const baseUrl = /^((rv|casa)-[a-z0-9-]{3,60}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(params.get("base") || "") ? params.get("base") : null;

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
  // Frente MC: marca aberta (só no cliente com 2 ou mais marcas); vai para o endereço e para as chamadas (marca_id).
  const { marcas, marca } = useMarcaNaCasca(clientId, params.get("marca"));
  const onde = useMemo(() => (clientId ? lerOnde(clientId) : null), [clientId]);
  const nomeDoCliente = (clienteNaLista && clienteNaLista.nome) || (onde && onde.nome) || "";
  // Rascunho do campo do agente, guardado por cliente (sair e voltar mantém).
  const [rascunhoDoAgente, setRascunhoDoAgente] = useEstadoDaTela<string>(`mesa-roteiros:agente:rascunho:${clientId || "sem-cliente"}`, "");

  const mudar = (mudancas: Record<string, string | null>, substituir = false) => {
    const next = new URLSearchParams(params);
    Object.keys(mudancas).forEach((k) => {
      const v = mudancas[k];
      if (v) next.set(k, v);
      else next.delete(k);
    });
    setParams(next, { replace: substituir });
  };

  // Faixa de roteiros abertos, guardada por cliente. A aba à vista vem do endereço (aba=<id>).
  const [faixa, setFaixa] = useEstadoDaTela<FaixaGuardada>(chaveDaFaixa(clientId), FAIXA_VAZIA, { validar: validarFaixa });
  const faixaRef = useRef(faixa);
  faixaRef.current = faixa;
  const abaUrl = params.get("aba");
  const abaAtiva: AbaDeRoteiro | null = ehEtapaDaAba(etapa) && abaUrl ? faixa.abas.filter((a) => a.id === abaUrl)[0] || null : null;
  const abaAtivaRef = useRef(abaAtiva);
  abaAtivaRef.current = abaAtiva;
  const guardarFaixa = (f: FaixaGuardada) => {
    faixaRef.current = f;
    setFaixa(f);
  };
  /** Vai para a aba, na etapa em que ela parou. */
  const irParaAba = (a: AbaDeRoteiro) => {
    if (faixaRef.current.ativa !== a.id) guardarFaixa({ ...faixaRef.current, ativa: a.id });
    mudar(enderecoDaAba(a));
  };
  /** Abre (ou reaproveita) a aba do pedido e vai para ela. */
  const abrirAba = (p: PedidoDeAba) => {
    const r = abrirNaFaixa(faixaRef.current, p);
    const f = { ...r.faixa, ativa: r.id };
    guardarFaixa(f);
    const aba = f.abas.filter((a) => a.id === r.id)[0];
    if (aba) mudar(enderecoDaAba(aba, p.etapa || aba.etapa));
  };
  /** Fechar só tira da faixa: o roteiro e o rascunho continuam guardados. */
  const fecharAba = (id: string) => {
    const r = fecharDaFaixa(faixaRef.current, id);
    guardarFaixa(r.faixa);
    if (abaAtiva && abaAtiva.id === id) {
      if (r.proxima) mudar(enderecoDaAba(r.proxima));
      else mudar({ etapa: "agenda", aba: null, roteiro: null, tarefa: null, avulso: null, modelo: null, base: null });
    }
  };

  const trocarCliente = (id: string) => {
    const o = lerOnde(id);
    // Volta onde parou: a última aba da faixa daquele cliente, se a etapa era de roteiro.
    const f = lerEstadoDaTela<FaixaGuardada>(chaveDaFaixa(id), FAIXA_VAZIA, validarFaixa);
    const ultima = ehEtapaDaAba(o.etapa) ? f.abas.filter((a) => a.id === f.ativa)[0] || null : null;
    const limpo = { roteiro: null, tarefa: null, modelo: null, avulso: null, marca: null, base: null, aba: null };
    mudar({ client: id, etapa: o.etapa || "agenda", ...limpo, ...(ultima ? enderecoDaAba(ultima) : {}) });
  };

  const abrirRoteiro = (id: string, destino: Etapa = "roteiro", titulo?: string) =>
    abrirAba({ roteiro: id, titulo: titulo || "Roteiro", etapa: ehEtapaDaAba(destino) ? destino : "roteiro" });
  const novoDaPeca = (taskId: string, titulo?: string) => abrirAba({ tarefa: taskId, titulo: titulo || "Roteiro da peça", etapa: "roteiro" });
  const novoAvulso = (modeloId?: string | null, base?: string | null) =>
    abrirAba({ avulso: true, modelo: modeloId || null, base: base || null, titulo: modeloId ? "Roteiro do modelo" : base ? "Roteiro da biblioteca" : "Roteiro avulso", etapa: "roteiro" });

  // Endereço só com o cliente: abre na etapa em que parou (e na última aba da faixa).
  useEffect(() => {
    if (!clientId || etapaUrl) return;
    const o = lerOnde(clientId);
    const f = faixaRef.current;
    const ultima = ehEtapaDaAba(o.etapa) ? f.abas.filter((a) => a.id === f.ativa)[0] || null : null;
    if (ultima) mudar(enderecoDaAba(ultima), true);
    else if (o.etapa) mudar({ etapa: o.etapa }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // A faixa acompanha o endereço: a aba guarda a etapa e o roteiro que nasceu
  // nela; roteiro, peça ou avulso aberto por fora (agente, link) ganha a aba dele.
  useEffect(() => {
    if (!clientId || !ehEtapaDaAba(etapa)) return;
    const f = faixaRef.current;
    const aba = abaUrl ? f.abas.filter((a) => a.id === abaUrl)[0] || null : null;
    if (aba && (!roteiroUrl || !aba.roteiro || aba.roteiro === roteiroUrl)) {
      if (!roteiroUrl && aba.roteiro) return; // o efeito de baixo leva ao roteiro
      const parte: Partial<AbaDeRoteiro> = {};
      if (aba.etapa !== etapa) parte.etapa = etapa;
      // O roteiro nasceu nesta aba (gerado ou começado em branco).
      if (roteiroUrl && !aba.roteiro) Object.assign(parte, { roteiro: roteiroUrl, avulso: false, modelo: null, base: null });
      let nova = Object.keys(parte).length ? atualizarAbaNaFaixa(f, aba.id, parte) : f;
      if (nova.ativa !== aba.id) nova = { ...nova, ativa: aba.id };
      if (nova !== f) guardarFaixa(nova);
      return;
    }
    if (!roteiroUrl && !tarefaUrl && !avulso) return;
    const pedido: PedidoDeAba = roteiroUrl
      ? { roteiro: roteiroUrl, titulo: "Roteiro", etapa }
      : tarefaUrl
        ? { tarefa: tarefaUrl, titulo: "Roteiro da peça", etapa }
        : { avulso: true, modelo: modeloUrl, base: baseUrl, titulo: "Roteiro avulso", etapa };
    // A troca de endereço chega depois (transição do roteador): a faixa só muda se precisar, senão o efeito voltaria em laço.
    const existente = abaDoPedido(f, pedido);
    if (existente) {
      if (f.ativa !== existente.id) guardarFaixa({ ...f, ativa: existente.id });
      mudar({ aba: existente.id }, true);
      return;
    }
    const r = abrirNaFaixa(f, pedido);
    guardarFaixa({ ...r.faixa, ativa: r.id });
    mudar({ aba: r.id }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, etapa, abaUrl, roteiroUrl, tarefaUrl, avulso]);

  // O roteiro da aba à vista nasceu fora dela (o "Gerar todos" terminou enquanto o formulário estava aberto): vai para ele.
  const roteiroDaAbaAtiva = abaAtiva ? abaAtiva.roteiro : null;
  useEffect(() => {
    if (abaAtiva && roteiroDaAbaAtiva && !roteiroUrl) mudar(enderecoDaAba(abaAtiva, etapa as AbaDeRoteiro["etapa"]), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roteiroDaAbaAtiva, roteiroUrl]);

  const apiDaFaixa: ApiDaFaixa = {
    abas: faixa.abas,
    abaAtiva,
    abrirVarios: (itens, opcoes = {}) => {
      let f = faixaRef.current;
      const ids: string[] = [];
      itens.forEach((it) => {
        const r = abrirNaFaixa(f, it.pedido);
        f = r.faixa;
        ids.push(r.id);
        if (r.nova && it.preencher) preencherFormularioDaAba(clientId, r.id, it.preencher);
      });
      const primeira = opcoes.ir && ids.length ? f.abas.filter((a) => a.id === ids[0])[0] || null : null;
      if (primeira) f = { ...f, ativa: primeira.id };
      guardarFaixa(f);
      if (primeira) mudar(enderecoDaAba(primeira));
      return ids;
    },
    atualizarAba: (id, parte) => setFaixa((f) => atualizarAbaNaFaixa(f, id, parte)),
    nomearAtiva: (titulo) => {
      const a = abaAtivaRef.current;
      if (!a || a.titulo === titulo || (tituloProvisorio(titulo) && !tituloProvisorio(a.titulo))) return;
      setFaixa((f) => atualizarAbaNaFaixa(f, a.id, { titulo: titulo.slice(0, 120) }));
    },
  };

  useEffect(() => {
    if (clientId && etapaUrl) gravarOnde(clientId, etapa, nomeDoCliente || null);
  }, [clientId, etapaUrl, etapa, nomeDoCliente]);

  const mesAtual = inicioDoMes();
  // Mesmas chaves da Mesa do cliente: o saldo é o mesmo em todas as mesas.
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

  return (
    // Casca padrão das mesas (src/components/sistema/CascaDaMesa.tsx).
    <CascaDaMesa
      mesa="roteiros"
      titulo="Mesa Roteiros"
      clientId={clientId}
      telaCheia={telaCheia}
      // Frente MC (29/09): a Mesa Roteiros troca de marca como as outras mesas (a CME roteiriza com o contexto da CME).
      marca={clientId && marca ? <SeletorDeMarca marcas={marcas} valor={marca.id} onEscolher={(id) => mudar({ marca: id, roteiro: null, tarefa: null, aba: null }, true)} /> : null}
      cliente={<SeletorDeClientesDaMesa mesa="roteiros" clientesBrutos={clientesQuery.data as ClienteBruto[] | undefined} valor={clientId} nome={nomeDoCliente} carregando={clientesQuery.isLoading} onEscolher={trocarCliente} />}
      etapas={
        clientId ? (
          // 16/10/2026: etapas só em ícone (padrão das mesas, IconesDasEtapas.tsx); o nome aparece na aberta.
          <Etapas
            rotulo="Etapas da Mesa Roteiros"
            soIcone
            itens={etapasEmIcone("roteiros", ETAPAS_DA_MESA_ROTEIROS.map((e) => ({ valor: e.valor, rotulo: e.rotulo })))}
            valor={etapa}
            onEscolher={(v) => {
              // Roteiro, Revisão ou PDF sem roteiro no endereço: volta para a última aba da faixa.
              const ultima = faixa.abas.filter((a) => a.id === faixa.ativa)[0] || null;
              if (ehEtapaDaAba(v) && ultima && !abaUrl && !roteiroUrl && !tarefaUrl && !avulso) mudar(enderecoDaAba(ultima, v));
              else mudar({ etapa: v });
            }}
          />
        ) : null
      }
      acoes={
        clientId ? (
          <>
          <BotaoDoConselho
            clientId={clientId}
            origem="mesa-roteiros"
            tema={roteiroUrl ? "Roteiro aberto na mesa" : `Roteiros${nomeDoCliente ? ` de ${nomeDoCliente}` : ""}`}
            contexto={roteiroUrl ? "O roteiro aberto vai junto no retrato do cliente." : "Ideias e roteiros de vídeo curto do cliente."}
            referencia={roteiroUrl ? { tipo: "roteiro", id: roteiroUrl } : { tipo: "roteiros" }}
            onUsar={(t) => setRascunhoDoAgente(t)}
            rotuloDoUsar="Levar para o agente de roteiros"
          />
          <span aria-hidden="true" className="mx-1.5 hidden h-4 w-px shrink-0 bg-border sm:block" />
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
          icone={<Clapperboard className="h-5 w-5" />}
          titulo="Escolha um cliente para abrir a Mesa Roteiros dele."
          descricao="Roteiros de gravação, com revisão e PDF."
        />
      )}

      {valor && (
        <MesaProvider valor={valor}>
          <FaixaContexto.Provider value={apiDaFaixa}>
          {/* Área de trabalho (src/components/sistema/AreaDeTrabalho.tsx): no
              computador a etapa rola por dentro e o agente fica parado ao lado,
              com o campo sempre à vista; no celular a página rola normal e o
              agente abre em tela cheia pelo botão de baixo. */}
          <AreaDeTrabalho
            key={valor.clientId}
            memoria="mesa-roteiros"
            rotuloDaLateral="Agente de roteiros"
            iconeDaLateral={<Clapperboard className="h-4 w-4" />}
            rotuloDoPrincipal="Etapa da Mesa Roteiros"
            principalRolavel={false}
            lateral={
              <Suspense fallback={<EsqueletoDoAgente />}>
                <AgenteRoteirista roteiroId={roteiroUrl} onAbrirRoteiro={(id) => abrirRoteiro(id)} rascunho={rascunhoDoAgente} onRascunho={setRascunhoDoAgente} />
              </Suspense>
            }
          >
            {/* 19/10/2026: a faixa de roteiros abertos, parada em cima da etapa (no celular rola por dentro, de lado). */}
            <div className="mb-3 min-w-0 shrink-0">
              <FaixaDeRoteiros
                clientId={valor.clientId}
                abas={faixa.abas}
                ativa={abaAtiva ? abaAtiva.id : null}
                onEscolher={(id) => {
                  const a = faixa.abas.filter((x) => x.id === id)[0];
                  if (a) irParaAba(a);
                }}
                onFechar={fecharAba}
                onNovo={() => novoAvulso()}
                onDaAgenda={() => mudar({ etapa: "agenda" })}
                onDaBiblioteca={() => mudar({ etapa: "modelos" })}
              />
            </div>
            {/* Uma região por etapa, cliente e aba: trocar de etapa (ou de aba) e voltar devolve a rolagem. */}
            <RegiaoRolavel
              key={`${etapa}:${abaAtiva ? abaAtiva.id : ""}`}
              modo="lg"
              memoria={`mesa-roteiros:${valor.clientId}:${etapa}${abaAtiva ? `:${abaAtiva.id}` : ""}`}
              className="pb-6 lg:pr-1"
              data-regiao-da-etapa={etapa}
            >
              <Suspense fallback={<EsqueletoDaEtapa />}>
                {etapa === "agenda" && <EtapaAgenda onAbrirRoteiro={(id, titulo) => abrirRoteiro(id, "roteiro", titulo)} onNovoDaPeca={novoDaPeca} onAvulso={() => novoAvulso()} />}
                {etapa === "roteiro" && (
                  <EtapaRoteiro
                    key={abaAtiva ? abaAtiva.id : "sem-aba"}
                    roteiroId={roteiroUrl}
                    tarefaId={tarefaUrl}
                    avulso={avulso}
                    modeloId={modeloUrl}
                    baseId={baseUrl}
                    chave={abaAtiva && abaAtiva.avulso && !abaAtiva.roteiro ? abaAtiva.id : null}
                    onAberto={(id) => mudar({ roteiro: id, tarefa: null, avulso: null, modelo: null, base: null }, true)}
                    onIrPara={(e, id) => mudar({ etapa: e, roteiro: id || roteiroUrl })}
                    onVoltar={() => mudar({ etapa: "agenda", aba: null, roteiro: null, tarefa: null, avulso: null, modelo: null, base: null })}
                  />
                )}
                {etapa === "revisao" && <EtapaRevisao roteiroId={roteiroUrl} onAbrirRoteiro={(id, e) => abrirRoteiro(id, e || "revisao")} />}
                {etapa === "pdf" && <EtapaPdf roteiroId={roteiroUrl} />}
                {etapa === "modelos" && <EtapaModelos onUsarModelo={(id) => novoAvulso(id)} onUsarBase={(id) => novoAvulso(null, id)} />}
              </Suspense>
            </RegiaoRolavel>
          </AreaDeTrabalho>
          </FaixaContexto.Provider>

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
