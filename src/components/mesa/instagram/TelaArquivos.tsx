import { useMemo, useState, type DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ExternalLink, FileText, Film, Folder, LayoutGrid, List, Loader2, Maximize2, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, juntar, superficie, texto } from "@/components/sistema/estilos";
import { ehImagem, textoDoErro } from "@/lib/mesa/api";
import { FILE_FOLDERS } from "@/lib/fileMetadata";
import { Ampliar, type ImagemAmpliavel } from "../Ampliar";
import { MiniaturaDoStorage } from "../ContextoMiniatura";
import { useMesa } from "../MesaContexto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";

/**
 * Pastas e arquivos do cliente, dentro da aba Redes (rodada 3, 28/09: "ver a
 * imagem, poder movimentar, mudar pela lista, algo bem bonito").
 * - Grade de miniaturas (imagem e o quadro do vídeo quando o Workspace tem)
 *   ou lista; clicar na imagem abre a prévia grande ali mesmo.
 * - Arrastar para uma pasta move pelo caminho que já existe (Workspace:
 *   parent_id do nó; Arquivos: a função move_file com a pasta da taxonomia).
 *   No Workspace, soltar em cima de outro arquivo reordena (sort_index).
 * - "Simular" leva a imagem para a grade simulada como post planejado.
 * Nada se apaga daqui.
 */

type No = { id: string; name: string; kind: "folder" | "file"; mime: string | null; storage_path: string | null; thumb_path: string | null; parent_id: string | null; sort_index: number | null };
type Arquivo = { id: string; file_name: string; folder: string | null; mime_type: string | null; storage_bucket: string | null; storage_path: string | null; created_at: string };

const ehVideo = (mime: string | null, nome: string) => (mime ? mime.indexOf("video/") === 0 : /\.(mp4|mov|webm|m4v)$/i.test(nome || ""));

