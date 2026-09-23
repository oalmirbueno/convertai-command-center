import { useEffect, useRef } from "react";
import { ImageOff, Loader2, PanelTopClose, PanelTopOpen, Star } from "lucide-react";
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
export const LARGURA_DO_CARTAO = 212;
const LARGURA_DA_CAPA = 44;

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

function CartaoDoItem({ item, ativo, fontes, onEscolher }: { item: ItemDoMes; ativo: boolean; fontes: FontesDaLista; onEscolher: (id: string) => void }) {
  const t = fontes.trabalhoDe(item);
  const arte = fontes.arteDe(item);
  const roteiro = fontes.temRoteiro(item);
  const situacao = situacaoDoItem(t, arte, roteiro);
  const capaDoEstudio = t ? ultimasVersoes(t.cards).get(1) || null : null;
  const capaDaAgenda = !capaDoEstudio && arte ? fonteDoArquivo(arte.capa) : null;
  const capa = { width: LARGURA_DA_CAPA, height: Math.round(LARGURA_DA_CAPA * 1.25) };
  return (
    <button
      type="button"
      onClick={() => onEscolher(item.id)}
      aria-current={ativo ? "true" : undefined}
      title={item.title}
      data-item-id={item.id}
      style={{ width: LARGURA_DO_CARTAO }}
      className={`flex min-w-0 items-center rounded-lg border px-2 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        ativo ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-background hover:border-primary/50"
      }`}
    >
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
        <span className="flex min-w-0 items-center text-[10.5px] leading-4 text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{dataCurta(item.due_date)} · {formatoDoItem(item)}</span>
          {roteiro && (
            <span title={DICA_DO_ROTEIRO} className="ml-1 shrink-0">
              <Star className="h-3 w-3 fill-warning text-warning" aria-label={DICA_DO_ROTEIRO} />
            </span>
          )}
        </span>
        <span className="mt-0.5 line-clamp-2 text-[12px] font-medium leading-[1.3] text-foreground [overflow-wrap:anywhere]">{item.title}</span>
        <span className="mt-1 flex min-w-0">
          <SeloDoItem tom={situacao.tom}>{situacao.rotulo}</SeloDoItem>
        </span>
      </span>
    </button>
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
}) {
  const proximos = janela === PROXIMOS_DIAS;
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
    <div className="flex min-w-0 flex-wrap items-center px-3 py-2">
      <div className="mb-1 mr-2 mt-1 w-[168px] shrink-0">
        <Select value={janela} onValueChange={onJanela}>
          <SelectTrigger className="h-8 min-w-0 text-[12.5px] font-medium capitalize" aria-label="Período da lista">
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
      <div className="mb-1 mr-2 mt-1 grid shrink-0 grid-cols-3 gap-0.5 rounded-lg border border-border bg-background p-0.5" role="tablist" aria-label="Filtro das pautas">
        {FILTROS_DO_ESTUDIO.map((f) => (
          <button
            key={f.valor}
            type="button"
            role="tab"
            onClick={() => onFiltro(f.valor)}
            aria-selected={filtro === f.valor}
            title={f.dica}
            className={`flex h-7 min-w-0 items-center justify-center whitespace-nowrap rounded-md px-2.5 text-[11.5px] transition-colors ${
              filtro === f.valor ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            <span>{f.rotulo}</span>
            <span className={`ml-1 tabular-nums ${filtro === f.valor ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{contagem[f.valor]}</span>
          </button>
        ))}
      </div>
      {atualizando && <Loader2 className="mb-1 mt-1 h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Atualizando" />}
      {proximos && !recolhida && (
        <span className="mb-1 ml-1 mt-1 hidden min-w-0 truncate text-[11px] text-muted-foreground lg:inline" title="Com a arte que já está na Agenda das últimas semanas">
          com as artes já na Agenda
        </span>
      )}
      {onRecolher && (
        <button
          type="button"
          onClick={() => onRecolher(!recolhida)}
          className="mb-1 ml-auto mt-1 flex h-8 shrink-0 items-center rounded-md px-2 text-[11.5px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-expanded={!recolhida}
          title={recolhida ? "Mostrar as pautas" : "Recolher as pautas e dar mais altura ao estúdio"}
        >
          {recolhida ? <PanelTopOpen className="mr-1 h-4 w-4" /> : <PanelTopClose className="mr-1 h-4 w-4" />}
          {recolhida ? "Mostrar pautas" : "Recolher"}
        </button>
      )}
    </div>
  );

  const avisos = (
    <>
      {carregando && <p className="px-3 pb-3 text-[12.5px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Lendo a agenda…</p>}
      {!!erro && <p className="mx-3 mb-3 rounded-lg bg-destructive/10 p-3 text-[12.5px] [overflow-wrap:anywhere]">{textoDoErro(erro)}</p>}
      {!carregando && !erro && itens.length === 0 && !itemFora && (
        <p className="px-3 pb-3 text-[12.5px] leading-relaxed text-muted-foreground">
          {proximos ? "Nenhum carrossel ou post estático na agenda dos próximos 60 dias." : "Nenhum carrossel ou post estático na agenda deste mês."}{" "}
          Complete a agenda pela aba Mês.
        </p>
      )}
      {!carregando && itens.length > 0 && filtrados.length === 0 && !itemFora && (
        <p className="px-3 pb-3 text-[12.5px] leading-relaxed text-muted-foreground">Nada neste filtro.</p>
      )}
    </>
  );

  return (
    <section className="min-w-0 rounded-xl border border-border bg-card" aria-label="Pautas">
      {topo}
      {!recolhida && (
        <>
          {avisos}
          {(semanas.length > 0 || itemFora) && (
            <div ref={faixa} className="relative min-w-0 overflow-x-auto border-t border-border" aria-label="Pautas por semana">
              <div className="inline-flex items-start px-3 pb-3 pt-2">
                {itemFora && (
                  <div className="mr-4 flex shrink-0 flex-col">
                    <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Aberto, fora do período</p>
                    <CartaoDoItem item={itemFora} ativo={itemFora.id === tarefaId} fontes={fontes} onEscolher={onEscolher} />
                  </div>
                )}
                {semanas.map((s, i) => {
                  const atual = s.semana === semanaDeHoje;
                  const passada = !!s.semana && s.semana < semanaDeHoje;
                  return (
                    <div key={s.semana || "sem-data"} data-semana={s.semana} className={`flex shrink-0 flex-col ${i < semanas.length - 1 ? "mr-4 border-r border-border pr-4" : ""}`}>
                      <p className={`mb-1.5 whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-wider ${atual ? "text-primary" : "text-muted-foreground"}`}>
                        {s.semana ? `${atual ? "Esta semana · " : passada ? "Já passou · " : ""}${rotuloDaSemana(s.semana)}` : "Sem data"}
                      </p>
                      <ul className="flex">
                        {s.itens.map((item, j) => (
                          <li key={item.id} className={j < s.itens.length - 1 ? "mr-2" : ""}>
                            <CartaoDoItem item={item} ativo={item.id === tarefaId} fontes={fontes} onEscolher={onEscolher} />
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
