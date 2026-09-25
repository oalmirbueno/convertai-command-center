import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, CheckCircle2, ChevronDown, Compass, ExternalLink, Lightbulb, Loader2, Target, TrendingUp, XCircle } from "lucide-react";

/**
 * Diagnóstico do mês organizado (Frente O, pedido do dono em 26/09: "está
 * vindo como um textão que polui muito; organizar, pré-abrir recolhido, com
 * scroll dentro, mais organizado e bonito").
 *
 * Recolhido por padrão: só o resumo e até 3 chips. Aberto: seções com título
 * e listas, rolagem própria de até 420 px. Lê o JSON que o agente-calendario
 * grava em parametros.diagnostico_estruturado (ou numa coluna própria, se um
 * dia existir) e, sem ele, quebra o texto antigo em parágrafos e seções.
 *
 * Safari 11: sem gap em flex (margens), sem proporção fixa (aspect ratio), sem seletor has,
 * sem os métodos at, hasOwn, flat e o replace global novo, sem lookbehind e sem funções
 * de CSS (mínimo, máximo, faixa) em classe arbitrária.
 */

export type PropostaDoDiagnostico = {
  id?: string;
  diagnostico?: string | null;
  parametros?: Record<string, any> | null;
  diagnostico_estruturado?: unknown;
} | null | undefined;

type Ponto = { ponto: string; evidencia: string };
type Oportunidade = { data: string | null; tema: string; por_que: string };
type Tendencia = { tendencia: string; como_usar: string; fonte: string | null };
type Recomendacao = { acao: string; por_que: string; prioridade: "alta" | "media" | "baixa" };
type Mistura = { topo: number; meio: number; fundo: number; justificativa: string };
type Fonte = { titulo: string; url: string };

export type DiagnosticoLido = {
  origem: "pesquisa" | "frentes";
  resumo: string;
  o_que_funciona: Ponto[];
  o_que_nao_funciona: Ponto[];
  oportunidades_do_mes: Oportunidade[];
  tendencias_do_nicho: Tendencia[];
  recomendacoes: Recomendacao[];
  mistura_sugerida: Mistura | null;
  sinais_para_medir: string[];
  limites: string[];
  fontes: Fonte[];
  texto_base: string | null;
};

// ------------------------------------------------------------------ leitura tolerante

