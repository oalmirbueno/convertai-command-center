/**
 * Profile: composição determinística escolhida pela equipe. Texto e fotografias
 * já preparados entram num PNG final; guardar acrescenta uma versão, sem IA.
 * Não importa Deno/Supabase: o contrato e as travas são os mesmos nos testes.
 */
export interface TemplateProfile {
  versao: 1;
  estilo: "twitter" | "instagram";
  nome: string;
  username: string;
  /** Escolha visual explícita; nunca significa confirmação oficial da conta. */
  verificado: boolean;
  texto: string;
  tamanho_texto: number;
  cor_fundo: string;
  tema: "claro" | "escuro";
  tamanho_foto: number;
  espacamento: number;
  arredondamento: number;
  foto_caminho?: string;
  imagem_caminho?: string;
  /** Anotação sobre a imagem original; o renderizador converte pelo mesmo contain da foto. */
  destaque?: { x: number; y: number; rotulo: string };
}

export interface VersaoDoTemplate {
  ordem: number;
  versao: number;
  storage_path: string;
  pedido_id?: string;
  template_hash?: string;
  template_profile?: TemplateProfile;
  tamanho?: string;
}

export interface TrabalhoDoTemplate {
  id: string;
  client_id: string;
  status: string;
  tipo?: string | null;
  entrega_status?: string | null;
  direcao: { cards: Array<{ ordem: number; texto_exato: string }>; formato?: unknown };
  cards: VersaoDoTemplate[];
}

type Erro = (status: number, codigo: string, mensagem: string) => Error;
export type DepsDoTemplate<C extends { userId: string }, T extends TrabalhoDoTemplate> = {
  erro: Erro;
  json: (body: unknown, status?: number) => Response;
  trabalhoComAcesso: (ch: C, id: string) => Promise<T>;
  mutarTrabalho: (id: string, mudar: (t: T) => Record<string, unknown>) => Promise<T>;
  salvarImagem: (t: T, ordem: number, proxima: number, png: Uint8Array) => Promise<{ caminho: string; versao: number }>;
  /** Somente um upload desta chamada que perdeu para um replay já confirmado. */
  descartarUpload?: (caminho: string) => Promise<void>;
  quadro: (t: T) => { formato: string; largura: number; altura: number };
  ehPostDeFotos: (t: T) => boolean;
  statusDepoisDeGerar: (t: T, ordem: number) => string;
  atualizarTexto: (t: T, ordem: number, texto: string) => T["direcao"];
};

export const MAX_BYTES_PNG_TEMPLATE = 8_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHADOS = new Set(["entregue", "aprovado", "agendado", "arquivado"]);
const EM_APROVACAO = new Set(["aguardando_agencia", "aguardando_cliente", "aprovado", "agendado"]);
const objeto = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
  return c >>> 0;
});

function crcPng(bytes: Uint8Array, inicio: number, fim: number): number {
  let c = 0xffffffff;
  for (let i = inicio; i < fim; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function faixa(v: unknown, padrao: number, min: number, max: number, erro: Erro): number {
  const n = v === undefined ? padrao : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) throw erro(400, "ajuste_template_invalido", "Um ajuste do template está fora do intervalo permitido.");
  return Math.round(n);
}

function campo(v: unknown, max: number, obrigatorio: boolean, erro: Erro): string {
  if (typeof v !== "string" || v.length > max || Array.from(v).some((c) => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)))) throw erro(400, "texto_template_invalido", "Texto do template inválido ou muito longo.");
  const t = v.trim();
  if (obrigatorio && !t) throw erro(400, "texto_template_vazio", "Preencha o nome, o perfil e o conteúdo do template.");
  return t;
}

