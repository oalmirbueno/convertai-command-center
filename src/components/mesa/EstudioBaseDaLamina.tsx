import { useState, type ReactNode } from "react";
import { Bookmark, ImagePlus, Link2, MoreHorizontal, Scissors, TriangleAlert, X } from "lucide-react";
import { MenuDeContexto } from "@/components/ui/menu-de-contexto";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { fonteDaGlobal, fonteDaReferencia, PREFIXO_GLOBAL, useGlobaisPorIds, useReferenciasComDestaque } from "@/lib/mesa/referencias";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { ImagemDeReferencia } from "./SeletorDeReferencias";
import { useAcervo } from "./SeletorDoAcervo";
import type { CardDaDirecao, CardGerado } from "./useItensDoMes";
import { AVISO_CONTINUO_SEM_MODELO } from "./estudioUtil";
import { seloDaSerie } from "./fidelidadeDaReferencia";

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
  foto_real: "Foto real fixa: o gerador só escreve o texto e desenha a logo na área dela; a foto fica como está.",
  foto_composta: "Foto de fundo com pessoa ou objeto real composto por cima.",
  elementos: "O gerador cria a cena e põe a pessoa ou o objeto real como é.",
  recorte: "Pessoa ou produto sem fundo: entra inteiro do lado oposto ao texto, com a cena, a referência e a identidade em volta, sem caixa.",
  continuo: "Carrossel contínuo: o fundo panorâmico manda na cena; o gerador escreve o texto e desenha a logo por cima.",
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

const LARGURA = 28;

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

/** Nome curto da referência (do cliente ou do banco da agência), para o selo da série. */
function NomeDaReferencia({ id }: { id: string }) {
  const { clientId } = useMesa();
  const global = id.indexOf(PREFIXO_GLOBAL) === 0;
  const refs = useReferenciasComDestaque(clientId, !global);
  const globais = useGlobaisPorIds(global ? [id] : []);
  const r = global ? null : (refs.data || []).find((x) => x.id === id) || null;
  const g = global ? (globais.data || [])[0] || null : null;
  return <>{g ? g.titulo || "do banco da agência" : r ? r.nome : "escolhida"}</>;
}

/**
 * Selo da série nas lâminas 2..N (frente E, 25/09 à noite; dono perguntou se
 * as lâminas seguintes seguem a capa). Só informação, pela regra do servidor:
 * sem referência, a lâmina segue a capa (a capa gerada vai anexada e o bloco
 * da série repete o sistema dela); com referência, segue a referência.
 */
