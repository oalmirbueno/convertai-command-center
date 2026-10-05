import { lazy, Suspense, useState } from "react";
import { useMesa } from "./MesaContexto";
import { CHAVES_DO_ABERTO } from "@/components/mesa-foto/diretorApi";
import { gravarEstadoDaTela, useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { ETAPAS_DA_MESA_FOTO, MesaFotoProvider, type EtapaDaMesaFoto, type MesaFotoValor } from "@/components/mesa-foto/Comuns";
import { MontarOPost, PostAberto } from "@/components/mesa-foto/EtapaAgenda";
import { usePostsDeFotos } from "@/components/mesa-foto/agendaApi";
import { chaveDoEstudioDaPauta } from "./modoDaPauta";
import type { ItemDoMes } from "./useItensDoMes";

const Estudio = lazy(() => import("@/components/mesa-foto/EtapaEstudio"));
const Compor = lazy(() => import("@/components/mesa-foto/ComposicaoRapida"));
const Fotos = lazy(() => import("@/components/mesa-foto/EtapaAcervo"));
const Modelos = lazy(() => import("@/components/mesa-foto/EtapaModelos"));
const Clones = lazy(() => import("@/components/mesa-foto/EtapaClones"));
const Kits = lazy(() => import("@/components/mesa-foto/EtapaKits"));
const Ensaio = lazy(() => import("@/components/mesa-foto/EtapaEnsaio"));
const Preparar = lazy(() => import("@/components/mesa-foto/EtapaPreparar"));
const Revisar = lazy(() => import("@/components/mesa-foto/EtapaRevisar"));
const Aprovar = lazy(() => import("@/components/mesa-foto/EtapaAprovar"));
const Biblioteca = lazy(() => import("@/components/mesa-foto/EtapaBiblioteca"));
const Book = lazy(() => import("@/components/mesa-foto/EtapaBook"));
const Canvas = lazy(() => import("@/components/mesa-foto/EtapaCanvas"));
const Campanha = lazy(() => import("@/components/mesa-foto/EtapaCampanha"));
const Diretor = lazy(() => import("@/components/mesa-foto/AgenteDiretor"));

/** Adapta as ferramentas existentes à pauta; não altera URL nem rascunho da Mesa Fotos. */
export default function EstudioDeFotosDaPauta({ item }: { item: ItemDoMes }) {
  const { clientId } = useMesa();
  const chave = (parte: string) => chaveDoEstudioDaPauta(clientId, item.id, parte);
  const [etapa, setEtapa] = useEstadoDaTela<EtapaDaMesaFoto>(chave("etapa"), "agenda");
  const [selecionadas, setSelecionadas] = useEstadoDaTela<string[]>(chave("fotos"), [], { validar: Array.isArray });
  const [imagemId, setImagemId] = useEstadoDaTela<string | null>(chave("imagem"), null);
  const [kitId, escolherKit] = useEstadoDaTela<string | null>(chave("kit"), null);
  const [ensaioId, escolherEnsaio] = useEstadoDaTela<string | null>(chave("ensaio"), null);
  const [navegacao, setNavegacao] = useState(0);
  const [diretor, setDiretor] = useState(false);
  const [pedido, setPedido] = useState<{ mensagem: string; em: number; rascunho?: boolean } | null>(null);
  const [trocando, setTrocando] = useState(false);
  const posts = usePostsDeFotos(clientId, item.id);
  const post = posts.data?.find((p) => p.task_id === item.id) || null;
  const valor: MesaFotoValor = {
    kitId, ensaioId, imagemId, escolherKit, escolherEnsaio, selecionadas, etapa,
    setSelecionadas: (ids) => { setSelecionadas(ids); setTrocando(true); },
    navegarNoEstudio: (destino) => {
      const url = new URL(destino, window.location.origin);
      if (url.pathname !== "/mesa-foto" || (url.searchParams.get("client") && url.searchParams.get("client") !== clientId)) return;
      if (url.searchParams.get("task") && url.searchParams.get("task") !== item.id) return;
      for (const campo of ["canvas", "book", "clone", "modelo"] as const) {
        const id = url.searchParams.get(campo);
        if (id && /^[0-9a-f-]{36}$/i.test(id)) gravarEstadoDaTela((campo === "modelo" ? CHAVES_DO_ABERTO.persona : CHAVES_DO_ABERTO[campo])(clientId), id);
      }
      setNavegacao((n) => n + 1);
      const e = url.searchParams.get("etapa");
      if (ETAPAS_DA_MESA_FOTO.some((x) => x.valor === e)) setEtapa(e === "usar" || e === "criar" ? "agenda" : e as EtapaDaMesaFoto);
      if (url.searchParams.has("imagem")) setImagemId(url.searchParams.get("imagem"));
      if (url.searchParams.has("kit")) escolherKit(url.searchParams.get("kit"));
      if (url.searchParams.has("ensaio")) escolherEnsaio(url.searchParams.get("ensaio"));
    },
    irPara: (e, extras) => { setEtapa(e === "criar" || e === "usar" ? "agenda" : e); if (extras?.imagem !== undefined) setImagemId(extras.imagem); if (extras?.kit !== undefined) escolherKit(extras.kit); if (extras?.ensaio !== undefined) escolherEnsaio(extras.ensaio); },
    abrirAgente: () => setDiretor(true),
    pedirAoDiretor: (mensagem, opcoes) => { setPedido({ mensagem, em: Date.now(), rascunho: opcoes?.soRascunho }); setDiretor(true); },
    abrirNoEstudio: (id) => { setImagemId(id); setEtapa("estudio"); },
    prepararNaAgenda: (ids) => { setSelecionadas(ids); setTrocando(true); setEtapa("agenda"); },
  };
  return <MesaFotoProvider valor={valor}>
    <div className="flex min-h-0 flex-1 flex-col" data-estudio-fotos-da-pauta={item.id}>
      <nav aria-label="Ferramentas de fotos da pauta" className="flex flex-wrap gap-1 border-b pb-2">
        {([['agenda', 'Fotos e carrossel'], ['estudio', 'Melhorar foto'], ['compor', 'Compor'], ['acervo', 'Acervo'], ['modelos', 'Modelos'], ['clones', 'Clones']] as const).map(([e, nome]) =>
          <button key={e} type="button" aria-pressed={etapa === e} onClick={() => setEtapa(e)} className={`rounded-md px-3 py-2 text-xs ${etapa === e ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{nome}</button>)}
        <button type="button" aria-expanded={diretor} onClick={() => setDiretor(!diretor)} className="ml-auto rounded-md border px-3 text-xs">Diretor de fotos</button>
      </nav>
      {selecionadas.length > 0 && <button type="button" className="my-2 text-left text-xs text-primary" onClick={() => { setTrocando(true); setEtapa("agenda"); }}>Conferir as {selecionadas.length} fotos selecionadas para esta pauta</button>}
      <div className={`grid min-h-0 flex-1 gap-4 ${diretor ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
        <div key={navegacao} className="min-h-0 min-w-0 overflow-y-auto p-2">
          <Suspense fallback={<p role="status">Abrindo ferramentas…</p>}>
            {etapa === "agenda" && (posts.isLoading ? <p role="status">Lendo o post desta pauta…</p> : posts.isError ? <p role="alert">Não foi possível ler este post. <button onClick={() => void posts.refetch()}>Tentar novamente</button></p> :
              post?.cards.length && !trocando ? <PostAberto post={post} onTrocarFotos={() => { setSelecionadas(post.imagem_ids); setTrocando(true); }} /> :
              <MontarOPost key={`${post?.id || item.id}:${selecionadas.join(",")}`} fotosIniciais={selecionadas.length ? selecionadas : post?.imagem_ids || []} post={post} taskInicial={item.id} destinoFixo onPronto={() => { setTrocando(false); void posts.refetch(); }} onCancelar={() => setTrocando(false)} />)}
            {etapa === "estudio" && <Estudio escopo={chave("edicao")} />}
            {etapa === "compor" && <Compor escopo={chave("composicao")} />}
            {etapa === "acervo" && <Fotos />}
            {etapa === "modelos" && <Modelos />}
            {etapa === "clones" && <Clones />}
            {etapa === "kits" && <Kits />}
            {etapa === "ensaio" && <Ensaio />}
            {etapa === "preparar" && <Preparar />}
            {etapa === "revisar" && <Revisar />}
            {etapa === "aprovar" && <Aprovar />}
            {etapa === "biblioteca" && <Biblioteca />}
            {etapa === "book" && <Book />}
            {etapa === "canvas" && <Canvas />}
            {etapa === "campanha" && <Campanha />}
          </Suspense>
        </div>
        {diretor && <aside className="min-h-0 overflow-y-auto border-l pl-3"><Suspense fallback={null}><Diretor escopo={item.id} pedido={pedido} /></Suspense></aside>}
      </div>
    </div>
  </MesaFotoProvider>;
}