/** Metadados permitem só campos conhecidos e caminhos do bucket mesa do cliente. */
export function normalizarTemplateProfile(v: unknown, clientId: string, erro: Erro): TemplateProfile {
  const o = objeto(v);
  if (o.versao !== 1 || (o.estilo !== "twitter" && o.estilo !== "instagram")) throw erro(400, "template_invalido", "Escolha um template Profile válido.");
  if (o.verificado !== undefined && typeof o.verificado !== "boolean") throw erro(400, "selo_template_invalido", "A opção de selo do template deve ser explícita.");
  const username = campo(o.username, 31, true, erro).replace(/^@/, "");
  if (!/^[a-zA-Z0-9_.]{1,30}$/.test(username)) throw erro(400, "perfil_template_invalido", "Use o @perfil do Instagram, sem endereço ou espaços.");
  if (typeof o.cor_fundo !== "string" || !/^#[0-9a-f]{6}$/i.test(o.cor_fundo)) throw erro(400, "cor_template_invalida", "Escolha uma cor de fundo hexadecimal válida.");
  if (o.tema !== undefined && o.tema !== "claro" && o.tema !== "escuro") throw erro(400, "tema_template_invalido", "Escolha tema claro ou escuro.");
  const t: TemplateProfile = {
    versao: 1, estilo: o.estilo,
    nome: campo(o.nome, 120, true, erro), username,
    verificado: o.verificado === true,
    texto: campo(o.texto, 1200, true, erro),
    tamanho_texto: faixa(o.tamanho_texto, 36, 24, 56, erro),
    cor_fundo: o.cor_fundo.toLowerCase(), tema: o.tema === "escuro" ? "escuro" : "claro",
    tamanho_foto: faixa(o.tamanho_foto, 72, 40, 120, erro),
    espacamento: faixa(o.espacamento, 40, 16, 96, erro),
    arredondamento: faixa(o.arredondamento, 20, 0, 48, erro),
  };
  for (const k of ["foto_caminho", "imagem_caminho"] as const) {
    if (o[k] === undefined || o[k] === null || o[k] === "") continue;
    const p = campo(o[k], 500, true, erro);
    if (!p.startsWith(`${clientId}/`) || /[\\%?#:]/.test(p) || p.split("/").some((s) => !s || s === "." || s === "..")) throw erro(400, "foto_template_invalida", "A imagem do template precisa pertencer a este cliente.");
    t[k] = p;
  }
  if (o.destaque !== undefined && o.destaque !== null) {
    const destaque = objeto(o.destaque);
    if (typeof destaque.x !== "number" || !Number.isFinite(destaque.x) || destaque.x < 0 || destaque.x > 1 || typeof destaque.y !== "number" || !Number.isFinite(destaque.y) || destaque.y < 0 || destaque.y > 1) throw erro(400, "destaque_template_invalido", "Escolha um ponto dentro da imagem para o destaque.");
    const rotulo = campo(destaque.rotulo, 60, true, erro);
    if (/[\r\n\t<>]/.test(rotulo)) throw erro(400, "destaque_template_invalido", "Use um rótulo curto de uma linha no destaque.");
    t.destaque = { x: destaque.x, y: destaque.y, rotulo };
  }
  return t;
}

/** Limite antes de decodificar; assinatura, IHDR e estrutura antes de armazenar. */
export function lerPngDoTemplate(v: unknown, largura: number, altura: number, erro: Erro): Uint8Array {
  if (typeof v !== "string" || !v || v.length > Math.ceil(MAX_BYTES_PNG_TEMPLATE / 3) * 4) throw erro(413, "png_template_grande", "O PNG do template deve ter até 8 MB.");
  if (v.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) throw erro(400, "png_template_invalido", "Envie o PNG do template em base64 puro.");
  let raw: string;
  try { raw = atob(v); } catch { throw erro(400, "png_template_invalido", "O PNG do template não pôde ser lido."); }
  if (raw.length > MAX_BYTES_PNG_TEMPLATE) throw erro(413, "png_template_grande", "O PNG do template deve ter até 8 MB.");
  const png = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  const assinatura = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.length < 57 || assinatura.some((b, i) => png[i] !== b)) throw erro(400, "png_template_invalido", "O arquivo do template não é um PNG válido.");
  const dados = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const tipo = (i: number) => String.fromCharCode(...png.subarray(i + 4, i + 8));
  if (dados.getUint32(8) !== 13 || tipo(8) !== "IHDR" || dados.getUint32(16) !== largura || dados.getUint32(20) !== altura) throw erro(400, "formato_template_invalido", `O template precisa ter ${largura} × ${altura} px, no formato deste trabalho.`);
  if (png[24] !== 8 || ![0, 2, 3, 4, 6].includes(png[25]) || png[26] !== 0 || png[27] !== 0 || png[28] !== 0) throw erro(400, "png_template_invalido", "Use o PNG padrão exportado pelo template.");
  let offset = 8;
  let imagem = false;
  let fim = false;
  while (offset + 12 <= png.length) {
    const n = dados.getUint32(offset);
    const chunk = tipo(offset);
    if (n > png.length - offset - 12 || !/^[A-Za-z]{4}$/.test(chunk) || (offset > 8 && chunk === "IHDR")) throw erro(400, "png_template_invalido", "O PNG do template está incompleto.");
    if (crcPng(png, offset + 4, offset + 8 + n) !== dados.getUint32(offset + 8 + n)) throw erro(400, "png_template_invalido", "O PNG do template está corrompido. Gere a prévia novamente.");
    if (chunk === "IDAT" && n > 0) imagem = true;
    offset += 12 + n;
    if (chunk === "IEND") { fim = n === 0 && offset === png.length; break; }
  }
  if (!imagem || !fim) throw erro(400, "png_template_invalido", "O PNG do template está incompleto.");
  return png;
}

function editavel<T extends TrabalhoDoTemplate>(t: T, ordem: number, esperado: number, textoBase: string, d: { erro: Erro; ehPostDeFotos: (t: T) => boolean }) {
  if (FECHADOS.has(t.status) || EM_APROVACAO.has(t.entrega_status || "")) throw d.erro(409, "trabalho_entregue", "Este trabalho está entregue ou em aprovação. Reabra para corrigir antes de guardar outra versão.");
  if (t.tipo === "ads" || d.ehPostDeFotos(t)) throw d.erro(409, "template_indisponivel", "Profile está disponível para artes e carrosséis do Estúdio.");
  const card = t.direcao.cards.find((c) => c.ordem === ordem);
  if (!card) throw d.erro(404, "card_inexistente", "Esta lâmina não existe na direção do trabalho.");
  const atual = Math.max(0, ...t.cards.filter((c) => c.ordem === ordem).map((c) => c.versao));
  if (atual !== esperado) throw d.erro(409, "template_concorrente", "A lâmina mudou enquanto o template era editado. Atualize e confira a versão antes de guardar.");
  if ((card.texto_exato || "") !== textoBase) throw d.erro(409, "texto_template_alterado", "O texto da direção mudou enquanto o template era editado. Confira o conteúdo novo antes de guardar.");
}

class ReplayDoTemplate<T> extends Error {
  constructor(readonly trabalho: T, readonly versao: VersaoDoTemplate) { super("template_ja_guardado"); }
}

/** A validação recusou antes do UPDATE: este snapshot prova que não anexou o upload. */
class RecusaDoTemplate<T> extends Error {
  constructor(readonly trabalho: T, readonly motivo: unknown) { super("template_recusado_antes_da_gravacao"); }
}

/** Acesso pela mesma autorização do Estúdio; a única escrita é append com CAS. */
export function acoesDoTemplateProfile<C extends { userId: string }, T extends TrabalhoDoTemplate>(d: DepsDoTemplate<C, T>) {
  async function salvarTemplate(ch: C, corpo: Record<string, unknown>): Promise<Response> {
    if (typeof corpo.trabalho_id !== "string" || !UUID.test(corpo.trabalho_id) || typeof corpo.pedido_id !== "string" || !UUID.test(corpo.pedido_id)) throw d.erro(400, "pedido_template_invalido", "Trabalho e identificador do pedido são obrigatórios.");
    if (typeof corpo.ordem !== "number" || !Number.isInteger(corpo.ordem) || corpo.ordem < 1 || typeof corpo.versao_esperada !== "number" || !Number.isInteger(corpo.versao_esperada) || corpo.versao_esperada < 0) throw d.erro(400, "versao_template_invalida", "Informe a lâmina e a versão que está editando.");
    if (typeof corpo.texto_base !== "string" || corpo.texto_base.length > 20_000) throw d.erro(400, "texto_base_template_invalido", "Informe o texto da direção que está editando.");
    const t = await d.trabalhoComAcesso(ch, corpo.trabalho_id);
    const template = normalizarTemplateProfile(corpo.template, t.client_id, d.erro);
    const quadro = d.quadro(t);
    // O replay usa o quadro que já foi guardado, mesmo que o trabalho tenha mudado de formato depois.
    const tentativaAnterior = t.cards.find((c) => c.pedido_id === corpo.pedido_id);
    const tamanhoAnterior = /^(\d{1,4})x(\d{1,4})$/.exec(tentativaAnterior?.tamanho || "");
    const png = lerPngDoTemplate(corpo.png_base64, tamanhoAnterior ? Number(tamanhoAnterior[1]) : quadro.largura, tamanhoAnterior ? Number(tamanhoAnterior[2]) : quadro.altura, d.erro);
    const hashPng = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(png))), (b) => b.toString(16).padStart(2, "0")).join("");
    // As dimensões já fazem parte dos bytes. O hash não depende do estado mutável do trabalho.
    const assinatura = new TextEncoder().encode(JSON.stringify([corpo.ordem, corpo.versao_esperada, corpo.texto_base, template, hashPng]));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", assinatura)), (b) => b.toString(16).padStart(2, "0")).join("");
    const replay = (atual: T) => {
      const anterior = atual.cards.find((c) => c.pedido_id === corpo.pedido_id);
      if (anterior && anterior.template_hash !== hash) throw d.erro(409, "pedido_template_reutilizado", "Este identificador já foi usado para outro template. Faça um novo pedido.");
      return anterior;
    };
    const resposta = (trabalho: T, v: VersaoDoTemplate, repetido = false) => d.json({ trabalho, ordem: v.ordem, versao: v.versao, storage_path: v.storage_path, custo_usd: 0, ...(repetido ? { ja_guardado: true } : {}) });
    const anterior = replay(t);
    if (anterior) return resposta(t, anterior, true);
    editavel(t, corpo.ordem, corpo.versao_esperada, corpo.texto_base, d);
    const ordem = corpo.ordem;
    const esperado = corpo.versao_esperada;
    const textoBase = corpo.texto_base;
    const upload = await d.salvarImagem(t, ordem, esperado + 1, png);
    const nova = {
      ordem, versao: upload.versao, storage_path: upload.caminho,
      origem: "gerar" as const, modo: "template_profile", template_profile: template,
      pedido_id: corpo.pedido_id, template_hash: hash,
      formato_post: quadro.formato, tamanho: `${quadro.largura}x${quadro.altura}`,
      verificacao: { pendente: true as const }, custo_usd: 0, uso_ids: [],
      criado_em: new Date().toISOString(), criado_por: ch.userId,
    };
    try {
      const gravado = await d.mutarTrabalho(t.id, (atual) => {
        try {
          if (atual.client_id !== t.client_id) throw d.erro(409, "cliente_template_alterado", "O cliente do trabalho mudou. Abra o trabalho novamente.");
          const repetido = replay(atual);
          if (repetido) throw new ReplayDoTemplate(atual, repetido);
          editavel(atual, ordem, esperado, textoBase, d);
          if (d.quadro(atual).formato !== quadro.formato) throw d.erro(409, "formato_template_alterado", "O formato do trabalho mudou. Gere a prévia novamente.");
        } catch (e) {
          if (e instanceof ReplayDoTemplate) throw e;
          throw new RecusaDoTemplate(atual, e);
        }
        return { cards: [...atual.cards, nova], direcao: d.atualizarTexto(atual, ordem, template.texto), status: d.statusDepoisDeGerar(atual, ordem) };
      });
      return resposta(gravado, nova);
    } catch (e) {
      if (e instanceof RecusaDoTemplate) {
        const recusado = e as RecusaDoTemplate<T>;
        if (d.descartarUpload && !recusado.trabalho.cards.some((c) => c.storage_path === upload.caminho)) await d.descartarUpload(upload.caminho).catch(() => undefined);
        throw recusado.motivo;
      }
      // Falha de rede/UPDATE sem resultado confirmado: não apagar, pois o commit pode ter ocorrido.
      if (!(e instanceof ReplayDoTemplate)) throw e;
      // O outro pedido já confirmou sua versão; o upload exclusivo desta tentativa não foi referenciado.
      const repetido = e as ReplayDoTemplate<T>;
      if (d.descartarUpload && !repetido.trabalho.cards.some((c) => c.storage_path === upload.caminho)) await d.descartarUpload(upload.caminho).catch(() => undefined);
      return resposta(repetido.trabalho, repetido.versao, true);
    }
  }
  return { salvar_template: salvarTemplate };
}
