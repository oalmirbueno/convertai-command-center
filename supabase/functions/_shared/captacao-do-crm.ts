/**
 * Captação do CRM da empresa (13/11/2026): as regras do formulário público.
 *
 * Puro: sem Deno, sem npm e sem banco. A função produto-api (que recebe o
 * envio), a página pública, a tela de Captação e os testes importam o mesmo
 * arquivo, então a página recusa o mesmo que o servidor recusa.
 *
 * Sem expressão regular com recursos que o Safari 11 não tem (o piso do produto).
 */
import { lerOrigemDoClique, origemDaBusca, type OrigemDoClique } from "./origem-clique.ts";

export type PedidoDoCampo = "nao" | "opcional" | "obrigatorio";
export const CAMPOS_OPCIONAIS = ["whatsapp", "email", "empresa", "mensagem"] as const;
export type CampoOpcional = (typeof CAMPOS_OPCIONAIS)[number];
export type CamposDoFormulario = Record<CampoOpcional, PedidoDoCampo>;

export interface PerguntaDoFormulario {
  chave: string;
  rotulo: string;
  obrigatoria: boolean;
}

/** O que a página pública recebe do servidor. Nada além disto sai para quem não está logado. */
export interface FormularioPublico {
  titulo: string;
  descricao: string;
  texto_botao: string;
  agradecimento: string;
  campos: CamposDoFormulario;
  perguntas: PerguntaDoFormulario[];
  empresa: { nome: string; cor: string | null; logo: string | null };
  pixel: string | null;
}

/** De onde a pessoa veio: o que estava no link, mais a página e o instante do clique. */
export type OrigemDaCaptacao = OrigemDoClique & {
  gclid?: string;
  pagina?: string;
  referencia?: string;
  fbp?: string;
  clicado_em?: string;
};

export interface EnvioValido {
  nome: string;
  whatsapp: string | null;
  email: string | null;
  empresa: string | null;
  mensagem: string | null;
  respostas: Record<string, string>;
  origem: OrigemDaCaptacao;
}

export type ResultadoDoEnvio = { ok: true; dados: EnvioValido } | { ok: false; campo: string; mensagem: string };

export const LIMITES = { nome: 120, whatsapp: 30, email: 254, empresa: 160, mensagem: 2000, resposta: 300, corpo: 16000 } as const;
/** Nome do campo isca: fica escondido na página; só robô preenche. */
export const CAMPO_ISCA = "website";

const EMAIL = /^[^@\s,()"]+@[^@\s,()"]+\.[^@\s,()"]+$/;
const CHAVE = /^[a-z][a-z0-9_]{1,39}$/;
const GCLID = /^[A-Za-z0-9_.-]{8,200}$/;
const FBP = /^fb\.[0-9]\.[0-9]{5,20}\.[0-9]{1,30}$/;
const INSTANTE = /^[0-9]{10,14}$/;

const limpo = (v: unknown, max: number): string => {
  if (typeof v !== "string" && typeof v !== "number") return "";
  return String(v).replace(/\s+/g, " ").trim().slice(0, max);
};
/** Texto longo: mantém as quebras de linha, tira o excesso. */
const textoLongo = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "");
const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const soDigitos = (v: string) => v.replace(/\D/g, "");

/** Os campos pedidos, sempre com as quatro chaves (a mesma régua de crm_formulario_campos no banco). */
export function lerCampos(bruto: unknown): CamposDoFormulario {
  const o = objeto(bruto);
  const um = (c: CampoOpcional, padrao: PedidoDoCampo): PedidoDoCampo => (o[c] === "nao" || o[c] === "opcional" || o[c] === "obrigatorio" ? (o[c] as PedidoDoCampo) : padrao);
  return { whatsapp: um("whatsapp", "obrigatorio"), email: um("email", "opcional"), empresa: um("empresa", "nao"), mensagem: um("mensagem", "nao") };
}

/** As perguntas próprias bem formadas, no máximo 3, sem chave repetida. */
export function lerPerguntas(bruto: unknown): PerguntaDoFormulario[] {
  const saida: PerguntaDoFormulario[] = [];
  for (const item of Array.isArray(bruto) ? bruto : []) {
    const o = objeto(item);
    const chave = typeof o.chave === "string" ? o.chave : "";
    const rotulo = limpo(o.rotulo, 80);
    if (!CHAVE.test(chave) || rotulo.length < 2 || saida.some((p) => p.chave === chave)) continue;
    saida.push({ chave, rotulo, obrigatoria: o.obrigatoria === true });
    if (saida.length === 3) break;
  }
  return saida;
}

