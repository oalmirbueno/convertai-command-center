import { padraoPara, modeloDoPapel, TAMANHOS, type ModeloIa, type ParteDaEstimativa } from "@/lib/mesa/api";
import {
  DIAS_MAX_CAMPANHA,
  diasEntreIso,
  partesDaCampanha,
  somarDiasIso,
  type BriefingDaCampanha,
  type Campanha,
  type Hype,
  type ItemProposto,
} from "./mesaV4Api";
import { tituloDaSemente, type SementeDaCampanha } from "./sementeDaCampanha";
import { normalizarBriefing, normalizarImagensDaCampanha, normalizarPlanoDeImagens } from "./campanhasApi";
import { avisoDoDia, dataBr, proximoEspaco, type Ocupacao, type RegraDoDia } from "../../../supabase/functions/_shared/agenda-inteligente";
import { arteRapidaDa, type ArquivoPedido, type PapelDoArquivo } from "../../../supabase/functions/estudio-arte/modulos/arte-rapida";

/**
 * Campanha completa (21/10/2026, pedido do dono: "com base no hype e trending eu conseguir juntar e criar
 * campanhas, por exemplo Black Friday: ele gerou o conteúdo e aí já entra uma série de conteúdo e a campanha
 * pronta completa, tudo gerado pelo Estúdio"). Regras puras, sem React, lidas pela tela e pelos testes:
 *
 * - a semente do Mês (hypes + trendings + pedido) vira a campanha nova preenchida (título, pedido, briefing,
 *   período) e as sugestões de quando começar;
 * - cada conteúdo da série ganha a fase (aquecimento, lançamento, urgência, encerramento) por regra fixa: o
 *   vocabulário da etapa vem do nosso próprio prompt (campanha_criar), então não é julgamento aberto; sem
 *   palavra conhecida, vale a posição da data na janela;
 * - cada peça vira uma arte rápida do Estúdio (rapida_preparar + fila do gerador) com a identidade da campanha;
 *   imagem só pelo gerador: foto real entra INTEIRA como referência ("referencia"), nunca como "foto exata"
 *   composta, logo colada ou "fazer igual" (regra sem colagem);
 * - o caminho "Gerar campanha completa" (campanha, selo, peças) é uma lista de passos que se recalcula pelo que
 *   já está salvo no servidor: reabrir a campanha continua de onde parou.
 */

// ------------------------------------------------------------------ semente -> campanha nova

const DOIS = (n: number) => (n < 10 ? `0${n}` : String(n));

/** Datas citadas no "quando" do hype ("29/11", "24/11 a 01/12", "2026-11-27"), no ano certo. */
export function datasDoQuando(quando: string | null | undefined, hoje: string): string[] {
  const t = String(quando || "");
  const saida: string[] = [];
  const iso = /(\d{4})-(\d{2})-(\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = iso.exec(t))) saida.push(`${m[1]}-${m[2]}-${m[3]}`);
  if (saida.length) return saida.sort();
  const br = /(\d{1,2})\/(\d{1,2})(\/(\d{2,4}))?/g;
  const anoDeHoje = Number(hoje.slice(0, 4));
  while ((m = br.exec(t))) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) continue;
    let ano = m[4] ? Number(m[4].length === 2 ? `20${m[4]}` : m[4]) : anoDeHoje;
    let d = `${ano}-${DOIS(mes)}-${DOIS(dia)}`;
    // Sem ano e já passou há mais de uma semana: é o do ano que vem.
    if (!m[4] && diasEntreIso(hoje, d) < -7) {
      ano += 1;
      d = `${ano}-${DOIS(mes)}-${DOIS(dia)}`;
    }
    saida.push(d);
  }
  return saida.sort();
}

/** Dias de aquecimento antes da data do hype. */
export const DIAS_DE_AQUECIMENTO = 14;

export interface CampanhaDaSemente {
  titulo: string;
  pedido: string;
  briefing: Partial<BriefingDaCampanha>;
  inicio: string;
  fim: string;
  /** O hype que vai para o servidor (o estrategista lê inteiro). */
  hype: Hype;
  sugestoes: string[];
}

/** Janela da campanha pela semente: a do hype (aquecimento antes, fechamento no dia); trending: agora + 7 ou 14 dias. */
export function periodoDaSemente(s: SementeDaCampanha, hoje: string): { inicio: string; fim: string } {
  const datas: string[] = [];
  s.hypes.forEach((h) => datasDoQuando(h.quando, hoje).forEach((d) => datas.push(d)));
  const futuras = datas.filter((d) => diasEntreIso(hoje, d) >= 0).sort();
  if (futuras.length) {
    const alvo = futuras[0];
    const ultima = futuras[futuras.length - 1];
    // Data única: a campanha fecha um dia depois (último chamado); janela: fecha no fim dela.
    let fim = ultima === alvo ? somarDiasIso(alvo, 1) : ultima;
    let inicio = somarDiasIso(alvo, -DIAS_DE_AQUECIMENTO);
    if (diasEntreIso(hoje, inicio) < 0) inicio = hoje;
    if (diasEntreIso(inicio, fim) > DIAS_MAX_CAMPANHA) fim = somarDiasIso(inicio, DIAS_MAX_CAMPANHA);
    return { inicio, fim };
  }
  const itens = s.hypes.length + s.trends.length;
  return { inicio: hoje, fim: somarDiasIso(hoje, itens > 1 ? 14 : 7) };
}

/** Sugestões de quando começar ("Black Friday em 37 dias: comece o aquecimento dia 13/11"). */
export function sugestoesDaSemente(s: SementeDaCampanha, hoje: string): string[] {
  const saida: string[] = [];
  s.hypes.forEach((h) => {
    const d = datasDoQuando(h.quando, hoje).filter((x) => diasEntreIso(hoje, x) >= 0)[0];
    if (!d) return;
    const faltam = diasEntreIso(hoje, d);
    if (faltam === 0) {
      saida.push(`${h.titulo} é hoje: uma peça de oportunidade agora e o último chamado amanhã.`);
      return;
    }
    const aquecer = somarDiasIso(d, -DIAS_DE_AQUECIMENTO);
    const comeco = diasEntreIso(hoje, aquecer) > 0 ? aquecer : hoje;
    saida.push(
      faltam > DIAS_DE_AQUECIMENTO
        ? `${h.titulo} em ${faltam} dias: comece o aquecimento dia ${dataBr(comeco)}.`
        : `${h.titulo} em ${faltam} ${faltam === 1 ? "dia" : "dias"}: aquecimento curto, comece hoje.`,
    );
  });
  s.trends.forEach((t) => saida.push(`${t.titulo} está em alta agora: campanha curta, começando hoje.`));
  return saida.slice(0, 4);
}

