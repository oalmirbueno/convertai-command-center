import { useState } from "react";
import { ChevronUp, Globe, Heart, MessageCircle, MoreHorizontal, Send, ThumbsUp } from "lucide-react";
import { ImagemDaMesa } from "@/components/mesa/MesaContexto";
import { formatoDe, rotuloDoCta, type CopyDoAnuncio } from "./adsApi";
import { textoVisivel } from "./PainelDaCopy";

/**
 * Como o anúncio aparece em cada posicionamento, em tamanho de celular e lado a
 * lado, como a prévia do Gerenciador de Anúncios (dono, 24/09/2026: "a prévia do
 * feed ficou gigante; quero várias variações, feed e stories do lado, organizado").
 * Larguras fixas e pequenas; a grade quebra linha no celular, sem rolagem lateral.
 * Proporção pela altura com padding (a propriedade CSS de proporção não existe no Safari 11).
 *
 * Arte 9:16 no feed: recortada em 4:5 pelo centro, como a Meta faz.
 * Arte 4:5 ou 1:1 nos stories e reels: centralizada sobre ela mesma desfocada.
 */

type Props = { copy: CopyDoAnuncio; caminho: string | null; formato: string; nome: string };

const LARGURA_FEED = 236;
const LARGURA_VERTICAL = 168;

function Avatar({ nome, claro = false }: { nome: string; claro?: boolean }) {
  return (
    <span className={`mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${claro ? "bg-white/25 text-white" : "bg-primary/15 text-primary"}`}>
      {(nome || "?").trim().charAt(0).toUpperCase()}
    </span>
  );
}

function Arte({ caminho, proporcao }: { caminho: string | null; proporcao: number }) {
  return (
    <div className="relative w-full bg-secondary" style={{ paddingBottom: `${proporcao * 100}%` }}>
      <div className="absolute inset-0">
        {caminho ? (
          <ImagemDaMesa caminho={caminho} alt="Arte do anúncio" className="h-full w-full" />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">Arte ainda não gerada</div>
        )}
      </div>
    </div>
  );
}

/** Tela 9:16: arte vertical ocupa tudo; as outras entram centralizadas sobre o fundo desfocado. */
function TelaVertical({ caminho, formato, children }: { caminho: string | null; formato: string; children: React.ReactNode }) {
  const f = formatoDe(formato);
  const vertical = f.valor === "stories_9x16";
  return (
    <div className="relative w-full overflow-hidden rounded-[14px] bg-black" style={{ paddingBottom: "177.78%" }}>
      <div className="absolute inset-0">
        {caminho && vertical && <ImagemDaMesa caminho={caminho} alt="Arte do anúncio" className="h-full w-full" />}
        {caminho && !vertical && (
          <>
            <div className="absolute inset-0 scale-110 opacity-60 blur-md">
              <ImagemDaMesa caminho={caminho} alt="" className="h-full w-full" />
            </div>
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2">
              <Arte caminho={caminho} proporcao={f.altura / f.largura} />
            </div>
          </>
        )}
        {!caminho && <div className="flex h-full items-center justify-center text-[10px] text-white/60">Arte ainda não gerada</div>}
        {children}
      </div>
    </div>
  );
}

function FeedInstagram({ copy, caminho, formato, nome }: Props) {
  const f = formatoDe(formato);
  const { visivel, cortado } = textoVisivel(copy.texto_principal || "");
  const proporcao = f.valor === "stories_9x16" ? 1.25 : f.altura / f.largura;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background text-foreground" aria-label="Prévia no feed">
      <div className="flex items-center px-2.5 py-1.5">
        <Avatar nome={nome} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-semibold">{nome || "Cliente"}</span>
          <span className="block text-[9.5px] text-muted-foreground">Patrocinado</span>
        </span>
        <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <Arte caminho={caminho} proporcao={proporcao} />
      <div className="flex items-center justify-between bg-primary/10 px-2.5 py-1.5">
        <span className="truncate text-[11px] font-semibold">{rotuloDoCta(copy.cta_meta) || "CTA"}</span>
        <ChevronUp className="h-3 w-3 rotate-90 text-muted-foreground" />
      </div>
      <div className="flex items-center px-2.5 pt-1.5 text-muted-foreground">
        <Heart className="mr-2 h-3.5 w-3.5" /><MessageCircle className="mr-2 h-3.5 w-3.5" /><Send className="h-3.5 w-3.5" />
      </div>
      <p className="px-2.5 pb-2 pt-1 text-[10.5px] leading-snug [overflow-wrap:anywhere]">
        <span className="font-semibold">{nome || "Cliente"} </span>
        {visivel || <span className="text-muted-foreground">Texto principal</span>}
        {cortado && <span className="text-muted-foreground">… mais</span>}
      </p>
    </div>
  );
}

function Stories({ copy, caminho, formato, nome }: Props) {
  return (
    <TelaVertical caminho={caminho} formato={formato}>
      <div className="absolute inset-x-2 top-1.5 h-[2px] rounded bg-white/40"><div className="h-full w-1/3 rounded bg-white" /></div>
      <div className="absolute inset-x-2 top-3 flex items-center">
        <Avatar nome={nome} claro />
        <span className="min-w-0">
          <span className="block truncate text-[10px] font-semibold text-white drop-shadow">{nome || "Cliente"}</span>
          <span className="block text-[9px] text-white/80 drop-shadow">Patrocinado</span>
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-2 flex flex-col items-center">
        <ChevronUp className="h-3.5 w-3.5 text-white drop-shadow" />
        <span className="mt-0.5 rounded-full bg-white px-3 py-1 text-[10px] font-semibold text-black">{rotuloDoCta(copy.cta_meta) || "Saiba mais"}</span>
      </div>
    </TelaVertical>
  );
}

