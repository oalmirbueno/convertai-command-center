import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Eye, Loader2, RefreshCw, Search, Sparkles, Wand2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { Switch } from "@/components/ui/switch";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { dolar, lerUsoDaSemana } from "@/lib/config/chavesECustos";
import { custoSemanalCom, usoDoPapel } from "@/lib/config/custoDaSemana";
import {
  capacidadesDoModeloNaTela,
  chamarFuncao,
  contextoCurto,
  modeloLancadoHaPouco,
  modeloNovo,
  nomeDoModelo,
  nomeDoProvedor,
  PAPEIS,
  PAPEIS_DAS_MESAS_NOVAS,
  precoDoModelo,
  textoDoErro,
  type ModeloIa,
} from "@/lib/mesa/api";
import {
  aplicarMudancas,
  melhorDoPapel,
  type MudancaDePadrao,
  mudancasDaRecomendacao,
  RECOMENDACOES_POR_PAPEL,
  recomendadoDoPapel,
  vezesOPreco,
} from "@/lib/mesa/modelo-por-papel";

/**
 * Modelos de IA (só admin). O catálogo chega sozinho do OpenRouter e da
 * OpenAI (ação sincronizar_catalogo do ia-gateway); aqui o dono liga o que
 * quer usar e escolhe o padrão de cada papel. A escrita em ia_modelos é
 * direta na tabela: a RLS só deixa o admin gravar.
 *
 * Frente MOD (30/09): abre numa janela central (regra do dono: pop-up no
 * meio, não gaveta); cada papel mostra o modelo recomendado (modelo-por-papel.ts,
 * com o porquê no "?") e "Aplicar a recomendação" mostra antes o que muda e só
 * grava no Confirmar; a lista mostra "novo", visão, ferramentas, raciocínio,
 * contexto e a data de lançamento.
 */

const POR_PAGINA = 40;

/**
 * Os papéis na ordem em que a Mesa trabalha. "contexto" é o agente que monta
 * e conversa sobre o contexto do cliente (papel novo no banco em 23/09).
 */
export const PAPEIS_DA_TELA: { valor: string; rotulo: string; dica: string; tipo: "texto" | "imagem" }[] = [
  { valor: "estrategista", rotulo: "Estratégia", dica: "Propõe temas, detalha e completa a agenda.", tipo: "texto" },
  { valor: "diretor_arte", rotulo: "Diretor de arte", dica: "Dirige cada lâmina e confere a arte.", tipo: "texto" },
  { valor: "imagem", rotulo: "Gerador de imagem", dica: "Pinta as lâminas.", tipo: "imagem" },
  { valor: "leitura", rotulo: "Leitura de imagem", dica: "Lê referências e organiza o acervo.", tipo: "texto" },
  { valor: "contexto", rotulo: "Agente de contexto", dica: "Monta o contexto e conversa sobre a marca.", tipo: "texto" },
  { valor: "estrategista_rapido", rotulo: "Conteúdo rápido", dica: "Legendas e ideias rápidas, sem raciocínio longo.", tipo: "texto" },
  // Mesas novas (frente BAS, 29/09). Sem padrão, usam o da estratégia.
  { valor: "proposta", rotulo: "Proposta", dica: "Escreve a proposta comercial.", tipo: "texto" },
  { valor: "contrato", rotulo: "Contrato", dica: "Monta o contrato da proposta aceita.", tipo: "texto" },
  { valor: "briefing", rotulo: "Briefing", dica: "Conduz e organiza o briefing.", tipo: "texto" },
  { valor: "conselho", rotulo: "Conselho", dica: "Dá a segunda opinião sobre o cliente.", tipo: "texto" },
  { valor: "identidade", rotulo: "Identidade visual", dica: "Pensa a marca e o manual.", tipo: "texto" },
  { valor: "naming", rotulo: "Naming", dica: "Propõe e avalia nomes.", tipo: "texto" },
  { valor: "site", rotulo: "Site", dica: "Escreve e ajusta o código do site.", tipo: "texto" },
  { valor: "motion", rotulo: "Motion", dica: "Escreve o código dos vídeos de motion.", tipo: "texto" },
  { valor: "documento", rotulo: "Documento", dica: "Redige documentos da agência.", tipo: "texto" },
];

