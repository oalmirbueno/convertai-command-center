import { createContext, useContext, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { ImagemDaMesa } from "@/components/mesa/MesaContexto";
import type { FotoDoAcervo } from "@/components/mesa-foto/fotoApi";
import { ROTULO_DO_STATUS, statusDaCampanha, type CampanhaDePublicidade } from "./publicidadeApi";

/**
 * Peças comuns da Mesa Publicidade: as etapas (Campanha, Direção, Tomadas,
 * Revisão e Envio), o contexto da página (campanha aberta, troca de etapa,
 * pedido ao agente) e a moldura de foto (proporção pelo padding-bottom, sem
 * a proporção nativa do CSS, que o Safari 11 não tem).
 *
 * Regra da fotografia: nada escurece a foto. Selos em pílulas claras.
 */

export const ETAPAS_DA_PUBLICIDADE = [
  { valor: "campanha", rotulo: "Campanha", passo: 1, dica: "Produto e briefing versionado" },
  { valor: "direcao", rotulo: "Direção", passo: 2, dica: "Três territórios criativos; a equipe aprova um" },
  { valor: "tomadas", rotulo: "Tomadas", passo: 3, dica: "Seis tomadas pedidas à Mesa Foto" },
  { valor: "revisao", rotulo: "Revisão", passo: 4, dica: "Produto antes da estética" },
  { valor: "envio", rotulo: "Envio", passo: 5, dica: "Para a Mesa e a Mesa Ads, com linhagem" },
] as const;

export type EtapaDaPublicidade = (typeof ETAPAS_DA_PUBLICIDADE)[number]["valor"];

export const ehEtapa = (v: unknown): v is EtapaDaPublicidade => ETAPAS_DA_PUBLICIDADE.some((e) => e.valor === v);

export interface MesaPublicidadeValor {
  campanha: CampanhaDePublicidade | null;
  carregando: boolean;
  /** false quando o SQL da mesa não foi aplicado (rascunho só na tela). */
  banco: boolean;
  abrirCampanha: (id: string | null) => void;
  /** Guarda a campanha que a função devolveu (cache ou rascunho) e redesenha. */
  aplicar: (c: CampanhaDePublicidade) => void;
  irPara: (e: EtapaDaPublicidade) => void;
  pedirAoAgente: (mensagem: string) => void;
}

const Contexto = createContext<MesaPublicidadeValor | null>(null);

export function MesaPublicidadeProvider({ valor, children }: { valor: MesaPublicidadeValor; children: ReactNode }) {
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useMesaPublicidade(): MesaPublicidadeValor {
  const v = useContext(Contexto);
  if (!v) throw new Error("useMesaPublicidade fora da Mesa Publicidade");
  return v;
}

export function CabecalhoDaEtapa({ titulo, descricao, acoes }: { titulo: string; descricao?: string; acoes?: ReactNode }) {
  return (
    <div className="mb-3 flex min-w-0 flex-wrap items-start">
      <div className="mr-3 min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold leading-tight">{titulo}</h2>
        {descricao && <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{descricao}</p>}
      </div>
      {acoes && <div className="mt-2 flex flex-wrap items-center sm:mt-0">{acoes}</div>}
    </div>
  );
}

export function AvisoDoRascunho() {
  return (
    <div className="mb-3 flex items-start rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] leading-snug" data-rascunho-da-publicidade="">
      <AlertTriangle className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <span>O banco da Mesa Publicidade ainda não foi publicado. A campanha fica como rascunho nesta aba do navegador; o ensaio e as fotos continuam salvos na Mesa Foto.</span>
    </div>
  );
}

export function StatusDaCampanhaPilula({ campanha }: { campanha: CampanhaDePublicidade }) {
  const s = statusDaCampanha(campanha);
  return <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">{ROTULO_DO_STATUS[s]}</span>;
}

/** Foto numa moldura de proporção fixa (padding-bottom), sem escurecer. */
export function MolduraDaFoto({
  caminho,
  bucket = "mesa",
  alt,
  proporcao = 1.25,
  rotulo,
  className = "",
}: {
  caminho: string | null | undefined;
  bucket?: string;
  alt: string;
  proporcao?: number;
  rotulo?: string;
  className?: string;
}) {
  return (
    <div className={`relative w-full overflow-hidden rounded-lg border border-border bg-secondary/40 ${className}`} style={{ paddingBottom: `${Math.round(proporcao * 100)}%` }}>
      <div className="absolute inset-0">
        <ImagemDaMesa caminho={caminho || null} bucket={bucket} alt={alt} className="h-full w-full" />
      </div>
      {rotulo && <span className="absolute left-1.5 top-1.5 rounded-full bg-background/90 px-1.5 py-px text-[10px] font-medium text-foreground shadow-sm">{rotulo}</span>}
    </div>
  );
}

/** As fotos reais do produto (fontes do kit), pequenas, para comparar. */
export function FontesDoProduto({ ids, fotos, max = 6 }: { ids: string[]; fotos: FotoDoAcervo[]; max?: number }) {
  const lista = ids.map((id) => fotos.find((f) => f.id === id)).filter((f): f is FotoDoAcervo => !!f).slice(0, max);
  if (!lista.length) return <p className="text-[11.5px] text-muted-foreground">Sem foto real do produto no kit.</p>;
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6" data-fontes-do-produto="">
      {lista.map((f) => (
        <MolduraDaFoto key={f.id} caminho={f.storage_path} bucket={f.storage_bucket} alt={f.nome} proporcao={1} />
      ))}
    </div>
  );
}

export function SemCampanha({ etapa }: { etapa: string }) {
  const { irPara } = useMesaPublicidade();
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center">
      <p className="text-[13.5px] font-medium">Abra uma campanha para ver {etapa}.</p>
      <button type="button" className="mt-2 text-[12.5px] font-medium text-primary hover:underline" onClick={() => irPara("campanha")}>
        Escolher o produto e abrir a campanha
      </button>
    </div>
  );
}
