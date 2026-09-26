/**
 * Kit de recepção do ângulo (pedido do dono em 25/09: "o post é o que a
 * gente vai fazer para receber esse cliente... o post entende a parte
 * comercial de vendas... complemente ali na parte do ad").
 *
 * Quem clica no anúncio cai no perfil ou na conversa. O kit deixa os dois
 * lados coerentes com a promessa do ângulo:
 * - post de recepção (orgânico): o perfil confirma o que o anúncio prometeu;
 * - ajustes no perfil (bio, destaque, link) quando a promessa não aparece lá;
 * - roteiro comercial para WhatsApp ou Direct: primeira resposta, perguntas
 *   de qualificação, respostas às objeções do ângulo, oferta e fechamento, e
 *   follow-up.
 *
 * Não existe outra área de roteiro de vendas do cliente no painel (o
 * /comercial é o funil da própria agência): o comercial do kit parte do que
 * a Oferta já guarda no briefing (objeções com resposta, destino e primeira
 * mensagem) e fica no ângulo do plano (ads_planos.angulos[i].kit_recepcao),
 * sem tabela nova.
 *
 * Aqui só o que é puro: esquema, pedido, normalização e o item da agenda.
 */
import { semTravessao } from "./calculos.ts";

const S = (type: string | string[], extra: Record<string, unknown> = {}) => ({ type, ...extra });
const obj = (props: Record<string, unknown>) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });
const lista = (items: unknown) => ({ type: "array", items });

export const FORMATOS_DO_POST = ["carrossel", "estatico", "reels"] as const;
export type FormatoDoPost = (typeof FORMATOS_DO_POST)[number];
export const FONTES_DA_OBJECAO = ["briefing", "angulo", "sugestao"] as const;

export const ESQUEMA_KIT_RECEPCAO = {
  nome: "kit_de_recepcao",
  schema: obj({
    promessa_do_anuncio: S("string"),
    post: obj({
      formato: S("string", { enum: [...FORMATOS_DO_POST] }),
      titulo: S("string"),
      gancho: S("string"),
      roteiro: lista(obj({ ordem: S("integer"), texto: S("string"), visual: S("string") })),
      legenda: S("string"),
      cta: S("string"),
      por_que_recebe: S("string"),
    }),
    perfil: lista(S("string")),
    comercial: obj({
      canal: S("string"),
      primeira_resposta: S("string"),
      perguntas_qualificacao: lista(S("string")),
      objecoes: lista(obj({ objecao: S("string"), resposta: S("string"), fonte: S("string", { enum: [...FONTES_DA_OBJECAO] }) })),
      oferta_e_fechamento: S("string"),
      follow_up: lista(obj({ quando: S("string"), mensagem: S("string") })),
    }),
    lacunas: lista(S("string")),
  }),
};

export type KitDeRecepcao = {
  promessa_do_anuncio: string;
  post: { formato: FormatoDoPost; titulo: string; gancho: string; roteiro: { ordem: number; texto: string; visual: string }[]; legenda: string; cta: string; por_que_recebe: string };
  perfil: string[];
  comercial: {
    canal: string;
    primeira_resposta: string;
    perguntas_qualificacao: string[];
    objecoes: { objecao: string; resposta: string; fonte: (typeof FONTES_DA_OBJECAO)[number] }[];
    oferta_e_fechamento: string;
    follow_up: { quando: string; mensagem: string }[];
  };
  lacunas: string[];
  /** Conferência do Jev (aviso, sem laço de correção): 0 a 10, null quando o Jev não respondeu. */
  conferencia?: { post_confirma: number | null; roteiro_fiel: number | null; risco_politica: number | null; alerta: boolean; jev_erro: string | null };
  gerado_em?: string;
  custo_usd?: number;
  agenda?: { task_id: string; data: string; gravado_em: string } | null;
  /** Quantas vezes o post já foi para a agenda (a chave de idempotência muda a cada envio depois de um desfazer). */
  agenda_versao?: number;
};

const txt = (v: unknown, max = 1500) => (typeof v === "string" ? semTravessao(v.replace(/[ \t]+/g, " ").trim()).slice(0, max) : "");
const arr = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];