const comPonto = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

/** A campanha nova preenchida pela semente do Mês. */
export function campanhaDaSemente(s: SementeDaCampanha, hoje: string): CampanhaDaSemente {
  const linhas: string[] = [];
  if (s.pedido) linhas.push(s.pedido);
  if (s.hypes.length || s.trends.length) linhas.push(linhas.length ? "\nJuntando:" : "Campanha juntando:");
  s.hypes.forEach((h) => {
    const partes = [`- Data/evento: ${h.titulo}${h.quando ? ` (${h.quando})` : ""}.`];
    if (h.por_que_agora) partes.push(`Por que agora: ${comPonto(h.por_que_agora)}`);
    if (h.como_usar) partes.push(`Como usar: ${comPonto(h.como_usar)}`);
    linhas.push(partes.join(" "));
  });
  s.trends.forEach((t) => {
    const fonte = [t.fonte, t.data].filter(Boolean).join(", ");
    linhas.push(`- Em alta: ${t.titulo}${fonte ? ` (${fonte})` : ""}.${t.resumo ? ` ${t.resumo}` : ""}`);
  });
  const periodo = periodoDaSemente(s, hoje);
  const primeiro = s.hypes[0];
  const mensagem = (primeiro && (primeiro.como_usar || primeiro.por_que_agora)) || (s.trends[0] && s.trends[0].resumo) || "";
  const titulo = tituloDaSemente(s);
  const hype: Hype = {
    tipo: "hype",
    titulo: titulo || "Campanha",
    o_que_e: linhas.join("\n").slice(0, 1500),
    por_que_agora: primeiro ? primeiro.por_que_agora : undefined,
    como_usar: primeiro ? primeiro.como_usar : undefined,
    fonte: s.trends[0] && s.trends[0].url ? s.trends[0].url : undefined,
  };
  return {
    titulo,
    pedido: linhas.join("\n").trim().slice(0, 4000),
    briefing: mensagem ? { mensagem_central: mensagem.slice(0, 400) } : {},
    inicio: periodo.inicio,
    fim: periodo.fim,
    hype,
    sugestoes: sugestoesDaSemente(s, hoje),
  };
}

// ------------------------------------------------------------------ formatos (21/10/2026, rodada 2)

/**
 * A mistura de formatos da campanha (dono: "escolher vídeos, posts, carrosséis e stories: eu escolho ali").
 * Posts e carrosséis viram arte rápida do Estúdio; vídeos/Reels saem com roteiro e direção prontos na série
 * (o vídeo nasce no Estúdio depois da agenda); stories são feitos pela aba Stories (gerarStoriesDaCampanha).
 */
export interface FormatosDaCampanha {
  posts: number;
  carrosseis: number;
  stories: number;
  videos: number;
}

export type ChaveDoFormato = keyof FormatosDaCampanha;

export const FORMATOS_DA_CAMPANHA: { chave: ChaveDoFormato; rotulo: string; dica: string; formato: string }[] = [
  { chave: "posts", rotulo: "Posts", dica: "Arte única no feed", formato: "estatico" },
  { chave: "carrosseis", rotulo: "Carrosséis", dica: "Várias lâminas no feed", formato: "carrossel" },
  { chave: "stories", rotulo: "Stories", dica: "Sequência de telas", formato: "story" },
  { chave: "videos", rotulo: "Vídeos e Reels", dica: "Roteiro pronto para gravar ou gerar", formato: "video" },
];

/** Teto por formato e da série de feed (o estrategista faz até 12 conteúdos por campanha). */
export const MAX_POR_FORMATO = 8;
export const MAX_NA_SERIE = 12;
export const LAMINAS_DO_CARROSSEL = 5;
export const TELAS_DO_STORY = 3;

export function normalizarFormatos(v: unknown): FormatosDaCampanha | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const n = (x: unknown) => Math.max(0, Math.min(MAX_POR_FORMATO, Math.round(Number(x) || 0)));
  const f = { posts: n(o.posts), carrosseis: n(o.carrosseis), stories: n(o.stories), videos: n(o.videos) };
  // A série de feed (posts + carrosséis + vídeos) cabe em 12: corta primeiro os posts, depois os carrosséis.
  let excesso = f.posts + f.carrosseis + f.videos - MAX_NA_SERIE;
  (["posts", "carrosseis", "videos"] as ChaveDoFormato[]).forEach((k) => {
    if (excesso <= 0) return;
    const tira = Math.min(excesso, f[k]);
    f[k] -= tira;
    excesso -= tira;
  });
  return f.posts + f.carrosseis + f.stories + f.videos ? f : null;
}

/** Sugestão pela duração (o dono ajusta): mais dias, mais peças; sempre ao menos 1 de cada. */
export function sugerirFormatos(dias: number): FormatosDaCampanha {
  if (dias <= 7) return { posts: 2, carrosseis: 1, stories: 2, videos: 1 };
  if (dias <= 14) return { posts: 2, carrosseis: 2, stories: 3, videos: 1 };
  if (dias <= 31) return { posts: 3, carrosseis: 3, stories: 4, videos: 2 };
  return { posts: 4, carrosseis: 4, stories: 6, videos: 3 };
}

export const totalNaSerie = (f: FormatosDaCampanha) => f.posts + f.carrosseis + f.videos;

/** O que a série tem hoje, por formato (para comparar com o planejado). */
export function contarFormatos(pecas: { item: Pick<ItemProposto, "formato"> }[]): FormatosDaCampanha {
  const f = { posts: 0, carrosseis: 0, stories: 0, videos: 0 };
  pecas.forEach((p) => {
    const fm = p.item.formato;
    if (fm === "estatico") f.posts += 1;
    else if (fm === "video") f.videos += 1;
    else if (fm === "story") f.stories += 1;
    else if (fm !== "foto") f.carrosseis += 1;
  });
  return f;
}

