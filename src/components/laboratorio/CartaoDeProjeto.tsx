import { ArrowUpRight, CalendarDays } from "lucide-react";
import { MenuMais, juntar, superficie, texto, type ItemDoMenu } from "@/components/sistema";
import type { ProjetoDoLab } from "@/lib/laboratorio/api";
import { TIPOS_DE_NO, type CanvasDoLab } from "@/lib/laboratorio/nos";
import { nomeDoCliente, type ClienteDoLab } from "./Seletores";
import { pastelDe, tom } from "./visual";

/** Cor das miniaturas sem o canvas (a lista só traz a contagem de nós): a cor da marca. */
const COR_SEM_CANVAS = "hsl(var(--primary))";
/** Até quantos nós a miniatura por contagem desenha (o resto vira "+N"). */
const MAXIMO_NA_MINIATURA = 12;

/**
 * Miniatura só pela contagem (projetos_listar manda `nos`, sem o canvas): os
 * nós como retângulos em colunas de 3, ligados em sequência, na cor da marca.
 */
function MiniaturaPorContagem({ total }: { total: number }) {
  const n = Math.min(total, MAXIMO_NA_MINIATURA);
  const colunas = Math.ceil(n / 3);
  const pos = (i: number) => ({ x: 20 + Math.floor(i / 3) * 120, y: 16 + (i % 3) * 44 });
  const larg = Math.max(260, 20 + colunas * 120);
  return (
    <svg viewBox={`0 0 ${larg} 152`} className="block h-28 w-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true" data-miniatura="contagem">
      {Array.from({ length: Math.max(0, n - 1) }).map((_, i) => {
        const a = pos(i);
        const b = pos(i + 1);
        return <line key={`l${i}`} x1={a.x + 84} y1={a.y + 14} x2={b.x} y2={b.y + 14} stroke="currentColor" strokeOpacity={0.25} strokeWidth={2} />;
      })}
      {Array.from({ length: n }).map((_, i) => {
        const p = pos(i);
        return <rect key={i} x={p.x} y={p.y} width={84} height={28} rx={7} fill={COR_SEM_CANVAS} opacity={0.35 + (i % 3) * 0.2} />;
      })}
      {total > n ? (
        <text x={larg - 12} y={146} textAnchor="end" fontSize={14} fill="currentColor" opacity={0.6}>
          +{total - n}
        </text>
      ) : null}
    </svg>
  );
}

