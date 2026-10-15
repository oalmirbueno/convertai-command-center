import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, PencilLine, X, Clock3 } from "lucide-react";
import { AjudaRecolhida, botao, campoTexto, foco, juntar, texto } from "@/components/sistema";

/*
 * Mesa de decisão (15/10/2026, pedido do dono: "um quadro central, eu aprovo,
 * sai e entra o outro; limpo, rápido, visual, sem textão").
 *
 * Um item por vez num cartão grande. Três botões: rejeitar, pedir ajuste,
 * aprovar. Ajuste e rejeição abrem um campo curto com sugestões de um toque.
 * Decidiu, o cartão sai e entra o próximo. Teclado: A aprova, E pede ajuste,
 * R rejeita, setas passam. Quem decide de verdade é a tela que usa a mesa
 * (o RPC de cada fila); aqui só a apresentação e o ritmo.
 */

export type DecisaoDaMesa = "aprovado" | "ajuste" | "rejeitado" | "adiado";

export interface SinalDaMesa { icone?: ReactNode; texto: string; tom?: "neutro" | "aviso" | "perigo" | "primario" }

export interface ItemDaMesa {
  id: string;
  /** Selo do tipo (ex.: "Post no ar", "Ritual · Meio da semana", "Publicar"). */
  tipo: string;
  tomDoTipo?: "primario" | "aviso" | "perigo";
  cliente: string;
  avatar?: ReactNode;
  titulo: string;
  /** Imagem ou mídia em destaque (post, arte). */
  midia?: ReactNode;
  /** O que vai ao cliente, ou o que vai acontecer. */
  mensagem?: string | null;
  /** Próximo passo combinado, numa linha. */
  passo?: string | null;
  sinais?: SinalDaMesa[];
  /** O resto (base, dados, risco, versão) fica recolhido. */
  detalhes?: ReactNode;
  /** Motivo que impede aprovar agora (o botão fica desligado com o motivo). */
  bloqueioDeAprovar?: string | null;
  podeAjuste?: boolean;
  podeRejeitar?: boolean;
  podeAdiar?: boolean;
  /** Rejeitar também exige escrever o motivo (ajuste sempre exige). */
  rejeitarPedeMotivo?: boolean;
  /** Ações pequenas extras no rodapé (ex.: "Responder no diário"). */
  extras?: ReactNode;
  /** Nome do pedido de ajuste ("Pedir esclarecimento"); o padrão é "Pedir ajuste". */
  rotuloAjuste?: string;
  /** Sugestões de um toque para o ajuste/esclarecimento deste tipo de item. */
  sugestoesAjuste?: string[];
  /**
   * Quando não há o que aprovar (agente esperando resposta, tarefa travada): o botão
   * principal faz esta ação (ex.: "Responder" abre o diário) e o item não sai da mesa
   * por isso; ele sai quando o estado muda.
   */
  acaoPrincipal?: { rotulo: string; icone?: ReactNode; aoClicar: () => void };
}

const SUGESTOES: Record<"ajuste" | "rejeitado", string[]> = {
  ajuste: ["Ajustar o tom", "Texto mais curto", "Faltou informação", "Corrigir link ou destino"],
  rejeitado: ["Não enviar agora", "Informação errada", "Fora do combinado"],
};

const TOM_DO_SELO: Record<string, string> = {
  primario: "bg-primary/15 text-primary",
  aviso: "bg-warning/15 text-warning",
  perigo: "bg-destructive/15 text-destructive",
  neutro: "bg-muted text-muted-foreground",
};

