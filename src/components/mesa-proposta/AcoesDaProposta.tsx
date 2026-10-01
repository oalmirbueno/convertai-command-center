import { Fragment, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, BookOpen, Check, ChevronDown, CopyPlus, FileText, LayoutTemplate, List, Plus, Undo2, XCircle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useConfirm } from "@/components/shared/confirmDialog";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import MenuMais, { type ItemDoMenu } from "@/components/sistema/MenuMais";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, etiqueta, foco, juntar, lista, texto } from "@/components/sistema/estilos";
import { hojeEmSaoPaulo, ROTULO_DO_STATUS, textoDoTotal } from "../../../supabase/functions/_shared/proposta-modelo";
import { followupDaProposta } from "../../../supabase/functions/_shared/proposta-comercial";
import { aplicarNaLista, chamarProposta, usePropostas, type Proposta } from "./propostaApi";
import SeloDaProposta from "./SeloDaProposta";
import DuplicarProposta from "./DuplicarProposta";
import SalvarComoModelo from "./SalvarComoModelo";
import BibliotecaDaAgencia, { type AbaDaBiblioteca } from "./BibliotecaDaAgencia";

/**
 * As ações da proposta aberta num lugar só (frente PRS, 30/09). Antes elas
 * se espalhavam: a lista de propostas e a Biblioteca no topo do Contexto, e
 * Duplicar, Salvar como modelo, Arquivar, Voltar para rascunho e Marcar
 * recusada num "..." dentro do Envio. Agora ficam no "..." ao lado do seletor
 * da proposta, na casca, em todas as etapas:
 * - Todas as propostas: a lista do cliente numa janela central, com as
 *   arquivadas e o lembrete de follow-up;
 * - Biblioteca comercial (serviços com preço, provas e hora técnica);
 * - Duplicar, Salvar como modelo, Voltar para rascunho, Arquivar e Marcar
 *   recusada (a última em vermelho, com Confirmar).
 * O menu só pede (MenuDaProposta, na casca); quem faz é JanelasDaProposta,
 * dentro da mesa (precisa do cliente e da proposta aberta).
 */

export type PedidoDaProposta = "todas" | "biblioteca" | "duplicar" | "modelo" | "rascunho" | "arquivar" | "recusada";

/** Os itens do "..." (os mesmos no computador e no celular). */
function itensDoMenu(p: Proposta | null, onPedir: (p: PedidoDaProposta) => void): Array<ItemDoMenu | null> {
  return [
    { rotulo: "Todas as propostas", icone: <List className="h-4 w-4" />, aoEscolher: () => onPedir("todas") },
    { rotulo: "Biblioteca comercial", icone: <BookOpen className="h-4 w-4" />, aoEscolher: () => onPedir("biblioteca") },
    p ? { rotulo: "Duplicar", icone: <CopyPlus className="h-4 w-4" />, aoEscolher: () => onPedir("duplicar"), separadorAntes: true } : null,
    p ? { rotulo: "Salvar como modelo", icone: <LayoutTemplate className="h-4 w-4" />, aoEscolher: () => onPedir("modelo") } : null,
    p && p.status !== "rascunho" && p.status !== "aceita" ? { rotulo: "Voltar para rascunho", icone: <Undo2 className="h-4 w-4" />, aoEscolher: () => onPedir("rascunho") } : null,
    p ? { rotulo: p.arquivada_em ? "Desarquivar" : "Arquivar", icone: <Archive className="h-4 w-4" />, aoEscolher: () => onPedir("arquivar") } : null,
    p && p.status !== "aceita" && p.status !== "recusada" ? { rotulo: "Marcar recusada", icone: <XCircle className="h-4 w-4" />, perigo: true, aoEscolher: () => onPedir("recusada") } : null,
  ];
}

export function MenuDaProposta({ clientId, propostaId, onPedir, className = "" }: { clientId: string; propostaId: string | null; onPedir: (p: PedidoDaProposta) => void; className?: string }) {
  const propostas = usePropostas(clientId);
  const p = propostaId && propostas.data ? propostas.data.lista.find((x) => x.id === propostaId) || null : null;
  return <MenuMais rotulo="Ações da proposta" className={className} itens={itensDoMenu(p, onPedir)} />;
}

/**
 * No celular, a linha das ações não tem lugar para o seletor e o "..." lado a
 * lado (o número sumia). Um controle só: "Nº 014 ▾" abre a lista das
 * propostas vivas, "Nova proposta" e, depois de um traço, as mesmas ações do
 * "...".
 */
