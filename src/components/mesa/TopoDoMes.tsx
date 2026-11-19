import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CalendarPlus, FilePlus2, Flame, Layers, Lightbulb, Loader2, Megaphone, MessagesSquare, Newspaper, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { foco, juntar, superficie, texto } from "@/components/sistema/estilos";
import { IconButton, OverflowMenu, StatTrio } from "@/components/ds";
import { supabase } from "@/integrations/supabase/client";
import { useMesa } from "./MesaContexto";
import { useKitDaMesa } from "./kitDaMesa";
import { useAgendaDoMes } from "./useAgendaDoMes";
import { chaveDasNotasDaSemana, lerNotasGuardadas } from "./AreaDoHype";
import { datasDasProximasSemanas, separarPeloNicho } from "./datasDoHype";
import { juntadoDaData, sementeDaSelecao, separarNoticias, type RespostaDoTrending } from "./hypeETrending";
import { guardarSementeDaCampanha } from "./sementeDaCampanha";
import { chaves, hojeIso, lerHypes, segundaDaSemanaIso } from "./mesaV4Api";
import { dadosDoTrendy } from "./trendy";
import { nichoCurto, resumoDoMes, ROTULO_DA_FONTE, sugestoesDoMes, type SugestaoDoMes } from "./oQueFazerAgora";
import { nomeDoMes, sugerirMistura } from "./planoDoMes";
import { textoDoErro } from "@/lib/mesa/api";

/** O segmento do cadastro comercial (sem acesso ou sem cadastro: nulo, e o nicho vem do contexto da marca). */
function useSegmento(clientId: string) {
  return useQuery({
    queryKey: ["mesa", "segmento", clientId],
    enabled: !!clientId,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await (supabase as any).from("commercial_organizations").select("segment").eq("client_id", clientId).not("segment", "is", null).limit(1);
      if (error) return null;
      const linha = ((data || []) as Array<{ segment: string | null }>)[0];
      return linha && linha.segment ? linha.segment : null;
    },
  });
}

const ICONE_DA_FONTE = {
  datas: <CalendarDays className="h-4 w-4" />,
  "em-alta": <Newspaper className="h-4 w-4" />,
  semana: <Flame className="h-4 w-4" />,
  calendario: <CalendarDays className="h-4 w-4" />,
};
const ICONE_DA_ACAO = {
  campanha: <Megaphone className="h-4 w-4" aria-hidden="true" />,
  "abrir-em-alta": <Newspaper className="h-4 w-4" aria-hidden="true" />,
  "abrir-semana": <Flame className="h-4 w-4" aria-hidden="true" />,
  agente: <Sparkles className="h-4 w-4" aria-hidden="true" />,
  mistura: <Layers className="h-4 w-4" aria-hidden="true" />,
};

/**
 * Topo do Mês (21/10/2026): reconhecer na hora de quem e de quando é a tela (mês e ano grande, nicho e cliente,
 * resumo de uma linha) e o "O que fazer agora", com até 3 sugestões montadas do que já existe (sem chamada nova).
 */