/** O que falta da mistura planejada (nunca negativo). */
export function formatosQueFaltam(planejado: FormatosDaCampanha, atual: FormatosDaCampanha): FormatosDaCampanha {
  return {
    posts: Math.max(0, planejado.posts - atual.posts),
    carrosseis: Math.max(0, planejado.carrosseis - atual.carrosseis),
    stories: Math.max(0, planejado.stories - atual.stories),
    videos: Math.max(0, planejado.videos - atual.videos),
  };
}

/** Story da campanha guardado no briefing (feito pelo estrategista ao criar). */
export interface StoryDaCampanha {
  tema_id: string;
  data: string;
  etapa: string;
  tema: string;
  gancho: string;
  telas: string[];
  /** A sequência criada na aba Stories (gerarStoriesDaCampanha); sem ela, a fazer. */
  sequencia_id?: string | null;
}

export type ItemDeStory = ItemProposto & { sequencia_id?: string | null };

export function normalizarStories(v: unknown): StoryDaCampanha[] {
  return (Array.isArray(v) ? v : [])
    .map((x, i) => {
      const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      const t = (y: unknown, max: number) => (typeof y === "string" ? y.trim().slice(0, max) : "");
      const data = t(o.data, 10);
      return {
        tema_id: t(o.tema_id, 40) || `s${i + 1}`,
        data: /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : "",
        etapa: t(o.etapa, 60),
        tema: t(o.tema, 200),
        gancho: t(o.gancho, 300),
        telas: (Array.isArray(o.telas) ? o.telas : []).map((y) => t(y, 300)).filter(Boolean).slice(0, 10),
        sequencia_id: t(o.sequencia_id, 64) || null,
      };
    })
    .filter((s) => s.tema)
    .slice(0, MAX_POR_FORMATO);
}

/** Os stories da campanha como conteúdos da série (formato "story"), para a grade, a linha do tempo e as fases. */
export function storiesComoItens(campanha: Pick<Campanha, "briefing">): ItemDeStory[] {
  const b = (campanha.briefing || {}) as Record<string, unknown>;
  return normalizarStories(b.stories).map((s) => ({
    tema_id: s.tema_id,
    data: s.data || undefined,
    formato: "story",
    etapa: s.etapa,
    tema: s.tema,
    gancho: s.gancho,
    cards: s.telas.map((texto, i) => ({ ordem: i + 1, texto })),
    sequencia_id: s.sequencia_id || null,
  }));
}

/** Contrato com os Stories (21/10/2026): o que a peça de story da campanha guarda e manda. */
export interface PecaDeStoryDaCampanha {
  campanha_id: string;
  tema_id: string;
  formato: "story";
  fase: FaseDaCampanha;
  data: string | null;
}

export function pecaDeStory(campanha: Pick<Campanha, "id" | "periodo_inicio" | "periodo_fim">, item: Pick<ItemProposto, "tema_id" | "data" | "etapa">): PecaDeStoryDaCampanha {
  return {
    campanha_id: campanha.id,
    tema_id: item.tema_id || "",
    formato: "story",
    fase: faseDaPeca(item, campanha.periodo_inicio, campanha.periodo_fim),
    data: item.data || null,
  };
}

// ------------------------------------------------------------------ fases

export type FaseDaCampanha = "aquecimento" | "lancamento" | "urgencia" | "encerramento";

export const FASES: { valor: FaseDaCampanha; rotulo: string }[] = [
  { valor: "aquecimento", rotulo: "Aquecimento" },
  { valor: "lancamento", rotulo: "Lançamento" },
  { valor: "urgencia", rotulo: "Urgência" },
  { valor: "encerramento", rotulo: "Encerramento" },
];

export const rotuloDaFase = (f: FaseDaCampanha) => (FASES.filter((x) => x.valor === f)[0] || FASES[0]).rotulo;

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A fase do conteúdo: pela etapa escrita pelo estrategista; sem palavra conhecida, pela data na janela. */
export function faseDaPeca(item: Pick<ItemProposto, "etapa" | "data">, inicio: string | null | undefined, fim: string | null | undefined): FaseDaCampanha {
  const e = semAcento(String(item.etapa || ""));
  if (/ultimo chamado|encerr|fecha|ultima chance|agradec|resultado|pos[- ]campanha|despedida/.test(e)) return "encerramento";
  if (/urgen|escassez|contagem|ultimos dias|ultimas|acaba|corre|reta final|countdown/.test(e)) return "urgencia";
  if (/aquec|teaser|antecip|expectativ|bastidor|curiosidade|pre[- ]lanc|aviso/.test(e)) return "aquecimento";
  if (/lanc|abertura|revela|estreia|oferta|prova|depoiment|objec|beneficio|educa|demonstra/.test(e)) return "lancamento";
  if (!item.data || !inicio || !fim) return "lancamento";
  const total = Math.max(1, diasEntreIso(inicio, fim));
  const pos = diasEntreIso(inicio, item.data) / total;
  if (pos < 0.25) return "aquecimento";
  if (pos < 0.6) return "lancamento";
  if (pos < 0.85) return "urgencia";
  return "encerramento";
}

// ------------------------------------------------------------------ peça -> arte rápida (sem colagem)

/** Papéis que colam a imagem na arte: proibidos na peça da campanha (dono: "nunca colocar imagem em cima"). */
export const PAPEIS_DE_COLAGEM: PapelDoArquivo[] = ["foto", "logo", "arte_para_melhorar"];

/** A peça é arte do Estúdio (estático ou carrossel); foto e vídeo são de outras mesas. */
export const ehPecaDeArte = (item: Pick<ItemProposto, "formato">) => item.formato !== "foto" && item.formato !== "video" && item.formato !== "story";

export const laminasDaPeca = (item: Pick<ItemProposto, "formato" | "cards">) => {
  if (item.formato === "estatico") return 1;
  const n = (item.cards || []).length;
  return Math.max(2, Math.min(10, n || 5));
};

