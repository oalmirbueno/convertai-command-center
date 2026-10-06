import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Images, ZoomIn } from "lucide-react";
import { ImagemDaMesa } from "@/components/mesa/MesaContexto";
import { Ampliar, type ImagemAmpliavel } from "@/components/mesa/Ampliar";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";

export type FotoNaGaleria = ImagemAmpliavel & { id: string; grupo: string; aprovada?: boolean; detalhe?: string; origemId?: string | null };
const POR_FAIXA = 6;
const POR_GRADE = 36;

/** Uma faixa curta e uma biblioteca pesquisável; nenhuma versão fica descartada. */
export default function GaleriaDeFotos({ titulo, fotos, atualId, onSelecionar, onUsar, recolhivel = false }: {
  titulo: string; fotos: FotoNaGaleria[]; atualId?: string | null; onSelecionar: (id: string) => void; onUsar?: (ids: string[]) => void; recolhivel?: boolean;
}) {
  const [recolhida, setRecolhida] = useState(recolhivel);
  const [pagina, setPagina] = useState(0);
  const [aberta, setAberta] = useState(false);
  const [busca, setBusca] = useState("");
  const [grupo, setGrupo] = useState("");
  const [aprovadas, setAprovadas] = useState(false);
  const [limite, setLimite] = useState(POR_GRADE);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [zoomId, setZoomId] = useState<string | null>(null);
  const indiceAtual = fotos.findIndex((f) => f.id === atualId);
  useEffect(() => { if (indiceAtual >= 0) setPagina(Math.floor(indiceAtual / POR_FAIXA)); }, [atualId, indiceAtual]);
  const ultima = Math.max(0, Math.ceil(fotos.length / POR_FAIXA) - 1);
  const paginaVisivel = Math.min(pagina, ultima);
  const faixa = fotos.slice(paginaVisivel * POR_FAIXA, (paginaVisivel + 1) * POR_FAIXA);
  const filtradas = useMemo(() => {
    const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const termo = normalizar(busca.trim());
    return fotos.filter((f) => (!grupo || f.grupo === grupo) && (!aprovadas || f.aprovada) && (!termo || normalizar(`${f.titulo} ${f.legenda || ""} ${f.detalhe || ""}`).includes(termo)));
  }, [fotos, grupo, aprovadas, busca]);
  const selecao = marcadas.filter((id) => fotos.some((f) => f.id === id));
  const indiceZoom = fotos.findIndex((f) => f.id === zoomId);
  const miniatura = (f: FotoNaGaleria, grade = false) => <div key={f.id} className={juntar("relative min-w-0", grade ? "" : "w-20 shrink-0")}>
    <button type="button" aria-label={`Abrir ${f.titulo || f.grupo}`} aria-pressed={f.id === atualId} onClick={() => { onSelecionar(f.id); if (grade) setAberta(false); }}
      title={[f.titulo, f.detalhe].filter(Boolean).join(" · ")} className={juntar("block w-full overflow-hidden rounded-md border p-1 focus-visible:ring-2 focus-visible:ring-primary", f.id === atualId ? "border-primary bg-primary/5" : "border-transparent hover:border-border")}>
      <ImagemDaMesa caminho={f.caminho} bucket={f.bucket || "mesa"} alt={f.titulo || f.grupo} className={juntar("w-full rounded !object-contain", grade ? "h-32" : "h-16")} />
      <span className={juntar(texto.etiqueta, "mt-1 block truncate text-left")}>{f.legenda || f.grupo}</span>
      {grade && <span className={juntar(texto.auxiliar, "block truncate text-left")}>{f.titulo}</span>}
      {f.aprovada && <span className={juntar(texto.etiqueta, "block text-left text-success")}>Aprovada</span>}
    </button>
    <button type="button" className="absolute right-1 top-1 rounded bg-background/90 p-1.5 text-foreground focus-visible:ring-2 focus-visible:ring-primary" aria-label={`Ampliar ${f.titulo || f.grupo}`} onClick={() => setZoomId(f.id)}><ZoomIn className="h-3.5 w-3.5" /></button>
    {grade && onUsar && <label className={juntar(texto.auxiliar, "mt-1 flex items-center")}><input type="checkbox" className="mr-2" aria-label={`Selecionar ${f.titulo || f.grupo} para o post`} checked={selecao.includes(f.id)} disabled={!selecao.includes(f.id) && selecao.length >= 10} onChange={(e) => setMarcadas((ids) => e.target.checked ? [...ids, f.id] : ids.filter((id) => id !== f.id))} />{selecao.includes(f.id) ? `Posição ${selecao.indexOf(f.id) + 1}` : "Usar no post"}</label>}
  </div>;
  return <section aria-label={titulo} className="min-w-0" data-galeria-de-fotos="">
    <div className={juntar("flex flex-wrap items-center justify-between gap-2", !recolhida && "mb-2")}>
      <h3 className={texto.rotulo}>{recolhivel ? <button type="button" className="flex items-center gap-2 py-2 text-foreground" aria-expanded={!recolhida} onClick={() => setRecolhida(!recolhida)}><ChevronDown className={juntar("h-4 w-4 transition-transform", recolhida && "-rotate-90")} />{titulo} · {fotos.length}</button> : <>{titulo} · {fotos.length}</>}</h3>
      <div className="flex items-center space-x-1">
        <button type="button" className={botao.barra} onClick={() => { setAberta(true); setLimite(POR_GRADE); }}><Images className="mr-1 h-3.5 w-3.5" />Organizar fotos</button>
        {!recolhida && <><button type="button" className={botao.icone} aria-label="Fotos anteriores" disabled={!paginaVisivel} onClick={() => setPagina(paginaVisivel - 1)}><ChevronLeft className="h-4 w-4" /></button>
        <span className={texto.etiqueta}>{paginaVisivel + 1}/{ultima + 1}</span>
        <button type="button" className={botao.icone} aria-label="Próximas fotos" disabled={paginaVisivel === ultima} onClick={() => setPagina(paginaVisivel + 1)}><ChevronRight className="h-4 w-4" /></button></>}
      </div>
    </div>
    {!recolhida && <div className="flex min-w-0 space-x-2 overflow-x-auto pb-1" data-tira-de-versoes="">{faixa.map((f) => miniatura(f))}</div>}
    <JanelaCentral aberta={aberta} onFechar={() => setAberta(false)} titulo={titulo} largura="xl" descricao={`${filtradas.length} de ${fotos.length} imagens`}
      abaixoDoTitulo={<div className="flex flex-wrap items-center gap-2">
        <input className={juntar(campo, "w-48 flex-1")} aria-label="Buscar nas fotos" placeholder="Buscar foto, versão ou gerador" value={busca} onChange={(e) => { setBusca(e.target.value); setLimite(POR_GRADE); }} />
        <select className={juntar(campo, "w-auto")} aria-label="Grupo de fotos" value={grupo} onChange={(e) => { setGrupo(e.target.value); setLimite(POR_GRADE); }}><option value="">Todos os grupos</option>{Array.from(new Set(fotos.map((f) => f.grupo))).map((g) => <option key={g}>{g}</option>)}</select>
        <label className={juntar(texto.auxiliar, "flex items-center")}><input type="checkbox" className="mr-2" checked={aprovadas} onChange={(e) => { setAprovadas(e.target.checked); setLimite(POR_GRADE); }} />Só aprovadas</label>
      </div>}
      rodape={onUsar && <div className="flex flex-wrap items-center justify-between gap-2"><span className={texto.auxiliar}>{selecao.length}/10 escolhidas · na ordem da seleção</span><button type="button" className={botao.primario} disabled={!selecao.length} onClick={() => { onUsar(selecao); setAberta(false); }}>Preparar {selecao.length > 1 ? "carrossel" : "foto"} na Agenda</button></div>}>
      {filtradas.length ? <div className="grid min-w-0 grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{filtradas.slice(0, limite).map((f) => miniatura(f, true))}</div> : <p className={texto.auxiliar}>Nenhuma foto neste filtro.</p>}
      {filtradas.length > limite && <button type="button" className={juntar(botao.secundario, "mt-4")} onClick={() => setLimite((n) => n + POR_GRADE)}>Mostrar mais {Math.min(POR_GRADE, filtradas.length - limite)} fotos</button>}
    </JanelaCentral>
    <Ampliar imagens={fotos} indice={indiceZoom >= 0 ? indiceZoom : null} onFechar={() => setZoomId(null)} />
  </section>;
}