/** A chave de uma pergunta a partir do texto dela: "Qual a sua cidade?" vira "qual_a_sua_cidade". */
export function chaveDaPergunta(rotulo: string): string {
  const base = String(rotulo || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9_]+/, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  return base.length >= 2 ? base : "";
}

/** O formulário como a página pública usa, lido sem confiar no formato. Null quando não é um formulário. */
export function lerFormularioPublico(bruto: unknown): FormularioPublico | null {
  const o = objeto(bruto);
  const f = objeto(o.formulario);
  const e = objeto(o.empresa);
  if (!o.ok || !limpo(f.titulo, 120)) return null;
  const logo = typeof e.logo === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(e.logo) ? e.logo : null;
  const pixel = typeof o.pixel === "string" && /^[0-9]{5,25}$/.test(o.pixel) ? o.pixel : null;
  return {
    titulo: limpo(f.titulo, 120),
    descricao: textoLongo(f.descricao, 600),
    texto_botao: limpo(f.texto_botao, 40) || "Enviar",
    agradecimento: textoLongo(f.agradecimento, 400) || "Recebemos o seu contato.",
    campos: lerCampos(f.campos),
    perguntas: lerPerguntas(f.perguntas),
    empresa: { nome: limpo(e.nome, 80), cor: limpo(e.cor, 12) || null, logo },
    pixel,
  };
}

