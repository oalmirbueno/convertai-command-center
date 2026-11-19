import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Handshake, RefreshCw, Sparkles, Users } from "lucide-react";
import { CardSurface, Chip, HelpTooltip, StatCard, StatGrid, StatusPill, type Tone } from "@/components/ds";
import { lerMonitor, listarContasDaCasa, listarPlanos, reais, type ContaNaCasa, type EmpresaNoMonitor, type NivelDaSaude } from "@/lib/produto/api";
import { EstadoDeErro, EstadoVazio, Secao, botao, juntar, texto } from "@/components/sistema";
import { ListaDeEmpresas, ListaDeEmpresasCarregando } from "./ContasDaCasa";
import JanelaDaEmpresa, { haQuanto } from "./JanelaDaEmpresa";
import { chaveDasContas, reaisCurto } from "./estadoDaConta";

export { haQuanto };

/**
 * A Visão geral do produto CRM, para a administração da casa (18/11/2026; redesenhada em 19/11):
 * se está tudo em ordem (e-mails, cobrança, rotinas, integrações, convites) e o movimento do CRM de
 * cada empresa, relido sozinho a cada 15 segundos.
 *
 * Carga (19/11, dono: "a visão geral não carrega, está bugada"): a tela não espera mais tudo para
 * aparecer. A lista das empresas sai da leitura rápida das contas (a mesma da aba Empresas, já em
 * cache quando se passa por lá) e o monitor, que é a leitura pesada, corre em paralelo e preenche
 * os números e o movimento quando chega. Cada região tem o seu esqueleto e o seu "Tentar de novo".
 * Mostra números e movimento; o nome dos leads de cada empresa não aparece.
 */

const RELER_A_CADA = 15_000;
const TOM: Record<NivelDaSaude, Tone> = { ok: "success", atencao: "warning", problema: "danger" };
const PESO: Record<NivelDaSaude, number> = { problema: 0, atencao: 1, ok: 2 };
const ROTULO_DO_NIVEL: Record<NivelDaSaude, string> = { ok: "Em ordem", atencao: "Atenção", problema: "Problema" };

/** Mexeram no CRM nos últimos 10 minutos. */
const emUsoAgora = (e: Pick<EmpresaNoMonitor, "ultima_atividade"> | null | undefined, agora: number) => !!e && !!e.ultima_atividade && agora - new Date(e.ultima_atividade).getTime() < 600_000;

/** O relógio que faz "há 2 min" andar entre uma releitura e outra. */
function useAgora(): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);
  return agora;
}

/** As empresas na ordem do monitor (quem mexeu por último primeiro); sem o monitor, a ordem das contas. */
export function ordenarPeloMonitor(contas: ContaNaCasa[], empresas: EmpresaNoMonitor[] | undefined): ContaNaCasa[] {
  if (!empresas || empresas.length === 0) return contas;
  const posicao: Record<string, number> = {};
  empresas.forEach((e, i) => {
    posicao[e.id] = i;
  });
  return contas.slice().sort((a, b) => (a.id in posicao ? posicao[a.id] : 1e6) - (b.id in posicao ? posicao[b.id] : 1e6));
}

