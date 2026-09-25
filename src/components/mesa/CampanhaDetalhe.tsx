import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ExternalLink, Loader2, MessageSquare, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { Ampliar } from "./Ampliar";
import { AvisoDeErro, BotaoComCusto } from "./Custo";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import CampanhaConteudos from "./CampanhaConteudos";
import CampanhaReferencias, { MAX_REFERENCIAS, ReferenciasEscolhidas } from "./CampanhaReferencias";
import { Cronometro } from "./Cronometro";
import {
  campanhaSelo,
  chaves,
  lerProposta,
  mesDaData,
  partesDoSelo,
  periodoCurto,
  salvarReferenciasDaCampanha,
  type Campanha,
} from "./mesaV4Api";
import {
  aplicarRespostaDaCampanha,
  marcarPedidoDaCampanha,
  MAX_IMAGENS_CAMPANHA,
  normalizarBriefing,
  normalizarImagensDaCampanha,
  normalizarPlanoDeImagens,
  planoDesatualizado,
  trocarCampanhaNoCache,
  usePedidoDaCampanha,
} from "./campanhasApi";
import CampanhaBriefing from "./CampanhaBriefing";
import { ImagensDaCampanhaSalvas } from "./CampanhaImagens";
import CampanhaPlanoDeImagens from "./CampanhaPlanoDeImagens";

/**
 * A campanha aberta, no centro da aba: seções claras e recolhíveis (visão
 * geral, identidade do tema com o selo grande, referências e conteúdos). Os
 * ajustes são pedidos ao agente da campanha, ao lado; aqui ficam as ações
 * diretas: gerar os conteúdos na hora, editar cada um, escolher e mandar para
 * a agenda (CampanhaConteudos.tsx), desenhar o selo, escolher referências e
 * abrir no Estúdio.
 */

export const ROTULO_DO_ESTADO: Record<string, string> = { planejada: "planejada", gravada: "gravada", encerrada: "encerrada" };

