import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  BarChart3,
  Bookmark,
  ChevronRight,
  ExternalLink,
  Fingerprint,
  Globe,
  Heart,
  HeartPulse,
  Images,
  LayoutGrid,
  Lightbulb,
  List,
  Megaphone,
  MessageCircle,
  RefreshCw,
  Send,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import SaudeDasContas, { AJUDA_DA_SAUDE } from "@/components/admin/SaudeDasContas";
import LogoDoCliente, { useIdentidadesPorConta } from "@/components/admin/LogoDoCliente";
import IdentidadeDoCliente from "@/components/admin/IdentidadeDoCliente";
import {
  AreaDeTrabalho,
  CabecalhoDePagina,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  Etapas,
  Painel,
  botao,
  etiqueta,
  juntar,
  superficie,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";
import { CampoDeBusca, FaixaDeNumeros } from "@/components/sistema";
import {
  agruparPorConta,
  collectSocialMetricsNow,
  formatMetricNumber,
  semanaEmAndamento,
  useSocialClientIdentity,
  useSocialMetricsWeekly,
  useSocialPostMetrics,
  weekDeltaPct,
  type SocialMetricsWeek,
  type SocialPostMetric,
} from "@/hooks/useSocialMetrics";
import { useAdsConnection, useAdsDaily, type AdsDaily } from "@/hooks/useAdsMetrics";
import { dinheiro, numero, summarizeAccount } from "@/lib/adsLanguage";
import { custoDoResultado, resultadosPorObjetivo, rotuloDoResultado } from "@/lib/adsResumo";
import {
  conselhoDoCliente,
  formatoDoPost,
  interacoesDoPost,
  multiplosDosPosts,
  rankearPosts,
  totaisDosPosts,
} from "@/lib/metricasResumo";
import { pedirLeituraDaMesa, useDesempenhoDaMesa, useUltimaEvolucao } from "@/hooks/useConselhoDaMesa";
import { type MultiploDoPost, textoDoMultiplo } from "../../supabase/functions/_shared/multiplo-do-post";

/**
 * Métricas por cliente (pedido do dono em 26/09: "mais organizada, mais
 * bonita, puxa todas as informações completas, alinhada com a Mesa, que
 * aconselha junto"; sistema de design de 26/09).
 *
 * Lista: uma linha por conta de Instagram (a marca, seguidores, alcance,
 * interações e os anúncios somados do cliente). A saúde das contas é a outra
 * aba, na mesma linha do título.
 *
 * Dossiê de uma conta, uma parte por vez em abas de ícone: o conselho curto
 * (números da semana + leitura de evolução da Mesa + anúncios), o perfil
 * orgânico (alcance, seguidores, interações, salvamentos, compartilhamentos),
 * os anúncios somados do cliente, os posts que mais performaram, com
 * miniatura, e a identidade (como a marca é).
 *
 * 16/10/2026 (dono): "tá tudo embaixo, um abaixo do outro; colocar do ladinho,
 * com abas, sem texto, com ícones; passo em cima e ele fala o que é". As
 * seções empilhadas viraram abas de ícone (uma visível por vez, lembrada), as
 * ações viraram só ícone com o nome no title, um "Atualizar" só por tela,
 * nenhum ícone repetido para ações diferentes e o "Copiar resumo" saiu.
 */

const fmtWeek = (row: SocialMetricsWeek) => {
  const d = (value: string) => {
    const [, month, day] = value.split("-");
    return `${day}/${month}`;
  };
  // A semana corrente aparece com os números parciais e diz isso na cara:
  // sem o aviso, 3 dias de alcance pareciam uma semana fraca.
  return `${d(row.week_start)} a ${d(row.week_end)}${semanaEmAndamento(row) ? " (em andamento)" : ""}`;
};

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function DeltaBadge({ pct, className = "" }: { pct: number | null; className?: string }) {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span className={juntar(etiqueta, up ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive", className)}>
      {up ? <TrendingUp className="mr-0.5 h-3 w-3" aria-hidden="true" /> : <TrendingDown className="mr-0.5 h-3 w-3" aria-hidden="true" />}
      {`${up ? "+" : ""}${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
    </span>
  );
}

interface Indicador {
  rotulo: string;
  valor: string;
  delta?: number | null;
  nota?: string | null;
}

/**
 * Os números numa faixa só: um painel com a grade separada por linhas finas
 * (nada de um cartão por número). `colunas` tem de dividir a quantidade de
 * itens em toda largura, senão sobra célula vazia.
 */
function FaixaDeIndicadores({ itens, colunas, rotulo }: { itens: Indicador[]; colunas: string; rotulo: string }) {
  // A faixa do sistema (compacta); aqui só a variação vira selo ao lado do valor.
  return (
    <FaixaDeNumeros
      rotulo={rotulo}
      grade={colunas}
      tamanho="compacto"
      itens={itens.map((item) => ({
        rotulo: item.rotulo,
        valor: item.valor,
        aoLado: item.delta != null ? <DeltaBadge pct={item.delta} /> : undefined,
        apoio: item.nota || undefined,
      }))}
    />
  );
}

/** Resultado dos anúncios em frase curta: o objetivo com mais dinheiro. */
function resumoDosAnuncios(rows: AdsDaily[]) {
  const carteira = summarizeAccount(rows);
  const lista = resultadosPorObjetivo(rows).filter((r) => r.kind !== "alcance" && r.resultados > 0);
  const principal = lista[0] || null;
  return {
    carteira,
    resultado: principal ? rotuloDoResultado(principal) : null,
    custo: principal ? custoDoResultado(principal) : null,
    outros: lista.slice(1).map(rotuloDoResultado).join(" · "),
  };
}

/** Cartão de post: a miniatura manda (sem moldura); o que performou se reconhece pela imagem. */
function CartaoDoPost({ post, posicao, multiplo }: { post: SocialPostMetric; posicao: number; multiplo?: MultiploDoPost }) {
  const imagem = post.thumbnail_url || post.media_url || "";
  const numeros = [
    post.views != null ? `${formatMetricNumber(post.views)} views` : null,
    post.reach != null ? `${formatMetricNumber(post.reach)} alcance` : null,
    `${formatMetricNumber(interacoesDoPost(post))} interações`,
  ].filter(Boolean).join(" · ");
  return (
    <a
      href={post.permalink || undefined}
      target="_blank"
      rel="noreferrer"
      className="group block min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative overflow-hidden rounded-md bg-muted" style={{ paddingBottom: "100%" }}>
        {imagem ? (
          <img
            src={imagem}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full object-cover"
            onError={(event) => {
              (event.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
        <span className="absolute left-1.5 top-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[11px] font-semibold text-foreground">
          {posicao}º · {formatoDoPost(post.media_type)}
        </span>
        {multiplo && multiplo.multiplo !== null && (
          <span
            title={textoDoMultiplo(multiplo)}
            className={juntar("absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", multiplo.destaque ? "bg-primary text-primary-foreground" : "bg-background/90 text-foreground")}
          >
            {String(multiplo.multiplo).replace(".", ",")}x
          </span>
        )}
      </div>
      <p className="mt-1.5 line-clamp-2 text-[12px] leading-4 text-foreground group-hover:text-primary [overflow-wrap:anywhere]">
        {post.caption?.trim() || "(sem legenda)"}
      </p>
      <p className={juntar(texto.auxiliar, "mt-0.5 truncate")}>
        {post.posted_at ? `${new Date(post.posted_at).toLocaleDateString("pt-BR")} · ` : ""}
        {numeros}
      </p>
      <p className={juntar(texto.auxiliar, "mt-0.5 flex flex-wrap tabular-nums [&>*]:mr-2.5")}>
        <span className="inline-flex items-center"><Heart className="mr-0.5 h-3 w-3" aria-hidden="true" />{formatMetricNumber(post.like_count)}</span>
        <span className="inline-flex items-center"><MessageCircle className="mr-0.5 h-3 w-3" aria-hidden="true" />{formatMetricNumber(post.comments_count)}</span>
        <span className="inline-flex items-center"><Bookmark className="mr-0.5 h-3 w-3" aria-hidden="true" />{formatMetricNumber(post.saved)}</span>
        <span className="inline-flex items-center"><Send className="mr-0.5 h-3 w-3" aria-hidden="true" />{formatMetricNumber(post.shares)}</span>
      </p>
    </a>
  );
}

/** Ação só em ícone, sem borda: o nome mora no title e no leitor de tela. */
function BotaoDeIcone({
  icone,
  rotulo,
  dica,
  onClick,
  disabled,
}: {
  icone: ReactNode;
  rotulo: string;
  /** Title quando difere do nome (ex.: "A Mesa está lendo..."). */
  dica?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={juntar(botao.icone, "disabled:opacity-50")} aria-label={rotulo} title={dica || rotulo}>
      {icone}
    </button>
  );
}

const ICONE = "h-4 w-4";

type AbaDoCliente = "conselho" | "organico" | "anuncios" | "posts" | "identidade";
const ABAS_DO_CLIENTE: AbaDoCliente[] = ["conselho", "organico", "anuncios", "posts", "identidade"];

type AbaDaLista = "contas" | "saude";

/**
 * Dossiê de UMA conta de Instagram do cliente, com os anúncios do cliente e
 * o conselho da Mesa. Tudo do orgânico aqui é DESTA conta: o cliente pode ter
 * outra, e ela tem o próprio dossiê.
 */
function ClientMetricsDetail({
  clientId,
  accountId,
  clientName,
  rows,
  adsRows,
  atualizar,
}: {
  clientId: string;
  accountId: string;
  clientName: string;
  rows: SocialMetricsWeek[];
  adsRows: AdsDaily[];
  atualizar: ReactNode;
}) {
  // 200 e não 25: a coleta pagina, e limitar aqui esconderia posts reais.
  const { data: posts, isLoading: lendoPosts } = useSocialPostMetrics(clientId, 200, accountId);
  // Uma parte por vez (16/10/2026): conselho, orgânico, anúncios, posts e
  // identidade em abas de ícone. A aba fica lembrada por cliente.
  const [abaDoCliente, setAbaDoCliente] = useEstadoDaTela<AbaDoCliente>(`metricas:aba:${clientId}`, "conselho", {
    validar: (v) => ABAS_DO_CLIENTE.indexOf(v as AbaDoCliente) >= 0,
  });
  const [todosOsPosts, setTodosOsPosts] = useEstadoDaTela(`metricas:todos-os-posts:${accountId}`, false, {
    validar: (v) => typeof v === "boolean",
  });
  const [pedindoLeitura, setPedindoLeitura] = useState(false);
  const queryClient = useQueryClient();
  const { data: identity } = useSocialClientIdentity(clientId, accountId);
  const { data: evolucao } = useUltimaEvolucao(clientId);
  const { data: daMesa } = useDesempenhoDaMesa(clientId, 30);
  const { data: conexao } = useAdsConnection();

  const latest = rows[0];
  const rankedPosts = useMemo(() => rankearPosts(posts), [posts]);
  const multiplos = useMemo(() => multiplosDosPosts(posts), [posts]);
  const totais = useMemo(() => totaisDosPosts(posts, 30), [posts]);
  const anuncios = useMemo(() => resumoDosAnuncios(adsRows), [adsRows]);
  const contasDeAds = (conexao?.contas || []).filter((c) => c.client_id === clientId && c.status === "active");
  const saldo = contasDeAds.some((c) => c.saldo_disponivel != null)
    ? contasDeAds.reduce((t, c) => t + Number(c.saldo_disponivel || 0), 0)
    : null;

  const deltaAlcance = weekDeltaPct(rows, "reach");
  const deltaSeguidores = weekDeltaPct(rows, "followers");
  const ultimasSemanas = rows.slice(0, 8);
  const maxReach = Math.max(...ultimasSemanas.map((row) => row.reach || 0), 1);

  const leituraDaMesa = evolucao ? evolucao.leitura : null;
  const conselho = useMemo(
    () =>
      conselhoDoCliente({
        semanas: rows,
        deltaAlcance,
        deltaSeguidores,
        posts: rankedPosts,
        evolucao: leituraDaMesa
          ? {
              resumo: leituraDaMesa.explicacao ? leituraDaMesa.explicacao.resumo : null,
              vencedores: leituraDaMesa.vencedores,
              proximos_testes: leituraDaMesa.proximos_testes,
              aprendizados: leituraDaMesa.aprendizados,
            }
          : null,
        anuncios: { investido: anuncios.carteira.investido, resultado: anuncios.resultado, custo: anuncios.custo },
      }),
    [rows, deltaAlcance, deltaSeguidores, rankedPosts, leituraDaMesa, anuncios],
  );

  const pedirLeitura = async () => {
    setPedindoLeitura(true);
    try {
      await pedirLeituraDaMesa(clientId, 30);
      await queryClient.invalidateQueries({ queryKey: ["metricas", "ultima-evolucao", clientId] });
      toast.success("A Mesa leu o cliente de novo. O conselho foi atualizado.");
    } catch (error: unknown) {
      toast.error((error as { message?: string })?.message || "A Mesa não respondeu agora. Tente de novo em instantes.");
    } finally {
      setPedindoLeitura(false);
    }
  };

  // "Copiar resumo" saiu em 16/10/2026 (dono: "não precisa; um abrir mesmo"):
  // o que abre é a Mesa, na aba Conselho.

  const destaques = rankedPosts.slice(0, 6);

  const foto = identity?.profile_picture_url ? (
    <img
      src={identity.profile_picture_url}
      alt=""
      referrerPolicy="no-referrer"
      className="mr-2.5 h-8 w-8 shrink-0 rounded-full border border-border object-cover"
      onError={(event) => {
        (event.target as HTMLImageElement).style.display = "none";
      }}
    />
  ) : (
    <LogoDoCliente url={null} nome={clientName} tamanho={32} className="mr-2.5" />
  );

  const site = identity?.website ? identity.website.replace(/^https?:\/\//, "") : "";

  // As partes, uma por vez (16/10/2026): só o ícone; a aberta mostra o nome e o "?".
  const abas = [
    {
      valor: "conselho",
      rotulo: "Conselho",
      icone: <Lightbulb className={ICONE} />,
      contador: conselho.length,
      ajuda: "Os números da semana, a leitura de evolução da Mesa e os anúncios, cada linha com o número que a gerou. Com duas semanas coletadas ou uma leitura da Mesa, o conselho aparece.",
    },
    {
      valor: "organico",
      rotulo: "Perfil orgânico",
      icone: <Users className={ICONE} />,
      ajuda: "Seguidores, alcance, interações e visitas ao perfil da última semana coletada, com a variação contra a semana anterior. Salvamentos e compartilhamentos somam os posts dos últimos 30 dias.",
    },
    {
      valor: "anuncios",
      rotulo: "Anúncios do cliente",
      icone: <Megaphone className={ICONE} />,
      ajuda: "Os anúncios do cliente nos últimos 30 dias, somados, e a soma com o orgânico que a Mesa faz.",
    },
    {
      valor: "posts",
      rotulo: "Posts que mais performaram",
      icone: <Images className={ICONE} />,
      contador: rankedPosts.length,
      ajuda: "Pelo múltiplo: quantas vezes o post rendeu acima do normal deste perfil (views, ou alcance, ou interações, contra a mediana dos últimos 90 dias). Em verde, 1,5x ou mais. Toque num post para abrir no Instagram.",
    },
    {
      valor: "identidade",
      rotulo: "Identidade",
      icone: <Fingerprint className={ICONE} />,
      ajuda: "Como a marca é: logo, bio, site e as cores da logo.",
    },
  ];

  // As ações da parte aberta, só em ícone, na linha das abas.
  const acoesDaAba =
    abaDoCliente === "conselho" ? (
      <>
        <Link to={`/mesa?client=${clientId}`} className={botao.icone} aria-label="Abrir a Mesa" title="Abrir a Mesa">
          <LayoutGrid className={ICONE} aria-hidden="true" />
        </Link>
        <BotaoDeIcone
          icone={<Sparkles className={juntar(ICONE, pedindoLeitura ? "animate-pulse" : "")} aria-hidden="true" />}
          rotulo="Pedir leitura da Mesa"
          dica={pedindoLeitura ? "A Mesa está lendo..." : undefined}
          onClick={pedirLeitura}
          disabled={pedindoLeitura}
        />
      </>
    ) : abaDoCliente === "anuncios" ? (
      <Link to={`/anuncios?cliente=${encodeURIComponent(clientId)}`} className={botao.icone} aria-label="Abrir em Anúncios" title="Abrir em Anúncios">
        <ArrowUpRight className={ICONE} aria-hidden="true" />
      </Link>
    ) : abaDoCliente === "posts" && rankedPosts.length > destaques.length ? (
      <BotaoDeIcone
        icone={<List className={juntar(ICONE, todosOsPosts ? "text-primary" : "")} aria-hidden="true" />}
        rotulo={todosOsPosts ? "Esconder a lista" : `Ver todas as ${rankedPosts.length} publicações`}
        onClick={() => setTodosOsPosts((v) => !v)}
      />
    ) : null;

  return (
    <div className="min-w-0 space-y-4">
      <CabecalhoDePagina
        voltar={{ para: "/metricas", rotulo: "Métricas" }}
        titulo={
          <span className="flex min-w-0 items-center">
            {foto}
            <Link to={`/clientes?client=${clientId}`} className="min-w-0 truncate rounded hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {clientName}
            </Link>
          </span>
        }
        descricao={`${identity?.username ? `@${identity.username} · ` : ""}${latest ? `semana ${fmtWeek(latest)}` : "sem coleta ainda"}`}
        ajuda="O Instagram desta conta, os anúncios somados do cliente e o conselho da Mesa, uma parte por vez nas abas de ícone abaixo. O nome abre a ficha do cliente."
        acoes={
          <>
            {identity?.website && (
              <a
                href={identity.website}
                target="_blank"
                rel="noreferrer"
                className={botao.icone}
                aria-label={`Abrir o site ${site}`}
                title={site}
              >
                <Globe className={ICONE} aria-hidden="true" />
              </a>
            )}
            {atualizar}
          </>
        }
      />

      <div className="-mx-1 flex min-w-0 items-center border-b border-border pb-1">
        <Etapas
          soIcone
          rotulo={`Partes de ${clientName}`}
          itens={abas}
          valor={abaDoCliente}
          onEscolher={(v) => setAbaDoCliente(v as AbaDoCliente)}
          className="min-w-0 flex-1"
        />
        {acoesDaAba && <div className="ml-2 flex shrink-0 items-center">{acoesDaAba}</div>}
      </div>

      <AreaDeTrabalho key={`${accountId}:${abaDoCliente}`} memoriaDaRolagem={`metricas:${accountId}:${abaDoCliente}`} rotuloDoPrincipal={`Métricas de ${clientName}`}>
        {abaDoCliente === "identidade" && <IdentidadeDoCliente clientId={clientId} clientName={clientName} />}

        {/* 1. O conselho, curto e com o número que o gerou. */}
        {abaDoCliente === "conselho" && (
          <div className="min-w-0">
            <p className={juntar(texto.auxiliar, "mb-3 truncate")}>
              {evolucao
                ? `Leitura da Mesa de ${new Date(evolucao.criadoEm).toLocaleDateString("pt-BR")}`
                : "A Mesa ainda não leu este cliente"}
            </p>
            {conselho.length === 0 ? (
              <EstadoVazio compacto titulo="Sem conselho ainda." descricao="Com duas semanas coletadas ou uma leitura da Mesa, ele aparece aqui." />
            ) : (
              <ul className="space-y-1.5" aria-label="Conselho">
                {conselho.map((linha) => (
                  <li key={linha} className="flex min-w-0 items-start text-[13px] leading-5 text-foreground">
                    <span className="mr-2 mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{linha}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 2. O perfil orgânico. */}
        {abaDoCliente === "organico" && (
          <div className="min-w-0">
            {!latest ? (
              <EstadoVazio compacto titulo="Sem semana coletada ainda." descricao="O ícone de atualizar pede a coleta; os números chegam em alguns minutos." />
            ) : (
              <>
                <FaixaDeIndicadores
                  rotulo="Perfil orgânico"
                  colunas="grid-cols-2 sm:grid-cols-3 xl:grid-cols-6"
                  itens={[
                    { rotulo: "Seguidores", valor: formatMetricNumber(latest.followers), delta: deltaSeguidores },
                    { rotulo: "Alcance", valor: formatMetricNumber(latest.reach), delta: deltaAlcance, nota: "na semana" },
                    { rotulo: "Interações", valor: formatMetricNumber(latest.total_interactions), delta: weekDeltaPct(rows, "total_interactions"), nota: "na semana" },
                    { rotulo: "Salvamentos", valor: formatMetricNumber(totais.salvos), nota: "posts de 30 dias" },
                    { rotulo: "Compartilhamentos", valor: formatMetricNumber(totais.compartilhamentos), nota: "posts de 30 dias" },
                    { rotulo: "Visitas ao perfil", valor: formatMetricNumber(latest.profile_views), delta: weekDeltaPct(rows, "profile_views"), nota: "na semana" },
                  ]}
                />
                {ultimasSemanas.length > 1 && (
                  <div className="mt-4 min-w-0">
                    <p className={texto.rotulo}>Alcance semana a semana</p>
                    <div className="mt-2 space-y-1.5">
                      {ultimasSemanas.map((row) => (
                        <div key={row.id} className="flex min-w-0 items-center">
                          <span className={juntar(texto.auxiliar, "w-32 shrink-0 truncate tabular-nums")}>{fmtWeek(row)}</span>
                          <div className="mx-2 h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary/70"
                              style={{ width: `${Math.max(((row.reach || 0) / maxReach) * 100, 2)}%` }}
                            />
                          </div>
                          <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-foreground">{formatMetricNumber(row.reach)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 3. Os anúncios do cliente, somados, e a soma com o orgânico que a Mesa faz. */}
        {abaDoCliente === "anuncios" && (
          <div className="min-w-0">
            <p className={juntar(texto.auxiliar, "mb-3 truncate")}>Últimos 30 dias</p>
            {adsRows.length === 0 && contasDeAds.length === 0 ? (
              <EstadoVazio compacto titulo="Sem conta de anúncio ligada." descricao="Ligue em Anúncios para os números entrarem aqui." />
            ) : (
              <>
                <FaixaDeIndicadores
                  rotulo="Anúncios dos últimos 30 dias"
                  colunas="grid-cols-2 lg:grid-cols-4"
                  itens={[
                    { rotulo: "Investido", valor: dinheiro(anuncios.carteira.investido) },
                    { rotulo: "Resultado", valor: anuncios.resultado || "sem resultado", nota: anuncios.custo },
                    { rotulo: "Alcance pago", valor: numero(anuncios.carteira.alcance) },
                    { rotulo: "Saldo na conta", valor: saldo != null ? dinheiro(saldo) : "não lido" },
                  ]}
                />
                {anuncios.outros && <p className={juntar(texto.auxiliar, "mt-2 truncate")}>Também: {anuncios.outros}</p>}
              </>
            )}
            {daMesa && daMesa.somado.explicacao && (
              <p className={juntar(superficie.poco, "mt-3 px-3 py-2 text-[13px] leading-5 text-foreground")}>
                <span className="font-semibold">Somado pela Mesa: </span>
                {daMesa.somado.alcance_aprox != null ? `alcance aproximado ${formatMetricNumber(daMesa.somado.alcance_aprox)} · ` : ""}
                {`${formatMetricNumber(daMesa.somado.interacoes)} interações · ${dinheiro(daMesa.somado.investimento)} investidos. `}
                <span className="text-muted-foreground">{daMesa.somado.explicacao}</span>
              </p>
            )}
          </div>
        )}

        {/* 4. Os posts que mais performaram, com a miniatura. */}
        {abaDoCliente === "posts" && (
          <div className="min-w-0">
            {lendoPosts && !posts ? (
              <Carregando forma="grade" linhas={6} rotulo="Carregando posts" />
            ) : rankedPosts.length === 0 ? (
              <EstadoVazio compacto titulo="Ainda sem publicações coletadas." descricao="O ícone de atualizar pede a coleta; os posts chegam em alguns minutos." />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-x-3 gap-y-4 md:grid-cols-3 xl:grid-cols-6">
                  {destaques.map((post, i) => (
                    <CartaoDoPost key={post.id} post={post} posicao={i + 1} multiplo={multiplos.get(post.id)} />
                  ))}
                </div>
                {todosOsPosts && (
                  <Painel semEspaco className="mt-4 overflow-hidden">
                    {/* Duzentas publicações não empurram o resto: no computador a lista rola por dentro; no celular a página rola. */}
                    <ul className="min-w-0 divide-y divide-border lg:max-h-[520px] lg:overflow-y-auto lg:overscroll-contain" aria-label="Todas as publicações">
                      {rankedPosts.map((post, index) => (
                        <li key={post.id} className="flex min-w-0 items-center px-3 py-2">
                          <span className="mr-3 w-6 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
                          {(post.thumbnail_url || post.media_url) && (
                            <img
                              src={post.thumbnail_url || post.media_url || ""}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              className="mr-3 h-10 w-10 shrink-0 rounded-md object-cover"
                              onError={(event) => {
                                (event.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] text-foreground">{post.caption?.trim() || "(sem legenda)"}</p>
                            <p className={juntar(texto.auxiliar, "truncate")}>
                              {formatoDoPost(post.media_type)}
                              {post.posted_at ? ` · ${new Date(post.posted_at).toLocaleDateString("pt-BR")}` : ""}
                              {multiplos.get(post.id)?.multiplo != null ? ` · ${textoDoMultiplo(multiplos.get(post.id) as MultiploDoPost)}` : ""}
                              {post.reach != null ? ` · alcance ${formatMetricNumber(post.reach)}` : ""}
                              {post.saved != null ? ` · ${formatMetricNumber(post.saved)} salvos` : ""}
                              {post.shares != null ? ` · ${formatMetricNumber(post.shares)} compart.` : ""}
                            </p>
                          </div>
                          <span className="ml-3 shrink-0 text-[12px] tabular-nums text-foreground">{formatMetricNumber(interacoesDoPost(post))}</span>
                          {post.permalink && (
                            <a
                              href={post.permalink}
                              target="_blank"
                              rel="noreferrer"
                              className={juntar(botao.icone, "ml-1")}
                              aria-label="Abrir no Instagram"
                              title="Abrir no Instagram"
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Painel>
                )}
              </>
            )}
          </div>
        )}
      </AreaDeTrabalho>
    </div>
  );
}

const COLUNAS = "md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_16px]";

export default function AdminMetricas() {
  const { profile } = useAuth();
  const isStaff = ["admin", "manager", "design", "traffic"].includes(profile?.role || "");
  const { data: clients } = useClients();
  const { data: rows, isLoading, error, refetch } = useSocialMetricsWeekly();
  const { data: adsRows } = useAdsDaily(undefined, 30);
  const queryClient = useQueryClient();
  // Uma consulta só para a lista inteira, por CONTA: cada linha é uma conta.
  const { data: identidades } = useIdentidadesPorConta();
  const [collecting, setCollecting] = useState(false);
  const [search, setSearch] = useEstadoDaTela("metricas:busca", "", { validar: (v) => typeof v === "string" });
  // 16/10/2026: as contas e a saúde delas em abas na linha do título, uma por vez.
  const [abaDaLista, setAbaDaLista] = useEstadoDaTela<AbaDaLista>("metricas:aba-da-lista", "contas", {
    validar: (v) => v === "contas" || v === "saude",
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedClientId = searchParams.get("client") || "";
  const selectedAccountId = searchParams.get("account") || "";

  const clientNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of (clients || []) as any[]) {
      map.set(String(client.id), client.company_name || client.full_name || "Cliente");
    }
    return map;
  }, [clients]);

  /** Anúncios dos últimos 30 dias por cliente: uma leitura só para a lista. */
  const adsPorCliente = useMemo(() => {
    const mapa = new Map<string, AdsDaily[]>();
    for (const row of adsRows || []) {
      const lista = mapa.get(row.client_id) || [];
      lista.push(row);
      mapa.set(row.client_id, lista);
    }
    return mapa;
  }, [adsRows]);

  // Uma linha por CONTA de Instagram, não por cliente: agrupar por cliente
  // misturava as semanas de duas contas (500 x 53 virava "-89%").
  const byAccount = useMemo(() => {
    const porConta = agruparPorConta(rows);
    const nomeDe = (accountId: string, clientId: string) => {
      const user = identidades?.get(accountId)?.username;
      return `${clientNames.get(clientId) || ""} ${user ? "@" + user : ""}`;
    };
    return [...porConta.entries()].sort((a, b) =>
      nomeDe(a[0], a[1][0].client_id).localeCompare(nomeDe(b[0], b[1][0].client_id), "pt-BR"),
    );
  }, [rows, clientNames, identidades]);

  const filteredHubs = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return byAccount;
    return byAccount.filter(([accountId, list]) =>
      `${clientNames.get(list[0].client_id) || ""} ${identidades?.get(accountId)?.username || ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(term),
    );
  }, [byAccount, clientNames, identidades, search]);

  const openAccount = (clientId: string, accountId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("client", clientId);
    next.set("account", accountId);
    setSearchParams(next);
  };

  const refreshNow = async () => {
    setCollecting(true);
    try {
      const result = await collectSocialMetricsNow();
      toast.success(
        result.dispatched > 0
          ? `Coleta pedida à Meta (${result.dispatched} chamadas). Os números chegam em alguns minutos.`
          : "Tudo em dia: semanas e publicações já coletadas.",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["social-metrics-weekly"] }),
        queryClient.invalidateQueries({ queryKey: ["social-post-metrics"] }),
      ]);
    } catch (error: unknown) {
      toast.error((error as { message?: string })?.message || "Não foi possível atualizar agora.");
    } finally {
      setCollecting(false);
    }
  };

  if (!isStaff) {
    return (
      <div className="min-w-0 space-y-4">
        <CabecalhoDePagina titulo="Métricas" descricao="Esta área é da equipe." />
      </div>
    );
  }

  // O único "Atualizar" da tela (16/10/2026): só o ícone, o nome no title.
  const botaoAtualizar = (
    <BotaoDeIcone
      icone={<RefreshCw className={juntar(ICONE, collecting ? "animate-spin" : "")} aria-hidden="true" />}
      rotulo="Atualizar agora"
      dica={collecting ? "Pedindo coleta..." : undefined}
      onClick={refreshNow}
      disabled={collecting}
    />
  );

  // Link antigo só com ?client= continua abrindo: cai na primeira conta do cliente.
  const selectedHub = selectedClientId
    ? byAccount.find(([accountId, list]) =>
        list[0].client_id === selectedClientId && (!selectedAccountId || accountId === selectedAccountId))
    : undefined;
  const selectedRows = selectedHub?.[1] || [];

  if (selectedClientId && selectedHub) {
    return (
      <ClientMetricsDetail
        clientId={selectedClientId}
        accountId={selectedHub[0]}
        clientName={clientNames.get(selectedClientId) || "Cliente"}
        rows={selectedRows}
        adsRows={adsPorCliente.get(selectedClientId) || []}
        atualizar={botaoAtualizar}
      />
    );
  }

  const erroNaLeitura = error ? (
    <EstadoDeErro
      titulo="Não consegui ler as métricas."
      descricao={(error as { message?: string })?.message || "Erro desconhecido."}
      acao={
        <button type="button" onClick={() => refetch()} className={botao.secundario}>
          Tentar de novo
        </button>
      }
    />
  ) : null;

  return (
    <div className="min-w-0 space-y-4">
      <CabecalhoDePagina
        titulo="Métricas"
        descricao={
          isLoading && !rows
            ? "Carregando"
            : search.trim()
              ? `${filteredHubs.length} de ${byAccount.length} contas`
              : `${plural(byAccount.length, "conta", "contas")} de Instagram · coleta semanal`
        }
        ajuda="O Instagram de cada cliente, os anúncios somados e o conselho da Mesa. As abas ao lado do título trocam entre as contas e a saúde delas. O robô coleta sozinho toda semana; o ícone de atualizar apressa."
        aoLado={
          <Etapas
            soIcone
            rotulo="Partes das métricas"
            itens={[
              {
                valor: "contas",
                rotulo: "Contas de Instagram",
                icone: <BarChart3 className={ICONE} />,
                contador: byAccount.length,
                ajuda: "Uma linha por conta de Instagram: seguidores, alcance, interações e os anúncios somados do cliente nos últimos 30 dias. Toque numa conta para abrir o dossiê.",
              },
              { valor: "saude", rotulo: "Saúde das contas", icone: <HeartPulse className={ICONE} />, ajuda: AJUDA_DA_SAUDE },
            ]}
            valor={abaDaLista}
            onEscolher={(v) => setAbaDaLista(v as AbaDaLista)}
            className="min-w-0 flex-1"
          />
        }
        acoes={botaoAtualizar}
      />

      <AreaDeTrabalho key={`lista:${abaDaLista}`} memoriaDaRolagem={`metricas:lista:${abaDaLista}`} rotuloDoPrincipal="Métricas por conta">
        <div className="min-w-0 space-y-5">
          {abaDaLista === "contas" && erroNaLeitura}

          {/* A busca abre a lista (a linha do título é das abas). */}
          {abaDaLista === "contas" && byAccount.length > 6 && (
            <div className="flex min-w-0 items-center justify-end">
              <CampoDeBusca valor={search} onMudar={setSearch} placeholder="Buscar cliente ou @perfil" rotulo="Buscar cliente" className="w-40 sm:w-60" />
            </div>
          )}

          {abaDaLista !== "contas" ? null : isLoading && !rows ? (
            <Carregando rotulo="Carregando métricas" linhas={4} />
          ) : byAccount.length === 0 ? (
            error ? null : (
              <EstadoVazio
                icone={<TrendingUp className="h-5 w-5" />}
                titulo="Nenhuma métrica coletada ainda."
                descricao="O ícone de atualizar pede a coleta; depois o robô coleta toda semana."
              />
            )
          ) : (
            <>
              {filteredHubs.length === 0 ? (
                <EstadoVazio
                  compacto
                  titulo="Nenhum cliente com esse nome."
                  acao={
                    <button type="button" onClick={() => setSearch("")} className={botao.discreto}>
                      Limpar busca
                    </button>
                  }
                />
              ) : (
                <Painel semEspaco>
                  <div className={juntar("hidden gap-x-5 border-b border-border px-4 py-2 md:grid", COLUNAS)} aria-hidden="true">
                    <p className={texto.rotulo}>Conta</p>
                    <p className={juntar(texto.rotulo, "text-right")}>Seguidores</p>
                    <p className={juntar(texto.rotulo, "text-right")}>Alcance</p>
                    <p className={juntar(texto.rotulo, "text-right")}>Interações</p>
                    <p className={texto.rotulo}>Anúncios 30 dias</p>
                    <span />
                  </div>
                  <ul className="min-w-0 divide-y divide-border">
                    {filteredHubs.map(([accountId, list]) => {
                      const latest = list[0];
                      const clientId = latest.client_id;
                      const ads = resumoDosAnuncios(adsPorCliente.get(clientId) || []);
                      const temAds = ads.carteira.investido > 0;
                      const usuario = identidades?.get(accountId)?.username;
                      const numeros = [
                        { r: "Seguidores", v: latest.followers, d: weekDeltaPct(list, "followers") },
                        { r: "Alcance", v: latest.reach, d: weekDeltaPct(list, "reach") },
                        { r: "Interações", v: latest.total_interactions, d: weekDeltaPct(list, "total_interactions") },
                      ];
                      const textoAds = temAds
                        ? `${dinheiro(ads.carteira.investido)}${ads.resultado ? ` · ${ads.resultado}` : ""}`
                        : "sem anúncios";
                      return (
                        <li key={accountId} className="min-w-0">
                          <button
                            type="button"
                            onClick={() => openAccount(clientId, accountId)}
                            className={juntar(
                              "group flex w-full min-w-0 flex-wrap items-center px-4 py-3 text-left transition-colors hover:bg-muted/50 md:grid md:gap-x-5",
                              COLUNAS,
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            )}
                          >
                            <div className="flex min-w-0 flex-1 items-center">
                              {/* A marca antes do nome: o olho acha antes da palavra. */}
                              <LogoDoCliente
                                url={identidades?.get(accountId)?.profile_picture_url}
                                nome={clientNames.get(clientId)}
                                tamanho={32}
                                className="mr-2.5"
                              />
                              <div className="min-w-0">
                                <p className="truncate text-[13px] font-semibold text-foreground">{clientNames.get(clientId) || "Cliente"}</p>
                                <p className={juntar(texto.auxiliar, "truncate")}>
                                  {usuario ? `@${usuario} · ` : ""}
                                  semana {fmtWeek(latest)}
                                </p>
                              </div>
                            </div>
                            {numeros.map((k) => (
                              <div key={k.r} className="hidden min-w-0 text-right md:block">
                                <p className="truncate text-[13px] font-semibold tabular-nums text-foreground">{formatMetricNumber(k.v)}</p>
                                <DeltaBadge pct={k.d} />
                              </div>
                            ))}
                            <ChevronRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary md:order-last md:ml-0" aria-hidden="true" />
                            <p className={juntar(texto.auxiliar, "mt-1.5 basis-full truncate md:mt-0 md:basis-auto")}>
                              {/* No celular a linha de baixo diz de que número se trata; no computador, a coluna. */}
                              <span className="md:hidden">
                                Alcance {formatMetricNumber(latest.reach)} · </span>
                              <Megaphone className="mr-1 inline h-3 w-3 md:hidden" aria-hidden="true" />
                              <span className="md:hidden">Anúncios 30 dias: </span>
                              <span className={temAds ? "text-foreground" : ""}>{textoAds}</span>
                            </p>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </Painel>
              )}
            </>
          )}

          {/* A saúde das contas é a outra aba, DEPOIS da lista: diagnóstico é consulta, não abertura. */}
          {abaDaLista === "saude" && <SaudeDasContas />}
        </div>
      </AreaDeTrabalho>
    </div>
  );
}
