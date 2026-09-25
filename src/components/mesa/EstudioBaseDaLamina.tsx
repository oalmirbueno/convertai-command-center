import type { ReactNode } from "react";
import { Bookmark, ImagePlus, Scissors, TriangleAlert, X } from "lucide-react";
import { fonteDaGlobal, fonteDaReferencia, PREFIXO_GLOBAL, useGlobaisPorIds, useReferenciasComDestaque } from "@/lib/mesa/referencias";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { ImagemDeReferencia } from "./SeletorDeReferencias";
import { useAcervo } from "./SeletorDoAcervo";
import type { CardDaDirecao, CardGerado } from "./useItensDoMes";
import { AVISO_CONTINUO_SEM_MODELO } from "./estudioUtil";

/**
 * O que a próxima geração da lâmina vai usar, mostrado EM CIMA da lâmina
 * grande (pedido do dono em 25/09: "o que foi escolhido aparece na lâmina na
 * hora"): a foto da lâmina, as referências escolhidas e o modo em que o
 * gerador vai trabalhar. Os botões abrem as ferramentas Fotos e Referências.
 *
 * Com referência escolhida (da lâmina ou do conjunto) a lâmina é recomposta
 * seguindo o layout dela (modo replicar referência, servidor estudio-arte):
 * com foto, a foto também é recomposta, então a tela avisa para conferir o
 * rosto. No carrossel contínuo o panorama manda na cena e a referência não é
 * replicada (mesma regra do servidor).
 *
 * Contínuo (auditoria de 25/09): avisa quando o modelo escolhido não faz o
 * panorama (as lâminas saem uma a uma), quando a lâmina tem foto própria (sai
 * do panorama e as vizinhas não emendam com ela) e quando a versão na tela
 * foi feita sobre um fundo que não é mais o atual ("fora do fundo"), com o
 * botão de gerar de novo.
 */

export type ModoDaGeracao = "replicar_referencia" | "foto_real" | "foto_composta" | "elementos" | "recorte" | "continuo" | "normal";

export const AVISO_FOTO_RECOMPOSTA = "A foto é recomposta para seguir a referência; confira o rosto.";
export const AVISO_FORA_DO_FUNDO = "Esta versão foi feita sobre um fundo contínuo que mudou depois: ela não emenda com as vizinhas. Gere de novo.";
export const AVISO_FORA_DA_EMENDA = "Nesta versão o gerador mudou a cena e a fatia do panorama não pôde ser mantida: a emenda com as vizinhas pode não bater. Gere de novo.";
export const AVISO_FOTO_NO_CONTINUO = "Com foto própria, esta lâmina sai do fundo contínuo: as vizinhas não emendam com ela.";

export const DESCRICAO_DO_MODO: Record<ModoDaGeracao, string> = {
  replicar_referencia: "Replica o layout da referência com a marca, o texto e a foto desta lâmina.",
  foto_real: "Foto real fixa: o gerador só escreve o texto e a logo entra pelo sistema.",
  foto_composta: "Foto de fundo com pessoa ou objeto real composto por cima.",
  elementos: "O gerador cria a cena e põe a pessoa ou o objeto real como é.",
  recorte: "Pessoa ou produto sem fundo: entra inteiro do lado oposto ao texto, com a cena, a referência e a identidade em volta, sem caixa.",
  continuo: "Carrossel contínuo: o fundo panorâmico manda na cena.",
  normal: "O gerador cria a lâmina inteira pela direção de arte.",
};

export interface BaseDaLamina {
  modo: ModoDaGeracao;
  /** Referências que valem para esta lâmina (as dela ou, sem elas, as do conjunto), no máximo 2. */
  referencias: string[];
  /** As referências são da própria lâmina (senão, do conjunto). */
  daLamina: boolean;
  temFoto: boolean;
  /** Vai recompor a foto do cliente (replicar referência com foto). */
  fotoRecomposta: boolean;
}

/**
 * O modo da próxima geração, pela mesma regra do servidor (gerarCard):
 * contínuo sem foto usa o panorama; referência escolhida replica; foto sem
 * referência fica fixa (ou composta com elementos).
 */
export function baseDaLamina(
  card: Pick<CardDaDirecao, "referencias_ids" | "imagens_ids" | "fotos_livres">,
  refsDoConjunto: string[] | null | undefined,
  continuo: boolean,
): BaseDaLamina {
  const proprias = card.referencias_ids || [];
  const daLamina = proprias.length > 0;
  const referencias = (daLamina ? proprias : refsDoConjunto || []).slice(0, 2);
  const livres = card.fotos_livres || [];
  const acervo = (card.imagens_ids || []).length > 0;
  const fundo = acervo || livres.some((f) => f.papel === "fundo");
  const elementos = livres.some((f) => f.papel === "elemento");
  const recortado = livres.some((f) => f.papel === "elemento" && (f as { recortada?: boolean }).recortada === true);
  const temFoto = fundo || elementos;
  const panorama = continuo && !temFoto;
  let modo: ModoDaGeracao;
  if (panorama) modo = "continuo";
  else if (referencias.length) modo = "replicar_referencia";
  else if (fundo && elementos) modo = "foto_composta";
  else if (fundo) modo = "foto_real";
  else if (recortado) modo = "recorte";
  else if (elementos) modo = "elementos";
  else modo = "normal";
  return { modo, referencias, daLamina, temFoto, fotoRecomposta: modo === "replicar_referencia" && temFoto };
}

