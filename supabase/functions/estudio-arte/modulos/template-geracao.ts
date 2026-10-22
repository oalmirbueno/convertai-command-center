/**
 * Gerar dentro do Template (21/10/2026, dono: "opção de gerar também ... o
 * conteúdo completo já com imagens"). Duas ações, ambas com custo ANTES:
 * sem `confirmado: true` respondem 409 `confirmar_custo` com a estimativa.
 *
 * - template_conteudo: o texto do post do X (um ou um fio, um post por
 *   lâmina), a legenda do Instagram (gancho, corpo e CTA) ou o texto curto de
 *   cada Story. Uma chamada ao redator do Estúdio (o mesmo do refino), sem
 *   laço de correção; o que passa do limite volta com aviso, nunca cortado.
 * - template_imagem: UMA foto do post pelo gerador da casa, sem texto, letra,
 *   logo ou interface de app dentro. A moldura do post é desenhada pelo
 *   código na tela; a foto entra inteira, sem nada colado por cima.
 *
 * Não importa Deno/Supabase: os testes usam as mesmas travas.
 */
import type { TrabalhoDoTemplate } from "./template-profile.ts";
import { caracteresDoX, GANCHO_DA_LEGENDA, hashtagsDoTexto, LIMITE_DA_LEGENDA, LIMITE_DO_STORY, LIMITE_DO_X, MAX_HASHTAGS, type RedeDoTemplate } from "./limites-do-post.ts";

export interface ImagemGeradaDoTemplate {
  caminho: string;
  origem: "gerador";
  descricao: string;
  proporcao: ProporcaoDaFoto;
  criado_em: string;
  custo_usd: number;
}

export type ProporcaoDaFoto = "16:9" | "1:1" | "4:5" | "9:16";
/** Tamanho pedido ao gerador por proporção (o do quadro do post; o motor cai em 2:3 se o modelo recusar). */
export const TAMANHO_DA_FOTO: Record<ProporcaoDaFoto, string> = { "16:9": "1920x1088", "1:1": "1088x1088", "4:5": "1088x1360", "9:16": "1088x1920" };
export const MAX_IMAGENS_GERADAS = 8;

export interface TrabalhoDaGeracao extends TrabalhoDoTemplate {
  legenda?: string | null;
  custo_usd?: number | null;
  modelo_imagem_id?: string | null;
}

type Erro = (status: number, codigo: string, mensagem: string, detalhes?: Record<string, unknown>) => Error;
export interface RespostaDoRedator { json: unknown; custoUsd: number; saldoUsd?: number | null }
export interface FotoDoGerador { bytes: Uint8Array; mime: string; custoUsd: number; saldoUsd?: number | null }

export interface DepsDaGeracao<C extends { userId: string }, T extends TrabalhoDaGeracao> {
  erro: Erro;
  json: (body: unknown, status?: number) => Response;
  trabalhoComAcesso: (ch: C, id: string) => Promise<T>;
  mutarTrabalho: (id: string, mudar: (t: T) => Record<string, unknown>) => Promise<T>;
  ehPostDeFotos: (t: T) => boolean;
  atualizarTexto: (t: T, ordem: number, texto: string) => T["direcao"];
  /** Estimativa em US$ pelo catálogo, sem chamar o provedor. */
  estimarTexto: (t: T) => Promise<number>;
  estimarImagem: (t: T, proporcao: ProporcaoDaFoto) => Promise<number>;
  /** O redator do Estúdio (modelo do diretor de arte) com a base de copy e a voz da marca. */
  escreverTexto: (ch: C, t: T, e: { sistema: string; pedido: Record<string, unknown>; esquema: Record<string, unknown>; rede: RedeDoTemplate }) => Promise<RespostaDoRedator>;
  /** O gerador de imagem do trabalho (modelo e qualidade escolhidos no Estúdio). */
  gerarFoto: (ch: C, t: T, e: { prompt: string; tamanho: string }) => Promise<FotoDoGerador>;
  guardarFoto: (t: T, bytes: Uint8Array, mime: string) => Promise<string>;
  descartarUpload?: (caminho: string) => Promise<void>;
  /** Adicionar, duplicar ou tirar um post do fio (sem IA): devolve o patch do trabalho ou lança com o motivo. */
  operarLamina?: (t: T, operacao: "adicionar" | "duplicar" | "tirar", ordem: number, texto: string) => Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHADOS = new Set(["entregue", "aprovado", "agendado", "arquivado"]);
const EM_APROVACAO = new Set(["aguardando_agencia", "aguardando_cliente", "aprovado", "agendado"]);
const REDES: RedeDoTemplate[] = ["twitter", "instagram", "story"];
const PROPORCOES: ProporcaoDaFoto[] = ["16:9", "1:1", "4:5", "9:16"];
const arred = (v: number) => Math.round(v * 1_000_000) / 1_000_000;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const objeto = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const limpo = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r/g, "").trim().slice(0, max) : "");
const usd = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;

