import { Bot, Box, Film, MapPin, MessageSquareText, Palette, Sparkles, UserRound } from "lucide-react";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { ImagemDaBiblioteca } from "../EtapaBiblioteca";
import { rotuloDoTipo, type FotoDoAcervo, type ItemDaBiblioteca, type KitDeFoto } from "../fotoApi";
import { STATUS_DA_PERSONA, type ImagemDaPersona, type Persona } from "../modelosApi";
import { faltaNoCartao, TIPOS_DE_NO, type NoDoCanvas, type ProdutoDaEsteira, type TipoDeNo } from "../canvasApi";

/**
 * Peças comuns do Canvas v3 (sem React Flow): o que cada cartão mostra, os
 * ícones e as classes do visual. Visual (dono, 25/09): "cards menores e
 * pretos, senão não vejo nada; os negocinhos que abrem menores, mais bonitos,
 * modernos". Cores fixas, sem depender do tema: cartões e painéis pretos,
 * texto claro; o quadro pode ser claro.
 */

export const ICONES: Record<TipoDeNo, typeof Box> = { produto: Box, modelo: UserRound, ambiente: MapPin, estilo: Palette, texto: MessageSquareText, gerar: Sparkles, agente: Bot };
export const ICONE_DO_VIDEO = Film;

/** Painel flutuante preto (paleta, ajustes, esteira, galeria, conversa). */
export const PAINEL = "border border-white/10 bg-zinc-950/95 text-zinc-100 shadow-2xl";
/** Botão pequeno sobre fundo preto. */
export const BOTAO = "inline-flex h-7 shrink-0 items-center rounded-lg border border-white/10 bg-white/5 px-2 text-[11.5px] text-zinc-100 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50";
/** Pílula de escolha sobre fundo preto (ligada ou não). */
export const pilula = (ligada: boolean) =>
  `mb-1 mr-1 inline-flex h-7 max-w-full items-center truncate rounded-full border px-2.5 text-[11.5px] transition-colors ${ligada ? "border-emerald-400/70 bg-emerald-400/15 text-white" : "border-white/10 bg-white/5 text-zinc-400 hover:text-white"}`;
/** Rótulo pequeno de seção nos painéis pretos. */
export const ROTULO = "mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400";
/** Campo de texto sobre fundo preto. */
export const CAMPO = "w-full min-w-0 rounded-lg border border-white/10 bg-zinc-900/70 px-2.5 py-2 text-[12.5px] text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-400/60 focus:outline-none";

export interface Miniatura {
  caminho: string;
  bucket: string;
  item?: ItemDaBiblioteca | null;
}

export interface Descricao {
  titulo: string;
  subtitulo: string;
  miniatura: Miniatura | null;
}

export interface Fontes {
  kits: KitDeFoto[];
  fotos: FotoDoAcervo[];
  personas: Persona[];
  ancoras: ImagemDaPersona[];
  biblioteca: ItemDaBiblioteca[];
  /** Produtos de outros clientes citados no quadro (vieram da esteira). */
  produtosDeFora: ProdutoDaEsteira[];
}

export const daFoto = (x: FotoDoAcervo | null): Miniatura | null => (x ? { caminho: x.storage_path, bucket: x.storage_bucket || "mesa" } : null);

export function capaDoKit(k: KitDeFoto, fotos: FotoDoAcervo[]): Miniatura | null {
  const id = k.frente_imagem_id || (k.refs[0] && k.refs[0].imagem_id) || null;
  return daFoto(id ? fotos.find((x) => x.id === id) || null : null);
}

export function rostoDaPersona(p: Persona, ancoras: ImagemDaPersona[]): Miniatura | null {
  const a = p.ancora_imagem_id ? ancoras.find((x) => x.id === p.ancora_imagem_id) || null : null;
  return a ? { caminho: a.storage_path || a.url, bucket: a.storage_bucket || "mesa" } : null;
}

export const kitsUsaveis = (kits: KitDeFoto[]) => kits.filter((k) => !!k.id && k.tipo !== "pessoa" && k.status !== "arquivado");
export const personaSemAncora = (p: Persona) => p.status === "rascunho" || p.status === "candidatos";

const MODO_DO_AMBIENTE: Record<string, string> = { descrever: "descrito", foto: "pela foto", contexto: "pelo contexto do cliente" };

