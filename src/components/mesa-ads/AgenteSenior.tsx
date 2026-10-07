import SugestoesDoAgente from "@/components/agentes/SugestoesDoAgente";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AprendizadoDoAgente from "@/components/agentes/AprendizadoDoAgente";
import { esquecerRegraAprendida, guardarRegraAprendida } from "@/lib/agentes/aprendizadoDoLancador";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { Briefcase, Check, ChevronDown, Cpu, ExternalLink, FlaskConical, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto } from "@/components/mesa/Custo";
import { SeletorDeModelo, SeletorDeRaciocinio } from "@/components/mesa/Seletores";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { foco, juntar } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { useMesa } from "@/components/mesa/MesaContexto";
import { Cronometro, useSegundos } from "@/components/mesa/Cronometro";
import { nomeDoModelo, precoDoModelo } from "@/lib/mesa/api";
import { brl, chamarAds, humanizar, partesDoPlanoV2, rotuloDoObjetivo, type PedidoDePlano } from "./adsApi";
import {
  chavesAgente,
  lerConversaDoAgente,
  modeloEfetivo,
  partesDoAgenteSenior,
  rotuloDoRaciocinio,
  ROTULO_DA_GRAVIDADE,
  type AndamentoDoPedido,
  type EscolhaDoModelo,
  type EstrategiaSenior,
  type MensagemDoAgenteSenior,
} from "./agenteSeniorApi";
import { BotaoDoPlanoDoAgente, CartaoDasAcoes, NumerosQueEleViu } from "./AcoesDoAgente";
import { chaveDosNumeros, lerNumerosDoAgente, type AcoesDaConta, type NumerosVistos } from "./acoesDoAgenteApi";
import { chavesRotina } from "./rotinaApi";

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
 *
 * 26/09 (sistema de design): casca PainelDoAgente (cabeçalho e campo fixos,
 * só a conversa rola). Na aba Conta é a lateral fixa da área de trabalho
 * (no celular, a gaveta do botão de baixo); no Plano de teste abre no lugar,
 * com altura própria. A coluna é estreita: os blocos da resposta ficam um
 * embaixo do outro. O rascunho do campo fica lembrado por cliente.
 *
 * 27/09 (frente TR: "não consigo selecionar os modelos; de padrão GPT-6 Luna
 * Max; faz tudo sozinho quando eu pedir; menos burocracia"): o modelo e o
 * raciocínio ficam numa linha que abre os seletores das outras mesas
 * (Seletores.tsx), lembrados por cliente, com o custo no Enviar; padrão GPT-6
 * Luna no máximo. "Otimizar agora" é o botão principal: um clique e ele analisa
 * e já faz o que é seguro (o resto fica para confirmar). O plano mandado pelo
 * Plano de teste chega aqui e ele assume sozinho (monta a campanha pausada).
 */

/** O clique único: analisa e já faz o seguro; o que aumenta gasto ou cria coisa fica para confirmar. */
/**
 * Frente AD4 (28/09, dono): "otimizar" compara cada anúncio ativo com os números reais e a régua do
 * nicho e da conta; o que está bom fica, o que está ruim ganha a troca pelo melhor do acervo, que só
 * roda no Confirmar. No servidor é régua em código + Jev (sem o modelo pesado): rápido e barato.
 */
export const TEXTO_DE_OTIMIZAR = "Otimize a conta: compare cada anúncio ativo com a régua; o que está bom fica, o que está ruim troca pelo melhor criativo do acervo, com os números. Eu confirmo a troca.";

const ATALHOS = [
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
export function etapaDaResposta(segundos: number, pesquisar: boolean, assumindo = false): string {
  if (assumindo && segundos >= 6) return segundos < 70 ? "Lendo o plano e montando a campanha" : "Subindo os criativos na Meta, tudo pausado";
  if (segundos < 6) return "Lendo a conta e os criativos";
  if (pesquisar && segundos < 45) return "Pesquisando o nicho e a Biblioteca de Anúncios";
  if (segundos < (pesquisar ? 110 : 70)) return "Escrevendo a análise e as ações";
  return "Conferindo as ações na Meta";
}

function Titulo({ children }: { children: ReactNode }) {
  return <p className="mb-1 text-[12px] font-semibold text-muted-foreground">{children}</p>;
}

function Grupo({ titulo, tom, itens }: { titulo: string; tom: string; itens: { chave: string; titulo: string; texto: string }[] }) {
  if (!itens.length) return null;
  return (
    <div className="min-w-0">
      <p className={`text-[12px] font-semibold ${tom}`}>{titulo} ({itens.length})</p>
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
        <p className="mb-1 mr-2 flex items-center text-[12px] font-semibold text-muted-foreground">
          <FlaskConical className="mr-1 h-3.5 w-3.5 text-primary" /> Plano de teste
        </p>
        {mensagemId && <BotaoDoPlanoDoAgente mensagemId={mensagemId} onPlanoPronto={onPlanoPronto} className="mb-1 ml-auto" />}
      </div>
      <dl className="min-w-0 space-y-0.5 text-[12px] leading-snug">
        {linhas.map(([r, v]) => (
          <div key={r} className="min-w-0">
            <dt className="text-muted-foreground">{r}</dt>
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
          <div className="grid min-w-0 grid-cols-1 gap-3 pt-1">
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
                <p className="text-[12px] font-semibold text-primary">Reestruturação recomendada</p>
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
                  <p className="mb-1 mr-2 text-[12px] font-semibold text-muted-foreground">Próximos criativos ({e.proximos_criativos.length})</p>
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
      <div className="h-16 w-full animate-pulse rounded-lg bg-muted/70" />
    </div>
  );
}

function Andamento({ desde, pesquisar, assumindo = false, servidor = null }: { desde: number; pesquisar: boolean; assumindo?: boolean; servidor?: AndamentoDoPedido | null }) {
  const s = useSegundos(desde);
  // Frente AD: com o andamento gravado pelo servidor, as etapas são as reais (não estimadas pelo tempo).
  if (servidor && servidor.historico.length) {
    const feitas = servidor.historico.slice(0, -1);
    return (
      <div className="min-w-0 space-y-1" data-andamento-real={servidor.etapa}>
        <ul className="min-w-0 space-y-0.5">
          {feitas.map((h, k) => (
            <li key={k} className="flex items-start text-[11.5px] leading-snug text-muted-foreground">
              <Check className="mr-1 mt-0.5 h-3 w-3 shrink-0 text-success" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{h.rotulo}</span>
            </li>
          ))}
        </ul>
        <Cronometro desde={desde} rotulo={servidor.rotulo || etapaDaResposta(s, pesquisar, assumindo)} previsao={servidor.etapa === "executando" || servidor.etapa === "entendendo" ? "alguns segundos" : pesquisar ? "1 a 4 minutos" : "1 a 2 minutos"} />
      </div>
    );
  }
  return <Cronometro desde={desde} rotulo={etapaDaResposta(s, pesquisar, assumindo)} previsao={pesquisar ? "1 a 4 minutos" : "1 a 2 minutos"} />;
}

/**
 * O modelo do agente numa linha (nome, raciocínio e preço por 1M); abre os
 * seletores das outras mesas (Seletores.tsx). A escolha fica lembrada por
 * cliente; vazio = o padrão (GPT-6 Luna no máximo).
 */
function LinhaDoModelo({ escolha, onEscolher }: { escolha: EscolhaDoModelo; onEscolher: (e: EscolhaDoModelo) => void }) {
  const { catalogo } = useMesa();
  const [aberta, setAberta] = useState(false);
  const efetivo = modeloEfetivo(catalogo, escolha);
  const m = efetivo.modelo;
  return (
    <div className="mb-1.5 min-w-0" data-modelo-do-agente={m ? m.id : ""}>
      <button
        type="button"
        className={juntar("flex w-full min-w-0 items-center rounded text-left text-[11.5px] text-muted-foreground hover:text-foreground", foco)}
        onClick={() => setAberta(!aberta)}
        aria-expanded={aberta}
        aria-label="Modelo do agente sênior"
        title="Trocar o modelo e o raciocínio (lembrado para este cliente)"
      >
        <Cpu className="mr-1 h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {m ? nomeDoModelo(m) : "Sem modelo de texto ativo"}
          {efetivo.raciocinio ? ` · ${rotuloDoRaciocinio(efetivo.raciocinio)}` : ""}
          {m ? ` · ${precoDoModelo(m)}` : ""}
          {!escolha.modelo ? " · padrão" : ""}
        </span>
        <ChevronDown className={`ml-1 h-3.5 w-3.5 shrink-0 transition-transform ${aberta ? "rotate-180" : ""}`} />
      </button>
      {aberta && (
        <div className="mt-1.5 grid min-w-0 grid-cols-1 gap-2 rounded-md bg-muted/50 p-2 sm:grid-cols-2">
          <SeletorDeModelo
            catalogo={catalogo}
            tipo="texto"
            valor={m ? m.id : ""}
            onChange={(id) => onEscolher({ modelo: id, raciocinio: "" })}
            rotulo="Modelo do agente"
          />
          <SeletorDeRaciocinio modelo={m} valor={efetivo.raciocinio} onChange={(r) => onEscolher({ modelo: m ? m.id : escolha.modelo, raciocinio: r })} />
          {escolha.modelo && (
            <button type="button" className={juntar("justify-self-start rounded text-[11.5px] text-primary hover:underline sm:col-span-2", foco)} onClick={() => onEscolher({ modelo: "", raciocinio: "" })}>
              Voltar ao padrão (GPT-6 Luna, raciocínio máximo)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const validarEscolha = (v: unknown) => !!v && typeof v === "object" && typeof (v as EscolhaDoModelo).modelo === "string" && typeof (v as EscolhaDoModelo).raciocinio === "string";

export default function AgenteSenior({
  nomeDe = (x) => `Anúncio ${x}`,
  planoId,
  dias = 30,
  onCriarPlano,
  onPlanoPronto,
  assumir = null,
  onAssumido,
  pedidoPronto = null,
  className = "",
}: {
  nomeDe?: (adId: string) => string;
  planoId?: string | null;
  dias?: number;
  onCriarPlano?: (p: PedidoDePlano) => void;
  /** Plano de teste criado já preenchido (abre no Plano de teste). */
  onPlanoPronto?: (planoId: string) => void;
  /** Plano mandado pelo "Enviar ao agente sênior": ele assume sozinho (monta a campanha pausada). */
  assumir?: { plano_id: string; nome: string } | null;
  onAssumido?: () => void;
  /** Texto pronto para o campo (proposta da rotina levada ao agente). */
  pedidoPronto?: { texto: string; em: number } | null;
  /** Na lateral da área de trabalho ocupa a coluna; solto na página, quem usa dá a altura. */
  className?: string;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  // Rascunho lembrado por cliente (sair e voltar mantém o que foi escrito).
  const [texto, setTexto] = useEstadoDaTela(`mesa-ads:agente-senior:rascunho:${clientId}`, "");
  // Modelo e raciocínio lembrados por cliente; vazio = padrão (GPT-6 Luna no máximo).
  const [escolha, setEscolha] = useEstadoDaTela<EscolhaDoModelo>(`mesa-ads:agente-senior:modelo:${clientId}`, { modelo: "", raciocinio: "" }, { validar: validarEscolha, esperaMs: 0 });
  const efetivo = modeloEfetivo(catalogo, escolha);
  const [pesquisar, setPesquisar] = useState(true);
  const [agir, setAgir] = useState(lerModoAgir);
  const [envio, setEnvio] = useState<{ mensagem: string; desde: number; assumindo: boolean } | null>(null);
  const [numerosDoEnvio, setNumerosDoEnvio] = useState<NumerosVistos | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const listaRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLSpanElement>(null);
  const assumidos = useRef<Set<string>>(new Set());
  // Persistida no navegador (cache da Mesa): abre na hora com a última conversa e relê por trás.
  const [esperando, setEsperando] = useState(false);
  // Enquanto espera a resposta, relê a conversa a cada 3 s: a mensagem já está gravada e o andamento é o real.
  const conversa = useQuery({ queryKey: chavesAgente.conversa(clientId), queryFn: () => lerConversaDoAgente(clientId), staleTime: 60_000, retry: false, refetchInterval: esperando ? 3000 : false });
  const mensagens: MensagemDoAgenteSenior[] = conversa.data ? conversa.data.mensagens : [];
  const corte = inicioDaUltimaTroca(mensagens);
  const antigas = mensagens.slice(0, corte);
  const recentes = mensagens.slice(corte);

  useEffect(() => {
    const el = listaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens.length, !!envio, !!numerosDoEnvio]);

  // Proposta da rotina levada ao agente: entra no campo (nada roda sem o clique).
  useEffect(() => {
    if (pedidoPronto && pedidoPronto.texto) setTexto(pedidoPronto.texto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoPronto ? pedidoPronto.em : 0]);

  const mudarAgir = (v: boolean) => {
    setAgir(v);
    try {
      window.localStorage.setItem(CHAVE_DO_MODO, v ? "1" : "0");
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  };

  /** Uma mensagem ao agente (com o modelo escolhido). `agirAgora`: ele já faz o seguro. */
  const enviarMensagem = async (mensagem: string, opcoes: { agirAgora?: boolean; otimizar?: boolean; assumirPlano?: { plano_id: string; nome: string } | null; limparCampo?: boolean } = {}) => {
    const assumindo = !!opcoes.assumirPlano;
    setEnvio({ mensagem: assumindo ? `Assuma o plano ${opcoes.assumirPlano!.nome} e monte a campanha.` : mensagem, desde: Date.now(), assumindo });
    setEsperando(true);
    setNumerosDoEnvio(null);
    if (opcoes.limparCampo) setTexto("");
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
        plano_id: (opcoes.assumirPlano ? opcoes.assumirPlano.plano_id : planoId) || undefined,
        dias,
        // Assumir o plano e otimizar não pesquisam na web (o custo mostrado é sem pesquisa).
        pesquisar: assumindo || opcoes.otimizar ? false : pesquisar,
      };
      if (efetivo.modelo) corpo.modelo_id = efetivo.modelo.id;
      if (efetivo.raciocinio) corpo.raciocinio = efetivo.raciocinio;
      if (assumindo) corpo.modo = "assumir_plano";
      else if (opcoes.otimizar) corpo.modo = "otimizar";
      else if (opcoes.agirAgora) corpo.modo = "agir";
      const data = await chamarAds<any>("conta_conversar", corpo);
      const b = data && data.pesquisa && data.pesquisa.biblioteca;
      if (pesquisar && b && b.motivo) setAviso(`Biblioteca de Anúncios: ${b.motivo}`);
      await queryClient.invalidateQueries({ queryKey: chavesAgente.conversa(clientId) });
      if (data && Number(data.feitas_sozinho) > 0) {
        void queryClient.invalidateQueries({ queryKey: ["mesa", "urls", "ads-conta", clientId] });
        void queryClient.invalidateQueries({ queryKey: ["mesa", "urls", "ads-resultados", clientId] });
        void queryClient.invalidateQueries({ queryKey: chavesRotina.rotina(clientId) });
      }
      return data;
    } catch (e) {
      if (opcoes.limparCampo) setTexto((t) => t || mensagem);
      throw e;
    } finally {
      setEnvio(null);
      setEsperando(false);
      setNumerosDoEnvio(null);
      // Mesmo quando deu erro, a conversa tem o pedido e o motivo gravados.
      void queryClient.invalidateQueries({ queryKey: chavesAgente.conversa(clientId) });
    }
  };

  const enviar = () => enviarMensagem(texto.trim(), { agirAgora: agir, limparCampo: true });
  const otimizar = () => {
    void enviarMensagem(TEXTO_DE_OTIMIZAR, { otimizar: true }).catch((e) => setAviso(`O otimizar não terminou: ${e instanceof Error ? e.message : "tente de novo."}`));
  };
  const podeEnviar = !!texto.trim() && !envio;

  // O plano mandado pelo "Enviar ao agente sênior": ele assume sozinho, uma vez (o custo apareceu no botão do plano).
  const conversaPronta = !!conversa.data;
  // O pedido de agora já gravado no servidor (a mensagem do dono com o andamento): a tela não repete a fala.
  const pedidoGravado = envio
    ? mensagens.slice().reverse().filter((m) => m.papel === "usuario" && !!m.andamento && Date.parse(m.criado_em) >= envio.desde - 120_000)[0] || null
    : null;
  useEffect(() => {
    if (!assumir || !conversaPronta || envio || assumidos.current.has(assumir.plano_id)) return;
    assumidos.current.add(assumir.plano_id);
    const plano = assumir;
    void enviarMensagem("", { assumirPlano: plano })
      .catch((e) => setAviso(`O agente não assumiu o plano ${plano.nome}: ${e instanceof Error ? e.message : "tente de novo pelo Plano de teste."}`))
      .finally(() => {
        if (onAssumido) onAssumido();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assumir ? assumir.plano_id : "", conversaPronta]);

  const mostrar = (m: MensagemDoAgenteSenior) => {
    if (m.papel === "sistema") return <p key={m.id} className="text-center text-[11px] text-muted-foreground">{m.conteudo}</p>;
    if (m.papel === "usuario") return <FalaDaEquipe key={m.id}><p className="whitespace-pre-wrap">{m.conteudo}</p></FalaDaEquipe>;
    return (
      <FalaDoAgente key={m.id}>
        {m.estrategia ? (
          <EstrategiaNaTela e={m.estrategia} nomeDe={nomeDe} onCriarPlano={onCriarPlano} mensagemId={m.id} numeros={m.numeros} acoes={m.acoes} onPlanoPronto={onPlanoPronto} />
        ) : (
          <div className="min-w-0 space-y-2">
            <TextoDoAgente texto={m.conteudo} />
            {/* Ordem direta (frente AD): a resposta curta vem com o cartão do que foi feito, a prova e o Voltar. */}
            {m.acoes && <CartaoDasAcoes mensagemId={m.id} acoes={m.acoes} onPlanoPronto={onPlanoPronto} />}
          </div>
        )}
        {/* Frente AG3: o que ele aprendeu com o pedido (Esquecer) e as regras do dono que seguiu. */}
        <AprendizadoDoAgente
          anexos={m.aprendizado}
          onEsquecer={(id) => esquecerRegraAprendida("mesa-ads", id, { client_id: clientId })}
          onGuardar={(texto, tipo) => guardarRegraAprendida("mesa-ads", { texto, categoria: tipo }, { client_id: clientId })}
        />
      </FalaDoAgente>
    );
  };

  // Casca fixa de agente (src/components/sistema/PainelDoAgente.tsx): cabeçalho e
  // campo sempre à vista; só a conversa rola, por dentro. Na aba Conta é a lateral
  // da área de trabalho; no Plano de teste abre no lugar, com altura própria.
  return (
    <PainelDoAgente
      className={className}
      titulo="Agente sênior de tráfego"
      descricao="Faz o seguro sozinho; o resto você confirma"
      icone={<Briefcase className="h-4 w-4" />}
      acoes={
        <AjudaRecolhida rotulo="Como o agente sênior funciona">
          Antes de responder, monta o retrato da campanha (cada nível com gasto, resultados, custo, CTR, CPM, frequência e fase de aprendizado), compara com o custo-alvo e a referência do nicho e lê o que já foi feito. Quando você pede para fazer, ele já faz o que é seguro (pausar o que queima, baixar verba, renomear), relendo a Meta antes e com Desfazer; ativar, subir verba e criar coisa nova esperam o seu Confirmar. Uma chamada por mensagem, com o custo à vista.
        </AjudaRecolhida>
      }
      refDasMensagens={listaRef}
      rotuloDasMensagens="Conversa com o agente sênior"
      avisos={aviso ? <p className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{aviso}</p> : null}
      compositor={
        <>
          <LinhaDoModelo escolha={escolha} onEscolher={setEscolha} />
          <div className="mb-1.5 flex min-w-0 flex-wrap items-center">
            <span className="mb-1 mr-1.5">
              <Button
                type="button"
                size="sm"
                className="h-8"
                onClick={otimizar}
                disabled={!!envio}
                title="Um clique: compara cada anúncio ativo com a régua do nicho e da conta (7 dias). Bom fica; ruim ganha a troca pelo melhor do acervo, que só roda no seu Confirmar. Só o Jev (centavos), sem o modelo pesado."
              >
                <Sparkles className="mr-1 h-3.5 w-3.5" /> Otimizar agora
              </Button>
            </span>
            <SugestoesDoAgente><div className="mb-1 flex min-w-0 flex-wrap" role="group" aria-label="Atalhos para o agente sênior">
              {ATALHOS.map((a) => (
                <button
                  key={a.rotulo}
                  type="button"
                  onClick={() => setTexto(a.texto)}
                  title={a.texto}
                  className={juntar("mb-1 mr-1 max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground", foco)}
                >
                  {a.rotulo}
                </button>
              ))}
            </div></SugestoesDoAgente>
          </div>
          <div className="rounded-md border border-input bg-background p-2 focus-within:border-primary/60">
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
              <label className="mb-1 mr-3 inline-flex min-w-0 items-center text-[11.5px] text-muted-foreground" title="Resposta curta e ele já faz o que é seguro; o resto fica pronto para confirmar">
                <input type="checkbox" className="mr-1.5" checked={agir} onChange={(e) => mudarAgir(e.target.checked)} />
                Direto às ações
              </label>
              <label className="mb-1 mr-2 inline-flex min-w-0 items-center text-[11.5px] text-muted-foreground" title="Pesquisar na web e na Biblioteca de Anúncios">
                <input type="checkbox" className="mr-1.5" checked={pesquisar} onChange={(e) => setPesquisar(e.target.checked)} />
                Pesquisar na web e na Biblioteca de Anúncios
              </label>
              <span ref={botaoRef} className="mb-1 ml-auto shrink-0">
                <BotaoComCusto
                  rotulo="Enviar"
                  titulo="Mensagem ao agente sênior"
                  descricao={`Uma chamada do agente sênior (${efetivo.modelo ? nomeDoModelo(efetivo.modelo) : "modelo padrão"}${efetivo.raciocinio ? `, ${rotuloDoRaciocinio(efetivo.raciocinio)}` : ""}) com a conta, a evolução, os criativos e o contexto do cliente${pesquisar ? ", com pesquisa web" : ""}. O Jev identifica o nicho e se você pediu para fazer (centavos). Se pediu, ele já faz o seguro, com Desfazer.`}
                  partes={() => partesDoAgenteSenior(catalogo, pesquisar, efetivo)}
                  executar={enviar}
                  disabled={!podeEnviar}
                  variant="outline"
                  className="h-8"
                />
              </span>
            </div>
          </div>
        </>
      }
    >
      {conversa.isLoading && <Esqueleto />}
      {conversa.isError && <AvisoDeErro erro={conversa.error} />}
      {conversa.data && mensagens.length === 0 && !envio && (
        <p className="py-3 text-center text-[12px] leading-relaxed text-muted-foreground">
          Peça o que fazer com a conta. Ele mostra o que leu, faz o que é seguro quando você pede e deixa o resto pronto para confirmar.
        </p>
      )}
      {antigas.length > 0 && (
        <div className="min-w-0">
          <button type="button" className={juntar("flex items-center rounded text-[11.5px] font-medium text-muted-foreground hover:text-foreground", foco)} onClick={() => setHistoricoAberto(!historicoAberto)} aria-expanded={historicoAberto}>
            <ChevronDown className={`mr-1 h-3.5 w-3.5 transition-transform ${historicoAberto ? "rotate-180" : ""}`} />
            {historicoAberto ? "Esconder conversas anteriores" : `Conversas anteriores (${antigas.filter((m) => m.papel === "usuario").length || antigas.length})`}
          </button>
          {historicoAberto && <div className="mt-3 min-w-0 space-y-4 opacity-90">{antigas.map(mostrar)}</div>}
        </div>
      )}
      {recentes.map(mostrar)}
      {envio && (
        <div className="min-w-0 space-y-3">
          {envio.mensagem && !pedidoGravado && <FalaDaEquipe><p className="whitespace-pre-wrap">{envio.mensagem}</p></FalaDaEquipe>}
          <FalaDoAgente>
            <div className="space-y-2">
              {numerosDoEnvio ? <NumerosQueEleViu n={numerosDoEnvio} carregando /> : <div className="h-8 w-3/4 animate-pulse rounded bg-muted" />}
              <Andamento desde={envio.desde} pesquisar={pesquisar} assumindo={envio.assumindo} servidor={pedidoGravado ? pedidoGravado.andamento || null : null} />
            </div>
          </FalaDoAgente>
        </div>
      )}
    </PainelDoAgente>
  );
}
