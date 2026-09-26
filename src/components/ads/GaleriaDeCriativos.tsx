import { useEffect, useMemo, useState } from "react";
import { X, ImageOff, Video, Megaphone } from "lucide-react";
import { CampoDeBusca } from "@/components/sistema";
import { EstadoVazio, Secao, SeletorCompacto, botao, foco, juntar, texto, useEstadoDaTela } from "@/components/sistema";

/**
 * Os criativos de um cliente, com a peça à vista e o número ao lado.
 *
 * A pergunta que esta tela responde, e que a de campanhas não responde:
 * campanha diz quanto se gastou; criativo diz QUAL arte fez o trabalho. É
 * a diferença entre "a campanha rendeu" e "este vídeo rendeu, aquela arte
 * não", e só a segunda dá o que fazer na semana seguinte.
 *
 * SOBRE A MINIATURA: o endereço vem da Meta e EXPIRA. Imagem que não
 * carrega aqui é normal, não é defeito, e por isso o lugar dela nunca fica
 * vazio: aparece o nome da peça sobre um fundo sólido. Um buraco branco na
 * grade faria qualquer pessoa achar que o painel quebrou.
 *
 * Sistema de design (26/09): seção sem caixa, filtros numa fileira, a
 * imagem manda no cartão (sem moldura), proporção por padding-bottom (o
 * Safari 11 não tem a propriedade de proporção) e a grade mostra um lote com "Ver mais" em vez de
 * uma caixa com rolagem própria (no celular ela prenderia o dedo).
 */

export interface CriativoDeAnuncio {
  ad_id: string;
  ad_name: string | null;
  campaign_id: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  video_id: string | null;
  titulo: string | null;
  corpo: string | null;
  effective_status: string | null;
  gasto: number;
  impressoes: number;
  cliques: number;
  cliques_no_link: number;
  maior_alcance: number;
  ctr: number | null;
  custo_no_link: number | null;
  dias_com_dado: number;
  campanha?: string | null;
}

const dinheiro = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const inteiro = (v: number) => v.toLocaleString("pt-BR");

/** Quantas peças por lote na grade (3 linhas de 4 no computador). */
const LOTE = 12;

