import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { CalendarCheck, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import {
  CabecalhoDePagina, Carregando, EstadoDeErro, EstadoVazio, SeletorCompacto, botao, juntar, larguraDaMesa, useAlturaQueCabe,
} from "@/components/sistema";
import CaixaPrecisaDeVoce from "@/components/esteira-linha/CaixaPrecisaDeVoce";
import GradeDaEsteira from "@/components/esteira-linha/GradeDaEsteira";
import LegendaDasEtapas from "@/components/esteira-linha/LegendaDasEtapas";
import SeletorDeClientes from "@/components/esteira-linha/SeletorDeClientes";
import { ESTILO_DA_ETAPA } from "@/components/esteira-linha/estilosDaEtapa";
import { useEsteiraLinha } from "@/hooks/useEsteiraLinha";
import { usePrecisaDeVoceDaEsteira } from "@/hooks/usePrecisaDeVoceDaEsteira";
import { dataEmSP } from "@/lib/diaPrioritario";
import {
  ajustarFiltroACarteira, aplicarFiltroDeClientes, diaDaSemanaEmSP, escolherModo, gravarFiltro, lerFiltroGuardado, type FiltroDeClientes,
} from "@/lib/esteiraLinha/filtroDeClientes";
import {
  ETAPAS_DA_ESTEIRA, diasDaSemana, diasDoPeriodoValido, msAteProximaMeiaNoiteSP, rotuloDaSemana, segundaDaSemana, somarDias,
  type CartaoDaEsteira, type DiasDoPeriodo, type FaixaDaEsteira,
} from "@/lib/esteiraLinha/esteiraLinha";
import { armazenamentoDoAparelho, gravarPeriodo, lerPeriodoGuardado } from "@/lib/esteiraLinha/preferenciasDaEsteira";

/** O painel da peça só carrega quando um cartão é aberto (a ficha da Agenda e a janela da tarefa são grandes). */
const PainelDaPeca = lazy(() => import("@/components/esteira-linha/PainelDaPeca"));

/** Teto do cochilo do relógio: aba em segundo plano pode adiar o timeout, então ele reconfere de poucos em poucos minutos. */
const RECONFERIR_A_CADA_MS = 5 * 60_000;

/**
 * O instante de referência da tela. Com a prop `agora` (testes), é só ela.
 * Sem a prop, é um relógio que acorda na próxima meia-noite de São Paulo (ou
 * em poucos minutos, o que vier antes) para o "Hoje" e o alvo de "Semana
 * atual" não congelarem numa aba aberta de um dia para o outro.
 */
function useAgoraEmSP(agora?: Date): Date {
  const [relogio, setRelogio] = useState(() => new Date());
  useEffect(() => {
    if (agora) return;
    const espera = Math.min(msAteProximaMeiaNoiteSP(relogio), RECONFERIR_A_CADA_MS);
    const timer = window.setTimeout(() => setRelogio(new Date()), espera);
    return () => window.clearTimeout(timer);
  }, [agora, relogio]);
  return agora ?? relogio;
}

/** Quais clientes aparecem, lembrado neste aparelho (localStorage). */
function useFiltroDeClientes() {
  const [filtro, setFiltro] = useState<FiltroDeClientes>(() => lerFiltroGuardado(armazenamentoDoAparelho()));
  const mudar = useCallback((novo: FiltroDeClientes) => {
    setFiltro(novo);
    gravarFiltro(armazenamentoDoAparelho(), novo);
  }, []);
  return [filtro, mudar] as const;
}

/** Uma ou duas semanas, lembrado neste aparelho (localStorage). */
function usePeriodo() {
  const [dias, setDias] = useState<DiasDoPeriodo>(() => lerPeriodoGuardado(armazenamentoDoAparelho()).dias);
  const mudar = useCallback((novo: DiasDoPeriodo) => {
    setDias(novo);
    gravarPeriodo(armazenamentoDoAparelho(), novo);
  }, []);
  return [dias, mudar] as const;
}

/** Abaixo disto a página volta a rolar um pouco (tela muito baixa): a grade nunca some. */
const ALTURA_MINIMA_NO_CELULAR = 380;
const FOLGA_EMBAIXO = 12;

/**
 * A página cabe na tela (pedido do Almir, 14/11/2026, 21h55): a altura vai
 * de onde a Esteira começa até o fim da área visível, e a grade fica com o
 * que sobra embaixo da barra e dos avisos.
 * - De 1024 px para cima é a medida do sistema (useAlturaQueCabe), que
 *   também tira o recuo de baixo do painel.
 * - Abaixo disso o sistema deixa a página rolar; aqui a Esteira mede sozinha
 *   pela casca do painel (no celular, a camada entre o topo e a barra de
 *   baixo; no tablet, a janela).
 */
function useAlturaDaEsteira(): { ref: RefObject<HTMLDivElement>; altura: number | null } {
  const { ref, altura: alturaLarga } = useAlturaQueCabe(true);
  const [alturaEstreita, setAlturaEstreita] = useState<number | null>(null);

  useEffect(() => {
    const medir = () => {
      const el = ref.current;
      if (!el || (window.innerWidth || 0) >= 1024) {
        setAlturaEstreita(null);
        return;
      }
      const casca = typeof el.closest === "function" ? (el.closest('[data-casca="conteudo"]') as HTMLElement | null) : null;
      const estilo = casca ? window.getComputedStyle(casca) : null;
      const cascaRola = Boolean(estilo && (estilo.overflowY === "auto" || estilo.overflowY === "scroll"));
      let fundo: number;
      let topo: number;
      if (casca && estilo && cascaRola) {
        fundo = casca.getBoundingClientRect().top + casca.clientHeight - (parseFloat(estilo.paddingBottom) || 0);
        topo = el.getBoundingClientRect().top + casca.scrollTop;
      } else {
        fundo = (window.innerHeight || 800) - FOLGA_EMBAIXO;
        topo = el.getBoundingClientRect().top + (window.pageYOffset || 0);
      }
      const nova = Math.max(ALTURA_MINIMA_NO_CELULAR, Math.round(fundo - topo));
      setAlturaEstreita((a) => (a !== null && Math.abs(a - nova) < 2 ? a : nova));
    };
    medir();
    const t1 = window.setTimeout(medir, 250);
    const t2 = window.setTimeout(medir, 900);
    window.addEventListener("resize", medir);
    window.addEventListener("orientationchange", medir);
    const RO = (window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    const obs = RO ? new RO(() => medir()) : null;
    if (obs) obs.observe(document.body);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("resize", medir);
      window.removeEventListener("orientationchange", medir);
      if (obs) obs.disconnect();
    };
  }, [ref]);

  return { ref, altura: alturaLarga ?? alturaEstreita };
}

/**
 * Celular (polimento v4, 15/11/2026): as ações do cabeçalho ganham a largura
 * toda embaixo do título e quebram em duas linhas (clientes e período em
 * cima; navegação e atualizar embaixo, ao lado das datas). Antes rolavam
 * escondidas e o primeiro botão aparecia cortado na borda.
 */
const CABECALHO_NO_CELULAR = [
  "max-sm:flex-wrap",
  "max-sm:[&>[data-acoes-do-cabecalho]]:mt-2",
  "max-sm:[&>[data-acoes-do-cabecalho]]:basis-full",
  "max-sm:[&>[data-acoes-do-cabecalho]]:flex-wrap",
  "max-sm:[&>[data-acoes-do-cabecalho]]:overflow-visible",
  "max-sm:[&>[data-acoes-do-cabecalho]>*:first-child]:ml-1",
].join(" ");

const OPCOES_DO_PERIODO = [
  { valor: "7", rotulo: "1 semana" },
  { valor: "14", rotulo: "2 semanas" },
];

/*
 * Esteira (fase 1, 14/11/2026): linha do tempo das peças. Os dias em cima,
 * uma faixa por cliente ativo e um cartão por peça, com a etapa em que ela
 * está; o dia prioritário de cada cliente fica marcado e avisa quando está
 * sem peça.
 *
 * Fase 2 (14/11/2026): no topo, a caixa "Precisa de você", só com o que
 * depende do dono; e o cartão mostra a revisão interna da agência.
 *
 * Limpeza (14/11/2026, 21h53 a 21h55, pedidos do Almir):
 * - uma barra só no topo: clientes, período (1 ou 2 semanas, lembrado no
 *   aparelho) e a navegação; a legenda foi para o "?" do título;
 * - "Precisa de você" nasce recolhida, só com o contador;
 * - o clique no cartão abre o painel da peça aqui mesmo (a ficha da Agenda
 *   ou a janela da tarefa); a página completa fica no menu "…";
 * - a página cabe na tela: a área das faixas rola por dentro e cada dia
 *   rola o próprio excesso (substitui o "+N" e o "sem rolagem" de 21h08).
 *
 * Não é a tela do Ciclo (/ciclo, AdminEsteira): aquela continua como está.
 */
export default function EsteiraLinhaDoTempo({ agora }: { agora?: Date }) {
  const referencia = useAgoraEmSP(agora);
  const hoje = useMemo(() => dataEmSP(referencia), [referencia]);
  const semanaAtual = useMemo(() => segundaDaSemana(referencia), [referencia]);
  // O período visível é do usuário: o relógio não o avança sozinho. Se ele
  // deixar de começar na semana atual, o botão "Semana atual" fica habilitado.
  const [segunda, setSegunda] = useState(semanaAtual);
  const [quantosDias, mudarQuantosDias] = usePeriodo();
  const dias = useMemo(() => diasDaSemana(segunda, quantosDias), [segunda, quantosDias]);
  const { faixas, carregando, atualizando, erro, semClientes, recarregar } = useEsteiraLinha(segunda, quantosDias);
  const dono = usePrecisaDeVoceDaEsteira();
  const [filtroGuardado, mudarFiltro] = useFiltroDeClientes();
  const diaDeHoje = useMemo(() => diaDaSemanaEmSP(referencia), [referencia]);
  // Só ajusta à carteira depois que ela chegou: durante o carregamento, um id guardado não "some".
  const filtro = useMemo(
    () => (faixas.length > 0 ? ajustarFiltroACarteira(filtroGuardado, faixas.map((f) => f.clientId)) : filtroGuardado),
    [filtroGuardado, faixas],
  );
  const visiveis = useMemo(() => aplicarFiltroDeClientes(faixas, filtro, diaDeHoje), [faixas, filtro, diaDeHoje]);
  const [aberto, setAberto] = useState<{ cartao: CartaoDaEsteira; nomeDoCliente: string } | null>(null);
  const { ref, altura } = useAlturaDaEsteira();

  const duas = quantosDias === 14;
  const rotuloDoPeriodo = rotuloDaSemana(segunda, quantosDias);
  const andar = (sentido: -1 | 1) => setSegunda((s) => somarDias(s, sentido * quantosDias));

  const barra = (
    <>
      {!carregando && !erro && !semClientes && (
        <SeletorDeClientes faixas={faixas} filtro={filtro} diaDeHoje={diaDeHoje} onMudar={mudarFiltro} />
      )}
      <SeletorCompacto
        rotulo="Período"
        modo="segmentado"
        opcoes={OPCOES_DO_PERIODO}
        valor={String(quantosDias)}
        onEscolher={(v) => mudarQuantosDias(diasDoPeriodoValido(Number(v)))}
        className="max-sm:[&_[role=tab]]:px-2.5"
      />
      {/* Celular: a navegação desce para a segunda linha, ao lado do período (nada rola escondido nem fica cortado). */}
      <span className="!m-0 h-0 basis-full sm:hidden" aria-hidden="true" />
      <span className="inline-flex items-center max-sm:!ml-auto" role="group" aria-label="Navegar no período" data-navegacao-do-periodo="">
        <button type="button" className={botao.icone} onClick={() => andar(-1)} title={duas ? "Duas semanas antes" : "Semana anterior"} aria-label={duas ? "Duas semanas antes" : "Semana anterior"}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" className={juntar(botao.secundario, "mx-1 h-8 max-sm:w-8 max-sm:px-0")} onClick={() => setSegunda(semanaAtual)} disabled={segunda === semanaAtual} title="Semana atual">
          <CalendarCheck className="h-4 w-4 sm:hidden" aria-hidden="true" />
          <span className="max-sm:sr-only">Semana atual</span>
        </button>
        <button type="button" className={botao.icone} onClick={() => andar(1)} title={duas ? "Próximas duas semanas" : "Próxima semana"} aria-label={duas ? "Próximas duas semanas" : "Próxima semana"}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </span>
      <button type="button" className={botao.icone} onClick={() => { recarregar(); dono.recarregar(); }} title="Atualizar" aria-label="Atualizar">
        <RefreshCw className={juntar("h-4 w-4", atualizando && "animate-spin")} aria-hidden="true" />
      </button>
    </>
  );

  return (
    <div
      ref={ref}
      style={altura !== null ? { height: altura } : undefined}
      className={juntar(larguraDaMesa, "flex flex-col gap-4 sm:gap-5")}
      data-esteira-linha=""
      data-cabe-na-tela={altura !== null ? "sim" : undefined}
    >
      <div className="relative shrink-0" data-barra-da-esteira="">
        <CabecalhoDePagina
          className={CABECALHO_NO_CELULAR}
          titulo="Esteira"
          descricao={rotuloDoPeriodo}
          ajuda={<>
            <p>Cada cartão é uma peça, no dia em que sai. Clique para ver e resolver aqui mesmo.</p>
            <LegendaDasEtapas />
          </>}
          acoes={barra}
        />
        {/* O cabeçalho esconde a linha de apoio no celular; o período visível precisa aparecer sempre. */}
        <p className="absolute bottom-1 left-0 flex h-8 max-w-[calc(100%-164px)] items-center text-[13px] font-semibold tracking-[-0.01em] text-foreground sm:hidden" aria-hidden="true"><span className="truncate">{rotuloDoPeriodo}</span></p>
      </div>

      {!carregando && !erro && !semClientes && visiveis.length > 0 && <ResumoDasEtapas faixas={visiveis} />}

      <CaixaPrecisaDeVoce pedidos={dono.pedidos} carregando={dono.carregando} incompleta={dono.incompleta} />

      {carregando ? <Carregando linhas={5} rotulo="Lendo a Esteira do período" />
        : erro ? <EstadoDeErro titulo="Não foi possível ler a Esteira." descricao={erro.message} acao={<button type="button" className={botao.secundario} onClick={recarregar}>Tentar de novo</button>} />
          : semClientes ? <EstadoVazio titulo="Nenhum cliente ativo." descricao="A Esteira mostra uma faixa para cada cliente com plano ativo." />
            : visiveis.length > 0 ? (
              <GradeDaEsteira
                dias={dias}
                faixas={visiveis}
                hoje={hoje}
                aoAbrirCartao={(cartao, faixa) => setAberto({ cartao, nomeDoCliente: faixa.nome })}
              />
            ) : (
              <EstadoVazio
                titulo="Nenhum cliente tem dia prioritário hoje"
                descricao={diaDeHoje > 5 ? "Fim de semana não é dia prioritário de nenhum cliente." : "Nenhum cliente ativo tem o dia prioritário neste dia da semana."}
                acao={<button type="button" className={botao.secundario} onClick={() => mudarFiltro(escolherModo("todos"))}>Ver todos os clientes</button>}
              />
            )}

      {aberto && (
        <Suspense fallback={null}>
          <PainelDaPeca
            key={aberto.cartao.chave}
            cartao={aberto.cartao}
            nomeDoCliente={aberto.nomeDoCliente}
            aoFechar={() => setAberto(null)}
            aoMudar={recarregar}
          />
        </Suspense>
      )}
    </div>
  );
}

/**
 * Resumo do período à vista (rodada ousada, 15/11/2026): quantas peças há na
 * grade e como elas se dividem pelas etapas, numa barra só. Conta os mesmos
 * cartões que a grade mostra; não lê nada novo. Some no celular e na tela
 * baixa (a grade é o assunto) e quando não há peça.
 */
function ResumoDasEtapas({ faixas }: { faixas: FaixaDaEsteira[] }) {
  const porEtapa = useMemo(() => {
    const conta = new Map<string, number>();
    for (const f of faixas) for (const c of f.celulas) for (const k of c.cartoes) conta.set(k.etapa, (conta.get(k.etapa) ?? 0) + 1);
    return conta;
  }, [faixas]);
  const total = Array.from(porEtapa.values()).reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const partes = ETAPAS_DA_ESTEIRA.map((e) => ({ ...e, n: porEtapa.get(e.etapa) ?? 0 })).filter((e) => e.n > 0);
  return (
    <div className="hidden shrink-0 items-center lg:flex [@media(max-height:760px)]:hidden" data-resumo-das-etapas="" role="group" aria-label={`${total} ${total === 1 ? "peça" : "peças"} no período, por etapa`}>
      <p className="mr-5 flex shrink-0 items-baseline">
        <span className="text-[32px] font-semibold leading-9 tracking-[-0.035em] tabular-nums text-foreground">{total}</span>
        <span className="ml-2 text-[13px] text-muted-foreground">{total === 1 ? "peça" : "peças"}</span>
      </p>
      <div className="min-w-0 flex-1">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          {partes.map((e) => (
            <span key={e.etapa} className={juntar("h-full border-r-2 border-background last:border-r-0", ESTILO_DA_ETAPA[e.etapa].ponto)} style={{ width: `${(e.n / total) * 100}%` }} />
          ))}
        </div>
        <ul className="mt-2 flex min-w-0 flex-wrap items-center">
          {partes.map((e) => (
            <li key={e.etapa} className="mr-4 flex items-center text-[12px] leading-4 text-muted-foreground">
              <span className={juntar("mr-1.5 h-2 w-2 shrink-0 rounded-full", ESTILO_DA_ETAPA[e.etapa].ponto)} aria-hidden="true" />
              {e.rotulo}
              <span className="ml-1.5 font-semibold tabular-nums text-foreground">{e.n}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