/** Só a origem e o caminho de um endereço (sem a busca, que pode trazer dado pessoal). */
function enderecoSemBusca(v: unknown, max: number): string {
  const t = typeof v === "string" ? v.trim() : "";
  if (!/^https?:\/\//i.test(t)) return "";
  const semBusca = t.split("#")[0].split("?")[0];
  return semBusca.length <= max && semBusca.indexOf(" ") < 0 && semBusca.indexOf("<") < 0 ? semBusca : "";
}

/** A origem que veio no envio, conferida campo a campo. Nada é inventado: o que não veio fica de fora. */
export function lerOrigemDaCaptacao(bruto: unknown): OrigemDaCaptacao {
  const o = objeto(bruto);
  const saida: OrigemDaCaptacao = { ...(lerOrigemDoClique(o) || {}) };
  const gclid = limpo(o.gclid, 200);
  if (GCLID.test(gclid)) saida.gclid = gclid;
  const fbp = limpo(o.fbp, 100);
  if (FBP.test(fbp)) saida.fbp = fbp;
  const instante = limpo(o.clicado_em, 14);
  if (INSTANTE.test(instante)) saida.clicado_em = instante;
  const pagina = enderecoSemBusca(o.pagina, 300);
  if (pagina) saida.pagina = pagina;
  const referencia = enderecoSemBusca(o.referencia, 200);
  if (referencia) saida.referencia = referencia;
  return saida;
}

/**
 * A origem lida do endereço em que a pessoa abriu o formulário:
 * utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid e gclid.
 * `pagina` e `referencia` entram sem a busca; `agora` marca o instante do clique
 * quando há fbclid (a Meta pede esse instante para montar o fbc).
 */
export function origemDaUrl(endereco: string, extras: { referencia?: string; fbp?: string; agora?: number } = {}): OrigemDaCaptacao {
  const texto = String(endereco || "");
  const semAncora = texto.split("#")[0];
  const i = semAncora.indexOf("?");
  const busca = i >= 0 ? semAncora.slice(i + 1) : "";
  const o: Record<string, unknown> = { ...(origemDaBusca(busca) || {}) };
  for (const par of busca.split("&")) {
    const j = par.indexOf("=");
    if ((j >= 0 ? par.slice(0, j) : par) !== "gclid") continue;
    try {
      o.gclid = decodeURIComponent(par.slice(j + 1).replace(/\+/g, " "));
    } catch {
      /* parâmetro mal codificado: fica de fora */
    }
  }
  o.pagina = semAncora;
  if (extras.referencia) o.referencia = extras.referencia;
  if (extras.fbp) o.fbp = extras.fbp;
  if (o.fbclid && extras.agora) o.clicado_em = String(Math.floor(extras.agora));
  return lerOrigemDaCaptacao(o);
}

/** O link público de um formulário, com os parâmetros de rastreamento quando há. */
export function montarLink(base: string, token: string, utm: Partial<Record<"utm_source" | "utm_medium" | "utm_campaign" | "utm_content" | "utm_term", string>> = {}): string {
  const raiz = String(base || "").replace(/\/+$/, "");
  const partes: string[] = [];
  for (const chave of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const) {
    const v = String(utm[chave] || "").trim();
    // As macros da Meta ({{campaign.id}}) ficam como estão: é a Meta que troca na hora do clique.
    if (v) partes.push(`${chave}=${/^\{\{[a-z_.]+\}\}$/.test(v) ? v : encodeURIComponent(v)}`);
  }
  return `${raiz}/f/${encodeURIComponent(token)}${partes.length ? `?${partes.join("&")}` : ""}`;
}

/** Os parâmetros sugeridos para o campo "Parâmetros de URL" do anúncio na Meta. */
export const UTM_DA_META = { utm_source: "meta", utm_medium: "paid_social", utm_campaign: "{{campaign.id}}", utm_content: "{{ad.id}}" } as const;

/** O campo isca veio preenchido: é robô. A resposta finge que deu certo e nada é gravado. */
export const ehRobo = (corpo: unknown): boolean => limpo(objeto(corpo)[CAMPO_ISCA], 200) !== "";

const NOME_DO_CAMPO: Record<string, string> = { nome: "o seu nome", whatsapp: "o WhatsApp", email: "o e-mail", empresa: "a empresa", mensagem: "a mensagem" };

/**
 * Confere e limpa um envio contra o que o formulário pede. Tamanhos cortados,
 * campo desligado ignorado, e nenhuma chave fora da lista sai daqui (o corpo
 * pode trazer conta_id, etapa, responsável: nada disso é lido).
 */
export function validarEnvio(formulario: Pick<FormularioPublico, "campos" | "perguntas">, corpo: unknown): ResultadoDoEnvio {
  const o = objeto(corpo);
  const campos = lerCampos(formulario.campos);
  const falta = (campo: string, mensagem?: string): ResultadoDoEnvio => ({ ok: false, campo, mensagem: mensagem || `Informe ${NOME_DO_CAMPO[campo] || "este campo"}.` });

  const nome = limpo(o.nome, LIMITES.nome);
  if (nome.length < 2) return falta("nome");

  let whatsapp: string | null = campos.whatsapp === "nao" ? null : limpo(o.whatsapp, LIMITES.whatsapp) || null;
  if (whatsapp) {
    const digitos = soDigitos(whatsapp);
    if (digitos.length < 10 || digitos.length > 15) return falta("whatsapp", "Confira o WhatsApp, com o DDD.");
    if (/[^0-9+() .-]/.test(whatsapp)) whatsapp = digitos;
  } else if (campos.whatsapp === "obrigatorio") return falta("whatsapp");

  const email = campos.email === "nao" ? null : limpo(o.email, LIMITES.email).toLowerCase() || null;
  if (email && !EMAIL.test(email)) return falta("email", "Confira o e-mail.");
  if (!email && campos.email === "obrigatorio") return falta("email");

  const empresa = campos.empresa === "nao" ? null : limpo(o.empresa, LIMITES.empresa) || null;
  if (!empresa && campos.empresa === "obrigatorio") return falta("empresa");

  const mensagem = campos.mensagem === "nao" ? null : textoLongo(o.mensagem, LIMITES.mensagem) || null;
  if (!mensagem && campos.mensagem === "obrigatorio") return falta("mensagem");

  const vindas = objeto(o.respostas);
  const respostas: Record<string, string> = {};
  for (const p of lerPerguntas(formulario.perguntas)) {
    const r = limpo(vindas[p.chave], LIMITES.resposta);
    if (!r && p.obrigatoria) return falta(p.chave, `Responda: ${p.rotulo}`);
    if (r) respostas[p.chave] = r;
  }

  return { ok: true, dados: { nome, whatsapp, email, empresa, mensagem, respostas, origem: lerOrigemDaCaptacao(o.origem) } };
}

/** Limite de envios numa janela de tempo, contado na memória da instância. */
export function criarLimite(maximo: number, janelaMs: number, teto = 5000) {
  const janelas = new Map<string, { inicio: number; quantas: number }>();
  return (chave: string, agora = Date.now()): boolean => {
    const j = janelas.get(chave);
    if (!j || agora - j.inicio >= janelaMs) {
      if (janelas.size > teto) janelas.clear();
      janelas.set(chave, { inicio: agora, quantas: 1 });
      return true;
    }
    j.quantas += 1;
    return j.quantas <= maximo;
  };
}