export const ESQUEMA_CONTEUDO_DO_TEMPLATE = {
  nome: "conteudo_do_template",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["gancho", "posts", "legenda"],
    properties: {
      gancho: { type: "string" },
      posts: {
        type: "array",
        items: { type: "object", additionalProperties: false, required: ["ordem", "texto"], properties: { ordem: { type: "integer" }, texto: { type: "string" } } },
      },
      legenda: { type: "string" },
    },
  },
};

/** Regras por rede, com os limites reais (o motor de copy da casa vem junto no sistema). */
export function instrucoesDoConteudo(rede: RedeDoTemplate, quantos: number): string {
  const comum = [
    "CONTEÚDO DO TEMPLATE DO ESTÚDIO",
    "Você é o redator sênior da agência. Escreva o conteúdo do post simulado da marca, pronto para publicar, em português do Brasil, na voz da marca do contexto.",
    "Fatos só os do contexto, da pauta e do tema. Nada de preço, número, prazo, depoimento ou resultado inventado.",
    "Responda só o JSON pedido.",
  ];
  if (rede === "twitter") {
    return [...comum,
      `REDE: post do X. ${quantos > 1 ? `Um FIO de ${quantos} posts, um por lâmina, na ordem pedida: o 1 é o gancho que para a rolagem; os do meio entregam uma ideia cada; o último fecha com um CTA leve.` : "Um post único: gancho na primeira frase, uma ideia, um fecho."}`,
      `Cada post com no máximo ${LIMITE_DO_X - 20} caracteres (o X corta em ${LIMITE_DO_X}; emoji conta 2, link conta 23). Quebra de linha é permitida. No máximo 1 emoji por post e nenhuma hashtag no fio.`,
      "Em \"posts\", devolva exatamente as ordens pedidas. \"gancho\" é a primeira frase do primeiro post.",
      `Em "legenda", a legenda do Instagram que acompanha a imagem do post (até 600 caracteres, gancho nos primeiros ${GANCHO_DA_LEGENDA}, 3 a 5 hashtags no fim).`,
    ].join("\n");
  }
  if (rede === "story") {
    return [...comum,
      `REDE: Story do Instagram, ${quantos} tela${quantos === 1 ? "" : "s"} na ordem pedida. Cada texto com no máximo ${LIMITE_DO_STORY - 30} caracteres, para ler em 3 segundos; a última tela chama para responder ou tocar no link.`,
      "Em \"posts\", um item por tela, nas ordens pedidas. \"gancho\" é o texto da primeira tela. \"legenda\" fica vazia.",
    ].join("\n");
  }
  return [...comum,
    `REDE: post do feed do Instagram${quantos > 1 ? ` em carrossel de ${quantos} lâminas (as imagens não têm texto: a mensagem inteira está na legenda)` : ""}.`,
    `"legenda": gancho nos primeiros ${GANCHO_DA_LEGENDA} caracteres (a primeira linha funciona sozinha antes do "mais"), corpo escaneável em parágrafos curtos, um CTA e 3 a 5 hashtags no fim. Até ${LIMITE_DA_LEGENDA} caracteres, de preferência menos de 1.200.`,
    "\"gancho\" é a primeira linha da legenda. \"posts\" fica vazio.",
  ].join("\n");
}

