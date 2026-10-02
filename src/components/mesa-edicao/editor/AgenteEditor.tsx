import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bot, Download, Eye, Film, Loader2, Send, Square, Timer, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, campoTexto, conversa, juntar, texto } from "@/components/sistema/estilos";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import AprendizadoDoAgente from "@/components/agentes/AprendizadoDoAgente";
import { textoDoErro, usd, type ModeloIa } from "@/lib/mesa/api";
import { acoesDaMensagem, estadoDaAcao, type AcaoDoAgente, type PedidoDaAcao, type RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";
import type { ProjetoDeEdicao, TrechoVisto } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import {
  estimarPasso,
  MAX_FERRAMENTAS,
  MAX_PASSOS,
  MAX_QUADROS_POR_CHAMADA,
  MAX_TEXTO_DO_PEDIDO,
  podeAplicarDireto,
  respostaPromete,
  sugerirModeloMaisBarato,
  temposDeAmostra,
  TETO_PADRAO_USD,
} from "../../../../supabase/functions/editor-video/ferramentas";
import { contextoDoAgente, conversaParaOModelo, ErroDoPrimeiroPasso, pedidoDeExportar, provaDaMudanca, resumoDoQueMudou, rodarAgente, type ItemDoLog } from "@/lib/editor/agente";
import { acaoDeExportar, AGENTE_DO_EDITOR, baixarExportacao } from "@/lib/editor/exportar";
import { acaoDaProposta, acaoFeita } from "@/lib/editor/cartao";
import { chamarEditorVideo, emPreparacao, novoId } from "@/lib/editor/api";
import { aplicarOperacao, assinaturaDoProjeto, trilhaPrincipal, type Operacao } from "@/lib/editor/operacoes";
import { base64DoDataUrl, extrairQuadro, tempoDoQuadro } from "@/lib/editor/quadros";
import { pedidoDeTakesRepetidos, proporSkill, skillPorId, skillPorPalavras, type IdDaSkill, type PropostaDaSkill } from "@/lib/editor/skills";
import { assinaturasDosArquivos, itensDaBiblioteca } from "@/lib/editor/biblioteca";
import { useArquivosDeVideo } from "@/components/mesa-videos/videosApi";
import { definirFiltro, destacar } from "./buscaDoEditor";
import { custoDaFala, fontesSemFala, lerFalaDaEntrada, marcarFalaDoProjeto, pedidoPrecisaDeFala, skillPrecisaDeFala } from "@/lib/editor/fala";
import { tempoFino } from "@/lib/editor/tempo";
import { aplicarOperacoes } from "@/lib/editor/operacoes";
import { fontesSemOnda, pedirRender, uidDoClique, useFilaDeRender, type PedidoNaFila } from "@/lib/editor/render";
import { acaoDaSaida, confirmarBroll, confirmarElemento, estimarBroll, estimarElemento, opsDoArquivoNoTrecho, sugerirAnimacoesNaTela, type ArquivoGerado } from "@/lib/editor/geracaoDoAgente";
import type { MarcaParaOAgente, ResultadoDaFerramenta, SaidaDoAgente } from "@/lib/editor/agente";
import { useKitDaMesa } from "@/components/mesa/kitDaMesa";
import { chamarMesaVideos } from "@/components/mesa-videos/videosApi";
import { supabase } from "@/integrations/supabase/client";
import { janelaDaAmostra } from "../../../../supabase/functions/_shared/render-do-editor";
import MensagemPadrao, { estilosLigados, lerMensagensPadrao, TIPO_DO_PADRAO, type MensagemPadraoDoEditor } from "./MensagemPadrao";
import type { ControleDePropostas } from "./PainelDeSkills";
import { pegarPedidoPendente, temPedidoPendente } from "./ponteDoAgente";
import { Montador } from "@/lib/editor/skills/tipos";
import { capitulosEm, frasesDoProjeto, notasPorRegra, zoomNosMomentosEm } from "@/lib/editor/skills/pecasDaEdicao";
import { comRegraNoResto } from "@/lib/editor/editarComIa";
import { capitulosEmBlocos, momentosEmBlocos } from "@/lib/editor/julgarEmBlocos";

/**
 * Agente editor (frente V-B; frente Q, 26/09: virou a lateral fixa da etapa
 * Editar). Em cima, o dono escolhe o MODELO (qualquer modelo de texto ativo do
 * catálogo ia_modelos: GPT da OpenAI, Claude pela OpenRouter...), com o preço
 * por milhão de tokens, o esforço de raciocínio quando o modelo aceita e o
 * teto por pedido; a tela mostra o custo estimado por pedido antes. O agente
 * só SUGERE um mais barato.
 *
 * O agente EDITA: o laço (editor-video/agente_passo) pede ferramentas, a tela
 * roda as operações puras numa cópia e o fim é uma proposta com
 * Confirmar/Cancelar e Desfazer. Pedido que precisa da fala (edição dinâmica,
 * silêncio, legenda) e vídeo sem fala marcada: antes, o Timestamp, com o
 * custo à vista e o clique do dono; depois o agente segue no projeto já com a
 * fala. Atalhos rodam as skills direto (de graça, sem modelo).
 *
 * AG2 (29/09): a conversa fica guardada na versão do vídeo (agente_conversas,
 * referencia_tipo editor_agente) e volta ao reabrir, com os cartões no estado
 * em que ficaram. Ordem clara (Jev) e atalho vão na hora, como UM passo do
 * desfazer, com a lista do que mudou e o Desfazer do pedido inteiro; o resto
 * pede Confirmar. Exportar é sempre cartão com Confirmar. O agente recebe a
 * seleção e o cursor ("esse corte", "aqui") e as regras que a equipe ensinou.
 * Pedido que não andou sai da conversa e volta ao campo, com o erro à vista.
 */

interface Preparo {
  /** Pedido livre (vai ao modelo depois) ou skill direta. */
  pedido: string | null;
  skill: IdDaSkill | null;
  fontes: string[];
  custoFala: number;
  /** O que o dono escreveu (ou o atalho): volta ao campo se não andar. */
  texto: string;
  /** Bolha do dono na conversa (sai se o pedido não andar). */
  chaveDoDono: string;
  /** Últimas trocas, para o modelo. */
  conversa: string;
  /** O que já foi feito antes do agente (Timestamp pago): entra na resposta guardada. */
  antes?: ItemDoLog[];
}

const ATALHOS: { skill: IdDaSkill; rotulo: string }[] = [
  { skill: "brabo", rotulo: "Edição dinâmica" },
  { skill: "cortar_silencios", rotulo: "Cortar silêncios" },
  { skill: "legendas", rotulo: "Legendas" },
  { skill: "punch_in", rotulo: "Punch-in" },
  { skill: "remover_duplicados", rotulo: "Tirar repetidos" },
];

const semAcento = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * "Remova os takes duplicados" sozinho (02/10): regra fixa, sem modelo e sem
 * custo, como o exportar. Ordem ("remova", "tira", "apaga") vai na hora com
 * Desfazer; pergunta ("tem take duplicado?", "ache os repetidos") mostra a
 * proposta com Confirmar e os repetidos em destaque. Pedido que junta outra
 * coisa ("tira os duplicados e legenda") vai ao modelo.
 */
export function pedidoDeTakesRepetidosDireto(texto: string): { direto: boolean; ordem: boolean } {
  const t = semAcento(texto).replace(/\s+/g, " ").replace(/[.!]+$/, "").trim();
  if (!pedidoDeTakesRepetidos(t)) return { direto: false, ordem: false };
  const alvo = "(?:os |as |esses |essas |todos os |todas as )?(?:takes? |videos? |clipes? |cortes? )?(?:duplicad|repetid)[a-z]*";
  const fim = "(?: (?:por favor|pra mim|para mim|da linha do tempo|do video|de uma vez))?";
  if (new RegExp(`^(?:por favor,? )?(?:pode |agora )?(?:remov|tir|apag|exclu|delet|limp)[a-z]*(?: os| as)? ${alvo}${fim}$`).test(t)) return { direto: true, ordem: true };
  const sem = t.replace(/\?+$/, "").trim();
  if (new RegExp(`^(?:tem|ha|existe|existem|acha|ache|mostra|mostre|quais sao|quais|veja|ve) (?:algum |alguns |os |as )?(?:takes? |videos? |clipes? )?(?:duplicad|repetid)[a-z]*${fim}$`).test(sem)) return { direto: true, ordem: false };
  return { direto: false, ordem: false };
}

/**
 * Ordem explícita do dono pela regra do verbo (02/10): vale quando o Jev não
 * responde (antes, sem Jev tudo virava Confirmar, até "apague o c3").
 * Pergunta, "talvez" e "será que" nunca valem.
 */
export function ordemExplicita(pedido: string): boolean {
  const t = semAcento(pedido).replace(/\s+/g, " ").trim();
  if (!t || /\?\s*$/.test(t) || /^(sera|talvez|acha|voce acha|e se|posso|devo|qual|quais|como|por que|porque)\b/.test(t)) return false;
  return /\b(remova|remove|tira|tire|apaga|apague|exclui|exclua|deleta|delete|corta|corte|divide|divida|move|mova|coloca|coloque|poe|ponha|encosta|encoste|junta|junte|reordena|reordene|aplica|aplique|fecha|feche|limpa|limpe|legenda|legende|pode (fazer|tirar|remover|apagar|aplicar|cortar|mover|seguir|mandar|editar))\b/.test(t);
}

export const aceitaImagem = (m: ModeloIa) => {
  const mod = (m as unknown as { modalidades?: { entrada?: string[] } | null }).modalidades;
  if (mod && Array.isArray(mod.entrada)) return mod.entrada.indexOf("image") >= 0;
  return m.provedor === "openai" || /gpt|claude|gemini/i.test(m.modelo_api);
};

const nomeDoModelo = (m: ModeloIa) => m.rotulo || m.modelo_api;

const PROVEDORES: Record<string, string> = { openai: "OpenAI", openrouter: "OpenRouter", anthropic: "Anthropic", google: "Google" };
export const nomeDoProvedor = (p: string) => PROVEDORES[p] || p;

const precoCurto = (v: number | null) => {
  const n = Number(v);
  if (!isFinite(n) || v === null) return "?";
  return n.toLocaleString("pt-BR", { maximumFractionDigits: n < 1 ? 2 : 1 });
};

/** "US$ 4/20 por 1M" (entrada/saída por milhão de tokens). */
export const precoDoModelo = (m: Pick<ModeloIa, "preco_entrada_1m" | "preco_saida_1m">) => `US$ ${precoCurto(m.preco_entrada_1m)}/${precoCurto(m.preco_saida_1m)} por 1M`;

/** Família do modelo para agrupar o seletor (pelo nome do modelo, não pela rota). */
export function familiaDoModelo(m: Pick<ModeloIa, "modelo_api" | "provedor">): string {
  const api = String(m.modelo_api || "").toLowerCase();
  if (api.indexOf("claude") >= 0) return "Claude (Anthropic)";
  if (api.indexOf("gpt") >= 0 || api.indexOf("o3") === 0 || api.indexOf("o4") === 0 || m.provedor === "openai") return "GPT (OpenAI)";
  if (api.indexOf("gemini") >= 0) return "Gemini (Google)";
  return "Outros";
}

/** Modelos de texto ativos, do mais barato ao mais caro, agrupados por família. */
export function modelosDoAgente(catalogo: ModeloIa[]): { familia: string; modelos: ModeloIa[] }[] {
  const ativos = (catalogo || []).filter((m) => m.tipo === "texto" && m.ativo).sort((a, b) => (Number(a.preco_saida_1m) || 0) - (Number(b.preco_saida_1m) || 0));
  const grupos: { familia: string; modelos: ModeloIa[] }[] = [];
  ativos.forEach((m) => {
    const f = familiaDoModelo(m);
    let g = grupos.find((x) => x.familia === f);
    if (!g) {
      g = { familia: f, modelos: [] };
      grupos.push(g);
    }
    g.modelos.push(m);
  });
  const ordem = ["GPT (OpenAI)", "Claude (Anthropic)", "Gemini (Google)", "Outros"];
  return grupos.sort((a, b) => ordem.indexOf(a.familia) - ordem.indexOf(b.familia));
}

/** Custo estimado de um pedido: típico (2 passos: editar e conferir) e o máximo (6 passos, preso ao teto). */
export function custoDoPedido(porPasso: number, teto: number): { tipico: number; maximo: number } {
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return { tipico: r(Math.min(teto, porPasso * 2)), maximo: r(Math.min(teto, porPasso * MAX_PASSOS)) };
}

/** Pedido que vai ao modelo: com a dica da skill quando as palavras apontam uma (regra fixa, sem IA). */
export function pedidoComDica(pedido: string): string {
  if (pedidoDeTakesRepetidos(pedido)) {
    return `${pedido.slice(0, MAX_TEXTO_DO_PEDIDO - 220)}\n\n(Dica da tela: takes ou vídeos repetidos saem com remover_duplicados (o código acha, fica o primeiro). Chame, confira e termine; faça também o resto do pedido.)`;
  }
  const s = skillPorPalavras(pedido);
  const skill = s ? skillPorId(s) : null;
  const base = pedido.slice(0, MAX_TEXTO_DO_PEDIDO - 220);
  if (skill) return `${base}\n\n(Dica da tela: a skill "${skill.id}" (${skill.rotulo}) faz esse pedido. Chame aplicar_skill com ela, confira o resultado e termine.)`;
  // Pedido geral de editar ("pode editar ele"): o método da Mesa Edição é a edição dinâmica.
  const t = pedido.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/\bedit|\bedicao\b/.test(t)) return `${base}\n\n(Dica da tela: pedido geral de edição. O método da casa é a edição dinâmica, skill "brabo". Aplique e ajuste só o que o pedido disser.)`;
  return base;
}

