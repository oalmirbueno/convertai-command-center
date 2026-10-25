/**
 * Jornada da Mesa Site (25/10/2026, dono: "deixar bem profissional e mais
 * intuitivo... tudo já preenchido conforme o cliente, a gente só escolhe o
 * objetivo"). Cinco passos: objetivo, partida (do zero, de uma referência ou
 * de um site pronto), conferir o que veio do cliente, construir e ajustar
 * conversando com a IA. As etapas antigas seguem como "avançado".
 *
 * Aqui mora o contrato com o motor de código (a frente do worker lê o
 * mesmo arquivo): o pedido de construção leva `objetivo`, `partida`,
 * `motor?`, `modelo_id?` e `contexto_do_cliente`. Regra do modo Fiel: copia a
 * estrutura e o layout, com textos, imagens e marca do cliente; nunca o
 * conteúdo de terceiros.
 *
 * Puro: sem Deno, sem npm e sem banco. Sem lookbehind, classe de
 * propriedade Unicode ou grupo nomeado (a tela roda no Safari 11). Sem travessão.
 */
import type { TipoDeSite } from "../../_shared/site-biblioteca.ts";
import type { ModeloPronto } from "./modelos-prontos.ts";

// ------------------------------------------------------------------ passos

/** Os cinco passos da jornada (a etapa do endereço). As etapas antigas (ETAPAS_DO_SITE) ficam em "avançado". */
export const PASSOS_DA_JORNADA = [
  { valor: "objetivo", rotulo: "Objetivo" },
  { valor: "partida", rotulo: "Partida" },
  { valor: "conferir", rotulo: "Conferir o cliente" },
  { valor: "construir", rotulo: "Construir" },
  { valor: "ajustar", rotulo: "Ajustar e publicar" },
] as const;
export type PassoDaJornada = (typeof PASSOS_DA_JORNADA)[number]["valor"];
export const ehPassoDaJornada = (v: unknown): v is PassoDaJornada => typeof v === "string" && PASSOS_DA_JORNADA.some((p) => p.valor === v);

/** Onde o site abre quando a tela não diz a etapa: o primeiro passo que falta. */
export function passoInicial(site: { direcao?: Record<string, unknown> | null }): PassoDaJornada {
  const j = site.direcao && typeof site.direcao === "object" ? (site.direcao as Record<string, unknown>).jornada : null;
  const o = j && typeof j === "object" ? (j as Record<string, unknown>) : {};
  if (!o.objetivo) return "objetivo";
  if (!o.partida) return "partida";
  return "construir";
}

// ------------------------------------------------------------------ objetivos

export type ObjetivoDaCopyDoSite = "descoberta" | "educacao" | "autoridade" | "relacionamento" | "venda" | "contato";

export type ObjetivoDoSite = {
  id: string;
  rotulo: string;
  /** Uma linha: o que o site faz acontecer. */
  descricao: string;
  /** Tipo de site que o objetivo leva (mapa inicial de páginas e seções). */
  tipo: TipoDeSite;
  /** Modelo de página da galeria da casa (modelos-de-pagina.ts) quando há um que converte melhor; senão o mapa padrão do tipo. */
  modelo: string | null;
  /** Objetivo do motor de copy da casa (_shared/motor-de-copy.ts). */
  copy: ObjetivoDaCopyDoSite;
  /** O próximo passo do visitante (vai ao briefing quando ele está vazio). */
  acao: string;
};

