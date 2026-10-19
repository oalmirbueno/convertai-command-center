import { juntar, superficie, texto } from "@/components/sistema";
import type { ProjetoDoLab } from "@/lib/laboratorio/api";
import { TIPOS_DE_NO, type CanvasDoLab } from "@/lib/laboratorio/nos";
import { nomeDoCliente, type ClienteDoLab } from "./Seletores";

/** Prévia do grafo: os nós como pontos coloridos e as ligações como linhas. */
export function PreviaDoCanvas({ canvas, total }: { canvas: CanvasDoLab; total?: number }) {
  // A lista de projetos (projetos_listar) manda só a contagem de nós, sem o canvas.
  if (!canvas.nos.length) return <div className="flex h-20 items-center justify-center rounded bg-muted/50 text-[12px] text-muted-foreground">{total ? `${total} nó(s)` : "Vazio"}</div>;
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
    <svg viewBox={`0 0 ${larg} ${alt}`} className="block h-20 w-full rounded bg-muted/50" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {canvas.ligacoes.map((l) => {
        const a = pos(l.de);
        const b = pos(l.para);
        return <line key={l.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#a1a1aa" strokeWidth={Math.max(4, larg / 120)} />;
      })}
      {canvas.nos.map((n) => (
        <rect key={n.id} x={n.x - minX + 24} y={n.y - minY + 30} width={200} height={60} rx={14} fill={TIPOS_DE_NO[n.tipo].cor} opacity={0.85} />
      ))}
    </svg>
  );
}

export function CartaoDeProjeto({ projeto, clientes, onAbrir }: { projeto: ProjetoDoLab; clientes: ClienteDoLab[]; onAbrir: () => void }) {
  return (
    <button type="button" onClick={onAbrir} className={juntar(superficie.painel, "block min-w-0 p-3 text-left transition-colors hover:border-primary/50")} data-cartao-de-projeto={projeto.id}>
      {projeto.previa_url ? <img src={projeto.previa_url} alt="" className="block h-20 w-full rounded object-cover" loading="lazy" /> : <PreviaDoCanvas canvas={projeto.canvas} total={projeto.total_nos} />}
      <span className={juntar(texto.corpo, "mt-2 block truncate font-medium")}>{projeto.nome}</span>
      <span className={juntar(texto.auxiliar, "block truncate")}>
        {nomeDoCliente(clientes, projeto.client_id, projeto.cliente_nome || "Livre")} · {projeto.total_nos} nó(s)
      </span>
    </button>
  );
}
