import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Camera, Film, ImagePlus } from "lucide-react";
import { ImagemDaMesa, useUrlDaMesa } from "./MesaContexto";
import ImagemComZoom from "./ImagemComZoom";

const AcoesContexto = createContext<HTMLDivElement | null>(null);
/** O mesmo botão de gerar aparece na barra da bancada; fora dela mantém sua posição. */
export function AcoesDaBancada({ children }: { children: ReactNode }) {
  const destino = useContext(AcoesContexto);
  return destino ? createPortal(children, destino) : children;
}

/** Mesma disposição da prancheta de artes, com ferramentas próprias de cada mídia. */
export default function BancadaDaPauta({ tipo, titulo, acoes, prancheta, previa, ferramentas }: {
  tipo: "fotos" | "video"; titulo: string; acoes?: ReactNode; prancheta: ReactNode; previa: ReactNode; ferramentas: ReactNode;
}) {
  const Icone = tipo === "fotos" ? Camera : Film;
  const [destino, setDestino] = useState<HTMLDivElement | null>(null);
  return <AcoesContexto.Provider value={destino}><section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card" data-bancada-da-pauta={tipo}>
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-primary px-4 py-3">
      <Icone className="h-4 w-4 shrink-0 text-primary" /><p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{titulo}</p>
      <span className="rounded-full bg-primary/10 px-2 py-1 text-[12px] font-medium text-primary">{tipo === "fotos" ? "Fotos e carrossel" : "Vídeo rápido"}</span>{acoes}<div ref={setDestino} className="flex min-w-0 flex-wrap items-center" />
    </header>
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[144px_minmax(0,1fr)_minmax(320px,380px)] lg:overflow-hidden" style={{ minHeight: 480 }}>
      <aside aria-label="Prancheta" className="min-h-0 min-w-0 border-b p-3 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <p className="mb-3 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Prancheta</p>{prancheta}
      </aside>
      <main aria-label="Prévia do conteúdo" className="flex min-h-0 min-w-0 flex-col overflow-hidden p-4">{previa}</main>
      <aside aria-label={tipo === "fotos" ? "Ferramentas de fotos" : "Ferramentas de vídeo"} className="min-h-0 min-w-0 border-t p-4 lg:overflow-y-auto lg:border-l lg:border-t-0">{ferramentas}</aside>
    </div>
  </section></AcoesContexto.Provider>;
}

export interface FotoDaPrancheta { id: string; nome: string; caminho: string; bucket?: string }

export function PreviaDaPauta({ caminho, bucket = "mesa", nome, video = false }: { caminho: string; bucket?: string; nome: string; video?: boolean }) {
  const { data: url, isError } = useUrlDaMesa(caminho, bucket);
  const area = useRef<HTMLDivElement>(null);
  const [medidas, setMedidas] = useState({ largura: 320, altura: 400 });
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const medir = () => setMedidas({ largura: Math.max(120, el.clientWidth - 8), altura: Math.max(200, el.clientHeight - 48) });
    medir();
    const observer = new ResizeObserver(medir); observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <div ref={area} className="flex min-h-[360px] min-w-0 flex-1 items-center justify-center" data-previa-da-pauta="">
    {isError ? <p role="alert">Não foi possível abrir este arquivo.</p> : !url ? <p role="status">Carregando prévia…</p> : video ?
      <video key={url} src={url} controls playsInline preload="metadata" aria-label={nome} className="max-h-full max-w-full rounded-lg" /> :
      <ImagemComZoom src={url} alt={nome} {...medidas} onProporcao={() => undefined} />}
  </div>;
}

export function BancadaDeFotos({ titulo, fotos, children, onEscolher, onMover, onRemover, onEditar }: {
  titulo: string; fotos: FotoDaPrancheta[]; children: ReactNode; onEscolher?: () => void;
  onMover?: (indice: number, direcao: number) => void; onRemover?: (id: string) => void; onEditar?: (id: string) => void;
}) {
  const [ativa, setAtiva] = useState<string | null>(null);
  const foto = fotos.find((f) => f.id === ativa) || fotos[0];
  return <BancadaDaPauta tipo="fotos" titulo={titulo}
    acoes={onEscolher && <button type="button" onClick={onEscolher} className="rounded-md bg-primary px-3 py-2 text-[12px] text-primary-foreground">Escolher fotos</button>}
    prancheta={<><ol className="flex gap-3 overflow-x-auto lg:flex-col lg:overflow-visible">{fotos.map((f, i) => <li key={f.id} className="w-28 shrink-0">
      <button type="button" aria-pressed={foto?.id === f.id} aria-label={`Ver foto ${i + 1}: ${f.nome}`} onClick={() => setAtiva(f.id)} className={`block w-full overflow-hidden rounded-lg border-2 ${foto?.id === f.id ? 'border-primary' : 'border-transparent'}`}>
        <ImagemDaMesa caminho={f.caminho} bucket={f.bucket || "mesa"} alt={f.nome} className="aspect-[4/5] w-full object-cover" />
      </button><p className="my-1 truncate text-[12px]">{i + 1} · {i === 0 ? "Capa" : f.nome}</p>
      {onMover && <div className="flex items-center justify-between text-[12px]"><button type="button" disabled={!i} aria-label={`Mover foto ${i + 1} para antes`} onClick={() => onMover(i, -1)}>←</button><button type="button" aria-label={`Remover foto ${i + 1}`} onClick={() => onRemover?.(f.id)}>Remover</button><button type="button" disabled={i === fotos.length - 1} aria-label={`Mover foto ${i + 1} para depois`} onClick={() => onMover(i, 1)}>→</button></div>}
    </li>)}</ol>{onEscolher && <button type="button" onClick={onEscolher} className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed px-2 py-5 text-[12px]"><ImagePlus className="h-4 w-4" />Adicionar</button>}</>}
    previa={<><div className="flex items-center justify-between text-[13px]"><strong>{foto ? `Foto ${fotos.indexOf(foto) + 1} de ${fotos.length}` : "Foto da pauta"}</strong>{foto && onEditar && <button type="button" onClick={() => onEditar(foto.id)} className="text-primary">Melhorar esta foto</button>}</div>{foto ? <PreviaDaPauta key={foto.id} {...foto} /> : <div className="flex min-h-[400px] flex-1 flex-col items-center justify-center rounded-lg border border-dashed text-center"><Camera className="mb-3 h-8 w-8 text-muted-foreground" /><p className="text-[13px]">Escolha as fotos para montar esta pauta.</p>{onEscolher && <button type="button" onClick={onEscolher} className="mt-4 rounded-md bg-primary px-4 py-2 text-[13px] text-primary-foreground">Escolher fotos do cliente</button>}</div>}</>}
    ferramentas={children} />;
}
