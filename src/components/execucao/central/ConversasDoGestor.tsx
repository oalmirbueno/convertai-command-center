import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, Building2, Globe2, Loader2, Plus, Search } from "lucide-react";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { Carregando, botao, campo, juntar, useEstadoDaTela } from "@/components/sistema";
import { ROLAGEM_OPERACAO } from "@/components/execucao/CarteiraDaOperacao";

/**
 * Conversas do Gestor por cliente (Central de Autonomia, 08/10/2026): cada
 * conversa tem recorte (visão geral da Aceleriq, ou um cliente e, se quiser,
 * um projeto). Busca no título e no conteúdo, filtro por cliente, nova
 * conversa, arquivar (ocultar; nada é apagado).
 */

export type ConversaResumo = {
  id: string;
  client_id: string | null;
  project_id: string | null;
  titulo: string;
  resumo: string | null;
  cliente_nome: string | null;
  arquivada_em: string | null;
  atualizado_em: string;
};

export type OpcoesDeContexto = { clientes: Array<{ id: string; nome: string }>; projetos: Array<{ id: string; nome: string; status: string | null }> };

export const CHAVE_DAS_CONVERSAS = ["gestor-aceleriq", "conversas"] as const;

const quando = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date();
  return d.toDateString() === hoje.toDateString()
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

export function useOpcoesDeContexto(clienteId: string | null, ativo = true) {
  return useQuery({
    queryKey: ["gestor-aceleriq", "contexto", clienteId],
    enabled: ativo,
    queryFn: () => chamarFuncao<OpcoesDeContexto>("gestor-aceleriq", { acao: "opcoes_de_contexto", cliente_id: clienteId }),
    staleTime: 5 * 60_000,
  });
}

export function NovaConversa({ aoCriar, compacto = false }: { aoCriar: (c: ConversaResumo) => void; compacto?: boolean }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [cliente, setCliente] = useState<string>("");
  const [projeto, setProjeto] = useState<string>("");
  const opcoes = useOpcoesDeContexto(cliente || null);
  const criar = useMutation({
    mutationFn: () => chamarFuncao<{ conversa: ConversaResumo }>("gestor-aceleriq", { acao: "criar_conversa", cliente_id: cliente || null, projeto_id: projeto || null }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: CHAVE_DAS_CONVERSAS });
      const nome = opcoes.data?.clientes.find((c) => c.id === cliente)?.nome || null;
      aoCriar({ ...r.conversa, cliente_nome: nome });
      setAberto(false); setCliente(""); setProjeto("");
    },
    onError: (e) => toast.error(textoDoErro(e, "Não consegui criar a conversa.")),
  });
  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className={juntar(botao.primario, compacto ? "h-8 px-3 text-[12px]" : "h-9 w-full")}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />Nova conversa
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-border bg-background p-2.5" role="group" aria-label="Nova conversa">
      <label className="block text-[12px] text-muted-foreground">
        Contexto
        <select value={cliente} onChange={(e) => { setCliente(e.target.value); setProjeto(""); }} className={juntar(campo, "mt-1 h-9 text-[13px]")} aria-label="Cliente da conversa">
          <option value="">Visão geral da Aceleriq</option>
          {(opcoes.data?.clientes || []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </label>
      {cliente && (
        <label className="block text-[12px] text-muted-foreground">
          Projeto (opcional)
          <select value={projeto} onChange={(e) => setProjeto(e.target.value)} className={juntar(campo, "mt-1 h-9 text-[13px]")} aria-label="Projeto da conversa">
            <option value="">Todos os projetos</option>
            {(opcoes.data?.projetos || []).map((p) => <option key={p.id} value={p.id}>{p.nome}{p.status ? ` · ${p.status}` : ""}</option>)}
          </select>
        </label>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={() => criar.mutate()} disabled={criar.isPending} className={juntar(botao.primario, "h-8 flex-1 px-3 text-[12px]")}>
          {criar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Começar"}
        </button>
        <button type="button" onClick={() => setAberto(false)} className={juntar(botao.discreto, "h-8 px-3 text-[12px]")}>Cancelar</button>
      </div>
    </div>
  );
}

export default function ConversasDoGestor({ ativa, aoEscolher }: { ativa: string | null; aoEscolher: (c: ConversaResumo | null) => void }) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useEstadoDaTela<string>("execucao:central:filtro-conversas", "todas");
  const lista = useQuery({
    queryKey: [...CHAVE_DAS_CONVERSAS, busca.trim()],
    queryFn: async () => (await chamarFuncao<{ conversas: ConversaResumo[] }>("gestor-aceleriq", { acao: "conversas", busca: busca.trim() })).conversas || [],
    staleTime: 30_000,
  });
  const arquivar = useMutation({
    mutationFn: (id: string) => chamarFuncao("gestor-aceleriq", { acao: "atualizar_conversa", conversa_id: id, arquivar: true }),
    onSuccess: (_r, id) => { void qc.invalidateQueries({ queryKey: CHAVE_DAS_CONVERSAS }); if (id === ativa) aoEscolher(null); toast.success("Conversa arquivada."); },
    onError: (e) => toast.error(textoDoErro(e)),
  });
  const clientes = useMemo(() => {
    const m = new Map<string, string>();
    (lista.data || []).forEach((c) => { if (c.client_id && c.cliente_nome) m.set(c.client_id, c.cliente_nome); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [lista.data]);
  const visiveis = (lista.data || []).filter((c) => filtro === "todas" || (filtro === "geral" ? !c.client_id : c.client_id === filtro));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <NovaConversa aoCriar={(c) => aoEscolher(c)} />
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no histórico" aria-label="Buscar nas conversas" className={juntar(campo, "h-8 pl-8 text-[12px]")} />
      </label>
      <select value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar conversas" className={juntar(campo, "h-8 text-[12px]")}>
        <option value="todas">Todas as conversas</option>
        <option value="geral">Visão geral da Aceleriq</option>
        {clientes.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
      </select>
      <div className={juntar(ROLAGEM_OPERACAO, "-mr-1 min-h-0 flex-1 space-y-0.5 pr-1")}>
        {lista.isLoading ? <Carregando linhas={4} rotulo="Carregando as conversas" /> : visiveis.length === 0 ? (
          <p className="px-2 py-4 text-center text-[12px] text-muted-foreground">{busca ? "Nada encontrado." : "Nenhuma conversa ainda."}</p>
        ) : visiveis.map((c) => (
          <div key={c.id} className={juntar("group relative rounded-lg", c.id === ativa ? "bg-muted" : "hover:bg-muted/50")}>
            <button type="button" onClick={() => aoEscolher(c)} className="block w-full min-w-0 px-2.5 py-2 text-left" aria-current={c.id === ativa ? "true" : undefined}>
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {c.client_id ? <Building2 className="h-3 w-3 shrink-0" /> : <Globe2 className="h-3 w-3 shrink-0" />}
                <span className="truncate">{c.cliente_nome || "Visão geral"}</span>
                <span className="ml-auto shrink-0">{quando(c.atualizado_em)}</span>
              </span>
              <span className="mt-0.5 block truncate text-[13px] font-medium text-foreground">{c.titulo}</span>
            </button>
            <button type="button" onClick={() => arquivar.mutate(c.id)} title="Arquivar" aria-label={`Arquivar ${c.titulo}`} className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground group-hover:flex">
              <Archive className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