/** A versão nasceu recompondo a foto do cliente pela referência. */
export function versaoRecompos(v: Pick<CardGerado, "modo" | "foto_recomposta"> | null | undefined): boolean {
  return !!v && v.modo === "replicar_referencia" && v.foto_recomposta === true;
}

const LARGURA = 36;

/**
 * Miniatura com o X de tirar (pedido do dono em 25/09: "tirar imagem da
 * lâmina fácil"). Recorte sem fundo aparece sobre o xadrez de transparência.
 */
const XADREZ = {
  backgroundImage:
    "linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%), linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%)",
  backgroundSize: "8px 8px",
  backgroundPosition: "0 0, 4px 4px",
};

function Removivel({
  children,
  titulo,
  onTirar,
  rotulo,
  marca,
  xadrez = false,
}: {
  children: ReactNode;
  titulo: string;
  onTirar?: () => void;
  rotulo: string;
  marca?: ReactNode;
  xadrez?: boolean;
}) {
  return (
    <span className="relative mr-2 inline-block shrink-0 align-middle">
      <span
        className="block overflow-hidden rounded border border-border bg-secondary"
        style={xadrez ? { width: LARGURA, height: LARGURA * 1.25, ...XADREZ } : { width: LARGURA, height: LARGURA * 1.25 }}
        title={titulo}
      >
        {children}
      </span>
      {marca && <span className="absolute bottom-0.5 left-0.5 rounded bg-background/90 p-px text-foreground">{marca}</span>}
      {onTirar && (
        <button
          type="button"
          onClick={onTirar}
          aria-label={rotulo}
          title={rotulo}
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-destructive"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

function MiniDaReferencia({ id, onTirar }: { id: string; onTirar?: () => void }) {
  const { clientId } = useMesa();
  const global = id.indexOf(PREFIXO_GLOBAL) === 0;
  const refs = useReferenciasComDestaque(clientId, !global);
  const globais = useGlobaisPorIds(global ? [id] : []);
  const r = global ? null : (refs.data || []).find((x) => x.id === id) || null;
  const g = global ? (globais.data || [])[0] || null : null;
  const fonte = g ? fonteDaGlobal(g) : r ? fonteDaReferencia(r) : null;
  const nome = g ? g.titulo || "Banco da agência" : r ? r.nome : "Referência";
  return (
    <Removivel titulo={nome} onTirar={onTirar} rotulo={`Tirar a referência ${nome} desta lâmina`}>
      <ImagemDeReferencia fonte={fonte} alt={nome} largura={120} className="h-full w-full" />
    </Removivel>
  );
}

type VersaoNaTela = CardGerado & { fundo?: string | null; fora_da_emenda?: boolean };

export default function EstudioBaseDaLamina({
  card,
  refsDoConjunto,
  continuo,
  continuoSemModelo = false,
  foraDoFundo = false,
  acaoDoFundo,
  versao,
  onAbrirFotos,
  onAbrirReferencias,
  onTirarFoto,
  onTirarFotoDoAcervo,
  onTirarReferencia,
  bloqueado = false,
}: {
  card: CardDaDirecao;
  refsDoConjunto: string[] | null | undefined;
  /** Carrossel contínuo ligado com mais de uma lâmina E modelo que faz o panorama. */
  continuo: boolean;
  /** Contínuo ligado, mas o modelo escolhido não faz o panorama. */
  continuoSemModelo?: boolean;
  /** A versão na tela foi feita sobre um fundo que não é mais o da lâmina. */
  foraDoFundo?: boolean;
  /** Botão de gerar de novo (com o preço), mostrado junto do aviso do fundo. */
  acaoDoFundo?: ReactNode;
  /** Versão que está na tela (para o aviso da foto recomposta e da emenda). */
  versao: VersaoNaTela | null;
  onAbrirFotos: () => void;
  onAbrirReferencias: () => void;
  /** Tira da lâmina uma foto trazida (pelo caminho), sem abrir a ferramenta. */
  onTirarFoto?: (caminho: string) => void;
  /** Tira a foto do acervo (modo antigo, imagens_ids). */
  onTirarFotoDoAcervo?: () => void;
  /** Tira uma referência da lâmina (as do conjunto saem pela ferramenta Referências). */
  onTirarReferencia?: (id: string) => void;
  /** Trabalho entregue ou lâmina ocupada: sem os botões de tirar. */
  bloqueado?: boolean;
}) {
  const base = baseDaLamina(card, refsDoConjunto, continuo);
  const foraDaEmenda = !!versao && versao.modo === "panorama" && versao.fora_da_emenda === true;
  const livres = card.fotos_livres || [];
  const doAcervo = card.imagens_ids || [];
  const acervo = useAcervo(doAcervo.length > 0);
  const fotoDoAcervo = doAcervo.length ? (acervo.data || []).find((i) => i.id === doAcervo[0]) || null : null;

  return (
    <div className="mb-2 min-w-0 shrink-0 rounded-lg border border-border bg-background px-2.5 py-2" aria-label="Base da próxima geração">
      <div className="flex min-w-0 flex-wrap items-center">
        {/* Foto: o rótulo abre a ferramenta; cada miniatura tem o X para tirar da lâmina na hora. */}
        <div className="mb-1 mr-3 flex min-w-0 items-center">
          <button type="button" onClick={onAbrirFotos} className="mr-1.5 rounded-md px-0.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:bg-secondary hover:text-foreground" title="Escolher a foto desta lâmina">
            Foto
          </button>
          {fotoDoAcervo && (
            <Removivel titulo={fotoDoAcervo.nome} onTirar={!bloqueado && onTirarFotoDoAcervo ? onTirarFotoDoAcervo : undefined} rotulo="Tirar a foto do acervo desta lâmina">
              <ImagemDaMesa caminho={fotoDoAcervo.storage_path} bucket={fotoDoAcervo.storage_bucket || "mesa"} alt={fotoDoAcervo.nome} className="h-full w-full" />
            </Removivel>
          )}
          {livres.map((f) => {
            const recortada = (f as { recortada?: boolean }).recortada === true;
            const titulo = f.papel === "fundo" ? "Fundo" : recortada ? "Elemento sem fundo" : "Elemento";
            return (
              <Removivel
                key={f.caminho}
                titulo={titulo}
                onTirar={!bloqueado && onTirarFoto ? () => onTirarFoto(f.caminho) : undefined}
                rotulo={`Tirar da lâmina: ${titulo.toLowerCase()}`}
                marca={recortada ? <Scissors className="h-2.5 w-2.5" /> : null}
                xadrez={recortada}
              >
                <ImagemDaMesa caminho={f.caminho} alt={titulo} className="h-full w-full" />
              </Removivel>
            );
          })}
          {!base.temFoto && (
            <button type="button" onClick={onAbrirFotos} className="inline-flex items-center rounded-md px-1 py-0.5 text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground">
              <ImagePlus className="mr-1 h-3.5 w-3.5" /> escolher
            </button>
          )}
        </div>
        <div className="mb-1 flex min-w-0 items-center">
          <button type="button" onClick={onAbrirReferencias} className="mr-1.5 rounded-md px-0.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:bg-secondary hover:text-foreground" title="Escolher 1 ou 2 referências para esta lâmina">
            Referência
          </button>
          {base.referencias.map((id) => (
            <MiniDaReferencia key={id} id={id} onTirar={!bloqueado && base.daLamina && onTirarReferencia ? () => onTirarReferencia(id) : undefined} />
          ))}
          {base.referencias.length > 0 && !base.daLamina && <span className="mr-1 text-[11px] text-muted-foreground">(do conjunto)</span>}
          {!base.referencias.length && (
            <button type="button" onClick={onAbrirReferencias} className="inline-flex items-center rounded-md px-1 py-0.5 text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground">
              <Bookmark className="mr-1 h-3.5 w-3.5" /> escolher
            </button>
          )}
        </div>
      </div>
      <p className="text-[11.5px] leading-snug text-muted-foreground">{DESCRICAO_DO_MODO[base.modo]}</p>
      {continuoSemModelo && (
        <p className="mt-1 flex items-start text-[11.5px] leading-snug text-warning" data-aviso="continuo-sem-modelo">
          <TriangleAlert className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0" /> {AVISO_CONTINUO_SEM_MODELO}
        </p>
      )}
      {continuo && base.temFoto && (
        <p className="mt-1 flex items-start text-[11.5px] leading-snug text-muted-foreground" data-aviso="foto-no-continuo">
          <TriangleAlert className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0" /> {AVISO_FOTO_NO_CONTINUO}
        </p>
      )}
      {(foraDoFundo || foraDaEmenda) && (
        <div className="mt-1 flex min-w-0 flex-wrap items-center" data-aviso="fora-do-fundo">
          <p className="mr-2 flex min-w-0 flex-1 items-start text-[11.5px] leading-snug text-warning">
            <TriangleAlert className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0" /> {foraDoFundo ? AVISO_FORA_DO_FUNDO : AVISO_FORA_DA_EMENDA}
          </p>
          {acaoDoFundo}
        </div>
      )}
      {base.fotoRecomposta && (
        <p className="mt-1 flex items-start text-[11.5px] leading-snug text-warning">
          <TriangleAlert className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0" /> {AVISO_FOTO_RECOMPOSTA}
        </p>
      )}
      {versaoRecompos(versao) && !base.fotoRecomposta && (
        <p className="mt-1 flex items-start text-[11.5px] leading-snug text-warning">
          <TriangleAlert className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0" /> Esta versão recompôs a foto pela referência; confira o rosto.
        </p>
      )}
    </div>
  );
}
