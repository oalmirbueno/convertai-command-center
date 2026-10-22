/**
 * Mudança planejada da campanha em andamento (22/10/2026, dono: "se eu quiser durante a campanha mudar algo,
 * mudar a condução, colocar produto pra vender... um editor completo, a campanha rodando, adaptando aquela que já
 * está funcionando; ele muda o que eu quiser ('quero mais agressiva')").
 *
 * Padrão agêntico da casa (aceleriq-agentes-com-confirmacao): o modelo nunca vê UUID nem tema_id; as peças
 * ganham apelido a1..aN; a resposta vira uma lista (anexo acao_agente) e nada muda até a equipe confirmar
 * (tudo ou só partes). Peças protegidas (na agenda, aprovadas ou publicadas) só entram desmarcadas e com o
 * aviso. Ao confirmar, a campanha guarda uma versão antes (dá para voltar). Puro: sem Deno nem banco.
 */

export interface PecaParaOAgente {
  apelido: string;
  tema_id: string;
  data: string;
  formato: string;
  etapa: string;
  tema: string;
  gancho: string;
  cta: string;
  laminas: string[];
  protegida: boolean;
  /** Já tem arte (trabalho do Estúdio): mudar o texto pede refazer a arte. */
  com_arte: boolean;
}

export interface ItemDaMudanca {
  ref: string;
  alvo_id: string;
  titulo: string;
  detalhe: string | null;
  operacao: string;
  rotulo: string;
  para: string | null;
  para_rotulo?: string | null;
}

/** Esquema estrito da mudança (campo vazio = sem mudança). */
export const ESQUEMA_DA_MUDANCA = {
  nome: "mudanca_da_campanha",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["resposta", "nome", "briefing", "conducao", "alterar", "novas", "sair"],
    properties: {
      resposta: { type: "string" },
      nome: { type: "string" },
      briefing: {
        type: "object",
        additionalProperties: false,
        required: ["oferta", "mensagem_central", "publico", "tom", "cta"],
        properties: { oferta: { type: "string" }, mensagem_central: { type: "string" }, publico: { type: "string" }, tom: { type: "string" }, cta: { type: "string" } },
      },
      conducao: { type: "string" },
      alterar: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["peca", "tema", "gancho", "data", "etapa", "cta", "legenda", "laminas", "motivo"],
          properties: {
            peca: { type: "string" },
            tema: { type: "string" },
            gancho: { type: "string" },
            data: { type: "string" },
            etapa: { type: "string" },
            cta: { type: "string" },
            legenda: { type: "string" },
            laminas: { type: "array", items: { type: "string" } },
            motivo: { type: "string" },
          },
        },
      },
      novas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["data", "formato", "etapa", "tema", "gancho", "laminas", "cta", "produto", "motivo"],
          properties: {
            data: { type: "string" },
            formato: { type: "string", enum: ["estatico", "carrossel", "video"] },
            etapa: { type: "string" },
            tema: { type: "string" },
            gancho: { type: "string" },
            laminas: { type: "array", items: { type: "string" } },
            cta: { type: "string" },
            produto: { type: "string" },
            motivo: { type: "string" },
          },
        },
      },
      sair: { type: "array", items: { type: "object", additionalProperties: false, required: ["peca", "motivo"], properties: { peca: { type: "string" }, motivo: { type: "string" } } } },
    },
  },
};

export const REGRAS_DA_MUDANCA = `MUDANÇA PLANEJADA (nada muda antes de a equipe confirmar):
- Cite as peças só pelo apelido (a1, a2...). Peça "protegida": true já está na agenda, aprovada ou publicada: só mexa nela se o pedido falar dela de forma explícita; mesmo assim ela vem desmarcada para a equipe decidir.
- nome: o novo nome da campanha só se mudar; senão vazio.
- briefing: escreva só os campos que mudam (oferta, mensagem_central, publico, tom, cta); o que não muda vai vazio.
- conducao: a nova condução da campanha (o jeito de conduzir daqui para a frente: ritmo, intensidade, ênfase), só se mudar; senão vazio.
- alterar: só as peças que mudam, com os campos novos (o que não muda vai vazio; laminas vazia = mantém; legenda = a legenda nova do post). Data só de segunda a sexta dentro do período.
- novas: peças novas (formato estatico, carrossel ou video), com data, etapa (aquecimento, lançamento, urgência ou encerramento), tema, gancho, lâminas e CTA; produto = o nome do produto da campanha que a peça vende, ou vazio.
- sair: peças que saem, com o motivo.
- resposta: em até 4 frases, o que a mudança faz e por quê. Sem travessão.`;