/** Fotos da campanha para a peça: as do plano para este conteúdo; sem plano, a do produto herói. Sempre como referência inteira. */
export function arquivosDaPeca(campanha: Pick<Campanha, "imagens" | "plano_imagens">, item: Pick<ItemProposto, "tema_id">): ArquivoPedido[] {
  const plano = normalizarPlanoDeImagens(campanha.plano_imagens);
  const imagens = normalizarImagensDaCampanha(campanha.imagens);
  const ids: string[] = [];
  if (plano && item.tema_id) {
    plano.pecas
      .filter((p) => p.tema_id === item.tema_id && p.imagem_id)
      .sort((a, b) => a.ordem - b.ordem)
      .forEach((p) => { if (ids.indexOf(p.imagem_id as string) < 0) ids.push(p.imagem_id as string); });
  }
  if (!ids.length) {
    const heroi = imagens.filter((i) => i.papel === "heroi")[0];
    if (heroi) ids.push(heroi.imagem_id);
  }
  return ids.slice(0, 4).map((id, i) => ({ imagem_id: id, nome: `Foto da campanha ${i + 1}`, papel: "referencia" as const }));
}

/** Nenhum arquivo cola imagem na arte. */
export const semColagem = (arquivos: { papel: string }[]) => arquivos.every((a) => PAPEIS_DE_COLAGEM.indexOf(a.papel as PapelDoArquivo) < 0);

/** Versão da lâmina que não saiu do gerador (foto composta, foto real alinhada ou layout montado). */
export function versaoComColagem(card: { modo?: string | null; template_profile?: unknown }): boolean {
  return !!card.template_profile || card.modo === "foto_composta" || card.modo === "foto_real";
}

export const REGRA_SEM_COLAGEM =
  "Regra da casa: toda imagem desta peça sai do gerador do Estúdio. Nada colado por cima (nem foto, nem logo, nem recorte); a foto real anexada é só referência inteira para o gerador desenhar a cena.";

/** O pedido da peça para o diretor do Estúdio: o conteúdo inteiro, a fase, o briefing e a identidade da campanha. */
export function pedidoDaPeca(campanha: Campanha, item: ItemProposto, posicao: { i: number; total: number }): string {
  const fase = rotuloDaFase(faseDaPeca(item, campanha.periodo_inicio, campanha.periodo_fim)).toLowerCase();
  const b = normalizarBriefing(campanha.briefing);
  const id = campanha.identidade || {};
  const laminas = laminasDaPeca(item);
  const linhas: string[] = [
    `Peça "${(item.tema || "Sem título").trim()}" da campanha "${campanha.nome}" (${posicao.i} de ${posicao.total}, fase de ${fase}).`,
    item.formato === "estatico" ? "Formato: arte única." : `Formato: carrossel de ${laminas} lâminas.`,
  ];
  if (item.gancho) linhas.push(`Gancho (capa): ${item.gancho}`);
  const cards = (item.cards || []).slice().sort((a, c) => a.ordem - c.ordem).filter((c) => c.texto);
  if (cards.length) linhas.push(`Lâminas:\n${cards.map((c) => `${c.ordem}) ${c.texto}`).join("\n")}`);
  if (item.cta) linhas.push(`CTA: ${item.cta}`);
  if (item.instrucao_arte) linhas.push(`Instrução de arte da equipe: ${item.instrucao_arte}`);
  const brief = [
    b.produtos.length ? `produto(s): ${b.produtos.map((p) => p.nome).join(", ")}` : "",
    b.oferta ? `oferta: ${b.oferta}` : "",
    b.mensagem_central ? `mensagem central: ${b.mensagem_central}` : "",
    b.publico ? `público: ${b.publico}` : "",
    b.tom ? `tom: ${b.tom}` : "",
  ].filter(Boolean);
  if (brief.length) linhas.push(`Briefing: ${brief.join("; ")}.`);
  const paleta = (id.paleta_apoio || []).map((c) => c.hex).filter(Boolean).join(", ");
  const ident = [id.tema_visual ? `tema visual: ${id.tema_visual}` : "", paleta ? `cores de apoio: ${paleta}` : "", id.selo && id.selo.texto ? `selo "${id.selo.texto}"` : ""].filter(Boolean);
  if (ident.length) linhas.push(`Identidade da campanha: ${ident.join("; ")}.`);
  linhas.push(REGRA_SEM_COLAGEM);
  const texto = linhas.join("\n");
  // O pedido tem teto de 3.000 caracteres: a regra sem colagem nunca é a parte cortada.
  return texto.length <= 3000 ? texto : `${linhas.slice(0, -1).join("\n").slice(0, 2990 - REGRA_SEM_COLAGEM.length)}\n${REGRA_SEM_COLAGEM}`;
}

export interface CorpoDaPeca {
  clientId: string;
  campanha: Campanha;
  item: ItemProposto;
  posicao: { i: number; total: number };
  marcaId: string | null;
  modeloImagemId: string | null;
}

/** Corpo do rapida_preparar da peça: campanha fixa, peça e lâminas pelo conteúdo, criativo, só referência. */
export function corpoDaPeca(c: CorpoDaPeca): Record<string, unknown> {
  const arquivos = arquivosDaPeca(c.campanha, c.item);
  const carrossel = c.item.formato !== "estatico";
  const corpo: Record<string, unknown> = {
    acao: "rapida_preparar",
    client_id: c.clientId,
    pedido: pedidoDaPeca(c.campanha, c.item, c.posicao),
    peca: carrossel ? "carrossel" : "unica",
    campanha_id: c.campanha.id,
    arquivos: arquivos.map((a) => ({ imagem_id: a.imagem_id, nome: a.nome, papel: a.papel })),
    qualidade: "media",
    fidelidade: "criativo",
    peca_da_campanha: { campanha_id: c.campanha.id, tema_id: c.item.tema_id || "" },
  };
  if (carrossel) corpo.laminas = laminasDaPeca(c.item);
  if (c.marcaId) corpo.marca_id = c.marcaId;
  if (c.modeloImagemId) corpo.modelo_imagem_id = c.modeloImagemId;
  return corpo;
}

