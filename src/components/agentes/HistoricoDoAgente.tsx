import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArchiveRestore, FileText, History, Loader2, MessageSquarePlus, Pencil, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Carregando, JanelaCentral, botao, campo, juntar } from "@/components/sistema";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";

/**
 * Histórico dos agentes das Mesas (lote B, 09/10/2026): o mesmo jeito das
 * conversas do Gestor, na tabela que os agentes já usam (agente_conversas).
 * - lista por cliente e agente (e pela referência: trabalho, plano, site...);
 * - busca no título e no texto das mensagens;
 * - "Nova conversa" arquiva a atual (a próxima mensagem abre outra; nada é apagado);
 * - abrir uma antiga mostra as mensagens e os arquivos; "Continuar esta"
 *   volta a usá-la (a atual vai para o arquivo);
 * - renomear e arquivar.
 * A permissão é a do banco (equipe do cliente). Quem usa passa `aoTrocar`
 * para reler a conversa ativa depois de trocar.
 */

export type ChaveDaConversa = {
  clientId: string;
  /** Coluna `agente` (ex.: "contexto", "estrategista", "diretor_arte"). */
  agente: string;
  /** Coluna `referencia_tipo` (ex.: "cliente_contexto", "agente_do_mes"). */
  referenciaTipo: string;
  /** Sem filtro quando não vem; null filtra "sem referência". */
  referenciaId?: string | null;
};

type Conversa = { id: string; titulo: string | null; criado_em: string; atualizado_em: string | null; arquivada_em: string | null };
type Mensagem = { id: string; papel: string; conteudo: string; anexos: unknown; criado_em: string };
type Arquivo = { nome: string; url: string | null };

// A tabela ganhou colunas novas (titulo, atualizado_em, arquivada_em) que os tipos gerados ainda não têm.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const banco = supabase as unknown as { from: (tabela: string) => any };

const quando = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const hoje = new Date();
  return d.toDateString() === hoje.toDateString()
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: d.getFullYear() === hoje.getFullYear() ? undefined : "2-digit" });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filtrar(q: any, chave: ChaveDaConversa): any {
  let r = q.eq("client_id", chave.clientId).eq("agente", chave.agente).eq("referencia_tipo", chave.referenciaTipo);
  if (chave.referenciaId === null) r = r.is("referencia_id", null);
  else if (chave.referenciaId) r = r.eq("referencia_id", chave.referenciaId);
  return r;
}

/** Arquivos citados nos anexos das mensagens (nome + link https quando houver). */
export function arquivosDasMensagens(mensagens: Mensagem[]): Arquivo[] {
  const vistos = new Map<string, Arquivo>();
  const olhar = (x: unknown, nivel: number) => {
    if (!x || typeof x !== "object" || nivel > 3) return;
    if (Array.isArray(x)) { x.forEach((y) => olhar(y, nivel + 1)); return; }
    const o = x as Record<string, unknown>;
    const nome = typeof o.nome === "string" ? o.nome : typeof o.name === "string" ? o.name : null;
    const url = typeof o.url === "string" && /^https:\/\//.test(o.url) ? o.url : null;
    const temArquivo = !!(url || o.path || o.caminho || o.storage_path || o.file_id || o.arquivo_id);
    if (nome && temArquivo && !vistos.has(nome)) vistos.set(nome, { nome: nome.slice(0, 120), url });
    for (const v of Object.values(o)) if (v && typeof v === "object") olhar(v, nivel + 1);
  };
  mensagens.forEach((m) => olhar(m.anexos, 0));
  return [...vistos.values()].slice(0, 40);
}

/** `aoTrocar(ativa)`: a conversa que ficou ativa (null = a próxima mensagem abre outra; undefined = só arquivou uma da lista). */
export type AoTrocarConversa = (ativa: string | null | undefined) => void;

export default function HistoricoDoAgente({ chave, aoTrocar, className }: { chave: ChaveDaConversa | null; aoTrocar?: AoTrocarConversa; className?: string }) {
  const [aberto, setAberto] = useState(false);
  if (!chave || !chave.clientId) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className={juntar("flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground", className)}
        title="Histórico das conversas"
        aria-label="Histórico das conversas"
        data-historico-do-agente=""
      >
        <History className="h-4 w-4" />
      </button>
      {aberto && <JanelaDoHistorico chave={chave} aoFechar={() => setAberto(false)} aoTrocar={aoTrocar} />}
    </>
  );
}

