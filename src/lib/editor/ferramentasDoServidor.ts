import type { ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import type { ChamadaDeFerramenta } from "../../../supabase/functions/editor-video/ferramentas";
import { normalizarPlano, planoComPedido, planoPadrao, RECEITAS, type PlanoDaEdicao } from "../../../supabase/functions/editor-video/modulos/plano-da-edicao";
import { comJulgamento, lerPedidoDoDono, pecaPermitida, receitaPeloPedido, type PedidoDoDono, type PecaDoPedido } from "../../../supabase/functions/editor-video/modulos/pedido-do-dono";
import { janelaDaAmostra } from "../../../supabase/functions/_shared/render-do-editor";
import { chaveNoProjeto, fonteDoItem, type ItemDaBiblioteca } from "./biblioteca";
import { montarEdicaoCompleta, projetoDepoisDoCorte, type MarcaDaEdicao, type PassoDaEdicao } from "./edicaoCompleta";
import { acervoParaBroll, comRegraNoResto, julgar } from "./editarComIa";
import { capitulosEmBlocos, momentosEmBlocos } from "./julgarEmBlocos";
import { capitulosEm, frasesDoProjeto, notasPorRegra, zoomNosMomentosEm, type ItemParaBroll } from "./skills/pecasDaEdicao";
import { Montador } from "./skills/tipos";
import { tempoFino } from "./tempo";
import { falaNaLinhaDoTempo } from "./transcricao";
import { fontesSemOnda, pedirRender, uidDoClique } from "./render";
import { estimarBroll, estimarElemento, sugerirAnimacoesNaTela } from "./geracaoDoAgente";
import type { Operacao } from "./operacoes";
import type { ResultadoDaFerramenta } from "./agente";

/**
 * As ferramentas do agente que chamam o servidor no meio do laço (02/10:
 * saíram de AgenteEditor.tsx para cá, para testar ponta a ponta sem a tela).
 *
 * - edicao_completa (EDIT IA PRO): o motor da casa inteiro, sozinho, como o
 *   painel "Editar com IA" faz: plano da receita (de graça) com o que o agente
 *   pediu por cima, limpo pelo código (normalizarPlano), corte (erros e
 *   pausas), ritmo do Brabo, julgamentos pelo Jev (sem custo para o cliente;
 *   sem Jev, a regra da casa), e montarEdicaoCompleta. Sai UMA lista de
 *   operações (um passo do Ctrl+Z, com Desfazer).
 * - zoom_momentos, capitulos, sugerir_animacoes: Jev, sem custo.
 * - medir_onda, amostra: fila da máquina da agência, sem custo.
 * - gerar_broll, gerar_elemento: só ESTIMAM (cartão com o custo e Confirmar).
 * - pesquisar: busca na web pelo modelo do agente (paga, dentro do teto do
 *   pedido que o dono viu antes de mandar), com as fontes.
 */

type Chamar = (corpo: Record<string, unknown>) => Promise<any>;

export interface ArgsDaEdicaoCompleta {
  receita?: unknown;
  plano?: unknown;
  ritmo?: unknown;
  batida_s?: unknown;
  musica?: unknown;
  /** 02/10: o texto do dono (a tela junta; o modelo não precisa mandar). O pedido é lei. */
  pedido_do_dono?: unknown;
  /** Nome e cargo de quem fala ("Ana Souza | advogada"), quando o dono disse. */
  quem_fala?: unknown;
}

/** Nome e cargo ditos no pedido ("nome: Ana Souza | advogada", "ela é a Ana Souza, advogada"). */
export function quemFalaDoPedido(texto: string): { nome: string; cargo: string } | null {
  const t = String(texto || "");
  const m = /\bnome\s*[:=]\s*([^|,.;\n]{3,40})(?:\s*[|,]\s*([^.;\n]{3,40}))?/i.exec(t);
  if (!m) return null;
  return { nome: m[1].trim(), cargo: (m[2] || "").trim() };
}

/**
 * O pedido lido e, quando sobra dúvida ("talvez uma música"), o Jev julga no
 * servidor (pedido_julgar, sem custo para o cliente). Sem Jev, a dúvida fica
 * com a receita da casa e o aviso diz isso.
 */
export async function pedidoEntendido(chamar: Chamar, clientId: string, texto: string): Promise<{ pedido: PedidoDoDono; aviso: string | null }> {
  const pedido = lerPedidoDoDono(texto);
  if (!pedido.ambiguos.length) return { pedido, aviso: null };
  try {
    const r = await chamar({ acao: "pedido_julgar", client_id: clientId, pedido: texto, pecas: pedido.ambiguos });
    const querer = (r && r.querer) || {};
    return { pedido: comJulgamento(pedido, querer as Partial<Record<PecaDoPedido, number>>), aviso: null };
  } catch (e) {
    console.error("[agente editor] julgamento do pedido", e);
    return { pedido, aviso: `Ficou em dúvida no pedido (${pedido.ambiguos.join(", ")}) e o Jev não respondeu: valeu a receita da casa.` };
  }
}

const RITMO_POR_RECEITA: Record<string, boolean> = { dinamico: true, anuncio: true, podcast: false, aula: false, depoimento: false, institucional: false };

/** Mescla um nível (o que o agente pediu por cima do plano da receita). */
function mesclar(base: PlanoDaEdicao, por: unknown): Record<string, unknown> {
  const o = por && typeof por === "object" && !Array.isArray(por) ? (por as Record<string, unknown>) : {};
  const saida: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) };
  Object.keys(o).forEach((k) => {
    const v = o[k];
    const atual = saida[k];
    if (v && typeof v === "object" && !Array.isArray(v) && atual && typeof atual === "object") saida[k] = { ...(atual as Record<string, unknown>), ...(v as Record<string, unknown>) };
    else if (v !== undefined) saida[k] = v;
  });
  return saida;
}

