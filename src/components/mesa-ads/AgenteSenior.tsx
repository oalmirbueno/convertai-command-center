import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, ExternalLink, FlaskConical, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { Cronometro } from "@/components/mesa/Cronometro";
import { brl, chamarAds, humanizar, partesDoPlanoV2, rotuloDoObjetivo, type PedidoDePlano } from "./adsApi";
import { chavesAgente, lerConversaDoAgente, partesDoAgenteSenior, ROTULO_DA_GRAVIDADE, type EstrategiaSenior } from "./agenteSeniorApi";
import { BotaoDoPlanoDoAgente, CartaoDasAcoes, NumerosQueEleViu } from "./AcoesDoAgente";
import type { AcoesDaConta, NumerosVistos } from "./acoesDoAgenteApi";

/**
 * Agente sênior de tráfego (pedido do dono em 26/09/2026): conversa com o
 * contexto inteiro do cliente (conta ao vivo, evolução, criativos da Mesa
 * Ads, oferta, briefing, contexto da marca, cérebro e o método dos
 * especialistas), pesquisa o nicho na web e na Biblioteca de Anúncios quando
 * o token permite, e devolve a estratégia estruturada. Uma chamada por
 * mensagem, custo à vista.
 *
 * 25/09 à noite ("se ele for agente nosso, agêntico, fica muito top"; "deixa
 * esse agente mais claro"): cada resposta vem em blocos, nesta ordem: o que
 * ele viu (números do código com fonte e período), o que recomenda
 * (diagnóstico e escalar, manter, cortar), as ações propostas em cartão
 * (Confirmar, Cancelar, Desfazer; AcoesDoAgente.tsx) e o plano de teste já
 * preenchido. A estratégia completa (reestruturação e próximos criativos)
 * fica recolhida. "Direto às ações" pede menos conversa.
 * No celular a conversa não tem rolagem própria (o dedo rola a página); da
 * tela média para cima, a caixa tem altura máxima e rolagem só dela.
 */

const ATALHOS = [
  { rotulo: "Otimizar a conta agora", texto: "Otimize a conta: o que pausar, onde subir a verba e o que testar. Traga as ações prontas para eu confirmar." },
  { rotulo: "Analisar com foco em mensagem", texto: "Analise a conta inteira com foco em mensagem e vendas. O que está só gerando engajamento e como transformar isso em conversa e venda?" },
  { rotulo: "Migrar de engajamento para mensagem", texto: "A maioria das campanhas é de engajamento. Monte a migração para campanha de mensagens sem perder o que funciona, com conjuntos, verba e anúncios." },
  { rotulo: "O que cortar e escalar", texto: "Quais anúncios cortar, manter e escalar agora, com os números?" },
  { rotulo: "Montar o próximo teste", texto: "Monte o próximo plano de teste com os criativos que devem vencer, já com público, verba, duração e critério de vitória." },
];

const CHAVE_DO_MODO = "mesa-ads:agente-senior:agir";

function lerModoAgir(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_DO_MODO) === "1";
  } catch {
    return false;
  }
}