/** Normaliza a saída do modelo: listas com teto, sem travessão, formato válido. Null sem post nem roteiro. */
export function normalizarKit(bruto: unknown): KitDeRecepcao | null {
  const r = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const p = (r.post && typeof r.post === "object" ? r.post : {}) as Record<string, unknown>;
  const c = (r.comercial && typeof r.comercial === "object" ? r.comercial : {}) as Record<string, unknown>;
  const formato = FORMATOS_DO_POST.indexOf(p.formato as FormatoDoPost) >= 0 ? (p.formato as FormatoDoPost) : "carrossel";
  const kit: KitDeRecepcao = {
    promessa_do_anuncio: txt(r.promessa_do_anuncio, 400),
    post: {
      formato,
      titulo: txt(p.titulo, 160),
      gancho: txt(p.gancho, 300),
      roteiro: arr(p.roteiro).map((x, i) => ({ ordem: i + 1, texto: txt(x.texto, 600), visual: txt(x.visual, 400) })).filter((x) => x.texto).slice(0, formato === "estatico" ? 1 : 10),
      legenda: txt(p.legenda, 2200),
      cta: txt(p.cta, 200),
      por_que_recebe: txt(p.por_que_recebe, 600),
    },
    perfil: (Array.isArray(r.perfil) ? r.perfil : []).map((x) => txt(x, 300)).filter(Boolean).slice(0, 5),
    comercial: {
      canal: txt(c.canal, 60) || "WhatsApp",
      primeira_resposta: txt(c.primeira_resposta, 800),
      perguntas_qualificacao: (Array.isArray(c.perguntas_qualificacao) ? c.perguntas_qualificacao : []).map((x) => txt(x, 300)).filter(Boolean).slice(0, 6),
      objecoes: arr(c.objecoes).map((o) => ({
        objecao: txt(o.objecao, 300),
        resposta: txt(o.resposta, 800),
        fonte: (FONTES_DA_OBJECAO as readonly string[]).indexOf(String(o.fonte)) >= 0 ? (o.fonte as KitDeRecepcao["comercial"]["objecoes"][number]["fonte"]) : "sugestao",
      })).filter((o) => o.objecao && o.resposta).slice(0, 8),
      oferta_e_fechamento: txt(c.oferta_e_fechamento, 1200),
      follow_up: arr(c.follow_up).map((f) => ({ quando: txt(f.quando, 80), mensagem: txt(f.mensagem, 600) })).filter((f) => f.mensagem).slice(0, 4),
    },
    lacunas: (Array.isArray(r.lacunas) ? r.lacunas : []).map((x) => txt(x, 300)).filter(Boolean).slice(0, 6),
  };
  if (!kit.post.titulo && !kit.post.roteiro.length && !kit.comercial.primeira_resposta) return null;
  return kit;
}

type AnguloDoKit = { nome: string; situacao?: string; mecanismo?: string; prova?: string; gancho_verbal?: string; gancho_visual?: string; hipotese?: string; objetivo?: string | null };
type BriefingDoKit = {
  oferta?: Record<string, unknown> | null;
  publico?: Record<string, unknown> | null;
  objecoes?: unknown[] | null;
  provas?: unknown[] | null;
  destino?: Record<string, unknown> | null;
  restricoes?: string | null;
} | null;

/** Objeções do briefing (texto e resposta que a equipe já escreveu na Oferta). */
export function objecoesDoBriefing(b: BriefingDoKit): { objecao: string; resposta: string }[] {
  return (Array.isArray(b?.objecoes) ? b!.objecoes : [])
    .map((o) => {
      const x = (o && typeof o === "object" ? o : { texto: o }) as Record<string, unknown>;
      return { objecao: txt(x.texto ?? x.objecao, 300), resposta: txt(x.resposta, 800) };
    })
    .filter((o) => o.objecao)
    .slice(0, 10);
}

/** Canal da conversa pelo destino do briefing (WhatsApp, Direct, página...). */
export function canalDoDestino(b: BriefingDoKit): string {
  const t = String((b?.destino ?? {}).tipo ?? "").toLowerCase();
  return t === "direct" ? "Direct do Instagram" : t === "pagina" ? "página (e WhatsApp do rodapé)" : t === "formulario" ? "retorno do formulário" : t === "ligacao" ? "ligação" : "WhatsApp";
}

