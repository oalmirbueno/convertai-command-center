import { ControlesDaPauta } from "./ControlesDaPauta";
import { superficie, juntar } from "@/components/sistema/estilos";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Camera, Film, ImagePlus, Maximize2, Wand2, Type, Send, PenLine, Image, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { useFotos, type FotoDoAcervo } from "@/components/mesa-foto/fotoApi";
import MelhorarFotoNaBancada from "./MelhorarFotoNaBancada";
import { useMesaFoto } from "@/components/mesa-foto/Comuns";
import { useMesa } from "./MesaContexto";
import { ImagemDaMesa, useUrlDaMesa } from "./MesaContexto";
import LogoNaFoto from "./LogoNaFoto";
import ImagemComZoom from "./ImagemComZoom";

const AcoesContexto = createContext<HTMLDivElement | null>(null);
const PainelContexto = createContext("gerar");
const SelecaoContexto = createContext<{ destino: HTMLDivElement | null; abrir: (aberta: boolean) => void } | null>(null);
/** Escolher referências ocupa a prancheta; nas mesas avulsas mantém a posição. */
export function SelecaoDaBancada({ children }: { children: ReactNode }) {
  const contexto = useContext(SelecaoContexto);
  const abrir = contexto?.abrir;
  useEffect(() => { abrir?.(true); return () => abrir?.(false); }, [abrir]);
  return contexto ? (contexto.destino ? createPortal(children, contexto.destino) : null) : children;
}
export interface FerramentaDaBancada { id: string; nome: string; icone: LucideIcon; onAbrir?: () => void }
export function PainelDaBancada({ id, children, quando = true }: { id: string | string[]; children: ReactNode; quando?: boolean }) {
  const ativa = useContext(PainelContexto);
  return <div hidden={quando && !(Array.isArray(id) ? id.includes(ativa) : id === ativa)}>{children}</div>;
}
/** O mesmo botão de gerar aparece na barra da bancada; fora dela mantém sua posição. */
export function AcoesDaBancada({ children }: { children: ReactNode }) {
  const destino = useContext(AcoesContexto);
  return destino ? createPortal(children, destino) : children;
}

