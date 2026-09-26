import { useMemo, type ReactNode } from "react";
import RitualEstruturado from "@/components/client/RitualEstruturado";
import { estruturaDoRitual } from "@/lib/ritualTexto";
import {
  Eye, UserPlus, MessageCircle, ShoppingBag, Wallet,
  TrendingUp, Lightbulb, CheckCircle2,
} from "lucide-react";
import { Painel, Secao, etiqueta, juntar, texto } from "@/components/sistema";

/**
 * Leitura do relatório em linguagem de gente.
 *
 * O cliente não precisa saber o que é CPM, CPC ou ROAS. Ele precisa saber
 * quantas pessoas viram, quantas se interessaram, quantas chamaram e quanto
 * custou cada uma. A leitura é sempre construtiva: número baixo vira contexto
 * e próximo passo, nunca acusação.
 */

const int = (v: number) => Math.round(v).toLocaleString("pt-BR");
const money = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

interface Props {
  metrics: Record<string, any>;
  previousMetrics?: Record<string, any> | null;
  periodDays: number;
  summary?: string | null;
  nextSteps?: string | null;
}

export default function ClientPlainSummary({
  metrics,
  previousMetrics,
  periodDays,
  summary,
  nextSteps,
}: Props) {
  const data = useMemo(() => {
    // Muitos relatórios usam métricas com nomes próprios (investimento_brl,
    // conversas, reservas...). Classifica cada chave pelo nome, em qualquer
    // idioma, para a leitura clara funcionar com QUALQUER relatório real.
    const normalize = (key: string) =>
      key
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
    const isRateKey = (key: string) =>
      /^custo|cpc|cpm|cpa|ctr|taxa|rate|_pct|roas|frequen|medio|media|avg|per_|_por_/.test(key);
    const bucketOf = (key: string): string | null => {
      if (isRateKey(key)) return null;
      if (/investi|spend|verba|gasto|orcamento/.test(key)) return "spend";
      if (/receita|revenue|faturamento/.test(key)) return "revenue";
      if (/venda|compra|purchase|reserva|pedido|booking|checkout_conclu/.test(key)) return "purchases";
      // "messages" é o campo padrão do relatório (Mensagens, em AdminReportCreate).
      if (/conversa|lead|mensagem|messag|msg|contato|whatsapp|direct|conversion/.test(key)) return "contacts";
      if (/clique|click|visita|trafego|traffic|sessao|sessions/.test(key)) return "visits";
      if (/alcance|impress|reach/.test(key)) return "reach";
      if (/seguidor|follower/.test(key)) return "followers";
      if (/engaj|curtida|like|coment|comment|compartilh|share|salv|save|view/.test(key)) return "engagement";
      return null;
    };
    const sumBuckets = (source: Record<string, any> | null | undefined) => {
      const totals: Record<string, number> = {};
      for (const [rawKey, rawValue] of Object.entries(source || {})) {
        if (rawKey === "custom" || rawKey.startsWith("__")) continue;
        const value = Number(rawValue);
        if (!Number.isFinite(value) || value <= 0) continue;
        const bucket = bucketOf(normalize(rawKey));
        if (!bucket) continue;
        totals[bucket] = (totals[bucket] || 0) + value;
      }
      const custom = (source as any)?.custom;
      if (custom && typeof custom === "object") {
        for (const [rawKey, rawValue] of Object.entries(custom)) {
          const value = Number(rawValue);
          if (!Number.isFinite(value) || value <= 0) continue;
          const bucket = bucketOf(normalize(rawKey));
          if (!bucket) continue;
          totals[bucket] = (totals[bucket] || 0) + value;
        }
      }
      return totals;
    };

    const now = sumBuckets(metrics);
    const before = sumBuckets(previousMetrics);

    const reach = now.reach || 0;
    const prevReach = before.reach || 0;
    const visits = now.visits || 0;
    const prevVisits = before.visits || 0;
    const contacts = now.contacts || 0;
    const prevContacts = before.contacts || 0;
    const purchases = now.purchases || 0;
    const revenue = now.revenue || 0;
    const spend = now.spend || 0;
    const followers = now.followers || 0;
    const engagement = now.engagement || 0;

    const costPerContact = contacts > 0 && spend > 0 ? spend / contacts : null;
    const costPerPurchase = purchases > 0 && spend > 0 ? spend / purchases : null;
    const returnPerReal = revenue > 0 && spend > 0 ? revenue / spend : null;
    const contactsPerDay = periodDays > 0 && contacts > 0 ? contacts / periodDays : null;

    const growth = (now: number, before: number) =>
      before > 0 ? ((now - before) / before) * 100 : null;

    return {
      reach, prevReach, visits, prevVisits, contacts, prevContacts,
      purchases, revenue, spend, followers, engagement,
      costPerContact, costPerPurchase, returnPerReal, contactsPerDay,
      reachGrowth: growth(reach, prevReach),
      visitsGrowth: growth(visits, prevVisits),
      contactsGrowth: growth(contacts, prevContacts),
    };
  }, [metrics, previousMetrics, periodDays]);

  const hasAnything = data.reach > 0 || data.visits > 0 || data.contacts > 0 || data.spend > 0;
  if (!hasAnything) return null;

  // Jornada: cada etapa com número, explicação humana e variação.
  const journey = [
    {
      show: data.reach > 0,
      icon: Eye,
      label: "Pessoas alcançadas",
      value: int(data.reach),
      explain: "Quantas pessoas diferentes viram o conteúdo e os anúncios da sua marca neste período.",
      growth: data.reachGrowth,
      tone: "text-sky-500",
      bg: "bg-sky-500/10",
    },
    {
      show: data.visits > 0,
      icon: UserPlus,
      label: "Quiseram saber mais",
      value: int(data.visits),
      explain: "Dessas pessoas, quantas deram o passo seguinte: visitaram o perfil ou clicaram para conhecer.",
      growth: data.visitsGrowth,
      tone: "text-violet-500",
      bg: "bg-violet-500/10",
    },
    {
      show: data.contacts > 0,
      icon: MessageCircle,
      label: "Entraram em contato",
      value: int(data.contacts),
      explain: data.contactsPerDay
        ? `Pessoas que chamaram vocês. Isso dá cerca de ${data.contactsPerDay.toFixed(1)} contato(s) por dia.`
        : "Pessoas que chamaram vocês por mensagem ou formulário.",
      growth: data.contactsGrowth,
      tone: "text-emerald-500",
      bg: "bg-emerald-500/10",
    },
    {
      show: data.purchases > 0,
      icon: ShoppingBag,
      label: "Compraram",
      value: int(data.purchases),
      explain: data.revenue > 0
        ? `Vendas concluídas, somando ${money(data.revenue)} em receita.`
        : "Vendas concluídas no período.",
      growth: null,
      tone: "text-amber-500",
      bg: "bg-amber-500/10",
    },
  ].filter((step) => step.show);

  // Leitura do investimento, sempre em linguagem de dono de negócio.
  const investmentReading: string[] = [];
  if (data.spend > 0) {
    if (data.costPerContact) {
      investmentReading.push(
        `Foram investidos ${money(data.spend)} em anúncios e chegaram ${int(data.contacts)} contato(s). Na prática, cada pessoa que chamou vocês custou ${money(data.costPerContact)}.`
      );
    } else {
      investmentReading.push(
        `Foram investidos ${money(data.spend)} para colocar a marca na frente de ${int(data.reach)} pessoa(s) neste período.`
      );
    }
    if (data.costPerPurchase) {
      investmentReading.push(
        `Cada venda saiu por ${money(data.costPerPurchase)} de investimento em mídia.`
      );
    }
    if (data.returnPerReal) {
      investmentReading.push(
        `Para cada R$ 1,00 investido, retornaram ${money(data.returnPerReal)} em vendas.`
      );
    } else if (data.contacts > 0) {
      investmentReading.push(
        `O retorno desta fase são as ${int(data.contacts)} pessoa(s) que chegaram até vocês: cliente conhece primeiro, compra depois. É esse fluxo constante de interessados que vira venda nos ciclos seguintes.`
      );
    } else if (data.reach > 0) {
      investmentReading.push(
        `O retorno desta fase é a presença: ${int(data.reach)} pessoa(s) da região certa agora conhecem a marca. Ninguém compra de quem nunca viu; esta etapa constrói exatamente isso.`
      );
    }
  }

  // Fase da jornada: primeiro ciclo é estruturação; com histórico, é evolução.
  // A mensagem sempre ancora expectativa: resultado composto vem com constância,
  // e cada fase tem um objetivo claro - isso segura o cliente nos meses 1 e 2.
  const hasHistory = Boolean(
    previousMetrics && Object.values(previousMetrics).some((value) => Number(value) > 0),
  );
  const journeyPhase = hasHistory
    ? {
        title: "Fase de evolução",
        text: "Vocês já têm base de comparação: agora cada período mostra a curva subindo sobre o anterior. É nessa fase que a constância começa a pagar, porque o público que já viu a marca antes responde mais barato e mais rápido.",
      }
    : {
        title: "Fase de estruturação",
        text: "Este é o primeiro retrato completo do trabalho. Os números desta fase são a régua de partida: nos próximos relatórios você compara e enxerga a evolução real. Marca forte se constrói em ciclos, e o primeiro ciclo é onde se planta.",
      };

  // Interpretação construtiva: o que o movimento indica e o que fazer com isso.
  const interpretation = (() => {
    if (data.contactsGrowth !== null && data.contactsGrowth > 10) {
      return `O número de pessoas entrando em contato cresceu ${Math.round(data.contactsGrowth)}% em relação ao período anterior. O caminho está funcionando: seguimos reforçando o que trouxe esse movimento.`;
    }
    if (data.contacts > 0 && data.visits > 0) {
      const rate = (data.contacts / data.visits) * 100;
      return `De cada 100 pessoas que foram conhecer seu perfil, cerca de ${Math.round(rate)} chamaram vocês. Esse é o ponto que estamos trabalhando para melhorar: quanto mais fácil e convidativo o próximo passo, mais contatos chegam com o mesmo investimento.`;
    }
    if (data.reach > 0 && data.visits > 0) {
      return `A marca apareceu para ${int(data.reach)} pessoa(s) e ${int(data.visits)} quiseram saber mais. A fase agora é transformar esse interesse em conversa, com chamadas mais diretas e conteúdo que responde as dúvidas de quem está decidindo.`;
    }
    if (data.reach > 0) {
      return `A prioridade deste período foi colocar a marca na frente das pessoas certas: ${int(data.reach)} pessoa(s) alcançadas. Com essa base construída, o próximo movimento é converter atenção em contato.`;
    }
    return "Este período foi de construção da base. Os próximos relatórios mostram a resposta desse trabalho em números.";
  })();

  const extras = [
    data.followers > 0 && {
      icon: UserPlus,
      text: `${int(data.followers)} pessoa(s) passaram a seguir a marca neste período.`,
    },
    data.engagement > 0 && {
      icon: TrendingUp,
      text: `${int(data.engagement)} interação(ões) com os conteúdos (curtidas, comentários, salvamentos e compartilhamentos).`,
    },
  ].filter(Boolean) as { icon: any; text: string }[];

  return (
    <Secao
      titulo="O que aconteceu"
      descricao={periodDays > 0 ? `Nos últimos ${periodDays} dias` : undefined}
      ajuda="Um resumo sem termos técnicos: quantas pessoas viram sua marca, quantas se interessaram e quantas chegaram até vocês."
      divisoria
    >
      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-8">
        {/* Jornada das pessoas: os números são o assunto, então ficam num painel */}
        <Painel semEspaco titulo="O caminho que as pessoas fizeram" className="self-start">
          <ol className="divide-y divide-border">
            {journey.map((step) => (
              <li key={step.label} className="flex min-w-0 items-start px-4 py-3">
                <step.icon className="mr-3 mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="-mb-1 flex min-w-0 flex-wrap items-baseline [&>*]:mb-1 [&>*]:mr-2">
                    <span className="text-[20px] font-semibold leading-7 tabular-nums text-foreground">{step.value}</span>
                    <span className="text-[13px] font-medium text-foreground">{step.label}</span>
                    {step.growth !== null && Math.abs(step.growth) >= 5 && (
                      <span className={juntar(etiqueta, step.growth > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                        {step.growth > 0 ? "+" : ""}
                        {Math.round(step.growth)}% vs. período anterior
                      </span>
                    )}
                  </div>
                  <p className={juntar(texto.auxiliar, "mt-1 leading-5")}>{step.explain}</p>
                </div>
              </li>
            ))}
          </ol>
        </Painel>

        {/* Leituras em texto corrido, separadas por divisória (sem caixa) */}
        <div className="min-w-0 divide-y divide-border">
          {investmentReading.length > 0 && (
            <Leitura icone={Wallet} titulo="O investimento na prática">
              {investmentReading.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </Leitura>
          )}

          <Leitura icone={TrendingUp} titulo={journeyPhase.title}>
            <p>{journeyPhase.text}</p>
          </Leitura>

          <Leitura icone={Lightbulb} titulo="O que isso significa" destaque>
            <p>{interpretation}</p>
            {summary && estruturaDoRitual(summary).blocos.length > 0 ? (
              <div className="pt-1"><RitualEstruturado body={summary} /></div>
            ) : summary && (
              <p className="whitespace-pre-line text-muted-foreground">{summary}</p>
            )}
          </Leitura>

          {extras.length > 0 && (
            <Leitura icone={UserPlus} titulo="Também aconteceu no período">
              {extras.map((extra) => (
                <p key={extra.text} className="flex items-start text-muted-foreground">
                  <extra.icon className="mr-2 mt-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0">{extra.text}</span>
                </p>
              ))}
            </Leitura>
          )}

          {nextSteps && (
            <Leitura icone={CheckCircle2} titulo="O próximo passo">
              <p className="whitespace-pre-line">{nextSteps.replace(/\*/g, "")}</p>
            </Leitura>
          )}
        </div>
      </div>
    </Secao>
  );
}

/** Um bloco de leitura: título curto com ícone e o texto embaixo. */
function Leitura({
  icone: Icone,
  titulo,
  destaque = false,
  children,
}: {
  icone: any;
  titulo: string;
  destaque?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 py-3 first:pt-0 last:pb-0">
      <h3 className="flex items-center text-[13px] font-semibold leading-5 text-foreground">
        <Icone className={juntar("mr-1.5 h-3.5 w-3.5 shrink-0", destaque ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
        {titulo}
      </h3>
      <div className={juntar(texto.corpo, "mt-1.5 space-y-1.5")}>{children}</div>
    </div>
  );
}