export default function TopoDoMes({
  mes,
  onCriarCampanha,
  onAbrirRadar,
  onAgente,
  onConversar,
  onRapido,
  onPeriodo,
}: {
  mes: string;
  /** Abre a aba Campanhas na campanha nova (a semente já foi gravada aqui). */
  onCriarCampanha: () => void;
  onAbrirRadar: (visao: "semana" | "em-alta") => void;
  onAgente: () => void;
  /** As ações do mês (antes no plano): planejar ou criar com o agente, conteúdo rápido e novo calendário. */
  onConversar: (modo: "planejar" | "criar") => void;
  onRapido: () => void;
  onPeriodo: () => void;
}) {
  const { clientId, clientName } = useMesa();
  const queryClient = useQueryClient();
  const hoje = hojeIso();
  const kit = useKitDaMesa();
  const segmento = useSegmento(clientId);
  const agenda = useAgendaDoMes(clientId, mes);
  const hypes = useQuery({ queryKey: chaves.hypes(clientId), queryFn: () => lerHypes(clientId) });
  const notas = useMemo(() => lerNotasGuardadas(chaveDasNotasDaSemana(clientId, hoje)), [clientId, hoje]);
  const seg = segmento.data || (notas && notas.segmento) || null;
  const negocio = kit.data && kit.data.contexto ? kit.data.contexto.negocio : null;
  const nicho = nichoCurto(seg, negocio);

  const principais = useMemo(() => separarPeloNicho(datasDasProximasSemanas(hoje, 8), notas ? notas.notas : null, seg).principais, [hoje, notas, seg]);
  const leitura = dadosDoTrendy(hypes.data, clientId);
  const emAltaNoNicho = leitura ? leitura.itens.filter((h) => h.tipo === "nicho").length : 0;
  // Notícias já buscadas nesta visita (cache do Em alta): quantas servem ao cliente. Nada é buscado daqui.
  const noticiasQueServem = (() => {
    const guardadas = queryClient.getQueriesData<RespostaDoTrending>({ queryKey: ["mesa", "trending", clientId] });
    let n: number | null = null;
    guardadas.forEach(([, d]) => {
      if (d && Array.isArray(d.itens)) n = Math.max(n || 0, separarNoticias(d.itens).visiveis.filter((x) => x.julgamento && x.julgamento.cabe === "serve").length);
    });
    return n;
  })();
  const itens = agenda.data ? agenda.data.itens : null;
  const sugestoes = sugestoesDoMes({
    hoje,
    mes,
    principais,
    noticiasQueServem,
    emAltaNoNicho,
    leituraDaSemana: !!leitura && leitura.semana === segundaDaSemanaIso(hoje),
    datasComPost: itens ? itens.map((i) => i.due_date) : null,
    pecas: itens ? itens.map((i) => ({ title: i.title, delivery_type: i.delivery_type, due_date: i.due_date })) : null,
  });
  const resumo = resumoDoMes({ posts: itens ? itens.length : null, datas: principais.length, emAlta: emAltaNoNicho });
  const nome = nomeDoMes(mes);
  const carregando = agenda.isLoading || hypes.isLoading;

  const [misturando, setMisturando] = useState(false);
  // A sugestão proativa vira cartão com Confirmar e Desfazer na conversa do agente (nada muda antes).
  const misturar = async () => {
    setMisturando(true);
    try {
      const r = await sugerirMistura(clientId, mes);
      await queryClient.invalidateQueries({ queryKey: chaves.agente(clientId) });
      if (r.sugestao) onAgente();
      else toast.message(r.motivo || "O mês já está misturado.");
    } catch (e) {
      toast.error(textoDoErro(e) || "Não foi possível montar a sugestão agora.");
    } finally {
      setMisturando(false);
    }
  };

  const agir = (s: SugestaoDoMes) => {
    if (s.acao === "mistura") void misturar();
    else if (s.acao === "campanha" && s.data) {
      const nota = notas && notas.notas ? notas.notas[s.data.id] : null;
      guardarSementeDaCampanha(clientId, sementeDaSelecao([juntadoDaData(s.data, nota || null)], ""));
      onCriarCampanha();
    } else if (s.acao === "abrir-em-alta") onAbrirRadar("em-alta");
    else if (s.acao === "abrir-semana") onAbrirRadar("semana");
    else onAgente();
  };

  return (
    <div className="min-w-0 space-y-4" data-topo-do-mes="">
      {/* v4 (cabeçalho das referências): título, os números do mês sem cartão no meio e as ações em círculos à direita.
          Os números ocupam o lugar desde o primeiro quadro (traço enquanto a agenda carrega): nada empurra depois. */}
      <header className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-3">
        <div className="min-w-0 flex-1 basis-[220px]">
        <h2 className={juntar(texto.tituloPagina, "truncate")} data-mes-do-topo="">{nome.charAt(0).toUpperCase() + nome.slice(1)}</h2>
        {/* 14/11/2026 (dono: "uma linha de estado no máximo"): nicho e cliente numa linha só; o resumo virou os números ao lado. */}
        <p className={juntar(texto.auxiliar, "mt-1 flex min-w-0 items-baseline")} title={[nicho, clientName, resumo].filter(Boolean).join(" · ")}>
          <span className="min-w-0 truncate" data-nicho-do-topo="">{nicho ? <><span className="font-medium text-foreground">{nicho}</span> · </> : null}{clientName}</span>
          <span className="sr-only" data-resumo-do-mes="">{resumo ? ` · ${resumo}` : ""}</span>
        </p>
        </div>
        <StatTrio
          label="Números do mês"
          className="order-3 w-full sm:order-none sm:w-auto"
          items={[
            { label: "Posts planejados", value: itens ? itens.length : "–" },
            { label: "Datas no radar", value: principais.length },
            { label: "Em alta", value: hypes.isLoading ? "–" : emAltaNoNicho },
          ]}
        />
        {/* v4 E2 (dono, 15/11: "uma ação principal"): Criar conteúdos em pílula verde com nome; Novo calendário em
            círculo ao lado; Conteúdo rápido e Planejar com o agente no "…". */}
        <div className="flex shrink-0 items-center" aria-label="Ações do mês" role="group">
          <IconButton size="md" tone="soft" className="mr-1.5" onClick={onPeriodo} label="Novo calendário" icon={<CalendarPlus aria-hidden="true" />} />
          <OverflowMenu
            label="Mais ações do mês"
            className="mr-2"
            items={[
              { label: "Conteúdo rápido", icon: <Zap className="h-4 w-4" aria-hidden="true" />, onSelect: onRapido },
              { label: "Planejar com o agente", icon: <MessagesSquare className="h-4 w-4" aria-hidden="true" />, onSelect: () => onConversar("planejar") },
            ]}
          />
          <button
            type="button"
            onClick={() => onConversar("criar")}
            className={juntar("toque-compacto inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-accent-solid px-4 text-[13px] font-semibold text-on-accent transition-colors hover:bg-accent-solid/85", foco)}
          >
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
            Criar conteúdos
          </button>
        </div>
      </header>

      {/* v4: enquanto a agenda e a leitura carregam, três azulejos do tamanho final guardam o lugar (nada empurra o calendário depois). */}
      {carregando ? (
        <section className="min-w-0" aria-hidden="true" data-o-que-fazer-carregando="">
          <div className="flex h-6 items-center"><span className="h-4 w-40 rounded-full bg-muted" /></div>
          <ul className="gap-bento mt-3 grid min-w-0 grid-cols-1 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <li key={i} className={juntar(superficie.painel, "flex h-24 min-w-0 items-center p-4")}>
                <span className="mr-3 h-10 w-10 shrink-0 rounded-full bg-muted" />
                <div className="min-w-0 flex-1 space-y-2">
                  <span className="block h-3 w-4/5 rounded-full bg-muted" />
                  <span className="block h-2.5 w-24 rounded-full bg-muted/70" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : sugestoes.length > 0 && (
        <section className="min-w-0" aria-label="O que fazer agora" data-o-que-fazer="">
          <div className="flex h-6 min-w-0 items-center">
            <h3 className={juntar(texto.tituloSecao, "flex items-center")}>
              <Lightbulb className="mr-1.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              O que fazer agora
            </h3>
            <AjudaRecolhida rotulo="De onde vêm as sugestões?">
              Montadas com o que já está na Mesa: as datas do nicho (Datas), a leitura da semana (Da semana), as notícias já buscadas (Em alta) e a agenda deste mês (Calendário). Cada uma diz a fonte.
            </AjudaRecolhida>
          </div>
          {/* v4 (referências): cada sugestão é um azulejo com o ícone num círculo e a ação num círculo; a primeira é o cartão de tinta. */}
          <ul className="gap-bento mt-3 grid min-w-0 grid-cols-1 lg:grid-cols-3">
            {sugestoes.map((s, i) => (
              <li key={s.chave} className={juntar(superficie.painel, i === 0 && superficie.tinta, "flex h-24 min-w-0 items-center p-4")} data-sugestao={s.fonte} data-card={i === 0 ? "ink" : "default"}>
                <span className={juntar("mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full", i === 0 ? "bg-foreground/15 text-foreground" : "bg-accent-soft text-primary")} aria-hidden="true">{ICONE_DA_FONTE[s.fonte]}</span>
                <div className="min-w-0 flex-1">
                  <p className={juntar(texto.corpo, "line-clamp-2")} title={s.texto}>{s.texto}</p>
                  <p className={juntar(texto.auxiliar, "truncate")}>de {ROTULO_DA_FONTE[s.fonte]}</p>
                </div>
                <button type="button" className={juntar("toque-compacto ml-3 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-60", i === 0 ? "bg-accent-solid text-on-accent hover:bg-accent-solid/85" : "bg-muted text-foreground hover:bg-foreground hover:text-background", foco)} onClick={() => agir(s)} aria-label={s.rotuloDaAcao} title={s.rotuloDaAcao} disabled={s.acao === "mistura" && misturando}>
                  {s.acao === "mistura" && misturando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : ICONE_DA_ACAO[s.acao]}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
