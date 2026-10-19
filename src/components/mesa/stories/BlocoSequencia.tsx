import { useMemo, useRef, useState } from "react";
import { CalendarCheck, Clapperboard, Copy, Download, Loader2, Pencil, Plus, Sparkles, Square, Wand2 } from "lucide-react";
import { toast } from "sonner";
import Secao from "@/components/sistema/Secao";
import { EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { useMesa } from "../MesaContexto";
import { avisarCustoReal, useAvisarErro } from "../Custo";
import { copiarTexto } from "../instagram/instagramApi";
import { noFuso } from "../instagram/calendario-da-grade";
import PreviaDoStory from "./PreviaDoStory";
import { baixarArteDoStory, gerarArteDoStory } from "./arteDoStory";
import type { MarcaDosStories } from "./marcaDosStories";
import type { StoryNoEditor } from "./EditorDoStory";
import {
  chamarStories,
  diaCurto,
  hojeLocal,
  normalizarSequencia,
  normalizarStory,
  OBJETIVOS,
  roteiroDoAdesivo,
  rotuloDoObjetivo,
  SITUACOES,
  somarDias,
  type PainelDosStories,
  type Sequencia,
  type Story,
  type useAtualizarStories,
} from "./storiesApi";

/**
 * Bloco Sequência (a novela do dia): escolher o dia, o objetivo e quantos
 * stories e pedir ao agente; a sequência aparece numa fila de cartões 9:16
 * (como o celular mostra), cada um abre o editor. "Gerar artes" monta cada
 * PNG na tela e registra como arquivo do cliente; "Agendar a sequência" leva
 * à agenda (automático no motor, pelo app com o aviso para a equipe).
 */

const LARGURA_DO_CARTAO = 176;
const QUANTIDADES = [3, 4, 5, 6, 7, 8];

type Pedido = { data: string; objetivo: string; quantidade: number; pedido: string };

/** Pode gerar a arte: ainda não foi para a agenda nem saiu. */
export const precisaDeArte = (s: Story) => (s.situacao === "rascunho" || s.situacao === "falhou" || !s.file_id) && s.situacao !== "publicado" && s.situacao !== "agendado" && s.situacao !== "postar_pelo_app";

/** Pronto para agendar: arte, horário e ainda fora da agenda. */
export const prontoParaAgendar = (s: Story) => !!s.file_id && !!s.horario && (s.situacao === "arte_pronta" || s.situacao === "rascunho" || s.situacao === "falhou");

function horaDe(s: Story): string {
  return s.horario ? noFuso(s.horario).hora : "sem horário";
}

export default function BlocoSequencia({
  clientId,
  painel,
  marca,
  atualizar,
  sequencia,
  stories,
  onSequencia,
  onEditar,
}: {
  clientId: string;
  painel: PainelDosStories;
  marca: MarcaDosStories;
  atualizar: ReturnType<typeof useAtualizarStories>;
  sequencia: Sequencia | null;
  stories: Story[];
  onSequencia: (id: string) => void;
  onEditar: (s: StoryNoEditor) => void;
}) {
  const { atualizarCusto } = useMesa();
  const avisarErro = useAvisarErro();
  const [pedido, setPedido] = useEstadoDaTela<Pedido>(`mesa:stories:pedido:${clientId}`, { data: somarDias(hojeLocal(), 1), objetivo: "engajar", quantidade: 6, pedido: "" }, {
    validar: (v) => !!v && typeof (v as Pedido).data === "string" && typeof (v as Pedido).quantidade === "number",
  });
  const [planejando, setPlanejando] = useState(false);
  const [andamento, setAndamento] = useState<{ feitos: number; total: number } | null>(null);
  const [agendando, setAgendando] = useState(false);
  const [baixando, setBaixando] = useState<string | null>(null);
  const parar = useRef(false);

  const mudarPedido = (m: Partial<Pedido>) => setPedido({ ...pedido, ...m });
  const semArte = useMemo(() => stories.filter(precisaDeArte), [stories]);
  const prontos = useMemo(() => stories.filter(prontoParaAgendar), [stories]);
  const semHorario = stories.filter((s) => !s.horario && s.situacao !== "publicado").length;
  const sequenciasOrdenadas = useMemo(() => painel.sequencias.slice().sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0)), [painel.sequencias]);

  const planejar = async () => {
    setPlanejando(true);
    try {
      const r = await chamarStories<{ sequencia: unknown; stories: unknown[]; avisos?: unknown[]; custo_usd?: number }>("planejar_sequencia", clientId, {
        data: pedido.data,
        objetivo: pedido.objetivo,
        quantidade: pedido.quantidade,
        ...(pedido.pedido.trim() ? { pedido: pedido.pedido.trim() } : {}),
      });
      const seq = normalizarSequencia(r && r.sequencia);
      const novos = (r && Array.isArray(r.stories) ? r.stories : []).map(normalizarStory).filter((s) => !!s.id);
      if (!seq.id) throw new Error("O agente não devolveu a sequência.");
      atualizar.sequencia(seq);
      atualizar.stories(novos);
      onSequencia(seq.id);
      mudarPedido({ pedido: "" });
      if (Number(r && r.custo_usd) > 0) avisarCustoReal("Agente dos stories", r, atualizarCusto);
      // Repetição da semana que sobrou na versão escolhida: a equipe vê e ajusta no cartão.
      const avisos = (r && Array.isArray(r.avisos) ? r.avisos : []).filter((a): a is string => typeof a === "string" && !!a);
      if (avisos.length) toast.message("Sequência planejada com avisos", { description: avisos.join(" ") });
    } catch (e) {
      avisarErro(e, "Planejar a sequência");
    } finally {
      setPlanejando(false);
    }
  };

  const gerarArtes = async () => {
    parar.current = false;
    const alvo = semArte.slice();
    let feitas = 0;
    for (let i = 0; i < alvo.length; i++) {
      if (parar.current) break;
      setAndamento({ feitos: i, total: alvo.length });
      try {
        const novo = await gerarArteDoStory({ clientId, story: alvo[i], marca });
        atualizar.stories([novo]);
        feitas++;
      } catch (e) {
        toast.error(`A arte do story ${alvo[i].ordem} não saiu`, { description: textoDoErro(e) });
      }
    }
    setAndamento(null);
    if (feitas) toast.success(feitas === 1 ? "1 arte pronta" : `${feitas} artes prontas`);
  };

  const agendar = async () => {
    if (!prontos.length) return;
    setAgendando(true);
    try {
      const r = await chamarStories<{ stories: unknown[] }>("agendar", clientId, { ids: prontos.map((s) => s.id) });
      const novos = (r && Array.isArray(r.stories) ? r.stories : []).map(normalizarStory).filter((s) => !!s.id);
      atualizar.stories(novos);
      const app = novos.filter((s) => s.caminho === "pelo_app").length;
      toast.success(novos.length === 1 ? "1 story na agenda" : `${novos.length} stories na agenda`, app ? { description: `${app} pelo app: a equipe recebe o aviso no horário.` } : undefined);
      // Automático sem aprovação fica planejado (arte pronta) com o motivo: diz qual e por quê.
      const comMotivo = novos.filter((s) => s.motivo && s.situacao !== "agendado" && s.situacao !== "postar_pelo_app");
      if (comMotivo.length) toast.message(comMotivo.length === 1 ? `Story ${comMotivo[0].ordem} ainda não agendou` : `${comMotivo.length} stories ainda não agendaram`, { description: String(comMotivo[0].motivo) });
    } catch (e) {
      toast.error("Não deu para agendar", { description: textoDoErro(e) });
    } finally {
      setAgendando(false);
    }
  };

  const baixar = async (s: Story) => {
    setBaixando(s.id);
    try {
      await baixarArteDoStory(s, marca);
    } catch (e) {
      toast.error("Não deu para baixar a arte", { description: textoDoErro(e) });
    } finally {
      setBaixando(null);
    }
  };

  const novoStory = () => onEditar({ sequencia_id: sequencia ? sequencia.id : null, ordem: stories.length ? stories[stories.length - 1].ordem + 1 : 1 });

  return (
    <div className="min-w-0 space-y-6" data-bloco-dos-stories="sequencia">
      <Secao
        titulo="Nova sequência"
        recolher={`mesa:stories:nova:${clientId}`}
        ajuda="O agente monta a novela do dia: gancho, desenvolvimento, interação com adesivo, valor ou prova, convite e o gancho para amanhã. Lê a marca, o hype da semana e as últimas sequências para não repetir."
      >
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[150px_170px_110px_minmax(0,1fr)_auto] lg:items-end">
          <label className="min-w-0">
            <span className={texto.rotulo}>Dia</span>
            <input className={juntar(campo, "mt-1")} type="date" value={pedido.data} onChange={(e) => e.target.value && mudarPedido({ data: e.target.value })} />
          </label>
          <label className="min-w-0">
            <span className={texto.rotulo}>Objetivo</span>
            <select className={juntar(campo, "mt-1")} value={pedido.objetivo} onChange={(e) => mudarPedido({ objetivo: e.target.value })}>
              {OBJETIVOS.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            <span className={texto.rotulo}>Stories</span>
            <select className={juntar(campo, "mt-1")} value={pedido.quantidade} onChange={(e) => mudarPedido({ quantidade: Number(e.target.value) })}>
              {QUANTIDADES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            <span className={texto.rotulo}>Pedido (opcional)</span>
            <input className={juntar(campo, "mt-1")} value={pedido.pedido} onChange={(e) => mudarPedido({ pedido: e.target.value })} placeholder="Ex.: lançar o combo de sábado" />
          </label>
          <button type="button" className={botao.primario} onClick={() => void planejar()} disabled={planejando}>
            {planejando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            {planejando ? "Planejando..." : "Planejar com o agente"}
          </button>
        </div>
      </Secao>

      {!sequencia ? (
        <EstadoVazio icone={<Clapperboard className="h-5 w-5" />} titulo="Nenhuma sequência ainda" descricao="Escolha o dia e o objetivo e peça ao agente" />
      ) : (
        <Secao
          divisoria
          recolher={`mesa:stories:aberta:${clientId}`}
          titulo={sequencia.titulo || `Sequência de ${diaCurto(sequencia.data)}`}
          descricao={`${diaCurto(sequencia.data)} · ${rotuloDoObjetivo(sequencia.objetivo)} · ${stories.length} stories`}
          acao={
            <div className="flex min-w-0 flex-wrap items-center justify-end [&>*]:mb-1 [&>*]:ml-2">
              {sequenciasOrdenadas.length > 1 ? (
                <select className={juntar(campo, "h-8 w-[170px]")} value={sequencia.id} onChange={(e) => onSequencia(e.target.value)} aria-label="Sequência aberta">
                  {sequenciasOrdenadas.map((s) => (
                    <option key={s.id} value={s.id}>
                      {diaCurto(s.data)} · {rotuloDoObjetivo(s.objetivo)}
                    </option>
                  ))}
                </select>
              ) : null}
              {andamento ? (
                <span className="inline-flex items-center">
                  <span className={juntar(texto.auxiliar, "mr-1 tabular-nums")} aria-live="polite">
                    {andamento.feitos + 1} de {andamento.total}
                  </span>
                  <button type="button" className={botao.icone} onClick={() => (parar.current = true)} aria-label="Parar" title="Parar">
                    <Square className="h-4 w-4" aria-hidden="true" />
                  </button>
                </span>
              ) : (
                <button type="button" className={botao.secundario} onClick={() => void gerarArtes()} disabled={!semArte.length} title={semArte.length ? `Montar ${semArte.length} artes 1080 x 1920` : "Todas já têm arte"}>
                  <Wand2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Gerar artes
                  {semArte.length ? <span className="ml-1 tabular-nums">({semArte.length})</span> : null}
                </button>
              )}
              <button type="button" className={botao.primario} onClick={() => void agendar()} disabled={!prontos.length || agendando || !!andamento}>
                {agendando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <CalendarCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                Agendar a sequência
              </button>
            </div>
          }
        >
          {semHorario > 0 || (stories.length > 0 && !prontos.length && !semArte.length) ? (
            <p className={texto.auxiliar}>{semHorario > 0 ? `${semHorario} sem horário: abra o story e escolha a hora` : "Tudo na agenda"}</p>
          ) : null}

          <ol className="mt-4 flex min-w-0 overflow-x-auto overscroll-x-contain pb-3" aria-label="Stories da sequência" data-fila-de-stories="">
            {stories.map((s, i) => {
              const sit = SITUACOES[s.situacao];
              const app = s.caminho === "pelo_app";
              return (
                <li key={s.id} className="mr-3 shrink-0" style={{ width: LARGURA_DO_CARTAO }} data-story={s.id}>
                  <button type="button" className="block w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onEditar(s)} aria-label={`Editar o story ${s.ordem}`}>
                    <PreviaDoStory story={s} largura={LARGURA_DO_CARTAO} paleta={marca.paleta} familia={marca.familia} foto={marca.foto(s.fundo.imagem_id)} posicao={{ atual: i, total: stories.length }} />
                  </button>
                  <div className="mt-1.5 flex min-w-0 items-center">
                    <span className={juntar(texto.etiqueta, "mr-1.5 tabular-nums text-muted-foreground")}>{s.ordem}</span>
                    <span className={juntar(texto.auxiliar, "mr-1.5 tabular-nums")}>{horaDe(s)}</span>
                    <span className={juntar(etiqueta, "min-w-0 truncate", sit.tom)} title={s.motivo || undefined}>
                      {sit.rotulo}
                    </span>
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center">
                    <span className={juntar(texto.auxiliar, "mr-1 min-w-0 flex-1 truncate")} title={s.titulo}>
                      {s.titulo || s.molde.replace(/_/g, " ")}
                    </span>
                    {app ? (
                      <>
                        <button type="button" className={botao.icone} onClick={() => void copiarTexto(roteiroDoAdesivo(s)).then((ok) => (ok ? toast.success("Roteiro do adesivo copiado") : toast.error("Não deu para copiar")))} aria-label={`Copiar o roteiro do adesivo do story ${s.ordem}`} title="Copiar o roteiro do adesivo">
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button type="button" className={botao.icone} onClick={() => void baixar(s)} disabled={baixando === s.id} aria-label={`Baixar a arte do story ${s.ordem}`} title="Baixar arte">
                          {baixando === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
                        </button>
                      </>
                    ) : null}
                    <button type="button" className={botao.icone} onClick={() => onEditar(s)} aria-label={`Abrir o story ${s.ordem}`} title="Editar">
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
            <li className="shrink-0" style={{ width: LARGURA_DO_CARTAO }}>
              <button
                type="button"
                onClick={novoStory}
                className="flex w-full flex-col items-center justify-center rounded-md border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
                style={{ height: Math.round(LARGURA_DO_CARTAO * 1.7778) }}
              >
                <Plus className="h-5 w-5" aria-hidden="true" />
                <span className={juntar(texto.auxiliar, "mt-1")}>Story</span>
                <span className="sr-only">Adicionar um story na sequência</span>
              </button>
            </li>
          </ol>

          {sequencia.gancho_de_amanha ? (
            <p className={juntar(texto.auxiliar, "truncate")} title={sequencia.gancho_de_amanha}>
              Gancho para amanhã: {sequencia.gancho_de_amanha}
            </p>
          ) : null}
        </Secao>
      )}
    </div>
  );
}