export function MenuDaPropostaNoCelular({
  clientId,
  propostaId,
  onAbrir,
  onNova,
  onPedir,
  className = "",
}: {
  clientId: string;
  propostaId: string | null;
  onAbrir: (id: string) => void;
  onNova: () => void;
  onPedir: (p: PedidoDaProposta) => void;
  className?: string;
}) {
  const propostas = usePropostas(clientId);
  const lista = propostas.data ? propostas.data.lista : [];
  const p = propostaId ? lista.find((x) => x.id === propostaId) || null : null;
  const vivas = lista.filter((x) => !x.arquivada_em).slice(0, 8);
  const acoes = itensDoMenu(p, onPedir).filter(Boolean) as ItemDoMenu[];
  const comuns = acoes.filter((i) => !i.perigo);
  const perigosos = acoes.filter((i) => i.perigo);
  const item = "min-h-8 cursor-pointer rounded px-2 py-1.5 text-[13px]";
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={p ? `Proposta Nº ${p.numero}: trocar e ações` : "Propostas: trocar e ações"}
          className={juntar("toque-compacto inline-flex h-9 shrink-0 items-center rounded-md border border-border px-2 text-[13px] font-medium hover:bg-muted", foco, className)}
          data-menu-da-proposta-celular=""
        >
          <FileText className="mr-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="tabular-nums">{p ? `Nº ${p.numero.split("-").pop()}` : "Proposta"}</span>
          <ChevronDown className="ml-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-[220px] max-w-[calc(100vw-24px)] p-1">
        {vivas.map((x) => (
          <DropdownMenuItem key={x.id} onSelect={() => onAbrir(x.id)} className={item}>
            <span className="mr-2 inline-flex w-4 shrink-0 text-primary" aria-hidden="true">
              {x.id === propostaId ? <Check className="h-4 w-4" /> : null}
            </span>
            <span className="min-w-0 truncate">
              Nº {x.numero} · {ROTULO_DO_STATUS[x.status_efetivo] || x.status_efetivo}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={onNova} className={item}>
          <Plus className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          Nova proposta
        </DropdownMenuItem>
        {comuns.concat(perigosos).map((a, i) => (
          <Fragment key={a.rotulo}>
            {(i === 0 || a.separadorAntes || (a.perigo && i === comuns.length)) && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => a.aoEscolher()} className={juntar(item, a.perigo && "text-destructive focus:text-destructive")}>
              <span className={juntar("mr-2 inline-flex shrink-0", a.perigo ? "text-destructive" : "text-muted-foreground")} aria-hidden="true">
                {a.icone}
              </span>
              <span className="min-w-0 truncate">{a.rotulo}</span>
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A lista das propostas do cliente (vivas; as arquivadas num clique), com o total e o lembrete de follow-up. */
export function ListaDePropostas({ propostas, abertaId, onAbrir }: { propostas: Proposta[]; abertaId: string | null; onAbrir: (id: string) => void }) {
  const [verArquivadas, setVerArquivadas] = useState(false);
  const vivas = propostas.filter((p) => verArquivadas || !p.arquivada_em);
  const hoje = hojeEmSaoPaulo();
  if (!propostas.length) return <EstadoVazio compacto titulo="Nenhuma proposta ainda." />;
  return (
    <>
      <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Propostas do cliente">
        {vivas.map((p) => {
          // Lembrete de follow-up: vista sem resposta, não aberta ou vencendo (a mensagem pronta fica no Acompanhar).
          const f = p.arquivada_em ? null : followupDaProposta(p, hoje);
          return (
            <li key={p.id}>
              <button type="button" onClick={() => onAbrir(p.id)} className={juntar(lista.linha, "w-full text-left", p.id === abertaId && lista.destaque)} aria-current={p.id === abertaId ? "true" : undefined}>
                <span className={juntar(texto.auxiliar, "mr-3 shrink-0 tabular-nums")}>{p.numero}</span>
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{p.titulo}</span>
                <span className={juntar(texto.auxiliar, "ml-3 hidden shrink-0 tabular-nums sm:inline")}>{textoDoTotal(p.totais)}</span>
                {f && (
                  <>
                    <span className={juntar(etiqueta, "ml-3 hidden shrink-0 bg-warning/15 text-warning md:inline")} title="Follow-up pronto no Acompanhar" data-followup={f.situacao}>
                      {f.texto}
                    </span>
                    {/* No celular, só o ponto (a etiqueta com texto não cabe). */}
                    <span className="ml-3 inline-block h-2 w-2 shrink-0 rounded-full bg-warning md:hidden" title="Follow-up pronto no Acompanhar" data-ponto-do-followup="">
                      <span className="sr-only">Follow-up pronto no Acompanhar</span>
                    </span>
                  </>
                )}
                <span className="ml-3 shrink-0">
                  <SeloDaProposta status={p.status_efetivo} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {propostas.some((p) => p.arquivada_em) && (
        <button type="button" className={juntar(botao.discreto, "mt-1 h-8 px-2 text-[12px]")} onClick={() => setVerArquivadas((v) => !v)}>
          {verArquivadas ? "Esconder arquivadas" : "Ver arquivadas"}
        </button>
      )}
    </>
  );
}

/**
 * Faz o que o menu pediu. `pedido.em` muda a cada escolha (o mesmo pedido
 * duas vezes abre de novo). Janelas centrais; mudar status pede Confirmar.
 *
 * Cada pedido vale uma vez só: o que já existia quando a mesa montou (troca
 * de cliente, Voltar do navegador) é ignorado, e o tratado é devolvido por
 * `onFeito` para a casca esquecer. Sem isso, arquivar no cliente B e voltar
 * para o A arquivava a proposta do A sem ninguém pedir.
 */
export function JanelasDaProposta({
  pedido,
  proposta,
  propostas,
  onAbrir,
  onNova,
  onFeito,
}: {
  pedido: { tipo: PedidoDaProposta; em: number } | null;
  proposta: Proposta | null;
  propostas: Proposta[];
  onAbrir: (id: string) => void;
  onNova: () => void;
  /** O pedido foi tratado (a casca zera o pedido). */
  onFeito?: () => void;
}) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const confirmar = useConfirm();
  const [aberta, setAberta] = useState<null | "todas" | "biblioteca" | "duplicar" | "modelo">(null);
  const [aba, setAba] = useState<AbaDaBiblioteca>("servicos");

  const arquivar = async (p: Proposta) => {
    try {
      const d = await chamarProposta<any>("arquivar", { proposta_id: p.id, arquivar: !p.arquivada_em });
      aplicarNaLista(qc, mesa.clientId, d && d.proposta);
    } catch (e) {
      avisarErro(e, "Não foi possível arquivar");
    }
  };
  const mudarStatus = async (p: Proposta, status: "recusada" | "rascunho") => {
    const ok = await confirmar(
      status === "recusada"
        ? { title: "Marcar como recusada?", description: "O link deixa de aceitar. Fica registrado no lead.", confirmLabel: "Marcar recusada", destructive: true }
        : { title: "Voltar para rascunho?", description: "O link atual deixa de valer. Para o cliente ver de novo, confirme um novo envio.", confirmLabel: "Voltar para rascunho" },
    );
    if (!ok) return;
    try {
      const d = await chamarProposta<any>("status_mudar", { proposta_id: p.id, status });
      aplicarNaLista(qc, mesa.clientId, d && d.proposta);
    } catch (e) {
      avisarErro(e, "O status não mudou");
    }
  };

  // O pedido que já estava lá na montagem não é desta mesa: não repete.
  const tratado = useRef(pedido ? pedido.em : 0);
  useEffect(() => {
    if (!pedido || pedido.em === tratado.current) return;
    tratado.current = pedido.em;
    if (onFeito) onFeito();
    const t = pedido.tipo;
    if (t === "todas") setAberta("todas");
    else if (t === "biblioteca") {
      setAba("servicos");
      setAberta("biblioteca");
    } else if (!proposta) return;
    else if (t === "duplicar" || t === "modelo") setAberta(t);
    else if (t === "arquivar") void arquivar(proposta);
    else if (t === "rascunho" || t === "recusada") void mudarStatus(proposta, t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido ? pedido.em : 0]);

  const fechar = (v: boolean) => {
    if (!v) setAberta(null);
  };
  return (
    <>
      {aberta === "todas" && (
        <JanelaCentral
          aberta
          onMudar={fechar}
          titulo="Propostas do cliente"
          icone={<List className="h-4 w-4" />}
          descricao={`${propostas.filter((p) => !p.arquivada_em).length} ativas`}
          largura="md"
          rodape={
            <button
              type="button"
              className={botao.primario}
              onClick={() => {
                setAberta(null);
                onNova();
              }}
            >
              Nova proposta
            </button>
          }
        >
          <ListaDePropostas
            propostas={propostas}
            abertaId={proposta ? proposta.id : null}
            onAbrir={(id) => {
              setAberta(null);
              onAbrir(id);
            }}
          />
        </JanelaCentral>
      )}
      {aberta === "biblioteca" && <BibliotecaDaAgencia aberta onAberta={fechar} aba={aba} onAba={setAba} />}
      {aberta === "duplicar" && proposta && <DuplicarProposta proposta={proposta} aberta onAberta={fechar} onAbrir={onAbrir} />}
      {aberta === "modelo" && proposta && <SalvarComoModelo proposta={proposta} aberta onAberta={fechar} />}
    </>
  );
}
