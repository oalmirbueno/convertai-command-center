/**
 * Profile: composição determinística escolhida pela equipe. Texto e fotografias
 * já preparados entram num PNG final; guardar acrescenta uma versão, sem IA.
 * Não importa Deno/Supabase: o contrato e as travas são os mesmos nos testes.
 */
export interface NumerosDoPost {
  respostas?: number;
  reposts?: number;
  curtidas?: number;
  visualizacoes?: number;
  comentarios?: number;
}

/**
 * Carrossel estilo post do X (22/10/2026): a lâmina inteira é o post (foto redonda, nome, selo, @,
 * texto com trechos em negrito) e um BLOCO DE MÍDIA desenhado por código. A mídia entra inteira
 * no bloco: foto, vídeo, gráfico ou card de manchete; nada é colado por cima de arte gerada.
 */
export type TipoDoBloco = "imagem" | "video" | "grafico" | "manchete" | "perfil" | "nenhum";
export type OrigemDaMidia = "internet" | "gerada" | "enviada" | "workspace" | "acervo" | "cliente";
export interface CreditoDaMidia { fonte: string; autor: string | null; licenca: string; url: string }
export interface MidiaDoBloco {
  /** "mesa": pasta do cliente no bucket mesa; "workspace": arquivo do Workspace do cliente. */
  bucket: "mesa" | "workspace";
  caminho: string;
  origem: OrigemDaMidia;
  duracao_s?: number;
  credito?: CreditoDaMidia;
}
export interface GraficoDoBloco {
  /** "numero" (23/10): um número grande com o rótulo embaixo. */
  tipo: "barras" | "linha" | "pizza" | "tabela" | "numero";
  titulo?: string;
  unidade?: string;
  /** Barras, linha e pizza. */
  dados: Array<{ rotulo: string; valor: number }>;
  /** Tabela: cabeçalho e linhas. */
  colunas?: string[];
  linhas?: string[][];
  /** De onde vêm os números (sempre de uma fonte real; o código não inventa). */
  fonte?: string;
}
export interface MancheteDoBloco { veiculo: string; titulo: string; linha_fina?: string; data?: string; url?: string; cor?: string }
/**
 * O "print" do perfil na última lâmina (23/10, dono: "no último card, o print do perfil com a bio e o seguir"):
 * desenhado por código com os dados de Redes, no jeito do Instagram ou do X. A foto é a do perfil do template.
 */
export interface PerfilDoBloco {
  estilo: "instagram" | "x";
  nome: string;
  username: string;
  bio?: string;
  site?: string;
  posts?: number;
  seguidores?: number;
  seguindo?: number;
  verificado?: boolean;
}
export interface BlocoDaLamina {
  tipo: TipoDoBloco;
  /** Onde o bloco fica: abaixo do texto, acima (logo depois do perfil) ou no meio dos parágrafos. */
  posicao: "abaixo" | "acima" | "meio";
  /** Altura em % do espaço livre e largura em % da coluna do texto. */
  altura: number;
  largura: number;
  sangrar: boolean;
  cantos: number;
  borda: boolean;
  sombra: boolean;
  /** "inteira" mostra a mídia toda (padrão); "preencher" cobre o bloco a partir do ponto focal. */
  enquadramento: "inteira" | "preencher";
  foco_x: number;
  foco_y: number;
  midia?: MidiaDoBloco;
  grafico?: GraficoDoBloco;
  manchete?: MancheteDoBloco;
  perfil?: PerfilDoBloco;
  /** Gravar o ícone de som desligado na peça (o Instagram já mostra o dele nas lâminas de vídeo). */
  som_na_peca?: boolean;
  /** 23/10: o crédito da mídia (fonte e autor) escrito embaixo do bloco, como nas matérias. */
  credito_visivel?: boolean;
}

