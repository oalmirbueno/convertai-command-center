import type { CSSProperties, ReactNode } from "react";
import { AlertTriangle, AtSign, BarChart3, ImageIcon, Link2, ListChecks, Loader2, MapPin, MessageCircleQuestion, SmilePlus, Smartphone, Timer, Type, Zap, type LucideIcon } from "lucide-react";
import { juntar } from "@/components/sistema/estilos";
import { ImagemDaMesa } from "../MesaContexto";
import type { ImagemDoAcervo } from "../SeletorDoAcervo";
import { areaDoAdesivo, corDaLetra, hexValido, LAYOUT_DO_TEXTO, ZONA_SEGURA } from "./layoutDoStory";
import { caminhoDoAdesivo, type Adesivo, type Story, type TipoDeAdesivo } from "./storiesApi";
import { corDoFundo } from "./arteDoStory";

/**
 * Prévia do story como o celular mostra (9:16): a foto ou a cor da marca, o
 * texto na tela na fonte da marca, a área do adesivo desenhada como o adesivo
 * do Instagram vai ficar e o selo "Automático" ou "Pelo app". As medidas são
 * as mesmas da arte (layoutDoStory.ts); o tamanho da letra acompanha a largura.
 * Proporção por padding-bottom (sem aspect-ratio: Safari 11).
 *
 * 21/10: fundo "gerada" mostra a imagem do gerador inteira (o texto já está
 * nela, integrado pelo motor: nada é desenhado por cima, só o adesivo da
 * prévia, que entra pelo app). Sem imagem ainda, o rascunho na cor da marca
 * com o texto planejado e o estado (a gerar, na fila, gerando, falhou).
 */

type ParteDoStory = Pick<Story, "texto_na_tela" | "adesivo" | "fundo">;

const pct = (f: number) => `${(f * 100).toFixed(2)}%`;

function Pilula({ u, children, cor }: { u: number; children: ReactNode; cor: string }) {
  return (
    <span className="inline-flex max-w-full items-center rounded-md bg-white font-semibold" style={{ padding: `${1.6 * u}px ${3 * u}px`, fontSize: 4 * u, color: cor }}>
      {children}
    </span>
  );
}

