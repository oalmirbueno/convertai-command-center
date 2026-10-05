import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { lazy, Suspense, type ReactNode } from "react";
import { Camera, Film, Layers, Maximize2, Minimize2 } from "lucide-react";
import { modoDaPauta, type ModoDaPauta } from "./modoDaPauta";
import type { ItemDoMes, Trabalho } from "./useItensDoMes";

const Fotos = lazy(() => import("./EstudioDeFotosDaPauta"));
const Video = lazy(() => import("./EstudioDeVideoDaPauta"));
const MODOS = [{ id: "arte", nome: "Arte e carrossel", Icone: Layers }, { id: "fotos", nome: "Fotos", Icone: Camera }, { id: "video", nome: "Vídeo rápido", Icone: Film }] as const;

export default function EstudioDaPauta({ item, trabalho, foco, onFoco, children }: { item: ItemDoMes; trabalho: Trabalho | null; foco: boolean; onFoco: (v: boolean) => void; children: ReactNode }) {
  const automatico = modoDaPauta(item, trabalho);
  const [escolha, setEscolha] = useEstadoDaTela<ModoDaPauta | null>(`mesa:estudio:modo:${item.project_id}:${item.id}`, null, { validar: (v) => v === null || v === "arte" || v === "fotos" || v === "video" });
  const modo = trabalho ? automatico : escolha || automatico;
  // Uma peça persistida não é convertida por um clique no seletor.
  const protegido = !!trabalho;
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-modo-da-pauta={modo}>
    <header className="mb-2 flex flex-wrap items-center gap-2 border-b pb-2">
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.title}</p><p className="text-xs text-muted-foreground">Ferramentas desta pauta · {item.due_date?.slice(0, 10) || 'sem data'}</p></div>
      <div role="group" aria-label="Formato do estúdio" className="flex rounded-lg bg-muted p-1">
        {MODOS.map(({ id, nome, Icone }) => <button key={id} type="button" aria-pressed={modo === id} disabled={protegido && id !== automatico} title={protegido && id !== automatico ? 'Esta pauta já tem um trabalho. Crie outra pauta para mudar o tipo sem substituir o conteúdo.' : nome} onClick={() => setEscolha(id)} className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-xs disabled:opacity-40 ${modo === id ? 'bg-card shadow-sm' : ''}`}><Icone className="h-3.5 w-3.5" />{nome}</button>)}
      </div>
      {modo !== "arte" && <button type="button" className="rounded-md border p-2" aria-label={foco ? 'Sair da tela cheia' : 'Tela cheia'} onClick={() => onFoco(!foco)}>{foco ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>}
    </header>
    <Suspense fallback={<p role="status">Abrindo ferramentas…</p>}>
      {modo === "arte" ? children : modo === "fotos" ? <Fotos key={item.id} item={item} /> : <Video key={item.id} item={item} />}
    </Suspense>
  </section>;
}