// ------------------------------------------------------------------ estado das peças

/** O trabalho do Estúdio como a campanha lê (só o que importa aqui). */
export interface TrabalhoDaPeca {
  id: string;
  status: string;
  direcao: { cards?: { ordem: number }[]; arte_rapida?: unknown } & Record<string, unknown>;
  cards: { ordem: number; versao: number; storage_path: string; modo?: string | null; template_profile?: unknown }[];
  legenda?: string | null;
  task_id?: string | null;
  aprovado_em?: string | null;
  atualizado_em?: string;
}

const temaDaArte = (t: TrabalhoDaPeca): string | null => {
  const bruto = (t.direcao && (t.direcao.arte_rapida as Record<string, unknown> | undefined)) || null;
  const p = bruto && bruto.peca_da_campanha && typeof bruto.peca_da_campanha === "object" ? (bruto.peca_da_campanha as Record<string, unknown>) : null;
  return p && typeof p.tema_id === "string" && p.tema_id ? p.tema_id : null;
};

/** O trabalho da peça: pela marca peca_da_campanha; sem ela (função antiga), pelo começo do pedido. */
export function trabalhoDaPeca(trabalhos: TrabalhoDaPeca[], item: Pick<ItemProposto, "tema_id" | "tema">): TrabalhoDaPeca | null {
  const vivos = trabalhos.filter((t) => {
    const a = arteRapidaDa(t.direcao);
    return !!a && !a.arquivada_em;
  });
  if (item.tema_id) {
    const marcado = vivos.filter((t) => temaDaArte(t) === item.tema_id)[0];
    if (marcado) return marcado;
  }
  const inicio = `Peça "${(item.tema || "Sem título").trim()}"`;
  return (
    vivos.filter((t) => {
      if (temaDaArte(t)) return false;
      const a = arteRapidaDa(t.direcao);
      return !!a && a.pedido.indexOf(inicio) === 0;
    })[0] || null
  );
}

/** Última versão de cada lâmina. */
function ultimas(cards: TrabalhoDaPeca["cards"]): Record<number, TrabalhoDaPeca["cards"][number]> {
  const m: Record<number, TrabalhoDaPeca["cards"][number]> = {};
  (cards || []).forEach((c) => {
    if (!m[c.ordem] || m[c.ordem].versao < c.versao) m[c.ordem] = c;
  });
  return m;
}

export type EstadoDaPeca = "outra_mesa" | "no_roteiro" | "a_fazer" | "sem_direcao" | "a_gerar" | "gerando" | "erro" | "pronta" | "na_agenda" | "roteiro_pronto";

export const ROTULO_DO_ESTADO_DA_PECA: Record<EstadoDaPeca, string> = {
  outra_mesa: "foto (Mesa Foto)",
  roteiro_pronto: "roteiro pronto",
  no_roteiro: "na agenda pelo roteiro",
  a_fazer: "a criar",
  sem_direcao: "sem direção",
  a_gerar: "a gerar",
  gerando: "gerando",
  erro: "com erro",
  pronta: "pronta",
  na_agenda: "na agenda",
};

export interface SituacaoDaPeca {
  item: ItemProposto;
  fase: FaseDaCampanha;
  trabalho: TrabalhoDaPeca | null;
  estado: EstadoDaPeca;
  laminas: number;
  feitas: number;
  /** Lâminas sem arte (para gerar de novo). */
  faltam: number[];
  capa: string | null;
  colagem: boolean;
}

/** Onde cada peça está, pelo que está salvo (trabalho e fila do servidor). */
export function situacaoDaPeca(
  campanha: Pick<Campanha, "periodo_inicio" | "periodo_fim">,
  item: ItemProposto,
  trabalho: TrabalhoDaPeca | null,
  fila: { trabalho_id: string; status: string; ordem: number }[] = [],
): SituacaoDaPeca {
  const fase = faseDaPeca(item, campanha.periodo_inicio, campanha.periodo_fim);
  const base = { item, fase, trabalho, laminas: laminasDaPeca(item), feitas: 0, faltam: [] as number[], capa: null as string | null, colagem: false };
  // Vídeo/Reels: o roteiro e a direção vêm prontos na série; o vídeo nasce no Estúdio depois da agenda.
  if (item.formato === "video") return { ...base, laminas: 0, estado: item.task_id ? "no_roteiro" : "roteiro_pronto" };
  // Stories: a sequência é feita pela aba Stories (contrato gerarStoriesDaCampanha); feita quando há sequencia_id.
  if (item.formato === "story") return { ...base, laminas: (item.cards || []).length || 3, estado: (item as ItemDeStory).sequencia_id ? "pronta" : "a_fazer" };
  if (!ehPecaDeArte(item)) return { ...base, estado: "outra_mesa" };
  if (!trabalho) return { ...base, estado: item.task_id ? "no_roteiro" : "a_fazer" };
  const ordens = ((trabalho.direcao && trabalho.direcao.cards) || []).map((c) => c.ordem);
  const versoes = ultimas(trabalho.cards || []);
  const feitas = ordens.filter((o) => !!versoes[o]).length;
  const faltam = ordens.filter((o) => !versoes[o]);
  const primeira = versoes[1] || versoes[ordens[0]] || null;
  const colagem = Object.keys(versoes).some((k) => versaoComColagem(versoes[Number(k)]));
  const comum = { ...base, laminas: ordens.length || base.laminas, feitas, faltam, capa: primeira ? primeira.storage_path : null, colagem };
  const a = arteRapidaDa(trabalho.direcao);
  if (a && a.task_id) return { ...comum, estado: "na_agenda" };
  const daFila = fila.filter((f) => f.trabalho_id === trabalho.id);
  if (daFila.some((f) => f.status === "fila" || f.status === "rodando")) return { ...comum, estado: "gerando" };
  if (!ordens.length) return { ...comum, estado: trabalho.status === "erro" ? "erro" : "sem_direcao" };
  if (!faltam.length) return { ...comum, estado: "pronta" };
  if (trabalho.status === "erro" || daFila.some((f) => f.status === "erro" && faltam.indexOf(f.ordem) >= 0)) return { ...comum, estado: "erro" };
  return { ...comum, estado: "a_gerar" };
}