const ehAudio = (i: ItemDaBiblioteca) => i.tipo === "audio" || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(i.storage_path);

/** Música para a edição: a pedida (m3 ou nome), a do projeto, ou a primeira do acervo do cliente. */
export function musicaParaAEdicao(m: Montador, midias: ItemDaBiblioteca[], pedida: unknown): { chave: string | null; aviso: string | null } {
  const doProjeto = Object.keys(m.projeto.fontes).filter((k) => m.projeto.fontes[k].midia === "audio" && m.projeto.fontes[k].storage_bucket !== "publico");
  const ref = String(pedida === undefined || pedida === null ? "" : pedida).trim();
  if (ref === "nenhuma" || ref === "sem") return { chave: null, aviso: null };
  let item: ItemDaBiblioteca | null = null;
  if (/^m\d+$/.test(ref)) item = midias[Number(ref.slice(1)) - 1] || null;
  else if (ref) {
    const noProjeto = doProjeto.find((k) => k === ref || m.projeto.fontes[k].nome === ref);
    if (noProjeto) return { chave: noProjeto, aviso: null };
    item = midias.find((i) => ehAudio(i) && (i.nome === ref || i.nome.toLowerCase().indexOf(ref.toLowerCase()) >= 0)) || null;
  }
  if (item && !ehAudio(item)) return { chave: doProjeto[0] || null, aviso: `${item.nome} não é um áudio.` };
  if (!item && doProjeto.length) return { chave: doProjeto[0], aviso: null };
  if (!item) item = midias.find(ehAudio) || null;
  if (!item) return { chave: null, aviso: "Sem música no projeto nem no acervo do cliente: a edição saiu sem trilha (suba um áudio na Entrada)." };
  const c = chaveNoProjeto(m.projeto, item);
  if (c.nova) m.aplicar({ op: "fonte", fonte: fonteDoItem(c.chave, item) });
  return { chave: c.chave, aviso: null };
}

