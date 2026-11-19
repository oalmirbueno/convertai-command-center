import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Bot, CircleAlert, Copy, Power, RefreshCw, Workflow } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Collapsible, EmptyState, PageHeader, PillTabs, SearchField, StatCard, StatGrid, StatusDot, StatusPill, Chip, type Tone } from "@/components/ds";
import { Carregando, EstadoDeErro, JanelaCentral, botao, espaco, juntar, larguraDaMesa, lista, texto } from "@/components/sistema";
import { GUIA_DO_N8N } from "../../supabase/functions/_shared/automacoes-guia";
import {
  NO_ALTURA,
  NO_LARGURA,
  ROTULO_DO_MODO,
  ROTULO_DO_STATUS,
  agruparFluxos,
  caminhoPorNo,
  desenharFluxo,
  emQuanto,
  haQuanto,
  nomeCurto,
  normalizarDetalhe,
  normalizarPainel,
  numerosDoPainel,
  tomDoStatus,
  type DetalheDoFluxo,
  type Execucao,
  type Filtro,
  type Fluxo,
} from "@/lib/centralDeAutomacoes";

/*
 * Central de Automações (19/11/2026). Dono: "uma central das automações onde podemos ver tudo: saúde, os
 * próprios workflows de forma mais dinâmica e interativa, e ver eles funcionando... com botão ligar e desligar".
 * - Fluxos: todos os fluxos do n8n por grupo, com estado, última e próxima execução; o dono liga e desliga.
 * - Clicar num fluxo abre a janela com o desenho (nós e ligações) e as últimas execuções: escolher uma
 *   pinta no desenho o caminho que ela fez e onde parou.
 * - Saúde: n8n, porta dos webhooks, ponte do 3429, leitor dos grupos, timers, vigia, disco e vencimentos.
 * - Para as IAs: como qualquer agente acessa o n8n (ferramentas do MCP e regras), sem segredo.
 * O retrato vem do coletor do servidor a cada minuto; a tela relê sozinha.
 */

type Aba = "fluxos" | "saude" | "ias";

const TOM_DA_SAUDE: Record<string, Tone> = { ok: "success", atencao: "warning", falha: "danger" };
const ROTULO_DA_SAUDE: Record<string, string> = { ok: "ok", atencao: "atenção", falha: "falha" };

function useAgora() {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return agora;
}

function usePainel() {
  return useQuery({
    queryKey: ["automacoes-painel"],
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("automacoes_painel");
      if (error) throw new Error(error.message);
      return normalizarPainel(data);
    },
  });
}

function useDetalhe(id: string | null) {
  return useQuery({
    queryKey: ["automacoes-fluxo", id],
    enabled: Boolean(id),
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("automacoes_fluxo", { _id: id, _limite: 30 });
      if (error) throw new Error(error.message);
      return normalizarDetalhe(data);
    },
  });
}

const diaHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const duracao = (a: string | null, b: string | null) => {
  if (!a || !b) return "";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return ms < 1000 ? `${Math.max(0, ms)} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1).replace(".", ",")} s` : `${Math.round(ms / 60_000)} min`;
};

function LinhaDoFluxo({ f, agora, podeLigar, aoAbrir, aoAlternar }: { f: Fluxo; agora: number; podeLigar: boolean; aoAbrir: () => void; aoAlternar: () => void }) {
  const gatilho = f.gatilhos.filter((g) => g.tipo !== "subfluxo").map((g) => g.descricao).slice(0, 2).join(" · ") || f.gatilhos[0]?.descricao || "sem gatilho";
  const tomUltima = f.ultima ? tomDoStatus(f.ultima.status) : "neutral";
  return (
    <li className="flex min-w-0 items-center">
      <button type="button" onClick={aoAbrir} className={juntar(lista.linha, "min-w-0 flex-1 text-left")} title={`Abrir ${f.nome}`}>
        <StatusDot tone={f.ativo ? (f.erros24h > 0 ? "warning" : "success") : "neutral"} className="mr-3 h-2 w-2" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className={juntar(texto.corpo, "truncate font-medium", !f.ativo && "text-muted-foreground")}>{nomeCurto(f)}</span>
            {f.efeitoNoCliente && f.ativo && <Chip size="sm" tone="info">fala com cliente</Chip>}
            {f.erros24h > 0 && <Chip size="sm" tone="danger">{f.erros24h} {f.erros24h === 1 ? "erro" : "erros"}</Chip>}
          </span>
          <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>{gatilho}</span>
        </span>
        <span className={juntar(texto.auxiliar, "ml-3 hidden w-36 shrink-0 text-right tabular-nums sm:block")}>
          {f.ultima ? (
            <span className="flex items-center justify-end gap-1.5"><StatusDot tone={tomUltima} />{haQuanto(f.ultima.inicio, agora)}</span>
          ) : <span>sem rodada</span>}
          <span className="block">{f.ativo ? (f.proximaExecucao ? `próxima ${emQuanto(f.proximaExecucao, agora)}` : f.gatilhos.some((g) => g.tipo === "webhook") ? "quando chamar" : "") : "desligado"}</span>
        </span>
      </button>
      <span className="ml-2 flex w-11 shrink-0 justify-end">
        {podeLigar ? (
          <Switch checked={f.ativo} onCheckedChange={aoAlternar} aria-label={f.ativo ? `Desligar ${f.nome}` : `Ligar ${f.nome}`} title={f.ativo ? "Desligar" : "Ligar"} />
        ) : (
          <StatusPill plain tone={f.ativo ? "success" : "neutral"}>{f.ativo ? "ligado" : "desligado"}</StatusPill>
        )}
      </span>
    </li>
  );
}

