import { useEffect, useState } from "react";
import { Bookmark, ChevronLeft, ChevronRight, ImagePlus, Maximize2, MessageSquare, PenLine, RefreshCw, ScanLine, ShieldCheck, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { Ampliar } from "@/components/mesa/Ampliar";
import CardDoEstudio, { type OpcoesDoAjuste, type PainelDaLamina } from "@/components/mesa/CardDoEstudio";
import DiretorDoEstudio from "@/components/mesa/DiretorDoEstudio";
import EstudioFotos from "@/components/mesa/EstudioFotos";
import EstudioLaminaGrande from "@/components/mesa/EstudioLaminaGrande";
import PranchetaDoEstudio, {
  ESTILO_VELADO,
  estaConferindo,
  VeuDaLamina,
  type AndamentoDaLamina,
  type EtapaDaLamina,
} from "@/components/mesa/PranchetaDoEstudio";
import { chaveDoCorrigirSozinho, conferirECorrigir, type DecisaoDeAutocorrecao } from "@/components/mesa/autocorrecaoDaLamina";
import { useEstadoGuardado } from "@/components/mesa/estudioUtil";
import ReferenciasDoEstudio, { type AlvoDasReferencias } from "@/components/mesa/ReferenciasDoEstudio";
import SeletorDeAreas from "@/components/mesa/SeletorDeAreas";
import { ultimasVersoes, type CardDaDirecao, type CardGerado, type Trabalho } from "@/components/mesa/useItensDoMes";
import type { Area } from "@/components/mesa/estudioUtil";
import {
  chamarFuncao,
  custoDaResposta,
  ErroDaMesa,
  estimarLocal,
  modelosAtivos,
  nomeDoModelo,
  padraoPara,
  precoDoModelo,
  TAMANHOS,
  textoDoErro,
  usd,
  type ParteDaEstimativa,
  type Qualidade,
} from "@/lib/mesa/api";
import { formatoDe, ZONA_SEGURA, type CriativoAds } from "./adsApi";

/**
 * A arte do criativo no MESMO motor do Estúdio da Mesa: o trabalho tipo
 * "ads" (estudio_trabalhos) que criativos_produzir deixou dirigido. Gerar,
 * refazer, ajustar (livre, por área, só o fundo), conferir, fotos reais e
 * referências usam os componentes do Estúdio sem mudança. A prévia respeita
 * a proporção do formato (4:5, 1:1, 9:16); nos stories, a zona segura
 * aparece como guia opcional (14% em cima, 20% embaixo), sem tocar na arte.
 *
 * Autocorreção antes de mostrar (docs/mesa-ads/v2/CONTRATO-V2.md): depois de
 * gerar ou ajustar, confere; se a conferência achar erro (texto, logo,
 * identidade, política, clareza) e "Corrigir sozinho" estiver ligado, corrige
 * e confere de novo (até 2 vezes). A arte fica velada até o fim do ciclo.
 */

const QUALIDADES: { valor: Qualidade; rotulo: string }[] = [
  { valor: "baixa", rotulo: "Rascunho" },
  { valor: "media", rotulo: "Padrão" },
  { valor: "alta", rotulo: "Final" },
];

const CODIGOS_SEM_CONFERENCIA = ["acao_desconhecida", "servico_indisponivel"];

type Ferramenta = "lamina" | "diretor" | "fotos" | "referencias";
const FERRAMENTAS: { valor: Ferramenta; rotulo: string; icone: typeof PenLine }[] = [
  { valor: "lamina", rotulo: "Arte", icone: PenLine },
  // Conversa com o diretor de arte (pedido do dono em 24/09): o mesmo agente do Estúdio da Mesa.
  { valor: "diretor", rotulo: "Diretor", icone: MessageSquare },
  { valor: "fotos", rotulo: "Fotos", icone: ImagePlus },
  { valor: "referencias", rotulo: "Referências", icone: Bookmark },
];

function partesDaLamina(modeloImagem: string, leitorId: string | undefined, q: Qualidade, vezes = 1): ParteDaEstimativa[] {
  return [
    { modeloId: modeloImagem, tipo: "imagem", imagens: 1, qualidade: q, tokensEntrada: TAMANHOS.imagemAnexos.entrada, vezes },
    { modeloId: leitorId, tipo: "texto", tokensEntrada: TAMANHOS.leituraDoCard.entrada, tokensSaida: TAMANHOS.leituraDoCard.saida, vezes },
  ];
}

/** Guia da zona segura dos stories: faixas marcadas por cima da prévia (a arte não muda). */
export function GuiaDaZonaSegura() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true" data-zona-segura="">
      <div className="absolute inset-x-0 top-0 border-b border-dashed border-white/80 bg-black/35" style={{ height: `${Math.round(ZONA_SEGURA.topo * 100)}%` }}>
        <span className="absolute bottom-1 left-2 text-[10px] font-medium text-white">zona do perfil</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 border-t border-dashed border-white/80 bg-black/35" style={{ height: `${Math.round(ZONA_SEGURA.base * 100)}%` }}>
        <span className="absolute left-2 top-1 text-[10px] font-medium text-white">zona do CTA e da legenda</span>
      </div>
    </div>
  );
}

