import { useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, Check, Copy, ImageOff, ListChecks, Loader2, PanelTopClose, PanelTopOpen, Star } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TASK_DELIVERY_TYPE_LABELS, type TaskDeliveryType } from "@/lib/taskDeliveryTypes";
import { dataCurta, rotuloDoMes, textoDoErro } from "@/lib/mesa/api";
import { ImagemDaMesa } from "./MesaContexto";
import { FILTROS_DO_ESTUDIO, passaNoFiltro, situacaoDoItem, type FiltroDoEstudio, type TomDoSelo } from "./EstudioSituacao";
import { dataLocal, fonteDoArquivo, PROXIMOS_DIAS, ultimasVersoes, type ArteNaAgenda, type ItemDoMes, type Trabalho } from "./useItensDoMes";

/**
 * Faixa das pautas do Estúdio, EM CIMA da aba (pedido do dono em 23/09: "os
 * posts um ao lado do outro por semana, bem limpa"). Uma linha com o
 * período (próximos 60 dias ou um mês), os três filtros e o botão de
 * recolher; embaixo, a tira horizontal com rolagem própria, uma coluna por
 * semana, com cartões compactos: capa, data, formato, título e estado. A
 * estrela marca o roteiro do estrategista (a explicação fica no título).
 *
 * A tira leva o item aberto para a vista sozinha. A página nunca rola para o
 * lado: só a tira rola.
 */

const COR_DO_SELO: Record<TomDoSelo, string> = {
  neutro: "bg-secondary text-muted-foreground",
  primario: "bg-primary/10 text-primary",
  ok: "bg-success/10 text-success",
  alerta: "bg-warning/15 text-warning",
  erro: "bg-destructive/10 text-destructive",
};

export function SeloDoItem({ tom, children, className = "" }: { tom: TomDoSelo; children: string; className?: string }) {
  return (
    <span className={`inline-flex h-5 max-w-full items-center truncate whitespace-nowrap rounded-full px-2 text-[10.5px] font-medium ${COR_DO_SELO[tom]} ${className}`}>
      {children}
    </span>
  );
}

export const formatoDoItem = (i: ItemDoMes) => TASK_DELIVERY_TYPE_LABELS[i.delivery_type as TaskDeliveryType] || i.delivery_type;

export const DICA_DO_ROTEIRO = "Roteiro do estrategista: a direção sai dele, sem custo de IA";

export interface FontesDaLista {
  trabalhoDe: (i: ItemDoMes) => Trabalho | null;
  arteDe: (i: ItemDoMes) => ArteNaAgenda | null;
  temRoteiro: (i: ItemDoMes) => boolean;
}

/** Largura do cartão na faixa (px). A capa é 4:5, com altura pela largura. */
// Frente AE-3 (dono, 28/09: "faixa de pautas mais baixa, sem cartão alto"): cartão de uma linha de título e capa pequena.
export const LARGURA_DO_CARTAO = 200;
const LARGURA_DA_CAPA = 28;

const dois = (n: number) => (n < 10 ? `0${n}` : String(n));

/** Segunda-feira da semana da data (AAAA-MM-DD), sem passar por UTC. */
export function inicioDaSemana(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  const data = new Date(a, (m || 1) - 1, d || 1);
  const dia = data.getDay();
  const volta = dia === 0 ? 6 : dia - 1;
  return dataLocal(new Date(data.getFullYear(), data.getMonth(), data.getDate() - volta));
}

/** "22 a 28/09" (ou "29/09 a 05/10" quando vira o mês). */
export function rotuloDaSemana(segunda: string): string {
  const [a, m, d] = segunda.split("-").map(Number);
  const ini = new Date(a, m - 1, d);
  const fim = new Date(a, m - 1, d + 6);
  const mesmoMes = ini.getMonth() === fim.getMonth();
  const inicio = mesmoMes ? dois(ini.getDate()) : `${dois(ini.getDate())}/${dois(ini.getMonth() + 1)}`;
  return `${inicio} a ${dois(fim.getDate())}/${dois(fim.getMonth() + 1)}`;
}