function Grupo({ titulo, tom, itens }: { titulo: string; tom: string; itens: { chave: string; titulo: string; texto: string }[] }) {
  if (!itens.length) return null;
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-2.5">
      <p className={`text-[10.5px] font-semibold uppercase tracking-wider ${tom}`}>{titulo} ({itens.length})</p>
      <ul className="mt-1 space-y-1.5">
        {itens.map((i) => (
          <li key={i.chave} className="min-w-0 text-[12px] leading-snug">
            <span className="block truncate font-medium">{i.titulo}</span>
            {i.texto && <span className="block text-muted-foreground [overflow-wrap:anywhere]">{i.texto}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fonte({ fonte }: { fonte: string }) {
  if (/^https?:\/\//i.test(fonte)) {
    return (
      <a href={fonte} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center text-primary hover:underline">
        <span className="truncate">{fonte.replace(/^https?:\/\//i, "").slice(0, 60)}</span>
        <ExternalLink className="ml-1 h-3 w-3 shrink-0" />
      </a>
    );
  }
  return <span className="text-muted-foreground">{fonte}</span>;
}

/** Texto do agente curto por padrão (menos texto corrido); "Ler tudo" abre o resto. */
function TextoCurto({ texto }: { texto: string }) {
  const [aberto, setAberto] = useState(false);
  const longo = texto.length > 320;
  return (
    <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">
      {longo && !aberto ? `${texto.slice(0, 300).replace(/\s+\S*$/, "")}...` : texto}
      {longo && (
        <button type="button" className="ml-1 text-[11.5px] font-medium text-primary hover:underline" onClick={() => setAberto(!aberto)}>
          {aberto ? "Mostrar menos" : "Ler tudo"}
        </button>
      )}
    </p>
  );
}

function Titulo({ children }: { children: ReactNode }) {
  return <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>;
}

/** O plano de teste que o agente montou, em linhas curtas, com o botão que já cria o plano preenchido. */
function PlanoDeTesteNaTela({ e, mensagemId, onPlanoPronto }: { e: EstrategiaSenior; mensagemId?: string; onPlanoPronto?: (planoId: string) => void }) {
  const t = e.plano_de_teste;
  if (!t && !e.proximos_criativos.length) return null;
  const linhas: [string, string][] = t
    ? ([
        ["Hipótese", t.hipotese],
        ["Variável testada", t.variavel],
        ["Criativos", e.proximos_criativos.map((c) => c.titulo).join("; ")],
        ["Público", t.publico],
        ["Verba diária", t.orcamento_diario_brl !== null ? brl(t.orcamento_diario_brl) : ""],
        ["Duração", t.duracao_dias ? `${t.duracao_dias} dias` : ""],
        ["Métrica de decisão", t.metrica_decisao],
        ["Critério de vitória", t.criterio_vitoria],
      ] as [string, string][]).filter((l) => !!l[1])
    : [["Criativos", e.proximos_criativos.map((c) => c.titulo).join("; ")]];
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-2.5" aria-label="Plano de teste do agente">
      <div className="flex min-w-0 flex-wrap items-center">
        <p className="mb-1 mr-2 flex items-center text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          <FlaskConical className="mr-1 h-3.5 w-3.5 text-primary" /> Plano de teste
        </p>
        {mensagemId && <BotaoDoPlanoDoAgente mensagemId={mensagemId} onPlanoPronto={onPlanoPronto} className="mb-1 ml-auto" />}
      </div>
      <dl className="min-w-0 space-y-1 text-[12px] leading-snug">
        {linhas.map(([r, v]) => (
          <div key={r} className="flex min-w-0 flex-col sm:flex-row">
            <dt className="shrink-0 text-muted-foreground sm:mr-2 sm:w-36">{r}</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
      {!t && <p className="mt-1 text-[11px] text-muted-foreground">O que o agente não disse (público, verba, critério) o painel preenche com a conta e o briefing, e marca como lacuna o que não tiver base.</p>}
    </section>
  );
}

/**
 * A resposta do agente em blocos: o que viu, o que recomenda, as ações, o
 * plano de teste e, recolhida, a estratégia completa.
 */
export function EstrategiaNaTela({
  e,
  nomeDe,
  onCriarPlano,
  mensagemId,
  numeros = null,
  acoes = null,
  onPlanoPronto,
}: {
  e: EstrategiaSenior;
  nomeDe: (adId: string) => string;
  onCriarPlano?: (p: PedidoDePlano) => void;
  mensagemId?: string;
  numeros?: NumerosVistos | null;
  acoes?: AcoesDaConta | null;
  onPlanoPronto?: (planoId: string) => void;
}) {
  const { catalogo } = useMesa();
  const re = e.reestruturacao;
  return (
    <div className="min-w-0 space-y-2.5">
      {numeros && <NumerosQueEleViu n={numeros} />}

      <section className="min-w-0 space-y-2" aria-label="O que o agente recomenda">
        <Titulo>O que recomenda</Titulo>
        {e.resposta && <TextoCurto texto={e.resposta} />}
        {e.diagnostico.length > 0 && (
          <ul className="min-w-0 space-y-1" aria-label="Diagnóstico">
            {e.diagnostico.map((d, k) => (
              <li key={k} className="min-w-0 text-[12px] leading-snug">
                <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${d.gravidade === "alta" ? "bg-destructive/10 text-destructive" : d.gravidade === "media" ? "bg-warning/15 text-warning" : "bg-secondary text-muted-foreground"}`}>
                  {ROTULO_DA_GRAVIDADE[d.gravidade]}
                </span>
                <span className="font-medium">{d.titulo}</span>
                {d.detalhe && <span className="text-muted-foreground [overflow-wrap:anywhere]">: {d.detalhe}</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-3">
          <Grupo titulo="Escalar" tom="text-success" itens={e.escalar.map((x) => ({ chave: x.ad_id, titulo: nomeDe(x.ad_id), texto: [x.porque, x.como].filter(Boolean).join(" ") }))} />
          <Grupo titulo="Manter" tom="text-foreground" itens={e.manter.map((x) => ({ chave: x.ad_id, titulo: nomeDe(x.ad_id), texto: x.porque }))} />
          <Grupo titulo="Cortar" tom="text-destructive" itens={e.cortar.map((x) => ({ chave: x.ad_id, titulo: nomeDe(x.ad_id), texto: x.porque }))} />
        </div>
      </section>

      {acoes && mensagemId && <CartaoDasAcoes mensagemId={mensagemId} acoes={acoes} onPlanoPronto={onPlanoPronto} />}

      <PlanoDeTesteNaTela e={e} mensagemId={mensagemId} onPlanoPronto={onPlanoPronto} />

      {e.pesquisa.length > 0 && (
        <div className="min-w-0 rounded-lg border border-border bg-card p-2.5">
          <Titulo>O que a pesquisa mostrou</Titulo>
          <ul className="space-y-1">
            {e.pesquisa.map((p, k) => (
              <li key={k} className="min-w-0 text-[12px] leading-snug [overflow-wrap:anywhere]">
                {p.achado} {p.fonte && <Fonte fonte={p.fonte} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(re.porque || re.campanhas.length > 0 || e.proximos_criativos.length > 0 || e.perguntas.length > 0) && (
        <details className="min-w-0 rounded-lg border border-border bg-card px-2.5 py-2">
          <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground">Estratégia completa (estrutura da campanha, próximos criativos e perguntas)</summary>
          <div className="mt-2 min-w-0 space-y-2.5">
            {(re.porque || re.campanhas.length > 0) && (
              <div className="min-w-0 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
                <p className="text-[10.5px] font-semibold uppercase tracking-wider text-primary">Reestruturação recomendada</p>
                <p className="mt-1 text-[12px] leading-snug">
                  {re.objetivo && <span className="mr-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] text-primary">{rotuloDoObjetivo(re.objetivo)}</span>}
                  {re.evento_otimizacao && <span className="text-muted-foreground">Otimizar para {re.evento_otimizacao}. </span>}
                  <span className="text-muted-foreground">Verba diária total: {re.verba_total_diaria_brl !== null ? brl(re.verba_total_diaria_brl) : "sem base para definir"}.</span>
                </p>
                {re.porque && <p className="mt-1 text-[12px] leading-snug [overflow-wrap:anywhere]">{re.porque}</p>}
                {re.campanhas.map((c, k) => (
                  <div key={k} className="mt-1.5 min-w-0 text-[12px] leading-snug">
                    <p className="font-medium [overflow-wrap:anywhere]">
                      {c.nome}
                      {c.objetivo ? ` (${rotuloDoObjetivo(c.objetivo)})` : ""}
                      {c.orcamento_diario_brl !== null ? `, ${brl(c.orcamento_diario_brl)} por dia` : ""}
                    </p>
                    <ul className="ml-3 list-disc">
                      {c.conjuntos.map((j, n) => (
                        <li key={n} className="[overflow-wrap:anywhere]">
                          {j.nome}: {j.publico}
                          {j.orcamento_diario_brl !== null ? ` (${brl(j.orcamento_diario_brl)} por dia)` : ""}
                          {j.anuncios.length ? `. Anúncios: ${j.anuncios.map((a) => (/^[0-9]{5,}$/.test(a) ? nomeDe(a) : a)).join("; ")}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {re.passos.length > 0 && (
                  <ol className="ml-4 mt-1.5 list-decimal text-[12px] leading-snug">
                    {re.passos.map((p, k) => <li key={k} className="[overflow-wrap:anywhere]">{p}</li>)}
                  </ol>
                )}
              </div>
            )}
            {e.proximos_criativos.length > 0 && (
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center">
                  <p className="mb-1 mr-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Próximos criativos ({e.proximos_criativos.length})</p>
                  {onCriarPlano && (
                    <span className="mb-1 ml-auto">
                      <BotaoComCusto
                        rotulo="Gerar ângulos novos com IA"
                        titulo="Plano com os próximos criativos"
                        descricao="Gera ângulos novos no Plano de teste a partir destes criativos (o Jev confere cada um). Para usar a análise como está, sem custo, use Levar ao Plano de teste."
                        variant="ghost"
                        className="h-7 text-[11.5px]"
                        fecharAoConfirmar
                        partes={() => partesDoPlanoV2(catalogo, Math.min(6, Math.max(3, e.proximos_criativos.length)))}
                        executar={async () => {
                          onCriarPlano({
                            rotulo: "Próximos criativos do agente sênior",
                            objetivo: re.objetivo || undefined,
                            quantidade_angulos: Math.min(6, Math.max(3, e.proximos_criativos.length)),
                            pedido: `Transforme em ângulos os próximos criativos recomendados pelo agente sênior de tráfego:\n${e.proximos_criativos.map((c, k) => `${k + 1}. ${c.titulo}: ${c.angulo}. Gancho: ${c.gancho_verbal}. Visual: ${c.gancho_visual}. Formato ${c.formato}.${c.porque ? ` Por quê: ${c.porque}` : ""}`).join("\n")}`,
                          });
                          return null;
                        }}
                      />
                    </span>
                  )}
                </div>
                <ul className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
                  {e.proximos_criativos.map((c, k) => (
                    <li key={k} className="min-w-0 rounded-lg border border-border bg-card p-2.5 text-[12px] leading-snug">
                      <p className="font-semibold [overflow-wrap:anywhere]">{c.titulo}</p>
                      <p className="mt-0.5 text-muted-foreground [overflow-wrap:anywhere]">{c.angulo}</p>
                      <p className="mt-1 [overflow-wrap:anywhere]"><span className="font-medium">Gancho:</span> {c.gancho_verbal}</p>
                      <p className="[overflow-wrap:anywhere]"><span className="font-medium">Visual:</span> {c.gancho_visual}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {[humanizar(c.formato), c.estilo_visual ? humanizar(c.estilo_visual) : "", c.objetivo ? rotuloDoObjetivo(c.objetivo) : "", c.cta_meta, c.base_ad_id ? `a partir de ${nomeDe(c.base_ad_id)}` : ""].filter(Boolean).join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {e.perguntas.length > 0 && (
              <div className="min-w-0 text-[12px]">
                <Titulo>Perguntas para a equipe</Titulo>
                <ul className="ml-4 list-disc">{e.perguntas.map((p, k) => <li key={k} className="[overflow-wrap:anywhere]">{p}</li>)}</ul>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function Bolha({ papel, children }: { papel: "usuario" | "agente"; children: ReactNode }) {
  return (
    <div className={`min-w-0 rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed [overflow-wrap:anywhere] ${papel === "usuario" ? "ml-8 rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground"}`}>
      {children}
    </div>
  );
}

export default function AgenteSenior({
  nomeDe = (x) => `Anúncio ${x}`,
  planoId,
  dias = 30,
  onCriarPlano,
  onPlanoPronto,
  className = "",
}: {
  nomeDe?: (adId: string) => string;
  planoId?: string | null;
  dias?: number;
  onCriarPlano?: (p: PedidoDePlano) => void;
  /** Plano de teste criado já preenchido (abre no Plano de teste). */
  onPlanoPronto?: (planoId: string) => void;
  className?: string;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState("");
  const [pesquisar, setPesquisar] = useState(true);
  const [agir, setAgir] = useState(lerModoAgir);
  const [envio, setEnvio] = useState<{ mensagem: string; desde: number } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLSpanElement>(null);
  const conversa = useQuery({ queryKey: chavesAgente.conversa(clientId), queryFn: () => lerConversaDoAgente(clientId), staleTime: 60_000, retry: false });
  const mensagens = conversa.data ? conversa.data.mensagens : [];

  useEffect(() => {
    const el = listaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens.length, !!envio]);

  const mudarAgir = (v: boolean) => {
    setAgir(v);
    try {
      window.localStorage.setItem(CHAVE_DO_MODO, v ? "1" : "0");
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  };

  const enviar = async () => {
    const mensagem = texto.trim();
    setEnvio({ mensagem, desde: Date.now() });
    setTexto("");
    setAviso(null);
    try {
      const corpo: Record<string, unknown> = {
        client_id: clientId,
        mensagem,
        conversa_id: conversa.data && conversa.data.conversa_id ? conversa.data.conversa_id : undefined,
        plano_id: planoId || undefined,
        dias,
        pesquisar,
      };
      if (agir) corpo.modo = "agir";
      const data = await chamarAds<any>("conta_conversar", corpo);
      const b = data && data.pesquisa && data.pesquisa.biblioteca;
      if (pesquisar && b && b.motivo) setAviso(`Biblioteca de Anúncios: ${b.motivo}`);
      await queryClient.invalidateQueries({ queryKey: chavesAgente.conversa(clientId) });
      return data;
    } catch (e) {
      setTexto((t) => t || mensagem);
      throw e;
    } finally {
      setEnvio(null);
    }
  };
  const podeEnviar = !!texto.trim() && !envio;

  return (
    <section className={`flex min-w-0 flex-col rounded-xl border border-border bg-card ${className}`} aria-label="Agente sênior de tráfego">
      <div className="flex min-w-0 items-center border-b border-border px-4 py-3">
        <span className="mr-2.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Briefcase className="h-3.5 w-3.5 text-primary" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">Agente sênior de tráfego</span>
          <span className="block text-[11.5px] text-muted-foreground">
            Lê a conta, diz o que viu e o que recomenda, e prepara as ações na campanha. Nada muda na conta sem você confirmar.
          </span>
        </span>
      </div>

      <div ref={listaRef} className="min-w-0 space-y-3 px-4 py-3 sm:max-h-[620px] sm:overflow-y-auto sm:overscroll-contain" aria-live="polite" aria-label="Conversa com o agente sênior">
        {conversa.isLoading && (
          <p className="text-[12px] text-muted-foreground">
            <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> Lendo a conversa...
          </p>
        )}
        {conversa.isError && <AvisoDeErro erro={conversa.error} />}
        {conversa.data && mensagens.length === 0 && !envio && (
          <p className="px-1 py-4 text-center text-[12px] leading-relaxed text-muted-foreground">
            Peça o que fazer com a conta. Ele mostra os números que leu, o que recomenda e as ações prontas para confirmar (pausar, mudar verba, duplicar o vencedor, subir criativo da Mesa, levar ao plano de teste).
          </p>
        )}
        {mensagens.map((m) => {
          if (m.papel === "sistema") return <p key={m.id} className="text-center text-[11px] text-muted-foreground">{m.conteudo}</p>;
          if (m.papel === "usuario") return <Bolha key={m.id} papel="usuario"><p className="whitespace-pre-wrap">{m.conteudo}</p></Bolha>;
          return (
            <Bolha key={m.id} papel="agente">
              {m.estrategia ? (
                <EstrategiaNaTela e={m.estrategia} nomeDe={nomeDe} onCriarPlano={onCriarPlano} mensagemId={m.id} numeros={m.numeros} acoes={m.acoes} onPlanoPronto={onPlanoPronto} />
              ) : (
                <p className="whitespace-pre-wrap">{m.conteudo}</p>
              )}
            </Bolha>
          );
        })}
        {envio && (
          <div className="min-w-0 space-y-2">
            {envio.mensagem && <Bolha papel="usuario"><p className="whitespace-pre-wrap">{envio.mensagem}</p></Bolha>}
            <div className="rounded-2xl rounded-bl-md bg-muted px-3 py-2">
              <Cronometro desde={envio.desde} rotulo={pesquisar ? "Lendo a conta e pesquisando o nicho" : "Lendo a conta"} previsao="pode levar de 1 a 4 minutos" />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border px-3 pb-3 pt-2.5">
        {aviso && <p className="text-[11px] text-muted-foreground">{aviso}</p>}
        <div className="flex flex-wrap" role="group" aria-label="Atalhos para o agente sênior">
          {ATALHOS.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              onClick={() => setTexto(a.texto)}
              className="mb-1 mr-1 max-w-full truncate rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              {a.rotulo}
            </button>
          ))}
        </div>
        <div className="rounded-xl border border-border bg-background p-2 focus-within:border-primary/60">
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && podeEnviar) {
                e.preventDefault();
                const b = botaoRef.current ? botaoRef.current.querySelector("button") : null;
                if (b) b.click();
              }
            }}
            rows={3}
            aria-label="Mensagem ao agente sênior"
            placeholder="Ex.: pausa o que gasta sem conversa e sobe a verba do vencedor"
            className="max-h-40 min-h-[64px] resize-none border-0 bg-transparent px-1 py-1 text-[13px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <div className="mt-1 flex min-w-0 flex-wrap items-center">
            <label className="mb-1 mr-3 inline-flex min-w-0 items-center text-[11.5px] text-muted-foreground" title="Resposta em até 2 frases, com as ações prontas para confirmar">
              <input type="checkbox" className="mr-1.5" checked={agir} onChange={(e) => mudarAgir(e.target.checked)} />
              Direto às ações
            </label>
            <label className="mb-1 mr-2 inline-flex min-w-0 items-center text-[11.5px] text-muted-foreground">
              <input type="checkbox" className="mr-1.5" checked={pesquisar} onChange={(e) => setPesquisar(e.target.checked)} />
              Pesquisar na web e na Biblioteca de Anúncios
            </label>
            <span ref={botaoRef} className="mb-1 ml-auto shrink-0">
              <BotaoComCusto
                rotulo="Enviar"
                titulo="Mensagem ao agente sênior"
                descricao={`Uma chamada do agente sênior com a conta, a evolução, os criativos e o contexto do cliente${pesquisar ? ", com pesquisa web" : ""}. O Jev identifica o nicho (centavos). As ações que ele propuser só acontecem quando você confirmar.`}
                partes={() => partesDoAgenteSenior(catalogo, pesquisar)}
                executar={enviar}
                disabled={!podeEnviar}
                className="h-8"
              />
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