export const OBJETIVOS_DO_SITE: ObjetivoDoSite[] = [
  { id: "captar", rotulo: "Captar contatos", descricao: "material em troca do contato", tipo: "landing", modelo: "captura", copy: "contato", acao: "Deixar nome e WhatsApp no formulário curto." },
  { id: "vender", rotulo: "Vender um produto", descricao: "dor, oferta, prova e preço", tipo: "landing", modelo: "vendas", copy: "venda", acao: "Comprar ou pedir pelo WhatsApp." },
  { id: "agendar", rotulo: "Agendar horário", descricao: "serviço e o botão de marcar", tipo: "landing", modelo: null, copy: "contato", acao: "Marcar um horário pelo WhatsApp ou pela agenda." },
  { id: "marca", rotulo: "Apresentar a marca", descricao: "quem é e o que faz", tipo: "institucional", modelo: "institucional_curto", copy: "autoridade", acao: "Falar com a empresa pelo WhatsApp ou formulário." },
  { id: "portfolio", rotulo: "Portfólio", descricao: "trabalhos e cases", tipo: "portfolio", modelo: null, copy: "autoridade", acao: "Pedir um orçamento." },
  { id: "evento", rotulo: "Divulgar um evento", descricao: "data, programa e inscrição", tipo: "landing", modelo: null, copy: "venda", acao: "Fazer a inscrição ou comprar o ingresso." },
  { id: "cardapio", rotulo: "Cardápio e pedidos", descricao: "produtos e pedido no WhatsApp", tipo: "loja", modelo: null, copy: "venda", acao: "Fazer o pedido pelo WhatsApp." },
  { id: "bio", rotulo: "Link na bio", descricao: "links para o Instagram", tipo: "bio", modelo: "bio", copy: "relacionamento", acao: "Tocar no link certo da bio." },
];

export const objetivoDoSite = (id: unknown): ObjetivoDoSite | null => OBJETIVOS_DO_SITE.filter((o) => o.id === id)[0] || null;

// ------------------------------------------------------------------ partida

export const TIPOS_DE_PARTIDA = ["zero", "referencia", "modelo_pronto"] as const;
export type TipoDePartida = (typeof TIPOS_DE_PARTIDA)[number];

export const MODOS_DA_REFERENCIA = [
  { id: "fiel", rotulo: "Fiel", descricao: "Copia a estrutura e o layout, com textos, imagens e marca do cliente." },
  { id: "proximo", rotulo: "Próximo", descricao: "Segue a organização e o clima da referência, com liberdade no visual e a marca do cliente." },
  { id: "criativo", rotulo: "Criativo", descricao: "Usa a referência só como ponto de partida e cria algo novo para a marca do cliente." },
] as const;
export type ModoDaReferencia = (typeof MODOS_DA_REFERENCIA)[number]["id"];

export type PartidaDoSite = { tipo: TipoDePartida; url?: string; modo?: ModoDaReferencia; modelo_id?: string };

export const MOTORES_DE_CODIGO = ["claude_code", "opencode"] as const;
export type MotorDeCodigo = (typeof MOTORES_DE_CODIGO)[number];
export const ROTULO_DO_MOTOR: Record<MotorDeCodigo, string> = { claude_code: "Claude Code", opencode: "OpenCode" };