/** O que a foto do post mostra, montado pelo código a partir da lâmina e do pedido da equipe. */
export function promptDaFotoDoPost(e: { descricao: string; lamina: string; conceito: string; proporcao: ProporcaoDaFoto; rede: RedeDoTemplate }): string {
  const assunto = e.descricao || e.lamina;
  return [
    `Uma fotografia para ${e.rede === "twitter" ? "a imagem de um post do X" : e.rede === "story" ? "um Story do Instagram" : "um post do feed do Instagram"}, na proporção ${e.proporcao}, ocupando o quadro inteiro.`,
    `O que aparece: ${assunto}`,
    e.conceito ? `Conceito do conteúdo: ${e.conceito}` : "",
    "Fotografia realista, luz natural coerente, composição limpa, alta qualidade.",
    "SEM TEXTO NA IMAGEM: nenhuma letra, palavra, número, legenda, logo, marca d'água, selo, moldura, borda, colagem ou interface de aplicativo. É só a foto; a interface do post é desenhada depois, fora dela.",
  ].filter(Boolean).join("\n\n");
}

function abrirTrabalho<T extends TrabalhoDaGeracao>(t: T, ordem: number, d: Pick<DepsDaGeracao<{ userId: string }, T>, "erro" | "ehPostDeFotos">) {
  if (FECHADOS.has(t.status) || EM_APROVACAO.has(t.entrega_status || "")) throw d.erro(409, "trabalho_entregue", "Este trabalho está entregue ou em aprovação. Reabra para gerar de novo.");
  if (t.tipo === "ads" || d.ehPostDeFotos(t)) throw d.erro(409, "template_indisponivel", "O Template está disponível para artes e carrosséis do Estúdio.");
  const card = t.direcao.cards.find((c) => c.ordem === ordem);
  if (!card) throw d.erro(404, "card_inexistente", "Esta lâmina não existe na direção do trabalho.");
  return card;
}

/** Custo antes: sem a confirmação explícita, nada é gasto. */
function pedirConfirmacao(d: { erro: Erro }, custo: number, oque: string): never {
  throw d.erro(409, "confirmar_custo", `${oque} custa cerca de ${usd(custo)}. Confirme para continuar.`, { precisa_confirmar: true, custo_estimado_usd: arred(custo) });
}

export interface PostGerado { ordem: number; texto: string }

/** Lê a resposta do redator: só as ordens pedidas, sem cortar texto (o que passa do limite vira aviso). */
export function lerConteudoGerado(bruto: unknown, rede: RedeDoTemplate, ordens: number[]): { posts: PostGerado[]; legenda: string; gancho: string; avisos: string[] } {
  const o = objeto(bruto);
  const avisos: string[] = [];
  const posts: PostGerado[] = [];
  const lista = Array.isArray(o.posts) ? o.posts : [];
  for (const ordem of ordens) {
    const achado = lista.map(objeto).find((p) => p.ordem === ordem);
    const texto = limpo(achado?.texto, rede === "story" ? 600 : 2000);
    if (!texto) { avisos.push(`O redator não escreveu ${rede === "story" ? "a tela" : "o post"} da lâmina ${ordem}: ela ficou com o texto anterior.`); continue; }
    if (rede === "twitter" && caracteresDoX(texto) > LIMITE_DO_X) avisos.push(`O post da lâmina ${ordem} passou de ${LIMITE_DO_X} caracteres do X. Encurte antes de publicar.`);
    if (rede === "story" && Array.from(texto).length > LIMITE_DO_STORY) avisos.push(`O texto da tela ${ordem} passou de ${LIMITE_DO_STORY} caracteres.`);
    posts.push({ ordem, texto });
  }
  const legenda = limpo(o.legenda, LIMITE_DA_LEGENDA + 400);
  if (legenda && Array.from(legenda).length > LIMITE_DA_LEGENDA) avisos.push(`A legenda passou de ${LIMITE_DA_LEGENDA} caracteres do Instagram. Encurte antes de publicar.`);
  if (hashtagsDoTexto(legenda).length > MAX_HASHTAGS) avisos.push(`A legenda tem mais de ${MAX_HASHTAGS} hashtags.`);
  const gancho = limpo(o.gancho, 400) || (legenda.split("\n")[0] || posts[0]?.texto.split("\n")[0] || "");
  return { posts, legenda: rede === "story" ? "" : legenda, gancho, avisos };
}