export interface EdicaoCompletaDoAgente extends ResultadoDaFerramenta {
  passos: PassoDaEdicao[];
  plano: PlanoDaEdicao;
  /** O que NÃO foi feito por causa do pedido e o checklist de engajamento (vão na mensagem final). */
  foraPeloPedido: string[];
  engajamento: string[];
}

/** EDIT IA PRO pelo agente: o motor inteiro, de ponta a ponta, numa proposta só. */
export async function edicaoCompletaDoAgente(
  chamar: Chamar,
  e: { clientId: string; projeto: ProjetoDeEdicao; args: ArgsDaEdicaoCompleta; marca: MarcaDaEdicao | null; midias: ItemDaBiblioteca[]; agora: string; aoAndar?: (t: string) => void },
): Promise<EdicaoCompletaDoAgente> {
  const textoDoDono = String(e.args.pedido_do_dono || "");
  // 02/10 (dono): receita calma só quando o PEDIDO pede; a profissão do cliente nunca deixa a edição tímida.
  const receita = receitaPeloPedido(RECEITAS.some((r) => r.id === e.args.receita) ? String(e.args.receita) : "dinamico", textoDoDono);
  const entendido = textoDoDono ? await pedidoEntendido(chamar, e.clientId, textoDoDono) : { pedido: null, aviso: null };
  const pedido = entendido.pedido;
  const m0 = new Montador(e.projeto);
  const musicaPedida = e.args.musica !== undefined ? e.args.musica : e.args.plano && typeof e.args.plano === "object" ? ((e.args.plano as Record<string, unknown>).musica as Record<string, unknown> | undefined || {}).fonte : undefined;
  // Sem música no pedido: nem procura (nada de mídia nova no projeto).
  const mu = pedido && !pecaPermitida(pedido, "musica") ? { chave: null, aviso: null } : musicaParaAEdicao(m0, e.midias || [], musicaPedida);
  const projeto = m0.projeto;
  const musicas = mu.chave ? [mu.chave] : [];
  const fala = falaNaLinhaDoTempo(projeto).map((w) => w.t).join(" ");
  const bruto = mesclar(planoPadrao(receita, musicas), e.args.plano);
  if (mu.chave) bruto.musica = { ...((bruto.musica as Record<string, unknown>) || {}), fonte: mu.chave };
  const { plano, avisos } = normalizarPlano({ ...bruto, receita }, { fontesDeAudio: musicas, fala });
  if (mu.aviso && (!pedido || pedido.sem.indexOf("musica") < 0)) avisos.push(mu.aviso);
  if (entendido.aviso) avisos.push(entendido.aviso);
  const querRitmo = e.args.ritmo === true || (e.args.ritmo !== false && RITMO_POR_RECEITA[receita]);
  const batida = Number(e.args.batida_s);
  const ritmo = querRitmo ? { batida_s: isFinite(batida) && batida >= 1 ? Math.min(6, batida) : 3, zoom: 1.08 } : null;
  const cortado = projetoDepoisDoCorte(projeto, plano, e.agora, pedido);
  const acervo = acervoParaBroll(cortado, (e.midias || []) as ItemParaBroll[]);
  let julgados: Awaited<ReturnType<typeof julgar>> = { dados: {}, avisos: [] };
  try {
    julgados = await julgar(chamar, e.clientId, cortado, planoComPedido(plano, pedido).plano, acervo, e.aoAndar);
  } catch (x) {
    console.error("[agente editor] julgamentos da edição completa", x);
    julgados = { dados: {}, avisos: ["Os julgamentos do Jev não responderam: valeu a regra da casa."] };
  }
  const quem = typeof e.args.quem_fala === "string" ? quemFalaDoPedido(`nome: ${e.args.quem_fala}`) : quemFalaDoPedido(textoDoDono);
  const r = montarEdicaoCompleta(projeto, plano, { ...julgados.dados, agora: e.agora, marca: e.marca, ritmo, pedido, quemFala: quem });
  const operacoes: Operacao[] = m0.operacoes.concat(r.proposta.operacoes);
  const feitos = r.passos.filter((p) => p.feito);
  const fora = r.passos.filter((p) => !p.feito);
  const linhas = [`EDIT IA PRO (receita ${receita}): ${feitos.length} ${feitos.length === 1 ? "peça montada" : "peças montadas"}.`];
  if (pedido && pedido.lido.length) linhas.push(`pedido do dono: ${pedido.lido.join(", ")}`);
  feitos.forEach((p) => linhas.push(`feito ${p.rotulo}: ${p.detalhe}`));
  fora.filter((p) => p.pedido).forEach((p) => linhas.push(`não feito por pedido ${p.rotulo}: ${p.detalhe}`));
  fora.filter((p) => !p.pedido).forEach((p) => linhas.push(`não entrou ${p.rotulo}: ${p.detalhe}`));
  linhas.push(`engajamento: ${r.checklist.linhas.join("; ")}`);
  avisos.concat(julgados.avisos).concat(r.proposta.avisos).forEach((a) => linhas.push(`aviso: ${a}`));
  return {
    projeto: operacoes.length ? r.proposta.resultado : e.projeto,
    operacoes: operacoes.length && r.proposta.operacoes.length ? operacoes : [],
    texto: linhas.join("\n"),
    ok: feitos.length > 0,
    passos: r.passos,
    plano,
    foraPeloPedido: r.passos.filter((x) => x.pedido).map((x) => x.rotulo.toLowerCase()),
    engajamento: r.checklist.linhas,
  };
}

