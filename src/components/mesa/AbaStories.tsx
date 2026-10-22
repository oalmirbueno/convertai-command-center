import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarClock, Clapperboard, Flame, GalleryVerticalEnd, RefreshCw, Star } from "lucide-react";
import AreaDeTrabalho, { abrirLateralDaArea } from "@/components/sistema/AreaDeTrabalho";
import Etapas from "@/components/sistema/Etapas";
import { Carregando, EstadoDeErro } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { useMesa } from "./MesaContexto";
import BlocoSequencia from "./stories/BlocoSequencia";
import BlocoVirais from "./stories/BlocoVirais";
import BlocoDestaques from "./stories/BlocoDestaques";
import BlocoAgenda from "./stories/BlocoAgenda";
import AgenteDosStories from "./stories/AgenteDosStories";
import EditorDoStory, { type StoryNoEditor } from "./stories/EditorDoStory";
import { useMarcaDosStories } from "./stories/marcaDosStories";
import { hojeLocal, sequenciaQueAbre, storiesDaSequencia, useAtualizarStories, usePainelDosStories, type Story } from "./stories/storiesApi";

/**
 * Aba Stories da Mesa (20/10/2026, docs/mesa/STORIES.md), para todos os
 * clientes, logo depois de Redes. Quatro blocos (etapas internas, como na aba
 * Redes): Sequência (a novela do dia, padrão), Virais (os moldes), Destaques
 * (stories por destaque e as capas da aba Redes) e Agenda (a semana).
 * O agente dos stories fica ao lado (recolhível; gaveta no celular).
 * Endereço: /mesa?client=<id>&aba=stories[&bloco=sequencia|virais|destaques|agenda]
 * (o bloco do endereço abre e sai do endereço; a escolha fica guardada por cliente).
 */

type Bloco = "sequencia" | "virais" | "destaques" | "agenda";

const BLOCOS: Array<{ valor: Bloco; rotulo: string; icone: ReactNode; ajuda: string }> = [
  {
    valor: "sequencia",
    rotulo: "Sequência",
    icone: <Clapperboard className="h-4 w-4" />,
    ajuda: "A sequência que converte (gancho, problema ou desejo, prova, oferta e CTA com adesivo), num modelo pronto ou da campanha: as imagens saem do gerador do Estúdio em 9:16 com o texto integrado; as telas ficam em cartões ao lado do celular. Com adesivo vai pelo app; sem adesivo o painel publica sozinho.",
  },
  { valor: "virais", rotulo: "Virais", icone: <Flame className="h-4 w-4" />, ajuda: "Moldes de story viral para encaixar na sequência aberta, já adaptados ao nicho do cliente." },
  { valor: "destaques", rotulo: "Destaques", icone: <Star className="h-4 w-4" />, ajuda: "Os stories marcados para cada destaque e as capas (as mesmas da aba Redes)." },
  { valor: "agenda", rotulo: "Agenda", icone: <CalendarClock className="h-4 w-4" />, ajuda: "A semana de stories por dia e horário, com a situação de cada um e o Postei dos que vão pelo app." },
];

const ehBloco = (v: unknown): v is Bloco => BLOCOS.some((b) => b.valor === v);

