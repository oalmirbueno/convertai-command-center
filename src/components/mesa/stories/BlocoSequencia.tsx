import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, CheckCircle2, Clapperboard, Loader2, Megaphone, Wand2 } from "lucide-react";
import { toast } from "sonner";
import Secao from "@/components/sistema/Secao";
import { EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { useConfirm } from "@/components/shared/confirmDialog";
import { textoDoErro } from "@/lib/mesa/api";
import { useMarcaDaMesa, useMesa } from "../MesaContexto";
import { BotaoComCusto } from "../Custo";
import CartoesDaSequencia from "./CartoesDaSequencia";
import CelularDoStory from "./CelularDoStory";
import NovaSequencia from "./NovaSequencia";
import PainelDaTela from "./PainelDaTela";
import type { MarcaDosStories } from "./marcaDosStories";
import type { StoryNoEditor } from "./EditorDoStory";
import {
  campanhasDasSequencias,
  chamarStories,
  diaCurto,
  estruturaDaSequencia,
  gerarImagensDosStories,
  imagemDoStory,
  modeloPorChave,
  normalizarStory,
  partesDaEstimativaDosStories,
  precisaDeImagem,
  precisaRegistrar,
  registrarImagemDoStory,
  reordenarStories,
  ROTULO_DA_FASE,
  ROTULO_DO_PAPEL,
  rotuloDoObjetivo,
  useLaminasDosStories,
  type CampanhaDoPedido,
  type PainelDosStories,
  type Sequencia,
  type Story,
  type useAtualizarStories,
} from "./storiesApi";

/**
 * Bloco Sequência (20/10; refeito em 21/10/2026, dono: "melhore a área dos
 * stories, deixe mais completa, mais bonita, e gera conteúdo com imagens ...
 * algo que converte ... e que também combine com as campanhas"):
 * - Nova sequência: o modelo (estrutura que converte e os prontos), o dia, a
 *   campanha e a fase; um clique planeja e pede as imagens ao gerador.
 * - A sequência aberta, no padrão do carrossel do Estúdio: as telas em cartões
 *   na lateral (arrastar, duplicar, remover), o celular no meio (barra de
 *   progresso, perfil, adesivo desenhado) e a tela escolhida ao lado (refazer
 *   e ajustar a imagem com o custo antes).
 * - A imagem do gerador vira o arquivo do story sozinha quando fica pronta
 *   (registrar_arte da_lamina); "Agendar a sequência" leva à agenda
 *   (automático no motor, pelo app com o aviso para a equipe).
 * - Filtro "Da campanha X" quando há sequências ligadas a campanhas.
 */

/** Pode ganhar arte: ainda não foi para a agenda nem saiu. */
export const precisaDeArte = (s: Story) => (s.situacao === "rascunho" || s.situacao === "falhou" || !s.file_id) && s.situacao !== "publicado" && s.situacao !== "agendado" && s.situacao !== "postar_pelo_app";

/** Pronto para agendar: arte, horário e ainda fora da agenda. */
export const prontoParaAgendar = (s: Story) => !!s.file_id && !!s.horario && (s.situacao === "arte_pronta" || s.situacao === "rascunho" || s.situacao === "falhou");

const TODAS = "todas";

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
  const { catalogo, clientName } = useMesa();
  const { marca: marcaDaMesa } = useMarcaDaMesa();
  const marcaId = marcaDaMesa ? marcaDaMesa.id : null;
  const confirmar = useConfirm();
  const [filtro, setFiltro] = useEstadoDaTela<string>(`mesa:stories:filtro:${clientId}`, TODAS);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [agendando, setAgendando] = useState(false);
  const [ordenando, setOrdenando] = useState(false);

  const trabalhoIds = useMemo(() => stories.map((s) => s.fundo.trabalho_id || "").filter(Boolean), [stories]);
  const laminasQ = useLaminasDosStories(clientId, trabalhoIds);
  const laminas = laminasQ.data;

  // A imagem pronta vira o arquivo do story sozinha (uma tentativa por versão; a próxima leitura tenta de novo).
  const tentados = useRef<Record<string, boolean>>({});
  useEffect(() => {
    for (const s of stories) {
      if (!precisaRegistrar(s, laminas)) continue;
      const viva = imagemDoStory(s, laminas);
      const chave = `${s.id}:${viva ? viva.versao : 0}:${viva ? viva.caminho : ""}`;
      if (tentados.current[chave]) continue;
      tentados.current[chave] = true;
      void registrarImagemDoStory(clientId, s)
        .then((novo) => atualizar.stories([novo]))
        .catch(() => {
          // Fica para a próxima leitura das lâminas (o servidor diz o porquê no cartão ao agendar).
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stories, laminas, clientId]);

  const campanhas = useMemo(() => campanhasDasSequencias(painel.sequencias), [painel.sequencias]);
  const filtroValido = filtro !== TODAS && campanhas.some((c) => c.id === filtro) ? filtro : TODAS;
  const sequenciasVisiveis = useMemo(
    () =>
      painel.sequencias
        .filter((s) => filtroValido === TODAS || (s.campanha && s.campanha.campanha_id === filtroValido))
        .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0)),
    [painel.sequencias, filtroValido],
  );

  const atual = stories.filter((s) => s.id === selecionado)[0] || stories[0] || null;
  const indice = atual ? stories.indexOf(atual) : 0;
  const semImagem = useMemo(() => stories.filter(precisaDeImagem), [stories]);
  const prontos = useMemo(() => stories.filter(prontoParaAgendar), [stories]);
  const semHorario = stories.filter((s) => !s.horario && s.situacao !== "publicado").length;
  const modelo = sequencia && sequencia.modelo ? modeloPorChave(sequencia.modelo) : null;
  const estrutura = modelo ? estruturaDaSequencia(stories) : null;
  const campanhaDoPedido: CampanhaDoPedido | null = sequencia && sequencia.campanha ? { id: sequencia.campanha.campanha_id, nome: sequencia.campanha.nome, fase: sequencia.campanha.fase } : null;

  const gerarImagens = async () => {
    if (!sequencia || !semImagem.length) return { custo_usd: 0 };
    const r = await gerarImagensDosStories({ clientId, titulo: sequencia.titulo, stories: semImagem, campanha: campanhaDoPedido, marcaId });
    atualizar.stories(r.stories);
    void laminasQ.refetch();
    if (r.avisos.length) toast.message("Imagens pedidas com avisos", { description: r.avisos.join(" ") });
    return { custo_usd: r.custo_usd };
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

  const reordenar = async (ids: string[]) => {
    if (!sequencia) return;
    const porId: Record<string, Story> = {};
    stories.forEach((s) => (porId[s.id] = s));
    // Na tela na hora; o servidor grava a ordem e acerta os horários.
    atualizar.stories(ids.map((id, i) => ({ ...porId[id], ordem: i + 1 })));
    setOrdenando(true);
    try {
      atualizar.stories(await reordenarStories(clientId, sequencia.id, ids));
    } catch (e) {
      toast.error("Não deu para mudar a ordem", { description: textoDoErro(e) });
      void atualizar.reler();
    } finally {
      setOrdenando(false);
    }
  };

  const duplicar = async (s: Story) => {
    try {
      const r = await chamarStories<{ story: unknown }>("salvar_story", clientId, {
        story: { sequencia_id: s.sequencia_id, molde: s.molde, titulo: s.titulo, texto_na_tela: s.texto_na_tela, adesivo: s.adesivo, fundo: s.fundo, horario: null, destaque_id: s.destaque_id },
      });
      const novo = normalizarStory(r && r.story);
      if (!novo.id) throw new Error("A cópia não voltou.");
      atualizar.stories([novo]);
      setSelecionado(novo.id);
      const ids = stories.map((x) => x.id);
      ids.splice(ids.indexOf(s.id) + 1, 0, novo.id);
      if (sequencia) await reordenar(ids);
    } catch (e) {
      toast.error("Não deu para duplicar", { description: textoDoErro(e) });
    }
  };

  const remover = async (s: Story) => {
    const ok = await confirmar({ title: `Remover o story ${s.ordem}?`, description: "Ele sai da sequência e da agenda.", confirmLabel: "Remover", destructive: true });
    if (!ok) return;
    try {
      await chamarStories("apagar_story", clientId, { id: s.id });
      atualizar.tirar(s.id);
    } catch (e) {
      toast.error("Não deu para remover", { description: textoDoErro(e) });
    }
  };

  const novoStory = () => onEditar({ sequencia_id: sequencia ? sequencia.id : null, ordem: stories.length ? stories[stories.length - 1].ordem + 1 : 1 });

  return (
    <div className="min-w-0 space-y-6" data-bloco-dos-stories="sequencia">
      <NovaSequencia
        clientId={clientId}
        onCriada={(seq, novos) => {
          atualizar.sequencia(seq);
          atualizar.stories(novos);
          onSequencia(seq.id);
          setSelecionado(null);
        }}
      />

      {!sequencia ? (
        <EstadoVazio icone={<Clapperboard className="h-5 w-5" />} titulo="Nenhuma sequência ainda" descricao="Escolha o modelo e o dia e crie a sequência" />
      ) : (
        <Secao
          divisoria
          recolher={`mesa:stories:aberta:${clientId}`}
          titulo={sequencia.titulo || `Sequência de ${diaCurto(sequencia.data)}`}
          descricao={`${diaCurto(sequencia.data)} · ${modelo ? modelo.nome : rotuloDoObjetivo(sequencia.objetivo)} · ${stories.length} stories`}
          acao={
            <div className="flex min-w-0 flex-wrap items-center justify-end [&>*]:mb-1 [&>*]:ml-2">
              {campanhas.length ? (
                <select
                  className={juntar(campo, "h-8 w-[190px]")}
                  value={filtroValido}
                  onChange={(e) => {
                    setFiltro(e.target.value);
                    const primeira = painel.sequencias.filter((s) => e.target.value === TODAS || (s.campanha && s.campanha.campanha_id === e.target.value)).sort((a, b) => (a.data < b.data ? 1 : -1))[0];
                    if (primeira) onSequencia(primeira.id);
                  }}
                  aria-label="Filtrar por campanha"
                >
                  <option value={TODAS}>Todas as sequências</option>
                  {campanhas.map((c) => (
                    <option key={c.id} value={c.id}>
                      Da campanha {c.nome}
                    </option>
                  ))}
                </select>
              ) : null}
              {sequenciasVisiveis.length > 1 ? (
                <select className={juntar(campo, "h-8 w-[180px]")} value={sequencia.id} onChange={(e) => onSequencia(e.target.value)} aria-label="Sequência aberta">
                  {sequenciasVisiveis.map((s) => (
                    <option key={s.id} value={s.id}>
                      {diaCurto(s.data)} · {s.titulo || rotuloDoObjetivo(s.objetivo)}
                    </option>
                  ))}
                </select>
              ) : null}
              <BotaoComCusto
                rotulo={
                  <>
                    <Wand2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Gerar imagens
                    {semImagem.length ? <span className="ml-1 tabular-nums">({semImagem.length})</span> : null}
                  </>
                }
                titulo="Imagens da sequência"
                descricao={semImagem.length ? `${semImagem.length} imagens 9:16 pelo gerador do Estúdio, com o texto integrado` : "Todas as telas já têm imagem"}
                partes={() => partesDaEstimativaDosStories(catalogo, semImagem.length, { comPlano: false, comImagens: true })}
                executar={gerarImagens}
                disabled={!semImagem.length}
                variant="outline"
                className="h-9"
              />
              <button type="button" className={botao.primario} onClick={() => void agendar()} disabled={!prontos.length || agendando}>
                {agendando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <CalendarCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                Agendar a sequência
              </button>
            </div>
          }
        >
          <div className="flex min-w-0 flex-wrap items-center [&>*]:mb-1 [&>*]:mr-2">
            {sequencia.campanha ? (
              <span className={juntar(etiqueta, "bg-primary/10 text-primary")} data-campanha-da-sequencia={sequencia.campanha.campanha_id}>
                <Megaphone className="mr-1 h-3 w-3" aria-hidden="true" />
                Da campanha {sequencia.campanha.nome}
                {sequencia.campanha.fase ? ` · ${ROTULO_DA_FASE[sequencia.campanha.fase]}` : ""}
              </span>
            ) : null}
            {estrutura ? (
              estrutura.completa ? (
                <span className={juntar(etiqueta, "bg-success/15 text-success")} data-estrutura-completa="">
                  <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />
                  Estrutura que converte
                </span>
              ) : (
                <span className={juntar(etiqueta, "bg-warning/15 text-warning")} title="Gancho, problema ou desejo, prova, oferta e CTA com adesivo">
                  {estrutura.ctaComAdesivo ? `Falta: ${estrutura.faltando.map((p) => ROTULO_DO_PAPEL[p].toLowerCase()).join(", ")}` : "O CTA final precisa de adesivo"}
                </span>
              )
            ) : null}
            {semHorario > 0 ? <span className={texto.auxiliar}>{semHorario} sem horário: abra o story e escolha a hora</span> : null}
            {stories.length > 0 && !prontos.length && !semImagem.length && !semHorario ? <span className={texto.auxiliar}>Tudo na agenda ou esperando a imagem</span> : null}
          </div>

          {stories.length ? (
            <div className="mt-4 grid min-w-0 gap-6 lg:grid-cols-[260px_auto_minmax(0,1fr)] lg:items-start">
              <CartoesDaSequencia
                stories={stories}
                selecionado={atual ? atual.id : null}
                marca={marca}
                laminas={laminas}
                ocupado={ordenando}
                onSelecionar={(s) => setSelecionado(s.id)}
                onReordenar={(ids) => void reordenar(ids)}
                onDuplicar={(s) => void duplicar(s)}
                onRemover={(s) => void remover(s)}
                onNovo={novoStory}
              />
              <CelularDoStory stories={stories} atual={indice} onMudar={(i) => stories[i] && setSelecionado(stories[i].id)} marca={marca} nome={clientName || "perfil"} laminas={laminas} largura={270} />
              {atual ? (
                <PainelDaTela
                  clientId={clientId}
                  story={atual}
                  titulo={sequencia.titulo}
                  campanha={campanhaDoPedido}
                  marca={marca}
                  marcaId={marcaId}
                  laminas={laminas}
                  onEditar={onEditar}
                  onMudou={(l) => atualizar.stories(l)}
                  onReler={() => void laminasQ.refetch()}
                />
              ) : null}
            </div>
          ) : (
            <div className="mt-4 min-w-0">
              <CartoesDaSequencia stories={[]} selecionado={null} marca={marca} onSelecionar={() => undefined} onReordenar={() => undefined} onDuplicar={() => undefined} onRemover={() => undefined} onNovo={novoStory} />
            </div>
          )}

          {sequencia.gancho_de_amanha ? (
            <p className={juntar(texto.auxiliar, "mt-4 truncate")} title={sequencia.gancho_de_amanha}>
              Gancho para amanhã: {sequencia.gancho_de_amanha}
            </p>
          ) : null}
        </Secao>
      )}
    </div>
  );
}