export interface NumerosDaCampanha {
  pecas: number;
  prontas: number;
  naAgenda: number;
  aprovadas: number;
  gerando: number;
  comErro: number;
}

/** Métricas simples da campanha: peças de arte, prontas (ou além), na agenda e aprovadas pelo cliente. */
export function numerosDaCampanha(pecas: SituacaoDaPeca[]): NumerosDaCampanha {
  const deArte = pecas.filter((p) => p.estado !== "outra_mesa");
  return {
    pecas: deArte.length,
    prontas: deArte.filter((p) => p.estado === "pronta" || p.estado === "na_agenda" || p.estado === "roteiro_pronto").length,
    naAgenda: deArte.filter((p) => p.estado === "na_agenda" || p.estado === "no_roteiro").length,
    aprovadas: deArte.filter((p) => !!(p.trabalho && p.trabalho.aprovado_em)).length,
    gerando: deArte.filter((p) => p.estado === "gerando").length,
    comErro: deArte.filter((p) => p.estado === "erro").length,
  };
}

// ------------------------------------------------------------------ passos do "Gerar campanha completa"

export type TipoDoPasso = "campanha" | "selo" | "preparar" | "gerar" | "story";

export interface PassoDaCampanha {
  id: string;
  tipo: TipoDoPasso;
  rotulo: string;
  temaId?: string;
  trabalhoId?: string;
  laminas: number;
  /** gerar: as lâminas que faltam. */
  ordens?: number[];
}

/** O que falta, pelo que está salvo: a campanha, o selo e cada peça (criar a direção ou gerar o que falta). */
export function passosQueFaltam(e: { temCampanha: boolean; temSelo: boolean; pecas: SituacaoDaPeca[]; quantidadePrevista?: number | null; formatos?: FormatosDaCampanha | null }): PassoDaCampanha[] {
  const passos: PassoDaCampanha[] = [];
  if (!e.temCampanha) {
    passos.push({ id: "campanha", tipo: "campanha", rotulo: "Ideia, briefing, identidade e série", laminas: 0 });
    passos.push({ id: "selo", tipo: "selo", rotulo: "Selo da campanha", laminas: 0 });
    // Pela mistura escolhida: posts (1 lâmina), carrosséis (5), stories (3 telas). Vídeos saem com o roteiro na série.
    const f = e.formatos || { posts: 0, carrosseis: 0, stories: 0, videos: 0, ...(e.quantidadePrevista ? { carrosseis: e.quantidadePrevista } : { carrosseis: 6 }) };
    let k = 0;
    for (let i = 0; i < f.posts; i++) passos.push({ id: `peca-prevista-${++k}`, tipo: "preparar", rotulo: `Post ${i + 1}`, laminas: 1 });
    for (let i = 0; i < f.carrosseis; i++) passos.push({ id: `peca-prevista-${++k}`, tipo: "preparar", rotulo: `Carrossel ${i + 1}`, laminas: e.formatos ? LAMINAS_DO_CARROSSEL : 3 });
    for (let i = 0; i < f.stories; i++) passos.push({ id: `story-previsto-${i + 1}`, tipo: "story", rotulo: `Stories ${i + 1}`, laminas: TELAS_DO_STORY });
    return passos;
  }
  if (!e.temSelo) passos.push({ id: "selo", tipo: "selo", rotulo: "Selo da campanha", laminas: 0 });
  e.pecas.forEach((p) => {
    const temaId = p.item.tema_id || "";
    const rotulo = p.item.tema || "Peça";
    if (p.estado === "a_fazer" && p.item.formato === "story") passos.push({ id: `story-${temaId}`, tipo: "story", rotulo, temaId, laminas: p.laminas });
    else if (p.estado === "a_fazer") passos.push({ id: `preparar-${temaId}`, tipo: "preparar", rotulo, temaId, laminas: p.laminas });
    else if ((p.estado === "a_gerar" || p.estado === "erro") && p.trabalho && p.faltam.length) {
      passos.push({ id: `gerar-${temaId}`, tipo: "gerar", rotulo, temaId, trabalhoId: p.trabalho.id, laminas: p.faltam.length, ordens: p.faltam });
    }
  });
  return passos;
}

const parteDasLaminas = (catalogo: ModeloIa[], modeloImagemId: string | null, laminas: number): ParteDaEstimativa[] => {
  const imagem = modeloDoPapel(catalogo, "imagem", modeloImagemId);
  const leitor = padraoPara(catalogo, "leitura");
  if (!laminas) return [];
  return [
    { modeloId: imagem ? imagem.id : null, tipo: "imagem", imagens: 1, qualidade: "media", tokensEntrada: TAMANHOS.imagemAnexos.entrada, vezes: laminas },
    { modeloId: leitor ? leitor.id : null, tipo: "texto", tokensEntrada: TAMANHOS.leituraDoCard.entrada, tokensSaida: TAMANHOS.leituraDoCard.saida, vezes: laminas },
  ];
};

/** Custo TOTAL estimado dos passos (somando cada estimativa da casa), antes do Confirmar. */
export function partesDosPassos(passos: PassoDaCampanha[], catalogo: ModeloIa[], opcoes: { modeloImagemId?: string | null; quantidade?: number | null; anexos?: number } = {}): ParteDaEstimativa[] {
  const diretor = padraoPara(catalogo, "diretor_arte");
  const saida: ParteDaEstimativa[] = [];
  passos.forEach((p) => {
    if (p.tipo === "campanha") partesDaCampanha(catalogo, opcoes.quantidade || null, opcoes.anexos || 0).forEach((x) => saida.push(x));
    else if (p.tipo === "selo") parteDasLaminas(catalogo, opcoes.modeloImagemId || null, 1).forEach((x) => saida.push(x));
    else {
      if (p.tipo === "preparar" || p.tipo === "story") {
        saida.push({ modeloId: diretor ? diretor.id : null, tipo: "texto", tokensEntrada: TAMANHOS.preparar.entrada + TAMANHOS.imagemAnexos.entrada, tokensSaida: TAMANHOS.preparar.saida });
      }
      parteDasLaminas(catalogo, opcoes.modeloImagemId || null, p.laminas).forEach((x) => saida.push(x));
    }
  });
  return saida;
}