export interface TemplateProfile {
  versao: 1;
  /** "twitter" é o post do X (nome antigo mantido); "story" é o Story 9:16; "carrossel" é a lâmina inteira estilo post do X. */
  estilo: "twitter" | "instagram" | "story" | "carrossel";
  nome: string;
  username: string;
  /** Escolha visual explícita; nunca significa confirmação oficial da conta. */
  verificado: boolean;
  texto: string;
  tamanho_texto: number;
  cor_fundo: string;
  /** "dim" é o tema azul-escuro do X; no Instagram e no Story vale como escuro. */
  tema: "claro" | "escuro" | "dim";
  tamanho_foto: number;
  espacamento: number;
  arredondamento: number;
  foto_caminho?: string;
  imagem_caminho?: string;
  /** Acervo do cliente já escolhido nesta lâmina; nunca um bucket informado pela tela. */
  imagem_acervo_id?: string;
  /** Anotação sobre a imagem original; o renderizador converte pelo mesmo contain da foto. */
  destaque?: { x: number; y: number; rotulo: string };
  /** Simulação real (21/10): tempo do post ("2h"), local do Instagram e números opcionais. */
  tempo?: string;
  local?: string;
  curtido_por?: string;
  numeros?: NumerosDoPost;
  /** Proporção da mídia dentro do post: X 16:9 ou 1:1; Instagram 1:1 ou 4:5. */
  proporcao?: "16:9" | "1:1" | "4:5";
  /** Fio do X: a linha que liga um post ao seguinte. */
  fio?: boolean;
  /** Legenda do Instagram aberta (como depois de tocar em "mais"). */
  legenda_completa?: boolean;
  /** Edição à mão (21/10, rodada 2): zoom do post no quadro (%), largura da mídia (%) e o que esconder. */
  escala?: number;
  midia?: number;
  ocultar_numeros?: boolean;
  ocultar_tempo?: boolean;
  /** Carrossel (22/10): o bloco de mídia, a seta de próxima, o peso do texto e o rodapé levemente cinza. */
  bloco?: BlocoDaLamina;
  seta?: boolean;
  peso_texto?: "regular" | "medio";
  rodape_cinza?: boolean;
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
  direcao: { cards: Array<{ ordem: number; texto_exato: string; imagens_ids?: string[] }>; formato?: unknown };
  cards: VersaoDoTemplate[];
}