const str = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const URL_OK = /^https?:\/\/\S+$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function objeto(v: unknown): Record<string, any> | null {
  if (typeof v === "string" && v.trim().charAt(0) === "{") {
    try {
      return objeto(JSON.parse(v));
    } catch {
      return null;
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : null;
}

/** O diagnóstico estruturado da proposta, limpo; null quando não há (ou não tem nem o resumo). */
export function lerDiagnosticoEstruturado(proposta: PropostaDoDiagnostico): DiagnosticoLido | null {
  if (!proposta) return null;
  const bruto = objeto(proposta.diagnostico_estruturado) || objeto(proposta.parametros ? proposta.parametros.diagnostico_estruturado : null);
  if (!bruto) return null;
  const resumo = str(bruto.resumo, 600);
  if (!resumo) return null;
  const pontos = (v: unknown): Ponto[] => lista(v).map((x) => ({ ponto: str(x && x.ponto, 240), evidencia: str(x && x.evidencia, 320) })).filter((x) => x.ponto);
  const m = objeto(bruto.mistura_sugerida);
  const n = (x: unknown) => (typeof x === "number" && isFinite(x) && x > 0 ? x : 0);
  const soma = m ? n(m.topo) + n(m.meio) + n(m.fundo) : 0;
  const mistura: Mistura | null = m && soma > 0
    ? (() => {
        const topo = Math.round((n(m.topo) / soma) * 100);
        const meio = Math.round((n(m.meio) / soma) * 100);
        return { topo, meio, fundo: Math.max(0, 100 - topo - meio), justificativa: str(m.justificativa, 400) };
      })()
    : null;
  return {
    origem: bruto.origem === "frentes" ? "frentes" : "pesquisa",
    resumo,
    o_que_funciona: pontos(bruto.o_que_funciona),
    o_que_nao_funciona: pontos(bruto.o_que_nao_funciona),
    oportunidades_do_mes: lista(bruto.oportunidades_do_mes)
      .map((x) => ({ data: DATA.test(str(x && x.data, 10)) ? str(x.data, 10) : null, tema: str(x && x.tema, 240), por_que: str(x && x.por_que, 320) }))
      .filter((x) => x.tema),
    tendencias_do_nicho: lista(bruto.tendencias_do_nicho)
      .map((x) => ({ tendencia: str(x && x.tendencia, 240), como_usar: str(x && x.como_usar, 320), fonte: URL_OK.test(str(x && x.fonte, 500)) ? str(x.fonte, 500) : null }))
      .filter((x) => x.tendencia),
    recomendacoes: lista(bruto.recomendacoes)
      .map((x) => {
        const p = str(x && x.prioridade, 10);
        return { acao: str(x && x.acao, 280), por_que: str(x && x.por_que, 320), prioridade: (p === "alta" || p === "baixa" ? p : "media") as Recomendacao["prioridade"] };
      })
      .filter((x) => x.acao),
    mistura_sugerida: mistura,
    sinais_para_medir: lista(bruto.sinais_para_medir).map((x) => str(x, 240)).filter(Boolean),
    limites: lista(bruto.limites).map((x) => str(x, 280)).filter(Boolean),
    fontes: lista(bruto.fontes)
      .map((x) => ({ titulo: str(x && x.titulo, 160), url: str(x && x.url, 500) }))
      .filter((x) => URL_OK.test(x.url)),
    texto_base: typeof bruto.texto_base === "string" ? bruto.texto_base : null,
  };
}

export type SecaoDoTexto = { titulo: string | null; itens: string[]; corrido: boolean };

const TITULOS_DO_TEXTO = /^(Públicos prioritários|Pilares|Pesquisa|Hipóteses[^:]{0,40}|Funciona|Não funciona|Oportunidades|Tendências|Recomendações|Mistura sugerida):\s*/;

/**
 * Texto antigo (ou atualizado na conversa) em seções: cada parágrafo é um
 * bloco; os que começam com "Pilares:", "Públicos prioritários:"... viram
 * seção com lista; "Pesquisa:" fica corrido.
 */
export function secoesDoTexto(texto: string | null | undefined): SecaoDoTexto[] {
  const limpo = String(texto || "").replace(/\r/g, "").trim();
  if (!limpo) return [];
  const paragrafos = limpo.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const secoes: SecaoDoTexto[] = [];
  for (const p of paragrafos) {
    const m = TITULOS_DO_TEXTO.exec(p);
    if (m) {
      const corpo = p.slice(m[0].length).trim();
      const corrido = m[1] === "Pesquisa" || m[1] === "Mistura sugerida";
      secoes.push({
        titulo: m[1],
        corrido,
        itens: corrido ? [corpo] : corpo.replace(/\.$/, "").split(/;\s+/).map((x) => x.trim()).filter(Boolean),
      });
    } else {
      const ultima = secoes[secoes.length - 1];
      if (ultima && ultima.titulo === null) ultima.itens.push(p);
      else secoes.push({ titulo: null, corrido: true, itens: [p] });
    }
  }
  return secoes;
}

/** Primeiras frases do texto antigo, para o resumo do cartão recolhido. */
export function resumoDoTexto(texto: string | null | undefined, max = 260): string {
  const primeiro = String(texto || "").replace(/\r/g, "").trim().split(/\n\s*\n/)[0] || "";
  const frases = primeiro.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) || (primeiro ? [primeiro] : []);
  let s = frases.slice(0, 2).map((f) => f.trim()).join(" ");
  if (s.length > max) s = `${s.slice(0, max).replace(/\s+\S*$/, "")}...`;
  return s;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Até 3 chips do cartão recolhido. */
export function chipsDoDiagnostico(d: DiagnosticoLido | null, secoes: SecaoDoTexto[]): string[] {
  if (d) {
    const candidatos: Array<[number, string]> = [
      [d.oportunidades_do_mes.length, plural(d.oportunidades_do_mes.length, "oportunidade", "oportunidades")],
      [d.tendencias_do_nicho.length, plural(d.tendencias_do_nicho.length, "tendência", "tendências")],
      [d.recomendacoes.length, plural(d.recomendacoes.length, "recomendação", "recomendações")],
      [d.o_que_funciona.length, plural(d.o_que_funciona.length, "ponto que funciona", "pontos que funcionam")],
      [d.fontes.length, plural(d.fontes.length, "fonte", "fontes")],
    ];
    return candidatos.filter((c) => c[0] > 0).slice(0, 3).map((c) => c[1]);
  }
  return secoes.filter((s) => s.titulo).slice(0, 3).map((s) => (s.titulo && !s.corrido ? `${s.titulo} (${s.itens.length})` : String(s.titulo)));
}

// ------------------------------------------------------------------ peças visuais

const dataCurta = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function dominio(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1].replace(/^www\./i, "") : url;
}

/** Texto com os links clicáveis (sem lookbehind). */
function ComLinks({ texto }: { texto: string }) {
  const partes = texto.split(/(https?:\/\/[^\s)\]]+)/g);
  return (
    <>
      {partes.map((p, i) =>
        /^https?:\/\//i.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer noopener" className="text-primary underline-offset-2 hover:underline [overflow-wrap:anywhere]">
            {dominio(p)}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function Secao({ titulo, icone, children }: { titulo: string; icone?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {icone && <span className="mr-1.5 inline-flex">{icone}</span>}
        {titulo}
      </h3>
      {children}
    </section>
  );
}

function ListaDePontos({ itens, tom }: { itens: Ponto[]; tom: "bom" | "ruim" }) {
  const Icone = tom === "bom" ? CheckCircle2 : XCircle;
  return (
    <ul className="space-y-1.5">
      {itens.map((p, i) => (
        <li key={i} className="flex items-start text-[12.5px] leading-relaxed">
          <Icone className={`mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 ${tom === "bom" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`} />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span className="font-medium">{p.ponto}</span>
            {p.evidencia && <span className="text-muted-foreground"> {p.evidencia}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

const ROTULO_PRIORIDADE: Record<Recomendacao["prioridade"], string> = { alta: "alta", media: "média", baixa: "baixa" };
const COR_PRIORIDADE: Record<Recomendacao["prioridade"], string> = {
  alta: "bg-primary/10 text-primary",
  media: "bg-muted text-foreground",
  baixa: "bg-muted text-muted-foreground",
};

function BarraDaMistura({ m }: { m: Mistura }) {
  const partes: Array<{ rotulo: string; valor: number; cor: string }> = [
    { rotulo: "Topo", valor: m.topo, cor: "bg-sky-500" },
    { rotulo: "Meio", valor: m.meio, cor: "bg-violet-500" },
    { rotulo: "Fundo", valor: m.fundo, cor: "bg-emerald-500" },
  ];
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Topo ${m.topo}%, meio ${m.meio}%, fundo ${m.fundo}%`}>
        {partes.map((p) => (p.valor > 0 ? <span key={p.rotulo} className={`h-full ${p.cor}`} style={{ width: `${p.valor}%` }} /> : null))}
      </div>
      <div className="mt-2 flex flex-wrap text-[11.5px]">
        {partes.map((p) => (
          <span key={p.rotulo} className="mb-1 mr-3 inline-flex items-center">
            <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${p.cor}`} />
            {p.rotulo} <span className="ml-1 font-medium">{p.valor}%</span>
          </span>
        ))}
      </div>
      {m.justificativa && <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{m.justificativa}</p>}
    </div>
  );
}

function SecoesDoTexto({ secoes }: { secoes: SecaoDoTexto[] }) {
  return (
    <div className="space-y-4">
      {secoes.map((s, i) => {
        const corpo = s.corrido ? (
          <div className="space-y-2">
            {s.itens.map((t, j) => (
              <p key={j} className="whitespace-pre-line text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">
                <ComLinks texto={t} />
              </p>
            ))}
          </div>
        ) : (
          <ul className="space-y-1">
            {s.itens.map((t, j) => (
              <li key={j} className="flex items-start text-[12.5px] leading-relaxed">
                <span className="mr-2 mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{t}</span>
              </li>
            ))}
          </ul>
        );
        return s.titulo ? <Secao key={i} titulo={s.titulo}>{corpo}</Secao> : <div key={i}>{corpo}</div>;
      })}
    </div>
  );
}

// ------------------------------------------------------------------ componente

export default function DiagnosticoDoMes({ proposta }: { proposta: PropostaDoDiagnostico }) {
  const [aberto, setAberto] = useState(false);
  const id = proposta ? proposta.id : undefined;
  useEffect(() => {
    setAberto(false);
  }, [id]);

  const d = lerDiagnosticoEstruturado(proposta);
  const texto = proposta && typeof proposta.diagnostico === "string" ? proposta.diagnostico.trim() : "";
  const estado = proposta && proposta.parametros ? String(proposta.parametros.diagnostico_estado || "") : "";
  const pesquisando = estado === "gerando" || estado === "atrasado";

  if (!d && !texto) {
    if (!pesquisando) return null;
    return (
      <section className="flex items-center rounded-xl border border-dashed border-border bg-card px-4 py-3 text-[12.5px] text-muted-foreground" aria-live="polite">
        <Loader2 className="mr-2 h-3.5 w-3.5 shrink-0 animate-spin" />
        Pesquisando tendências, datas e números do perfil para o diagnóstico do mês...
      </section>
    );
  }

  const secoesTexto = secoesDoTexto(texto);
  const resumo = d ? d.resumo : resumoDoTexto(texto);
  const chips = chipsDoDiagnostico(d, secoesTexto);
  // A conversa pode reescrever o texto depois: aí ele aparece como "Atualizado na conversa".
  const mudouNaConversa = !!(d && texto && d.texto_base !== null && texto !== d.texto_base.trim());
  const idDoCorpo = `diagnostico-do-mes-${id || "atual"}`;

  return (
    <section className="rounded-xl border border-border bg-card" data-testid="diagnostico-do-mes">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-controls={idDoCorpo}
        className="flex w-full min-w-0 items-start rounded-xl px-4 py-3.5 text-left transition-colors hover:bg-muted/40"
      >
        <span className="mr-3 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Compass className="h-4 w-4" />
        </span>
        <span className="block min-w-0 flex-1">
          <span className="flex flex-wrap items-center">
            <span className="mr-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Diagnóstico do mês</span>
            {d && d.origem === "frentes" && <span className="mr-2 rounded-full bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground">resumo das frentes</span>}
            {pesquisando && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground">
                <Loader2 className="mr-1 h-3 w-3 animate-spin" /> pesquisando o mês
              </span>
            )}
          </span>
          <span className={`mt-1 block text-[13.5px] font-medium leading-snug [overflow-wrap:anywhere] ${aberto ? "" : "line-clamp-2"}`}>{resumo}</span>
          {chips.length > 0 && (
            <span className="mt-2 flex flex-wrap">
              {chips.map((c) => (
                <span key={c} className="mb-1 mr-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px]">{c}</span>
              ))}
            </span>
          )}
        </span>
        <span className="ml-3 mt-1 flex shrink-0 items-center text-[11.5px] text-muted-foreground">
          <span className="mr-1 hidden sm:inline">{aberto ? "Recolher" : "Ver tudo"}</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${aberto ? "rotate-180" : ""}`} />
        </span>
      </button>

      {aberto && (
        <div
          id={idDoCorpo}
          data-testid="diagnostico-rolagem"
          className="max-h-[420px] space-y-5 overflow-y-auto overscroll-contain border-t border-border px-4 py-4 [-webkit-overflow-scrolling:touch]"
        >
          {d ? (
            <>
              {d.o_que_funciona.length > 0 && (
                <Secao titulo="O que funciona"><ListaDePontos itens={d.o_que_funciona} tom="bom" /></Secao>
              )}
              {d.o_que_nao_funciona.length > 0 && (
                <Secao titulo="O que não funciona"><ListaDePontos itens={d.o_que_nao_funciona} tom="ruim" /></Secao>
              )}
              {d.oportunidades_do_mes.length > 0 && (
                <Secao titulo="Oportunidades do mês" icone={<CalendarDays className="h-3.5 w-3.5" />}>
                  <ul className="space-y-2">
                    {d.oportunidades_do_mes.map((o, i) => (
                      <li key={i} className="flex items-start text-[12.5px] leading-relaxed">
                        <span className="mr-2.5 mt-0.5 w-12 shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-center text-[11px] font-medium text-primary">
                          {o.data ? dataCurta(o.data) : "mês"}
                        </span>
                        <span className="min-w-0 [overflow-wrap:anywhere]">
                          <span className="font-medium">{o.tema}</span>
                          {o.por_que && <span className="block text-muted-foreground">{o.por_que}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Secao>
              )}
              {d.tendencias_do_nicho.length > 0 && (
                <Secao titulo="Tendências do nicho" icone={<TrendingUp className="h-3.5 w-3.5" />}>
                  <ul className="space-y-2.5">
                    {d.tendencias_do_nicho.map((t, i) => (
                      <li key={i} className="text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">
                        <p className="font-medium">{t.tendencia}</p>
                        {t.como_usar && <p className="text-muted-foreground">{t.como_usar}</p>}
                        {t.fonte && (
                          <a href={t.fonte} target="_blank" rel="noreferrer noopener" className="mt-0.5 inline-flex items-center text-[11.5px] text-primary hover:underline">
                            <ExternalLink className="mr-1 h-3 w-3" /> {dominio(t.fonte)}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </Secao>
              )}
              {d.recomendacoes.length > 0 && (
                <Secao titulo="Recomendações" icone={<Lightbulb className="h-3.5 w-3.5" />}>
                  <ol className="space-y-2">
                    {d.recomendacoes.map((r, i) => (
                      <li key={i} className="flex items-start text-[12.5px] leading-relaxed">
                        <span className="mr-2.5 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium">{i + 1}</span>
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                          <span className="font-medium">{r.acao}</span>
                          <span className={`ml-1.5 inline-block rounded-full px-1.5 py-px align-middle text-[10.5px] ${COR_PRIORIDADE[r.prioridade]}`}>{ROTULO_PRIORIDADE[r.prioridade]}</span>
                          {r.por_que && <span className="block text-muted-foreground">{r.por_que}</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                </Secao>
              )}
              {d.mistura_sugerida && (
                <Secao titulo="Mistura sugerida do funil"><BarraDaMistura m={d.mistura_sugerida} /></Secao>
              )}
              {d.sinais_para_medir.length > 0 && (
                <Secao titulo="Sinais para medir" icone={<Target className="h-3.5 w-3.5" />}>
                  <div className="flex flex-wrap">
                    {d.sinais_para_medir.map((s) => (
                      <span key={s} className="mb-1.5 mr-1.5 rounded-lg border border-border px-2 py-1 text-[11.5px] leading-snug [overflow-wrap:anywhere]">{s}</span>
                    ))}
                  </div>
                </Secao>
              )}
              {mudouNaConversa && (
                <Secao titulo="Atualizado na conversa"><SecoesDoTexto secoes={secoesTexto} /></Secao>
              )}
              {d.origem === "frentes" && !mudouNaConversa && secoesTexto.length > 0 && (
                <Secao titulo="Leitura das frentes de temas"><SecoesDoTexto secoes={secoesTexto} /></Secao>
              )}
              {d.limites.length > 0 && (
                <Secao titulo="Limites e hipóteses">
                  <ul className="space-y-1">
                    {d.limites.map((l, i) => (
                      <li key={i} className="text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{l}</li>
                    ))}
                  </ul>
                </Secao>
              )}
              {d.fontes.length > 0 && (
                <Secao titulo="Fontes">
                  <ul className="space-y-1">
                    {d.fontes.map((f) => (
                      <li key={f.url} className="text-[12px] leading-relaxed">
                        <a href={f.url} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center text-primary hover:underline">
                          <ExternalLink className="mr-1 h-3 w-3 shrink-0" />
                          <span className="truncate">{f.titulo ? `${f.titulo} (${dominio(f.url)})` : dominio(f.url)}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </Secao>
              )}
            </>
          ) : (
            <SecoesDoTexto secoes={secoesTexto} />
          )}
        </div>
      )}
    </section>
  );
}
