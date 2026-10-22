import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CalendarPlus, FilePlus2, Flame, Lightbulb, Megaphone, MessagesSquare, Newspaper, Sparkles, Zap } from "lucide-react";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
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
import { nomeDoMes } from "./planoDoMes";

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
  });
  const resumo = resumoDoMes({ posts: itens ? itens.length : null, datas: principais.length, emAlta: emAltaNoNicho });
  const nome = nomeDoMes(mes);

  const agir = (s: SugestaoDoMes) => {
    if (s.acao === "campanha" && s.data) {
      const nota = notas && notas.notas ? notas.notas[s.data.id] : null;
      guardarSementeDaCampanha(clientId, sementeDaSelecao([juntadoDaData(s.data, nota || null)], ""));
      onCriarCampanha();
    } else if (s.acao === "abrir-em-alta") onAbrirRadar("em-alta");
    else if (s.acao === "abrir-semana") onAbrirRadar("semana");
    else onAgente();
  };

  return (
    <div className="min-w-0 space-y-4" data-topo-do-mes="">
      <header className="flex min-w-0 items-start">
        <div className="min-w-0 flex-1">
        <h2 className={juntar(texto.tituloPagina, "truncate")} data-mes-do-topo="">{nome.charAt(0).toUpperCase() + nome.slice(1)}</h2>
        <p className={juntar(texto.corpo, "mt-0.5 truncate text-muted-foreground")} data-nicho-do-topo="">
          {nicho ? <><span className="font-medium text-foreground">{nicho}</span> · </> : null}{clientName}
        </p>
        <p className={juntar(texto.auxiliar, "mt-0.5")} data-resumo-do-mes="">{resumo}</p>
        </div>
        {/* Ações do mês só em ícone (nome no title); o primário da aba é o Agente do mês que flutua. */}
        <div className="ml-2 flex shrink-0 items-center" aria-label="Ações do mês" role="group">
          <button type="button" className={botao.icone} onClick={onPeriodo} aria-label="Novo calendário" title="Novo calendário"><CalendarPlus className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" className={botao.icone} onClick={onRapido} aria-label="Conteúdo rápido" title="Conteúdo rápido"><Zap className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" className={botao.icone} onClick={() => onConversar("planejar")} aria-label="Planejar com o agente" title="Planejar com o agente"><MessagesSquare className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" className={botao.icone} onClick={() => onConversar("criar")} aria-label="Criar conteúdos" title="Criar conteúdos"><FilePlus2 className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      </header>

      {sugestoes.length > 0 && (
        <section className="min-w-0" aria-label="O que fazer agora" data-o-que-fazer="">
          <div className="flex min-w-0 items-center">
            <h3 className={juntar(texto.tituloSecao, "flex items-center")}>
              <Lightbulb className="mr-1.5 h-4 w-4 text-primary" aria-hidden="true" />
              O que fazer agora
            </h3>
            <AjudaRecolhida rotulo="De onde vêm as sugestões?">
              Montadas com o que já está na Mesa: as datas do nicho (Datas), a leitura da semana (Da semana), as notícias já buscadas (Em alta) e a agenda deste mês (Calendário). Cada uma diz a fonte.
            </AjudaRecolhida>
          </div>
          <ul className={juntar(lista.aberta, lista.divisoria, "mt-1")}>
            {sugestoes.map((s) => (
              <li key={s.chave} className={juntar(lista.linha, "py-2")} data-sugestao={s.fonte}>
                <span className="mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground" aria-hidden="true">{ICONE_DA_FONTE[s.fonte]}</span>
                <div className="min-w-0 flex-1">
                  <p className={juntar(texto.corpo, "line-clamp-2 sm:line-clamp-1")} title={s.texto}>{s.texto}</p>
                  <p className={texto.auxiliar}>de {ROTULO_DA_FONTE[s.fonte]}</p>
                </div>
                <button type="button" className={juntar(botao.icone, "ml-2 text-primary")} onClick={() => agir(s)} aria-label={s.rotuloDaAcao} title={s.rotuloDaAcao}>
                  {ICONE_DA_ACAO[s.acao]}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