// ---------------------------------------------------------------- conversa guardada (AG2, 29/09)

/** Log do agente guardado na mensagem (para reabrir igual). */
export const TIPO_DO_LOG = "log_do_editor";
/** Pergunta com opções guardada na mensagem. */
export const TIPO_DA_PERGUNTA = "pergunta_do_editor";

interface Mensagem {
  chave: string;
  quem: "dono" | "agente";
  itens: ItemDoLog[];
  /** Cartões desta resposta (mudança na linha do tempo, exportar). */
  acoes: AcaoDoAgente[];
  /** Linha no banco (o cartão marca o estado nela). */
  mensagemId: string | null;
  /** Anexos do aprendizado (Aprendi / Segui). */
  anexos: unknown[];
  /** Aviso de registro (a resposta não ficou guardada). */
  aviso?: string | null;
  opcoes?: string[];
  /** Chegou agora (não ao reabrir). */
  recemFeita?: boolean;
}

/**
 * Propostas desta aba (id do cartão -> proposta com as operações): o Desfazer e
 * o Confirmar precisam delas; sobrevivem a remontar a lateral (recolher, trocar
 * de etapa e voltar). Recarregar a página perde: o cartão reaberto diz isso.
 */
const PROPOSTAS_DA_ABA = new Map<string, PropostaDaSkill>();
const MAX_PROPOSTAS_DA_ABA = 60;
function guardarProposta(id: string, p: PropostaDaSkill) {
  PROPOSTAS_DA_ABA.delete(id);
  PROPOSTAS_DA_ABA.set(id, p);
  if (PROPOSTAS_DA_ABA.size > MAX_PROPOSTAS_DA_ABA) {
    const primeira = PROPOSTAS_DA_ABA.keys().next();
    if (!primeira.done) PROPOSTAS_DA_ABA.delete(primeira.value);
  }
}

let seq = 0;
const novaChave = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Operações guardadas na mensagem só enquanto o cartão está aberto (para confirmar depois de recarregar). */
const MAX_BYTES_DAS_OPERACOES = 150_000;
function comOperacoesGuardadas(a: AcaoDoAgente, ops: Operacao[]): AcaoDoAgente {
  if (a.executada_em || a.descartada_em) return a;
  const texto = JSON.stringify(ops);
  return texto.length <= MAX_BYTES_DAS_OPERACOES ? { ...a, contexto: { ...(a.contexto || {}), operacoes: ops } } : a;
}

/**
 * Mensagem lida do banco vira mensagem da tela. Cartão feito numa sessão
 * anterior perde o Desfazer (o histórico do desfazer é da aba; o Ctrl+Z e as
 * Versões continuam); cartão aberto com as operações guardadas volta a poder
 * ser confirmado (aplica de novo sobre o projeto de agora).
 */
export function mensagemDoBanco(m: { id: string; papel: string; conteudo: string; anexos: unknown }, projeto: ProjetoDeEdicao | null): Mensagem | null {
  const anexos = Array.isArray(m.anexos) ? (m.anexos as unknown[]) : [];
  if (m.papel === "usuario") return { chave: `b${m.id}`, quem: "dono", itens: [{ tipo: "resposta", texto: String(m.conteudo || "") }], acoes: [], mensagemId: m.id, anexos: [] };
  if (m.papel !== "agente") return null;
  const log = anexos.find((a) => a && typeof a === "object" && (a as { tipo?: unknown }).tipo === TIPO_DO_LOG) as { itens?: unknown } | undefined;
  const itens: ItemDoLog[] = log && Array.isArray(log.itens)
    ? (log.itens as ItemDoLog[]).filter((i) => i && typeof i.texto === "string").map((i) => ({ tipo: (["plano", "ferramenta", "resposta", "aviso"].indexOf(i.tipo) >= 0 ? i.tipo : "resposta") as ItemDoLog["tipo"], texto: i.texto }))
    : [{ tipo: "resposta", texto: String(m.conteudo || "") }];
  const pergunta = anexos.find((a) => a && typeof a === "object" && (a as { tipo?: unknown }).tipo === TIPO_DA_PERGUNTA) as { opcoes?: unknown } | undefined;
  const acoes = acoesDaMensagem(anexos).map((a) => {
    if (PROPOSTAS_DA_ABA.has(a.id)) return a;
    const estado = estadoDaAcao(a);
    if (estado === "feita" && !a.sem_desfazer) return { ...a, resultados: (a.resultados || []).map((r) => ({ ...r, desfazer: null })) };
    if (estado === "aberta" && projeto && a.contexto && Array.isArray((a.contexto as { operacoes?: unknown }).operacoes)) {
      const ops = (a.contexto as { operacoes: Operacao[] }).operacoes;
      // base "recarregada" nunca bate: o Confirmar aplica as operações de novo sobre o projeto de agora (ou recusa com o motivo).
      guardarProposta(a.id, { skill: "brabo", titulo: "Agente editor", resumo: a.resumo, operacoes: ops, avisos: [], base: "recarregada", resultado: projeto });
    }
    return a;
  });
  return {
    chave: `b${m.id}`,
    quem: "agente",
    itens,
    acoes,
    mensagemId: m.id,
    anexos,
    opcoes: pergunta && Array.isArray(pergunta.opcoes) ? (pergunta.opcoes as unknown[]).map(String).slice(0, 4) : [],
  };
}