/** Só endereço público https (sem usuário e senha, sem localhost e rede interna). */
export function urlPublicaDaReferencia(v: unknown): string | null {
  const s = String(v == null ? "" : v).trim();
  if (!s || s.length > 500) return null;
  const comEsquema = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  let u: URL;
  try {
    u = new URL(comEsquema);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!/\.[a-z]{2,}$/.test(host)) return null;
  if (host === "localhost" || /^(127|10|192\.168|169\.254)\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
  u.protocol = "https:";
  u.hash = "";
  return u.toString();
}

const ID_DO_MODELO = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function normalizarPartida(bruto: unknown): PartidaDoSite | null {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  if (o.tipo === "zero") return { tipo: "zero" };
  if (o.tipo === "referencia") {
    const url = urlPublicaDaReferencia(o.url);
    if (!url) return null;
    const modo = MODOS_DA_REFERENCIA.some((m) => m.id === o.modo) ? (o.modo as ModoDaReferencia) : "proximo";
    return { tipo: "referencia", url, modo };
  }
  if (o.tipo === "modelo_pronto") {
    const id = typeof o.modelo_id === "string" && ID_DO_MODELO.test(o.modelo_id) ? o.modelo_id : "";
    return id ? { tipo: "modelo_pronto", modelo_id: id } : null;
  }
  return null;
}

// ------------------------------------------------------------------ contexto do cliente

export type ContextoDoCliente = {
  marca: { nome: string; logo: boolean; cores: string[]; fontes: string[]; tom: string };
  negocio: string;
  publico: string;
  oferta: string;
  diferenciais: string[];
  produtos: string[];
  contatos: { whatsapp: string; telefone: string; email: string };
  endereco: string;
  horarios: string;
  instagram: string;
  copy_aprovada: string[];
  dossie: string;
};

/** Campos que a tela edita (a chave do campo e o rótulo). Marca vem do kit e se edita no kit. */
export const CAMPOS_DO_CONTEXTO: Array<{ chave: string; rotulo: string; lista?: boolean; longo?: boolean }> = [
  { chave: "negocio", rotulo: "Negócio", longo: true },
  { chave: "publico", rotulo: "Público", longo: true },
  { chave: "oferta", rotulo: "Oferta", longo: true },
  { chave: "produtos", rotulo: "Produtos e serviços", lista: true },
  { chave: "diferenciais", rotulo: "Diferenciais", lista: true },
  { chave: "contatos.whatsapp", rotulo: "WhatsApp" },
  { chave: "contatos.telefone", rotulo: "Telefone" },
  { chave: "contatos.email", rotulo: "E-mail" },
  { chave: "endereco", rotulo: "Endereço" },
  { chave: "horarios", rotulo: "Horários" },
  { chave: "instagram", rotulo: "Instagram" },
  { chave: "copy_aprovada", rotulo: "Copy aprovada", lista: true },
];

const semTravessao = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");
const linha = (v: unknown, max: number) => semTravessao(String(v == null ? "" : v).replace(/\s+/g, " ").trim()).slice(0, max);
const listaDe = (v: unknown, max: number, cada: number) =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n|;/) : [])
    .map((x) => linha(x, cada))
    .filter(Boolean)
    .filter((x, i, l) => l.indexOf(x) === i)
    .slice(0, max);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function contextoVazio(): ContextoDoCliente {
  return { marca: { nome: "", logo: false, cores: [], fontes: [], tom: "" }, negocio: "", publico: "", oferta: "", diferenciais: [], produtos: [], contatos: { whatsapp: "", telefone: "", email: "" }, endereco: "", horarios: "", instagram: "", copy_aprovada: [], dossie: "" };
}

