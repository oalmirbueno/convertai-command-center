import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { textoDoErro } from "@/lib/mesa/api";
import { useMesa } from "./MesaContexto";
import { Campo, TituloDeSecao } from "./Seletores";

type Agente = "estrategista" | "diretor_arte";

const AGENTES: { valor: Agente; rotulo: string }[] = [
  { valor: "estrategista", rotulo: "Estrategista (Mês)" },
  { valor: "diretor_arte", rotulo: "Diretor de arte (Estúdio)" },
];

const TIPOS = [
  { valor: "aprendizado", rotulo: "Aprendizado" },
  { valor: "preferencia", rotulo: "Preferência" },
  { valor: "evitar", rotulo: "Evitar" },
];

const ORIGENS: Record<string, string> = {
  aprovacao: "da aprovação",
  ajuste: "de um ajuste",
  metrica: "das métricas",
  manual: "escrita pela equipe",
};

interface Prompt {
  id: string;
  versao: number;
  conteudo: string;
  ativo: boolean;
  criado_em: string;
  client_id: string | null;
}

interface Memoria {
  id: string;
  agente: Agente;
  tipo: string;
  texto: string;
  origem: string;
  ativa: boolean;
  criado_em: string;
}

/** Prompt do agente: o global (só leitura) mais o complemento do cliente, com versões. */
export function PromptDoCliente() {
  const { clientId, userId } = useMesa();
  const queryClient = useQueryClient();
  const [agente, setAgente] = useState<Agente>("estrategista");
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);

  const prompts = useQuery({
    queryKey: ["mesa", "prompts", clientId, agente],
    queryFn: async (): Promise<{ global: Prompt | null; versoes: Prompt[] }> => {
      const { data, error } = await (supabase as any)
        .from("agente_prompts")
        .select("id, versao, conteudo, ativo, criado_em, client_id")
        .eq("agente", agente)
        .or(`client_id.is.null,client_id.eq.${clientId}`)
        .order("versao", { ascending: false });
      if (error) throw error;
      const linhas = (data || []) as Prompt[];
      return {
        global: linhas.find((p) => p.client_id === null && p.ativo) || null,
        versoes: linhas.filter((p) => p.client_id === clientId),
      };
    },
  });

  const ativo = prompts.data?.versoes.find((p) => p.ativo) || null;
  useEffect(() => { setTexto(ativo?.conteudo || ""); }, [ativo?.id]);

  const atualizar = () => void queryClient.invalidateQueries({ queryKey: ["mesa", "prompts", clientId, agente] });

  /** Um ativo por agente e cliente: desliga o atual antes de ligar o novo. */
  const desligarAtual = async () => {
    const { error } = await (supabase as any)
      .from("agente_prompts")
      .update({ ativo: false })
      .eq("agente", agente)
      .eq("client_id", clientId)
      .eq("ativo", true);
    if (error) throw error;
  };

  const salvarVersao = async () => {
    if (!texto.trim()) {
      toast.error("Escreva o complemento antes de salvar.");
      return;
    }
    setSalvando(true);
    try {
      const proxima = (prompts.data?.versoes[0]?.versao || 0) + 1;
      await desligarAtual();
      const { error } = await (supabase as any).from("agente_prompts").insert({
        agente,
        client_id: clientId,
        versao: proxima,
        conteudo: texto.trim(),
        ativo: true,
        criado_por: userId,
      });
      if (error) throw error;
      toast.success(`Versão ${proxima} salva e em uso`);
      atualizar();
    } catch (e) {
      toast.error("Complemento não salvo", { description: textoDoErro(e) });
      atualizar();
    } finally {
      setSalvando(false);
    }
  };

  const usarVersao = async (p: Prompt) => {
    setSalvando(true);
    try {
      await desligarAtual();
      const { error } = await (supabase as any).from("agente_prompts").update({ ativo: true }).eq("id", p.id);
      if (error) throw error;
      toast.success(`Versão ${p.versao} em uso`);
    } catch (e) {
      toast.error("Não foi possível trocar a versão", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
      atualizar();
    }
  };

  const semComplemento = async () => {
    setSalvando(true);
    try {
      await desligarAtual();
      toast.success("Agente usa só o prompt global");
    } catch (e) {
      toast.error("Não foi possível salvar", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
      atualizar();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {AGENTES.map((a) => (
          <button
            key={a.valor}
            type="button"
            onClick={() => setAgente(a.valor)}
            className={`rounded-full px-3 py-1.5 text-[12px] ${agente === a.valor ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      <Collapsible className="rounded-xl border border-border bg-card">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left text-[12.5px]">
          <span className="min-w-0">
            <span className="font-medium">Prompt global</span>
            <span className="text-muted-foreground"> · v{prompts.data?.global?.versao ?? "?"}, vale para todos os clientes (só leitura)</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="whitespace-pre-wrap border-t border-border px-3.5 py-3 font-sans text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {prompts.data?.global?.conteudo || "Sem prompt global ativo."}
          </pre>
        </CollapsibleContent>
      </Collapsible>

      <Campo rotulo={`Complemento deste cliente${ativo ? ` (v${ativo.versao} em uso)` : " (nenhum em uso)"}`}>
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={8}
          placeholder="O que vale só para este cliente: tom de voz, temas proibidos, jeito de falar da região, CTA preferido."
        />
      </Campo>
      <div className="flex flex-wrap justify-end gap-2">
        {ativo && (
          <Button type="button" variant="ghost" size="sm" onClick={() => void semComplemento()} disabled={salvando}>
            Usar só o global
          </Button>
        )}
        <Button type="button" size="sm" onClick={() => void salvarVersao()} disabled={salvando || texto.trim() === (ativo?.conteudo || "").trim()}>
          {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Salvar como nova versão
        </Button>
      </div>

      {(prompts.data?.versoes.length || 0) > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {prompts.data!.versoes.map((p) => (
            <li key={p.id} className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium">
                  v{p.versao} <span className="font-normal text-muted-foreground">· {new Date(p.criado_em).toLocaleDateString("pt-BR")}</span>
                  {p.ativo && <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">em uso</span>}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[11.5px] text-muted-foreground">{p.conteudo}</p>
              </div>
              {!p.ativo && (
                <Button type="button" size="sm" variant="outline" className="h-7 text-[11.5px]" onClick={() => void usarVersao(p)} disabled={salvando}>
                  Usar esta
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Memória do agente: o que ele aprendeu com este cliente; a equipe liga, desliga e escreve. */
export function MemoriaDoAgente() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = useState<"todos" | Agente>("todos");
  const [novoAgente, setNovoAgente] = useState<Agente>("estrategista");
  const [novoTipo, setNovoTipo] = useState("preferencia");
  const [novoTexto, setNovoTexto] = useState("");
  const [salvando, setSalvando] = useState(false);

  const memoria = useQuery({
    queryKey: ["mesa", "memoria", clientId],
    queryFn: async (): Promise<Memoria[]> => {
      const { data, error } = await (supabase as any)
        .from("agente_memoria")
        .select("id, agente, tipo, texto, origem, ativa, criado_em")
        .eq("client_id", clientId)
        .order("criado_em", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
  });
  const atualizar = () => void queryClient.invalidateQueries({ queryKey: ["mesa", "memoria", clientId] });

  const alternar = async (m: Memoria, ativa: boolean) => {
    const { error } = await (supabase as any).from("agente_memoria").update({ ativa }).eq("id", m.id);
    if (error) toast.error("Não foi possível salvar", { description: textoDoErro(error) });
    atualizar();
  };

  const adicionar = async () => {
    if (!novoTexto.trim()) return;
    setSalvando(true);
    try {
      const { error } = await (supabase as any).from("agente_memoria").insert({
        client_id: clientId,
        agente: novoAgente,
        tipo: novoTipo,
        texto: novoTexto.trim(),
        origem: "manual",
      });
      if (error) throw error;
      setNovoTexto("");
      atualizar();
    } catch (e) {
      toast.error("Memória não salva", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  const lista = (memoria.data || []).filter((m) => filtro === "todos" || m.agente === filtro);

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-border bg-card p-3.5">
        <TituloDeSecao>Ensinar algo ao agente</TituloDeSecao>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Select value={novoAgente} onValueChange={(v) => setNovoAgente(v as Agente)}>
            <SelectTrigger className="h-9 text-[12.5px]"><SelectValue /></SelectTrigger>
            <SelectContent>{AGENTES.map((a) => <SelectItem key={a.valor} value={a.valor}>{a.rotulo}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={novoTipo} onValueChange={setNovoTipo}>
            <SelectTrigger className="h-9 text-[12.5px]"><SelectValue /></SelectTrigger>
            <SelectContent>{TIPOS.map((t) => <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Textarea value={novoTexto} onChange={(e) => setNovoTexto(e.target.value)} rows={2} placeholder="Ex.: o cliente não gosta de fundo escuro nas capas." />
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={() => void adicionar()} disabled={salvando || !novoTexto.trim()}>
            {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
            Adicionar
          </Button>
        </div>
      </section>

      <TituloDeSecao
        acao={
          <div className="flex flex-wrap gap-1">
            {([{ valor: "todos", rotulo: "Todos" }] as { valor: "todos" | Agente; rotulo: string }[]).concat(AGENTES).map((a) => (
              <button
                key={a.valor}
                type="button"
                onClick={() => setFiltro(a.valor)}
                className={`rounded-full px-2.5 py-1 text-[11px] ${filtro === a.valor ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {a.rotulo}
              </button>
            ))}
          </div>
        }
      >
        Memória ({lista.length})
      </TituloDeSecao>
      {memoria.data && lista.length === 0 && <p className="text-[12.5px] text-muted-foreground">Nada guardado ainda. A memória cresce com as escolhas, os ajustes e as aprovações.</p>}
      <ul className="divide-y divide-border rounded-xl border border-border">
        {lista.map((m) => (
          <li key={m.id} className={`flex items-start gap-3 px-3 py-2.5 ${m.ativa ? "" : "opacity-60"}`}>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{m.texto}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {TIPOS.find((t) => t.valor === m.tipo)?.rotulo || m.tipo} · {AGENTES.find((a) => a.valor === m.agente)?.rotulo || m.agente} · {ORIGENS[m.origem] || m.origem}
              </p>
            </div>
            <Switch checked={m.ativa} onCheckedChange={(v) => void alternar(m, v)} aria-label="Usar esta memória" />
          </li>
        ))}
      </ul>
    </div>
  );
}