export default function AbaStories() {
  const { clientId, clientName } = useMesa();
  const [params, setParams] = useSearchParams();
  const painel = usePainelDosStories(clientId);
  const atualizar = useAtualizarStories(clientId);
  const marca = useMarcaDosStories(clientId);
  const [bloco, setBloco] = useEstadoDaTela<Bloco>(`mesa:stories:bloco:${clientId}`, "sequencia", { validar: ehBloco });
  const [sequenciaId, setSequenciaId] = useEstadoDaTela<string | null>(`mesa:stories:sequencia:${clientId}`, null);
  const [editando, setEditando] = useState<StoryNoEditor | null>(null);
  const [pedido, setPedido] = useState<{ texto: string; n: number } | null>(null);

  // ?bloco= (o aviso "Postar agora pelo app" e o caminho do agente): abre o bloco e sai do endereço.
  const blocoUrl = params.get("bloco");
  useEffect(() => {
    if (!blocoUrl) return;
    if (ehBloco(blocoUrl)) setBloco(blocoUrl);
    const next = new URLSearchParams(params);
    next.delete("bloco");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocoUrl]);

  const dados = painel.data || null;
  const sequencia = useMemo(() => {
    if (!dados) return null;
    return dados.sequencias.find((s) => s.id === sequenciaId) || sequenciaQueAbre(dados.sequencias, hojeLocal());
  }, [dados, sequenciaId]);
  const doDia = useMemo(() => (dados && sequencia ? storiesDaSequencia(dados.stories, sequencia.id) : []), [dados, sequencia]);
  const proximaOrdem = doDia.length ? doDia[doDia.length - 1].ordem + 1 : 1;
  const sequenciaDoEditor = editando && dados ? dados.sequencias.find((s) => s.id === editando.sequencia_id) || null : null;

  const pedirAoAgente = (t: string) => {
    abrirLateralDaArea();
    setPedido({ texto: t, n: Date.now() });
  };

  const contadores: Partial<Record<Bloco, number | null>> = {
    sequencia: doDia.length || null,
    agenda: dados ? dados.stories.filter((s) => s.situacao === "postar_pelo_app").length || null : null,
  };

  return (
    <AreaDeTrabalho
      memoria="mesa-stories"
      rotuloDaLateral="Agente dos stories"
      iconeDaLateral={<GalleryVerticalEnd className="h-4 w-4" />}
      rotuloDoPrincipal="Stories do cliente"
      memoriaDaRolagem={`mesa:stories:${clientId}:${bloco}`}
      lateral={
        <AgenteDosStories
          conversaId={dados ? dados.conversa.id : null}
          mensagens={dados ? dados.conversa.mensagens : []}
          pedido={pedido}
          onConversa={atualizar.conversa}
          onAcaoFeita={() => void atualizar.reler()}
          onBloco={(b) => ehBloco(b) && setBloco(b)}
        />
      }
    >
      <div className="min-w-0 space-y-5 pb-4" data-aba-stories="">
        <div className="flex min-w-0 items-center border-b border-border pb-1">
          <Etapas
            soIcone
            rotulo="Blocos dos stories"
            itens={BLOCOS.map((b) => ({ valor: b.valor, rotulo: b.rotulo, icone: b.icone, ajuda: b.ajuda, contador: contadores[b.valor] || null }))}
            valor={bloco}
            onEscolher={(v) => ehBloco(v) && setBloco(v)}
            className="-mx-1 min-w-0 flex-1"
          />
          <span className={juntar(texto.auxiliar, "ml-2 shrink-0 tabular-nums")} aria-live="polite">
            {painel.isFetching && dados ? "lendo..." : ""}
          </span>
          <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => void painel.refetch()} disabled={painel.isFetching} aria-label="Ler de novo" title="Ler de novo">
            <RefreshCw className={juntar("h-4 w-4", painel.isFetching ? "animate-spin" : "")} aria-hidden="true" />
          </button>
        </div>

        {dados && dados.aviso ? <p className="rounded-md bg-warning/10 px-3 py-1.5 text-[12px] leading-5 text-foreground">{dados.aviso}</p> : null}
        {painel.isLoading ? <Carregando forma="aba" rotulo="Lendo os stories do cliente" /> : null}
        {painel.isError && !dados ? (
          <EstadoDeErro
            titulo="Não foi possível abrir a aba Stories."
            descricao={textoDoErro(painel.error)}
            acao={
              <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void painel.refetch()}>
                Tentar de novo
              </button>
            }
          />
        ) : null}

        {dados && bloco === "sequencia" ? (
          <BlocoSequencia
            clientId={clientId}
            painel={dados}
            marca={marca}
            atualizar={atualizar}
            sequencia={sequencia}
            stories={doDia}
            onSequencia={setSequenciaId}
            onEditar={setEditando}
          />
        ) : null}
        {dados && bloco === "virais" ? (
          <BlocoVirais
            clientId={clientId}
            moldes={dados.moldes}
            sequencia={sequencia}
            proximaOrdem={proximaOrdem}
            onInserido={(s) => {
              atualizar.stories([s]);
              setBloco("sequencia");
            }}
          />
        ) : null}
        {dados && bloco === "destaques" ? (
          <BlocoDestaques clientId={clientId} clientName={clientName} destaques={dados.destaques} stories={dados.stories} marca={marca} onAbrir={setEditando} onPedirAoAgente={pedirAoAgente} />
        ) : null}
        {dados && bloco === "agenda" ? <BlocoAgenda clientId={clientId} stories={dados.stories} marca={marca} onMudou={(s: Story) => atualizar.stories([s])} onAbrir={setEditando} /> : null}
      </div>

      <EditorDoStory
        aberto={editando}
        clientId={clientId}
        diaDaSequencia={sequenciaDoEditor ? sequenciaDoEditor.data : sequencia ? sequencia.data : null}
        destaques={dados ? dados.destaques : []}
        marca={marca}
        onFechar={() => setEditando(null)}
        onSalvo={(s) => atualizar.stories([s])}
        onApagado={(id) => atualizar.tirar(id)}
      />
    </AreaDeTrabalho>
  );
}
