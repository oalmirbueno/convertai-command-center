import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Briefcase, CalendarDays, ExternalLink, FileText, FolderOpen, Globe, Image as ImageIcon, Info, Kanban, LayoutGrid, Maximize2, Megaphone,
  Palette, PanelRight, PictureInPicture2, RefreshCw, Search, Sparkles, Users, Video, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveFileUrl } from "@/lib/fileUrls";
import { Carregando, EstadoDeErro, botao, campo, juntar } from "@/components/sistema";
import { atalhosDaCentral, caminhoEmbutido, enderecoExterno, type ContextoDoAtalho } from "@/lib/centralAtalhos";
import { TIPO_ARQUIVO_DO_WORKSPACE } from "@/lib/centralArrastar";
import type { ObjetoAberto } from "@/lib/centralObjetos";

/**
 * Ferramentas e navegador dentro da Central (08/10; refeito em 09/10).
 *
 * - Ferramentas (Mesas, Workspace, Kanban...): a rota do painel em modo
 *   embutido (?embutido=1 esconde a casca e o seletor de mesa/cliente), com o
 *   cliente e o projeto da conversa. Abre por padrão num pop-up interno grande
 *   (largura de computador, layout da própria mesa), ou na lateral ocupando
 *   a altura exata, ou na área maior. Nada duplicado: é a própria tela.
 * - Objetos (tarefa, memória, aprovação, arquivo...) NÃO passam por aqui:
 *   abrem na lateral nativa (ObjetoDaCentral).
 * - Arquivos do cliente: lista nativa; arrastar um arquivo para o Gestor ou o
 *   Hermes leva o arquivo (link assinado curto, pela sessão do dono).
 * - Navegador: só o que o site permite embutir; sem contornar bloqueio e sem
 *   copiar cookies, senhas ou tokens.
 */

export type ModoDaFerramenta = "popup" | "lateral" | "grande";
export type FerramentaAberta = { rotulo: string; caminho: string; modo: ModoDaFerramenta };

const ICONE: Record<string, typeof LayoutGrid> = {
  workspace: FolderOpen, arquivos: FileText, "mesa-ads": Megaphone, mesa: Sparkles, design: Palette, calendario: CalendarDays,
  projetos: Briefcase, dossie: Users, kanban: Kanban, "mesa-foto": ImageIcon, "mesa-videos": Video, crm: Users,
};

/** Grade de ferramentas (menu da Central). Clicar abre no modo padrão (pop-up). */
export function MenuDeFerramentas({ contexto, aoAbrir, aoAbrirNavegador }: { contexto: ContextoDoAtalho & { clienteNome?: string | null }; aoAbrir: (a: { rotulo: string; caminho: string }) => void; aoAbrirNavegador?: () => void }) {
  const atalhos = atalhosDaCentral(contexto);
  return (
    <div className="w-[min(92vw,360px)]">
      <p className="mb-2 px-1 text-[12px] text-muted-foreground">{contexto.clienteNome ? <>Com <span className="text-foreground">{contexto.clienteNome}</span></> : "Sem cliente na conversa"}</p>
      <div className="grid grid-cols-3 gap-1">
        {atalhos.map((a) => {
          const Icone = ICONE[a.id] || LayoutGrid;
          const semCliente = a.precisaCliente && !contexto.clientId;
          return (
            <button key={a.id} type="button" onClick={() => aoAbrir({ rotulo: a.rotulo, caminho: a.caminho })} title={semCliente ? `${a.descricao}. Abre sem cliente escolhido.` : a.descricao} className="flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-center hover:bg-muted">
              <Icone className="h-4 w-4 text-primary" aria-hidden="true" />
              <span className="w-full truncate text-[12px] font-medium">{a.rotulo}</span>
            </button>
          );
        })}
        {aoAbrirNavegador && (
          <button type="button" onClick={aoAbrirNavegador} title="Sites externos que permitem ser embutidos" className="flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-center hover:bg-muted">
            <Globe className="h-4 w-4 text-primary" aria-hidden="true" />
            <span className="w-full truncate text-[12px] font-medium">Navegador</span>
          </button>
        )}
      </div>
    </div>
  );
}

const ICONE_DO_CABECALHO = "flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground";

