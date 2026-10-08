import { useState, type ReactNode } from "react";
import { ChevronRight, Download, ExternalLink, FileText, Package } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { botao, conversa, etiqueta, foco, juntar, superficie, texto, toqueCompacto } from "@/components/sistema/estilos";
import {
  ROTULO_DO_ESTADO,
  ESTADOS_DE_ETAPA,
  urlSegura,
  type BlocoArquivo,
  type BlocoDeResposta,
  type BlocoEntrega,
  type BlocoFluxo,
  type BlocoGrafico,
  type BlocoMetricas,
  type BlocoProgresso,
  type BlocoTabela,
  type BlocoTexto,
  type CelulaDaTabela,
  type EstadoDeEtapa,
  type ObjetoDoPainel,
  type TomDeMetrica,
} from "@/lib/agentes/blocosDeResposta";

/**
 * Registro único dos componentes de resposta dos agentes (Gestor, Hermes,
 * Mesas). Recebe blocos que JÁ passaram por `validarBlocos`
 * (src/lib/agentes/blocosDeResposta.ts) e só desenha o que está neles: nada
 * de número, estado ou link que o bloco não trouxe.
 *
 * Padrão visual (docs/design/SISTEMA.md): escala de fonte fechada, cartão só
 * onde é uma coisa (tabela, fluxo, entrega, arquivo), espaço por margem em
 * flex (Safari 11), tabela rola por dentro na horizontal, nada pisca.
 */

export interface AcoesDaResposta {
  /** Abrir o objeto do painel (tarefa, post, arquivo...) que o bloco cita. */
  aoAbrirObjeto?: (objeto: ObjetoDoPainel) => void;
  /** Abrir a fonte citada (apelido que o servidor deu à fonte lida). */
  aoAbrirFonte?: (apelido: string) => void;
}

