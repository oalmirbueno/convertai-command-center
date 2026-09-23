import { ImageOff, Loader2, Star } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TASK_DELIVERY_TYPE_LABELS, type TaskDeliveryType } from "@/lib/taskDeliveryTypes";
import { dataCurta, rotuloDoMes, textoDoErro } from "@/lib/mesa/api";
import { ImagemDaMesa } from "./MesaContexto";
import { FILTROS_DO_ESTUDIO, passaNoFiltro, situacaoDoItem, type FiltroDoEstudio, type TomDoSelo } from "./EstudioSituacao";
import { fonteDoArquivo, PROXIMOS_DIAS, ultimasVersoes, type ArteNaAgenda, type ItemDoMes, type Trabalho } from "./useItensDoMes";

/**
 * Coluna das pautas do Estúdio: período (próximos 60 dias ou um mês), três
 * filtros compactos e os itens em cartões enxutos (data e formato numa
 * linha, título em até duas, selo discreto e a capa quando houver). A estrela
 * marca o roteiro do estrategista; a explicação fica no título do ícone.
 *
 * Na coluna do computador, o topo fica parado e só os itens rolam; no
 * celular e na gaveta do tablet, a lista segue a página.
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

function CartaoDoItem({ item, ativo, fontes, onEscolher }: { item: ItemDoMes; ativo: boolean; fontes: FontesDaLista; onEscolher: (id: string) => void }) {
  const t = fontes.trabalhoDe(item);
  const arte = fontes.arteDe(item);
  const roteiro = fontes.temRoteiro(item);
  const situacao = situacaoDoItem(t, arte, roteiro);
  const capaDoEstudio = t ? ultimasVersoes(t.cards).get(1) || null : null;
  const capaDaAgenda = !capaDoEstudio && arte ? fonteDoArquivo(arte.capa) : null;
  return (
    <button
      type="button"
      onClick={() => onEscolher(item.id)}
      aria-current={ativo ? "true" : undefined}
      title={item.title}
      className={`flex min-h-[64px] w-full min-w-0 items-start rounded-lg border px-2.5 py-2 text-left transition-colors ${
        ativo ? "border-primary bg-primary/5" : "border-border bg-background hover:border-primary/50"
      }`}
    >
      {capaDoEstudio ? (
        <ImagemDaMesa caminho={capaDoEstudio.storage_path} alt="" className="h-[45px] w-9 shrink-0 rounded" />
      ) : capaDaAgenda && capaDaAgenda.caminho ? (
        <ImagemDaMesa caminho={capaDaAgenda.caminho} bucket={capaDaAgenda.bucket} alt="" className="h-[45px] w-9 shrink-0 rounded" />
      ) : (
        <span className="flex h-[45px] w-9 shrink-0 items-center justify-center rounded border border-dashed border-border bg-secondary text-muted-foreground">
          <ImageOff className="h-3 w-3" />
        </span>
      )}
      <span className="ml-2.5 min-w-0 flex-1">
        <span className="flex min-w-0 items-center text-[11px] leading-4 text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{dataCurta(item.due_date)} · {formatoDoItem(item)}</span>
          {roteiro && (
            <span title={DICA_DO_ROTEIRO} className="ml-1 shrink-0">
              <Star className="h-3.5 w-3.5 fill-warning text-warning" aria-label={DICA_DO_ROTEIRO} />
            </span>
          )}
        </span>
        <span className="mt-0.5 line-clamp-2 text-[12.5px] font-medium leading-snug text-foreground [overflow-wrap:anywhere]">{item.title}</span>
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
  emColuna,
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
  /** Coluna de altura fixa: o topo fica parado e só os itens rolam. */
  emColuna: boolean;
}) {
  const proximos = janela === PROXIMOS_DIAS;
  const contagem: Record<FiltroDoEstudio, number> = { a_fazer: 0, com_arte: 0, na_agenda: 0 };
  for (const i of itens) {
    const t = fontes.trabalhoDe(i);
    const a = fontes.arteDe(i);
    for (const f of FILTROS_DO_ESTUDIO) if (passaNoFiltro(f.valor, t, a)) contagem[f.valor]++;
  }
  // O item aberto continua visível mesmo fora do filtro.
  const filtrados = itens.filter((i) => passaNoFiltro(filtro, fontes.trabalhoDe(i), fontes.arteDe(i)) || i.id === tarefaId);

  // Nos próximos 60 dias a lista vem separada por mês.
  const grupos: { mes: string; itens: ItemDoMes[] }[] = [];
  for (const i of filtrados) {
    const m = i.due_date ? `${i.due_date.slice(0, 7)}-01` : "";
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.mes === m) ultimo.itens.push(i);
    else grupos.push({ mes: m, itens: [i] });
  }

  const topo = (
    <div className={`space-y-2.5 ${emColuna ? "shrink-0 border-b border-border p-3" : ""}`}>
      <div className="flex min-w-0 items-center">
        <Select value={janela} onValueChange={onJanela}>
          <SelectTrigger className="h-9 min-w-0 flex-1 text-[13px] font-medium capitalize" aria-label="Período da lista">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={PROXIMOS_DIAS}>Próximos 60 dias</SelectItem>
            {meses.map((m) => (
              <SelectItem key={m} value={m} className="capitalize">{rotuloDoMes(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {atualizando && <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Atualizando" />}
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-background p-1" role="tablist" aria-label="Filtro das pautas">
        {FILTROS_DO_ESTUDIO.map((f) => (
          <button
            key={f.valor}
            type="button"
            role="tab"
            onClick={() => onFiltro(f.valor)}
            aria-selected={filtro === f.valor}
            title={f.dica}
            className={`flex h-8 min-w-0 items-center justify-center rounded-md px-1 text-[11.5px] transition-colors ${
              filtro === f.valor ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            <span className="truncate">{f.rotulo}</span>
            <span className={`ml-1 shrink-0 tabular-nums ${filtro === f.valor ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{contagem[f.valor]}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const corpo = (
    <div className={emColuna ? "min-h-0 flex-1 overflow-y-auto px-3 pb-16 pt-3" : "mt-3 space-y-3"}>
      {itemFora && (
        <div className="mb-3">
          <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Aberto, fora do período</p>
          <CartaoDoItem item={itemFora} ativo={itemFora.id === tarefaId} fontes={fontes} onEscolher={onEscolher} />
        </div>
      )}
      {carregando && <p className="text-[12.5px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Lendo a agenda…</p>}
      {!!erro && <p className="rounded-lg bg-destructive/10 p-3 text-[12.5px] [overflow-wrap:anywhere]">{textoDoErro(erro)}</p>}
      {!carregando && !erro && itens.length === 0 && (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {proximos ? "Nenhum carrossel ou post estático na agenda dos próximos 60 dias." : "Nenhum carrossel ou post estático na agenda deste mês."}{" "}
          Complete a agenda pela aba Mês.
        </p>
      )}
      {!carregando && itens.length > 0 && filtrados.length === 0 && (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">Nada neste filtro.</p>
      )}
      {grupos.map((g) => (
        <section key={g.mes || "sem-data"} className="mb-3">
          {proximos && (
            <p className={`mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground ${emColuna ? "sticky top-0 z-10 -mx-3 bg-card px-3 py-1" : ""}`}>
              {g.mes ? rotuloDoMes(g.mes) : "Sem data"}
            </p>
          )}
          <ul className="space-y-2">
            {g.itens.map((i) => (
              <li key={i.id}>
                <CartaoDoItem item={i} ativo={i.id === tarefaId} fontes={fontes} onEscolher={onEscolher} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );

  if (emColuna) {
    return (
      <>
        {topo}
        {corpo}
      </>
    );
  }
  return (
    <div className="min-w-0">
      {topo}
      {corpo}
    </div>
  );
}