/** Lê o contexto (da tela, do banco ou do pedido) sem confiar em nada. */
export function normalizarContexto(bruto: unknown): ContextoDoCliente {
  const o = obj(bruto);
  const m = obj(o.marca);
  const c = obj(o.contatos);
  return {
    marca: {
      nome: linha(m.nome, 120),
      logo: m.logo === true,
      cores: listaDe(m.cores, 8, 9).filter((x) => /^#[0-9a-f]{6}$/i.test(x)).map((x) => x.toUpperCase()),
      fontes: listaDe(m.fontes, 4, 60),
      tom: linha(m.tom, 300),
    },
    negocio: linha(o.negocio, 800),
    publico: linha(o.publico, 600),
    oferta: linha(o.oferta, 800),
    diferenciais: listaDe(o.diferenciais, 8, 200),
    produtos: listaDe(o.produtos, 12, 160),
    contatos: { whatsapp: linha(c.whatsapp, 30), telefone: linha(c.telefone, 30), email: linha(c.email, 120) },
    endereco: linha(o.endereco, 240),
    horarios: linha(o.horarios, 240),
    instagram: linha(o.instagram, 80),
    copy_aprovada: listaDe(o.copy_aprovada, 6, 240),
    dossie: linha(o.dossie, 1500),
  };
}

/**
 * O que a equipe editou vale sobre o que veio do cliente, campo a campo: o
 * editado vazio de propósito ("") apaga só aquele campo. A marca nunca vem do
 * editado (ela é do kit da marca aberta).
 */
export function juntarContexto(doCliente: ContextoDoCliente, editado: unknown): ContextoDoCliente {
  const e = obj(editado);
  const base = normalizarContexto(doCliente);
  const ed = normalizarContexto(e);
  const tem = (k: string) => Object.prototype.hasOwnProperty.call(e, k);
  const contatos = obj(e.contatos);
  const temC = (k: string) => Object.prototype.hasOwnProperty.call(contatos, k);
  return {
    ...base,
    negocio: tem("negocio") ? ed.negocio : base.negocio,
    publico: tem("publico") ? ed.publico : base.publico,
    oferta: tem("oferta") ? ed.oferta : base.oferta,
    diferenciais: tem("diferenciais") ? ed.diferenciais : base.diferenciais,
    produtos: tem("produtos") ? ed.produtos : base.produtos,
    contatos: {
      whatsapp: temC("whatsapp") ? ed.contatos.whatsapp : base.contatos.whatsapp,
      telefone: temC("telefone") ? ed.contatos.telefone : base.contatos.telefone,
      email: temC("email") ? ed.contatos.email : base.contatos.email,
    },
    endereco: tem("endereco") ? ed.endereco : base.endereco,
    horarios: tem("horarios") ? ed.horarios : base.horarios,
    instagram: tem("instagram") ? ed.instagram : base.instagram,
    copy_aprovada: tem("copy_aprovada") ? ed.copy_aprovada : base.copy_aprovada,
  };
}

/**
 * O que a função leu do painel para montar o contexto (já pela regra da
 * marca: kit, contexto, estratégia, dossiê e Instagram vêm da marca aberta,
 * nunca de outra). O cadastro (telefone, e-mail, endereço) passa do cliente
 * para as marcas; as ofertas da Mesa Ads são do cliente inteiro e só entram
 * na marca principal ou no cliente sem marcas.
 */
export type FontesDoContexto = {
  marca: { nome: string; principal: boolean } | null;
  nomeCliente: string;
  kit: { cores: string[]; fontes: string[]; temLogo: boolean; tom: string | null };
  contexto: Record<string, unknown>;
  estrategia: { tagline: string | null; estrategia: Record<string, unknown> } | null;
  dossie: string | null;
  instagram: string[];
  cadastro: { telefone: string | null; email: string | null; endereco: string | null } | null;
  site: { seo: unknown; integracoes: unknown };
  ofertas: string[];
  copyDoSite: string[];
};

export type OrigemDoCampo = "site" | "marca" | "cadastro" | "estrategia" | "dossie" | "instagram" | "ads";

/** Monta o contexto do cliente e diz de onde veio cada campo (a tela mostra a origem no title). */
export function contextoDasFontes(f: FontesDoContexto): { contexto: ContextoDoCliente; origem: Record<string, OrigemDoCampo> } {
  const origem: Record<string, OrigemDoCampo> = {};
  const c = obj(f.contexto);
  const seo = obj(f.site.seo);
  const negocio = obj(seo.negocio);
  const integ = obj(f.site.integracoes);
  const whats = obj(integ.whatsapp);
  const mapa = obj(integ.mapa);
  const est = f.estrategia ? obj(f.estrategia.estrategia) : {};
  const pega = (campo: string, ...pares: Array<[unknown, OrigemDoCampo]>): string => {
    for (const [v, o] of pares) {
      const s = Array.isArray(v) ? v.map((x) => linha(x, 200)).filter(Boolean).join("; ") : linha(v, 800);
      if (s) {
        origem[campo] = o;
        return s;
      }
    }
    return "";
  };
  const pegaLista = (campo: string, ...pares: Array<[unknown, OrigemDoCampo]>): string[] => {
    for (const [v, o] of pares) {
      const l = listaDe(v, 12, 200);
      if (l.length) {
        origem[campo] = o;
        return l;
      }
    }
    return [];
  };
  const enderecoDoSite = [negocio.rua, negocio.bairro, negocio.cidade, negocio.estado].map((x) => linha(x, 80)).filter(Boolean).join(", ");
  const ofertasValem = !f.marca || f.marca.principal;
  const bruto: ContextoDoCliente = {
    marca: { nome: linha(f.marca && !f.marca.principal ? f.marca.nome : f.nomeCliente, 120), logo: !!f.kit.temLogo, cores: f.kit.cores, fontes: f.kit.fontes, tom: linha(f.kit.tom || c.tom_de_voz, 300) },
    negocio: pega("negocio", [c.negocio, "marca"], [est.posicionamento, "estrategia"], [f.dossie, "dossie"]),
    publico: pega("publico", [c.publico, "marca"], [est.publico, "estrategia"]),
    oferta: pega("oferta", [c.oferta, "marca"], [est.promessa, "estrategia"]),
    diferenciais: pegaLista("diferenciais", [c.diferenciais, "marca"], [est.diferenciais, "estrategia"]),
    produtos: pegaLista("produtos", [c.produtos, "marca"], [c.servicos, "marca"], [ofertasValem ? f.ofertas : [], "ads"]),
    contatos: {
      whatsapp: pega("contatos.whatsapp", [whats.numero, "site"], [f.cadastro ? f.cadastro.telefone : null, "cadastro"]),
      telefone: pega("contatos.telefone", [negocio.telefone, "site"], [f.cadastro ? f.cadastro.telefone : null, "cadastro"]),
      email: pega("contatos.email", [negocio.email, "site"], [f.cadastro ? f.cadastro.email : null, "cadastro"]),
    },
    endereco: pega("endereco", [enderecoDoSite, "site"], [mapa.endereco, "site"], [f.cadastro ? f.cadastro.endereco : null, "cadastro"]),
    horarios: pega("horarios", [negocio.horario, "site"]),
    instagram: pega("instagram", [f.instagram.length ? `@${f.instagram[0]}` : "", "instagram"]),
    copy_aprovada: pegaLista("copy_aprovada", [[f.estrategia && f.estrategia.tagline ? f.estrategia.tagline : ""].concat(f.copyDoSite), "estrategia"]),
    dossie: pega("dossie", [f.dossie, "dossie"]),
  };
  return { contexto: normalizarContexto(bruto), origem };
}

/** Quantos campos do contexto estão preenchidos (a tela mostra "9 de 12"). */
export function camposPreenchidos(c: ContextoDoCliente): { feitos: number; total: number; faltando: string[] } {
  const valor = (chave: string): unknown => chave.split(".").reduce((acc: unknown, k) => obj(acc)[k], c as unknown);
  const faltando = CAMPOS_DO_CONTEXTO.filter((f) => {
    const v = valor(f.chave);
    return Array.isArray(v) ? !v.length : !String(v || "").trim();
  }).map((f) => f.rotulo);
  return { feitos: CAMPOS_DO_CONTEXTO.length - faltando.length, total: CAMPOS_DO_CONTEXTO.length, faltando };
}

// ------------------------------------------------------------------ contrato com o motor

export type PedidoDeConstrucao = {
  objetivo: string;
  partida: PartidaDoSite;
  motor?: MotorDeCodigo;
  /** Modelo do catálogo (ia_modelos; pode ser OpenRouter). Sem ele, o padrão do motor. */
  modelo_id?: string;
  contexto_do_cliente: ContextoDoCliente;
};

/**
 * Lê o contrato da construção. Sem objetivo válido ou sem partida válida:
 * null (o pedido segue como antes, sem a jornada). O worker lê os mesmos
 * campos em motor_trabalhos.pedido.
 */
export function normalizarContratoDaConstrucao(bruto: unknown): PedidoDeConstrucao | null {
  const o = obj(bruto);
  const objetivo = objetivoDoSite(o.objetivo);
  const partida = normalizarPartida(o.partida);
  if (!objetivo || !partida) return null;
  const saida: PedidoDeConstrucao = { objetivo: objetivo.id, partida, contexto_do_cliente: normalizarContexto(o.contexto_do_cliente) };
  if (MOTORES_DE_CODIGO.some((m) => m === o.motor)) saida.motor = o.motor as MotorDeCodigo;
  if (typeof o.modelo_id === "string" && o.modelo_id.trim()) saida.modelo_id = o.modelo_id.trim().slice(0, 200);
  return saida;
}

/** A instrução curta do trabalho (aparece na lista de trabalhos). */
export function instrucaoDaConstrucao(p: PedidoDeConstrucao): string {
  const obj0 = objetivoDoSite(p.objetivo);
  const objetivo = obj0 ? obj0.rotulo : p.objetivo;
  if (p.partida.tipo === "referencia") {
    const modo = MODOS_DA_REFERENCIA.filter((m) => m.id === p.partida.modo)[0];
    return `Construir (${objetivo}) a partir da referência ${p.partida.url}, modo ${modo ? modo.rotulo : "Próximo"}: ${modo ? modo.descricao : ""}`.trim();
  }
  if (p.partida.tipo === "modelo_pronto") return `Construir (${objetivo}) a partir do site pronto ${p.partida.modelo_id}`;
  return `Construir (${objetivo}) do zero`;
}

// ------------------------------------------------------------------ galeria de sites prontos

/**
 * Tipos de site do catálogo (modelos-prontos.ts, `tipo_sugerido`) que servem
 * a cada objetivo. Link na bio não tem modelo pronto: a casa faz do zero.
 */
export const TIPOS_DO_OBJETIVO: Record<string, string[]> = {
  captar: ["landing"],
  vender: ["landing", "loja"],
  agendar: ["landing", "institucional"],
  marca: ["institucional", "portfolio"],
  portfolio: ["portfolio"],
  evento: ["landing"],
  cardapio: ["loja", "institucional"],
  bio: [],
};

const nichosDoModelo = (m: ModeloPronto): string[] => (Array.isArray(m.nichos) ? m.nichos : []).map((x) => String(x || "").toLowerCase());

/** Modelo pronto válido para ir à tela (id, nome, repositório https e licença). */
export function modeloProntoValido(m: unknown): m is ModeloPronto {
  const o = obj(m);
  return typeof o.id === "string" && ID_DO_MODELO.test(o.id) && typeof o.nome === "string" && !!o.nome.trim() && typeof o.repositorio === "string" && /^https:\/\//.test(o.repositorio) && typeof o.licenca === "string" && !!o.licenca.trim();
}

/** O nicho do cliente casa com o do modelo (um contém o outro: "cafe" casa com "cafeteria"). */
export function nichoCasa(m: ModeloPronto, nichos: string[]): boolean {
  const alvo = nichos.map((n) => String(n || "").toLowerCase().trim()).filter((n) => n.length >= 3 && n !== "geral");
  return alvo.length > 0 && nichosDoModelo(m).some((x) => alvo.some((n) => n.indexOf(x) >= 0 || x.indexOf(n) >= 0));
}

/** O modelo serve ao objetivo: pela lista de objetivos dele; sem lista, pelo tipo sugerido. */
export function modeloServeAoObjetivo(m: ModeloPronto, objetivo: string): boolean {
  const lista = Array.isArray(m.objetivo) ? m.objetivo.map(String) : [];
  if (lista.length) return lista.indexOf(objetivo) >= 0;
  return (TIPOS_DO_OBJETIVO[objetivo] || []).indexOf(String(m.tipo_sugerido)) >= 0;
}

/**
 * Os sites prontos do objetivo; com nicho do cliente, os do nicho vêm
 * primeiro e `doNicho` diz quantos casaram. Sem objetivo, todos.
 */
export function modelosDoObjetivo(catalogo: readonly unknown[], objetivo: string | null, nichos: string[]): { lista: ModeloPronto[]; doNicho: number } {
  const validos = (Array.isArray(catalogo) ? catalogo : []).filter(modeloProntoValido);
  const doObjetivo = objetivo ? validos.filter((m) => modeloServeAoObjetivo(m, objetivo)) : validos;
  const doNicho = doObjetivo.filter((m) => nichoCasa(m, nichos));
  const resto = doObjetivo.filter((m) => doNicho.indexOf(m) < 0);
  return { lista: doNicho.concat(resto), doNicho: doNicho.length };
}

/** A pergunta do Jev: qual site pronto serve melhor a este cliente (Choice entre os da lista). */
export function perguntaDoModeloPronto(lista: ModeloPronto[]) {
  const criteria: Record<string, string> = {};
  lista.slice(0, 60).forEach((m) => {
    criteria[m.id] = `${m.nome}: ${m.descricao || ""} Nichos: ${nichosDoModelo(m).join(", ") || "geral"}.`;
  });
  return {
    type: "choice" as const,
    instructions: "Which ready-made website template is the best starting point for this client's site, given `cliente` (business, audience, niche) and `objetivo` (what the site must make happen)? Prefer the template whose niche and structure fit the client's business and goal.",
    criteria,
  };
}

// ------------------------------------------------------------------ estrutura de página que converte

/** Os papéis da página que converte, em ordem. */
export const PAPEIS_DA_PAGINA = ["gancho", "dor", "oferta", "prova", "objecoes", "cta"] as const;
export type PapelDaSecao = (typeof PAPEIS_DA_PAGINA)[number];

export const ROTULO_DO_PAPEL: Record<PapelDaSecao, string> = { gancho: "Gancho", dor: "Dor", oferta: "Oferta", prova: "Prova", objecoes: "Objeções", cta: "Chamada" };

/** O papel de cada tipo de seção da biblioteca na página que converte (topo e rodapé: navegação, sem papel). */
export function papelDaSecao(tipo: string): PapelDaSecao | null {
  if (tipo === "hero" || tipo === "hero_dividido") return "gancho";
  if (tipo === "problema") return "dor";
  if (["servicos", "bento", "processo", "rolagem_fixa", "diferenciais", "vitrine", "pricing", "galeria"].indexOf(tipo) >= 0) return "oferta";
  if (["prova", "depoimentos", "numeros", "marquee", "portfolio", "antes_depois", "sobre", "equipe"].indexOf(tipo) >= 0) return "prova";
  if (tipo === "faq") return "objecoes";
  if (tipo === "chamada" || tipo === "contato" || tipo === "links") return "cta";
  return null;
}

/** O que cada papel faz em cada objetivo (vai ao redator junto da fórmula da seção). */
export function missaoDoPapel(papel: PapelDaSecao, objetivo: ObjetivoDoSite | null): string {
  const acao = objetivo ? objetivo.acao.replace(/\.$/, "").toLowerCase() : "dar o próximo passo";
  const meta = objetivo ? objetivo.rotulo.toLowerCase() : "converter";
  switch (papel) {
    case "gancho":
      return `parar o visitante nos 3 primeiros segundos com o resultado que ele quer; o site existe para ${meta}`;
    case "dor":
      return "nomear a dor do público nas palavras dele e virar para a solução";
    case "oferta":
      return "mostrar o que o cliente entrega e o resultado de cada item, sem preço inventado";
    case "prova":
      return "dar confiança só com dado real (método, garantia, fotos reais); sem dado, o método";
    case "objecoes":
      return "responder as objeções reais de quem hesita antes de agir";
    default:
      return `levar o visitante a ${acao}, com benefício e urgência honesta`;
  }
}
