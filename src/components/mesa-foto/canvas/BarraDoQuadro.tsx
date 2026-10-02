import type { ReactNode } from "react";
import { Copy, Link2, Maximize2, Minimize2, Minus, Plus, Scan, Sparkles, Trash2 } from "lucide-react";
import { FLUTUANTE, PAINEL, useRodaPresa } from "./comum";

/**
 * Barra do quadro (02/10/2026; dono: "várias caixas de resultado na mesma
 * tela, ligar uma na outra e fazer várias variações", "mais minimalista e
 * organizado"). Uma faixa só, no alto do quadro: Nova caixa, Duplicar,
 * Variar, Conectar e Apagar valem para a caixa escolhida; à direita, o zoom,
 * o enquadrar e a tela cheia. Sem React Flow aqui (os testes desenham a barra
 * sozinha); quem chama liga cada botão.
 */

export interface PropsDaBarraDoQuadro {
  /** Há uma caixa (Resultado) escolhida no quadro. */
  temCaixa: boolean;
  /** A caixa escolhida já tem foto pronta (Variar precisa de uma). */
  podeVariar: boolean;
  /** Esperando o toque na caixa que recebe a foto. */
  conectando: boolean;
  /** Zoom atual (1 = 100%). */
  zoom: number;
  cheia: boolean;
  /** Largura (px) que os ajustes abertos cobrem à direita: a barra não fica por baixo deles. */
  folgaDireita?: number;
  onNova: () => void;
  onDuplicar: () => void;
  onVariar: () => void;
  onConectar: () => void;
  onApagar: () => void;
  onZoomMenos: () => void;
  onZoomMais: () => void;
  onEnquadrar: () => void;
  onCheia: () => void;
}

function Botao({ rotulo, icone, onClick, desativado, ligado, perigo, dica, curto, dado }: { rotulo: string; icone: ReactNode; onClick: () => void; desativado?: boolean; ligado?: boolean; perigo?: boolean; dica?: string; curto?: boolean; dado: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desativado}
      aria-label={rotulo}
      aria-pressed={ligado === undefined ? undefined : ligado}
      title={dica || rotulo}
      data-barra-do-quadro={dado}
      className={`inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-2 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        ligado ? "bg-emerald-400 text-black" : perigo ? "text-red-300 hover:bg-red-500/15" : "text-zinc-100 hover:bg-white/10"
      }`}
    >
      <span className="inline-flex shrink-0" aria-hidden="true">
        {icone}
      </span>
      {!curto && <span className="ml-1.5 hidden lg:inline">{rotulo}</span>}
    </button>
  );
}

const TRACO = <span className="mx-1 h-5 w-px shrink-0 bg-white/10" aria-hidden="true" />;

export function BarraDoQuadro(p: PropsDaBarraDoQuadro) {
  const roda = useRodaPresa<HTMLDivElement>(true);
  const semCaixa = "Escolha uma caixa no quadro";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center" style={{ paddingLeft: 72, paddingRight: Math.max(72, p.folgaDireita || 0) }} data-barra-do-quadro-raiz="">
      <div ref={roda} role="toolbar" aria-label="Caixas do quadro" className={`${PAINEL} ${FLUTUANTE} pointer-events-auto flex max-w-full items-center overflow-x-auto rounded-xl p-1 scrollbar-hidden`}>
        <Botao dado="nova" rotulo="Nova caixa" icone={<Plus className="h-4 w-4" />} onClick={p.onNova} dica="Outra caixa de resultado neste quadro" />
        <Botao dado="duplicar" rotulo="Duplicar" icone={<Copy className="h-3.5 w-3.5" />} onClick={p.onDuplicar} desativado={!p.temCaixa} dica={p.temCaixa ? "Mesmas entradas e ajustes, sem as fotos" : semCaixa} />
        <Botao
          dado="variar"
          rotulo="Variar"
          icone={<Sparkles className="h-3.5 w-3.5" />}
          onClick={p.onVariar}
          desativado={!p.podeVariar}
          dica={!p.temCaixa ? semCaixa : p.podeVariar ? "Caixa nova ligada a esta, com a foto como estilo e outro ângulo" : "Gere uma foto nesta caixa antes"}
        />
        <Botao
          dado="conectar"
          rotulo={p.conectando ? "Toque na caixa" : "Conectar"}
          icone={<Link2 className="h-3.5 w-3.5" />}
          onClick={p.onConectar}
          ligado={p.conectando}
          desativado={!p.temCaixa && !p.conectando}
          dica={p.conectando ? "Toque na caixa que recebe a foto (Esc cancela)" : p.temCaixa ? "Ligar a foto desta caixa em outra" : semCaixa}
        />
        <Botao dado="apagar" rotulo="Apagar" icone={<Trash2 className="h-3.5 w-3.5" />} onClick={p.onApagar} desativado={!p.temCaixa} perigo dica={p.temCaixa ? "Tira a caixa do quadro (as fotos ficam no acervo)" : semCaixa} />
        {TRACO}
        <Botao dado="zoom-menos" curto rotulo="Diminuir" icone={<Minus className="h-3.5 w-3.5" />} onClick={p.onZoomMenos} />
        <span className="w-10 shrink-0 text-center text-[11px] tabular-nums text-zinc-400" aria-live="polite" data-zoom-do-quadro="">
          {Math.round((p.zoom || 1) * 100)}%
        </span>
        <Botao dado="zoom-mais" curto rotulo="Aumentar" icone={<Plus className="h-3.5 w-3.5" />} onClick={p.onZoomMais} />
        <Botao dado="enquadrar" curto rotulo="Ver tudo" icone={<Scan className="h-3.5 w-3.5" />} onClick={p.onEnquadrar} />
        <Botao dado="tela-cheia" curto rotulo={p.cheia ? "Sair da tela cheia" : "Tela cheia"} icone={p.cheia ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />} onClick={p.onCheia} />
      </div>
    </div>
  );
}