export function SeloDoEstado({ estado }: { estado: string }) {
  const cor = estado === "gravada" ? "bg-success/15 text-success" : estado === "encerrada" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${cor}`}>{ROTULO_DO_ESTADO[estado] || estado}</span>;
}

// ------------------------------------------------------------------ seções

type IdDaSecao = "visao" | "briefing" | "imagens" | "plano" | "identidade" | "referencias" | "conteudos";

const CHAVE_DAS_SECOES = "mesa:campanha:secoes-fechadas";

function lerFechadas(): IdDaSecao[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(CHAVE_DAS_SECOES) || "[]");
    return Array.isArray(v) ? (v.map(String) as IdDaSecao[]) : [];
  } catch {
    return [];
  }
}

function gravarFechadas(lista: IdDaSecao[]) {
  try {
    window.localStorage.setItem(CHAVE_DAS_SECOES, JSON.stringify(lista));
  } catch {
    /* sem armazenamento: vale só nesta visita */
  }
}

function Secao({
  titulo,
  resumo,
  aberta,
  onAlternar,
  acao,
  children,
}: {
  titulo: string;
  resumo?: ReactNode;
  aberta: boolean;
  onAlternar: () => void;
  acao?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card">
      <div className="flex min-w-0 items-center px-4 py-3 sm:px-5">
        <button type="button" onClick={onAlternar} aria-expanded={aberta} className="flex min-w-0 flex-1 items-center text-left">
          <ChevronDown className={`mr-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${aberta ? "" : "-rotate-90"}`} />
          <span className="mr-2 shrink-0 text-[13.5px] font-semibold">{titulo}</span>
          {resumo && <span className="min-w-0 truncate text-[12px] text-muted-foreground">{resumo}</span>}
        </button>
        {acao && <span className="ml-2 flex shrink-0 items-center">{acao}</span>}
      </div>
      {aberta && <div className="min-w-0 border-t border-border px-4 pb-4 pt-3.5 sm:px-5">{children}</div>}
    </section>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
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
}: {
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
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  // Selo em desenho guardado fora do componente (chave "selo:<id>"): trocar de
  // campanha e voltar não libera um segundo desenho pago no meio do primeiro.
  const seloEmCurso = usePedidoDaCampanha(`selo:${campanha.id}`);
  const seloDesde = seloEmCurso ? seloEmCurso.desde : null;
  const [seloAberto, setSeloAberto] = useState(false);
  const [galeria, setGaleria] = useState(false);
  const [fechadas, setFechadas] = useState<IdDaSecao[]>(lerFechadas);
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

  const aberta = (s: IdDaSecao) => fechadas.indexOf(s) < 0;
  const alternar = (s: IdDaSecao) => {
    const nova = aberta(s) ? fechadas.concat([s]) : fechadas.filter((x) => x !== s);
    setFechadas(nova);
    gravarFechadas(nova);
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

  const desenharSelo = async () => {
    const chaveDoSelo = `selo:${campanha.id}`;
    marcarPedidoDaCampanha(chaveDoSelo, { mensagem: "selo", desde: Date.now() });
    try {
      return await campanhaSelo(campanha.id);
    } finally {
      marcarPedidoDaCampanha(chaveDoSelo, null);
    }
  };

  const pedir = (texto: string) => {
    if (onPedirAoAgente) onPedirAoAgente(texto);
  };

  const botaoDoSelo = (
    <BotaoComCusto
      rotulo={<><Sparkles className="mr-1.5 h-3.5 w-3.5" />{campanha.selo_path ? "Desenhar de novo" : "Desenhar selo"}</>}
      titulo="Selo da campanha"
      descricao="O gerador de imagem desenha o selo (logo do tema) com o texto e as cores da campanha."
      partes={() => partesDoSelo(catalogo)}
      executar={desenharSelo}
      aoConcluir={(data) => aplicarRespostaDaCampanha(queryClient, clientId, data)}
      variant={campanha.selo_path ? "outline" : "default"}
      disabled={seloDesde !== null}
      className="h-8"
    />
  );

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

  return (
    <div className="min-w-0 space-y-3">
      {onVoltar && (
        <button type="button" onClick={onVoltar} className="inline-flex items-center text-[12.5px] text-muted-foreground hover:text-foreground">
          <ChevronLeft className="mr-0.5 h-4 w-4" /> Campanhas
        </button>
      )}

      {/* Cabeçalho: selo pequeno, nome, período, estado e o próximo passo. */}
      <header className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="mb-3 flex min-w-0 flex-1 items-center sm:mb-0">
          <span
            className="mr-3 flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background text-[16px] font-semibold"
            style={!campanha.selo_path && corDoSelo ? { color: corDoSelo } : undefined}
          >
            {campanha.selo_path ? (
              <ImagemDaMesa caminho={campanha.selo_path} alt="" className="h-full w-full !object-contain p-0.5" />
            ) : (
              (campanha.nome || "C").charAt(0).toUpperCase()
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center">
              <h2 className="mr-2 min-w-0 text-[17px] font-semibold leading-snug [overflow-wrap:anywhere]">{campanha.nome}</h2>
              <SeloDoEstado estado={campanha.status} />
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">
              {periodoCurto(campanha.periodo_inicio, campanha.periodo_fim)}
              {itens.length ? ` · ${itens.length} conteúdo(s)` : ""}
              {campanha.custo_usd ? ` · ${usd(Number(campanha.custo_usd))}` : ""}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center sm:ml-3">
          {onAbrirAgente && (
            <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8 sm:mb-0" onClick={onAbrirAgente}>
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" /> Conversar com o agente
            </Button>
          )}
          {/* Com os conteúdos abertos, a barra deles já tem "Abrir no Estúdio". */}
          {gravada && primeiraTarefa && onAbrirNoEstudio && !aberta("conteudos") && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mb-1 h-8 text-primary sm:mb-0"
              onClick={() => onAbrirNoEstudio(primeiraTarefa.task_id as string, mesDaData(primeiraTarefa.data))}
            >
              Abrir no Estúdio <ExternalLink className="ml-1 h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </header>

      {/* Visão geral. */}
      <Secao titulo="Visão geral" resumo={campanha.objetivo || undefined} aberta={aberta("visao")} onAlternar={() => alternar("visao")}>
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
              <Linha rotulo="Pedido original"><span className="text-muted-foreground">{campanha.pedido}</span></Linha>
            </div>
          )}
        </dl>
      </Secao>

      {/* Conteúdos logo depois da visão geral: gerar na hora, editar, escolher e mandar para a agenda. */}
      <Secao titulo="Conteúdos" resumo={conteudosResumo} aberta={aberta("conteudos")} onAlternar={() => alternar("conteudos")}>
        <CampanhaConteudos
          campanha={campanha}
          proposta={proposta.data || null}
          carregando={!!campanha.proposta_id && proposta.isLoading}
          erro={proposta.isError ? proposta.error : null}
          projetoSugerido={projetoSugerido || null}
          onAbrirNoEstudio={onAbrirNoEstudio}
          onPedirAoAgente={onPedirAoAgente ? pedir : undefined}
        />
      </Secao>

      {/* Briefing: produto em foco, oferta, mensagem, público, provas, tom e CTA. */}
      <Secao titulo="Briefing" resumo={produtosEmFoco || briefing.oferta || undefined} aberta={aberta("briefing")} onAlternar={() => alternar("briefing")}>
        <CampanhaBriefing campanha={campanha} onPedirAoAgente={onPedirAoAgente ? pedir : undefined} />
      </Secao>

      {/* Imagens da campanha: do acervo (inclusive Mesa Foto) ou enviadas, com papel e porquê. */}
      <Secao
        titulo="Imagens da campanha"
        resumo={`${imagensDaCampanha.length} de ${MAX_IMAGENS_CAMPANHA}`}
        aberta={aberta("imagens")}
        onAlternar={() => alternar("imagens")}
        acao={salvandoImagens > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Salvando as imagens" /> : undefined}
      >
        <ImagensDaCampanhaSalvas campanha={campanha} onSalvando={setSalvandoImagens} />
      </Secao>

      {/* Plano de imagens: qual imagem vai em qual lâmina e por quê (estrategista + Jev). */}
      <Secao titulo="Plano de imagens" resumo={planoResumo} aberta={aberta("plano")} onAlternar={() => alternar("plano")}>
        <CampanhaPlanoDeImagens campanha={campanha} itens={proposta.data ? itens : campanha.proposta_id ? null : []} />
      </Secao>

      {/* Identidade do tema, com o selo grande. */}
      <Secao
        titulo="Identidade do tema"
        resumo={id.tema_visual || undefined}
        aberta={aberta("identidade")}
        onAlternar={() => alternar("identidade")}
      >
        <div className="flex min-w-0 flex-col md:flex-row">
          <div className="mb-4 flex shrink-0 flex-col items-center md:mb-0 md:mr-5">
            {campanha.selo_path ? (
              <button
                type="button"
                onClick={() => setSeloAberto(true)}
                aria-label="Ver o selo grande"
                className="block h-40 w-40 cursor-zoom-in overflow-hidden rounded-2xl border border-border bg-background"
              >
                <ImagemDaMesa caminho={campanha.selo_path} alt={`Selo da campanha ${campanha.nome}`} className="h-full w-full !object-contain p-2" />
              </button>
            ) : (
              <div
                className="flex h-40 w-40 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-background p-3 text-center text-[13px] font-semibold leading-tight [overflow-wrap:anywhere]"
                style={corDoSelo ? { color: corDoSelo } : undefined}
              >
                {selo.texto || campanha.nome}
              </div>
            )}
            <div className="mt-2.5">{botaoDoSelo}</div>
            {seloDesde !== null && (
              <div className="mt-1.5 max-w-[180px]">
                <Cronometro desde={seloDesde} rotulo="Desenhando" previsao="~40s" />
              </div>
            )}
          </div>
          <dl className="min-w-0 flex-1 space-y-3.5">
            {id.tema_visual && <Linha rotulo="Tema visual">{id.tema_visual}</Linha>}
            {paleta.length > 0 && (
              <div className="min-w-0">
                <dt className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Cores de apoio</dt>
                <dd className="mt-1.5 flex flex-wrap">
                  {paleta.map((c, i) => (
                    <span key={`${c.hex}-${i}`} className="mb-2 mr-3 inline-flex min-w-0 items-center">
                      <span className="mr-2 inline-block h-9 w-9 shrink-0 rounded-lg border border-border shadow-sm" style={{ backgroundColor: c.hex }} />
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
              <p className="text-[12.5px] text-muted-foreground">Sem identidade ainda. Peça ao agente da campanha.</p>
            )}
          </dl>
        </div>
      </Secao>

      {/* Referências (o interior é do CampanhaReferencias). */}
      <Secao
        titulo="Referências"
        resumo={`${referencias.length} de ${MAX_REFERENCIAS}`}
        aberta={aberta("referencias")}
        onAlternar={() => alternar("referencias")}
        acao={
          <>
            {salvandoRefs > 0 && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Salvando" />}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-primary"
              aria-expanded={galeria}
              onClick={() => {
                if (!aberta("referencias")) alternar("referencias");
                setGaleria((v) => !v);
              }}
            >
              {galeria ? "Fechar" : "Escolher"}
            </Button>
          </>
        }
      >
        {galeria ? (
          <CampanhaReferencias valor={referencias} onChange={gravarReferencias} />
        ) : (
          <ReferenciasEscolhidas
            ids={referencias}
            onTirar={(rid) => gravarReferencias(referencias.filter((x) => x !== rid))}
            vazio="Nenhuma escolhida: os conteúdos seguem a identidade e as referências do cliente."
          />
        )}
      </Secao>


      {campanha.selo_path && (
        <Ampliar
          imagens={[{ caminho: campanha.selo_path, titulo: `Selo: ${campanha.nome}` }]}
          indice={seloAberto ? 0 : null}
          onFechar={() => setSeloAberto(false)}
        />
      )}
    </div>
  );
}