const COR_DO_NO: Record<string, string> = {
  success: "fill-success-soft stroke-success",
  error: "fill-danger-soft stroke-destructive",
  nao: "fill-card stroke-border",
};

function Desenho({ detalhe, execucao }: { detalhe: DetalheDoFluxo; execucao: Execucao | null }) {
  const d = useMemo(() => desenharFluxo(detalhe.desenho), [detalhe.desenho]);
  const passos = useMemo(() => caminhoPorNo(execucao?.caminho ?? []), [execucao]);
  const [real, setReal] = useState(false);
  if (!d.nos.length) return <EmptyState title="O desenho chega na próxima coleta." />;
  const largura = real ? d.largura : undefined;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className={texto.auxiliar}>{execucao ? `Execução ${execucao.id}: ${execucao.caminho.length} passos${execucao.parouEm ? `, parou em "${execucao.parouEm}"` : ""}` : `${d.nos.length} nós`}</span>
        <button type="button" className={juntar(botao.discreto, "h-7 px-3 text-[12px]")} onClick={() => setReal((v) => !v)}>{real ? "Caber na tela" : "Tamanho real"}</button>
      </div>
      <div className={juntar("rounded-md border border-border/60 bg-muted/30", real && "overflow-x-auto")}>
        <svg viewBox={`0 0 ${d.largura} ${d.altura}`} width={largura ?? "100%"} style={real ? { height: d.altura } : { maxHeight: 420 }} role="img" aria-label={`Desenho do fluxo ${detalhe.nome}`}>
          {d.ligacoes.map((l, i) => {
            const passou = passos.has(l.de) && passos.has(l.para);
            return <path key={i} d={l.caminho} fill="none" className={passou ? "stroke-success" : "stroke-border"} strokeWidth={passou ? 2.5 : 1.5} strokeDasharray={passou || !execucao ? undefined : "4 4"} />;
          })}
          {d.nos.map((no) => {
            const p = passos.get(no.nome);
            const cor = !execucao ? "fill-card stroke-border" : p ? COR_DO_NO[p.estado === "error" ? "error" : "success"] : COR_DO_NO.nao;
            return (
              <g key={no.nome} transform={`translate(${no.x} ${no.y})`} opacity={no.desligado ? 0.45 : execucao && !p ? 0.55 : 1}>
                <title>{`${no.nome} (${no.tipo})${p ? ` · passo ${p.ordem}${p.vezes > 1 ? `, ${p.vezes} vezes` : ""}` : ""}${no.desligado ? " · desligado" : ""}`}</title>
                <rect width={NO_LARGURA} height={NO_ALTURA} rx={10} className={cor} strokeWidth={1.5} />
                <text x={12} y={18} className="fill-foreground text-[12px] font-medium">{no.nome.length > 22 ? `${no.nome.slice(0, 21)}…` : no.nome}</text>
                <text x={12} y={33} className="fill-muted-foreground text-[11px]">{no.tipo.length > 24 ? `${no.tipo.slice(0, 23)}…` : no.tipo}</text>
                {p && <circle cx={NO_LARGURA - 12} cy={12} r={8} className={p.estado === "error" ? "fill-destructive" : "fill-success"} />}
                {p && <text x={NO_LARGURA - 12} y={15.5} textAnchor="middle" className="fill-white text-[11px] font-medium">{p.ordem}</text>}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function JanelaDoFluxo({ id, agora, podeLigar, aoFechar, aoAlternar }: { id: string | null; agora: number; podeLigar: boolean; aoFechar: () => void; aoAlternar: (f: Fluxo) => void }) {
  const q = useDetalhe(id);
  const [execId, setExecId] = useState<number | null>(null);
  useEffect(() => setExecId(null), [id]);
  const d = q.data ?? null;
  const execucao = d?.execucoes.find((e) => e.id === execId) ?? d?.execucoes[0] ?? null;
  return (
    <JanelaCentral
      aberta={id !== null}
      onMudar={(v) => { if (!v) aoFechar(); }}
      titulo={d ? nomeCurto(d) : "Fluxo"}
      icone={<Workflow className="h-4 w-4" />}
      descricao={d ? `${d.grupo} · ${d.ativo ? "ligado" : "desligado"} · ${d.total24h} rodadas em 24 h` : undefined}
      largura="xl"
      acoes={d && podeLigar ? <Switch checked={d.ativo} onCheckedChange={() => aoAlternar(d)} aria-label={d.ativo ? "Desligar este fluxo" : "Ligar este fluxo"} title={d.ativo ? "Desligar" : "Ligar"} /> : undefined}
    >
      {q.isLoading ? <Carregando rotulo="Lendo o fluxo" linhas={5} />
        : q.error ? <EstadoDeErro titulo="Não foi possível ler o fluxo." descricao={(q.error as Error).message} />
        : !d ? <EmptyState title="Esse fluxo saiu do n8n." />
        : (
          <div className="space-y-6">
            <Desenho detalhe={d} execucao={execucao} />
            <section aria-label="Últimas execuções">
              <h3 className={juntar(texto.rotulo, "mb-1")}>Últimas execuções</h3>
              {d.execucoes.length === 0 ? <p className={texto.auxiliar}>Nenhuma execução guardada ainda.</p> : (
                <ul className={juntar(lista.aberta, lista.divisoria)}>
                  {d.execucoes.map((e) => (
                    <li key={e.id}>
                      <button type="button" onClick={() => setExecId(e.id)} aria-pressed={execucao?.id === e.id}
                        className={juntar(lista.linha, "w-full text-left", execucao?.id === e.id && "bg-muted/60")}>
                        <StatusPill tone={tomDoStatus(e.status)} className="mr-3 w-20 justify-center">{ROTULO_DO_STATUS[e.status] ?? e.status}</StatusPill>
                        <span className="min-w-0 flex-1">
                          <span className={juntar(texto.corpo, "block truncate")}>
                            {e.erro ? `${e.erroNo ? `${e.erroNo}: ` : ""}${e.erro}` : e.grande ? "Execução grande: só o estado e o horário" : e.parouEm ? `Parou em "${e.parouEm}"` : `${e.caminho.length} passos`}
                          </span>
                          <span className={juntar(texto.auxiliar, "block truncate")}>{ROTULO_DO_MODO[e.modo ?? ""] ?? e.modo} · {duracao(e.inicio, e.fim)} · nº {e.id}</span>
                        </span>
                        <span className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums")}>{haQuanto(e.inicio, agora)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {d.acoes.length > 0 && (
              <section aria-label="Quem ligou e desligou">
                <h3 className={juntar(texto.rotulo, "mb-1")}>Ligado e desligado</h3>
                <ul className="space-y-1">
                  {d.acoes.map((a, i) => (
                    <li key={i} className={texto.auxiliar}>{diaHora(a.quando)} · {a.quem} {a.acao === "ligar" ? "ligou" : "desligou"}{a.via === "mcp" ? " pelo MCP" : ""}{a.resultado === "falhou" ? ` · falhou: ${a.erro ?? ""}` : ""}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
    </JanelaCentral>
  );
}

function Confirmacao({ fluxo, aoFechar, aoConfirmar, enviando }: { fluxo: Fluxo | null; aoFechar: () => void; aoConfirmar: () => void; enviando: boolean }) {
  const desligar = fluxo?.ativo ?? false;
  const apoio = fluxo?.grupo === "Apoio";
  const aviso = !fluxo ? "" : desligar
    ? apoio ? "É um fluxo de apoio: outros fluxos dependem dele e podem parar." : fluxo.efeitoNoCliente ? "Este fluxo fala com cliente ou lead: desligado, nada dele sai até alguém ligar de novo." : "Para de rodar até alguém ligar de novo."
    : fluxo.efeitoNoCliente ? "Ligado, ele volta a rodar sozinho e a falar com cliente ou lead no próximo gatilho." : "Ligado, ele volta a rodar sozinho no próximo gatilho.";
  return (
    <JanelaCentral
      aberta={fluxo !== null}
      onMudar={(v) => { if (!v && !enviando) aoFechar(); }}
      titulo={fluxo ? `${desligar ? "Desligar" : "Ligar"} "${nomeCurto(fluxo)}"?` : ""}
      icone={<Power className="h-4 w-4" />}
      largura="sm"
      rodape={
        <div className="flex justify-end gap-2">
          <button type="button" className={botao.secundario} onClick={aoFechar} disabled={enviando}>Cancelar</button>
          <button type="button" className={desligar ? botao.perigo : botao.primario} onClick={aoConfirmar} disabled={enviando}>
            {enviando ? "Enviando…" : desligar ? "Desligar" : "Ligar"}
          </button>
        </div>
      }
    >
      <p className={juntar(texto.corpo, (fluxo?.efeitoNoCliente || apoio) && desligar ? "text-destructive" : "")}>{aviso}</p>
      <p className={juntar(texto.auxiliar, "mt-2")}>Fica registrado quem pediu e quando.</p>
    </JanelaCentral>
  );
}

function Saude({ p, agora }: { p: ReturnType<typeof normalizarPainel>; agora: number }) {
  const venc = p.saude.find((s) => s.chave === "vencimentos");
  const itens = (venc?.info.itens as Array<{ nome: string; pago_ate: string | null; dias: number | null }> | undefined) ?? [];
  return (
    <div className="space-y-6">
      <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Saúde das automações">
        {p.saude.map((s) => {
          const info = s.info as Record<string, string | number | boolean | null>;
          const extra = [
            info.desde ? `desde ${diaHora(String(info.desde))}` : "",
            info.ultima ? `última ${haQuanto(String(info.ultima), agora)}` : "",
            info.proxima ? `próxima ${emQuanto(String(info.proxima), agora)}` : "",
            typeof info.reinicios === "number" && info.reinicios > 0 ? `${info.reinicios} reinícios` : "",
          ].filter(Boolean).join(" · ");
          return (
            <li key={s.chave} className={lista.linha}>
              <StatusDot tone={TOM_DA_SAUDE[s.estado]} className="mr-3 h-2 w-2" />
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate font-medium")}>{s.nome}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>{s.detalhe}{extra ? ` · ${extra}` : ""}</span>
              </span>
              <StatusPill tone={TOM_DA_SAUDE[s.estado]} className="ml-3">{ROTULO_DA_SAUDE[s.estado]}</StatusPill>
            </li>
          );
        })}
      </ul>
      {itens.length > 0 && (
        <Collapsible title="Vencimentos" count={itens.length} storageKey="automacoes:vencimentos" defaultOpen={false}>
          <ul className="space-y-1">
            {itens.map((v) => <li key={v.nome} className={texto.auxiliar}>{v.nome}{v.pago_ate ? ` · pago até ${new Date(`${v.pago_ate}T12:00:00`).toLocaleDateString("pt-BR")} (${v.dias} dias)` : " · data pelo registro do domínio"}</li>)}
          </ul>
        </Collapsible>
      )}
    </div>
  );
}

function ParaAsIas() {
  const g = GUIA_DO_N8N;
  const copiar = () => {
    const txt = JSON.stringify(g, null, 2);
    void navigator.clipboard?.writeText(txt).then(() => toast.success("Guia copiado"), () => toast.error("Não deu para copiar"));
  };
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className={texto.corpo}>Qualquer IA conectada ao MCP Aceleriq OS enxerga isto com <code className="rounded bg-muted px-1">aceleriq_automacoes_guia</code>.</p>
        <button type="button" className={botao.icone} onClick={copiar} aria-label="Copiar o guia" title="Copiar o guia"><Copy className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <section aria-label="Ferramentas"><h3 className={juntar(texto.rotulo, "mb-1")}>Ferramentas do MCP</h3>
        <ul className={juntar(lista.aberta, lista.divisoria)}>
          {Object.entries(g.ferramentas).map(([nome, oque]) => (
            <li key={nome} className={juntar(lista.linha, "block")}><code className={juntar(texto.corpo, "font-medium")}>{nome}</code><span className={juntar(texto.auxiliar, "block")}>{oque}</span></li>
          ))}
        </ul>
      </section>
      <section aria-label="Endereços"><h3 className={juntar(texto.rotulo, "mb-1")}>Endereços</h3>
        <ul className="space-y-1">{Object.entries(g.enderecos).map(([k, v]) => <li key={k} className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")}><span className="font-medium text-foreground">{k.replace("_", " ")}:</span> {v}</li>)}</ul>
        <p className={juntar(texto.auxiliar, "mt-2")}>{g.onde_roda}</p>
      </section>
      <section aria-label="Regras"><h3 className={juntar(texto.rotulo, "mb-1")}>Regras</h3>
        <ul className="space-y-1.5">{g.regras.map((r, i) => <li key={i} className={juntar(texto.corpo, "[overflow-wrap:anywhere]")}>{r}</li>)}</ul>
        <p className={juntar(texto.auxiliar, "mt-2 [overflow-wrap:anywhere]")}>{g.codigo_fonte}</p>
      </section>
      <section aria-label="Grupos"><h3 className={juntar(texto.rotulo, "mb-1")}>O que é cada grupo</h3>
        <ul className="space-y-1">{Object.entries(g.grupos).map(([k, v]) => <li key={k} className={texto.auxiliar}><span className="font-medium text-foreground">{k}:</span> {v}</li>)}</ul>
      </section>
    </div>
  );
}

export default function CentralDeAutomacoes() {
  const q = usePainel();
  const qc = useQueryClient();
  const agora = useAgora();
  const [aba, setAba] = useState<Aba>("fluxos");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [pedido, setPedido] = useState<Fluxo | null>(null);
  const [enviando, setEnviando] = useState(false);

  const p = q.data;
  const podeLigar = Boolean(p?.podeLigar);
  const grupos = useMemo(() => agruparFluxos(p?.fluxos ?? [], { filtro, busca }), [p, filtro, busca]);
  const numeros = useMemo(() => (p ? numerosDoPainel(p) : null), [p]);

  const confirmar = async () => {
    if (!pedido) return;
    setEnviando(true);
    const acao = pedido.ativo ? "desligar" : "ligar";
    const { data, error } = await supabase.functions.invoke("automacoes-n8n", { body: { acao, fluxo_id: pedido.id, confirmar: true } });
    setEnviando(false);
    const erro = error ? ((await (error as { context?: Response }).context?.json?.().catch(() => null))?.erro ?? error.message) : data?.ok === false ? data.erro : null;
    if (erro) {
      toast.error(`Não deu para ${acao}: ${erro}`);
      return;
    }
    toast.success(`${nomeCurto(pedido)} ${acao === "ligar" ? "ligado" : "desligado"}`);
    setPedido(null);
    await Promise.all([qc.invalidateQueries({ queryKey: ["automacoes-painel"] }), qc.invalidateQueries({ queryKey: ["automacoes-fluxo"] })]);
  };

  const estado = !p ? " " : !p.disponivel ? "esperando a primeira coleta"
    : `${numeros?.ligados} de ${numeros?.total} ligados · atualizado ${haQuanto(p.coletadoEm, agora)}${p.atrasada ? " (coletor parado)" : ""}`;

  return (
    <div className={juntar(larguraDaMesa, espaco.pagina, "pb-10")} data-central-de-automacoes="">
      <PageHeader
        title="Automações"
        subtitle={estado}
        help="Todos os fluxos do n8n de produção, a saúde do servidor que move as automações e o caminho de cada execução. Um coletor no servidor lê o n8n e o systemd a cada minuto (só leitura) e manda para cá; o painel nunca entra no servidor. Ligar e desligar é só do dono, com confirmação, e chama a API do n8n na hora; fica registrado quem pediu e quando. Fluxo marcado 'fala com cliente', quando desligado, para de mandar mensagem a cliente ou lead."
        actions={
          <button type="button" className={botao.icone} onClick={() => void q.refetch()} aria-label="Atualizar agora" title="Atualizar agora">
            <RefreshCw className={juntar("h-4 w-4", q.isFetching && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
          </button>
        }
        toolbar={
          <PillTabs<Aba> label="O que ver" value={aba} onChange={setAba} tabs={[
            { value: "fluxos", label: "Fluxos", icon: <Workflow className="h-3.5 w-3.5" />, count: numeros?.total },
            { value: "saude", label: "Saúde", icon: <Activity className="h-3.5 w-3.5" /> },
            { value: "ias", label: "Para as IAs", icon: <Bot className="h-3.5 w-3.5" /> },
          ]} />
        }
      />

      {q.isLoading ? <Carregando rotulo="Lendo as automações" linhas={8} />
        : q.error ? <EstadoDeErro titulo="Não foi possível ler as automações." descricao={(q.error as Error).message} acao={<button type="button" className={botao.secundario} onClick={() => void q.refetch()}>Tentar de novo</button>} />
        : !p?.disponivel ? <EmptyState icon={<Workflow className="h-5 w-5" />} title="O coletor do servidor ainda não mandou o primeiro retrato." />
        : aba === "saude" ? <Saude p={p} agora={agora} />
        : aba === "ias" ? <ParaAsIas />
        : (
          <div className="space-y-6">
            <StatGrid cols={4} label="As automações agora">
              <StatCard label="Ligados" value={numeros!.ligados} unit={`de ${numeros!.total}`} />
              <StatCard label="Rodadas em 24 h" value={numeros!.rodadas24h.toLocaleString("pt-BR")} />
              <StatCard label="Com erro em 24 h" value={numeros!.erros24h} hint={numeros!.erros24h ? "veja os marcados" : "nenhum"} />
              <StatCard label="Saúde" value={`${numeros!.saudeOk} de ${numeros!.saudeTotal}`} hint={numeros!.piorSaude ? numeros!.piorSaude.nome : "tudo ok"} footer={{ label: "Ver saúde", onClick: () => setAba("saude") }} />
            </StatGrid>

            <div className="flex flex-wrap items-center gap-2">
              <SearchField value={busca} onChange={setBusca} placeholder="Buscar fluxo" label="Buscar fluxo" className="min-w-0 flex-1 sm:max-w-xs" />
              <PillTabs<Filtro> variant="soft" size="sm" label="Filtrar" value={filtro} onChange={setFiltro} tabs={[
                { value: "todos", label: "Todos" },
                { value: "ligados", label: "Ligados" },
                { value: "desligados", label: "Desligados" },
                { value: "com_erro", label: "Com erro", count: numeros!.erros24h ? p.fluxos.filter((f) => f.erros24h > 0).length : undefined },
              ]} />
            </div>

            {grupos.length === 0 ? <EmptyState title="Nenhum fluxo com esse filtro." />
              : grupos.map((g) => (
                <Collapsible key={g.grupo} title={g.rotulo} count={g.fluxos.length} summary={`${g.ligados} ligados`} storageKey={`automacoes:grupo:${g.grupo}`} defaultOpen={!g.grupo.startsWith("Desligado") && g.grupo !== "Temporários"}>
                  <ul className={juntar(lista.aberta, lista.divisoria)} aria-label={g.rotulo}>
                    {g.fluxos.map((f) => (
                      <LinhaDoFluxo key={f.id} f={f} agora={agora} podeLigar={podeLigar} aoAbrir={() => setAbertoId(f.id)} aoAlternar={() => setPedido(f)} />
                    ))}
                  </ul>
                </Collapsible>
              ))}

            {p.acoes.length > 0 && (
              <Collapsible title="Ligado e desligado" count={p.acoes.length} storageKey="automacoes:acoes" defaultOpen={false} icon={<CircleAlert className="h-4 w-4" />}>
                <ul className="space-y-1">
                  {p.acoes.map((a, i) => <li key={i} className={texto.auxiliar}>{diaHora(a.quando)} · {a.quem} {a.acao === "ligar" ? "ligou" : "desligou"} "{a.fluxoNome}"{a.via === "mcp" ? " pelo MCP" : ""}{a.resultado === "falhou" ? ` · falhou: ${a.erro ?? ""}` : ""}</li>)}
                </ul>
              </Collapsible>
            )}
          </div>
        )}

      <JanelaDoFluxo id={abertoId} agora={agora} podeLigar={podeLigar} aoFechar={() => setAbertoId(null)} aoAlternar={(f) => setPedido(f)} />
      <Confirmacao fluxo={pedido} enviando={enviando} aoFechar={() => setPedido(null)} aoConfirmar={() => void confirmar()} />
    </div>
  );
}