/** Itens em semanas (segunda a domingo), na ordem das datas; sem data fica no fim. */
export function emSemanas(itens: ItemDoMes[]): { semana: string; itens: ItemDoMes[] }[] {
  const grupos: { semana: string; itens: ItemDoMes[] }[] = [];
  const semData: ItemDoMes[] = [];
  for (const i of itens) {
    if (!i.due_date) {
      semData.push(i);
      continue;
    }
    const s = inicioDaSemana(i.due_date);
    const g = grupos.find((x) => x.semana === s);
    if (g) g.itens.push(i);
    else grupos.push({ semana: s, itens: [i] });
  }
  grupos.sort((x, y) => (x.semana < y.semana ? -1 : x.semana > y.semana ? 1 : 0));
  for (const g of grupos) g.itens.sort((x, y) => String(x.due_date).localeCompare(String(y.due_date)));
  if (semData.length) grupos.push({ semana: "", itens: semData });
  return grupos;
}

/** Frente AE (28/09): arquivar pela faixa (um ou vários) e o aviso de pauta parecida no mesmo dia. */
export interface ArquivarNaFaixa {
  onArquivar: (ids: string[]) => void;
  /** id -> ids das pautas parecidas no mesmo dia (pautasParecidas em arquivarDaFaixa.ts). */
  parecidas?: Record<string, string[]>;
}

function CartaoDoItem({
  item,
  ativo,
  fontes,
  onEscolher,
  selecionando = false,
  marcado = false,
  onMarcar,
  onArquivar,
  parecidaCom = [],
}: {
  item: ItemDoMes;
  ativo: boolean;
  fontes: FontesDaLista;
  onEscolher: (id: string) => void;
  selecionando?: boolean;
  marcado?: boolean;
  onMarcar?: (id: string) => void;
  onArquivar?: (id: string) => void;
  parecidaCom?: string[];
}) {
  const t = fontes.trabalhoDe(item);
  const arte = fontes.arteDe(item);
  const roteiro = fontes.temRoteiro(item);
  const situacao = situacaoDoItem(t, arte, roteiro);
  const capaDoEstudio = t ? ultimasVersoes(t.cards).get(1) || null : null;
  const capaDaAgenda = !capaDoEstudio && arte ? fonteDoArquivo(arte.capa) : null;
  const capa = { width: LARGURA_DA_CAPA, height: Math.round(LARGURA_DA_CAPA * 1.25) };
  return (
    <div className="group relative" style={{ width: LARGURA_DO_CARTAO }}>
    <button
      type="button"
      onClick={() => (selecionando && onMarcar ? onMarcar(item.id) : onEscolher(item.id))}
      aria-current={ativo ? "true" : undefined}
      aria-pressed={selecionando ? marcado : undefined}
      title={item.title}
      data-item-id={item.id}
      style={{ width: LARGURA_DO_CARTAO }}
      className={`flex min-w-0 items-center rounded-lg border px-1.5 py-1 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        selecionando && marcado
          ? "border-destructive bg-destructive/5 ring-1 ring-destructive"
          : ativo
            ? "border-primary bg-primary/5 ring-1 ring-primary"
            : "border-border bg-background hover:border-primary/50"
      }`}
    >
      {selecionando && (
        <span className={`mr-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${marcado ? "border-destructive bg-destructive text-destructive-foreground" : "border-border bg-background"}`} aria-hidden="true">
          {marcado && <Check className="h-3 w-3" />}
        </span>
      )}
      {capaDoEstudio ? (
        <span className="block shrink-0 overflow-hidden rounded" style={capa}>
          <ImagemDaMesa caminho={capaDoEstudio.storage_path} alt="" className="h-full w-full" />
        </span>
      ) : capaDaAgenda && capaDaAgenda.caminho ? (
        <span className="block shrink-0 overflow-hidden rounded" style={capa}>
          <ImagemDaMesa caminho={capaDaAgenda.caminho} bucket={capaDaAgenda.bucket} alt="" className="h-full w-full" />
        </span>
      ) : (
        <span className="flex shrink-0 items-center justify-center rounded border border-dashed border-border bg-secondary text-muted-foreground" style={capa}>
          <ImageOff className="h-3 w-3" />
        </span>
      )}
      <span className="ml-2 min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium leading-4 text-foreground">{item.title}</span>
        <span className="mt-0.5 flex min-w-0 items-center text-[10.5px] leading-4 text-muted-foreground">
          <span className="min-w-0 truncate">{dataCurta(item.due_date)} · {formatoDoItem(item)}</span>
          {roteiro && (
            <span title={DICA_DO_ROTEIRO} className="ml-1 shrink-0">
              <Star className="h-3 w-3 fill-warning text-warning" aria-label={DICA_DO_ROTEIRO} />
            </span>
          )}
          <SeloDoItem tom={situacao.tom} className="ml-1.5 shrink-0">{situacao.rotulo}</SeloDoItem>
          {/* Frente AE-2: a pauta parecida é um ícone (o texto fica no título), não mais um selo a mais. */}
          {parecidaCom.length > 0 && (
            <span
              title={`Parecida com outra no mesmo dia: ${parecidaCom.join("; ")}. Veja se é duplicada e arquive a que não quer.`}
              aria-label="Parecida com outra no mesmo dia"
              className="ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning"
              data-parecida=""
            >
              <Copy className="h-2.5 w-2.5" />
            </span>
          )}
        </span>
      </span>
    </button>
    {!selecionando && onArquivar && (
      <button
        type="button"
        onClick={() => onArquivar(item.id)}
        aria-label={`Arquivar ${item.title}`}
        title="Arquivar: sai da faixa, do mês e da fila (dá para desfazer)"
        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background/95 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-destructive focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        data-arquivar-pauta={item.id}
      >
        <Archive className="h-3.5 w-3.5" />
      </button>
    )}
    </div>
  );
}

