import { useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDraggable, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownWideNarrow, Bot, ChevronRight, Clock, Download, GripVertical, KanbanSquare, ListFilter, Plus, Thermometer, ThumbsDown } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AreaDeTrabalho,
  CampoDeFormulario,
  Carregando,
  ColunaDoQuadro,
  EstadoVazio,
  QuadroKanban,
  SeletorCompacto,
  botao,
  campo,
  classesDoCartao,
  juntar,
  texto,
} from "@/components/sistema";
import {
  ESTAGIOS,
  ESTAGIOS_ABERTOS,
  type AgendaDoLead,
  type Atividade,
  type EstagioId,
  type Lead,
  CLASSES_DO_LEAD,
  agendaDoLead,
  dinheiro,
  entradaRecebida,
  leadQualificado,
  moverLead,
  rotuloDaClasse,
  rotuloDaAtividade,
  rotuloDoEstagio,
} from "@/lib/comercial";
import { CampoDeBusca } from "@/components/sistema";
import { ehTexto, umaDe, useEstadoDoComercial } from "./useEstadoDoComercial";
import Termometro from "./Termometro";
import { resumoDaOportunidade, valorDaOportunidade, type ResumoDaOportunidade } from "./resumoDaOportunidade";
import JanelaDoGanho from "./JanelaDoGanho";
import {
  FAIXAS_DO_FILTRO,
  LIMITES_DA_TEMPERATURA,
  ROTULO_DA_FAIXA,
  passaNoFiltroDeTemperatura,
  temperaturaDoLead,
  type EventoDoLead,
  type Temperatura,
} from "./temperatura";

/**
 * O funil, arrastável de ponta a ponta.
 *
 * Antes o estágio só mudava abrindo o lead e escolhendo o destino numa lista
 * (três toques para dizer "avançou"). Num funil, mover é o gesto principal:
 * é o que se faz dez vezes por dia e o que dá a leitura do quadro.
 *
 * O arrasto usa mouse e toque como SENSORES SEPARADOS, igual à agenda: com o
 * cartão inteiro arrastável, um sensor de ponteiro único captura o toque e
 * mata a rolagem no celular. Mouse dispara com 3px; no dedo, é preciso
 * segurar 150ms, e até lá a lista rola normalmente.
 *
 * Ganho e Perdido não são colunas: viram uma faixa que só aparece durante o
 * arrasto. Coluna de fechado incha para sempre e empurra o trabalho de hoje
 * para fora da tela; a faixa aparece na hora exata em que ela é útil.
 *
 * Rolagem (sistema de design): de 1024 px para cima o quadro ocupa a altura
 * da janela e cada coluna rola sozinha, lembrando onde estava; se as colunas
 * não cabem, o quadro rola para o lado por dentro. No tablet as colunas ficam
 * lado a lado e a página rola normal; no celular, uma etapa por vez.
 */

interface Props {
  leads: Lead[];
  atividades: Atividade[];
  /**
   * A história recente dos leads (commercial_lead_events): dá o tempo na
   * etapa e os sinais da temperatura. Sem ela, o tempo cai na criação.
   */
  eventos?: EventoDoLead[];
  carregando: boolean;
  clientes: Array<{ id: string; nome: string }>;
  onAbrir: (lead: Lead) => void;
  onNovo: () => void;
  onImportar: () => void;
  importando: boolean;
  onMovido: () => Promise<unknown>;
  /** Controles da página na mesma fileira dos filtros (ex.: Negócios | Empresas). */
  filtrosAntes?: ReactNode;
  /**
   * Lugar da página para os filtros (a linha das Etapas, de 1280 px para
   * cima): a fileira sobe para a linha das áreas e o quadro ganha altura.
   */
  destinoDosFiltros?: HTMLElement | null;
}

/**
 * O que decide se um lead está esquecido, num lugar só.
 *
 * Passou a olhar a AGENDA em vez do antigo `next_action_at`: o campo de
 * texto livre era uma anotação que ninguém atualizava, e a atividade é um
 * compromisso com data que alguém precisa concluir.
 */
