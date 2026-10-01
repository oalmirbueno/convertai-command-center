import { LayoutTemplate, Pencil, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { lerDadosDoVideo } from "../../../../supabase/functions/mesa-foto/modulos/video-do-canvas";
import { LISTA_DE_FORMATOS_DO_QUADRO, modeloPorId, normalizarQuadro, quadroNoFormato, type FormatoDoQuadro, type MarcaDoQuadro, type QuadroAnimado } from "../../../../supabase/functions/mesa-foto/modulos/quadro-animado";
import type { Canvas, NoDoCanvas } from "../canvasApi";
import { BOTAO, CAMPO, Escolha, ROTULO, type Fontes } from "./comum";
import { midiasLigadasAoQuadro } from "./videoNoCanvas";
import { useUrlsDasMidias } from "./quadro/apoio";
import PalcoDoQuadro from "./quadro/PalcoDoQuadro";

/**
 * Cartão Quadro do Canvas (frente CNV, 30/09): a miniatura viva do quadro
 * animado no cartão e os ajustes rápidos no painel. A edição completa (camadas,
 * guias, animação, IA, exportar e render) abre no editor em janela central.
 */

const aprovadasDe = (f: Fontes) => f.fotos.filter((x) => x.aprovada).map((x) => x.id);

export type AbaDoEditor = "camadas" | "modelos" | "ia";

/** O que aparece dentro do cartão Quadro no quadro do Canvas. */
export function CorpoDoQuadro({ canvas, no, fontes, onEditar }: { canvas: Canvas; no: NoDoCanvas; fontes: Fontes; onEditar: (aba: AbaDoEditor) => void }) {
  const q = no.dados.quadro || normalizarQuadro({});
  const urls = useUrlsDasMidias(q.camadas.map((c) => c.midia));
  const ligadas = midiasLigadasAoQuadro(canvas, no.id, aprovadasDe(fontes));
  const modelo = modeloPorId(q.modelo);
  // Miniatura com a altura fixa do cartão (o formato decide a largura).
  const alturaDaMiniatura = 190;
  const proporcao = q.formato === "16:9" ? 16 / 9 : q.formato === "1:1" ? 1 : q.formato === "4:5" ? 0.8 : 9 / 16;
  const largura = Math.min(214, Math.round(alturaDaMiniatura * proporcao));
  return (
    <div className="flex min-h-0 flex-1 flex-col px-2.5 pb-2.5" data-corpo-do-quadro={no.id}>
      <button type="button" className="nodrag relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-zinc-900" style={{ height: alturaDaMiniatura }} onClick={() => onEditar(q.camadas.length ? "camadas" : "modelos")} aria-label="Editar o quadro">
        {q.camadas.length ? (
          <PalcoDoQuadro quadro={q} t={Math.min(q.duracao_s, 2.4)} urls={urls} largura={largura} soLeitura />
        ) : (
          <span className="flex flex-col items-center px-4 text-center text-zinc-400">
            <LayoutTemplate className="mb-1.5 h-5 w-5 text-teal-300/80" />
            <span className="text-[11px]">Quadro vazio. Toque para escolher um modelo da marca ou montar com IA.</span>
          </span>
        )}
      </button>
      <p className="mt-1.5 truncate text-[11px] text-zinc-400">
        {q.formato} · {q.duracao_s} s · {q.camadas.length} {q.camadas.length === 1 ? "camada" : "camadas"}
        {modelo ? ` · ${modelo.rotulo}` : ""}
      </p>
      <p className="truncate text-[11px] text-zinc-400">{ligadas.length ? `${ligadas.length} ${ligadas.length === 1 ? "mídia ligada" : "mídias ligadas"}` : "Ligue fotos ou vídeos na alça da esquerda"}</p>
      <div className="mt-auto flex min-w-0 items-center pt-1.5">
        <button type="button" className="nodrag mr-1 inline-flex h-8 flex-1 items-center justify-center rounded-lg bg-teal-300 px-2 text-[12px] font-semibold text-black hover:bg-teal-200" onClick={() => onEditar(q.camadas.length ? "camadas" : "modelos")} data-editar-quadro={no.id}>
          <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
        </button>
        <button type="button" className={`${BOTAO} nodrag h-8`} onClick={() => onEditar("ia")} aria-label="Montar com IA" title="Montar com IA pelo pedido">
          <Sparkles className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Ajustes rápidos do Quadro no painel (o resto no editor). */
export function AjustesDoQuadro({
  canvas,
  no,
  fontes,
  marca,
  onMudar,
  onEditar,
}: {
  canvas: Canvas;
  no: NoDoCanvas;
  fontes: Fontes;
  /** Marca do quadro: com modelo, trocar a proporção remonta como no editor. */
  marca: MarcaDoQuadro;
  onMudar: (d: { titulo?: string; quadro?: QuadroAnimado }) => void;
  onEditar: (aba: AbaDoEditor) => void;
}) {
  const q = no.dados.quadro || normalizarQuadro({});
  // Mesma regra do editor: com modelo da marca, remonta; feito à mão, as frações ficam (com aviso). Sempre com Desfazer.
  const trocarFormato = (formato: FormatoDoQuadro) => {
    if (formato === q.formato) return;
    const anterior = q;
    const r = quadroNoFormato(q, formato, marca);
    onMudar({ quadro: r.quadro });
    const desfazer = { label: "Desfazer", onClick: () => onMudar({ quadro: anterior }) };
    if (r.remontado) toast.info(`Remontado em ${formato}`, { description: "O modelo da marca refez as posições para a proporção nova.", action: desfazer });
    else if (q.camadas.length) toast.info(`Proporção ${formato}`, { description: "Sem modelo da marca, as camadas ficam nas mesmas frações e podem esticar. Ajuste no editor.", action: desfazer });
  };
  const ligadas = midiasLigadasAoQuadro(canvas, no.id, aprovadasDe(fontes));
  const videos = canvas.ligacoes.filter((l) => l.para === no.id).map((l) => canvas.nos.find((n) => n.id === l.de)).filter((n): n is NoDoCanvas => !!n && n.tipo === "video");
  const semVideoPronto = videos.filter((v) => !lerDadosDoVideo(v.dados.video || {}).pedidos.some((p) => p.videos.length)).length;
  return (
    <div className="min-w-0 space-y-3" data-ajustes-do-quadro={no.id}>
      <input className={CAMPO} value={no.dados.titulo || ""} onChange={(e) => onMudar({ titulo: e.target.value.slice(0, 120) })} placeholder="Nome do quadro (vai para a Mesa Edição)" aria-label="Nome do quadro" />
      <div className="min-w-0">
        <p className={ROTULO}>Proporção</p>
        <Escolha rotulo="Proporção do quadro" opcoes={LISTA_DE_FORMATOS_DO_QUADRO.map((f) => ({ valor: f, rotulo: f }))} valor={q.formato} onEscolher={(v) => trocarFormato(v as FormatoDoQuadro)} />
      </div>
      <p className="text-[12px] text-zinc-400">
        {ligadas.length} {ligadas.length === 1 ? "mídia ligada" : "mídias ligadas"}
        {semVideoPronto ? ` · ${semVideoPronto} vídeo ainda sem arquivo pronto` : ""}
      </p>
      <div className="flex min-w-0 flex-wrap items-center">
        <button type="button" className={`${BOTAO} mb-1 mr-1.5`} onClick={() => onEditar(q.camadas.length ? "camadas" : "modelos")}>
          <Pencil className="mr-1 h-3.5 w-3.5" /> Abrir o editor
        </button>
        <button type="button" className={`${BOTAO} mb-1 mr-1.5`} onClick={() => onEditar("modelos")}>
          <LayoutTemplate className="mr-1 h-3.5 w-3.5" /> Modelos da marca
        </button>
        <button type="button" className={`${BOTAO} mb-1`} onClick={() => onEditar("ia")}>
          <Sparkles className="mr-1 h-3.5 w-3.5" /> Montar com IA
        </button>
      </div>
      <p className="text-[11px] text-zinc-500">No editor: camadas, guias, animação, exportar PNG e mandar para o render.</p>
    </div>
  );
}