/**
 * Prévia na proporção do formato (altura pela largura com padding, sem
 * aspect-ratio): 1:1 e 9:16. A de 4:5 usa a lâmina grande do Estúdio.
 */
function PreviaNoFormato({
  card,
  versoes,
  versaoVista,
  onVersaoVista,
  formato,
  desenhandoAreas,
  areas,
  onAreas,
  ocupado,
  andamento,
  zonaSegura,
  onAmpliar,
}: {
  card: CardDaDirecao;
  versoes: CardGerado[];
  versaoVista: number | null;
  onVersaoVista: (v: number) => void;
  formato: string;
  desenhandoAreas: boolean;
  areas: Area[];
  onAreas: (a: Area[]) => void;
  ocupado: boolean;
  andamento?: AndamentoDaLamina;
  zonaSegura: boolean;
  onAmpliar: () => void;
}) {
  const f = formatoDe(formato);
  const ordenadas = versoes.slice().sort((a, b) => a.versao - b.versao);
  const ultima = ordenadas[ordenadas.length - 1] || null;
  const vista = ordenadas.find((v) => v.versao === versaoVista) || ultima;
  const posicao = vista ? ordenadas.indexOf(vista) : -1;
  const larguraMaxima = f.valor === "stories_9x16" ? 340 : 520;
  const velada = !!andamento && andamento.etapa !== "fila";
  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-2 flex h-8 min-w-0 items-center">
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {f.rotulo} <span className="font-normal text-muted-foreground">· {f.largura}×{f.altura}</span>
        </p>
        {ordenadas.length > 1 && !desenhandoAreas && (
          <div className="ml-2 flex shrink-0 items-center rounded-md border border-border bg-background">
            <button type="button" className="flex h-7 w-7 items-center justify-center text-muted-foreground disabled:opacity-40" onClick={() => ordenadas[posicao - 1] && onVersaoVista(ordenadas[posicao - 1].versao)} disabled={posicao <= 0} aria-label="Versão anterior">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-1 text-[11.5px] tabular-nums text-muted-foreground">v{vista && vista.versao} de {ordenadas.length}</span>
            <button type="button" className="flex h-7 w-7 items-center justify-center text-muted-foreground disabled:opacity-40" onClick={() => ordenadas[posicao + 1] && onVersaoVista(ordenadas[posicao + 1].versao)} disabled={posicao >= ordenadas.length - 1} aria-label="Próxima versão">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {vista && !desenhandoAreas && (
          <Button type="button" size="sm" variant="ghost" className="ml-1 h-8 shrink-0 px-2 text-[12px]" onClick={onAmpliar}>
            <Maximize2 className="mr-1 h-3.5 w-3.5" /> Ver grande
          </Button>
        )}
      </div>
      <div className="mx-auto w-full" style={{ maxWidth: larguraMaxima }}>
        <div
          className="relative w-full overflow-hidden rounded-lg border border-border bg-secondary shadow-sm"
          style={{ paddingBottom: `${(f.altura / f.largura) * 100}%` }}
          data-proporcao={f.curto}
        >
          <div className="absolute inset-0">
            {desenhandoAreas && ultima ? (
              <SeletorDeAreas caminho={ultima.storage_path} areas={areas} onMudar={onAreas} disabled={ocupado} />
            ) : vista ? (
              <button type="button" onDoubleClick={velada ? undefined : onAmpliar} className="block h-full w-full cursor-zoom-in overflow-hidden" aria-label="Duplo clique para ver grande">
                <div className="h-full w-full" style={velada ? ESTILO_VELADO : undefined}>
                  <ImagemDaMesa caminho={vista.storage_path} alt={`Arte, versão ${vista.versao}`} className={`h-full w-full ${ocupado && !velada ? "opacity-50" : ""}`} />
                </div>
              </button>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center">
                <p className="text-[12px] font-medium text-foreground/80">Arte ainda não gerada</p>
                {card.texto_exato && <p className="mt-2 line-clamp-4 text-[11.5px] leading-snug text-muted-foreground">{card.texto_exato}</p>}
              </div>
            )}
            {zonaSegura && !desenhandoAreas && !velada && <GuiaDaZonaSegura />}
            {velada && andamento && !desenhandoAreas && <VeuDaLamina andamento={andamento} />}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ArteDoCriativo({
  criativo,
  trabalho,
  onAtualizar,
}: {
  criativo: CriativoAds;
  trabalho: Trabalho;
  onAtualizar: () => void;
}) {
  const mesa = useMesa();
  const { catalogo } = mesa;
  const avisarErro = useAvisarErro();
  const f = formatoDe(criativo.formato);
  const [modeloImagem, setModeloImagem] = useState("");
  const [qualidade, setQualidade] = useState<Qualidade>("media");
  const [andamento, setAndamento] = useState<Record<number, AndamentoDaLamina>>({});
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [painel, setPainel] = useState<PainelDaLamina>("direcao");
  const [versaoVista, setVersaoVista] = useState<number | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [ferramenta, setFerramenta] = useState<Ferramenta>("lamina");
  const [refsAlvo, setRefsAlvo] = useState<AlvoDasReferencias>("conjunto");
  const [refsAba, setRefsAba] = useState<"cliente" | "banco">("cliente");
  const [zonaSegura, setZonaSegura] = useState(true);
  // "Corrigir sozinho": desligado por padrão (24/09/2026), guardado por trabalho na sessão.
  const [corrigirSozinho, setCorrigirSozinho] = useEstadoGuardado<boolean>(chaveDoCorrigirSozinho(trabalho.id), false);

  useEffect(() => {
    setModeloImagem(trabalho.modelo_imagem_id || (padraoPara(catalogo, "imagem") || { id: "" }).id);
    setQualidade((trabalho.qualidade as Qualidade) || "media");
  }, [trabalho.id, catalogo.length]);

  const cards = ((trabalho.direcao && trabalho.direcao.cards) || []).slice().sort((a, b) => a.ordem - b.ordem);
  const ultimas = ultimasVersoes(trabalho.cards || []);
  const semImagem = cards.filter((c) => !ultimas.has(c.ordem));
  const leitor = padraoPara(catalogo, "leitura");

  useEffect(() => {
    if (!cards.length) return;
    if (selecionado === null || !cards.some((c) => c.ordem === selecionado)) setSelecionado(cards[0].ordem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trabalho.id, cards.length]);

  const card = cards.find((c) => c.ordem === selecionado) || null;
  const versoesDoCard = card ? (trabalho.cards || []).filter((v) => v.ordem === card.ordem) : [];
  const ultimaDoCard = card ? ultimas.get(card.ordem) : undefined;
  useEffect(() => { setVersaoVista(null); setAreas([]); }, [selecionado, ultimaDoCard ? ultimaDoCard.versao : 0]);

  const marcar = (ordem: number, etapa: EtapaDaLamina, detalhe?: string) =>
    setAndamento((a) => {
      const antes = a[ordem];
      const desde = antes && antes.etapa !== "fila" && etapa !== "fila" ? antes.desde : Date.now();
      return { ...a, [ordem]: { etapa, desde, detalhe } };
    });
  const soltar = (ordem: number) =>
    setAndamento((a) => {
      const n = { ...a };
      delete n[ordem];
      return n;
    });
  const ocupada = (ordem: number) => !!andamento[ordem];
  const algoGerando = Object.keys(andamento).length > 0;

  const guardarEscolha = async (campos: { modelo_imagem_id?: string; qualidade?: string }) => {
    const { error } = await (supabase as any).from("estudio_trabalhos").update(campos).eq("id", trabalho.id);
    if (error) toast.error("Escolha não salva", { description: textoDoErro(error) });
    else onAtualizar();
  };

  const chamarConferir = (ordem: number) =>
    chamarFuncao<any>("estudio-arte", { acao: "conferir_card", trabalho_id: trabalho.id, ordem });
  const chamarCorrigir = (ordem: number, pedidoDaEquipe: boolean) =>
    chamarFuncao<any>("estudio-arte", { acao: "corrigir_card", trabalho_id: trabalho.id, ordem, pedido_da_equipe: pedidoDaEquipe || undefined });

  /** Botão "Conferir" da ferramenta Arte: só a conferência, sem corrigir. */
  const conferir = async (ordem: number) => {
    marcar(ordem, "conferindo");
    try {
      return await chamarConferir(ordem);
    } finally {
      soltar(ordem);
      onAtualizar();
    }
  };

  /**
   * Conferência depois da arte já cobrada, com a autocorreção: confere e, se
   * precisar e "Corrigir sozinho" estiver ligado, corrige e confere de novo
   * (até 2 vezes). A arte fica velada até aqui. Se falhar, avisa sem derrubar
   * a geração. Devolve o custo de todas as chamadas.
   */
  const conferirSemDerrubar = async (ordem: number, comecarCorrigindo: DecisaoDeAutocorrecao | null = null): Promise<number> => {
    const r = await conferirECorrigir({
      conferir: () => chamarConferir(ordem),
      corrigir: (pedidoDaEquipe) => chamarCorrigir(ordem, pedidoDaEquipe),
      corrigirSozinho,
      comecarCorrigindo,
      aoMudarEtapa: (etapa, detalhe) => {
        marcar(ordem, etapa, detalhe);
        if (etapa === "reconferindo") onAtualizar();
      },
    });
    soltar(ordem);
    onAtualizar();
    const e = r.falha;
    if (e && !(e instanceof ErroDaMesa && CODIGOS_SEM_CONFERENCIA.indexOf(e.codigo) >= 0)) {
      avisarErro(e, r.rodadas ? "A arte foi corrigida, mas a conferência não terminou" : "Arte pronta, mas a conferência falhou");
    } else if (!e && r.autocorrecao && r.autocorrecao.precisa) {
      toast.warning(r.rodadas ? `Corrigida ${r.rodadas === 1 ? "1 vez" : `${r.rodadas} vezes`}, mas ainda com erro` : "A conferência achou erro", {
        description: r.autocorrecao.motivos.join(" · "),
      });
    }
    return r.custo_usd;
  };

  /** "Corrigir de novo": a equipe pede a correção com os motivos da última conferência. */
  const corrigirDeNovo = async (ordem: number) => {
    const ultima = ultimas.get(ordem);
    const v = ultima && ultima.verificacao;
    const decisao = v && !v.pendente && v.autocorrecao ? v.autocorrecao : null;
    if (!decisao || !decisao.precisa) return { custo_usd: await conferirSemDerrubar(ordem) };
    marcar(ordem, "corrigindo");
    return { custo_usd: await conferirSemDerrubar(ordem, decisao) };
  };

  const gerarEConferir = async (ordem: number) => {
    marcar(ordem, "gerando");
    let custo = 0;
    try {
      const g = await chamarFuncao<any>("estudio-arte", { acao: "gerar_card", trabalho_id: trabalho.id, ordem });
      custo = custoDaResposta(g) || 0;
      onAtualizar();
    } catch (e) {
      soltar(ordem);
      throw e;
    }
    return { custo_usd: custo + (await conferirSemDerrubar(ordem)) };
  };

  const gerarVarias = async (ordens: number[]) => {
    let total = 0;
    const falhas: unknown[] = [];
    for (const o of ordens) {
      try {
        total += custoDaResposta(await gerarEConferir(o)) || 0;
      } catch (e) {
        falhas.push(e);
        break;
      }
    }
    if (falhas.length) avisarErro(falhas[0], "A arte não foi gerada");
    return { custo_usd: total, falhou: falhas.length > 0 };
  };

  const ajustar = async (ordem: number, instrucao: string, opcoes: OpcoesDoAjuste = {}) => {
    marcar(ordem, "ajustando");
    let custo = 0;
    try {
      const a = await chamarFuncao<any>("estudio-arte", {
        acao: "ajustar_card",
        trabalho_id: trabalho.id,
        ordem,
        instrucao,
        areas: opcoes.areas && opcoes.areas.length ? opcoes.areas : undefined,
        tipo: opcoes.tipo,
        imagem_id: opcoes.imagem_id,
      });
      custo = custoDaResposta(a) || 0;
      onAtualizar();
    } catch (e) {
      soltar(ordem);
      throw e;
    }
    return { custo_usd: custo + (await conferirSemDerrubar(ordem)) };
  };

  const configurar = async (corpo: Record<string, unknown>) => {
    await chamarFuncao("estudio-arte", { acao: "configurar", trabalho_id: trabalho.id, ...corpo });
    onAtualizar();
  };

  const partesGerar = (vezes = 1): ParteDaEstimativa[] => partesDaLamina(modeloImagem, leitor ? leitor.id : undefined, qualidade, vezes);
  const partesAjustar = (): ParteDaEstimativa[] => [
    { modeloId: leitor ? leitor.id : null, tipo: "texto", tokensEntrada: TAMANHOS.ajuste.entrada, tokensSaida: TAMANHOS.ajuste.saida },
    ...partesGerar(1),
  ];
  const partesConferir = (): ParteDaEstimativa[] => [
    { modeloId: leitor ? leitor.id : null, tipo: "texto", tokensEntrada: TAMANHOS.leituraDoCard.entrada, tokensSaida: TAMANHOS.leituraDoCard.saida },
  ];

  const fila = semImagem.length ? semImagem : cards;
  const opcoesDeImagem = modelosAtivos(catalogo, "imagem");
  const precoDe = (q: Qualidade) => {
    const v = modeloImagem ? estimarLocal(partesDaLamina(modeloImagem, leitor ? leitor.id : undefined, q), catalogo) : null;
    return v === null ? "" : `~${usd(v)}`;
  };

  const paraAmpliar = cards
    .filter((c) => ultimas.has(c.ordem))
    .map((c) => {
      const lista = (trabalho.cards || []).filter((v) => v.ordem === c.ordem);
      const vista = c.ordem === selecionado && versaoVista !== null ? lista.find((v) => v.versao === versaoVista) || ultimas.get(c.ordem)! : ultimas.get(c.ordem)!;
      return { ordem: c.ordem, imagem: { caminho: vista.storage_path, titulo: `${f.rotulo} · v${vista.versao}`, proporcao: f.largura / f.altura } };
    });
  const ampliar = (ordem: number) => {
    const i = paraAmpliar.findIndex((a) => a.ordem === ordem);
    if (i >= 0) setAmpliada(i);
  };

  const desenhandoAreas = ferramenta === "lamina" && painel === "areas" && !!ultimaDoCard;
  const noQuatroPorCinco = f.valor === "feed_4x5" || f.valor === "carrossel";

  if (!cards.length) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <p className="text-[13.5px] font-medium">A direção de arte deste criativo ainda não chegou</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {trabalho.status === "erro" ? "A última tentativa terminou com erro. Produza o criativo de novo pelo plano." : "O diretor está montando. A tela atualiza sozinha em instantes."}
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-wrap items-center rounded-xl border border-border bg-card px-3 py-2">
        <div className="mb-1 mr-2 mt-1 grid shrink-0 grid-cols-3 gap-0.5 rounded-lg border border-border bg-background p-0.5" role="radiogroup" aria-label="Qualidade da arte">
          {QUALIDADES.map((q) => {
            const ativa = qualidade === q.valor;
            return (
              <button
                key={q.valor}
                type="button"
                role="radio"
                aria-checked={ativa}
                disabled={algoGerando}
                onClick={() => { setQualidade(q.valor); void guardarEscolha({ qualidade: q.valor }); }}
                className={`flex h-9 min-w-[66px] flex-col items-center justify-center rounded-md px-2 leading-tight ${ativa ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
              >
                <span className="text-[11.5px]">{q.rotulo}</span>
                <span className={`text-[10px] tabular-nums ${ativa ? "text-primary-foreground/80" : ""}`}>{precoDe(q.valor) || "sem preço"}</span>
              </button>
            );
          })}
        </div>
        <div className="mb-1 mr-2 mt-1 w-[150px] min-w-0 shrink-0">
          <Select value={modeloImagem || ""} onValueChange={(id) => { setModeloImagem(id); void guardarEscolha({ modelo_imagem_id: id }); }} disabled={algoGerando || opcoesDeImagem.length === 0}>
            <SelectTrigger className="h-9 text-[12px]" aria-label="Gerador de imagem">
              <SelectValue placeholder={opcoesDeImagem.length ? "Gerador" : "Sem gerador"} />
            </SelectTrigger>
            <SelectContent>
              {opcoesDeImagem.map((m) => (
                <SelectItem key={m.id} value={m.id}>{nomeDoModelo(m)} <span className="text-muted-foreground">· {precoDoModelo(m, qualidade)}</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {f.valor === "stories_9x16" && (
          <button
            type="button"
            aria-pressed={zonaSegura}
            onClick={() => setZonaSegura((z) => !z)}
            className={`mb-1 mr-2 mt-1 inline-flex h-9 items-center rounded-lg border px-2.5 text-[12px] ${zonaSegura ? "border-primary/50 bg-primary/5 text-foreground" : "border-border text-muted-foreground"}`}
            title="Guia: nada importante nos 14% de cima e nos 20% de baixo"
          >
            <ScanLine className="mr-1 h-3.5 w-3.5" /> Zona segura
          </button>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={corrigirSozinho}
          onClick={() => setCorrigirSozinho((c) => !c)}
          className={`mb-1 mr-2 mt-1 inline-flex h-9 items-center rounded-lg border px-2.5 text-[12px] ${corrigirSozinho ? "border-primary/50 bg-primary/5 text-foreground" : "border-border text-muted-foreground"}`}
          title="Depois de gerar ou ajustar, se a conferência achar erro de texto, logo, identidade, política ou clareza, o estúdio corrige sozinho (até 2 vezes) antes de mostrar a arte."
        >
          <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Corrigir sozinho{corrigirSozinho ? "" : " (desligado)"}
        </button>
        <span className="mb-1 ml-auto mt-1">
          <BotaoComCusto
            rotulo={<>{semImagem.length ? <Wand2 className="mr-1 h-3.5 w-3.5" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}{semImagem.length ? (cards.length > 1 ? `Gerar (${semImagem.length})` : "Gerar arte") : cards.length > 1 ? "Refazer todas" : "Refazer arte"}</>}
            titulo={semImagem.length ? "Gerar a arte" : "Refazer a arte"}
            descricao={corrigirSozinho
              ? "Gera no tamanho do formato. A conferência de texto, identidade, clareza e política roda logo depois e, se achar erro, o estúdio corrige sozinho (até 2 vezes) antes de mostrar. Cada correção custa um ajuste a mais."
              : "Gera no tamanho do formato. A conferência de texto, identidade, clareza e política roda logo depois."}
            variant={semImagem.length ? "default" : "outline"}
            className="h-9"
            disabled={algoGerando}
            fecharAoConfirmar
            partes={() => partesGerar(fila.length)}
            executar={() => gerarVarias(fila.map((c) => c.ordem))}
            aoConcluir={(data) => {
              if (!data || !data.falhou) toast.success("Arte gerada", { description: `Custo real: ${usd(custoDaResposta(data) || 0)}.` });
            }}
          />
        </span>
      </div>

      {cards.length > 1 && (
        <PranchetaDoEstudio
          cards={cards}
          ultimas={ultimas}
          selecionado={selecionado}
          onSelecionar={(o) => { setSelecionado(o); if (painel === "livre" || painel === "versoes") setPainel("direcao"); }}
          onAmpliar={ampliar}
          andamento={andamento}
          infinito={!!(trabalho.direcao && trabalho.direcao.carrossel_infinito)}
          largura={96}
          orientacao="horizontal"
          podeReordenar={false}
          onReordenar={() => undefined}
          onVersoes={(o) => { setSelecionado(o); setPainel("versoes"); setFerramenta("lamina"); }}
          onAjustar={(o) => { setSelecionado(o); setPainel("livre"); setFerramenta("lamina"); }}
        />
      )}

      <div className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {card && noQuatroPorCinco ? (
            <EstudioLaminaGrande
              card={card}
              total={cards.length}
              versoes={versoesDoCard}
              versaoVista={versaoVista}
              onVersaoVista={setVersaoVista}
              desenhandoAreas={desenhandoAreas}
              areas={areas}
              onAreas={setAreas}
              ocupado={ocupada(card.ordem)}
              andamento={andamento[card.ordem]}
              onAmpliar={() => ampliar(card.ordem)}
              soPelaLargura
            />
          ) : card ? (
            <PreviaNoFormato
              card={card}
              versoes={versoesDoCard}
              versaoVista={versaoVista}
              onVersaoVista={setVersaoVista}
              formato={f.valor}
              desenhandoAreas={desenhandoAreas}
              areas={areas}
              onAreas={setAreas}
              ocupado={ocupada(card.ordem)}
              andamento={andamento[card.ordem]}
              zonaSegura={f.valor === "stories_9x16" && zonaSegura}
              onAmpliar={() => ampliar(card.ordem)}
            />
          ) : null}
        </div>

        <div className="min-w-0 rounded-xl border border-border bg-card">
          <nav aria-label="Ferramentas da arte" className="flex border-b border-border p-1">
            {FERRAMENTAS.map((t) => {
              const Icone = t.icone;
              const ativa = ferramenta === t.valor;
              return (
                <button
                  key={t.valor}
                  type="button"
                  aria-pressed={ativa}
                  onClick={() => setFerramenta(t.valor)}
                  title={t.valor === "diretor" ? "Conversar com o diretor de arte sobre estilo, cenário, luz e cores" : undefined}
                  className={`mr-1 inline-flex h-8 min-w-0 flex-1 items-center justify-center rounded-md px-1 text-[12px] ${ativa ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
                >
                  <Icone className="mr-1 h-3.5 w-3.5 shrink-0" /> <span className="truncate">{t.rotulo}</span>
                </button>
              );
            })}
          </nav>
          {ferramenta === "diretor" && (
            <div className="flex h-[560px] min-w-0 flex-col">
              <DiretorDoEstudio
                key={trabalho.id}
                trabalho={trabalho}
                ordemEmFoco={card ? card.ordem : null}
                ocupado={algoGerando}
                bloqueado={trabalho.status === "entregue"}
                partesRefazer={(ordens) => partesGerar(ordens.length)}
                onRefazer={(ordens) => gerarVarias(ordens)}
                onAtualizar={onAtualizar}
                className="h-full"
              />
            </div>
          )}
          <div className={ferramenta === "diretor" ? "hidden" : "p-3"}>
            {ferramenta === "lamina" && card && (
              <CardDoEstudio
                key={card.ordem}
                conversaId={trabalho.conversa_id}
                direcao={card}
                versoes={versoesDoCard}
                ocupado={ocupada(card.ordem)}
                conferindo={estaConferindo(andamento[card.ordem])}
                painel={painel}
                onPainel={setPainel}
                versaoVista={versaoVista}
                onVersaoVista={setVersaoVista}
                areas={areas}
                onAreas={setAreas}
                partesGerar={() => partesGerar(1)}
                partesAjustar={partesAjustar}
                partesConferir={partesConferir}
                onGerar={() => gerarEConferir(card.ordem)}
                onAjustar={(instrucao, opcoes) => ajustar(card.ordem, instrucao, opcoes)}
                onConferir={() => conferir(card.ordem)}
                onCorrigir={() => corrigirDeNovo(card.ordem)}
                partesCorrigir={() => partesAjustar().concat(partesConferir())}
                onConfigurar={(c) => configurar({ card: { ordem: card.ordem, ...c } })}
                onConcluido={onAtualizar}
              />
            )}
            {ferramenta === "fotos" && card && (
              <EstudioFotos
                key={card.ordem}
                card={card}
                ocupado={ocupada(card.ordem)}
                temArte={!!ultimaDoCard}
                onSalvar={(corpo) => configurar(corpo)}
                onTirarFotoAntiga={() => configurar({ card: { ordem: card.ordem, imagens_ids: [] } })}
              />
            )}
            {ferramenta === "referencias" && (
              <ReferenciasDoEstudio
                trabalho={trabalho}
                cardSelecionado={card}
                alvo={refsAlvo}
                onAlvo={setRefsAlvo}
                aba={refsAba}
                onAba={setRefsAba}
                onAtualizar={onAtualizar}
              />
            )}
          </div>
        </div>
      </div>

      <Ampliar imagens={paraAmpliar.map((a) => a.imagem)} indice={ampliada} onFechar={() => setAmpliada(null)} />
    </div>
  );
}

/** Caminho da arte mais recente da primeira lâmina (miniatura e prévia do feed). */
export function capaDoTrabalho(trabalho: Trabalho | null | undefined): string | null {
  if (!trabalho) return null;
  const ultimas = ultimasVersoes(trabalho.cards || []);
  const cards = ((trabalho.direcao && trabalho.direcao.cards) || []).slice().sort((a, b) => a.ordem - b.ordem);
  const primeira = cards.length ? ultimas.get(cards[0].ordem) : ultimas.get(1);
  return primeira ? primeira.storage_path : null;
}
