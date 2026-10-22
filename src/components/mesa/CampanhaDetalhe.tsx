import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, CalendarCheck2, Copy, ChevronLeft, ClipboardList, ExternalLink, Images, LayoutGrid, LayoutList, Lightbulb, Loader2, MessageSquare, Music, Stamp, X } from "lucide-react";
import { toast } from "sonner";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import CampanhaConteudos from "./CampanhaConteudos";
import CampanhaReferencias, { MAX_REFERENCIAS, ReferenciasEscolhidas } from "./CampanhaReferencias";
import Etapas from "@/components/sistema/Etapas";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import {
  chaves,
  lerProposta,
  mesDaData,
  hojeIso,
  periodoCurto,
  salvarReferenciasDaCampanha,
  type Campanha,
} from "./mesaV4Api";
import { briefingEstaVazio } from "./mesaV4Api";
import { contarFormatos, sugestoesDaCampanha } from "./regrasDaCampanha";
import { FormatosDaCampanhaAberta } from "./CampanhaFormatos";
import { GerarCampanhaCompleta, usePecasDaCampanha } from "./CampanhaCompleta";
import CampanhaPecas from "./CampanhaPecas";
import CampanhaRevisao from "./CampanhaRevisao";
import CampanhaVisao from "./CampanhaVisao";
import CampanhaReferenciaPadrao from "./CampanhaReferenciaPadrao";
import CampanhaSugestoes from "./CampanhaSugestoes";
import CampanhaProdutos from "./CampanhaProdutos";
import { EditorDaIdeia, HistoricoDaCampanha, MercadoDaCampanha, ReescreverComercial } from "./CampanhaEditor";
import {
  MAX_IMAGENS_CAMPANHA,
  normalizarBriefing,
  normalizarImagensDaCampanha,
  normalizarPlanoDeImagens,
  planoDesatualizado,
  trocarCampanhaNoCache,
} from "./campanhasApi";
import CampanhaBriefing from "./CampanhaBriefing";
import { ImagensDaCampanhaSalvas } from "./CampanhaImagens";
import CampanhaPlanoDeImagens from "./CampanhaPlanoDeImagens";
import CampanhaNasMesas from "./CampanhaNasMesas";
import CampanhaSelo from "./CampanhaSelo";
import CampanhaTrilha from "./CampanhaTrilha";
import { trilhaSugeridaDaCampanha } from "./trilhaDaCampanhaApi";
import { rotuloDoTipo, tipoDaCampanha } from "../../../supabase/functions/_shared/tipos-de-campanha";

/**
 * A campanha aberta, no centro da aba. 21/10/2026 (dono: "a área de campanha de maneira fácil, completa e
 * inteligente"): um caminho guiado em etapas (Etapas soIcone), com a campanha pronta na frente:
 *   Campanha (capa, números, linha do tempo e grade das artes, exportar) ·
 *   1 Ideia (pedido, objetivo, conceito e sugestões) · 2 Briefing (período, oferta, público, tom, canais,
 *   imagens e referências) · 3 Identidade (selo e paleta) · 4 Série (os conteúdos por fase e o plano de
 *   imagens) · 5 Peças (cada conteúdo gerado pelo Estúdio) · 6 Revisão e agenda (Jev, conflitos, aprovar).
 * "Gerar campanha completa" (CampanhaCompleta.tsx) faz o que falta da 3 à 5 com o custo total antes.
 * Os ajustes finos seguem com o agente da campanha, ao lado.
 */

export const ROTULO_DO_ESTADO: Record<string, string> = { planejada: "planejada", gravada: "gravada", encerrada: "encerrada" };

