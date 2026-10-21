import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarDays, ExternalLink, FileText, Folder, FolderInput, FolderPlus, Image, Loader2, RefreshCw, Search, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { campo, juntar, superficie, texto } from "@/components/sistema/estilos";
import { resolveFileUrl, useResolvedFileUrl } from "@/lib/fileUrls";
import { openFile } from "@/lib/fileActions";
import { textoDoErro } from "@/lib/mesa/api";
import { useFiltroDaMarca, useMarcaDaMesa, useMesa } from "./MesaContexto";
import {
  contagensDasPastas, criarPastaNaOrganizacao, filtrarOrganizacao, itensDaOrganizacao, lerOrganizacao,
  linkDoWorkspaceDaOrganizacao, moverNaOrganizacao, pastasDaOrganizacao,
  type ItemDaOrganizacao,
} from "./organizacaoDaMesa";

const OrganizadorInteligente = lazy(() => import("@/components/workspace/OrganizadorInteligente"));
const VAZIO = { nos: [], arquivos: [] };

function CartaoDoArquivo({ item, clientId, onOrganizar }: { item: ItemDaOrganizacao; clientId: string; onOrganizar: () => void }) {
  const [abrindo, setAbrindo] = useState(false);
  const imagem = item.mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif)$/i.test(item.nome);
  const { url, error } = useResolvedFileUrl({
    fileUrl: item.fileUrl, storageBucket: item.bucket, storagePath: item.caminho, miniatura: imagem,
  });
  const abrir = /^https?:\/\//i.test(url) ? url : "";
  const abrirOriginal = async () => {
    setAbrindo(true);
    try {
      const original = await resolveFileUrl({ fileUrl: item.fileUrl, storageBucket: item.bucket, storagePath: item.caminho });
      if (!/^https?:\/\//i.test(original)) throw new Error("Arquivo indisponível. Abra no Workspace para verificar.");
      openFile(original);
    } catch (e) { toast.error(textoDoErro(e)); }
    finally { setAbrindo(false); }
  };
  return (
    <article className={juntar(superficie.painel, "flex min-w-0 flex-col overflow-hidden")}>
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted/40">
        {imagem && abrir && !error ? <img src={abrir} alt={item.nome} className="h-full w-full object-contain" loading="lazy" /> :
          <div className="px-3 text-center text-muted-foreground">{imagem ? <Image className="mx-auto h-7 w-7" aria-hidden="true" /> : <FileText className="mx-auto h-7 w-7" aria-hidden="true" />}
            {error && <p className={juntar(texto.auxiliar, "mt-2")}>Prévia indisponível</p>}
          </div>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col p-3">
        <p title={item.nome} className="line-clamp-2 break-words text-[13px] font-medium">{item.nome}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{item.origem === "workspace" ? "Workspace" : "Arquivos do painel"}</p>
        <div className="mt-auto flex flex-wrap gap-1 pt-3">
          {abrir ? <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => void abrirOriginal()} disabled={abrindo} aria-label={`Abrir ${item.nome}`}>Abrir{abrindo ? <Loader2 className="ml-1 h-3 w-3 animate-spin" /> : <ExternalLink className="ml-1 h-3 w-3" />}</Button> :
            <Button variant="outline" size="sm" className="h-7 px-2" asChild><Link to={linkDoWorkspaceDaOrganizacao(clientId, item.origem === "workspace" ? item.pasta : null)}>No Workspace</Link></Button>}
          {item.origem === "workspace" ? <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onOrganizar} aria-label={`Organizar ${item.nome}`}><FolderInput className="mr-1 h-3 w-3" />Organizar</Button> :
            <Button variant="ghost" size="sm" className="h-7 px-2" asChild><Link to={linkDoWorkspaceDaOrganizacao(clientId)} aria-label={`Organizar ${item.nome} no Workspace`}>Organizar</Link></Button>}
        </div>
      </div>
    </article>
  );
}

