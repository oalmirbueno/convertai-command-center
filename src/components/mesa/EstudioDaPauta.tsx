import { ControlesDaPauta } from "./ControlesDaPauta";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { Camera, Film, Layers, Maximize2, Minimize2, Smartphone } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { useMesa } from "./MesaContexto";
import { hojeIso } from "./mesaV4Api";
import { prepararStoriesDaPeca } from "./storiesDaPeca";
import { modoDaPauta, type ModoDaPauta } from "./modoDaPauta";
import PautaPlanejada from "./PautaPlanejada";
import type { ItemDoMes, Trabalho, InfoDoRoteiro, ArteNaAgenda } from "./useItensDoMes";

const Fotos = lazy(() => import("./EstudioDeFotosDaPauta"));
const Video = lazy(() => import("./EstudioDeVideoDaPauta"));
const MODOS = [{ id: "arte", nome: "Arte e carrossel", Icone: Layers }, { id: "fotos", nome: "Fotos", Icone: Camera }, { id: "video", nome: "Vídeo rápido", Icone: Film }] as const;

/** 24/10: a peça de Stories do Mês não é feita no Estúdio: abre na aba Stories já com o tema e o dia. */
function StoriesDaPauta({ item }: { item: ItemDoMes }) {
  const { clientId } = useMesa();
  const [params, setParams] = useSearchParams();
  const abrir = () => {
    prepararStoriesDaPeca(clientId, item, hojeIso());
    const next = new URLSearchParams(params);
    next.set("aba", "stories");
    next.delete("task");
    setParams(next, { replace: false });
  };
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center p-6 text-center" data-stories-da-pauta={item.id}>
      <Smartphone className="mb-2 h-6 w-6 text-primary" aria-hidden="true" />
      <p className={juntar(texto.corpo, "max-w-md font-medium")}>{item.title}</p>
      <button type="button" className={juntar(botao.primario, "mt-3")} onClick={abrir}>Abrir nos Stories</button>
    </section>
  );
}

export default function EstudioDaPauta({ item, trabalho, roteiro, arte, foco, onFoco, children, onPautaPronta }: { item: ItemDoMes; trabalho: Trabalho | null; roteiro?: InfoDoRoteiro | null; arte?: ArteNaAgenda | null; foco: boolean; onFoco: (v: boolean) => void; children: ReactNode; onPautaPronta?: (id: string) => void }) {
  const automatico = modoDaPauta(item, trabalho);
  const ehStories = item.delivery_type === "story" && !trabalho;
  const [escolha, setEscolha] = useEstadoDaTela<ModoDaPauta | null>(`mesa:estudio:modo:${item.project_id}:${item.id}`, null, { validar: (v) => v === null || v === "arte" || v === "fotos" || v === "video" });
  const [ajuste, setAjuste] = useState<ModoDaPauta | null>(null);
  const modo = trabalho ? automatico : ajuste || (item.modo_estudio || automatico !== "arte" ? automatico : escolha || automatico);
  // Uma peça persistida não é convertida por um clique no seletor.
  const protegido = !!trabalho || !!item.planejamento;
  const controles = <div className="flex shrink-0 items-center gap-1" data-controles-da-pauta="">
      <div role="group" aria-label="Formato do estúdio" className="flex rounded-lg bg-muted p-1">
        {MODOS.map(({ id, nome, Icone }) => <button key={id} type="button" aria-label={nome} aria-pressed={modo === id} disabled={protegido && id !== automatico} title={protegido && id !== automatico ? 'Esta pauta já tem um trabalho. Crie outra pauta para mudar o tipo sem substituir o conteúdo.' : nome} onClick={() => { setAjuste(id); setEscolha(id); }} className={`flex h-8 w-8 items-center justify-center rounded-md text-[12px] disabled:opacity-40 ${modo === id ? 'bg-card shadow-sm' : ''}`}><Icone className="h-3.5 w-3.5" /></button>)}
      </div>
      {modo !== "arte" && <button type="button" className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={foco ? 'Sair da tela cheia' : 'Tela cheia'} title={foco ? 'Sair da tela cheia' : 'Tela cheia'} onClick={() => onFoco(!foco)}>{foco ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}</button>}
    </div>;
  return <ControlesDaPauta.Provider value={controles}><section className="flex min-h-0 min-w-0 flex-1 flex-col" data-modo-da-pauta={modo}>
    <Suspense fallback={<p role="status">Abrindo ferramentas…</p>}>
      {ehStories ? <StoriesDaPauta item={item} /> : item.planejamento ? <PautaPlanejada key={item.id} item={item} onPronta={onPautaPronta}>{(pronta) => modo === "fotos" ? <Fotos key={pronta.id} item={pronta} roteiro={roteiro} arte={arte} /> : <Video key={pronta.id} item={pronta} arte={arte} />}</PautaPlanejada> : modo === "arte" ? children : modo === "fotos" ? <Fotos key={`${item.id}:${item.midia?.gerada_em || ""}`} item={item} roteiro={roteiro} arte={arte} /> : <Video key={`${item.id}:${item.midia?.gerada_em || ""}`} item={item} arte={arte} />}
    </Suspense>
  </section></ControlesDaPauta.Provider>;
}
