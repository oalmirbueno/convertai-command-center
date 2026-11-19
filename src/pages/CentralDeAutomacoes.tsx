import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Bot, Building2, CircleAlert, Copy, Folder, Power, RefreshCw, Users, Workflow } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Card, Collapsible, EmptyState, PillTabs, SearchField, StatCard, StatGrid, StatusDot, StatusPill, Chip, type Tone } from "@/components/ds";
import { CabecalhoDePagina, Carregando, EstadoDeErro, JanelaCentral, botao, campo, espaco, foco, juntar, larguraDaMesa, lista, superficie, texto, useEstadoDaTela } from "@/components/sistema";
import { useClients } from "@/hooks/useSupabaseData";
import CanvasDoFluxo from "@/components/automacoes/CanvasDoFluxo";
import { GUIA_DO_N8N } from "../../supabase/functions/_shared/automacoes-guia";
import {
  ROTULO_DO_MODO,
  ROTULO_DO_STATUS,
  agruparFluxos,
  pastasDaAceleriq,
  pastasDeClientes,
  type Pasta,
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

type Aba = "aceleriq" | "clientes" | "saude" | "ias";
const ABAS: Aba[] = ["aceleriq", "clientes", "saude", "ias"];

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
            {f.efeitoNoCliente && f.ativo && <span className="hidden shrink-0 sm:inline-flex"><Chip size="sm" tone="info">fala com cliente</Chip></span>}
            {f.efeitoNoCliente && f.ativo && <StatusDot tone="info" className="shrink-0 sm:hidden" />}
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
          <Switch className="shrink-0" checked={f.ativo} onCheckedChange={aoAlternar} aria-label={f.ativo ? `Desligar ${f.nome}` : `Ligar ${f.nome}`} title={f.ativo ? "Desligar" : "Ligar"} />
        ) : (
          <StatusPill plain tone={f.ativo ? "success" : "neutral"}>{f.ativo ? "ligado" : "desligado"}</StatusPill>
        )}
      </span>
    </li>
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
      descricao={d ? `${d.cliente ?? "Aceleriq"} · ${d.ativo ? "ligado" : "desligado"} · ${d.total24h} rodadas em 24 h` : undefined}
      largura="tela"
      acoes={d && podeLigar ? <Switch checked={d.ativo} onCheckedChange={() => aoAlternar(d)} aria-label={d.ativo ? "Desligar este fluxo" : "Ligar este fluxo"} title={d.ativo ? "Desligar" : "Ligar"} /> : undefined}
    >
      {q.isLoading ? <Carregando rotulo="Lendo o fluxo" linhas={5} />
        : q.error ? <EstadoDeErro titulo="Não foi possível ler o fluxo." descricao={(q.error as Error).message} />
        : !d ? <EmptyState title="Esse fluxo saiu do n8n." />
        : (
          <div className="space-y-6">
            {podeLigar && <DonoDoFluxo fluxo={d} />}
            <CanvasDoFluxo detalhe={d} execucao={execucao} />
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

/** Só o dono: de quem é o fluxo (Aceleriq ou um cliente). Muda a pasta onde ele aparece. */
function DonoDoFluxo({ fluxo }: { fluxo: DetalheDoFluxo }) {
  const qc = useQueryClient();
  const { data: clientes } = useClients();
  const [salvando, setSalvando] = useState(false);
  const opcoes = useMemo(() => ((clientes ?? []) as Array<{ id: string; company_name?: string | null; full_name?: string | null }>)
    .map((c) => ({ id: String(c.id), nome: String(c.company_name || c.full_name || "Cliente") }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), [clientes]);
  const mudar = async (valor: string) => {
    setSalvando(true);
    const { error } = await (supabase as any).rpc("automacoes_definir_cliente", { _fluxo_id: fluxo.id, _client_id: valor || null });
    setSalvando(false);
    if (error) { toast.error(`Não deu para mudar: ${error.message}`); return; }
    toast.success(valor ? `Agora está na pasta de ${opcoes.find((o) => o.id === valor)?.nome ?? "cliente"}` : "Voltou para as automações da Aceleriq");
    await Promise.all([qc.invalidateQueries({ queryKey: ["automacoes-painel"] }), qc.invalidateQueries({ queryKey: ["automacoes-fluxo"] })]);
  };
  return (
    <label className="flex min-w-0 flex-wrap items-center gap-2">
      <span className={texto.rotulo}>De quem é</span>
      <select className={juntar(campo, "w-auto min-w-[200px] max-w-full")} value={fluxo.clientId ?? ""} disabled={salvando} onChange={(e) => void mudar(e.target.value)} aria-label="De quem é este fluxo">
        <option value="">Aceleriq</option>
        {fluxo.clientId && !opcoes.some((o) => o.id === fluxo.clientId) && <option value={fluxo.clientId}>{fluxo.cliente ?? "Cliente"}</option>}
        {opcoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
      </select>
    </label>
  );
}

const cartaoDaPasta = juntar(superficie.painel, "group flex h-full w-full min-w-0 flex-col p-4 text-left transition-transform duration-200 [@media(hover:hover)]:hover:-translate-y-0.5 active:translate-y-0 sm:p-5", foco);

function CartaoDaPasta({ pasta, agora, aoAbrir }: { pasta: Pasta; agora: number; aoAbrir: () => void }) {
  const Icone = pasta.tipo === "cliente" ? Building2 : Folder;
  return (
    <li className="min-w-0" data-pasta={pasta.chave}>
      <button type="button" className={cartaoDaPasta} onClick={aoAbrir} title={`Abrir a pasta ${pasta.titulo}`}>
        <span className="flex min-w-0 items-center">
          <span aria-hidden="true" className="mr-3 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icone className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1">
            <span className={juntar(texto.tituloSecao, "block truncate")}>{pasta.titulo}</span>
            <span className={juntar(texto.auxiliar, "block truncate")}>{pasta.fluxos.length} {pasta.fluxos.length === 1 ? "fluxo" : "fluxos"} · {pasta.ligados} {pasta.ligados === 1 ? "ligado" : "ligados"}</span>
          </span>
          {pasta.erros24h > 0 ? <Chip tone="danger" dot className="ml-2">{pasta.erros24h} {pasta.erros24h === 1 ? "erro" : "erros"}</Chip>
            : pasta.ligados > 0 ? <Chip tone="success" dot className="ml-2">ok</Chip>
            : <Chip className="ml-2">parado</Chip>}
        </span>
        <span className="mt-4 flex min-w-0 flex-wrap gap-1.5" aria-hidden="true">
          {pasta.fluxos.slice(0, 16).map((f) => (
            <StatusDot key={f.id} tone={!f.ativo ? "neutral" : f.erros24h > 0 ? "danger" : "success"} className="h-2 w-2" />
          ))}
        </span>
        <span className={juntar(texto.auxiliar, "mt-auto flex min-w-0 items-center justify-between gap-2 pt-4 tabular-nums")}>
          <span className="truncate">{pasta.ultimaEm ? `última ${haQuanto(pasta.ultimaEm, agora)}` : "sem rodada"}</span>
          <span className="shrink-0">{pasta.rodadas24h.toLocaleString("pt-BR")} em 24 h</span>
        </span>
      </button>
    </li>
  );
}

function GradeDePastas({ pastas, agora, aoAbrir, vazio }: { pastas: Pasta[]; agora: number; aoAbrir: (p: Pasta) => void; vazio: string }) {
  if (pastas.length === 0) return <EmptyState title={vazio} />;
  return (
    <ul className={juntar(espaco.grade, "sm:grid-cols-2 xl:grid-cols-3")} aria-label="Pastas">
      {pastas.map((p) => <CartaoDaPasta key={p.chave} pasta={p} agora={agora} aoAbrir={() => aoAbrir(p)} />)}
    </ul>
  );
}

function JanelaDaPasta({ pasta, agora, podeLigar, aoFechar, aoAbrirFluxo, aoAlternar }: { pasta: Pasta | null; agora: number; podeLigar: boolean; aoFechar: () => void; aoAbrirFluxo: (id: string) => void; aoAlternar: (f: Fluxo) => void }) {
  return (
    <JanelaCentral
      aberta={pasta !== null}
      onMudar={(v) => { if (!v) aoFechar(); }}
      titulo={pasta?.titulo ?? "Pasta"}
      icone={pasta?.tipo === "cliente" ? <Building2 className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
      descricao={pasta ? `${pasta.fluxos.length} ${pasta.fluxos.length === 1 ? "fluxo" : "fluxos"} · ${pasta.ligados} ligados · ${pasta.tipo === "cliente" ? "do cliente" : "da Aceleriq"}` : undefined}
      largura="lg"
    >
      {pasta && (
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label={pasta.titulo}>
          {pasta.fluxos.map((f) => (
            <LinhaDoFluxo key={f.id} f={f} agora={agora} podeLigar={podeLigar} aoAbrir={() => aoAbrirFluxo(f.id)} aoAlternar={() => aoAlternar(f)} />
          ))}
        </ul>
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
  const [params, setParams] = useSearchParams();
  const [aba, setAba] = useEstadoDaTela<Aba>("automacoes:aba", "aceleriq", { validar: (v) => (ABAS as string[]).includes(String(v)) });
  const [busca, setBusca] = useState("");
  const [pastaAberta, setPastaAberta] = useState<string | null>(null);
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [pedido, setPedido] = useState<Fluxo | null>(null);
  const [enviando, setEnviando] = useState(false);

  const p = q.data;
  const podeLigar = Boolean(p?.podeLigar);
  const daAceleriq = useMemo(() => pastasDaAceleriq(p?.fluxos ?? []), [p]);
  const deClientes = useMemo(() => pastasDeClientes(p?.fluxos ?? []), [p]);
  const numeros = useMemo(() => (p ? numerosDoPainel(p) : null), [p]);
  const achados = useMemo(() => (busca.trim() ? agruparFluxos(p?.fluxos ?? [], { busca }).flatMap((g) => g.fluxos) : []), [p, busca]);
  const pasta = [...daAceleriq, ...deClientes].find((x) => x.chave === pastaAberta) ?? null;
  const fluxosDaAceleriq = daAceleriq.reduce((n, x) => n + x.fluxos.length, 0);
  const ligadosDaAceleriq = daAceleriq.reduce((n, x) => n + x.ligados, 0);
  const fluxosDeClientes = deClientes.reduce((n, x) => n + x.fluxos.length, 0);

  // Link da ficha do cliente: /automacoes?cliente=<id> abre a pasta dele.
  const clienteDoLink = params.get("cliente");
  useEffect(() => {
    if (!clienteDoLink || !p) return;
    setAba("clientes");
    setPastaAberta(`cliente:${clienteDoLink}`);
    const novo = new URLSearchParams(params);
    novo.delete("cliente");
    setParams(novo, { replace: true });
  }, [clienteDoLink, p, params, setParams, setAba]);

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

  const numero = (qual: Aba) => ({ variant: aba === qual ? ("accent" as const) : ("default" as const), onClick: () => { setAba(qual); setBusca(""); } });
  const comBusca = (aba === "aceleriq" || aba === "clientes") && busca.trim() !== "";

  return (
    <div className={juntar(larguraDaMesa, espaco.pagina, "pb-10")} data-central-de-automacoes="">
      <CabecalhoDePagina
        titulo="Automações"
        descricao={p?.disponivel ? `atualizado ${haQuanto(p.coletadoEm, agora)}${p.atrasada ? " · coletor parado" : ""}` : undefined}
        ajuda="Todos os fluxos do n8n de produção, em pastas: as da Aceleriq (o que move a casa e atende todos os clientes) e as de cada cliente (fluxo feito para ele). Clique numa pasta para ver os fluxos e num fluxo para ver o desenho e as execuções. Um coletor no servidor lê o n8n a cada minuto, só leitura; o painel nunca entra no servidor. Ligar, desligar e dizer de quem é o fluxo é só do dono, com confirmação e registro. Fluxo que fala com cliente, quando desligado, para de mandar mensagem a cliente ou lead."
        acoes={
          <button type="button" className={botao.icone} onClick={() => void q.refetch()} aria-label="Atualizar agora" title="Atualizar agora">
            <RefreshCw className={juntar("h-4 w-4", q.isFetching && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
          </button>
        }
      />

      {q.isLoading ? <Carregando rotulo="Lendo as automações" linhas={8} />
        : q.error ? <EstadoDeErro titulo="Não foi possível ler as automações." descricao={(q.error as Error).message} acao={<button type="button" className={botao.secundario} onClick={() => void q.refetch()}>Tentar de novo</button>} />
        : !p?.disponivel ? <EmptyState icon={<Workflow className="h-5 w-5" />} title="O coletor do servidor ainda não mandou o primeiro retrato." />
        : (
          <>
            <StatGrid cols={4} label="As automações agora: cada número abre a sua parte">
              <StatCard {...numero("aceleriq")} label="Da Aceleriq" value={String(fluxosDaAceleriq)} icon={<Workflow className="h-4 w-4" />} progress={{ value: ligadosDaAceleriq, max: Math.max(fluxosDaAceleriq, 1) }} hint={`${ligadosDaAceleriq} ligados em ${daAceleriq.length} pastas`} />
              <StatCard {...numero("clientes")} label="De clientes" value={String(fluxosDeClientes)} icon={<Users className="h-4 w-4" />} hint={deClientes.length === 1 ? "1 cliente" : `${deClientes.length} clientes`} />
              <StatCard label="Com erro em 24 h" value={String(numeros!.erros24h)} icon={<AlertTriangle className="h-4 w-4" />} hint={`${numeros!.rodadas24h.toLocaleString("pt-BR")} rodadas`} />
              <StatCard {...numero("saude")} label="Saúde" value={`${numeros!.saudeOk} de ${numeros!.saudeTotal}`} icon={<Activity className="h-4 w-4" />} hint={numeros!.piorSaude ? numeros!.piorSaude.nome : "tudo ok"} />
            </StatGrid>

            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <PillTabs<Aba> label="Partes das automações" value={aba} onChange={(v) => { setAba(v); setBusca(""); }} tabs={[
                { value: "aceleriq", label: "Da Aceleriq", count: fluxosDaAceleriq },
                { value: "clientes", label: "De clientes", count: fluxosDeClientes },
                { value: "saude", label: "Saúde" },
                { value: "ias", label: "Para as IAs" },
              ]} />
              {(aba === "aceleriq" || aba === "clientes") && <SearchField value={busca} onChange={setBusca} placeholder="Buscar fluxo" label="Buscar fluxo" className="w-full min-w-0 sm:w-64" />}
            </div>

            {comBusca ? (
              <Card as="section" title="Busca" subtitle={achados.length === 1 ? "1 fluxo" : `${achados.length} fluxos`}>
                {achados.length === 0 ? <EmptyState title="Nenhum fluxo com esse nome." /> : (
                  <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Fluxos achados">
                    {achados.map((f) => <LinhaDoFluxo key={f.id} f={f} agora={agora} podeLigar={podeLigar} aoAbrir={() => setAbertoId(f.id)} aoAlternar={() => setPedido(f)} />)}
                  </ul>
                )}
              </Card>
            ) : aba === "aceleriq" ? (
              <GradeDePastas pastas={daAceleriq} agora={agora} aoAbrir={(x) => setPastaAberta(x.chave)} vazio="Nenhum fluxo da Aceleriq." />
            ) : aba === "clientes" ? (
              <GradeDePastas pastas={deClientes} agora={agora} aoAbrir={(x) => setPastaAberta(x.chave)} vazio="Nenhum fluxo de cliente ainda. Abra um fluxo e escolha de quem ele é." />
            ) : aba === "saude" ? <Saude p={p} agora={agora} /> : <ParaAsIas />}

            {aba !== "ias" && p.acoes.length > 0 && (
              <Collapsible title="Ligado e desligado" count={p.acoes.length} storageKey="automacoes:acoes" defaultOpen={false} icon={<CircleAlert className="h-4 w-4" />}>
                <ul className="space-y-1">
                  {p.acoes.map((a, i) => <li key={i} className={texto.auxiliar}>{diaHora(a.quando)} · {a.quem} {a.acao === "ligar" ? "ligou" : "desligou"} "{a.fluxoNome}"{a.via === "mcp" ? " pelo MCP" : ""}{a.resultado === "falhou" ? ` · falhou: ${a.erro ?? ""}` : ""}</li>)}
                </ul>
              </Collapsible>
            )}
          </>
        )}

      <JanelaDaPasta pasta={pasta} agora={agora} podeLigar={podeLigar} aoFechar={() => setPastaAberta(null)} aoAbrirFluxo={setAbertoId} aoAlternar={setPedido} />
      <JanelaDoFluxo id={abertoId} agora={agora} podeLigar={podeLigar} aoFechar={() => setAbertoId(null)} aoAlternar={(f) => setPedido(f)} />
      <Confirmacao fluxo={pedido} enviando={enviando} aoFechar={() => setPedido(null)} aoConfirmar={() => void confirmar()} />
    </div>
  );
}