/** Pedido ao estrategista (o contexto do ângulo, da oferta e do briefing vai junto, em JSON). */
export function pedidoDoKit(angulo: AnguloDoKit, briefing: BriefingDoKit, oferta: Record<string, unknown> | null, cliente: string): string {
  const contexto = {
    cliente,
    angulo: {
      nome: angulo.nome, situacao: angulo.situacao ?? "", mecanismo: angulo.mecanismo ?? "", prova: angulo.prova ?? "",
      gancho_verbal: angulo.gancho_verbal ?? "", gancho_visual: angulo.gancho_visual ?? "", hipotese: angulo.hipotese ?? "", objetivo: angulo.objetivo ?? null,
    },
    oferta_escolhida: oferta,
    briefing: briefing ? {
      oferta: briefing.oferta ?? null,
      publico: briefing.publico ?? null,
      provas: briefing.provas ?? [],
      destino: briefing.destino ?? null,
      restricoes: briefing.restricoes ?? null,
    } : null,
    OBJECOES_DO_BRIEFING: objecoesDoBriefing(briefing),
    CANAL: canalDoDestino(briefing),
    PRIMEIRA_MENSAGEM_DO_ANUNCIO: txt((briefing?.destino ?? {}).primeira_mensagem, 400) || null,
  };
  return `CONTEXTO (use só estes dados; nada de preço, número, depoimento ou prazo que não esteja aqui):
${JSON.stringify(contexto)}

TAREFA: monte o KIT DE RECEPÇÃO deste ângulo. Quem vê o anúncio e clica vai olhar o perfil e chamar na conversa (${contexto.CANAL}). Tudo precisa confirmar a mesma promessa do anúncio.
- promessa_do_anuncio: a promessa do ângulo em uma frase, do jeito que o cliente entende.
- post: UM conteúdo orgânico para o feed que recebe quem veio do anúncio (formato carrossel, estatico ou reels). Ele confirma a promessa com prova real do contexto, explica o mecanismo e termina chamando para a conversa. roteiro: um item por card ou cena (texto curto na arte e o visual). legenda pronta para postar. por_que_recebe: por que este post segura quem chegou pelo anúncio.
- perfil: até 3 ajustes no perfil (bio, destaque fixado, link) quando a promessa não aparece lá; lista vazia se o contexto não mostra problema.
- comercial: o roteiro de atendimento no ${contexto.CANAL}. primeira_resposta responde à PRIMEIRA_MENSAGEM_DO_ANUNCIO (quando houver) retomando a promessa; perguntas_qualificacao (3 a 5, curtas, uma por vez); objecoes: primeiro as OBJECOES_DO_BRIEFING (fonte briefing, reaproveite a resposta que a equipe escreveu e só lapide o texto), depois as que o ângulo provoca (fonte angulo) e, se faltar, sugestões (fonte sugestao); oferta_e_fechamento: como apresentar a oferta escolhida e pedir o próximo passo; follow_up: 2 ou 3 mensagens com quando mandar.
- lacunas: o que faltou no contexto para o kit ficar certo (preço não confirmado, prova sem autorização...).
Regras: português do Brasil, frases curtas, tom de conversa, sem travessão, política de anúncios e de atendimento da Meta (nada de atributo pessoal, promessa de resultado garantido ou pressão enganosa).`;
}

/** O post do kit como item da agenda da Mesa (createEditorialItem): título, descrição com o roteiro e formato. */
export function itemDaAgendaDoKit(kit: KitDeRecepcao, angulo: { nome: string }, origem: { plano_id: string; angulo_id: string; versao?: number }) {
  const linhas = [
    `Post de recepção do anúncio: ${angulo.nome}`,
    `Promessa que o post confirma: ${kit.promessa_do_anuncio}`,
    `Formato: ${kit.post.formato === "estatico" ? "Post estático" : kit.post.formato === "reels" ? "Reels" : "Carrossel"}`,
    "",
    `Gancho: ${kit.post.gancho}`,
    "",
    kit.post.formato === "reels" ? "Roteiro das cenas:" : "Roteiro dos cards:",
    ...kit.post.roteiro.map((r) => `Card ${r.ordem}: ${r.texto}${r.visual ? `\n  Ilustração: ${r.visual}` : ""}`),
    "",
    `CTA: ${kit.post.cta}`,
    "",
    `Legenda (copy):\n${kit.post.legenda}`,
    "",
    `Origem: Mesa Ads, plano ${origem.plano_id}, ângulo ${origem.angulo_id} (kit de recepção).`,
  ];
  let descricao = linhas.join("\n").trim();
  if (descricao.length > 3900) descricao = `${descricao.slice(0, 3800)}\n\n(roteiro cortado: o kit completo está na Mesa Ads)`;
  return {
    title: (kit.post.titulo || `Recepção: ${angulo.nome}`).slice(0, 200),
    description: descricao,
    format: kit.post.formato === "estatico" ? "static" as const : kit.post.formato === "reels" ? "reel" as const : "carousel" as const,
    idempotency_key: `mesa-ads-kit:${origem.plano_id}:${origem.angulo_id}:v${Math.max(1, Math.round(origem.versao ?? 1))}`.slice(0, 128),
  };
}