function Reels({ copy, caminho, formato, nome }: Props) {
  const { visivel } = textoVisivel(copy.texto_principal || "", 60);
  return (
    <TelaVertical caminho={caminho} formato={formato}>
      <div className="absolute inset-x-2 bottom-2">
        <div className="mb-1 flex items-center">
          <Avatar nome={nome} claro />
          <span className="truncate text-[10px] font-semibold text-white drop-shadow">{nome || "Cliente"}</span>
          <span className="ml-1 text-[9px] text-white/80">· Patrocinado</span>
        </div>
        <p className="mb-1.5 line-clamp-2 text-[9.5px] leading-snug text-white drop-shadow [overflow-wrap:anywhere]">{visivel || "Texto principal"}</p>
        <span className="block rounded-md bg-white/25 py-1 text-center text-[10px] font-semibold text-white">{rotuloDoCta(copy.cta_meta) || "Saiba mais"}</span>
      </div>
    </TelaVertical>
  );
}

function FeedFacebook({ copy, caminho, formato, nome }: Props) {
  const f = formatoDe(formato);
  const { visivel, cortado } = textoVisivel(copy.texto_principal || "");
  const proporcao = f.valor === "stories_9x16" ? 1.25 : f.altura / f.largura;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background text-foreground" aria-label="Prévia no feed do Facebook">
      <div className="flex items-center px-2.5 py-1.5">
        <Avatar nome={nome} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-semibold">{nome || "Cliente"}</span>
          <span className="flex items-center text-[9.5px] text-muted-foreground">Patrocinado <Globe className="ml-1 h-2.5 w-2.5" /></span>
        </span>
        <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <p className="px-2.5 pb-1.5 text-[10.5px] leading-snug [overflow-wrap:anywhere]">
        {visivel || <span className="text-muted-foreground">Texto principal</span>}
        {cortado && <span className="text-muted-foreground">… Ver mais</span>}
      </p>
      <Arte caminho={caminho} proporcao={proporcao} />
      <div className="flex items-center bg-muted/60 px-2.5 py-1.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[10.5px] font-semibold">{copy.titulo || <span className="font-normal text-muted-foreground">Título</span>}</span>
          {copy.descricao && <span className="block truncate text-[9.5px] text-muted-foreground">{copy.descricao}</span>}
        </span>
        <span className="ml-2 shrink-0 rounded bg-secondary px-2 py-1 text-[10px] font-medium">{rotuloDoCta(copy.cta_meta) || "CTA"}</span>
      </div>
      <div className="flex items-center justify-around border-t border-border py-1 text-[9.5px] text-muted-foreground">
        <span className="flex items-center"><ThumbsUp className="mr-1 h-3 w-3" />Curtir</span>
        <span className="flex items-center"><MessageCircle className="mr-1 h-3 w-3" />Comentar</span>
      </div>
    </div>
  );
}

const POSICIONAMENTOS = [
  { id: "feed_ig", rotulo: "Feed do Instagram", largura: LARGURA_FEED, Comp: FeedInstagram },
  { id: "stories", rotulo: "Stories", largura: LARGURA_VERTICAL, Comp: Stories },
  { id: "reels", rotulo: "Reels", largura: LARGURA_VERTICAL, Comp: Reels },
  { id: "feed_fb", rotulo: "Feed do Facebook", largura: LARGURA_FEED, Comp: FeedFacebook },
] as const;

export default function PosicionamentosDoAnuncio(props: Props) {
  const [so, setSo] = useState<string | null>(null);
  const lista = so ? POSICIONAMENTOS.filter((p) => p.id === so) : POSICIONAMENTOS;
  const f = formatoDe(props.formato);
  return (
    <section aria-label="Como fica em cada posicionamento">
      <div className="mb-2 flex min-w-0 flex-wrap items-center">
        <h3 className="mr-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Como fica em cada posicionamento</h3>
        <div className="flex flex-wrap" role="group" aria-label="Filtrar posicionamentos">
          {[{ id: null as string | null, rotulo: "Todos" }].concat(POSICIONAMENTOS.map((p) => ({ id: p.id as string | null, rotulo: p.rotulo }))).map((p) => (
            <button
              key={p.id || "todos"}
              type="button"
              aria-pressed={so === p.id}
              onClick={() => setSo(p.id)}
              className={`mb-1 mr-1 rounded-full border px-2 py-0.5 text-[10.5px] ${so === p.id ? "border-primary/60 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-secondary"}`}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-start">
        {lista.map((p) => (
          <figure key={p.id} className="mb-3 mr-3 min-w-0" style={{ width: p.largura, maxWidth: "100%" }}>
            <p.Comp {...props} />
            <figcaption className="mt-1 text-center text-[10.5px] text-muted-foreground">{p.rotulo}</figcaption>
          </figure>
        ))}
      </div>
      <p className="text-[10.5px] text-muted-foreground">
        Arte em {f.rotulo}. {f.valor === "stories_9x16" ? "No feed a Meta recorta em 4:5 pelo centro." : "Nos stories e reels a Meta centraliza a arte sobre um fundo desfocado; para ocupar a tela toda, gere também o formato 9:16."}
      </p>
    </section>
  );
}