/** Resumo do que o botão vai fazer ("selo, 6 peças, 18 lâminas"). */
export function resumoDosPassos(passos: PassoDaCampanha[]): string {
  const partes: string[] = [];
  if (passos.some((p) => p.tipo === "campanha")) partes.push("briefing, identidade e série");
  if (passos.some((p) => p.tipo === "selo")) partes.push("selo");
  const pecas = passos.filter((p) => p.tipo === "preparar" || p.tipo === "gerar");
  if (pecas.length) partes.push(`${pecas.length} ${pecas.length === 1 ? "peça" : "peças"}`);
  const stories = passos.filter((p) => p.tipo === "story").length;
  if (stories) partes.push(`${stories} ${stories === 1 ? "sequência de stories" : "sequências de stories"}`);
  const laminas = pecas.reduce((s, p) => s + p.laminas, 0);
  if (laminas) partes.push(`${laminas} ${laminas === 1 ? "lâmina" : "lâminas"}`);
  return partes.join(", ");
}

// ------------------------------------------------------------------ agenda

export interface ConflitoNaAgenda {
  temaId: string;
  data: string;
  aviso: string;
  sugestao: string | null;
}

/** Conteúdos da série que caem em dia cheio na agenda do cliente (contando os da própria série, em ordem). */
export function conflitosDaSerie(
  itens: ItemProposto[],
  agenda: { ocupacao: Ocupacao[]; regra: RegraDoDia },
  hoje: string,
  janela?: { inicio?: string | null; fim?: string | null },
): ConflitoNaAgenda[] {
  const ocupacao = agenda.ocupacao.slice();
  const saida: ConflitoNaAgenda[] = [];
  itens
    .filter((i) => !i.task_id && i.data && ehPecaDeArte(i))
    .slice()
    .sort((a, b) => String(a.data).localeCompare(String(b.data)))
    .forEach((i) => {
      const data = String(i.data);
      const aviso = diasEntreIso(hoje, data) < 0 ? `${dataBr(data)} já passou.` : avisoDoDia(ocupacao, data, false, agenda.regra);
      if (aviso) {
        // Primeiro um dia livre dentro da janela da campanha; sem nenhum, o próximo depois do dia pedido.
        const desde = janela && janela.inicio && janela.inicio > hoje ? janela.inicio : hoje;
        const naJanela = janela && janela.fim && janela.fim >= desde ? diaLivreMaisPerto(ocupacao, data, agenda.regra, desde, janela.fim) : null;
        const livre = naJanela || proximoEspaco(ocupacao, { desde: diasEntreIso(hoje, data) < 0 ? hoje : data, ate: somarDiasIso(data, 21), hype: false, horaPreferida: "10:00", regra: agenda.regra });
        saida.push({ temaId: i.tema_id || "", data, aviso, sugestao: livre ? livre.data : null });
        if (livre) ocupacao.push({ data: livre.data, hora: null, hype: false });
      } else {
        ocupacao.push({ data, hora: null, hype: false });
      }
    });
  return saida;
}

/** O dia livre mais perto do pedido (um depois, um antes, dois depois...), dentro de [desde, ate]; a fase não muda de lugar. */
function diaLivreMaisPerto(ocupacao: Ocupacao[], data: string, regra: RegraDoDia, desde: string, ate: string): { data: string } | null {
  const total = Math.max(0, diasEntreIso(desde, ate));
  for (let k = 1; k <= total; k++) {
    for (const d of [somarDiasIso(data, k), somarDiasIso(data, -k)]) {
      if (d < desde || d > ate) continue;
      const livre = proximoEspaco(ocupacao, { desde: d, ate: d, hype: false, horaPreferida: "10:00", regra });
      if (livre) return { data: livre.data };
    }
  }
  return null;
}

// ------------------------------------------------------------------ resumo para exportar

const escapar = (t: unknown) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Página do resumo da campanha (imprimir ou salvar em PDF pelo navegador). */
export function resumoDaCampanhaEmHtml(c: {
  campanha: Campanha;
  pecas: SituacaoDaPeca[];
  numeros: NumerosDaCampanha;
  imagens: Record<string, string>;
  cliente?: string | null;
}): string {
  const b = normalizarBriefing(c.campanha.briefing);
  const periodo = `${dataBr(String(c.campanha.periodo_inicio || ""))} a ${dataBr(String(c.campanha.periodo_fim || ""))}`;
  const fases = FASES.map((f) => {
    const daFase = c.pecas.filter((p) => p.fase === f.valor);
    if (!daFase.length) return "";
    return `<h2>${escapar(f.rotulo)}</h2><ul>${daFase
      .map((p) => `<li><strong>${escapar(p.item.data ? dataBr(p.item.data) : "sem data")}</strong> · ${escapar(p.item.tema || "Peça")} <em>(${escapar(ROTULO_DO_ESTADO_DA_PECA[p.estado])})</em>${p.item.gancho ? `<br><span>${escapar(p.item.gancho)}</span>` : ""}</li>`)
      .join("")}</ul>`;
  }).join("");
  const grade = c.pecas
    .filter((p) => p.capa && c.imagens[p.capa])
    .map((p) => `<figure><img src="${escapar(c.imagens[p.capa as string])}" alt=""><figcaption>${escapar(p.item.tema || "")}</figcaption></figure>`)
    .join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(c.campanha.nome)}</title>