const txt = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().replace(/\s*[–—]\s*/g, ", ").slice(0, max) : "");
const DATA = /^\d{4}-\d{2}-\d{2}$/;

const ROTULO_DO_CAMPO: Record<string, string> = { oferta: "Oferta", mensagem_central: "Mensagem central", publico: "Público", tom: "Tom", cta: "CTA" };

/** As peças com apelido a1..aN, na ordem da data (o que o modelo vê). */
export function pecasComApelido(
  itens: Array<{ tema_id?: string; data?: string; formato?: string; etapa?: string; tema?: string; gancho?: string; cta?: string; cards?: Array<{ ordem: number; texto?: string }>; task_id?: string | null }>,
  protegidasPorTrabalho: Set<string>,
  comArte: Set<string>,
): PecaParaOAgente[] {
  return itens
    .filter((i) => i && i.tema_id)
    .slice()
    .sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")))
    .map((i, k) => ({
      apelido: `a${k + 1}`,
      tema_id: String(i.tema_id),
      data: String(i.data || ""),
      formato: String(i.formato || ""),
      etapa: String(i.etapa || ""),
      tema: String(i.tema || ""),
      gancho: String(i.gancho || ""),
      cta: String(i.cta || ""),
      laminas: (i.cards || []).slice().sort((x, y) => x.ordem - y.ordem).map((c) => String(c.texto || "")),
      protegida: !!i.task_id || protegidasPorTrabalho.has(String(i.tema_id)),
      com_arte: comArte.has(String(i.tema_id)),
    }));
}

const antesDepois = (antes: string, depois: string) => `${antes || "(vazio)"} → ${depois}`;

/**
 * A resposta do modelo vira a lista da mudança (itens com apelido próprio m1..mN para a confirmação parcial).
 * Apelido de peça que não existe vai para `ignorados`; nada é inventado.
 */