export default function MesaDeDecisao({ itens, onDecidir, rotulo, inicialId = null, vazio }: {
  itens: readonly ItemDaMesa[];
  onDecidir: (item: ItemDaMesa, decisao: DecisaoDaMesa, nota: string) => Promise<boolean>;
  rotulo: string;
  inicialId?: string | null;
  vazio?: ReactNode;
}) {
  // Decididos somem na hora (antes da nova leitura chegar) para o próximo entrar sem espera.
  const [decididos, setDecididos] = useState<Set<string>>(() => new Set());
  const fila = useMemo(() => itens.filter((i) => !decididos.has(i.id)), [itens, decididos]);
  const [atualId, setAtualId] = useState<string | null>(inicialId);
  const indice = Math.max(0, fila.findIndex((i) => i.id === atualId));
  const item = fila[indice] ?? null;
  const [modo, setModo] = useState<"ajuste" | "rejeitado" | null>(null);
  const [nota, setNota] = useState("");
  const [saindo, setSaindo] = useState<"aprovado" | "outro" | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [abertoDetalhe, setAbertoDetalhe] = useState(false);
  const campoRef = useRef<HTMLTextAreaElement>(null);

  // Item novo na frente: limpa o que era do anterior.
  useEffect(() => { setModo(null); setNota(""); setAbertoDetalhe(false); }, [item?.id]);
  useEffect(() => { if (inicialId) setAtualId(inicialId); }, [inicialId]);
  useEffect(() => { if (modo) campoRef.current?.focus(); }, [modo]);

  const ir = (passo: number) => {
    if (!fila.length) return;
    const proximo = fila[(indice + passo + fila.length) % fila.length];
    setAtualId(proximo.id);
  };

  const decidir = async (decisao: DecisaoDaMesa, texto = nota) => {
    if (!item || ocupado) return;
    setOcupado(true);
    const ok = await onDecidir(item, decisao, texto.trim()).catch(() => false);
    setOcupado(false);
    if (!ok) return;
    // Sai com um deslize curto e o próximo assume o mesmo lugar.
    setSaindo(decisao === "aprovado" ? "aprovado" : "outro");
    const proximo = fila[indice + 1] ?? fila[indice - 1] ?? null;
    window.setTimeout(() => {
      setDecididos((s) => new Set(s).add(item.id));
      setAtualId(proximo?.id ?? null);
      setSaindo(null);
    }, 180);
  };

  const notaObrigatoria = modo === "ajuste" || (modo === "rejeitado" && !!item?.rejeitarPedeMotivo);
  const podeAprovar = !!item && !item.bloqueioDeAprovar;

  // Teclado: só quando não se está escrevendo.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (!item || ocupado || e.ctrlKey || e.metaKey || e.altKey) return;
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.tagName === "SELECT" || alvo.isContentEditable)) {
        if (e.key === "Escape") setModo(null);
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "a" && !modo && item.acaoPrincipal) { e.preventDefault(); item.acaoPrincipal.aoClicar(); }
      else if (k === "a" && podeAprovar && !modo) { e.preventDefault(); void decidir("aprovado"); }
      else if (k === "e" && item.podeAjuste !== false && !item.acaoPrincipal) { e.preventDefault(); setModo("ajuste"); }
      else if (k === "r" && item.podeRejeitar !== false && !item.acaoPrincipal) { e.preventDefault(); setModo("rejeitado"); }
      else if (e.key === "ArrowRight") { e.preventDefault(); ir(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); ir(-1); }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  });

  if (!item) {
    return <div className="flex min-h-[220px] flex-col items-center justify-center py-10 text-center" aria-live="polite">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary"><Check className="h-7 w-7" aria-hidden="true" /></span>
      <p className="mt-3 text-[15px] font-semibold text-foreground">Tudo decidido</p>
      {vazio && <div className={juntar(texto.auxiliar, "mt-1")}>{vazio}</div>}
    </div>;
  }

  return <section aria-label={rotulo} className="mx-auto w-full max-w-3xl">
    {/* Onde estou na fila: pontos (até 12) e "3 de 8", setas para passar. */}
    <div className="mb-3 flex min-w-0 items-center">
      <div className="flex min-w-0 items-center" aria-hidden="true">
        {fila.slice(0, 12).map((i, n) => <span key={i.id} className={juntar("mr-1 h-1.5 rounded-full transition-all", n === indice ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30")} />)}
        {fila.length > 12 && <span className={juntar(texto.auxiliar, "ml-1")}>+{fila.length - 12}</span>}
      </div>
      <span className={juntar(texto.auxiliar, "ml-2 tabular-nums")} aria-live="polite">{indice + 1} de {fila.length}</span>
      <AjudaRecolhida className="ml-1.5" rotulo="Atalhos da mesa">Teclas: A aprova, E pede ajuste, R rejeita, setas passam para o próximo ou voltam. Decidiu, o próximo entra sozinho.</AjudaRecolhida>
      <div className="ml-auto flex items-center [&>*+*]:ml-1">
        <button type="button" onClick={() => ir(-1)} disabled={fila.length < 2} aria-label="Anterior" title="Anterior (←)" className={botao.icone}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" onClick={() => ir(1)} disabled={fila.length < 2} aria-label="Pular" title="Pular (→)" className={botao.icone}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
      </div>
    </div>

    <article
      key={item.id}
      aria-label={`${item.tipo}: ${item.titulo}`}
      className={juntar(
        "overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all duration-200",
        !saindo && "animate-in fade-in-0 slide-in-from-right-4",
        saindo === "aprovado" && "translate-x-8 opacity-0",
        saindo === "outro" && "-translate-x-8 opacity-0",
      )}
    >
      <div className={juntar("grid min-w-0", item.midia && "md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]")}>
        {item.midia && <div className="min-w-0 bg-muted/40 md:border-r md:border-border">{item.midia}</div>}
        <div className="min-w-0 p-4 sm:p-5">
          <header className="flex min-w-0 items-center">
            {item.avatar && <span className="mr-2.5 shrink-0">{item.avatar}</span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-foreground">{item.cliente}</span>
              <span className={juntar("mt-0.5 inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[11px] font-medium", TOM_DO_SELO[item.tomDoTipo ?? "primario"])}>{item.tipo}</span>
            </span>
          </header>
          <h3 className="mt-3 text-[17px] font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">{item.titulo}</h3>
          {item.mensagem && <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap text-[14px] leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">{item.mensagem}</p>}
          {item.passo && <p className="mt-2 flex items-start text-[13px] text-muted-foreground"><ChevronRight className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{item.passo}</span></p>}
          {!!item.sinais?.length && <ul className="-m-0.5 mt-3 flex flex-wrap" aria-label="Sinais">
            {item.sinais.map((s, n) => <li key={n} className={juntar("m-0.5 inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[11px]", TOM_DO_SELO[s.tom ?? "neutro"])}>{s.icone && <span className="mr-1 inline-flex shrink-0" aria-hidden="true">{s.icone}</span>}<span className="truncate">{s.texto}</span></li>)}
          </ul>}
          {item.detalhes && <div className="mt-3">
            <button type="button" aria-expanded={abertoDetalhe} onClick={() => setAbertoDetalhe(!abertoDetalhe)} className={juntar("inline-flex items-center rounded text-[12px] font-medium text-muted-foreground hover:text-foreground", foco)}>
              <ChevronDown className={juntar("mr-1 h-3.5 w-3.5 transition-transform", abertoDetalhe && "rotate-180")} aria-hidden="true" />Detalhes
            </button>
            {abertoDetalhe && <div className="mt-2 text-[12px] text-muted-foreground">{item.detalhes}</div>}
          </div>}
        </div>
      </div>

      {/* Rodapé: decidir. Ajuste e rejeição pedem uma frase curta antes de enviar. */}
      <footer className="border-t border-border bg-muted/20 p-3 sm:p-4">
        {modo ? <div className="space-y-2">
          <label className={juntar(texto.rotulo, "block")}>{modo === "ajuste" ? (item.rotuloAjuste ? "O que precisa ficar claro" : "O que ajustar") : "Por que rejeitar"}{!notaObrigatoria && " (opcional)"}
            <textarea ref={campoRef} value={nota} onChange={(e) => setNota(e.target.value)} rows={2} maxLength={2000} className={juntar(campoTexto, "mt-1.5 min-h-[56px]")} />
          </label>
          <div className="-m-0.5 flex flex-wrap">
            {((modo === "ajuste" && item.sugestoesAjuste) || SUGESTOES[modo]).map((s) => <button key={s} type="button" onClick={() => setNota((n) => n.trim() ? `${n.trim()}. ${s}` : s)} className={juntar("m-0.5 rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:border-primary/50 hover:text-foreground", foco)}>{s}</button>)}
          </div>
          <div className="flex items-center justify-end [&>*+*]:ml-2">
            <button type="button" onClick={() => setModo(null)} className={botao.discreto}>Voltar</button>
            <button type="button" disabled={ocupado || (notaObrigatoria && !nota.trim())} onClick={() => void decidir(modo)} className={modo === "rejeitado" ? botao.perigo : botao.primario}>
              {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}{modo === "ajuste" ? (item.rotuloAjuste || "Pedir ajuste") : "Rejeitar"}
            </button>
          </div>
        </div> : <div className="flex min-w-0 flex-wrap items-center">
          <div className="flex items-center [&>*+*]:ml-2">
            {item.podeRejeitar !== false && !item.acaoPrincipal && <button type="button" disabled={ocupado} onClick={() => setModo("rejeitado")} title="Rejeitar (R)" className={juntar(botao.secundario, "h-11 px-3 text-destructive")}><X className="h-4 w-4 sm:mr-1.5" aria-hidden="true" /><span className="hidden sm:inline">Rejeitar</span></button>}
            {item.podeAjuste !== false && !item.acaoPrincipal && <button type="button" disabled={ocupado} onClick={() => setModo("ajuste")} title={`${item.rotuloAjuste || "Pedir ajuste"} (E)`} className={juntar(botao.secundario, "h-11 px-3")}><PencilLine className="h-4 w-4 sm:mr-1.5" aria-hidden="true" /><span className="hidden sm:inline">{item.rotuloAjuste ? "Esclarecer" : "Ajuste"}</span></button>}
            {item.podeAdiar && <button type="button" disabled={ocupado} onClick={() => void decidir("adiado", "")} title="Adiar" className={juntar(botao.discreto, "h-11 px-3")}><Clock3 className="h-4 w-4 sm:mr-1.5" aria-hidden="true" /><span className="hidden sm:inline">Adiar</span></button>}
          </div>
          <div className="ml-auto flex min-w-0 items-center pl-2">
            {item.extras && <span className="flex items-center [&>*+*]:ml-1">{item.extras}</span>}
            {item.acaoPrincipal
              ? <button type="button" onClick={item.acaoPrincipal.aoClicar} title={`${item.acaoPrincipal.rotulo} (A)`} className={juntar(botao.primario, "ml-2 h-11 px-5 text-[15px]")}>{item.acaoPrincipal.icone && <span className="mr-1.5 inline-flex" aria-hidden="true">{item.acaoPrincipal.icone}</span>}{item.acaoPrincipal.rotulo}</button>
              : <button type="button" disabled={ocupado || !podeAprovar} onClick={() => void decidir("aprovado")} title={item.bloqueioDeAprovar || "Aprovar (A)"} className={juntar(botao.primario, "ml-2 h-11 px-5 text-[15px]")}>
              {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}Aprovar
            </button>}
          </div>
          {item.bloqueioDeAprovar && <p className="mt-2 w-full text-right text-[12px] text-warning">{item.bloqueioDeAprovar}</p>}
        </div>}
      </footer>
    </article>
  </section>;
}
