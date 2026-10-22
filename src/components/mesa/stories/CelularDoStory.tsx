import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Heart, MoreHorizontal, Pause, Play, Send, X } from "lucide-react";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { noFuso } from "../instagram/calendario-da-grade";
import PreviaDoStory from "./PreviaDoStory";
import { hexValido, corDaLetra } from "./layoutDoStory";
import type { MarcaDosStories } from "./marcaDosStories";
import { filaDoStory, imagemDesatualizada, imagemDoStory, ROTULO_DO_PAPEL, type LaminasDoTrabalho, type Story } from "./storiesApi";

/**
 * O celular da sequência (21/10/2026, dono: "mais completa, mais bonita"): o
 * story como o Instagram mostra, dentro do aparelho. A barra de progresso da
 * sequência, o cabeçalho do perfil (foto, nome e hora), a imagem do gerador
 * inteira, o adesivo desenhado (só na prévia: na arte a área fica livre) e o
 * rodapé de responder. Toque na metade esquerda ou direita (ou nas setas do
 * teclado) passa de story; o Tocar avança sozinho, como no app.
 * Medidas pela largura (sem aspect-ratio: Safari 11).
 */

const TEMPO_DO_STORY_MS = 5000;

export default function CelularDoStory({
  stories,
  atual,
  onMudar,
  marca,
  nome,
  laminas,
  largura = 290,
  emAndamento,
}: {
  stories: Story[];
  atual: number;
  onMudar: (i: number) => void;
  marca: MarcaDosStories;
  /** Nome do perfil no cabeçalho. */
  nome: string;
  laminas?: Record<string, LaminasDoTrabalho>;
  largura?: number;
  emAndamento?: Record<string, boolean>;
}) {
  const [tocando, setTocando] = useState(false);
  const total = stories.length;
  const i = Math.min(Math.max(0, atual), Math.max(0, total - 1));
  const s = stories[i] || null;

  useEffect(() => {
    if (!tocando || total < 2) return;
    const t = window.setTimeout(() => {
      if (i >= total - 1) setTocando(false);
      else onMudar(i + 1);
    }, TEMPO_DO_STORY_MS);
    return () => window.clearTimeout(t);
  }, [tocando, i, total, onMudar]);

  if (!s) return null;
  const u = largura / 100;
  const cor = hexValido(marca.paleta[0]) || "#6b2bd9";
  const inicial = (nome || "?").trim().charAt(0).toUpperCase();
  const hora = s.horario ? noFuso(s.horario).hora : "agora";
  const papel = s.fundo.papel ? ROTULO_DO_PAPEL[s.fundo.papel] || s.fundo.papel : "";
  const anterior = () => i > 0 && onMudar(i - 1);
  const proximo = () => i < total - 1 && onMudar(i + 1);

  return (
    <div className="min-w-0" data-celular-do-story="">
      <div
        className="relative mx-auto bg-neutral-950 ring-1 ring-border"
        style={{ width: largura + 2 * 2.6 * u, maxWidth: "100%", padding: 2.6 * u, borderRadius: 11 * u }}
        tabIndex={0}
        role="group"
        aria-label={`Prévia no celular: story ${i + 1} de ${total}`}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") anterior();
          if (e.key === "ArrowRight") proximo();
        }}
      >
        <div className="relative overflow-hidden" style={{ borderRadius: 8.5 * u }}>
          <PreviaDoStory
            story={s}
            largura={largura}
            paleta={marca.paleta}
            familia={marca.familia}
            foto={marca.foto(s.fundo.imagem_id)}
            posicao={{ atual: i, total }}
            semSelo
            imagem={imagemDoStory(s, laminas)}
            estado={emAndamento && emAndamento[s.id] ? "rodando" : filaDoStory(s, laminas)}
            desatualizada={imagemDesatualizada(s)}
          />

          {/* Cabeçalho do perfil, como no app. */}
          <div className="pointer-events-none absolute flex items-center text-white" style={{ left: 3 * u, right: 3 * u, top: 4.2 * u }} aria-hidden="true">
            <span
              className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-2 ring-white/80"
              style={{ width: 8.4 * u, height: 8.4 * u, background: cor, color: corDaLetra(cor, marca.paleta), fontSize: 3.6 * u }}
            >
              {inicial}
            </span>
            <span className="ml-2 min-w-0 truncate font-semibold [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]" style={{ fontSize: 3.9 * u }}>
              {nome}
            </span>
            <span className="ml-1.5 shrink-0 text-white/80 [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]" style={{ fontSize: 3.6 * u }}>
              {hora}
            </span>
            <span className="flex-1" />
            <MoreHorizontal className="shrink-0" style={{ width: 5 * u, height: 5 * u }} />
            <X className="ml-2 shrink-0" style={{ width: 5.4 * u, height: 5.4 * u }} />
          </div>

          {/* Rodapé de responder. */}
          <div className="pointer-events-none absolute flex items-center text-white" style={{ left: 3 * u, right: 3 * u, bottom: 3.4 * u }} aria-hidden="true">
            <span className="min-w-0 flex-1 truncate rounded-full border border-white/70" style={{ padding: `${2 * u}px ${3.6 * u}px`, fontSize: 3.6 * u }}>
              Enviar mensagem
            </span>
            <Heart className="ml-3 shrink-0" style={{ width: 6 * u, height: 6 * u }} />
            <Send className="ml-3 shrink-0" style={{ width: 5.6 * u, height: 5.6 * u }} />
          </div>

          {/* Tocar na esquerda volta; na direita avança (como no Instagram). As setas de baixo fazem o mesmo pelo teclado. */}
          <button type="button" className="absolute bottom-[18%] left-0 top-[12%] w-1/3 focus-visible:outline-none" onClick={anterior} disabled={i === 0} tabIndex={-1} aria-hidden="true" title="Story anterior" />
          <button type="button" className="absolute bottom-[18%] right-0 top-[12%] w-1/3 focus-visible:outline-none" onClick={proximo} disabled={i >= total - 1} tabIndex={-1} aria-hidden="true" title="Próximo story" />
        </div>
      </div>

      <div className="mx-auto mt-2 flex min-w-0 items-center justify-center" style={{ maxWidth: largura }}>
        <button type="button" className={botao.icone} onClick={anterior} disabled={i === 0} aria-label="Story anterior" title="Story anterior">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={botao.icone}
          onClick={() => {
            if (!tocando && i >= total - 1) onMudar(0);
            setTocando(!tocando);
          }}
          disabled={total < 2}
          aria-label={tocando ? "Pausar a sequência" : "Tocar a sequência"}
          title={tocando ? "Pausar" : "Tocar a sequência"}
          aria-pressed={tocando}
        >
          {tocando ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
        </button>
        <span className={juntar(texto.auxiliar, "mx-2 min-w-0 truncate tabular-nums")} aria-live="polite">
          {i + 1} de {total}
          {papel ? ` · ${papel}` : ""}
        </span>
        <button type="button" className={botao.icone} onClick={proximo} disabled={i >= total - 1} aria-label="Próximo story" title="Próximo story">
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