export function itensDaMudanca(
  r: Record<string, unknown>,
  pecas: PecaParaOAgente[],
  atual: { briefing: Record<string, unknown>; conducao: string; periodo: { inicio: string; fim: string } },
): { itens: ItemDaMudanca[]; ignorados: string[] } {
  const itens: ItemDaMudanca[] = [];
  const ignorados: string[] = [];
  let n = 0;
  const ref = () => `m${++n}`;
  const b = (r.briefing && typeof r.briefing === "object" ? r.briefing : {}) as Record<string, unknown>;
  Object.keys(ROTULO_DO_CAMPO).forEach((campo) => {
    const novo = txt(b[campo], 600);
    const antes = txt(atual.briefing[campo], 600);
    if (!novo || novo === antes) return;
    itens.push({ ref: ref(), alvo_id: campo, titulo: ROTULO_DO_CAMPO[campo], detalhe: antesDepois(antes, novo), operacao: "briefing", rotulo: "Briefing", para: JSON.stringify({ campo, valor: novo }) });
  });
  const nome = txt(r.nome, 120);
  if (nome && nome !== txt(atual.briefing.__nome, 120)) {
    itens.push({ ref: ref(), alvo_id: "nome", titulo: "Nome da campanha", detalhe: antesDepois(txt(atual.briefing.__nome, 120), nome), operacao: "nome", rotulo: "Nome", para: JSON.stringify({ valor: nome }) });
  }
  const conducao = txt(r.conducao, 600);
  if (conducao && conducao !== atual.conducao) {
    itens.push({ ref: ref(), alvo_id: "conducao", titulo: "Condução", detalhe: antesDepois(atual.conducao, conducao), operacao: "conducao", rotulo: "Condução", para: JSON.stringify({ valor: conducao }) });
  }
  const porApelido = (a: unknown) => pecas.filter((p) => p.apelido === txt(a, 8).toLowerCase())[0] || null;
  (Array.isArray(r.alterar) ? r.alterar : []).forEach((x) => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const p = porApelido(o.peca);
    if (!p) {
      ignorados.push(txt(o.peca, 8) || "?");
      return;
    }
    const campos: Record<string, unknown> = {};
    const partes: string[] = [];
    (["tema", "gancho", "etapa", "cta"] as const).forEach((k) => {
      const v = txt(o[k], k === "tema" ? 200 : 400);
      if (v && v !== (p as unknown as Record<string, string>)[k]) {
        campos[k] = v;
        partes.push(`${k === "cta" ? "CTA" : k.charAt(0).toUpperCase() + k.slice(1)}: ${antesDepois((p as unknown as Record<string, string>)[k], v)}`);
      }
    });
    const data = txt(o.data, 10);
    if (DATA.test(data) && data !== p.data && data >= atual.periodo.inicio && data <= atual.periodo.fim) {
      campos.data = data;
      partes.push(`Data: ${antesDepois(p.data, data)}`);
    }
    const legenda = typeof o.legenda === "string" ? o.legenda.trim().slice(0, 2200) : "";
    if (legenda) {
      campos.copy = legenda;
      partes.push("Legenda reescrita");
    }
    const laminas = (Array.isArray(o.laminas) ? o.laminas : []).map((l) => txt(l, 1200)).filter(Boolean);
    if (laminas.length && laminas.join("|") !== p.laminas.join("|")) {
      campos.laminas = laminas;
      partes.push(`Lâminas: ${laminas.length} reescrita(s)`);
    }
    if (!partes.length) return;
    const motivo = txt(o.motivo, 200);
    itens.push({
      ref: ref(),
      alvo_id: p.tema_id,
      titulo: `${p.apelido} · ${p.tema || "Peça"}`,
      detalhe: `${p.protegida ? "Já aprovada ou na agenda: só com a sua marcação. " : ""}${partes.join("; ")}${motivo ? ` (${motivo})` : ""}${p.com_arte ? " · a arte será refeita" : ""}`,
      operacao: p.protegida ? "alterar_peca_protegida" : "alterar_peca",
      rotulo: "Muda",
      para: JSON.stringify(campos),
    });
  });
  (Array.isArray(r.novas) ? r.novas : []).forEach((x) => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const tema = txt(o.tema, 200);
    if (!tema) return;
    const formato = o.formato === "estatico" || o.formato === "video" ? String(o.formato) : "carrossel";
    const data = txt(o.data, 10);
    const nova = {
      data: DATA.test(data) && data >= atual.periodo.inicio && data <= atual.periodo.fim ? data : atual.periodo.fim,
      formato,
      etapa: txt(o.etapa, 60),
      tema,
      gancho: txt(o.gancho, 400),
      laminas: (Array.isArray(o.laminas) ? o.laminas : []).map((l) => txt(l, 1200)).filter(Boolean).slice(0, 10),
      cta: txt(o.cta, 300),
      produto: txt(o.produto, 120),
    };
    const motivo = txt(o.motivo, 200);
    itens.push({
      ref: ref(),
      alvo_id: "",
      titulo: tema,
      detalhe: `${formato === "estatico" ? "Post" : formato === "video" ? "Vídeo" : "Carrossel"} · ${nova.etapa || "sem etapa"} · ${nova.data}${nova.produto ? ` · ${nova.produto}` : ""}${motivo ? ` (${motivo})` : ""}`,
      operacao: "nova_peca",
      rotulo: "Entra",
      para: JSON.stringify(nova),
    });
  });
  (Array.isArray(r.sair) ? r.sair : []).forEach((x) => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const p = porApelido(o.peca);
    if (!p) {
      ignorados.push(txt(o.peca, 8) || "?");
      return;
    }
    itens.push({
      ref: ref(),
      alvo_id: p.tema_id,
      titulo: `${p.apelido} · ${p.tema || "Peça"}`,
      detalhe: `${p.protegida ? "Já aprovada ou na agenda: só com a sua marcação. " : ""}${txt(o.motivo, 200) || "sai da série"}`,
      operacao: p.protegida ? "tirar_peca_protegida" : "tirar_peca",
      rotulo: "Sai",
      para: null,
    });
  });
  return { itens: itens.slice(0, 40), ignorados };
}

/** Os itens escolhidos pela equipe: só os refs pedidos (sem lista, todos menos os protegidos). */
export function itensEscolhidos(itens: ItemDaMudanca[], refs: unknown): ItemDaMudanca[] {
  const pedidos = Array.isArray(refs) ? refs.map((x) => String(x)) : null;
  return itens.filter((i) => (pedidos ? pedidos.indexOf(i.ref) >= 0 : i.operacao.indexOf("_protegida") < 0));
}

export interface ItemDaSerie {
  tema_id: string;
  data: string;
  formato: string;
  etapa?: string;
  tema: string;
  gancho: string;
  cta: string;
  cards: Array<{ ordem: number; texto?: string; funcao?: string; ilustracao?: string }>;
  task_id?: string | null;
  produto?: string;
  [k: string]: unknown;
}

