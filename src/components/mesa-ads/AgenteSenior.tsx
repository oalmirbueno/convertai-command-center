import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, ChevronDown, ExternalLink, FlaskConical } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { Cronometro, useSegundos } from "@/components/mesa/Cronometro";
import { brl, chamarAds, humanizar, partesDoPlanoV2, rotuloDoObjetivo, type PedidoDePlano } from "./adsApi";
import { chavesAgente, lerConversaDoAgente, partesDoAgenteSenior, ROTULO_DA_GRAVIDADE, type EstrategiaSenior, type MensagemDoAgenteSenior } from "./agenteSeniorApi";
import { BotaoDoPlanoDoAgente, CartaoDasAcoes, NumerosQueEleViu } from "./AcoesDoAgente";
import { chaveDosNumeros, lerNumerosDoAgente, type AcoesDaConta, type NumerosVistos } from "./acoesDoAgenteApi";

/**
 * Agente sênior de tráfego (pedido do dono em 26/09/2026): conversa com o
 * contexto inteiro do cliente, pesquisa o nicho e devolve a estratégia
 * estruturada. Uma chamada por mensagem, custo à vista.
 *
 * 25/09 à noite: agêntico. Cada resposta vem em blocos: o que ele viu
 * (números do código com fonte e período), o que recomenda, as ações num só
 * cartão (Confirmar, Cancelar, Desfazer; AcoesDoAgente.tsx) e o plano de teste
 * já preenchido. "Direto às ações" pede menos conversa.
 *
 * 26/09 ("está meio poluído, meio desorganizado; bem mais rápido, mais bonito,
 * mais confortável"): uma coluna só, sem caixa dentro de caixa (a resposta do
 * agente é texto com uma linha de destaque à esquerda; o único cartão é o das
 * ações); números do que ele viu numa linha que abre; conversas antigas
 * recolhidas (fica à vista a última troca); atalhos em chips pequenos. Mais
 * rápido: a conversa vem do cache persistido da Mesa; ao enviar, os números
 * da conta aparecem logo (conta_numeros, que também aquece o cache do
 * servidor) e o andamento diz em que parte ele está.
 * No celular a conversa não tem rolagem própria (o dedo rola a página); da
 * tela média para cima, a caixa tem altura máxima e rolagem só dela.
 */

const ATALHOS = [
  { rotulo: "Otimizar a conta", texto: "Otimize a conta: o que pausar, onde subir a verba e o que testar. Traga as ações prontas para eu confirmar." },
  { rotulo: "Foco em mensagem", texto: "Analise a conta inteira com foco em mensagem e vendas. O que está só gerando engajamento e como transformar isso em conversa e venda?" },
  { rotulo: "Engajamento para mensagem", texto: "A maioria das campanhas é de engajamento. Monte a migração para campanha de mensagens sem perder o que funciona, com conjuntos, verba e anúncios." },
  { rotulo: "Cortar e escalar", texto: "Quais anúncios cortar, manter e escalar agora, com os números?" },
  { rotulo: "Próximo teste", texto: "Monte o próximo plano de teste com os criativos que devem vencer, já com público, verba, duração e critério de vitória." },
];

const CHAVE_DO_MODO = "mesa-ads:agente-senior:agir";

function lerModoAgir(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_DO_MODO) === "1";
  } catch {
    return false;
  }
}

/** Em que parte a resposta está (pelo tempo; o servidor responde tudo no fim, com fôlego). */
export function etapaDaResposta(segundos: number, pesquisar: boolean): string {
  if (segundos < 6) return "Lendo a conta e os criativos";
  if (pesquisar && segundos < 45) return "Pesquisando o nicho e a Biblioteca de Anúncios";
  if (segundos < (pesquisar ? 110 : 70)) return "Escrevendo a análise e as ações";
  return "Conferindo as ações na Meta";
}

function Titulo({ children }: { children: ReactNode }) {
  return <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>;
}