function JanelaDoHistorico({ chave, aoFechar, aoTrocar }: { chave: ChaveDaConversa; aoFechar: () => void; aoTrocar?: AoTrocarConversa }) {
  const qc = useQueryClient();
  const base = ["historico-do-agente", chave.clientId, chave.agente, chave.referenciaTipo, chave.referenciaId ?? "*"] as const;
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  const [nome, setNome] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: [...base, "lista"],
    queryFn: async () => {
      const q = filtrar(banco.from("agente_conversas").select("id, titulo, criado_em, atualizado_em, arquivada_em"), chave);
      const { data, error } = await q.order("atualizado_em", { ascending: false, nullsFirst: false }).limit(100);
      if (error) throw error;
      return (data || []) as Conversa[];
    },
  });
  const termo = busca.trim();
  const achados = useQuery({
    queryKey: [...base, "busca", termo],
    enabled: termo.length >= 2 && !!lista.data?.length,
    queryFn: async () => {
      const ids = (lista.data || []).map((c) => c.id);
      const { data, error } = await banco.from("agente_mensagens").select("conversa_id, conteudo")
        .eq("client_id", chave.clientId).in("conversa_id", ids).ilike("conteudo", `%${termo.replace(/[%_]/g, " ")}%`).limit(200);
      if (error) throw error;
      const m = new Map<string, string>();
      for (const r of (data || []) as Array<{ conversa_id: string; conteudo: string }>) {
        if (m.has(r.conversa_id)) continue;
        const i = r.conteudo.toLowerCase().indexOf(termo.toLowerCase());
        m.set(r.conversa_id, r.conteudo.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, " "));
      }
      return m;
    },
  });
  const visiveis = useMemo(() => {
    const todas = lista.data || [];
    if (termo.length < 2) return todas;
    const t = termo.toLowerCase();
    return todas.filter((c) => (c.titulo || "").toLowerCase().includes(t) || achados.data?.has(c.id));
  }, [lista.data, termo, achados.data]);
  const ativa = (lista.data || []).find((c) => !c.arquivada_em) || null;
  const escolhida = (lista.data || []).find((c) => c.id === aberta) || null;

  const mensagens = useQuery({
    queryKey: [...base, "mensagens", aberta],
    enabled: !!aberta,
    queryFn: async () => {
      const { data, error } = await banco.from("agente_mensagens").select("id, papel, conteudo, anexos, criado_em")
        .eq("conversa_id", aberta).eq("client_id", chave.clientId).order("criado_em", { ascending: true }).limit(300);
      if (error) throw error;
      return (data || []) as Mensagem[];
    },
  });
  const arquivos = useMemo(() => arquivosDasMensagens(mensagens.data || []), [mensagens.data]);

  const recarregar = (ativa: string | null | undefined) => { void qc.invalidateQueries({ queryKey: base }); aoTrocar?.(ativa); };
  const arquivarAtivas = async (exceto?: string) => {
    let q = filtrar(banco.from("agente_conversas").update({ arquivada_em: new Date().toISOString() }), chave).is("arquivada_em", null);
    if (exceto) q = q.neq("id", exceto);
    const { error } = await q;
    if (error) throw error;
  };
  const nova = useMutation({
    mutationFn: () => arquivarAtivas(),
    onSuccess: () => { recarregar(null); toast.success("Conversa nova", { description: "A próxima mensagem abre outra conversa. A anterior fica no histórico." }); aoFechar(); },
    onError: () => toast.error("Não consegui começar outra conversa."),
  });
  const continuar = useMutation({
    mutationFn: async (id: string) => {
      await arquivarAtivas(id);
      const { error } = await banco.from("agente_conversas").update({ arquivada_em: null }).eq("id", id).eq("client_id", chave.clientId);
      if (error) throw error;
    },
    onSuccess: (_r, id) => { recarregar(id); toast.success("Conversa retomada", { description: "O próximo envio continua esta conversa." }); aoFechar(); },
    onError: () => toast.error("Não consegui retomar esta conversa."),
  });
  const arquivar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await banco.from("agente_conversas").update({ arquivada_em: new Date().toISOString() }).eq("id", id).eq("client_id", chave.clientId);
      if (error) throw error;
    },
    onSuccess: (_r, id) => { recarregar(id === ativa?.id ? null : undefined); if (id === aberta) setAberta(null); toast.success("Conversa arquivada. Nada foi apagado."); },
    onError: () => toast.error("Não consegui arquivar."),
  });
  const renomear = useMutation({
    mutationFn: async ({ id, titulo }: { id: string; titulo: string }) => {
      const { error } = await banco.from("agente_conversas").update({ titulo: titulo.slice(0, 120) }).eq("id", id).eq("client_id", chave.clientId);
      if (error) throw error;
    },
    onSuccess: () => { setNome(null); void qc.invalidateQueries({ queryKey: base }); },
    onError: () => toast.error("Não consegui renomear."),
  });

  return (
    <JanelaCentral
      aberta
      onFechar={aoFechar}
      titulo="Histórico das conversas"
      icone={<History className="h-4 w-4" />}
      descricao={lista.data ? `${lista.data.length} ${lista.data.length === 1 ? "conversa" : "conversas"}` : undefined}
      largura="xl"
      corpo="fixo"
      data-janela-do-historico=""
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
        <div className="flex min-h-0 flex-col gap-2 md:w-[300px] md:shrink-0">
          <button type="button" onClick={() => nova.mutate()} disabled={nova.isPending} className={juntar(botao.primario, "h-9 w-full")}>
            {nova.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><MessageSquarePlus className="mr-1.5 h-3.5 w-3.5" />Nova conversa</>}
          </button>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no histórico" aria-label="Buscar nas conversas do agente" className={juntar(campo, "h-8 pl-8 text-[12px]")} />
          </label>
          <div className="-mr-1 max-h-[40vh] min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 md:max-h-none">
            {lista.isLoading ? <Carregando linhas={4} rotulo="Carregando as conversas" /> : visiveis.length === 0 ? (
              <p className="px-2 py-4 text-center text-[12px] text-muted-foreground">{termo ? "Nada encontrado." : "Nenhuma conversa ainda."}</p>
            ) : visiveis.map((c) => (
              <div key={c.id} className={juntar("group relative rounded-lg", c.id === aberta ? "bg-muted" : "hover:bg-muted/50")}>
                <button type="button" onClick={() => setAberta(c.id)} className="block w-full min-w-0 px-2.5 py-2 text-left" aria-current={c.id === aberta ? "true" : undefined}>
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {c.id === ativa?.id ? <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">Atual</span> : c.arquivada_em ? <span>Arquivada</span> : null}
                    <span className="ml-auto shrink-0">{quando(c.atualizado_em || c.criado_em)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] font-medium text-foreground">{c.titulo || "Conversa sem título"}</span>
                  {termo && achados.data?.get(c.id) && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">…{achados.data.get(c.id)}…</span>}
                </button>
                {!c.arquivada_em && (
                  <button type="button" onClick={() => arquivar.mutate(c.id)} title="Arquivar" aria-label={`Arquivar ${c.titulo || "conversa"}`} className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground group-hover:flex">
                    <Archive className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-border">
          {!escolhida ? (
            <p className="m-auto px-4 py-8 text-center text-[13px] text-muted-foreground">Escolha uma conversa para ver as mensagens e os arquivos.</p>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2">
                {nome !== null ? (
                  <form className="flex min-w-0 flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); if (nome.trim()) renomear.mutate({ id: escolhida.id, titulo: nome.trim() }); }}>
                    <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} aria-label="Título da conversa" className={juntar(campo, "h-8 flex-1 text-[13px]")} />
                    <button type="submit" className={juntar(botao.primario, "h-8 px-3 text-[12px]")}>Salvar</button>
                  </form>
                ) : (
                  <>
                    <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{escolhida.titulo || "Conversa sem título"}</p>
                    <button type="button" onClick={() => setNome(escolhida.titulo || "")} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" title="Renomear" aria-label="Renomear a conversa"><Pencil className="h-3.5 w-3.5" /></button>
                    {escolhida.id !== ativa?.id && (
                      <button type="button" onClick={() => continuar.mutate(escolhida.id)} disabled={continuar.isPending} className={juntar(botao.secundario, "h-8 px-3 text-[12px]")}>
                        <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" />Continuar esta
                      </button>
                    )}
                  </>
                )}
              </div>
              {arquivos.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2" data-arquivos-da-conversa="">
                  {arquivos.map((a) => a.url ? (
                    <a key={a.nome} href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-[220px] items-center rounded-full border border-border px-2 py-0.5 text-[11px] hover:bg-muted"><FileText className="mr-1 h-3 w-3 shrink-0" /><span className="truncate">{a.nome}</span></a>
                  ) : (
                    <span key={a.nome} className="inline-flex max-w-[220px] items-center rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"><FileText className="mr-1 h-3 w-3 shrink-0" /><span className="truncate">{a.nome}</span></span>
                  ))}
                </div>
              )}
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {mensagens.isLoading ? <Carregando linhas={3} rotulo="Carregando as mensagens" /> : (mensagens.data || []).filter((m) => m.conteudo).map((m) => (
                  m.papel === "usuario" ? (
                    <div key={m.id} className="ml-8 rounded-2xl rounded-br-md bg-primary/10 px-3 py-2 text-[13px] whitespace-pre-wrap [overflow-wrap:anywhere]">{m.conteudo}</div>
                  ) : m.papel === "agente" ? (
                    <div key={m.id} className="mr-8 rounded-2xl rounded-bl-md bg-muted/60 px-3 py-2"><TextoDoAgente texto={m.conteudo} clientId={chave.clientId} /></div>
                  ) : (
                    <p key={m.id} className="text-center text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{m.conteudo}</p>
                  )
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </JanelaCentral>
  );
}