<style>
@page{size:A4;margin:16mm}body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:24px;line-height:1.5}
h1{font-size:26px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 6px;border-bottom:1px solid #ddd;padding-bottom:4px}
.meta{color:#555;font-size:13px}.nums{display:flex;gap:24px;margin:16px 0}.nums div{font-size:12px;color:#555}.nums b{display:block;font-size:22px;color:#111}
ul{padding-left:18px;font-size:13px}li{margin:4px 0}li span{color:#555}.grade{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
figure{margin:0}img{width:100%;border-radius:6px}figcaption{font-size:11px;color:#555}
</style></head><body>
<h1>${escapar(c.campanha.nome)}</h1>
<p class="meta">${escapar(c.cliente ? `${c.cliente} · ` : "")}${escapar(periodo)} · ${escapar(c.campanha.status)}</p>
${c.campanha.conceito ? `<p>${escapar(c.campanha.conceito)}</p>` : ""}
<div class="nums"><div><b>${c.numeros.pecas}</b>peças</div><div><b>${c.numeros.prontas}</b>prontas</div><div><b>${c.numeros.naAgenda}</b>na agenda</div><div><b>${c.numeros.aprovadas}</b>aprovadas</div></div>
${b.oferta || b.mensagem_central ? `<h2>Briefing</h2><ul>${b.oferta ? `<li>Oferta: ${escapar(b.oferta)}</li>` : ""}${b.mensagem_central ? `<li>Mensagem: ${escapar(b.mensagem_central)}</li>` : ""}${b.publico ? `<li>Público: ${escapar(b.publico)}</li>` : ""}${b.cta ? `<li>CTA: ${escapar(b.cta)}</li>` : ""}</ul>` : ""}
${fases}
${grade ? `<h2>Artes</h2><div class="grade">${grade}</div>` : ""}
</body></html>`;
}

// ------------------------------------------------------------------ sugestões da campanha aberta

/** Sugestões curtas pela janela, pela série e pelas peças (sem IA; o Jev entra na Revisão). */
export function sugestoesDaCampanha(campanha: Pick<Campanha, "periodo_inicio" | "periodo_fim">, pecas: SituacaoDaPeca[], hoje: string): string[] {
  const saida: string[] = [];
  const ini = campanha.periodo_inicio;
  const fim = campanha.periodo_fim;
  if (ini && fim) {
    const ate = diasEntreIso(hoje, ini);
    if (ate > 0) saida.push(`Começa em ${ate} ${ate === 1 ? "dia" : "dias"} (${dataBr(ini)}): deixe as peças do aquecimento prontas antes.`);
    else if (diasEntreIso(hoje, fim) >= 0) {
      const resta = diasEntreIso(hoje, fim);
      saida.push(resta === 0 ? "Último dia da campanha: hora do último chamado." : `Em andamento: ${resta} ${resta === 1 ? "dia" : "dias"} até o fim (${dataBr(fim)}).`);
    } else saida.push(`A campanha terminou em ${dataBr(fim)}.`);
  }
  const deArte = pecas.filter((p) => p.estado !== "outra_mesa");
  if (deArte.length) {
    const faltando = FASES.filter((f) => !deArte.some((p) => p.fase === f.valor)).map((f) => f.rotulo.toLowerCase());
    if (faltando.length && faltando.length < FASES.length) saida.push(`A série não tem peça de ${faltando.join(" nem de ")}: peça ao agente.`);
    const aFazer = deArte.filter((p) => p.estado === "a_fazer").length;
    if (aFazer) saida.push(`${aFazer} ${aFazer === 1 ? "peça ainda sem arte" : "peças ainda sem arte"}: Gerar campanha completa faz pelo Estúdio.`);
    const passadas = deArte.filter((p) => p.item.data && !p.item.task_id && diasEntreIso(hoje, String(p.item.data)) < 0 && p.estado !== "na_agenda").length;
    if (passadas) saida.push(`${passadas} ${passadas === 1 ? "peça está" : "peças estão"} com data que já passou: troque o dia na Revisão.`);
  }
  return saida.slice(0, 4);
}

// ------------------------------------------------------------------ várias campanhas por cliente (22/10/2026)

/** Peças prontas por campanha (todas as lâminas com arte, ou já na agenda), pelos trabalhos do Estúdio. */
export function prontasPorCampanha(trabalhos: TrabalhoDaPeca[]): Record<string, number> {
  const saida: Record<string, number> = {};
  trabalhos.forEach((t) => {
    const a = arteRapidaDa(t.direcao);
    if (!a || !a.campanha_id || a.arquivada_em) return;
    const ordens = ((t.direcao && t.direcao.cards) || []).map((c) => c.ordem);
    const feitas = ultimas(t.cards || []);
    const pronta = !!a.task_id || (ordens.length > 0 && ordens.every((o) => !!feitas[o]));
    if (pronta) saida[a.campanha_id] = (saida[a.campanha_id] || 0) + 1;
  });
  return saida;
}

/** Progresso da campanha na lista: prontas de um total (conteúdos da série + stories planejados). */
export function progressoDaCampanha(campanha: Pick<Campanha, "id" | "briefing">, conteudos: number | null, prontas: Record<string, number>): { prontas: number; total: number } | null {
  if (conteudos === null) return null;
  const stories = storiesComoItens(campanha);
  const total = conteudos + stories.length;
  if (!total) return null;
  const feitasDosStories = stories.filter((s) => !!s.sequencia_id).length;
  return { prontas: Math.min(total, (prontas[campanha.id] || 0) + feitasDosStories), total };
}

/** O molde para "Nova campanha a partir desta": a estrutura (formatos, duração, tipo, público, tom, canais e CTA), outro tema. */
export interface MoldeDaCampanha {
  origemId: string;
  origemNome: string;
  formatos: FormatosDaCampanha | null;
  dias: number;
  tipo: string | null;
  briefing: Partial<BriefingDaCampanha>;
}

export function moldeDaCampanha(c: Campanha): MoldeDaCampanha {
  const b = normalizarBriefing(c.briefing);
  const dias = c.periodo_inicio && c.periodo_fim ? Math.max(1, Math.min(DIAS_MAX_CAMPANHA, diasEntreIso(c.periodo_inicio, c.periodo_fim))) : 14;
  const briefing: Partial<BriefingDaCampanha> = {};
  if (b.publico) briefing.publico = b.publico;
  if (b.tom) briefing.tom = b.tom;
  if (b.cta) briefing.cta = b.cta;
  if (b.canais && b.canais.length) briefing.canais = b.canais.slice();
  const tipo = c.identidade && c.identidade.tipo ? String(c.identidade.tipo) : null;
  return { origemId: c.id, origemNome: c.nome, formatos: normalizarFormatos(b.formatos), dias, tipo, briefing };
}
