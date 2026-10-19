import { useMemo, useState } from "react";
import {
  Building,
  Clapperboard,
  Copy,
  Filter,
  Gem,
  Image,
  Layers,
  Layout,
  LayoutGrid,
  LayoutTemplate,
  ListChecks,
  Loader2,
  Megaphone,
  MessageSquare,
  PenTool,
  Presentation,
  Rocket,
  Shapes,
  ShoppingBag,
  TrendingUp,
  User,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { CampoDeBusca, Carregando, botao, juntar, superficie, texto, toqueCompacto } from "@/components/sistema";
import { CATEGORIA_SEM_NOME, type FluxoDaGaleria } from "@/lib/laboratorio/api";
import { TIPOS_DE_NO, type CanvasDoLab } from "@/lib/laboratorio/nos";

/**
 * Galeria de fluxos da Início (20/10/2026, pedido do dono: "fluxos mais
 * organizados, alinhados e bonitos", como a galeria de templates do Gravyx).
 *
 * - Abas de chip: Todos, uma por categoria (o campo `categoria` do template;
 *   sem ele, "Outros") e "Seus fluxos" (os pessoais).
 * - Busca por nome e descrição (sem acento, sem caixa).
 * - Grade de cartões da mesma altura: miniatura do fluxo (os nós em cores e as
 *   ligações, a partir do canvas), nome, descrição curta, número de nós e
 *   "Usar fluxo".
 */

type Icone = LucideIcon;

/** Ícone do template (campo `icone` da semente). */
const ICONES_DO_TEMPLATE: Record<string, Icone> = {
  layers: Layers,
  megaphone: Megaphone,
  "pen-tool": PenTool,
  layout: Layout,
  image: Image,
  copy: Copy,
  "shopping-bag": ShoppingBag,
  filter: Filter,
  building: Building,
  clapperboard: Clapperboard,
  gem: Gem,
  rocket: Rocket,
  presentation: Presentation,
  workflow: Workflow,
};

/** Sem acento e sem caixa (busca e ícone da categoria). */
export function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Ícone da categoria pelo nome (as categorias vêm do banco; nome desconhecido cai no ícone de fluxo). */
export function iconeDaCategoria(nome: string): Icone {
  const n = semAcento(nome);
  if (nome === CATEGORIA_SEM_NOME) return Shapes;
  // As categorias da v4 (migration 20261020060000): Funis, Lançamento, Criativos, UGC e influência, Marca,
  // Sites, Mensagens, Webinar e Quiz; outras caem pelo assunto do nome.
  if (/ugc|influencia/.test(n)) return Users;
  if (/video|filme|motion/.test(n)) return Clapperboard;
  if (/lancamento/.test(n)) return Rocket;
  if (/webinar/.test(n)) return Presentation;
  if (/quiz/.test(n)) return ListChecks;
  if (/mensage|whatsapp|e-?mail/.test(n)) return MessageSquare;
  if (/anuncio|trafego|ads|criativo|campanha/.test(n)) return Megaphone;
  if (/marca|identidade|logo|empresa/.test(n)) return PenTool;
  if (/funil|funis/.test(n)) return Filter;
  if (/venda|ticket|oferta|negocio/.test(n)) return TrendingUp;
  if (/pagina|site|landing/.test(n)) return Layout;
  if (/conteudo|post|carrossel|social|instagram|arte/.test(n)) return Image;
  return LayoutTemplate;
}

/** Categorias na ordem da galeria: a ordem em que aparecem, "Outros" por último. */
export function categoriasDos(fluxos: FluxoDaGaleria[]): string[] {
  const vistas: string[] = [];
  fluxos.forEach((f) => {
    if (vistas.indexOf(f.categoria) < 0) vistas.push(f.categoria);
  });
  return vistas.filter((c) => c !== CATEGORIA_SEM_NOME).concat(vistas.indexOf(CATEGORIA_SEM_NOME) >= 0 ? [CATEGORIA_SEM_NOME] : []);
}

export type AbaDaGaleria = "todos" | "pessoais" | { categoria: string };

/** O que a aba e a busca mostram. Com busca, "Todos" procura também nos pessoais. */
export function filtrarFluxos(fluxos: FluxoDaGaleria[], aba: AbaDaGaleria, busca: string): FluxoDaGaleria[] {
  const termo = semAcento(busca.trim());
  return fluxos.filter((f) => {
    if (aba === "pessoais") {
      if (f.oficial) return false;
    } else if (aba === "todos") {
      if (!f.oficial && !termo) return false;
    } else if (!f.oficial || f.categoria !== aba.categoria) return false;
    return !termo || semAcento(`${f.nome} ${f.descricao}`).indexOf(termo) >= 0;
  });
}

/** Miniatura do fluxo: cada nó um bloco na cor do tipo, ligações em curva. */
export function MiniaturaDoFluxo({ canvas }: { canvas: CanvasDoLab }) {
  if (!canvas.nos.length) return <div className={juntar(superficie.poco, "h-24")} aria-hidden="true" />;
  const L = 200;
  const A = 64;
  const xs = canvas.nos.map((n) => n.x);
  const ys = canvas.nos.map((n) => n.y);
  const minX = Math.min.apply(null, xs);
  const minY = Math.min.apply(null, ys);
  const margem = 48;
  const larg = Math.max.apply(null, xs) - minX + L + margem * 2;
  const alt = Math.max(Math.max.apply(null, ys) - minY + A + margem * 2, larg / 3.2);
  const pos = (id: string) => {
    const n = canvas.nos.find((x) => x.id === id);
    return n ? { x: n.x - minX + margem, y: n.y - minY + margem } : null;
  };
  const traco = Math.max(5, larg / 150);
  return (
    <svg viewBox={`0 0 ${larg} ${alt}`} className={juntar(superficie.poco, "block h-24 w-full")} preserveAspectRatio="xMidYMid meet" aria-hidden="true" data-miniatura-do-fluxo="">
      {canvas.ligacoes.map((l) => {
        const a = pos(l.de);
        const b = pos(l.para);
        if (!a || !b) return null;
        const x1 = a.x + L;
        const y1 = a.y + A / 2;
        const x2 = b.x;
        const y2 = b.y + A / 2;
        const meio = Math.max(40, Math.abs(x2 - x1) / 2);
        return <path key={l.id} d={`M${x1},${y1} C${x1 + meio},${y1} ${x2 - meio},${y2} ${x2},${y2}`} fill="none" stroke="currentColor" className="text-muted-foreground/50" strokeWidth={traco} />;
      })}
      {canvas.nos.map((n) => {
        const p = pos(n.id)!;
        const def = TIPOS_DE_NO[n.tipo];
        return <rect key={n.id} x={p.x} y={p.y} width={L} height={A} rx={16} fill={def ? def.cor : "#a1a1aa"} opacity={0.9} />;
      })}
    </svg>
  );
}

function CartaoDoFluxo({ f, usando, onUsar }: { f: FluxoDaGaleria; usando: string | null; onUsar: (id: string) => void }) {
  const Icone = ICONES_DO_TEMPLATE[f.icone] || Workflow;
  const nos = f.canvas.nos.length;
  return (
    <article className={juntar(superficie.painel, "flex min-w-0 flex-col p-3")} data-template={f.id} data-categoria={f.categoria}>
      <MiniaturaDoFluxo canvas={f.canvas} />
      <div className="mt-3 flex min-w-0 items-center">
        <Icone className="mr-1.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h3 className={juntar(texto.corpo, "min-w-0 truncate font-medium")} title={f.nome}>{f.nome}</h3>
      </div>
      <p className={juntar(texto.auxiliar, "mt-1 line-clamp-2 min-h-[32px]")} title={f.descricao || undefined}>{f.descricao}</p>
      <div className="mt-auto flex min-w-0 items-center justify-between pt-3">
        <span className={juntar(texto.auxiliar, "min-w-0 truncate")}>{nos} {nos === 1 ? "nó" : "nós"}</span>
        <button type="button" className={juntar(botao.secundario, "ml-2 h-8 px-2.5")} onClick={() => onUsar(f.id)} disabled={!!usando} data-usar-fluxo={f.id}>
          {usando === f.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
          Usar fluxo
        </button>
      </div>
    </article>
  );
}

function Chip({ ativo, icone: Icone, rotulo, total, onClick, dados }: { ativo: boolean; icone: Icone; rotulo: string; total: number; onClick: () => void; dados: Record<string, string> }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={juntar(
        toqueCompacto,
        "mb-2 mr-2 inline-flex h-8 shrink-0 items-center rounded-full px-3 text-[12px] font-medium transition-colors",
        ativo ? "bg-primary/10 text-primary" : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      {...dados}
    >
      <Icone className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
      {rotulo}
      <span className={juntar(texto.etiqueta, "ml-1.5 tabular-nums opacity-70")}>{total}</span>
    </button>
  );
}

export default function GaleriaDeFluxos({
  fluxos,
  carregando,
  erro,
  usando,
  onUsar,
}: {
  fluxos: FluxoDaGaleria[];
  carregando: boolean;
  erro: string | null;
  usando: string | null;
  onUsar: (id: string) => void;
}) {
  const [aba, setAba] = useState<AbaDaGaleria>("todos");
  const [busca, setBusca] = useState("");
  const oficiais = useMemo(() => fluxos.filter((f) => f.oficial), [fluxos]);
  const pessoais = fluxos.length - oficiais.length;
  const categorias = useMemo(() => categoriasDos(oficiais), [oficiais]);
  // Só "Outros" (nenhum template com categoria ainda): o chip repetiria o "Todos".
  const mostrarCategorias = categorias.length > 1 || (categorias.length === 1 && categorias[0] !== CATEGORIA_SEM_NOME);
  const abaValida: AbaDaGaleria = typeof aba === "object" && categorias.indexOf(aba.categoria) < 0 ? "todos" : aba;
  const visiveis = filtrarFluxos(fluxos, abaValida, busca);
  const ehCategoria = (c: string) => typeof abaValida === "object" && abaValida.categoria === c;

  return (
    <section className="min-w-0" aria-label="Fluxos" data-galeria-de-fluxos="">
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between">
        <h2 className={juntar(texto.tituloSecao, "mb-2 mr-3 flex items-center")}>
          <LayoutTemplate className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Fluxos
        </h2>
        <CampoDeBusca valor={busca} onMudar={setBusca} placeholder="Buscar fluxo" rotulo="Buscar fluxo" className="mb-2 w-full sm:w-56" />
      </div>
      <div className="flex min-w-0 flex-wrap items-center" role="group" aria-label="Categorias de fluxo">
        <Chip ativo={abaValida === "todos"} icone={LayoutGrid} rotulo="Todos" total={oficiais.length} onClick={() => setAba("todos")} dados={{ "data-chip-categoria": "todos" }} />
        {mostrarCategorias
          ? categorias.map((c) => (
              <Chip key={c} ativo={ehCategoria(c)} icone={iconeDaCategoria(c)} rotulo={c} total={oficiais.filter((f) => f.categoria === c).length} onClick={() => setAba({ categoria: c })} dados={{ "data-chip-categoria": c }} />
            ))
          : null}
        <Chip ativo={abaValida === "pessoais"} icone={User} rotulo="Seus fluxos" total={pessoais} onClick={() => setAba("pessoais")} dados={{ "data-chip-categoria": "pessoais" }} />
      </div>
      <div className="mt-2 min-w-0">
        {carregando ? (
          <Carregando forma="grade" rotulo="Lendo os fluxos" />
        ) : erro ? (
          <p className={texto.auxiliar}>{erro}</p>
        ) : visiveis.length ? (
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" data-grade-de-fluxos="">
            {visiveis.map((f) => (
              <CartaoDoFluxo key={f.id} f={f} usando={usando} onUsar={onUsar} />
            ))}
          </div>
        ) : (
          <p className={texto.auxiliar} data-galeria-vazia="">
            {busca.trim() ? `Nenhum fluxo com "${busca.trim()}".` : abaValida === "pessoais" ? "Você ainda não salvou fluxo. No editor, use Mais ações › Salvar como fluxo pessoal." : "Nenhum fluxo oficial ainda."}
          </p>
        )}
      </div>
    </section>
  );
}