function Miniatura({ c, grande }: { c: CriativoDeAnuncio; grande?: boolean }) {
  const [falhou, setFalhou] = useState(false);
  /*
   * A ARTE vem primeiro, nos dois tamanhos, e não só na tela cheia.
   *
   * `thumbnail_url` da Meta traz `p64x64` na própria URL: são 64 pixels.
   * Esticada num cartão de 230px vira um borrão, e foi isso que apareceu
   * na primeira versão. A `image_url` é a peça em tamanho real (conferi
   * uma delas: 697 por 697, servida pelo fbcdn sem bloqueio de origem).
   * A miniatura fica como reserva, para quando a arte não vier.
   */
  const src = c.image_url || c.thumbnail_url;

  if (!src || falhou) {
    return (
      <div
        className={juntar(
          "flex flex-col items-center justify-center bg-muted p-3 text-center",
          grande ? "h-[60vh] w-full" : "absolute inset-0",
        )}
      >
        <ImageOff className="mb-1.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <p className="line-clamp-3 text-[11px] leading-tight text-muted-foreground">
          {c.ad_name || "Peça sem nome"}
        </p>
        <p className="mt-1 text-[10.5px] text-muted-foreground/70">
          a imagem expirou na Meta
        </p>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={c.ad_name || "Criativo"}
      loading="lazy"
      onError={() => setFalhou(true)}
      /* O fbcdn devolve a imagem sem exigir origem, e mandar a nossa não
         acrescenta nada além de vazar de onde o painel está sendo aberto. */
      referrerPolicy="no-referrer"
      className={juntar(
        "bg-muted",
        grande ? "max-h-[60vh] w-auto object-contain" : "absolute inset-0 h-full w-full object-cover",
      )}
    />
  );
}

const ORDENS = [
  { id: "gasto", rotulo: "Maior gasto" },
  { id: "custo", rotulo: "Menor custo" },
  { id: "ctr", rotulo: "Maior CTR" },
] as const;

const RECORTES = [
  { id: "rodaram", rotulo: "Rodaram" },
  { id: "paradas", rotulo: "Paradas" },
  { id: "todas", rotulo: "Todas" },
] as const;

type Ordem = (typeof ORDENS)[number]["id"];

export default function GaleriaDeCriativos({
  criativos,
  periodoDias,
  chave = "geral",
}: {
  criativos: CriativoDeAnuncio[];
  periodoDias: number;
  /** Onde guardar filtros e ordem (o cliente): sair e voltar mantém o recorte. */
  chave?: string;
}) {
  const [aberto, setAberto] = useState<CriativoDeAnuncio | null>(null);
  const [ordem, setOrdem] = useEstadoDaTela<Ordem>(`criativos:${chave}:ordem`, "gasto", {
    validar: (v) => v === "gasto" || v === "custo" || v === "ctr",
  });
  const [busca, setBusca] = useEstadoDaTela(`criativos:${chave}:busca`, "", { validar: (v) => typeof v === "string" });
  const [campanhaFiltro, setCampanhaFiltro] = useEstadoDaTela(`criativos:${chave}:campanha`, "", { validar: (v) => typeof v === "string" });
  const [visiveis, setVisiveis] = useState(LOTE);
  /**
   * O filtro que resolve o problema real desta carteira.
   *
   * Metade das peças nunca rodou: na Verzelo, dezenove das trinta e
   * quatro. Elas PRECISAM aparecer em algum lugar, porque arte parada é
   * trabalho que não virou resultado, mas quem abriu a tela para decidir
   * verba está olhando as que rodaram. Por isso o padrão é "as que
   * rodaram", com o resto a um clique.
   */
  const [recorte, setRecorte] = useEstadoDaTela<"rodaram" | "paradas" | "todas">(`criativos:${chave}:recorte`, "rodaram", {
    validar: (v) => v === "rodaram" || v === "paradas" || v === "todas",
  });

  // Escape fecha. Quem abre uma imagem em tela cheia espera isso, e sem
  // ele a única saída é caçar o X com o mouse.
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(null);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  // Filtro novo começa do primeiro lote.
  useEffect(() => {
    setVisiveis(LOTE);
  }, [busca, campanhaFiltro, recorte, ordem, chave]);

  /* O total do período, para a grade ter um teto de leitura. Sem isto,
     quem abre a tela vê vinte cartões e não sabe se aquilo é muito ou
     pouco dinheiro. */
  const resumo = useMemo(() => {
    const comNumero = criativos.filter((c) => c.dias_com_dado > 0);
    const gasto = criativos.reduce((t, c) => t + c.gasto, 0);
    const cliquesNoLink = criativos.reduce((t, c) => t + c.cliques_no_link, 0);
    return {
      gasto,
      pecas_com_numero: comNumero.length,
      pecas_sem_numero: criativos.length - comNumero.length,
      cliques_no_link: cliquesNoLink,
      custo_medio: cliquesNoLink > 0 ? gasto / cliquesNoLink : null,
      // A peça que mais gastou é a que mais decide o resultado do mês, e é
      // a primeira coisa que alguém quer saber ao abrir a tela.
      maior: [...comNumero].sort((a, b) => b.gasto - a.gasto)[0] ?? null,
    };
  }, [criativos]);

  /* As campanhas presentes, para o seletor. Sai do próprio dado: campanha
     que não tem peça não aparece na lista, e assim ninguém filtra por algo
     que devolveria vazio. */
  const campanhas = useMemo(() => {
    const nomes = new Set<string>();
    for (const c of criativos) if (c.campanha) nomes.add(c.campanha);
    return [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [criativos]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return criativos.filter((c) => {
      if (recorte === "rodaram" && c.gasto <= 0) return false;
      if (recorte === "paradas" && c.gasto > 0) return false;
      if (campanhaFiltro && c.campanha !== campanhaFiltro) return false;
      if (!termo) return true;
      // A busca alcança o texto do anúncio também: quem procura "revitalização"
      // muitas vezes lembra da frase da peça, não do nome que a equipe deu.
      return [c.ad_name, c.campanha, c.titulo, c.corpo]
        .some((campo) => (campo || "").toLowerCase().includes(termo));
    });
  }, [criativos, busca, campanhaFiltro, recorte]);

  const ordenados = useMemo(() => {
    const lista = [...filtrados];
    if (ordem === "gasto") return lista.sort((a, b) => b.gasto - a.gasto);
    if (ordem === "ctr") return lista.sort((a, b) => (b.ctr ?? -1) - (a.ctr ?? -1));
    // Custo por clique: quem não tem custo vai para o fim, senão o "melhor"
    // do ranking seria justamente quem não gastou nada.
    return lista.sort((a, b) => {
      if (a.custo_no_link === null) return 1;
      if (b.custo_no_link === null) return -1;
      return a.custo_no_link - b.custo_no_link;
    });
  }, [filtrados, ordem]);

  const ajuda =
    "Qual arte fez o trabalho: gasto, cliques no link e custo de cada peça. O padrão mostra as que rodaram; as paradas ficam a um clique. Imagem que a Meta expirou aparece com o nome da peça. Toque numa peça para ver grande.";

  if (criativos.length === 0) {
    return (
      <Secao divisoria titulo="Criativos" descricao={`Últimos ${periodoDias} dias`} ajuda={ajuda}>
        <EstadoVazio
          compacto
          titulo="Nenhum criativo lido ainda."
          descricao='A leitura das peças vem junto com a das campanhas; "Atualizar agora" apressa a primeira.'
        />
      </Secao>
    );
  }

  const mostrados = ordenados.slice(0, visiveis);

  return (
    <Secao
      divisoria
      titulo="Criativos"
      descricao={
        <span className="block truncate tabular-nums">
          {ordenados.length} de {criativos.length} · últimos {periodoDias} dias
        </span>
      }
      ajuda={ajuda}
      acao={
        <SeletorCompacto
          rotulo="Ordenar criativos"
          opcoes={ORDENS.map((o) => ({ valor: o.id, rotulo: o.rotulo }))}
          valor={ordem}
          onEscolher={(v) => setOrdem(v as Ordem)}
        />
      }
    >
      <p className={juntar(texto.auxiliar, "mb-3 flex min-w-0 flex-wrap [&>*]:mr-4")}>
        <span>
          investido nas peças{" "}
          <strong className="font-semibold tabular-nums text-foreground">{dinheiro(resumo.gasto)}</strong>
        </span>
        <span>
          cliques no link{" "}
          <strong className="font-semibold tabular-nums text-foreground">{inteiro(resumo.cliques_no_link)}</strong>
        </span>
        {resumo.custo_medio !== null && (
          <span>
            custo médio{" "}
            <strong className="font-semibold tabular-nums text-foreground">{dinheiro(resumo.custo_medio)}</strong>
          </span>
        )}
        {resumo.maior && (
          <span className="min-w-0 max-w-full truncate">
            maior gasto:{" "}
            <strong className="font-semibold text-foreground">{resumo.maior.ad_name || "peça sem nome"}</strong>
          </span>
        )}
        {resumo.pecas_sem_numero > 0 && <span>{resumo.pecas_sem_numero} sem número no período</span>}
      </p>

      <div className="-m-1 mb-3 flex min-w-0 flex-wrap items-center [&>*]:m-1">
        <CampoDeBusca
          valor={busca}
          onMudar={setBusca}
          placeholder="Buscar por nome, campanha ou texto da peça"
          rotulo="Buscar criativo"
          className="min-w-0 flex-1 basis-full sm:basis-[240px]"
        />
        {campanhas.length > 1 && (
          <SeletorCompacto
            rotulo="Campanha"
            modo="lista"
            icone={<Megaphone className="h-3.5 w-3.5" />}
            opcoes={[{ valor: "", rotulo: "Todas as campanhas" }, ...campanhas.map((nome) => ({ valor: nome, rotulo: nome }))]}
            valor={campanhaFiltro}
            onEscolher={setCampanhaFiltro}
            className="max-w-[220px]"
          />
        )}
        <SeletorCompacto
          rotulo="Recorte dos criativos"
          opcoes={RECORTES.map((r) => ({ valor: r.id, rotulo: r.rotulo }))}
          valor={recorte}
          onEscolher={(v) => setRecorte(v as "rodaram" | "paradas" | "todas")}
        />
      </div>

      {ordenados.length === 0 ? (
        <EstadoVazio
          compacto
          titulo="Nada com esse recorte."
          descricao={
            recorte === "rodaram" && resumo.pecas_sem_numero > 0
              ? `Nenhuma peça com gasto aqui. Há ${resumo.pecas_sem_numero} parada(s) em "Paradas".`
              : "Tente outro termo, ou volte para \"Todas\"."
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 desk:grid-cols-6">
            {mostrados.map((c) => (
              <button
                key={c.ad_id}
                type="button"
                onClick={() => setAberto(c)}
                className={juntar("group min-w-0 rounded-md text-left", foco)}
              >
                <div className="relative overflow-hidden rounded-md bg-muted" style={{ paddingBottom: "100%" }}>
                  <Miniatura c={c} />
                  {c.video_id && (
                    <span className="absolute left-1.5 top-1.5 flex items-center rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      <Video className="mr-1 h-3 w-3" aria-hidden="true" /> vídeo
                    </span>
                  )}
                  {c.effective_status && c.effective_status !== "ACTIVE" && (
                    <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {c.effective_status.toLowerCase()}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 truncate text-[12.5px] font-medium text-foreground group-hover:text-primary">
                  {c.ad_name || "Peça sem nome"}
                </p>
                {c.campanha && (
                  <p className={juntar(texto.auxiliar, "truncate")}>{c.campanha}</p>
                )}
                {c.dias_com_dado === 0 ? (
                  <p className={juntar(texto.auxiliar, "mt-0.5")}>sem número no período</p>
                ) : (
                  <p className="mt-0.5 flex flex-wrap text-[11.5px] leading-4 tabular-nums [&>*]:mr-2">
                    <span className="font-semibold text-foreground">{dinheiro(c.gasto)}</span>
                    {c.ctr !== null && <span className="text-muted-foreground">CTR {c.ctr.toFixed(2)}%</span>}
                    {c.custo_no_link !== null && <span className="text-info">{dinheiro(c.custo_no_link)}/clique</span>}
                  </p>
                )}
              </button>
            ))}
          </div>
          {ordenados.length > mostrados.length && (
            <div className="mt-4 flex justify-center">
              <button type="button" onClick={() => setVisiveis((v) => v + LOTE)} className={botao.secundario}>
                Ver mais ({ordenados.length - mostrados.length})
              </button>
            </div>
          )}
        </>
      )}

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setAberto(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={aberto.ad_name || "Peça sem nome"}
            className="max-h-full w-full max-w-3xl overflow-y-auto overscroll-contain rounded-lg border border-border bg-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-border px-4 py-3">
              <div className="mr-3 min-w-0">
                <p className={juntar(texto.tituloSecao, "truncate")}>{aberto.ad_name || "Peça sem nome"}</p>
                <p className={juntar(texto.auxiliar, "truncate")}>
                  {aberto.campanha ? `${aberto.campanha} · ` : ""}
                  {aberto.effective_status?.toLowerCase() || "situação desconhecida"}
                  {aberto.dias_com_dado > 0 && ` · ${aberto.dias_com_dado} dias com número`}
                </p>
              </div>
              <button type="button" onClick={() => setAberto(null)} className={botao.icone} aria-label="Fechar">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex justify-center bg-muted">
              <Miniatura c={aberto} grande />
            </div>

            <div className="p-4">
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3">
                {[
                  { rotulo: "Gasto", valor: dinheiro(aberto.gasto), tom: "" },
                  { rotulo: "Impressões", valor: inteiro(aberto.impressoes), tom: "" },
                  { rotulo: "Maior alcance num dia", valor: inteiro(aberto.maior_alcance), tom: "" },
                  { rotulo: "Cliques", valor: inteiro(aberto.cliques), tom: "" },
                  { rotulo: "Cliques no link", valor: inteiro(aberto.cliques_no_link), tom: "text-info" },
                  {
                    rotulo: "Custo por clique no link",
                    valor: aberto.custo_no_link !== null ? dinheiro(aberto.custo_no_link) : "-",
                    tom: "text-success",
                  },
                ].map((n) => (
                  <div key={n.rotulo} className="min-w-0 bg-card px-3 py-2">
                    <dt className={juntar(texto.rotulo, "truncate")}>{n.rotulo}</dt>
                    <dd className={juntar("mt-0.5 truncate text-[15px] font-semibold tabular-nums", n.tom || "text-foreground")}>{n.valor}</dd>
                  </div>
                ))}
              </dl>

              {/* Alcance não soma, e dizer isso na tela evita que alguém
                  monte um relatório somando os dias e apresente um número
                  que nunca existiu. */}
              <p className={juntar(texto.auxiliar, "mt-2")}>
                O alcance mostrado é o maior dia do período, não a soma: a mesma pessoa em dois dias não são duas pessoas.
              </p>

              {(aberto.titulo || aberto.corpo) && (
                <div className="mt-3 rounded-md bg-muted/50 p-3">
                  {aberto.titulo && <p className="text-[13px] font-semibold text-foreground">{aberto.titulo}</p>}
                  {aberto.corpo && (
                    <p className="mt-1 whitespace-pre-line text-[12.5px] leading-5 text-muted-foreground">{aberto.corpo}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Secao>
  );
}
