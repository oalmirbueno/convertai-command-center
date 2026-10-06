import { Images, Layers, FolderOpen, UsersRound, UserRound, MessageSquare } from "lucide-react";
import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { useMesa } from "./MesaContexto";
import { CHAVES_DO_ABERTO } from "@/components/mesa-foto/diretorApi";
import { gravarEstadoDaTela, useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { ETAPAS_DA_MESA_FOTO, MesaFotoProvider, type EtapaDaMesaFoto, type MesaFotoValor } from "@/components/mesa-foto/Comuns";
import { MontarOPost, PostAberto } from "@/components/mesa-foto/EtapaAgenda";
import { usePostsDeFotos } from "@/components/mesa-foto/agendaApi";
import { chaveDoEstudioDaPauta } from "./modoDaPauta";
import { useFotos } from "@/components/mesa-foto/fotoApi";
import { BancadaDeFotos, type FerramentaDaBancada } from "./BancadaDaPauta";
import { fonteDoArquivo } from "./useItensDoMes";
import type { ItemDoMes, InfoDoRoteiro, ArteNaAgenda } from "./useItensDoMes";

const Estudio = lazy(() => import("@/components/mesa-foto/EtapaEstudio"));
const Combinar = lazy(() => import("@/components/mesa-foto/CombinarFotos"));
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
export default function EstudioDeFotosDaPauta({ item, roteiro, arte }: { item: ItemDoMes; roteiro?: InfoDoRoteiro | null; arte?: ArteNaAgenda | null }) {
  const { clientId } = useMesa();
  const chave = (parte: string) => chaveDoEstudioDaPauta(clientId, item.id, parte);
  const [etapa, guardarEtapa] = useState<EtapaDaMesaFoto>("agenda");
  const [ferramentaAberta, setFerramentaAberta] = useState(false);
  const setEtapa = (e: EtapaDaMesaFoto) => { guardarEtapa(e); setFerramentaAberta(e !== "agenda"); };
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
  const fotosQ = useFotos(clientId);
  const iniciou = useRef(false);
  useEffect(() => {
    if (!fotosQ.data || iniciou.current) return;
    if (selecionadas.length || post?.imagem_ids.length) { iniciou.current = true; return; }
    const refs = roteiro?.direcao_foto?.referencias;
    if (!Array.isArray(refs)) return;
    const ids = fotosQ.data.filter((f) => f.client_id === clientId && f.ativa && !f.referencia_web && (refs.includes(f.id) || refs.includes(f.workspace_node_id) || refs.includes(f.storage_path))).map((f) => f.id).slice(0, 10);
    if (ids.length) { iniciou.current = true; setSelecionadas(ids); }
  }, [fotosQ.data, post, roteiro, clientId, selecionadas, setSelecionadas]);
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
  const extras: FerramentaDaBancada[] = [
    { id: "compor", nome: "Compor foto", icone: Images, onAbrir: () => setEtapa("compor") },
    { id: "combinar", nome: "Combinar produtos e cenários", icone: Layers, onAbrir: () => setEtapa("combinar") },
    { id: "acervo", nome: "Acervo e Workspace", icone: FolderOpen, onAbrir: () => setEtapa("acervo") },
    { id: "modelos", nome: "Modelos", icone: UsersRound, onAbrir: () => setEtapa("modelos") },
    { id: "clones", nome: "Clones", icone: UserRound, onAbrir: () => setEtapa("clones") },
    { id: "diretor", nome: "Diretor de fotos", icone: MessageSquare, onAbrir: () => setDiretor(true) },
  ];
  const ferramentas = null;
  const fonte = fonteDoArquivo(arte?.capa);
  return <MesaFotoProvider valor={valor}>
    <div className="flex min-h-0 flex-1 flex-col" data-estudio-fotos-da-pauta={item.id}>
      <div hidden={ferramentaAberta || diretor} className={ferramentaAberta || diretor ? "hidden" : "flex min-h-0 flex-1 flex-col"}>{posts.isLoading ? <p role="status">Lendo as fotos desta pauta…</p> : posts.isError ? <p role="alert">Não foi possível ler este post. <button onClick={() => void posts.refetch()}>Tentar novamente</button></p> :
        post?.cards.length && !trocando ? <PostAberto post={post} estudio={{ ferramentas, extras }} onTrocarFotos={() => { setSelecionadas(post.imagem_ids); setTrocando(true); }} /> :
        !post && arte && fonte.caminho ? <BancadaDeFotos titulo={item.title} fotos={[{ id: arte.capa!.id, nome: item.title, caminho: fonte.caminho, bucket: fonte.bucket }]}>{ferramentas}<p className="text-[13px] font-semibold">Fotos já vinculadas à Agenda</p><p className="my-3 whitespace-pre-wrap text-[13px]">{arte.legenda}</p><a href="/calendario" className="text-[13px] text-primary">Conferir na Agenda</a></BancadaDeFotos> :
        <MontarOPost key={post?.id || item.id} fotosIniciais={trocando || selecionadas.length ? selecionadas : post?.imagem_ids || []} post={post} taskInicial={item.id} destinoFixo estudio={{ taskId: item.id, onSelecionadas: setSelecionadas, titulo: item.title, direcao: roteiro?.direcao_foto, ferramentas, extras }} onPronto={() => { setTrocando(false); void posts.refetch(); }} onCancelar={() => setTrocando(false)} />}</div>
      {ferramentaAberta && <section className="min-h-0 flex-1 overflow-y-auto rounded-xl border bg-card p-4"><header className="mb-4 flex items-center justify-between border-b pb-3"><strong className="text-[13px]">{ETAPAS_DA_MESA_FOTO.find((e) => e.valor === etapa)?.rotulo} · {item.title}</strong><button type="button" className="rounded-md border px-3 py-2 text-[12px]" onClick={() => setFerramentaAberta(false)}>Voltar à prancheta</button></header>
        <div key={navegacao}><Suspense fallback={<p role="status">Abrindo ferramentas…</p>}>
            {etapa === "estudio" && <Estudio escopo={chave("edicao")} />}
            {etapa === "combinar" && <Combinar escopo={chave("combinar")} />}
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
        </Suspense></div>
      </section>}
      {diretor && <section className="flex min-h-0 flex-1 flex-col rounded-xl border bg-card p-4"><header className="mb-4 flex justify-between border-b pb-3"><strong className="text-[13px]">Diretor · {item.title}</strong><button type="button" className="text-[12px] text-primary" onClick={() => setDiretor(false)}>Voltar à prancheta</button></header>
        <Suspense fallback={null}><Diretor escopo={item.id} pautaId={item.id} pedido={pedido} /></Suspense>
      </section>}
    </div>
  </MesaFotoProvider>;
}
