import { useState, type ReactNode } from "react";
import { Check, ChevronDown, FilePlus2, Loader2, Megaphone, SlidersHorizontal } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
import { usd, type ParteDaEstimativa } from "@/lib/mesa/api";
import { avisarCustoReal, useAvisarErro, useEstimativa } from "./Custo";
import { useMesa } from "./MesaContexto";
import { ROTULO_DO_SELO } from "./datasDoHype";

/**
 * Peças comuns do Hype e do Trending (21/10/2026, 3ª rodada: "mais intuitivo e organizado").
 *
 * Toda linha é a MESMA grade: [caixinha, só no modo juntar] | bloco à esquerda (data "25 OUT" ou ícone) |
 * título e uma linha curta | selo e nota | dois ícones diretos: Criar conteúdo (custo no title) e Criar
 * campanha. Clicar na linha abre os detalhes. Sem custo fixo em cada linha.
 */
export const GRADE_DA_LINHA = "grid min-w-0 grid-cols-[40px_minmax(0,1fr)_auto_auto] items-center gap-x-3";
export const GRADE_DA_LINHA_JUNTANDO = "grid min-w-0 grid-cols-[16px_40px_minmax(0,1fr)_auto_auto] items-center gap-x-3";

/** Bloco de calendário (dia grande, mês curto) ou um ícone, sempre do mesmo tamanho. */
export function BlocoDaLinha({ dia, mes, icone, destaque = false }: { dia?: string; mes?: string; icone?: ReactNode; destaque?: boolean }) {
  return (
    <span className={juntar("flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-md", destaque ? "bg-primary/10 text-primary" : "bg-muted text-foreground")} aria-hidden="true" data-bloco="">
      {icone ? <span className="text-muted-foreground">{icone}</span> : (
        <>
          <span className="text-[15px] font-semibold leading-4 tabular-nums">{dia}</span>
          <span className="text-[11px] leading-3 text-muted-foreground">{mes}</span>
        </>
      )}
    </span>
  );
}

/**
 * As ações de criar, direto na linha (21/10/2026, dono: "deixe o ícone ali e não pra selecionar"): dois ícones,
 * sempre na mesma posição à direita. "Criar conteúdo" (ou "Usar a pauta") faz na hora, com o custo no title
 * ("Criar conteúdo · ~US$ 0,14"); ação acima de US$ 1 pede o segundo clique. "Criar campanha" abre a campanha
 * nova com o item. Área de toque de 44 px no celular (toque-compacto do botão de ícone).
 */
export function AcoesDeCriar({ titulo, rotuloDoConteudo = "Criar conteúdo", partes, executar, onCampanha }: {
  titulo: string;
  rotuloDoConteudo?: string;
  partes: () => ParteDaEstimativa[];
  executar: () => Promise<unknown>;
  onCampanha: () => void;
}) {
  const mesa = useMesa();
  const avisarErro = useAvisarErro();
  const [rodando, setRodando] = useState(false);
  const [armado, setArmado] = useState(false);
  let partesAtuais: ParteDaEstimativa[] | null = null;
  try { partesAtuais = partes(); } catch { partesAtuais = null; }
  const estimativa = useEstimativa(partesAtuais, true);
  const valor = estimativa.data;
  const custo = valor !== undefined ? ` · ~${usd(valor)}` : "";
  const nome = `Conteúdo sobre "${titulo}"`;
  const criarConteudo = async () => {
    if (rodando) return;
    // Mesma regra do BotaoComCusto: caro (acima de US$ 1) ou sem estimativa pede o segundo clique.
    if ((valor === undefined || valor > 1) && !armado) {
      setArmado(true);
      window.setTimeout(() => setArmado(false), 6000);
      return;
    }
    setArmado(false);
    setRodando(true);
    try {
      const data = await executar();
      avisarCustoReal(nome, data, mesa.atualizarCusto);
    } catch (e) {
      mesa.atualizarCusto();
      avisarErro(e, nome);
    } finally {
      setRodando(false);
    }
  };
  const rotuloDoBotao = armado ? `${rotuloDoConteudo}: clique de novo para confirmar${custo}` : `${rotuloDoConteudo}${custo}`;
  return (
    <span className="inline-flex items-center" data-acoes-de-criar="">
      <button type="button" className={juntar(botao.icone, armado ? "bg-primary/10 text-primary" : "")} onClick={(e) => { e.stopPropagation(); void criarConteudo(); }} disabled={rodando} aria-label={rotuloDoConteudo} title={rotuloDoBotao} data-criar-conteudo="">
        {rodando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FilePlus2 className="h-4 w-4" aria-hidden="true" />}
      </button>
      <button type="button" className={botao.icone} onClick={(e) => { e.stopPropagation(); onCampanha(); }} aria-label="Criar campanha" title={`Criar campanha com "${titulo}"`} data-criar-campanha="">
        <Megaphone className="h-4 w-4" aria-hidden="true" />
      </button>
    </span>
  );
}