const ehExportar = (a: AcaoDoAgente) => a.itens.length > 0 && a.itens.every((i) => i.operacao === "exportar");
const ehGeracao = (a: AcaoDoAgente) => a.itens.length > 0 && a.itens.every((i) => i.operacao === "gerar_broll" || i.operacao === "gerar_elemento");
const saidaDaAcao = (a: AcaoDoAgente): SaidaDoAgente | null => (a.contexto && (a.contexto as { saida?: unknown }).saida ? ((a.contexto as { saida: SaidaDoAgente }).saida) : null);

/** Cor de destaque da marca aberta: a primária da paleta (ou a primeira). */
export function corDaPaleta(paleta: { hex: string; papel: string }[] | null | undefined): string | null {
  const l = (paleta || []).filter((c) => /^#[0-9a-fA-F]{6}$/.test(String(c.hex || "")));
  const p = l.find((c) => /prim|principal|destaque/i.test(String(c.papel || ""))) || l[0];
  return p ? p.hex : null;
}

/**
 * B-roll pedido (frente EDT, F4): consultar o andamento só no clique (15 s entre
 * consultas) e, pronto, pôr no trecho com um clique (um passo do desfazer).
 */
function AcompanharBroll({ acao, onPor }: { acao: AcaoDoAgente; onPor: (arq: ArquivoGerado, s: SaidaDoAgente) => void }) {
  const s = saidaDaAcao(acao);
  const pedidoId = acao.resultados && acao.resultados[0] ? String(acao.resultados[0].alvo_id || "") : "";
  const [estado, setEstado] = useState<{ lendo: boolean; texto: string | null; arquivo: ArquivoGerado | null; ultima: number }>({ lendo: false, texto: null, arquivo: null, ultima: 0 });
  if (!s || !pedidoId || !acao.executada_em) return null;
  const conferir = async () => {
    if (Date.now() - estado.ultima < 15000) return;
    setEstado((x) => ({ ...x, lendo: true, ultima: Date.now() }));
    try {
      const r = await chamarMesaVideos<{ pedidos?: { estado?: string; resultado?: { envios?: { estado?: string; arquivo_id?: string | null; erro?: string | null }[] } }[] }>({ acao: "gerar_status", pedido_id: pedidoId });
      const p = r && r.pedidos && r.pedidos[0];
      const envio = p && p.resultado && p.resultado.envios ? p.resultado.envios.find((e) => e.estado === "pronto" && e.arquivo_id) : null;
      if (!envio) {
        const erro = p && p.resultado && p.resultado.envios ? p.resultado.envios.find((e) => e.estado === "erro") : null;
        setEstado((x) => ({ ...x, lendo: false, texto: erro ? `Não saiu: ${erro.erro || "erro do motor"}` : "Ainda gerando. Confira de novo em uns minutos." }));
        return;
      }
      const { data } = await (supabase as any).from("video_arquivos").select("id, nome, storage_bucket, storage_path, duracao_s, largura, altura").eq("id", envio.arquivo_id).maybeSingle();
      setEstado((x) => ({ ...x, lendo: false, texto: data ? "Pronto." : "Pronto, mas o arquivo ainda não apareceu na Mídia.", arquivo: data || null }));
    } catch (e) {
      console.error("[agente editor] andamento do B-roll", e);
      setEstado((x) => ({ ...x, lendo: false, texto: textoDoErro(e) }));
    }
  };
  return (
    <div className="flex flex-wrap items-center pl-1 text-[12px]" data-acompanhar-broll="">
      {estado.arquivo ? (
        <button type="button" className={juntar(botao.primario, "mb-1 mr-1 h-8")} onClick={() => onPor(estado.arquivo as ArquivoGerado, s)}>
          Pôr no trecho de {tempoFino(Number(s.argumentos.de_s))}
        </button>
      ) : (
        <button type="button" className={juntar(botao.secundario, "mb-1 mr-1 h-8")} onClick={() => void conferir()} disabled={estado.lendo}>
          {estado.lendo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          Ver se ficou pronto
        </button>
      )}
      {estado.texto && <span className="mb-1 text-muted-foreground">{estado.texto}</span>}
    </div>
  );
}
const textoDaMensagem = (m: Mensagem) => {
  if (m.quem === "dono") return m.itens.map((i) => i.texto).join(" ");
  const r = m.itens.filter((i) => i.tipo === "resposta");
  return (r.length ? r[r.length - 1] : m.itens[m.itens.length - 1] || { texto: "" }).texto;
};

export default function AgenteEditor({
  projeto,
  controle,
  onAplicarProjeto,
  urls,
  semEditor,
  versaoId,
  selecao,
  cursor,
}: {
  projeto: ProjetoDeEdicao | null;
  controle: ControleDePropostas | null;
  onAplicarProjeto: ((p: ProjetoDeEdicao, rotulo: string) => void) | null;
  urls: Record<string, string>;
  /** Sem editor aberto: o que a lateral diz (o seletor de modelo continua em cima). */
  semEditor?: ReactNode;
  /** Versão do vídeo aberta: a conversa fica guardada nela (agente_conversas, referencia_tipo editor_agente). */
  versaoId?: string | null;
  /** Clipes escolhidos na linha do tempo (ids): "esse corte". */
  selecao?: string[];
  /** Tempo do cursor: "aqui". */
  cursor?: () => number;
}) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const grupos = useMemo(() => modelosDoAgente(catalogo || []), [catalogo]);
  const modelos = useMemo(() => grupos.reduce((l, g) => l.concat(g.modelos), [] as ModeloIa[]), [grupos]);
  const [escolha, setEscolha] = useEstadoDaTela<{ modelo: string; raciocinio: string; teto: number }>(`mesa-edicao:editor:agente:${clientId}`, { modelo: "", raciocinio: "", teto: TETO_PADRAO_USD }, { validar: (v) => !!v && typeof v === "object" });
  const [rascunho, setRascunho] = useEstadoDaTela<string>(`mesa-edicao:editor:agente:rascunho:${clientId}`, "", { esperaMs: 300 });
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [rodando, setRodando] = useState<string | null>(null);
  const [erroDoEnvio, setErroDoEnvio] = useState<string | null>(null);
  const [gasto, setGastoNaTela] = useState(0);
  const gastoRef = useRef(0);
  const setGasto = (v: number | ((x: number) => number)) => {
    gastoRef.current = typeof v === "function" ? v(gastoRef.current) : v;
    setGastoNaTela(gastoRef.current);
  };
  const [preparo, setPreparo] = useState<Preparo | null>(null);
  const parar = useRef(false);
  const refMsgs = useRef<HTMLDivElement | null>(null);
  const pendente = temPedidoPendente(clientId);
  // O controle e o projeto mais novos (as respostas chegam depois de esperas).
  const controleRef = useRef(controle);
  controleRef.current = controle;
  const projetoRef = useRef(projeto);
  projetoRef.current = projeto;
  const mensagensRef = useRef<Mensagem[]>([]);
  mensagensRef.current = mensagens;
  // Frente EDT: a marca aberta (logo e cor do kit) e a fila de render desta versão.
  const kit = useKitDaMesa();
  // 02/10: a Mídia do cliente (o agente busca e põe na linha) e o sha256 dos arquivos (takes repetidos).
  const arquivosQ = useArquivosDeVideo(clientId);
  const arquivos = (arquivosQ.data && arquivosQ.data.arquivos) || null;
  const midias = useMemo(() => (arquivos ? itensDaBiblioteca(arquivos) : []), [arquivos]);
  const assinaturas = useMemo(() => (arquivos ? assinaturasDosArquivos(arquivos) : {}), [arquivos]);
  const marca: MarcaParaOAgente = { logo_path: (kit.data && kit.data.logo_path) || null, cor: corDaPaleta(kit.data ? kit.data.paleta : null), nome: kit.marca ? kit.marca.nome : null };
  const filaDeRender = useFilaDeRender(clientId, versaoId || null, chamarEditorVideo, (p: PedidoNaFila) => {
    if (p.estado !== "pronto" || p.tipo === "onda") return;
    const atual = projetoRef.current;
    const entrada = (p.entrada || {}) as { inicio_s?: number; fim_s?: number };
    if (p.tipo === "amostra") {
      const padrao: MensagemPadraoDoEditor = { tipo: TIPO_DO_PADRAO, forma: "amostra", url: p.url, inicio_s: Number(entrada.inicio_s) || 0, fim_s: Number(entrada.fim_s) || 0, estilos: atual ? estilosLigados(atual, marca.cor) : [] };
      juntarMensagem({ quem: "agente", itens: [{ tipo: "resposta", texto: "Amostra pronta pra conferir. Se quiser mudar, me diz o tempo do trecho." }], acoes: [], mensagemId: null, anexos: [padrao], recemFeita: true });
    } else {
      juntarMensagem({ quem: "agente", itens: [{ tipo: "resposta", texto: `Vídeo inteiro pronto (no padrão aprovado). ${p.url ? "Está na barra do editor e na Mídia." : ""}` }], acoes: [], mensagemId: null, anexos: [], recemFeita: true });
    }
    rolarParaBaixo();
  });
  // Máquina da agência desligada: o agente não promete prazo (QA 30/09); o pedido espera na fila.
  const maquinaDesligadaRef = useRef(false);
  maquinaDesligadaRef.current = !!filaDeRender.worker && filaDeRender.worker.situacao !== "ligado";
  const quandoAMaquinaLigar = " A máquina da agência está desligada: o pedido espera na fila e roda quando ela ligar.";

  const modelo = modelos.find((m) => m.id === escolha.modelo) || modelos.find((m) => (m.padrao_para || []).indexOf("diretor_arte") >= 0) || modelos[0] || null;
  const raciocinios = (modelo && modelo.raciocinio) || [];
  const raciocinio = raciocinios.indexOf(escolha.raciocinio) >= 0 ? escolha.raciocinio : "";
  const contexto = useMemo(() => (projeto ? contextoDoAgente(projeto) : ""), [projeto]);
  const porPasso = modelo ? estimarPasso(modelo, contexto.length + 4000, raciocinio || null) : 0;
  const custo = custoDoPedido(porPasso, escolha.teto);
  const sugestao = modelo ? sugerirModeloMaisBarato(modelos, modelo.id, false, aceitaImagem) : null;
  const rolarParaBaixo = () => window.requestAnimationFrame(() => refMsgs.current && (refMsgs.current.scrollTop = refMsgs.current.scrollHeight));
  const juntarMensagem = (m: Omit<Mensagem, "chave"> & { chave?: string }): string => {
    const chave = m.chave || novaChave();
    setMensagens((l) => l.concat([{ ...m, chave }]));
    return chave;
  };
  const mudarMensagem = (chave: string, f: (m: Mensagem) => Mensagem) => setMensagens((l) => l.map((m) => (m.chave === chave ? f(m) : m)));
  const falar = (quem: Mensagem["quem"], itens: ItemDoLog[]) => juntarMensagem({ quem, itens, acoes: [], mensagemId: null, anexos: [] });

  // ---------------------------------------------------------------- reabrir: a conversa volta do banco
  const [lendo, setLendo] = useState(false);
  useEffect(() => {
    if (!versaoId || !clientId) return;
    let vivo = true;
    setLendo(true);
    chamarEditorVideo<{ mensagens?: { id: string; papel: string; conteudo: string; anexos: unknown }[] }>({ acao: "conversa_ler", client_id: clientId, versao_id: versaoId })
      .then((r) => {
        if (!vivo) return;
        const lidas = ((r && r.mensagens) || []).map((m) => mensagemDoBanco(m, projetoRef.current)).filter((m): m is Mensagem => !!m);
        if (!lidas.length) return;
        const ids = new Set(lidas.map((m) => m.mensagemId));
        setMensagens((l) => lidas.concat(l.filter((m) => !m.mensagemId || !ids.has(m.mensagemId))));
        rolarParaBaixo();
      })
      .catch((e) => {
        if (!vivo || emPreparacao(e)) return;
        console.error("[agente editor] conversa não lida", e);
        falar("agente", [{ tipo: "aviso", texto: `Não li a conversa guardada: ${textoDoErro(e)}` }]);
      })
      .finally(() => vivo && setLendo(false));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, versaoId]);

  /** Guarda a troca (pedido + resposta com os cartões). Sem versão aberta, só na tela. */
  const gravar = async (chaveDoAgente: string, pedidoTexto: string, m: Omit<Mensagem, "chave">, usoId: string | null) => {
    if (!versaoId) return;
    const anexos: unknown[] = ([{ tipo: TIPO_DO_LOG, itens: m.itens.slice(0, 60) }] as unknown[]).concat(m.acoes as unknown[], m.anexos);
    if (m.opcoes && m.opcoes.length) anexos.push({ tipo: TIPO_DA_PERGUNTA, opcoes: m.opcoes });
    try {
      const r = await chamarEditorVideo<{ mensagem_id?: string | null; aviso_registro?: string | null }>({
        acao: "conversa_gravar",
        client_id: clientId,
        versao_id: versaoId,
        usuario: { conteudo: pedidoTexto },
        agente: { conteudo: textoDaMensagem({ ...m, chave: chaveDoAgente }), anexos },
        uso_id: usoId,
      });
      const id = r && r.mensagem_id ? String(r.mensagem_id) : null;
      mudarMensagem(chaveDoAgente, (x) => ({ ...x, mensagemId: id, aviso: id ? r.aviso_registro || null : r.aviso_registro || "A resposta chegou, mas não ficou guardada na conversa." }));
      // Clicou no cartão antes de a mensagem existir no banco: o estado de agora vai junto (reabrir não oferece Confirmar de novo).
      const agora = mensagensRef.current.find((x) => x.chave === chaveDoAgente);
      if (id && agora) {
        agora.acoes.forEach((a) => {
          const enviada = m.acoes.find((x) => x.id === a.id);
          if (enviada && estadoDaAcao(enviada) !== estadoDaAcao(a)) marcarNoBanco(id, a);
        });
      }
    } catch (e) {
      if (emPreparacao(e)) return;
      console.error("[agente editor] conversa não gravada", e);
      mudarMensagem(chaveDoAgente, (x) => ({ ...x, aviso: `A resposta chegou, mas não ficou guardada na conversa (${textoDoErro(e)}).` }));
    }
  };

  /** O cartão mudou: a mensagem guardada acompanha (reabrir não volta a "Confirmar"). */
  const marcarNoBanco = (mensagemId: string, acao: AcaoDoAgente) => {
    chamarEditorVideo({ acao: "conversa_marcar", client_id: clientId, mensagem_id: mensagemId, cartao: acao }).catch((e) => {
      if (emPreparacao(e)) return;
      console.error("[agente editor] estado do cartão não gravado", e);
      toast.warning("Feito, mas não ficou guardado na conversa", { description: textoDoErro(e) });
    });
  };
  const marcar = (chave: string, acao: AcaoDoAgente) => {
    // A ref acompanha na hora (o gravar que chega depois compara com ela).
    mensagensRef.current = mensagensRef.current.map((m) => (m.chave === chave ? { ...m, acoes: m.acoes.map((a) => (a.id === acao.id ? acao : a)) } : m));
    mudarMensagem(chave, (m) => ({ ...m, acoes: m.acoes.map((a) => (a.id === acao.id ? acao : a)) }));
    const atual = mensagensRef.current.find((m) => m.chave === chave);
    const id = atual ? atual.mensagemId : null;
    if (id) marcarNoBanco(id, acao);
  };

  // Pedido deixado pelo agente de edição das outras etapas: vai para o campo quando o editor abriu (nada roda sem o clique).
  const comProjeto = !!projeto;
  useEffect(() => {
    if (!comProjeto) return;
    const p = pegarPedidoPendente(clientId);
    if (!p) return;
    setRascunho(p);
    falar("agente", [{ tipo: "resposta", texto: "Recebi o seu pedido do agente de edição. Confira o modelo e o custo em cima e mande." }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, pendente, comProjeto]);

  // ---------------------------------------------------------------- cartões
  /** Ordem clara (Jev, sem custo): a mudança vai na hora, com Desfazer. Sem resposta, cartão com Confirmar. */
  const ordemClara = async (pedido: string, resumo: string): Promise<boolean> => {
    try {
      const r = await chamarEditorVideo<{ clara?: boolean }>({ acao: "agente_ordem_clara", client_id: clientId, pedido, resumo });
      return !!(r && r.clara === true);
    } catch (e) {
      // Sem Jev: a regra do verbo decide ("apague o c3" vai; "será que tiro?" pede Confirmar).
      if (!emPreparacao(e)) console.warn("[agente editor] ordem clara sem resposta (vale a regra do verbo)", e);
      return ordemExplicita(pedido);
    }
  };

  /** Monta o cartão de uma proposta; aplica na hora quando pode (e diz no cartão "Feito na hora"). */
  const cartaoDaProposta = (id: string, prop: PropostaDaSkill, base: ProjetoDeEdicao, direto: boolean): AcaoDoAgente => {
    const prova = provaDaMudanca(base, prop.resultado);
    const acao = acaoDaProposta(id, AGENTE_DO_EDITOR, [prop.resumo, prova].filter(Boolean).join(" "), prop.operacoes, base, prop.avisos);
    guardarProposta(id, prop);
    const c = controleRef.current;
    if (direto && c && c.aplicar(prop, prop.titulo)) return { ...acaoFeita(acao, new Date().toISOString()), executada_direto: true };
    return comOperacoesGuardadas(acao, prop.operacoes);
  };

  const aoPedidoDe = (chave: string, acao: AcaoDoAgente) => async (pedido: PedidoDaAcao): Promise<RespostaDaAcao> => {
    const agora = new Date().toISOString();
    let anexo: AcaoDoAgente;
    let resposta: RespostaDaAcao;
    if (pedido === "descartar") {
      anexo = { ...acao, descartada_em: agora };
      resposta = { anexo };
    } else if (ehExportar(acao)) {
      if (pedido !== "confirmar") throw new Error("Exportar não tem Desfazer.");
      const p = projetoRef.current;
      if (!p) throw new Error("Abra o vídeo no editor para exportar.");
      // Frente EDT: o Confirmar põe o vídeo inteiro na fila de render (o ZIP fica como opção ao lado).
      if (!versaoId) throw new Error("Abra a versão no editor para renderizar.");
      const c = controleRef.current;
      if (c && c.salvarAgora) await c.salvarAgora();
      const r = await pedirRender(chamarEditorVideo, { clientId, versaoId, tipo: "render_final", uid: `x${acao.id}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80).padEnd(8, "0") });
      anexo = { ...acao, executada_em: agora, resultados: acao.itens.map((i) => ({ ref: i.ref, alvo_id: r.pedido.id, titulo: `${i.titulo}: ${r.ja_existia ? "já estava na fila" : maquinaDesligadaRef.current ? "na fila (a máquina da agência está desligada: roda quando ela ligar)" : "na fila da máquina da agência"}`, operacao: i.operacao, ok: true, desfazer: null })) };
      resposta = { anexo, feitos: 1, falhas: 0 };
    } else if (ehGeracao(acao)) {
      if (pedido !== "confirmar") throw new Error("Geração não tem Desfazer: o que foi gerado fica na Mídia.");
      const s = saidaDaAcao(acao);
      if (!s) throw new Error("Este cartão é de antes de recarregar e perdeu o pedido. Peça de novo ao agente.");
      const uid = `g${acao.id}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80).padEnd(8, "0");
      if (s.tipo === "gerar_broll") {
        const r = await confirmarBroll(chamarMesaVideos, clientId, s, uid);
        anexo = { ...acao, executada_em: agora, resultados: acao.itens.map((i) => ({ ref: i.ref, alvo_id: r.pedido_id, titulo: `${i.titulo}: pedido enviado (aparece na Mídia quando ficar pronto)`, operacao: i.operacao, ok: true, desfazer: null })) };
      } else {
        const r = await confirmarElemento(chamarEditorVideo, clientId, s, uid);
        const p = projetoRef.current;
        if (p && onAplicarProjeto) onAplicarProjeto(aplicarOperacoes(p, opsDoArquivoNoTrecho(p, r.arquivo, { tipo: "elemento", inicio_s: Number(s.argumentos.inicio_s) || 0, duracao_s: Number(s.argumentos.duracao_s) || 2.5 })), "Elemento gerado");
        anexo = { ...acao, executada_em: agora, resultados: acao.itens.map((i) => ({ ref: i.ref, alvo_id: r.arquivo.id, titulo: `${i.titulo}: gerado (US$ ${r.custo_usd.toFixed(2)}) e posto no trecho; Ctrl+Z tira da linha do tempo`, operacao: i.operacao, ok: true, desfazer: null })) };
      }
      setGasto((g) => g + (s.custo_usd || 0));
      atualizarCusto();
      resposta = { anexo, feitos: 1, falhas: 0 };
    } else {
      const prop = PROPOSTAS_DA_ABA.get(acao.id);
      const c = controleRef.current;
      if (!c) throw new Error("O editor não está aberto.");
      if (pedido === "desfazer") {
        if (!prop || !c.desfazer(prop)) throw new Error("Mudou depois de aplicar (ou a tela foi recarregada): use Ctrl+Z para voltar passo a passo, ou abra uma versão anterior.");
        anexo = { ...acaoFeita(acao, acao.executada_em || agora), executada_direto: acao.executada_direto, desfeita_em: agora };
        resposta = { anexo, voltaram: acao.itens.length };
      } else {
        if (!prop) throw new Error("Esta proposta é de antes de recarregar a tela e não guardou as mudanças. Peça de novo ao agente.");
        if (!c.aplicar(prop, "Agente editor")) throw new Error("O projeto mudou depois da proposta e as mudanças não cabem mais. Peça de novo ao agente.");
        anexo = acaoFeita(acao, agora);
        resposta = { anexo, feitos: anexo.itens.length, falhas: 0 };
      }
    }
    marcar(chave, anexo);
    return resposta;
  };

  // ---------------------------------------------------------------- respostas
  /** Pedido que não andou: a bolha sai e o texto volta ao campo, com o erro à vista. */
  const devolverAoCampo = (chaveDoDono: string, texto: string, erro: string) => {
    setMensagens((l) => l.filter((m) => m.chave !== chaveDoDono));
    setRascunho(texto);
    setErroDoEnvio(erro);
  };

  const responder = (pedidoTexto: string, m: Omit<Mensagem, "chave">, usoId: string | null = null) => {
    const chave = juntarMensagem({ ...m, recemFeita: true });
    void gravar(chave, pedidoTexto, m, usoId);
    rolarParaBaixo();
  };

  const proporDaSkill = (id: IdDaSkill, base: ProjetoDeEdicao, pedidoTexto: string, antes: ItemDoLog[] = [], direto = true) => {
    const prop = proporSkill(id, base, { agora: new Date().toISOString(), selecionados: selecao || [], assinaturas });
    if (!prop.operacoes.length) {
      responder(pedidoTexto, { quem: "agente", itens: antes.concat([{ tipo: "aviso", texto: `${prop.titulo}: ${prop.resumo}${prop.avisos.length ? ` ${prop.avisos.join(" ")}` : ""}` }]), acoes: [], mensagemId: null, anexos: [] });
      return;
    }
    // Atalho é ordem clara (um clique), sem custo e com Desfazer: vai na hora.
    const acao = cartaoDaProposta(`skill-${id}-${Date.now().toString(36)}`, prop.base ? prop : { ...prop, base: assinaturaDoProjeto(base) }, base, direto);
    const feita = !!acao.executada_em;
    const mudou = resumoDoQueMudou(base, prop.operacoes);
    if (feita) destacar(clientId, []);
    responder(pedidoTexto, {
      quem: "agente",
      itens: antes.concat([{ tipo: "resposta", texto: `${prop.titulo}: ${prop.resumo}${feita ? ` Mudei: ${mudou || "nada na linha do tempo"} O Desfazer volta tudo.` : ` Vou mudar: ${mudou || "nada"} Confira e confirme.`}` }]),
      acoes: [acao],
      mensagemId: null,
      anexos: [],
    });
  };

  /** Frente EDT: ferramentas que chamam o servidor no meio do laço (sem custo) e as estimativas das gerações pagas. */
  const ferramentaNoServidor = async (nome: string, a: Record<string, unknown>, trab: ProjetoDeEdicao): Promise<ResultadoDaFerramenta> => {
    const nada = (texto: string, ok = true): ResultadoDaFerramenta => ({ projeto: trab, operacoes: [], texto, ok });
    if (nome === "sugerir_animacoes") return sugerirAnimacoesNaTela(chamarEditorVideo, clientId, trab, a.densidade === "poucas" ? "poucas" : "medias");
    if (nome === "medir_onda") {
      if (!versaoId) return nada("Abra a versão no editor para medir a onda.", false);
      const fontes = fontesSemOnda(trab);
      if (!fontes.length) return nada("Todas as fontes já têm a onda medida.");
      const r = await pedirRender(chamarEditorVideo, { clientId, versaoId, tipo: "onda", uid: uidDoClique(), fontes });
      const texto = maquinaDesligadaRef.current
        ? `Pedi a onda de ${fontes.length} ${fontes.length === 1 ? "fonte" : "fontes"} (sem custo).${quandoAMaquinaLigar}`
        : `Pedi a onda de ${fontes.length} ${fontes.length === 1 ? "fonte" : "fontes"} à máquina da agência (uns 30 s, sem custo). Quando voltar, o corte pela onda pode rodar.`;
      return { ...nada(texto), naFila: { tipo: "onda", pedido_id: r.pedido.id } };
    }
    if (nome === "amostra") {
      const j = janelaDaAmostra(a.inicio_s, a.fim_s, trab.duracao_s);
      return { ...nada(`Amostra de ${tempoFino(j.inicio_s)} a ${tempoFino(j.fim_s)}: vai para a fila depois de aplicar o que mudou.`), naFila: { tipo: "amostra", pedido_id: "", inicio_s: j.inicio_s, fim_s: j.fim_s } };
    }
    // Rodada 2: o Jev julga a força das frases e os capítulos; o código põe no tempo (sem custo para o cliente).
    if (nome === "zoom_momentos" || nome === "capitulos") {
      const frases = frasesDoProjeto(trab);
      if (!frases.length) return nada("Sem fala marcada: não há frase para julgar (Timestamp).", false);
      const m = new Montador(trab);
      if (nome === "zoom_momentos") {
        let notas: { k: string; nota: number }[];
        let fonte = "Jev";
        try {
          const r = await momentosEmBlocos(chamarEditorVideo, { clientId, titulo: trab.titulo, frases, forca: true, virais: false });
          notas = comRegraNoResto(frases, r.forca);
          if (r.aviso) fonte = `Jev; ${r.aviso} O resto seguiu a regra da casa`;
        } catch (e) {
          console.error("[agente editor] momentos fortes pelo Jev", e);
          notas = notasPorRegra(frases);
          fonte = "regra da casa (o Jev não respondeu)";
        }
        const n = zoomNosMomentosEm(m, frases, notas, a.intensidade === "suave" || a.intensidade === "forte" ? String(a.intensidade) : "media");
        return { projeto: m.projeto, operacoes: m.operacoes, texto: n ? `${n} ${n === 1 ? "zoom" : "zooms"} nos momentos fortes (${fonte}).` : "Nenhuma frase forte o bastante.", ok: true };
      }
      const r = await capitulosEmBlocos(chamarEditorVideo, { clientId, frases });
      const n = capitulosEm(m, r.capitulos);
      return { projeto: m.projeto, operacoes: m.operacoes, texto: `${n ? `${n} ${n === 1 ? "capítulo" : "capítulos"}: ${r.capitulos.map((c) => `${tempoFino(c.inicio_s)} ${c.titulo}`).join("; ")}.` : "Um assunto só: sem capítulos."}${r.aviso ? ` ${r.aviso}` : ""}`, ok: true };
    }
    if (nome === "gerar_broll" || nome === "gerar_elemento") {
      const s = nome === "gerar_broll" ? await estimarBroll(chamarMesaVideos, clientId, trab, a) : await estimarElemento(chamarEditorVideo, clientId, a);
      return { ...nada(`Cartão pronto para o dono confirmar${s.custo_usd !== null ? ` (US$ ${s.custo_usd.toFixed(2)})` : " (sem custo conhecido: não gera)"}. Nada foi gerado ainda.`), saida: s };
    }
    return nada(`Ferramenta desconhecida: ${nome}.`, false);
  };

  const rodarPedido = async (pr: Preparo, base: ProjetoDeEdicao) => {
    if (!modelo || !pr.pedido) return;
    setRodando("Pensando");
    parar.current = false;
    const antes = gastoRef.current;
    try {
      const r = await rodarAgente({
        chamar: chamarEditorVideo,
        clientId,
        sessao: novoId(),
        pedido: pedidoComDica(pr.pedido),
        projeto: base,
        modeloId: modelo.id,
        raciocinio: raciocinio || null,
        tetoUsd: escolha.teto,
        agora: new Date().toISOString(),
        cancelado: () => parar.current,
        tela: { selecionados: selecao || [], cursor_s: cursor ? cursor() : null },
        conversa: pr.conversa,
        marca,
        midias,
        assinaturas,
        servidor: (ch, trab) => ferramentaNoServidor(ch.ferramenta, ch.argumentos || {}, trab),
        aoPasso: (log, g, passo) => {
          setGasto(antes + g);
          setRodando(`Passo ${passo} de até ${MAX_PASSOS}${log.length ? `: ${log[log.length - 1].texto.slice(0, 70)}` : ""}`);
        },
      });
      setGasto(antes + r.gasto_usd);
      const itens = (pr.antes || []).concat(r.log);
      const acoes: AcaoDoAgente[] = [];
      if (r.operacoes.length) {
        const prop: PropostaDaSkill = { skill: "brabo", titulo: "Agente editor", resumo: r.resposta || "Proposta do agente.", operacoes: r.operacoes, avisos: [], base: assinaturaDoProjeto(base), resultado: r.resultado };
        const travas = { operacoes: r.operacoes.length, falhas: r.falhas, recusadas: r.recusadas, parado: r.parado };
        // O Jev só é perguntado quando todas as outras travas deixam ir direto.
        const clara = podeAplicarDireto({ ...travas, ordemClara: true }).direto ? await ordemClara(pr.pedido, prop.resumo) : false;
        const d = podeAplicarDireto({ ...travas, ordemClara: clara });
        const cartao = cartaoDaProposta(`agente-${Date.now().toString(36)}`, prop, base, d.direto);
        acoes.push(cartao);
        // O que mudou, dito pelo código com os apelidos da tela (não depende do texto do modelo).
        if (r.mudancas) itens.push({ tipo: "resposta", texto: cartao.executada_em ? `Mudei: ${r.mudancas}` : `Vou mudar (confirme no cartão): ${r.mudancas}` });
        if (cartao.executada_em) destacar(clientId, r.tocados);
      }
      // Busca do agente ("mostre só os gerados"): o filtro vai para a Mídia e a linha do tempo.
      if (r.filtro) definirFiltro(clientId, r.filtro);
      if (r.exportar) acoes.push(acaoDeExportar(r.resultado));
      r.saidas.forEach((s) => acoes.push(acaoDaSaida(s)));
      if (!acoes.length && !r.opcoes.length) {
        if (!r.resposta) itens.push({ tipo: "aviso", texto: "Nada mudou na linha do tempo. Use um atalho abaixo ou diga o que mudar (ex.: corta os silêncios)." });
        else if (respostaPromete(r.resposta)) itens.push({ tipo: "aviso", texto: "Nada mudou ainda: o agente só prometeu. Peça de novo ou use um atalho." });
      }
      const anexos = [r.aprendido, r.seguidas, r.metodo].filter(Boolean) as unknown[];
      // Mensagens padrão (frente EDT): o cartão é o "O que mudei"; aqui vai o custo do pedido.
      const aGerar = r.saidas.reduce((x, s) => x + (s.custo_usd || 0), 0);
      anexos.push({ tipo: TIPO_DO_PADRAO, forma: "custo", pedido_usd: r.gasto_usd, conversa_usd: antes + r.gasto_usd, gerar_usd: r.saidas.length ? aGerar : null });
      responder(pr.texto, { quem: "agente", itens, acoes, mensagemId: null, anexos, opcoes: r.opcoes }, r.uso_id);
      // Amostra pedida pelo agente: vai para a fila depois de aplicar e salvar (sai do projeto salvo).
      const amostra = r.naFila.find((x) => x.tipo === "amostra" && !x.pedido_id);
      if (amostra && versaoId) {
        try {
          const c = controleRef.current;
          if (c && c.salvarAgora) await c.salvarAgora();
          await pedirRender(chamarEditorVideo, { clientId, versaoId, tipo: "amostra", uid: uidDoClique(), inicio_s: amostra.inicio_s, fim_s: amostra.fim_s });
          falar("agente", [{ tipo: "resposta", texto: maquinaDesligadaRef.current ? `Amostra de ${tempoFino(amostra.inicio_s || 0)} a ${tempoFino(amostra.fim_s || 0)} na fila.${quandoAMaquinaLigar} Aviso aqui quando ficar pronta.` : `Montando a amostra de ${tempoFino(amostra.inicio_s || 0)} a ${tempoFino(amostra.fim_s || 0)} na máquina da agência (uns 2 min). Aviso aqui quando ficar pronta.` }]);
        } catch (e) {
          console.error("[agente editor] amostra não pedida", e);
          falar("agente", [{ tipo: "aviso", texto: `A amostra não foi para a fila: ${emPreparacao(e) ? "falta publicar a função editor-video." : textoDoErro(e)}` }]);
        }
      }
    } catch (e) {
      const causa = e instanceof ErroDoPrimeiroPasso ? e.causa : e;
      const t = emPreparacao(causa) ? "O agente editor está em preparação: falta publicar a função editor-video." : textoDoErro(causa);
      console.error("[agente editor] pedido não andou", causa);
      devolverAoCampo(pr.chaveDoDono, pr.texto, t);
    } finally {
      setRodando(null);
      atualizarCusto();
      rolarParaBaixo();
    }
  };

  /** Fontes sem fala: as que a Entrada já marcou entram de graça; o resto paga o Timestamp. */
  const faltaDeFala = (p: ProjetoDeEdicao) => {
    const fontes = fontesSemFala(p);
    const pagas = fontes.filter((k) => {
      const f = p.fontes[k];
      return !(f && f.arquivo_id && lerFalaDaEntrada(clientId, f.arquivo_id));
    });
    return { fontes, custo: custoDaFala(p, pagas) };
  };

  const seguir = async (preparado: Preparo, comFala: boolean) => {
    let pr = preparado;
    if (!projeto) return;
    setPreparo(null);
    let base = projeto;
    if (comFala && pr.fontes.length) {
      setRodando("Marcando a fala");
      parar.current = false;
      try {
        const r = await marcarFalaDoProjeto(base, pr.fontes, { clientId, urls, agora: new Date().toISOString(), aoAndar: (t) => setRodando(t.slice(0, 90)), cancelado: () => parar.current });
        base = r.projeto;
        setGasto((g) => g + r.custo_usd);
        if (onAplicarProjeto) onAplicarProjeto(base, "Fala marcada");
        pr = { ...pr, antes: [{ tipo: "ferramenta", texto: `Timestamp: fala de ${r.marcadas} ${r.marcadas === 1 ? "vídeo marcada" : "vídeos marcada"} (${usd(r.custo_usd)}).` }] };
      } catch (e) {
        const t = emPreparacao(e) ? "O Timestamp está em preparação: falta publicar a função editor-video." : textoDoErro(e);
        devolverAoCampo(pr.chaveDoDono, pr.texto, `Não marquei a fala: ${t}`);
        setRodando(null);
        atualizarCusto();
        rolarParaBaixo();
        return;
      }
      setRodando(null);
    }
    if (pr.skill) proporDaSkill(pr.skill, base, pr.texto, pr.antes || []);
    else if (pr.pedido) await rodarPedido(pr, base);
    atualizarCusto();
    rolarParaBaixo();
  };

  const comecar = (pr: Omit<Preparo, "fontes" | "custoFala">, precisa: boolean) => {
    if (!projeto) return;
    const falta = precisa ? faltaDeFala(projeto) : { fontes: [], custo: 0 };
    const completo: Preparo = { ...pr, fontes: falta.fontes, custoFala: falta.custo };
    if (falta.fontes.length && falta.custo > 0) {
      setPreparo(completo);
      rolarParaBaixo();
      return;
    }
    void seguir(completo, falta.fontes.length > 0);
  };

  // ---------------------------------------------------------------- pedido ao agente
  const enviarTexto = (texto: string) => {
    const pedido = texto.trim();
    if (!pedido || !modelo || rodando || preparo || !projeto) return;
    setErroDoEnvio(null);
    const conversaAntes = conversaParaOModelo(mensagens.map((m) => ({ quem: m.quem, texto: textoDaMensagem(m) })));
    const chaveDoDono = falar("dono", [{ tipo: "resposta", texto: pedido }]);
    setRascunho("");
    rolarParaBaixo();
    // Só exportar: regra fixa, sem modelo e sem custo; vira o cartão com Confirmar.
    if (pedidoDeExportar(pedido)) {
      responder(pedido, { quem: "agente", itens: [{ tipo: "resposta", texto: "Pronto para exportar como está na linha do tempo. Confirme para baixar." }], acoes: [acaoDeExportar(projeto)], mensagemId: null, anexos: [] });
      return;
    }
    // Só tirar/achar takes repetidos: regra fixa, sem modelo e sem custo.
    const dup = pedidoDeTakesRepetidosDireto(pedido);
    if (dup.direto) {
      if (!dup.ordem) definirFiltro(clientId, { duplicados: true });
      proporDaSkill("remover_duplicados", projeto, pedido, [], dup.ordem);
      return;
    }
    comecar({ pedido, skill: null, texto: pedido, chaveDoDono, conversa: conversaAntes }, pedidoPrecisaDeFala(pedido));
  };
  const enviar = () => enviarTexto(rascunho);

  const atalho = (id: IdDaSkill, rotulo: string) => {
    if (rodando || preparo || !projeto) return;
    setErroDoEnvio(null);
    const chaveDoDono = falar("dono", [{ tipo: "resposta", texto: rotulo }]);
    rolarParaBaixo();
    comecar({ pedido: null, skill: id, texto: rotulo, chaveDoDono, conversa: "" }, skillPrecisaDeFala(id));
  };

  /** "Cancelar" no preparo da fala: nada foi feito, o pedido volta ao campo. */
  const cancelarPreparo = () => {
    if (!preparo) return;
    const pr = preparo;
    setPreparo(null);
    setMensagens((l) => l.filter((m) => m.chave !== pr.chaveDoDono));
    if (pr.pedido) setRascunho(pr.texto);
  };

  // ---------------------------------------------------------------- assistir (visão)
  const modeloDeVisao = modelo && aceitaImagem(modelo) ? modelo : modelos.find(aceitaImagem) || null;
  const aVer = useMemo(() => {
    if (!projeto) return [] as string[];
    const t = trilhaPrincipal(projeto);
    const chaves: string[] = [];
    (t ? t.clipes : []).forEach((c) => {
      if (!c.fonte || chaves.indexOf(c.fonte) >= 0) return;
      const f = projeto.fontes[c.fonte];
      if (f && f.midia === "video" && f.duracao_s && !projeto.visoes[c.fonte]) chaves.push(c.fonte);
    });
    return chaves;
  }, [projeto]);
  const amostrasDe = (k: string) => (projeto ? temposDeAmostra(projeto.fontes[k].duracao_s || 0, 24, 1).length : 0);
  const quadrosAVer = aVer.reduce((n, k) => n + amostrasDe(k), 0);
  const lotes = aVer.reduce((n, k) => n + Math.ceil(amostrasDe(k) / MAX_QUADROS_POR_CHAMADA), 0);
  const custoDeUmLote = (n: number) => (modeloDeVisao ? estimarPasso(modeloDeVisao, (n * 1600 + 900) * 4, null) : 0);
  const custoDaVisao = aVer.reduce((s, k) => {
    const n = amostrasDe(k);
    let soma = 0;
    for (let i = 0; i < n; i += MAX_QUADROS_POR_CHAMADA) soma += custoDeUmLote(Math.min(MAX_QUADROS_POR_CHAMADA, n - i));
    return s + soma;
  }, 0);
  const [confirmarVisao, setConfirmarVisao] = useState(false);

  const assistir = async () => {
    if (!modeloDeVisao || !projeto || !onAplicarProjeto) return;
    setConfirmarVisao(false);
    setRodando("Assistindo");
    parar.current = false;
    const referencia = novoId();
    let atual = projeto;
    let visto = 0;
    try {
      for (const chave of aVer) {
        const url = urls[chave];
        const f = projeto.fontes[chave];
        if (!url || !f.duracao_s) continue;
        const tempos = temposDeAmostra(f.duracao_s, 24, 1).map((t) => tempoDoQuadro(t, projeto.fps));
        const trechos: TrechoVisto[] = [];
        let amostras = 0;
        for (let i = 0; i < tempos.length; i += MAX_QUADROS_POR_CHAMADA) {
          if (parar.current) throw new Error("Parado. O que já foi visto ficou guardado.");
          const lote = tempos.slice(i, i + MAX_QUADROS_POR_CHAMADA);
          setRodando(`Vendo ${f.nome}: ${Math.min(i + lote.length, tempos.length)} de ${tempos.length} quadros`);
          const quadros: { tempo_s: number; jpeg_base64: string }[] = [];
          for (const t of lote) {
            const q = await extrairQuadro(url, t, { largura: 384, qualidade: 0.6 });
            if (q) quadros.push({ tempo_s: q.tempo_s, jpeg_base64: base64DoDataUrl(q.dataUrl) });
          }
          if (!quadros.length) throw new Error(`Não deu para ler os quadros de ${f.nome} aqui.`);
          const r = await chamarEditorVideo<{ trechos: TrechoVisto[]; custo_usd: number }>({
            acao: "visao_descrever",
            client_id: clientId,
            fonte: chave,
            modelo_id: modeloDeVisao.id,
            quadros,
            referencia_id: referencia,
            custo_maximo_usd: custoDeUmLote(quadros.length),
          });
          (r.trechos || []).forEach((x) => trechos.push(x));
          amostras += quadros.length;
          setGasto((g) => g + (Number(r.custo_usd) || 0));
        }
        const op: Operacao = { op: "visao", fonte: chave, visao: { trechos: trechos.slice(0, 120), modelo: modeloDeVisao.id, em: new Date().toISOString(), amostras } };
        atual = aplicarOperacao(atual, op);
        visto++;
        onAplicarProjeto(atual, `Visão de ${f.nome}`);
      }
      falar("agente", [{ tipo: "resposta", texto: visto ? `Assisti ${visto} ${visto === 1 ? "vídeo" : "vídeos"}. O que vi ficou guardado por trecho.` : "Nada novo para assistir." }]);
    } catch (e) {
      const t = emPreparacao(e) ? "Assistir está em preparação: falta publicar a função editor-video." : textoDoErro(e);
      falar("agente", [{ tipo: "aviso", texto: t }]);
      toast.error("Não terminou de assistir", { description: t });
    } finally {
      setRodando(null);
      atualizarCusto();
      rolarParaBaixo();
    }
  };

  // ---------------------------------------------------------------- telas
  const topo = (
    <div className="space-y-1.5" data-seletor-do-agente-editor="">
      <select
        className={juntar(campo, "h-9 text-[13px]")}
        value={modelo ? modelo.id : ""}
        onChange={(e) => setEscolha({ ...escolha, modelo: e.target.value, raciocinio: "" })}
        aria-label="Modelo do agente"
        disabled={!modelos.length}
        title={modelo ? `${nomeDoModelo(modelo)} pela ${nomeDoProvedor(modelo.provedor)}. ${precoDoModelo(modelo)} tokens (entrada/saída).` : undefined}
      >
        {!modelos.length && <option value="">Sem modelo de texto ativo no catálogo</option>}
        {grupos.map((g) => (
          <optgroup key={g.familia} label={g.familia}>
            {g.modelos.map((m) => (
              <option key={m.id} value={m.id}>
                {nomeDoModelo(m)} · {nomeDoProvedor(m.provedor)} · {precoDoModelo(m)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="flex min-w-0 items-center">
        <select className={juntar(campo, "mr-1 h-8 min-w-0 flex-1 text-[12px]")} value={raciocinio} onChange={(e) => setEscolha({ ...escolha, raciocinio: e.target.value })} aria-label="Esforço de raciocínio" disabled={!raciocinios.length}>
          <option value="">{raciocinios.length ? "Raciocínio padrão" : "Sem ajuste de raciocínio"}</option>
          {raciocinios.map((r) => (
            <option key={r} value={r}>
              Raciocínio {r}
            </option>
          ))}
        </select>
        <label className="flex shrink-0 items-center text-[11px] text-muted-foreground">
          <span className="mr-1">Teto US$</span>
          <input className={juntar(campo, "h-8 w-16 px-1.5 text-[12px] tabular-nums")} type="number" min={0.05} max={5} step={0.05} value={escolha.teto} onChange={(e) => setEscolha({ ...escolha, teto: Math.max(0.05, Math.min(5, Number(e.target.value) || TETO_PADRAO_USD)) })} aria-label="Teto por pedido em dólar" />
        </label>
      </div>
      <p className={juntar(texto.auxiliar, "truncate")} data-custo-do-pedido="" title={`~${usd(porPasso)} por passo; até ${MAX_PASSOS} passos e ${MAX_FERRAMENTAS} ferramentas por pedido.`}>
        Pedido ~{usd(custo.tipico)} (máx. {usd(custo.maximo)}) · gasto aqui {usd(gasto)}
      </p>
      {sugestao && (
        <button type="button" className="text-left text-[11px] text-primary hover:underline" onClick={() => setEscolha({ ...escolha, modelo: sugestao.id, raciocinio: "" })}>
          Sugestão: {nomeDoModelo(sugestao)} custa menos e dá conta de editar. Trocar?
        </button>
      )}
    </div>
  );

  const cartaoDoPreparo = preparo && projeto && (
    <div className="rounded-md bg-muted/50 px-2.5 py-2 text-[12px]" data-preparo-da-fala="">
      <p className="mb-1.5 flex items-start">
        <Timer className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span>
          Primeiro marco a fala de {preparo.fontes.length} {preparo.fontes.length === 1 ? "vídeo" : "vídeos"} ({tempoFino(preparo.fontes.reduce((s, k) => s + (projeto.fontes[k].duracao_s || 0), 0))}) com o Timestamp: <strong className="tabular-nums">{usd(preparo.custoFala)}</strong>.{" "}
          {preparo.pedido ? `Depois o agente edita (~${usd(custo.tipico)}).` : "A skill é de graça."}
        </span>
      </p>
      <div className="flex flex-wrap">
        <button type="button" className={juntar(botao.primario, "mb-1 mr-1 h-8")} onClick={() => void seguir(preparo, true)} data-marcar-e-seguir="">
          Marcar e seguir por ~{usd(preparo.custoFala + (preparo.pedido ? custo.tipico : 0))}
        </button>
        <button type="button" className={juntar(botao.secundario, "mb-1 mr-1 h-8")} onClick={() => void seguir(preparo, false)}>
          Sem marcar
        </button>
        <button type="button" className={juntar(botao.discreto, "mb-1 h-8")} onClick={cancelarPreparo}>
          Cancelar
        </button>
      </div>
    </div>
  );

  return (
    <PainelDoAgente
      titulo="Agente editor"
      descricao={modelo ? `${nomeDoModelo(modelo)} · edita a linha do tempo` : "Edita a linha do tempo"}
      icone={<Bot className="h-4 w-4" />}
      topo={topo}
      refDasMensagens={refMsgs}
      rotuloDasMensagens="Conversa com o agente editor"
      acoes={
        <button type="button" className={botao.icone} onClick={() => (aVer.length ? setConfirmarVisao(true) : toast.info(projeto ? "Tudo já foi assistido." : "Abra um vídeo no editor."))} aria-label="Assistir o vídeo" title="Assistir o vídeo (quadros para um modelo com imagem)" disabled={!!rodando || !projeto}>
          <Eye className="h-4 w-4" />
        </button>
      }
      avisos={
        <>
          {confirmarVisao && (
            <div className="flex flex-wrap items-center rounded-md bg-muted/50 px-2.5 py-2 text-[12px]">
              <span className="mb-1 mr-auto">
                Assistir {aVer.length} {aVer.length === 1 ? "vídeo" : "vídeos"} ({quadrosAVer} quadros, {lotes} {lotes === 1 ? "envio" : "envios"}) com {modeloDeVisao ? nomeDoModelo(modeloDeVisao) : "nenhum modelo com imagem"}: ~{usd(custoDaVisao)}
              </span>
              <button type="button" className={juntar(botao.primario, "mb-1 mr-1 h-8")} onClick={() => void assistir()} disabled={!modeloDeVisao}>
                Assistir por ~{usd(custoDaVisao)}
              </button>
              <button type="button" className={juntar(botao.discreto, "mb-1 h-8")} onClick={() => setConfirmarVisao(false)}>
                Cancelar
              </button>
            </div>
          )}
          {cartaoDoPreparo}
          {erroDoEnvio && (
            <p className="text-[13px] text-destructive [overflow-wrap:anywhere]" role="alert" data-erro-do-envio="">
              Não foi: {erroDoEnvio} O pedido voltou para o campo.
            </p>
          )}
        </>
      }
      compositor={
        <div className="min-w-0">
          <div className="flex flex-wrap" role="group" aria-label="Atalhos do agente editor">
            {ATALHOS.map((a) => (
              <button
                key={a.skill}
                type="button"
                disabled={!!rodando || !!preparo || !projeto}
                onClick={() => atalho(a.skill, a.rotulo)}
                data-atalho-do-editor={a.skill}
                className="mb-1 mr-1 max-w-full truncate rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
              >
                {a.rotulo}
              </button>
            ))}
          </div>
          <form
            className="flex min-w-0 items-end"
            onSubmit={(e) => {
              e.preventDefault();
              enviar();
            }}
          >
            <textarea
              className={juntar(campoTexto, "mr-1.5 min-h-[40px] flex-1 resize-none py-2")}
              rows={2}
              value={rascunho}
              onChange={(e) => {
                setRascunho(e.target.value);
                if (erroDoEnvio) setErroDoEnvio(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  enviar();
                }
              }}
              placeholder={!modelo ? "Nenhum modelo de texto ativo no catálogo" : projeto ? "Ex.: edite com a skill do Brabo" : "Abra um vídeo no editor"}
              aria-label="Pedido para o agente editor"
              disabled={!modelo || !projeto}
              maxLength={MAX_TEXTO_DO_PEDIDO}
            />
            {rodando ? (
              <button type="button" className={botao.icone} onClick={() => (parar.current = true)} aria-label="Parar o agente">
                <Square className="h-4 w-4" />
              </button>
            ) : (
              <button type="submit" className={juntar(botao.primario, "h-10 w-10 px-0")} disabled={!rascunho.trim() || !modelo || !projeto || !!preparo} aria-label="Mandar para o agente">
                <Send className="h-4 w-4" />
              </button>
            )}
          </form>
        </div>
      }
    >
      {!projeto && <div className={juntar(texto.auxiliar, "px-1 py-2")} data-agente-sem-editor="">{semEditor || "Abra um vídeo no editor para o agente editar."}</div>}
      {projeto && !mensagens.length && !rodando && <p className={juntar(conversa.apoio, "px-1 py-2")}>{lendo ? "Lendo a conversa desta versão." : "Peça uma edição ou use um atalho. Ordem clara vai na hora, com Desfazer; o resto você confirma."}</p>}
      {mensagens.map((m) => (
        <div key={m.chave} className="min-w-0 space-y-1.5" data-mensagem-do-editor={m.quem}>
          <div className={juntar(conversa.balao, "space-y-1", m.quem === "dono" ? conversa.doUsuario : conversa.doAgente)}>
            {m.itens.map((i, j) => (
              <p key={j} className={juntar("[overflow-wrap:anywhere]", i.tipo === "ferramenta" && "text-[13px] text-muted-foreground", i.tipo === "aviso" && "text-[13px] text-amber-500", i.tipo === "plano" && "italic text-muted-foreground")}>
                {i.texto}
              </p>
            ))}
            {m.quem === "agente" && lerMensagensPadrao(m.anexos).map((x, k) => <MensagemPadrao key={k} m={x} />)}
            {m.quem === "agente" && (
              <AprendizadoDoAgente
                anexos={m.anexos}
                onEsquecer={(id) => chamarEditorVideo({ acao: "aprendizado_esquecer", client_id: clientId, id, mensagem_id: m.mensagemId })}
                onGuardar={(texto, tipo) => chamarEditorVideo({ acao: "aprendizado_guardar", client_id: clientId, texto, tipo, mensagem_id: m.mensagemId })}
              />
            )}
            {m.aviso && <p className="text-[11px] text-amber-500" data-aviso-registro="">{m.aviso}</p>}
          </div>
          {m.opcoes && m.opcoes.length > 0 && (
            <div className="flex flex-wrap" role="group" aria-label="Respostas para o agente" data-opcoes-do-editor="">
              {m.opcoes.map((o) => (
                <button
                  key={o}
                  type="button"
                  disabled={!!rodando || !!preparo || !modelo || !projeto}
                  onClick={() => enviarTexto(o)}
                  className="mb-1 mr-1 max-w-full truncate rounded-full border border-border bg-background px-2.5 py-1 text-[12px] transition-colors hover:border-primary/50 disabled:opacity-50"
                >
                  {o}
                </button>
              ))}
            </div>
          )}
          {m.acoes.map((a) => (
            <div key={a.id} className="min-w-0 space-y-1">
              <CartaoDeAcao
                acao={a}
                titulo={ehExportar(a) ? "Renderizar" : ehGeracao(a) ? "Gerar (pago)" : a.executada_direto ? "O que mudei" : "O que vou mudar"}
                onPedido={aoPedidoDe(m.chave, a)}
                recemFeita={m.recemFeita}
                renderConfirmar={
                  ehExportar(a)
                    ? (confirmar, ocupado) => (
                        <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => void confirmar()} disabled={ocupado} data-confirmar-render="">
                          {ocupado ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Film className="mr-1.5 h-3.5 w-3.5" />}
                          Renderizar
                        </button>
                      )
                    : ehGeracao(a)
                      ? (confirmar, ocupado) => (
                          <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => void confirmar()} disabled={ocupado || a.custo_estimado_usd === null || a.custo_estimado_usd === undefined} data-confirmar-geracao="">
                            {ocupado ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1.5 h-3.5 w-3.5" />}
                            {typeof a.custo_estimado_usd === "number" ? `Gerar por ${usd(a.custo_estimado_usd)}` : "Sem custo conhecido"}
                          </button>
                        )
                      : undefined
                }
                observacao={ehExportar(a) ? "Sem custo. Vai para a fila da máquina da agência." : ehGeracao(a) ? "Custo na carteira do cliente. Só gera com o seu clique." : "Nada muda até confirmar. O Desfazer volta o pedido inteiro."}
              />
              {ehExportar(a) && (
                <button
                  type="button"
                  className={juntar(botao.discreto, "h-8 text-[12px]")}
                  onClick={() => {
                    const p = projetoRef.current;
                    if (!p) return toast.info("Abra o vídeo no editor para baixar.");
                    baixarExportacao(p, urls, new Date().toISOString()).catch((e) => toast.error("O ZIP não saiu", { description: textoDoErro(e) }));
                  }}
                  data-baixar-zip=""
                  title="Projeto, edl.json e o passo a passo para renderizar à mão na máquina da agência."
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Baixar ZIP
                </button>
              )}
              {ehGeracao(a) && a.itens[0] && a.itens[0].operacao === "gerar_broll" && (
                <AcompanharBroll
                  acao={a}
                  onPor={(arq, s) => {
                    const p = projetoRef.current;
                    if (!p || !onAplicarProjeto) return;
                    try {
                      onAplicarProjeto(aplicarOperacoes(p, opsDoArquivoNoTrecho(p, arq, { tipo: "broll", inicio_s: Number(s.argumentos.de_s) || 0, duracao_s: Math.max(0.5, (Number(s.argumentos.ate_s) || 0) - (Number(s.argumentos.de_s) || 0)) })), "B-roll no trecho");
                      toast.success("B-roll no trecho", { description: "Ctrl+Z tira." });
                    } catch (e) {
                      toast.error("Não coube no trecho", { description: textoDoErro(e) });
                    }
                  }}
                />
              )}
            </div>
          ))}
        </div>
      ))}
      {rodando && (
        <p className={juntar(conversa.apoio, "flex items-center")}>
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          {rodando}
        </p>
      )}
    </PainelDoAgente>
  );
}
