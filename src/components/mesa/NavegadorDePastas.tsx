import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Folder, HardDrive, Images, Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useResolvedFileUrl } from "@/lib/fileUrls";
import { ehImagem, rotuloDaCategoria } from "@/lib/mesa/api";
import {
  imagensDoWorkspace,
  montarArvore,
  pastasDoWorkspace,
  RAIZ,
  trilhaAte,
  useArvoreDoWorkspace,
  type NoDoWorkspace,
  type PastaDoExplorador,
} from "@/lib/mesa/pastas";
import { MiniaturaDoStorage } from "./ContextoMiniatura";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { useAcervo, type ImagemDoAcervo } from "./contextoDoCliente";

/**
 * Navegador de pastas da Mesa: escolhe uma imagem do cliente em qualquer
 * pasta do Workspace (a mesma árvore de lá, com trilha, Voltar e árvore ao
 * lado), de Arquivos ou do acervo de fotos reais. Só mostra
 * imagens. Quem chama decide o que fazer com a escolha (ex.: definir_logo).
 */

export type { PastaDoExplorador };

export type OrigemDaImagem = "workspace" | "arquivo" | "acervo";

export interface ImagemEscolhida {
  origem: OrigemDaImagem;
  id: string;
  nome: string;
}

/** Caixa quadrada sem aspect-ratio (Safari 11): o padding reserva a altura. */
export function Quadrado({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative w-full overflow-hidden rounded-lg bg-muted ${className}`} style={{ paddingTop: "100%" }}>
      <div className="absolute inset-0">{children}</div>
    </div>
  );
}


interface ArquivoDePasta {
  id: string;
  file_name: string;
  folder: string | null;
  mime_type: string | null;
  file_url: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
}

function MiniaturaDeArquivo({ arquivo }: { arquivo: ArquivoDePasta }) {
  const { url, error } = useResolvedFileUrl({
    fileUrl: arquivo.file_url,
    storageBucket: arquivo.storage_bucket,
    storagePath: arquivo.storage_path,
    transform: { width: 240, height: 240, resize: "contain" },
  });
  if (error) return <div className="flex h-full w-full items-center justify-center text-[10.5px] text-muted-foreground">indisponível</div>;
  if (!url) return <div className="h-full w-full animate-pulse bg-muted" />;
  return <img src={url} alt={arquivo.file_name} loading="lazy" className="h-full w-full object-contain p-1" />;
}

function CartaoDeImagem({
  nome,
  detalhe,
  marcado,
  ocupado,
  onClick,
  children,
}: {
  nome: string;
  detalhe?: string | null;
  marcado?: boolean;
  ocupado?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={ocupado}
      title={nome}
      className={`relative min-w-0 rounded-xl border bg-card p-1.5 text-left transition-colors disabled:opacity-60 ${
        marcado ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/60"
      }`}
    >
      <Quadrado>{children}</Quadrado>
      <span className="mt-1 block truncate text-[11.5px] text-foreground">{nome}</span>
      {detalhe && <span className="block truncate text-[10.5px] text-muted-foreground">{detalhe}</span>}
      {marcado && <Check className="absolute right-2 top-2 h-5 w-5 rounded-full bg-primary p-0.5 text-primary-foreground" />}
    </button>
  );
}

function Grade({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">{children}</div>;
}

function LinhaDePasta({ nome, detalhe, onClick }: { nome: string; detalhe?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 items-center rounded-lg border border-border bg-card px-3 py-2 text-left hover:border-primary/50"
    >
      <Folder className="mr-2 h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate text-[12.5px]">{nome}</span>
      {detalhe && <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{detalhe}</span>}
      <ChevronRight className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function Carregando({ texto }: { texto: string }) {
  return (
    <p className="flex items-center text-[12px] text-muted-foreground">
      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> {texto}
    </p>
  );
}

// ------------------------------------------------------------------ explorador

/**
 * Explorador de pastas reutilizável da Mesa: trilha (breadcrumb), botão
 * Voltar, subpastas com a contagem de imagens (a pasta e tudo abaixo dela),
 * árvore ao lado em telas largas e a grade de itens da pasta aberta. Cada
 * painel rola sozinho. Pastas sem nenhuma imagem na subárvore ficam ocultas.
 */
export function ExploradorDePastas<T>({
  pastas,
  itens,
  pastaDoItem,
  renderizarItens,
  raizNome = "Workspace",
  atual: atualControlado,
  onAtual,
  carregando,
  erro,
  vazio = "Nenhuma imagem nesta pasta.",
  alturaMax = "min(60vh, 520px)",
  semArvore,
}: {
  pastas: PastaDoExplorador[];
  itens: T[];
  /** Id da pasta do item (RAIZ = "" para o primeiro nível). */
  pastaDoItem: (item: T) => string;
  renderizarItens: (itens: T[]) => ReactNode;
  raizNome?: string;
  atual?: string;
  onAtual?: (id: string) => void;
  carregando?: boolean;
  erro?: string | null;
  vazio?: string;
  alturaMax?: string;
  /** Sem a árvore lateral (painéis estreitos). */
  semArvore?: boolean;
}) {
  const [atualInterno, setAtualInterno] = useState(RAIZ);
  const [abertas, setAbertas] = useState<Record<string, boolean>>({});

  const itensPorPasta: Record<string, T[]> = {};
  for (const item of itens) {
    const p = pastaDoItem(item) || RAIZ;
    (itensPorPasta[p] = itensPorPasta[p] || []).push(item);
  }
  const diretos: Record<string, number> = {};
  for (const k of Object.keys(itensPorPasta)) diretos[k] = itensPorPasta[k].length;
  const arvore = montarArvore(pastas, diretos);

  const pedido = atualControlado !== undefined ? atualControlado : atualInterno;
  const atual = pedido === RAIZ || arvore.porId[pedido] ? pedido : RAIZ;
  const irPara = (id: string) => {
    setAtualInterno(id);
    if (onAtual) onAtual(id);
  };

  const trilha = trilhaAte(arvore, atual);
  const naTrilha = (id: string) => trilha.some((p) => p.id === id);
  const visiveis = (id: string) => (arvore.filhos[id] || []).filter((p) => (arvore.total[p.id] || 0) > 0);
  const subpastas = visiveis(atual);
  const itensAqui = itensPorPasta[atual] || [];
  const pai = trilha.length > 1 ? trilha[trilha.length - 2].id : RAIZ;
  const temArvore = !semArvore && visiveis(RAIZ).length > 0;

  const ramo = (id: string, nivel: number): ReactNode => (
    <ul className="min-w-0">
      {visiveis(id).map((p) => {
        const filhos = visiveis(p.id);
        const aberta = abertas[p.id] !== undefined ? abertas[p.id] : naTrilha(p.id);
        return (
          <li key={p.id} className="min-w-0">
            <div
              className={`flex min-w-0 items-center rounded-md text-[12px] ${p.id === atual ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              style={{ paddingLeft: nivel * 12 }}
            >
              {filhos.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setAbertas((a) => ({ ...a, [p.id]: !aberta }))}
                  aria-label={aberta ? `Recolher ${p.nome}` : `Expandir ${p.nome}`}
                  className="flex h-6 w-5 shrink-0 items-center justify-center"
                >
                  <ChevronRight className={`h-3.5 w-3.5 transition-transform ${aberta ? "rotate-90" : ""}`} />
                </button>
              ) : (
                <span className="w-5 shrink-0" />
              )}
              <button
                type="button"
                onClick={() => irPara(p.id)}
                aria-current={p.id === atual ? "true" : undefined}
                className="flex min-w-0 flex-1 items-center py-1 pr-1.5 text-left"
                title={p.nome}
              >
                <Folder className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary/80" />
                <span className="min-w-0 flex-1 truncate">{p.nome}</span>
                <span className="ml-1 shrink-0 text-[10.5px] tabular-nums text-muted-foreground">{arvore.total[p.id] || 0}</span>
              </button>
            </div>
            {aberta && filhos.length > 0 && ramo(p.id, nivel + 1)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-2 flex min-w-0 items-center">
        <button
          type="button"
          onClick={() => irPara(pai)}
          disabled={atual === RAIZ}
          className="mr-2 inline-flex h-7 shrink-0 items-center rounded-md border border-border bg-card px-2 text-[11.5px] font-medium text-foreground transition-colors hover:border-primary/50 disabled:opacity-40"
        >
          <ChevronLeft className="mr-0.5 h-3.5 w-3.5" /> Voltar
        </button>
        <nav aria-label="Trilha das pastas" className="flex min-w-0 flex-1 flex-wrap items-center text-[12px]">
          <button
            type="button"
            onClick={() => irPara(RAIZ)}
            className={`rounded px-1 ${atual !== RAIZ ? "text-primary hover:underline" : "font-medium text-foreground"}`}
          >
            {raizNome}
          </button>
          {trilha.map((p, i) => (
            <span key={p.id} className="flex min-w-0 items-center">
              <ChevronRight className="mx-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <button
                type="button"
                onClick={() => irPara(p.id)}
                className={`min-w-0 max-w-[12rem] truncate rounded px-1 ${i === trilha.length - 1 ? "font-medium text-foreground" : "text-primary hover:underline"}`}
              >
                {p.nome}
              </button>
            </span>
          ))}
        </nav>
      </div>

      <div className="flex min-w-0">
        {temArvore && (
          <aside aria-label="Árvore de pastas" className="mr-3 hidden w-52 shrink-0 overflow-y-auto border-r border-border pr-2 md:block" style={{ maxHeight: alturaMax }}>
            <button
              type="button"
              onClick={() => irPara(RAIZ)}
              className={`mb-0.5 flex w-full items-center rounded-md px-1.5 py-1 text-left text-[12px] ${atual === RAIZ ? "bg-primary/10 font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <HardDrive className="mr-1.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{raizNome}</span>
              <span className="ml-1 shrink-0 text-[10.5px] tabular-nums text-muted-foreground">{arvore.total[RAIZ] || 0}</span>
            </button>
            {ramo(RAIZ, 0)}
          </aside>
        )}
        <div className="min-w-0 flex-1 space-y-3 overflow-y-auto pr-0.5" style={{ maxHeight: alturaMax }}>
          {carregando && <Carregando texto="Lendo as pastas..." />}
          {erro && <p className="text-[12px] text-destructive">{erro}</p>}
          {subpastas.length > 0 && (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {subpastas.map((p) => {
                const n = arvore.total[p.id] || 0;
                return <LinhaDePasta key={p.id} nome={p.nome} detalhe={`${n} ${n === 1 ? "imagem" : "imagens"}`} onClick={() => irPara(p.id)} />;
              })}
            </div>
          )}
          {itensAqui.length > 0 && renderizarItens(itensAqui)}
          {!carregando && !erro && subpastas.length === 0 && itensAqui.length === 0 && (
            <p className="rounded-lg border border-dashed border-border bg-card p-4 text-center text-[12px] text-muted-foreground">{vazio}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ workspace

function PastasDoWorkspace({ onEscolher, marcadoId, ocupado }: { onEscolher: (e: ImagemEscolhida) => void; marcadoId?: string | null; ocupado?: boolean }) {
  const { clientId } = useMesa();
  const nos = useArvoreDoWorkspace(clientId);
  const todos = nos.data || [];
  const imagens = imagensDoWorkspace(todos);
  const outros = todos.filter((n) => n.kind === "file").length - imagens.length;

  return (
    <div className="min-w-0 space-y-2">
      <ExploradorDePastas<NoDoWorkspace>
        pastas={pastasDoWorkspace(todos)}
        itens={imagens}
        pastaDoItem={(n) => n.parent_id || RAIZ}
        carregando={nos.isLoading}
        erro={nos.isError ? "Não foi possível ler o Workspace." : null}
        vazio={nos.data && imagens.length === 0 ? "Nenhuma imagem no Workspace deste cliente." : "Nenhuma imagem nesta pasta."}
        alturaMax="min(56vh, 480px)"
        renderizarItens={(lista) => (
          <Grade>
            {lista.map((n) => (
              <CartaoDeImagem
                key={n.id}
                nome={n.name}
                marcado={marcadoId === n.id}
                ocupado={ocupado}
                onClick={() => onEscolher({ origem: "workspace", id: n.id, nome: n.name })}
              >
                <MiniaturaDoStorage bucket="workspace" caminho={n.storage_path} alt={n.name} ajuste="contain" largura={240} className="h-full w-full p-1" />
              </CartaoDeImagem>
            ))}
          </Grade>
        )}
      />
      {outros > 0 && <p className="text-[11px] text-muted-foreground">{outros} arquivo(s) que não são imagem ficaram de fora.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ arquivos

function PastasDeArquivos({ onEscolher, marcadoId, ocupado }: { onEscolher: (e: ImagemEscolhida) => void; marcadoId?: string | null; ocupado?: boolean }) {
  const { clientId } = useMesa();
  const [pasta, setPasta] = useState<string | null>(null);

  const arquivos = useQuery({
    queryKey: ["mesa", "navegador-arquivos", clientId],
    staleTime: 60_000,
    queryFn: async (): Promise<ArquivoDePasta[]> => {
      const { data, error } = await (supabase as any)
        .from("files")
        .select("id, file_name, folder, mime_type, file_url, storage_bucket, storage_path, created_at")
        .eq("client_id", clientId)
        .is("parent_file_id", null)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(1500);
      if (error) throw error;
      return ((data || []) as ArquivoDePasta[]).filter((f) => ehImagem(f.mime_type, f.file_name));
    },
  });

  const SEM_PASTA = "Sem pasta";
  const pastas = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const f of arquivos.data || []) {
      const nome = f.folder && f.folder.trim() ? f.folder.trim() : SEM_PASTA;
      contagem.set(nome, (contagem.get(nome) || 0) + 1);
    }
    return Array.from(contagem.entries()).sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  }, [arquivos.data]);

  const naPasta = (arquivos.data || []).filter((f) => (f.folder && f.folder.trim() ? f.folder.trim() : SEM_PASTA) === pasta);

  return (
    <div className="min-w-0 space-y-3">
      <nav aria-label="Pastas de Arquivos" className="flex min-w-0 flex-wrap items-center text-[12px]">
        <button type="button" onClick={() => setPasta(null)} className={`rounded px-1 ${pasta ? "text-primary hover:underline" : "font-medium text-foreground"}`}>
          Arquivos
        </button>
        {pasta && (
          <span className="flex min-w-0 items-center">
            <ChevronRight className="mx-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate px-1 font-medium">{pasta}</span>
          </span>
        )}
      </nav>
      {arquivos.isLoading && <Carregando texto="Lendo as pastas de Arquivos..." />}
      {arquivos.isError && <p className="text-[12px] text-destructive">Não foi possível ler Arquivos.</p>}
      {!pasta && pastas.length > 0 && (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {pastas.map(([nome, n]) => (
            <LinhaDePasta key={nome} nome={nome} detalhe={`${n} ${n === 1 ? "imagem" : "imagens"}`} onClick={() => setPasta(nome)} />
          ))}
        </div>
      )}
      {pasta && (
        <Grade>
          {naPasta.map((f) => (
            <CartaoDeImagem
              key={f.id}
              nome={f.file_name}
              marcado={marcadoId === f.id}
              ocupado={ocupado}
              onClick={() => onEscolher({ origem: "arquivo", id: f.id, nome: f.file_name })}
            >
              <MiniaturaDeArquivo arquivo={f} />
            </CartaoDeImagem>
          ))}
        </Grade>
      )}
      {arquivos.data && pastas.length === 0 && (
        <p className="rounded-lg border border-dashed border-border bg-card p-4 text-center text-[12px] text-muted-foreground">Nenhuma imagem em Arquivos.</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ acervo

function ImagensDoAcervo({ onEscolher, marcadoId, ocupado }: { onEscolher: (e: ImagemEscolhida) => void; marcadoId?: string | null; ocupado?: boolean }) {
  const { clientId } = useMesa();
  const acervo = useAcervo(clientId);
  const [busca, setBusca] = useState("");
  const termo = busca.trim().toLowerCase();

  const grupos = useMemo(() => {
    const ativas = (acervo.data || []).filter((i) => i.ativa);
    const filtradas = termo
      ? ativas.filter((i) => `${i.nome} ${i.pasta || ""} ${i.descricao || ""} ${(i.tags || []).join(" ")}`.toLowerCase().indexOf(termo) >= 0)
      : ativas;
    const m = new Map<string, ImagemDoAcervo[]>();
    for (const i of filtradas) {
      const k = i.categoria || "";
      const lista = m.get(k) || [];
      lista.push(i);
      m.set(k, lista);
    }
    // Logo primeiro (o uso mais comum aqui), depois as outras categorias.
    return Array.from(m.entries()).sort((a, b) => (a[0] === "logo" ? -1 : b[0] === "logo" ? 1 : a[0].localeCompare(b[0])));
  }, [acervo.data, termo]);

  return (
    <div className="min-w-0 space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no acervo" className="h-9 pl-8" />
      </div>
      {acervo.isLoading && <Carregando texto="Lendo o acervo..." />}
      {acervo.isError && <p className="text-[12px] text-destructive">Não foi possível ler o acervo.</p>}
      {grupos.map(([categoria, imagens]) => (
        <section key={categoria || "sem"} className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {rotuloDaCategoria(categoria)} ({imagens.length})
          </p>
          <Grade>
            {imagens.map((i) => (
              <CartaoDeImagem
                key={i.id}
                nome={i.nome}
                detalhe={i.pasta}
                marcado={marcadoId === i.id}
                ocupado={ocupado}
                onClick={() => onEscolher({ origem: "acervo", id: i.id, nome: i.nome })}
              >
                <ImagemDaMesa caminho={i.storage_path} bucket={i.storage_bucket} alt={i.nome} className="h-full w-full !object-contain p-1" />
              </CartaoDeImagem>
            ))}
          </Grade>
        </section>
      ))}
      {acervo.data && grupos.length === 0 && (
        <p className="rounded-lg border border-dashed border-border bg-card p-4 text-center text-[12px] text-muted-foreground">
          {termo ? "Nada no acervo com essa busca." : "O acervo ainda está vazio. Busque as imagens na seção Imagens do contexto."}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ janela

const FONTES: { valor: OrigemDaImagem; rotulo: string; icone: typeof Folder }[] = [
  { valor: "workspace", rotulo: "Workspace", icone: HardDrive },
  { valor: "arquivo", rotulo: "Arquivos", icone: Folder },
  { valor: "acervo", rotulo: "Acervo", icone: Images },
];

export default function NavegadorDePastas({
  aberto,
  onOpenChange,
  titulo,
  descricao,
  onEscolher,
  ocupado,
  marcadoId,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  titulo: string;
  descricao?: string;
  onEscolher: (escolha: ImagemEscolhida) => void;
  ocupado?: boolean;
  marcadoId?: string | null;
}) {
  const [fonte, setFonte] = useState<OrigemDaImagem>("workspace");
  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-3xl flex-col overflow-hidden bg-background">
        <DialogHeader className="text-left">
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            {descricao || "Navegue pelas pastas do Workspace, de Arquivos ou pelo acervo e clique na imagem."}
          </DialogDescription>
        </DialogHeader>
        <div role="tablist" aria-label="Onde procurar" className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
          {FONTES.map((f) => {
            const Icone = f.icone;
            return (
              <button
                key={f.valor}
                type="button"
                role="tab"
                aria-selected={fonte === f.valor}
                onClick={() => setFonte(f.valor)}
                className={`flex min-w-0 items-center justify-center rounded-lg px-2 py-1.5 text-[12.5px] font-medium ${
                  fonte === f.valor ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icone className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{f.rotulo}</span>
              </button>
            );
          })}
        </div>
        <div className="-mx-1 min-h-[240px] flex-1 overflow-y-auto px-1 pb-1">
          {ocupado && <Carregando texto="Guardando a escolha..." />}
          {fonte === "workspace" && <PastasDoWorkspace onEscolher={onEscolher} marcadoId={marcadoId} ocupado={ocupado} />}
          {fonte === "arquivo" && <PastasDeArquivos onEscolher={onEscolher} marcadoId={marcadoId} ocupado={ocupado} />}
          {fonte === "acervo" && <ImagensDoAcervo onEscolher={onEscolher} marcadoId={marcadoId} ocupado={ocupado} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