/** Mesma disposição da prancheta de artes, com ferramentas próprias de cada mídia. */
export default function BancadaDaPauta({ tipo, titulo, acoes, prancheta, previa, ferramentas, abas = [], ativa = "gerar", onAba, escolhendo = false }: {
  tipo: "fotos" | "video"; titulo: string; acoes?: ReactNode; prancheta: ReactNode; previa: ReactNode; ferramentas: ReactNode;
  abas?: FerramentaDaBancada[]; ativa?: string; onAba?: (id: string) => void; escolhendo?: boolean;
}) {
  const controles = useContext(ControlesDaPauta);
  const Icone = tipo === "fotos" ? Camera : Film;
  const [destino, setDestino] = useState<HTMLDivElement | null>(null);
  const [destinoSelecao, setDestinoSelecao] = useState<HTMLDivElement | null>(null);
  const [selecaoAberta, setSelecaoAberta] = useState(false);
  return <SelecaoContexto.Provider value={{ destino: destinoSelecao, abrir: setSelecaoAberta }}><AcoesContexto.Provider value={destino}><PainelContexto.Provider value={ativa}><section className={juntar(superficie.painel, "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden")} data-bancada-da-pauta={tipo}>
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-primary px-3 py-2">
      <Icone className="h-4 w-4 shrink-0 text-primary" /><p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{titulo}</p>
      {controles}{acoes}<div ref={setDestino} className="flex min-w-0 flex-wrap items-center" />
    </header>
    <div className={`grid min-h-0 flex-1 grid-cols-1 lg:overflow-hidden ${escolhendo || selecaoAberta ? 'lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(290px,360px)]' : 'lg:grid-cols-[144px_minmax(0,1fr)_minmax(290px,400px)]'}`} style={{ minHeight: 480 }}>
      <aside aria-label="Prancheta" className="min-h-0 min-w-0 border-b p-3 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <p className="mb-3 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Prancheta</p><div hidden={selecaoAberta}>{prancheta}</div><div ref={setDestinoSelecao} hidden={!selecaoAberta} />
      </aside>
      <main aria-label="Prévia do conteúdo" className="flex min-h-0 min-w-0 flex-col overflow-hidden p-4">{previa}</main>
      <div className="flex min-h-0 min-w-0 border-t lg:border-l lg:border-t-0"><aside aria-label={tipo === "fotos" ? "Ferramentas de fotos" : "Ferramentas de vídeo"} className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4"><h3 className="mb-4 border-b pb-3 text-[13px] font-semibold">{abas.find((a) => a.id === ativa)?.nome || "Ferramentas"}</h3>{ferramentas}</aside>
      {!!abas.length && <TooltipProvider delayDuration={200}><nav aria-label="Ferramentas do estúdio" className="flex w-12 shrink-0 flex-col items-center border-l py-2">{abas.map(({ id, nome, icone: Icone, onAbrir }) => <Tooltip key={id}><TooltipTrigger asChild><button type="button" aria-label={nome} aria-pressed={ativa === id} onClick={() => onAbrir ? onAbrir() : onAba?.(id)} className={`mb-1 flex h-10 w-10 items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-primary ${ativa === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}><Icone className="h-[18px] w-[18px]" /></button></TooltipTrigger><TooltipContent side="left">{nome}</TooltipContent></Tooltip>)}</nav></TooltipProvider>}</div>
    </div>
  </section></PainelContexto.Provider></AcoesContexto.Provider></SelecaoContexto.Provider>;
}

export interface FotoDaPrancheta { id: string; nome: string; caminho: string; bucket?: string }

export function PreviaDaPauta({ caminho, bucket = "mesa", nome, video = false, compacta = false }: { caminho: string; bucket?: string; nome: string; video?: boolean; compacta?: boolean }) {
  const { data: url, isError } = useUrlDaMesa(caminho, bucket);
  const area = useRef<HTMLDivElement>(null);
  const [medidas, setMedidas] = useState({ largura: 320, altura: 400 });
  const [grande, setGrande] = useState(false);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const medir = () => setMedidas({ largura: Math.max(120, el.clientWidth - 8), altura: Math.max(200, el.clientHeight - 48) });
    medir();
    const observer = new ResizeObserver(medir); observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <div ref={area} className={`relative flex min-w-0 items-center justify-center overflow-hidden ${compacta ? "h-64 shrink-0" : "min-h-[240px] flex-1"}`} data-previa-da-pauta="">
    {url && <button type="button" aria-label="Ver grande" onClick={() => setGrande(true)} className="absolute right-2 top-2 z-10 rounded-md border bg-card p-2"><Maximize2 className="h-4 w-4" /></button>}
    {isError ? <p role="alert">Não foi possível abrir este arquivo.</p> : !url ? <p role="status">Carregando prévia…</p> : video ?
      <video key={url} src={url} controls playsInline preload="metadata" aria-label={nome} className="h-full w-full rounded-lg object-contain" /> :
      <ImagemComZoom src={url} alt={nome} {...medidas} onProporcao={() => undefined} />}
    <JanelaCentral aberta={grande} onFechar={() => setGrande(false)} titulo={nome} largura="tela">{url && (video ? <video src={url} controls playsInline className="mx-auto max-h-[80vh] max-w-full" /> : <ImagemComZoom src={url} alt={nome} largura={Math.max(320, window.innerWidth - 120)} altura={Math.max(300, window.innerHeight - 160)} onProporcao={() => undefined} />)}</JanelaCentral>
  </div>;
}

export function BancadaDeFotos({ titulo, fotos, children, onEscolher, onMover, onRemover, onEditar, seletor, extras = [], pronta = false, onDerivada }: {
  titulo: string; fotos: FotoDaPrancheta[]; children: ReactNode; onEscolher?: () => void;
  onMover?: (indice: number, direcao: number) => void; onRemover?: (id: string) => void; onEditar?: (id: string) => void;
  seletor?: ReactNode; extras?: FerramentaDaBancada[]; pronta?: boolean; onDerivada?: (antiga: string, nova: FotoDoAcervo) => void | Promise<void>;
}) {
  const { clientId } = useMesa();
  const acervo = useFotos(clientId);
  const mesa = useMesaFoto();
  const [painel, setPainel] = useState(pronta ? "legenda" : "gerar");
  const [ativa, setAtiva] = useState<string | null>(null);
  const foto = fotos.find((f) => f.id === ativa) || fotos[0];
  const original = acervo.data?.find((f) => f.id === foto?.id);
  const editar = onEditar || mesa.abrirNoEstudio;
  const abas: FerramentaDaBancada[] = [
    { id: "gerar", nome: pronta ? "Fotos do post" : "Gerar fotos", icone: PenLine },
    { id: "melhorar", nome: "Melhorar e ampliar", icone: Wand2 },
    { id: "logo", nome: "Logo da marca", icone: Image },
    ...extras,
    { id: "legenda", nome: "Legenda", icone: Type },
    { id: "entrega", nome: "Enviar para aprovação", icone: Send },
  ];
  return <BancadaDaPauta tipo="fotos" titulo={titulo}
    abas={abas} ativa={painel} onAba={setPainel} escolhendo={!!seletor}
    acoes={onEscolher && <button type="button" onClick={onEscolher} className="rounded-md bg-primary px-3 py-2 text-[12px] text-primary-foreground">Escolher fotos</button>}
    prancheta={seletor || <><ol className="flex gap-3 overflow-x-auto lg:flex-col lg:overflow-visible">{fotos.map((f, i) => <li key={f.id} className="w-28 shrink-0">
      <button type="button" aria-pressed={foto?.id === f.id} aria-label={`Ver foto ${i + 1}: ${f.nome}`} onClick={() => setAtiva(f.id)} className={`block w-full overflow-hidden rounded-lg border-2 ${foto?.id === f.id ? 'border-primary' : 'border-transparent'}`}>
        <ImagemDaMesa caminho={f.caminho} bucket={f.bucket || "mesa"} alt={f.nome} className="aspect-[4/5] w-full object-cover" />
      </button><p className="my-1 truncate text-[12px]">{i + 1} · {i === 0 ? "Capa" : f.nome}</p>
      {onMover && <div className="flex items-center justify-between text-[12px]"><button type="button" disabled={!i} aria-label={`Mover foto ${i + 1} para antes`} onClick={() => onMover(i, -1)}>←</button><button type="button" aria-label={`Remover foto ${i + 1}`} onClick={() => onRemover?.(f.id)}>Remover</button><button type="button" disabled={i === fotos.length - 1} aria-label={`Mover foto ${i + 1} para depois`} onClick={() => onMover(i, 1)}>→</button></div>}
    </li>)}</ol>{onEscolher && <button type="button" onClick={onEscolher} className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed px-2 py-5 text-[12px]"><ImagePlus className="h-4 w-4" />Adicionar</button>}</>}
    previa={<><div className="flex items-center justify-between text-[13px]"><strong>{foto ? `Foto ${fotos.indexOf(foto) + 1} de ${fotos.length}` : "Foto da pauta"}</strong>{foto && onEditar && <button type="button" onClick={() => onEditar(foto.id)} className="text-primary">Melhorar esta foto</button>}</div>{foto ? <PreviaDaPauta key={foto.id} {...foto} /> : <div className="flex min-h-[400px] flex-1 flex-col items-center justify-center rounded-lg border border-dashed text-center"><Camera className="mb-3 h-8 w-8 text-muted-foreground" /><p className="text-[13px]">Escolha as fotos para montar esta pauta.</p>{onEscolher && <button type="button" onClick={onEscolher} className="mt-4 rounded-md bg-primary px-4 py-2 text-[13px] text-primary-foreground">Escolher fotos do cliente</button>}</div>}</>}
    ferramentas={<>{children}<PainelDaBancada id="logo">{original && onDerivada ? <LogoNaFoto key={original.id} foto={original} onPronta={async (nova) => { await onDerivada(original.id, nova); setAtiva(nova.id); }} /> : <p className="text-[13px]">{pronta ? "Use Trocar fotos para aplicar a logo em uma nova versão antes de enviar." : "Escolha uma foto na prancheta para aplicar a logo."}</p>}</PainelDaBancada><PainelDaBancada id="melhorar">{original && onDerivada ? <><MelhorarFotoNaBancada key={original.id} foto={original} onPronta={async (nova) => { await onDerivada(original.id, nova); setAtiva(nova.id); }} />{editar && <button type="button" className="mt-4 rounded-md border p-2 text-[12px]" onClick={() => editar(original.id)}>Luz, cor, cenário e recorte</button>}</> : <p className="text-[13px]">Escolha uma foto editável na prancheta. Posts enviados mantêm a versão aprovada.</p>}</PainelDaBancada></>} />;
}
