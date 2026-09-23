import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  chamarFuncao,
  modeloNovo,
  nomeDoModelo,
  nomeDoProvedor,
  PAPEIS,
  precoDoModelo,
  textoDoErro,
  type ModeloIa,
} from "@/lib/mesa/api";

/**
 * Modelos de IA (só admin). O catálogo chega sozinho do OpenRouter e da
 * OpenAI (ação sincronizar_catalogo do ia-gateway); aqui o dono liga o que
 * quer usar e escolhe o padrão de cada papel. A escrita em ia_modelos é
 * direta na tabela: a RLS só deixa o admin gravar.
 */

const POR_PAGINA = 40;

/**
 * Os papéis na ordem em que a Mesa trabalha. "contexto" é o agente que monta
 * e conversa sobre o contexto do cliente (papel novo no banco em 23/09).
 */
const PAPEIS_DA_TELA: { valor: string; rotulo: string; dica: string; tipo: "texto" | "imagem" }[] = [
  { valor: "estrategista", rotulo: "Estratégia", dica: "Propõe temas, detalha e completa a agenda.", tipo: "texto" },
  { valor: "diretor_arte", rotulo: "Diretor de arte", dica: "Dirige cada lâmina e confere a arte.", tipo: "texto" },
  { valor: "imagem", rotulo: "Gerador de imagem", dica: "Pinta as lâminas.", tipo: "imagem" },
  { valor: "leitura", rotulo: "Leitura de imagem", dica: "Lê referências e organiza o acervo.", tipo: "texto" },
  { valor: "contexto", rotulo: "Agente de contexto", dica: "Monta o contexto e conversa sobre a marca.", tipo: "texto" },
];

const rotuloDoPapel = (p: string) =>
  (PAPEIS_DA_TELA.find((x) => x.valor === p) || PAPEIS.find((x) => x.valor === p) || { rotulo: p }).rotulo;


/**
 * O ia-gateway devolve { ok, openrouter: { novos, ... } | { erro }, openai,
 * anthropic }: a contagem mora em cada provedor, não na raiz. Lida só na raiz,
 * a contagem nunca aparecia e ok:false virava "Catálogo conferido".
 */
export function resumoDaSincronizacao(data: any): { falhou: boolean; erro: string | null; novos: number | null } {
  const d = data && typeof data === "object" ? data : {};
  const erroDoOpenRouter = d.openrouter && typeof d.openrouter.erro === "string" ? String(d.openrouter.erro) : null;
  if (d.ok === false) return { falhou: true, erro: erroDoOpenRouter, novos: null };
  let novos: number | null = null;
  const somar = (v: unknown) => {
    const n = Number(v);
    if (v !== undefined && v !== null && v !== "" && isFinite(n)) novos = (novos || 0) + n;
  };
  somar(d.novos ?? d.inseridos);
  for (const p of ["openrouter", "openai", "anthropic"]) {
    const x = d[p];
    if (x && typeof x === "object") somar(x.novos);
  }
  return { falhou: false, erro: null, novos };
}

