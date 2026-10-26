import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CalendarClock, ExternalLink, FileText, History, Info, Megaphone, RefreshCw, ShieldAlert, Users, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useClients } from "@/hooks/useSupabaseData";
import { useAdsConnection } from "@/hooks/useAdsMetrics";
import {
  CabecalhoDePagina,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  JanelaCentral,
  Secao,
  SeletorCompacto,
  botao,
  espaco,
  etiqueta,
  juntar,
  larguraDaMesa,
  lista,
  texto,
} from "@/components/sistema";
import {
  ROTULO_DO_NIVEL,
  nomeDoPeriodo,
  normalizarAcao,
  normalizarBoletim,
  precisaDeVoce,
  tabelaAusente,
  type AcaoNaConta,
  type Boletim,
  type CampanhaDoPainel,
  type NivelDoAlerta,
  type PedidoDoTrafego,
} from "@/lib/anunciosHoje";

/*
 * Anúncios hoje (26/10/2026). Decisão do dono: o Paperclip cuida dos anúncios,
 * e tudo o que ele e o Hermes fazem nas contas chega aqui, numa página só, mais
 * UM aviso no sino por boletim (link para esta página). Precisa de você vem
 * primeiro; depois o último boletim, o que mudou nas contas e o histórico.
 */

const quando = (iso?: string | null) => {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "sem data";
};
const brl = (v: number | null) => (v === null ? "-" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

const TOM_DO_NIVEL: Record<NivelDoAlerta, string> = {
  critico: "bg-destructive/10 text-destructive",
  atencao: "bg-warning/10 text-warning",
  info: "bg-muted text-muted-foreground",
};

const ICONE_DO_PEDIDO: Record<PedidoDoTrafego["tipo"], { icone: ReactNode; tom: string; rotulo: string }> = {
  saldo: { icone: <Wallet className="h-4 w-4" />, tom: "text-destructive", rotulo: "Saldo baixo" },
  alerta: { icone: <AlertTriangle className="h-4 w-4" />, tom: "text-destructive", rotulo: "Alerta urgente do boletim" },
  decisao: { icone: <ShieldAlert className="h-4 w-4" />, tom: "text-warning", rotulo: "Decisão de tráfego pendente" },
  terminada: { icone: <CalendarClock className="h-4 w-4" />, tom: "text-warning", rotulo: "Campanha terminada" },
  vencendo: { icone: <CalendarClock className="h-4 w-4" />, tom: "text-muted-foreground", rotulo: "Campanha vencendo" },
};

type Leitura<T> = { linhas: T[]; ausente: boolean };

function useBoletins() {
  return useQuery({
    queryKey: ["ads-boletins"],
    refetchInterval: 120_000,
    queryFn: async (): Promise<Leitura<Boletim>> => {
      const { data, error } = await (supabase as any).from("ads_boletins").select("*").order("criado_em", { ascending: false }).limit(30);
      if (error) {
        if (tabelaAusente(error)) return { linhas: [], ausente: true };
        throw new Error(error.message);
      }
      return { linhas: ((data || []) as unknown[]).map(normalizarBoletim), ausente: false };
    },
  });
}

function useAcoesNasContas() {
  return useQuery({
    queryKey: ["ads-rotina-acoes", "hoje"],
    refetchInterval: 120_000,
    queryFn: async (): Promise<Leitura<AcaoNaConta>> => {
      const { data, error } = await (supabase as any).from("ads_rotina_acoes").select("*").order("criado_em", { ascending: false }).limit(80);
      if (error) {
        if (tabelaAusente(error)) return { linhas: [], ausente: true };
        throw new Error(error.message);
      }
      return { linhas: ((data || []) as unknown[]).map(normalizarAcao), ausente: false };
    },
  });
}

function useCampanhasComFim() {
  return useQuery({
    queryKey: ["ads-campanhas-com-fim"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ads_campaigns")
        .select("id, client_id, external_account_id, name, status, effective_status, daily_budget, stop_time")
        .limit(1000);
      if (error) throw new Error(error.message);
      return (data || []) as CampanhaDoPainel[];
    },
  });
}

export default function AnunciosHoje() {
  const boletins = useBoletins();
  const acoes = useAcoesNasContas();
  const campanhas = useCampanhasComFim();
  const conexao = useAdsConnection();
  const { data: clientes = [] } = useClients();
  const [cliente, setCliente] = useState("");
  const [aberto, setAberto] = useState<Boletim | null>(null);
  // 26/10 (dono: "mais enxuto"): os boletins anteriores saíram da página para uma janela (ícone ao lado do boletim).
  const [historicoAberto, setHistoricoAberto] = useState(false);
  // O aviso do sino traz ?boletim=<id>: boletim anterior abre na janela; o último já está na tela.
  const [params] = useSearchParams();
  const pedido = params.get("boletim");
  useEffect(() => {
    const lista = boletins.data?.linhas ?? [];
    if (!pedido || !lista.length || lista[0].id === pedido) return;
    const achado = lista.find((b) => b.id === pedido);
    if (achado) setAberto(achado);
  }, [pedido, boletins.data]);

  const nomes = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clientes as Array<{ id: string; company_name?: string | null; full_name?: string | null }>) m.set(String(c.id), c.company_name || c.full_name || "Cliente");
    return m;
  }, [clientes]);
  const nomeDe = (id: string | null) => (id ? nomes.get(id) || "Cliente" : "Geral");

  const ultimo = boletins.data?.linhas[0] ?? null;
  const filtrar = (id: string | null) => !cliente || id === cliente;
  const acoesVisiveis = (acoes.data?.linhas ?? []).filter((a) => a.estado !== "proposta" && filtrar(a.clientId));
  // 26/10: as mudanças agrupadas por cliente (o cliente com a mudança mais recente primeiro).
  const mudancasPorCliente = useMemo(() => {
    const grupos = new Map<string, AcaoNaConta[]>();
    for (const a of acoesVisiveis.slice(0, 40)) {
      const chave = a.clientId || "";
      const g = grupos.get(chave);
      if (g) g.push(a); else grupos.set(chave, [a]);
    }
    return [...grupos.entries()];
  }, [acoesVisiveis]);
  const pedidos = precisaDeVoce({
    contas: (conexao.data?.contas ?? []) as never,
    campanhas: campanhas.data ?? [],
    acoes: acoes.data?.linhas ?? [],
    boletim: ultimo,
    nomeDe,
    agora: Date.now(),
  }).filter((p) => filtrar(p.clientId));

  const atualizar = () => {
    void boletins.refetch();
    void acoes.refetch();
    void campanhas.refetch();
    void conexao.refetch();
  };
  const opcoesDeCliente = [{ valor: "", rotulo: "Todos os clientes" }, ...[...nomes.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([valor, rotulo]) => ({ valor, rotulo }))];
  const carregando = boletins.isLoading || acoes.isLoading;

  return (
    <div className={juntar(larguraDaMesa, espaco.pagina, "pb-10")} data-anuncios-hoje="">
      <CabecalhoDePagina
        titulo="Anúncios hoje"
        descricao={ultimo ? `${nomeDoPeriodo(ultimo.periodo)} · ${quando(ultimo.criado_em)}` : "Sem boletim ainda"}
        ajuda="O boletim do Hermes das 9h e das 17h30, o que os agentes mudaram nas contas (com antes, depois, motivo e prova) e o que só você decide. O sino avisa uma vez por boletim."
        acoes={<>
          {nomes.size > 1 && <SeletorCompacto opcoes={opcoesDeCliente} valor={cliente} onEscolher={setCliente} rotulo="Filtrar por cliente" modo="lista" icone={<Users className="h-3.5 w-3.5" />} />}
          <Link to="/anuncios" className={botao.icone} title="Abrir Anúncios (contas e campanhas)" aria-label="Abrir Anúncios"><Megaphone className="h-4 w-4" aria-hidden="true" /></Link>
          <button type="button" onClick={atualizar} className={botao.icone} title="Atualizar" aria-label="Atualizar"><RefreshCw className={juntar("h-4 w-4", (boletins.isFetching || acoes.isFetching) && "animate-spin")} aria-hidden="true" /></button>
        </>}
      />

      <Secao titulo="Precisa de você" descricao={pedidos.length ? `${pedidos.length} ${pedidos.length === 1 ? "item" : "itens"}` : "Nada pendente"} recolher="anuncios-hoje:precisa">
        {carregando && !pedidos.length ? <Carregando linhas={2} rotulo="Lendo o que precisa de você" /> : pedidos.length === 0 ? (
          <EstadoVazio compacto titulo="Nada esperando você nos anúncios." />
        ) : (
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Precisa de você">
            {pedidos.map((p) => {
              const cara = ICONE_DO_PEDIDO[p.tipo];
              return (
                <li key={p.chave} className={juntar(lista.linha, "items-start")} data-pedido={p.tipo}>
                  <span className={juntar("mr-2.5 mt-0.5 shrink-0", cara.tom)} title={cara.rotulo} aria-label={cara.rotulo}>{cara.icone}</span>
                  <span className={juntar(texto.corpo, "min-w-0 flex-1")}>{p.texto}</span>
                  <Link to={p.tipo === "decisao" ? "/mesa-ads" : "/anuncios"} className={juntar(botao.icone, "ml-2")} title={p.tipo === "decisao" ? "Decidir na Mesa Ads" : "Abrir a conta em Anúncios"} aria-label={p.tipo === "decisao" ? "Decidir na Mesa Ads" : "Abrir em Anúncios"}>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Secao>

      <Secao
        titulo="Último boletim"
        descricao={ultimo ? quando(ultimo.criado_em) : undefined}
        recolher="anuncios-hoje:boletim"
        divisoria
        acao={(boletins.data?.linhas.length ?? 0) > 1 ? <button type="button" onClick={() => setHistoricoAberto(true)} className={botao.icone} title={`Boletins anteriores (${(boletins.data?.linhas.length ?? 1) - 1})`} aria-label="Boletins anteriores"><History className="h-4 w-4" aria-hidden="true" /></button> : undefined}
      >
        {boletins.isLoading ? <Carregando linhas={3} rotulo="Carregando o boletim" />
          : boletins.error ? <EstadoDeErro titulo="Não foi possível ler o boletim." descricao={(boletins.error as Error).message} acao={<button type="button" className={botao.secundario} onClick={() => void boletins.refetch()}>Tentar de novo</button>} />
            : !ultimo ? <EstadoVazio compacto titulo={boletins.data?.ausente ? "O boletim ainda não chega a este painel." : "Nenhum boletim ainda hoje."} descricao={boletins.data?.ausente ? "Falta ligar a gravação do boletim no servidor." : "O Hermes manda às 9h e às 17h30."} />
              : <BoletimAberto boletim={ultimo} nomeDe={nomeDe} filtrar={filtrar} aoAbrir={() => setAberto(ultimo)} />}
      </Secao>

      <Secao titulo="O que mudou nas contas" descricao={acoesVisiveis.length ? `${acoesVisiveis.length} ${acoesVisiveis.length === 1 ? "mudança" : "mudanças"}` : undefined} recolher="anuncios-hoje:mudancas" divisoria>
        {acoes.isLoading ? <Carregando linhas={3} rotulo="Carregando as mudanças" />
          : acoes.error ? <EstadoDeErro titulo="Não foi possível ler as mudanças." descricao={(acoes.error as Error).message} />
            : acoesVisiveis.length === 0 ? <EstadoVazio compacto titulo="Nenhuma mudança registrada nas contas." />
              : <div className="min-w-0 space-y-4">{mudancasPorCliente.map(([clienteId, doCliente]) => (
                <div key={clienteId || "geral"} className="min-w-0" data-cliente-das-mudancas={clienteId}>
                <p className={juntar(texto.rotulo, "mb-0.5")}>{nomeDe(clienteId || null)} · {doCliente.length}</p>
                <ul className={juntar(lista.aberta, lista.divisoria)} aria-label={`Mudanças nas contas de ${nomeDe(clienteId || null)}`}>
                {doCliente.map((a) => (
                  <li key={a.id} className={juntar(lista.linha, "block")} data-mudanca="">
                    <p className={juntar(texto.corpo, "min-w-0 truncate")}>
                      <span className="font-medium">{a.acao}</span> {a.alvoTipo ? <span className="text-muted-foreground">{a.alvoTipo} </span> : null}<span className="font-medium">{a.alvoNome}</span>
                    </p>
                    {(a.antes || a.depois) && <p className={juntar(texto.corpo, "mt-0.5 min-w-0 truncate tabular-nums")}><span className="text-muted-foreground">{a.antes || "-"}</span><span className="mx-1.5 text-muted-foreground" aria-label="para">→</span><span>{a.depois || "-"}</span></p>}
                    {a.motivo && <p className={juntar(texto.auxiliar, "mt-0.5 truncate")} title={a.motivo}>{a.motivo}</p>}
                    <p className={juntar(texto.auxiliar, "mt-0.5 flex min-w-0 items-center")}>
                      <span className="min-w-0 truncate">{a.quem} · {quando(a.quando)}{a.estado === "desfeita" ? " · desfeita" : a.estado === "falhou" ? " · falhou" : ""}</span>
                      {a.provaUrl && <a href={a.provaUrl} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex shrink-0 items-center text-primary hover:underline" title="Abrir a prova" aria-label="Abrir a prova"><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>}
                    </p>
                  </li>
                ))}
              </ul>
                </div>
              ))}</div>}
      </Secao>


      <JanelaCentral aberta={historicoAberto} onMudar={setHistoricoAberto} titulo="Boletins anteriores" icone={<History className="h-4 w-4" />} largura="md">
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Boletins anteriores">
          {(boletins.data?.linhas ?? []).slice(1).map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => { setHistoricoAberto(false); setAberto(b); }} className={juntar(lista.linha, "w-full text-left")}>
                <FileText className="mr-2.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate font-medium")}>{nomeDoPeriodo(b.periodo)} · {quando(b.criado_em)}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>{b.resumo || "Sem resumo"}</span>
                </span>
                {b.alertas.some((x) => x.nivel === "critico") && <AlertTriangle className="ml-2 h-4 w-4 shrink-0 text-destructive" aria-label="Tem alerta urgente" />}
              </button>
            </li>
          ))}
        </ul>
      </JanelaCentral>

      <JanelaCentral aberta={!!aberto} onMudar={(v) => { if (!v) setAberto(null); }} titulo={aberto ? nomeDoPeriodo(aberto.periodo) : "Boletim"} descricao={aberto ? quando(aberto.criado_em) : undefined} icone={<FileText className="h-4 w-4" />} largura="lg">
        {aberto && <div className="space-y-4">
          <BoletimAberto boletim={aberto} nomeDe={nomeDe} filtrar={() => true} />
          {aberto.texto_completo && <p className={juntar(texto.corpo, "whitespace-pre-wrap")}>{aberto.texto_completo}</p>}
        </div>}
      </JanelaCentral>
    </div>
  );
}

function BoletimAberto({ boletim, nomeDe, filtrar, aoAbrir }: { boletim: Boletim; nomeDe: (id: string | null) => string; filtrar: (id: string | null) => boolean; aoAbrir?: () => void }) {
  const alertas = boletim.alertas.filter((a) => !a.client_id || filtrar(a.client_id));
  const linhas = boletim.por_cliente.filter((l) => filtrar(l.client_id));
  return (
    <div className="min-w-0 space-y-4" data-boletim="">
      {boletim.resumo && <p className={juntar(texto.corpo, "max-w-[80ch] whitespace-pre-wrap")}>{boletim.resumo}</p>}
      {alertas.length > 0 && (
        <ul className="min-w-0 space-y-1.5" aria-label="Alertas do boletim">
          {alertas.map((a, i) => (
            <li key={i} className="flex min-w-0 items-start" data-nivel={a.nivel}>
              <span className={juntar(etiqueta, "mr-2 mt-px", TOM_DO_NIVEL[a.nivel])}>{ROTULO_DO_NIVEL[a.nivel]}</span>
              <span className={juntar(texto.corpo, "min-w-0 flex-1")}>{a.client_id ? <span className="font-medium">{nomeDe(a.client_id)}: </span> : null}{a.texto}</span>
            </li>
          ))}
        </ul>
      )}
      {linhas.length > 0 && (
        <div className="min-w-0" role="table" aria-label="Por cliente">
          <div role="row" className={juntar(texto.rotulo, "hidden grid-cols-[minmax(0,1.2fr)_120px_minmax(0,1fr)_minmax(0,2fr)] gap-3 border-b border-border pb-1.5 sm:grid")}>
            <span role="columnheader">Cliente</span><span role="columnheader" className="text-right">Gasto</span><span role="columnheader">Resultado</span><span role="columnheader">Observação</span>
          </div>
          {linhas.map((l, i) => (
            <div role="row" key={`${l.client_id}:${i}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b border-border/50 py-2 sm:grid-cols-[minmax(0,1.2fr)_120px_minmax(0,1fr)_minmax(0,2fr)]">
              <span role="cell" className={juntar(texto.corpo, "min-w-0 truncate font-medium")}>{nomeDe(l.client_id)}</span>
              <span role="cell" className={juntar(texto.corpo, "text-right tabular-nums")}>{brl(l.gasto)}</span>
              <span role="cell" className={juntar(texto.corpo, "col-span-2 min-w-0 truncate sm:col-span-1")}>{l.resultado || "-"}</span>
              <span role="cell" className={juntar(texto.auxiliar, "col-span-2 min-w-0 sm:col-span-1 sm:line-clamp-2")}>{l.observacao || ""}</span>
            </div>
          ))}
        </div>
      )}
      {aoAbrir && boletim.texto_completo && (
        <button type="button" onClick={aoAbrir} className={juntar(botao.discreto, "relative -left-3")} title="Ler o boletim completo">
          <Info className="mr-1.5 h-4 w-4" aria-hidden="true" />Ler completo
        </button>
      )}
    </div>
  );
}
