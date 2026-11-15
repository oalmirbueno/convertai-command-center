import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { CabecalhoDePagina, Carregando, EstadoDeErro, EstadoVazio, botao, espaco, juntar, larguraDaMesa } from "@/components/sistema";
import CaixaPrecisaDeVoce from "@/components/esteira-linha/CaixaPrecisaDeVoce";
import GradeDaEsteira from "@/components/esteira-linha/GradeDaEsteira";
import LegendaDasEtapas from "@/components/esteira-linha/LegendaDasEtapas";
import SeletorDeClientes from "@/components/esteira-linha/SeletorDeClientes";
import { useEsteiraLinha } from "@/hooks/useEsteiraLinha";
import { usePrecisaDeVoceDaEsteira } from "@/hooks/usePrecisaDeVoceDaEsteira";
import { dataEmSP } from "@/lib/diaPrioritario";
import {
  ajustarFiltroACarteira, aplicarFiltroDeClientes, diaDaSemanaEmSP, escolherModo, gravarFiltro, lerFiltroGuardado, type FiltroDeClientes,
} from "@/lib/esteiraLinha/filtroDeClientes";
import { diasDaSemana, msAteProximaMeiaNoiteSP, rotuloDaSemana, segundaDaSemana, somarDias } from "@/lib/esteiraLinha/esteiraLinha";

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

const armazenamento = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** Quais clientes aparecem, lembrado neste aparelho (localStorage). */
function useFiltroDeClientes() {
  const [filtro, setFiltro] = useState<FiltroDeClientes>(() => lerFiltroGuardado(armazenamento()));
  const mudar = useCallback((novo: FiltroDeClientes) => {
    setFiltro(novo);
    gravarFiltro(armazenamento(), novo);
  }, []);
  return [filtro, mudar] as const;
}

/*
 * Esteira (fase 1, 14/11/2026): linha do tempo só de leitura. Os dias da
 * semana em cima, uma faixa por cliente ativo e um cartão por peça, com a
 * etapa em que ela está; o dia prioritário de cada cliente fica marcado e
 * avisa quando está sem peça. O cartão abre a Agenda ou o Estúdio.
 *
 * Fase 2 (14/11/2026): no topo, a caixa "Precisa de você", só com o que
 * depende do dono, cada item com o link de onde se resolve; e o cartão passa
 * a mostrar a revisão interna da agência. A grade continua só de leitura.
 *
 * Organização (14/11/2026, 21h08): seletor "Clientes da Esteira" (Todos, Só
 * prioritários hoje ou clientes escolhidos, lembrado no aparelho), cada
 * cliente num bloco próprio com logo, dias grudados no topo ao descer, e
 * célula sem rolagem por dentro: acima de 3 peças, "+N" abre o resto.
 *
 * Não é a tela do Ciclo (/ciclo, AdminEsteira): aquela continua como está.
 */
export default function EsteiraLinhaDoTempo({ agora }: { agora?: Date }) {
  const referencia = useAgoraEmSP(agora);
  const hoje = useMemo(() => dataEmSP(referencia), [referencia]);
  const semanaAtual = useMemo(() => segundaDaSemana(referencia), [referencia]);
  // A semana visível é do usuário: o relógio não a avança sozinho. Se ela
  // deixar de ser a atual, o botão "Semana atual" fica habilitado para o clique.
  const [segunda, setSegunda] = useState(semanaAtual);
  const dias = useMemo(() => diasDaSemana(segunda), [segunda]);
  const { faixas, carregando, atualizando, erro, semClientes, recarregar } = useEsteiraLinha(segunda);
  const dono = usePrecisaDeVoceDaEsteira();
  const [filtroGuardado, mudarFiltro] = useFiltroDeClientes();
  const diaDeHoje = useMemo(() => diaDaSemanaEmSP(referencia), [referencia]);
  // Só ajusta à carteira depois que ela chegou: durante o carregamento, um id guardado não "some".
  const filtro = useMemo(
    () => (faixas.length > 0 ? ajustarFiltroACarteira(filtroGuardado, faixas.map((f) => f.clientId)) : filtroGuardado),
    [filtroGuardado, faixas],
  );
  const visiveis = useMemo(() => aplicarFiltroDeClientes(faixas, filtro, diaDeHoje), [faixas, filtro, diaDeHoje]);

  return (
    <div className={juntar(larguraDaMesa, espaco.pagina, "pb-10")} data-esteira-linha="">
      <CabecalhoDePagina
        titulo="Esteira"
        descricao={`Semana de ${rotuloDaSemana(segunda)}`}
        ajuda="As peças da semana de cada cliente ativo, no dia em que saem (ou no prazo da tarefa), com a etapa em que estão: pauta, arte, revisão, aprovação, agendado e no ar. O dia prioritário do cliente fica marcado e avisa quando está sem peça. O cartão abre a Agenda ou o Estúdio. No topo, Precisa de você traz só o que depende da sua decisão, com o link de onde se resolve. Em Clientes da Esteira você escolhe quem aparece (Todos, Só prioritários hoje ou clientes um a um), e a escolha fica lembrada neste aparelho. Dia com mais de 3 peças mostra +N para abrir o resto. Aqui nada é alterado."
        acoes={<>
          <button type="button" className={botao.icone} onClick={() => setSegunda((s) => somarDias(s, -7))} title="Semana anterior" aria-label="Semana anterior"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => setSegunda(semanaAtual)} disabled={segunda === semanaAtual}>Semana atual</button>
          <button type="button" className={botao.icone} onClick={() => setSegunda((s) => somarDias(s, 7))} title="Próxima semana" aria-label="Próxima semana"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" className={botao.icone} onClick={() => { recarregar(); dono.recarregar(); }} title="Atualizar" aria-label="Atualizar"><RefreshCw className={juntar("h-4 w-4", atualizando && "animate-spin")} aria-hidden="true" /></button>
        </>}
      />

      {/* O cabeçalho esconde a linha de apoio no celular; a semana visível precisa aparecer sempre. */}
      <p className="text-[13px] font-medium text-foreground sm:hidden" aria-hidden="true">Semana de {rotuloDaSemana(segunda)}</p>

      <CaixaPrecisaDeVoce pedidos={dono.pedidos} carregando={dono.carregando} incompleta={dono.incompleta} />

      {carregando ? <Carregando linhas={5} rotulo="Lendo a Esteira da semana" />
        : erro ? <EstadoDeErro titulo="Não foi possível ler a Esteira." descricao={erro.message} acao={<button type="button" className={botao.secundario} onClick={recarregar}>Tentar de novo</button>} />
          : semClientes ? <EstadoVazio titulo="Nenhum cliente ativo." descricao="A Esteira mostra uma faixa para cada cliente com plano ativo." />
            : <>
              <SeletorDeClientes faixas={faixas} filtro={filtro} diaDeHoje={diaDeHoje} onMudar={mudarFiltro} />
              {visiveis.length > 0 ? <GradeDaEsteira dias={dias} faixas={visiveis} hoje={hoje} />
                : (
                  <EstadoVazio
                    titulo="Nenhum cliente tem dia prioritário hoje"
                    descricao={diaDeHoje > 5 ? "Fim de semana não é dia prioritário de nenhum cliente." : "Nenhum cliente ativo tem o dia prioritário neste dia da semana."}
                    acao={<button type="button" className={botao.secundario} onClick={() => mudarFiltro(escolherModo("todos"))}>Ver todos os clientes</button>}
                  />
                )}
            </>}

      <LegendaDasEtapas />
    </div>
  );
}
