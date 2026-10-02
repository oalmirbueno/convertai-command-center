import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, Loader2, Square, Undo2, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import CaminhoPronto from "./CaminhoPronto";
import MenuMais from "@/components/sistema/MenuMais";
import { toqueCompacto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import {
  acaoDoAnexo,
  emAndamento,
  estadoDaAcao,
  frasesDoResultado,
  MAX_ITENS_POR_ACAO,
  type AcaoDoAgente,
  type ItemDaAcaoDoAgente,
  type PedidoDaAcao,
  type RespostaDaAcao,
} from "@/lib/agentes/acoesDoAgente";

/** Teto de passos numa confirmação (nenhuma sequência passa disso: 120 itens de 1 em 1). */
const MAX_PASSOS = 130;

/**
 * Cartão genérico da ação que um agente propôs (contrato comum em
 * supabase/functions/_shared/acoes-do-agente.ts): a lista exata, item por
 * item, com Confirmar e Cancelar. Só a confirmação executa. Depois, cada item
 * mostra o motivo quando não pôde, e o Desfazer aparece quando há reverso.
 * Não depende da Mesa: quem usa passa a chamada (onPedido).
 *
 * Acompanhamento (dono, 27/09: "observando as ações de forma clara e poder
 * parar"): quando a função do agente faz em passos, o cartão segue passo a
 * passo, marca cada item feito, mostra "3 de 12" e o botão Parar. Parar
 * termina depois do passo em curso; o que já foi feito fica, com o Desfazer.
 * Função que faz tudo de uma vez segue igual (um clique, um passo).
 */
export default function CartaoDeAcao({
  acao,
  onPedido,
  onFeito,
  titulo,
  renderConfirmar,
  observacao,
  recemFeita = false,
  itensAVista,
}: {
  acao: AcaoDoAgente;
  onPedido: (pedido: PedidoDaAcao) => Promise<RespostaDaAcao>;
  /** Depois de confirmar ou desfazer (ex.: reler a lista da tela). */
  onFeito?: (pedido: PedidoDaAcao, resposta: RespostaDaAcao) => void;
  titulo?: string;
  /** Botão de confirmar com custo (ex.: BotaoComCusto da Mesa); sem ele, botão simples. */
  renderConfirmar?: (confirmar: () => Promise<RespostaDaAcao | null>, ocupado: boolean) => ReactNode;
  /** Linha pequena ao lado dos botões (ex.: "Sem custo."). */
  observacao?: string;
  /**
   * A ação chegou agora já feita (execução direta nesta conversa): com
   * `caminho.abrir_sozinho` ("faz e me leva"), a tela vai sozinha. Reabrir a
   * conversa não passa isto, então não navega.
   */
  recemFeita?: boolean;
  /**
   * 02/10 (editor de vídeo, dono: "fica gigante"): com muitos itens, mostra só
   * estes primeiros e "Ver os N"; sem isto, a lista inteira (como sempre foi).
   */
  itensAVista?: number;
}) {
  const [verTodos, setVerTodos] = useState(false);
  // O último estado conhecido desta proposta (mesma lista, mesmo id) vale sobre o que o pai guardou:
  // o pai remonta o cartão com o anexo antigo (lateral que recolhe, conversa relida) e o cartão não pode
  // voltar a oferecer Confirmar do que já foi feito.
  const [atual, setAtualLocal] = useState<AcaoDoAgente>(() => maisAvancada(acao, ultimoEstado.get(chaveDoCartao(acao))));
  const setAtual = (a: AcaoDoAgente) => {
    lembrarEstado(a);
    setAtualLocal(a);
  };
  const [fazendo, setFazendo] = useState<PedidoDaAcao | null>(null);
  // Só vai sozinho quando a confirmação acontece nesta tela (reabrir a conversa não navega).
  const [acabouAgora, setAcabouAgora] = useState(recemFeita && !!acao.executada_direto);
  // Parar pedido no meio da sequência: vale depois do passo em curso.
  const pararPedido = useRef(false);
  const [parando, setParando] = useState(false);
  // AG2 (29/09): antes o efeito dependia da referência do objeto. acoesDaMensagem cria objetos novos a
  // cada render do pai (ex.: digitar no campo), e o cartão feito voltava a "aberta", com Confirmar de novo
  // (e o segundo clique dava "Esta ação já foi feita"). Agora só sincroniza quando o CONTEÚDO muda, e
  // nunca volta para um estado mais atrasado do que o já visto.
  const assinatura = assinaturaDaAcao(acao);
  useEffect(() => {
    setAtualLocal((velho) => {
      const melhor = maisAvancada(acao, velho && chaveDoCartao(velho) === chaveDoCartao(acao) ? velho : ultimoEstado.get(chaveDoCartao(acao)));
      lembrarEstado(melhor);
      return melhor;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);
  const estado = estadoDaAcao(atual);
  const resultados = atual.resultados || [];
  const resultadoDe = (i: ItemDaAcaoDoAgente) => resultados.find((x) => x.ref === i.ref && x.operacao === i.operacao) || null;
  const falhas = resultados.filter((r) => !r.ok).length;
  const temReverso = !atual.sem_desfazer && resultados.some((r) => r.ok && r.desfazer);
  const andando = emAndamento(atual);
  const parada = estado === "feita" && !!atual.parada_em;

  /** Confirma e, quando a função faz em passos, segue até terminar ou até pedirem Parar. */
  const confirmarEmPassos = async (primeiro: PedidoDaAcao): Promise<{ r: RespostaDaAcao | null; novo: AcaoDoAgente | null }> => {
    let r: RespostaDaAcao | null = await onPedido(primeiro);
    let novo = r ? acaoDoAnexo(r.anexo) : null;
    let passos = 1;
    while (novo && emAndamento(novo) && passos < MAX_PASSOS) {
      setAtual(novo);
      const antes = (novo.resultados || []).length;
      if (pararPedido.current) {
        r = await onPedido("parar");
        novo = r ? acaoDoAnexo(r.anexo) : novo;
        break;
      }
      r = await onPedido("confirmar");
      const seguinte = r ? acaoDoAnexo(r.anexo) : null;
      passos++;
      // Passo que não andou (função antiga ou falha): para aqui, sem laço.
      if (!seguinte || (emAndamento(seguinte) && (seguinte.resultados || []).length <= antes)) {
        novo = seguinte || novo;
        break;
      }
      novo = seguinte;
    }
    return { r, novo };
  };

  const agir = async (pedido: PedidoDaAcao): Promise<RespostaDaAcao | null> => {
    setFazendo(pedido === "parar" ? "confirmar" : pedido);
    if (pedido === "confirmar") {
      pararPedido.current = false;
      setParando(false);
    }
    try {
      const passo = pedido === "confirmar" ? await confirmarEmPassos("confirmar") : null;
      const r = passo ? passo.r : await onPedido(pedido);
      const novo = passo ? passo.novo : r && acaoDoAnexo(r.anexo);
      if (novo) setAtual(novo);
      if (pedido === "confirmar" || pedido === "parar") {
        setAcabouAgora(true);
        const f = frasesDoResultado(novo ? novo.resultados : undefined, novo && novo.parada_em ? novo.itens.length : undefined);
        toast.success(f.titulo, { description: novo && novo.sem_desfazer && !novo.resultados?.some((x) => !x.ok) && !novo.parada_em ? "Pronto." : f.descricao });
      } else if (pedido === "desfazer") {
        const falharam = r && Array.isArray(r.falharam) ? r.falharam : [];
        if (falharam.length) {
          // AG2: parte não voltou. Antes o aviso dizia "Voltou como estava" e o motivo sumia.
          toast.warning(`${(r && r.voltaram) || 0} voltaram, ${falharam.length} não`, {
            description: falharam.slice(0, 3).map((f) => `${f.titulo || "item"}: ${f.motivo || "não foi possível"}`).join(". "),
            duration: 12000,
          });
        } else {
          toast.success("Voltou como estava", { description: `${(r && r.voltaram) || 0} ${r && r.voltaram === 1 ? "item voltou" : "itens voltaram"}.` });
        }
      }
      onFeito?.(pedido, r || {});
      return r || {};
    } catch (e) {
      toast.error(pedido === "desfazer" ? "Não foi possível desfazer" : pedido === "descartar" ? "Não foi possível cancelar" : pedido === "parar" ? "Não foi possível parar" : "Não foi possível fazer", {
        description: textoDoErro(e),
        duration: 9000,
      });
      return null;
    } finally {
      setFazendo(null);
      setParando(false);
      pararPedido.current = false;
    }
  };

  const pedirParar = () => {
    pararPedido.current = true;
    setParando(true);
  };

  const total = atual.itens.length;
  const feitosAgora = resultados.length;
  return (
    <section className="mr-6 min-w-0 rounded-2xl border border-primary/30 bg-card p-3.5" data-acao-agente={estado} data-andamento={andando ? `${feitosAgora}/${total}` : undefined}>
      <p className="flex items-center text-[12px] font-semibold">
        <Wand2 className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 truncate">{titulo || "O agente vai fazer"} · {total} {total === 1 ? "item" : "itens"}</span>
      </p>
      {atual.resumo && <p className="mt-1 text-[13px] leading-relaxed [overflow-wrap:anywhere]">{atual.resumo}</p>}
      {(andando || (fazendo === "confirmar" && feitosAgora > 0)) && (
        <div className="mt-2" role="status" aria-live="polite">
          <p className="text-[11px] text-muted-foreground">
            {fazendo ? (parando ? "Parando depois deste passo" : "Fazendo") : "Parou no meio"}: {feitosAgora} de {total}
          </p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round((feitosAgora / Math.max(1, total)) * 100)}%` }} />
          </div>
        </div>
      )}
      {total > 0 && (
        <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-background px-2.5 py-1">
          {(itensAVista && !verTodos && atual.itens.length > itensAVista + 1 ? atual.itens.slice(0, itensAVista) : atual.itens).map((i) => {
            const r = resultadoDe(i);
            const motivo = r && !r.ok ? r.motivo || "Não foi possível." : null;
            const para = i.para_rotulo || (i.para !== null && i.para !== undefined && i.para !== "" ? String(i.para) : "");
            return (
              <li key={`${i.operacao}-${i.ref}`} className={`flex min-w-0 items-start py-1 text-[12px] leading-snug ${(andando || parada) && !r ? "opacity-60" : ""}`} data-item-feito={r ? (r.ok ? "sim" : "nao") : undefined}>
                {r && r.ok && <Check className="mr-1 mt-0.5 h-3 w-3 shrink-0 text-success" aria-label="feito" />}
                <span className="mr-1.5 mt-px shrink-0 rounded bg-muted px-1.5 py-px text-[10.5px] font-medium">{i.rotulo}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="font-medium">{i.titulo}</span>
                  {i.detalhe && <span className="text-muted-foreground"> · {i.detalhe}</span>}
                  {para && (
                    <span className="text-muted-foreground">
                      {" "}
                      <ArrowRight className="inline h-3 w-3" /> {para}
                    </span>
                  )}
                  {motivo && <span className="block text-[11px] text-destructive">{motivo}</span>}
                </span>
              </li>
            );
          })}
          {!!itensAVista && atual.itens.length > itensAVista + 1 && (
            <li className="py-1">
              <button type="button" className="text-[12px] text-primary hover:underline" onClick={() => setVerTodos((v) => !v)} aria-expanded={verTodos} data-ver-todos-os-itens="">
                {verTodos ? "Ver menos" : `Ver os ${atual.itens.length} itens`}
              </button>
            </li>
          )}
        </ul>
      )}
      {atual.recusados.length > 0 && (
        <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          <p className="font-medium">Fica de fora:</p>
          <ul>
            {atual.recusados.map((r) => (
              <li key={`r-${r.operacao}-${r.ref}`} className="[overflow-wrap:anywhere]">
                {r.titulo}: {r.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
      {atual.ignorados.length > 0 && estado === "aberta" && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {atual.ignorados.length} {atual.ignorados.length === 1 ? "pedido não entrou" : "pedidos não entraram"}: item que não existe na lista.
        </p>
      )}
      {!!atual.acima_do_teto && estado === "aberta" && (
        <p className="mt-1 text-[11px] text-muted-foreground" data-acima-do-teto={atual.acima_do_teto}>
          {atual.acima_do_teto} {atual.acima_do_teto === 1 ? "item ficou" : "itens ficaram"} para um próximo pedido: o limite é {MAX_ITENS_POR_ACAO} por vez.
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center">
        {estado === "aberta" && fazendo === "confirmar" && feitosAgora > 0 && (
          <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8" onClick={pedirParar} disabled={parando} data-parar-sequencia="">
            {parando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Square className="mr-1.5 h-3 w-3" />}
            {parando ? "Parando" : "Parar"}
          </Button>
        )}
        {estado === "aberta" && andando && !fazendo && (
          <>
            <Button type="button" size="sm" className="mb-1 mr-1.5 h-8" onClick={() => void agir("confirmar")}>
              <Check className="mr-1.5 h-3.5 w-3.5" />
              Continuar
            </Button>
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-muted-foreground" onClick={() => void agir("parar")}>
              Parar aqui
            </Button>
            <span className="mb-1 ml-auto text-[11px] text-muted-foreground">O que já foi feito fica, e dá para desfazer.</span>
          </>
        )}
        {estado === "aberta" && total > 0 && !andando && !(fazendo === "confirmar" && feitosAgora > 0) && (
          <>
            {renderConfirmar ? (
              <span className="mb-1 mr-1.5">{renderConfirmar(() => agir("confirmar"), !!fazendo)}</span>
            ) : (
              <Button type="button" size="sm" className="mb-1 mr-1.5 h-8" onClick={() => void agir("confirmar")} disabled={!!fazendo}>
                {fazendo === "confirmar" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                Confirmar
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-muted-foreground" onClick={() => void agir("descartar")} disabled={!!fazendo}>
              {fazendo === "descartar" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Cancelar
            </Button>
            <span className="mb-1 ml-auto text-[11px] text-muted-foreground">
              {observacao || (atual.sem_desfazer ? "Nada muda até confirmar." : "Nada muda até confirmar, e dá para desfazer.")}
            </span>
          </>
        )}
        {estado === "feita" && (
          <>
            <span className="mb-1 mr-2 inline-flex items-center rounded-full bg-success/15 px-2.5 py-1 text-[11px] text-foreground">
              <Check className="mr-1 h-3 w-3" />
              {parada ? `Parado · ${resultados.filter((r) => r.ok).length} de ${total} feitos` : atual.executada_direto ? "Feito na hora" : "Feito"}
              {falhas ? ` · ${falhas} não ${falhas === 1 ? "pôde" : "puderam"}` : ""}
            </span>
            <CaminhoPronto caminho={atual.caminho} abrirSozinho={acabouAgora && !falhas && !parada && !!atual.caminho && atual.caminho.abrir_sozinho === true} />
            {temReverso && (
              <Button type="button" size="sm" variant="outline" className="mb-1 h-8" onClick={() => void agir("desfazer")} disabled={!!fazendo}>
                {fazendo === "desfazer" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Undo2 className="mr-1.5 h-3.5 w-3.5" />}
                Desfazer
              </Button>
            )}
          </>
        )}
        {(estado === "descartada" || estado === "desfeita") && (
          <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
            <X className="mr-1 h-3 w-3" />
            {estado === "desfeita" ? "Desfeito: voltou como estava" : "Cancelado: nada mudou"}
          </span>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ estado que não volta atrás

/**
 * Último estado visto de cada proposta nesta aba (id + itens): sobrevive a remontar o cartão.
 * Mora no globalThis para os testes limparem entre um caso e outro (src/test/setup.ts) sem importar a tela.
 */
const GLOBAL = globalThis as unknown as { __estadosDosCartoesDeAcao?: Map<string, AcaoDoAgente> };
const ultimoEstado: Map<string, AcaoDoAgente> = GLOBAL.__estadosDosCartoesDeAcao || (GLOBAL.__estadosDosCartoesDeAcao = new Map<string, AcaoDoAgente>());
const MAX_LEMBRADOS = 300;

/** Chave da proposta: o id e a lista (dois agentes nunca colidem pelo id curto). */
export function chaveDoCartao(a: Pick<AcaoDoAgente, "id" | "agente" | "itens">): string {
  return `${a.agente || ""}|${a.id || ""}|${(a.itens || []).map((i) => `${i.operacao}:${i.ref}:${i.alvo_id || ""}`).join(",")}`;
}

/** O que muda o cartão: estado e andamento (não a identidade do objeto). */
export function assinaturaDaAcao(a: AcaoDoAgente): string {
  return [chaveDoCartao(a), a.executada_em || "", a.descartada_em || "", a.desfeita_em || "", a.parada_em || "", (a.resultados || []).length].join("|");
}

function ordemDoEstado(a: AcaoDoAgente): number {
  const e = estadoDaAcao(a);
  return e === "desfeita" ? 3 : e === "feita" || e === "descartada" ? 2 : 1;
}

/** Entre o que o pai mandou e o que o cartão já viu, fica o mais adiantado (sem nunca voltar atrás). */
export function maisAvancada(dada: AcaoDoAgente, vista: AcaoDoAgente | null | undefined): AcaoDoAgente {
  if (!vista || chaveDoCartao(vista) !== chaveDoCartao(dada)) return dada;
  const od = ordemDoEstado(dada);
  const ov = ordemDoEstado(vista);
  if (ov !== od) return ov > od ? vista : dada;
  return (vista.resultados || []).length > (dada.resultados || []).length ? vista : dada;
}

function lembrarEstado(a: AcaoDoAgente) {
  if (!a || !a.id) return;
  const k = chaveDoCartao(a);
  ultimoEstado.delete(k);
  ultimoEstado.set(k, a);
  if (ultimoEstado.size > MAX_LEMBRADOS) {
    const primeira = ultimoEstado.keys().next();
    if (!primeira.done) ultimoEstado.delete(primeira.value);
  }
}

/** Atalhos à vista: até 4; com mais, 3 e o "..." com o resto (nenhum fica escondido). */
export const MAX_ATALHOS_A_VISTA = 4;

/**
 * Linha curta do que o agente sabe fazer, com atalhos que preenchem o campo.
 * Sem poluir: uma linha e, no máximo, quatro atalhos à vista. Com mais de
 * quatro, ficam três e o "..." ("Mais atalhos") com os outros, na mesma ordem.
 *
 * `mostrarCapacidades={false}`: a lista já está no "?" do cabeçalho
 * (CapacidadesDoAgente) e aqui ficam só os atalhos. No celular os atalhos têm
 * 44 px de toque (toqueCompacto) sem crescer na tela.
 */
export function OQuePossoFazer({
  capacidades,
  atalhos = [],
  onAtalho,
  mostrarCapacidades = true,
  className = "",
}: {
  capacidades: string[];
  atalhos?: { rotulo: string; texto: string }[];
  onAtalho?: (texto: string) => void;
  mostrarCapacidades?: boolean;
  className?: string;
}) {
  if (!capacidades.length) return null;
  const comAtalhos = atalhos.length > 0 && !!onAtalho;
  if (!mostrarCapacidades && !comAtalhos) return null;
  const muitos = atalhos.length > MAX_ATALHOS_A_VISTA;
  const aVista = muitos ? atalhos.slice(0, MAX_ATALHOS_A_VISTA - 1) : atalhos;
  const noMais = muitos ? atalhos.slice(MAX_ATALHOS_A_VISTA - 1) : [];
  return (
    <div className={`min-w-0 ${className}`}>
      {mostrarCapacidades && (
        <p className="truncate text-[11px] text-muted-foreground" title={`Posso: ${capacidades.join(", ")}.`}>
          <span className="font-medium text-foreground">Posso:</span> {capacidades.join(", ")}.
        </p>
      )}
      {comAtalhos && onAtalho && (
        <div className={`${mostrarCapacidades ? "mt-1 " : ""}-mb-2 flex flex-wrap items-center`} role="group" aria-label="Atalhos de ação">
          {aVista.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              title={a.texto.trim()}
              onClick={() => onAtalho(a.texto)}
              className={`${toqueCompacto} mb-2 mr-1 max-w-full truncate rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground`}
            >
              {a.rotulo}
            </button>
          ))}
          {noMais.length > 0 && (
            <MenuMais
              rotulo="Mais atalhos"
              alinhar="start"
              semDevolverFoco
              className="mb-2 h-7 w-7"
              itens={noMais.map((a) => ({ rotulo: a.rotulo, dica: a.texto.trim(), aoEscolher: () => onAtalho(a.texto) }))}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * O que o agente sabe fazer, dentro do "?" do cabeçalho (AjudaRecolhida): a
 * lista inteira, que na linha do compositor só cabia cortada. As marcas "(na
 * hora)", "(com Confirmar)" e "(com custo no cartão)" de cada item dizem o que
 * pede confirmação.
 */
export function CapacidadesDoAgente({ capacidades }: { capacidades: string[] }) {
  if (!capacidades.length) return null;
  return (
    <div className="mt-2 min-w-0" data-capacidades-do-agente="">
      <p className="font-medium text-foreground">Posso</p>
      <ul className="mt-0.5 list-disc pl-4">
        {capacidades.map((c) => (
          <li key={c} className="mt-0.5">
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}