export function acoesDaGeracaoDoTemplate<C extends { userId: string }, T extends TrabalhoDaGeracao>(d: DepsDaGeracao<C, T>) {
  function base(corpo: Record<string, unknown>) {
    if (typeof corpo.trabalho_id !== "string" || !UUID.test(corpo.trabalho_id)) throw d.erro(400, "pedido_template_invalido", "Informe o trabalho do template.");
    if (typeof corpo.ordem !== "number" || !Number.isInteger(corpo.ordem) || corpo.ordem < 1) throw d.erro(400, "ordem_template_invalida", "Informe a lâmina do template.");
    const rede = REDES.indexOf(corpo.rede as RedeDoTemplate) >= 0 ? corpo.rede as RedeDoTemplate : null;
    if (!rede) throw d.erro(400, "rede_template_invalida", "Escolha post do X, post do Instagram ou Story.");
    return { id: corpo.trabalho_id, ordem: corpo.ordem, rede };
  }

  async function conteudo(ch: C, corpo: Record<string, unknown>): Promise<Response> {
    const { id, ordem, rede } = base(corpo);
    if (corpo.tema !== undefined && (typeof corpo.tema !== "string" || corpo.tema.length > 600)) throw d.erro(400, "tema_template_invalido", "Escreva o tema com até 600 caracteres.");
    const tema = limpo(corpo.tema, 600);
    const t = await d.trabalhoComAcesso(ch, id);
    abrirTrabalho(t, ordem, d);
    const todas = corpo.todas === true;
    const ordens = rede === "instagram" ? [] : todas ? t.direcao.cards.map((c) => c.ordem).sort((a, b) => a - b) : [ordem];
    const quantos = rede === "instagram" ? t.direcao.cards.length : ordens.length;
    if (corpo.confirmado !== true) pedirConfirmacao(d, await d.estimarTexto(t), "Gerar o conteúdo");
    const conceito = limpo((t.direcao as { conceito?: unknown }).conceito, 800);
    const pedido = {
      rede,
      tema: tema || null,
      pauta: { conceito: conceito || null, laminas: t.direcao.cards.map((c) => ({ ordem: c.ordem, texto_atual: limpo(c.texto_exato, 600) })) },
      ordens_pedidas: ordens,
      quantidade: quantos,
      legenda_atual: limpo(t.legenda, 2200) || null,
    };
    const r = await d.escreverTexto(ch, t, { sistema: instrucoesDoConteudo(rede, quantos), pedido, esquema: ESQUEMA_CONTEUDO_DO_TEMPLATE, rede });
    const lido = lerConteudoGerado(r.json, rede, ordens);
    const custo = arred(num(r.custoUsd));
    const vazio = rede === "instagram" ? !lido.legenda : lido.posts.length === 0;
    if (vazio) {
      // O que a IA já cobrou entra no trabalho; nada de texto vazio na lâmina.
      await d.mutarTrabalho(t.id, (x) => ({ custo_usd: arred(num(x.custo_usd) + custo) }));
      throw d.erro(502, "conteudo_template_vazio", "O redator não devolveu um conteúdo utilizável. Tente de novo ou mude o tema.", { custo_usd: custo });
    }
    const gravarLegenda = corpo.gravar_legenda === true && !!lido.legenda;
    let recusa: unknown = null;
    const gravado = await d.mutarTrabalho(t.id, (atual) => {
      recusa = null;
      try {
        abrirTrabalho(atual, ordem, d);
      } catch (e) {
        // Fechou no meio: o texto não entra, mas o que a IA já cobrou fica registrado.
        recusa = e;
        return { custo_usd: arred(num(atual.custo_usd) + custo) };
      }
      let direcao = atual.direcao;
      for (const p of lido.posts) {
        if (!direcao.cards.some((c) => c.ordem === p.ordem)) continue;
        direcao = d.atualizarTexto({ ...atual, direcao } as T, p.ordem, p.texto);
      }
      return {
        ...(lido.posts.length ? { direcao } : {}),
        ...(gravarLegenda ? { legenda: lido.legenda } : {}),
        custo_usd: arred(num(atual.custo_usd) + custo),
      };
    });
    if (recusa) throw recusa;
    return d.json({ trabalho: gravado, rede, posts: lido.posts, legenda: lido.legenda || null, legenda_gravada: gravarLegenda, gancho: lido.gancho, avisos: lido.avisos, custo_usd: custo, saldo_usd: r.saldoUsd ?? null });
  }

  async function imagem(ch: C, corpo: Record<string, unknown>): Promise<Response> {
    const { id, ordem, rede } = base(corpo);
    const proporcao = PROPORCOES.indexOf(corpo.proporcao as ProporcaoDaFoto) >= 0 ? corpo.proporcao as ProporcaoDaFoto : null;
    if (!proporcao) throw d.erro(400, "proporcao_template_invalida", "Escolha a proporção da foto: 16:9, 1:1, 4:5 ou 9:16.");
    if (corpo.descricao !== undefined && (typeof corpo.descricao !== "string" || corpo.descricao.length > 600)) throw d.erro(400, "descricao_foto_invalida", "Descreva a foto com até 600 caracteres.");
    const descricao = limpo(corpo.descricao, 600);
    const t = await d.trabalhoComAcesso(ch, id);
    const card = abrirTrabalho(t, ordem, d);
    if (!t.modelo_imagem_id) throw d.erro(409, "sem_modelo_de_imagem", "Escolha o modelo de imagem do Estúdio antes de gerar a foto.");
    const geradas = (card as { imagens_do_template?: unknown }).imagens_do_template;
    if (Array.isArray(geradas) && geradas.length >= MAX_IMAGENS_GERADAS) throw d.erro(409, "limite_imagens_template", `Esta lâmina já tem ${MAX_IMAGENS_GERADAS} fotos geradas. Use uma delas no Template.`);
    if (corpo.confirmado !== true) pedirConfirmacao(d, await d.estimarImagem(t, proporcao), "Gerar a foto");
    const c = card as { texto_exato?: string; composicao?: string; ilustracao?: string; prompt_imagem?: string };
    const lamina = limpo(c.composicao || c.ilustracao || c.prompt_imagem || c.texto_exato, 600);
    if (!descricao && !lamina) throw d.erro(400, "descricao_foto_vazia", "Descreva o que a foto mostra.");
    const prompt = promptDaFotoDoPost({ descricao, lamina, conceito: limpo((t.direcao as { conceito?: unknown }).conceito, 400), proporcao, rede });
    const foto = await d.gerarFoto(ch, t, { prompt, tamanho: TAMANHO_DA_FOTO[proporcao] });
    const custo = arred(num(foto.custoUsd));
    const caminho = await d.guardarFoto(t, foto.bytes, foto.mime);
    const nova: ImagemGeradaDoTemplate = { caminho, origem: "gerador", descricao: descricao || lamina.slice(0, 300), proporcao, criado_em: new Date().toISOString(), custo_usd: custo };
    let anexou = false;
    const gravado = await d.mutarTrabalho(t.id, (atual) => {
      anexou = false;
      if (atual.client_id !== t.client_id) throw d.erro(409, "cliente_template_alterado", "O cliente do trabalho mudou. Abra o trabalho novamente.");
      const alvo = atual.direcao.cards.find((x) => x.ordem === ordem);
      const cards = alvo && !FECHADOS.has(atual.status) && !EM_APROVACAO.has(atual.entrega_status || "")
        ? atual.direcao.cards.map((x) => {
          if (x.ordem !== ordem) return x;
          const antes = (x as { imagens_do_template?: unknown }).imagens_do_template;
          anexou = true;
          return { ...x, imagens_do_template: [...(Array.isArray(antes) ? antes : []), nova].slice(-MAX_IMAGENS_GERADAS) };
        })
        : null;
      // A foto já foi paga: o custo entra no trabalho mesmo se a lâmina saiu ou fechou no meio.
      return { ...(cards ? { direcao: { ...atual.direcao, cards } } : {}), custo_usd: arred(num(atual.custo_usd) + custo) };
    });
    if (!anexou) {
      if (d.descartarUpload) await d.descartarUpload(caminho).catch(() => undefined);
      throw d.erro(409, "lamina_template_alterada", "A lâmina mudou ou o trabalho foi fechado durante a geração. A foto não foi guardada.", { custo_usd: custo });
    }
    return d.json({ trabalho: gravado, imagem: nova, custo_usd: custo, saldo_usd: foto.saldoUsd ?? null });
  }

  /** Os cards da lateral do Template: adicionar depois, duplicar ou tirar um post, sem custo. */
  async function lamina(ch: C, corpo: Record<string, unknown>): Promise<Response> {
    if (typeof corpo.trabalho_id !== "string" || !UUID.test(corpo.trabalho_id)) throw d.erro(400, "pedido_template_invalido", "Informe o trabalho do template.");
    if (typeof corpo.ordem !== "number" || !Number.isInteger(corpo.ordem) || corpo.ordem < 1) throw d.erro(400, "ordem_template_invalida", "Informe o post do fio.");
    const operacao = corpo.operacao === "adicionar" || corpo.operacao === "duplicar" || corpo.operacao === "tirar" ? corpo.operacao : null;
    if (!operacao || !d.operarLamina) throw d.erro(400, "operacao_template_invalida", "Escolha adicionar, duplicar ou tirar o post.");
    if (corpo.texto !== undefined && (typeof corpo.texto !== "string" || corpo.texto.length > 2200)) throw d.erro(400, "texto_template_invalido", "Texto do post novo inválido.");
    const texto = limpo(corpo.texto, 2200) || "Novo post do fio";
    const ordem = corpo.ordem;
    const t = await d.trabalhoComAcesso(ch, corpo.trabalho_id);
    abrirTrabalho(t, ordem, d);
    if (operacao !== "tirar" && t.direcao.cards.length >= 10) throw d.erro(409, "limite_laminas", "O fio já tem 10 posts.");
    if (operacao === "tirar" && t.direcao.cards.length < 2) throw d.erro(409, "ultima_lamina", "O fio precisa de pelo menos um post.");
    const operar = d.operarLamina;
    const gravado = await d.mutarTrabalho(t.id, (atual) => {
      abrirTrabalho(atual, ordem, d);
      try { return operar(atual, operacao, ordem, texto); } catch (e) {
        throw d.erro(409, "lamina_template_recusada", e instanceof Error ? e.message : "Não deu para mudar os posts.");
      }
    });
    return d.json({ trabalho: gravado, operacao, ordem: operacao === "tirar" ? Math.max(1, Math.min(ordem, gravado.direcao.cards.length)) : ordem + 1, custo_usd: 0 });
  }

  return { template_conteudo: conteudo, template_imagem: imagem, template_lamina: lamina };
}