/**
 * Aplica os itens escolhidos sobre o estado (briefing, condução e a série), sem banco. Peças novas ganham o
 * próximo cN; as que mudaram ou saíram e tinham arte voltam em `refazer` (a arte antiga é arquivada).
 */
export function aplicarMudanca(
  estado: { briefing: Record<string, unknown>; itens: ItemDaSerie[] },
  escolhidos: ItemDaMudanca[],
): { briefing: Record<string, unknown>; itens: ItemDaSerie[]; mudaram: string[]; sairam: string[]; novas: ItemDaSerie[] } {
  const briefing = { ...estado.briefing };
  let itens = estado.itens.map((i) => ({ ...i, cards: (i.cards || []).map((c) => ({ ...c })) }));
  const mudaram: string[] = [];
  const sairam: string[] = [];
  const novas: ItemDaSerie[] = [];
  let seq = Math.max(itens.length, ...itens.map((i) => Number(String(i.tema_id).replace(/^c/, "")) || 0));
  const ler = (s: string | null): Record<string, unknown> => {
    try {
      return s ? (JSON.parse(s) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  escolhidos.forEach((it) => {
    const p = ler(it.para);
    if (it.operacao === "briefing" && typeof p.campo === "string") briefing[p.campo] = String(p.valor || "");
    else if (it.operacao === "nome") briefing.__nome = String(p.valor || "");
    else if (it.operacao === "conducao") briefing.conducao = String(p.valor || "");
    else if (it.operacao === "alterar_peca" || it.operacao === "alterar_peca_protegida") {
      itens = itens.map((i) => {
        if (i.tema_id !== it.alvo_id) return i;
        const novo = { ...i };
        (["tema", "gancho", "etapa", "cta", "data", "copy"] as const).forEach((k) => {
          if (typeof p[k] === "string" && p[k]) (novo as Record<string, unknown>)[k] = p[k];
        });
        if (Array.isArray(p.laminas) && p.laminas.length) {
          const textos = (p.laminas as unknown[]).map(String);
          novo.cards = textos.map((t, k) => ({ ...(i.cards[k] || {}), ordem: k + 1, texto: t }));
          if (novo.formato === "estatico") novo.cards = novo.cards.slice(0, 1);
        }
        mudaram.push(i.tema_id);
        return novo;
      });
    } else if (it.operacao === "tirar_peca" || it.operacao === "tirar_peca_protegida") {
      if (itens.some((i) => i.tema_id === it.alvo_id)) sairam.push(it.alvo_id);
      itens = itens.filter((i) => i.tema_id !== it.alvo_id);
    } else if (it.operacao === "nova_peca") {
      const laminas = Array.isArray(p.laminas) ? (p.laminas as unknown[]).map(String) : [];
      const nova: ItemDaSerie = {
        tema_id: `c${++seq}`,
        data: String(p.data || ""),
        formato: String(p.formato || "carrossel"),
        etapa: String(p.etapa || ""),
        tema: String(p.tema || ""),
        gancho: String(p.gancho || ""),
        cta: String(p.cta || ""),
        cards: (laminas.length ? laminas : [String(p.gancho || p.tema || "")]).map((t, k) => ({ ordem: k + 1, texto: t })),
        ...(p.produto ? { produto: String(p.produto) } : {}),
      };
      if (nova.formato === "estatico") nova.cards = nova.cards.slice(0, 1);
      if (nova.formato === "video") nova.cards = [];
      novas.push(nova);
      itens.push(nova);
    }
  });
  itens.sort((a, b) => String(a.data).localeCompare(String(b.data)));
  return { briefing, itens, mudaram, sairam, novas };
}

/** Uma versão da campanha (o que estava antes da mudança): guardada em arquivo, o índice no briefing. */
export interface VersaoDaCampanha {
  id: string;
  criada_em: string;
  motivo: string;
  por: string | null;
  caminho: string;
  arquivados: string[];
}

export function versoesDaCampanha(v: unknown): VersaoDaCampanha[] {
  return (Array.isArray(v) ? v : [])
    .map((x) => {
      const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return {
        id: txt(o.id, 64),
        criada_em: txt(o.criada_em, 40),
        motivo: txt(o.motivo, 300),
        por: txt(o.por, 64) || null,
        caminho: typeof o.caminho === "string" ? o.caminho.slice(0, 300) : "",
        arquivados: (Array.isArray(o.arquivados) ? o.arquivados : []).map((a) => String(a)).slice(0, 40),
      };
    })
    .filter((x) => x.id && x.caminho)
    .slice(0, 20);
}