/** Organização é outra vista dos arquivos reais do cliente, com o mesmo organizador e as mesmas pastas do Workspace. */
export default function AbaOrganizacao({ onAbrirMes }: { onAbrirMes: () => void }) {
  const { clientId, clientName, userId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const filtro = useFiltroDaMarca();
  const qc = useQueryClient();
  const [selecao, setSelecao] = useState("todos");
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(60);
  const [novaPasta, setNovaPasta] = useState(false);
  const [nome, setNome] = useState("");
  const [movendo, setMovendo] = useState<ItemDaOrganizacao | null>(null);
  const [destino, setDestino] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [organizador, setOrganizador] = useState(false);
  const consulta = useQuery({
    queryKey: ["workspace-organizacao-mesa", clientId], queryFn: () => lerOrganizacao(clientId),
    enabled: !!clientId, staleTime: 15_000, refetchInterval: 30_000, refetchIntervalInBackground: false,
  });
  const acervo = consulta.data || VAZIO;
  const itens = useMemo(() => itensDaOrganizacao(acervo, filtro), [acervo, filtro]);
  const pastas = useMemo(() => pastasDaOrganizacao(acervo.nos), [acervo.nos]);
  const contagens = useMemo(() => contagensDasPastas(itens, acervo.nos), [itens, acervo.nos]);
  const pastasDosArquivos = useMemo(() => Array.from(new Set(itens.filter((i) => i.origem === "arquivos" && i.pasta).map((i) => i.pasta as string))).sort((a, b) => a.localeCompare(b, "pt-BR")), [itens]);
  const visiveis = useMemo(() => filtrarOrganizacao(itens, acervo.nos, selecao, busca), [itens, acervo.nos, selecao, busca]);
  const pastaAtual = selecao.startsWith("workspace:") ? selecao.slice(10) : null;
  const nomeDaPasta = pastas.find((p) => p.id === pastaAtual)?.nome;
  const atualizar = () => {
    for (const chave of ["workspace-organizacao-mesa", "workspace-nodes", "workspace-index", "workspace-client-files"]) void qc.invalidateQueries({ queryKey: [chave] });
  };
  const escolher = (valor: string) => { setSelecao(valor); setLimite(60); };
  const salvar = async () => {
    setSalvando(true);
    try {
      if (movendo) await moverNaOrganizacao(clientId, movendo.id, destino || null, acervo.nos);
      else await criarPastaNaOrganizacao(clientId, userId || "", nome, pastaAtual, acervo.nos);
      atualizar();
      toast.success(movendo ? "Arquivo organizado no Workspace" : "Pasta criada no Workspace");
      setMovendo(null); setNovaPasta(false); setNome("");
    } catch (e) { toast.error(textoDoErro(e)); }
    finally { setSalvando(false); }
  };
  const linha = (valor: string, rotulo: string, total: number, indentada = false) => <button
    type="button" key={valor} onClick={() => escolher(valor)} aria-pressed={selecao === valor}
    title={rotulo} className={juntar("flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary", indentada && "pl-5", selecao === valor ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}>
    <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{rotulo}</span><span className={juntar(texto.etiqueta, "ml-auto tabular-nums")}>{total}</span>
  </button>;

  return (
    <section aria-label="Organização do cliente" className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><h2 className={texto.tituloSecao}>Organização</h2><p className="text-[13px] text-muted-foreground">Pastas e arquivos de {clientName}, junto com o Workspace.</p></div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => { atualizar(); }} disabled={consulta.isFetching} aria-label="Atualizar organização"><RefreshCw className={juntar("h-4 w-4", consulta.isFetching && "animate-spin")} /></Button>
          <Button variant="outline" size="sm" onClick={onAbrirMes}><CalendarDays className="mr-1.5 h-4 w-4" />Planejar o mês</Button>
          <Button variant="outline" size="sm" asChild><Link to={linkDoWorkspaceDaOrganizacao(clientId, pastaAtual)}>Workspace<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button>
        </div>
      </div>
      {marca && <div className="flex items-center gap-1.5"><p className={texto.auxiliar}>Arquivos do painel: {marca.nome}</p><AjudaRecolhida rotulo="Pastas compartilhadas entre marcas">As pastas do Workspace são compartilhadas entre as marcas deste cliente.</AjudaRecolhida></div>}
      <div className="grid min-w-0 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <aside aria-label="Pastas da organização" className={juntar(superficie.painel, "min-w-0 self-start p-2")}>
          {linha("todos", "Todos os arquivos", itens.length)}
          {linha("workspace", "Workspace do cliente", itens.filter((i) => i.origem === "workspace").length)}
          <div className="max-h-72 overflow-y-auto">{pastas.map((p) => linha(`workspace:${p.id}`, p.nome, contagens.get(p.id) || 0, true))}</div>
          <Button variant="ghost" size="sm" className="mt-1 h-8 w-full justify-start" onClick={() => setNovaPasta(true)} disabled={!consulta.isSuccess || !userId}><FolderPlus className="mr-2 h-3.5 w-3.5" />Nova pasta</Button>
          <div className="my-2 border-t border-border" />
          {linha("arquivos", "Arquivos do painel", itens.filter((i) => i.origem === "arquivos").length)}
          <div className="max-h-48 overflow-y-auto">{pastasDosArquivos.map((p) => linha(`arquivos:${p}`, p, itens.filter((i) => i.origem === "arquivos" && i.pasta === p).length, true))}</div>
        </aside>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 flex-1"><span className="sr-only">Buscar arquivos</span><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" /><Input className="pl-8" value={busca} onChange={(e) => { setBusca(e.target.value); setLimite(60); }} placeholder="Buscar arquivos…" /></label>
            <Button variant="outline" size="sm" onClick={() => setOrganizador(true)} disabled={!consulta.isSuccess} title="Organizar as pastas e os arquivos do Workspace, com prévia antes de confirmar"><Wand2 className="mr-1.5 h-4 w-4" />Organizar com IA</Button>
          </div>
          <p className={texto.auxiliar}>{nomeDaPasta || (selecao === "todos" ? "Todos os arquivos" : selecao === "workspace" ? "Workspace do cliente" : selecao.startsWith("arquivos:") ? selecao.slice(9) : "Arquivos do painel")} · {visiveis.length} arquivo{visiveis.length === 1 ? "" : "s"}</p>
          {consulta.isError ? <EstadoDeErro titulo="Não foi possível ler os arquivos" descricao={textoDoErro(consulta.error)} acao={<Button variant="outline" size="sm" onClick={() => void consulta.refetch()}>Tentar novamente</Button>} /> :
            consulta.isLoading ? <Carregando forma="grade" linhas={6} rotulo="Lendo a organização do cliente" /> :
              !visiveis.length ? <EstadoVazio icone={<Folder className="h-5 w-5" />} titulo={busca ? "Nenhum arquivo encontrado" : "Esta seleção ainda não tem arquivos"} descricao="Os arquivos enviados ao Workspace ou entregues pelo painel aparecem aqui." /> :
                <><div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">{visiveis.slice(0, limite).map((item) => <CartaoDoArquivo key={`${item.origem}:${item.id}`} item={item} clientId={clientId} onOrganizar={() => { setMovendo(item); setDestino(item.pasta || ""); }} />)}</div>
                  {visiveis.length > limite && <Button variant="outline" onClick={() => setLimite((v) => v + 60)}>Mostrar mais arquivos</Button>}</>}
        </div>
      </div>
      <Dialog open={novaPasta || !!movendo} onOpenChange={(aberto) => { if (!aberto && !salvando) { setNovaPasta(false); setMovendo(null); setNome(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{movendo ? "Organizar arquivo" : "Nova pasta"}</DialogTitle><DialogDescription>{movendo ? `Mover “${movendo.nome}” para outra pasta do mesmo cliente.` : `Criar no Workspace de ${clientName}${nomeDaPasta ? `, dentro de ${nomeDaPasta}` : ", na raiz"}.`}</DialogDescription></DialogHeader>
          {movendo ? <label className={juntar(texto.corpo, "space-y-1")}><span>Pasta de destino</span><select aria-label="Pasta de destino" className={juntar(campo, "h-10")} value={destino} onChange={(e) => setDestino(e.target.value)} disabled={salvando}><option value="">Raiz do cliente</option>{pastas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label> :
            <label className={juntar(texto.corpo, "space-y-1")}><span>Nome da pasta</span><Input autoFocus value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} placeholder="Campanha, tema ou nicho" disabled={salvando} /></label>}
          <DialogFooter><Button variant="outline" disabled={salvando} onClick={() => { setNovaPasta(false); setMovendo(null); }}>Cancelar</Button><Button onClick={() => void salvar()} disabled={salvando || (!movendo && !nome.trim())}>{salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{movendo ? "Mover arquivo" : "Criar pasta"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {organizador && <Suspense fallback={<Carregando rotulo="Abrindo o organizador" />}><OrganizadorInteligente aberto onFechar={() => setOrganizador(false)} clientId={clientId} parentId={pastaAtual} nivelNome={nomeDaPasta || `o Workspace de ${clientName}`} onMudou={atualizar} /></Suspense>}
    </section>
  );
}