export interface OpcaoDoFiltro { valor: string; rotulo: string; apoio?: string }
export interface GrupoDoFiltro { rotulo: string; valor: string; opcoes: OpcaoDoFiltro[]; onEscolher: (v: string) => void; /** Valor padrão (sem destaque no ícone); sem ele, a 1ª opção. */ padrao?: string }

/** Filtrar e ordenar num lugar só: um ícone discreto que abre os grupos (Mostrar, Ordenar, Recência…). */
export function MenuDeFiltro({ grupos, rotulo = "Filtrar e ordenar" }: { grupos: GrupoDoFiltro[]; rotulo?: string }) {
  const mudou = grupos.some((g) => g.opcoes.length && g.valor !== (g.padrao !== undefined ? g.padrao : g.opcoes[0].valor));
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={juntar(botao.icone, mudou ? "text-primary" : "")} aria-label={rotulo} title={rotulo} data-menu-filtro="">
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-[220px] p-1">
        {grupos.map((g, i) => (
          <div key={g.rotulo} role="group" aria-label={g.rotulo}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium text-muted-foreground">{g.rotulo}</DropdownMenuLabel>
            {g.opcoes.map((o) => (
              <DropdownMenuItem key={o.valor} className="min-h-8 cursor-pointer rounded px-2 py-1.5 text-[13px]" onSelect={() => g.onEscolher(o.valor)} aria-checked={g.valor === o.valor} role="menuitemradio">
                <Check className={juntar("mr-2 h-3.5 w-3.5", g.valor === o.valor ? "text-primary" : "invisible")} aria-hidden="true" />
                <span className="mr-3 flex-1">{o.rotulo}</span>
                {o.apoio && <span className="text-[11px] tabular-nums text-muted-foreground">{o.apoio}</span>}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function LinhaDoHypeETrending({
  bloco,
  titulo,
  apoio,
  selo,
  nota,
  rotuloDaNota = "Quanto serve a este cliente, de 0 a 10 (Jev)",
  juntando,
  marcado,
  podeMarcar,
  onMarcar,
  detalhes,
  criar,
}: {
  bloco: ReactNode;
  titulo: string;
  apoio?: ReactNode;
  selo?: "agora" | "aqueca" | null;
  nota?: number | null;
  rotuloDaNota?: string;
  /** Modo juntar ligado: a caixinha aparece. */
  juntando: boolean;
  marcado: boolean;
  podeMarcar: boolean;
  onMarcar: () => void;
  detalhes?: ReactNode;
  criar: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const n = typeof nota === "number" && isFinite(nota) ? Math.round(nota * 10) / 10 : null;
  const alternar = () => { if (detalhes) setAberto((v) => !v); };
  return (
    <li
      className={juntar(lista.linha, juntando ? GRADE_DA_LINHA_JUNTANDO : GRADE_DA_LINHA, detalhes ? "cursor-pointer" : "", marcado ? lista.destaque : "")}
      onClick={alternar}
      data-juntado={marcado ? "" : undefined}
      data-linha-hype-trending=""
    >
      {juntando && (
        <span className="flex h-10 items-center" onClick={(e) => e.stopPropagation()}>
          <Checkbox className="toque-compacto rounded" checked={marcado} disabled={!podeMarcar && !marcado} onCheckedChange={onMarcar} aria-label={`Juntar ${titulo}`} title={podeMarcar || marcado ? "Juntar para criar uma campanha" : "Já tem 6 desta área na seleção"} />
        </span>
      )}
      {bloco}
      <div className="min-w-0">
        {detalhes ? (
          <button type="button" className="toque-compacto block w-full min-w-0 text-left" aria-expanded={aberto} onClick={(e) => { e.stopPropagation(); alternar(); }}>
            <span className={juntar(texto.corpo, "block truncate font-medium")} title={titulo}>{titulo}</span>
          </button>
        ) : (
          <p className={juntar(texto.corpo, "truncate font-medium")} title={titulo}>{titulo}</p>
        )}
        {apoio && <div className={juntar(texto.auxiliar, "mt-0.5 min-w-0 truncate")}>{apoio}</div>}
        {aberto && detalhes && <div className="mt-2 min-w-0 cursor-auto space-y-1.5 pb-1 text-[12px] leading-5 [overflow-wrap:anywhere]" onClick={(e) => e.stopPropagation()}>{detalhes}</div>}
      </div>
      <span className="flex items-center justify-end" data-meta="">
        {selo && <span className={juntar(texto.etiqueta, "whitespace-nowrap rounded px-1.5", selo === "agora" ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")} data-selo={selo}>{ROTULO_DO_SELO[selo]}</span>}
        {n !== null && <span className={juntar(texto.etiqueta, "ml-2 w-6 text-right tabular-nums text-muted-foreground")} title={rotuloDaNota} data-nota="">{n.toLocaleString("pt-BR")}</span>}
      </span>
      <span className="flex justify-end" onClick={(e) => e.stopPropagation()} data-acoes="">{criar}</span>
    </li>
  );
}

/** Um par rótulo/texto dentro dos detalhes. */
export function Detalhe({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground">{rotulo}</p>
      <div className="text-foreground">{children}</div>
    </div>
  );
}

/** Subtítulo de grupo dentro da lista (Agora, Novembro, Lidos na web…), alinhado ao texto das linhas. */
export function SubtituloDaLista({ children, apoio }: { children: ReactNode; apoio?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline pb-1 pt-4 first:pt-2">
      <h4 className={juntar(texto.rotulo, "shrink-0")}>{children}</h4>
      {apoio && <span className={juntar(texto.auxiliar, "ml-2 min-w-0 truncate")}>{apoio}</span>}
    </div>
  );
}

/**
 * Cabeçalho fixo de uma coluna (Hype ou Trending): mesma altura nas duas, título com o "?" e os
 * controles à direita. `abaixo` fica ainda no cabeçalho fixo (a busca do Trending).
 */
export function CabecalhoDaColuna({ icone, titulo, ajuda, controles, abaixo }: { icone: ReactNode; titulo: string; ajuda: ReactNode; controles?: ReactNode; abaixo?: ReactNode }) {
  return (
    <div className="shrink-0 border-b border-border pb-2" data-cabecalho-da-coluna="">
      <div className="flex min-h-9 min-w-0 items-center justify-between">
        <h3 className={juntar(texto.tituloSecao, "mr-2 flex min-w-0 items-center")}>
          <span className="mr-1.5 inline-flex shrink-0 text-primary" aria-hidden="true">{icone}</span>
          <span className="truncate">{titulo}</span>
          <AjudaRecolhida rotulo={`O que é ${titulo}?`}>{ajuda}</AjudaRecolhida>
        </h3>
        {controles && <div className="flex shrink-0 items-center">{controles}</div>}
      </div>
      {abaixo && <div className="mt-2 min-w-0">{abaixo}</div>}
    </div>
  );
}