/** O adesivo desenhado como o Instagram mostra (só na prévia: na arte a área fica livre). */
function DesenhoDoAdesivo({ adesivo, u, cor }: { adesivo: Adesivo; u: number; cor: string }) {
  const pergunta = (adesivo.pergunta || "").trim();
  const opcoes = (adesivo.opcoes || []).filter((x) => x.trim());
  const caixa: CSSProperties = { borderRadius: 3 * u, padding: 3 * u, fontSize: 3.8 * u, lineHeight: 1.25 };
  const linha: CSSProperties = { borderRadius: 2 * u, padding: `${1.6 * u}px ${2.4 * u}px`, marginTop: 1.6 * u };
  switch (adesivo.tipo) {
    case "enquete":
      return (
        <div className="w-full bg-white text-center text-neutral-900" style={caixa}>
          <p className="truncate font-semibold">{pergunta || "Sua pergunta"}</p>
          {(opcoes.length ? opcoes : ["Sim", "Não"]).slice(0, 4).map((o) => (
            <p key={o} className="truncate bg-neutral-100 font-semibold" style={{ ...linha, color: cor }}>
              {o}
            </p>
          ))}
        </div>
      );
    case "quiz":
      return (
        <div className="w-full overflow-hidden bg-white text-neutral-900" style={{ ...caixa, padding: 0 }}>
          <p className="truncate text-center font-semibold text-white" style={{ background: cor, padding: `${2.4 * u}px ${3 * u}px` }}>
            {pergunta || "Sua pergunta"}
          </p>
          <div style={{ padding: `${0.6 * u}px ${3 * u}px ${3 * u}px` }}>
            {(opcoes.length ? opcoes : ["Opção A", "Opção B", "Opção C"]).slice(0, 4).map((o, i) => (
              <p key={o} className="flex min-w-0 items-center bg-neutral-100" style={linha}>
                <span className="mr-1.5 inline-flex shrink-0 items-center justify-center rounded-full border border-neutral-300 font-semibold" style={{ width: 4.6 * u, height: 4.6 * u, fontSize: 2.8 * u }}>
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="min-w-0 truncate">{o}</span>
              </p>
            ))}
          </div>
        </div>
      );
    case "caixinha":
      return (
        <div className="w-full overflow-hidden bg-white text-center" style={{ ...caixa, padding: 0 }}>
          <p className="font-semibold text-white" style={{ background: cor, padding: `${3 * u}px ${3 * u}px`, maxHeight: 14 * u, overflow: "hidden" }}>
            {pergunta || "Me pergunte algo"}
          </p>
          <p className="text-neutral-400" style={{ padding: `${2.4 * u}px` }}>
            Escreva algo...
          </p>
        </div>
      );
    case "contagem":
      return (
        <div className="w-full bg-neutral-900 text-center text-white" style={caixa}>
          <p className="truncate font-semibold">{pergunta || "Contagem"}</p>
          <p className="font-semibold tabular-nums" style={{ fontSize: 7 * u, marginTop: 1.2 * u }}>
            00 : 00 : 00
          </p>
          {adesivo.quando ? <p className="truncate text-white/70">{adesivo.quando}</p> : null}
        </div>
      );
    case "reacao":
      return (
        <div className="w-full bg-white text-center text-neutral-900" style={caixa}>
          <p className="truncate font-semibold">{pergunta || "O que achou?"}</p>
          <div className="relative mx-auto bg-neutral-200" style={{ height: 1.4 * u, borderRadius: u, marginTop: 4 * u, width: "86%" }}>
            <span className="absolute" style={{ left: "58%", top: "50%", transform: "translate(-50%, -50%)", fontSize: 6 * u }} aria-hidden="true">
              {"\u{1F60D}"}
            </span>
          </div>
        </div>
      );
    case "link":
      return (
        <Pilula u={u} cor="#0b5cff">
          <Link2 className="mr-1 shrink-0" style={{ width: 4 * u, height: 4 * u }} aria-hidden="true" />
          <span className="min-w-0 truncate">{adesivo.texto_do_link || (adesivo.url || "Link").replace(/^https?:\/\//, "")}</span>
        </Pilula>
      );
    case "localizacao":
      return (
        <Pilula u={u} cor="#8a3ab9">
          <MapPin className="mr-1 shrink-0" style={{ width: 4 * u, height: 4 * u }} aria-hidden="true" />
          <span className="min-w-0 truncate">{pergunta || "Local"}</span>
        </Pilula>
      );
    case "mencao":
      return (
        <Pilula u={u} cor="#d6249f">
          <AtSign className="mr-0.5 shrink-0" style={{ width: 4 * u, height: 4 * u }} aria-hidden="true" />
          <span className="min-w-0 truncate">{(pergunta || "perfil").replace(/^@/, "")}</span>
        </Pilula>
      );
    default:
      return null;
  }
}

const ICONES_DO_ADESIVO: Record<TipoDeAdesivo, LucideIcon> = {
  nenhum: Type,
  enquete: BarChart3,
  caixinha: MessageCircleQuestion,
  quiz: ListChecks,
  link: Link2,
  contagem: Timer,
  localizacao: MapPin,
  reacao: SmilePlus,
  mencao: AtSign,
};

/** O ícone de cada adesivo (o mesmo nos moldes, no editor e na agenda). */
export function IconeDoAdesivo({ tipo, className = "h-4 w-4" }: { tipo: TipoDeAdesivo; className?: string }) {
  const Icone = ICONES_DO_ADESIVO[tipo] || Type;
  return <Icone className={className} aria-hidden="true" />;
}

export function SeloDoCaminho({ adesivo, className = "" }: { adesivo: Adesivo; className?: string }) {
  const app = caminhoDoAdesivo(adesivo) === "pelo_app";
  return (
    <span
      className={juntar("inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[11px] font-medium leading-none", app ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary", className)}
      title={app ? "Tem adesivo: a equipe posta pelo app" : "Sem adesivo: o painel publica sozinho"}
      data-caminho={app ? "pelo_app" : "automatico"}
    >
      {app ? <Smartphone className="mr-1 h-3 w-3" aria-hidden="true" /> : <Zap className="mr-1 h-3 w-3" aria-hidden="true" />}
      {app ? "Pelo app" : "Automático"}
    </span>
  );
}

export default function PreviaDoStory({
  story,
  largura,
  paleta,
  familia,
  foto,
  posicao,
  mostrarZona = false,
  semSelo = false,
  className = "",
  imagem = null,
  estado = null,
  desatualizada = false,
}: {
  story: ParteDoStory;
  /** Largura do cartão em px (a letra acompanha). */
  largura: number;
  paleta: string[];
  familia: string | null;
  foto: ImagemDoAcervo | null;
  /** A barrinha de cima do Instagram (qual story da sequência). */
  posicao?: { atual: number; total: number };
  /** Mostra as zonas seguras (no editor). */
  mostrarZona?: boolean;
  /** Sem o selo do caminho (miniatura). */
  semSelo?: boolean;
  className?: string;
  /** A lâmina viva do gerador (antes de registrar); sem ela, a registrada no fundo. */
  imagem?: { caminho: string } | null;
  /** A lâmina na fila do servidor. */
  estado?: "fila" | "rodando" | "erro" | null;
  /** O texto mudou depois da imagem. */
  desatualizada?: boolean;
}) {
  const u = largura / 100;
  const gerada = story.fundo.tipo === "gerada";
  const caminhoGerado = gerada ? (imagem && imagem.caminho) || story.fundo.caminho || null : null;
  const comFoto = story.fundo.tipo === "foto" && !!foto;
  const fundo = corDoFundo(story, paleta);
  const caixa = hexValido(paleta[0]) || "#111111";
  const letra = comFoto ? corDaLetra(caixa, paleta) : corDaLetra(fundo, paleta);
  const area = areaDoAdesivo(story.adesivo.tipo);
  const corDoAdesivo = hexValido(paleta[0]) || "#6b2bd9";
  const texto = (story.texto_na_tela || "").trim();
  const corpo = largura * (texto.length > 70 ? LAYOUT_DO_TEXTO.corpoMinimo : LAYOUT_DO_TEXTO.corpo);
  // Rascunho da imagem a gerar: a cor da marca em degradê (nunca foto colada).
  const rascunho = gerada && !caminhoGerado ? `linear-gradient(165deg, ${hexValido(paleta[0]) || "#1f2937"} 0%, ${hexValido(paleta[1]) || hexValido(paleta[0]) || "#111827"} 100%)` : null;
  const letraDoRascunho = corDaLetra(hexValido(paleta[0]) || "#1f2937", paleta);

  return (
    <div className={juntar("relative min-w-0 overflow-hidden rounded-md", className)} style={{ width: largura, maxWidth: "100%" }} data-previa-do-story="">
      <div className="relative w-full" style={{ paddingBottom: "177.78%", background: caminhoGerado || comFoto ? "#000" : rascunho || fundo }} data-imagem-gerada={caminhoGerado ? "sim" : gerada ? "a_gerar" : undefined}>
        {caminhoGerado ? <ImagemDaMesa caminho={caminhoGerado} alt={texto || "Imagem do story"} className="absolute inset-0 h-full w-full" /> : null}
        {!gerada && comFoto && foto ? <ImagemDaMesa caminho={foto.storage_path} bucket={foto.storage_bucket || "mesa"} alt={foto.nome} className="absolute inset-0 h-full w-full" /> : null}

        {posicao && posicao.total > 1 ? (
          <div className="absolute flex" style={{ left: 2 * u, right: 2 * u, top: 1.6 * u }} aria-hidden="true">
            {Array.from({ length: posicao.total }).map((_, i) => (
              <span key={i} className={i <= posicao.atual ? "bg-white" : "bg-white/40"} style={{ height: Math.max(1, 0.5 * u), flex: 1, marginLeft: i ? u * 0.6 : 0, borderRadius: u }} />
            ))}
          </div>
        ) : null}

        {mostrarZona ? (
          <>
            <span className="absolute inset-x-0 top-0 border-b border-dashed border-white/50" style={{ height: pct(ZONA_SEGURA.topo) }} aria-hidden="true" />
            <span className="absolute inset-x-0 bottom-0 border-t border-dashed border-white/50" style={{ height: pct(ZONA_SEGURA.baixo) }} aria-hidden="true" />
          </>
        ) : null}

        {texto && !caminhoGerado ? (
          <p
            className="absolute text-center font-semibold"
            style={{
              left: pct(LAYOUT_DO_TEXTO.margem),
              right: pct(LAYOUT_DO_TEXTO.margem),
              top: pct(LAYOUT_DO_TEXTO.topo),
              fontSize: corpo,
              lineHeight: LAYOUT_DO_TEXTO.entrelinha,
              color: rascunho ? letraDoRascunho : letra,
              opacity: rascunho ? 0.92 : 1,
              fontFamily: `${familia ? `"${familia}", ` : ""}Outfit, sans-serif`,
              whiteSpace: "pre-line",
              overflowWrap: "anywhere",
            }}
            data-texto-do-story=""
          >
            <span
              className="[-webkit-box-decoration-break:clone] [box-decoration-break:clone]"
              style={comFoto ? { background: caixa, padding: `0 ${corpo * LAYOUT_DO_TEXTO.respiro}px` } : undefined}
            >
              {texto}
            </span>
          </p>
        ) : null}

        {area ? (
          <div
            className="absolute flex items-center justify-center"
            style={{ left: pct((1 - area.largura) / 2), width: pct(area.largura), top: pct(area.centroY - area.altura / 2), height: pct(area.altura) }}
            data-area-do-adesivo={story.adesivo.tipo}
            title="Área do adesivo: fica livre na arte; o adesivo entra no app"
          >
            <DesenhoDoAdesivo adesivo={story.adesivo} u={u} cor={corDoAdesivo} />
          </div>
        ) : null}

        {gerada && (!caminhoGerado || estado || desatualizada) ? (
          <span
            className="absolute left-1/2 inline-flex max-w-[90%] -translate-x-1/2 items-center whitespace-nowrap rounded-full bg-black/60 font-medium text-white"
            style={{ top: "40%", fontSize: Math.max(10, 3.6 * u), padding: `${1.2 * u}px ${3 * u}px` }}
            data-estado-da-imagem={estado || (desatualizada ? "desatualizada" : "a_gerar")}
          >
            {estado === "fila" || estado === "rodando" ? <Loader2 className={juntar("shrink-0 animate-spin", largura >= 100 ? "mr-1" : "")} style={{ width: Math.max(10, 3.6 * u), height: Math.max(10, 3.6 * u) }} aria-hidden="true" /> : estado === "erro" || desatualizada ? <AlertTriangle className={juntar("shrink-0", largura >= 100 ? "mr-1" : "")} style={{ width: Math.max(10, 3.6 * u), height: Math.max(10, 3.6 * u) }} aria-hidden="true" /> : <ImageIcon className={juntar("shrink-0", largura >= 100 ? "mr-1" : "")} style={{ width: Math.max(10, 3.6 * u), height: Math.max(10, 3.6 * u) }} aria-hidden="true" />}
            {largura >= 100 ? <span className="truncate">{estado === "fila" ? "Na fila" : estado === "rodando" ? "Gerando" : estado === "erro" ? "Falhou" : desatualizada ? "Texto mudou" : "Imagem a gerar"}</span> : null}
          </span>
        ) : null}

        {semSelo ? null : (
          <span className="absolute rounded bg-background" style={{ left: 2 * u, bottom: 2.4 * u }}>
            <SeloDoCaminho adesivo={story.adesivo} />
          </span>
        )}
      </div>
    </div>
  );
}