export interface PropsDosBlocos extends AcoesDaResposta {
  blocos: BlocoDeResposta[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Pedaços comuns
// ---------------------------------------------------------------------------

const numeroPtBr = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

function comUnidade(n: number, unidade?: string): string {
  const v = numeroPtBr(n);
  if (!unidade) return v;
  if (unidade === "R$") return `R$ ${v}`;
  if (unidade === "%") return `${v}%`;
  return `${v} ${unidade}`;
}

function numeroCurto(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${numeroPtBr(Math.round(n / 1e8) / 10)} bi`;
  if (a >= 1e6) return `${numeroPtBr(Math.round(n / 1e5) / 10)} mi`;
  if (a >= 1e4) return `${numeroPtBr(Math.round(n / 1e2) / 10)} mil`;
  return numeroPtBr(n);
}

function ehEstado(v: string): v is EstadoDeEtapa {
  return (ESTADOS_DE_ETAPA as readonly string[]).indexOf(v) >= 0;
}

const COR_DO_ESTADO: Record<EstadoDeEtapa, string> = {
  planejado: "border border-muted-foreground bg-transparent",
  em_execucao: "bg-primary",
  aguardando_aprovacao: "bg-warning",
  bloqueado: "bg-destructive",
  concluido: "bg-success",
};

/** Ponto do estado real da etapa (sem estado: ponto apagado). */
export function PontoDoEstado({ estado, className }: { estado?: EstadoDeEtapa; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-estado={estado || "sem_estado"}
      className={juntar("inline-block h-2.5 w-2.5 shrink-0 rounded-full", estado ? COR_DO_ESTADO[estado] : "bg-muted-foreground/40", className)}
    />
  );
}

function TituloDoBloco({ children, lado }: { children?: ReactNode; lado?: ReactNode }) {
  if (!children && !lado) return null;
  return (
    <div className="mb-2 flex min-w-0 items-center">
      {children ? <h3 className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-semibold")}>{children}</h3> : <span className="flex-1" />}
      {lado ? <span className="ml-2 shrink-0">{lado}</span> : null}
    </div>
  );
}

/** Chips das fontes citadas. Com `aoAbrirFonte`, cada chip abre a fonte. */
export function FontesDaResposta({ fontes, aoAbrirFonte }: { fontes?: string[]; aoAbrirFonte?: (apelido: string) => void }) {
  if (!fontes || !fontes.length) return null;
  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center" data-fontes="">
      <span className={juntar(texto.etiqueta, "mr-1.5 mt-1 text-muted-foreground")}>Fontes</span>
      {fontes.map((f) =>
        aoAbrirFonte ? (
          <button
            key={f}
            type="button"
            onClick={() => aoAbrirFonte(f)}
            title={`Abrir fonte ${f}`}
            className={juntar(etiqueta, toqueCompacto, foco, "mr-1.5 mt-1 max-w-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground")}
          >
            <span className="truncate">{f}</span>
          </button>
        ) : (
          <span key={f} className={juntar(etiqueta, "mr-1.5 mt-1 max-w-full border border-border text-muted-foreground")}>
            <span className="truncate">{f}</span>
          </span>
        ),
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// texto
// ---------------------------------------------------------------------------

export function TextoDaResposta({ bloco }: { bloco: BlocoTexto }) {
  return (
    <p data-bloco="texto" className={juntar("whitespace-pre-wrap [overflow-wrap:anywhere]", conversa.mensagem)}>
      {bloco.texto}
    </p>
  );
}

// ---------------------------------------------------------------------------
// tabela
// ---------------------------------------------------------------------------

const LINHAS_VISIVEIS = 10;

function Celula({ valor }: { valor: CelulaDaTabela }) {
  if (valor === null) return <span className="text-muted-foreground">s/d</span>;
  if (typeof valor === "number") return <>{numeroPtBr(valor)}</>;
  return <>{valor}</>;
}

export function TabelaDaResposta({ bloco, aoAbrirFonte }: { bloco: BlocoTabela } & AcoesDaResposta) {
  const [todas, setTodas] = useState(false);
  const numericas = bloco.colunas.map((_, j) => {
    let algum = false;
    for (const linha of bloco.linhas) {
      const c = linha[j];
      if (c === null) continue;
      if (typeof c !== "number") return false;
      algum = true;
    }
    return algum;
  });
  const sobra = bloco.linhas.length - LINHAS_VISIVEIS;
  const linhas = todas || sobra <= 0 ? bloco.linhas : bloco.linhas.slice(0, LINHAS_VISIVEIS);
  return (
    <div data-bloco="tabela" className="min-w-0">
      <TituloDoBloco>{bloco.titulo}</TituloDoBloco>
      <div className={juntar(superficie.painel, "min-w-0 overflow-hidden")}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {bloco.colunas.map((c, j) => (
                  <th key={j} scope="col" className={juntar(texto.rotulo, "whitespace-nowrap border-b border-border px-3 py-2", numericas[j] ? "text-right" : "text-left")}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((linha, i) => (
                <tr key={i} className="border-b border-border/50 last:border-b-0">
                  {linha.map((c, j) => (
                    <td
                      key={j}
                      className={juntar(
                        texto.corpo,
                        "px-3 py-2 align-top",
                        numericas[j] ? "whitespace-nowrap text-right tabular-nums" : "min-w-[96px] max-w-[280px] [overflow-wrap:anywhere]",
                      )}
                    >
                      <Celula valor={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {sobra > 0 ? (
        <button type="button" onClick={() => setTodas(!todas)} className={juntar(botao.discreto, "mt-1 h-8 px-2")}>
          {todas ? "Mostrar menos" : `Mostrar todas (${bloco.linhas.length})`}
        </button>
      ) : null}
      <FontesDaResposta fontes={bloco.fontes} aoAbrirFonte={aoAbrirFonte} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// metricas
// ---------------------------------------------------------------------------

const COR_DO_TOM: Record<TomDeMetrica, string> = {
  neutro: "text-muted-foreground",
  bom: "text-success",
  alerta: "text-warning",
  perigo: "text-destructive",
};

export function MetricasDaResposta({ bloco, aoAbrirFonte }: { bloco: BlocoMetricas } & AcoesDaResposta) {
  return (
    <div data-bloco="metricas" className="min-w-0">
      <TituloDoBloco>{bloco.titulo}</TituloDoBloco>
      <dl className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
        {bloco.itens.map((it, i) => (
          <div key={i} className={juntar(superficie.poco, "min-w-0 px-3 py-2.5")} data-metrica="">
            <dt className={juntar(texto.rotulo, "truncate")} title={it.rotulo}>
              {it.rotulo}
            </dt>
            <dd className="min-w-0">
              <span className="block truncate text-[20px] font-semibold leading-7 tabular-nums text-foreground">
                {typeof it.valor === "number" ? numeroPtBr(it.valor) : it.valor}
              </span>
              {it.variacao ? <span className={juntar(texto.etiqueta, "block truncate", COR_DO_TOM[it.tom || "neutro"])}>{it.variacao}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      <FontesDaResposta fontes={bloco.fontes} aoAbrirFonte={aoAbrirFonte} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// grafico
// ---------------------------------------------------------------------------

const TOKENS_DE_COR = ["--primary", "--info", "--warning", "--muted-foreground"];
const CORES = TOKENS_DE_COR.map((t) => `hsl(var(${t}))`);
const CORES_DA_PIZZA = CORES.concat(
  TOKENS_DE_COR.map((t) => `hsl(var(${t}) / 0.55)`),
  TOKENS_DE_COR.map((t) => `hsl(var(${t}) / 0.3)`),
);

const eixo = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const dica = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 };

export function GraficoDaResposta({ bloco, aoAbrirFonte }: { bloco: BlocoGrafico } & AcoesDaResposta) {
  const [verNumeros, setVerNumeros] = useState(false);
  const pizza = bloco.tipo_grafico === "pizza";
  // Linhas do gráfico: um x por linha, na ordem em que aparece; série sem o x fica vazia (não zero).
  const xs: string[] = [];
  const vistos: Record<string, number> = {};
  const linhas: Array<Record<string, string | number | null>> = [];
  bloco.series.forEach((s, i) => {
    for (const p of s.pontos) {
      if (vistos[p.x] === undefined) {
        vistos[p.x] = xs.length;
        xs.push(p.x);
        const vazia: Record<string, string | number | null> = { x: p.x };
        bloco.series.forEach((_, k) => (vazia[`s${k}`] = null));
        linhas.push(vazia);
      }
      linhas[vistos[p.x]][`s${i}`] = p.y;
    }
  });
  const formatar = (v: unknown) => (typeof v === "number" ? comUnidade(v, bloco.unidade) : String(v));
  const legenda = pizza
    ? bloco.series[0].pontos.map((p, i) => ({ nome: p.x, cor: CORES_DA_PIZZA[i % CORES_DA_PIZZA.length], valor: formatar(p.y) }))
    : bloco.series.map((s, i) => ({ nome: s.nome, cor: CORES[i % CORES.length], valor: "" }));

  return (
    <div data-bloco="grafico" className="min-w-0">
      <TituloDoBloco lado={bloco.unidade ? <span className={juntar(texto.etiqueta, "text-muted-foreground")}>{bloco.unidade}</span> : null}>{bloco.titulo}</TituloDoBloco>
      <div className="h-[220px] w-full min-w-0" role="img" aria-label={bloco.titulo || (pizza ? bloco.series[0].nome : bloco.series.map((s) => s.nome).join(", "))}>
        <ResponsiveContainer width="100%" height="100%">
          {pizza ? (
            <PieChart>
              <Tooltip contentStyle={dica} formatter={(v: unknown) => formatar(v)} />
              <Pie data={bloco.series[0].pontos} dataKey="y" nameKey="x" innerRadius="45%" outerRadius="80%" paddingAngle={1} stroke="hsl(var(--card))" isAnimationActive={false}>
                {bloco.series[0].pontos.map((_, i) => (
                  <Cell key={i} fill={CORES_DA_PIZZA[i % CORES_DA_PIZZA.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : bloco.tipo_grafico === "barras" ? (
            <BarChart data={linhas} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="x" tick={eixo} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
              <YAxis tick={eixo} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => numeroCurto(v)} />
              <Tooltip contentStyle={dica} formatter={(v: unknown) => formatar(v)} cursor={{ fill: "hsl(var(--muted) / 0.5)" }} />
              {bloco.series.map((s, i) => (
                <Bar key={i} dataKey={`s${i}`} name={s.nome} fill={CORES[i % CORES.length]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              ))}
            </BarChart>
          ) : (
            <LineChart data={linhas} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="x" tick={eixo} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
              <YAxis tick={eixo} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => numeroCurto(v)} />
              <Tooltip contentStyle={dica} formatter={(v: unknown) => formatar(v)} />
              {bloco.series.map((s, i) => (
                <Line key={i} type="monotone" dataKey={`s${i}`} name={s.nome} stroke={CORES[i % CORES.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center">
        {legenda.map((l, i) => (
          <span key={i} className={juntar(texto.auxiliar, "mr-3 mt-1 flex min-w-0 max-w-full items-center")}>
            <span className="mr-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: l.cor }} aria-hidden="true" />
            <span className="truncate">{l.nome}</span>
            {l.valor ? <span className="ml-1 shrink-0 tabular-nums text-foreground">{l.valor}</span> : null}
          </span>
        ))}
        <button type="button" onClick={() => setVerNumeros(!verNumeros)} aria-expanded={verNumeros} className={juntar(botao.discreto, "ml-auto mt-1 h-8 px-2")}>
          {verNumeros ? "Esconder números" : "Ver números"}
        </button>
      </div>
      {verNumeros ? (
        <div className="mt-1 overflow-x-auto" data-numeros-do-grafico="">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th scope="col" className={juntar(texto.rotulo, "whitespace-nowrap border-b border-border px-2 py-1.5 text-left")} />
                {bloco.series.map((s, i) => (
                  <th key={i} scope="col" className={juntar(texto.rotulo, "whitespace-nowrap border-b border-border px-2 py-1.5 text-right")}>
                    {s.nome}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={i} className="border-b border-border/50 last:border-b-0">
                  <th scope="row" className={juntar(texto.auxiliar, "whitespace-nowrap px-2 py-1.5 text-left font-normal")}>
                    {l.x}
                  </th>
                  {bloco.series.map((_, k) => {
                    const v = l[`s${k}`];
                    return (
                      <td key={k} className={juntar(texto.corpo, "whitespace-nowrap px-2 py-1.5 text-right tabular-nums")}>
                        {typeof v === "number" ? formatar(v) : <span className="text-muted-foreground">s/d</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <FontesDaResposta fontes={bloco.fontes} aoAbrirFonte={aoAbrirFonte} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// fluxo
// ---------------------------------------------------------------------------

/** Camadas do fluxo (ordem topológica pelo caminho mais longo). Sem ligações: um passo depois do outro. */
export function camadasDoFluxo(bloco: BlocoFluxo): string[][] {
  const ids = bloco.passos.map((p) => p.id);
  const ligs = bloco.ligacoes && bloco.ligacoes.length ? bloco.ligacoes : ids.slice(1).map((id, i) => ({ de: ids[i], para: id }));
  const ordem: Record<string, number> = {};
  const entrada: Record<string, number> = {};
  const saidas: Record<string, string[]> = {};
  const nivel: Record<string, number> = {};
  ids.forEach((id, i) => {
    ordem[id] = i;
    entrada[id] = 0;
    saidas[id] = [];
    nivel[id] = 0;
  });
  for (const l of ligs) {
    saidas[l.de].push(l.para);
    entrada[l.para] += 1;
  }
  const fila = ids.filter((id) => entrada[id] === 0);
  const feitos: Record<string, true> = {};
  while (fila.length) {
    const id = fila.shift() as string;
    feitos[id] = true;
    for (const para of saidas[id]) {
      nivel[para] = Math.max(nivel[para], nivel[id] + 1);
      entrada[para] -= 1;
      if (entrada[para] === 0) fila.push(para);
    }
  }
  // Ciclo (volta para trás): os passos que sobraram vão depois, na ordem dada.
  let maior = 0;
  for (const id of ids) if (feitos[id]) maior = Math.max(maior, nivel[id]);
  for (const id of ids) if (!feitos[id]) nivel[id] = ++maior;
  const camadas: string[][] = [];
  for (const id of ids) {
    const n = nivel[id];
    while (camadas.length <= n) camadas.push([]);
    camadas[n].push(id);
  }
  return camadas.filter((c) => c.length).map((c) => c.sort((a, b) => ordem[a] - ordem[b]));
}

function Conector() {
  return (
    <div className="flex justify-center py-0.5 text-muted-foreground" aria-hidden="true">
      <svg width="12" height="20" viewBox="0 0 12 20" fill="none">
        <path d="M6 0V17" stroke="currentColor" strokeWidth="1.25" />
        <path d="M2.5 13.5L6 17.5L9.5 13.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function FluxoDaResposta({ bloco }: { bloco: BlocoFluxo }) {
  const proposta = bloco.natureza === "proposta";
  const porId: Record<string, BlocoFluxo["passos"][number]> = {};
  for (const p of bloco.passos) porId[p.id] = p;
  const camadas = camadasDoFluxo(bloco);
  const nivelDe: Record<string, number> = {};
  camadas.forEach((c, n) => c.forEach((id) => (nivelDe[id] = n)));
  const ligs = bloco.ligacoes || [];
  // Linear (uma coluna, cada ligação vai para a camada seguinte, sem rótulo): só as setas bastam.
  const linear = camadas.every((c) => c.length === 1) && ligs.every((l) => !l.rotulo && nivelDe[l.para] === nivelDe[l.de] + 1);
  const selo = proposta ? (
    <span className={juntar(etiqueta, "border border-dashed border-info/60 text-info")} data-natureza="proposta">
      Proposta
    </span>
  ) : (
    <span className={juntar(etiqueta, "bg-primary/10 text-primary")} data-natureza="registro">
      Estado no sistema
    </span>
  );
  return (
    <div data-bloco="fluxo" className={juntar(superficie.painel, "min-w-0 p-3")}>
      <TituloDoBloco lado={selo}>{bloco.titulo || (proposta ? "Plano" : "Fluxo")}</TituloDoBloco>
      <ol className="min-w-0" aria-label={proposta ? "Passos propostos" : "Passos registrados"}>
        {camadas.map((camada, n) => (
          <li key={n} className="min-w-0">
            {n > 0 ? <Conector /> : null}
            <div className={juntar("grid min-w-0 gap-2", camada.length > 1 && "sm:grid-cols-2", camada.length > 2 && "lg:grid-cols-3")}>
              {camada.map((id) => {
                const p = porId[id];
                const saem = linear ? [] : ligs.filter((l) => l.de === id);
                return (
                  <div
                    key={id}
                    data-passo={id}
                    className={juntar(superficie.poco, "min-w-0 px-3 py-2", proposta && "border border-dashed border-border bg-transparent")}
                  >
                    <div className="flex min-w-0 items-center">
                      <PontoDoEstado estado={p.estado} className="mr-2" />
                      <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")} title={p.rotulo}>
                        {p.rotulo}
                      </span>
                      {p.estado ? <span className={juntar(texto.etiqueta, "ml-2 shrink-0 text-muted-foreground")}>{ROTULO_DO_ESTADO[p.estado]}</span> : null}
                    </div>
                    {p.detalhe ? <p className={juntar(texto.auxiliar, "mt-0.5 [overflow-wrap:anywhere]")}>{p.detalhe}</p> : null}
                    {saem.length ? (
                      <ul className="mt-1 min-w-0">
                        {saem.map((l, k) => (
                          <li key={k} className={juntar(texto.etiqueta, "flex min-w-0 items-center font-normal text-muted-foreground")}>
                            <ChevronRight className="mr-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">
                              {l.rotulo ? `${l.rotulo}: ` : ""}
                              {porId[l.para].rotulo}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// entrega
// ---------------------------------------------------------------------------

export function EntregaDaResposta({ bloco, aoAbrirObjeto }: { bloco: BlocoEntrega } & AcoesDaResposta) {
  const estado = ehEstado(bloco.estado) ? ROTULO_DO_ESTADO[bloco.estado] : bloco.estado;
  const linha2 = [bloco.tipo_objeto, bloco.cliente].filter(Boolean).join(" · ");
  const miolo = (
    <>
      <span className={juntar(superficie.poco, "mr-3 flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground")} aria-hidden="true">
        <Package className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={juntar(texto.corpo, "block truncate font-medium")}>{bloco.nome}</span>
        <span className={juntar(texto.auxiliar, "block truncate")}>{linha2}</span>
        {bloco.proxima ? <span className={juntar(texto.auxiliar, "block truncate")}>Próximo: {bloco.proxima}</span> : null}
      </span>
      <span className={juntar(etiqueta, "ml-2 max-w-[40%] bg-muted text-foreground")} data-estado-da-entrega="">
        <span className="truncate">{estado}</span>
      </span>
      {bloco.objeto && aoAbrirObjeto ? <ChevronRight className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
    </>
  );
  if (bloco.objeto && aoAbrirObjeto) {
    const objeto = bloco.objeto;
    return (
      <button
        type="button"
        data-bloco="entrega"
        onClick={() => aoAbrirObjeto(objeto)}
        aria-label={`Abrir ${bloco.nome}`}
        className={juntar(superficie.painel, foco, "flex w-full min-w-0 items-center px-3 py-2.5 text-left transition-colors hover:bg-muted/40")}
      >
        {miolo}
      </button>
    );
  }
  return (
    <div data-bloco="entrega" className={juntar(superficie.painel, "flex w-full min-w-0 items-center px-3 py-2.5")}>
      {miolo}
    </div>
  );
}

// ---------------------------------------------------------------------------
// arquivo
// ---------------------------------------------------------------------------

export function ArquivoDaResposta({ bloco, aoAbrirObjeto }: { bloco: BlocoArquivo } & AcoesDaResposta) {
  const [imagemFalhou, setImagemFalhou] = useState(false);
  // Defesa em dobro: o componente também recusa url que não é https.
  const url = bloco.url ? urlSegura(bloco.url) : null;
  const imagem = !!url && !!bloco.mime && bloco.mime.indexOf("image/") === 0 && !imagemFalhou;
  const objeto = bloco.objeto;
  return (
    <div data-bloco="arquivo" className={juntar(superficie.painel, "min-w-0 overflow-hidden")}>
      {imagem ? (
        <img
          src={url as string}
          alt={bloco.nome}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImagemFalhou(true)}
          className="block max-h-[240px] w-full bg-muted/50 object-contain"
        />
      ) : null}
      <div className="flex min-w-0 items-center px-3 py-2">
        <FileText className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className={juntar(texto.corpo, "block truncate font-medium")} title={bloco.nome}>
            {bloco.nome}
          </span>
          {bloco.mime ? <span className={juntar(texto.auxiliar, "block truncate")}>{bloco.mime}</span> : null}
        </span>
        {objeto && aoAbrirObjeto ? (
          <button type="button" onClick={() => aoAbrirObjeto({ tipo: "arquivo", id: objeto.id, titulo: bloco.nome })} className={juntar(botao.discreto, "ml-1 h-8 px-2")}>
            <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Abrir
          </button>
        ) : null}
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" download={bloco.nome} className={juntar(botao.discreto, "ml-1 h-8 px-2")}>
            <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Baixar
          </a>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// progresso
// ---------------------------------------------------------------------------

export function ProgressoDaResposta({ bloco }: { bloco: BlocoProgresso }) {
  const concluidas = bloco.etapas.filter((e) => e.estado === "concluido").length;
  return (
    <div data-bloco="progresso" className="min-w-0">
      <TituloDoBloco lado={<span className={juntar(texto.etiqueta, "tabular-nums text-muted-foreground")}>{`${concluidas} de ${bloco.etapas.length}`}</span>}>
        {bloco.titulo}
      </TituloDoBloco>
      <ol className="ml-1 min-w-0 border-l border-border pl-4">
        {bloco.etapas.map((e, i) => (
          <li key={i} className="relative min-w-0 pb-3 last:pb-0" data-etapa={e.estado}>
            <PontoDoEstado estado={e.estado} className={juntar("absolute -left-[21.5px] top-[5px]", e.estado === "planejado" && "bg-background")} />
            <div className="flex min-w-0 items-center">
              <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")} title={e.rotulo}>
                {e.rotulo}
              </span>
              {e.quando ? <span className={juntar(texto.etiqueta, "ml-2 shrink-0 font-normal tabular-nums text-muted-foreground")}>{e.quando}</span> : null}
            </div>
            <span className={juntar(texto.auxiliar, "block")}>{ROTULO_DO_ESTADO[e.estado]}</span>
            {e.evidencia ? <p className={juntar(texto.auxiliar, "mt-0.5 [overflow-wrap:anywhere]")}>{e.evidencia}</p> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

/** Um bloco validado no seu componente. Tipo desconhecido não desenha nada. */
export function BlocoDaResposta({ bloco, aoAbrirObjeto, aoAbrirFonte }: { bloco: BlocoDeResposta } & AcoesDaResposta) {
  switch (bloco.tipo) {
    case "texto":
      return <TextoDaResposta bloco={bloco} />;
    case "tabela":
      return <TabelaDaResposta bloco={bloco} aoAbrirFonte={aoAbrirFonte} />;
    case "metricas":
      return <MetricasDaResposta bloco={bloco} aoAbrirFonte={aoAbrirFonte} />;
    case "grafico":
      return <GraficoDaResposta bloco={bloco} aoAbrirFonte={aoAbrirFonte} />;
    case "fluxo":
      return <FluxoDaResposta bloco={bloco} />;
    case "entrega":
      return <EntregaDaResposta bloco={bloco} aoAbrirObjeto={aoAbrirObjeto} />;
    case "arquivo":
      return <ArquivoDaResposta bloco={bloco} aoAbrirObjeto={aoAbrirObjeto} />;
    case "progresso":
      return <ProgressoDaResposta bloco={bloco} />;
    default:
      return null;
  }
}

export default function BlocosDeResposta({ blocos, aoAbrirObjeto, aoAbrirFonte, className }: PropsDosBlocos) {
  if (!blocos || !blocos.length) return null;
  return (
    <div className={juntar("min-w-0 space-y-3", className)} data-blocos-de-resposta="">
      {blocos.map((b, i) => (
        <BlocoDaResposta key={i} bloco={b} aoAbrirObjeto={aoAbrirObjeto} aoAbrirFonte={aoAbrirFonte} />
      ))}
    </div>
  );
}