/** Os botões da ferramenta aberta: trocar de modo e abrir em aba nova. */
export function BotoesDaFerramenta({ ferramenta, aoMudarModo }: { ferramenta: FerramentaAberta; aoMudarModo: (m: ModoDaFerramenta) => void }) {
  return (
    <>
      <button type="button" className={ICONE_DO_CABECALHO} aria-pressed={ferramenta.modo === "lateral"} onClick={() => aoMudarModo("lateral")} aria-label="Abrir na lateral" title="Na lateral"><PanelRight className="h-3.5 w-3.5" /></button>
      <button type="button" className={ICONE_DO_CABECALHO} aria-pressed={ferramenta.modo === "popup"} onClick={() => aoMudarModo("popup")} aria-label="Abrir em pop-up" title="Em pop-up"><PictureInPicture2 className="h-3.5 w-3.5" /></button>
      <button type="button" className={ICONE_DO_CABECALHO} aria-pressed={ferramenta.modo === "grande"} onClick={() => aoMudarModo("grande")} aria-label="Abrir na área maior" title="Na área maior"><Maximize2 className="h-3.5 w-3.5" /></button>
      <a href={ferramenta.caminho} target="_blank" rel="noreferrer" className={ICONE_DO_CABECALHO} aria-label="Abrir em aba nova" title="Aba nova"><ExternalLink className="h-3.5 w-3.5" /></a>
    </>
  );
}

/**
 * A ferramenta aberta, na altura exata de quem a contém. Na lateral e na área
 * maior traz o próprio cabeçalho de uma linha; no pop-up o cabeçalho é o da
 * janela (semCabecalho), sem repetir título.
 */
export function FerramentaEmbutida({ ferramenta, clienteNome, aoMudarModo, aoFechar, semCabecalho }: { ferramenta: FerramentaAberta; clienteNome?: string | null; aoMudarModo: (m: ModoDaFerramenta) => void; aoFechar: () => void; semCabecalho?: boolean }) {
  const [versao, setVersao] = useState(0);
  const src = caminhoEmbutido(ferramenta.caminho);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-ferramenta-aberta={ferramenta.modo}>
      {!semCabecalho && (
        <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1.5">
          <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{ferramenta.rotulo}{clienteNome ? <span className="font-normal text-muted-foreground"> · {clienteNome}</span> : null}</p>
          <BotoesDaFerramenta ferramenta={ferramenta} aoMudarModo={aoMudarModo} />
          <button type="button" className={ICONE_DO_CABECALHO} onClick={() => setVersao((v) => v + 1)} aria-label="Recarregar" title="Recarregar"><RefreshCw className="h-3.5 w-3.5" /></button>
          <button type="button" className={ICONE_DO_CABECALHO} onClick={aoFechar} aria-label="Fechar a ferramenta" title="Fechar"><X className="h-4 w-4" /></button>
        </div>
      )}
      {src ? (
        <iframe key={`${src}-${versao}`} src={src} title={ferramenta.rotulo} className="block min-h-0 w-full flex-1 border-0 bg-background" />
      ) : <p className="p-3 text-[12px] text-destructive">Caminho inválido.</p>}
    </div>
  );
}

type ArquivoDoCliente = { id: string; file_name: string | null; mime_type: string | null; size_bytes: number | null; file_url: string | null; storage_bucket: string | null; storage_path: string | null; created_at: string };