/** Papéis que, sem padrão próprio, usam o da estratégia (contexto e os das mesas novas). */
const USA_O_DA_ESTRATEGIA = ["contexto"].concat(PAPEIS_DAS_MESAS_NOVAS as unknown as string[]);

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

/**
 * Confirmar a troca do padrão de UM papel (frente CHV, 01/10/2026): de, para,
 * preço e o custo estimado por semana pelo uso real dos últimos 7 dias. Nada
 * é gravado antes do Confirmar.
 */
function TrocaDoPapel({
  rotulo,
  de,
  para,
  uso,
  semUso,
  salvando,
  onConfirmar,
  onCancelar,
}: {
  rotulo: string;
  de: ModeloIa | null;
  para: ModeloIa | null;
  uso: ReturnType<typeof usoDoPapel> | undefined;
  semUso: boolean;
  salvando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const hoje = uso ? Number(uso.custo_usd) || 0 : null;
  const comONovo = uso ? custoSemanalCom(uso, para) : null;
  return (
    <div className="min-w-0 border-t border-border pt-2 sm:col-span-2" data-troca-do-papel="">
      <p className="text-[12px] leading-4 [overflow-wrap:anywhere]">
        <span className="font-medium">{rotulo}:</span> {de ? nomeDoModelo(de) : "sem padrão"} → <span className="font-medium">{para ? nomeDoModelo(para) : "?"}</span>
        {para && <span className="text-muted-foreground"> ({precoDoModelo(para)})</span>}
      </p>
      <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground tabular-nums" data-custo-da-semana="">
        {uso === undefined
          ? semUso
            ? "Sem a estimativa da semana agora (o uso não pôde ser lido)."
            : "Calculando o custo da semana…"
          : uso === null || !uso.chamadas
            ? "Este papel não teve uso nos últimos 7 dias: sem custo para estimar."
            : `Últimos 7 dias: ${uso.chamadas} chamadas, ${dolar(hoje)}. Com o novo: ${comONovo === null ? "preço a conferir" : `~${dolar(comONovo)} por semana`}.`}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center">
        <Button type="button" size="sm" className="mr-2" onClick={onConfirmar} disabled={salvando || !para} data-confirmar-troca="">
          {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Confirmar
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancelar} disabled={salvando}>
          Cancelar
        </Button>
      </div>
    </div>
  );
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
  const [revisao, setRevisao] = useState<MudancaDePadrao[] | null>(null);
  // Frente CHV (01/10): trocar o padrão de um papel pede Confirmar, com o custo estimado por semana antes.
  const [pendente, setPendente] = useState<{ papel: string; para: string } | null>(null);
  const usoDaSemana = useQuery({
    queryKey: ["config", "chaves", "uso-semana"],
    enabled: aberto && !!pendente,
    queryFn: lerUsoDaSemana,
    staleTime: 10 * 60_000,
    retry: false,
  });

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
      setPendente(null);
      atualizar();
    } catch (e) {
      toast.error("Não foi possível salvar o padrão", { description: textoDoErro(e) });
    } finally {
      setSalvando(null);
    }
  };

  const porId = (id: string | null) => (id ? modelos.find((m) => m.id === id) || null : null);
  const nomeDoId = (id: string | null) => {
    const m = porId(id);
    return m ? nomeDoModelo(m) : id ? id.replace(/^[a-z]+:/, "") : "nenhum";
  };

  /** Mostra o que muda; nada é gravado antes do Confirmar. */
  const reverRecomendacao = () => {
    const mudancas = mudancasDaRecomendacao(modelos);
    if (!mudancas.length) {
      toast.success("Os padrões já seguem a recomendação", { description: "Ligue um modelo recomendado que esteja desligado para ele virar padrão." });
      return;
    }
    setRevisao(mudancas);
  };

  /** Grava primeiro quem ganha o papel e depois quem perde: o papel nunca fica sem padrão. */
  const aplicarRecomendacao = async () => {
    if (!revisao) return;
    setSalvando("recomendacao");
    try {
      const finais = aplicarMudancas(modelos, revisao);
      const ganham = Object.keys(finais).filter((id) => {
        const antes = (porId(id) || { padrao_para: [] as string[] }).padrao_para || [];
        return finais[id].some((p) => antes.indexOf(p) < 0);
      });
      const perdem = Object.keys(finais).filter((id) => ganham.indexOf(id) < 0);
      for (const id of ganham.concat(perdem)) {
        const { error } = await (supabase as any).from("ia_modelos").update({ padrao_para: finais[id] }).eq("id", id);
        if (error) throw error;
      }
      toast.success(`${revisao.length} padrão(ões) trocado(s)`, { description: "Cada mesa ainda troca o modelo na hora pelo seletor." });
      setRevisao(null);
      atualizar();
    } catch (e) {
      toast.error("Não foi possível aplicar a recomendação", { description: textoDoErro(e) });
      atualizar();
    } finally {
      setSalvando(null);
    }
  };

  return (
    <JanelaCentral
      aberta={aberto}
      onMudar={onOpenChange}
      largura="xl"
      icone={<Sparkles className="h-4 w-4" />}
      titulo="Modelos de IA"
      ajuda="O catálogo chega sozinho dos provedores. Ligue o que a equipe pode usar e escolha o padrão de cada papel. A recomendação por papel pesa qualidade e preço (docs/motores/MODELOS.md) e só usa modelo ligado."
      descricaoOculta="O catálogo chega sozinho dos provedores. Ligue o que a equipe pode usar e escolha o padrão de cada papel."
    >
        <div className="flex flex-wrap items-center">
          <Button type="button" size="sm" variant="outline" className="mb-1 mr-2" onClick={() => void sincronizar()} disabled={sincronizando}>
            {sincronizando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            Buscar modelos novos agora
          </Button>
          <Button type="button" size="sm" variant="outline" className="mb-1 mr-2" onClick={reverRecomendacao} disabled={!modelos.length || salvando === "recomendacao"}>
            <Wand2 className="mr-1.5 h-3.5 w-3.5" />
            Aplicar a recomendação
          </Button>
          <span className="mb-1 text-[12px] text-muted-foreground">{modelos.filter((m) => m.ativo).length} ativos de {modelos.length}</span>
        </div>

        {revisao && (
          <section className="mt-2 border-y border-border py-3" aria-label="O que muda com a recomendação" data-revisao-da-recomendacao>
            <p className="text-[13px] font-medium">O que muda ({revisao.length})</p>
            <ul className="mt-1.5 space-y-1">
              {revisao.map((mu) => {
                const de = porId(mu.de);
                const para = porId(mu.para);
                const vezes = vezesOPreco(de, para);
                return (
                  <li key={mu.papel} className="text-[12px] leading-4 [overflow-wrap:anywhere]" data-troca-de-papel={mu.papel}>
                    <span className="font-medium">{rotuloDoPapel(mu.papel)}:</span> {nomeDoId(mu.de)} → <span className="text-foreground">{nomeDoId(mu.para)}</span>
                    {para && (
                      <span className="text-muted-foreground">
                        {" "}({de ? `${precoDoModelo(de)} → ` : ""}{precoDoModelo(para)})
                      </span>
                    )}
                    {vezes != null && vezes >= 1.5 && (
                      <span className="text-destructive" data-troca-cara>{` ${String(vezes).replace(".", ",")} vezes o preço por token: o gasto deste papel sobe junto.`}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-2.5 flex flex-wrap items-center">
              <Button type="button" size="sm" className="mr-2" onClick={() => void aplicarRecomendacao()} disabled={salvando === "recomendacao"}>
                {salvando === "recomendacao" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Confirmar
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRevisao(null)} disabled={salvando === "recomendacao"}>Cancelar</Button>
            </div>
          </section>
        )}

        <section className="mt-3">
          <div className="flex items-center border-b border-border pb-2">
            <p className="text-[13px] font-medium">Padrão por papel</p>
            <AjudaRecolhida className="ml-1.5">O modelo que cada agente usa quando a tela não pede outro. A recomendação pesa qualidade e preço por papel (docs/motores/MODELOS.md) e só usa modelo ligado.</AjudaRecolhida>
          </div>
          <ul className="divide-y divide-border">
            {PAPEIS_DA_TELA.map((papel) => {
              const opcoes = modelos.filter((m) => m.ativo && m.tipo === papel.tipo);
              const atual = modelos.find((m) => (m.padrao_para || []).indexOf(papel.valor) >= 0) || null;
              const recomendado = recomendadoDoPapel(modelos, papel.valor);
              const melhor = melhorDoPapel(papel.valor);
              const porque = (RECOMENDACOES_POR_PAPEL.find((r) => r.papel === papel.valor) || { porque: "" }).porque;
              const melhorDesligado = !!melhor && melhor !== recomendado;
              return (
                <li key={papel.valor} className="grid grid-cols-1 items-center gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">{papel.rotulo}</p>
                    <p className="text-[11px] leading-snug text-muted-foreground">{papel.dica}</p>
                    {melhor && (
                      <p className="mt-0.5 flex items-center text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]" data-recomendado={melhor}>
                        <span className="min-w-0">
                          Recomendado: {nomeDoId(melhor)}
                          {melhorDesligado ? (porId(melhor) ? " (desligado: ligue para usar)" : " (ainda não chegou ao catálogo)") : ""}
                        </span>
                        {porque && <AjudaRecolhida className="ml-1">{porque}</AjudaRecolhida>}
                      </p>
                    )}
                    <p className="mt-0.5 text-[11px] leading-snug [overflow-wrap:anywhere]">
                      {atual ? (
                        <span className={atual.ativo ? "text-foreground" : "text-destructive"}>
                          Atual: {nomeDoModelo(atual)}{atual.ativo ? "" : " (desligado)"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Sem padrão: {USA_O_DA_ESTRATEGIA.indexOf(papel.valor) >= 0 ? "usa o da estratégia" : "usa o primeiro modelo ativo"}</span>
                      )}
                    </p>
                  </div>
                  <Select
                    value={pendente && pendente.papel === papel.valor ? pendente.para : atual?.id || ""}
                    onValueChange={(v) => setPendente(v && v !== (atual?.id || "") ? { papel: papel.valor, para: v } : null)}
                    disabled={salvando === `padrao-${papel.valor}` || opcoes.length === 0}
                  >
                    <SelectTrigger className="h-9 min-w-0 text-[13px]">
                      <SelectValue placeholder={opcoes.length ? "Trocar o modelo" : "Nenhum modelo ativo deste tipo"} />
                    </SelectTrigger>
                    <SelectContent>
                      {opcoes.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{nomeDoModelo(m)} · {precoDoModelo(m)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {pendente && pendente.papel === papel.valor && (
                    <TrocaDoPapel
                      rotulo={papel.rotulo}
                      de={atual}
                      para={porId(pendente.para)}
                      uso={usoDaSemana.isLoading ? undefined : usoDoPapel(usoDaSemana.data?.agentes, papel.valor)}
                      semUso={usoDaSemana.isError}
                      salvando={salvando === `padrao-${papel.valor}`}
                      onConfirmar={() => void definirPadrao(papel.valor, pendente.para)}
                      onCancelar={() => setPendente(null)}
                    />
                  )}
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
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Texto e imagem</SelectItem>
                <SelectItem value="texto">Texto</SelectItem>
                <SelectItem value="imagem">Imagem</SelectItem>
              </SelectContent>
            </Select>
            <Select value={provedor} onValueChange={(v) => { setProvedor(v); setLimite(POR_PAGINA); }}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os provedores</SelectItem>
                {provedores.map((p) => <SelectItem key={p} value={p}>{nomeDoProvedor(p)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={situacao} onValueChange={(v: any) => { setSituacao(v); setLimite(POR_PAGINA); }}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="ativos">Só ativos</SelectItem>
                <SelectItem value="novos">Só novos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {catalogo.isLoading && <p className="mt-4 text-sm text-muted-foreground"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Lendo catálogo…</p>}
        {catalogo.isError && <p className="mt-4 rounded-lg bg-destructive/10 p-3 text-[13px]">{textoDoErro(catalogo.error)}</p>}

        <ul className="mt-3 divide-y divide-border border-y border-border">
          {filtrados.slice(0, limite).map((m, i, lista) => {
            const novo = modeloNovo(m);
            const grupo = m.ativo ? "Ligados para a equipe" : "Desligados";
            const grupoAnterior = i > 0 ? (lista[i - 1].ativo ? "Ligados para a equipe" : "Desligados") : null;
            return (
              <li key={m.id} className="min-w-0">
                {grupo !== grupoAnterior && (
                  <p className="bg-muted px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                    {grupo} ({m.ativo ? filtrados.filter((x) => x.ativo).length : filtrados.filter((x) => !x.ativo).length})
                  </p>
                )}
                <div className="flex items-start px-3 py-2.5">
                <div className="mr-3 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center">
                    <span className="mr-1.5 min-w-0 text-[13px] font-medium [overflow-wrap:anywhere]">{nomeDoModelo(m)}</span>
                    {(novo || modeloLancadoHaPouco(m)) && <span className="mr-1 rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">novo</span>}
                    {(m.padrao_para || []).map((p) => (
                      <span key={p} className="mr-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        padrão: {rotuloDoPapel(p)}
                      </span>
                    ))}
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center text-[12px] text-muted-foreground [overflow-wrap:anywhere]">
                    <span className="mr-1.5">{nomeDoProvedor(m.provedor)} · {m.tipo} · {precoDoModelo(m)}{m.tipo === "texto" && contextoCurto(m) ? ` · ${contextoCurto(m)} de contexto` : ""}{m.recursos && m.recursos.lancado_em ? ` · lançado em ${m.recursos.lancado_em.split("-").reverse().join("/")}` : ""}</span>
                    {m.tipo === "texto" && <CapacidadesDoModelo m={m} />}
                  </p>
                </div>
                <Switch checked={m.ativo} disabled={salvando === m.id} onCheckedChange={(v) => void alternarAtivo(m, v)} aria-label={`Ativar ${nomeDoModelo(m)}`} />
                </div>
              </li>
            );
          })}
          {!catalogo.isLoading && filtrados.length === 0 && <li className="px-3 py-4 text-[13px] text-muted-foreground">Nenhum modelo com esses filtros.</li>}
        </ul>
        {filtrados.length > limite && (
          <Button type="button" variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setLimite((l) => l + POR_PAGINA)}>
            Mostrar mais ({filtrados.length - limite})
          </Button>
        )}
    </JanelaCentral>
  );
}

/** Visão, ferramentas e raciocínio em ícones (o nome inteiro no leitor de tela e no title). */
function CapacidadesDoModelo({ m }: { m: ModeloIa }) {
  const c = capacidadesDoModeloNaTela(m);
  const itens: Array<{ chave: string; rotulo: string; icone: typeof Eye }> = [];
  if (c.visao) itens.push({ chave: "visao", rotulo: "Vê imagem", icone: Eye });
  if (c.ferramentas) itens.push({ chave: "ferramentas", rotulo: "Usa ferramentas", icone: Wrench });
  if (c.raciocinio) itens.push({ chave: "raciocinio", rotulo: "Raciocina", icone: Brain });
  if (!itens.length) return null;
  return (
    <span className="inline-flex items-center" aria-label={itens.map((i) => i.rotulo).join(", ")}>
      {itens.map((i) => (
        <span key={i.chave} title={i.rotulo} className="mr-1 inline-flex">
          <i.icone className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      ))}
    </span>
  );
}