export function SeloDaSerie({ card, total, refsDoConjunto }: { card: CardDaDirecao; total: number; refsDoConjunto: string[] | null | undefined }) {
  const selo = seloDaSerie(card, total, refsDoConjunto);
  if (!selo) return null;
  return (
    <span
      className="mb-1 mr-3 inline-flex min-w-0 max-w-full items-center rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[10.5px] text-muted-foreground"
      data-selo="serie"
      title={selo.tipo === "capa"
        ? "Da lâmina 2 em diante, a capa gerada vai junto. Esta lâmina herda a identidade dela (fundo, fontes, cores, grafismos), sem repetir o que é só da capa."
        : selo.daLamina
        ? "Esta lâmina replica a referência escolhida para ela."
        : "Segue a referência do conjunto. O que é só da capa (título gigante, selo, foto de destaque) fica de fora desta lâmina."}
    >
      <Link2 className="mr-1 h-3 w-3 shrink-0" />
      <span className="min-w-0 truncate">
        {selo.tipo === "capa" ? "Segue a capa" : <>Segue a referência <NomeDaReferencia id={selo.referencia || ""} />{selo.daLamina ? "" : " (do conjunto)"}</>}
      </span>
    </span>
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
  logo,
  referenciaNaHora,
  total,
  fidelidade,
  avisoDoRosto,
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
  /** Seletor da logo do kit desta lâmina (26/09); só nas lâminas que levam logo. */
  logo?: ReactNode;
  /** Referência na hora (arrastar, arquivo, colar imagem ou link), gravada nesta lâmina (26/09). */
  referenciaNaHora?: ReactNode;
  /** Total de lâminas do trabalho: da lâmina 2 em diante mostra o selo da série (frente E). */
  total?: number;
  /** Controle da fidelidade à referência desta lâmina (frente E); só aparece quando a lâmina replica referência. */
  fidelidade?: ReactNode;
  /** Frente R2: aviso da conferência do rosto escolhido (só aviso, EstudioAvisoDoRosto). */
  avisoDoRosto?: ReactNode;
}) {
  const base = baseDaLamina(card, refsDoConjunto, continuo);
  const foraDaEmenda = !!versao && versao.modo === "panorama" && versao.fora_da_emenda === true;
  const livres = card.fotos_livres || [];
  const doAcervo = card.imagens_ids || [];
  const acervo = useAcervo(doAcervo.length > 0);
  const fotoDoAcervo = doAcervo.length ? (acervo.data || []).find((i) => i.id === doAcervo[0]) || null : null;
  // Frente AE-3 (dono, 28/09: "mais minimalista, moderno e compacto, sem tirar função"): uma linha só,
  // sem caixas. Foto e referência viram ícones com dica; o link e o Arquivo ficam na mesma linha; a logo
  // num seletor pequeno; a explicação do modo vai para o "?". Os avisos continuam à vista.
  // Recolhido por padrão quando a lâmina ainda não usa foto nem referência; a escolha da pessoa fica guardada.
  const [recolhido, setRecolhido] = useRecolhido("mesa:estudio:base-da-lamina", !base.temFoto && !base.referencias.length);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const abrirMenu = (e: { currentTarget: EventTarget }) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: Math.max(8, r.right - 224), y: r.bottom + 4 });
  };
  const temAvisos =
    continuoSemModelo || (continuo && base.temFoto) || foraDoFundo || foraDaEmenda || base.fotoRecomposta || (versaoRecompos(versao) && !base.fotoRecomposta);
  const resumo = `${base.temFoto ? "com foto" : "sem foto"} · ${base.referencias.length ? `${base.referencias.length} referência(s)` : "sem referência"}`;

  // Ícone que abre a ferramenta (a dica diz o quê); com foto ou referência, as miniaturas vêm logo depois.
  const botaoIcone = (onClick: () => void, icone: ReactNode, dica: string, dado: string) => (
    <button
      type="button"
      onClick={onClick}
      title={dica}
      aria-label={dica}
      className="mr-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
      data-abrir={dado}
    >
      {icone}
    </button>
  );
  const separador = <span className="mx-1 hidden h-5 w-px shrink-0 bg-border sm:block" aria-hidden="true" />;

  return (
    <div className="mb-2 min-w-0 shrink-0 border-b border-border/60 pb-1.5" aria-label="Base da próxima geração" data-base-da-lamina="">
      <div className="flex min-w-0 flex-wrap items-center gap-y-1">
        <div className="mr-2 min-w-0 shrink-0">
          <TituloRecolhivel titulo="Base da lâmina" recolhido={recolhido} onAlternar={() => setRecolhido(!recolhido)} resumo={recolhido ? resumo : undefined} />
        </div>
        {!recolhido && (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-y-1" data-grupos-da-base="">
            {/* Foto: o ícone abre a ferramenta Fotos; cada miniatura tem o X de tirar. */}
            <div className="flex min-w-0 items-center" aria-label="Foto da lâmina" data-grupo="foto">
              {botaoIcone(onAbrirFotos, <ImagePlus className="h-4 w-4" />, "Foto desta lâmina (acervo, Mesa Foto, enviar)", "fotos")}
              {fotoDoAcervo && (
                <Removivel titulo={fotoDoAcervo.nome} onTirar={!bloqueado && onTirarFotoDoAcervo ? onTirarFotoDoAcervo : undefined} rotulo="Tirar a foto do acervo desta lâmina">
                  <ImagemDaMesa caminho={fotoDoAcervo.storage_path} bucket={fotoDoAcervo.storage_bucket || "mesa"} alt={fotoDoAcervo.nome} className="h-full w-full" />
                </Removivel>
              )}
              {livres.map((f) => {
                const recortada = (f as { recortada?: boolean }).recortada === true;
                const tituloDaFoto = f.papel === "fundo" ? "Fundo" : recortada ? "Elemento sem fundo" : "Elemento";
                return (
                  <Removivel
                    key={f.caminho}
                    titulo={tituloDaFoto}
                    onTirar={!bloqueado && onTirarFoto ? () => onTirarFoto(f.caminho) : undefined}
                    rotulo={`Tirar da lâmina: ${tituloDaFoto.toLowerCase()}`}
                    marca={recortada ? <Scissors className="h-2.5 w-2.5" /> : null}
                    xadrez={recortada}
                  >
                    <ImagemDaMesa caminho={f.caminho} alt={tituloDaFoto} className="h-full w-full" />
                  </Removivel>
                );
              })}
            </div>
            {separador}
            {/* Referência: o ícone abre a ferramenta Referências (cliente, banco, Pinterest). */}
            <div className="flex min-w-0 items-center" aria-label="Referência da lâmina" data-grupo="referencia">
              {botaoIcone(onAbrirReferencias, <Bookmark className="h-4 w-4" />, "Referência desta lâmina: 1 ou 2 (cliente, banco, Pinterest)", "referencias")}
              {base.referencias.map((id) => (
                <MiniDaReferencia key={id} id={id} onTirar={!bloqueado && base.daLamina && onTirarReferencia ? () => onTirarReferencia(id) : undefined} />
              ))}
              {base.referencias.length > 0 && !base.daLamina && <span className="mr-1 text-[11px] text-muted-foreground">(do conjunto)</span>}
            </div>
            {/* Link colado ou arquivo, na mesma linha (o campo e o botão Arquivo lado a lado). */}
            {referenciaNaHora && (
              <div className="mr-2 min-w-[200px] max-w-[300px] flex-1 [&>[data-referencia-na-hora]]:mt-0" data-grupo="link">
                {referenciaNaHora}
              </div>
            )}
            {separador}
            {/* Marca: a logo do kit que o gerador desenha junto. */}
            <div className="flex min-w-0 items-center" aria-label="Logo da lâmina" data-grupo="logo" title="Logo do kit que o gerador desenha junto com a arte">
              <span className="mr-1.5 text-[11.5px] text-muted-foreground">Logo</span>
              {logo ? logo : <span className="text-[11.5px] text-muted-foreground" title="A logo vai na capa e no fechamento">nesta não</span>}
            </div>
            <div className="ml-auto flex shrink-0 items-center pl-1">
              <AjudaRecolhida rotulo="Como esta lâmina vai ser gerada" titulo="Como vai ser gerada" lado="bottom">
                {DESCRICAO_DO_MODO[base.modo]}
              </AjudaRecolhida>
              <button type="button" onClick={abrirMenu} aria-haspopup="menu" aria-expanded={!!menu} aria-label="Mais opções de fotos e referências" className="ml-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        {total ? <SeloDaSerie card={card} total={total} refsDoConjunto={refsDoConjunto} /> : null}
      </div>
      {!recolhido && fidelidade && base.modo === "replicar_referencia" && (
        <div className="mt-1 flex min-w-0 flex-wrap items-center" data-faixa="fidelidade">
          <span className="mb-1 mr-1.5 mt-1 text-[11.5px] text-muted-foreground" title="Quanto a lâmina segue a referência: da cópia mais fiel à mais livre">
            Fidelidade
          </span>
          <div className="min-w-0 flex-1">{fidelidade}</div>
        </div>
      )}
      {/* Os avisos da geração ficam à vista mesmo com a base recolhida. */}
      {temAvisos && (
        <div className="mt-1 space-y-1">
          {continuoSemModelo && (
            <p className="flex items-start text-[11.5px] leading-snug text-warning" data-aviso="continuo-sem-modelo">
              <TriangleAlert className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0" /> {AVISO_CONTINUO_SEM_MODELO}
            </p>
          )}
          {continuo && base.temFoto && (
            <p className="flex items-start text-[11.5px] leading-snug text-muted-foreground" data-aviso="foto-no-continuo">
              <TriangleAlert className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0" /> {AVISO_FOTO_NO_CONTINUO}
            </p>
          )}
          {(foraDoFundo || foraDaEmenda) && (
            <div className="flex min-w-0 flex-wrap items-center" data-aviso="fora-do-fundo">
              <p className="mr-2 flex min-w-0 flex-1 items-start text-[11.5px] leading-snug text-warning">
                <TriangleAlert className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0" /> {foraDoFundo ? AVISO_FORA_DO_FUNDO : AVISO_FORA_DA_EMENDA}
              </p>
              {acaoDoFundo}
            </div>
          )}
          {base.fotoRecomposta && (
            <p className="flex items-start text-[11.5px] leading-snug text-warning">
              <TriangleAlert className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0" /> {AVISO_FOTO_RECOMPOSTA}
            </p>
          )}
          {versaoRecompos(versao) && !base.fotoRecomposta && (
            <p className="flex items-start text-[11.5px] leading-snug text-warning">
              <TriangleAlert className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0" /> Esta versão recompôs a foto pela referência; confira o rosto.
            </p>
          )}
        </div>
      )}
      {/* O aviso do rosto fica à vista mesmo com o painel recolhido. */}
      {avisoDoRosto}
      {menu && (
        <MenuDeContexto
          x={menu.x}
          y={menu.y}
          aoFechar={() => setMenu(null)}
          itens={[
            { rotulo: "Escolher a foto (acervo, Mesa Foto, enviar)", acao: onAbrirFotos },
            { rotulo: "Escolher referência (cliente, banco, Pinterest)", acao: onAbrirReferencias },
          ]}
        />
      )}
    </div>
  );
}