export function SeloDoEstado({ estado }: { estado: string }) {
  const cor = estado === "gravada" ? "bg-success/15 text-success" : estado === "encerrada" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${cor}`}>{ROTULO_DO_ESTADO[estado] || estado}</span>;
}

// ------------------------------------------------------------------ seções

type IdDaSecao = "visao" | "ideia" | "briefing" | "identidade" | "serie" | "pecas" | "trilha" | "revisao";

/** O caminho da campanha, na ordem: a campanha pronta e as seis etapas. Um ícone por etapa. */
const ORDEM_DAS_SECOES: IdDaSecao[] = ["visao", "ideia", "briefing", "identidade", "serie", "pecas", "trilha", "revisao"];

export const NOMES_DAS_SECOES: Record<IdDaSecao, string> = {
  visao: "Campanha",
  ideia: "Ideia",
  briefing: "Briefing",
  identidade: "Identidade",
  serie: "Série de conteúdos",
  pecas: "Peças",
  trilha: "Trilha e efeitos",
  revisao: "Revisão e agenda",
};

const ICONES_DAS_SECOES: Record<IdDaSecao, ReactNode> = {
  visao: <LayoutGrid className="h-4 w-4" />,
  ideia: <Lightbulb className="h-4 w-4" />,
  briefing: <ClipboardList className="h-4 w-4" />,
  identidade: <Stamp className="h-4 w-4" />,
  serie: <LayoutList className="h-4 w-4" />,
  pecas: <Images className="h-4 w-4" />,
  trilha: <Music className="h-4 w-4" />,
  revisao: <CalendarCheck2 className="h-4 w-4" />,
};

/** Subtítulo de uma parte dentro da etapa (sem caixa: título e espaço). */
function Parte({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="min-w-0 border-t border-border pt-4" aria-label={titulo}>
      <h3 className={juntar(texto.rotulo, "mb-2")}>{titulo}</h3>
      {children}
    </section>
  );
}

/** A aba aberta fica lembrada no navegador (vale para todas as campanhas). */
const CHAVE_DA_ABA = "mesa:campanha:aba";

function lerAba(): IdDaSecao {
  try {
    const v = window.localStorage.getItem(CHAVE_DA_ABA) || "";
    return ORDEM_DAS_SECOES.indexOf(v as IdDaSecao) >= 0 ? (v as IdDaSecao) : "visao";
  } catch {
    return "visao";
  }
}

function gravarAba(aba: IdDaSecao) {
  try {
    window.localStorage.setItem(CHAVE_DA_ABA, aba);
  } catch {
    /* sem armazenamento: vale só nesta visita */
  }
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={texto.rotulo}>{rotulo}</dt>
      <dd className="mt-0.5 text-[13px] leading-relaxed [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ detalhe

export default function CampanhaDetalhe({
  campanha,
  projetoSugerido,
  onVoltar,
  onAbrirNoEstudio,
  onPedirAoAgente,
  onAbrirAgente,
  onAbrirArteRapida,
  onAbrirStories,
  onDuplicar,
}: {
  /** 22/10/2026: "Nova campanha a partir desta" (a estrutura, com outro tema). */
  onDuplicar?: () => void;
  /** Abre a peça (arte rápida) no Estúdio. */
  onAbrirArteRapida?: (trabalhoId: string) => void;
  /** 22/10/2026: abre a sequência de stories da campanha na aba Stories. */
  onAbrirStories?: (sequenciaId: string) => void;
  campanha: Campanha;
  projetoSugerido?: string | null;
  /** Celular: volta para a lista. */
  onVoltar?: () => void;
  onAbrirNoEstudio?: (taskId: string, mes: string) => void;
  /** Leva um texto para o campo do agente da campanha (e abre a gaveta, se houver). */
  onPedirAoAgente?: (texto: string) => void;
  /** Tela menor: o agente fica numa gaveta, aberta por este botão. */
  onAbrirAgente?: () => void;
}) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [galeria, setGaleria] = useState(false);
  const [aba, setAba] = useState<IdDaSecao>(lerAba);
  const [referencias, setReferencias] = useState<string[]>(campanha.referencias_ids || []);
  const [salvandoRefs, setSalvandoRefs] = useState(0);
  const [salvandoImagens, setSalvandoImagens] = useState(0);
  const fila = useRef<Promise<void>>(Promise.resolve());
  /** Última lista gravada no banco e a última pedida (a última vence). */
  const refsSalvas = useRef<string[]>(campanha.referencias_ids || []);
  const refsPedidas = useRef<string[] | null>(null);

  useEffect(() => {
    setReferencias(campanha.referencias_ids || []);
    refsSalvas.current = campanha.referencias_ids || [];
    setGaleria(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campanha.id]);

  const proposta = useQuery({
    queryKey: chaves.proposta(campanha.proposta_id || ""),
    enabled: !!campanha.proposta_id,
    queryFn: () => lerProposta(campanha.proposta_id as string),
  });

  const { pecas, carregando: lendoPecas } = usePecasDaCampanha(campanha, proposta.data);

  const escolher = (s: IdDaSecao) => {
    setAba(s);
    gravarAba(s);
  };

  const id = campanha.identidade || {};
  const paleta = (id.paleta_apoio || []).filter((c) => c && c.hex);
  const selo = id.selo || {};
  const gravada = campanha.status === "gravada";
  const itens = proposta.data ? proposta.data.itens || [] : [];
  const itensOrdenados = itens.slice().sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));
  const primeiraTarefa = itensOrdenados.find((i) => !!i.task_id);
  const corDoSelo = paleta.length ? String(paleta[0].hex) : undefined;

  /** Grava a lista inteira; as gravações seguem em fila, a última vence. */
  const gravarReferencias = (lista: string[]) => {
    setReferencias(lista);
    refsPedidas.current = lista;
    trocarCampanhaNoCache(queryClient, clientId, { ...campanha, referencias_ids: lista });
    setSalvandoRefs((n) => n + 1);
    fila.current = fila.current.then(async () => {
      try {
        await salvarReferenciasDaCampanha(campanha.id, lista);
        refsSalvas.current = lista;
      } catch (e) {
        toast.error("Referências não salvas", { description: textoDoErro(e) });
        // A tela volta ao que está gravado (se não veio outra escolha depois,
        // que ainda vai tentar gravar): antes ficava mostrando a lista que falhou.
        if (refsPedidas.current === lista) {
          setReferencias(refsSalvas.current);
          trocarCampanhaNoCache(queryClient, clientId, { ...campanha, referencias_ids: refsSalvas.current });
        }
        void queryClient.invalidateQueries({ queryKey: chaves.campanhas(clientId) });
      } finally {
        setSalvandoRefs((n) => n - 1);
      }
    });
  };

  const pedir = (texto: string) => {
    if (onPedirAoAgente) onPedirAoAgente(texto);
  };

  const briefing = normalizarBriefing(campanha.briefing);
  const produtosEmFoco = briefing.produtos.map((p) => p.nome).join(", ");
  const imagensDaCampanha = normalizarImagensDaCampanha(campanha.imagens);
  const plano = normalizarPlanoDeImagens(campanha.plano_imagens);
  const planoVelho = planoDesatualizado(plano, imagensDaCampanha, proposta.data ? itens : null);
  const planoResumo = !plano
    ? "ainda não montado"
    : planoVelho
      ? "desatualizado"
      : `${plano.pecas.filter((p) => !!p.imagem_id).length} lâmina(s) com foto`;

  const naAgenda = itens.filter((i) => !!i.task_id).length;
  const conteudosResumo = proposta.isLoading
    ? "lendo…"
    : itens.length
      ? `${itens.length} conteúdo(s)${naAgenda ? `, ${naAgenda} na agenda` : ""}`
      : "nenhum ainda";

  const deArte = pecas.filter((p) => p.estado !== "outra_mesa");
  const prontas = deArte.filter((p) => p.estado === "pronta" || p.estado === "na_agenda").length;
  const naAgendaPecas = deArte.filter((p) => p.estado === "na_agenda" || p.estado === "no_roteiro").length;
  // O resumo de cada etapa vai para a dica (title); a feita ganha o check.
  const resumos: Record<IdDaSecao, string> = {
    visao: periodoCurto(campanha.periodo_inicio, campanha.periodo_fim),
    ideia: campanha.objetivo || "",
    briefing: produtosEmFoco || briefing.oferta || "",
    identidade: campanha.selo_path ? "com selo" : "sem selo ainda",
    serie: conteudosResumo,
    pecas: deArte.length ? `${prontas} de ${deArte.length} prontas` : "",
    trilha: trilhaSugeridaDaCampanha(campanha.briefing)?.titulo || "",
    revisao: deArte.length ? `${naAgendaPecas} de ${deArte.length} na agenda` : "",
  };
  const feitas: Record<IdDaSecao, boolean> = {
    visao: false,
    ideia: !!campanha.objetivo || !!campanha.conceito,
    briefing: !briefingEstaVazio(briefing),
    identidade: !!campanha.selo_path,
    serie: itens.length > 0,
    pecas: deArte.length > 0 && prontas === deArte.length,
    trilha: !!trilhaSugeridaDaCampanha(campanha.briefing),
    revisao: deArte.length > 0 && naAgendaPecas === deArte.length,
  };
  const abas = ORDEM_DAS_SECOES.map((s) => ({
    valor: s,
    rotulo: NOMES_DAS_SECOES[s],
    icone: ICONES_DAS_SECOES[s],
    feita: feitas[s],
    dica: resumos[s] ? `${NOMES_DAS_SECOES[s]} · ${resumos[s]}` : NOMES_DAS_SECOES[s],
  }));
  const sugestoes = sugestoesDaCampanha(campanha, pecas, hojeIso());

  return (
    <div className="min-w-0 space-y-3">
      {onVoltar && (
        <button type="button" onClick={onVoltar} className={botao.icone} aria-label="Voltar às campanhas" title="Voltar às campanhas">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      )}

      {/* Cabeçalho aberto (sem caixa): selo pequeno, nome, período, estado e o próximo passo. */}
      <header className="flex min-w-0 items-center pb-1">
        <span
          className="mr-3 flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/60 text-[15px] font-semibold"
          style={!campanha.selo_path && corDoSelo ? { color: corDoSelo } : undefined}
        >
          {campanha.selo_path ? (
            <ImagemDaMesa caminho={campanha.selo_path} alt="" className="h-full w-full !object-contain p-0.5" />
          ) : (
            (campanha.nome || "C").charAt(0).toUpperCase()
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center">
            {/* Título numa linha (28/09); inteiro no title. */}
            <h2 className={juntar(texto.tituloPagina, "mr-2 min-w-0 truncate")} title={campanha.nome}>{campanha.nome}</h2>
            {tipoDaCampanha(campanha.identidade) && (
              <span className="mr-1.5 shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium" data-tipo={tipoDaCampanha(campanha.identidade) || ""}>
                {rotuloDoTipo(tipoDaCampanha(campanha.identidade))}
              </span>
            )}
            <SeloDoEstado estado={campanha.status} />
          </div>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {periodoCurto(campanha.periodo_inicio, campanha.periodo_fim)}
            {itens.length ? ` · ${itens.length} conteúdo(s)` : ""}
            {campanha.custo_usd ? ` · ${usd(Number(campanha.custo_usd))}` : ""}
          </p>
        </div>
        <div className="ml-2 flex shrink-0 items-center">
          {onDuplicar && (
            <button type="button" className={botao.icone} onClick={onDuplicar} aria-label="Nova campanha a partir desta" title="Nova campanha a partir desta (mesma estrutura, outro tema)">
              <Copy className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {onAbrirAgente && (
            <button type="button" className={botao.icone} onClick={onAbrirAgente} aria-label="Conversar com o agente" title="Conversar com o agente da campanha">
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {/* Com os conteúdos abertos, a barra deles já tem "Abrir no Estúdio". */}
          {gravada && primeiraTarefa && onAbrirNoEstudio && aba !== "serie" && (
            <button
              type="button"
              className={juntar(botao.icone, "ml-0.5 text-primary hover:text-primary")}
              aria-label="Abrir no Estúdio"
              title="Abrir no Estúdio"
              onClick={() => onAbrirNoEstudio(primeiraTarefa.task_id as string, mesDaData(primeiraTarefa.data))}
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      {/* Frente AE: a campanha ligada às mesas (usar nas mesas, levar para, tipo e a base). */}
      <CampanhaNasMesas campanha={campanha} />

      {/* 21/10/2026: o que falta da campanha completa (selo e peças), com o custo total antes e o andamento. */}
      <GerarCampanhaCompleta campanha={campanha} pecas={pecas} carregando={lendoPecas || (!!campanha.proposta_id && proposta.isLoading)} />

      {/* 22/10/2026: sugestões a partir do que existe (fase, fim, dias sem peça, anúncio, datas); um clique vira pedido ao agente. */}
      {onPedirAoAgente && <CampanhaSugestoes campanha={campanha} onPedir={(t) => pedir(t)} />}

      {/* 16/10/2026 (dono: "tem muito texto" e "seções empilhadas viram abas em ícone no topo"):
          as oito seções viraram abas em ícone; a aberta mostra o nome e o resumo curto vai no title. */}
      <Etapas soIcone rotulo="Partes da campanha" itens={abas} valor={aba} onEscolher={(v) => escolher(v as IdDaSecao)} className="-mx-1 border-b border-border pb-1" />

      <div className="min-w-0 space-y-4 pt-1" role="region" aria-label={NOMES_DAS_SECOES[aba]}>
        {aba === "visao" && <CampanhaVisao campanha={campanha} pecas={pecas} onAbrirArteRapida={onAbrirArteRapida} onAbrirStories={onAbrirStories} />}

        {/* 1. Ideia: o pedido, o objetivo, o conceito e as sugestões pela janela e pela série. */}
        {aba === "ideia" && (
          <>
            {/* 22/10/2026: editar à mão e reescrever no tom comercial, sem começar outra campanha. */}
            <div className="flex min-w-0 items-center justify-end">
              <ReescreverComercial campanha={campanha} pecas={pecas.length} onAbrirAgente={onAbrirAgente} />
              <EditorDaIdeia campanha={campanha} />
            </div>
            <dl className="grid min-w-0 grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Linha rotulo="Nome">{campanha.nome}</Linha>
              <Linha rotulo="Período">{periodoCurto(campanha.periodo_inicio, campanha.periodo_fim)}</Linha>
              {campanha.objetivo && (
                <div className="sm:col-span-2">
                  <Linha rotulo="Objetivo">{campanha.objetivo}</Linha>
                </div>
              )}
              {campanha.conceito && (
                <div className="sm:col-span-2">
                  <Linha rotulo="Conceito">{campanha.conceito}</Linha>
                </div>
              )}
              {campanha.pedido && (
                <div className="sm:col-span-2">
                  <Linha rotulo="Pedido original"><span className="whitespace-pre-line text-muted-foreground">{campanha.pedido}</span></Linha>
                </div>
              )}
            </dl>
            <Parte titulo="Formatos">
              <FormatosDaCampanhaAberta campanha={campanha} atual={contarFormatos(pecas)} />
            </Parte>
            {sugestoes.length > 0 && (
              <Parte titulo="Situação">
                <ul className="list-disc space-y-1 pl-4 text-[13px]" aria-label="Situação da campanha">
                  {sugestoes.map((t) => <li key={t}>{t}</li>)}
                </ul>
              </Parte>
            )}
            <Parte titulo="Histórico de versões">
              <HistoricoDaCampanha campanha={campanha} />
            </Parte>
          </>
        )}

        {/* 2. Briefing: período, produto, oferta, mensagem, público, provas, tom, CTA e canais; imagens e referências. */}
        {aba === "briefing" && (
          <>
            <CampanhaBriefing campanha={campanha} onPedirAoAgente={onPedirAoAgente ? pedir : undefined} />
            <Parte titulo="Produtos">
              <CampanhaProdutos campanha={campanha} />
            </Parte>
            <Parte titulo="O que o mercado está fazendo">
              <MercadoDaCampanha campanha={campanha} />
            </Parte>
            <Parte titulo={`Imagens da campanha · ${imagensDaCampanha.length} de ${MAX_IMAGENS_CAMPANHA}`}>
              {salvandoImagens > 0 && <Loader2 className="mb-2 h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Salvando as imagens" />}
              <ImagensDaCampanhaSalvas campanha={campanha} onSalvando={setSalvandoImagens} />
            </Parte>
            <Parte titulo={`Referências · ${referencias.length} de ${MAX_REFERENCIAS}`}>
              <div className="mb-2 flex min-w-0 items-center justify-end">
                {salvandoRefs > 0 && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Salvando" />}
                <button
                  type="button"
                  className={juntar(botao.icone, galeria && "bg-muted text-foreground")}
                  aria-expanded={galeria}
                  aria-label={galeria ? "Fechar a galeria de referências" : "Escolher referências"}
                  title={galeria ? "Fechar a galeria" : "Escolher referências"}
                  onClick={() => setGaleria((v) => !v)}
                >
                  {galeria ? <X className="h-4 w-4" aria-hidden="true" /> : <BookmarkPlus className="h-4 w-4" aria-hidden="true" />}
                </button>
              </div>
              {galeria ? (
                <CampanhaReferencias valor={referencias} onChange={gravarReferencias} />
              ) : (
                <ReferenciasEscolhidas ids={referencias} onTirar={(rid) => gravarReferencias(referencias.filter((x) => x !== rid))} vazio="Nenhuma escolhida." />
              )}
            </Parte>
          </>
        )}

        {/* 3. Identidade: o selo (4 caminhos, Melhorar, versões) e a identidade do tema com a paleta. */}
        {aba === "identidade" && (
          <>
            {/* 22/10/2026: a referência da campanha (1 a 3 posts) vira o padrão visual de todas as peças e do selo. */}
            <CampanhaReferenciaPadrao campanha={campanha} pecas={pecas} />
            <Parte titulo="Selo">
              <CampanhaSelo campanha={campanha} />
            </Parte>
            <Parte titulo="Identidade do tema">
              <dl className="min-w-0 space-y-3.5">
                {id.tema_visual && <Linha rotulo="Tema visual">{id.tema_visual}</Linha>}
                {paleta.length > 0 && (
                  <div className="min-w-0">
                    <dt className={texto.rotulo}>Paleta da campanha</dt>
                    <dd className="mt-1.5 flex flex-wrap">
                      {paleta.map((c, i) => (
                        <span key={`${c.hex}-${i}`} className="mb-2 mr-3 inline-flex min-w-0 items-center">
                          <span className="mr-2 inline-block h-9 w-9 shrink-0 rounded-lg border border-border" style={{ backgroundColor: c.hex }} />
                          <span className="min-w-0">
                            {c.nome && <span className="block text-[12px] font-medium [overflow-wrap:anywhere]">{c.nome}</span>}
                            <span className="block font-mono text-[11px] uppercase text-muted-foreground">{c.hex}</span>
                          </span>
                        </span>
                      ))}
                    </dd>
                  </div>
                )}
                {id.tipografia && <Linha rotulo="Tipografia">{id.tipografia}</Linha>}
                {id.elementos && <Linha rotulo="Elementos">{id.elementos}</Linha>}
                {id.tom && <Linha rotulo="Tom">{id.tom}</Linha>}
                {(selo.texto || selo.descricao) && (
                  <Linha rotulo="Selo">
                    {selo.texto && <strong className="font-medium">{selo.texto}</strong>}
                    {selo.texto && selo.descricao ? ". " : ""}
                    {selo.descricao}
                  </Linha>
                )}
                {!id.tema_visual && !paleta.length && !id.tipografia && !id.elementos && !id.tom && (
                  <p className="text-[12px] text-muted-foreground">Sem identidade ainda.</p>
                )}
              </dl>
            </Parte>
          </>
        )}

        {/* 4. Série: gerar na hora, editar, escolher e mandar para a agenda; o plano de imagens embaixo. */}
        {aba === "serie" && (
          <>
            <CampanhaConteudos
              campanha={campanha}
              proposta={proposta.data || null}
              carregando={!!campanha.proposta_id && proposta.isLoading}
              erro={proposta.isError ? proposta.error : null}
              projetoSugerido={projetoSugerido || null}
              onAbrirNoEstudio={onAbrirNoEstudio}
              onPedirAoAgente={onPedirAoAgente ? pedir : undefined}
              temasComPeca={pecas.filter((p) => !!p.trabalho).map((p) => p.item.tema_id || "").filter(Boolean)}
            />
            <Parte titulo={`Plano de imagens · ${planoResumo}`}>
              <CampanhaPlanoDeImagens campanha={campanha} itens={proposta.data ? itens : campanha.proposta_id ? null : []} />
            </Parte>
          </>
        )}

        {/* 5. Peças: cada conteúdo gerado pelo Estúdio, com a identidade da campanha. */}
        {aba === "pecas" && <CampanhaPecas campanha={campanha} pecas={pecas} carregando={lendoPecas} onAbrirArteRapida={onAbrirArteRapida} onAbrirStories={onAbrirStories} />}

        {/* 22/10/2026: trilha sem voz e efeitos do tema (ElevenLabs), escolhida vai para o briefing e Arquivos. */}
        {aba === "trilha" && <CampanhaTrilha campanha={campanha} />}

        {/* 6. Revisão e agenda: Jev, conflitos com a agenda, aprovar e levar pelo fluxo de sempre. */}
        {aba === "revisao" && <CampanhaRevisao campanha={campanha} proposta={proposta.data || null} pecas={pecas} onAbrirArteRapida={onAbrirArteRapida} />}
      </div>
    </div>
  );
}
