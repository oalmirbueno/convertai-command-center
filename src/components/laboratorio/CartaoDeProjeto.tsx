import { MenuMais, juntar, superficie, texto, type ItemDoMenu } from "@/components/sistema";
import type { ProjetoDoLab } from "@/lib/laboratorio/api";
import { TIPOS_DE_NO, type CanvasDoLab } from "@/lib/laboratorio/nos";
import { nomeDoCliente, type ClienteDoLab } from "./Seletores";

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
      <div className="flex h-28 items-center justify-center rounded-md bg-muted/50 text-muted-foreground" data-previa-do-canvas="">
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
    <svg viewBox={`0 0 ${larg} ${alt}`} className="block h-28 w-full rounded-md bg-muted/50" preserveAspectRatio="xMidYMid meet" aria-hidden="true" data-previa-do-canvas="" data-miniatura="canvas">
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

export function CartaoDeProjeto({ projeto, clientes, onAbrir, acoes }: { projeto: ProjetoDoLab; clientes: ClienteDoLab[]; onAbrir: () => void; acoes?: ItemDoMenu[] }) {
  const cliente = nomeDoCliente(clientes, projeto.client_id, projeto.cliente_nome || "Livre");
  const quando = dataCurta(projeto.updated_at);
  return (
    <div className={juntar(superficie.painel, "min-w-0 transition-colors hover:border-primary/50")} data-cartao-de-projeto={projeto.id}>
      <button type="button" onClick={onAbrir} title={`Abrir ${projeto.nome} no canvas`} className="block w-full min-w-0 rounded-t-lg p-3 pb-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-abrir-projeto="">
        {projeto.previa_url ? <img src={projeto.previa_url} alt="" className="block h-28 w-full rounded-md object-cover" loading="lazy" /> : <PreviaDoCanvas canvas={projeto.canvas} total={projeto.total_nos} />}
        <span className={juntar(texto.corpo, "mt-2 block truncate font-medium")}>{projeto.nome}</span>
      </button>
      <div className="flex min-w-0 items-center pb-2 pl-3 pr-1.5">
        <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")} title={`${cliente}${quando ? ` · ${quando}` : ""} · ${projeto.total_nos} nó(s)`}>
          {cliente}
          {quando ? ` · ${quando}` : ""} · {projeto.total_nos} nó(s)
        </span>
        {acoes && acoes.length ? <MenuMais rotulo={`Ações do projeto ${projeto.nome}`} itens={acoes} /> : null}
      </div>
    </div>
  );
}
