import { createContext, useContext, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { ImagemDaMesa } from "@/components/mesa/MesaContexto";
import type { FotoDoAcervo } from "@/components/mesa-foto/fotoApi";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { CabecalhoDeSecao, type RecolherDoCabecalho } from "@/components/sistema/Secao";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { ROTULO_DO_STATUS, statusDaCampanha, type CampanhaDePublicidade } from "./publicidadeApi";

/**
 * Peças comuns da Mesa Publicidade: as etapas (Campanha, Direção, Tomadas,
 * Revisão e Envio), o contexto da página (campanha aberta, troca de etapa,
 * pedido ao agente), o cabeçalho de etapa do sistema de design (título curto,
 * explicação no "?", estado em uma linha e ações na mesma linha) e a moldura
 * de foto (proporção pelo padding-bottom, sem a proporção nativa do CSS, que o
 * Safari 11 não tem).
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
  /** Põe o pedido no campo do agente (lateral fixa) e mostra o agente. */
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

/**
 * Cabeçalho da etapa: título curto com o "?" ao lado, uma linha de estado e as
 * ações à direita, na mesma linha. No celular as ações encolhem (ícone) e, se
 * ainda faltar espaço, descem juntas à direita; o título nunca some.
 */
export function CabecalhoDaEtapa({
  titulo,
  ajuda,
  estado,
  acoes,
  nivel = 2,
  recolher,
}: {
  titulo: ReactNode;
  ajuda?: ReactNode;
  estado?: ReactNode;
  acoes?: ReactNode;
  nivel?: 2 | 3;
  /** O título vira o botão de recolher o bloco (use com useRecolhido; recolhido, as ações somem). */
  recolher?: RecolherDoCabecalho;
}) {
  // O cabeçalho do sistema (mesmo desenho que nasceu aqui). Promovido em 26/09 (frente C).
  return (
    <CabecalhoDeSecao
      data-cabecalho-da-etapa=""
      titulo={titulo}
      ajuda={ajuda}
      rotuloDaAjuda={typeof titulo === "string" ? `Sobre ${titulo}` : "O que é isto?"}
      descricao={estado}
      acao={recolher && recolher.recolhido ? undefined : acoes}
      nivel={nivel}
      recolher={recolher}
      classeDoTitulo={nivel === 3 ? "text-[13.5px]" : ""}
      truncar
    />
  );
}

/** Rótulo de botão que vira só ícone no celular (o botão leva o aria-label com o texto todo). Mora no sistema. */
export { RotuloLargo } from "@/components/sistema/BotaoComIcone";

export function AvisoDoRascunho() {
  return (
    <div className="flex min-w-0 items-center rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] leading-4" data-rascunho-da-publicidade="">
      <AlertTriangle className="mr-2 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
      <span className="mr-1 min-w-0 flex-1 truncate">Rascunho: o banco da Mesa Publicidade ainda não foi publicado.</span>
      <AjudaRecolhida rotulo="Sobre o rascunho">
        A campanha fica como rascunho nesta aba do navegador. O ensaio e as fotos continuam salvos na Mesa Foto.
      </AjudaRecolhida>
    </div>
  );
}

export function StatusDaCampanhaPilula({ campanha }: { campanha: CampanhaDePublicidade }) {
  const s = statusDaCampanha(campanha);
  return <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>{ROTULO_DO_STATUS[s]}</span>;
}

/** Foto numa moldura de proporção fixa (padding-bottom), sem escurecer e sem moldura extra. */
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
    <div className={`relative w-full overflow-hidden rounded-md bg-muted ${className}`} style={{ paddingBottom: `${Math.round(proporcao * 100)}%` }}>
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
  if (!lista.length) return <p className={texto.auxiliar}>Sem foto real do produto no kit.</p>;
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
    <EstadoVazio
      titulo={`Abra uma campanha para ver ${etapa}.`}
      acao={
        <button type="button" className={botao.secundario} onClick={() => irPara("campanha")}>
          Escolher o produto
        </button>
      }
    />
  );
}