/** Prévia do grafo: os nós como retângulos na cor do tipo e as ligações como linhas. */
export function PreviaDoCanvas({ canvas, total }: { canvas: CanvasDoLab; total?: number }) {
  if (!canvas.nos.length) {
    return (
      <div className="flex h-28 items-center justify-center text-muted-foreground" data-previa-do-canvas="">
        {total ? <MiniaturaPorContagem total={total} /> : <span className="text-[12px]">Canvas vazio</span>}
      </div>
    );
  }
  const xs = canvas.nos.map((n) => n.x);
  const ys = canvas.nos.map((n) => n.y);
  const minX = Math.min.apply(null, xs);
  const minY = Math.min.apply(null, ys);
  const larg = Math.max(1, Math.max.apply(null, xs) - minX + 248);
  const alt = Math.max(1, Math.max.apply(null, ys) - minY + 120);
  const pos = (id: string) => {
    const n = canvas.nos.find((x) => x.id === id);
    return n ? { x: n.x - minX + 124, y: n.y - minY + 60 } : { x: 0, y: 0 };
  };
  return (
    <svg viewBox={`0 0 ${larg} ${alt}`} className="block h-28 w-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true" data-previa-do-canvas="" data-miniatura="canvas">
      {canvas.ligacoes.map((l) => {
        const a = pos(l.de);
        const b = pos(l.para);
        return <line key={l.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#a1a1aa" strokeWidth={Math.max(4, larg / 120)} />;
      })}
      {canvas.nos.map((n) => (
        <rect key={n.id} x={n.x - minX + 24} y={n.y - minY + 30} width={200} height={60} rx={14} fill={(TIPOS_DE_NO[n.tipo] || { cor: COR_SEM_CANVAS }).cor} opacity={0.85} />
      ))}
    </svg>
  );
}

/** "hoje", "ontem" ou o dia (dd/mm, com o ano quando não é este). */
export function dataCurta(iso: string, agora: Date = new Date()): string {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return "";
  const dia = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((dia(agora) - dia(d)) / 86400000);
  if (diff === 0) return "hoje";
  if (diff === 1) return "ontem";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return d.getFullYear() === agora.getFullYear() ? `${dd}/${mm}` : `${dd}/${mm}/${String(d.getFullYear()).slice(2)}`;
}

/**
 * Cartão de projeto (v4, 15/11/2026): capa pastel de altura fixa (a miniatura do canvas ou a prévia, nunca
 * muda de tamanho ao carregar) com o cliente numa etiqueta e a seta de abrir em círculo; embaixo, o nome,
 * a data numa pílula, a contagem de nós e as ações no "…".
 */
export function CartaoDeProjeto({ projeto, clientes, onAbrir, acoes }: { projeto: ProjetoDoLab; clientes: ClienteDoLab[]; onAbrir: () => void; acoes?: ItemDoMenu[] }) {
  const cliente = nomeDoCliente(clientes, projeto.client_id, projeto.cliente_nome || "Livre");
  const quando = dataCurta(projeto.updated_at);
  const cor = pastelDe(projeto.client_id || projeto.id);
  return (
    <div className={juntar(superficie.painel, "group min-w-0 p-2.5 transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transform-none")} data-cartao-de-projeto={projeto.id}>
      <button type="button" onClick={onAbrir} title={`Abrir ${projeto.nome} no canvas`} className="block w-full min-w-0 rounded-[18px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-abrir-projeto="">
        <span className="relative block h-36 min-w-0 overflow-hidden rounded-[18px]" style={{ backgroundColor: tom(cor, 0.14) }}>
          {projeto.previa_url ? (
            <img src={projeto.previa_url} alt="" className="block h-36 w-full object-cover" loading="lazy" />
          ) : (
            <span className="block px-3 pt-7">
              <PreviaDoCanvas canvas={projeto.canvas} total={projeto.total_nos} />
            </span>
          )}
          <span className="absolute left-2.5 top-2.5 inline-flex h-[22px] max-w-[65%] items-center rounded-full bg-card px-2 text-[11px] font-medium leading-none text-foreground">
            <span className="truncate">{cliente}</span>
          </span>
          <span className="absolute right-2.5 top-2.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-card text-foreground transition-colors group-hover:bg-foreground group-hover:text-background" aria-hidden="true">
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </span>
        <span className="mt-3 block truncate px-1.5 text-[15px] font-semibold leading-5 text-foreground">{projeto.nome}</span>
      </button>
      <div className="mt-1.5 flex min-w-0 items-center pb-1 pl-1.5">
        <span className="flex min-w-0 flex-1 items-center" title={`${cliente}${quando ? ` · ${quando}` : ""} · ${projeto.total_nos} nó(s)`}>
          {quando ? (
            <span className="mr-2 inline-flex h-6 shrink-0 items-center rounded-full border border-border px-2 text-[11px] font-medium tabular-nums text-muted-foreground">
              <CalendarDays className="mr-1 h-3 w-3" aria-hidden="true" />
              {quando}
            </span>
          ) : null}
          <span className={juntar(texto.auxiliar, "min-w-0 truncate tabular-nums")}>{projeto.total_nos} nó(s)</span>
        </span>
        {acoes && acoes.length ? <MenuMais rotulo={`Ações do projeto ${projeto.nome}`} itens={acoes} /> : null}
      </div>
    </div>
  );
}
