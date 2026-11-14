/**
 * Robô de WhatsApp do CRM da empresa (14/11/2026, rodada 3). Arquivo puro: sem Deno, sem rede, sem banco.
 * Usado pelo servidor (produto-meta e produto-meta-rotina), pela tela (lista de templates) e pelos testes.
 *
 * O número da EMPRESA (Cloud API oficial, WABA dela) é o robô. Ele dá as boas-vindas por template, faz no
 * máximo 4 perguntas com botões (o que falta para a pontuação, mais renda e capacidade de pagamento),
 * requalifica o lead e passa para o vendedor, que conversa no WhatsApp dele. Fora da janela de 24 h só sai
 * template. Quem pede para parar nunca mais recebe.
 *
 * Aqui moram: os corpos da Cloud API, a leitura do que chega pelo webhook, a máquina de estados da conversa
 * (proximoPasso), o resumo para o vendedor, o casamento de texto livre com as opções e a lista dos
 * templates que a empresa precisa criar.
 */
import { faltamResponder, pontuar, type Faixa, type RegrasDePontuacao } from "./pontuacao-do-crm.ts";

/** Versão da Graph API conferida na documentação da Meta em 13/11/2026 (v27.0 saiu em 04/11/2026). */
export const VERSAO_DA_GRAPH_DO_WHATSAPP = "v27.0";
export const JANELA_HORAS = 24;
export const MAXIMO_DE_PERGUNTAS = 4;
/** Depois do último follow-up, quanto o robô ainda espera antes de encerrar. */
export const ESPERA_FINAL_HORAS = 24;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const soDigitos = (v: unknown): string => String(v === null || v === undefined ? "" : v).replace(/\D/g, "");
const vazio = (v: unknown): boolean => v === undefined || v === null || v === "";
export const semAcento = (t: unknown): string => String(t === null || t === undefined ? "" : t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const primeiroNome = (nome: unknown): string => {
  const p = String(nome || "").trim().split(/\s+/)[0] || "";
  return p.length >= 2 ? p.slice(0, 30) : "tudo bem";
};
const maisHoras = (iso: string, horas: number): string => new Date(new Date(iso).getTime() + horas * 3600000).toISOString();

/** O número como a Cloud API espera: só dígitos, com país. Número brasileiro sem o 55 ganha o 55. */
export function telefoneParaEnvio(v: unknown): string | null {
  let d = soDigitos(v);
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return /^[0-9]{12,15}$/.test(d) ? d : null;
}

/** Tira o token de qualquer texto que vá para registro, erro ou resposta. */
export function semToken(texto: unknown, token = ""): string {
  let t = String(texto === null || texto === undefined ? "" : texto);
  if (token) t = t.split(token).join("[token]");
  return t.replace(/access_token=[^&\s"]+/gi, "access_token=[token]").replace(/Bearer\s+[A-Za-z0-9_.|-]+/gi, "Bearer [token]").replace(/EAA[A-Za-z0-9]{20,}/g, "[token]").slice(0, 280);
}

// ---------------------------------------------------------------------------
// Corpos da Cloud API (POST /<versão>/<phone_number_id>/messages)
// ---------------------------------------------------------------------------
export type CorpoDaMeta = Record<string, unknown>;
export interface OpcaoDeResposta {
  id: string;
  titulo: string;
  descricao?: string;
}

const base = (para: string) => ({ messaging_product: "whatsapp", recipient_type: "individual", to: para });

/** Variável de template: sem quebra de linha, sem tabulação, sem espaços em sequência e nunca vazia. */
export function limparVariavel(v: unknown): string {
  const t = String(v === null || v === undefined ? "" : v).replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return (t || "não informado").slice(0, 500);
}

export function corpoDeTexto(para: string, texto: string): CorpoDaMeta {
  return { ...base(para), type: "text", text: { preview_url: false, body: String(texto).slice(0, 4096) } };
}

/**
 * Template aprovado. `variaveis` preenche o corpo ({{1}}, {{2}}...) e `botoes` leva o payload de cada botão
 * de resposta rápida, na ordem (só mande se o template tiver exatamente esses botões).
 */
export function corpoDeTemplate(para: string, nome: string, idioma: string, variaveis: unknown[] = [], botoes: string[] = []): CorpoDaMeta {
  const components: Array<Record<string, unknown>> = [];
  if (variaveis.length) components.push({ type: "body", parameters: variaveis.map((v) => ({ type: "text", text: limparVariavel(v) })) });
  botoes.forEach((payload, i) => components.push({ type: "button", sub_type: "quick_reply", index: String(i), parameters: [{ type: "payload", payload: String(payload).slice(0, 128) }] }));
  return { ...base(para), type: "template", template: { name: nome, language: { code: idioma || "pt_BR" }, ...(components.length ? { components } : {}) } };
}

/** Títulos cortados no limite e sem repetição (a Meta recusa botões com o mesmo título). */
function titulosUnicos(opcoes: OpcaoDeResposta[], limite: number): OpcaoDeResposta[] {
  const vistos: Record<string, number> = {};
  return opcoes.map((o) => {
    let titulo = String(o.titulo || "").trim().slice(0, limite) || "Opção";
    const chave = titulo.toLowerCase();
    vistos[chave] = (vistos[chave] || 0) + 1;
    if (vistos[chave] > 1) titulo = `${titulo.slice(0, limite - 2)} ${vistos[chave]}`;
    return { ...o, titulo };
  });
}

/** Até 3 botões de resposta rápida (título com até 20 caracteres, id com até 256, corpo com até 1024). */
export function corpoDeBotoes(para: string, texto: string, opcoes: OpcaoDeResposta[], rodape?: string): CorpoDaMeta {
  const buttons = titulosUnicos(opcoes.slice(0, 3), 20).map((o) => ({ type: "reply", reply: { id: String(o.id).slice(0, 256), title: o.titulo } }));
  return {
    ...base(para),
    type: "interactive",
    interactive: { type: "button", body: { text: String(texto).slice(0, 1024) }, ...(rodape ? { footer: { text: rodape.slice(0, 60) } } : {}), action: { buttons } },
  };
}

/** Lista com até 10 linhas (título da linha com até 24, id com até 200, botão com até 20, corpo com até 4096). */
export function corpoDeLista(para: string, texto: string, botao: string, opcoes: OpcaoDeResposta[], secao = "Opções"): CorpoDaMeta {
  const rows = titulosUnicos(opcoes.slice(0, 10), 24).map((o) => ({ id: String(o.id).slice(0, 200), title: o.titulo, ...(o.descricao ? { description: o.descricao.slice(0, 72) } : {}) }));
  return {
    ...base(para),
    type: "interactive",
    interactive: { type: "list", body: { text: String(texto).slice(0, 4096) }, action: { button: (botao || "Escolher").slice(0, 20), sections: [{ title: secao.slice(0, 24), rows }] } },
  };
}

/** Até 3 opções viram botões; de 4 a 10 viram lista. */
export function corpoInterativo(para: string, texto: string, opcoes: OpcaoDeResposta[], botaoDaLista = "Escolher"): CorpoDaMeta {
  return opcoes.length <= 3 ? corpoDeBotoes(para, texto, opcoes) : corpoDeLista(para, texto, botaoDaLista, opcoes);
}

export function enderecoDasMensagens(phoneId: string, versao = VERSAO_DA_GRAPH_DO_WHATSAPP): string {
  const v = /^v[0-9]{1,3}\.[0-9]$/.test(versao) ? versao : VERSAO_DA_GRAPH_DO_WHATSAPP;
  if (!/^[0-9]{5,25}$/.test(phoneId)) throw new Error("numero do WhatsApp invalido");
  return `https://graph.facebook.com/${v}/${phoneId}/messages`;
}

/**
 * O que de fato vai para a Meta: sem as chaves internas (as que começam com "_") e respeitando a janela.
 * Fora da janela só sai template: se o corpo não é template, usa a reserva (`_reserva`, um template) ou
 * devolve nulo (não pode sair).
 */
export function corpoParaAMeta(corpo: CorpoDaMeta, naJanela: boolean): CorpoDaMeta | null {
  let c = corpo;
  if (c.type !== "template" && !naJanela) {
    const reserva = c._reserva as CorpoDaMeta | undefined;
    if (!reserva || typeof reserva !== "object" || reserva.type !== "template") return null;
    c = reserva;
  }
  const limpo: CorpoDaMeta = {};
  Object.keys(c).forEach((k) => {
    if (k.charAt(0) !== "_") limpo[k] = c[k];
  });
  return limpo;
}

export type ResultadoDoEnvio = { ok: true; id: string | null } | { ok: false; definitivo: boolean; erro: string };

/** Erros da Cloud API que passam sozinhos (limite de ritmo, serviço fora do ar): vale tentar de novo. */
const CODIGOS_PASSAGEIROS = [1, 2, 4, 17, 341, 80007, 130429, 131000, 131016, 131048, 131056, 133004, 133010];

/** Lê a resposta da Cloud API: enviado, tentar de novo ou erro que precisa de gente. Nunca devolve o token. */
export function lerRespostaDoWhatsapp(status: number, corpo: unknown, token = ""): ResultadoDoEnvio {
  const c = (corpo && typeof corpo === "object" ? corpo : {}) as Record<string, unknown>;
  if (status >= 200 && status < 300 && !c.error) {
    const lista = Array.isArray(c.messages) ? (c.messages as Array<Record<string, unknown>>) : [];
    return { ok: true, id: lista[0] && typeof lista[0].id === "string" ? (lista[0].id as string).slice(0, 200) : null };
  }
  const e = (c.error && typeof c.error === "object" ? c.error : {}) as Record<string, unknown>;
  const codigo = Number(e.code);
  const detalhe = e.error_data && typeof e.error_data === "object" ? String((e.error_data as Record<string, unknown>).details || "") : "";
  const mensagem = semToken(`${e.message || `A Meta respondeu ${status}.`}${detalhe ? ` ${detalhe}` : ""}${isFinite(codigo) ? ` (código ${codigo})` : ""}`, token);
  if (status === 401 || codigo === 190 || codigo === 10 || (codigo >= 200 && codigo < 300)) return { ok: false, definitivo: true, erro: semToken(`Token do WhatsApp recusado. ${mensagem}`, token) };
  const passageiro = status === 429 || status >= 500 || CODIGOS_PASSAGEIROS.indexOf(codigo) >= 0;
  return { ok: false, definitivo: !passageiro, erro: mensagem };
}

// ---------------------------------------------------------------------------
// O que chega pelo webhook
// ---------------------------------------------------------------------------
export interface MensagemRecebida {
  id: string;
  de: string;
  /** Quando o lead mandou (ISO), se a Meta informou. */
  quando: string | null;
  tipo: "texto" | "botao" | "lista" | "outro";
  texto: string;
  /** O id do botão ou da linha (ou o payload do botão de template). */
  opcao: string | null;
  nome: string | null;
  phone_id: string | null;
}
export interface StatusRecebido {
  id: string;
  status: string;
  para: string;
  erro: string | null;
  phone_id: string | null;
}

function lerUmaMensagem(m: Record<string, unknown>, phoneId: string | null, nomes: Record<string, string>): MensagemRecebida | null {
  const id = typeof m.id === "string" ? m.id.slice(0, 200) : "";
  const de = soDigitos(m.from);
  if (!id || de.length < 10) return null;
  const segundos = Number(m.timestamp);
  const quando = isFinite(segundos) && segundos > 1000000000 ? new Date(segundos * 1000).toISOString() : null;
  const pronta = (tipo: MensagemRecebida["tipo"], texto: unknown, opcao: unknown): MensagemRecebida => ({
    id, de, quando, tipo, texto: String(texto === null || texto === undefined ? "" : texto).slice(0, 4000),
    opcao: typeof opcao === "string" && opcao ? opcao.slice(0, 256) : null, nome: nomes[de] || null, phone_id: phoneId,
  });
  const objeto = (v: unknown) => (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (m.type === "text") return pronta("texto", objeto(m.text).body, null);
  if (m.type === "interactive") {
    const i = objeto(m.interactive);
    if (i.type === "button_reply") return pronta("botao", objeto(i.button_reply).title, objeto(i.button_reply).id);
    if (i.type === "list_reply") return pronta("lista", objeto(i.list_reply).title, objeto(i.list_reply).id);
    return pronta("outro", "", null);
  }
  // Botão de resposta rápida de um template: vem como "button", com o payload que mandamos (ou o texto do botão).
  if (m.type === "button") return pronta("botao", objeto(m.button).text, objeto(m.button).payload);
  return pronta("outro", "", null);
}

/**
 * Lê o que o webhook entregou. Aceita o corpo inteiro, a lista de `entry`, de `changes`, de `value`
 * ou as mensagens soltas: devolve as mensagens e os status, sem repetir.
 */
export function lerEntradas(entradas: unknown): { mensagens: MensagemRecebida[]; status: StatusRecebido[] } {
  const mensagens: MensagemRecebida[] = [];
  const status: StatusRecebido[] = [];
  const vistos: Record<string, boolean> = {};
  const visitar = (x: unknown, nivel: number) => {
    if (nivel > 6 || !x) return;
    if (Array.isArray(x)) {
      x.slice(0, 200).forEach((item) => visitar(item, nivel + 1));
      return;
    }
    if (typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    if (Array.isArray(o.entry)) return visitar(o.entry, nivel + 1);
    if (Array.isArray(o.changes)) return visitar(o.changes, nivel + 1);
    if (o.value && typeof o.value === "object" && (o.field === undefined || o.field === "messages")) return visitar(o.value, nivel + 1);
    if (Array.isArray(o.messages) || Array.isArray(o.statuses)) {
      const meta = (o.metadata && typeof o.metadata === "object" ? o.metadata : {}) as Record<string, unknown>;
      const phoneId = soDigitos(meta.phone_number_id) || null;
      const nomes: Record<string, string> = {};
      (Array.isArray(o.contacts) ? (o.contacts as Array<Record<string, unknown>>) : []).forEach((c) => {
        const perfil = (c && c.profile && typeof c.profile === "object" ? c.profile : {}) as Record<string, unknown>;
        if (c && c.wa_id && perfil.name) nomes[soDigitos(c.wa_id)] = String(perfil.name).slice(0, 120);
      });
      (Array.isArray(o.messages) ? (o.messages as unknown[]) : []).forEach((bruta) => {
        const m = bruta && typeof bruta === "object" ? lerUmaMensagem(bruta as Record<string, unknown>, phoneId, nomes) : null;
        if (m && !vistos[m.id]) {
          vistos[m.id] = true;
          mensagens.push(m);
        }
      });
      (Array.isArray(o.statuses) ? (o.statuses as Array<Record<string, unknown>>) : []).forEach((s) => {
        if (!s || typeof s.id !== "string" || typeof s.status !== "string") return;
        const erros = Array.isArray(s.errors) ? (s.errors as Array<Record<string, unknown>>) : [];
        const e = erros[0] || null;
        status.push({
          id: s.id.slice(0, 200), status: s.status.slice(0, 20), para: soDigitos(s.recipient_id), phone_id: phoneId,
          erro: e ? semToken(`${e.title || e.message || "Falhou."}${e.code ? ` (código ${e.code})` : ""}`) : null,
        });
      });
      return;
    }
    if (typeof o.from === "string" && typeof o.id === "string") {
      const m = lerUmaMensagem(o, null, {});
      if (m && !vistos[m.id]) {
        vistos[m.id] = true;
        mensagens.push(m);
      }
    }
  };
  visitar(entradas, 0);
  return { mensagens, status };
}

// ---------------------------------------------------------------------------
// Perguntas e casamento de texto livre
// ---------------------------------------------------------------------------
export interface OpcaoDaPergunta extends OpcaoDeResposta {
  /** O que entra nas respostas (chave da opção ou número representativo da faixa). */
  valor: string | number;
  /** Só nas faixas: o teto desta faixa (a última não tem). */
  ate?: number;
}
export interface Pergunta {
  campo: string;
  texto: string;
  tipo: "opcao" | "faixa";
  dinheiro: boolean;
  opcoes: OpcaoDaPergunta[];
}

const ROTULOS: Record<string, string> = {
  sim: "Sim", nao: "Não", imovel: "Imóvel", carro: "Carro", moto: "Moto", pesados: "Pesados", servicos: "Serviços", outros: "Outros",
  menos_de_3_meses: "Menos de 3 meses", de_3_a_12_meses: "De 3 a 12 meses", mais_de_12_meses: "Mais de 12 meses",
  agora: "Agora", este_mes: "Este mês", sem_pressa: "Sem pressa",
};
const PALAVRAS: Record<string, string[]> = {
  sim: ["sim", "s", "tenho", "claro", "isso", "positivo", "com certeza", "sou", "sou eu", "yes"],
  nao: ["nao", "n", "nunca", "negativo", "nenhum", "nada", "nao tenho", "ainda nao"],
  imovel: ["imovel", "casa", "apartamento", "apto", "terreno", "sala comercial", "imoveis"],
  carro: ["carro", "automovel", "veiculo", "suv", "carros"],
  moto: ["moto", "motocicleta", "motos"],
  pesados: ["pesado", "pesados", "caminhao", "trator", "onibus", "carreta", "maquina"],
  servicos: ["servico", "servicos", "reforma", "viagem", "cirurgia", "festa", "estudo"],
  outros: ["outro", "outros", "outra coisa"],
  agora: ["agora", "ja", "hoje", "urgente", "imediato"],
  este_mes: ["este mes", "esse mes", "mes que vem", "em breve"],
  sem_pressa: ["sem pressa", "nao tenho pressa", "depois", "mais pra frente", "ano que vem"],
};
const TEXTOS: Record<string, string> = {
  bem: "Qual bem você quer conquistar?",
  valor_carta: "Qual é o valor aproximado do bem que você quer?",
  valor: "Qual é o valor aproximado do que você procura?",
  parcela: "Quanto cabe no seu bolso por mês de parcela?",
  lance: "Você tem algum valor para dar de lance ou de entrada?",
  decisor: "É você quem decide a compra?",
  renda: "Qual é a sua renda mensal aproximada?",
  capacidade: "Quanto você consegue pagar por mês com tranquilidade?",
};
const FAIXAS_PADRAO: Record<string, Array<{ ate?: number }>> = {
  renda: [{ ate: 3000 }, { ate: 6000 }, { ate: 10000 }, {}],
  capacidade: [{ ate: 500 }, { ate: 1000 }, { ate: 2000 }, {}],
};
const E_DINHEIRO = /valor|parcela|renda|capacidade|preco|orcamento|entrada|lance|investimento|credito/;

const numeroCurto = (n: number): string => {
  const t = (Math.round(n * 10) / 10).toFixed(1).replace(".", ",");
  return t.replace(/,0$/, "");
};
/** R$ 300, R$ 1,5 mil, R$ 2 mi: curto para caber no botão (20 caracteres). */
export function dinheiroCurto(n: number): string {
  if (!isFinite(n)) return "";
  if (Math.abs(n) < 1000) return `R$ ${Math.round(n)}`;
  if (Math.abs(n) < 1000000) return `R$ ${numeroCurto(n / 1000)} mil`;
  return `R$ ${numeroCurto(n / 1000000)} mi`;
}
const rotuloDaChave = (chave: string): string => {
  if (ROTULOS[chave]) return ROTULOS[chave];
  const t = chave.replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : chave;
};

function opcoesDeFaixa(campo: string, faixas: Array<{ ate?: number }>, dinheiro: boolean): OpcaoDaPergunta[] {
  const f = (n: number) => (dinheiro ? dinheiroCurto(n) : String(n));
  let anterior: number | null = null;
  const saida: OpcaoDaPergunta[] = [];
  faixas.slice(0, 10).forEach((x) => {
    const ate = typeof x.ate === "number" && isFinite(x.ate) ? x.ate : undefined;
    let titulo: string;
    let valor: number;
    if (ate !== undefined) {
      titulo = anterior === null ? `Até ${f(ate)}` : `${f(anterior)} a ${f(ate).replace("R$ ", "")}`;
      valor = ate;
    } else {
      titulo = anterior === null ? "Qualquer valor" : `Acima de ${f(anterior)}`;
      valor = anterior === null ? 0 : Math.round(anterior * 1.5);
    }
    saida.push({ id: `r:${campo}:${valor}`, titulo, valor, ...(ate !== undefined ? { ate } : {}) });
    if (ate !== undefined) anterior = ate;
  });
  return saida;
}

/** Monta a pergunta de um campo: dos critérios da empresa ou, para renda e capacidade, das faixas padrão. */
export function montarPergunta(campo: string, regras: RegrasDePontuacao): Pergunta | null {
  const criterio = regras.criterios.filter((c) => c.campo === campo)[0] || (campo === "capacidade" ? regras.criterios.filter((c) => c.campo === "parcela" && c.tipo === "faixa")[0] : undefined);
  if (criterio && criterio.tipo === "opcao" && criterio.campo === campo) {
    const opcoes = Object.keys(criterio.pontos).slice(0, 10).map((k) => ({ id: `r:${campo}:${k}`, titulo: rotuloDaChave(k), valor: k }));
    const prazoDeUso = campo === "prazo" && Object.keys(criterio.pontos).some((k) => /_mes/.test(k));
    return { campo, tipo: "opcao", dinheiro: false, texto: prazoDeUso ? "Em quanto tempo você pretende usar o bem?" : TEXTOS[campo] || `${criterio.rotulo}?`, opcoes };
  }
  const faixas = criterio && criterio.tipo === "faixa" ? criterio.faixas : FAIXAS_PADRAO[campo];
  if (!faixas || !faixas.length) return null;
  const dinheiro = E_DINHEIRO.test(campo);
  return { campo, tipo: "faixa", dinheiro, texto: TEXTOS[campo] || `${criterio ? criterio.rotulo : rotuloDaChave(campo)}?`, opcoes: opcoesDeFaixa(campo, faixas, dinheiro) };
}

/**
 * Quais perguntas o robô faz, na ordem: o que falta para a pontuação e, sempre, renda e capacidade de
 * pagamento (a Meta não deixa pôr no formulário). No máximo 4. A capacidade responde também a "parcela".
 */
export function perguntasDoRobo(respostas: Record<string, unknown>, regras: RegrasDePontuacao): string[] {
  const r = respostas || {};
  const extras = ["renda", "capacidade"].filter((c) => vazio(r[c]));
  const faltam = faltamResponder(r, regras).filter((c) => c !== "renda" && c !== "capacidade" && !(c === "parcela" && extras.indexOf("capacidade") >= 0));
  const vagas = Math.max(0, MAXIMO_DE_PERGUNTAS - extras.length);
  return faltam.slice(0, vagas).concat(extras).filter((c) => !!montarPergunta(c, regras));
}

/** Lê um valor em dinheiro ou número de um texto: "3 mil", "R$ 3.500,00", "2,5k", "1 milhão". */
export function lerValor(texto: unknown): number | null {
  const m = /(\d{1,3}(?:\.\d{3})+|\d+)(?:[.,](\d{1,2})(?!\d))?\s*(milhoes|milhao|mil|mi\b|k\b)?/.exec(semAcento(texto));
  if (!m) return null;
  let n = Number(m[1].replace(/\./g, "")) + (m[2] ? Number(`0.${m[2]}`) : 0);
  const unidade = m[3] || "";
  if (unidade.indexOf("milh") === 0 || unidade === "mi") n *= 1000000;
  else if (unidade === "mil" || unidade === "k") n *= 1000;
  return isFinite(n) ? Math.round(n) : null;
}

/** "6 meses", "1 ano e meio", "2 anos" em meses. */
function lerMeses(t: string): number | null {
  const m = /(\d+)\s*(mes|meses|ano|anos|semana|semanas|dia|dias)/.exec(t);
  if (!m) return /\bum ano\b/.test(t) ? 12 : /\bum mes\b/.test(t) ? 1 : null;
  const n = Number(m[1]);
  const u = m[2];
  return u.indexOf("ano") === 0 ? n * 12 : u.indexOf("mes") === 0 ? n : u.indexOf("semana") === 0 ? n / 4 : n / 30;
}

export interface RespostaCasada {
  valor: string | number;
  titulo: string;
}

/**
 * Casa um texto livre com as opções da pergunta, por palavras-chave e número. Nulo quando não deu.
 *
 * PONTO DE EXTENSÃO (classificação por IA, ainda não implementada): quando isto devolve nulo, quem chama
 * (produto-meta/modulos/whatsapp.ts, função classificarComIA) pode pedir a um classificador a opção certa
 * e entregar o id dela em `evento.opcao`. A máquina de estados não muda.
 */
export function casarTextoLivre(texto: unknown, pergunta: Pergunta): RespostaCasada | null {
  const t = semAcento(texto).replace(/[^a-z0-9$,. ]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const pronta = (o: OpcaoDaPergunta): RespostaCasada => ({ valor: o.valor, titulo: o.titulo });
  // 1. O título do botão digitado (ou devolvido pelo botão de um template sem payload).
  const igual = pergunta.opcoes.filter((o) => semAcento(o.titulo) === t)[0];
  if (igual) return pronta(igual);
  // 2. O número da opção: "2", "opção 2".
  const ordem = /^(?:opcao |numero |a |o )?(\d)$/.exec(t);
  if (ordem && Number(ordem[1]) >= 1 && Number(ordem[1]) <= pergunta.opcoes.length) return pronta(pergunta.opcoes[Number(ordem[1]) - 1]);
  // 3. Faixa: um valor cai na faixa certa e entra como foi dito.
  if (pergunta.tipo === "faixa") {
    const n = lerValor(t);
    if (n === null) return null;
    const faixa = pergunta.opcoes.filter((o) => o.ate === undefined || n <= o.ate)[0];
    return faixa ? { valor: n, titulo: pergunta.dinheiro ? dinheiroCurto(n) : String(n) } : null;
  }
  // 4. Prazo em meses: "uns 6 meses", "1 ano".
  const meses = lerMeses(t);
  if (meses !== null) {
    const porPrazo = pergunta.opcoes.filter((o) => {
      const k = String(o.valor);
      let m = /^menos_de_(\d+)_mes/.exec(k);
      if (m) return meses < Number(m[1]);
      m = /^de_(\d+)_a_(\d+)_mes/.exec(k);
      if (m) return meses >= Number(m[1]) && meses <= Number(m[2]);
      m = /^mais_de_(\d+)_mes/.exec(k);
      return m ? meses > Number(m[1]) : false;
    });
    if (porPrazo.length === 1) return pronta(porPrazo[0]);
  }
  // 5. Palavras-chave de cada opção.
  const cercado = ` ${t.replace(/[$,.]/g, " ").replace(/\s+/g, " ").trim()} `;
  const tem = (palavra: string) => cercado.indexOf(` ${palavra} `) >= 0;
  const achadas = pergunta.opcoes.filter((o) => {
    const k = String(o.valor);
    const palavras = (PALAVRAS[k] || []).concat([k.replace(/_/g, " "), semAcento(o.titulo)]);
    return palavras.some(tem);
  });
  if (achadas.length === 1) return pronta(achadas[0]);
  // "não tenho" bate em "sim" (tenho) e em "não": a negação decide.
  const negou = achadas.filter((o) => String(o.valor) === "nao")[0];
  if (achadas.length > 1 && negou && (tem("nao") || tem("n") || tem("nunca") || tem("nem"))) return pronta(negou);
  return null;
}

/** O lead pediu para parar de receber mensagens? */
export function pediuParaParar(texto: unknown, opcao?: string | null): boolean {
  if (opcao && semAcento(opcao) === "parar") return true;
  const t = semAcento(texto).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (/^(parar|pare|para|sair|stop|cancelar|cancela|descadastrar|remover|nao quero|parar mensagens|sair da lista)$/.test(t)) return true;
  return /\b(nao quero mais|nao quero receber|nao quero mensagem|nao quero contato|nao tenho interesse|nao me mande|nao mande mais|nao envie mais|pare de|parem de|para de mandar|me tira|me tire|me remova|quero sair|descadastr)/.test(t);
}

// ---------------------------------------------------------------------------
// O vendedor: botões, resumo e link
// ---------------------------------------------------------------------------
export type AcaoDoVendedor = "atendi" | "simulacao" | "vendeu" | "sem_resposta";
export const ACOES_DO_VENDEDOR: Array<{ acao: AcaoDoVendedor; titulo: string }> = [
  { acao: "atendi", titulo: "Atendi" },
  { acao: "simulacao", titulo: "Simulação feita" },
  { acao: "vendeu", titulo: "Vendeu" },
  { acao: "sem_resposta", titulo: "Não respondeu" },
];
export const idDoBotaoDoVendedor = (leadId: string, acao: AcaoDoVendedor): string => `crm:${leadId}:${acao}`;

/** O toque do vendedor chega como mensagem: `crm:<lead_id>:<acao>`. */
export function lerBotaoDoVendedor(opcao: unknown): { lead_id: string; acao: AcaoDoVendedor } | null {
  const m = /^crm:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(atendi|simulacao|vendeu|sem_resposta)$/.exec(String(opcao || "").trim().toLowerCase());
  return m ? { lead_id: m[1], acao: m[2] as AcaoDoVendedor } : null;
}

const ETAPAS: Record<string, string> = { novo: "Novo", contato: "Em contato", diagnostico: "Diagnóstico", proposta: "Proposta", negociacao: "Negociação", ganho: "Ganho", perdido: "Perdido" };

/** A confirmação curta que o vendedor recebe depois de tocar no botão (resultado de crm_lead_avancar). */
export function confirmacaoAoVendedor(resultado: unknown, nomeDoLead: string, acao: AcaoDoVendedor): string {
  const r = (resultado && typeof resultado === "object" ? resultado : {}) as Record<string, unknown>;
  const nome = String(nomeDoLead || "o lead").trim().slice(0, 60);
  if (r.ok !== true) {
    if (r.motivo === "nao_e_o_responsavel") return `Não anotei: ${nome} não está com você no CRM.`;
    if (r.motivo === "inexistente") return "Não anotei: esse negócio não existe mais no CRM.";
    return "Não consegui anotar agora. Marque direto no CRM, por favor.";
  }
  if (acao === "sem_resposta") return `Anotado: ${nome} não respondeu. O negócio continua com você.`;
  const etapa = ETAPAS[String(r.etapa)] || String(r.etapa || "");
  if (r.sem_mudanca === true) return `Anotado. ${nome} já estava em ${etapa}.`;
  if (acao === "vendeu") return `Parabéns! Venda de ${nome} marcada como ganha no CRM.`;
  return `Anotado: ${nome} agora está em ${etapa}.`;
}

export function linkDoWhatsapp(telefone: unknown, frase: string): string {
  const numero = telefoneParaEnvio(telefone) || soDigitos(telefone);
  return `https://wa.me/${numero}${frase ? `?text=${encodeURIComponent(frase)}` : ""}`;
}

export interface DadosDoLead {
  id: string;
  nome: string;
  telefone: string | null;
  nota?: number | null;
  faixa?: Faixa | null;
  campanha?: string | null;
  formulario?: string | null;
  valor_mensal?: number | null;
  valor_avulso?: number | null;
}
export interface DadosDoVendedor {
  nome: string;
  whatsapp: string | null;
  /** O vendedor falou com o número da empresa nas últimas 24 h (pode receber mensagem que não é template). */
  na_janela?: boolean;
}

export interface ResumoParaOVendedor {
  /** O texto completo (mensagem dentro da janela). */
  texto: string;
  /** As 8 variáveis do template do vendedor, na ordem. */
  variaveis: string[];
  link: string;
  frase: string;
}

const FAIXAS: Record<string, string> = { quente: "quente", morno: "morno", frio: "frio" };

/** O rótulo de uma resposta para gente ler (o que o lead escolheu, ou o valor em reais). */
function rotuloDaResposta(campo: string, respostas: Record<string, unknown>, regras: RegrasDePontuacao): string {
  const v = respostas[campo];
  if (vazio(v)) return "";
  const robo = lerRobo(respostas);
  if (robo.rotulos[campo]) return robo.rotulos[campo];
  const criterio = regras.criterios.filter((c) => c.campo === campo)[0];
  if ((criterio && criterio.tipo === "faixa") || (!criterio && E_DINHEIRO.test(campo))) {
    const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
    return isFinite(n) ? (E_DINHEIRO.test(campo) ? dinheiroCurto(n) : String(n)) : String(v).slice(0, 60);
  }
  return rotuloDaChave(String(v === true ? "sim" : v === false ? "nao" : v).slice(0, 60));
}

/** O resumo pronto que o vendedor recebe: nome, bem, valor, parcela, prazo, nota e faixa, campanha e o link. */
export function resumoParaOVendedor(lead: DadosDoLead, vendedor: DadosDoVendedor, empresa: string, respostas: Record<string, unknown>, regras: RegrasDePontuacao): ResumoParaOVendedor {
  const r = respostas || {};
  const rot = (campo: string) => rotuloDaResposta(campo, r, regras);
  const bem = rot("bem");
  const valor = rot("valor_carta") || rot("valor") || (lead.valor_avulso ? dinheiroCurto(Number(lead.valor_avulso)) : "");
  const parcela = rot("parcela") || rot("capacidade") || (lead.valor_mensal ? dinheiroCurto(Number(lead.valor_mensal)) : "");
  const prazo = rot("prazo");
  const nota = `${typeof lead.nota === "number" ? lead.nota : "sem nota"}${lead.faixa && FAIXAS[lead.faixa] ? ` (${FAIXAS[lead.faixa]})` : ""}`;
  const campanha = String(lead.campanha || lead.formulario || "").trim().slice(0, 80);
  const frase = `Olá, ${primeiroNome(lead.nome)}! Aqui é ${primeiroNome(vendedor.nome)}, da ${String(empresa || "nossa equipe").trim().slice(0, 60)}. Vi seu interesse${bem ? ` em ${bem.toLowerCase()}` : ""} e vou te ajudar. Podemos falar agora?`;
  const link = linkDoWhatsapp(lead.telefone, frase);
  const linhas = [`*Lead para você: ${String(lead.nome || "").trim().slice(0, 80)}*`, `Nota: ${nota}`];
  if (bem) linhas.push(`Bem: ${bem}`);
  if (valor) linhas.push(`Valor: ${valor}`);
  if (parcela) linhas.push(`Parcela: ${parcela}`);
  if (prazo) linhas.push(`Prazo: ${prazo}`);
  const usados = ["bem", "valor_carta", "valor", "parcela", "prazo", "renda", "capacidade"];
  regras.criterios.forEach((c) => {
    if (usados.indexOf(c.campo) < 0 && rot(c.campo)) linhas.push(`${c.rotulo}: ${rot(c.campo)}`);
  });
  if (rot("renda")) linhas.push(`Renda mensal: ${rot("renda")}`);
  if (rot("capacidade") && rot("capacidade") !== parcela) linhas.push(`Consegue pagar por mês: ${rot("capacidade")}`);
  if (campanha) linhas.push(`Campanha: ${campanha}`);
  linhas.push("", `Chamar agora: ${link}`, "", "Depois marque aqui o que aconteceu.");
  return { texto: linhas.join("\n"), variaveis: [lead.nome, bem, valor, parcela, prazo, nota, campanha, link].map(limparVariavel), link, frase };
}

// ---------------------------------------------------------------------------
// A máquina de estados da conversa
// ---------------------------------------------------------------------------
export type Etapa = "inicio" | "perguntando" | "qualificado" | "passado" | "nutricao" | "encerrado";

/** O espelho de crm_whats_conversas. O que o robô precisa lembrar a mais mora em `respostas._robo`. */
export interface EstadoDaConversa {
  etapa: Etapa;
  pergunta: string | null;
  respostas: Record<string, unknown>;
  janela_ate: string | null;
  ultima_do_lead_em: string | null;
  followups: number;
  proximo_followup_em: string | null;
  vendedor_avisado_em: string | null;
}

interface MemoriaDoRobo {
  /** Quando a conversa começou (base dos prazos enquanto o lead não respondeu). */
  inicio: string | null;
  /** As perguntas desta conversa, na ordem (no máximo 4). */
  fila: string[];
  /** Quantas vezes a pergunta atual não foi entendida. */
  tentativas: number;
  /** O último envio foi um follow-up: a próxima resposta pode ser só um "quero continuar". */
  retomar: boolean;
  /** Como o lead respondeu cada pergunta, para gente ler. */
  rotulos: Record<string, string>;
  /** Já avisou o lead de que quem atende agora é o consultor. */
  redirecionou: boolean;
  /** Pediu para parar. */
  parou: boolean;
  /** Respondeu só uma parte das perguntas e sumiu. */
  incompleto: boolean;
}

function lerRobo(respostas: Record<string, unknown> | null | undefined): MemoriaDoRobo {
  const b = (respostas && respostas._robo && typeof respostas._robo === "object" ? respostas._robo : {}) as Record<string, unknown>;
  const rotulos: Record<string, string> = {};
  if (b.rotulos && typeof b.rotulos === "object") Object.keys(b.rotulos as Record<string, unknown>).slice(0, 20).forEach((k) => (rotulos[k] = String((b.rotulos as Record<string, unknown>)[k]).slice(0, 60)));
  return {
    inicio: typeof b.inicio === "string" ? b.inicio : null,
    fila: Array.isArray(b.fila) ? (b.fila as unknown[]).map(String).slice(0, MAXIMO_DE_PERGUNTAS) : [],
    tentativas: typeof b.tentativas === "number" ? b.tentativas : 0,
    retomar: b.retomar === true, rotulos, redirecionou: b.redirecionou === true, parou: b.parou === true, incompleto: b.incompleto === true,
  };
}

/** As respostas sem a memória do robô (o que vai para a pontuação). */
export function respostasLimpas(respostas: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const limpo: Record<string, unknown> = {};
  Object.keys(respostas || {}).forEach((k) => {
    if (k.charAt(0) !== "_") limpo[k] = (respostas as Record<string, unknown>)[k];
  });
  return limpo;
}

export function estadoInicial(respostas: Record<string, unknown> = {}, agora?: string): EstadoDaConversa {
  return {
    etapa: "inicio", pergunta: null, respostas: { ...respostasLimpas(respostas), _robo: { inicio: agora || null, fila: [], tentativas: 0, rotulos: {} } },
    janela_ate: null, ultima_do_lead_em: null, followups: 0, proximo_followup_em: null, vendedor_avisado_em: null,
  };
}

export type Evento =
  /** O lead acabou de entrar pelo formulário. */
  | { tipo: "lead_criado"; faixa: Faixa; nutricao?: boolean }
  /** O lead mandou uma mensagem (texto, botão ou lista). */
  | { tipo: "mensagem"; texto?: string; opcao?: string | null }
  /** A rotina viu que o prazo do follow-up venceu. */
  | { tipo: "tempo" }
  /** crm_lead_requalificar respondeu: a faixa nova e quem atende (ou a fila). */
  | { tipo: "requalificado"; faixa: Faixa; nota?: number | null; vendedor: DadosDoVendedor | null }
  /** crm_fila_distribuir deu um vendedor a quem estava na fila. */
  | { tipo: "distribuido"; vendedor: DadosDoVendedor | null };

export interface ConfigDoRobo {
  /** Agora, em ISO. */
  agora: string;
  empresa: string;
  idioma: string;
  /** Nomes dos templates aprovados no WhatsApp da empresa. */
  templates: { lead?: string; vendedor?: string; followup?: string; nutricao?: string };
  /** Depois de quantas horas sem resposta o robô insiste (padrão 24 e 72). */
  followup_horas: number[];
  lead: DadosDoLead;
  vendedor: DadosDoVendedor | null;
}

export interface EnvioDoRobo {
  /** Única por empresa: mandar duas vezes a mesma chave não envia duas vezes. */
  chave: string;
  destino: "lead" | "vendedor";
  para: string;
  /** O corpo da Cloud API. Pode levar `_reserva` (o template que sai se a janela fechar). */
  corpo: CorpoDaMeta;
  /** O que foi dito, para aparecer na conversa do negócio. */
  texto: string;
}

export interface Passo {
  estado: EstadoDaConversa;
  envios: EnvioDoRobo[];
  /** Chamar crm_lead_requalificar com isto e devolver o resultado no evento "requalificado". */
  requalificar?: { nota: number; faixa: Faixa; motivos: string[]; campos: Record<string, unknown> };
  avisarVendedor?: boolean;
  encerrar?: boolean;
  /** O lead pediu para parar: marcar no negócio e nunca mais mandar. */
  parar?: boolean;
}

const HORAS_PADRAO = [24, 72];
const horasDoFollowup = (config: ConfigDoRobo): number[] => {
  const lista = (Array.isArray(config.followup_horas) ? config.followup_horas : HORAS_PADRAO).map(Number).filter((h) => isFinite(h) && h >= 1 && h <= 240).slice(0, 3);
  return lista.sort((a, b) => a - b);
};
export const naJanela = (estado: EstadoDaConversa, agora: string): boolean => !!estado.janela_ate && new Date(estado.janela_ate).getTime() > new Date(agora).getTime();

function interesseDoLead(respostas: Record<string, unknown>, regras: RegrasDePontuacao): string {
  const bem = rotuloDaResposta("bem", respostas, regras);
  return bem ? bem.toLowerCase() : "nosso atendimento";
}

function envioDaPergunta(p: Pergunta, config: ConfigDoRobo, para: string, sufixo: string, prefixo = ""): EnvioDoRobo {
  const texto = `${prefixo}${p.texto}`;
  return {
    chave: `lead:${config.lead.id}:p:${p.campo}:${sufixo}`, destino: "lead", para,
    corpo: corpoInterativo(para, texto, p.opcoes),
    texto: `${texto} [${p.opcoes.map((o) => o.titulo).join(" | ")}]`,
  };
}

/** O aviso ao vendedor: mensagem com a lista de ações dentro da janela, template fora dela. */
export function envioAoVendedor(config: ConfigDoRobo, respostas: Record<string, unknown>, regras: RegrasDePontuacao): EnvioDoRobo | null {
  const v = config.vendedor;
  const para = v ? telefoneParaEnvio(v.whatsapp) : null;
  if (!v || !para) return null;
  const resumo = resumoParaOVendedor(config.lead, v, config.empresa, respostas, regras);
  const chave = `vend:${config.lead.id}:aviso`;
  const template = config.templates.vendedor
    ? corpoDeTemplate(para, config.templates.vendedor, config.idioma, resumo.variaveis, ACOES_DO_VENDEDOR.map((a) => idDoBotaoDoVendedor(config.lead.id, a.acao)))
    : null;
  if (v.na_janela) {
    const corpo = corpoDeLista(para, resumo.texto, "Marcar o que houve", ACOES_DO_VENDEDOR.map((a) => ({ id: idDoBotaoDoVendedor(config.lead.id, a.acao), titulo: a.titulo })), "O que aconteceu");
    return { chave, destino: "vendedor", para, corpo: template ? { ...corpo, _reserva: template } : corpo, texto: resumo.texto };
  }
  return template ? { chave, destino: "vendedor", para, corpo: template, texto: resumo.texto } : null;
}

/** O que vai para os campos do negócio depois das perguntas (para o vendedor ler na ficha). */
function camposDoNegocio(respostas: Record<string, unknown>, regras: RegrasDePontuacao): Record<string, unknown> {
  const robo = lerRobo(respostas);
  const campos: Record<string, unknown> = {};
  Object.keys(robo.rotulos).forEach((campo) => {
    const nome = campo === "renda" ? "renda_mensal" : campo === "capacidade" ? "capacidade_de_pagamento" : campo === "bem" ? "tipo_de_bem" : campo;
    campos[nome] = campo === "bem" ? String(respostas.bem) : rotuloDaResposta(campo, respostas, regras);
  });
  return campos;
}

/**
 * A máquina de estados: dado onde a conversa está e o que aconteceu, diz o estado novo e o que enviar.
 * Função pura: não envia, não grava e não lê relógio (o agora vem em `config.agora`).
 */
export function proximoPasso(estadoAtual: EstadoDaConversa | null, evento: Evento, regras: RegrasDePontuacao, config: ConfigDoRobo): Passo {
  const agora = config.agora;
  const base = estadoAtual || estadoInicial({}, agora);
  const robo = lerRobo(base.respostas);
  const respostas: Record<string, unknown> = respostasLimpas(base.respostas);
  const estado: EstadoDaConversa = { ...base };
  const envios: EnvioDoRobo[] = [];
  const para = telefoneParaEnvio(config.lead.telefone);
  const horas = horasDoFollowup(config);
  const nome = primeiroNome(config.lead.nome);
  const fechar = (extra: Partial<Passo> = {}): Passo => ({ ...extra, estado: { ...estado, respostas: { ...respostas, _robo: robo } }, envios });
  const aoLead = (chave: string, corpo: CorpoDaMeta, texto: string) => {
    if (para) envios.push({ chave: `lead:${config.lead.id}:${chave}`, destino: "lead", para, corpo, texto });
  };
  const textoAoLead = (chave: string, texto: string) => {
    if (para && naJanela(estado, agora)) aoLead(chave, corpoDeTexto(para, texto), texto);
  };
  const proximaPergunta = (): string | null => robo.fila.filter((c) => vazio(respostas[c]) && c !== estado.pergunta)[0] || null;

  /** Acabaram as perguntas: pontua de novo e pede a requalificação. */
  const concluir = (incompleto: boolean): Passo => {
    const r = pontuar(respostas, regras);
    estado.etapa = "qualificado";
    estado.pergunta = null;
    estado.proximo_followup_em = null;
    robo.tentativas = 0;
    robo.retomar = false;
    robo.incompleto = incompleto;
    return fechar({ requalificar: { nota: r.nota, faixa: r.faixa, motivos: r.motivos, campos: camposDoNegocio({ ...respostas, _robo: robo }, regras) } });
  };
  const perguntar = (campo: string, sufixo: string, prefixo = ""): boolean => {
    const p = montarPergunta(campo, regras);
    if (!p || !para) return false;
    estado.etapa = "perguntando";
    estado.pergunta = campo;
    envios.push(envioDaPergunta(p, config, para, sufixo, prefixo));
    return true;
  };
  const seguir = (): Passo => {
    let campo = proximaPergunta();
    estado.pergunta = null;
    robo.tentativas = 0;
    while (campo) {
      if (perguntar(campo, "0")) return fechar();
      respostas[campo] = "";
      robo.fila = robo.fila.filter((c) => c !== campo);
      campo = proximaPergunta();
    }
    return concluir(false);
  };
  /** Passa o lead ao vendedor: avisa o lead (se a janela deixar) e manda o resumo ao vendedor. */
  const passar = (vendedor: DadosDoVendedor): Passo => {
    const contato = telefoneParaEnvio(vendedor.whatsapp);
    textoAoLead("consultor", `Pronto, ${nome}! Quem vai te atender é ${primeiroNome(vendedor.nome)}, da ${config.empresa}. Em instantes ele te chama pelo WhatsApp.${contato ? ` Se preferir, fale direto com ele: https://wa.me/${contato}` : ""}`);
    const aviso = envioAoVendedor({ ...config, vendedor }, { ...respostas, _robo: robo }, regras);
    if (aviso) {
      envios.push(aviso);
      estado.vendedor_avisado_em = agora;
    }
    estado.etapa = "passado";
    estado.pergunta = null;
    estado.proximo_followup_em = null;
    return fechar({ avisarVendedor: !!aviso });
  };

  if (evento.tipo === "lead_criado") {
    robo.inicio = agora;
    if (!para) {
      estado.etapa = "encerrado";
      return fechar({ encerrar: true });
    }
    if (evento.faixa === "frio" || evento.nutricao) {
      estado.etapa = "nutricao";
      if (config.templates.nutricao) aoLead("nutricao", corpoDeTemplate(para, config.templates.nutricao, config.idioma, [nome, config.empresa]), `Template de nutrição (${config.templates.nutricao}).`);
      return fechar();
    }
    estado.etapa = "inicio";
    if (config.templates.lead) {
      const interesse = interesseDoLead(respostas, regras);
      aoLead("boas-vindas", corpoDeTemplate(para, config.templates.lead, config.idioma, [nome, config.empresa, interesse]), `Template de boas-vindas (${config.templates.lead}): olá, ${nome}, aqui é da ${config.empresa}.`);
      estado.proximo_followup_em = maisHoras(agora, horas[0] || ESPERA_FINAL_HORAS);
    }
    return fechar();
  }

  if (evento.tipo === "mensagem") {
    estado.janela_ate = maisHoras(agora, JANELA_HORAS);
    estado.ultima_do_lead_em = agora;
    estado.followups = 0;
    if (robo.parou) return fechar();
    if (pediuParaParar(evento.texto, evento.opcao)) {
      robo.parou = true;
      estado.etapa = "encerrado";
      estado.pergunta = null;
      estado.proximo_followup_em = null;
      textoAoLead("parou", "Tudo certo, não vamos mais te mandar mensagens por aqui. Obrigado pelo seu tempo.");
      return fechar({ encerrar: true, parar: true });
    }
    const retomando = robo.retomar;
    robo.retomar = false;

    if (estado.etapa === "inicio" || estado.etapa === "encerrado") {
      robo.fila = perguntasDoRobo(respostas, regras);
      estado.proximo_followup_em = maisHoras(agora, horas[0] || ESPERA_FINAL_HORAS);
      return seguir();
    }

    if (estado.etapa === "perguntando" && estado.pergunta) {
      estado.proximo_followup_em = maisHoras(agora, horas[0] || ESPERA_FINAL_HORAS);
      const atual = montarPergunta(estado.pergunta, regras);
      if (!atual) return seguir();
      let casada: RespostaCasada | null = null;
      let campo = atual.campo;
      const m = /^r:([a-z0-9_]{1,40}):(.{1,60})$/.exec(String(evento.opcao || ""));
      if (m) {
        // Botão ou linha: vale o id. Pode ser de uma pergunta anterior desta conversa (o lead tocou de novo).
        const dona = m[1] === atual.campo ? atual : robo.fila.indexOf(m[1]) >= 0 ? montarPergunta(m[1], regras) : null;
        const opcao = dona ? dona.opcoes.filter((o) => String(o.valor) === m[2])[0] : undefined;
        if (dona && opcao) {
          casada = { valor: opcao.valor, titulo: opcao.titulo };
          campo = dona.campo;
        }
      }
      if (!casada) casada = casarTextoLivre(evento.texto, atual);
      if (casada) {
        respostas[campo] = casada.valor;
        robo.rotulos[campo] = casada.titulo;
        // A capacidade de pagamento responde também à parcela que cabe no bolso.
        if (campo === "capacidade" && vazio(respostas.parcela) && regras.criterios.some((c) => c.campo === "parcela" && c.tipo === "faixa")) respostas.parcela = casada.valor;
        if (campo !== atual.campo) return fechar();
        return seguir();
      }
      if (retomando) {
        perguntar(atual.campo, `r${Math.floor(new Date(agora).getTime() / 60000)}`, "Que bom te ver de volta! Vamos continuar. ");
        return fechar();
      }
      if (robo.tentativas < 1) {
        robo.tentativas = 1;
        perguntar(atual.campo, "1", "Não consegui entender. Escolha uma das opções, por favor. ");
        return fechar();
      }
      // Segunda vez sem entender: segue para a próxima.
      respostas[atual.campo] = "";
      robo.fila = robo.fila.filter((c) => c !== atual.campo);
      return seguir();
    }

    if ((estado.etapa === "passado" || estado.etapa === "qualificado") && !robo.redirecionou) {
      robo.redirecionou = true;
      const contato = config.vendedor ? telefoneParaEnvio(config.vendedor.whatsapp) : null;
      textoAoLead("redireciona", config.vendedor && estado.etapa === "passado"
        ? `Quem continua seu atendimento é ${primeiroNome(config.vendedor.nome)}, da ${config.empresa}.${contato ? ` Fale com ele por aqui: https://wa.me/${contato}` : " Ele vai te chamar pelo WhatsApp."}`
        : "Recebi sua mensagem. Um consultor vai te chamar pelo WhatsApp assim que estiver disponível.");
    }
    return fechar();
  }

  if (evento.tipo === "requalificado") {
    if (estado.etapa !== "qualificado") return fechar();
    if (evento.faixa === "frio") {
      estado.etapa = "nutricao";
      estado.proximo_followup_em = null;
      textoAoLead("nutricao-texto", `Obrigado pelas respostas, ${nome}! Pelo que você contou, agora ainda não é o melhor momento. Vamos te mandar por aqui conteúdos que ajudam no seu planejamento.`);
      return fechar();
    }
    if (evento.vendedor) return passar(evento.vendedor);
    textoAoLead("aguarde", `Obrigado pelas respostas, ${nome}! Um consultor da ${config.empresa} vai te chamar pelo WhatsApp assim que estiver disponível.`);
    return fechar();
  }

  if (evento.tipo === "distribuido") {
    if (estado.etapa !== "qualificado" || !evento.vendedor) return fechar();
    return passar(evento.vendedor);
  }

  // evento "tempo": o prazo do follow-up venceu.
  if (estado.etapa !== "inicio" && estado.etapa !== "perguntando") {
    estado.proximo_followup_em = null;
    return fechar();
  }
  if (!estado.proximo_followup_em || new Date(estado.proximo_followup_em).getTime() > new Date(agora).getTime()) return fechar();
  const referencia = estado.ultima_do_lead_em || robo.inicio || agora;
  if (para && config.templates.followup && estado.followups < horas.length) {
    const n = estado.followups + 1;
    aoLead(`followup:${n}:${Math.floor(new Date(referencia).getTime() / 3600000)}`, corpoDeTemplate(para, config.templates.followup, config.idioma, [nome, interesseDoLead(respostas, regras)]), `Template de retomada ${n} (${config.templates.followup}).`);
    estado.followups = n;
    robo.retomar = true;
    const proximo = n < horas.length ? maisHoras(referencia, horas[n]) : maisHoras(agora, ESPERA_FINAL_HORAS);
    estado.proximo_followup_em = new Date(proximo).getTime() > new Date(agora).getTime() + 3600000 ? proximo : maisHoras(agora, 1);
    return fechar();
  }
  // Acabaram as tentativas: quem respondeu uma parte é requalificado com o que disse; quem não disse nada, encerra.
  if (estado.etapa === "perguntando" && Object.keys(robo.rotulos).length > 0) return concluir(true);
  estado.etapa = "encerrado";
  estado.pergunta = null;
  estado.proximo_followup_em = null;
  return fechar({ encerrar: true });
}

// ---------------------------------------------------------------------------
// Os templates que a empresa precisa criar e aprovar no WhatsApp dela
// ---------------------------------------------------------------------------
export interface TemplateNecessario {
  /** A chave em crm_integracoes.templates. */
  chave: "lead" | "vendedor" | "followup" | "nutricao";
  titulo: string;
  nome: string;
  categoria: "MARKETING" | "UTILITY";
  idioma: string;
  corpo: string;
  variaveis: Array<{ numero: number; o_que_e: string; exemplo: string }>;
  /** Botões de resposta rápida, nesta ordem. */
  botoes: string[];
  obrigatorio: boolean;
  observacao: string;
}

/** O que a tela mostra para a empresa copiar e criar no Gerenciador do WhatsApp. */
export function templatesNecessarios(): TemplateNecessario[] {
  return [
    {
      chave: "lead", titulo: "Boas-vindas ao lead", nome: "crm_boas_vindas", categoria: "MARKETING", idioma: "pt_BR", obrigatorio: true,
      corpo: "Olá, {{1}}! Aqui é da {{2}}. Recebemos seu interesse em {{3}} e já vamos te atender. Posso te fazer algumas perguntas rápidas para adiantar seu atendimento?",
      variaveis: [
        { numero: 1, o_que_e: "Primeiro nome do lead", exemplo: "João" },
        { numero: 2, o_que_e: "Nome da empresa", exemplo: "HS Consórcios" },
        { numero: 3, o_que_e: "O que o lead procura", exemplo: "imóvel" },
      ],
      botoes: ["Pode perguntar", "Parar mensagens"],
      observacao: "Sai na hora em que o lead quente ou morno entra. Qualquer resposta abre as perguntas; \"Parar mensagens\" encerra para sempre.",
    },
    {
      chave: "vendedor", titulo: "Aviso ao vendedor", nome: "crm_aviso_vendedor", categoria: "UTILITY", idioma: "pt_BR", obrigatorio: true,
      corpo: "Lead novo para você: {{1}}.\nBem: {{2}}\nValor: {{3}}\nParcela: {{4}}\nPrazo: {{5}}\nNota: {{6}}\nCampanha: {{7}}\nChamar agora: {{8}}\nDepois marque abaixo o que aconteceu.",
      variaveis: [
        { numero: 1, o_que_e: "Nome do lead", exemplo: "João da Silva" },
        { numero: 2, o_que_e: "Bem", exemplo: "Imóvel" },
        { numero: 3, o_que_e: "Valor", exemplo: "R$ 300 mil" },
        { numero: 4, o_que_e: "Parcela", exemplo: "R$ 1,8 mil" },
        { numero: 5, o_que_e: "Prazo", exemplo: "De 3 a 12 meses" },
        { numero: 6, o_que_e: "Nota e faixa", exemplo: "82 (quente)" },
        { numero: 7, o_que_e: "Campanha", exemplo: "Imóvel novembro" },
        { numero: 8, o_que_e: "Link para chamar o lead", exemplo: "https://wa.me/5541988887777?text=Ola" },
      ],
      botoes: ACOES_DO_VENDEDOR.map((a) => a.titulo),
      observacao: "Precisa ter exatamente estes 4 botões de resposta rápida, nesta ordem: o toque do vendedor move o negócio no CRM.",
    },
    {
      chave: "followup", titulo: "Retomada (sem resposta)", nome: "crm_retomada", categoria: "MARKETING", idioma: "pt_BR", obrigatorio: false,
      corpo: "Oi, {{1}}! Você ainda quer ajuda com {{2}}? É só responder esta mensagem que eu continuo de onde paramos.",
      variaveis: [
        { numero: 1, o_que_e: "Primeiro nome do lead", exemplo: "João" },
        { numero: 2, o_que_e: "O que o lead procura", exemplo: "imóvel" },
      ],
      botoes: ["Quero continuar", "Parar mensagens"],
      observacao: "Sai depois de cada prazo sem resposta (padrão 24 h e 72 h). Sem este template o robô encerra a conversa no primeiro prazo.",
    },
    {
      chave: "nutricao", titulo: "Nutrição (lead frio)", nome: "crm_nutricao", categoria: "MARKETING", idioma: "pt_BR", obrigatorio: false,
      corpo: "Olá, {{1}}! Aqui é da {{2}}. Obrigado pelo seu interesse. Vamos te mandar por aqui conteúdos que ajudam você a se planejar com calma.",
      variaveis: [
        { numero: 1, o_que_e: "Primeiro nome do lead", exemplo: "João" },
        { numero: 2, o_que_e: "Nome da empresa", exemplo: "HS Consórcios" },
      ],
      botoes: ["Parar mensagens"],
      observacao: "Uma mensagem só, para o lead frio. Sem este template o lead frio não recebe nada.",
    },
  ];
}