const tamanho = (b?: number | null) => (!b ? "" : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Arquivos do cliente da conversa (nativo): buscar, abrir ao lado e arrastar para o Gestor ou o Hermes. */
export function ArquivosDoCliente({ clientId, aoAbrirObjeto, aoAbrirFerramenta }: { clientId: string | null; aoAbrirObjeto: (o: ObjetoAberto) => void; aoAbrirFerramenta: (rotulo: string, caminho: string) => void }) {
  const [busca, setBusca] = useState("");
  const q = useQuery({
    queryKey: ["central-autonomia", "arquivos", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await (supabase as any).from("files").select("id, file_name, mime_type, size_bytes, file_url, storage_bucket, storage_path, created_at").eq("client_id", clientId).is("archived_at", null).order("created_at", { ascending: false }).limit(60);
      if (r.error) throw new Error(r.error.message);
      return (r.data || []) as ArquivoDoCliente[];
    },
  });
  // Link assinado de cada arquivo, pedido quando a lista aparece: o arraste precisa dele na hora (o navegador não espera).
  const links = useRef(new Map<string, string>());
  useEffect(() => {
    for (const a of (q.data || []).slice(0, 30)) {
      if (links.current.has(a.id)) continue;
      void resolveFileUrl({ fileUrl: a.file_url, storageBucket: a.storage_bucket, storagePath: a.storage_path, expiresIn: 900 }).then((u) => { if (u) links.current.set(a.id, u); }).catch(() => undefined);
    }
  }, [q.data]);

  if (!clientId) return <p className="px-1 text-[12px] text-muted-foreground">Abra uma conversa de cliente para ver os arquivos dele aqui.</p>;
  if (q.isLoading) return <Carregando linhas={4} rotulo="Lendo os arquivos" />;
  if (q.isError) return <EstadoDeErro titulo="Não consegui ler os arquivos." />;
  const t = busca.trim().toLowerCase();
  const lista = (q.data || []).filter((a) => !t || String(a.file_name || "").toLowerCase().includes(t));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 gap-1.5">
        <label className="relative block min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar arquivo" aria-label="Buscar arquivo do cliente" className={juntar(campo, "h-8 pl-8 text-[12px]")} />
        </label>
        <button type="button" className={juntar(botao.secundario, "h-8 shrink-0 px-2.5 text-[12px]")} onClick={() => aoAbrirFerramenta("Workspace", `/workspace?client=${clientId}`)}>Workspace</button>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto" aria-label="Arquivos do cliente">
        {lista.length === 0 && <li className="px-1 py-2 text-[12px] text-muted-foreground">Nenhum arquivo{t ? " com esse nome" : ""}.</li>}
        {lista.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              draggable
              onDragStart={(e) => {
                const url = links.current.get(a.id);
                if (!url) { e.preventDefault(); return; }
                e.dataTransfer.effectAllowed = "copy";
                e.dataTransfer.setData(TIPO_ARQUIVO_DO_WORKSPACE, JSON.stringify({ nome: a.file_name || "arquivo", mime: a.mime_type || "application/octet-stream", url }));
                e.dataTransfer.setData("text/plain", a.file_name || "arquivo");
              }}
              onClick={() => aoAbrirObjeto({ tipo: "arquivo", id: a.id, titulo: a.file_name, client_id: clientId })}
              title="Clique para ver. Arraste para o Gestor ou o Hermes."
              className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted/60 active:cursor-grabbing"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-[12px]">{a.file_name || "arquivo"}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{tamanho(a.size_bytes)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Quadro de página externa (isolado do painel). */
function Quadro({ src, titulo }: { src: string; titulo: string }) {
  return (
    <iframe
      key={src}
      src={src}
      title={titulo}
      className="block min-h-0 w-full flex-1 rounded-xl border border-border bg-background"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
    />
  );
}

export function NavegadorIntegrado() {
  const [entrada, setEntrada] = useState("");
  const [atual, setAtual] = useState<string | null>(null);
  const [info, setInfo] = useState(false);
  const abrir = () => { const u = enderecoExterno(entrada); if (u) { setAtual(u); setEntrada(u); } };
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-2 p-2">
      <form className="flex shrink-0 items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); abrir(); }}>
        <label className="relative block min-w-0 flex-1">
          <Globe className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={entrada} onChange={(e) => setEntrada(e.target.value)} placeholder="Endereço (ex.: site do cliente)" aria-label="Endereço da página" className={juntar(campo, "h-8 pl-8 text-[12px]")} inputMode="url" />
        </label>
        <button type="submit" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")}>Abrir</button>
        {atual && <a href={atual} target="_blank" rel="noreferrer noopener" className={juntar(botao.icone, "h-8 w-8")} aria-label="Abrir em aba nova" title="Abrir em aba nova"><ExternalLink className="h-3.5 w-3.5" /></a>}
        <button type="button" onClick={() => setInfo((v) => !v)} className={juntar(botao.icone, "h-8 w-8")} aria-label="Como funciona" aria-expanded={info}><Info className="h-3.5 w-3.5" /></button>
      </form>
      {info && (
        <div className="shrink-0 rounded-lg border border-border bg-background px-3 py-2 text-[11px] leading-4 text-muted-foreground">
          Abre aqui o que o próprio site permite embutir. Instagram, Meta, Google e bancos bloqueiam isso por segurança: use a aba nova. O painel não copia cookies, senhas nem tokens. O navegador remoto (sessões por cliente, sites que bloqueiam) depende da sua aprovação de custo.
        </div>
      )}
      {atual ? <Quadro src={atual} titulo="Navegador integrado" /> : (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-[12px] text-muted-foreground">Digite um endereço para abrir ao lado da conversa.</div>
      )}
    </div>
  );
}
