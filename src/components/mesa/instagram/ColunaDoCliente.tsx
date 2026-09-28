import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronLeft, ChevronRight, ExternalLink, FileText, Folder, Image as IconeImagem, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, etiqueta, juntar, superficie, texto } from "@/components/sistema/estilos";
import { ehImagem } from "@/lib/mesa/api";
import { RAIZ, useArvoreDoWorkspace, type NoDoWorkspace } from "@/lib/mesa/pastas";
import { Ampliar, type ImagemAmpliavel } from "../Ampliar";
import { ImagemDaMesa, useMesa } from "../MesaContexto";
import { dataEHoraCurta, JanelaDaPublicacao, type PecaParaPublicar, type PublicacaoParaPublicar } from "../PublicacaoDaPeca";
import type { ItemDaGradeNaAba, PainelDoInstagram, PerfilDaAba } from "./instagramApi";

/**
 * Painel do cliente, aberto ali dentro da aba (pedido do dono, 28/09: "eu
 * clico e ele abre ali dentro, não sair dali"): resumo da empresa, próximos
 * posts, agenda do mês e pastas e arquivos, numa gaveta lateral com a escolha
 * ali mesmo. O link para a área completa fica só como opção secundária.
 */

export type ParteDoPainel = "resumo" | "proximos" | "agenda" | "arquivos";

export const PARTES_DO_PAINEL: Array<{ valor: ParteDoPainel; rotulo: string }> = [
  { valor: "resumo", rotulo: "Resumo" },
  { valor: "proximos", rotulo: "Próximos posts" },
  { valor: "agenda", rotulo: "Agenda" },
  { valor: "arquivos", rotulo: "Pastas e arquivos" },
];

export function proximosPosts(itens: ItemDaGradeNaAba[], agora = new Date(), quantos = 6): ItemDaGradeNaAba[] {
  const hoje = agora.toISOString();
  return itens
    .filter((i) => !!i.data && (i.data as string) >= hoje)
    .sort((a, b) => ((a.data as string) < (b.data as string) ? -1 : 1))
    .slice(0, quantos);
}

const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
const diaLocal = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
};