const estaAtrasado = (agenda: AgendaDoLead) => agenda.atrasadas > 0;

const CLASSES_DO_FILTRO = ["todas", ...CLASSES_DO_LEAD.map((c) => c.id as string), "sem"];
// 25/10/2026: quem atende o lead (o Mercúrio ou a equipe).
const QUEM_ATENDE = ["todos", "mercurio", "equipe"];
export const passaNoFiltroDeQuemAtende = (lead: { agente_slug?: string | null }, quem: string) =>
  quem === "mercurio" ? lead.agente_slug === "mercurio" : quem === "equipe" ? !lead.agente_slug : true;

/** Lista vazia estável: um `[]` novo a cada render refaria as temperaturas. */
const SEM_EVENTOS: EventoDoLead[] = [];

/** 04/11/2026: Ganho e Perdido são colunas, como Fechados e Perdidos no funil do Freela. */
const COLUNAS_DO_QUADRO: EstagioId[] = [...ESTAGIOS_ABERTOS, "ganho", "perdido"];

export default function FunilKanban({
  leads,
  atividades,
  eventos = SEM_EVENTOS,
  carregando,
  clientes,
  onAbrir,
  onNovo,
  onImportar,
  importando,
  onMovido,
  filtrosAntes,
  destinoDosFiltros = null,
}: Props) {
  const queryClient = useQueryClient();
  const [arrastando, setArrastando] = useState<Lead | null>(null);
  // Busca, classe e etapa do celular ficam guardadas: sair e voltar mantém.
  const [busca, setBusca] = useEstadoDoComercial("funil:busca", "", { validar: ehTexto });
  // A visão separada por classe: cliente atual, upsell e novo prospect não
  // podem se misturar na leitura, mesmo dividindo os mesmos estágios.
  const [classe, setClasse] = useEstadoDoComercial<string>("funil:classe", "todas", { validar: umaDe(CLASSES_DO_FILTRO) });
  // Temperatura: filtrar por faixa e, se pedido, pôr o mais quente no topo.
  const [faixa, setFaixa] = useEstadoDoComercial<string>("funil:temperatura", "todas", { validar: umaDe(FAIXAS_DO_FILTRO) });
  const [quemAtende, setQuemAtende] = useEstadoDoComercial<string>("funil:quem-atende", "todos", { validar: umaDe(QUEM_ATENDE) });
  const [porTemperatura, setPorTemperatura] = useEstadoDoComercial<boolean>("funil:ordem-temperatura", false, {
    validar: (v) => typeof v === "boolean",
  });
  // No celular o quadro mostra UMA etapa por vez, escolhida nas Etapas: seis
  // colunas estreitas rolando de lado nao se leem em 380px de tela.
  const [etapaNoCelular, setEtapaNoCelular] = useEstadoDoComercial<EstagioId>("funil:etapa-no-celular", ESTAGIOS_ABERTOS[0], {
    validar: umaDe(COLUNAS_DO_QUADRO),
  });
  const [fechamento, setFechamento] = useState<{
    lead: Lead;
    destino: "ganho" | "perdido";
  } | null>(null);
  // Guarda o clique: sem isto, soltar o cartão no mesmo lugar abre o lead.
  const acabouDeArrastar = useRef(false);

  const agoraIso = new Date().toISOString();
  const termo = busca.trim().toLowerCase();
  const agendaDe = (lead: Lead) => agendaDoLead(atividades, lead.id, agoraIso);
  // O minuto basta para a temperatura: recalcular a cada render por causa do
  // segundo só gastaria. A régua mora em temperatura.ts (código puro).
  const minuto = agoraIso.slice(0, 16);
  const temperaturas = useMemo(() => {
    const mapa = new Map<string, Temperatura>();
    const agora = `${minuto}:00.000Z`;
    for (const lead of leads) mapa.set(lead.id, temperaturaDoLead(lead, atividades, eventos, agora));
    return mapa;
  }, [leads, atividades, eventos, minuto]);
  const temperaturaDe = (lead: Lead) => temperaturas.get(lead.id) as Temperatura;
  const resumoDe = (lead: Lead) => resumoDaOportunidade(lead, atividades, eventos, agoraIso);

  const porEstagio = useMemo(() => {
    const mapa = new Map<string, Lead[]>();
    for (const estagio of COLUNAS_DO_QUADRO) mapa.set(estagio, []);
    for (const lead of leads) {
      if (!mapa.has(lead.stage)) continue;
      if (classe === "sem" ? lead.classe !== null : classe !== "todas" && lead.classe !== classe) {
        continue;
      }
      if (
        termo &&
        !`${lead.name} ${lead.company || ""}`.toLowerCase().includes(termo)
      ) {
        continue;
      }
      if (!passaNoFiltroDeQuemAtende(lead, quemAtende)) continue;
      const temperatura = temperaturas.get(lead.id);
      if (temperatura && !passaNoFiltroDeTemperatura(temperatura, faixa)) continue;
      mapa.get(lead.stage)!.push(lead);
    }
    // Atrasado primeiro: o quadro tem que empurrar para a mão o que está
    // parado, não escondê-lo no fim da coluna.
    for (const lista of mapa.values()) {
      lista.sort((a, b) => {
        // Pedido "mais quente primeiro": a temperatura manda e a agenda
        // desempata.
        if (porTemperatura) {
          const diferenca = (temperaturas.get(b.id)?.valor ?? 0) - (temperaturas.get(a.id)?.valor ?? 0);
          if (diferenca !== 0) return diferenca;
        }
        const agendaA = agendaDoLead(atividades, a.id, agoraIso);
        const agendaB = agendaDoLead(atividades, b.id, agoraIso);
        const atrasoA = estaAtrasado(agendaA) ? 0 : 1;
        const atrasoB = estaAtrasado(agendaB) ? 0 : 1;
        if (atrasoA !== atrasoB) return atrasoA - atrasoB;
        // Sem compromisso marcado vai para o fim: é o lead que ninguém
        // agendou, e o quadro precisa deixar isso visível.
        return (agendaA.proxima?.due_at || "9999").localeCompare(
          agendaB.proxima?.due_at || "9999",
        );
      });
    }
    return mapa;
  }, [leads, termo, classe, atividades, agoraIso, temperaturas, faixa, porTemperatura, quemAtende]);

  /**
   * Move na tela primeiro, grava depois.
   *
   * Esperar a ida ao banco para o cartão sair do lugar faz o arrasto parecer
   * quebrado, e quem arrasta tenta de novo, criando duas gravações. Se o
   * banco recusar, a lista é recarregada e o cartão volta sozinho.
   */
  const moverNaTela = (leadId: string, destino: EstagioId) => {
    queryClient.setQueryData<Lead[]>(["comercial-leads"], (atual) =>
      (atual || []).map((lead) =>
        lead.id === leadId ? { ...lead, stage: destino } : lead,
      ),
    );
  };

  const aplicarMovimento = async (
    lead: Lead,
    destino: EstagioId,
    motivo?: string,
  ) => {
    moverNaTela(lead.id, destino);
    const ok = await moverLead({ lead, paraEstagio: destino, motivo });
    await onMovido();
    if (!ok) {
      toast.error("Não foi possível mover o lead.");
      return;
    }
    toast.success(`${lead.name} → ${rotuloDoEstagio(destino)}`);
  };

  const aoIniciar = (evento: DragStartEvent) => {
    const lead = (evento.active.data.current as { lead?: Lead } | undefined)?.lead;
    setArrastando(lead || null);
  };

  const aoTerminar = async (evento: DragEndEvent) => {
    const lead = (evento.active.data.current as { lead?: Lead } | undefined)?.lead;
    setArrastando(null);
    acabouDeArrastar.current = true;
    // O clique de "soltar" chega logo depois do fim do arrasto.
    window.setTimeout(() => {
      acabouDeArrastar.current = false;
    }, 120);
    const destino = evento.over?.id ? String(evento.over.id) : null;
    if (!lead || !destino || destino === lead.stage) return;

    // Fechar pede contexto: o motivo da perda é o que ensina o próximo lead,
    // e o cliente do ganho é a ponte para o financeiro responder quanto
    // aquele lead virou.
    if (destino === "ganho" || destino === "perdido") {
      setFechamento({ lead, destino });
      return;
    }
    await aplicarMovimento(lead, destino as EstagioId);
  };

  // O contador promete o que o quadro mostra: desde 04/11/2026 Ganho e Perdido são colunas e também contam.
  const abertos = leads.filter((lead) => (COLUNAS_DO_QUADRO as string[]).indexOf(lead.stage) >= 0);

  // A régua da visão: cada opção separa uma classe, e "sem classe" empurra
  // para a mão o que ainda não foi confirmado: não confirmado é estado
  // visível, não um buraco.
  const opcoesDeClasse = [
    { valor: "todas", rotulo: "Todas", descricao: "Todas as classes", contador: abertos.length },
    ...CLASSES_DO_LEAD.map((c) => ({
      valor: c.id as string,
      rotulo: c.label,
      contador: abertos.filter((lead) => lead.classe === c.id).length,
    })),
    { valor: "sem", rotulo: "Sem classe", contador: abertos.filter((lead) => !lead.classe).length },
  ];
  const opcoesDeTemperatura = FAIXAS_DO_FILTRO.map((f) => ({
    valor: f as string,
    rotulo: f === "todas" ? "Todas" : ROTULO_DA_FAIXA[f],
    descricao:
      f === "todas"
        ? "Todas as temperaturas"
        : f === "quente"
          ? `${LIMITES_DA_TEMPERATURA.quente} ou mais`
          : f === "morno"
            ? `de ${LIMITES_DA_TEMPERATURA.morno} a ${LIMITES_DA_TEMPERATURA.quente - 1}`
            : `abaixo de ${LIMITES_DA_TEMPERATURA.morno}`,
    contador: f === "todas" ? abertos.length : abertos.filter((lead) => temperaturas.get(lead.id)?.faixa === f).length,
  }));

  const emLinha = Boolean(destinoDosFiltros);
  const filtros = (
    <div
      className={emLinha ? "flex min-w-0 items-center [&>*+*]:ml-2" : "-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1"}
      role="group"
      aria-label="Filtros do funil"
    >
        {filtrosAntes}
        <SeletorCompacto
          rotulo="Classe"
          icone={<ListFilter className="h-3.5 w-3.5" />}
          opcoes={opcoesDeClasse}
          valor={classe}
          onEscolher={setClasse}
        />
        <SeletorCompacto
          rotulo="Quem atende"
          modo="lista"
          icone={<Bot className="h-3.5 w-3.5" />}
          opcoes={[
            { valor: "todos", rotulo: "Todos", descricao: "O Mercúrio e a equipe", contador: abertos.length },
            { valor: "mercurio", rotulo: "Atendidos pelo Mercúrio", contador: abertos.filter((lead) => lead.agente_slug === "mercurio").length },
            { valor: "equipe", rotulo: "Só a equipe", contador: abertos.filter((lead) => !lead.agente_slug).length },
          ]}
          valor={quemAtende}
          onEscolher={setQuemAtende}
        />
        <SeletorCompacto
          rotulo="Temperatura"
          modo="lista"
          icone={<Thermometer className="h-3.5 w-3.5" />}
          opcoes={opcoesDeTemperatura}
          valor={faixa}
          onEscolher={setFaixa}
        />
        {/* Só o ícone; o nome mora no title (padrão do painel). */}
        <button
          type="button"
          onClick={() => setPorTemperatura(!porTemperatura)}
          aria-pressed={porTemperatura}
          aria-label="Mais quente primeiro"
          title={porTemperatura ? "Mais quente primeiro (ligado; toque para voltar à ordem da agenda)" : "Mais quente primeiro"}
          className={juntar(botao.icone, "shrink-0", porTemperatura && "text-primary hover:text-primary")}
        >
          <ArrowDownWideNarrow className="h-4 w-4" aria-hidden="true" />
        </button>
        <CampoDeBusca
          valor={busca}
          onMudar={setBusca}
          placeholder="Buscar por nome ou empresa"
          rotulo="Buscar no funil"
          className={emLinha ? "w-[240px] desk:w-[300px]" : "min-w-[180px] flex-1 sm:max-w-[320px]"}
        />
    </div>
  );

  return (
    <>
      {destinoDosFiltros ? createPortal(filtros, destinoDosFiltros) : filtros}

      <AreaDeTrabalho principalRolavel={false} rotuloDoPrincipal="Funil" className={emLinha ? "" : "mt-3"}>
        {carregando ? (
          <Carregando rotulo="Carregando o funil" linhas={4} />
        ) : leads.length === 0 ? (
          <EstadoVazio
            icone={<KanbanSquare className="h-5 w-5" />}
            titulo="O funil está vazio"
            descricao="Cadastre quem já está em conversa ou traga quem preencheu o diagnóstico."
            acao={
              // 16/10/2026: só o ícone (os mesmos do título), nome no title.
              <div className="flex flex-wrap items-center justify-center [&>*]:m-1">
                <button type="button" onClick={onImportar} disabled={importando} className={juntar(botao.icone, "disabled:opacity-50")} aria-label="Trazer do diagnóstico" title="Trazer do diagnóstico">
                  <Download className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={onNovo} className={juntar(botao.icone, "text-primary hover:text-primary")} aria-label="Novo lead" title="Novo lead">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            }
          />
        ) : (
          <QuadroKanban
            aoIniciar={aoIniciar}
            aoTerminar={(e) => void aoTerminar(e)}
            aoCancelar={() => setArrastando(null)}
            etapas={COLUNAS_DO_QUADRO.map((estagio) => ({
              valor: estagio,
              rotulo: rotuloDoEstagio(estagio),
              contador: (porEstagio.get(estagio) || []).length,
            }))}
            etapaNoCelular={etapaNoCelular}
            aoEscolherEtapa={(v) => setEtapaNoCelular(v as EstagioId)}
            fantasma={arrastando ? { titulo: arrastando.name, apoio: arrastando.company } : null}
          >
            {COLUNAS_DO_QUADRO.map((estagio) => (
              <Coluna
                key={estagio}
                visivelNoCelular={etapaNoCelular === estagio}
                estagio={estagio}
                leads={porEstagio.get(estagio) || []}
                agendaDe={agendaDe}
                temperaturaDe={temperaturaDe}
                resumoDe={resumoDe}
                arrastandoAlgo={Boolean(arrastando)}
                onAbrir={(lead) => {
                  if (acabouDeArrastar.current) return;
                  onAbrir(lead);
                }}
              />
            ))}
          </QuadroKanban>
        )}
      </AreaDeTrabalho>

      {fechamento && fechamento.destino === "ganho" && (
        <JanelaDoGanho
          lead={fechamento.lead}
          clientes={clientes}
          onCancelar={async () => {
            setFechamento(null);
            await onMovido();
          }}
          onConcluido={async () => {
            setFechamento(null);
            await onMovido();
          }}
        />
      )}
      {fechamento && fechamento.destino === "perdido" && (
        <DialogoDePerda
          lead={fechamento.lead}
          onCancelar={async () => {
            setFechamento(null);
            // O cartão pode ter sido movido na tela por outro caminho; a
            // recarga garante que ele volte para onde o banco diz.
            await onMovido();
          }}
          onConfirmar={async (motivo) => {
            const alvo = fechamento;
            setFechamento(null);
            await aplicarMovimento(alvo.lead, alvo.destino, motivo);
          }}
        />
      )}
    </>
  );
}