type Erro = (status: number, codigo: string, mensagem: string, detalhes?: Record<string, unknown>) => Error;
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
  if (o.versao !== 1 || (o.estilo !== "twitter" && o.estilo !== "instagram" && o.estilo !== "story" && o.estilo !== "carrossel")) throw erro(400, "template_invalido", "Escolha um template válido: post do X, carrossel estilo X, post do Instagram ou Story.");
  if (o.verificado !== undefined && typeof o.verificado !== "boolean") throw erro(400, "selo_template_invalido", "A opção de selo do template deve ser explícita.");
  const username = campo(o.username, 31, true, erro).replace(/^@/, "");
  if (!/^[a-zA-Z0-9_.]{1,30}$/.test(username)) throw erro(400, "perfil_template_invalido", "Use o @perfil do Instagram, sem endereço ou espaços.");
  if (typeof o.cor_fundo !== "string" || !/^#[0-9a-f]{6}$/i.test(o.cor_fundo)) throw erro(400, "cor_template_invalida", "Escolha uma cor de fundo hexadecimal válida.");
  if (o.tema !== undefined && o.tema !== "claro" && o.tema !== "escuro" && o.tema !== "dim") throw erro(400, "tema_template_invalido", "Escolha o tema claro, escuro ou dim.");
  const t: TemplateProfile = {
    versao: 1, estilo: o.estilo,
    nome: campo(o.nome, 120, true, erro), username,
    verificado: o.verificado === true,
    // A legenda do Instagram vai até 2.200 caracteres; X e Story têm aviso próprio na tela.
    texto: campo(o.texto, 2200, true, erro),
    tamanho_texto: faixa(o.tamanho_texto, 36, 24, 56, erro),
    cor_fundo: o.cor_fundo.toLowerCase(), tema: o.tema === "escuro" || o.tema === "dim" ? o.tema : "claro",
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
  if (o.imagem_acervo_id !== undefined && o.imagem_acervo_id !== null && o.imagem_acervo_id !== "") {
    if (typeof o.imagem_acervo_id !== "string" || !UUID.test(o.imagem_acervo_id)) throw erro(400, "imagem_acervo_template_invalida", "Escolha uma imagem do acervo desta lâmina.");
    if (t.imagem_caminho) throw erro(400, "fonte_template_ambigua", "Escolha uma única imagem principal para o template.");
    t.imagem_acervo_id = o.imagem_acervo_id.toLowerCase();
  }
  if (o.destaque !== undefined && o.destaque !== null) {
    const destaque = objeto(o.destaque);
    if (typeof destaque.x !== "number" || !Number.isFinite(destaque.x) || destaque.x < 0 || destaque.x > 1 || typeof destaque.y !== "number" || !Number.isFinite(destaque.y) || destaque.y < 0 || destaque.y > 1) throw erro(400, "destaque_template_invalido", "Escolha um ponto dentro da imagem para o destaque.");
    const rotulo = campo(destaque.rotulo, 60, true, erro);
    if (/[\r\n\t<>]/.test(rotulo)) throw erro(400, "destaque_template_invalido", "Use um rótulo curto de uma linha no destaque.");
    t.destaque = { x: destaque.x, y: destaque.y, rotulo };
  }
  normalizarSimulacao(o, t, erro);
  if (t.estilo === "carrossel") normalizarCarrossel(o, t, clientId, erro);
  return t;
}

/** Caminho de mídia do cliente: bucket mesa na pasta dele ou o Workspace dele (client/<id>/). */
export function caminhoDaMidiaDoCliente(bucket: unknown, caminho: unknown, clientId: string): boolean {
  if (typeof caminho !== "string" || caminho.length > 500 || /[\\%?#:]/.test(caminho) || caminho.split("/").some((s) => !s || s === "." || s === "..")) return false;
  if (bucket === "mesa") return caminho.startsWith(`${clientId}/`);
  if (bucket === "workspace") return caminho.startsWith(`client/${clientId}/`);
  return false;
}

const TIPOS_DO_BLOCO = ["imagem", "video", "grafico", "manchete", "perfil", "nenhum"];
const ORIGENS_DA_MIDIA = ["internet", "gerada", "enviada", "workspace", "acervo", "cliente"];
const TIPOS_DO_GRAFICO = ["barras", "linha", "pizza", "tabela", "numero"];

/** Bloco de mídia do carrossel: só campos conhecidos, números dentro da faixa e mídia do próprio cliente. */
function normalizarCarrossel(o: Record<string, unknown>, t: TemplateProfile, clientId: string, erro: Erro) {
  const linha = (v: unknown, max: number, obrigatorio = false): string => {
    if ((v === undefined || v === null || v === "") && !obrigatorio) return "";
    if (typeof v !== "string" || v.length > max || /[\r\t<>]/.test(v)) throw erro(400, "bloco_template_invalido", "Um texto do bloco de mídia está inválido ou longo demais.");
    const s = v.trim();
    if (obrigatorio && !s) throw erro(400, "bloco_template_invalido", "Preencha o título do bloco de mídia.");
    return s;
  };
  const sim = (v: unknown) => {
    if (v === undefined || v === null) return false;
    if (typeof v !== "boolean") throw erro(400, "opcao_template_invalida", "Uma opção do template precisa ser sim ou não.");
    return v;
  };
  t.seta = o.seta === undefined ? true : sim(o.seta);
  if (sim(o.rodape_cinza)) t.rodape_cinza = true;
  if (o.peso_texto !== undefined && o.peso_texto !== null) {
    if (o.peso_texto !== "regular" && o.peso_texto !== "medio") throw erro(400, "peso_template_invalido", "Escolha o peso regular ou médio do texto.");
    t.peso_texto = o.peso_texto;
  }
  const b = objeto(o.bloco);
  const tipo = b.tipo === undefined ? "nenhum" : b.tipo;
  if (typeof tipo !== "string" || TIPOS_DO_BLOCO.indexOf(tipo) < 0) throw erro(400, "bloco_template_invalido", "Escolha o tipo do bloco: imagem, vídeo, gráfico, manchete, perfil ou nenhum.");
  const posicao = b.posicao === undefined ? "abaixo" : b.posicao;
  if (posicao !== "abaixo" && posicao !== "acima" && posicao !== "meio") throw erro(400, "bloco_template_invalido", "Escolha o lugar do bloco: acima, no meio ou abaixo do texto.");
  const enquadramento = b.enquadramento === undefined ? "inteira" : b.enquadramento;
  if (enquadramento !== "inteira" && enquadramento !== "preencher") throw erro(400, "bloco_template_invalido", "Escolha o enquadramento: mídia inteira ou preencher.");
  const foco = (v: unknown) => {
    if (v === undefined || v === null) return 0.5;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) throw erro(400, "bloco_template_invalido", "O ponto focal precisa ficar dentro da mídia.");
    return Math.round(v * 1000) / 1000;
  };
  const bloco: BlocoDaLamina = {
    tipo: tipo as TipoDoBloco, posicao,
    altura: faixa(b.altura, 100, 20, 100, erro), largura: faixa(b.largura, 100, 40, 100, erro),
    sangrar: sim(b.sangrar), cantos: faixa(b.cantos, 18, 0, 48, erro), borda: sim(b.borda), sombra: sim(b.sombra),
    enquadramento, foco_x: foco(b.foco_x), foco_y: foco(b.foco_y),
  };
  if (sim(b.som_na_peca)) bloco.som_na_peca = true;
  if (sim(b.credito_visivel)) bloco.credito_visivel = true;
  if (tipo === "imagem" || tipo === "video") {
    const m = objeto(b.midia);
    if (!caminhoDaMidiaDoCliente(m.bucket, m.caminho, clientId)) throw erro(400, "midia_template_invalida", "A mídia do bloco precisa ser deste cliente (pasta do cliente ou Workspace dele).");
    if (typeof m.origem !== "string" || ORIGENS_DA_MIDIA.indexOf(m.origem) < 0) throw erro(400, "midia_template_invalida", "Informe de onde veio a mídia do bloco.");
    const midia: MidiaDoBloco = { bucket: m.bucket as "mesa" | "workspace", caminho: m.caminho as string, origem: m.origem as OrigemDaMidia };
    if (tipo === "video" && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(midia.caminho)) throw erro(400, "midia_template_invalida", "O bloco de vídeo precisa de um arquivo de vídeo (MP4, MOV ou WebM).");
    if (tipo === "imagem" && !/\.(png|jpe?g|webp)$/i.test(midia.caminho)) throw erro(400, "midia_template_invalida", "O bloco de imagem precisa de um PNG, JPG ou WebP.");
    if (m.duracao_s !== undefined && m.duracao_s !== null) {
      if (typeof m.duracao_s !== "number" || !Number.isFinite(m.duracao_s) || m.duracao_s <= 0 || m.duracao_s > 3600) throw erro(400, "midia_template_invalida", "Duração do vídeo inválida.");
      midia.duracao_s = Math.round(m.duracao_s * 100) / 100;
    }
    if (m.credito !== undefined && m.credito !== null) {
      const c = objeto(m.credito);
      midia.credito = { fonte: linha(c.fonte, 60, true), autor: linha(c.autor, 160) || null, licenca: linha(c.licenca, 120, true), url: linha(c.url, 600, true) };
    }
    bloco.midia = midia;
  }
  if (tipo === "grafico") {
    const g = objeto(b.grafico);
    if (typeof g.tipo !== "string" || TIPOS_DO_GRAFICO.indexOf(g.tipo) < 0) throw erro(400, "grafico_template_invalido", "Escolha barras, linha, pizza, número grande ou tabela.");
    const dados = (Array.isArray(g.dados) ? g.dados : []).map(objeto);
    if (dados.length > 12) throw erro(400, "grafico_template_invalido", "Use até 12 números no gráfico.");
    const grafico: GraficoDoBloco = {
      tipo: g.tipo as GraficoDoBloco["tipo"],
      dados: dados.map((d) => {
        if (typeof d.valor !== "number" || !Number.isFinite(d.valor) || Math.abs(d.valor) > 1e12) throw erro(400, "grafico_template_invalido", "Cada número do gráfico precisa ser um valor válido.");
        return { rotulo: linha(d.rotulo, 40, true), valor: d.valor };
      }),
    };
    if (g.tipo === "pizza" && grafico.dados.some((d) => d.valor < 0)) throw erro(400, "grafico_template_invalido", "A pizza não aceita valor negativo.");
    if (g.tipo === "tabela") {
      const colunas = (Array.isArray(g.colunas) ? g.colunas : []).map((c) => linha(c, 40, true));
      const linhas = (Array.isArray(g.linhas) ? g.linhas : []).map((l) => (Array.isArray(l) ? l : []).map((c) => linha(c, 40)));
      if (colunas.length < 1 || colunas.length > 5 || linhas.length < 1 || linhas.length > 8 || linhas.some((l) => l.length !== colunas.length)) throw erro(400, "grafico_template_invalido", "A tabela precisa de 1 a 5 colunas e 1 a 8 linhas completas.");
      grafico.colunas = colunas; grafico.linhas = linhas;
    } else if (g.tipo === "numero") {
      if (grafico.dados.length < 1) throw erro(400, "grafico_template_invalido", "O número grande precisa de um valor.");
      grafico.dados = grafico.dados.slice(0, 1);
    } else if (grafico.dados.length < 2) throw erro(400, "grafico_template_invalido", "O gráfico precisa de pelo menos dois números.");
    const titulo = linha(g.titulo, 90); if (titulo) grafico.titulo = titulo;
    const unidade = linha(g.unidade, 12); if (unidade) grafico.unidade = unidade;
    const fonte = linha(g.fonte, 160); if (fonte) grafico.fonte = fonte;
    bloco.grafico = grafico;
  }
  if (tipo === "manchete") {
    const n = objeto(b.manchete);
    const manchete: MancheteDoBloco = { veiculo: linha(n.veiculo, 40, true), titulo: linha(n.titulo, 220, true) };
    const fina = linha(n.linha_fina, 320); if (fina) manchete.linha_fina = fina;
    const data = linha(n.data, 40); if (data) manchete.data = data;
    const url = linha(n.url, 600);
    if (url) {
      if (!/^https:\/\/[^\s]+$/i.test(url)) throw erro(400, "manchete_template_invalida", "O link da notícia precisa começar com https://.");
      manchete.url = url;
    }
    if (n.cor !== undefined && n.cor !== null && n.cor !== "") {
      if (typeof n.cor !== "string" || !/^#[0-9a-f]{6}$/i.test(n.cor)) throw erro(400, "manchete_template_invalida", "Use uma cor hexadecimal para o veículo.");
      manchete.cor = n.cor.toLowerCase();
    }
    bloco.manchete = manchete;
  }
  if (tipo === "perfil") {
    const f = objeto(b.perfil);
    if (f.estilo !== "instagram" && f.estilo !== "x") throw erro(400, "perfil_template_invalido", "Escolha o perfil no jeito do Instagram ou do X.");
    const usuario = linha(f.username, 31, true).replace(/^@/, "");
    if (!/^[a-zA-Z0-9_.]{1,30}$/.test(usuario)) throw erro(400, "perfil_template_invalido", "O @ do perfil só aceita letras, números, ponto e sublinhado.");
    const perfil: PerfilDoBloco = { estilo: f.estilo, nome: linha(f.nome, 80, true), username: usuario };
    const bioBruta = f.bio === undefined || f.bio === null ? "" : f.bio;
    if (typeof bioBruta !== "string" || bioBruta.length > 300 || /[\t<>]/.test(bioBruta)) throw erro(400, "perfil_template_invalido", "A bio do perfil está inválida ou longa demais.");
    if (bioBruta.trim()) perfil.bio = bioBruta.replace(/\r/g, "").trim();
    const site = linha(f.site, 80); if (site) perfil.site = site;
    for (const k of ["posts", "seguidores", "seguindo"] as const) {
      const v = f[k];
      if (v === undefined || v === null || v === "") continue;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 9_999_999_999) throw erro(400, "perfil_template_invalido", "Os números do perfil precisam ser inteiros.");
      perfil[k] = v;
    }
    if (sim(f.verificado)) perfil.verificado = true;
    bloco.perfil = perfil;
  }
  t.bloco = bloco;
}

const CHAVES_DOS_NUMEROS = ["respostas", "reposts", "curtidas", "visualizacoes", "comentarios"] as const;

/** Campos da simulação real: todos opcionais, curtos e sem quebra de linha. */
function normalizarSimulacao(o: Record<string, unknown>, t: TemplateProfile, erro: Erro) {
  const linha = (v: unknown, max: number, codigo: string, mensagem: string): string | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string" || v.length > max || /[\r\n\t<>]/.test(v)) throw erro(400, codigo, mensagem);
    return v.trim() || undefined;
  };
  const tempo = linha(o.tempo, 24, "tempo_template_invalido", "Use um tempo curto, como 2h ou 21 de outubro.");
  if (tempo) t.tempo = tempo;
  const local = linha(o.local, 60, "local_template_invalido", "Use um local de até 60 caracteres.");
  if (local) t.local = local;
  const curtido = linha(o.curtido_por, 31, "curtido_template_invalido", "Use só o @ de quem curtiu.");
  if (curtido) {
    const u = curtido.replace(/^@/, "");
    if (!/^[a-zA-Z0-9_.]{1,30}$/.test(u)) throw erro(400, "curtido_template_invalido", "Use só o @ de quem curtiu.");
    t.curtido_por = u;
  }
  if (o.numeros !== undefined && o.numeros !== null) {
    const n = objeto(o.numeros);
    const numeros: NumerosDoPost = {};
    for (const k of CHAVES_DOS_NUMEROS) {
      const v = n[k];
      if (v === undefined || v === null) continue;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 9_999_999_999) throw erro(400, "numeros_template_invalidos", "Os números do post precisam ser inteiros, sem negativos.");
      numeros[k] = v;
    }
    if (Object.keys(numeros).length) t.numeros = numeros;
  }
  if (o.proporcao !== undefined && o.proporcao !== null) {
    if (o.proporcao !== "16:9" && o.proporcao !== "1:1" && o.proporcao !== "4:5") throw erro(400, "proporcao_template_invalida", "Escolha a proporção 16:9, 1:1 ou 4:5.");
    t.proporcao = o.proporcao;
  }
  if (o.escala !== undefined && o.escala !== null) t.escala = faixa(o.escala, 100, 50, 150, erro);
  if (o.midia !== undefined && o.midia !== null) t.midia = faixa(o.midia, 100, 40, 100, erro);
  for (const k of ["fio", "legenda_completa", "ocultar_numeros", "ocultar_tempo"] as const) {
    if (o[k] === undefined || o[k] === null) continue;
    if (typeof o[k] !== "boolean") throw erro(400, "opcao_template_invalida", "Uma opção do template precisa ser sim ou não.");
    if (o[k] === true) t[k] = true;
  }
}