/** Semanas do mês (segunda a domingo), com null nos dias de fora. */
export function semanasDoMes(ano: number, mes: number): Array<Array<string | null>> {
  const primeiro = new Date(ano, mes, 1);
  const dias = new Date(ano, mes + 1, 0).getDate();
  const recuo = (primeiro.getDay() + 6) % 7;
  const celulas: Array<string | null> = [];
  for (let i = 0; i < recuo; i++) celulas.push(null);
  for (let d = 1; d <= dias; d++) celulas.push(`${ano}-${dois(mes + 1)}-${dois(d)}`);
  while (celulas.length % 7) celulas.push(null);
  const semanas: Array<Array<string | null>> = [];
  for (let i = 0; i < celulas.length; i += 7) semanas.push(celulas.slice(i, i + 7));
  return semanas;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className={texto.rotulo}>{rotulo}</p>
      <div className="mt-0.5 text-[13px] leading-5 text-foreground [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

function Resumo({ painel }: { painel: PainelDoInstagram }) {
  const r = painel.resumo;
  if (!r.negocio && !r.oferta && !r.publico) {
    return <p className={juntar(texto.auxiliar, "leading-5")}>Sem contexto ainda. Monte o contexto na aba Contexto para a bio, os destaques e o agente ficarem certeiros.</p>;
  }
  return (
    <div className="min-w-0 space-y-3">
      <Campo rotulo="Empresa">{r.nome}</Campo>
      {r.negocio && <Campo rotulo="O que faz">{r.negocio}</Campo>}
      {r.publico && <Campo rotulo="Público">{r.publico}</Campo>}
      {r.oferta && <Campo rotulo="Oferta">{r.oferta}</Campo>}
      {r.tom_de_voz && <Campo rotulo="Tom de voz">{r.tom_de_voz}</Campo>}
      {r.diferenciais.length > 0 && (
        <Campo rotulo="Diferenciais">
          <ul className="list-disc pl-4">
            {r.diferenciais.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </Campo>
      )}
      <Campo rotulo="Contas">
        {[...painel.contas.map((c) => `Instagram @${c.username}`), ...painel.paginas.map((p) => `Facebook ${p.nome}`)].join(" · ") || "Nenhuma conectada"}
      </Campo>
    </div>
  );
}

function Proximos({ itens, onAbrir }: { itens: ItemDaGradeNaAba[]; onAbrir: (i: ItemDaGradeNaAba) => void }) {
  const lista = proximosPosts(itens, new Date(), 20);
  const semData = itens.filter((i) => !i.data);
  const Linha = ({ i }: { i: ItemDaGradeNaAba }) => (
    <li>
      <button type="button" onClick={() => onAbrir(i)} className="flex w-full min-w-0 items-center rounded-md px-1.5 py-1.5 text-left hover:bg-muted">
        <span className="relative mr-2 block h-12 w-9 shrink-0 overflow-hidden rounded bg-muted">
          <ImagemDaMesa caminho={i.imagem ? i.imagem.caminho : null} bucket={i.imagem ? i.imagem.bucket : "mesa"} alt={i.titulo} className="absolute inset-0 h-full w-full" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-foreground">{i.titulo}</span>
          <span className="block text-[11.5px] tabular-nums text-muted-foreground">
            {i.data ? dataEHoraCurta(i.data) : "sem data"}
            {i.data && !i.data_confirmada ? " · proposta" : ""}
          </span>
        </span>
        {i.peca && <span className={juntar(etiqueta, "ml-2 bg-secondary text-muted-foreground")}>Publicar em</span>}
      </button>
    </li>
  );
  return (
    <div className="min-w-0 space-y-3">
      {lista.length ? (
        <ul className="space-y-0.5">
          {lista.map((i) => (
            <Linha key={i.id} i={i} />
          ))}
        </ul>
      ) : (
        <p className={texto.auxiliar}>Nenhum post com data daqui para a frente.</p>
      )}
      {semData.length > 0 && (
        <div className="min-w-0">
          <p className={texto.rotulo}>Sem data ({semData.length})</p>
          <ul className="mt-1 space-y-0.5">
            {semData.slice(0, 20).map((i) => (
              <Linha key={i.id} i={i} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Agenda({ itens, perfil, onAbrir }: { itens: ItemDaGradeNaAba[]; perfil: PerfilDaAba; onAbrir: (i: ItemDaGradeNaAba) => void }) {
  const hoje = new Date();
  const [mes, setMes] = useState({ ano: hoje.getFullYear(), mes: hoje.getMonth() });
  const [dia, setDia] = useState<string | null>(diaLocal(hoje.toISOString()));
  const porDia = useMemo(() => {
    const m: Record<string, { planejados: ItemDaGradeNaAba[]; publicados: PerfilDaAba["midias"] }> = {};
    for (const i of itens) {
      if (!i.data) continue;
      const k = diaLocal(i.data);
      (m[k] = m[k] || { planejados: [], publicados: [] }).planejados.push(i);
    }
    for (const p of perfil.midias) {
      if (!p.data) continue;
      const k = diaLocal(p.data);
      (m[k] = m[k] || { planejados: [], publicados: [] }).publicados.push(p);
    }
    return m;
  }, [itens, perfil.midias]);
  const semanas = semanasDoMes(mes.ano, mes.mes);
  const andar = (d: number) => setMes((m) => {
    const n = new Date(m.ano, m.mes + d, 1);
    return { ano: n.getFullYear(), mes: n.getMonth() };
  });
  const doDia = dia ? porDia[dia] : null;
  const hojeK = diaLocal(hoje.toISOString());
  return (
    <div className="min-w-0 space-y-3" data-agenda-do-painel="">
      <div className="flex items-center justify-between">
        <button type="button" className={botao.icone} onClick={() => andar(-1)} aria-label="Mês anterior">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-[13px] font-semibold text-foreground">
          {MESES[mes.mes].charAt(0).toUpperCase() + MESES[mes.mes].slice(1)} de {mes.ano}
        </p>
        <button type="button" className={botao.icone} onClick={() => andar(1)} aria-label="Próximo mês">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <table className="w-full table-fixed text-center text-[12px]">
        <thead>
          <tr className="text-muted-foreground">
            {["S", "T", "Q", "Q", "S", "S", "D"].map((d, i) => (
              <th key={i} className="pb-1 font-medium">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {semanas.map((s, i) => (
            <tr key={i}>
              {s.map((k, j) => {
                const info = k ? porDia[k] : null;
                return (
                  <td key={j} className="p-0.5">
                    {k ? (
                      <button
                        type="button"
                        onClick={() => setDia(k)}
                        aria-pressed={dia === k}
                        aria-label={`Dia ${Number(k.slice(8))}${info ? `: ${info.planejados.length} planejados, ${info.publicados.length} publicados` : ""}`}
                        className={juntar(
                          "flex h-9 w-full flex-col items-center justify-center rounded-md tabular-nums",
                          dia === k ? "bg-primary text-primary-foreground" : k === hojeK ? "border border-primary/60" : "hover:bg-muted",
                        )}
                      >
                        <span>{Number(k.slice(8))}</span>
                        <span className="flex h-1.5">
                          {info && info.planejados.length > 0 && <span className={juntar("mx-px h-1.5 w-1.5 rounded-full", dia === k ? "bg-primary-foreground" : "bg-primary")} />}
                          {info && info.publicados.length > 0 && <span className={juntar("mx-px h-1.5 w-1.5 rounded-full", dia === k ? "bg-primary-foreground/60" : "bg-muted-foreground/60")} />}
                        </span>
                      </button>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={juntar(texto.auxiliar, "flex items-center")}>
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary" /> vai ao ar
        <span className="ml-3 mr-1 inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60" /> publicado
      </p>
      <div className="min-w-0">
        <p className={texto.rotulo}>{dia ? `Dia ${dia.split("-").reverse().join("/")}` : "Escolha um dia"}</p>
        {!doDia && <p className={juntar(texto.auxiliar, "mt-1")}>Nada neste dia.</p>}
        {doDia && (
          <ul className="mt-1 space-y-1">
            {doDia.planejados.map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => onAbrir(i)} className="flex w-full min-w-0 items-center rounded-md px-1.5 py-1 text-left hover:bg-muted">
                  <span className="mr-2 text-[11.5px] tabular-nums text-muted-foreground">{i.data ? dataEHoraCurta(i.data).slice(6) : ""}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">{i.titulo}</span>
                  <span className={juntar(etiqueta, "ml-2 bg-primary/10 text-primary")}>vai ao ar</span>
                </button>
              </li>
            ))}
            {doDia.publicados.map((p) => (
              <li key={p.id}>
                <a href={p.permalink || "#"} target="_blank" rel="noreferrer" className="flex w-full min-w-0 items-center rounded-md px-1.5 py-1 hover:bg-muted">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">{p.legenda || "Post publicado"}</span>
                  <span className={juntar(etiqueta, "ml-2 bg-secondary text-muted-foreground")}>publicado</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type ArquivoDoCliente = { id: string; file_name: string; folder: string | null; mime_type: string | null; storage_bucket: string | null; storage_path: string | null; created_at: string };

async function abrirNoNavegador(bucket: string, caminho: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(caminho, 600);
  if (!error && data && data.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
}

function PastasEArquivos() {
  const { clientId } = useMesa();
  const [fonte, setFonte] = useState<"workspace" | "arquivos">("workspace");
  const [pasta, setPasta] = useState<string>(RAIZ);
  const [pastaDeArquivos, setPastaDeArquivos] = useState<string | null>(null);
  const [ampliada, setAmpliada] = useState<{ lista: ImagemAmpliavel[]; indice: number } | null>(null);
  const nos = useArvoreDoWorkspace(clientId, fonte === "workspace");
  const arquivos = useQuery({
    queryKey: ["mesa", "instagram-arquivos", clientId],
    enabled: fonte === "arquivos",
    staleTime: 60_000,
    queryFn: async (): Promise<ArquivoDoCliente[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("files")
        .select("id, file_name, folder, mime_type, storage_bucket, storage_path, created_at")
        .eq("client_id", clientId)
        .is("parent_file_id", null)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as ArquivoDoCliente[];
    },
  });

  const todos = nos.data || [];
  const porId: Record<string, NoDoWorkspace> = {};
  for (const n of todos) porId[n.id] = n;
  const trilha: NoDoWorkspace[] = [];
  let atual = pasta ? porId[pasta] : undefined;
  while (atual && trilha.length < 20) {
    trilha.unshift(atual);
    atual = atual.parent_id ? porId[atual.parent_id] : undefined;
  }
  const filhos = todos.filter((n) => (n.parent_id || RAIZ) === pasta);
  const pastas = filhos.filter((n) => n.kind === "folder");
  const arquivosDaPasta = filhos.filter((n) => n.kind === "file");

  const abrirNo = (n: NoDoWorkspace) => {
    if (!n.storage_path) return;
    if (ehImagem(n.mime, n.name)) {
      const imagens = arquivosDaPasta.filter((x) => x.storage_path && ehImagem(x.mime, x.name));
      setAmpliada({ lista: imagens.map((x) => ({ caminho: x.storage_path as string, bucket: "workspace", titulo: x.name })), indice: Math.max(0, imagens.indexOf(n)) });
    } else void abrirNoNavegador("workspace", n.storage_path);
  };

  const SEM_PASTA = "Sem pasta";
  const lista = arquivos.data || [];
  const pastasDeArquivos = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of lista) {
      const k = f.folder && f.folder.trim() ? f.folder.trim() : SEM_PASTA;
      m[k] = (m[k] || 0) + 1;
    }
    return Object.keys(m).sort((a, b) => a.localeCompare(b, "pt-BR")).map((k) => [k, m[k]] as [string, number]);
  }, [lista]);
  const naPasta = lista.filter((f) => (f.folder && f.folder.trim() ? f.folder.trim() : SEM_PASTA) === pastaDeArquivos);
  const abrirArquivo = (f: ArquivoDoCliente) => {
    if (!f.storage_bucket || !f.storage_path) return;
    if (ehImagem(f.mime_type, f.file_name)) {
      const imagens = naPasta.filter((x) => x.storage_bucket && x.storage_path && ehImagem(x.mime_type, x.file_name));
      setAmpliada({ lista: imagens.map((x) => ({ caminho: x.storage_path as string, bucket: x.storage_bucket as string, titulo: x.file_name })), indice: Math.max(0, imagens.indexOf(f)) });
    } else void abrirNoNavegador(f.storage_bucket, f.storage_path);
  };

  const LinhaDeArquivo = ({ nome, imagem, onClick }: { nome: string; imagem: boolean; onClick: () => void }) => (
    <li>
      <button type="button" onClick={onClick} className="flex w-full min-w-0 items-center rounded-md px-1.5 py-1.5 text-left text-[12.5px] hover:bg-muted">
        {imagem ? <IconeImagem className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <FileText className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">{nome}</span>
        {!imagem && <ExternalLink className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
      </button>
    </li>
  );

  return (
    <div className="min-w-0 space-y-3" data-pastas-do-painel="">
      <SeletorCompacto
        rotulo="Onde procurar"
        valor={fonte}
        onEscolher={(v) => setFonte(v === "arquivos" ? "arquivos" : "workspace")}
        opcoes={[
          { valor: "workspace", rotulo: "Pastas (Workspace)" },
          { valor: "arquivos", rotulo: "Arquivos" },
        ]}
      />
      {fonte === "workspace" && (
        <div className="min-w-0">
          <nav aria-label="Caminho da pasta" className="flex min-w-0 flex-wrap items-center text-[12px]">
            <button type="button" onClick={() => setPasta(RAIZ)} className={pasta ? "rounded px-1 text-primary hover:underline" : "rounded px-1 font-medium"}>
              Workspace
            </button>
            {trilha.map((p) => (
              <span key={p.id} className="flex min-w-0 items-center">
                <ChevronRight className="mx-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <button type="button" onClick={() => setPasta(p.id)} className="min-w-0 truncate rounded px-1 hover:underline">
                  {p.name}
                </button>
              </span>
            ))}
          </nav>
          {nos.isLoading && <p className={juntar(texto.auxiliar, "mt-2 flex items-center")}><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Lendo as pastas...</p>}
          <ul className="mt-2 space-y-0.5">
            {pastas.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setPasta(p.id)} className="flex w-full min-w-0 items-center rounded-md px-1.5 py-1.5 text-left text-[12.5px] hover:bg-muted">
                  <Folder className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
            {arquivosDaPasta.map((n) => (
              <LinhaDeArquivo key={n.id} nome={n.name} imagem={ehImagem(n.mime, n.name)} onClick={() => abrirNo(n)} />
            ))}
          </ul>
          {nos.data && !pastas.length && !arquivosDaPasta.length && <p className={juntar(texto.auxiliar, "mt-2")}>Pasta vazia.</p>}
        </div>
      )}
      {fonte === "arquivos" && (
        <div className="min-w-0">
          <nav aria-label="Pasta de Arquivos" className="flex min-w-0 items-center text-[12px]">
            <button type="button" onClick={() => setPastaDeArquivos(null)} className={pastaDeArquivos ? "rounded px-1 text-primary hover:underline" : "rounded px-1 font-medium"}>
              Arquivos
            </button>
            {pastaDeArquivos && (
              <span className="flex min-w-0 items-center">
                <ChevronRight className="mx-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate px-1 font-medium">{pastaDeArquivos}</span>
              </span>
            )}
          </nav>
          {arquivos.isLoading && <p className={juntar(texto.auxiliar, "mt-2 flex items-center")}><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Lendo os arquivos...</p>}
          <ul className="mt-2 space-y-0.5">
            {!pastaDeArquivos &&
              pastasDeArquivos.map(([nome, n]) => (
                <li key={nome}>
                  <button type="button" onClick={() => setPastaDeArquivos(nome)} className="flex w-full min-w-0 items-center rounded-md px-1.5 py-1.5 text-left text-[12.5px] hover:bg-muted">
                    <Folder className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-medium">{nome}</span>
                    <span className="ml-2 text-[11.5px] tabular-nums text-muted-foreground">{n}</span>
                  </button>
                </li>
              ))}
            {pastaDeArquivos && naPasta.map((f) => <LinhaDeArquivo key={f.id} nome={f.file_name} imagem={ehImagem(f.mime_type, f.file_name)} onClick={() => abrirArquivo(f)} />)}
          </ul>
          {arquivos.data && !lista.length && <p className={juntar(texto.auxiliar, "mt-2")}>Nenhum arquivo.</p>}
        </div>
      )}
      <p className={juntar(texto.auxiliar, "leading-5")}>Imagem abre aqui mesmo; outros arquivos abrem numa aba nova.</p>
      <Ampliar imagens={ampliada ? ampliada.lista : []} indice={ampliada ? ampliada.indice : null} onFechar={() => setAmpliada(null)} />
    </div>
  );
}

const LINK_DA_AREA: Record<ParteDoPainel, { rotulo: string; rota: (q: string) => string }> = {
  resumo: { rotulo: "Contexto completo", rota: (q) => `/mesa?${q}&aba=contexto` },
  proximos: { rotulo: "Agenda completa", rota: (q) => `/calendario?${q}` },
  agenda: { rotulo: "Agenda completa", rota: (q) => `/calendario?${q}` },
  arquivos: { rotulo: "Arquivos completos", rota: (q) => `/arquivos?${q}` },
};

export default function PainelDoCliente({
  aberto,
  parte,
  onParte,
  onFechar,
  painel,
  podePublicar,
  onMudou,
}: {
  aberto: boolean;
  parte: ParteDoPainel;
  onParte: (p: ParteDoPainel) => void;
  onFechar: () => void;
  painel: PainelDoInstagram;
  podePublicar: boolean;
  onMudou: () => void;
}) {
  const { clientId } = useMesa();
  const [publicar, setPublicar] = useState<ItemDaGradeNaAba | null>(null);
  const q = `client=${encodeURIComponent(clientId)}`;
  const link = LINK_DA_AREA[parte];
  const abrirPost = (i: ItemDaGradeNaAba) => {
    if (i.peca) setPublicar(i);
  };
  return (
    <>
      <Sheet open={aberto} onOpenChange={(v) => !v && onFechar()}>
        <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-[480px]" data-painel-do-cliente="" onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="shrink-0 border-b border-border px-4 pb-3 pt-4">
            <SheetTitle className="pr-10 text-[15px]">{painel.resumo.nome || "Cliente"}</SheetTitle>
            <SheetDescription className="sr-only">Resumo, próximos posts, agenda e arquivos do cliente, sem sair da aba.</SheetDescription>
            <div className="mt-2">
              <div role="tablist" aria-label="Parte do painel" className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
                {PARTES_DO_PAINEL.map((p) => (
                  <button
                    key={p.valor}
                    type="button"
                    role="tab"
                    aria-selected={parte === p.valor}
                    onClick={() => onParte(p.valor)}
                    className={juntar("min-w-0 truncate rounded-md px-1.5 py-1.5 text-[12px] font-medium", parte === p.valor ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                  >
                    {p.rotulo}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            {parte === "resumo" && <Resumo painel={painel} />}
            {parte === "proximos" && <Proximos itens={painel.grade.itens} onAbrir={abrirPost} />}
            {parte === "agenda" && <Agenda itens={painel.grade.itens} perfil={painel.perfil} onAbrir={abrirPost} />}
            {parte === "arquivos" && <PastasEArquivos />}
          </div>
          <div className={juntar(superficie.divisoria, "shrink-0 px-4 py-2")}>
            <Link to={link.rota(q)} className="inline-flex items-center text-[12px] text-muted-foreground hover:text-foreground">
              {link.rotulo}
              <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </SheetContent>
      </Sheet>
      {publicar && publicar.peca && (
        <JanelaDaPublicacao
          aberta={!!publicar}
          onFechar={() => setPublicar(null)}
          titulo={publicar.titulo}
          clientId={clientId}
          diaDaPeca={publicar.dia_da_peca}
          peca={publicar.peca as unknown as PecaParaPublicar}
          publicacao={(publicar.publicacao as unknown as PublicacaoParaPublicar) || null}
          podePublicar={podePublicar}
          onMudou={onMudou}
        />
      )}
    </>
  );
}