/* ─────────────────────────────── Coluna ─────────────────────────────────── */

function Coluna({
  visivelNoCelular,
  estagio,
  leads,
  agendaDe,
  temperaturaDe,
  resumoDe,
  arrastandoAlgo,
  onAbrir,
}: {
  visivelNoCelular: boolean;
  estagio: EstagioId;
  leads: Lead[];
  agendaDe: (lead: Lead) => AgendaDoLead;
  temperaturaDe: (lead: Lead) => Temperatura;
  resumoDe: (lead: Lead) => ResumoDaOportunidade;
  arrastandoAlgo: boolean;
  onAbrir: (lead: Lead) => void;
}) {
  // No ganho conta só a entrada que já entrou; nas outras colunas a entrada ainda é promessa inteira.
  const emJogo = leads.reduce(
    (soma, lead) => soma + lead.monthly_value * 12 + (estagio === "ganho" ? entradaRecebida(lead) : lead.one_off_value),
    0,
  );
  // Qualificada = classe + dono + próximo passo agendado. O placar fica no
  // topo da coluna porque "quantas dessas são de verdade" é a pergunta que
  // se faz olhando o estágio, não abrindo lead por lead.
  const qualificadas = leads.filter((lead) =>
    leadQualificado(lead, Boolean(agendaDe(lead).proxima)),
  ).length;
  const ajuda = ESTAGIOS.find((e) => e.id === estagio)?.ajuda;
  const rotulo = rotuloDoEstagio(estagio);

  return (
    <ColunaDoQuadro
      id={estagio}
      rotulo={rotulo}
      ajuda={ajuda}
      contagem={leads.length}
      resumo={
        estagio === "ganho" || estagio === "perdido"
          ? emJogo > 0 ? dinheiro(emJogo) : "vazio"
          : `${emJogo > 0 ? `${dinheiro(emJogo)} em jogo` : "vazio"}${leads.length > 0 ? ` · ${qualificadas}/${leads.length} qualificadas` : ""}`
      }
      visivelNoCelular={visivelNoCelular}
      arrastandoAlgo={arrastandoAlgo}
      memoria={`comercial:funil:${estagio}`}
      vazio="Nenhum lead nesta etapa."
    >
      {leads.map((lead) => (
        <Cartao
          key={lead.id}
          lead={lead}
          agenda={agendaDe(lead)}
          temperatura={temperaturaDe(lead)}
          resumo={resumoDe(lead)}
          onAbrir={onAbrir}
        />
      ))}
    </ColunaDoQuadro>
  );
}