async function abrirNoNavegador(bucket: string, caminho: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(caminho, 600);
  if (!error && data && data.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
}

function CartaoDeArquivo({
  nome,
  bucket,
  caminho,
  miniatura,
  imagem,
  video,
  lista,
  arrastavel,
  onAbrir,
  onSimular,
  onArrastar,
  onSoltar,
}: {
  nome: string;
  bucket: string;
  caminho: string | null;
  miniatura: string | null;
  imagem: boolean;
  video: boolean;
  lista: boolean;
  arrastavel: boolean;
  onAbrir: () => void;
  onSimular: (() => void) | null;
  onArrastar: () => void;
  onSoltar: (() => void) | null;
}) {
  const icone = video ? <Film className="h-6 w-6" aria-hidden="true" /> : <FileText className="h-6 w-6" aria-hidden="true" />;
  const quadro = imagem && caminho ? (
    <MiniaturaDoStorage bucket={bucket} caminho={caminho} alt={nome} largura={lista ? 120 : 320} className="h-full w-full" />
  ) : miniatura ? (
    <MiniaturaDoStorage bucket={bucket} caminho={miniatura} alt={nome} largura={lista ? 120 : 320} className="h-full w-full" />
  ) : (
    <span className="flex h-full w-full items-center justify-center text-muted-foreground">{icone}</span>
  );
  const drag = {
    draggable: arrastavel,
    onDragStart: (e: DragEvent) => {
      try {
        e.dataTransfer.setData("text/plain", nome);
        e.dataTransfer.effectAllowed = "move";
      } catch {
        /* sem dataTransfer */
      }
      onArrastar();
    },
    onDragOver: onSoltar ? (e: DragEvent) => e.preventDefault() : undefined,
    onDrop: onSoltar
      ? (e: DragEvent) => {
          e.preventDefault();
          onSoltar();
        }
      : undefined,
  };
  if (lista) {
    return (
      <li className="flex min-w-0 items-center rounded-md px-1.5 py-1 hover:bg-muted" {...drag}>
        <button type="button" onClick={onAbrir} className="flex min-w-0 flex-1 items-center text-left">
          <span className="relative mr-2.5 block h-10 w-10 shrink-0 overflow-hidden rounded bg-muted">{quadro}</span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">{nome}</span>
          {!imagem && <ExternalLink className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        </button>
        {onSimular && (
          <button type="button" className={juntar(botao.discreto, "ml-1 h-7 px-2 text-[11.5px]")} onClick={onSimular}>
            <Send className="mr-1 h-3 w-3" aria-hidden="true" />
            Simular
          </button>
        )}
      </li>
    );
  }
  return (
    <li className="group min-w-0" {...drag}>
      <button type="button" onClick={onAbrir} className="relative block w-full overflow-hidden rounded-lg border border-border bg-muted hover:border-primary/60" style={{ paddingBottom: "100%" }} aria-label={`Abrir ${nome}`}>
        <span className="absolute inset-0">{quadro}</span>
        {video && <Film className="absolute right-1.5 top-1.5 h-4 w-4 text-white drop-shadow" aria-hidden="true" />}
        {imagem && <Maximize2 className="absolute right-1.5 top-1.5 h-4 w-4 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-100" aria-hidden="true" />}
      </button>
      <div className="mt-1 flex min-w-0 items-center">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground" title={nome}>
          {nome}
        </span>
        {onSimular && (
          <button type="button" className={juntar(botao.icone, "h-6 w-6")} onClick={onSimular} aria-label={`Simular ${nome} na grade`} title="Pôr na grade simulada">
            <Send className="h-3 w-3" />
          </button>
        )}
      </div>
    </li>
  );
}

export default function TelaArquivos({ onSimular }: { onSimular: (s: { bucket: string; caminho: string; nome: string }) => void }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [fonte, setFonte] = useEstadoDaTela<"workspace" | "arquivos">(`mesa:instagram:arquivos-fonte:${clientId}`, "workspace", { validar: (v) => v === "workspace" || v === "arquivos" });
  const [modo, setModo] = useEstadoDaTela<"grade" | "lista">(`mesa:instagram:arquivos-modo:${clientId}`, "grade", { validar: (v) => v === "grade" || v === "lista" });
  const [pasta, setPasta] = useState<string>("");
  const [pastaDeArquivos, setPastaDeArquivos] = useState<string | null>(null);
  const [arrastado, setArrastado] = useState<string | null>(null);
  const [movendo, setMovendo] = useState(false);
  const [ampliada, setAmpliada] = useState<{ lista: ImagemAmpliavel[]; indice: number } | null>(null);

  const nos = useQuery({
    queryKey: ["mesa", "instagram-workspace", clientId],
    enabled: fonte === "workspace",
    staleTime: 60_000,
    queryFn: async (): Promise<No[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("workspace_nodes")
        .select("id, name, kind, mime, storage_path, thumb_path, parent_id, sort_index")
        .eq("client_id", clientId)
        .order("sort_index", { ascending: true })
        .order("name", { ascending: true })
        .limit(3000);
      if (error) throw error;
      return (data || []) as No[];
    },
  });
  const arquivos = useQuery({
    queryKey: ["mesa", "instagram-arquivos", clientId],
    enabled: fonte === "arquivos",
    staleTime: 60_000,
    queryFn: async (): Promise<Arquivo[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("files")
        .select("id, file_name, folder, mime_type, storage_bucket, storage_path, created_at")
        .eq("client_id", clientId)
        .is("parent_file_id", null)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(800);
      if (error) throw error;
      return (data || []) as Arquivo[];
    },
  });

  const todos = nos.data || [];
  const porId: Record<string, No> = {};
  for (const n of todos) porId[n.id] = n;
  const trilha: No[] = [];
  let atual = pasta ? porId[pasta] : undefined;
  while (atual && trilha.length < 20) {
    trilha.unshift(atual);
    atual = atual.parent_id ? porId[atual.parent_id] : undefined;
  }
  const filhos = todos.filter((n) => (n.parent_id || "") === pasta);
  const pastas = filhos.filter((n) => n.kind === "folder");
  const arquivosDaPasta = filhos.filter((n) => n.kind === "file");

  const moverNo = async (id: string, destino: string | null) => {
    const no = porId[id];
    if (!no || (no.parent_id || null) === destino || id === destino) return;
    setMovendo(true);
    try {
      const { error } = await supabase.from("workspace_nodes").update({ parent_id: destino }).eq("id", id);
      if (error) throw error;
      toast.success(`"${no.name}" movido`);
      void queryClient.invalidateQueries({ queryKey: ["mesa", "instagram-workspace", clientId] });
      void queryClient.invalidateQueries({ queryKey: ["mesa", "workspace-arvore", clientId] });
    } catch (e) {
      toast.error("Não deu para mover", { description: textoDoErro(e) });
    } finally {
      setMovendo(false);
    }
  };
  const reordenar = async (id: string, antesDe: string) => {
    const lista = arquivosDaPasta.map((n) => n.id);
    const de = lista.indexOf(id);
    const para = lista.indexOf(antesDe);
    if (de < 0 || para < 0 || de === para) return;
    lista.splice(para, 0, lista.splice(de, 1)[0]);
    setMovendo(true);
    try {
      for (let k = 0; k < lista.length; k++) {
        if ((porId[lista[k]].sort_index ?? -1) === k) continue;
        const { error } = await supabase.from("workspace_nodes").update({ sort_index: k }).eq("id", lista[k]);
        if (error) throw error;
      }
      void queryClient.invalidateQueries({ queryKey: ["mesa", "instagram-workspace", clientId] });
    } catch (e) {
      toast.error("Não deu para reordenar", { description: textoDoErro(e) });
    } finally {
      setMovendo(false);
    }
  };

  const SEM_PASTA = "Sem pasta";
  const lista = arquivos.data || [];
  const pastasDeArquivos = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of lista) {
      const k = f.folder && f.folder.trim() ? f.folder.trim() : SEM_PASTA;
      m[k] = (m[k] || 0) + 1;
    }
    for (const f of FILE_FOLDERS) if (!m[f.id]) m[f.id] = 0;
    return Object.keys(m).sort((a, b) => a.localeCompare(b, "pt-BR")).map((k) => [k, m[k]] as [string, number]);
  }, [lista]);
  const rotuloDaPasta = (id: string) => (FILE_FOLDERS.find((f) => f.id === id) || { label: id }).label;
  const naPasta = lista.filter((f) => (f.folder && f.folder.trim() ? f.folder.trim() : SEM_PASTA) === pastaDeArquivos);
  const moverArquivo = async (id: string, pastaDestino: string) => {
    const f = lista.find((x) => x.id === id);
    if (!f || f.folder === pastaDestino || pastaDestino === SEM_PASTA) return;
    setMovendo(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("move_file", { _file_id: id, _folder: pastaDestino });
      if (error) throw error;
      if (!data) throw new Error("Nenhum arquivo foi alterado.");
      toast.success(`Movido para ${rotuloDaPasta(pastaDestino)}`);
      void queryClient.invalidateQueries({ queryKey: ["mesa", "instagram-arquivos", clientId] });
    } catch (e) {
      toast.error("Não deu para mover", { description: textoDoErro(e) });
    } finally {
      setMovendo(false);
    }
  };

  const abrirImagens = (itens: Array<{ bucket: string; caminho: string; nome: string }>, indice: number) =>
    setAmpliada({ lista: itens.map((x) => ({ caminho: x.caminho, bucket: x.bucket, titulo: x.nome })), indice });

  const Pasta = ({ nome, detalhe, onClick, onSoltar }: { nome: string; detalhe?: string; onClick: () => void; onSoltar: () => void }) => (
    <li onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onSoltar(); }}>
      {/* Pasta é item de grade (cartão com função): o cartão sólido do sistema. */}
      <button type="button" onClick={onClick} className={juntar(superficie.painel, "flex w-full min-w-0 items-center px-3 py-2.5 text-left hover:border-primary/60")}>
        <Folder className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{nome}</span>
        {detalhe && <span className="ml-2 shrink-0 text-[12px] tabular-nums text-muted-foreground">{detalhe}</span>}
      </button>
    </li>
  );
  const grade = modo === "grade" ? "grid min-w-0 grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 desk:grid-cols-7" : "min-w-0 space-y-0.5";

  return (
    <div className="min-w-0 space-y-3" data-tela-arquivos="">
      <div className="flex min-w-0 flex-wrap items-center justify-between">
        <SeletorCompacto
          rotulo="Onde procurar"
          valor={fonte}
          onEscolher={(v) => setFonte(v === "arquivos" ? "arquivos" : "workspace")}
          opcoes={[
            { valor: "workspace", rotulo: "Pastas (Workspace)" },
            { valor: "arquivos", rotulo: "Arquivos e entregas" },
          ]}
        />
        <span className="flex items-center">
          {movendo && <Loader2 className="mr-2 h-4 w-4 animate-spin text-muted-foreground" aria-label="Movendo" />}
          <button type="button" className={juntar(botao.icone, modo === "grade" ? "bg-muted text-foreground" : "")} onClick={() => setModo("grade")} aria-label="Ver em grade" aria-pressed={modo === "grade"}>
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button type="button" className={juntar(botao.icone, modo === "lista" ? "bg-muted text-foreground" : "")} onClick={() => setModo("lista")} aria-label="Ver em lista" aria-pressed={modo === "lista"}>
            <List className="h-4 w-4" />
          </button>
        </span>
      </div>

      {fonte === "workspace" && (
        <div className="min-w-0 space-y-3">
          <nav aria-label="Caminho da pasta" className="flex min-w-0 flex-wrap items-center text-[12.5px]">
            <button type="button" onClick={() => setPasta("")} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (arrastado) void moverNo(arrastado, null); }} className={pasta ? "rounded px-1 text-primary hover:underline" : "rounded px-1 font-semibold"}>
              Workspace
            </button>
            {trilha.map((p) => (
              <span key={p.id} className="flex min-w-0 items-center">
                <ChevronRight className="mx-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <button type="button" onClick={() => setPasta(p.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (arrastado) void moverNo(arrastado, p.id); }} className="min-w-0 truncate rounded px-1 hover:underline">
                  {p.name}
                </button>
              </span>
            ))}
          </nav>
          {nos.isLoading && <p className={juntar(texto.auxiliar, "flex items-center")}><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Lendo as pastas...</p>}
          {pastas.length > 0 && (
            <ul className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-3 desk:grid-cols-4">
              {pastas.map((p) => (
                <Pasta key={p.id} nome={p.name} onClick={() => setPasta(p.id)} onSoltar={() => arrastado && void moverNo(arrastado, p.id)} />
              ))}
            </ul>
          )}
          <ul className={grade}>
            {arquivosDaPasta.map((n) => {
              const imagem = ehImagem(n.mime, n.name);
              const imagens = arquivosDaPasta.filter((x) => x.storage_path && ehImagem(x.mime, x.name));
              return (
                <CartaoDeArquivo
                  key={n.id}
                  nome={n.name}
                  bucket="workspace"
                  caminho={n.storage_path}
                  miniatura={n.thumb_path}
                  imagem={imagem}
                  video={ehVideo(n.mime, n.name)}
                  lista={modo === "lista"}
                  arrastavel
                  onArrastar={() => setArrastado(n.id)}
                  onSoltar={() => arrastado && arrastado !== n.id && void reordenar(arrastado, n.id)}
                  onAbrir={() => {
                    if (!n.storage_path) return;
                    if (imagem) abrirImagens(imagens.map((x) => ({ bucket: "workspace", caminho: x.storage_path as string, nome: x.name })), Math.max(0, imagens.indexOf(n)));
                    else void abrirNoNavegador("workspace", n.storage_path);
                  }}
                  onSimular={imagem && n.storage_path ? () => onSimular({ bucket: "workspace", caminho: n.storage_path as string, nome: n.name }) : null}
                />
              );
            })}
          </ul>
          {nos.data && !pastas.length && !arquivosDaPasta.length && <p className={texto.auxiliar}>Pasta vazia.</p>}
        </div>
      )}

      {fonte === "arquivos" && (
        <div className="min-w-0 space-y-3">
          <nav aria-label="Pasta de Arquivos" className="flex min-w-0 items-center text-[12.5px]">
            <button type="button" onClick={() => setPastaDeArquivos(null)} className={pastaDeArquivos ? "rounded px-1 text-primary hover:underline" : "rounded px-1 font-semibold"}>
              Arquivos
            </button>
            {pastaDeArquivos && (
              <span className="flex min-w-0 items-center">
                <ChevronRight className="mx-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate px-1 font-medium">{rotuloDaPasta(pastaDeArquivos)}</span>
              </span>
            )}
          </nav>
          {arquivos.isLoading && <p className={juntar(texto.auxiliar, "flex items-center")}><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Lendo os arquivos...</p>}
          <ul className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-3 desk:grid-cols-4">
            {pastasDeArquivos.map(([id, n]) => (
              <Pasta key={id} nome={rotuloDaPasta(id)} detalhe={String(n)} onClick={() => setPastaDeArquivos(id)} onSoltar={() => arrastado && void moverArquivo(arrastado, id)} />
            ))}
          </ul>
          {pastaDeArquivos && (
            <ul className={grade}>
              {naPasta.map((f) => {
                const imagem = ehImagem(f.mime_type, f.file_name);
                const imagens = naPasta.filter((x) => x.storage_bucket && x.storage_path && ehImagem(x.mime_type, x.file_name));
                return (
                  <CartaoDeArquivo
                    key={f.id}
                    nome={f.file_name}
                    bucket={f.storage_bucket || "files"}
                    caminho={f.storage_path}
                    miniatura={null}
                    imagem={imagem}
                    video={ehVideo(f.mime_type, f.file_name)}
                    lista={modo === "lista"}
                    arrastavel
                    onArrastar={() => setArrastado(f.id)}
                    onSoltar={null}
                    onAbrir={() => {
                      if (!f.storage_bucket || !f.storage_path) return;
                      if (imagem) abrirImagens(imagens.map((x) => ({ bucket: x.storage_bucket as string, caminho: x.storage_path as string, nome: x.file_name })), Math.max(0, imagens.indexOf(f)));
                      else void abrirNoNavegador(f.storage_bucket, f.storage_path);
                    }}
                    onSimular={imagem && f.storage_bucket && f.storage_path ? () => onSimular({ bucket: f.storage_bucket as string, caminho: f.storage_path as string, nome: f.file_name }) : null}
                  />
                );
              })}
            </ul>
          )}
          {arquivos.data && pastaDeArquivos && !naPasta.length && <p className={texto.auxiliar}>Pasta vazia.</p>}
        </div>
      )}

      <p className={juntar(texto.auxiliar, "flex items-center")}>
        Arraste para mover
        <AjudaRecolhida className="ml-1" rotulo="Como organizar os arquivos">
          Arraste um arquivo para uma pasta para mover{fonte === "workspace" ? ", ou para cima de outro para reordenar" : ""}. Imagem abre aqui; outros arquivos abrem numa aba nova. Nada se apaga daqui.
        </AjudaRecolhida>
      </p>
      <Ampliar imagens={ampliada ? ampliada.lista : []} indice={ampliada ? ampliada.indice : null} onFechar={() => setAmpliada(null)} />
    </div>
  );
}