function Grupo({ titulo, tom, itens }: { titulo: string; tom: string; itens: { chave: string; titulo: string; texto: string }[] }) {
  if (!itens.length) return null;
  return (
    <div className="min-w-0">
      <p className={`text-[10.5px] font-semibold uppercase tracking-wider ${tom}`}>{titulo} ({itens.length})</p>
      <ul className="mt-0.5 space-y-1">
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
    <p className="whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]">
      {longo && !aberto ? `${texto.slice(0, 300).replace(/\s+\S*$/, "")}...` : texto}
      {longo && (
        <button type="button" className="ml-1 text-[11.5px] font-medium text-primary hover:underline" onClick={() => setAberto(!aberto)}>
          {aberto ? "Mostrar menos" : "Ler tudo"}
        </button>
      )}
    </p>
  );
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
    <section className="min-w-0" aria-label="Plano de teste do agente">
      <div className="flex min-w-0 flex-wrap items-center">
        <p className="mb-1 mr-2 flex items-center text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          <FlaskConical className="mr-1 h-3.5 w-3.5 text-primary" /> Plano de teste
        </p>
        {mensagemId && <BotaoDoPlanoDoAgente mensagemId={mensagemId} onPlanoPronto={onPlanoPronto} className="mb-1 ml-auto" />}
      </div>
      <dl className="min-w-0 space-y-0.5 text-[12px] leading-snug">
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
  const temGrupos = e.escalar.length + e.manter.length + e.cortar.length > 0;
  return (
    <div className="min-w-0 space-y-3">
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
        {temGrupos && (
          <div className="grid min-w-0 grid-cols-1 gap-3 pt-1 md:grid-cols-3">
            <Grupo titulo="Escalar" tom="text-success" itens={e.escalar.map((x) => ({ chave: x.ad_id, titulo: nomeDe(x.ad_id), texto: [x.porque, x.como].filter(Boolean).join(" ") }))} />
            <Grupo titulo="Manter" tom="text-foreground" itens={e.manter.map((x) => ({ chave: x.ad_id, titulo: nomeDe(x.ad_id), texto: x.porque }))} />
            <Grupo titulo="Cortar" tom="text-destructive" itens={e.cortar.map((x) => ({ chave: x.ad_id, titulo: nomeDe(x.ad_id), texto: x.porque }))} />
          </div>
        )}
      </section>

      {acoes && mensagemId && <CartaoDasAcoes mensagemId={mensagemId} acoes={acoes} onPlanoPronto={onPlanoPronto} />}

      <PlanoDeTesteNaTela e={e} mensagemId={mensagemId} onPlanoPronto={onPlanoPronto} />

      {e.pesquisa.length > 0 && (
        <section className="min-w-0">
          <Titulo>O que a pesquisa mostrou</Titulo>
          <ul className="space-y-1">
            {e.pesquisa.map((p, k) => (
              <li key={k} className="min-w-0 text-[12px] leading-snug [overflow-wrap:anywhere]">
                {p.achado} {p.fonte && <Fonte fonte={p.fonte} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(re.porque || re.campanhas.length > 0 || e.proximos_criativos.length > 0 || e.perguntas.length > 0) && (
        <details className="min-w-0 border-t border-border pt-2">
          <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground">Estratégia completa (estrutura da campanha, próximos criativos e perguntas)</summary>
          <div className="mt-2 min-w-0 space-y-3">
            {(re.porque || re.campanhas.length > 0) && (
              <div className="min-w-0">
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
                <ul className="min-w-0 divide-y divide-border">
                  {e.proximos_criativos.map((c, k) => (
                    <li key={k} className="min-w-0 py-1.5 text-[12px] leading-snug">
                      <p className="font-semibold [overflow-wrap:anywhere]">{c.titulo}</p>
                      <p className="text-muted-foreground [overflow-wrap:anywhere]">{c.angulo}</p>
                      <p className="[overflow-wrap:anywhere]"><span className="font-medium">Gancho:</span> {c.gancho_verbal}</p>
                      <p className="[overflow-wrap:anywhere]"><span className="font-medium">Visual:</span> {c.gancho_visual}</p>
                      <p className="text-[11px] text-muted-foreground">
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

function FalaDaEquipe({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 justify-end">
      <div className="min-w-0 max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-1.5 text-[12.5px] leading-relaxed text-primary-foreground [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

/** A resposta do agente: sem caixa, com uma linha de destaque à esquerda. */
function FalaDoAgente({ children }: { children: ReactNode }) {
  return <div className="min-w-0 border-l-2 border-primary/40 pl-3 text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{children}</div>;
}

/** Quantas mensagens ficam à vista: a última troca (pedido da equipe, resposta e avisos depois dela). */
export function inicioDaUltimaTroca(mensagens: { papel: string }[]): number {
  for (let k = mensagens.length - 1; k >= 0; k--) if (mensagens[k].papel === "usuario") return k;
  return 0;
}

function Esqueleto() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Lendo a conversa">
      <div className="ml-auto h-7 w-2/5 animate-pulse rounded-2xl bg-muted" />
      <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-16 w-full animate-pulse rounded-xl bg-muted/70" />
    </div>
  );
}

function Andamento({ desde, pesquisar }: { desde: number; pesquisar: boolean }) {
  const s = useSegundos(desde);
  return <Cronometro desde={desde} rotulo={etapaDaResposta(s, pesquisar)} previsao={pesquisar ? "1 a 4 minutos" : "1 a 2 minutos"} />;
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
  const [numerosDoEnvio, setNumerosDoEnvio] = useState<NumerosVistos | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const listaRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLSpanElement>(null);
  // Persistida no navegador (cache da Mesa): abre na hora com a última conversa e relê por trás.
  const conversa = useQuery({ queryKey: chavesAgente.conversa(clientId), queryFn: () => lerConversaDoAgente(clientId), staleTime: 60_000, retry: false });
  const mensagens: MensagemDoAgenteSenior[] = conversa.data ? conversa.data.mensagens : [];
  const corte = inicioDaUltimaTroca(mensagens);
  const antigas = mensagens.slice(0, corte);
  const recentes = mensagens.slice(corte);

  useEffect(() => {
    const el = listaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens.length, !!envio, !!numerosDoEnvio]);

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
    setNumerosDoEnvio(null);
    setTexto("");
    setAviso(null);
    // Primeira parte da resposta: os números que o agente vai ler (grátis, do cache de 5 min).
    void queryClient
      .fetchQuery({ queryKey: chaveDosNumeros(clientId, dias), queryFn: () => lerNumerosDoAgente(clientId, dias), staleTime: 5 * 60_000 })
      .then((n) => setNumerosDoEnvio(n))
      .catch(() => undefined);
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
      setNumerosDoEnvio(null);
    }
  };
  const podeEnviar = !!texto.trim() && !envio;

  const mostrar = (m: MensagemDoAgenteSenior) => {
    if (m.papel === "sistema") return <p key={m.id} className="text-center text-[11px] text-muted-foreground">{m.conteudo}</p>;
    if (m.papel === "usuario") return <FalaDaEquipe key={m.id}><p className="whitespace-pre-wrap">{m.conteudo}</p></FalaDaEquipe>;
    return (
      <FalaDoAgente key={m.id}>
        {m.estrategia ? (
          <EstrategiaNaTela e={m.estrategia} nomeDe={nomeDe} onCriarPlano={onCriarPlano} mensagemId={m.id} numeros={m.numeros} acoes={m.acoes} onPlanoPronto={onPlanoPronto} />
        ) : (
          <p className="whitespace-pre-wrap">{m.conteudo}</p>
        )}
      </FalaDoAgente>
    );
  };

  return (
    <section className={`flex min-w-0 flex-col rounded-xl border border-border bg-card ${className}`} aria-label="Agente sênior de tráfego">
      <div className="flex min-w-0 items-center px-4 pb-2 pt-3">
        <Briefcase className="mr-2 h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold">Agente sênior de tráfego</span>
          <span className="block text-[11.5px] text-muted-foreground">Lê a conta, recomenda e prepara as ações. Nada muda sem você confirmar.</span>
        </span>
      </div>

      <div ref={listaRef} className="min-w-0 space-y-4 border-t border-border px-4 py-3 sm:max-h-[640px] sm:overflow-y-auto sm:overscroll-contain" aria-live="polite" aria-label="Conversa com o agente sênior">
        {conversa.isLoading && <Esqueleto />}
        {conversa.isError && <AvisoDeErro erro={conversa.error} />}
        {conversa.data && mensagens.length === 0 && !envio && (
          <p className="py-3 text-center text-[12px] leading-relaxed text-muted-foreground">
            Peça o que fazer com a conta. Ele mostra o que leu, o que recomenda e as ações prontas para confirmar.
          </p>
        )}
        {antigas.length > 0 && (
          <div className="min-w-0">
            <button type="button" className="flex items-center text-[11.5px] font-medium text-muted-foreground hover:text-foreground" onClick={() => setHistoricoAberto(!historicoAberto)} aria-expanded={historicoAberto}>
              <ChevronDown className={`mr-1 h-3.5 w-3.5 transition-transform ${historicoAberto ? "rotate-180" : ""}`} />
              {historicoAberto ? "Esconder conversas anteriores" : `Conversas anteriores (${antigas.filter((m) => m.papel === "usuario").length || antigas.length})`}
            </button>
            {historicoAberto && <div className="mt-3 min-w-0 space-y-4 opacity-90">{antigas.map(mostrar)}</div>}
          </div>
        )}
        {recentes.map(mostrar)}
        {envio && (
          <div className="min-w-0 space-y-3">
            {envio.mensagem && <FalaDaEquipe><p className="whitespace-pre-wrap">{envio.mensagem}</p></FalaDaEquipe>}
            <FalaDoAgente>
              <div className="space-y-2">
                {numerosDoEnvio ? <NumerosQueEleViu n={numerosDoEnvio} carregando /> : <div className="h-8 w-3/4 animate-pulse rounded bg-muted" />}
                <Andamento desde={envio.desde} pesquisar={pesquisar} />
              </div>
            </FalaDoAgente>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border px-3 pb-3 pt-2">
        {aviso && <p className="text-[11px] text-muted-foreground">{aviso}</p>}
        <div className="flex flex-wrap" role="group" aria-label="Atalhos para o agente sênior">
          {ATALHOS.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              onClick={() => setTexto(a.texto)}
              title={a.texto}
              className="mb-1 mr-1 max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
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
            rows={2}
            aria-label="Mensagem ao agente sênior"
            placeholder="Ex.: pausa o que gasta sem conversa e sobe a verba do vencedor"
            className="max-h-40 min-h-[52px] resize-none border-0 bg-transparent px-1 py-1 text-[13px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
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