export default function MonitorDoProduto() {
  const qc = useQueryClient();
  // As três leituras saem juntas: nenhuma espera a outra.
  const monitor = useQuery({ queryKey: ["produto", "casa", "monitor"], queryFn: lerMonitor, refetchInterval: RELER_A_CADA, placeholderData: (antes) => antes });
  const contas = useQuery({ queryKey: chaveDasContas, queryFn: listarContasDaCasa, staleTime: 30_000 });
  const planos = useQuery({ queryKey: ["produto", "planos", "todos"], queryFn: () => listarPlanos(true), staleTime: 300_000 });
  const agora = useAgora();
  const [aberta, setAberta] = useState<string | null>(null);

  const dados = monitor.data;
  const saude = dados ? dados.saude : [];
  const empresas = dados ? dados.empresas : undefined;
  const pontos = saude.slice().sort((a, b) => PESO[a.nivel] - PESO[b.nivel]);
  const problemas = saude.filter((s) => s.nivel === "problema").length;
  const atencoes = saude.filter((s) => s.nivel === "atencao").length;
  const geral: NivelDaSaude = problemas ? "problema" : atencoes ? "atencao" : "ok";
  const frase = problemas
    ? `${problemas} ${problemas === 1 ? "problema" : "problemas"}${atencoes ? ` e ${atencoes} para olhar` : ""}`
    : atencoes
      ? `${atencoes} ${atencoes === 1 ? "ponto pede" : "pontos pedem"} atenção`
      : "Tudo em ordem";
  const somar = (campo: "novos_hoje" | "movimentos_hoje" | "abertos" | "valor_aberto" | "novos_7d") => (empresas || []).reduce((s, e) => s + e[campo], 0);
  const usando = (empresas || []).filter((e) => emUsoAgora(e, agora)).length;
  const total = empresas ? empresas.length : contas.data ? contas.data.length : 0;
  const doMonitor = useMemo(() => {
    const m: Record<string, EmpresaNoMonitor> = {};
    (empresas || []).forEach((e) => {
      m[e.id] = e;
    });
    return m;
  }, [empresas]);
  const lista = useMemo(() => ordenarPeloMonitor(contas.data || [], empresas), [contas.data, empresas]);
  const nomeDoPlano = (id: string) => ((planos.data || []).filter((p) => p.id === id)[0] || { nome: id }).nome;
  const contaAberta = (contas.data || []).filter((c) => c.id === aberta)[0] || null;
  const ou = (v: string) => (dados ? v : "…");

  return (
    <div className="min-w-0 space-y-6" data-monitor-do-produto="">
      <div className="flex min-w-0 items-center" data-saude-geral={dados ? geral : "lendo"}>
        {dados ? (
          <StatusPill tone={TOM[geral]} pulse={geral !== "ok"}>{frase}</StatusPill>
        ) : monitor.isError ? (
          <StatusPill tone="danger">Sem leitura do monitor</StatusPill>
        ) : (
          <span className="h-6 w-40 animate-pulse rounded-full bg-muted" aria-label="Lendo o monitor" />
        )}
        <span className={juntar(texto.auxiliar, "ml-3 min-w-0 flex-1 truncate tabular-nums")} aria-live="off">
          {dados ? `ao vivo · lido ${haQuanto(new Date(monitor.dataUpdatedAt).toISOString(), agora)}` : monitor.isError ? "" : "lendo o monitor"}
        </span>
        <button
          type="button"
          className={juntar(botao.icone, "ml-2")}
          onClick={() => {
            void monitor.refetch();
            void qc.invalidateQueries({ queryKey: chaveDasContas });
          }}
          aria-label="Reler agora"
          title="Reler agora"
        >
          <RefreshCw className={juntar("h-4 w-4", monitor.isFetching ? "animate-spin" : "")} aria-hidden="true" />
        </button>
      </div>

      <StatGrid label="O dia nos CRMs">
        <StatCard
          size="md"
          variant="ink"
          icon={<Activity className="h-4 w-4" />}
          progress={dados && total ? { value: usando, max: total } : undefined}
          label="Usando agora"
          value={ou(String(usando))}
          hint={`de ${total} ${total === 1 ? "empresa" : "empresas"}`}
        />
        <StatCard size="md" icon={<Sparkles className="h-4 w-4" />} label="Leads novos hoje" value={ou(String(somar("novos_hoje")))} hint={dados ? `${somar("novos_7d")} em 7 dias` : " "} />
        <StatCard size="md" icon={<Users className="h-4 w-4" />} label="Movimentos hoje" value={ou(String(somar("movimentos_hoje")))} hint="no funil das empresas" />
        <StatCard size="md" icon={<Handshake className="h-4 w-4" />} label="Em aberto" value={ou(reaisCurto(somar("valor_aberto"), reais))} hint={dados ? `${somar("abertos")} negócios` : " "} />
      </StatGrid>

      <Secao
        titulo="Está tudo em ordem?"
        descricao={dados ? `${saude.length - problemas - atencoes} de ${saude.length} em ordem` : undefined}
        ajuda="Cada cartão é uma parte do produto: e-mails, cobrança, acesso pelo plano do cliente, rotinas automáticas, Meta, WhatsApp e convites. O detalhe do erro fica no ? de cada cartão."
        recolher="produto:crm:monitor:saude"
      >
        {monitor.isError && !dados ? (
          <EstadoDeErro titulo="Não foi possível ler o monitor." acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void monitor.refetch()}>Tentar de novo</button>} />
        ) : !dados ? (
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Carregando a saúde do produto">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-[92px] animate-pulse rounded-lg bg-muted" style={{ opacity: 1 - i * 0.08 }} />
            ))}
          </div>
        ) : (
          <ul className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-lista-da-saude="">
            {pontos.map((s) => (
              <CardSurface as="li" key={s.chave} className="flex min-w-0 flex-col p-4" data-saude={s.chave} data-nivel={s.nivel}>
                <span className="flex min-w-0 items-center">
                  <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")}>{s.titulo}</span>
                  {(s.detalhe || s.quando) && (
                    <HelpTooltip className="ml-1" label={`Detalhe: ${s.titulo}`} title={s.titulo}>
                      {[s.resumo, s.detalhe, s.quando ? `${s.rotulo_quando || "última vez"} ${haQuanto(s.quando, agora)}` : ""].filter(Boolean).join(". ")}
                    </HelpTooltip>
                  )}
                </span>
                <span className={juntar(texto.auxiliar, "mt-1 block truncate")} title={s.resumo}>{s.resumo}</span>
                <span className="mt-3 flex min-w-0 items-center">
                  <Chip tone={TOM[s.nivel]} dot>{ROTULO_DO_NIVEL[s.nivel]}</Chip>
                  {s.quando && <span className={juntar(texto.auxiliar, "ml-auto truncate pl-2 tabular-nums")}>{haQuanto(s.quando, agora)}</span>}
                </span>
              </CardSurface>
            ))}
          </ul>
        )}
      </Secao>

      <Secao titulo="O CRM de cada empresa" descricao={contas.data ? `${lista.length} ${lista.length === 1 ? "empresa" : "empresas"} · quem mexeu por último primeiro` : undefined} recolher="produto:crm:monitor:empresas">
        {contas.isLoading ? (
          <ListaDeEmpresasCarregando />
        ) : contas.isError ? (
          <EstadoDeErro acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void contas.refetch()}>Tentar de novo</button>} />
        ) : lista.length === 0 ? (
          <EstadoVazio compacto titulo="Nenhuma empresa ainda." />
        ) : (
          <div data-lista-do-monitor="">
            <ListaDeEmpresas
              contas={lista}
              nomeDoPlano={nomeDoPlano}
              onAbrir={setAberta}
              aoVivo={(c) => emUsoAgora(doMonitor[c.id], agora)}
              linhaDeApoio={(c) => {
                const e = doMonitor[c.id];
                if (!e) return dados ? "sem movimento" : "lendo o movimento";
                const partes = [`mexeram ${haQuanto(e.ultima_atividade, agora)}`];
                if (e.novos_hoje) partes.push(`${e.novos_hoje} ${e.novos_hoje === 1 ? "lead novo" : "leads novos"} hoje`);
                if (e.tarefas_atrasadas) partes.push(`${e.tarefas_atrasadas} ${e.tarefas_atrasadas === 1 ? "tarefa atrasada" : "tarefas atrasadas"}`);
                if (e.convites) partes.push(`${e.convites} sem entrar`);
                return partes.join(" · ");
              }}
              valor={{
                titulo: "Em aberto",
                de: (c) => {
                  const e = doMonitor[c.id];
                  return e ? { valor: reaisCurto(e.valor_aberto, reais), apoio: `${e.abertos} ${e.abertos === 1 ? "negócio" : "negócios"}` } : { valor: dados ? reais(0) : "…" };
                },
              }}
            />
          </div>
        )}
      </Secao>

      {contaAberta && (
        <JanelaDaEmpresa
          key={contaAberta.id}
          conta={contaAberta}
          planos={planos.data || []}
          aoVivo={doMonitor[contaAberta.id] || null}
          onFechar={() => setAberta(null)}
          onMudou={() => qc.invalidateQueries({ queryKey: chaveDasContas })}
        />
      )}
    </div>
  );
}