export default function EstudioLista({
  janela,
  meses,
  onJanela,
  filtro,
  onFiltro,
  itens,
  itemFora,
  fontes,
  carregando,
  atualizando,
  erro,
  tarefaId,
  onEscolher,
  recolhida = false,
  onRecolher,
  arquivar,
  inicio,
  extra,
}: {
  janela: string;
  meses: string[];
  onJanela: (v: string) => void;
  filtro: FiltroDoEstudio;
  onFiltro: (f: FiltroDoEstudio) => void;
  itens: ItemDoMes[];
  /** Item aberto pela URL que está fora do período escolhido. */
  itemFora: ItemDoMes | null;
  fontes: FontesDaLista;
  carregando: boolean;
  /** Trocou o período: a lista anterior fica na tela até a nova chegar. */
  atualizando: boolean;
  erro: unknown;
  tarefaId: string | null;
  onEscolher: (id: string) => void;
  /** Só a linha de cima (período e filtros): mais altura para o estúdio. */
  recolhida?: boolean;
  onRecolher?: (recolher: boolean) => void;
  /** Frente AE: arquivar pela faixa (sem ele, a faixa fica como antes). */
  arquivar?: ArquivarNaFaixa;
  /** Frente AE-2: o que vem antes do período na barra (Pautas | Arte rápida), sem linha nova. */
  inicio?: ReactNode;
  /** Frente AE-2: ação compacta à direita da barra (Arquivados). */
  extra?: ReactNode;
}) {
  const proximos = janela === PROXIMOS_DIAS;
  const [selecionando, setSelecionando] = useState(false);
  const [marcados, setMarcados] = useState<string[]>([]);
  const marcar = (id: string) => setMarcados((l) => (l.indexOf(id) >= 0 ? l.filter((x) => x !== id) : l.concat([id])));
  const sairDaSelecao = () => {
    setSelecionando(false);
    setMarcados([]);
  };
  const tituloDe = (id: string) => {
    const i = itens.filter((x) => x.id === id)[0];
    return i ? `${i.title}${fontes.trabalhoDe(i) ? " (com trabalho no Estúdio)" : ""}` : id;
  };
  const propsDoCartao = (item: ItemDoMes) =>
    arquivar
      ? {
          selecionando,
          marcado: marcados.indexOf(item.id) >= 0,
          onMarcar: marcar,
          onArquivar: (id: string) => arquivar.onArquivar([id]),
          parecidaCom: ((arquivar.parecidas && arquivar.parecidas[item.id]) || []).map(tituloDe),
        }
      : {};
  const faixa = useRef<HTMLDivElement>(null);
  const contagem: Record<FiltroDoEstudio, number> = { a_fazer: 0, com_arte: 0, na_agenda: 0 };
  for (const i of itens) {
    const t = fontes.trabalhoDe(i);
    const a = fontes.arteDe(i);
    for (const f of FILTROS_DO_ESTUDIO) if (passaNoFiltro(f.valor, t, a)) contagem[f.valor]++;
  }
  // O item aberto continua visível mesmo fora do filtro.
  const filtrados = itens.filter((i) => passaNoFiltro(filtro, fontes.trabalhoDe(i), fontes.arteDe(i)) || i.id === tarefaId);
  const semanas = emSemanas(filtrados);
  const hoje = dataLocal(new Date());
  const semanaDeHoje = inicioDaSemana(hoje);

  // Leva o item aberto (ou a semana de hoje) para a vista, rolando só a tira.
  useEffect(() => {
    const el = faixa.current;
    if (!el || recolhida) return;
    let alvo: HTMLElement | null = null;
    try {
      alvo = tarefaId ? (el.querySelector(`[data-item-id="${tarefaId}"]`) as HTMLElement | null) : null;
      if (!alvo) alvo = el.querySelector(`[data-semana="${semanaDeHoje}"]`) as HTMLElement | null;
    } catch {
      alvo = null;
    }
    if (!alvo) return;
    const esquerda = alvo.offsetLeft - Math.max(0, (el.clientWidth - alvo.offsetWidth) / 2);
    el.scrollLeft = Math.max(0, esquerda);
  }, [tarefaId, filtrados.length, recolhida, filtro, janela, semanaDeHoje]);

  const topo = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-1">
      {inicio}
      <div className="w-[160px] shrink-0">
        <Select value={janela} onValueChange={onJanela}>
          <SelectTrigger className="h-8 min-w-0 text-[12.5px] font-medium first-letter:uppercase" aria-label="Período da lista">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={PROXIMOS_DIAS}>Próximos 60 dias</SelectItem>
            {meses.map((m) => (
              <SelectItem key={m} value={m} className="capitalize">{rotuloDoMes(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid h-8 shrink-0 grid-cols-3 gap-0.5 rounded-md bg-muted p-0.5" role="tablist" aria-label="Filtro das pautas">
        {FILTROS_DO_ESTUDIO.map((f) => (
          <button
            key={f.valor}
            type="button"
            role="tab"
            onClick={() => onFiltro(f.valor)}
            aria-selected={filtro === f.valor}
            title={f.dica}
            className={`flex h-7 min-w-0 items-center justify-center whitespace-nowrap rounded px-2.5 text-[11.5px] transition-colors ${
              filtro === f.valor ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>{f.rotulo}</span>
            <span className="ml-1 tabular-nums text-muted-foreground">{contagem[f.valor]}</span>
          </button>
        ))}
      </div>
      {/* Faixa recolhida: a pauta troca por um seletor na própria barra (o que não cabe vira seletor, pedido do dono). */}
      {recolhida && filtrados.length > 0 && (
        <div className="w-[300px] min-w-0 max-w-full shrink" data-pauta-no-seletor="">
          <Select value={tarefaId && filtrados.some((i) => i.id === tarefaId) ? tarefaId : ""} onValueChange={onEscolher}>
            <SelectTrigger className="h-8 min-w-0 text-[12.5px]" aria-label="Pauta aberta">
              <SelectValue placeholder="Escolha a pauta" />
            </SelectTrigger>
            <SelectContent>
              {filtrados.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {dataCurta(i.due_date)} · {i.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {atualizando && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Atualizando" />}
      {/* À direita, alinhadas: selecionar para arquivar, Arquivados e recolher (quebra para a 2ª linha só se não couber). */}
      <div className="ml-auto flex min-w-0 shrink-0 flex-wrap items-center justify-end">
      {arquivar && !recolhida && !selecionando && itens.length > 0 && (
        <button
          type="button"
          onClick={() => setSelecionando(true)}
          className="flex h-8 shrink-0 items-center rounded-md px-2 text-[11.5px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          title="Marcar várias pautas para arquivar de uma vez"
        >
          <ListChecks className="mr-1 h-4 w-4" /> Selecionar
        </button>
      )}
      {arquivar && selecionando && (
        <span className="flex shrink-0 items-center" role="group" aria-label="Arquivar as marcadas">
          <button
            type="button"
            onClick={() => {
              if (!marcados.length) return;
              arquivar.onArquivar(marcados.slice());
              sairDaSelecao();
            }}
            disabled={!marcados.length}
            className="flex h-8 items-center rounded-md bg-destructive px-2.5 text-[11.5px] font-medium text-destructive-foreground disabled:opacity-50"
          >
            <Archive className="mr-1 h-3.5 w-3.5" />
            Arquivar {marcados.length ? `(${marcados.length})` : ""}
          </button>
          <button type="button" onClick={sairDaSelecao} className="ml-1 h-8 rounded-md px-2 text-[11.5px] text-muted-foreground hover:bg-secondary hover:text-foreground">
            Cancelar
          </button>
        </span>
      )}
      {extra}
      {onRecolher && (
        <button
          type="button"
          onClick={() => onRecolher(!recolhida)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-expanded={!recolhida}
          aria-label={recolhida ? "Mostrar pautas" : "Recolher pautas"}
          title={recolhida ? "Mostrar as pautas" : "Recolher as pautas e dar mais altura ao estúdio"}
          data-recolher-pautas=""
        >
          {recolhida ? <PanelTopOpen className="h-4 w-4" /> : <PanelTopClose className="h-4 w-4" />}
        </button>
      )}
      </div>
    </div>
  );

  const avisos = (
    <>
      {carregando && <p className="pb-2 text-[12.5px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Lendo a agenda…</p>}
      {!!erro && <p className="mb-2 rounded-lg bg-destructive/10 p-3 text-[12.5px] [overflow-wrap:anywhere]">{textoDoErro(erro)}</p>}
      {!carregando && !erro && itens.length === 0 && !itemFora && (
        <p className="pb-2 text-[12.5px] leading-relaxed text-muted-foreground">
          {proximos ? "Nenhum carrossel ou post estático na agenda dos próximos 60 dias." : "Nenhum carrossel ou post estático na agenda deste mês."}{" "}
          Complete a agenda pela aba Mês.
        </p>
      )}
      {!carregando && itens.length > 0 && filtrados.length === 0 && !itemFora && (
        <p className="pb-2 text-[12.5px] leading-relaxed text-muted-foreground">Nada neste filtro.</p>
      )}
    </>
  );

  return (
    <section className="min-w-0" aria-label="Pautas" data-faixa-de-pautas={recolhida ? "recolhida" : "aberta"}>
      {topo}
      {!recolhida && (
        <>
          {avisos}
          {(semanas.length > 0 || itemFora) && (
            <div ref={faixa} className="relative min-w-0 overflow-x-auto" aria-label="Pautas por semana">
              <div className="inline-flex items-start pb-1 pt-0.5">
                {itemFora && (
                  <div className="mr-3 flex shrink-0 flex-col">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Aberto, fora do período</p>
                    <CartaoDoItem item={itemFora} ativo={itemFora.id === tarefaId} fontes={fontes} onEscolher={onEscolher} {...propsDoCartao(itemFora)} />
                  </div>
                )}
                {semanas.map((s, i) => {
                  const atual = s.semana === semanaDeHoje;
                  const passada = !!s.semana && s.semana < semanaDeHoje;
                  return (
                    <div key={s.semana || "sem-data"} data-semana={s.semana} className={`flex shrink-0 flex-col ${i < semanas.length - 1 ? "mr-3 border-r border-border pr-3" : ""}`}>
                      <p className={`mb-1 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider ${atual ? "text-primary" : "text-muted-foreground"}`}>
                        {s.semana ? `${atual ? "Esta semana · " : passada ? "Já passou · " : ""}${rotuloDaSemana(s.semana)}` : "Sem data"}
                      </p>
                      <ul className="flex">
                        {s.itens.map((item, j) => (
                          <li key={item.id} className={j < s.itens.length - 1 ? "mr-1.5" : ""}>
                            <CartaoDoItem item={item} ativo={item.id === tarefaId} fontes={fontes} onEscolher={onEscolher} {...propsDoCartao(item)} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