export default function ModelosDeIa({ aberto, onOpenChange }: { aberto: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState<"todos" | "texto" | "imagem">("todos");
  const [provedor, setProvedor] = useState("todos");
  const [situacao, setSituacao] = useState<"todos" | "ativos" | "novos">("todos");
  const [limite, setLimite] = useState(POR_PAGINA);
  const [sincronizando, setSincronizando] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);

  const catalogo = useQuery({
    queryKey: ["mesa", "catalogo-completo"],
    enabled: aberto,
    queryFn: async (): Promise<ModeloIa[]> => {
      const { data, error } = await (supabase as any).from("ia_modelos").select("*").order("tipo").order("provedor").order("id");
      if (error) throw error;
      return (data || []) as ModeloIa[];
    },
  });

  const atualizar = () => {
    void queryClient.invalidateQueries({ queryKey: ["mesa", "catalogo-completo"] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "catalogo"] });
  };

  const modelos = catalogo.data || [];
  const provedores = useMemo(() => Array.from(new Set(modelos.map((m) => m.provedor))).sort(), [modelos]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const agora = Date.now();
    return modelos
      .filter((m) => tipo === "todos" || m.tipo === tipo)
      .filter((m) => provedor === "todos" || m.provedor === provedor)
      .filter((m) => situacao === "todos" || (situacao === "ativos" ? m.ativo : modeloNovo(m, agora)))
      .filter((m) => !termo || `${m.id} ${m.rotulo || ""} ${m.modelo_api}`.toLowerCase().indexOf(termo) >= 0)
      .sort((a, b) => Number(b.ativo) - Number(a.ativo) || Number(modeloNovo(b, agora)) - Number(modeloNovo(a, agora)) || nomeDoModelo(a).localeCompare(nomeDoModelo(b)));
  }, [modelos, busca, tipo, provedor, situacao]);

  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const data = await chamarFuncao<any>("ia-gateway", { acao: "sincronizar_catalogo" });
      const r = resumoDaSincronizacao(data);
      if (r.falhou) {
        toast.error("O catálogo não foi conferido", { description: r.erro || "O OpenRouter não respondeu. Tente de novo em instantes." });
      } else {
        toast.success("Catálogo conferido", {
          description: r.novos !== null ? `${r.novos} modelo(s) novo(s) chegaram.` : "Os modelos dos provedores foram conferidos.",
        });
      }
      atualizar();
    } catch (e) {
      toast.error("Não foi possível buscar modelos", { description: textoDoErro(e) });
    } finally {
      setSincronizando(false);
    }
  };

  const alternarAtivo = async (m: ModeloIa, ativo: boolean) => {
    setSalvando(m.id);
    try {
      const { error } = await (supabase as any).from("ia_modelos").update({ ativo }).eq("id", m.id);
      if (error) throw error;
      if (!ativo && (m.padrao_para || []).length > 0) {
        toast.warning("Modelo desligado era padrão de algum papel", { description: "Escolha outro padrão acima." });
      }
      atualizar();
    } catch (e) {
      toast.error("Não foi possível salvar", { description: textoDoErro(e) });
    } finally {
      setSalvando(null);
    }
  };

  /** Um padrão por papel: tira o papel dos outros e põe no escolhido. */
  const definirPadrao = async (papel: string, modeloId: string) => {
    setSalvando(`padrao-${papel}`);
    try {
      // Primeiro o novo padrão, depois tira dos antigos: se algo falhar no
      // meio, o papel fica com dois padrões por um instante, nunca sem nenhum.
      const alvo = modelos.find((m) => m.id === modeloId);
      const lista = (alvo?.padrao_para || []).filter((p) => p !== papel).concat([papel]);
      const { error } = await (supabase as any).from("ia_modelos").update({ padrao_para: lista }).eq("id", modeloId);
      if (error) throw error;
      const antigos = modelos.filter((m) => m.id !== modeloId && (m.padrao_para || []).indexOf(papel) >= 0);
      for (const m of antigos) {
        const { error: erroAntigo } = await (supabase as any)
          .from("ia_modelos")
          .update({ padrao_para: (m.padrao_para || []).filter((p) => p !== papel) })
          .eq("id", m.id);
        if (erroAntigo) throw erroAntigo;
      }
      toast.success("Padrão salvo");
      atualizar();
    } catch (e) {
      toast.error("Não foi possível salvar o padrão", { description: textoDoErro(e) });
    } finally {
      setSalvando(null);
    }
  };

  return (
    <Sheet open={aberto} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center"><Sparkles className="mr-2 h-4 w-4" /> Modelos de IA</SheetTitle>
          <SheetDescription>O catálogo chega sozinho dos provedores. Ligue o que a equipe pode usar e escolha o padrão de cada papel.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-wrap items-center">
          <Button type="button" size="sm" variant="outline" className="mr-2" onClick={() => void sincronizar()} disabled={sincronizando}>
            {sincronizando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            Buscar modelos novos agora
          </Button>
          <span className="text-[11.5px] text-muted-foreground">{modelos.filter((m) => m.ativo).length} ativos de {modelos.length}</span>
        </div>

        <section className="mt-4 rounded-xl border border-border bg-card">
          <div className="border-b border-border px-3.5 py-2.5">
            <p className="text-[13px] font-medium">Padrão por papel</p>
            <p className="text-[11.5px] text-muted-foreground">O modelo que cada agente usa quando a tela não pede outro.</p>
          </div>
          <ul className="divide-y divide-border">
            {PAPEIS_DA_TELA.map((papel) => {
              const opcoes = modelos.filter((m) => m.ativo && m.tipo === papel.tipo);
              const atual = modelos.find((m) => (m.padrao_para || []).indexOf(papel.valor) >= 0) || null;
              return (
                <li key={papel.valor} className="grid grid-cols-1 items-center gap-2 px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-medium">{papel.rotulo}</p>
                    <p className="text-[11px] leading-snug text-muted-foreground">{papel.dica}</p>
                    <p className="mt-0.5 text-[11px] leading-snug [overflow-wrap:anywhere]">
                      {atual ? (
                        <span className={atual.ativo ? "text-foreground" : "text-destructive"}>
                          Atual: {nomeDoModelo(atual)}{atual.ativo ? "" : " (desligado)"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Sem padrão: {papel.valor === "contexto" ? "usa o da estratégia" : "usa o primeiro modelo ativo"}</span>
                      )}
                    </p>
                  </div>
                  <Select
                    value={atual?.id || ""}
                    onValueChange={(v) => void definirPadrao(papel.valor, v)}
                    disabled={salvando === `padrao-${papel.valor}` || opcoes.length === 0}
                  >
                    <SelectTrigger className="h-9 min-w-0 text-[12.5px]">
                      <SelectValue placeholder={opcoes.length ? "Trocar o modelo" : "Nenhum modelo ativo deste tipo"} />
                    </SelectTrigger>
                    <SelectContent>
                      {opcoes.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{nomeDoModelo(m)} · {precoDoModelo(m)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              );
            })}
          </ul>
        </section>

        <p className="mb-1 mt-6 text-[13px] font-medium">Todos os modelos</p>
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={busca} onChange={(e) => { setBusca(e.target.value); setLimite(POR_PAGINA); }} placeholder="Buscar por nome" className="h-9 pl-8" />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Select value={tipo} onValueChange={(v: any) => { setTipo(v); setLimite(POR_PAGINA); }}>
              <SelectTrigger className="h-9 text-[12.5px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Texto e imagem</SelectItem>
                <SelectItem value="texto">Texto</SelectItem>
                <SelectItem value="imagem">Imagem</SelectItem>
              </SelectContent>
            </Select>
            <Select value={provedor} onValueChange={(v) => { setProvedor(v); setLimite(POR_PAGINA); }}>
              <SelectTrigger className="h-9 text-[12.5px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os provedores</SelectItem>
                {provedores.map((p) => <SelectItem key={p} value={p}>{nomeDoProvedor(p)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={situacao} onValueChange={(v: any) => { setSituacao(v); setLimite(POR_PAGINA); }}>
              <SelectTrigger className="h-9 text-[12.5px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="ativos">Só ativos</SelectItem>
                <SelectItem value="novos">Só novos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {catalogo.isLoading && <p className="mt-4 text-sm text-muted-foreground"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Lendo catálogo…</p>}
        {catalogo.isError && <p className="mt-4 rounded-lg bg-destructive/10 p-3 text-[12.5px]">{textoDoErro(catalogo.error)}</p>}

        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {filtrados.slice(0, limite).map((m, i, lista) => {
            const novo = modeloNovo(m);
            const grupo = m.ativo ? "Ligados para a equipe" : "Desligados";
            const grupoAnterior = i > 0 ? (lista[i - 1].ativo ? "Ligados para a equipe" : "Desligados") : null;
            return (
              <li key={m.id} className="min-w-0">
                {grupo !== grupoAnterior && (
                  <p className="bg-muted px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                    {grupo} ({m.ativo ? filtrados.filter((x) => x.ativo).length : filtrados.filter((x) => !x.ativo).length})
                  </p>
                )}
                <div className="flex items-start px-3 py-2.5">
                <div className="mr-3 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center">
                    <span className="mr-1.5 min-w-0 text-[13px] font-medium [overflow-wrap:anywhere]">{nomeDoModelo(m)}</span>
                    {novo && <span className="mr-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">novo</span>}
                    {(m.padrao_para || []).map((p) => (
                      <span key={p} className="mr-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        padrão: {rotuloDoPapel(p)}
                      </span>
                    ))}
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">
                    {nomeDoProvedor(m.provedor)} · {m.tipo} · {precoDoModelo(m)}
                  </p>
                </div>
                <Switch checked={m.ativo} disabled={salvando === m.id} onCheckedChange={(v) => void alternarAtivo(m, v)} aria-label={`Ativar ${nomeDoModelo(m)}`} />
                </div>
              </li>
            );
          })}
          {!catalogo.isLoading && filtrados.length === 0 && <li className="px-3 py-4 text-[12.5px] text-muted-foreground">Nenhum modelo com esses filtros.</li>}
        </ul>
        {filtrados.length > limite && (
          <Button type="button" variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setLimite((l) => l + POR_PAGINA)}>
            Mostrar mais ({filtrados.length - limite})
          </Button>
        )}
      </SheetContent>
    </Sheet>
  );
}