export interface DepsDoServidor {
  chamarEditor: Chamar;
  chamarVideos: Chamar;
  clientId: string;
  versaoId: string | null;
  marca: MarcaDaEdicao | null;
  midias: () => ItemDaBiblioteca[];
  agora: () => string;
  maquinaDesligada?: () => boolean;
  quandoAMaquinaLigar?: string;
  /** Pesquisa na web: o modelo do agente e a sessão (o gasto conta no teto do pedido). */
  pesquisa?: { modeloId: string; sessao: string; tetoUsd: number } | null;
  aoAndar?: (t: string) => void;
}

/** O executor das ferramentas do servidor, com as dependências da tela. */
export function criarFerramentasDoServidor(d: DepsDoServidor): (ch: ChamadaDeFerramenta, trab: ProjetoDeEdicao) => Promise<ResultadoDaFerramenta> {
  return async (ch, trab) => {
    const a = ch.argumentos || {};
    const nome = ch.ferramenta;
    const nada = (texto: string, ok = true): ResultadoDaFerramenta => ({ projeto: trab, operacoes: [], texto, ok });
    if (nome === "edicao_completa") {
      const r = await edicaoCompletaDoAgente(d.chamarEditor, { clientId: d.clientId, projeto: trab, args: a, marca: d.marca, midias: d.midias(), agora: d.agora(), aoAndar: d.aoAndar });
      return { projeto: r.projeto, operacoes: r.operacoes, texto: r.texto, ok: r.ok };
    }
    if (nome === "sugerir_animacoes") return sugerirAnimacoesNaTela(d.chamarEditor, d.clientId, trab, a.densidade === "poucas" ? "poucas" : "medias");
    if (nome === "medir_onda") {
      if (!d.versaoId) return nada("Abra a versão no editor para medir a onda.", false);
      const fontes = fontesSemOnda(trab);
      if (!fontes.length) return nada("Todas as fontes já têm a onda medida.");
      const r = await pedirRender(d.chamarEditor, { clientId: d.clientId, versaoId: d.versaoId, tipo: "onda", uid: uidDoClique(), fontes });
      const desligada = d.maquinaDesligada ? d.maquinaDesligada() : false;
      const texto = desligada
        ? `Pedi a onda de ${fontes.length} ${fontes.length === 1 ? "fonte" : "fontes"} (sem custo).${d.quandoAMaquinaLigar || ""}`
        : `Pedi a onda de ${fontes.length} ${fontes.length === 1 ? "fonte" : "fontes"} à máquina da agência (uns 30 s, sem custo). Quando voltar, o corte pela onda pode rodar.`;
      return { ...nada(texto), naFila: { tipo: "onda", pedido_id: r.pedido.id } };
    }
    if (nome === "amostra") {
      const j = janelaDaAmostra(a.inicio_s, a.fim_s, trab.duracao_s);
      return { ...nada(`Amostra de ${tempoFino(j.inicio_s)} a ${tempoFino(j.fim_s)}: vai para a fila depois de aplicar o que mudou.`), naFila: { tipo: "amostra", pedido_id: "", inicio_s: j.inicio_s, fim_s: j.fim_s } };
    }
    if (nome === "zoom_momentos" || nome === "capitulos") {
      const frases = frasesDoProjeto(trab);
      if (!frases.length) return nada("Sem fala marcada: não há frase para julgar (Timestamp).", false);
      const m = new Montador(trab);
      if (nome === "zoom_momentos") {
        let notas: { k: string; nota: number }[];
        let fonte = "Jev";
        try {
          const r = await momentosEmBlocos(d.chamarEditor, { clientId: d.clientId, titulo: trab.titulo, frases, forca: true, virais: false });
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
      const r = await capitulosEmBlocos(d.chamarEditor, { clientId: d.clientId, frases });
      const n = capitulosEm(m, r.capitulos);
      return { projeto: m.projeto, operacoes: m.operacoes, texto: `${n ? `${n} ${n === 1 ? "capítulo" : "capítulos"}: ${r.capitulos.map((c) => `${tempoFino(c.inicio_s)} ${c.titulo}`).join("; ")}.` : "Um assunto só: sem capítulos."}${r.aviso ? ` ${r.aviso}` : ""}`, ok: true };
    }
    if (nome === "gerar_broll" || nome === "gerar_elemento") {
      const s = nome === "gerar_broll" ? await estimarBroll(d.chamarVideos, d.clientId, trab, a) : await estimarElemento(d.chamarEditor, d.clientId, a);
      return { ...nada(`Cartão pronto para o dono confirmar${s.custo_usd !== null ? ` (US$ ${s.custo_usd.toFixed(2)})` : " (sem custo conhecido: não gera)"}. Nada foi gerado ainda.`), saida: s };
    }
    if (nome === "pesquisar") {
      const pergunta = String(a.pergunta || "").replace(/\s+/g, " ").trim().slice(0, 600);
      if (pergunta.length < 4) return nada("Diga o que pesquisar.", false);
      if (!d.pesquisa) return nada("Pesquisa indisponível aqui (escolha o modelo do agente).", false);
      const r = await d.chamarEditor({ acao: "agente_pesquisar", client_id: d.clientId, modelo_id: d.pesquisa.modeloId, referencia_id: d.pesquisa.sessao, teto_usd: d.pesquisa.tetoUsd, pergunta });
      if (r && r.parou) return nada(String(r.motivo || "A pesquisa passaria do teto deste pedido."), false);
      const fontes = (Array.isArray(r && r.fontes) ? r.fontes : []) as { titulo?: string; url?: string }[];
      const texto = String((r && r.texto) || "").slice(0, 3000);
      if (!texto) return nada("A pesquisa voltou vazia.", false);
      return nada(`Pesquisa (US$ ${(Number(r.custo_usd) || 0).toFixed(3)}): ${texto}${fontes.length ? `\nFontes: ${fontes.slice(0, 6).map((f) => `${f.titulo || f.url} (${f.url})`).join("; ")}` : "\nSem fonte citada: não afirme como fato."}`);
    }
    return nada(`Ferramenta desconhecida: ${nome}.`, false);
  };
}