/** O ID só preserva a seleção existente; não concede leitura nem aceita bucket arbitrário. */
function conferirFonteDoAcervo(t: TrabalhoDoTemplate, ordem: number, template: TemplateProfile, erro: Erro) {
  if (!template.imagem_acervo_id) return;
  const ids = t.direcao.cards.find((c) => c.ordem === ordem)?.imagens_ids || [];
  if (!ids.some((id) => typeof id === "string" && id.toLowerCase() === template.imagem_acervo_id)) throw erro(409, "fonte_template_alterada", "A imagem escolhida não está mais no acervo desta lâmina. Atualize e selecione a fonte novamente.");
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
    conferirFonteDoAcervo(t, corpo.ordem, template, d.erro);
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
          conferirFonteDoAcervo(atual, ordem, template, d.erro);
          if (d.quadro(atual).formato !== quadro.formato) throw d.erro(409, "formato_template_alterado", "O formato do trabalho mudou. Gere a prévia novamente.");
        } catch (e) {
          if (e instanceof ReplayDoTemplate) throw e;
          throw new RecusaDoTemplate(atual, e);
        }
        // No Instagram o texto do template é a legenda do post (aparece com "mais"): o texto da lâmina fica como está.
        const direcao = template.estilo === "instagram" ? atual.direcao : d.atualizarTexto(atual, ordem, template.texto);
        return { cards: [...atual.cards, nova], direcao, status: d.statusDepoisDeGerar(atual, ordem) };
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
