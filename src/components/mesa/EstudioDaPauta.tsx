import { ControlesDaPauta } from "./ControlesDaPauta";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { Camera, Film, Layers, Maximize2, Minimize2 } from "lucide-react";
import { modoDaPauta, type ModoDaPauta } from "./modoDaPauta";
import PautaPlanejada from "./PautaPlanejada";
import type { ItemDoMes, Trabalho, InfoDoRoteiro, ArteNaAgenda } from "./useItensDoMes";

const Fotos = lazy(() => import("./EstudioDeFotosDaPauta"));
const Video = lazy(() => import("./EstudioDeVideoDaPauta"));
const MODOS = [{ id: "arte", nome: "Arte e carrossel", Icone: Layers }, { id: "fotos", nome: "Fotos", Icone: Camera }, { id: "video", nome: "Vídeo rápido", Icone: Film }] as const;

export default function EstudioDaPauta({ item, trabalho, roteiro, arte, foco, onFoco, children, onPautaPronta }: { item: ItemDoMes; trabalho: Trabalho | null; roteiro?: InfoDoRoteiro | null; arte?: ArteNaAgenda | null; foco: boolean; onFoco: (v: boolean) => void; children: ReactNode; onPautaPronta?: (id: string) => void }) {
  const automatico = modoDaPauta(item, trabalho);
  const [escolha, setEscolha] = useEstadoDaTela<ModoDaPauta | null>(`mesa:estudio:modo:${item.project_id}:${item.id}`, null, { validar: (v) => v === null || v === "arte" || v === "fotos" || v === "video" });
  const [ajuste, setAjuste] = useState<ModoDaPauta | null>(null);
  const modo = trabalho ? automatico : ajuste || (item.modo_estudio || automatico !== "arte" ? automatico : escolha || automatico);
  // Uma peça persistida não é convertida por um clique no seletor.
  const protegido = !!trabalho || !!item.planejamento;
  const controles = <div className="flex shrink-0 items-center gap-1" data-controles-da-pauta="">
      <div role="group" aria-label="Formato do estúdio" className="flex rounded-lg bg-muted p-1">
        {MODOS.map(({ id, nome, Icone }) => <button key={id} type="button" aria-label={nome} aria-pressed={modo === id} disabled={protegido && id !== automatico} title={protegido && id !== automatico ? 'Esta pauta já tem um trabalho. Crie outra pauta para mudar o tipo sem substituir o conteúdo.' : nome} onClick={() => { setAjuste(id); setEscolha(id); }} className={`flex h-8 w-8 items-center justify-center rounded-md text-[12px] disabled:opacity-40 ${modo === id ? 'bg-card shadow-sm' : ''}`}><Icone className="h-3.5 w-3.5" /></button>)}
      </div>
      {modo !== "arte" && <button type="button" className="rounded-md border p-2" aria-label={foco ? 'Sair da tela cheia' : 'Tela cheia'} onClick={() => onFoco(!foco)}>{foco ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>}
    </div>;
  return <ControlesDaPauta.Provider value={controles}><section className="flex min-h-0 min-w-0 flex-1 flex-col" data-modo-da-pauta={modo}>
    <Suspense fallback={<p role="status">Abrindo ferramentas…</p>}>
      {item.planejamento ? <PautaPlanejada key={item.id} item={item} onPronta={onPautaPronta}>{(pronta) => modo === "fotos" ? <Fotos key={pronta.id} item={pronta} roteiro={roteiro} arte={arte} /> : <Video key={pronta.id} item={pronta} arte={arte} />}</PautaPlanejada> : modo === "arte" ? children : modo === "fotos" ? <Fotos key={item.id} item={item} roteiro={roteiro} arte={arte} /> : <Video key={item.id} item={item} arte={arte} />}
    </Suspense>
  </section></ControlesDaPauta.Provider>;
}