export function descrever(no: NoDoCanvas, f: Fontes): Descricao {
  const d = no.dados;
  const foto = (id?: string | null) => (id ? f.fotos.find((x) => x.id === id) || null : null);
  const falta = faltaNoCartao(no);
  if (no.tipo === "produto") {
    const k = f.kits.find((x) => x.id === d.kit_id) || null;
    if (k) return { titulo: k.nome, subtitulo: `${rotuloDoTipo(k.tipo)}${k.variante ? ` · ${k.variante}` : ""}`, miniatura: capaDoKit(k, f.fotos) };
    const deFora = d.kit_id ? f.produtosDeFora.find((x) => x.kit_id === d.kit_id) || null : null;
    if (deFora) return { titulo: deFora.nome, subtitulo: "de outro cliente", miniatura: deFora.capa };
    return { titulo: d.titulo || "Produto", subtitulo: d.kit_id ? "de outro cliente" : falta, miniatura: null };
  }
  if (no.tipo === "modelo") {
    if (d.modelo_id) {
      const p = f.personas.find((x) => x.id === d.modelo_id) || null;
      return { titulo: p ? p.nome : "Pessoa", subtitulo: p ? `modelo · ${STATUS_DA_PERSONA[p.status].rotulo}` : falta, miniatura: p ? rostoDaPersona(p, f.ancoras) : null };
    }
    if (d.imagem_id) {
      const x = foto(d.imagem_id);
      return { titulo: d.titulo || (x ? x.nome : "Pessoa real"), subtitulo: falta || "foto real, autorizada", miniatura: daFoto(x) };
    }
    return { titulo: "Pessoa", subtitulo: falta, miniatura: null };
  }
  if (no.tipo === "ambiente" || no.tipo === "estilo") {
    const x = foto(d.imagem_id);
    const item = d.biblioteca_id ? f.biblioteca.find((i) => i.id === d.biblioteca_id) || null : null;
    const t = (d.texto || "").trim();
    if (no.tipo === "ambiente" && d.modo === "contexto" && !t) return { titulo: "Pelo contexto", subtitulo: "lugar com a cara da marca", miniatura: null };
    const sub = no.tipo === "estilo" ? "só paleta, luz e enquadramento" : `${MODO_DO_AMBIENTE[d.modo || "descrever"]}${d.modo === "foto" ? (d.uso === "usar" ? ", como está" : ", complementado") : ""}`;
    return {
      titulo: item ? item.titulo : t ? t.slice(0, 48) : x ? x.nome : TIPOS_DE_NO[no.tipo].rotulo,
      subtitulo: falta || sub,
      miniatura: item ? { caminho: "", bucket: "mesa", item } : daFoto(x),
    };
  }
  if (no.tipo === "texto") {
    const t = (d.texto || "").trim();
    return { titulo: t ? t.slice(0, 60) : "Pedido", subtitulo: falta || (d.papel === "restricao" ? "restrição" : "pedido"), miniatura: null };
  }
  if (no.tipo === "agente") {
    const p = (d.pedido || "").trim();
    return { titulo: "Agente", subtitulo: p ? p.slice(0, 60) : "toque para conversar", miniatura: null };
  }
  return { titulo: "Resultado", subtitulo: "", miniatura: null };
}

/** Escolha única em pílulas pretas (radiogroup acessível, como as Pilulas do painel). */
export function Escolha<T extends string | number>({ opcoes, valor, onEscolher, rotulo }: { opcoes: { valor: T; rotulo: string; dica?: string }[]; valor: T | null; onEscolher: (v: T) => void; rotulo: string }) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="flex min-w-0 flex-wrap">
      {opcoes.map((o) => (
        <button key={String(o.valor)} type="button" role="radio" aria-checked={valor === o.valor} title={o.dica} onClick={() => onEscolher(o.valor)} className={pilula(valor === o.valor)}>
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

export function MiniaturaGrande({ m, alt }: { m: Miniatura | null; alt: string }) {
  if (!m) return null;
  return m.item ? <ImagemDaBiblioteca item={m.item} /> : <MiniaturaDoStorage bucket={m.bucket} caminho={m.caminho} alt={alt} largura={320} className="h-full w-full" />;
}