/* ─────────────────────────────── Cartão ─────────────────────────────────── */

function Cartao({
  lead,
  agenda,
  temperatura,
  resumo,
  onAbrir,
}: {
  lead: Lead;
  agenda: AgendaDoLead;
  temperatura: Temperatura;
  resumo: ResumoDaOportunidade;
  onAbrir: (lead: Lead) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `lead:${lead.id}`,
    data: { lead },
  });
  const fechado = lead.stage === "ganho" || lead.stage === "perdido";
  const atrasado = !fechado && estaAtrasado(agenda);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onAbrir(lead)}
      role="button"
      tabIndex={0}
      aria-label={`Abrir lead ${lead.name}`}
      onKeyDown={(evento) => {
        if (evento.key === "Enter") onAbrir(lead);
      }}
      className={classesDoCartao(isDragging, atrasado)}
    >
      {/* 16/10/2026: no celular o cartão vira item de lista de app: inicial
          num círculo, nome, uma linha de apoio (empresa ou valor) e o sinal à
          direita. Classe e próximo passo ficam para dentro do lead. */}
      <div className="flex items-start max-sm:items-center">
        <GripVertical className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50 max-sm:hidden" aria-hidden="true" />
        <span
          aria-hidden="true"
          className={juntar(
            "mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold sm:hidden",
            atrasado ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary",
          )}
        >
          {(lead.name.trim().charAt(0) || "?").toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          {/* Nome e termômetro na mesma linha: a temperatura (com o porquê
              no title) é a primeira leitura depois de quem é. */}
          <div className="flex min-w-0 items-center">
            <p className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-foreground max-sm:text-[14px]">
              {lead.name}
            </p>
            {lead.agente_slug === "mercurio" && (
              <span className="ml-1.5 inline-flex shrink-0 items-center rounded bg-primary/10 px-1 text-[11px] font-medium leading-4 text-primary" title="O Mercúrio atende este lead" data-selo-mercurio="">
                <Bot className="mr-0.5 h-3 w-3" aria-hidden="true" />
                Mercúrio
              </span>
            )}
            <Termometro temperatura={temperatura} className="ml-1.5" />
          </div>
          {lead.company && (
            <p className={juntar(texto.auxiliar, "truncate")}>{lead.company}</p>
          )}
          <p className={juntar("mt-0.5 truncate text-[11px] leading-4 max-sm:hidden", lead.classe ? "text-muted-foreground" : "italic text-muted-foreground/70")}>
            {rotuloDaClasse(lead.classe)}
          </p>
          <p className={juntar("mt-1 truncate text-[12px] font-medium tabular-nums text-primary", lead.company ? "max-sm:hidden" : "max-sm:mt-0")} title={valorDaOportunidade(lead)}>
            {valorDaOportunidade(lead)}
          </p>
          {/* Resumo rápido: chance da etapa e há quanto tempo está nela. */}
          <p className="mt-0.5 truncate text-[11px] tabular-nums leading-4 text-muted-foreground max-sm:hidden" title={`Chance de fechar nesta etapa: ${resumo.chance}%`}>
            {resumo.chance}% · {resumo.tempoNaEtapa}
          </p>
          {/* O compromisso marcado, não uma anotação: é o que diz se este
              lead tem alguém cuidando dele. Com o quando, para não precisar
              abrir o lead para saber se é hoje. */}
          {fechado ? (
            lead.lost_reason ? <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground max-sm:hidden">{lead.lost_reason}</p> : null
          ) : agenda.proxima ? (
            <p
              className={juntar(
                "mt-1 truncate text-[11px] leading-4 max-sm:hidden",
                atrasado ? "font-medium text-warning" : "text-muted-foreground",
              )}
              title={`${rotuloDaAtividade(agenda.proxima.kind)}: ${agenda.proxima.title}${resumo.quando ? ` · ${resumo.quando}` : ""}`}
            >
              {atrasado ? "Atrasado: " : `${rotuloDaAtividade(agenda.proxima.kind)}: `}
              {agenda.proxima.title}
              {resumo.quando && !atrasado ? ` · ${resumo.quando}` : ""}
            </p>
          ) : (
            <p className="mt-1 text-[11px] italic leading-4 text-muted-foreground/70 max-sm:hidden">
              sem próximo passo
            </p>
          )}
        </div>
        {/* O sinal do celular: relógio âmbar quando atrasado, seta quando em dia. */}
        <span className="ml-2 inline-flex shrink-0 sm:hidden" aria-hidden="true">
          {atrasado ? (
            <Clock className="h-4 w-4 text-warning" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
          )}
        </span>
      </div>
    </div>
  );
}

/* ───────────────────────── Diálogo de fechamento ────────────────────────── */

function DialogoDePerda({
  lead,
  onCancelar,
  onConfirmar,
}: {
  lead: Lead;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onCancelar()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center text-[15px]">
            <ThumbsDown className="mr-2 h-4 w-4 text-destructive" aria-hidden="true" />
            Perdeu {lead.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <CampoDeFormulario rotulo="Por que não seguiu?" obrigatorio ajuda="É a única linha que ensina o próximo lead.">
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Preço, prazo, escolheu outro, sumiu"
              className={campo}
              autoFocus
            />
          </CampoDeFormulario>

          <div className="flex items-center justify-end [&>*+*]:ml-2">
            <button type="button" onClick={onCancelar} className={botao.secundario}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                if (motivo.trim().length < 3) {
                  toast.error("Escreva o motivo em uma linha.");
                  return;
                }
                onConfirmar(motivo);
              }}
              className={juntar(botao.primario, "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
            >
              Confirmar perda
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
